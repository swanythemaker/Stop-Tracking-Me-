use super::reader::{check_feed, Req};
use crate::allowlist::{self as al};
use crate::guard;

pub const UNKNOWN_SIZE: u64 = u64::MAX;

pub fn read_id(b: &[u8], pos: usize) -> Result<(u32, usize), String> {
    let first = *b.get(pos).ok_or_else(|| "Truncated element ID".to_string())?;
    let len = first.leading_zeros() as usize + 1;
    if len > 4 {
        return Err("Invalid element ID".to_string());
    }
    let s = b.get(pos..pos + len).ok_or_else(|| "Truncated element ID".to_string())?;
    let mut v = 0u32;
    for &x in s {
        v = (v << 8) | x as u32;
    }
    Ok((v, len))
}

pub fn read_size(b: &[u8], pos: usize) -> Result<(u64, usize), String> {
    let first = *b.get(pos).ok_or_else(|| "Truncated element size".to_string())?;
    if first == 0 {
        return Err("Invalid element size".to_string());
    }
    let len = first.leading_zeros() as usize + 1;
    let s = b.get(pos..pos + len).ok_or_else(|| "Truncated element size".to_string())?;
    let mut v = (first as u64) & ((1u64 << (8 - len)) - 1);
    for &x in &s[1..] {
        v = (v << 8) | x as u64;
    }
    let all_ones = (1u64 << (7 * len)) - 1;
    if v == all_ones {
        return Ok((UNKNOWN_SIZE, len));
    }
    Ok((v, len))
}

#[derive(Clone, Copy, Debug)]
pub struct Elem<'a> {
    pub id: u32,
    pub data: &'a [u8],
    pub offset: usize,
    pub header_len: usize,
}

pub fn children(b: &[u8]) -> Result<Vec<Elem<'_>>, String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < b.len() {
        let (id, il) = read_id(b, pos)?;
        let (size, sl) = read_size(b, pos + il)?;
        if size == UNKNOWN_SIZE {
            return Err(format!("Unknown-size element {} is not supported", name(id)));
        }
        let start = pos + il + sl;
        let end = usize::try_from(size)
            .ok()
            .and_then(|s| start.checked_add(s))
            .filter(|&e| e <= b.len())
            .ok_or_else(|| format!("Element {} runs past the end of its parent", name(id)))?;
        out.push(Elem { id, data: &b[start..end], offset: pos, header_len: il + sl });
        pos = end;
        if out.len() > 1_000_000 {
            return Err("Too many elements".to_string());
        }
    }
    Ok(out)
}

pub fn child<'a>(kids: &[Elem<'a>], id: u32) -> Option<Elem<'a>> {
    kids.iter().find(|k| k.id == id).copied()
}

pub fn uint(d: &[u8]) -> Result<u64, String> {
    if d.len() > 8 {
        return Err("Integer element is too long".to_string());
    }
    Ok(d.iter().fold(0u64, |a, &x| (a << 8) | x as u64))
}

pub fn float(d: &[u8]) -> Result<f64, String> {
    match d.len() {
        0 => Ok(0.0),
        4 => Ok(f32::from_bits(u32::from_be_bytes([d[0], d[1], d[2], d[3]])) as f64),
        8 => {
            let mut a = [0u8; 8];
            a.copy_from_slice(d);
            Ok(f64::from_bits(u64::from_be_bytes(a)))
        }
        _ => Err("Float element has an invalid length".to_string()),
    }
}

pub fn text(d: &[u8]) -> String {
    let end = d.iter().position(|&c| c == 0).unwrap_or(d.len());
    String::from_utf8_lossy(&d[..end]).into_owned()
}

pub fn write_id(o: &mut Vec<u8>, id: u32) {
    let bytes = id.to_be_bytes();
    let skip = bytes.iter().position(|&b| b != 0).unwrap_or(3);
    o.extend_from_slice(&bytes[skip..]);
}

pub fn write_size(o: &mut Vec<u8>, size: u64) {
    let mut len = 1;
    while len < 8 && size >= (1u64 << (7 * len)) - 1 {
        len += 1;
    }
    write_size_len(o, size, len);
}

pub fn write_size_len(o: &mut Vec<u8>, size: u64, len: usize) {
    let marked = size | (1u64 << (7 * len));
    let bytes = marked.to_be_bytes();
    o.extend_from_slice(&bytes[8 - len..]);
}

pub fn elem(o: &mut Vec<u8>, id: u32, data: &[u8]) {
    write_id(o, id);
    write_size(o, data.len() as u64);
    o.extend_from_slice(data);
}

pub fn uint_bytes(v: u64) -> Vec<u8> {
    let b = v.to_be_bytes();
    let skip = b.iter().position(|&x| x != 0).unwrap_or(7);
    b[skip..].to_vec()
}

pub fn elem_uint(o: &mut Vec<u8>, id: u32, v: u64) {
    elem(o, id, &uint_bytes(v));
}

pub fn elem_float(o: &mut Vec<u8>, id: u32, v: f64) {
    elem(o, id, &v.to_bits().to_be_bytes());
}

