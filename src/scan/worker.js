// Scan worker: all parsing (and cleaning) happens here so the UI stays at 60 fps.
import { scanBlob } from './engine.js';

self.onmessage = async (e) => {
  const { type, id, blob, name, noPixels, opts } = e.data || {};
  // Test hook (?nopixels): behave like a browser that can't decode images in workers.
  if (noPixels) globalThis.__acrNoWorkerPixels = true;
  if (type === 'clean') {
    try {
      const { cleanBlob } = await import('../clean/index.js');
      const r = await cleanBlob(blob, name, opts || {});
      const transferable = r.bytes.byteOffset === 0 && r.bytes.byteLength === r.bytes.buffer.byteLength;
      self.postMessage({ type: 'cleaned', id, result: r }, transferable ? [r.bytes.buffer] : []);
    } catch (err) {
      self.postMessage({ type: 'error', id, error: String(err?.message || err) });
    }
    return;
  }
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

// Tell the pool this worker loaded and started (lets it detect start-up failures).
self.postMessage({ type: 'ready' });
