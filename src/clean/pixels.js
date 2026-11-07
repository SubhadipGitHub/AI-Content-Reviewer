// Remove Gemini's visible sparkle by reverse alpha blending:
//   original = (observed − k·α·255) / (1 − k·α)
// α is Gemini's measured alpha map and k the opacity found by the detector (refined here).

import { findGeminiSparkle, classifySparkle, cornerBox, alphaAt, templateBase } from '../scan/detectors/visible-marks.js';
import { decodePngRegion, pngSize } from '../scan/pngdecode.js';
import { pngFromRGBA } from '../samples/builders.js';

/** Decode the whole image to RGBA. */
export async function decodeFull(blob, bytes, format) {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined' && blob && !globalThis.__acrNoWorkerPixels) {
    try {
      const bmp = await createImageBitmap(blob);
      const W = bmp.width, H = bmp.height;
      const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      return { data: ctx.getImageData(0, 0, W, H).data, W, H };
    } catch { /* fall back */ }
  }
  if (format === 'png' && bytes) {
    const s = pngSize(bytes);
    if (!s || s.width * s.height > 60e6) return null;
    const r = await decodePngRegion(bytes, 0, 0, s.width, s.height);
    return r ? { data: r.data, W: s.width, H: s.height } : null;
  }
  return null;
}

function edgeMask(alpha, s) {
  const g = new Float32Array(s * s);
  let mx = 0;
  for (let y = 1; y < s - 1; y++) for (let x = 1; x < s - 1; x++) {
    const i = y * s + x;
    g[i] = Math.hypot(alpha[i + 1] - alpha[i - 1], alpha[i + s] - alpha[i - s]);
    mx = Math.max(mx, g[i]);
  }
  const idx = [];
  for (let i = 0; i < g.length; i++) if (g[i] > 0.25 * mx) idx.push(i);
  return idx;
}

function edgeEnergy(rgba, W, x0, y0, s, alpha, k, maskIdx) {
  // Sum of luminance gradient magnitudes over the template's edge mask after restoring.
  const lum = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = ((y0 + y) * W + x0 + x) * 4;
    const a = Math.min(0.97, alpha[y * s + x] * k);
    const inv = (v) => (v - a * 255) / (1 - a);
    lum[y * s + x] = 0.2126 * inv(rgba[i]) + 0.7152 * inv(rgba[i + 1]) + 0.0722 * inv(rgba[i + 2]);
  }
  let e = 0;
  for (const i of maskIdx) {
    const gx = lum[i + 1] - lum[i - 1], gy = lum[i + s] - lum[i - s];
    e += Math.sqrt(gx * gx + gy * gy);
  }
  return e;
}

/**
 * Detect and remove the sparkle in place.
 * @returns {{removed: boolean, detail?: string}}
 */
