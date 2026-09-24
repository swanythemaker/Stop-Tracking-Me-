import { expect, test } from "@playwright/test";
import { cornerBox, fillBox, flipH, flipV, maskBBox, maskCoverage, remapMask, resizeNearest, rotate90 } from "../../src/ui/maskOps";

function corner(w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  fillBox(m, w, h, cornerBox(w, h, "br", 25, 25), 255);
  return m;
}

test("rotate twice equals 180 and four times is identity", () => {
  const m = corner(8, 6);
  const r1 = rotate90(m, 8, 6);
  const r2 = rotate90(r1.mask, r1.w, r1.h);
  const expected180 = flipH(flipV(m, 8, 6), 8, 6);
  expect(Array.from(r2.mask)).toEqual(Array.from(expected180));
  const r3 = rotate90(r2.mask, r2.w, r2.h);
  const r4 = rotate90(r3.mask, r3.w, r3.h);
  expect(Array.from(r4.mask)).toEqual(Array.from(m));
});

test("flips are involutions", () => {
  const m = corner(8, 6);
  expect(Array.from(flipH(flipH(m, 8, 6), 8, 6))).toEqual(Array.from(m));
  expect(Array.from(flipV(flipV(m, 8, 6), 8, 6))).toEqual(Array.from(m));
});

test("resize keeps the corner in the corner", () => {
  const m = corner(40, 30);
  const r = resizeNearest(m, 40, 30, 20, 15);
  const b = maskBBox(r, 20, 15)!;
  expect(b.x + b.w).toBe(20);
  expect(b.y + b.h).toBe(15);
  expect(maskCoverage(r)).toBeCloseTo(maskCoverage(m), 1);
});

test("rotate after painting matches painting after rotating", () => {
  const m = corner(40, 30);
  const rotated = remapMask(m, 40, 30, { flipH: false, flipV: false, rotate: 90, toWidth: 30, toHeight: 40 });
  const direct = new Uint8Array(30 * 40);
  fillBox(direct, 30, 40, cornerBox(30, 40, "bl", 25, 25), 255);
  const a = maskBBox(rotated.mask, 30, 40)!;
  const b = maskBBox(direct, 30, 40)!;
  expect(a.x).toBe(b.x);
  expect(a.y + a.h).toBe(b.y + b.h);
});
