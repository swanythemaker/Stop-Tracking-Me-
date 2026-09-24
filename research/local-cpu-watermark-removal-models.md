
# Local, CPU-only watermark removal: models, attacks and a plan for STOPTRACKINGME

Research date: 2026-09-24. Scope: models and tools that run fully offline on a CPU (no GPU),
for removing visible watermarks and overlays and for weakening invisible provenance watermarks in
images and video. Written for the STOPTRACKINGME repo (browser only, no upload, fail-closed).

## Executive summary

- **Visible watermarks are a solved-enough problem on CPU.** Find a mask (brush, corner preset, or
  detector), then inpaint that mask. Two permissively licensed inpainters run well on CPU and
  already have ONNX exports that load in onnxruntime-web:
  **MI-GAN** (MIT, 28 MB, about 1 s per edit natively on a laptop CPU) and **LaMa / big-lama**
  (Apache-2.0, 93 to 208 MB, about 3 s per 512 px pass natively). Both were benchmarked for this
  report on a Ryzen 9 5900HX (8 cores).
- **Detection is the harder half.** Florence-2-base (MIT) finds "watermark" boxes zero-shot but
  costs about 14 s per image on CPU. The small, fast YOLO watermark detectors on Hugging Face
  (about 10 MB, 27 ms) are Ultralytics derivatives under **AGPL-3.0**, which does not fit an MIT
  project. For v1, use a brush plus corner presets, with Florence-2 as an optional lazy download.
- **Invisible watermarks can be reduced, never guaranteed gone.** Weak schemes (the DWT-DCT
  `invisible-watermark` that Stable Diffusion ships, Stable Signature) fall to a VAE round trip or
  mild distortions. Tree-Ring and StegaStamp need stronger regeneration or adversarial attacks.
  SynthID-Image is built to survive every ordinary edit (99.7% TPR under worst-case transforms)
  and falls only to heavy diffusion regeneration or GPU-scale attacks such as UnMarker. Every
  removal also leaves forensic traces of its own. The product must say **"reduce, never
  guarantee"**.
- **Video:** per-frame neural inpainting at 1 s/frame is too slow for a 100 MB clip (about 1800
  frames at 1080p30 for 60 s). The fast path for static overlays is: estimate the mask once from
  many frames, then either invert the alpha blend (no neural net, milliseconds per frame) or
  inpaint only a small crop. Temporal models (ProPainter, E2FGVI) are GPU-bound and
  non-commercially licensed.
- **Recommendation:** v1 = image only, user mask plus corner presets, MI-GAN default and LaMa as a
  "higher quality" option, both via onnxruntime-web in the existing sanitize Worker, loaded lazily
  with progress, SHA-256 pinned, cached in Cache Storage / OPFS. The inpainted RGBA goes into the
  existing encode, strip and audit path unchanged.

## 0. Method and test machine

Timings marked **measured** were taken for this report with onnxruntime 1.2x (native CPU
execution provider, Python) or PyTorch 2.14 CPU, on an AMD Ryzen 9 5900HX laptop CPU (8 cores,
16 threads, 30 GB RAM), median of 3 runs after one warm-up. Browser (WASM) times are **estimates**:
onnxruntime-web WASM with SIMD and threads usually runs 1.5x to 3x slower than the native CPU
provider, and single-threaded unless the page is cross-origin isolated. Parameter counts marked
"derived" come from fp32 file size divided by 4 bytes.

## 1. Candidate models and tools

### 1.1 Visible removal by inpainting (mask in, filled image out)

