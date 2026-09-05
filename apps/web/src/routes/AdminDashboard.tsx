import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Activity, BarChart2, Copy, Cpu, Link2, LogOut, Plus, Shield, Trash2, Users, XCircle } from 'lucide-react';
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

interface AuditUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
}

interface AuditSession {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

interface AuditRoom {
  id: string;
  code: string;
  gameId: string;
  status: string;
  hostUserId: string;
  hostUserName: string | null;
  hostUserEmail: string | null;
  createdAt: string;
}

interface AuditData {
  users: AuditUser[];
  sessions: AuditSession[];
  rooms: AuditRoom[];
}

export default function AdminDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [gameId, setGameId] = React.useState<GameId>('sudoku');
  const [difficulty, setDifficulty] = React.useState('medium');
  const [minutes, setMinutes] = React.useState<number | string>(15);
  const [instantFeedback, setInstantFeedback] = React.useState(false);
  const [theme, setTheme] = React.useState<string>(WORD_SEARCH_THEMES[0]);
  const [size, setSize] = React.useState('10');
  const [clockMinutes, setClockMinutes] = React.useState<number | string>(10);
  const [incrementSec, setIncrementSec] = React.useState<number | string>(0);
  const [allowTakeback, setAllowTakeback] = React.useState(true);
  const [rooms, setRooms] = React.useState<RoomRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [auditData, setAuditData] = React.useState<AuditData | null>(null);
  const [auditTab, setAuditTab] = React.useState<'sessions' | 'users' | 'rooms'>('sessions');

  const meta = GAME_REGISTRY[gameId];
  const isPuzzle = meta.kind === 'puzzle';

