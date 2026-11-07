// SVG version of Lens for devices without WebGL, reduced-motion users, or the
// "Simple" mascot setting. Same states, driven by CSS via data-state.
import { STATES } from './states.js';

const SVG = `
<svg class="lens-svg" viewBox="0 0 200 220" role="img" aria-hidden="true">
  <defs>
    <radialGradient id="lg-body" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfcaf5"/></radialGradient>
    <linearGradient id="lg-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1d38"/><stop offset="1" stop-color="#07081a"/></linearGradient>
    <filter id="lg-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <ellipse class="l-shadow" cx="100" cy="206" rx="46" ry="8"/>
  <g class="l-root">
    <ellipse class="l-halo" cx="100" cy="98" rx="86" ry="24"/>
    <g class="l-body">
      <rect x="70" y="138" width="60" height="50" rx="26" fill="url(#lg-body)"/>
      <circle class="l-glow" cx="100" cy="158" r="6" filter="url(#lg-glow)"/>
      <g class="l-arm l-arm-l"><rect x="58" y="140" width="13" height="36" rx="6.5" fill="url(#lg-body)"/></g>
      <g class="l-arm l-arm-r"><rect x="129" y="140" width="13" height="36" rx="6.5" fill="url(#lg-body)"/></g>
    </g>
    <g class="l-head">
      <line x1="100" y1="36" x2="100" y2="18" stroke="#d9d5f7" stroke-width="4" stroke-linecap="round" class="l-ant"/>
      <circle class="l-glow l-tip" cx="100" cy="15" r="6" filter="url(#lg-glow)"/>
      <rect x="40" y="90" width="12" height="22" rx="5" fill="url(#lg-body)"/>
      <rect x="148" y="90" width="12" height="22" rx="5" fill="url(#lg-body)"/>
      <ellipse cx="100" cy="98" rx="58" ry="58" fill="url(#lg-body)"/>
      <rect x="56" y="74" width="88" height="54" rx="27" fill="url(#lg-visor)"/>
      <g class="l-eyes" filter="url(#lg-glow)">
        <rect class="l-eye l-open" x="74" y="88" width="14" height="24" rx="7"/>
        <rect class="l-eye l-open" x="112" y="88" width="14" height="24" rx="7"/>
        <path class="l-happy" d="M72 106 q9 -14 18 0 M110 106 q9 -14 18 0" fill="none" stroke-width="5" stroke-linecap="round"/>
        <path class="l-x" d="M75 92 l12 14 M87 92 l-12 14 M113 92 l12 14 M125 92 l-12 14" fill="none" stroke-width="4" stroke-linecap="round"/>
      </g>
    </g>
    <text class="l-glyph" x="156" y="46">!</text>
  </g>
</svg>`;

export class AvatarSVG {
  init() {
    const wrap = document.createElement('div');
    wrap.className = 'lens-fallback';
    wrap.innerHTML = SVG;
    this.canvas = wrap;
    this.setState('idle');
    return this;
  }
  mount(host, framing = 'full') {
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
    this.canvas.dataset.framing = framing;
  }
  setState(name) {
    const cfg = STATES[name] || STATES.idle;
    this.canvas.dataset.state = name;
    this.canvas.dataset.eyes = cfg.eyes;
    this.canvas.style.setProperty('--lc', cfg.color);
    const g = this.canvas.querySelector('.l-glyph');
    g.textContent = cfg.glyph || '';
    if (cfg.action) {
      this.canvas.dataset.action = '';
      void this.canvas.offsetWidth;
      this.canvas.dataset.action = cfg.action;
    }
  }
  play(action) {
    this.canvas.dataset.action = '';
    void this.canvas.offsetWidth;
    this.canvas.dataset.action = action;
  }
  destroy() { this.canvas?.remove(); }
}
