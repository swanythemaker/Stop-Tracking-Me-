import { cropForMask, extractMask, extractRgb, pasteMasked } from "./crop";
import { ort } from "./session";
import { resampleBilinear } from "./tiles";

const SIDE = 512;

function toFloat(u8: Uint8Array): Float32Array {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = u8[i];
  return out;
}

function toBytes(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i])));
  return out;
}

export async function inpaintMigan(session: ort.InferenceSession, rgba: Uint8Array, w: number, h: number, mask: Uint8Array): Promise<void> {
  const r = cropForMask(mask, w, h);
  if (!r) return;
  const rgb = extractRgb(rgba, w, r);
  const m = extractMask(mask, w, r);
  const image = toBytes(resampleBilinear(toFloat(rgb), 3, r.cw, r.ch, SIDE, SIDE));
  const holeF = resampleBilinear(toFloat(m), 1, r.cw, r.ch, SIDE, SIDE);
  const keep = new Uint8Array(holeF.length);
  for (let i = 0; i < holeF.length; i++) keep[i] = holeF[i] >= 128 ? 0 : 255;
  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: new ort.Tensor("uint8", image, [1, 3, SIDE, SIDE]),
    [session.inputNames[1]]: new ort.Tensor("uint8", keep, [1, 1, SIDE, SIDE]),
  };
  const out = await session.run(feeds);
  const result = out[session.outputNames[0]].data as Uint8Array;
  const back = toBytes(resampleBilinear(toFloat(result), 3, SIDE, SIDE, r.cw, r.ch));
  pasteMasked(rgba, w, r, back, mask);
}
