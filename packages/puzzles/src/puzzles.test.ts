import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import * as sudoku from './sudoku.js';
import * as killer from './killer-sudoku.js';
import * as nonogram from './nonogram.js';
import * as wordSearch from './word-search.js';
import * as minesweeper from './minesweeper.js';
import * as mastermind from './mastermind.js';
import { fallbackWordsFor } from './word-lists.js';
import {
  CELLS,
  cageConstraint,
  countSolutions,
  rateDifficulty,
  solve,
  solvePath,
  type Difficulty,
} from './core/solver.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/* ================================================================== */
/* Sudoku — the uniqueness guarantee                                   */
/* ================================================================== */

describe('sudoku generation', () => {
  for (const difficulty of DIFFICULTIES) {
    it(`produces 25 instances at ${difficulty} with exactly one solution`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { puzzle, solution, meta } = sudoku.generate({ difficulty, seed });

        // The hard guarantee: exactly one solution.
        expect(countSolutions(puzzle.givens, 2)).toBe(1);

        // The solution is a valid completion of the givens.
        for (let i = 0; i < CELLS; i++) {
          const g = puzzle.givens[i] as number;
          if (g !== 0) expect(g).toBe(solution[i]);
        }
        expect(solve(puzzle.givens)).toEqual(solution);

        // A real puzzle, not a nearly-full grid.
        const blanks = puzzle.givens.filter((v) => v === 0).length;
        expect(blanks).toBeGreaterThanOrEqual(35);

        expect(meta.actualDifficulty).toBeDefined();
        expect(meta.seed).toBe(seed);
      }
    });
  }

  it('hits the requested difficulty tier, or records what it reached', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 10; seed++) {
        const { puzzle, meta } = sudoku.generate({ difficulty, seed });
        // Whatever it claims, the rating must agree with the actual board.
        expect(rateDifficulty(puzzle.givens)).toBe(meta.actualDifficulty);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = sudoku.generate({ difficulty, seed: 4242 });
      const b = sudoku.generate({ difficulty, seed: 4242 });
      expect(a.puzzle.givens).toEqual(b.puzzle.givens);
      expect(a.solution).toEqual(b.solution);
      expect(a.meta.actualDifficulty).toBe(b.meta.actualDifficulty);
    }
  });

  it('produces different puzzles for different seeds', () => {
    const a = sudoku.generate({ difficulty: 'medium', seed: 1 });
    const b = sudoku.generate({ difficulty: 'medium', seed: 2 });
    expect(a.puzzle.givens).not.toEqual(b.puzzle.givens);
  });

  it('grades the solution complete and an empty board at zero', () => {
    const { puzzle, solution } = sudoku.generate({ difficulty: 'medium', seed: 7 });

    const full = sudoku.grade(solution, solution, puzzle);
    expect(full.complete).toBe(true);
    expect(full.cellsCorrect).toBe(full.cellsTotal);

    const empty = sudoku.grade([...puzzle.givens], solution, puzzle);
    expect(empty.cellsCorrect).toBe(0);
    expect(empty.cellsFilled).toBe(0);
    expect(empty.complete).toBe(false);
    expect(empty.cellsTotal).toBeGreaterThan(0);
  });

  it('counts only cells that were blank at the start', () => {
    const { puzzle, solution } = sudoku.generate({ difficulty: 'medium', seed: 11 });
    const g = sudoku.grade([...puzzle.givens], solution, puzzle);
    expect(g.cellsTotal).toBe(puzzle.givens.filter((v) => v === 0).length);
  });

  it('hints reveal a genuinely correct cell', () => {
    const { puzzle, solution } = sudoku.generate({ difficulty: 'medium', seed: 3 });
    const board = [...puzzle.givens];
    const h = sudoku.hint(puzzle, solution, board, mulberry32(1));
    expect(h).not.toBeNull();
    const [r, c] = (h as { path: string }).path.split(',').map(Number);
    expect(solution[(r as number) * 9 + (c as number)]).toBe((h as { value: number }).value);
  });

  it('detects conflicts from the visible board alone', () => {
    const board = new Array<number>(81).fill(0);
    board[0] = 5;
    board[1] = 5; // same row
    const bad = sudoku.conflicts(board);
    expect(bad).toContain(0);
    expect(bad).toContain(1);
    expect(sudoku.conflicts(new Array<number>(81).fill(0))).toEqual([]);
  });
});

