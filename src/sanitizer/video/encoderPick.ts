export type VideoContainer = "video/mp4" | "video/webm";

type EncoderName = "h264-high" | "h264-main" | "h264-baseline" | "vp9" | "av1";

export type EncoderPick = {
  name: EncoderName;
  codec: string;
  container: VideoContainer;
};

export type AudioPick = {
  codec: "mp4a.40.2" | "opus";
};

type Candidate = {
  name: EncoderName;
  codec: string;
};

const ENCODER_CANDIDATES: readonly Candidate[] = [
  { name: "h264-high", codec: "avc1.640028" },
  { name: "h264-main", codec: "avc1.4d0028" },
  { name: "h264-baseline", codec: "avc1.42001f" },
  { name: "vp9", codec: "vp09.00.10.08" },
  { name: "av1", codec: "av01.0.04M.08" },
];

const AVC_LEVELS: readonly { idc: number; maxFs: number; maxMbps: number }[] = [
  { idc: 0x1f, maxFs: 3600, maxMbps: 108000 },
  { idc: 0x20, maxFs: 5120, maxMbps: 216000 },
  { idc: 0x28, maxFs: 8192, maxMbps: 245760 },
  { idc: 0x2a, maxFs: 8704, maxMbps: 522240 },
  { idc: 0x32, maxFs: 22080, maxMbps: 589824 },
  { idc: 0x33, maxFs: 36864, maxMbps: 983040 },
  { idc: 0x34, maxFs: 36864, maxMbps: 2073600 },
  { idc: 0x3c, maxFs: 139264, maxMbps: 4177920 },
  { idc: 0x3d, maxFs: 139264, maxMbps: 8355840 },
  { idc: 0x3e, maxFs: 139264, maxMbps: 16711680 },
];

const MIN_BITRATE = 500_000;
const MAX_BITRATE = 20_000_000;
const BITS_PER_PIXEL = 0.1;
const DEFAULT_FPS = 30;

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r - (r % 2);
}

function saneFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.min(fps, 240) : DEFAULT_FPS;
}

export function bitrateFor(width: number, height: number, fps: number): number {
  const raw = BITS_PER_PIXEL * width * height * saneFps(fps);
  if (!Number.isFinite(raw)) return MIN_BITRATE;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

function isAvc(codec: string): boolean {
  return codec.startsWith("avc1.");
}

function avcCodecFor(codec: string, width: number, height: number, fps: number): string {
  const base = parseInt(codec.slice(9, 11), 16);
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * saneFps(fps);
  const fit = AVC_LEVELS.find((l) => l.maxFs >= mbs && l.maxMbps >= mbps);
  const need = fit ? fit.idc : AVC_LEVELS[AVC_LEVELS.length - 1].idc;
  const idc = Math.max(base, need);
  return codec.slice(0, 9) + idc.toString(16).padStart(2, "0");
}

function encoderConfig(codec: string, width: number, height: number, fps: number): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec,
    width,
    height,
    framerate: saneFps(fps),
    bitrate: bitrateFor(width, height, fps),
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
  };
  if (isAvc(codec)) config.avc = { format: "avc" };
  return config;
}

async function supported(config: VideoEncoderConfig): Promise<boolean> {
  try {
    const result = await VideoEncoder.isConfigSupported(config);
    return result.supported === true;
  } catch {
    return false;
  }
}

export async function pickEncoder(
  width: number,
  height: number,
  fps: number,
  container: VideoContainer = "video/mp4",
): Promise<EncoderPick | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const w = even(width);
  const h = even(height);
  for (const candidate of ENCODER_CANDIDATES) {
    if (container === "video/webm" && isAvc(candidate.codec)) continue;
    const codec = isAvc(candidate.codec) ? avcCodecFor(candidate.codec, w, h, fps) : candidate.codec;
    if (await supported(encoderConfig(codec, w, h, fps))) {
      return { name: candidate.name, codec, container };
    }
  }
  return null;
}
