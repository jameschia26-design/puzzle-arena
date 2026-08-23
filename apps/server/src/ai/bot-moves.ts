import { z } from 'zod';
import type { GameId, PropertyTycoonAction } from '@puzzle-arena/shared';
import { propertyTycoonRules } from '@puzzle-arena/games';
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
/* Chess AI Prompt & Parser                                           */
/* ------------------------------------------------------------------ */

interface ChessPromptMove {
  from: number;
  to: number;
  promotion?: 'q' | 'r' | 'b' | 'n';
}
interface ChessPromptView {
  board: ({ type: string; side: 0 | 1 } | null)[];
  players: { id: string; side: 0 | 1 }[];
  you?: { side: 0 | 1; legalMoves: ChessPromptMove[]; inCheck?: boolean } | null;
}

const chessMoveSchema = z.object({
  moveIndex: z.number().int().min(0),
  reasoning: z.string().optional(),
});

const CHESS_FILES = 'abcdefgh';
function chessSquareName(sq: number): string {
  const file = CHESS_FILES[sq % 8] ?? '?';
  const rank = Math.floor(sq / 8) + 1;
  return `${file}${rank}`;
}
const CHESS_PIECE_LETTER: Record<string, string> = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function formatChessPrompt(view: ChessPromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : 0;
  const myColor = mySide === 0 ? 'White' : 'Black';

  let boardStr = '   a b c d e f g h\n';
  for (let rank = 8; rank >= 1; rank--) {
    boardStr += `${rank}  `;
    for (let file = 0; file < 8; file++) {
      const sq = (rank - 1) * 8 + file;
      const piece = view.board[sq];
      if (!piece) {
        boardStr += '. ';
        continue;
      }
      const letter = CHESS_PIECE_LETTER[piece.type] ?? '?';
      boardStr += (piece.side === 0 ? letter : letter.toLowerCase()) + ' ';
    }
    boardStr += `${rank}\n`;
  }
  boardStr += '   a b c d e f g h\n';

  const legalMoves = view.you?.legalMoves ?? [];
  const moveOptions = legalMoves
    .map(
      (m, idx) =>
        `Index ${idx}: ${chessSquareName(m.from)}-${chessSquareName(m.to)}${m.promotion ? `=${m.promotion.toUpperCase()}` : ''}`,
    )
    .join('\n');

  const system =
    'You are a strong International Chess (FIDE rules) AI. Uppercase letters are White pieces, lowercase are Black; K/Q/R/B/N/P. ' +
    'Play sound opening principles, look for tactics (forks, pins, skewers), and prioritize king safety. ' +
    'Choose the BEST move by its moveIndex from the legal moves list — you may ONLY choose from this list. ' +
    (view.you?.inCheck ? 'You are currently IN CHECK and must resolve it. ' : '') +
    'Reply with ONLY a JSON object: {"moveIndex": <number>, "reasoning": "<short>"}. No other text.';

  const user =
    `Board (rank 8 at top, White = uppercase, Black = lowercase):\n${boardStr}\n` +
    `You are: ${myColor}\n` +
    `Legal moves:\n${moveOptions || 'No legal moves'}\n` +
    'Which moveIndex do you choose?';

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* Xiangqi AI Prompt & Parser                                         */
/* ------------------------------------------------------------------ */

interface XiangqiPromptMove {
  from: number;
  to: number;
}
interface XiangqiPromptView {
  board: ({ type: string; side: 0 | 1 } | null)[];
  players: { id: string; side: 0 | 1 }[];
  you?: { side: 0 | 1; legalMoves: XiangqiPromptMove[]; inCheck?: boolean } | null;
}

const xiangqiMoveSchema = z.object({
  moveIndex: z.number().int().min(0),
  reasoning: z.string().optional(),
});

/** row*9+col -> "col,row", row 0 = Black's back rank, row 9 = Red's. */
function xiangqiPointName(pt: number): string {
  const row = Math.floor(pt / 9);
  const col = pt % 9;
  return `(${col},${row})`;
}
// Matches XiangqiPieceType in packages/games/src/xiangqi/state.ts. Purely
// cosmetic for the board render — the AI still only ever picks from the
// enumerated legal-move index list below, so a mismatch here would only
// affect prompt readability, never legality.
const XIANGQI_PIECE_NAME: Record<string, string> = {
  general: 'General',
  advisor: 'Advisor',
  elephant: 'Elephant',
  horse: 'Horse',
  chariot: 'Chariot',
  cannon: 'Cannon',
  soldier: 'Soldier',
};

const XIANGQI_PIECE_LETTER: Record<string, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  chariot: 'R',
  cannon: 'C',
  soldier: 'S',
};

