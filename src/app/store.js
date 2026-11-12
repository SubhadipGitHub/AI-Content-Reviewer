// Application state + scan orchestration. Views subscribe and re-render on change.

import * as db from '../store/db.js';
import { scanInWorker, cleanInWorker, retryWorkers } from '../scan/client.js';
import { uid } from '../lib/format.js';
import { setAvatarState } from '../avatar/index.js';
import { toast } from '../ui/toast.js';
import { RULES_VERSION } from '../scan/rules.js';
import { scoreNode } from '../scan/score.js';

const STRENGTH_ORDER = { strong: 0, moderate: 1, weak: 2, info: 3 };

export const store = {
  session: [], // ids added in this page session (newest first)
  files: new Map(),
  results: new Map(),
  progress: new Map(),
  settings: { theme: 'system', mascot: '3d', keepFiles: true, motion: 'system', onboarded: false, labelRemovalAck: false },
  blobs: new Map(), // this session's File handles (no memory cost) for cleaning
};

const listeners = new Set();
let raf = 0;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; for (const fn of listeners) fn(); });
}

export async function loadSettings() {
  for (const k of Object.keys(store.settings)) store.settings[k] = await db.getSetting(k, store.settings[k]);
  return store.settings;
}
export async function saveSetting(k, v) { store.settings[k] = v; await db.setSetting(k, v); emit(); }

/** Flatten findings of a result tree, most severe first. */
export function flatFindings(node, out = [], root = node) {
  for (const f of node.findings || []) out.push({ ...f, where: node === root ? null : node.path.split('/').slice(1).join('/') || node.name });
  for (const c of node.children || []) flatFindings(c, out, root);
  return out;
}
export function topFindings(node, n = 2) {
  return flatFindings(node).filter((f) => f.strength !== 'info').sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]).slice(0, n);
}

function summarize(result) {
  const all = flatFindings(result).filter((f) => f.strength !== 'info');
  const count = (node) => 1 + (node.children || []).reduce((a, c) => a + count(c), 0);
  return {
    score: result.score,
    verdict: result.verdict,
    kind: result.kind,
    format: result.format,
    findings: all.length,
    top: topFindings(result, 2).map((f) => ({ title: f.title, strength: f.strength, where: f.where })),
    items: count(result) - 1,
    flaggedChildren: result.flaggedChildren || 0,
    rulesVersion: RULES_VERSION,
    scannedAt: Date.now(),
  };
}

// Serial queue for IndexedDB writes so big files don't contend.
let saveChain = Promise.resolve();
let persistAsked = false;

async function persistBlob(rec, blob) {
  if (!persistAsked && blob.size > 20 * 1024 * 1024) { persistAsked = true; db.requestPersistence(); }
  try {
    rec.chunks = await db.putBlob(rec.id, blob, (r) => { rec.saveRatio = r; if (r === 1 || Math.random() < 0.2) emit(); });
    rec.stored = true;
    delete rec.saveRatio;
    await db.putFile(stripTransient(rec));
  } catch (e) {
    rec.stored = false;
    delete rec.saveRatio;
    toast({ title: 'Not saved to Library', body: /quota/i.test(e?.name + e?.message) ? 'Device storage is full. The scan result is still shown.' : String(e?.message || e), tone: 'warning' });
  }
  emit();
}

const stripTransient = ({ saveRatio, ...r }) => r;

let active = 0;

/**
 * Some browsers (e.g. Safari before 16.4) can't decode images inside a worker. Run the
 * visible-watermark check on the main thread instead, then re-score.
 */
async function pixelFallback(result, blob) {
  delete result.needsPixels;
  try {
    const [{ cornerPixels }, { detectVisibleMarks }, { rgbaToDataUrl }] = await Promise.all([
      import('../scan/pixels.js'), import('../scan/detectors/visible-marks.js'), import('../samples/builders.js'),
    ]);
    const px = await cornerPixels(blob, null, result.format);
    if (!px) { result.notes.push(`Visible-watermark check skipped: this browser can't decode ${String(result.format).toUpperCase()} images.`); return; }
    const v = await detectVisibleMarks(px.data, px.width, px.height, px.W, px.H, rgbaToDataUrl);
    result.findings.push(...v.findings);
    if (v.findings.some((f) => f.id === 'watermark.gemini')) result.notes = result.notes.filter((n) => !/SynthID/.test(n));
    scoreNode(result);
  } catch (e) {
    result.notes.push(`Visible-watermark check skipped (${e?.message || e}).`);
  }
}

