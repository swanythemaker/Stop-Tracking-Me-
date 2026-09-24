export type DetectBox = { x: number; y: number; w: number; h: number; label: string };

type DetectRequest = {
  kind: "detect";
  requestId: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
};

type DetectRelease = { kind: "release"; requestId: number };
type DetectCancel = { kind: "cancel"; requestId: number };
export type DetectWorkerRequest = DetectRequest | DetectRelease | DetectCancel;

type DetectProgress = { type: "progress"; requestId: number; stage: "model" | "detect"; loaded: number; total: number; detail?: string };
type DetectDone = { type: "done"; ok: true; requestId: number; boxes: DetectBox[]; timingMs: number };
type DetectFail = { type: "done"; ok: false; requestId: number; error: string };
export type DetectWorkerMessage = DetectProgress | DetectDone | DetectFail;

export function filterBoxes(boxes: DetectBox[], width: number, height: number): DetectBox[] {
  const area = width * height;
  const kept: DetectBox[] = [];
  for (const b of boxes) {
    const a = b.w * b.h;
    if (a > 0.25 * area || a < 0.0005 * area) continue;
    if (kept.some((k) => iou(k, b) > 0.7)) continue;
    kept.push({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), w: Math.round(b.w), h: Math.round(b.h), label: b.label });
  }
  return kept;
}

export function iou(a: DetectBox, b: DetectBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
