import * as React from 'react';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';
import { SEAT_COLORS, resolvePlayer, monogram, type PlayerLike } from '../ui/seat.js';

import type {
  BombermanView,
  BombermanPublicPlayer,
  BombermanAction,
  BombState,
  BlastCell,
  PowerUpItem,
  PowerUpKind,
  BombermanConfig,
  Dir,
  Tile,
} from '@puzzle-arena/games';
const ARENA_W = 15;
const ARENA_H = 13;
const ARENA_SIZE = ARENA_W * ARENA_H;

const TILE_EMPTY = 0;
const TILE_HARD = 1;
const TILE_SOFT = 2;
/**
 * Mobile instant press button with optional auto-repeat
 */
function TouchControlBtn({
  onFire,
  repeatMs,
  className,
  label,
  children,
}: {
  onFire: () => void;
  repeatMs?: number;
  className?: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  const timer = React.useRef<number | null>(null);
  const onFireRef = React.useRef(onFire);
  onFireRef.current = onFire;
  const [pressed, setPressed] = React.useState(false);

  const stop = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    setPressed(false);
  }, []);

  React.useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      aria-label={label}
      className={`touch-none select-none font-display border-2 border-pa-border active:translate-y-0.5 transition-colors ${className ?? ''} ${
        pressed ? 'bg-pa-surface-2 border-pa-cyan text-pa-cyan' : 'bg-pa-surface text-pa-ink'
      }`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore
        }
        setPressed(true);
        onFireRef.current();
        if (repeatMs) {
          if (timer.current !== null) window.clearInterval(timer.current);
          timer.current = window.setInterval(() => {
            onFireRef.current();
          }, repeatMs);
        }
      }}
      onPointerUp={(e) => {
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }
        } catch {
          // ignore
        }
        stop();
      }}
      onPointerCancel={stop}
    >
      {children}
    </button>
  );
}

/**
 * Powerup icon renderer
 */
function PowerupBadge({ kind }: { kind: PowerUpKind }) {
  switch (kind) {
    case 'flame':
      return (
        <div
          title="Fire: +1 Blast Radius"
          className="w-full h-full flex items-center justify-center text-sm sm:text-base animate-pulse filter drop-shadow-[0_0_3px_#ff8c1a]"
        >
          🔥
        </div>
      );
    case 'bomb':
      return (
        <div
          title="Bomb: +1 Max Bomb"
          className="w-full h-full flex items-center justify-center text-sm sm:text-base animate-pulse filter drop-shadow-[0_0_3px_#22e0ff]"
        >
          💣
        </div>
      );
    case 'speed':
      return (
        <div
          title="Speed: +1 Movement Speed"
          className="w-full h-full flex items-center justify-center text-sm sm:text-base animate-pulse filter drop-shadow-[0_0_3px_#ffd426]"
        >
          ⚡
        </div>
      );
    case 'pass':
      return (
        <div
          title="Pass: Walk Through Bombs"
          className="w-full h-full flex items-center justify-center text-sm sm:text-base animate-pulse filter drop-shadow-[0_0_3px_#ff3f8e]"
        >
          👻
        </div>
      );
  }
}

/**
 * Animated Bomb renderer with fuse-parity blinking
 */
function BombSprite({ fuse }: { fuse: number }) {
  // Fuse parity: alternates black and crimson
  const blinkRed = fuse % 2 === 0;
  const isUrgent = fuse <= 6;

  return (
    <div
      className={`relative w-[80%] h-[80%] rounded-full flex items-center justify-center transition-transform ${
        isUrgent ? 'animate-ping' : ''
      }`}
      style={{
        backgroundColor: blinkRed ? '#ff2a44' : '#141724',
        border: `2px solid ${blinkRed ? '#ffffff' : '#4d5b7c'}`,
        boxShadow: blinkRed ? '0 0 8px rgba(255, 42, 68, 0.8)' : '0 2px 4px rgba(0,0,0,0.5)',
      }}
    >
      {/* Bomb shine reflection */}
      <div className="absolute top-1 left-1.5 w-1.5 h-1.5 rounded-full bg-white/60 pointer-events-none" />
      {/* Burning fuse spark on top */}
      <div className="absolute -top-2 right-1.5 w-2 h-2 rounded-full bg-yellow-300 animate-pulse drop-shadow-[0_0_4px_#ff8c1a]">
        <div className="w-1 h-1 bg-white rounded-full m-auto" />
      </div>
    </div>
  );
}

