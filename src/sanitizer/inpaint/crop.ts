import { maskBBox } from "../../ui/maskOps";

type CropRect = { x: number; y: number; cw: number; ch: number };

const MIN_PAD = 64;
const PAD_RATIO = 0.35;

export function cropForMask(mask: Uint8Array, w: number, h: number): CropRect | null {
  const box = maskBBox(mask, w, h);
  if (!box) return null;
  const pad = Math.max(MIN_PAD, Math.round(PAD_RATIO * Math.max(box.w, box.h)));
  let x0 = box.x - pad;
  let y0 = box.y - pad;
  let x1 = box.x + box.w + pad;
  let y1 = box.y + box.h + pad;
  const side = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = Math.round(cx - side / 2);
  y0 = Math.round(cy - side / 2);
  x1 = x0 + side;
  y1 = y0 + side;
  if (x0 < 0) {
    x1 -= x0;
    x0 = 0;
  }
  if (y0 < 0) {
    y1 -= y0;
    y0 = 0;
  }
  if (x1 > w) {
    x0 = Math.max(0, x0 - (x1 - w));
    x1 = w;
  }
  if (y1 > h) {
    y0 = Math.max(0, y0 - (y1 - h));
    y1 = h;
  }
  return { x: x0, y: y0, cw: x1 - x0, ch: y1 - y0 };
}

export function extractRgb(rgba: Uint8Array, w: number, r: CropRect): Uint8Array {
  const plane = r.cw * r.ch;
  const out = new Uint8Array(plane * 3);
  for (let y = 0; y < r.ch; y++) {
    for (let x = 0; x < r.cw; x++) {
      const src = ((r.y + y) * w + (r.x + x)) * 4;
      const dst = y * r.cw + x;
      out[dst] = rgba[src];
      out[plane + dst] = rgba[src + 1];
      out[2 * plane + dst] = rgba[src + 2];
    }
  }
  return out;
}

export function extractMask(mask: Uint8Array, w: number, r: CropRect): Uint8Array {
  const out = new Uint8Array(r.cw * r.ch);
  for (let y = 0; y < r.ch; y++) out.set(mask.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.cw), y * r.cw);
  return out;
}

export function pasteMasked(rgba: Uint8Array, w: number, r: CropRect, rgb: Uint8Array, mask: Uint8Array): void {
  const plane = r.cw * r.ch;
  for (let y = 0; y < r.ch; y++) {
    for (let x = 0; x < r.cw; x++) {
      const i = (r.y + y) * w + (r.x + x);
      if (mask[i] < 128) continue;
      const src = y * r.cw + x;
      rgba[i * 4] = rgb[src];
      rgba[i * 4 + 1] = rgb[plane + src];
      rgba[i * 4 + 2] = rgb[2 * plane + src];
    }
  }
}