pub fn name(id: u32) -> String {
    let known: &[(u32, &str)] = &[
        (al::EBML_HEADER, "EBML"),
        (al::MKV_SEGMENT, "Segment"),
        (al::MKV_SEEKHEAD, "SeekHead"),
        (al::MKV_INFO, "Info"),
        (al::MKV_TRACKS, "Tracks"),
        (al::MKV_TRACKENTRY, "TrackEntry"),
        (al::MKV_CLUSTER, "Cluster"),
        (al::MKV_CUES, "Cues"),
        (al::MKV_TIMESTAMP, "Timestamp"),
        (al::MKV_SIMPLEBLOCK, "SimpleBlock"),
        (al::MKV_BLOCKGROUP, "BlockGroup"),
        (al::MKV_MUXINGAPP, "MuxingApp"),
        (al::MKV_WRITINGAPP, "WritingApp"),
        (al::MKV_TIMESTAMPSCALE, "TimestampScale"),
        (al::MKV_DURATION, "Duration"),
        (al::MKV_VIDEO, "Video"),
        (al::MKV_AUDIO, "Audio"),
        (al::MKV_CODECPRIVATE, "CodecPrivate"),
        (al::MKV_TRACKUID, "TrackUID"),
    ];
    if let Some((_, n)) = known.iter().find(|(i, _)| *i == id) {
        return n.to_string();
    }
    if let Some((_, n, _)) = al::mkv_deny(id) {
        return n.to_string();
    }
    format!("0x{id:X}")
}

#[derive(Clone, Copy, Debug)]
pub struct TopElem {
    pub id: u32,
    pub start: u64,
    pub header_len: u32,
    pub size: u64,
}

impl TopElem {
    pub fn end(&self) -> u64 {
        self.start + self.header_len as u64 + self.size
    }

    pub fn data_start(&self) -> u64 {
        self.start + self.header_len as u64
    }
}

pub struct MkvFront {
    file_len: u64,
    pos: u64,
    stage: u8,
    pub header: Option<TopElem>,
    pub segment: Option<TopElem>,
    pub elems: Vec<TopElem>,
    pub error: Option<String>,
    pub trailing: Option<u64>,
}

impl MkvFront {
    pub fn new(file_len: u64) -> Self {
        MkvFront { file_len, pos: 0, stage: 0, header: None, segment: None, elems: Vec::new(), error: None, trailing: None }
    }

    pub fn done(&self) -> bool {
        self.stage >= 3
    }

    pub fn need(&self) -> Option<Req> {
        if self.done() {
            return None;
        }
        Some(Req { offset: self.pos, len: (self.file_len - self.pos).min(12) as u32 })
    }

    fn fail(&mut self, e: String) {
        self.error = Some(e);
        self.stage = 3;
    }

    pub fn feed(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let want = self.need().ok_or_else(|| "Unexpected read".to_string())?;
        check_feed(want, offset, bytes)?;
        let parsed = read_id(bytes, 0).and_then(|(id, il)| read_size(bytes, il).map(|(s, sl)| (id, il + sl, s)));
        let (id, hl, size) = match parsed {
            Ok(v) => v,
            Err(e) => {
                if self.stage == 2 {
                    self.trailing = Some(self.pos);
                    self.stage = 3;
                } else {
                    self.fail(e);
                }
                return Ok(());
            }
        };
        if size == UNKNOWN_SIZE {
            self.fail(format!("Unknown-size element {} is not supported", name(id)));
            return Ok(());
        }
        let el = TopElem { id, start: self.pos, header_len: hl as u32, size };
        let end = el.data_start().checked_add(size).filter(|&e| e <= self.file_len);
        match self.stage {
            0 => {
                if id != al::EBML_HEADER {
                    self.fail("Missing EBML header".to_string());
                    return Ok(());
                }
                match end {
                    Some(e) if size <= 1024 => {
                        self.header = Some(el);
                        self.pos = e;
                        self.stage = 1;
                    }
                    _ => self.fail("Invalid EBML header size".to_string()),
                }
            }
            1 => {
                if id != al::MKV_SEGMENT {
                    self.fail("Missing Matroska Segment".to_string());
                    return Ok(());
                }
                match end {
                    Some(e) => {
                        self.segment = Some(el);
                        self.pos = el.data_start();
                        if e < self.file_len {
                            self.trailing = Some(e);
                        }
                        self.stage = if size == 0 { 3 } else { 2 };
                    }
                    None => self.fail("Segment runs past the end of the file".to_string()),
                }
            }
            _ => {
                let seg_end = self.segment.map(|s| s.end()).unwrap_or(self.file_len);
                match end.filter(|&e| e <= seg_end) {
                    Some(e) => {
                        self.elems.push(el);
                        self.pos = e;
                        if e == seg_end {
                            self.stage = 3;
                        } else if self.elems.len() >= guard::MAX_TOP_LEVEL {
                            self.fail("Too many top-level elements".to_string());
                        }
                    }
                    None => self.fail(format!("Element {} runs past the end of the Segment", name(id))),
                }
            }
        }
        Ok(())
    }
}