/* ================================================================== */
/* Killer Sudoku                                                       */
/* ================================================================== */

describe('killer sudoku generation', () => {
  for (const difficulty of DIFFICULTIES) {
    // 'hard'/'expert' occasionally fall through every cage profile to the
    // digit-revealing last resort, which is the slowest legal path through
    // the generator by design (it exists precisely so generation always
    // terminates) — the default 60s test timeout is too tight for that on a
    // loaded machine, so this test gets a longer budget rather than the
    // generator being made to cut corners on uniqueness to satisfy a test.
    it(`produces instances at ${difficulty} with exactly one solution`, () => {
      // Fewer seeds than Sudoku: proving a given-free Killer board unique is
      // far more expensive, and 8 seeds per tier already exercises every path.
      for (let seed = 1; seed <= 8; seed++) {
        const { puzzle, solution, meta } = killer.generate({ difficulty, seed });
        const constraint = cageConstraint(
          puzzle.cages.map((c) => ({ cells: c.cells, sum: c.sum })),
        );

        expect(countSolutions(puzzle.givens, 2, constraint)).toBe(1);

        // Cages partition all 81 cells exactly once.
        const all = puzzle.cages.flatMap((c) => c.cells).sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: CELLS }, (_, i) => i));

        // Cage sizes stay within 2..5 — a size-1 cage is a free digit.
        for (const cage of puzzle.cages) {
          expect(cage.cells.length).toBeGreaterThanOrEqual(2);
          expect(cage.cells.length).toBeLessThanOrEqual(5);
          // The sum matches the solution and digits never repeat inside a cage.
          const digits = cage.cells.map((c) => solution[c] as number);
          expect(digits.reduce((a, b) => a + b, 0)).toBe(cage.sum);
          expect(new Set(digits).size).toBe(digits.length);
        }

        expect(meta.seed).toBe(seed);
      }
    }, 180_000);
  }

  it('reveals no digits in the common case', () => {
    // The plan's Verification step 1 calls for this explicitly.
    let givenFree = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { puzzle } = killer.generate({ difficulty: 'medium', seed });
      if (puzzle.givens.every((v) => v === 0)) givenFree++;
    }
    expect(givenFree).toBe(8);
  });

  it('is deterministic for a given seed', () => {
    const a = killer.generate({ difficulty: 'medium', seed: 99 });
    const b = killer.generate({ difficulty: 'medium', seed: 99 });
    expect(a.puzzle.cages).toEqual(b.puzzle.cages);
    expect(a.solution).toEqual(b.solution);
  });

  it('grades the solution complete and an empty board at zero', () => {
    const { puzzle, solution } = killer.generate({ difficulty: 'easy', seed: 5 });
    expect(killer.grade(solution, solution, puzzle).complete).toBe(true);
    const empty = killer.grade(new Array<number>(81).fill(0), solution, puzzle);
    expect(empty.cellsCorrect).toBe(0);
    expect(empty.complete).toBe(false);
  });
});

/* ================================================================== */
/* Nonogram                                                            */
/* ================================================================== */

