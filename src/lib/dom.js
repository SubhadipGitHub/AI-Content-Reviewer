// Tiny DOM helpers: an auto-escaping `html` tag and element factories. All
// user-controlled strings (file names, evidence) go through escaping.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
export const raw = (v) => new Raw(v);

const render = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.v;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
};

/** Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? render(vals[i]) : ''); });
  return raw(out);
}

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler, opts) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) handler(e, t);
  }, opts);
}

/** Highlight [start,end) ranges inside text safely. */
export function highlight(text, ranges = []) {
  if (!ranges.length) return escapeHtml(text);
  let out = '', pos = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (a < pos) continue;
    out += escapeHtml(text.slice(pos, a)) + '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + escapeHtml(text.slice(pos));
}

export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
