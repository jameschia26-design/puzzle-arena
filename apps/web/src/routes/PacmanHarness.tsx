import * as React from 'react';
import { pacman, type PacManState, type PacManView } from '@puzzle-arena/games';
import { PacManBoard } from '../games/PacManBoard.js';

/**
 * Dev-only Pac-Man proof surface (like /ui): drives the real engine locally,
 * no server. Exposes the live state on `window.__pac` and offers a FORCE
 * DEATH button that teleports Blinky onto Pac-Man so life loss, the dying
 * countdown, respawn on remaining lives and continued play can be verified
 * deterministically in the browser.
 */
export default function PacmanHarness(): React.ReactElement {
  const [state, setState] = React.useState<PacManState>(() => pacman.setup(['p1'], 20260831, {}));
  const onAction = React.useCallback((a: unknown) => {
    setState((prev) => {
      const r = pacman.reduce(prev, 'p1', a as never);
      return r.ok ? r.state : prev;
    });
  }, []);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__pac = state;
  }, [state]);

  const forceDeath = () => {
    setState((prev) => {
      const next = structuredClone(prev);
      const p = next.players[0]!;
      p.ghosts[0]!.pos = { ...p.pacPos }; // Blinky lands on Pac-Man, not frightened
      return next;
    });
  };

  return (
    <main className="min-h-screen flex flex-col p-2 gap-2">
      <div className="flex gap-2 items-center">
        <button type="button" className="border-2 border-pa-border bg-pa-surface px-3 py-1 text-xs" onClick={() => setState(pacman.setup(['p1'], Date.now() & 0xffffffff, {}))}>
          RESTART
        </button>
        <button type="button" className="border-2 border-pa-danger bg-pa-surface px-3 py-1 text-xs text-pa-danger" onClick={forceDeath}>
          FORCE DEATH
        </button>
        <span className="text-pa-ink-dim text-xs font-body">
          lives={state.players[0]?.lives ?? 0} gameOver={String(state.players[0]?.gameOver)}
        </span>
      </div>
      <PacManBoard
        view={pacman.view(state, 'p1') as unknown as PacManView}
        players={[]}
        youId="p1"
        legalActions={[]}
        turnEndsAt={null}
        onAction={onAction}
      />
    </main>
  );
}
