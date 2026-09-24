use super::bmff_model::{self, parse_moov, Codec};
use super::bmff_walk::{full_box, walk_tree, BoxHeader, Node, TopWalk};
use super::bmff_write::LANG_UND;
use super::ebml_walk::{self, MkvFront, TopElem};
use super::mkv_model::{self, parse_cluster, parse_info, parse_tracks, walk, Collector};
use super::nal::{self, NalKind};
use super::obu;
use super::reader::{check_feed, Cursor, Gather, Req};
use super::rebuild::doc_type_of;
use super::report::{group_findings, human_name, push_unique, Finding};
use super::{sniff, Container};
use crate::allowlist::{self as al, Group};
use crate::guard;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoAuditSummary {
    pub kind: String,
    pub issues: Vec<String>,
    pub markers: Vec<String>,
    pub byte_length: u64,
    pub passed: bool,
    pub groups: BTreeMap<String, Vec<String>>,
    pub tracks: Vec<String>,
}

pub struct Sweeper {
    carry: Vec<u8>,
    keep: usize,
    by_first: Vec<Vec<usize>>,
    pub hits: Vec<(usize, u64)>,
}

impl Default for Sweeper {
    fn default() -> Self {
        Self::new()
    }
}

impl Sweeper {
    pub fn new() -> Self {
        let mut by_first = vec![Vec::new(); 256];
        for (i, (n, _, _)) in al::MAGIC_SWEEP.iter().enumerate() {
            if let Some(&f) = n.first() {
                by_first[f as usize].push(i);
            }
        }
        Sweeper { carry: Vec::new(), keep: al::magic_max_len().saturating_sub(1), by_first, hits: Vec::new() }
    }

    fn hit(&mut self, idx: usize, off: u64) {
        if self.hits.len() < 256 && !self.hits.contains(&(idx, off)) {
            self.hits.push((idx, off));
        }
    }

