# Scoring & UX overhaul — report

Branch: `fm/feat-scoring-ux-overhaul`. Local-only; not pushed, no PR.

## 1. Manor Mystery — single-winner rule

`packages/games/src/manor-mystery/index.ts`: a wrong accusation now checks how
many players remain active (not locked out) *before* falling through to
`advanceTurn`. The moment only one player is left active, that player is
declared the winner immediately (`endByLastStanding`) instead of waiting for
every player to lock themselves out one turn at a time — which is what the old
`advanceTurn`'s `every(p => p.lockedOut)` branch actually required, and which
left `s.winner` unset (a real bug: nobody could ever be `completed` in that
path, so the results table would show no winner at all for a full lockout).
Seat order is the tie-break, applied inside `lastStanding()`, and used both by
the proactive path and as a defensive fallback inside `advanceTurn`/`isOver`
for the case where every player is somehow already locked out in one pass
(unreachable through the reducer today — min players is 3 and the accuse
handler always intercepts at exactly one active player left — but kept so the
game can never silently end with no winner). `MMState` gained one additive
field, `winReason: 'accusation' | 'last-standing' | null`, surfaced on `MMView`
too, so the client can phrase the two outcomes differently without parsing log
prose. The public log always carries a matching, distinctly-worded entry
(`"… — and is RIGHT"` vs `"… wins — last player standing (everyone else is
locked out)"`). `score()`'s `completed` flag is unchanged — it already keys
off `s.winner`, which both paths set identically.

## 2. Manor Mystery — leaderboard UX