| Name | Link | Task | Architecture | Params | Weights on disk | License | Framework | CPU time, 1024x1024 image | CPU time, video frame | RAM | Quality notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MI-GAN (512, Places2) | [GitHub](https://github.com/Picsart-AI-Research/MI-GAN), [HF ONNX](https://huggingface.co/edgetools/migan) | Inpaint | GAN distilled from CoModGAN, mobile oriented (ICCV 2023) | about 7M (derived) | 28.1 MB ONNX pipeline; 16.3 MB [TFLite fp16](https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT); 14.8 MB [GGUF F16](https://huggingface.co/Acly/MIGAN-GGUF) | MIT (code and weights) | PyTorch, ONNX, TFLite, GGUF | **measured** 1.04 s (8 thr), 1.10 s (4 thr), 1.55 s (1 thr). Pipeline crops a 512 window around the mask, so 1024 costs the same as 512 | same, about 1 s per masked region | about 0.9 GB peak RSS | Good on small and medium holes (logos, text stamps). Softer than LaMa on large holes and repeating textures |
| LaMa, big-lama | [GitHub](https://github.com/advimman/lama), [Carve ONNX](https://huggingface.co/Carve/LaMa-ONNX) | Inpaint | ResNet with Fast Fourier Convolutions (WACV 2022) | about 51M (derived from 208 MB) | 208 MB fp32 ONNX, fixed 512x512 input | Apache-2.0 | PyTorch, ONNX | **measured** 3.6 s (4 thr), 4.2 s (8 thr), 7.8 s (1 thr) per 512 pass; session load 7 s | same per masked region | about 0.95 GB | Best general-purpose CPU inpainter. Strong on periodic textures and large masks |
| LaMa, OpenCV Zoo build | [HF opencv/inpainting_lama](https://huggingface.co/opencv/inpainting_lama) | Inpaint | Same LaMa, repacked Jan 2025 | about 23M (derived) | 92.6 MB ONNX, fixed 512 | Apache-2.0 | ONNX (OpenCV DNN, onnxruntime) | **measured** 2.9 s (8 thr), 3.2 s (4 thr), 7.3 s (1 thr); load 4.5 s | same | about 0.77 GB | Same I/O as Carve export; smaller and slightly faster. Verify output parity against Carve before shipping |
| LaMa-Dilated (Qualcomm) | [HF](https://huggingface.co/qualcomm/LaMa-Dilated) | Inpaint | LaMa with dilated convs | 45.6M | 174 MB | Apache-2.0 | ONNX, QNN, TFLite | not published for CPU; NPU 34 to 109 ms | n/a | n/a | Mobile NPU target; no advantage on desktop CPU |
| MAT | [GitHub](https://github.com/fenglinglwb/MAT) | Inpaint | Mask-aware transformer on StyleGAN2 base (CVPR 2022) | not verified | not verified | **Research only** | PyTorch | slower than LaMa (transformer at 512) | n/a | n/a | Great on large holes; license blocks use in this project |
| ZITS | [GitHub](https://github.com/DQiaole/ZITS_inpainting) | Inpaint | Wireframe and edge prior plus FFC inpainter (CVPR 2022) | not verified, larger than LaMa | multi-model bundle | Apache-2.0 | PyTorch | several times LaMa (multi-stage) | n/a | n/a | Better straight lines and structure; too heavy for a browser tab |
| Stable Diffusion inpainting (SD 1.5 / SDXL inpaint, PowerPaint, BrushNet) | [iopaint list](https://www.iopaint.com/models) | Inpaint, generative | Latent diffusion U-Net plus VAE plus text encoder | about 1B (SD 1.5) to 3.5B (SDXL) | 2 to 7 GB | CreativeML OpenRAIL-M and variants | PyTorch, ONNX, OpenVINO | **too heavy for CPU UX**: the SD VAE alone measured 18.5 s at 512 and 81 s at 1024 (8 thr); 20 U-Net steps add minutes | not practical | 4 to 8 GB | Highest realism for large holes, but minutes per image on CPU. Skip for v1 |
| foduucom/Watermark_Removal | [HF](https://huggingface.co/foduucom/Watermark_Removal) | Blind visible removal (no mask) | Plain 4-level U-Net, image to image | **31.4M (measured)** | 125.5 MB `.pth`; ONNX exports to 125.5 MB | Apache-2.0 (as tagged) | PyTorch; ONNX feasible (exported for this report) | **measured** 256 px: 0.29 s (8 thr), 1.3 s (1 thr). 1024 px: 5.8 s (8 thr), 19.7 s (1 thr) | about 0.3 s at 256 px | about 1 GB for inference (peak 4.1 GB incl. PyTorch load and export) | Weak. See section 1.4 |
| Visible-watermark nets: WDNet, SplitNet, BVMR, SLBR, DENet | [SLBR](https://github.com/bcmi/SLBR-Visible-Watermark-Removal), [SplitNet](https://github.com/vinthony/deep-blind-watermark-removal), [WDNet](https://github.com/MRUIL/WDNet), [survey list](https://github.com/bcmi/Awesome-Visible-Watermark-Removal) | Blind detect plus remove in one net | Multi-task U-Nets predicting mask and background | not verified | not verified | **No license file** on SLBR, SplitNet, WDNet (all rights reserved by default) | PyTorch | sub-second at 256 px on CPU (estimate, U-Net class) | same | under 1 GB | Trained on synthetic LOGO / CLWD sets at 256 px. Poor transfer to real platform overlays, license unusable |

### 1.2 Watermark detection (to produce the mask)

| Name | Link | Type | Params / size | License | Framework | CPU time per image | Notes |
|---|---|---|---|---|---|---|---|
| Florence-2-base | [HF](https://huggingface.co/microsoft/Florence-2-base), [ONNX for Transformers.js](https://huggingface.co/onnx-community/Florence-2-base) | Open-vocabulary detection, prompt "watermark" | 231M (measured); ONNX fp32 about 1.1 GB, int8 set about 275 MB, q4 set about 230 MB | MIT | PyTorch, ONNX, Transformers.js | **measured** 13.7 s (PyTorch, 8 thr, greedy) | Found a synthetic corner text stamp correctly. Used by WatermarkRemover-AI. Slow, but zero training needed |
| Florence-2-large | [HF](https://huggingface.co/microsoft/Florence-2-large) | same | 0.77B | MIT | same | about 3x base (estimate) | Better recall, desktop path only |
| OWLv2 base | [HF](https://huggingface.co/google/owlv2-base-patch16-ensemble), [ONNX](https://huggingface.co/onnx-community/owlv2-base-patch16-ensemble-ONNX) | Zero-shot detection | 614 MB fp32, 163 MB int8 | Apache-2.0 | PyTorch, ONNX, Transformers.js | several s (estimate, 960 px ViT) | Works for "logo", "text"; weaker than Florence-2 on faint marks |
| Grounding DINO tiny | [ONNX](https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX) | Zero-shot detection | 719 MB fp32, 204 MB int8 | Apache-2.0 | ONNX, Transformers.js | several s (estimate) | Alternative to OWLv2 |
| Watermark-Detection YOLO26 / YOLO11 | [YOLO26 ONNX](https://huggingface.co/ayan4m1/Watermark-Detection-YOLO26-ONNX), [YOLO11 ONNX](https://huggingface.co/ayan4m1/Watermark-Detection-YOLO11-ONNX) | Trained watermark detector | 9.8 MB / 11.1 MB | **AGPL-3.0** (Ultralytics base) | ONNX | **measured** 27 ms (8 thr), 76 ms (1 thr) at 640 px | Fast and tiny, but AGPL. Same issue for [yolov8n-watermark](https://huggingface.co/qfisch/yolov8n-watermark-detection) and [corzent yolo11x](https://huggingface.co/corzent/yolo11x_watermark_detection) (tagged MIT but fine-tuned from AGPL YOLO11 weights) |
| Watermark-Detection-SigLIP2 | [HF](https://huggingface.co/prithivMLmods/Watermark-Detection-SigLIP2) | Image classifier (has watermark yes/no) | 372 MB | Apache-2.0 | PyTorch, [ONNX port](https://huggingface.co/bdsqlsz/Watermark-Detection-SigLIP2-onnx) | about 0.3 s (estimate) | No boxes. Useful only as a "this image seems watermarked" hint |

### 1.3 Purpose-built projects and their CPU modes

| Project | Link | License | What it does | CPU mode |
|---|---|---|---|---|
| IOPaint (formerly lama-cleaner) | [GitHub](https://github.com/Sanster/IOPaint), [models](https://www.iopaint.com/models) | Apache-2.0 | Local web UI and CLI; erase models LaMa, MAT, MI-GAN, LDM, ZITS, FcF, Manga, plus SD-based ones | `--device cpu` is supported and recommended for the erase models. `iopaint run --model=lama --device=cpu --image=... --mask=...` batch mode fits a desktop fallback |
| WatermarkRemover-AI | [GitHub](https://github.com/D-Ogi/WatermarkRemover-AI) | MIT | Florence-2 detection plus LaMa inpainting, images and video, PyWebview GUI and CLI, `--detection-skip N` for video | Runs on CPU by default, CUDA optional. Expect about 15 s detection plus about 4 s inpaint per image on a laptop CPU (from the measurements above) |
| Unmark (watermark-remover) | [GitHub](https://github.com/youngkim0/watermark-remover) | not stated | In-browser MI-GAN via onnxruntime-web (WebGPU first, WASM fallback), brush and corner presets, 512 crop around the mask composited back at full resolution | Pure browser. Closest existing reference design for this repo |
| WatermarkAttacker | [GitHub](https://github.com/XuandongZhao/WatermarkAttacker) | MIT | Regeneration attacks (VAE and diffusion) for invisible marks, NeurIPS 2024 | VAE attacks feasible on CPU; diffusion attacks slow |
| UnMarker | [GitHub](https://github.com/andrekassis/ai-watermark) | not declared | Spectral adversarial attack on invisible marks, IEEE S&P 2025 | Requires an NVIDIA GPU with 32 GB or more. Not CPU feasible |

### 1.4 Dedicated evaluation: foduucom/Watermark_Removal

Link: <https://huggingface.co/foduucom/Watermark_Removal>. No separate code repo; code lives in the
model repo (`watermark_remover.py`, `main.py`).

- **What it does:** blind visible-watermark removal. No mask and no detection step: the whole
  image goes in, a "clean" image comes out. It does nothing for invisible watermarks.
- **Architecture:** a textbook 4-level U-Net (double 3x3 conv blocks 64 to 1024 channels, max
  pool, nearest upsample, skip concatenation, 1x1 output conv). No pretrained backbone.
  31.4M parameters (measured). Trained on a private set of 20,000 watermarked images at 256x256,
  MSE plus perceptual loss, 200 epochs on one RTX 3060. Claims PSNR 30.5 dB and SSIM 0.92 on an
  unpublished test set.
- **Weights:** `model.pth`, 125.5 MB (fp32 state dict). Tagged Apache-2.0.
- **Framework and ONNX:** PyTorch only upstream. ONNX export is trivial (all standard ops); it
  was exported for this report at opset 17 with dynamic height and width (125.5 MB). An open PR
  (#5) also proposes uploading a `model.onnx`.
- **CPU time (measured, onnxruntime native):** at its training size 256x256, 0.29 s (8 threads)
  or 1.3 s (1 thread). Run natively at 1024x1024, 5.8 s (8 threads) or 19.7 s (1 thread).
  Browser WASM estimate: 0.5 to 1 s at 256 px, 10 to 40 s at 1024 px.
- **RAM:** about 1 GB for 1024 px inference (activations of the 64-channel full-resolution
  blocks dominate); PyTorch load plus export peaked at 4.1 GB.
- **Quality and community signal:** 46 likes, near-zero recent downloads, created and last
  modified 2025-01-18 (no updates since). Five open discussions, none answered by maintainers in
  a way that resolves them: #2 "Won't work", #4 "Does not work for watermark images with unclear
  tiling" and "the output image is even blurry compared to the original image". The official
  usage code resizes every input to 256x256 and then upsamples the output back to the original
  size, so **every output loses almost all detail** at normal photo resolutions. Running it at
  full resolution avoids the resize but is outside its training distribution. It also regresses
  the whole image, so it can shift colors outside the watermark region, which a mask-based
  inpainter never does.
- **Verdict:** technically browser-loadable (onnxruntime-web or Transformers.js with a custom
  ONNX), but **not recommended for browser or desktop**. It is slower and blurrier than MI-GAN
  plus a mask, has no localization, and has no maintained upstream. At most it is a baseline for
  comparison.

### 1.5 Video inpainting and removal models

| Name | Link | Type | License | CPU verdict |
|---|---|---|---|---|
| STTN | [GitHub](https://github.com/researchmm/STTN) | Spatial-temporal transformer, 432x240 | MIT | Oldest and lightest; CPU possible at low res, seconds per frame; quality below ProPainter |
| E2FGVI | [GitHub](https://github.com/MCG-NKU/E2FGVI) | Flow-guided end-to-end | CC BY-NC style (non-commercial) | GPU oriented, CPU minutes per short clip; license blocks it |
| ProPainter | [GitHub](https://github.com/sczhou/ProPainter) | Dual-domain propagation plus sparse transformer (ICCV 2023) | NTU S-Lab License 1.0 (non-commercial) | Best classic quality; needs a GPU in practice; license blocks it |
| DiffuEraser | [paper list](https://arxiv.org/pdf/2505.24873) | SD-based video eraser | varies | GPU only |
| MiniMax-Remover | [GitHub](https://github.com/zibojia/MiniMax-Remover), [paper](https://arxiv.org/pdf/2505.24873) | Wan2.1-1.3B DiT, 6 steps, no CFG (2025) | no license file | about 8 GB GPU; not CPU feasible |
| 2026 one-step removers (YOSE, SEDiT, draft-free distillation) | [YOSE](https://arxiv.org/pdf/2604.27322), [SEDiT](https://arxiv.org/pdf/2605.14894), [one-step](https://arxiv.org/pdf/2607.14976) | DiT-based video object and subtitle removal | research | Faster on GPU, still billions of parameters; not CPU feasible |

## 2. Invisible watermarks: what works locally on CPU

### 2.1 The schemes

| Scheme | Where it appears | How it embeds | Public detector? |
|---|---|---|---|
| DWT-DCT / DWT-DCT-SVD ([invisible-watermark](https://github.com/ShieldMnt/invisible-watermark), MIT) | Default in original Stable Diffusion scripts and diffusers | Fixed bits in wavelet and DCT coefficients | Yes, open source |
| Stable Signature ([repo](https://github.com/facebookresearch/stable_signature), CC-BY-NC) | Meta research, LDM decoder fine-tune | Watermark baked into the VAE decoder | Research code only |
| Tree-Ring ([repo](https://github.com/YuxinWenRick/tree-ring-watermark), MIT) | Research | Pattern in the Fourier space of the initial noise | Needs the model for DDIM inversion |
| StegaStamp | Research | Learned encoder, very robust | Research code |
| Video Seal ([repo](https://github.com/facebookresearch/videoseal), MIT; [paper](https://arxiv.org/abs/2412.09492)) and Pixel Seal ([paper](https://arxiv.org/pdf/2512.16874)) | Meta | Learned post-hoc embedder, trained with codec augmentation | Yes, open weights |
| SynthID-Image ([paper](https://arxiv.org/abs/2510.09263)) | Google Imagen, Gemini, Veo | Learned post-hoc, internet-scale | No public detector (Google portal only) |
| Digimarc and similar commercial forensic marks | Stock and media | Proprietary, spread-spectrum style | Vendor only |

### 2.2 Attack families and their CPU cost (measured where marked)

| Attack | CPU cost at 1024x1024 | Quality cost | Notes |
|---|---|---|---|
| JPEG re-encode (q 50 to 75) | milliseconds | low to medium | Already in reach of the existing jSquash encoders |
| Resize down and back up (for example 50%) | milliseconds (existing SIMD Lanczos) | medium, loses fine detail | Already in the Adjust panel |
| Gaussian blur, noise, brightness and contrast | milliseconds | low to medium | Blur alone breaks Stable Signature in WAVES |
| Crop, small rotation (1 to 5 degrees), flip | milliseconds | low | Geometric edits hurt StegaStamp and DWT-DCT most |
| TAESD round trip ([madebyollin/taesd](https://huggingface.co/madebyollin/taesd), MIT, 2.4M params, about 10 MB) | **measured** 1.3 s at 512, 6.1 s at 1024 (8 thr) | medium, slight softening and color shift | Cheapest learned "regeneration"; in-browser feasible |
| SD VAE round trip ([sd-vae-ft-mse](https://huggingface.co/stabilityai/sd-vae-ft-mse), MIT, 83.7M params, 335 MB) | **measured** 18.5 s at 512, 81 s at 1024 (8 thr); 95 s at 4 thr; 4.6 GB peak RSS | low to medium | The "Regen-VAE" attack from Zhao et al. Desktop path only; tile at 512 in the browser |
| Diffusion purification or img2img regeneration (SD 1.5, strength 0.1 to 0.3) | minutes per image on CPU (VAE cost plus 3 to 10 U-Net steps at about 1B params) | low if strength small | Strongest general attack; "rinsing" repeats it |
| Adversarial spectral attack (UnMarker) | GPU with 32 GB or more; hours on CPU | low | Not a product feature |
| Surrogate detector and embedding attacks (WAVES) | needs a surrogate model and gradients | low | Research only |

### 2.3 Effectiveness by scheme

| Scheme | Simple transforms (JPEG, resize, blur, crop, rotate) | VAE round trip | Diffusion regeneration | Adversarial | Sources |
|---|---|---|---|---|---|
| DWT-DCT (SD default) | **Breaks easily**: brightness and contrast, rotation, resize, JPEG 50 | Breaks | Breaks | n/a | [Attack-resilient watermarking](https://arxiv.org/pdf/2401.04247), [ROBIN](https://arxiv.org/pdf/2411.03862) |
| Stable Signature | Blur already causes detection failure | Breaks (Regen-KLVAE ranked 6th) | **Breaks to near zero** (Regen-Diff ranked 1st) | relatively robust | [WAVES](https://arxiv.org/abs/2401.08573), [Stable Signature is Unstable](https://arxiv.org/abs/2405.07145) |
| Tree-Ring | Mostly robust (rotation ranks 11th) | partial | Rinsing and single regeneration rank 5 to 7 | **Surrogate detector attacks drop TPR near zero** | [WAVES](https://arxiv.org/abs/2401.08573) |
| StegaStamp | Rotation and resized crop hurt most | mildly affected | mildly affected | transfer attacks fail | [WAVES](https://arxiv.org/abs/2401.08573) |
| Video Seal | Strong H.264 plus crop plus brightness survives; bit accuracy falls toward 50% under strong compression; weaker to Gaussian noise than StegaStamp | not reported | not reported | Square Attack removes it more easily than StegaStamp | [VideoMarkBench](https://arxiv.org/pdf/2505.21620), [COVER](https://arxiv.org/html/2609.26236) |
| SynthID-Image | **Survives**: 30 transforms incl. JPEG, resize, crop, rotation, noise, filters, overlays; 99.72% TPR at 0.1% FPR worst case | paper tested only "weak" VAE attacks | Paper does not claim robustness; community reports img2img strength about 0.15 removes it ([claim](https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md)); MarkNull reports 100% success on Imagen 3 | UnMarker: detection from about 100% to about 21% | [SynthID-Image](https://arxiv.org/abs/2510.09263), [UnMarker](https://arxiv.org/abs/2405.08363) |
| Digimarc and forensic marks | designed to survive print and scan and recompression | unknown | unknown | unknown | no public evaluation |

### 2.4 Theory and the honest limit

- Zhao et al. prove that any watermark that perturbs an image within a bounded L2 distance can be
  removed by a regeneration attack so that no detector works
  ([NeurIPS 2024](https://arxiv.org/abs/2306.01953)). Semantic marks such as Tree-Ring sit
  outside that bound, which is why they survive VAE round trips.
- UnMarker ([IEEE S&P 2025](https://arxiv.org/abs/2405.08363)) shows robust marks must live in
  spectral amplitudes and attacks them there; it needs no detector access but needs a big GPU.
- **Removal is detectable.** Goonatilake and Ateniese
  ([2026](https://arxiv.org/abs/2605.09203)) ran six recent removal attacks: attack-specific
  forensic detectors flag at least 99% of removed images at 1% FPR, and only 1 of 750 outputs was
  both clean, faithful and forensically stealthy. Removal trades an explicit mark for an implicit
  one.
- Nothing local and fast can certify that SynthID, Digimarc or an unknown future mark is gone,
  because there is no local detector to check against. The product copy must say **"reduces
  known invisible watermarks; cannot guarantee removal; the image may still be identifiable as
  processed"**. That matches the existing README tone for steganography.

## 3. Runtime paths for a fully local product

### 3.1 In the browser

| Runtime | CPU backend | GPU backend | Fits which models | Notes |
|---|---|---|---|---|
| [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) 1.30 | WASM with SIMD, multi-thread only when `crossOriginIsolated` | WebGPU, WebNN | MI-GAN, LaMa (both exports), TAESD, the foduucom U-Net, YOLO | Primary choice. `env.wasm.numThreads` includes the main thread; without SharedArrayBuffer it silently runs one thread ([issue](https://github.com/microsoft/onnxruntime/issues/19148)) |
| [Transformers.js](https://huggingface.co/docs/transformers.js) 4.3 | onnxruntime-web underneath | WebGPU | Florence-2, OWLv2, Grounding DINO, SigLIP2 | Handles tokenizers and post-processing for the detectors |
| TensorFlow.js / LiteRT web | WASM, WebGL | WebGPU | MI-GAN TFLite | Only if a TFLite-only model is chosen; adds a second runtime |
| candle-wasm / burn | WASM (Rust) | WebGPU (burn) | MI-GAN via GGUF, small CNNs | Tempting next to the Rust core, but FFC ops for LaMa are not there; porting cost is high |

Browser time estimates (WASM, 4 to 8 threads, cross-origin isolated): MI-GAN 1.5 to 3 s per
edit, LaMa 5 to 12 s per 512 pass, TAESD round trip 10 to 20 s at 1024, Florence-2-base 25 to
45 s per image. Single-threaded WASM roughly doubles to triples these. WebGPU, where available,
cuts LaMa to well under a second on integrated GPUs (reported target: 512 tile in about 200 ms on
an M1, [ref](https://github.com/lexluthor0304/NegativeConverter/issues/163)), but the requirement
here is CPU-only, so WebGPU is an optional accelerator, never a dependency.

Model size is not a selection criterion: every model is fetched only when the user turns that
feature on, with a progress bar, then cached. Sizes are listed for the progress UI.

### 3.2 Desktop or CLI fallback

- **Python plus onnxruntime CPU:** the measured numbers in section 1 apply directly
  (MI-GAN about 1 s, LaMa about 3 s per 512 pass, TAESD 6 s and SD VAE 81 s at 1024).
- **IOPaint:** `pip install iopaint` then `iopaint run --model=lama --device=cpu` for batch
  folders, or `iopaint start --model=lama --device=cpu` for its local UI. Same LaMa cost plus
  PyTorch overhead.
- **WatermarkRemover-AI:** full detect plus inpaint pipeline for images and video on CPU,
  about 15 to 20 s per image with Florence-2-base on the test laptop.
- The desktop path is the right home for the SD VAE round trip and any diffusion purification.

## 4. Video specifics

### 4.1 Budget

A 100 MB clip is typically 60 to 120 s of 1080p at 30 fps, so 1800 to 3600 frames. At 1 s per
frame (MI-GAN) that is 30 to 60 minutes, and 2 to 4 hours with LaMa. "A few minutes" means about
0.05 to 0.1 s per frame in total, including decode and encode. Neural per-frame inpainting of the
full 512 window does not fit; the plan has to reuse work across frames.

### 4.2 Static overlay detection across frames

- **Temporal median or minimum-variance trick:** sample 50 to 200 frames spread across the clip.
  A burned-in platform logo or text is constant while content moves, so the per-pixel temporal
  standard deviation is near zero there and the per-pixel gradient magnitude is consistently
  high. Threshold `low variance AND consistent edges`, dilate by a few pixels, and you have the
  overlay mask in about a second of CPU time, without any detector.
- **Multi-image watermark estimation:** Dekel et al., "On the Effectiveness of Visible
  Watermarks" ([CVPR 2017](https://watermark-cvpr17.github.io/)), show that a consistent
  semi-transparent watermark can be solved for its alpha matte and color from many images, then
  removed by exact **reverse alpha blending**: `I = (J - alpha * W) / (1 - alpha)`. That is
  milliseconds per frame, preserves the real pixels under the logo, and needs no neural net.
  Video frames are the ideal input for it.
- Moving overlays (bouncing TikTok handle, Sora badge that changes corner): run a detector on
  every Nth frame (WatermarkRemover-AI uses `--detection-skip`), track or interpolate boxes, and
  reuse the mask between detections.

### 4.3 Removal strategies, fastest first

1. **Reverse alpha blending** for semi-transparent static marks: exact, milliseconds per frame.
2. **Classic inpainting** (Telea or Navier-Stokes, as in OpenCV) for thin opaque text a few
   pixels wide: milliseconds per frame, can be written in the Rust core.
3. **Neural inpainting on a small crop**: only the mask bounding box plus context padding. Export
   the bare MI-GAN 256 generator instead of the 512 pipeline so a corner logo costs a fraction of
   a second. Neural fill on every frame flickers, so either inpaint keyframes only and blend, or
   apply temporal smoothing inside the mask.
4. **Temporal models** (ProPainter, E2FGVI): best quality, but GPU-bound and non-commercial.
   Desktop only, and only with a separate license decision.

### 4.4 Browser video plumbing

Decode with WebCodecs `VideoDecoder` behind an MP4 demuxer (for example mp4box.js), process
frames as RGBA in the Worker, encode with `VideoEncoder`, and mux back. ffmpeg.wasm works but is
several times slower. The fail-closed audit must be extended to the video container (strip
`udta`, `meta`, XMP and C2PA boxes) before any video output is released. That is new core work,
independent of watermark removal.

## 5. Recommendation for this repo

### 5.1 Choice for v1 (browser first, CPU only, images)

| Role | Choice | Size (for the progress UI) | License | Why |
|---|---|---|---|---|
| Mask, default | User brush plus corner presets (bottom-right, bottom-left, top-right, top-left) | 0 | own code | Zero download, zero false positives, covers most AI-generator badges and stock stamps |
| Mask, optional "Find watermark" | Florence-2-base, open-vocabulary prompt "watermark" (and "logo", "text"), via Transformers.js | about 275 MB int8, about 1.1 GB fp32 | MIT | Best zero-shot recall with a permissive license. Slow (25 to 45 s in browser), so it is a button, not automatic |
| Mask, later | Own small detector (RT-DETR or D-FINE class, Apache-2.0) trained on synthetic overlays | about 10 to 40 MB | Apache-2.0 | Replaces Florence-2 with a sub-second model. Do **not** ship the Ultralytics-based YOLO watermark detectors (AGPL-3.0) |
| Remove, default ("Fast") | MI-GAN 512 ONNX pipeline | 28.1 MB | MIT | About 1 s native, about 1.5 to 3 s WASM; takes the full image and mask and composites itself |
| Remove, "High quality" | LaMa, OpenCV Zoo ONNX (fallback: Carve fp32) | 92.6 MB (208 MB) | Apache-2.0 | Ranked first on quality among CPU-viable, permissively licensed inpainters |
| Invisible, optional "Reduce AI watermarks" | TAESD round trip plus downscale plus requantization | about 10 MB | MIT | Cheap regeneration; defeats DWT-DCT and Stable Signature class marks, weakens others. Always labeled "reduce, never guarantee" |

Ranking used (quality first, then CPU speed): LaMa > MI-GAN for quality; MI-GAN > LaMa for
speed; MAT and ZITS excluded (license, CPU cost); SD inpainting excluded (minutes per image on
CPU); foduucom U-Net and the WDNet / SLBR family excluded (quality, license).

### 5.2 Integration sketch

```
main thread                          sanitize Worker (existing)
-----------                          --------------------------
drop image  ------------------------> decode_and_transform (Rust core) -> RGBA
mini-editor: brush / preset mask
[optional] "Find watermark" -------> detector Worker (Transformers.js, lazy) -> boxes -> mask
"Remove" ---------------------------> inpaint step (onnxruntime-web, lazy session):
                                        crop bbox + padding -> MI-GAN or LaMa -> paste mask area
                                     [optional] reduce-invisible: TAESD + resize + requant
                                     encode (jSquash) -> strip_and_audit (Rust core) -> gate
download  <-------------------------- verified-clean bytes
```

The inpaint step sits between step 3 (edits on decoded pixels) and step 4 (fresh encode) of the
README pipeline, so strip and audit stay untouched and still decide the download.

### 5.3 On-demand model loading pattern

- Fetch a model only after the user enables the feature, with a streamed `fetch` and a progress
  bar (bytes read versus `Content-Length`), cancelable.
- Verify SHA-256 of the bytes against a hash pinned in source before creating the session; fail
  closed on mismatch.
- Cache in Cache Storage or OPFS so the second use is offline and instant; offer "delete
  downloaded models".
- Create the `InferenceSession` inside a Worker (never the main thread), reuse it, and release it
  when the user leaves the feature.

### 5.4 Repo-specific blockers found

- **CSP:** production `index.html` sets `connect-src 'none'` (`.env.production`). Model fetches
  need `connect-src 'self'` with models served from the same origin under a fixed path such as
  `/models/<sha256>.onnx`. Do not fetch from Hugging Face at runtime; that would break the
  no-network promise.
- **Worker CSP:** dedicated Workers loaded from a URL take their CSP from their own response
  headers, not from the page meta tag. The Vercel headers only set `frame-ancestors`, so add a
  header-level CSP (including `script-src 'self' 'wasm-unsafe-eval'` and a scoped `connect-src`)
  for worker and asset responses.
- **Threads:** COOP `same-origin` is already set; add `Cross-Origin-Embedder-Policy:
  require-corp` (or `credentialless`) so `crossOriginIsolated` is true and onnxruntime-web can use
  more than one thread. Without it every timing above roughly doubles or triples.
- **Tests:** `tests/no-network.spec.ts` must allow exactly the pinned same-origin model URLs when
  the feature is on, and still fail on anything else.
- **Hosting:** GitHub rejects files over 100 MB, so the 208 MB Carve LaMa needs Git LFS or a
  build-time download with hash check; the 92.6 MB OpenCV LaMa and 28 MB MI-GAN fit. Check the
  host's static file size limit before release.
- **Legal copy:** removing someone else's watermark can violate copyright and anti-circumvention
  rules (for example removal of copyright management information under 17 U.S.C. 1202). Frame the
  feature for the user's own images and platform overlays on their own content.

### 5.5 Step list

1. Add COEP and a header-level CSP for worker and wasm assets; confirm `crossOriginIsolated` in
   the e2e suite.
2. Add `onnxruntime-web` (WASM build only at first) and a small model loader: streamed fetch,
   progress events, SHA-256 check, Cache Storage or OPFS cache.
3. Host `migan_pipeline_v2.onnx` same-origin under a hashed path; extend the no-network test to
   allow exactly that path.
4. Add a mask layer to the mini-editor: brush, eraser, corner presets, mask preview.
5. Add an `inpaint` message to the sanitize Worker: RGBA plus mask in, crop to bounding box plus
   padding, run MI-GAN, paste only masked pixels, hand RGBA to the existing encode, strip and
   audit.
6. Add a determinism check: same image and mask gives byte-identical output with the WASM
   backend (WebGPU results can differ across GPUs, so keep WASM as the reference).
7. Add LaMa (OpenCV Zoo build) as "High quality", same loader and message, 512 tiling for large
   masks.
8. Add optional "Find watermark" with Florence-2-base in its own Worker via Transformers.js.
9. Add "Reduce AI watermarks" (TAESD round trip plus resize plus requant) with the "reduce,
   never guarantee" copy, and record it in the local sanitization report.
10. Video, later: WebCodecs decode and encode, temporal-variance mask, reverse alpha blending
    first, small-crop MI-GAN second, plus container strip and audit for MP4.

## 6. Sources

- LaMa: <https://github.com/advimman/lama>, <https://huggingface.co/Carve/LaMa-ONNX>,
  <https://huggingface.co/opencv/inpainting_lama>, <https://huggingface.co/qualcomm/LaMa-Dilated>
- MI-GAN: <https://github.com/Picsart-AI-Research/MI-GAN>, <https://huggingface.co/edgetools/migan>,
  <https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT>,
  <https://huggingface.co/Acly/MIGAN-GGUF>
- MAT: <https://github.com/fenglinglwb/MAT>; ZITS: <https://github.com/DQiaole/ZITS_inpainting>
- IOPaint: <https://github.com/Sanster/IOPaint>, <https://www.iopaint.com/models>
- WatermarkRemover-AI: <https://github.com/D-Ogi/WatermarkRemover-AI>;
  Unmark: <https://github.com/youngkim0/watermark-remover>
- foduucom: <https://huggingface.co/foduucom/Watermark_Removal>
- Visible-watermark nets: <https://github.com/bcmi/SLBR-Visible-Watermark-Removal>,
  <https://github.com/vinthony/deep-blind-watermark-removal>, <https://github.com/MRUIL/WDNet>,
  <https://github.com/bcmi/Awesome-Visible-Watermark-Removal>
- Detection: <https://huggingface.co/microsoft/Florence-2-base>,
  <https://huggingface.co/onnx-community/Florence-2-base>,
  <https://huggingface.co/google/owlv2-base-patch16-ensemble>,
  <https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX>,
  <https://huggingface.co/ayan4m1/Watermark-Detection-YOLO26-ONNX>,
  <https://huggingface.co/prithivMLmods/Watermark-Detection-SigLIP2>
- Video: <https://github.com/sczhou/ProPainter>, <https://github.com/MCG-NKU/E2FGVI>,
  <https://github.com/researchmm/STTN>, <https://github.com/zibojia/MiniMax-Remover>,
  <https://watermark-cvpr17.github.io/>
- Invisible: WAVES <https://arxiv.org/abs/2401.08573>; Zhao et al.
  <https://arxiv.org/abs/2306.01953> and <https://github.com/XuandongZhao/WatermarkAttacker>;
  UnMarker <https://arxiv.org/abs/2405.08363> and <https://github.com/andrekassis/ai-watermark>;
  Stable Signature is Unstable <https://arxiv.org/abs/2405.07145>; SynthID-Image
  <https://arxiv.org/abs/2510.09263>; forensic stealth <https://arxiv.org/abs/2605.09203>;
  Video Seal <https://arxiv.org/abs/2412.09492>; VideoMarkBench
  <https://arxiv.org/pdf/2505.21620>; Pixel Seal <https://arxiv.org/pdf/2512.16874>;
  DWT-DCT fragility <https://arxiv.org/pdf/2401.04247>; TAESD
  <https://huggingface.co/madebyollin/taesd>; SD VAE <https://huggingface.co/stabilityai/sd-vae-ft-mse>
- Runtime: <https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html>,
  <https://github.com/microsoft/onnxruntime/issues/19148>
