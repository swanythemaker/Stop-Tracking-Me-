import { PlaneScratch } from "../../wasm/sanitize_core.js";

export type PlaneOps = {
  resizePct: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
};

const PLANE_FORMATS = new Set(["I420", "NV12", "BGRX", "BGRA", "RGBX", "RGBA"]);

function planeFormatSupported(format: string | null): boolean {
  return format !== null && PLANE_FORMATS.has(format);
}

function bytesFor(format: string, w: number, h: number): number {
  if (format === "I420" || format === "NV12") return w * h + 2 * (Math.ceil(w / 2) * Math.ceil(h / 2));
  return w * h * 4;
}

function layoutFor(format: string, w: number, h: number): PlaneLayout[] {
  if (format === "I420") {
    const cw = Math.ceil(w / 2);
    const ch = Math.ceil(h / 2);
    return [
      { offset: 0, stride: w },
      { offset: w * h, stride: cw },
      { offset: w * h + cw * ch, stride: cw },
    ];
  }
  if (format === "NV12") {
    return [
      { offset: 0, stride: w },
      { offset: w * h, stride: w + (w % 2) },
    ];
  }
  return [{ offset: 0, stride: w * 4 }];
}

export class PlanePipe {
  private scratch: PlaneScratch;
  private memory: WebAssembly.Memory;

  constructor(memory: WebAssembly.Memory, maxWidth: number, maxHeight: number) {
    this.memory = memory;
    this.scratch = new PlaneScratch(maxWidth * maxHeight * 4);
  }

  async transform(frame: VideoFrame, ops: PlaneOps): Promise<VideoFrame> {
    const format = frame.format;
    if (!planeFormatSupported(format)) {
      return this.canvasFallback(frame, ops);
    }
    const rect = frame.visibleRect ?? new DOMRectReadOnly(0, 0, frame.codedWidth, frame.codedHeight);
    const w = rect.width;
    const h = rect.height;
    const needed = bytesFor(format!, w, h);
    if (needed > this.scratch.inputLen()) throw new Error("Frame larger than the reserved buffer.");
    const view = new Uint8Array(this.memory.buffer, this.scratch.inputPtr(), needed);
    await frame.copyTo(view, { rect, layout: layoutFor(format!, w, h) });
    const out = this.scratch.transform(format!, w, h, JSON.stringify(ops));
    const outView = new Uint8Array(this.memory.buffer, out.ptr, out.len);
    const result = new VideoFrame(outView, {
      format: "I420",
      codedWidth: out.width,
      codedHeight: out.height,
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
      colorSpace: { matrix: "bt709", primaries: "bt709", transfer: "bt709", fullRange: false },
    });
    out.free();
    return result;
  }

  private canvasFallback(frame: VideoFrame, ops: PlaneOps): VideoFrame {
    const srcW = frame.displayWidth;
    const srcH = frame.displayHeight;
    const pct = Math.min(100, Math.max(10, ops.resizePct)) / 100;
    const swap = ops.rotate % 180 !== 0;
    const scaledW = Math.max(2, Math.round(srcW * pct)) & ~1;
    const scaledH = Math.max(2, Math.round(srcH * pct)) & ~1;
    const outW = swap ? scaledH : scaledW;
    const outH = swap ? scaledW : scaledH;
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((ops.rotate * Math.PI) / 180);
    ctx.scale(ops.flipH ? -1 : 1, ops.flipV ? -1 : 1);
    ctx.drawImage(frame, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    return new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
  }

  close(): void {
    this.scratch.free();
  }
}
