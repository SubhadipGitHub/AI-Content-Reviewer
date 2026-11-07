// Mascot controller: picks the renderer (3D, SVG or off), moves the single avatar
// instance between view "slots" and the floating dock, and shows the speech bubble.

import { STATES, TIPS } from './states.js';
import { AvatarSVG } from './fallback.js';
import { el, prefersReducedMotion } from '../lib/dom.js';
import { announce } from '../ui/live.js';

let impl = null;
let mode = 'off';
let host = null;
let bubble = null;
let bubbleTimer = 0;
let current = 'idle';
let slot = null;
let dock = null;
let tipIndex = 0;
// ?avatar=<state> pins the mascot to one state (used for screenshots/tests).
const forced = new URLSearchParams(location.search).get('avatar');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function ensureHost() {
  if (host) return host;
  host = el('<div class="avatar-host"></div>');
  bubble = el('<div class="bubble" role="presentation"></div>');
  host.addEventListener('click', () => {
    impl?.play?.(['wave', 'spin', 'bounce', 'nod'][Math.floor(Math.random() * 4)]);
    say(TIPS[tipIndex++ % TIPS.length], null, 5200);
  });
  return host;
}

/** @param {'3d'|'simple'|'off'} pref */
export async function initAvatar(pref = '3d') {
  impl?.destroy?.();
  impl = null;
  mode = pref;
  if (pref === 'off') { placeHost(); return; }
  ensureHost();
  const want3d = pref === '3d' && !prefersReducedMotion() && webglAvailable() && !new URLSearchParams(location.search).has('nowebgl');
  if (want3d) {
    try {
      const { Avatar3D } = await import('./avatar3d.js');
      impl = new Avatar3D().init();
    } catch (e) {
      console.warn('3D mascot unavailable, using SVG', e);
      impl = null;
    }
  }
  if (!impl) { impl = new AvatarSVG().init(); mode = pref === '3d' ? 'simple' : pref; }
  host.dataset.mode = mode;
  impl.setState(current);
  placeHost();
}

export const avatarMode = () => mode;

function placeHost() {
  if (!host) return;
  if (mode === 'off' || !impl) { host.remove(); dock?.remove(); return; }
  if (slot && slot.isConnected) {
    dock?.remove();
    slot.appendChild(host);
    host.appendChild(bubble);
    bubble.className = 'bubble stage-bubble';
    impl.mount(host, slot.dataset.framing || 'full');
  } else {
    if (!dock) dock = el('<div class="avatar-dock" title="Lens — click me for a tip"><div class="avatar-slot"></div></div>');
    if (!dock.isConnected) document.body.appendChild(dock);
    const ds = dock.firstElementChild;
    ds.appendChild(host);
    dock.appendChild(bubble);
    bubble.className = 'bubble dock-bubble';
    impl.mount(host, 'head');
  }
  bubble.dataset.tone = STATES[current]?.tone || '';
  if (!STATES[current]?.tone) delete bubble.dataset.tone;
  document.documentElement.style.setProperty('--avatar-color', STATES[current]?.color || '#8b7bff');
}

/** Put the avatar in a view slot (element with class avatar-slot), or null for the dock. */
export function mountAvatar(slotEl) {
  slot = slotEl;
  placeHost();
}

/** Hide the floating dock (e.g. while a modal owns the avatar). */
export function setDockVisible(v) { if (dock) dock.style.display = v ? '' : 'none'; }

export function setAvatarState(name, { caption, tone, sticky = false, silent = false } = {}) {
  if (forced && name !== forced) return;
  const cfg = STATES[name] || STATES.idle;
  const changed = name !== current;
  current = name;
  impl?.setState(name);
  document.documentElement.style.setProperty('--avatar-color', cfg.color);
  if (!silent) {
    const text = caption ?? cfg.caption;
    if (text && (changed || caption)) say(text, tone ?? cfg.tone, sticky ? 0 : 4800);
  }
}

export function say(text, tone, ms = 4800) {
  if (!bubble || mode === 'off') { if (text) announce(text); return; }
  bubble.textContent = text;
  if (tone) bubble.dataset.tone = tone; else delete bubble.dataset.tone;
  bubble.classList.add('show');
  announce(text);
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

export function hideBubble() { bubble?.classList.remove('show'); }
export function playAvatar(action) { impl?.play?.(action); }
export const avatarState = () => current;
