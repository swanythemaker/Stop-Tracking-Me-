use super::bmff_model::{self, check_edits, parse_moov, rotation, Codec, Mp4Model, Sample};
use super::bmff_walk::TopWalk;
use super::bmff_write::{self, OutModel, OutSample, OutTrack};
use super::ebml_walk::{child, children, text, uint, MkvFront, TopElem};
use super::mkv_model::{self, parse_cluster, parse_info, parse_tracks, MkvInfo, MkvTrack};
use super::mkv_write::{self, MkvOutTrack};
use super::nal::{self, AvcConfig, NalKind};
use super::obu;
use super::reader::{check_feed, Gather, Req};
use super::{sniff, Container};
use crate::allowlist as al;
use crate::guard;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct RebuildOptions {
    pub keep_audio: bool,
    pub window: u32,
    pub container: Option<Container>,
}

impl Default for RebuildOptions {
    fn default() -> Self {
        RebuildOptions { keep_audio: false, window: guard::DEFAULT_WINDOW_BYTES, container: None }
    }
}

pub fn parse_container(s: &str) -> Result<Option<Container>, String> {
    match s {
        "" | "auto" | "same" => Ok(None),
        "mp4" | "mov" | "video/mp4" | "video/quicktime" => Ok(Some(Container::Mp4)),
        "webm" | "mkv" | "video/webm" | "video/x-matroska" => Ok(Some(Container::Mkv)),
        other => Err(format!("Unknown output container {other}")),
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct OptionsJson {
    keep_audio: bool,
    out_container: Option<String>,
    window_bytes: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Probe,
    Model,
    Ready,
    Samples,
    Done,
    Failed,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Probe => "probe",
            Phase::Model => "model",
            Phase::Ready => "ready",
            Phase::Samples => "samples",
            Phase::Done => "done",
            Phase::Failed => "error",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VCodec {
    Avc(u8),
    Hevc(u8),
    Av1,
    Plain,
}

fn filter_video(codec: VCodec, sample: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    match codec {
        VCodec::Avc(ls) => nal::filter_nals(NalKind::Avc, sample, ls, out).map(|_| ()),
        VCodec::Hevc(ls) => nal::filter_nals(NalKind::Hevc, sample, ls, out).map(|_| ()),
        VCodec::Av1 => obu::filter_av1(sample, out).map(|_| ()),
        VCodec::Plain => {
            if sample.is_empty() {
                return Err("Empty video frame".to_string());
            }
            out.extend_from_slice(sample);
            Ok(())
        }
    }
}

struct Window {
    from: usize,
    to: usize,
    start: u64,
    end: u64,
}

struct Mp4Job {
    walk: TopWalk,
    gather: Option<Gather>,
    model: Option<Mp4Model>,
    mdats: Vec<(u64, u64)>,
    vi: usize,
    ai: Option<usize>,
    kept: Vec<(u8, usize, u64, u32)>,
    windows: Vec<Window>,
    wi: usize,
    out: [Vec<OutSample>; 2],
    order: Vec<u8>,
    mdat_len: u64,
    vcodec: VCodec,
    sps: Vec<Vec<u8>>,
    pps: Vec<Vec<u8>>,
    seen_sync: bool,
}

struct MkvJob {
    front: MkvFront,
    gathers: Vec<(u32, Gather)>,
    header: Vec<u8>,
    info: MkvInfo,
    tracks: Vec<MkvTrack>,
    doc_type: String,
    vi: usize,
    ai: Option<usize>,
    clusters: Vec<TopElem>,
    ci: usize,
    gather: Option<Gather>,
    vcodec: VCodec,
    avc: Option<AvcConfig>,
    out_tracks: Vec<MkvOutTrack>,
    cur_ts: Option<u64>,
    cur_body: Vec<u8>,
    cur_pos: u64,
    cur_cue: bool,
    cues: Vec<(u64, u64, u64)>,
    body_len: u64,
    max_ms: u64,
    frames: u64,
    sps: Vec<Vec<u8>>,
    pps: Vec<Vec<u8>>,
    seen_key: bool,
}

pub struct Rebuild {
    file_len: u64,
    opts: RebuildOptions,
    phase: Phase,
    error: Option<String>,
    mp4: Option<Mp4Job>,
    mkv: Option<MkvJob>,
    out: Vec<u8>,
    finished: bool,
    head: Option<(Vec<u8>, Vec<u8>)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanTrack {
    codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rotation: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channels: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    samples: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    container: &'static str,
    out_container: &'static str,
    doc_type: Option<String>,
    duration_s: f64,
    video: PlanTrack,
    audio: Option<PlanTrack>,
    keep_audio: bool,
    dropped_tracks: Vec<String>,
    notes: Vec<String>,
}

impl Rebuild {
    pub fn open(file_len: u64) -> Result<Self, String> {
        guard::check_video_bytes(file_len)?;
        Ok(Rebuild {
            file_len,
            opts: RebuildOptions::default(),
            phase: Phase::Probe,
            error: None,
            mp4: None,
            mkv: None,
            out: Vec::new(),
            finished: false,
            head: None,
        })
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn set_options(&mut self, opts: RebuildOptions) -> Result<(), String> {
        if !matches!(self.phase, Phase::Probe | Phase::Model | Phase::Ready) {
            return Err("Options must be set before the sample pass starts".to_string());
        }
        self.opts = RebuildOptions { window: guard::clamp_window(opts.window), ..opts };
        self.check_container()
    }

    pub fn set_options_json(&mut self, json: &str) -> Result<(), String> {
        let o: OptionsJson = serde_json::from_str(json).map_err(|e| format!("Invalid options: {e}"))?;
        self.set_options(RebuildOptions {
            keep_audio: o.keep_audio,
            window: o.window_bytes.unwrap_or(guard::DEFAULT_WINDOW_BYTES),
            container: parse_container(o.out_container.as_deref().unwrap_or("auto"))?,
        })
    }

    fn check_container(&self) -> Result<(), String> {
        match (self.opts.container, self.container()) {
            (Some(want), Some(have)) if want != have => {
                Err("The basic clean keeps the input container (MP4 stays MP4, WebM or MKV stays WebM or MKV)".to_string())
            }
            _ => Ok(()),
        }
    }

    fn container(&self) -> Option<Container> {
        if self.mp4.is_some() {
            Some(Container::Mp4)
        } else if self.mkv.is_some() {
            Some(Container::Mkv)
        } else {
            None
        }
    }

    pub fn need(&mut self) -> Option<Req> {
        if self.phase == Phase::Ready {
            if let Err(e) = self.start_samples() {
                self.fail(e);
                return None;
            }
        }
        match self.phase {
            Phase::Probe if self.mp4.is_none() && self.mkv.is_none() => {
                Some(Req { offset: 0, len: self.file_len.min(64) as u32 })
            }
            Phase::Probe | Phase::Model | Phase::Samples => {
                if let Some(j) = &self.mp4 {
                    return mp4_need(j);
                }
                if let Some(j) = &self.mkv {
                    return mkv_need(j);
                }
                None
            }
            _ => None,
        }
    }

    fn fail(&mut self, e: String) {
        self.error = Some(e);
        self.phase = Phase::Failed;
    }

    pub fn feed(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        if let Some(e) = &self.error {
            return Err(e.clone());
        }
        match self.step(offset, bytes) {
            Ok(()) => Ok(()),
            Err(e) => {
                self.fail(e.clone());
                Err(e)
            }
        }
    }

    fn step(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let want = self.need().ok_or_else(|| "No read is pending".to_string())?;
        check_feed(want, offset, bytes)?;
        if self.phase == Phase::Probe && self.mp4.is_none() && self.mkv.is_none() {
            match sniff(bytes) {
                Some(Container::Mp4) => self.mp4 = Some(new_mp4(self.file_len)),
                Some(Container::Mkv) => self.mkv = Some(new_mkv(self.file_len)),
                None => return Err("Not an MP4, MOV, WebM or MKV file".to_string()),
            }
            return Ok(());
        }
        if self.mp4.is_some() {
            self.step_mp4(offset, bytes)
        } else {
            self.step_mkv(offset, bytes)
        }
    }

    pub fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.out)
    }

    pub fn finish(&mut self) -> Result<(Vec<u8>, Vec<u8>), String> {
        if let Some(e) = &self.error {
            return Err(e.clone());
        }
        if self.phase != Phase::Done {
            return Err("The rebuild has not read all samples yet".to_string());
        }
        if !self.out.is_empty() {
            return Err("Call takeOutput before finish".to_string());
        }
        if self.finished {
            return Err("finish was already called".to_string());
        }
        self.finished = true;
        self.head.take().ok_or_else(|| "Output head is missing".to_string())
    }

    pub fn plan_json(&self) -> String {
        match self.plan() {
            Some(p) => serde_json::to_string(&p).unwrap_or_else(|_| "{}".to_string()),
            None => "null".to_string(),
        }
    }

    fn plan(&self) -> Option<Plan> {
        if let Some(j) = &self.mp4 {
            let m = j.model.as_ref()?;
            let v = m.tracks.get(j.vi)?;
            let vis = v.visual.as_ref()?;
            let a = m.audio_index().and_then(|i| m.tracks.get(i));
            let bytes = |t: &bmff_model::Track| t.samples.iter().map(|s| s.size as u64).sum::<u64>();
            let mut notes = Vec::new();
            if !v.edits.is_empty() || a.map(|a| !a.edits.is_empty()).unwrap_or(false) {
                notes.push("edit list dropped".to_string());
            }
            let ts = m.movie_timescale;
            if bmff_model::has_leading_delay(v, ts) || a.map(|a| bmff_model::has_leading_delay(a, ts)).unwrap_or(false) {
                notes.push("leading delay dropped".to_string());
            }
            if matches!(v.codec, Codec::Avc(_) | Codec::Hevc(_)) {
                notes.push("SEI and other non-picture NAL units are removed".to_string());
            }
            if matches!(v.codec, Codec::Av1(_)) {
                notes.push("metadata and padding OBUs are removed".to_string());
            }
            let dropped = m
                .tracks
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != j.vi && Some(*i) != m.audio_index())
                .map(|(_, t)| t.line())
                .collect();
            return Some(Plan {
                container: "mp4",
                out_container: "mp4",
                doc_type: None,
                duration_s: v.seconds(),
                video: PlanTrack {
                    codec: v.fourcc_name(),
                    width: Some(vis.width as u64),
                    height: Some(vis.height as u64),
                    rotation: rotation(&v.matrix),
                    sample_rate: None,
                    channels: None,
                    samples: Some(v.samples.len() as u64),
                    bytes: Some(bytes(v)),
                },
                audio: a.map(|a| PlanTrack {
                    codec: a.fourcc_name(),
                    width: None,
                    height: None,
                    rotation: None,
                    sample_rate: a.audio.map(|x| x.rate as u64),
                    channels: a.audio.map(|x| x.channels as u64),
                    samples: Some(a.samples.len() as u64),
                    bytes: Some(bytes(a)),
                }),
                keep_audio: self.opts.keep_audio,
                dropped_tracks: dropped,
                notes,
            });
        }
        let j = self.mkv.as_ref()?;
        let v = j.tracks.get(j.vi)?;
        let vv = v.video.as_ref()?;
        let a = j.ai.and_then(|i| j.tracks.get(i));
        let dur = j.info.duration.unwrap_or(0.0) * j.info.timestamp_scale as f64 / 1e9;
        let out_doc = out_doc_type(v, a.filter(|_| self.opts.keep_audio));
        let mut notes = vec!["Tags, attachments, chapters and padding are removed".to_string()];
        if v.codec_id == "V_AV1" {
            notes.push("metadata and padding OBUs are removed".to_string());
        }
        if a.map(|a| a.codec_id == "A_VORBIS").unwrap_or(false) {
            notes.push("Vorbis comments are emptied".to_string());
        }
        Some(Plan {
            container: if j.doc_type == "webm" { "webm" } else { "mkv" },
            out_container: if out_doc == "webm" { "webm" } else { "mkv" },
            doc_type: Some(out_doc.to_string()),
            duration_s: dur,
            video: PlanTrack {
                codec: v.codec_id.clone(),
                width: Some(vv.pixel_width),
                height: Some(vv.pixel_height),
                rotation: None,
                sample_rate: None,
                channels: None,
                samples: None,
                bytes: None,
            },
            audio: a.map(|a| PlanTrack {
                codec: a.codec_id.clone(),
                width: None,
                height: None,
                rotation: None,
                sample_rate: a.audio.as_ref().map(|x| x.rate.round() as u64),
                channels: a.audio.as_ref().map(|x| x.channels),
                samples: None,
                bytes: None,
            }),
            keep_audio: self.opts.keep_audio,
            dropped_tracks: j
                .tracks
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != j.vi && Some(*i) != j.ai)
                .map(|(_, t)| t.line())
                .collect(),
            notes,
        })
    }

    fn start_samples(&mut self) -> Result<(), String> {
        self.check_container()?;
        let keep = self.opts.keep_audio;
        let window = self.opts.window;
        if let Some(j) = &mut self.mp4 {
            prepare_mp4(j, keep, window)?;
            self.phase = if j.windows.is_empty() { Phase::Done } else { Phase::Samples };
            if self.phase == Phase::Done {
                self.head = Some((finish_mp4(j)?, Vec::new()));
            }
        } else if let Some(j) = &mut self.mkv {
            prepare_mkv(j, keep)?;
            self.phase = Phase::Samples;
        }
        Ok(())
    }

    fn step_mp4(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let j = self.mp4.as_mut().ok_or_else(|| "No MP4 job".to_string())?;
        match self.phase {
            Phase::Probe => {
                j.walk.feed(offset, bytes)?;
                if j.walk.done() {
                    let moovs: Vec<_> = j.walk.boxes.iter().filter(|b| &b.typ == b"moov").cloned().collect();
                    if moovs.len() != 1 {
                        return Err(if moovs.is_empty() { "No moov box found" } else { "More than one moov box" }.to_string());
                    }
                    if j.walk.boxes.iter().any(|b| &b.typ == b"moof") {
                        return Err("Fragmented MP4 is not supported".to_string());
                    }
                    let m = &moovs[0];
                    if m.size > guard::MAX_MOOV_BYTES {
                        return Err("moov box is too large".to_string());
                    }
                    j.mdats = j
                        .walk
                        .boxes
                        .iter()
                        .filter(|b| &b.typ == b"mdat")
                        .map(|b| (b.payload_start(), b.end()))
                        .collect();
                    j.gather = Some(Gather::new(m.payload_start(), m.end(), guard::MAX_WINDOW_BYTES)?);
                    self.phase = Phase::Model;
                }
                Ok(())
            }
            Phase::Model => {
                let g = j.gather.as_mut().ok_or_else(|| "No pending moov read".to_string())?;
                if g.feed(offset, bytes)? {
                    let data = j.gather.take().map(|g| g.take()).unwrap_or_default();
                    let model = parse_moov(&data)?;
                    if let Some(r) = model.refuse_reasons().into_iter().next() {
                        return Err(r);
                    }
                    j.vi = model.video_index().ok_or_else(|| "No video track found".to_string())?;
                    j.model = Some(model);
                    self.phase = Phase::Ready;
                }
                Ok(())
            }
            Phase::Samples => {
                feed_mp4_window(j, bytes, &mut self.out)?;
                if j.wi >= j.windows.len() {
                    self.head = Some((finish_mp4(j)?, Vec::new()));
                    self.phase = Phase::Done;
                }
                Ok(())
            }
            _ => Err("No read is pending".to_string()),
        }
    }

    fn step_mkv(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let j = self.mkv.as_mut().ok_or_else(|| "No MKV job".to_string())?;
        match self.phase {
            Phase::Probe => {
                j.front.feed(offset, bytes)?;
                if j.front.done() {
                    if let Some(e) = &j.front.error {
                        return Err(e.clone());
                    }
                    queue_mkv_gathers(j)?;
                    self.phase = Phase::Model;
                }
                Ok(())
            }
            Phase::Model => {
                let (_, g) = j.gathers.first_mut().ok_or_else(|| "No pending read".to_string())?;
                if g.feed(offset, bytes)? {
                    let (tag, g) = j.gathers.remove(0);
                    let data = g.take();
                    match tag {
                        al::EBML_HEADER => j.header = data,
                        al::MKV_INFO => j.info = parse_info(&data)?,
                        _ => j.tracks = parse_tracks(&data)?,
                    }
                    if j.gathers.is_empty() {
                        model_mkv(j)?;
                        self.phase = Phase::Ready;
                    }
                }
                Ok(())
            }
            Phase::Samples => {
                let g = j.gather.as_mut().ok_or_else(|| "No pending cluster read".to_string())?;
                if g.feed(offset, bytes)? {
                    let data = j.gather.take().map(|g| g.take()).unwrap_or_default();
                    feed_mkv_cluster(j, &data, &mut self.out)?;
                    j.ci += 1;
                    if j.ci < j.clusters.len() {
                        let c = j.clusters[j.ci];
                        j.gather = Some(Gather::new(c.start, c.end(), guard::MAX_WINDOW_BYTES)?);
                    } else {
                        flush_cluster(j, &mut self.out);
                        self.head = Some(finish_mkv(j)?);
                        self.phase = Phase::Done;
                    }
                }
                Ok(())
            }
            _ => Err("No read is pending".to_string()),
        }
    }
}

fn new_mp4(file_len: u64) -> Mp4Job {
    Mp4Job {
        walk: TopWalk::new(file_len),
        gather: None,
        model: None,
        mdats: Vec::new(),
        vi: 0,
        ai: None,
        kept: Vec::new(),
        windows: Vec::new(),
        wi: 0,
        out: [Vec::new(), Vec::new()],
        order: Vec::new(),
        mdat_len: 0,
        vcodec: VCodec::Plain,
        sps: Vec::new(),
        pps: Vec::new(),
        seen_sync: false,
    }
}

fn mp4_need(j: &Mp4Job) -> Option<Req> {
    if !j.walk.done() {
        return j.walk.need();
    }
    if let Some(g) = &j.gather {
        return g.need();
    }
    let w = j.windows.get(j.wi)?;
    Some(Req { offset: w.start, len: (w.end - w.start) as u32 })
}

fn prepare_mp4(j: &mut Mp4Job, keep_audio: bool, window: u32) -> Result<(), String> {
    let m = j.model.as_ref().ok_or_else(|| "No model".to_string())?;
    let v = m.tracks.get(j.vi).ok_or_else(|| "No video track".to_string())?;
    j.vcodec = match &v.codec {
        Codec::Avc(c) => VCodec::Avc(c.len_size),
        Codec::Hevc(c) => VCodec::Hevc(c.len_size()),
        Codec::Av1(_) => VCodec::Av1,
        _ => VCodec::Plain,
    };
    j.ai = if keep_audio { m.audio_index() } else { None };
    if let Some(ai) = j.ai {
        let a = &m.tracks[ai];
        check_edits(a, m.movie_timescale)?;
        if a.audio.map(|x| x.rate == 0 || x.rate > 0xFFFF || x.channels == 0).unwrap_or(true) {
            return Err("Audio sample rate or channel count is not supported".to_string());
        }
    }
    let mut kept: Vec<(u8, usize, u64, u32)> = Vec::new();
    let slots: Vec<(u8, usize)> = std::iter::once((0u8, j.vi)).chain(j.ai.map(|a| (1u8, a))).collect();
    for (slot, ti) in slots {
        let t = &m.tracks[ti];
        let mut prev_end = 0u64;
        for (i, s) in t.samples.iter().enumerate() {
            let end = s.offset.checked_add(s.size as u64).ok_or_else(|| "Sample offset overflow".to_string())?;
            if !j.mdats.iter().any(|&(a, b)| s.offset >= a && end <= b) {
                return Err("A sample points outside the media data".to_string());
            }
            if i > 0 && s.offset < prev_end {
                return Err("Samples are out of order or overlap".to_string());
            }
            if s.size as u64 > guard::MAX_WINDOW_BYTES as u64 {
                return Err("A sample is larger than the read window".to_string());
            }
            prev_end = end;
            kept.push((slot, i, s.offset, s.size));
        }
    }
    kept.sort_by_key(|&(slot, i, off, _)| (off, slot, i));
    for w in kept.windows(2) {
        if w[0].2 + w[0].3 as u64 > w[1].2 {
            return Err("Samples of different tracks overlap".to_string());
        }
    }
    let mut windows = Vec::new();
    let mut i = 0usize;
    while i < kept.len() {
        let start = kept[i].2;
        let mut k = i;
        let mut end = start + kept[i].3 as u64;
        while k + 1 < kept.len() {
            let e = kept[k + 1].2 + kept[k + 1].3 as u64;
            if e - start > window as u64 {
                break;
            }
            k += 1;
            end = e;
        }
        windows.push(Window { from: i, to: k + 1, start, end });
        i = k + 1;
    }
    j.kept = kept;
    j.windows = windows;
    j.wi = 0;
    j.out = [Vec::new(), Vec::new()];
    j.order.clear();
    j.mdat_len = 0;
    Ok(())
}

fn feed_mp4_window(j: &mut Mp4Job, data: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    let m = j.model.as_ref().ok_or_else(|| "No model".to_string())?;
    let w = j.windows.get(j.wi).ok_or_else(|| "No window pending".to_string())?;
    for &(slot, idx, off, size) in &j.kept[w.from..w.to] {
        let rel = (off - w.start) as usize;
        let bytes = data.get(rel..rel + size as usize).ok_or_else(|| "Window is shorter than its samples".to_string())?;
        let ti = if slot == 0 { j.vi } else { j.ai.ok_or_else(|| "No audio track".to_string())? };
        let s: &Sample = &m.tracks[ti].samples[idx];
        let before = out.len();
        if slot == 0 {
            if let (VCodec::Avc(ls), true, false) = (j.vcodec, s.sync, j.seen_sync) {
                nal::collect_param_sets(bytes, ls, &mut j.sps, &mut j.pps)?;
                j.seen_sync = true;
            }
            filter_video(j.vcodec, bytes, out)?;
        } else {
            out.extend_from_slice(bytes);
        }
        let new_size = u32::try_from(out.len() - before).map_err(|_| "Sample too large".to_string())?;
        j.out[slot as usize].push(OutSample { size: new_size, dur: s.dur, cts: s.cts, sync: s.sync });
        j.order.push(slot);
        j.mdat_len += new_size as u64;
    }
    j.wi += 1;
    Ok(())
}

fn finish_mp4(j: &mut Mp4Job) -> Result<Vec<u8>, String> {
    let m = j.model.as_ref().ok_or_else(|| "No model".to_string())?;
    let v = &m.tracks[j.vi];
    let vis = v.visual.as_ref().ok_or_else(|| "Video track has no visual entry".to_string())?;
    let fourcc = v.fourcc.ok_or_else(|| "Video track has no sample entry".to_string())?;
    let config: (&[u8; 4], Vec<u8>) = match &v.codec {
        Codec::Avc(c) => (b"avcC", nal::build_avcc(c, &j.sps, &j.pps)?),
        Codec::Hevc(c) => (b"hvcC", nal::write_hvcc(c)),
        Codec::Av1(c) => (b"av1C", obu::write_av1c(c)),
        Codec::Vp9(c) => (b"vpcC", bmff_model::write_vpcc(c)),
        _ => return Err("Unsupported video codec".to_string()),
    };
    let entry = bmff_write::visual_entry(&fourcc, vis.width, vis.height, (config.0, &config.1), vis.colr, vis.pasp);
    let (mut w, mut h) = (v.tkhd_width, v.tkhd_height);
    if w == 0 || h == 0 || (w >> 16) > guard::MAX_VIDEO_DIM || (h >> 16) > guard::MAX_VIDEO_DIM {
        w = (vis.width as u32) << 16;
        h = (vis.height as u32) << 16;
    }
    let mut tracks = vec![OutTrack {
        handler: *b"vide",
        timescale: v.timescale,
        width: w,
        height: h,
        rotation: rotation(&v.matrix).unwrap_or(0),
        entry,
        samples: std::mem::take(&mut j.out[0]),
    }];
    if let Some(ai) = j.ai {
        let a = &m.tracks[ai];
        let au = a.audio.ok_or_else(|| "Audio track has no audio entry".to_string())?;
        let entry = match &a.codec {
            Codec::Aac(e) => bmff_write::mp4a_entry(au.channels, au.rate, &e.asc),
            Codec::Opus(o) => bmff_write::opus_entry(au.rate, o),
            _ => return Err("Unsupported audio codec".to_string()),
        };
        tracks.push(OutTrack {
            handler: *b"soun",
            timescale: a.timescale,
            width: 0,
            height: 0,
            rotation: 0,
            entry,
            samples: std::mem::take(&mut j.out[1]),
        });
    }
    let om = OutModel { video_fourcc: fourcc, tracks, order: std::mem::take(&mut j.order), mdat_len: j.mdat_len };
    bmff_write::write_head(&om)
}

fn new_mkv(file_len: u64) -> MkvJob {
    MkvJob {
        front: MkvFront::new(file_len),
        gathers: Vec::new(),
        header: Vec::new(),
        info: MkvInfo::default(),
        tracks: Vec::new(),
        doc_type: String::new(),
        vi: 0,
        ai: None,
        clusters: Vec::new(),
        ci: 0,
        gather: None,
        vcodec: VCodec::Plain,
        avc: None,
        out_tracks: Vec::new(),
        cur_ts: None,
        cur_body: Vec::new(),
        cur_pos: 0,
        cur_cue: false,
        cues: Vec::new(),
        body_len: 0,
        max_ms: 0,
        frames: 0,
        sps: Vec::new(),
        pps: Vec::new(),
        seen_key: false,
    }
}

fn mkv_need(j: &MkvJob) -> Option<Req> {
    if !j.front.done() {
        return j.front.need();
    }
    if let Some((_, g)) = j.gathers.first() {
        return g.need();
    }
    j.gather.as_ref().and_then(|g| g.need())
}

fn queue_mkv_gathers(j: &mut MkvJob) -> Result<(), String> {
    let h = j.front.header.ok_or_else(|| "Missing EBML header".to_string())?;
    let mut list = vec![(al::EBML_HEADER, Gather::new(h.data_start(), h.end(), guard::MAX_WINDOW_BYTES)?)];
    for id in [al::MKV_INFO, al::MKV_TRACKS] {
        let found: Vec<TopElem> = j.front.elems.iter().filter(|e| e.id == id).copied().collect();
        if found.len() != 1 {
            return Err(format!("File must have exactly one {} element", super::ebml_walk::name(id)));
        }
        let e = found[0];
        if e.size > guard::MAX_MOOV_BYTES {
            return Err(format!("{} element is too large", super::ebml_walk::name(id)));
        }
        list.push((id, Gather::new(e.data_start(), e.end(), guard::MAX_WINDOW_BYTES)?));
    }
    j.gathers = list;
    j.clusters = j.front.elems.iter().filter(|e| e.id == al::MKV_CLUSTER).copied().collect();
    if j.clusters.iter().any(|c| c.end() - c.start > guard::MAX_WINDOW_BYTES as u64) {
        return Err("A cluster is larger than the read window".to_string());
    }
    Ok(())
}

pub fn doc_type_of(header: &[u8]) -> Result<String, String> {
    let kids = children(header)?;
    let dt = child(&kids, 0x4282).map(|e| text(e.data)).unwrap_or_else(|| "matroska".to_string());
    if let Some(v) = child(&kids, 0x4285) {
        if uint(v.data)? > 4 {
            return Err("Matroska read version is too new".to_string());
        }
    }
    Ok(dt)
}

fn out_doc_type(v: &MkvTrack, a: Option<&MkvTrack>) -> &'static str {
    let webm = std::iter::once(v).chain(a).all(|t| al::MKV_WEBM_CODECS.contains(&t.codec_id.as_str()));
    if webm {
        "webm"
    } else {
        "matroska"
    }
}

