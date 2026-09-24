import {
  cornerBox,
  fillBox,
  fillCircle,
  fillLine,
  maskBBox,
  maskCoverage,
  remapMask,
  type Box,
  type MaskOps,
} from "./maskOps";

export type Corner = "tl" | "tr" | "bl" | "br";
type MaskTool = "brush" | "eraser";
type Proposal = Box & { label: string; accepted: boolean };

type Rect = { left: number; top: number; width: number; height: number };

const DEFAULT_CORNER = { widthPct: 22, heightPct: 12 };

export class MaskEditor {
  private frame: HTMLElement;
  private image: HTMLImageElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mask: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private tool: MaskTool = "brush";
  private sizePct = 6;
  private active = false;
  private drawing = false;
  private last: { x: number; y: number } | null = null;
  private proposals: Proposal[] = [];
  private ro: ResizeObserver;
  private onChange: () => void;

  constructor(frame: HTMLElement, image: HTMLImageElement, onChange: () => void) {
    this.frame = frame;
    this.image = image;
    this.onChange = onChange;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mask-layer";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Mask: nothing marked");
    this.canvas.hidden = true;
    frame.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    this.ctx = ctx;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(frame);
    this.image.addEventListener("load", () => this.resize());
    this.bind();
  }

  setDims(width: number, height: number): void {
    if (width === this.width && height === this.height && this.mask) return;
    if (this.mask && this.width && this.height) {
      this.mask = remapMask(this.mask, this.width, this.height, {
        flipH: false,
        flipV: false,
        rotate: 0,
        toWidth: width,
        toHeight: height,
      }).mask;
    } else {
      this.mask = new Uint8Array(width * height);
    }
    this.width = width;
    this.height = height;
    this.proposals = [];
    this.resize();
    this.emit();
  }

  remap(ops: Omit<MaskOps, "toWidth" | "toHeight">, toWidth: number, toHeight: number): void {
    if (!this.mask) return;
    const r = remapMask(this.mask, this.width, this.height, { ...ops, toWidth, toHeight });
    this.mask = r.mask;
    this.width = r.w;
    this.height = r.h;
    this.proposals = [];
    this.resize();
    this.emit();
  }

  setActive(on: boolean): void {
    this.active = on;
    this.canvas.hidden = !on || !this.mask;
    this.canvas.classList.toggle("is-active", on);
    if (on) {
      this.resize();
      this.canvas.focus({ preventScroll: true });
    }
  }

  setTool(tool: MaskTool): void {
    this.tool = tool;
  }

  getTool(): MaskTool {
    return this.tool;
  }

  setSizePct(pct: number): void {
    this.sizePct = Math.min(20, Math.max(1, pct));
  }

  getSizePct(): number {
    return this.sizePct;
  }

  applyCorner(corner: Corner, widthPct = DEFAULT_CORNER.widthPct, heightPct = DEFAULT_CORNER.heightPct): void {
    if (!this.mask) return;
    fillBox(this.mask, this.width, this.height, cornerBox(this.width, this.height, corner, widthPct, heightPct), 255);
    this.render();
    this.emit();
  }

  clear(): void {
    if (!this.mask) return;
    this.mask.fill(0);
    this.proposals = [];
    this.render();
    this.emit();
  }

  setProposals(boxes: { x: number; y: number; w: number; h: number; label: string }[]): void {
    this.proposals = boxes.map((b) => ({ ...b, accepted: false }));
    this.render();
    this.emit();
  }

  acceptAllProposals(): void {
    for (const p of this.proposals) p.accepted = true;
    this.rasterizeAccepted();
  }

  hasProposals(): boolean {
    return this.proposals.length > 0;
  }

  getMask(): { mask: Uint8Array; width: number; height: number } | null {
    if (!this.mask || maskCoverage(this.mask) === 0) return null;
    return { mask: this.mask, width: this.width, height: this.height };
  }

  coverage(): number {
    return this.mask ? maskCoverage(this.mask) : 0;
  }

  bbox(): Box | null {
    return this.mask ? maskBBox(this.mask, this.width, this.height) : null;
  }

  destroy(): void {
    this.ro.disconnect();
    this.canvas.remove();
  }

  resize(): void {
    const box = this.imageBox();
    if (!box || !this.mask) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.left = `${box.left}px`;
    this.canvas.style.top = `${box.top}px`;
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.canvas.width = Math.max(1, Math.round(box.width * dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * dpr));
    this.render();
  }

  private imageBox(): Rect | null {
    const img = this.image;
    if (img.hidden || !img.naturalWidth || !img.naturalHeight) return null;
    const frameRect = this.frame.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    return {
      left: rect.left - frameRect.left + (rect.width - width) / 2,
      top: rect.top - frameRect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  private toPixel(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * this.width,
      y: ((ev.clientY - rect.top) / rect.height) * this.height,
    };
  }

  private radius(): number {
    return Math.max(1, (Math.min(this.width, this.height) * this.sizePct) / 200);
  }

  private bind(): void {
    this.canvas.addEventListener("pointerdown", (ev) => {
      if (!this.active || !this.mask) return;
      if (this.proposals.length && this.hitProposal(ev)) return;
      ev.preventDefault();
      this.canvas.setPointerCapture(ev.pointerId);
      this.drawing = true;
      const p = this.toPixel(ev);
      fillCircle(this.mask, this.width, this.height, p.x, p.y, this.radius(), this.tool === "brush" ? 255 : 0);
      this.last = p;
      this.render();
    });
    this.canvas.addEventListener("pointermove", (ev) => {
      if (!this.drawing || !this.mask) return;
      const events = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [ev];
      for (const e of events.length ? events : [ev]) {
        const p = this.toPixel(e);
        if (this.last) fillLine(this.mask, this.width, this.height, this.last.x, this.last.y, p.x, p.y, this.radius(), this.tool === "brush" ? 255 : 0);
        this.last = p;
      }
      this.render();
    });
    const stop = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.last = null;
      this.emit();
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
    this.canvas.addEventListener("keydown", (ev) => {
      if (!this.active) return;
      const key = ev.key.toLowerCase();
      if (key === "b") this.tool = "brush";
      else if (key === "e") this.tool = "eraser";
      else if (key === "[") this.setSizePct(this.sizePct - 1);
      else if (key === "]") this.setSizePct(this.sizePct + 1);
      else if (key === "1") this.applyCorner("tl");
      else if (key === "2") this.applyCorner("tr");
      else if (key === "3") this.applyCorner("bl");
      else if (key === "4") this.applyCorner("br");
      else if (key === "delete" || key === "backspace") this.clear();
      else return;
      ev.preventDefault();
      this.emit();
    });
  }

  private hitProposal(ev: PointerEvent): boolean {
    const p = this.toPixel(ev);
    const hit = this.proposals.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (!hit) return false;
    hit.accepted = !hit.accepted;
    this.rasterizeAccepted();
    return true;
  }

  private rasterizeAccepted(): void {
    if (!this.mask) return;
    for (const p of this.proposals) if (p.accepted) fillBox(this.mask, this.width, this.height, p, 255);
    this.proposals = this.proposals.filter((p) => !p.accepted);
    this.render();
    this.emit();
  }

  private render(): void {
    if (!this.mask) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / this.width;
    const sy = canvas.height / this.height;
    const img = ctx.createImageData(this.width, this.height);
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] >= 128) {
        img.data[i * 4] = 232;
        img.data[i * 4 + 1] = 64;
        img.data[i * 4 + 2] = 43;
        img.data[i * 4 + 3] = 115;
      }
    }
    const off = document.createElement("canvas");
    off.width = this.width;
    off.height = this.height;
    off.getContext("2d")?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1.5, 2 * (canvas.width / Math.max(canvas.clientWidth, 1)));
    for (const p of this.proposals) {
      ctx.strokeStyle = p.accepted ? "#157a4a" : "#d4b25a";
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy);
    }
    ctx.setLineDash([]);
  }

  private emit(): void {
    const pct = Math.round(this.coverage() * 100);
    this.canvas.setAttribute("aria-label", pct ? `Mask: ${pct} percent of the image marked` : "Mask: nothing marked");
    this.onChange();
  }
}
