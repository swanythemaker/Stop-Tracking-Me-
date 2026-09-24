import { cropForMask, extractMask, extractRgb, pasteMasked } from "./crop";
import { ort } from "./session";
import { extractWindow, ownerMap, pasteWindow, planTiles, resampleBilinear } from "./tiles";

const TILE = 512;
const OVERLAP = 64;

function toFloat(rgb: Uint8Array): Float32Array {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = rgb[i] / 255;
  return out;
}

function toBytes(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i])));
  return out;
}

async function runTile(session: ort.InferenceSession, image: Float32Array, mask: Float32Array): Promise<Float32Array> {
  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: new ort.Tensor("float32", image, [1, 3, TILE, TILE]),
    [session.inputNames[1]]: new ort.Tensor("float32", mask, [1, 1, TILE, TILE]),
  };
  const out = await session.run(feeds);
  const data = out[session.outputNames[0]].data as Float32Array;
  return data;
}

export async function inpaintLama(session: ort.InferenceSession, rgba: Uint8Array, w: number, h: number, mask: Uint8Array): Promise<void> {
  const r = cropForMask(mask, w, h);
  if (!r) return;
  const rgb = toFloat(extractRgb(rgba, w, r));
  const m8 = extractMask(mask, w, r);
  const m = new Float32Array(m8.length);
  for (let i = 0; i < m8.length; i++) m[i] = m8[i] >= 128 ? 1 : 0;

  let filled: Float32Array;
  if (r.cw <= TILE && r.ch <= TILE) {
    const img = resampleBilinear(rgb, 3, r.cw, r.ch, TILE, TILE);
    const msk = resampleBilinear(m, 1, r.cw, r.ch, TILE, TILE).map((v) => (v > 0 ? 1 : 0));
    const out = await runTile(session, img, msk);
    filled = resampleBilinear(out, 3, TILE, TILE, r.cw, r.ch);
  } else {
    const coarseImg = resampleBilinear(rgb, 3, r.cw, r.ch, TILE, TILE);
    const coarseMask = resampleBilinear(m, 1, r.cw, r.ch, TILE, TILE).map((v) => (v > 0 ? 1 : 0));
    const coarseOut = resampleBilinear(await runTile(session, coarseImg, coarseMask), 3, TILE, TILE, r.cw, r.ch);
    const work = new Float32Array(rgb);
    const plane = r.cw * r.ch;
    for (let i = 0; i < plane; i++) {
      if (m[i] > 0) for (let c = 0; c < 3; c++) work[c * plane + i] = coarseOut[c * plane + i];
    }
    const windows = planTiles(r.cw, r.ch, TILE, OVERLAP);
    const owner = ownerMap(windows, r.cw, r.ch);
    filled = new Float32Array(work);
    for (let idx = 0; idx < windows.length; idx++) {
      const win = windows[idx];
      const tileMask = extractWindow(m, 1, r.cw, r.ch, win, TILE);
      let any = false;
      for (let i = 0; i < tileMask.length && !any; i++) any = tileMask[i] > 0;
      if (!any) continue;
      const tileImg = extractWindow(work, 3, r.cw, r.ch, win, TILE);
      const out = await runTile(session, tileImg, tileMask);
      pasteWindow(filled, 3, r.cw, r.ch, win, idx, owner, out, TILE);
    }
  }
  pasteMasked(rgba, w, r, toBytes(filled), mask);
}
