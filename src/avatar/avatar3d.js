// "Lens", the procedural three.js mascot. Built entirely from primitives so it is tiny,
// needs no model files and works offline / from a single HTML file.

import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, SphereGeometry, CapsuleGeometry, TorusGeometry,
  CylinderGeometry, PlaneGeometry, CircleGeometry, BoxGeometry, MeshPhysicalMaterial, MeshBasicMaterial, HemisphereLight,
  DirectionalLight, PointLight, Color, CanvasTexture, Sprite, SpriteMaterial, AdditiveBlending, BufferGeometry,
  Float32BufferAttribute, Points, PointsMaterial, SRGBColorSpace, ACESFilmicToneMapping, Vector3,
} from 'three';
import { STATES } from './states.js';

const TAU = Math.PI * 2;
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const glowTex = () => canvasTex(128, 128, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const glyphTex = (ch) => canvasTex(128, 128, (g, w) => {
  g.font = `800 ${ch === 'z' ? 84 : 100}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 16;
  g.fillStyle = '#fff'; g.fillText(ch, w / 2, w / 2 + 6);
});
const docTex = () => canvasTex(256, 330, (g, w, h) => {
  g.fillStyle = '#f7f7ff'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.fill();
  g.fillStyle = '#c9cbea';
  g.fillRect(28, 34, 120, 16);
  for (let y = 74, i = 0; y < h - 30; y += 24, i++) g.fillRect(28, y, [190, 170, 200, 140, 185, 160, 120, 195, 175, 90][i % 10], 9);
  g.fillStyle = '#a99cff'; g.beginPath(); g.roundRect(28, h - 70, 80, 40, 8); g.fill();
});

export class Avatar3D {
  constructor() {
    this.canvas = null;
    this.state = 'idle';
    this.cfg = STATES.idle;
    this.t = 0;
    this.pointer = { x: 0, y: 0 };
    this.p = { halo: 0.5, bob: 1, lean: 0, tilt: 0, slump: 0, eyeX: 1, eyeY: 1, happy: 0, xeyes: 0, beam: 0, glyph: 0, framing: 1 };
    this.color = new Color(STATES.idle.color);
    this.target = new Color(STATES.idle.color);
    this.actions = [];
    this.nextBlink = 2;
    this.blink = 0;
    this.running = false;
    this.visible = true;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.acc = 0;
    this.framing = 'full';
  }

  /** Throws if WebGL is unavailable so the caller can fall back to SVG. */
  init() {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');

    const scene = (this.scene = new Scene());
    this.camera = new PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, -0.2, 10.5);

    scene.add(new HemisphereLight('#d7dbff', '#1b1d3d', 1.25));
    const key = new DirectionalLight('#ffffff', 2.4); key.position.set(3, 4, 6); scene.add(key);
    this.rim = new PointLight(this.color, 40, 12); this.rim.position.set(-2.6, 1.8, -2.2); scene.add(this.rim);
    this.fill = new PointLight(this.color, 8, 10); this.fill.position.set(0, -1.4, 3.2); scene.add(this.fill);

    const bodyMat = new MeshPhysicalMaterial({ color: '#f1efff', roughness: 0.34, metalness: 0.04, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.4, sheenColor: new Color('#cfc7ff') });
    const visorMat = new MeshPhysicalMaterial({ color: '#0b0c1d', roughness: 0.12, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.glowMat = new MeshBasicMaterial({ color: this.color });
    const glowT = glowTex();

    const root = (this.root = new Group());
    scene.add(root);
    const bot = (this.bot = new Group());
    root.add(bot);

    // Head
    const head = (this.head = new Group());
    head.position.y = 0.35;
    bot.add(head);
    const skull = new Mesh(new SphereGeometry(1, 48, 32), bodyMat);
    skull.scale.set(1.1, 0.95, 1);
    head.add(skull);
    const visor = new Mesh(new SphereGeometry(1, 48, 32, Math.PI / 2 - 0.82, 1.64, Math.PI / 2 - 0.52, 1.04), visorMat);
    visor.scale.set(1.12, 0.97, 1.035);
    head.add(visor);

    // Eyes
    const eyes = (this.eyes = new Group());
    eyes.position.set(0, 0.04, 0);
    head.add(eyes);
    this.eyeL = this.makeEye(-0.33, glowT);
    this.eyeR = this.makeEye(0.33, glowT);
    eyes.add(this.eyeL.g, this.eyeR.g);

    // Ears
    for (const s of [-1, 1]) {
      const ear = new Mesh(new CylinderGeometry(0.21, 0.21, 0.18, 28), bodyMat);
      ear.rotation.z = Math.PI / 2; ear.position.set(s * 1.1, 0, 0);
      const ring = new Mesh(new TorusGeometry(0.15, 0.03, 10, 32), this.glowMat);
      ring.rotation.y = Math.PI / 2; ring.position.set(s * 1.2, 0, 0);
      head.add(ear, ring);
    }

    // Antenna
    const ant = (this.antenna = new Group());
    ant.position.set(0, 0.9, 0);
    head.add(ant);
    const stalk = new Mesh(new CylinderGeometry(0.025, 0.035, 0.42, 10), bodyMat);
    stalk.position.y = 0.2;
    const tip = new Mesh(new SphereGeometry(0.085, 20, 16), this.glowMat);
    tip.position.y = 0.45;
    this.tipGlow = new Sprite(new SpriteMaterial({ map: glowT, color: this.color, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }));
    this.tipGlow.scale.setScalar(0.55); this.tipGlow.position.y = 0.45;
    ant.add(stalk, tip, this.tipGlow);

    // Torso + arms
    const torso = new Mesh(new CapsuleGeometry(0.46, 0.3, 10, 24), bodyMat);
    torso.position.y = -1.2; torso.scale.set(1.05, 0.9, 0.88);
    bot.add(torso);
    const chest = new Mesh(new CircleGeometry(0.11, 24), this.glowMat);
    chest.position.set(0, -1.1, 0.41);
    bot.add(chest);
    this.chest = chest;
    this.arms = [-1, 1].map((s) => {
      const pivot = new Group();
      pivot.position.set(s * 0.56, -0.95, 0);
      const arm = new Mesh(new CapsuleGeometry(0.105, 0.36, 8, 16), bodyMat);
      arm.position.y = -0.3;
      pivot.add(arm);
      pivot.rotation.z = s * 0.18;
      bot.add(pivot);
      return pivot;
    });

    // Halo + satellites
    const halo = (this.halo = new Group());
    halo.rotation.x = Math.PI / 2.55;
    halo.position.y = -0.62;
    root.add(halo);
    this.ringMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.75 });
    halo.add(new Mesh(new TorusGeometry(1.62, 0.018, 10, 160), this.ringMat));
    this.sats = [0, 1, 2].map((i) => {
      const m = new Mesh(new SphereGeometry(0.065, 14, 10), this.glowMat);
      const a = (i / 3) * TAU;
      m.position.set(Math.cos(a) * 1.62, Math.sin(a) * 1.62, 0);
      halo.add(m);
      return m;
    });

    // Shadow
    const shadow = (this.shadow = new Mesh(new PlaneGeometry(2.6, 0.7), new MeshBasicMaterial({ map: glowT, color: '#000010', transparent: true, opacity: 0.35, depthWrite: false })));
    shadow.position.set(0, -2.25, 0); shadow.rotation.x = -Math.PI / 2;
    root.add(shadow);

    // Document + scan beam
    const doc = (this.doc = new Group());
    doc.position.set(1.25, -0.9, 1.25); doc.rotation.set(-0.12, -0.5, 0.06);
    const page = new Mesh(new PlaneGeometry(0.95, 1.22), new MeshBasicMaterial({ map: docTex(), transparent: true }));
    this.beamMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    this.beam = new Mesh(new BoxGeometry(1.1, 0.035, 0.01), this.beamMat);
    this.beamGlow = new Mesh(new PlaneGeometry(1.25, 0.32), new MeshBasicMaterial({ map: glowT, color: this.color, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }));
    doc.add(page, this.beam, this.beamGlow);
    doc.scale.setScalar(0.001);
    root.add(doc);

    // Glyphs ("!", "?", "z")
    this.glyphs = {};
    for (const ch of ['!', '?', 'z']) {
      const sp = new Sprite(new SpriteMaterial({ map: glyphTex(ch), color: this.color, transparent: true, depthWrite: false, opacity: 0 }));
      sp.scale.setScalar(0.62);
      sp.position.set(1.05, 1.55, 0.2);
      root.add(sp);
      this.glyphs[ch] = sp;
    }
    this.zs = [0, 1].map(() => { const s = this.glyphs.z.clone(); s.material = this.glyphs.z.material.clone(); root.add(s); return s; });

    // Sparkles
    const N = 46;
    const pos = new Float32Array(N * 3);
    this.sparkVel = new Float32Array(N * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.sparkMat = new PointsMaterial({ map: glowT, color: this.color, size: 0.22, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    this.sparks = new Points(g, this.sparkMat);
    root.add(this.sparks);
    this.sparkT = 9;

    this.onPointer = (e) => {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      this.pointer.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
      this.pointer.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
    };
    window.addEventListener('pointermove', this.onPointer, { passive: true });

    this.io = new IntersectionObserver((es) => { this.visible = es.some((x) => x.isIntersecting); this.loop(); });
    this.io.observe(this.canvas);
    document.addEventListener('visibilitychange', () => this.loop());
    this.ro = new ResizeObserver(() => this.resize());
    this.setState('idle');
    return this;
  }

  makeEye(x, glowT) {
    const g = new Group();
    g.position.set(x, 0, 1.0);
    g.rotation.y = x * 0.75;
    const open = new Mesh(new CapsuleGeometry(0.085, 0.15, 6, 14), this.glowMat);
    const happyMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0 });
    const happy = new Mesh(new TorusGeometry(0.12, 0.038, 8, 24, Math.PI), happyMat);
    happy.position.y = -0.05;
    const xMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0 });
    const x1 = new Mesh(new CapsuleGeometry(0.032, 0.2, 4, 8), xMat); x1.rotation.z = Math.PI / 4;
    const x2 = new Mesh(new CapsuleGeometry(0.032, 0.2, 4, 8), xMat); x2.rotation.z = -Math.PI / 4;
    const glow = new Sprite(new SpriteMaterial({ map: glowT, color: this.color, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
    glow.scale.set(0.62, 0.72, 1);
    glow.position.z = -0.02;
    g.add(glow, open, happy, x1, x2);
    return { g, open, happy, happyMat, xMat, glow };
  }

  mount(host, framing = 'full') {
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
    this.framing = framing;
    this.ro.disconnect();
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  resize() {
    const host = this.canvas.parentElement;
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render(0);
  }

  setState(name) {
    const cfg = STATES[name] || STATES.idle;
    const prev = this.state;
    this.state = name;
    this.cfg = cfg;
    this.target.set(cfg.color);
    if (cfg.action && (prev !== name || cfg.action === 'shake')) this.play(cfg.action);
    if (cfg.sparkle) this.burst();
    this.loop();
  }

  play(action) {
    const dur = { wave: 2.2, shake: 0.9, bounce: 1.3, nod: 1.2, spin: 1.1 }[action] || 1;
    this.actions = this.actions.filter((a) => a.name !== action);
    this.actions.push({ name: action, t: 0, dur });
    this.loop();
  }

  burst() {
    const pos = this.sparks.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const a = Math.random() * TAU, e = (Math.random() - 0.3) * 1.6, s = 1.4 + Math.random() * 2.2;
      pos[i] = 0; pos[i + 1] = 0.3; pos[i + 2] = 0.4;
      this.sparkVel[i] = Math.cos(a) * s; this.sparkVel[i + 1] = e * s * 0.8 + 1; this.sparkVel[i + 2] = Math.sin(a) * s * 0.4;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparkT = 0;
  }

  loop() {
    const shouldRun = this.visible && !document.hidden && this.canvas?.isConnected;
    if (shouldRun && !this.running) {
      this.running = true;
      this.last = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        if (!(this.visible && !document.hidden && this.canvas.isConnected)) { this.running = false; return; }
        let dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.acc += dt;
        if (this.coarse && this.acc < 1 / 32) { requestAnimationFrame(tick); return; }
        dt = this.acc; this.acc = 0;
        this.render(dt);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  render(dt) {
    const c = this.cfg, p = this.p;
    this.t += dt;
    const t = this.t;

    // Smoothly approach the state's targets
    p.halo = damp(p.halo, c.halo ?? 0.5, 3, dt);
    p.bob = damp(p.bob, c.bob ?? 1, 3, dt);
    p.lean = damp(p.lean, c.lean ?? 0, 5, dt);
    p.tilt = damp(p.tilt, c.tilt ?? 0, 4, dt);
    p.slump = damp(p.slump, c.slump ?? 0, 3, dt);
    p.beam = damp(p.beam, c.beam ? 1 : 0, 5, dt);
    p.glyph = damp(p.glyph, c.glyph ? 1 : 0, 5, dt);
    p.framing = damp(p.framing, this.framing === 'head' ? 0 : 1, 4, dt);
    const eyes = c.eyes;
    const ex = { wide: 1.15, narrow: 1.18, closed: 1.25, focus: 1.05 }[eyes] ?? 1;
    const ey = { wide: 1.35, narrow: 0.42, closed: 0.1, focus: 0.72 }[eyes] ?? 1;
    p.eyeX = damp(p.eyeX, ex, 10, dt);
    p.eyeY = damp(p.eyeY, ey, 10, dt);
    p.happy = damp(p.happy, eyes === 'happy' ? 1 : 0, 9, dt);
    p.xeyes = damp(p.xeyes, eyes === 'x' ? 1 : 0, 9, dt);
    this.color.lerp(this.target, 1 - Math.exp(-5 * dt));

    // Colours
    const col = this.color;
    for (const m of [this.glowMat, this.ringMat, this.beamMat, this.sparkMat, this.tipGlow.material, this.eyeL.happyMat, this.eyeR.happyMat, this.eyeL.xMat, this.eyeR.xMat, this.eyeL.glow.material, this.eyeR.glow.material, this.beamGlow.material]) m.color.copy(col);
    for (const g of Object.values(this.glyphs)) g.material.color.copy(col);
    for (const z of this.zs) z.material.color.copy(col);
    this.rim.color.copy(col); this.fill.color.copy(col);
    let flick = 1;
    if (c.flicker) flick = Math.sin(t * 31) > 0.6 || Math.sin(t * 7.3) > 0.85 ? 0.25 : 1;
    this.glowMat.color.multiplyScalar(flick);

    // Blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && !['closed', 'happy', 'x'].includes(eyes)) { this.blink = 0.16; this.nextBlink = 2.2 + Math.random() * 3.5; }
    let blinkK = 1;
    if (this.blink > 0) { this.blink -= dt; blinkK = Math.max(0.08, Math.abs(this.blink - 0.08) / 0.08); }

    // Eyes
    const openOp = (1 - p.happy) * (1 - p.xeyes);
    for (const e of [this.eyeL, this.eyeR]) {
      e.open.scale.set(p.eyeX, p.eyeY * blinkK, 1);
      e.open.visible = openOp > 0.02;
      e.open.scale.multiplyScalar(Math.max(0.001, openOp));
      e.happyMat.opacity = p.happy;
      e.xMat.opacity = p.xeyes;
      e.glow.material.opacity = 0.5 * flick * (0.4 + 0.6 * openOp + p.happy * 0.5);
    }
    let lookX = this.pointer.x * 0.07, lookY = -this.pointer.y * 0.05;
    if (eyes === 'look') { lookX = Math.sin(t * 1.3) > 0 ? 0.09 : -0.09; lookY = 0.03; }
    if (eyes === 'focus') { lookX = 0.08; lookY = -0.06; }
    this.eyes.position.x = damp(this.eyes.position.x, lookX, 8, dt);
    this.eyes.position.y = damp(this.eyes.position.y, 0.04 + lookY, 8, dt);

    // Body motion
    const follow = ['idle', 'guide', 'drag', 'clean', 'offline'].includes(this.state) ? 1 : 0.35;
    let headRy = this.pointer.x * 0.38 * follow;
    let headRx = this.pointer.y * 0.22 * follow + p.lean + p.slump * 0.25;
    let rootY = Math.sin(t * 1.6) * 0.09 * p.bob - p.slump * 0.18;
    let rootRz = p.tilt + Math.sin(t * 0.9) * 0.025 * p.bob;
    let rootRy = 0, squash = 1;
    let armL = -0.18, armR = 0.18, headRzV = 0;
    if (eyes === 'focus') { headRy = 0.32 + Math.sin(t * 2) * 0.03; headRx = 0.16; }

    for (const a of this.actions) {
      a.t += dt;
      const k = a.t / a.dur;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      if (a.name === 'wave') { armR = 2.55 + Math.sin(a.t * 11) * 0.42 * env; armR = armR * env + 0.18 * (1 - env); headRzV = 0.1 * env; }
      if (a.name === 'shake') headRy += Math.sin(a.t * 26) * 0.28 * (1 - k);
      if (a.name === 'bounce') { const b = Math.abs(Math.sin(k * Math.PI * 2)); rootY += b * 0.42; squash = 1 + (b < 0.15 ? -0.08 : 0.04); armL = -0.18 - b * 1.2; armR = 0.18 + b * 1.2; }
      if (a.name === 'nod') headRx += Math.sin(k * Math.PI * 4) * 0.22 * (1 - k);
      if (a.name === 'spin') rootRy = k * TAU * (1 - (1 - k) ** 3);
    }
    this.actions = this.actions.filter((a) => a.t < a.dur);
    if (this.state === 'processing') { armR = 0.95 + Math.sin(t * 4) * 0.08; }
    if (this.state === 'notfound') { armL = -0.75 - Math.sin(t * 2) * 0.12; armR = 0.75 + Math.sin(t * 2) * 0.12; } // shrug
    if (this.state === 'sleeping') { rootY += Math.sin(t * 0.8) * 0.04; }

    this.root.position.y = rootY;
    this.root.rotation.z = rootRz;
    this.root.rotation.y = rootRy;
    this.bot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.head.rotation.y = damp(this.head.rotation.y, headRy, 7, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headRx, 7, dt);
    this.head.rotation.z = damp(this.head.rotation.z, headRzV, 7, dt);
    this.arms[0].rotation.z = damp(this.arms[0].rotation.z, armL, 9, dt);
    this.arms[1].rotation.z = damp(this.arms[1].rotation.z, armR, 9, dt);
    this.antenna.rotation.z = Math.sin(t * 2.4) * 0.12 * p.bob - this.head.rotation.y * 0.15;

    // Halo
    this.halo.rotation.z += dt * (0.4 + p.halo * 1.1);
    this.halo.rotation.x = Math.PI / 2.55 + Math.sin(t * 0.7) * 0.04 - (this.state === 'processing' ? Math.abs(Math.sin(t * 3)) * 0.1 : 0);
    this.ringMat.opacity = 0.25 + Math.min(1, p.halo / 2) * 0.65;
    const satScale = 0.6 + Math.min(1.4, p.halo / 3);
    for (const s of this.sats) s.scale.setScalar(satScale);
    this.chest.scale.setScalar(1 + Math.sin(t * (this.state === 'processing' ? 9 : 2.5)) * 0.12);
    this.tipGlow.scale.setScalar(0.5 + Math.sin(t * 3) * 0.08 + (this.state === 'processing' ? 0.25 : 0));

    // Shadow follows bob
    const sh = 1 - (rootY + 0.2) * 0.25;
    this.shadow.scale.set(sh, sh, 1);
    this.shadow.material.opacity = 0.3 * sh;

    // Document + beam
    const ds = Math.max(0.001, p.beam);
    this.doc.scale.setScalar(ds * 0.85);
    this.doc.position.y = -0.9 + Math.sin(t * 1.8) * 0.06;
    const by = Math.sin(t * 3.2) * 0.55;
    this.beam.position.set(0, by, 0.01);
    this.beamGlow.position.set(0, by, 0.012);

    // Glyphs
    for (const [ch, sp] of Object.entries(this.glyphs)) {
      const on = c.glyph === ch ? p.glyph : 0;
      sp.material.opacity = damp(sp.material.opacity, on, 8, dt);
      sp.position.y = 1.55 + Math.sin(t * 2.6) * 0.07;
      sp.material.rotation = ch === '?' ? Math.sin(t * 1.5) * 0.18 : ch === '!' ? Math.sin(t * 12) * 0.06 * on : 0;
      if (ch === 'z') sp.material.opacity = 0;
    }
    const zOn = c.glyph === 'z' ? p.glyph : 0;
    this.zs.forEach((z, i) => {
      const ph = (t * 0.45 + i * 0.5) % 1;
      z.position.set(0.85 + ph * 0.55, 1.15 + ph * 0.9, 0.2);
      z.scale.setScalar(0.28 + ph * 0.35);
      z.material.opacity = zOn * Math.sin(ph * Math.PI);
    });

    // Sparkles
    if (this.sparkT < 1.6) {
      this.sparkT += dt;
      const pos = this.sparks.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] += this.sparkVel[i] * dt; pos[i + 1] += this.sparkVel[i + 1] * dt; pos[i + 2] += this.sparkVel[i + 2] * dt;
        this.sparkVel[i + 1] -= 2.4 * dt;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparkMat.opacity = Math.max(0, 1 - this.sparkT / 1.6);
    }

    // Camera framing: full body vs. head close-up (for the small dock)
    const f = p.framing;
    this.camera.position.set(0, -0.25 * f + 0.38 * (1 - f), 10.6 * f + 6.0 * (1 - f));
    this.camera.lookAt(new Vector3(0, -0.25 * f + 0.25 * (1 - f), 0));
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.running = false;
    window.removeEventListener('pointermove', this.onPointer);
    this.io?.disconnect(); this.ro?.disconnect();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}