fn model_mkv(j: &mut MkvJob) -> Result<(), String> {
    j.doc_type = doc_type_of(&j.header)?;
    if j.doc_type != "webm" && j.doc_type != "matroska" {
        return Err(format!("Unsupported DocType {}", j.doc_type));
    }
    if j.tracks.len() > guard::MAX_TRACKS {
        return Err("Too many tracks".to_string());
    }
    if j.tracks.iter().any(|t| t.content_encodings) {
        return Err("Compressed or encrypted Matroska tracks (ContentEncodings) are not supported".to_string());
    }
    let videos: Vec<usize> = (0..j.tracks.len()).filter(|&i| j.tracks[i].is_video()).collect();
    if videos.is_empty() {
        return Err("No video track found".to_string());
    }
    if videos.len() > 1 {
        return Err("More than one video track is not supported".to_string());
    }
    j.vi = videos[0];
    let v = &j.tracks[j.vi];
    if !al::MKV_VIDEO_CODECS.contains(&v.codec_id.as_str()) {
        return Err(format!("Unsupported video codec: {}", v.codec_id));
    }
    let vv = v.video.as_ref().ok_or_else(|| "Video track has no Video element".to_string())?;
    guard::check_video_dims(vv.pixel_width.min(u32::MAX as u64) as u32, vv.pixel_height.min(u32::MAX as u64) as u32)?;
    if let Some(d) = j.info.duration {
        guard::check_duration(d * j.info.timestamp_scale as f64 / 1e9)?;
    }
    j.ai = (0..j.tracks.len())
        .find(|&i| j.tracks[i].is_audio() && al::MKV_AUDIO_CODECS.contains(&j.tracks[i].codec_id.as_str()));
    Ok(())
}

