import type { DetectBox, DetectWorkerMessage } from "./types";

type DetectProgressFn = (stage: "model" | "detect", loaded: number, total: number, detail?: string) => void;

type Pending = { resolve: (boxes: DetectBox[]) => void; reject: (e: Error) => void; onProgress?: DetectProgressFn };

export class DetectClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private current: number | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./florence.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (ev: MessageEvent<DetectWorkerMessage>) => this.onMessage(ev.data));
    return this.worker;
  }

  detect(rgba: ArrayBuffer, width: number, height: number, onProgress?: DetectProgressFn): Promise<DetectBox[]> {
    const requestId = ++this.nextId;
    this.current = requestId;
    return new Promise<DetectBox[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      this.ensure().postMessage({ kind: "detect", requestId, rgba, width, height }, [rgba]);
    });
  }

  cancel(): void {
    if (this.current !== null) this.worker?.postMessage({ kind: "cancel", requestId: this.current });
  }

  release(): void {
    this.worker?.postMessage({ kind: "release", requestId: ++this.nextId });
  }

  private onMessage(msg: DetectWorkerMessage): void {
    const p = this.pending.get(msg.requestId);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.stage, msg.loaded, msg.total, msg.detail);
      return;
    }
    this.pending.delete(msg.requestId);
    if (this.current === msg.requestId) this.current = null;
    if (msg.ok) p.resolve(msg.boxes);
    else p.reject(new Error(msg.error));
  }
}
