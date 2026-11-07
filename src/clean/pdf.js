// PDF cleaner: a full rewrite with pdf-lib (lazy-loaded), so earlier revisions and
// their metadata do not survive in the file the way an incremental update would leave them.
import { cleanTokens } from './text.js';
import { editXmp } from './meta.js';
import { decodeUtf8, encodeUtf8 } from '../lib/bytes.js';
import { AI_TOOLS } from '../scan/rules.js';

const AI_PROP = /\b(ai|genai|copilot|chatgpt|llm|gpt|generated|aigc|c2pa)\b/i;

export async function cleanPdf(bytes, items) {
  const removed = {};
  const notes = [];
  const bump = (k, n = 1) => { removed[k] = (removed[k] || 0) + n; };
  const lib = await import('@cantoo/pdf-lib');
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFRawStream, decodePDFRawStream } = lib;
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false, throwOnInvalidObject: false });
  } catch (e) {
    return { bytes: null, removed, notes: [`This PDF could not be rewritten (${/encrypt/i.test(e?.message) ? 'it is encrypted' : e?.message || e}).`] };
  }
  const info = doc.getInfoDict();
  const str = (v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : String(v ?? ''));
  for (const [k, v] of info.entries()) {
    const key = k.asString().slice(1);
    const val = str(v);
    let cat = null;
    if (key === 'Producer' || key === 'Creator') cat = 'fingerprints';
    else if (key === 'Author' || key === 'Subject' || key === 'Keywords') cat = AI_TOOLS.some((t) => !t.loose && t.re.test(val)) && key === 'Author' ? 'aiAuthors' : 'private';
    else if (!['Title', 'CreationDate', 'ModDate', 'Trapped'].includes(key)) cat = AI_PROP.test(key) || /ai[- ]generated/i.test(val) ? 'labels' : 'private';
    if (cat && (items.has(cat) || (cat === 'aiAuthors' && items.has('private')))) { info.delete(k); bump(cat === 'aiAuthors' && !items.has('aiAuthors') ? 'private' : cat); }
  }
  // XMP metadata stream
  const catalog = doc.catalog;
  const mdRef = catalog.get(PDFName.of('Metadata'));
  if (mdRef) {
    const md = doc.context.lookup(mdRef);
    try {
      const raw = md instanceof PDFRawStream ? decodePDFRawStream(md).decode() : md.getContents();
      const r = editXmp(decodeUtf8(raw), items);
      if (Object.keys(r.removed).length) {
        for (const [k, n] of Object.entries(r.removed)) bump(k, n);
        const ns = doc.context.stream(encodeUtf8(r.xml), { Type: 'Metadata', Subtype: 'XML' });
        catalog.set(PDFName.of('Metadata'), doc.context.register(ns));
      }
    } catch {
      if (items.has('fingerprints') || items.has('labels')) { catalog.delete(PDFName.of('Metadata')); bump('fingerprints'); }
    }
  }
  // C2PA manifests ride in associated files (/AF) — remove those that are C2PA.
  if (items.has('c2pa')) {
    const af = catalog.lookup(PDFName.of('AF'));
    if (af && af.asArray) {
      const keep = af.asArray().filter((ref) => {
        const spec = doc.context.lookup(ref);
        const subtype = spec instanceof PDFDict ? String(spec.get(PDFName.of('AFRelationship')) || '') + str(spec.get(PDFName.of('F'))) : '';
        return !/c2pa/i.test(subtype);
      });
      if (keep.length !== af.asArray().length) { bump('c2pa', af.asArray().length - keep.length); catalog.set(PDFName.of('AF'), doc.context.obj(keep)); }
    }
  }
  // Link annotations: strip AI tracking params from URIs
  if (items.has('tokens')) {
    for (const page of doc.getPages()) {
      const annots = page.node.Annots?.();
      if (!annots) continue;
      for (const ref of annots.asArray()) {
        const a = doc.context.lookup(ref);
        const action = a?.lookup?.(PDFName.of('A'));
        const uri = action?.get?.(PDFName.of('URI'));
        if (!uri) continue;
        const r = cleanTokens(str(uri));
        if (r.n) { action.set(PDFName.of('URI'), PDFString.of(r.text)); bump('tokens', r.n); }
      }
    }
  }
  if (!Object.keys(removed).length) return { bytes: null, removed, notes };
  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  notes.push('The PDF was rewritten without earlier revisions. Text on the pages is not edited.');
  return { bytes: out, removed, notes };
}
