import { expect, test } from "@playwright/test";

test("sanitize flow does not make external network requests", async ({ page }) => {
  await page.goto("/");

  const origin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  let tracking = false;

  page.on("request", (request) => {
    if (!tracking) return;
    const url = request.url();
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    if (url.startsWith(origin)) return;
    externalRequests.push(url);
  });

  const pngBytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas context");
    ctx.fillStyle = "#1f7a4f";
    ctx.fillRect(0, 0, 48, 32);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  tracking = true;
  await page.setInputFiles("#fileInput", {
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBytes),
  });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 25000 });

  expect(externalRequests, `unexpected external requests: ${externalRequests.join(", ")}`).toEqual([]);
});

test("video clean does not make external network requests and previews play", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    if (url.startsWith(origin)) return;
    externalRequests.push(url);
  });
  const { readFileSync } = await import("node:fs");
  const buffer = readFileSync(new URL("./fixtures/keys_x264.mp4", import.meta.url));
  await page.setInputFiles("#fileInput", { name: "keys_x264.mp4", mimeType: "video/mp4", buffer });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 150_000 });
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>("#outputPreviewVideo");
    return !!v && !v.hidden && v.readyState >= 1;
  });
  expect(externalRequests, `unexpected external requests: ${externalRequests.join(", ")}`).toEqual([]);
});

test("remove marked area fetches exactly the pinned model file and nothing else", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "one engine is enough for the fetch contract");
  test.setTimeout(300_000);
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const external: string[] = [];
  const models: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    if (!url.startsWith(origin)) external.push(url);
    else if (new URL(url).pathname.startsWith("/models/")) models.push(new URL(url).pathname);
  });
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    const x = c.getContext("2d")!;
    x.fillStyle = "#1f7a4f";
    x.fillRect(0, 0, 160, 120);
    x.fillStyle = "#fff";
    x.fillRect(120, 100, 36, 16);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles("#fileInput", { name: "s.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 30_000 });
  await page.locator("#editBtn").click();
  await page.locator("#maskCornerBr").click();
  await page.locator("#removeBtn").click();
  await expect(page.locator(".verdict")).toContainText("marked area filled", { timeout: 240_000 });
  expect(external).toEqual([]);
  expect([...new Set(models)]).toEqual(["/models/migan_pipeline_v2-6f1f3530a1a2.onnx"]);
});
