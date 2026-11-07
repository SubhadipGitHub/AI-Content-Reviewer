import { decodeUtf8, decodeUtf16 } from '../../lib/bytes.js';
import { detectArtifacts, detectHiddenChars } from '../detectors/text-artifacts.js';
import { detectStyle } from '../detectors/stylometry.js';
import { detectCode } from '../detectors/code.js';
import { checkFields } from '../detectors/metadata.js';
import { CODE_EXTENSIONS } from '../rules.js';

/** Decode bytes to string, honouring UTF-16 BOMs. */
export function decodeText(b) {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return decodeUtf16(b);
  return decodeUtf8(b);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip HTML to visible text while keeping block boundaries. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/** Run all prose detectors over a text body. */
export function analyzeProse(text, where) {
  return [...detectArtifacts(text, where), ...detectHiddenChars(text, where), ...detectStyle(text, where)];
}

/**
 * Scan a text-like file.
 * @param {string} text
 * @param {string} ext lowercase extension
 */
export function scanText(text, ext) {
  const findings = [];
  const meta = { chars: text.length, lines: text.split('\n').length };
  let prose = text;

  if (ext === 'html' || ext === 'htm' || ext === 'svg') {
    const gens = {};
    for (const m of text.matchAll(/<meta\s+[^>]*name=["'](generator|author|ai-generated|creator)["'][^>]*content=["']([^"']+)["']/gi)) gens[m[1]] = m[2];
    for (const m of text.matchAll(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["'](generator|author|ai-generated|creator)["']/gi)) gens[m[2]] = m[1];
    if (Object.keys(gens).length) { meta.htmlMeta = gens; findings.push(...checkFields(gens, 'HTML <meta>')); }
    findings.push(...detectArtifacts(text, 'markup')); // links with utm_source=chatgpt.com live in attributes
    prose = htmlToText(text);
    findings.push(...detectHiddenChars(prose, 'page text'), ...detectStyle(prose, 'page text'));
  } else if (ext === 'ipynb') {
    try {
      const nb = JSON.parse(text);
      const cells = (nb.cells || []).map((c) => ({ type: c.cell_type, src: Array.isArray(c.source) ? c.source.join('') : String(c.source || '') }));
      const code = cells.filter((c) => c.type === 'code').map((c) => c.src).join('\n\n');
      const md = cells.filter((c) => c.type === 'markdown').map((c) => c.src).join('\n\n');
      meta.cells = cells.length;
      findings.push(...detectCode(code, 'notebook code cells'), ...analyzeProse(md, 'notebook markdown'));
      findings.push(...detectArtifacts(JSON.stringify(nb.metadata || {}), 'notebook metadata'));
    } catch { findings.push(...detectCode(text, 'notebook')); }
  } else if (CODE_EXTENSIONS.has(ext)) {
    findings.push(...detectCode(text, 'source'), ...detectArtifacts(text, 'source'), ...detectHiddenChars(text, 'source'));
    // Prose inside large comment/docstring blocks
    const comments = [...text.matchAll(/\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''/g)].map((m) => m[0]).join('\n');
    if (comments.length > 2000) findings.push(...detectStyle(comments, 'comments/docstrings'));
  } else if (ext === 'rtf') {
    prose = text.replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    findings.push(...analyzeProse(prose, 'document'));
  } else if (ext === 'eml') {
    findings.push(...analyzeProse(text, 'message'));
  } else if (ext === 'commit_editmsg' || /^(?:head|orig_head)$/.test(ext)) {
    findings.push(...detectCode(text, 'git metadata'));
  } else {
    findings.push(...analyzeProse(text, 'text'));
    if (/^(md|markdown|txt)$/.test(ext)) findings.push(...detectCode(text, 'text').filter((f) => f.strength === 'strong'));
  }
  meta.words = (prose.match(/\S+/g) || []).length;
  return { findings, meta, preview: prose.slice(0, 4000) };
}
