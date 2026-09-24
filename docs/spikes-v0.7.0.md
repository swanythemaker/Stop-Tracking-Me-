# v0.7.0 spikes: Mediabunny, plane access, encoder calibration, time budget

Spikes S1, S2, S3 and S6 from the v0.7.0 plan. S4 (playability) and S5 (memory with 100 MB inputs) are not covered here.

This file is the contract for the integration code in `src/sanitizer/video/`. Every API name below was called in a running browser, not only read from the type declarations.

## Setup (measured)

| Item | Value |
|---|---|
| Machine | AMD Ryzen 9 5900HX (8 cores, 16 threads), 30 GB RAM, Linux 6.14.0 x86_64 |
| Playwright | 1.60.0, headless |
| Chromium | 148.0.7778.96 (Playwright headless shell, `HeadlessChrome/148`) |
| Firefox | 150.0.2 (Playwright build) |
| Mediabunny | **1.59.1** (pinned exact in `package.json`) |
| Realm | Every spike ran inside a module Web Worker (`new Worker(url, { type: "module" })`) unless noted |
| Clips | ffmpeg 6.1.1: `small.mp4` 320x240 30 fps 2 s x264 High + AAC mono 48 kHz, `small.webm` 320x240 2 s VP9 + Opus, `big.mp4` 1920x1080 30 fps 10 s x264 veryfast 8 Mbps, no audio |

Numbers are single runs on this one machine. Treat them as orders of magnitude, not as bench results.

## S1: Mediabunny API as verified

### Imports

All of these are named exports of `mediabunny` 1.59.1 and resolve to the expected kinds in both engines inside a worker:

| Export | Kind | Notes |
|---|---|---|
| `Input` | class | `new Input({ formats, source })` |
| `BlobSource` | class | `new BlobSource(blob, { maxCacheSize? })`, reads the File lazily |
| `ALL_FORMATS` | `InputFormat[]` | Hls, Mp4, QuickTime, Matroska, WebM, Wave, Ogg, Flac, Mp3, Adts, MpegTs |
| `MP4`, `QTFF`, `WEBM`, `MATROSKA` | `InputFormat` instances | `.name` is `"MP4"`, `"QuickTime File Format"`, `"WebM"`, `"Matroska"` |
| `VideoSampleSink`, `AudioSampleSink` | class | decode through WebCodecs |
| `VideoSample` | class | wraps a `VideoFrame` or raw pixels |
| `VideoSampleSource`, `AudioSampleSource` | class | encode through WebCodecs |
| `EncodedPacketSink` | class | raw packets, used by the spike to drive a bare `VideoDecoder` |
| `Output`, `Mp4OutputFormat`, `WebMOutputFormat`, `StreamTarget` | class | mux |
| `canEncodeVideo`, `canEncodeAudio`, `getFirstEncodableVideoCodec` | function | exist, not needed (we call `isConfigSupported` ourselves) |

Recommended input list: `formats: [MP4, QTFF, WEBM, MATROSKA]` rather than `ALL_FORMATS`, so HLS, MPEG TS and audio only formats are never even probed.

### Input side

