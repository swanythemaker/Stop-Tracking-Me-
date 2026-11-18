export interface LinkResult {
  original: string;
  clean: string;
  removed: string[];
  shortLink: boolean;
}

export interface TextResult {
  text: string;
  links: LinkResult[];
}

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source", "gad_campaignid",
  "msclkid", "twclid", "ttclid", "li_fat_id", "yclid", "ysclid", "igshid", "igsh",
  "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi", "hsctatracking", "_ga", "_gl", "_kx",
  "_openstat", "oly_anon_id", "oly_enc_id", "rb_clickid", "s_cid", "srsltid", "epik",
  "wickedid", "ref_src", "ref_url", "cmpid", "zanpid", "irclickid", "irgwc", "clickid",
  "ranmid", "raneaid", "ransiteid", "mibextid", "sfnsn", "wt_mc", "wt_zmc", "xtor", "spm",
  "scm", "sc_cid", "mbid", "_branch_match_id", "_branch_referrer", "$deep_link", "$3p",
  "share_id", "rdt", "fb_action_ids", "fb_action_types", "fb_source", "fb_ref",
]);

const TRACKING_PREFIXES = [
  "utm_", "pk_", "mtm_", "matomo_", "hsa_", "__cft__", "__tn__", "pf_rd_", "pd_rd_",
  "_trk", "ns_", "vero_", "oly_", "algo_", "aff_",
];

interface SiteRule {
  match: (host: string) => boolean;
  params?: string[];
  keepOnly?: string[];
  rewrite?: (u: URL) => string | null;
}

const domain = (d: string) => (host: string) => host === d || host.endsWith("." + d);
const anyTld = (name: string) => {
  const re = new RegExp(`(^|\\.)${name}\\.[a-z]{2,3}(\\.[a-z]{2})?$`);
  return (host: string) => re.test(host);
};

const SITES: SiteRule[] = [
  {
    match: anyTld("amazon"),
    params: [
      "tag", "ref", "ref_", "crid", "sprefix", "qid", "sr", "linkcode", "linkid", "ascsubtag",
      "creative", "creativeasin", "camp", "social_share", "content-id", "dib", "dib_tag", "dchild",
    ],
    rewrite: (u) => {
      const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/asin)\/([a-z0-9]{10})(?:[/?]|$)/i);
      if (asin) return `${u.protocol}//${u.host}/dp/${asin[1].toUpperCase()}`;
      const path = u.pathname.replace(/\/ref=[^/]*$/, "");
      return path === u.pathname ? null : withPath(u, path);
    },
  },
  {
    match: anyTld("ebay"),
    params: [
      "_trkparms", "_trksid", "_from", "hash", "amdata", "mkcid", "mkevt", "mkrid", "campid",
      "toolid", "customid", "ssspo", "sssrc", "ssuid", "widget_ver", "itmmeta", "itmprp", "siteid",
    ],
    rewrite: (u) => {
      const id = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?]|$)/);
      if (!id) return null;
      const variant = new URLSearchParams(u.search).get("var");
      return `${u.protocol}//${u.host}/itm/${id[1]}${variant ? `?var=${encodeURIComponent(variant)}` : ""}`;
    },
  },
  { match: anyTld("aliexpress"), rewrite: (u) => (/^\/item\/\d+\.html$/.test(u.pathname) ? withPath(u, u.pathname) : null) },
  {
    match: domain("etsy.com"),
    rewrite: (u) => {
      const id = u.pathname.match(/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/\d+)/i);
      return id ? withPath(u, id[1]) : null;
    },
  },
  { match: domain("temu.com"), rewrite: (u) => (/-g-\d+\.html$/.test(u.pathname) ? withPath(u, u.pathname) : null) },
  {
    match: (h) => domain("facebook.com")(h) || domain("messenger.com")(h),
    params: [
      "rdid", "share_url", "extid", "ref", "refsrc", "hc_ref", "fref", "paipv", "eav", "notif_id",
      "notif_t", "comment_tracking", "acontext", "eid", "hc_location", "sfns",
    ],
  },
  { match: domain("instagram.com"), keepOnly: ["img_index"] },
  { match: domain("threads.net"), keepOnly: [] },
  { match: domain("threads.com"), keepOnly: [] },
  {
    match: (h) => domain("twitter.com")(h) || domain("x.com")(h),
    params: ["s", "t", "a", "cn", "cxt", "ref_src", "ref_url"],
    rewrite: (u) => (/^\/[^/]+\/status\/\d+/.test(u.pathname) ? withPath(u, u.pathname) : null),
  },
  { match: domain("tiktok.com"), keepOnly: ["q"] },
  {
    match: (h) => domain("youtube.com")(h) || h === "youtu.be",
    params: ["si", "feature", "pp", "source_ve_path", "embeds_referring_euri", "embeds_referring_origin", "ab_channel"],
    rewrite: (u) =>
      u.hostname === "youtu.be" || /^\/(watch|shorts\/|live\/)/.test(u.pathname)
        ? keepOnlyParams(u, ["v", "t", "start", "list", "index"])
        : null,
  },
  { match: domain("spotify.com"), keepOnly: [] },
  {
    match: domain("linkedin.com"),
    params: [
      "trk", "trkinfo", "trackingid", "refid", "lipi", "midtoken", "midsig", "eid", "otptoken",
      "originalsubdomain", "original_referer", "lici", "rcm",
    ],
    rewrite: (u) => (/^\/(posts|feed\/update|pulse)\//.test(u.pathname) ? withPath(u, u.pathname) : null),
  },
  { match: domain("reddit.com"), params: ["ref", "ref_source", "ref_campaign", "correlation_id", "post_fullname", "post_index"] },
  { match: domain("pinterest.com"), params: ["mt", "invite_code", "sender", "sfo"] },
  {
    match: anyTld("google"),
    rewrite: (u) => (u.pathname === "/search" ? keepOnlyParams(u, ["q", "tbm", "start", "udm", "hl"]) : null),
  },
];

