import * as React from 'react';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { cn } from './cn.js';
import { PixelButton } from './primitives.js';

/* ------------------------------------------------------------------ */
/* Web Audio Context & Synthesizer Engine                              */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let bgmGain: GainNode | null = null;

let sfxEnabled = true;
let musicEnabled = true; // Enabled by default so players hear the retro tunes
let masterVolume = 0.8; // High volume for phone speakers
let isUnlocked = false;

// Load settings from localStorage
if (typeof window !== 'undefined') {
  sfxEnabled = localStorage.getItem('pa:sound:sfx') !== 'false';
  musicEnabled = localStorage.getItem('pa:sound:music') !== 'false'; // default true
  const savedVol = localStorage.getItem('pa:sound:volume');
  if (savedVol) masterVolume = Math.max(0, Math.min(1, Number(savedVol)));
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);

    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxEnabled ? 1 : 0;
    sfxGain.connect(masterGain);

    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = musicEnabled ? 0.35 : 0;
    bgmGain.connect(masterGain);
  }

  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Mobile / Android / iOS Web Audio Unlocker:
 * Directly resumes context and plays a 1-sample buffer during touch gestures.
 */
export function unlockAudioSession(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  if (!isUnlocked) {
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      isUnlocked = true;
    } catch {
      // Ignore
    }
  }
}

// Global user touch & click listeners for immediate mobile unlocking
if (typeof window !== 'undefined') {
  const events = ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'];
  events.forEach((ev) => {
    window.addEventListener(ev, unlockAudioSession, { passive: true });
  });
}

/* ------------------------------------------------------------------ */
/* Retro 8-Bit / 16-Bit Sound Effects (SFX)                            */
/* ------------------------------------------------------------------ */