| Call | Signature (1.59.1) | Verified result on `small.mp4` |
|---|---|---|
| `input.getFormat()` | `Promise<InputFormat>` | `MP4` (`.name === "MP4"`) |
| `input.getMimeType()` | `Promise<string>` | `video/mp4; codecs="avc1.64000d, mp4a.40.2"` |
| `input.getVideoTracks()` | `Promise<InputVideoTrack[]>` | length 1 (use this for the more than one video track refusal) |
| `input.getPrimaryVideoTrack()` | `Promise<InputVideoTrack \| null>` | track |
| `input.getPrimaryAudioTrack()` | `Promise<InputAudioTrack \| null>` | track or null |
| `track.codec` | `"avc" \| "hevc" \| "vp9" \| "av1" \| "vp8" \| "prores" \| null` | `"avc"` (short names, not codec strings) |
| `track.codedWidth`, `track.codedHeight`, `track.rotation` | getters | 320, 240, 0 |
| `track.getCodecParameterString()` | `Promise<string \| null>` | `avc1.64000d` |
| `track.canDecode()` | `Promise<boolean>` | true |
| `track.getDecoderConfig()` | `Promise<VideoDecoderConfig \| null>` | `{ codec, codedWidth, codedHeight, description (avcC, 46 bytes), colorSpace }` |
| `track.computePacketStats(targetPacketCount?)` | `Promise<{ packetCount, averagePacketRate, averageBitrate }>` | `{ 60, 30, 287160 }`; `averagePacketRate` is the fps to feed `bitrateFor` |
| `track.computeDuration()` | `Promise<number>` seconds | 2 |
| audio `track.sampleRate`, `track.numberOfChannels`, `getDecoderConfig()` | getters, promise | 48000, 1, `{ codec: "mp4a.40.2", description (5 bytes) }` |
| `input.dispose()` | sync | releases the source |

### Decode side

| Call | Notes |
|---|---|
| `new VideoSampleSink(track, { hardwareAcceleration?, optimizeForLatency? })` | |
| `sink.samples(startTimestamp?, endTimestamp?)` | `AsyncGenerator<VideoSample>`; decode order handled inside, samples arrive in presentation order |
| `sample.timestamp`, `sample.duration` | **seconds** (float), not microseconds. `sample.microsecondTimestamp` exists |
| `sample.format` | `VideoSamplePixelFormat \| null` |
| `sample.visibleRect`, `sample.codedWidth`, `sample.displayWidth`, `sample.rotation` | |
| `sample.toVideoFrame()` | returns a **new** `VideoFrame` the caller must `close()`, in addition to `sample.close()` |
| `sample.copyTo(dest, options)` / `sample.allocationSize(options)` | same shape as `VideoFrame.copyTo` |
| `sample.close()` | required; hardware pools stall otherwise |
| `new AudioSampleSink(audioTrack)`, `.samples()` | `AsyncGenerator<AudioSample>`; 95 samples for 2 s AAC (Chromium) |

`frame.format` per engine (both `VideoSampleSink` and a bare `VideoDecoder` fed by `EncodedPacketSink`):

| Engine | `hardwareAcceleration` | Decoded `frame.format` | Notes |
|---|---|---|---|
| Chromium 148 | `no-preference`, `prefer-software` | `I420` | `prefer-hardware` config reported unsupported (headless, no GPU decode) |
| Firefox 150 | `no-preference`, `prefer-software`, `prefer-hardware` | **`BGRX`** | all three report supported, every frame is BGRX, 320x240 and 1920x1080 alike |

### Encode and mux side

| Call | Verified signature and behaviour |
|---|---|
| `new VideoSampleSource(config)` | `config: { codec: "avc" \| "vp9" \| "av1" \| ..., fullCodecString?, bitrate?, quality?, keyFrameInterval?, latencyMode?, hardwareAcceleration?, bitrateMode?, onEncoderConfig?, onEncodedPacket? }` |
| `codec` | short Mediabunny name (`"avc"`, `"vp9"`, `"av1"`); pass the exact WebCodecs string in `fullCodecString` (for example `"avc1.640028"`). `onEncoderConfig` confirmed the encoder got `codec: "avc1.640028"`, `avc: { format: "avc" }` set automatically |
| `bitrate` | number in bits per second; **marked `@deprecated` in 1.59.1** in favour of `quality`, still honoured (encoder config showed `bitrate: 1000000`). Keep using a number; revisit on the next Mediabunny bump |
| `keyFrameInterval` | **seconds** (default 2). 10 s at `keyFrameInterval: 2` gave 5 sync samples (`stss` 5 entries) in both engines |
| `latencyMode`, `hardwareAcceleration` | passed through to `VideoEncoder.configure` unchanged |
| `await source.add(sample)` | the backpressure point; accepts decoded samples directly (identity edit, BGRX frames in Firefox included) |
| `new VideoSample(buffer, { format, codedWidth, codedHeight, timestamp, duration, layout })` | works in both engines for `I420` and `BGRX`; `timestamp` and `duration` in **seconds** |
| `source.close()` | call before `output.finalize()` |
| `new AudioSampleSource({ codec: "aac" \| "opus", bitrate })`, `await .add(audioSample)` | works; see S3 for which codecs exist |
| `new Output({ format, target })` | `output.addVideoTrack(source, metadata?)`, `output.addAudioTrack(source, metadata?)` before `await output.start()` |
| `await output.finalize()` | flushes encoders and writes the index |
| `await output.cancel()` | verified: `state === "canceled"`, zero writes reached the target after 5 frames |
| `await output.getMimeType()` | `video/mp4; codecs="avc1.640028, opus"` |
| `new Mp4OutputFormat({ fastStart })` | `fastStart: false \| "in-memory" \| "reserve" \| "fragmented"`; also `metadataFormat?: "auto" \| "mdir" \| "mdta" \| "udta"` (irrelevant as long as `setMetadataTags` is never called) |
| `new WebMOutputFormat({ appendOnly?, minimumClusterDuration? })` | |
| `new StreamTarget(writable, { chunked, chunkSize })` | `writable: WritableStream<{ type: "write"; data: Uint8Array; position: number }>` |

