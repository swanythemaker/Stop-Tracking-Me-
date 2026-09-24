import init from "../wasm/sanitize_core.js";
import { auditImage, decodeOnly, sanitizeImage } from "./image";
import type { Stage, WorkerFailure, WorkerProgress, WorkerRequest } from "./types";

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>): void;
}

const scope = self as unknown as WorkerScope;

let wasmReady: Promise<unknown> | null = null;
export function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = init();
  }
  return wasmReady;
}

const controllers = new Map<number, AbortController>();

function report(requestId: number, stage: Stage, pct: number, detail?: string, etaS?: number): void {
  const progress: WorkerProgress = { type: "progress", requestId, stage, pct };
  if (detail !== undefined) progress.detail = detail;
  if (etaS !== undefined) progress.etaS = etaS;
  scope.postMessage(progress);
}

function fail(requestId: number, error: unknown): void {
  const response: WorkerFailure = {
    type: "done",
    ok: false,
    requestId,
    error: error instanceof Error ? error.message : "Unknown worker error",
  };
  scope.postMessage(response);
}

scope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  if (payload.kind === "cancel") {
    controllers.get(payload.requestId)?.abort();
    return;
  }
  if (payload.kind === "decode-only") {
    try {
      await ensureWasm();
      const result = decodeOnly(payload);
      scope.postMessage(result, [result.rgba]);
    } catch (error) {
      fail(payload.requestId, error);
    }
    return;
  }
  if (payload.kind === "release-models") {
    const { releaseSessions } = await import("./inpaint/session");
    await releaseSessions();
    return;
  }
  if (payload.kind === "delete-models") {
    const { releaseSessions } = await import("./inpaint/session");
    const { deleteAllModels } = await import("./models/loader");
    await releaseSessions();
    await deleteAllModels();
    scope.postMessage({ type: "models-deleted", requestId: payload.requestId });
    return;
  }
  if (payload.kind === "warm") {
    await ensureWasm();
    scope.postMessage({ type: "warm-done", requestId: payload.requestId });
    return;
  }
  if (payload.kind === "audit") {
    await ensureWasm();
    scope.postMessage({ type: "audit-done", requestId: payload.requestId, audit: auditImage(payload) });
    return;
  }
  if (payload.kind === "audit-video") {
    try {
      await ensureWasm();
      const { auditVideoFile } = await import("./video/audit");
      const audit = await auditVideoFile(payload.file);
      scope.postMessage({ type: "audit-done", requestId: payload.requestId, audit });
    } catch (error) {
      fail(payload.requestId, error);
    }
    return;
  }
  if (payload.kind === "sanitize-video") {
    const controller = new AbortController();
    controllers.set(payload.requestId, controller);
    try {
      await ensureWasm();
      const { sanitizeVideo } = await import("./video/sanitize");
      const result = await sanitizeVideo(payload, controller.signal, (stage, pct, detail, etaS) =>
        report(payload.requestId, stage, pct, detail, etaS),
      );
      scope.postMessage(result);
    } catch (error) {
      fail(payload.requestId, error);
    } finally {
      controllers.delete(payload.requestId);
    }
    return;
  }
  const controller = new AbortController();
  controllers.set(payload.requestId, controller);
  try {
    await ensureWasm();
    const result = await sanitizeImage(
      payload,
      (stage, pct, detail) => report(payload.requestId, stage, pct, detail),
      controller.signal,
    );
    scope.postMessage(result, [result.outputBuffer]);
  } catch (error) {
    fail(payload.requestId, error);
  } finally {
    controllers.delete(payload.requestId);
  }
});
