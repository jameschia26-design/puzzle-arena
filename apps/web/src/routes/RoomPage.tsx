import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Bot, Copy, Lightbulb, Send, Settings, Trash2, X } from 'lucide-react';
import {
  AVATAR_EMOJI,
  EV,
  GAME_REGISTRY,
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
import { ResultsTable } from './ResultsPage.js';

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
            <p role="alert" className="text-pa-danger text-[13px]">
              {joinError}
            </p>
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
    <main className="min-h-screen flex flex-col">
      <StartOverlay startsAt={store.startsAt} />

      {/* ------------------------------ header ------------------------------ */}
      <header className="flex items-center justify-between gap-3 border-b-2 border-pa-border bg-pa-surface px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-display text-[12px] md:text-[14px] truncate">{meta.title}</h1>
          <PixelBadge tone={running ? 'success' : finished ? 'default' : 'cyan'}>
            {room.status}
          </PixelBadge>
        </div>
        <div className="flex items-center gap-3">
          {running && <Countdown endsAt={store.endsAt} className="text-[16px] md:text-[24px]" />}
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
            <div className="flex flex-col gap-4">
              <CrtToggle />
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

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4">
        {/* ------------------------------ main ------------------------------ */}
        <section
          className={cn('flex-1 min-w-0', mobileTab !== 'board' && 'hidden lg:block')}
        >
          {room.status === 'lobby' && (
            <Lobby code={room.code} roomId={room.id} isHost={isHost} players={store.players} gameId={gameId} />
          )}
          {running && <GameSurface gameId={gameId} />}
          {finished && store.results && (
            <PixelPanel title="Results">
              <ResultsTable results={store.results} />
              <PuzzleReveal gameId={gameId} />
              {/* A finished room is a dead end without this: the only way out
                  used to be the browser's back button or editing the URL. */}
              <div className="mt-6 flex flex-wrap gap-2 border-t-2 border-pa-border pt-4">
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
      <nav className="lg:hidden sticky bottom-0 flex border-t-2 border-pa-border bg-pa-surface">
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
              toast('COPIED');
            }}
          >
            <Copy size={14} strokeWidth={3} className="lucide" />
            Copy
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
              {(['easy', 'normal', 'hard'] as const).map((difficulty) => (
                <PixelButton
                  key={difficulty}
                  size="sm"
                  variant="ghost"
                  disabled={busy || seated >= meta.maxPlayers}
                  onClick={() => void addBot(difficulty)}
                >
                  <Bot size={14} strokeWidth={3} className="lucide" />
                  {difficulty}
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

  if (!state) return <p className="text-pa-ink-dim text-[13px]">Waiting for the board…</p>;

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
  const commitCell = (index: number, value: number) =>
    commit(
      `${Math.floor(index / (gameId === 'nonogram' ? state.puzzle.size : 9))},${
        index % (gameId === 'nonogram' ? state.puzzle.size : 9)
      }`,
      value,
      (prev: number[]) => {
        const next = [...(prev ?? [])];
        next[index] = value;
        return next;
      },
    );

  const gameAction = async (action: unknown): Promise<void> => {
    const res = await emit<{ accepted: boolean; error?: string }>(EV.gameAction, action);
    if (!res.accepted && res.error) toast(res.error);
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
          givens={state.puzzle.givens}
          board={board ?? state.puzzle.givens}
          cages={state.puzzle.cages}
          onCommit={(r, c, v) => void commitCell(r * 9 + c, v)}
        />
      </div>
    );
  }

  if (gameId === 'nonogram') {
    return (
      <div className="flex flex-col gap-3 items-start overflow-x-auto">
        <NonogramBoard
          size={state.puzzle.size}
          rowClues={state.puzzle.rowClues}
          colClues={state.puzzle.colClues}
          marks={board ?? []}
          onCommit={(r, c, v) => void commitCell(r * state.puzzle.size + c, v)}
        />
      </div>
    );
  }

  if (gameId === 'word-search') {
    return (
      <WordSearchBoard
        size={state.puzzle.size}
        grid={state.puzzle.grid}
        words={state.puzzle.words}
        found={board?.found ?? []}
        onSelect={(y1, x1, y2, x2) => void commit(`${y1},${x1},${y2},${x2}`, null)}
      />
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
        {log.map((entry) => (
          <p key={`l${entry.seq}`} className="text-pa-ink-dim">
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
