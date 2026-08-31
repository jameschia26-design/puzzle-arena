import { useEffect, useRef } from 'react';
import { bgm, sfx } from './sound.js';
import type { PacManView } from '@puzzle-arena/games';

/**
 * Lazy mute-respecting Pac-Man audio hook.
 * - Starts/restarts BGM on mount, stops on unmount.
 * - Emits waka/power/eat/death SFX on score/life transitions via view diff.
 * WebAudio context is created lazily on first user gesture; calls no-op until unlocked.
 */
export function usePacmanAudio(view: PacManView | null): void {
  const prevScore = useRef<number>(0);
  const prevLives = useRef<number>(3);
  const prevFruit = useRef<string | null>(null);

  useEffect(() => {
    bgm.play('pacman' as never);
    return () => bgm.stop();
  }, []);

  useEffect(() => {
    if (!view?.you) return;
    const you = view.you;
    if (you.score > prevScore.current) {
      const delta = you.score - prevScore.current;
      if (delta >= 200 && delta % 200 === 0) sfx.pacEatGhost();
      else if (delta === 50) sfx.pacPower();
      else if (delta === 10) sfx.pacWaka();
    }
    if (you.lives < prevLives.current) sfx.pacDeath();
    if (you.fruit && you.fruit.kind !== prevFruit.current) sfx.pacPower();
    prevScore.current = you.score;
    prevLives.current = you.lives;
    prevFruit.current = you.fruit?.kind ?? null;
  }, [view?.you?.score, view?.you?.lives, view?.you?.fruit?.kind, view]);
}
