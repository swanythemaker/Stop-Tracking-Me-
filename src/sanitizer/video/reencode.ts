import {
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WEBM,
  WebMOutputFormat,
} from "mediabunny";
import type { AudioPick, EncoderPick, VideoContainer } from "../types";
import { bitrateFor } from "./encoderPick";
import { PlanePipe, type PlaneOps } from "./planes";

export class FailoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FailoverError";
  }
}

type ReencodeOptions = {
  encoder: EncoderPick;
  audio: AudioPick | null;
  keepAudio: boolean;
  container: VideoContainer;
  ops: PlaneOps;
  memory: WebAssembly.Memory;
};

type ReencodeProgress = (stage: "probe" | "decode" | "encode" | "mux", pct: number, detail?: string, etaS?: number) => void;

type ReencodeResult = {
  blob: Blob;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  frames: number;
  durationS: number;
  audioKept: boolean;
  notes: string[];
};

type Chunk = { pos: number; data: Uint8Array<ArrayBuffer> };

class PositionedParts {
  private chunks: Chunk[] = [];

  write(position: number, data: Uint8Array): void {
    let remaining: { pos: number; data: Uint8Array } | null = { pos: position, data };
    for (const c of this.chunks) {
      if (!remaining) break;
      const start = Math.max(c.pos, remaining.pos);
      const end = Math.min(c.pos + c.data.length, remaining.pos + remaining.data.length);
      if (start >= end) continue;
      c.data.set(remaining.data.subarray(start - remaining.pos, end - remaining.pos), start - c.pos);
      if (start === remaining.pos && end === remaining.pos + remaining.data.length) {
        remaining = null;
      } else if (start === remaining.pos) {
        remaining = { pos: end, data: remaining.data.subarray(end - remaining.pos) };
      } else {
        remaining = { pos: remaining.pos, data: remaining.data.subarray(0, start - remaining.pos) };
      }
    }
    if (remaining) this.chunks.push({ pos: remaining.pos, data: new Uint8Array(remaining.data) });
  }

  toBlob(type: string): Blob {
    this.chunks.sort((a, b) => a.pos - b.pos);
    let expect = 0;
    for (const c of this.chunks) {
      if (c.pos !== expect) throw new Error("Muxer output has a gap.");
      expect += c.data.length;
    }
    return new Blob(this.chunks.map((c) => c.data), { type });
  }
}

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r - (r % 2);
}

function outputDims(w: number, h: number, ops: PlaneOps): { width: number; height: number } {
  const pct = Math.min(100, Math.max(10, ops.resizePct)) / 100;
  const swap = ops.rotate % 180 !== 0;
  const sw = even(w * pct);
  const sh = even(h * pct);
  return swap ? { width: sh, height: sw } : { width: sw, height: sh };
}

function isIdentity(ops: PlaneOps): boolean {
  return ops.resizePct === 100 && ops.rotate % 360 === 0 && !ops.flipH && !ops.flipV;
}

function shortCodec(name: EncoderPick["name"]): "avc" | "vp9" | "av1" {
  if (name === "vp9") return "vp9";
  if (name === "av1") return "av1";
  return "avc";
}

