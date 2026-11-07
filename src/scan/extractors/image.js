// Image metadata extraction: PNG text chunks, JPEG APP segments, EXIF/TIFF IFDs,
// WebP RIFF chunks, GIF comments, plus generic XMP/C2PA scanning for every format.

import { u16le, u32le, u16be, u32be, decodeLatin1, decodeUtf8, decodeUtf16, inflate, indexOfBytes } from '../../lib/bytes.js';
import { checkFields, genericBinaryScan, checkAigcLabel } from '../detectors/metadata.js';
import { detectVisibleMarks } from '../detectors/visible-marks.js';
import { cornerPixels, PIXEL_FORMATS } from '../pixels.js';
import { rgbaToDataUrl } from '../../samples/builders.js';
import { PNG_AI_KEYS, AI_DIMENSIONS } from '../rules.js';
import { finding } from '../findings.js';

const EXIF_TAGS = {
  0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'DateTime',
  0x013b: 'Artist', 0x8298: 'Copyright', 0x9286: 'UserComment', 0x9c9b: 'XPTitle', 0x9c9c: 'XPComment',
  0x9c9d: 'XPAuthor', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject', 0x829a: 'ExposureTime', 0x829d: 'FNumber',
  0x8827: 'ISO', 0x920a: 'FocalLength', 0xa433: 'LensMake', 0xa434: 'LensModel', 0x9003: 'DateTimeOriginal',
  0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension',
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Parse a TIFF/EXIF block. Returns a flat tag-name → value map. */
export function parseTiff(b) {
  const out = {};
  if (b.length < 8) return out;
  const le = b[0] === 0x49;
  const r16 = (o) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o) => (le ? u32le(b, o) : u32be(b, o));
  const visited = new Set();
  const readIfd = (off, depth) => {
    if (depth > 4 || off <= 0 || off + 2 > b.length || visited.has(off)) return;
    visited.add(off);
    const n = r16(off);
    for (let i = 0; i < n && off + 2 + i * 12 + 12 <= b.length; i++) {
      const e = off + 2 + i * 12;
      const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const vo = size <= 4 ? e + 8 : r32(e + 8);
      if (tag === 0x8769 || tag === 0x8825) { // Exif / GPS sub-IFD
        if (tag === 0x8825) out.GPS = 'present';
        readIfd(r32(e + 8), depth + 1);
        continue;
      }
      const name = EXIF_TAGS[tag];
      if (!name || vo + size > b.length) continue;
      const raw = b.subarray(vo, vo + Math.min(size, 64 * 1024));
      let val;
      if (type === 2) val = decodeLatin1(raw).replace(/\0+$/, '');
      else if (tag >= 0x9c9b && tag <= 0x9c9f) val = decodeUtf16(raw, true).replace(/\0+$/, '');
      else if (tag === 0x9286) {
        const code = decodeLatin1(raw.subarray(0, 8));
        const body = raw.subarray(8);
        val = (code.startsWith('UNICODE') ? decodeUtf16(body, !(body[0] === 0 && body[1] !== 0)) : decodeUtf8(body)).replace(/\0+/g, '').trim();
      } else if (type === 3) val = r16(vo);
      else if (type === 4) val = r32(vo);
      else if (type === 5 || type === 10) val = `${r32(vo)}/${r32(vo + 4)}`;
      else continue;
      if (val !== '' && val != null) out[name] = val;
    }
    const next = off + 2 + n * 12;
    if (depth === 0 && next + 4 <= b.length) readIfd(r32(next), depth + 1);
  };
  readIfd(r32(4), 0);
  return out;
}

