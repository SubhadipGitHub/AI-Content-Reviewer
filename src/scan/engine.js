// Scan orchestrator: sniff a Blob, dispatch to an extractor, recurse into archives
// and embedded media, then score. Pure async JS: runs in a Web Worker and in Node tests.

import { readRange, decodeLatin1, extractStrings } from '../lib/bytes.js';
import { openZip } from './zipreader.js';
import { scanImage } from './extractors/image.js';
import { scanText, decodeText } from './extractors/text.js';
import { scanOffice } from './extractors/office.js';
import { scanPdf } from './extractors/pdf.js';
import { genericBinaryScan, checkFields } from './detectors/metadata.js';
import { detectArtifacts } from './detectors/text-artifacts.js';
import { finding } from './findings.js';
import { scoreNode } from './score.js';
import { REPO_MARKERS, TEXT_EXTENSIONS, CODE_EXTENSIONS, RULES_VERSION, AI_TOOLS } from './rules.js';

export const LIMITS = {
  maxDepth: 5,
  maxEntries: 5000,
  maxEntrySize: 200 * 1024 * 1024,
  maxTotalUncompressed: 2 * 1024 * 1024 * 1024,
  maxRatio: 250,
  textCap: 4 * 1024 * 1024,
  imageFull: 64 * 1024 * 1024,
  pdfMax: 400 * 1024 * 1024,
};

const SKIP_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.git\/objects\/|node_modules\/|\.venv\/|venv\/|__pycache__\/|\.next\/|dist\/assets\/.*\.map$)/;

export const ext = (name) => {
  const base = name.split('/').pop().toLowerCase();
  if (base === 'commit_editmsg') return 'commit_editmsg';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : '';
};

