import { chromium } from "@playwright/test";

const BASE = process.env.URL || "http://127.0.0.1:8890";
const msgs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

page.on("console", (m) => {
  const t = m.type();
  if (t === "error" || t === "warning") msgs.push(`[${t}] ${m.text()}`);
});
page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  msgs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`),
);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#dropzone");

await page.waitForTimeout(1500);

await page.screenshot({ path: "screenshots/check-hero.png" });
await page.screenshot({ path: "screenshots/check-full.png", fullPage: true });

await browser.close();

if (msgs.length) {
  console.log("CONSOLE NOT CLEAN, " + msgs.length + " message(s):");
  for (const m of msgs) console.log("  " + m);
  process.exit(1);
}
console.log("CONSOLE CLEAN, no errors/warnings/failed requests.");
