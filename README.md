# Puzzle Arena

A multiplayer puzzle and board game platform. An admin registers, hosts a room,
and players join with a 6-character passcode. Seven games — four concurrent
puzzles (Sudoku, Killer Sudoku, Nonogram, Word Search) and three turn-based board
games (Property Tycoon, Manor Mystery, Scrabble). Every game is playable solo
against bots.

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

Register the first host at `/admin/signup` using the `ADMIN_SIGNUP_CODE` from
your `.env`. There is no seeded account.

## Tests

```bash
npx vitest run                        # everything
BOT_THINK_MS=0 npx vitest run         # bots act instantly — required for e2e
```

`apps/server/src/e2e.test.ts` boots a real Fastify + socket.io server against
the real Postgres, so `docker compose up -d` has to have run first.

## Design notes

Puzzles are generated in-house with proven-unique solutions; the solution never
leaves the server until a room ends. Engine state replays bit-for-bit from an
append-only `room_events` log, which is what makes crash recovery work — so
reducers never read the wall clock and all randomness comes from a seeded PRNG
carried in state.

LLM providers are configured at runtime from `/admin/ai`; any OpenAI-compatible
`POST {baseUrl}/chat/completions` endpoint works, and keys are AES-256-GCM
encrypted at rest. If a provider fails, rooms still start on bundled fallback
content.

`PLAN.md` is the full build reference. `CLAUDE.md` records how to run it and the
non-obvious things that will bite you.

## Configuration

All configuration is environment variables — see `.env.example`. Real secrets
live in `.env`, which is git-ignored and must never be committed.
