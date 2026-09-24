import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const OUT = "public/models";
const HF = "https://huggingface.co";

const FILES = [
  {
    path: "migan_pipeline_v2-6f1f3530a1a2.onnx",
    sha256: "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b",
    url: `${HF}/edgetools/migan/resolve/9d6739f43236827151267aa44b71b930de5edf19/migan_pipeline_v2.onnx`,
  },
  {
    path: "lama_fp32-1faef5301d78.onnx",
    sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
    url: `${HF}/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx`,
  },
  {
    path: "taesd_encoder-e85480fea37b.onnx",
    sha256: "e85480fea37bc6f0707fe3b03a5c2183cdeb7fc3794e78d05e70d9e58e65570c",
    url: null,
  },
  {
    path: "taesd_decoder-caeaaf7ce871.onnx",
    sha256: "caeaaf7ce8719141d99a49e759f035e9e5abc56c64adf27dc978029a6d08b87f",
    url: null,
  },
];

const FLORENCE_REV = "d59e079711c57174f29265539fb4cc9f0f335916";
const FLORENCE_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "onnx/embed_tokens_int8.onnx",
  "onnx/vision_encoder_int8.onnx",
  "onnx/encoder_model_int8.onnx",
  "onnx/decoder_model_merged_int8.onnx",
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const pushR2 = process.argv.includes("--push-r2");
const bucket = process.env.R2_BUCKET || "stoptrackingme-models";

for (const f of FILES) {
  const dest = join(OUT, f.path);
  if (!existsSync(dest)) {
    if (!f.url) {
      console.error(`${f.path} is exported locally with scripts/export-taesd.py and is missing`);
      process.exit(1);
    }
    console.log(`downloading ${f.path}`);
    await download(f.url, dest);
  }
  const actual = sha256(dest);
  if (actual !== f.sha256) {
    console.error(`hash mismatch for ${f.path}: ${actual}`);
    process.exit(1);
  }
  console.log(`ok ${f.path}`);
}

const registry = readFileSync("src/sanitizer/models/registry.ts", "utf8");
for (const rel of FLORENCE_FILES) {
  const dest = join(OUT, "florence-2-base", rel);
  if (!existsSync(dest)) {
    console.log(`downloading florence-2-base/${rel}`);
    await download(`${HF}/onnx-community/Florence-2-base/resolve/${FLORENCE_REV}/${rel}`, dest);
  }
  const actual = sha256(dest);
  const pinned = registry.match(new RegExp(`"${rel.replace(/[.\/]/g, "\\$&")}": \\{ sha256: "([0-9a-f]{64})"`));
  if (!pinned || pinned[1] !== actual) {
    console.error(`hash mismatch for florence-2-base/${rel}: ${actual}`);
    process.exit(1);
  }
  console.log(`ok florence-2-base/${rel}`);
}

if (pushR2) {
  const all = [...FILES.map((f) => f.path), ...FLORENCE_FILES.map((r) => `florence-2-base/${r}`)];
  for (const rel of all) {
    console.log(`r2 put ${rel}`);
    execFileSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/${rel}`, "--file", join(OUT, rel), "--cache-control", "public, max-age=31536000, immutable"], { stdio: "inherit" });
  }
}
