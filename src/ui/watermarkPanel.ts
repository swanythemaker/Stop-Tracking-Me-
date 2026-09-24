import { must, formatBytes } from "./format";
import type { MaskEditor, Corner } from "./maskEditor";

type InpaintEngine = "migan" | "lama";

type PanelHandlers = {
  onRemove: () => void;
  onFind: () => void;
  onReduceChange: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

export class WatermarkPanel {
  readonly root = must<HTMLElement>("#watermarkTools");
  readonly reduce = must<HTMLInputElement>("#reduceAi");
  private engine: InpaintEngine = "migan";
  private state = must<HTMLElement>("#maskState");
  private progress = must<HTMLElement>("#modelProgress");
  private progressFill = must<HTMLElement>("#modelProgressFill");
  private progressText = must<HTMLElement>("#modelProgressText");
  private store = must<HTMLElement>("#modelStore");
  private removeBtn = must<HTMLButtonElement>("#removeBtn");
  private findBtn = must<HTMLButtonElement>("#findWatermark");
  private acceptBtn = must<HTMLButtonElement>("#acceptProposals");
  private editor: MaskEditor;

  constructor(editor: MaskEditor, handlers: PanelHandlers) {
    this.editor = editor;
    const brush = must<HTMLButtonElement>("#maskBrush");
    const eraser = must<HTMLButtonElement>("#maskEraser");
    brush.addEventListener("click", () => {
      editor.setTool("brush");
      brush.classList.add("is-active");
      eraser.classList.remove("is-active");
    });
    eraser.addEventListener("click", () => {
      editor.setTool("eraser");
      eraser.classList.add("is-active");
      brush.classList.remove("is-active");
    });
    must<HTMLInputElement>("#maskSize").addEventListener("input", (ev) => {
      editor.setSizePct(Number((ev.target as HTMLInputElement).value));
    });
    must<HTMLButtonElement>("#maskClear").addEventListener("click", () => editor.clear());
    const corners: [string, Corner][] = [
      ["#maskCornerTl", "tl"],
      ["#maskCornerTr", "tr"],
      ["#maskCornerBl", "bl"],
      ["#maskCornerBr", "br"],
    ];
    for (const [sel, corner] of corners) {
      must<HTMLButtonElement>(sel).addEventListener("click", () => editor.applyCorner(corner));
    }
    const engineButtons = Array.from(must<HTMLElement>("#inpaintEngine").querySelectorAll<HTMLButtonElement>("button[data-engine]"));
    for (const b of engineButtons) {
      b.addEventListener("click", () => {
        this.engine = b.dataset.engine as InpaintEngine;
        for (const o of engineButtons) o.classList.toggle("is-active", o === b);
      });
    }
    this.acceptBtn.addEventListener("click", () => {
      editor.acceptAllProposals();
      this.acceptBtn.hidden = true;
    });
    this.removeBtn.addEventListener("click", handlers.onRemove);
    this.findBtn.addEventListener("click", handlers.onFind);
    this.reduce.addEventListener("change", handlers.onReduceChange);
    must<HTMLButtonElement>("#deleteModels").addEventListener("click", handlers.onDelete);
    must<HTMLButtonElement>("#modelCancel").addEventListener("click", handlers.onCancel);
    this.syncState();
  }

  getEngine(): InpaintEngine {
    return this.engine;
  }

  syncState(): void {
    const pct = Math.round(this.editor.coverage() * 100);
    this.state.textContent = pct ? `${pct} percent marked` : "Nothing marked";
    this.removeBtn.disabled = pct === 0;
    this.acceptBtn.hidden = !this.editor.hasProposals();
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  setBusy(on: boolean): void {
    this.removeBtn.disabled = on || this.editor.coverage() === 0;
    this.findBtn.disabled = on;
  }

  setModelProgress(label: string | null, loaded = 0, total = 0): void {
    if (!label) {
      this.progress.hidden = true;
      return;
    }
    this.progress.hidden = false;
    const pct = total > 0 ? Math.min(100, (100 * loaded) / total) : 0;
    this.progressFill.style.width = `${pct}%`;
    this.progressText.textContent =
      total > 0 ? `${label} · ${formatBytes(loaded)} of ${formatBytes(total)}` : label;
  }

  setStore(bytes: number): void {
    this.store.textContent = bytes > 0 ? `Downloaded models: ${formatBytes(bytes)}` : "Downloaded models: none";
  }
}