function formatXiangqiPrompt(view: XiangqiPromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : 0;
  const myColor = mySide === 0 ? 'Red (moves first, bottom of board, uppercase)' : 'Black (top of board, lowercase)';

  let boardStr = '    ' + Array.from({ length: 9 }, (_, c) => c).join(' ') + '  (col)\n';
  for (let row = 0; row < 10; row++) {
    boardStr += `${String(row).padStart(2, ' ')}  `;
    for (let col = 0; col < 9; col++) {
      const piece = view.board[row * 9 + col];
      if (!piece) {
        boardStr += '. ';
        continue;
      }
      const letter = XIANGQI_PIECE_LETTER[piece.type] ?? '?';
      boardStr += (piece.side === 0 ? letter : letter.toLowerCase()) + ' ';
    }
    boardStr += '\n';
  }

  const legalMoves = view.you?.legalMoves ?? [];
  const moveOptions = legalMoves
    .map((m, idx) => {
      const mover = view.board[m.from];
      const target = view.board[m.to];
      const moverName = mover ? `${mover.side === 0 ? 'Red' : 'Black'} ${XIANGQI_PIECE_NAME[mover.type] ?? mover.type}` : 'Piece';
      const captureText = target ? ` (captures ${target.side === 0 ? 'Red' : 'Black'} ${XIANGQI_PIECE_NAME[target.type] ?? target.type})` : '';
      return `Index ${idx}: ${moverName} from ${xiangqiPointName(m.from)} -> to ${xiangqiPointName(m.to)}${captureText}`;
    })
    .join('\n');

  const system =
    'You are a grandmaster Xiangqi (Chinese Chess) AI playing on a 9x10 point grid (row 0 = Black back rank at top, row 9 = Red back rank at bottom; points given as (col,row)). ' +
    'Pieces: General (G, 10000pts), Chariot (R, 950pts), Cannon (C, 480pts), Horse (H, 420pts), Elephant (E, 200pts), Advisor (A, 200pts), Soldier (S, 100pts before river, 220+ pts across river). ' +
    'Rules: Chariots control open files/ranks. Cannons require exactly one screen piece to jump and capture. Horses move 1 step orthogonal then 1 diagonal (blocked if horse leg is obstructed). Soldiers advance forward before river, gain lateral moves after river. Generals cannot face each other on an open file. ' +
    'Strategy: Prioritize king safety, control central files with chariots/cannons, win material through tactics/forks, and deliver checkmate. ' +
    'Choose the BEST move by its moveIndex from the legal moves list — you may ONLY choose from this list. ' +
    (view.you?.inCheck ? 'WARNING: Your general is currently IN CHECK and you must resolve it! ' : '') +
    'Reply with ONLY a JSON object: {"moveIndex": <number>, "reasoning": "<short>"}. No other text.';

  const user =
    `Board:\n${boardStr}\n` +
    `You are: ${myColor}\n` +
    `Legal moves:\n${moveOptions || 'No legal moves'}\n` +
    'Which moveIndex do you choose?';

  return { system, user };
}

interface AnimalChessPromptView {
  board: ({ type: string; side: number } | null)[];
  players: { id: string; side: number }[];
  current: string | null;
  phase: string;
  winner: string | null;
  you?: {
    id: string;
    side: number;
    legalMoves: { from: number; to: number }[];
  } | null;
}

