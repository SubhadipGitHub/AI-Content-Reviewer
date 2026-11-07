import PATHS from './icon-paths.js';

/** Inline SVG icon string. */
export function icon(name, cls = '') {
  const p = PATHS[name] || PATHS['file'];
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}

const KIND_ICON = { image: 'file-image', pdf: 'file-text', document: 'file-type', archive: 'file-archive', text: 'file-text', media: 'file-video', binary: 'file-question', unknown: 'file' };
const FORMAT_ICON = { xlsx: 'file-spreadsheet', ods: 'file-spreadsheet', csv: 'file-spreadsheet', pptx: 'presentation', odp: 'presentation', mp3: 'file-audio', wav: 'file-audio', audio: 'file-audio' };

export function fileIcon(node) {
  if (node.kind === 'text' && /^(js|ts|py|java|go|rs|c|cpp|cs|php|rb|sh|sql|jsx|tsx|kt|swift|ipynb|html|css|vue|svelte)$/.test(node.format)) return 'file-code';
  return FORMAT_ICON[node.format] || KIND_ICON[node.kind] || 'file';
}

export const CATEGORY_ICON = {
  watermark: 'image', provenance: 'badge-check', metadata: 'fingerprint', artifact: 'bot', hidden: 'eye', style: 'wand-2',
  code: 'code-2', repo: 'settings', formula: 'sheet', context: 'info',
};

export const VERDICT_ICON = { strong: 'octagon-alert', likely: 'alert-triangle', possible: 'info', clean: 'circle-check-big', error: 'circle-help' };
