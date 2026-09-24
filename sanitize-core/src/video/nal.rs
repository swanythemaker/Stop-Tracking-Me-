use super::reader::{find, Cursor};
use super::report::Finding;
use crate::allowlist::{self, Group};
use crate::guard;

#[derive(Default, Debug)]
pub struct NalStats {
    pub kept: usize,
    pub dropped: Vec<u8>,
}

pub fn split_len_prefixed(sample: &[u8], len_size: u8) -> Result<Vec<&[u8]>, String> {
    if !(1..=4).contains(&len_size) {
        return Err(format!("Invalid NAL length size {len_size}"));
    }
    let ls = len_size as usize;
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < sample.len() {
        if sample.len() - pos < ls {
            return Err("Truncated NAL length prefix".to_string());
        }
        let mut len = 0usize;
        for &b in &sample[pos..pos + ls] {
            len = (len << 8) | b as usize;
        }
        pos += ls;
        if len == 0 {
            return Err("Empty NAL unit".to_string());
        }
        if len > sample.len() - pos {
            return Err("NAL unit runs past the end of its sample".to_string());
        }
        out.push(&sample[pos..pos + len]);
        pos += len;
        if out.len() > guard::MAX_NALS_PER_SAMPLE {
            return Err("Too many NAL units in one sample".to_string());
        }
    }
    Ok(out)
}

pub fn avc_type(nal: &[u8]) -> u8 {
    nal.first().map(|b| b & 0x1f).unwrap_or(0)
}

pub fn hevc_type(nal: &[u8]) -> u8 {
    nal.first().map(|b| (b >> 1) & 0x3f).unwrap_or(0)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NalKind {
    Avc,
    Hevc,
}

impl NalKind {
    pub fn nal_type(self, nal: &[u8]) -> u8 {
        match self {
            NalKind::Avc => avc_type(nal),
            NalKind::Hevc => hevc_type(nal),
        }
    }

    pub fn ok(self, t: u8) -> bool {
        match self {
            NalKind::Avc => allowlist::avc_nal_ok(t),
            NalKind::Hevc => allowlist::hevc_nal_ok(t),
        }
    }

    pub fn is_sei(self, t: u8) -> bool {
        match self {
            NalKind::Avc => t == 6,
            NalKind::Hevc => t == 39 || t == 40,
        }
    }
}

pub fn filter_nals(kind: NalKind, sample: &[u8], len_size: u8, out: &mut Vec<u8>) -> Result<NalStats, String> {
    let mut stats = NalStats::default();
    for nal in split_len_prefixed(sample, len_size)? {
        if nal[0] & 0x80 != 0 {
            return Err("NAL unit has the forbidden bit set".to_string());
        }
        let t = kind.nal_type(nal);
        if kind.ok(t) {
            let len = nal.len() as u64;
            let be = len.to_be_bytes();
            out.extend_from_slice(&be[8 - len_size as usize..]);
            out.extend_from_slice(nal);
            stats.kept += 1;
        } else {
            stats.dropped.push(t);
        }
    }
    if stats.kept == 0 {
        return Err("Sample has no picture data after filtering".to_string());
    }
    Ok(stats)
}

pub fn filter_avc(sample: &[u8], len_size: u8, out: &mut Vec<u8>) -> Result<NalStats, String> {
    filter_nals(NalKind::Avc, sample, len_size, out)
}

pub fn filter_hevc(sample: &[u8], len_size: u8, out: &mut Vec<u8>) -> Result<NalStats, String> {
    filter_nals(NalKind::Hevc, sample, len_size, out)
}

pub fn sei_label(nal: &[u8]) -> &'static str {
    if find(nal, b"x264 - core") {
        "user data (x264 build string)"
    } else if find(nal, b"x265 (build") {
        "user data (x265 build string)"
    } else {
        "message"
    }
}

pub fn nal_finding(kind: NalKind, nal: &[u8]) -> Finding {
    let t = kind.nal_type(nal);
    if kind.is_sei(t) {
        Finding::new("SEI", Group::Software, sei_label(nal))
    } else {
        Finding::new(format!("NAL type {t}"), Group::Hidden, "non-picture unit")
    }
}

