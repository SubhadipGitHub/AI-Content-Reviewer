// Cleaner entry point: dispatch by file type, recurse into archives, report what changed.
import { sniff, LIMITS } from '../scan/engine.js';
import { openZip } from '../scan/zipreader.js';
import { REPO_MARKERS, CODE_EXTENSIONS } from '../scan/rules.js';
import { decodeText } from '../scan/extractors/text.js';
import { encodeUtf8 } from '../lib/bytes.js';
import { writeZip } from '../lib/zipwrite.js';
import { cleanText, cleanAttribution, manualPhrases, mergeCounts } from './text.js';
import { cleanPng, cleanJpeg, cleanWebp } from './images.js';
import { cleanOffice } from './office.js';
import { outputName, ITEMS } from './catalog.js';

function cleanTextFile(bytes, ext, items) {
  const hadBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const isUtf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  let text = decodeText(bytes);
  const removed = {};
  const notes = [];
  if (ext === 'ipynb') {
    try {
      const nb = JSON.parse(text);
      const walk = (v) => {
        if (typeof v === 'string') {
          let s = v;
          const r = cleanText(s, items); s = r.text; mergeCounts(removed, r.removed);
          if (items.has('attribution')) { const a = cleanAttribution(s); s = a.text; if (a.n) mergeCounts(removed, { attribution: a.n }); }
          return s;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
      };
      const out = walk(nb);
      return { bytes: Object.keys(removed).length ? encodeUtf8(JSON.stringify(out, null, 1) + '\n') : bytes, removed, manual: manualPhrases(text, 'notebook'), notes };
    } catch { /* fall through to plain text */ }
  }
  const r = cleanText(text, items);
  text = r.text;
  mergeCounts(removed, r.removed);
  if (items.has('fingerprints') && /^(html?|svg)$/.test(ext)) {
    text = text.replace(/<meta\s+[^>]*name=["']generator["'][^>]*>\s*/gi, () => { mergeCounts(removed, { fingerprints: 1 }); return ''; });
  }
  if (items.has('attribution') && (CODE_EXTENSIONS.has(ext) || /^(md|txt|commit_editmsg|)$/.test(ext))) {
    const a = cleanAttribution(text);
    text = a.text;
    if (a.n) mergeCounts(removed, { attribution: a.n });
  }
  if (isUtf16 && Object.keys(removed).length) notes.push('Saved as UTF-8 (the original was UTF-16).');
  const out = Object.keys(removed).length ? encodeUtf8((hadBom || isUtf16 ? '﻿' : '') + text.replace(/^﻿/, '')) : bytes;
  return { bytes: out, removed, manual: manualPhrases(text, 'text'), notes };
}

async function cleanArchive(blob, items, depth) {
  const zip = await openZip(blob);
  const removed = {};
  const manual = [];
  const notes = [];
  const out = [];
  let changed = false;
  for (const e of zip.entries) {
    if (e.dir) continue;
    if (items.has('repoFiles') && REPO_MARKERS.some((r) => r.re.test(e.name))) { mergeCounts(removed, { repoFiles: 1 }); changed = true; continue; }
    const passthrough = async () => out.push({ name: e.name, passthrough: { data: await zip.readRaw(e), method: e.method, crc: e.crc, size: e.size, flags: e.flags } });
    if (e.encrypted || e.size > LIMITS.maxEntrySize || depth >= LIMITS.maxDepth || (e.method !== 0 && e.method !== 8)) {
      await passthrough();
      if (e.encrypted) notes.push(`Encrypted entry kept unchanged: ${e.name}`);
      continue;
    }
    const data = await zip.read(e, LIMITS.maxEntrySize);
    const r = await cleanBytes(data, e.name, items, depth + 1);
    mergeCounts(removed, r.removed);
    manual.push(...(r.manual || []).map((m) => ({ ...m, where: `${e.name}: ${m.where}` })));
    notes.push(...(r.notes || []).map((n) => `${e.name}: ${n}`));
    if (r.bytes !== data) changed = true;
    out.push({ name: r.ext ? e.name.replace(/\.[^./]*$/, '') + '.' + r.ext : e.name, data: r.bytes });
  }
  if (!changed) return { bytes: null, removed, manual, notes };
  return { bytes: await writeZip(out), removed, manual, notes };
}

/**
 * Clean raw bytes. Returns the same `bytes` object when nothing changed.
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {Set<string>} items
 * @returns {Promise<{bytes: Uint8Array, ext?: string, removed: Record<string, number>, manual?: any[], notes?: string[]}>}
 */
export async function cleanBytes(bytes, name, items, depth = 0) {
  const blob = new Blob([bytes]);
  const t = await sniff(blob, name);
  const notes = [];
  if (t.kind === 'image') {
    if (items.has('sparkle') && /^(png|jpeg|webp)$/.test(t.format)) {
      const { decodeFull, removeSparkle, encodeImage } = await import('./pixels.js');
      const px = await decodeFull(blob, bytes, t.format);
      if (px) {
        const r = removeSparkle(px.data, px.W, px.H);
        if (r.removed) {
          const enc = await encodeImage(px.data, px.W, px.H, t.format);
          notes.push(`Removed the ${r.detail}. The image was re-encoded${enc.lossy ? ' at high quality' : ' losslessly'}${enc.converted ? ' as PNG' : ''}; other metadata was dropped.`);
          return { bytes: enc.bytes, ext: enc.converted ? enc.ext : undefined, removed: { sparkle: 1 }, notes };
        }
      } else notes.push('This browser could not decode the image to remove the visible watermark.');
    }
    let r;
    if (t.format === 'png') r = await cleanPng(bytes, items);
    else if (t.format === 'jpeg') r = cleanJpeg(bytes, items);
    else if (t.format === 'webp') r = cleanWebp(bytes, items);
    else {
      notes.push(`${t.format.toUpperCase()} metadata can't be cleaned in place. Convert the image to PNG or JPEG first.`);
      return { bytes, removed: {}, notes };
    }
    return { bytes: r.bytes, removed: r.removed, notes };
  }
  if (t.kind === 'text') {
    const ext = name.split('/').pop().toLowerCase().split('.').slice(1).pop() || '';
    return cleanTextFile(bytes, t.format === 'commit_editmsg' ? 'commit_editmsg' : ext, items);
  }
  if (t.kind === 'pdf') {
    const { cleanPdf } = await import('./pdf.js');
    const r = await cleanPdf(bytes, items);
    return { bytes: r.bytes || bytes, removed: r.removed, notes: [...notes, ...r.notes] };
  }
  if (t.kind === 'zip') {
    const zip = await openZip(blob);
    const names = zip.entries.map((e) => e.name);
    const hasCT = names.includes('[Content_Types].xml');
    const kind = hasCT && names.some((n) => n.startsWith('word/')) ? 'docx' : hasCT && names.some((n) => n.startsWith('xl/')) ? 'xlsx' : hasCT && names.some((n) => n.startsWith('ppt/')) ? 'pptx' : names.includes('mimetype') && names.includes('content.xml') ? 'odf' : null;
    if (kind) {
      // Embedded media must keep its file name (relationships point at it), so skip format conversions.
      const r = await cleanOffice(zip, kind, items, async (data, n) => { const c = await cleanBytes(data, n, items, depth + 1); return c.ext ? null : c; });
      return { bytes: r.bytes || bytes, removed: r.removed, manual: r.manual, notes: r.notes };
    }
    const r = await cleanArchive(blob, items, depth);
    return { bytes: r.bytes || bytes, removed: r.removed, manual: r.manual, notes: r.notes };
  }
  notes.push(`${(t.format || 'This').toUpperCase()} files are not supported for cleaning yet.`);
  return { bytes, removed: {}, notes };
}

/**
 * Clean a file Blob.
 * @param {Blob} blob
 * @param {string} name
 * @param {{items: string[]}} opts
 */
export async function cleanBlob(blob, name, opts) {
  const items = new Set(opts.items || []);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const r = await cleanBytes(bytes, name, items, 0);
  const changed = r.bytes !== bytes;
  const removed = Object.entries(r.removed || {}).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count, label: ITEMS[key]?.label || key }));
  return {
    bytes: r.bytes,
    changed,
    name: outputName(name, r.ext),
    report: { removed, manual: r.manual || [], notes: [...new Set(r.notes || [])].slice(0, 20) },
  };
}