const animalChessMoveSchema = z.object({
  moveIndex: z.number().int().min(0),
  reasoning: z.string().optional(),
});

function animalChessPointName(pt: number): string {
  const row = Math.floor(pt / 7);
  const col = pt % 7;
  return `(${col},${row})`;
}

const ANIMAL_CHESS_PIECE_NAME: Record<string, string> = {
  rat: 'Rat (鼠)',
  cat: 'Cat (猫)',
  dog: 'Dog (狗)',
  wolf: 'Wolf (狼)',
  leopard: 'Leopard (豹)',
  tiger: 'Tiger (虎)',
  lion: 'Lion (狮)',
  elephant: 'Elephant (象)',
};

function formatAnimalChessPrompt(view: AnimalChessPromptView, actorId: string): { system: string; user: string } {
  const pIdx = view.players.findIndex((p) => p.id === actorId);
  const mySide = pIdx >= 0 ? view.players[pIdx]!.side : 0;
  const myColor = mySide === 0 ? 'Blue (top of board, row 0-2)' : 'Red (bottom of board, row 6-8)';

  let boardStr = '    ' + Array.from({ length: 7 }, (_, c) => c).join('   ') + '  (col)\n';
  for (let row = 0; row < 9; row++) {
    boardStr += `${String(row).padStart(2, ' ')}  `;
    for (let col = 0; col < 7; col++) {
      const pt = row * 7 + col;
      const piece = view.board[pt];
      if (!piece) {
        // Check terrain
        if (row === 0 && col === 3) boardStr += 'DN0 ';
        else if (row === 8 && col === 3) boardStr += 'DN1 ';
        else if ((row === 0 && (col === 2 || col === 4)) || (row === 1 && col === 3)) boardStr += 'TP0 ';
        else if ((row === 8 && (col === 2 || col === 4)) || (row === 7 && col === 3)) boardStr += 'TP1 ';
        else if (row >= 3 && row <= 5 && ((col >= 1 && col <= 2) || (col >= 4 && col <= 5))) boardStr += '~~~ ';
        else boardStr += ' .  ';
        continue;
      }
      const prefix = piece.side === 0 ? 'B-' : 'R-';
      const shortName = piece.type.slice(0, 2).toUpperCase();
      boardStr += `${prefix}${shortName} `;
    }
    boardStr += '\n';
  }

  const legalMoves = view.you?.legalMoves ?? [];
  const moveOptions = legalMoves
    .map((m, idx) => {
      const mover = view.board[m.from];
      const target = view.board[m.to];
      const moverName = mover ? `${mover.side === 0 ? 'Blue' : 'Red'} ${ANIMAL_CHESS_PIECE_NAME[mover.type] ?? mover.type}` : 'Piece';
      const captureText = target ? ` (captures ${target.side === 0 ? 'Blue' : 'Red'} ${ANIMAL_CHESS_PIECE_NAME[target.type] ?? target.type})` : '';
      return `Index ${idx}: ${moverName} from ${animalChessPointName(m.from)} -> to ${animalChessPointName(m.to)}${captureText}`;
    })
    .join('\n');

  const system =
    'You are a master Dou Shou Qi (Animal Chess / Jungle) AI playing on a 7x9 grid (row 0 = Blue back rank at top, row 8 = Red back rank at bottom; coordinates (col,row)). ' +
    'Pieces & Ranks: Elephant (8), Lion (7), Tiger (6), Leopard (5), Wolf (4), Dog (3), Cat (2), Rat (1). Higher rank captures equal/lower rank. ' +
    'Special Rules:\n' +
    '1. Rat (1) is the only piece that can enter river squares (~~~). A Rat can capture an Elephant (8) when both are on land, but the Elephant can NEVER capture a Rat, regardless of terrain — this is the one exception to the rank order. A Rat in the water can only capture another Rat in the water, and cannot attack or be attacked by any land piece.\n' +
    '2. Lion (7) and Tiger (6) can jump over the river in one move (horizontally or vertically), but only if no piece of either side sits in the water squares along the jump path.\n' +
    '3. TP0 (next to Blue\'s den DN0) belongs to Blue; TP1 (next to Red\'s den DN1) belongs to Red. A piece standing on its OWN side\'s trap is completely safe. A piece standing on the ENEMY\'s trap is reduced to rank 0 and can be captured by ANY enemy piece, including the Rat.\n' +
    '4. Moving any piece into the opponent\'s Den instantly WINS the game — Red\'s target is DN0, Blue\'s target is DN1.\n' +
    'Strategy: Advance toward enemy den, protect your own den, use Rat to control river/threaten Elephant, and leap with Lion/Tiger for ambush tactics. ' +
    'Choose the BEST move by its moveIndex from the legal moves list — you may ONLY choose from this list. ' +
    'Reply with ONLY a JSON object: {"moveIndex": <number>, "reasoning": "<short>"}. No other text.';

  const user =
    `Board:\n${boardStr}\n` +
    `You are playing as: ${myColor}\n` +
    `Legal moves:\n${moveOptions || 'No legal moves'}\n` +
    'Which moveIndex do you choose?';

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
/* Property Tycoon AI Prompt & Parser                                 */
/* ------------------------------------------------------------------ */

interface PropertyTycoonPromptView {
  phase: string;
  current: number;
  players: {
    id: string;
    seat: number;
    cash: number;
    position: number;
    inJail: boolean;
    jailTurns: number;
    jailCards: string[];
    bankrupt: boolean;
  }[];
  properties: Record<number, { owner: string | null; houses: number; mortgaged: boolean }>;
  pendingPurchase: number | null;
  auction: {
    propertyId: number;
    participants: string[];
    passed: string[];
    highBid: number;
    highBidder: string | null;
    turn: string;
  } | null;
  debt: { playerId: string; amount: number; creditor: string | null }[];
  trades: {
    id: string;
    from: string;
    to: string;
    give: { cash: number; properties: number[] };
    receive: { cash: number; properties: number[] };
  }[];
  housesRemaining: number;
  hotelsRemaining: number;
}

const propertyTycoonMoveSchema = z.object({
  action: z.enum([
    'roll',
    'buy',
    'decline',
    'bid',
    'passBid',
    'buildHouse',
    'sellHouse',
    'mortgage',
    'unmortgage',
    'respondTrade',
    'payJailFine',
    'useJailCard',
    'declareBankruptcy',
    'endTurn',
  ]),
  amount: z.number().int().optional(),
  propertyId: z.number().int().optional(),
  tradeId: z.string().optional(),
  accept: z.boolean().optional(),
  reasoning: z.string().optional(),
});

function formatPropertyTycoonPrompt(
  view: PropertyTycoonPromptView,
  actorId: string,
): { system: string; user: string } {
  const me = view.players.find((p) => p.id === actorId);
  const myCash = me?.cash ?? 0;
  const myPos = me?.position ?? 0;
  const mySquare = propertyTycoonRules.squareAt(myPos);

  // Group properties owned by player
  const myProperties: string[] = [];
  for (const [groupName, indices] of Object.entries(propertyTycoonRules.GROUPS) as [string, number[]][]) {
    const ownedInGroup = indices.filter((idx) => view.properties[idx]?.owner === actorId);
    if (ownedInGroup.length > 0) {
      const isMonopoly = ownedInGroup.length === indices.length;
      const details = ownedInGroup
        .map((idx) => {
          const sq = propertyTycoonRules.squareAt(idx);
          const p = view.properties[idx]!;
          const hStr = p.houses === 5 ? 'Hotel' : `${p.houses} houses`;
          const mStr = p.mortgaged ? ' (MORTGAGED)' : '';
          return `${sq.name} [${hStr}${mStr}]`;
        })
        .join(', ');
      myProperties.push(`- ${groupName} (${ownedInGroup.length}/${indices.length}${isMonopoly ? ' FULL MONOPOLY' : ''}): ${details}`);
    }
  }

  // Opponents status
  const oppSummaries = view.players
    .filter((p) => p.id !== actorId && !p.bankrupt)
    .map((p) => {
      const owned = Object.entries(view.properties)
        .filter(([, prop]) => prop.owner === p.id)
        .map(([idx]) => propertyTycoonRules.squareAt(Number(idx)).name);
      return `${p.id}: $${p.cash}, on square #${p.position} (${propertyTycoonRules.squareAt(p.position).name}), owns ${owned.length} properties (${owned.slice(0, 4).join(', ')}${owned.length > 4 ? '...' : ''})`;
    })
    .join('\n');

  let decisionContext = '';

  if (view.auction && view.auction.turn === actorId) {
    const sq = propertyTycoonRules.squareAt(view.auction.propertyId);
    const minNext = view.auction.highBid + 10;
    decisionContext =
      `Current Phase: AUCTION for ${sq.name} (${sq.group ?? sq.type}, base price $${sq.price})\n` +
      `Current high bid: $${view.auction.highBid} (by ${view.auction.highBidder ?? 'none'})\n` +
      `Minimum next bid: $${minNext}\n` +
      `Legal actions: {"action": "bid", "amount": ${Math.max(minNext, Math.min(myCash, (sq.price ?? 100)))}}, or {"action": "passBid"}`;
  } else if (view.debt.some((d) => d.playerId === actorId)) {
    const myDebt = view.debt.find((d) => d.playerId === actorId)!;
    decisionContext =
      `Current Phase: DEBT SETTLEMENT. You owe $${myDebt.amount} (your cash is currently $${myCash}).\n` +
      `You must sell buildings, mortgage properties, or declare bankruptcy.\n` +
      `Legal actions: {"action": "sellHouse", "propertyId": <id>}, {"action": "mortgage", "propertyId": <id>}, or {"action": "declareBankruptcy"}`;
  } else if (view.trades.some((t) => t.to === actorId)) {
    const trade = view.trades.find((t) => t.to === actorId)!;
    const giveNames = trade.give.properties.map((i) => propertyTycoonRules.squareAt(i).name).join(', ') || 'none';
    const recvNames = trade.receive.properties.map((i) => propertyTycoonRules.squareAt(i).name).join(', ') || 'none';
    decisionContext =
      `Current Phase: TRADE OFFER from ${trade.from}.\n` +
      `They offer: $${trade.give.cash} and properties: [${giveNames}]\n` +
      `They request: $${trade.receive.cash} and properties: [${recvNames}]\n` +
      `Legal actions: {"action": "respondTrade", "tradeId": "${trade.id}", "accept": true} or {"action": "respondTrade", "tradeId": "${trade.id}", "accept": false}`;
  } else if (view.phase === 'in_jail_decision') {
    decisionContext =
      `Current Phase: IN JAIL (turns spent: ${me?.jailTurns ?? 0}/3).\n` +
      `Legal actions:\n` +
      `- {"action": "roll"} (try to roll doubles for free release)\n` +
      (myCash >= 50 ? `- {"action": "payJailFine"} (pay $50 to get out and move)\n` : '') +
      ((me?.jailCards.length ?? 0) > 0 ? `- {"action": "useJailCard"} (use Get Out of Jail Free card)\n` : '');
  } else if (view.phase === 'awaiting_purchase_decision' && view.pendingPurchase !== null) {
    const sq = propertyTycoonRules.squareAt(view.pendingPurchase);
    const price = sq.price ?? 0;
    decisionContext =
      `Current Phase: PURCHASE DECISION. You landed on unowned property: ${sq.name} (${sq.group ?? sq.type}).\n` +
      `Cost: $${price}. Your cash: $${myCash}.\n` +
      `Legal actions: {"action": "buy"} (if you have >= $${price}) or {"action": "decline"} (sends to auction)`;
  } else if (view.phase === 'awaiting_end_turn') {
    // Find buildable properties
    const buildable: { propertyId: number; name: string; cost: number; houses: number }[] = [];
    for (const [groupName, indices] of Object.entries(propertyTycoonRules.GROUPS) as [string, number[]][]) {
      if (indices.every((idx) => view.properties[idx]?.owner === actorId && !view.properties[idx]?.mortgaged)) {
        const cost = propertyTycoonRules.HOUSE_COST[groupName] ?? 0;
        for (const idx of indices) {
          const p = view.properties[idx]!;
          if (p.houses < 5 && myCash >= cost) {
            buildable.push({ propertyId: idx, name: propertyTycoonRules.squareAt(idx).name, cost, houses: p.houses });
          }
        }
      }
    }
    decisionContext =
      `Current Phase: END OF TURN.\n` +
      (buildable.length > 0
        ? `Buildable properties: ${buildable.map((b) => `#${b.propertyId} ${b.name} ($${b.cost}, current houses: ${b.houses})`).join(', ')}\n` +
          `Legal actions: {"action": "buildHouse", "propertyId": <id>} or {"action": "endTurn"}\n`
        : `Legal actions: {"action": "endTurn"}\n`);
  } else if (view.phase === 'awaiting_roll') {
    decisionContext = `Current Phase: ROLL DICE.\nLegal actions: {"action": "roll"}`;
  } else {
    decisionContext = `Current Phase: ${view.phase}.\nLegal actions: {"action": "endTurn"}`;
  }

  const system =
    'You are a Master Monopoly / Property Tycoon strategist AI. Your goal is to bankrupt your opponents and win the game. ' +
    'Strategic guidelines:\n' +
    '1. Priority #1: Acquire full colour group monopolies (especially Orange, Red, LightBlue, Yellow).\n' +
    '2. Priority #2: Build houses up to 3 houses per property as fast as possible on your monopolies — 3 houses has the highest return on investment.\n' +
    '3. Priority #3: Keep a reasonable cash safety reserve ($100-$200) to survive landing on opponent rents.\n' +
    '4. Buy unowned properties that complete your monopolies or block opponents from completing theirs.\n' +
    '5. In auctions, bid aggressively for monopoly-completing or blocking properties up to 1.3x - 1.5x face value if you have the cash reserve.\n' +
    '6. When in jail in late game (when board is developed), stay in jail as long as possible by rolling. In early game, pay fine to claim unowned board.\n' +
    'Reply with ONLY a valid JSON object matching the requested action. No extra markdown or conversational text.';

  const user =
    `=== PROPERTY TYCOON GAME STATE ===\n` +
    `Your Player ID: ${actorId}\n` +
    `Your Cash: $${myCash}\n` +
    `Your Position: Square #${myPos} (${mySquare.name})\n` +
    `Your Properties:\n${myProperties.length > 0 ? myProperties.join('\n') : '- None'}\n\n` +
    `Opponents:\n${oppSummaries || 'None'}\n\n` +
    `--- YOUR TURN DECISION ---\n` +
    `${decisionContext}\n\n` +
    `What action do you take? Return JSON.`;

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

    if (gameId === 'chess') {
      const v = view as ChessPromptView;
      const { system, user } = formatChessPrompt(v, actorId);
      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: chessMoveSchema,
        fallback: { moveIndex: 0 },
        noCache: true,
      });
      const move = v.you?.legalMoves?.[res.value.moveIndex];
      if (move) {
        logger.info({ gameId, ...move, source: res.source }, 'AI Bot played Chess move');
        return { type: 'move', from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
      }
      return fallbackAction;
    }

    if (gameId === 'xiangqi') {
      const v = view as XiangqiPromptView;
      const { system, user } = formatXiangqiPrompt(v, actorId);
      let fallbackIndex = 0;
      if (
        typeof fallbackAction === 'object' &&
        fallbackAction &&
        'from' in fallbackAction &&
        'to' in fallbackAction &&
        v.you?.legalMoves
      ) {
        const matchIdx = v.you.legalMoves.findIndex(
          (m) => m.from === fallbackAction.from && m.to === fallbackAction.to,
        );
        if (matchIdx >= 0) fallbackIndex = matchIdx;
      }

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: xiangqiMoveSchema,
        fallback: { moveIndex: fallbackIndex },
        noCache: true,
      });
      const move = v.you?.legalMoves?.[res.value.moveIndex];
      if (move) {
        logger.info({ gameId, ...move, source: res.source }, 'AI Bot played Xiangqi move');
        return { type: 'move', from: move.from, to: move.to };
      }
      return fallbackAction;
    }

    if (gameId === 'animal-chess') {
      const v = view as AnimalChessPromptView;
      const { system, user } = formatAnimalChessPrompt(v, actorId);
      let fallbackIndex = 0;
      if (
        typeof fallbackAction === 'object' &&
        fallbackAction &&
        'from' in fallbackAction &&
        'to' in fallbackAction &&
        v.you?.legalMoves
      ) {
        const matchIdx = v.you.legalMoves.findIndex(
          (m) => m.from === fallbackAction.from && m.to === fallbackAction.to,
        );
        if (matchIdx >= 0) fallbackIndex = matchIdx;
      }

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: animalChessMoveSchema,
        fallback: { moveIndex: fallbackIndex },
        noCache: true,
      });
      const move = v.you?.legalMoves?.[res.value.moveIndex];
      if (move) {
        logger.info({ gameId, ...move, source: res.source }, 'AI Bot played Animal Chess move');
        return { type: 'move', from: move.from, to: move.to };
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

    if (gameId === 'property-tycoon') {
      const v = view as PropertyTycoonPromptView;
      const { system, user } = formatPropertyTycoonPrompt(v, actorId);
      const fallbackObj = (typeof fallbackAction === 'object' && fallbackAction ? fallbackAction : { type: 'endTurn' }) as PropertyTycoonAction;

      const res = await complete({
        task: 'bot_move',
        system,
        user,
        schema: propertyTycoonMoveSchema,
        fallback: { action: (fallbackObj.type ?? 'endTurn') as never },
        noCache: true,
      });

      const act = res.value.action;
      if (act === 'roll') return { type: 'roll' };
      if (act === 'buy') return { type: 'buy' };
      if (act === 'decline') return { type: 'decline' };
      if (act === 'passBid') return { type: 'passBid' };
      if (act === 'bid') {
        const amt = res.value.amount ?? (fallbackObj.type === 'bid' ? fallbackObj.amount : (v.auction ? v.auction.highBid + 10 : 10));
        return { type: 'bid', amount: amt };
      }
      if (act === 'buildHouse' && res.value.propertyId !== undefined) {
        return { type: 'buildHouse', propertyId: res.value.propertyId };
      }
      if (act === 'sellHouse' && res.value.propertyId !== undefined) {
        return { type: 'sellHouse', propertyId: res.value.propertyId };
      }
      if (act === 'mortgage' && res.value.propertyId !== undefined) {
        return { type: 'mortgage', propertyId: res.value.propertyId };
      }
      if (act === 'unmortgage' && res.value.propertyId !== undefined) {
        return { type: 'unmortgage', propertyId: res.value.propertyId };
      }
      if (act === 'respondTrade') {
        const tradeId = res.value.tradeId ?? (v.trades.find((t) => t.to === actorId)?.id ?? '');
        return { type: 'respondTrade', tradeId, accept: Boolean(res.value.accept) };
      }
      if (act === 'payJailFine') return { type: 'payJailFine' };
      if (act === 'useJailCard') return { type: 'useJailCard' };
      if (act === 'declareBankruptcy') return { type: 'declareBankruptcy' };
      if (act === 'endTurn') return { type: 'endTurn' };

      return fallbackAction;
    }
  } catch (err) {
    logger.warn({ gameId, err }, 'AI bot move generation threw, using classical fallback');
  }

  return fallbackAction;
}
