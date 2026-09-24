use crate::{container, guard, transform};
use image::{ImageFormat, RgbaImage};
use std::io::Cursor;

fn decode_err() -> String {
    "This file could not be decoded as an image. It may be corrupt or a disguised/unsupported format."
        .to_string()
}

pub fn decode_upright(b: &[u8]) -> Result<RgbaImage, String> {
    let reader = image::ImageReader::new(Cursor::new(b))
        .with_guessed_format()
        .map_err(|_| decode_err())?;
    let format = reader.format();
    let (w, h) = reader.into_dimensions().map_err(|_| decode_err())?;
    guard::check_dimensions(w, h)?;

    reject_animation(b, format)?;

    let orientation = read_orientation(b);

    let dynimg = image::load_from_memory(b).map_err(|_| decode_err())?;
    let rgba = dynimg.to_rgba8();

    Ok(transform::bake_orientation(rgba, orientation))
}

fn reject_animation(b: &[u8], format: Option<ImageFormat>) -> Result<(), String> {
    match format {
        Some(ImageFormat::WebP) => {
            let walk = container::walk_webp(b);
            if walk.chunks.iter().any(|c| &c.ctype == b"ANIM" || &c.ctype == b"ANMF") {
                return Err("Animated WebP is not supported in paranoid mode".to_string());
            }
        }
        Some(ImageFormat::Png) => {
            let walk = container::walk_png(b);
            if walk.chunks.iter().any(|c| &c.ctype == b"acTL") {
                return Err("Animated PNG (APNG) is not supported in paranoid mode".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn read_orientation(b: &[u8]) -> u32 {
    let mut cursor = Cursor::new(b);
    match exif::Reader::new().read_from_container(&mut cursor) {
        Ok(ex) => ex
            .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .unwrap_or(1),
        Err(_) => 1,
    }
}
