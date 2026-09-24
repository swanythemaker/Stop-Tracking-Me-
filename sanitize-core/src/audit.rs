use crate::allowlist;
use crate::container::{self, JpegItem};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSummary {
    pub kind: String,
    pub issues: Vec<String>,
    pub markers: Vec<String>,
    pub byte_length: usize,
    pub passed: bool,
}

impl AuditSummary {
    fn fail(kind: &str, byte_length: usize, markers: Vec<String>, issue: &str) -> Self {
        AuditSummary { kind: kind.into(), issues: vec![issue.into()], markers, byte_length, passed: false }
    }
}

pub fn audit(format: &str, b: &[u8]) -> AuditSummary {
    if format == "image/png" || container::has_png_signature(b) {
        return audit_png(b);
    }
    if format == "image/jpeg" || container::is_jpeg(b) {
        return audit_jpeg(b);
    }
    if format == "image/webp" || container::is_webp(b) {
        return audit_webp(b);
    }
    AuditSummary::fail("unknown", b.len(), Vec::new(), "Unknown image structure")
}

pub fn audit_auto(b: &[u8]) -> AuditSummary {
    audit("", b)
}

fn audit_png(b: &[u8]) -> AuditSummary {
    let mut issues = Vec::new();
    let mut markers = Vec::new();

    let walk = container::walk_png(b);
    if !walk.has_signature {
        return AuditSummary::fail("png", b.len(), markers, "Missing PNG signature");
    }
    let mut saw_ihdr = false;
    let mut saw_idat = false;
    let mut saw_iend = false;
    for c in &walk.chunks {
        markers.push(container::fourcc(&c.ctype));
        if !c.crc_ok {
            issues.push(format!("PNG CRC mismatch for {}", container::fourcc(&c.ctype)));
        }
        if &c.ctype == b"IHDR" {
            if !c.first {
                issues.push("IHDR must be first chunk".to_string());
            }
            saw_ihdr = true;
        }
        if &c.ctype == b"IDAT" {
            saw_idat = true;
        }
        if &c.ctype == b"IEND" {
            saw_iend = true;
        }
        if allowlist::png_denied(&c.ctype) {
            issues.push(format!("Disallowed PNG chunk found: {}", container::fourcc(&c.ctype)));
        } else if !allowlist::png_allowed(&c.ctype) {
            issues.push(format!("Non-allowlisted PNG chunk found: {}", container::fourcc(&c.ctype)));
        }
    }
    if let Some(e) = walk.error {
        issues.push(e);
    }
    if !saw_ihdr || !saw_idat || !saw_iend {
        issues.push("Required PNG chunks missing".to_string());
    }
    finish("png", b.len(), issues, markers)
}

fn audit_jpeg(b: &[u8]) -> AuditSummary {
    let mut issues = Vec::new();
    let mut markers = Vec::new();

    let walk = container::walk_jpeg(b);
    if !walk.has_soi {
        return AuditSummary::fail("jpeg", b.len(), markers, "Missing JPEG SOI marker");
    }
    markers.push("SOI".to_string());
    for item in &walk.items {
        match *item {
            JpegItem::Standalone(m) => markers.push(jpeg_marker_name(m)),
            JpegItem::Eoi => markers.push("EOI".to_string()),
            JpegItem::Segment { marker, .. } => {
                markers.push(jpeg_marker_name(marker));
                if allowlist::jpeg_marker_denied(marker) {
                    issues.push(format!("Disallowed JPEG marker found: {}", jpeg_marker_name(marker)));
                }
            }
            JpegItem::Scan { .. } => {
                markers.push("SOS".to_string());
                markers.push("EOI".to_string());
            }
        }
    }
    if let Some(e) = walk.error {
        issues.push(e);
    }
    if !walk.saw_eoi {
        issues.push("EOI marker not found".to_string());
    }
    finish("jpeg", b.len(), issues, markers)
}

fn audit_webp(b: &[u8]) -> AuditSummary {
    let mut issues = Vec::new();
    let mut markers = Vec::new();

    let walk = container::walk_webp(b);
    if !walk.valid_riff {
        return AuditSummary::fail("webp", b.len(), markers, "Invalid WebP RIFF header");
    }
    markers.push("RIFF".to_string());
    markers.push("WEBP".to_string());
    if walk.riff_size as usize + 8 != b.len() {
        issues.push("WebP RIFF size mismatch".to_string());
    }
    let mut saw_image = false;
    for c in &walk.chunks {
        markers.push(container::fourcc(&c.ctype));
        if allowlist::webp_denied(&c.ctype) {
            issues.push(format!("Disallowed WebP chunk found: {}", container::fourcc(&c.ctype)));
        } else if !allowlist::webp_allowed(&c.ctype) {
            issues.push(format!("Non-allowlisted WebP chunk found: {}", container::fourcc(&c.ctype)));
        }
        if &c.ctype == b"VP8 " || &c.ctype == b"VP8L" {
            saw_image = true;
        }
        if &c.ctype == b"VP8X" && c.data_end > c.data_start {
            let flags = b[c.data_start];
            if flags & 0b1100_0000 != 0 {
                issues.push("WebP VP8X metadata flags are set".to_string());
            }
            if flags & 0b0000_0010 != 0 {
                issues.push("Animated WebP is not allowed".to_string());
            }
        }
    }
    if let Some(e) = walk.error {
        issues.push(e);
    }
    if !saw_image {
        issues.push("Missing WebP image payload chunk".to_string());
    }
    finish("webp", b.len(), issues, markers)
}

fn finish(kind: &str, byte_length: usize, issues: Vec<String>, markers: Vec<String>) -> AuditSummary {
    let passed = issues.is_empty();
    AuditSummary { kind: kind.into(), issues, markers, byte_length, passed }
}

fn jpeg_marker_name(m: u8) -> String {
    if (0xe0..=0xef).contains(&m) {
        return format!("APP{}", m - 0xe0);
    }
    match m {
        0xfe => "COM".into(),
        0xdb => "DQT".into(),
        0xc0 => "SOF0".into(),
        0xc2 => "SOF2".into(),
        0xc4 => "DHT".into(),
        0xdd => "DRI".into(),
        0xda => "SOS".into(),
        0xd9 => "EOI".into(),
        0x01 => "TEM".into(),
        0xd0..=0xd7 => format!("RST{}", m - 0xd0),
        _ => format!("0x{:X}", m),
    }
}
