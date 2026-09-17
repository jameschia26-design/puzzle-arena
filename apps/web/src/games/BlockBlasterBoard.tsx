import * as React from 'react';
import type {
  BlockBlasterView,
  BlockBlasterPublicPlayer,
  BlockBlasterClearEvent,
} from '@puzzle-arena/games';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_BLASTER_DIFFICULTIES,
  BLOCK_BLASTER_LAYOUTS,
  canPlacePiece,
  hasAnyPlacement,
  getClusterBombCells,
  getCrossBombCells,
  type BlockPiece,
  type BlockBlasterDifficulty,
  type BlockBlasterLayout,
  type BombType,
  type DetonationResult,
} from '@puzzle-arena/shared';
import { PixelButton, PixelPanel } from '../ui/primitives.js';
import { sfx, bgm } from '../ui/sound.js';
import { useRoom } from '../net/socket.js';
import { Flame, Trophy, RotateCcw, Zap, Sparkles, SlidersHorizontal, Bomb, AlertTriangle } from 'lucide-react';
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface FloatingText {
  id: number;
  text: string;
  subtext?: string;
  color: string;
  x: number;
  y: number;
}

function getComboTitle(combo: number, lines: number): { title: string; sub: string; color: string } {
  if (combo >= 5) return { title: 'BLASTER GOD!', sub: `COMBO ×${combo}`, color: '#ec4899' };
  if (combo === 4) return { title: 'UNBELIEVABLE!', sub: `COMBO ×${combo}`, color: '#a855f7' };
  if (combo === 3) return { title: 'SUPER!', sub: `COMBO ×${combo}`, color: '#3b82f6' };
  if (combo === 2) return { title: 'COOL!', sub: `COMBO ×${combo}`, color: '#10b981' };
  if (lines >= 3) return { title: 'TRIPLE BLAST!', sub: `+${lines} LINES`, color: '#f59e0b' };
  if (lines === 2) return { title: 'DOUBLE BLAST!', sub: `+${lines} LINES`, color: '#06b6d4' };
  return { title: 'NICE!', sub: '+1 LINE', color: '#38bdf8' };
}

/**
 * Keep the board layout tied to the real viewport, rather than only to CSS
 * breakpoints. Fullscreen game surfaces can be landscape on a phone/tablet,
 * while desktop needs room for the board and piece tray side by side.
 */
type BlockBlasterViewportMode = 'desktop' | 'portrait' | 'landscape';

interface BlockBlasterViewportInfo {
  mode: BlockBlasterViewportMode;
  width: number;
  height: number;
}

function detectViewport(): BlockBlasterViewportInfo {
  if (typeof window === 'undefined') return { mode: 'portrait', width: 390, height: 844 };
  const width = window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const mode: BlockBlasterViewportMode = width >= 1024 ? 'desktop' : width > height ? 'landscape' : 'portrait';
  return { mode, width, height };
}

