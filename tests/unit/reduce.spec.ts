import { expect, test } from "@playwright/test";
import { requantize } from "../../src/sanitizer/reduce/pipeline";

test("requantize to 6 bits keeps values in range and snaps to 63 levels", () => {
  expect(requantize(0)).toBe(0);
  expect(requantize(255)).toBe(255);
  expect(requantize(100)).toBe(101);
  for (let v = 0; v <= 255; v++) {
    const q = requantize(v);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(255);
    expect(Math.abs(q - v)).toBeLessThanOrEqual(3);
    expect(Math.round((q * 63) / 255) * 255 / 63).toBeCloseTo(q, 0);
  }
});
