import { el, html, raw, on, $ } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, subscribe, loadLibrary, rescan, removeFile, clearLibrary, getResultFor, downloadOriginal } from '../app/store.js';
import { rowInner, animateRings, toneOf } from '../ui/render.js';
import { openDrawer } from '../ui/drawer.js';
import { confirmDialog } from '../ui/modal.js';
import { storageEstimate } from '../store/db.js';
import { bytes, dayLabel, plural } from '../lib/format.js';
import { mountAvatar, setAvatarState } from '../avatar/index.js';
import { exportMany } from '../report/export.js';
import { RULES_VERSION } from '../scan/rules.js';

export function renderLibrary(root) {
  const view = el(html`<div class="view">
    <div class="page-head">
      <div><h1>Library</h1><p>Every scan is kept on this device so you can review large files later — even offline.</p></div>
      <div class="spacer"></div>
      <div class="card storage" id="storage"><div class="row"><span class="muted">On-device storage</span><b id="st-used">—</b></div><div class="meter"><i id="st-bar"></i></div><div class="row muted" style="font-size:.76rem"><span id="st-files">—</span><span id="st-persist"></span></div></div>
    </div>
    <div class="toolbar" id="lib-tools">
      <label class="search"><span class="sr-only">Search library</span>${raw(icon('search'))}<input type="search" id="lq" placeholder="Search library…"></label>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="lib-export">${raw(icon('download'))}Export all</button>
      <button class="btn btn-sm btn-danger" id="lib-clear">${raw(icon('trash-2'))}Clear library</button>
    </div>
    <div id="lib-list"></div>
  </div>`);
  root.replaceChildren(view);
  const listEl = $('#lib-list', view);
  let q = '';
  let loaded = false;

  async function refreshStorage() {
    const est = await storageEstimate();
    if (!est) return;
    $('#st-used', view).textContent = `${bytes(est.usage)} of ${bytes(est.quota)}`;
    $('#st-bar', view).style.setProperty('--p', `${Math.min(100, (est.usage / (est.quota || 1)) * 100).toFixed(2)}%`);
    $('#st-persist', view).textContent = est.persisted ? 'Protected from eviction' : 'Browser may clear if space is low';
  }

  function render() {
    if (!view.isConnected) return unsub();
    const recs = [...store.files.values()].sort((a, b) => b.addedAt - a.addedAt);
    $('#st-files', view).textContent = `${plural(recs.length, 'file')} · ${bytes(recs.filter((r) => r.stored).reduce((a, r) => a + r.size, 0))} stored`;
    $('#lib-tools', view).classList.toggle('hidden', !recs.length);
    if (!loaded) return;
    if (!recs.length) {
      listEl.innerHTML = String(html`<div class="card empty"><div class="avatar-slot" id="lib-avatar" data-framing="full"></div><h2>Your library is empty</h2><p>Scanned files and their evidence appear here, stored privately in this browser.</p><a class="btn btn-primary" href="#/">${raw(icon('upload-cloud'))}Scan your first file</a></div>`);
      mountAvatar($('#lib-avatar', view));
      setAvatarState('sleeping');
      return;
    }
    mountAvatar(null);
    const shown = recs.filter((r) => !q || `${r.name} ${(r.summary?.top || []).map((t) => t.title).join(' ')}`.toLowerCase().includes(q));
    const groups = new Map();
    for (const r of shown) { const d = dayLabel(r.addedAt); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(r); }
    listEl.innerHTML = String(html`${[...groups.entries()].map(([day, rs]) => html`<div class="day">${day}</div><div class="results">${rs.map((r, i) => html`
      <div class="result" data-id="${r.id}" data-tone="${r.summary ? toneOf(r.summary.verdict) : ''}" style="--i:${Math.min(i, 8)};grid-template-columns:auto 1fr auto auto" role="button" tabindex="0" aria-label="Open ${r.name}">
        ${raw(String(rowInner(r, store.progress.get(r.id), { showTime: true })))}
        <div class="lib-actions">
          ${r.stored ? html`<button class="btn btn-ghost icon-btn btn-sm" data-rescan title="Re-scan${r.summary?.rulesVersion && r.summary.rulesVersion !== RULES_VERSION ? ' with updated rules' : ''}" aria-label="Re-scan ${r.name}">${raw(icon('refresh-cw'))}</button>
          <button class="btn btn-ghost icon-btn btn-sm hide-sm" data-download title="Download original" aria-label="Download ${r.name}">${raw(icon('download'))}</button>` : ''}
          <button class="btn btn-ghost icon-btn btn-sm" data-delete title="Delete" aria-label="Delete ${r.name}">${raw(icon('trash-2'))}</button>
        </div>
      </div>`)}</div>`)}${!shown.length ? html`<div class="empty"><p>No files match “${q}”.</p></div>` : ''}`);
    animateRings(listEl);
    requestAnimationFrame(() => listEl.classList.add('no-anim'));
  }

  on(listEl, 'click', '[data-rescan]', (e, t) => { e.stopPropagation(); rescan(t.closest('[data-id]').dataset.id); });
  on(listEl, 'click', '[data-download]', (e, t) => { e.stopPropagation(); downloadOriginal(t.closest('[data-id]').dataset.id); });
  on(listEl, 'click', '[data-delete]', async (e, t) => {
    e.stopPropagation();
    const id = t.closest('[data-id]').dataset.id;
    const rec = store.files.get(id);
    if (await confirmDialog({ title: 'Delete this file?', body: `“${rec?.name}” and its scan results will be removed from this device.`, confirm: 'Delete', danger: true })) { await removeFile(id); refreshStorage(); }
  });
  const open = async (t) => {
    const id = t.dataset.id;
    const r = await getResultFor(id);
    if (r) openDrawer(r);
  };
  on(listEl, 'click', '.result', (e, t) => open(t));
  on(listEl, 'keydown', '.result', (e, t) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === t) { e.preventDefault(); open(t); } });
  $('#lq', view).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#lib-clear', view).addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Clear the whole library?', body: 'All stored files and scan results on this device will be permanently deleted.', confirm: 'Clear library', danger: true })) { await clearLibrary(); refreshStorage(); }
  });
  $('#lib-export', view).addEventListener('click', async () => {
    const results = (await Promise.all([...store.files.keys()].map((id) => getResultFor(id)))).filter(Boolean);
    exportMany(results, 'html');
  });

  const unsub = subscribe(render);
  render();
  loadLibrary().then(() => { loaded = true; render(); refreshStorage(); });
  return () => { unsub(); mountAvatar(null); };
}
