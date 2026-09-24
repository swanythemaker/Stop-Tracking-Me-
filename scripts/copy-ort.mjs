import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SETS = [
  { from: "node_modules/onnxruntime-web/dist", to: "public/ort/1.30.0", files: ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"] },
  {
    from: "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
    to: "public/ort/tjs",
    files: ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"],
  },
];

for (const set of SETS) {
  if (!existsSync(set.from)) {
    console.error(`missing ${set.from}`);
    process.exit(1);
  }
  mkdirSync(set.to, { recursive: true });
  for (const f of set.files) copyFileSync(join(set.from, f), join(set.to, f));
  console.log(`copied ${set.files.length} files to ${set.to}`);
}
