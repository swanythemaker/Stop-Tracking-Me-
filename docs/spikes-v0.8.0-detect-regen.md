# v0.8.0 spikes: Florence-2 detector (S3) and in-browser regenerate (S6)

Spikes S3 and S6 from the v0.8.0 plan. S0, S1, S2, S4 and S5 live in `docs/spikes-v0.8.0.md`; this file is meant to be merged into it.

Every API name and number below comes from a running browser unless it is labelled **estimate** or **native**.

## Setup (measured)

| Item | Value |
|---|---|
| Machine | AMD Ryzen 9 5900HX (8 cores, 16 threads), 30 GB RAM, Linux 6.14.0 x86_64 |
| Load | Shared with another spike agent during all runs; load average 7 to 8 on 16 threads. Timings are pessimistic by an unknown factor |
| Playwright | 1.60.0, headless |
| Chromium | 148.0.7778.96 (headless shell) |
| Firefox | 150.0.2 (Playwright build) |
| Transformers.js | `@huggingface/transformers` **4.3.0**, which bundles `onnxruntime-web` **1.31.0-dev.20260914-8d85527a0** |
| onnxruntime-web | **1.30.0** (S6), bundle `ort.wasm.min.mjs`, `env.wasm.wasmPaths = "/ort/"` |
| Native reference | onnxruntime 1.30.0 (Python, CPU EP), labelled **native** |
| Realm | Every browser run inside a module Worker (`new Worker(url, { type: "module" })`) |
| Server | Throwaway Node static server, every response with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`. `crossOriginIsolated === true` in both engines |
| Memory | Sum of RSS over the browser process tree started by the runner, sampled every 250 ms. Shared pages are counted more than once, so this is an upper bound |

Numbers are single runs on this one machine. Treat them as orders of magnitude.

Harness and raw results: session scratchpad `spikes08b/` (`florence.worker.js`, `sd.worker.js`, `run.mjs`, `server.mjs`, `out/*.json`, `out/*.png`).

## S3: Florence-2-base in Transformers.js 4.3.0

### Source

| Item | Value |
|---|---|
| Repo | `onnx-community/Florence-2-base` |
| Revision | `d59e079711c57174f29265539fb4cc9f0f335916` |
| Licence | MIT (upstream `microsoft/Florence-2-base`, "Copyright (c) Microsoft Corporation") |
| Licence file | `public/models/LICENSES/florence-2-base.LICENSE` |

### Worker setup that worked

```js
import { env, Florence2ForConditionalGeneration, AutoProcessor, RawImage } from "@huggingface/transformers";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = true;
env.cacheKey = "stm-florence-1";
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/ort/tjs/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/ort/tjs/ort-wasm-simd-threaded.asyncify.wasm",
};
env.fetch = loggingOrVerifyingFetch;
const dtype = { embed_tokens: "int8", vision_encoder: "int8", encoder_model: "int8", decoder_model_merged: "int8" };
const model = await Florence2ForConditionalGeneration.from_pretrained("florence-2-base", { dtype, device: "wasm" });
const processor = await AutoProcessor.from_pretrained("florence-2-base");
```

Per request: `processor.construct_prompts(task + text)`, `await processor(rawImage, prompts)`, `model.generate({ ...inputs, max_new_tokens: 128, do_sample: false, num_beams: 1 })`, `processor.batch_decode(ids, { skip_special_tokens: false })[0]`, `processor.post_process_generation(raw, task, [width, height])`.

Findings about the setup:

| Finding | Detail |
|---|---|
| ORT variant | The bundled ORT is the `onnxruntime-web/webgpu` build. Its default file name is `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, taken from `node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/`. `wasmPaths` must be an **object** with `mjs` and `wasm`; only then does Transformers.js pre-load and cache the wasm (`env.useWasmCache`, default true) |
| ORT wasm goes through `env.fetch` and into the cache | The two ORT files are fetched with `env.fetch` and stored in the `stm-florence-1` cache next to the model files (11 entries after one load) |
| **Cache hits bypass `env.fetch`** | The warm run made **zero** `env.fetch` calls. A `verifiedFetch` alone therefore does not verify cache hits. To keep "fail closed on every load, including cache hits", use `env.useCustomCache = true` and `env.customCache = { match, put }` (4.3.0 supports both; `match` can hash the cached body before returning it) |
| `image_size` order | `post_process_generation(text, task, image_size)` multiplies x by `image_size[0]` and y by `image_size[1]`, so pass **`[width, height]`**. The JSDoc says "height x width"; that is wrong |
| Threads | `env.backends.onnx.wasm.numThreads` reads 4 by default on this 16 thread machine |
| `processor_config.json` | Not requested. Florence2Processor has `uses_processor_config = false` |

### Exact file set fetched (cold load, Chromium and Firefox identical)

Placed under `public/models/florence-2-base/` with upstream relative paths, not hash renamed (Transformers.js builds these names itself). Not added to git.

| Path under `/models/florence-2-base/` | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 5447 | `74efbe2299e13cfcc9e083861eae4a943d76f784ddd595d85e779d189cf0a574` |
| `generation_config.json` | 297 | `25dc666f44506e0a63f5de2d191e5809b251527b282ff4951fad9840556407b3` |
| `preprocessor_config.json` | 2673 | `c892857e34a7082284983a7717717d39c9bf7e574f1f41d80d4c918c97502efa` |
| `tokenizer_config.json` | 197658 | `d8e64607233cb53b619fb46664f6cad08176c26e0e8735b2d30d888364f19600` |
| `tokenizer.json` | 2297961 | `d69dcdb2323e124ac4f800cb9863ddccea0d7bb11e16125e8df3bd60f2f8aeac` |
| `onnx/embed_tokens_int8.onnx` | 39390496 | `8818c58a214e53bf7e22c48bb4674c2fa3112b9539c3ce4075a2eac797b1ef74` |
| `onnx/vision_encoder_int8.onnx` | 93788211 | `ec0649c0307316190b6b91ffb4582c82bb3ed19202b66395990fe340c27c07e5` |
| `onnx/encoder_model_int8.onnx` | 43651493 | `a0459867dc116e8e49f53073e368e45c21169d0b0dd7dc350abed06926e0d835` |
| `onnx/decoder_model_merged_int8.onnx` | 98177854 | `7ffecf4dd98784308878fd52a7f95ed64f5ed025b4785f6f105450be8fe2be04` |
| **Total** | **277512090** (264.7 MiB) | |

`tokenizer_config.json` is requested twice per load (same URL). Not requested: `added_tokens.json`, `special_tokens_map.json`, `vocab.json`, `merges.txt`, `processor_config.json`, `README.md`.

ORT files fetched from the Transformers.js bundle (served by us, planned path `/ort/tjs/`):

| File | Bytes | SHA-256 |
|---|---:|---|
| `ort-wasm-simd-threaded.asyncify.mjs` | 53057 | `0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611` |
| `ort-wasm-simd-threaded.asyncify.wasm` | 26861777 | `49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082` |

**Hosting catch:** the asyncify wasm is 26861777 bytes, over the Cloudflare Pages per-file cap of 25 MiB (26214400). On Cloudflare it has to come from R2 like the models. (ORT 1.30.0's own `ort-wasm-simd-threaded.wasm` is 14239897 bytes and fits.)

Alternative set, not tested: the q4f16 files are `embed_tokens_q4f16.onnx` 78780372, `vision_encoder_q4f16.onnx` 62458377, `encoder_model_q4f16.onnx` 25705965, `decoder_model_merged_q4f16.onnx` 56543873, total 223488587 bytes (51.5 MB less than int8). The WASM EP has almost no fp16 kernels, so ORT adds fp16 to fp32 casts around them (S6 shows the same thing in the UNet), and the q4 MatMul path is built for WebGPU. Keep int8 for the CPU reference path.

### Load time and memory

| Engine | Load (cold, empty Cache Storage, localhost) | Load (warm, cache hit) | Browser tree RSS peak |
|---|---:|---:|---:|
| Chromium 148 | 5.4 s | 3.4 s to 3.8 s | 1.67 GB |
| Firefox 150 | 12.0 s to 13.4 s | 25.6 s (one run, under load) | 2.21 GB |

Download time over a real network is extra: 265 MiB plus 26 MB of ORT wasm.

### Per-prompt wall time (generate plus decode plus post-process, 1024x768 input)

| Engine | numThreads | Seconds per prompt |
|---|---:|---|
| Chromium 148 | 1 | 18.7 |
| Chromium 148 | 4 (default) | 5.5 to 7.5 |
| Chromium 148 | 8 | 6.6 to 8.1 (no gain on this loaded machine) |
| Firefox 150 | 1 | 213.0 |
| Firefox 150 | 4 (default) | 68.9 to 89.5 |

Generated tokens are **identical** between Chromium and Firefox for all ten prompts. Firefox is about 11 times slower per thread. Threads do help in Firefox (3 times from 1 to 4). A plain JS loop runs at about the same speed in both engines (0.77 s vs 0.87 s), so the slowdown is in ORT's wasm under SpiderMonkey. The Playwright Firefox build may differ from a release build; check this on a release Firefox before quoting it to users.

### Boxes returned (Chromium; Firefox identical)

Test images: (a) `stamp.png`, a synthetic 1024x768 landscape with a white 55 percent opaque "SAMPLE" stamp at about (697,662)-(1015,715), a red round logo at (24,24)-(104,104) and the word "ACME" at about (114,50)-(183,73); (b) `plain.png`, the same kind of scene with no marks; (c) `harbour.jpg`, a real 640x480 photo with no marks (Wikimedia Commons, CC BY-SA 2.0, Gerald England, used only as test input).

Boxes are in image pixels (x1,y1,x2,y2) with the share of image area.

| Image | Task and text | Raw answer | Boxes |
|---|---|---|---|
| stamp | `<CAPTION_TO_PHRASE_GROUNDING>` watermark | 5 boxes | 1,335,1022,767 (56.1%); 1,335,1021,670 (43.4%); **695,659,1018,719 (2.5%)**; **23,23,105,106 (0.9%)**; **113,53,185,74 (0.2%)** |
| stamp | `<CAPTION_TO_PHRASE_GROUNDING>` logo | label decodes as "log" | 1,335,1022,767 (56.1%) |
| stamp | `<CAPTION_TO_PHRASE_GROUNDING>` text | 1 box | **695,659,1022,720 (2.5%)** |
| stamp | `<OPEN_VOCABULARY_DETECTION>` watermark | 1 box (parsed by hand) | **692,655,1022,724 (2.9%)** |
| stamp | `<OD>` | "poster" | 1,0,1022,767 (99.6%) |
| plain | grounding watermark | 2 boxes | 1,336,1022,767 (56.0%); 1,336,1021,675 (44.0%) |
| plain | grounding logo | 2 boxes | same two boxes |
| plain | grounding text | 2 boxes | **1,0,1022,767 (99.6%, whole image)**; 1,335,1022,767 (56.1%) |
| plain | open vocabulary watermark | 2 boxes | 56.1% and 44.5% |
| plain | `<OD>` | "houseplant" | 1,338,1022,767 (55.7%) |
| harbour | grounding watermark | 1 box | **0,0,639,479 (whole image)** |
| harbour | grounding logo | 1 box | 273,0,639,332 (39.5%) |
| harbour | grounding text | 1 box | 273,0,639,332 (39.5%) |

What this means for M4:

- **The "nothing" case never returns an empty list.** It returns a whole-image box (99.6 percent) or large region boxes (39 to 56 percent). The plan's 60 percent filter would let the 39 to 56 percent boxes through as proposals. Real marks here are 0.2 to 2.9 percent. Use **drop boxes over 25 percent of the image** (and under 0.05 percent), then IoU 0.7 dedupe. With that filter every true box above survives and every false box is dropped.
- "watermark" found all three marks in one prompt; "text" found the stamp tightly; "logo" found nothing useful and its label decodes as "log". Recommend the two prompts **"watermark" and "text"** (about 12 to 15 s in Chromium) and drop "logo".
- Synthetic and single-photo evidence only. The release gate test (`WM_FLORENCE=1`) should use a real photo with a real stamp.

### Task tokens that post-process in 4.3.0

`post_process_generation` implements the answer types `pure_text`, `description_with_bboxes`, `bboxes`, `phrase_grounding` and `ocr`. Mapped through `preprocessor_config.json`:

| Task token | Answer type | 4.3.0 |
|---|---|---|
| `<CAPTION_TO_PHRASE_GROUNDING>` | phrase_grounding | **works** (run) |
| `<OD>` | description_with_bboxes | **works** (run) |
| `<DENSE_REGION_CAPTION>` | description_with_bboxes | supported by code, not run |
| `<REGION_PROPOSAL>` | bboxes | supported by code, not run |
| `<OCR_WITH_REGION>` | ocr (quad boxes) | supported by code, not run |
| `<CAPTION>`, `<OCR>` and the other text tasks | pure_text | supported by code |
| `<OPEN_VOCABULARY_DETECTION>` | description_with_bboxes_or_polygons | **throws** `Task "<OPEN_VOCABULARY_DETECTION>" (of type "description_with_bboxes_or_polygons") not yet implemented.` The raw text is `watermark<loc_675><loc_853><loc_998><loc_942>`, which the `bboxes` regex parses fine if we ever want it |
| `<REFERRING_EXPRESSION_SEGMENTATION>`, `<REGION_TO_SEGMENTATION>` | polygons | throws |

### S3 verdict

**Go** for "Find watermark" in Chromium: about 3.5 s to load from cache, about 12 to 15 s for the two recommended prompts, 1.7 GB peak. The "about 30 s" UI hint holds for Chromium. **Firefox works** and gives identical output but takes about 2.5 to 3 minutes for two prompts on this machine. Either show a longer time hint per engine or measure a release Firefox first.

## S6: SD 1.5 img2img in onnxruntime-web (feasibility)

### Model source

| Repo | Revision | Licence | Contents | Used |
|---|---|---|---|---|
| `nmkd/stable-diffusion-1.5-onnx-fp16` | `38dacf2c14c89e3538b5e32da888eb9c46e0e1bf` | creativeml-openrail-m | fp16, diffusers ONNX layout, UNet with external data | **yes** |
| `onnx-community/stable-diffusion-v1-5-ONNX` | `90ff1f14e325544b14919d1ee5abc99f19d4e647` | creativeml-openrail-m | fp32, UNet weights 3438083840 bytes | no (fp32 UNet cannot fit, see below) |
| `schmuell/sd-turbo-ort-web` | `ace89b7d2cd849f9a73914cdbb8a3ea60c853dd1` | other (SD-Turbo, Stability licence) | fp16, the ORT WebGPU demo model, UNet 1733430199 bytes | no (WebGPU target, non-OSI licence) |
| `strfunctionk/sd15-fp16-onnx` | `38703d3d9f0d844ce01e67091f9e383ec9e3321c` | no licence tag | fp16 | no (unclear provenance) |

Downloaded from nmkd (2.13 GB total):

| File | Bytes | SHA-256 |
|---|---:|---|
| `unet/model.onnx` | 1217704 | `879e4274bfc862c7733ed2b673600be8f9b78b45184b5702100f89508e69ca34` |
| `unet/weights.pb` | 1718976000 | `491609db06ac0bd6893969cda4caa3475a9a14a7deb5ee4f11a4371c6187155a` |
| `vae_encoder/model.onnx` | 68430493 | `f089c1a57c6f68370fc4def7d3eeabb860a4e625e0d352c04acd8707c46683e2` |
| `vae_decoder/model.onnx` | 99094195 | `ff78d16a387ece4e102e2548a8dbd93f048269bc23ac65fac3acff0ba88b6161` |
| `text_encoder/model.onnx` | 246476214 | `da837d5d2df136df347d0e8d7114d295d634d32b37b77be60418a7117d1f669b` |

Graph facts: opset 14. UNet inputs `sample` fp16 `[b,4,h,w]`, `timestep` fp16 `[b]`, `encoder_hidden_states` fp16 `[b,77,768]`, output `out_sample`. VAE encoder `sample` to `latent_sample`, decoder `latent_sample` to `sample`. Text encoder `input_ids` **int32**.

### Pipeline as run

- Empty prompt embedding computed once natively with the text encoder from `input_ids = [49406, 49407 x 76]` and shipped as `empty_prompt_emb_f16.bin` (118272 bytes, `d27b708e92b5ef1541de4d0693d9f2e7a0f7d3d1125b796309650c09993233ad`). The browser never loads CLIP.
- **The export's VAE encoder samples its latent with an unseeded `RandomNormalLike` node**, so encoding is not deterministic. Replacing that node with a multiply by 0 gives the mean latent. After that the whole pipeline is deterministic (see below).
- Latent scale 0.18215. Seeded noise from a mulberry32 PRNG with Box-Muller in TypeScript.
- DDIM, eta 0, scaled_linear betas (0.00085 to 0.012, 1000 steps), `leading` spacing plus `steps_offset` 1, no CFG (one UNet call per step). Strength 0.12 as "noise to about t = 125 and denoise from there": 8 total steps with 1 executed (t = 126, then to t = 1), or 16 total steps with 2 executed (t = 125, 63, then to 1). Note that the diffusers rule `int(N * strength)` gives **0** executed steps at N = 8 and strength 0.12; the scheduler has to pick the start step itself.
- 512x512 tile, a centre crop of `harbour.jpg` scaled up from 480.

### What failed

| Attempt | Result |
|---|---|
| fp16 UNet, 512 tile, `graphOptimizationLevel` "all" | Session created (7.1 s), `run` failed: `std::bad_alloc` (4 GB WASM heap) |
| fp16 UNet, 512 tile, "disabled" | Same `std::bad_alloc` |
| fp16 UNet, 256 tile | Runs: UNet 3.3 s per step, VAE encode 3.9 s, decode 8.4 s. Output is badly distorted (SD 1.5 is out of its range at 256). Not usable |
| fp16 UNet, 384 tile | Runs: UNet 7.1 s per step, encode 8.8 s, decode 19.0 s. Browser tree peak 5.8 GB |
| Native check, fp16 UNet at 512 | peak RSS 5.7 GB ("all") and 4.6 GB ("disabled"); 3.8 GB at 384 |

The WASM (CPU) EP has hardly any fp16 kernels. ORT inserts fp16 to fp32 casts, so every activation exists in both precisions. At 512 the self-attention scores alone are 8 heads x 4096 x 4096 floats (537 MB each in fp32). Together with 1.72 GB of fp16 weights that exceeds the 4 GB heap. **The plan's "SD 1.5 fp16, about 1.7 GB, in WASM" does not work at 512.**

Output fp16 tensors come back as `Float16Array` (not `Uint16Array`) in both engines with ORT web 1.30.0 when the global exists. Code that decodes halves by hand from `Uint16Array` produces a flat grey image.

### What worked: int8 UNet plus fp32 VAE

Built locally from the nmkd files (no extra download):

1. fp16 to fp32 (`to_fp32.py` in the scratchpad: initialisers, value infos, `Cast` targets and tensor attributes).
2. `onnxruntime.quantization.quantize_dynamic(weight_type=QInt8, op_types_to_quantize=[MatMul, Gemm, Conv], MatMulConstBOnly)`. 1 min 55 s natively, 10.3 GB peak RAM.

| File | Bytes | SHA-256 |
|---|---:|---|
| `unet_int8/model.onnx` | 2051823 | `24cffecb6e5b98d91b435392808481ba179a8b85f5839f71bc52242bef716395` |
| `unet_int8/model.onnx.data` | 860852480 | `5a8013c32d3ec3a3df3fd5fc540e351480248237a7b8eb512ce4d29c1a5c0ec3` |
| `vae32/encoder.onnx` (mean latent) | 136760814 | `9c9339b764ff6d0d0eca10c160fed6cd47bed9b776318abb8755ca780a955559` |
| `vae32/decoder.onnx` | 198078655 | `37a2881a100b77139c1a7329f715161618aa3dc28e389340b492eb1ced8ecdb3` |
| `empty_prompt_emb_f16.bin` | 118272 | `d27b708e92b5ef1541de4d0693d9f2e7a0f7d3d1125b796309650c09993233ad` |
| **Total download** | **1197862044** (1.12 GiB) | |

These are local derivatives for the spike and are not hosted anywhere. The 860 MB data file is over the 25 MiB Pages cap (R2 only) and within the GitHub LFS 2 GB per-file limit. External data loads with `externalData: [{ path: "model.onnx.data", data: url }]`.

### Timings, one 512 tile (ORT web 1.30.0 WASM, measured)

| Run | Engine | Threads | VAE | Steps | VAE encode | UNet per step | VAE decode | Session creates | Wall | Tree RSS peak |
|---|---|---:|---|---:|---:|---|---:|---:|---:|---:|
| s6d-0 | Chromium 148 | 4 | fp16 | 1 | 22.3 s | 65.5 s | 52.1 s | 6.5 s | 146.9 s | 2.98 GB |
| s6d-1 | Chromium 148 | 4 | fp16 | 2 | 26.3 s | 57.5, 48.6 s | 42.8 s | 7.0 s | 182.4 s | 2.82 GB |
| s6e-0 | Chromium 148 | 4 | fp32 | 2 | 19.9 s | 50.6, 40.3 s | 34.9 s | 5.9 s | 151.9 s | 3.16 GB |
| s6e-1 | Chromium 148 | 8 | fp32 | 2 | 12.5 s | 31.9, 32.4 s | 27.3 s | 4.6 s | **108.9 s** | 3.76 GB (includes the previous worker not yet freed) |
| s6f-0 | Firefox 150 | 8 | fp32 | 2 | 197.6 s | 309.1, 289.7 s | 414.6 s | 25.4 s | **1236.6 s** | 4.56 GB |

Native reference (ORT 1.30.0 Python, 4 threads, same machine): int8 UNet 6.0 to 7.6 s per step at 512, peak RSS 2.1 GB; fp16 UNet 4.0 s per step. WASM in Chromium is 5 to 8 times slower than native here; Firefox about 10 times slower than Chromium, the same ratio as in S3.

The 4 GB WASM limit was **not** hit with the int8 UNet in either engine.

### Output

- `out/chromium-s6d-0.png` (1 step), `out/chromium-s6e-0.png` (2 steps), side by side with the input in `out/cmp512.png` (scratchpad).
- It looks like a **mild repaint, not broken**: layout, colours, boats, houses and the mooring rope all stay in place; fine texture is smoothed (water ripples, window frames, rigging), edges are a little softer, small details are redrawn slightly. The 1 step result is a bit softer than the 2 step one.
- PSNR against the input: 25.67 dB (1 step), 25.56 to 25.57 dB (2 steps). Inside the plan's 22 to 40 dB smoke test band.
- **Deterministic**: 4 and 8 threads give the same PNG bytes in Chromium, and the Chromium and Firefox outputs are pixel-identical (max difference 0; PNG bytes differ only because the engines' PNG encoders differ).
- Whether int8 quantisation keeps the SynthID effect reported for fp16 and fp32 pipelines is **unknown**. The published evidence is for unquantised models.

### Estimates for a 1024 px image (labelled estimates)

Per tile = VAE encode + VAE decode + steps x UNet step, from the measured runs above; sessions created once (about 5 s Chromium, 25 s Firefox). Four tiles means 2 x 2 tiles of 512 with no overlap. The plan's 64 px overlap gives a 3 x 3 grid (9 tiles) at 1024.

| Engine, threads | Per tile, 1 step | Per tile, 2 steps | 4 tiles, 1 step | 4 tiles, 2 steps | 9 tiles, 1 step | 9 tiles, 2 steps |
|---|---:|---:|---:|---:|---:|---:|
| Chromium, 8 | 72 s | 104 s | **4.9 min** | **7.0 min** | 10.9 min | 15.7 min |
| Chromium, 4 | 100 s | 145 s | **6.8 min** | **9.8 min** | 15.1 min | 21.9 min |
| Firefox, 8 | 912 s | 1212 s | **61 min** | **81 min** | 137 min | 182 min |

The SD VAE is 40 to 55 percent of the time. Swapping it for TAESD (already in M5, about 10 MB) for encode and decode would roughly halve the Chromium figures (**estimate**, not measured; TAESD decode quality under img2img needs its own check). An optional WebGPU EP would change the picture completely but is not the deterministic reference.

### What a desktop or native path would need

Natively the same int8 UNet runs at 6 s per step, the fp16 UNet at 4 s, so a 1024 px image with 9 tiles and 2 steps is about 3 to 4 minutes on this CPU (**estimate**) with no 4 GB limit. That needs a native runtime (a Tauri or Electron shell, or a local helper), which the project does not have today.

### S6 verdict

**No-go for a visible "Regenerate" switch in 0.8.0. Go only behind `?regen=1`, Chromium only, as the plan's fallback describes.** Reasons:

1. The planned artefact does not work: SD 1.5 fp16 in the WASM EP runs out of the 4 GB heap at 512. It only works after a local fp32 conversion and int8 dynamic quantisation (1.12 GiB total), which is our own derivative model with no SynthID evidence yet.
2. Time: Chromium meets the 10 minute budget only with 4 tiles and no overlap (4.9 to 7.0 min at 8 threads, 6.8 to 9.8 min at 4 threads). With the planned 64 px overlap (9 tiles) it is 11 to 22 minutes. Firefox takes 61 to 182 minutes.
3. Memory: 3 to 3.8 GB browser RSS in Chromium and 4.6 GB in Firefox on a 30 GB desktop. Phones and 8 GB laptops are unlikely to cope.
4. The release check (20 Gemini and 20 OpenAI images through Google's checker) has not started and would now have to use the int8 model.
5. Licence: CreativeML OpenRAIL-M allows redistribution of a modified model only with its use restrictions passed on and the modification stated. Hosting the int8 file means shipping that licence text and a "modified" notice, and showing it before download (research section 5.1 already asks for the latter).

If the flag build goes ahead, measure next: TAESD in place of the SD VAE, tiles without overlap plus a feathered seam pass, and SD-Turbo or an LCM-distilled SD 1.5 in int8 (1 step by design; licences to be checked) against SynthID on a small set.
