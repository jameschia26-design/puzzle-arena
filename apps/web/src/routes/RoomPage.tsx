import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Bot, Copy, Lightbulb, Link2, Menu, Pause, Play, RotateCcw, Send, Settings, Trash2, User, X } from 'lucide-react';
import {
  AVATAR_EMOJI,
  BOT_DIFFICULTIES,
  EV,
  GAME_REGISTRY,
  type BotDifficulty,
  type GameId,
  type PlayerView,
} from '@puzzle-arena/shared';
import {
  PixelBadge,
  PixelButton,
  PixelCard,
  PixelInput,
  PixelPanel,
  PixelPopover,
  PixelTooltip,
  SegmentedProgress,
} from '../ui/primitives.js';
import { Countdown, SeatAvatar, StartOverlay } from '../ui/game-bits.js';
import { CrtToggle } from '../ui/crt.js';
import { cn } from '../ui/cn.js';
import { ROW_REORDER_MS, stepTransition, useReducedMotion } from '../ui/motion.js';
import { seatColor } from '../ui/seat.js';
import { api, emit, ensureGuest, getSocket, useRoom } from '../net/socket.js';
import { SudokuBoard } from '../games/SudokuBoard.js';
import { NonogramBoard } from '../games/NonogramBoard.js';
import { WordSearchBoard } from '../games/WordSearchBoard.js';
import { PropertyTycoonBoard } from '../games/PropertyTycoonBoard.js';
import { ManorMysteryBoard } from '../games/ManorMysteryBoard.js';
import { ScrabbleBoard } from '../games/ScrabbleBoard.js';
import { CongkakBoard } from '../games/CongkakBoard.js';
import { CheckersBoard } from '../games/CheckersBoard.js';
import { BigTwoBoard } from '../games/BigTwoBoard.js';
import { MinesweeperBoard } from '../games/MinesweeperBoard.js';
import { ReversiBoard } from '../games/ReversiBoard.js';
import { Connect4Board } from '../games/Connect4Board.js';
import ChessBoard from '../games/ChessBoard.js';
import XiangqiBoard from '../games/XiangqiBoard.js';
import { AnimalChessBoard } from '../games/AnimalChessBoard.js';
import { TetrisBoard } from '../games/TetrisBoard.js';
import { PacManBoard } from '../games/PacManBoard.js';
import { SpaceInvadersBoard } from '../games/SpaceInvadersBoard.js';
import { BombermanBoard } from '../games/BombermanBoard.js';
import { ResultsTable } from './ResultsPage.js';
import { SoundControlButtons, bgm, sfx } from '../ui/sound.js';


/* ------------------------------------------------------------------ */
/* Game Surface Error Boundary                                         */
/* ------------------------------------------------------------------ */

class GameErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Game board error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <PixelPanel title="Game Surface Error" className="p-4">
          <div className="flex flex-col gap-3">
            <p className="text-pa-danger text-[13px]">
              A rendering error occurred in this game board ({this.state.error?.message ?? 'Unknown error'}).
            </p>
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RotateCcw size={14} strokeWidth={3} className="lucide" />
              Reload game surface
            </PixelButton>
          </div>
        </PixelPanel>
      );
    }
    return this.props.children;
  }
}
export default function RoomPage(): React.ReactElement {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const store = useRoom();
  const [name, setName] = React.useState(
    () => localStorage.getItem('pa:name') ?? '',
  );
  const [avatar, setAvatar] = React.useState<string | null>(
    () => localStorage.getItem('pa:avatar'),
  );
  const [joined, setJoined] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [mobileTab, setMobileTab] = React.useState<'board' | 'leaderboard' | 'chat'>('board');
  const [inGameMode, setInGameMode] = React.useState(true);

  const join = React.useCallback(
    async (displayName: string, chosenAvatar: string | null) => {
      await ensureGuest();
      getSocket();
      const res = await emit<{ error?: string; snapshot?: any }>(EV.roomJoin, {
        code: code.toUpperCase(),
        displayName,
        ...(chosenAvatar ? { avatar: chosenAvatar } : {}),
      });
      if (res.error) {
        // A finished or abandoned room is a dead end for room:join — send the
        // player to the results page instead of leaving them stuck on a bare
        // error with no way back.
        if (res.error === 'That room has finished') {
          navigate(`/r/${code.toUpperCase()}/results`, { replace: true });
          return;
        }
        setJoinError(res.error);
        return;
      }
      if (res.snapshot) store.applySnapshot(res.snapshot);
      setJoined(true);
      localStorage.setItem('pa:name', displayName);
      if (chosenAvatar) localStorage.setItem('pa:avatar', chosenAvatar);
    },
    [code, store],
  );

  // Auto-rejoin when we already have a name (covers reconnects and refreshes).
  React.useEffect(() => {
    if (!joined && name.trim().length >= 1) void join(name.trim(), avatar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const room = store.room;
  const gameId = (room?.gameId ?? 'sudoku') as GameId;
  const meta = GAME_REGISTRY[gameId];
  const you = store.you;
  const isHost = you?.isHost ?? false;
  const isFullscreenEligible = (gameId === 'tetris' || gameId === 'pacman' || gameId === 'space-invaders' || gameId === 'bomberman') && room?.status === 'running';
  const isGameFullscreen = isFullscreenEligible && inGameMode;

  React.useEffect(() => {
    if (room?.status === 'running') {
      setInGameMode(true);
    }
  }, [room?.status, room?.id]);
  // Play game-specific background music when room is active
  React.useEffect(() => {
    if (!room) return;
    if (room.status === 'running') {
      if (store.paused) bgm.stop();
      else if (gameId === 'animal-chess') bgm.play('animalchess');
      else if (gameId === 'property-tycoon') bgm.play('property');
      else if (gameId === 'manor-mystery') bgm.play('mystery');
      else if (gameId === 'reversi' || gameId === 'connect4' || gameId === 'minesweeper') bgm.play('arcade');
      else if (gameId === 'sudoku' || gameId === 'killer-sudoku' || gameId === 'nonogram') bgm.play('zen');
      else if (gameId === 'congkak') bgm.play('congkak');
      else if (gameId === 'checkers') bgm.play('checkers');
      else if (gameId === 'big-two') bgm.play('bigtwo');
      else if (gameId === 'chess') bgm.play('chess');
      else if (gameId === 'xiangqi') bgm.play('xiangqi');
      else if (GAME_REGISTRY[gameId].kind === 'puzzle') bgm.play('puzzle');
      else if (gameId === 'pacman') bgm.play('pacman');
      else if (gameId === 'tetris') bgm.play('tetris');
      else if (gameId === 'space-invaders' || gameId === 'bomberman') bgm.play('arcade');
      else bgm.play('board');
    } else if (room.status === 'finished') {
      sfx.victory();
      bgm.stop();
    } else {
      bgm.play('title');
    }
    return () => {
      bgm.stop();
    };
  }, [room?.status, gameId, store.paused]);

  /* ---------------- name gate ---------------- */
  if (!joined) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <PixelCard className="w-full max-w-md flex flex-col gap-5">
          <h1 className="font-display text-[18px]">Join {code.toUpperCase()}</h1>
          <PixelInput
            label="Display name"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void join(name.trim(), avatar);
            }}
          />
          <div>
            <span className="font-display text-[10px] uppercase text-pa-ink-dim">Avatar</span>
            <div className="mt-2 flex flex-wrap gap-1">
              {AVATAR_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji === avatar ? null : emoji)}
                  className={cn(
                    // 44px is the floor for a touch target everywhere else in
                    // this app; the avatar picker was the one control under it.
                    'w-11 h-11 border-2 text-[18px] cursor-pointer',
                    avatar === emoji ? 'border-pa-cyan' : 'border-pa-border',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          {joinError && (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-pa-danger text-[13px]">
                {joinError}
              </p>
              <PixelButton variant="secondary" size="sm" onClick={() => navigate('/')}>
                Back to home
              </PixelButton>
            </div>
          )}
          <PixelButton
            size="lg"
            disabled={!name.trim()}
            onClick={() => void join(name.trim(), avatar)}
          >
            Join
          </PixelButton>
        </PixelCard>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="font-display text-[12px] text-pa-ink-dim">Loading room…</p>
      </main>
    );
  }

  const running = room.status === 'running';
  const finished = room.status === 'finished';

  return (
    <main className={cn('min-h-screen flex flex-col', isGameFullscreen && 'h-dvh max-h-dvh overflow-hidden')}>
      {/* In-game fullscreen menu button (mobile only) */}
      {isGameFullscreen && (
        <button
          type="button"
          aria-label="Open menu and options"
          onClick={() => setInGameMode(false)}
          className="fixed top-[max(8px,env(safe-area-inset-top))] right-[max(8px,env(safe-area-inset-right))] z-50 lg:hidden flex items-center justify-center w-8 h-8 bg-pa-surface/85 hover:bg-pa-surface border-2 border-pa-border text-pa-ink-dim hover:text-pa-ink active:scale-95 transition-transform backdrop-blur-xs cursor-pointer select-none touch-manipulation shadow-[2px_2px_0_var(--color-pa-shadow)]"
          title="Menu & Options"
        >
          <Menu size={16} strokeWidth={2.5} className="lucide" />
        </button>
      )}
      <StartOverlay startsAt={store.startsAt} />

      {/* Obscuring Pause Overlay — hides board and cards while paused */}
      {store.paused && (
        <div className="fixed inset-0 z-50 bg-pa-bg/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="border-4 border-pa-amber bg-pa-surface p-8 pa-shadow max-w-md w-full flex flex-col items-center gap-6">
            <div className="flex items-center gap-3">
              <Pause size={24} className="text-pa-amber animate-pulse" />
              <h2 className="font-display text-[20px] text-pa-amber">GAME PAUSED</h2>
            </div>
            <p className="text-[13px] text-pa-ink-dim leading-relaxed">
              The game is currently paused. The board and pieces are hidden until the host resumes play.
            </p>
            {isHost ? (
              <PixelButton size="lg" onClick={() => void emit(EV.roomResume)}>
                <Play size={16} strokeWidth={3} className="lucide" />
                Resume Game
              </PixelButton>
            ) : (
              <p className="font-display text-[11px] text-pa-amber">Waiting for host to resume…</p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------ header ------------------------------ */}
      <header
        className={cn(
          'flex items-center justify-between gap-3 border-b-2 border-pa-border bg-pa-surface px-4 py-3 sticky top-0 z-40',
          running && 'flex-wrap gap-2',
          isGameFullscreen && 'hidden lg:flex',
        )}
      >
        <div className={cn('flex items-center gap-3 min-w-0', running && 'w-full sm:w-auto sm:flex-1')}>
          <h1 className="font-display text-[12px] md:text-[14px] truncate">{meta.title}</h1>
          <PixelBadge tone={running ? (store.paused ? 'danger' : 'success') : finished ? 'default' : 'cyan'}>
            {store.paused ? 'paused' : room.status}
          </PixelBadge>
        </div>
        <div
          className={cn(
            'flex items-center gap-3',
            running && 'w-full min-w-0 justify-end gap-2 sm:w-auto sm:gap-3',
          )}
        >
          {isFullscreenEligible && !inGameMode && (
            <PixelButton
              size="sm"
              variant="cyan"
              onClick={() => setInGameMode(true)}
              className="font-display text-[10px]"
            >
              <Play size={12} strokeWidth={3} className="lucide" />
              Play View
            </PixelButton>
          )}
          {running && store.endsAt && <Countdown endsAt={store.endsAt} className="text-[16px] md:text-[24px]" />}
          {isHost && running && (
            <PixelButton
              size="sm"
              variant={store.paused ? 'primary' : 'ghost'}
              onClick={() => void emit(store.paused ? EV.roomResume : EV.roomPause)}
            >
              {store.paused ? (
                <>
                  <Play size={14} strokeWidth={3} className="lucide" />
                  Resume
                </>
              ) : (
                <>
                  <Pause size={14} strokeWidth={3} className="lucide" />
                  Pause
                </>
              )}
            </PixelButton>
          )}
          <SoundControlButtons />
          <PixelPopover
            trigger={
              <button
                type="button"
                aria-label="Settings"
                className="border-2 border-pa-border p-2 cursor-pointer min-h-[44px] min-w-[44px] grid place-items-center"
              >
                <Settings size={16} strokeWidth={3} className="lucide" />
              </button>
            }
          >
            <div className="flex flex-col gap-4 min-w-[240px]">
              <CrtToggle />
              <div className="border-t-2 border-pa-border pt-4 flex flex-col gap-3">
                <span className="font-display text-[10px] uppercase text-pa-ink-dim flex items-center gap-1.5">
                  <User size={12} strokeWidth={3} className="lucide" />
                  Your profile
                </span>
                <PixelInput
                  label="Display name"
                  value={name}
                  maxLength={20}
                  onChange={(e) => {
                    setName(e.target.value);
                    localStorage.setItem('pa:name', e.target.value);
                  }}
                  onBlur={() => {
                    if (name.trim()) void join(name.trim(), avatar);
                  }}
                />
                <div className="flex flex-wrap gap-1">
                  {AVATAR_EMOJI.slice(0, 12).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        const next = emoji === avatar ? null : emoji;
                        setAvatar(next);
                        if (name.trim()) void join(name.trim(), next);
                      }}
                      className={cn(
                        'w-8 h-8 border text-[14px] cursor-pointer flex items-center justify-center',
                        avatar === emoji ? 'border-pa-cyan bg-pa-cyan/10' : 'border-pa-border',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              {isHost && running && (
                <PixelButton
                  size="sm"
                  variant="danger"
                  onClick={() => void emit(EV.roomEndEarly)}
                >
                  End room now
                </PixelButton>
              )}
            </div>
          </PixelPopover>
        </div>
      </header>
      <div className={cn(
        'flex-1 flex flex-col lg:flex-row gap-4 p-4',
        gameId === 'pacman' && 'gap-2 p-0 lg:gap-4 lg:p-4',
        isGameFullscreen && 'p-0 gap-0 h-full overflow-hidden',
      )}>
        {/* ------------------------------ main ------------------------------ */}
        <section
          className={cn(
            'flex-1 min-w-0',
            mobileTab !== 'board' && 'hidden lg:block',
            isGameFullscreen && 'h-full overflow-hidden flex flex-col',
          )}
        >
          {room.status === 'lobby' && (
            <Lobby code={room.code} roomId={room.id} isHost={isHost} players={store.players} gameId={gameId} />
          )}
          {/* Board games: keep the board visible after the game ends so the
              player actually sees the winning line and the winner banner
              before being dropped into the results table. Puzzle games don't
              need this — the solution is shown inside the Results panel. */}
          {running && (
            <GameErrorBoundary>
              <GameSurface gameId={gameId} />
            </GameErrorBoundary>
          )}
          {finished && GAME_REGISTRY[gameId].kind === 'board' && (
            <div className="mb-4">
              <GameErrorBoundary>
                <GameSurface gameId={gameId} />
              </GameErrorBoundary>
            </div>
          )}
          {finished && store.results && (
            <PixelPanel title="Results">
              <ResultsTable results={store.results} />
              <PuzzleReveal gameId={gameId} />
              {/* A finished room is a dead end without this: the only way out
                  used to be the browser's back button or editing the URL. */}
              <div className="mt-6 flex flex-wrap gap-2 border-t-2 border-pa-border pt-4">
                {isHost && (
                  <PixelButton
                    variant="primary"
                    onClick={async () => {
                      const res = await emit<{ ok?: boolean; error?: string }>(EV.roomRestart);
                      if (res.error) toast(res.error);
                      else toast('REMATCH STARTED!');
                    }}
                  >
                    <RotateCcw size={14} strokeWidth={3} className="lucide" />
                    Play Again (Rematch)
                  </PixelButton>
                )}
                <PixelButton
                  onClick={() => {
                    store.reset();
                    navigate('/');
                  }}
                >
                  Back to home
                </PixelButton>
                {isHost && (
                  <PixelButton
                    variant="secondary"
                    onClick={() => {
                      store.reset();
                      navigate('/admin');
                    }}
                  >
                    Host another room
                  </PixelButton>
                )}
              </div>
            </PixelPanel>
          )}
        </section>

        {/* ------------------------------ rail ------------------------------ */}
        <aside
          className={cn(
            'lg:w-[320px] flex flex-col gap-4',
            mobileTab === 'board' && 'hidden lg:flex',
          )}
        >
          <div className={cn(mobileTab === 'chat' && 'hidden lg:block')}>
            <Leaderboard />
          </div>
          <div className={cn(mobileTab === 'leaderboard' && 'hidden lg:block')}>
            <Chat />
          </div>
        </aside>
      </div>

      {/* Under lg the rail collapses into a bottom tab bar. */}
      {running && !isGameFullscreen && <div className="lg:hidden h-32" aria-hidden="true" />}
      {!isGameFullscreen && (
        <nav className="lg:hidden flex border-t-2 border-pa-border bg-pa-surface">
          {(['board', 'leaderboard', 'chat'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={cn(
                'flex-1 font-display text-[10px] uppercase min-h-[52px] cursor-pointer',
                mobileTab === tab ? 'text-pa-cyan border-t-2 border-pa-cyan' : 'text-pa-ink-dim',
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({
  code,
  roomId,
  isHost,
  players,
  gameId,
}: {
  code: string;
  roomId: string;
  isHost: boolean;
  players: PlayerView[];
  gameId: GameId;
}): React.ReactElement {
  const meta = GAME_REGISTRY[gameId];
  const [busy, setBusy] = React.useState(false);
  const humans = players.filter((p) => !p.isBot).length;
  const seated = players.length;

  const reason =
    seated < meta.minPlayers
      ? `${meta.title} needs at least ${meta.minPlayers} players — add bots or invite more`
      : humans < 1
        ? 'At least one human must be seated'
        : null;

  const addBot = async (difficulty: string): Promise<void> => {
    setBusy(true);
    const res = await api<{ error?: string }>(`/api/rooms/${roomId}/bots`, {
      method: 'POST',
      body: JSON.stringify({ difficulty }),
    });
    setBusy(false);
    if (res.status !== 200) toast(res.body?.error ?? 'Could not add a bot');
  };

  const removeBot = async (playerId: string): Promise<void> => {
    await api(`/api/rooms/${roomId}/bots/${playerId}`, { method: 'DELETE' });
  };

  return (
    <div className="flex flex-col gap-4">
      <PixelPanel title="Room code">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-display text-[24px] md:text-[32px] tabular tracking-widest">
            {code}
          </span>
          <PixelButton
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              toast('CODE COPIED');
            }}
          >
            <Copy size={14} strokeWidth={3} className="lucide" />
            Copy code
          </PixelButton>
          <PixelButton
            variant="ghost"
            size="sm"
            onClick={() => {
              const url = `${window.location.origin}/r/${code}`;
              void navigator.clipboard.writeText(url);
              toast('LINK COPIED');
            }}
          >
            <Link2 size={14} strokeWidth={3} className="lucide" />
            Copy link
          </PixelButton>
        </div>
        <p className="mt-3 text-[13px] text-pa-ink-dim">{meta.blurb}</p>
      </PixelPanel>

      <PixelPanel title={`Seats (${seated}/${meta.maxPlayers})`}>
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {players.map((p) => (
            <li key={p.id}>
              <SeatTile player={p} isHost={isHost} onRemove={() => void removeBot(p.id)} />
            </li>
          ))}
        </ul>

        {/*
          Buttons, not a select. A controlled Select pinned to one value is a
          trap when it is really an action menu: Radix fires no change event for
          the option that is already selected, so picking that one does nothing
          at all. One tap per difficulty, and each is its own control.
        */}
        {isHost && (
          <div className="mt-6 flex flex-col gap-2">
            <span className="font-display text-[10px] uppercase text-pa-ink-dim">
              Add a computer player
            </span>
            <div className="flex flex-wrap gap-2">
              {BOT_DIFFICULTIES.map((difficulty) => (
                <PixelButton
                  key={difficulty}
                  size="sm"
                  variant={difficulty === 'hard' ? 'primary' : 'ghost'}
                  disabled={busy || seated >= meta.maxPlayers}
                  onClick={() => void addBot(difficulty)}
                >
                  <Bot size={14} strokeWidth={3} className="lucide" />
                  {difficulty.toUpperCase()}
                </PixelButton>
              ))}
            </div>
          </div>
        )}
      </PixelPanel>

      {isHost && (
        <PixelTooltip content={reason}>
          <PixelButton
            size="lg"
            disabled={Boolean(reason)}
            onClick={async () => {
              const res = await emit<{ error?: string }>(EV.roomStart);
              if (res.error) toast(res.error);
            }}
          >
            Start
          </PixelButton>
        </PixelTooltip>
      )}
    </div>
  );
}

function SeatTile({
  player,
  isHost,
  onRemove,
}: {
  player: PlayerView;
  isHost: boolean;
  onRemove: () => void;
}): React.ReactElement {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? {} : { scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={stepTransition(reduced ? 0 : 80)}
      className="border-2 p-3 flex flex-col items-center gap-2 bg-pa-surface"
      style={{ borderColor: seatColor(player.seat) }}
    >
      <SeatAvatar
        seat={player.seat}
        displayName={player.displayName}
        avatar={player.avatar}
        isBot={player.isBot}
        size={44}
      />
      <span className="font-display text-[10px] text-center truncate w-full">
        {player.displayName}
      </span>
      <div className="flex items-center gap-1">
        {player.isHost && <PixelBadge tone="cyan">Host</PixelBadge>}
        {player.isBot && (
          <PixelBadge>
            <Bot size={10} strokeWidth={3} className="lucide" />
            {player.botDifficulty}
          </PixelBadge>
        )}
      </div>
      {isHost && player.isBot && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${player.displayName}`}
          className="text-pa-danger cursor-pointer min-h-[44px] min-w-[44px] grid place-items-center"
        >
          <Trash2 size={14} strokeWidth={3} className="lucide" />
        </button>
      )}
      {isHost && !player.isBot && !player.isHost && (
        <button
          type="button"
          onClick={() => void emit(EV.roomKick, { playerId: player.id })}
          aria-label={`Kick ${player.displayName}`}
          className="text-pa-danger cursor-pointer min-h-[44px] min-w-[44px] grid place-items-center"
        >
          <X size={14} strokeWidth={3} className="lucide" />
        </button>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Game surface                                                        */
/* ------------------------------------------------------------------ */

function GameSurface({ gameId }: { gameId: GameId }): React.ReactElement {
  const store = useRoom();
  const state = store.state as any;
  const [hintCount, setHintCount] = React.useState(0);

  /**
   * Moves render optimistically and roll back if the ack rejects. Without this
   * the board would only move when the next snapshot happened to arrive, which
   * feels broken even though the server has already accepted the move.
   */
  const serverBoard = state?.board;
  const [board, setBoard] = React.useState<any>(serverBoard);
  React.useEffect(() => {
    setBoard(serverBoard);
  }, [serverBoard]);
  const isPuzzle = GAME_REGISTRY[gameId]?.kind === 'puzzle';
  if (!state || (isPuzzle && !state.puzzle)) {
    return <p className="text-pa-ink-dim text-[13px] italic">Waiting for the board…</p>;
  }

  const commit = async (
    path: string,
    value: number | string | null,
    optimistic?: (prev: any) => any,
  ): Promise<void> => {
    const rollback = board;
    if (optimistic) setBoard(optimistic(board));

    const res = await emit<{ accepted: boolean; correct?: boolean; error?: string }>(
      EV.puzzleCommit,
      { path, value },
    );

    if (!res.accepted) {
      setBoard(rollback);
      if (res.error && res.error !== 'Illegal move') toast(res.error);
      return;
    }
    if (res.correct === false) toast('That is not correct');
  };

  /** Grid games: write one cell. */
  const commitCell = (index: number, value: number) => {
    const puzzleSize = (gameId === 'nonogram' && state?.puzzle?.size) ? state.puzzle.size : 9;
    commit(
      `${Math.floor(index / puzzleSize)},${index % puzzleSize}`,
      value,
      (prev: number[]) => {
        const next = [...(prev ?? [])];
        next[index] = value;
        return next;
      },
    );
  };
  const gameAction = async (action: unknown): Promise<void> => {
    const isTick = typeof action === 'object' && action !== null && 'type' in action && action.type === 'tick';
    const res = await emit<{ accepted: boolean; error?: string }>(EV.gameAction, action);
    if (isTick) return;
    if (!res.accepted && res.error) {
      const silentErrors = ['Blocked', 'Illegal move', 'Room is paused', 'Not in a room', 'Room is not running'];
      if (!silentErrors.includes(res.error)) toast(res.error);
    }
  };

  if (gameId === 'sudoku' || gameId === 'killer-sudoku') {
    return (
      <div className="flex flex-col gap-3 items-start">
        <HintButton
          count={hintCount}
          onHint={async () => {
            const res = await emit<{ hint: { path: string; value: number } | null }>(EV.puzzleHint);
            if (res.hint) {
              setHintCount((n) => n + 1);
              const [r, c] = res.hint.path.split(',').map(Number);
              await commitCell((r ?? 0) * 9 + (c ?? 0), res.hint.value);
              toast(`Revealed row ${(r ?? 0) + 1}, column ${(c ?? 0) + 1}`);
            }
          }}
        />
        <SudokuBoard
          givens={state.puzzle?.givens ?? []}
          board={board ?? state.puzzle?.givens ?? []}
          cages={state.puzzle?.cages}
          onCommit={(r, c, v) => void commitCell(r * 9 + c, v)}
        />
      </div>
    );
  }

  if (gameId === 'nonogram') {
    const pSize = (state.puzzle?.size as number) || 10;
    return (
      <div className="flex flex-col gap-3 items-start overflow-x-auto">
        <HintButton
          count={hintCount}
          onHint={async () => {
            const res = await emit<{ hint: { path: string; value: number } | null }>(EV.puzzleHint);
            if (res.hint) {
              setHintCount((n) => n + 1);
              const [r, c] = res.hint.path.split(',').map(Number);
              await commitCell((r ?? 0) * pSize + (c ?? 0), res.hint.value);
              toast(`Revealed row ${(r ?? 0) + 1}, column ${(c ?? 0) + 1}`);
            }
          }}
        />
        <NonogramBoard
          size={pSize}
          rowClues={state.puzzle?.rowClues ?? []}
          colClues={state.puzzle?.colClues ?? []}
          marks={board ?? []}
          onCommit={(r, c, v) => void commitCell(r * pSize + c, v)}
        />
      </div>
    );
  }

  if (gameId === 'word-search') {
    return (
      <div className="flex flex-col gap-3 items-start">
        <HintButton
          count={hintCount}
          onHint={async () => {
            const res = await emit<{ hint: { path: string; value: string } | null }>(EV.puzzleHint);
            if (res.hint) {
              setHintCount((n) => n + 1);
              const [r, c] = res.hint.path.split(',').map(Number);
              toast(`${res.hint.value} starts near row ${(r ?? 0) + 1}, column ${(c ?? 0) + 1}`);
            }
          }}
        />
        <WordSearchBoard
          size={state.puzzle.size}
          grid={state.puzzle.grid}
          words={state.puzzle.words}
          found={board?.found ?? []}
          onSelect={async (y1, x1, y2, x2): Promise<string | null> => {
            const res = await emit<{ accepted: boolean; foundWord?: string | null; error?: string }>(
              EV.puzzleCommit,
              { path: `${y1},${x1},${y2},${x2}`, value: null },
            );
            if (!res.accepted) {
              if (res.error && res.error !== 'Illegal move') toast(res.error);
              return null;
            }
            const word = res.foundWord ?? null;
            if (word) {
              setBoard((prev: { found?: string[]; selections?: number } | undefined) => {
                const prevFound = prev?.found ?? [];
                if (prevFound.includes(word)) return prev;
                return { ...(prev ?? {}), found: [...prevFound, word] };
              });
            }
            return word;
          }}
        />
      </div>
    );
  }
  if (gameId === 'minesweeper') {
    return (
      <div className="flex flex-col gap-3 items-start w-full">
        <HintButton
          count={hintCount}
          onHint={async () => {
            const res = await emit<{ hint: { path: string; value: number } | null }>(EV.puzzleHint);
            if (res.hint) {
              setHintCount((n) => n + 1);
              const [r, c] = res.hint.path.split(',').map(Number);
              await commit(`${r},${c}`, res.hint.value);
              toast(`Safe cell revealed at row ${(r ?? 0) + 1}, column ${(c ?? 0) + 1}`);
            }
          }}
        />
        <MinesweeperBoard
          puzzle={state.puzzle}
          board={board ?? state.initialState}
          solution={state.solution ?? null}
          players={store.players}
          youId={store.you?.playerId ?? null}
          turnEndsAt={store.turnEndsAt}
          onCommit={(path, value) => void commit(path, value)}
          onHint={async () => {
            const res = await emit<{ hint: { path: string; value: number } | null }>(EV.puzzleHint);
            if (res.hint) {
              setHintCount((n) => n + 1);
              const [r, c] = res.hint.path.split(',').map(Number);
              await commit(`${r},${c}`, res.hint.value);
              toast(`Safe cell revealed at row ${(r ?? 0) + 1}, column ${(c ?? 0) + 1}`);
            }
          }}
        />
      </div>
    );
  }


  if (gameId === 'property-tycoon') {
    return (
      <PropertyTycoonBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'scrabble') {
    return (
      <ScrabbleBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'congkak') {
    return (
      <CongkakBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'checkers') {
    return (
      <CheckersBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'big-two') {
    return (
      <BigTwoBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }
  if (gameId === 'reversi') {
    return (
      <ReversiBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'connect4') {
    return (
      <Connect4Board
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'chess') {
    return (
      <ChessBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'xiangqi') {
    return (
      <XiangqiBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'animal-chess') {
    return (
      <AnimalChessBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'pacman') {
    return (
      <PacManBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'tetris') {
    return (
      <TetrisBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }
  if (gameId === 'space-invaders') {
    return (
      <SpaceInvadersBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }

  if (gameId === 'bomberman') {
    return (
      <BombermanBoard
        view={state}
        players={store.players}
        youId={store.you?.playerId ?? null}
        legalActions={store.legalActions}
        turnEndsAt={store.turnEndsAt}
        onAction={(a) => void gameAction(a)}
      />
    );
  }


  return (
    <ManorMysteryBoard
      view={state}
      players={store.players}
      youId={store.you?.playerId ?? null}
      roomId={store.room?.id ?? ''}
      legalActions={store.legalActions}
      turnEndsAt={store.turnEndsAt}
      onAction={(a) => void gameAction(a)}
    />
  );
}

function HintButton({
  count,
  onHint,
}: {
  count: number;
  onHint: () => Promise<void>;
}): React.ReactElement {
  return (
    <PixelTooltip content="Each hint costs one penalty (-15 points)">
      <PixelButton variant="secondary" size="sm" onClick={() => void onHint()}>
        <Lightbulb size={14} strokeWidth={3} className="lucide" />
        Hint {count > 0 && `(${count})`}
      </PixelButton>
    </PixelTooltip>
  );
}

/** The one moment the solution is ever sent to a client. */
function PuzzleReveal({ gameId }: { gameId: GameId }): React.ReactElement | null {
  const state = useRoom((s) => s.state) as any;
  if (!state?.solution) return null;

  if (gameId === 'sudoku' || gameId === 'killer-sudoku') {
    const wrong = new Set<number>();
    const board: number[] = state.board ?? [];
    for (let i = 0; i < 81; i++) {
      if ((state.puzzle.givens[i] ?? 0) !== 0) continue;
      if ((board[i] ?? 0) !== state.solution[i]) wrong.add(i);
    }
    return (
      <div className="mt-6">
        <h3 className="font-display text-[12px] mb-3">Solution</h3>
        <SudokuBoard
          givens={state.puzzle.givens}
          board={state.solution}
          cages={state.puzzle.cages}
          onCommit={() => undefined}
          disabled
          wrongCells={wrong}
        />
      </div>
    );
  }

  if (gameId === 'nonogram') {
    return (
      <div className="mt-6 overflow-x-auto">
        <h3 className="font-display text-[12px] mb-3">Solution</h3>
        <NonogramBoard
          size={state.puzzle.size}
          rowClues={state.puzzle.rowClues}
          colClues={state.puzzle.colClues}
          marks={state.solution.map((b: boolean) => (b ? 1 : 0))}
          onCommit={() => undefined}
          disabled
          solution={state.solution}
        />
      </div>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Rail                                                                */
/* ------------------------------------------------------------------ */

function Leaderboard(): React.ReactElement {
  const { leaderboard, room, state } = useRoom();
  const reduced = useReducedMotion();
  const feedback = (room?.config as { instantFeedback?: boolean } | undefined)?.instantFeedback;
  const finished = room?.status === 'finished';
  const isManorMystery = room?.gameId === 'manor-mystery';

  // 'Solved it' vs 'last player standing' comes straight from the engine's
  // own view, phrased identically to the in-game status line — see
  // ManorMysteryBoard's game_over case.
  const winReason = isManorMystery
    ? (state as { winReason?: 'accusation' | 'last-standing' | null } | null)?.winReason ?? null
    : null;

  const maxScore = finished
    ? Math.max(1, ...leaderboard.map((e) => e.score ?? 0))
    : 1;

  return (
    <PixelPanel title="Leaderboard">
      <ul className="flex flex-col gap-2">
        {leaderboard.map((entry) => {
          const barValue = finished ? (entry.score ?? 0) / maxScore : entry.progress;
          const wrongAccusations = entry.wrongAccusations ?? 0;
          return (
            <motion.li
              key={entry.playerId}
              layout={!reduced}
              transition={stepTransition(reduced ? 0 : ROW_REORDER_MS)}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <SeatAvatar
                  seat={entry.seat}
                  displayName={entry.displayName}
                  isBot={entry.isBot}
                  size={22}
                />
                <span className="text-[13px] truncate flex-1">{entry.displayName}</span>
                {entry.completed && isManorMystery && (
                  <PixelBadge tone="success">
                    {winReason === 'last-standing' ? 'Last player standing' : 'Solved it'}
                  </PixelBadge>
                )}
                {entry.completed && !isManorMystery && <PixelBadge tone="success">Done</PixelBadge>}
                {!entry.completed && isManorMystery && wrongAccusations > 0 && (
                  <PixelBadge tone="danger">
                    {wrongAccusations > 1 ? `${wrongAccusations} wrong accusations` : 'Wrong accusation'}
                  </PixelBadge>
                )}
                {entry.penalties > 0 && (
                  <span className="text-[11px] text-pa-danger tabular">-{entry.penalties}</span>
                )}
                {entry.score !== null && (
                  <span className="font-display text-[10px] tabular">{entry.score}</span>
                )}
              </div>
              <SegmentedProgress
                value={barValue}
                color={seatColor(entry.seat)}
                label={`${entry.displayName} ${finished ? 'score' : 'progress'}`}
              />
            </motion.li>
          );
        })}
      </ul>
      {/* Only meaningful for puzzles: board-game progress is net worth, which
          is public anyway. */}
      {!finished && !feedback && room && GAME_REGISTRY[room.gameId].kind === 'puzzle' && (
        <p className="mt-3 text-[11px] text-pa-ink-dim">
          Shows how much each player has filled in — not how much is correct.
        </p>
      )}
    </PixelPanel>
  );
}

function Chat(): React.ReactElement {
  const { chat, log } = useRoom();
  const [text, setText] = React.useState('');
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length, log.length]);

  const send = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void emit(EV.chatSend, { text: trimmed });
    setText('');
  };

  return (
    <PixelPanel title="Chat & log">
      <div className="h-[220px] overflow-y-auto flex flex-col gap-1 text-[13px]">
        {log.map((entry, i) => (
          <p key={`${i}-${entry.seq}`} className="text-pa-ink-dim">
            {entry.text}
          </p>
        ))}
        {chat.map((message) => (
          <p key={message.id}>
            <span style={{ color: seatColor(message.seat) }}>{message.displayName}:</span>{' '}
            {message.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          maxLength={300}
          placeholder="Say something"
          aria-label="Chat message"
          className="flex-1 bg-pa-bg border-2 border-pa-border px-3 min-h-[44px]"
        />
        <PixelButton size="sm" onClick={send} aria-label="Send">
          <Send size={14} strokeWidth={3} className="lucide" />
        </PixelButton>
      </div>
    </PixelPanel>
  );
}
