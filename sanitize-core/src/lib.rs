pub mod allowlist;
pub mod audit;
pub mod container;
pub mod decode;
pub mod guard;
pub mod strip;
pub mod transform;
pub mod video;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransformOpts {
    resize_pct: u32,
    rotate: i32,
    flip_h: bool,
    flip_v: bool,
}

#[wasm_bindgen]
pub struct DecodeResult {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    orig_width: u32,
    orig_height: u32,
}

#[wasm_bindgen]
impl DecodeResult {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[wasm_bindgen(getter, js_name = origWidth)]
    pub fn orig_width(&self) -> u32 {
        self.orig_width
    }
    #[wasm_bindgen(getter, js_name = origHeight)]
    pub fn orig_height(&self) -> u32 {
        self.orig_height
    }

    #[wasm_bindgen(js_name = takeRgba)]
    pub fn take_rgba(self) -> Vec<u8> {
        self.rgba
    }
}

#[wasm_bindgen]
pub struct StripAuditResult {
    bytes: Vec<u8>,
    audit_json: String,
    passed: bool,
}

#[wasm_bindgen]
impl StripAuditResult {
    #[wasm_bindgen(getter)]
    pub fn passed(&self) -> bool {
        self.passed
    }
    #[wasm_bindgen(getter, js_name = auditJson)]
    pub fn audit_json(&self) -> String {
        self.audit_json.clone()
    }
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[wasm_bindgen(js_name = decodeAndTransform)]
pub fn decode_and_transform(input: &[u8], opts_json: &str) -> Result<DecodeResult, JsError> {
    let opts: TransformOpts =
        serde_json::from_str(opts_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut img = decode::decode_upright(input).map_err(|e| JsError::new(&e))?;
    let (orig_width, orig_height) = img.dimensions();

    if opts.flip_h {
        img = transform::flip_horizontal(img);
    }
    if opts.flip_v {
        img = transform::flip_vertical(img);
    }
    img = transform::rotate(img, opts.rotate);
    img = transform::resize(img, opts.resize_pct);

    let (width, height) = img.dimensions();
    Ok(DecodeResult { rgba: img.into_raw(), width, height, orig_width, orig_height })
}

#[wasm_bindgen(js_name = stripAndAudit)]
pub fn strip_and_audit(encoded: &[u8], format: &str) -> Result<StripAuditResult, JsError> {
    let bytes = strip::strip(format, encoded).map_err(|e| JsError::new(&e))?;
    let summary = audit::audit(format, &bytes);
    let passed = summary.passed;
    let audit_json = serde_json::to_string(&summary).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(StripAuditResult { bytes, audit_json, passed })
}

#[wasm_bindgen(js_name = auditBytes)]
pub fn audit_bytes(input: &[u8]) -> String {
    let summary = audit::audit_auto(input);
    serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string())
}

fn js_u64(v: f64) -> Result<u64, JsError> {
    if !v.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&v) || v.fract() != 0.0 {
        return Err(JsError::new("Invalid byte offset or length"));
    }
    Ok(v as u64)
}

#[wasm_bindgen]
pub struct ReadReq {
    offset: f64,
    len: u32,
}

#[wasm_bindgen]
impl ReadReq {
    #[wasm_bindgen(getter)]
    pub fn offset(&self) -> f64 {
        self.offset
    }
    #[wasm_bindgen(getter, js_name = len)]
    pub fn read_len(&self) -> u32 {
        self.len
    }
}

fn to_req(r: Option<video::reader::Req>) -> Option<ReadReq> {
    r.map(|r| ReadReq { offset: r.offset as f64, len: r.len })
}

#[wasm_bindgen]
pub struct RebuildTail {
    head: Vec<u8>,
    tail: Vec<u8>,
}

#[wasm_bindgen]
impl RebuildTail {
    #[wasm_bindgen(js_name = takeHead)]
    pub fn take_head(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.head)
    }
    #[wasm_bindgen(js_name = takeTail)]
    pub fn take_tail(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.tail)
    }
}

#[wasm_bindgen]
pub struct VideoRebuild {
    inner: video::Rebuild,
}

