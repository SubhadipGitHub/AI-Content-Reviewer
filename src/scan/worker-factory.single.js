// Single-file build: worker code is inlined as a Blob URL so the app runs from file://.
import ScanWorker from './worker.js?worker&inline';

export function createWorker() {
  return new ScanWorker({ name: 'scan' });
}
