// IndexedDB persistence (no library). Files are stored as 4 MB Blob chunks so very
// large inputs never need to be held in memory and stay reviewable across sessions.

const DB_NAME = 'ai-content-reviewer';
const DB_VERSION = 1;
export const CHUNK = 4 * 1024 * 1024;

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' }).createIndex('addedAt', 'addedAt');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('results')) db.createObjectStore('results');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked by another tab'));
  });
  return dbp;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx(stores, mode = 'readonly') {
  const db = await open();
  return db.transaction(stores, mode);
}

export async function putFile(rec) {
  const t = await tx('files', 'readwrite');
  t.objectStore('files').put(rec);
  return done(t);
}

export async function getFile(id) {
  const t = await tx('files');
  return reqP(t.objectStore('files').get(id));
}

export async function allFiles() {
  const t = await tx('files');
  const list = await reqP(t.objectStore('files').getAll());
  return list.sort((a, b) => b.addedAt - a.addedAt);
}

/** Store a Blob as chunks; calls onProgress(ratio). Returns chunk count. */
export async function putBlob(id, blob, onProgress) {
  const n = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let i = 0; i < n; i++) {
    const part = blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK));
    // Materialise the slice so Safari stores real bytes, not a reference to the File.
    const buf = await part.arrayBuffer();
    const t = await tx('chunks', 'readwrite');
    t.objectStore('chunks').put(new Blob([buf]), `${id}:${i}`);
    await done(t);
    onProgress?.((i + 1) / n);
  }
  return n;
}

export async function getBlob(id, count, type = '') {
  const t = await tx('chunks');
  const s = t.objectStore('chunks');
  const parts = await Promise.all(Array.from({ length: count }, (_, i) => reqP(s.get(`${id}:${i}`))));
  if (parts.some((p) => !p)) return null;
  return new Blob(parts, { type });
}

export async function putResult(id, result) {
  const t = await tx('results', 'readwrite');
  t.objectStore('results').put(result, id);
  return done(t);
}

export async function getResult(id) {
  const t = await tx('results');
  return reqP(t.objectStore('results').get(id));
}

export async function deleteFile(id) {
  const rec = await getFile(id);
  const t = await tx(['files', 'chunks', 'results'], 'readwrite');
  t.objectStore('files').delete(id);
  t.objectStore('results').delete(id);
  const chunks = t.objectStore('chunks');
  for (let i = 0; i < (rec?.chunks || 0); i++) chunks.delete(`${id}:${i}`);
  return done(t);
}

export async function clearAll() {
  const t = await tx(['files', 'chunks', 'results'], 'readwrite');
  t.objectStore('files').clear();
  t.objectStore('chunks').clear();
  t.objectStore('results').clear();
  return done(t);
}

export async function getSetting(key, fallback) {
  try {
    const t = await tx('settings');
    const v = await reqP(t.objectStore('settings').get(key));
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

export async function setSetting(key, value) {
  try {
    const t = await tx('settings', 'readwrite');
    t.objectStore('settings').put(value, key);
    await done(t);
  } catch { /* storage unavailable (private mode): settings simply don't persist */ }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return e ? { usage: e.usage || 0, quota: e.quota || 0, persisted: !!persisted } : null;
  } catch { return null; }
}

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
