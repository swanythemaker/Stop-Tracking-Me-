import { chromium, firefox } from "@playwright/test";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BASE = process.env.URL || "http://127.0.0.1:8890";
const LABEL = process.env.BENCH_LABEL || "current";
const N = Number(process.env.BENCH_N || 15);
const WARMUP = Number(process.env.BENCH_WARMUP || 3);
const DOCS = "docs";
mkdirSync(DOCS, { recursive: true });

const SIZES = [512, 2048, 4096];
const FORMATS = [
  { mime: "image/png", short: "png" },
  { mime: "image/jpeg", short: "jpeg" },
  { mime: "image/webp", short: "webp" },
];

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
const r1 = (x) => Math.round(x * 10) / 10;

async function benchCell(page, size, mime, resizePct, n, warmup) {
  return page.evaluate(
    async ({ size, mime, resizePct, n, warmup }) => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, "#123a2a");
      g.addColorStop(0.5, "#1f6f4a");
      g.addColorStop(1, "#d4b25a");
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
      for (let i = 0; i < 240; i++) {
        x.fillStyle = `hsla(${(i * 37) % 360},60%,55%,0.10)`;
        x.beginPath();
        x.arc((i * 131) % size, (i * 71) % size, 8 + ((i * 13) % 60), 0, Math.PI * 2);
        x.fill();
      }
      const blob = await new Promise((res) => c.toBlob((b) => res(b), mime, 0.92));
      const baseBuf = await blob.arrayBuffer();
      const inBytes = baseBuf.byteLength;

      const bench = window.__sanitizeBench;
      const decode = [];
      const encode = [];
      const strip = [];
      const total = [];
      let outBytes = 0;
      for (let i = 0; i < warmup + n; i++) {
        const buf = baseBuf.slice(0);
        const res = await bench(buf, mime, "same", false, resizePct);
        if (i >= warmup) {
          decode.push(res.timing.decodeMs);
          encode.push(res.timing.encodeMs);
          strip.push(res.timing.stripMs);
          total.push(res.timing.totalMs);
        }
        outBytes = res.outBytes;
      }
      return { decode, encode, strip, total, inBytes, outBytes };
    },
    { size, mime, resizePct, n, warmup },
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => typeof window.__sanitizeBench === "function", { timeout: 15000 });

const RESIZES = [100, 50];
const IMAGES = process.env.BENCH_IMAGES !== "0";
const rows = [];
for (const size of IMAGES ? SIZES : []) {
  for (const f of FORMATS) {
    for (const resizePct of RESIZES) {
      const cell = await benchCell(page, size, f.mime, resizePct, N, WARMUP);
      const row = {
        size,
        format: f.short,
        resize: resizePct,
        inKB: r1(cell.inBytes / 1024),
        outKB: r1(cell.outBytes / 1024),
        decodeP50: r1(pct(cell.decode, 50)),
        decodeP95: r1(pct(cell.decode, 95)),
        encodeP50: r1(pct(cell.encode, 50)),
        stripP50: r1(pct(cell.strip, 50)),
        totalP50: r1(pct(cell.total, 50)),
        totalP95: r1(pct(cell.total, 95)),
      };
      rows.push(row);
      console.log(
        `${f.short.padEnd(4)} ${String(size).padStart(4)}² r${String(resizePct).padStart(3)}  ` +
          `decode p50 ${row.decodeP50}ms  encode ${row.encodeP50}ms  strip ${row.stripP50}ms  ` +
          `total p50 ${row.totalP50}ms / p95 ${row.totalP95}ms`,
      );
    }
  }
}

await browser.close();

const VIDEO = process.env.BENCH_VIDEO === "1";
const VIDEO_ENGINES = (process.env.BENCH_ENGINES || "chromium,firefox").split(",");
const VIDEO_N = Number(process.env.BENCH_VIDEO_N || 3);
const VIDEO_WARMUP = Number(process.env.BENCH_VIDEO_WARMUP || 1);
const videoRows = [];

