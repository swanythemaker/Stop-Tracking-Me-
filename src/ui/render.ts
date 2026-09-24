import type { AuditSummary, MediaKind } from "../sanitizer/formats";
import type { VideoEngine } from "../sanitizer/types";
import { ICON } from "./icons";
import { formatBytes } from "./format";
import { formatDuration } from "./preview";

type VerdictStats = {
  inBytes: number;
  outBytes: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  media?: MediaKind;
  engine?: VideoEngine;
  audioKept?: boolean;
  durationS?: number;
  note?: string;
  inpainted?: boolean;
  reduced?: boolean;
};

const IMAGE_FILL_LIMITS =
  "The fill is generated locally and can look soft on large areas. Invisible watermarks such as SynthID and the camera's noise pattern may still be present.";
const IMAGE_REDUCE_LIMITS =
  "Reduce hidden marks lowers what fragile invisible marks can survive. It does not remove SynthID, and the image may still be identifiable as processed.";

const VIDEO_LIMITS =
  "Invisible watermarks such as Google SynthID, the camera's own noise pattern, and anything the video shows or says can still be in there.";

export function renderVerdict(
  verdict: HTMLElement,
  ok: boolean,
  error: string,
  stats?: VerdictStats,
  titleOverride?: string,
): void {
  verdict.hidden = false;
  verdict.className = `verdict ${ok ? "ok" : "bad"}`;
  verdict.innerHTML = "";

  const icon = document.createElement("div");
  icon.className = "verdict-icon";
  icon.innerHTML = ok ? ICON.check : ICON.alert;

  const body = document.createElement("div");
  body.className = "verdict-body";

  const title = document.createElement("strong");
  title.textContent = ok ? "Clean: safe to download" : titleOverride || "Export blocked";
  body.appendChild(title);

  const sub = document.createElement("p");
  if (ok && stats) {
    const delta = stats.inBytes > 0 ? Math.round(((stats.outBytes - stats.inBytes) / stats.inBytes) * 100) : 0;
    const sign = delta > 0 ? "+" : "";
    const resized = stats.origWidth !== stats.width || stats.origHeight !== stats.height;
    const dims = resized
      ? `${stats.origWidth}×${stats.origHeight} → ${stats.width}×${stats.height}`
      : `${stats.width}×${stats.height}`;
    const size = `${formatBytes(stats.inBytes)} → ${formatBytes(stats.outBytes)} (${sign}${delta}%)`;
    if (stats.media === "video") {
      const lead =
        stats.engine === "reencode"
          ? "Decoded to raw frames and re-encoded, metadata removed, output re-verified."
          : "Metadata removed and container rebuilt. Picture and sound untouched.";
      const dur = stats.durationS ? ` · ${formatDuration(stats.durationS)}` : "";
      const sound = stats.audioKept
        ? stats.engine === "reencode"
          ? " Sound re-encoded, not scrubbed."
          : " Sound kept."
        : " Sound removed.";
      sub.textContent = `${lead} ${dims}${dur} · ${size}.${sound}${stats.note ? ` ${stats.note}` : ""}`;
    } else {
      const lead = stats.inpainted ? "Metadata removed, marked area filled, output re-verified." : "Metadata removed and output re-verified.";
      sub.textContent = `${lead} ${dims} · ${size}.`;
    }
  } else {
    sub.textContent = error || "The output did not pass the strict audit, so download was blocked.";
  }
  body.appendChild(sub);

  if (ok && stats?.media !== "video" && (stats?.inpainted || stats?.reduced)) {
    const limits = document.createElement("p");
    limits.className = "verdict-limits";
    limits.textContent = [stats.inpainted ? IMAGE_FILL_LIMITS : "", stats.reduced ? IMAGE_REDUCE_LIMITS : ""].filter(Boolean).join(" ");
    body.appendChild(limits);
  }

  if (ok && stats?.media === "video") {
    const limits = document.createElement("p");
    limits.className = "verdict-limits";
    limits.textContent =
      stats.engine === "reencode"
        ? `${VIDEO_LIMITS} Re-encoding reduces what hidden patterns can survive. It is not a guarantee.`
        : VIDEO_LIMITS;
    body.appendChild(limits);
  }

  verdict.appendChild(icon);
  verdict.appendChild(body);
}

export function renderDownload(
  downloadArea: HTMLElement,
  url: string,
  name: string,
  bytes: number,
  media: MediaKind = "image",
): void {
  downloadArea.innerHTML = "";
  const a = document.createElement("a");
  a.className = "download-btn";
  a.href = url;
  a.download = name;
  a.innerHTML = `${ICON.download}<span class="dl-text">Download clean ${media}<small>${name} · ${formatBytes(bytes)}</small></span>`;
  downloadArea.appendChild(a);
}

export function renderScanCard(
  container: HTMLElement,
  summary: AuditSummary | null,
  label: string,
  errorText?: string,
): void {
  container.innerHTML = "";
  container.classList.remove("pass", "fail");

  const head = document.createElement("div");
  head.className = "scan-head";
  const title = document.createElement("h3");
  title.textContent = label;
  head.appendChild(title);

  const passed = summary ? summary.passed : false;
  container.classList.add(passed ? "pass" : "fail");

  const pill = document.createElement("span");
  pill.className = `pill ${passed ? "pill-pass" : "pill-fail"}`;
  pill.innerHTML = `${passed ? ICON.check : ICON.alert}<span>${passed ? "PASS" : "FAIL"}</span>`;
  head.appendChild(pill);
  container.appendChild(head);

  if (!summary) {
    const p = document.createElement("p");
    p.className = "scan-note";
    p.textContent = errorText || "No data.";
    container.appendChild(p);
    return;
  }

  const meta = document.createElement("p");
  meta.className = "scan-meta";
  meta.textContent = `${summary.kind.toUpperCase()} · ${formatBytes(summary.byteLength)}${summary.tracks?.length ? ` · ${summary.tracks.join(" · ")}` : ""}`;
  container.appendChild(meta);

  const groups = summary.groups
    ? Object.entries(summary.groups).filter(([, items]) => items.length)
    : [];
  if (groups.length) {
    const wrap = document.createElement("div");
    wrap.className = "scan-groups";
    for (const [group, items] of groups) {
      const row = document.createElement("div");
      row.className = "scan-group";
      const name = document.createElement("span");
      name.className = "group-label";
      name.textContent = group;
      row.appendChild(name);
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const item of [...new Set(items)]) {
        const chip = document.createElement("span");
        chip.className = "chip chip-flag";
        chip.textContent = item;
        chips.appendChild(chip);
      }
      row.appendChild(chips);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  } else {
    const uniqueMarkers = [...new Set(summary.markers)];
    if (uniqueMarkers.length) {
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const marker of uniqueMarkers) {
        const flagged = summary.issues.some((issue) => issue.includes(marker));
        const chip = document.createElement("span");
        chip.className = `chip${flagged ? " chip-flag" : ""}`;
        chip.textContent = marker.trim() || marker;
        chips.appendChild(chip);
      }
      container.appendChild(chips);
    }
  }

  if (summary.issues.length) {
    const list = document.createElement("ul");
    list.className = "issues";
    for (const issue of summary.issues) {
      const li = document.createElement("li");
      li.textContent = issue;
      list.appendChild(li);
    }
    container.appendChild(list);
  } else {
    const ok = document.createElement("p");
    ok.className = "scan-ok";
    ok.textContent = "No metadata or structural issues found.";
    container.appendChild(ok);
  }
}
