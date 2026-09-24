import { AutoProcessor, Florence2ForConditionalGeneration, RawImage, env } from "@huggingface/transformers";
import { FLORENCE, FLORENCE_CACHE_NAME, modelsBase } from "../models/registry";
import { florenceCache, verifiedFetch } from "../models/loader";
import { filterBoxes, type DetectBox, type DetectWorkerMessage, type DetectWorkerRequest } from "./types";

const PROMPTS = ["watermark", "text"];
const TASK = "<CAPTION_TO_PHRASE_GROUNDING>";

interface Scope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<DetectWorkerRequest>) => void | Promise<void>): void;
}
const scope = self as unknown as Scope;

type FlorenceProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
  construct_prompts(text: string): string[];
  post_process_generation(text: string, task: string, size: { width: number; height: number } | number[]): unknown;
};

type Loaded = {
  model: Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>;
  processor: FlorenceProcessor;
};

let loaded: Promise<Loaded> | null = null;
let cancelled = new Set<number>();

function post(msg: DetectWorkerMessage): void {
  scope.postMessage(msg);
}

function configure(): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${modelsBase()}/`;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = florenceCache;
  env.cacheKey = FLORENCE_CACHE_NAME;
  env.fetch = verifiedFetch as typeof fetch;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    const base = new URL("/ort/tjs/", self.location.origin).href;
    wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm` };
    const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  }
}

function load(requestId: number): Promise<Loaded> {
  if (loaded) return loaded;
  configure();
  const seen = new Map<string, number>();
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    seen.set(p.file, p.loaded ?? 0);
    let sum = 0;
    for (const v of seen.values()) sum += v;
    post({ type: "progress", requestId, stage: "model", loaded: Math.min(sum, FLORENCE.bytes), total: FLORENCE.bytes });
  };
  loaded = (async () => {
    const model = await Florence2ForConditionalGeneration.from_pretrained(FLORENCE.dir, {
      dtype: { embed_tokens: "int8", vision_encoder: "int8", encoder_model: "int8", decoder_model_merged: "int8" },
      device: "wasm",
      progress_callback: progress,
    });
    const processor = (await AutoProcessor.from_pretrained(FLORENCE.dir, {})) as FlorenceProcessor;
    return { model, processor };
  })();
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

async function detect(requestId: number, rgba: Uint8Array, width: number, height: number): Promise<DetectBox[]> {
  const { model, processor } = await load(requestId);
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const image = new RawImage(rgb, width, height, 3);
  const boxes: DetectBox[] = [];
  for (const [i, text] of PROMPTS.entries()) {
    if (cancelled.has(requestId)) throw new Error("Cancelled.");
    post({ type: "progress", requestId, stage: "detect", loaded: i, total: PROMPTS.length, detail: text });
    const prompts = processor.construct_prompts(`${TASK}${text}`);
    const inputs = await processor(image, prompts);
    const generated = await model.generate({ ...inputs, max_new_tokens: 128, num_beams: 1, do_sample: false });
    const decoded = processor.batch_decode(generated as never, { skip_special_tokens: false })[0];
    const result = processor.post_process_generation(decoded, TASK, [width, height]) as Record<string, { bboxes?: number[][]; labels?: string[] }>;
    const entry = result[TASK];
    for (const [j, bb] of (entry?.bboxes ?? []).entries()) {
      const [x1, y1, x2, y2] = bb;
      boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, label: entry?.labels?.[j] ?? text });
    }
  }
  return filterBoxes(boxes, width, height);
}

scope.addEventListener("message", async (event) => {
  const msg = event.data;
  if (msg.kind === "cancel") {
    cancelled.add(msg.requestId);
    return;
  }
  if (msg.kind === "release") {
    const l = loaded;
    loaded = null;
    cancelled = new Set();
    if (l) await l.then((x) => x.model.dispose()).catch(() => {});
    return;
  }
  const started = performance.now();
  try {
    const boxes = await detect(msg.requestId, new Uint8Array(msg.rgba), msg.width, msg.height);
    post({ type: "done", ok: true, requestId: msg.requestId, boxes, timingMs: performance.now() - started });
  } catch (error) {
    post({ type: "done", ok: false, requestId: msg.requestId, error: error instanceof Error ? error.message : "Detection failed." });
  } finally {
    cancelled.delete(msg.requestId);
  }
});
