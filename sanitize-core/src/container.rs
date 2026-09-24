use crate::allowlist::PNG_SIGNATURE;

pub struct PngChunk {
    pub ctype: [u8; 4],
    pub raw_start: usize,
    pub raw_end: usize,
    pub crc_ok: bool,
    pub first: bool,
}

pub struct PngWalk {
    pub chunks: Vec<PngChunk>,
    pub error: Option<String>,
    pub has_signature: bool,
}

pub fn walk_png(b: &[u8]) -> PngWalk {
    let mut walk = PngWalk { chunks: Vec::new(), error: None, has_signature: false };

    if !has_png_signature(b) {
        walk.error = Some("Missing PNG signature".to_string());
        return walk;
    }
    walk.has_signature = true;

    let mut cursor = PNG_SIGNATURE.len();
    let mut first = true;
    while cursor < b.len() {
        if cursor + 12 > b.len() {
            walk.error = Some("Truncated PNG chunk header".to_string());
            break;
        }
        let length = read_u32be(b, cursor) as usize;
        let mut ctype = [0u8; 4];
        ctype.copy_from_slice(&b[cursor + 4..cursor + 8]);
        let data_start = cursor + 8;

        let data_end = match data_start.checked_add(length) {
            Some(v) => v,
            None => {
                walk.error = Some(format!("Invalid PNG chunk length for {}", fourcc(&ctype)));
                break;
            }
        };
        let crc_pos = data_end;
        if data_end > b.len() || crc_pos + 4 > b.len() {
            walk.error = Some(format!("Invalid PNG chunk length for {}", fourcc(&ctype)));
            break;
        }
        let expected = read_u32be(b, crc_pos);
        let actual = crc32(&b[cursor + 4..data_end]);
        let raw_end = crc_pos + 4;
        walk.chunks.push(PngChunk { ctype, raw_start: cursor, raw_end, crc_ok: expected == actual, first });
        first = false;
        cursor = raw_end;
        if &ctype == b"IEND" {
            if cursor != b.len() {
                walk.error = Some("Trailing bytes after PNG IEND".to_string());
            }
            break;
        }
    }
    walk
}

pub struct WebpChunk {
    pub ctype: [u8; 4],
    pub data_start: usize,
    pub data_end: usize,
}

pub struct WebpWalk {
    pub chunks: Vec<WebpChunk>,
    pub error: Option<String>,
    pub valid_riff: bool,
    pub riff_size: u32,
}

pub fn walk_webp(b: &[u8]) -> WebpWalk {
    let mut walk = WebpWalk { chunks: Vec::new(), error: None, valid_riff: false, riff_size: 0 };
    if !is_webp(b) {
        walk.error = Some("Invalid WebP RIFF header".to_string());
        return walk;
    }
    walk.valid_riff = true;
    walk.riff_size = read_u32le(b, 4);

    let mut cursor = 12;
    while cursor < b.len() {
        if cursor + 8 > b.len() {
            walk.error = Some("Truncated WebP chunk header".to_string());
            break;
        }
        let mut ctype = [0u8; 4];
        ctype.copy_from_slice(&b[cursor..cursor + 4]);
        let len = read_u32le(b, cursor + 4) as usize;
        let data_start = cursor + 8;
        let data_end = match data_start.checked_add(len) {
            Some(v) => v,
            None => {
                walk.error = Some(format!("Invalid WebP chunk length for {}", fourcc(&ctype)));
                break;
            }
        };
        let padded_end = data_end + (len & 1);
        if padded_end > b.len() {
            walk.error = Some(format!("Invalid WebP chunk length for {}", fourcc(&ctype)));
            break;
        }
        walk.chunks.push(WebpChunk { ctype, data_start, data_end });
        cursor = padded_end;
    }
    walk
}

pub enum JpegItem {
    Standalone(u8),
    Segment { marker: u8, payload_start: usize, payload_end: usize },
    Scan { hdr_start: usize, hdr_end: usize, eoi: usize },
    Eoi,
}

