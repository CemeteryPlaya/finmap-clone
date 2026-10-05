import crypto from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessions } from '../../db/schema';
import type { AuthUser, UsersService } from '../users/service';

export const SESSION_TTL_MS = 12 * 3600_000;
export const REMEMBER_TTL_MS = 30 * 24 * 3600_000;
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionsService {
  create(i: { userId: number; remember: boolean; ip: string | null; userAgent: string | null }): {
    id: number;
    token: string;
    expiresAt: Date;
  };
  touch(token: string): { id: number; user: AuthUser } | null;
  revoke(token: string): void;
  revokeAllForUser(userId: number, exceptSessionId?: number): void;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSessionsService(db: Db, users: UsersService, now: () => Date = () => new Date()): SessionsService {
  return {
    create({ userId, remember, ip, userAgent }) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const expiresAt = new Date(t.getTime() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS));
      const row = db
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
        .returning({ id: sessions.id })
        .get();
      return { id: row.id, token, expiresAt };
    },

    touch(token) {
      const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
      if (!row) return null;
      const t = now();
      if (new Date(row.expiresAt).getTime() <= t.getTime()) {
        db.delete(sessions).where(eq(sessions.id, row.id)).run();
        return null;
      }
      const user = users.getActive(row.userId);
      if (!user) return null;
      if (t.getTime() - new Date(row.lastSeenAt).getTime() >= TOUCH_INTERVAL_MS) {
        const ttl = row.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
        db.update(sessions)
          .set({ lastSeenAt: t.toISOString(), expiresAt: new Date(t.getTime() + ttl).toISOString() })
          .where(eq(sessions.id, row.id))
          .run();
      }
      return { id: row.id, user };
    },

    revoke(token) {
      db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    },

    revokeAllForUser(userId, exceptSessionId) {
      const cond =
        exceptSessionId === undefined
          ? eq(sessions.userId, userId)
          : and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId));
      db.delete(sessions).where(cond).run();
    },
  };
}
