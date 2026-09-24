import "./styles/base.css";
import "./styles/stepflow.css";
import "./styles/results.css";
import "./styles/docs.css";

import {
  describeAudit,
  isSupportedImageType,
  type AuditSummary,
  type SupportedFormat,
} from "./sanitizer/formats";
import type { SanitizeStage } from "./sanitizer/types";
import { SanitizeClient } from "./sanitizer/client";
import { appMarkup } from "./ui/template";
import { StepFlow } from "./ui/stepflow";
import { must, formatBytes, shortType, extForMime, explainError } from "./ui/format";
import { renderVerdict, renderDownload, renderScanCard } from "./ui/render";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}
app.innerHTML = appMarkup();

const client = new SanitizeClient();

const fileInput = must<HTMLInputElement>("#fileInput");
const dropzone = must<HTMLElement>("#dropzone");
const fileCard = must<HTMLElement>("#fileCard");
const fileThumb = must<HTMLImageElement>("#fileThumb");
const fileName = must<HTMLElement>("#fileName");
const fileFacts = must<HTMLElement>("#fileFacts");
const clearFile = must<HTMLButtonElement>("#clearFile");
const status = must<HTMLElement>("#status");

const procPreview = must<HTMLImageElement>("#procPreview");
const procFrame = must<HTMLElement>("#procFrame");
const progressFill = must<HTMLElement>("#progressFill");
const progressStage = must<HTMLElement>("#progressStage");

const resultHeadline = must<HTMLElement>("#resultHeadline");
const verdict = must<HTMLElement>("#verdict");
const origSize = must<HTMLElement>("#origSize");
const outSize = must<HTMLElement>("#outSize");
const outFrame = must<HTMLElement>("#outFrame");
const framePending = must<HTMLElement>("#framePending");
const inputPreview = must<HTMLImageElement>("#inputPreview");
const outputPreview = must<HTMLImageElement>("#outputPreview");
const downloadArea = must<HTMLElement>("#downloadArea");
const editBtn = must<HTMLButtonElement>("#editBtn");
const newImageBtn = must<HTMLButtonElement>("#newImageBtn");
const editDone = must<HTMLButtonElement>("#editDone");

const inputScanCard = must<HTMLElement>("#inputScanCard");
const outputScanCard = must<HTMLElement>("#outputScanCard");
const inputReport = must<HTMLElement>("#inputReport");
const outputReport = must<HTMLElement>("#outputReport");

const outputFormat = must<HTMLSelectElement>("#outputFormat");
const quality = must<HTMLInputElement>("#quality");
const qualityValue = must<HTMLElement>("#qualityValue");
const ultraParanoid = must<HTMLInputElement>("#ultraParanoid");
const advanced = must<HTMLElement>("#advanced");
const adjustState = must<HTMLElement>("#adjustState");
const resizeChips = must<HTMLElement>("#resizeChips");
const resizeCustomToggle = must<HTMLButtonElement>("#resizeCustomToggle");
const resizeCustom = must<HTMLElement>("#resizeCustom");
const resizeSlider = must<HTMLInputElement>("#resizeSlider");
const resizeSliderValue = must<HTMLElement>("#resizeSliderValue");
const dimReadout = must<HTMLElement>("#dimReadout");
const rotateLeft = must<HTMLButtonElement>("#rotateLeft");
const rotateRight = must<HTMLButtonElement>("#rotateRight");
const flipHBtn = must<HTMLButtonElement>("#flipH");
const flipVBtn = must<HTMLButtonElement>("#flipV");

const barReset = must<HTMLButtonElement>("#barReset");

const dragOverlay = must<HTMLElement>("#dragOverlay");

const flow = new StepFlow({
  carousel: must<HTMLElement>("#carousel"),
  slides: [
    must<HTMLElement>("#slideUpload"),
    must<HTMLElement>("#slideProcessing"),
    must<HTMLElement>("#slideResult"),
  ],
  stepUpload: must<HTMLElement>("#stepUpload"),
  stepClean: must<HTMLElement>("#stepClean"),
  resultStage: must<HTMLElement>("#resultStage"),
});

