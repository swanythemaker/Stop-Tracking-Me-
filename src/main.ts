import "./styles/base.css";
import "./styles/stepflow.css";
import "./styles/results.css";
import "./styles/docs.css";

import {
  describeAudit,
  mediaKindOf,
  videoTypeFor,
  MAX_VIDEO_BYTES,
  type AuditSummary,
  type MediaKind,
  type SupportedFormat,
} from "./sanitizer/formats";
import type { Stage, VideoContainer, VideoSuccess, WorkerSuccess } from "./sanitizer/types";
import { SanitizeClient } from "./sanitizer/client";
import { probeVideoCapability, capabilityCopy, type VideoCapability } from "./sanitizer/capability";
import { appMarkup } from "./ui/template";
import { StepFlow } from "./ui/stepflow";
import { must, formatBytes, shortType, extForMime, explainError } from "./ui/format";
import { renderVerdict, renderDownload, renderScanCard } from "./ui/render";
import { setMediaPreview, loadImageDimensions, loadVideoDimensions, formatDuration, type PreviewPair } from "./ui/preview";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}
app.innerHTML = appMarkup();

const client = new SanitizeClient();

const fileInput = must<HTMLInputElement>("#fileInput");
const dropzone = must<HTMLElement>("#dropzone");
const fileCard = must<HTMLElement>("#fileCard");
const fileName = must<HTMLElement>("#fileName");
const fileFacts = must<HTMLElement>("#fileFacts");
const clearFile = must<HTMLButtonElement>("#clearFile");
const status = must<HTMLElement>("#status");
const capNote = must<HTMLElement>("#capNote");

const procFrame = must<HTMLElement>("#procFrame");
const progressFill = must<HTMLElement>("#progressFill");
const progressStage = must<HTMLElement>("#progressStage");
const progressDetail = must<HTMLElement>("#progressDetail");
const cancelBtn = must<HTMLButtonElement>("#cancelBtn");

const resultHeadline = must<HTMLElement>("#resultHeadline");
const verdict = must<HTMLElement>("#verdict");
const origSize = must<HTMLElement>("#origSize");
const outSize = must<HTMLElement>("#outSize");
const outCaption = must<HTMLElement>("#outCaption");
const outFrame = must<HTMLElement>("#outFrame");
const framePending = must<HTMLElement>("#framePending");
const downloadArea = must<HTMLElement>("#downloadArea");
const editBtn = must<HTMLButtonElement>("#editBtn");
const newImageBtn = must<HTMLButtonElement>("#newImageBtn");
const editDone = must<HTMLButtonElement>("#editDone");

const thumbPair: PreviewPair = { img: must("#fileThumb"), video: must("#fileThumbVideo") };
const procPair: PreviewPair = { img: must("#procPreview"), video: must("#procPreviewVideo") };
const inputPair: PreviewPair = { img: must("#inputPreview"), video: must("#inputPreviewVideo") };
const outputPair: PreviewPair = { img: must("#outputPreview"), video: must("#outputPreviewVideo") };

const inputScanCard = must<HTMLElement>("#inputScanCard");
const outputScanCard = must<HTMLElement>("#outputScanCard");
const inputReport = must<HTMLElement>("#inputReport");
const outputReport = must<HTMLElement>("#outputReport");

const outputFormat = must<HTMLSelectElement>("#outputFormat");
const quality = must<HTMLInputElement>("#quality");
const qualityValue = must<HTMLElement>("#qualityValue");
const ultraParanoid = must<HTMLInputElement>("#ultraParanoid");
const ultraHint = must<HTMLElement>("#ultraHint");
const advanced = must<HTMLElement>("#advanced");
const videoOptions = must<HTMLElement>("#videoOptions");
const keepAudio = must<HTMLInputElement>("#keepAudio");
const videoContainerRow = must<HTMLElement>("#videoContainerRow");
const videoContainer = must<HTMLSelectElement>("#videoContainer");
const engineNote = must<HTMLElement>("#engineNote");
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