function overallMood() {
  const recs = store.session.map((id) => store.files.get(id)).filter(Boolean);
  const done = recs.filter((r) => r.summary);
  if (!done.length) return;
  const v = done.map((r) => r.summary.verdict);
  const flagged = v.filter((x) => x === 'strong' || x === 'likely' || x === 'possible').length;
  const n = done.length;
  if (v.every((x) => x === 'error')) return setAvatarState('error');
  if (n === 1) {
    const one = v[0];
    const r = done[0];
    if (one === 'strong') return setAvatarState('detected', { caption: `AI fingerprints found in ${r.name}.` });
    if (one === 'likely') return setAvatarState('likely', { caption: `${r.name} looks AI-assisted.` });
    if (one === 'possible') return setAvatarState('possible', { caption: `A few signals in ${r.name} worth a look.` });
    if (one === 'clean') return setAvatarState('clean', { caption: `No AI signals in ${r.name}.` });
    return setAvatarState('error', { caption: `Couldn't read ${r.name}.` });
  }
  if (!flagged) return setAvatarState('clean', { caption: `All ${n} files look clear — no AI signals.` });
  if (flagged === n) {
    const strong = v.filter((x) => x === 'strong').length;
    return setAvatarState(strong ? 'detected' : 'likely', { caption: `All ${n} files show AI signals${strong ? ` (${strong} with strong evidence)` : ''}.` });
  }
  setAvatarState('mixed', { caption: `${flagged} of ${n} files show AI signals.` });
}

async function runScan(rec, blob) {
  rec.status = 'scanning';
  store.progress.set(rec.id, { stage: 'Queued' });
  emit();
  active++;
  setAvatarState('processing', { caption: active > 1 ? `Scanning ${active} files…` : `Scanning ${rec.name}…`, sticky: true });
  try {
    const result = await scanInWorker(rec.id, blob, rec.name, (p) => {
      store.progress.set(rec.id, p);
      emit();
    });
    result.scannedAt = Date.now();
    if (result.needsPixels) await pixelFallback(result, blob);
    store.results.set(rec.id, result);
    rec.summary = summarize(result);
    rec.status = result.verdict === 'error' ? 'error' : 'done';
    if (result.error) rec.error = result.error;
    db.putResult(rec.id, result).catch(() => {});
  } catch (e) {
    rec.status = 'error';
    rec.error = String(e?.message || e);
    rec.summary = { verdict: 'error', score: 0, findings: 0, top: [], kind: 'unknown', format: '' };
  } finally {
    active--;
    store.progress.delete(rec.id);
    db.putFile(stripTransient(rec)).catch(() => {});
    emit();
    if (active === 0) overallMood();
    else setAvatarState('processing', { caption: `Scanning ${active} file${active > 1 ? 's' : ''}…`, sticky: true, silent: false });
  }
}

/** Add files from a picker/drop/paste and scan them. */
export async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f && f.size >= 0);
  if (!files.length) return;
  const keep = store.settings.keepFiles;
  for (const f of files) {
    const rec = { id: uid(), name: f.name || 'pasted-file', size: f.size, type: f.type, lastModified: f.lastModified || Date.now(), addedAt: Date.now(), status: 'queued', chunks: 0, stored: false };
    store.files.set(rec.id, rec);
    store.blobs.set(rec.id, f);
    store.session.unshift(rec.id);
    db.putFile(rec).catch(() => {});
    if (keep) saveChain = saveChain.then(() => persistBlob(rec, f));
    runScan(rec, f);
  }
  emit();
}

export async function rescan(id) {
  const rec = store.files.get(id) || (await db.getFile(id));
  if (!rec) return;
  store.files.set(id, rec);
  const blob = await originalBlob(id);
  if (!blob) {
    toast({ title: rec.stored ? 'Stored file is incomplete' : 'Original file not stored', body: 'Add the file again to re-scan it.', tone: 'warning' });
    return;
  }
  if (!store.session.includes(id)) store.session.unshift(id);
  delete rec.summary;
  delete rec.error;
  retryWorkers();
  store.results.delete(id);
  await runScan(rec, blob);
}

