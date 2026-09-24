export type MaskOps = {
  flipH: boolean;
  flipV: boolean;
  rotate: number;
  toWidth: number;
  toHeight: number;
};

export type Box = { x: number; y: number; w: number; h: number };

export function flipH(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + (w - 1 - x)] = mask[row + x];
  }
  return out;
}

export function flipV(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) out.set(mask.subarray(y * w, y * w + w), (h - 1 - y) * w);
  return out;
}

export function rotate90(mask: Uint8Array, w: number, h: number): { mask: Uint8Array; w: number; h: number } {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[x * h + (h - 1 - y)] = mask[y * w + x];
    }
  }
  return { mask: out, w: h, h: w };
}

export function resizeNearest(mask: Uint8Array, w: number, h: number, tw: number, th: number): Uint8Array {
  if (tw === w && th === h) return mask.slice();
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / tw));
      out[y * tw + x] = mask[sy * w + sx] >= 128 ? 255 : 0;
    }
  }
  return out;
}

export function remapMask(mask: Uint8Array, w: number, h: number, ops: MaskOps): { mask: Uint8Array; w: number; h: number } {
  let cur = mask;
  let cw = w;
  let ch = h;
  if (ops.flipH) cur = flipH(cur, cw, ch);
  if (ops.flipV) cur = flipV(cur, cw, ch);
  const turns = (((ops.rotate % 360) + 360) % 360) / 90;
  for (let i = 0; i < turns; i++) {
    const r = rotate90(cur, cw, ch);
    cur = r.mask;
    cw = r.w;
    ch = r.h;
  }
  cur = resizeNearest(cur, cw, ch, ops.toWidth, ops.toHeight);
  return { mask: cur, w: ops.toWidth, h: ops.toHeight };
}

export function maskBBox(mask: Uint8Array, w: number, h: number): Box | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] >= 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function maskCoverage(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= 128) n++;
  return mask.length ? n / mask.length : 0;
}

export function fillCircle(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, value: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const rr = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= rr) mask[y * w + x] = value;
    }
  }
}

export function fillLine(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number, value: number): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(mask, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, value);
  }
}

export function fillBox(mask: Uint8Array, w: number, h: number, box: Box, value: number): void {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w));
  const y1 = Math.min(h, Math.ceil(box.y + box.h));
  for (let y = y0; y < y1; y++) mask.fill(value, y * w + x0, y * w + x1);
}

export function cornerBox(w: number, h: number, corner: "tl" | "tr" | "bl" | "br", widthPct: number, heightPct: number): Box {
  const bw = Math.max(1, Math.round((w * widthPct) / 100));
  const bh = Math.max(1, Math.round((h * heightPct) / 100));
  const x = corner === "tr" || corner === "br" ? w - bw : 0;
  const y = corner === "bl" || corner === "br" ? h - bh : 0;
  return { x, y, w: bw, h: bh };
}
