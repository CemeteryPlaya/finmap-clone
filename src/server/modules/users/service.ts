import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import { MIN_PASSWORD } from '../../../shared/schemas/users';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { hashPassword, verifyPassword } from './passwords';

export { MIN_PASSWORD };

export interface AuthUser {
  id: number;
  login: string;
  name: string;
}

export interface UserRow extends AuthUser {
  createdAt: string;
  disabledAt: string | null;
}

export interface UsersService {
  create(input: { login: string; name: string; password: string }, actorId: number | null): Promise<AuthUser>;
  verifyCredentials(login: string, password: string): Promise<AuthUser | null>;
  getActive(id: number): AuthUser | null;
  count(): number;
  list(): UserRow[];
  get(id: number): UserRow | null;
  /** Имя, сброс пароля, отключение/включение. Сброс и отключение завершают все сессии пользователя. */
  update(id: number, input: { name?: string; password?: string; disabled?: boolean }, actorId: number): Promise<UserRow>;
  /** Смена своего пароля: проверка текущего; сессии, кроме keepSessionId, завершаются. */
  changeOwnPassword(id: number, currentPassword: string, newPassword: string, keepSessionId: number | null): Promise<void>;
  /** Сброс пароля из консоли (npm run user:passwd): все сессии пользователя завершаются. */
  setPasswordByLogin(login: string, password: string): Promise<UserRow>;
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

function toRow(r: typeof users.$inferSelect): UserRow {
  return { id: r.id, login: r.login, name: r.name, createdAt: r.createdAt, disabledAt: r.disabledAt };
}

export function createUsersService(db: Db, audit: AuditService, now: () => Date = () => new Date()): UsersService {
  let dummyHash: Promise<string> | null = null;
  const getDummy = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

  function requireUser(id: number): typeof users.$inferSelect {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден');
    return row;
  }

  const svc: UsersService = {
    async create(input, actorId) {
      const login = normalizeLogin(input.login);
      const name = cleanName(input.name);
      const fields: Record<string, string> = {};
      if (!LOGIN_RE.test(login)) fields.login = 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание';
      if (name.length < 1 || name.length > 100) fields.name = 'Имя: от 1 до 100 символов';
      if (input.password.length < MIN_PASSWORD) fields.password = `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
      if (Object.keys(fields).length) throw invalid(fields);

      // дорогой хэш — до проверки уникальности; проверка и вставка идут синхронно, без await между ними,
      // поэтому параллельный запрос с тем же логином не вклинится и не уронит вставку уникальным индексом
      const passwordHash = await hashPassword(input.password);
      return mutate(db, audit, (tx, record) => {
        const exists = tx.select({ id: users.id }).from(users).where(eq(users.login, login)).get();
        if (exists) throw invalid({ login: 'Логин уже занят' });
        const row = tx.insert(users).values({ login, name, passwordHash, createdAt: now().toISOString() }).returning({ id: users.id }).get();
        record({ userId: actorId, entity: 'user', entityId: row.id, action: 'create', diff: { login, name } });
        return { id: row.id, login, name };
      });
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

    list() {
      return db.select().from(users).orderBy(asc(users.id)).all().map(toRow);
    },

    get(id) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      return row ? toRow(row) : null;
    },

    async update(id, input, actorId) {
      requireUser(id); // 404 до дорогого хэша
      const name = input.name !== undefined ? cleanName(input.name) : undefined;
      const fields: Record<string, string> = {};
      if (name !== undefined && (name.length < 1 || name.length > 100)) fields.name = 'Имя: от 1 до 100 символов';
      if (input.password !== undefined) {
        if (id === actorId) fields.password = 'Свой пароль меняйте в профиле — нужен текущий пароль';
        else if (input.password.length < MIN_PASSWORD) fields.password = `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
      }
      if (Object.keys(fields).length) throw invalid(fields);
      if (input.disabled === true && id === actorId) throw new AppError(422, 'USER_LOCKOUT', 'Нельзя отключить самого себя');
      const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

      // состояние читаем и проверяем внутри транзакции, уже после await: два параллельных взаимных отключения
      // не оставят экземпляр без активных пользователей (тот же принцип, что у уникальности логина в create)
      return mutate(db, audit, (tx, record) => {
        const before = tx.select().from(users).where(eq(users.id, id)).get();
        if (!before) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден');
        const disable = input.disabled === true && before.disabledAt === null;
        const enable = input.disabled === false && before.disabledAt !== null;
        if (disable) {
          const active = tx.select({ n: count() }).from(users).where(isNull(users.disabledAt)).get()?.n ?? 0;
          if (active <= 1) throw new AppError(422, 'USER_LOCKOUT', 'Нельзя отключить последнего активного пользователя');
        }
        const set: Partial<typeof users.$inferInsert> = {};
        const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
        if (name !== undefined && name !== before.name) {
          set.name = name;
          diff.before.name = before.name;
          diff.after.name = name;
        }
        if (disable || enable) {
          set.disabledAt = disable ? now().toISOString() : null;
          diff.before.disabled = !disable;
          diff.after.disabled = disable;
        }
        if (passwordHash !== undefined) set.passwordHash = passwordHash;
        if (Object.keys(set).length === 0) return toRow(before); // ничего не меняется — без истории
        const row = tx.update(users).set(set).where(eq(users.id, id)).returning().get();
        if (passwordHash !== undefined || disable) tx.delete(sessions).where(eq(sessions.userId, id)).run();
        if (Object.keys(diff.after).length > 0) record({ userId: actorId, entity: 'user', entityId: id, action: 'update', diff });
        if (passwordHash !== undefined) record({ userId: actorId, entity: 'user', entityId: id, action: 'password_change', diff: { reset: true } });
        return toRow(row);
      });
    },

    async changeOwnPassword(id, currentPassword, newPassword, keepSessionId) {
      const row = requireUser(id);
      if (row.disabledAt) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден');
      if (!(await verifyPassword(row.passwordHash, currentPassword))) throw invalid({ currentPassword: 'Неверный текущий пароль' });
      if (newPassword.length < MIN_PASSWORD) throw invalid({ newPassword: `Пароль должен быть не короче ${MIN_PASSWORD} символов` });
      if (newPassword === currentPassword) throw invalid({ newPassword: 'Новый пароль совпадает с текущим' });
      const passwordHash = await hashPassword(newPassword);
      mutate(db, audit, (tx, record) => {
        // пока шёл хэш, администратор мог сбросить пароль или отключить пользователя — его решение не перезаписываем
        const fresh = tx.select({ passwordHash: users.passwordHash, disabledAt: users.disabledAt }).from(users).where(eq(users.id, id)).get();
        if (!fresh || fresh.disabledAt || fresh.passwordHash !== row.passwordHash) {
          throw new AppError(409, 'VERSION_CONFLICT', 'Пароль только что изменили — войдите заново и повторите');
        }
        tx.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
        tx.delete(sessions)
          .where(keepSessionId === null ? eq(sessions.userId, id) : and(eq(sessions.userId, id), ne(sessions.id, keepSessionId)))
          .run();
        record({ userId: id, entity: 'user', entityId: id, action: 'password_change' });
      });
    },

    async setPasswordByLogin(login, password) {
      if (password.length < MIN_PASSWORD) throw invalid({ password: `Пароль должен быть не короче ${MIN_PASSWORD} символов` });
      const row = db.select().from(users).where(eq(users.login, normalizeLogin(login))).get();
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден');
      const passwordHash = await hashPassword(password);
      mutate(db, audit, (tx, record) => {
        tx.update(users).set({ passwordHash }).where(eq(users.id, row.id)).run();
        tx.delete(sessions).where(eq(sessions.userId, row.id)).run();
        record({ userId: null, entity: 'user', entityId: row.id, action: 'password_change', diff: { reset: true, via: 'console' } });
      });
      return toRow(row); // disabledAt — чтобы скрипт предупредил: отключённый пользователь всё равно не войдёт
    },
  };
  return svc;
}