    pub fn feed(&mut self, offset: u64, data: &[u8]) {
        if !self.carry.is_empty() {
            let cl = self.carry.len();
            let mut tmp = self.carry.clone();
            tmp.extend_from_slice(&data[..data.len().min(self.keep)]);
            let base = offset - cl as u64;
            for p in 0..cl {
                for k in 0..self.by_first[tmp[p] as usize].len() {
                    let i = self.by_first[tmp[p] as usize][k];
                    let n = al::MAGIC_SWEEP[i].0;
                    if p + n.len() > cl && tmp[p..].starts_with(n) {
                        self.hit(i, base + p as u64);
                    }
                }
            }
        }
        for p in 0..data.len() {
            let list = &self.by_first[data[p] as usize];
            if list.is_empty() {
                continue;
            }
            for k in 0..list.len() {
                let i = self.by_first[data[p] as usize][k];
                if data[p..].starts_with(al::MAGIC_SWEEP[i].0) {
                    self.hit(i, offset + p as u64);
                }
            }
        }
        if data.len() >= self.keep {
            self.carry = data[data.len() - self.keep..].to_vec();
        } else {
            self.carry.extend_from_slice(data);
            let extra = self.carry.len().saturating_sub(self.keep);
            self.carry.drain(..extra);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Check {
    Avc(u8),
    Hevc(u8),
    Av1,
    Plain,
}

#[derive(Clone, Copy, Debug)]
enum UnitKind {
    Sample(Check),
    Cluster(u32),
}

#[derive(Clone, Copy, Debug)]
struct Unit {
    start: u64,
    end: u64,
    kind: UnitKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Probe,
    Front,
    Gather,
    Sweep,
    Done,
}

pub fn plan_windows(file_len: u64, window: u32, units: &[(u64, u64)]) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut cur = 0u64;
    while cur < file_len {
        let mut end = (cur + window as u64).min(file_len);
        let j = units.partition_point(|u| u.0 < end);
        if j > 0 {
            let (s, e) = units[j - 1];
            if e > end {
                if s > cur {
                    end = s;
                } else if e - cur <= guard::MAX_WINDOW_BYTES as u64 {
                    end = e.min(file_len);
                }
            }
        }
        if end <= cur {
            end = (cur + window as u64).min(file_len);
        }
        out.push((cur, end));
        cur = end;
    }
    out
}

pub struct Audit {
    file_len: u64,
    strict: bool,
    window: u32,
    stage: Stage,
    kind: &'static str,
    issues: Vec<String>,
    findings: Vec<Finding>,
    markers: Vec<String>,
    tracks: Vec<String>,
    walk: Option<TopWalk>,
    front: Option<MkvFront>,
    gathers: Vec<(usize, Gather)>,
    loaded: Vec<(usize, Vec<u8>)>,
    units: Vec<Unit>,
    windows: Vec<(u64, u64)>,
    wi: usize,
    ui: usize,
    sweeper: Sweeper,
    mkv_checks: Vec<(u64, Check)>,
}

const HEADER_TAG: usize = usize::MAX;

impl Audit {
    pub fn open(file_len: u64, strict: bool) -> Self {
        let mut a = Audit {
            file_len,
            strict,
            window: guard::DEFAULT_WINDOW_BYTES,
            stage: Stage::Probe,
            kind: "unknown",
            issues: Vec::new(),
            findings: Vec::new(),
            markers: Vec::new(),
            tracks: Vec::new(),
            walk: None,
            front: None,
            gathers: Vec::new(),
            loaded: Vec::new(),
            units: Vec::new(),
            windows: Vec::new(),
            wi: 0,
            ui: 0,
            sweeper: Sweeper::new(),
            mkv_checks: Vec::new(),
        };
        if let Err(e) = guard::check_video_bytes(file_len) {
            a.issues.push(e);
            a.stage = Stage::Done;
        }
        a
    }

    pub fn set_window(&mut self, bytes: u32) {
        self.window = guard::clamp_window(bytes);
    }

    pub fn need(&self) -> Option<Req> {
        match self.stage {
            Stage::Probe => Some(Req { offset: 0, len: self.file_len.min(64) as u32 }),
            Stage::Front => self.walk.as_ref().map(|w| w.need()).or_else(|| self.front.as_ref().map(|f| f.need()))?,
            Stage::Gather => self.gathers.first().and_then(|(_, g)| g.need()),
            Stage::Sweep => self.windows.get(self.wi).map(|&(s, e)| Req { offset: s, len: (e - s) as u32 }),
            Stage::Done => None,
        }
    }

    pub fn done(&self) -> bool {
        self.stage == Stage::Done
    }

    pub fn windows(&self) -> &[(u64, u64)] {
        &self.windows
    }

    pub fn feed(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let want = self.need().ok_or_else(|| "No read is pending".to_string())?;
        check_feed(want, offset, bytes)?;
        match self.stage {
            Stage::Probe => {
                match sniff(bytes) {
                    Some(Container::Mp4) => {
                        self.kind = "mp4";
                        self.walk = Some(TopWalk::new(self.file_len));
                    }
                    Some(Container::Mkv) => {
                        self.kind = "webm";
                        self.front = Some(MkvFront::new(self.file_len));
                    }
                    None => {
                        self.issues.push("Not an MP4, MOV, WebM or MKV file".to_string());
                        self.stage = Stage::Done;
                        return Ok(());
                    }
                }
                self.stage = Stage::Front;
            }
            Stage::Front => {
                if let Some(w) = self.walk.as_mut() {
                    w.feed(offset, bytes)?;
                    if w.done() {
                        self.queue_mp4();
                        self.after_gathers();
                    }
                } else if let Some(f) = self.front.as_mut() {
                    f.feed(offset, bytes)?;
                    if f.done() {
                        self.queue_mkv();
                        self.after_gathers();
                    }
                }
            }
            Stage::Gather => {
                let (_, g) = self.gathers.first_mut().ok_or_else(|| "No pending read".to_string())?;
                if g.feed(offset, bytes)? {
                    let (tag, g) = self.gathers.remove(0);
                    self.loaded.push((tag, g.take()));
                    self.after_gathers();
                }
            }
            Stage::Sweep => {
                self.sweeper.feed(offset, bytes);
                self.check_units(offset, bytes);
                self.wi += 1;
                if self.wi >= self.windows.len() {
                    self.finish_sweep();
                }
            }
            Stage::Done => return Err("No read is pending".to_string()),
        }
        Ok(())
    }

    fn after_gathers(&mut self) {
        if !self.gathers.is_empty() {
            self.stage = Stage::Gather;
            return;
        }
        if self.walk.is_some() {
            self.analyze_mp4();
        } else {
            self.analyze_mkv();
        }
        self.units.sort_by_key(|u| (u.start, u.end));
        let ranges: Vec<(u64, u64)> = self.units.iter().map(|u| (u.start, u.end)).collect();
        self.windows = plan_windows(self.file_len, self.window, &ranges);
        self.wi = 0;
        self.ui = 0;
        self.stage = if self.windows.is_empty() { Stage::Done } else { Stage::Sweep };
    }

    fn issue(&mut self, s: impl Into<String>) {
        push_unique(&mut self.issues, s);
    }

    fn marker(&mut self, s: impl Into<String>) {
        if self.markers.len() < 256 {
            push_unique(&mut self.markers, s);
        }
    }

    fn find(&mut self, f: Finding) {
        if !self.findings.contains(&f) && self.findings.len() < 512 {
            self.findings.push(f);
        }
    }

    fn loaded(&self, tag: usize) -> Option<&[u8]> {
        self.loaded.iter().find(|(t, _)| *t == tag).map(|(_, b)| b.as_slice())
    }

    fn queue_mp4(&mut self) {
        let boxes = self.walk.as_ref().map(|w| w.boxes.clone()).unwrap_or_default();
        for (i, b) in boxes.iter().enumerate() {
            let limit = match &b.typ {
                b"ftyp" => 4096,
                b"moov" => guard::MAX_MOOV_BYTES,
                b"uuid" => 4096,
                b"udta" | b"meta" => guard::MAX_SIDE_BYTES,
                _ => continue,
            };
            let len = (b.end() - b.payload_start()).min(limit);
            if &b.typ == b"moov" && b.end() - b.payload_start() > limit {
                self.issue("moov box is too large");
                continue;
            }
            if let Ok(g) = Gather::new(b.payload_start(), b.payload_start() + len, guard::MAX_WINDOW_BYTES) {
                self.gathers.push((i, g));
            }
        }
    }

    fn uuid_finding(u: Option<[u8; 16]>) -> Finding {
        match u {
            Some(x) if x == al::XMP_UUID => Finding::new("uuid", Group::Provenance, "XMP packet"),
            Some(x) if x == al::C2PA_UUID => Finding::new("uuid", Group::Provenance, "C2PA manifest"),
            _ => Finding::new("uuid", Group::Hidden, "vendor extension box"),
        }
    }

    fn analyze_mp4(&mut self) {
        let (boxes, trailing) = match self.walk.as_ref() {
            Some(w) => (w.boxes.clone(), w.trailing.clone()),
            None => return,
        };
        let names: Vec<String> = boxes.iter().map(|b| b.name()).collect();
        for n in &names {
            self.marker(n.clone());
        }
        if self.strict && names != ["ftyp", "moov", "mdat"] {
            self.issue(format!("Top-level boxes must be exactly ftyp, moov, mdat (found {})", names.join(", ")));
        }
        if let Some((pos, e)) = trailing {
            self.find(Finding::new("Trailing bytes", Group::Hidden, format!("{} bytes after the last box", self.file_len - pos)));
            if self.strict {
                self.issue(format!("Invalid data after the last box: {e}"));
            }
        }
        let moovs = boxes.iter().filter(|b| &b.typ == b"moov").count();
        if moovs != 1 {
            self.issue(if moovs == 0 { "No moov box found" } else { "More than one moov box" });
        }
        for (i, b) in boxes.iter().enumerate() {
            match &b.typ {
                b"ftyp" | b"moov" | b"mdat" => {}
                b"uuid" => self.find(Self::uuid_finding(b.usertype)),
                b"udta" | b"meta" => {
                    if let Some((g, t)) = al::mp4_deny(&b.typ) {
                        self.find(Finding::new(b.name(), g, t));
                    }
                    if let Some(data) = self.loaded(i).map(|d| d.to_vec()) {
                        let body = if &b.typ == b"meta" && data.get(4..8) != Some(b"hdlr") { &data[data.len().min(4)..] } else { &data[..] };
                        self.tree(b.typ, &b.name(), body);
                    }
                }
                t => match al::mp4_deny(t) {
                    Some((g, text)) => self.find(Finding::new(b.name(), g, text)),
                    None => {
                        let msg = if self.strict { "Non-allowlisted" } else { "Unknown" };
                        self.issue(format!("{msg} top-level box {}{}", b.name(), if self.strict { "" } else { ", removed" }));
                    }
                },
            }
        }
        let moov_idx = boxes.iter().position(|b| &b.typ == b"moov");
        let moov = moov_idx.and_then(|i| self.loaded(i).map(|d| d.to_vec()));
        let Some(moov) = moov else { return };
        self.tree(*b"moov", "moov", &moov);
        match parse_moov(&moov) {
            Err(e) => self.issue(format!("moov is malformed: {e}")),
            Ok(m) => self.model_mp4(&m, &boxes),
        }
    }

    fn tree(&mut self, parent: [u8; 4], path: &str, body: &[u8]) {
        let strict = self.strict;
        let mut keys: Vec<String> = Vec::new();
        let mut found: Vec<Finding> = Vec::new();
        let mut issues: Vec<String> = Vec::new();
        let mut markers: Vec<String> = Vec::new();
        let res = walk_tree(parent, path, body, 1, &mut |n: &Node| -> bool {
            let name = human_name(&n.typ);
            if markers.len() < 128 && !markers.contains(&name) {
                markers.push(name.clone());
            }
            if &n.parent == b"ilst" {
                let f = if let Some((g, t)) = al::mp4_deny(&n.typ) {
                    Finding::new(name.clone(), g, t)
                } else {
                    let idx = u32::from_be_bytes(n.typ) as usize;
                    match idx.checked_sub(1).and_then(|i| keys.get(i)) {
                        Some(k) => {
                            let (g, t) = al::ilst_key(k);
                            Finding::new(k.clone(), g, t)
                        }
                        None => Finding::new(format!("ilst item {name}"), Group::Hidden, "metadata item"),
                    }
                };
                if strict {
                    issues.push(format!("Disallowed metadata item {}", n.path));
                }
                found.push(f);
                return false;
            }
            if &n.typ == b"keys" {
                keys = parse_keys(n.payload);
                found.push(Finding::new("keys", Group::Hidden, "metadata key table"));
                if strict {
                    issues.push(format!("Disallowed box {}", n.path));
                }
                return false;
            }
            if &n.parent == b"meta" && &n.typ == b"hdlr" {
                return false;
            }
            if al::mp4_allowed(&n.parent, &n.typ) {
                config_check(n, strict, &mut found, &mut issues);
                return true;
            }
            if let Some((g, t)) = al::mp4_deny(&n.typ) {
                let f = if &n.typ == b"uuid" { Self::uuid_finding(n.usertype) } else { Finding::new(name, g, t) };
                found.push(f);
                if strict {
                    issues.push(format!("Disallowed box {}", n.path));
                }
                return matches!(&n.typ, b"udta" | b"meta" | b"ilst" | b"tref" | b"gmhd" | b"sinf");
            }
            if &n.parent == b"udta" {
                found.push(Finding::new(name, Group::Hidden, "user data item"));
                if strict {
                    issues.push(format!("Disallowed box {}", n.path));
                }
                return false;
            }
            if strict {
                issues.push(format!("Non-allowlisted box {}", n.path));
            } else {
                issues.push(format!("Unknown box {}, removed", n.path));
            }
            false
        });
        if let Err(e) = res {
            issues.push(format!("{path} is malformed: {e}"));
        }
        for m in markers {
            self.marker(m);
        }
        for f in found {
            self.find(f);
        }
        for i in issues {
            self.issue(i);
        }
    }

    fn model_mp4(&mut self, m: &bmff_model::Mp4Model, boxes: &[BoxHeader]) {
        for r in m.refuse_reasons() {
            self.issue(if self.strict { r } else { format!("Cannot clean: {r}") });
        }
        if m.mvhd_times {
            self.find(Finding::new("mvhd", Group::Time, "creation time"));
        }
        let vi = m.video_index();
        let ai = m.audio_index();
        for (i, t) in m.tracks.iter().enumerate() {
            let kept = Some(i) == vi || Some(i) == ai;
            let mut line = t.line();
            if !kept {
                line.push_str(" (dropped)");
            }
            self.tracks.push(line);
            if t.tkhd_times {
                self.find(Finding::new("tkhd", Group::Time, "creation time"));
            }
            if t.mdhd_times {
                self.find(Finding::new("mdhd", Group::Time, "creation time"));
            }
            let hn = clean_name(&t.hdlr_name);
            if !hn.is_empty() {
                self.find(Finding::new("hdlr", Group::Software, format!("name \"{hn}\"")));
            }
            if let Some(v) = &t.visual {
                let cn = clean_name(&v.compressor);
                if !cn.is_empty() {
                    self.find(Finding::new("compressorname", Group::Software, format!("\"{cn}\"")));
                }
                if v.icc {
                    self.find(Finding::new("colr", Group::Hidden, "embedded ICC profile"));
                }
            }
            if t.error.is_none() && !t.dref_self {
                self.find(Finding::new("dref", Group::Hidden, "external data reference"));
            }
            match &t.codec {
                Codec::Avc(c) => c.dropped.iter().for_each(|f| self.find(f.clone())),
                Codec::Hevc(c) => c.dropped.iter().for_each(|f| self.find(f.clone())),
                Codec::Av1(c) => c.dropped.iter().for_each(|f| self.find(f.clone())),
                _ => {}
            }
            match &t.handler {
                b"vide" | b"soun" => {}
                b"tmcd" => self.find(Finding::new("tmcd", Group::Time, "timecode track")),
                b"meta" => self.find(Finding::new("meta", Group::Location, "timed metadata track")),
                h => self.find(Finding::new(human_name(h), Group::Hidden, "extra track")),
            }
            if !kept && t.is_audio() && ai.is_some() {
                self.find(Finding::new("soun", Group::Hidden, "extra audio track"));
            }
            if self.strict {
                if t.language != LANG_UND {
                    self.issue("Track language must be und");
                }
                if !t.edits.is_empty() {
                    self.issue("Edit lists are not allowed in output");
                }
                if !kept {
                    self.issue(format!("Track {} is not an allowed video or audio track", line_kind(t)));
                }
            }
            if let Some(e) = &t.error {
                self.issue(format!("Track {} is malformed: {e}", t.id));
                continue;
            }
            let check = match &t.codec {
                Codec::Avc(c) => Check::Avc(c.len_size),
                Codec::Hevc(c) => Check::Hevc(c.len_size()),
                Codec::Av1(_) => Check::Av1,
                _ => Check::Plain,
            };
            for s in &t.samples {
                let end = s.offset.saturating_add(s.size as u64);
                self.units.push(Unit { start: s.offset, end, kind: UnitKind::Sample(check) });
            }
        }
        if self.strict {
            if let (Some(v), Some(fb)) = (vi.and_then(|i| m.tracks.get(i)), boxes.iter().position(|b| &b.typ == b"ftyp")) {
                let want = al::ftyp_for(&v.fourcc.unwrap_or(*b"none"));
                let got = self.loaded(fb).map(|d| {
                    let mut full = ((d.len() + 8) as u32).to_be_bytes().to_vec();
                    full.extend_from_slice(b"ftyp");
                    full.extend_from_slice(d);
                    full
                });
                if got.as_deref() != Some(&want[..]) {
                    self.issue("ftyp is not the canonical brand list");
                }
            }
            if m.tracks.first().map(|t| t.is_video()) != Some(true) {
                self.issue("The first track must be the video track");
            }
        }
        self.coverage(boxes);
    }

    fn coverage(&mut self, boxes: &[BoxHeader]) {
        let mdats: Vec<(u64, u64)> =
            boxes.iter().filter(|b| &b.typ == b"mdat").map(|b| (b.payload_start(), b.end())).collect();
        let mut r: Vec<(u64, u64)> = self.units.iter().map(|u| (u.start, u.end)).collect();
        r.sort();
        if r.iter().any(|&(s, e)| !mdats.iter().any(|&(a, b)| s >= a && e <= b)) {
            self.issue("A sample points outside the media data");
        }
        if r.windows(2).any(|w| w[0].1 > w[1].0) {
            self.issue("Samples overlap");
        }
        if self.strict {
            let exact = mdats.len() == 1
                && r.first().map(|x| x.0) == Some(mdats[0].0)
                && r.last().map(|x| x.1) == Some(mdats[0].1)
                && r.windows(2).all(|w| w[0].1 == w[1].0);
            if !exact {
                self.issue("Samples do not cover mdat exactly");
            }
            return;
        }
        let total: u64 = mdats.iter().map(|&(a, b)| b - a).sum();
        let used: u64 = r.iter().map(|&(s, e)| e - s).sum();
        if used < total {
            self.find(Finding::new("mdat", Group::Hidden, format!("{} bytes not used by any sample", total - used)));
        }
    }

    fn queue_mkv(&mut self) {
        let Some(f) = self.front.as_ref() else { return };
        let header = f.header;
        let elems = f.elems.clone();
        if let Some(h) = header {
            if let Ok(g) = Gather::new(h.data_start(), h.end(), guard::MAX_WINDOW_BYTES) {
                self.gathers.push((HEADER_TAG, g));
            }
        }
        for (i, e) in elems.iter().enumerate() {
            let limit = match e.id {
                al::MKV_SEEKHEAD | al::MKV_INFO | al::MKV_TRACKS | al::MKV_CUES => guard::MAX_MOOV_BYTES,
                al::MKV_TAGS | al::MKV_ATTACHMENTS | al::MKV_CHAPTERS => guard::MAX_SIDE_BYTES,
                _ => continue,
            };
            if e.size > limit {
                if limit == guard::MAX_MOOV_BYTES {
                    self.issue(format!("{} element is too large", ebml_walk::name(e.id)));
                }
                continue;
            }
            if let Ok(g) = Gather::new(e.data_start(), e.end(), guard::MAX_WINDOW_BYTES) {
                self.gathers.push((i, g));
            }
        }
    }

    fn analyze_mkv(&mut self) {
        let Some(front) = self.front.as_ref() else { return };
        let elems: Vec<TopElem> = front.elems.clone();
        let error = front.error.clone();
        let trailing = front.trailing;
        let has_segment = front.segment.is_some();
        self.marker("EBML");
        if has_segment {
            self.marker("Segment");
        }
        if let Some(e) = error {
            self.issue(if self.strict { e } else { format!("Cannot clean: {e}") });
        }
        if let Some(pos) = trailing {
            self.find(Finding::new("Trailing bytes", Group::Hidden, format!("{} bytes after the Segment", self.file_len - pos)));
        }
        let mut col = Collector::new(self.strict);
        if let Some(h) = self.loaded(HEADER_TAG).map(|d| d.to_vec()) {
            if let Err(e) = walk(&h, al::EBML_HEADER, 1, &mut |e, p| col.visit(e, p)) {
                col.issues.push(format!("EBML header is malformed: {e}"));
            }
            match doc_type_of(&h) {
                Ok(dt) => {
                    if dt == "matroska" {
                        self.kind = "mkv";
                    }
                    if dt != "webm" && dt != "matroska" {
                        col.issues.push(format!("Unsupported DocType {dt}"));
                    }
                }
                Err(e) => col.issues.push(e),
            }
        }
        if self.strict {
            let ids: Vec<u32> = elems.iter().map(|e| e.id).collect();
            let ok = ids.len() >= 5
                && ids[0] == al::MKV_SEEKHEAD
                && ids[1] == al::MKV_INFO
                && ids[2] == al::MKV_TRACKS
                && ids[ids.len() - 1] == al::MKV_CUES
                && ids[3..ids.len() - 1].iter().all(|&i| i == al::MKV_CLUSTER);
            if !ok {
                col.issues.push("Segment layout must be SeekHead, Info, Tracks, Clusters, Cues".to_string());
            }
            if trailing.is_some() {
                col.issues.push("Data after the Segment".to_string());
            }
        }
        let mut info_data: Option<Vec<u8>> = None;
        let mut tracks_data: Option<Vec<u8>> = None;
        let (mut n_info, mut n_tracks) = (0, 0);
        for (i, e) in elems.iter().enumerate() {
            let data = self.loaded(i).map(|d| d.to_vec()).unwrap_or_default();
            let el = ebml_walk::Elem { id: e.id, data: &data, offset: 0, header_len: e.header_len as usize };
            if e.id == al::MKV_CLUSTER {
                col.visit(&el, al::MKV_SEGMENT);
                self.units.push(Unit { start: e.start, end: e.end(), kind: UnitKind::Cluster(e.header_len) });
                continue;
            }
            if col.visit(&el, al::MKV_SEGMENT) && mkv_model::is_master(e.id) {
                if let Err(err) = walk(&data, e.id, 1, &mut |x, p| col.visit(x, p)) {
                    col.issues.push(format!("{} is malformed: {err}", ebml_walk::name(e.id)));
                }
            }
            if e.id == al::MKV_INFO {
                n_info += 1;
                info_data = Some(data);
            } else if e.id == al::MKV_TRACKS {
                n_tracks += 1;
                tracks_data = Some(data);
            }
        }
        if has_segment && (n_info != 1 || n_tracks != 1) {
            col.issues.push("File must have exactly one Info and one Tracks element".to_string());
        }
        for f in col.findings {
            self.find(f);
        }
        for i in col.issues {
            self.issue(i);
        }
        for m in col.markers {
            self.marker(m);
        }
        if let Some(d) = info_data {
            match parse_info(&d) {
                Ok(info) => {
                    for (label, v) in [("MuxingApp", info.muxing_app), ("WritingApp", info.writing_app)] {
                        match v {
                            Some(s) if s.as_bytes() == al::MKV_APP => {}
                            Some(s) => {
                                self.find(Finding::new(label, Group::Software, format!("\"{s}\"")));
                            }
                            None if self.strict => self.issue(format!("{label} is missing")),
                            None => {}
                        }
                    }
                    if let Some(dur) = info.duration {
                        if let Err(e) = guard::check_duration(dur * info.timestamp_scale as f64 / 1e9) {
                            self.issue(e);
                        }
                    }
                }
                Err(e) => self.issue(format!("Info is malformed: {e}")),
            }
        }
        if let Some(d) = tracks_data {
            match parse_tracks(&d) {
                Ok(list) => self.mkv_tracks(&list),
                Err(e) => self.issue(format!("Tracks is malformed: {e}")),
            }
        }
    }

    fn mkv_tracks(&mut self, list: &[mkv_model::MkvTrack]) {
        let videos = list.iter().filter(|t| t.is_video()).count();
        if videos != 1 {
            self.issue(if videos == 0 { "No video track found" } else { "More than one video track is not supported" });
        }
        let first_audio = list.iter().position(|t| t.is_audio());
        let webm = self.kind == "webm";
        for (i, t) in list.iter().enumerate() {
            let kept = t.is_video() || Some(i) == first_audio;
            let mut line = t.line();
            if !kept {
                line.push_str(" (dropped)");
            }
            self.tracks.push(line);
            if t.uid != t.number {
                self.find(Finding::new("TrackUID", Group::Ids, "random track ID"));
            }
            if let Some(n) = &t.name {
                self.find(Finding::new("Name", Group::Ids, format!("track name \"{n}\"")));
            }
            if t.content_encodings {
                self.issue("Compressed or encrypted Matroska tracks (ContentEncodings) are not supported");
            }
            if !kept {
                self.find(Finding::new(t.codec_id.clone(), Group::Hidden, "extra track"));
            }
            let codec_ok = if t.is_video() {
                al::MKV_VIDEO_CODECS.contains(&t.codec_id.as_str())
            } else {
                al::MKV_AUDIO_CODECS.contains(&t.codec_id.as_str())
            };
            if kept && !codec_ok {
                self.issue(format!("Unsupported codec {}", t.codec_id));
            }
            if self.strict {
                if t.language.as_deref() != Some("und") {
                    self.issue("Track language must be und");
                }
                if t.lacing != Some(0) {
                    self.issue("FlagLacing must be 0");
                }
                if webm && !al::MKV_WEBM_CODECS.contains(&t.codec_id.as_str()) {
                    self.issue(format!("Codec {} is not allowed in WebM", t.codec_id));
                }
                if !kept {
                    self.issue("Only one video and one audio track are allowed");
                }
            }
            let check = self.private_check(t);
            self.mkv_checks.push((t.number, check));
        }
    }

    fn private_check(&mut self, t: &mkv_model::MkvTrack) -> Check {
        let p = t.private.as_deref();
        let strict = self.strict;
        let bad = |s: &mut Self, msg: String| {
            if strict {
                s.issue(msg);
            }
        };
        match t.codec_id.as_str() {
            "V_MPEG4/ISO/AVC" => match p.map(nal::parse_avcc) {
                Some(Ok(c)) => {
                    c.dropped.iter().for_each(|f| self.find(f.clone()));
                    if let Some(Err(e)) = p.map(nal::avcc_canonical) {
                        bad(self, e);
                    }
                    Check::Avc(c.len_size)
                }
                Some(Err(e)) => {
                    self.issue(format!("avcC is malformed: {e}"));
                    Check::Plain
                }
                None => {
                    self.issue("AVC track has no CodecPrivate");
                    Check::Plain
                }
            },
            "V_MPEGH/ISO/HEVC" => match p.map(nal::parse_hvcc) {
                Some(Ok(c)) => {
                    c.dropped.iter().for_each(|f| self.find(f.clone()));
                    if !c.dropped.is_empty() || p.map(|b| nal::write_hvcc(&c) != b).unwrap_or(true) {
                        bad(self, "hvcC is not in canonical form".to_string());
                    }
                    Check::Hevc(c.len_size())
                }
                Some(Err(e)) => {
                    self.issue(format!("hvcC is malformed: {e}"));
                    Check::Plain
                }
                None => {
                    self.issue("HEVC track has no CodecPrivate");
                    Check::Plain
                }
            },
            "V_AV1" => {
                if let Some(b) = p {
                    match obu::parse_av1c(b) {
                        Ok(c) => {
                            c.dropped.iter().for_each(|f| self.find(f.clone()));
                            if !c.dropped.is_empty() {
                                bad(self, "av1C carries more than a sequence header".to_string());
                            }
                        }
                        Err(e) => self.issue(format!("av1C is malformed: {e}")),
                    }
                }
                Check::Av1
            }
            "V_VP8" | "V_VP9" => {
                if p.is_some() {
                    bad(self, format!("{} CodecPrivate is not allowed in output", t.codec_id));
                }
                Check::Plain
            }
            "A_VORBIS" => {
                match p.map(mkv_model::split_xiph) {
                    Some(Ok(parts)) => {
                        let fs = mkv_model::vorbis_comment_findings(parts[1]);
                        if !fs.is_empty() {
                            bad(self, "Vorbis comment header is not empty".to_string());
                        }
                        fs.into_iter().for_each(|f| self.find(f));
                    }
                    Some(Err(e)) => self.issue(format!("Vorbis header is malformed: {e}")),
                    None => self.issue("Vorbis track has no CodecPrivate"),
                }
                Check::Plain
            }
            "A_OPUS" => {
                match p.map(mkv_model::parse_opus_head) {
                    Some(Ok(o)) => {
                        if p.map(|b| mkv_model::write_opus_head(&o) != b).unwrap_or(true) {
                            bad(self, "OpusHead is not in canonical form".to_string());
                        }
                    }
                    Some(Err(e)) => self.issue(format!("OpusHead is malformed: {e}")),
                    None => self.issue("Opus track has no CodecPrivate"),
                }
                Check::Plain
            }
            _ => Check::Plain,
        }
    }

    fn check_units(&mut self, offset: u64, data: &[u8]) {
        let end = offset + data.len() as u64;
        while self.ui < self.units.len() && self.units[self.ui].start < end {
            let u = self.units[self.ui];
            self.ui += 1;
            if u.start < offset || u.end > end {
                self.issue("A sample or cluster could not be checked in one window");
                continue;
            }
            let bytes = &data[(u.start - offset) as usize..(u.end - offset) as usize];
            match u.kind {
                UnitKind::Sample(c) => self.check_frame(c, bytes),
                UnitKind::Cluster(hl) => self.check_cluster(&bytes[(hl as usize).min(bytes.len())..]),
            }
        }
    }

    fn check_frame(&mut self, c: Check, data: &[u8]) {
        let res = match c {
            Check::Avc(ls) => nal::nal_findings(NalKind::Avc, data, ls),
            Check::Hevc(ls) => nal::nal_findings(NalKind::Hevc, data, ls),
            Check::Av1 => obu::av1_findings(data),
            Check::Plain => Ok(Vec::new()),
        };
        match res {
            Ok(fs) => {
                for f in fs {
                    if f.name == "SEI" {
                        self.marker("SEI");
                    }
                    if self.strict {
                        self.issue(format!("Disallowed unit in a sample: {}", f.line()));
                    }
                    self.find(f);
                }
            }
            Err(e) => self.issue(format!("Malformed sample: {e}")),
        }
    }

    fn check_cluster(&mut self, body: &[u8]) {
        let cl = match parse_cluster(body) {
            Ok(c) => c,
            Err(e) => {
                self.issue(if self.strict { format!("Cluster is malformed: {e}") } else { format!("Cannot clean: {e}") });
                return;
            }
        };
        for id in &cl.dropped {
            if let Some((g, n, t)) = al::mkv_deny(*id) {
                self.find(Finding::new(n, g, t));
            }
            if self.strict {
                self.issue(format!("Disallowed element {} in a Cluster", ebml_walk::name(*id)));
            }
        }
        if self.strict && cl.groups > 0 {
            self.issue("BlockGroup is not allowed in output");
        }
        for b in &cl.blocks {
            let check = self.mkv_checks.iter().find(|(n, _)| *n == b.track).map(|(_, c)| *c);
            match check {
                Some(c) => self.check_frame(c, b.frame),
                None => self.issue("Block for an unknown track"),
            }
        }
    }

    fn finish_sweep(&mut self) {
        let hits = std::mem::take(&mut self.sweeper.hits);
        for (i, off) in hits {
            let (_, label, g) = al::MAGIC_SWEEP[i];
            self.marker(label);
            if self.strict {
                self.issue(format!("Forbidden byte pattern ({label}) at offset {off}"));
            }
            self.find(Finding::new(label, g, "bytes found"));
        }
        self.stage = Stage::Done;
    }

    pub fn summary(&self) -> VideoAuditSummary {
        let mut issues = self.issues.clone();
        if !self.done() {
            push_unique(&mut issues, "Audit did not read the whole file");
        }
        for f in &self.findings {
            push_unique(&mut issues, format!("{}: {}", f.group.label(), f.line()));
        }
        VideoAuditSummary {
            kind: self.kind.to_string(),
            passed: issues.is_empty(),
            issues,
            markers: self.markers.clone(),
            byte_length: self.file_len,
            groups: group_findings(&self.findings),
            tracks: self.tracks.clone(),
        }
    }
}

fn line_kind(t: &bmff_model::Track) -> String {
    human_name(&t.handler)
}

fn clean_name(b: &[u8]) -> String {
    let mut s = b;
    if let Some(&n) = s.first() {
        if (n as usize) < 32 && (n as usize) < s.len() && s[1..].iter().take(n as usize).all(|&c| c >= 0x20) && n > 0 {
            s = &s[1..1 + n as usize];
        }
    }
    let text: String = s.iter().filter(|&&c| c != 0).map(|&c| if (0x20..0x7f).contains(&c) { c as char } else { '.' }).collect();
    text.trim().to_string()
}

fn parse_keys(p: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let Ok((_, _, rest)) = full_box(p) else { return out };
    let mut c = Cursor::new(rest);
    let Ok(n) = c.u32() else { return out };
    for _ in 0..n.min(1024) {
        let Ok(size) = c.u32() else { break };
        if size < 8 {
            break;
        }
        let Ok(_ns) = c.fourcc() else { break };
        let Ok(name) = c.bytes(size as usize - 8) else { break };
        out.push(String::from_utf8_lossy(name).into_owned());
    }
    out
}

fn config_check(n: &Node, strict: bool, found: &mut Vec<Finding>, issues: &mut Vec<String>) {
    let mut bad = |m: String| {
        if strict {
            issues.push(format!("{}: {m}", n.path));
        }
    };
    match &n.typ {
        b"avcC" => {
            if let Err(e) = nal::avcc_canonical(n.payload) {
                bad(e);
            }
        }
        b"hvcC" => match nal::parse_hvcc(n.payload) {
            Ok(c) => {
                found.extend(c.dropped.iter().cloned());
                if !c.dropped.is_empty() || nal::write_hvcc(&c) != n.payload {
                    bad("hvcC is not in canonical form".to_string());
                }
            }
            Err(e) => bad(e),
        },
        b"av1C" => match obu::parse_av1c(n.payload) {
            Ok(c) => {
                if !c.dropped.is_empty() || obu::write_av1c(&c) != n.payload {
                    bad("av1C carries more than a sequence header".to_string());
                }
            }
            Err(e) => bad(e),
        },
        b"vpcC" => match bmff_model::parse_vpcc(n.payload) {
            Ok(v) => {
                if v.init_len != 0 || bmff_model::write_vpcc(&v) != n.payload {
                    bad("vpcC is not in canonical form".to_string());
                }
            }
            Err(e) => bad(e),
        },
        b"esds" => match bmff_model::parse_esds(n.payload) {
            Ok(e) => {
                if bmff_model::write_esds(&e.asc) != n.payload {
                    bad("esds is not in canonical form".to_string());
                }
            }
            Err(e) => bad(e),
        },
        b"dOps" => match bmff_model::parse_dops(n.payload) {
            Ok(o) => {
                if bmff_model::write_dops(&o) != n.payload {
                    bad("dOps is not in canonical form".to_string());
                }
            }
            Err(e) => bad(e),
        },
        b"colr" => {
            if n.payload.get(..4) != Some(b"nclx") || n.payload.len() != 11 {
                bad("only nclx colour boxes are allowed".to_string());
            }
        }
        b"mvhd" | b"tkhd" | b"mdhd" => {
            if let Ok((v, _, rest)) = full_box(n.payload) {
                let w = if v == 1 { 16 } else { 8 };
                if rest.get(..w).map(|t| t.iter().any(|&x| x != 0)).unwrap_or(true) {
                    bad("creation and modification times must be zero".to_string());
                }
            }
        }
        b"hdlr" => {
            if let Ok((_, _, rest)) = full_box(n.payload) {
                if rest.get(20..).map(|name| name.iter().any(|&x| x != 0)).unwrap_or(false) {
                    bad("handler name must be empty".to_string());
                }
            }
        }
        b"avc1" | b"hvc1" | b"hev1" | b"av01" | b"vp09" => {
            if n.payload.get(42..74).map(|c| c.iter().any(|&x| x != 0)).unwrap_or(true) {
                bad("compressorname must be zero".to_string());
            }
        }
        b"url " if !matches!(full_box(n.payload), Ok((_, f, rest)) if f & 1 == 1 && rest.is_empty()) => {
            bad("data reference must be self-contained".to_string());
        }
        _ => {}
    }
}
