use super::nal::NalStats;
use super::reader::find;
use super::report::Finding;
use crate::allowlist::{self, Group};
use crate::guard;

#[derive(Clone, Copy, Debug)]
pub struct Obu<'a> {
    pub typ: u8,
    pub bytes: &'a [u8],
    pub has_size: bool,
}

fn leb128(b: &[u8], pos: usize) -> Result<(u64, usize), String> {
    let mut v: u64 = 0;
    for i in 0..8 {
        let byte = *b.get(pos + i).ok_or_else(|| "Truncated OBU size".to_string())?;
        v |= ((byte & 0x7f) as u64) << (7 * i);
        if byte & 0x80 == 0 {
            return Ok((v, i + 1));
        }
    }
    Err("OBU size is too long".to_string())
}

pub fn split_obus(b: &[u8]) -> Result<Vec<Obu<'_>>, String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < b.len() {
        let h = b[pos];
        if h & 0x80 != 0 {
            return Err("OBU has the forbidden bit set".to_string());
        }
        let typ = (h >> 3) & 0x0f;
        let has_ext = h & 0x04 != 0;
        let has_size = h & 0x02 != 0;
        let mut hl = 1 + has_ext as usize;
        if pos + hl > b.len() {
            return Err("Truncated OBU header".to_string());
        }
        let end = if has_size {
            let (size, n) = leb128(b, pos + hl)?;
            hl += n;
            let size = usize::try_from(size).map_err(|_| "OBU too large".to_string())?;
            pos.checked_add(hl)
                .and_then(|x| x.checked_add(size))
                .filter(|&e| e <= b.len())
                .ok_or_else(|| "OBU runs past the end of its sample".to_string())?
        } else {
            b.len()
        };
        out.push(Obu { typ, bytes: &b[pos..end], has_size });
        pos = end;
        if out.len() > guard::MAX_NALS_PER_SAMPLE {
            return Err("Too many OBUs in one sample".to_string());
        }
    }
    Ok(out)
}

pub fn obu_finding(o: &Obu) -> Finding {
    match o.typ {
        5 => {
            let text = if find(o.bytes, b"x264") || find(o.bytes, b"Lav") {
                "metadata OBU (encoder string)"
            } else {
                "metadata OBU (HDR, timecode or vendor data)"
            };
            Finding::new("OBU", Group::Hidden, text)
        }
        15 => Finding::new("OBU", Group::Hidden, "padding OBU"),
        8 => Finding::new("OBU", Group::Hidden, "tile list OBU"),
        t => Finding::new("OBU", Group::Hidden, format!("reserved type {t}")),
    }
}

pub fn filter_av1(sample: &[u8], out: &mut Vec<u8>) -> Result<NalStats, String> {
    let mut stats = NalStats::default();
    for o in split_obus(sample)? {
        if allowlist::av1_obu_ok(o.typ) {
            out.extend_from_slice(o.bytes);
            stats.kept += 1;
        } else {
            stats.dropped.push(o.typ);
        }
    }
    if stats.kept == 0 {
        return Err("Sample has no picture data after filtering".to_string());
    }
    Ok(stats)
}

pub fn av1_findings(sample: &[u8]) -> Result<Vec<Finding>, String> {
    Ok(split_obus(sample)?.iter().filter(|o| !allowlist::av1_obu_ok(o.typ)).map(obu_finding).collect())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Av1Config {
    pub head: [u8; 4],
    pub seq: Vec<u8>,
    pub dropped: Vec<Finding>,
}

pub fn parse_av1c(b: &[u8]) -> Result<Av1Config, String> {
    if b.len() < 4 {
        return Err("Truncated av1C".to_string());
    }
    if b[0] != 0x81 {
        return Err("Unsupported av1C version".to_string());
    }
    let head = [b[0], b[1], b[2], b[3]];
    let mut seq = Vec::new();
    let mut dropped = Vec::new();
    for o in split_obus(&b[4..])? {
        if o.typ == 1 && o.has_size {
            seq.extend_from_slice(o.bytes);
        } else {
            let mut f = obu_finding(&o);
            f.name = "av1C".to_string();
            if o.typ == 1 {
                f.text = "sequence header without size".to_string();
            }
            dropped.push(f);
        }
    }
    Ok(Av1Config { head, seq, dropped })
}

pub fn write_av1c(cfg: &Av1Config) -> Vec<u8> {
    let mut o = cfg.head.to_vec();
    o.extend_from_slice(&cfg.seq);
    o
}

pub fn rebuild_av1c(b: &[u8]) -> Result<Vec<u8>, String> {
    Ok(write_av1c(&parse_av1c(b)?))
}
