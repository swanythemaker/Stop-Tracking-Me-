import { cleanText, type LinkResult } from "../links/clean";
import { must } from "./format";

export function mountLinkPanel(): void {
  const input = must<HTMLTextAreaElement>("#linkInput");
  const out = must<HTMLElement>("#linkOut");
  const output = must<HTMLTextAreaElement>("#linkOutput");
  const report = must<HTMLUListElement>("#linkReport");
  const summary = must<HTMLElement>("#linkSummary");
  const copy = must<HTMLButtonElement>("#linkCopy");
  const state = must<HTMLElement>("#linkState");

  const update = () => {
    const { text, links } = cleanText(input.value);
    out.hidden = links.length === 0;
    state.textContent = input.value.trim() && links.length === 0 ? "No link found in that text." : "";
    output.value = text;
    report.replaceChildren(...links.map(reportItem));
    const removed = links.reduce((n, l) => n + l.removed.length, 0);
    summary.textContent = summaryLine(links, removed);
    copy.lastElementChild!.textContent = removed > 0 ? "Copy clean link" + (links.length > 1 ? "s" : "") : "Copy";
  };

  input.addEventListener("input", update);

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      state.textContent = "Copied.";
    } catch {
      output.focus();
      output.select();
      state.textContent = "Selected. Press Ctrl+C or Cmd+C to copy.";
    }
  });
}

function reportItem(link: LinkResult): HTMLLIElement {
  const li = document.createElement("li");
  const host = document.createElement("b");
  host.textContent = hostOf(link.clean);
  li.append(host, " ");
  if (link.removed.length) {
    li.append(`Removed: ${link.removed.join(", ")}.`);
    li.dataset.tone = "good";
  } else {
    li.append("Nothing to remove.");
  }
  if (link.shortLink) {
    const note = document.createElement("small");
    note.textContent =
      "This is a short link. Where it leads, and any tracking it adds, is only known to the company behind it. We don't ask them, because that request would tell them you clicked. To see the full address, open it in a private window, then paste the real address here.";
    li.append(note);
    li.dataset.tone = "warn";
  }
  return li;
}

function summaryLine(links: LinkResult[], removed: number): string {
  const cleaned = links.filter((l) => l.removed.length > 0).length;
  const short = links.filter((l) => l.shortLink).length;
  const parts = [removed > 0 ? `Removed ${plural(removed, "tracker")} from ${plural(cleaned, "link")}` : "Nothing to remove"];
  if (short > 0) parts.push(`${plural(short, "short link")} can't be checked`);
  return parts.join(" · ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
