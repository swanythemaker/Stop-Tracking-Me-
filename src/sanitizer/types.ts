import type { AuditSummary, SupportedFormat } from "./formats";

export type SanitizeRequest = {
  kind: "sanitize";
  requestId: number;
  sourceType: string;
  inputBuffer: ArrayBuffer;
  outputType: SupportedFormat | "same";
  quality: number;
  ultraParanoid: boolean;
  resizePct: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
};

export type AuditRequest = {
  kind: "audit";
  requestId: number;
  sourceType: string;
  inputBuffer: ArrayBuffer;
};

type WarmRequest = {
  kind: "warm";
  requestId: number;
};

export type WorkerRequest = SanitizeRequest | AuditRequest | WarmRequest;

export type SanitizeStage = "read" | "decode" | "encode" | "strip" | "audit";

export type WorkerProgress = {
  type: "progress";
  requestId: number;
  stage: SanitizeStage;
  pct: number;
};

type SanitizeTiming = {
  decodeMs: number;
  encodeMs: number;
  stripMs: number;
  totalMs: number;
};

export type WorkerSuccess = {
  type: "done";
  ok: true;
  requestId: number;
  outputType: SupportedFormat;
  outputAudit: AuditSummary;
  outputBuffer: ArrayBuffer;
  inputByteLength: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  timing: SanitizeTiming;
};

type WorkerFailure = {
  type: "done";
  ok: false;
  requestId: number;
  error: string;
};

export type AuditDone = {
  type: "audit-done";
  requestId: number;
  audit: AuditSummary;
};

export type WarmDone = {
  type: "warm-done";
  requestId: number;
};

export type WorkerResponse = WorkerSuccess | WorkerFailure | AuditDone | WarmDone;
export type WorkerMessage = WorkerProgress | WorkerResponse;
