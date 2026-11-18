import { expect, test } from "@playwright/test";

for (const path of ["/trackers/", "/how-it-works/"]) {
  test(`${path} loads with the tool menu and sends nothing out`, async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://127.0.0.1:8890")) external.push(r.url());
    });
    await page.goto(path);
    await expect(page.locator(".tools a")).toHaveCount(3);
    await expect(page.locator(".page-title")).toBeVisible();
    await expect(page.locator(".foot-version")).toBeVisible();
    expect(external).toEqual([]);
  });
}

test("a tag link from the cleaner opens its entry on the trackers page", async ({ page }) => {
  await page.goto("/#links");
  await page.fill("#linkInput", "https://x.com/u/status/1?a=arMamaA1lWeuSqriZFw&s=20");
  await page.click("#linkSummary");
  await page.locator("#linkReport a").first().click();
  await expect(page).toHaveURL(/\/trackers\/#x-a$/);
  await expect(page.locator("#x-a details")).toHaveAttribute("open", "");
  await expect(page.locator("#x-a")).toContainText("October 2026");
});

test("tracker search filters entries", async ({ page }) => {
  await page.goto("/trackers/");
  await page.fill("#trackerSearch", "mailchimp");
  await expect(page.locator(".tracker:visible")).toHaveCount(1);
  await expect(page.locator("#trackerCount")).toContainText("1 of");
});
