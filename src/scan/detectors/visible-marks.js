// Visible AI watermark detection on pixels (pure JS: worker, main thread, Node).
//
// Gemini: a white "sparkle" alpha-blended into the bottom-right corner:
//   observed = α·255 + (1 − α)·original
// so luminance rises by α·(255 − original). We search the bottom-right region
// for the known alpha maps (several sizes and margins), score candidates with
// normalised cross-correlation (NCC) on luminance and on edge magnitude, then
// require a positive blend gain and that reverse-blending smooths the patch.
//
// DALL·E 2: a 5-colour bar (yellow, cyan, green, red, blue) in the corner.

import { GEMINI_ALPHA_B64 } from './gemini-alpha.js';
import { finding } from '../findings.js';

const EPS = 1e-9;

// ───────── templates ─────────
function b64bytes(s) {
  if (typeof atob === 'function') return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function resample(src, n, m) {
  if (n === m) return Float32Array.from(src);
  const out = new Float32Array(m * m);
  const scale = n / m;
  if (m < n) {
    // Area averaging for downscale
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const sx0 = x * scale, sx1 = (x + 1) * scale, sy0 = y * scale, sy1 = (y + 1) * scale;
      let acc = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          acc += src[sy * n + sx] * wx * wy; wsum += wx * wy;
        }
      }
      out[y * m + x] = acc / wsum;
    }
    return out;
  }
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const fx = Math.min(n - 1, Math.max(0, (x + 0.5) * scale - 0.5));
    const fy = Math.min(n - 1, Math.max(0, (y + 0.5) * scale - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    out[y * m + x] = (src[y0 * n + x0] * (1 - ax) + src[y0 * n + x1] * ax) * (1 - ay) + (src[y1 * n + x0] * (1 - ax) + src[y1 * n + x1] * ax) * ay;
  }
  return out;
}

function sobelMag(a, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -a[i - w - 1] - 2 * a[i - 1] - a[i + w - 1] + a[i - w + 1] + 2 * a[i + 1] + a[i + w + 1];
    const gy = -a[i - w - 1] - 2 * a[i - w] - a[i - w + 1] + a[i + w - 1] + 2 * a[i + w] + a[i + w + 1];
    out[i] = Math.sqrt(gx * gx + gy * gy);
  }
  return out;
}

function zeroMean(a) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  const z = new Float32Array(a.length);
  let ss = 0;
  for (let i = 0; i < a.length; i++) { z[i] = a[i] - m; ss += z[i] * z[i]; }
  return { z, norm: Math.sqrt(ss) };
}

let TEMPLATES = null;
export function geminiTemplates() {
  if (TEMPLATES) return TEMPLATES;
  const base = {};
  for (const [k, v] of Object.entries(GEMINI_ALPHA_B64)) {
    const bytes = b64bytes(v.data);
    const f = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) f[i] = bytes[i] / 255;
    base[k] = { size: v.size, alpha: f };
  }
  const list = [];
  const add = (name, src, size) => {
    const alpha = resample(src.alpha, src.size, size);
    const zt = zeroMean(alpha);
    const zg = zeroMean(sobelMag(alpha, size, size));
    let sumA = 0, sumA2 = 0;
    for (const a of alpha) { sumA += a; sumA2 += a * a; }
    list.push({ name, size, alpha, zt, zg, sumA, sumA2 });
  };
  add('48', base['48'], 48);
  add('96', base['96'], 96);
  add('36-v2', base['36-v2'], 36);
  add('96-v2', base['96-20260520'], 96);
  for (const s of [32, 36, 40, 42, 44, 52, 56, 64, 72, 80, 88]) add(`96@${s}`, base['96'], s);
  TEMPLATES = list;
  return list;
}

// ───────── image helpers ─────────
function luminance(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
  return out;
}

function patch(gray, gw, x, y, s) {
  const out = new Float32Array(s * s);
  for (let r = 0; r < s; r++) out.set(gray.subarray((y + r) * gw + x, (y + r) * gw + x + s), r * s);
  return out;
}

/** NCC between a patch and a zero-mean template. */
function ncc(p, zt) {
  let m = 0;
  for (const v of p) m += v;
  m /= p.length;
  let num = 0, ss = 0;
  for (let i = 0; i < p.length; i++) { const d = p[i] - m; num += d * zt.z[i]; ss += d * d; }
  const den = Math.sqrt(ss) * zt.norm;
  return den < EPS ? 0 : num / den;
}