pub fn nal_findings(kind: NalKind, sample: &[u8], len_size: u8) -> Result<Vec<Finding>, String> {
    let mut out = Vec::new();
    for nal in split_len_prefixed(sample, len_size)? {
        if nal[0] & 0x80 != 0 {
            return Err("NAL unit has the forbidden bit set".to_string());
        }
        if !kind.ok(kind.nal_type(nal)) {
            out.push(nal_finding(kind, nal));
        }
    }
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AvcConfig {
    pub profile: u8,
    pub compat: u8,
    pub level: u8,
    pub len_size: u8,
    pub sps: Vec<Vec<u8>>,
    pub pps: Vec<Vec<u8>>,
    pub ext: Option<[u8; 3]>,
    pub dropped: Vec<Finding>,
}

fn read_nal_list(c: &mut Cursor, n: usize) -> Result<Vec<Vec<u8>>, String> {
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        let len = c.u16()? as usize;
        if len == 0 {
            return Err("Empty parameter set".to_string());
        }
        v.push(c.bytes(len)?.to_vec());
    }
    Ok(v)
}

pub fn parse_avcc(b: &[u8]) -> Result<AvcConfig, String> {
    let mut c = Cursor::new(b);
    if c.u8()? != 1 {
        return Err("Unsupported avcC version".to_string());
    }
    let profile = c.u8()?;
    let compat = c.u8()?;
    let level = c.u8()?;
    let len_size = (c.u8()? & 3) + 1;
    if len_size == 3 {
        return Err("Invalid avcC NAL length size".to_string());
    }
    let nsps = (c.u8()? & 0x1f) as usize;
    let sps_all = read_nal_list(&mut c, nsps)?;
    let npps = c.u8()? as usize;
    let pps_all = read_nal_list(&mut c, npps)?;
    let mut dropped = Vec::new();
    let mut sps = Vec::new();
    for s in sps_all {
        if avc_type(&s) == 7 {
            sps.push(s);
        } else {
            dropped.push(nal_finding(NalKind::Avc, &s));
        }
    }
    let mut pps = Vec::new();
    for p in pps_all {
        if avc_type(&p) == 8 {
            pps.push(p);
        } else {
            dropped.push(nal_finding(NalKind::Avc, &p));
        }
    }
    let mut ext = None;
    if [100u8, 110, 122, 144].contains(&profile) && c.remaining() >= 4 {
        let a = c.u8()? & 3;
        let l = c.u8()? & 7;
        let cc = c.u8()? & 7;
        let next = c.u8()? as usize;
        let exts = read_nal_list(&mut c, next)?;
        if !exts.is_empty() {
            dropped.push(Finding::new("avcC", Group::Hidden, "SPS extension"));
        }
        ext = Some([a, l, cc]);
    }
    if c.remaining() > 0 {
        dropped.push(Finding::new("avcC", Group::Hidden, "trailing bytes"));
    }
    if sps.is_empty() || pps.is_empty() {
        return Err("avcC has no SPS or PPS".to_string());
    }
    Ok(AvcConfig { profile, compat, level, len_size, sps, pps, ext, dropped })
}

pub fn write_avcc(cfg: &AvcConfig) -> Vec<u8> {
    let mut o = vec![1, cfg.profile, cfg.compat, cfg.level, 0xFC | (cfg.len_size - 1)];
    o.push(0xE0 | (cfg.sps.len().min(31) as u8));
    for s in cfg.sps.iter().take(31) {
        o.extend_from_slice(&(s.len() as u16).to_be_bytes());
        o.extend_from_slice(s);
    }
    o.push(cfg.pps.len().min(255) as u8);
    for p in cfg.pps.iter().take(255) {
        o.extend_from_slice(&(p.len() as u16).to_be_bytes());
        o.extend_from_slice(p);
    }
    if let Some([a, l, cc]) = cfg.ext {
        o.extend_from_slice(&[0xFC | a, 0xF8 | l, 0xF8 | cc, 0]);
    }
    o
}

