// Metadata editors shared by the image/document cleaners:
//  - rebuildTiff: rewrite an EXIF/TIFF block keeping only allowed tags
//  - editXmp: remove XMP properties by category
//  - filterIim: drop IPTC-IIM records by category

import { u16le, u32le, u16be, u32be, decodeLatin1, decodeUtf8, decodeUtf16, encodeUtf8 } from '../lib/bytes.js';
import { GEN_PARAMS } from '../scan/rules.js';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const AI_LABEL_TEXT = /\b(?:ai[- ]generated|made with (?:google )?ai|generated (?:by|with|using) (?:ai|artificial intelligence)|trainedAlgorithmicMedia|synthetic(?:ally generated)? (?:image|media|content))\b/i;
const AIGC_JSON = /"?AIGC"?\s*[:{]|"ContentProducer"|"ProduceID"/;
const GROK_SIG = /^Signature: [A-Za-z0-9+/=]{40,}/;

const isGenParams = (v) => GEN_PARAMS.some((g) => g.re.test(v));

/**
 * Decide what happens to an EXIF tag. Returns the removal item key, or null to keep.
 * @param {number} tag @param {string|number} value @param {'ifd0'|'exif'|'gps'} ifd
 */
export function exifTagCategory(tag, value, ifd) {
  if (ifd === 'gps') return 'private';
  const v = typeof value === 'string' ? value : '';
  switch (tag) {
    case 0x0131: case 0x000b: case 0x013c: return 'fingerprints'; // Software, ProcessingSoftware, HostComputer
    case 0x010e: // ImageDescription
    case 0x9286: // UserComment
    case 0x9c9c: // XPComment
      if (AIGC_JSON.test(v)) return 'tc260';
      if (GROK_SIG.test(v)) return 'fingerprints';
      if (isGenParams(v)) return 'prompts';
      if (AI_LABEL_TEXT.test(v)) return 'labels';
      return 'private';
    case 0x013b: // Artist
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? 'fingerprints' : 'private';
    case 0x9c9b: case 0x9c9d: case 0x9c9e: case 0x9c9f: // XPTitle/Author/Keywords/Subject
    case 0xa430: case 0xa431: case 0xa435: case 0xa420: // owner, body serial, lens serial, unique id
      return 'private';
    case 0x927c: return 'private'; // MakerNote (vendor data, often serials)
    default: return null;
  }
}

function readValue(b, le, type, count, vo) {
  const size = (TYPE_SIZE[type] || 1) * count;
  const raw = b.subarray(vo, vo + size);
  if (type === 2) return decodeLatin1(raw).replace(/\0+$/, '');
  if (type === 7 && raw.length > 8) {
    const code = decodeLatin1(raw.subarray(0, 8));
    const body = raw.subarray(8);
    return (code.startsWith('UNICODE') ? decodeUtf16(body, le) : decodeUtf8(body)).replace(/\0+/g, '');
  }
  if (type === 1 && count > 2 && raw.length % 2 === 0) return decodeUtf16(raw, true).replace(/\0+$/, ''); // XP* tags
  return '';
}

/**
 * Rewrite a TIFF/EXIF block keeping IFD0, the Exif sub-IFD and GPS IFD minus removed tags.
 * Thumbnails (IFD1) and Interop/MakerNote pointers are dropped.
 * @param {Uint8Array} b TIFF bytes (no "Exif\0\0" prefix)
 * @param {Set<string>} items removal item keys
 * @returns {{bytes: Uint8Array|null, removed: Record<string, number>}}
 */
export function rebuildTiff(b, items) {
  const removed = {};
  if (b.length < 8) return { bytes: b, removed };
  const le = b[0] === 0x49;
  const r16 = (o) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o) => (le ? u32le(b, o) : u32be(b, o));

  const readIfd = (off, kind) => {
    const entries = [];
    let exifPtr = 0, gpsPtr = 0;
    if (off <= 0 || off + 2 > b.length) return { entries, exifPtr, gpsPtr };
    const n = r16(off);
    for (let i = 0; i < n && off + 2 + i * 12 + 12 <= b.length; i++) {
      const e = off + 2 + i * 12;
      const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const vo = size <= 4 ? e + 8 : r32(e + 8);
      if (tag === 0x8769) { exifPtr = r32(e + 8); continue; }
      if (tag === 0x8825) { gpsPtr = r32(e + 8); continue; }
      if (tag === 0xa005 || tag === 0x927c && items.has('private')) { if (tag === 0x927c) removed.private = (removed.private || 0) + 1; continue; }
      if (vo + size > b.length || size > 1 << 20) continue;
      const cat = exifTagCategory(tag, readValue(b, le, type, count, vo), kind);
      if (cat && items.has(cat)) { removed[cat] = (removed[cat] || 0) + 1; continue; }
      // Keep raw value bytes; re-encode multi-byte values in little-endian.
      const raw = new Uint8Array(size);
      const unit = TYPE_SIZE[type] || 1;
      const swapUnit = type === 5 || type === 10 ? 4 : unit;
      for (let k = 0; k < size; k += swapUnit) {
        for (let j = 0; j < swapUnit; j++) raw[k + j] = le ? b[vo + k + j] : b[vo + k + swapUnit - 1 - j];
      }
      entries.push({ tag, type, count, raw });
    }
    return { entries, exifPtr, gpsPtr };
  };

  const ifd0 = readIfd(r32(4), 'ifd0');
  const exif = ifd0.exifPtr ? readIfd(ifd0.exifPtr, 'exif') : { entries: [] };
  const gps = ifd0.gpsPtr ? readIfd(ifd0.gpsPtr, 'gps') : { entries: [] };
  if (ifd0.gpsPtr && items.has('private')) { removed.private = (removed.private || 0) + 1; gps.entries = []; }
  if (!Object.keys(removed).length) return { bytes: b, removed };

  // Serialise (little-endian)
  const ifds = [{ e: ifd0.entries, ptrs: [] }];
  if (exif.entries.length) ifds[0].ptrs.push(0x8769);
  if (gps.entries.length) ifds[0].ptrs.push(0x8825);
  const sub = { 0x8769: exif.entries, 0x8825: gps.entries };
  if (!ifd0.entries.length && !exif.entries.length && !gps.entries.length) return { bytes: null, removed };

  const out = [];
  let size = 8;
  const layout = (entries) => 2 + entries.length * 12 + 4;
  const ifd0Entries = [...ifd0.entries, ...ifds[0].ptrs.map((t) => ({ tag: t, type: 4, count: 1, ptr: true }))].sort((a, c) => a.tag - c.tag);
  const order = [{ key: 'ifd0', entries: ifd0Entries }, ...ifds[0].ptrs.map((t) => ({ key: t, entries: sub[t].sort((a, c) => a.tag - c.tag) }))];
  const offsets = {};
  for (const o of order) { offsets[o.key] = size; size += layout(o.entries); }
  let dataOff = size;
  const bufLen = dataOff + order.reduce((a, o) => a + o.entries.reduce((s, e) => s + (e.raw && e.raw.length > 4 ? e.raw.length + (e.raw.length & 1) : 0), 0), 0);
  const buf = new Uint8Array(bufLen);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 0x2a, 0]);
  dv.setUint32(4, 8, true);
  for (const o of order) {
    let p = offsets[o.key];
    dv.setUint16(p, o.entries.length, true);
    p += 2;
    for (const e of o.entries) {
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.count, true);
      if (e.ptr) dv.setUint32(p + 8, offsets[e.tag], true);
      else if (e.raw.length <= 4) buf.set(e.raw, p + 8);
      else { dv.setUint32(p + 8, dataOff, true); buf.set(e.raw, dataOff); dataOff += e.raw.length + (e.raw.length & 1); }
      p += 12;
    }
    dv.setUint32(p, 0, true);
  }
  out.push(buf);
  return { bytes: buf, removed };
}

