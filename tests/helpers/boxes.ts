type Bytes = ArrayBuffer | Uint8Array;

export type BoxEntry = { path: string; type: string };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "stsd", "udta", "meta", "edts"]);
const VISUAL_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp08", "vp09", "mp4v"]);
const AUDIO_ENTRIES = new Set(["mp4a", "Opus", "fLaC", "ac-3", "ec-3"]);
const VISUAL_ENTRY_HEADER = 78;
const AUDIO_ENTRY_HEADER = 28;

function u8(buf: Bytes): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

type Header = { type: string; size: number; header: number };

function readHeader(b: Uint8Array, p: number, end: number): Header | null {
  if (p + 8 > end) return null;
  let size = u32(b, p);
  const type = fourcc(b, p + 4);
  let header = 8;
  if (size === 1) {
    if (p + 16 > end) return null;
    size = u32(b, p + 8) * 0x100000000 + u32(b, p + 12);
    header = 16;
  } else if (size === 0) {
    size = end - p;
  }
  if (size < header || p + size > end) return null;
  return { type, size, header };
}

function childStart(b: Uint8Array, type: string, bodyStart: number, end: number): number | null {
  if (type === "stsd") return bodyStart + 8;
  if (type === "meta") {
    if (bodyStart + 8 <= end && fourcc(b, bodyStart + 4) === "hdlr") return bodyStart;
    return bodyStart + 4;
  }
  if (VISUAL_ENTRIES.has(type)) return bodyStart + VISUAL_ENTRY_HEADER;
  if (AUDIO_ENTRIES.has(type)) return bodyStart + AUDIO_ENTRY_HEADER;
  if (CONTAINERS.has(type)) return bodyStart;
  return null;
}

function walk(b: Uint8Array, start: number, end: number, prefix: string, depth: number, out: BoxEntry[]): void {
  let p = start;
  while (p < end) {
    const h = readHeader(b, p, end);
    if (!h) return;
    const path = prefix ? `${prefix}/${h.type}` : h.type;
    out.push({ path, type: h.type });
    const inner = childStart(b, h.type, p + h.header, p + h.size);
    if (inner !== null && depth < 12 && inner <= p + h.size) {
      walk(b, inner, p + h.size, path, depth + 1, out);
    }
    p += h.size;
  }
}

export function topLevelBoxes(buf: Bytes): string[] {
  const b = u8(buf);
  const out: string[] = [];
  let p = 0;
  while (p < b.length) {
    const h = readHeader(b, p, b.length);
    if (!h) break;
    out.push(h.type);
    p += h.size;
  }
  return out;
}

export function walkBoxes(buf: Bytes): BoxEntry[] {
  const b = u8(buf);
  const out: BoxEntry[] = [];
  walk(b, 0, b.length, "", 0, out);
  return out;
}

type Vint = { value: number; length: number; unknown: boolean };

function readVint(b: Uint8Array, p: number, keepMarker: boolean): Vint | null {
  if (p >= b.length) return null;
  const first = b[p];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || p + length > b.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const EBML_HEADER_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;

export function ebmlIds(buf: Bytes): number[] {
  const b = u8(buf);
  const out: number[] = [];
  let p = 0;
  while (p < b.length) {
    const id = readVint(b, p, true);
    if (!id) break;
    const size = readVint(b, p + id.length, false);
    if (!size) break;
    const bodyStart = p + id.length + size.length;
    const bodyEnd = size.unknown ? b.length : bodyStart + size.value;
    if (bodyEnd > b.length) break;
    out.push(id.value);
    if (id.value === EBML_HEADER_ID || id.value === SEGMENT_ID) {
      let q = bodyStart;
      while (q < bodyEnd) {
        const cid = readVint(b, q, true);
        if (!cid) break;
        const csize = readVint(b, q + cid.length, false);
        if (!csize) break;
        out.push(cid.value);
        if (csize.unknown) break;
        q += cid.length + csize.length + csize.value;
      }
    }
    p = bodyEnd;
  }
  return out;
}

export function hasBytes(buf: Bytes, ascii: string): boolean {
  const b = u8(buf);
  const needle = new Uint8Array(ascii.length);
  for (let i = 0; i < ascii.length; i++) needle[i] = ascii.charCodeAt(i) & 0xff;
  if (needle.length === 0) return true;
  const first = needle[0];
  const last = b.length - needle.length;
  outer: for (let i = b.indexOf(first); i !== -1 && i <= last; i = b.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) {
      if (b[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
