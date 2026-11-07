import { CODE_MARKERS } from '../rules.js';
import { finding, snippet, lineOf } from '../findings.js';

const COMMENT_LINE = /^\s*(?:#(?!!)|\/\/|\/\*|\*|--|<!--|;|%|')/;
const EMOJI_LOG = /(?:print|console\.(?:log|info|warn|error)|logger\.\w+|log\.\w+|echo|puts|println!?|fmt\.Print\w*|System\.out\.print\w*)\s*\(?\s*[`'"f]*[^\n]*?[\u{1F300}-\u{1FAFF}✅❌⚠✨⭐]/gu;

export function detectCode(text, where = 'code') {
  const out = [];
  if (!text) return out;
  const style = [];
  for (const rule of CODE_MARKERS) {
    rule.re.lastIndex = 0;
    const ev = [];
    let count = 0, m, first = 0;
    while ((m = rule.re.exec(text))) {
      if (!m[0]) { rule.re.lastIndex++; continue; }
      count++;
      if (ev.length < 3) ev.push(snippet(text, m.index, m.index + m[0].length, 50));
      if (!first) first = lineOf(text, m.index);
      if (count > 200) break;
    }
    if (!count) continue;
    if (rule.style) { style.push({ rule, count, ev, first }); continue; }
    out.push(finding({
      id: `code.${rule.title.toLowerCase().replace(/\W+/g, '-')}`,
      category: 'code',
      strength: rule.strength,
      title: rule.title,
      detail: `${count} occurrence${count > 1 ? 's' : ''}`,
      why: 'Developers and AI tools sometimes leave explicit attribution in code, commit trailers or headers. This is direct evidence that an AI tool produced or co-wrote the code.',
      evidence: ev,
      location: `${where}, line ${first}`,
    }));
  }

  // Emoji in log/print statements is a strong stylistic habit of current coding assistants.
  EMOJI_LOG.lastIndex = 0;
  const emojiLogs = [...text.matchAll(EMOJI_LOG)];
  if (emojiLogs.length >= 3) {
    style.push({
      rule: { title: 'Emoji in log/print statements', strength: 'weak' },
      count: emojiLogs.length,
      ev: emojiLogs.slice(0, 3).map((m) => snippet(text, m.index, m.index + m[0].length, 20)),
      first: lineOf(text, emojiLogs[0].index),
    });
  }

  // Comment density
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length >= 40) {
    const comments = lines.filter((l) => COMMENT_LINE.test(l)).length;
    const ratio = comments / lines.length;
    if (ratio > 0.42) {
      style.push({ rule: { title: `Very high comment density (${Math.round(ratio * 100)}% of lines)`, strength: 'weak' }, count: comments, ev: [], first: 1 });
    }
  }

  if (style.length) {
    const strongest = style.some((s) => s.rule.strength === 'moderate') || style.length >= 3 ? 'moderate' : 'weak';
    out.push(finding({
      id: 'code.style',
      category: 'code',
      strength: strongest,
      title: 'Code style typical of AI assistants',
      detail: style.map((s) => `${s.rule.title}${s.count > 1 && !/density/.test(s.rule.title) ? ` ×${s.count}` : ''}`).join('\n'),
      why: 'Tutorial-style comments, "Example usage" blocks, placeholder credentials, elided-code comments and emoji-decorated logs are habits of code assistants. Humans write these too, so this is a soft signal.',
      evidence: style.flatMap((s) => s.ev).slice(0, 4),
      location: where,
    }));
  }
  return out;
}