describe('nonogram generation', () => {
  for (const size of [10, 15, 20] as const) {
    it(`produces 25 unique ${size}x${size} instances`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { puzzle, solution } = nonogram.generate({
          difficulty: 'medium',
          seed,
          size,
        });

        expect(
          nonogram.countNonogramSolutions(size, puzzle.rowClues, puzzle.colClues, 2),
        ).toBe(1);

        // Clues must actually describe the solution.
        for (let r = 0; r < size; r++) {
          const row = solution.slice(r * size, r * size + size);
          expect(puzzle.rowClues[r]).toEqual(nonogram.runsOf(row));
        }
        for (let c = 0; c < size; c++) {
          const col: boolean[] = [];
          for (let r = 0; r < size; r++) col.push(solution[r * size + c] as boolean);
          expect(puzzle.colClues[c]).toEqual(nonogram.runsOf(col));
        }
      }
    });
  }

  it('is deterministic for a given seed', () => {
    const a = nonogram.generate({ difficulty: 'medium', seed: 8, size: 10 });
    const b = nonogram.generate({ difficulty: 'medium', seed: 8, size: 10 });
    expect(a.puzzle).toEqual(b.puzzle);
    expect(a.solution).toEqual(b.solution);
  });

  it('grades the solution complete and an empty board at zero', () => {
    const { solution } = nonogram.generate({ difficulty: 'medium', seed: 2, size: 10 });
    const marks = solution.map((b) => (b ? nonogram.FILLED : nonogram.EMPTY));
    expect(nonogram.grade(marks, solution).complete).toBe(true);

    const empty = nonogram.grade(new Array<number>(100).fill(0), solution);
    expect(empty.cellsCorrect).toBe(0);
    expect(empty.complete).toBe(false);
    expect(empty.cellsTotal).toBeGreaterThan(0);
  });

  it('does not reward painting everything', () => {
    const { solution } = nonogram.generate({ difficulty: 'medium', seed: 4, size: 10 });
    const allFilled = new Array<number>(100).fill(nonogram.FILLED);
    const g = nonogram.grade(allFilled, solution);
    expect(g.complete).toBe(false);
    // Accuracy denominator catches the spammer: every cell painted, but only
    // the truly-filled ones count as correct.
    expect(g.cellsFilled).toBe(100);
    expect(g.cellsCorrect).toBeLessThan(100);
  });
});

/* ================================================================== */
/* Word Search                                                         */
/* ================================================================== */

describe('word search generation', () => {
  it('produces 25 grids where every word appears exactly once', () => {
    const words = fallbackWordsFor('space');
    for (let seed = 1; seed <= 25; seed++) {
      const { puzzle, solution } = wordSearch.generate({
        difficulty: 'medium',
        seed,
        words,
        theme: 'Space',
      });

      expect(solution.placements.length).toBe(puzzle.words.length);
      for (const word of puzzle.words) {
        // Exactly one occurrence — no accidental second copy from the filler.
        expect(wordSearch.findAll(puzzle.grid, puzzle.size, word).length).toBe(1);
      }
      expect(puzzle.grid.length).toBe(puzzle.size * puzzle.size);
      expect(puzzle.grid.every((ch) => /^[A-Z]$/.test(ch))).toBe(true);
    }
  });

  it('places words in a spread of directions, not just one', () => {
    const { solution } = wordSearch.generate({
      difficulty: 'medium',
      seed: 3,
      words: fallbackWordsFor('jungle'),
    });
    const dirs = new Set(solution.placements.map((p) => `${p.dx},${p.dy}`));
    expect(dirs.size).toBeGreaterThan(2);
  });

  it('is deterministic for a given seed', () => {
    const words = fallbackWordsFor('ocean');
    const a = wordSearch.generate({ difficulty: 'medium', seed: 12, words });
    const b = wordSearch.generate({ difficulty: 'medium', seed: 12, words });
    expect(a.puzzle.grid).toEqual(b.puzzle.grid);
    expect(a.solution.placements).toEqual(b.solution.placements);
  });

  it('validates selections in both drag directions and rejects rubbish', () => {
    const { puzzle, solution } = wordSearch.generate({
      difficulty: 'medium',
      seed: 6,
      words: fallbackWordsFor('space'),
    });
    const p = solution.placements[0] as wordSearch.Placement;
    const endX = p.x + p.dx * (p.word.length - 1);
    const endY = p.y + p.dy * (p.word.length - 1);

    expect(wordSearch.checkSelection(puzzle, solution, p.x, p.y, endX, endY)).toBe(p.word);
    expect(wordSearch.checkSelection(puzzle, solution, endX, endY, p.x, p.y)).toBe(p.word);
    // A single cell is not a selection.
    expect(wordSearch.checkSelection(puzzle, solution, p.x, p.y, p.x, p.y)).toBeNull();
  });

  it('grades found words and stays honest about accuracy', () => {
    const { solution } = wordSearch.generate({
      difficulty: 'medium',
      seed: 9,
      words: fallbackWordsFor('music'),
    });
    const all = solution.placements.map((p) => p.word);

    const done = wordSearch.grade({ found: all, selections: all.length }, solution);
    expect(done.complete).toBe(true);
    expect(done.wordsFound).toBe(done.wordsTotal);

    const none = wordSearch.grade({ found: [], selections: 0 }, solution);
    expect(none.wordsFound).toBe(0);
    expect(none.complete).toBe(false);
  });

  it('falls back sensibly for an unknown theme', () => {
    expect(fallbackWordsFor('utterly unknown theme').length).toBeGreaterThan(0);
    expect(fallbackWordsFor('Deep Sea')).toContain('OCTOPUS');
  });
});
/* ================================================================== */
/* Minesweeper                                                         */
/* ================================================================== */