function stdOf(p) {
  let m = 0;
  for (const v of p) m += v;
  m /= p.length;
  let ss = 0;
  for (const v of p) ss += (v - m) * (v - m);
  return Math.sqrt(ss / p.length);
}

/** NCC of a region of a precomputed map against a zero-mean template. */
function nccAt(map, mw, x, y, s, zt) {
  let m = 0;
  for (let r = 0; r < s; r++) { const o = (y + r) * mw + x; for (let c = 0; c < s; c++) m += map[o + c]; }
  m /= s * s;
  let num = 0, ss = 0;
  for (let r = 0; r < s; r++) {
    const o = (y + r) * mw + x;
    for (let c = 0; c < s; c++) { const d = map[o + c] - m; num += d * zt.z[r * s + c]; ss += d * d; }
  }
  const den = Math.sqrt(ss) * zt.norm;
  return den < EPS ? 0 : num / den;
}

/**
 * Reverse-blend test. Removing a real overlay at the right opacity erases the star's
 * edges; subtracting a star from ordinary content adds edges instead.
 */
function restoration(p, t) {
  const s = t.size;
  const tg = sobelMag(t.alpha, s, s);
  let mx = 0;
  for (const v of tg) mx = Math.max(mx, v);
  const before = sobelMag(p, s, s);
  let eb = 0;
  const mask = [];
  for (let i = 0; i < tg.length; i++) if (tg[i] > 0.25 * mx) { mask.push(i); eb += before[i]; }
  let best = { ratio: 9, k: 0, under: 1 };
  const restored = new Float32Array(p.length);
  for (let k = 0.25; k <= 1.0001; k += 0.05) {
    let under = 0;
    for (let i = 0; i < p.length; i++) {
      const a = Math.min(0.97, t.alpha[i] * k);
      const v = (p[i] - a * 255) / (1 - a);
      if (v < -12) under++;
      restored[i] = v;
    }
    const after = sobelMag(restored, s, s);
    let ea = 0;
    for (const i of mask) ea += after[i];
    const ratio = eb < EPS ? 9 : ea / eb;
    if (ratio < best.ratio) best = { ratio, k, under: under / p.length };
  }
  return best;
}

/** Worst per-channel edge ratio after reverse-blending at opacity k (a white overlay restores in R, G and B). */
function channelWorst(rgba, cw, x, y, t, k) {
  const s = t.size;
  const tg = sobelMag(t.alpha, s, s);
  let mx = 0;
  for (const v of tg) mx = Math.max(mx, v);
  let worst = 0;
  const p = new Float32Array(s * s), q = new Float32Array(s * s);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < s; r++) for (let col = 0; col < s; col++) {
      const v = rgba[((y + r) * cw + x + col) * 4 + c];
      const a = Math.min(0.97, t.alpha[r * s + col] * k);
      p[r * s + col] = v;
      q[r * s + col] = (v - a * 255) / (1 - a);
    }
    const b = sobelMag(p, s, s), a2 = sobelMag(q, s, s);
    let eb = 0, ea = 0;
    for (let i = 0; i < s * s; i++) if (tg[i] > 0.25 * mx) { eb += b[i]; ea += a2[i]; }
    worst = Math.max(worst, eb < EPS ? 9 : ea / eb);
  }
  return worst;
}

function evaluate(gray, grad, gw, gh, t, x, y, full = false) {
  if (x < 0 || y < 0 || x + t.size > gw || y + t.size > gh) return null;
  const spatial = nccAt(gray, gw, x, y, t.size, t.zt);
  const g = nccAt(grad, gw, x, y, t.size, t.zg);
  const r = { spatial, grad: g, score: 0.5 * spatial + 0.5 * g };
  if (!full) return r;
  const p = patch(gray, gw, x, y, t.size);
  const rest = restoration(p, t);
  return { ...r, ratio: rest.ratio, k: rest.k, under: rest.under, std: stdOf(p) };
}

// ───────── Gemini search ─────────
/**
 * @param {Uint8ClampedArray|Uint8Array} rgba crop pixels
 * @param {number} cw crop width
 * @param {number} ch crop height
 * @param {number} W full image width
 * @param {number} H full image height  (crop is assumed to be the bottom-right cw×ch of the image)
 */