export async function getResultFor(id) {
  if (store.results.has(id)) return store.results.get(id);
  const r = await db.getResult(id);
  if (r) store.results.set(id, r);
  return r;
}

export async function removeFile(id) {
  await db.deleteFile(id);
  store.files.delete(id);
  store.blobs.delete(id);
  store.results.delete(id);
  store.session = store.session.filter((x) => x !== id);
  emit();
}

export async function clearLibrary() {
  await db.clearAll();
  for (const id of [...store.files.keys()]) if (!store.session.includes(id) || store.files.get(id).status !== 'scanning') store.files.delete(id);
  store.results.clear();
  store.session = store.session.filter((id) => store.files.has(id));
  emit();
}

export async function loadLibrary() {
  const list = await db.allFiles().catch(() => []);
  for (const r of list) {
    const cur = store.files.get(r.id);
    if (!cur || cur.status !== 'scanning') store.files.set(r.id, { ...r, ...(cur ? { saveRatio: cur.saveRatio } : {}), status: r.status === 'scanning' || r.status === 'queued' ? (r.summary ? 'done' : 'error') : r.status });
  }
  return list.map((r) => store.files.get(r.id));
}

export async function downloadOriginal(id) {
  const rec = store.files.get(id);
  if (!rec?.stored) return;
  const blob = await db.getBlob(id, rec.chunks, rec.type);
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = rec.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Original Blob for a file: this session's File, else the copy stored in the Library. */
export async function originalBlob(id) {
  if (store.blobs.has(id)) return store.blobs.get(id);
  const rec = store.files.get(id) || (await db.getFile(id));
  if (!rec?.stored) return null;
  return db.getBlob(id, rec.chunks, rec.type);
}

/**
 * Clean files in the worker pool and verify each output with a fresh scan.
 * @param {string[]} ids
 * @param {string[]} items removal item keys
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function cleanFiles(ids, items, onProgress) {
  let done = 0;
  setAvatarState('processing', { caption: ids.length > 1 ? `Cleaning ${ids.length} files…` : 'Cleaning…', sticky: true });
  const jobs = ids.map(async (id) => {
    const rec = store.files.get(id);
    const before = rec?.summary || (await getResultFor(id));
    const blob = await originalBlob(id);
    if (!blob) return { id, name: rec?.name, error: 'The original file is not available. Add it again to clean it.' };
    try {
      const c = await cleanInWorker(id, blob, rec.name, { items });
      let after = null;
      if (c.changed) {
        const res = await scanInWorker(`verify:${id}`, new Blob([c.bytes]), c.name);
        after = { score: res.score, verdict: res.verdict, left: topFindings(res, 6).filter((f) => f.strength !== 'weak').slice(0, 4).map((f) => ({ title: f.title, strength: f.strength, where: f.where })) };
      }
      return { id, name: rec.name, outName: c.name, bytes: c.bytes, changed: c.changed, report: c.report, before: { score: before?.score ?? 0, verdict: before?.verdict ?? 'clean' }, after };
    } catch (e) {
      return { id, name: rec?.name, error: String(e?.message || e) };
    } finally {
      onProgress?.(++done, ids.length);
    }
  });
  const results = await Promise.all(jobs);
  const ok = results.filter((r) => r.changed);
  const remaining = ok.filter((r) => r.after && r.after.verdict !== 'clean').length;
  if (!ok.length) setAvatarState('possible', { caption: 'Nothing that could be removed was found.' });
  else if (remaining) setAvatarState('possible', { caption: `Cleaned ${ok.length} file${ok.length > 1 ? 's' : ''} — some signals need a manual edit.` });
  else if (ok.length === 1) setAvatarState('clean', { caption: `Cleaned! ${ok[0].before.score} → ${ok[0].after.score}` });
  else setAvatarState('clean', { caption: `Cleaned ${ok.length} files — no AI identifiers left.` });
  return results;
}

/** Add cleaned outputs to the Library (they are scanned like any other file). */
export function saveCleaned(results) {
  const files = results.filter((r) => r.changed).map((r) => new File([r.bytes], r.outName, { type: guessMime(r.outName) }));
  return addFiles(files);
}

export function guessMime(name) {
  const e = name.split('.').pop().toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })[e] || 'application/octet-stream';
}

export function downloadBytes(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: guessMime(name) }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20_000);
}
