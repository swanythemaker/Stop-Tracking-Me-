pub const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PNG_ALLOWED: [&[u8; 4]; 5] = [b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"];

const PNG_DENY: [&[u8; 4]; 6] = [b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP", b"sPLT"];

const WEBP_ALLOWED: [&[u8; 4]; 4] = [b"VP8 ", b"VP8L", b"VP8X", b"ALPH"];

const WEBP_DENY: [&[u8; 4]; 5] = [b"EXIF", b"XMP ", b"ICCP", b"ANIM", b"ANMF"];

pub fn png_allowed(ctype: &[u8; 4]) -> bool {
    PNG_ALLOWED.contains(&ctype)
}

pub fn png_denied(ctype: &[u8; 4]) -> bool {
    PNG_DENY.contains(&ctype)
}

pub fn webp_allowed(ctype: &[u8; 4]) -> bool {
    WEBP_ALLOWED.contains(&ctype)
}

pub fn webp_denied(ctype: &[u8; 4]) -> bool {
    WEBP_DENY.contains(&ctype)
}

pub fn jpeg_marker_denied(marker: u8) -> bool {
    (0xe0..=0xef).contains(&marker) || marker == 0xfe
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Group {
    Location,
    Device,
    Time,
    Software,
    Ids,
    Provenance,
    Hidden,
}

impl Group {
    pub fn label(self) -> &'static str {
        match self {
            Group::Location => "Location",
            Group::Device => "Device",
            Group::Time => "Time",
            Group::Software => "Software",
            Group::Ids => "Ids",
            Group::Provenance => "Provenance",
            Group::Hidden => "Hidden",
        }
    }
}

type Fourcc = [u8; 4];

const VISUAL_KIDS: &[&Fourcc] = &[b"colr", b"pasp"];

pub const MP4_TREE: &[(&Fourcc, &[&Fourcc])] = &[
    (b"root", &[b"ftyp", b"moov", b"mdat"]),
    (b"moov", &[b"mvhd", b"trak"]),
    (b"trak", &[b"tkhd", b"mdia"]),
    (b"mdia", &[b"mdhd", b"hdlr", b"minf"]),
    (b"minf", &[b"vmhd", b"smhd", b"dinf", b"stbl"]),
    (b"dinf", &[b"dref"]),
    (b"dref", &[b"url "]),
    (b"stbl", &[b"stsd", b"stts", b"ctts", b"stss", b"stsc", b"stsz", b"stco", b"co64"]),
    (b"stsd", &[b"avc1", b"hvc1", b"hev1", b"av01", b"vp09", b"mp4a", b"Opus"]),
    (b"avc1", &[b"avcC", b"colr", b"pasp"]),
    (b"hvc1", &[b"hvcC", b"colr", b"pasp"]),
    (b"hev1", &[b"hvcC", b"colr", b"pasp"]),
    (b"av01", &[b"av1C", b"colr", b"pasp"]),
    (b"vp09", &[b"vpcC", b"colr", b"pasp"]),
    (b"mp4a", &[b"esds"]),
    (b"Opus", &[b"dOps"]),
];

pub const MP4_VISUAL_ENTRIES: &[&Fourcc] = &[b"avc1", b"hvc1", b"hev1", b"av01", b"vp09"];
pub const MP4_AUDIO_ENTRIES: &[&Fourcc] = &[b"mp4a", b"Opus"];

pub fn mp4_allowed(parent: &Fourcc, child: &Fourcc) -> bool {
    MP4_TREE
        .iter()
        .find(|(p, _)| *p == parent)
        .map(|(_, kids)| kids.contains(&child))
        .unwrap_or(false)
}

pub fn mp4_visual_child_ok(child: &Fourcc) -> bool {
    VISUAL_KIDS.contains(&child)
}

pub const MP4_DENY: &[(&Fourcc, Group, &str)] = &[
    (b"udta", Group::Hidden, "user data box"),
    (b"meta", Group::Hidden, "metadata box"),
    (b"keys", Group::Hidden, "metadata key table"),
    (b"ilst", Group::Hidden, "metadata item list"),
    (b"uuid", Group::Hidden, "vendor extension box"),
    (b"free", Group::Hidden, "padding box"),
    (b"skip", Group::Hidden, "padding box"),
    (b"wide", Group::Hidden, "padding box"),
    (b"Xtra", Group::Ids, "Windows property store"),
    (b"xtra", Group::Ids, "Windows property store"),
    (b"smta", Group::Device, "Samsung metadata"),
    (b"sefd", Group::Device, "Samsung trailer data"),
    (b"SEFT", Group::Device, "Samsung trailer data"),
    (b"loci", Group::Location, "3GPP location"),
    (b"edts", Group::Hidden, "edit list"),
    (b"elst", Group::Hidden, "edit list entries"),
    (b"tref", Group::Hidden, "track reference"),
    (b"gmhd", Group::Hidden, "generic media header"),
    (b"tmcd", Group::Time, "timecode"),
    (b"mebx", Group::Location, "timed metadata (sensors, GPS)"),
    (b"camm", Group::Location, "camera motion metadata"),
    (b"gpmd", Group::Location, "GoPro telemetry"),
    (b"emsg", Group::Hidden, "event message"),
    (b"prft", Group::Time, "producer wall clock time"),
    (b"sidx", Group::Hidden, "segment index"),
    (b"moof", Group::Hidden, "movie fragment"),
    (b"mfra", Group::Hidden, "fragment random access"),
    (b"mvex", Group::Hidden, "fragment defaults"),
    (b"pssh", Group::Hidden, "DRM system header"),
    (b"sinf", Group::Hidden, "protection info"),
    (b"pnot", Group::Hidden, "preview"),
    (b"PICT", Group::Hidden, "preview picture"),
    (b"load", Group::Hidden, "preload settings"),
    (b"clip", Group::Hidden, "clipping region"),
    (b"matt", Group::Hidden, "track matte"),
    (b"tapt", Group::Hidden, "aperture modes"),
    (b"covr", Group::Hidden, "cover image"),
    (b"dvcC", Group::Hidden, "Dolby Vision config"),
    (b"dvvC", Group::Hidden, "Dolby Vision config"),
    (b"chpl", Group::Hidden, "chapter list"),
    (b"cprt", Group::Ids, "copyright"),
    (b"\xa9xyz", Group::Location, "GPS location"),
    (b"\xa9mak", Group::Device, "camera make"),
    (b"\xa9mod", Group::Device, "camera model"),
    (b"\xa9swr", Group::Software, "software"),
    (b"\xa9too", Group::Software, "encoder tool"),
    (b"\xa9enc", Group::Software, "encoder"),
    (b"\xa9day", Group::Time, "date"),
    (b"\xa9cmt", Group::Hidden, "comment"),
    (b"\xa9des", Group::Hidden, "description"),
    (b"\xa9inf", Group::Hidden, "information"),
    (b"\xa9nam", Group::Ids, "title"),
    (b"\xa9ART", Group::Ids, "artist"),
    (b"\xa9aut", Group::Ids, "author"),
];

pub fn mp4_deny(t: &Fourcc) -> Option<(Group, &'static str)> {
    if let Some((_, g, text)) = MP4_DENY.iter().find(|(f, _, _)| *f == t) {
        return Some((*g, text));
    }
    if t[0] == 0xa9 {
        return Some((Group::Hidden, "text tag"));
    }
    None
}

pub const MP4_ILST_KEYS: &[(&str, Group, &str)] = &[
    ("com.apple.quicktime.location.ISO6709", Group::Location, "GPS location"),
    ("com.apple.quicktime.location.accuracy.horizontal", Group::Location, "GPS accuracy"),
    ("com.apple.quicktime.location.name", Group::Location, "place name"),
    ("com.apple.quicktime.location.body", Group::Location, "location body"),
    ("com.apple.quicktime.make", Group::Device, "camera make"),
    ("com.apple.quicktime.model", Group::Device, "camera model"),
    ("com.apple.quicktime.camera.identifier", Group::Device, "camera identifier"),
    ("com.apple.quicktime.camera.lens_model", Group::Device, "lens model"),
    ("com.apple.quicktime.software", Group::Software, "software version"),
    ("com.apple.quicktime.creationdate", Group::Time, "creation date"),
    ("com.apple.quicktime.content.identifier", Group::Ids, "Live Photo pairing ID"),
    ("com.apple.quicktime.author", Group::Ids, "author"),
    ("com.apple.quicktime.title", Group::Ids, "title"),
    ("com.apple.quicktime.description", Group::Hidden, "description"),
    ("com.android.version", Group::Software, "Android version"),
    ("com.android.manufacturer", Group::Device, "phone maker"),
    ("com.android.model", Group::Device, "phone model"),
    ("com.android.capture.fps", Group::Device, "capture frame rate"),
    ("com.bytedance.info", Group::Ids, "ByteDance tracking data"),
];

pub fn ilst_key(name: &str) -> (Group, &'static str) {
    if let Some((_, g, text)) = MP4_ILST_KEYS.iter().find(|(k, _, _)| *k == name) {
        return (*g, text);
    }
    if name.starts_with("com.apple.quicktime.location") {
        return (Group::Location, "location data");
    }
    if name.starts_with("com.apple.") {
        return (Group::Hidden, "Apple metadata");
    }
    if name.starts_with("com.android.") {
        return (Group::Device, "Android metadata");
    }
    if name.starts_with("com.bytedance") {
        return (Group::Ids, "ByteDance tracking data");
    }
    if name == "encoder" || name.ends_with(".encoder") || name.ends_with(".software") {
        return (Group::Software, "encoder");
    }
    if name.contains("location") || name.contains("gps") {
        return (Group::Location, "location data");
    }
    if name.contains("date") || name.contains("time") {
        return (Group::Time, "date");
    }
    (Group::Hidden, "metadata key")
}

pub const EBML_HEADER: u32 = 0x1A45_DFA3;
pub const MKV_SEGMENT: u32 = 0x1853_8067;
pub const MKV_SEEKHEAD: u32 = 0x114D_9B74;
pub const MKV_SEEK: u32 = 0x4DBB;
pub const MKV_SEEKID: u32 = 0x53AB;
pub const MKV_SEEKPOS: u32 = 0x53AC;
pub const MKV_INFO: u32 = 0x1549_A966;
pub const MKV_TRACKS: u32 = 0x1654_AE6B;
pub const MKV_TRACKENTRY: u32 = 0xAE;
pub const MKV_CLUSTER: u32 = 0x1F43_B675;
pub const MKV_CUES: u32 = 0x1C53_BB6B;
pub const MKV_CUEPOINT: u32 = 0xBB;
pub const MKV_CUETIME: u32 = 0xB3;
pub const MKV_CUETRACKPOS: u32 = 0xB7;
pub const MKV_CUETRACK: u32 = 0xF7;
pub const MKV_CUECLUSTERPOS: u32 = 0xF1;
pub const MKV_TAGS: u32 = 0x1254_C367;
pub const MKV_ATTACHMENTS: u32 = 0x1941_A469;
pub const MKV_CHAPTERS: u32 = 0x1043_A770;
pub const MKV_VOID: u32 = 0xEC;
pub const MKV_CRC32: u32 = 0xBF;
pub const MKV_TIMESTAMPSCALE: u32 = 0x2A_D7B1;
pub const MKV_DURATION: u32 = 0x4489;
pub const MKV_MUXINGAPP: u32 = 0x4D80;
pub const MKV_WRITINGAPP: u32 = 0x5741;
pub const MKV_DATEUTC: u32 = 0x4461;
pub const MKV_TITLE: u32 = 0x7BA9;
pub const MKV_TRACKNUMBER: u32 = 0xD7;
pub const MKV_TRACKUID: u32 = 0x73C5;
pub const MKV_TRACKTYPE: u32 = 0x83;
pub const MKV_FLAGENABLED: u32 = 0xB9;
pub const MKV_FLAGDEFAULT: u32 = 0x88;
pub const MKV_FLAGLACING: u32 = 0x9C;
pub const MKV_LANGUAGE: u32 = 0x22_B59C;
pub const MKV_CODECID: u32 = 0x86;
pub const MKV_CODECPRIVATE: u32 = 0x63A2;
pub const MKV_DEFAULTDURATION: u32 = 0x23_E383;
pub const MKV_CODECDELAY: u32 = 0x56AA;
pub const MKV_SEEKPREROLL: u32 = 0x56BB;
pub const MKV_NAME: u32 = 0x536E;
pub const MKV_VIDEO: u32 = 0xE0;
pub const MKV_AUDIO: u32 = 0xE1;
pub const MKV_PIXELWIDTH: u32 = 0xB0;
pub const MKV_PIXELHEIGHT: u32 = 0xBA;
pub const MKV_DISPLAYWIDTH: u32 = 0x54B0;
pub const MKV_DISPLAYHEIGHT: u32 = 0x54BA;
pub const MKV_COLOUR: u32 = 0x55B0;
pub const MKV_MATRIX: u32 = 0x55B1;
pub const MKV_RANGE: u32 = 0x55B9;
pub const MKV_TRANSFER: u32 = 0x55BA;
pub const MKV_PRIMARIES: u32 = 0x55BB;
pub const MKV_SAMPLINGFREQ: u32 = 0xB5;
pub const MKV_CHANNELS: u32 = 0x9F;
pub const MKV_BITDEPTH: u32 = 0x6264;
pub const MKV_CONTENTENCODINGS: u32 = 0x6D80;
pub const MKV_BLOCKADDMAPPING: u32 = 0x41E4;
pub const MKV_TIMESTAMP: u32 = 0xE7;
pub const MKV_SIMPLEBLOCK: u32 = 0xA3;
pub const MKV_BLOCKGROUP: u32 = 0xA0;
pub const MKV_BLOCK: u32 = 0xA1;
pub const MKV_BLOCKDURATION: u32 = 0x9B;
pub const MKV_REFERENCEBLOCK: u32 = 0xFB;
pub const MKV_BLOCKADDITIONS: u32 = 0x75A1;
pub const MKV_TAG: u32 = 0x7373;
pub const MKV_SIMPLETAG: u32 = 0x67C8;
pub const MKV_TAGNAME: u32 = 0x45A3;
pub const MKV_ATTACHEDFILE: u32 = 0x61A7;
pub const MKV_FILENAME: u32 = 0x466E;

pub const MKV_ALLOWED: &[(u32, u32)] = &[
    (EBML_HEADER, 0),
    (MKV_SEGMENT, 0),
    (0x4286, EBML_HEADER),
    (0x42F7, EBML_HEADER),
    (0x42F2, EBML_HEADER),
    (0x42F3, EBML_HEADER),
    (0x4282, EBML_HEADER),
    (0x4287, EBML_HEADER),
    (0x4285, EBML_HEADER),
    (MKV_SEEKHEAD, MKV_SEGMENT),
    (MKV_INFO, MKV_SEGMENT),
    (MKV_TRACKS, MKV_SEGMENT),
    (MKV_CLUSTER, MKV_SEGMENT),
    (MKV_CUES, MKV_SEGMENT),
    (MKV_SEEK, MKV_SEEKHEAD),
    (MKV_SEEKID, MKV_SEEK),
    (MKV_SEEKPOS, MKV_SEEK),
    (MKV_TIMESTAMPSCALE, MKV_INFO),
    (MKV_DURATION, MKV_INFO),
    (MKV_MUXINGAPP, MKV_INFO),
    (MKV_WRITINGAPP, MKV_INFO),
    (MKV_TRACKENTRY, MKV_TRACKS),
    (MKV_TRACKNUMBER, MKV_TRACKENTRY),
    (MKV_TRACKUID, MKV_TRACKENTRY),
    (MKV_TRACKTYPE, MKV_TRACKENTRY),
    (MKV_FLAGENABLED, MKV_TRACKENTRY),
    (MKV_FLAGDEFAULT, MKV_TRACKENTRY),
    (MKV_FLAGLACING, MKV_TRACKENTRY),
    (MKV_LANGUAGE, MKV_TRACKENTRY),
    (MKV_CODECID, MKV_TRACKENTRY),
    (MKV_CODECPRIVATE, MKV_TRACKENTRY),
    (MKV_DEFAULTDURATION, MKV_TRACKENTRY),
    (MKV_CODECDELAY, MKV_TRACKENTRY),
    (MKV_SEEKPREROLL, MKV_TRACKENTRY),
    (MKV_VIDEO, MKV_TRACKENTRY),
    (MKV_AUDIO, MKV_TRACKENTRY),
    (MKV_PIXELWIDTH, MKV_VIDEO),
    (MKV_PIXELHEIGHT, MKV_VIDEO),
    (MKV_DISPLAYWIDTH, MKV_VIDEO),
    (MKV_DISPLAYHEIGHT, MKV_VIDEO),
    (MKV_COLOUR, MKV_VIDEO),
    (MKV_MATRIX, MKV_COLOUR),
    (MKV_RANGE, MKV_COLOUR),
    (MKV_TRANSFER, MKV_COLOUR),
    (MKV_PRIMARIES, MKV_COLOUR),
    (MKV_SAMPLINGFREQ, MKV_AUDIO),
    (MKV_CHANNELS, MKV_AUDIO),
    (MKV_BITDEPTH, MKV_AUDIO),
    (MKV_TIMESTAMP, MKV_CLUSTER),
    (MKV_SIMPLEBLOCK, MKV_CLUSTER),
    (MKV_CUEPOINT, MKV_CUES),
    (MKV_CUETIME, MKV_CUEPOINT),
    (MKV_CUETRACKPOS, MKV_CUEPOINT),
    (MKV_CUETRACK, MKV_CUETRACKPOS),
    (MKV_CUECLUSTERPOS, MKV_CUETRACKPOS),
];

pub fn mkv_allowed(id: u32, parent: u32) -> bool {
    MKV_ALLOWED.iter().any(|&(i, p)| i == id && p == parent)
}

pub const MKV_DENY: &[(u32, Group, &str, &str)] = &[
    (MKV_TAGS, Group::Software, "Tags", "encoder and free text tags"),
    (MKV_ATTACHMENTS, Group::Hidden, "Attachments", "embedded files"),
    (MKV_CHAPTERS, Group::Hidden, "Chapters", "chapter titles and IDs"),
    (MKV_VOID, Group::Hidden, "Void", "padding"),
    (MKV_CRC32, Group::Hidden, "CRC-32", "checksum"),
    (MKV_TITLE, Group::Ids, "Title", "free text title"),
    (MKV_DATEUTC, Group::Time, "DateUTC", "creation date"),
    (0x73A4, Group::Ids, "SegmentUUID", "random file ID"),
    (0x3CB923, Group::Ids, "PrevUUID", "linked file ID"),
    (0x3EB923, Group::Ids, "NextUUID", "linked file ID"),
    (0x7384, Group::Ids, "SegmentFilename", "file name"),
    (0x3C83AB, Group::Ids, "PrevFilename", "linked file name"),
    (0x3E83BB, Group::Ids, "NextFilename", "linked file name"),
    (0x4444, Group::Ids, "SegmentFamily", "file family ID"),
    (0x6924, Group::Ids, "ChapterTranslate", "chapter mapping"),
    (MKV_NAME, Group::Ids, "Name", "track name"),
    (0x258688, Group::Software, "CodecName", "codec name text"),
    (MKV_BLOCKADDITIONS, Group::Hidden, "BlockAdditions", "per frame side data"),
    (MKV_BLOCKADDMAPPING, Group::Hidden, "BlockAdditionMapping", "side data mapping"),
    (MKV_CONTENTENCODINGS, Group::Hidden, "ContentEncodings", "compressed or encrypted frames"),
    (0xAF, Group::Hidden, "EncryptedBlock", "encrypted frames"),
];

pub fn mkv_deny(id: u32) -> Option<(Group, &'static str, &'static str)> {
    MKV_DENY.iter().find(|(i, _, _, _)| *i == id).map(|(_, g, n, t)| (*g, *n, *t))
}

pub const MKV_QUIET: &[u32] = &[
    0x4281, 0x9A, 0x9D, 0x53B8, 0x53C0, 0x54AA, 0x54BB, 0x54CC, 0x54DD, 0x54B2, 0x54B3, 0x55B2, 0x55B3,
    0x55B4, 0x55B5, 0x55B6, 0x55B7, 0x55B8, 0x55BC, 0x55BD, 0x55D0, 0x78B5, 0x52F1, 0x55AA, 0x55AB, 0x55AC,
    0x55AD, 0x55AE, 0x55AF, 0x6DE7, 0x6DF8, 0x234E7A, 0x23314F, 0x55EE, 0x22B59D, 0x7446, 0xAA, 0x6FAB,
    0x6624, 0xE2, 0x5854, 0xA7, 0xAB, 0xA2, 0xFA, 0xA4, 0x75A2, 0x8E, 0xB2, 0x5378, 0xEA, 0xDB, 0xF0,
];

pub fn mkv_quiet(id: u32) -> bool {
    MKV_QUIET.contains(&id)
}

pub const MKV_APP: &[u8] = b"stoptrackingme";

pub const MKV_WEBM_CODECS: &[&str] = &["V_VP8", "V_VP9", "V_AV1", "A_OPUS", "A_VORBIS"];
pub const MKV_VIDEO_CODECS: &[&str] = &["V_VP8", "V_VP9", "V_AV1", "V_MPEG4/ISO/AVC", "V_MPEGH/ISO/HEVC"];
pub const MKV_AUDIO_CODECS: &[&str] = &["A_OPUS", "A_VORBIS", "A_AAC"];

pub const AVC_NAL_OK: [u8; 4] = [1, 5, 7, 8];
pub const HEVC_NAL_OK: std::ops::RangeInclusive<u8> = 0..=34;
pub const AV1_OBU_OK: [u8; 6] = [1, 2, 3, 4, 6, 7];

pub fn avc_nal_ok(t: u8) -> bool {
    AVC_NAL_OK.contains(&t)
}

pub fn hevc_nal_ok(t: u8) -> bool {
    HEVC_NAL_OK.contains(&t)
}

pub fn av1_obu_ok(t: u8) -> bool {
    AV1_OBU_OK.contains(&t)
}

pub const XMP_UUID: [u8; 16] = [
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC,
];
pub const C2PA_UUID: [u8; 16] = [
    0xD8, 0xFE, 0xC3, 0xD6, 0x1B, 0x0E, 0x48, 0x3C, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7E, 0xC4, 0x81,
];

pub const MAGIC_SWEEP: &[(&[u8], &str, Group)] = &[
    (b"jumdc2pa\x00\x11\x00\x10", "C2PA JUMBF box (jumb/jumd c2pa)", Group::Provenance),
    (b"c2pa.claim", "C2PA claim", Group::Provenance),
    (b"c2pa.signature", "C2PA signature", Group::Provenance),
    (b"c2pa.assertions", "C2PA assertions", Group::Provenance),
    (&C2PA_UUID, "C2PA UUID", Group::Provenance),
    (b"<x:xmpmeta", "XMP packet", Group::Provenance),
    (b"W5M0MpCehiHzreSzNTczkc9d", "XMP packet", Group::Provenance),
    (&XMP_UUID, "XMP UUID", Group::Provenance),
    (b"x264 - core", "x264 build string", Group::Software),
    (b"x265 (build", "x265 build string", Group::Software),
    (b"Lavf5", "Lavf muxer string", Group::Software),
    (b"Lavf6", "Lavf muxer string", Group::Software),
    (b"Lavf7", "Lavf muxer string", Group::Software),
    (b"Lavc5", "Lavc encoder string", Group::Software),
    (b"Lavc6", "Lavc encoder string", Group::Software),
    (b"Lavc7", "Lavc encoder string", Group::Software),
    (b"Lavc lib", "Lavc encoder string", Group::Software),
    (b"HandBrake ", "HandBrake string", Group::Software),
    (b"mkvmerge", "mkvmerge string", Group::Software),
    (b"com.apple.", "Apple metadata key", Group::Hidden),
    (b"com.android.", "Android metadata key", Group::Device),
    (b"com.bytedance", "ByteDance metadata key", Group::Ids),
    (b"Exif\x00\x00", "EXIF block", Group::Hidden),
];

pub fn magic_max_len() -> usize {
    MAGIC_SWEEP.iter().map(|(n, _, _)| n.len()).max().unwrap_or(1)
}

pub fn ftyp_for(video: &Fourcc) -> Vec<u8> {
    let mut brands: Vec<&Fourcc> = vec![b"isom", b"iso2"];
    match video {
        b"avc1" => brands.push(b"avc1"),
        b"hvc1" | b"hev1" => brands.push(b"hvc1"),
        b"av01" => brands.push(b"av01"),
        _ => {}
    }
    brands.push(b"mp41");
    let size = 16 + 4 * brands.len();
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(&(size as u32).to_be_bytes());
    out.extend_from_slice(b"ftyp");
    out.extend_from_slice(b"isom");
    out.extend_from_slice(&512u32.to_be_bytes());
    for b in brands {
        out.extend_from_slice(b);
    }
    out
}
