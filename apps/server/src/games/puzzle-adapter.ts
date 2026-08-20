import {
  killerSudoku,
  minesweeper,
  nonogram,
  sudoku,
  wordSearch,
  solvePath,
  cageConstraint,
  getWordsForTheme,
  type Grid,
} from '@puzzle-arena/puzzles';
import type { Difficulty, GameId, Rng } from '@puzzle-arena/shared';

/**
 * One uniform interface over the four puzzle games, so the room runtime never
 * branches on game id beyond this file.
 *
 * `solution` is deliberately kept out of every public-facing shape here; the
 * runtime holds it and only reveals it once the room has ended.
 */

export interface PuzzleGrade {
  progress: number;
  accuracy: number;
  complete: boolean;
  /** What the leaderboard shows while instant feedback is off. */
  filledFraction: number;
}

export interface GeneratedPuzzle {
  puzzle: unknown;
  solution: unknown;
  meta: { actualDifficulty: Difficulty; generationMs: number; seed: number; title?: string };
  /** Blank player state for a joining player. */
  initialState: unknown;
  /** The order a simulated solver would fill cells — drives puzzle bots. */
  solveOrder: (number | string)[];
}

export async function generatePuzzle(
  gameId: GameId,
  seed: number,
  config: Record<string, unknown>,
): Promise<GeneratedPuzzle> {
  const difficulty = (config['difficulty'] as Difficulty) ?? 'medium';

  switch (gameId) {
    case 'sudoku': {
      const { puzzle, solution, meta } = sudoku.generate({ difficulty, seed });
      return {
        puzzle,
        solution,
        meta,
        initialState: [...puzzle.givens],
        solveOrder: solvePath(puzzle.givens),
      };
    }
    case 'killer-sudoku': {
      const { puzzle, solution, meta } = killerSudoku.generate({ difficulty, seed });
      const constraint = cageConstraint(
        puzzle.cages.map((c) => ({ cells: c.cells, sum: c.sum })),
      );
      return {
        puzzle,
        solution,
        meta,
        initialState: [...puzzle.givens],
        solveOrder: solvePath(puzzle.givens as Grid, constraint),
      };
    }
    case 'nonogram': {
      const size = (config['size'] as 10 | 15 | 20) ?? 10;
      const { puzzle, solution, meta } = nonogram.generate({ difficulty, seed, size });
      // A plausible solve order: filled cells first, row by row.
      const order: number[] = [];
      for (let i = 0; i < solution.length; i++) if (solution[i]) order.push(i);
      return {
        puzzle,
        solution,
        meta,
        initialState: new Array<number>(size * size).fill(0),
        solveOrder: order,
      };
    }
    case 'word-search': {
      const theme = (config['theme'] as string) ?? 'Space';
      const size = (config['size'] as number) ?? 14;
      const words = getWordsForTheme(theme);
      const { puzzle, solution, meta } = wordSearch.generate({
        difficulty,
        seed,
        size,
        words,
        theme,
      });
      return {
        puzzle,
        solution,
        meta,
        initialState: { found: [], selections: 0 },
        // Bots find long words first — that is what a person does too.
        solveOrder: [...solution.placements]
          .sort((a, b) => b.word.length - a.word.length)
          .map((p) => p.word),
      };
    }
    case 'minesweeper': {
      const { puzzle, solution, meta } = minesweeper.generate({ difficulty, seed });
      return {
        puzzle,
        solution,
        meta,
        initialState: {
          revealed: new Array<boolean>(puzzle.rows * puzzle.cols).fill(false),
          detonated: false,
          detonatedCell: null,
          moves: 0,
        },
        solveOrder: minesweeper.solveOrder(puzzle, solution),
      };
    }
    default:
      throw new Error(`${gameId} is not a puzzle`);
  }
}

export function gradePuzzle(
  gameId: GameId,
  playerState: unknown,
  puzzle: unknown,
  solution: unknown,
): PuzzleGrade {
  switch (gameId) {
    case 'sudoku':
    case 'killer-sudoku': {
      const g =
        gameId === 'sudoku'
          ? sudoku.grade(playerState, solution as Grid, puzzle as { givens: Grid })
          : killerSudoku.grade(
              playerState,
              solution as Grid,
              puzzle as { cages: never[]; givens: Grid },
            );
      return {
        progress: g.cellsTotal > 0 ? g.cellsCorrect / g.cellsTotal : 0,
        accuracy: g.cellsFilled > 0 ? g.cellsCorrect / g.cellsFilled : 1,
        complete: g.complete,
        filledFraction: g.cellsTotal > 0 ? g.cellsFilled / g.cellsTotal : 0,
      };
    }
    case 'nonogram': {
      const g = nonogram.grade(playerState, solution as boolean[]);
      return {
        progress: g.cellsTotal > 0 ? g.cellsCorrect / g.cellsTotal : 0,
        accuracy: g.cellsFilled > 0 ? g.cellsCorrect / g.cellsFilled : 1,
        complete: g.complete,
        filledFraction: g.cellsTotal > 0 ? Math.min(1, g.cellsFilled / g.cellsTotal) : 0,
      };
    }
    case 'word-search': {
      const g = wordSearch.grade(playerState, solution as { placements: never[] });
      return {
        progress: g.wordsTotal > 0 ? g.wordsFound / g.wordsTotal : 0,
        accuracy: g.wordsFound / Math.max(1, g.selectionsSubmitted),
        complete: g.complete,
        filledFraction: g.wordsTotal > 0 ? g.wordsFound / g.wordsTotal : 0,
      };
    }
    case 'minesweeper': {
      const g = minesweeper.grade(playerState, solution as minesweeper.MinesweeperSolution);
      return {
        progress: g.cellsTotal > 0 ? g.cellsCorrect / g.cellsTotal : 0,
        accuracy: g.cellsFilled > 0 ? g.cellsCorrect / g.cellsFilled : 1,
        complete: g.complete,
        filledFraction: g.cellsTotal > 0 ? Math.min(1, g.cellsFilled / g.cellsTotal) : 0,
      };
    }
    default:
      throw new Error(`${gameId} is not a puzzle`);
  }
}

