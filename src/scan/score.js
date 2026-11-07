import { WEIGHTS } from './rules.js';

export const VERDICTS = {
  strong: { label: 'Strong evidence', short: 'AI detected', tone: 'danger' },
  likely: { label: 'Likely AI', short: 'Likely AI', tone: 'warning' },
  possible: { label: 'Possible signals', short: 'Possible', tone: 'info' },
  clean: { label: 'No AI signals', short: 'Clear', tone: 'success' },
  error: { label: 'Could not scan', short: 'Error', tone: 'neutral' },
};

/** Probability-style combination: 1 - Π(1 - wᵢ). Repeated finding ids count once. */
export function combine(findings) {
  let keep = 1;
  const seen = new Set();
  for (const f of findings) {
    if (f.strength === 'info') continue;
    const key = f.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const w = f.weight ?? WEIGHTS[f.strength] ?? 0;
    keep *= 1 - w;
  }
  return 1 - keep;
}

export function verdictFor(score, findings) {
  const hasStrong = findings.some((f) => f.strength === 'strong');
  if (score >= 80 && hasStrong) return 'strong';
  if (score >= 50) return 'likely';
  if (score >= 20) return 'possible';
  return 'clean';
}

/** Score a node and its children in place (children first). */
export function scoreNode(node) {
  let childMax = 0;
  let childFlagged = 0;
  let childStrong = false;
  for (const c of node.children || []) {
    scoreNode(c);
    childMax = Math.max(childMax, c.score / 100);
    if (c.verdict !== 'clean' && c.verdict !== 'error') childFlagged++;
    if (c.verdict === 'strong') childStrong = true;
  }
  const own = combine(node.findings);
  const total = 1 - (1 - own) * (1 - childMax);
  node.score = Math.round(total * 100);
  if (node.error && !node.findings.length && !node.children?.length) { node.verdict = 'error'; node.score = 0; return node; }
  node.verdict = verdictFor(node.score, node.findings);
  if (childStrong && node.score >= 80) node.verdict = 'strong';
  node.flaggedChildren = childFlagged;
  return node;
}
