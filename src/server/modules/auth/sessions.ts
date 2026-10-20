import crypto from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { sessions } from '../../db/schema';
import type { AuthUser, UsersService } from '../users/service';

export const SESSION_TTL_MS = 12 * 3600_000;
export const REMEMBER_TTL_MS = 30 * 24 * 3600_000;
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionsService {
  create(i: { userId: number; remember: boolean; ip: string | null; userAgent: string | null }): Promise<{
    id: number;
    token: string;
    expiresAt: Date;
  }>;
  touch(token: string): Promise<{
    id: number;
    user: AuthUser;
    renewed: { expiresAt: Date; remember: boolean } | null;
  } | null>;
  revoke(token: string): Promise<void>;
  revokeAllForUser(userId: number, exceptSessionId?: number): Promise<void>;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSessionsService(db: Db, users: UsersService, now: () => Date = () => new Date()): SessionsService {
  return {
    async create({ userId, remember, ip, userAgent }) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const expiresAt = new Date(t.getTime() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS));
      const [row] = await db
        .insert(sessions)
        .values({
          tokenHash: hashToken(token),
          userId,
          remember,
          createdAt: t.toISOString(),
          expiresAt: expiresAt.toISOString(),
          lastSeenAt: t.toISOString(),
          ip,
          userAgent: userAgent?.slice(0, 300) ?? null,
        })
        .returning({ id: sessions.id });
      return { id: row!.id, token, expiresAt };
    },

    async touch(token) {
      const row = await first(db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))));
      if (!row) return null;
      const t = now();
      if (new Date(row.expiresAt).getTime() <= t.getTime()) {
        await db.delete(sessions).where(eq(sessions.id, row.id));
        return null;
      }
      const user = await users.getActive(row.userId);
      if (!user) return null;
      let renewed: { expiresAt: Date; remember: boolean } | null = null;
      if (t.getTime() - new Date(row.lastSeenAt).getTime() >= TOUCH_INTERVAL_MS) {
        const ttl = row.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
        const expiresAt = new Date(t.getTime() + ttl);
        await db
          .update(sessions)
          .set({ lastSeenAt: t.toISOString(), expiresAt: expiresAt.toISOString() })
          .where(eq(sessions.id, row.id));
        renewed = { expiresAt, remember: row.remember };
      }
      return { id: row.id, user, renewed };
    },

    async revoke(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    },

    async revokeAllForUser(userId, exceptSessionId) {
      const cond =
        exceptSessionId === undefined
          ? eq(sessions.userId, userId)
          : and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId));
      await db.delete(sessions).where(cond);
    },
  };
}
