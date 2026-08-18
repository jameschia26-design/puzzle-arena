import { useReducedMotion as useFramerReducedMotion } from 'framer-motion';

/**
 * Motion is stepped, not smooth. No component hardcodes a duration — they all
 * read these, so the whole app moves on the same beat.
 */
export const STEP_MS = 90; // one board square
export const DICE_FRAME_MS = 60; // one die face swap
export const SNAP_MS = 80; // panel / modal scale snap
export const COUNTDOWN_DIGIT_MS = 600; // 3 - 2 - 1 - GO
export const ROW_REORDER_MS = 90;
export const RESULT_ROW_MS = 60;
export const PODIUM_STEP_MS = 200;

/** One guard, used everywhere, rather than media queries scattered about. */
export function useReducedMotion(): boolean {
  return useFramerReducedMotion() ?? false;
}

/** Linear tween — easing curves are what make motion feel modern, not retro. */
export const stepTransition = (durationMs: number) => ({
  type: 'tween' as const,
  ease: 'linear' as const,
  duration: durationMs / 1000,
});

/** The 2-frame scale snap used by every panel and modal. */
export const snapIn = (reduced: boolean) =>
  reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { scale: 0.96 },
        animate: { scale: 1 },
        transition: stepTransition(SNAP_MS),
      };
