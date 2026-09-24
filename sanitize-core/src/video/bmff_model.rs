use super::bmff_walk::{audio_entry_header_len, children, find_child, full_box, RawBox};
use super::nal::{self, AvcConfig, HvcConfig};
use super::obu::{self, Av1Config};
use super::reader::Cursor;
use super::report::human_name;
use crate::guard;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Sample {
    pub offset: u64,
    pub size: u32,
    pub dur: u32,
    pub cts: i32,
    pub sync: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Esds {
    pub oti: u8,
    pub asc: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpusCfg {
    pub channels: u8,
    pub pre_skip: u16,
    pub rate: u32,
    pub gain: i16,
    pub family: u8,
    pub streams: u8,
    pub coupled: u8,
    pub mapping: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VpcC {
    pub profile: u8,
    pub level: u8,
    pub bits: u8,
    pub primaries: u8,
    pub transfer: u8,
    pub matrix: u8,
    pub init_len: u16,
}

#[derive(Clone, Debug)]
pub enum Codec {
    Avc(AvcConfig),
    Hevc(HvcConfig),
    Av1(Av1Config),
    Vp9(VpcC),
    Aac(Esds),
    Opus(OpusCfg),
    Unsupported(String),
}

impl Codec {
    pub fn is_video(&self) -> bool {
        matches!(self, Codec::Avc(_) | Codec::Hevc(_) | Codec::Av1(_) | Codec::Vp9(_))
    }

    pub fn is_audio(&self) -> bool {
        matches!(self, Codec::Aac(_) | Codec::Opus(_))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Nclx {
    pub primaries: u16,
    pub transfer: u16,
    pub matrix: u16,
    pub full_range: bool,
}

#[derive(Clone, Debug)]
pub struct Visual {
    pub width: u16,
    pub height: u16,
    pub colr: Option<Nclx>,
    pub icc: bool,
    pub pasp: Option<(u32, u32)>,
    pub compressor: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub struct Audio {
    pub channels: u16,
    pub rate: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct Edit {
    pub seg: u64,
    pub media_time: i64,
    pub rate: i32,
}

#[derive(Clone, Debug)]
pub struct Track {
    pub id: u32,
    pub handler: [u8; 4],
    pub timescale: u32,
    pub media_duration: u64,
    pub language: u16,
    pub tkhd_times: bool,
    pub mdhd_times: bool,
    pub tkhd_width: u32,
    pub tkhd_height: u32,
    pub matrix: [i32; 9],
    pub fourcc: Option<[u8; 4]>,
    pub entry_count: u32,
    pub codec: Codec,
    pub visual: Option<Visual>,
    pub audio: Option<Audio>,
    pub samples: Vec<Sample>,
    pub edits: Vec<Edit>,
    pub encrypted: bool,
    pub hdlr_name: Vec<u8>,
    pub dref_self: bool,
    pub error: Option<String>,
}

impl Track {
    fn empty() -> Self {
        Track {
            id: 0,
            handler: *b"\0\0\0\0",
            timescale: 0,
            media_duration: 0,
            language: 0,
            tkhd_times: false,
            mdhd_times: false,
            tkhd_width: 0,
            tkhd_height: 0,
            matrix: IDENTITY,
            fourcc: None,
            entry_count: 0,
            codec: Codec::Unsupported("none".to_string()),
            visual: None,
            audio: None,
            samples: Vec::new(),
            edits: Vec::new(),
            encrypted: false,
            hdlr_name: Vec::new(),
            dref_self: false,
            error: None,
        }
    }

    pub fn fourcc_name(&self) -> String {
        self.fourcc.map(|f| human_name(&f)).unwrap_or_else(|| "none".to_string())
    }

    pub fn total_dur(&self) -> u64 {
        self.samples.iter().map(|s| s.dur as u64).sum()
    }

    pub fn seconds(&self) -> f64 {
        if self.timescale == 0 {
            return 0.0;
        }
        self.total_dur().max(self.media_duration) as f64 / self.timescale as f64
    }

    pub fn is_video(&self) -> bool {
        &self.handler == b"vide"
    }

    pub fn is_audio(&self) -> bool {
        &self.handler == b"soun"
    }

    pub fn usable(&self) -> bool {
        self.error.is_none() && self.entry_count == 1 && !self.encrypted && !self.samples.is_empty() && self.timescale > 0
    }

    pub fn line(&self) -> String {
        let kind = match &self.handler {
            b"vide" => "video",
            b"soun" => "audio",
            b"tmcd" => "timecode",
            b"meta" => "metadata",
            b"text" | b"sbtl" | b"subt" => "text",
            _ => "other",
        };
        let mut s = format!("{kind} {}", self.fourcc_name());
        if let Some(v) = &self.visual {
            s.push_str(&format!(" {}x{}", v.width, v.height));
        }
        if let Some(a) = &self.audio {
            s.push_str(&format!(" {} Hz {} ch", a.rate, a.channels));
        }
        s.push_str(&format!(" {} samples", self.samples.len()));
        s
    }
}

pub const IDENTITY: [i32; 9] = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000];

pub fn rotation(m: &[i32; 9]) -> Option<u16> {
    if m[2] != 0 || m[5] != 0 || m[8] != 0x4000_0000 {
        return None;
    }
    let one = 0x10000;
    match (m[0], m[1], m[3], m[4]) {
        (a, 0, 0, d) if a == one && d == one => Some(0),
        (0, b, c, 0) if b == one && c == -one => Some(90),
        (a, 0, 0, d) if a == -one && d == -one => Some(180),
        (0, b, c, 0) if b == -one && c == one => Some(270),
        _ => None,
    }
}

pub fn matrix_for(rot: u16) -> [i32; 9] {
    let one = 0x10000;
    let w = 0x4000_0000;
    match rot {
        90 => [0, one, 0, -one, 0, 0, 0, 0, w],
        180 => [-one, 0, 0, 0, -one, 0, 0, 0, w],
        270 => [0, -one, 0, one, 0, 0, 0, 0, w],
        _ => IDENTITY,
    }
}

#[derive(Clone, Debug)]
pub struct Mp4Model {
    pub movie_timescale: u32,
    pub mvhd_times: bool,
    pub fragmented: bool,
    pub tracks: Vec<Track>,
}

pub fn parse_moov(payload: &[u8]) -> Result<Mp4Model, String> {
    let kids = children(payload)?;
    let mvhd = find_child(&kids, b"mvhd").ok_or_else(|| "moov has no mvhd".to_string())?;
    let (timescale, times) = parse_mvhd(mvhd.payload)?;
    let mut model = Mp4Model {
        movie_timescale: timescale,
        mvhd_times: times,
        fragmented: find_child(&kids, b"mvex").is_some(),
        tracks: Vec::new(),
    };
    for k in kids.iter().filter(|k| &k.typ == b"trak") {
        if model.tracks.len() >= guard::MAX_TRACKS * 4 {
            return Err("Too many tracks".to_string());
        }
        model.tracks.push(parse_trak(k.payload));
    }
    Ok(model)
}

fn parse_mvhd(p: &[u8]) -> Result<(u32, bool), String> {
    let (v, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let (cr, md) = if v == 1 { (c.u64()?, c.u64()?) } else { (c.u32()? as u64, c.u32()? as u64) };
    let ts = c.u32()?;
    if ts == 0 {
        return Err("mvhd timescale is zero".to_string());
    }
    Ok((ts, cr != 0 || md != 0))
}

fn parse_trak(p: &[u8]) -> Track {
    let mut t = Track::empty();
    if let Err(e) = fill_trak(p, &mut t) {
        t.error = Some(e);
    }
    t
}

fn fill_trak(p: &[u8], t: &mut Track) -> Result<(), String> {
    let kids = children(p)?;
    let tkhd = find_child(&kids, b"tkhd").ok_or_else(|| "Track has no tkhd".to_string())?;
    parse_tkhd(tkhd.payload, t)?;
    if let Some(edts) = find_child(&kids, b"edts") {
        if let Some(elst) = find_child(&children(edts.payload)?, b"elst") {
            t.edits = parse_elst(elst.payload)?;
        }
    }
    let mdia = find_child(&kids, b"mdia").ok_or_else(|| "Track has no mdia".to_string())?;
    let mk = children(mdia.payload)?;
    let mdhd = find_child(&mk, b"mdhd").ok_or_else(|| "Track has no mdhd".to_string())?;
    parse_mdhd(mdhd.payload, t)?;
    let hdlr = find_child(&mk, b"hdlr").ok_or_else(|| "Track has no hdlr".to_string())?;
    let (_, _, hr) = full_box(hdlr.payload)?;
    let mut hc = Cursor::new(hr);
    hc.skip(4)?;
    t.handler = hc.fourcc()?;
    hc.skip(12)?;
    t.hdlr_name = hc.rest().to_vec();
    let minf = find_child(&mk, b"minf").ok_or_else(|| "Track has no minf".to_string())?;
    let nk = children(minf.payload)?;
    if let Some(dinf) = find_child(&nk, b"dinf") {
        if let Some(dref) = find_child(&children(dinf.payload)?, b"dref") {
            t.dref_self = dref_self_contained(dref.payload)?;
        }
    }
    let stbl = find_child(&nk, b"stbl").ok_or_else(|| "Track has no stbl".to_string())?;
    let sk = children(stbl.payload)?;
    let stsd = find_child(&sk, b"stsd").ok_or_else(|| "Track has no stsd".to_string())?;
    parse_stsd(stsd.payload, t)?;
    t.samples = expand_samples(&sk)?;
    Ok(())
}

fn parse_tkhd(p: &[u8], t: &mut Track) -> Result<(), String> {
    let (v, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let (cr, md) = if v == 1 { (c.u64()?, c.u64()?) } else { (c.u32()? as u64, c.u32()? as u64) };
    t.tkhd_times = cr != 0 || md != 0;
    t.id = c.u32()?;
    c.skip(4)?;
    if v == 1 {
        c.skip(8)?;
    } else {
        c.skip(4)?;
    }
    c.skip(16)?;
    for i in 0..9 {
        t.matrix[i] = c.i32()?;
    }
    t.tkhd_width = c.u32()?;
    t.tkhd_height = c.u32()?;
    Ok(())
}

fn parse_mdhd(p: &[u8], t: &mut Track) -> Result<(), String> {
    let (v, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let (cr, md) = if v == 1 { (c.u64()?, c.u64()?) } else { (c.u32()? as u64, c.u32()? as u64) };
    t.mdhd_times = cr != 0 || md != 0;
    t.timescale = c.u32()?;
    t.media_duration = if v == 1 { c.u64()? } else { c.u32()? as u64 };
    t.language = c.u16()?;
    if t.timescale == 0 {
        return Err("Track timescale is zero".to_string());
    }
    Ok(())
}

fn parse_elst(p: &[u8]) -> Result<Vec<Edit>, String> {
    let (v, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let n = c.u32()? as usize;
    if n > 1024 {
        return Err("Edit list is too long".to_string());
    }
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let (seg, mt) = if v == 1 { (c.u64()?, c.u64()? as i64) } else { (c.u32()? as u64, c.i32()? as i64) };
        let rate = c.i32()?;
        out.push(Edit { seg, media_time: mt, rate });
    }
    Ok(out)
}

fn dref_self_contained(p: &[u8]) -> Result<bool, String> {
    let (_, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let n = c.u32()?;
    let kids = children(c.rest())?;
    if n != 1 || kids.len() != 1 {
        return Ok(false);
    }
    let k = kids[0];
    let (_, flags, body) = full_box(k.payload)?;
    Ok((&k.typ == b"url " || &k.typ == b"alis") && flags & 1 == 1 && body.is_empty())
}

fn parse_stsd(p: &[u8], t: &mut Track) -> Result<(), String> {
    let (_, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    t.entry_count = c.u32()?;
    let kids = children(c.rest())?;
    let e = match kids.first() {
        Some(e) => *e,
        None => return Err("Empty sample description".to_string()),
    };
    t.fourcc = Some(e.typ);
    match &e.typ {
        b"encv" | b"enca" => {
            t.encrypted = true;
            t.codec = Codec::Unsupported("encrypted".to_string());
        }
        b"avc1" | b"hvc1" | b"hev1" | b"av01" | b"vp09" => parse_visual(&e, t)?,
        b"mp4a" | b"Opus" => parse_audio(&e, t)?,
        other => t.codec = Codec::Unsupported(human_name(other)),
    }
    Ok(())
}

fn parse_visual(e: &RawBox, t: &mut Track) -> Result<(), String> {
    let p = e.payload;
    if p.len() < 78 {
        return Err("Truncated visual sample entry".to_string());
    }
    let width = u16::from_be_bytes([p[24], p[25]]);
    let height = u16::from_be_bytes([p[26], p[27]]);
    let compressor = p[42..74].to_vec();
    let kids = children(&p[78..])?;
    if kids.iter().any(|k| &k.typ == b"sinf") {
        t.encrypted = true;
    }
    let mut colr = None;
    let mut icc = false;
    for k in kids.iter().filter(|k| &k.typ == b"colr") {
        let mut c = Cursor::new(k.payload);
        match &c.fourcc()? {
            b"nclx" => {
                let (pr, tr, mx) = (c.u16()?, c.u16()?, c.u16()?);
                let fr = c.u8()? & 0x80 != 0;
                colr = Some(Nclx { primaries: pr, transfer: tr, matrix: mx, full_range: fr });
            }
            b"nclc" => {
                let (pr, tr, mx) = (c.u16()?, c.u16()?, c.u16()?);
                colr = Some(Nclx { primaries: pr, transfer: tr, matrix: mx, full_range: false });
            }
            _ => icc = true,
        }
    }
    let pasp = match find_child(&kids, b"pasp") {
        Some(k) => {
            let mut c = Cursor::new(k.payload);
            let (h, v) = (c.u32()?, c.u32()?);
            if h > 0 && v > 0 && h <= 1 << 16 && v <= 1 << 16 {
                Some((h, v))
            } else {
                None
            }
        }
        None => None,
    };
    t.visual = Some(Visual { width, height, colr, icc, pasp, compressor });
    let need = |f: &[u8; 4]| find_child(&kids, f).ok_or_else(|| format!("Missing {} codec config", human_name(f)));
    t.codec = match &e.typ {
        b"avc1" => Codec::Avc(nal::parse_avcc(need(b"avcC")?.payload)?),
        b"hvc1" | b"hev1" => Codec::Hevc(nal::parse_hvcc(need(b"hvcC")?.payload)?),
        b"av01" => Codec::Av1(obu::parse_av1c(need(b"av1C")?.payload)?),
        _ => Codec::Vp9(parse_vpcc(need(b"vpcC")?.payload)?),
    };
    Ok(())
}

pub fn parse_vpcc(p: &[u8]) -> Result<VpcC, String> {
    let (v, _, rest) = full_box(p)?;
    if v != 1 {
        return Err("Unsupported vpcC version".to_string());
    }
    let mut c = Cursor::new(rest);
    let cfg = VpcC {
        profile: c.u8()?,
        level: c.u8()?,
        bits: c.u8()?,
        primaries: c.u8()?,
        transfer: c.u8()?,
        matrix: c.u8()?,
        init_len: c.u16()?,
    };
    Ok(cfg)
}

pub fn write_vpcc(v: &VpcC) -> Vec<u8> {
    vec![1, 0, 0, 0, v.profile, v.level, v.bits, v.primaries, v.transfer, v.matrix, 0, 0]
}

fn parse_audio(e: &RawBox, t: &mut Track) -> Result<(), String> {
    let p = e.payload;
    let hl = audio_entry_header_len(p);
    if p.len() < hl {
        return Err("Truncated audio sample entry".to_string());
    }
    let mut channels = u16::from_be_bytes([p[16], p[17]]);
    let mut rate = u32::from_be_bytes([p[24], p[25], p[26], p[27]]) >> 16;
    if hl == 64 {
        let mut c = Cursor::new(&p[32..]);
        let r = f64::from_bits(c.u64()?);
        let ch = c.u32()?;
        channels = ch.min(255) as u16;
        rate = if r.is_finite() && r > 0.0 && r < 1_000_000.0 { r as u32 } else { 0 };
    }
    let kids = children(&p[hl..])?;
    if kids.iter().any(|k| &k.typ == b"sinf") {
        t.encrypted = true;
    }
    t.audio = Some(Audio { channels, rate });
    t.codec = if &e.typ == b"Opus" {
        let d = find_child(&kids, b"dOps").ok_or_else(|| "Missing dOps".to_string())?;
        Codec::Opus(parse_dops(d.payload)?)
    } else {
        let mut esds = find_child(&kids, b"esds");
        if esds.is_none() {
            if let Some(w) = find_child(&kids, b"wave") {
                esds = find_child(&children(w.payload)?, b"esds");
            }
        }
        let esds = esds.ok_or_else(|| "Missing esds".to_string())?;
        let cfg = parse_esds(esds.payload)?;
        if cfg.oti == 0x40 {
            Codec::Aac(cfg)
        } else {
            Codec::Unsupported(format!("mp4a object type 0x{:02x}", cfg.oti))
        }
    };
    Ok(())
}

fn read_descr(c: &mut Cursor) -> Result<(u8, usize), String> {
    let tag = c.u8()?;
    let mut size = 0usize;
    for _ in 0..4 {
        let b = c.u8()?;
        size = (size << 7) | (b & 0x7f) as usize;
        if b & 0x80 == 0 {
            return Ok((tag, size));
        }
    }
    Err("Invalid descriptor size".to_string())
}

pub fn parse_esds(p: &[u8]) -> Result<Esds, String> {
    let (_, _, rest) = full_box(p)?;
    let mut c = Cursor::new(rest);
    let (tag, size) = read_descr(&mut c)?;
    if tag != 3 {
        return Err("esds has no ES descriptor".to_string());
    }
    let mut es = Cursor::new(c.bytes(size)?);
    es.skip(2)?;
    let flags = es.u8()?;
    if flags & 0x80 != 0 {
        es.skip(2)?;
    }
    if flags & 0x40 != 0 {
        let n = es.u8()? as usize;
        es.skip(n)?;
    }
    if flags & 0x20 != 0 {
        es.skip(2)?;
    }
    while !es.is_empty() {
        let (tag, size) = read_descr(&mut es)?;
        let body = es.bytes(size)?;
        if tag != 4 {
            continue;
        }
        let mut dc = Cursor::new(body);
        let oti = dc.u8()?;
        dc.skip(12)?;
        while !dc.is_empty() {
            let (t5, s5) = read_descr(&mut dc)?;
            let asc = dc.bytes(s5)?;
            if t5 == 5 {
                if asc.len() < 2 || asc.len() > 64 {
                    return Err("Invalid AAC decoder config".to_string());
                }
                return Ok(Esds { oti, asc: asc.to_vec() });
            }
        }
        return Err("esds has no decoder specific info".to_string());
    }
    Err("esds has no decoder config".to_string())
}

pub fn write_esds(asc: &[u8]) -> Vec<u8> {
    let dsi_len = 2 + asc.len();
    let dcd_len = 2 + 13 + dsi_len;
    let es_len = 3 + dcd_len + 3;
    let mut o = vec![0, 0, 0, 0, 3, es_len as u8, 0, 0, 0, 4, (13 + dsi_len) as u8, 0x40, 0x15];
    o.extend_from_slice(&[0; 11]);
    o.push(5);
    o.push(asc.len() as u8);
    o.extend_from_slice(asc);
    o.extend_from_slice(&[6, 1, 2]);
    o
}

pub fn parse_dops(p: &[u8]) -> Result<OpusCfg, String> {
    let mut c = Cursor::new(p);
    if c.u8()? != 0 {
        return Err("Unsupported dOps version".to_string());
    }
    let channels = c.u8()?;
    let pre_skip = c.u16()?;
    let rate = c.u32()?;
    let gain = c.i16()?;
    let family = c.u8()?;
    let (mut streams, mut coupled, mut mapping) = (0, 0, Vec::new());
    if family != 0 {
        streams = c.u8()?;
        coupled = c.u8()?;
        mapping = c.bytes(channels as usize)?.to_vec();
    } else if channels > 2 {
        return Err("Opus mapping family 0 allows at most 2 channels".to_string());
    }
    if channels == 0 {
        return Err("Opus has zero channels".to_string());
    }
    Ok(OpusCfg { channels, pre_skip, rate, gain, family, streams, coupled, mapping })
}

pub fn write_dops(o: &OpusCfg) -> Vec<u8> {
    let mut v = vec![0, o.channels];
    v.extend_from_slice(&o.pre_skip.to_be_bytes());
    v.extend_from_slice(&o.rate.to_be_bytes());
    v.extend_from_slice(&o.gain.to_be_bytes());
    v.push(o.family);
    if o.family != 0 {
        v.push(o.streams);
        v.push(o.coupled);
        v.extend_from_slice(&o.mapping);
    }
    v
}

fn table<'a>(kids: &[RawBox<'a>], t: &[u8; 4]) -> Result<Option<Cursor<'a>>, String> {
    match find_child(kids, t) {
        Some(k) => {
            let (_, _, rest) = full_box(k.payload)?;
            Ok(Some(Cursor::new(rest)))
        }
        None => Ok(None),
    }
}

fn bounded_count(c: &mut Cursor, entry: usize) -> Result<usize, String> {
    let n = c.u32()? as usize;
    if n > guard::MAX_SAMPLES || n.saturating_mul(entry) > c.remaining() {
        return Err("Sample table is too large or truncated".to_string());
    }
    Ok(n)
}

pub fn expand_samples(kids: &[RawBox]) -> Result<Vec<Sample>, String> {
    if find_child(kids, b"stz2").is_some() {
        return Err("Compact sample sizes (stz2) are not supported".to_string());
    }
    let mut stsz = table(kids, b"stsz")?.ok_or_else(|| "Missing stsz".to_string())?;
    let fixed = stsz.u32()?;
    let count = stsz.u32()? as usize;
    if count > guard::MAX_SAMPLES {
        return Err("Too many samples".to_string());
    }
    let mut sizes = Vec::with_capacity(count.min(stsz.remaining() / 4 + 1));
    if fixed == 0 {
        if count.saturating_mul(4) > stsz.remaining() {
            return Err("Truncated stsz".to_string());
        }
        for _ in 0..count {
            sizes.push(stsz.u32()?);
        }
    } else {
        sizes.resize(count, fixed);
    }

    let chunks: Vec<u64> = if let Some(mut c) = table(kids, b"stco")? {
        let n = bounded_count(&mut c, 4)?;
        (0..n).map(|_| c.u32().map(|v| v as u64)).collect::<Result<_, _>>()?
    } else if let Some(mut c) = table(kids, b"co64")? {
        let n = bounded_count(&mut c, 8)?;
        (0..n).map(|_| c.u64()).collect::<Result<_, _>>()?
    } else {
        return Err("Missing chunk offsets".to_string());
    };

    let mut stsc = table(kids, b"stsc")?.ok_or_else(|| "Missing stsc".to_string())?;
    let n = bounded_count(&mut stsc, 12)?;
    let mut runs: Vec<(u32, u32)> = Vec::with_capacity(n);
    for _ in 0..n {
        let first = stsc.u32()?;
        let spc = stsc.u32()?;
        stsc.skip(4)?;
        if first == 0 || spc == 0 || runs.last().map(|&(f, _)| first <= f).unwrap_or(false) {
            return Err("Invalid stsc entry".to_string());
        }
        runs.push((first, spc));
    }
    if count > 0 && runs.first().map(|r| r.0) != Some(1) {
        return Err("stsc must start at chunk 1".to_string());
    }

    let mut samples: Vec<Sample> = Vec::with_capacity(count);
    let mut ri = 0usize;
    for (ci, &base) in chunks.iter().enumerate() {
        let chunk_no = ci as u32 + 1;
        while ri + 1 < runs.len() && runs[ri + 1].0 <= chunk_no {
            ri += 1;
        }
        let spc = runs.get(ri).map(|r| r.1).unwrap_or(0);
        let mut off = base;
        for _ in 0..spc {
            let i = samples.len();
            let size = *sizes.get(i).ok_or_else(|| "Chunks describe more samples than stsz".to_string())?;
            samples.push(Sample { offset: off, size, dur: 0, cts: 0, sync: true });
            off = off.checked_add(size as u64).ok_or_else(|| "Sample offset overflow".to_string())?;
        }
    }
    if samples.len() != count {
        return Err("Chunks describe fewer samples than stsz".to_string());
    }

    let mut stts = table(kids, b"stts")?.ok_or_else(|| "Missing stts".to_string())?;
    let n = bounded_count(&mut stts, 8)?;
    let mut i = 0usize;
    for _ in 0..n {
        let run = stts.u32()? as usize;
        let delta = stts.u32()?;
        if run > count - i {
            return Err("stts describes more samples than stsz".to_string());
        }
        for s in &mut samples[i..i + run] {
            s.dur = delta;
        }
        i += run;
    }
    if i != count {
        return Err("stts describes fewer samples than stsz".to_string());
    }

    if let Some(mut ctts) = table(kids, b"ctts")? {
        let n = bounded_count(&mut ctts, 8)?;
        let mut i = 0usize;
        for _ in 0..n {
            let run = ctts.u32()? as usize;
            let off = ctts.i32()?;
            if run > count - i {
                return Err("ctts describes more samples than stsz".to_string());
            }
            for s in &mut samples[i..i + run] {
                s.cts = off;
            }
            i += run;
        }
        if i != count {
            return Err("ctts describes fewer samples than stsz".to_string());
        }
    }

    if let Some(mut stss) = table(kids, b"stss")? {
        let n = bounded_count(&mut stss, 4)?;
        for s in &mut samples {
            s.sync = false;
        }
        for _ in 0..n {
            let k = stss.u32()? as usize;
            if k == 0 || k > count {
                return Err("stss points outside the sample list".to_string());
            }
            samples[k - 1].sync = true;
        }
    }
    Ok(samples)
}

impl Mp4Model {
    pub fn video_index(&self) -> Option<usize> {
        self.tracks.iter().position(|t| t.is_video())
    }

    pub fn audio_index(&self) -> Option<usize> {
        self.tracks.iter().position(|t| t.is_audio() && t.codec.is_audio() && t.usable())
    }

    pub fn refuse_reasons(&self) -> Vec<String> {
        let mut r = Vec::new();
        if self.fragmented {
            r.push("Fragmented MP4 is not supported".to_string());
        }
        if self.tracks.iter().any(|t| t.encrypted) {
            r.push("Encrypted video is not supported".to_string());
        }
        if self.tracks.len() > guard::MAX_TRACKS {
            r.push(format!("File has {} tracks, over the {} track limit", self.tracks.len(), guard::MAX_TRACKS));
        }
        let videos = self.tracks.iter().filter(|t| t.is_video()).count();
        if videos == 0 {
            r.push("No video track found".to_string());
        }
        if videos > 1 {
            r.push("More than one video track is not supported".to_string());
        }
        if let Some(v) = self.video_index().and_then(|i| self.tracks.get(i)) {
            if let Some(e) = &v.error {
                r.push(format!("Video track is malformed: {e}"));
            } else {
                if let Codec::Unsupported(name) = &v.codec {
                    r.push(format!("Unsupported video codec: {name}"));
                }
                if v.entry_count != 1 {
                    r.push("Video track has more than one sample description".to_string());
                }
                if v.samples.is_empty() {
                    r.push("Video track has no samples".to_string());
                }
                if let Some(vis) = &v.visual {
                    if let Err(e) = guard::check_video_dims(vis.width as u32, vis.height as u32) {
                        r.push(e);
                    }
                }
                if rotation(&v.matrix).is_none() {
                    r.push("Video track has a transform other than a quarter turn".to_string());
                }
                if let Err(e) = guard::check_duration(v.seconds()) {
                    r.push(e);
                }
                if let Err(e) = check_edits(v, self.movie_timescale) {
                    r.push(e);
                }
            }
        }
        r
    }
}

pub fn has_leading_delay(t: &Track, movie_ts: u32) -> bool {
    match t.edits.first() {
        Some(lead) if t.edits.len() == 2 => {
            lead.media_time == -1 && lead.rate == 0x10000 && movie_ts > 0 && lead.seg <= movie_ts as u64
        }
        _ => false,
    }
}

pub fn check_edits(t: &Track, movie_ts: u32) -> Result<(), String> {
    if t.edits.is_empty() {
        return Ok(());
    }
    let e = match t.edits.as_slice() {
        [e] => *e,
        [_, e] if has_leading_delay(t, movie_ts) => *e,
        [lead, _] if lead.media_time == -1 => {
            return Err("Edit list with a leading delay longer than 1 second is not supported".to_string());
        }
        list => return Err(format!("Edit list with {} entries is not supported", list.len())),
    };
    if e.rate != 0x10000 {
        return Err("Edit list changes the playback rate".to_string());
    }
    if e.media_time < 0 {
        return Err("Edit list with an empty edit is not supported".to_string());
    }
    let ts = t.timescale.max(1) as i128;
    let mt = e.media_time as i128;
    let limit = if t.is_video() {
        t.samples.iter().map(|s| s.cts as i128).max().unwrap_or(0).max(0)
    } else {
        ts / 10
    };
    if mt > limit {
        return Err(format!("Edit list hides the first {} ms of the track", mt * 1000 / ts));
    }
    if e.seg > 0 && movie_ts > 0 {
        let seg_media = e.seg as i128 * t.timescale as i128 / movie_ts as i128;
        let total = t.total_dur() as i128;
        let max_dur = t.samples.iter().map(|s| s.dur as i128).max().unwrap_or(0);
        let tolerance = (2 * max_dur).max(ts / 20);
        if seg_media + tolerance < total - mt {
            return Err(format!("Edit list hides the last {} ms of the track", (total - mt - seg_media) * 1000 / ts));
        }
    }
    Ok(())
}
