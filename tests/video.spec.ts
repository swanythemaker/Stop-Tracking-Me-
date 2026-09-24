import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ebmlIds, hasBytes, topLevelBoxes, walkBoxes } from "./helpers/boxes";

test.describe.configure({ timeout: 180_000 });

const FIXTURES = new URL("./fixtures/", import.meta.url);

function fixture(name: string): Buffer {
  return readFileSync(new URL(name, FIXTURES));
}

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

async function upload(page: Page, name: string) {
  const ext = name.split(".").pop()!;
  await page.setInputFiles("#fileInput", { name, mimeType: MIME[ext], buffer: fixture(name) });
}

async function uploadAndClean(page: Page, name: string) {
  await upload(page, name);
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator(".verdict.ok")).toBeVisible();
}

async function downloaded(page: Page): Promise<Buffer> {
  const editing = await page.locator("#resultStage.is-editing").count();
  if (editing) await page.locator("#editDone").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#downloadArea a").click()]);
  const path = await download.path();
  if (!path) throw new Error("download has no path");
  return readFileSync(path);
}

async function outputVideoDims(page: Page): Promise<{ w: number; h: number }> {
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>("#outputPreviewVideo");
    return !!v && !v.hidden && v.videoWidth > 0;
  });
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>("#outputPreviewVideo")!;
    return { w: v.videoWidth, h: v.videoHeight };
  });
}