  const refresh = React.useCallback(async () => {
    const [roomsRes, auditRes] = await Promise.all([
      api<{ rooms: RoomRow[]; error?: string }>('/api/rooms'),
      api<AuditData>('/api/admin/audit'),
    ]);
    if (roomsRes.status === 401 || auditRes.status === 401) {
      navigate('/admin/login');
      return;
    }
    setRooms(roomsRes.body.rooms ?? []);
    if (auditRes.status === 200 && auditRes.body) {
      setAuditData(auditRes.body);
    }
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
    if (gameId === 'chess' || gameId === 'xiangqi') {
      config['clockMinutes'] = Math.min(120, Math.max(1, Math.round(Number(clockMinutes)) || 1));
      config['incrementSec'] = Math.min(60, Math.max(0, Math.round(Number(incrementSec)) || 0));
      config['allowTakeback'] = allowTakeback;
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

  const closeRoom = async (roomId: string): Promise<void> => {
    const res = await api<{ ok?: boolean; error?: string }>(`/api/rooms/${roomId}/close`, {
      method: 'POST',
    });
    if (res.status === 200) {
      toast('ROOM CLOSED');
      void refresh();
    } else {
      toast(res.body?.error ?? 'Could not close room');
    }
  };

  const deleteRoom = async (roomId: string): Promise<void> => {
    const res = await api<{ ok?: boolean; error?: string }>(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
    if (res.status === 200) {
      toast('ROOM DELETED');
      void refresh();
    } else {
      toast(res.body?.error ?? 'Could not delete room');
    }
  };
  const signOut = async (): Promise<void> => {
    await api('/api/auth/sign-out', { method: 'POST' });
    navigate('/admin/login');
  };

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[18px]">Host dashboard</h1>
        <div className="flex gap-2">
          <PixelButton variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut size={16} strokeWidth={3} className="lucide" />
            Sign out
          </PixelButton>
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
          {(gameId === 'chess' || gameId === 'xiangqi') && (
            <>
              <PixelInput
                label="Clock (minutes per player)"
                type="number"
                min={1}
                max={120}
                value={clockMinutes}
                onChange={(e) => setClockMinutes(e.target.value)}
                onBlur={() => {
                  const n = Number(clockMinutes);
                  if (!n || n < 1) setClockMinutes(1);
                  else if (n > 120) setClockMinutes(120);
                  else setClockMinutes(Math.round(n));
                }}
              />
              <PixelInput
                label="Increment (seconds per move)"
                type="number"
                min={0}
                max={60}
                value={incrementSec}
                onChange={(e) => setIncrementSec(e.target.value)}
                onBlur={() => {
                  const n = Number(incrementSec);
                  if (Number.isNaN(n) || n < 0) setIncrementSec(0);
                  else if (n > 60) setIncrementSec(60);
                  else setIncrementSec(Math.round(n));
                }}
              />
            </>
          )}
        </div>

        {(gameId === 'chess' || gameId === 'xiangqi') && (
          <label className="mt-4 flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowTakeback}
              onChange={(e) => setAllowTakeback(e.target.checked)}
              className="w-5 h-5 accent-[var(--color-pa-cyan)]"
            />
            <span className="text-[13px]">
              Allow takeback requests
              <span className="text-pa-ink-dim"> (time already spent is not refunded)</span>
            </span>
          </label>
        )}

        <p className="mt-4 text-[13px] text-pa-ink-dim">
          {(gameId === 'chess' || gameId === 'xiangqi')
            ? `Each move also has a hard 4-minute cap regardless of the clock — the player is warned at 1/2/3 minutes of idling and forfeits the move at 4.`
            : ''}
          {meta.blurb}
        </p>

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

      <PixelPanel title="Your rooms (last 10)">
        {rooms.length === 0 ? (
          <p className="text-pa-ink-dim text-[13px]">Nothing yet — create a room above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => {
              const isActive = room.status === 'lobby' || room.status === 'running';
              return (
                <li key={room.id}>
                  <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-display text-[14px] tabular tracking-wider">{room.code}</span>
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
                    <div className="flex gap-2 flex-wrap items-center">
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
                      {isActive ? (
                        <>
                          <PixelButton size="sm" onClick={() => navigate(`/r/${room.code}`)}>
                            Open
                          </PixelButton>
                          <PixelButton
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              if (window.confirm('Close this room for everyone?')) {
                                void closeRoom(room.id);
                              }
                            }}
                          >
                            <XCircle size={14} strokeWidth={3} className="lucide" />
                            Close
                          </PixelButton>
                        </>
                      ) : (
                        <>
                          <PixelButton
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/r/${room.code}/results`)}
                          >
                            <BarChart2 size={14} strokeWidth={3} className="lucide" />
                            Results
                          </PixelButton>
                          <PixelButton
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (window.confirm('Delete this room? This cannot be undone.')) {
                                void deleteRoom(room.id);
                              }
                            }}
                            className="text-pa-danger hover:bg-pa-danger/10"
                          >
                            <Trash2 size={14} strokeWidth={3} className="lucide" />
                            Delete
                          </PixelButton>
                        </>
                      )}
                    </div>
                  </PixelCard>
                </li>
              );
            })}
          </ul>
        )}
      </PixelPanel>

      <PixelPanel title="Admin Monitoring & Sign-in Activity">
        <div className="flex flex-wrap gap-2 mb-4">
          <PixelButton
            size="sm"
            variant={auditTab === 'sessions' ? 'primary' : 'ghost'}
            onClick={() => setAuditTab('sessions')}
          >
            <Activity size={14} strokeWidth={3} className="lucide" />
            Sign-in Sessions ({auditData?.sessions.length ?? 0})
          </PixelButton>
          <PixelButton
            size="sm"
            variant={auditTab === 'users' ? 'primary' : 'ghost'}
            onClick={() => setAuditTab('users')}
          >
            <Users size={14} strokeWidth={3} className="lucide" />
            Registered Users ({auditData?.users.length ?? 0})
          </PixelButton>
          <PixelButton
            size="sm"
            variant={auditTab === 'rooms' ? 'primary' : 'ghost'}
            onClick={() => setAuditTab('rooms')}
          >
            <Shield size={14} strokeWidth={3} className="lucide" />
            Hosted Rooms ({auditData?.rooms.length ?? 0})
          </PixelButton>
        </div>

        {!auditData ? (
          <p className="text-pa-ink-dim text-[13px]">Loading monitoring logs…</p>
        ) : auditTab === 'sessions' ? (
          auditData.sessions.length === 0 ? (
            <p className="text-pa-ink-dim text-[13px]">No active or recorded sessions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-pa-line text-pa-ink-dim uppercase text-[11px] font-mono">
                    <th className="p-2">User</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">IP Address</th>
                    <th className="p-2">Device / Browser</th>
                    <th className="p-2">Sign-in Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.sessions.map((s) => (
                    <tr key={s.id} className="border-b border-pa-line/40 hover:bg-pa-panel-dim/40">
                      <td className="p-2 font-medium">{s.userName ?? 'Unknown'}</td>
                      <td className="p-2 text-pa-cyan font-mono text-[12px]">{s.userEmail ?? s.userId}</td>
                      <td className="p-2 font-mono text-[12px]">{s.ipAddress ?? '—'}</td>
                      <td className="p-2 text-pa-ink-dim max-w-[220px] truncate text-[11px]" title={s.userAgent ?? ''}>
                        {s.userAgent ?? '—'}
                      </td>
                      <td className="p-2 text-pa-ink-dim whitespace-nowrap text-[12px]">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : auditTab === 'users' ? (
          auditData.users.length === 0 ? (
            <p className="text-pa-ink-dim text-[13px]">No users registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-pa-line text-pa-ink-dim uppercase text-[11px] font-mono">
                    <th className="p-2">Name</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.users.map((u) => (
                    <tr key={u.id} className="border-b border-pa-line/40 hover:bg-pa-panel-dim/40">
                      <td className="p-2 font-medium">{u.name}</td>
                      <td className="p-2 text-pa-cyan font-mono text-[12px]">{u.email}</td>
                      <td className="p-2 text-pa-ink-dim whitespace-nowrap text-[12px]">
                        {new Date(u.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          auditData.rooms.length === 0 ? (
            <p className="text-pa-ink-dim text-[13px]">No hosted rooms recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-pa-line text-pa-ink-dim uppercase text-[11px] font-mono">
                    <th className="p-2">Code</th>
                    <th className="p-2">Game</th>
                    <th className="p-2">Host Name</th>
                    <th className="p-2">Host Email</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.rooms.map((r) => (
                    <tr key={r.id} className="border-b border-pa-line/40 hover:bg-pa-panel-dim/40">
                      <td className="p-2 font-display tabular tracking-wider">{r.code}</td>
                      <td className="p-2">{GAME_REGISTRY[r.gameId as GameId]?.title ?? r.gameId}</td>
                      <td className="p-2 font-medium">{r.hostUserName ?? 'Unknown'}</td>
                      <td className="p-2 text-pa-cyan font-mono text-[12px]">{r.hostUserEmail ?? r.hostUserId}</td>
                      <td className="p-2">
                        <PixelBadge tone={r.status === 'running' ? 'success' : r.status === 'lobby' ? 'cyan' : 'default'}>
                          {r.status}
                        </PixelBadge>
                      </td>
                      <td className="p-2 text-pa-ink-dim whitespace-nowrap text-[12px]">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </PixelPanel>
    </main>
  );
}
