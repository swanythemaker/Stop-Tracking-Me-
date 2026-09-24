type Window = { x: number; y: number; w: number; h: number };

export function planTiles(width: number, height: number, tile = 512, overlap = 64): Window[] {
  const out: Window[] = [];
  const step = Math.max(1, tile - overlap);
  const xs = axisStarts(width, tile, step);
  const ys = axisStarts(height, tile, step);
  for (const y of ys) for (const x of xs) out.push({ x, y, w: Math.min(tile, width - x), h: Math.min(tile, height - y) });
  return out;
}

function axisStarts(size: number, tile: number, step: number): number[] {
  if (size <= tile) return [0];
  const starts: number[] = [];
  for (let s = 0; s + tile < size; s += step) starts.push(s);
  starts.push(size - tile);
  return starts;
}

export function ownerMap(windows: Window[], width: number, height: number): Uint16Array {
  const owner = new Uint16Array(width * height);
  const best = new Float32Array(width * height).fill(Infinity);
  windows.forEach((win, idx) => {
    const cx = win.x + win.w / 2;
    const cy = win.y + win.h / 2;
    for (let y = win.y; y < win.y + win.h; y++) {
      for (let x = win.x; x < win.x + win.w; x++) {
        const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
        const i = y * width + x;
        if (d < best[i]) {
          best[i] = d;
          owner[i] = idx;
        }
      }
    }
  });
  return owner;
}

export function resampleBilinear(src: Float32Array, channels: number, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(channels * dw * dh);
  const sxr = sw / dw;
  const syr = sh / dh;
  for (let c = 0; c < channels; c++) {
    const sp = c * sw * sh;
    const dp = c * dw * dh;
    for (let y = 0; y < dh; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * syr - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const wy = fy - y0;
      for (let x = 0; x < dw; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sxr - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const wx = fx - x0;
        const a = src[sp + y0 * sw + x0];
        const b = src[sp + y0 * sw + x1];
        const cc = src[sp + y1 * sw + x0];
        const d = src[sp + y1 * sw + x1];
        out[dp + y * dw + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (cc * (1 - wx) + d * wx) * wy;
      }
    }
  }
  return out;
}

export function extractWindow(src: Float32Array, channels: number, width: number, height: number, win: Window, tile: number): Float32Array {
  const out = new Float32Array(channels * tile * tile);
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < tile; y++) {
      const sy = Math.min(height - 1, win.y + y);
      for (let x = 0; x < tile; x++) {
        const sx = Math.min(width - 1, win.x + x);
        out[c * tile * tile + y * tile + x] = src[c * width * height + sy * width + sx];
      }
    }
  }
  return out;
}

export function pasteWindow(
  dst: Float32Array,
  channels: number,
  width: number,
  height: number,
  win: Window,
  idx: number,
  owner: Uint16Array,
  tileData: Float32Array,
  tile: number,
): void {
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < win.h; y++) {
      for (let x = 0; x < win.w; x++) {
        const i = (win.y + y) * width + (win.x + x);
        if (owner[i] !== idx) continue;
        dst[c * width * height + i] = tileData[c * tile * tile + y * tile + x];
      }
    }
  }
}
