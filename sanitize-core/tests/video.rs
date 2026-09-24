use sanitize_core::allowlist::{self as al, Group};
use sanitize_core::guard;
use sanitize_core::video::bmff_model::{self, parse_moov, Sample};
use sanitize_core::video::bmff_walk::read_box_header;
use sanitize_core::video::bmff_write::{bx, full};
use sanitize_core::video::ebml_walk::{self, elem, elem_uint, write_id, write_size_len};
use sanitize_core::video::mkv_model::{parse_cluster, VORBIS_EMPTY_COMMENT};
use sanitize_core::video::mkv_write;
use sanitize_core::video::nal::{self, NalKind};
use sanitize_core::video::obu;
use sanitize_core::video::planes::{self, PlaneFormat, PlaneOps};
use sanitize_core::video::vaudit::{plan_windows, Sweeper};
use sanitize_core::video::{Audit, Rebuild, RebuildOptions, VideoAuditSummary};

const REBUILDABLE: [&str; 10] = [
    "gps_x264_aac.mov",
    "keys_x264.mp4",
    "xmp_uuid_trailer.mp4",
    "c2pa_like.mp4",
    "hevc_x265.mp4",
    "opus_x264.mp4",
    "mkv_attach.mkv",
    "vp8_vorbis.webm",
    "av1_opus.webm",
    "vp9_opus_tags.webm",
];

const FORBIDDEN: [&[u8]; 8] =
    [b"x264 - core", b"x265 (build", b"Lavf", b"Lavc", b"<x:xmpmeta", b"c2pa", b"+48.8583", b"Mediabunny"];

fn fixture(name: &str) -> Vec<u8> {
    let p = format!("{}/../tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::read(&p).unwrap_or_else(|e| panic!("missing fixture {p}: {e}. Run npm run fixtures"))
}

fn serve_rebuild(bytes: &[u8], keep_audio: bool, window: u32) -> Result<Vec<u8>, String> {
    let mut r = Rebuild::open(bytes.len() as u64)?;
    r.set_options(RebuildOptions { keep_audio, window, container: None })?;
    let mut body = Vec::new();
    while let Some(q) = r.need() {
        let s = q.offset as usize;
        let slice = bytes.get(s..s + q.len as usize).ok_or("read past end")?;
        r.feed(q.offset, slice)?;
        body.extend(r.take_output());
    }
    if let Some(e) = r.error() {
        return Err(e.to_string());
    }
    let (head, tail) = r.finish()?;
    Ok([head, body, tail].concat())
}

fn rebuild(bytes: &[u8], keep_audio: bool) -> Vec<u8> {
    serve_rebuild(bytes, keep_audio, guard::DEFAULT_WINDOW_BYTES).unwrap()
}

fn serve_audit(bytes: &[u8], strict: bool, window: u32) -> VideoAuditSummary {
    let mut a = Audit::open(bytes.len() as u64, strict);
    a.set_window(window);
    while let Some(q) = a.need() {
        let s = q.offset as usize;
        a.feed(q.offset, &bytes[s..s + q.len as usize]).unwrap();
    }
    a.summary()
}

fn audit(bytes: &[u8], strict: bool) -> VideoAuditSummary {
    serve_audit(bytes, strict, guard::DEFAULT_WINDOW_BYTES)
}

fn contains(h: &[u8], n: &[u8]) -> bool {
    h.windows(n.len()).any(|w| w == n)
}

fn group<'a>(s: &'a VideoAuditSummary, g: &str) -> &'a [String] {
    s.groups.get(g).map(|v| v.as_slice()).unwrap_or(&[])
}

fn has_line(s: &VideoAuditSummary, g: &str, prefix: &str) -> bool {
    group(s, g).iter().any(|l| l.starts_with(prefix))
}

fn top_boxes(b: &[u8]) -> Vec<(String, usize, usize, usize)> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < b.len() {
        let h = read_box_header(&b[pos..], pos as u64, b.len() as u64).unwrap();
        out.push((h.name(), pos, pos + h.header_len as usize, h.end() as usize));
        pos = h.end() as usize;
    }
    out
}

fn moov_model(b: &[u8]) -> bmff_model::Mp4Model {
    let m = top_boxes(b).into_iter().find(|x| x.0 == "moov").unwrap();
    parse_moov(&b[m.2..m.3]).unwrap()
}

fn sample_bytes<'a>(b: &'a [u8], s: &Sample) -> &'a [u8] {
    &b[s.offset as usize..s.offset as usize + s.size as usize]
}

fn mkv_frames(b: &[u8], track: u64) -> Vec<Vec<u8>> {
    let top = ebml_walk::children(b).unwrap();
    let seg = top.iter().find(|e| e.id == al::MKV_SEGMENT).unwrap();
    let mut out = Vec::new();
    for c in ebml_walk::children(seg.data).unwrap().iter().filter(|e| e.id == al::MKV_CLUSTER) {
        for blk in parse_cluster(c.data).unwrap().blocks {
            if blk.track == track {
                out.push(blk.frame.to_vec());
            }
        }
    }
    out
}

fn segment_ids(b: &[u8]) -> Vec<u32> {
    let top = ebml_walk::children(b).unwrap();
    let seg = top.iter().find(|e| e.id == al::MKV_SEGMENT).unwrap();
    ebml_walk::children(seg.data).unwrap().iter().map(|e| e.id).collect()
}

#[test]
fn every_fixture_rebuilds_to_output_that_passes_strict_audit() {
    for name in REBUILDABLE {
        let input = fixture(name);
        for keep in [false, true] {
            let out = rebuild(&input, keep);
            let v = audit(&out, true);
            assert!(v.passed, "{name} keep={keep}: {:?}", v.issues);
            assert!(v.groups.is_empty(), "{name}: {:?}", v.groups);
            for n in FORBIDDEN {
                assert!(!contains(&out, n), "{name}: output still has {:?}", String::from_utf8_lossy(n));
            }
            if name.ends_with(".mp4") || name.ends_with(".mov") {
                let names: Vec<String> = top_boxes(&out).into_iter().map(|x| x.0).collect();
                assert_eq!(names, ["ftyp", "moov", "mdat"], "{name}");
                for t in [b"udta", b"meta", b"uuid", b"free", b"edts", b"elst", b"btrt", b"cslg"] {
                    assert!(!contains(&out, t), "{name}: {:?} left", String::from_utf8_lossy(t));
                }
            } else {
                let ids = segment_ids(&out);
                assert!(ids.iter().all(|i| [al::MKV_SEEKHEAD, al::MKV_INFO, al::MKV_TRACKS, al::MKV_CLUSTER, al::MKV_CUES].contains(i)));
                assert!(contains(&out, al::MKV_APP));
            }
        }
    }
}

#[test]
fn keep_audio_adds_a_sound_track_and_default_drops_it() {
    for name in ["gps_x264_aac.mov", "opus_x264.mp4"] {
        let input = fixture(name);
        let silent = moov_model(&rebuild(&input, false));
        assert_eq!(silent.tracks.len(), 1);
        let loud = moov_model(&rebuild(&input, true));
        assert_eq!(loud.tracks.len(), 2, "{name}");
        assert_eq!(&loud.tracks[1].handler, b"soun");
    }
    let opus = moov_model(&rebuild(&fixture("opus_x264.mp4"), true));
    assert_eq!(opus.tracks[1].fourcc, Some(*b"Opus"));
    assert!(matches!(opus.tracks[1].codec, bmff_model::Codec::Opus(_)));
    let webm = rebuild(&fixture("vp9_opus_tags.webm"), true);
    assert_eq!(mkv_frames(&webm, 2).len(), mkv_frames(&fixture("vp9_opus_tags.webm"), 2).len());
    assert!(mkv_frames(&rebuild(&fixture("vp9_opus_tags.webm"), false), 2).is_empty());
}