/**
 * Explosion Blast sprite with fiery burst
 */
function BlastSprite({ ticksRemaining }: { ticksRemaining: number }) {
  // 3 ticks remaining: bright white/yellow, 1 tick: fading red/smoke
  const opacity = Math.min(1, Math.max(0.4, ticksRemaining / 3));

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 animate-pulse"
      style={{ opacity }}
    >
      <div className="w-full h-full bg-gradient-to-r from-yellow-300 via-orange-500 to-red-600 rounded-sm flex items-center justify-center shadow-[0_0_10px_#ff3b30]">
        <div className="w-3/5 h-3/5 bg-white/90 rounded-full blur-[1px]" />
      </div>
    </div>
  );
}

/**
 * Player token with seat color and eliminated 'X'
 */
function PlayerToken({
  player,
  isYou,
  displayName,
}: {
  player: BombermanPublicPlayer;
  isYou: boolean;
  displayName: string;
}) {
  const color = SEAT_COLORS[player.seat % SEAT_COLORS.length] ?? '#2ee66b';
  const label = monogram(displayName);

  return (
    <div
      className={`relative w-[85%] h-[85%] rounded-full flex items-center justify-center font-display text-[10px] sm:text-xs font-bold shadow-md select-none transition-transform z-20 ${
        isYou ? 'ring-2 ring-pa-cyan ring-offset-1 ring-offset-pa-bg' : ''
      }`}
      style={{
        backgroundColor: color,
        color: '#0b0d17',
      }}
      title={`${displayName} (P${player.seat + 1})`}
    >
      {!player.alive || player.gameOver ? (
        <div className="absolute inset-0 bg-black/80 rounded-full flex items-center justify-center">
          <span className="text-pa-danger font-black text-xs sm:text-sm leading-none">✕</span>
        </div>
      ) : (
        <span>{label}</span>
      )}
      {isYou && player.alive && (
        <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-pa-cyan border border-white" />
      )}
    </div>
  );
}

/**
 * Full arena board (15x13 grid)
 */
