use super::ebml_walk::{elem, elem_float, elem_uint, write_id, write_size, write_size_len};
use super::mkv_model::{MkvAudio, MkvVideo};
use crate::allowlist::{self as al};

#[derive(Clone, Debug)]
pub struct MkvOutTrack {
    pub number: u64,
    pub ttype: u64,
    pub codec_id: String,
    pub private: Option<Vec<u8>>,
    pub default_duration: Option<u64>,
    pub codec_delay: Option<u64>,
    pub seek_preroll: Option<u64>,
    pub video: Option<MkvVideo>,
    pub audio: Option<MkvAudio>,
}

fn master(id: u32, body: &[u8]) -> Vec<u8> {
    let mut o = Vec::with_capacity(body.len() + 12);
    elem(&mut o, id, body);
    o
}

pub fn ebml_header(doc_type: &str) -> Vec<u8> {
    let mut b = Vec::new();
    elem_uint(&mut b, 0x4286, 1);
    elem_uint(&mut b, 0x42F7, 1);
    elem_uint(&mut b, 0x42F2, 4);
    elem_uint(&mut b, 0x42F3, 8);
    elem(&mut b, 0x4282, doc_type.as_bytes());
    elem_uint(&mut b, 0x4287, 4);
    elem_uint(&mut b, 0x4285, 2);
    master(al::EBML_HEADER, &b)
}

pub fn info(duration_ms: f64) -> Vec<u8> {
    let mut b = Vec::new();
    elem_uint(&mut b, al::MKV_TIMESTAMPSCALE, 1_000_000);
    elem_float(&mut b, al::MKV_DURATION, duration_ms);
    elem(&mut b, al::MKV_MUXINGAPP, al::MKV_APP);
    elem(&mut b, al::MKV_WRITINGAPP, al::MKV_APP);
    master(al::MKV_INFO, &b)
}

pub fn tracks(list: &[MkvOutTrack]) -> Vec<u8> {
    let mut all = Vec::new();
    for t in list {
        let mut b = Vec::new();
        elem_uint(&mut b, al::MKV_TRACKNUMBER, t.number);
        elem_uint(&mut b, al::MKV_TRACKUID, t.number);
        elem_uint(&mut b, al::MKV_TRACKTYPE, t.ttype);
        elem_uint(&mut b, al::MKV_FLAGLACING, 0);
        elem(&mut b, al::MKV_LANGUAGE, b"und");
        elem(&mut b, al::MKV_CODECID, t.codec_id.as_bytes());
        if let Some(p) = &t.private {
            elem(&mut b, al::MKV_CODECPRIVATE, p);
        }
        if let Some(d) = t.default_duration {
            elem_uint(&mut b, al::MKV_DEFAULTDURATION, d);
        }
        if let Some(d) = t.codec_delay {
            elem_uint(&mut b, al::MKV_CODECDELAY, d);
        }
        if let Some(d) = t.seek_preroll {
            elem_uint(&mut b, al::MKV_SEEKPREROLL, d);
        }
        if let Some(v) = &t.video {
            let mut vb = Vec::new();
            elem_uint(&mut vb, al::MKV_PIXELWIDTH, v.pixel_width);
            elem_uint(&mut vb, al::MKV_PIXELHEIGHT, v.pixel_height);
            if let Some(d) = v.display_width {
                elem_uint(&mut vb, al::MKV_DISPLAYWIDTH, d);
            }
            if let Some(d) = v.display_height {
                elem_uint(&mut vb, al::MKV_DISPLAYHEIGHT, d);
            }
            if let Some(c) = v.colour {
                let mut cb = Vec::new();
                let ids = [al::MKV_MATRIX, al::MKV_RANGE, al::MKV_TRANSFER, al::MKV_PRIMARIES];
                for (id, val) in ids.iter().zip(c.iter()) {
                    if let Some(x) = val {
                        elem_uint(&mut cb, *id, *x);
                    }
                }
                if !cb.is_empty() {
                    elem(&mut vb, al::MKV_COLOUR, &cb);
                }
            }
            elem(&mut b, al::MKV_VIDEO, &vb);
        }
        if let Some(a) = &t.audio {
            let mut ab = Vec::new();
            elem_float(&mut ab, al::MKV_SAMPLINGFREQ, a.rate);
            elem_uint(&mut ab, al::MKV_CHANNELS, a.channels);
            if let Some(d) = a.bit_depth {
                elem_uint(&mut ab, al::MKV_BITDEPTH, d);
            }
            elem(&mut b, al::MKV_AUDIO, &ab);
        }
        elem(&mut all, al::MKV_TRACKENTRY, &b);
    }
    master(al::MKV_TRACKS, &all)
}