pub fn rebuild_avcc(b: &[u8]) -> Result<Vec<u8>, String> {
    let cfg = parse_avcc(b)?;
    if cfg.sps.len() > 31 || cfg.sps.iter().chain(cfg.pps.iter()).any(|s| s.len() > 0xFFFF) {
        return Err("avcC has too many parameter sets".to_string());
    }
    Ok(write_avcc(&cfg))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HvcConfig {
    pub header: [u8; 22],
    pub arrays: Vec<(u8, Vec<Vec<u8>>)>,
    pub dropped: Vec<Finding>,
}

impl HvcConfig {
    pub fn len_size(&self) -> u8 {
        (self.header[21] & 3) + 1
    }
}

pub fn parse_hvcc(b: &[u8]) -> Result<HvcConfig, String> {
    let mut c = Cursor::new(b);
    let head = c.bytes(22)?;
    if head[0] != 1 {
        return Err("Unsupported hvcC version".to_string());
    }
    let mut header = [0u8; 22];
    header.copy_from_slice(head);
    if (header[21] & 3) == 2 {
        return Err("Invalid hvcC NAL length size".to_string());
    }
    let n = c.u8()? as usize;
    let mut arrays = Vec::new();
    let mut dropped = Vec::new();
    for _ in 0..n {
        let first = c.u8()?;
        let t = first & 0x3f;
        let count = c.u16()? as usize;
        let nals = read_nal_list(&mut c, count)?;
        if (32..=34).contains(&t) {
            let mut keep = Vec::new();
            for nal in nals {
                if hevc_type(&nal) == t {
                    keep.push(nal);
                } else {
                    dropped.push(nal_finding(NalKind::Hevc, &nal));
                }
            }
            if !keep.is_empty() {
                arrays.push((first & 0xBF, keep));
            }
        } else {
            for nal in &nals {
                let mut f = nal_finding(NalKind::Hevc, nal);
                f.name = format!("hvcC {}", f.name);
                dropped.push(f);
            }
            if nals.is_empty() {
                dropped.push(Finding::new("hvcC", Group::Hidden, format!("empty array type {t}")));
            }
        }
    }
    if c.remaining() > 0 {
        dropped.push(Finding::new("hvcC", Group::Hidden, "trailing bytes"));
    }
    for t in 32..=34u8 {
        if !arrays.iter().any(|(f, _)| f & 0x3f == t) {
            return Err("hvcC is missing VPS, SPS or PPS".to_string());
        }
    }
    Ok(HvcConfig { header, arrays, dropped })
}

pub fn write_hvcc(cfg: &HvcConfig) -> Vec<u8> {
    let mut o = cfg.header.to_vec();
    o.push(cfg.arrays.len() as u8);
    for (first, nals) in &cfg.arrays {
        o.push(*first);
        o.extend_from_slice(&(nals.len() as u16).to_be_bytes());
        for n in nals {
            o.extend_from_slice(&(n.len() as u16).to_be_bytes());
            o.extend_from_slice(n);
        }
    }
    o
}

pub fn rebuild_hvcc(b: &[u8]) -> Result<Vec<u8>, String> {
    Ok(write_hvcc(&parse_hvcc(b)?))
}

pub const AVC_PROFILES: [u8; 16] = [66, 77, 88, 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
const HIGH_EXT_PROFILES: [u8; 4] = [100, 110, 122, 144];

fn rbsp(nal: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(nal.len());
    let mut zeros = 0;
    for &b in nal {
        if zeros >= 2 && b == 3 {
            zeros = 0;
            continue;
        }
        zeros = if b == 0 { zeros + 1 } else { 0 };
        out.push(b);
    }
    out
}

struct Bits<'a> {
    b: &'a [u8],
    pos: usize,
}

impl Bits<'_> {
    fn bit(&mut self) -> Option<u32> {
        let byte = *self.b.get(self.pos / 8)?;
        let v = (byte >> (7 - (self.pos % 8))) & 1;
        self.pos += 1;
        Some(v as u32)
    }

    fn ue(&mut self) -> Option<u32> {
        let mut zeros = 0;
        while self.bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return None;
            }
        }
        let mut v: u64 = 1;
        for _ in 0..zeros {
            v = (v << 1) | self.bit()? as u64;
        }
        u32::try_from(v - 1).ok()
    }
}

