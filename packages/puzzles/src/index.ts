export * from './core/solver.js';
export * from './word-lists.js';

export * as sudoku from './sudoku.js';
export * as killerSudoku from './killer-sudoku.js';
export * as nonogram from './nonogram.js';
export * as wordSearch from './word-search.js';

export type { GradeResult, PuzzleMeta } from './sudoku.js';
export type { SudokuPuzzle, SudokuSolution } from './sudoku.js';
export type { KillerCage, KillerPuzzle, KillerSolution } from './killer-sudoku.js';
export type { NonogramPuzzle, NonogramSolution, NonogramSize } from './nonogram.js';
export type {
  Placement,
  WordSearchPuzzle,
  WordSearchSolution,
  WordSearchGrade,
} from './word-search.js';
