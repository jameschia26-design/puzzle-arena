# Scrabble — research and architecture report

Status: Phase 1 (research) and Phase 2 (architecture) complete. Implementation
outcome is appended to the end of this file once Phase 3-4 land.

## Phase 1 — Research

### 1.1 Official Scrabble rules

Standard rules for 2-4 players (the puzzle-arena convention — `minPlayers`/
`maxPlayers` on the registry entry — will set this to 2..4, matching the other
board games' pattern).

**Board.** 15×15. Row/column indices 0..14, centre at (7,7) marked with a star
and functions as a double-word square. Premium-square layout (symmetric across
both diagonals), 0-indexed `(row, col)`:

- **Triple Word (TW)** — 8 squares: `(0,0) (0,7) (0,14) (7,0) (7,14) (14,0) (14,7) (14,14)`
- **Double Word (DW)** — 17 squares (includes the centre star): the two
  diagonals from each corner inward, `(1,1) (2,2) (3,3) (4,4)` and their three
  other-corner mirrors, plus `(7,7)` (centre, also counts as DW for the first
  play).
- **Triple Letter (TL)** — 12 squares: `(1,5) (1,9) (5,1) (5,5) (5,9) (5,13) (9,1) (9,5) (9,9) (9,13) (13,5) (13,9)`
- **Double Letter (DL)** — 24 squares: `(0,3) (0,11) (2,6) (2,8) (3,0) (3,7) (3,14) (6,2) (6,6) (6,8) (6,12) (7,3) (7,11) (8,2) (8,6) (8,8) (8,12) (11,0) (11,7) (11,14) (12,6) (12,8) (14,3) (14,11)`

This is the standard tournament layout used by every NASPA/Hasbro/Mattel board
since 1948. It will be encoded as a static lookup table
(`packages/games/src/scrabble/board.ts`), generated once and unit-tested for
symmetry rather than hand-verified square by square in the reducer.

**Tile bag — 100 tiles.**

| Letter | Count | Value | Letter | Count | Value |
|---|---|---|---|---|---|
| A | 9 | 1 | N | 6 | 1 |
| B | 2 | 3 | O | 8 | 1 |
| C | 2 | 3 | P | 2 | 3 |
| D | 4 | 2 | Q | 1 | 10 |
| E | 12 | 1 | R | 6 | 1 |
| F | 2 | 4 | S | 4 | 1 |
| G | 3 | 2 | T | 6 | 1 |
| H | 2 | 4 | U | 4 | 1 |
| I | 9 | 1 | V | 2 | 4 |
| J | 1 | 8 | W | 2 | 4 |
| K | 1 | 5 | X | 1 | 8 |
| L | 4 | 1 | Y | 2 | 4 |
| M | 2 | 3 | Z | 1 | 10 |
| Blank | 2 | 0 | | | |

Counts sum to 100. This matches the standard English-language Scrabble
distribution used worldwide (both TWL/NWL and CSW regions use the same bag).

**Rack:** 7 tiles, drawn to refill after every completed turn (draw happens
after the play is scored, replacing exactly the tiles used).

**Rules confirmed for the engine:**
- First play must cover the centre star `(7,7)`.
- A play places tiles in a single straight line, either entirely horizontal or
  entirely vertical (never both) in one turn.
- After the first play, every subsequent play must connect to the existing
  board — at least one placed tile must be adjacent to (or extend) an
  existing word.
- All placed tiles form one *primary* word along the play axis; any complete
  word formed perpendicular to that axis by a placed tile plus existing
  neighbours is a *cross-word* and is scored too.
- Blanks: the placing player chooses the letter it represents at placement
  time; that choice is permanent for the rest of the game and always scores 0.
- **Exchange:** trade 0..n racked tiles for the same count drawn fresh from the
  bag, then the traded tiles go back into the bag. Only legal when the bag
  has **at least 7** tiles remaining (below that, exchanging would let a
  player see bag contents shrink to nothing while denying opponents draws —
  the standard tournament floor).
- **Pass:** decline to play or exchange; consumes the turn with no score
  change.
- **Scoring:** each newly placed letter's face value is multiplied by its
  square's letter premium (DL ×2, TL ×3; premiums apply only the *first* time
  a letter is placed on that square — a square used in an earlier turn no
  longer multiplies). Sum the (multiplied) letters of the primary word, then
  multiply the *whole word sum* by the word premium (DW ×2, TW ×3) if any
  newly placed tile sits on such a square. Repeat independently for every
  cross-word formed. Add all word scores together. Add a flat **+50 bingo**
  bonus if all 7 rack tiles were placed in one turn.