const STAGE_TEXT: Record<Stage, string> = {
  read: "Reading file…",
  probe: "Reading video…",
  scan: "Scanning metadata…",
  decode: "Decoding…",
  transform: "Applying edits…",
  encode: "Re-encoding a clean copy…",
  mux: "Writing container…",
  remux: "Rebuilding container…",
  strip: "Stripping metadata…",
  audit: "Auditing output…",
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_TRANSITION_MS = 2500;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let selectedFile: File | null = null;
let selectedKind: MediaKind | null = null;
let selectedType = "";
let lastInputAudit: AuditSummary | null = null;
let cleanedOnce = false;
let busy = false;
let pendingReclean = false;
let recleanTimer: number | undefined;
let downloadUrl: string | null = null;
let inputPreviewUrl: string | null = null;
let outputPreviewUrl: string | null = null;
let dragDepth = 0;
let currentRequestId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;
let videoCap: VideoCapability | null = null;

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
keepAudio.addEventListener("change", scheduleReclean);
videoContainer.addEventListener("change", scheduleReclean);

const resizeSegs = Array.from(resizeChips.querySelectorAll<HTMLButtonElement>("button[data-pct]"));
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
cancelBtn.addEventListener("click", () => cancelCurrent());

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
  cancelCurrent();
  clearDownload();
  selectedFile = null;
  selectedKind = null;
  selectedType = "";
  lastInputAudit = null;
  resetResultUi();

  if (!file) {
    inputReport.textContent = "No file loaded.";
    inputScanCard.innerHTML = "";
    setStatus("Select an image or video to begin.", "muted");
    setInputPreview(null, null);
    capNote.hidden = true;
    fileCard.hidden = true;
    loadedDims = null;
    updateDimReadout();
    syncMediaUi();
    flow.goTo(0);
    return;
  }

  const kind = mediaKindOf(file.type, file.name);
  if (!kind) {
    inputReport.textContent = `Unsupported type: ${file.type || "unknown"}`;
    inputScanCard.innerHTML = "";
    setStatus(
      `Unsupported file type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG, WebP, MP4, MOV or WebM.`,
      "bad",
    );
    setInputPreview(null, null);
    capNote.hidden = true;
    fileCard.hidden = true;
    flow.goTo(0);
    return;
  }

  if (kind === "video" && file.size > MAX_VIDEO_BYTES) {
    inputReport.textContent = "File too large.";
    inputScanCard.innerHTML = "";
    setStatus(`File is ${formatBytes(file.size)}, over the ${formatBytes(MAX_VIDEO_BYTES)} limit for video.`, "bad");
    setInputPreview(null, null);
    capNote.hidden = true;
    fileCard.hidden = true;
    flow.goTo(0);
    return;
  }

  selectedFile = file;
  selectedKind = kind;
  selectedType = kind === "video" ? (videoTypeFor(file.type, file.name) ?? file.type) : file.type;
  syncMediaUi();

  const previewUrl = URL.createObjectURL(file);
  setInputPreview(previewUrl, kind);
  fileName.textContent = file.name;
  origSize.textContent = formatBytes(file.size);
  fileCard.hidden = false;

  loadedDims = null;
  if (kind === "image") {
    void loadImageDimensions(previewUrl).then((dim) => {
      if (selectedFile !== file) return;
      fileFacts.textContent = [shortType(selectedType), dim ? `${dim.w}×${dim.h}` : null, formatBytes(file.size)]
        .filter(Boolean)
        .join("  ·  ");
      loadedDims = dim;
      updateDimReadout();
    });
  } else {
    void loadVideoDimensions(previewUrl).then((dim) => {
      if (selectedFile !== file) return;
      fileFacts.textContent = [
        shortType(selectedType),
        dim ? `${dim.w}×${dim.h}` : null,
        dim ? formatDuration(dim.durationS) : null,
        formatBytes(file.size),
      ]
        .filter(Boolean)
        .join("  ·  ");
      loadedDims = dim ? { w: dim.w, h: dim.h } : null;
      updateDimReadout();
    });
  }

  inputReport.textContent = "Scanning…";
  inputScanCard.innerHTML = "";
  setStatus("Scanning metadata…", "muted");

  if (kind === "video") {
    videoCap = await probeVideoCapability({ wasmReady: () => client.warm() });
    if (selectedFile !== file) return;
    showCapability(videoCap);
    if (videoCap.mode === "none") {
      setStatus("Video is not supported in this browser. Images still work.", "bad");
      return;
    }
    const { audit } = await client.auditVideo(file);
    if (selectedFile !== file) return;
    lastInputAudit = audit;
  } else {
    const inputBytes = await file.arrayBuffer();
    const { audit } = await client.audit({ sourceType: file.type, inputBuffer: inputBytes });
    if (selectedFile !== file) return;
    lastInputAudit = audit;
  }
  inputReport.textContent = describeAudit(lastInputAudit);
  renderScanCard(inputScanCard, lastInputAudit, "Input scan");

  await clean("first");
}

