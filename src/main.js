import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/animations.css';
import './styles/avatar.css';

import { el, html, raw, $, $$ } from './lib/dom.js';
import { icon } from './ui/icons.js';
import { store, loadSettings, addFiles, saveSetting } from './app/store.js';
import { applyTheme, applyMotion, resolvedTheme } from './ui/theme.js';
import { initAvatar, setAvatarState, avatarState } from './avatar/index.js';
import { renderScan } from './views/scan.js';
import { renderLibrary } from './views/library.js';
import { renderGuide } from './views/guide.js';
import { renderNotFound } from './views/notfound.js';
import { startOnboarding } from './ui/onboarding.js';
import { initInstall, onInstallChange, promptInstall } from './ui/install.js';
import { toast } from './ui/toast.js';
import { closeDrawer } from './ui/drawer.js';
import { registerPWA } from '#pwa';

const NAV = [
  ['#/', 'Scan', 'scan-search'],
  ['#/library', 'Library', 'library'],
  ['#/guide', 'Guide', 'book-open'],
];

function shell() {
  const app = el(html`<div class="app">
    <a class="sr-only" href="#main">Skip to content</a>
    <header class="header">
      <a class="brand" href="#/" aria-label="AI Content Reviewer home">
        <span class="brand-mark">${raw(icon('scan-search'))}</span>
        <span class="brand-name">AI Content Reviewer<small>by Lens · offline</small></span>
      </a>
      <nav class="nav" aria-label="Main">${NAV.map(([h, l, ic]) => html`<a href="${h}">${raw(icon(ic))}${l}</a>`)}</nav>
      <div class="header-actions">
        <button class="btn btn-sm hidden" id="btn-install">${raw(icon('download'))}<span class="hide-sm">Install</span></button>
        <button class="btn btn-ghost icon-btn" id="btn-theme" aria-label="Toggle theme" title="Toggle theme"></button>
        <button class="btn btn-ghost icon-btn" id="btn-help" aria-label="Show onboarding guide" title="Help & tour">${raw(icon('help-circle'))}</button>
      </div>
    </header>
    <main class="main" id="main" tabindex="-1"></main>
    <footer class="footer">AI Content Reviewer · runs entirely on your device · <a href="#/guide">How it works</a></footer>
    <nav class="tabbar" aria-label="Main">${NAV.map(([h, l, ic]) => html`<a href="${h}">${raw(icon(ic))}<span>${l}</span></a>`)}</nav>
  </div>`);
  document.body.prepend(app);
  return app;
}

let teardown = null;
function route() {
  closeDrawer(true);
  const main = $('#main');
  const params = new URLSearchParams(location.search);
  const h = location.hash.replace(/^#/, '') || '/';
  const path = h.split('?')[0];
  teardown?.();
  for (const a of $$('.nav a, .tabbar a')) {
    const target = a.getAttribute('href').slice(1);
    if (target === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (params.get('missing')) {
    const missing = params.get('missing');
    params.delete('missing');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + '#/404');
    teardown = renderNotFound(main, missing);
    document.title = 'Not found · AI Content Reviewer';
    return;
  }
  if (path === '/') teardown = renderScan(main);
  else if (path === '/library') teardown = renderLibrary(main);
  else if (path === '/guide') teardown = renderGuide(main);
  else teardown = renderNotFound(main, h);
  const titles = { '/': 'Scan', '/library': 'Library', '/guide': 'Guide' };
  document.title = `${titles[path] || 'Not found'} · AI Content Reviewer`;
  if (document.activeElement && document.activeElement !== document.body && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  scrollTo({ top: 0 });
}

function themeButton() {
  const b = $('#btn-theme');
  const paint = () => { b.innerHTML = icon(resolvedTheme() === 'dark' ? 'sun' : 'moon'); };
  paint();
  b.onclick = async () => {
    const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await saveSetting('theme', next);
    paint();
  };
}

/** Drop anywhere on the page. */
function globalDrop() {
  let depth = 0;
  let before = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) {
      before = avatarState();
      setAvatarState('drag');
      $('#dropzone')?.classList.add('drag');
    }
  });
  addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) { depth = 0; $('#dropzone')?.classList.remove('drag'); if (avatarState() === 'drag') setAvatarState(before || 'idle', { silent: true }); }
  });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('#dropzone')?.classList.remove('drag');
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (!files.length) { setAvatarState(before || 'idle', { silent: true }); return; }
    if (!/^#\/?$/.test(location.hash || '#/')) location.hash = '#/';
    addFiles(files);
  });
  addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.length > 40) {
      e.preventDefault();
      addFiles([new File([text], `pasted-text-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.txt`, { type: 'text/plain' })]);
      toast({ title: 'Scanning pasted text', tone: 'info', timeout: 2500 });
    }
  });
}

