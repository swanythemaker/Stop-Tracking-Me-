import type { AuditSummary } from "../sanitizer/formats";
import { ICON } from "./icons";
import { formatBytes } from "./format";

type VerdictStats = {
  inBytes: number;
  outBytes: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
};

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
    const delta =
      stats.inBytes > 0
        ? Math.round(((stats.outBytes - stats.inBytes) / stats.inBytes) * 100)
        : 0;
    const sign = delta > 0 ? "+" : "";
    const resized =
      stats.origWidth !== stats.width || stats.origHeight !== stats.height;
    const dims = resized
      ? `${stats.origWidth}×${stats.origHeight} → ${stats.width}×${stats.height}`
      : `${stats.width}×${stats.height}`;
    sub.textContent =
      `Metadata removed and output re-verified. ${dims} · ` +
      `${formatBytes(stats.inBytes)} → ${formatBytes(stats.outBytes)} (${sign}${delta}%).`;
  } else {
    sub.textContent =
      error || "The output did not pass the strict audit, so download was blocked.";
  }
  body.appendChild(sub);

  verdict.appendChild(icon);
  verdict.appendChild(body);
}

export function renderDownload(
  downloadArea: HTMLElement,
  url: string,
  name: string,
  bytes: number,
): void {
  downloadArea.innerHTML = "";
  const a = document.createElement("a");
  a.className = "download-btn";
  a.href = url;
  a.download = name;
  a.innerHTML = `${ICON.download}<span class="dl-text">Download clean image<small>${name} · ${formatBytes(bytes)}</small></span>`;
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
  meta.textContent = `${summary.kind.toUpperCase()} · ${formatBytes(summary.byteLength)}`;
  container.appendChild(meta);

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