async function clean(mode: "first" | "reclean"): Promise<void> {
  if (!selectedFile || !selectedKind || busy) {
    if (mode === "reclean") pendingReclean = true;
    return;
  }
  busy = true;
  const isVideo = selectedKind === "video";

  if (mode === "first") {
    setMediaPreview(procPair, inputPreviewUrl, selectedKind);
    procFrame.classList.remove("done");
    progressDetail.hidden = true;
    cancelBtn.hidden = !isVideo;
    setStage(isVideo ? "probe" : "read", 2);
    flow.goTo(1, { focus: true });
  } else {
    outFrame.classList.add("loading");
    framePending.hidden = true;
  }
  clearDownload();

  const started = performance.now();
  try {
    let res: WorkerSuccess;
    if (isVideo) {
      await requestWakeLock();
      const cap = videoCap ?? (await probeVideoCapability());
      const job = client.sanitizeVideo(
        {
          file: selectedFile,
          sourceType: selectedType,
          engine: cap.mode === "reencode" ? "reencode" : "remux",
          encoder: cap.encoder,
          audio: cap.audio.aac ? { codec: "mp4a.40.2" } : cap.audio.opus ? { codec: "opus" } : null,
          keepAudio: keepAudio.checked,
          ultraParanoid: ultraParanoid.checked,
          outputContainer: videoContainer.value as VideoContainer | "auto",
          resizePct,
          rotate: rotateDeg,
          flipH: flipHState,
          flipV: flipVState,
        },
        (stage, pct, detail, etaS) => setStage(stage, pct, detail, etaS),
      );
      currentRequestId = job.requestId;
      res = await job.result;
    } else {
      const inputBuffer = await selectedFile.arrayBuffer();
      res = await client.sanitize(
        {
          sourceType: selectedFile.type,
          inputBuffer,
          outputType: outputFormat.value === "same" ? "same" : (outputFormat.value as SupportedFormat),
          quality: Number(quality.value) / 100,
          ultraParanoid: ultraParanoid.checked,
          resizePct,
          rotate: rotateDeg,
          flipH: flipHState,
          flipV: flipVState,
        },
        (stage, pct) => setStage(stage, pct),
      );
    }

    if (mode === "first") {
      const minDelay = reducedMotion || isVideo ? 0 : MIN_TRANSITION_MS;
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
    const message = err instanceof Error ? err.message : "Unknown worker error";
    if (/Cancelled/.test(message)) {
      resetToUpload();
    } else {
      populateError(message);
      cleanedOnce = true;
      if (mode === "first") flow.goTo(2, { focus: true });
    }
  } finally {
    busy = false;
    currentRequestId = null;
    cancelBtn.hidden = true;
    progressDetail.hidden = true;
    releaseWakeLock();
    outFrame.classList.remove("loading");
    flow.syncHeight();
    if (pendingReclean) {
      pendingReclean = false;
      scheduleReclean();
    }
  }
}

function populateResult(res: WorkerSuccess): void {
  outputReport.textContent = describeAudit(res.outputAudit);
  renderScanCard(outputScanCard, res.outputAudit, "Output scan");

  const blob = res.media === "video" ? res.outputBlob : new Blob([res.outputBuffer], { type: res.outputType });
  const outBytes = blob.size;
  const safeName = `sanitized_${Date.now()}${extForMime(res.outputType)}`;
  const url = URL.createObjectURL(blob);
  downloadUrl = url;
  setOutputPreview(url, res.media);
  outSize.textContent = formatBytes(outBytes);
  framePending.hidden = true;

  renderDownload(downloadArea, url, safeName, outBytes, res.media);
  const video = res.media === "video" ? (res as VideoSuccess) : null;
  renderVerdict(verdict, true, "", {
    inBytes: res.inputByteLength,
    outBytes,
    width: res.width,
    height: res.height,
    origWidth: res.origWidth,
    origHeight: res.origHeight,
    media: res.media,
    engine: video?.engine,
    audioKept: video?.audioKept,
    durationS: video?.durationS,
    note: video?.engineReason && video.engine === "remux" && videoCap?.mode === "reencode" ? `Basic clean used: ${video.engineReason}` : undefined,
  });
  if (video) syncEngineNote(video.engine);

  const markers = lastInputAudit ? new Set(lastInputAudit.markers.map((m) => m.trim()).filter(Boolean)) : new Set<string>();
  const n = markers.size;
  resultHeadline.classList.remove("bad");
  resultHeadline.textContent =
    n > 0 ? `✓ Stripped: ${n} hidden ${n === 1 ? "tag" : "tags"} removed` : "✓ Clean: re-encoded with no metadata";
  setStatus("Done. Output passed the strict fail-closed audit.", "good");
}

function populateError(message: string): void {
  const info = explainError(message);
  framePending.hidden = false;
  framePending.textContent = "Blocked";
  outputReport.textContent = message;
  outSize.textContent = "";
  setOutputPreview(null, null);
  clearDownload();
  renderVerdict(verdict, false, info.detail, undefined, info.title);
  renderScanCard(outputScanCard, null, "Output scan", message);
  resultHeadline.classList.add("bad");
  resultHeadline.textContent = "Export blocked: nothing to download";
  setStatus(info.status, "bad");
}

function cancelCurrent(): void {
  if (currentRequestId !== null) client.cancel(currentRequestId);
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
  setOutputPreview(null, null);
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
    seg.classList.toggle("is-active", !customResize && Number(seg.dataset.pct) === resizePct);
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
  if (selectedKind === "video") {
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
  }
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

function setStage(stage: Stage, pct: number, detail?: string, etaS?: number): void {
  progressStage.textContent = STAGE_TEXT[stage];
  setProgress(pct);
  if (detail) {
    const eta = etaS !== undefined && etaS > 1 ? ` · about ${formatDuration(etaS)} left` : "";
    progressDetail.textContent = `${detail}${eta}`;
    progressDetail.hidden = false;
  }
}

function setProgress(pct: number): void {
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function setStatus(message: string, tone: "good" | "bad" | "muted"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function showCapability(cap: VideoCapability): void {
  const copy = capabilityCopy(cap);
  capNote.textContent = copy.advice ? `${copy.label}. ${copy.advice}` : `${copy.label}. ${copy.detail}`;
  capNote.dataset.tone = cap.mode === "reencode" ? "good" : cap.mode === "remux" ? "muted" : "bad";
  capNote.hidden = false;
  syncEngineNote(cap.mode === "reencode" ? "reencode" : "remux");
}

function syncEngineNote(engine: "reencode" | "remux"): void {
  engineNote.textContent =
    engine === "reencode"
      ? "Full clean: frames are decoded and re-encoded."
      : "Basic clean: metadata strip only, picture and sound untouched.";
}

function syncMediaUi(): void {
  const isVideo = selectedKind === "video";
  outCaption.textContent = isVideo ? "Clean video" : "Clean image";
  videoOptions.hidden = !isVideo;
  advanced.hidden = isVideo;
  syncUltraParanoidUi();
}

function clearDownload(): void {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  downloadArea.innerHTML = "";
}

function setInputPreview(url: string | null, kind: MediaKind | null): void {
  if (inputPreviewUrl) {
    URL.revokeObjectURL(inputPreviewUrl);
    inputPreviewUrl = null;
  }
  setMediaPreview(inputPair, url, kind);
  setMediaPreview(thumbPair, url, kind);
  setMediaPreview(procPair, url, kind);
  if (url) {
    inputPreviewUrl = url;
  }
}

function setOutputPreview(url: string | null, kind: MediaKind | null): void {
  if (outputPreviewUrl && outputPreviewUrl !== url) {
    URL.revokeObjectURL(outputPreviewUrl);
    outputPreviewUrl = null;
  }
  setMediaPreview(outputPair, url, kind);
  if (url) {
    outputPreviewUrl = url;
  }
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function syncUltraParanoidUi(): void {
  const active = ultraParanoid.checked;
  const isVideo = selectedKind === "video";
  outputFormat.disabled = active;
  quality.disabled = active;
  advanced.classList.toggle("disabled", active);
  keepAudio.disabled = active;
  videoContainer.disabled = active;
  videoContainerRow.classList.toggle("disabled", active);
  ultraHint.textContent = isVideo
    ? "Always re-encode when possible · sound removed · MP4 output"
    : "Force PNG output · strict fail-closed checks";
  if (active) {
    outputFormat.value = "image/png";
    videoContainer.value = "auto";
  }
}

async function requestWakeLock(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
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

(window as unknown as { __sanitizeVideoBench?: unknown }).__sanitizeVideoBench = async (
  file: File,
  engine: "reencode" | "remux",
  resizePct = 100,
) => {
  const cap = await probeVideoCapability();
  const res = await client.sanitizeVideo({
    file,
    sourceType: videoTypeFor(file.type, file.name) ?? file.type,
    engine: engine === "reencode" && cap.mode === "reencode" ? "reencode" : "remux",
    encoder: cap.encoder,
    audio: null,
    keepAudio: false,
    ultraParanoid: false,
    outputContainer: "auto",
    resizePct,
    rotate: 0,
    flipH: false,
    flipV: false,
  }).result;
  return {
    timing: res.timing,
    outBytes: res.outputBlob.size,
    width: res.width,
    height: res.height,
    engine: res.engine,
    codecName: res.codecName,
  };
};
