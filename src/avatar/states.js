// Mascot states shared by the 3D and SVG renderers.
// eyes: normal | wide | narrow | focus | happy | closed | look | x
// action: one-shot animation played on entering the state.

export const STATES = {
  idle: { color: '#8b7bff', eyes: 'normal', halo: 0.5, bob: 1, caption: 'Hi, I\'m Lens! Drop files and I\'ll look for AI fingerprints.', tone: null },
  guide: { color: '#a78bfa', eyes: 'happy', halo: 0.8, bob: 1, action: 'wave', caption: 'Let me show you around.' },
  drag: { color: '#2fd6f0', eyes: 'wide', halo: 1.6, bob: 0.6, lean: 0.22, caption: 'Ooh — drop it right here!' },
  processing: { color: '#2fd6f0', eyes: 'focus', halo: 5, bob: 0.5, beam: true, caption: 'Scanning…' },
  detected: { color: '#fb5a7c', eyes: 'narrow', halo: 1.2, bob: 0.7, glyph: '!', action: 'shake', caption: 'AI fingerprints found!', tone: 'danger' },
  likely: { color: '#fbbf3c', eyes: 'narrow', halo: 1, bob: 0.8, glyph: '!', action: 'shake', caption: 'This looks AI-assisted.', tone: 'warning' },
  possible: { color: '#6aa8ff', eyes: 'normal', halo: 0.8, bob: 0.9, tilt: 0.16, glyph: '?', caption: 'A few signals worth a closer look.', tone: 'info' },
  clean: { color: '#3ee0a1', eyes: 'happy', halo: 0.9, bob: 1.1, action: 'bounce', sparkle: true, caption: 'All clear — no AI signals found.', tone: 'success' },
  mixed: { color: '#fbbf3c', eyes: 'normal', halo: 1, bob: 0.9, tilt: -0.18, glyph: '!', action: 'shake', caption: 'Mixed results — some files are flagged.', tone: 'warning' },
  notfound: { color: '#a78bfa', eyes: 'look', halo: 0.4, bob: 0.8, tilt: 0.28, glyph: '?', caption: 'Hmm… this page doesn\'t exist.', tone: null },
  error: { color: '#9aa1c6', eyes: 'x', halo: 0.1, bob: 0.3, slump: 1, flicker: true, caption: 'Something went wrong with that file.', tone: 'neutral' },
  offline: { color: '#2fd6f0', eyes: 'happy', halo: 1.2, bob: 1, action: 'nod', sparkle: true, caption: 'Ready to work fully offline.', tone: 'success' },
  sleeping: { color: '#6d6af0', eyes: 'closed', halo: 0.12, bob: 0.4, glyph: 'z', slump: 0.35, caption: 'Nothing here yet… zzz', tone: null },
};

export const TIPS = [
  'Tip: drop a whole ZIP — I open nested archives too.',
  'Tip: everything stays on your device. Try turning Wi-Fi off!',
  'Tip: click any result to see the exact evidence.',
  'Tip: big files are saved in your Library for later review.',
  'Tip: install me as an app from the header button.',
  'Tip: a "Strong evidence" verdict needs hard proof like metadata or chatbot residue.',
];