function BombermanArena({
  view,
  youId,
  playersList,
}: {
  view: BombermanView;
  youId: string | null;
  playersList: PlayerLike[];
}) {
  const { grid, visiblePowerups, bombs, blasts, players } = view;

  return (
    <div
      className="relative w-full max-w-[560px] aspect-[15/13] bg-[#0c1020] border-4 border-pa-border shadow-[4px_4px_0_var(--color-pa-shadow)] p-1 select-none overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${ARENA_W}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${ARENA_H}, minmax(0, 1fr))`,
        gap: '2px',
      }}
    >
      {Array.from({ length: ARENA_SIZE }).map((_, idx) => {
        const x = idx % ARENA_W;
        const y = Math.floor(idx / ARENA_W);
        const tile = grid[idx] ?? TILE_EMPTY;

        const powerup = visiblePowerups.find((p) => p.x === x && p.y === y);
        const bomb = bombs.find((b) => b.x === x && b.y === y);
        const cellBlasts = blasts.filter((b) => b.x === x && b.y === y);
        const cellPlayers = players.filter((p) => p.x === x && p.y === y);

        // 1. Hard Block (indestructible border & pillars)
        if (tile === TILE_HARD) {
          return (
            <div
              key={idx}
              className="w-full h-full bg-[#1b2238] border border-[#2e395c] flex items-center justify-center relative shadow-inner"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, #242d4a 0, #242d4a 2px, #1a2035 2px, #1a2035 6px)',
              }}
            >
              <div className="w-[60%] h-[60%] border border-[#3b4975]/40 rounded-sm" />
            </div>
          );
        }

        // 2. Soft Block (destructible brick wall)
        if (tile === TILE_SOFT) {
          return (
            <div
              key={idx}
              className="w-full h-full bg-[#8c4623] border border-[#522510] relative flex flex-col justify-between p-0.5 shadow-sm"
              style={{
                backgroundImage:
                  'linear-gradient(to bottom, #a0522d 0%, #80391b 50%, #682d13 100%)',
              }}
            >
              {/* Retro brick mortar lines */}
              <div className="w-full h-px bg-[#451806]" />
              <div className="w-1/2 h-px bg-[#451806] self-center" />
              <div className="w-full h-px bg-[#451806]" />
            </div>
          );
        }

        // 3. Floor Tile (Walkable floor with potential powerup, bomb, player, or blast)
        return (
          <div
            key={idx}
            className="w-full h-full bg-[#0e1326] border border-[#141b36] relative flex items-center justify-center overflow-hidden"
          >
            {/* Floor center dot */}
            <div className="w-1 h-1 rounded-full bg-white/5 pointer-events-none" />

            {/* Powerup on floor */}
            {powerup && <PowerupBadge kind={powerup.kind} />}

            {/* Bomb placed on floor */}
            {bomb && <BombSprite fuse={bomb.fuse} />}

            {/* Explosion blast on floor */}
            {cellBlasts.map((b, bi) => (
              <BlastSprite key={bi} ticksRemaining={b.ticksRemaining} />
            ))}

            {/* Players standing on floor */}
            {cellPlayers.map((p) => {
              const info = resolvePlayer(playersList, p.id);
              return (
                <PlayerToken
                  key={p.id}
                  player={p}
                  isYou={p.id === youId}
                  displayName={info.displayName}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Main BombermanBoard component
 */
export function BombermanBoard({
  view,
  players,
  youId,
  legalActions: _legalActions,
  turnEndsAt: _turnEndsAt,
  onAction,
}: {
  view: BombermanView;
  players: unknown;
  youId: string | null;
  legalActions?: string[];
  turnEndsAt?: number | null;
  onAction: (a: BombermanAction) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);
  const actionRef = React.useRef<(a: BombermanAction) => void>(onAction);
  actionRef.current = onAction;

  const playerList = (players as PlayerLike[]) ?? [];

  // Play BGM on mount, stop on unmount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Track state transitions for sound effects
  const prevBombsCount = React.useRef(view.bombs.length);
  const prevBlastsCount = React.useRef(view.blasts.length);
  const prevKills = React.useRef(you?.kills ?? 0);
  const prevPowers = React.useRef({
    radius: you?.blastRadius ?? 2,
    bombs: you?.maxBombs ?? 1,
    speed: you?.speed ?? 0,
    pass: you?.hasPass ?? false,
  });

  React.useEffect(() => {
    // Bomb planted sound
    if (view.bombs.length > prevBombsCount.current) {
      sfx.drop();
    }
    prevBombsCount.current = view.bombs.length;

    // Bomb detonated sound
    if (view.blasts.length > prevBlastsCount.current) {
      sfx.bomb();
    }
    prevBlastsCount.current = view.blasts.length;

    if (!you) return;

    // Kill sound
    if (you.kills > prevKills.current) {
      sfx.tembak();
      prevKills.current = you.kills;
    }

    // Powerup collected sound
    if (
      you.blastRadius > prevPowers.current.radius ||
      you.maxBombs > prevPowers.current.bombs ||
      you.speed > prevPowers.current.speed ||
      (!prevPowers.current.pass && you.hasPass)
    ) {
      sfx.extraTurn();
      prevPowers.current = {
        radius: you.blastRadius,
        bombs: you.maxBombs,
        speed: you.speed,
        pass: you.hasPass,
      };
    }
  }, [view.bombs.length, view.blasts.length, you?.kills, you?.blastRadius, you?.maxBombs, you?.speed, you?.hasPass, you]);

  // Victory / Game over sound
  const gameOverHandled = React.useRef(false);
  React.useEffect(() => {
    if (view.phase === 'game_over' && !gameOverHandled.current) {
      gameOverHandled.current = true;
      if (view.winner && view.winner === youId) {
        sfx.victory();
      } else {
        sfx.gameOver();
      }
    }
  }, [view.phase, view.winner, youId]);

  // Client tick loop dispatching { type: 'tick' } every config.tickMs
  const tickMs = view.config?.tickMs ?? 60;
  React.useEffect(() => {
    if (!you || !you.alive || view.phase === 'game_over' || paused) return;
    const interval = window.setInterval(() => {
      actionRef.current({ type: 'tick' });
    }, tickMs);
    return () => window.clearInterval(interval);
  }, [you?.alive, view.phase, paused, tickMs]);

  // Keyboard navigation: WASD / Arrows for movement (allows keydown repeat), Space for bomb
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }

      if (!you || !you.alive || view.phase === 'game_over') return;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'up' });
          sfx.blip();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'down' });
          sfx.blip();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'left' });
          sfx.blip();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'right' });
          sfx.blip();
          break;
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          if (e.repeat) return; // Prevent hold-repeat bomb drop spam
          actionRef.current({ type: 'bomb' });
          sfx.pop();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [you?.alive, view.phase, you]);

  const alivePlayers = view.players.filter((p) => p.alive);
  const isGameOver = view.phase === 'game_over';
  const winnerInfo = view.winner ? resolvePlayer(playerList, view.winner) : null;

  // Spectator branch when !you
  if (!you) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-between p-2 sm:p-4 max-w-4xl mx-auto overflow-auto">
        <div className="text-center font-display text-xs tracking-widest text-pa-ink-dim mb-2">
          BOMBERMAN · SPECTATING
        </div>

        {/* Winner Banner */}
        {isGameOver && (
          <div className="w-full max-w-[560px] p-3 mb-3 bg-pa-surface-2 border-2 border-pa-cyan text-center font-display shadow-md animate-bounce">
            <div className="text-pa-cyan text-lg font-bold">
              {winnerInfo ? `${winnerInfo.displayName} WINS!` : 'MUTUAL ELIMINATION — DRAW!'}
            </div>
          </div>
        )}

        {/* Arena View */}
        <BombermanArena view={view} youId={youId} playersList={playerList} />

        {/* Spectator Player Roster */}
        <div className="w-full max-w-[560px] mt-4 p-3 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)]">
          <div className="text-xs font-display text-pa-ink-dim uppercase tracking-wider mb-2">
            PLAYERS ({alivePlayers.length}/{view.players.length} ALIVE)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {view.players.map((p) => {
              const info = resolvePlayer(playerList, p.id);
              const color = SEAT_COLORS[p.seat % SEAT_COLORS.length] ?? '#2ee66b';
              return (
                <div
                  key={p.id}
                  className={`p-2 border-2 text-xs font-display flex flex-col gap-1 ${
                    p.alive ? 'bg-pa-bg border-pa-border' : 'bg-pa-bg/60 border-pa-border/40 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate">{info.displayName}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-pa-ink-dim">
                    <span>💀 {p.kills}</span>
                    <span>🔥 {p.blastRadius}</span>
                    <span>💣 {p.maxBombs}</span>
                  </div>
                  {!p.alive && <span className="text-pa-danger text-[9px] font-bold">ELIMINATED</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-between p-2 sm:p-4 max-w-4xl mx-auto touch-none select-none overflow-y-auto">
      {/* Top HUD */}
      <div className="w-full max-w-[560px] flex items-center justify-between px-3 py-2 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)] mb-2 text-xs font-display">
        {/* Alive & Kills */}
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[10px] text-pa-ink-dim uppercase">ALIVE</div>
            <div className="text-sm sm:text-base font-bold text-pa-cyan tabular">
              {alivePlayers.length}/{view.players.length}
            </div>
          </div>
          <div className="border-l-2 border-pa-border pl-3">
            <div className="text-[10px] text-pa-ink-dim uppercase">KILLS</div>
            <div className="text-sm sm:text-base font-bold text-pa-danger tabular">
              💀 {you.kills}
            </div>
          </div>
        </div>

        {/* Powers HUD (Radius, Max Bombs, Speed, Pass) */}
        <div className="flex items-center gap-2.5">
          <div title="Blast Radius" className="flex items-center gap-1">
            <span>🔥</span>
            <span className="font-bold text-pa-ink tabular">{you.blastRadius}</span>
          </div>
          <div title="Max Bombs" className="flex items-center gap-1">
            <span>💣</span>
            <span className="font-bold text-pa-ink tabular">{you.maxBombs}</span>
          </div>
          {you.speed > 0 && (
            <div title="Speed Boost" className="flex items-center gap-1">
              <span>⚡</span>
              <span className="font-bold text-pa-ink tabular">+{you.speed}</span>
            </div>
          )}
          {you.hasPass && (
            <div title="Pass Through Bombs" className="flex items-center gap-0.5 text-purple-400">
              <span>👻</span>
              <span className="text-[9px] font-bold">PASS</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Arena */}
      <div className="relative w-full max-w-[560px] flex items-center justify-center">
        <BombermanArena view={view} youId={youId} playersList={playerList} />

        {/* Winner Banner Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-pa-bg/85 flex flex-col items-center justify-center p-4 z-30">
            <div className="font-display text-2xl sm:text-3xl font-bold tracking-wider mb-2 animate-bounce">
              {view.winner === you.id ? (
                <span className="text-pa-cyan">VICTORY! YOU WIN!</span>
              ) : winnerInfo ? (
                <span className="text-pa-ink">{winnerInfo.displayName} WINS!</span>
              ) : (
                <span className="text-pa-danger">MUTUAL DRAW!</span>
              )}
            </div>
            <div className="font-display text-xs text-pa-ink-dim">
              TOTAL KILLS: <span className="text-pa-danger font-bold">{you.kills}</span>
            </div>
          </div>
        )}

        {/* Eliminated Overlay for You while game continues */}
        {!you.alive && !isGameOver && (
          <div className="absolute top-2 left-2 right-2 bg-pa-danger/90 text-white font-display text-center py-1 text-xs font-bold tracking-wider z-30 shadow-md">
            ELIMINATED — SPECTATING REMAINING PLAYERS
          </div>
        )}
      </div>

      {/* Mobile Touch Controls (D-Pad + BOMB) */}
      <div className="w-full max-w-[560px] flex items-center justify-between gap-4 mt-3 sm:hidden px-2">
        {/* 4-Way D-Pad on Left */}
        <div className="grid grid-cols-3 grid-rows-3 w-36 h-36 gap-1">
          <div />
          <TouchControlBtn
            label="Move Up"
            onFire={() => {
              actionRef.current({ type: 'move', dir: 'up' });
              sfx.blip();
            }}
            repeatMs={120}
            className="flex items-center justify-center text-base font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            ▲
          </TouchControlBtn>
          <div />

          <TouchControlBtn
            label="Move Left"
            onFire={() => {
              actionRef.current({ type: 'move', dir: 'left' });
              sfx.blip();
            }}
            repeatMs={120}
            className="flex items-center justify-center text-base font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            ◀
          </TouchControlBtn>
          <div className="w-full h-full bg-pa-surface-2/40 border border-pa-border/30 rounded-sm" />
          <TouchControlBtn
            label="Move Right"
            onFire={() => {
              actionRef.current({ type: 'move', dir: 'right' });
              sfx.blip();
            }}
            repeatMs={120}
            className="flex items-center justify-center text-base font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            ▶
          </TouchControlBtn>

          <div />
          <TouchControlBtn
            label="Move Down"
            onFire={() => {
              actionRef.current({ type: 'move', dir: 'down' });
              sfx.blip();
            }}
            repeatMs={120}
            className="flex items-center justify-center text-base font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            ▼
          </TouchControlBtn>
          <div />
        </div>

        {/* Big BOMB button on Right */}
        <div className="flex flex-col items-center">
          <TouchControlBtn
            label="Place Bomb"
            onFire={() => {
              actionRef.current({ type: 'bomb' });
              sfx.pop();
            }}
            className="w-24 h-24 rounded-full flex flex-col items-center justify-center bg-pa-surface-2 border-4 border-pa-danger text-pa-danger shadow-[4px_4px_0_var(--color-pa-shadow)] active:scale-95"
          >
            <span className="text-2xl">💣</span>
            <span className="text-[10px] font-bold tracking-widest mt-1">BOMB</span>
          </TouchControlBtn>
        </div>
      </div>
    </div>
  );
}
