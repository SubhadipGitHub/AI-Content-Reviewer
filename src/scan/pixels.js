// Read the bottom-right corner of an image as RGBA without blocking the UI.
// Order: createImageBitmap + OffscreenCanvas (workers, modern browsers) →
// <canvas> (main thread on older Safari) → pure-JS PNG decoder (any runtime).

import { decodePngRegion, pngSize } from './pngdecode.js';
import { cornerBox } from './detectors/visible-marks.js';

const MAX_PIXELS = 80e6;

async function viaBitmap(blob) {
  if (typeof createImageBitmap !== 'function' || globalThis.__acrNoWorkerPixels) return null;
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  if (!hasOffscreen && !hasDocument) return null;
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  try {
    const W = bmp.width, H = bmp.height;
    if (!W || !H || W * H > MAX_PIXELS) return null;
    const box = cornerBox(W, H);
    let ctx;
    if (hasOffscreen) ctx = new OffscreenCanvas(box.w, box.h).getContext('2d', { willReadFrequently: true });
    else { const c = document.createElement('canvas'); c.width = box.w; c.height = box.h; ctx = c.getContext('2d', { willReadFrequently: true }); }
    if (!ctx) return null;
    ctx.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const img = ctx.getImageData(0, 0, box.w, box.h);
    return { data: img.data, width: box.w, height: box.h, W, H };
  } catch {
    return null;
  } finally {
    bmp.close?.();
  }
}

/**
 * @param {Blob|null} blob  the image (preferred)
 * @param {Uint8Array|null} bytes full bytes (for the PNG fallback)
 * @param {string} format
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number, W: number, H: number} | null>}
 */
export async function cornerPixels(blob, bytes, format) {
  if (blob) {
    const r = await viaBitmap(blob);
    if (r) return r;
  }
  if (format === 'png' && bytes) {
    const s = pngSize(bytes);
    if (!s || s.width * s.height > MAX_PIXELS) return null;
    const box = cornerBox(s.width, s.height);
    try {
      const r = await decodePngRegion(bytes, box.x, box.y, box.w, box.h);
      if (r) return { ...r, W: s.width, H: s.height };
    } catch { /* fall through */ }
  }
  return null;
}

export const PIXEL_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'tiff']);
