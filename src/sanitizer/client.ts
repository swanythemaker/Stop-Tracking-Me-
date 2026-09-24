import type {
  AuditDone,
  AuditRequest,
  AuditVideoRequest,
  DecodeDone,
  DecodeOnlyRequest,
  ImageSuccess,
  SanitizeRequest,
  Stage,
  VideoSanitizeRequest,
  VideoSuccess,
  WarmDone,
  WorkerMessage,
  WorkerSuccess,
} from "./types";

type ProgressFn = (stage: Stage, pct: number, detail?: string, etaS?: number) => void;

type Pending =
  | { kind: "sanitize"; resolve: (v: WorkerSuccess) => void; reject: (e: Error) => void; onProgress?: ProgressFn }
  | { kind: "audit"; resolve: (v: AuditDone) => void; reject: (e: Error) => void }
  | { kind: "decode"; resolve: (v: DecodeDone) => void; reject: (e: Error) => void }
  | { kind: "warm"; resolve: (v: WarmDone) => void; reject: (e: Error) => void };

export class SanitizeClient {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) =>
      this.onMessage(event.data),
    );
  }

  sanitize(
    req: Omit<SanitizeRequest, "requestId" | "kind">,
    onProgress?: ProgressFn,
  ): Promise<ImageSuccess> & { requestId: number } {
    const requestId = ++this.nextId;
    const full: SanitizeRequest = { ...req, kind: "sanitize", requestId };
    const transfer: Transferable[] = [full.inputBuffer];
    if (full.inpaint) transfer.push(full.inpaint.mask);
    const promise = new Promise<WorkerSuccess>((resolve, reject) => {
      this.pending.set(requestId, { kind: "sanitize", resolve, reject, onProgress });
      this.worker.postMessage(full, transfer);
    }).then((res) => {
      if (res.media !== "image") throw new Error("Unexpected video result.");
      return res;
    });
    return Object.assign(promise, { requestId });
  }

  sanitizeVideo(
    req: Omit<VideoSanitizeRequest, "requestId" | "kind">,
    onProgress?: ProgressFn,
  ): { requestId: number; result: Promise<VideoSuccess> } {
    const requestId = ++this.nextId;
    const full: VideoSanitizeRequest = { ...req, kind: "sanitize-video", requestId };
    const result = new Promise<WorkerSuccess>((resolve, reject) => {
      this.pending.set(requestId, { kind: "sanitize", resolve, reject, onProgress });
      this.worker.postMessage(full);
    }).then((res) => {
      if (res.media !== "video") throw new Error("Unexpected image result.");
      return res;
    });
    return { requestId, result };
  }

  audit(req: Omit<AuditRequest, "requestId" | "kind">): Promise<AuditDone> {
    const requestId = ++this.nextId;
    const full: AuditRequest = { ...req, kind: "audit", requestId };
    return new Promise<AuditDone>((resolve, reject) => {
      this.pending.set(requestId, { kind: "audit", resolve, reject });
      this.worker.postMessage(full, [full.inputBuffer]);
    });
  }

  auditVideo(file: File): Promise<AuditDone> {
    const requestId = ++this.nextId;
    const full: AuditVideoRequest = { kind: "audit-video", requestId, file };
    return new Promise<AuditDone>((resolve, reject) => {
      this.pending.set(requestId, { kind: "audit", resolve, reject });
      this.worker.postMessage(full);
    });
  }

  cancel(requestId: number): void {
    this.worker.postMessage({ kind: "cancel", requestId });
  }

  decodeOnly(req: Omit<DecodeOnlyRequest, "requestId" | "kind">): Promise<DecodeDone> {
    const requestId = ++this.nextId;
    const full: DecodeOnlyRequest = { ...req, kind: "decode-only", requestId };
    return new Promise<DecodeDone>((resolve, reject) => {
      this.pending.set(requestId, { kind: "decode", resolve, reject });
      this.worker.postMessage(full, [full.inputBuffer]);
    });
  }

  releaseModels(): void {
    this.worker.postMessage({ kind: "release-models", requestId: ++this.nextId });
  }

  deleteModels(): Promise<void> {
    const requestId = ++this.nextId;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { kind: "warm", resolve: () => resolve(), reject });
      this.worker.postMessage({ kind: "delete-models", requestId });
    });
  }

  warm(): Promise<WarmDone> {
    const requestId = ++this.nextId;
    return new Promise<WarmDone>((resolve, reject) => {
      this.pending.set(requestId, { kind: "warm", resolve, reject });
      this.worker.postMessage({ kind: "warm", requestId });
    });
  }

  private onMessage(msg: WorkerMessage): void {
    if (msg.type === "progress") {
      const p = this.pending.get(msg.requestId);
      if (p?.kind === "sanitize") p.onProgress?.(msg.stage, msg.pct, msg.detail, msg.etaS);
      return;
    }

    const p = this.pending.get(msg.requestId);
    if (!p) return;
    this.pending.delete(msg.requestId);

    if (msg.type === "audit-done") {
      if (p.kind === "audit") p.resolve(msg);
      return;
    }

    if (msg.type === "decode-done") {
      if (p.kind === "decode") p.resolve(msg);
      return;
    }

    if (msg.type === "warm-done" || msg.type === "models-deleted") {
      if (p.kind === "warm") p.resolve({ type: "warm-done", requestId: msg.requestId });
      return;
    }

    if (msg.ok) {
      if (p.kind === "sanitize") p.resolve(msg);
    } else {
      p.reject(new Error(msg.error));
    }
  }
}
