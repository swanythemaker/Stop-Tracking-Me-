const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedFormat = (typeof SUPPORTED_TYPES)[number];

export type AuditSummary = {
  kind: "png" | "jpeg" | "webp" | "unknown";
  issues: string[];
  markers: string[];
  byteLength: number;
  passed: boolean;
};

export function isSupportedImageType(type: string): type is SupportedFormat {
  return SUPPORTED_TYPES.includes(type as SupportedFormat);
}

export function describeAudit(summary: AuditSummary): string {
  const lines = [
    `kind: ${summary.kind}`,
    `size: ${summary.byteLength} bytes`,
    `markers: ${summary.markers.join(", ") || "none"}`,
    `status: ${summary.passed ? "PASS" : "FAIL"}`,
  ];
  if (summary.issues.length) {
    lines.push("issues:");
    for (const issue of summary.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join("\n");
}