- **End of game — two triggers:**
  1. A player empties their rack **and** the bag is empty: that player's
     score gets `+2 × sum(face value of every OTHER player's unplayed
     tiles)` — because they gain the full total that would otherwise have
     been subtracted from them PLUS each opponent's own subtraction; the
     simple, standard formulation used in the engine is: the emptying
     player's score increases by the sum of everyone else's rack values,
     and every other player's score decreases by their own rack value. Net
     effect matches official rules exactly (`current score - own rack` for
     everyone, `+ sum of all opponents' racks` for the emptier only).
  2. **Six consecutive passes/exchanges with no play** (any mix of pass and
     exchange actions counts toward the streak; a legal placement resets it
     to 0) — game ends immediately, scores stand as-is, nobody gets a rack
     adjustment. This is the standard "double-pass" forfeiture rule
     generalised to N players, as used by NASPA and Hasbro clocks.
- Dictionary: see §1.2.

### 1.2 Dictionary — the licensing question

The captain said "official dictionary words." The honest trade-off:

- **TWL06 / current NWL2023 (NASPA Word List)** — the North American
  tournament standard (confirmed current via NASPAWiki as of August 2026;
  NWL2023 took effect 2024-02-29 and TWL06 is long superseded). ~200k words.
  Distributed by NASPA under a proprietary licence; **redistributing the file
  verbatim in an open-source repo is not permitted** without a commercial
  agreement.
- **CSW (Collins Scrabble Words, formerly "SOWPODS")** — the international
  standard (WESPA), ~280k words. Same licensing problem: Collins/HarperCollins
  owns it, not freely redistributable.
- **Open alternatives** large enough to be competitive:
  - `dwyl/english-words` — 466k tokens, MIT licence, but it is a general
    English wordlist (includes proper nouns, abbreviations, contractions,
    single letters as "words") that needs heavy filtering before it is usable
    as a Scrabble lexicon.
  - **ENABLE1** ("Enhanced North American Benchmark LExicon") — 172,820
    words, explicitly placed in the **public domain** by its compiler (Alan
    Beale / M. Cooper). Purpose-built as a Scrabble/word-game lexicon — no
    proper nouns, no punctuation, uppercase A-Z only, 2-15 letters. It has
    also been used as the word list behind Words With Friends. Confirmed
    downloadable (verified `HTTP 200`, `text/plain`, public-domain-marked
    mirror) from `raw.githubusercontent.com/dolph/dictionary/master/enable1.txt`.
  - `wordnik` — huge but a rate-limited HTTP API, not embeddable/offline —
    ruled out for a self-hosted room server.

**Decision: ship ENABLE1** (public domain, purpose-built, no filtering
required, no attribution restriction beyond a courtesy note). The report is
explicit in the repo that this is **"open-list, not NASPA/Collins-licensed"**
— casual multiplayer correctness, not tournament-rated correctness. Gotchas,
documented for players: ENABLE1 accepts some obscure/technical words NASPA's
NWL would reject, and is missing a handful of words NWL/CSW would accept
(most visibly, ENABLE1 has **no official two-letter word list quirks** — it
contains the standard English 2-letter words like "AA", "OE" etc. but the
short-word edge cases occasionally diverge from NWL). This is an acceptable,
disclosed trade-off for a casual web app and does not block Phase 3.

