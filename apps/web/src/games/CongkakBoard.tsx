import * as React from 'react';
import type { CongkakView } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelPanel } from '../ui/primitives.js';
import { resolvePlayer } from '../ui/seat.js';
import { FastForward, Smartphone, Sparkles, Trophy, Zap, RotateCcw } from 'lucide-react';
import { bgm, sfx, unlockAudioSession } from '../ui/sound.js';

interface CongkakBoardProps {
  view: CongkakView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const BEAD_COLORS = [
  '#22e0ff', // cyan
  '#ff3f8e', // magenta
  '#9dff3c', // lime
  '#ffb020', // amber
  '#8b5cf6', // purple
  '#ff6b35', // orange
  '#37f0c2', // teal
];

function BeadCluster({ count }: { count: number }) {
  if (count <= 0) return <div className="h-3.5" />;
  const visible = Math.min(count, 12);
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 max-w-[52px] h-3.5 overflow-hidden">
      {Array.from({ length: visible }).map((_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full inline-block shadow-sm"
          style={{
            backgroundColor: BEAD_COLORS[i % BEAD_COLORS.length],
            boxShadow: `0 0 4px ${BEAD_COLORS[i % BEAD_COLORS.length]}`,
          }}
        />
      ))}
    </div>
  );
}

type HighlightTarget =
  | { kind: 'pit'; index: number }
  | { kind: 'storehouse'; player: 0 | 1 };

interface AnimationStep {
  pits: number[];
  storehouses: [number, number];
  hand: number;
  highlightTarget: HighlightTarget | null;
  actionText: string;
}

interface QueuedMove {
  id: string;
  startPit: number;
  playerIndex: 0 | 1;
}

function generateSowSteps(
  startPit: number,
  playerIndex: 0 | 1,
  nPits: number,
  initialPits: number[],
  initialStorehouses: [number, number],
): { steps: AnimationStep[]; finalPits: number[]; finalStorehouses: [number, number] } {
  const steps: AnimationStep[] = [];
  const currentPits = [...initialPits];
  const currentStorehouses: [number, number] = [initialStorehouses[0], initialStorehouses[1]];

  let hand = currentPits[startPit] ?? 0;
  if (hand <= 0) {
    return { steps, finalPits: currentPits, finalStorehouses: currentStorehouses };
  }
  currentPits[startPit] = 0;

  const startPitLabel = startPit < nPits ? startPit + 1 : startPit - nPits + 1;

  steps.push({
    pits: [...currentPits],
    storehouses: [...currentStorehouses],
    hand,
    highlightTarget: { kind: 'pit', index: startPit },
    actionText: `Picked up ${hand} marble${hand > 1 ? 's' : ''} from house #${startPitLabel}`,
  });

  let curPos: HighlightTarget = { kind: 'pit', index: startPit };
  let safety = 500;

  while (hand > 0 && safety-- > 0) {
    while (hand > 0) {
      if (curPos.kind === 'pit') {
        if (curPos.index === nPits - 1) {
          if (playerIndex === 0) curPos = { kind: 'storehouse', player: 0 };
          else curPos = { kind: 'pit', index: nPits };
        } else if (curPos.index === 2 * nPits - 1) {
          if (playerIndex === 1) curPos = { kind: 'storehouse', player: 1 };
          else curPos = { kind: 'pit', index: 0 };
        } else {
          curPos = { kind: 'pit', index: curPos.index + 1 };
        }
      } else if (curPos.player === 0) {
        curPos = { kind: 'pit', index: nPits };
      } else {
        curPos = { kind: 'pit', index: 0 };
      }

      hand--;

      if (curPos.kind === 'storehouse') {
        currentStorehouses[curPos.player] = (currentStorehouses[curPos.player] ?? 0) + 1;
        steps.push({
          pits: [...currentPits],
          storehouses: [...currentStorehouses],
          hand,
          highlightTarget: curPos,
          actionText: `Dropped marble into ${curPos.player === playerIndex ? 'your' : "opponent's"} Rumah`,
        });
      } else {
        const pitIdx = curPos.index;
        currentPits[pitIdx] = (currentPits[pitIdx] ?? 0) + 1;
        const pitLabel = pitIdx < nPits ? pitIdx + 1 : pitIdx - nPits + 1;
        steps.push({
          pits: [...currentPits],
          storehouses: [...currentStorehouses],
          hand,
          highlightTarget: curPos,
          actionText: `Dropped marble into house #${pitLabel}`,
        });
      }
    }

    if (curPos.kind === 'storehouse') {
      steps.push({
        pits: [...currentPits],
        storehouses: [...currentStorehouses],
        hand: 0,
        highlightTarget: curPos,
        actionText: `⭐ Landed in Rumah — EXTRA TURN!`,
      });
      break;
    }

    const landIndex = curPos.index;
    const count = currentPits[landIndex] ?? 0;

    if (count > 1) {
      hand = count;
      currentPits[landIndex] = 0;
      const pitLabel = landIndex < nPits ? landIndex + 1 : landIndex - nPits + 1;
      steps.push({
        pits: [...currentPits],
        storehouses: [...currentStorehouses],
        hand,
        highlightTarget: curPos,
        actionText: `⚡ Relay! Scooped ${hand} marbles from house #${pitLabel} to continue`,
      });
      continue;
    }

    const isOwnSide =
      playerIndex === 0 ? landIndex < nPits : landIndex >= nPits && landIndex < 2 * nPits;
    if (isOwnSide) {
      const opp = 2 * nPits - 1 - landIndex;
      const oppCount = currentPits[opp] ?? 0;
      if (oppCount > 0) {
        const totalCaptured = oppCount + 1;
        currentPits[landIndex] = 0;
        currentPits[opp] = 0;
        currentStorehouses[playerIndex] = (currentStorehouses[playerIndex] ?? 0) + totalCaptured;

        const ownLabel = landIndex < nPits ? landIndex + 1 : landIndex - nPits + 1;
        const oppLabel = opp < nPits ? opp + 1 : opp - nPits + 1;
        steps.push({
          pits: [...currentPits],
          storehouses: [...currentStorehouses],
          hand: 0,
          highlightTarget: curPos,
          actionText: `💥 TEMBAK! House #${ownLabel} captured ${oppCount} marbles from opposite house #${oppLabel}! (+${totalCaptured} to Rumah)`,
        });
        break;
      }
    }

    steps.push({
      pits: [...currentPits],
      storehouses: [...currentStorehouses],
      hand: 0,
      highlightTarget: curPos,
      actionText: `Landed in empty house (Mati). Turn passes.`,
    });
    break;
  }

  return { steps, finalPits: currentPits, finalStorehouses: currentStorehouses };
}

