# Video Layer 1: stripping metadata, trackers and provenance, locally

Research note for STOPTRACKINGME. Scope: MP4/MOV (ISO BMFF) and WebM/Matroska files up to
100 MB, cleaned entirely inside the browser tab (WebAssembly plus Web Workers, no server, no
network), under the same fail-closed rule the image path already follows: strip, then re-audit
the output bytes with the same allowlist, and refuse the download if anything survives.

Date of research: 2026-09-24. Sizes and timings marked "estimate" are engineering estimates,
not measurements. Everything else links to a source.

## Executive summary

1. **Rebuild, do not delete.** The image path does not edit EXIF out of a JPEG, it encodes a
   fresh file from pixels. The video equivalent without re-encoding is a **rebuild remux**:
   parse the input sample tables, then write a brand-new container that contains only a fixed
   `ftyp`, a minimal `moov`, and an `mdat` holding only the referenced sample bytes. Anything
   not explicitly rebuilt (all `udta`, `meta`, `uuid`, `free`, trailers, extra tracks, unused
   bytes inside `mdat`) simply never gets written.
2. **The container is not the whole story.** Codec bitstreams carry their own metadata: H.264
   and H.265 SEI NAL units (x264 writes its full version and settings string there, Apple
   VideoToolbox writes an unregistered user data SEI too), HEVC `hvcC` can hold declarative
   SEI, AV1 has metadata and padding OBUs, and Dolby Vision rides in unspecified NAL types.
   Layer 1 must filter these NAL units / OBUs and rewrite sample sizes. That is still a remux,
   no decode needed.
3. **Recommended engine: extend the existing Rust core** with a hand-written ISO BMFF walker
   and writer plus an EBML walker and writer, sharing one allowlist between strip and audit,
   exactly like `container.rs` / `allowlist.rs` / `strip.rs` / `audit.rs` today. Estimated wasm
   growth: 60 to 150 KB (estimate). No ffmpeg.wasm (about 31 MB, GPL build), no
   SharedArrayBuffer, so no COEP header change is needed.
4. **Stream, do not load.** Read `moov` (small) with `File.slice`, then copy samples in
   chunks into a `Blob` built from parts. Peak memory stays far below 100 MB. The audit then
   streams over the output blob.
5. **Be honest about limits.** A remux cannot remove pixel or audio watermarks (SynthID, Meta
   Video Seal, forensic marks), sensor noise fingerprints (PRNU), or encoder fingerprints in
   the coding decisions themselves. A later Layer 2 (WebCodecs re-encode) reduces some of this,
   but is not deterministic across browsers and is never a guarantee. Removing a C2PA manifest
   also does not stop a provider from matching the video through a watermark or fingerprint
   lookup (C2PA "soft binding").

## 1. Where metadata lives, per container

### 1.1 MP4 / MOV (ISO BMFF and QuickTime)

