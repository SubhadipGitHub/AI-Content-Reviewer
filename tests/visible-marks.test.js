import { describe, it, expect } from 'vitest';
import { findGeminiSparkle, classifySparkle, findDalleBar, cornerBox, detectVisibleMarks } from '../src/scan/detectors/visible-marks.js';
import { decodePngRegion } from '../src/scan/pngdecode.js';
import { pngFromRGBA, proceduralRGBA, jpegWithSegments, exifSegment } from '../src/samples/builders.js';
import { stampGeminiSparkle } from '../src/samples/samples.js';
import { SEED_JPEG_B64 } from '../src/samples/seed-jpeg.js';
import { scanBytes } from '../src/scan/engine.js';
import { encodeUtf8 } from '../src/lib/bytes.js';

// Deterministic PRNG for textured backgrounds
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function noiseRGBA(W, H, amp, seed = 7) {
  const r = rng(seed), out = proceduralRGBA(W, H, 0.9);
  for (let i = 0; i < out.length; i += 4) {
    const n = (r() - 0.5) * amp;
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] + n));
  }
  return out;
}

function flatRGBA(W, H, v) { const o = new Uint8Array(W * H * 4); o.fill(v); for (let i = 3; i < o.length; i += 4) o[i] = 255; return o; }

function corner(rgba, W, H) {
  const b = cornerBox(W, H);
  const out = new Uint8Array(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) out.set(rgba.subarray(((b.y + y) * W + b.x) * 4, ((b.y + y) * W + b.x + b.w) * 4), y * b.w * 4);
  return { data: out, w: b.w, h: b.h };
}

function detect(rgba, W, H) {
  const c = corner(rgba, W, H);
  const r = findGeminiSparkle(c.data, c.w, c.h, W, H);
  return { r, level: classifySparkle(r) };
}

/** Generic 4-point star (not Gemini's alpha profile) blended in white. */
function stampGenericStar(rgba, W, H, size = 48, margin = 96) {
  const x0 = W - margin - size, y0 = H - margin - size, c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.abs(x + 0.5 - c) / c, dy = Math.abs(y + 0.5 - c) / c;
    const a = Math.max(0, 1 - (Math.sqrt(dx) + Math.sqrt(dy))) * 0.9;
    const i = ((y0 + y) * W + x0 + x) * 4;
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(a * 255 + (1 - a) * rgba[i + k]);
  }
  return rgba;
}

describe('Gemini sparkle detector', () => {
  const cases = [
    { W: 1024, H: 1024, size: 48, margin: 96 },
    { W: 1408, H: 768, size: 48, margin: 32 },
    { W: 2752, H: 1536, size: 96, margin: 64 },
    { W: 2752, H: 1536, size: 96, margin: 192 },
    { W: 720, H: 1457, size: 48, margin: 96 },
  ];
  for (const c of cases) {
    it(`finds a ${c.size}px sparkle at margin ${c.margin} on ${c.W}×${c.H}`, () => {
      const img = stampGeminiSparkle(proceduralRGBA(c.W, c.H, 1.1), c.W, c.H, c);
      const { r, level } = detect(img, c.W, c.H);
      expect(level).toBe('strong');
      expect(Math.abs(r.marginRight - c.margin)).toBeLessThanOrEqual(2);
      expect(r.size).toBe(c.size);
    });
  }

  it('survives a noisy, textured background', () => {
    const W = 1200, H = 896;
    const { level } = detect(stampGeminiSparkle(noiseRGBA(W, H, 40), W, H), W, H);
    expect(['strong', 'moderate']).toContain(level);
  });

  it('finds a faint (60% opacity) sparkle', () => {
    const W = 1024, H = 1024;
    const { level } = detect(stampGeminiSparkle(proceduralRGBA(W, H), W, H, { opacity: 0.6 }), W, H);
    expect(level).toBeTruthy();
  });

  it('does not flag images without the mark', () => {
    for (const [W, H] of [[1024, 1024], [2752, 1536], [720, 1457]]) {
      expect(detect(proceduralRGBA(W, H), W, H).level).toBeNull();
      expect(detect(noiseRGBA(W, H, 60, W), W, H).level).toBeNull();
    }
  });

  it('makes no claim on a flat white corner (mark is invisible there)', () => {
    expect(detect(flatRGBA(1024, 1024, 255), 1024, 1024).level).toBeNull();
    expect(detect(flatRGBA(1024, 1024, 128), 1024, 1024).level).toBeNull();
  });

  it('does not call a generic 4-point star "strong"', () => {
    const W = 1024, H = 1024;
    expect(detect(stampGenericStar(proceduralRGBA(W, H), W, H), W, H).level).not.toBe('strong');
  });

  it('builds an evidence image when a mark is found', async () => {
    const W = 1024, H = 1024;
    const img = stampGeminiSparkle(proceduralRGBA(W, H), W, H);
    const c = corner(img, W, H);
    const { findings } = await detectVisibleMarks(c.data, c.w, c.h, W, H, async () => 'data:image/png;base64,AAAA');
    expect(findings[0].id).toBe('watermark.gemini');
    expect(findings[0].evidence[0].image).toMatch(/^data:image\/png/);
  });
});