`apps/server/src/rooms/runtime.ts` `leaderboard()`: fixed a second bug found
while implementing this — board games never set the puzzle-only
`LivePlayer.completed` flag, so the leaderboard's `completed` field (and thus
the "Done" badge) was always `false` for Manor Mystery and Property Tycoon,
win or not. `leaderboard()` now takes `completed` from the engine's own
`ScoreInput.completed` for board games. It also now exposes
`wrongAccusations` (Manor Mystery only, read from the engine's public view)
on `LeaderboardEntry` (new optional field on `leaderboardEntrySchema`, so the
wire shape for every other game is untouched), and sorts by `rankResults`
(the same helper `finish()` uses) once `status === 'finished'`, keeping the
existing progress-desc sort mid-game.

`apps/web/src/routes/RoomPage.tsx` `Leaderboard`: once the room is finished,
the progress bar switches to `entry.score / maxScore` (max taken across the
finished leaderboard) instead of `entry.progress`; mid-game is unchanged. The
winner's badge for Manor Mystery reads "Solved it" or "Last player standing"
depending on `winReason` (read off the board's own `state`, phrased identically
to `ManorMysteryBoard`'s own game-over status line so the two never disagree);
every other game keeps the generic "Done" badge. Non-winners with
`wrongAccusations > 0` get a small danger-toned "Wrong accusation" (or "N wrong
accusations") indicator.

## 3. Property Tycoon — asset-value scoring

Property Tycoon's final score is now total asset value, not
`computeScore`'s progress/accuracy/speed blend. New `assetValueBreakdown` /
`assetValue` in `packages/games/src/property-tycoon/rules.ts`: **cash on hand
+ sum of unmortgaged property prices + full (unhalved) house/hotel
construction cost**. This is deliberately not the same number as the existing
`netWorth` (used for the Revenue Levy and the in-game progress bar), which
credits a mortgaged deed at its mortgage value and halves the building
premium — that is a "what could I raise right now" number for in-game
decisions; asset value is an end-of-game scoreboard number, so it counts what
the player actually owns, not what a fire sale would fetch. `ScoreInput`
grew one additive optional field, `assetValue?: number`, documented in
`packages/shared/src/scoring.ts` as a board-game-only escape hatch that
`computeScore` never reads. `runtime.ts#finish()` uses `Math.round(input.assetValue)`
directly as the score for `property-tycoon` instead of calling `computeScore`,
and stores the full `{ cash, propertyValue, buildingValue, total }` breakdown
in `ResultRow.detail` (already an untyped optional column) so the breakdown
is queryable later even though no UI currently renders it. `leaderboard()`'s
mid-game `score` stays `null` until finish, same as before; once finished it
picks up the asset value and the client bar renders `score / maxScore`,
exactly like Manor Mystery. The four puzzle games' `computeScore` path is
untouched.

## 4. Property Tycoon — sell-deeds-while-in-debt mobile fix

Extracted the deed-grouping/rendering body of `Portfolio` into a new
`DeedList` component (private to `PropertyTycoonBoard.tsx`, not exported).
`DecisionPanel`'s debt block now mounts `DeedList` directly under the "short
by $X" line and above the bankruptcy button, so every mortgage/build/sell
control is reachable without scrolling past the docked decision card on a
phone. The sidebar `Portfolio` panel is hidden (`{!owingDebt && <Portfolio …>}`)
whenever the viewer is the indebted player, since it would otherwise be a
redundant, scrolled-away copy of the same list. The existing hint text ("Sell
houses or mortgage deeds below to raise it") needed no change — it now
correctly points at the list that is actually right below it.

## 5. Scoring audit

| Game | Formula | Verdict |
|---|---|---|
| Sudoku | progress = cellsCorrect/cellsTotal; accuracy = cellsCorrect/cellsFilled (1 if nothing filled) | Logical. Matches the brief exactly. Verified monotonic: for two completed solves (progress=1, accuracy=1), score is a strictly decreasing function of `completedAtMs` via `speedComponent`, so faster wins. Unsolved boards still score via the progress/accuracy terms (55%+20% of the weight) even at speed=0. |
| Killer Sudoku | Same `GradeResult` shape as Sudoku (`cellsTotal/cellsFilled/cellsCorrect/complete`), reusing the identical formula in `puzzle-adapter.ts`. | Logical. Confirmed `killer-sudoku.ts#grade()` returns the exact same shape as `sudoku.ts#grade()` — no divergence to fix. |
| Nonogram | progress = cellsCorrect/cellsTotal; accuracy = cellsCorrect/cellsFilled (1 if nothing filled) | Logical, but **the brief's literal wording ("accuracy = cellsFound / max(1, selectionsSubmitted)") does not match the implementation, on purpose** — Nonogram has no `selectionsSubmitted` concept at all (`nonogram.ts#grade()`'s `GradeResult` has no such field; that field only exists on `WordSearchGrade`). Nonogram is a per-cell paint/cross model, not a discrete-selection model like Word Search, so `cellsCorrect/cellsFilled` is the correct analogue: painting a wrong cell immediately lowers `cellsFilled` without raising `cellsCorrect`, penalising wrong marks exactly the way the brief asks for, just expressed in the cell domain the game actually has data for. No fix applied — changing this to a `selectionsSubmitted`-shaped formula would require inventing state the game doesn't track, and would change `PuzzleGrade`'s locked wire semantics for no behavioural gain. |
| Word Search | progress = wordsFound/wordsTotal; accuracy = wordsFound/max(1, selectionsSubmitted) | Logical. Matches the brief exactly. Every wrong drag selection increments `selectionsSubmitted` without moving `wordsFound`, so accuracy strictly drops with wasted attempts; `filledFraction` intentionally equals `progress` here because `checkSelection` only ever adds a word to `found` when it is correct — there is no "found but wrong" state to leak, so exposing `filledFraction` pre-finish leaks nothing extra. |
| Manor Mystery | progress = eliminated/18; accuracy = max(0, 1 − 0.5×wrongAccusations); completed = `s.winner === playerId` (now true for both accusation and last-player-standing wins) | Fix applied (see deliverable 1) — the pre-existing bug was that a full-lockout ending never set `s.winner`, so nobody scored `completed` and the game could silently end with no result. Fixed by declaring the last active player the winner the moment they're the only one left. |
| Property Tycoon | New: `assetValue` (see deliverable 3), no longer routed through `computeScore` | Fix applied (see deliverable 3) — the old `score()` used `computeScore`'s progress/accuracy/speed blend for a game whose actual win condition is "richest survivor", which does not fit that model (there is no meaningful "speed" or single "accuracy" for an open-information trading game). `progress`/`accuracy`/`completed` on `ScoreInput` are kept as-is for the in-game leaderboard bar and legality-based accuracy metric; only the *final* score changed. |

`computeScore`/`rankResults`/`PENALTY_POINTS`/`SCORE_WEIGHTS` themselves
(`packages/shared/src/scoring.ts`) were audited and left unchanged — the
weights sum to 1.0, the clamp to `[0, 1000]` is correct, and the tie-break
chain (score desc → completedAtMs asc, nulls last → penalties asc → seat asc)
is exercised by `scoring.test.ts` and behaves as documented.

## Tests added/updated

- `packages/games/src/manor-mystery/manor-mystery.test.ts`: new tests for
  `winReason === 'accusation'` on a correct accusation; the sole remaining
  active player winning immediately (without acting) once everyone else is
  locked out, with the log carrying a "last player standing" entry and
  `engine.score(...).completed` true for them; and a direct test of the
  defensive `advanceTurn`/`isOver` fallback's seat-order tie-break for an
  all-locked-out state reached without going through the accuse handler.
- `packages/games/src/property-tycoon/property-tycoon.test.ts`: new
  `describe('asset-value scoring …')` block covering the exact formula
  (cash + unmortgaged price + full house cost), how it diverges from
  `netWorth` on both a built-up and a mortgaged deed, the `assetValueBreakdown`
  shape, and that `engine.score(...).assetValue` matches
  `assetValue(s, playerId)` (and is `undefined` for an unknown player).

## Verification

- `npx tsc -b` — clean.
- `BOT_THINK_MS=0 npx vitest run` — 212/212 passing (against a local Postgres
  started with `docker compose up -d` + `npm run db:migrate`, as required by
  `apps/server/src/e2e.test.ts`).
- `npm run build` in `apps/web` — succeeds.
