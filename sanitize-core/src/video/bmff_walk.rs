use super::reader::{check_feed, Req};
use super::report::human_name;
use crate::allowlist;
use crate::guard;

#[derive(Clone, Debug)]
pub struct BoxHeader {
    pub typ: [u8; 4],
    pub start: u64,
    pub header_len: u32,
    pub size: u64,
    pub usertype: Option<[u8; 16]>,
}

impl BoxHeader {
    pub fn end(&self) -> u64 {
        self.start + self.size
    }

    pub fn payload_start(&self) -> u64 {
        self.start + self.header_len as u64
    }

    pub fn name(&self) -> String {
        human_name(&self.typ)
    }
}

pub fn read_box_header(b: &[u8], start: u64, limit: u64) -> Result<BoxHeader, String> {
    if b.len() < 8 {
        return Err("Truncated box header".to_string());
    }
    let size32 = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
    let typ = [b[4], b[5], b[6], b[7]];
    let avail = limit.checked_sub(start).ok_or_else(|| "Box starts past its parent".to_string())?;
    let mut header_len: u32 = 8;
    let size = match size32 {
        0 => avail,
        1 => {
            if b.len() < 16 {
                return Err(format!("Truncated 64-bit size for {}", human_name(&typ)));
            }
            header_len = 16;
            let mut a = [0u8; 8];
            a.copy_from_slice(&b[8..16]);
            u64::from_be_bytes(a)
        }
        n => n as u64,
    };
    let mut usertype = None;
    if &typ == b"uuid" {
        let o = header_len as usize;
        if b.len() < o + 16 {
            return Err("Truncated uuid box header".to_string());
        }
        let mut u = [0u8; 16];
        u.copy_from_slice(&b[o..o + 16]);
        usertype = Some(u);
        header_len += 16;
    }
    if size < header_len as u64 {
        return Err(format!("Box {} has an invalid size", human_name(&typ)));
    }
    if size > avail {
        return Err(format!("Box {} runs past the end of its parent", human_name(&typ)));
    }
    Ok(BoxHeader { typ, start, header_len, size, usertype })
}

#[derive(Clone, Copy, Debug)]
pub struct RawBox<'a> {
    pub typ: [u8; 4],
    pub payload: &'a [u8],
    pub usertype: Option<[u8; 16]>,
    pub offset: usize,
    pub header_len: usize,
}

pub fn children(b: &[u8]) -> Result<Vec<RawBox<'_>>, String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < b.len() {
        let rest = &b[pos..];
        if rest.len() < 8 {
            if rest.iter().all(|&x| x == 0) {
                break;
            }
            return Err("Trailing bytes inside a box".to_string());
        }
        let h = read_box_header(rest, 0, rest.len() as u64)?;
        let size = h.size as usize;
        let hl = h.header_len as usize;
        out.push(RawBox { typ: h.typ, payload: &rest[hl..size], usertype: h.usertype, offset: pos, header_len: hl });
        pos += size;
    }
    Ok(out)
}

pub fn find_child<'a>(kids: &[RawBox<'a>], t: &[u8; 4]) -> Option<RawBox<'a>> {
    kids.iter().find(|k| &k.typ == t).copied()
}

pub fn full_box(payload: &[u8]) -> Result<(u8, u32, &[u8]), String> {
    if payload.len() < 4 {
        return Err("Truncated full box".to_string());
    }
    let flags = ((payload[1] as u32) << 16) | ((payload[2] as u32) << 8) | payload[3] as u32;
    Ok((payload[0], flags, &payload[4..]))
}

const PLAIN_CONTAINERS: [&[u8; 4]; 19] = [
    b"moov", b"trak", b"mdia", b"minf", b"dinf", b"stbl", b"udta", b"edts", b"ilst", b"wave", b"gmhd", b"tref",
    b"mvex", b"sinf", b"schi", b"moof", b"traf", b"mfra", b"tapt",
];

pub fn audio_entry_header_len(payload: &[u8]) -> usize {
    match payload.get(8..10) {
        Some([0, 1]) => 44,
        Some([0, 2]) => 64,
        _ => 28,
    }
}

pub fn container_prefix(parent: &[u8; 4], typ: &[u8; 4], payload: &[u8]) -> Option<usize> {
    if parent == b"ilst" {
        return Some(0);
    }
    if PLAIN_CONTAINERS.contains(&typ) {
        return Some(0);
    }
    if typ == b"meta" {
        return if payload.get(4..8) == Some(b"hdlr") { Some(0) } else { Some(4) };
    }
    if typ == b"stsd" || typ == b"dref" {
        return Some(8);
    }
    if parent == b"stsd" {
        if allowlist::MP4_VISUAL_ENTRIES.contains(&typ) || [b"encv", b"avc3", b"mp4v"].contains(&typ) {
            return if payload.len() >= 78 { Some(78) } else { None };
        }
        if allowlist::MP4_AUDIO_ENTRIES.contains(&typ) || typ == b"enca" {
            let n = audio_entry_header_len(payload);
            return if payload.len() >= n { Some(n) } else { None };
        }
    }
    None
}

pub struct Node<'a> {
    pub path: String,
    pub typ: [u8; 4],
    pub parent: [u8; 4],
    pub payload: &'a [u8],
    pub usertype: Option<[u8; 16]>,
    pub depth: usize,
}

pub fn walk_tree(
    parent: [u8; 4],
    parent_path: &str,
    body: &[u8],
    depth: usize,
    visit: &mut dyn FnMut(&Node) -> bool,
) -> Result<(), String> {
    if depth > guard::MAX_BOX_DEPTH {
        return Err("Boxes nested too deeply".to_string());
    }
    for k in children(body)? {
        let name = human_name(&k.typ);
        let path = if parent_path.is_empty() { name } else { format!("{parent_path}/{name}") };
        let node = Node { path: path.clone(), typ: k.typ, parent, payload: k.payload, usertype: k.usertype, depth };
        if visit(&node) {
            if let Some(prefix) = container_prefix(&parent, &k.typ, k.payload) {
                if let Some(inner) = k.payload.get(prefix..) {
                    walk_tree(k.typ, &path, inner, depth + 1, visit)?;
                }
            }
        }
    }
    Ok(())
}

pub struct TopWalk {
    file_len: u64,
    pos: u64,
    pub boxes: Vec<BoxHeader>,
    pub trailing: Option<(u64, String)>,
    done: bool,
}

impl TopWalk {
    pub fn new(file_len: u64) -> Self {
        TopWalk { file_len, pos: 0, boxes: Vec::new(), trailing: None, done: file_len == 0 }
    }

    pub fn done(&self) -> bool {
        self.done
    }

    pub fn need(&self) -> Option<Req> {
        if self.done {
            return None;
        }
        Some(Req { offset: self.pos, len: (self.file_len - self.pos).min(32) as u32 })
    }

    pub fn feed(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let want = self.need().ok_or_else(|| "Unexpected read".to_string())?;
        check_feed(want, offset, bytes)?;
        match read_box_header(bytes, self.pos, self.file_len) {
            Ok(h) => {
                self.pos = h.end();
                self.boxes.push(h);
                if self.pos >= self.file_len {
                    self.done = true;
                } else if self.boxes.len() >= guard::MAX_TOP_LEVEL {
                    self.trailing = Some((self.pos, "Too many top-level boxes".to_string()));
                    self.done = true;
                }
            }
            Err(e) => {
                self.trailing = Some((self.pos, e));
                self.done = true;
            }
        }
        Ok(())
    }
}
