# Sanitize pipeline benchmark

Per-stage worker timing (wasm decode+transform → jsquash encode → wasm strip+audit), measured via `window.__sanitizeBench` over the real pipeline. Chromium headless, dpr 1, square synthetic images. Times in **ms**, lower is better.

- **v0.4.0**, 2026-06-17T22:05:34.131Z · 15 runs/cell (warmup 3)
- **v0.5.0**, 2026-06-17T22:10:35.203Z · 15 runs/cell (warmup 3)
- **v0.7.0**, 2026-09-24T16:03:41.802Z · 5 runs/cell (warmup 1)
- **v0.8.0**, 2026-09-24T20:55:17.526Z · 5 runs/cell (warmup 1)

## Total p50 by build (ms), speedup = (v0.4.0 − v0.8.0) / v0.4.0

| image | v0.4.0 | v0.5.0 | v0.7.0 | v0.8.0 | speedup |
|---|--:|--:|--:|--:|--:|
| png 512² r100 | 23.2 | 25.3 | 20.3 | 22.6 | 3% |
| png 512² r50 | 35.5 | 16.4 | 14.2 | 15.4 | 57% |
| jpeg 512² r100 | 70.4 | 65.2 | 61.1 | 71.0 | -1% |
| jpeg 512² r50 | 44.4 | 27.4 | 24.1 | 28.4 | 36% |
| webp 512² r100 | 44.0 | 44.6 | 37.5 | 41.9 | 5% |
| webp 512² r50 | 30.5 | 19.4 | 17.2 | 17.7 | 42% |
| png 2048² r100 | 374.7 | 352.4 | 300.4 | 307.9 | 18% |
| png 2048² r50 | 488.7 | 238.7 | 189.8 | 228.2 | 53% |
| jpeg 2048² r100 | 827.2 | 807.7 | 677.8 | 788.0 | 5% |
| jpeg 2048² r50 | 510.1 | 318.2 | 259.6 | 317.8 | 38% |
| webp 2048² r100 | 479.2 | 515.9 | 432.1 | 473.1 | 1% |
| webp 2048² r50 | 428.0 | 239.1 | 205.6 | 236.0 | 45% |
| png 4096² r100 | 1400.0 | 1475.3 | 1146.1 | 1246.0 | 11% |
| png 4096² r50 | 1843.9 | 891.6 | 719.0 | 726.3 | 61% |
| jpeg 4096² r100 | 3332.7 | 3234.0 | 2685.0 | 2547.8 | 24% |
| jpeg 4096² r50 | 2149.9 | 1470.2 | 1035.5 | 1018.2 | 53% |
| webp 4096² r100 | 2289.5 | 2449.9 | 1974.5 | 1925.4 | 16% |
| webp 4096² r50 | 2017.2 | 1503.8 | 1058.9 | 1046.6 | 48% |

## v0.8.0, full stage breakdown

