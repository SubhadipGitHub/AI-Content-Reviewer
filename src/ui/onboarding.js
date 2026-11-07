// First-run welcome carousel (with the mascot waving inside it) followed by an
// optional spotlight tour of the live interface.

import { el, html, raw, $ } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { mountAvatar, setAvatarState, setDockVisible, playAvatar } from '../avatar/index.js';
import { saveSetting } from '../app/store.js';
import { installState } from './install.js';

const STEPS = [
  { title: 'Meet Lens, your AI-content detective', body: 'Lens inspects files for the fingerprints AI tools leave behind — and explains every finding in plain language.', list: [['shield-check', 'Private by design: everything runs on your device'], ['wifi-off', 'Works offline once loaded — even in airplane mode'], ['sparkles', 'No sign-up, no uploads, no tracking']], state: 'guide' },
  { title: 'Drop in anything', body: 'Documents, spreadsheets, slides, PDFs, images, code, or entire ZIP archives and folders.', list: [['file-archive', 'Archives are opened recursively — even nested ZIPs'], ['hard-drive', 'Big files are kept in your on-device Library'], ['zap', 'Scanning runs in background threads so the app stays smooth']], state: 'processing' },
  { title: 'Read the verdict', body: 'Each file gets a score and a verdict backed by exact evidence you can inspect.', list: [['octagon-alert', 'Strong evidence — metadata, credentials, chatbot residue'], ['alert-triangle', 'Likely / Possible — softer signals to review'], ['circle-check-big', 'Clear — no identifiers found (not a guarantee)']], state: 'detected' },
  { title: 'Take Lens everywhere', body: 'Install it like an app on your desktop, laptop, tablet or phone.', list: [['monitor', 'Use the Install button in the header on desktop'], ['smartphone', 'On iPhone/iPad: Share → Add to Home Screen'], ['download', 'Or grab the single-file version from GitHub Releases']], state: 'clean' },
];

export function startOnboarding() {
  let i = 0;
  const content = el(html`<div>
    <div class="onb-stage">
      <div class="onb-art"><span class="onb-orb" style="width:180px;height:180px;background:#7c6cff;left:8%;top:10%"></span><span class="onb-orb" style="width:160px;height:160px;background:#22d3ee;right:6%;bottom:0;animation-delay:-3s"></span></div>
      <div class="avatar-slot" id="onb-avatar" data-framing="full"></div>
    </div>
    <div class="onb-body">${STEPS.map((s, n) => html`<div class="onb-step" data-step="${n}">
      <h2 id="onb-title-${n}">${s.title}</h2><p>${s.body}</p>
      <ul class="onb-list">${s.list.map(([ic, t]) => html`<li>${raw(icon(ic))}<span>${t}</span></li>`)}</ul></div>`)}</div>
    <div class="onb-foot">
      <div class="dots" aria-hidden="true">${STEPS.map(() => html`<i></i>`)}</div>
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-skip>Skip</button>
      <button class="btn" data-back>Back</button>
      <button class="btn btn-primary" data-next autofocus>Next${raw(icon('arrow-right'))}</button>
    </div>
  </div>`);

  const finish = async (tour) => {
    await saveSetting('onboarded', true);
    close();
    if (tour) setTimeout(startTour, 350);
  };
  const close = openModal(content, {
    label: 'Welcome to AI Content Reviewer',
    onClose: () => { saveSetting('onboarded', true); setDockVisible(true); mountAvatar(document.querySelector('#hero-avatar')); setAvatarState('idle', { silent: true }); },
  });
  setDockVisible(false);
  mountAvatar($('#onb-avatar', content));

  const show = () => {
    content.querySelectorAll('.onb-step').forEach((s, n) => s.classList.toggle('active', n === i));
    content.querySelectorAll('.dots i').forEach((d, n) => d.classList.toggle('on', n === i));
    content.closest('.modal-wrap')?.setAttribute('aria-labelledby', `onb-title-${i}`);
    content.querySelector('[data-back]').style.visibility = i ? 'visible' : 'hidden';
    const last = i === STEPS.length - 1;
    const next = content.querySelector('[data-next]');
    next.innerHTML = last ? `${icon('play')}Show me around` : `Next${icon('arrow-right')}`;
    content.querySelector('[data-skip]').textContent = last ? 'Start scanning' : 'Skip';
    setAvatarState(STEPS[i].state, { silent: true });
    if (i === 0) setTimeout(() => playAvatar('wave'), 250);
  };
  content.querySelector('[data-next]').onclick = () => { if (i < STEPS.length - 1) { i++; show(); } else finish(true); };
  content.querySelector('[data-back]').onclick = () => { if (i) { i--; show(); } };
  content.querySelector('[data-skip]').onclick = () => finish(false);
  content.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' && i < STEPS.length - 1) { i++; show(); }
    if (e.key === 'ArrowLeft' && i) { i--; show(); }
  });
  // Swipe between steps on touch
  let x0 = null;
  content.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && i < STEPS.length - 1) { i++; show(); } else if (dx > 50 && i) { i--; show(); }
  });
  show();
}

