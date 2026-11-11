// Sound effects and engine noise, all synthesised with the Web Audio API (no audio files).
//
//   sfx.<name>()             one-shot effects (see the list below)
//   engine.update(car, dt)   call every frame while driving; engine.stop() when leaving the screen
//   toggleMute(), isMuted()  M (or a controller's View button) toggles from anywhere; remembered
//
// Browsers only allow audio after the player interacts with the page, so the AudioContext is
// created on the first click, key press or controller button.
import { onKey } from './game/input.js';
import { CAR } from './game/car.js';

const MUTE_KEY = 'artdrive.muted';
const VOLUME = 0.5;

let ac = null, master = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();

function init() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  // A gentle compressor so overlapping sounds don't clip.
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12;
  master.connect(comp).connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, init, { capture: true });
addEventListener('gamepadconnected', init);

const ready = () => !!ac && !muted && ac.state === 'running';

// --- Building blocks ---------------------------------------------------------------

// A note: oscillator → gain envelope (attack, then exponential decay) → master.
function tone({ freq, to = freq, type = 'sine', at = 0, dur = 0.2, vol = 0.3, attack = 0.005 }) {
  const t = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// A burst of filtered noise (clicks, whooshes).
function noise({ at = 0, dur = 0.1, vol = 0.3, type = 'bandpass', freq = 2000, to = freq, q = 1 }) {
  const t = ac.currentTime + at;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

const play = fn => () => { if (ready()) fn(); };

// --- Effects ---------------------------------------------------------------------

export const sfx = {
  // Menu button.
  click: play(() => tone({ freq: 900, to: 600, type: 'triangle', dur: 0.06, vol: 0.12 })),

  // The game starts: a rising arpeggio.
  start: play(() => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'square', at: i * 0.09, dur: 0.18, vol: 0.12 }));
    tone({ freq: 1047, type: 'triangle', at: 0.36, dur: 0.5, vol: 0.2 });
  }),

  // We photographed an artwork: shutter click, mirror slap, then a bright "got it" chime.
  shutter: play(() => {
    noise({ dur: 0.03, vol: 0.6, type: 'highpass', freq: 3000 });
    noise({ at: 0.06, dur: 0.05, vol: 0.5, type: 'bandpass', freq: 1800, q: 2 });
    tone({ freq: 1320, type: 'triangle', at: 0.1, dur: 0.15, vol: 0.18 });
    tone({ freq: 1760, type: 'triangle', at: 0.17, dur: 0.25, vol: 0.18 });
  }),

  // Another player photographed one: a quieter, duller click.
  remoteShutter: play(() => {
    noise({ dur: 0.03, vol: 0.18, type: 'bandpass', freq: 1500, q: 1.5 });
    noise({ at: 0.05, dur: 0.04, vol: 0.14, type: 'bandpass', freq: 1100, q: 2 });
  }),

  // Can't take a photo (film full).
  denied: play(() => {
    tone({ freq: 220, type: 'square', dur: 0.12, vol: 0.12 });
    tone({ freq: 165, type: 'square', at: 0.1, dur: 0.18, vol: 0.12 });
  }),

  // Boost kicks in: a rising whoosh with a thump.
  boost: play(() => {
    noise({ dur: 0.6, vol: 0.35, type: 'bandpass', freq: 400, to: 3500, q: 0.8 });
    tone({ freq: 90, to: 45, type: 'sine', dur: 0.25, vol: 0.4 });
  }),

  // Boost tank ran dry.
  boostEmpty: play(() => noise({ dur: 0.35, vol: 0.2, type: 'bandpass', freq: 2500, to: 300, q: 1 })),

  // Time mode countdown, each of the last seconds. Higher for the final three.
  tick: play(() => tone({ freq: 1000, type: 'square', dur: 0.05, vol: 0.1 })),
  tickUrgent: play(() => tone({ freq: 1500, type: 'square', dur: 0.08, vol: 0.14 })),

  // The game is over: a buzzer if the time ran out, otherwise a short flourish.
  end: play(() => {
    tone({ freq: 784, type: 'square', dur: 0.15, vol: 0.12 });
    tone({ freq: 659, type: 'square', at: 0.15, dur: 0.15, vol: 0.12 });
    tone({ freq: 523, type: 'triangle', at: 0.3, dur: 0.6, vol: 0.2 });
  }),
  timeUp: play(() => {
    tone({ freq: 180, type: 'sawtooth', dur: 0.9, vol: 0.18 });
    tone({ freq: 185, type: 'sawtooth', dur: 0.9, vol: 0.18 });
  }),

  // Results: a fanfare for a win, a gentler chord otherwise.
  win: play(() => {
    const notes = [[523, 0], [523, 0.12], [523, 0.24], [659, 0.36], [784, 0.6], [1047, 0.84]];
    for (const [f, at] of notes) tone({ freq: f, type: 'square', at, dur: at < 0.8 ? 0.2 : 0.8, vol: 0.12 });
    for (const f of [523, 659, 784]) tone({ freq: f, type: 'triangle', at: 0.84, dur: 1, vol: 0.1 });
  }),
  results: play(() => {
    for (const [i, f] of [392, 494, 587].entries()) tone({ freq: f, type: 'triangle', at: i * 0.08, dur: 0.9, vol: 0.12 });
  }),
};

