import { expect, test } from "@playwright/test";
import { ownerMap, planTiles, resampleBilinear } from "../../src/sanitizer/inpaint/tiles";

test("tiles cover the area and the last tile aligns to the edge", () => {
  const wins = planTiles(1300, 700, 512, 64);
  const xs = [...new Set(wins.map((w) => w.x))].sort((a, b) => a - b);
  expect(xs[0]).toBe(0);
  expect(xs[xs.length - 1]).toBe(1300 - 512);
  for (const w of wins) {
    expect(w.x + w.w).toBeLessThanOrEqual(1300);
    expect(w.y + w.h).toBeLessThanOrEqual(700);
  }
});

test("every pixel has exactly one owner inside a covering window", () => {
  const wins = planTiles(1000, 600, 512, 64);
  const owner = ownerMap(wins, 1000, 600);
  for (let i = 0; i < owner.length; i += 997) {
    const x = i % 1000;
    const y = Math.floor(i / 1000);
    const w = wins[owner[i]];
    expect(x).toBeGreaterThanOrEqual(w.x);
    expect(x).toBeLessThan(w.x + w.w);
    expect(y).toBeGreaterThanOrEqual(w.y);
    expect(y).toBeLessThan(w.y + w.h);
  }
});

test("small image gives a single tile", () => {
  expect(planTiles(300, 200)).toEqual([{ x: 0, y: 0, w: 300, h: 200 }]);
});

test("bilinear resample of a constant image is constant", () => {
  const src = new Float32Array(3 * 10 * 10).fill(0.5);
  const out = resampleBilinear(src, 3, 10, 10, 7, 4);
  for (const v of out) expect(v).toBeCloseTo(0.5, 6);
});
