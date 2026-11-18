export type Tool = "photo" | "video" | "link";

const ORDER: Tool[] = ["photo", "video", "link"];
const HASH: Record<Tool, string> = { photo: "#photos", video: "#videos", link: "#links" };

export class ToolMenu {
  private tabs: HTMLButtonElement[];
  private onChange: (tool: Tool) => void;
  current: Tool;

  constructor(onChange: (tool: Tool) => void) {
    this.onChange = onChange;
    this.tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tool-tab]")];
    this.current = toolFromHash(location.hash) ?? "photo";
    for (const tab of this.tabs) {
      tab.addEventListener("click", () => this.select(tab.dataset.toolTab as Tool));
      tab.addEventListener("keydown", (event) => this.onKey(event));
    }
    window.addEventListener("hashchange", () => {
      const tool = toolFromHash(location.hash);
      if (tool) this.select(tool);
    });
    this.render();
  }

  select(tool: Tool, focus = false): void {
    if (focus) this.tabs.find((t) => t.dataset.toolTab === tool)?.focus();
    if (tool === this.current) return;
    this.current = tool;
    this.render();
    history.replaceState(null, "", HASH[tool]);
    this.onChange(tool);
  }

  private onKey(event: KeyboardEvent): void {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const i = ORDER.indexOf(this.current);
    this.select(ORDER[(i + step + ORDER.length) % ORDER.length], true);
  }

  private render(): void {
    document.body.dataset.tool = this.current;
    for (const tab of this.tabs) {
      const on = tab.dataset.toolTab === this.current;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  }
}

function toolFromHash(hash: string): Tool | null {
  const found = ORDER.find((t) => HASH[t] === hash.toLowerCase());
  return found ?? null;
}
