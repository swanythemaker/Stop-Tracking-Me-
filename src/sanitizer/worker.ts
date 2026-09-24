import init, {
  decodeAndTransform,
  stripAndAudit,
  auditBytes,
} from "../wasm/sanitize_core.js";
import {
  isSupportedImageType,
  type AuditSummary,
  type SupportedFormat,
} from "./formats";
import type {
  AuditRequest,
  SanitizeRequest,
  SanitizeStage,
  WorkerProgress,
  WorkerRequest,
  WorkerResponse,
} from "./types";

import encodeJpeg from "@jsquash/jpeg/encode";
import encodePng from "@jsquash/png/encode";
import encodeWebp from "@jsquash/webp/encode";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void;
}

const scope = self as unknown as WorkerScope;

let wasmReady: Promise<unknown> | null = null;
function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = init();
  }
  return wasmReady;
}

scope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  if (payload.kind === "warm") {
    await ensureWasm();
    scope.postMessage({ type: "warm-done", requestId: payload.requestId });
    return;
  }
  if (payload.kind === "audit") {
    await handleAudit(payload);
    return;
  }
  try {
    const result = await sanitize(payload);
    scope.postMessage(result, [result.outputBuffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: "done",
      ok: false,
      requestId: payload.requestId,
      error: error instanceof Error ? error.message : "Unknown worker error",
    };
    scope.postMessage(response);
  }
});

async function handleAudit(request: AuditRequest): Promise<void> {
  try {
    await ensureWasm();
    const json = auditBytes(new Uint8Array(request.inputBuffer));
    const audit = JSON.parse(json) as AuditSummary;
    scope.postMessage({ type: "audit-done", requestId: request.requestId, audit });
  } catch {
    const audit: AuditSummary = {
      kind: "unknown",
      issues: ["Could not scan this file."],
      markers: [],
      byteLength: request.inputBuffer.byteLength,
      passed: false,
    };
    scope.postMessage({ type: "audit-done", requestId: request.requestId, audit });
  }
}

function report(requestId: number, stage: SanitizeStage, pct: number): void {
  const progress: WorkerProgress = { type: "progress", requestId, stage, pct };
  scope.postMessage(progress);
}

async function sanitize(
  request: SanitizeRequest,
): Promise<Extract<WorkerResponse, { ok: true }>> {
  report(request.requestId, "read", 5);
  if (!isSupportedImageType(request.sourceType)) {
    throw new Error(
      `Unsupported input type "${request.sourceType || "unknown"}". Use PNG, JPEG or WebP.`,
    );
  }
  if (request.inputBuffer.byteLength > MAX_INPUT_BYTES) {
    throw new Error(
      `File is ${mb(request.inputBuffer.byteLength)}, over the ${mb(MAX_INPUT_BYTES)} limit.`,
    );
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

  await ensureWasm();
  const tStart = performance.now();

  report(request.requestId, "decode", 25);
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
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  const tDecoded = performance.now();

  report(request.requestId, "encode", 55);
  const encoded = await encodeWithWasm(
    outputType,
    imageData,
    clampQuality(outputType, request.quality),
  );
  const tEncoded = performance.now();

  report(request.requestId, "strip", 80);
  const result = stripAndAudit(new Uint8Array(encoded), outputType);
  const tStripped = performance.now();

  report(request.requestId, "audit", 95);
  const outputAudit = JSON.parse(result.auditJson) as AuditSummary;
  if (!result.passed) {
    throw new Error(
      `Fail-closed audit rejection: ${outputAudit.issues.join("; ") || "unknown issue"}`,
    );
  }

  const outBytes = result.takeBytes();
  const outputBuffer = outBytes.slice().buffer;

  return {
    type: "done",
    ok: true,
    requestId: request.requestId,
    outputType,
    outputAudit,
    outputBuffer,
    inputByteLength,
    width,
    height,
    origWidth,
    origHeight,
    timing: {
      decodeMs: tDecoded - tStart,
      encodeMs: tEncoded - tDecoded,
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

async function encodeWithWasm(
  outputType: SupportedFormat,
  imageData: ImageData,
  quality?: number,
): Promise<ArrayBuffer> {
  if (outputType === "image/png") {
    return encodePng(imageData);
  }
  if (outputType === "image/jpeg") {
    return encodeJpeg(imageData, {
      quality: Math.round((quality ?? 0.92) * 100),
    });
  }
  return encodeWebp(imageData, {
    quality: Math.round((quality ?? 0.92) * 100),
  });
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
