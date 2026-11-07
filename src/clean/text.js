// Text-level cleaners shared by every format that carries text.
import { TEXT_ARTIFACTS, HIDDEN_CHARS, CODE_MARKERS } from '../scan/rules.js';
import { lineOf } from '../scan/findings.js';

const TOKEN_IDS = new Set(['oai-cite', 'oai-contentref', 'oai-entity']);
const MANUAL_IDS = new Set(['as-an-ai', 'knowledge-cutoff', 'chat-ui', 'assistant-opener', 'assistant-closer', 'placeholder', 'meta-prompt']);
const TOKEN_RES = TEXT_ARTIFACTS.filter((r) => TOKEN_IDS.has(r.id)).map((r) => new RegExp(r.re.source, r.re.flags));
const MANUAL_RES = TEXT_ARTIFACTS.filter((r) => MANUAL_IDS.has(r.id));
const UTM = /([?&]|&amp;)utm_source=(?:chatgpt\.com|openai|perplexity(?:\.ai)?|copilot\.microsoft\.com|claude\.ai|gemini)(&amp;|&)?/gi;
const HIDDEN = new Set(HIDDEN_CHARS.map((h) => h.cp));
const ATTRIBUTION = CODE_MARKERS.filter((m) => m.strength === 'strong');

/** Remove chatbot citation tokens and AI-tracking query params. */
export function cleanTokens(text) {
  let n = 0;
  for (const re of TOKEN_RES) {
    re.lastIndex = 0;
    // Remove a single space before a citation so "growth 【4†source】." becomes "growth."
    text = text.replace(new RegExp(`[ \\u00a0]?(?:${re.source})`, re.flags), () => { n++; return ''; });
  }
  text = text.replace(UTM, (m, sep, amp) => {
    n++;
    const isQ = sep === '?';
    if (amp) return isQ ? '?' : sep; // keep the separator for the following param
    return '';
  });
  return { text, n };
}

/** Remove invisible Unicode (keeps a leading BOM and emoji ZWJ sequences; NNBSP becomes a space). */
export function cleanHidden(text) {
  let n = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (!HIDDEN.has(cp) || (cp === 0xfeff && i === 0)) { out += text[i]; continue; }
    if (cp === 0x200d) {
      const prev = text.charCodeAt(i - 1), next = text.charCodeAt(i + 1);
      if ((prev >= 0xd800 && prev <= 0xdfff) || prev === 0xfe0f || (next >= 0xd800 && next <= 0xdfff)) { out += text[i]; continue; }
    }
    n++;
    if (cp === 0x202f) out += ' ';
  }
  return { text: out, n };
}

/** Remove whole lines that attribute code to an AI tool (comments, banners, Co-Authored-By trailers). */
export function cleanAttribution(text) {
  let n = 0;
  const lines = text.split(/(?<=\n)/);
  const kept = lines.filter((line) => {
    for (const m of ATTRIBUTION) {
      m.re.lastIndex = 0;
      if (m.re.test(line)) { n++; return false; }
    }
    return true;
  });
  return { text: kept.join(''), n };
}

/** Assistant phrases we never auto-delete: report them for a manual edit. */
export function manualPhrases(text, where, max = 12) {
  const out = [];
  for (const r of MANUAL_RES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text)) && out.length < max) {
      if (!m[0]) { r.re.lastIndex++; continue; }
      out.push({ label: r.title, text: m[0].trim().slice(0, 80), where: `${where}, line ${lineOf(text, m.index)}` });
    }
  }
  return out;
}

/** Apply the selected text cleaners. Returns the new text and counts per item key. */
export function cleanText(text, items) {
  const removed = {};
  if (items.has('tokens')) { const r = cleanTokens(text); text = r.text; if (r.n) removed.tokens = r.n; }
  if (items.has('hidden')) { const r = cleanHidden(text); text = r.text; if (r.n) removed.hidden = r.n; }
  return { text, removed };
}

export function mergeCounts(into, from) {
  for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v;
  return into;
}