/** Determine a file's kind from magic bytes, falling back to extension. */
export async function sniff(blob, name) {
  const h = await readRange(blob, 0, Math.min(blob.size, 64));
  const e = ext(name);
  const s = decodeLatin1(h);
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { kind: 'image', format: 'png' };
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: 'image', format: 'jpeg' };
  if (s.startsWith('GIF8')) return { kind: 'image', format: 'gif' };
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return { kind: 'image', format: 'webp' };
  if (s.startsWith('II*\0') || s.startsWith('MM\0*')) return { kind: 'image', format: 'tiff' };
  if (s.startsWith('BM') && /^(bmp|dib)$/.test(e)) return { kind: 'image', format: 'bmp' };
  if (s.slice(4, 8) === 'ftyp') {
    const brand = s.slice(8, 12);
    if (/hei|hev|mif1|msf1/.test(brand)) return { kind: 'image', format: 'heic' };
    if (/avi[fs]/.test(brand)) return { kind: 'image', format: 'avif' };
    return { kind: 'media', format: brand.trim() || 'mp4' };
  }
  if (s.startsWith('%PDF')) return { kind: 'pdf', format: 'pdf' };
  if (h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5)) return { kind: 'zip', format: e || 'zip' };
  if (h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0) return { kind: 'binary', format: e || 'ole' };
  if (s.startsWith('ID3') || s.startsWith('OggS') || s.startsWith('fLaC') || (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') || s.startsWith('\x1aE\xdf\xa3')) return { kind: 'media', format: e || 'audio' };
  if (s.startsWith('{\\rtf')) return { kind: 'text', format: 'rtf' };
  if (/^(7z|rar|gz|tgz|bz2|xz|zst|tar)$/.test(e)) return { kind: 'binary', format: e };
  if (TEXT_EXTENSIONS.has(e) || CODE_EXTENSIONS.has(e) || e === 'commit_editmsg' || !e) {
    // Confirm it is text: few NULs/control chars in the head
    const sample = await readRange(blob, 0, Math.min(blob.size, 4096));
    let bad = 0;
    for (const c of sample) if (c === 0 || (c < 9) || (c > 13 && c < 32)) bad++;
    const utf16 = sample[0] === 0xff && sample[1] === 0xfe;
    if (utf16 || bad / (sample.length || 1) < 0.02) return { kind: 'text', format: e || 'txt' };
  }
  return { kind: 'binary', format: e || 'bin' };
}

function mkNode(name, path, size) {
  return { name, path, size, kind: 'unknown', format: '', findings: [], children: [], meta: {}, notes: [] };
}

/**
 * Scan a Blob.
 * @param {Blob} blob
 * @param {string} name file name (may include archive path)
 * @param {{ depth?: number, path?: string, onProgress?: (p: {stage: string, detail?: string, ratio?: number}) => void, budget?: {total: number} }} [opts]
 */
export async function scanBlob(blob, name, opts = {}) {
  const depth = opts.depth || 0;
  const path = opts.path || name;
  const budget = opts.budget || { total: 0 };
  const progress = opts.onProgress || (() => {});
  const node = mkNode(name.split('/').pop(), path, blob.size);
  try {
    const t = await sniff(blob, name);
    node.kind = t.kind;
    node.format = t.format;
    if (depth === 0) progress({ stage: `Analysing ${t.format.toUpperCase()}` });

    if (t.kind === 'image') {
      let bytes;
      if (blob.size <= LIMITS.imageFull) bytes = await readRange(blob, 0, blob.size);
      else {
        // Metadata lives at the start (and C2PA sometimes at the end) of big images.
        const head = await readRange(blob, 0, 16 << 20);
        const tail = await readRange(blob, blob.size - (4 << 20), blob.size);
        bytes = new Uint8Array(head.length + tail.length); bytes.set(head); bytes.set(tail, head.length);
        node.notes.push('Large image: scanned the first 16 MB and last 4 MB for metadata.');
      }
      const r = await scanImage(bytes, t.format);
      node.findings.push(...r.findings);
      node.meta = r.meta;
    } else if (t.kind === 'text') {
      const cap = Math.min(blob.size, LIMITS.textCap);
      const text = decodeText(await readRange(blob, 0, cap));
      if (blob.size > cap) node.notes.push(`Large text file: analysed the first ${(cap / 1048576).toFixed(0)} MB.`);
      const r = scanText(text, t.format);
      node.findings.push(...r.findings);
      node.meta = r.meta;
      node.preview = r.preview;
    } else if (t.kind === 'pdf') {
      if (blob.size > LIMITS.pdfMax) {
        node.notes.push('Very large PDF: metadata-only scan.');
        const head = await readRange(blob, 0, 8 << 20);
        const g = genericBinaryScan(head, 'PDF');
        node.findings.push(...g.findings);
        node.findings.push(...detectArtifacts(extractStrings(head, 6, 500_000), 'raw PDF strings').filter((f) => f.strength === 'strong'));
      } else {
        const r = await scanPdf(await readRange(blob, 0, blob.size), (d) => depth === 0 && progress({ stage: 'Reading PDF', detail: d }));
        node.findings.push(...r.findings);
        node.meta = r.meta;
        node.preview = r.text.slice(0, 4000);
        if (r.meta.truncated) node.notes.push('Long PDF: text analysis covered the first 150 pages.');
        if (r.meta.parseError) node.notes.push(`PDF text could not be fully parsed (${r.meta.parseError}). Metadata was still checked.`);
      }
    } else if (t.kind === 'zip') {
      await scanZip(blob, node, { depth, path, progress, budget });
    } else {
      // Media and unknown binaries: metadata + printable strings.
      const head = await readRange(blob, 0, Math.min(blob.size, 2 << 20));
      const tail = blob.size > 4 << 20 ? await readRange(blob, blob.size - (1 << 20), blob.size) : new Uint8Array();
      for (const part of [head, tail]) {
        if (!part.length) continue;
        const g = genericBinaryScan(part, t.format.toUpperCase());
        node.findings.push(...g.findings);
        const strs = extractStrings(part, 5, 400_000);
        node.findings.push(...detectArtifacts(strs, 'embedded strings').filter((f) => f.strength !== 'weak'));
        const tool = AI_TOOLS.filter((x) => !x.loose).find((x) => x.re.test(strs));
        if (tool && !node.findings.some((f) => f.id === 'bin.tool')) {
          const m = strs.match(tool.re);
          node.findings.push(finding({
            id: 'bin.tool', category: 'metadata', strength: t.kind === 'media' ? 'strong' : 'moderate',
            title: `Embedded metadata mentions ${tool.name}`,
            detail: 'Found in the file\'s readable metadata strings.',
            why: 'Audio/video tags (ID3, MP4 atoms) and legacy Office properties often record the generating tool.',
            evidence: [{ text: strs.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, ' ') }],
            location: t.format.toUpperCase(),
          }));
        }
      }
      if (t.kind === 'binary' && /^(7z|rar|gz|tgz|bz2|xz|zst|tar)$/.test(t.format)) node.notes.push(`${t.format.toUpperCase()} archives are not unpacked offline yet — convert to ZIP to scan contents.`);
      if (t.format === 'doc' || t.format === 'xls' || t.format === 'ppt' || t.format === 'ole') node.notes.push('Legacy Office binary: scanned embedded strings and properties only. Save as .docx/.xlsx for a full scan.');
    }
  } catch (e) {
    node.error = String(e?.message || e);
  }
  if (depth === 0) { scoreNode(node); node.rulesVersion = RULES_VERSION; }
  return node;
}

