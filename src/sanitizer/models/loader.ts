import { CACHE_NAME, FLORENCE, FLORENCE_CACHE_NAME, modelUrl, type FileSpec, type ModelSpec } from "./registry";

class ModelIntegrityError extends Error {
  constructor(message = "Model download failed its integrity check. Nothing was run.") {
    super(message);
    this.name = "ModelIntegrityError";
  }
}

export type LoadProgress = { loaded: number; total: number };
type LoadOptions = { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void };

const PROGRESS_MS = 250;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function openCache(name: string): Promise<Cache | null> {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function readStream(res: Response, total: number, opts: LoadOptions): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let last = 0;
  for (;;) {
    if (opts.signal?.aborted) {
      await reader.cancel();
      throw new Error("Download cancelled.");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - last > PROGRESS_MS) {
      last = now;
      opts.onProgress?.({ loaded, total });
    }
  }
  opts.onProgress?.({ loaded, total });
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

async function verified(bytes: ArrayBuffer, expected: string, cache: Cache | null, url: string): Promise<ArrayBuffer> {
  if (!expected) throw new ModelIntegrityError("This model has no pinned hash in this build.");
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    await cache?.delete(url).catch(() => {});
    throw new ModelIntegrityError();
  }
  return bytes;
}

async function loadFile(url: string, spec: FileSpec, cacheName: string, opts: LoadOptions = {}): Promise<ArrayBuffer> {
  const cache = await openCache(cacheName);
  const hit = await cache?.match(url);
  if (hit) {
    opts.onProgress?.({ loaded: spec.bytes, total: spec.bytes });
    return verified(await hit.arrayBuffer(), spec.sha256, cache, url);
  }
  const res = await fetch(url, { signal: opts.signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Model download failed (${res.status}).`);
  const bytes = await readStream(res, spec.bytes, opts);
  const ok = await verified(bytes, spec.sha256, cache, url);
  await cache?.put(url, new Response(ok.slice(0), { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  return ok;
}

export function loadModel(spec: ModelSpec, opts: LoadOptions = {}): Promise<ArrayBuffer> {
  return loadFile(modelUrl(spec.path), spec, CACHE_NAME, opts);
}

function florenceSpec(url: string): FileSpec | "runtime" | null {
  const path = url.startsWith("http") ? new URL(url).pathname : url;
  if (path.startsWith("/ort/")) return "runtime";
  const dirUrl = modelUrl(FLORENCE.dir);
  const dirPath = dirUrl.startsWith("http") ? new URL(dirUrl).pathname : dirUrl;
  if (!path.startsWith(`${dirPath}/`)) return null;
  return FLORENCE.files[path.slice(dirPath.length + 1)] ?? null;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export async function verifiedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  const spec = florenceSpec(url);
  if (!spec) throw new ModelIntegrityError(`Blocked request outside the pinned model set: ${url}`);
  const res = await fetch(input, { ...init, cache: "no-store" });
  if (!res.ok || spec === "runtime") return res;
  const bytes = await res.arrayBuffer();
  await verified(bytes, spec.sha256, null, url);
  return new Response(bytes, { status: 200, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream" } });
}

export const florenceCache = {
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const url = urlOf(request);
    const spec = florenceSpec(url);
    const cache = await openCache(FLORENCE_CACHE_NAME);
    const hit = await cache?.match(url);
    if (!hit || !spec) return undefined;
    if (spec === "runtime") return hit;
    const bytes = await hit.arrayBuffer();
    try {
      await verified(bytes, spec.sha256, cache, url);
    } catch {
      return undefined;
    }
    return new Response(bytes, { status: 200, headers: hit.headers });
  },
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const cache = await openCache(FLORENCE_CACHE_NAME);
    await cache?.put(urlOf(request), response).catch(() => {});
  },
};

export async function deleteAllModels(): Promise<void> {
  for (const name of [CACHE_NAME, FLORENCE_CACHE_NAME]) {
    await caches.delete(name).catch(() => {});
  }
}

export async function storedModelBytes(): Promise<number> {
  let total = 0;
  for (const name of [CACHE_NAME, FLORENCE_CACHE_NAME]) {
    const cache = await openCache(name);
    if (!cache) continue;
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (res) total += (await res.arrayBuffer()).byteLength;
    }
  }
  return total;
}
