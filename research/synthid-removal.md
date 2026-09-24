
# SynthID removal: what works, what it costs on a CPU, and what STOPTRACKINGME can honestly ship

Research date: 2026-09-24. Scope: Google SynthID in images (Imagen, Gemini and Nano Banana output,
and since May 2026 also OpenAI images), in Veo video, and a short note on audio. Written for the
STOPTRACKINGME repo (browser only, no upload, CPU only, models loaded on demand, MIT). This report
extends section 2 of `research/local-cpu-watermark-removal-models.md` and does not repeat its
general tables. Timings marked **measured** come from that earlier report (Ryzen 9 5900HX, 8 cores,
native onnxruntime). Everything marked **estimate** is a reasoned guess, not a measurement.

## Executive summary

- **SynthID-Image is a learned, post-hoc encoder and decoder** that works on any image, independent
  of the generator. The paper reports 99.72% true positive rate at 0.1% false positive rate under
  the worst of 30 transforms, and says it was trained to resist "weak" VAE regeneration
  ([arXiv 2510.09263](https://arxiv.org/html/2510.09263v1)). Independent hands-on tests agree:
  JPEG at quality 15, heavy resize, crops, overlays, screenshots and combinations all stayed
  detected; only cropping to a tiny piece failed
  ([MajorGeeks, 2026-09-19](https://www.majorgeeks.com/content/page/google_is_hiding_an_invisible_watermark_in_ai_images_so_i_tried_to_break_it.html)).
- **Everything STOPTRACKINGME does today (re-encode, resize, rotate, flip, metadata strip) does not
  remove SynthID.** It removes C2PA credentials, which is a separate layer.
- **A plain VAE round trip does not remove it either.** MarkNull measured 0% attack success for a
  VAE attack on 20 Imagen 3 images, checked with Gemini
  ([arXiv 2608.10166](https://arxiv.org/html/2608.10166)). So the TAESD and SD VAE rungs are
  useful for weak marks (DWT-DCT, Stable Signature) but have **no evidence** against SynthID.
- **What does remove it, in small published samples:** diffusion regeneration. Low-strength
  img2img (SDXL at strength 0.10 to 0.15) cleared 4 of 4 and 9 of 9 test images in two community
  tools ([wiltodelta](https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md),
  [froggeric](https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md)).
  A diffusion regeneration attack, CtrlRegen, UnMarker and MarkNull each reached 100% on 20 Imagen 3
  images ([MarkNull, Table 4](https://arxiv.org/html/2608.10166)). Results near the threshold are
  seed dependent, and every sample is tiny because Google's checker allows about 10 checks a day
  ([Gemini Help](https://support.google.com/gemini/answer/16722517?hl=en&co=GENIE.Platform%3DDesktop)).
- **On a laptop CPU, regeneration is minutes per image, not seconds.** One tool reports about
  231 s per 896x1200 tile for SDXL on CPU
  ([froggeric](https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md)).
  An SD 1.5 class model with a one-step schedule and 512 px tiles is the only realistic browser
  path: **estimate** 1.5 to 7 minutes per 1024 px image in onnxruntime-web WASM. Anything above
  about 4 GB of weights cannot load in a WASM CPU session at all
  ([onnxruntime docs](https://onnxruntime.ai/docs/tutorials/web/large-models.html)).
- **Licensing is the real blocker for "permissive and small".** No MIT or Apache diffusion model
  that fits the browser has been tested against SynthID. The small models that fit (SD 1.5,
  SDXS, SD-Turbo) carry OpenRAIL or Stability Community terms. The Apache models (FLUX.2 klein 4B,
  Z-Image-Turbo 6B, PRX 1.3B) are either too large for WASM or untested.
- **Removal is detectable.** Per-attack forensic classifiers flag 99.24% to 99.97% of removed images
  at 1% false positive rate ([arXiv 2605.09203](https://arxiv.org/html/2605.09203v1)). An open
  source, fixed pipeline is the easiest case for such a classifier. Removing SynthID does not make
  an image look human-made.
- **Video:** Veo marks every frame, and Google says the mark survives re-encoding, frame rate
  changes and cropping. Per-frame regeneration on CPU would take hours for an 8 second clip
  (**estimate**). Not feasible as a product feature.
- **Recommendation:** ship at most one clearly labelled, opt-in "Reduce AI watermarks
  (experimental)" rung based on low-strength regeneration, with the copy "reduces, never
  guarantees", no claim of verification, and a clear note that it is not a way to pass AI content
  off as human-made. Do not present the cheap rungs as SynthID reduction.

## 1. How SynthID-Image embeds and detects

### 1.1 The system

| Property | What is known | Source |
|---|---|---|
| Design | Post-hoc, model-independent encoder plus decoder, applied after generation, "without any knowledge or assumptions on the generative model" | [2510.09263, sec. 2.2](https://arxiv.org/html/2510.09263v1) |
| Internal resolution | Works at 512x512 for efficiency; the authors call out avoiding resize artifacts when encoding | [2510.09263, sec. 3](https://arxiv.org/html/2510.09263v1) |
| Payload | External variant SynthID-O carries 136 bits in a 512x512 image | [2510.09263, sec. 8](https://arxiv.org/html/2510.09263v1) |
| Decoder output | One detection logit, one logit per payload bit, a threshold calibrated to a target false positive rate, and an abstain option for uncertain cases (conformal p-values) | [2510.09263, sec. 7](https://arxiv.org/html/2510.09263v1) |
| Scale | Over ten billion images and video frames watermarked across Google services | [2510.09263, abstract](https://arxiv.org/abs/2510.09263) |
| Deployed vs published | The paper benchmarks SynthID-O, "available through partnerships". The internal production model is not identical and is not described in full | [2510.09263](https://arxiv.org/abs/2510.09263) |
| Spatial spread | Not stated as a mechanism in the paper. Empirically the mark survives crops to half size and fails only on tiny crops, which fits a signal spread over the whole frame | [MajorGeeks](https://www.majorgeeks.com/content/page/google_is_hiding_an_invisible_watermark_in_ai_images_so_i_tried_to_break_it.html), [Gemini Help](https://support.google.com/gemini/answer/16722517?hl=en&co=GENIE.Platform%3DDesktop) |
| Adoption beyond Google | OpenAI adds SynthID to ChatGPT, API and Codex images since 2026-05-19; Kakao and ElevenLabs also adopt it | [OpenAI](https://openai.com/index/advancing-content-provenance/), [TNW](https://thenextweb.com/news/openai-c2pa-synthid-ai-image-detection-watermark) |
| Paired with C2PA | Nano Banana 2 images carry both SynthID and C2PA Content Credentials | [Google blog](https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/) |

An inference from the 512 px design (not stated by Google): the detector very likely rescales
inputs, so downscaling an image does not starve it of signal. That matches the resize tests below.

### 1.2 Robustness reported in the paper (SynthID-O, TPR at 0.1% FPR)

| Transform class (30 transforms total) | Random strength | Worst case |
|---|---|---|
| Color | 100.00% | 100.00% |
| Combination | 99.96% | 98.06% |
| Noise | 99.98% | 99.96% |
| Overlay | 100.00% | 100.00% |
| Quality (compression) | 99.99% | 99.99% |
| Spatial (resize, crop, rotation) | 99.98% | 99.97% |
| **All** | **99.98%** | **99.72%** |

Source: [2510.09263, Table 1](https://arxiv.org/html/2510.09263v1). Payload bit accuracy is lowest
for worst-case combinations (89.46%), but detection, the part that matters here, is not.

### 1.3 What the paper says about regeneration and adversarial attacks

- The authors "specifically tested and ensured robustness against off-the-shelf weak re-generation
  attack models (e.g., using variational autoencoders)" (sec. 6.2).
- They aim to make **black-box attacks computationally infeasible at scale**, not to stop "a
  determined white-box adversary", and state that perfect security is impossible (sec. 6.2, 10).
- They do **not** claim robustness to diffusion regeneration at meaningful strength. That gap is
  exactly where every successful public attack sits.

### 1.4 Detector availability

| Channel | Access | Limits | Source |
|---|---|---|---|
| Gemini app "is this made with Google AI?" | Anyone with a Google account | About 10 image, 10 video and 10 audio checks per rolling 24 h; images up to 100 MB; video under 90 s; audio under 1 h | [Gemini Help](https://support.google.com/gemini/answer/16722517?hl=en&co=GENIE.Platform%3DDesktop), [Google blog](https://blog.google/technology/ai/verify-google-ai-videos-gemini-app/) |
| SynthID Detector portal | Waitlist; journalists and researchers first | Upload, highlights watermarked regions | [DeepMind](https://deepmind.google/models/synthid/), [2510.09263](https://arxiv.org/abs/2510.09263) ("trusted testers") |
| OpenAI verification tool | Preview, public | Checks C2PA and SynthID in images and audio | [OpenAI](https://openai.com/index/advancing-content-provenance/) |
| SDK or API access | Restricted after the UnMarker disclosure | Manual web checks only | [UnMarker repo](https://github.com/andrekassis/ai-watermark) |
| Public weights | **None** for SynthID-Image. Only SynthID-Text is open source | n/a | [Google AI for Developers](https://ai.google.dev/responsible/docs/safeguards/synthid) |

Consequence for this project: there is **no local way to check** whether SynthID is still present.
Any check means uploading the image to Google or OpenAI, which breaks the no-upload promise.
Community "detectors" (for example the reverse-SynthID spectral detector, claimed 90% accurate) are
unvalidated ([reverse-SynthID](https://github.com/aloshdenny/reverse-SynthID/blob/main/README.md)).

### 1.5 Papers and projects on SynthID, 2025 to 2026

| Work | Date | What it adds |
|---|---|---|
| [SynthID-Image, arXiv 2510.09263](https://arxiv.org/abs/2510.09263) | Oct 2025 | Design, robustness, threat model (above) |
| [UnMarker, arXiv 2405.08363](https://arxiv.org/abs/2405.08363), [repo](https://github.com/andrekassis/ai-watermark) | IEEE S&P 2025, SynthID results added later | Claims 79% success on SynthID (detection about 100% to about 21%); Google disputes and says "significantly lower" ([IEEE Spectrum](https://spectrum.ieee.org/ai-watermark-remover)) |
| [Forensic stealth, arXiv 2605.09203](https://arxiv.org/html/2605.09203v1) | EuroS&P 2026 | Removal leaves a detectable trace (section 3) |
| [MarkNull, arXiv 2608.10166](https://arxiv.org/html/2608.10166) | Aug 2026 preprint | 100% success on 20 Imagen 3 images; compares 8 baselines on SynthID |
| [Hide&Seek, arXiv 2603.01067](https://arxiv.org/html/2603.01067) | Mar 2026 | Cheap pixel reconstruction attack; not tested on SynthID |
| [MarkSweep, ICASSP 2026](https://ieeexplore.ieee.org/document/11460613/) | 2026 | Learned denoiser attack; not tested on SynthID |
| [Re-watermarking, arXiv 2605.16796](https://arxiv.org/html/2605.16796) | May 2026 | Overwriting with a second mark; not tested on SynthID |
| [reverse-SynthID](https://github.com/aloshdenny/reverse-SynthID/blob/main/README.md) | 2026, community | Spectral codebook subtraction plus a 7-stage chain; claims Gemini bypass on two models |
| [SynthID-Text robustness, arXiv 2508.20228](https://arxiv.org/abs/2508.20228) | Aug 2025 | Text only; paraphrase and back-translation weaken it |

## 2. Attack families ranked by reported effectiveness against SynthID

### 2.1 Evidence table

"n" is the number of images checked against Google's own verifier. Small n is the norm because
the verifier is rate limited.

| Rank | Attack | Evidence against SynthID | Verdict |
|---|---|---|---|
| 1 | Diffusion regeneration, low-strength img2img (SDXL 0.10 to 0.15; SD 1.5 class 0.15) | wiltodelta: Google images need strength 0.15, 0.05 and 0.10 fail, n=4, seed dependent near threshold ([doc](https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md)). froggeric: SDXL 0.10 at 50 steps (5 actual steps) cleared 9 of 9 incl. a double-marked image, two rounds; 0.04 to 0.08 missed the double mark ([README](https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md)). MarkNull "DA" baseline 100%, n=20 ([2608.10166](https://arxiv.org/html/2608.10166)). noai-watermark: SD 1.5 class (DreamShaper 8) at 0.15, one shown example ([repo](https://github.com/mertizci/noai-watermark)) | **Removes in small samples; not reliable near threshold** |
| 2 | Latent manipulation (MarkNull, MarkNull-A) | 100%, n=20, best quality score among successful attacks ([2608.10166](https://arxiv.org/html/2608.10166)) | **Removes (n=20)** |
| 3 | Controlled regeneration (CtrlRegen, CtrlRegen+) | 100%, n=20, lower quality than MarkNull ([2608.10166](https://arxiv.org/html/2608.10166), [CtrlRegen](https://github.com/yepengliu/CtrlRegen)) | **Removes (n=20)** |
| 4 | UnMarker spectral adversarial attack | 79% claimed by authors, disputed by Google ([IEEE Spectrum](https://spectrum.ieee.org/ai-watermark-remover)); 100% at n=20 in MarkNull's rerun | **Removes often; disputed** |
| 5 | Spectral codebook subtraction (reverse-SynthID) | Repo claims Gemini bypass for two Gemini image models ([README](https://github.com/aloshdenny/reverse-SynthID/blob/main/README.md)); issue reports failure on Flow 9:16 2K images ([issue 8](https://github.com/aloshdenny/reverse-SynthID/issues/8)). Needs a codebook per resolution and per model | **Weakens; brittle; no independent check** |
| 6 | Rinsing (repeat regeneration, WAVES "Rinse-2x/4x") | No SynthID-specific number. Stronger than single regeneration on Tree-Ring and Stable Signature ([WAVES](https://arxiv.org/abs/2401.08573)) | **Weakens (inferred)**; only helps if one pass is borderline |
| 7 | Diffusion purification (noise then denoise, no prompt) | Same mechanism as rank 1 at the same noise level; no separate SynthID data | **Same as rank 1** |
| 8 | Surrogate-detector attacks | Need a surrogate trained on SynthID outputs; none public and validated | **No evidence** |
| 9 | Re-watermarking with an open mark (Video Seal, StegaStamp) | Not tested on SynthID ([2605.16796](https://arxiv.org/html/2605.16796)); also stamps a new tracker into the image | **No evidence; wrong for a privacy tool** |
| 10 | VAE round trip (TAESD, SD VAE, compression VAE) | MarkNull "VA" 0%, n=20; paper trained against it | **Does not remove** |
| 11 | Simple transforms: JPEG (q15), resize to 200 px and back, crop, borders, text, brightness, contrast, overlays, screenshot, combinations | All still detected; tiny crop not detected ([MajorGeeks](https://www.majorgeeks.com/content/page/google_is_hiding_an_invisible_watermark_in_ai_images_so_i_tried_to_break_it.html)); paper 99.72% worst case | **Does not remove** |

### 2.2 Cost, license and browser feasibility

Browser column: "ORT-web" means onnxruntime-web on the WASM CPU backend. Transformers.js has no
diffusion pipeline, so every diffusion option means driving onnxruntime-web directly (as in
Microsoft's [SD-Turbo example](https://github.com/microsoft/onnxruntime-inference-examples/tree/main/js/sd-turbo),
which targets WebGPU). A WASM session cannot use more than 4 GB
([ORT large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)).

| Attack | CPU time per 1024 px image | Weights | License | In the browser (CPU) |
|---|---|---|---|---|
| Simple transforms | milliseconds (already in the Rust core) | none | n/a | Yes, shipped |
| TAESD round trip | **measured** 6.1 s native; **estimate** 10 to 20 s WASM | about 10 MB, 2.45M params ([HF](https://huggingface.co/madebyollin/taesd)) | MIT | Yes, easy |
| SD VAE round trip, tiled | **measured** 81 s native at 1024; **estimate** 2 to 4 min WASM | 335 MB ([sd-vae-ft-mse](https://huggingface.co/stabilityai/sd-vae-ft-mse)) | MIT | Yes, with 512 tiles |
| SDXL img2img 0.10 to 0.15 | about 231 s per 896x1200 tile via stable-diffusion.cpp on CPU ([froggeric](https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md)); 20 s per 1024 tile on an Apple M4 with CoreML | about 7 GB fp16 | CreativeML OpenRAIL++-M | No (over 4 GB, and too slow) |
| SD 1.5 class img2img, 512 tiles, 1 to 3 UNet evaluations per tile | **estimate** 45 to 135 s native, 1.5 to 7 min WASM (9 overlapping tiles, TAESD for encode and decode) | UNet 3.4 GB fp32, about 1.7 GB fp16, under 1 GB int8 | CreativeML OpenRAIL-M | **Borderline yes** with fp16 or int8 weights |
| SD-Turbo img2img (strength 0.15, 7 scheduled steps, so 1 real step) | **estimate** same order as SD 1.5 one-step | about 1.7 GB fp16 UNet | Stability AI Community License: commercial use under USD 1M revenue, "Powered by Stability AI" attribution, AUP ([license](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md)) | Borderline yes |
| SDXS-512 (one step) | 0.82 s per 512 image on a Core i7-12700 with OpenVINO ([FastSD CPU](https://github.com/rupeshs/fastsdcpu)); img2img use at low strength untested | under 1 GB | OpenRAIL++ ([HF](https://huggingface.co/IDKiro/sdxs-512-0.9)) | Likely yes; SynthID effect untested |
| FLUX.2 klein 4B img2img | **estimate** several minutes per step native | about 8 GB bf16 plus a text encoder | Apache-2.0 ([HF](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)) | No (over 4 GB) |
| Z-Image-Turbo 6B | **estimate** worse than FLUX.2 klein | about 12 GB bf16 | Apache-2.0 ([repo](https://github.com/Tongyi-MAI/Z-Image/blob/main/LICENSE)) | No |
| PRX 1.3B (Photoroom) | **estimate** 15 to 30 s per step native at 1024 | about 2.6 GB bf16 plus T5-Gemma text encoder | Apache-2.0 model; text encoder under Gemma terms ([blog](https://huggingface.co/blog/Photoroom/prx-open-source-t2i-model)) | Maybe, with a precomputed empty-prompt embedding; untested against SynthID |
| CtrlRegen | minutes to tens of minutes (**estimate**); about 10 GB of models incl. DINOv2-giant ([noai-watermark](https://github.com/mertizci/noai-watermark)) | about 10 GB | mixed | No |
| MarkNull / MarkNull-A | GPU: 5 to 10 s, or 0.5 s with 6.3 GB VRAM for MarkNull-A on an A100 ([2608.10166](https://arxiv.org/html/2608.10166)); CPU not reported | SD 1.5 based plus a trained network | Code on Zenodo, license not verified | Unknown; MarkNull-A is a single forward pass, so worth a later look |
| UnMarker | about 5 min on an A100 40 GB ([IEEE Spectrum](https://spectrum.ieee.org/ai-watermark-remover)); 2553 s in Hide&Seek's measurement ([2603.01067](https://arxiv.org/html/2603.01067)); needs a 32 GB or larger GPU ([repo](https://github.com/andrekassis/ai-watermark)) | about 30 GB incl. data | LICENSE file present, type not verified | No (hours on CPU, **estimate**) |
| reverse-SynthID V3 spectral subtraction | milliseconds to seconds (FFT) (**estimate**); the V4 chain adds an SD VAE pass | small codebook file | not verified | Technically yes; not recommended (brittle, needs per-model codebooks, cat and mouse) |

### 2.3 Practical notes from the working tools

- **Do not paste original pixels back.** Face restoration and "detail restore" steps that copy
  pixels from the input can reintroduce the mark
  ([wiltodelta](https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md)).
  froggeric's optional restore of the top 5% of pixel differences is gated for this reason.
- **Strength is a floor, not a dial for quality.** Google images needed 0.15 in wiltodelta's SDXL
  tests, three times OpenAI's 0.05 floor before OpenAI adopted SynthID.
- **Quality cost is visible.** At 0.10 the output is "visibly smoothed and simplified", 29 to 41 dB
  PSNR against the input
  ([froggeric](https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md)).
- **Content matters.** Flat graphics survived plain SDXL, photoreal content survived the
  ControlNet variant, so no single setting worked for all images
  ([wiltodelta](https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md)).
- **SD 1.5 at 512 tiles is not the tested setup.** The only SD 1.5 class evidence is MarkNull's
  diffusion baseline and a single noai-watermark example. Tiling adds seams that must be blended.
  Expect to need 0.15 to 0.25 (**estimate**).

## 3. The detectability angle

- Goonatilake and Ateniese trained one ResNet-50 per removal pipeline (UnMarker, WatermarkAttacker,
  CtrlRegen+, NFPA, Boundary Leakage, WiTS). At 1% FPR they flagged 99.24% to 99.97% of removed
  images, AUROC 0.9984 to 0.9999
  ([arXiv 2605.09203](https://arxiv.org/html/2605.09203v1)). The earlier report notes that only
  1 of 750 outputs was clean, faithful and stealthy at once.
- Limits of that result: it was run in a pseudorandom-code watermark setting, not on SynthID, and
  each detector is trained on one known pipeline. It says nothing about cross-pipeline detection.
- **That caveat does not help an open source tool.** A public, fixed pipeline (fixed model, fixed
  strength, fixed tiling) is exactly the case a per-pipeline detector is built for. Anyone can run
  STOPTRACKINGME on a dataset and train the classifier.
- Regeneration pushes an image toward the look of the regenerating model. Generic AI-image
  detectors that do not rely on watermarks are likely to still flag it (**inference**, no
  SynthID-specific measurement found).
- Missing marks prove nothing either way. Google says absence of SynthID "doesn't prove human
  creation" ([Gemini Help](https://support.google.com/gemini/answer/16722517?hl=en&co=GENIE.Platform%3DDesktop)).
- **What this means for a user who wants to hide that an image was AI-generated or processed:**
  this tool cannot deliver that, and the copy must not suggest it. The best case is a weaker
  explicit mark traded for an implicit processing trace. The README already says the tool "is not
  a way to hide that a video is AI-generated"; the same line should cover images.

## 4. Video: SynthID for Veo

### 4.1 What is known

| Fact | Source |
|---|---|
| Veo marks video at the segment and frame level; designed to survive cropping, filters, frame rate changes and lossy compression | [DeepMind](https://deepmind.google/models/synthid/) |
| The image system also covers video frames (ten billion images and frames combined) | [2510.09263](https://arxiv.org/abs/2510.09263) |
| Gemini checks visual and audio tracks separately and reports segments ("SynthID detected within the audio between 10-20 secs") | [Google blog, 2025-12-18](https://blog.google/technology/ai/verify-google-ai-videos-gemini-app/) |
| Veo 3 video also carries a visible watermark in most outputs | [BGR](https://www.bgr.com/tech/those-amazing-veo-3-videos-will-finally-tell-you-they-were-made-with-ai/) |
| No paper measures Veo SynthID under attack. MarkNull reports generalization to VideoShield and VideoMark, not Veo | [2608.10166](https://arxiv.org/pdf/2608.10166) |

### 4.2 Do re-encode, resize or crop weaken it?

- No independent measurement exists. Google claims survival of H.264 or HEVC style compression,
  frame rate change and crop. Given the image results (JPEG q15 and heavy resize survive), assume
  the full clean path (WebCodecs re-encode plus resize) **does not remove** it.
- Detection aggregates over frames and reports segments, so weakening some frames is not enough.
  Frame interpolation or dropping frames leaves many original frames, so it should not work either
  (**inference**; the community claim that interpolated frames lack the mark is unverified).

### 4.3 Per-frame regeneration on CPU

- An 8 second Veo clip at 24 fps is 192 frames. At the **estimated** 1.5 to 7 minutes per 1024 px
  frame in WASM, that is about 5 to 22 hours. At 720p (fewer tiles) perhaps a third of that.
- Independent per-frame regeneration flickers. Fixing the seed helps, but consistent video needs a
  temporal model, and those are GPU only (section 1.5 of the earlier report).
- froggeric's tool, the most CPU-friendly of the community tools, keeps SynthID regeneration
  "CLI-only" for still images and does not attempt video.
- **Verdict: not feasible** as a product feature on CPU.

### 4.4 What Video Seal results imply

Video Seal ([arXiv 2412.09492](https://arxiv.org/abs/2412.09492)) is the closest open analogue: a
learned post-hoc mark trained with codec augmentation. Its bit accuracy falls toward 50% only under
strong compression ([VideoMarkBench](https://arxiv.org/pdf/2505.21620)), and re-watermarking erases
it ([2605.16796](https://arxiv.org/html/2605.16796)). The lesson for Veo: codec-trained video marks
survive the compression a normal user would accept, and the attacks that do work are either
visibly destructive or write a new mark. Neither fits this project.

### 4.5 Audio

SynthID audio is used in Lyria, NotebookLM audio and Veo soundtracks, and OpenAI and ElevenLabs
now add it to audio as well. Google claims survival of noise, MP3 compression and speed changes
([DeepMind](https://deepmind.google/models/synthid/), [OpenAI](https://openai.com/index/advancing-content-provenance/)).
No peer-reviewed attack numbers were found. STOPTRACKINGME already removes sound by default, which
drops any audio mark with the track. "Keep sound" re-encodes it, which should be assumed **not** to
remove SynthID audio. The existing verdict copy already says this is not a scrub.

## 5. Recommendation for STOPTRACKINGME

### 5.1 The ladder, honestly labelled

| Rung | What it does | Model and size | Time per 1024 px image | Effect on SynthID | Ship? |
|---|---|---|---|---|---|
| 0. Clean (today) | Metadata and C2PA strip, fresh encode, audit | none | under 1 s | None. Removes the C2PA credential only | Yes (exists) |
| 1. Light | Downscale, small rotate, JPEG requantize (existing tools) | none | milliseconds | **None** (evidence above) | Yes, but never label it as AI watermark reduction |
| 2. Medium | TAESD encode and decode | TAESD, about 10 MB, MIT | **measured** 6.1 s native; **estimate** 10 to 20 s in browser | **None**; helps against weak open marks (DWT-DCT, Stable Signature) | Optional, labelled for "simple invisible watermarks" |
| 3. Heavy VAE | Tiled SD VAE round trip | sd-vae-ft-mse, 335 MB, MIT | **measured** 81 s native; **estimate** 2 to 4 min in browser | **None** (VA 0% in MarkNull) | Skip; rung 4 is better value |
| 4. Regenerate (experimental) | Low-strength img2img, 512 tiles with 64 px overlap and feathered blend, fixed empty prompt, 1 to 3 real denoise steps, strength 0.15 default and 0.25 "stronger", TAESD or SD VAE for encode and decode, seed shown and reusable | SD 1.5 class UNet, fp16 about 1.7 GB or int8 under 1 GB; or SD-Turbo fp16 about 1.7 GB | **estimate** 45 to 135 s native, 1.5 to 7 min in browser | **Reduces** in the published small samples; not verified locally | Yes, opt-in, behind a clear warning |

Notes for rung 4:

- **Model choice.** No MIT or Apache model under 4 GB has SynthID evidence. The least bad fit today
  is an SD 1.5 class checkpoint (CreativeML OpenRAIL-M, commercial use allowed with use
  restrictions) or SD-Turbo (Stability Community License: attribution "Powered by Stability AI" and
  an AUP that forbids "pretending it was made by a human",
  [AUP](https://stability.ai/use-policy)). Both are downloaded on demand from their upstream, not
  vendored, so the repo stays MIT; the model's license binds the user and must be shown before
  download. Track PRX 1.3B (Apache-2.0) and FLUX.2 klein 4B (Apache-2.0) with int8 or int4 exports
  and WASM Memory64 as future candidates, and test them before switching.
- **Text encoder.** Precompute the empty-prompt embedding once and ship it as a small tensor, so the
  browser never loads CLIP or T5.
- **Runtime.** onnxruntime-web WASM with threads (needs cross-origin isolation) in the existing
  sanitize Worker. WebNN CPU or WebGPU can be offered as an optional speed-up where present; the
  CPU path must stay the reference.
- **No pixel restore step.** Do not copy original pixels back (section 2.3).
- **Output** goes into the existing encode, strip and audit path unchanged. The audit verdict
  stays about metadata; the watermark line says "not verified".
- **Before shipping:** run a small manual validation (for example 20 Gemini images and 20 OpenAI
  images, over several days because of the 10 per day limit) with a throwaway account, record the
  pass rate per strength, and publish it in `docs/`. Do not claim more than that table shows.

### 5.2 UI copy (no dashes)

- Panel title: **Reduce AI watermarks (experimental)**
- Panel text: "Redraws your picture with a small AI model that runs on your computer. This can
  weaken invisible AI watermarks such as Google SynthID. It reduces, never guarantees. The picture
  will change a little, and it may still be recognisable as AI made or as edited."
- Model prompt: "This needs a one time download of about 1.7 GB. The model is stored on this
  device. Your picture is never uploaded. Model license: [name]."
- Time hint: "Takes about 2 to 7 minutes on a laptop."
- Strength choice: "Normal" and "Stronger (more change to the picture)".
- Result line: "AI watermark reduction applied. Not verified: no checker runs offline."
- Footer line, kept from the README: "This is not a way to pass off AI content as made by a
  person."

### 5.3 What cannot be achieved locally

- **Verification.** No SynthID detector exists outside Google's servers (and OpenAI's tool), so
  the app can never say "SynthID removed". Checking would require an upload.
- **A guarantee.** Removal is seed and content dependent near the threshold, samples are tiny, and
  Google can retrain its embedder at any time.
- **Forensic stealth.** A fixed, public pipeline is easy to fingerprint (section 3).
- **Hiding AI origin.** Generic AI detectors, context and platform provenance remain.
- **Video.** Per-frame regeneration is hours per clip on CPU and flickers.
- **Audio kept with "Keep sound".** Re-encoding is not expected to remove audio SynthID.
- **Speed.** Anything strong enough to matter costs minutes per image on a laptop.

## 6. Legal and policy notes (not legal advice)

Google's Generative AI Prohibited Use Policy forbids "misrepresenting the provenance of generated
content by claiming it was created solely by a human, in order to deceive"; it does not name
SynthID removal as such ([policy](https://policies.google.com/terms/generative-ai/use-policy)).
Stability AI's AUP has a similar clause ([AUP](https://stability.ai/use-policy)). Google now lets
users hide the visible label but keeps SynthID and C2PA
([TechCrunch](https://techcrunch.com/2026/08/14/google-will-now-allow-users-to-remove-visible-watermark-from-its-ai-generations/)).
Under the EU AI Act, Article 50 applies from 2026-08-02: providers must mark AI output in a robust,
machine-readable way, and deployers must disclose deepfakes, with lighter duties for artistic,
satirical or fictional work ([Article 50](https://artificialintelligenceact.eu/article/50/)). The
final Code of Practice (2026-06-10) asks signatory providers to prohibit removal or tampering in
their terms and not to "place on the market, promote, or advertise tools whose purpose is to
circumvent transparency markings"
([DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2026/07/what-the-eus-new-code-of-practice-means),
[EC](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)).
STOPTRACKINGME is not a generative AI provider, but a user who removes a mark from a deepfake and
publishes it still owes the Article 50(4) disclosure, and positioning the feature as a way to
"remove SynthID" reads as a circumvention tool. Fines for Article 50 breaches reach EUR 15 million
or 3% of turnover. C2PA itself does not forbid stripping a manifest, and STOPTRACKINGME already does
so; C2PA soft bindings (a watermark that points back to a stored manifest) mean a stripped file can
sometimes be re-linked to its credential ([C2PA spec](https://spec.c2pa.org/)). Safest framing:
privacy and payload reduction, opt-in, with explicit "not for passing off AI content" copy, and a
check with counsel before offering it to EU users as a named SynthID feature.

## 7. Sources

- SynthID-Image paper: <https://arxiv.org/abs/2510.09263>, HTML <https://arxiv.org/html/2510.09263v1>
- DeepMind SynthID page: <https://deepmind.google/models/synthid/>
- Gemini verification help: <https://support.google.com/gemini/answer/16722517?hl=en&co=GENIE.Platform%3DDesktop>
- Gemini video verification: <https://blog.google/technology/ai/verify-google-ai-videos-gemini-app/>
- Nano Banana 2 with C2PA: <https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/>
- OpenAI provenance and SynthID adoption: <https://openai.com/index/advancing-content-provenance/>
- MarkNull: <https://arxiv.org/html/2608.10166>
- Forensic stealth: <https://arxiv.org/html/2605.09203v1>
- UnMarker: <https://arxiv.org/abs/2405.08363>, <https://github.com/andrekassis/ai-watermark>, <https://spectrum.ieee.org/ai-watermark-remover>
- Hide&Seek: <https://arxiv.org/html/2603.01067>
- MarkSweep: <https://ieeexplore.ieee.org/document/11460613/>
- Re-watermarking: <https://arxiv.org/html/2605.16796>
- CtrlRegen: <https://github.com/yepengliu/CtrlRegen>, <https://arxiv.org/pdf/2410.05470>
- WAVES: <https://arxiv.org/abs/2401.08573>
- wiltodelta/remove-ai-watermarks (Apache-2.0): <https://github.com/wiltodelta/remove-ai-watermarks/blob/main/docs/synthid.md>
- froggeric wmr (MIT): <https://github.com/froggeric/gemini-watermark-and-synthid-remover/blob/main/README.md>
- noai-watermark (MIT): <https://github.com/mertizci/noai-watermark>
- reverse-SynthID: <https://github.com/aloshdenny/reverse-SynthID/blob/main/README.md>, <https://github.com/aloshdenny/reverse-SynthID/issues/8>
- MajorGeeks hands-on test: <https://www.majorgeeks.com/content/page/google_is_hiding_an_invisible_watermark_in_ai_images_so_i_tried_to_break_it.html>
- Video Seal: <https://arxiv.org/abs/2412.09492>; VideoMarkBench: <https://arxiv.org/pdf/2505.21620>
- TAESD: <https://huggingface.co/madebyollin/taesd>; SD VAE: <https://huggingface.co/stabilityai/sd-vae-ft-mse>
- SD-Turbo license: <https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md>; Stability AUP: <https://stability.ai/use-policy>
- SDXS: <https://huggingface.co/IDKiro/sdxs-512-0.9>; FastSD CPU: <https://github.com/rupeshs/fastsdcpu>
- FLUX.2 klein 4B: <https://huggingface.co/black-forest-labs/FLUX.2-klein-4B>; Z-Image: <https://github.com/Tongyi-MAI/Z-Image/blob/main/LICENSE>; PRX: <https://huggingface.co/blog/Photoroom/prx-open-source-t2i-model>
- onnxruntime-web large models: <https://onnxruntime.ai/docs/tutorials/web/large-models.html>; SD-Turbo web example: <https://github.com/microsoft/onnxruntime-inference-examples/tree/main/js/sd-turbo>
- Google Prohibited Use Policy: <https://policies.google.com/terms/generative-ai/use-policy>
- EU AI Act Article 50: <https://artificialintelligenceact.eu/article/50/>; Code of Practice: <https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content>, <https://www.dlapiper.com/en-us/insights/publications/2026/07/what-the-eus-new-code-of-practice-means>
- C2PA specifications: <https://spec.c2pa.org/>
