// Streaming ZIP reader on top of Blob.slice + DecompressionStream.
// Reads only the central directory up front; entry data is pulled on demand,
// so multi-hundred-MB archives never need to be fully in memory.

import { readRange, u16le, u32le, u64le, inflateRaw, decodeUtf8, decodeLatin1 } from '../lib/bytes.js';

const EOCD_SIG = 0x06054b50;
const ZIP64_LOC_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export class ZipError extends Error {}

/**
 * @param {Blob} blob
 * @returns {Promise<{entries: ZipEntry[], read: (e: ZipEntry, limit?: number) => Promise<Uint8Array>}>}
 */
export async function openZip(blob) {
  const size = blob.size;
  const tailLen = Math.min(size, 65557);
  const tail = await readRange(blob, size - tailLen, size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32le(tail, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive (end of central directory not found)');

  let count = u16le(tail, eocd + 10);
  let cdSize = u32le(tail, eocd + 12);
  let cdOffset = u32le(tail, eocd + 16);

  // ZIP64
  if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && u32le(tail, eocd - 20) === ZIP64_LOC_SIG) {
    const z64Off = u64le(tail, eocd - 20 + 8);
    const z64 = await readRange(blob, z64Off, z64Off + 56);
    count = u64le(z64, 32);
    cdSize = u64le(z64, 40);
    cdOffset = u64le(z64, 48);
  }
  if (cdOffset + cdSize > size) throw new ZipError('Corrupt ZIP (central directory out of bounds)');

  const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (u32le(cd, p) !== CEN_SIG) break;
    const flags = u16le(cd, p + 8);
    const method = u16le(cd, p + 10);
    let compSize = u32le(cd, p + 20);
    let uncompSize = u32le(cd, p + 24);
    const nameLen = u16le(cd, p + 28);
    const extraLen = u16le(cd, p + 30);
    const commentLen = u16le(cd, p + 32);
    let localOffset = u32le(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? decodeUtf8(nameBytes) : decodeLatin1(nameBytes);
    // ZIP64 extra field
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16le(cd, x), len = u16le(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (uncompSize === 0xffffffff) { uncompSize = u64le(cd, q); q += 8; }
        if (compSize === 0xffffffff) { compSize = u64le(cd, q); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = u64le(cd, q); }
      }
      x += 4 + len;
    }
    entries.push({
      name,
      dir: name.endsWith('/'),
      method,
      encrypted: !!(flags & 1),
      flags,
      crc: u32le(cd, p + 16),
      compSize,
      size: uncompSize,
      localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function read(entry, limit = 256 * 1024 * 1024) {
    if (entry.encrypted) throw new ZipError('Entry is encrypted');
    const lh = await readRange(blob, entry.localOffset, entry.localOffset + 30);
    if (u32le(lh, 0) !== LOC_SIG) throw new ZipError('Corrupt local header');
    const start = entry.localOffset + 30 + u16le(lh, 26) + u16le(lh, 28);
    const data = await readRange(blob, start, start + entry.compSize);
    if (entry.method === 0) return data.subarray(0, Math.min(data.length, limit));
    if (entry.method === 8) return inflateRaw(data, limit);
    throw new ZipError(`Unsupported compression method ${entry.method}`);
  }

  /** Compressed bytes as stored (for copying an entry unchanged into a new archive). */
  async function readRaw(entry) {
    const lh = await readRange(blob, entry.localOffset, entry.localOffset + 30);
    if (u32le(lh, 0) !== LOC_SIG) throw new ZipError('Corrupt local header');
    const start = entry.localOffset + 30 + u16le(lh, 26) + u16le(lh, 28);
    return readRange(blob, start, start + entry.compSize);
  }

  return { entries, read, readRaw };
}

/** Quick check whether a Blob looks like a ZIP. */
export async function isZip(blob) {
  if (blob.size < 22) return false;
  const h = await readRange(blob, 0, 4);
  return h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5 || h[2] === 7);
}
