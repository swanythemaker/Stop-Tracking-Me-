import "../styles/base.css";
import "../styles/docs.css";
import "../styles/pages.css";
import { MECHANISMS, TRACKERS, type Tracker } from "../links/explain";
import { escapeHtml, mount, pageShell } from "./chrome";

const groups = new Map<string, Tracker[]>();
for (const t of TRACKERS) groups.set(t.company, [...(groups.get(t.company) ?? []), t]);

mount(
  pageShell({
    eyebrow: "Links",
    title: "Every tracker explained",
    lead: "Every tag the link cleaner removes: who adds it, what it gives away, and the details for nerds. Tap a tag in the cleaner to land here.",
    body: `
    <section class="panel page-panel">
      <label class="field-label" for="trackerSearch">Find a tag, a site or a company</label>
      <input id="trackerSearch" class="tracker-search" type="search" placeholder="fbclid, utm_source, X, Amazon…" autocomplete="off" spellcheck="false" />
      <p class="tracker-count" id="trackerCount"></p>
      <h2 class="group-title">How links track you</h2>
      <div class="tracker-grid">${MECHANISMS.map(card).join("")}</div>
      ${[...groups].map(([company, list]) => `
      <h2 class="group-title" data-group>${escapeHtml(company)}</h2>
      <div class="tracker-grid">${list.map(card).join("")}</div>`).join("")}
    </section>`,
  }),
);

function card(t: Tracker): string {
  const keys = t.keys.map((k) => (k === "*" ? "<code>any other tag</code>" : `<code>${escapeHtml(k)}</code>`)).join(" ");
  const sources = t.sources
    .map((s) => `<li><a href="${escapeHtml(s)}" rel="noopener noreferrer">${escapeHtml(sourceLabel(s))}</a></li>`)
    .join("");
  const search = [t.name, t.company, ...t.keys, ...(t.hosts ?? [])].join(" ").toLowerCase();
  const where = t.hosts ? `<p class="tracker-where">On ${t.hosts.map((d) => escapeHtml(d.replace(".*", ""))).join(", ")}</p>` : "";
  return `
    <article class="tracker" id="${t.id}" data-search="${escapeHtml(search)}">
      <header>
        <h3>${escapeHtml(t.name)}</h3>
        ${keys ? `<p class="tracker-keys">${keys}</p>` : ""}
      </header>
      ${where}
      <p>${escapeHtml(t.plain)}</p>
      <p class="tracker-reveals"><b>What it gives away:</b> ${escapeHtml(t.reveals)}</p>
      <details>
        <summary>For nerds</summary>
        <p>${escapeHtml(t.nerd)}</p>
        ${t.example ? `<p class="tracker-example">Example: <code>${escapeHtml(t.example)}</code></p>` : ""}
        <p class="tracker-confidence">How sure we are: <b>${t.confidence}</b></p>
        ${sources ? `<ul class="tracker-sources">${sources}</ul>` : ""}
      </details>
    </article>`;
}

function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : "");
  } catch {
    return url;
  }
}

const search = document.querySelector<HTMLInputElement>("#trackerSearch")!;
const count = document.querySelector<HTMLElement>("#trackerCount")!;
const cards = [...document.querySelectorAll<HTMLElement>(".tracker")];

function filter(): void {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  for (const c of cards) {
    const hit = !q || c.dataset.search!.includes(q) || c.textContent!.toLowerCase().includes(q);
    c.hidden = !hit;
    if (hit) shown++;
  }
  for (const grid of document.querySelectorAll<HTMLElement>(".tracker-grid")) {
    const any = [...grid.children].some((c) => !(c as HTMLElement).hidden);
    grid.hidden = !any;
    const title = grid.previousElementSibling as HTMLElement | null;
    if (title?.classList.contains("group-title")) title.hidden = !any;
  }
  count.textContent = q ? `${shown} of ${cards.length} entries` : `${cards.length} entries`;
}

search.addEventListener("input", filter);
filter();

function openFromHash(): void {
  const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (!target) return;
  target.querySelector("details")?.setAttribute("open", "");
  target.classList.add("is-target");
  target.scrollIntoView({ block: "start" });
}

window.addEventListener("hashchange", openFromHash);
openFromHash();
