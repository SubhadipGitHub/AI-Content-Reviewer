import { AI_VOCAB, AI_PHRASES } from '../rules.js';
import { finding } from '../findings.js';

const VOCAB = new Set(AI_VOCAB);
const MIN_WORDS = 300;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** Compute stylometric metrics for prose. Exported for tests. */
export function metrics(text) {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const words = clean.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  const wc = words.length;
  const sentences = clean
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])|\n{2,}/)
    .map((s) => (s.match(/[A-Za-z][A-Za-z'-]*/g) || []).length)
    .filter((n) => n >= 3);
  const mean = sentences.reduce((a, b) => a + b, 0) / (sentences.length || 1);
  const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / (sentences.length || 1));
  const burstiness = mean ? sd / mean : 0;

  let vocabHits = 0;
  const vocabSeen = new Map();
  for (const w of words) if (VOCAB.has(w)) { vocabHits++; vocabSeen.set(w, (vocabSeen.get(w) || 0) + 1); }

  let phraseHits = 0;
  for (const re of AI_PHRASES) { re.lastIndex = 0; phraseHits += (clean.match(re) || []).length; }

  const emDashes = (clean.match(/—/g) || []).length;
  // Moving-average type-token ratio over 100-word windows (length-independent lexical diversity).
  let mattr = 0, windows = 0;
  for (let i = 0; i + 100 <= wc; i += 50) { mattr += new Set(words.slice(i, i + 100)).size / 100; windows++; }
  mattr = windows ? mattr / windows : 0;

  const paras = clean.split(/\n\s*\n/).map((p) => p.trim().split(/\s+/).length).filter((n) => n > 15);
  const pMean = paras.reduce((a, b) => a + b, 0) / (paras.length || 1);
  const pSd = Math.sqrt(paras.reduce((a, b) => a + (b - pMean) ** 2, 0) / (paras.length || 1));
  const paraUniformity = paras.length >= 4 && pMean ? 1 - clamp(pSd / pMean) : 0;

  const boldBullets = (text.match(/^\s*(?:[-*•]|\d+\.)\s+\*\*[^*\n]{2,60}\*\*:?/gm) || []).length;

  return {
    words: wc,
    sentences: sentences.length,
    burstiness,
    vocabPer1k: (vocabHits / (wc || 1)) * 1000,
    vocabTop: [...vocabSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => `${w} ×${n}`),
    phrasesPer1k: (phraseHits / (wc || 1)) * 1000,
    emDashPer1k: (emDashes / (wc || 1)) * 1000,
    mattr,
    paraUniformity,
    boldBullets,
  };
}

/** Composite 0..1 "reads like an LLM" score. */
export function composite(m) {
  const sBurst = clamp((0.55 - m.burstiness) / 0.3);        // low variation in sentence length
  const sVocab = clamp(m.vocabPer1k / 12);                   // ~12 AI-favoured words per 1k is very high
  const sPhrase = clamp(m.phrasesPer1k / 4);
  const sDash = clamp((m.emDashPer1k - 2) / 8);
  const sPara = clamp((m.paraUniformity - 0.55) / 0.35);
  const sBold = clamp(m.boldBullets / 6);
  return clamp(0.24 * sBurst + 0.28 * sVocab + 0.2 * sPhrase + 0.1 * sDash + 0.08 * sPara + 0.1 * sBold);
}

export function detectStyle(text, where = 'text') {
  if (!text) return [];
  const m = metrics(text);
  if (m.words < MIN_WORDS) return [];
  const c = composite(m);
  if (c < 0.35) return [];
  const strength = c >= 0.6 ? 'moderate' : 'weak';
  const detail = [
    `Sentence-length variation (burstiness) ${m.burstiness.toFixed(2)}${m.burstiness < 0.45 ? ' — unusually uniform' : ''}`,
    `AI-favoured vocabulary ${m.vocabPer1k.toFixed(1)} per 1,000 words${m.vocabTop.length ? ` (${m.vocabTop.join(', ')})` : ''}`,
    `Stock phrases ${m.phrasesPer1k.toFixed(1)} per 1,000 words`,
    `Em-dashes ${m.emDashPer1k.toFixed(1)} per 1,000 words`,
    m.boldBullets ? `${m.boldBullets} bolded-label bullet points` : null,
    `Lexical diversity (MATTR) ${m.mattr.toFixed(2)} over ${m.words.toLocaleString('en')} words`,
  ].filter(Boolean).join('\n');
  return [finding({
    id: 'style.llm',
    category: 'style',
    strength,
    title: 'Writing style resembles LLM output',
    detail,
    why: 'Statistical patterns only: low variation in sentence length, heavy use of words like "delve" or "tapestry", stock phrases, and uniform structure. Skilled human writers can trigger this, so it can never make a file "Strong evidence" on its own.',
    location: where,
    weight: Math.min(0.45, c * 0.55),
    score: Math.round(c * 100),
  })];
}
