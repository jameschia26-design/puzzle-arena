import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@puzzle-arena/shared': r('./packages/shared/src/index.ts'),
      '@puzzle-arena/puzzles': r('./packages/puzzles/src/index.ts'),
      '@puzzle-arena/games': r('./packages/games/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
