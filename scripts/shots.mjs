import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.URL || "http://127.0.0.1:8890";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { label: "mobile-portrait", width: 390, height: 844, mobile: true },
  { label: "mobile-landscape", width: 844, height: 390, mobile: true },
  { label: "tablet-portrait", width: 768, height: 1024, mobile: true },
  { label: "tablet-landscape", width: 1024, height: 768, mobile: true },
  { label: "laptop-1280", width: 1280, height: 800, mobile: false },
  { label: "laptop-1440", width: 1440, height: 900, mobile: false },
  { label: "desktop-1080", width: 1920, height: 1080, mobile: false },
  { label: "uhd-4k", width: 3840, height: 2160, mobile: false },
];

async function makeTestImage(page) {
  const arr = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 420;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 640, 420);
    g.addColorStop(0, "#123a2a");
    g.addColorStop(0.5, "#1f6f4a");
    g.addColorStop(1, "#d4b25a");
    x.fillStyle = g;
    x.fillRect(0, 0, 640, 420);
    x.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.arc(80 + i * 70, 120 + (i % 3) * 90, 40 + (i % 4) * 14, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "#f7f2e4";
    x.font = "bold 58px system-ui, sans-serif";
    x.fillText("vacation.jpg", 70, 260);
    x.font = "20px system-ui, sans-serif";
    x.fillText("GPS: 48.8566, 2.3522  ·  iPhone 15 Pro", 72, 300);
    const blob = await new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(arr);
}

async function uploadTestImage(page) {
  const buffer = await makeTestImage(page);
  await page.setInputFiles("#fileInput", {
    name: "vacation.jpg",
    mimeType: "image/jpeg",
    buffer,
  });
}

async function shot(page, label, state, full = true) {
  await page.screenshot({ path: `${OUT}/${label}-${state}.png`, fullPage: full });
}

async function runFlow(page, label) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#dropzone");

  await shot(page, label, "step1-empty");

  await uploadTestImage(page);

  await page.waitForTimeout(1100);
  await shot(page, label, "transition");

  await page.waitForSelector("#downloadArea a", { timeout: 25000 });
  await page.waitForSelector(".verdict.ok");
  await page.waitForTimeout(500);
  await shot(page, label, "step2-result");

  await page.click("#editBtn");
  await page.waitForTimeout(250);
  await page.click('#resizeChips button[data-pct="75"]');
  await page.waitForSelector("#dimReadout:not([hidden])");
  await page.waitForTimeout(400);
  await shot(page, label, "step2-edit");
}

async function runError(page, label) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#dropzone");

  await page.setInputFiles("#fileInput", {
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256)),
  });
  await page.waitForSelector(".verdict.bad", { timeout: 25000 });
  await page.waitForTimeout(400);
  await shot(page, label, "error-blocked");
}

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await context.newPage();
  await runFlow(page, vp.label);
  await runError(page, vp.label);
  await context.close();
  console.log(`captured ${vp.label} (${vp.width}×${vp.height})`);
}

await browser.close();
console.log("screenshots written to", OUT);