if (VIDEO) {
  mkdirSync("test-results", { recursive: true });
  const clip = join("test-results", "bench_1080p.mp4");
  if (!existsSync(clip)) {
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=20",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", clip,
    ]);
  }
  const clipBytes = readFileSync(clip);
  for (const engineName of VIDEO_ENGINES) {
    const launcher = engineName === "firefox" ? firefox : chromium;
    const b = await launcher.launch();
    const p = await b.newPage();
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.waitForFunction(() => typeof window.__sanitizeVideoBench === "function", { timeout: 15000 });
    await p.evaluate(() => {
      window.__benchChunks = [];
    });
    const CHUNK = 4 * 1024 * 1024;
    for (let off = 0; off < clipBytes.length; off += CHUNK) {
      const b64 = clipBytes.subarray(off, off + CHUNK).toString("base64");
      await p.evaluate((b64) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        window.__benchChunks.push(arr);
      }, b64);
    }
    for (const engine of ["remux", "reencode"]) {
      for (const resizePct of [100, 50]) {
        if (engine === "remux" && resizePct !== 100) continue;
        const cell = await p.evaluate(
          async ({ engine, resizePct, n, warmup }) => {
            const file = new File(window.__benchChunks, "bench_1080p.mp4", { type: "video/mp4" });
            const bench = window.__sanitizeVideoBench;
            const total = [];
            const stage = [];
            let outBytes = 0;
            let frames = 0;
            let usedEngine = "";
            for (let i = 0; i < warmup + n; i++) {
              const res = await bench(file, engine, resizePct);
              if (i >= warmup) {
                total.push(res.timing.totalMs);
                stage.push(res.timing.decodeEncodeMs + res.timing.remuxMs);
              }
              outBytes = res.outBytes;
              frames = res.timing.frames;
              usedEngine = res.engine;
            }
            return { total, stage, outBytes, frames, usedEngine, inBytes: file.size };
          },
          { engine, resizePct, n: VIDEO_N, warmup: VIDEO_WARMUP },
        );
        const row = {
          browser: engineName,
          engine: cell.usedEngine,
          resize: resizePct,
          inMB: r1(cell.inBytes / (1024 * 1024)),
          outMB: r1(cell.outBytes / (1024 * 1024)),
          frames: cell.frames,
          totalP50: r1(pct(cell.total, 50)),
          fps: cell.frames > 0 ? r1(cell.frames / (pct(cell.total, 50) / 1000)) : 0,
        };
        videoRows.push(row);
        console.log(`video ${engineName.padEnd(8)} ${row.engine.padEnd(8)} r${String(resizePct).padStart(3)}  total p50 ${row.totalP50}ms  ${row.fps} fps  out ${row.outMB} MB`);
      }
    }
    await b.close();
  }
}

const MODELS = process.env.BENCH_MODELS === "1";
const MODEL_N = Number(process.env.BENCH_MODELS_N || 3);
const modelRows = [];
if (MODELS) {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForFunction(() => typeof window.__sanitizeBench === "function", { timeout: 15000 });
  for (const size of [1024, 2048]) {
    for (const job of [{ inpaint: "migan" }, { inpaint: "lama" }, { reduce: true }]) {
      const cell = await p.evaluate(
        async ({ size, job, n }) => {
          const c = document.createElement("canvas");
          c.width = size;
          c.height = size;
          const x = c.getContext("2d");
          const g = x.createLinearGradient(0, 0, size, size);
          g.addColorStop(0, "#123a2a");
          g.addColorStop(1, "#d4b25a");
          x.fillStyle = g;
          x.fillRect(0, 0, size, size);
          x.fillStyle = "#fff";
          x.fillRect(size * 0.8, size * 0.9, size * 0.18, size * 0.07);
          const blob = await new Promise((res) => c.toBlob((bb) => res(bb), "image/png"));
          const base = await blob.arrayBuffer();
          const bench = window.__sanitizeBench;
          const models = { ...job, maskPct: 15, width: size, height: size };
          const first = await bench(base.slice(0), "image/png", "image/png", true, 100, models);
          const model = [];
          const step = [];
          for (let i = 0; i < n; i++) {
            const r = await bench(base.slice(0), "image/png", "image/png", true, 100, models);
            model.push(r.timing.modelMs);
            step.push(job.reduce ? r.timing.reduceMs : r.timing.inpaintMs);
          }
          return { coldModelMs: first.timing.modelMs, coldStepMs: job.reduce ? first.timing.reduceMs : first.timing.inpaintMs, model, step };
        },
        { size, job, n: MODEL_N },
      );
      const row = {
        size,
        job: job.inpaint || "reduce",
        coldModelMs: r1(cell.coldModelMs),
        warmModelMs: r1(pct(cell.model, 50)),
        stepP50: r1(pct(cell.step, 50)),
      };
      modelRows.push(row);
      console.log(`model ${row.job.padEnd(6)} ${String(size).padStart(4)}²  cold model ${row.coldModelMs}ms  warm ${row.warmModelMs}ms  step p50 ${row.stepP50}ms`);
    }
  }
  await b.close();
}

const payload = {
  label: LABEL,
  when: new Date().toISOString(),
  base: BASE,
  n: N,
  warmup: WARMUP,
  ua: "chromium",
  rows,
  videoRows,
  modelRows,
};
const outPath = join(DOCS, `bench-${LABEL}.json`);
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log("wrote", outPath);

