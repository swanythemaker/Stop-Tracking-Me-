export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortType(mime: string): string {
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/webp") return "WebP";
  return mime || "image";
}

export function extForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

export function explainError(raw: string): {
  status: string;
  title: string;
  detail: string;
} {
  const e = (raw || "").trim() || "Unknown error.";
  if (/(over the|exceed|too large|MP limit)/i.test(e)) {
    return {
      title: "Image too large",
      status: `Blocked: ${e}`,
      detail: `${e} Try a smaller image, or resize it before sanitizing.`,
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
  return { title: "Couldn't process this image", status: `Blocked: ${e}`, detail: e };
}

export function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required node: ${selector}`);
  }
  return node;
}