describe('minesweeper generation and solving', () => {
  it.each(DIFFICULTIES)('generates valid board configuration for %s', (difficulty) => {
    const { puzzle, solution } = minesweeper.generate({ difficulty, seed: 123 });
    const cfg = minesweeper.DIFFICULTY_CONFIGS[difficulty];
    expect(puzzle.rows).toBe(cfg.rows);
    expect(puzzle.cols).toBe(cfg.cols);
    expect(puzzle.totalMines).toBe(cfg.totalMines);

    // Count actual mines in solution grid
    const mineCount = solution.grid.filter((v) => v === minesweeper.MINE).length;
    expect(mineCount).toBe(cfg.totalMines);

    // Verify safe start is 0 and has no mines in its 3x3 neighborhood
    const startIdx = puzzle.safeStart.row * puzzle.cols + puzzle.safeStart.col;
    expect(solution.grid[startIdx]).toBe(0);
    for (const n of minesweeper.getNeighbors(puzzle.safeStart.row, puzzle.safeStart.col, puzzle.rows, puzzle.cols)) {
      expect(solution.grid[n.r * puzzle.cols + n.c]).not.toBe(minesweeper.MINE);
    }

    // Verify all number clues match exact neighbor mine counts
    for (let r = 0; r < puzzle.rows; r++) {
      for (let c = 0; c < puzzle.cols; c++) {
        const idx = r * puzzle.cols + c;
        const val = solution.grid[idx];
        if (val === minesweeper.MINE) continue;
        let neighbors = 0;
        for (const n of minesweeper.getNeighbors(r, c, puzzle.rows, puzzle.cols)) {
          if (solution.grid[n.r * puzzle.cols + n.c] === minesweeper.MINE) neighbors++;
        }
        expect(val).toBe(neighbors);
      }
    }
  });

  it('flood fills safe regions on reveal', () => {
    const { puzzle, solution } = minesweeper.generate({ difficulty: 'easy', seed: 42 });
    const revealed = new Array<boolean>(puzzle.rows * puzzle.cols).fill(false);
    const res = minesweeper.revealCell(solution, revealed, puzzle.safeStart.row, puzzle.safeStart.col);
    expect(res.detonated).toBe(false);
    expect(res.countRevealed).toBeGreaterThan(1);

    const g = minesweeper.grade({ revealed: res.revealed, detonated: false }, solution);
    expect(g.cellsCorrect).toBe(res.countRevealed);
    expect(g.complete).toBe(false);
  });

  it('grades complete solve when all non-mines are revealed', () => {
    const { puzzle, solution } = minesweeper.generate({ difficulty: 'easy', seed: 99 });
    const allRevealed = solution.grid.map((v) => v !== minesweeper.MINE);
    const g = minesweeper.grade({ revealed: allRevealed, detonated: false }, solution);
    expect(g.complete).toBe(true);
    expect(g.cellsCorrect).toBe(puzzle.rows * puzzle.cols - puzzle.totalMines);
  });

  it('detects detonation on hitting a mine', () => {
    const { puzzle, solution } = minesweeper.generate({ difficulty: 'easy', seed: 99 });
    const mineIdx = solution.grid.indexOf(minesweeper.MINE);
    const r = Math.floor(mineIdx / puzzle.cols);
    const c = mineIdx % puzzle.cols;
    const res = minesweeper.revealCell(solution, new Array(puzzle.rows * puzzle.cols).fill(false), r, c);
    expect(res.detonated).toBe(true);
    const g = minesweeper.grade({ revealed: res.revealed, detonated: true }, solution);
    expect(g.complete).toBe(false);
  });

  it('provides helpful hints for unrevealed non-mines', () => {
    const { puzzle, solution } = minesweeper.generate({ difficulty: 'easy', seed: 7 });
    const revealed = new Array<boolean>(puzzle.rows * puzzle.cols).fill(false);
    const h = minesweeper.hint(solution, { revealed, detonated: false }, mulberry32(1));
    expect(h).not.toBeNull();
    const [r, c] = h!.path.split(',').map(Number);
    expect(solution.grid[r! * puzzle.cols + c!]).not.toBe(minesweeper.MINE);
  });
});

