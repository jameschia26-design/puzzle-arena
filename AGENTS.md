# Puzzle Arena — working notes

Multiplayer puzzle and board game platform. An admin registers, hosts a room,
and players join with a 6-character passcode. Seven games: four concurrent
puzzles (Sudoku, Killer Sudoku, Nonogram, Word Search) and three turn-based
board games (Property Tycoon, Manor Mystery, Scrabble). Every game is
playable solo against bots.

`PLAN.md` is the build reference and the source of truth for design decisions.
This file records how to run it and what to be careful about.

## Layout

```
packages/shared    Zod wire schemas, scoring, game registry, PRNG. No I/O.
packages/puzzles   Generators + solvers + graders for the four puzzles.
packages/games     Turn-based reducers and bot policies.
apps/server        Fastify 5 + socket.io + Drizzle + Better Auth + room runtime + AI.
apps/web           Vite + React 19 + Tailwind 4 + zustand.
```

## Running locally

```bash
docker compose up -d                  # Postgres on host port 5433
cp .env.example .env                  # then fill in the secrets
npm ci
npm run db:migrate
npm run dev                           # server on :8080, Vite on :5173
```

Notes:
- Compose publishes Postgres on **5433**, not 5432, because a local Postgres was
  already holding 5432 on the dev machine. `DATABASE_URL` must match.
- The server serves `apps/web/dist` when it exists; otherwise it is API-only and
  you use the Vite dev server, which proxies `/api` and `/socket.io`.
- `/ui` is the component gallery and is mounted only in dev.

## Tests

```bash
npx vitest run                        # everything (234 tests)
BOT_THINK_MS=0 npx vitest run         # bots act instantly — required for e2e
```

`apps/server/src/e2e.test.ts` boots a real Fastify + socket.io server against the
real Postgres. It needs `docker compose up -d` first.

## Things that will bite you

- **Never call `Date.now()` inside a reducer.** Engine state must replay
  bit-for-bit from `room_events`, and a timestamp in state silently breaks that.
  Log entries use a logical counter (`logSeq`); the winner's finish time is
  stamped by the runtime (`winnerAtMs`), which is the only component that owns a
  clock. There is a determinism test for this in `bots.test.ts`.
- **Bots must only ever see `engine.view(state, botId)`.** Each `bot.ts`
  deliberately does not import its own state type — the module boundary is the
  enforcement, and `bots.test.ts` asserts it at runtime too.
- **The leaderboard broadcasts `filledFraction`, not `correctFraction`,** while
  instant feedback is off. Otherwise it leaks the solution one cell at a time.
- **`armTurnTimer()` must run *before* `broadcastGameState()`.** The turn
  deadline rides on `game:state`, so arming afterwards ships every client the
  previous actor's deadline; the on-screen countdown then hits zero with
  nothing happening, and the real auto-action lands later out of nowhere.
- **Rehydration has to restart the bot scheduler, not just the turn timer.** A
  recovered room whose next actor is a bot otherwise comes back `running` and
  sits there forever.
- **`wildcard: true` on @fastify/static is load-bearing.** With it off, the file
  list resolves at startup, so after a rebuild the new hashed assets fall through
  to the SPA fallback and the browser is served HTML where it expects JS.
- **`.dockerignore` must exclude `**/*.tsbuildinfo`.** A stale one from the host
  convinces `tsc -b` the tree is already built, and the image ships with no
  `dist/`.
- **`LivePlayer.completed` (runtime.ts) is puzzle-only.** It is set from the
  puzzle commit path and never touched by board games, so it is always
  `false` for Property Tycoon and Manor Mystery. Anything that needs to know
  whether a board-game player has *won* must read `engine.score(state,
  playerId).completed` instead — that is what `runtime.ts#leaderboard()` does.
- **Board games don't all score the same way.** `computeScore` (progress /
  accuracy / speed / penalties) is the puzzle-game default and Manor
  Mystery's model too, but Property Tycoon and Scrabble both set
  `ScoreInput.assetValue` (Property Tycoon: total asset value, computed in
  `property-tycoon/rules.ts`; Scrabble: raw point total, `scrabble/index.ts`)
  and bypass `computeScore` entirely in `runtime.ts#finish()`. Check
  `ScoreInput.assetValue !== undefined` before assuming `computeScore` is
  what produced a board game's score.
- **npm workspaces does not hoist everything.** `better-auth` and `nanoid`
  resolve to `apps/server/node_modules`, which the runtime image must copy.