#[test]
fn input_audit_names_findings_by_group() {
    let mov = audit(&fixture("gps_x264_aac.mov"), false);
    assert!(!mov.passed);
    assert_eq!(mov.kind, "mp4");
    assert!(has_line(&mov, "Location", "\u{a9}xyz"), "{:?}", mov.groups);
    assert!(has_line(&mov, "Device", "\u{a9}mak"));
    assert!(has_line(&mov, "Device", "\u{a9}mod"));
    assert!(has_line(&mov, "Software", "\u{a9}swr"));
    assert!(has_line(&mov, "Software", "SEI user data (x264 build string)"));
    assert!(has_line(&mov, "Software", "hdlr name \"VideoHandler\""));
    assert!(has_line(&mov, "Time", "mvhd creation time"));
    assert!(has_line(&mov, "Hidden", "edts"));
    for m in ["\u{a9}xyz", "udta", "SEI"] {
        assert!(mov.markers.iter().any(|x| x == m), "marker {m} missing: {:?}", mov.markers);
    }
    assert_eq!(mov.tracks.len(), 2);

    let mp4 = audit(&fixture("xmp_uuid_trailer.mp4"), false);
    assert!(has_line(&mp4, "Software", "\u{a9}too"));
    assert!(has_line(&mp4, "Provenance", "uuid XMP packet"));
    assert!(has_line(&mp4, "Hidden", "Trailing bytes"));
    assert!(has_line(&mp4, "Hidden", "free"));

    let keys = audit(&fixture("keys_x264.mp4"), false);
    assert!(has_line(&keys, "Location", "com.apple.quicktime.location.ISO6709"));
    assert!(has_line(&keys, "Ids", "com.apple.quicktime.content.identifier"));
    assert!(has_line(&keys, "Device", "com.apple.quicktime.model"));

    let c2pa = audit(&fixture("c2pa_like.mp4"), false);
    assert!(has_line(&c2pa, "Provenance", "uuid C2PA manifest"));
    assert!(has_line(&c2pa, "Provenance", "C2PA JUMBF box"));

    let hevc = audit(&fixture("hevc_x265.mp4"), false);
    assert!(has_line(&hevc, "Software", "hvcC SEI user data (x265 build string)"));

    let webm = audit(&fixture("vp9_opus_tags.webm"), false);
    assert_eq!(webm.kind, "webm");
    assert!(has_line(&webm, "Software", "Tags"), "{:?}", webm.groups);
    assert!(group(&webm, "Software").iter().any(|l| l.contains("ARTIST")));
    assert!(has_line(&webm, "Time", "DateUTC"));
    assert!(has_line(&webm, "Ids", "Title"));
    assert!(has_line(&webm, "Hidden", "Void"));
    assert!(has_line(&webm, "Software", "MuxingApp"));

    let mkv = audit(&fixture("mkv_attach.mkv"), false);
    assert_eq!(mkv.kind, "mkv");
    assert!(group(&mkv, "Hidden").iter().any(|l| l.starts_with("Attachments") && l.contains("note.txt")));
    assert!(has_line(&mkv, "Software", "SEI user data (x264 build string)"));

    let vorbis = audit(&fixture("vp8_vorbis.webm"), false);
    assert!(has_line(&vorbis, "Software", "Vorbis vendor"));
}

#[test]
fn input_audit_reports_refusals_as_issues() {
    for (name, needle) in [
        ("frag.mp4", "Fragmented"),
        ("trim_elst.mp4", "Edit list hides the first"),
        ("two_video.mp4", "More than one video track"),
    ] {
        let s = audit(&fixture(name), false);
        assert!(!s.passed);
        assert!(s.issues.iter().any(|i| i.starts_with("Cannot clean") && i.contains(needle)), "{name}: {:?}", s.issues);
    }
}

#[test]
fn rebuild_is_idempotent_and_window_independent() {
    for name in REBUILDABLE {
        let input = fixture(name);
        for keep in [false, true] {
            let once = rebuild(&input, keep);
            let twice = rebuild(&once, keep);
            assert_eq!(once, twice, "{name} keep={keep}: rebuild of clean output must be a no-op");
            let small = serve_rebuild(&input, keep, guard::MIN_WINDOW_BYTES).unwrap();
            assert_eq!(once, small, "{name}: output depends on the window size");
        }
    }
}

#[test]
fn mp4_samples_preserved_modulo_filtered_nals() {
    for name in ["gps_x264_aac.mov", "keys_x264.mp4", "hevc_x265.mp4", "opus_x264.mp4"] {
        let input = fixture(name);
        let out = rebuild(&input, true);
        let mi = moov_model(&input);
        let mo = moov_model(&out);
        let vi = mi.video_index().unwrap();
        let (kind, ls) = match &mi.tracks[vi].codec {
            bmff_model::Codec::Avc(c) => (NalKind::Avc, c.len_size),
            bmff_model::Codec::Hevc(c) => (NalKind::Hevc, c.len_size()),
            _ => unreachable!(),
        };
        let (ti, to) = (&mi.tracks[vi], &mo.tracks[0]);
        assert_eq!(ti.samples.len(), to.samples.len());
        let mut dropped = 0;
        for (a, b) in ti.samples.iter().zip(&to.samples) {
            let mut want = Vec::new();
            dropped += nal::filter_nals(kind, sample_bytes(&input, a), ls, &mut want).unwrap().dropped.len();
            assert_eq!(want, sample_bytes(&out, b), "{name}: video sample changed beyond NAL filtering");
            assert_eq!((a.dur, a.cts, a.sync), (b.dur, b.cts, b.sync));
        }
        if kind == NalKind::Avc {
            assert!(dropped >= 1, "{name}: the x264 SEI should have been dropped");
        }
        if let Some(ai) = mi.audio_index() {
            for (a, b) in mi.tracks[ai].samples.iter().zip(&mo.tracks[1].samples) {
                assert_eq!(sample_bytes(&input, a), sample_bytes(&out, b), "{name}: audio sample changed");
            }
            assert_eq!(mi.tracks[ai].samples.len(), mo.tracks[1].samples.len());
        }
    }
}

#[test]
fn mkv_frames_preserved_modulo_filtered_units() {
    for (name, codec) in [("mkv_attach.mkv", "avc"), ("av1_opus.webm", "av1"), ("vp9_opus_tags.webm", "plain"), ("vp8_vorbis.webm", "plain")] {
        let input = fixture(name);
        let out = rebuild(&input, true);
        let fi = mkv_frames(&input, 1);
        let fo = mkv_frames(&out, 1);
        assert_eq!(fi.len(), fo.len(), "{name}");
        for (a, b) in fi.iter().zip(&fo) {
            let mut want = Vec::new();
            match codec {
                "avc" => {
                    nal::filter_avc(a, 4, &mut want).unwrap();
                }
                "av1" => {
                    obu::filter_av1(a, &mut want).unwrap();
                }
                _ => want = a.clone(),
            }
            assert_eq!(&want, b, "{name}");
        }
        assert_eq!(mkv_frames(&input, 2), mkv_frames(&out, 2), "{name}: audio frames changed");
    }
}

#[test]
fn webm_output_is_canonical() {
    let out = rebuild(&fixture("vp8_vorbis.webm"), true);
    assert!(contains(&out, VORBIS_EMPTY_COMMENT));
    assert!(!contains(&out, b"Xiph.Org"));
    assert!(!contains(&out, b"ENCODER"));
    let mkv = rebuild(&fixture("mkv_attach.mkv"), true);
    assert!(contains(&mkv, b"matroska"));
    assert!(!contains(&mkv, b"note.txt"));
    assert!(!contains(&mkv, b"Family trip"));
    let vp9 = rebuild(&fixture("vp9_opus_tags.webm"), false);
    assert!(contains(&vp9, b"webm"));
    for n in [&b"Holiday"[..], b"Jane Roe", b"DURATION"] {
        assert!(!contains(&vp9, n));
    }
    let ids = segment_ids(&vp9);
    assert_eq!(&ids[..3], &[al::MKV_SEEKHEAD, al::MKV_INFO, al::MKV_TRACKS]);
    assert_eq!(*ids.last().unwrap(), al::MKV_CUES);
}