**StreamTarget writes are positioned, not append only.** With `fastStart: false`, `chunked: true`, `chunkSize: 4 MiB` on a 7.7 MB output the target saw three writes in this order: `[0, 4194304]`, `[28, 8]`, `[4194304, 3568708]`. The 8 byte write at position 28 patches the `mdat` header after the first chunk was already delivered. The `parts[]` collector must apply every write at its `position` (patch into an earlier part when it overlaps), never simply push chunks.

`fastStart: "in-memory"` gives `[ftyp, moov, mdat]` but holds the whole file in memory until `finalize`. Use `fastStart: false` (streaming) and let the Rust rebuild produce the fast start layout.

### Mediabunny MP4 output, box tree (fastStart false, H.264 + Opus, Firefox)

```
ftyp 28  major isom, minor 512, compatible [isom, avc1, mp41]
mdat 173490
moov 2439
  mvhd 108      creation_time = modification_time = wall clock (3873105074, 2026-09-24)
  trak 1385
    tkhd 92     times = wall clock
    mdia 1285
      mdhd 32   times = wall clock, language und
      hdlr 55   vide, name "MediabunnyVideoHandler\0"
      minf 1190
        vmhd 20
        dinf 36
          dref 28
            url  12
        stbl 1126
          stsd 190
            avc1 174  compressorname "Mediabunny"
              avcC 49
              colr 19
              btrt 20
          stts 24
          ctts 480    version 1, signed offsets, 58 entries (Firefox only)
          cslg 32     (Firefox only)
          stsc 76
          stsz 260
          stco 36
          stss 20
  trak 938
    tkhd 92
    edts 36
      elst 28   1 entry, media_time 1024 (audio priming)
    mdia 802
      mdhd 32   timescale 48000
      hdlr 55   soun, name "MediabunnySoundHandler\0"
      minf 707
        smhd 16
        dinf 36 / dref 28 / url  12
        stbl 647
          stsd 91
            Opus 75
              dOps 19   pre_skip 312
              btrt 20
          stts, stsc, stsz, stco
```

