use super::bmff_model::{matrix_for, write_dops, write_esds, Nclx, OpusCfg, IDENTITY};
use crate::allowlist;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutSample {
    pub size: u32,
    pub dur: u32,
    pub cts: i32,
    pub sync: bool,
}

#[derive(Clone, Debug)]
pub struct OutTrack {
    pub handler: [u8; 4],
    pub timescale: u32,
    pub width: u32,
    pub height: u32,
    pub rotation: u16,
    pub entry: Vec<u8>,
    pub samples: Vec<OutSample>,
}

#[derive(Clone, Debug)]
pub struct OutModel {
    pub video_fourcc: [u8; 4],
    pub tracks: Vec<OutTrack>,
    pub order: Vec<u8>,
    pub mdat_len: u64,
}

pub const MOVIE_TIMESCALE: u32 = 1000;
pub const LANG_UND: u16 = 0x55C4;

pub fn bx(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut o = Vec::with_capacity(body.len() + 8);
    o.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
    o.extend_from_slice(typ);
    o.extend_from_slice(body);
    o
}

pub fn full(typ: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(body.len() + 4);
    b.push(version);
    b.extend_from_slice(&flags.to_be_bytes()[1..]);
    b.extend_from_slice(body);
    bx(typ, &b)
}

fn cat(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.concat()
}

pub fn visual_entry(
    fourcc: &[u8; 4],
    width: u16,
    height: u16,
    config: (&[u8; 4], &[u8]),
    colr: Option<Nclx>,
    pasp: Option<(u32, u32)>,
) -> Vec<u8> {
    let mut b = vec![0u8; 6];
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&[0u8; 16]);
    b.extend_from_slice(&width.to_be_bytes());
    b.extend_from_slice(&height.to_be_bytes());
    b.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    b.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    b.extend_from_slice(&[0u8; 4]);
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&[0u8; 32]);
    b.extend_from_slice(&0x0018u16.to_be_bytes());
    b.extend_from_slice(&0xFFFFu16.to_be_bytes());
    b.extend_from_slice(&bx(config.0, config.1));
    if let Some(c) = colr {
        let mut p = b"nclx".to_vec();
        p.extend_from_slice(&c.primaries.to_be_bytes());
        p.extend_from_slice(&c.transfer.to_be_bytes());
        p.extend_from_slice(&c.matrix.to_be_bytes());
        p.push(if c.full_range { 0x80 } else { 0 });
        b.extend_from_slice(&bx(b"colr", &p));
    }
    if let Some((h, v)) = pasp {
        let mut p = h.to_be_bytes().to_vec();
        p.extend_from_slice(&v.to_be_bytes());
        b.extend_from_slice(&bx(b"pasp", &p));
    }
    bx(fourcc, &b)
}

fn audio_head(channels: u16, rate: u32) -> Vec<u8> {
    let mut b = vec![0u8; 6];
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&[0u8; 8]);
    b.extend_from_slice(&channels.to_be_bytes());
    b.extend_from_slice(&16u16.to_be_bytes());
    b.extend_from_slice(&[0u8; 4]);
    b.extend_from_slice(&(rate.min(0xFFFF) << 16).to_be_bytes());
    b
}

pub fn mp4a_entry(channels: u16, rate: u32, asc: &[u8]) -> Vec<u8> {
    let mut b = audio_head(channels, rate);
    let esds = write_esds(asc);
    b.extend_from_slice(&bx(b"esds", &esds));
    bx(b"mp4a", &b)
}

pub fn opus_entry(rate: u32, cfg: &OpusCfg) -> Vec<u8> {
    let mut b = audio_head(cfg.channels as u16, rate);
    b.extend_from_slice(&bx(b"dOps", &write_dops(cfg)));
    bx(b"Opus", &b)
}

struct Chunk {
    count: u32,
    rel: u64,
}

fn chunk_layout(m: &OutModel) -> Result<Vec<Vec<Chunk>>, String> {
    let n = m.tracks.len();
    let mut per: Vec<Vec<Chunk>> = (0..n).map(|_| Vec::new()).collect();
    let mut idx = vec![0usize; n];
    let mut pos = 0u64;
    let mut last: Option<usize> = None;
    for &t in &m.order {
        let t = t as usize;
        let track = m.tracks.get(t).ok_or_else(|| "Output order names an unknown track".to_string())?;
        let s = track.samples.get(idx[t]).ok_or_else(|| "Output order has too many samples".to_string())?;
        let list = &mut per[t];
        match (last == Some(t), list.last_mut()) {
            (true, Some(c)) => c.count += 1,
            _ => list.push(Chunk { count: 1, rel: pos }),
        }
        pos += s.size as u64;
        idx[t] += 1;
        last = Some(t);
    }
    for (t, track) in m.tracks.iter().enumerate() {
        if idx[t] != track.samples.len() {
            return Err("Output order is missing samples".to_string());
        }
    }
    if pos != m.mdat_len {
        return Err("Output sample sizes do not match the mdat length".to_string());
    }
    Ok(per)
}