async function parsePng(b, meta, fields) {
  const text = {};
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = decodeLatin1(b.subarray(o + 4, o + 8));
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { meta.width = u32be(data, 0); meta.height = u32be(data, 4); }
    else if (type === 'tEXt') {
      const z = data.indexOf(0);
      text[decodeLatin1(data.subarray(0, z))] = decodeLatin1(data.subarray(z + 1));
    } else if (type === 'zTXt') {
      const z = data.indexOf(0);
      try { text[decodeLatin1(data.subarray(0, z))] = decodeLatin1(await inflate(data.subarray(z + 2), 8 << 20)); } catch { /* ignore */ }
    } else if (type === 'iTXt') {
      const z = data.indexOf(0);
      const key = decodeUtf8(data.subarray(0, z));
      const comp = data[z + 1];
      let p = z + 3;
      p = data.indexOf(0, p) + 1; // language
      p = data.indexOf(0, p) + 1; // translated keyword
      let body = data.subarray(p);
      try { if (comp) body = await inflate(body, 8 << 20); } catch { body = new Uint8Array(); }
      text[key] = decodeUtf8(body);
    } else if (type === 'eXIf') Object.assign(fields, parseTiff(data));
    else if (type === 'caBX') meta.c2paChunk = true;
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  meta.textChunks = Object.keys(text);
  return text;
}

const IIM = { 25: 'Keywords', 80: 'byline', 105: 'Headline', 110: 'Credit', 115: 'Source', 116: 'CopyrightNotice', 120: 'Caption' };

/** IPTC-IIM records inside a Photoshop APP13 segment (8BIM resource 0x0404). */
export function parseIptcIim(seg) {
  const out = {};
  if (decodeLatin1(seg.subarray(0, 14)) !== 'Photoshop 3.0\0') return out;
  let o = 14;
  while (o + 12 <= seg.length && decodeLatin1(seg.subarray(o, o + 4)) === '8BIM') {
    const id = u16be(seg, o + 4);
    let p = o + 6;
    const nameLen = seg[p];
    p += 1 + nameLen + ((nameLen + 1) % 2);
    const size = u32be(seg, p);
    p += 4;
    if (id === 0x0404) {
      let q = p;
      while (q + 5 <= p + size && seg[q] === 0x1c) {
        const rec = seg[q + 1], ds = seg[q + 2], len = u16be(seg, q + 3);
        const name = rec === 2 && IIM[ds];
        if (name) {
          const v = decodeUtf8(seg.subarray(q + 5, q + 5 + len)).trim();
          out[name] = out[name] ? `${out[name]}, ${v}` : v;
        }
        q += 5 + len;
      }
    }
    o = p + size + (size % 2);
  }
  return out;
}

function parseJpeg(b, meta, fields, iptc) {
  let o = 2;
  const comments = [];
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xd9 || m === 0xda) break; // EOI / start of scan
    if (m >= 0xd0 && m <= 0xd7) { o += 2; continue; }
    const len = u16be(b, o + 2);
    const seg = b.subarray(o + 4, o + 2 + len);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      meta.height = u16be(seg, 1); meta.width = u16be(seg, 3);
    } else if (m === 0xe1 && decodeLatin1(seg.subarray(0, 6)) === 'Exif\0\0') {
      Object.assign(fields, parseTiff(seg.subarray(6)));
    } else if (m === 0xed) Object.assign(iptc, parseIptcIim(seg));
    else if (m === 0xfe) comments.push(decodeUtf8(seg));
    else if (m === 0xeb) meta.c2paSegment = true;
    o += 2 + len;
  }
  if (comments.length) fields.Comment = comments.join(' | ');
}

function parseWebp(b, meta, fields) {
  let o = 12;
  while (o + 8 <= b.length) {
    const id = decodeLatin1(b.subarray(o, o + 4));
    const len = u32le(b, o + 4);
    const d = b.subarray(o + 8, o + 8 + len);
    if (id === 'VP8X') { meta.width = 1 + (d[4] | (d[5] << 8) | (d[6] << 16)); meta.height = 1 + (d[7] | (d[8] << 8) | (d[9] << 16)); }
    else if (id === 'VP8 ' && !meta.width) { meta.width = u16le(d, 6) & 0x3fff; meta.height = u16le(d, 8) & 0x3fff; }
    else if (id === 'VP8L' && !meta.width) { const v = u32le(d, 1); meta.width = (v & 0x3fff) + 1; meta.height = ((v >> 14) & 0x3fff) + 1; }
    else if (id === 'EXIF') {
      const s = decodeLatin1(d.subarray(0, 6)) === 'Exif\0\0' ? d.subarray(6) : d;
      Object.assign(fields, parseTiff(s));
    }
    o += 8 + len + (len & 1);
  }
}

