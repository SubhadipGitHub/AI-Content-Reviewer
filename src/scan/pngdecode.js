// Minimal PNG decoder (8/16-bit greyscale, RGB, palette, grey+alpha, RGBA; non-interlaced).
// Returns only a rectangular region as RGBA so very large images stay cheap.
// Used where OffscreenCanvas is unavailable (older Safari, Node tests).

import { u32be, decodeLatin1, inflate } from '../lib/bytes.js';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_RAW = 160 * 1024 * 1024;

export function pngSize(b) {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * Decode the region [x0, x0+w) × [y0, y0+h) of a PNG to RGBA.
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number} | null>}
 */
export async function decodePngRegion(b, x0, y0, w, h) {
  let o = 8, width = 0, height = 0, depth = 8, type = 2, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const t = decodeLatin1(b.subarray(o + 4, o + 8));
    const d = b.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { width = u32be(d, 0); height = u32be(d, 4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') palette = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!width || !ch || interlace || !(depth === 8 || depth === 16) || (type === 3 && depth !== 8)) return null;
  const bpp = ch * (depth / 8);
  const stride = width * bpp;
  if ((stride + 1) * height > MAX_RAW) return null;
  let total = 0;
  for (const p of idat) total += p.length;
  const z = new Uint8Array(total);
  let q = 0;
  for (const p of idat) { z.set(p, q); q += p.length; }
  const raw = await inflate(z, (stride + 1) * height + 16);

  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  w = Math.min(w, width - x0); h = Math.min(h, height - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height && y < y0 + h; y++) {
    const base = y * (stride + 1);
    const f = raw[base];
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + up; break;
        case 3: v = x + ((a + up) >> 1); break;
        case 4: {
          const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
          break;
        }
        default: return null;
      }
      cur[i] = v & 255;
    }
    if (y >= y0) {
      const row = (y - y0) * w * 4;
      for (let x = 0; x < w; x++) {
        const s = (x0 + x) * bpp;
        const px = (k) => cur[s + k * (depth / 8)]; // high byte for 16-bit
        let r, g, bl, al = 255;
        if (type === 0) { r = g = bl = px(0); }
        else if (type === 2) { r = px(0); g = px(1); bl = px(2); }
        else if (type === 3) { const pi = cur[s]; r = palette[pi * 3]; g = palette[pi * 3 + 1]; bl = palette[pi * 3 + 2]; if (trns && pi < trns.length) al = trns[pi]; }
        else if (type === 4) { r = g = bl = px(0); al = px(1); }
        else { r = px(0); g = px(1); bl = px(2); al = px(3); }
        const d = row + x * 4;
        out[d] = r; out[d + 1] = g; out[d + 2] = bl; out[d + 3] = al;
      }
    }
    [prev, cur] = [cur, prev];
  }
  return { data: out, width: w, height: h };
}