No captain input was needed to resolve this — the open-source constraint
already rules out TWL/CSW, so ENABLE1 is not a judgement call, it is the only
option that satisfies "ship a dictionary file in the repo." Not appending
`blocked:` for this.

### 1.3 AI engine — the bot question

Two paths, as the brief lays out:

- **Quackle** (BSD-2-Clause, C++, Qt UI + a `libquackle` core). Confirmed
  BSD-licensed via its project page. It is the reference-strength Scrabble
  engine (used to validate other engines' play strength), but:
  - No official JS/TS or Node bindings exist.
  - It would require either compiling a native Node addon (node-gyp / N-API,
    C++ toolchain in the Docker image) or shelling out to a separately-built
    CLI/binary via `child_process`.
  - Either path changes the deployment story: the single-image Docker build
    (`docker build -t puzzle-arena .`, per CLAUDE.md) would need a C++ build
    stage, and Zeabur/whatever host runs the image needs the extra binary
    size and build time. This is a real, non-trivial infra cost.
- **Custom TypeScript move generator + evaluator.** Weaker than Quackle
  (no proper GADDAG/anagram-dictionary cross-product search, no full
  simulation), but sufficient for casual bot play at easy/medium/hard tiers,
  with zero native dependencies — it is pure TS sharing the `packages/games`
  module boundary exactly like every other bot in this repo.

**Decision: no Quackle.** Build a custom TS move generator for all four
tiers (easy/normal/hard match `BotDifficulty` from the registry; "expert" is
the puzzle-arena `Difficulty` label reserved for puzzle rooms, not board-game
bot tiers — board games use `BOT_DIFFICULTIES = ['easy','normal','hard']`,
confirmed in `packages/shared/src/registry.ts`). This keeps the deployment
story unchanged (no native deps, no Docker build-stage changes, no new env
vars) and matches every other bot module in the repo. The report documents
explicitly, per the brief's requirement, that this is a **best-effort engine,
not tournament-strength** — it will not play at a Quackle/1500+ rating level.
A future task could add a Quackle-backed "expert" tier as an optional
native-binary sidecar, but that is out of scope here and is called out under
Risks (§9 below) rather than attempted.

Move-generation approach for the custom engine: for each rack, generate all
legal placements by anchoring off tiles already on the board (using the set
of "anchor squares" — empty squares adjacent to a placed tile, plus the
centre star on the first move) and checking every candidate word against an
in-memory dictionary Set. This is the standard "brute-force anchor + set
lookup" approach: with a rack of ≤7 tiles and a dictionary Set (O(1) lookup),
generating and validating candidate placements across ~30-60 live anchors is
comfortably sub-second in Node, well inside `BOT_THINK_MS`.

### 1.4 Difficulty tuning

Mapped onto `BotDifficulty = 'easy' | 'normal' | 'hard'` (the board-game bot
tier used everywhere else in the repo — NOT the puzzle `Difficulty` enum,
which is a config-time choice for puzzle generation and not applicable to
Scrabble's turn-based bot policy).

| Tier | Search | Move-selection policy | Board eval | Notes |
|---|---|---|---|---|
| easy | 1 ply — generate all legal moves, no rack-leave scoring | Pick a move uniformly at random from the moves scoring within 60% of the best found; ~15% chance to instead exchange low-value tiles even with a playable move | Raw score only | Deliberately error-prone and occasionally passes up bingos, like the puzzle bots' `ERROR_RATE` pattern |
| normal | 1 ply, full legal-move generation | Greedy: highest raw score wins ties broken by RNG | Raw score only | The reference "always plays the best move it can see" bot |
| hard | 1 ply generation + a lightweight rack-leave heuristic | Highest `score + leaveValue(remainingRack)` wins; `leaveValue` rewards keeping a vowel/consonant balance and duplicate S/blank tiles, penalizes keeping Q without a U | score + leave | Same idea as Quackle's "leave" concept, radically simplified — a hand-tuned static table, not a trained equity model |

`BOT_THINK_MS` (existing env var, default `null` = unconstrained, forced `0`
in tests) is honoured the same way every other bot is: the *think delay*
(`thinkDelay()` in `bots.ts`) is presentation-only scheduling and never reaches
the policy function, so it cannot affect determinism. Move generation itself
is capped at a single ply for all three tiers — multi-ply lookahead in
Scrabble means "simulate opponent's best reply," which requires knowing the
opponent's rack (hidden information) and is out of scope for a heuristic bot;
real strength gains there come from Monte Carlo rack sampling, which Quackle
does and this custom engine deliberately does not attempt. This keeps
generation itself at O(anchors × rack-permutations × dictionary lookups),
independent of `BOT_THINK_MS>0`, so a bot is never at risk of missing the
time budget even under the default unconstrained setting; at `BOT_THINK_MS=0`
(test mode) it is fully deterministic and synchronous through the RNG stream,
exactly like `propertyTycoonBot`/`manorMysteryBot`.

## Phase 2 — Architecture

### 2.1 Engine module plan

`packages/games/src/scrabble/`:

| File | Purpose |
|---|---|
| `board.ts` | 15×15 premium-square table, `squareAt(row,col)`, board-size constants |
| `tiles.ts` | Tile distribution, point values, bag construction, blank handling |
| `dictionary.ts` | ENABLE1 loader — reads the committed word file once, memoises a `Set<string>` behind a module-level lazy singleton |
| `words.ts` | `data/scrabble/enable1.txt` — the committed word list file (see §2.5) |
| `state.ts` | `ScrabbleState`, `ScrabblePlayer`, `PlacedTile`, `ScrabbleConfig` types |
| `rules.ts` | Pure helpers: placement legality, word extraction (primary + cross-words), scoring math, anchor-square computation — mirrors `property-tycoon/rules.ts`'s role |
| `bot.ts` | `scrabbleBot: BotPolicy<SCRBotView, ScrabbleAction>` — move generation + tier heuristics from §1.4 |
| `index.ts` | Wires `setup/reduce/autoAction/view/score/isOver/legalActions` into the `GameEngine` export, re-exports rules/board/tiles |
| `scrabble.test.ts` | The Phase-4 test file |

### 2.2 State shape

```ts
interface ScrabbleState extends BaseState {              // rng, seq, logSeq, winnerAtMs (from engine.ts)
  config: ScrabbleConfig;                                 // { turnTimeLimitSec }
  board: (PlacedTile | null)[];                            // length 225, row-major (row*15+col)
  bag: string[];                                            // remaining tile letters ('A'..'Z', '_' for blank)
  players: ScrabblePlayer[];
  current: number;                                          // index into players
  turnPhase: 'awaiting_move' | 'game_over';
  passStreak: number;                                       // consecutive pass/exchange turns; play resets to 0
  lastPlay: { word: string; score: number; playerId: string } | null; // for the client's "last play" banner
  winner: string | null;
  winReason: 'emptied-rack' | 'six-passes' | null;
  log: LogEntry[];
}

interface ScrabblePlayer {
  id: string;
  seat: number;
  rack: string[];                                           // 0-7 letters, '_' = unassigned blank
  score: number;
  actionsSubmitted: number;
  actionsAccepted: number;                                   // mirrors PT's accuracy accounting
  penalties: number;
}

interface PlacedTile {
  letter: string;                                            // the resolved letter (blank's chosen letter, upper-case)
  isBlank: boolean;
  playerId: string;                                          // who placed it, for potential future undo/history
}
```

This is the same immutable/reducer-friendly shape as `PTState`/`MMState`:
plain data, no methods, `structuredClone`-able, replay-safe (RNG lives in
`rng: RngState` and only `rngFrom(s.rng)` inside `reduce` ever advances it —
`Date.now()` never touches the reducer; a play's timing is stamped by the
runtime into `winnerAtMs` exactly like the other two board games).

### 2.3 Reduce handlers

All dispatched through the existing single `EV.gameAction` socket event —
**no new socket events**, per the existing wire contract (`GameAction` is
already a discriminated union of per-game action types; Scrabble adds a third
member, `ScrabbleAction`, to that union in `protocol.ts`). The brief's mention
of "move/draw/pass/exchange/end" events maps onto action *types* inside that
one event, exactly like Property Tycoon's `roll/buy/bid/...` and Manor
Mystery's `move/suggest/accuse/...` do — not new wire-level events. (Draw is
implicit: the reducer refills a rack to 7 automatically after every accepted
`place` or `exchange`, so there is no explicit "draw" action a player sends.)

| `action.type` | Signature | Behaviour |
|---|---|---|
| `place` | `{ type: 'place', tiles: { row: number; col: number; letter: string; isBlank?: boolean; blankLetter?: string }[] }` | Validates placement legality (§2.4), scores the play, updates board/score, refills rack from bag, resets `passStreak`, checks end-of-game |
| `exchange` | `{ type: 'exchange', letters: string[] }` | Only legal with `bag.length >= 7`; returns named letters to the bag, shuffles, draws the same count, increments `passStreak` |
| `pass` | `{ type: 'pass' }` | No board change; increments `passStreak`; ends game at `passStreak >= 6` |
| `endTurn` | not needed — `place`/`exchange`/`pass` each end the turn themselves (unlike Property Tycoon's separate roll→build→endTurn phases, Scrabble's turn *is* one action) |

`legalActions()` returns `['place', 'exchange', 'pass']` for the player on
turn when the game is running (exchange omitted once `bag.length < 7`), `[]`
otherwise — the client never needs to re-derive when exchange is disabled.
`autoAction()` (turn-timeout/disconnect fallback) always returns `{ type:
'pass' }` — the same "never auto-play something consequential" philosophy
Property Tycoon uses for auto-declining purchases.

Challenge (challenging a played word as invalid) is explicitly **out of
scope** per the brief and is not a reduce handler — invalid words are simply
prevented at placement time by the dictionary check, so there is nothing to
challenge in this version. Documented under Risks.

### 2.4 Move legality

`rules.ts` exposes `validatePlacement(s, playerId, tiles)`, returning either
an error string or the extracted word list to score. Checks, in order:

1. **Ownership** — every placed tile's letter (or blank) must be currently in
   the player's rack; consumed at most once each.
2. **Empty-square-only** — no placed tile may land on an already-occupied
   board square.
3. **Single line** — all placed coordinates share either the same row or the
   same column (a lone tile is trivially both; ambiguity resolved by
   inspecting existing board neighbours if any).
4. **Contiguity** — walking from the lowest to highest coordinate on the play
   axis, every square is either a newly placed tile or an already-occupied
   board square (no gaps).
5. **First-play rule** — if the board is currently empty, one of the placed
   tiles must be exactly `(7,7)`.
6. **Connectivity rule** — if the board is not empty, at least one placed
   tile must be adjacent (up/down/left/right) to an existing tile, OR an
   existing tile must lie between two placed tiles on the line (covered by
   check 4's contiguity already implying this whenever the line touches an
   occupied square).
7. **Word extraction** — build the full primary word by extending both
   directions along the play axis from contiguous letters (placed + already
   on board); for every placed tile, also extend perpendicular to find a
   cross-word if neighbouring squares are occupied. Each extracted word
   (length ≥ 2) is looked up in the dictionary Set from `dictionary.ts`;
   any miss fails the whole placement with `"<WORD> is not a valid word"`.
8. **Score** — for each extracted word, sum letter values (applying DL/TL
   only to *newly placed* tiles on those squares — pre-existing tiles keep
   their already-applied bonus, i.e. reuse never re-multiplies), then apply
   DW/TW multipliers from any newly placed tile in that word, add the +50
   bingo bonus if all 7 rack tiles were placed this turn.

This is intentionally the exact same shape as Property Tycoon's
`canBuild`/`canMortgage` family — small pure functions that return `string |
null` (or here, a discriminated success/failure), callable both from
`reduce()` and from `legalActions()`/the bot without duplicating logic.

### 2.5 Dictionary loader

- File: `packages/games/src/scrabble/data/enable1.txt` (one word per line,
  uppercase, ~172,820 entries, ~1MB). Committed verbatim with a top-of-repo
  `data/scrabble/ENABLE1-LICENSE.md` (or a header comment in the file itself)
  recording: source, "public domain (Alan Beale / M. Cooper)", and the
  "open-list, not NASPA/Collins-licensed" disclosure from §1.2.
- Loader (`dictionary.ts`): `readFileSync` once at module load
  (synchronous — this runs at server boot alongside every other static game
  table, same cost class as `packages/games`' other constant tables), split
  on newlines, build a `Set<string>`, freeze it behind a module-scope
  constant. No per-request I/O, no async initialisation step needed in
  `runtime.ts`. Exposed as `isValidWord(word: string): boolean`.
- Memoisation: the `Set` is a plain module-level singleton — Node's ESM
  module cache means it loads once per process regardless of how many rooms
  or games reference it, matching the existing pattern of static data tables
  (`BOARD`, `GROUPS`, `CARD_BY_ID` in `property-tycoon/board.ts`/`cards.ts`).

### 2.6 Bot strategy

`scrabble/bot.ts` exports `scrabbleBot: BotPolicy<SCRBotView, ScrabbleAction>`.
Per the module-boundary rule every other bot module follows, it declares its
own `SCRBotView` locally and does **not** import `ScrabbleState` — enforced
the same way `bots.test.ts` already asserts for Property Tycoon/Manor
Mystery (this task extends that test to cover Scrabble).

1. Compute anchor squares from the view's `board` (empty squares adjacent to
   an occupied square, or just the centre star if the board is empty).
2. For each anchor and each axis, enumerate placements the bot's rack can
   legally make (bounded by rack size ≤ 7 and board edges) and score them via
   the same `rules.ts` scoring function the reducer itself uses (imported by
   the bot module — pure functions have no state-privacy issue, only
   `ScrabbleState` itself is off-limits).
3. Apply the tier policy from §1.4 to choose among the generated legal moves;
   if none exist (empty rack can't play, or truly no legal placement), fall
   back to `exchange` (if `bag.length >= 7` and the rack has weak tiles) or
   `pass`.
4. All randomness (tie-breaking, easy-tier "occasionally bad move") draws
   only from the `Rng` parameter, never `Math.random()` — required for replay
   determinism, exactly like every other bot policy.

### 2.7 Socket events

No new socket-level events. Reuses `EV.gameAction` (client → server, ack
`GameActionAck`) and the existing broadcast set (`EV.gameState`,
`EV.leaderboard`, `EV.gameLog`, `EV.roomEnded`). The only wire change is
additive: `ScrabbleAction` joins the `GameAction` discriminated union in
`packages/shared/src/protocol.ts`, and `scrabbleConfigSchema` /
`GAME_REGISTRY.scrabble` join `registry.ts`. This satisfies "do not change
the wire format for any existing game" — nothing about the existing unions'
existing members changes, only a new variant is added to each.

### 2.8 Frontend

`apps/web/src/games/ScrabbleBoard.tsx` plus supporting pieces, mirroring how
`PropertyTycoonBoard.tsx`/`ManorMysteryBoard.tsx` are each a single file with
internal sub-components (not a directory of files — matches the existing
one-file-per-game convention):

- **Board grid** — 15×15 CSS grid, premium squares colour-coded (TW/DW/TL/DL
  swatches), placed tiles rendered with letter + point value, the centre
  star icon on `(7,7)` when empty.
- **Rack tray** — the player's own 7 tiles (from `view.you.rack`), drag-or-
  tap-to-place onto the board, with a "recall" affordance to pull a
  tentatively-placed tile back before submitting.
- **Blank-letter picker** — a small modal/sheet triggered when a blank tile
  is placed, letting the player pick A-Z before the placement can be
  submitted.
- **Exchange sheet** — multi-select from the rack, submits `exchange`;
  disabled (per `legalActions`) when the bag has fewer than 7 tiles.
- **Score panel** — per-player score, tiles-remaining-in-bag counter, whose
  turn it is, turn countdown (`turnEndsAt`, via the existing `Countdown`
  component already used by the other board games).
- **End-of-game modal** — final rack-value adjustments, winner, reuses the
  existing `ResultsTable`/`roomEnded` flow (`EV.roomEnded` → `results`) rather
  than inventing a new results surface.

`RoomPage.tsx` gets one more `if (gameId === 'scrabble') { return
<ScrabbleBoard .../> }` branch in the same if-chain that already handles
`property-tycoon` before its Manor-Mystery fallback, with the same
`(view, players, youId, legalActions, turnEndsAt, onAction)` prop contract
every board game component already uses.

### 2.9 Risks

- **Custom bot strength ceiling.** Explicitly acknowledged in §1.3: the
  bots will not play at competitive strength (no Quackle). If the captain
  later wants a genuinely strong "expert" bot, that is a follow-up task
  requiring a native-binary build stage — flagging now so it is not a
  surprise later.
- **Word-list correctness gap.** ENABLE1 is not the NASPA/Collins list; a
  small number of casual disputes ("is X a word?") are possible in either
  direction. Disclosed in-product would be a nice-to-have (e.g. a note near
  the board) but is not required by the brief and is left for a follow-up.
- **No challenge flow (by design, per Out of Scope).** Because there is no
  challenge action, an opponent can never contest a played word — the
  dictionary gate at placement time is the only correctness check. This
  matches "casual" framing but is a deliberate rules simplification versus
  real tournament Scrabble, where an unchallenged invalid word can also
  stand (so this is actually closer to "casual house rules" than a
  simplification of the *core* game).
- **Bag-size edge cases with 2 players vs 4 players.** With `minPlayers: 2,
  maxPlayers: 4` and racks of 7 each, a 4-player game can have as few as
  `100 - 4*7 = 72` tiles left after the opening racks are dealt — comfortably
  above the exchange floor of 7, so no special-casing is needed at setup.
- **`GAME_REGISTRY` maxPlayers.** Real Scrabble is officially 2-4 players
  (some house rules stretch to more with multiple bags, which is out of
  scope). `minPlayers: 2, maxPlayers: 4` will be set on the registry entry,
  consistent with `manor-mystery`'s `minPlayers: 3` precedent of not
  claiming to support solo/1-player rooms for a game that fundamentally
  needs an opponent (a 1-player Scrabble room is meaningless — nothing to
  race against — so solo-vs-bots is still satisfied by requiring ≥2 seats,
  with the second/third/fourth seat filled by a bot, exactly like Manor
  Mystery already requires ≥3 seats and is still "playable solo" by filling
  the rest with bots).
- **`runtime.ts#engine()` and `bots.ts` are currently a hard two-way
  ternary** (`gameId === 'property-tycoon' ? propertyTycoon : manorMystery`,
  and similarly in `scheduleBots`). Adding a third board game means these
  become a proper three-way dispatch (switch or lookup map) rather than a
  ternary. This is a mechanical refactor with no behaviour change for the
  existing two games, called out here so it doesn't read as scope creep
  when it shows up in the implementation diff.

Implementation outcome (Phase 3-4) will be appended below once landed.
