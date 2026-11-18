import { cleanText, type LinkResult } from "../links/clean";
import { explainRemoved, shortLinkHref, type Explained } from "../links/explain";
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
  const host = hostOf(link.clean);
  const head = document.createElement("p");
  head.className = "lr-head";
  const site = document.createElement("b");
  site.textContent = host;
  head.append(site, " ", link.removed.length ? `${plural(link.removed.length, "thing")} removed` : "nothing to remove");
  li.append(head);
  if (link.removed.length) {
    li.dataset.tone = "good";
    const tags = document.createElement("ul");
    tags.className = "lr-tags";
    tags.setAttribute("role", "list");
    const groups = new Map<string, { info: Explained; labels: string[] }>();
    for (const entry of link.removed) {
      const info = explainRemoved(entry, host);
      const key = info.href + info.name;
      const group = groups.get(key);
      if (group) group.labels.push(info.label);
      else groups.set(key, { info, labels: [info.label] });
    }
    for (const { info, labels } of groups.values()) tags.append(tagItem(info, labels));
    li.append(tags);
  }
  if (link.shortLink) {
    const note = document.createElement("p");
    note.className = "lr-note";
    note.append(
      "This is a short link. Only the company behind it knows where it leads and what it tracks, and asking them would tell them you clicked. Open it in a private window, then paste the full address here. ",
      moreLink(shortLinkHref(), "Why"),
    );
    li.append(note);
    li.dataset.tone = "warn";
  }
  return li;
}

function tagItem(info: Explained, labels: string[]): HTMLLIElement {
  const li = document.createElement("li");
  const code = document.createElement("span");
  code.className = "lr-codes";
  for (const label of labels) {
    const c = document.createElement("code");
    c.textContent = label;
    code.append(c);
  }
  const name = document.createElement("strong");
  name.textContent = info.name;
  const text = document.createElement("span");
  text.textContent = info.plain + " ";
  text.append(moreLink(info.href, "More"));
  li.append(code, name, text);
  return li;
}

function moreLink(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  return a;
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
