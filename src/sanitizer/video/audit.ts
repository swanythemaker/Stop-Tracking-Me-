import { VideoAudit } from "../../wasm/sanitize_core.js";
import type { AuditSummary } from "../formats";
import { runRangeLoop } from "./rangeLoop";

export async function auditVideoBlob(
  blob: Blob,
  strict: boolean,
  signal?: AbortSignal,
  onBytes?: (done: number) => void,
): Promise<AuditSummary> {
  const audit = VideoAudit.open(blob.size, strict);
  try {
    await runRangeLoop(
      {
        nextRead: () => {
          const r = audit.nextRead();
          if (!r) return undefined;
          const req = { offset: r.offset, len: r.len };
          r.free();
          return req;
        },
        feed: (offset, bytes) => audit.feed(offset, bytes),
      },
      blob,
      signal,
      onBytes,
    );
    return JSON.parse(audit.finish()) as AuditSummary;
  } finally {
    audit.free();
  }
}

export async function auditVideoFile(file: File): Promise<AuditSummary> {
  try {
    return await auditVideoBlob(file, false);
  } catch (error) {
    return {
      kind: "unknown",
      issues: [error instanceof Error ? error.message : "Could not scan this file."],
      markers: [],
      byteLength: file.size,
      passed: false,
    };
  }
}