/* ================================================================== */
/* Solver internals                                                    */
/* ================================================================== */

describe('solver', () => {
  it('rates a singles-only board as easy and detects multiple solutions', () => {
    // An empty grid has astronomically many solutions; the cap stops at 2.
    expect(countSolutions(new Array<number>(81).fill(0), 2)).toBe(2);
  });

  it('returns 0 for a contradictory grid', () => {
    const g = new Array<number>(81).fill(0);
    g[0] = 5;
    g[1] = 5; // same row, same digit
    expect(countSolutions(g, 2)).toBe(0);
  });

  it('solvePath covers every cell', () => {
    const { puzzle } = sudoku.generate({ difficulty: 'medium', seed: 21 });
    const path = solvePath(puzzle.givens);
    const blanks = puzzle.givens.filter((v) => v === 0).length;
    expect(path.length).toBe(blanks);
    expect(new Set(path).size).toBe(path.length);
  });
});

/* ================================================================== */
/* Mastermind — clues, evaluation, state, grading, bots                */
/* ================================================================== */

describe('mastermind evaluation', () => {
  it('evaluates all-exact matches correctly', () => {
    const secret = [1, 2, 3, 4];
    const guess = [1, 2, 3, 4];
    const res = mastermind.evaluateGuess(guess, secret);
    expect(res).toEqual({ exact: 4, color: 0 });
    expect(res.exact + res.color).toBeLessThanOrEqual(secret.length);
    expect(guess).toEqual([1, 2, 3, 4]);
    expect(secret).toEqual([1, 2, 3, 4]);
  });

  it('evaluates all-color-only matches correctly (transposed permutations)', () => {
    const secret = [0, 1, 2, 3];
    const guess = [3, 2, 1, 0];
    const res = mastermind.evaluateGuess(guess, secret);
    expect(res).toEqual({ exact: 0, color: 4 });
    expect(res.exact + res.color).toBeLessThanOrEqual(secret.length);
  });

  it('handles duplicate-overlap cases without exceeding slots or leaking indices', () => {
    // Secret has two 0s, guess has three 0s and one 1
    const secret = [0, 0, 1, 2];
    const guess = [0, 1, 0, 0];
    // Index 0 is exact (0 === 0).
    // Unmatched secret: [0 at idx 1, 1 at idx 2, 2 at idx 3] -> counts: 0:1, 1:1, 2:1.
    // Unmatched guess: [1 at idx 1, 0 at idx 2, 0 at idx 3] -> counts: 1:1, 0:2.
    // Color matches: 0 -> min(1, 2) = 1; 1 -> min(1, 1) = 1; 2 -> min(1, 0) = 0.
    // exact: 1, color: 2.
    const res = mastermind.evaluateGuess(guess, secret);
    expect(res).toEqual({ exact: 1, color: 2 });
    expect(res.exact + res.color).toBeLessThanOrEqual(secret.length);

    // Secret: [1, 1, 2, 2], Guess: [2, 2, 1, 1] -> 0 exact, 4 color
    expect(mastermind.evaluateGuess([2, 2, 1, 1], [1, 1, 2, 2])).toEqual({ exact: 0, color: 4 });

    // Secret: [1, 2, 3, 4], Guess: [5, 5, 5, 5] -> 0 exact, 0 color
    expect(mastermind.evaluateGuess([5, 5, 5, 5], [1, 2, 3, 4])).toEqual({ exact: 0, color: 0 });

    // Secret: [1, 1, 1, 2], Guess: [1, 1, 2, 1] -> 2 exact (indices 0, 1), 2 color (indices 2, 3)
    expect(mastermind.evaluateGuess([1, 1, 2, 1], [1, 1, 1, 2])).toEqual({ exact: 2, color: 2 });
  });
});

