// Worker pool. Workers are created lazily on the first scan (the worker bundle
// includes pdf.js, so we don't pay for it until it's needed).
import { createWorker } from '#worker-factory';

const MAX = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const workers = [];
const idle = [];
const queue = [];
const pending = new Map();
const NO_PIXELS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nopixels');

function spawn() {
  const w = createWorker();
  w.onmessage = (e) => {
    const msg = e.data;
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') job.onProgress?.(msg);
    else {
      pending.delete(msg.id);
      msg.type === 'result' || msg.type === 'cleaned' ? job.resolve(msg.result) : job.reject(new Error(msg.error));
      release(w);
    }
  };
  w.onerror = (e) => {
    e.preventDefault?.();
    for (const [id, job] of pending) if (job.worker === w) { pending.delete(id); job.reject(new Error(e.message || 'Worker crashed')); }
    const i = workers.indexOf(w);
    if (i >= 0) workers.splice(i, 1);
    w.terminate();
    pump();
  };
  workers.push(w);
  return w;
}

function release(w) {
  idle.push(w);
  pump();
}

function pump() {
  while (queue.length) {
    let w = idle.pop();
    if (!w && workers.length < MAX) w = spawn();
    if (!w) return;
    const job = queue.shift();
    job.worker = w;
    pending.set(job.id, job);
    w.postMessage({ type: job.type || 'scan', id: job.id, blob: job.blob, name: job.name, opts: job.opts, noPixels: NO_PIXELS });
  }
}

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

export const busyCount = () => pending.size + queue.length;
