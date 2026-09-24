pub const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PNG_ALLOWED: [&[u8; 4]; 5] = [b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"];

const PNG_DENY: [&[u8; 4]; 6] = [b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP", b"sPLT"];

const WEBP_ALLOWED: [&[u8; 4]; 4] = [b"VP8 ", b"VP8L", b"VP8X", b"ALPH"];

const WEBP_DENY: [&[u8; 4]; 5] = [b"EXIF", b"XMP ", b"ICCP", b"ANIM", b"ANMF"];

pub fn png_allowed(ctype: &[u8; 4]) -> bool {
    PNG_ALLOWED.contains(&ctype)
}

pub fn png_denied(ctype: &[u8; 4]) -> bool {
    PNG_DENY.contains(&ctype)
}

pub fn webp_allowed(ctype: &[u8; 4]) -> bool {
    WEBP_ALLOWED.contains(&ctype)
}

pub fn webp_denied(ctype: &[u8; 4]) -> bool {
    WEBP_DENY.contains(&ctype)
}

pub fn jpeg_marker_denied(marker: u8) -> bool {
    (0xe0..=0xef).contains(&marker) || marker == 0xfe
}