pub struct JpegWalk {
    pub items: Vec<JpegItem>,
    pub error: Option<String>,
    pub has_soi: bool,
    pub saw_eoi: bool,
}

pub fn walk_jpeg(b: &[u8]) -> JpegWalk {
    let mut walk = JpegWalk { items: Vec::new(), error: None, has_soi: false, saw_eoi: false };
    if !is_jpeg(b) {
        walk.error = Some("Missing JPEG SOI marker".to_string());
        return walk;
    }
    walk.has_soi = true;
    let mut cursor = 2;

    while cursor < b.len() {
        if b[cursor] != 0xff {
            walk.error = Some("Unexpected byte where a JPEG marker was expected".to_string());
            break;
        }
        while cursor < b.len() && b[cursor] == 0xff {
            cursor += 1;
        }
        if cursor >= b.len() {
            walk.error = Some("Unexpected JPEG EOF before marker".to_string());
            break;
        }
        let marker = b[cursor];
        cursor += 1;

        if marker == 0xd9 {
            walk.items.push(JpegItem::Eoi);
            walk.saw_eoi = true;
            if cursor != b.len() {
                walk.error = Some("Trailing bytes after JPEG EOI".to_string());
            }
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            walk.items.push(JpegItem::Standalone(marker));
            continue;
        }

        if cursor + 1 >= b.len() {
            walk.error = Some("Truncated JPEG segment length".to_string());
            break;
        }
        let len = read_u16be(b, cursor) as usize;
        let seg_end = match cursor.checked_add(len) {
            Some(v) => v,
            None => {
                walk.error = Some("Invalid JPEG segment length".to_string());
                break;
            }
        };
        if len < 2 || seg_end > b.len() {
            walk.error = Some("Invalid JPEG segment length".to_string());
            break;
        }

        if marker == 0xda {
            match find_jpeg_eoi(b, seg_end) {
                None => {
                    walk.error = Some("JPEG EOI not found after SOS".to_string());
                }
                Some(eoi) => {
                    walk.items.push(JpegItem::Scan { hdr_start: cursor, hdr_end: seg_end, eoi });
                    walk.saw_eoi = true;
                    if eoi + 2 != b.len() {
                        walk.error = Some("Trailing bytes after JPEG EOI".to_string());
                    }
                }
            }
            break;
        }

        walk.items.push(JpegItem::Segment { marker, payload_start: cursor, payload_end: seg_end });
        cursor = seg_end;
    }
    walk
}

pub fn has_png_signature(b: &[u8]) -> bool {
    b.len() >= PNG_SIGNATURE.len() && b[..PNG_SIGNATURE.len()] == PNG_SIGNATURE
}

pub fn is_jpeg(b: &[u8]) -> bool {
    b.len() > 2 && b[0] == 0xff && b[1] == 0xd8
}

pub fn is_webp(b: &[u8]) -> bool {
    b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP"
}

pub fn fourcc(t: &[u8; 4]) -> String {
    t.iter()
        .map(|&c| if (0x20..=0x7e).contains(&c) { c as char } else { '.' })
        .collect()
}

fn read_u16be(b: &[u8], o: usize) -> u16 {
    ((b[o] as u16) << 8) | (b[o + 1] as u16)
}

fn read_u32be(b: &[u8], o: usize) -> u32 {
    ((b[o] as u32) << 24) | ((b[o + 1] as u32) << 16) | ((b[o + 2] as u32) << 8) | (b[o + 3] as u32)
}

fn read_u32le(b: &[u8], o: usize) -> u32 {
    (b[o] as u32) | ((b[o + 1] as u32) << 8) | ((b[o + 2] as u32) << 16) | ((b[o + 3] as u32) << 24)
}

fn find_jpeg_eoi(b: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i + 1 < b.len() {
        if b[i] == 0xff && b[i + 1] == 0xd9 {
            return Some(i);
        }
        i += 1;
    }
    None
}

pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    crc ^ 0xffff_ffff
}