| image | in KB | out KB | decode+resize p50 | decode p95 | encode p50 | strip p50 | total p50 | total p95 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| png 512² r100 | 355.5 | 288.2 | 10.2 | 11.6 | 5.8 | 5.5 | 22.6 | 23.1 |
| png 512² r50 | 355.5 | 87.1 | 11.8 | 12.8 | 1.8 | 1.8 | 15.4 | 16.5 |
| jpeg 512² r100 | 28.5 | 35.7 | 5.9 | 7.9 | 63 | 0.1 | 71 | 72.8 |
| jpeg 512² r50 | 28.5 | 13.5 | 7.3 | 7.7 | 20.9 | 0.1 | 28.4 | 28.6 |
| webp 512² r100 | 18.4 | 17.5 | 9.7 | 10.3 | 32.2 | 0.1 | 41.9 | 44.2 |
| webp 512² r50 | 18.4 | 6.7 | 9.6 | 10.4 | 7.9 | 0 | 17.7 | 18.2 |
| png 2048² r100 | 4304.3 | 4222.3 | 145.5 | 146.9 | 89.9 | 74.5 | 307.9 | 311.5 |
| png 2048² r50 | 4304.3 | 746.4 | 188.3 | 202.7 | 22.5 | 16.4 | 228.2 | 244.3 |
| jpeg 2048² r100 | 113.9 | 156.5 | 79.8 | 96.3 | 704.8 | 0.4 | 788 | 849.4 |
| jpeg 2048² r50 | 113.9 | 65 | 111.7 | 112.7 | 210 | 0.2 | 317.8 | 347.3 |
| webp 2048² r100 | 66.5 | 63.2 | 106.2 | 109.6 | 366.8 | 0.1 | 473.1 | 476.1 |
| webp 2048² r50 | 66.5 | 30.1 | 130.4 | 132.9 | 105.1 | 0.1 | 236 | 241.2 |
| png 4096² r100 | 14638.1 | 16733.1 | 550.9 | 569 | 372.4 | 313.4 | 1246 | 1259 |
| png 4096² r50 | 14638.1 | 2373.2 | 605.8 | 623.4 | 77.6 | 42.6 | 726.3 | 743.3 |
| jpeg 4096² r100 | 208.2 | 279.7 | 242.5 | 249 | 2304.7 | 0.5 | 2547.8 | 2569.6 |
| jpeg 4096² r50 | 208.2 | 114.3 | 346.1 | 368.8 | 661.5 | 0.3 | 1018.2 | 1045.8 |
| webp 4096² r100 | 112.5 | 111.6 | 600.3 | 603.5 | 1321.8 | 0.1 | 1925.4 | 1940.3 |
| webp 4096² r50 | 112.5 | 49.8 | 702.1 | 707.3 | 343.9 | 0.1 | 1046.6 | 1059.3 |
## Video, 1080p30 20 s H.264 clip, per browser and engine

Total time from file to audited output through `window.__sanitizeVideoBench`. "reencode" is the full clean (WebCodecs decode and encode, then the Rust rebuild and audit), "remux" is the basic clean (Rust rebuild and audit only). Headless, software encoders.

| build | browser | engine | resize | in MB | out MB | frames | total p50 ms | fps |
|---|---|---|--:|--:|--:|--:|--:|--:|
| v0.7.0 | chromium | remux | 100% | 18.1 | 18.1 | 600 | 307.1 | 1953.8 |
| v0.7.0 | chromium | reencode | 100% | 18.1 | 14.8 | 600 | 4801.5 | 125 |
| v0.7.0 | chromium | reencode | 50% | 18.1 | 3.7 | 600 | 15222.4 | 39.4 |
| v0.7.0 | firefox | remux | 100% | 18.1 | 18.1 | 600 | 556 | 1079.1 |
| v0.7.0 | firefox | reencode | 100% | 18.1 | 14.9 | 600 | 15643 | 38.4 |
| v0.7.0 | firefox | reencode | 50% | 18.1 | 3.7 | 600 | 240510 | 2.5 |

## Local models, square synthetic image with a 15 percent corner mask, Chromium

"cold model" is the download and hash check on the first run (0 when the file was already cached); "warm" is the same on later runs. "step" is the inference including session creation on the first run, per `window.__sanitizeBench`. The mask is a 15 percent corner square, so LaMa runs a coarse pass plus 512 tiles and TAESD runs 512 tiles over the whole image. Firefox numbers are not listed: the Playwright Firefox build runs onnxruntime wasm 7 to 20 times slower than a release Firefox, see docs/spikes-v0.8.0.md.

| build | job | image | cold model ms | warm model ms | step p50 ms |
|---|---|--:|--:|--:|--:|
| v0.8.0 | migan | 1024² | 59.6 | 0 | 976.3 |
| v0.8.0 | lama | 1024² | 486 | 0 | 37925.3 |
| v0.8.0 | reduce | 1024² | 0 | 0 | 29267.4 |
| v0.8.0 | migan | 2048² | 0 | 0 | 990.6 |
| v0.8.0 | lama | 2048² | 0 | 0 | 44991 |
| v0.8.0 | reduce | 2048² | 0 | 0 | 104059.9 |


_Generated by `scripts/bench.mjs`._
