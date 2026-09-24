import * as ort from "onnxruntime-web/wasm";
import { MODELS, type ModelId } from "../models/registry";
import { loadModel, type LoadProgress } from "../models/loader";

let configured = false;
const sessions = new Map<ModelId, ort.InferenceSession>();

function configureOrt(threads?: number): void {
  if (configured) return;
  configured = true;
  ort.env.wasm.wasmPaths = new URL("/ort/1.30.0/", self.location.origin).href;
  const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1;
  ort.env.wasm.numThreads = threads ?? (isolated ? Math.min(4, hw) : 1);
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

export async function getSession(
  id: ModelId,
  onProgress?: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<ort.InferenceSession> {
  const existing = sessions.get(id);
  if (existing) return existing;
  configureOrt();
  const bytes = await loadModel(MODELS[id], { signal, onProgress });
  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/memory|allocat/i.test(msg)) throw new Error("Not enough memory for this model in this browser.");
    throw error;
  }
  sessions.set(id, session);
  return session;
}

export async function releaseSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  for (const s of all) await s.release().catch(() => {});
}

export { ort };