/** Expand dropped folders (webkitGetAsEntry) into files. */
async function filesFromDataTransfer(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.some((en) => en.isDirectory)) return [...dt.files];
  const out = [];
  const readDir = (dir) => new Promise((res) => {
    const r = dir.createReader();
    const all = [];
    const next = () => r.readEntries((batch) => { if (!batch.length) return res(all); all.push(...batch); next(); }, () => res(all));
    next();
  });
  const walk = async (en, prefix) => {
    if (en.isFile) {
      const f = await new Promise((res) => en.file(res, () => res(null)));
      if (f) out.push({ f, path: prefix + f.name });
    } else if (en.isDirectory && out.length < 5000) {
      for (const c of await readDir(en)) await walk(c, `${prefix}${en.name}/`);
    }
  };
  const loose = [];
  for (const en of entries) {
    if (en.isDirectory) {
      const before = out.length;
      await walk(en, '');
      const group = out.splice(before);
      const total = group.reduce((a, x) => a + x.f.size, 0);
      if (total <= 200 * 1024 * 1024) {
        const { zip } = await import('./samples/builders.js');
        const bytes = zip(await Promise.all(group.map(async (x) => ({ name: x.path, data: new Uint8Array(await x.f.arrayBuffer()) }))));
        loose.push(new File([bytes], `${en.name}.zip`, { type: 'application/zip' }));
      } else loose.push(...group.map((x) => x.f));
    } else {
      const f = await new Promise((res) => en.file(res, () => res(null)));
      if (f) loose.push(f);
    }
  }
  return loose;
}

async function boot() {
  const s = await loadSettings();
  applyTheme(s.theme);
  applyMotion(s.motion);
  shell();
  const boot = document.getElementById('boot');
  if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 400); }
  themeButton();
  initInstall();
  onInstallChange((st) => $('#btn-install').classList.toggle('hidden', !(st.canPrompt || st.ios) || st.installed));
  $('#btn-install').onclick = promptInstall;
  $('#btn-help').onclick = () => { if (!/^#\/?$/.test(location.hash || '#/')) location.hash = '#/'; setTimeout(startOnboarding, 120); };

  await initAvatar(s.mascot);
  addEventListener('hashchange', route);
  route();
  globalDrop();

  // Debug/screenshot hook: ?avatar=<state>
  const forced = new URLSearchParams(location.search).get('avatar');
  if (forced) setAvatarState(forced, { sticky: true });
  else if (!s.onboarded && !navigator.webdriver) setTimeout(startOnboarding, 600);

  const reload = registerPWA({
    onNeedRefresh() { toast({ title: 'Update available', body: 'A new version of Lens is ready.', tone: 'info', timeout: 0, action: { label: 'Reload', onClick: () => reload() } }); },
    onOfflineReady() {
      toast({ title: 'Ready to work offline', body: 'You can now use Lens without an internet connection.', tone: 'success' });
      if (!store.session.length) setAvatarState('offline');
    },
  });
  addEventListener('offline', () => toast({ title: 'You\'re offline', body: 'No problem — scanning works fully offline.', tone: 'info', icon: 'wifi-off' }));
}

boot();