export const sfx = {
  /** Marble dropping into a pit (resonant wood / glass chime) */
  drop(pitchFactor = 1.0) {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    const baseFreq = 520 * pitchFactor;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.linearRampToValueAtTime(baseFreq * 1.4, t + 0.04);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.9, t + 0.12);

    gain.gain.setValueAtTime(0.6, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(t);
    osc.stop(t + 0.17);
  },

  /** Scooping up seeds / picking up marble */
  pickup() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(640, t + 0.09);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(t);
    osc.stop(t + 0.13);
  },

  /** Tembak capture explosion / reward blast */
  tembak() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;

    // Laser zap
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(960, t0);
    osc1.frequency.linearRampToValueAtTime(140, t0 + 0.2);

    gain1.gain.setValueAtTime(0.5, t0);
    gain1.gain.linearRampToValueAtTime(0.001, t0 + 0.22);
    osc1.connect(gain1);
    gain1.connect(sfxGain);
    osc1.start(t0);
    osc1.stop(t0 + 0.23);

    // Major reward chime chord (C5, E5, G5)
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + 0.06 * i;
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  },

  /** Landed in Storehouse -> Extra Turn chime */
  extraTurn() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.5, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  },

  /** Menu click / button blip */
  blip() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(659.25, t); // E5
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.07);
  },
  /** Bubble pop / tile reveal */
  pop() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.07);
  },

  /** Disc / chip placement click */
  chip() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.04);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.06);
  },

  /** Sudoku / puzzle pencil note scratch */
  pencil() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.04);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.06);
  },

  /** Nonogram cross / mark toggle */
  cross() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.linearRampToValueAtTime(250, t + 0.04);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.06);
  },

  /** Minesweeper flag placement */
  flag() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.linearRampToValueAtTime(1000, t + 0.06);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.09);
  },

  /** Minesweeper chord sweep / multi-clear */
  chord() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.035;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  },

  /** Clear cell whoosh */
  clear() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.08);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
  },

  /** Turn change / chord sweep chime */
  turn() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    [587.33, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.05;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.11);
    });
  },

  /** Explosion boom for mine detonation */
  bomb() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.45);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.46);
  },


  /** Correct entry / tile placement */
  correct() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    [659.25, 880.0].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.23);
    });
  },

  /** Wrong move / error buzz */
  wrong() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.linearRampToValueAtTime(80, t + 0.2);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.23);
  },

  /** Dice rolling rattle (Property Tycoon) */
  rollDice() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.05;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220 + Math.random() * 260, t);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.06);
    }
  },

  /** Victory fanfare (Triumphant 8-Bit) */
  victory() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const melody = [
      { f: 261.63, d: 0.12 },
      { f: 329.63, d: 0.12 },
      { f: 392.0, d: 0.12 },
      { f: 523.25, d: 0.25 },
      { f: 392.0, d: 0.12 },
      { f: 523.25, d: 0.5 },
    ];

    let t = ctx.currentTime + 0.01;
    melody.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(note.f, t);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.linearRampToValueAtTime(0.001, t + note.d);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + note.d + 0.02);

      t += note.d + 0.03;
    });
  },

  /** 3-2-1 Countdown tick & GO! */
  countdown(isGo = false) {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isGo ? 987.77 : 493.88, t); // B5 or B4

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.linearRampToValueAtTime(0.001, t + (isGo ? 0.35 : 0.16));

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + (isGo ? 0.36 : 0.17));
  },

  /** Checkers: a man is crowned king — a short triumphant chime. */
  crown() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    [392.0, 523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + i * 0.07;
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  },

  /** Aeroplane Chess: a plane released from the hangar onto the runway. */
  launch() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.18);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.21);
  },

  /** Big Two: a combo laid onto the table — a crisp card slide. */
  cardPlay() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(440, t + 0.08);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.11);
  },

  /** Card / tile deal sound */
  deal() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(780, t + 0.06);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.09);
  },

  /** Big Two: a bomb (four-of-a-kind or straight flush) hits the table. */
  cardBomb() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = 'sawtooth';
    low.frequency.setValueAtTime(120, t0);
    low.frequency.exponentialRampToValueAtTime(40, t0 + 0.3);
    lowGain.gain.setValueAtTime(0.55, t0);
    lowGain.gain.linearRampToValueAtTime(0.001, t0 + 0.32);
    low.connect(lowGain);
    lowGain.connect(sfxGain);
    low.start(t0);
    low.stop(t0 + 0.33);

    [659.25, 783.99, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + 0.04 * i;
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(t);
      osc.stop(t + 0.19);
    });
  },

  rotate() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const tt = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(620, tt); osc.frequency.linearRampToValueAtTime(780, tt + 0.04);
    gain.gain.setValueAtTime(0.25, tt); gain.gain.linearRampToValueAtTime(0.001, tt + 0.06);
    osc.connect(gain); gain.connect(sfxGain); osc.start(tt); osc.stop(tt + 0.07);
  },
  lineClear() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    [523.25, 659.25, 783.99].forEach((f, i) => { const osc = ctx.createOscillator(); const gain = ctx.createGain(); const tt = t0 + i*0.06; osc.type='triangle'; osc.frequency.setValueAtTime(f, tt); gain.gain.setValueAtTime(0.4, tt); gain.gain.linearRampToValueAtTime(0.001, tt+0.18); osc.connect(gain); gain.connect(sfxGain!); osc.start(tt); osc.stop(tt+0.19); });
  },
  tetrisClear() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    [523.25,659.25,783.99,1046.5,783.99,1046.5].forEach((f,i)=>{ const osc=ctx.createOscillator(); const gain=ctx.createGain(); const tt=t0+i*0.08; osc.type='square'; osc.frequency.setValueAtTime(f,tt); gain.gain.setValueAtTime(0.35,tt); gain.gain.linearRampToValueAtTime(0.001,tt+0.16); osc.connect(gain); gain.connect(sfxGain!); osc.start(tt); osc.stop(tt+0.17);});
  },
  levelUp() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const t0=ctx.currentTime+0.01; [392,523.25,659.25,783.99].forEach((f,i)=>{ const osc=ctx.createOscillator(); const gain=ctx.createGain(); const tt=t0+i*0.1; osc.type='triangle'; osc.frequency.setValueAtTime(f,tt); gain.gain.setValueAtTime(0.4,tt); gain.gain.linearRampToValueAtTime(0.001,tt+0.2); osc.connect(gain); gain.connect(sfxGain!); osc.start(tt); osc.stop(tt+0.21);});
  },
  hardDrop() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tt=ctx.currentTime+0.01; const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type='sine'; osc.frequency.setValueAtTime(120,tt); osc.frequency.exponentialRampToValueAtTime(50,tt+0.08); gain.gain.setValueAtTime(0.6,tt); gain.gain.linearRampToValueAtTime(0.001,tt+0.1); osc.connect(gain); gain.connect(sfxGain); osc.start(tt); osc.stop(tt+0.11);
  },
  pacWaka() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tm=ctx.currentTime+0.01; const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='square'; o.frequency.setValueAtTime(440,tm); o.frequency.linearRampToValueAtTime(880,tm+0.06); g.gain.setValueAtTime(0.28,tm); g.gain.linearRampToValueAtTime(0.001,tm+0.09); o.connect(g); g.connect(sfxGain!); o.start(tm); o.stop(tm+0.10);
  },
  pacPower() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tm=ctx.currentTime+0.01; [660,880,660,880].forEach((f,i)=>{ const o=ctx.createOscillator(); const g=ctx.createGain(); const tt=tm+i*0.11; o.type='square'; o.frequency.setValueAtTime(f,tt); g.gain.setValueAtTime(0.3,tt); g.gain.linearRampToValueAtTime(0.001,tt+0.10); o.connect(g); g.connect(sfxGain!); o.start(tt); o.stop(tt+0.11);});
  },
  pacEatGhost() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tm=ctx.currentTime+0.01; const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='square'; o.frequency.setValueAtTime(1200,tm); o.frequency.linearRampToValueAtTime(200,tm+0.28); g.gain.setValueAtTime(0.35,tm); g.gain.linearRampToValueAtTime(0.001,tm+0.30); o.connect(g); g.connect(sfxGain!); o.start(tm); o.stop(tm+0.32);
  },
  pacDeath() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tm=ctx.currentTime+0.01; [440,380,320,260,200,160,120].forEach((f,i)=>{ const o=ctx.createOscillator(); const g=ctx.createGain(); const tt=tm+i*0.12; o.type='sawtooth'; o.frequency.setValueAtTime(f,tt); g.gain.setValueAtTime(0.28,tt); g.gain.linearRampToValueAtTime(0.001,tt+0.11); o.connect(g); g.connect(sfxGain!); o.start(tt); o.stop(tt+0.12);});
  },
  pacSiren() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const tm=ctx.currentTime+0.01; const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(180,tm); o.frequency.linearRampToValueAtTime(360,tm+0.22); g.gain.setValueAtTime(0.12,tm); g.gain.linearRampToValueAtTime(0.001,tm+0.24); o.connect(g); g.connect(sfxGain!); o.start(tm); o.stop(tm+0.25);
  },
  gameOver() {
    const ctx=getAudioContext(); if(!ctx||!sfxEnabled||!sfxGain) return; if(ctx.state==='suspended') void ctx.resume(); const t0=ctx.currentTime+0.01; [220,180,140,110].forEach((f,i)=>{ const osc=ctx.createOscillator(); const gain=ctx.createGain(); const tt=t0+i*0.18; osc.type='sawtooth'; osc.frequency.setValueAtTime(f,tt); gain.gain.setValueAtTime(0.35,tt); gain.gain.linearRampToValueAtTime(0.001,tt+0.25); osc.connect(gain); gain.connect(sfxGain!); osc.start(tt); osc.stop(tt+0.26);});
  },
  invaderMarch(step: number) {
    const ctx = getAudioContext(); if (!ctx || !sfxEnabled || !sfxGain) return; if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const notes = [58.27, 55.0, 51.91, 49.0];
    const freq = notes[Math.abs(step) % 4] ?? 55;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
  },
  invaderLaser() {
    const ctx = getAudioContext(); if (!ctx || !sfxEnabled || !sfxGain) return; if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(990, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    gain.gain.setValueAtTime(0.38, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.14);
  },
  invaderExplosion() {
    const ctx = getAudioContext(); if (!ctx || !sfxEnabled || !sfxGain) return; if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    try {
      const bufferSize = Math.floor(ctx.sampleRate * 0.22);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.linearRampToValueAtTime(80, t + 0.2);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(sfxGain);
      noise.start(t);
      noise.stop(t + 0.22);
    } catch {
      // Fallback tone if noise buffer unsupported
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(40, t + 0.18);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.21);
    }
  },
  invaderUfo() {
    const ctx = getAudioContext(); if (!ctx || !sfxEnabled || !sfxGain) return; if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.linearRampToValueAtTime(540, t + 0.1);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.13);
  },
};

