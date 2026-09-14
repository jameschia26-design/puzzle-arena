# Infrastructure, Security, and Operational Audit: Puzzle Arena

**Date**: 2026-09-12  
**Target**: Puzzle Arena Monorepo  
**Classification**: Internal Technical Audit  
**Status**: Completed  

---

## Executive Summary

This audit evaluates the infrastructure, containerization, operational posture, security controls, and scalability architecture of the **Puzzle Arena** application.

While the codebase demonstrates high-quality application design—featuring deterministic game replay logs, bit-for-bit crash recovery, authenticated WebSockets, and encrypted AI provider keys—it currently exhibits critical operational and security vulnerabilities that pose substantial risks in production environments:

1. **Insecure Secret Fallbacks in Production**: Core application secrets (`APP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `COOKIE_SECRET`, `ADMIN_SIGNUP_CODE`) fall back to static, publicly known strings if unconfigured in production, permitting unauthorized admin account creation and cryptographic bypass.
2. **Production Secret Leakage via Incomplete `.dockerignore`**: `.dockerignore` excludes `.env` and `.env.local` but fails to ignore wildcard `.env.*` files (such as `.env.zeabur`), copying live production secrets directly into intermediate Docker build stages.
3. **Unchecked Migration Failure on Server Boot**: Database migrations run synchronously during server startup inside a `try/catch` block that catches and logs migration errors but allows the server to proceed booting, serving live multiplayer traffic on unmigrated or corrupted database schemas.
4. **Unprotected Admin Registration Route**: The custom `/api/admin/register` endpoint enforces the `ADMIN_SIGNUP_CODE` with constant-time equality but completely bypasses rate limiting, enabling unthrottled brute-force attacks against the admin signup code.
5. **Architectural Single-Instance Scaling Ceiling**: The application runtime relies entirely on in-process memory state (`LiveRoom`, `rooms_registry`, in-memory seat locks, in-memory tick/turn timers, and local Socket.IO adapters). Deploying multiple container instances will lead to split-brain room state, desynchronized players, race conditions on seat assignment, and duplicate event sequence numbers (`seq`) crashing the database.

---

## Prioritized Findings Matrix

| ID | Severity | Title | Affected File(s) / Component(s) |
|---|---|---|---|
| **SEC-01** | **Critical** | Insecure Default Secret Fallbacks Permitted in Production | `apps/server/src/env.ts` (`required()`) |
| **SEC-02** | **Critical** | Incomplete `.dockerignore` Copies Production Secrets and Bloat into Docker Context | `.dockerignore`, `Dockerfile` |
| **OPS-01** | **Critical** | Swallowed Migration Failures on Server Boot Allow Traffic on Broken Schemas | `apps/server/src/index.ts` (`main()`) |
| **SEC-03** | **High** | Admin Registration Route Lacks Rate Limiting Permitting Code Brute-Forcing | `apps/server/src/routes/admin.ts`, `apps/server/src/index.ts` |
| **ARC-01** | **High** | In-Memory Game Runtime Blocks Horizontal Scaling and Causes Split-Brain State | `apps/server/src/rooms/runtime.ts`, `apps/server/src/socket.ts` |
| **SEC-04** | **High** | Docker Runtime Container Runs as Root (Missing Non-Root User) | `Dockerfile` (runtime stage) |
| **SEC-05** | **High** | Absence of Secret & Key Rotation Mechanism Permanently Bricks Stored Credentials | `apps/server/src/ai/crypto.ts`, `apps/server/src/env.ts` |
| **OPS-02** | **Medium** | Absence of CI/CD Pipeline and Web Typecheck Verification Gap | Monorepo root, `package.json`, `tsconfig.json` |
| **OPS-03** | **Medium** | Shallow Health Check Masks Database Failures and Pool Exhaustion | `apps/server/src/index.ts` (`/api/health`) |
| **OPS-04** | **Medium** | Missing Graceful Shutdown Lifecycle Abruptly Drops In-Flight Games & DB Connections | `apps/server/src/index.ts` |
| **OPS-05** | **Medium** | Disabled HTTP Request Logging Impairs Observability and Incident Response | `apps/server/src/index.ts` (`buildServer()`) |
| **SEC-06** | **Low** | Unbounded Socket.IO Inbound Event Rates (Spam/DoS Risk) | `apps/server/src/socket.ts` |
| **OPS-06** | **Low** | Hardcoded Database Pool Configuration Without Lifecycle Limits | `apps/server/src/db/index.ts` (`postgres()`) |

---

## Detailed Findings

### CRITICAL SEVERITY

---

#### SEC-01: Insecure Default Secret Fallbacks Permitted in Production
- **File(s) / Function(s)**: `apps/server/src/env.ts` (lines 18–45)
- **Why It Matters (Risk/Cost)**:
  The `required(name, fallback)` helper returns `process.env[name] ?? fallback`. When a fallback is provided, `required()` never throws, even when `NODE_ENV === 'production'`.
  If an operator deploys the container without setting environment variables (or makes a configuration naming error):
  - `ADMIN_SIGNUP_CODE` defaults to `'letmein'`, allowing anyone on the internet to register an administrator account at `/api/admin/register`.
  - `APP_ENCRYPTION_KEY` defaults to `'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='` (32 raw zero-bytes), allowing anyone with database read access to trivially decrypt third-party LLM API keys.
  - `BETTER_AUTH_SECRET` and `COOKIE_SECRET` fall back to predictable strings (`'dev-only-better-auth-secret-change-me'`, `'dev-only-cookie-secret-change-me'`), enabling trivial session forgery and guest impersonation across all game rooms.
- **Recommended Fix**:
  Enforce strict environment validation in `env.ts`. When `process.env['NODE_ENV'] === 'production'`, disallow all development fallbacks and fail fast during initialization:
  ```ts
  function required(name: string, fallback?: string): string {
    const isProd = process.env['NODE_ENV'] === 'production';
    const value = process.env[name] ?? (isProd ? undefined : fallback);
    if (!value || value.trim() === '') {
      throw new Error(`Missing required environment variable in ${isProd ? 'production' : 'development'}: ${name}`);
    }
    if (isProd && fallback && value === fallback) {
      throw new Error(`Production environment variable ${name} must not use the default insecure fallback`);
    }
    return value;
  }
  ```

---

#### SEC-02: Incomplete `.dockerignore` Copies Production Secrets and Bloat into Docker Context
- **File(s) / Function(s)**: `.dockerignore` (lines 1–14), `Dockerfile` (line 20)
- **Why It Matters (Risk/Cost)**:
  `.dockerignore` explicitly ignores `.env` and `.env.local`, but misses wildcard patterns like `.env.*`.
  In the repository, files such as `.env.zeabur` (which contains real secret keys: `BETTER_AUTH_SECRET`, `COOKIE_SECRET`, `APP_ENCRYPTION_KEY`, and `ADMIN_SIGNUP_CODE`) and `.env.local.bak` are present.
  When `Dockerfile` runs `COPY . .` in stage 1 (`build`), `.env.zeabur` is sent in the Docker build context and baked into the intermediate image layer. If intermediate layers or build caches are exported, inspected, or pushed to a container registry, production credentials are fully leaked.
  Additionally, `.dockerignore` does not exclude root-level screenshots and game pad test images (`*.png`, totaling dozens of megabytes), `.qa/`, `tools/`, or `.vscode/`, unnecessarily bloating build context transfer times and invalidating cache layers.
- **Recommended Fix**:
  Update `.dockerignore` to mirror `.gitignore` security boundaries and exclude all secrets, temporary assets, and testing artifacts:
  ```dockerignore
  node_modules
  **/node_modules
  dist
  **/dist
  .git
  .env
  .env.*
  !.env.example
  *.pem
  *.key
  secrets/
  *.tsbuildinfo
  **/*.tsbuildinfo
  coverage
  **/coverage
  *.png
  *.jpg
  *.jpeg
  screenshots/
  .qa/
  tools/
  .cache/
  tmp/
  .vscode/
  .idea/
  ```

---

#### OPS-01: Swallowed Migration Failures on Server Boot Allow Traffic on Broken Schemas
- **File(s) / Function(s)**: `apps/server/src/index.ts` (lines 127–134, `main()`)
- **Why It Matters (Risk/Cost)**:
  In `main()`, database migrations are executed on startup within a `try/catch` block:
  ```ts
  try {
    await migrate(db, { migrationsFolder: resolve(here, '../drizzle') });
    logger.info('migrations up to date');
  } catch (err) {
    logger.error({ err }, 'migration failed');
  }
  ```
  If a migration fails due to network partitions, lock timeouts, DDL syntax errors, or schema conflicts, the error is logged as an error, but the function **does not abort**. The server proceeds to `seedDefaultProvider()`, binds port 8080, attaches Socket.IO, and accepts client connections.
  Running on an unmigrated or partially migrated database causes catastrophic runtime failures (500 errors on API routes, unhandled exceptions on Socket.IO game actions, and data corruption).
- **Recommended Fix**:
  Crash immediately if schema migration fails, preventing traffic from reaching an unhealthy server instance:
  ```ts
  try {
    await migrate(db, { migrationsFolder: resolve(here, '../drizzle') });
    logger.info('migrations up to date');
  } catch (err) {
    logger.fatal({ err }, 'database migration failed; aborting startup');
    process.exit(1);
  }
  ```
  Furthermore, in production Kubernetes/Zeabur setups, decouple schema migrations from application pod startup by executing migrations as a dedicated pre-deployment step (`npm run db:migrate` via CI/CD release pipeline or Kubernetes init container).

---

### HIGH SEVERITY

---

#### SEC-03: Admin Registration Route Lacks Rate Limiting Permitting Code Brute-Forcing
- **File(s) / Function(s)**: `apps/server/src/routes/admin.ts` (lines 48–83, 89–129), `apps/server/src/index.ts` (lines 35, 46, 68–71)
- **Why It Matters (Risk/Cost)**:
  In `index.ts`, `@fastify/rate-limit` is registered with `global: false`. Rate limiting (`max: 20, timeWindow: '1 minute'`) is selectively applied to `/api/auth/*`.
  However, the custom endpoints `/api/admin/register` and `/api/admin/sign-up/google`—which validate `parsed.data.signupCode` against `env.adminSignupCode`—have **no rate limit configuration applied**.
  Although `safeEqual()` prevents timing attacks, an unauthenticated attacker can execute tens of thousands of automated requests per minute against `/api/admin/register` to brute-force the `ADMIN_SIGNUP_CODE`, subsequently acquiring full administrative control over the platform and access to all AI provider keys.
- **Recommended Fix**:
  Apply strict rate limiting to all administrative registration routes in `apps/server/src/routes/admin.ts`:
  ```ts
  const strictLimiter = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  app.post('/api/admin/register', strictLimiter, async (req, reply) => { ... });
  app.post('/api/admin/sign-up/google', strictLimiter, async (req, reply) => { ... });
  ```

---

#### ARC-01: In-Memory Game Runtime Blocks Horizontal Scaling and Causes Split-Brain State
- **File(s) / Function(s)**:
  - `apps/server/src/rooms/runtime.ts` (`rooms_registry = new Map<string, LiveRoom>()`, lines 1349–1370)
  - `apps/server/src/socket.ts` (`roomJoinLocks = new Map()`, `attachSocket()`, lines 22–41, 239–248)
  - `apps/server/src/index.ts` (`rehydrateRunningRooms()`, lines 144)
  - Reference: `PLAN.md` (lines 19, 620)
- **Why It Matters (Risk/Cost)**:
  The entire multiplayer engine is anchored in Node.js heap memory:
  1. **Split-Brain State**: `LiveRoom` instances reside in `rooms_registry` (a local `Map`). If two instances run behind a load balancer, players joining room `ABCD` may connect to different nodes. Each node instantiates its own isolated `LiveRoom`, creating two completely desynchronized games under the same room code.
  2. **Socket.IO Local Broadcasts**: Socket.IO uses the default local adapter without a pub/sub mechanism. Sockets connected to Instance 1 never receive events emitted on Instance 2.
  3. **Event Sequence Collisions**: `room_events` enforces a primary key on `(room_id, seq)`. Since `this.seq` is an in-memory counter on each `LiveRoom`, concurrent writes from multiple instances will generate identical sequence numbers, resulting in database unique constraint violations and dropped moves.
  4. **Race Conditions on Seat Locks**: Seat assignment concurrency is protected solely by `roomJoinLocks = new Map<string, Promise<void>>()`, which has no visibility across instances.
  5. **Startup Rehydration Storm**: `rehydrateRunningRooms()` fetches all active rooms from Postgres on boot. If multiple instances boot or scale up simultaneously, every instance will rehydrate and run competing game loops, bot schedulers, and countdown timers for the same rooms.
- **Recommended Fix**:
  To achieve multi-instance horizontal scalability as scoped in `PLAN.md`:
  1. Integrate `@socket.io/postgres-adapter` (or Redis adapter) to synchronize socket broadcasts across server processes.
  2. Introduce distributed room ownership: either enforce sticky room routing at the load balancer (routing requests by room code) or implement an advisory lock mechanism (e.g. `SELECT pg_try_advisory_lock(hashtext(roomId))`) so only one node hosts and ticks a given `LiveRoom`.
  3. Replace the in-memory `roomJoinLocks` with transactional database locking (`SELECT ... FOR UPDATE` on `rooms` or `room_players`).
  4. Scope `rehydrateRunningRooms` to claim room ownership via advisory locks before starting timers and bot loops.

---

#### SEC-04: Docker Runtime Container Runs as Root (Missing Non-Root User)
- **File(s) / Function(s)**: `Dockerfile` (lines 28–57)
- **Why It Matters (Risk/Cost)**:
  The runtime container stage (`FROM node:24-alpine AS runtime`) does not define a `USER` directive. Consequently, the Node.js server and all subprocesses run as `root` (UID 0).
  Running as root violates the Principle of Least Privilege and container hardening benchmarks (CIS Docker Benchmark 4.1). In the event of a remote code execution (RCE) vulnerability in Fastify, Better Auth, or any unpinned native dependency, an attacker gains unrestricted root access within the container, facilitating host escape or unauthorized container tampering.
- **Recommended Fix**:
  Leverage the pre-existing unprivileged `node` user provided by Alpine Node images. Set directory ownership during file copy and switch user before execution:
  ```dockerfile
  # ---------- stage 2: runtime ----------
  FROM node:24-alpine AS runtime
  WORKDIR /app
  ENV NODE_ENV=production
  ENV PORT=8080
  ENV HOST=0.0.0.0

  # Copy dependencies and application artifacts with unprivileged ownership
  COPY --chown=node:node --from=build /app/node_modules ./node_modules
  COPY --chown=node:node --from=build /app/package.json ./package.json
  COPY --chown=node:node --from=build /app/packages/shared/package.json ./packages/shared/
  COPY --chown=node:node --from=build /app/packages/shared/dist ./packages/shared/dist
  COPY --chown=node:node --from=build /app/packages/puzzles/package.json ./packages/puzzles/
  COPY --chown=node:node --from=build /app/packages/puzzles/dist ./packages/puzzles/dist
  COPY --chown=node:node --from=build /app/packages/games/package.json ./packages/games/
  COPY --chown=node:node --from=build /app/packages/games/dist ./packages/games/dist
  COPY --chown=node:node --from=build /app/apps/server/package.json ./apps/server/
  COPY --chown=node:node --from=build /app/apps/server/node_modules ./apps/server/node_modules
  COPY --chown=node:node --from=build /app/apps/server/dist ./apps/server/dist
  COPY --chown=node:node --from=build /app/apps/server/drizzle ./apps/server/drizzle
  COPY --chown=node:node --from=build /app/apps/web/dist ./apps/web/dist

  USER node
  EXPOSE 8080
  CMD ["node", "apps/server/dist/index.js"]
  ```

---

#### SEC-05: Absence of Cryptographic Key Rotation Mechanism Permanently Bricks Stored Credentials
- **File(s) / Function(s)**:
  - `apps/server/src/ai/crypto.ts` (`KEY`, `encrypt()`, `decrypt()`, lines 4–30)
  - `apps/server/src/routes/rooms.ts` (`ensureGuest()`, lines 22–37)
  - `apps/server/src/auth.ts` (`betterAuth()`, line 18)
- **Why It Matters (Risk/Cost)**:
  - **`APP_ENCRYPTION_KEY`**: AES-256-GCM ciphertexts are stored as `iv:tag:ciphertext` without a key ID or version identifier. The key is instantiated once globally from `env.appEncryptionKey`. If the key is rotated in production, `decipher.final()` fails with an authentication tag verification error on all existing `ai_providers` rows. Stored credentials become unrecoverable, breaking AI game modes until re-entered manually.
  - **`COOKIE_SECRET`**: `@fastify/cookie` supports multi-secret verification (`secret: [newSecret, oldSecret]`), but the app only passes a single string from `env.cookieSecret`. When rotated, all existing player cookies fail verification. In `ensureGuest()`, invalid cookies result in newly generated `guestId`s, immediately dissociating players from their in-flight game rooms and scores.
  - **`ADMIN_SIGNUP_CODE`**: Stored as a single plain text environment variable with no revocation history, expiration timestamp, or tokenized invites.
- **Recommended Fix**:
  1. Add a key version prefix to encrypted payloads (e.g. `v1:iv:tag:ciphertext`). Maintain a keyring supporting previous decryption keys:
     ```ts
     const PRIMARY_KEY_ID = 'v1';
     const KEYRING = new Map<string, Buffer>([
       ['v1', Buffer.from(env.appEncryptionKey, 'base64')],
       // ['v0', Buffer.from(env.oldEncryptionKey, 'base64')],
     ]);
     ```
  2. Implement an automated CLI re-encryption script (`npm run db:rotate-encryption-key`).
  3. Allow `COOKIE_SECRET` to accept comma-separated keys (`process.env['COOKIE_SECRETS']?.split(',')`) so Fastify signs with the newest key while accepting signatures from the previous key during a rollover window.

---

### MEDIUM SEVERITY

---

#### OPS-02: Absence of CI/CD Pipeline and Web Typecheck Verification Gap
- **File(s) / Function(s)**:
  - Monorepo root (no `.github/` directory present)
  - `package.json` (lines 15, 17)
  - `tsconfig.json` (lines 1–10)
  - `apps/web/tsconfig.json` (lines 1–22)
  - `apps/web/package.json` (lines 6–10)
- **Why It Matters (Risk/Cost)**:
  1. **No Automated CI**: Without GitHub Actions or continuous integration, PRs and commits are not validated against builds, tests, or type checks prior to deployment.
  2. **Monorepo Typecheck Gap**: In root `package.json`, `"typecheck": "tsc -b"`. Root `tsconfig.json` references `shared`, `puzzles`, `games`, and `apps/server`, but **omits `apps/web`**. Furthermore, `apps/web/package.json` has no typecheck script, and Vite's build (`vite build`) transpile-strips TypeScript without semantic type checking.
  Consequently, broken types or invalid React props in `apps/web` pass both `npm run typecheck` and `npm run build` unnoticed, reaching production undetected.
- **Recommended Fix**:
  1. Add a dedicated typecheck script in `apps/web/package.json`: `"typecheck": "tsc --noEmit"`.
  2. Update root `package.json` `"typecheck"` to: `"typecheck": "tsc -b && npm run typecheck --workspace=apps/web"`.
  3. Create a GitHub Actions workflow (`.github/workflows/ci.yml`) that validates:
     - Dependency installation (`npm ci`)
     - Monorepo typechecking (`npm run typecheck`)
     - Unit tests (`vitest run packages/`)
     - Integration/E2E tests (`BOT_THINK_MS=0 vitest run apps/server/` against a Postgres service container)
     - Production SPA build (`npm run build`)
     - Docker image build verification (`docker build .`)

---

#### OPS-03: Shallow Health Check Masks Database Failures and Pool Exhaustion
- **File(s) / Function(s)**: `apps/server/src/index.ts` (line 97)
- **Why It Matters (Risk/Cost)**:
  The health check endpoint is implemented as:
  ```ts
  app.get('/api/health', async () => ({ ok: true, status: 'up' }));
  ```
  It returns a static 200 OK without verifying connectivity to Postgres or Socket.IO status.
  If the database crashes, credentials expire, or connection pool limits are reached, the container continues reporting `200 OK`. Upstream load balancers, orchestrators (Zeabur, Kubernetes, ECS), and ingress controllers will continue routing traffic to a completely non-functional instance.
  Additionally, `Dockerfile` contains no `HEALTHCHECK` instruction.
- **Recommended Fix**:
  Update `/api/health` to execute a lightweight database ping (`SELECT 1`) and report degraded/unhealthy status with HTTP 503 upon failure:
  ```ts
  app.get('/api/health', async (_req, reply) => {
    try {
      await sql`SELECT 1`;
      return { ok: true, status: 'healthy', timestamp: new Date().toISOString() };
    } catch (err) {
      reply.status(503);
      return { ok: false, status: 'unhealthy', error: 'Database unreachable' };
    }
  });
  ```
  Add `HEALTHCHECK` to `Dockerfile`:
  ```dockerfile
  HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1
  ```

---

#### OPS-04: Missing Graceful Shutdown Lifecycle Abruptly Drops In-Flight Games & DB Connections
- **File(s) / Function(s)**: `apps/server/src/index.ts` (lines 125–158)
- **Why It Matters (Risk/Cost)**:
  The server registers no handlers for `SIGTERM` or `SIGINT`.
  When a deployment platform (Zeabur, Docker, Kubernetes) terminates or redeploys a container, it sends `SIGTERM`. Because the process does not intercept the signal, Node terminates abruptly (or after orchestrator timeout):
  - In-flight WebSocket connections are dropped without notifying connected players (`room:closing` event).
  - Ongoing turn timers, bot schedulers, and clock intervals leak or terminate mid-execution.
  - In-memory game state that has not reached the 50-event snapshot mark (`room_snapshots`) is lost, requiring a full replay from `room_events` upon rehydration.
  - Active database client connections in the `postgres` driver pool are killed without proper teardown.
- **Recommended Fix**:
  Implement explicit termination handlers in `apps/server/src/index.ts`:
  ```ts
  async function gracefulShutdown(signal: string, app: FastifyInstance, io: IOServer) {
    logger.info({ signal }, 'shutdown signal received; closing gracefully');
    
    // 1. Stop accepting new HTTP/Socket connections
    io.emit('server:shutdown', { message: 'Server is updating. Reconnecting shortly...' });
    io.close();
    await app.close();

    // 2. Persist in-memory state snapshots for running rooms
    for (const room of rooms_registry.values()) {
      if (room.status === 'running') {
        await room.forceSnapshot();
      }
    }

    // 3. Drain and terminate Postgres connection pool
    await sql.end({ timeout: 5 });
    logger.info('shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', app, io));
  process.on('SIGINT', () => gracefulShutdown('SIGINT', app, io));
  ```

---

#### OPS-05: Disabled HTTP Request Logging Impairs Observability and Incident Response
- **File(s) / Function(s)**: `apps/server/src/index.ts` (line 28), `apps/server/src/logger.ts`
- **Why It Matters (Risk/Cost)**:
  `Fastify` is initialized with `{ logger: false, trustProxy: true }`.
  Standard Fastify access logging is completely silenced. Only a handful of auth routes manually log messages.
  In production, incoming HTTP requests, latencies, user-agent metadata, client IPs, and 4xx/5xx status codes are invisible in stdout logs. Investigating failed joins, malicious probes, rate-limit hits, or API error spikes becomes nearly impossible.
- **Recommended Fix**:
  Pass the configured Pino `logger` instance directly to the Fastify constructor, redacting sensitive fields (`authorization`, `cookie`, `apiKey`, `password`, `signupCode`):
  ```ts
  const app = Fastify({
    logger: logger.child({ module: 'http' }),
    trustProxy: true,
    disableRequestLogging: false,
  });
  ```

---

### LOW SEVERITY

---

#### SEC-06: Unbounded Socket.IO Inbound Event Rates (Spam/DoS Risk)
- **File(s) / Function(s)**: `apps/server/src/socket.ts` (`attachSocket()`, lines 87–400), `apps/server/src/index.ts` (lines 38–43)
- **Why It Matters (Risk/Cost)**:
  In `index.ts`, the `onRequest` hook bypasses Fastify rate limiting for all `/socket.io/*` paths.
  Inside `socket.ts`, listeners for `EV.chatSend`, `EV.puzzleCommit`, `EV.gameAction`, and `EV.roomJoin` have no per-socket throttling or token bucket rate limiters.
  A compromised or rogue client connected to a room can flood the server with thousands of game actions or chat messages per second. Because each game action and commit triggers state calculations, broadcast emissions, and writes to `room_events` in Postgres, a single user can exhaust server CPU and database connection bandwidth.
- **Recommended Fix**:
  Add an in-memory sliding window rate limiter middleware for Socket.IO events (e.g. limiting chat messages to 5/sec and game actions to 20/sec per socket ID).

---

#### OPS-06: Hardcoded Database Pool Configuration Without Lifecycle Limits
- **File(s) / Function(s)**: `apps/server/src/db/index.ts` (line 6)
- **Why It Matters (Risk/Cost)**:
  The database driver is initialized as:
  ```ts
  export const sql = postgres(env.databaseUrl, { max: 10 });
  ```
  The pool size (`max: 10`) is hardcoded without connection lifecycle limits (`idle_timeout`, `connect_timeout`, `max_lifetime`).
  In containerized environments where instances are frequently scaled or restarted, dangling connections can quickly saturate the target Postgres server's `max_connections` (especially on starter cloud databases where default limits are 20–50 connections).
- **Recommended Fix**:
  Expose pool parameters via environment variables and define standard connection timeouts:
  ```ts
  export const sql = postgres(env.databaseUrl, {
    max: Number(process.env['DB_POOL_MAX'] ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  });
  ```

---

## Architectural Deep-Dives

### 1. Secrets Handling & Rotation Lifecycle
The current secret model relies on four core values:
- `BETTER_AUTH_SECRET`: Used by Better Auth to hash session cookies and tokens.
- `COOKIE_SECRET`: Used by Fastify Cookie to sign the guest tracking cookie `pa_guest`.
- `APP_ENCRYPTION_KEY`: 32-byte base64 string for AES-256-GCM encryption of third-party AI keys stored in `ai_providers`.
- `ADMIN_SIGNUP_CODE`: Plain-text pre-shared key guarding `/api/admin/register`.

**Operational Risks Identified**:
- In `env.ts`, `dotenv.config()` is executed with `override: true`. In cloud environments (Zeabur, Docker, Kubernetes) where environment variables are injected at runtime, if a stale `.env` file is accidentally mounted or present in the working directory, it overwrites orchestrator variables.
- Rotating `APP_ENCRYPTION_KEY` renders all existing provider keys permanently corrupt unless manually updated.
- Rotating `COOKIE_SECRET` silently invalidates all active player identities, breaking ongoing multiplayer games.

### 2. Docker Image Build, Size & Runtime Security
- **Multi-Stage Structure**: The multi-stage layout in `Dockerfile` is conceptually clean (Stage 1 `build`, Stage 2 `runtime`).
- **Workspace Hoisting Gotcha**: Lines 47–49 of `Dockerfile` note:
  ```dockerfile
  # npm workspaces does not hoist everything — better-auth and nanoid resolve to
  # apps/server/node_modules, so the root node_modules alone is not enough.
  COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
  ```
  In npm workspaces, packages with differing version constraints or hoisting bugs can land in nested `node_modules`. Copying both `/app/node_modules` and `/app/apps/server/node_modules` is currently required, but creates brittle coupling. Any newly introduced unhoisted dependency in `packages/*` or `apps/*` will cause silent production runtime crashes.
- **Root Execution**: The runtime container executes as UID 0 (`root`), presenting an unnecessary container escape and privilege escalation risk.

### 3. Database Migration Safety & Concurrency
- In `apps/server/src/index.ts`, `migrate()` is invoked on boot before starting the listener.
- **Risk 1**: Migration failure is swallowed inside `try/catch`, allowing the server to listen on a broken schema.
- **Risk 2**: Drizzle's `migrate()` does not acquire a distributed advisory lock. If two containers boot concurrently (e.g. during auto-scaling or rolling deploy), concurrent DDL execution can result in deadlocks or migration failure.
- **Recommendation**: Wrap migrations in a transaction with an advisory lock:
  ```ts
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74839201)`;
    await migrate(drizzle(tx), { migrationsFolder: resolve(here, '../drizzle') });
  });
  ```

### 4. Horizontal Scaling Roadmap (Overcoming Single-Instance Limitations)
To transition from a single-instance architecture to horizontal clustering:
```
                [ Ingress / Load Balancer ]
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ Server Instance 1 ]             [ Server Instance 2 ]
   - Socket.IO Server                - Socket.IO Server
   - Local LiveRoom (Room A)         - Local LiveRoom (Room B)
            │                                 │
            └──────────────┬──────────────────┘
                           ▼
              [ Postgres Database (17) ]
              - Tables: rooms, room_events, room_snapshots
              - Pub/Sub: @socket.io/postgres-adapter (LISTEN/NOTIFY)
              - Locks: pg_advisory_lock(roomId) for room ownership
```

**Required Modifications**:
1. **Pub/Sub Transport**: Install `@socket.io/postgres-adapter` and register it with Socket.IO (`io.adapter(createAdapter(sql))`).
2. **Room Master Ownership**: Ensure that for each active room, exactly one server instance is the "Room Master" managing timers, game ticks, and bot actions. Utilize Postgres advisory locks (`pg_try_advisory_lock(hashtext(roomId))`) to elect the master node.
3. **Sequence Coordination**: Prevent duplicate `(room_id, seq)` errors by committing moves via transactional atomic increments in Postgres or routing all moves through the elected room master.
4. **Cross-Server Seat Locks**: Replace `roomJoinLocks` in `socket.ts` with row-level locks on the `rooms` table (`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`).

---

### 5. Recommended Minimal CI/CD Pipeline

To ensure quality gates and prevent deployment regressions, create `.github/workflows/ci.yml`:

```yaml
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: puzzlearena
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Typecheck Monorepo (Backend & Packages)
        run: npm run typecheck

      - name: Typecheck Frontend (Web SPA)
        run: npm run typecheck --workspace=apps/web

      - name: Run Unit Tests
        run: npx vitest run packages/

      - name: Run Database Migrations
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5433/puzzlearena
        run: npm run db:migrate

      - name: Run Integration & E2E Tests
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5433/puzzlearena
          BOT_THINK_MS: 0
          BETTER_AUTH_SECRET: test-ci-better-auth-secret
          COOKIE_SECRET: test-ci-cookie-secret
          APP_ENCRYPTION_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
          ADMIN_SIGNUP_CODE: ci-test-code
        run: npx vitest run apps/server/

      - name: Build Web Application
        run: npm run build --workspace=apps/web

      - name: Verify Docker Build
        run: docker build .
```

---

## Actionable Remediation Roadmap

### Phase 1: Immediate Security & Reliability Fixes (Day 1)
- [ ] **Enforce production environment variables**: Disallow fallbacks in `env.ts` when `NODE_ENV === 'production'`.
- [ ] **Fix `.dockerignore`**: Add `.env.*`, `*.png`, `screenshots/`, and test artifacts.
- [ ] **Halt on migration failure**: Replace the caught migration error in `apps/server/src/index.ts` with `process.exit(1)`.
- [ ] **Rate limit admin registration**: Apply `@fastify/rate-limit` to `/api/admin/register` and `/api/admin/sign-up/google`.
- [ ] **Run container as non-root**: Add `USER node` to `Dockerfile`.

### Phase 2: Operational Hardening (Week 1)
- [ ] **Implement CI pipeline**: Commit `.github/workflows/ci.yml`.
- [ ] **Close web typecheck gap**: Add `tsc --noEmit` to `apps/web/package.json` and include it in root `npm run typecheck`.
- [ ] **Deepen health check**: Query `SELECT 1` in `/api/health` and add `HEALTHCHECK` to `Dockerfile`.
- [ ] **Add graceful shutdown**: Handle `SIGTERM` / `SIGINT` to gracefully drain sockets and close the Postgres pool.
- [ ] **Enable structured HTTP logging**: Reconnect Pino to Fastify request/response events.

### Phase 3: Scaling & Long-Term Architecture (Post-Launch)
- [ ] **Implement cryptographic key versioning**: Prefix encrypted provider keys with `v1:` and create a key re-encryption utility.
- [ ] **Multi-secret cookie verification**: Support rolling cookie secrets in `ensureGuest`.
- [ ] **Horizontal scaling migration**: Transition Socket.IO to `@socket.io/postgres-adapter` and implement Postgres advisory locking for distributed `LiveRoom` ownership.