const STAGE_TEXT: Record<SanitizeStage, string> = {
  read: "Reading image…",
  decode: "Decoding pixels…",
  encode: "Re-encoding a clean copy…",
  strip: "Stripping metadata…",
  audit: "Auditing output…",
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_TRANSITION_MS = 2500;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let selectedFile: File | null = null;
let lastInputAudit: AuditSummary | null = null;
let cleanedOnce = false;
let busy = false;
let pendingReclean = false;
let recleanTimer: number | undefined;
let downloadUrl: string | null = null;
let inputPreviewUrl: string | null = null;
let outputPreviewUrl: string | null = null;
let dragDepth = 0;

let resizePct = 100;
let customResize = false;
let rotateDeg = 0;
let flipHState = false;
let flipVState = false;
let loadedDims: { w: number; h: number } | null = null;

syncUltraParanoidUi();

ultraParanoid.addEventListener("change", () => {
  syncUltraParanoidUi();
  scheduleReclean();
});
quality.addEventListener("input", () => {
  qualityValue.textContent = quality.value;
  scheduleReclean();
});
outputFormat.addEventListener("change", scheduleReclean);

const resizeSegs = Array.from(
  resizeChips.querySelectorAll<HTMLButtonElement>("button[data-pct]"),
);
for (const seg of resizeSegs) {
  seg.addEventListener("click", () => {
    customResize = false;
    resizeCustom.hidden = true;
    setResizePct(Number(seg.dataset.pct));
  });
}
resizeCustomToggle.addEventListener("click", () => {
  customResize = true;
  resizeCustom.hidden = false;
  setResizePct(Number(resizeSlider.value), true);
});
resizeSlider.addEventListener("input", () => {
  customResize = true;
  setResizePct(Number(resizeSlider.value), true);
});
rotateLeft.addEventListener("click", () => {
  rotateDeg = (rotateDeg + 270) % 360;
  syncRotateFlipUi();
  updateAdjust();
});
rotateRight.addEventListener("click", () => {
  rotateDeg = (rotateDeg + 90) % 360;
  syncRotateFlipUi();
  updateAdjust();
});
flipHBtn.addEventListener("click", () => {
  flipHState = !flipHState;
  syncRotateFlipUi();
  updateAdjust();
});
flipVBtn.addEventListener("click", () => {
  flipVState = !flipVState;
  syncRotateFlipUi();
  updateAdjust();
});

editBtn.addEventListener("click", () => flow.setEditing(true));
editDone.addEventListener("click", () => flow.setEditing(false));
newImageBtn.addEventListener("click", () => resetToUpload());
barReset.addEventListener("click", () => resetToUpload());

must<HTMLElement>("#stepUpload").addEventListener("click", () => {
  if (flow.slide > 0) flow.goTo(0, { focus: true });
});
must<HTMLElement>("#stepClean").addEventListener("click", () => {
  if (cleanedOnce) flow.goTo(2, { focus: true });
});

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", async () => {
  await handleFileSelection(fileInput.files?.[0] ?? null);
});
clearFile.addEventListener("click", async () => {
  fileInput.value = "";
  await handleFileSelection(null);
});

window.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dragOverlay.classList.add("active");
});
window.addEventListener("dragover", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
});
window.addEventListener("dragleave", (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragOverlay.classList.remove("active");
});
window.addEventListener("drop", async (event) => {
  if (!event.dataTransfer) return;
  event.preventDefault();
  dragDepth = 0;
  dragOverlay.classList.remove("active");
  const file = event.dataTransfer.files?.[0] ?? null;
  if (file) await handleFileSelection(file);
});

async function handleFileSelection(file: File | null): Promise<void> {
  clearDownload();
  selectedFile = null;
  lastInputAudit = null;
  resetResultUi();

  if (!file) {
    inputReport.textContent = "No file loaded.";
    inputScanCard.innerHTML = "";
    setStatus("Select an image to begin.", "muted");
    setInputPreview(null);
    fileCard.hidden = true;
    loadedDims = null;
    updateDimReadout();
    flow.goTo(0);
    return;
  }

  if (!isSupportedImageType(file.type)) {
    inputReport.textContent = `Unsupported type: ${file.type || "unknown"}`;
    inputScanCard.innerHTML = "";
    setStatus(
      `Unsupported file type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG or WebP.`,
      "bad",
    );
    setInputPreview(null);
    fileCard.hidden = true;
    flow.goTo(0);
    return;
  }

  const inputBytes = await file.arrayBuffer();
  const previewUrl = URL.createObjectURL(new Blob([inputBytes], { type: file.type }));

  selectedFile = file;
  setInputPreview(previewUrl);
  fileThumb.src = previewUrl;
  fileName.textContent = file.name;
  origSize.textContent = formatBytes(file.size);
  fileCard.hidden = false;

  loadedDims = null;
  loadDimensions(previewUrl).then((dim) => {
    const facts = [
      shortType(file.type),
      dim ? `${dim.w}×${dim.h}` : null,
      formatBytes(file.size),
    ].filter(Boolean);
    fileFacts.textContent = facts.join("  ·  ");
    loadedDims = dim;
    updateDimReadout();
  });

  inputReport.textContent = "Scanning…";
  inputScanCard.innerHTML = "";
  setStatus("Scanning metadata…", "muted");
  const { audit } = await client.audit({
    sourceType: file.type,
    inputBuffer: inputBytes,
  });
  lastInputAudit = audit;
  inputReport.textContent = describeAudit(audit);
  renderScanCard(inputScanCard, audit, "Input scan");

  await clean("first");
}