fn prepare_mkv(j: &mut MkvJob, keep_audio: bool) -> Result<(), String> {
    if !keep_audio {
        j.ai = None;
    }
    let v = j.tracks[j.vi].clone();
    let mut vt = MkvOutTrack {
        number: 1,
        ttype: 1,
        codec_id: v.codec_id.clone(),
        private: None,
        default_duration: v.default_duration,
        codec_delay: None,
        seek_preroll: None,
        video: v.video.clone(),
        audio: None,
    };
    let need_priv = || v.private.clone().ok_or_else(|| format!("{} track has no CodecPrivate", v.codec_id));
    match v.codec_id.as_str() {
        "V_MPEG4/ISO/AVC" => {
            let cfg = nal::parse_avcc(&need_priv()?)?;
            j.vcodec = VCodec::Avc(cfg.len_size);
            j.avc = Some(cfg);
        }
        "V_MPEGH/ISO/HEVC" => {
            let cfg = nal::parse_hvcc(&need_priv()?)?;
            j.vcodec = VCodec::Hevc(cfg.len_size());
            vt.private = Some(nal::write_hvcc(&cfg));
        }
        "V_AV1" => {
            j.vcodec = VCodec::Av1;
            if let Some(p) = &v.private {
                vt.private = Some(obu::rebuild_av1c(p)?);
            }
        }
        _ => j.vcodec = VCodec::Plain,
    }
    let mut list = vec![vt];
    if let Some(ai) = j.ai {
        let a = j.tracks[ai].clone();
        let private = match a.codec_id.as_str() {
            "A_OPUS" => {
                let p = a.private.clone().ok_or_else(|| "Opus track has no CodecPrivate".to_string())?;
                Some(mkv_model::write_opus_head(&mkv_model::parse_opus_head(&p)?))
            }
            "A_VORBIS" => {
                let p = a.private.clone().ok_or_else(|| "Vorbis track has no CodecPrivate".to_string())?;
                Some(mkv_model::rebuild_vorbis(&p)?)
            }
            _ => {
                let p = a.private.clone().ok_or_else(|| "AAC track has no CodecPrivate".to_string())?;
                if p.len() < 2 || p.len() > 64 {
                    return Err("Invalid AAC decoder config".to_string());
                }
                Some(p)
            }
        };
        let au = a.audio.clone().ok_or_else(|| "Audio track has no Audio element".to_string())?;
        if !au.rate.is_finite() || au.rate <= 0.0 || au.rate > 768_000.0 || au.channels == 0 || au.channels > 255 {
            return Err("Audio sample rate or channel count is not supported".to_string());
        }
        list.push(MkvOutTrack {
            number: 2,
            ttype: 2,
            codec_id: a.codec_id.clone(),
            private,
            default_duration: a.default_duration,
            codec_delay: a.codec_delay,
            seek_preroll: a.seek_preroll,
            video: None,
            audio: Some(au),
        });
    }
    j.out_tracks = list;
    j.ci = 0;
    j.gather = match j.clusters.first() {
        Some(c) => Some(Gather::new(c.start, c.end(), guard::MAX_WINDOW_BYTES)?),
        None => return Err("File has no clusters".to_string()),
    };
    Ok(())
}