| Question | Answer (both engines unless noted) |
|---|---|
| `hdlr` names | yes: `MediabunnyVideoHandler`, `MediabunnySoundHandler` (null terminated) |
| `compressorname` | yes: `Mediabunny` |
| `udta` / `meta` / `free` / `skip` / `uuid` | none written (fastStart false and in-memory, `setMetadataTags` not called) |
| `mvhd` / `tkhd` / `mdhd` times | **wall clock** (seconds since 1904). Two runs of the same input differ only inside these time fields (6 bytes) |
| `elst` | audio track only: 1 entry priming edit (`media_time` 1024 at 48 kHz). No `edts` on the video track in either engine, even with Firefox B frames |
| `ctts` | Chromium: none (no B frames). Firefox High/Main: `ctts` **version 1** with negative offsets plus `cslg` |
| `stss` | present when not every sample is sync |
| `colr`, `btrt` | present in every visual sample entry; `btrt` also in `Opus` |
| `ftyp` | `isom`, minor 512, `[isom, avc1, mp41]`, with or without the Opus track |
| stale bytes | the `mdat` payload starts with 8 bytes `00 00 00 00 00 00 00 10` not covered by any sample (leftover of the 64 bit header reservation). A strict "samples cover mdat exactly" check fails on raw Mediabunny output; the rebuild reads samples by `stco`/`stsz` and drops them |
| AVC in band strings | Firefox output carries the `x264 - core 164` SEI at mdat offset about 100 (see S3) |

### Mediabunny WebM output (VP9 + Opus, identical structure in both engines)

```
EBML: EBMLVersion 1, EBMLReadVersion 1, MaxIDLength 4, MaxSizeLength 8, DocType "webm", DocTypeVersion 2, DocTypeReadVersion 2
Segment
  SeekHead (3 Seek)
  Info: TimestampScale 1000000, MuxingApp "Mediabunny", WritingApp "Mediabunny", Duration
  Tracks
    TrackEntry: TrackNumber 1, TrackUID 1, TrackType 1, FlagLacing 0, Language "und", CodecID "V_VP9", CodecPrivate (12), CodecDelay 0, SeekPreRoll 0, Video(PixelWidth, PixelHeight, Colour)
    TrackEntry: TrackNumber 2, TrackUID 2, TrackType 2, FlagLacing 0, Language "und", CodecID "A_OPUS", CodecPrivate (19), CodecDelay 0, SeekPreRoll 80 ms, Audio(SamplingFrequency, Channels)
  Cluster (1 for 2 s)
  Cues
```

No Void, CRC-32, Tags, Title, DateUTC, SegmentUUID, Attachments or Chapters. Only `MuxingApp`/`WritingApp` need rewriting to `MKV_APP`.

## S2: plane access

`VideoFrame.copyTo(dest, { rect: visibleRect, layout })` into a preallocated `Uint8Array`, 60 frames of `big.mp4` (1920x1080), first frame excluded from the mean:

| Measured (this machine) | Chromium 148 | Firefox 150 |
|---|---|---|
| Decoded format | `I420` | `BGRX` |
| `codedWidth` x `codedHeight` | **1920 x 1090** | 1920 x 1080 |
| `visibleRect` | 0, 0, 1920, 1080 | 0, 0, 1920, 1080 |
| `copyTo` with rect + explicit layout, ms per frame | **0.6** (I420, 3.1 MB) | **15.0** (BGRX, 8.3 MB) |
| returned layout | `[0,1920] [2073600,960] [2592000,960]`, exactly as requested | `[0,7680]` |
| `copyTo({ format: "RGBA" })` | works, 12.3 ms | works, 31 ms |
| `new VideoFrame(i420Buffer, { format: "I420", codedWidth, codedHeight, timestamp, layout })` | works, 0.4 ms | works, 1.6 ms |
| same without `layout` (tight I420) | works | works |
| rect `x: 1` (odd origin) | **rejected** `TypeError: Invalid rect. x is not sample-aligned in plane 1` | accepted (BGRX has no subsampling) |
| rect width 1919 or height 1079 | accepted (allocation 3109320 / 3108480) | accepted |
| Canvas fallback: `OffscreenCanvas` 2D `drawImage(frame)` + `new VideoFrame(canvas, { timestamp })` | 6.3 ms, frame format `BGRA` | 8.0 ms, frame format `BGRA` |
| NV12 | not produced by either engine here; layout `[{0, w}, {w*h, w}]` is the one to request | |

Decisions:

