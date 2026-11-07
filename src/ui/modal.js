import { el, html, raw } from '../lib/dom.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const f = [...container.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/**
 * Open a modal dialog. `content` is an element placed inside `.modal`.
 * @returns {() => void} close function
 */
export function openModal(content, { label = 'Dialog', onClose, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  const scrim = el('<div class="scrim"></div>');
  const wrap = el(html`<div class="modal-wrap" role="dialog" aria-modal="true" aria-label="${label}"><div class="modal"></div></div>`);
  const modal = wrap.firstElementChild;
  if (dismissable) {
    const x = el(html`<button class="btn btn-ghost icon-btn close" aria-label="Close">${raw(icon('x'))}</button>`);
    x.onclick = () => close();
    modal.appendChild(x);
  }
  modal.appendChild(content);
  document.body.append(scrim, wrap);
  requestAnimationFrame(() => scrim.classList.add('open'));
  document.body.style.overflow = 'hidden';
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); trapFocus(modal, e); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && dismissable) close(); });
  setTimeout(() => (modal.querySelector('[autofocus]') || modal.querySelector(FOCUSABLE))?.focus(), 50);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    scrim.classList.remove('open');
    wrap.style.transition = 'opacity 200ms';
    wrap.style.opacity = '0';
    setTimeout(() => { scrim.remove(); wrap.remove(); }, 220);
    document.body.style.overflow = '';
    prevFocus?.focus?.();
    onClose?.();
  }
  return close;
}

export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const c = el(html`<div style="padding:26px 24px 22px">
      <h2 style="margin-bottom:8px;padding-right:30px">${title}</h2>
      <p class="muted">${body}</p>
      <div class="row" style="justify-content:flex-end;margin-top:22px">
        <button class="btn" data-no>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes autofocus>${confirm}</button>
      </div></div>`);
    const close = openModal(c, { label: title, onClose: () => resolve(result) });
    c.querySelector('[data-no]').onclick = () => close();
    c.querySelector('[data-yes]').onclick = () => { result = true; close(); };
  });
}