// ───────── XMP ─────────
const XMP_PROPS = {
  fingerprints: ['xmp:CreatorTool', 'tiff:Software', 'pdf:Producer', 'xmpMM:History', 'photoshop:History'],
  private: ['dc:creator', 'photoshop:AuthorsPosition', 'photoshop:CaptionWriter', 'Iptc4xmpCore:CreatorContactInfo', 'dc:rights', 'xmpRights:Owner', 'exif:UserComment', 'dc:description', 'dc:subject', 'photoshop:Headline', 'photoshop:Instructions', 'exif:GPSLatitude', 'exif:GPSLongitude', 'exif:GPSAltitude', 'exif:GPSTimeStamp', 'exifEX:BodySerialNumber', 'aux:SerialNumber', 'exifEX:LensSerialNumber'],
  labels: ['Iptc4xmpExt:DigitalSourceType', 'Iptc4xmpExt:AISystemUsed', 'Iptc4xmpExt:AISystemVersionUsed', 'Iptc4xmpExt:AIPromptInformation', 'Iptc4xmpExt:AIPromptWriterName', 'photoshop:Credit'],
  tc260: ['TC260:AIGC'],
  c2pa: ['dcterms:provenance'],
};

function removeProp(xml, name) {
  const esc = name.replace(/[.:]/g, (c) => '\\' + c);
  let n = 0;
  const count = (re) => (s) => { xml = xml.replace(re, () => { n++; return ''; }); };
  count(new RegExp(`\\s${esc}="[^"]*"`, 'g'))();
  count(new RegExp(`<${esc}\\b[^>]*/>`, 'g'))();
  count(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?</${esc}>`, 'g'))();
  return { xml, n };
}

/**
 * Remove XMP properties for the selected item keys. `photoshop:Credit` and descriptions
 * are classified by content (an AI label vs. ordinary credit/prompt text).
 */
export function editXmp(xml, items) {
  const removed = {};
  const bump = (k, n) => { if (n) removed[k] = (removed[k] || 0) + n; };
  // Content-classified properties first
  for (const name of ['photoshop:Credit', 'dc:description', 'exif:UserComment']) {
    const esc = name.replace(/[.:]/g, (c) => '\\' + c);
    const reEl = new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*?)</${esc}>|\\s${esc}="([^"]*)"`, 'g');
    xml = xml.replace(reEl, (m, a, b2) => {
      const v = (a ?? b2 ?? '').replace(/<[^>]+>/g, ' ');
      const cat = AIGC_JSON.test(v) ? 'tc260' : isGenParams(v) ? 'prompts' : AI_LABEL_TEXT.test(v) ? 'labels' : name === 'photoshop:Credit' ? null : 'private';
      if (cat && items.has(cat)) { bump(cat, 1); return ''; }
      return m;
    });
  }
  for (const [cat, props] of Object.entries(XMP_PROPS)) {
    if (!items.has(cat)) continue;
    for (const p of props) {
      if (p === 'photoshop:Credit' || p === 'dc:description' || p === 'exif:UserComment') continue;
      const r = removeProp(xml, p);
      xml = r.xml;
      bump(cat, r.n);
    }
  }
  // Generic "AIGC" XMP elements that are not namespaced TC260
  if (items.has('tc260')) {
    xml = xml.replace(/<(\w+:AIGC)\b[^>]*>[\s\S]*?<\/\1>|\s\w+:AIGC="[^"]*"/g, () => { bump('tc260', 1); return ''; });
  }
  return { xml, removed };
}