MP4 is a tree of boxes (size, fourcc, payload). QuickTime MOV is the ancestor and uses the
same framing with extra atoms. Key sources: Apple QuickTime File Format metadata docs
([QTFF Metadata](https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/Metadata/Metadata.html),
[QuickTime metadata keys](https://developer.apple.com/documentation/quicktime-file-format/quicktime_metadata_keys)),
and the ExifTool QuickTime tag table ([exiftool.org QuickTime](https://exiftool.org/TagNames/QuickTime.html)).

| Box / atom | Where | What it carries | Layer 1 action |
|---|---|---|---|
| `udta` | `moov`, `trak`, sometimes `moov/meta` | QuickTime user data: `©xyz` (GPS as ISO 6709 text), `©mak`, `©mod`, `©swr`, `©too` (encoder, for example `Lavf60.16.100`), `©day`, `©cmt`, `©nam`, vendor atoms | never written |
| `meta` + `hdlr(mdta)` + `keys` + `ilst` | `moov`, `trak`, `udta` | Apple and Android key-value metadata: `com.apple.quicktime.location.ISO6709`, `...location.accuracy.horizontal`, `...make`, `...model`, `...software`, `...creationdate`, `...content.identifier`, `com.android.version`, `com.android.manufacturer`, `com.android.model`, `com.android.capture.fps` | never written |
| `meta` + `ilst` (iTunes style) | `moov/udta/meta` | `©nam`, `©ART`, `©too`, `covr` (cover image, which itself can carry EXIF) | never written |
| `uuid` (XMP) | top level or `moov/udta` | XMP packet, UUID `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`, written by Adobe tools ([XMP Part 3](https://dl.photoprism.app/pdf/specifications/20120101-Adobe_XMP_Specification_Part_3.pdf)) | never written |
| `uuid` (C2PA) | top level, right after `ftyp` | C2PA manifest store in JUMBF, UUID `D8FEC3D6-1B0E-483C-9297-5828877EC481`, purpose string `manifest` or `merkle` ([C2PA spec 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)) | never written |
| any other `uuid` | anywhere | vendor payloads (Sony, GoPro, PSP, Microsoft) | never written |
| `Xtra` / `xtra` | `moov/udta` | Microsoft Windows property store (author, rating, sometimes GPS) | never written |
| `smta`, `sefd` / `SEFT` trailer | `moov/udta`, after last box | Samsung metadata and trailer data (per ExifTool) | never written, trailing bytes refused |
| `free`, `skip`, `wide` | anywhere | padding; can hide arbitrary data | never written |
| `mdat` gaps | inside `mdat` | bytes not referenced by any `stco`/`co64` entry can hold anything (old edits, other files) | only referenced sample bytes are copied |
| `edts` / `elst` | `trak` | edit list. A trimmed clip can still contain the cut frames in `mdat`, hidden by the edit list | rebuild without hidden samples, or drop `elst` and bake the offset |
| timed metadata tracks | `trak` with handler `meta`, sample entries `mebx`, `camm`, `gpmd`, `djmd`, `CTMD`, `tx3g` | per-frame GPS, gyro, accelerometer, drone telemetry, iPhone Live Photo and Cinematic mode data | whole track dropped |
| `tmcd` track | `trak` | timecode, can encode capture wall clock | dropped |
| chapter / text tracks, `tref` | `trak` | chapter titles, references to metadata tracks | dropped |
| `mvhd`, `tkhd`, `mdhd` times | headers | `creation_time`, `modification_time` (seconds since 1904) | written as 0 |
| `hdlr` name | `mdia/hdlr` | handler name string, fingerprints the muxer ("Core Media Video", "VideoHandler", "ISO Media file produced by Google Inc.") | written empty |
| visual sample entry `compressorname` | `stsd/avc1` etc. | 32-byte string, often the encoder name | written as zeros |
| `ftyp` brands | top level | brand list fingerprints the muxer (`qt  `, `isom iso2 avc1 mp41`, `mp42 isom`) | canonical fixed `ftyp` |
| `colr` with `prof` / `rICC` | `stsd` entry | embedded ICC profile (same risk class as PNG `iCCP`) | only `nclx` kept |
| fragmented MP4: `moof`, `sidx`, `emsg`, `prft`, `mfra` | top level | `emsg` event messages, `prft` producer reference time (wall clock), segment indexes | v1: refuse fMP4 or defragment; never write `emsg`/`prft` |
| encryption: `sinf`, `pssh`, `senc`, `encv`/`enca` | `stsd`, `moov`, `moof` | DRM | refuse the file |

Real-world examples of the Apple and Android keys: iPhone GPS lives in `moov/meta` keys plus
`ilst` as `com.apple.quicktime.location.ISO6709`
([Apple docs](https://developer.apple.com/documentation/avfoundation/avmetadatakey/quicktimemetadatakeylocationiso6709),
[IPED issue 2983](https://github.com/sepinf-inc/IPED/issues/2983)). Samsung `smta` is documented
in [ExifTool Samsung tags](https://exiftool.org/TagNames/Samsung.html). Apple's
`com.apple.quicktime.content.identifier` is a UUID that pairs a Live Photo video with its still,
which is a cross-file tracker by design.

### 1.2 WebM / Matroska (MKV)

Matroska is EBML: nested elements with variable length IDs and sizes. The normative element
list is [RFC 9559](https://datatracker.ietf.org/doc/rfc9559/) and the
[Matroska element table](https://www.matroska.org/technical/elements.html). WebM is a
restricted Matroska profile (DocType `webm`, VP8/VP9/AV1 plus Vorbis/Opus).

| Element | Path | What it carries | Layer 1 action |
|---|---|---|---|
| `MuxingApp` (0x4D80), `WritingApp` (0x5741) | `Segment/Info` | muxer and app name plus version, for example `Lavf60.16.100`, `mkvmerge v80.0`, `Chrome` | mandatory, so rewritten to a fixed constant |
| `DateUTC` (0x4461) | `Segment/Info` | creation date and time | never written |
| `Title` | `Segment/Info` | free text | never written |
| `SegmentUUID`, `PrevUUID`, `NextUUID`, `SegmentFilename`, `SegmentFamily`, `ChapterTranslate` | `Segment/Info` | random 128-bit IDs and filenames that link files across a session | never written |
| `TrackUID` | `TrackEntry` | random 64-bit ID per track, mandatory | rewritten deterministically (1, 2) |
| `Name`, `Language` / `LanguageBCP47` | `TrackEntry` | free text track names, locale | `Name` dropped, language forced to `und` |
| `Tags` | `Segment` | arbitrary key-value tags. FFmpeg writes `ENCODER` per file and per track, plus `DURATION` | never written |
| `Attachments` | `Segment` | embedded files: fonts, cover art, any binary (and possibly a C2PA JUMBF blob) | never written |
| `Chapters` | `Segment` | chapter titles and UIDs | never written |
| `Void` (0xEC) | anywhere | padding, can hide data | never written |
| `CRC-32` (0xBF) | any master | checksum | dropped (or recomputed, see audit) |
| `BlockAdditions` / `BlockAdditionMapping` | `BlockGroup`, `TrackEntry` | side data per frame (HDR10+, alpha, Dolby Vision config, anything) | never written |
| `ContentEncodings` | `TrackEntry` | compression or encryption of frames | refuse file |
| unknown IDs | anywhere | anything | refuse or never written |

C2PA in WebM: the C2PA 2.x spec defines embedding for BMFF, RIFF, JPEG, PNG and others, but
does not define a Matroska/WebM embedding
([C2PA spec 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html),
[C2PA viewer format reference](https://c2paviewer.com/articles/c2pa-spec-versions-file-formats)).
Any WebM provenance therefore lives in an external or remote manifest, in `Tags`/`Attachments`,
or in the pixels (watermark). Since the rebuild never writes `Tags` or `Attachments`, all
in-file variants go away. The audit should additionally scan for the JUMBF signature
(`jumb` box type followed by a `jumd` with `c2pa` label) as a belt-and-braces check.

### 1.3 Inside the codec bitstream (survives a naive remux)

| Codec | Carrier | Example content | Layer 1 action |
|---|---|---|---|
| H.264 | NAL type 6 (SEI), payload type 5 `user_data_unregistered` | x264 writes `x264 - core 164 r3108 ... options: cabac=1 ref=3 ...`, which identifies the encoder build and settings ([doom9 on x264 user data](https://forum.doom9.org/archive/index.php/t-146679.html)). Apple VideoToolbox inserts its own unregistered SEI with a fixed UUID ([Apple forum](https://developer.apple.com/forums/thread/778196)) | drop all NAL type 6; also drop 9 (AUD), 12 (filler), 13 to 23 reserved, 24 to 31 unspecified |
| H.265 / HEVC | NAL 39 (prefix SEI), 40 (suffix SEI), 38 (filler), 35 (AUD), 48 to 63 unspecified (Dolby Vision RPU uses 62) | encoder strings, HDR10+ as T.35 SEI, Dolby Vision per-frame data | keep VCL 0 to 31, VPS 32, SPS 33, PPS 34; drop the rest |
| HEVC `hvcC` | declarative SEI arrays inside the sample entry | ISO/IEC 14496-15 explicitly allows "declarative" SEI such as user data in `hvcC` ([FFmpeg patch discussion](https://patchwork.ffmpeg.org/patch/4731/)) | rebuild `hvcC` with only VPS, SPS, PPS arrays |
| H.264 `avcC` | SPS, PPS, SPS extension | normally clean | keep SPS and PPS only |
| AV1 | OBU type 5 (metadata: HDR CLL, MDCV, scalability, ITU-T T.35, timecode, unregistered types), type 15 (padding), type 8 (tile list) | HDR10+ via T.35 ([AV1 HDR10+ spec](https://aomediacodec.github.io/av1-hdr10plus/)), timecodes, vendor payloads ([AV1 spec](https://aomediacodec.github.io/av1-spec/)) | keep types 1, 2, 3, 4, 6, 7; drop 5, 8, 15 and reserved |
| VP8 / VP9 | no user data syntax in the bitstream | trailing bytes after a frame's data are not validated by a container walker | keep, document as residual risk |
| AAC (in `mp4a`) | Fill element (`ID_FIL`) and Data Stream Element (`ID_DSE`) inside raw frames | some encoders write version strings or padding | v1: document as residual; parse later |
| Opus, Vorbis | `OpusTags` / Vorbis comments | in Ogg these hold `ENCODER=`; in MP4/Matroska the codec private is `OpusHead`/`dOps` only | keep `dOps`/`OpusHead`; reject Vorbis comment headers with content, or rewrite them empty |

FFmpeg's own recipe to remove these at remux time is the `filter_units` bitstream filter, for
example `filter_units=remove_types=35|38-40` for HEVC AUD, filler and SEI
([FFmpeg bitstream filters](https://manpages.debian.org/buster/ffmpeg/ffmpeg-bitstream-filters.1.en.html)).
Our core does the same thing natively.

Important parsing detail: in MP4 the H.264/H.265 samples are length-prefixed NAL units (length
size from `avcC`/`hvcC`), not Annex B start codes. Dropping a NAL changes the sample size, so
`stsz` and the chunk offsets must be recomputed. Since we rebuild the whole `moov`, this falls
out naturally.

## 2. AI and provenance signatures

| Signal | Where it lives | Removable locally by Layer 1? |
|---|---|---|
| C2PA Content Credentials (Adobe Premiere/Firefly, Sora, Pixel 8/9/10 video, Sony cameras, CapCut, Runway) | MP4 `uuid` box after `ftyp` with a JUMBF manifest store and a BMFF hash assertion ([C2PA spec](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html), [Medium explainer of the box layout](https://medium.com/@sanilf1/c2pa-basics-accb96695b5b)) | **Yes**, the box is never written. The manifest's hard binding becomes invalid anyway once `mdat` changes |
| C2PA remote / external manifest | a URL in XMP (`dcterms:provenance`) or an HTTP Link header, the manifest sits in the cloud | the in-file pointer yes; the cloud copy no |
| C2PA soft binding | the manifest repository is found again by watermark or fingerprint lookup ([C2PA spec](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)) | **No.** Stripping the manifest does not stop a lookup match |
| Google SynthID (Veo, and since the May 19 2026 announcement also OpenAI output) | invisible watermark in the pixels (each frame) and in audio ([C2PA viewer on the 2026 announcement](https://c2paviewer.com/articles/openai-google-c2pa-synthid-2026)) | **No.** Built to survive trimming, compression and minor crops ([DataCamp overview](https://www.datacamp.com/tutorial/synthid)). Heavy re-encoding degrades it but gives no guarantee |
| Meta Video Seal | open source pixel watermark with a hidden message, robust to compression ([paper](https://arxiv.org/abs/2412.09492), [TechCrunch](https://techcrunch.com/2024/12/12/meta-releases-a-tool-for-watermarking-ai-generated-videos/)) | **No** |
| OpenAI Sora | visible "Sora" watermark plus C2PA, plus internal reverse search ([OpenAI](https://openai.com/index/launching-sora-responsibly/)); in practice applied inconsistently per plan ([EA Forum analysis](https://forum.effectivealtruism.org/posts/oMJzXc79CexLqi52F/openai-does-not-appear-to-be-applying-watermarks-honestly)) | C2PA yes; visible mark and server-side search no |
| Pixel / Android camera video | C2PA plus `com.android.*` keys ([Google security blog](https://security.googleblog.com/2025/09/pixel-android-trusted-images-c2pa-content-credentials.html)) | yes |
| TikTok / CapCut | `com.bytedance.*` keys, `©swr`/`©too` strings, C2PA; TikTok reads C2PA on upload to auto-label AI content ([TikTok newsroom](https://newsroom.tiktok.com/en-us/partnering-with-our-industry-to-advance-ai-transparency-and-literacy), [Metadata Cleaner blog](https://metadatacleaner.app/blog/tiktok-ai-metadata-video-suppression/)) | yes for all in-file fields |
| Instagram / Meta | Content Credentials labels via the 2026 Meta partnership; IPTC/XMP "AI info" fields | in-file yes; platform side matching no |
| YouTube / CDN downloads | `©too` of the platform's muxer, `hdlr` names such as "ISO Media file produced by Google Inc.", encoder SEI, `emsg`/`prft` in DASH segments | yes (rebuild plus SEI filter) |
| Camera vendor serials | `udta` vendor atoms, `uuid` boxes, GoPro `gpmd` track, DJI `djmd`, Insta360 maker notes (ExifTool lists `SerialNumber`, `CameraIdentifier`) | yes, since those boxes and tracks are never written |

## 3. Tracker-style identifiers worth listing in the UI report

The report ("what we removed") should name these when found on input, grouped for humans:

- **Location:** `©xyz`, `com.apple.quicktime.location.*`, GPS in `camm`/`gpmd`/`tx3g`/`djmd` tracks.
- **Device:** `©mak`, `©mod`, `com.apple.quicktime.make/model/software`,
  `com.android.manufacturer/model/version`, vendor serials, `CameraIdentifier`, `LensModel`.
- **Time:** `mvhd`/`tkhd`/`mdhd` creation and modification times, `©day`,
  `com.apple.quicktime.creationdate`, Matroska `DateUTC`, `tmcd` timecode, `prft`.
- **Software:** `©too`, `©swr`, `hdlr` names, `compressorname`, `ftyp` brands, Matroska
  `MuxingApp`/`WritingApp`, `Tags/ENCODER`, x264 / VideoToolbox SEI strings.
- **Unique IDs:** `com.apple.quicktime.content.identifier`, Matroska `SegmentUUID`, `TrackUID`,
  `ChapterUID`, `AttachmentUID`, XMP `xmpMM:DocumentID` / `InstanceID` / `OriginalDocumentID`,
  C2PA instance IDs, any `uuid` box.
- **Provenance:** C2PA manifest, XMP history, `com.bytedance.*`.
- **Hidden content:** frames hidden by an edit list, unreferenced bytes inside `mdat`, trailers
  after the last box, `free`/`skip`/`Void` padding, attachments, cover art.

## 4. Strategy options

### 4a. Remux-only strip (codec data untouched except NAL/OBU filtering)

| Option | Size shipped | License | Needs SharedArrayBuffer / COEP | Fit with fail-closed core |
|---|---|---|---|---|
| **ffmpeg.wasm** | about 31 MB single-thread core, 32 MB multi-thread ([32blog](https://32blog.com/en/ffmpeg/ffmpeg-wasm-browser-video)) | wrapper MIT, published core is GPL because it links x264/x265 ([ffmpeg.wasm-core LICENSE](https://github.com/ffmpegwasm/ffmpeg.wasm-core/blob/n4.3.1-wasm/LICENSE.md), [FFmpeg legal](https://www.ffmpeg.org/legal.html)) | multi-thread yes; single-thread no ([issue 234](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/234)) | poor. Huge, whole file in MEMFS (100 MB in, 100 MB out, both in wasm heap), and it deletes what it knows rather than rebuilding. `-map_metadata -1` does not remove SEI, `hdlr` names or `uuid` boxes on its own |
| **mediabunny** (successor of mp4-muxer and webm-muxer, both now deprecated) | tree-shakable, from about 5 kB gzipped for minimal use; a full MP4 plus WebM demux and mux build is larger | MPL-2.0 ([repo](https://github.com/Vanilagy/mediabunny)) | no | good as a **cross-check or Layer 2 engine**. Its Conversion API copies packets when possible and drops tags with `tags: {}` ([docs](https://mediabunny.dev/guide/converting-media-files)), but by default it copies metadata, it is JS (not our deterministic wasm), and it does not filter SEI inside packets |
| **mp4box.js** (GPAC) | a few hundred KB of JS (estimate) | BSD-3-Clause ([repo](https://github.com/gpac/mp4box.js)) | no | usable for parsing and fragmenting, but MP4 only, JS, and we would still write our own filter and audit |
| **Rust crates to wasm**: `mp4-atom` (encode and decode of boxes, MIT/Apache, [crates.io](https://crates.io/crates/mp4-atom)), `mp4box` (parse plus non-destructive edit with offset fixup, [docs.rs](https://docs.rs/mp4box)), `mp4parse` (Mozilla, read only, MPL-2.0, [repo](https://github.com/mozilla/mp4parse-rust)), `mp4` (read and write, [docs.rs](https://docs.rs/mp4)); for Matroska `ebml-iterable` / `webm-iterable` (read and write, [docs.rs](https://docs.rs/webm-iterable/latest/webm_iterable/)), `matroska-demuxer` (read only, [docs.rs](https://docs.rs/matroska-demuxer)) | tens of KB each after LTO and `opt-level = "s"` (estimate) | permissive | no | good, but these crates are generous parsers built to preserve unknown boxes. Our need is the opposite: a strict parser that refuses anything unknown |
| **Hand-written walker and writer in `sanitize-core`** | 60 to 150 KB added wasm (estimate) | ours, MIT | no | **best fit.** Same pattern as `walk_png` / `walk_jpeg`: tiny, fuzzable, strict, one allowlist |
| **WebCodecs** | 0 KB (browser API) | n/a | no | not a remux tool (it has no container support). Relevant only for 4b |

Symphonia is an audio decoding framework and is not useful for video containers.

### 4b. Full re-encode through WebCodecs (Layer 2, not Layer 1)

Pipeline: demux (our core or mediabunny) → `VideoDecoder` → `VideoFrame` → optional resize →
`VideoEncoder` → mux in our core → same audit. Audio through `AudioDecoder`/`AudioEncoder`,
or dropped.

- **What it removes on top of 4a:** everything codec-level (SEI, OBUs, VP9 trailing bytes,
  AAC fill data), the source encoder's coding-decision fingerprint (GOP, quantizer patterns,
  motion vector habits), and it weakens fragile pixel watermarks and some stego. It does
  **not** reliably remove SynthID, Video Seal or PRNU.
- **Support:** Chrome and Edge 94+, Firefox 130+ desktop, Safari 26+ with full parity; broken
  or partial on Safari 16.4 to 18.x and on Firefox for Android
  ([caniuse](https://caniuse.com/webcodecs), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)).
  Codec availability per browser and OS varies (for example HEVC encode), so it must probe
  with `VideoEncoder.isConfigSupported`.
- **Determinism:** not achievable. Hardware and software encoders differ per GPU, driver, OS and
  browser version, so the same input gives different output bytes across machines. This breaks
  the README promise "byte-for-byte identical in every browser". A deterministic alternative is a
  software encoder in wasm (libvpx, rav1e, openh264), but that is several MB and slow.
- **Cost for 100 MB:** a 100 MB phone clip is typically 1 to 3 minutes of 1080p or 4K. Hardware
  WebCodecs encode on desktop runs faster than real time (estimate: 30 s to 2 min for such a
  clip); on phones, thermal throttling and memory make it several minutes (estimate). A wasm
  software encoder at 1080p would be many times slower than real time (estimate).
- **Quality:** generational loss; the file may get bigger or visibly worse unless bitrate is
  tuned.

Conclusion: ship 4a as Layer 1 (deterministic, lossless, seconds), offer 4b later as an opt-in
"re-encode" mode clearly labelled as non-deterministic and best effort, still gated by the
same output audit.

### 4c. What the fail-closed philosophy demands

1. **Rebuild the file from an allowlisted model**, never copy unknown boxes through.
2. **Refuse instead of guessing:** encrypted tracks, fragmented MP4 (v1), `ContentEncodings`,
   unknown codecs, edit lists that are not a plain start offset, sample tables that point
   outside the file, overlapping samples, more than one video track.
3. **Independent re-audit of the output bytes** by a second walker pass that knows nothing of
   the builder's state, reading the same allowlist constants. If the audit fails, no download.
4. **Codec-level audit**: every NAL unit / OBU in every sample must be in the allowed type set.

#### MP4 structural allowlist (output side)

Exactly this tree, in this order, nothing else:

```
ftyp                      fixed: major 'isom', minor 512, compatible 'isom','iso2','mp41' (+'avc1'/'hvc1'/'av01' as needed)
moov
  mvhd                    version 0, times = 0, rate 1.0, volume 1.0, identity matrix
  trak (video)
    tkhd                  times = 0, flags enabled|in_movie, matrix restricted to 0/90/180/270 rotation
    mdia
      mdhd                times = 0, language 'und'
      hdlr                'vide', name empty
      minf
        vmhd
        dinf / dref / 'url '   flags = 1 (self-contained), no URL string
        stbl
          stsd
            avc1|hvc1|av01|vp09   compressorname zeroed
              avcC|hvcC|av1C|vpcC  rebuilt: parameter sets only, no SEI arrays
              colr (nclx only), pasp, btrt (optional)
          stts, ctts (if needed), stss, stsc, stsz, stco|co64
  trak (audio, optional)
    tkhd, mdia, mdhd, hdlr('soun', empty name), minf, smhd, dinf, stbl
      stsd / mp4a+esds | Opus+dOps
mdat                      only referenced samples, contiguous, no gaps, no trailing bytes
```

Denylist (for input reporting, named findings): `udta`, `meta`, `keys`, `ilst`, `uuid`,
`free`, `skip`, `wide`, `Xtra`, `xtra`, `smta`, `sefd`, `edts` (reported if it hides samples),
`tref`, `gmhd`, `tmcd`, `mebx`, `camm`, `gpmd`, `emsg`, `prft`, `sidx`, `moof`, `mfra`, `pssh`,
`sinf`, `pnot`, `PICT`, `load`, `clip`, `matt`, `tapt`, `covr`, `colr/prof`, `colr/rICC`.
Anything not on either list is reported as "unknown, removed" on input and is an audit failure
on output.

#### Matroska / WebM structural allowlist (output side)

```
EBML header: EBMLVersion, EBMLReadVersion, EBMLMaxIDLength, EBMLMaxSizeLength, DocType, DocTypeVersion, DocTypeReadVersion
Segment (known size)
  SeekHead / Seek / SeekID, SeekPosition        (regenerated)
  Info: TimestampScale, Duration, MuxingApp = "stoptrackingme", WritingApp = "stoptrackingme"
  Tracks / TrackEntry: TrackNumber, TrackUID (1, 2), TrackType, FlagEnabled, FlagDefault,
         FlagLacing, Language 'und', CodecID, CodecPrivate (rebuilt), DefaultDuration,
         CodecDelay, SeekPreRoll,
         Video: PixelWidth, PixelHeight, DisplayWidth, DisplayHeight, Colour (range, matrix, transfer, primaries only)
         Audio: SamplingFrequency, Channels, BitDepth
  Cluster: Timestamp, SimpleBlock | BlockGroup(Block, BlockDuration, ReferenceBlock)
  Cues / CuePoint: CueTime, CueTrackPositions(CueTrack, CueClusterPosition)   (regenerated)
```

Never written: `Tags`, `Attachments`, `Chapters`, `Void`, `CRC-32`, `Title`, `DateUTC`,
`SegmentUUID`, `PrevUUID`, `NextUUID`, `SegmentFilename`, `SegmentFamily`,
`ChapterTranslate`, track `Name`, `BlockAdditions`, `BlockAdditionMapping`,
`ContentEncodings`, unknown-size elements, EBML `Void`, any unknown ID.

## 5. Audit: proving the output is clean

The core audit (shipped in wasm) runs on the output blob, streaming:

1. **Box / element walk:** every box fourcc (or EBML ID) is on the allowlist **and** at an
   allowed parent path; sizes are consistent; no bytes after the last top-level element; no
   duplicate singletons.
2. **Field checks:** `mvhd`/`tkhd`/`mdhd` times are zero; `hdlr` names empty;
   `compressorname` zero; `ftyp` equals the canonical bytes; `dref` is self-contained;
   Matroska `MuxingApp`/`WritingApp` equal the constant; `TrackUID` equals the track number.
3. **Coverage check:** chunk offsets plus sample sizes cover `mdat` exactly, in order, with
   no gaps and no overlaps. This is what proves no hidden bytes survived inside `mdat`.
4. **Codec check:** walk every sample: length-prefixed NAL units must have sane lengths that
   exactly fill the sample, and every NAL type must be in the allowed set (H.264: 1, 5, 7, 8;
   HEVC: 0 to 31, 32, 33, 34). AV1: every OBU header type in {1, 2, 3, 4, 6, 7} with valid
   `obu_size`. `avcC`/`hvcC`/`av1C` contain only parameter sets (for `av1C`, the optional
   `configOBUs` must be only a sequence header).
5. **Signature sweep:** as a last net, scan the whole output for known magic strings that must
   never appear: `jumb`, `c2pa`, `<x:xmpmeta`, `x264 - core`, `Lavf`, `Lavc`, `com.apple.`,
   `com.android.`, `com.bytedance`, the XMP and C2PA UUIDs, `Exif\0\0`. A hit fails the audit.
   (Low false-positive risk because compressed media rarely contains these ASCII runs, but a
   hit inside a sample is still treated as a failure, in keeping with fail-closed.)

Cross-check tools for the test suite (developer machine and CI only, never shipped):

| Tool | Command | What it proves |
|---|---|---|
| ExifTool | `exiftool -a -G1 -ee3 -U out.mp4` | no QuickTime, XMP, Keys, ItemList or embedded timed metadata tags left ([QuickTime tags](https://exiftool.org/TagNames/QuickTime.html)) |
| ffprobe | `ffprobe -v error -show_format -show_streams -show_chapters out.mp4` | no `tags`, chapters or extra streams |
| ffmpeg trace | `ffmpeg -i out.mp4 -c copy -bsf:v trace_headers -f null -` | no SEI NAL units in the bitstream |
| MediaInfo | `mediainfo --Full out.mp4` | no "Writing library", "Encoded date", "Encoding settings" |
| Bento4 / GPAC | `mp4dump out.mp4`, `MP4Box -diso out.mp4` | box tree matches the allowlist |
| MKVToolNix | `mkvinfo -a out.webm` | no Tags, Attachments, Chapters, Void, DateUTC |
| c2patool | `c2patool out.mp4` | "no manifest found" |

A Playwright test should push real samples (iPhone HEVC with GPS, Pixel with C2PA, x264 file
from ffmpeg, Chrome MediaRecorder WebM, mkvmerge MKV with attachments, a file with a trimmed
edit list, an fMP4 file) through the app and assert both the in-app audit and the external
tools.

## 6. What cannot be removed locally, and honest UI wording

Cannot be removed by Layer 1 (and not guaranteed by any re-encode):

- **Invisible pixel and audio watermarks:** SynthID, Meta Video Seal, and commercial forensic
  watermarks (studio screeners, streaming session watermarks that encode an account ID). These
  are designed to survive compression, trimming and cropping.
- **Soft-binding lookups:** providers can match a video to their stored C2PA manifest or
  internal records by fingerprint, even after the file's manifest is gone.
- **Sensor fingerprints (PRNU):** the camera sensor's noise pattern survives average
  compression and can link videos to one device, though video stabilization and strong
  compression make it harder ([arXiv 1905.09611](https://arxiv.org/abs/1905.09611),
  [PMC review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10490695/)).
- **Encoder behaviour:** the GOP structure, quantization and SPS/PPS parameter choices of the
  original encoder still identify a device family or app after a remux.
- **What the video shows or says:** faces, landmarks, street signs, reflections, voices,
  background audio, on-screen timestamps, visible watermarks.
- **VP8/VP9 frame-internal trailing bytes and AAC fill data** in v1 (documented residual).

Proposed UI copy (house style, no dashes):

> We removed the hidden data in this video: location, device, dates, software names, unique IDs,
> and content credentials. We did not change the picture or the sound. That means invisible
> watermarks (such as Google SynthID) and the camera's own noise pattern can still be in there.
> Anything the video shows or says is still in the video.

Short badge: "Metadata removed. Picture and sound untouched."

## 7. Practical constraints for 100 MB in the browser

- **Memory:** do not read the file into one `ArrayBuffer`. Use `File.slice()` to read the
  header region and the `moov` (usually under 1 to 5 MB for 100 MB clips, estimate), then read
  samples in 4 to 16 MB windows. Build output as `new Blob(parts)`, which lets the browser keep
  parts on disk or in its blob store. Peak JS plus wasm heap then stays around 20 to 50 MB
  (estimate) instead of 200 to 300 MB for load-everything.
- **Non-fast-start files:** `moov` often sits at the end (camera output). `File.slice` gives
  random access, so read the top-level box headers first (8 or 16 bytes each), seek to `moov`.
- **Worker:** all of it runs in the existing sanitizer Worker; transfer chunk buffers with
  `postMessage(buf, [buf])` to avoid copies. The wasm core exposes a small streaming API
  (feed `moov`, get a sample plan, feed sample chunks, get output chunks, finalize, audit).
- **wasm32 memory:** 4 GB theoretical, but iOS Safari kills tabs far earlier and has had
  trouble with large `WebAssembly.Memory` maximums ([Godot issue](https://github.com/godotengine/godot/issues/70621),
  [emscripten issue](https://github.com/emscripten-core/emscripten/issues/19144)). Keep the
  heap small and growable, which the streaming design does.
- **No SharedArrayBuffer:** single-threaded wasm is enough for a remux (I/O bound). The current
  `public/_headers` sets COOP only; no `Cross-Origin-Embedder-Policy: require-corp` is needed.
  Adding COEP would only be necessary for threaded ffmpeg.wasm, which we avoid.
- **Time budget (estimate):** a 100 MB remux with NAL scanning is dominated by reading and
  copying bytes: roughly 1 to 3 s on a desktop, 3 to 10 s on a mid-range phone. The audit pass
  costs about the same again. Show progress by bytes processed.
- **iOS Safari quirks:** picking a video from the Photos library through `<input type=file>`
  may give a transcoded, "most compatible" copy, and iOS may already drop location depending on
  the share sheet options; the app must audit whatever it receives and not assume. Blob
  downloads with the `download` attribute work on current iOS but open a preview sheet. Test
  HEVC and Dolby Vision (iPhone default) files specifically: dropping Dolby Vision RPU NAL units
  (type 62) leaves the HEVC base layer playable for profile 8.4 files, but the `dvcC`/`dvvC`
  box must also go.
- **CSP:** the current meta CSP in `index.html` (`default-src 'self'; script-src 'self'; ...`)
  already runs the image wasm, so the video core needs no new script origins. One change is
  needed for a preview: `media-src` falls back to `default-src 'self'`, which blocks a
  `<video>` on a `blob:` URL, so add `media-src 'self' blob:`. `connect-src` stays locked.
  WebCodecs (Layer 2) needs no CSP changes.
- **Playback preview:** a `<video>` element on a `blob:` URL of the output lets the user check
  the result without network, and doubles as a sanity check that the file still decodes.

## 8. Recommended architecture for this repo

### 8.1 Choice

Extend `sanitize-core` with a strict, hand-written video path. Do not add ffmpeg.wasm. Use
mediabunny only later, and only for Layer 2 (WebCodecs re-encode) or as a dev-time cross-check.
Optionally use `mp4-atom` in `[dev-dependencies]` as an independent parser oracle in the
contract tests, so the shipped wasm stays small and fully ours.

Why hand-written: the existing core already follows "walker + allowlist + strip + audit" for
PNG, JPEG and WebP in about 900 lines. MP4 and EBML framing are just as simple. The hard,
security-relevant part is refusing the unknown, which general crates are designed not to do.

### 8.2 Module layout (mirrors the current files)

| New module | Role |
|---|---|
| `video/bmff_walk.rs` | strict box walker over byte windows: header, 64-bit sizes, parent path, bounds checks |
| `video/bmff_model.rs` | parse `moov` into a track model: codec config, sample sizes, offsets, durations, sync samples, composition offsets, edit list |
| `video/bmff_write.rs` | write canonical `ftyp` + `moov` (fast-start) + `mdat` from the model |
| `video/ebml_walk.rs`, `video/mkv_model.rs`, `video/mkv_write.rs` | same for Matroska/WebM |
| `video/nal.rs` | length-prefixed NAL splitter and filter for AVC and HEVC; `avcC`/`hvcC` rebuild |
| `video/obu.rs` | AV1 OBU splitter and filter; `av1C` rebuild |
| `allowlist.rs` (extended) | `MP4_TREE`, `MKV_TREE`, `AVC_NAL_OK`, `HEVC_NAL_OK`, `AV1_OBU_OK`, denylist names for reporting, magic-string sweep list |
| `audit.rs` (extended) | streaming output audit using only the allowlist and the output bytes |
| `lib.rs` | wasm-bindgen streaming API: `video_plan(header_bytes, moov_bytes) -> Plan`, `video_feed(chunk) -> out_chunk`, `video_finish() -> tail`, `video_audit_feed` / `video_audit_finish` |

Estimated added wasm: 60 to 150 KB after `opt-level = "s"` and LTO (estimate), against the
current 1.33 MB `sanitize_core_bg.wasm`.

### 8.3 Step list for a first shippable version (v0.7.0)

1. **Scope v1:** MP4/MOV with one H.264 or HEVC video track and at most one AAC or Opus audio
   track; WebM with VP8/VP9/AV1 plus Opus/Vorbis. Refuse fMP4, encrypted files, multiple video
   tracks, complex edit lists, MKV with `ContentEncodings`. Max 100 MB (guard in `guard.rs`).
2. **Input scan and report:** walk the input, list everything found by the denylist groups of
   section 3 (location, device, time, software, IDs, provenance, hidden content). The input
   "FAIL" stays normal, as with images.
3. **MP4 rebuild:** model from `moov`, drop non-AV tracks, apply the edit list by dropping
   hidden samples (only when it is a plain leading trim at a sync sample, otherwise refuse),
   filter NAL units per sample, rebuild `avcC`/`hvcC`, write fast-start output.
4. **WebM/MKV rebuild:** model from `Tracks` and `Cluster`s, rewrite `Info`, renumber
   `TrackUID`, regenerate `Cues` and `SeekHead`, filter AV1 OBUs, write `webm` DocType when
   codecs allow, else `matroska`.
5. **Output audit** as in section 5, sharing constants with the writer. Download only on pass.
6. **Worker plumbing:** stream with `File.slice`, transfer chunks, progress by bytes, output
   `Blob`, `<video>` preview.
7. **Tests:** Rust contract tests (every rebuilt file passes the audit; every fixture with
   metadata fails the input audit; malformed and fuzzed inputs fail closed without panics; a
   property test that the rebuilt samples, minus filtered NAL units, are byte-identical to the
   input samples); determinism test (same bytes in Chromium, Firefox, WebKit); no-network test
   extended to a video run; dev-only cross-checks with ExifTool, ffprobe, mkvinfo, c2patool.
8. **Docs and UI:** README table rows for MP4 and WebM (kept / removed), the honest-limits copy
   from section 6, and a roadmap line for Layer 2 re-encode.

### 8.4 Later (Layer 2 and beyond)

- Opt-in WebCodecs re-encode mode (resize, bitrate cap), clearly labelled "not bit-identical
  across browsers", same audit gate.
- Parse AAC raw data blocks to drop `FIL`/`DSE` elements.
- fMP4 support by defragmenting into the same canonical output.
- Optional audio removal toggle ("strip sound"), which also removes voice and background audio
  leaks.

## Sources

- C2PA Technical Specification 2.4: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html
- C2PA Implementation Guidance 2.4: https://spec.c2pa.org/specifications/specifications/2.4/guidance/Guidance.html
- C2PA box layout in video (Medium): https://medium.com/@sanilf1/c2pa-basics-accb96695b5b
- C2PA spec versions and formats: https://c2paviewer.com/articles/c2pa-spec-versions-file-formats
- OpenAI and Google C2PA plus SynthID (May 2026): https://c2paviewer.com/articles/openai-google-c2pa-synthid-2026
- Google security blog, Pixel C2PA: https://security.googleblog.com/2025/09/pixel-android-trusted-images-c2pa-content-credentials.html
- OpenAI, Launching Sora responsibly: https://openai.com/index/launching-sora-responsibly/
- EA Forum on Sora watermark consistency: https://forum.effectivealtruism.org/posts/oMJzXc79CexLqi52F/openai-does-not-appear-to-be-applying-watermarks-honestly
- SynthID overview (DataCamp): https://www.datacamp.com/tutorial/synthid
- Meta Video Seal paper: https://arxiv.org/abs/2412.09492
- Meta Video Seal (TechCrunch): https://techcrunch.com/2024/12/12/meta-releases-a-tool-for-watermarking-ai-generated-videos/
- TikTok AI transparency: https://newsroom.tiktok.com/en-us/partnering-with-our-industry-to-advance-ai-transparency-and-literacy
- TikTok metadata notes: https://metadatacleaner.app/blog/tiktok-ai-metadata-video-suppression/
- Apple QuickTime metadata: https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/Metadata/Metadata.html
- Apple QuickTime metadata keys: https://developer.apple.com/documentation/quicktime-file-format/quicktime_metadata_keys
- Apple ISO6709 key: https://developer.apple.com/documentation/avfoundation/avmetadatakey/quicktimemetadatakeylocationiso6709
- IPED issue on iPhone ISO6709: https://github.com/sepinf-inc/IPED/issues/2983
- Apple forum, VideoToolbox SEI UUID: https://developer.apple.com/forums/thread/778196
- ExifTool QuickTime tags: https://exiftool.org/TagNames/QuickTime.html
- ExifTool Samsung tags: https://exiftool.org/TagNames/Samsung.html
- Adobe XMP Specification Part 3: https://dl.photoprism.app/pdf/specifications/20120101-Adobe_XMP_Specification_Part_3.pdf
- RFC 9559 Matroska: https://datatracker.ietf.org/doc/rfc9559/
- Matroska elements: https://www.matroska.org/technical/elements.html
- AV1 bitstream spec: https://aomediacodec.github.io/av1-spec/
- AV1 HDR10+ metadata: https://aomediacodec.github.io/av1-hdr10plus/
- FFmpeg bitstream filters (filter_units, h264_metadata): https://manpages.debian.org/buster/ffmpeg/ffmpeg-bitstream-filters.1.en.html
- FFmpeg hvcC declarative SEI patch: https://patchwork.ffmpeg.org/patch/4731/
- x264 user data (doom9): https://forum.doom9.org/archive/index.php/t-146679.html
- ffmpeg.wasm sizes (32blog): https://32blog.com/en/ffmpeg/ffmpeg-wasm-browser-video
- ffmpeg.wasm SharedArrayBuffer issue: https://github.com/ffmpegwasm/ffmpeg.wasm/issues/234
- ffmpeg.wasm core license: https://github.com/ffmpegwasm/ffmpeg.wasm-core/blob/n4.3.1-wasm/LICENSE.md
- FFmpeg legal: https://www.ffmpeg.org/legal.html
- Mediabunny: https://mediabunny.dev/guide/introduction and https://github.com/Vanilagy/mediabunny
- Mediabunny conversion: https://mediabunny.dev/guide/converting-media-files
- mp4box.js: https://github.com/gpac/mp4box.js
- mp4-atom: https://crates.io/crates/mp4-atom
- mp4box (Rust): https://docs.rs/mp4box
- mp4parse-rust: https://github.com/mozilla/mp4parse-rust
- mp4 (Rust): https://docs.rs/mp4
- webm-iterable: https://docs.rs/webm-iterable/latest/webm_iterable/
- matroska-demuxer: https://docs.rs/matroska-demuxer
- WebCodecs support: https://caniuse.com/webcodecs and https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- iOS wasm memory (Godot): https://github.com/godotengine/godot/issues/70621
- iOS wasm memory (emscripten): https://github.com/emscripten-core/emscripten/issues/19144
- PRNU under H.264/H.265: https://arxiv.org/abs/1905.09611
- Video source identification review: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10490695/
