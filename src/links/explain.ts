import { MECHANISMS, TRACKERS } from "./trackers";

export type Confidence = "documented" | "widely reported" | "inferred";

export interface Tracker {
  id: string;
  company: string;
  name: string;
  keys: string[];
  hosts?: string[];
  plain: string;
  reveals: string;
  nerd: string;
  example?: string;
  confidence: Confidence;
  sources: string[];
}

export interface Explained {
  label: string;
  name: string;
  plain: string;
  href: string;
}

export { MECHANISMS, TRACKERS };

export function explainRemoved(entry: string, host: string): Explained {
  if (entry.startsWith("redirect through ")) {
    return fromTracker(entry.slice("redirect through ".length), mechanism("redirect-wrappers"));
  }
  if (entry === "tracking in the path") return fromTracker("path", mechanism("path-tracking"));
  if (entry === "tracking in the #fragment") return fromTracker("#fragment", mechanism("text-fragments"));
  const tracker = findTracker(entry, host);
  if (tracker) return fromTracker(entry, tracker);
  return {
    label: entry,
    name: "Extra tag",
    plain: "Not needed to open the page. Sites add tags like this to follow who shared or clicked a link.",
    href: "/trackers/#unknown-tags",
  };
}

export function shortLinkHref(): string {
  return "/trackers/#short-links";
}

export function findTracker(key: string, host: string): Tracker | null {
  const k = key.toLowerCase();
  const h = host.replace(/^www\./, "");
  const named = (t: Tracker) => t.keys.some((p) => p !== "*" && (p.endsWith("*") ? k.startsWith(p.slice(0, -1)) : k === p));
  const catchAll = (t: Tracker) => t.keys.includes("*");
  const onSite = (t: Tracker) => !!t.hosts?.some((d) => hostMatches(h, d));
  return (
    TRACKERS.find((t) => t.hosts && onSite(t) && named(t)) ??
    TRACKERS.find((t) => !t.hosts && named(t)) ??
    TRACKERS.find((t) => t.hosts && onSite(t) && catchAll(t)) ??
    null
  );
}

function hostMatches(host: string, domain: string): boolean {
  if (domain.endsWith(".*")) return new RegExp(`(^|\\.)${domain.slice(0, -2).replace(/\./g, "\\.")}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
  return host === domain || host.endsWith("." + domain);
}

function mechanism(id: string): Tracker {
  const m = MECHANISMS.find((t) => t.id === id);
  if (!m) throw new Error(`missing mechanism ${id}`);
  return m;
}

function fromTracker(label: string, t: Tracker): Explained {
  return { label, name: t.name, plain: t.reveals, href: `/trackers/#${t.id}` };
}
