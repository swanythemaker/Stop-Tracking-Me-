const MAX_WIDTH: u32 = 16384;
const MAX_HEIGHT: u32 = 16384;
const MAX_PIXELS: u64 = 100_000_000;

pub fn check_dimensions(w: u32, h: u32) -> Result<(), String> {
    if w > MAX_WIDTH || h > MAX_HEIGHT {
        return Err(format!("Image is {w}×{h}px — over the {MAX_WIDTH}×{MAX_HEIGHT}px limit."));
    }
    if (w as u64) * (h as u64) > MAX_PIXELS {
        let mp = (w as f64) * (h as f64) / 1_000_000.0;
        return Err(format!("Image is {:.1} MP — over the {} MP limit.", mp, MAX_PIXELS / 1_000_000));
    }
    Ok(())
}