async function setSwitch(page: Page, selector: string, on: boolean) {
  await page.evaluate(
    ({ selector, on }) => {
      const cb = document.querySelector<HTMLInputElement>(selector)!;
      if (cb.checked !== on) {
        cb.checked = on;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { selector, on },
  );
}

function expectCleanMp4(out: Buffer) {
  expect(topLevelBoxes(out)).toEqual(["ftyp", "moov", "mdat"]);
  const types = walkBoxes(out).map((b) => b.type);
  for (const bad of ["udta", "meta", "uuid", "free", "skip", "edts", "elst", "cslg"]) {
    expect(types, `unexpected ${bad}`).not.toContain(bad);
  }
  for (const bad of ["x264 - core", "Lavf", "Lavc", "+48.8583", "<x:xmpmeta", "c2pa", "jumb", "com.apple.", "Mediabunny"]) {
    expect(hasBytes(out, bad), `bytes still contain ${bad}`).toBe(false);
  }
}

function expectCleanWebm(out: Buffer) {
  const ids = ebmlIds(out);
  expect(ids[0]).toBe(0x1a45dfa3);
  expect(ids).toContain(0x18538067);
  for (const bad of [0x1254c367, 0x1941a469, 0x1043a770, 0xec, 0xbf, 0x7ba9, 0x4461, 0x73a4]) {
    expect(ids, `unexpected EBML id ${bad.toString(16)}`).not.toContain(bad);
  }
  for (const bad of ["Lavf", "Lavc", "Mediabunny", "Hello"]) {
    expect(hasBytes(out, bad), `bytes still contain ${bad}`).toBe(false);
  }
}

function hasHandler(out: Buffer, handler: string): boolean {
  return hasBytes(out, handler);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

const MP4_CASES: { name: string; markers: string[] }[] = [
  { name: "gps_x264_aac.mov", markers: ["udta"] },
  { name: "keys_x264.mp4", markers: ["keys"] },
  { name: "xmp_uuid_trailer.mp4", markers: ["uuid"] },
  { name: "c2pa_like.mp4", markers: ["uuid"] },
];

for (const { name, markers } of MP4_CASES) {
  test(`full clean of ${name} gives a clean MP4`, async ({ page }) => {
    await uploadAndClean(page, name);
    await expect(page.locator("#capNote")).toContainText("Full clean");
    await expect(page.locator("#outputReport")).toContainText("kind: mp4");
    await expect(page.locator("#outputReport")).toContainText("status: PASS");
    await expect(page.locator("#inputReport")).toContainText("status: FAIL");
    for (const m of markers) await expect(page.locator("#inputReport")).toContainText(m);
    const out = await downloaded(page);
    expectCleanMp4(out);
    expect(hasHandler(out, "soun")).toBe(false);
    await expect(page.locator(".verdict")).toContainText("Sound removed");
  });
}

for (const name of ["vp9_opus_tags.webm", "av1_opus.webm", "vp8_vorbis.webm"]) {
  test(`full clean of ${name} passes`, async ({ page }) => {
    await uploadAndClean(page, name);
    await expect(page.locator("#outputReport")).toContainText("status: PASS");
    await expect(page.locator("#inputReport")).toContainText("status: FAIL");
    const out = await downloaded(page);
    const kind = await page.locator("#outputReport").textContent();
    if (kind?.includes("kind: webm")) expectCleanWebm(out);
    else expectCleanMp4(out);
  });
}

test("keep sound adds a sound track that is labelled not scrubbed", async ({ page }) => {
  await uploadAndClean(page, "gps_x264_aac.mov");
  await page.locator("#editBtn").click();
  await setSwitch(page, "#ultraParanoid", false);
  await setSwitch(page, "#keepAudio", true);
  await expect(page.locator(".verdict")).toContainText("Sound re-encoded", { timeout: 150_000 });
  const out = await downloaded(page);
  expect(hasHandler(out, "soun")).toBe(true);
  expectCleanMp4(out);
});

test("resize 50 percent halves the video dimensions", async ({ page }) => {
  await uploadAndClean(page, "keys_x264.mp4");
  await page.locator("#editBtn").click();
  await page.locator('#resizeChips [data-pct="50"]').click();
  await expect(page.locator(".verdict")).toContainText("320×240 → 160×120", { timeout: 150_000 });
  const dims = await outputVideoDims(page);
  expect(dims).toEqual({ w: 160, h: 120 });
});

test("rotate 90 swaps the video dimensions", async ({ page }) => {
  await uploadAndClean(page, "keys_x264.mp4");
  await page.locator("#editBtn").click();
  await page.locator("#rotateRight").click();
  await expect(page.locator(".verdict")).toContainText("320×240 → 240×320", { timeout: 150_000 });
  const dims = await outputVideoDims(page);
  expect(dims).toEqual({ w: 240, h: 320 });
});

test("ultra paranoid turns a WebM input into MP4 without sound", async ({ page }) => {
  await uploadAndClean(page, "vp9_opus_tags.webm");
  await expect(page.locator("#outputReport")).toContainText("kind: mp4");
  const out = await downloaded(page);
  expectCleanMp4(out);
  expect(hasHandler(out, "soun")).toBe(false);
});

test("two_video.mp4 is refused with no download", async ({ page }) => {
  await upload(page, "two_video.mp4");
  await expect(page.locator(".verdict.bad")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator("#downloadArea a")).toHaveCount(0);
});

for (const name of ["frag.mp4", "trim_elst.mp4"]) {
  test(`full clean re-encodes ${name} into a clean MP4`, async ({ page }) => {
    await uploadAndClean(page, name);
    await expect(page.locator("#outputReport")).toContainText("status: PASS");
    const out = await downloaded(page);
    expectCleanMp4(out);
  });
}

test("input scan names the groups of findings", async ({ page }) => {
  await upload(page, "gps_x264_aac.mov");
  await expect(page.locator("#inputScanCard")).toContainText("Location", { timeout: 60_000 });
  await expect(page.locator("#inputScanCard")).toContainText("Software");
});

test.describe("failover without WebCodecs", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const k of ["VideoEncoder", "VideoDecoder", "AudioEncoder", "AudioDecoder"]) {
        Object.defineProperty(window, k, { value: undefined, configurable: true });
      }
    });
    await page.goto("/");
  });

  test("basic clean strips metadata and keeps the picture bytes", async ({ page }) => {
    await uploadAndClean(page, "gps_x264_aac.mov");
    await expect(page.locator("#capNote")).toContainText("Basic clean");
    await expect(page.locator(".verdict")).toContainText("Picture and sound untouched");
    await expect(page.locator("#outputReport")).toContainText("status: PASS");
    const out = await downloaded(page);
    expectCleanMp4(out);
  });

  test("basic clean of WebM keeps WebM", async ({ page }) => {
    await uploadAndClean(page, "vp9_opus_tags.webm");
    await expect(page.locator("#outputReport")).toContainText("kind: webm");
    const out = await downloaded(page);
    expectCleanWebm(out);
  });

  for (const name of ["frag.mp4", "trim_elst.mp4", "two_video.mp4"]) {
    test(`basic clean refuses ${name}`, async ({ page }) => {
      await upload(page, name);
      await expect(page.locator(".verdict.bad")).toBeVisible({ timeout: 150_000 });
      await expect(page.locator("#downloadArea a")).toHaveCount(0);
    });
  }

  test("basic clean with keep sound copies the audio track", async ({ page }) => {
    await uploadAndClean(page, "gps_x264_aac.mov");
    await page.locator("#editBtn").click();
    await setSwitch(page, "#ultraParanoid", false);
    await setSwitch(page, "#keepAudio", true);
    await expect(page.locator(".verdict")).toContainText("Sound kept", { timeout: 150_000 });
    const out = await downloaded(page);
    expect(hasHandler(out, "soun")).toBe(true);
    expectCleanMp4(out);
  });
});

test("an oversized video is rejected before any processing", async ({ page }) => {
  await page.evaluate(() => {
    const size = 101 * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024);
    const parts = Array.from({ length: 101 }, () => chunk);
    const file = new File(parts, "huge.mp4", { type: "video/mp4" });
    const input = document.querySelector<HTMLInputElement>("#fileInput")!;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return size;
  });
  await expect(page.locator("#status")).toContainText("over the 100.0 MB limit");
  await expect(page.locator("#downloadArea a")).toHaveCount(0);
});
