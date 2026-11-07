// Scan worker: all parsing happens here so the UI stays at 60 fps.
import { scanBlob } from './engine.js';

self.onmessage = async (e) => {
  const { type, id, blob, name } = e.data || {};
  if (type !== 'scan') return;
  let last = 0;
  try {
    const result = await scanBlob(blob, name, {
      onProgress: (p) => {
        const now = Date.now();
        if (now - last < 80) return; // throttle progress messages
        last = now;
        self.postMessage({ type: 'progress', id, ...p });
      },
    });
    self.postMessage({ type: 'result', id, result });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err?.message || err) });
  }
};
