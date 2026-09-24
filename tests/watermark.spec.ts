import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function makeStamped(page: Page): Promise<Buffer> {
  const arr = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 320, 240);
    g.addColorStop(0, "#123a2a");
    g.addColorStop(1, "#d4b25a");
    x.fillStyle = g;
    x.fillRect(0, 0, 320, 240);
    x.fillStyle = "#ffffff";
    x.fillRect(250, 210, 64, 24);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(arr);
}

type MaskDebug = { coverage: number; bbox: { x: number; y: number; w: number; h: number } | null; armed: boolean };

async function maskDebug(page: Page): Promise<MaskDebug> {
  return page.evaluate(() => (window as unknown as { __maskDebug: () => MaskDebug }).__maskDebug());
}

async function uploadStamped(page: Page) {
  await page.setInputFiles("#fileInput", { name: "stamp.png", mimeType: "image/png", buffer: await makeStamped(page) });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 30_000 });
  await page.locator("#editBtn").click();
  await expect(page.locator("#watermarkTools")).toBeVisible();
}

async function outputPixels(page: Page): Promise<number[]> {
  await page.waitForFunction(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview");
    return !!i && !i.hidden && i.naturalWidth > 0 && i.complete;
  });
  return page.evaluate(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview")!;
    const c = document.createElement("canvas");
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const x = c.getContext("2d")!;
    x.drawImage(i, 0, 0);
    return Array.from(x.getImageData(0, 0, c.width, c.height).data);
  });
}

function diffInside(before: number[], after: number[], w: number, box: { x: number; y: number; w: number; h: number }) {
  let inside = 0;
  let insideN = 0;
  let outsideChanged = 0;
  const n = before.length / 4;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const d = Math.abs(before[i * 4] - after[i * 4]) + Math.abs(before[i * 4 + 1] - after[i * 4 + 1]) + Math.abs(before[i * 4 + 2] - after[i * 4 + 2]);
    const inBox = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    if (inBox) {
      inside += d / 3;
      insideN++;
    } else if (d > 0) {
      outsideChanged++;
    }
  }
  return { insideMean: inside / Math.max(1, insideN), outsideChanged };
}

function psnr(a: number[], b: number[]): number {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      se += d * d;
      n++;
    }
  }
  const mse = se / n;
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

async function waitVerdict(page: Page, text: string, timeout: number) {
  await expect(page.locator(".verdict")).toContainText(text, { timeout });
  await expect(page.locator("#downloadArea a")).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("remove marked area fills the stamp and leaves the rest untouched", async ({ page, browserName }) => {
  test.setTimeout(browserName === "firefox" ? 600_000 : 240_000);
  const modelRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/models/")) modelRequests.push(r.url());
  });
  await uploadStamped(page);
  const before = await outputPixels(page);
  await page.locator("#maskCornerBr").click();
  const box = (await maskDebug(page)).bbox!;
  await page.locator("#removeBtn").click();
  await waitVerdict(page, "marked area filled", browserName === "firefox" ? 540_000 : 200_000);
  const after = await outputPixels(page);
  const d = diffInside(before, after, 320, box);
  expect(d.insideMean).toBeGreaterThan(20);
  expect(d.outsideChanged).toBe(0);
  expect(modelRequests.filter((u) => u.includes("migan_pipeline_v2"))).toHaveLength(1);
  await page.locator("#maskCornerBl").click();
  await page.locator("#removeBtn").click();
  await expect(page.locator(".verdict")).toContainText("marked area filled", { timeout: 200_000 });
  expect(modelRequests.filter((u) => u.includes("migan_pipeline_v2"))).toHaveLength(1);
});

test("high quality remover fills the stamp", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the Playwright Firefox build runs this model about ten times slower");
  test.setTimeout(400_000);
  await uploadStamped(page);
  const before = await outputPixels(page);
  await page.locator('#inpaintEngine [data-engine="lama"]').click();
  await page.locator("#maskCornerBr").click();
  const box = (await maskDebug(page)).bbox!;
  await page.locator("#removeBtn").click();
  await waitVerdict(page, "marked area filled", 360_000);
  const after = await outputPixels(page);
  const d = diffInside(before, after, 320, box);
  expect(d.insideMean).toBeGreaterThan(20);
  expect(d.outsideChanged).toBe(0);
});