fn media_to_movie(d: u64, ts: u32) -> u64 {
    if ts == 0 {
        return 0;
    }
    ((d as u128 * MOVIE_TIMESCALE as u128 + ts as u128 / 2) / ts as u128) as u64
}

fn u32_list(entries: &[(u32, u32)]) -> Vec<u8> {
    let mut b = (entries.len() as u32).to_be_bytes().to_vec();
    for (a, c) in entries {
        b.extend_from_slice(&a.to_be_bytes());
        b.extend_from_slice(&c.to_be_bytes());
    }
    b
}

fn stbl(t: &OutTrack, chunks: &[Chunk], base: u64, co64: bool) -> Vec<u8> {
    let mut stsd = 1u32.to_be_bytes().to_vec();
    stsd.extend_from_slice(&t.entry);
    let mut parts = vec![full(b"stsd", 0, 0, &stsd)];

    let mut stts: Vec<(u32, u32)> = Vec::new();
    for s in &t.samples {
        match stts.last_mut() {
            Some((n, d)) if *d == s.dur => *n += 1,
            _ => stts.push((1, s.dur)),
        }
    }
    parts.push(full(b"stts", 0, 0, &u32_list(&stts)));

    if t.samples.iter().any(|s| s.cts != 0) {
        let mut ctts: Vec<(u32, u32)> = Vec::new();
        for s in &t.samples {
            match ctts.last_mut() {
                Some((n, c)) if *c == s.cts as u32 => *n += 1,
                _ => ctts.push((1, s.cts as u32)),
            }
        }
        let v = if t.samples.iter().any(|s| s.cts < 0) { 1 } else { 0 };
        parts.push(full(b"ctts", v, 0, &u32_list(&ctts)));
    }

    if !t.samples.iter().all(|s| s.sync) {
        let sync: Vec<u32> = t.samples.iter().enumerate().filter(|(_, s)| s.sync).map(|(i, _)| i as u32 + 1).collect();
        let mut b = (sync.len() as u32).to_be_bytes().to_vec();
        for k in sync {
            b.extend_from_slice(&k.to_be_bytes());
        }
        parts.push(full(b"stss", 0, 0, &b));
    }

    let mut stsc: Vec<(u32, u32)> = Vec::new();
    for (i, c) in chunks.iter().enumerate() {
        if stsc.last().map(|l| l.1) != Some(c.count) {
            stsc.push((i as u32 + 1, c.count));
        }
    }
    let mut b = (stsc.len() as u32).to_be_bytes().to_vec();
    for (f, n) in &stsc {
        b.extend_from_slice(&f.to_be_bytes());
        b.extend_from_slice(&n.to_be_bytes());
        b.extend_from_slice(&1u32.to_be_bytes());
    }
    parts.push(full(b"stsc", 0, 0, &b));

    let first = t.samples.first().map(|s| s.size).unwrap_or(0);
    let mut b = Vec::new();
    if !t.samples.is_empty() && t.samples.iter().all(|s| s.size == first) {
        b.extend_from_slice(&first.to_be_bytes());
        b.extend_from_slice(&(t.samples.len() as u32).to_be_bytes());
    } else {
        b.extend_from_slice(&0u32.to_be_bytes());
        b.extend_from_slice(&(t.samples.len() as u32).to_be_bytes());
        for s in &t.samples {
            b.extend_from_slice(&s.size.to_be_bytes());
        }
    }
    parts.push(full(b"stsz", 0, 0, &b));

    let mut b = (chunks.len() as u32).to_be_bytes().to_vec();
    for c in chunks {
        let off = base + c.rel;
        if co64 {
            b.extend_from_slice(&off.to_be_bytes());
        } else {
            b.extend_from_slice(&(off as u32).to_be_bytes());
        }
    }
    parts.push(full(if co64 { b"co64" } else { b"stco" }, 0, 0, &b));
    bx(b"stbl", &cat(&parts))
}

