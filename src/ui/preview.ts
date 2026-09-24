import type { MediaKind } from "../sanitizer/formats";

export type PreviewPair = { img: HTMLImageElement; video: HTMLVideoElement };

export function setMediaPreview(pair: PreviewPair, url: string | null, kind: MediaKind | null): void {
  const showVideo = !!url && kind === "video";
  const showImage = !!url && kind === "image";
  pair.img.hidden = !showImage;
  pair.img.src = showImage ? url : "";
  pair.video.hidden = !showVideo;
  if (showVideo) {
    pair.video.src = url;
    pair.video.load();
  } else {
    pair.video.removeAttribute("src");
    pair.video.load();
  }
}

export function loadImageDimensions(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function loadVideoDimensions(url: string): Promise<{ w: number; h: number; durationS: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    const done = (ok: boolean) => {
      const out = ok && v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight, durationS: v.duration } : null;
      v.removeAttribute("src");
      v.load();
      resolve(out);
    };
    v.onloadedmetadata = () => done(true);
    v.onerror = () => done(false);
    v.src = url;
  });
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "";
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")} min` : `${sec} s`;
}