async function clean(mode: "first" | "reclean"): Promise<void> {
  if (!selectedFile || busy) {
    if (mode === "reclean") pendingReclean = true;
    return;
  }
  busy = true;

  if (mode === "first") {
    procPreview.src = inputPreviewUrl ?? "";
    procFrame.classList.remove("done");
    setStage("read", 2);
    flow.goTo(1, { focus: true });
  } else {
    outFrame.classList.add("loading");
    framePending.hidden = true;
  }
  clearDownload();

  const started = performance.now();
  try {
    const inputBuffer = await selectedFile.arrayBuffer();
    const res = await client.sanitize(
      {
        sourceType: selectedFile.type,
        inputBuffer,
        outputType:
          outputFormat.value === "same"
            ? "same"
            : (outputFormat.value as SupportedFormat),
        quality: Number(quality.value) / 100,
        ultraParanoid: ultraParanoid.checked,
        resizePct,
        rotate: rotateDeg,
        flipH: flipHState,
        flipV: flipVState,
      },
      (stage, pct) => setStage(stage, pct),
    );

    if (mode === "first") {
      const minDelay = reducedMotion ? 0 : MIN_TRANSITION_MS;
      const elapsed = performance.now() - started;
      if (elapsed < minDelay) await wait(minDelay - elapsed);
      setProgress(100);
      procFrame.classList.add("done");
      if (!reducedMotion) await wait(420);
    }

    populateResult(res);
    cleanedOnce = true;
    if (mode === "first") flow.goTo(2, { focus: true });
  } catch (err) {
    populateError(err instanceof Error ? err.message : "Unknown worker error");
    cleanedOnce = true;
    if (mode === "first") flow.goTo(2, { focus: true });
  } finally {
    busy = false;
    outFrame.classList.remove("loading");
    flow.syncHeight();
    if (pendingReclean) {
      pendingReclean = false;
      scheduleReclean();
    }
  }
}

function populateResult(res: {
  outputType: SupportedFormat;
  outputAudit: AuditSummary;
  outputBuffer: ArrayBuffer;
  inputByteLength: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
}): void {
  outputReport.textContent = describeAudit(res.outputAudit);
  renderScanCard(outputScanCard, res.outputAudit, "Output scan");

  const outBytes = res.outputBuffer.byteLength;
  const blob = new Blob([res.outputBuffer], { type: res.outputType });
  const safeName = `sanitized_${Date.now()}${extForMime(res.outputType)}`;
  const url = URL.createObjectURL(blob);
  downloadUrl = url;
  setOutputPreview(url);
  outSize.textContent = formatBytes(outBytes);
  framePending.hidden = true;

  renderDownload(downloadArea, url, safeName, outBytes);
  renderVerdict(verdict, true, "", {
    inBytes: res.inputByteLength,
    outBytes,
    width: res.width,
    height: res.height,
    origWidth: res.origWidth,
    origHeight: res.origHeight,
  });

  const markers = lastInputAudit
    ? new Set(lastInputAudit.markers.map((m) => m.trim()).filter(Boolean))
    : new Set<string>();
  const n = markers.size;
  resultHeadline.classList.remove("bad");
  resultHeadline.textContent =
    n > 0
      ? `✓ Stripped: ${n} hidden ${n === 1 ? "tag" : "tags"} removed`
      : "✓ Clean: re-encoded with no metadata";
  setStatus("Done. Output passed the strict fail-closed audit.", "good");
}

function populateError(message: string): void {
  const info = explainError(message);
  framePending.hidden = false;
  framePending.textContent = "Blocked";
  outputReport.textContent = message;
  outSize.textContent = "";
  setOutputPreview(null);
  clearDownload();
  renderVerdict(verdict, false, info.detail, undefined, info.title);
  renderScanCard(outputScanCard, null, "Output scan", message);
  resultHeadline.classList.add("bad");
  resultHeadline.textContent = "Export blocked: nothing to download";
  setStatus(info.status, "bad");
}

function resetToUpload(): void {
  fileInput.value = "";
  void handleFileSelection(null);
  flow.goTo(0, { focus: true });
}

function resetResultUi(): void {
  flow.setEditing(false);
  outputReport.textContent = "No output yet.";
  outputScanCard.innerHTML = "";
  outSize.textContent = "";
  verdict.hidden = true;
  resultHeadline.textContent = "";
  resultHeadline.classList.remove("bad");
  setOutputPreview(null);
  framePending.hidden = false;
  framePending.textContent = "Awaiting sanitize";
  outFrame.classList.remove("loading");
  procFrame.classList.remove("done");
}