export function CongkakBoard({
  view,
  players,
  youId,
  legalActions,
  turnEndsAt,
  onAction,
}: CongkakBoardProps) {
  const isMyTurn = view.current === youId;
  const you = view.you;
  const nPits = view.pitsPerSide ?? 7;

  // Board orientation state (portrait vertical mode vs horizontal landscape)
  const [isPortrait, setIsPortrait] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pa:congkak:portrait');
      if (saved !== null) return saved === 'true';
      return window.innerWidth < 768; // Auto-default portrait on mobile screens
    }
    return false;
  });

  const toggleOrientation = React.useCallback(() => {
    setIsPortrait((prev) => {
      const next = !prev;
      localStorage.setItem('pa:congkak:portrait', String(next));
      sfx.blip();
      return next;
    });
  }, []);

  // Visual board state rendered on screen
  const [displayBoard, setDisplayBoard] = React.useState<{
    pits: number[];
    storehouses: [number, number];
  }>({
    pits: view.pits,
    storehouses: view.storehouses,
  });

  const [activeStep, setActiveStep] = React.useState<AnimationStep | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);

  const simulatedBoardRef = React.useRef<{
    pits: number[];
    storehouses: [number, number];
  }>({
    pits: [...view.pits],
    storehouses: [view.storehouses[0], view.storehouses[1]],
  });

  const moveQueueRef = React.useRef<QueuedMove[]>([]);
  const seenMoveKeysRef = React.useRef<Set<string>>(new Set());
  const activeTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const isRunningRef = React.useRef(false);

  const latestViewRef = React.useRef(view);
  latestViewRef.current = view;

  const pumpQueue = React.useCallback(() => {
    if (isRunningRef.current) return;

    if (moveQueueRef.current.length === 0) {
      setIsAnimating(false);
      setActiveStep(null);
      setDisplayBoard({
        pits: latestViewRef.current.pits,
        storehouses: latestViewRef.current.storehouses,
      });
      simulatedBoardRef.current = {
        pits: [...latestViewRef.current.pits],
        storehouses: [latestViewRef.current.storehouses[0], latestViewRef.current.storehouses[1]],
      };
      return;
    }

    isRunningRef.current = true;
    setIsAnimating(true);

    const move = moveQueueRef.current.shift()!;
    const simBoard = simulatedBoardRef.current;

    const { steps, finalPits, finalStorehouses } = generateSowSteps(
      move.startPit,
      move.playerIndex,
      nPits,
      simBoard.pits,
      simBoard.storehouses,
    );

    simulatedBoardRef.current = { pits: finalPits, storehouses: finalStorehouses };

    if (steps.length === 0) {
      isRunningRef.current = false;
      pumpQueue();
      return;
    }

    let stepIdx = 0;
    const applyStep = (idx: number) => {
      const s = steps[idx];
      if (s) {
        setActiveStep(s);
        setDisplayBoard({ pits: s.pits, storehouses: s.storehouses });

        if (s.actionText.includes('TEMBAK')) {
          sfx.tembak();
        } else if (s.actionText.includes('EXTRA TURN')) {
          sfx.extraTurn();
        } else if (s.actionText.includes('Picked up') || s.actionText.includes('Relay')) {
          sfx.pickup();
        } else {
          sfx.drop();
        }
      }
    };

    applyStep(0);

    activeTimerRef.current = setInterval(() => {
      stepIdx++;
      if (stepIdx >= steps.length) {
        clearInterval(activeTimerRef.current as NodeJS.Timeout);
        activeTimerRef.current = null;
        isRunningRef.current = false;
        setTimeout(() => pumpQueue(), 250);
        return;
      }
      applyStep(stepIdx);
    }, 500); // 0.5s per marble drop
  }, [nPits]);

  React.useEffect(() => {
    return () => {
      clearInterval(activeTimerRef.current as NodeJS.Timeout);
    };
  }, []);

  React.useEffect(() => {
    bgm.play('congkak');
  }, []);

  React.useEffect(() => {
    if (!view.lastMove) {
      if (!isRunningRef.current && moveQueueRef.current.length === 0) {
        setDisplayBoard({ pits: view.pits, storehouses: view.storehouses });
        simulatedBoardRef.current = {
          pits: [...view.pits],
          storehouses: [view.storehouses[0], view.storehouses[1]],
        };
      }
      return;
    }

    const moveKey = `${view.lastMove.playerId}:${view.lastMove.startPit}:${view.log.length}`;
    if (seenMoveKeysRef.current.has(moveKey)) return;
    seenMoveKeysRef.current.add(moveKey);

    const movePlayerIndex: 0 | 1 =
      view.players.findIndex((p) => p.id === view.lastMove?.playerId) === 1 ? 1 : 0;

    moveQueueRef.current.push({
      id: moveKey,
      startPit: view.lastMove.startPit,
      playerIndex: movePlayerIndex,
    });

    pumpQueue();
  }, [view.lastMove, view.log.length, view.players, view.pits, view.storehouses, pumpQueue]);

  const skipAnimation = React.useCallback(() => {
    clearInterval(activeTimerRef.current as NodeJS.Timeout);
    activeTimerRef.current = null;
    moveQueueRef.current = [];
    isRunningRef.current = false;
    setIsAnimating(false);
    setActiveStep(null);
    setDisplayBoard({ pits: view.pits, storehouses: view.storehouses });
    simulatedBoardRef.current = {
      pits: [...view.pits],
      storehouses: [view.storehouses[0], view.storehouses[1]],
    };
  }, [view.pits, view.storehouses]);

  const myPlayerIndex: 0 | 1 = you?.playerIndex === 1 ? 1 : 0;
  const oppPlayerIndex: 0 | 1 = (1 - myPlayerIndex) as 0 | 1;

  const myPlayerObj = view.players[myPlayerIndex];
  const oppPlayerObj = view.players[oppPlayerIndex];

  const myPlayerInfo = resolvePlayer(players, myPlayerObj?.id, 'You');
  const oppPlayerInfo = resolvePlayer(players, oppPlayerObj?.id, 'Opponent');
  const currentActor = resolvePlayer(players, view.current, 'Opponent');

  const myPitIndices: number[] = [];
  const oppPitIndices: number[] = [];

  if (myPlayerIndex === 0) {
    for (let i = 0; i < nPits; i++) myPitIndices.push(i);
    for (let i = 2 * nPits - 1; i >= nPits; i--) oppPitIndices.push(i);
  } else {
    for (let i = nPits; i < 2 * nPits; i++) myPitIndices.push(i);
    for (let i = nPits - 1; i >= 0; i--) oppPitIndices.push(i);
  }

  const displayPits = displayBoard.pits;
  const displayStorehouses = displayBoard.storehouses;
  const myStorehouse = displayStorehouses[myPlayerIndex] ?? 0;
  const oppStorehouse = displayStorehouses[oppPlayerIndex] ?? 0;
  const activeHighlight = activeStep?.highlightTarget ?? null;

  const canSow = (pitIdx: number) => {
    if (isAnimating) return false;
    return isMyTurn && legalActions.includes(`sow:${pitIdx}`);
  };

  const handleSow = (pitIdx: number) => {
    if (!canSow(pitIdx)) return;
    unlockAudioSession();
    const localKey = `${youId ?? 'me'}:${pitIdx}:${view.log.length + 1}`;
    seenMoveKeysRef.current.add(localKey);

    moveQueueRef.current.push({
      id: localKey,
      startPit: pitIdx,
      playerIndex: myPlayerIndex,
    });

    pumpQueue();
    onAction({ type: 'sow', pitIndex: pitIdx });
  };

  const isGameOver = view.phase === 'game_over';
  const winnerPlayer = view.winner ? resolvePlayer(players, view.winner) : null;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      {/* ---------------- Turn & Status Banner ---------------- */}
      <PixelCard className="flex flex-wrap items-center justify-between gap-4 p-4 border-2">
        <div className="flex items-center gap-3">
          {isGameOver && !isAnimating ? (
            <div className="flex items-center gap-2 text-pa-amber">
              <Trophy size={20} className="text-pa-amber animate-bounce" />
              <span className="font-display text-[13px] md:text-[15px]">
                {winnerPlayer
                  ? `${winnerPlayer.displayName} WINS (${Math.max(...view.storehouses)} SEEDS)!`
                  : "IT'S A DRAW!"}
              </span>
            </div>
          ) : isAnimating ? (
            <div className="flex items-center gap-2 text-pa-cyan">
              <span className="inline-block animate-bounce text-[18px]">🟣</span>
              <span className="font-display text-[12px] md:text-[13px] text-pa-cyan">
                {activeStep?.actionText ?? 'DISTRIBUTING MARBLES…'}
              </span>
            </div>
          ) : isMyTurn ? (
            <div className="flex items-center gap-2 text-pa-cyan">
              <Zap size={18} className="text-pa-cyan animate-pulse" />
              <span className="font-display text-[12px] md:text-[14px]">
                YOUR TURN — SELECT A HOUSE TO SOW
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-pa-ink-dim">
              <span className="font-display text-[12px] md:text-[14px]">
                WAITING FOR {currentActor.displayName}…
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Orientation Toggle for Mobile/Desktop */}
          <PixelButton
            variant="ghost"
            size="sm"
            onClick={toggleOrientation}
            title={isPortrait ? 'Switch to Horizontal layout' : 'Switch to Vertical Portrait layout'}
            className="text-[11px] gap-1.5"
          >
            {isPortrait ? (
              <>
                <RotateCcw size={14} className="inline text-pa-cyan" /> Horizontal
              </>
            ) : (
              <>
                <Smartphone size={14} className="inline text-pa-cyan" /> Portrait
              </>
            )}
          </PixelButton>

          {isAnimating && (
            <>
              <PixelBadge tone="cyan" className="animate-pulse">
                🖐️ IN HAND: {activeStep?.hand ?? 0}
              </PixelBadge>
              <PixelButton
                variant="ghost"
                size="sm"
                onClick={skipAnimation}
                className="text-[11px]"
              >
                <FastForward size={14} className="mr-1 inline" /> Skip
              </PixelButton>
            </>
          )}
          {!isAnimating && view.lastMove?.tembakPit !== undefined && (
            <PixelBadge tone="danger" className="animate-pulse">
              💥 TEMBAK (+{view.lastMove.capturedSeeds} SEEDS)
            </PixelBadge>
          )}
          {!isAnimating && view.lastMove?.landedInStorehouse && !isGameOver && (
            <PixelBadge tone="cyan" className="animate-pulse">
              <Sparkles size={12} className="mr-1 inline" /> EXTRA TURN
            </PixelBadge>
          )}
          {!isGameOver && turnEndsAt && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-pa-ink-dim font-display">TIME:</span>
              <Countdown endsAt={turnEndsAt} className="text-[16px]" />
            </div>
          )}
        </div>
      </PixelCard>

      {/* ---------------- The Congkak Board ---------------- */}
      {isPortrait ? (
        /* ================= PORTRAIT / VERTICAL BOARD (No horizontal scroll on mobile) ================= */
        <div
          className="relative rounded-3xl p-4 sm:p-6 border-4 shadow-2xl mx-auto w-full max-w-[420px]"
          style={{
            backgroundColor: '#120d09',
            borderColor: '#84532b',
            boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8), 0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="absolute inset-2 rounded-2xl border-2 pointer-events-none opacity-30"
            style={{ borderColor: '#c6924b' }}
          />

          <div className="flex flex-col items-center justify-between gap-5 py-2">
            {/* Top Storehouse (Opponent's Rumah) */}
            <div className="flex flex-col items-center gap-2 w-full">
              <div className="flex items-center gap-2 text-center">
                <SeatAvatar
                  seat={oppPlayerInfo.seat}
                  displayName={oppPlayerInfo.displayName}
                  avatar={oppPlayerInfo.avatar}
                  isBot={oppPlayerInfo.isBot}
                  size={24}
                />
                <span className="font-display text-[11px] text-pa-ink-dim truncate max-w-[140px]">
                  {oppPlayerInfo.displayName} (Opponent)
                </span>
              </div>

              <div
                className={cn(
                  'w-48 h-20 rounded-full border-4 flex items-center justify-between px-6 py-2 transition-all relative',
                  'bg-black/60 shadow-inner',
                  activeHighlight?.kind === 'storehouse' && activeHighlight.player === oppPlayerIndex
                    ? 'border-pa-amber ring-4 ring-pa-amber/80 scale-105 shadow-[0_0_20px_rgba(255,176,32,0.8)]'
                    : 'border-[#5c3a1e]',
                )}
              >
                {activeHighlight?.kind === 'storehouse' && activeHighlight.player === oppPlayerIndex && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[9px] font-display bg-pa-amber text-black rounded-full font-bold animate-bounce shadow-md">
                    +1
                  </span>
                )}
                <span className="font-display text-[10px] uppercase tracking-wider text-[#a0744b]">
                  Rumah
                </span>
                <span className="font-display text-[26px] tabular text-pa-amber font-bold">
                  {oppStorehouse}
                </span>
                <BeadCluster count={oppStorehouse} />
              </div>
            </div>

            {/* Middle: 2 Vertical Columns of Houses */}
            <div className="w-full flex items-center justify-around py-1 gap-2">
              {/* Left Column: Opponent Houses (#7 down to #1) */}
              <div className="flex flex-col items-center gap-2.5 flex-1">
                <span className="text-[10px] font-display text-pa-ink-dim uppercase">Opponent</span>
                {oppPitIndices.map((pitIdx, i) => {
                  const count = displayPits[pitIdx] ?? 0;
                  const isTarget = activeHighlight?.kind === 'pit' && activeHighlight.index === pitIdx;
                  const isLastTembak = !isAnimating && view.lastMove?.tembakPit === pitIdx;

                  return (
                    <div key={pitIdx} className="flex items-center gap-2 w-full justify-center relative">
                      <span className="text-[10px] font-display text-pa-ink-dim w-6 text-right">
                        #{nPits - i}
                      </span>
                      <div
                        className={cn(
                          'w-13 h-13 sm:w-14 sm:h-14 rounded-full border-2 flex flex-col items-center justify-center transition-all bg-black/40 relative',
                          isTarget
                            ? 'border-pa-amber ring-4 ring-pa-amber/80 scale-110 shadow-[0_0_16px_rgba(255,176,32,0.9)] bg-pa-amber/20'
                            : isLastTembak
                              ? 'border-pa-danger ring-2 ring-pa-danger/50'
                              : 'border-[#5c3a1e]',
                        )}
                      >
                        {isTarget && (
                          <span className="absolute -top-2 px-1.5 py-0.5 text-[8px] font-display bg-pa-amber text-black rounded-full font-bold animate-bounce shadow-sm">
                            +1
                          </span>
                        )}
                        <span className="font-display text-[15px] tabular text-pa-ink font-bold">
                          {count}
                        </span>
                        <BeadCluster count={count} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Vertical Center Track Divider */}
              <div className="w-0.5 self-stretch bg-gradient-to-b from-transparent via-[#5c3a1e] to-transparent opacity-60 my-2" />

              {/* Right Column: Your Houses (#1 to #7, Interactive) */}
              <div className="flex flex-col items-center gap-2.5 flex-1">
                <span className="text-[10px] font-display text-pa-cyan uppercase">Your Side</span>
                {myPitIndices.map((pitIdx, i) => {
                  const count = displayPits[pitIdx] ?? 0;
                  const legal = canSow(pitIdx);
                  const isTarget = activeHighlight?.kind === 'pit' && activeHighlight.index === pitIdx;
                  const isLastTembak = !isAnimating && view.lastMove?.tembakPit === pitIdx;

                  return (
                    <div key={pitIdx} className="flex items-center gap-2 w-full justify-center relative">
                      <button
                        type="button"
                        disabled={!legal}
                        onClick={() => handleSow(pitIdx)}
                        aria-label={`Sow house #${i + 1} with ${count} seeds`}
                        className={cn(
                          'w-13 h-13 sm:w-14 sm:h-14 rounded-full border-2 flex flex-col items-center justify-center transition-all relative',
                          isTarget
                            ? 'border-pa-cyan ring-4 ring-pa-cyan/80 scale-110 shadow-[0_0_18px_rgba(34,224,255,0.9)] bg-pa-cyan/25'
                            : legal
                              ? 'cursor-pointer border-pa-cyan bg-pa-cyan/10 hover:bg-pa-cyan/25 hover:scale-105 shadow-[0_0_12px_rgba(34,224,255,0.35)] animate-pulse'
                              : 'border-[#5c3a1e] bg-black/40 cursor-default opacity-85',
                          isLastTembak && 'border-pa-danger ring-2 ring-pa-danger/50',
                        )}
                      >
                        {isTarget && (
                          <span className="absolute -top-2 px-1.5 py-0.5 text-[8px] font-display bg-pa-cyan text-black rounded-full font-bold animate-bounce shadow-sm">
                            +1
                          </span>
                        )}
                        <span
                          className={cn(
                            'font-display text-[15px] tabular font-bold',
                            legal || isTarget ? 'text-pa-cyan' : 'text-pa-ink',
                          )}
                        >
                          {count}
                        </span>
                        <BeadCluster count={count} />
                      </button>
                      <span
                        className={cn(
                          'text-[10px] font-display w-6',
                          legal || isTarget ? 'text-pa-cyan font-bold' : 'text-pa-ink-dim',
                        )}
                      >
                        #{i + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Storehouse (Your Rumah) */}
            <div className="flex flex-col items-center gap-2 w-full">
              <div
                className={cn(
                  'w-48 h-20 rounded-full border-4 flex items-center justify-between px-6 py-2 transition-all relative',
                  'bg-black/60 shadow-inner',
                  activeHighlight?.kind === 'storehouse' && activeHighlight.player === myPlayerIndex
                    ? 'border-pa-cyan ring-4 ring-pa-cyan/80 scale-105 shadow-[0_0_20px_rgba(34,224,255,0.8)]'
                    : 'border-[#5c3a1e]',
                )}
              >
                {activeHighlight?.kind === 'storehouse' && activeHighlight.player === myPlayerIndex && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[9px] font-display bg-pa-cyan text-black rounded-full font-bold animate-bounce shadow-md">
                    +1
                  </span>
                )}
                <span className="font-display text-[10px] uppercase tracking-wider text-pa-cyan font-bold">
                  Rumah
                </span>
                <span className="font-display text-[26px] tabular text-pa-cyan font-bold">
                  {myStorehouse}
                </span>
                <BeadCluster count={myStorehouse} />
              </div>

              <div className="flex items-center gap-2 text-center">
                <SeatAvatar
                  seat={myPlayerInfo.seat}
                  displayName={myPlayerInfo.displayName}
                  avatar={myPlayerInfo.avatar}
                  isBot={myPlayerInfo.isBot}
                  size={24}
                />
                <span className="font-display text-[11px] text-pa-cyan truncate max-w-[140px]">
                  {myPlayerInfo.displayName} (You)
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ================= HORIZONTAL BOARD (Desktop / Landscape) ================= */
        <div
          className="relative rounded-3xl p-4 md:p-6 border-4 shadow-2xl overflow-x-auto"
          style={{
            backgroundColor: '#120d09',
            borderColor: '#84532b',
            boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8), 0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="absolute inset-2 rounded-2xl border-2 pointer-events-none opacity-30"
            style={{ borderColor: '#c6924b' }}
          />

          <div className="min-w-[620px] flex items-center justify-between gap-4 md:gap-6 py-2">
            {/* Left Storehouse (Opponent's Rumah or P0) */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1.5 text-center mb-1">
                <SeatAvatar
                  seat={oppPlayerInfo.seat}
                  displayName={oppPlayerInfo.displayName}
                  avatar={oppPlayerInfo.avatar}
                  isBot={oppPlayerInfo.isBot}
                  size={22}
                />
                <span className="font-display text-[10px] text-pa-ink-dim truncate max-w-[80px]">
                  {oppPlayerInfo.displayName}
                </span>
              </div>

              <div
                className={cn(
                  'w-20 md:w-24 h-40 md:h-48 rounded-full border-4 flex flex-col items-center justify-center p-3 gap-2 transition-all relative',
                  'bg-black/60 shadow-inner',
                  activeHighlight?.kind === 'storehouse' && activeHighlight.player === oppPlayerIndex
                    ? 'border-pa-amber ring-4 ring-pa-amber/80 scale-105 shadow-[0_0_20px_rgba(255,176,32,0.8)]'
                    : 'border-[#5c3a1e]',
                )}
              >
                {activeHighlight?.kind === 'storehouse' && activeHighlight.player === oppPlayerIndex && (
                  <span className="absolute -top-3 px-2 py-0.5 text-[9px] font-display bg-pa-amber text-black rounded-full font-bold animate-bounce shadow-md">
                    +1
                  </span>
                )}
                <span className="font-display text-[9px] uppercase tracking-wider text-[#a0744b]">
                  Rumah
                </span>
                <span className="font-display text-[22px] md:text-[28px] tabular text-pa-amber font-bold">
                  {oppStorehouse}
                </span>
                <BeadCluster count={oppStorehouse} />
              </div>
            </div>

            {/* Center: 2 Rows of 7 Houses (Lubang Kampung) */}
            <div className="flex-1 flex flex-col justify-between gap-6 py-2">
              {/* Top Row: Opponent's Houses */}
              <div className="flex items-center justify-around gap-2">
                {oppPitIndices.map((pitIdx, i) => {
                  const count = displayPits[pitIdx] ?? 0;
                  const isTarget = activeHighlight?.kind === 'pit' && activeHighlight.index === pitIdx;
                  const isLastTembak = !isAnimating && view.lastMove?.tembakPit === pitIdx;

                  return (
                    <div key={pitIdx} className="flex flex-col items-center gap-1.5 relative">
                      <span className="text-[10px] font-display text-pa-ink-dim">
                        #{nPits - i}
                      </span>
                      <div
                        className={cn(
                          'w-12 h-12 md:w-16 md:h-16 rounded-full border-2 flex flex-col items-center justify-center transition-all bg-black/40 relative',
                          isTarget
                            ? 'border-pa-amber ring-4 ring-pa-amber/80 scale-110 shadow-[0_0_16px_rgba(255,176,32,0.9)] bg-pa-amber/20'
                            : isLastTembak
                              ? 'border-pa-danger ring-2 ring-pa-danger/50'
                              : 'border-[#5c3a1e]',
                        )}
                      >
                        {isTarget && (
                          <span className="absolute -top-2.5 px-1.5 py-0.5 text-[8px] font-display bg-pa-amber text-black rounded-full font-bold animate-bounce shadow-sm">
                            +1
                          </span>
                        )}
                        <span className="font-display text-[14px] md:text-[16px] tabular text-pa-ink">
                          {count}
                        </span>
                        <BeadCluster count={count} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Middle Divider Track */}
              <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#5c3a1e] to-transparent opacity-60" />

              {/* Bottom Row: Your Houses (Interactive) */}
              <div className="flex items-center justify-around gap-2">
                {myPitIndices.map((pitIdx, i) => {
                  const count = displayPits[pitIdx] ?? 0;
                  const legal = canSow(pitIdx);
                  const isTarget = activeHighlight?.kind === 'pit' && activeHighlight.index === pitIdx;
                  const isLastTembak = !isAnimating && view.lastMove?.tembakPit === pitIdx;

                  return (
                    <div key={pitIdx} className="flex flex-col items-center gap-1.5 relative">
                      <button
                        type="button"
                        disabled={!legal}
                        onClick={() => handleSow(pitIdx)}
                        aria-label={`Sow house #${i + 1} with ${count} seeds`}
                        className={cn(
                          'w-12 h-12 md:w-16 md:h-16 rounded-full border-2 flex flex-col items-center justify-center transition-all relative',
                          isTarget
                            ? 'border-pa-cyan ring-4 ring-pa-cyan/80 scale-110 shadow-[0_0_18px_rgba(34,224,255,0.9)] bg-pa-cyan/25'
                            : legal
                              ? 'cursor-pointer border-pa-cyan bg-pa-cyan/10 hover:bg-pa-cyan/25 hover:scale-105 shadow-[0_0_12px_rgba(34,224,255,0.35)] animate-pulse'
                              : 'border-[#5c3a1e] bg-black/40 cursor-default opacity-85',
                          isLastTembak && 'border-pa-danger ring-2 ring-pa-danger/50',
                        )}
                      >
                        {isTarget && (
                          <span className="absolute -top-2.5 px-1.5 py-0.5 text-[8px] font-display bg-pa-cyan text-black rounded-full font-bold animate-bounce shadow-sm">
                            +1
                          </span>
                        )}
                        <span
                          className={cn(
                            'font-display text-[14px] md:text-[16px] tabular font-bold',
                            legal || isTarget ? 'text-pa-cyan' : 'text-pa-ink',
                          )}
                        >
                          {count}
                        </span>
                        <BeadCluster count={count} />
                      </button>
                      <span
                        className={cn(
                          'text-[10px] font-display',
                          legal || isTarget ? 'text-pa-cyan font-bold' : 'text-pa-ink-dim',
                        )}
                      >
                        #{i + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Storehouse (Your Rumah) */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1.5 text-center mb-1">
                <SeatAvatar
                  seat={myPlayerInfo.seat}
                  displayName={myPlayerInfo.displayName}
                  avatar={myPlayerInfo.avatar}
                  isBot={myPlayerInfo.isBot}
                  size={22}
                />
                <span className="font-display text-[10px] text-pa-cyan truncate max-w-[80px]">
                  {myPlayerInfo.displayName} (You)
                </span>
              </div>

              <div
                className={cn(
                  'w-20 md:w-24 h-40 md:h-48 rounded-full border-4 flex flex-col items-center justify-center p-3 gap-2 transition-all relative',
                  'bg-black/60 shadow-inner',
                  activeHighlight?.kind === 'storehouse' && activeHighlight.player === myPlayerIndex
                    ? 'border-pa-cyan ring-4 ring-pa-cyan/80 scale-105 shadow-[0_0_20px_rgba(34,224,255,0.8)]'
                    : 'border-[#5c3a1e]',
                )}
              >
                {activeHighlight?.kind === 'storehouse' && activeHighlight.player === myPlayerIndex && (
                  <span className="absolute -top-3 px-2 py-0.5 text-[9px] font-display bg-pa-cyan text-black rounded-full font-bold animate-bounce shadow-md">
                    +1
                  </span>
                )}
                <span className="font-display text-[9px] uppercase tracking-wider text-pa-cyan font-bold">
                  Rumah
                </span>
                <span className="font-display text-[22px] md:text-[28px] tabular text-pa-cyan font-bold">
                  {myStorehouse}
                </span>
                <BeadCluster count={myStorehouse} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Game Event Log & Quick Help ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PixelPanel title="How to Play" className="md:col-span-1">
          <ul className="text-[12px] text-pa-ink-dim space-y-1.5 leading-relaxed">
            <li>
              <strong className="text-pa-ink">Sowing:</strong> Pick a house on your side to sow seeds clockwise.
            </li>
            <li>
              <strong className="text-pa-cyan">Extra turn:</strong> Last seed in your own storehouse grants another pick!
            </li>
            <li>
              <strong className="text-pa-magenta">Relay:</strong> Last seed in a non-empty house scoops and continues sowing!
            </li>
            <li>
              <strong className="text-pa-amber">Tembak:</strong> Last seed in an empty house on your side captures the opposite opponent house!
            </li>
          </ul>
        </PixelPanel>

        <PixelPanel title="Match Log" className="md:col-span-2">
          <div className="h-28 overflow-y-auto flex flex-col-reverse gap-1 pr-2 text-[12px] tabular">
            {view.log.length === 0 ? (
              <p className="text-pa-ink-dim italic">Waiting for first move…</p>
            ) : (
              [...view.log].reverse().map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-pa-ink-dim text-[10px]">[{entry.seq}]</span>
                  <span
                    className={cn(
                      entry.text.includes('Tembak')
                        ? 'text-pa-amber font-bold'
                        : entry.text.includes('extra turn')
                          ? 'text-pa-cyan font-bold'
                          : entry.text.includes('wins')
                            ? 'text-pa-success font-bold'
                            : 'text-pa-ink',
                    )}
                  >
                    {entry.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
