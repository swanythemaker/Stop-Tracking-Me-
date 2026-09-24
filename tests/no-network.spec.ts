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
