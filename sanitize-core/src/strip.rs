use crate::allowlist;
use crate::container::{self, JpegItem};

pub fn strip(format: &str, b: &[u8]) -> Result<Vec<u8>, String> {
    match format {
        "image/png" => strip_png(b),
        "image/jpeg" => strip_jpeg(b),
        "image/webp" => strip_webp(b),
        other => Err(format!("Unsupported strip format: {other}")),
    }
}

fn strip_png(b: &[u8]) -> Result<Vec<u8>, String> {
    let walk = container::walk_png(b);
    if let Some(e) = walk.error {
        return Err(e);
    }
    if walk.chunks.is_empty() || &walk.chunks[0].ctype != b"IHDR" {
        return Err("IHDR must be the first PNG chunk".to_string());
    }
    let mut saw_idat = false;
    let mut saw_iend = false;
    for c in &walk.chunks {
        if !c.crc_ok {
            return Err(format!("PNG CRC mismatch for {}", container::fourcc(&c.ctype)));
        }
        if &c.ctype == b"IDAT" {
            saw_idat = true;
        }
        if &c.ctype == b"IEND" {
            saw_iend = true;
        }
    }
    if !saw_idat || !saw_iend {
        return Err("Missing required PNG chunks".to_string());
    }

    let mut out = Vec::with_capacity(b.len());
    out.extend_from_slice(&allowlist::PNG_SIGNATURE);
    for c in &walk.chunks {
        if allowlist::png_allowed(&c.ctype) {
            out.extend_from_slice(&b[c.raw_start..c.raw_end]);
        }
    }
    Ok(out)
}

fn strip_webp(b: &[u8]) -> Result<Vec<u8>, String> {
    let walk = container::walk_webp(b);
    if let Some(e) = walk.error {
        return Err(e);
    }
    let mut saw_image = false;
    let mut body = Vec::with_capacity(b.len());
    for c in &walk.chunks {
        if &c.ctype == b"ANIM" || &c.ctype == b"ANMF" {
            return Err("Animated WebP is not supported in paranoid mode".to_string());
        }
        if &c.ctype == b"VP8 " || &c.ctype == b"VP8L" {
            saw_image = true;
        }
        if allowlist::webp_allowed(&c.ctype) {
            let data = &b[c.data_start..c.data_end];
            if &c.ctype == b"VP8X" {
                body.extend(build_webp_chunk(&c.ctype, &cleanse_vp8x(data)?));
            } else {
                body.extend(build_webp_chunk(&c.ctype, data));
            }
        }
    }
    if !saw_image {
        return Err("WebP image payload missing".to_string());
    }

    let mut out = Vec::with_capacity(12 + body.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    Ok(out)
}

fn strip_jpeg(b: &[u8]) -> Result<Vec<u8>, String> {
    let walk = container::walk_jpeg(b);
    if let Some(e) = walk.error {
        return Err(e);
    }
    if !walk.saw_eoi {
        return Err("JPEG EOI marker missing".to_string());
    }

    let mut out = Vec::with_capacity(b.len());
    out.extend_from_slice(&[0xff, 0xd8]);
    for item in &walk.items {
        match *item {
            JpegItem::Standalone(m) => out.extend_from_slice(&[0xff, m]),
            JpegItem::Eoi => out.extend_from_slice(&[0xff, 0xd9]),
            JpegItem::Segment { marker, payload_start, payload_end } => {
                if !allowlist::jpeg_marker_denied(marker) {
                    out.extend_from_slice(&[0xff, marker]);
                    out.extend_from_slice(&b[payload_start..payload_end]);
                }
            }
            JpegItem::Scan { hdr_start, hdr_end, eoi } => {
                out.extend_from_slice(&[0xff, 0xda]);
                out.extend_from_slice(&b[hdr_start..hdr_end]);
                out.extend_from_slice(&b[hdr_end..eoi + 2]);
            }
        }
    }
    Ok(out)
}

fn cleanse_vp8x(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 10 {
        return Err("Invalid VP8X chunk length".to_string());
    }
    let mut clean = data.to_vec();
    clean[0] &= 0b0011_1101;
    Ok(clean)
}

fn build_webp_chunk(ctype: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let pad = data.len() & 1;
    let mut out = Vec::with_capacity(8 + data.len() + pad);
    out.extend_from_slice(ctype);
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    if pad == 1 {
        out.push(0);
    }
    out
}
