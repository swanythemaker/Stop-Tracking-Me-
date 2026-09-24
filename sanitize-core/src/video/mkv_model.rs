use super::ebml_walk::{child, children, float, name, text, uint, Elem};
use super::reader::find;
use super::report::Finding;
use crate::allowlist::{self as al, Group};
use crate::guard;

pub const MASTERS: &[u32] = &[
    al::EBML_HEADER,
    al::MKV_SEGMENT,
    al::MKV_SEEKHEAD,
    al::MKV_SEEK,
    al::MKV_INFO,
    al::MKV_TRACKS,
    al::MKV_TRACKENTRY,
    al::MKV_VIDEO,
    al::MKV_AUDIO,
    al::MKV_COLOUR,
    al::MKV_CUES,
    al::MKV_CUEPOINT,
    al::MKV_CUETRACKPOS,
    al::MKV_TAGS,
    al::MKV_TAG,
    al::MKV_SIMPLETAG,
    0x63C0,
    al::MKV_ATTACHMENTS,
    al::MKV_ATTACHEDFILE,
    al::MKV_CHAPTERS,
    0x45B9,
    0xB6,
    0x80,
    al::MKV_CLUSTER,
    al::MKV_BLOCKGROUP,
    al::MKV_BLOCKADDITIONS,
    0xA6,
    al::MKV_CONTENTENCODINGS,
    0x6240,
    0x5034,
    0x5035,
    0x55D0,
    0x7670,
    0xE2,
    al::MKV_BLOCKADDMAPPING,
    0x6924,
];

pub fn is_master(id: u32) -> bool {
    MASTERS.contains(&id)
}

pub fn walk(data: &[u8], parent: u32, depth: usize, f: &mut dyn FnMut(&Elem, u32) -> bool) -> Result<(), String> {
    if depth > guard::MAX_BOX_DEPTH {
        return Err("Elements nested too deeply".to_string());
    }
    for e in children(data)? {
        if f(&e, parent) && is_master(e.id) {
            walk(e.data, e.id, depth + 1, f)?;
        }
    }
    Ok(())
}

pub struct Collector {
    pub strict: bool,
    pub findings: Vec<Finding>,
    pub issues: Vec<String>,
    pub markers: Vec<String>,
}

impl Collector {
    pub fn new(strict: bool) -> Self {
        Collector { strict, findings: Vec::new(), issues: Vec::new(), markers: Vec::new() }
    }

    pub fn visit(&mut self, e: &Elem, parent: u32) -> bool {
        let n = name(e.id);
        if !self.markers.contains(&n) && self.markers.len() < 256 {
            self.markers.push(n.clone());
        }
        if al::mkv_allowed(e.id, parent) {
            return true;
        }
        if let Some((g, dn, text)) = al::mkv_deny(e.id) {
            let mut f = Finding::new(dn, g, text);
            if e.id == al::MKV_TAGS {
                let names = tag_names(e.data);
                if !names.is_empty() {
                    f.text = format!("{} ({})", text, names.join(", "));
                }
            }
            if e.id == al::MKV_ATTACHMENTS {
                let names = attachment_names(e.data);
                if !names.is_empty() {
                    f.text = format!("{} ({})", text, names.join(", "));
                }
            }
            if self.strict {
                self.issues.push(format!("Disallowed element {} under {}", dn, name(parent)));
            }
            self.findings.push(f);
            return false;
        }
        if self.strict {
            self.issues.push(format!("Non-allowlisted element {} under {}", n, name(parent)));
            return false;
        }
        if !al::mkv_quiet(e.id) && !is_master_known_parent(parent) {
            self.issues.push(format!("Unknown element {} under {}, removed", n, name(parent)));
        }
        is_master(e.id)
    }
}

fn is_master_known_parent(parent: u32) -> bool {
    [al::MKV_TAGS, al::MKV_TAG, al::MKV_SIMPLETAG, 0x63C0, al::MKV_ATTACHMENTS, al::MKV_ATTACHEDFILE, al::MKV_CHAPTERS]
        .contains(&parent)
}

pub fn tag_names(data: &[u8]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let _ = walk(data, al::MKV_TAGS, 0, &mut |e, _| {
        if e.id == al::MKV_TAGNAME {
            let t = text(e.data);
            if !out.contains(&t) && out.len() < 16 {
                out.push(t);
            }
        }
        true
    });
    out
}