interface Redirect {
  match: (host: string) => boolean;
  path: RegExp;
  param: string[];
}

const REDIRECTS: Redirect[] = [
  {
    match: (h) => ["l.facebook.com", "lm.facebook.com", "l.messenger.com", "l.instagram.com", "l.threads.net", "l.threads.com"].includes(h),
    path: /^\/(l\.php)?$/,
    param: ["u"],
  },
  { match: anyTld("google"), path: /^\/url$/, param: ["q", "url"] },
  { match: domain("youtube.com"), path: /^\/redirect$/, param: ["q"] },
  { match: (h) => h === "out.reddit.com", path: /^\/./, param: ["url"] },
  { match: (h) => h === "t.umblr.com", path: /^\/redirect$/, param: ["z"] },
  { match: (h) => h === "steamcommunity.com", path: /^\/linkfilter\/?$/, param: ["url", "u"] },
  { match: domain("vk.com"), path: /^\/away\.php$/, param: ["to"] },
  { match: domain("linkedin.com"), path: /^\/(redir\/redirect|safety\/go)\/?$/, param: ["url"] },
  { match: (h) => h === "slack-redir.net", path: /^\/link$/, param: ["url"] },
];

const SHORTENERS = new Set([
  "t.co", "bit.ly", "bitly.com", "amzn.to", "amzn.eu", "amzn.asia", "a.co", "ebay.us", "tinyurl.com",
  "goo.gl", "g.co", "ow.ly", "buff.ly", "lnkd.in", "fb.me", "on.fb.me", "fb.watch", "vm.tiktok.com",
  "vt.tiktok.com", "pin.it", "spoti.fi", "dlvr.it", "trib.al", "is.gd", "cutt.ly", "rebrand.ly",
  "shorturl.at", "tiny.cc", "s.click.aliexpress.com", "a.aliexpress.com", "temu.to", "share.temu.com",
  "s.team", "spotify.link", "maps.app.goo.gl", "search.app",
]);

const MAX_UNWRAP = 5;

