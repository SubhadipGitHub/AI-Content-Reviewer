const mq = matchMedia('(prefers-color-scheme: light)');
let pref = 'system';

export function applyTheme(p = pref) {
  pref = p;
  const resolved = p === 'system' ? (mq.matches ? 'light' : 'dark') : p;
  document.documentElement.dataset.theme = resolved;
  try { localStorage.setItem('acr-theme', resolved); } catch { /* private mode */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f4f5fb' : '#090b16');
  return resolved;
}
mq.addEventListener?.('change', () => pref === 'system' && applyTheme());

export const resolvedTheme = () => document.documentElement.dataset.theme;
export const themePref = () => pref;

export function applyMotion(p) {
  if (p === 'reduce') document.documentElement.dataset.motion = 'reduce';
  else delete document.documentElement.dataset.motion;
}