describe('DALL·E colour bar', () => {
  it('detects the five-colour signature', () => {
    const W = 200, H = 100, img = flatRGBA(W, H, 40);
    const cols = [[255, 255, 102], [66, 255, 255], [81, 218, 76], [255, 110, 60], [60, 70, 255]];
    for (let k = 0; k < 5; k++) for (let y = H - 16; y < H; y++) for (let x = W - 80 + k * 16; x < W - 64 + k * 16; x++) {
      const i = (y * W + x) * 4; img[i] = cols[k][0]; img[i + 1] = cols[k][1]; img[i + 2] = cols[k][2];
    }
    expect(findDalleBar(img, W, H)).toBe(true);
    expect(findDalleBar(flatRGBA(W, H, 40), W, H)).toBe(false);
  });
});

describe('PNG decoder', () => {
  it('round-trips a region of an RGBA PNG', async () => {
    const W = 300, H = 200, img = proceduralRGBA(W, H);
    const bytes = await pngFromRGBA(img, W, H);
    const r = await decodePngRegion(bytes, 250, 150, 50, 50);
    expect(r.width).toBe(50);
    for (const [x, y] of [[0, 0], [49, 49], [10, 33]]) {
      const s = ((150 + y) * W + 250 + x) * 4, d = (y * 50 + x) * 4;
      expect([...r.data.slice(d, d + 4)]).toEqual([...img.slice(s, s + 4)]);
    }
  });
});

describe('image metadata labels', () => {
  const seed = Uint8Array.from(atob(SEED_JPEG_B64), (c) => c.charCodeAt(0));
  const ids = (n) => n.findings.map((f) => f.id);

  it('TC260 AIGC label in XMP attribute form', async () => {
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description TC260:AIGC="{&quot;Label&quot;:&quot;1&quot;,&quot;ContentProducer&quot;:&quot;picwish&quot;}"/></rdf:RDF></x:xmpmeta>';
    const b = jpegWithSegments(seed, [{ marker: 0xe1, data: encodeUtf8('http://ns.adobe.com/xap/1.0/\0' + xmp) }]);
    const r = await scanBytes(b, 'a.jpg');
    expect(ids(r)).toContain('prov.tc260');
    expect(r.verdict).toBe('strong');
  });

  it('TC260 AIGC label as raw JSON in EXIF ImageDescription (Tencent-style)', async () => {
    const b = jpegWithSegments(seed, [exifSegment({ 0x010e: '{"AIGC":{"Label":"1","ContentProducer":"001191440300708461136T1308L","ProduceID":"abc"}}' })]);
    const r = await scanBytes(b, 'b.jpg');
    expect(ids(r)).toContain('prov.tc260');
  });

  it('ignores an "AIGC" mention without TC260 fields', async () => {
    const b = jpegWithSegments(seed, [{ marker: 0xfe, data: encodeUtf8('AIGC {"team":"design","note":"poster"}') }]);
    const r = await scanBytes(b, 'c.jpg');
    expect(ids(r)).not.toContain('prov.tc260');
  });

  it('IPTC-IIM Credit "Made with Google AI"', async () => {
    const credit = encodeUtf8('Made with Google AI');
    const iim = new Uint8Array([0x1c, 2, 110, 0, credit.length, ...credit]);
    const res = new Uint8Array([...encodeUtf8('8BIM'), 0x04, 0x04, 0, 0, 0, 0, 0, iim.length, ...iim, ...(iim.length % 2 ? [0] : [])]);
    const app13 = new Uint8Array([...encodeUtf8('Photoshop 3.0\0'), ...res]);
    const r = await scanBytes(jpegWithSegments(seed, [{ marker: 0xed, data: app13 }]), 'd.jpg');
    expect(r.meta.iptc.Credit).toBe('Made with Google AI');
    expect(r.verdict).toBe('strong');
  });

  it('xAI Grok EXIF signature', async () => {
    const b = jpegWithSegments(seed, [exifSegment({ 0x010e: 'Signature: ' + 'QUJD'.repeat(20), 0x013b: '3f2b8c1e-9a4d-4e2b-8c7f-1a2b3c4d5e6f' })]);
    const r = await scanBytes(b, 'e.jpg');
    expect(ids(r)).toContain('meta.grok');
  });
});
