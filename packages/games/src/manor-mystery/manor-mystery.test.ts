import { describe, expect, it } from 'vitest';
import { ROOMS, SUSPECTS, WEAPONS } from '@puzzle-arena/shared';
import { manorMystery as engine, ELIMINABLE, type MMState, type MMView } from './index.js';
import {
  ALL_CARDS,
  DOORS,
  DOORS_BY_ROOM,
  GRID,
  PERIMETER,
  ROOM_BY_NAME,
  SECRET_PASSAGES,
  START_SQUARES,
  isCorridor,
  reachable,
  roomAt,
} from './board.js';

const P3 = ['a', 'b', 'c'];
const P6 = ['a', 'b', 'c', 'd', 'e', 'f'];

const fresh = (ids = P3, seed = 4242): MMState => engine.setup(ids, seed, {});

function act(s: MMState, id: string, action: Parameters<typeof engine.reduce>[2]): MMState {
  const r = engine.reduce(s, id, action);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(action)} accepted: ${r.error}`);
  return r.state;
}

function reject(s: MMState, id: string, action: Parameters<typeof engine.reduce>[2]): string {
  const r = engine.reduce(s, id, action);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}

/* ================================================================== */
/* Board geometry — generated from the bands, not hand-drawn           */
/* ================================================================== */

describe('board geometry', () => {
  it('lays out nine rooms in the documented bands', () => {
    expect(ROOMS).toHaveLength(9);
    const kitchen = ROOM_BY_NAME['Kitchen'];
    expect(kitchen).toMatchObject({ x0: 1, x1: 6, y0: 1, y1: 6 });
    const study = ROOM_BY_NAME['Study'];
    expect(study).toMatchObject({ x0: 17, x1: 22, y0: 17, y1: 22 });
    const library = ROOM_BY_NAME['Library'];
    expect(library).toMatchObject({ x0: 9, x1: 14, y0: 9, y1: 14 });
  });

  it('gives every room a door on each corridor-facing side', () => {
    // Deliberately four per room, not the plan's two — see the comment on
    // DOORS. Every room borders a corridor on all four sides.
    expect(DOORS).toHaveLength(36);
    for (const room of ROOMS) {
      expect(DOORS_BY_ROOM[room]).toHaveLength(4);
    }
  });

  it('lets every room reach another room on a roll of 3', () => {
    /*
     * The reason the door rule changed. Under the plan's two-door rule the
     * Kitchen needed a roll of 10 to reach any room — 17% of turns — and
     * suggestions can only be made from inside a room, so a Kitchen turn was
     * usually a wasted one. This is the regression guard for that.
     */
    for (const room of ROOMS) {
      const rect = ROOM_BY_NAME[room];
      const from = { room, x: rect.x0, y: rect.y0 };
      const { rooms } = reachable(from, 3, new Set<string>());
      expect(rooms.length, `${room} should reach a room on a 3`).toBeGreaterThan(0);
    }
  });

  it("matches the plan's worked example for the Kitchen", () => {
    const doors = DOORS_BY_ROOM['Kitchen'] ?? [];
    // Right door at room cell (6,4) opening to corridor (7,4).
    expect(doors).toContainEqual({ room: 'Kitchen', x: 6, y: 4, cx: 7, cy: 4 });
    // Bottom door at room cell (4,6) opening to corridor (4,7).
    expect(doors).toContainEqual({ room: 'Kitchen', x: 4, y: 6, cx: 4, cy: 7 });
  });

  it('opens right-band rooms on their LEFT edge', () => {
    const doors = DOORS_BY_ROOM['Conservatory'] ?? [];
    expect(doors.some((d) => d.x === 17 && d.cx === 16)).toBe(true);
  });

  it('opens bottom-band rooms on their TOP edge', () => {
    const doors = DOORS_BY_ROOM['Lounge'] ?? [];
    expect(doors.some((d) => d.y === 17 && d.cy === 16)).toBe(true);
  });

  it('places every door cell inside its room and every opening in a corridor', () => {
    for (const d of DOORS) {
      expect(roomAt(d.x, d.y)).toBe(d.room);
      expect(isCorridor(d.cx, d.cy)).toBe(true);
    }
  });

  it('treats columns 0,7,8,15,16,23 and rows 0,7,8,15,16,23 as corridor', () => {
    for (const c of [0, 7, 8, 15, 16, 23]) {
      for (let y = 0; y < GRID; y++) expect(isCorridor(c, y)).toBe(true);
      for (let x = 0; x < GRID; x++) expect(isCorridor(x, c)).toBe(true);
    }
  });

  it('walks a 92-cell perimeter and seats suspects at the documented indices', () => {
    expect(PERIMETER).toHaveLength(4 * GRID - 4);
    expect(PERIMETER).toHaveLength(92);
    const expectedIdx = [0, 15, 30, 46, 61, 76];
    SUSPECTS.forEach((_, k) => {
      expect(START_SQUARES[k]).toEqual(PERIMETER[expectedIdx[k] as number]);
    });
  });

  it('joins the diagonally opposite corner rooms by secret passage', () => {
    expect(SECRET_PASSAGES['Kitchen']).toBe('Study');
    expect(SECRET_PASSAGES['Study']).toBe('Kitchen');
    expect(SECRET_PASSAGES['Conservatory']).toBe('Lounge');
    expect(SECRET_PASSAGES['Lounge']).toBe('Conservatory');
    // Middle rooms have none.
    expect(SECRET_PASSAGES['Library']).toBeUndefined();
  });
});

describe('movement', () => {
  it('offers only cells at exactly the rolled distance', () => {
    const { cells } = reachable({ room: null, x: 0, y: 0 }, 3, new Set());
    expect(cells.length).toBeGreaterThan(0);
    for (const [x, y] of cells) {
      // Manhattan distance is a lower bound; parity must match the roll.
      const manhattan = Math.abs(x) + Math.abs(y);
      expect(manhattan).toBeLessThanOrEqual(3);
      expect((manhattan - 3) % 2).toBe(0);
    }
  });

  it('never offers a cell inside a room as a corridor destination', () => {
    const { cells } = reachable({ room: null, x: 7, y: 7 }, 4, new Set());
    for (const [x, y] of cells) expect(roomAt(x, y)).toBeNull();
  });

  it('lets a player enter a room whose door is within reach', () => {
    // (7,4) is the corridor outside the Kitchen's right door.
    const { rooms } = reachable({ room: null, x: 7, y: 4 }, 1, new Set());
    expect(rooms).toContain('Kitchen');
  });

  it('does not offer a room that is too far away', () => {
    const { rooms } = reachable({ room: null, x: 0, y: 0 }, 1, new Set());
    expect(rooms).not.toContain('Study');
  });

  it('routes around a blocked corridor cell', () => {
    const open = reachable({ room: null, x: 7, y: 0 }, 2, new Set());
    const blocked = reachable({ room: null, x: 7, y: 0 }, 2, new Set(['7,1']));
    expect(blocked.cells.length).toBeLessThan(open.cells.length);
  });
});

/* ================================================================== */
/* Deal                                                                */
/* ================================================================== */

describe('the deal', () => {
  it('puts one of each type in the case file and deals the other 18', () => {
    for (const ids of [P3, ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e'], P6]) {
      const s = fresh(ids);
      expect(SUSPECTS).toContain(s.caseFile.suspect);
      expect(WEAPONS).toContain(s.caseFile.weapon);
      expect(ROOMS).toContain(s.caseFile.room);

      const dealt = s.players.flatMap((p) => p.hand);
      expect(dealt).toHaveLength(ELIMINABLE);
      expect(dealt).toHaveLength(18);
      expect(new Set(dealt).size).toBe(18);

      // No dealt card is in the case file.
      expect(dealt).not.toContain(s.caseFile.suspect);
      expect(dealt).not.toContain(s.caseFile.weapon);
      expect(dealt).not.toContain(s.caseFile.room);

      // Every card is accounted for exactly once.
      const all = [...dealt, s.caseFile.suspect, s.caseFile.weapon, s.caseFile.room].sort();
      expect(all).toEqual(ALL_CARDS.map((c) => c.id).sort());
    }
  });

  it('deals round-robin, so hands differ by at most one with 4 or 5 players', () => {
    for (const ids of [['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e']]) {
      const s = fresh(ids);
      const sizes = s.players.map((p) => p.hand.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('seeds each player eliminated set with their own hand', () => {
    const s = fresh();
    for (const p of s.players) expect(p.eliminated.sort()).toEqual([...p.hand].sort());
  });

  it('is deterministic for a seed', () => {
    const a = fresh(P3, 31337);
    const b = fresh(P3, 31337);
    expect(a.caseFile).toEqual(b.caseFile);
    expect(a.players.map((p) => p.hand)).toEqual(b.players.map((p) => p.hand));
  });

  it('places every weapon in a room', () => {
    const s = fresh();
    for (const w of WEAPONS) expect(ROOMS).toContain(s.weaponPositions[w]);
  });
});

/* ================================================================== */
/* Suggestion and refutation                                           */
/* ================================================================== */

describe('suggestions and refutation', () => {
  /** Put `id` in a room, ready to suggest. */
  function standIn(s: MMState, id: string, room: string): MMState {
    const p = s.players.find((x) => x.id === id);
    const door = DOORS_BY_ROOM[room]?.[0];
    if (p && door) {
      p.position = { room: room as never, x: door.x, y: door.y };
      s.suspectPositions[p.suspect] = { ...p.position };
    }
    s.current = s.players.findIndex((x) => x.id === id);
    s.phase = 'awaiting_suggestion';
    return s;
  }

  it('moves the named suspect and weapon into the suggester room', () => {
    let s = standIn(fresh(), 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(s.suspectPositions['Dr. Mauve']?.room).toBe('Library');
    expect(s.weaponPositions['Rope']).toBe('Library');
  });

  it('asks players clockwise and stops at the first who can refute', () => {
    let s = fresh();
    // Force known hands so the refuter is predictable.
    const [pa, pb, pc] = s.players;
    if (pa && pb && pc) {
      pa.hand = ['Ms. Crimson'];
      pb.hand = [];
      pc.hand = ['Rope'];
    }
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    // b holds nothing, so c is asked.
    expect(s.phase).toBe('awaiting_refutation');
    expect(s.pendingSuggestion?.asking).toBe('c');
  });

  it('lets the refuter choose which matching card to show', () => {
    let s = fresh();
    const [pa, pb] = s.players;
    if (pa && pb) {
      pa.hand = [];
      pb.hand = ['Dr. Mauve', 'Rope'];
    }
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(s.pendingSuggestion?.asking).toBe('b');

    // Either card is acceptable — the choice belongs to the refuter.
    expect(engine.reduce(s, 'b', { type: 'refute', card: 'Rope' }).ok).toBe(true);
    expect(engine.reduce(s, 'b', { type: 'refute', card: 'Dr. Mauve' }).ok).toBe(true);
    // But not a card they do not hold.
    expect(reject(s, 'b', { type: 'refute', card: 'Kitchen' })).toMatch(/do not hold/i);
  });

  it('reveals the card only to the suggester and logs only who refuted', () => {
    let s = fresh();
    const [pa, pb] = s.players;
    if (pa && pb) {
      pa.hand = [];
      pb.hand = ['Rope'];
    }
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    s = act(s, 'b', { type: 'refute', card: 'Rope' });

    const suggester = s.players.find((p) => p.id === 'a');
    expect(suggester?.eliminated).toContain('Rope');
    expect(suggester?.revelations[0]).toMatchObject({ card: 'Rope', from: 'b' });

    // The public log never names the card.
    const text = s.log.map((l) => l.text).join(' | ');
    expect(text).toContain('b refutes the suggestion');
    // "Rope" does appear in the suggestion line, but no line says b showed it.
    expect(text).not.toContain('b refutes the suggestion with Rope');

    // Nobody else learns it.
    const cView = engine.view(s, 'c') as MMView;
    expect(cView.you?.eliminated).not.toContain('Rope');
  });

  it('says so publicly when nobody can refute', () => {
    let s = fresh();
    for (const p of s.players) p.hand = [];
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(s.pendingSuggestion).toBeNull();
    expect(s.log.map((l) => l.text).join(' ')).toMatch(/nobody could refute/i);
  });

  it('refuses a refutation from someone who is not being asked', () => {
    let s = fresh();
    const [pa, pb, pc] = s.players;
    if (pa && pb && pc) {
      pa.hand = [];
      pb.hand = ['Rope'];
      pc.hand = ['Dr. Mauve'];
    }
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(reject(s, 'c', { type: 'refute', card: 'Dr. Mauve' })).toMatch(/not being asked/i);
  });

  it('does not end the turn — the suggester may still act', () => {
    let s = fresh();
    for (const p of s.players) p.hand = [];
    s = standIn(s, 'a', 'Library');
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(s.phase).toBe('awaiting_end_turn');
    expect(s.players[s.current]?.id).toBe('a');
  });

  it('refuses a suggestion from outside a room', () => {
    const s = fresh();
    s.phase = 'awaiting_suggestion';
    const p = s.players[0];
    if (p) p.position = { room: null, x: 0, y: 0 };
    expect(reject(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' })).toMatch(
      /room/i,
    );
  });
});

/* ================================================================== */
/* Accusation                                                          */
/* ================================================================== */

describe('accusation', () => {
  it('wins immediately when correct', () => {
    let s = fresh();
    s.phase = 'awaiting_action';
    s = act(s, 'a', {
      type: 'accuse',
      suspect: s.caseFile.suspect,
      weapon: s.caseFile.weapon,
      room: s.caseFile.room,
    });
    expect(s.winner).toBe('a');
    expect(s.phase).toBe('game_over');
    expect(engine.isOver(s)).toEqual({ over: true, winner: 'a' });
  });

  it('locks a wrong accuser out of moving, suggesting and accusing', () => {
    let s = fresh();
    s.phase = 'awaiting_action';
    const wrongRoom = ROOMS.find((r) => r !== s.caseFile.room) as string;
    s = act(s, 'a', {
      type: 'accuse',
      suspect: s.caseFile.suspect,
      weapon: s.caseFile.weapon,
      room: wrongRoom as never,
    });

    const a = s.players.find((p) => p.id === 'a');
    expect(a?.lockedOut).toBe(true);
    expect(a?.wrongAccusations).toBe(1);
    expect(s.winner).toBeNull();
    // The turn passed on.
    expect(s.players[s.current]?.id).not.toBe('a');

    s.current = 0;
    s.phase = 'awaiting_action';
    expect(reject(s, 'a', { type: 'roll' })).toMatch(/locked you out/i);
  });

  it('still requires a locked-out player to refute', () => {
    let s = fresh();
    const [pa, pb, pc] = s.players;
    if (pa && pb && pc) {
      pa.hand = [];
      pb.hand = ['Rope'];
      pc.hand = [];
      pb.lockedOut = true; // b accused wrongly earlier
    }
    const door = DOORS_BY_ROOM['Library']?.[0];
    if (pa && door) pa.position = { room: 'Library', x: door.x, y: door.y };
    s.current = 0;
    s.phase = 'awaiting_suggestion';

    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });
    expect(s.pendingSuggestion?.asking).toBe('b');
    // And they can actually do it.
    s = act(s, 'b', { type: 'refute', card: 'Rope' });
    expect(s.phase).toBe('awaiting_end_turn');
  });

  it('scores accuracy as 1 - 0.5 * wrongAccusations, floored at 0', () => {
    const s = fresh();
    const a = s.players[0];
    if (a) a.wrongAccusations = 1;
    expect(engine.score(s, 'a').accuracy).toBe(0.5);
    if (a) a.wrongAccusations = 3;
    expect(engine.score(s, 'a').accuracy).toBe(0);
  });
});

/* ================================================================== */
/* The privacy boundary — the anti-cheat invariant                     */
/* ================================================================== */

describe('view privacy', () => {
  /**
   * Note on what "secret" means here. Suspect, weapon and room NAMES are
   * unavoidably public: every suspect has a token on the board, every weapon
   * sits in some room, and room names are board geography. What must never leak
   * is *which* of them is the answer, and who holds which card. So these tests
   * assert on the card-knowledge channels (hand / eliminated / revelations) and
   * on the absence of the caseFile field — not on raw string absence, which
   * would fail for entirely innocent reasons.
   */
  it('never exposes the case file field to anyone', () => {
    const s = fresh();
    for (const viewer of [...P3, null]) {
      const v = engine.view(s, viewer) as Record<string, unknown>;
      expect(v['caseFile']).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain('caseFile');
    }
  });

  it('never lets a viewer learn a case-file card through any knowledge channel', () => {
    const s = fresh();
    const secrets = [s.caseFile.suspect, s.caseFile.weapon, s.caseFile.room] as string[];
    for (const viewer of P3) {
      const v = engine.view(s, viewer) as MMView;
      const known = [
        ...(v.you?.hand ?? []),
        ...(v.you?.eliminated ?? []),
        ...(v.you?.revelations ?? []).map((r) => r.card),
      ];
      for (const secret of secrets) expect(known).not.toContain(secret);
    }
  });

  it('never exposes another player hand', () => {
    const s = fresh();
    for (const viewer of P3) {
      const v = engine.view(s, viewer) as MMView;
      const others = s.players.filter((p) => p.id !== viewer);

      // No `hand` field on any public player record at all.
      for (const pub of v.players) {
        expect((pub as unknown as Record<string, unknown>)['hand']).toBeUndefined();
        expect(typeof pub.handSize).toBe('number'); // size is public, contents are not
      }

      // And nothing the viewer knows overlaps another player's cards, since in
      // a fresh game nothing has been shown yet.
      const known = [...(v.you?.hand ?? []), ...(v.you?.eliminated ?? [])];
      for (const other of others) {
        for (const card of other.hand) expect(known).not.toContain(card);
      }
    }
  });

  it('gives a spectator no card knowledge at all', () => {
    const s = fresh();
    const v = engine.view(s, null) as MMView;
    expect(v.you).toBeNull();
    for (const pub of v.players) {
      expect((pub as unknown as Record<string, unknown>)['hand']).toBeUndefined();
      expect((pub as unknown as Record<string, unknown>)['eliminated']).toBeUndefined();
      expect((pub as unknown as Record<string, unknown>)['revelations']).toBeUndefined();
    }
  });

  it('shows a player their own hand and revelations', () => {
    const s = fresh();
    const v = engine.view(s, 'a') as MMView;
    const a = s.players.find((p) => p.id === 'a');
    expect(v.you?.hand.sort()).toEqual([...(a?.hand ?? [])].sort());
  });

  it('only tells the player being asked that they must refute', () => {
    let s = fresh();
    const [pa, pb] = s.players;
    if (pa && pb) {
      pa.hand = [];
      pb.hand = ['Rope'];
    }
    const door = DOORS_BY_ROOM['Library']?.[0];
    if (pa && door) pa.position = { room: 'Library', x: door.x, y: door.y };
    s.current = 0;
    s.phase = 'awaiting_suggestion';
    s = act(s, 'a', { type: 'suggest', suspect: 'Dr. Mauve', weapon: 'Rope' });

    expect((engine.view(s, 'b') as MMView).you?.mustRefute).not.toBeNull();
    expect((engine.view(s, 'a') as MMView).you?.mustRefute).toBeNull();
    expect((engine.view(s, 'c') as MMView).you?.mustRefute).toBeNull();
  });
});

/* ================================================================== */
/* Scoring and the turn loop                                           */
/* ================================================================== */

describe('scoring', () => {
  it('scores progress as eliminated over 18', () => {
    const s = fresh();
    const a = s.players[0];
    if (a) a.eliminated = ALL_CARDS.slice(0, 9).map((c) => c.id);
    expect(engine.score(s, 'a').progress).toBeCloseTo(9 / 18);
  });

  it('marks the winner completed', () => {
    const s = fresh();
    s.winner = 'a';
    expect(engine.score(s, 'a').completed).toBe(true);
    expect(engine.score(s, 'b').completed).toBe(false);
  });

  it('starts every player at their own hand size', () => {
    const s = fresh();
    const a = s.players[0];
    expect(engine.score(s, 'a').progress).toBeCloseTo((a?.hand.length ?? 0) / 18);
  });
});

describe('the turn loop', () => {
  it('autoAction always produces something the reducer accepts', () => {
    let s = fresh();
    for (let i = 0; i < 400 && s.phase !== 'game_over'; i++) {
      const actor =
        s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking
          ? s.pendingSuggestion.asking
          : (s.players[s.current]?.id as string);
      const action = engine.autoAction(s, actor);
      const r = engine.reduce(s, actor, action);
      if (!r.ok) throw new Error(`autoAction illegal at ${s.phase}: ${r.error}`);
      s = r.state;
    }
  });

  it('replays to an identical state for a fixed seed', () => {
    const play = (): MMState => {
      let s = fresh(P3, 555);
      for (let i = 0; i < 200 && s.phase !== 'game_over'; i++) {
        const actor =
          s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking
            ? s.pendingSuggestion.asking
            : (s.players[s.current]?.id as string);
        const r = engine.reduce(s, actor, engine.autoAction(s, actor));
        if (!r.ok) break;
        s = r.state;
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.caseFile).toEqual(b.caseFile);
    expect(a.seq).toBe(b.seq);
  });

  it('refuses actions from a player who is not in the game', () => {
    const s = fresh();
    expect(reject(s, 'nobody', { type: 'roll' })).toMatch(/not in this game/i);
  });

  it('requires a roll before moving', () => {
    const s = fresh();
    expect(reject(s, 'a', { type: 'move', x: 0, y: 1 })).toMatch(/roll first/i);
  });

  it('rejects a move to an unreachable square', () => {
    let s = fresh();
    s = act(s, 'a', { type: 'roll' });
    expect(reject(s, 'a', { type: 'move', x: 23, y: 23 })).toMatch(/out of reach/i);
  });
});
