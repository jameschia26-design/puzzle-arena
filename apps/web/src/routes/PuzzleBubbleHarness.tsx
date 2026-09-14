import * as React from 'react';
import { puzzleBubble, type PuzzleBubbleAction, type PuzzleBubbleState, type PuzzleBubbleView } from '@puzzle-arena/games';
import { PuzzleBubbleBoard } from '../games/PuzzleBubbleBoard.js';

/**
 * Dev-only Puzzle Bubble proof surface (like /dev/pacman): drives the real
 * engine locally, no server. Used to verify playfield geometry (grid fills the
 * playfield, shots bank off the drawn walls) and that a burst only fires after
 * its bubble has finished flying. Live state is exposed on `window.__bubble`.
 */
export default function PuzzleBubbleHarness(): React.ReactElement {
  const [state, setState] = React.useState<PuzzleBubbleState>(() => puzzleBubble.setup(['p1'], 20260914, { colors: 5, speed: 'normal' }));
  const onAction = React.useCallback((action: PuzzleBubbleAction) => {
    setState((prev) => {
      const result = puzzleBubble.reduce(prev, 'p1', action);
      return result.ok ? result.state : prev;
    });
  }, []);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__bubble = state;
  }, [state]);

  const player = state.players[0]!;
  return (
    <main className="flex min-h-screen flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="border-2 border-pa-border bg-pa-surface px-3 py-1 text-xs"
          onClick={() => setState(puzzleBubble.setup(['p1'], Date.now() & 0xffffffff, { colors: 5, speed: 'normal' }))}
        >RESTART</button>
        <button
          type="button"
          className="border-2 border-pa-border bg-pa-surface px-3 py-1 text-xs"
          onClick={() => onAction({ type: 'descent' })}
        >DESCEND</button>
        <span className="font-body text-xs text-pa-ink-dim">
          shots={player.shots} popped={player.bubblesPopped} dropped={player.bubblesDropped} rows={player.board.length} over={String(player.gameOver)}
        </span>
      </div>
      <PuzzleBubbleBoard
        view={puzzleBubble.view(state, 'p1') as unknown as PuzzleBubbleView}
        players={[]}
        youId="p1"
        legalActions={[]}
        turnEndsAt={null}
        onAction={onAction}
      />
    </main>
  );
}
