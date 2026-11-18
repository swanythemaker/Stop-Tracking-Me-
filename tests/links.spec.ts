import { expect, test } from "@playwright/test";

test("clean a link: works offline and sends nothing", async ({ page }) => {
  await page.goto("/#links");
  await page.waitForLoadState("networkidle");

  const origin = new URL(page.url()).origin;
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:")) requests.push(url);
  });

  await page.fill(
    "#linkInput",
    "Look: https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.amazon.com%2FWidget%2Fdp%2FB08N5WRWNW%2Fref%3Dsr_1_1%3Ftag%3Dx-20%26fbclid%3DIwAR1 and https://t.co/AbCdEf",
  );

  await expect(page.locator("#linkOutput")).toHaveValue("Look: https://www.amazon.com/dp/B08N5WRWNW and https://t.co/AbCdEf");
  await expect(page.locator("#linkSummary")).toHaveText("Removed 4 trackers from 1 link · 1 short link can't be checked");
  await expect(page.locator("#linkReport")).toBeHidden();
  await page.click("#linkSummary");
  await expect(page.locator("#linkReport > li")).toHaveCount(2);
  await expect(page.locator("#linkReport > li").first()).toContainText("Redirect wrapper");
  await expect(page.locator("#linkReport > li").first()).toContainText("l.facebook.com");
  await expect(page.locator("#linkReport > li").nth(1)).toContainText("short link");

  await page.fill("#linkInput", "just some words");
  await expect(page.locator("#linkOut")).toBeHidden();
  await expect(page.locator("#linkState")).toHaveText("No link found in that text.");

  expect(requests, `unexpected external requests: ${requests.join(", ")}`).toEqual([]);
});
