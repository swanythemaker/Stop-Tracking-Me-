# Local models

Every model the app can use is served from the same site (or from the R2 bucket that the Cloudflare build points at), pinned by SHA-256 in `src/sanitizer/models/registry.ts`, downloaded only after the user clicks the feature that needs it, verified on every load including cache hits, cached in the browser, and deletable from the editor.

## Hosted files

| Path under /models | Bytes | SHA-256 | Upstream and revision | Licence |
|---|--:|---|---|---|
| migan_pipeline_v2-6f1f3530a1a2.onnx | 28,079,181 | 6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b | huggingface.co/edgetools/migan at 9d6739f43236827151267aa44b71b930de5edf19 | MIT |
| lama_fp32-1faef5301d78.onnx | 208,044,816 | 1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6 | huggingface.co/Carve/LaMa-ONNX at c3c0c9e468934d62e79c329e35d82dd09ff8c444 | Apache-2.0 |
| taesd_encoder-e85480fea37b.onnx | 4,907,608 | e85480fea37bc6f0707fe3b03a5c2183cdeb7fc3794e78d05e70d9e58e65570c | exported from huggingface.co/madebyollin/taesd at 614f76814bbe30edbe2e627ace1c2234c81a2c0e with scripts/export-taesd.py | MIT |
| taesd_decoder-caeaaf7ce871.onnx | 4,909,785 | caeaaf7ce8719141d99a49e759f035e9e5abc56c64adf27dc978029a6d08b87f | same as the encoder | MIT |
| florence-2-base/ (9 files) | 277,512,090 | per file in registry.ts | huggingface.co/onnx-community/Florence-2-base at d59e079711c57174f29265539fb4cc9f0f335916, int8 set | MIT |

The licence texts are in `public/models/LICENSES/`. The OpenCV Zoo LaMa build (92.6 MB) was measured too and lost to the Carve export by up to 1.9 dB on corner masks, so High quality uses Carve.

## Runtimes

| Runtime | Version | Served from |
|---|---|---|
| onnxruntime-web (our sessions) | 1.30.0 | /ort/1.30.0/ort-wasm-simd-threaded.{mjs,wasm} |
| onnxruntime-web (bundled by Transformers.js) | 1.31.0-dev.20260914 | /ort/tjs/ort-wasm-simd-threaded.asyncify.{mjs,wasm} |
| @huggingface/transformers | 4.3.0 | bundled |

`scripts/copy-ort.mjs` copies both runtime sets into `public/ort/` before `dev` and `build`. The folder is not committed.

## Tensor contracts

| Model | Inputs | Output | Notes |
|---|---|---|---|
| MI-GAN | image uint8 [1,3,512,512] RGB, mask uint8 [1,1,512,512] with 0 = hole | result uint8 [1,3,512,512] | The crop around the mask is resampled to exactly 512 before the run and back after it, because the model's own internal resize gives thread-dependent output at other sizes. Only masked pixels are pasted back. |
| LaMa | image float32 [1,3,512,512] in 0..1, mask float32 [1,1,512,512] with 1 = hole | output float32 [1,3,512,512] in 0..255 | Crops that fit 512 are letterboxed. Larger crops get a coarse 512 pass, then 512 tiles with 64 px overlap and nearest-centre ownership. Clamp and round. |
| TAESD encoder | image float32 [1,3,H,W] in 0..1, H and W multiples of 8 | latent float32 [1,4,H/8,W/8] | 512 tiles with 64 px overlap. |
| TAESD decoder | latent | image float32 [1,3,H,W] in 0..1 | |
| Florence-2-base | RawImage plus task prompt | text, post-processed to boxes | Task `<CAPTION_TO_PHRASE_GROUNDING>` with the words "watermark" and "text". Boxes over 25 percent or under 0.05 percent of the image are dropped, overlaps over IoU 0.7 are merged. |

## Reduce hidden marks

Fixed pipeline: TAESD encode and decode, bilinear resample to 90 percent and back to the original size (half-pixel centres, no antialias), requantize each channel to 6 bits as `round(round(v * 63 / 255) * 255 / 63)`.

Measured on this machine (see docs/spikes-v0.8.0.md, S4): 20 images carrying the DWT-DCT mark from the `invisible-watermark` package decoded correctly before the pipeline, and 0 of 20 decoded after it. The pipeline does nothing to SynthID, see research/synthid-removal.md.

## Threads and determinism

Sessions use up to 4 threads when the page is cross-origin isolated (COOP same-origin plus COEP require-corp, set by vercel.json, public/_headers and the Vite dev server). LaMa and TAESD output is byte-identical at 1, 4 and 8 threads and identical between Chromium and Firefox. MI-GAN is identical across engines and, after the fixed 512 resample above, across thread counts.

## Caches

| Cache Storage name | Holds |
|---|---|
| stm-models-1 | MI-GAN, LaMa, TAESD |
| stm-florence-1 | Florence-2 files and the Transformers.js runtime wasm |

Both are removed by "Delete downloaded models" in the editor.

## Hosting

Vercel serves `public/models/` through Git LFS (enable Git LFS in the project settings before deploying). The Cloudflare Pages build sets `VITE_MODELS_BASE` to the R2 custom domain in `.env.cloudflare`, because Pages caps files at 25 MiB. The bucket needs CORS for GET from the app origin, `Cross-Origin-Resource-Policy: cross-origin`, and immutable cache headers on the hashed paths. `npm run models:fetch -- --push-r2` uploads every file with wrangler.

## Regenerate (not shipped)

Low-strength diffusion regeneration is the only local method with evidence against SynthID. The spike in docs/spikes-v0.8.0-detect-regen.md found that the fp16 SD 1.5 export does not fit in browser memory at 512, a self-built int8 copy runs at 11 to 16 minutes per 1024 px image in Chromium and over an hour in Firefox, and no SynthID check has been done. It stays on the roadmap.
