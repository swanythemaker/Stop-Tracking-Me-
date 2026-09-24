use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use sanitize_core::{allowlist, audit, container, decode, guard, strip, transform};
use std::io::Cursor;

fn sample(w: u32, h: u32) -> RgbaImage {
    RgbaImage::from_fn(w, h, |x, y| {
        Rgba([(x * 17 % 256) as u8, (y * 29 % 256) as u8, ((x + y) * 7 % 256) as u8, 255])
    })
}

fn encode(img: &RgbaImage, fmt: ImageFormat) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut buf, fmt)
        .expect("encode fixture");
    buf.into_inner()
}

#[test]
fn stripped_output_passes_audit_png() {
    let bytes = encode(&sample(24, 16), ImageFormat::Png);
    let stripped = strip::strip("image/png", &bytes).expect("strip png");
    let verdict = audit::audit("image/png", &stripped);
    assert!(verdict.passed, "png audit issues: {:?}", verdict.issues);
    assert!(verdict.issues.is_empty());
}

#[test]
fn stripped_output_passes_audit_jpeg() {
    let bytes = encode(&sample(24, 16), ImageFormat::Jpeg);
    let stripped = strip::strip("image/jpeg", &bytes).expect("strip jpeg");
    let verdict = audit::audit("image/jpeg", &stripped);
    assert!(verdict.passed, "jpeg audit issues: {:?}", verdict.issues);
}

#[test]
fn stripped_output_passes_audit_webp() {
    let bytes = encode(&sample(24, 16), ImageFormat::WebP);
    let stripped = strip::strip("image/webp", &bytes).expect("strip webp");
    let verdict = audit::audit("image/webp", &stripped);
    assert!(verdict.passed, "webp audit issues: {:?}", verdict.issues);
}

#[test]
fn strip_is_idempotent_png() {
    let bytes = encode(&sample(20, 20), ImageFormat::Png);
    let once = strip::strip("image/png", &bytes).unwrap();
    let twice = strip::strip("image/png", &once).unwrap();
    assert_eq!(once, twice, "stripping a clean file must be a no-op");
}

#[test]
fn audit_flags_injected_png_text_chunk() {
    let mut bytes = encode(&sample(16, 16), ImageFormat::Png);
    inject_png_text(&mut bytes);

    let dirty = audit::audit("image/png", &bytes);
    assert!(!dirty.passed);
    assert!(dirty.issues.iter().any(|i| i.contains("tEXt")));

    let stripped = strip::strip("image/png", &bytes).expect("strip dirty png");
    assert!(audit::audit("image/png", &stripped).passed);
    assert!(!contains(&stripped, b"tEXt"));
}

#[test]
fn audit_flags_jpeg_app_marker() {
    let bytes = encode(&sample(16, 16), ImageFormat::Jpeg);
    let raw = audit::audit("image/jpeg", &bytes);
    if raw.markers.iter().any(|m| m.starts_with("APP")) {
        assert!(!raw.passed, "an APPn-bearing jpeg should fail the input audit");
    }
    let stripped = strip::strip("image/jpeg", &bytes).unwrap();
    let out = audit::audit("image/jpeg", &stripped);
    assert!(out.passed);
    assert!(!out.markers.iter().any(|m| m.starts_with("APP")));
}

#[test]
fn malformed_never_panics_and_fails_closed() {
    let good_png = encode(&sample(12, 12), ImageFormat::Png);
    let good_jpeg = encode(&sample(12, 12), ImageFormat::Jpeg);
    let good_webp = encode(&sample(12, 12), ImageFormat::WebP);

    let mut corpus: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("garbage", vec![0u8; 64]),
        ("png-sig-only", allowlist::PNG_SIGNATURE.to_vec()),
        ("jpeg-soi-only", vec![0xff, 0xd8]),
        ("riff-only", b"RIFF\0\0\0\0WEBP".to_vec()),
    ];

    for (name, good) in [("png", &good_png), ("jpeg", &good_jpeg), ("webp", &good_webp)] {
        for cut in [good.len() / 3, good.len() / 2, good.len().saturating_sub(3)] {
            corpus.push((name, good[..cut].to_vec()));
        }

        for i in (8..good.len().min(80)).step_by(7) {
            let mut m = good.clone();
            m[i] ^= 0xff;
            corpus.push((name, m));
        }
    }

    for (name, bytes) in &corpus {
        let fmt = match *name {
            "png" | "png-sig-only" => "image/png",
            "jpeg" | "jpeg-soi-only" => "image/jpeg",
            "webp" | "riff-only" => "image/webp",
            _ => "image/png",
        };

        audit::audit(fmt, bytes);
        if let Ok(out) = strip::strip(fmt, bytes) {
            assert!(
                audit::audit(fmt, &out).passed,
                "{name}: strip produced output that fails audit"
            );
        }
    }
}

