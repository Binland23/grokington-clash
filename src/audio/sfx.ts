/** Tiny WebAudio synth: every sound is generated, so there are no audio files to ship. */

type SfxName =
  | 'click'
  | 'card'
  | 'deploy'
  | 'hit'
  | 'heavy'
  | 'arrow'
  | 'shot'
  | 'fire'
  | 'boom'
  | 'zap'
  | 'freeze'
  | 'heal'
  | 'rage'
  | 'tower'
  | 'crown'
  | 'death'
  | 'power'
  | 'win'
  | 'lose'
  | 'tick'
  | 'chest'
  | 'reward'
  | 'whoosh'
  | 'charge'
  | 'upgrade'
  | 'stat'
  | 'nope';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
let musicGain: GainNode | null = null;
let musicOn = true;
let musicTimer: number | null = null;
const lastPlayed = new Map<string, number>();

export function setSfxEnabled(on: boolean): void {
  enabled = on;
}

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  if (!on) stopMusic();
}

/** Must be called from a user gesture (iOS unlocks audio on touch). */
export function unlockAudio(): void {
  const first = !ctx;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (first) void loadSamples();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass', delay = 0, q = 1): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------- recorded samples
// Generated SFX (Stable Audio via audio-studio-mcp) live in public/assets/sfx with a
// manifest { "<name>": ["file1.ogg", ...] }. Any name without samples uses the synth below.
const samples = new Map<string, { buffers: AudioBuffer[]; gain: number }>();
let sampleManifest: Record<string, { files: string[]; gain?: number }> | null = null;

export async function loadSamples(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/sfx/`;
  if (!sampleManifest) {
    try {
      const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
      sampleManifest = res.ok ? await res.json() : {};
    } catch {
      sampleManifest = {};
    }
  }
  if (!ctx) return;
  const ac = ctx;
  await Promise.all(
    Object.entries(sampleManifest ?? {}).map(async ([name, entry]) => {
      if (samples.has(name)) return;
      const buffers: AudioBuffer[] = [];
      for (const f of entry.files) {
        try {
          const data = await (await fetch(base + f)).arrayBuffer();
          buffers.push(await ac.decodeAudioData(data));
        } catch {
          /* skip broken file */
        }
      }
      if (buffers.length) samples.set(name, { buffers, gain: entry.gain ?? 1 });
    }),
  );
}

function playSample(name: string, volume: number): boolean {
  const s = samples.get(name);
  if (!s || !ctx || !master) return false;
  const src = ctx.createBufferSource();
  src.buffer = s.buffers[Math.floor(Math.random() * s.buffers.length)];
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const g = ctx.createGain();
  g.gain.value = volume * s.gain;
  src.connect(g).connect(master);
  src.start();
  return true;
}

export function sfx(name: SfxName, volume = 1): void {
  if (!enabled || !ctx) return;
  // Throttle very frequent sounds.
  const now = performance.now();
  const gap = name === 'hit' || name === 'arrow' || name === 'shot' ? 45 : name === 'death' ? 60 : 0;
  if (gap && now - (lastPlayed.get(name) ?? 0) < gap) return;
  lastPlayed.set(name, now);
  if (playSample(name, volume)) return;
  const v = volume;
  switch (name) {
    case 'click':
      tone(900, 0.05, 'triangle', 0.15 * v, 1300);
      break;
    case 'card':
      tone(500, 0.06, 'triangle', 0.12 * v, 800);
      break;
    case 'nope':
      tone(220, 0.12, 'square', 0.08 * v, 160);
      break;
    case 'deploy':
      noise(0.18, 0.35 * v, 500);
      tone(150, 0.18, 'sine', 0.35 * v, 60);
      break;
    case 'hit':
      noise(0.06, 0.22 * v, 2200, 'bandpass', 0, 2);
      tone(260 + Math.random() * 80, 0.05, 'square', 0.04 * v, 120);
      break;
    case 'heavy':
      noise(0.12, 0.35 * v, 900);
      tone(110, 0.15, 'sine', 0.3 * v, 50);
      break;
    case 'arrow':
      noise(0.08, 0.12 * v, 4000, 'highpass');
      tone(1200, 0.06, 'sine', 0.03 * v, 500);
      break;
    case 'shot':
      noise(0.1, 0.3 * v, 1800);
      tone(180, 0.08, 'square', 0.06 * v, 70);
      break;
    case 'fire':
      noise(0.3, 0.2 * v, 700, 'lowpass');
      tone(300, 0.25, 'sawtooth', 0.04 * v, 120);
      break;
    case 'boom':
      noise(0.6, 0.6 * v, 400);
      tone(90, 0.5, 'sine', 0.5 * v, 35);
      break;
    case 'zap':
      for (let i = 0; i < 4; i++) tone(1500 - i * 250, 0.07, 'square', 0.07 * v, 300, i * 0.03);
      noise(0.2, 0.25 * v, 3000, 'highpass');
      break;
    case 'freeze':
      for (let i = 0; i < 5; i++) tone(1800 + i * 300, 0.25, 'sine', 0.06 * v, 2600, i * 0.04);
      noise(0.4, 0.15 * v, 5000, 'highpass');
      break;
    case 'heal':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'sine', 0.09 * v, undefined, i * 0.07));
      break;
    case 'rage':
      tone(110, 0.4, 'sawtooth', 0.12 * v, 220);
      noise(0.3, 0.2 * v, 300, 'lowpass', 0.05);
      break;
    case 'tower':
      noise(1.2, 0.7 * v, 300);
      tone(70, 1, 'sine', 0.6 * v, 30);
      noise(0.5, 0.3 * v, 2000, 'bandpass', 0.15);
      break;
    case 'crown':
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'triangle', 0.12 * v, undefined, i * 0.09));
      break;
    case 'death':
      noise(0.15, 0.18 * v, 1200);
      tone(400, 0.15, 'triangle', 0.05 * v, 150);
      break;
    case 'power':
      tone(220, 0.5, 'sawtooth', 0.12 * v, 880);
      tone(330, 0.5, 'square', 0.06 * v, 1320, 0.05);
      noise(0.4, 0.2 * v, 1500, 'bandpass', 0.1);
      break;
    case 'win':
      [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 0.8 : 0.18, 'triangle', 0.16 * v, undefined, i * 0.13));
      break;
    case 'lose':
      [392, 370, 349, 262].forEach((f, i) => tone(f, i === 3 ? 0.9 : 0.3, 'triangle', 0.14 * v, undefined, i * 0.28));
      break;
    case 'tick':
      tone(1400, 0.04, 'square', 0.06 * v);
      break;
    case 'chest':
      noise(0.3, 0.4 * v, 600);
      tone(200, 0.25, 'square', 0.1 * v, 600);
      break;
    case 'reward':
      tone(880, 0.12, 'triangle', 0.12 * v, 1320);
      tone(1320, 0.18, 'sine', 0.08 * v, 1760, 0.06);
      break;
    case 'whoosh':
      noise(0.22, 0.16 * v, 900, 'bandpass', 0, 0.8);
      tone(300, 0.18, 'sine', 0.05 * v, 900);
      break;
    case 'charge':
      // Rising build-up before the upgrade burst.
      tone(160, 1.1, 'sawtooth', 0.05 * v, 900);
      tone(240, 1.1, 'triangle', 0.07 * v, 1350);
      noise(1.1, 0.12 * v, 2500, 'bandpass', 0, 2);
      break;
    case 'upgrade':
      noise(0.5, 0.35 * v, 3000, 'highpass');
      tone(90, 0.6, 'sine', 0.45 * v, 40);
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i === 4 ? 0.9 : 0.35, 'triangle', 0.13 * v, undefined, 0.05 + i * 0.06));
      [1568, 2093].forEach((f, i) => tone(f, 0.6, 'sine', 0.05 * v, undefined, 0.35 + i * 0.1));
      break;
    case 'stat':
      tone(1046, 0.08, 'triangle', 0.08 * v, 1568);
      break;
  }
}

// ---------------------------------------------------------------- music

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
/** A gentle generated march loop: bass + plucked melody, regenerated each bar. */
export function startMusic(intensity = 0): void {
  if (!ctx || !master || !musicOn) return;
  stopMusic();
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.12;
  musicGain.connect(master);
  const root = 196; // G3
  const prog = [0, 5, 3, 4];
  let bar = 0;
  const bpm = 112 + intensity * 24;
  const beat = 60 / bpm;
  const playBar = () => {
    if (!ctx || !musicGain) return;
    const t0 = ctx.currentTime + 0.05;
    const chord = prog[bar % prog.length];
    for (let i = 0; i < 4; i++) {
      // Bass.
      voice(root / 2 * Math.pow(2, SCALE[chord % SCALE.length] / 12), t0 + i * beat, beat * 0.9, 'triangle', 0.5);
    }
    for (let i = 0; i < 8; i++) {
      if (Math.random() < 0.35) continue;
      const deg = (chord + [0, 2, 4, 5][Math.floor(Math.random() * 4)]) % SCALE.length;
      voice(root * Math.pow(2, SCALE[deg] / 12) * (Math.random() < 0.3 ? 2 : 1), t0 + i * beat * 0.5, beat * 0.4, 'square', 0.18);
    }
    // Snare-ish on 2 and 4.
    for (const i of [1, 3]) drum(t0 + i * beat);
    bar++;
  };
  playBar();
  musicTimer = window.setInterval(playBar, beat * 4 * 1000);
}

function voice(freq: number, t: number, dur: number, type: OscillatorType, vol: number): void {
  if (!ctx || !musicGain) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(musicGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function drum(t: number): void {
  if (!ctx || !musicGain || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  src.connect(f).connect(g).connect(musicGain);
  src.start(t);
  src.stop(t + 0.15);
}

export function stopMusic(): void {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (musicGain && ctx) {
    const g = musicGain;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    setTimeout(() => g.disconnect(), 800);
  }
  musicGain = null;
}

export function vibrate(ms: number | number[]): void {
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    navigator.vibrate?.(ms);
  } catch {
    /* not supported (iOS) */
  }
}