/* ───────── Spotlight tour ───────── */
function tourSteps() {
  const mobile = matchMedia('(max-width: 720px)').matches;
  const steps = [
    { sel: '#dropzone', title: 'Drop zone', body: 'Drag files here, tap to browse, or paste with Ctrl/⌘ V. You can also drop files anywhere on the page.' },
    { sel: '#btn-samples', title: 'Try it instantly', body: 'Load a set of synthetic sample files to see what each kind of finding looks like.' },
    { sel: mobile ? '.tabbar a[href="#/library"]' : '.nav a[href="#/library"]', title: 'Your Library', body: 'Every scan is saved on this device. Re-open evidence, re-scan or export reports anytime.' },
    { sel: '#hero-avatar', title: 'Lens reacts to results', body: 'Watch Lens: it scans, celebrates clean files and raises the alarm when it finds AI fingerprints. Tap it for tips.' },
  ];
  const inst = installState();
  if (inst.canPrompt || inst.ios) steps.push({ sel: '#btn-install', title: 'Install the app', body: 'Install Lens on this device for one-tap access and full offline use.' });
  else steps.push({ sel: mobile ? '.tabbar a[href="#/guide"]' : '.nav a[href="#/guide"]', title: 'Guide & settings', body: 'Learn what every signal means, switch themes or the mascot, and see how to install on other devices.' });
  return steps.filter((s) => { const n = document.querySelector(s.sel); return n && n.offsetParent !== null; });
}

export function startTour() {
  const steps = tourSteps();
  if (!steps.length) return;
  let i = 0;
  const catcher = el('<div class="spot-catch"></div>');
  const spot = el('<div class="spot" aria-hidden="true"></div>');
  const tip = el('<div class="spot-tip" role="dialog" aria-modal="true" aria-live="polite"></div>');
  document.body.append(catcher, spot, tip);
  setAvatarState('guide', { silent: true });

  const place = () => {
    const s = steps[i];
    const t = document.querySelector(s.sel);
    if (!t) return end();
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      const r = t.getBoundingClientRect();
      const pad = 8;
      Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      tip.innerHTML = String(html`<div class="muted" style="font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">Step ${i + 1} of ${steps.length}</div><h3>${s.title}</h3><p>${s.body}</p>
        <div class="row"><button class="btn btn-ghost btn-sm" data-end>Skip tour</button><div class="spacer"></div>${i ? html`<button class="btn btn-sm" data-prev>Back</button>` : ''}<button class="btn btn-primary btn-sm" data-nextt>${i === steps.length - 1 ? 'Done' : 'Next'}</button></div>`);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = r.bottom + 16;
      if (top + th > innerHeight - 12) top = Math.max(12, r.top - th - 16);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), innerWidth - tw - 12);
      Object.assign(tip.style, { top: `${top}px`, left: `${left}px` });
      tip.querySelector('[data-nextt]').focus();
    }, 320);
  };
  const end = () => { catcher.remove(); spot.remove(); tip.remove(); document.removeEventListener('keydown', key); removeEventListener('resize', place); setAvatarState('idle', { caption: 'You\'re all set! Drop a file whenever you\'re ready.' }); };
  const key = (e) => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft' && i) { i--; place(); } };
  const next = () => { if (i < steps.length - 1) { i++; place(); } else end(); };
  tip.addEventListener('click', (e) => {
    if (e.target.closest('[data-end]')) end();
    else if (e.target.closest('[data-prev]')) { i--; place(); }
    else if (e.target.closest('[data-nextt]')) next();
  });
  catcher.addEventListener('click', next);
  document.addEventListener('keydown', key);
  addEventListener('resize', place);
  place();
}
