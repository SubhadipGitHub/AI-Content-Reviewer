// Image cleaners. PNG/JPEG/WebP are rewritten losslessly at the container level
// (pixel data is copied byte-for-byte). Removing the visible Gemini sparkle needs a
// pixel edit, so that path decodes, reverse-blends and re-encodes.

import { u32be, u16be, u32le, decodeLatin1, decodeUtf8, encodeUtf8, crc32, inflate } from '../lib/bytes.js';
import { PNG_AI_KEYS } from '../scan/rules.js';
import { rebuildTiff, editXmp, filterIim } from './meta.js';
import { mergeCounts } from './text.js';

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const be32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);

function pngChunk(type, data) {
  const body = concat([encodeUtf8(type), data]);
  return concat([be32(data.length), body, be32(crc32(body))]);
}

const XMP_KEY = 'XML:com.adobe.xmp';

/** @returns {Promise<{bytes: Uint8Array, removed: Record<string, number>}>} */
export async function cleanPng(b, items) {
  const removed = {};
  const parts = [b.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = decodeLatin1(b.subarray(o + 4, o + 8));
    const whole = b.subarray(o, o + 12 + len);
    const data = b.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const z = data.indexOf(0);
      const key = decodeLatin1(data.subarray(0, z));
      if (type === 'iTXt' && key === XMP_KEY) {
        const comp = data[z + 1];
        let p = z + 3;
        p = data.indexOf(0, p) + 1;
        p = data.indexOf(0, p) + 1;
        let xmlBytes = data.subarray(p);
        try { if (comp) xmlBytes = await inflate(xmlBytes, 16 << 20); } catch { parts.push(whole); continue; }
        const r = editXmp(decodeUtf8(xmlBytes), items);
        if (!Object.keys(r.removed).length) { parts.push(whole); continue; }
        mergeCounts(removed, r.removed);
        parts.push(pngChunk('iTXt', concat([encodeUtf8(XMP_KEY), new Uint8Array([0, 0, 0, 0, 0]), encodeUtf8(r.xml)])));
        continue;
      }
      let cat = null;
      if (PNG_AI_KEYS.some((k) => k.key.test(key))) cat = 'prompts';
      else if (/^aigc$/i.test(key)) cat = 'tc260';
      else if (/^(software|generator|source|creation software|tool)$/i.test(key)) cat = 'fingerprints';
      else if (/^(description|comment)$/i.test(key)) {
        let text = '';
        try { text = type === 'tEXt' ? decodeLatin1(data.subarray(z + 1)) : ''; } catch { /* compressed: treat as private */ }
        cat = /AIGC|ContentProducer/.test(text) ? 'tc260' : /Steps: \d+|Negative prompt:|--(?:ar|v) /.test(text) ? 'prompts' : /\b(?:ai[- ]generated|made with (?:google )?ai)\b/i.test(text) ? 'labels' : 'private';
      } else cat = 'private'; // Author, Title, Copyright, Creation Time, …
      if (cat && items.has(cat)) { removed[cat] = (removed[cat] || 0) + 1; continue; }
      parts.push(whole);
    } else if (type === 'eXIf') {
      const r = rebuildTiff(data, items);
      mergeCounts(removed, r.removed);
      if (r.bytes === data) parts.push(whole);
      else if (r.bytes) parts.push(pngChunk('eXIf', r.bytes));
    } else if (type === 'caBX') {
      if (items.has('c2pa')) { removed.c2pa = (removed.c2pa || 0) + 1; continue; }
      parts.push(whole);
    } else parts.push(whole);
    if (type === 'IEND') break;
  }
  return { bytes: Object.keys(removed).length ? concat(parts) : b, removed };
}

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT_SIG = 'http://ns.adobe.com/xmp/extension/\0';

