import type { LoadProgress } from "../models/loader";
import { getSession } from "../inpaint/session";
import { resampleBilinear } from "../inpaint/tiles";
import { taesdRoundTrip } from "./taesd";

const RESAMPLE_PCT = 90;
const REQUANT_BITS = 6;

export function requantize(v: number, bits = REQUANT_BITS): number {
  const levels = (1 << bits) - 1;
  const clamped = Math.max(0, Math.min(255, v));
  return Math.round((Math.round((clamped * levels) / 255) * 255) / levels);
}

export async function reduceImage(
  rgba: Uint8Array,
  w: number,
  h: number,
  onModel: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const enc = await getSession("taesdEnc", onModel, signal);
  const dec = await getSession("taesdDec", onModel, signal);
  const plane = w * h;
  const rgb = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    rgb[i] = rgba[i * 4] / 255;
    rgb[plane + i] = rgba[i * 4 + 1] / 255;
    rgb[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }
  const round = await taesdRoundTrip(enc, dec, rgb, w, h);
  const dw = Math.max(1, Math.round((w * RESAMPLE_PCT) / 100));
  const dh = Math.max(1, Math.round((h * RESAMPLE_PCT) / 100));
  const small = resampleBilinear(round, 3, w, h, dw, dh);
  const back = resampleBilinear(small, 3, dw, dh, w, h);
  for (let i = 0; i < plane; i++) {
    rgba[i * 4] = requantize(back[i] * 255);
    rgba[i * 4 + 1] = requantize(back[plane + i] * 255);
    rgba[i * 4 + 2] = requantize(back[2 * plane + i] * 255);
  }
}
