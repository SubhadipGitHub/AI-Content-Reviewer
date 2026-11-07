// Renders PNG app icons from an inline SVG using the preinstalled Playwright Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'icons');
const svg = (pad, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset=".42" stop-color="#7c6cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient><radialGradient id="h" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
${bg ? '<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#h)"/>' : '<rect width="512" height="512" rx="116" fill="url(#g)"/><rect width="512" height="512" rx="116" fill="url(#h)"/>'}
<g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})"><g fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" transform="translate(64 64) scale(16)"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" stroke-width="1.9"/><circle cx="12" cy="12" r="3.2" stroke-width="1.9"/><path d="m16.4 16.4-2.1-2.1" stroke-width="1.9"/><circle cx="12" cy="12" r="1" fill="#fff" stroke="none"/></g></g></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shots = [['icon-192.png', 192, 0, false], ['icon-512.png', 512, 0, false], ['icon-maskable-512.png', 512, 70, true], ['apple-touch-icon.png', 180, 40, true]];
  for (const [name, size, pad, bg] of shots) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(pad, bg).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await b.close();
  console.log('icons rendered');
})();
