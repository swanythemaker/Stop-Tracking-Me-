use crate::guard;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Req {
    pub offset: u64,
    pub len: u32,
}

pub struct Cursor<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Cursor { b, pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    pub fn remaining(&self) -> usize {
        self.b.len().saturating_sub(self.pos)
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).ok_or_else(|| "Length overflow".to_string())?;
        if end > self.b.len() {
            return Err("Truncated structure".to_string());
        }
        let s = &self.b[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    pub fn skip(&mut self, n: usize) -> Result<(), String> {
        self.bytes(n).map(|_| ())
    }

    pub fn rest(&mut self) -> &'a [u8] {
        let s = self.b.get(self.pos..).unwrap_or(&[]);
        self.pos = self.b.len();
        s
    }

    pub fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, String> {
        let s = self.bytes(2)?;
        Ok(u16::from_be_bytes([s[0], s[1]]))
    }

    pub fn u24(&mut self) -> Result<u32, String> {
        let s = self.bytes(3)?;
        Ok(((s[0] as u32) << 16) | ((s[1] as u32) << 8) | s[2] as u32)
    }

    pub fn u32(&mut self) -> Result<u32, String> {
        let s = self.bytes(4)?;
        Ok(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    }

    pub fn i16(&mut self) -> Result<i16, String> {
        Ok(self.u16()? as i16)
    }

    pub fn i32(&mut self) -> Result<i32, String> {
        Ok(self.u32()? as i32)
    }

    pub fn u64(&mut self) -> Result<u64, String> {
        let s = self.bytes(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Ok(u64::from_be_bytes(a))
    }

    pub fn fourcc(&mut self) -> Result<[u8; 4], String> {
        let s = self.bytes(4)?;
        Ok([s[0], s[1], s[2], s[3]])
    }
}

pub struct Gather {
    start: u64,
    end: u64,
    chunk: u32,
    buf: Vec<u8>,
}

impl Gather {
    pub fn new(start: u64, end: u64, chunk: u32) -> Result<Self, String> {
        if end < start {
            return Err("Invalid read range".to_string());
        }
        let len = usize::try_from(end - start).map_err(|_| "Read range too large".to_string())?;
        Ok(Gather { start, end, chunk: guard::clamp_window(chunk), buf: Vec::with_capacity(len) })
    }

    pub fn start(&self) -> u64 {
        self.start
    }

    pub fn need(&self) -> Option<Req> {
        let have = self.start + self.buf.len() as u64;
        if have >= self.end {
            return None;
        }
        let len = (self.end - have).min(self.chunk as u64) as u32;
        Some(Req { offset: have, len })
    }

    pub fn feed(&mut self, offset: u64, bytes: &[u8]) -> Result<bool, String> {
        let want = self.need().ok_or_else(|| "Unexpected read".to_string())?;
        check_feed(want, offset, bytes)?;
        self.buf.extend_from_slice(bytes);
        Ok(self.need().is_none())
    }

    pub fn take(self) -> Vec<u8> {
        self.buf
    }
}

pub fn check_feed(want: Req, offset: u64, bytes: &[u8]) -> Result<(), String> {
    if offset != want.offset || bytes.len() != want.len as usize {
        return Err(format!(
            "Read mismatch: wanted {} bytes at {}, got {} bytes at {}",
            want.len,
            want.offset,
            bytes.len(),
            offset
        ));
    }
    Ok(())
}

pub fn be16(b: &[u8], o: usize) -> Option<u16> {
    let s = b.get(o..o.checked_add(2)?)?;
    Some(u16::from_be_bytes([s[0], s[1]]))
}

pub fn be32(b: &[u8], o: usize) -> Option<u32> {
    let s = b.get(o..o.checked_add(4)?)?;
    Some(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

pub fn be64(b: &[u8], o: usize) -> Option<u64> {
    let s = b.get(o..o.checked_add(8)?)?;
    let mut a = [0u8; 8];
    a.copy_from_slice(s);
    Some(u64::from_be_bytes(a))
}

pub fn find(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && hay.windows(needle.len()).any(|w| w == needle)
}
