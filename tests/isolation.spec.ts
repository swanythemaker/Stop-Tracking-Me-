import { expect, test } from "@playwright/test";

test("the page is cross-origin isolated so wasm threads can run", async ({ page }) => {
  await page.goto("/");
  const state = await page.evaluate(() => ({
    isolated: crossOriginIsolated,
    sab: typeof SharedArrayBuffer === "function",
  }));
  expect(state).toEqual({ isolated: true, sab: true });
});