export function findGeminiSparkle(rgba, cw, ch, W, H) {
  const gray = luminance(rgba, cw, ch);
  const grad = sobelMag(gray, cw, ch);
  const ox = W - cw, oy = H - ch;
  const cands = [];
  for (const t of geminiTemplates()) {
    const maxM = Math.min(cw, ch) - t.size - 1;
    for (let m = 0; m <= maxM; m += 2) {
      const x = W - m - t.size - ox, y = H - m - t.size - oy;
      const r = evaluate(gray, grad, cw, ch, t, x, y);
      if (r && r.spatial > 0.15) cands.push({ t, x, y, score: r.score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  // Always evaluate Gemini's known anchors too (busy textures can push them out of the top list).
  const anchors = [];
  for (const t of geminiTemplates()) {
    if (!/^(48|96|36-v2|96-v2)$/.test(t.name)) continue;
    for (const m of ANCHOR_MARGINS) {
      const x = W - m - t.size - ox, y = H - m - t.size - oy;
      if (x >= 0 && y >= 0) anchors.push({ t, x, y });
    }
  }
  const v2 = v2SmallAnchor(W, H);
  const tv2 = geminiTemplates().find((t) => t.size === v2.size) || geminiTemplates().find((t) => t.name === '36-v2');
  anchors.push({ t: tv2, x: W - v2.margin - tv2.size - ox, y: H - v2.margin - tv2.size - oy });
  let best = null;
  for (const c of [...cands.slice(0, 12), ...anchors]) {
    let local = null;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const r = evaluate(gray, grad, cw, ch, c.t, c.x + dx, c.y + dy);
      if (r && (!local || r.score > local.score)) local = { t: c.t, x: c.x + dx, y: c.y + dy, score: r.score };
    }
    if (!local) continue;
    const full = evaluate(gray, grad, cw, ch, local.t, local.x, local.y, true);
    const cand = { ...local, ...full };
    if (!best || rank(cand) > rank(best)) best = cand;
  }
  if (!best) return null;
  const chanWorst = channelWorst(rgba, cw, best.x, best.y, best.t, best.k);
  return {
    spatial: best.spatial, grad: best.grad, ratio: best.ratio, k: best.k, under: best.under, std: best.std, chanWorst,
    template: best.t.name,
    size: best.t.size,
    x: best.x + ox,
    y: best.y + oy,
    marginRight: W - (best.x + ox) - best.t.size,
    marginBottom: H - (best.y + oy) - best.t.size,
  };
}

const rank = (c) => c.score + Math.max(0, 1 - c.ratio);

const ANCHOR_MARGINS = [32, 64, 96, 192];

/** Gemini 3.5 small-output placement (scaled from 2752/2816/2848-wide canonical renders). */
function v2SmallAnchor(W, H) {
  const long = Math.max(W, H), short = Math.min(W, H);
  let src = 2752;
  if (long > 1100) {
    const d = 2 * long;
    for (const c of [2816, 2848]) if (Math.abs(d - c) < Math.abs(d - src)) src = c;
  } else src = short >= 566 ? 2752 : short >= 550 ? 2816 : 2848;
  const scale = long / src;
  const ideal = Math.round(96 * scale);
  const sizes = [32, 36, 40, 42, 44, 48, 52, 56, 64, 72, 80, 88, 96];
  const size = ideal <= 40 ? 36 : sizes.reduce((a, b) => (Math.abs(b - ideal) < Math.abs(a - ideal) ? b : a));
  return { margin: Math.round(192 * scale), size };
}

/**
 * Thresholds calibrated on 29 real Gemini outputs (25 detected, 21 strong) and 200 clean
 * photos/textures at Gemini output sizes, incl. JPEG re-saves (0 detections: clean corners never
 * restore at opacity ≥ 0.45 and their minimum edge ratio is 0.82). "Strong" additionally needs
 * every colour channel to restore, since a white overlay lifts R, G and B alike; this demotes
 * light-coloured content that happens to resemble the sparkle to "moderate".
 */
export function classifySparkle(r) {
  if (!r || r.k < 0.45 || r.under > 0.05) return null;
  const shape = Math.max(r.spatial, r.grad);
  if (r.ratio <= 0.62 && shape >= 0.4 && r.chanWorst <= 0.7) return 'strong';
  if (r.ratio <= 0.8 && shape >= 0.2) return 'moderate';
  return null;
}

// ───────── DALL·E 2 colour bar ─────────
const DALLE = [[255, 255, 102], [66, 255, 255], [81, 218, 76], [255, 110, 60], [60, 70, 255]];
export function findDalleBar(rgba, cw, ch) {
  if (cw < 80 || ch < 16) return null;
  const x0 = cw - 80, y0 = ch - 16;
  let ok = 0;
  for (let k = 0; k < 5; k++) {
    let dist = 0, n = 0;
    for (let y = y0 + 3; y < y0 + 13; y++) for (let x = x0 + k * 16 + 3; x < x0 + k * 16 + 13; x++) {
      const i = (y * cw + x) * 4;
      dist += Math.abs(rgba[i] - DALLE[k][0]) + Math.abs(rgba[i + 1] - DALLE[k][1]) + Math.abs(rgba[i + 2] - DALLE[k][2]);
      n++;
    }
    if (dist / n < 60) ok++;
  }
  return ok === 5;
}

/** Crop + outline → small RGBA preview for evidence. */
export function evidenceCrop(rgba, cw, ch, box, pad = 24, scale = 3) {
  const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(cw, box.x + box.w + pad), y1 = Math.min(ch, box.y + box.h + pad);
  const w = x1 - x0, h = y1 - y0;
  const outW = Math.min(w * scale, 360), sc = outW / w, outH = Math.round(h * sc);
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = x0 + Math.min(w - 1, Math.floor(x / sc)), sy = y0 + Math.min(h - 1, Math.floor(y / sc));
    const s = (sy * cw + sx) * 4, d = (y * outW + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
  }
  // Outline the detected box (cyan, 2px)
  const bx0 = Math.round((box.x - x0) * sc), by0 = Math.round((box.y - y0) * sc);
  const bx1 = Math.round((box.x + box.w - x0) * sc) - 1, by1 = Math.round((box.y + box.h - y0) * sc) - 1;
  const set = (x, y) => { if (x < 0 || y < 0 || x >= outW || y >= outH) return; const d = (y * outW + x) * 4; out[d] = 47; out[d + 1] = 214; out[d + 2] = 240; };
  for (let t = 0; t < 2; t++) {
    for (let x = bx0; x <= bx1; x++) { set(x, by0 + t); set(x, by1 - t); }
    for (let y = by0; y <= by1; y++) { set(bx0 + t, y); set(bx1 - t, y); }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * Run all visible-mark detectors. `toDataUrl(rgba, w, h)` builds an evidence image (async, optional).
 * @returns {Promise<{findings: any[], debug: any}>}
 */
export async function detectVisibleMarks(rgba, cw, ch, W, H, toDataUrl) {
  const findings = [];
  const g = findGeminiSparkle(rgba, cw, ch, W, H);
  const level = classifySparkle(g);
  if (level) {
    const ev = [{ text: `${g.size}×${g.size} px sparkle at ${g.marginRight} px from the right and ${g.marginBottom} px from the bottom · match ${(g.spatial * 100).toFixed(0)}% · edge match ${(g.grad * 100).toFixed(0)}%` }];
    if (toDataUrl) {
      const c = evidenceCrop(rgba, cw, ch, { x: g.x - (W - cw), y: g.y - (H - ch), w: g.size, h: g.size });
      try { ev.unshift({ image: await toDataUrl(c.data, c.width, c.height), text: 'Bottom-right corner, zoomed. The outline marks the detected watermark.' }); } catch { /* preview optional */ }
    }
    findings.push(finding({
      id: 'watermark.gemini',
      category: 'watermark',
      strength: level,
      title: level === 'strong' ? 'Gemini visible watermark (sparkle) found' : 'Possible Gemini sparkle watermark',
      detail: 'The bottom-right corner contains the semi-transparent ✦ sparkle that Google Gemini (Nano Banana) stamps on generated images. Its shape, size and position match Gemini\'s watermark alpha map.',
      why: 'Gemini adds this visible mark to images made in the Gemini app. It is blended at a fixed opacity, so its exact shape can be matched even when all metadata has been removed. Cropping or heavy editing can hide it; Google\'s invisible SynthID watermark can only be checked in the Gemini app.',
      evidence: ev,
      location: 'Image pixels, bottom-right corner',
    }));
  }
  if (findDalleBar(rgba, cw, ch)) {
    findings.push(finding({
      id: 'watermark.dalle', category: 'watermark', strength: 'strong',
      title: 'DALL·E colour-bar watermark found',
      detail: 'Five coloured squares (yellow, cyan, green, red, blue) in the bottom-right corner.',
      why: 'OpenAI\'s DALL·E 2 stamped this colour signature on every generated image.',
      location: 'Image pixels, bottom-right corner',
    }));
  }
  return { findings, debug: g };
}

/** Size of the bottom-right region to analyse for an image of W×H. */
export function cornerBox(W, H) {
  const side = Math.max(160, Math.min(520, Math.round(0.12 * Math.max(W, H)) + 140));
  const cw = Math.min(W, side), ch = Math.min(H, side);
  return { x: W - cw, y: H - ch, w: cw, h: ch };
}
