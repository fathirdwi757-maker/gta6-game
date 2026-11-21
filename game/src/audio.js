// All sound is synthesised with WebAudio — there are no audio files.
// One shared context, a master gain, and tiny synth voices for the engine,
// sirens, impacts, punches, chimes and a laid-back synthwave music loop.

let ctx = null;
let master = null;
let engineNodes = null;
let sirenNodes = null;
let musicTimer = null;

function ensureContext() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return true;
}

// Browsers only allow audio after a gesture; the start screen calls this.
export function unlockAudio() {
  if (!ensureContext()) return;
  if (ctx.state === 'suspended') ctx.resume();
  startMusic();
}

function tone(freq, { type = 'sine', dur = 0.15, vol = 0.2, slide = 0, delay = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.12, vol = 0.25, freq = 800, delay = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

export const sfx = {
  punch() { noiseBurst({ dur: 0.09, vol: 0.3, freq: 500 }); tone(90, { type: 'triangle', dur: 0.09, vol: 0.25, slide: -40 }); },
  hurt() { tone(160, { type: 'sawtooth', dur: 0.16, vol: 0.16, slide: -70 }); },
  crash(strength = 1) { noiseBurst({ dur: 0.28, vol: 0.22 * strength + 0.08, freq: 900 }); tone(60, { type: 'square', dur: 0.2, vol: 0.12, slide: -25 }); },
  door() { tone(220, { type: 'square', dur: 0.05, vol: 0.1 }); tone(140, { type: 'square', dur: 0.07, vol: 0.12, delay: 0.06 }); },
  chime() { tone(880, { type: 'sine', dur: 0.14, vol: 0.18 }); tone(1318, { type: 'sine', dur: 0.22, vol: 0.16, delay: 0.09 }); },
  cash() { tone(1046, { type: 'triangle', dur: 0.1, vol: 0.16 }); tone(1568, { type: 'triangle', dur: 0.16, vol: 0.14, delay: 0.07 }); },
  fail() { tone(220, { type: 'sawtooth', dur: 0.25, vol: 0.14, slide: -60 }); tone(147, { type: 'sawtooth', dur: 0.35, vol: 0.14, delay: 0.18, slide: -40 }); },
  click() { tone(660, { type: 'square', dur: 0.04, vol: 0.07 }); },
};

// Continuous engine hum whose pitch follows the driven car's speed.
export function setEngine(on, speedRatio = 0) {
  if (!ctx) return;
  if (on && !engineNodes) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    gain.gain.value = 0.0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    engineNodes = { osc, osc2, gain };
  }
  if (engineNodes) {
    const f = 55 + speedRatio * 165;
    engineNodes.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
    engineNodes.osc2.frequency.setTargetAtTime(f * 0.5 + 2, ctx.currentTime, 0.08);
    engineNodes.gain.gain.setTargetAtTime(on ? 0.055 : 0.0, ctx.currentTime, 0.1);
    if (!on) {
      const nodes = engineNodes;
      engineNodes = null;
      setTimeout(() => { try { nodes.osc.stop(); nodes.osc2.stop(); } catch { /* already stopped */ } }, 350);
    }
  }
}

// Two-tone siren that runs while any police unit is close and active.
export function setSiren(on) {
  if (!ctx) return;
  if (on && !sirenNodes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 830;
    lfo.frequency.value = 0.7;
    lfoGain.gain.value = 170;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.0;
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    sirenNodes = { osc, lfo, gain };
  }
  if (sirenNodes) {
    sirenNodes.gain.gain.setTargetAtTime(on ? 0.028 : 0.0, ctx.currentTime, 0.2);
    if (!on) {
      const nodes = sirenNodes;
      sirenNodes = null;
      setTimeout(() => { try { nodes.osc.stop(); nodes.lfo.stop(); } catch { /* already stopped */ } }, 600);
    }
  }
}

// A slow synthwave loop: soft bass pulse and a pentatonic sparkle on top,
// scheduled bar by bar so it can run forever without a big lookahead buffer.
const BASS_LINE = [55, 55, 65.4, 49]; // A1 A1 C2 G1
const SPARKLE = [440, 523.25, 659.25, 783.99, 659.25, 523.25];
function startMusic() {
  if (!ctx || musicTimer) return;
  let bar = 0;
  const playBar = () => {
    if (!ctx) return;
    const root = BASS_LINE[bar % BASS_LINE.length];
    for (let beat = 0; beat < 4; beat++) {
      tone(root * 2, { type: 'triangle', dur: 0.42, vol: 0.05, delay: beat * 0.46 });
    }
    for (let i = 0; i < 3; i++) {
      const note = SPARKLE[(bar * 3 + i) % SPARKLE.length];
      tone(note, { type: 'sine', dur: 0.5, vol: 0.028, delay: i * 0.62 + 0.2 });
    }
    bar++;
  };
  playBar();
  musicTimer = setInterval(playBar, 1840);
}
