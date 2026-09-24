# v0.8.0 spikes: model files, ORT web in a Worker, LaMa parity, TAESD reduce

Spikes S1, S2 and S4 from the v0.8.0 plan are measured here. S0, S3, S5 and S6 are kept as headings for the other spike reports (S3 and S6 are in `docs/spikes-v0.8.0-detect-regen.md` for now).

This file is the contract for `src/sanitizer/inpaint/` and `src/sanitizer/reduce/`. Every tensor name, type and shape below was read from a live `InferenceSession` in a module Worker, not from a model card.

## Setup (measured)

| Item | Value |
|---|---|
| Machine | AMD Ryzen 9 5900HX (8 cores, 16 threads), 30 GB RAM, Linux 6.14.0 x86_64 |
| Playwright | 1.60.0 (`playwright-core` from the repo), headless |
| Chromium | 148.0.7778.96 (Playwright headless shell) |
| Firefox (Playwright) | 150.0.2, Playwright build `firefox-1522` |
| Firefox (stock) | 149.0.2, the distribution build in `/usr/bin/firefox`, headless, fresh profile, no automation attached |
| onnxruntime-web | **1.30.0**, `ort.wasm.min.mjs` plus `ort-wasm-simd-threaded.mjs` and `ort-wasm-simd-threaded.wasm` (14,239,897 bytes) served from the same origin, `env.wasm.wasmPaths = "/ort/"`, `proxy = false`, execution provider `wasm` |
| Realm | module Worker (`new Worker(url, { type: "module" })`), one fresh Worker and one fresh browser per job, so `numThreads` is set before the first session |
| Headers | throwaway Node static server: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`. `crossOriginIsolated === true` in page and Worker, all three browsers |
| Python side | Python 3.12.3 venv: torch 2.14.0+cpu, onnx 1.23.0, onnxruntime 1.30.0, safetensors 0.8.0, numpy 2.5.3, pillow 12.3.0, invisible-watermark 0.2.0, opencv-python-headless 5.0.0.93, PyWavelets 1.10.0 |
| Memory | RSS of the whole browser process tree sampled every 50 ms (100 ms for stock Firefox) from Node. Includes the browser's own baseline, so the delta over the idle baseline is the useful number |

Other agents ran heavy jobs on the same machine during part of these runs (load average up to 12). Timings are labelled "low load" (load average under 3) or "under load". Treat all timings as single runs on one machine: orders of magnitude, not bench results.

Input for every browser run is a deterministic synthetic image (`genRgb` in the harness: sine gradients, per pixel hash noise of about 8 levels, a yellow disc, and a white "text stamp" of bars at 80 to 97 percent x, 90 to 97 percent y). The corner mask is the plan's default bottom right preset: 22 percent of the width by 12 percent of the height.

## Files placed

Placed under `public/models/`, not added to git (LFS is configured separately). Name rule: `<basename>-<first 12 hex of sha256>.<ext>`.

| Path | Bytes | SHA-256 | Upstream and revision | Licence |
|---|---|---|---|---|
| `public/models/migan_pipeline_v2-6f1f3530a1a2.onnx` | 28,079,181 | `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b` | HF `edgetools/migan` at `9d6739f43236827151267aa44b71b930de5edf19` (mirror of `andraniksargsyan/migan`; weights from `Picsart-AI-Research/MI-GAN`) | MIT |
| `public/models/inpainting_lama_2025jan-7df918ac3921.onnx` | 92,591,623 | `7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2` | HF `opencv/inpainting_lama` at `aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f` (model card: source is Carve `lama_fp32.onnx`; weights from `advimman/lama`) | Apache-2.0 |
| `public/models/taesd_encoder-e85480fea37b.onnx` | 4,907,608 | `e85480fea37bc6f0707fe3b03a5c2183cdeb7fc3794e78d05e70d9e58e65570c` | exported by `scripts/export-taesd.py` from HF `madebyollin/taesd` at `614f76814bbe30edbe2e627ace1c2234c81a2c0e` (`taesd_encoder.safetensors`, 4,895,600 bytes, `160d90c61c3a5ce50fe2cbe6404b3429f5763772d61b38523cc37e1525b4e19f`) and `taesd.py` from GitHub `madebyollin/taesd` at `e87efbcfc5298d84986b5d9280f40d358b6a228d` | MIT |
| `public/models/taesd_decoder-caeaaf7ce871.onnx` | 4,909,785 | `caeaaf7ce8719141d99a49e759f035e9e5abc56c64adf27dc978029a6d08b87f` | same export (`taesd_decoder.safetensors`, 4,895,612 bytes, `f0fb51dd10d41c26612c070fa0b52ea0215a5ff90792134b4971109dd713c019`) | MIT |
| `public/models/LICENSES/MI-GAN-MIT.txt` | 1,082 | | `LICENSE` from `edgetools/migan` (identical to `LICENSE` and `LICENSE-WEIGHTS` in `Picsart-AI-Research/MI-GAN`) | |
| `public/models/LICENSES/LaMa-Apache-2.0.txt` | 11,347 | | `LICENSE` from `opencv/inpainting_lama` (Copyright 2021 Samsung Research) | |
| `public/models/LICENSES/TAESD-MIT.txt` | 1,073 | | `LICENSE` from GitHub `madebyollin/taesd` | |
| `public/models/LICENSES/README.txt` | | | plain attribution index, one entry per model file | |

No NOTICE file exists upstream: checked `opencv/inpainting_lama` (HF), `advimman/lama`, `opencv/opencv_zoo` and `Picsart-AI-Research/MI-GAN` (GitHub root listings).

Not placed, parity reference only: Carve `lama_fp32.onnx`, 208,044,816 bytes, `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`, HF `Carve/LaMa-ONNX` at `c3c0c9e468934d62e79c329e35d82dd09ff8c444`, Apache-2.0. If S2's verdict is taken, its hashed name is `lama_fp32-1faef5301d78.onnx`.

The TAESD export is byte reproducible: two runs of `scripts/export-taesd.py` with the versions above produced identical files (same SHA-256).

## S0 Hosting

Pending: needs the Vercel project (enable Git LFS) and the Cloudflare R2 bucket. Local Git LFS is configured (`.gitattributes`), and `npm run models:fetch -- --push-r2` uploads the files once the bucket exists.

## S1: MI-GAN in ORT web

### Session

| Item | Value |
|---|---|
| Graph | opset 17, IR 8, producer pytorch 2.1.1, 1,218 nodes, all 145 initializers float32 |
| `inputNames` | `image`, `mask` |
| `inputMetadata` | `image` uint8 `["batch_size", 3, "height", "width"]`; `mask` uint8 `["batch_size", 1, "height", "width"]` |
| `outputNames` | `result` |
| `outputMetadata` | `result` uint8 `["ScatterNDresult_dim_0", 3, "ScatterNDresult_dim_2", "ScatterNDresult_dim_3"]`; the run returns `[1, 3, H, W]` at the input size |
| Mask polarity | confirmed: 0 = hole, 255 = keep. The white stamp inside the 0 region is gone in the output |
| `fetch` of 28 MB from localhost | 66 to 97 ms |
| `InferenceSession.create` | Chromium 0.48 to 0.76 s; stock Firefox 0.45 to 0.62 s; Playwright Firefox 1.8 to 3.2 s |

### Inference time, ms per run (run 1, 2, 3)

| Engine | Threads | 512 x 512 | 2048 x 2048 | Load |
|---|---|---|---|---|
| Chromium 148 | 1 | 2033, 1754, 1750 | 1950, 1925, 1977 | low |
| Chromium 148 | 4 | 1053, 793, 767 | 838, 813, 808 | low |
| Chromium 148 | 8 | 2989 (first run incl. warm up) | 1569 | low |
| Firefox 149 stock | 1 | 2453, 1981, 1973 | 2088, 2071, 2070 | low |
| Firefox 149 stock | 4 | 995, 840, 808 | 844, 834, 843 | low |
| Firefox 150 Playwright | 1 | 27928, 25735, 26588 | 27948, 38565, 25965 | under load |
| Firefox 150 Playwright | 4 | 10328, 12578 (automated); 6027, 6534, 6002 (same binary, no automation, low load) | 15832, 14809 | mixed |

The 2048 input costs the same as 512: the pipeline resizes to 512 inside the graph and composites back at input size, as the model card says.

**Playwright's Firefox 150 build is about 7 to 20 times slower than stock Firefox 149 on the same wasm**, with or without Juggler attached, while stock Firefox matches Chromium. The slowness belongs to that build, not to Firefox. Consequences: Firefox e2e timeouts need headroom (LaMa took 213 to 368 s per pass there, see S2), and Firefox numbers for `docs/bench.md` should come from a stock Firefox, not the Playwright build.

### Memory (browser tree RSS)

| Engine | Idle baseline | Peak during session plus runs | Delta |
|---|---|---|---|
| Chromium 148, 4 threads, 512 and 2048 | 418 to 436 MB | 999 to 1085 MB | about 0.55 to 0.65 GB |
| Firefox 150 Playwright, 1 thread | 682 MB | 1418 MB | about 0.74 GB |
| Firefox 149 stock | 676 MB | 1661 MB | about 1 GB (baseline sampled 1.5 s after launch, so it underestimates the idle tree) |

### Output bytes: SHA-256 of the `result` tensor

| Size | Threads 1 (Chromium, both Firefoxes) | Threads 4 (Chromium, both Firefoxes) | Threads 8 (Chromium) |
|---|---|---|---|
| 512 | `ce7d1aadf63a...` | `ce7d1aadf63a...` | `ce7d1aadf63a...` |
| 768 | `d30f40443d99...` | `fa8dbdf04a1c...` | `fa8dbdf04a1c...` |
| 1024 | `39e18cedb676...` | `39e18cedb676...` | `39e18cedb676...` |
| 1536 | `a084d641b129...` | `a084d641b129...` | `a084d641b129...` |
| 2048 | `3a461661d8a4...` | `cef830687765...` | `cef830687765...` |
| 3072 | `b6a09692e946...` | `4f94d21673b8...` | `f795229c767a...` |

(768, 1024, 1536 and 3072 were run in Chromium only.) Full hashes: 512 `ce7d1aadf63afcb2f65bdb0819268fa56249e88e1cb1359e369bf1611d5eb83d`; 2048 at 1 thread `3a461661d8a4d6f96fbd01a3030d25608799abcab50c034ca6da88e03291ddb9`, at 4 threads `cef8306877657d9ddfb193500fcc1abd266a8a168f4d173e17b17f857c758854`.

- **Engine never changed a byte**: Chromium 148, Firefox 150 and Firefox 149 agree at every thread count tested.
- **Thread count does change bytes when the graph resizes** (input side not 512 and not an exact multiple the resize maps cleanly): 768, 2048 and 3072 differ between 1 and 4 threads, 3072 also between 4 and 8. At 2048 the difference is one pixel by one level inside the hole (row 1930, column 1862). 512, 1024 and 1536 were identical.
- Decision for M2: either fix `numThreads` to one constant for inpaint on every machine, or (better) feed MI-GAN a crop that `crop.ts` has already resampled to exactly 512 x 512 in our own deterministic TypeScript, so the in-graph resize is a no-op. The 512 path was identical at 1, 4 and 8 threads in all three browsers.

### Pixels outside the hole

The `result` is not a clean composite. At 512, 8,230 of 262,144 pixels outside the hole changed, by at most 5 levels (mean 1.04), spread over the whole frame. At 2048, 4,198 channel values outside the hole changed. `pasteMasked` (write only pixels whose mask is 255 in our convention) is required, not optional.

### Visual check (512, saved as `spikes08/web/out/migan-chromium-t4-512.png`)

The white bar stamp is fully gone. The fill continues the magenta to violet gradient of the corner with no visible seam at the hole border. Grain inside the fill is slightly smoother than the hash noise around it; at normal viewing size it reads as the same surface. Inside the hole the mean absolute change from the input is 26.5 levels (the stamp removal).

## S2: LaMa, OpenCV Zoo build versus Carve

### Session (both builds, both engines)

| Item | OpenCV Zoo `inpainting_lama_2025jan` | Carve `lama_fp32` |
|---|---|---|
| Graph | opset **21**, 18,001 nodes, 598 **int8** plus 606 float32 plus 299 int64 initializers (weight only int8 quantized) | opset 17, 17,480 nodes, 606 float32 initializers |
| Inputs | `image` float32 `["batch", 3, 512, 512]` (RGB, value / 255), `mask` float32 `["batch", 1, 512, 512]` (1 = hole) | same |
| Output | `output` float32 `["batch", 3, 512, 512]`, run returns `[1, 3, 512, 512]` | same |
| Output range seen | 12.1 to 254.7, not integers; clamp to 0..255 and round | 12.1 to 254.7 |
| Outside the hole | exactly equal to the input (the graph composites) | same |
| `create`, Chromium low load | 5.3 to 5.6 s | 6.3 s |
| `create`, Firefox 149 stock | 6.5 s | 7.3 s |
| `create`, Firefox 150 Playwright | 55 to 77 s | not run |

The plan's facts table says output `[3,512,512]`; the real tensor has the batch axis and is named `output`.

### Inference time, ms per 512 pass

| Engine | Threads | Zoo | Carve | Load |
|---|---|---|---|---|
| Chromium 148 | 1 | 22922, 21644 | 52755 (under load) | low |
| Chromium 148 | 4 | 7487, 7201 | 8475, 8661 | low |
| Chromium 148 | 8 | 5810, 5560, 5564, 5594 | not run | low |
| Firefox 149 stock | 4 | 7601, 7726 | 7558, 7552 | low |
| Firefox 150 Playwright | 4 | 311731, 240409, 212979 | not run | under load |
| Firefox 150 Playwright | 1 | 367864 | not run | under load |

Memory (Chromium tree): Zoo peak 1103 to 1183 MB over a 433 MB baseline (about 0.7 GB); Carve peak 1331 to 1345 MB (about 0.9 GB).

### Determinism

| Output | Chromium t1 | Chromium t4 | Chromium t8 | Firefox 150 t1 | Firefox 150 t4 | Firefox 149 t4 |
|---|---|---|---|---|---|---|
| Zoo corner | `fb7736620850` | same | same | same | same | same |
| Zoo centre | `c314b1bb24ac` | same | same | | same | |
| Zoo diagonal | `a8a12e0ef0d0` | same | | | same | |
| Carve corner | `af394bb162c5` | same | | | | same |

No thread count and no engine changed a byte of either LaMa build.

### Parity: PSNR of the filled region

Masks: corner (22 by 12 percent, bottom right), centre square (25 percent of the side), thin diagonal stroke (7 px wide, 10 to 90 percent). "vs truth" is PSNR against the unmasked pixels (for the synthetic browser image, the image rendered without the stamp).

Browser, Chromium 4 threads, synthetic image:

| Mask | Hole px | Zoo vs Carve | Zoo vs truth | Carve vs truth | Zoo minus Carve |
|---|---|---|---|---|---|
| corner | 6,893 | 30.28 dB | 18.84 dB | 20.78 dB | **-1.94 dB** |
| centre | 16,384 | 40.42 dB | 27.02 dB | 27.12 dB | -0.10 dB |
| diagonal | 2,863 | 52.62 dB | 30.83 dB | 30.91 dB | -0.09 dB |

Wider sweep with the same ONNX files in Python onnxruntime 1.30.0 CPU (2 real photos: Carve's `image.jpg` and OpenCV's `squirrel.jpg`, centre cropped to 512; 4 synthetic scenes), 18 cases:

| Image | corner: Zoo / Carve / delta | centre: Zoo / Carve / delta | diagonal: Zoo / Carve / delta |
|---|---|---|---|
| Carve photo | 32.12 / 32.86 / -0.74 | 15.15 / 14.55 / +0.60 | 27.21 / 27.26 / -0.05 |
| squirrel photo | 12.39 / 13.66 / **-1.27** | 15.28 / 15.29 / -0.01 | 26.78 / 26.79 / -0.01 |
| landscape | 22.81 / 23.12 / -0.31 | 17.20 / 18.86 / **-1.66** | 25.31 / 25.30 / +0.01 |
| shapes | 14.34 / 13.57 / +0.77 | 16.77 / 16.35 / +0.42 | 26.42 / 26.50 / -0.08 |
| texture | 15.83 / 15.78 / +0.05 | 15.34 / 15.40 / -0.06 | 31.54 / 31.64 / -0.10 |
| portrait like | 29.69 / 31.28 / **-1.59** | 31.64 / 31.55 / +0.09 | 32.11 / 32.14 / -0.03 |

Summary: mean delta -0.22 dB, 15 of 18 within 1 dB, worst -1.66 dB. Zoo against Carve directly: 21.6 to 55.9 dB, mean 38.6 dB. Thin strokes are indistinguishable (over 52 dB); large holes and the corner preset differ most. Counting the browser case, 4 of 21 cases miss the plan's 1 dB bar, three of them on the corner preset, which is the default.

**Verdict: switch "High quality" to Carve `lama_fp32.onnx`.** The OpenCV Zoo file is the Carve export with int8 weights; it is within 1 dB on average but not per case, and it loses up to 1.9 dB exactly on the default corner mask. Carve costs 115 MB more (208 MB, fine for LFS and R2 by the project rule), 0.7 to 1 s more session create, and about 1.2 s more per pass in Chromium at 4 threads; in stock Firefox the two run at the same speed. Both are thread and engine deterministic. `inpainting_lama_2025jan-7df918ac3921.onnx` stays in `public/models/` until the coordinator decides; swap it for `lama_fp32-1faef5301d78.onnx` if the verdict is taken.

## S3 Florence-2

See `docs/spikes-v0.8.0-detect-regen.md`.

## S4: TAESD export, round trip and the DWT-DCT count

### Export (`scripts/export-taesd.py`)

| Item | Value |
|---|---|
| Command | `python scripts/export-taesd.py <dir with taesd.py and both safetensors> <output dir>` |
| Encoder | input `image` float32 `[1, 3, height, width]` in 0..1, output `latent` float32 `[1, 4, latent_height, latent_width]` (H/8, W/8), 75 nodes |
| Decoder | input `latent`, output `image` float32 `[1, 3, height, width]`, clamped to 0..1 inside the graph, 90 nodes |
| Opset, exporter | 17, TorchScript exporter (`dynamo=False`), `do_constant_folding=True`, `onnx.checker` passes |
| Verification vs PyTorch, onnxruntime CPU | 512 x 512: latent max abs diff 1.60e-05, image 1.43e-06. 320 x 448 (dynamic axes check): latent 1.19e-05, image 1.61e-06 |
| Latent scaling | none needed: encoder output goes straight into the decoder |

### ORT web (synthetic image, full frame, no tiling)

| Engine | Threads | 512: encode ms | 512: decode ms | 1024: encode ms | 1024: decode ms | Load |
|---|---|---|---|---|---|---|
| Chromium 148 | 1 | 4854, 4711 | 5478, 5432 | 19162, 18307 | 21861, 21363 | low |
| Chromium 148 | 4 | 1520, 1451 | 1668, 1698 | 6595, 5828 | 7394, 6540 | low |
| Chromium 148 | 8 | 1061, 962 | 1146, 1157 | 4047, 4188 | 4749, 4630 | low |
| Firefox 149 stock | 4 | 1590, 1445 | 1683, 1679 | 5878, 6023 | 6855, 7188 | low |
| Firefox 150 Playwright | 4 | 42911 | 30171 | 104623 | 107443 | under load |
| Firefox 150 Playwright | 1 | 69207 | 76541 | not run | not run | under load |

Session create: encoder 0.25 to 0.39 s, decoder 0.02 s after the encoder (Chromium); 0.3 s and 0.02 s (Firefox 149). Memory: Chromium tree peak 1551 to 1644 MB over a 434 MB baseline (about 1.1 to 1.2 GB with a 1024 frame in one piece; tiles at 512 keep this lower).

| Size | Latent dims | PSNR round trip vs input | Mean shift R, G, B (levels) | Latent SHA-256 | Image SHA-256 |
|---|---|---|---|---|---|
| 512 | `[1,4,64,64]` | 28.01 dB | +4.9, +0.3, -5.0 | `6e73b855d9ac...` | `1baf4ed6944d...` |
| 1024 | `[1,4,128,128]` | 28.58 dB | +4.5, +0.6, -4.9 | `85d98cf55fa5...` | `aab67a7e0f80...` |

Both hashes are identical in Chromium at 1, 4 and 8 threads, Firefox 150 at 1 and 4 threads, and Firefox 149 at 4 threads. No thread count or engine changed a byte.

Visual notes (`spikes08/web/out/taesd-chromium-t4-512.png`): a clear warm shift (red up about 5 levels, blue down about 5) and higher saturation, most visible on the yellow disc; per pixel noise is replaced by a coarser, faintly blocky grain; edges stay sharp; the white stamp survives (TAESD is not an inpainter). On the photo like DWT test scenes the result reads as slightly soft with smoother grain, no visible tile seams at 512 tiles with 64 px overlap.

Time estimate (not measured): a 12 MP photo (4000 x 3000) is 9 x 7 = 63 tiles of 512 with 64 overlap. At about 3.1 s per tile (Chromium, 4 threads) that is about 3.3 minutes; about 2.2 minutes at 8 threads. TAESD bytes are thread invariant, so reduce can use more threads than inpaint.

### DWT-DCT survivor count

Method (`spikes08/dwt/dwt_test.py`):

- Mark: `invisible-watermark` 0.2.0, `WatermarkEncoder` with `set_watermark("bytes", b"stoptrackingme")` (112 bits), method `dwtDct`, on BGR uint8 as the library expects.
- Images: synthetic, 512 to 1024 px per side, ten kinds (horizontal gradient, radial gradient, uniform noise, grey Gaussian noise, value noise, landscape, portrait like, random shapes, text lines, woven texture), fresh seed per candidate. A candidate counts only if the marked image decodes exactly before any processing. 43 candidates were needed to get 20: the mark failed right after embedding on 23, including every horizontal gradient, radial gradient, value noise and text image (DWT-DCT is weak on flat content). The 20 kept: 5 uniform noise, 4 grey Gaussian noise, 4 shapes, 4 portrait like, 2 landscape, 1 texture.
- Reduce, exactly as M5 defines it, in Python with onnxruntime 1.30.0 CPU and the two placed ONNX files: pad to a multiple of 8 (edge replicate); 512 tiles with 64 overlap, last tile aligned to the far edge; encoder then decoder per tile; paste by owner map (nearest tile centre, first wins on ties, no blending); crop the padding; clamp and round to uint8. Then bilinear resample to `round(0.9 * side)` and back to the original size (half pixel centres, no antialias, round to uint8). Then requantize every channel to 6 bits: `round(round(v * 63 / 255) * 255 / 63)`.
- Decode: `WatermarkDecoder("bytes", 112)`, `dwtDct`; "survives" means all 14 bytes come back exactly.

| Variant | Decoded exactly (of 20) | Mean bit accuracy |
|---|---|---|
| clean image, never marked (false positive check) | 0 | 0.465 |
| marked, untouched | 20 | 1.000 |
| TAESD round trip only | 0 | 0.474 |
| resample 90 percent only | 7 | 0.776 |
| requantize 6 bits only | 20 | 1.000 |
| resample plus requantize, no TAESD | 6 | 0.768 |
| **full reduce pipeline** | **0** | **0.474** |

**0 of 20 marked images still decode after the reduce pipeline.** Best single image bit accuracy after reduce: 0.580, which is chance level (the clean, never marked images score 0.465). TAESD alone already removes it; resample and requantize alone do not (requantize never touched it, resample left 7 of 20). Mean PSNR reduced versus marked: 20.8 dB overall, by kind: portrait like 28.4, shapes 28.2, landscape 25.4, texture 22.0, grey noise 15.8, uniform noise 10.5.

For M5's test band: the plan's "PSNR 25 to 45 dB" holds for smooth, photo like fixtures (25 to 29 dB here) but not for noisy or finely textured ones (10 to 22 dB). Pick a smooth fixture or widen the lower bound.

## S5 Headers

Local: the Vite dev server sends COOP same-origin and COEP require-corp, `crossOriginIsolated` is true in Chromium and Firefox (`tests/isolation.spec.ts`), the Rust core, jSquash, onnxruntime-web and Transformers.js all load under the header CSP with `wasm-unsafe-eval`, and `scripts/console-check.mjs` stays clean. Preview deploys: pending, same checklist against vercel.json and public/_headers.

## S6 Regenerate

See `docs/spikes-v0.8.0-detect-regen.md`. Verdict: not shipped in v0.8.0.

## Decisions for the integration code

- MI-GAN: feed exactly 512 x 512 crops resampled in `crop.ts`, or pin one `numThreads` for inpaint everywhere. Always `pasteMasked`; the model touches pixels outside the hole.
- LaMa: switch "High quality" to Carve `lama_fp32.onnx` (S2 verdict). Output is float with batch axis, named `output`; clamp and round.
- TAESD: tensor names `image` and `latent`, decoder already clamps to 0..1, no latent scaling. Thread count is free for reduce.
- ORT web output was never engine dependent in any run. Thread dependence was seen only in MI-GAN's in-graph resize.
- Firefox timings in e2e come from a build that runs ORT wasm 7 to 20 times slower than stock Firefox. Budget Firefox test timeouts from the Playwright numbers above, and bench numbers from a stock Firefox.
- In the first harness runs ORT printed 77 `CleanUnusedInitializersAndNodeArgs` warnings per MI-GAN session to the console in both engines despite `env.logLevel = "error"`; later identical runs printed none. Passing `logSeverityLevel: 3` in the session options is a cheap guard for `console-check` (not proven necessary).

## Reproduce

All throwaway material lives in the session scratchpad under `spikes08/` (`dl/` downloads, `venv/`, `web/` harness with `server.mjs`, `run.mjs`, `rawff.mjs`, `www/worker.mjs`, `dwt/dwt_test.py`, `parity/parity.py`).

```
S=<scratchpad>/spikes08
python3 -m venv $S/venv
$S/venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
$S/venv/bin/pip install onnx onnxruntime safetensors numpy pillow invisible-watermark opencv-python-headless PyWavelets onnxscript
curl -L -o $S/dl/migan/migan_pipeline_v2.onnx https://huggingface.co/edgetools/migan/resolve/9d6739f43236827151267aa44b71b930de5edf19/migan_pipeline_v2.onnx
curl -L -o $S/dl/lama/inpainting_lama_2025jan.onnx https://huggingface.co/opencv/inpainting_lama/resolve/aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f/inpainting_lama_2025jan.onnx
curl -L -o $S/dl/carve/lama_fp32.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx
curl -L -o $S/dl/taesd/taesd_encoder.safetensors https://huggingface.co/madebyollin/taesd/resolve/614f76814bbe30edbe2e627ace1c2234c81a2c0e/taesd_encoder.safetensors
curl -L -o $S/dl/taesd/taesd_decoder.safetensors https://huggingface.co/madebyollin/taesd/resolve/614f76814bbe30edbe2e627ace1c2234c81a2c0e/taesd_decoder.safetensors
curl -L -o $S/dl/taesd/taesd.py https://raw.githubusercontent.com/madebyollin/taesd/e87efbcfc5298d84986b5d9280f40d358b6a228d/taesd.py
$S/venv/bin/python scripts/export-taesd.py $S/dl/taesd $S/taesd_out
sha256sum $S/dl/*/*.onnx $S/taesd_out/*.onnx
cd $S/web && npm i onnxruntime-web@1.30.0
OUT=out node run.mjs '[{"engine":"chromium","threads":4,"task":"migan","args":{"sizes":[512,2048],"reps":3,"png":true}}]'
node rawff.mjs /usr/bin/firefox '[{"threads":4,"task":"lama","args":{"url":"/models/lama_fp32.onnx","masks":["corner"],"reps":2}}]' out.jsonl
$S/venv/bin/python $S/dwt/dwt_test.py
$S/venv/bin/python $S/parity/parity.py $S
```

`run.mjs` takes a JSON job list (`engine`, `threads`, `task` of `migan`, `lama` or `taesd`, `args`); `rawff.mjs` runs the same page in a Firefox binary with no automation attached and collects results over a POST to the static server.
