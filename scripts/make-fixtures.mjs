import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const OUT = "tests/fixtures";
const TMP = join(OUT, ".tmp");
const SIZE = "320x240";
const SECONDS = "2";
const WHEN = "2024-05-01T12:00:00Z";

const VIDEO_SRC = ["-f", "lavfi", "-i", `testsrc2=s=${SIZE}:r=25:d=${SECONDS}`];
const AUDIO_44K = ["-f", "lavfi", "-i", `sine=f=440:r=44100:d=${SECONDS}`];
const AUDIO_48K = ["-f", "lavfi", "-i", `sine=f=440:r=48000:d=${SECONDS}`];
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-threads", "1", "-pix_fmt", "yuv420p", "-flags:v", "+bitexact"];
const AAC = ["-c:a", "aac", "-b:a", "64k", "-flags:a", "+bitexact"];
const OPUS = ["-c:a", "libopus", "-b:a", "48k", "-flags:a", "+bitexact"];
const MUX_BITEXACT = ["-fflags", "+bitexact"];

function ffmpeg(args, out) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out], { stdio: "inherit" });
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
}

function uuidBytes(hex) {
  return Buffer.from(hex.replace(/-/g, ""), "hex");
}

const XMP_UUID = uuidBytes("BE7ACFCB-97A9-42E8-9C71-999491E3AFAC");
const C2PA_UUID = uuidBytes("D8FEC3D6-1B0E-483C-9297-5828877EC481");
const JUMBF_C2PA_TYPE = uuidBytes("63327061-0011-0010-8000-00AA00389B71");
const JUMBF_CLAIM_TYPE = uuidBytes("6332636C-0011-0010-8000-00AA00389B71");

const XMP_PACKET = Buffer.from(
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Adobe Premiere Pro 2024" xmp:CreateDate="2024-05-01T12:00:00Z"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
  "utf8",
);

function jumd(type, label) {
  return box("jumd", type, Buffer.from([0x03]), Buffer.from(label + "\0", "utf8"));
}

function c2paBox() {
  const claim = box("jumb", jumd(JUMBF_CLAIM_TYPE, "c2pa.claim"), box("json", Buffer.from('{"claim_generator":"Example Camera 1.0"}', "utf8")));
  const store = box("jumb", jumd(JUMBF_C2PA_TYPE, "c2pa"), claim);
  const head = Buffer.concat([C2PA_UUID, Buffer.from([0, 0, 0, 0]), Buffer.from("manifest\0", "latin1"), Buffer.alloc(8)]);
  return box("uuid", head, store);
}

function xmpBox() {
  return box("uuid", XMP_UUID, XMP_PACKET);
}

function build() {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_44K, "-map", "0:v", "-map", "1:a", ...X264, ...AAC,
      "-metadata", "location=+48.8583+002.2945/",
      "-metadata", "make=Apple",
      "-metadata", "model=iPhone 15 Pro",
      "-metadata", "comment=shot at home",
      "-metadata", "date=2024-05-01",
      "-metadata", `creation_time=${WHEN}`,
      "-f", "mov",
    ],
    join(OUT, "gps_x264_aac.mov"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, ...X264,
      "-movflags", "+use_metadata_tags",
      "-metadata", "com.apple.quicktime.location.ISO6709=+48.8583+002.2945+035.000/",
      "-metadata", "com.apple.quicktime.make=Apple",
      "-metadata", "com.apple.quicktime.model=iPhone 15 Pro",
      "-metadata", "com.apple.quicktime.software=17.4.1",
      "-metadata", "com.apple.quicktime.content.identifier=6F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D",
      "-metadata", "com.android.version=14",
      "-metadata", `creation_time=${WHEN}`,
      "-f", "mp4",
    ],
    join(OUT, "keys_x264.mp4"),
  );

  const base = join(TMP, "base.mp4");
  ffmpeg([...VIDEO_SRC, ...X264, "-metadata", `creation_time=${WHEN}`, "-f", "mp4"], base);
  const baseBytes = readFileSync(base);

  const trailer = Buffer.concat([xmpBox(), box("free", Buffer.from("hidden note: meet at the old bridge", "utf8")), Buffer.from("TRAILINGBYTES", "latin1")]);
  writeFileSync(join(OUT, "xmp_uuid_trailer.mp4"), Buffer.concat([baseBytes, trailer]));
  writeFileSync(join(OUT, "c2pa_like.mp4"), Buffer.concat([baseBytes, c2paBox()]));

  ffmpeg([...VIDEO_SRC, ...X264, "-metadata", `creation_time=${WHEN}`, "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"], join(OUT, "frag.mp4"));

  ffmpeg(["-ss", "0.52", "-i", base, "-c", "copy", "-t", "1", "-metadata", `creation_time=${WHEN}`, "-f", "mp4"], join(OUT, "trim_elst.mp4"));

  ffmpeg(
    [...VIDEO_SRC, "-map", "0:v", "-map", "0:v", ...X264, "-metadata", `creation_time=${WHEN}`, "-f", "mp4"],
    join(OUT, "two_video.mp4"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-x265-params", "pools=none:frame-threads=1:log-level=error", "-tag:v", "hvc1", "-flags:v", "+bitexact",
      "-metadata", `creation_time=${WHEN}`, "-f", "mp4",
    ],
    join(OUT, "hevc_x265.mp4"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_48K, "-map", "0:v", "-map", "1:a", ...X264, ...OPUS,
      "-metadata", `creation_time=${WHEN}`, "-f", "mp4",
    ],
    join(OUT, "opus_x264.mp4"),
  );

  const note = join(TMP, "note.txt");
  writeFileSync(note, "Private note attached to the video file.\n");
  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_44K, "-map", "0:v", "-map", "1:a", ...X264, ...AAC, ...MUX_BITEXACT,
      "-attach", note, "-metadata:s:t", "mimetype=text/plain", "-metadata:s:t", "filename=note.txt",
      "-metadata", "title=Family trip", "-metadata", `creation_time=${WHEN}`,
      "-f", "matroska",
    ],
    join(OUT, "mkv_attach.mkv"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_44K, "-map", "0:v", "-map", "1:a",
      "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "200k", "-threads", "1", "-flags:v", "+bitexact",
      "-c:a", "libvorbis", "-q:a", "2", "-flags:a", "+bitexact", ...MUX_BITEXACT,
      "-f", "webm",
    ],
    join(OUT, "vp8_vorbis.webm"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_48K, "-map", "0:v", "-map", "1:a",
      "-c:v", "libaom-av1", "-cpu-used", "8", "-row-mt", "0", "-threads", "1", "-b:v", "150k", "-flags:v", "+bitexact",
      ...OPUS, ...MUX_BITEXACT,
      "-f", "webm",
    ],
    join(OUT, "av1_opus.webm"),
  );

  ffmpeg(
    [
      ...VIDEO_SRC, ...AUDIO_48K, "-map", "0:v", "-map", "1:a",
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "200k", "-threads", "1", "-flags:v", "+bitexact",
      ...OPUS, ...MUX_BITEXACT,
      "-metadata", "title=Holiday at home", "-metadata", "artist=Jane Roe", "-metadata", `creation_time=${WHEN}`,
      "-reserve_index_space", "256",
      "-f", "webm",
    ],
    join(OUT, "vp9_opus_tags.webm"),
  );

  rmSync(TMP, { recursive: true, force: true });

  for (const f of readdirSync(OUT).sort()) {
    if (f.startsWith(".")) continue;
    const bytes = readFileSync(join(OUT, f));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    console.log(`${f.padEnd(24)} ${String(bytes.length).padStart(8)}  ${hash}`);
  }
}

build();