- Always copy by `visibleRect`; never assume coded size equals display size (Chromium gave 1090 rows for a 1080 stream).
- Crop origins must be even for I420/NV12. Keep all crop and output sizes even.
- **Firefox never gives YUV planes here.** A Rust `transformPlanes` that only accepts I420 and NV12 would send every Firefox job to the canvas fallback, which is neither deterministic nor cheaper. `transformPlanes` must also accept one interleaved 4 byte plane (`BGRX`, `BGRA`, `RGBX`, `RGBA`) and convert to I420 in integer math (matrix from `frame.colorSpace`, BT.709 limited range as default), then resize. Keep the canvas path only for formats outside that set (10 bit, I422, I444).
- Identity edits skip `copyTo` in both engines (encoders accept `BGRX` input directly, verified).
- A copy plus rebuild round trip is lossless: in both engines the planes variant of S6 produced byte-identical encoded samples to the passthrough variant (outputs differ only in the 6 wall clock time fields).

## S3: encoder calibration

### `VideoEncoder.isConfigSupported` (bitrate 4 Mbps, 30 fps, `latencyMode: "quality"`, H.264 with `avc: { format: "avc" }`)

| Codec string | Chromium 720p | Chromium 1080p | Chromium 2160p | Firefox 720p | Firefox 1080p | Firefox 2160p |
|---|---|---|---|---|---|---|
| `avc1.640028` | yes | yes | no | yes | yes | yes |
| `avc1.4d0028` | yes | yes | no | yes | yes | yes |
| `avc1.42001f` | yes | **no** | no | yes | yes | yes |
| `vp09.00.10.08` | yes | yes | yes | yes | yes | yes |
| `av01.0.04M.08` | yes | yes | yes | yes | yes | yes |

Chromium enforces the H.264 level against the frame size (macroblocks per frame); frame rate did not change the answer. Level sweep (Chromium):

| Size | Lowest accepted H.264 level |
|---|---|
| 1920x1080 | 4.0 (`0x28`); Baseline `avc1.42001f` (3.1) refused, `avc1.420028` accepted |
| 2560x1440 | 5.0 (`0x32`) |
| 3840x2160 | 5.1 (`0x33`) |

