import { html, raw } from '../lib/dom.js';
import { icon, fileIcon, VERDICT_ICON } from './icons.js';
import { VERDICTS } from '../scan/score.js';
import { bytes, relTime } from '../lib/format.js';

const C = 2 * Math.PI * 20;

export const toneOf = (verdict) => VERDICTS[verdict]?.tone || 'neutral';

/** Score ring; animates from 0 the first time it is painted (see animateRings). */
export function ring(score, verdict, cls = '', label = '') {
  const off = C * (1 - Math.max(0, Math.min(100, score || 0)) / 100);
  return html`<div class="ring ${cls}" data-tone="${toneOf(verdict)}" role="img" aria-label="AI signal score ${score} out of 100">
    <svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20" fill="none" stroke-width="4"/>
    <circle class="bar" cx="24" cy="24" r="20" fill="none" stroke-width="4" stroke-dasharray="${C.toFixed(2)}" style="stroke-dashoffset:${C.toFixed(2)}" data-target="${off.toFixed(2)}"/></svg>
    <div class="val"><span>${verdict === 'error' ? '–' : score}${label ? html`<small>${label}</small>` : ''}</span></div></div>`;
}

export function animateRings(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const b of root.querySelectorAll('.ring .bar[data-target]')) {
      b.style.strokeDashoffset = b.dataset.target;
      b.removeAttribute('data-target');
    }
  }));
}

export function pill(verdict, short = false) {
  const v = VERDICTS[verdict] || VERDICTS.error;
  return html`<span class="pill" data-tone="${v.tone}">${raw(icon(VERDICT_ICON[verdict] || 'info'))}${short ? v.short : v.label}</span>`;
}

export function strengthTag(s) {
  const tone = { strong: 'danger', moderate: 'warning', weak: 'info', info: 'neutral' }[s];
  const label = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', info: 'Context' }[s];
  return html`<span class="strength" data-tone="${tone}">${label}</span>`;
}

const STAGE = { queued: 'Queued', scanning: 'Scanning' };

/** Inner markup of a result row for a file record. */
export function rowInner(rec, progress, { showTime = false } = {}) {
  const s = rec.summary;
  const node = { kind: s?.kind || guessKind(rec.name), format: s?.format || ext(rec.name) };
  const scanning = rec.status === 'scanning' || rec.status === 'queued';
  const meta = [bytes(rec.size), (node.format || '').toUpperCase(), s?.items ? `${s.items} item${s.items > 1 ? 's' : ''}` : null, showTime ? relTime(rec.addedAt) : null].filter(Boolean);
  let sub;
  if (scanning) {
    const p = progress || {};
    const ratio = typeof p.ratio === 'number' ? p.ratio : null;
    sub = html`<div class="r-top">${p.stage || STAGE[rec.status]}${p.detail ? html` · <span class="muted">${p.detail}</span>` : ''}</div>
      <div class="progress ${ratio == null ? 'indeterminate' : ''}" style="--p:${ratio == null ? 30 : Math.round(ratio * 100)}%"><i></i></div>`;
  } else if (rec.status === 'error' && !s?.top?.length) {
    sub = html`<div class="r-top muted">${rec.error ? `Could not scan: ${rec.error}` : 'Scan interrupted — re-scan from the Library.'}</div>`;
  } else if (s?.top?.length) {
    const t = s.top[0];
    sub = html`<div class="r-top">${t.title}${t.where ? html` <span class="muted">in ${t.where}</span>` : ''}${s.findings > 1 ? html` <span class="muted">+${s.findings - 1} more</span>` : ''}</div>`;
  } else {
    sub = html`<div class="r-top muted">No AI identifiers found</div>`;
  }
  const saving = typeof rec.saveRatio === 'number' ? html`<span title="Saving to Library">${raw(icon('hard-drive'))} ${Math.round(rec.saveRatio * 100)}%</span>` : '';
  return html`
    <div class="file-ic" data-kind="${node.kind}">${raw(icon(scanning ? 'scan-line' : fileIcon(node)))}</div>
    <div class="r-main">
      <div class="r-name" title="${rec.name}">${rec.name}</div>
      <div class="r-meta">${meta.map((m, i) => html`${i ? html`<span aria-hidden="true">·</span>` : ''}<span>${m}</span>`)}${saving}</div>
      ${sub}
    </div>
    <div class="r-side">${scanning ? '' : html`${pill(s?.verdict || 'error', true)}${ring(s?.score || 0, s?.verdict || 'error')}`}</div>`;
}

export const ext = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
export function guessKind(name) {
  const e = ext(name);
  if (/^(png|jpe?g|gif|webp|tiff?|heic|avif|bmp)$/.test(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (/^(docx|xlsx|pptx|odt|ods|odp)$/.test(e)) return 'document';
  if (/^(zip|jar|epub)$/.test(e)) return 'archive';
  if (/^(mp3|mp4|mov|wav|m4a|webm|ogg|flac)$/.test(e)) return 'media';
  return 'text';
}
