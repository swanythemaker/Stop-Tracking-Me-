import { expect, test } from "@playwright/test";
import { filterBoxes, iou } from "../../src/sanitizer/detect/types";

test("filter drops whole-image and tiny boxes and dedupes overlaps", () => {
  const boxes = [
    { x: 0, y: 0, w: 1000, h: 800, label: "text" },
    { x: 100, y: 100, w: 600, h: 500, label: "text" },
    { x: 1, y: 1, w: 2, h: 2, label: "logo" },
    { x: 800, y: 700, w: 150, h: 60, label: "watermark" },
    { x: 802, y: 702, w: 148, h: 58, label: "text" },
  ];
  const kept = filterBoxes(boxes, 1000, 800);
  expect(kept).toHaveLength(1);
  expect(kept[0].label).toBe("watermark");
});

test("iou of identical boxes is one and disjoint boxes is zero", () => {
  const a = { x: 0, y: 0, w: 10, h: 10, label: "a" };
  expect(iou(a, a)).toBe(1);
  expect(iou(a, { x: 20, y: 20, w: 5, h: 5, label: "b" })).toBe(0);
});
