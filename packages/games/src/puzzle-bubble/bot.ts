import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

export interface PuzzleBubbleBotView {
  you: {
    board: { row: number; col: number; color: string }[];
    rowParity: 0 | 1;
    current: string;
    next: string;
    gameOver: boolean;
  } | null;
  players: unknown[];
  config: unknown;
}

export type PuzzleBubbleBotAction = { type: 'shoot'; angleDeg: number };

export const puzzleBubbleBot: BotPolicy<PuzzleBubbleBotView, PuzzleBubbleBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you || you.gameOver) return { type: 'shoot', angleDeg: 0 };

    const targets = you.board.filter((cell) => cell.color === you.current);
    if (targets.length === 0) return { type: 'shoot', angleDeg: 0 };
    const target = [...targets].sort((a, b) => a.row - b.row || a.col - b.col)[0]!;
    const longRow = (target.row + you.rowParity) % 2 === 0;
    const targetX = longRow ? target.col * 2 : target.col * 2 + 1;
    const angle = Math.round(Math.atan2(targetX - 7, Math.max(1, target.row + 2)) * (180 / Math.PI));
    const error = difficulty === 'easy' ? rng.int(31) - 15 : difficulty === 'normal' ? rng.int(11) - 5 : rng.int(3) - 1;
    return { type: 'shoot', angleDeg: Math.max(-80, Math.min(80, angle + error)) };
  },
};
