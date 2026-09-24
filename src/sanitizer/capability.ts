import { pickEncoder, type EncoderPick } from "./video/encoderPick";

type DecoderKey = "h264" | "hevc" | "vp8" | "vp9" | "av1";

type VideoMode = "reencode" | "remux" | "none";

export type VideoCapability = {
  webcodecs: boolean;
  decode: Record<DecoderKey, boolean>;
  encoder: EncoderPick | null;
  audio: { aac: boolean; opus: boolean };
  mode: VideoMode;
  reason: string;
  advice: string | null;
};

type CapabilityCopy = {
  label: string;
  detail: string;
  advice: string | null;
};

type ProbeOptions = {
  wasmReady?: () => Promise<unknown>;
};

const DECODER_PROBES: Record<DecoderKey, string> = {
  h264: "avc1.64001f",
  hevc: "hvc1.1.6.L93.B0",
  vp8: "vp8",
  vp9: "vp09.00.10.08",
  av1: "av01.0.04M.08",
};

const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;
const PROBE_FPS = 30;

const ADVICE = {
  firefoxAndroid:
    "Firefox for Android has no video encoder. Use Chrome on Android or a desktop browser for the full clean.",
  oldSafari: "Update Safari for the full clean. Older versions can only do the basic clean.",
  oldBrowser: "Update your browser for the full clean.",
  generic: "This browser has no video re-encoder. You still get the basic clean: metadata strip only.",
} as const;

let cached: Promise<VideoCapability> | null = null;

export function probeVideoCapability(options: ProbeOptions = {}): Promise<VideoCapability> {
  if (!cached) cached = probe(options);
  return cached;
}

function hasWebCodecs(): boolean {
  return (
    typeof VideoDecoder !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof EncodedVideoChunk !== "undefined"
  );
}

async function decoderSupported(codec: string): Promise<boolean> {
  try {
    const result = await VideoDecoder.isConfigSupported({ codec });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function audioEncoderSupported(codec: string): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function wasmLoads(options: ProbeOptions): Promise<boolean> {
  if (!options.wasmReady) return true;
  try {
    await options.wasmReady();
    return true;
  } catch {
    return false;
  }
}

async function probe(options: ProbeOptions): Promise<VideoCapability> {
  const webcodecs = hasWebCodecs();
  const decode: Record<DecoderKey, boolean> = {
    h264: false,
    hevc: false,
    vp8: false,
    vp9: false,
    av1: false,
  };
  let encoder: EncoderPick | null = null;
  const audio = { aac: false, opus: false };

  if (webcodecs) {
    const keys = Object.keys(DECODER_PROBES) as DecoderKey[];
    const results = await Promise.all(keys.map((k) => decoderSupported(DECODER_PROBES[k])));
    keys.forEach((k, i) => {
      decode[k] = results[i];
    });
    encoder = await pickEncoder(PROBE_WIDTH, PROBE_HEIGHT, PROBE_FPS);
    [audio.aac, audio.opus] = await Promise.all([
      audioEncoderSupported("mp4a.40.2"),
      audioEncoderSupported("opus"),
    ]);
  }

  const wasmOk = await wasmLoads(options);
  const mode: VideoMode = !wasmOk ? "none" : webcodecs && encoder ? "reencode" : "remux";
  const reason = reasonFor(mode, webcodecs, encoder);
  const advice = mode === "reencode" ? null : adviceFor(userAgent());
  return { webcodecs, decode, encoder, audio, mode, reason, advice };
}

function reasonFor(mode: VideoMode, webcodecs: boolean, encoder: EncoderPick | null): string {
  if (mode === "none") return "The cleaning engine could not load in this browser.";
  if (mode === "reencode" && encoder) return `WebCodecs encoder available: ${encoder.name} (${encoder.codec}).`;
  if (!webcodecs) return "WebCodecs is not available in this browser.";
  return "WebCodecs has no supported video encoder in this browser.";
}

function userAgent(): string {
  return typeof navigator !== "undefined" && typeof navigator.userAgent === "string" ? navigator.userAgent : "";
}

function majorAfter(ua: string, re: RegExp): number | null {
  const m = ua.match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function adviceFor(ua: string): string {
  const firefox = majorAfter(ua, /Firefox\/(\d+)/);
  if (firefox !== null && /Android/.test(ua)) return ADVICE.firefoxAndroid;
  const isAppleWebKit = /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Android/.test(ua);
  const safari = isAppleWebKit ? majorAfter(ua, /Version\/(\d+)/) : null;
  if (safari !== null && safari < 26) return ADVICE.oldSafari;
  const chromium = majorAfter(ua, /Chrom(?:e|ium)\/(\d+)/);
  if (chromium !== null && chromium < 94) return ADVICE.oldBrowser;
  if (firefox !== null && firefox < 130) return ADVICE.oldBrowser;
  return ADVICE.generic;
}

function encoderLabel(encoder: EncoderPick): string {
  if (encoder.name === "vp9") return "VP9";
  if (encoder.name === "av1") return "AV1";
  return "H.264";
}

export function capabilityCopy(cap: VideoCapability): CapabilityCopy {
  if (cap.mode === "reencode" && cap.encoder) {
    return {
      label: "Full clean: re-encode",
      detail: `Videos are decoded to raw frames and re-encoded as ${encoderLabel(cap.encoder)} in this browser, then checked again.`,
      advice: null,
    };
  }
  if (cap.mode === "remux") {
    return {
      label: "Basic clean: metadata strip only",
      detail: "Metadata is removed and the file is rebuilt. Picture and sound are untouched.",
      advice: cap.advice,
    };
  }
  return {
    label: "Video not supported",
    detail: "This browser cannot clean videos. Images still work.",
    advice: cap.advice,
  };
}
