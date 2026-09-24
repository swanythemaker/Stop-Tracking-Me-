import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const BANNED = [
  { ch: "—", name: "em-dash (—)" },
  { ch: "–", name: "en-dash (–)" },
];
const SCAN_EXT = new Set([".ts", ".css", ".html", ".md", ".mjs"]);
const SKIP_DIRS = new Set(["src/wasm"]);

const roots = ["README.md", "index.html", "src", "scripts", "tests"];
const files = [];
function walk(p) {
  if (SKIP_DIRS.has(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e));
  } else if (SCAN_EXT.has(extname(p))) {
    files.push(p);
  }
}
for (const r of roots) walk(r);

const hits = [];
for (const f of files) {
  if (f.endsWith("copy-check.mjs")) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const b of BANNED) {
      if (line.includes(b.ch)) {
        hits.push(`${f}:${i + 1}  ${b.name}  →  ${line.trim().slice(0, 90)}`);
      }
    }
  });
}

if (hits.length) {
  console.error(`COPY CHECK FAILED — ${hits.length} banned dash(es) found:\n`);
  for (const h of hits) console.error("  " + h);
  console.error("\nReplace em/en dashes with plain punctuation (comma, period, colon, parentheses).");
  process.exit(1);
}
console.log(`COPY CHECK CLEAN — scanned ${files.length} files, no em/en dashes.`);
