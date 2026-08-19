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
let musicEnabled = false;
let masterVolume = 0.6;
let isUnlocked = false;

// Load settings from localStorage
if (typeof window !== 'undefined') {
  sfxEnabled = localStorage.getItem('pa:sound:sfx') !== 'false';
  musicEnabled = localStorage.getItem('pa:sound:music') === 'true';
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
    masterGain.gain.setValueAtTime(masterVolume, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    sfxGain = audioCtx.createGain();
    sfxGain.gain.setValueAtTime(sfxEnabled ? 1 : 0, audioCtx.currentTime);
    sfxGain.connect(masterGain);

    bgmGain = audioCtx.createGain();
    bgmGain.gain.setValueAtTime(musicEnabled ? 0.35 : 0, audioCtx.currentTime);
    bgmGain.connect(masterGain);
  }

  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Robust Mobile / iOS Web Audio Unlocker:
 * Plays a tiny 1-sample silent buffer during an active touch/click gesture
 * to warm up the mobile hardware audio session.
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
  /** Marble dropping into a pit (wooden / glass clink tone) */
  drop(pitchFactor = 1.0) {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    const baseFreq = 420 * pitchFactor;
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, ctx.currentTime + 0.04);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, ctx.currentTime + 0.09);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
  },

  /** Scooping up seeds / picking up marble */
  pickup() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.11);
  },

  /** Tembak capture explosion / reward blast */
  tembak() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    // Laser zap
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(800, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.2);

    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc1.connect(gain1);
    gain1.connect(sfxGain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.23);

    // Major reward chime chord (C5, E5, G5)
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + 0.05 * i);

      gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.05 * i);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05 * i + 0.25);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(ctx.currentTime + 0.05 * i);
      osc.stop(ctx.currentTime + 0.05 * i + 0.26);
    });
  },

  /** Landed in Storehouse -> Extra Turn chime */
  extraTurn() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.07);

      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.18);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(ctx.currentTime + i * 0.07);
      osc.stop(ctx.currentTime + i * 0.07 + 0.2);
    });
  },

  /** Menu click / button blip */
  blip() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  },

  /** Correct entry / tile placement */
  correct() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    [659.25, 880.0].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);

      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.2);

      osc.connect(gain);
      gain.connect(sfxGain!);
      osc.start(ctx.currentTime + i * 0.08);
      osc.stop(ctx.currentTime + i * 0.08 + 0.21);
    });
  },

  /** Wrong move / error buzz */
  wrong() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.21);
  },

  /** Dice rolling rattle (Property Tycoon) */
  rollDice() {
    const ctx = getAudioContext();
    if (!ctx || !sfxEnabled || !sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180 + Math.random() * 200, ctx.currentTime + i * 0.05);

      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.04);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(ctx.currentTime + i * 0.05);
      osc.stop(ctx.currentTime + i * 0.05 + 0.05);
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

    let t = ctx.currentTime;
    melody.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(note.f, t);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.d);

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

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, ctx.currentTime);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isGo ? 0.35 : 0.15));

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (isGo ? 0.36 : 0.16));
  },
};

/* ------------------------------------------------------------------ */
/* Retro Chiptune / MIDI Background Music Generator (BGM)             */
/* ------------------------------------------------------------------ */

export type MusicTrack = 'congkak' | 'puzzle' | 'board' | 'title';

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
};

let currentBgmTrack: MusicTrack | null = null;
let bgmLoopTimer: NodeJS.Timeout | null = null;

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
      gain.gain.exponentialRampToValueAtTime(0.001, t + durSec * 0.95);

      osc.connect(gain);
      gain.connect(bgmGain!);

      osc.start(t);
      osc.stop(t + durSec);
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

  scheduleVoice(ctx, track.lead, track.tempo, now, 'square', 0.12);
  scheduleVoice(ctx, track.bass, track.tempo, now, 'triangle', 0.25);

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
    if (bgmLoopTimer) clearTimeout(bgmLoopTimer);
    bgmLoopTimer = null;
  },

  setMusicEnabled(enabled: boolean) {
    musicEnabled = enabled;
    localStorage.setItem('pa:sound:music', String(enabled));
    if (bgmGain && audioCtx) {
      bgmGain.gain.setValueAtTime(enabled ? 0.35 : 0, audioCtx.currentTime);
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
      sfxGain.gain.setValueAtTime(enabled ? 1 : 0, audioCtx.currentTime);
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
          music ? 'text-pa-cyan' : 'text-pa-ink-dim',
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
          sound ? 'text-pa-amber' : 'text-pa-ink-dim',
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
