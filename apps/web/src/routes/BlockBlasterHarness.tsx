import * as React from 'react';
import {
  blockBlaster,
  type BlockBlasterAction,
  type BlockBlasterState,
  type BlockBlasterView,
} from '@puzzle-arena/games';
import {
  BLOCK_BLASTER_DIFFICULTIES,
  BLOCK_BLASTER_LAYOUTS,
  type BlockBlasterDifficulty,
  type BlockBlasterLayout,
} from '@puzzle-arena/shared';
import { BlockBlasterBoard } from '../games/BlockBlasterBoard.js';

/**
 * Dev proof surface for Brick Blaster (like /dev/bubble, /dev/pacman):
 * Drives the real engine locally without server roundtrips.
 * Used to verify drag-drop placement, bonus bomb blocks, cluster & cross bomb detonation FX,
 * line clearing particle FX, combo multipliers, and audio.
 */
export default function BlockBlasterHarness(): React.ReactElement {
  const [difficulty, setDifficulty] = React.useState<BlockBlasterDifficulty>('normal');
  const [layout, setLayout] = React.useState<BlockBlasterLayout>('templated');
  const [state, setState] = React.useState<BlockBlasterState>(() =>
    blockBlaster.setup(['p1'], (Date.now() ^ (Math.random() * 0xffffffff)) & 0xffffffff, {
      difficulty: 'normal',
      startingLayout: 'templated',
    }),
  );

  const onAction = React.useCallback((action: unknown) => {
    setState((prev) => {
      const result = blockBlaster.reduce(prev, 'p1', action as BlockBlasterAction);
      return result.ok ? result.state : prev;
    });
  }, []);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__blockblaster = state;
    (window as unknown as Record<string, unknown>).__setBlockBlasterState = setState;
  }, [state]);

  const p = state.players[0]!;

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-2 sm:p-4 bg-pa-bg text-pa-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-4xl mb-2 pb-2 border-b border-pa-border">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-pa-cyan">
            BRICK BLASTER HARNESS
          </span>
          <span className="text-xs text-pa-ink-dim">
            (Score: {p.score} | Combo: ×{p.comboStreak} | Lines: {p.linesCleared} | Bombs: {p.bombs.length})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Difficulty"
            value={difficulty}
            onChange={(e) => {
              const d = e.target.value as BlockBlasterDifficulty;
              setDifficulty(d);
              setState(blockBlaster.setup(['p1'], Date.now() & 0xffffffff, { difficulty: d, startingLayout: layout }));
            }}
            className="bg-pa-surface border border-pa-border text-xs px-2 py-1 font-display uppercase"
          >
            {BLOCK_BLASTER_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{d.toUpperCase()}</option>
            ))}
          </select>

          <select
            aria-label="Starting Board"
            value={layout}
            onChange={(e) => {
              const l = e.target.value as BlockBlasterLayout;
              setLayout(l);
              setState(blockBlaster.setup(['p1'], Date.now() & 0xffffffff, { difficulty, startingLayout: l }));
            }}
            className="bg-pa-surface border border-pa-border text-xs px-2 py-1 font-display uppercase"
          >
            {BLOCK_BLASTER_LAYOUTS.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>

          <button
            type="button"
            className="border-2 border-pa-border bg-pa-surface px-3 py-1 text-xs font-display uppercase tracking-wider hover:border-pa-cyan cursor-pointer"
            onClick={() => setState(blockBlaster.setup(['p1'], Date.now() & 0xffffffff, { difficulty, startingLayout: layout }))}
          >
            NEW GAME
          </button>
          <button
            type="button"
            title="Add a 3x3 Cluster Bomb to inventory"
            className="border-2 border-orange-500 bg-orange-950/60 text-orange-300 px-2 py-1 text-xs font-display uppercase tracking-wider hover:bg-orange-900 cursor-pointer"
            onClick={() => {
              setState((prev) => {
                const next = structuredClone(prev);
                next.players[0]!.bombs.push('cluster');
                return next;
              });
            }}
          >
            + 💣 CLUSTER
          </button>

          <button
            type="button"
            title="Add a Cross Bomb to inventory"
            className="border-2 border-purple-500 bg-purple-950/60 text-purple-300 px-2 py-1 text-xs font-display uppercase tracking-wider hover:bg-purple-900 cursor-pointer"
            onClick={() => {
              setState((prev) => {
                const next = structuredClone(prev);
                next.players[0]!.bombs.push('cross');
                return next;
              });
            }}
          >
            + ⚡ CROSS
          </button>

          <button
            type="button"
            title="Spawn a bonus bomb block on the board"
            className="border-2 border-yellow-500 bg-yellow-950/60 text-yellow-300 px-2 py-1 text-xs font-display uppercase tracking-wider hover:bg-yellow-900 cursor-pointer"
            onClick={() => {
              setState((prev) => {
                const next = structuredClone(prev);
                next.players[0]!.bonusBomb = { row: 3, col: 3, type: 'cluster' };
                next.players[0]!.board[3]![3] = '#f97316';
                return next;
              });
            }}
          >
            + 🎁 BONUS BLOCK
          </button>
        </div>
      </div>
      <BlockBlasterBoard
        view={blockBlaster.view(state, 'p1') as unknown as BlockBlasterView}
        players={[]}
        youId="p1"
        legalActions={['place', 'restart']}
        turnEndsAt={null}
        onAction={onAction}
      />
    </main>
  );
}