#[wasm_bindgen]
impl VideoRebuild {
    pub fn open(file_len: f64) -> Result<VideoRebuild, JsError> {
        let inner = video::Rebuild::open(js_u64(file_len)?).map_err(|e| JsError::new(&e))?;
        Ok(VideoRebuild { inner })
    }
    #[wasm_bindgen(js_name = nextRead)]
    pub fn next_read(&mut self) -> Option<ReadReq> {
        to_req(self.inner.need())
    }
    pub fn feed(&mut self, offset: f64, bytes: &[u8]) -> Result<(), JsError> {
        self.inner.feed(js_u64(offset)?, bytes).map_err(|e| JsError::new(&e))
    }
    pub fn phase(&self) -> String {
        self.inner.phase().as_str().to_string()
    }
    pub fn error(&self) -> Option<String> {
        self.inner.error().map(|s| s.to_string())
    }
    #[wasm_bindgen(js_name = planJson)]
    pub fn plan_json(&self) -> String {
        self.inner.plan_json()
    }
    #[wasm_bindgen(js_name = setOptions)]
    pub fn set_options(&mut self, json: &str) -> Result<(), JsError> {
        self.inner.set_options_json(json).map_err(|e| JsError::new(&e))
    }
    #[wasm_bindgen(js_name = takeOutput)]
    pub fn take_output(&mut self) -> Vec<u8> {
        self.inner.take_output()
    }
    pub fn finish(&mut self) -> Result<RebuildTail, JsError> {
        let (head, tail) = self.inner.finish().map_err(|e| JsError::new(&e))?;
        Ok(RebuildTail { head, tail })
    }
}

#[wasm_bindgen]
pub struct VideoAudit {
    inner: video::Audit,
}

#[wasm_bindgen]
impl VideoAudit {
    pub fn open(file_len: f64, strict: Option<bool>) -> Result<VideoAudit, JsError> {
        Ok(VideoAudit { inner: video::Audit::open(js_u64(file_len)?, strict.unwrap_or(true)) })
    }
    #[wasm_bindgen(js_name = setWindow)]
    pub fn set_window(&mut self, bytes: u32) {
        self.inner.set_window(bytes);
    }
    #[wasm_bindgen(js_name = nextRead)]
    pub fn next_read(&mut self) -> Option<ReadReq> {
        to_req(self.inner.need())
    }
    pub fn feed(&mut self, offset: f64, bytes: &[u8]) -> Result<(), JsError> {
        self.inner.feed(js_u64(offset)?, bytes).map_err(|e| JsError::new(&e))
    }
    pub fn finish(&self) -> String {
        serde_json::to_string(&self.inner.summary()).unwrap_or_else(|_| "{}".to_string())
    }
}

#[wasm_bindgen]
pub struct PlanesOut {
    ptr: u32,
    len: u32,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl PlanesOut {
    #[wasm_bindgen(getter)]
    pub fn ptr(&self) -> u32 {
        self.ptr
    }
    #[wasm_bindgen(getter, js_name = len)]
    pub fn out_len(&self) -> u32 {
        self.len
    }
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
}

fn plane_ops(json: &str) -> Result<video::planes::PlaneOps, JsError> {
    if json.trim().is_empty() {
        return Ok(video::planes::PlaneOps::default());
    }
    serde_json::from_str(json).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub struct PlaneScratch {
    input: Vec<u8>,
    output: Vec<u8>,
}

#[wasm_bindgen]
impl PlaneScratch {
    #[wasm_bindgen(constructor)]
    pub fn new(max_bytes: u32) -> Result<PlaneScratch, JsError> {
        let cap = guard::MAX_VIDEO_PIXELS.saturating_mul(4);
        if max_bytes as u64 > cap {
            return Err(JsError::new("Frame buffer is larger than the video pixel limit allows"));
        }
        Ok(PlaneScratch { input: vec![0u8; max_bytes as usize], output: Vec::new() })
    }
    #[wasm_bindgen(js_name = inputPtr)]
    pub fn input_ptr(&mut self) -> u32 {
        self.input.as_mut_ptr() as usize as u32
    }
    #[wasm_bindgen(js_name = inputLen)]
    pub fn input_len(&self) -> u32 {
        self.input.len() as u32
    }
    #[wasm_bindgen(js_name = outputPtr)]
    pub fn output_ptr(&self) -> u32 {
        self.output.as_ptr() as usize as u32
    }
    pub fn transform(&mut self, fmt: &str, width: u32, height: u32, opts_json: &str) -> Result<PlanesOut, JsError> {
        let f = video::planes::PlaneFormat::parse(fmt).map_err(|e| JsError::new(&e))?;
        let ops = plane_ops(opts_json)?;
        let p = video::planes::transform_planes(&self.input, f, width, height, &ops).map_err(|e| JsError::new(&e))?;
        self.output = p.data;
        Ok(PlanesOut {
            ptr: self.output.as_ptr() as usize as u32,
            len: self.output.len() as u32,
            width: p.width,
            height: p.height,
        })
    }
}

#[wasm_bindgen]
pub struct PlanesResult {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl PlanesResult {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.bytes)
    }
}

#[wasm_bindgen(js_name = transformPlanes)]
pub fn transform_planes(src: &[u8], fmt: &str, width: u32, height: u32, opts_json: &str) -> Result<PlanesResult, JsError> {
    let f = video::planes::PlaneFormat::parse(fmt).map_err(|e| JsError::new(&e))?;
    let ops = plane_ops(opts_json)?;
    let p = video::planes::transform_planes(src, f, width, height, &ops).map_err(|e| JsError::new(&e))?;
    Ok(PlanesResult { bytes: p.data, width: p.width, height: p.height })
}