pub fn attachment_names(data: &[u8]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let _ = walk(data, al::MKV_ATTACHMENTS, 0, &mut |e, _| {
        if e.id == al::MKV_FILENAME && out.len() < 16 {
            out.push(text(e.data));
        }
        true
    });
    out
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MkvInfo {
    pub timestamp_scale: u64,
    pub duration: Option<f64>,
    pub muxing_app: Option<String>,
    pub writing_app: Option<String>,
}

pub fn parse_info(data: &[u8]) -> Result<MkvInfo, String> {
    let kids = children(data)?;
    let mut info = MkvInfo { timestamp_scale: 1_000_000, ..Default::default() };
    if let Some(e) = child(&kids, al::MKV_TIMESTAMPSCALE) {
        info.timestamp_scale = uint(e.data)?;
    }
    if info.timestamp_scale == 0 || info.timestamp_scale > 1_000_000_000 {
        return Err("Invalid TimestampScale".to_string());
    }
    if let Some(e) = child(&kids, al::MKV_DURATION) {
        let d = float(e.data)?;
        if d.is_finite() && d >= 0.0 {
            info.duration = Some(d);
        }
    }
    info.muxing_app = child(&kids, al::MKV_MUXINGAPP).map(|e| text(e.data));
    info.writing_app = child(&kids, al::MKV_WRITINGAPP).map(|e| text(e.data));
    Ok(info)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MkvVideo {
    pub pixel_width: u64,
    pub pixel_height: u64,
    pub display_width: Option<u64>,
    pub display_height: Option<u64>,
    pub colour: Option<[Option<u64>; 4]>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MkvAudio {
    pub rate: f64,
    pub channels: u64,
    pub bit_depth: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MkvTrack {
    pub number: u64,
    pub uid: u64,
    pub ttype: u64,
    pub codec_id: String,
    pub private: Option<Vec<u8>>,
    pub default_duration: Option<u64>,
    pub codec_delay: Option<u64>,
    pub seek_preroll: Option<u64>,
    pub language: Option<String>,
    pub name: Option<String>,
    pub video: Option<MkvVideo>,
    pub audio: Option<MkvAudio>,
    pub content_encodings: bool,
    pub lacing: Option<u64>,
}

impl MkvTrack {
    pub fn is_video(&self) -> bool {
        self.ttype == 1
    }

    pub fn is_audio(&self) -> bool {
        self.ttype == 2
    }

    pub fn line(&self) -> String {
        let kind = match self.ttype {
            1 => "video",
            2 => "audio",
            17 => "subtitle",
            _ => "other",
        };
        let mut s = format!("{kind} {}", self.codec_id);
        if let Some(v) = &self.video {
            s.push_str(&format!(" {}x{}", v.pixel_width, v.pixel_height));
        }
        if let Some(a) = &self.audio {
            s.push_str(&format!(" {} Hz {} ch", a.rate.round() as u64, a.channels));
        }
        s
    }
}

pub fn parse_tracks(data: &[u8]) -> Result<Vec<MkvTrack>, String> {
    let mut out = Vec::new();
    for te in children(data)?.iter().filter(|e| e.id == al::MKV_TRACKENTRY) {
        if out.len() >= guard::MAX_TRACKS * 4 {
            return Err("Too many tracks".to_string());
        }
        out.push(parse_track(te.data)?);
    }
    Ok(out)
}

fn opt_uint(kids: &[Elem], id: u32) -> Result<Option<u64>, String> {
    child(kids, id).map(|e| uint(e.data)).transpose()
}

fn parse_track(data: &[u8]) -> Result<MkvTrack, String> {
    let k = children(data)?;
    let mut t = MkvTrack {
        number: opt_uint(&k, al::MKV_TRACKNUMBER)?.ok_or_else(|| "TrackEntry has no TrackNumber".to_string())?,
        uid: opt_uint(&k, al::MKV_TRACKUID)?.unwrap_or(0),
        ttype: opt_uint(&k, al::MKV_TRACKTYPE)?.unwrap_or(0),
        codec_id: child(&k, al::MKV_CODECID).map(|e| text(e.data)).unwrap_or_default(),
        private: child(&k, al::MKV_CODECPRIVATE).map(|e| e.data.to_vec()),
        default_duration: opt_uint(&k, al::MKV_DEFAULTDURATION)?,
        codec_delay: opt_uint(&k, al::MKV_CODECDELAY)?,
        seek_preroll: opt_uint(&k, al::MKV_SEEKPREROLL)?,
        language: child(&k, al::MKV_LANGUAGE).map(|e| text(e.data)),
        name: child(&k, al::MKV_NAME).map(|e| text(e.data)),
        content_encodings: child(&k, al::MKV_CONTENTENCODINGS).is_some(),
        lacing: opt_uint(&k, al::MKV_FLAGLACING)?,
        ..Default::default()
    };
    if t.number == 0 || t.number > 127 {
        return Err("Track numbers above 127 are not supported".to_string());
    }
    if let Some(v) = child(&k, al::MKV_VIDEO) {
        let vk = children(v.data)?;
        let colour = match child(&vk, al::MKV_COLOUR) {
            Some(c) => {
                let ck = children(c.data)?;
                Some([
                    opt_uint(&ck, al::MKV_MATRIX)?,
                    opt_uint(&ck, al::MKV_RANGE)?,
                    opt_uint(&ck, al::MKV_TRANSFER)?,
                    opt_uint(&ck, al::MKV_PRIMARIES)?,
                ])
            }
            None => None,
        };
        t.video = Some(MkvVideo {
            pixel_width: opt_uint(&vk, al::MKV_PIXELWIDTH)?.unwrap_or(0),
            pixel_height: opt_uint(&vk, al::MKV_PIXELHEIGHT)?.unwrap_or(0),
            display_width: opt_uint(&vk, al::MKV_DISPLAYWIDTH)?,
            display_height: opt_uint(&vk, al::MKV_DISPLAYHEIGHT)?,
            colour,
        });
    }
    if let Some(a) = child(&k, al::MKV_AUDIO) {
        let ak = children(a.data)?;
        t.audio = Some(MkvAudio {
            rate: child(&ak, al::MKV_SAMPLINGFREQ).map(|e| float(e.data)).transpose()?.unwrap_or(8000.0),
            channels: opt_uint(&ak, al::MKV_CHANNELS)?.unwrap_or(1),
            bit_depth: opt_uint(&ak, al::MKV_BITDEPTH)?,
        });
    }
    Ok(t)
}

#[derive(Clone, Copy, Debug)]
pub struct Block<'a> {
    pub track: u64,
    pub rel: i16,
    pub flags: u8,
    pub key: bool,
    pub frame: &'a [u8],
}

pub struct ClusterData<'a> {
    pub timestamp: u64,
    pub blocks: Vec<Block<'a>>,
    pub dropped: Vec<u32>,
    pub groups: usize,
}

pub fn parse_block(d: &[u8]) -> Result<(u64, i16, u8, &[u8]), String> {
    let first = *d.first().ok_or_else(|| "Empty block".to_string())?;
    if first & 0x80 == 0 {
        return Err("Track numbers above 127 are not supported".to_string());
    }
    let track = (first & 0x7f) as u64;
    if d.len() < 5 {
        return Err("Truncated block header".to_string());
    }
    let rel = i16::from_be_bytes([d[1], d[2]]);
    let flags = d[3];
    if flags & 0x06 != 0 {
        return Err("Laced blocks are not supported".to_string());
    }
    Ok((track, rel, flags, &d[4..]))
}

pub fn parse_cluster(data: &[u8]) -> Result<ClusterData<'_>, String> {
    let mut c = ClusterData { timestamp: 0, blocks: Vec::new(), dropped: Vec::new(), groups: 0 };
    let mut saw_ts = false;
    for e in children(data)? {
        match e.id {
            al::MKV_TIMESTAMP => {
                c.timestamp = uint(e.data)?;
                saw_ts = true;
            }
            al::MKV_SIMPLEBLOCK => {
                let (track, rel, flags, frame) = parse_block(e.data)?;
                c.blocks.push(Block { track, rel, flags, key: flags & 0x80 != 0, frame });
            }
            al::MKV_BLOCKGROUP => {
                c.groups += 1;
                let gk = children(e.data)?;
                let b = child(&gk, al::MKV_BLOCK).ok_or_else(|| "BlockGroup has no Block".to_string())?;
                let (track, rel, flags, frame) = parse_block(b.data)?;
                let key = child(&gk, al::MKV_REFERENCEBLOCK).is_none();
                for g in &gk {
                    if g.id != al::MKV_BLOCK && g.id != al::MKV_REFERENCEBLOCK && g.id != al::MKV_BLOCKDURATION {
                        c.dropped.push(g.id);
                    }
                }
                c.blocks.push(Block { track, rel, flags: flags & 0x08, key, frame });
            }
            other => c.dropped.push(other),
        }
        if c.blocks.len() > 1_000_000 {
            return Err("Too many blocks in one cluster".to_string());
        }
    }
    if !saw_ts {
        return Err("Cluster has no Timestamp".to_string());
    }
    Ok(c)
}

pub fn parse_opus_head(b: &[u8]) -> Result<super::bmff_model::OpusCfg, String> {
    if b.len() < 19 || &b[..8] != b"OpusHead" {
        return Err("Invalid OpusHead".to_string());
    }
    if b[8] != 1 {
        return Err("Unsupported OpusHead version".to_string());
    }
    let channels = b[9];
    let pre_skip = u16::from_le_bytes([b[10], b[11]]);
    let rate = u32::from_le_bytes([b[12], b[13], b[14], b[15]]);
    let gain = i16::from_le_bytes([b[16], b[17]]);
    let family = b[18];
    let (mut streams, mut coupled, mut mapping) = (0, 0, Vec::new());
    if family != 0 {
        let end = 21 + channels as usize;
        if b.len() < end {
            return Err("Truncated OpusHead mapping".to_string());
        }
        streams = b[19];
        coupled = b[20];
        mapping = b[21..end].to_vec();
    } else if channels > 2 {
        return Err("Opus mapping family 0 allows at most 2 channels".to_string());
    }
    if channels == 0 {
        return Err("Opus has zero channels".to_string());
    }
    Ok(super::bmff_model::OpusCfg { channels, pre_skip, rate, gain, family, streams, coupled, mapping })
}

pub fn write_opus_head(o: &super::bmff_model::OpusCfg) -> Vec<u8> {
    let mut v = b"OpusHead".to_vec();
    v.push(1);
    v.push(o.channels);
    v.extend_from_slice(&o.pre_skip.to_le_bytes());
    v.extend_from_slice(&o.rate.to_le_bytes());
    v.extend_from_slice(&o.gain.to_le_bytes());
    v.push(o.family);
    if o.family != 0 {
        v.push(o.streams);
        v.push(o.coupled);
        v.extend_from_slice(&o.mapping);
    }
    v
}

pub fn split_xiph(b: &[u8]) -> Result<Vec<&[u8]>, String> {
    let n = *b.first().ok_or_else(|| "Empty Vorbis codec private".to_string())? as usize + 1;
    if n != 3 {
        return Err("Vorbis codec private must hold three headers".to_string());
    }
    let mut pos = 1usize;
    let mut sizes = Vec::new();
    for _ in 0..n - 1 {
        let mut s = 0usize;
        loop {
            let x = *b.get(pos).ok_or_else(|| "Truncated Xiph lacing".to_string())?;
            pos += 1;
            s += x as usize;
            if x != 255 {
                break;
            }
        }
        sizes.push(s);
    }
    let mut out = Vec::new();
    for s in sizes {
        let end = pos.checked_add(s).filter(|&e| e <= b.len()).ok_or_else(|| "Truncated Vorbis header".to_string())?;
        out.push(&b[pos..end]);
        pos = end;
    }
    out.push(&b[pos..]);
    Ok(out)
}

pub const VORBIS_EMPTY_COMMENT: &[u8] = b"\x03vorbis\x00\x00\x00\x00\x00\x00\x00\x00\x01";

pub fn vorbis_comment_findings(comment: &[u8]) -> Vec<Finding> {
    if comment == VORBIS_EMPTY_COMMENT {
        return Vec::new();
    }
    let mut out = Vec::new();
    if comment.len() >= 11 {
        let vl = u32::from_le_bytes([comment[7], comment[8], comment[9], comment[10]]) as usize;
        if let Some(v) = comment.get(11..11 + vl) {
            out.push(Finding::new("Vorbis vendor", Group::Software, String::from_utf8_lossy(v).into_owned()));
        }
    }
    if find(comment, b"ENCODER=") {
        out.push(Finding::new("Vorbis comment", Group::Software, "ENCODER tag"));
    } else if out.is_empty() {
        out.push(Finding::new("Vorbis comment", Group::Hidden, "comment header with content"));
    }
    out
}

pub fn rebuild_vorbis(b: &[u8]) -> Result<Vec<u8>, String> {
    let parts = split_xiph(b)?;
    let (ident, comment, setup) = (parts[0], parts[1], parts[2]);
    if ident.len() < 7 || &ident[..7] != b"\x01vorbis" {
        return Err("Invalid Vorbis identification header".to_string());
    }
    if comment.len() < 7 || &comment[..7] != b"\x03vorbis" {
        return Err("Invalid Vorbis comment header".to_string());
    }
    if setup.len() < 7 || &setup[..7] != b"\x05vorbis" {
        return Err("Invalid Vorbis setup header".to_string());
    }
    let mut out = vec![2u8];
    for s in [ident.len(), VORBIS_EMPTY_COMMENT.len()] {
        let mut n = s;
        while n >= 255 {
            out.push(255);
            n -= 255;
        }
        out.push(n as u8);
    }
    out.extend_from_slice(ident);
    out.extend_from_slice(VORBIS_EMPTY_COMMENT);
    out.extend_from_slice(setup);
    Ok(out)
}