// --- Engine ------------------------------------------------------------------------
// Two detuned oscillators through a low-pass filter; pitch and brightness follow the speed.
// While boosting, a layer of rushing noise is added.

let eng = null;

function buildEngine() {
  const out = ac.createGain();
  out.gain.value = 0;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 4;
  const a = ac.createOscillator(), b = ac.createOscillator();
  a.type = 'sawtooth';
  b.type = 'square';
  b.detune.value = -1200 + 7;  // an octave down, slightly out of tune for a rough idle
  a.connect(filter);
  b.connect(filter);
  filter.connect(out).connect(master);

  const rush = ac.createBufferSource();
  rush.buffer = noiseBuf;
  rush.loop = true;
  const rushFilter = ac.createBiquadFilter();
  rushFilter.type = 'bandpass';
  rushFilter.frequency.value = 1200;
  rushFilter.Q.value = 0.7;
  const rushGain = ac.createGain();
  rushGain.gain.value = 0;
  rush.connect(rushFilter).connect(rushGain).connect(master);

  a.start();
  b.start();
  rush.start();
  return { out, filter, a, b, rushGain, rushFilter };
}

export const engine = {
  // car: { speed, boosting }. Smoothly follows the car; silent while muted.
  update(car) {
    if (!ac || ac.state !== 'running') return;
    eng ??= buildEngine();
    const t = ac.currentTime;
    const s = Math.min(1, Math.abs(car.speed) / CAR.boostMaxSpeed);
    const freq = 45 + s * 160;
    eng.a.frequency.setTargetAtTime(freq, t, 0.08);
    eng.b.frequency.setTargetAtTime(freq, t, 0.08);
    eng.filter.frequency.setTargetAtTime(300 + s * 2200, t, 0.08);
    eng.out.gain.setTargetAtTime(0.05 + s * 0.09, t, 0.1);
    eng.rushGain.gain.setTargetAtTime(car.boosting ? 0.18 : 0, t, car.boosting ? 0.05 : 0.25);
    eng.rushFilter.frequency.setTargetAtTime(car.boosting ? 2500 : 1200, t, 0.2);
  },

  stop() {
    if (!eng) return;
    const t = ac.currentTime;
    eng.out.gain.setTargetAtTime(0, t, 0.1);
    eng.rushGain.gain.setTargetAtTime(0, t, 0.1);
  },
};

// --- Mute --------------------------------------------------------------------------

const button = document.createElement('button');
button.className = 'mute-btn';
document.body.append(button);

function showMute() {
  button.textContent = muted ? '🔇' : '🔊';
  button.title = muted ? 'Sound off (M to turn on)' : 'Sound on (M to mute)';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(muted));
}

export const isMuted = () => muted;

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.02);
  showMute();
  if (!muted) sfx.click();
}

button.onclick = e => { e.stopPropagation(); init(); toggleMute(); button.blur(); };
onKey(e => { if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) toggleMute(); });
// Every button in the menus clicks (the mute button handles its own sound).
addEventListener('click', e => { if (e.target.closest?.('button') && e.target !== button) sfx.click(); });
showMute();
