import * as React from 'react';
import {
  blockBlaster,
  type BlockBlasterAction,
  type BlockBlasterState,
  type BlockBlasterView,
} from '@puzzle-arena/games';
import { BlockBlasterBoard } from '../games/BlockBlasterBoard.js';

/**
 * Dev proof surface for Block Blaster (like /dev/bubble, /dev/pacman):
 * Drives the real engine locally without server roundtrips.
 * Used to verify drag-drop placement, ghost previews, line clearing particle FX,
 * combo multipliers, and audio pitch modulation.
 */
export default function BlockBlasterHarness(): React.ReactElement {
  const [state, setState] = React.useState<BlockBlasterState>(() =>
    blockBlaster.setup(['p1'], 20260914, {}),
  );

  const onAction = React.useCallback((action: unknown) => {
    setState((prev) => {
      const result = blockBlaster.reduce(prev, 'p1', action as BlockBlasterAction);
      return result.ok ? result.state : prev;
    });
  }, []);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__blockblaster = state;
  }, [state]);

  const p = state.players[0]!;

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-2 sm:p-4 bg-pa-bg text-pa-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-4xl mb-2 pb-2 border-b border-pa-border">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-pa-cyan">
            BLOCK BLASTER HARNESS
          </span>
          <span className="text-xs text-pa-ink-dim">
            (Score: {p.score} | Combo: ×{p.comboStreak} | Lines: {p.linesCleared})
          </span>
        </div>

        <button
          type="button"
          className="border-2 border-pa-border bg-pa-surface px-3 py-1 text-xs font-display uppercase tracking-wider hover:border-pa-cyan cursor-pointer"
          onClick={() => setState(blockBlaster.setup(['p1'], Date.now() & 0xffffffff, {}))}
        >
          NEW GAME
        </button>
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