function useBlockBlasterViewport(): BlockBlasterViewportInfo {
  const [viewport, setViewport] = React.useState<BlockBlasterViewportInfo>(detectViewport);

  React.useEffect(() => {
    const update = () => setViewport(detectViewport());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    // The mobile URL bar collapsing/expanding fires a visualViewport
    // `scroll` event (the visual viewport's offset changes) even when its
    // `resize` event doesn't fire in every browser, so both are needed to
    // reliably catch the available-height change.
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return viewport;
}

/**
 * Minimum/maximum board pixel size regardless of computed budget - small
 * enough to stay playable, large enough not to look silly on a big screen.
 */
const MIN_BOARD_PX = 120;
const MAX_BOARD_PX_PORTRAIT = 420;
const MAX_BOARD_PX_SIDE_TRAY = 440;

interface GridMetrics {
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  pitchX: number;
  pitchY: number;
}

/**
 * Pixels the dragged piece (and its snapped shadow) is lifted above the
 * pointer, expressed in cell pitches rather than a fixed pixel value so it
 * scales with the board. A finger covers roughly a cell's width of the
 * piece it's holding; lifting by more than a cell keeps the piece and the
 * cells it's about to land on both visible above the thumb.
 */
const DRAG_LIFT_CELLS = 1.25;

export function BlockBlasterBoard({
  view,
  players: _allPlayers,
  youId,
  legalActions: _legalActions,
  turnEndsAt: _turnEndsAt,
  onAction,
}: {
  view: BlockBlasterView;
  players: unknown;
  youId: string | null;
  legalActions: string[];
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);
  const viewport = useBlockBlasterViewport();
  const isDesktop = viewport.mode === 'desktop';
  // Desktop keeps the tray beside the board because there's room; landscape
  // phones need the same side-by-side layout purely to fit the height
  // budget, even though they're nowhere near the `lg:` CSS breakpoint.
  const isSideTray = viewport.mode !== 'portrait';
  // Refs mirroring the latest props/derived values so drag/keyboard listeners
  // never need to tear down and reattach mid-gesture just because a parent
  // re-render (bot tick, leaderboard broadcast, socket reconnect) produced a
  // new `onAction`/`view` reference. Only real gesture start/stop (dragInfo)
  // or genuine input changes should resubscribe.
  const youRef = React.useRef(you);
  youRef.current = you;
  const onActionRef = React.useRef(onAction);
  onActionRef.current = onAction;
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  // Play arcade BGM on mount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Board DOM refs for coordinate math. `boardRef` is the inner 8x8 grid -
  // deliberately with no border/padding of its own - so its bounding rect
  // IS the playfield, and every cell's own rect gives an exact origin/pitch
  // regardless of the grid's `gap`, breakpoint padding, or border width.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hudRef = React.useRef<HTMLDivElement>(null);
  const trayRef = React.useRef<HTMLDivElement>(null);
  const hintRef = React.useRef<HTMLDivElement>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cellRefs = React.useRef<(HTMLDivElement | null)[][]>(
    Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }, () =>
      Array<HTMLDivElement | null>(BLOCK_BLASTER_BOARD_SIZE).fill(null),
    ),
  );

  const measureGrid = React.useCallback((): GridMetrics | null => {
    const c00 = cellRefs.current[0]?.[0];
    const c01 = cellRefs.current[0]?.[1];
    const c10 = cellRefs.current[1]?.[0];
    if (!c00 || !c01 || !c10) return null;
    const r00 = c00.getBoundingClientRect();
    const r01 = c01.getBoundingClientRect();
    const r10 = c10.getBoundingClientRect();
    if (r00.width <= 0 || r00.height <= 0) return null;
    return {
      originX: r00.left,
      originY: r00.top,
      cellW: r00.width,
      cellH: r00.height,
      pitchX: r01.left - r00.left,
      pitchY: r10.top - r00.top,
    };
  }, []);

  // Board pixel size: measured from the REAL rendered chrome around it
  // (this root's offset from the viewport top, the HUD bar, and either the
  // tray row+hint line below it in portrait or the tray column beside it
  // in landscape/desktop), not a hand-guessed budget. This is what lets the
  // board+tray always fit the actual viewport without page scroll,
  // regardless of what sits above this component (dev harness chrome,
  // room header, ...).
  const [boardPixelSize, setBoardPixelSize] = React.useState<number>(320);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // The nearest ancestor that actually clips/scrolls this component (e.g.
    // RoomPage's fullscreen game `<section overflow-y-auto>`) tells us
    // exactly how much vertical room is available below the HUD - real
    // measurement instead of a guessed pixel budget for "whatever chrome
    // the embedding page puts below this component".
    const findScrollAncestor = (el: HTMLElement): HTMLElement | null => {
      let node = el.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'clip') {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };

    const recompute = () => {
      const vw = viewport.width;
      const vh = viewport.height;
      // Anchor on the HUD's own top, not the root's - the root has its own
      // padding (`p-2 sm:p-4`) between its border box and the HUD, and
      // going through the HUD's rect sidesteps having to know that value.
      const anchorTop = hudRef.current?.getBoundingClientRect().top ?? root.getBoundingClientRect().top;
      const hudH = hudRef.current?.getBoundingClientRect().height ?? 0;
      // Prefer the real bottom edge of whatever ancestor actually bounds
      // this component (falls back to the viewport itself when nothing
      // constrains it, e.g. the dev harness). A small pad absorbs that
      // ancestor's own bottom padding/border, not an unknown budget.
      const scrollAncestor = findScrollAncestor(root);
      const visibleBottom = scrollAncestor
        ? Math.min(scrollAncestor.getBoundingClientRect().bottom, vh)
        : vh;
      const bottomPad = 16;
      const sectionGap = 12;
      let size: number;
      if (isSideTray) {
        const trayW = trayRef.current?.getBoundingClientRect().width ?? 170;
        const hintH = hintRef.current?.getBoundingClientRect().height ?? 0;
        // One gap between HUD and board, one for the hint line's own
        // top margin below it.
        const heightBudget = visibleBottom - anchorTop - hudH - sectionGap * 2 - hintH - bottomPad;
        const widthBudget = vw - trayW - 44;
        size = Math.min(heightBudget, widthBudget, MAX_BOARD_PX_SIDE_TRAY);
      } else {
        const trayH = trayRef.current?.getBoundingClientRect().height ?? 0;
        const hintH = hintRef.current?.getBoundingClientRect().height ?? 0;
        const heightBudget = visibleBottom - anchorTop - hudH - trayH - hintH - sectionGap * 2 - bottomPad;
        const widthBudget = vw - 24;
        size = Math.min(heightBudget, widthBudget, MAX_BOARD_PX_PORTRAIT);
      }
      setBoardPixelSize(Math.max(MIN_BOARD_PX, Math.round(size)));
    };

    recompute();
    // The HUD and tray can reflow after this first measurement - a web font
    // swap changing line height, or the tray's own container-query cell
    // sizing settling - so keep watching them instead of trusting one pass.
    const observer = new ResizeObserver(recompute);
    if (hudRef.current) observer.observe(hudRef.current);
    if (trayRef.current) observer.observe(trayRef.current);
    if (hintRef.current) observer.observe(hintRef.current);
    return () => observer.disconnect();
  }, [isSideTray, viewport.width, viewport.height]);

  // Live-measured grid geometry, used for rendering the shadow/floating
  // piece at the exact board scale. Recomputed whenever the board resizes;
  // gesture start also force-refreshes it (see `handleTrayPiecePointerDown`).
  const [gridMetrics, setGridMetrics] = React.useState<GridMetrics | null>(null);
  React.useLayoutEffect(() => {
    setGridMetrics(measureGrid());
  }, [measureGrid, boardPixelSize, paused]);

  // Handle pause / resume and screen visibility changes
  React.useEffect(() => {
    if (paused) {
      // While paused, reset any in-flight dragging or aiming gesture so it doesn't get stuck
      setDragInfo(null);
      setDraggedBomb(null);
      setHoverPos(null);
      setBombHoverPos(null);
      setDragTopLeft(null);
      setBombDragTopLeft(null);
      dragStartRef.current = null;
    } else {
      // Upon resuming, force-refresh grid measurements so drag positions align accurately
      const refresh = () => setGridMetrics(measureGrid());
      refresh();
      const raf = requestAnimationFrame(refresh);
      const timer = setTimeout(refresh, 100);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [paused, measureGrid]);

  // Handle window blur, focus, and visibilitychange (switching tabs, lock screen, etc.)
  React.useEffect(() => {
    const handleLeave = () => {
      setDragInfo(null);
      setDraggedBomb(null);
      setHoverPos(null);
      setBombHoverPos(null);
      setDragTopLeft(null);
      setBombDragTopLeft(null);
      dragStartRef.current = null;
    };

    const handleReturn = () => {
      const refresh = () => setGridMetrics(measureGrid());
      refresh();
      requestAnimationFrame(refresh);
      setTimeout(refresh, 100);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        handleLeave();
      } else {
        handleReturn();
      }
    };

    window.addEventListener('blur', handleLeave);
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleLeave);
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [measureGrid]);
  const fallbackCell = boardPixelSize / BLOCK_BLASTER_BOARD_SIZE;
  const cellMetrics: GridMetrics =
    gridMetrics ?? {
      originX: 0,
      originY: 0,
      cellW: fallbackCell,
      cellH: fallbackCell,
      pitchX: fallbackCell,
      pitchY: fallbackCell,
    };

  // Given a pointer position, the piece being dragged, and where inside
  // that piece the pointer grabbed it (normalised 0..1), compute the
  // piece's rendered top-left (screen coords, lift included), whether it
  // overlaps the board, and - if so - the snapped board cell. This is the
  // single source of truth for both the floating piece and its shadow, so
  // it is impossible for them to disagree about where the piece is.
  const computeDragFrame = React.useCallback(
    (
      clientX: number,
      clientY: number,
      piece: BlockPiece,
      grabOffset: { x: number; y: number },
    ): {
      topLeft: { x: number; y: number };
      overlapsBoard: boolean;
      hoverPos: { row: number; col: number; valid: boolean } | null;
    } | null => {
      const metrics = measureGrid();
      if (!metrics) return null;
      const pieceWidthPx = (piece.width - 1) * metrics.pitchX + metrics.cellW;
      const pieceHeightPx = (piece.height - 1) * metrics.pitchY + metrics.cellH;
      const liftPx = metrics.pitchY * DRAG_LIFT_CELLS;
      const topLeftX = clientX - grabOffset.x * pieceWidthPx;
      const topLeftY = clientY - grabOffset.y * pieceHeightPx - liftPx;

      const boardRect = boardRef.current?.getBoundingClientRect();
      const overlapsBoard = boardRect
        ? topLeftX < boardRect.right &&
          topLeftX + pieceWidthPx > boardRect.left &&
          topLeftY < boardRect.bottom &&
          topLeftY + pieceHeightPx > boardRect.top
        : false;

      let hoverPos: { row: number; col: number; valid: boolean } | null = null;
      const currentYou = youRef.current;
      if (overlapsBoard && currentYou) {
        let col = Math.round((topLeftX - metrics.originX) / metrics.pitchX);
        let row = Math.round((topLeftY - metrics.originY) / metrics.pitchY);
        col = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.width, col));
        row = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.height, row));
        hoverPos = { row, col, valid: canPlacePiece(currentYou.board, piece, row, col) };
      }

      return { topLeft: { x: topLeftX, y: topLeftY }, overlapsBoard, hoverPos };
    },
    [measureGrid],
  );

  // Selected piece from tray for click-to-place / keyboard controls
  const [selectedPieceIdx, setSelectedPieceIdx] = React.useState<number | null>(null);
  const [isDraggingOverBoard, setIsDraggingOverBoard] = React.useState(false);

  // Dragging state. `grabOffset` is where inside the piece's own rendered
  // box (not the tray slot) the pointer went down, normalised 0..1.
  const [dragInfo, setDragInfo] = React.useState<{
    pieceIndex: number;
    piece: BlockPiece;
    grabOffset: { x: number; y: number };
  } | null>(null);
  const [dragTopLeft, setDragTopLeft] = React.useState<{ x: number; y: number } | null>(null);
  const [hoverPos, setHoverPos] = React.useState<{ row: number; col: number; valid: boolean } | null>(null);

  const hoverPosRef = React.useRef(hoverPos);
  hoverPosRef.current = hoverPos;

  // Track pointer start to distinguish click/tap from drag
  const dragStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);

  // Brief red flash on the tray slot when a drop is rejected
  const [shakeTrayIdx, setShakeTrayIdx] = React.useState<number | null>(null);
  // Bomb Inventory & Drag/Aim state
  const [selectedBombType, setSelectedBombType] = React.useState<BombType | null>(null);
  const [draggedBomb, setDraggedBomb] = React.useState<{ type: BombType } | null>(null);
  const [bombDragTopLeft, setBombDragTopLeft] = React.useState<{ x: number; y: number } | null>(null);
  const [bombHoverPos, setBombHoverPos] = React.useState<{ row: number; col: number } | null>(null);
  const bombHoverPosRef = React.useRef(bombHoverPos);
  bombHoverPosRef.current = bombHoverPos;

  // Stack same bomb types together into at most 2 entries (cluster and cross) with counts
  const stackedBombs = React.useMemo<{ type: BombType; count: number }[]>(() => {
    if (!you?.bombs || you.bombs.length === 0) return [];
    let clusterCount = 0;
    let crossCount = 0;
    for (const b of you.bombs) {
      if (b === 'cluster') clusterCount++;
      else if (b === 'cross') crossCount++;
    }
    const list: { type: BombType; count: number }[] = [];
    if (clusterCount > 0) list.push({ type: 'cluster', count: clusterCount });
    if (crossCount > 0) list.push({ type: 'cross', count: crossCount });
    return list;
  }, [you?.bombs]);

  // Track exploding cells from bomb detonation for board white-flash effect
  const [explodingCellKeys, setExplodingCellKeys] = React.useState<Set<string>>(new Set());
  const prevDetonation = React.useRef<DetonationResult | null>(null);
  const prevBombsDetonated = React.useRef(you?.bombsDetonated ?? 0);
  const hasShownBombInstruction = React.useRef(false);
  // Check if player has no legal moves for tray blocks, but can continue with available bombs
  const isStuckWithBombs = React.useMemo(() => {
    if (!you || you.gameOver || you.bombs.length === 0) return false;
    const remaining = you.tray.filter((p): p is BlockPiece => p !== null);
    if (remaining.length === 0) return false;
    return !remaining.some((p) => hasAnyPlacement(you.board, p));
  }, [you]);

  // Active bomb type (from dragging or selection) and aiming blast radius preview
  const activeBombType = draggedBomb
    ? draggedBomb.type
    : selectedBombType !== null && you?.bombs.includes(selectedBombType)
      ? selectedBombType
      : null;
  const bombBlastPreview = React.useMemo(() => {
    if (!activeBombType || !bombHoverPos) return null;
    const cells =
      activeBombType === 'cluster'
        ? getClusterBombCells(bombHoverPos.row, bombHoverPos.col)
        : getCrossBombCells(bombHoverPos.row, bombHoverPos.col);
    return {
      type: activeBombType,
      epicenter: bombHoverPos,
      cells,
    };
  }, [activeBombType, bombHoverPos]);

  // Difficulty & Layout controls menu
  const [showConfigMenu, setShowConfigMenu] = React.useState(false);
  const activeDifficulty: BlockBlasterDifficulty = view.config.difficulty ?? 'normal';
  const activeLayout: BlockBlasterLayout = view.config.startingLayout ?? 'templated';

  // Particle & floating announcements state
  const particlesRef = React.useRef<Particle[]>([]);
  const [floatingAnnouncements, setFloatingAnnouncements] = React.useState<FloatingText[]>([]);
  const nextFloatId = React.useRef(1);

  // Blasting lines animation state
  const [blastingRows, setBlastingRows] = React.useState<number[]>([]);
  const [blastingCols, setBlastingCols] = React.useState<number[]>([]);

  // Track previous lines & lastClear for triggering FX
  const prevPiecesPlaced = React.useRef(you?.piecesPlaced ?? 0);
  const prevClear = React.useRef<BlockBlasterClearEvent | null>(null);

  // Watch for clear events to spawn audio & particles
  React.useEffect(() => {
    if (!you) return;
    if (you.piecesPlaced > prevPiecesPlaced.current) {
      prevPiecesPlaced.current = you.piecesPlaced;
      if (you.lastClear && you.lastClear !== prevClear.current) {
        prevClear.current = you.lastClear;
        const { rows, cols, points, combo } = you.lastClear;
        const totalLines = rows.length + cols.length;

        if (totalLines > 0) {
          sfx.blockBlastClear(combo);
          setBlastingRows(rows);
          setBlastingCols(cols);

          if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const metrics = measureGrid();
            const cw = metrics?.cellW ?? rect.width / BLOCK_BLASTER_BOARD_SIZE;
            const ch = metrics?.cellH ?? rect.height / BLOCK_BLASTER_BOARD_SIZE;
            const px = metrics?.pitchX ?? rect.width / BLOCK_BLASTER_BOARD_SIZE;
            const py = metrics?.pitchY ?? rect.height / BLOCK_BLASTER_BOARD_SIZE;

            const clearedCells = new Set<string>();
            for (const r of rows) {
              for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) clearedCells.add(`${r},${c}`);
            }
            for (const c of cols) {
              for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) clearedCells.add(`${r},${c}`);
            }

            clearedCells.forEach((key) => {
              const [rStr, cStr] = key.split(',');
              const r = Number(rStr);
              const c = Number(cStr);
              const cx = c * px + cw / 2;
              const cy = r * py + ch / 2;

              for (let i = 0; i < 9; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                particlesRef.current.push({
                  x: cx,
                  y: cy,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  size: 3 + Math.random() * 4,
                  color: '#fbbf24',
                  alpha: 1,
                  life: 0,
                  maxLife: 22 + Math.random() * 14,
                });
              }
            });

            const comboInfo = getComboTitle(combo, totalLines);
            const announcements: FloatingText[] = [
              {
                id: nextFloatId.current++,
                text: comboInfo.title,
                subtext: `${comboInfo.sub} (+${points} PTS)`,
                color: comboInfo.color,
                x: rect.width / 2,
                y: rect.height / 2,
              },
            ];

            if (you.lastClear.claimedBomb) {
              const bType = you.lastClear.claimedBomb;
              const isFirstTime = !hasShownBombInstruction.current;
              hasShownBombInstruction.current = true;

              announcements.push({
                id: nextFloatId.current++,
                text: bType === 'cluster' ? '💣 CLUSTER BOMB CLAIMED!' : '⚡ CROSS BOMB CLAIMED!',
                subtext: isFirstTime ? 'DRAG FROM INVENTORY TO DETONATE' : undefined,
                color: bType === 'cluster' ? '#f97316' : '#a855f7',
                x: rect.width / 2,
                y: rect.height / 3,
              });
            }
            setFloatingAnnouncements((prev) => [...prev, ...announcements]);
          }

          setTimeout(() => {
            setBlastingRows([]);
            setBlastingCols([]);
          }, 240);
        }
      }
    }
  }, [you?.piecesPlaced, you?.lastClear, you, measureGrid]);
  // Watch for bomb detonation events to trigger explosion FX, audio & announcements
  React.useEffect(() => {
    if (!you?.lastDetonation) return;
    if (you.bombsDetonated <= prevBombsDetonated.current) return;
    prevBombsDetonated.current = you.bombsDetonated;
    prevDetonation.current = you.lastDetonation;
    const det = you.lastDetonation;
    sfx.bomb();

    // Flash the cleared cells
    const cellKeys = new Set(det.clearedCells.map((c) => `${c.row},${c.col}`));
    setExplodingCellKeys(cellKeys);
    const flashTimer = setTimeout(() => setExplodingCellKeys(new Set()), 320);

    if (boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const metrics = measureGrid();
      const cw = metrics?.cellW ?? rect.width / BLOCK_BLASTER_BOARD_SIZE;
      const ch = metrics?.cellH ?? rect.height / BLOCK_BLASTER_BOARD_SIZE;
      const px = metrics?.pitchX ?? rect.width / BLOCK_BLASTER_BOARD_SIZE;
      const py = metrics?.pitchY ?? rect.height / BLOCK_BLASTER_BOARD_SIZE;

      const epicX = det.col * px + cw / 2;
      const epicY = det.row * py + ch / 2;

      if (det.type === 'cluster') {
        // 55+ radial explosion particles (fire, amber, smoke)
        for (let i = 0; i < 55; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 6.5;
          const colors = ['#f97316', '#ef4444', '#fbbf24', '#ffffff', '#78716c'];
          const color = colors[Math.floor(Math.random() * colors.length)]!;
          particlesRef.current.push({
            x: epicX,
            y: epicY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 4 + Math.random() * 6,
            color,
            alpha: 1,
            life: 0,
            maxLife: 28 + Math.random() * 16,
          });
        }

        setFloatingAnnouncements((prev) => [
          ...prev,
          {
            id: nextFloatId.current++,
            text: '💥 3×3 CLUSTER BLAST!',
            subtext: `DESTROYED ${det.clearedCount} BRICKS (+${det.points} PTS)`,
            color: '#f97316',
            x: epicX,
            y: epicY,
          },
        ]);
      } else {
        // Cross bomb: dual horizontal and vertical shockwave particle beams
        for (let i = 0; i < 35; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const speed = 4 + Math.random() * 7;
          particlesRef.current.push({
            x: epicX,
            y: epicY + (Math.random() - 0.5) * ch * 0.6,
            vx: dir * speed,
            vy: (Math.random() - 0.5) * 1.5,
            size: 4 + Math.random() * 5,
            color: Math.random() < 0.5 ? '#a855f7' : '#06b6d4',
            alpha: 1,
            life: 0,
            maxLife: 24 + Math.random() * 12,
          });
        }
        for (let i = 0; i < 35; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const speed = 4 + Math.random() * 7;
          particlesRef.current.push({
            x: epicX + (Math.random() - 0.5) * cw * 0.6,
            y: epicY,
            vx: (Math.random() - 0.5) * 1.5,
            vy: dir * speed,
            size: 4 + Math.random() * 5,
            color: Math.random() < 0.5 ? '#c084fc' : '#22d3ee',
            alpha: 1,
            life: 0,
            maxLife: 24 + Math.random() * 12,
          });
        }

        setFloatingAnnouncements((prev) => [
          ...prev,
          {
            id: nextFloatId.current++,
            text: '⚡ CROSS BEAM BLAST!',
            subtext: `DESTROYED ${det.clearedCount} BRICKS (+${det.points} PTS)`,
            color: '#a855f7',
            x: epicX,
            y: epicY,
          },
        ]);
      }
    }

    return () => clearTimeout(flashTimer);
  }, [you?.lastDetonation, measureGrid]);

  // Particle animation canvas loop
  React.useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.09;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Sync canvas size with board
  React.useEffect(() => {
    const updateCanvas = () => {
      if (boardRef.current && canvasRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
      }
    };
    updateCanvas();
    window.addEventListener('resize', updateCanvas);
    return () => window.removeEventListener('resize', updateCanvas);
  }, [boardPixelSize]);

  // Clear floating announcements
  React.useEffect(() => {
    if (floatingAnnouncements.length === 0) return;
    const timer = setTimeout(() => {
      setFloatingAnnouncements((prev) => prev.slice(1));
    }, 1200);
    return () => clearTimeout(timer);
  }, [floatingAnnouncements]);

  // Currently active piece (either being dragged or selected via tap)
  const activePiece: BlockPiece | null =
    dragInfo !== null ? dragInfo.piece : selectedPieceIdx !== null ? (you?.tray[selectedPieceIdx] ?? null) : null;

  // Global window drag event listeners
  React.useEffect(() => {
    if (!dragInfo) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      const frame = computeDragFrame(e.clientX, e.clientY, dragInfo.piece, dragInfo.grabOffset);
      if (!frame) return;
      setDragTopLeft(frame.topLeft);
      setIsDraggingOverBoard(frame.overlapsBoard);
      setHoverPos(frame.hoverPos);
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      const start = dragStartRef.current;
      const dist = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 100;
      const currentHover = hoverPosRef.current;
      const draggedIdx = dragInfo.pieceIndex;

      if (dist < 8) {
        setSelectedPieceIdx((prev) => (prev === draggedIdx ? null : draggedIdx));
        sfx.blip();
      } else if (currentHover?.valid) {
        sfx.blockPlace();
        onActionRef.current({
          type: 'place',
          pieceIndex: draggedIdx,
          row: currentHover.row,
          col: currentHover.col,
        });
        setSelectedPieceIdx(null);
      } else {
        sfx.blockInvalid();
        setShakeTrayIdx(draggedIdx);
        window.setTimeout(() => setShakeTrayIdx((prev) => (prev === draggedIdx ? null : prev)), 220);
      }

      setHoverPos(null);
      setDragInfo(null);
      setDragTopLeft(null);
      setIsDraggingOverBoard(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [dragInfo, computeDragFrame]);
  // Global window bomb drag event listeners
  React.useEffect(() => {
    if (!draggedBomb) return;

    const onWindowBombMove = (e: PointerEvent) => {
      setBombDragTopLeft({ x: e.clientX, y: e.clientY });
      const metrics = measureGrid();
      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!metrics || !boardRect) {
        setBombHoverPos(null);
        return;
      }
      const liftPx = metrics.pitchY * DRAG_LIFT_CELLS;
      const targetY = e.clientY - liftPx;

      if (
        e.clientX >= boardRect.left &&
        e.clientX <= boardRect.right &&
        targetY >= boardRect.top &&
        targetY <= boardRect.bottom
      ) {
        let col = Math.round((e.clientX - metrics.originX - metrics.cellW / 2) / metrics.pitchX);
        let row = Math.round((targetY - metrics.originY - metrics.cellH / 2) / metrics.pitchY);
        col = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, col));
        row = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, row));
        setBombHoverPos({ row, col });
      } else {
        setBombHoverPos(null);
      }
    };

    const onWindowBombUp = (e: PointerEvent) => {
      const start = dragStartRef.current;
      const dist = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 100;
      const currentHover = bombHoverPosRef.current;
      const bombType = draggedBomb.type;

      if (dist < 8) {
        // Tap in inventory toggles selection
        setSelectedBombType((prev) => (prev === bombType ? null : bombType));
        sfx.blip();
      } else if (currentHover) {
        const bombIndex = youRef.current?.bombs.indexOf(bombType) ?? -1;
        if (bombIndex !== -1) {
          onActionRef.current({
            type: 'useBomb',
            bombIndex,
            row: currentHover.row,
            col: currentHover.col,
          });
        }
        setSelectedBombType(null);
      } else {
        sfx.blockInvalid();
      }

      setDraggedBomb(null);
      setBombHoverPos(null);
      setBombDragTopLeft(null);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onWindowBombMove);
    window.addEventListener('pointerup', onWindowBombUp);
    window.addEventListener('pointercancel', onWindowBombUp);

    return () => {
      window.removeEventListener('pointermove', onWindowBombMove);
      window.removeEventListener('pointerup', onWindowBombUp);
      window.removeEventListener('pointercancel', onWindowBombUp);
    };
  }, [draggedBomb, measureGrid]);

  const handleBombPointerDown = (e: React.PointerEvent, type: BombType) => {
    if (paused || you?.gameOver) return;
    if (!you?.bombs.includes(type)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    setSelectedPieceIdx(null);
    setDragInfo(null);
    setDraggedBomb({ type });
    setBombDragTopLeft({ x: e.clientX, y: e.clientY });

    const metrics = measureGrid();
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (metrics && boardRect) {
      const liftPx = metrics.pitchY * DRAG_LIFT_CELLS;
      const targetY = e.clientY - liftPx;
      if (
        e.clientX >= boardRect.left &&
        e.clientX <= boardRect.right &&
        targetY >= boardRect.top &&
        targetY <= boardRect.bottom
      ) {
        let col = Math.round((e.clientX - metrics.originX - metrics.cellW / 2) / metrics.pitchX);
        let row = Math.round((targetY - metrics.originY - metrics.cellH / 2) / metrics.pitchY);
        col = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, col));
        row = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, row));
        setBombHoverPos({ row, col });
      }
    }
  };

  // Pointer down on a tray piece
  const handleTrayPiecePointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    if (paused || you?.gameOver) return;
    const piece = you?.tray[idx];
    if (!piece) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture isn't universally supported; the window-level
      // listeners below still drive the gesture without it.
    }

    // Grab offset is measured against the piece's own rendered box, not the
    // (often larger, square) tray slot around it - a 1x4 piece grabbed near
    // the edge of its square slot would otherwise map outside the piece.
    const pieceEl = e.currentTarget.querySelector<HTMLElement>('[data-piece-grid]');
    const pieceRect = pieceEl?.getBoundingClientRect();
    const grabOffset =
      pieceRect && pieceRect.width > 0 && pieceRect.height > 0
        ? {
            x: Math.min(1, Math.max(0, (e.clientX - pieceRect.left) / pieceRect.width)),
            y: Math.min(1, Math.max(0, (e.clientY - pieceRect.top) / pieceRect.height)),
          }
        : { x: 0.5, y: 0.5 };

    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    setDragInfo({ pieceIndex: idx, piece, grabOffset });
    setGridMetrics(measureGrid());

    const frame = computeDragFrame(e.clientX, e.clientY, piece, grabOffset);
    if (frame) {
      setDragTopLeft(frame.topLeft);
      setIsDraggingOverBoard(frame.overlapsBoard);
      setHoverPos(frame.hoverPos);
    }
  };

  // Hovering over board cells in Click-to-Place / Aim mode
  const handleBoardPointerMove = (e: React.PointerEvent) => {
    if (dragInfo || draggedBomb || !you) return;

    // Bomb aiming mode
    if (selectedBombType !== null && you.bombs.includes(selectedBombType)) {
      const metrics = measureGrid();
      if (!metrics) return;
      let col = Math.round((e.clientX - metrics.originX) / metrics.pitchX);
      let row = Math.round((e.clientY - metrics.originY) / metrics.pitchY);
      col = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, col));
      row = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - 1, row));
      setBombHoverPos({ row, col });
      return;
    }

    if (selectedPieceIdx === null) return;
    const piece = you.tray[selectedPieceIdx];
    if (!piece) return;
    const metrics = measureGrid();
    if (!metrics) return;
    let col = Math.floor((e.clientX - metrics.originX) / metrics.pitchX);
    let row = Math.floor((e.clientY - metrics.originY) / metrics.pitchY);
    col = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.width, col));
    row = Math.max(0, Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.height, row));
    setHoverPos({ row, col, valid: canPlacePiece(you.board, piece, row, col) });
  };

  // Clicking a cell in Click-to-Place / Aim mode
  const handleCellClick = (r: number, c: number) => {
    if (paused || you?.gameOver || !you) return;

    // If a bomb is selected, click cell to detonate!
    if (selectedBombType !== null && you.bombs.includes(selectedBombType)) {
      const bombIndex = you.bombs.indexOf(selectedBombType);
      if (bombIndex !== -1) {
        onActionRef.current({
          type: 'useBomb',
          bombIndex,
          row: r,
          col: c,
        });
      }
      setSelectedBombType(null);
      setBombHoverPos(null);
      return;
    }

    if (selectedPieceIdx === null) return;
    const piece = you.tray[selectedPieceIdx];
    if (!piece) return;

    if (canPlacePiece(you.board, piece, r, c)) {
      sfx.blockPlace();
      onActionRef.current({ type: 'place', pieceIndex: selectedPieceIdx, row: r, col: c });
      setSelectedPieceIdx(null);
      setHoverPos(null);
    } else {
      sfx.blockInvalid();
    }
  };
  // Keyboard controls for full accessibility
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const currentYou = youRef.current;
      if (pausedRef.current || currentYou?.gameOver) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const idx = Number(e.key) - 1;
        if (currentYou?.tray[idx]) {
          setSelectedPieceIdx((prev) => (prev === idx ? null : idx));
          setSelectedBombType(null);
          sfx.blip();
        }
      } else if (e.key === 'b' || e.key === 'B' || e.key === '4') {
        if (currentYou?.bombs && currentYou.bombs.length > 0) {
          const firstType = currentYou.bombs.includes('cluster') ? 'cluster' : currentYou.bombs[0]!;
          setSelectedBombType((prev) => (prev === firstType ? null : firstType));
          setSelectedPieceIdx(null);
          sfx.blip();
        }
      } else if (e.key === '5' || e.key === 'c' || e.key === 'C') {
        if (currentYou?.bombs && currentYou.bombs.includes('cross')) {
          setSelectedBombType((prev) => (prev === 'cross' ? null : 'cross'));
          setSelectedPieceIdx(null);
          sfx.blip();
        }
      } else if (e.key === 'Escape') {
        setSelectedPieceIdx(null);
        setSelectedBombType(null);
        setHoverPos(null);
        setBombHoverPos(null);
      } else if ((e.key === 'Enter' || e.key === ' ') && selectedPieceIdx !== null) {
        e.preventDefault();
        if (hoverPosRef.current?.valid) {
          sfx.blockPlace();
          onActionRef.current({
            type: 'place',
            pieceIndex: selectedPieceIdx,
            row: hoverPosRef.current.row,
            col: hoverPosRef.current.col,
          });
          setSelectedPieceIdx(null);
          setHoverPos(null);
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedPieceIdx !== null) {
        e.preventDefault();
        const piece = currentYou?.tray[selectedPieceIdx];
        if (!piece || !currentYou) return;
        setHoverPos((prev) => {
          const curR = prev?.row ?? 0;
          const curC = prev?.col ?? 0;
          let nextR = curR;
          let nextC = curC;
          if (e.key === 'ArrowUp') nextR = Math.max(0, curR - 1);
          if (e.key === 'ArrowDown') nextR = Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.height, curR + 1);
          if (e.key === 'ArrowLeft') nextC = Math.max(0, curC - 1);
          if (e.key === 'ArrowRight') nextC = Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.width, curC + 1);
          return { row: nextR, col: nextC, valid: canPlacePiece(currentYou.board, piece, nextR, nextC) };
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPieceIdx]);

  // The piece shadow: shown constantly whenever a piece is being held over
  // the board (drag) or hovered via tap-to-select/keyboard, in EITHER the
  // legal or illegal state - never hidden. Validity colouring happens where
  // it's rendered. Suppressed only while actively dragging off the board,
  // where the free-floating copy is the sole representation instead.
  const shadowPreview = React.useMemo(() => {
    if (!activePiece || !hoverPos) return null;
    if (dragInfo !== null && !isDraggingOverBoard) return null;
    return {
      row: hoverPos.row,
      col: hoverPos.col,
      valid: hoverPos.valid,
      shape: activePiece.shape,
      color: activePiece.color,
    };
  }, [activePiece, hoverPos, dragInfo, isDraggingOverBoard]);

  // Rows/columns that would complete if the shadow were placed - only
  // meaningful (and only shown) for a legal placement.
  const lineCompletionPreview = React.useMemo(() => {
    if (!you || !shadowPreview || !shadowPreview.valid) return null;
    const { row, col, shape } = shadowPreview;

    const testBoard = you.board.map((r) => [...r]);
    for (let r = 0; r < shape.length; r++) {
      const sRow = shape[r];
      if (!sRow) continue;
      for (let c = 0; c < sRow.length; c++) {
        if (sRow[c] === 1) {
          const bRow = testBoard[row + r];
          if (bRow) bRow[col + c] = shadowPreview.color;
        }
      }
    }

    const fullRows: number[] = [];
    const fullCols: number[] = [];
    for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
      const rRow = testBoard[r];
      if (rRow && rRow.every((cell) => cell !== 0)) fullRows.push(r);
    }
    for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) {
      let isColFull = true;
      for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
        const rRow = testBoard[r];
        if (!rRow || rRow[c] === 0) {
          isColFull = false;
          break;
        }
      }
      if (isColFull) fullCols.push(c);
    }

    return { fullRows, fullCols };
  }, [you, shadowPreview]);

  const handleRestart = (diff?: BlockBlasterDifficulty, lay?: BlockBlasterLayout) => {
    sfx.blip();
    onAction({
      type: 'restart',
      difficulty: diff ?? activeDifficulty,
      startingLayout: lay ?? activeLayout,
    });
    setSelectedPieceIdx(null);
    setSelectedBombType(null);
    setDraggedBomb(null);
    setBombHoverPos(null);
    setHoverPos(null);
    prevBombsDetonated.current = 0;
    setShowConfigMenu(false);
  };

  const isLandscape = viewport.mode === 'landscape';
  const boardColumnClass = isDesktop
    ? 'relative grid grid-cols-[auto_170px] items-start gap-x-5'
    : isLandscape
      ? 'relative grid grid-cols-[auto_220px] items-start gap-x-4'
      : 'relative flex flex-col items-center';
  const sideColumnClass = isDesktop
    ? 'flex flex-col items-center gap-3 col-start-2 row-start-1 w-[170px]'
    : isLandscape
      ? 'flex flex-col items-center gap-2 col-start-2 row-start-1 w-[220px]'
      : 'flex flex-col items-center gap-2 mt-3 w-full min-w-0';
  const trayClass = isDesktop
    ? 'flex flex-col items-center gap-3 w-full'
    : isLandscape
      ? 'grid grid-cols-3 items-center justify-items-center gap-2 w-full'
      : 'grid grid-cols-3 items-center justify-items-center gap-3 sm:gap-6 w-full min-w-0';
  const hintClass = isSideTray ? 'flex items-center justify-center gap-2 mt-3 col-span-2 row-start-2' : 'flex items-center gap-2 mt-2';
  const traySlotSizeClass = isLandscape ? 'max-w-[64px]' : 'max-w-28';

  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col items-center justify-between w-full max-w-4xl mx-auto p-2 sm:p-4 select-none touch-none ${isDesktop ? 'pb-8' : ''}`}
    >
      {/* Top Arcade HUD */}
      <div
        ref={hudRef}
        className="w-full flex items-center justify-between gap-2 mb-3 px-3 py-2 bg-pa-surface border-2 border-pa-border pa-shadow"
      >
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim">Score</span>
            <span className="font-display text-2xl sm:text-3xl text-pa-cyan font-bold tracking-tight">
              {you?.score ?? 0}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim flex items-center gap-1">
              <Trophy size={10} className="text-yellow-400" /> Best
            </span>
            <span className="font-display text-sm sm:text-base text-yellow-400 font-bold">
              {Math.max(you?.highScore ?? 0, you?.score ?? 0)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Difficulty Badge */}
          <button
            type="button"
            onClick={() => setShowConfigMenu((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-1 bg-pa-bg border border-pa-border rounded hover:border-pa-cyan cursor-pointer transition-colors"
          >
            <SlidersHorizontal size={12} className="text-pa-cyan" />
            <span className="font-display text-[9px] uppercase text-pa-cyan font-bold">
              {activeDifficulty}
            </span>
          </button>

          {/* Combo Streak Indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-pa-bg border border-pa-border rounded">
            <Flame
              size={16}
              className={you?.comboStreak && you.comboStreak > 0 ? 'text-orange-500 animate-pulse' : 'text-pa-ink-dim'}
            />
            <div className="flex flex-col items-start leading-none">
              <span className="font-display text-[8px] uppercase text-pa-ink-dim">Combo</span>
              <span
                className={`font-display text-xs sm:text-sm font-bold ${
                  you?.comboStreak && you.comboStreak > 0 ? 'text-orange-400' : 'text-pa-ink-dim'
                }`}
              >
                {you?.comboStreak && you.comboStreak > 0 ? `×${you.comboStreak}` : '0'}
              </span>
            </div>
          </div>

          <div className="hidden xs:flex flex-col items-end">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim flex items-center gap-1">
              <Zap size={10} className="text-pa-cyan" /> Blasted
            </span>
            <span className="font-display text-xs sm:text-sm text-pa-ink font-bold">
              {you?.linesCleared ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Difficulty & Starting Template Menu Dropdown */}
      {showConfigMenu && (
        <div className="w-full mb-3 p-3 bg-pa-surface border-2 border-pa-cyan pa-shadow rounded-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-xs text-pa-cyan font-bold flex items-center gap-1">
              <Sparkles size={13} /> SELECT DIFFICULTY &amp; STARTING BOARD
            </span>
            <button
              type="button"
              onClick={() => setShowConfigMenu(false)}
              className="text-xs text-pa-ink-dim hover:text-white px-2 py-0.5 border border-pa-border rounded"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <span className="font-display text-[9px] uppercase text-pa-ink-dim mb-1 block">Difficulty</span>
              <div className="flex gap-1.5">
                {BLOCK_BLASTER_DIFFICULTIES.map((d: BlockBlasterDifficulty) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleRestart(d, activeLayout)}
                    className={`flex-1 py-1.5 px-2 text-xs font-display uppercase tracking-wider border rounded cursor-pointer ${
                      activeDifficulty === d
                        ? 'bg-pa-cyan text-black border-pa-cyan font-bold'
                        : 'bg-pa-bg text-pa-ink border-pa-border hover:border-pa-cyan'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-2">
              <span className="font-display text-[9px] uppercase text-pa-ink-dim mb-1 block">Starting Board</span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {BLOCK_BLASTER_LAYOUTS.map((lay: BlockBlasterLayout) => (
                  <button
                    key={lay}
                    type="button"
                    onClick={() => handleRestart(activeDifficulty, lay)}
                    className={`py-1.5 px-1 text-[10px] font-display uppercase tracking-tight border rounded cursor-pointer truncate ${
                      activeLayout === lay
                        ? 'bg-pa-cyan text-black border-pa-cyan font-bold'
                        : 'bg-pa-bg text-pa-ink border-pa-border hover:border-pa-cyan'
                    }`}
                    title={lay}
                  >
                    {lay}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`flex flex-col lg:flex-row items-center lg:items-start justify-center gap-4 w-full ${isDesktop ? 'overflow-visible' : ''}`}>
        {/* Main 8x8 Board Container */}
        <div className={boardColumnClass}>
          {/* No space for blocks warning banner */}
          {isStuckWithBombs && (
            <div className="w-full col-span-full mb-2 p-2 bg-gradient-to-r from-red-950 via-amber-950 to-red-950 border-2 border-amber-400 rounded-sm pa-shadow flex items-center justify-center gap-2 animate-pulse z-20">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 animate-bounce" />
              <span className="font-display text-[10px] sm:text-xs font-black text-amber-300 uppercase tracking-wider text-center">
                NO SPACE FOR BRICKS! DETONATE A BOMB TO CLEAR ROOM!
              </span>
            </div>
          )}

          <div
            className="relative bg-slate-950 border-4 border-pa-border pa-shadow rounded-sm p-2 sm:p-2.5"
            style={{
              width: boardPixelSize,
              height: boardPixelSize,
              boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5)',
            }}
          >
            <div
              ref={boardRef}
              onPointerMove={handleBoardPointerMove}
              onPointerLeave={() => {
                if (dragInfo === null && draggedBomb === null && selectedPieceIdx !== null) setHoverPos(null);
                if (draggedBomb === null && selectedBombType !== null) setBombHoverPos(null);
              }}
              className="relative grid grid-cols-8 grid-rows-8 gap-1 w-full h-full"
              style={{ touchAction: 'none' }}
            >
              {/* 8x8 Cells */}
              {Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, r) =>
                Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, c) => {
                  const cellVal = you?.board[r]?.[c] ?? 0;
                  const isOccupied = cellVal !== 0;

                  // Bonus bomb block detection
                  const isBonusBomb = you?.bonusBomb && you.bonusBomb.row === r && you.bonusBomb.col === c;
                  const bonusBombType = isBonusBomb ? you.bonusBomb!.type : null;

                  // Bomb detonation explosion flash
                  const isExploding = explodingCellKeys.has(`${r},${c}`);

                  // Line clearing highlight cue - only for a legal placement
                  const isRowGlowing = lineCompletionPreview?.fullRows.includes(r);
                  const isColGlowing = lineCompletionPreview?.fullCols.includes(c);
                  const isBlasting = blastingRows.includes(r) || blastingCols.includes(c);

                  return (
                    <div
                      key={`${r}-${c}`}
                      ref={(el) => {
                        cellRefs.current[r]![c] = el;
                      }}
                      onClick={() => handleCellClick(r, c)}
                      className={`relative rounded-xs transition-all duration-75 flex items-center justify-center ${
                        isOccupied
                          ? 'pa-press'
                          : 'bg-slate-900/90 border border-slate-800/80 hover:border-slate-500'
                      } ${
                        (isRowGlowing || isColGlowing) && !isOccupied
                          ? 'ring-2 ring-yellow-400 bg-yellow-400/30 animate-pulse'
                          : ''
                      } ${isBlasting ? 'scale-75 opacity-40 brightness-150' : ''} ${
                        isExploding ? 'scale-125 brightness-200 bg-white shadow-[0_0_16px_white] z-20 transition-transform duration-75' : ''
                      }`}
                      style={{
                        backgroundColor: isExploding
                          ? '#ffffff'
                          : isOccupied
                            ? (cellVal as string)
                            : undefined,
                        boxShadow: isOccupied
                          ? 'inset 2px 2px 0px rgba(255,255,255,0.45), inset -2px -2px 0px rgba(0,0,0,0.5)'
                          : undefined,
                      }}
                    >
                      {/* Occupied block bevel highlight */}
                      {isOccupied && !isBonusBomb && !isExploding && (
                        <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white/40 rounded-xs pointer-events-none" />
                      )}

                      {/* Bonus Bomb Block on Board */}
                      {isBonusBomb && (
                        <div
                          className={`absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xs ring-2 overflow-hidden select-none pointer-events-none ${
                            bonusBombType === 'cluster'
                              ? 'ring-orange-400 bg-orange-600/50 shadow-[0_0_14px_rgba(249,115,22,0.9)] animate-pulse'
                              : 'ring-purple-400 bg-purple-600/50 shadow-[0_0_14px_rgba(168,85,247,0.9)] animate-pulse'
                          }`}
                        >
                          <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-300 animate-ping pointer-events-none" />
                          <span className="text-sm sm:text-base drop-shadow-lg leading-none">
                            {bonusBombType === 'cluster' ? '💣' : '⚡'}
                          </span>
                          <span
                            className={`text-[7px] sm:text-[8px] font-display font-black leading-none uppercase tracking-tighter ${
                              bonusBombType === 'cluster' ? 'text-amber-200' : 'text-fuchsia-200'
                            }`}
                          >
                            {bonusBombType === 'cluster' ? '3×3' : 'CROSS'}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }),
              )}
              {/* Snapped piece shadow - drawn ABOVE occupied cells so a
                  collision never hides the exact cells the player needs to
                  see. Always visible while a piece is over the board.
                  Deliberately light/translucent (never the piece's own
                  solid color) so the board underneath stays visible, and
                  colour-coded green/red for legality instead of showing the
                  piece's true color - that's the one signal that matters
                  here, and it must read instantly. */}
              {shadowPreview && gridMetrics && (
                <div className="absolute inset-0 pointer-events-none z-[15]">
                  {shadowPreview.shape.map((rowArr, r) =>
                    rowArr.map((val, c) => {
                      if (val !== 1) return null;
                      const gr = shadowPreview.row + r;
                      const gc = shadowPreview.col + c;
                      if (gr < 0 || gr >= BLOCK_BLASTER_BOARD_SIZE || gc < 0 || gc >= BLOCK_BLASTER_BOARD_SIZE) {
                        return null;
                      }
                      return (
                        <div
                          key={`shadow-${r}-${c}`}
                          className="absolute rounded-xs"
                          style={{
                            left: gc * gridMetrics.pitchX,
                            top: gr * gridMetrics.pitchY,
                            width: gridMetrics.cellW,
                            height: gridMetrics.cellH,
                            backgroundColor: shadowPreview.valid
                              ? 'rgba(46, 230, 107, 0.28)'
                              : 'rgba(255, 77, 77, 0.28)',
                            border: shadowPreview.valid
                              ? '2px solid rgba(46, 230, 107, 0.85)'
                              : '2px solid rgba(255, 77, 77, 0.85)',
                            boxShadow: shadowPreview.valid
                              ? '0 0 8px rgba(46,230,107,0.45), inset 1px 1px 0px rgba(255,255,255,0.2)'
                              : '0 0 8px rgba(255,77,77,0.45), inset 1px 1px 0px rgba(255,255,255,0.12)',
                          }}
                        />
                      );
                    }),
                  )}
                </div>
              )}
              {/* Bomb Radius Aiming Shadow */}
              {bombBlastPreview && gridMetrics && (
                <div className="absolute inset-0 pointer-events-none z-[16]">
                  {bombBlastPreview.cells.map(({ row: br, col: bc }) => {
                    const isEpicenter = br === bombBlastPreview.epicenter.row && bc === bombBlastPreview.epicenter.col;
                    const isCluster = bombBlastPreview.type === 'cluster';
                    return (
                      <div
                        key={`bomb-shadow-${br}-${bc}`}
                        className={`absolute rounded-xs transition-all duration-75 flex items-center justify-center ${
                          isEpicenter ? 'animate-pulse' : ''
                        }`}
                        style={{
                          left: bc * gridMetrics.pitchX,
                          top: br * gridMetrics.pitchY,
                          width: gridMetrics.cellW,
                          height: gridMetrics.cellH,
                          backgroundColor: isCluster
                            ? isEpicenter
                              ? 'rgba(249, 115, 22, 0.7)'
                              : 'rgba(249, 115, 22, 0.38)'
                            : isEpicenter
                              ? 'rgba(168, 85, 247, 0.7)'
                              : 'rgba(168, 85, 247, 0.38)',
                          border: isCluster
                            ? isEpicenter
                              ? '2px solid #ea580c'
                              : '1.5px dashed rgba(249, 115, 22, 0.85)'
                            : isEpicenter
                              ? '2px solid #9333ea'
                              : '1.5px dashed rgba(168, 85, 247, 0.85)',
                          boxShadow: isCluster
                            ? '0 0 12px rgba(249, 115, 22, 0.55)'
                            : '0 0 12px rgba(168, 85, 247, 0.55)',
                        }}
                      >
                        {isEpicenter && (
                          <div className="flex items-center justify-center text-white drop-shadow font-black text-xs sm:text-sm">
                            {isCluster ? '💥' : '⚡'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Floating Reticle Badge above epicenter */}
                  <div
                    className="absolute transform -translate-x-1/2 -translate-y-full pointer-events-none z-20 flex flex-col items-center pb-1.5"
                    style={{
                      left: bombBlastPreview.epicenter.col * gridMetrics.pitchX + gridMetrics.cellW / 2,
                      top: bombBlastPreview.epicenter.row * gridMetrics.pitchY,
                    }}
                  >
                    <span
                      className={`font-display text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border shadow-lg whitespace-nowrap ${
                        bombBlastPreview.type === 'cluster'
                          ? 'bg-orange-950 text-orange-200 border-orange-400'
                          : 'bg-purple-950 text-purple-200 border-purple-400'
                      }`}
                    >
                      {bombBlastPreview.type === 'cluster' ? '💥 3×3 Cluster Bomb' : '⚡ Cross Blast (+)'}
                    </span>
                  </div>
                </div>
              )}

              {/* Particle canvas overlay */}
              <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />

              {/* Floating combo announcements */}
              {floatingAnnouncements.map((ann) => (
                <div
                  key={ann.id}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 flex flex-col items-center animate-bounce"
                  style={{
                    left: `${ann.x}px`,
                    top: `${ann.y}px`,
                  }}
                >
                  <span
                    className="font-display text-xl sm:text-2xl font-black drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] tracking-wider px-3 py-1 bg-black/85 border-2 border-white rounded-md"
                    style={{ color: ann.color }}
                  >
                    {ann.text}
                  </span>
                  {ann.subtext && (
                    <span className="font-display text-xs font-bold text-yellow-300 drop-shadow mt-0.5">
                      {ann.subtext}
                    </span>
                  )}
                </div>
              ))}

              {/* Game Over Screen Overlay */}
              {you?.gameOver && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-30 rounded-sm">
                  <span className="font-display text-2xl sm:text-3xl font-black text-pa-danger tracking-wider mb-2 animate-pulse">
                    GAME OVER
                  </span>
                  <span className="font-display text-xs sm:text-sm text-pa-ink-dim mb-1">
                    NO MOVES LEFT
                  </span>

                  <div className="flex flex-col items-center my-3 gap-1">
                    <span className="font-display text-sm text-pa-ink-dim uppercase">Final Score</span>
                    <span className="font-display text-3xl font-bold text-pa-cyan">{you.score}</span>
                  </div>

                  <PixelButton
                    size="md"
                    variant="primary"
                    className="mt-2"
                    onClick={() => handleRestart(activeDifficulty, activeLayout)}
                  >
                    <RotateCcw size={14} className="mr-1" />
                    PLAY AGAIN
                  </PixelButton>
                </div>
              )}
            </div>
          </div>

          {/* Three-slot piece tray */}
          {/* Side column containing Bomb Arsenal Dock and Piece Tray */}
          <div ref={trayRef} className={sideColumnClass}>
            {/* Bomb Arsenal Inventory Dock */}
            {you && you.bombs.length > 0 && (
              <div
                className={`w-full p-2 bg-slate-950/95 border-2 rounded-sm pa-shadow transition-all ${
                  isStuckWithBombs
                    ? 'border-amber-400 ring-4 ring-amber-500/60 shadow-[0_0_16px_rgba(251,191,36,0.6)] animate-pulse'
                    : 'border-pa-border'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    <Bomb size={12} className={isStuckWithBombs ? 'text-amber-400 animate-bounce' : 'text-pa-cyan'} />
                    <span className="font-display text-[9px] uppercase tracking-wider font-bold text-pa-ink">
                      BOMBS ({you.bombs.length})
                    </span>
                  </div>
                  <span className="font-display text-[8px] text-pa-ink-dim uppercase">
                    {isStuckWithBombs ? 'DETONATE NOW' : 'Drag or tap'}
                  </span>
                </div>

                <div className={`grid gap-1.5 w-full ${stackedBombs.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {stackedBombs.map((stack) => {
                    const isSelected = selectedBombType === stack.type;
                    const isDragging = draggedBomb?.type === stack.type;
                    const isCluster = stack.type === 'cluster';

                    return (
                      <div
                        key={`bomb-stack-${stack.type}`}
                        onPointerDown={(e) => handleBombPointerDown(e, stack.type)}
                        onClick={() => {
                          setSelectedBombType((prev) => (prev === stack.type ? null : stack.type));
                          setSelectedPieceIdx(null);
                          sfx.blip();
                        }}
                        className={`relative flex items-center justify-between gap-1 px-2 py-1.5 rounded border-2 cursor-grab active:cursor-grabbing transition-all select-none touch-none min-w-0 ${
                          isCluster
                            ? isSelected
                              ? 'bg-orange-950 border-orange-400 ring-2 ring-orange-500/80 scale-[1.02] shadow-[0_0_10px_rgba(249,115,22,0.6)]'
                              : 'bg-orange-950/40 border-orange-800/80 hover:border-orange-500'
                            : isSelected
                              ? 'bg-purple-950 border-purple-400 ring-2 ring-purple-500/80 scale-[1.02] shadow-[0_0_10px_rgba(168,85,247,0.6)]'
                              : 'bg-purple-950/40 border-purple-800/80 hover:border-purple-500'
                        } ${isDragging ? 'opacity-30' : ''}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div
                            className={`w-6 h-6 rounded flex items-center justify-center text-sm border shrink-0 ${
                              isCluster
                                ? 'bg-orange-900/60 border-orange-700 text-orange-300'
                                : 'bg-purple-900/60 border-purple-700 text-purple-300'
                            }`}
                          >
                            {isCluster ? '💣' : '⚡'}
                          </div>
                          <div className="flex flex-col text-left leading-none min-w-0 truncate">
                            <span className="font-display text-[8px] sm:text-[9px] font-bold uppercase text-white truncate">
                              {isCluster ? 'Cluster' : 'Cross'}
                            </span>
                            <span
                              className={`font-display text-[7px] font-medium truncate mt-0.5 ${
                                isCluster ? 'text-orange-300' : 'text-purple-300'
                              }`}
                            >
                              {isCluster ? '3×3 Area' : 'Row & Col'}
                            </span>
                          </div>
                        </div>

                        {/* Small number at the corner showing stacked count */}
                        {stack.count > 1 && (
                          <span
                            title={`${stack.count} available`}
                            className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 flex items-center justify-center font-display text-[9px] font-black bg-amber-400 text-slate-950 border-2 border-slate-950 rounded-full shadow-md leading-none z-10"
                          >
                            {stack.count}
                          </span>
                        )}

                        {isSelected && (
                          <span className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 text-[6px] font-display bg-pa-cyan text-black px-1 rounded uppercase font-bold tracking-tight shadow">
                            AIM
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Three-slot piece tray */}
            <div className={trayClass}>
              {you?.tray.map((piece, idx) => {
                const isSelected = selectedPieceIdx === idx;
                const isDraggingThis = dragInfo?.pieceIndex === idx;
                const previewCellSize = piece
                  ? `clamp(10px, min(calc((100cqw - ${(piece.width - 1) * 2}px) / ${piece.width}), calc((100cqw - ${(piece.height - 1) * 2}px) / ${piece.height})), 20px)`
                  : null;
                return (
                  <div
                    key={piece?.id ?? `empty-${idx}`}
                    onPointerDown={(e) => handleTrayPiecePointerDown(e, idx)}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`relative flex aspect-square w-full ${traySlotSizeClass} min-w-0 shrink-0 items-center justify-center bg-pa-surface border-2 rounded-sm pa-shadow cursor-grab active:cursor-grabbing transition-transform select-none touch-none ${
                      isSelected ? 'border-pa-cyan ring-4 ring-pa-cyan/60 scale-105 shadow-[0_0_12px_rgba(34,211,238,0.5)]' : 'border-pa-border'
                    } ${you.gameOver ? 'border-red-500 ring-2 ring-red-500/80 animate-pulse' : ''} ${
                      isDraggingThis ? 'opacity-20' : 'hover:border-pa-cyan/70'
                    } ${shakeTrayIdx === idx ? 'pa-shake border-red-500' : ''} ${
                      isStuckWithBombs ? 'opacity-40 grayscale pointer-events-none' : ''
                    }`}
                    style={{ containerType: 'inline-size', touchAction: 'none' }}
                  >
                    {piece ? (
                      <div
                        data-piece-grid
                        className="grid gap-0.5"
                        style={{
                          '--block-preview-cell': previewCellSize!,
                          gridTemplateRows: `repeat(${piece.height}, var(--block-preview-cell))`,
                          gridTemplateColumns: `repeat(${piece.width}, var(--block-preview-cell))`,
                        } as React.CSSProperties}
                      >
                        {piece.shape.map((row, r) =>
                          row.map((val, c) => (
                            <div
                              key={`${r}-${c}`}
                              className="rounded-xs"
                              style={{
                                width: 'var(--block-preview-cell)',
                                 height: 'var(--block-preview-cell)',
                                 backgroundColor: val === 1 ? piece.color : 'transparent',
                                 boxShadow:
                                   val === 1
                                     ? 'inset 1px 1px 0px rgba(255,255,255,0.45), inset -1px -1px 0px rgba(0,0,0,0.45)'
                                     : undefined,
                              }}
                            />
                          )),
                         )}
                       </div>
                     ) : (
                       <span className="font-display text-[9px] text-pa-ink-dim/40 uppercase">Empty</span>
                     )}
                     {isSelected && (
                       <span className="absolute -bottom-2 text-[8px] font-display bg-pa-cyan text-black px-1 rounded uppercase font-bold tracking-tight">
                         Selected
                       </span>
                     )}
                     {isStuckWithBombs && piece && (
                       <span className="absolute inset-0 flex items-center justify-center bg-black/60 font-display text-[8px] text-amber-400 font-bold uppercase tracking-tight">
                         BLOCKED
                       </span>
                     )}
                   </div>
                 );
               })}
             </div>
           </div>
 
           <div ref={hintRef} className={hintClass}>
             <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim/70">
               Drag piece to grid, tap to select, or press 1 / 2 / 3 (B for Bomb)
             </span>
           </div>
         </div>

        {/* Multiplayer Opponent Spectator Boards */}
        {view.players.length > 1 && (
          <div className="flex flex-col gap-3 w-full lg:w-48 mt-4 lg:mt-0">
            <PixelPanel title="Rivals" className="w-full">
              <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                {view.players
                  .filter((p) => p.id !== youId)
                  .map((opponent: BlockBlasterPublicPlayer) => (
                    <div
                      key={opponent.id}
                      className="flex flex-col items-center bg-pa-bg border border-pa-border p-2 rounded shrink-0 w-28 lg:w-full"
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-display text-[9px] font-bold text-pa-ink truncate">
                          Seat {opponent.seat + 1}
                        </span>
                        {opponent.gameOver && (
                          <span className="font-display text-[8px] text-pa-danger font-bold uppercase">
                            OUT
                          </span>
                        )}
                      </div>

                      {/* Mini 8x8 Board */}
                      <div className="grid grid-cols-8 grid-rows-8 gap-px p-1 bg-black border border-pa-border w-16 h-16 sm:w-20 sm:h-20">
                        {Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, mr) =>
                          Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, mc) => {
                            const val = opponent.board[mr]?.[mc] ?? 0;
                            const isOpponentBomb = opponent.bonusBomb && opponent.bonusBomb.row === mr && opponent.bonusBomb.col === mc;
                            return (
                              <div
                                key={`m-${mr}-${mc}`}
                                className={`rounded-2xs ${isOpponentBomb ? 'animate-pulse ring-1 ring-amber-300' : ''}`}
                                style={{
                                  backgroundColor: isOpponentBomb
                                    ? opponent.bonusBomb!.type === 'cluster'
                                      ? '#f97316'
                                      : '#a855f7'
                                    : val !== 0
                                      ? (val as string)
                                      : 'transparent',
                                }}
                              />
                            );
                          }),
                        )}
                      </div>
                      <div className="flex items-center justify-between w-full mt-1.5 gap-1">
                        <span className="font-display text-[9px] font-bold text-pa-cyan truncate">
                          {opponent.score} pts
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {opponent.bombs && opponent.bombs.length > 0 && (
                            <span className="font-display text-[8px] font-bold text-amber-400 flex items-center gap-0.5">
                              💣×{opponent.bombs.length}
                            </span>
                          )}
                          {opponent.comboStreak > 1 && (
                            <span className="font-display text-[8px] font-bold text-orange-400">
                              ×{opponent.comboStreak}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </PixelPanel>
          </div>
        )}
      </div>

      {/* Floating dragged piece, at true board cell scale. Only rendered
          while off the board - once the piece is over the board, the
          snapped shadow above IS the piece, so there is exactly one
          representation on screen at all times, never zero. Deliberately
          translucent (opacity on the wrapper, not solid per-cell colour):
          this piece sits directly under the player's finger/cursor while
          they carry it toward the board, so at full opacity it hides
          exactly the thing they're trying to look at. It has no
          valid/invalid state yet (that only exists once it's over the
          board, in the shadow below) - see the past regressions in git
          history for what NOT to do: solid opaque (blocks the view) and
          fully hidden until it happens to land green (can't see what's
          being dragged at all). Light and translucent is the middle
          ground the player actually asked for. */}
      {dragInfo !== null && dragTopLeft && activePiece && !isDraggingOverBoard && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: `${dragTopLeft.x}px`,
            top: `${dragTopLeft.y}px`,
            opacity: 0.6,
          }}
        >
          <div
            className="grid gap-1"
            style={{
              gridTemplateRows: `repeat(${activePiece.height}, ${cellMetrics.cellH}px)`,
              gridTemplateColumns: `repeat(${activePiece.width}, ${cellMetrics.cellW}px)`,
            }}
          >
            {activePiece.shape.map((row, r) =>
              row.map((val, c) => (
                <div
                  key={`drag-${r}-${c}`}
                  className="rounded-xs"
                  style={{
                    width: `${cellMetrics.cellW}px`,
                    height: `${cellMetrics.cellH}px`,
                    backgroundColor: val === 1 ? activePiece.color : 'transparent',
                    boxShadow:
                      val === 1
                        ? 'inset 2px 2px 0px rgba(255,255,255,0.5), inset -2px -2px 0px rgba(0,0,0,0.5), 0 0 12px rgba(0,0,0,0.6)'
                        : undefined,
                  }}
                />
              )),
            )}
          </div>
        </div>
      )}
      {/* Floating dragged bomb icon */}
      {draggedBomb !== null && bombDragTopLeft && !bombHoverPos && (
        <div
          className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${bombDragTopLeft.x}px`,
            top: `${bombDragTopLeft.y}px`,
          }}
        >
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 pa-shadow shadow-2xl ${
              draggedBomb.type === 'cluster'
                ? 'bg-orange-950/95 border-orange-400 text-orange-200 ring-4 ring-orange-500/50'
                : 'bg-purple-950/95 border-purple-400 text-purple-200 ring-4 ring-purple-500/50'
            }`}
          >
            <span className="text-xl animate-bounce">
              {draggedBomb.type === 'cluster' ? '💣' : '⚡'}
            </span>
            <span className="font-display text-xs font-bold uppercase tracking-wider">
              {draggedBomb.type === 'cluster' ? '3×3 Cluster' : 'Cross Blast'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
