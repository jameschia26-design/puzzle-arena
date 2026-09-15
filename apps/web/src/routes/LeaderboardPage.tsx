import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GAME_REGISTRY, type LeaderboardGameId } from '@puzzle-arena/shared';
import { PixelButton, PixelPanel } from '../ui/primitives.js';
import { api } from '../net/socket.js';

/** The four score-attack arcade games the global leaderboard covers. Declared
 * explicitly rather than derived from the full registry — this feature is
 * intentionally scoped to just these. */
const LEADERBOARD_TABS: LeaderboardGameId[] = ['pacman', 'tetris', 'block-blaster', 'space-invaders'];

interface LeaderboardEntry {
  rank: number;
  displayName: string;
  email: string;
  score: number;
  playedAt: string;
}

export default function LeaderboardPage(): React.ReactElement {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const activeGameId: LeaderboardGameId = LEADERBOARD_TABS.includes(gameId as LeaderboardGameId)
    ? (gameId as LeaderboardGameId)
    : 'pacman';
  const [entries, setEntries] = React.useState<LeaderboardEntry[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);

  React.useEffect(() => {
    setEntries(null);
    setLoadError(false);
    void (async () => {
      const res = await api<{ entries: LeaderboardEntry[] }>(
        `/api/leaderboard/${activeGameId}?limit=50`,
      );
      if (res.status !== 200) {
        setLoadError(true);
        return;
      }
      setEntries(res.body.entries ?? []);
    })();
  }, [activeGameId]);

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="font-display text-pa-cyan" style={{ fontSize: 'clamp(20px, 6vw, 32px)' }}>
        GLOBAL LEADERBOARD
      </h1>
      <div className="flex flex-wrap gap-2">
        {LEADERBOARD_TABS.map((id) => (
          <PixelButton
            key={id}
            variant={id === activeGameId ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => navigate(`/leaderboard/${id}`)}
          >
            {GAME_REGISTRY[id].title}
          </PixelButton>
        ))}
      </div>
      <PixelPanel title={`${GAME_REGISTRY[activeGameId].title} — Top Scores`}>
        {loadError ? (
          <p className="text-pa-ink-dim">Could not load the leaderboard.</p>
        ) : entries === null ? (
          <p className="text-pa-ink-dim">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-pa-ink-dim">No scores yet. Be the first to set one.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b-2 border-pa-border text-left text-pa-ink-dim">
                <th className="py-2 pr-2 font-display text-[10px] uppercase">Rank</th>
                <th className="py-2 pr-2 font-display text-[10px] uppercase">Player</th>
                <th className="py-2 pr-2 font-display text-[10px] uppercase">Email</th>
                <th className="py-2 pl-2 font-display text-[10px] uppercase text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.rank} className="border-b border-pa-border">
                  <td className="py-2 pr-2 font-display tabular text-[12px]">{entry.rank}</td>
                  <td className="py-2 pr-2 truncate max-w-[10rem]">{entry.displayName}</td>
                  <td className="py-2 pr-2 text-pa-ink-dim">{entry.email}</td>
                  <td className="py-2 pl-2 text-right font-display tabular text-pa-cyan">
                    {entry.score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PixelPanel>
      <PixelButton
        variant="secondary"
        className="self-start"
        onClick={() => navigate('/')}
      >
        Back to home
      </PixelButton>
    </main>
  );
}
