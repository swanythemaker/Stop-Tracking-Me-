const MAX_WIDTH: u32 = 16384;
const MAX_HEIGHT: u32 = 16384;
const MAX_PIXELS: u64 = 100_000_000;

pub const MAX_VIDEO_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_VIDEO_DIM: u32 = 8192;
pub const MAX_VIDEO_PIXELS: u64 = 8192 * 4352;
pub const MAX_SAMPLES: usize = 1_000_000;
pub const MAX_DURATION_S: u64 = 600;
pub const MAX_TRACKS: usize = 16;
pub const MAX_MOOV_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_BOX_DEPTH: usize = 10;
pub const MAX_WINDOW_BYTES: u32 = 16 * 1024 * 1024;
pub const DEFAULT_WINDOW_BYTES: u32 = 8 * 1024 * 1024;
pub const MIN_WINDOW_BYTES: u32 = 4096;
pub const MAX_NALS_PER_SAMPLE: usize = 4096;
pub const MAX_TOP_LEVEL: usize = 65536;
pub const MAX_SIDE_BYTES: u64 = 1024 * 1024;

pub fn check_dimensions(w: u32, h: u32) -> Result<(), String> {
    if w > MAX_WIDTH || h > MAX_HEIGHT {
        return Err(format!("Image is {w}×{h}px, over the {MAX_WIDTH}×{MAX_HEIGHT}px limit."));
    }
    if (w as u64) * (h as u64) > MAX_PIXELS {
        let mp = (w as f64) * (h as f64) / 1_000_000.0;
        return Err(format!("Image is {:.1} MP, over the {} MP limit.", mp, MAX_PIXELS / 1_000_000));
    }
    Ok(())
}

pub fn check_video_bytes(len: u64) -> Result<(), String> {
    if len > MAX_VIDEO_BYTES {
        return Err(format!(
            "Video is {:.1} MB, over the {} MB limit.",
            len as f64 / 1_048_576.0,
            MAX_VIDEO_BYTES / 1_048_576
        ));
    }
    if len < 8 {
        return Err("Video file is too short to be valid.".to_string());
    }
    Ok(())
}

pub fn check_video_dims(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Err("Video has zero width or height.".to_string());
    }
    if w > MAX_VIDEO_DIM || h > MAX_VIDEO_DIM {
        return Err(format!("Video is {w}x{h}px, over the {MAX_VIDEO_DIM}px limit."));
    }
    if (w as u64) * (h as u64) > MAX_VIDEO_PIXELS {
        return Err(format!("Video is {w}x{h}px, over the pixel limit."));
    }
    Ok(())
}

pub fn check_duration(seconds: f64) -> Result<(), String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("Video duration is invalid.".to_string());
    }
    if seconds > MAX_DURATION_S as f64 {
        return Err(format!("Video is {:.0} s long, over the {} minute limit.", seconds, MAX_DURATION_S / 60));
    }
    Ok(())
}

pub fn clamp_window(bytes: u32) -> u32 {
    bytes.clamp(MIN_WINDOW_BYTES, MAX_WINDOW_BYTES)
}