function jpegSeg(marker, payload) {
  if (payload.length + 2 > 0xffff) return null;
  return concat([new Uint8Array([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
}

/** @returns {{bytes: Uint8Array, removed: Record<string, number>}} */
export function cleanJpeg(b, items) {
  const removed = {};
  const bump = (k, n = 1) => { removed[k] = (removed[k] || 0) + n; };
  const parts = [b.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) { parts.push(b.subarray(o)); o = b.length; break; }
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xda || m === 0xd9) { parts.push(b.subarray(o)); o = b.length; break; } // scan data onwards: copy verbatim
    if (m >= 0xd0 && m <= 0xd7) { parts.push(b.subarray(o, o + 2)); o += 2; continue; }
    const len = u16be(b, o + 2);
    const whole = b.subarray(o, o + 2 + len);
    const seg = b.subarray(o + 4, o + 2 + len);
    o += 2 + len;
    if (m === 0xe1 && decodeLatin1(seg.subarray(0, 6)) === 'Exif\0\0') {
      const tiff = seg.subarray(6);
      const r = rebuildTiff(tiff, items);
      mergeCounts(removed, r.removed);
      if (r.bytes === tiff) parts.push(whole);
      else if (r.bytes) { const s = jpegSeg(0xe1, concat([encodeUtf8('Exif\0\0'), r.bytes])); parts.push(s || whole); }
      continue;
    }
    if (m === 0xe1 && decodeLatin1(seg.subarray(0, XMP_SIG.length)) === XMP_SIG) {
      const r = editXmp(decodeUtf8(seg.subarray(XMP_SIG.length)), items);
      if (!Object.keys(r.removed).length) { parts.push(whole); continue; }
      mergeCounts(removed, r.removed);
      const s = jpegSeg(0xe1, concat([encodeUtf8(XMP_SIG), encodeUtf8(r.xml)]));
      if (s) parts.push(s);
      continue;
    }
    if (m === 0xe1 && decodeLatin1(seg.subarray(0, XMP_EXT_SIG.length)) === XMP_EXT_SIG) {
      // Extended XMP overflow: drop when cleaning XMP-held labels or private data
      if (items.has('labels') || items.has('private') || items.has('tc260')) { bump('private'); continue; }
      parts.push(whole);
      continue;
    }
    if (m === 0xed) {
      const r = filterIim(seg, items);
      mergeCounts(removed, r.removed);
      parts.push(r.seg === seg ? whole : jpegSeg(0xed, r.seg) || whole);
      continue;
    }
    if (m === 0xeb) { // APP11 JUMBF (C2PA)
      if (items.has('c2pa')) { bump('c2pa'); continue; }
      parts.push(whole);
      continue;
    }
    if (m === 0xfe) { // COM
      const t = decodeUtf8(seg);
      const cat = /AIGC|ContentProducer/.test(t) ? 'tc260' : /Steps: \d+|Negative prompt:/.test(t) ? 'prompts' : 'private';
      if (items.has(cat)) { bump(cat); continue; }
      parts.push(whole);
      continue;
    }
    // Bare TC260 label glued into another APP segment (e.g. APP1 "AIGC{…}")
    if (m >= 0xe2 && m <= 0xef && items.has('tc260') && /AIGC\s*\{/.test(decodeLatin1(seg.subarray(0, 64)))) { bump('tc260'); continue; }
    parts.push(whole);
  }
  return { bytes: Object.keys(removed).length ? concat(parts) : b, removed };
}

/** @returns {{bytes: Uint8Array, removed: Record<string, number>}} */
export function cleanWebp(b, items) {
  const removed = {};
  if (decodeLatin1(b.subarray(0, 4)) !== 'RIFF' || decodeLatin1(b.subarray(8, 12)) !== 'WEBP') return { bytes: b, removed };
  const chunks = [];
  let o = 12;
  while (o + 8 <= b.length) {
    const id = decodeLatin1(b.subarray(o, o + 4));
    const len = u32le(b, o + 4);
    const data = b.subarray(o + 8, o + 8 + len);
    chunks.push({ id, data });
    o += 8 + len + (len & 1);
  }
  const out = [];
  for (const c of chunks) {
    if (c.id === 'EXIF') {
      const hasHdr = decodeLatin1(c.data.subarray(0, 6)) === 'Exif\0\0';
      const tiff = hasHdr ? c.data.subarray(6) : c.data;
      const r = rebuildTiff(tiff, items);
      mergeCounts(removed, r.removed);
      if (r.bytes === tiff) out.push(c);
      else if (r.bytes) out.push({ id: 'EXIF', data: hasHdr ? concat([encodeUtf8('Exif\0\0'), r.bytes]) : r.bytes });
    } else if (c.id === 'XMP ') {
      const r = editXmp(decodeUtf8(c.data), items);
      mergeCounts(removed, r.removed);
      out.push(Object.keys(r.removed).length ? { id: 'XMP ', data: encodeUtf8(r.xml) } : c);
    } else if (c.id === 'C2PA') {
      if (items.has('c2pa')) removed.c2pa = (removed.c2pa || 0) + 1;
      else out.push(c);
    } else out.push(c);
  }
  if (!Object.keys(removed).length) return { bytes: b, removed };
  const vp8x = out.find((c) => c.id === 'VP8X');
  if (vp8x) {
    const d = Uint8Array.from(vp8x.data);
    d[0] = (d[0] & ~0x0c) | (out.some((c) => c.id === 'EXIF') ? 0x08 : 0) | (out.some((c) => c.id === 'XMP ') ? 0x04 : 0);
    vp8x.data = d;
  }
  const body = concat(out.flatMap((c) => [encodeUtf8(c.id), le32(c.data.length), c.data, c.data.length & 1 ? new Uint8Array([0]) : new Uint8Array()]));
  return { bytes: concat([encodeUtf8('RIFF'), le32(body.length + 4), encodeUtf8('WEBP'), body]), removed };
}
