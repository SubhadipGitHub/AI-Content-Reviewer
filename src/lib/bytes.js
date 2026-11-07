// Low-level byte helpers shared by the scan engine (runs in workers and Node tests).

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** CRC-32 (IEEE) of a byte array. */
export function crc32(bytes, start = 0, end = bytes.length) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
const latin1 = new TextDecoder('latin1');

export const decodeUtf8 = (b) => utf8.decode(b);
export const decodeLatin1 = (b) => latin1.decode(b);
export const encodeUtf8 = (s) => new TextEncoder().encode(s);

/** Decode UTF-16 (LE default, honours BOM). */
export function decodeUtf16(b, le = true) {
  if (b.length >= 2) {
    if (b[0] === 0xff && b[1] === 0xfe) { le = true; b = b.subarray(2); }
    else if (b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); }
  }
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b);
}

export const u16le = (b, o) => b[o] | (b[o + 1] << 8);
export const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const u16be = (b, o) => (b[o] << 8) | b[o + 1];
export const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const u64le = (b, o) => u32le(b, o) + u32le(b, o + 4) * 2 ** 32;

/** Find an ASCII needle inside bytes. Returns index or -1. */
export function indexOfBytes(hay, needle, from = 0) {
  const n = typeof needle === 'string' ? encodeUtf8(needle) : needle;
  const first = n[0];
  const max = hay.length - n.length;
  outer: for (let i = from; i <= max; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/** Run a byte stream through a (De)CompressionStream. */
export async function transformBytes(bytes, stream, limit = Infinity) {
  const rs = new Blob([bytes]).stream().pipeThrough(stream);
  const reader = rs.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new RangeError('decompressed size limit exceeded'); }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const inflateRaw = (b, limit) => transformBytes(b, new DecompressionStream('deflate-raw'), limit);
export const inflate = (b, limit) => transformBytes(b, new DecompressionStream('deflate'), limit);
export const deflate = (b) => transformBytes(b, new CompressionStream('deflate'));

/** Read a Blob range as bytes. */
export async function readRange(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/**
 * Extract printable strings (ASCII and UTF-16LE) from binary data, like `strings`.
 * Used as a fallback for formats we do not parse natively.
 */
export function extractStrings(bytes, min = 6, maxTotal = 2_000_000) {
  const out = [];
  let total = 0;
  let cur = '';
  for (let i = 0; i < bytes.length && total < maxTotal; i++) {
    const c = bytes[i];
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= min) { out.push(cur); total += cur.length; }
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  // UTF-16LE pass (common in legacy Office binaries)
  cur = '';
  for (let i = 0; i + 1 < bytes.length && total < maxTotal; i += 2) {
    const c = bytes[i], z = bytes[i + 1];
    if (z === 0 && c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= min) { out.push(cur); total += cur.length; }
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  return out.join('\n');
}