async function scanZip(blob, node, { depth, path, progress, budget }) {
  if (depth >= LIMITS.maxDepth) { node.notes.push('Maximum archive nesting depth reached; inner archive not opened.'); return; }
  const zip = await openZip(blob);
  const names = zip.entries.map((e) => e.name);
  const hasCT = names.includes('[Content_Types].xml');
  const e = node.format;
  let officeKind = null;
  if (hasCT && names.some((n) => n.startsWith('word/'))) officeKind = 'docx';
  else if (hasCT && names.some((n) => n.startsWith('xl/'))) officeKind = 'xlsx';
  else if (hasCT && names.some((n) => n.startsWith('ppt/'))) officeKind = 'pptx';
  else if (names.includes('mimetype') && names.includes('content.xml')) officeKind = 'odf';

  if (officeKind) {
    node.kind = 'document';
    node.format = officeKind === 'odf' ? (e || 'odt') : officeKind;
    const r = await scanOffice(zip, officeKind, (d) => depth === 0 && progress({ stage: 'Reading document', detail: d }));
    node.findings.push(...r.findings);
    node.meta = r.meta;
    node.preview = r.text.slice(0, 4000);
    for (const m of r.media.slice(0, 60)) {
      if (m.size > LIMITS.maxEntrySize) continue;
      try {
        const bytes = await zip.read(m, LIMITS.maxEntrySize);
        const child = await scanBlob(new Blob([bytes]), m.name, { depth: depth + 1, path: `${path}/${m.name}`, budget });
        node.children.push(child);
      } catch (err) { node.notes.push(`Could not read embedded ${m.name}: ${err.message}`); }
    }
    return;
  }

  node.kind = 'archive';
  node.meta = { entries: zip.entries.length };
  // Repo markers by file/folder name
  const markers = new Map();
  for (const n of names) {
    for (const r of REPO_MARKERS) if (r.re.test(n)) { if (!markers.has(r.tool)) markers.set(r.tool, []); markers.get(r.tool).push(n); }
  }
  for (const [tool, files] of markers) {
    node.findings.push(finding({
      id: `repo.${tool.toLowerCase().replace(/\W+/g, '-')}`, category: 'repo', strength: 'strong',
      title: `${tool} configuration files present`,
      detail: [...new Set(files)].slice(0, 6).join('\n'),
      why: 'These files configure AI coding assistants for a project. Their presence shows the code base was developed with that assistant.',
      evidence: [...new Set(files)].slice(0, 4).map((f) => ({ text: f })),
      location: 'Archive file list',
    }));
  }

  const files = zip.entries.filter((x) => !x.dir && !SKIP_ENTRY.test(x.name));
  const skipped = zip.entries.length - files.length - zip.entries.filter((x) => x.dir).length;
  if (skipped > 0) node.notes.push(`${skipped} system/vendor files skipped (__MACOSX, node_modules, .git objects…).`);
  if (files.length > LIMITS.maxEntries) node.notes.push(`Archive has ${files.length} files; scanned the first ${LIMITS.maxEntries}.`);
  const list = files.slice(0, LIMITS.maxEntries);
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (depth === 0) progress({ stage: 'Scanning archive', detail: entry.name, ratio: i / list.length });
    if (entry.encrypted) { node.notes.push(`Encrypted entry skipped: ${entry.name}`); continue; }
    if (entry.size > LIMITS.maxEntrySize) { node.notes.push(`Entry too large, skipped: ${entry.name}`); continue; }
    if (entry.compSize > 0 && entry.size / entry.compSize > LIMITS.maxRatio && entry.size > 50 << 20) { node.notes.push(`Suspicious compression ratio, skipped (zip-bomb guard): ${entry.name}`); continue; }
    if (budget.total + entry.size > LIMITS.maxTotalUncompressed) { node.notes.push('Total uncompressed size limit reached; remaining entries skipped.'); break; }
    budget.total += entry.size;
    try {
      const bytes = await zip.read(entry, LIMITS.maxEntrySize);
      const child = await scanBlob(new Blob([bytes]), entry.name, { depth: depth + 1, path: `${path}/${entry.name}`, budget });
      node.children.push(child);
    } catch (err) {
      const c = mkNode(entry.name.split('/').pop(), `${path}/${entry.name}`, entry.size);
      c.error = String(err.message || err);
      node.children.push(c);
    }
  }
  // Keep heavy previews only for flagged children to bound result size
  for (const c of node.children) scoreNode(c);
}

/** Convenience used by tests: scan raw bytes. */
export function scanBytes(bytes, name, opts) {
  return scanBlob(new Blob([bytes]), name, opts);
}

export { checkFields };
