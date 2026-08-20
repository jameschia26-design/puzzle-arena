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