describe('mastermind generation and determinism', () => {
  it('produces the same puzzle and secret code for the same seed and options', () => {
    const a = mastermind.generate({ seed: 12345, colors: 8, slots: 5, maxTries: 12 });
    const b = mastermind.generate({ seed: 12345, colors: 8, slots: 5, maxTries: 12 });

    expect(a.puzzle).toEqual(b.puzzle);
    expect(a.solution.code).toEqual(b.solution.code);
    expect(a.meta.seed).toBe(b.meta.seed);
    expect(a.meta.actualDifficulty).toBe('medium');

    // Public puzzle must never contain the secret
    expect('code' in a.puzzle).toBe(false);
    expect('solution' in a.puzzle).toBe(false);
  });

  it('rejects invalid configuration ranges on generate', () => {
    expect(() => mastermind.generate({ colors: 6 })).toThrow();
    expect(() => mastermind.generate({ colors: 13 })).toThrow();
    expect(() => mastermind.generate({ slots: 3 })).toThrow();
    expect(() => mastermind.generate({ slots: 9 })).toThrow();
    expect(() => mastermind.generate({ maxTries: 5 })).toThrow();
    expect(() => mastermind.generate({ maxTries: 31 })).toThrow();
  });
});

describe('mastermind state transitions and lifecycle', () => {
  const puzzle: mastermind.MastermindPuzzle = { colors: 8, slots: 4, maxTries: 4 };
  const solution: mastermind.MastermindSolution = { code: [0, 1, 2, 3] };

  it('accepts repeated colors and repeated whole guesses', () => {
    let state: mastermind.MastermindPlayerState = { guesses: [], solved: false, exhausted: false };

    // Guess 1: repeated colors
    const s1 = mastermind.applyGuess(puzzle, solution, state, [0, 0, 0, 0]);
    expect(s1).not.toBeNull();
    expect(s1!.guesses.length).toBe(1);
    expect(s1!.guesses[0]!.exact).toBe(1);
    expect(s1!.guesses[0]!.color).toBe(0);

    // Guess 2: duplicate whole guess (legal)
    const s2 = mastermind.applyGuess(puzzle, solution, s1!, [0, 0, 0, 0]);
    expect(s2).not.toBeNull();
    expect(s2!.guesses.length).toBe(2);
  });

  it('rejects malformed guesses without mutating state', () => {
    const state: mastermind.MastermindPlayerState = { guesses: [], solved: false, exhausted: false };

    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2])).toBeNull(); // wrong length
    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, 3, 4])).toBeNull(); // wrong length
    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, 8])).toBeNull(); // color out of range
    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, -1])).toBeNull(); // negative color
    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, 1.5])).toBeNull(); // non-integer
    expect(state.guesses.length).toBe(0);
  });

  it('handles solve and terminal transitions', () => {
    let state: mastermind.MastermindPlayerState = { guesses: [], solved: false, exhausted: false };
    const s1 = mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, 3]);
    expect(s1).not.toBeNull();
    expect(s1!.solved).toBe(true);
    expect(s1!.exhausted).toBe(false);

    // Post-terminal rejection
    expect(mastermind.applyGuess(puzzle, solution, s1!, [0, 1, 2, 3])).toBeNull();
  });

  it('handles final-attempt exhaustion and post-terminal rejection', () => {
    let state: mastermind.MastermindPlayerState = { guesses: [], solved: false, exhausted: false };
    // Max tries is 4
    state = mastermind.applyGuess(puzzle, solution, state, [4, 4, 4, 4])!;
    state = mastermind.applyGuess(puzzle, solution, state, [4, 4, 4, 4])!;
    state = mastermind.applyGuess(puzzle, solution, state, [4, 4, 4, 4])!;
    expect(state.solved).toBe(false);
    expect(state.exhausted).toBe(false);

    // 4th and final attempt
    state = mastermind.applyGuess(puzzle, solution, state, [4, 4, 4, 4])!;
    expect(state.solved).toBe(false);
    expect(state.exhausted).toBe(true);

    // Next attempt must be rejected
    expect(mastermind.applyGuess(puzzle, solution, state, [0, 1, 2, 3])).toBeNull();
  });
});

