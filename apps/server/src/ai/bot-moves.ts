import { z } from 'zod';
import type { GameId } from '@puzzle-arena/shared';
import { complete } from './client.js';
import { logger } from '../logger.js';

export interface AiBotMoveRequest {
  gameId: GameId;
  view: unknown;
  actorId: string;
  fallbackAction: unknown;
}

/* ------------------------------------------------------------------ */
/* Connect 4 AI Prompt & Parser                                       */
/* ------------------------------------------------------------------ */

interface Connect4PromptView {
  players: { id: string; side: number }[];
  turn: number;
  board: (number | null)[];
  legalCols: number[];
}

const connect4MoveSchema = z.object({
  col: z.number().int().min(0).max(6),
  reasoning: z.string().optional(),
});

function formatConnect4Prompt(view: Connect4PromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : view.turn;
  const oppSide = mySide === 0 ? 1 : 0;
  const myColor = mySide === 0 ? 'Red (0)' : 'Yellow (1)';
  const oppColor = oppSide === 0 ? 'Red (0)' : 'Yellow (1)';

  let gridStr = '   0 1 2 3 4 5 6 (Columns)\n';
  for (let r = 0; r < 6; r++) {
    gridStr += `R${r} `;
    for (let c = 0; c < 7; c++) {
      const val = view.board[r * 7 + c];
      gridStr += val === null ? '. ' : val === 0 ? '0 ' : '1 ';
    }
    gridStr += '\n';
  }

  const system =
    'You are a Master Connect 4 Game AI. Your goal is to connect 4 of your discs in a row (horizontally, vertically, or diagonally) or block your opponent from doing so. ' +
    'Rules:\n' +
    '- You drop a disc into a column (0 to 6). Gravity causes it to fall to the lowest empty row in that column.\n' +
    '- ONLY choose from the provided LEGAL COLUMNS.\n' +
    '- Win immediately if you have 3-in-a-row and can complete 4.\n' +
    '- Block the opponent immediately if they have 3-in-a-row and threaten 4.\n' +
    '- DO NOT drop into a column if it gives the opponent an immediate winning 4 on the space directly above yours (suicide blunder)!\n' +
    '- Reply with ONLY a JSON object: {"col": <number 0-6>, "reasoning": "<short explanation>"}. No other text.';

  const user =
    `Current Board State:\n${gridStr}\n` +
    `You are: ${myColor}\n` +
    `Opponent is: ${oppColor}\n` +
    `Legal Columns available to drop into: [${view.legalCols.join(', ')}]\n` +
    'Which column do you choose?';

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* Reversi AI Prompt & Parser                                         */
/* ------------------------------------------------------------------ */

interface ReversiPromptView {
  players: { id: string; side: number }[];
  turn: number;
  board: (number | null)[];
  legalMoves: { row: number; col: number; flipsCount: number }[];
}

const reversiMoveSchema = z.object({
  action: z.enum(['place', 'pass']),
  row: z.number().int().min(0).max(7).optional(),
  col: z.number().int().min(0).max(7).optional(),
  reasoning: z.string().optional(),
});

function formatReversiPrompt(view: ReversiPromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : view.turn;
  const myColor = mySide === 0 ? 'Dark / Black (0)' : 'Light / White (1)';

  let gridStr = '   0 1 2 3 4 5 6 7 (Columns)\n';
  for (let r = 0; r < 8; r++) {
    gridStr += `R${r} `;
    for (let c = 0; c < 8; c++) {
      const val = view.board[r * 8 + c];
      gridStr += val === null ? '. ' : val === 0 ? 'D ' : 'L ';
    }
    gridStr += '\n';
  }

  const legalStr = (view.legalMoves || [])
    .map((m) => `(row ${m.row}, col ${m.col}) -> flips ${m.flipsCount} discs`)
    .join('\n');

  const system =
    'You are a Grandmaster Reversi (Othello) Game AI. ' +
    'Strategy:\n' +
    '1. Corners (0,0), (0,7), (7,0), (7,7) are permanently stable and cannot be flipped — seize them whenever available!\n' +
    '2. Avoid playing adjacent to open corners (X-squares and C-squares) because that gives the corner to your opponent.\n' +
    '3. Maximize mobility (keep more move options than your opponent).\n' +
    '4. In early/mid game, flipping fewer interior discs is often better than greedily flipping many discs.\n' +
    '5. Choose ONLY from the provided legal moves.\n' +
    'Reply with ONLY a JSON object: {"action": "place", "row": <0-7>, "col": <0-7>, "reasoning": "<short>"} or {"action": "pass"}. No other text.';

  const user =
    `Current 8x8 Board:\n${gridStr}\n` +
    `You are playing as: ${myColor}\n` +
    `Legal moves available:\n${legalStr || 'None (must pass)'}\n` +
    'Which move do you choose?';

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* Checkers AI Prompt & Parser                                        */
/* ------------------------------------------------------------------ */

interface CheckersPromptView {
  players: { id: string; side: number }[];
  legalMoves?: { path: { row: number; col: number }[] }[];
}

const checkersMoveSchema = z.object({
  pathIndex: z.number().int().min(0),
  reasoning: z.string().optional(),
});

function formatCheckersPrompt(view: CheckersPromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : 0;
  const myColor = mySide === 0 ? 'Dark / Red (Side 0)' : 'Light / White (Side 1)';

  const moveOptions = (view.legalMoves || [])
    .map((m, idx: number) => {
      const pathStr = m.path.map((p) => `(${p.row},${p.col})`).join(' -> ');
      return `Index ${idx}: ${pathStr}`;
    })
    .join('\n');

  const system =
    'You are a Champion International Draughts / Checkers AI. ' +
    'Strategy: Capture when available, advance toward the back row to promote to a flying King, control the center, and protect your pieces. ' +
    'Choose the BEST move by specifying its pathIndex from the legal moves list.\n' +
    'Reply with ONLY a JSON object: {"pathIndex": <number>, "reasoning": "<short>"}. No other text.';

  const user =
    `You are: ${myColor}\n` +
    `Available Legal Moves:\n${moveOptions || 'No legal moves'}\n` +
    'Which pathIndex do you choose?';

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* Congkak AI Prompt & Parser                                         */
/* ------------------------------------------------------------------ */

interface CongkakPromptView {
  players: { id: string }[];
  current: number;
  pits: number[];
  storehouses: [number, number];
  config?: { pitsPerSide?: number };
}

const congkakMoveSchema = z.object({
  pitIndex: z.number().int().min(0).max(15),
  reasoning: z.string().optional(),
});

function formatCongkakPrompt(view: CongkakPromptView, actorId: string): { system: string; user: string } {
  const myIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = myIdx >= 0 ? myIdx : view.current;
  const nPits = view.config?.pitsPerSide ?? 7;

  const startPit = mySide === 0 ? 0 : nPits;
  const endPit = mySide === 0 ? nPits - 1 : 2 * nPits - 1;
  const legalPits: number[] = [];

  for (let i = startPit; i <= endPit; i++) {
    const count = view.pits[i];
    if (count !== undefined && count > 0) legalPits.push(i);
  }

  const system =
    'You are a Master Congkak (Southeast Asian Mancala) AI. ' +
    'Strategy:\n' +
    '- Prioritize moves that end precisely in your storehouse (rumah) to get an extra free turn.\n' +
    '- Look for tembak (shoot) capture opportunities where your last seed lands in an empty pit on your side facing an opponent pit with seeds.\n' +
    '- Build up long relay runs.\n' +
    'Choose ONLY from your legal non-empty pit indices.\n' +
    'Reply with ONLY a JSON object: {"pitIndex": <number>, "reasoning": "<short>"}. No other text.';

  const user =
    `Pits: [${view.pits.join(', ')}]\n` +
    `Storehouses (Player 1 / Player 2): [${view.storehouses.join(', ')}]\n` +
    `Your Player Index: ${mySide}\n` +
    `Your Legal Non-Empty Pit Indices: [${legalPits.join(', ')}]\n` +
    'Which pitIndex do you choose to sow?';

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* Dispatcher: Execute AI Bot Move                                    */
/* ------------------------------------------------------------------ */

export async function getAiBotAction(req: AiBotMoveRequest): Promise<unknown> {
  const { gameId, view, actorId, fallbackAction } = req;

  try {
    if (gameId === 'connect4') {
      const v = view as Connect4PromptView;
      const { system, user } = formatConnect4Prompt(v, actorId);
      const fallbackCol =
        typeof fallbackAction === 'object' && fallbackAction && 'col' in fallbackAction
          ? Number(fallbackAction.col)
          : 0;

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: connect4MoveSchema,
        fallback: { col: fallbackCol },
        noCache: true,
      });
      const chosenCol = res.value.col;
      if (v.legalCols && v.legalCols.includes(chosenCol)) {
        logger.info({ gameId, col: chosenCol, source: res.source }, 'AI Bot played Connect 4 move');
        return { type: 'drop', col: chosenCol };
      }
      return fallbackAction;
    }

    if (gameId === 'reversi') {
      const v = view as ReversiPromptView;
      const { system, user } = formatReversiPrompt(v, actorId);
      const fallbackObj = typeof fallbackAction === 'object' && fallbackAction ? fallbackAction : {};
      const fallbackType = 'type' in fallbackObj ? String(fallbackObj.type) : 'pass';
      const fallbackRow = 'row' in fallbackObj ? Number(fallbackObj.row) : undefined;
      const fallbackCol = 'col' in fallbackObj ? Number(fallbackObj.col) : undefined;

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: reversiMoveSchema,
        fallback: {
          action: fallbackType === 'place' ? 'place' : 'pass',
          row: fallbackRow,
          col: fallbackCol,
        },
        noCache: true,
      });

      if (res.value.action === 'pass') {
        return { type: 'pass' };
      }
      if (res.value.row !== undefined && res.value.col !== undefined) {
        const isLegal = v.legalMoves?.some(
          (m) => m.row === res.value.row && m.col === res.value.col,
        );
        if (isLegal) {
          logger.info({ gameId, row: res.value.row, col: res.value.col, source: res.source }, 'AI Bot played Reversi move');
          return { type: 'place', row: res.value.row, col: res.value.col };
        }
      }
      return fallbackAction;
    }

    if (gameId === 'checkers') {
      const v = view as CheckersPromptView;
      const { system, user } = formatCheckersPrompt(v, actorId);
      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: checkersMoveSchema,
        fallback: { pathIndex: 0 },
        noCache: true,
      });
      if (v.legalMoves && v.legalMoves[res.value.pathIndex]) {
        return { type: 'move', path: v.legalMoves[res.value.pathIndex]!.path };
      }
      return fallbackAction;
    }

    if (gameId === 'congkak') {
      const v = view as CongkakPromptView;
      const { system, user } = formatCongkakPrompt(v, actorId);
      const fallbackPit =
        typeof fallbackAction === 'object' && fallbackAction && 'pitIndex' in fallbackAction
          ? Number(fallbackAction.pitIndex)
          : 0;

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: congkakMoveSchema,
        fallback: { pitIndex: fallbackPit },
        noCache: true,
      });
      const chosenPit = res.value.pitIndex;
      if (v.pits && v.pits[chosenPit] !== undefined && v.pits[chosenPit] > 0) {
        return { type: 'sow', pitIndex: chosenPit };
      }
      return fallbackAction;
    }
  } catch (err) {
    logger.warn({ gameId, err }, 'AI bot move generation threw, using classical fallback');
  }

  return fallbackAction;
}
