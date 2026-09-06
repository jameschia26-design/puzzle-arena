import {
  killerSudoku,
  mastermind,
  minesweeper,
  nonogram,
  sudoku,
  wordSearch,
  solvePath,
  cageConstraint,
  getWordsForTheme,
  type Grid,
} from '@puzzle-arena/puzzles';
import type { Difficulty, GameId, MastermindGuessAck, Rng } from '@puzzle-arena/shared';

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
  terminal: boolean;
  /** What the leaderboard shows while instant feedback is off. */
  filledFraction: number;
  assetValue?: number;
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
    case 'mastermind': {
      const colors = (config['colors'] as number) ?? 8;
      const slots = (config['slots'] as number) ?? 4;
      const maxTries = (config['maxTries'] as number) ?? 10;
      const { puzzle, solution, meta } = mastermind.generate({
        seed,
        colors,
        slots,
        maxTries,
      });
      return {
        puzzle,
        solution,
        meta,
        initialState: { guesses: [], solved: false, exhausted: false },
        solveOrder: [],
      };
    }
    default:
      throw new Error(`${gameId} is not a puzzle`);
  }
}

export function initialPuzzleState(gameId: GameId, puzzle: unknown): unknown {
  switch (gameId) {
    case 'sudoku':
    case 'killer-sudoku':
      return [...(puzzle as { givens: Grid }).givens];
    case 'nonogram': {
      const size = (puzzle as { size: number }).size;
      return new Array<number>(size * size).fill(0);
    }
    case 'word-search':
      return { found: [], selections: 0 };
    case 'minesweeper': {
      const p = puzzle as { rows: number; cols: number };
      return {
        revealed: new Array<boolean>(p.rows * p.cols).fill(false),
        detonated: false,
        detonatedCell: null,
        moves: 0,
      };
    }
    case 'mastermind':
      return { guesses: [], solved: false, exhausted: false };
    default:
      return null;
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
        terminal: g.complete,
        filledFraction: g.cellsTotal > 0 ? g.cellsFilled / g.cellsTotal : 0,
      };
    }
    case 'nonogram': {
      const g = nonogram.grade(playerState, solution as boolean[]);
      return {
        progress: g.cellsTotal > 0 ? g.cellsCorrect / g.cellsTotal : 0,
        accuracy: g.cellsFilled > 0 ? g.cellsCorrect / g.cellsFilled : 1,
        complete: g.complete,
        terminal: g.complete,
        filledFraction: g.cellsTotal > 0 ? Math.min(1, g.cellsFilled / g.cellsTotal) : 0,
      };
    }
    case 'word-search': {
      const g = wordSearch.grade(playerState, solution as { placements: never[] });
      return {
        progress: g.wordsTotal > 0 ? g.wordsFound / g.wordsTotal : 0,
        accuracy: g.wordsFound / Math.max(1, g.selectionsSubmitted),
        complete: g.complete,
        terminal: g.complete,
        filledFraction: g.wordsTotal > 0 ? g.wordsFound / g.wordsTotal : 0,
      };
    }
    case 'minesweeper': {
      const g = minesweeper.grade(playerState, solution as minesweeper.MinesweeperSolution);
      return {
        progress: g.cellsTotal > 0 ? g.cellsCorrect / g.cellsTotal : 0,
        accuracy: g.cellsFilled > 0 ? g.cellsCorrect / g.cellsFilled : 1,
        complete: g.complete,
        terminal: g.complete,
        filledFraction: g.cellsTotal > 0 ? Math.min(1, g.cellsFilled / g.cellsTotal) : 0,
      };
    }
    case 'mastermind': {
      const g = mastermind.grade(playerState, puzzle as mastermind.MastermindPuzzle);
      return {
        progress: g.progress,
        accuracy: g.accuracy,
        complete: g.complete,
        terminal: g.terminal,
        filledFraction: g.filledFraction,
        assetValue: g.assetValue,
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

export interface AppliedPuzzleCommit {
  state: unknown;
  foundWord?: string | null;
  mastermindGuess?: MastermindGuessAck;
}

/**
 * Apply one committed move to a player's puzzle state, returning the new state
 * and game-specific feedback, or null when the move is illegal.
 */
export function applyCommit(
  gameId: GameId,
  playerState: unknown,
  puzzle: unknown,
  solution: unknown,
  path: string,
  value: number | string | null,
): AppliedPuzzleCommit | null {
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
      return { state: board };
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
      return { state: marks };
    }
    case 'word-search': {
      const [y1, x1, y2, x2] = path.split(',').map(Number);
      if ([y1, x1, y2, x2].some((n) => n === undefined || Number.isNaN(n))) {
        return null;
      }
      const st = (playerState ?? { found: [], selections: 0 }) as {
        found: string[];
        selections: number;
      };
      const word = wordSearch.checkSelection(
        puzzle as never,
        solution as never,
        x1 as number,
        y1 as number,
        x2 as number,
        y2 as number,
      );
      const found = [...st.found];
      let foundWord: string | null = null;
      if (word && !found.includes(word)) {
        found.push(word);
        foundWord = word;
      }
      return {
        state: { found, selections: st.selections + 1 },
        foundWord,
      };
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
          state: {
            ...st,
            detonated: true,
            detonatedCell: { row: r ?? 0, col: c ?? 0 },
            moves: st.moves + 1,
          },
        };
      }

      if (typeof value === 'string' && (value.includes(';') || value.includes(','))) {
        const indices = value.split(/[;,]/).map(Number).filter((n) => !Number.isNaN(n));
        for (const idx of indices) {
          if (idx >= 0 && idx < nextRevealed.length) nextRevealed[idx] = true;
        }
        return {
          state: { ...st, revealed: nextRevealed, moves: st.moves + 1 },
        };
      }

      const [r, c] = path.split(',').map(Number);
      if (r !== undefined && c !== undefined && !Number.isNaN(r) && !Number.isNaN(c)) {
        const idx = r * puz.cols + c;
        if (idx >= 0 && idx < nextRevealed.length) {
          nextRevealed[idx] = true;
        }
      }
      return {
        state: {
          ...st,
          revealed: nextRevealed,
          moves: st.moves + 1,
        },
      };
    }
    case 'mastermind': {
      if (path !== 'guess' || typeof value !== 'string') return null;
      const puz = puzzle as mastermind.MastermindPuzzle;
      const sol = solution as mastermind.MastermindSolution;
      const st = (playerState ?? {
        guesses: [],
        solved: false,
        exhausted: false,
      }) as mastermind.MastermindPlayerState;

      const tokens = value.split(',');
      if (tokens.length !== puz.slots) return null;

      const code: number[] = [];
      for (const token of tokens) {
        if (!/^(0|[1-9]\d*)$/.test(token)) return null;
        const n = Number(token);
        if (n < 0 || n >= puz.colors) return null;
        code.push(n);
      }

      const nextState = mastermind.applyGuess(puz, sol, st, code);
      if (!nextState) return null;

      const newlyAdded = nextState.guesses[nextState.guesses.length - 1]!;
      const mastermindGuess: MastermindGuessAck = {
        code: newlyAdded.code,
        exact: newlyAdded.exact,
        color: newlyAdded.color,
        tries: nextState.guesses.length,
        solved: nextState.solved,
        exhausted: nextState.exhausted,
      };

      return {
        state: nextState,
        mastermindGuess,
      };
    }
    default:
      return null;
  }
}