fn trak(id: u32, t: &OutTrack, chunks: &[Chunk], base: u64, co64: bool) -> Vec<u8> {
    let media: u64 = t.samples.iter().map(|s| s.dur as u64).sum();
    let movie = media_to_movie(media, t.timescale);
    let audio = &t.handler == b"soun";

    let mut tk = Vec::new();
    let v1 = movie > u32::MAX as u64;
    if v1 {
        tk.extend_from_slice(&[0u8; 16]);
        tk.extend_from_slice(&id.to_be_bytes());
        tk.extend_from_slice(&[0u8; 4]);
        tk.extend_from_slice(&movie.to_be_bytes());
    } else {
        tk.extend_from_slice(&[0u8; 8]);
        tk.extend_from_slice(&id.to_be_bytes());
        tk.extend_from_slice(&[0u8; 4]);
        tk.extend_from_slice(&(movie as u32).to_be_bytes());
    }
    tk.extend_from_slice(&[0u8; 8]);
    tk.extend_from_slice(&[0u8; 4]);
    tk.extend_from_slice(&(if audio { 0x0100u16 } else { 0 }).to_be_bytes());
    tk.extend_from_slice(&[0u8; 2]);
    let m = if audio { IDENTITY } else { matrix_for(t.rotation) };
    for x in m {
        tk.extend_from_slice(&x.to_be_bytes());
    }
    tk.extend_from_slice(&(if audio { 0 } else { t.width }).to_be_bytes());
    tk.extend_from_slice(&(if audio { 0 } else { t.height }).to_be_bytes());
    let tkhd = full(b"tkhd", v1 as u8, 3, &tk);

    let mut md = Vec::new();
    let mv1 = media > u32::MAX as u64;
    if mv1 {
        md.extend_from_slice(&[0u8; 16]);
        md.extend_from_slice(&t.timescale.to_be_bytes());
        md.extend_from_slice(&media.to_be_bytes());
    } else {
        md.extend_from_slice(&[0u8; 8]);
        md.extend_from_slice(&t.timescale.to_be_bytes());
        md.extend_from_slice(&(media as u32).to_be_bytes());
    }
    md.extend_from_slice(&LANG_UND.to_be_bytes());
    md.extend_from_slice(&[0u8; 2]);
    let mdhd = full(b"mdhd", mv1 as u8, 0, &md);

    let mut h = vec![0u8; 4];
    h.extend_from_slice(&t.handler);
    h.extend_from_slice(&[0u8; 12]);
    h.push(0);
    let hdlr = full(b"hdlr", 0, 0, &h);

    let mh = if audio { full(b"smhd", 0, 0, &[0u8; 4]) } else { full(b"vmhd", 0, 1, &[0u8; 8]) };
    let mut dref = 1u32.to_be_bytes().to_vec();
    dref.extend_from_slice(&full(b"url ", 0, 1, &[]));
    let dinf = bx(b"dinf", &full(b"dref", 0, 0, &dref));
    let minf = bx(b"minf", &cat(&[mh, dinf, stbl(t, chunks, base, co64)]));
    let mdia = bx(b"mdia", &cat(&[mdhd, hdlr, minf]));
    bx(b"trak", &cat(&[tkhd, mdia]))
}

fn moov(m: &OutModel, chunks: &[Vec<Chunk>], base: u64, co64: bool) -> Vec<u8> {
    let dur = m
        .tracks
        .iter()
        .map(|t| media_to_movie(t.samples.iter().map(|s| s.dur as u64).sum(), t.timescale))
        .max()
        .unwrap_or(0);
    let v1 = dur > u32::MAX as u64;
    let mut b = Vec::new();
    if v1 {
        b.extend_from_slice(&[0u8; 16]);
        b.extend_from_slice(&MOVIE_TIMESCALE.to_be_bytes());
        b.extend_from_slice(&dur.to_be_bytes());
    } else {
        b.extend_from_slice(&[0u8; 8]);
        b.extend_from_slice(&MOVIE_TIMESCALE.to_be_bytes());
        b.extend_from_slice(&(dur as u32).to_be_bytes());
    }
    b.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    b.extend_from_slice(&0x0100u16.to_be_bytes());
    b.extend_from_slice(&[0u8; 10]);
    for x in IDENTITY {
        b.extend_from_slice(&x.to_be_bytes());
    }
    b.extend_from_slice(&[0u8; 24]);
    b.extend_from_slice(&(m.tracks.len() as u32 + 1).to_be_bytes());
    let mut parts = vec![full(b"mvhd", v1 as u8, 0, &b)];
    for (i, t) in m.tracks.iter().enumerate() {
        parts.push(trak(i as u32 + 1, t, &chunks[i], base, co64));
    }
    bx(b"moov", &cat(&parts))
}

pub fn mdat_header(len: u64) -> Vec<u8> {
    if len + 8 <= u32::MAX as u64 {
        let mut h = ((len + 8) as u32).to_be_bytes().to_vec();
        h.extend_from_slice(b"mdat");
        h
    } else {
        let mut h = 1u32.to_be_bytes().to_vec();
        h.extend_from_slice(b"mdat");
        h.extend_from_slice(&(len + 16).to_be_bytes());
        h
    }
}

pub fn write_head(m: &OutModel) -> Result<Vec<u8>, String> {
    let chunks = chunk_layout(m)?;
    let ftyp = allowlist::ftyp_for(&m.video_fourcc);
    let mh = mdat_header(m.mdat_len);
    let probe = moov(m, &chunks, 0, false);
    let base32 = (ftyp.len() + probe.len() + mh.len()) as u64;
    let co64 = base32 + m.mdat_len > u32::MAX as u64;
    let sized = if co64 { moov(m, &chunks, 0, true) } else { probe };
    let base = (ftyp.len() + sized.len() + mh.len()) as u64;
    let moov = moov(m, &chunks, base, co64);
    if moov.len() != sized.len() {
        return Err("moov size changed while writing".to_string());
    }
    Ok(cat(&[ftyp, moov, mh]))
}