fn to_ms(units: u64, scale: u64) -> u64 {
    ((units as u128 * scale as u128 + 500_000) / 1_000_000) as u64
}

fn flush_cluster(j: &mut MkvJob, out: &mut Vec<u8>) {
    if let Some(ts) = j.cur_ts.take() {
        let bytes = mkv_write::cluster(ts, &j.cur_body);
        j.body_len += bytes.len() as u64;
        out.extend_from_slice(&bytes);
        j.cur_body.clear();
        j.cur_cue = false;
    }
}

fn feed_mkv_cluster(j: &mut MkvJob, data: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    let c = j.clusters[j.ci];
    let body = data.get(c.header_len as usize..).ok_or_else(|| "Truncated cluster".to_string())?;
    let cl = parse_cluster(body)?;
    let vnum = j.tracks[j.vi].number;
    let anum = j.ai.map(|i| j.tracks[i].number);
    let mut frame = Vec::new();
    for b in &cl.blocks {
        let slot = if b.track == vnum {
            1u64
        } else if Some(b.track) == anum {
            2u64
        } else {
            continue;
        };
        let abs = i64::try_from(cl.timestamp)
            .ok()
            .and_then(|t| t.checked_add(b.rel as i64))
            .filter(|&t| t >= 0)
            .ok_or_else(|| "Invalid block timestamp".to_string())?;
        let ms = to_ms(abs as u64, j.info.timestamp_scale);
        frame.clear();
        if slot == 1 {
            if let (VCodec::Avc(ls), true, false) = (j.vcodec, b.key, j.seen_key) {
                nal::collect_param_sets(b.frame, ls, &mut j.sps, &mut j.pps)?;
                j.seen_key = true;
            }
            filter_video(j.vcodec, b.frame, &mut frame)?;
        } else {
            frame.extend_from_slice(b.frame);
        }
        let video_key = slot == 1 && b.key;
        if let Some(cts) = j.cur_ts {
            if (video_key && ms >= cts + 1000) || ms >= cts + 30_000 || ms < cts {
                flush_cluster(j, out);
            }
        }
        if j.cur_ts.is_none() {
            j.cur_ts = Some(ms);
            j.cur_pos = j.body_len;
        }
        let cts = j.cur_ts.unwrap_or(ms);
        if video_key && !j.cur_cue {
            j.cues.push((ms, 1, j.cur_pos));
            j.cur_cue = true;
        }
        let flags = (if b.key { 0x80 } else { 0 }) | (b.flags & 0x09);
        mkv_write::simple_block(&mut j.cur_body, slot, (ms - cts) as i16, flags, &frame);
        j.max_ms = j.max_ms.max(ms);
        j.frames += slot & 1;
    }
    Ok(())
}

fn finish_mkv(j: &mut MkvJob) -> Result<(Vec<u8>, Vec<u8>), String> {
    if j.frames == 0 {
        return Err("No video frames found".to_string());
    }
    if let Some(cfg) = &j.avc {
        let p = nal::build_avcc(cfg, &j.sps, &j.pps)?;
        if let Some(t) = j.out_tracks.first_mut() {
            t.private = Some(p);
        }
    }
    if j.cues.is_empty() {
        j.cues.push((0, 1, 0));
    }
    let dur = match j.info.duration {
        Some(d) => (d * j.info.timestamp_scale as f64 / 1e6 * 1000.0).round() / 1000.0,
        None => j.max_ms as f64,
    };
    let v = &j.tracks[j.vi];
    let a = j.ai.map(|i| &j.tracks[i]);
    let doc = out_doc_type(v, a);
    let h = mkv_write::assemble(doc, dur, &j.out_tracks, j.body_len, &j.cues);
    Ok((h.head, h.tail))
}
