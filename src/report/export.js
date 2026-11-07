// Report exports: JSON (full evidence), CSV (one row per file/finding) and a
// self-contained HTML report that can be emailed or archived.

import { escapeHtml as e, highlight } from '../lib/dom.js';
import { VERDICTS } from '../scan/score.js';
import { CATEGORIES } from '../scan/findings.js';
import { RULES_VERSION } from '../scan/rules.js';

function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15_000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const strip = (n) => ({ ...n, preview: undefined, children: (n.children || []).map(strip) });

function walk(node, fn, depth = 0) { fn(node, depth); for (const c of node.children || []) walk(c, fn, depth + 1); }

export function toCSV(results) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['file', 'path', 'kind', 'format', 'size_bytes', 'verdict', 'score', 'finding', 'strength', 'category', 'detail', 'location']];
  for (const r of results) {
    walk(r, (n) => {
      const fs = n.findings.filter((f) => f.strength !== 'info');
      if (!fs.length && n !== r) return;
      if (!fs.length) rows.push([r.name, n.path, n.kind, n.format, n.size, n.verdict, n.score, '', '', '', '', '']);
      for (const f of fs) rows.push([r.name, n.path, n.kind, n.format, n.size, n.verdict, n.score, f.title, f.strength, f.category, (f.detail || '').replace(/\n/g, ' | '), f.location || '']);
    });
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

const TONE = { danger: '#e11d48', warning: '#d97706', info: '#2563eb', success: '#059669', neutral: '#64748b' };

export function toHTML(results) {
  const files = results.map((r) => {
    const v = VERDICTS[r.verdict] || VERDICTS.error;
    const findings = [];
    walk(r, (n) => { for (const f of n.findings) if (f.strength !== 'info') findings.push({ ...f, where: n === r ? '' : n.path }); });
    return `<section class="file"><header><div><h2>${e(r.name)}</h2><p class="m">${e(r.kind)} · ${e((r.format || '').toUpperCase())} · ${(r.size / 1024).toFixed(1)} KB</p></div>
      <div class="v" style="--c:${TONE[v.tone]}"><b>${r.score}</b><span>${e(v.label)}</span></div></header>
      ${findings.length ? findings.map((f) => `<div class="f"><div class="fh"><strong>${e(f.title)}</strong><em class="s-${f.strength}">${f.strength}</em></div>
        <p class="m">${e(CATEGORIES[f.category] || f.category)}${f.where ? ` · ${e(f.where)}` : ''}${f.location ? ` · ${e(f.location)}` : ''}</p>
        ${f.detail ? `<p>${e(f.detail).replace(/\n/g, '<br>')}</p>` : ''}
        ${(f.evidence || []).map((x) => (x.image && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(x.image) ? `<figure><img src="${x.image}" alt="" style="max-width:320px;image-rendering:pixelated;border-radius:8px"><figcaption class="m">${e(x.text || '')}</figcaption></figure>` : `<pre>${highlight(x.text, x.ranges)}</pre>`)).join('')}</div>`).join('') : '<p class="ok">No AI identifiers found.</p>'}
      ${(r.notes || []).map((n) => `<p class="note">${e(n)}</p>`).join('')}</section>`;
  }).join('');
  const counts = Object.fromEntries(Object.keys(VERDICTS).map((k) => [k, results.filter((r) => r.verdict === k).length]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Content Review Report</title>
<style>body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#141629;background:#f5f6fb;margin:0;padding:32px 16px}main{max-width:860px;margin:auto}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.02em}.m{color:#5d6590;font-size:13px;margin:2px 0}.sum{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 26px}.sum span{background:#fff;border:1px solid #e3e5f2;border-radius:99px;padding:6px 12px;font-size:13px}
.file{background:#fff;border:1px solid #e3e5f2;border-radius:16px;padding:20px;margin-bottom:16px}.file header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:10px}
h2{font-size:17px;margin:0;word-break:break-all}.v{text-align:center;color:var(--c);border:2px solid var(--c);border-radius:14px;padding:6px 14px;min-width:92px}.v b{display:block;font-size:24px}.v span{font-size:12px;font-weight:600}
.f{border-top:1px solid #eef0f7;padding:12px 0}.fh{display:flex;justify-content:space-between;gap:12px}em{font-style:normal;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.s-strong{color:#e11d48}.s-moderate{color:#d97706}.s-weak{color:#2563eb}
pre{white-space:pre-wrap;word-break:break-word;background:#f5f6fb;border:1px solid #e3e5f2;border-radius:10px;padding:10px;font-size:12px}mark{background:#fde68a;border-radius:3px}.ok{color:#059669;font-weight:600}.note{font-size:13px;color:#5d6590;background:#f5f6fb;padding:8px 10px;border-radius:8px}
footer{color:#5d6590;font-size:12px;margin-top:24px}</style></head><body><main>
<h1>AI Content Review Report</h1><p class="m">Generated ${e(new Date().toLocaleString())} · ${results.length} file(s) · rules ${RULES_VERSION}</p>
<div class="sum">${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `<span>${e(VERDICTS[k].label)}: <b>${n}</b></span>`).join('')}</div>
${files}<footer>Produced offline by AI Content Reviewer. Signals indicate AI involvement; they are evidence for review, not legal proof. Content Credentials signatures are not cryptographically verified offline.</footer></main></body></html>`;
}

export function exportFile(result, format) {
  exportMany([result], format, result.name.replace(/\.[^.]+$/, ''));
}

export function exportMany(results, format, base = `ai-review-${stamp()}`) {
  if (format === 'json') download(`${base}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), rulesVersion: RULES_VERSION, results: results.map(strip) }, null, 2), 'application/json');
  else if (format === 'csv') download(`${base}.csv`, '﻿' + toCSV(results), 'text/csv');
  else download(`${base}.html`, toHTML(results), 'text/html');
}