fn seek(id: u32, pos: u64) -> Vec<u8> {
    let mut b = Vec::new();
    let mut idb = Vec::new();
    write_id(&mut idb, id);
    elem(&mut b, al::MKV_SEEKID, &idb);
    write_id(&mut b, al::MKV_SEEKPOS);
    write_size(&mut b, 8);
    b.extend_from_slice(&pos.to_be_bytes());
    master(al::MKV_SEEK, &b)
}

pub fn seekhead(info_pos: u64, tracks_pos: u64, cues_pos: u64) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(&seek(al::MKV_INFO, info_pos));
    b.extend_from_slice(&seek(al::MKV_TRACKS, tracks_pos));
    b.extend_from_slice(&seek(al::MKV_CUES, cues_pos));
    master(al::MKV_SEEKHEAD, &b)
}

pub fn cues(points: &[(u64, u64, u64)]) -> Vec<u8> {
    let mut all = Vec::new();
    for &(time, track, pos) in points {
        let mut tp = Vec::new();
        elem_uint(&mut tp, al::MKV_CUETRACK, track);
        elem_uint(&mut tp, al::MKV_CUECLUSTERPOS, pos);
        let mut cp = Vec::new();
        elem_uint(&mut cp, al::MKV_CUETIME, time);
        elem(&mut cp, al::MKV_CUETRACKPOS, &tp);
        elem(&mut all, al::MKV_CUEPOINT, &cp);
    }
    master(al::MKV_CUES, &all)
}

pub fn simple_block(o: &mut Vec<u8>, track: u64, rel: i16, flags: u8, frame: &[u8]) {
    write_id(o, al::MKV_SIMPLEBLOCK);
    write_size(o, 4 + frame.len() as u64);
    o.push(0x80 | (track as u8 & 0x7f));
    o.extend_from_slice(&rel.to_be_bytes());
    o.push(flags & 0x89);
    o.extend_from_slice(frame);
}

pub fn cluster(ts: u64, blocks: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(blocks.len() + 16);
    elem_uint(&mut b, al::MKV_TIMESTAMP, ts);
    b.extend_from_slice(blocks);
    master(al::MKV_CLUSTER, &b)
}

pub struct MkvHead {
    pub head: Vec<u8>,
    pub tail: Vec<u8>,
}

pub fn assemble(
    doc_type: &str,
    duration_ms: f64,
    list: &[MkvOutTrack],
    body_len: u64,
    cue_points: &[(u64, u64, u64)],
) -> MkvHead {
    let info = info(duration_ms);
    let tracks = tracks(list);
    let sh_len = seekhead(0, 0, 0).len() as u64;
    let info_pos = sh_len;
    let tracks_pos = info_pos + info.len() as u64;
    let clusters_pos = tracks_pos + tracks.len() as u64;
    let shifted: Vec<(u64, u64, u64)> = cue_points.iter().map(|&(t, tr, p)| (t, tr, p + clusters_pos)).collect();
    let tail = cues(&shifted);
    let cues_pos = clusters_pos + body_len;
    let sh = seekhead(info_pos, tracks_pos, cues_pos);
    let seg_size = clusters_pos + body_len + tail.len() as u64;
    let mut head = ebml_header(doc_type);
    write_id(&mut head, al::MKV_SEGMENT);
    write_size_len(&mut head, seg_size, 8);
    head.extend_from_slice(&sh);
    head.extend_from_slice(&info);
    head.extend_from_slice(&tracks);
    MkvHead { head, tail }
}
