// Detail drawer: findings grouped by category with highlighted evidence, metadata,
// archive/document contents (navigable) and a text preview.

import { el, html, raw, highlight, on } from '../lib/dom.js';
import { icon, fileIcon, CATEGORY_ICON } from './icons.js';
import { ring, pill, strengthTag, animateRings, toneOf } from './render.js';
import { CATEGORIES } from '../scan/findings.js';
import { VERDICTS } from '../scan/score.js';
import { bytes, plural } from '../lib/format.js';
import { trapFocus } from './modal.js';
import { exportFile } from '../report/export.js';
import { setDockVisible } from '../avatar/index.js';

const ORDER = { strong: 0, moderate: 1, weak: 2, info: 3 };
let current = null;

function summaryLine(node) {
  const f = node.findings.filter((x) => x.strength !== 'info');
  const strong = f.filter((x) => x.strength === 'strong').length;
  const kids = node.children?.length || 0;
  switch (node.verdict) {
    case 'strong': return strong
      ? `${strong} hard identifier${strong === 1 ? ' shows' : 's show'} this content was produced or edited with AI tools.`
      : 'Hard identifiers inside this file show AI tools were used to produce some of its contents.';
    case 'likely': return 'Several signals point to AI involvement, but no single piece of hard proof was found.';
    case 'possible': return 'Some soft signals were found. They can also occur in human work, so review the evidence.';
    case 'clean': return kids ? `Checked ${plural(countAll(node) - 1, 'embedded item')} — no AI identifiers found.` : 'No AI identifiers were found in metadata, text or structure.';
    default: return node.error ? `The file could not be fully read: ${node.error}` : 'The file could not be scanned.';
  }
}
const countAll = (n) => 1 + (n.children || []).reduce((a, c) => a + countAll(c), 0);

function findingsTab(node) {
  const items = [...node.findings].sort((a, b) => ORDER[a.strength] - ORDER[b.strength]);
  const notes = node.notes || [];
  const flaggedKids = (node.children || []).filter((c) => c.verdict !== 'clean' && c.verdict !== 'error');
  if (!items.length && !notes.length && !flaggedKids.length) {
    return html`<div class="empty" style="padding:30px 10px">${raw(icon('shield-check'))}<h3>Nothing flagged</h3><p>No metadata fingerprints, chatbot residue, invisible characters or AI tool markers were found.</p></div>`;
  }
  const groups = new Map();
  for (const f of items) { if (!groups.has(f.category)) groups.set(f.category, []); groups.get(f.category).push(f); }
  let i = 0;
  return html`
    ${notes.map((n) => html`<div class="notice" data-tone="info" style="margin-bottom:10px">${raw(icon('info'))}<span>${n}</span></div>`)}
    ${flaggedKids.length ? html`<div class="notice" data-tone="${toneOf(node.verdict)}" style="margin-bottom:16px">${raw(icon('layers'))}<span>${plural(flaggedKids.length, 'embedded item')} flagged — see the <b>Contents</b> tab.</span></div>` : ''}
    ${[...groups.entries()].map(([cat, list]) => html`<section class="group">
      <div class="group-title">${raw(icon(CATEGORY_ICON[cat] || 'info'))}${CATEGORIES[cat] || cat}</div>
      ${list.map((f) => html`<article class="finding" style="--i:${i++}">
        <div class="finding-head"><h4>${f.title}</h4>${strengthTag(f.strength)}</div>
        ${f.detail ? html`<div class="detail">${f.detail}</div>` : ''}
        ${f.evidence?.length ? html`<div class="evidence">${f.evidence.map((e) => e.image && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(e.image)
          ? html`<figure class="ev-image"><img src="${e.image}" alt="${e.text || 'Evidence image'}" loading="lazy"><figcaption>${e.text || ''}</figcaption></figure>`
          : html`<code>${raw(highlight(e.text, e.ranges))}</code>`)}</div>` : ''}
        ${f.location ? html`<div class="loc">${raw(icon('search'))}${f.location}</div>` : ''}
        ${f.why ? html`<details class="why"><summary>${raw(icon('chevron-right'))}Why this matters</summary><p>${f.why}</p></details>` : ''}
      </article>`)}
    </section>`)}`;
}