#[test]
fn plan_json_describes_the_job() {
    let bytes = fixture("gps_x264_aac.mov");
    let mut r = Rebuild::open(bytes.len() as u64).unwrap();
    assert_eq!(r.plan_json(), "null");
    while r.phase().as_str() != "ready" {
        let q = r.need().unwrap();
        r.feed(q.offset, &bytes[q.offset as usize..(q.offset + q.len as u64) as usize]).unwrap();
    }
    let plan: serde_json::Value = serde_json::from_str(&r.plan_json()).unwrap();
    assert_eq!(plan["container"], "mp4");
    assert_eq!(plan["video"]["codec"], "avc1");
    assert_eq!(plan["video"]["width"], 320);
    assert_eq!(plan["audio"]["codec"], "mp4a");
    assert_eq!(plan["keepAudio"], false);
    assert!(r.set_options_json(r#"{"outContainer":"video/webm"}"#).is_err());
    assert!(r.set_options_json(r#"{"outContainer":"ogg"}"#).is_err());
    r.set_options_json(r#"{"keepAudio":true,"outContainer":"video/mp4"}"#).unwrap();
    let mut body = Vec::new();
    while let Some(q) = r.need() {
        r.feed(q.offset, &bytes[q.offset as usize..(q.offset + q.len as u64) as usize]).unwrap();
        body.extend(r.take_output());
    }
    assert!(r.set_options_json("{}").is_err());
    let (h, t) = r.finish().unwrap();
    assert!(r.finish().is_err());
    assert_eq!(moov_model(&[h, body, t].concat()).tracks.len(), 2);

    let webm = fixture("mkv_attach.mkv");
    let mut early = Rebuild::open(webm.len() as u64).unwrap();
    early.set_options_json(r#"{"outContainer":"video/mp4"}"#).unwrap();
    let mut failed = false;
    while let Some(q) = early.need() {
        if early.feed(q.offset, &webm[q.offset as usize..(q.offset + q.len as u64) as usize]).is_err() {
            failed = true;
            break;
        }
    }
    assert!(failed || early.error().is_some(), "an MKV input cannot be remuxed into MP4");
    assert!(early.error().unwrap_or_default().contains("keeps the input container"));
    let mut r = Rebuild::open(webm.len() as u64).unwrap();
    while r.phase().as_str() != "ready" {
        let q = r.need().unwrap();
        r.feed(q.offset, &webm[q.offset as usize..(q.offset + q.len as u64) as usize]).unwrap();
    }
    let plan: serde_json::Value = serde_json::from_str(&r.plan_json()).unwrap();
    assert_eq!(plan["container"], "mkv");
    assert_eq!(plan["docType"], "matroska");
    assert_eq!(plan["video"]["codec"], "V_MPEG4/ISO/AVC");
}

#[test]
fn protocol_misuse_fails_closed() {
    let bytes = fixture("keys_x264.mp4");
    let mut r = Rebuild::open(bytes.len() as u64).unwrap();
    let q = r.need().unwrap();
    assert!(r.feed(q.offset + 1, &bytes[1..1 + q.len as usize]).is_err());
    assert_eq!(r.phase().as_str(), "error");
    assert!(r.need().is_none());
    assert!(r.finish().is_err());

    let mut r = Rebuild::open(bytes.len() as u64).unwrap();
    while let Some(q) = r.need() {
        r.feed(q.offset, &bytes[q.offset as usize..(q.offset + q.len as u64) as usize]).unwrap();
    }
    assert!(r.finish().is_err(), "undrained output must block finish");
    assert!(!r.take_output().is_empty());
    assert!(r.finish().is_ok());

    assert!(Rebuild::open(guard::MAX_VIDEO_BYTES + 1).is_err());
    let big = Audit::open(guard::MAX_VIDEO_BYTES + 1, false);
    assert!(!big.summary().passed);
    assert!(Rebuild::open(4).is_err());
}

#[test]
fn refusals() {
    let refuse = |b: &[u8], needle: &str| {
        let e = serve_rebuild(b, true, guard::DEFAULT_WINDOW_BYTES).unwrap_err();
        assert!(e.contains(needle), "expected {needle:?}, got {e:?}");
    };
    refuse(&fixture("frag.mp4"), "Fragmented");
    refuse(&fixture("two_video.mp4"), "More than one video track");
    refuse(&fixture("trim_elst.mp4"), "Edit list");

    let mut enc = fixture("keys_x264.mp4");
    let stsd = enc.windows(4).position(|w| w == b"stsd").unwrap();
    let at = stsd + enc[stsd..].windows(4).position(|w| w == b"avc1").unwrap();
    enc[at..at + 4].copy_from_slice(b"encv");
    refuse(&enc, "Encrypted");

    let mut unknown = fixture("vp9_opus_tags.webm");
    let seg = unknown.windows(4).position(|w| w == [0x18, 0x53, 0x80, 0x67]).unwrap();
    unknown[seg + 4..seg + 12].copy_from_slice(&[0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    refuse(&unknown, "Unknown-size");
    assert!(audit(&unknown, false).issues.iter().any(|i| i.contains("Unknown-size")));

    refuse(&synthetic_mkv(true, false), "ContentEncodings");
    refuse(&synthetic_mkv(false, true), "Laced");
    assert!(serve_rebuild(&synthetic_mkv(false, false), false, 65536).is_ok());
    assert!(audit(&synthetic_mkv(false, true), false).issues.iter().any(|i| i.contains("Laced")));

    refuse(b"\x00\x00\x00\x10ftypisom\x00\x00\x02\x00junkjunkjunk", "moov");
    refuse(b"RIFF\x00\x00\x00\x00WEBPVP8 junk", "Not an MP4");

    assert!(guard::check_video_dims(8193, 100).is_err());
    assert!(guard::check_video_dims(1920, 1080).is_ok());
    assert!(guard::check_duration(601.0).is_err());
}

fn synthetic_mkv(content_encodings: bool, laced: bool) -> Vec<u8> {
    let mut te = Vec::new();
    elem_uint(&mut te, al::MKV_TRACKNUMBER, 1);
    elem_uint(&mut te, al::MKV_TRACKUID, 77);
    elem_uint(&mut te, al::MKV_TRACKTYPE, 1);
    elem(&mut te, al::MKV_CODECID, b"V_VP9");
    let mut v = Vec::new();
    elem_uint(&mut v, al::MKV_PIXELWIDTH, 64);
    elem_uint(&mut v, al::MKV_PIXELHEIGHT, 48);
    elem(&mut te, al::MKV_VIDEO, &v);
    if content_encodings {
        elem(&mut te, al::MKV_CONTENTENCODINGS, &[0x62, 0x40, 0x80]);
    }
    let mut tracks = Vec::new();
    elem(&mut tracks, al::MKV_TRACKENTRY, &te);
    let mut info = Vec::new();
    elem_uint(&mut info, al::MKV_TIMESTAMPSCALE, 1_000_000);
    elem(&mut info, al::MKV_MUXINGAPP, b"SyntheticMux");
    elem(&mut info, al::MKV_WRITINGAPP, b"SyntheticMux");
    let mut cl = Vec::new();
    elem_uint(&mut cl, al::MKV_TIMESTAMP, 0);
    for i in 0..3u8 {
        let flags = if laced { 0x82 } else { 0x80 };
        let mut blk = vec![0x81, 0, i * 40, flags];
        blk.extend_from_slice(&[0x55; 32]);
        elem(&mut cl, al::MKV_SIMPLEBLOCK, &blk);
    }
    let mut seg = Vec::new();
    elem(&mut seg, al::MKV_INFO, &info);
    elem(&mut seg, al::MKV_TRACKS, &tracks);
    elem(&mut seg, al::MKV_CLUSTER, &cl);
    let mut out = mkv_write::ebml_header("webm");
    write_id(&mut out, al::MKV_SEGMENT);
    write_size_len(&mut out, seg.len() as u64, 8);
    out.extend_from_slice(&seg);
    out
}

#[test]
fn coverage_check_detects_spliced_mdat_bytes() {
    let out = rebuild(&fixture("keys_x264.mp4"), false);
    assert!(audit(&out, true).passed);
    let mdat = top_boxes(&out).into_iter().find(|x| x.0 == "mdat").unwrap();
    let mut spliced = out.clone();
    let size = u32::from_be_bytes([out[mdat.1], out[mdat.1 + 1], out[mdat.1 + 2], out[mdat.1 + 3]]) + 16;
    spliced[mdat.1..mdat.1 + 4].copy_from_slice(&size.to_be_bytes());
    spliced.extend_from_slice(b"hidden payload!!");
    let v = audit(&spliced, true);
    assert!(!v.passed);
    assert!(v.issues.iter().any(|i| i.contains("cover mdat exactly")), "{:?}", v.issues);
    let lenient = audit(&spliced, false);
    assert!(has_line(&lenient, "Hidden", "mdat 16 bytes not used"));
    let redo = rebuild(&spliced, false);
    assert_eq!(redo, out, "the rebuild must drop unreferenced mdat bytes");

    let mut appended = out.clone();
    appended.extend_from_slice(b"\x00\x00\x00\x10free12345678");
    assert!(!audit(&appended, true).passed);
}

#[test]
fn magic_sweep_finds_patterns_across_every_split_point() {
    let needle = b"x264 - core";
    for split in 0..=needle.len() + 2 {
        let mut data = [0u8; 64];
        data[20..20 + needle.len()].copy_from_slice(needle);
        let cut = 20 + split.min(needle.len() + 1);
        let mut s = Sweeper::new();
        s.feed(0, &data[..cut]);
        s.feed(cut as u64, &data[cut..]);
        let hits: Vec<_> = s.hits.iter().filter(|(i, _)| al::MAGIC_SWEEP[*i].0 == needle).collect();
        assert_eq!(hits.len(), 1, "split {split}: {:?}", s.hits);
        assert_eq!(hits[0].1, 20);
    }
    let mut s = Sweeper::new();
    let data = b"..<x:xmpmeta..";
    for (i, b) in data.iter().enumerate() {
        s.feed(i as u64, std::slice::from_ref(b));
    }
    assert_eq!(s.hits.len(), 1);
}

#[test]
fn magic_sweep_crosses_audit_window_boundaries() {
    let clean = rebuild(&fixture("keys_x264.mp4"), false);
    let mut file = clean.clone();
    let pad = 20_000usize;
    file.extend_from_slice(&((pad + 8) as u32).to_be_bytes());
    file.extend_from_slice(b"free");
    file.extend(std::iter::repeat_n(0u8, pad));
    let window = guard::MIN_WINDOW_BYTES;
    let mut probe = Audit::open(file.len() as u64, false);
    probe.set_window(window);
    while let Some(q) = probe.need() {
        let s = q.offset as usize;
        probe.feed(q.offset, &file[s..s + q.len as usize]).unwrap();
    }
    let free_start = clean.len() + 8;
    let units: Vec<(u64, u64)> = Vec::new();
    let _ = plan_windows(file.len() as u64, window, &units);
    let boundary = probe
        .windows()
        .iter()
        .map(|w| w.1 as usize)
        .find(|&e| e > free_start + 16 && e < file.len() - 16)
        .unwrap();
    let needle = b"<x:xmpmeta";
    file[boundary - 4..boundary - 4 + needle.len()].copy_from_slice(needle);
    let s = serve_audit(&file, false, window);
    assert!(has_line(&s, "Provenance", "XMP packet bytes found"), "{:?}", s.groups);
    let strict = serve_audit(&file, true, window);
    assert!(strict.issues.iter().any(|i| i.contains("Forbidden byte pattern (XMP packet)")));
}

#[test]
fn malformed_corpus_never_panics() {
    let mut corpus: Vec<Vec<u8>> = vec![
        vec![],
        vec![0u8; 64],
        b"\x00\x00\x00\x08ftyp".to_vec(),
        vec![0x1A, 0x45, 0xDF, 0xA3],
        vec![0x1A, 0x45, 0xDF, 0xA3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xFF],
        b"\x00\x00\x00\x01moov\xff\xff\xff\xff\xff\xff\xff\xff".to_vec(),
        b"\x00\x00\x00\x00moov".to_vec(),
    ];
    for name in ["keys_x264.mp4", "gps_x264_aac.mov", "vp9_opus_tags.webm", "av1_opus.webm", "hevc_x265.mp4"] {
        let good = fixture(name);
        for cut in [9, 40, good.len() / 3, good.len() / 2, good.len() - 5] {
            corpus.push(good[..cut].to_vec());
        }
        let moov_or_head = if name.ends_with("webm") { 0 } else { top_boxes(&good).iter().find(|x| x.0 == "moov").unwrap().1 };
        let region = if name.ends_with("webm") { 0..600 } else { moov_or_head..good.len().min(moov_or_head + 1600) };
        for (k, i) in region.step_by(7).enumerate() {
            let mut m = good.clone();
            m[i] ^= [0xff, 0x80, 0x01, 0x7f][k % 4];
            corpus.push(m);
        }
        for i in (0..good.len()).step_by(997) {
            let mut m = good.clone();
            m[i] = m[i].wrapping_add(1);
            corpus.push(m);
        }
    }
    for bytes in &corpus {
        if bytes.len() < 8 {
            assert!(Rebuild::open(bytes.len() as u64).is_err());
        }
        let _ = audit_or_skip(bytes, false);
        let _ = audit_or_skip(bytes, true);
        if let Ok(out) = serve_rebuild(bytes, true, 65536) {
            let v = audit(&out, true);
            assert!(v.passed, "rebuild produced output that fails its own audit: {:?}", v.issues);
        }
    }
}

fn audit_or_skip(bytes: &[u8], strict: bool) -> VideoAuditSummary {
    let mut a = Audit::open(bytes.len() as u64, strict);
    while let Some(q) = a.need() {
        let s = q.offset as usize;
        if a.feed(q.offset, &bytes[s..s + q.len as usize]).is_err() {
            break;
        }
    }
    let s = a.summary();
    if !bytes.is_empty() && strict {
        assert!(!s.passed || s.byte_length > 0);
    }
    s
}

fn lp(nals: &[&[u8]]) -> Vec<u8> {
    let mut o = Vec::new();
    for n in nals {
        o.extend_from_slice(&(n.len() as u32).to_be_bytes());
        o.extend_from_slice(n);
    }
    o
}

#[test]
fn avc_nal_filter_keeps_only_picture_and_parameter_sets() {
    let sei: &[u8] = b"\x06\x05\x10x264 - core 164 options";
    let aud: &[u8] = &[0x09, 0xf0];
    let filler: &[u8] = &[0x0c, 0xff, 0xff];
    let sps: &[u8] = &[0x67, 0x64, 0x00, 0x1f, 0xac];
    let pps: &[u8] = &[0x68, 0xee, 0x3c, 0x80];
    let idr: &[u8] = &[0x65, 0x88, 0x84, 0x00];
    let slice: &[u8] = &[0x41, 0x9a, 0x02];
    let sample = lp(&[aud, sei, sps, pps, idr, filler, slice]);
    let mut out = Vec::new();
    let stats = nal::filter_avc(&sample, 4, &mut out).unwrap();
    assert_eq!(out, lp(&[sps, pps, idr, slice]));
    assert_eq!(stats.dropped, vec![9, 6, 12]);
    let f = nal::nal_findings(NalKind::Avc, &sample, 4).unwrap();
    assert!(f.iter().any(|x| x.line() == "SEI user data (x264 build string)" && x.group == Group::Software));
    assert!(nal::filter_avc(&lp(&[sei]), 4, &mut Vec::new()).is_err());
    assert!(nal::filter_avc(&[0, 0, 0, 9, 0x65], 4, &mut Vec::new()).is_err());
    assert!(nal::filter_avc(&[0, 0, 0, 0], 4, &mut Vec::new()).is_err());
    assert!(nal::filter_avc(&lp(&[&[0x85, 1]]), 4, &mut Vec::new()).is_err());
    let two = {
        let mut o = Vec::new();
        for n in [idr, sei] {
            o.extend_from_slice(&(n.len() as u16).to_be_bytes());
            o.extend_from_slice(n);
        }
        o
    };
    let mut out2 = Vec::new();
    nal::filter_avc(&two, 2, &mut out2).unwrap();
    assert_eq!(out2, [&[0u8, 4][..], idr].concat());
}

#[test]
fn hevc_nal_filter_drops_sei_aud_filler_and_unspecified() {
    let mk = |t: u8| vec![t << 1, 1, 0xaa];
    let types = [0u8, 1, 19, 21, 32, 33, 34, 35, 38, 39, 40, 48, 62];
    let nals: Vec<Vec<u8>> = types.iter().map(|&t| mk(t)).collect();
    let refs: Vec<&[u8]> = nals.iter().map(|v| v.as_slice()).collect();
    let mut out = Vec::new();
    let stats = nal::filter_hevc(&lp(&refs), 4, &mut out).unwrap();
    assert_eq!(stats.dropped, vec![35, 38, 39, 40, 48, 62]);
    let kept: Vec<&[u8]> = refs.iter().copied().filter(|n| (n[0] >> 1) <= 34).collect();
    assert_eq!(out, lp(&kept));
}

fn avcc_bytes(sps: &[&[u8]], pps: &[&[u8]], reserved: bool, ext: Option<[u8; 4]>) -> Vec<u8> {
    let s0 = sps[0];
    let mut o = vec![1, s0[1], s0[2], s0[3], if reserved { 0xff } else { 0x03 }, (if reserved { 0xe0 } else { 0 }) | sps.len() as u8];
    for s in sps {
        o.extend_from_slice(&(s.len() as u16).to_be_bytes());
        o.extend_from_slice(s);
    }
    o.push(pps.len() as u8);
    for p in pps {
        o.extend_from_slice(&(p.len() as u16).to_be_bytes());
        o.extend_from_slice(p);
    }
    if let Some(e) = ext {
        o.extend_from_slice(&e);
    }
    o
}

const HIGH_SPS: &[u8] = &[0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0xc0, 0x44];
const HIGH_PPS: &[u8] = &[0x68, 0xeb, 0xec, 0xb2, 0x2c];

#[test]
fn avcc_rebuild_keeps_only_sps_and_pps() {
    let sps_ext: &[u8] = &[0x6d, 0x01];
    let mut b = avcc_bytes(&[HIGH_SPS], &[HIGH_PPS], true, None);
    b.extend_from_slice(&[0xfd, 0xf8, 0xf8, 1]);
    b.extend_from_slice(&(sps_ext.len() as u16).to_be_bytes());
    b.extend_from_slice(sps_ext);
    let cfg = nal::parse_avcc(&b).unwrap();
    assert!(!cfg.dropped.is_empty());
    let clean = nal::rebuild_avcc(&b).unwrap();
    assert_eq!(clean, avcc_bytes(&[HIGH_SPS], &[HIGH_PPS], true, Some([0xfd, 0xf8, 0xf8, 0])));
    assert!(nal::avcc_canonical(&clean).is_ok());
    assert!(nal::avcc_canonical(&b).is_err());
    let with_sei = avcc_bytes(&[HIGH_SPS, b"\x06\x05x264 - core"], &[HIGH_PPS], true, None);
    let c = nal::parse_avcc(&with_sei).unwrap();
    assert_eq!(c.sps.len(), 1);
    assert!(c.dropped.iter().any(|f| f.text.contains("x264")));
    assert!(nal::parse_avcc(&[1, 0x64, 0, 0x28, 0xff, 0xe0, 0]).is_err());
}

#[test]
fn firefox_avcc_is_repaired_and_inband_parameter_sets_win() {
    let doubled_sps = [&[0x67u8][..], HIGH_SPS].concat();
    let doubled_pps = [&[0x68u8][..], HIGH_PPS].concat();
    let firefox = avcc_bytes(&[&doubled_sps], &[&doubled_pps], false, None);
    let cfg = nal::parse_avcc(&firefox).unwrap();
    let want = avcc_bytes(&[HIGH_SPS], &[HIGH_PPS], true, Some([0xfd, 0xf8, 0xf8, 0]));
    let repaired = nal::build_avcc(&cfg, &[], &[]).unwrap();
    assert_eq!(repaired, want);
    assert!(nal::avcc_canonical(&repaired).is_ok());
    let inband = nal::build_avcc(&cfg, &[HIGH_SPS.to_vec()], &[HIGH_PPS.to_vec()]).unwrap();
    assert_eq!(inband, want);
    assert_eq!(nal::sps_high_ext(HIGH_SPS), Some([1, 0, 0]));
    let base_sps: &[u8] = &[0x67, 0x42, 0xc0, 0x1e, 0x95];
    let base = nal::build_avcc(&nal::parse_avcc(&avcc_bytes(&[base_sps], &[HIGH_PPS], true, None)).unwrap(), &[], &[]).unwrap();
    assert!(nal::avcc_canonical(&base).is_ok());
    assert_eq!(base.len(), 6 + 2 + base_sps.len() + 1 + 2 + HIGH_PPS.len());
}

#[test]
fn hvcc_rebuild_keeps_parameter_set_arrays_only() {
    let mut b = vec![1u8];
    b.extend_from_slice(&[0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 0x5d, 0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f]);
    let arr = |t: u8, nal: &[u8]| {
        let mut o = vec![0x80 | t, 0, 1];
        o.extend_from_slice(&(nal.len() as u16).to_be_bytes());
        o.extend_from_slice(nal);
        o
    };
    let vps = [32 << 1, 1, 0x0c];
    let sps = [33 << 1, 1, 0x01];
    let pps = [34 << 1, 1, 0xc1];
    let sei = [&[39u8 << 1, 1][..], b"\x05x265 (build 199)"].concat();
    let mut dirty = b.clone();
    dirty.push(4);
    for a in [arr(32, &vps), arr(33, &sps), arr(34, &pps), arr(39, &sei)] {
        dirty.extend(a);
    }
    let cfg = nal::parse_hvcc(&dirty).unwrap();
    assert_eq!(cfg.arrays.len(), 3);
    assert!(cfg.dropped.iter().any(|f| f.line() == "hvcC SEI user data (x265 build string)"));
    let clean = nal::rebuild_hvcc(&dirty).unwrap();
    let mut want = b.clone();
    want.push(3);
    for a in [arr(32, &vps), arr(33, &sps), arr(34, &pps)] {
        want.extend(a);
    }
    assert_eq!(clean, want);
    assert_eq!(cfg.len_size(), 4);
    let mut missing = b.clone();
    missing.push(1);
    missing.extend(arr(32, &vps));
    assert!(nal::parse_hvcc(&missing).is_err());
}

fn obu(t: u8, payload: &[u8]) -> Vec<u8> {
    let mut o = vec![(t << 3) | 0x02, payload.len() as u8];
    o.extend_from_slice(payload);
    o
}

#[test]
fn av1_obu_filter_and_av1c_rebuild() {
    let td = obu(2, &[]);
    let seq = obu(1, &[0x00, 0x00, 0x00, 0x02, 0xaf]);
    let meta = obu(5, b"\x04HDR10+ or vendor");
    let frame = obu(6, &[0x10, 0x20, 0x30]);
    let pad = obu(15, &[0; 8]);
    let tile = obu(8, &[1, 2]);
    let sample = [td.clone(), seq.clone(), meta.clone(), frame.clone(), pad.clone(), tile].concat();
    let mut out = Vec::new();
    let st = obu::filter_av1(&sample, &mut out).unwrap();
    assert_eq!(out, [td, seq.clone(), frame.clone()].concat());
    assert_eq!(st.dropped, vec![5, 15, 8]);
    assert_eq!(obu::av1_findings(&sample).unwrap().len(), 3);
    let mut ext = vec![(6 << 3) | 0x06, 0x08, 3];
    ext.extend_from_slice(&[9, 9, 9]);
    let mut out = Vec::new();
    obu::filter_av1(&ext, &mut out).unwrap();
    assert_eq!(out, ext);
    let no_size = [frame.clone(), vec![6 << 3, 1, 2, 3]].concat();
    assert_eq!(obu::split_obus(&no_size).unwrap().len(), 2);
    assert!(obu::split_obus(&[0x80 | (6 << 3) | 2, 0]).is_err());
    assert!(obu::split_obus(&[(6 << 3) | 2, 9, 1]).is_err());
    assert!(obu::filter_av1(&meta, &mut Vec::new()).is_err());

    let av1c = [vec![0x81, 0x00, 0x0c, 0x00], seq.clone(), meta.clone()].concat();
    let c = obu::parse_av1c(&av1c).unwrap();
    assert_eq!(c.dropped.len(), 1);
    assert_eq!(obu::rebuild_av1c(&av1c).unwrap(), [vec![0x81, 0x00, 0x0c, 0x00], seq].concat());
    assert!(obu::parse_av1c(&[0x01, 0, 0, 0]).is_err());
}

fn i420(w: u32, h: u32) -> Vec<u8> {
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    let mut v = Vec::new();
    for y in 0..h {
        for x in 0..w {
            v.push(((x * 3 + y * 5) % 220 + 16) as u8);
        }
    }
    for p in 0..2 {
        for y in 0..ch {
            for x in 0..cw {
                v.push(((x * 7 + y * 11 + p * 50) % 200 + 20) as u8);
            }
        }
    }
    v
}

fn ops(resize: u32, rotate: i32, fh: bool, fv: bool) -> PlaneOps {
    PlaneOps { resize_pct: resize, rotate, flip_h: fh, flip_v: fv, ..Default::default() }
}

#[test]
fn planes_transform_dims_and_determinism() {
    let src = i420(64, 48);
    let id = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(100, 0, false, false)).unwrap();
    assert_eq!((id.width, id.height), (64, 48));
    assert_eq!(id.data, src);
    let half = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(50, 0, false, false)).unwrap();
    assert_eq!((half.width, half.height), (32, 24));
    assert_eq!(half.data.len(), 32 * 24 * 3 / 2);
    let again = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(50, 0, false, false)).unwrap();
    assert_eq!(half.data, again.data);
    let rot = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(100, 90, false, false)).unwrap();
    assert_eq!((rot.width, rot.height), (48, 64));
    assert_eq!(rot.data[47], src[0], "rotating 90 degrees clockwise moves the top-left pixel to the top-right");
    let r360 = planes::transform_planes(&rot.data, PlaneFormat::I420, 48, 64, &ops(100, 270, false, false)).unwrap();
    assert_eq!(r360.data, src);
    let f = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(100, 0, true, true)).unwrap();
    let ff = planes::transform_planes(&f.data, PlaneFormat::I420, 64, 48, &ops(100, 0, true, true)).unwrap();
    assert_eq!(ff.data, src);
    let r180 = planes::transform_planes(&src, PlaneFormat::I420, 64, 48, &ops(100, 180, false, false)).unwrap();
    assert_eq!(r180.data, f.data);
    let odd = i420(63, 47);
    let o = planes::transform_planes(&odd, PlaneFormat::I420, 63, 47, &ops(100, 0, false, false)).unwrap();
    assert_eq!((o.width, o.height), (62, 46));
    assert_eq!(o.data.len(), 62 * 46 * 3 / 2);
    let o2 = planes::transform_planes(&odd, PlaneFormat::I420, 63, 47, &ops(33, 90, false, false)).unwrap();
    assert_eq!((o2.width % 2, o2.height % 2), (0, 0));
    assert_eq!(o2.data.len() as u32, o2.width * o2.height * 3 / 2);
    assert!(planes::transform_planes(&src[..100], PlaneFormat::I420, 64, 48, &PlaneOps::default()).is_err());
    assert!(planes::transform_planes(&src, PlaneFormat::I420, 0, 48, &PlaneOps::default()).is_err());
    assert!(PlaneFormat::parse("I444").is_err());
}

#[test]
fn planes_nv12_matches_i420() {
    let src = i420(32, 16);
    let ys = 32 * 16;
    let cs = 16 * 8;
    let mut nv12 = src[..ys].to_vec();
    for i in 0..cs {
        nv12.push(src[ys + i]);
        nv12.push(src[ys + cs + i]);
    }
    for o in [ops(100, 0, false, false), ops(50, 90, true, false)] {
        let a = planes::transform_planes(&src, PlaneFormat::I420, 32, 16, &o).unwrap();
        let b = planes::transform_planes(&nv12, PlaneFormat::Nv12, 32, 16, &o).unwrap();
        assert_eq!(a.data, b.data);
    }
}

#[test]
fn planes_rgb_input_converts_with_bt601_limited_range() {
    let (w, h) = (4u32, 2u32);
    let px = |r: u8, g: u8, b: u8| -> Vec<u8> {
        let mut bgrx = Vec::new();
        for _ in 0..w * h {
            bgrx.extend_from_slice(&[b, g, r, 255]);
        }
        bgrx
    };
    let yuv = |p: &planes::Planes| (p.data[0], p.data[(w * h) as usize], p.data[(w * h + w * h / 4) as usize]);
    let white = planes::transform_planes(&px(255, 255, 255), PlaneFormat::Bgrx, w, h, &PlaneOps::default()).unwrap();
    assert_eq!(yuv(&white), (235, 128, 128));
    let black = planes::transform_planes(&px(0, 0, 0), PlaneFormat::Bgrx, w, h, &PlaneOps::default()).unwrap();
    assert_eq!(yuv(&black), (16, 128, 128));
    let red = planes::transform_planes(&px(255, 0, 0), PlaneFormat::Bgra, w, h, &PlaneOps::default()).unwrap();
    assert_eq!(yuv(&red), (82, 90, 240));
    let mut rgbx = Vec::new();
    for c in px(255, 0, 0).chunks(4) {
        rgbx.extend_from_slice(&[c[2], c[1], c[0], c[3]]);
    }
    for f in [PlaneFormat::Rgbx, PlaneFormat::Rgba] {
        let r2 = planes::transform_planes(&rgbx, f, w, h, &PlaneOps::default()).unwrap();
        assert_eq!(r2.data, red.data);
    }
    let big: Vec<u8> = (0..64 * 48 * 4).map(|i| (i * 37 % 251) as u8).collect();
    let a = planes::transform_planes(&big, PlaneFormat::Bgrx, 64, 48, &ops(50, 90, true, false)).unwrap();
    let b = planes::transform_planes(&big, PlaneFormat::Bgrx, 64, 48, &ops(50, 90, true, false)).unwrap();
    assert_eq!(a.data, b.data);
    assert_eq!((a.width, a.height), (24, 32));
    let bt709 = PlaneOps { matrix: planes::Matrix::Bt709, ..Default::default() };
    let r709 = planes::transform_planes(&px(255, 0, 0), PlaneFormat::Bgrx, w, h, &bt709).unwrap();
    assert_eq!(r709.data[0], 63);
}

fn stbl_box(entry: Vec<u8>, samples: &[(u32, u32, i32, bool)], chunk_offsets: &[u32], per_chunk: u32, ctts_v1: bool, extra: &[Vec<u8>]) -> Vec<u8> {
    let mut stsd = 1u32.to_be_bytes().to_vec();
    stsd.extend(entry);
    let mut stts = (samples.len() as u32).to_be_bytes().to_vec();
    for s in samples {
        stts.extend_from_slice(&1u32.to_be_bytes());
        stts.extend_from_slice(&s.1.to_be_bytes());
    }
    let mut stsz = 0u32.to_be_bytes().to_vec();
    stsz.extend_from_slice(&(samples.len() as u32).to_be_bytes());
    for s in samples {
        stsz.extend_from_slice(&s.0.to_be_bytes());
    }
    let mut stsc = 1u32.to_be_bytes().to_vec();
    stsc.extend_from_slice(&1u32.to_be_bytes());
    stsc.extend_from_slice(&per_chunk.to_be_bytes());
    stsc.extend_from_slice(&1u32.to_be_bytes());
    let mut stco = (chunk_offsets.len() as u32).to_be_bytes().to_vec();
    for o in chunk_offsets {
        stco.extend_from_slice(&o.to_be_bytes());
    }
    let mut parts = vec![full(b"stsd", 0, 0, &stsd), full(b"stts", 0, 0, &stts)];
    if samples.iter().any(|s| s.2 != 0) {
        let mut ctts = (samples.len() as u32).to_be_bytes().to_vec();
        for s in samples {
            ctts.extend_from_slice(&1u32.to_be_bytes());
            ctts.extend_from_slice(&s.2.to_be_bytes());
        }
        parts.push(full(b"ctts", ctts_v1 as u8, 0, &ctts));
    }
    parts.extend(extra.iter().cloned());
    parts.push(full(b"stsc", 0, 0, &stsc));
    parts.push(full(b"stsz", 0, 0, &stsz));
    parts.push(full(b"stco", 0, 0, &stco));
    if !samples.iter().all(|s| s.3) {
        let sync: Vec<u32> = samples.iter().enumerate().filter(|(_, s)| s.3).map(|(i, _)| i as u32 + 1).collect();
        let mut b = (sync.len() as u32).to_be_bytes().to_vec();
        for k in sync {
            b.extend_from_slice(&k.to_be_bytes());
        }
        parts.push(full(b"stss", 0, 0, &b));
    }
    bx(b"stbl", &parts.concat())
}

fn trak_box(id: u32, handler: &[u8; 4], name: &str, ts: u32, dur: u32, stbl: Vec<u8>, elst: Option<(u32, i32)>) -> Vec<u8> {
    let wall = 3_873_105_074u32.to_be_bytes();
    let mut tk = [wall, wall].concat();
    tk.extend_from_slice(&id.to_be_bytes());
    tk.extend_from_slice(&[0; 4]);
    tk.extend_from_slice(&(dur as u64 * 1000 / ts as u64).to_be_bytes()[4..]);
    tk.extend_from_slice(&[0; 16]);
    for x in bmff_model::IDENTITY {
        tk.extend_from_slice(&x.to_be_bytes());
    }
    let (w, h) = if handler == b"vide" { (320u32 << 16, 240u32 << 16) } else { (0, 0) };
    tk.extend_from_slice(&w.to_be_bytes());
    tk.extend_from_slice(&h.to_be_bytes());
    let mut md = [wall, wall].concat();
    md.extend_from_slice(&ts.to_be_bytes());
    md.extend_from_slice(&dur.to_be_bytes());
    md.extend_from_slice(&[0x55, 0xc4, 0, 0]);
    let mut hd = vec![0u8; 4];
    hd.extend_from_slice(handler);
    hd.extend_from_slice(&[0; 12]);
    hd.extend_from_slice(name.as_bytes());
    hd.push(0);
    let mh = if handler == b"vide" { full(b"vmhd", 0, 1, &[0; 8]) } else { full(b"smhd", 0, 0, &[0; 4]) };
    let mut dref = 1u32.to_be_bytes().to_vec();
    dref.extend(full(b"url ", 0, 1, &[]));
    let minf = bx(b"minf", &[mh, bx(b"dinf", &full(b"dref", 0, 0, &dref)), stbl].concat());
    let mdia = bx(b"mdia", &[full(b"mdhd", 0, 0, &md), full(b"hdlr", 0, 0, &hd), minf].concat());
    let mut parts = vec![full(b"tkhd", 0, 3, &tk)];
    if let Some((seg, mt)) = elst {
        let mut e = 1u32.to_be_bytes().to_vec();
        e.extend_from_slice(&seg.to_be_bytes());
        e.extend_from_slice(&mt.to_be_bytes());
        e.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        parts.push(bx(b"edts", &full(b"elst", 0, 0, &e)));
    }
    parts.push(mdia);
    bx(b"trak", &parts.concat())
}

fn mediabunny_like() -> (Vec<u8>, Vec<Vec<u8>>) {
    let src = fixture("keys_x264.mp4");
    let m = moov_model(&src);
    let v = &m.tracks[0];
    let bmff_model::Codec::Avc(cfg) = &v.codec else { panic!("expected avc") };
    let sps = cfg.sps[0].clone();
    let pps = cfg.pps[0].clone();
    let mut vsamples: Vec<Vec<u8>> = v.samples.iter().map(|s| sample_bytes(&src, s).to_vec()).collect();
    vsamples[0] = [lp(&[&sps, &pps]), vsamples[0].clone()].concat();
    let shift = v.samples.iter().map(|s| s.cts).max().unwrap();
    let asamples: Vec<Vec<u8>> = (0..100u32).map(|i| vec![0xfc, (i % 251) as u8, 0x5a, 0x11, 0x22]).collect();

    let ftyp = bx(b"ftyp", b"isom\x00\x00\x02\x00isomavc1mp41");
    let stale = [0u8, 0, 0, 0, 0, 0, 0, 0x10];
    let mdat_start = ftyp.len() + 8;
    let mut payload = stale.to_vec();
    let mut voff = Vec::new();
    let mut aoff = Vec::new();
    let mut ai = 0usize;
    for (i, s) in vsamples.iter().enumerate() {
        voff.push((mdat_start + payload.len()) as u32);
        payload.extend_from_slice(s);
        if i % 10 == 9 {
            aoff.push((mdat_start + payload.len()) as u32);
            for _ in 0..20 {
                payload.extend_from_slice(&asamples[ai]);
                ai += 1;
            }
        }
    }
    let mdat = bx(b"mdat", &payload);

    let doubled = |n: &[u8]| [&n[..1], n].concat();
    let mut avcc = vec![1, sps[1], sps[2], sps[3], 0x03, 0x01];
    let ds = doubled(&sps);
    avcc.extend_from_slice(&(ds.len() as u16).to_be_bytes());
    avcc.extend_from_slice(&ds);
    avcc.push(1);
    let dp = doubled(&pps);
    avcc.extend_from_slice(&(dp.len() as u16).to_be_bytes());
    avcc.extend_from_slice(&dp);
    let mut ve = vec![0u8; 6];
    ve.extend_from_slice(&1u16.to_be_bytes());
    ve.extend_from_slice(&[0; 16]);
    ve.extend_from_slice(&320u16.to_be_bytes());
    ve.extend_from_slice(&240u16.to_be_bytes());
    ve.extend_from_slice(&[0, 0x48, 0, 0, 0, 0x48, 0, 0, 0, 0, 0, 0, 0, 1]);
    let mut cname = [0u8; 32];
    cname[..10].copy_from_slice(b"Mediabunny");
    ve.extend_from_slice(&cname);
    ve.extend_from_slice(&[0, 0x18, 0xff, 0xff]);
    ve.extend(bx(b"avcC", &avcc));
    ve.extend(bx(b"colr", b"nclx\x00\x01\x00\x01\x00\x01\x00"));
    ve.extend(bx(b"btrt", &[0; 12]));
    let ventry = bx(b"avc1", &ve);
    let vs: Vec<(u32, u32, i32, bool)> =
        v.samples.iter().zip(&vsamples).map(|(s, b)| (b.len() as u32, s.dur, s.cts - shift, s.sync)).collect();
    let cslg = full(b"cslg", 0, 0, &[0; 20]);
    let vdur: u32 = vs.iter().map(|s| s.1).sum();
    let vtrak = trak_box(1, b"vide", "MediabunnyVideoHandler", v.timescale, vdur, stbl_box(ventry, &vs, &voff, 1, true, &[cslg]), None);

    let mut dops = vec![0u8, 1];
    dops.extend_from_slice(&312u16.to_be_bytes());
    dops.extend_from_slice(&48000u32.to_be_bytes());
    dops.extend_from_slice(&[0, 0, 0]);
    let mut ae = vec![0u8; 6];
    ae.extend_from_slice(&1u16.to_be_bytes());
    ae.extend_from_slice(&[0; 8]);
    ae.extend_from_slice(&1u16.to_be_bytes());
    ae.extend_from_slice(&16u16.to_be_bytes());
    ae.extend_from_slice(&[0; 4]);
    ae.extend_from_slice(&(48000u32 << 16).to_be_bytes());
    ae.extend(bx(b"dOps", &dops));
    ae.extend(bx(b"btrt", &[0; 12]));
    let aentry = bx(b"Opus", &ae);
    let as_: Vec<(u32, u32, i32, bool)> = asamples.iter().map(|a| (a.len() as u32, 960, 0, true)).collect();
    let atrak = trak_box(2, b"soun", "MediabunnySoundHandler", 48000, 96000, stbl_box(aentry, &as_, &aoff, 20, false, &[]), Some((2000, 1024)));

    let wall = 3_873_105_074u32.to_be_bytes();
    let mut mv = [wall, wall].concat();
    mv.extend_from_slice(&1000u32.to_be_bytes());
    mv.extend_from_slice(&2000u32.to_be_bytes());
    mv.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    mv.extend_from_slice(&0x0100u16.to_be_bytes());
    mv.extend_from_slice(&[0; 10]);
    for x in bmff_model::IDENTITY {
        mv.extend_from_slice(&x.to_be_bytes());
    }
    mv.extend_from_slice(&[0; 24]);
    mv.extend_from_slice(&3u32.to_be_bytes());
    let moov = bx(b"moov", &[full(b"mvhd", 0, 0, &mv), vtrak, atrak].concat());
    ([ftyp, mdat, moov].concat(), vsamples)
}

#[test]
fn mediabunny_style_mp4_with_firefox_quirks_is_canonicalized() {
    let (input, vsamples) = mediabunny_like();
    let scan = audit(&input, false);
    assert!(scan.issues.iter().all(|i| !i.starts_with("Cannot clean")), "{:?}", scan.issues);
    assert!(has_line(&scan, "Software", "hdlr name \"MediabunnyVideoHandler\""));
    assert!(has_line(&scan, "Software", "hdlr name \"MediabunnySoundHandler\""));
    assert!(has_line(&scan, "Software", "compressorname \"Mediabunny\""));
    assert!(has_line(&scan, "Software", "SEI user data (x264 build string)"));
    assert!(has_line(&scan, "Time", "mvhd creation time"));
    assert!(has_line(&scan, "Hidden", "mdat 8 bytes not used by any sample"));
    assert!(scan.issues.iter().any(|i| i.contains("cslg")));

    for keep in [false, true] {
        let out = rebuild(&input, keep);
        let v = audit(&out, true);
        assert!(v.passed, "keep={keep}: {:?}", v.issues);
        let names: Vec<String> = top_boxes(&out).into_iter().map(|x| x.0).collect();
        assert_eq!(names, ["ftyp", "moov", "mdat"]);
        for n in [&b"x264 - core"[..], b"Mediabunny", b"cslg", b"elst", b"btrt"] {
            assert!(!contains(&out, n), "{:?} left", String::from_utf8_lossy(n));
        }
        assert!(!contains(&out, &3_873_105_074u32.to_be_bytes()));
        let m = moov_model(&out);
        assert_eq!(m.tracks.len(), if keep { 2 } else { 1 });
        let bmff_model::Codec::Avc(cfg) = &m.tracks[0].codec else { panic!() };
        assert_eq!(cfg.sps[0][0], 0x67);
        assert_ne!(cfg.sps[0][1], 0x67, "doubled NAL header must be repaired");
        assert!(cfg.ext.is_some() == [100u8, 110, 122, 144].contains(&cfg.profile));
        assert!(m.tracks[0].samples.iter().any(|s| s.cts < 0), "negative composition offsets must survive");
        let ctts = out.windows(4).position(|w| w == b"ctts").unwrap();
        assert_eq!(out[ctts + 4], 1, "ctts must be version 1 when offsets are negative");
        let first = sample_bytes(&out, &m.tracks[0].samples[0]);
        let mut want = Vec::new();
        nal::filter_avc(&vsamples[0], 4, &mut want).unwrap();
        assert_eq!(first, want.as_slice());
        if keep {
            assert!(matches!(m.tracks[1].codec, bmff_model::Codec::Opus(_)));
            assert!(m.tracks[1].edits.is_empty());
        }
        assert_eq!(rebuild(&out, keep), out);
    }
}

#[test]
fn allowlist_helpers() {
    assert!(al::mp4_allowed(b"stbl", b"ctts"));
    assert!(!al::mp4_allowed(b"moov", b"udta"));
    assert_eq!(al::mp4_deny(b"\xa9xyz").unwrap().0, Group::Location);
    assert_eq!(al::mp4_deny(b"\xa9zzz").unwrap().0, Group::Hidden);
    assert_eq!(al::ilst_key("com.apple.quicktime.location.ISO6709").0, Group::Location);
    assert_eq!(al::ilst_key("com.bytedance.whatever").0, Group::Ids);
    assert!(al::mkv_allowed(al::MKV_SIMPLEBLOCK, al::MKV_CLUSTER));
    assert!(!al::mkv_allowed(al::MKV_TAGS, al::MKV_SEGMENT));
    assert_eq!(al::mkv_deny(al::MKV_DATEUTC).unwrap().1, "DateUTC");
    assert_eq!(&al::ftyp_for(b"avc1")[4..8], b"ftyp");
    assert!(contains(&al::ftyp_for(b"hvc1"), b"hvc1"));
    assert!(!contains(&al::ftyp_for(b"vp09"), b"vp09"));
    assert!(al::avc_nal_ok(5) && !al::avc_nal_ok(6));
    assert!(al::hevc_nal_ok(34) && !al::hevc_nal_ok(39));
    assert!(al::av1_obu_ok(6) && !al::av1_obu_ok(5));
    let w = plan_windows(10_000, 4096, &[(100, 200), (4000, 5000), (5000, 9000)]);
    assert_eq!(w, vec![(0, 4000), (4000, 5000), (5000, 9096), (9096, 10_000)]);
}

fn with_leading_delay(src: &[u8], delay_ms: u32) -> Vec<u8> {
    let at = src.windows(4).position(|w| w == b"elst").unwrap() - 4;
    let edts = at - 8;
    assert_eq!(&src[edts + 4..edts + 8], b"edts");
    let body = &src[at + 8..at + 28];
    let mut entries = 2u32.to_be_bytes().to_vec();
    entries.extend_from_slice(&delay_ms.to_be_bytes());
    entries.extend_from_slice(&(-1i32).to_be_bytes());
    entries.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    entries.extend_from_slice(&body[8..20]);
    let elst = full(b"elst", 0, 0, &entries);
    let grow = elst.len() - 28;
    let mut out = src[..edts].to_vec();
    out.extend(bx(b"edts", &elst));
    out.extend_from_slice(&src[edts + 36..]);
    let moov = top_boxes(src).into_iter().find(|x| x.0 == "moov").unwrap();
    assert!(moov.1 < edts && edts < moov.3, "edts must sit inside a trailing moov");
    let trak = src[..edts].windows(4).rposition(|w| w == b"trak").unwrap() - 4;
    for pos in [moov.1, trak] {
        let size = u32::from_be_bytes([out[pos], out[pos + 1], out[pos + 2], out[pos + 3]]) + grow as u32;
        out[pos..pos + 4].copy_from_slice(&size.to_be_bytes());
    }
    out
}

#[test]
fn leading_empty_edit_is_accepted_and_dropped() {
    let src = fixture("keys_x264.mp4");
    let delayed = with_leading_delay(&src, 40);
    let m = moov_model(&delayed);
    assert_eq!(m.tracks[0].edits.len(), 2);
    assert_eq!(m.tracks[0].edits[0].media_time, -1);
    let out = rebuild(&delayed, true);
    let v = audit(&out, true);
    assert!(v.passed, "{:?}", v.issues);
    assert!(!contains(&out, b"elst") && !contains(&out, b"edts"));
    assert_eq!(out, rebuild(&src, true), "the leading delay is dropped, nothing else changes");

    let mut r = Rebuild::open(delayed.len() as u64).unwrap();
    while r.phase().as_str() != "ready" {
        let q = r.need().unwrap();
        r.feed(q.offset, &delayed[q.offset as usize..(q.offset + q.len as u64) as usize]).unwrap();
    }
    let plan: serde_json::Value = serde_json::from_str(&r.plan_json()).unwrap();
    assert!(plan["notes"].as_array().unwrap().iter().any(|n| n == "leading delay dropped"));
}

#[test]
fn long_leading_empty_edit_is_refused() {
    let delayed = with_leading_delay(&fixture("keys_x264.mp4"), 5000);
    let e = serve_rebuild(&delayed, false, guard::DEFAULT_WINDOW_BYTES).unwrap_err();
    assert!(e.contains("leading delay longer than 1 second"), "{e}");
    assert!(audit(&delayed, false).issues.iter().any(|i| i.starts_with("Cannot clean") && i.contains("leading delay")));
}
