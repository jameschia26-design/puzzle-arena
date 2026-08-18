import type { BotDifficulty, Rng } from '@puzzle-arena/shared';

/**
 * A bot policy is a pure function of EXACTLY the restricted view a human in
 * that seat would receive. The runtime calls `engine.view(state, botPlayerId)`
 * and passes only the result — never the raw state.
 *
 * Each game's bot module must not import its own state type; it declares the
 * shape of the view it needs locally. That module boundary is the enforcement,
 * and bots.test.ts asserts the invariant at runtime as well.
 *
 * Randomness must come only from `rng`. The scheduler's think-delay must never
 * reach a policy, or replay stops being deterministic.
 */
export interface BotPolicy<V, A> {
  chooseAction(view: V, selfId: string, rng: Rng, difficulty: BotDifficulty): A;
}

/** Cash a bot keeps in hand rather than spending. */
export const RESERVE: Record<BotDifficulty, number> = {
  easy: 0,
  normal: 150,
  hard: 250,
};