export function puzzleHint(
  gameId: GameId,
  puzzle: unknown,
  solution: unknown,
  playerState: unknown,
  rng: Rng,
): { path: string; value: number | string } | null {
  switch (gameId) {
    case 'sudoku':
      return sudoku.hint(puzzle as { givens: Grid }, solution as Grid, playerState, rng);
    case 'killer-sudoku':
      return killerSudoku.hint(
        puzzle as { cages: never[]; givens: Grid },
        solution as Grid,
        playerState,
        rng,
      );
    case 'nonogram': {
      const size = (puzzle as { size: number }).size;
      return nonogram.hint(solution as boolean[], playerState, size, rng);
    }
    case 'word-search':
      return wordSearch.hint(solution as { placements: never[] }, playerState, rng);
    case 'minesweeper':
      return minesweeper.hint(solution as minesweeper.MinesweeperSolution, playerState, rng);
    default:
      return null;
  }
}

/**
 * Apply one committed move to a player's puzzle state, returning the new state
 * or null when the move is illegal. Never consults the solution.
 */
export function applyCommit(
  gameId: GameId,
  playerState: unknown,
  puzzle: unknown,
  path: string,
  value: number | string | null,
): unknown | null {
  switch (gameId) {
    case 'sudoku':
    case 'killer-sudoku': {
      const board = Array.isArray(playerState) ? [...(playerState as number[])] : [];
      const [r, c] = path.split(',').map(Number);
      if (r === undefined || c === undefined || Number.isNaN(r) || Number.isNaN(c)) return null;
      if (r < 0 || r > 8 || c < 0 || c > 8) return null;
      const idx = r * 9 + c;
      const givens = (puzzle as { givens: Grid }).givens;
      if ((givens[idx] ?? 0) !== 0) return null; // never overwrite a given
      const v = value === null ? 0 : Number(value);
      if (!Number.isInteger(v) || v < 0 || v > 9) return null;
      board[idx] = v;
      return board;
    }
    case 'nonogram': {
      const size = (puzzle as { size: number }).size;
      const marks = Array.isArray(playerState) ? [...(playerState as number[])] : [];
      const [r, c] = path.split(',').map(Number);
      if (r === undefined || c === undefined) return null;
      if (r < 0 || r >= size || c < 0 || c >= size) return null;
      const v = value === null ? 0 : Number(value);
      if (![0, 1, 2].includes(v)) return null;
      marks[r * size + c] = v;
      return marks;
    }
    case 'word-search': {
      // path is "y1,x1,y2,x2"; the runtime validates it against the solution.
      const st = (playerState ?? { found: [], selections: 0 }) as {
        found: string[];
        selections: number;
      };
      return { found: [...st.found], selections: st.selections + 1 };
    }
    case 'minesweeper': {
      const puz = puzzle as { rows: number; cols: number };
      const st = (playerState ?? {
        revealed: new Array<boolean>(puz.rows * puz.cols).fill(false),
        detonated: false,
        detonatedCell: null,
        moves: 0,
      }) as {
        revealed: boolean[];
        detonated: boolean;
        detonatedCell: { row: number; col: number } | null;
        moves: number;
      };
      if (st.detonated) return null;
      const nextRevealed = Array.isArray(st.revealed)
        ? [...st.revealed]
        : new Array<boolean>(puz.rows * puz.cols).fill(false);

      if (typeof value === 'string' && value.startsWith('detonated')) {
        const [r, c] = path.split(',').map(Number);
        return {
          ...st,
          detonated: true,
          detonatedCell: { row: r ?? 0, col: c ?? 0 },
          moves: st.moves + 1,
        };
      }

      if (typeof value === 'string' && value.includes(';')) {
        const indices = value.split(';').map(Number);
        for (const idx of indices) {
          if (idx >= 0 && idx < nextRevealed.length) nextRevealed[idx] = true;
        }
        return { ...st, revealed: nextRevealed, moves: st.moves + 1 };
      }

      const [r, c] = path.split(',').map(Number);
      if (r !== undefined && c !== undefined && !Number.isNaN(r) && !Number.isNaN(c)) {
        const idx = r * puz.cols + c;
        if (idx >= 0 && idx < nextRevealed.length) {
          nextRevealed[idx] = true;
        }
      }
      return {
        ...st,
        revealed: nextRevealed,
        moves: st.moves + 1,
      };
    }
    default:
      return null;
  }
}
