// Default (PWA) build: worker is emitted as its own file and cached by the service worker.
export function createWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'scan' });
}
