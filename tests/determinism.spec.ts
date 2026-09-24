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

test("inpainted and reduced outputs are byte-identical across Chromium and Firefox", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "runs once, launches both engines itself");
  test.setTimeout(900_000);
  const input = await makeStampedInput();
  const cr = await chromium.launch();
  const ff = await firefox.launch();
  try {
    for (const opts of [{ inpaint: "migan" as const }, { reduce: true }]) {
      const a = await runStampedDownload(cr, input, opts);
      const b = await runStampedDownload(ff, input, opts);
      expect(a, `output for ${JSON.stringify(opts)} differs between engines`).toBe(b);
    }
  } finally {
    await cr.close();
    await ff.close();
  }
});

async function makeStampedInput(): Promise<Buffer> {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto(BASE);
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 320, 240);
    g.addColorStop(0, "#123a2a");
    g.addColorStop(1, "#d4b25a");
    x.fillStyle = g;
    x.fillRect(0, 0, 320, 240);
    x.fillStyle = "#fff";
    x.fillRect(250, 210, 64, 24);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await b.close();
  return Buffer.from(png);
}

async function runStampedDownload(
  browser: Browser,
  input: Buffer,
  opts: { inpaint?: "migan" | "lama"; reduce?: boolean },
): Promise<string> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE);
  await page.setInputFiles("#fileInput", { name: "stamp.png", mimeType: "image/png", buffer: input });
  await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 60000 });
  await page.locator("#editBtn").click();
  if (opts.inpaint) {
    await page.locator(`#inpaintEngine [data-engine="${opts.inpaint}"]`).click();
    await page.locator("#maskCornerBr").click();
    await page.locator("#removeBtn").click();
    await expect(page.locator(".verdict")).toContainText("marked area filled", { timeout: 600000 });
  }
  if (opts.reduce) {
    await page.evaluate(() => {
      const cb = document.querySelector<HTMLInputElement>("#reduceAi")!;
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator(".verdict")).toContainText("Reduce hidden marks", { timeout: 600000 });
  }
  await page.locator("#editDone").click();
  await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 10000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#downloadArea a").click()]);
  const path = await download.path();
  const hex = createHash("sha256").update(readFileSync(path)).digest("hex");
  await context.close();
  return hex;
}