// ───────── IPTC-IIM (Photoshop APP13) ─────────
const IIM_CAT = (ds, v) => {
  if (ds === 110 || ds === 115) return AI_LABEL_TEXT.test(v) ? 'labels' : ds === 110 ? null : 'private'; // Credit, Source
  if (ds === 120) return isGenParams(v) ? 'prompts' : AI_LABEL_TEXT.test(v) ? 'labels' : 'private'; // Caption
  if (ds === 80 || ds === 85 || ds === 122) return 'private'; // By-line, title, writer
  return null;
};

/** Filter IIM records in an APP13 payload. Returns new payload (or null to drop the segment). */
export function filterIim(seg, items) {
  const removed = {};
  if (decodeLatin1(seg.subarray(0, 14)) !== 'Photoshop 3.0\0') return { seg, removed };
  const parts = [seg.subarray(0, 14)];
  let o = 14;
  while (o + 12 <= seg.length && decodeLatin1(seg.subarray(o, o + 4)) === '8BIM') {
    const id = u16be(seg, o + 4);
    let p = o + 6;
    const nameLen = seg[p];
    p += 1 + nameLen + ((nameLen + 1) % 2);
    const size = u32be(seg, p);
    const dataStart = p + 4;
    const end = dataStart + size + (size % 2);
    if (id === 0x0404) {
      const recs = [];
      let q = dataStart;
      while (q + 5 <= dataStart + size && seg[q] === 0x1c) {
        const ds = seg[q + 2], len = u16be(seg, q + 3);
        const rec = seg.subarray(q, q + 5 + len);
        const cat = seg[q + 1] === 2 ? IIM_CAT(ds, decodeUtf8(seg.subarray(q + 5, q + 5 + len))) : null;
        if (cat && items.has(cat)) removed[cat] = (removed[cat] || 0) + 1;
        else recs.push(rec);
        q += 5 + len;
      }
      const body = new Uint8Array(recs.reduce((a, r) => a + r.length, 0));
      let k = 0;
      for (const r of recs) { body.set(r, k); k += r.length; }
      const head = seg.slice(o, p);
      const sz = new Uint8Array([(body.length >>> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]);
      parts.push(head, sz, body, body.length % 2 ? new Uint8Array([0]) : new Uint8Array());
    } else parts.push(seg.subarray(o, end));
    o = end;
  }
  if (!Object.keys(removed).length) return { seg, removed };
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let k = 0;
  for (const x of parts) { out.set(x, k); k += x.length; }
  return { seg: out, removed };
}

export { encodeUtf8 };
