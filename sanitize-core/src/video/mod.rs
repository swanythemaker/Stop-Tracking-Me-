pub mod bmff_model;
pub mod bmff_walk;
pub mod bmff_write;
pub mod ebml_walk;
pub mod mkv_model;
pub mod mkv_write;
pub mod nal;
pub mod obu;
pub mod planes;
pub mod reader;
pub mod rebuild;
pub mod report;
pub mod vaudit;

pub use rebuild::{Rebuild, RebuildOptions};
pub use vaudit::{Audit, VideoAuditSummary};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Mkv,
}

pub fn sniff(head: &[u8]) -> Option<Container> {
    if head.len() >= 4 && head[..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        return Some(Container::Mkv);
    }
    if head.len() >= 8 {
        let t = &head[4..8];
        let known: [&[u8; 4]; 8] = [b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip", b"uuid", b"pnot"];
        if known.iter().any(|k| &k[..] == t) {
            return Some(Container::Mp4);
        }
    }
    None
}