pub fn sps_high_ext(sps: &[u8]) -> Option<[u8; 3]> {
    let r = rbsp(sps.get(1..)?);
    let profile = *r.first()?;
    if !HIGH_EXT_PROFILES.contains(&profile) {
        return None;
    }
    let mut bits = Bits { b: r.get(3..)?, pos: 0 };
    bits.ue()?;
    let chroma = bits.ue()?;
    if chroma > 3 {
        return None;
    }
    if chroma == 3 {
        bits.bit()?;
    }
    let luma = bits.ue()?;
    let cdepth = bits.ue()?;
    if luma > 6 || cdepth > 6 {
        return None;
    }
    Some([chroma as u8, luma as u8, cdepth as u8])
}

pub fn repair_param_set(nal: &[u8], sps: bool) -> Vec<u8> {
    if nal.len() >= 3 && nal[0] == nal[1] {
        let valid_now = !sps || AVC_PROFILES.contains(&nal[1]);
        let valid_repaired = !sps || AVC_PROFILES.contains(&nal[2]);
        if !valid_now && valid_repaired {
            return nal[1..].to_vec();
        }
        if !sps && (nal[0] & 0x1f) == 8 {
            return nal[1..].to_vec();
        }
    }
    nal.to_vec()
}

pub fn repair_avcc(cfg: &AvcConfig) -> AvcConfig {
    let mut c = cfg.clone();
    let doubled_sps = cfg.sps.iter().any(|s| s.len() >= 3 && s[0] == s[1] && !AVC_PROFILES.contains(&s[1]));
    c.sps = cfg.sps.iter().map(|s| repair_param_set(s, true)).collect();
    if doubled_sps {
        c.pps = cfg.pps.iter().map(|p| repair_param_set(p, false)).collect();
    }
    if let Some(first) = c.sps.first() {
        if first.len() >= 4 {
            c.profile = first[1];
            c.compat = first[2];
            c.level = first[3];
        }
    }
    c
}

pub fn build_avcc(cfg: &AvcConfig, inband_sps: &[Vec<u8>], inband_pps: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    let mut c = if !inband_sps.is_empty() && !inband_pps.is_empty() {
        let first = &inband_sps[0];
        if first.len() < 4 {
            return Err("In-band SPS is too short".to_string());
        }
        AvcConfig {
            profile: first[1],
            compat: first[2],
            level: first[3],
            len_size: cfg.len_size,
            sps: inband_sps.to_vec(),
            pps: inband_pps.to_vec(),
            ext: cfg.ext,
            dropped: Vec::new(),
        }
    } else {
        repair_avcc(cfg)
    };
    if !AVC_PROFILES.contains(&c.profile) {
        return Err("avcC has an unknown H.264 profile".to_string());
    }
    if HIGH_EXT_PROFILES.contains(&c.profile) {
        if c.ext.is_none() {
            c.ext = Some(c.sps.first().and_then(|s| sps_high_ext(s)).unwrap_or([1, 0, 0]));
        }
    } else {
        c.ext = None;
    }
    if c.sps.len() > 31 || c.pps.len() > 255 || c.sps.iter().chain(c.pps.iter()).any(|s| s.len() > 0xFFFF) {
        return Err("avcC has too many parameter sets".to_string());
    }
    c.dropped.clear();
    Ok(write_avcc(&c))
}

pub fn avcc_canonical(b: &[u8]) -> Result<(), String> {
    let cfg = parse_avcc(b)?;
    if !cfg.dropped.is_empty() {
        return Err(format!("avcC carries {}", cfg.dropped[0].line()));
    }
    if write_avcc(&cfg) != b {
        return Err("avcC is not in canonical form".to_string());
    }
    if !AVC_PROFILES.contains(&cfg.profile) || cfg.sps.iter().any(|s| s.len() < 4 || s[1] != cfg.profile) {
        return Err("avcC SPS does not match its header".to_string());
    }
    if HIGH_EXT_PROFILES.contains(&cfg.profile) != cfg.ext.is_some() {
        return Err("avcC High profile extension is missing or misplaced".to_string());
    }
    Ok(())
}

pub fn collect_param_sets(sample: &[u8], len_size: u8, sps: &mut Vec<Vec<u8>>, pps: &mut Vec<Vec<u8>>) -> Result<(), String> {
    for nal in split_len_prefixed(sample, len_size)? {
        match avc_type(nal) {
            7 if !sps.iter().any(|s| s == nal) => sps.push(nal.to_vec()),
            8 if !pps.iter().any(|p| p == nal) => pps.push(nal.to_vec()),
            _ => {}
        }
    }
    Ok(())
}
