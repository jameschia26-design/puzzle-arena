import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Cpu, Link2, Plus } from 'lucide-react';
import { GAME_IDS, GAME_REGISTRY, WORD_SEARCH_THEMES, type GameId } from '@puzzle-arena/shared';
import {
  PixelBadge,
  PixelButton,
  PixelCard,
  PixelInput,
  PixelPanel,
  PixelSelect,
} from '../ui/primitives.js';
import { api } from '../net/socket.js';

interface RoomRow {
  id: string;
  code: string;
  gameId: string;
  status: string;
  timeLimitSec: number;
  createdAt: string;
}

export default function AdminDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [gameId, setGameId] = React.useState<GameId>('sudoku');
  const [difficulty, setDifficulty] = React.useState('medium');
  const [minutes, setMinutes] = React.useState<number | string>(15);
  const [instantFeedback, setInstantFeedback] = React.useState(false);
  const [theme, setTheme] = React.useState<string>(WORD_SEARCH_THEMES[0]);
  const [size, setSize] = React.useState('10');
  const [rooms, setRooms] = React.useState<RoomRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const meta = GAME_REGISTRY[gameId];
  const isPuzzle = meta.kind === 'puzzle';

  const refresh = React.useCallback(async () => {
    const res = await api<{ rooms: RoomRow[]; error?: string }>('/api/rooms');
    if (res.status === 401) {
      navigate('/admin/login');
      return;
    }
    setRooms(res.body.rooms ?? []);
  }, [navigate]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    setMinutes(Math.round(GAME_REGISTRY[gameId].defaultTimeLimitSec / 60));
  }, [gameId]);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const config: Record<string, unknown> = {};
    if (isPuzzle) {
      config['difficulty'] = difficulty;
      config['instantFeedback'] = instantFeedback;
    }
    if (gameId === 'nonogram') config['size'] = Number(size);
    if (gameId === 'word-search') {
      config['theme'] = theme;
      config['size'] = 14;
    }

    const effectiveMinutes = Math.min(240, Math.max(1, Math.round(Number(minutes)) || 1));
    const res = await api<{ code?: string; error?: string }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ gameId, config, timeLimitSec: effectiveMinutes * 60 }),
    });
    setBusy(false);
    if (res.status !== 200 || !res.body.code) {
      setError(res.body?.error ?? 'Could not create the room');
      return;
    }
    await refresh();
    navigate(`/r/${res.body.code}`);
  };

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[18px]">Host dashboard</h1>
        <div className="flex gap-2">
          <Link to="/admin/ai">
            <PixelButton variant="ghost" size="sm">
              <Cpu size={16} strokeWidth={3} className="lucide" />
              AI providers
            </PixelButton>
          </Link>
        </div>
      </header>

      <PixelPanel title="New room">
        <div className="grid gap-4 md:grid-cols-2">
          <PixelSelect
            label="Game"
            value={gameId}
            onValueChange={(v) => setGameId(v as GameId)}
            options={GAME_IDS.map((id) => ({ value: id, label: GAME_REGISTRY[id].title }))}
          />
          <PixelInput
            label="Time limit (minutes)"
            type="number"
            min={1}
            max={240}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => {
              const n = Number(minutes);
              if (!n || n < 1) setMinutes(1);
              else if (n > 240) setMinutes(240);
              else setMinutes(Math.round(n));
            }}
          />

          {isPuzzle && (
            <PixelSelect
              label="Difficulty"
              value={difficulty}
              onValueChange={setDifficulty}
              options={[
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
                { value: 'expert', label: 'Expert' },
              ]}
            />
          )}
          {gameId === 'nonogram' && (
            <PixelSelect
              label="Grid size"
              value={size}
              onValueChange={setSize}
              options={[
                { value: '10', label: '10 x 10' },
                { value: '15', label: '15 x 15' },
                { value: '20', label: '20 x 20' },
              ]}
            />
          )}
          {gameId === 'word-search' && (
            <PixelSelect
              label="Theme"
              value={theme}
              onValueChange={setTheme}
              options={WORD_SEARCH_THEMES.map((t) => ({ value: t, label: t }))}
            />
          )}
        </div>

        <p className="mt-4 text-[13px] text-pa-ink-dim">{meta.blurb}</p>

        {isPuzzle && (
          <label className="mt-4 flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={instantFeedback}
              onChange={(e) => setInstantFeedback(e.target.checked)}
              className="w-5 h-5 accent-[var(--color-pa-cyan)]"
            />
            <span className="text-[13px]">
              Instant feedback — tell players whether each entry is correct
              <span className="text-pa-ink-dim"> (off by default)</span>
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-4 text-pa-danger text-[13px]">
            {error}
          </p>
        )}

        <div className="mt-6">
          <PixelButton size="lg" onClick={() => void create()} disabled={busy}>
            <Plus size={16} strokeWidth={3} className="lucide" />
            {busy ? 'Creating…' : 'Create room'}
          </PixelButton>
        </div>
      </PixelPanel>

      <PixelPanel title="Your rooms">
        {rooms.length === 0 ? (
          <p className="text-pa-ink-dim text-[13px]">Nothing yet — create a room above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.id}>
                <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-[14px] tabular">{room.code}</span>
                    <span className="text-[13px] text-pa-ink-dim">
                      {GAME_REGISTRY[room.gameId as GameId]?.title ?? room.gameId}
                    </span>
                    <PixelBadge
                      tone={
                        room.status === 'running'
                          ? 'success'
                          : room.status === 'lobby'
                            ? 'cyan'
                            : 'default'
                      }
                    >
                      {room.status}
                    </PixelBadge>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <PixelButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(room.code);
                        toast('CODE COPIED');
                      }}
                    >
                      <Copy size={14} strokeWidth={3} className="lucide" />
                      Code
                    </PixelButton>
                    <PixelButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const url = `${window.location.origin}/r/${room.code}`;
                        void navigator.clipboard.writeText(url);
                        toast('LINK COPIED');
                      }}
                    >
                      <Link2 size={14} strokeWidth={3} className="lucide" />
                      Link
                    </PixelButton>
                    <PixelButton size="sm" onClick={() => navigate(`/r/${room.code}`)}>
                      Open
                    </PixelButton>
                  </div>
                </PixelCard>
              </li>
            ))}
          </ul>
        )}
      </PixelPanel>
    </main>
  );
}
