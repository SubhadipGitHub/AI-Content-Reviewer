// PDF extraction via pdf.js (legacy build for older Safari/iPad support).
// pdf.js runs in "fake worker" mode inside our own scan worker so no nested workers
// or extra network requests are needed, which keeps it working from file:// too.

import { checkFields, genericBinaryScan, checkXmp } from '../detectors/metadata.js';
import { analyzeProse } from './text.js';
import { detectArtifacts } from '../detectors/text-artifacts.js';

const MAX_PAGES = 150;
const TEXT_CAP = 3 * 1024 * 1024;

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      globalThis.pdfjsWorker = worker;
      const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      return lib;
    })();
  }
  return pdfjsPromise;
}

/** @param {Uint8Array} bytes */
export async function scanPdf(bytes, onProgress) {
  const findings = [];
  const meta = {};
  // Raw scan first: works even if pdf.js fails on a damaged file.
  const head = bytes.subarray(0, Math.min(bytes.length, 4 << 20));
  const g = genericBinaryScan(head, 'PDF');
  findings.push(...g.findings);
  if (bytes.length > 4 << 20) findings.push(...genericBinaryScan(bytes.subarray(bytes.length - (2 << 20)), 'PDF').findings);
  meta.version = String.fromCharCode(...bytes.subarray(5, 8));

  let text = '';
  const links = [];
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
      verbosity: 0,
    });
    const doc = await task.promise;
    meta.pages = doc.numPages;
    const md = await doc.getMetadata().catch(() => null);
    if (md) {
      const info = { ...md.info };
      const custom = info.Custom || {};
      delete info.Custom;
      meta.info = Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === 'string' && v));
      findings.push(...checkFields({ ...meta.info, ...custom }, 'PDF Info dictionary'));
      const raw = md.metadata?.getRaw?.();
      if (raw && !g.meta['xmp:CreatorTool']) findings.push(...checkXmp(String(raw), 'PDF XMP').findings);
    }
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= n && text.length < TEXT_CAP; i++) {
      onProgress?.(`Reading page ${i}/${n}`);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let last = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        if (last && Math.abs(it.transform[5] - last) > 2) text += '\n';
        text += it.str + (it.hasEOL ? '\n' : '');
        last = it.transform[5];
      }
      text += '\n\n';
      const ann = await page.getAnnotations().catch(() => []);
      for (const a of ann) if (a.url) links.push(a.url);
      page.cleanup();
    }
    meta.truncated = doc.numPages > MAX_PAGES || text.length >= TEXT_CAP;
    await task.destroy();
  } catch (e) {
    meta.parseError = String(e?.message || e);
  }
  meta.words = (text.match(/\S+/g) || []).length;
  // Normalise hyphenated line breaks before prose analysis
  const prose = text.replace(/-\n(?=[a-z])/g, '').replace(/[ \t]+\n/g, '\n');
  findings.push(...analyzeProse(prose, 'PDF text'));
  if (links.length) findings.push(...detectArtifacts(links.join('\n'), 'PDF links'));
  return { findings, meta, text: prose };
}
