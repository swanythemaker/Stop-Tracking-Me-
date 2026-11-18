import { expect, test } from "@playwright/test";

test("tool menu switches between photos, videos and links", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#tabPhoto")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#linkPanel")).toBeHidden();
  await expect(page.locator("#fileInput")).toHaveAttribute("accept", /image\/png/);

  await page.click("#tabVideo");
  await expect(page).toHaveURL(/#videos$/);
  await expect(page.locator("#fileInput")).toHaveAttribute("accept", /video\/mp4/);
  await expect(page.locator(".dz-title:visible")).toHaveText("Drop a video here");

  await page.click("#tabLink");
  await expect(page).toHaveURL(/#links$/);
  await expect(page.locator("#linkPanel")).toBeVisible();
  await expect(page.locator("#carousel")).toBeHidden();
  await expect(page.locator(".stepbar")).toBeHidden();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tabPhoto")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tabPhoto")).toBeFocused();
});

test("a deep link opens the right tool", async ({ page }) => {
  await page.goto("/#links");
  await expect(page.locator("#tabLink")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#linkPanel")).toBeVisible();
});

test("a photo dropped on the videos tab switches to photos, and links keep the result", async ({ page }) => {
  await page.goto("/#videos");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 30;
    c.getContext("2d")!.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles("#fileInput", { name: "t.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.locator("#tabPhoto")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 25000 });

  await page.click("#tabLink");
  await expect(page.locator("body")).toHaveAttribute("data-mode", "landing");
  await page.click("#tabPhoto");
  await expect(page.locator("#downloadArea a")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-mode", "working");

  await page.click("#tabVideo");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("Select a video to begin.");
});