Firefox accepted every level at every size. Odd dimensions (1279x719) are refused by both engines. Hence `pickEncoder` bumps the `avc1` level byte to the lowest level whose MaxFS and MaxMBPS fit the output (never below the candidate's own level) and rounds dimensions to even. VP9 and AV1 strings needed no bump.

### Decoders (`VideoDecoder.isConfigSupported`)

| Codec | Chromium | Firefox |
|---|---|---|
| h264 `avc1.64001f` | yes | yes |
| hevc `hvc1.1.6.L93.B0` | **no** | **no** |
| vp8 | yes | yes |
| vp9 `vp09.00.10.08` | yes | yes |
| av1 `av01.0.04M.08` | yes | yes |

### Audio encoders (`AudioEncoder.isConfigSupported`, 48 kHz or 44.1 kHz, mono or stereo)

| Codec | Chromium | Firefox |
|---|---|---|
| `mp4a.40.2` (AAC LC) | **no** | **no** |
| `opus` | yes | yes |

So "Keep sound" in both Playwright engines on Linux produces Opus in MP4. Tests must assert a `soun` track, not `mp4a`.

### Encoded bitstream (60 frames 320x240 from an OffscreenCanvas, bare `VideoEncoder`)

| Check | Chromium 148 | Firefox 150 |
|---|---|---|
| NAL types in chunks (H.264, all three profiles) | 1, 5 only | 1, 5, **6**, **7**, **8** (SPS and PPS in band on every key frame: 5 of 5 in the 1080p S6 output) |
| SEI (type 6) | none | **one per stream**, in the first key frame only (1 occurrence in the 300 frame S6 output): payload type 5 `user_data_unregistered`, UUID `dc45e9bd-e6d9-48b7-962c-d820d923eeef`, 698 bytes (637 for Baseline), text `x264 - core 164 r3108 31e19f9 - H.264/MPEG-4 AVC codec - Copyleft 2003-2023 - http://www.videolan.org/x264.html - options: ...` |
| `decoderConfig.description` (avcC) content | 1 SPS + 1 PPS only. High profile adds the 4 byte High extension (`fd f8 f8 00`: chroma 4:2:0, 8 bit, 0 SPS ext) | 1 SPS + 1 PPS only, no High extension, but **malformed**, see below |
| avcC level | adapted to the frame (level 1.3 `0x0d` for 320x240) | as requested (`0x28`) |
| B frames (output timestamps non monotonic) | never | **High and Main in both `quality` and `realtime`**; Baseline never |
| Key frames without forcing | follows its own GOP (2 in 60 frames) | 1 in 60 frames |
| VP9 description | none (`vpcC` built by Mediabunny) | none |
| AV1 OBU types | 2 (temporal delimiter), 1 (sequence header), 6 (frame) | same, plus 3 (frame header) in `quality` mode |
| AV1 metadata OBU (type 5) | none | none |

**Firefox avcC bug.** Firefox 150's `decoderConfig.description` repeats the NAL header byte of every parameter set and leaves the reserved bits at zero:

```
Firefox avcC:  01 64 00 28 | 03 | 01 | 00 1a | 67 67 64 00 28 ac d9 ... | 01 | 00 06 | 68 68 eb ec b2 2c
In band SPS:                               00 00 00 19 | 67 64 00 28 ac d9 ...
In band PPS:                               00 00 00 05 | 68 eb ec b2 2c
Chromium avcC: 01 64 0c 0d | ff | e1 | 00 12 | 67 64 0c 0d ...           | 01 | 00 04 | 68 ce 3c 80 | fd f8 f8 00
```

ffmpeg reports `sps_id 1 out of range` for the avcC of Firefox output and only decodes thanks to the in band SPS/PPS. `rebuild_avcc` must therefore build the avcC from the in band SPS/PPS of the first sync sample when they are present, and fall back to the description entries only when their first byte after the NAL header is a valid `profile_idc` (repairing a doubled `0x67`/`0x68` header). It must always write `0xff` and `0xe1` style reserved bits and add the High extension for profile 100.

## S6: time budget, full decode, passthrough, encode, mux

`big.mp4` 1080p30 10 s (300 frames) through `VideoSampleSink` -> `VideoSampleSource` (`fullCodecString` best H.264 = `avc1.640028`, bitrate `bitrateFor` = 6220800, `keyFrameInterval: 2`, `latencyMode: "quality"`, `hardwareAcceleration: "no-preference"`) -> `Output(Mp4OutputFormat({ fastStart: false }), StreamTarget 4 MiB)`. Timing taken inside the worker with `performance.now()`.

| Measured (this machine) | Chromium passthrough | Chromium planes | Firefox passthrough | Firefox planes |
|---|---|---|---|---|
| Total seconds (open to finalize) | 1.41 | 1.76 | 5.64 | 9.13 |
| Throughput, fps | **212** | 170 | **53** | 33 |
| `finalize()` ms | 62 | 54 | 539 | 523 |
| Output bytes | 7763012 | 7763012 | 7717022 | 7717022 |
| Browser RSS, all processes, base to peak (MB) | 401 to 672 | 488 to 697 | 697 to 1492 | 845 to **2749** |
| `performance.memory` in the worker | not exposed | not exposed | not exposed | not exposed |

"planes" means per frame `copyTo` of the visible rect into one reused buffer, then `new VideoSample(buffer, ...)` for the encoder, without any Rust work in between. It is the floor cost of the Rust transform path.

Observations:

- Both engines used their software encoders (no GPU in headless). Chromium is roughly 4 times faster than Firefox here; Firefox 1080p re-encode is still faster than real time on this machine.
- Chromium's `performance.memory` is window only; for the heap figures in S5 use RSS or CDP, not the worker.
- Firefox RSS climbed to 2.7 GB in the planes variant for a 10 s clip. Every new `VideoFrame` built from a buffer copies 8.3 MB (BGRX) and Firefox seems to release them late. S5 must repeat this with a 100 MB input before shipping; converting BGRX to I420 in Rust and building I420 frames (3.1 MB) should cut it by more than half.
- ETA model for the UI: fps measured over the first 30 frames, remaining frames from `computePacketStats().packetCount`. Expect 5 to 10 times slower on phones (research report section 1.1).

## What changes in the plan

| Plan item | Change |
|---|---|
| Per frame transforms, "canvas fallback only if the frame format is not I420/NV12" | Firefox (Linux, 150) decodes to `BGRX` always. `transformPlanes` gains an interleaved RGB input (`BGRX`/`BGRA`/`RGBX`/`RGBA`) with integer RGB to I420 conversion. Canvas only for 10 bit and 4:2:2/4:4:4 |
| `rebuild_avcc (SPS/PPS only)` | Rebuild from the in band SPS/PPS when present; Firefox's avcC is malformed (doubled NAL header, zero reserved bits) |
| Encoder candidates "level bumped for 4K" | Also needed for 1080p Baseline and 1440p on Chromium. Implemented in `pickEncoder` via MaxFS/MaxMBPS |
| Keep sound: "AAC if supported, else Opus-in-MP4" | Neither Playwright engine on Linux has an AAC encoder; the Opus path is the one that runs in CI |
| Firefox `latencyMode: "quality"` B frames produce `ctts` + priming `elst` | B frames appear in both latency modes for High/Main. Mediabunny writes `ctts` version 1 (negative offsets) plus `cslg` and **no** video `elst`; only the audio track gets a 1 entry `elst`. The strict model must accept `ctts` v0 and v1 and `cslg`; the writer drops `cslg` or maps it into the allowlist |
| `StreamTarget` 4 MiB chunks into `parts[]` | Writes are positioned (a back patch at offset 28 arrives after the first 4 MiB chunk). The collector applies writes by `position` |
| `Mp4OutputFormat({ fastStart: false })` | Confirmed; output order is `[ftyp, mdat, moov]` with 8 stale bytes at the start of `mdat`. Rebuild handles both |
| Mediabunny output hygiene | Wall clock times in `mvhd`/`tkhd`/`mdhd`, handler names, `compressorname`, WebM `MuxingApp`/`WritingApp` all say Mediabunny or leak the processing time. All already overwritten by the canonical writer; the audit must flag each of them if they ever reach output |
| `VideoSample` timestamps | Mediabunny uses **seconds** everywhere (`timestamp`, `duration`, `keyFrameInterval`) |
| Playwright Firefox project | Added. `tests/determinism.spec.ts` launches both engines itself, so it now runs once per project; guard it with `test.skip(browserName !== "chromium")` when refactoring |

Nothing else in the architecture changes: decode, per frame hook, encode, mux, Rust rebuild, Rust audit stay as planned.

## TypeScript modules delivered with this spike

| File | Contents |
|---|---|
| `src/sanitizer/video/encoderPick.ts` | `ENCODER_CANDIDATES` (plan order), `pickEncoder(width, height, fps, container?)`, `avcCodecFor`, `pickAudioEncoder(container, sampleRate?, numberOfChannels?)`, `bitrateFor`, types `EncoderPick`, `AudioPick`, `EncoderName`, `VideoContainer` |
| `src/sanitizer/capability.ts` | `probeVideoCapability({ wasmReady? })` cached, `capabilityCopy(cap)`, `adviceFor(userAgent)`, `ADVICE` |
| `tests/helpers/boxes.ts` | `topLevelBoxes`, `walkBoxes`, `ebmlIds`, `hasBytes` |

Checked in both engines and both realms (window and module worker): `pickEncoder` returns `h264-high` / `avc1.640028` at 720p and 1080p, `avc1.640034` at 2160p60, `vp9` for WebM; `pickAudioEncoder("video/mp4")` returns `opus` (no AAC); `probeVideoCapability()` resolves to mode `reencode` and returns the same promise on the second call.
