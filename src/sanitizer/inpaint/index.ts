import type { InpaintSpec } from "../types";
import { getSession } from "./session";
import { inpaintMigan } from "./migan";
import type { LoadProgress } from "../models/loader";

export async function runInpaint(
  spec: InpaintSpec,
  rgba: Uint8Array,
  w: number,
  h: number,
  onModel: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const mask = new Uint8Array(spec.mask);
  if (spec.maskWidth !== w || spec.maskHeight !== h) throw new Error("Mask does not match the image size.");
  if (spec.engine === "lama") {
    const { inpaintLama } = await import("./lama");
    const session = await getSession("lama", onModel, signal);
    await inpaintLama(session, rgba, w, h, mask);
    return;
  }
  const session = await getSession("migan", onModel, signal);
  await inpaintMigan(session, rgba, w, h, mask);
}
