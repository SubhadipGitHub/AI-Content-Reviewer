// PWA install flow: native prompt where supported, instructions on iOS/iPadOS.
import { el, html, raw } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { setAvatarState } from '../avatar/index.js';

let deferred = null;
const listeners = new Set();
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isFile = () => location.protocol === 'file:';

export function installState() {
  return { canPrompt: !!deferred, ios: isIOS() && !standalone() && !isFile(), installed: standalone() };
}
export function onInstallChange(fn) { listeners.add(fn); fn(installState()); }
const notify = () => listeners.forEach((fn) => fn(installState()));

export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  addEventListener('appinstalled', () => {
    deferred = null; notify();
    setAvatarState('offline', { caption: 'Installed! Find me on your home screen or app list.' });
    toast({ title: 'App installed', body: 'Lens now works offline from your apps.', tone: 'success' });
  });
}

export async function promptInstall() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    if (outcome === 'accepted') deferred = null;
    notify();
    return;
  }
  const c = el(html`<div style="padding:26px 24px 24px">
    <h2 style="margin-bottom:8px">${isIOS() ? 'Add Lens to your Home Screen' : 'Install Lens'}</h2>
    <p class="muted">${isIOS() ? 'Three taps and Lens opens like a native app — fully offline.' : 'Use your browser\'s install option to add Lens as an app.'}</p>
    <ol class="onb-list" style="counter-reset:s">
      ${isIOS()
        ? html`<li>${raw(icon('share'))}<span>Tap the <b>Share</b> button in Safari's toolbar.</span></li><li>${raw(icon('plus'))}<span>Choose <b>Add to Home Screen</b>.</span></li><li>${raw(icon('check'))}<span>Tap <b>Add</b>, then open Lens from your Home Screen.</span></li>`
        : html`<li>${raw(icon('monitor'))}<span>Chrome / Edge: click the install icon in the address bar, or ⋮ → <b>Install AI Content Reviewer</b>.</span></li><li>${raw(icon('smartphone'))}<span>Android: ⋮ → <b>Install app</b> / <b>Add to Home screen</b>.</span></li><li>${raw(icon('file-code'))}<span>Or download the single-file version from GitHub Releases.</span></li>`}
    </ol></div>`);
  openModal(c, { label: 'Install' });
}
