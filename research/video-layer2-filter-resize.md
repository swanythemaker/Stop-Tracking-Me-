# Video layer 2: local pixel filters, resize and re-encode

Research notes for STOPTRACKINGME. Scope: after layer 1 (container and stream metadata strip,
researched separately), transform the *pixels and samples* of a video of up to 100 MB entirely
inside the browser tab, with no server and no network, then hand the result back to the layer 1
audit. Date of research: September 2026.

All throughput and size figures marked "est." are engineering estimates for planning. They must be
replaced by numbers from `scripts/bench.mjs` style measurements before any of them go into the
README.

## Executive summary

- **It is feasible today, fully local.** WebCodecs (`VideoDecoder`, `VideoEncoder`,
  `AudioDecoder`, `AudioEncoder`) ships in Chrome/Edge, desktop Firefox (130+) and Safari (video
  since 16.4, audio since 26). Paired with **Mediabunny** (pure TypeScript demux/mux, successor of
  `mp4-muxer` and `webm-muxer`) it gives a small, tree-shakable decode, transform, encode, mux
  pipeline with no multi-megabyte WASM download.
- **Recommended first version:** MP4 in, demux with Mediabunny, decode with WebCodecs, downscale
  (and rotate/flip/crop) per frame, **drop audio by default**, re-encode to **H.264 in MP4** via
  WebCodecs (VP9/WebM as the alternative), mux, then run the layer 1 audit in the Rust core over the
  output bytes. Estimated added bundle: roughly 100 to 200 KB. Estimated time for a 100 MB 1080p
  phone clip on a mid-range laptop: well under a minute when the browser uses a hardware encoder.
- **Per-frame work:** for plain resize/rotate/flip/crop, stay on the GPU (WebGPU
  `importExternalTexture`, WebGL2 fallback) or let the encoder path scale. Use the existing Rust
  `fast_image_resize` only when byte-reproducible pixels matter. It fits a frame loop if it works on
  the native I420/NV12 planes and reuses buffers.
- **Determinism is the big trade-off.** WebCodecs output bytes are *not* reproducible across
  browsers, OS versions or GPUs (hardware encoders, silent hardware to software fallback, bundled
  encoder versions). The project should promise a **deterministic verdict** (the audit decides the
  same way everywhere), not deterministic bytes, for video v1. A later "reproducible mode" can use a
  single-threaded WASM software encoder (libvpx VP9 or rav1e AV1, both royalty-free and BSD
  licensed) at a large speed cost.
- **Anti-stego/anti-watermark:** full decode plus downscale plus re-encode reliably destroys
  *fragile* hiding (spatial LSB, compressed-domain DCT coefficient and motion-vector stego,
  encoder SEI/user-data). It **degrades but does not reliably remove** modern robust and AI
  watermarks (Meta Video Seal / Pixel Seal, Google SynthID), which are trained against exactly these
  edits. Product wording must stay "reduces", never "removes" or "guarantees".
- **Audio:** strip it by default. Audio carries its own watermarks (AudioSeal, SynthID audio),
  voices, and environmental fingerprints such as mains hum (ENF). Re-encode to Opus/AAC only as an
  explicit opt-in, and say plainly that re-encoding is not a scrub.

## 1. Decode and encode in the browser

### 1.1 WebCodecs support (2026)

| Browser | VideoDecoder/Encoder | AudioDecoder/Encoder | Notes |
|---|---|---|---|
| Chrome / Edge desktop and Android | yes (since 94) | yes | Broadest codec set. Software fallbacks bundled (OpenH264, libvpx, libaom/SVT-AV1 class encoders). |
| Firefox desktop (Win, macOS, Linux) | yes (130+) | yes | Encode throughput typically lower than Chrome on the same machine. |
| Firefox Android | no | no | Must show "video not supported in this browser". |
| Safari macOS / iOS / iPadOS | yes (16.4+) | yes (Safari 26+) | Encode is essentially H.264 and HEVC via VideoToolbox. VP9/AV1 encode not something to rely on. AV1 decode only on hardware with an AV1 block (M3/A17 Pro and later). |

Codec coverage from a 2026 dataset of over a million sessions (webcodecsfundamentals.org): encode
support for **H.264 baseline about 99.7 percent, VP9 profile 0 about 99.99 percent (of sessions
that expose WebCodecs), AV1 8-bit about 88 percent, HEVC about 74 percent**. Their conclusion for
encoding pipelines: always keep H.264 or VP9 as the safety net. Always call
`VideoEncoder.isConfigSupported()` and pick from a ranked list at runtime rather than hard-coding.

Measured 1080p30 H.264 encode throughput in the same source varies by an order of magnitude:
roughly 11 to 25 fps on low-tier devices, 80 to 100 fps mid-tier, and oddly only about 12 fps for
Safari on an iPhone 16 Pro in their test. Plan for the slow end on phones.