export function cleanLink(raw: string): LinkResult | null {
  const original = raw.trim();
  let u = parseHttp(original);
  if (!u) return null;
  const removed: string[] = [];

  for (let i = 0; i < MAX_UNWRAP; i++) {
    const target = unwrap(u);
    if (!target) break;
    removed.push(`redirect through ${u.hostname}`);
    u = target;
  }

  const host = u.hostname.replace(/^www\./, "");
  const site = SITES.find((s) => s.match(host));
  const before = queryKeys(u.search);

  if (site?.rewrite) {
    const pathBefore = u.pathname;
    const rewritten = site.rewrite(u);
    if (rewritten) {
      const next = new URL(rewritten);
      if (next.pathname !== pathBefore) removed.push("tracking in the path");
      next.hash = u.hash;
      u = next;
    }
  }

  const siteParams = new Set(site?.params ?? []);
  const keep = site?.keepOnly ? new Set(site.keepOnly) : null;
  u.search = filterQuery(u.search, (key) => {
    const k = key.toLowerCase();
    if (keep) return !keep.has(k);
    return TRACKING_PARAMS.has(k) || siteParams.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
  });

  const after = new Set(queryKeys(u.search));
  for (const k of before) if (!after.has(k) && !removed.includes(k)) removed.push(k);

  const hash = cleanHash(u.hash);
  if (hash !== u.hash) {
    removed.push("tracking in the #fragment");
    u.hash = hash;
  }

  const shortLink = SHORTENERS.has(host) || (host === "reddit.com" && /^\/r\/[^/]+\/s\//.test(u.pathname));
  const clean = removed.length === 0 ? original : u.toString();
  return { original, clean, removed, shortLink };
}

export function cleanText(text: string): TextResult {
  const links: LinkResult[] = [];
  const trimmed = text.trim();
  if (trimmed && !/\s/.test(trimmed) && !/^https?:\/\//i.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed)) {
    const r = cleanLink("https://" + trimmed);
    if (r) {
      links.push(r);
      return { text: r.removed.length ? r.clean : text, links };
    }
  }
  const out = text.replace(/https?:\/\/[^\s<>"'`]+/gi, (match) => {
    const [url, tail] = splitTrailing(match);
    const r = cleanLink(url);
    if (!r) return match;
    links.push(r);
    return r.clean + tail;
  });
  return { text: out, links };
}

function parseHttp(s: string): URL | null {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function unwrap(u: URL): URL | null {
  const host = u.hostname;
  const rule = REDIRECTS.find((r) => r.match(host) && r.path.test(u.pathname));
  if (!rule) return null;
  const params = new URLSearchParams(u.search);
  for (const name of rule.param) {
    const value = params.get(name);
    const target = value ? parseHttp(value) : null;
    if (target) return target;
  }
  return null;
}

function filterQuery(search: string, drop: (key: string) => boolean): string {
  const kept = search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part !== "" && !drop(decodeKey(part)));
  return kept.length ? "?" + kept.join("&") : "";
}

function queryKeys(search: string): string[] {
  return search.replace(/^\?/, "").split("&").filter(Boolean).map(decodeKey);
}

function decodeKey(part: string): string {
  const key = part.split("=")[0];
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    return key;
  }
}

function keepOnlyParams(u: URL, names: string[]): string {
  const next = new URL(u.toString());
  next.search = filterQuery(u.search, (key) => !names.includes(key.toLowerCase()));
  return next.toString();
}

function withPath(u: URL, path: string): string {
  return `${u.protocol}//${u.host}${path}`;
}

function cleanHash(hash: string): string {
  const h = hash.replace(/:~:.*$/, "");
  if (/^#(.*&)?(utm_[a-z]+|xtor|at_medium|at_campaign)=/i.test(h)) return "";
  return h === "#" ? "" : h;
}

function splitTrailing(match: string): [string, string] {
  let url = match;
  let tail = "";
  while (url.length > 0) {
    const last = url[url.length - 1];
    const unbalancedParen = last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0);
    if (!".,;:!?'\"]>".includes(last) && !unbalancedParen) break;
    tail = last + tail;
    url = url.slice(0, -1);
  }
  return [url, tail];
}