function kv(obj) {
  const rows = Object.entries(obj).filter(([, v]) => v != null && v !== '' && typeof v !== 'object');
  if (!rows.length) return '';
  return html`<div class="kv">${rows.map(([k, v]) => html`<div>${k}</div><div>${String(v).slice(0, 600)}</div>`)}</div>`;
}

function detailsTab(node) {
  const m = node.meta || {};
  const base = {
    'File name': node.name, Type: `${node.kind} / ${(node.format || '').toUpperCase()}`, Size: bytes(node.size),
    'AI signal score': `${node.score} / 100`, Verdict: VERDICTS[node.verdict]?.label,
    Pages: m.pages, Slides: m.slides, Sheets: m.sheets?.join(', '), Formulas: m.formulas, Words: m.words?.toLocaleString(),
    Dimensions: m.width ? `${m.width} × ${m.height}` : null, Entries: m.entries,
    'Rules version': node.rulesVersion, Scanned: node.scannedAt ? new Date(node.scannedAt).toLocaleString() : null,
  };
  const sections = [['Overview', base]];
  if (m.info) sections.push(['PDF properties', m.info]);
  if (m.properties) sections.push(['Document properties', m.properties]);
  if (m.customProperties && Object.keys(m.customProperties).length) sections.push(['Custom properties', m.customProperties]);
  if (m.exif && Object.keys(m.exif).length) sections.push(['EXIF', m.exif]);
  if (m.xmp && Object.keys(m.xmp).length) sections.push(['XMP', Object.fromEntries(Object.entries(m.xmp).filter(([k]) => k !== 'c2pa'))]);
  if (m.xmp?.c2pa) sections.push(['Content Credentials', { 'Claim generator': m.xmp.c2pa.generator, 'Source type': m.xmp.c2pa.aiSource, Actions: m.xmp.c2pa.actions?.join(', ') }]);
  if (m.pngText && Object.keys(m.pngText).length) sections.push(['PNG text chunks', m.pngText]);
  if (m.htmlMeta) sections.push(['HTML meta', m.htmlMeta]);
  if (m.reviewers) sections.push(['Authors & reviewers', { Names: m.reviewers.join(', ') }]);
  return html`${sections.map(([t, o]) => { const k = kv(o); return k ? html`<section class="group"><div class="group-title">${t}</div>${k}</section>` : ''; })}`;
}

function contentsTab(node) {
  const all = [...(node.children || [])].sort((a, b) => b.score - a.score);
  const kids = all.slice(0, 400);
  return html`${all.length > kids.length ? html`<div class="notice" data-tone="info" style="margin-bottom:10px">${raw(icon('info'))}<span>Showing the ${kids.length} highest-scoring of ${all.length.toLocaleString()} items. Export JSON for the full list.</span></div>` : ''}<div class="tree">${kids.map((c) => html`<button class="result" data-child="${node.children.indexOf(c)}" data-tone="${toneOf(c.verdict)}">
    <div class="file-ic" data-kind="${c.kind}">${raw(icon(fileIcon(c)))}</div>
    <div class="r-main"><div class="r-name">${c.path.split('/').slice(1).join('/') || c.name}</div>
      <div class="r-meta"><span>${bytes(c.size)}</span><span>·</span><span>${(c.format || '').toUpperCase()}</span>${c.children?.length ? html`<span>·</span><span>${c.children.length} items</span>` : ''}${c.findings.filter((f) => f.strength !== 'info').length ? html`<span>·</span><span>${plural(c.findings.filter((f) => f.strength !== 'info').length, 'finding')}</span>` : ''}</div></div>
    <div class="r-side">${ring(c.score, c.verdict)}</div></button>`)}</div>`;
}

function previewTab(node) {
  return html`<div class="preview">${node.preview}</div><p class="muted" style="font-size:.78rem;margin-top:8px">Text preview (first 4,000 characters) as extracted for analysis.</p>`;
}

