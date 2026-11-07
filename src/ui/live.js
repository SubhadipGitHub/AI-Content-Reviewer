// Polite ARIA live region for status updates (scan progress, mascot captions).
let region = null;
let last = '';
export function announce(text) {
  if (!region) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('role', 'status');
    document.body.appendChild(region);
  }
  if (text === last) text += ' ';
  last = text;
  region.textContent = text;
}
