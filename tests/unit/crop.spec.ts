import { expect, test } from "@playwright/test";
import { cropForMask } from "../../src/sanitizer/inpaint/crop";
import { cornerBox, fillBox } from "../../src/ui/maskOps";

test("crop pads the bbox, squares it and clamps to the image", () => {
  const w = 1000;
  const h = 600;
  const m = new Uint8Array(w * h);
  fillBox(m, w, h, cornerBox(w, h, "br", 22, 12), 255);
  const r = cropForMask(m, w, h)!;
  expect(r.x + r.cw).toBe(w);
  expect(r.y + r.ch).toBe(h);
  expect(r.cw).toBe(r.ch);
  expect(r.cw).toBeGreaterThanOrEqual(220 + 64);
});

test("empty mask gives no crop", () => {
  expect(cropForMask(new Uint8Array(16), 4, 4)).toBeNull();
});
