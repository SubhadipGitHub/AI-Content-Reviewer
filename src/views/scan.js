import { el, html, raw, on, $ } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, subscribe, addFiles, getResultFor } from '../app/store.js';
import { rowInner, animateRings, toneOf, guessKind } from '../ui/render.js';
import { openDrawer } from '../ui/drawer.js';
import { mountAvatar, setAvatarState, avatarState } from '../avatar/index.js';
import { exportMany } from '../report/export.js';
import { toast } from '../ui/toast.js';
import { plural } from '../lib/format.js';

const filter = { verdict: null, q: '', kind: 'all' };
const STAT_DEFS = [
  ['strong', 'AI detected', 'octagon-alert'],
  ['likely', 'Likely AI', 'alert-triangle'],
  ['possible', 'Possible', 'info'],
  ['clean', 'Clear', 'circle-check-big'],
];

export function pickFiles({ folder = false } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (folder) input.webkitdirectory = true;
  input.onchange = () => (folder ? addFolder(input.files) : addFiles(input.files));
  input.click();
}

async function addFolder(files) {
  const list = [...files];
  if (!list.length) return;
  const total = list.reduce((a, f) => a + f.size, 0);
  const root = (list[0].webkitRelativePath || 'folder').split('/')[0];
  if (total > 200 * 1024 * 1024 || list.length > 5000) {
    toast({ title: 'Large folder', body: 'Scanning files individually (folder too large to package).', tone: 'info' });
    return addFiles(list);
  }
  const { zip } = await import('../samples/builders.js');
  const entries = await Promise.all(list.map(async (f) => ({ name: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  const bytes = zip(entries);
  addFiles([new File([bytes], `${root}.zip`, { type: 'application/zip' })]);
  toast({ title: `Packaged “${root}”`, body: `${plural(list.length, 'file')} scanned together so project-level markers are detected.`, tone: 'info' });
}

export async function loadSamples() {
  const { buildSamples } = await import('../samples/samples.js');
  const samples = await buildSamples();
  addFiles(samples.map((s) => new File([s.bytes], s.name, { type: s.type })));
}

export function renderScan(root) {
  const view = el(html`<div class="view">
    <section class="hero">
      <div class="card hero-copy">
        <div class="eyebrow"><span class="offline-pill">Works offline</span><span class="chip">${raw(icon('lock'))}Files never leave your device</span></div>
        <div>
          <h1>Find the <span class="grad-text">AI fingerprints</span> in any file.</h1>
          <p class="lead" style="margin-top:12px">Drop documents, spreadsheets, PDFs, images, code or whole ZIP archives. Lens checks provenance metadata, generator signatures, chatbot residue and writing patterns — and shows you the exact evidence.</p>
        </div>
        <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Add files to scan: drop files here or press Enter to browse">
          <div class="dz-icon">${raw(icon('upload-cloud'))}</div>
          <div class="dz-title">Drop files to scan</div>
          <div class="dz-sub">or <u>browse</u> · paste with <span class="kbd">Ctrl/⌘ V</span></div>
          <div class="dz-types">${['ZIP', 'PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG / JPG', 'Code', 'TXT / MD'].map((t) => html`<span class="chip">${t}</span>`)}</div>
        </div>
        <div class="dz-actions">
          <button class="btn btn-primary" data-act="browse">${raw(icon('folder-open'))}Choose files<span class="shine"></span></button>
          <button class="btn" data-act="folder" id="btn-folder">${raw(icon('archive'))}Scan a folder</button>
          <button class="btn" data-act="samples" id="btn-samples">${raw(icon('flask-conical'))}Try sample files</button>
        </div>
        <div class="trust"><span>${raw(icon('shield-check'))}No uploads, no accounts</span><span>${raw(icon('hard-drive'))}Big files saved on-device</span><span>${raw(icon('zap'))}Runs in background threads</span></div>
      </div>
      <div class="card hero-stage"><div class="avatar-slot" id="hero-avatar" data-framing="full"></div></div>
    </section>

    <section class="section" id="results-section" hidden>
      <div class="section-head">
        <h2>Results <span class="count-badge" id="res-count">0</span></h2>
        <div class="spacer"></div>
        <button class="btn btn-sm hidden" id="clean-all" title="Remove AI identifiers from flagged files">${raw(icon('wand-2'))}Clean all</button>
        <details class="menu" id="export-menu">
          <summary class="btn btn-sm">${raw(icon('download'))}Export</summary>
          <div class="menu-pop card">
            <button data-export="html">${raw(icon('file-text'))}<span><b>HTML report</b><small>Readable, shareable</small></span></button>
            <button data-export="csv">${raw(icon('file-spreadsheet'))}<span><b>CSV</b><small>For Excel / Sheets</small></span></button>
            <button data-export="json">${raw(icon('code-2'))}<span><b>JSON</b><small>Full evidence</small></span></button>
          </div>
        </details>
      </div>
      <div class="stats" id="stats">${STAT_DEFS.map(([k, label, ic]) => html`<button class="stat" data-verdict="${k}" data-tone="${toneOf(k)}" aria-pressed="false"><div class="stat-icon">${raw(icon(ic))}</div><div><b data-n>0</b><span>${label}</span></div></button>`)}</div>
      <div class="toolbar">
        <label class="search"><span class="sr-only">Search results</span>${raw(icon('search'))}<input type="search" id="q" placeholder="Search files or findings…" autocomplete="off"></label>
        <select class="select" id="kind" aria-label="Filter by file type">
          <option value="all">All types</option><option value="document">Documents</option><option value="pdf">PDFs</option><option value="image">Images</option><option value="archive">Archives</option><option value="text">Text & code</option><option value="media">Media</option>
        </select>
        <button class="btn btn-sm btn-ghost hidden" id="clear-filter">${raw(icon('x'))}Clear filters</button>
      </div>
      <div class="results" id="results" aria-live="off"></div>
      <div class="empty hidden" id="no-match"><p>No results match these filters.</p></div>
    </section>
  </div>`);
  root.replaceChildren(view);

  const dz = $('#dropzone', view);
  const list = $('#results', view);
  const section = $('#results-section', view);
  const hero = $('.hero', view);
  mountAvatar($('#hero-avatar', view));
  if (!store.session.length && !['processing'].includes(avatarState())) setAvatarState('idle', { silent: true });
  if ('ontouchstart' in window && !/Android/i.test(navigator.userAgent)) $('#btn-folder', view).classList.add('hidden');

  dz.addEventListener('click', () => pickFiles());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); } });
  on(view, 'click', '[data-act]', (e, t) => {
    if (t.dataset.act === 'browse') pickFiles();
    if (t.dataset.act === 'folder') pickFiles({ folder: true });
    if (t.dataset.act === 'samples') loadSamples();
  });
  on(view, 'click', '.stat', (e, t) => {
    filter.verdict = filter.verdict === t.dataset.verdict ? null : t.dataset.verdict;
    update();
  });
  $('#q', view).addEventListener('input', (e) => { filter.q = e.target.value.trim().toLowerCase(); update(); });
  $('#kind', view).addEventListener('change', (e) => { filter.kind = e.target.value; update(); });
  $('#clean-all', view).addEventListener('click', async () => {
    const ids = store.session.filter((id) => { const v = store.files.get(id)?.summary?.verdict; return v && v !== 'clean' && v !== 'error'; });
    const { openCleanDialog } = await import('../ui/clean-dialog.js');
    openCleanDialog(ids);
  });
  $('#clear-filter', view).addEventListener('click', () => { filter.verdict = null; filter.q = ''; filter.kind = 'all'; $('#q', view).value = ''; $('#kind', view).value = 'all'; update(); });
  on(view, 'click', '[data-export]', async (e, t) => {
    $('#export-menu', view).open = false;
    const results = (await Promise.all(store.session.map((id) => getResultFor(id)))).filter(Boolean);
    if (!results.length) return toast({ title: 'Nothing to export yet', tone: 'info' });
    exportMany(results, t.dataset.export);
  });
  const closeMenu = (e) => { const m = $('#export-menu', view); if (m?.open && !m.contains(e.target)) m.open = false; };
  document.addEventListener('click', closeMenu);
  on(list, 'click', '.result', async (e, t) => {
    const id = t.dataset.id;
    const rec = store.files.get(id);
    if (!rec || rec.status === 'scanning' || rec.status === 'queued') return;
    const r = await getResultFor(id);
    if (r) openDrawer(r, { id });
    else toast({ title: 'Result not available', body: rec.error || 'Try re-scanning from the Library.', tone: 'warning' });
  });

  function matches(rec) {
    const s = rec.summary;
    if (filter.verdict && s?.verdict !== filter.verdict) return false;
    if (filter.kind !== 'all') {
      const k = s?.kind || guessKind(rec.name);
      if (filter.kind === 'text' ? !['text', 'binary'].includes(k) : k !== filter.kind) return false;
    }
    if (filter.q) {
      const hay = `${rec.name} ${(s?.top || []).map((t) => t.title).join(' ')}`.toLowerCase();
      if (!hay.includes(filter.q)) return false;
    }
    return true;
  }

  function update() {
    if (!view.isConnected) return unsub();
    const recs = store.session.map((id) => store.files.get(id)).filter(Boolean);
    section.hidden = !recs.length;
    hero.classList.toggle('compact', recs.length > 0);
    $('#res-count', view).textContent = recs.length;
    const flagged = recs.filter((r) => r.summary && r.summary.verdict !== 'clean' && r.summary.verdict !== 'error').length;
    $('#clean-all', view).classList.toggle('hidden', !flagged || recs.some((r) => r.status === 'scanning'));
    for (const [k] of STAT_DEFS) {
      const b = view.querySelector(`.stat[data-verdict="${k}"]`);
      b.querySelector('[data-n]').textContent = recs.filter((r) => r.summary?.verdict === k).length;
      b.setAttribute('aria-pressed', String(filter.verdict === k));
    }
    $('#clear-filter', view).classList.toggle('hidden', !(filter.verdict || filter.q || filter.kind !== 'all'));

    // Keyed patch: keep existing nodes (no re-animation), prepend new ones.
    const existing = new Map([...list.children].map((n) => [n.dataset.id, n]));
    let visible = 0;
    recs.forEach((rec, i) => {
      let node = existing.get(rec.id);
      const sig = `${rec.status}|${rec.summary?.score}|${rec.summary?.verdict}|${JSON.stringify(store.progress.get(rec.id) || '')}|${rec.saveRatio}`;
      if (!node) {
        node = el(`<button class="result" data-id="${rec.id}" style="--i:${Math.min(i, 8)}"></button>`);
        const after = list.children[i];
        list.insertBefore(node, after || null);
      }
      if (node.dataset.sig !== sig) {
        node.dataset.sig = sig;
        node.innerHTML = String(rowInner(rec, store.progress.get(rec.id)));
        node.classList.toggle('scanning', rec.status === 'scanning' || rec.status === 'queued');
        node.dataset.tone = rec.summary ? toneOf(rec.summary.verdict) : '';
        node.setAttribute('aria-label', `${rec.name}${rec.summary ? `, ${rec.summary.verdict}, score ${rec.summary.score}` : ', scanning'}`);
        animateRings(node);
      }
      const show = matches(rec);
      node.hidden = !show;
      if (show) visible++;
      existing.delete(rec.id);
    });
    for (const n of existing.values()) n.remove();
    $('#no-match', view).classList.toggle('hidden', !(recs.length && !visible));
  }

  const unsubStore = subscribe(update);
  const unsub = () => { unsubStore(); document.removeEventListener('click', closeMenu); };
  update();
  return unsub;
}