export function removeSparkle(rgba, W, H) {
  const box = cornerBox(W, H);
  const crop = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) crop.set(rgba.subarray(((box.y + y) * W + box.x) * 4, ((box.y + y) * W + box.x + box.w) * 4), y * box.w * 4);
  const r = findGeminiSparkle(crop, box.w, box.h, W, H);
  if (!classifySparkle(r)) return { removed: false };
  // Jointly refine size (±2 px), position (±1 px) and opacity: the fit with the least
  // leftover edge energy (relative to the unrestored patch) is the best reconstruction.
  const base = templateBase(r.template);
  let best = null;
  for (let ds = -2; ds <= 2; ds++) {
    const size = r.size + ds;
    if (size < 24) continue;
    const alpha = alphaAt(base, size);
    const maskIdx = edgeMask(alpha, size);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = r.x + ox - Math.round(ds / 2), y = r.y + oy - Math.round(ds / 2);
      if (x < 1 || y < 1 || x + size >= W || y + size >= H) continue;
      const e0 = edgeEnergy(rgba, W, x, y, size, alpha, 0, maskIdx);
      if (!e0) continue;
      for (let k = Math.max(0.2, r.k - 0.15); k <= Math.min(1.05, r.k + 0.15) + 1e-9; k += 0.025) {
        const rel = edgeEnergy(rgba, W, x, y, size, alpha, k, maskIdx) / e0;
        if (!best || rel < best.rel) best = { rel, k, x, y, size, alpha, maskIdx, e0 };
      }
    }
  }
  // Fine-tune opacity at the chosen geometry
  for (let k = best.k - 0.025; k <= best.k + 0.025 + 1e-9; k += 0.005) {
    const rel = edgeEnergy(rgba, W, best.x, best.y, best.size, best.alpha, k, best.maskIdx) / best.e0;
    if (rel < best.rel) { best.rel = rel; best.k = k; }
  }
  const s = best.size, t = { alpha: best.alpha }, maskIdx = best.maskIdx, bestK = best.k;
  r.x = best.x; r.y = best.y;
  const bestE = best.rel * best.e0;
  const e0 = edgeEnergy(rgba, W, r.x, r.y, s, t.alpha, 0, maskIdx);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const a = Math.min(0.97, t.alpha[y * s + x] * bestK);
    if (a <= 0) continue;
    const i = ((r.y + y) * W + r.x + x) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, Math.round((rgba[i + c] - a * 255) / (1 - a))));
  }
  // A resampled template or re-compressed image can leave a faint outline. If enough edge
  // energy remains, replace the thin outline band with the median of nearby restored pixels.
  if (bestE > 0.3 * e0) featherOutline(rgba, W, H, r.x, r.y, s, maskIdx);
  return { removed: true, detail: `${s}px sparkle (opacity ${(bestK * 100).toFixed(0)}%)` };
}

function featherOutline(rgba, W, H, x0, y0, s, maskIdx) {
  const band = new Uint8Array(s * s);
  for (const i of maskIdx) {
    const bx = i % s, by = (i / s) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = bx + dx, y = by + dy;
      if (x >= 0 && y >= 0 && x < s && y < s) band[y * s + x] = 1;
    }
  }
  const src = Uint8ClampedArray.from(rgba.subarray(((y0 - 3) * W) * 4, ((y0 + s + 3) * W) * 4));
  const at = (x, y, c) => src[((y - (y0 - 3)) * W + x) * 4 + c];
  const vals = [[], [], []];
  for (let by = 0; by < s; by++) for (let bx = 0; bx < s; bx++) {
    if (!band[by * s + bx]) continue;
    for (const v of vals) v.length = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = bx + dx, ny = by + dy;
      if (nx >= 0 && ny >= 0 && nx < s && ny < s && band[ny * s + nx]) continue;
      const X = x0 + nx, Y = y0 + ny;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      for (let c = 0; c < 3; c++) vals[c].push(at(X, Y, c));
    }
    if (vals[0].length < 6) continue;
    const i = ((y0 + by) * W + x0 + bx) * 4;
    for (let c = 0; c < 3; c++) {
      vals[c].sort((a, b) => a - b);
      const med = vals[c][vals[c].length >> 1];
      rgba[i + c] = Math.round(0.35 * rgba[i + c] + 0.65 * med);
    }
  }
}

/** Encode RGBA back to the original format where possible (PNG is lossless). */
export async function encodeImage(rgba, W, H, format) {
  if (format !== 'png' && typeof OffscreenCanvas !== 'undefined' && !globalThis.__acrNoWorkerPixels) {
    try {
      const c = new OffscreenCanvas(W, H);
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), W, H), 0, 0);
      const type = format === 'webp' ? 'image/webp' : 'image/jpeg';
      const blob = await c.convertToBlob({ type, quality: 0.95 });
      if (blob.type === type) return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: format === 'webp' ? 'webp' : 'jpg', lossy: true };
    } catch { /* fall back to PNG */ }
  }
  const bytes = await pngFromRGBA(rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), W, H);
  return { bytes, ext: 'png', lossy: false, converted: format !== 'png' };
}