Sources:
[MDN WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API),
[MDN codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection),
[WebCodecs Fundamentals codec dataset 2026](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/),
[WebCodecs Fundamentals VideoEncoder](https://webcodecsfundamentals.org/basics/encoder/),
[TestMu WebCodecs support overview](https://www.testmuai.com/learning-hub/webcodecs-browser-support/).

### 1.2 Hardware vs software encoders, and why hardware is non-deterministic

`VideoEncoderConfig.hardwareAcceleration` accepts `"no-preference"`, `"prefer-hardware"`,
`"prefer-software"`. It is a *hint*: the user agent may ignore it, and implementations can fall
back from hardware to software without raising an error. `latencyMode: "quality"` allows B-frames,
lookahead and larger GOPs, `"realtime"` disables them.

Why hardware output differs between machines (and even between runs):

- Each GPU vendor (Intel Quick Sync, NVIDIA NVENC, AMD AMF/VCN, Apple VideoToolbox, Qualcomm,
  MediaTek) has its own motion search, mode decision and rate control. None of this is normative;
  only the *decoder* is specified by the codec standard.
- Firmware and driver updates change output. Rate control can be timing dependent (it reacts to
  queue fill), and the browser may switch to software under load or when a hardware session limit
  is hit.
- Even the software paths inside browsers (Chrome's bundled OpenH264/libvpx/libaom class
  encoders, Safari's VideoToolbox software path) are tied to the browser build and can use
  multiple threads.

Consequence: the same input processed in Chrome on Windows/NVIDIA and in Safari on a Mac will
produce different bytes. Both can still be valid, clean files. The audit can be deterministic even
if the bytes are not.

Sources:
[WebCodecs Fundamentals VideoEncoder](https://webcodecsfundamentals.org/basics/encoder/),
[romot-co/webcodecs-encoder notes on silent fallback](https://github.com/romot-co/webcodecs-encoder),
[w3c/webcodecs issue 604, encoder performance info](https://github.com/w3c/webcodecs/issues/604).

### 1.3 Which output codec

| Output | Playability | Browser encode | Licensing | Verdict |
|---|---|---|---|---|
| H.264 (AVC) High/Main in MP4 | Everywhere (iOS Photos, WhatsApp, Signal, Windows, TVs) | All engines | Patent pool (Via LA, formerly MPEG LA). When the **browser's** encoder is used, the browser/OS vendor carries the license. Shipping our own H.264 encoder binary is different, see below. | **Default output** |
| VP9 in WebM (or MP4) | All browsers, Android, most players. iOS Photos import is weaker. | Chrome, Firefox. Not reliable in Safari. | Royalty-free (Google patent grant). | Alternative, and the natural codec for a later WASM reproducible mode |
| AV1 in MP4/WebM | Good on new hardware, poor on older Apple devices | Chrome/Firefox mostly, ~88 percent of sessions | Royalty-free (AOMedia patent license; third-party pool claims exist but have not blocked browsers) | Optional, "smaller file" toggle |
| HEVC | Apple-centric | Safari, some Chrome | Multiple pools, messy | Do not offer |

Use H.264 **High or Main** profile if `isConfigSupported` agrees, and fall back to Baseline.
Baseline has no B-frames and CABAC, so it is bigger at the same quality, but it is the universally
available config.

**H.264 licensing angle for a self-shipped encoder.** Cisco's OpenH264 patent coverage applies only
to Cisco's own downloaded binaries, not to a self-compiled WASM build. Cisco maintainers have noted
that serving a WASM H.264 encoder is likely "distribution of an encoding product" for each visitor.
x264 is GPL-2.0 (or commercial) and carries the same patent question. Therefore: **H.264 only via
WebCodecs**, and any self-shipped encoder should be VP9 (libvpx, BSD) or AV1 (rav1e, BSD-2), which
also matches the project's Rust/WASM toolchain.

Sources:
[OpenH264 binary license](https://www.openh264.org/BINARY_LICENSE.txt),
[cisco/openh264 issue 3299: WebAssembly encoder under the binary license?](https://github.com/cisco/openh264/issues/3299),
[Mozilla blog on Cisco H.264](https://blog.mozilla.org/en/mozilla/video-interoperability-on-the-web-gets-a-boost-from-ciscos-h-264-codec/),
[Wikipedia: Advanced Video Coding](https://en.wikipedia.org/wiki/Advanced_Video_Coding),
[Wikipedia: VP9](https://en.wikipedia.org/wiki/VP9),
[Konvrt: AV1 vs HEVC vs VP9 in 2026](https://konvrt.dev/blog/av1-vs-hevc-vs-vp9-browser-video-2026).

### 1.4 Demux and mux libraries

| Library | Role | Status | Notes |
|---|---|---|---|
| **Mediabunny** | Demux + mux (MP4/MOV, WebM/MKV, MP3, WAV, Ogg, ADTS), WebCodecs wrappers, `Conversion` API | Active, MPL-2.0, zero deps | Tree-shakable; the author quotes about 5 KB minified for a minimal muxer, a full read, convert, write pipeline is larger (est. tens of KB). Reads from a `Blob` lazily, so a 100 MB `File` is never fully loaded. Recommended. |
| mp4-muxer | MP4 mux | **Deprecated**, superseded by Mediabunny | Do not adopt. |
| webm-muxer | WebM mux | **Deprecated**, superseded by Mediabunny | Do not adopt. |
| mp4box.js (GPAC) | MP4 demux/mux, box parsing | Maintained, BSD-3 | Good as a second, independent MP4 parser for cross-checking in tests. Heavier API. |
| webm-demuxer | WebM demux (WASM, libwebm based) | Small community project | Not needed if Mediabunny is used. |

Important for this project: whatever muxer is used, the **layer 1 audit must re-parse the output
itself** (in the Rust core) and not trust the muxer. Mediabunny, like any muxer, can write
`creation_time`, handler names, `udta`/`meta` or `free` boxes depending on options and version.

Sources:
[Mediabunny site](https://mediabunny.dev/),
[Mediabunny introduction](https://mediabunny.dev/guide/introduction),
[Mediabunny on GitHub](https://github.com/Vanilagy/mediabunny),
[mp4-muxer deprecation notice](https://vanilagy.github.io/mp4-muxer/),
[webm-muxer deprecation notice](https://vanilagy.github.io/webm-muxer/).

### 1.5 ffmpeg.wasm as fallback

| Aspect | Finding |
|---|---|
| Size | Core is about 31 to 32 MB of WASM (single and multi-thread builds). Roughly 150 to 300 times the current app. |
| Speed | Single thread is far slower than native ffmpeg; the multi-thread core is about 2x faster than single thread but the project FAQ itself calls it unstable. Expect single-digit fps for 1080p x264 encode (est.). |
| Threads | Multi-thread build needs `SharedArrayBuffer`, i.e. cross-origin isolation: `Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). This repo already sends COOP `same-origin` in `vercel.json` and `public/_headers`; only COEP is missing, and since the app has no third-party embeds, adding it is cheap. |
| Licensing | Builds that include libx264 are GPL; the combined core must then be offered under GPL terms, and the H.264 patent question from 1.3 applies. An LGPL build without x264 is possible but loses the H.264 encoder. |
| Fit | Poor as a default: huge download, slow, license friction. Only worth it as an explicit "compatibility mode" for exotic inputs WebCodecs cannot decode (e.g. some MOV/ProRes, AVI, WMV). |

Sources:
[ffmpeg.wasm performance docs](https://ffmpegwasm.netlify.app/docs/performance/),
[32blog: ffmpeg.wasm in the browser](https://32blog.com/en/ffmpeg/ffmpeg-wasm-browser-video),
[ffmpeg-micro: where browser-side breaks](https://www.ffmpeg-micro.com/blog/ffmpeg-wasm-vs-hosted-api),
[DEV: ffmpeg.wasm 0.12 hang and speedups](https://dev.to/hammad4june1999/ffmpegwasm-012-hung-on-the-first-frame-and-the-real-speedup-was-not-the-upgrade-p45).

## 2. Per-frame pixel processing

### 2.1 Options

| Path | How | Cost per 1080p frame (est.) | Deterministic bytes | Good for |
|---|---|---|---|---|
| **WebGPU** | `device.importExternalTexture({source: videoFrame})` (zero-copy in Chrome), render/compute pass to an `OffscreenCanvas`, then `new VideoFrame(canvas, {timestamp})` into the encoder | Well under 1 ms of GPU time for resize, blur, pixelate | No (float precision and filtering differ by GPU) | Resize, rotate, flip, crop, blur, pixelate, color, noise |
| **WebGL2** | `texImage2D(..., videoFrame)`, fragment shader, `OffscreenCanvas` | About 1 to 3 ms, one upload copy | No | Same, as fallback where WebGPU is missing |
| **Canvas 2D** in a Worker | `ctx.drawImage(videoFrame, ...)`, `ctx.filter = "blur(2px)"` | Few ms, quality of scaling is browser defined | No | Quick prototype only |
| **Rust/WASM SIMD** (existing core) | `frame.copyTo(buffer)` to get I420/NV12 planes, process in WASM, `new VideoFrame(buffer, {format, codedWidth, ...})` | Readback 2 to 6 ms (copy from GPU memory when hardware decoded) plus compute | **Yes**, same as images today | Reproducible resize, pixel filters, anything that must match the image path |
| Encoder-side scaling | Configure encoder at a smaller `width`/`height` than the frame | Free, done by the browser | No, and not specified | Not recommended: scaling quality and filter are unspecified |

Browser support for WebGPU in 2026: Chrome/Edge (desktop and recent Android), Safari 26, Firefox
141+ on Windows with other platforms following. Code must feature detect and fall back to WebGL2.

Sources:
[webrtcHacks: video frame processing on the web](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/),
[WebGPU Fundamentals: using video efficiently](https://webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html),
[Chrome: WebGPU WebCodecs integration intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/QLCfazM8XLQ),
[WebCodecs Fundamentals rendering](https://webcodecsfundamentals.org/basics/rendering/),
[ginokent: CPU to GPU transfer cost and zero-copy](https://ginokent.github.io/en/posts/2026-03-04-wgpu-video-playback-pipeline/).

### 2.2 Does `fast_image_resize` fit a frame loop?

Yes, with three rules:

1. **Work on the native planes, not RGBA.** Decoded frames arrive as I420 or NV12 (check
   `frame.format`). A 1080p I420 frame is about 3.1 MB, an RGBA copy is 8.3 MB. Resize the Y plane
   as a single-channel `U8` image and the chroma planes (half size each way) the same way. This
   avoids a YUV to RGB to YUV round trip, which is also a source of cross-browser differences.
   NV12 chroma is interleaved, so treat it as `U8x2`.
2. **Reuse buffers.** Allocate input and output plane buffers in WASM linear memory once per job,
   `copyTo` straight into them, and build the output `VideoFrame` from a view on the output buffer.
   No per-frame allocation, no GC churn.
3. **Keep it single-threaded in one Worker first.** The current image bench shows the SIMD
   Lanczos resize runs in milliseconds for a 4096 px image. A 1920x1080 to 1280x720 plane resize
   should land around 3 to 10 ms per frame (est.), i.e. 100+ fps of resize throughput, which is
   faster than the encoder. Multi-threading needs COEP and is not needed for v1.

Rotate 90/180/270, flip and crop on planes are simple index remaps, cheap in Rust. Pixelate
(block average), box/Gaussian blur on Y only (plus chroma), and mild noise injection with a fixed
seed are all straightforward and deterministic in integer math.

The GPU path is faster and uses less CPU, but its output differs by GPU. Choose per product
promise (see section 5).

### 2.3 Memory budget and frame lifetime

- A 100 MB 1080p clip is usually 45 to 100 seconds (phone at 8 to 17 Mbps), so 1,400 to 6,000
  frames. **Never hold decoded frames.** One decoded 1080p frame is 3 MB (I420) to 8 MB (RGBA).
- Hardware decoders have small frame pools. If `VideoFrame.close()` is not called promptly, the
  decoder stalls. Call `close()` on every input frame right after it has been drawn or copied.
- Backpressure: keep `decoder.decodeQueueSize` and `encoder.encodeQueueSize` bounded (around 5 to
  20) and await the `dequeue` event before feeding more.
- Peak working set target: input `File` (not read into memory, Mediabunny reads slices), a few
  compressed chunks, under 10 decoded frames, WASM plane buffers (under 20 MB), and the output. The
  output of a downscaled clip is typically smaller than the input, so an in-memory
  `ArrayBuffer` target (under about 100 MB) is acceptable. For headroom on phones, stream the output
  into OPFS (Origin Private File System, still local and offline) and hand the audit a `File` from
  there.

## 3. Effectiveness against steganography and watermarks

### 3.1 What each transform does

| Hidden signal | Survives a full decode, resize, re-encode? | Evidence and reasoning |
|---|---|---|
| Spatial LSB stego in pixels | **No.** Any lossy encode rewrites low bits. It only exists in lossless video (FFV1, PNG sequences) to begin with. | Well established; lossy quantization dominates LSB noise. |
| Compressed-domain stego (DCT coefficients, motion vectors, intra modes, skip flags in H.264/HEVC) | **No.** A new encoder chooses new coefficients, MVs and modes from scratch. | Survey literature: compression-domain methods embed in the code stream syntax, which a transcode regenerates. |
| Encoder and container side channels (SEI user data, AV1 metadata OBUs, `udta`, timestamps) | **Removed** if the new encoder does not write them, and the audit confirms. | Layer 1 concern, but the re-encode is what makes it clean at the bitstream level. |
| "Robust" classical video stego (ECC plus mid-band DCT, designed to survive recompression) | **Usually no** once the frame is resampled to a different size and re-encoded; the block grid and coefficient positions no longer line up. Not guaranteed. | These schemes target same-resolution recompression. |
| Classical robust video watermarks (forensic/broadcast) | **Often yes** at mild settings. Built to survive transcoding, scaling and cropping. | Industry design goal. |
| Meta Video Seal / Pixel Seal | **Degraded, sometimes to chance, not reliably.** Robust to blur, brightness, crop, JPEG alone. The Pixel Seal paper reports that H.264/HEVC compression is the hardest attack for all methods, and combined H.264 plus crop plus brightness change drives bit accuracy to about 0.5 (chance) in the harshest setting, while milder settings keep 0.75+. | Pixel Seal paper (arXiv 2512.16874), Video Seal paper. |
| Google SynthID (video frames) | **Assume it survives mild edits.** Trained with JPEG, filtering, rotation, noise and resize. Google has not published per-transform video numbers. Detection can aggregate over many frames, so partial per-frame damage may not flip the verdict. | Google DeepMind SynthID announcements; SynthID-Image paper (10B+ images and frames watermarked). |
| Diffusion/tree-ring style semantic watermarks | **Mostly survive** pixel-level edits by design. | UnMarker paper treats these as the hard case. |
| Camera sensor fingerprint (PRNU) | **Weakened** by downscaling, denoise and re-encode, not reliably removed. | Relevant privacy vector: links a clip to a specific phone. |
| Visible content (faces, plates, screens, reflections, landmarks) | Untouched unless the user blurs or covers regions. | Pixelation of faces can sometimes be partially reversed; for real anonymization use a solid fill or very strong blur. |

What *does* reliably defeat robust AI watermarks in the literature is either strong, quality-costly
distortion combined across several axes, or adversarial/regeneration attacks (UnMarker's spectral
optimization, diffusion "regeneration", denoising models). Those are heavy (GPU minutes per image,
more for video), need large model downloads, and position the tool as a provenance-laundering tool.
They are **out of scope** for this project. VideoMarkBench (2025) shows current video watermarks are
vulnerable to a range of perturbations, but the strongest removals there also use white-box or
black-box attacks, not plain edits.

Sources:
[Pixel Seal (arXiv 2512.16874)](https://arxiv.org/html/2512.16874),
[Video Seal, Meta AI research](https://ai.meta.com/research/publications/video-seal-open-and-efficient-video-watermarking/),
[TechCrunch on Video Seal](https://techcrunch.com/2024/12/12/meta-releases-a-tool-for-watermarking-ai-generated-videos/),
[VideoMarkBench (arXiv 2505.21620)](https://arxiv.org/abs/2505.21620),
[Google DeepMind: SynthID for text and video](https://deepmind.google/blog/watermarking-ai-generated-text-and-video-with-synthid/),
[Google: SynthID Detector](https://blog.google/innovation-and-ai/products/google-synthid-ai-content-detector/),
[SynthID-Image (arXiv 2510.09263)](https://arxiv.org/pdf/2510.09263),
[UnMarker (arXiv 2405.08363)](https://arxiv.org/abs/2405.08363),
[The coding limits of robust watermarking (arXiv 2509.10577)](https://arxiv.org/pdf/2509.10577),
[Springer: video steganography recent advances](https://link.springer.com/article/10.1007/s11042-023-14844-w),
[ACM Computing Surveys: critical survey on video steganography](https://dl.acm.org/doi/10.1145/3801971),
[Adaptive MV steganography for H.264 (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2772918425000268).

### 3.2 Transform menu, ranked by value for watchable output

| Transform | Disrupts | Visual cost | Recommended default |
|---|---|---|---|
| Full decode and re-encode (always on) | All compressed-domain stego, encoder side channels | Generation loss, small at sane bitrates | Always |
| Downscale (e.g. 1080p to 720p) with a proper filter | Spatial stego, block-aligned schemes, weakens robust marks and PRNU | Mild | On, 720p default for "Privacy" preset |
| Different codec/GOP/bitrate than source | Schemes tuned to a codec's quantizer, temporal sync | None to mild | On (fixed GOP, e.g. 2 s) |
| Small crop (1 to 3 percent per edge) plus rescale | Geometric sync of grid-aligned marks | Very mild | Optional "Stronger" preset |
| Mild Gaussian blur (sigma 0.5 to 0.8 px) or light denoise | High-frequency hidden energy, PRNU | Mild softening | Optional |
| Low-amplitude noise (seeded) | Fragile marks, PRNU matching | Mild grain | Optional |
| Re-quantize (lower bitrate or higher QP) | Everything above, harder | Visible at low bitrates | Via a quality slider |
| Frame rate reduction (e.g. 60 to 30, 30 to 24/25) | Frame-indexed temporal schemes | Motion less smooth | Optional |
| Temporal jitter (drop/duplicate occasional frames) | Temporal sync | Can look stuttery | Not recommended as a default |
| Region blur / pixelate / solid box | Visible identifiers only | By design | User-driven tool |
| Adversarial/regeneration attacks | Robust AI watermarks | Varies | **Out of scope** |

### 3.3 Wording for a fail-closed product

Keep the tone of the existing README ("reduces what can survive, but it is not a steganography
guarantee"). Suggested phrases:

- "Re-encoding from raw frames removes data hidden in the file's encoding and in pixel low bits."
- "Resizing and filtering **reduce** what hidden patterns and invisible watermarks can survive."
- "We **cannot** guarantee removal of robust watermarks, including AI provenance watermarks such as
  SynthID or Video Seal, or of camera sensor fingerprints. Those are built to survive exactly these
  edits."
- "This tool does not detect or remove AI watermarks and is not a way to hide that a video is
  AI-generated." (Useful given EU AI Act Article 50 transparency duties on AI providers and the
  general reputational risk. This is positioning, not legal advice.)
- Never show a green "watermark removed" state. The output verdict stays about **metadata and
  container cleanliness**, which is what the audit can actually prove.

## 4. Audio

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **Strip audio** | Removes voices, background speech, audio watermarks (AudioSeal, SynthID audio, WavMark), ENF mains-hum timestamps/geolocation, room acoustics, and all audio stream metadata in one step. Zero cost. | Silent video | **Default** |
| Re-encode to Opus (WebM/MP4) or AAC (MP4) via `AudioEncoder` | Keeps sound. Removes codec-level side data and stream metadata. Resampling to 48 kHz plus low-pass (for example 12 to 16 kHz) disrupts some fragile marks. | Does **not** reliably remove neural audio watermarks. AudioSeal reports full detection after Opus and 24 kbps MP3; AudioMarkBench finds some schemes fail under Opus/EnCodec while AudioSeal holds. Content itself (voices, ENF) remains. | Opt-in, labeled "keep sound (not scrubbed)" |
| Copy audio stream untouched | Fast | Carries everything in the audio track | Never |

Notes:

- `AudioEncoder` Opus is broadly available (Chrome, Firefox, Safari 26+). AAC encode is available in
  Chrome on most platforms and in Safari; check with `AudioEncoder.isConfigSupported()`. For an H.264
  MP4, AAC gives best compatibility; Opus in MP4 plays in browsers and modern players but not in
  every legacy tool.
- Audio metadata lives in the container (`udta`, `meta`, iTunes-style atoms, `©xyz` location atom
  in MP4, Matroska tags). That is layer 1, but the audit must cover it when audio is kept.

Sources:
[AudioSeal on GitHub](https://github.com/facebookresearch/audioseal),
[AudioMarkBench (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/file/5d9b7775296a641a1913ab6b4425d5e8-Paper-Datasets_and_Benchmarks_Track.pdf),
[AWARE audio watermarking (arXiv 2510.17512)](https://arxiv.org/html/2510.17512),
[Real-world assessment of audio watermarking (arXiv 2505.19663)](https://arxiv.org/pdf/2505.19663).

## 5. Determinism

| Stage | Byte-deterministic across browsers? | How to get there |
|---|---|---|
| Demux (Mediabunny, pure TS) | Yes | Pure code, same input, same output. |
| Decode via WebCodecs | **Mostly, not guaranteed.** H.264/VP9/AV1 decoding is bit-exact by spec for conformant streams, but browsers may deliver NV12 vs I420, may apply post-processing, and differ on edge cases (odd sizes, rotation metadata, color range). | For strict mode, decode in WASM (dav1d for AV1, libvpx for VP9, an H.264 WASM decoder; decoders carry fewer patent concerns than encoders but should still be checked). |
| Per-frame transforms in Rust/WASM | Yes (integer math, fixed seed) | Existing core approach. |
| Per-frame transforms in WebGPU/WebGL | No | Float filtering and precision differ by GPU. |
| Encode via WebCodecs (hardware or software) | **No** | Vendor encoders, drivers, fallback, threads. |
| Encode via WASM software encoder, single thread, pinned version (libvpx VP9, rav1e AV1) | Yes | Fixed settings, fixed-QP or deterministic rate control, no threads. Slow. |
| Mux (Mediabunny) | Yes, if timestamps and metadata are fixed | Force `creation_time` to 0, fixed track IDs, no free-text fields. |
| Layer 1 audit (Rust core) | Yes | Same as images. |

**What to promise:**

- Video v1: "Processed entirely on your device. The **clean check** is identical in every browser.
  The exact output bytes can differ between browsers and devices because your browser's video
  encoder is used." This is honest and keeps the fail-closed guarantee where it matters.
- Later, "Reproducible mode": WASM decode, WASM transforms, WASM VP9 or AV1 encode, same bytes
  everywhere, clearly labeled as slower. Cross-engine determinism tests like
  `tests/determinism.spec.ts` can then be extended to video.
- Until then, video determinism tests should assert *audit verdict equality* and structural
  properties (dimensions, frame count, no audio track, allowed boxes only), not hash equality.

## 6. Time and memory budgets

Reference clip: 100 MB, 1080p30 H.264, about 90 s at about 9 Mbps, about 2,700 frames. Output
720p30. All numbers are est. for a mid-range 2024 laptop unless noted; phones are 2 to 5 times
slower.

| Pipeline | Throughput (est.) | Time for the clip (est.) | Extra download |
|---|---|---|---|
| WebCodecs HW decode, WebGPU transform, WebCodecs HW encode | 150 to 400 fps | 7 to 20 s | ~0 (JS only) |
| WebCodecs decode, WASM plane transform (copyTo), WebCodecs encode | 60 to 150 fps | 20 to 45 s | ~0 beyond current core |
| Same, encoder forced `prefer-software` | 40 to 120 fps at 720p | 25 to 70 s | ~0 |
| Phone (mid-tier), WebCodecs path | 15 to 60 fps | 45 s to 3 min | ~0 |
| libvpx VP9 WASM, single thread, realtime speed setting, 720p | 10 to 30 fps | 1.5 to 4.5 min | est. 1 to 2 MB |
| rav1e AV1 WASM, single thread, fastest speed, 720p | 2 to 8 fps | 6 to 25 min | est. 2 to 3 MB |
| ffmpeg.wasm libx264 ultrafast, 720p, single thread | 5 to 15 fps | 3 to 9 min | ~31 MB |

Downscaling before encode is the single biggest speed lever: 720p has 44 percent of the pixels of
1080p, so encode time drops by roughly 2x.

Keeping the UI responsive:

- Run the whole pipeline in the existing sanitizer Worker (or a dedicated video Worker).
  `VideoFrame`, `EncodedVideoChunk` and `OffscreenCanvas` are all available in Workers.
- Chunked input: Mediabunny's `BlobSource` reads the `File` by `slice()` on demand, so the 100 MB
  input is never copied into one buffer. Do the same when feeding the Rust audit if it needs
  streaming (walk MP4 boxes by offset instead of loading everything).
- Progress: `lastEncodedTimestamp / duration`, posted to the main thread at most every 100 to 250
  ms. Show an ETA after the first 2 seconds of work.
- Cancellation: an `AbortController` per job; on abort call `decoder.close()`, `encoder.close()`,
  close any held `VideoFrame`s, drop the output target (Mediabunny's `Conversion` has a `cancel()`).
- Screen Wake Lock (`navigator.wakeLock.request("screen")`) during processing so phones do not
  sleep and kill the tab. It is a local API, no network.
- Hard limits for v1: 100 MB input, 4K input allowed but output capped at 1080p, duration cap (for
  example 10 minutes), fail closed with a clear message when a codec is unsupported.

## 7. Recommended pipeline for this repo

```
File (<= 100 MB)
  -> Mediabunny Input(BlobSource)            demux, read tracks, ignore all metadata
  -> WebCodecs VideoDecoder                  hardware where available
  -> per-frame transforms                    GPU (fast) or Rust/WASM planes (reproducible)
       crop -> rotate/flip -> resize -> [blur/pixelate regions] -> [noise]
  -> WebCodecs VideoEncoder                  H.264 High/Main/Baseline, else VP9
  -> (audio: dropped by default | AudioDecoder -> AudioEncoder Opus/AAC opt-in)
  -> Mediabunny Output(Mp4OutputFormat)      fastStart, zeroed creation_time, no tags
  -> Rust core layer 1 audit                 box allowlist, NAL/OBU scan, fail closed
  -> download
```

### 7.1 Where to run the transforms

- **v1:** Rust/WASM on I420/NV12 planes, using `fast_image_resize` (already a dependency, `U8`
  and `U8x2` pixel types) plus hand-written rotate/flip/crop. Reasons: reuses the audited core,
  identical pixels to the image path, no GPU driver surprises, easy to unit test with `cargo test`.
  Throughput is higher than typical encode speed, so it is not the bottleneck.
- **v2:** optional WebGPU fast path for region blur/pixelate previews and for phones where the
  `copyTo` readback costs too much. Keep the WASM path as the reference implementation.

### 7.2 What the layer 1 audit must add for video output

- MP4 box allowlist: `ftyp`, `moov` (`mvhd`, `trak`, `tkhd`, `edts`/`elst` if used, `mdia`,
  `mdhd`, `hdlr` with an empty or fixed name, `minf`, `vmhd`/`smhd`, `dinf`/`dref`, `stbl` and its
  children, codec config `avcC`/`vpcC`/`av1C`, `colr`, `pasp`), `mvex`/`moof` only if fragmented
  output is chosen, `mdat`. Reject `udta`, `meta`, `uuid`, `free`/`skip` with content, XMP, any
  unknown box.
- `mvhd`/`tkhd`/`mdhd` creation and modification times must be 0; language fields fixed.
- Bitstream scan: H.264 SEI NAL units (type 6) with `user_data_unregistered` must be absent (x264,
  for example, writes its version and settings string there; hardware encoders may write vendor
  SEI). For AV1, reject metadata OBUs (ITU-T T.35, which is also where some provenance payloads
  go). For VP9 there is no in-band user data, which is one reason VP9 is a clean target.
- Track set: exactly one video track, and zero audio tracks unless the user opted in.

### 7.3 Minimal first version (v0.7 candidate)

Features: downscale (100 / 75 / 50 percent, or 720p/480p presets), rotate 90/180/270, flip, crop
by preset margin, audio stripped, H.264 MP4 output via WebCodecs with VP9 WebM fallback, fixed
2 second GOP, bitrate by resolution (about 0.1 bits per pixel per frame, e.g. about 2.5 to 3.5 Mbps
at 720p30), then audit.

Estimated bundle impact:

| Piece | Size (est., min+gzip) |
|---|---|
| Mediabunny (MP4 + WebM demux/mux, WebCodecs helpers, tree-shaken) | 25 to 60 KB |
| Video pipeline glue in the Worker, UI | 10 to 20 KB |
| Rust core: plane transforms plus MP4/WebM box audit plus NAL/OBU scan | +40 to 100 KB WASM |
| **Total** | **roughly 100 to 200 KB** |

Later options: VP9 WASM encoder for reproducible mode (+1 to 2 MB, loaded on demand),
ffmpeg.wasm compatibility mode (+31 MB, on demand, GPL build concerns), WebGPU path (+5 to 15 KB).

### 7.4 Step list

1. Spike: in a Worker, open an MP4 with Mediabunny, list tracks, decode 100 frames with WebCodecs,
   log `frame.format`, sizes and decode fps in Chrome, Firefox and Safari (Playwright can drive all
   three, as the repo already does).
2. Add codec capability probing: ranked `isConfigSupported` list (H.264 High, Main, Baseline, then
   VP9, then AV1) and a clear "not supported in this browser" fail-closed path (Firefox Android).
3. Rust core: `transform_planes(y, u, v, w, h, format, ops) -> planes` using `fast_image_resize`
   for `U8`/`U8x2` planes, plus rotate/flip/crop. Unit tests with fixed hashes, as for images.
4. Wire decode, WASM transforms, encode with backpressure on both queue sizes and prompt
   `VideoFrame.close()`. Audio track ignored.
5. Mux with Mediabunny into MP4 (fastStart, `creation_time` 0, no metadata) or WebM for VP9.
6. Rust core: video audit (box allowlist, timestamp fields, SEI/OBU scan, track count). Run it on the
   output; block download on any finding. Also run it on the input for the "before" report.
7. Progress, ETA, cancel, wake lock, memory cap, size/duration limits.
8. Tests: `no-network.spec.ts` extended to a video run; fixtures with GPS `©xyz`, `udta`, SEI user
   data, audio track; assert audit verdicts are equal across engines; assert no audio track and
   expected dimensions.
9. Bench: add a video case to `scripts/bench.mjs` (100 MB 1080p fixture, per-stage timings), and
   only then publish speed numbers in `docs/bench.md`.
10. Copy: README section "Video" with the wording from 3.3 and the determinism statement from 5.
11. Later: opt-in audio re-encode (Opus/AAC), region blur/pixelate tool, WebGPU fast path,
    reproducible VP9 WASM mode.

## 8. Open questions to verify during the spike

- Exact current Mediabunny API names for per-frame processing inside `Conversion` (it supports
  resize/rotate/crop options and a processing hook in recent versions) versus using the lower-level
  sink/source classes. Check the version pinned at implementation time.
- Whether `VideoFrame.copyTo` with a requested `format` (RGBA conversion) is available in all three
  engines; the plan above avoids needing it by working on native planes.
- Safari behaviour for `prefer-software` and for encoding at non-multiple-of-16 sizes; round output
  dimensions to even numbers, ideally multiples of 16.
- Whether any browser's H.264 encoder emits SEI user data by default (to calibrate the audit rather
  than to trust it).
- Real throughput on a low-end Android phone and an older iPhone, which decides the default output
  resolution.

## Sources (consolidated)

- MDN, WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN, codec selection: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
- WebCodecs Fundamentals, codec dataset 2026: https://webcodecsfundamentals.org/datasets/codec-analysis-2026/
- WebCodecs Fundamentals, VideoEncoder: https://webcodecsfundamentals.org/basics/encoder/
- WebCodecs Fundamentals, rendering: https://webcodecsfundamentals.org/basics/rendering/
- TestMu, WebCodecs browser support: https://www.testmuai.com/learning-hub/webcodecs-browser-support/
- w3c/webcodecs issue 604: https://github.com/w3c/webcodecs/issues/604
- webcodecs-encoder (fallback notes): https://github.com/romot-co/webcodecs-encoder
- Konvrt, AV1 vs HEVC vs VP9 2026: https://konvrt.dev/blog/av1-vs-hevc-vs-vp9-browser-video-2026
- Mediabunny: https://mediabunny.dev/ and https://github.com/Vanilagy/mediabunny
- mp4-muxer deprecation: https://vanilagy.github.io/mp4-muxer/
- webm-muxer deprecation: https://vanilagy.github.io/webm-muxer/
- ffmpeg.wasm performance: https://ffmpegwasm.netlify.app/docs/performance/
- 32blog, ffmpeg.wasm: https://32blog.com/en/ffmpeg/ffmpeg-wasm-browser-video
- ffmpeg-micro, browser-side limits: https://www.ffmpeg-micro.com/blog/ffmpeg-wasm-vs-hosted-api
- OpenH264 binary license: https://www.openh264.org/BINARY_LICENSE.txt
- OpenH264 WASM license discussion: https://github.com/cisco/openh264/issues/3299
- Mozilla on Cisco H.264: https://blog.mozilla.org/en/mozilla/video-interoperability-on-the-web-gets-a-boost-from-ciscos-h-264-codec/
- rav1e: https://github.com/xiph/rav1e
- rav1e WASM proposal: https://github.com/mozilla/GSOC2020/blob/master/proposals/rav1e-wasm.md
- AVIF and WebAssembly (rav1e/aom in WASM limits): https://sascha.work/posts/avif-and-webassembly/
- webrtcHacks, frame processing: https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/
- WebGPU Fundamentals, external video textures: https://webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html
- Chromium intent to ship, WebGPU WebCodecs integration: https://groups.google.com/a/chromium.org/g/blink-dev/c/QLCfazM8XLQ
- Pixel Seal: https://arxiv.org/html/2512.16874
- Video Seal: https://ai.meta.com/research/publications/video-seal-open-and-efficient-video-watermarking/
- VideoMarkBench: https://arxiv.org/abs/2505.21620
- SynthID for video: https://deepmind.google/blog/watermarking-ai-generated-text-and-video-with-synthid/
- SynthID Detector: https://blog.google/innovation-and-ai/products/google-synthid-ai-content-detector/
- SynthID-Image: https://arxiv.org/pdf/2510.09263
- UnMarker: https://arxiv.org/abs/2405.08363
- Coding limits of robust watermarking: https://arxiv.org/pdf/2509.10577
- Video steganography survey (Springer): https://link.springer.com/article/10.1007/s11042-023-14844-w
- Critical survey on video steganography (ACM CSUR): https://dl.acm.org/doi/10.1145/3801971
- AudioSeal: https://github.com/facebookresearch/audioseal
- AudioMarkBench: https://proceedings.neurips.cc/paper_files/paper/2024/file/5d9b7775296a641a1913ab6b4425d5e8-Paper-Datasets_and_Benchmarks_Track.pdf
- AWARE: https://arxiv.org/html/2510.17512
