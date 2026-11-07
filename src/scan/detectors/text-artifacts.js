import { TEXT_ARTIFACTS, HIDDEN_CHARS } from '../rules.js';
import { finding, snippet, lineOf } from '../findings.js';

const MAX_EVIDENCE = 4;

/** Detect chatbot copy/paste residue. `where` is a human label like "document body". */
export function detectArtifacts(text, where = 'text') {
  const out = [];
  if (!text) return out;
  for (const rule of TEXT_ARTIFACTS) {
    rule.re.lastIndex = 0;
    const ev = [];
    let count = 0;
    let m;
    let firstLine = 0;
    while ((m = rule.re.exec(text))) {
      if (m[0].length === 0) { rule.re.lastIndex++; continue; }
      count++;
      if (ev.length < MAX_EVIDENCE) {
        const start = m.index + (m[0].length - m[0].trimStart().length);
        ev.push(snippet(text, start, m.index + m[0].length));
        if (!firstLine) firstLine = lineOf(text, m.index);
      }
      if (count > 500) break;
    }
    if (count) {
      out.push(finding({
        id: `artifact.${rule.id}`,
        category: 'artifact',
        strength: rule.strength,
        title: rule.title,
        detail: `${count} occurrence${count > 1 ? 's' : ''} in ${where}`,
        why: rule.why,
        evidence: ev,
        location: `${where}, line ${firstLine}`,
      }));
    }
  }
  return out;
}

const HIDDEN = new Map(HIDDEN_CHARS.map((h) => [h.cp, h.name]));
const STRONGISH = new Set([0x200b, 0x200c, 0x2060, 0x2062, 0x2063, 0x180e]);

/** Detect invisible Unicode characters (possible watermarks or generator artefacts). */
export function detectHiddenChars(text, where = 'text') {
  if (!text) return [];
  const counts = new Map();
  const firstAt = new Map();
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (!HIDDEN.has(cp)) continue;
    if (cp === 0xfeff && i === 0) continue; // leading BOM is normal
    if (cp === 0x200d) {
      // ZWJ inside emoji sequences is legitimate
      const prev = text.charCodeAt(i - 1), next = text.charCodeAt(i + 1);
      if ((prev >= 0xd800 && prev <= 0xdfff) || prev === 0xfe0f || (next >= 0xd800 && next <= 0xdfff)) continue;
    }
    counts.set(cp, (counts.get(cp) || 0) + 1);
    if (!firstAt.has(cp)) firstAt.set(cp, i);
  }
  if (!counts.size) return [];
  let total = 0, strongish = 0;
  const parts = [];
  for (const [cp, n] of counts) {
    total += n;
    if (STRONGISH.has(cp)) strongish += n;
    parts.push(`${n}× U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${HIDDEN.get(cp)}`);
  }
  const strength = strongish >= 3 ? 'moderate' : 'weak';
  const evidence = [...firstAt.entries()].slice(0, 3).map(([cp, i]) => {
    const s = snippet(text, i, i + 1, 40);
    s.text = s.text.replace(/[​‌‍⁠﻿ ­⁢⁣᠎]/g, '⟦·⟧');
    return { text: s.text };
  });
  return [finding({
    id: 'hidden.unicode',
    category: 'hidden',
    strength,
    title: 'Invisible Unicode characters',
    detail: parts.join(', '),
    why: 'Zero-width and other invisible characters are used by some AI watermarking schemes and appear in text copied from AI tools. They can also come from web pages, so treat this as corroborating evidence.',
    evidence,
    location: where,
  })];
}
