import { ensureWasm } from "../worker";
import { MAX_VIDEO_BYTES, videoTypeFor } from "../formats";
import type { Stage, VideoEngine, VideoSanitizeRequest, VideoSuccess } from "../types";
import { auditVideoBlob } from "./audit";
import { remuxVideo } from "./remux";

type VideoProgress = (stage: Stage, pct: number, detail?: string, etaS?: number) => void;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function sanitizeVideo(
  request: VideoSanitizeRequest,
  signal: AbortSignal,
  report: VideoProgress,
): Promise<VideoSuccess> {
  const file = request.file;
  if (!videoTypeFor(request.sourceType, file.name)) {
    throw new Error(`Unsupported input type "${request.sourceType || "unknown"}". Use MP4, MOV or WebM.`);
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`File is ${mb(file.size)}, over the ${mb(MAX_VIDEO_BYTES)} limit.`);
  }
  const tStart = performance.now();
  const wasm = (await ensureWasm()) as { memory: WebAssembly.Memory };
  const ops = { resizePct: clampPct(request.resizePct), rotate: request.rotate, flipH: request.flipH, flipV: request.flipV };
  const keepAudio = request.keepAudio && !request.ultraParanoid;
  const container = request.ultraParanoid ? "video/mp4" : request.outputContainer;

  let engine: VideoEngine = request.engine;
  let engineReason = "";
  let source: Blob = file;
  let width = 0;
  let height = 0;
  let origWidth = 0;
  let origHeight = 0;
  let frames = 0;
  let durationS = 0;
  let audioKept = keepAudio;
  let codecName: VideoSuccess["codecName"] = "copy";
  const tProbe = performance.now();

  if (engine === "reencode" && request.encoder) {
    const encoder = request.encoder;
    const targetContainer =
      container === "auto" ? encoder.container : container === "video/webm" && encoder.name.startsWith("h264") ? "video/mp4" : container;
    try {
      const { reencodeVideo, FailoverError } = await import("./reencode");
      try {
        const res = await reencodeVideo(
          file,
          { encoder, audio: request.audio, keepAudio, container: targetContainer, ops, memory: wasm.memory },
          signal,
          report,
        );
        source = res.blob;
        width = res.width;
        height = res.height;
        origWidth = res.origWidth;
        origHeight = res.origHeight;
        frames = res.frames;
        durationS = res.durationS;
        audioKept = res.audioKept;
        codecName = encoder.name;
        engineReason = res.notes.join(" ");
      } catch (error) {
        if (error instanceof FailoverError) {
          engine = "remux";
          engineReason = error.message;
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error && /Cancelled/.test(error.message)) throw error;
      throw error;
    }
  } else if (engine === "reencode") {
    engine = "remux";
    engineReason = "No video encoder available in this browser.";
  }
  if (signal.aborted) throw new Error("Cancelled.");
  const tEncoded = performance.now();

  report("remux", 84);
  const outContainer = engine === "remux" ? (request.ultraParanoid ? "auto" : container) : "auto";
  const remuxed = await remuxVideo(source, { keepAudio: engine === "remux" ? keepAudio : audioKept, outContainer }, signal, (done, total) =>
    report("remux", 84 + Math.min(8, (8 * done) / Math.max(total, 1))),
  );
  if (engine === "remux") {
    width = remuxed.plan.video.width;
    height = remuxed.plan.video.height;
    origWidth = width;
    origHeight = height;
    durationS = remuxed.plan.durationS;
    frames = remuxed.plan.video.samples;
    audioKept = remuxed.plan.audio !== null && remuxed.plan.keepAudio;
  }
  const tRemuxed = performance.now();

  report("audit", 93);
  const outputAudit = await auditVideoBlob(remuxed.blob, true, signal, (done) =>
    report("audit", 93 + Math.min(6, (6 * done) / Math.max(remuxed.blob.size, 1))),
  );
  if (!outputAudit.passed) {
    throw new Error(`Fail-closed audit rejection: ${outputAudit.issues.join("; ") || "unknown issue"}`);
  }
  const tEnd = performance.now();

  return {
    type: "done",
    ok: true,
    media: "video",
    requestId: request.requestId,
    outputType: remuxed.outputType,
    outputAudit,
    outputBlob: remuxed.blob,
    inputByteLength: file.size,
    width,
    height,
    origWidth,
    origHeight,
    engine,
    engineReason,
    codecName,
    audioKept,
    durationS,
    timing: {
      probeMs: tProbe - tStart,
      decodeEncodeMs: tEncoded - tProbe,
      remuxMs: tRemuxed - tEncoded,
      auditMs: tEnd - tRemuxed,
      totalMs: tEnd - tStart,
      frames,
    },
  };
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 100;
  return Math.min(100, Math.max(10, Math.round(pct)));
}
