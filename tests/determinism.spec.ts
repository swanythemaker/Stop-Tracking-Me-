import { chromium, expect, firefox, test, type Browser } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8890";

async function makeInput(): Promise<Buffer> {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(BASE);
  const arr = await p.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 40;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 64, 40);
    g.addColorStop(0, "#0a3");
    g.addColorStop(1, "#fc0");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 40);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await b.close();
  return Buffer.from(arr);
}

async function sanitizeHash(
  browser: Browser,
  buffer: Buffer,
  outputFormat: string,
): Promise<string> {
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE);

  await page.setInputFiles("#fileInput", {
    name: "in.png",
    mimeType: "image/png",
    buffer,
  });
  await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 30000 });

  if (outputFormat !== "image/png") {
    await page.locator("#editBtn").click();
    await page.locator("#editor").waitFor({ state: "visible" });
    await page.evaluate(() => {
      const cb = document.querySelector<HTMLInputElement>("#ultraParanoid")!;
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#outputFormat").selectOption(outputFormat);
  }

  const kind = outputFormat.replace("image/", "");
  await expect(page.locator("#outputReport")).toContainText(`kind: ${kind}`, {
    timeout: 30000,
  });

  if (await page.locator("#editDone").isVisible()) {
    await page.locator("#editDone").click();
    await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 10000 });
  }

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadArea a").click(),
  ]);
  const path = await download.path();
  const hex = createHash("sha256").update(readFileSync(path)).digest("hex");
  await page.close();
  return hex;
}

test("cleaned output is byte-for-byte identical across Chromium and Firefox", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "runs once, launches both engines itself");
  test.setTimeout(240000);
  const input = await makeInput();
  const cr = await chromium.launch();
  const ff = await firefox.launch();
  try {
    for (const fmt of ["image/png", "image/jpeg", "image/webp"]) {
      const hChrome = await sanitizeHash(cr, input, fmt);
      const hFirefox = await sanitizeHash(ff, input, fmt);
      expect(hChrome).toMatch(/^[0-9a-f]{64}$/);
      expect(hChrome, `output for ${fmt} differs between engines`).toBe(hFirefox);
    }
  } finally {
    await cr.close();
    await ff.close();
  }
});

const FIXTURES = new URL("./fixtures/", import.meta.url);
const VIDEO_MIME: Record<string, string> = { mov: "video/quicktime", mp4: "video/mp4", webm: "video/webm" };

async function runVideo(
  browser: Browser,
  name: string,
  disableWebCodecs: boolean,
): Promise<{ hash: string; report: string; capNote: string }> {
  const context = await browser.newContext();
  if (disableWebCodecs) {
    await context.addInitScript(() => {
      for (const k of ["VideoEncoder", "VideoDecoder", "AudioEncoder", "AudioDecoder"]) {
        Object.defineProperty(window, k, { value: undefined, configurable: true });
      }
    });
  }
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE);
  const ext = name.split(".").pop()!;
  await page.setInputFiles("#fileInput", { name, mimeType: VIDEO_MIME[ext], buffer: readFileSync(new URL(name, FIXTURES)) });
  await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 150000 });
  const report = (await page.locator("#outputReport").textContent()) ?? "";
  const capNote = (await page.locator("#capNote").textContent()) ?? "";
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#downloadArea a").click()]);
  const path = await download.path();
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  await context.close();
  return { hash, report, capNote };
}

function verdictLines(report: string): string[] {
  return report
    .split("\n")
    .filter((l) => /^(kind|tracks|status):/.test(l))
    .sort();
}

test("basic video clean is byte-for-byte identical across Chromium and Firefox", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "runs once, launches both engines itself");
  test.setTimeout(300000);
  const cr = await chromium.launch();
  const ff = await firefox.launch();
  try {
    for (const name of ["gps_x264_aac.mov", "vp9_opus_tags.webm"]) {
      const a = await runVideo(cr, name, true);
      const b = await runVideo(ff, name, true);
      expect(a.capNote).toContain("Basic clean");
      expect(a.report).toContain("status: PASS");
      expect(a.hash, `remux output for ${name} differs between engines`).toBe(b.hash);
    }
  } finally {
    await cr.close();
    await ff.close();
  }
});

test("full video clean reaches the same verdict across Chromium and Firefox", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "runs once, launches both engines itself");
  test.setTimeout(300000);
  const cr = await chromium.launch();
  const ff = await firefox.launch();
  try {
    for (const name of ["gps_x264_aac.mov", "vp9_opus_tags.webm"]) {
      const a = await runVideo(cr, name, false);
      const b = await runVideo(ff, name, false);
      expect(a.capNote).toContain("Full clean");
      expect(b.capNote).toContain("Full clean");
      expect(a.report).toContain("status: PASS");
      expect(verdictLines(a.report), `verdict for ${name} differs between engines`).toEqual(verdictLines(b.report));
    }
  } finally {
    await cr.close();
    await ff.close();
  }
});