const files = readdirSync(DOCS)
  .filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
  .sort();
const runs = files.map((f) => JSON.parse(readFileSync(join(DOCS, f), "utf8")));
const key = (r) => `${r.format} ${r.size}² r${r.resize}`;

let md = `# Sanitize pipeline benchmark\n\n`;
md += `Per-stage worker timing (wasm decode+transform → jsquash encode → wasm strip+audit), `;
md += `measured via \`window.__sanitizeBench\` over the real pipeline. Chromium headless, `;
md += `dpr 1, square synthetic images. Times in **ms**, lower is better.\n\n`;
for (const run of runs) {
  md += `- **${run.label}**, ${run.when} · ${run.n} runs/cell (warmup ${run.warmup})\n`;
}
md += `\n`;

if (runs.length >= 2) {
  const first = runs[0];
  const last = runs[runs.length - 1];
  const byKeyLast = new Map(last.rows.map((r) => [key(r), r]));
  md += `## Total p50 by build (ms), speedup = (${first.label} − ${last.label}) / ${first.label}\n\n`;
  md += `| image | ${runs.map((r) => r.label).join(" | ")} | speedup |\n`;
  md += `|---|${runs.map(() => "--:").join("|")}|--:|\n`;
  for (const fr of first.rows) {
    const k = key(fr);
    const cells = runs.map((r) => {
      const row = r.rows.find((x) => key(x) === k);
      return row ? row.totalP50.toFixed(1) : "-";
    });
    const lr = byKeyLast.get(k);
    const speed = lr && fr.totalP50 > 0 ? `${Math.round((1 - lr.totalP50 / fr.totalP50) * 100)}%` : "-";
    md += `| ${k} | ${cells.join(" | ")} | ${speed} |\n`;
  }
  md += `\n`;
}

const latest = runs.find((r) => r.label === LABEL) || runs[runs.length - 1];
md += `## ${latest.label}, full stage breakdown\n\n`;
md += `| image | in KB | out KB | decode+resize p50 | decode p95 | encode p50 | strip p50 | total p50 | total p95 |\n`;
md += `|---|--:|--:|--:|--:|--:|--:|--:|--:|\n`;
for (const r of latest.rows) {
  md += `| ${key(r)} | ${r.inKB} | ${r.outKB} | ${r.decodeP50} | ${r.decodeP95} | ${r.encodeP50} | ${r.stripP50} | ${r.totalP50} | ${r.totalP95} |\n`;
}
const videoRuns = runs.filter((r) => r.videoRows && r.videoRows.length);
if (videoRuns.length) {
  md += `## Video, 1080p30 20 s H.264 clip, per browser and engine\n\n`;
  md += `Total time from file to audited output through \`window.__sanitizeVideoBench\`. ` +
    `"reencode" is the full clean (WebCodecs decode and encode, then the Rust rebuild and audit), ` +
    `"remux" is the basic clean (Rust rebuild and audit only). Headless, software encoders.\n\n`;
  md += `| build | browser | engine | resize | in MB | out MB | frames | total p50 ms | fps |\n`;
  md += `|---|---|---|--:|--:|--:|--:|--:|--:|\n`;
  for (const run of videoRuns) {
    for (const r of run.videoRows) {
      md += `| ${run.label} | ${r.browser} | ${r.engine} | ${r.resize}% | ${r.inMB} | ${r.outMB} | ${r.frames} | ${r.totalP50} | ${r.fps} |\n`;
    }
  }
  md += `\n`;
}
const modelRuns = runs.filter((r) => r.modelRows && r.modelRows.length);
if (modelRuns.length) {
  md += `## Local models, square synthetic image with a 15 percent corner mask, Chromium\n\n`;
  md += `"cold model" is the first session (download or cache read, hash check, session create); "warm" is a reused session. "step" is the inference itself, per \`window.__sanitizeBench\`. Firefox numbers are not listed: the Playwright Firefox build runs onnxruntime wasm 7 to 20 times slower than a release Firefox, see docs/spikes-v0.8.0.md.\n\n`;
  md += `| build | job | image | cold model ms | warm model ms | step p50 ms |\n`;
  md += `|---|---|--:|--:|--:|--:|\n`;
  for (const run of modelRuns) {
    for (const r of run.modelRows) {
      md += `| ${run.label} | ${r.job} | ${r.size}² | ${r.coldModelMs} | ${r.warmModelMs} | ${r.stepP50} |\n`;
    }
  }
  md += `\n`;
}
md += `\n_Generated by \`scripts/bench.mjs\`._\n`;

writeFileSync(join(DOCS, "bench.md"), md);
console.log("wrote", join(DOCS, "bench.md"));