function scheduleReclean(): void {
  if (!cleanedOnce) return;
  if (busy) {
    pendingReclean = true;
    return;
  }
  window.clearTimeout(recleanTimer);
  recleanTimer = window.setTimeout(() => void clean("reclean"), 250);
}

function setResizePct(pct: number, fromSlider = false): void {
  resizePct = Math.min(100, Math.max(10, Math.round(pct || 100)));
  for (const seg of resizeSegs) {
    seg.classList.toggle(
      "is-active",
      !customResize && Number(seg.dataset.pct) === resizePct,
    );
  }
  resizeCustomToggle.classList.toggle("is-active", customResize);
  if (!fromSlider) {
    resizeSlider.value = String(resizePct);
  }
  resizeSliderValue.textContent = `${resizePct}%`;
  updateAdjust();
}

function syncRotateFlipUi(): void {
  rotateLeft.classList.toggle("is-active", rotateDeg !== 0);
  rotateRight.classList.toggle("is-active", rotateDeg !== 0);
  flipHBtn.classList.toggle("is-active", flipHState);
  flipVBtn.classList.toggle("is-active", flipVState);
}

function isIdentityAdjust(): boolean {
  return resizePct === 100 && rotateDeg === 0 && !flipHState && !flipVState;
}

function updateAdjust(): void {
  const parts: string[] = [];
  if (resizePct !== 100) parts.push(`${resizePct}%`);
  if (rotateDeg !== 0) parts.push(`↻${rotateDeg}°`);
  if (flipHState) parts.push("↔");
  if (flipVState) parts.push("↕");
  adjustState.textContent = parts.length ? parts.join(" · ") : "Original";
  adjustState.classList.toggle("is-on", parts.length > 0);
  updateDimReadout();
  scheduleReclean();
}

function outputDims(): { w: number; h: number } | null {
  if (!loadedDims) return null;
  let w = loadedDims.w;
  let h = loadedDims.h;
  if (rotateDeg === 90 || rotateDeg === 270) [w, h] = [h, w];
  w = Math.max(1, Math.round((w * resizePct) / 100));
  h = Math.max(1, Math.round((h * resizePct) / 100));
  return { w, h };
}

function updateDimReadout(): void {
  const out = outputDims();
  if (!loadedDims || !out || isIdentityAdjust()) {
    dimReadout.hidden = true;
    dimReadout.textContent = "";
    return;
  }
  dimReadout.hidden = false;
  dimReadout.textContent = `${loadedDims.w}×${loadedDims.h} → ${out.w}×${out.h}`;
}

function setStage(stage: SanitizeStage, pct: number): void {
  progressStage.textContent = STAGE_TEXT[stage];
  setProgress(pct);
}

function setProgress(pct: number): void {
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function setStatus(message: string, tone: "good" | "bad" | "muted"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function clearDownload(): void {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  downloadArea.innerHTML = "";
}

function setInputPreview(url: string | null): void {
  if (inputPreviewUrl) {
    URL.revokeObjectURL(inputPreviewUrl);
    inputPreviewUrl = null;
  }
  inputPreview.src = url ?? "";
  fileThumb.src = url ?? "";
  procPreview.src = url ?? "";
  if (url) {
    inputPreviewUrl = url;
  }
}

function setOutputPreview(url: string | null): void {
  if (outputPreviewUrl && outputPreviewUrl !== url) {
    URL.revokeObjectURL(outputPreviewUrl);
    outputPreviewUrl = null;
  }
  outputPreview.src = url ?? "";
  if (url) {
    outputPreviewUrl = url;
  }
}

function loadDimensions(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function syncUltraParanoidUi(): void {
  const active = ultraParanoid.checked;
  outputFormat.disabled = active;
  quality.disabled = active;
  advanced.classList.toggle("disabled", active);
  if (active) {
    outputFormat.value = "image/png";
  }
}

function warmCore(): void {
  void client.warm().catch(() => {});
}
const ric: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
if (typeof ric === "function") {
  ric(warmCore, { timeout: 2000 });
} else {
  window.setTimeout(warmCore, 200);
}

(window as unknown as { __sanitizeBench?: unknown }).__sanitizeBench = async (
  buffer: ArrayBuffer,
  sourceType: string,
  outputType: SupportedFormat | "same",
  ultra: boolean,
  resizePct = 100,
) => {
  const res = await client.sanitize({
    sourceType,
    inputBuffer: buffer,
    outputType,
    quality: 0.92,
    ultraParanoid: ultra,
    resizePct,
    rotate: 0,
    flipH: false,
    flipV: false,
  });
  return {
    timing: res.timing,
    outBytes: res.outputBuffer.byteLength,
    width: res.width,
    height: res.height,
  };
};