export async function reencodeVideo(
  file: File,
  opts: ReencodeOptions,
  signal: AbortSignal,
  report: ReencodeProgress,
): Promise<ReencodeResult> {
  report("probe", 1);
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] });
  const notes: string[] = [];
  try {
    const videoTracks = await input.getVideoTracks();
    if (videoTracks.length > 1) throw new Error("More than one video track is not supported.");
    const vt = videoTracks[0];
    if (!vt) throw new Error("No video track found.");
    const decoderConfig = await vt.getDecoderConfig();
    if (!decoderConfig) throw new FailoverError("Your browser cannot read this video codec.");
    const support = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!support.supported) throw new FailoverError(`Your browser cannot decode ${vt.codec ?? "this codec"}.`);

    const rotation = vt.rotation;
    const upright = rotation % 180 !== 0;
    const srcW = upright ? vt.codedHeight : vt.codedWidth;
    const srcH = upright ? vt.codedWidth : vt.codedHeight;
    const ops: PlaneOps = { ...opts.ops, rotate: (opts.ops.rotate + rotation) % 360 };
    const dims = outputDims(srcW, srcH, opts.ops);
    const stats = await vt.computePacketStats(200);
    const fps = stats.averagePacketRate > 0 ? stats.averagePacketRate : 30;
    const totalFrames = Math.max(1, stats.packetCount);
    const durationS = await vt.computeDuration();

    const parts = new PositionedParts();
    const target = new StreamTarget(
      new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
        write(chunk) {
          parts.write(chunk.position, chunk.data);
        },
      }),
      { chunked: true, chunkSize: 4 * 1024 * 1024 },
    );
    const format = opts.container === "video/webm" ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false });
    const output = new Output({ format, target });

    const videoSource = new VideoSampleSource({
      codec: shortCodec(opts.encoder.name),
      fullCodecString: opts.encoder.codec,
      bitrate: bitrateFor(dims.width, dims.height, fps),
      keyFrameInterval: 2,
      latencyMode: "quality",
      hardwareAcceleration: "no-preference",
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    let audioSource: AudioSampleSource | null = null;
    let audioTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null;
    if (opts.keepAudio) {
      audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        notes.push("The video has no sound track.");
      } else if (!opts.audio) {
        notes.push("Sound dropped: no audio encoder in this browser.");
        audioTrack = null;
      } else if (!(await audioTrack.canDecode())) {
        notes.push("Sound dropped: your browser cannot decode this audio codec.");
        audioTrack = null;
      } else {
        audioSource = new AudioSampleSource({ codec: opts.audio.codec === "opus" ? "opus" : "aac", bitrate: 128_000 });
        output.addAudioTrack(audioSource);
      }
    }

    await output.start();
    const identity = isIdentity(ops) && rotation === 0;
    const pipe = identity ? null : new PlanePipe(opts.memory, vt.codedWidth, vt.codedHeight);
    const onAbort = () => {
      void output.cancel();
    };
    signal.addEventListener("abort", onAbort);
    const started = performance.now();
    let frames = 0;
    let lastReport = 0;
    try {
      let base: number | null = null;
      const videoLoop = (async () => {
        const sink = new VideoSampleSink(vt);
        for await (const sample of sink.samples()) {
          if (signal.aborted) {
            sample.close();
            throw new Error("Cancelled.");
          }
          if (sample.timestamp < 0) {
            sample.close();
            continue;
          }
          if (base === null) base = sample.timestamp;
          try {
            if (!pipe) {
              sample.setTimestamp(sample.timestamp - base);
              await videoSource.add(sample);
            } else {
              const frame = sample.toVideoFrame();
              try {
                const outFrame = await pipe.transform(frame, ops);
                const outSample = new VideoSample(outFrame);
                try {
                  outSample.setTimestamp(sample.timestamp - base);
                  await videoSource.add(outSample);
                } finally {
                  outSample.close();
                  outFrame.close();
                }
              } finally {
                frame.close();
              }
            }
          } finally {
            sample.close();
          }
          frames++;
          const now = performance.now();
          if (now - lastReport > 150) {
            lastReport = now;
            const elapsed = (now - started) / 1000;
            const rate = frames / Math.max(elapsed, 0.001);
            const eta = elapsed > 2 ? Math.max(0, (totalFrames - frames) / rate) : undefined;
            const pct = 5 + Math.min(75, (75 * frames) / totalFrames);
            report(pipe ? "encode" : "encode", pct, `${frames.toLocaleString()} of ${totalFrames.toLocaleString()} frames`, eta);
          }
        }
        videoSource.close();
      })();
      const audioLoop = (async () => {
        if (!audioSource || !audioTrack) return;
        const sink = new AudioSampleSink(audioTrack);
        for await (const sample of sink.samples()) {
          if (signal.aborted) {
            sample.close();
            throw new Error("Cancelled.");
          }
          if (sample.timestamp < 0) {
            sample.close();
            continue;
          }
          try {
            sample.setTimestamp(Math.max(0, sample.timestamp - (base ?? 0)));
            await audioSource.add(sample);
          } finally {
            sample.close();
          }
        }
        audioSource.close();
      })();
      await Promise.all([videoLoop, audioLoop]);
      report("mux", 81);
      await output.finalize();
    } finally {
      signal.removeEventListener("abort", onAbort);
      pipe?.close();
    }
    if (signal.aborted) throw new Error("Cancelled.");
    const blob = parts.toBlob(opts.container);
    return {
      blob,
      width: dims.width,
      height: dims.height,
      origWidth: srcW,
      origHeight: srcH,
      frames,
      durationS,
      audioKept: audioSource !== null,
      notes,
    };
  } finally {
    input.dispose();
  }
}
