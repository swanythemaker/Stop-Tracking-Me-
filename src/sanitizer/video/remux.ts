import { VideoRebuild } from "../../wasm/sanitize_core.js";
import type { OutputContainer, VideoContainer } from "../types";
import { runRangeLoop } from "./rangeLoop";

type RemuxOptions = {
  keepAudio: boolean;
  outContainer: VideoContainer | "auto";
};

type RemuxPlan = {
  container: string;
  outContainer: "mp4" | "webm" | "mkv";
  docType: string | null;
  durationS: number;
  video: { codec: string; width: number; height: number; rotation: number; samples: number; bytes: number };
  audio: { codec: string; sampleRate: number; channels: number; samples: number; bytes: number } | null;
  keepAudio: boolean;
  droppedTracks: string[];
  notes: string[];
};

type RemuxResult = {
  blob: Blob;
  plan: RemuxPlan;
  outputType: OutputContainer;
};

const CONTAINER_MIME: Record<RemuxPlan["outContainer"], OutputContainer> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

export async function remuxVideo(
  blob: Blob,
  opts: RemuxOptions,
  signal?: AbortSignal,
  onBytes?: (done: number, total: number) => void,
): Promise<RemuxResult> {
  const rebuild = VideoRebuild.open(blob.size);
  try {
    rebuild.setOptions(JSON.stringify({ keepAudio: opts.keepAudio, outContainer: opts.outContainer }));
    const parts: Uint8Array<ArrayBuffer>[] = [];
    await runRangeLoop(
      {
        nextRead: () => {
          const r = rebuild.nextRead();
          if (!r) return undefined;
          const req = { offset: r.offset, len: r.len };
          r.free();
          return req;
        },
        feed: (offset, bytes) => {
          rebuild.feed(offset, bytes);
          const out = rebuild.takeOutput();
          if (out.length) parts.push(new Uint8Array(out));
        },
      },
      blob,
      signal,
      (done) => onBytes?.(done, blob.size),
    );
    const err = rebuild.error();
    if (err) throw new Error(err);
    const plan = JSON.parse(rebuild.planJson()) as RemuxPlan | null;
    if (!plan) throw new Error("The video could not be read.");
    const tail = rebuild.finish();
    const head = new Uint8Array(tail.takeHead());
    const end = new Uint8Array(tail.takeTail());
    tail.free();
    const outputType = CONTAINER_MIME[plan.outContainer] ?? "video/mp4";
    const outBlob = new Blob([head, ...parts, end], { type: outputType });
    return { blob: outBlob, plan, outputType };
  } finally {
    rebuild.free();
  }
}
