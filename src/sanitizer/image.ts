import { decodeAndTransform, stripAndAudit, auditBytes } from "../wasm/sanitize_core.js";
import { isSupportedImageType, MAX_IMAGE_BYTES, type AuditSummary, type SupportedFormat } from "./formats";
import type { AuditRequest, DecodeDone, DecodeOnlyRequest, ImageSuccess, SanitizeRequest, SanitizeStage } from "./types";
import type { LoadProgress } from "./models/loader";

import encodeJpeg from "@jsquash/jpeg/encode";
import encodePng from "@jsquash/png/encode";
import encodeWebp from "@jsquash/webp/encode";

type ImageProgress = (stage: SanitizeStage, pct: number, detail?: string) => void;

export function decodeOnly(request: DecodeOnlyRequest): DecodeDone {
  const opts = JSON.stringify({
    resizePct: clampPct(request.resizePct),
    rotate: request.rotate,
    flipH: request.flipH,
    flipV: request.flipV,
  });
  const decoded = decodeAndTransform(new Uint8Array(request.inputBuffer), opts);
  const width = decoded.width;
  const height = decoded.height;
  const rgba = decoded.takeRgba();
  return { type: "decode-done", requestId: request.requestId, rgba: rgba.slice().buffer, width, height };
}

export function auditImage(request: AuditRequest): AuditSummary {
  try {
    return JSON.parse(auditBytes(new Uint8Array(request.inputBuffer))) as AuditSummary;
  } catch {
    return {
      kind: "unknown",
      issues: ["Could not scan this file."],
      markers: [],
      byteLength: request.inputBuffer.byteLength,
      passed: false,
    };
  }
}

export async function sanitizeImage(request: SanitizeRequest, report: ImageProgress, signal?: AbortSignal): Promise<ImageSuccess> {
  report("read", 5);
  if (!isSupportedImageType(request.sourceType)) {
    throw new Error(`Unsupported input type "${request.sourceType || "unknown"}". Use PNG, JPEG or WebP.`);
  }
  if (request.inputBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`File is ${mb(request.inputBuffer.byteLength)}, over the ${mb(MAX_IMAGE_BYTES)} limit.`);
  }
  const inputByteLength = request.inputBuffer.byteLength;

  const outputType = request.ultraParanoid
    ? "image/png"
    : request.outputType === "same"
      ? request.sourceType
      : request.outputType;
  if (!isSupportedImageType(outputType)) {
    throw new Error(`Unsupported output type: ${outputType}`);
  }

  const tStart = performance.now();

  report("decode", 25);
  const opts = JSON.stringify({
    resizePct: clampPct(request.resizePct),
    rotate: request.rotate,
    flipH: request.flipH,
    flipV: request.flipV,
  });
  const decoded = decodeAndTransform(new Uint8Array(request.inputBuffer), opts);
  const width = decoded.width;
  const height = decoded.height;
  const origWidth = decoded.origWidth;
  const origHeight = decoded.origHeight;
  const rgba = decoded.takeRgba();
  const tDecoded = performance.now();

  let modelMs = 0;
  let inpaintMs = 0;
  let reduceMs = 0;
  if (request.inpaint) {
    const { runInpaint } = await import("./inpaint/index");
    const tModel = performance.now();
    let loaded = false;
    await runInpaint(
      request.inpaint,
      rgba,
      width,
      height,
      (p: LoadProgress) => {
        if (!loaded) report("model", 30, `${mb(p.loaded)} of ${mb(p.total)}`);
        if (p.loaded >= p.total && !loaded) {
          loaded = true;
          modelMs = performance.now() - tModel;
          report("inpaint", 45);
        }
      },
      signal,
    );
    inpaintMs = performance.now() - tModel - modelMs;
  }
  if (request.reduce) {
    const { reduceImage } = await import("./reduce/pipeline");
    const tReduce = performance.now();
    report("reduce", 50);
    await reduceImage(rgba, width, height, (p: LoadProgress) => report("model", 50, `${mb(p.loaded)} of ${mb(p.total)}`), signal);
    reduceMs = performance.now() - tReduce;
  }
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);

  report("encode", 55);
  const encoded = await encodeWithWasm(outputType, imageData, clampQuality(outputType, request.quality));
  const tEncoded = performance.now();

  report("strip", 80);
  const result = stripAndAudit(new Uint8Array(encoded), outputType);
  const tStripped = performance.now();

  report("audit", 95);
  const outputAudit = JSON.parse(result.auditJson) as AuditSummary;
  if (!result.passed) {
    throw new Error(`Fail-closed audit rejection: ${outputAudit.issues.join("; ") || "unknown issue"}`);
  }

  const outBytes = result.takeBytes();
  const outputBuffer = outBytes.slice().buffer;

  return {
    type: "done",
    ok: true,
    media: "image",
    requestId: request.requestId,
    outputType,
    outputAudit,
    outputBuffer,
    inputByteLength,
    width,
    height,
    origWidth,
    origHeight,
    inpainted: !!request.inpaint,
    reduced: !!request.reduce,
    timing: {
      decodeMs: tDecoded - tStart,
      modelMs,
      inpaintMs,
      reduceMs,
      encodeMs: tEncoded - tDecoded - modelMs - inpaintMs - reduceMs,
      stripMs: tStripped - tEncoded,
      totalMs: tStripped - tStart,
    },
  };
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 100;
  return Math.min(100, Math.max(10, Math.round(pct)));
}

function clampQuality(type: string, quality: number): number | undefined {
  if (type !== "image/jpeg" && type !== "image/webp") {
    return undefined;
  }
  return Math.min(1, Math.max(0.6, quality));
}

async function encodeWithWasm(outputType: SupportedFormat, imageData: ImageData, quality?: number): Promise<ArrayBuffer> {
  if (outputType === "image/png") {
    return encodePng(imageData);
  }
  if (outputType === "image/jpeg") {
    return encodeJpeg(imageData, { quality: Math.round((quality ?? 0.92) * 100) });
  }
  return encodeWebp(imageData, { quality: Math.round((quality ?? 0.92) * 100) });
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
