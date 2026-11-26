// Sound: tiny WebAudio synth, no assets. Engine hum follows throttle, rings chime, crashes thud.
// Everything is created lazily on the first user gesture so browsers allow it.
let ctx = null, engineOsc = null, engineGain = null, master = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 70;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
    engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
    engineOsc.connect(filter); filter.connect(engineGain); engineGain.connect(master);
    engineOsc.start();
  } catch { ctx = null; }
}

export function setEngine(throttle, flying) {
  if (!ctx || !engineOsc) return;
  const t = ctx.currentTime;
  engineOsc.frequency.setTargetAtTime(55 + throttle * 90, t, 0.1);
  engineGain.gain.setTargetAtTime(flying ? 0.05 + throttle * 0.06 : 0.0, t, 0.15);
}

function tone(freq, dur, type, vol, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export function ringChime(combo) {
  const base = 660 + Math.min(combo, 8) * 40;
  tone(base, 0.18, 'sine', 0.5);
  tone(base * 1.5, 0.25, 'sine', 0.4, 0.07);
}
export function missBuzz() { tone(180, 0.3, 'square', 0.25); }
export function crashThud() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.65);
  tone(90, 0.4, 'sawtooth', 0.3);
}
export function winFanfare() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.45, i * 0.12));
}