- **`packages/games` is `"sideEffects": false` on purpose.** `apps/web`
  imports `@puzzle-arena/games` straight from source (see `vite.config.ts`'s
  alias), and `packages/games/src/index.ts` is one barrel that statically
  imports every board game's engine. Without that flag, Rollup keeps a
  submodule's top-level evaluation for any import reached by the client's
  build, even when the specific bindings pulled from the barrel are
  unrelated and get dead-code-eliminated afterward — that shipped Scrabble's
  172k-word dictionary to every player's browser until it was added. A large
  static table or asset added to any board game engine belongs in
  `packages/shared` if the client needs to render from it directly (board
  layout, tile values, …) — importing `@puzzle-arena/games` client-side
  should stay limited to types and small per-game view/rules helpers.
- **Puzzle Bubble canvas layout is derived, never hand-tuned.** Bubble
  *centres* stop one `BUBBLE_RADIUS` short of `0` and `BOARD_WIDTH`
  (`puzzle-bubble/rules.ts`), because a bubble is a disc. `PuzzleBubbleBoard.tsx`
  computes every wall, the ceiling, the danger line and the launcher from those
  constants at one pixel pitch. Picking canvas numbers independently is what
  previously drew the walls ~48px away from where shots actually banked and
  squeezed the 8-column grid into the middle half of the playfield.
- **The Puzzle Bubble client draws one shot behind the server.** The reducer
  resolves a shot atomically, so the board in `game:state` already has the pop
  applied; rendering it directly bursts bubbles while their shot is still in
  the air. The component holds a drawn snapshot (board + HUD + loaded bubble)
  and commits it — with the pop/drop particles — only when the flight along
  `lastShot.path` reaches the landing slot. `/dev/bubble` is the harness for
  checking this without a server, like `/dev/pacman`. The input lock is
  ref-backed and re-arms when the authoritative shot arrives; starting one
  state-only timer when the action is sent unlocks early by the network
  round-trip and allows overlapping shots.
- **Puzzle Bubble has separate portrait/landscape JSX trees, so the
  `<canvas>` remounts on orientation flip.** `PuzzleBubbleBoard.tsx` picks a
  layout from actual `innerWidth`/`innerHeight` (`useOrientation`), not a CSS
  breakpoint, so a rotated phone gets the landscape layout too — but that
  means the two branches are different DOM trees and React remounts the
  canvas when the branch changes. The render loop attaches through a
  callback ref (`attachCanvas`), not `useRef` + a mount-only effect: a
  `[commit]`-only effect only runs once and would keep animating a detached
  canvas after the first orientation change, leaving the new one blank.
- **Puzzle Bubble's ceiling timer must preserve its remaining interval across
  pause/resume.** `runtime.ts` owns both the deadline sent as
  `pressureEndsAtMs` and the recursive timeout. Resetting it to a full interval
  on resume lets a host postpone every descent by repeatedly pausing.
- **Block Blaster's board geometry is measured from real cell rects, never
  `boardElement.width / 8`.** `measureGrid()` (`BlockBlasterBoard.tsx`) reads
  cells `[0][0]`, `[0][1]`, `[1][0]` for origin and pitch; the border-box
  shortcut ignores `border-4`, breakpoint padding and the grid `gap` and
  drifts over a full cell by the far edge, desyncing the pointer, the
  shadow, the floating piece and the particle canvas together.
  `computeDragFrame()` is the single source of truth for the held piece's
  top-left, board overlap and snapped cell, so the floating piece and its
  shadow can never disagree — and the shadow stays drawn (piece-coloured
  legal, red illegal) above the cells for the whole gesture, since hiding
  it on an illegal position leaves the player holding nothing they can see.

## AI providers

Configured at runtime from `/admin/ai`; adding a provider needs no code change.
Any OpenAI-compatible `POST {baseUrl}/chat/completions` endpoint works. Keys are
AES-256-GCM encrypted at rest and never returned over HTTP (only `keyLast4`).

- MiniMax platform keys (`sk-cp-…`) authenticate against **`api.minimax.io/v1`**
  (global). `api.minimaxi.com` is the mainland China endpoint and returns 401 for
  them. Switch it in `/admin/ai` — no redeploy.
- MiniMax-M3 is a **reasoning** model: it spends tokens thinking before it
  answers, so the plan's 8s default timeout times out on a real word list. The
  default is now 30s.
- If a provider fails, the room still starts on bundled fallback content with a
  warning in the log. Results are cached in `ai_content` by
  `(task, sha256(model + system + user))`.

## Deployment

`docker build -t puzzle-arena .` produces a single image that runs migrations on
boot and serves both the API and the SPA on `:8080`. Required env: `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ENCRYPTION_KEY`, `COOKIE_SECRET`,
`ADMIN_SIGNUP_CODE`, plus the `AI_*` values to seed the default provider.

Room state lives in memory, so there is exactly one server instance. Scaling out
needs `@socket.io/postgres-adapter` plus a per-room lock — see PLAN.md.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
