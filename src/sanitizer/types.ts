import type { AuditSummary, SupportedFormat } from "./formats";
import type { AudioPick, EncoderPick, VideoContainer } from "./video/encoderPick";

export type { AudioPick, EncoderPick, VideoContainer };

export type OutputContainer = VideoContainer | "video/x-matroska";

export type VideoEngine = "reencode" | "remux";

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

export type VideoSanitizeRequest = {
  kind: "sanitize-video";
  requestId: number;
  file: File;
  sourceType: string;
  engine: VideoEngine;
  encoder: EncoderPick | null;
  audio: AudioPick | null;
  keepAudio: boolean;
  ultraParanoid: boolean;
  outputContainer: VideoContainer | "auto";
  resizePct: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
};

export type AuditVideoRequest = {
  kind: "audit-video";
  requestId: number;
  file: File;
};

type CancelRequest = {
  kind: "cancel";
  requestId: number;
};

type WarmRequest = {
  kind: "warm";
  requestId: number;
};

export type WorkerRequest =
  | SanitizeRequest
  | AuditRequest
  | VideoSanitizeRequest
  | AuditVideoRequest
  | CancelRequest
  | WarmRequest;

export type SanitizeStage = "read" | "decode" | "encode" | "strip" | "audit";
type VideoStage = "probe" | "scan" | "decode" | "transform" | "encode" | "mux" | "remux" | "audit";
export type Stage = SanitizeStage | VideoStage;

export type WorkerProgress = {
  type: "progress";
  requestId: number;
  stage: Stage;
  pct: number;
  detail?: string;
  etaS?: number;
};

type SanitizeTiming = {
  decodeMs: number;
  encodeMs: number;
  stripMs: number;
  totalMs: number;
};

type VideoTiming = {
  probeMs: number;
  decodeEncodeMs: number;
  remuxMs: number;
  auditMs: number;
  totalMs: number;
  frames: number;
};

export type ImageSuccess = {
  type: "done";
  ok: true;
  media: "image";
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

export type VideoSuccess = {
  type: "done";
  ok: true;
  media: "video";
  requestId: number;
  outputType: OutputContainer;
  outputAudit: AuditSummary;
  outputBlob: Blob;
  inputByteLength: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  engine: VideoEngine;
  engineReason: string;
  codecName: EncoderPick["name"] | "copy";
  audioKept: boolean;
  durationS: number;
  timing: VideoTiming;
};

export type WorkerSuccess = ImageSuccess | VideoSuccess;

type FailureCode = "refused" | "unsupported" | "audit" | "cancelled" | "limit";

export type WorkerFailure = {
  type: "done";
  ok: false;
  requestId: number;
  error: string;
  code?: FailureCode;
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

type WorkerResponse = WorkerSuccess | WorkerFailure | AuditDone | WarmDone;
export type WorkerMessage = WorkerProgress | WorkerResponse;