test("reduce hidden marks changes pixels everywhere and keeps dimensions", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the Playwright Firefox build runs this model about ten times slower");
  test.setTimeout(300_000);
  await uploadStamped(page);
  const before = await outputPixels(page);
  await page.evaluate(() => {
    const cb = document.querySelector<HTMLInputElement>("#reduceAi")!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitVerdict(page, "Reduce hidden marks", 240_000);
  const after = await outputPixels(page);
  expect(after.length).toBe(before.length);
  const q = psnr(before, after);
  expect(q).toBeGreaterThan(20);
  expect(q).toBeLessThan(45);
});

test("delete downloaded models empties the cache and the next remove downloads again", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "one engine is enough for the cache contract");
  test.setTimeout(300_000);
  const modelRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/models/")) modelRequests.push(r.url());
  });
  await uploadStamped(page);
  await page.locator("#maskCornerBr").click();
  await page.locator("#removeBtn").click();
  await waitVerdict(page, "marked area filled", 200_000);
  await expect(page.locator("#modelStore")).toContainText("Downloaded models: 2");
  await page.locator("#deleteModels").click();
  await expect(page.locator("#modelStore")).toHaveText("Downloaded models: none");
  await page.locator("#maskCornerBl").click();
  await page.locator("#removeBtn").click();
  await expect(page.locator("#modelStore")).toContainText("Downloaded models: 2", { timeout: 200_000 });
  expect(modelRequests.filter((u) => u.includes("migan_pipeline_v2"))).toHaveLength(2);
});

test("corner preset marks the bottom right and clear resets it", async ({ page }) => {
  await uploadStamped(page);
  await expect(page.locator("#maskState")).toHaveText("Nothing marked");
  await page.locator("#maskCornerBr").click();
  await expect(page.locator("#maskState")).toContainText("percent marked");
  const d = await maskDebug(page);
  expect(d.coverage).toBeGreaterThan(0.02);
  expect(d.bbox!.x + d.bbox!.w).toBe(320);
  expect(d.bbox!.y + d.bbox!.h).toBe(240);
  await page.locator("#maskClear").click();
  await expect(page.locator("#maskState")).toHaveText("Nothing marked");
});

test("rotating after masking keeps the coverage and moves the corner", async ({ page }) => {
  await uploadStamped(page);
  await page.locator("#maskCornerBr").click();
  const before = await maskDebug(page);
  await page.locator("#rotateRight").click();
  await expect(page.locator(".verdict")).toContainText("240×320", { timeout: 30_000 });
  const after = await maskDebug(page);
  expect(Math.abs(after.coverage - before.coverage)).toBeLessThan(0.01);
  expect(after.bbox!.x).toBe(0);
  expect(after.bbox!.y + after.bbox!.h).toBe(320);
});

test("the mask tools are hidden for video", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const buffer = readFileSync(new URL("./fixtures/keys_x264.mp4", import.meta.url));
  await page.setInputFiles("#fileInput", { name: "keys_x264.mp4", mimeType: "video/mp4", buffer });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 150_000 });
  await page.locator("#editBtn").click();
  await expect(page.locator("#watermarkTools")).toBeHidden();
});

test("Find watermark proposes a box over the stamp", async ({ page, browserName }) => {
  test.skip(!process.env.WM_FLORENCE, "release gate only: downloads the 275 MB detector");
  test.skip(browserName !== "chromium", "Firefox is about ten times slower per prompt");
  test.setTimeout(600_000);
  await uploadStamped(page);
  await page.locator("#findWatermark").click();
  await expect(page.locator("#status")).toContainText(/Found|Nothing found/, { timeout: 540_000 });
  await expect(page.locator("#status")).toContainText("Found");
  await page.locator("#acceptProposals").click();
  const d = await maskDebug(page);
  expect(d.coverage).toBeGreaterThan(0);
  const b = d.bbox!;
  const stamp = { x: 250, y: 210, w: 64, h: 24 };
  const ix = Math.max(0, Math.min(b.x + b.w, stamp.x + stamp.w) - Math.max(b.x, stamp.x));
  const iy = Math.max(0, Math.min(b.y + b.h, stamp.y + stamp.h) - Math.max(b.y, stamp.y));
  expect(ix * iy).toBeGreaterThan(0);
});
