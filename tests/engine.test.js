import { describe, it, expect, beforeAll } from 'vitest';
import { buildSamples } from '../src/samples/samples.js';
import { scanBytes } from '../src/scan/engine.js';
import { zip, png, pdf, docx } from '../src/samples/builders.js';
import { encodeUtf8 } from '../src/lib/bytes.js';
import { metrics, composite } from '../src/scan/detectors/stylometry.js';

let samples;
const results = {};
const ids = (node) => {
  const out = new Set(node.findings.map((f) => f.id));
  for (const c of node.children || []) for (const i of ids(c)) out.add(i);
  return out;
};

beforeAll(async () => {
  samples = await buildSamples();
  for (const s of samples) results[s.name] = await scanBytes(s.bytes, s.name);
}, 60_000);

describe('sample files', () => {
  it('every sample matches its expected verdict', () => {
    for (const s of samples) {
      const r = results[s.name];
      expect.soft(r.verdict, `${s.name}: ${JSON.stringify(r.findings.map((f) => [f.id, f.strength]))} ${r.error || ''}`).toBe(s.expect);
    }
  });

  it('PNG: detects A1111 parameters chunk and generator resolution', () => {
    const f = ids(results['sd-portrait.png']);
    expect(f.has('prov.png.parameters')).toBe(true);
    expect(f.has('meta.dimensions')).toBe(true);
    expect(results['sd-portrait.png'].meta.width).toBe(512);
  });

  it('JPEG: detects IPTC trainedAlgorithmicMedia and CreatorTool', () => {
    const f = ids(results['firefly-poster.jpg']);
    expect(f.has('prov.iptc.trainedAlgorithmicMedia')).toBe(true);
    expect([...f].some((i) => i.startsWith('meta.tool.adobe-firefly'))).toBe(true);
  });

  it('JPEG: camera EXIF is parsed and reported as context only', () => {
    const r = results['holiday-photo.jpg'];
    expect(r.meta.exif.Make).toBe('Canon');
    expect(r.meta.exif.ExposureTime).toBe('1/250');
    expect(ids(r).has('ctx.camera')).toBe(true);
    expect(r.score).toBe(0);
  });

  it('DOCX: ChatGPT citation, utm link, openers and style', () => {
    const f = ids(results['market-report.docx']);
    for (const id of ['artifact.oai-cite', 'artifact.utm-ai', 'artifact.assistant-opener', 'artifact.assistant-closer', 'style.llm']) expect(f.has(id), id).toBe(true);
    expect(results['market-report.docx'].format).toBe('docx');
  });

  it('XLSX: COPILOT() formulas', () => {
    const r = results['q3-forecast.xlsx'];
    expect(ids(r).has('formula.ai')).toBe(true);
    expect(r.meta.sheets).toEqual(['Forecast']);
  });

  it('PDF: producer metadata and AI disclaimer in text', () => {
    const r = results['pitch-deck.pdf'];
    const f = ids(r);
    expect(r.meta.parseError).toBeUndefined();
    expect(r.meta.pages).toBe(1);
    expect([...f].some((i) => i.startsWith('meta.tool.gamma'))).toBe(true);
    expect(f.has('artifact.as-an-ai')).toBe(true);
  });

  it('ZIP: repo markers, code markers, nested archive', () => {
    const r = results['weather-app-src.zip'];
    const f = ids(r);
    expect(f.has('repo.cursor')).toBe(true);
    expect([...f].some((i) => i.startsWith('code.explicit'))).toBe(true);
    expect(f.has('code.style')).toBe(true);
    const nested = r.children.find((c) => c.name === 'archive.zip');
    expect(nested.kind).toBe('archive');
    expect(nested.children[0].name).toBe('notes.txt');
  });

  it('human-written control text has no signals', () => {
    expect(results['allotment-notes.txt'].findings).toEqual([]);
  });
});

describe('false-positive guards', () => {
  it('person named Claude in Author does not trigger', async () => {
    const r = await scanBytes(pdf(['Hello world'], { Author: 'Claude Monet', Creator: 'Microsoft Word', Producer: 'macOS Quartz PDFContext' }), 'a.pdf');
    expect(r.verdict).toBe('clean');
  });
  it('Copilot as lastModifiedBy does trigger', async () => {
    const r = await scanBytes(docx(['Quarterly notes.'], { lastModifiedBy: 'Copilot' }), 'b.docx');
    expect(ids(r).has('meta.person.lastmodifiedby')).toBe(true);
  });
  it('leading BOM and emoji ZWJ sequences are not hidden-char findings', async () => {
    const r = await scanBytes(encodeUtf8('﻿Family: 👨‍👩‍👧 at the beach'), 'c.txt');
    expect(r.findings).toEqual([]);
  });
  it('zero-width spaces are flagged', async () => {
    const r = await scanBytes(encodeUtf8('This​ sentence​ has​ hidden​ marks.'), 'd.txt');
    expect(ids(r).has('hidden.unicode')).toBe(true);
  });
  it('plain PNG without metadata is clean', async () => {
    const r = await scanBytes(await png(300, 200), 'e.png');
    expect(r.verdict).toBe('clean');
  });
  it('ComfyUI workflow chunk is detected', async () => {
    const r = await scanBytes(await png(64, 64, { prompt: '{"3":{"class_type":"KSampler"}}' }), 'f.png');
    expect(ids(r).has('prov.png.prompt')).toBe(true);
  });
});

describe('zip safety', () => {
  it('handles an empty archive', async () => {
    const r = await scanBytes(zip([]), 'empty.zip');
    expect(r.kind).toBe('archive');
    expect(r.verdict).toBe('clean');
  });
  it('reports corrupt archives as errors without throwing', async () => {
    const r = await scanBytes(encodeUtf8('PK\u0003\u0004 garbage'), 'bad.zip');
    expect(r.verdict).toBe('error');
  });
});

describe('stylometry', () => {
  it('scores LLM-flavoured prose above human notes', () => {
    const ai = 'In today\'s fast-paced world, it is important to note that we must delve into the rich tapestry of innovation. '.repeat(40);
    const human = 'Went to the shop. Forgot milk again, obviously. Dave rang about the car — the garage reckons it\'s the clutch, which, great, another £400. Kids were fine. '.repeat(20);
    expect(composite(metrics(ai))).toBeGreaterThan(composite(metrics(human)));
  });
});