#[test]
fn trailing_bytes_after_png_iend_rejected() {
    let mut bytes = encode(&sample(10, 10), ImageFormat::Png);
    bytes.extend_from_slice(b"GOTCHA");
    assert!(strip::strip("image/png", &bytes).is_err());
    assert!(!audit::audit("image/png", &bytes).passed);
}

#[test]
fn png_crc_corruption_rejected() {
    let mut bytes = encode(&sample(10, 10), ImageFormat::Png);
    let idx = bytes.len() / 2;
    bytes[idx] ^= 0x80;

    if let Ok(out) = strip::strip("image/png", &bytes) {
        assert!(audit::audit("image/png", &out).passed);
    }
}

#[test]
fn decode_roundtrips_dimensions() {
    let bytes = encode(&sample(40, 24), ImageFormat::Png);
    let img = decode::decode_upright(&bytes).expect("decode");
    assert_eq!(img.dimensions(), (40, 24));
}

#[test]
fn orientation_bake_rotate90_swaps_dims() {
    let img = sample(8, 4);
    let baked = transform::bake_orientation(img, 6);
    assert_eq!(baked.dimensions(), (4, 8));
}

#[test]
fn orientation_bake_fliph_mirrors_pixels() {
    let img = sample(4, 1);
    let left = *img.get_pixel(0, 0);
    let right = *img.get_pixel(3, 0);
    let baked = transform::bake_orientation(img, 2);
    assert_eq!(*baked.get_pixel(0, 0), right);
    assert_eq!(*baked.get_pixel(3, 0), left);
}

#[test]
fn rotate_360_is_identity() {
    let img = sample(6, 9);
    let r = transform::rotate(img.clone(), 360);
    assert_eq!(r.dimensions(), img.dimensions());
    assert_eq!(r.into_raw(), img.into_raw());
}

#[test]
fn resize_is_deterministic_and_scales() {
    let img = sample(100, 60);
    let a = transform::resize(img.clone(), 50);
    let b = transform::resize(img.clone(), 50);
    assert_eq!(a.dimensions(), (50, 30));
    assert_eq!(a.into_raw(), b.into_raw(), "resize must be deterministic");

    let same = transform::resize(img.clone(), 100);
    assert_eq!(same.into_raw(), img.into_raw());
}

#[test]
fn resize_never_upscales_and_keeps_min_1px() {
    let img = sample(3, 3);
    let r = transform::resize(img, 10);
    let (w, h) = r.dimensions();
    assert!(w >= 1 && h >= 1);
}

#[test]
fn guard_rejects_oversize() {
    assert!(guard::check_dimensions(20000, 10).is_err());
    assert!(guard::check_dimensions(10, 20000).is_err());
    assert!(guard::check_dimensions(12000, 12000).is_err());
    assert!(guard::check_dimensions(1920, 1080).is_ok());
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn inject_png_text(bytes: &mut Vec<u8>) {
    let insert_at = 33;
    let payload = b"Comment\0hello-tracker";
    let mut chunk = Vec::new();
    chunk.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"tEXt");
    chunk.extend_from_slice(payload);
    let crc = container::crc32(&chunk[4..]);
    chunk.extend_from_slice(&crc.to_be_bytes());
    bytes.splice(insert_at..insert_at, chunk);
}
