// Worker pool with a main-thread fallback.
//
// Workers are created lazily (the worker bundle includes pdf.js) and warmed up while
// online. If a worker can't be started at all (e.g. offline before the worker script
// was ever cached, or a local file:// / content:// page where the browser refuses
// blob workers), jobs run on the main thread instead, using the same engine code.
import { createWorker } from '#worker-factory';

const MAX = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency || 2) - 1));
const READY_TIMEOUT = 10_000;
const NO_PIXELS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nopixels');

const slots = []; // { w, ready, timer }
const idle = [];
const queue = [];
const pending = new Map(); // job id → job
let broken = false; // workers can't start in this environment
let announced = false;

function remove(slot) {
  clearTimeout(slot.timer);
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
  const j = idle.indexOf(slot);
  if (j >= 0) idle.splice(j, 1);
  try { slot.w.terminate(); } catch { /* already gone */ }
}

/** Jobs that were on a slot go back to the queue (or to the fallback if workers are broken). */
function rescue(slot, reason) {
  for (const [id, job] of pending) {
    if (job.slot !== slot) continue;
    pending.delete(id);
    job.retries = (job.retries || 0) + 1;
    if (!broken && job.retries <= 1) queue.unshift(job);
    else if (broken) runInline(job);
    else job.reject(new Error(`The scanner stopped unexpectedly (${reason}). Try again.`));
  }
}

function markBroken(slot, reason) {
  if (!broken) {
    broken = true;
    console.warn(`Scan workers unavailable (${reason}); using the main thread.`);
  }
  if (slot) { remove(slot); rescue(slot, reason); }
  for (const s of [...slots]) { remove(s); rescue(s, reason); }
  while (queue.length) runInline(queue.shift());
}

function spawn() {
  let w;
  try {
    w = createWorker();
  } catch (e) {
    markBroken(null, e?.message || 'Worker blocked');
    return null;
  }
  const slot = { w, ready: false, timer: 0 };
  slot.timer = setTimeout(() => { if (!slot.ready) markBroken(slot, 'start-up timed out'); }, READY_TIMEOUT);
  w.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'ready') { slot.ready = true; clearTimeout(slot.timer); return; }
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') { job.onProgress?.(msg); return; }
    pending.delete(msg.id);
    if (msg.type === 'result' || msg.type === 'cleaned') job.resolve(msg.result);
    else job.reject(new Error(msg.error));
    idle.push(slot);
    pump();
  };
  w.onerror = (e) => {
    e.preventDefault?.();
    if (!slot.ready) { markBroken(slot, e.message || 'the worker script could not be loaded'); return; }
    remove(slot);
    rescue(slot, e.message || 'worker error');
    pump();
  };
  slots.push(slot);
  return slot;
}

function pump() {
  while (queue.length) {
    if (broken) { runInline(queue.shift()); continue; }
    let slot = idle.pop();
    if (!slot && slots.length < MAX) slot = spawn();
    if (!slot) return; // all busy (or spawn failed and the queue was drained inline)
    const job = queue.shift();
    job.slot = slot;
    pending.set(job.id, job);
    try {
      slot.w.postMessage({ type: job.type || 'scan', id: job.id, blob: job.blob, name: job.name, opts: job.opts, noPixels: NO_PIXELS });
    } catch (e) {
      markBroken(slot, e?.message || 'postMessage failed');
    }
  }
}

// ───────── main-thread fallback ─────────
let inlineChain = Promise.resolve();

function runInline(job) {
  announce();
  inlineChain = inlineChain.then(async () => {
    await new Promise((r) => setTimeout(r, 0)); // let the UI paint between jobs
    try {
      if (job.type === 'clean') {
        const { cleanBlob } = await import('../clean/index.js');
        job.resolve(await cleanBlob(job.blob, job.name, job.opts || {}));
      } else {
        const { scanBlob } = await import('./engine.js');
        job.resolve(await scanBlob(job.blob, job.name, { onProgress: (p) => job.onProgress?.(p) }));
      }
    } catch (e) {
      const msg = String(e?.message || e);
      job.reject(new Error(/dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically/i.test(msg)
        ? 'The scanner isn\'t saved for offline use on this device yet. Open the app once while online, then it works offline.'
        : `Couldn't run the scanner on this device: ${msg}`));
    }
  });
}

function announce() {
  if (announced) return;
  announced = true;
  import('../ui/toast.js').then(({ toast }) => toast({
    title: 'Compatibility mode',
    body: 'This browser could not start background scanning, so files are scanned on the main thread. Big files may take longer.',
    tone: 'info',
    timeout: 7000,
  })).catch(() => {});
}

// ───────── public API ─────────
/** Scan a Blob in the pool. */
export function scanInWorker(id, blob, name, onProgress) {
  return new Promise((resolve, reject) => {
    queue.push({ id, blob, name, onProgress, resolve, reject });
    pump();
  });
}

/** Clean a Blob in the pool. Resolves to { bytes, changed, name, report }. */
export function cleanInWorker(id, blob, name, opts) {
  return new Promise((resolve, reject) => {
    queue.push({ type: 'clean', id: `clean:${id}:${Math.random().toString(36).slice(2)}`, blob, name, opts, resolve, reject });
    pump();
  });
}

/** Start one worker ahead of time so its script is fetched (and cached) while online. */
export function warmUp() {
  if (!broken && !slots.length) {
    const slot = spawn();
    if (slot) idle.push(slot);
  }
  // Also fetch the main-thread fallback code, so it is cached too.
  import('./engine.js').catch(() => {});
}

/** Give workers another chance (e.g. the user tapped Retry after reconnecting). */
export function retryWorkers() {
  broken = false;
}

export const usingFallback = () => broken;
export const busyCount = () => pending.size + queue.length;