function parseGif(b, meta, fields) {
  meta.width = u16le(b, 6); meta.height = u16le(b, 8);
  const comments = [];
  let i = indexOfBytes(b, new Uint8Array([0x21, 0xfe]));
  while (i >= 0 && comments.length < 5) {
    let p = i + 2, s = '';
    while (p < b.length && b[p]) { s += decodeLatin1(b.subarray(p + 1, p + 1 + b[p])); p += b[p] + 1; }
    comments.push(s);
    i = indexOfBytes(b, new Uint8Array([0x21, 0xfe]), p);
  }
  if (comments.length) fields.Comment = comments.join(' | ');
}

/**
 * @param {Uint8Array} b  image bytes (or head+tail for very large files)
 * @param {string} format png|jpeg|webp|gif|tiff|heic|avif|bmp
 */
export async function scanImage(b, format, blob = null) {
  const meta = { format };
  const fields = {};
  const iptc = {};
  const findings = [];
  const notes = [];
  let needsPixels = false;
  let pngText = {};
  try {
    if (format === 'png') pngText = await parsePng(b, meta, fields);
    else if (format === 'jpeg') parseJpeg(b, meta, fields, iptc);
    else if (format === 'webp') parseWebp(b, meta, fields);
    else if (format === 'gif') parseGif(b, meta, fields);
    else if (format === 'tiff') Object.assign(fields, parseTiff(b));
  } catch (e) {
    meta.parseError = String(e.message || e);
  }

  // PNG generator keys (A1111 "parameters", ComfyUI "prompt"/"workflow", …)
  const tools = new Set();
  for (const key of Object.keys(pngText)) {
    const hit = PNG_AI_KEYS.find((k) => k.key.test(key));
    if (hit && !tools.has(hit.tool)) {
      tools.add(hit.tool);
      findings.push(finding({
        id: `prov.png.${key.toLowerCase()}`, category: 'provenance', strength: 'strong',
        title: `${hit.tool} generation data embedded`,
        detail: `PNG text chunk "${key}" (${pngText[key].length.toLocaleString('en')} characters)`,
        why: 'Stable Diffusion front-ends save the full prompt, seed, sampler and model in PNG text chunks so images can be reproduced. Only generated images carry these.',
        evidence: [{ text: pngText[key].slice(0, 500) + (pngText[key].length > 500 ? '…' : '') }],
        location: `PNG chunk ${key}`,
      }));
    }
  }
  // Remaining PNG text (Software, Description, Comment, XML:com.adobe.xmp handled by generic scan)
  const pngFields = {};
  for (const [k, v] of Object.entries(pngText)) if (!PNG_AI_KEYS.some((x) => x.key.test(k)) && !k.startsWith('XML:')) pngFields[k] = v;
  findings.push(...checkFields(pngFields, 'PNG text'));
  findings.push(...checkFields(fields, format === 'png' ? 'EXIF' : 'EXIF/metadata'));
  if (Object.keys(iptc).length) findings.push(...checkFields(iptc, 'IPTC'));

  // xAI Grok signs its images in EXIF: ImageDescription "Signature: <base64>" + UUID Artist.
  if (/^Signature: [A-Za-z0-9+/=]{40,}/.test(String(fields.ImageDescription || '')) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(fields.Artist || ''))) {
    findings.push(finding({
      id: 'meta.grok', category: 'metadata', strength: 'strong',
      title: 'xAI Grok image signature in EXIF',
      detail: `Artist: ${fields.Artist}\nImageDescription: ${String(fields.ImageDescription).slice(0, 60)}…`,
      why: 'Images generated by Grok (Aurora / Grok Imagine) carry a generation UUID in EXIF Artist and a signed "Signature:" string in ImageDescription.',
      evidence: [{ text: String(fields.ImageDescription).slice(0, 200) }], location: 'EXIF',
    }));
  }

  // China TC260 AIGC implicit label (XMP, PNG chunk, EXIF JSON)
  const aigc = checkAigcLabel(b, 'Image metadata');
  if (!aigc.length && Object.keys(pngText).length) aigc.push(...checkAigcLabel(Object.entries(pngText).map(([k, v]) => `${k} ${v}`).join('\n'), 'PNG text'));
  if (!aigc.length && (fields.UserComment || fields.ImageDescription)) aigc.push(...checkAigcLabel(`${fields.UserComment || ''} ${fields.ImageDescription || ''}`, 'EXIF'));
  findings.push(...aigc);

  const g = genericBinaryScan(b, format.toUpperCase());
  findings.push(...g.findings);

  // Camera evidence (context) and generator-typical dimensions (weak).
  const camera = fields.Make || fields.Model;
  const exposure = fields.ExposureTime || fields.FNumber || fields.ISO || fields.FocalLength;
  if (camera && exposure) {
    findings.push(finding({
      id: 'ctx.camera', category: 'context', strength: 'info',
      title: `Camera capture data present (${fields.Model && fields.Make && String(fields.Model).startsWith(fields.Make) ? fields.Model : [fields.Make, fields.Model].filter(Boolean).join(' ')})`,
      detail: [fields.LensModel && `Lens ${fields.LensModel}`, fields.ExposureTime && `Exposure ${fields.ExposureTime}`, fields.FNumber && `f/${fields.FNumber}`, fields.ISO && `ISO ${fields.ISO}`, fields.GPS && 'GPS data present'].filter(Boolean).join(' · '),
      why: 'Real exposure settings from a camera are typical of photographs. EXIF can be forged, so this is context rather than proof.',
      location: 'EXIF',
    }));
  }
  if (meta.width && meta.height) {
    const dim = `${meta.width}x${meta.height}`;
    if (!camera && AI_DIMENSIONS.has(dim)) {
      findings.push(finding({
        id: 'meta.dimensions', category: 'metadata', strength: 'weak',
        title: `Generator-typical resolution (${meta.width}×${meta.height}) with no camera data`,
        detail: 'This exact size is a default output of popular image generators and the file has no camera EXIF.',
        why: 'Generators output fixed sizes such as 1024×1024 or 1792×1024. Plenty of non-AI images share these sizes, so this only corroborates other signals.',
        location: 'Image header',
      }));
    }
  }
  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    if (!camera && !Object.keys(fields).length && !Object.keys(pngText).length && !g.findings.length) meta.stripped = true;
  }
  // Visible watermarks (Gemini sparkle, DALL·E bar) from pixels
  if (PIXEL_FORMATS.has(format)) {
    try {
      const px = await cornerPixels(blob, b, format);
      if (px) {
        const v = await detectVisibleMarks(px.data, px.width, px.height, px.W, px.H, rgbaToDataUrl);
        findings.push(...v.findings);
        if (v.debug) meta.watermarkScan = { template: v.debug.template, match: +v.debug.spatial.toFixed(2), edges: +v.debug.grad.toFixed(2), restore: +v.debug.ratio.toFixed(2) };
      } else needsPixels = true;
    } catch { needsPixels = true; }
  }
  if (!findings.some((f) => /gemini|google/i.test(f.title) || f.id === 'watermark.gemini')) {
    notes.push('Invisible watermarks (Google SynthID, Meta, OpenAI) are hidden in the pixels and can\'t be read offline. To check for SynthID, upload the image to the Gemini app and ask whether it was made with Google AI.');
  }
  if (iptc && Object.keys(iptc).length) meta.iptc = iptc;
  return { findings, notes, needsPixels, meta: { ...meta, exif: fields, xmp: g.meta, pngText: Object.fromEntries(Object.entries(pngText).map(([k, v]) => [k, v.slice(0, 2000)])) } };
}
