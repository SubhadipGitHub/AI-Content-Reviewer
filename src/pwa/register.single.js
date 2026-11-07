// Single-file build: no service worker (the HTML file itself is the offline copy).
export function registerPWA() { return () => location.reload(); }