/* ------------------------------------------------------------------ */
/* Retro Chiptune / MIDI Background Music Generator (BGM)             */
/* ------------------------------------------------------------------ */

export type MusicTrack =
  | 'congkak'
  | 'puzzle'
  | 'board'
  | 'title'
  | 'checkers'
  | 'bigtwo'
  | 'chess'
  | 'xiangqi'
  | 'animalchess'
  | 'property'
  | 'mystery'
  | 'arcade'
  | 'zen'
  | 'tetris'
  | 'pacman';
interface NoteEvent {
  note: number;
  duration: number;
}

const m2f = (m: number): number => (m > 0 ? 440 * Math.pow(2, (m - 69) / 12) : 0);

const TRACK_SEQUENCES: Record<MusicTrack, { tempo: number; lead: NoteEvent[]; bass: NoteEvent[] }> = {
  congkak: {
    tempo: 128,
    lead: [
      { note: 60, duration: 2 }, { note: 62, duration: 2 }, { note: 64, duration: 2 }, { note: 67, duration: 2 },
      { note: 69, duration: 4 }, { note: 67, duration: 2 }, { note: 64, duration: 2 },
      { note: 67, duration: 2 }, { note: 64, duration: 2 }, { note: 62, duration: 2 }, { note: 60, duration: 2 },
      { note: 62, duration: 4 }, { note: 64, duration: 2 }, { note: 60, duration: 2 },
      { note: 67, duration: 2 }, { note: 69, duration: 2 }, { note: 72, duration: 4 },
      { note: 69, duration: 2 }, { note: 67, duration: 2 }, { note: 64, duration: 4 },
      { note: 62, duration: 2 }, { note: 64, duration: 2 }, { note: 67, duration: 2 }, { note: 62, duration: 2 },
      { note: 60, duration: 6 }, { note: 0, duration: 2 },
    ],
    bass: [
      { note: 36, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
      { note: 38, duration: 4 }, { note: 45, duration: 4 }, { note: 38, duration: 4 }, { note: 45, duration: 4 },
      { note: 41, duration: 4 }, { note: 48, duration: 4 }, { note: 41, duration: 4 }, { note: 48, duration: 4 },
      { note: 36, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
    ],
  },

  puzzle: {
    tempo: 104,
    lead: [
      { note: 65, duration: 4 }, { note: 67, duration: 4 }, { note: 69, duration: 4 }, { note: 72, duration: 4 },
      { note: 71, duration: 6 }, { note: 67, duration: 2 }, { note: 64, duration: 8 },
      { note: 62, duration: 4 }, { note: 65, duration: 4 }, { note: 67, duration: 4 }, { note: 69, duration: 4 },
      { note: 67, duration: 8 }, { note: 60, duration: 8 },
    ],
    bass: [
      { note: 41, duration: 8 }, { note: 45, duration: 8 },
      { note: 40, duration: 8 }, { note: 43, duration: 8 },
      { note: 38, duration: 8 }, { note: 41, duration: 8 },
      { note: 36, duration: 8 }, { note: 43, duration: 8 },
    ],
  },

  board: {
    tempo: 132,
    lead: [
      { note: 60, duration: 2 }, { note: 64, duration: 2 }, { note: 67, duration: 2 }, { note: 71, duration: 2 },
      { note: 72, duration: 3 }, { note: 71, duration: 1 }, { note: 67, duration: 4 },
      { note: 65, duration: 2 }, { note: 69, duration: 2 }, { note: 72, duration: 2 }, { note: 76, duration: 2 },
      { note: 74, duration: 4 }, { note: 67, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 2 }, { note: 43, duration: 2 }, { note: 36, duration: 2 }, { note: 43, duration: 2 },
      { note: 38, duration: 2 }, { note: 45, duration: 2 }, { note: 38, duration: 2 }, { note: 45, duration: 2 },
      { note: 41, duration: 2 }, { note: 48, duration: 2 }, { note: 41, duration: 2 }, { note: 48, duration: 2 },
      { note: 43, duration: 2 }, { note: 50, duration: 2 }, { note: 43, duration: 2 }, { note: 50, duration: 2 },
    ],
  },

  title: {
    tempo: 136,
    lead: [
      { note: 60, duration: 2 }, { note: 60, duration: 2 }, { note: 67, duration: 4 },
      { note: 65, duration: 2 }, { note: 64, duration: 2 }, { note: 62, duration: 4 },
      { note: 64, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 4 },
      { note: 69, duration: 4 }, { note: 72, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 4 }, { note: 40, duration: 4 }, { note: 43, duration: 4 }, { note: 40, duration: 4 },
      { note: 38, duration: 4 }, { note: 41, duration: 4 }, { note: 45, duration: 4 }, { note: 41, duration: 4 },
    ],
  },

  checkers: {
    tempo: 92,
    lead: [
      { note: 57, duration: 4 }, { note: 60, duration: 4 }, { note: 64, duration: 4 }, { note: 67, duration: 2 },
      { note: 65, duration: 2 }, { note: 64, duration: 4 }, { note: 62, duration: 4 }, { note: 60, duration: 8 },
      { note: 57, duration: 4 }, { note: 59, duration: 4 }, { note: 60, duration: 4 }, { note: 62, duration: 2 },
      { note: 64, duration: 2 }, { note: 62, duration: 8 },
    ],
    bass: [
      { note: 45, duration: 8 }, { note: 43, duration: 8 },
      { note: 41, duration: 8 }, { note: 45, duration: 8 },
    ],
  },
  bigtwo: {
    tempo: 100,
    lead: [
      { note: 62, duration: 3 }, { note: 65, duration: 1 }, { note: 69, duration: 2 }, { note: 67, duration: 2 },
      { note: 64, duration: 4 }, { note: 62, duration: 3 }, { note: 65, duration: 1 }, { note: 67, duration: 2 },
      { note: 64, duration: 2 }, { note: 60, duration: 4 }, { note: 62, duration: 3 }, { note: 65, duration: 1 },
      { note: 69, duration: 2 }, { note: 72, duration: 2 }, { note: 69, duration: 4 }, { note: 65, duration: 6 },
      { note: 0, duration: 2 },
    ],
    bass: [
      { note: 38, duration: 4 }, { note: 43, duration: 4 }, { note: 41, duration: 4 }, { note: 45, duration: 4 },
      { note: 38, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
    ],
  },
  chess: {
    tempo: 84,
    lead: [
      { note: 55, duration: 4 }, { note: 59, duration: 4 }, { note: 62, duration: 4 }, { note: 66, duration: 4 },
      { note: 67, duration: 6 }, { note: 66, duration: 2 }, { note: 62, duration: 8 },
      { note: 60, duration: 4 }, { note: 64, duration: 4 }, { note: 67, duration: 4 }, { note: 71, duration: 4 },
      { note: 69, duration: 8 }, { note: 62, duration: 8 },
    ],
    bass: [
      { note: 43, duration: 8 }, { note: 47, duration: 8 },
      { note: 41, duration: 8 }, { note: 45, duration: 8 },
      { note: 40, duration: 8 }, { note: 47, duration: 8 },
      { note: 38, duration: 8 }, { note: 45, duration: 8 },
    ],
  },
  xiangqi: {
    // Pentatonic (C D E G A), evoking a guzheng/gong feel within the
    // engine's plain-oscillator synthesis.
    tempo: 96,
    lead: [
      { note: 60, duration: 3 }, { note: 62, duration: 1 }, { note: 64, duration: 4 }, { note: 67, duration: 4 },
      { note: 69, duration: 4 }, { note: 67, duration: 2 }, { note: 64, duration: 2 }, { note: 62, duration: 4 },
      { note: 60, duration: 3 }, { note: 62, duration: 1 }, { note: 64, duration: 4 }, { note: 69, duration: 4 },
      { note: 72, duration: 6 }, { note: 69, duration: 2 }, { note: 64, duration: 8 },
    ],
    bass: [
      { note: 36, duration: 8 }, { note: 43, duration: 8 },
      { note: 38, duration: 8 }, { note: 45, duration: 8 },
      { note: 36, duration: 8 }, { note: 40, duration: 8 },
      { note: 33, duration: 8 }, { note: 40, duration: 8 },
    ],
  },
  animalchess: {
    // Upbeat, adventurous jungle safari pentatonic bounce
    tempo: 116,
    lead: [
      { note: 62, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 4 }, { note: 65, duration: 2 }, { note: 62, duration: 2 }, { note: 60, duration: 4 },
      { note: 62, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 2 }, { note: 70, duration: 2 }, { note: 72, duration: 4 }, { note: 70, duration: 4 },
      { note: 67, duration: 3 }, { note: 65, duration: 1 }, { note: 62, duration: 4 }, { note: 60, duration: 2 }, { note: 62, duration: 2 }, { note: 65, duration: 4 },
    ],
    bass: [
      { note: 38, duration: 4 }, { note: 45, duration: 4 }, { note: 38, duration: 4 }, { note: 41, duration: 4 },
      { note: 38, duration: 4 }, { note: 45, duration: 4 }, { note: 43, duration: 4 }, { note: 46, duration: 4 },
      { note: 43, duration: 4 }, { note: 41, duration: 4 }, { note: 38, duration: 4 }, { note: 45, duration: 4 },
    ],
  },
  property: {
    // Jaunty, syncopated ragtime capitalist groove
    tempo: 124,
    lead: [
      { note: 60, duration: 2 }, { note: 64, duration: 2 }, { note: 67, duration: 2 }, { note: 69, duration: 2 }, { note: 67, duration: 4 }, { note: 64, duration: 4 },
      { note: 65, duration: 2 }, { note: 69, duration: 2 }, { note: 72, duration: 3 }, { note: 71, duration: 1 }, { note: 69, duration: 4 }, { note: 67, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 4 }, { note: 40, duration: 4 }, { note: 43, duration: 4 }, { note: 45, duration: 4 },
      { note: 41, duration: 4 }, { note: 45, duration: 4 }, { note: 43, duration: 4 }, { note: 47, duration: 4 },
    ],
  },
  mystery: {
    // Suspenseful, minor-key detective investigation noir
    tempo: 80,
    lead: [
      { note: 57, duration: 4 }, { note: 60, duration: 4 }, { note: 63, duration: 4 }, { note: 64, duration: 4 },
      { note: 65, duration: 6 }, { note: 64, duration: 2 }, { note: 60, duration: 4 }, { note: 59, duration: 4 },
      { note: 57, duration: 4 }, { note: 60, duration: 4 }, { note: 64, duration: 4 }, { note: 57, duration: 4 },
    ],
    bass: [
      { note: 45, duration: 8 }, { note: 48, duration: 8 },
      { note: 50, duration: 8 }, { note: 47, duration: 8 },
      { note: 45, duration: 8 }, { note: 41, duration: 8 },
    ],
  },
  arcade: {
    // High-energy 80s arcade action arpeggios
    tempo: 144,
    lead: [
      { note: 60, duration: 2 }, { note: 67, duration: 2 }, { note: 63, duration: 2 }, { note: 67, duration: 2 }, { note: 65, duration: 2 }, { note: 70, duration: 2 }, { note: 67, duration: 4 },
      { note: 72, duration: 2 }, { note: 67, duration: 2 }, { note: 70, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 4 }, { note: 63, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 2 }, { note: 36, duration: 2 }, { note: 48, duration: 2 }, { note: 36, duration: 2 }, { note: 41, duration: 2 }, { note: 41, duration: 2 }, { note: 48, duration: 4 },
      { note: 43, duration: 2 }, { note: 43, duration: 2 }, { note: 41, duration: 2 }, { note: 41, duration: 2 }, { note: 36, duration: 4 }, { note: 48, duration: 4 },
    ],
  },
  zen: {
    // Relaxing, calming ambient lo-fi melody for focused puzzles
    tempo: 76,
    lead: [
      { note: 64, duration: 4 }, { note: 67, duration: 4 }, { note: 71, duration: 4 }, { note: 74, duration: 4 },
      { note: 72, duration: 8 }, { note: 69, duration: 8 },
      { note: 67, duration: 4 }, { note: 71, duration: 4 }, { note: 69, duration: 4 }, { note: 64, duration: 4 },
      { note: 62, duration: 8 }, { note: 64, duration: 8 },
    ],
    bass: [
      { note: 40, duration: 8 }, { note: 47, duration: 8 },
      { note: 45, duration: 8 }, { note: 41, duration: 8 },
      { note: 43, duration: 8 }, { note: 40, duration: 8 },
      { note: 38, duration: 8 }, { note: 40, duration: 8 },
    ],
  },
  pacman: {
    // Intro + siren blend, Namco-inspired but original composition, 138 BPM
    tempo: 138,
    lead: [
      { note: 60, duration: 2 }, { note: 62, duration: 2 }, { note: 64, duration: 2 }, { note: 65, duration: 2 },
      { note: 67, duration: 4 }, { note: 65, duration: 2 }, { note: 64, duration: 2 },
      { note: 62, duration: 2 }, { note: 64, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 2 },
      { note: 64, duration: 4 }, { note: 60, duration: 4 },
      { note: 60, duration: 2 }, { note: 62, duration: 2 }, { note: 64, duration: 2 }, { note: 65, duration: 2 },
      { note: 67, duration: 3 }, { note: 69, duration: 1 }, { note: 67, duration: 4 }, { note: 65, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
      { note: 38, duration: 4 }, { note: 45, duration: 4 }, { note: 38, duration: 4 }, { note: 45, duration: 4 },
      { note: 41, duration: 4 }, { note: 48, duration: 4 }, { note: 41, duration: 4 }, { note: 48, duration: 4 },
      { note: 36, duration: 4 }, { note: 40, duration: 4 }, { note: 43, duration: 4 }, { note: 40, duration: 4 },
    ],
  },
  tetris: {
    // Korobeiniki-inspired, Web Audio synthesized (no sample, CC0). 8-bit arps at 144 BPM.
    tempo: 144,
    lead: [
      { note: 64, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 2 }, { note: 72, duration: 2 }, { note: 69, duration: 2 }, { note: 67, duration: 2 }, { note: 65, duration: 2 },
      { note: 72, duration: 2 }, { note: 65, duration: 2 }, { note: 67, duration: 2 }, { note: 69, duration: 2 }, { note: 67, duration: 2 }, { note: 65, duration: 2 }, { note: 64, duration: 2 },
      { note: 64, duration: 2 }, { note: 67, duration: 2 }, { note: 72, duration: 2 }, { note: 69, duration: 2 }, { note: 67, duration: 2 }, { note: 65, duration: 2 },
      { note: 69, duration: 2 }, { note: 65, duration: 2 }, { note: 64, duration: 2 }, { note: 62, duration: 4 }, { note: 60, duration: 4 },
    ],
    bass: [
      { note: 36, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
      { note: 38, duration: 4 }, { note: 45, duration: 4 }, { note: 40, duration: 4 }, { note: 45, duration: 4 },
      { note: 36, duration: 4 }, { note: 43, duration: 4 }, { note: 36, duration: 4 }, { note: 43, duration: 4 },
      { note: 33, duration: 4 }, { note: 40, duration: 4 }, { note: 33, duration: 4 }, { note: 40, duration: 4 },
    ],
  },
};
let currentBgmTrack: MusicTrack | null = null;
let bgmLoopTimer: NodeJS.Timeout | null = null;
let activeBgmVoices: { osc: OscillatorNode; gain: GainNode }[] = [];

function scheduleVoice(
  ctx: AudioContext,
  notes: NoteEvent[],
  tempo: number,
  startTime: number,
  type: OscillatorType,
  volume: number,
) {
  if (!bgmGain) return;
  const sixteenthSec = (60 / tempo) / 4;
  let t = startTime;

  notes.forEach((ev) => {
    const durSec = ev.duration * sixteenthSec;
    if (ev.note > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(m2f(ev.note), t);

      gain.gain.setValueAtTime(volume, t);
      gain.gain.linearRampToValueAtTime(0.001, t + durSec * 0.95);

      osc.connect(gain);
      gain.connect(bgmGain!);

      osc.start(t);
      osc.stop(t + durSec);
      activeBgmVoices.push({ osc, gain });
      osc.addEventListener('ended', () => {
        activeBgmVoices = activeBgmVoices.filter((voice) => voice.osc !== osc);
      });

    }
    t += durSec;
  });
}

function playTrackLoop(trackName: MusicTrack) {
  if (!musicEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const track = TRACK_SEQUENCES[trackName] ?? TRACK_SEQUENCES.title;
  const sixteenthSec = (60 / track.tempo) / 4;
  const totalSteps = track.lead.reduce((sum, n) => sum + n.duration, 0);
  const loopDurationSec = totalSteps * sixteenthSec;

  const now = ctx.currentTime + 0.05;

  // Voice 1: Melodic Pulse/Square lead
  scheduleVoice(ctx, track.lead, track.tempo, now, 'square', 0.2);
  // Voice 2: Warm Triangle Bassline
  scheduleVoice(ctx, track.bass, track.tempo, now, 'triangle', 0.35);

  bgmLoopTimer = setTimeout(() => {
    if (musicEnabled && currentBgmTrack === trackName) {
      playTrackLoop(trackName);
    }
  }, loopDurationSec * 1000);
}

export const bgm = {
  play(trackName: MusicTrack) {
    if (currentBgmTrack === trackName && bgmLoopTimer) return;
    this.stop();
    currentBgmTrack = trackName;
    if (musicEnabled) {
      playTrackLoop(trackName);
    }
  },

  stop() {
    if (bgmLoopTimer) {
      clearTimeout(bgmLoopTimer);
      bgmLoopTimer = null;
    }
    const ctx = audioCtx;
    if (ctx) {
      const now = ctx.currentTime;
      for (const { osc, gain } of activeBgmVoices) {
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.03);
          osc.stop(now + 0.04);
        } catch {
          // Oscillator may have already stopped naturally (its own scheduled stop
          // time already passed) — calling .stop() on an already-stopped node throws.
        }
      }
    }
    activeBgmVoices = [];
  },

  setMusicEnabled(enabled: boolean) {
    musicEnabled = enabled;
    localStorage.setItem('pa:sound:music', String(enabled));
    if (bgmGain && audioCtx) {
      bgmGain.gain.value = enabled ? 0.35 : 0;
    }
    if (enabled && currentBgmTrack) {
      playTrackLoop(currentBgmTrack);
    } else {
      this.stop();
    }
  },

  setSfxEnabled(enabled: boolean) {
    sfxEnabled = enabled;
    localStorage.setItem('pa:sound:sfx', String(enabled));
    if (sfxGain && audioCtx) {
      sfxGain.gain.value = enabled ? 1 : 0;
    }
  },

  isMusicEnabled(): boolean {
    return musicEnabled;
  },

  isSfxEnabled(): boolean {
    return sfxEnabled;
  },
};

/* ------------------------------------------------------------------ */
/* React Sound Hook & UI Controls                                      */
/* ------------------------------------------------------------------ */

export function useAudioSettings() {
  const [music, setMusic] = React.useState(() => bgm.isMusicEnabled());
  const [sound, setSound] = React.useState(() => bgm.isSfxEnabled());

  const toggleMusic = React.useCallback(() => {
    unlockAudioSession();
    const next = !bgm.isMusicEnabled();
    bgm.setMusicEnabled(next);
    setMusic(next);
    if (next) sfx.blip();
  }, []);

  const toggleSfx = React.useCallback(() => {
    unlockAudioSession();
    const next = !bgm.isSfxEnabled();
    bgm.setSfxEnabled(next);
    setSound(next);
    if (next) sfx.blip();
  }, []);

  return { music, sound, toggleMusic, toggleSfx };
}

/** Header Audio Control Button with Quick Toggle */
export function SoundControlButtons({ className }: { className?: string }): React.ReactElement {
  const { music, sound, toggleMusic, toggleSfx } = useAudioSettings();

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <PixelButton
        variant="ghost"
        size="sm"
        onClick={toggleMusic}
        aria-label={music ? 'Mute Music' : 'Enable Music'}
        className={cn(
          'p-2 min-h-[40px] min-w-[40px] grid place-items-center cursor-pointer',
          music ? 'text-pa-cyan' : 'text-pa-ink-dim opacity-60',
        )}
      >
        <Music size={15} strokeWidth={2.5} className="lucide" />
      </PixelButton>

      <PixelButton
        variant="ghost"
        size="sm"
        onClick={toggleSfx}
        aria-label={sound ? 'Mute Sound Effects' : 'Enable Sound Effects'}
        className={cn(
          'p-2 min-h-[40px] min-w-[40px] grid place-items-center cursor-pointer',
          sound ? 'text-pa-amber' : 'text-pa-ink-dim opacity-60',
        )}
      >
        {sound ? (
          <Volume2 size={15} strokeWidth={2.5} className="lucide" />
        ) : (
          <VolumeX size={15} strokeWidth={2.5} className="lucide" />
        )}
      </PixelButton>
    </div>
  );
}
