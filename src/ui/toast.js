import { el, html, raw } from '../lib/dom.js';
import { icon } from './icons.js';

let wrap = null;
const TONE_ICON = { success: 'circle-check-big', danger: 'octagon-alert', warning: 'alert-triangle', info: 'info', neutral: 'info' };

/**
 * @param {{title: string, body?: string, tone?: string, icon?: string, action?: {label: string, onClick: () => void}, timeout?: number}} o
 */
export function toast(o) {
  if (!wrap) { wrap = el('<div class="toasts" aria-live="polite"></div>'); document.body.appendChild(wrap); }
  const t = el(html`<div class="toast" data-tone="${o.tone || 'info'}" role="status">
    ${raw(icon(o.icon || TONE_ICON[o.tone] || 'info'))}
    <div class="t-body"><b>${o.title}</b>${o.body ? html`<span>${o.body}</span>` : ''}</div>
    ${o.action ? html`<button class="btn btn-sm" data-act>${o.action.label}</button>` : ''}
    <button class="btn btn-ghost icon-btn btn-sm" data-close aria-label="Dismiss">${raw(icon('x'))}</button>
  </div>`);
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  t.querySelector('[data-close]').onclick = close;
  if (o.action) t.querySelector('[data-act]').onclick = () => { o.action.onClick(); close(); };
  wrap.appendChild(t);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  if (o.timeout !== 0) setTimeout(close, o.timeout || 4500);
  return close;
}

