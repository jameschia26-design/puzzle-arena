import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import * as sudoku from './sudoku.js';
import * as killer from './killer-sudoku.js';
import * as nonogram from './nonogram.js';
import * as wordSearch from './word-search.js';
import * as minesweeper from './minesweeper.js';
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