function render(state) {
  const { stack, tab } = state;
  const node = stack[stack.length - 1];
  const tabs = [['findings', 'Findings', node.findings.filter((f) => f.strength !== 'info').length], ['details', 'Details']];
  if (node.children?.length) tabs.push(['contents', 'Contents', node.children.length]);
  if (node.preview) tabs.push(['preview', 'Preview']);
  const active = tabs.some((t) => t[0] === tab) ? tab : 'findings';
  const body = { findings: findingsTab, details: detailsTab, contents: contentsTab, preview: previewTab }[active](node);
  state.el.innerHTML = String(html`
    <div class="drawer-head">
      <div class="file-ic" data-kind="${node.kind}">${raw(icon(fileIcon(node)))}</div>
      <div class="r-main"><div class="r-name" id="drawer-title">${node.name}</div><div class="r-meta"><span>${bytes(node.size)}</span><span>·</span><span>${(node.format || '').toUpperCase()}</span></div></div>
      <div class="spacer"></div>
      <button class="btn btn-ghost icon-btn" data-export title="Export this report (JSON)" aria-label="Export report">${raw(icon('download'))}</button>
      <button class="btn btn-ghost icon-btn" data-close aria-label="Close details">${raw(icon('x'))}</button>
    </div>
    <div class="drawer-summary" data-tone="${toneOf(node.verdict)}">
      ${ring(node.score, node.verdict, 'lg', 'score')}
      <div>${pill(node.verdict)}<p>${summaryLine(node)}</p></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([id, label, n]) => html`<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === active}">${label}${n ? html`<span class="count-badge">${n}</span>` : ''}</button>`)}</div>
    <div class="drawer-body" role="tabpanel">
      ${stack.length > 1 ? html`<nav class="crumbs" aria-label="Location">${stack.map((n, i) => html`${i ? raw(icon('chevron-right')) : ''}${i < stack.length - 1 ? html`<button data-crumb="${i}">${n.name}</button>` : html`<span>${n.name}</span>`}`)}</nav>` : ''}
      ${body}
    </div>`);
  animateRings(state.el);
}

export function openDrawer(result, { onClose } = {}) {
  closeDrawer(true);
  const scrim = el('<div class="scrim"></div>');
  const d = el('<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></aside>');
  const state = { stack: [result], tab: 'findings', el: d, prevFocus: document.activeElement, onClose };
  current = { scrim, d, state };
  render(state);
  document.body.append(scrim, d);
  document.body.style.overflow = 'hidden';
  setDockVisible(false);
  requestAnimationFrame(() => { scrim.classList.add('open'); d.classList.add('open'); });
  setTimeout(() => d.querySelector('[data-close]')?.focus(), 60);

  scrim.onclick = () => closeDrawer();
  on(d, 'click', '[data-close]', () => closeDrawer());
  on(d, 'click', '[data-tab]', (e, t) => { state.tab = t.dataset.tab; render(state); d.querySelector(`[data-tab="${state.tab}"]`)?.focus(); });
  on(d, 'click', '[data-child]', (e, t) => {
    const node = state.stack[state.stack.length - 1];
    state.stack.push(node.children[+t.dataset.child]);
    state.tab = 'findings';
    render(state);
    d.querySelector('.drawer-body').scrollTop = 0;
  });
  on(d, 'click', '[data-crumb]', (e, t) => { state.stack = state.stack.slice(0, +t.dataset.crumb + 1); render(state); });
  on(d, 'click', '[data-export]', () => exportFile(state.stack[0], 'json'));
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    trapFocus(d, e);
  });
  // Swipe down to close on touch devices (bottom sheet)
  let y0 = null;
  d.addEventListener('touchstart', (e) => { if (d.querySelector('.drawer-body').scrollTop <= 0 && e.target.closest('.drawer-head, .drawer-summary')) y0 = e.touches[0].clientY; }, { passive: true });
  d.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = Math.max(0, e.touches[0].clientY - y0); d.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  d.addEventListener('touchend', (e) => { if (y0 != null) { const dy = e.changedTouches[0].clientY - y0; d.style.transform = ''; y0 = null; if (dy > 110) closeDrawer(); } });
}

export function closeDrawer(immediate = false) {
  if (!current) return;
  const { scrim, d, state } = current;
  current = null;
  document.body.style.overflow = '';
  setDockVisible(true);
  if (immediate) { scrim.remove(); d.remove(); return; }
  scrim.classList.remove('open');
  d.classList.remove('open');
  setTimeout(() => { scrim.remove(); d.remove(); }, 480);
  state.prevFocus?.focus?.();
  state.onClose?.();
}
