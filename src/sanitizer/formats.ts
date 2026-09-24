const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedFormat = (typeof SUPPORTED_IMAGE_TYPES)[number];

const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"] as const;
type SupportedVideoType = (typeof SUPPORTED_VIDEO_TYPES)[number];

export type MediaKind = "image" | "video";

export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const VIDEO_EXTENSIONS: Record<string, SupportedVideoType> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

export type AuditSummary = {
  kind: "png" | "jpeg" | "webp" | "mp4" | "webm" | "mkv" | "unknown";
  issues: string[];
  markers: string[];
  byteLength: number;
  passed: boolean;
  groups?: Record<string, string[]>;
  tracks?: string[];
};

export function isSupportedImageType(type: string): type is SupportedFormat {
  return SUPPORTED_IMAGE_TYPES.includes(type as SupportedFormat);
}

function isSupportedVideoType(type: string): type is SupportedVideoType {
  return SUPPORTED_VIDEO_TYPES.includes(type as SupportedVideoType);
}

export function videoTypeFor(type: string, name: string): SupportedVideoType | null {
  if (isSupportedVideoType(type)) return type;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXTENSIONS[ext] ?? null;
}

export function mediaKindOf(type: string, name: string): MediaKind | null {
  if (isSupportedImageType(type)) return "image";
  if (videoTypeFor(type, name)) return "video";
  return null;
}

export function describeAudit(summary: AuditSummary): string {
  const lines = [
    `kind: ${summary.kind}`,
    `size: ${summary.byteLength} bytes`,
  ];
  if (summary.tracks?.length) lines.push(`tracks: ${summary.tracks.join("; ")}`);
  lines.push(`markers: ${summary.markers.join(", ") || "none"}`);
  if (summary.groups) {
    const names = Object.keys(summary.groups).filter((g) => summary.groups![g].length);
    if (names.length) lines.push(`groups: ${names.join(", ")}`);
  }
  lines.push(`status: ${summary.passed ? "PASS" : "FAIL"}`);
  if (summary.issues.length) {
    lines.push("issues:");
    for (const issue of summary.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join("\n");
}
