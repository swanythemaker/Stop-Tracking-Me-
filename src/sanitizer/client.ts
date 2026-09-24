import type {
  AuditDone,
  SanitizeStage,
  WarmDone,
  WorkerMessage,
  WorkerRequest,
  WorkerSuccess,
} from "./types";

type Pending =
  | { kind: "sanitize"; resolve: (v: WorkerSuccess) => void; reject: (e: Error) => void; onProgress?: ProgressFn }
  | { kind: "audit"; resolve: (v: AuditDone) => void; reject: (e: Error) => void }
  | { kind: "warm"; resolve: (v: WarmDone) => void; reject: (e: Error) => void };

type ProgressFn = (stage: SanitizeStage, pct: number) => void;

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
    req: Omit<Extract<WorkerRequest, { kind: "sanitize" }>, "requestId" | "kind">,
    onProgress?: ProgressFn,
  ): Promise<WorkerSuccess> {
    const requestId = ++this.nextId;
    const full: Extract<WorkerRequest, { kind: "sanitize" }> = {
      ...req,
      kind: "sanitize",
      requestId,
    };
    return new Promise<WorkerSuccess>((resolve, reject) => {
      this.pending.set(requestId, { kind: "sanitize", resolve, reject, onProgress });
      this.worker.postMessage(full, [full.inputBuffer]);
    });
  }

  audit(
    req: Omit<Extract<WorkerRequest, { kind: "audit" }>, "requestId" | "kind">,
  ): Promise<AuditDone> {
    const requestId = ++this.nextId;
    const full: Extract<WorkerRequest, { kind: "audit" }> = {
      ...req,
      kind: "audit",
      requestId,
    };
    return new Promise<AuditDone>((resolve, reject) => {
      this.pending.set(requestId, { kind: "audit", resolve, reject });
      this.worker.postMessage(full, [full.inputBuffer]);
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
      if (p?.kind === "sanitize") p.onProgress?.(msg.stage, msg.pct);
      return;
    }

    const p = this.pending.get(msg.requestId);
    if (!p) return;
    this.pending.delete(msg.requestId);

    if (msg.type === "audit-done") {
      if (p.kind === "audit") p.resolve(msg);
      return;
    }

    if (msg.type === "warm-done") {
      if (p.kind === "warm") p.resolve(msg);
      return;
    }

    if (p.kind !== "sanitize") return;
    if (msg.ok) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error));
    }
  }
}