describe('mastermind grading and scoring invariants', () => {
  const puz: mastermind.MastermindPuzzle = { colors: 8, slots: 4, maxTries: 30 };

  it('exhausted is terminal but not complete', () => {
    const state: mastermind.MastermindPlayerState = {
      guesses: [
        { code: [4, 5, 6, 7], exact: 0, color: 0 },
        { code: [0, 5, 6, 7], exact: 1, color: 0 },
      ],
      solved: false,
      exhausted: true,
    };
    const grade = mastermind.grade(state, puz);
    expect(grade.complete).toBe(false);
    expect(grade.terminal).toBe(true);
    expect(grade.progress).toBe(1 / 4);
  });

  it('a 3-attempt solve scores above a 5-attempt solve', () => {
    const solve3: mastermind.MastermindPlayerState = {
      guesses: [
        { code: [0, 0, 0, 0], exact: 1, color: 0 },
        { code: [1, 1, 1, 1], exact: 1, color: 0 },
        { code: [0, 1, 2, 3], exact: 4, color: 0 },
      ],
      solved: true,
      exhausted: false,
    };
    const solve5: mastermind.MastermindPlayerState = {
      guesses: [
        { code: [0, 0, 0, 0], exact: 1, color: 0 },
        { code: [1, 1, 1, 1], exact: 1, color: 0 },
        { code: [2, 2, 2, 2], exact: 1, color: 0 },
        { code: [3, 3, 3, 3], exact: 1, color: 0 },
        { code: [0, 1, 2, 3], exact: 4, color: 0 },
      ],
      solved: true,
      exhausted: false,
    };

    const grade3 = mastermind.grade(solve3, puz);
    const grade5 = mastermind.grade(solve5, puz);

    expect(grade3.assetValue).toBeGreaterThan(grade5.assetValue);
    expect(grade3.assetValue).toBe(10000 - 2 * 300); // 9400
    expect(grade5.assetValue).toBe(10000 - 4 * 300); // 8800
  });

  it('a 30-attempt solve scores above the best unsolved score', () => {
    const solve30Guesses = Array.from({ length: 29 }, () => ({
      code: [0, 0, 0, 0],
      exact: 1,
      color: 0,
    }));
    solve30Guesses.push({ code: [0, 1, 2, 3], exact: 4, color: 0 });

    const solve30: mastermind.MastermindPlayerState = {
      guesses: solve30Guesses,
      solved: true,
      exhausted: false,
    };
    const grade30 = mastermind.grade(solve30, puz);
    expect(grade30.assetValue).toBe(1300); // 10000 - 29*300 = 1300

    // Best possible unsolved score: 3 of 4 exact
    const bestUnsolved: mastermind.MastermindPlayerState = {
      guesses: [{ code: [0, 1, 2, 7], exact: 3, color: 0 }],
      solved: false,
      exhausted: true,
    };
    const gradeUnsolved = mastermind.grade(bestUnsolved, puz);
    expect(gradeUnsolved.assetValue).toBe(Math.round((3 / 4) * 200)); // 150

    expect(grade30.assetValue).toBeGreaterThan(gradeUnsolved.assetValue);
  });
});

describe('mastermind bot generation at maximum colors and slots', () => {
  it('produces deterministic bounded legal sequences ending in the secret', () => {
    const puz: mastermind.MastermindPuzzle = { colors: 12, slots: 8, maxTries: 30 };
    const solution: mastermind.MastermindSolution = { code: [0, 1, 2, 3, 4, 5, 6, 7] };

    for (const diff of ['easy', 'normal', 'hard'] as const) {
      const seqA = mastermind.generateBotGuesses(puz, solution, diff, 777);
      const seqB = mastermind.generateBotGuesses(puz, solution, diff, 777);

      // Deterministic
      expect(seqA).toEqual(seqB);

      // Bounded within maxTries
      expect(seqA.length).toBeLessThanOrEqual(puz.maxTries);
      expect(seqA.length).toBeGreaterThanOrEqual(1);

      // Every guess is legal
      for (let i = 0; i < seqA.length; i++) {
        const guess = seqA[i]!;
        expect(guess.length).toBe(puz.slots);
        for (const col of guess) {
          expect(col).toBeGreaterThanOrEqual(0);
          expect(col).toBeLessThan(puz.colors);
        }
        // Intermediate guesses must NOT equal the secret
        if (i < seqA.length - 1) {
          expect(guess).not.toEqual(solution.code);
        }
      }

      // Final guess must be the exact secret
      expect(seqA[seqA.length - 1]).toEqual(solution.code);
    }
  });
});
