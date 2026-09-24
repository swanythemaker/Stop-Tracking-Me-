use crate::guard;
use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaneFormat {
    I420,
    Nv12,
    Bgrx,
    Bgra,
    Rgbx,
    Rgba,
}

impl PlaneFormat {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "I420" => Ok(PlaneFormat::I420),
            "NV12" => Ok(PlaneFormat::Nv12),
            "BGRX" => Ok(PlaneFormat::Bgrx),
            "BGRA" => Ok(PlaneFormat::Bgra),
            "RGBX" => Ok(PlaneFormat::Rgbx),
            "RGBA" => Ok(PlaneFormat::Rgba),
            other => Err(format!("Unsupported frame format {other}")),
        }
    }

    fn rgb_order(self) -> Option<(usize, usize, usize)> {
        match self {
            PlaneFormat::Bgrx | PlaneFormat::Bgra => Some((2, 1, 0)),
            PlaneFormat::Rgbx | PlaneFormat::Rgba => Some((0, 1, 2)),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Matrix {
    #[default]
    Bt601,
    Bt709,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaneOps {
    pub resize_pct: u32,
    pub rotate: i32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub matrix: Matrix,
}

impl Default for PlaneOps {
    fn default() -> Self {
        PlaneOps { resize_pct: 100, rotate: 0, flip_h: false, flip_v: false, matrix: Matrix::Bt601 }
    }
}

pub struct Planes {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn input_len(fmt: PlaneFormat, w: u32, h: u32) -> usize {
    let (w, h) = (w as usize, h as usize);
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    match fmt {
        PlaneFormat::I420 | PlaneFormat::Nv12 => w * h + 2 * cw * ch,
        _ => w * h * 4,
    }
}

pub fn output_dims(w: u32, h: u32, ops: &PlaneOps) -> (u32, u32) {
    let (rw, rh) = if ops.rotate.rem_euclid(360) % 180 == 90 { (h, w) } else { (w, h) };
    let pct = ops.resize_pct.clamp(10, 100) as u64;
    let scale = |v: u32| -> u32 {
        let s = if pct == 100 { v as u64 } else { (v as u64 * pct + 50) / 100 };
        ((s as u32) & !1).max(2)
    };
    (scale(rw), scale(rh))
}

fn rgb_to_yuv(src: &[u8], fmt: PlaneFormat, w: usize, h: usize, m: Matrix) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let (ri, gi, bi) = fmt.rgb_order().unwrap_or((0, 1, 2));
    let (yr, yg, yb, ur, ug, ub, vr, vg, vb) = match m {
        Matrix::Bt601 => (66, 129, 25, -38, -74, 112, 112, -94, -18),
        Matrix::Bt709 => (47, 157, 16, -26, -87, 112, 112, -102, -10),
    };
    let mut y = vec![0u8; w * h];
    for (row, out) in y.chunks_exact_mut(w).enumerate() {
        let line = &src[row * w * 4..(row + 1) * w * 4];
        for (x, px) in out.iter_mut().enumerate() {
            let p = &line[x * 4..x * 4 + 4];
            let (r, g, b) = (p[ri] as i32, p[gi] as i32, p[bi] as i32);
            *px = (((yr * r + yg * g + yb * b + 128) >> 8) + 16).clamp(0, 255) as u8;
        }
    }
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    let mut u = vec![0u8; cw * ch];
    let mut v = vec![0u8; cw * ch];
    for cy in 0..ch {
        for cx in 0..cw {
            let (mut r, mut g, mut b, mut n) = (0i32, 0i32, 0i32, 0i32);
            for dy in 0..2 {
                for dx in 0..2 {
                    let (sx, sy) = (cx * 2 + dx, cy * 2 + dy);
                    if sx < w && sy < h {
                        let o = (sy * w + sx) * 4;
                        r += src[o + ri] as i32;
                        g += src[o + gi] as i32;
                        b += src[o + bi] as i32;
                        n += 1;
                    }
                }
            }
            let (r, g, b) = ((r + n / 2) / n, (g + n / 2) / n, (b + n / 2) / n);
            u[cy * cw + cx] = (((ur * r + ug * g + ub * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            v[cy * cw + cx] = (((vr * r + vg * g + vb * b + 128) >> 8) + 128).clamp(0, 255) as u8;
        }
    }
    (y, u, v)
}

fn remap(p: &[u8], w: usize, h: usize, ops: &PlaneOps) -> (Vec<u8>, usize, usize) {
    let rot = ops.rotate.rem_euclid(360);
    let rot = if rot % 90 == 0 { rot } else { 0 };
    if rot == 0 && !ops.flip_h && !ops.flip_v {
        return (p.to_vec(), w, h);
    }
    let (dw, dh) = if rot % 180 == 90 { (h, w) } else { (w, h) };
    let mut out = vec![0u8; w * h];
    for sy in 0..h {
        let fy = if ops.flip_v { h - 1 - sy } else { sy };
        for sx in 0..w {
            let fx = if ops.flip_h { w - 1 - sx } else { sx };
            let (dx, dy) = match rot {
                90 => (h - 1 - fy, fx),
                180 => (w - 1 - fx, h - 1 - fy),
                270 => (fy, w - 1 - fx),
                _ => (fx, fy),
            };
            out[dy * dw + dx] = p[sy * w + sx];
        }
    }
    (out, dw, dh)
}

fn fit(p: Vec<u8>, w: usize, h: usize, nw: usize, nh: usize, crop: bool) -> Result<Vec<u8>, String> {
    if w == nw && h == nh {
        return Ok(p);
    }
    if crop && nw <= w && nh <= h {
        let mut out = Vec::with_capacity(nw * nh);
        for row in p.chunks_exact(w).take(nh) {
            out.extend_from_slice(&row[..nw]);
        }
        return Ok(out);
    }
    let src = FirImage::from_vec_u8(w as u32, h as u32, p, PixelType::U8).map_err(|e| e.to_string())?;
    let mut dst = FirImage::new(nw as u32, nh as u32, PixelType::U8);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    Resizer::new().resize(&src, &mut dst, &opts).map_err(|e| e.to_string())?;
    Ok(dst.into_vec())
}

pub fn transform_planes(src: &[u8], fmt: PlaneFormat, w: u32, h: u32, ops: &PlaneOps) -> Result<Planes, String> {
    guard::check_video_dims(w, h)?;
    let need = input_len(fmt, w, h);
    if src.len() < need {
        return Err(format!("Frame buffer holds {} bytes, {} needed", src.len(), need));
    }
    let (wu, hu) = (w as usize, h as usize);
    let (cw, ch) = (wu.div_ceil(2), hu.div_ceil(2));
    let (y, u, v) = match fmt {
        PlaneFormat::I420 => {
            let ys = wu * hu;
            (src[..ys].to_vec(), src[ys..ys + cw * ch].to_vec(), src[ys + cw * ch..ys + 2 * cw * ch].to_vec())
        }
        PlaneFormat::Nv12 => {
            let ys = wu * hu;
            let uv = &src[ys..ys + 2 * cw * ch];
            (src[..ys].to_vec(), uv.iter().step_by(2).copied().collect(), uv.iter().skip(1).step_by(2).copied().collect())
        }
        _ => rgb_to_yuv(&src[..need], fmt, wu, hu, ops.matrix),
    };
    let (y, rw, rh) = remap(&y, wu, hu, ops);
    let (u, rcw, rch) = remap(&u, cw, ch, ops);
    let (v, _, _) = remap(&v, cw, ch, ops);
    let (nw, nh) = output_dims(w, h, ops);
    let crop = ops.resize_pct.clamp(10, 100) == 100;
    let (nw, nh) = (nw as usize, nh as usize);
    let mut data = fit(y, rw, rh, nw, nh, crop)?;
    data.extend(fit(u, rcw, rch, nw / 2, nh / 2, crop)?);
    data.extend(fit(v, rcw, rch, nw / 2, nh / 2, crop)?);
    Ok(Planes { data, width: nw as u32, height: nh as u32 })
}
