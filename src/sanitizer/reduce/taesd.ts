import { ort } from "../inpaint/session";
import { extractWindow, ownerMap, pasteWindow, planTiles } from "../inpaint/tiles";

const TILE = 512;
const OVERLAP = 64;

export async function taesdRoundTrip(
  enc: ort.InferenceSession,
  dec: ort.InferenceSession,
  rgb: Float32Array,
  w: number,
  h: number,
): Promise<Float32Array> {
  const pw = Math.ceil(w / 8) * 8;
  const ph = Math.ceil(h / 8) * 8;
  const padded = new Float32Array(3 * pw * ph);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < ph; y++) {
      const sy = Math.min(h - 1, y);
      for (let x = 0; x < pw; x++) {
        padded[c * pw * ph + y * pw + x] = rgb[c * w * h + sy * w + Math.min(w - 1, x)];
      }
    }
  }
  const windows = planTiles(pw, ph, TILE, OVERLAP);
  const owner = ownerMap(windows, pw, ph);
  const out = new Float32Array(padded.length);
  for (let idx = 0; idx < windows.length; idx++) {
    const win = windows[idx];
    const tile = extractWindow(padded, 3, pw, ph, win, TILE);
    const latent = await enc.run({ [enc.inputNames[0]]: new ort.Tensor("float32", tile, [1, 3, TILE, TILE]) });
    const z = latent[enc.outputNames[0]];
    const decoded = await dec.run({ [dec.inputNames[0]]: z });
    const img = decoded[dec.outputNames[0]].data as Float32Array;
    pasteWindow(out, 3, pw, ph, win, idx, owner, img, TILE);
  }
  if (pw === w && ph === h) return out;
  const cropped = new Float32Array(3 * w * h);
  for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) cropped.set(out.subarray(c * pw * ph + y * pw, c * pw * ph + y * pw + w), c * w * h + y * w);
  return cropped;
}
