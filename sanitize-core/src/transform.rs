use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType as FirFilter, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::imageops;
use image::RgbaImage;

pub fn bake_orientation(img: RgbaImage, orientation: u32) -> RgbaImage {
    match orientation {
        2 => imageops::flip_horizontal(&img),
        3 => imageops::rotate180(&img),
        4 => imageops::flip_vertical(&img),
        5 => {
            let f = imageops::flip_horizontal(&img);
            imageops::rotate90(&f)
        }
        6 => imageops::rotate90(&img),
        7 => {
            let f = imageops::flip_horizontal(&img);
            imageops::rotate270(&f)
        }
        8 => imageops::rotate270(&img),
        _ => img,
    }
}

pub fn rotate(img: RgbaImage, degrees: i32) -> RgbaImage {
    match degrees.rem_euclid(360) {
        90 => imageops::rotate90(&img),
        180 => imageops::rotate180(&img),
        270 => imageops::rotate270(&img),
        _ => img,
    }
}

pub fn flip_horizontal(img: RgbaImage) -> RgbaImage {
    imageops::flip_horizontal(&img)
}

pub fn flip_vertical(img: RgbaImage) -> RgbaImage {
    imageops::flip_vertical(&img)
}

pub fn resize(img: RgbaImage, pct: u32) -> RgbaImage {
    let pct = pct.clamp(10, 100);
    if pct == 100 {
        return img;
    }
    let (w, h) = img.dimensions();
    let nw = (((w as u64) * (pct as u64) + 50) / 100).max(1) as u32;
    let nh = (((h as u64) * (pct as u64) + 50) / 100).max(1) as u32;
    if nw == w && nh == h {
        return img;
    }
    resize_fir(&img, nw, nh).unwrap_or_else(|| {
        imageops::resize(&img, nw, nh, image::imageops::FilterType::Lanczos3)
    })
}

fn resize_fir(img: &RgbaImage, nw: u32, nh: u32) -> Option<RgbaImage> {
    let (w, h) = img.dimensions();
    let src = FirImage::from_vec_u8(w, h, img.as_raw().clone(), PixelType::U8x4).ok()?;
    let mut dst = FirImage::new(nw, nh, PixelType::U8x4);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilter::Lanczos3));
    Resizer::new().resize(&src, &mut dst, &opts).ok()?;
    RgbaImage::from_raw(nw, nh, dst.into_vec())
}
