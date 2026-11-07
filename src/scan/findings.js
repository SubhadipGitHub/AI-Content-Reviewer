// Finding helpers: every detector returns objects created with `finding()` so the UI,
// scoring and exports can rely on one shape.

/**
 * @typedef {'strong'|'moderate'|'weak'|'info'} Strength
 * @typedef {{ text: string, ranges?: [number, number][] }} Evidence
 * @typedef {{ id: string, category: string, strength: Strength, title: string, detail?: string,
 *   why?: string, evidence?: Evidence[], location?: string, weight?: number }} Finding
 */

export const CATEGORIES = {
  watermark: 'Visible watermarks',
  provenance: 'Provenance & credentials',
  metadata: 'Metadata fingerprints',
  artifact: 'Chatbot artifacts',
  hidden: 'Hidden characters',
  style: 'Writing style',
  code: 'Code markers',
  repo: 'AI tool configuration',
  formula: 'AI formulas',
  context: 'Context',
};

/** @returns {Finding} */
export function finding(f) {
  return { evidence: [], ...f };
}

/** Make a snippet around [start,end) with the match range highlighted. */
export function snippet(text, start, end, pad = 70) {
  const s = Math.max(0, start - pad);
  const e = Math.min(text.length, end + pad);
  let pre = s > 0 ? '…' : '';
  const body = text.slice(s, e).replace(/\s+/g, ' ');
  // Recompute highlight position after whitespace collapse.
  const before = text.slice(s, start).replace(/\s+/g, ' ');
  const match = text.slice(start, end).replace(/\s+/g, ' ');
  const a = pre.length + before.length;
  return { text: pre + body + (e < text.length ? '…' : ''), ranges: [[a, a + match.length]] };
}

/** Line number (1-based) of an offset. */
export function lineOf(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
