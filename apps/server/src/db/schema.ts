import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Better Auth core tables                                             */
/* Shapes follow Better Auth 1.6's documented core schema.             */
/* ------------------------------------------------------------------ */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified')
    .$defaultFn(() => false)
    .notNull(),
  image: text('image'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
});

/* ------------------------------------------------------------------ */
/* Application tables                                                  */
/* ------------------------------------------------------------------ */

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    gameId: text('game_id').notNull(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** lobby | running | finished | abandoned */
    status: text('status').notNull().default('lobby'),
    config: jsonb('config').notNull().default({}),
    timeLimitSec: integer('time_limit_sec').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // Codes are reusable once a room is over.
    uniqueIndex('rooms_active_code')
      .on(t.code)
      .where(sql`status in ('lobby','running')`),
    index('rooms_host_idx').on(t.hostUserId),
  ],
);

export const roomPlayers = pgTable(
  'room_players',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** The value inside the signed cookie. NULL for bots. */
    guestId: text('guest_id'),
    displayName: text('display_name').notNull(),
    seat: integer('seat').notNull(),
    isHost: boolean('is_host').notNull().default(false),
    isBot: boolean('is_bot').notNull().default(false),
    /** easy | normal | hard */
    botDifficulty: text('bot_difficulty'),
    avatar: text('avatar'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('room_players_guest')
      .on(t.roomId, t.guestId)
      .where(sql`guest_id is not null`),
    unique('room_players_seat').on(t.roomId, t.seat),
  ],
);

/** Append-only. The replay source for crash recovery. */
export const roomEvents = pgTable(
  'room_events',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    actorPlayerId: uuid('actor_player_id'),
    action: jsonb('action').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.seq] })],
);

/** Written every 50 events, so replay never starts from scratch. */
export const roomSnapshots = pgTable(
  'room_snapshots',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    state: jsonb('state').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.seq] })],
);

export const roomResults = pgTable(
  'room_results',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id').notNull(),
    rank: integer('rank').notNull(),
    score: integer('score').notNull(),
    progress: real('progress').notNull(),
    accuracy: real('accuracy').notNull(),
    speed: real('speed').notNull(),
    completed: boolean('completed').notNull(),
    completedAtMs: integer('completed_at_ms'),
    penalties: integer('penalties').notNull().default(0),
    detail: jsonb('detail'),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.playerId] })],
);

/** `solution` is NEVER serialised to a client before the room ends. */
export const puzzleInstances = pgTable('puzzle_instances', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  gameId: text('game_id').notNull(),
  difficulty: text('difficulty').notNull(),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  puzzle: jsonb('puzzle').notNull(),
  solution: jsonb('solution').notNull(),
  meta: jsonb('meta').notNull().default({}),
});

/* ------------------------------------------------------------------ */
/* AI provider configuration                                           */
/* ------------------------------------------------------------------ */

export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  /** AES-256-GCM, stored as iv:tag:ciphertext base64. Never returned over HTTP. */
  apiKeyEnc: text('api_key_enc').notNull(),
  model: text('model').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  temperature: real('temperature').notNull().default(0.8),
  maxTokens: integer('max_tokens').notNull().default(1024),
  // Reasoning models (MiniMax-M3 among them) spend tokens thinking before they
  // answer, so a word list can take well over 8s. 8s was the plan default and
  // it times out in practice.
  timeoutMs: integer('timeout_ms').notNull().default(30000),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiTaskProviders = pgTable('ai_task_providers', {
  task: text('task').primaryKey(),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => aiProviders.id, { onDelete: 'cascade' }),
});

export const aiContent = pgTable(
  'ai_content',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    task: text('task').notNull(),
    promptHash: text('prompt_hash').notNull(),
    payload: jsonb('payload').notNull(),
    providerId: uuid('provider_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('ai_content_key').on(t.task, t.promptHash)],
);
