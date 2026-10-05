import { count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { AppError } from '../../errors';
import type { AuditService } from '../audit/service';
import { hashPassword, verifyPassword } from './passwords';

export interface AuthUser {
  id: number;
  login: string;
  name: string;
}

export interface UsersService {
  create(input: { login: string; name: string; password: string }, actorId: number | null): Promise<AuthUser>;
  verifyCredentials(login: string, password: string): Promise<AuthUser | null>;
  getActive(id: number): AuthUser | null;
  count(): number;
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 10;

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function createUsersService(db: Db, audit: AuditService, now: () => Date = () => new Date()): UsersService {
  let dummyHash: Promise<string> | null = null;
  const getDummy = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

  return {
    async create(input, actorId) {
      const login = normalizeLogin(input.login);
      const name = input.name.trim();
      const fields: Record<string, string> = {};
      if (!LOGIN_RE.test(login)) fields.login = 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание';
      if (name.length < 1 || name.length > 100) fields.name = 'Имя: от 1 до 100 символов';
      if (input.password.length < MIN_PASSWORD) fields.password = `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
      if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

      const exists = db.select({ id: users.id }).from(users).where(eq(users.login, login)).get();
      if (exists) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { login: 'Логин уже занят' });

      const passwordHash = await hashPassword(input.password);
      const row = db
        .insert(users)
        .values({ login, name, passwordHash, createdAt: now().toISOString() })
        .returning({ id: users.id })
        .get();
      audit.record({ userId: actorId, entity: 'user', entityId: row.id, action: 'create', diff: { login, name } });
      return { id: row.id, login, name };
    },

    async verifyCredentials(login, password) {
      const row = db.select().from(users).where(eq(users.login, normalizeLogin(login))).get();
      if (!row) {
        await verifyPassword(await getDummy(), password);
        return null;
      }
      const ok = await verifyPassword(row.passwordHash, password);
      if (!ok || row.disabledAt) return null;
      return { id: row.id, login: row.login, name: row.name };
    },

    getActive(id) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row || row.disabledAt) return null;
      return { id: row.id, login: row.login, name: row.name };
    },

    count() {
      return db.select({ n: count() }).from(users).get()?.n ?? 0;
    },
  };
}
