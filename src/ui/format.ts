export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortType(mime: string): string {
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/webp") return "WebP";
  if (mime === "video/mp4") return "MP4";
  if (mime === "video/quicktime") return "MOV";
  if (mime === "video/webm") return "WebM";
  if (mime === "video/x-matroska") return "MKV";
  return mime || "file";
}

export function extForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/webm") return ".webm";
  if (mime === "video/x-matroska") return ".mkv";
  return ".bin";
}

export function explainError(raw: string): {
  status: string;
  title: string;
  detail: string;
} {
  const e = (raw || "").trim() || "Unknown error.";
  if (/cancel/i.test(e)) {
    return { title: "Cancelled", status: "Cancelled.", detail: "Nothing was written." };
  }
  if (/(over the|exceed|too large|MP limit)/i.test(e)) {
    return {
      title: "File too large",
      status: `Blocked: ${e}`,
      detail: `${e} Try a smaller file, or resize it before sanitizing.`,
    };
  }
  if (/(fragmented|encrypted|edit list|more than one video|laced|ContentEncodings|not supported|cannot decode|unknown size)/i.test(e)) {
    return {
      title: "Can't clean this video",
      status: `Blocked: ${e}`,
      detail: e,
    };
  }
  if (/(could not be decoded|unsupported|disguised|corrupt|not a (png|jpeg|webp))/i.test(e)) {
    return {
      title: "Couldn't read this image",
      status: `Blocked: ${e}`,
      detail: e,
    };
  }
  if (/audit/i.test(e)) {
    return {
      title: "Export blocked by audit",
      status: "Blocked: output failed the strict safety audit.",
      detail: `${e} The cleaned file was not provably safe, so download was refused (fail-closed).`,
    };
  }
  return { title: "Couldn't process this file", status: `Blocked: ${e}`, detail: e };
}

export function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required node: ${selector}`);
  }
  return node;
}
