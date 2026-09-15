import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isLeaderboardGameId } from '@puzzle-arena/shared';
import { db } from '../db/index.js';
import { gameLeaderboardEntries, user } from '../db/schema.js';

/**
 * Masks an email for public display: keeps the first character of the local
 * part and the full domain, replaces the rest of the local part with a fixed
 * run of asterisks. `j***@gmail.com` for `jsmith@gmail.com`.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function registerLeaderboardRoutes(app: FastifyInstance): void {
  /* -------- global cross-room high-score leaderboard (public) -------- */
  app.get('/api/leaderboard/:gameId', async (req, reply) => {
    const gameId = String((req.params as { gameId: string }).gameId);
    if (!isLeaderboardGameId(gameId)) {
      return reply.code(400).send({ error: 'Not a leaderboard game' });
    }

    const parsed = leaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid limit', detail: parsed.error.issues });
    }

    const rows = await db
      .select({
        displayName: gameLeaderboardEntries.displayName,
        email: user.email,
        score: gameLeaderboardEntries.score,
        playedAt: gameLeaderboardEntries.playedAt,
      })
      .from(gameLeaderboardEntries)
      .innerJoin(user, eq(gameLeaderboardEntries.userId, user.id))
      .where(eq(gameLeaderboardEntries.gameId, gameId))
      .orderBy(desc(gameLeaderboardEntries.score))
      .limit(parsed.data.limit);

    return reply.send({
      entries: rows.map((r, idx) => ({
        rank: idx + 1,
        displayName: r.displayName,
        email: maskEmail(r.email),
        score: r.score,
        playedAt: r.playedAt.toISOString(),
      })),
    });
  });
}
