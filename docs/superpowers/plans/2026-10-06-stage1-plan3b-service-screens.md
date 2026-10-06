# Этап 1, план 3b: служебные экраны — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина шага 3 §11 спецификации. Результат:
- «Пользователи»: список, добавление, сброс пароля, отключение. Сброс и отключение завершают сессии пользователя. Нельзя отключить себя и последнего активного пользователя.
- «Профиль»: смена имени и пароля; после смены пароля завершаются все остальные сессии.
- Скрипт `npm run user:passwd`.
- «История действий»: лента с фильтром по пользователю и сущности, просмотр изменений.
- «Резервная копия»: «Скачать сейчас» через `fetch` → Blob, дата последней автокопии, путь `BACKUP_COPY_DIR`.
- `user_preferences` API; в нём хранится последняя открытая компания.
- Доступный переключатель компаний: стрелки, возврат фокуса, видимое название входит в доступное имя, выбор текущей компании не уводит из настроек.
- Без мигания на экране «Новая компания».

**Предусловие:** план 3a выполнен. Этот план использует его модули:
- `mutate`, `changedFields`, `installZodRu`, `cleanName`, `nameField`;
- `tests/helpers/api.ts` (`createApi`);
- `Field`, `Pending`, `StaleNotice`, `ConfirmDelete`, `SettingsNav.SECTIONS`, классы `btnSmall`, `alertClass`, `noticeClass`.

**Architecture:**
- **Сервер.**
  - Новые маршруты в модулях `users` и `auth`: смена пароля с лимитом попыток.
  - Новые модули `audit` (маршруты) и `preferences`.
  - Сессии пользователя завершаются в той же транзакции, что и смена пароля или отключение.
- **Клиент.**
  - Новые экраны настроек, общая функция скачивания файла `downloadFile`.
  - Чистые функции с юнит-тестами: путь при смене компании, выбор стартовой компании, форматирование истории.

**Tech Stack:** как в планах 1–3a.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.2 (`users`, `sessions`, `user_preferences`), §4.5 (`audit_log`), §6 (Авторизация, Пользователи, Настройки пользователя, История, Бэкап), §6.2, §7 (Каркас, Настройки: Профиль, Пользователи, Резервная копия, История действий), §8, §9.2, §11 шаг 3.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Global Constraints

- **Пользователи** — общие для экземпляра (не привязаны к компании): «все видят всё», ролей нет. Любой вошедший может управлять пользователями.
- **Логин:** `^[a-z0-9._-]{3,32}$` после `trim` и перевода в нижний регистр, уникален.
- **Имя:** 1–100 символов после `cleanName`.
- **Пароль:** не короче 10 символов (`MIN_PASSWORD`), не длиннее 256. Хранится только argon2id-хэш.
- **Сброс пароля и отключение** пользователя завершают все его сессии в той же транзакции. Своё отключение → 422 `USER_LOCKOUT`. Отключение последнего активного пользователя → 422 `USER_LOCKOUT`.
- **Свой пароль** меняется только через `POST /auth/password` с текущим паролем. Сессия, из которой меняли пароль, остаётся, остальные завершаются. Проверка текущего пароля ограничена 5 неудачами за 15 минут на пользователя → 429 `RATE_LIMITED`.
- **История:**
  - `audit_log.diff` никогда не содержит паролей и хэшей (`sanitizeDiff`);
  - смена и сброс пароля пишутся действием `password_change` без значений;
  - события пользователей (`companyId = null`) видны в «Системе», события компании — в «Компании».
  - `limit` 1–200, по умолчанию 50.
- **`user_preferences`:** ключ `^[a-zA-Z][a-zA-Z0-9._-]{0,63}$`, значение — любой JSON до 8 КБ, не больше 50 ключей на пользователя. История не пишется: это состояние интерфейса.
- **Ошибки:** формат `{ error: { code, message, fields? } }`. Новый код `USER_LOCKOUT` (422) вносится в таблицу §6.2 спецификации в задаче 1.
- **Интерфейс:** тексты на русском, цвета через токены, `Field` для полей, данные раньше ошибки. Скачивание файла — только через `fetch` с `X-Requested-With: fetch`, простая ссылка не годится.
- **Безопасность хуков среды:** shell-команды не должны содержать подстроку «.env». Строку нельзя собирать из частей, чтобы обойти хук.
- **Завершение задачи.** Каждая задача заканчивается зелёными `npm test` и `npm run typecheck` и коммитом. Задачи с клиентским кодом (4–8) дополнительно проходят `npm run test:e2e`. Сообщение коммита завершается пустой строкой и трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Два администратора одновременно создают пользователя с одним логином.** Один получает 201, второй — 400 «Логин уже занят», а не 500 от уникального индекса. Сейчас между проверкой и вставкой стоит `await hashPassword`. Тест — в задаче 1.
2. **Сброс пароля или отключение пользователя, который сейчас работает в другом браузере.** Его следующий запрос получает 401, старый пароль не подходит. Тест — в задаче 1, e2e — в задаче 8.
3. **Смена своего пароля:** текущая вкладка продолжает работать, сессии на других устройствах завершены. Тест — в задаче 1.
4. **Подбор текущего пароля через `POST /auth/password`** из украденной сессии. После 5 неудач — 429, пароль не меняется. Тест — в задаче 1.
5. **Сохранённая последняя компания архивна или удалена.** Стартовый экран открывает первую активную компанию, без цикла перенаправлений. Тест — в задаче 7.

---

## Карта файлов

```
src/shared/schemas/users.ts                 # userCreateSchema, userUpdateSchema, passwordChangeSchema, MIN_PASSWORD (новый)
src/shared/dates.ts                          # + formatDateTime
src/server/modules/users/service.ts          # list, get, update, changeOwnPassword, setPasswordByLogin; атомарный create
src/server/modules/users/routes.ts           # GET/POST /users, PATCH /users/:id (новый)
src/server/modules/auth/routes.ts            # + POST /auth/password
src/server/modules/audit/service.ts          # list: фильтры userId/entity, userName
src/server/modules/audit/routes.ts           # GET /companies/:cid/audit, GET /audit/system (новый)
src/server/modules/preferences/{service,routes}.ts   # (новые)
src/server/app.ts                            # регистрация; /meta + timezone
scripts/user-passwd.ts, package.json         # npm run user:passwd
docs/superpowers/specs/…-design.md           # §6.2: USER_LOCKOUT
src/client/lib/api.ts                        # + downloadFile
src/client/lib/query.ts                      # useMeta: timezone
src/client/lib/queries.ts                    # AppUser, useUsers, usePreferences, savePreference, useAuditFeed, useBackupStatus
src/client/lib/company-path.ts               # switchCompanyPath, pickStartCompany (новый)
src/client/lib/audit-format.ts               # подписи, diffRows, formatBytes (новый)
src/client/components/AppHeader.tsx          # имя пользователя — ссылка на профиль
src/client/components/CompanySwitcher.tsx    # доступность (целиком)
src/client/pages/CompanyGate.tsx, CompanyLayout.tsx, NewCompanyPage.tsx
src/client/pages/settings/{UsersSettings,ProfileSettings,AuditSettings,BackupSettings}.tsx   # (новые)
src/client/pages/settings/SettingsNav.tsx, src/client/router.tsx
tests/server/users-api.test.ts, audit-api.test.ts, preferences.test.ts, users.test.ts, errors-and-health.test.ts
tests/client/company-path.test.ts, audit-format.test.ts, tests/shared/dates.test.ts
e2e/service-screens.spec.ts                  # (новый)
```

---

### Task 1: Пользователи и пароли — API, атомарное создание, завершение сессий, `user:passwd`

**Files:**
- Create: `src/shared/schemas/users.ts`, `src/server/modules/users/routes.ts`, `scripts/user-passwd.ts`, `tests/server/users-api.test.ts`
- Modify: `src/server/modules/users/service.ts` (целиком), `src/server/modules/auth/routes.ts`, `src/server/app.ts`, `package.json`, `tests/server/users.test.ts`, `docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md` (§6.2)

**Interfaces:**
- Consumes:
  - `mutate` (3a Task 2), `cleanName`, `nameField` (3a Task 1);
  - `LoginLimiter` (`tryBegin`, `end`);
  - `migrateWithBackup` (3a Task 2).
- Produces:
  - `MIN_PASSWORD = 10`, `userCreateSchema`, `userUpdateSchema`, `passwordChangeSchema`;
  - `UserRow { id; login; name; createdAt; disabledAt }`;
  - `UsersService` дополнительно:
    - `list(): UserRow[]`, `get(id): UserRow | null`;
    - `update(id, { name?, password?, disabled? }, actorId): Promise<UserRow>`;
    - `changeOwnPassword(id, current, next, keepSessionId): Promise<void>`;
    - `setPasswordByLogin(login, password): Promise<AuthUser>`;
  - маршруты:
    - `GET /api/v1/users` → `{ users }`;
    - `POST /api/v1/users` → 201 `{ user }`;
    - `PATCH /api/v1/users/:id` → `{ user }`;
    - `POST /api/v1/auth/password` → 204;
  - `npm run user:passwd [-- <логин>]`.

- [ ] **Step 1: Write the failing tests**

`tests/server/users-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';
import { loginAs, ORIGIN_HEADERS } from '../helpers/test-app';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const PASS = 'kassir-pass-1';

/** Запрос от имени другого пользователя (своя кука). */
const as = (cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload ? { payload } : {}) });

async function addKassir() {
  const res = await h.req('POST', '/api/v1/users', { login: 'Kassir', name: 'Кассир', password: PASS });
  expect(res.statusCode).toBe(201);
  return res.json().user as { id: number; login: string };
}

describe('users API', () => {
  it('список и создание; дубль логина — ошибка поля; пароль не попадает в историю', async () => {
    h = await createApi();
    const user = await addKassir();
    expect(user).toMatchObject({ login: 'kassir', disabledAt: null });
    expect(user).not.toHaveProperty('passwordHash');
    const list = (await h.req('GET', '/api/v1/users')).json().users as { login: string }[];
    expect(list.map((u) => u.login)).toEqual(['admin', 'kassir']);
    const dup = await h.req('POST', '/api/v1/users', { login: 'KASSIR', name: 'Д', password: PASS });
    expect(dup.json().error.fields.login).toBe('Логин уже занят');
    const diffs = h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'user'").all() as { diff: string | null }[];
    expect(diffs.some((d) => d.diff?.includes(PASS))).toBe(false);
  });

  it('сброс пароля другому пользователю завершает его сессии (Review Focus 2)', async () => {
    h = await createApi();
    const k = await addKassir();
    const kassir = await loginAs(h.t, 'kassir', PASS);
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(200);
    const res = await h.req('PATCH', `/api/v1/users/${k.id}`, { password: 'new-kassir-pass' });
    expect(res.statusCode).toBe(200);
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'kassir', PASS)).rejects.toThrow();
    await loginAs(h.t, 'kassir', 'new-kassir-pass');
    expect(h.auditCount('user', 'password_change')).toBe(1);
  });

  it('свой пароль через PATCH /users/:id нельзя — только в профиле', async () => {
    h = await createApi();
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user as { id: number };
    const res = await h.req('PATCH', `/api/v1/users/${me.id}`, { password: 'another-pass-1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.password).toBe('Свой пароль меняйте в профиле — нужен текущий пароль');
  });

  it('отключение: сессии завершены, вход запрещён; себя отключить нельзя; включение возвращает вход', async () => {
    h = await createApi();
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user as { id: number };
    const k = await addKassir();
    const kassir = await loginAs(h.t, 'kassir', PASS);
    const off = await h.req('PATCH', `/api/v1/users/${k.id}`, { disabled: true });
    expect(off.json().user.disabledAt).not.toBeNull();
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'kassir', PASS)).rejects.toThrow();

    const self = await h.req('PATCH', `/api/v1/users/${me.id}`, { disabled: true });
    expect(self.statusCode).toBe(422);
    expect(self.json().error).toMatchObject({ code: 'USER_LOCKOUT', message: 'Нельзя отключить самого себя' });

    expect((await h.req('PATCH', `/api/v1/users/${k.id}`, { disabled: false })).json().user.disabledAt).toBeNull();
    await loginAs(h.t, 'kassir', PASS);
  });

  it('переименование; PATCH без изменений не пишет историю', async () => {
    h = await createApi();
    const k = await addKassir();
    expect((await h.req('PATCH', `/api/v1/users/${k.id}`, { name: ' Старший\u200B кассир ' })).json().user.name).toBe('Старший кассир');
    await h.req('PATCH', `/api/v1/users/${k.id}`, { name: 'Старший кассир', disabled: false });
    expect(h.auditCount('user', 'update')).toBe(1);
    expect((await h.req('PATCH', '/api/v1/users/999', { name: 'X' })).statusCode).toBe(404);
  });

  it('смена своего пароля: текущая сессия жива, остальные завершены (Review Focus 3)', async () => {
    h = await createApi();
    const other = await loginAs(h.t); // тот же admin на другом устройстве
    const wrong = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'brand-new-pass-1' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPassword).toBe('Неверный текущий пароль');
    const short = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'short' });
    expect(short.json().error.fields.newPassword).toBe('Пароль должен быть не короче 10 символов');

    const ok = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'brand-new-pass-1' });
    expect(ok.statusCode).toBe(204);
    expect((await h.req('GET', '/api/v1/auth/me')).statusCode).toBe(200);
    expect((await as(other, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'admin', 'correct-horse-1')).rejects.toThrow();
    await loginAs(h.t, 'admin', 'brand-new-pass-1');
    expect(h.auditCount('user', 'password_change')).toBe(1);
  });

  it('подбор текущего пароля ограничен: 6-я попытка — 429 (Review Focus 4)', async () => {
    h = await createApi();
    for (let i = 0; i < 5; i++) {
      expect((await h.req('POST', '/api/v1/auth/password', { currentPassword: `wrong-${i}-xxxxx`, newPassword: 'brand-new-pass-1' })).statusCode).toBe(400);
    }
    const blocked = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'brand-new-pass-1' });
    expect(blocked.statusCode).toBe(429);
    await loginAs(h.t, 'admin', 'correct-horse-1'); // пароль не сменился
  });
});
```

`tests/server/users.test.ts` — в конец `describe('users', …)`:

```ts
  it('одновременное создание одного логина: один успех, второй — ошибка поля, а не 500 (Review Focus 1)', async () => {
    const { svc } = setup();
    const results = await Promise.allSettled([
      svc.create({ login: 'twin', name: 'А', password: 'correct-horse-1' }, null),
      svc.create({ login: 'TWIN', name: 'Б', password: 'correct-horse-1' }, null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 400, fields: { login: 'Логин уже занят' } });
  });

  it('нельзя отключить последнего активного пользователя', async () => {
    const { svc } = setup();
    const a = await svc.create({ login: 'alpha', name: 'А', password: 'correct-horse-1' }, null);
    const b = await svc.create({ login: 'beta', name: 'Б', password: 'correct-horse-1' }, null);
    await svc.update(b.id, { disabled: true }, a.id);
    // действие из консоли или от несуществующего актора: a — последний активный
    await expect(svc.update(a.id, { disabled: true }, 999)).rejects.toMatchObject({
      status: 422,
      code: 'USER_LOCKOUT',
      message: 'Нельзя отключить последнего активного пользователя',
    });
  });

  it('setPasswordByLogin (user:passwd): новый пароль, все сессии пользователя завершены', async () => {
    const { svc } = setup();
    const u = await svc.create({ login: 'admin', name: 'А', password: 'correct-horse-1' }, null);
    t.sqlite
      .prepare("INSERT INTO sessions (token_hash, user_id, remember, created_at, expires_at, last_seen_at) VALUES ('h', ?, 0, 'x', 'x', 'x')")
      .run(u.id);
    await svc.setPasswordByLogin(' ADMIN ', 'console-pass-1');
    expect(await svc.verifyCredentials('admin', 'console-pass-1')).toMatchObject({ id: u.id });
    expect((t.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(0);
    await expect(svc.setPasswordByLogin('nobody', 'console-pass-1')).rejects.toMatchObject({ status: 404 });
    await expect(svc.setPasswordByLogin('admin', 'short')).rejects.toMatchObject({ status: 400 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/users-api.test.ts tests/server/users.test.ts`
Expected: FAIL — маршрутов `/users` и `/auth/password` нет; параллельное создание даёт `SqliteError: UNIQUE`.

- [ ] **Step 3: Implement**

`src/shared/schemas/users.ts`:

```ts
import { z } from 'zod';
import { nameField } from '../text';

export const MIN_PASSWORD = 10;

const password = z.string().min(MIN_PASSWORD, `Пароль должен быть не короче ${MIN_PASSWORD} символов`).max(256, 'Не длиннее 256 символов');

export const userCreateSchema = z.object({
  login: z.string().trim().min(1, 'Введите логин').max(64, 'Не длиннее 64 символов'),
  name: nameField(100, 'Введите имя'),
  password,
});

export const userUpdateSchema = z.object({
  name: nameField(100, 'Введите имя').optional(),
  /** Сброс пароля другому пользователю. */
  password: password.optional(),
  disabled: z.boolean().optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль').max(256),
  newPassword: password,
});
```

`src/server/modules/users/service.ts` целиком:

```ts
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
  setPasswordByLogin(login: string, password: string): Promise<AuthUser>;
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
      const before = requireUser(id);
      const name = input.name !== undefined ? cleanName(input.name) : undefined;
      const fields: Record<string, string> = {};
      if (name !== undefined && (name.length < 1 || name.length > 100)) fields.name = 'Имя: от 1 до 100 символов';
      if (input.password !== undefined) {
        if (id === actorId) fields.password = 'Свой пароль меняйте в профиле — нужен текущий пароль';
        else if (input.password.length < MIN_PASSWORD) fields.password = `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
      }
      if (Object.keys(fields).length) throw invalid(fields);
      const disable = input.disabled === true && before.disabledAt === null;
      const enable = input.disabled === false && before.disabledAt !== null;
      if (disable) {
        if (id === actorId) throw new AppError(422, 'USER_LOCKOUT', 'Нельзя отключить самого себя');
        const active = db.select({ n: count() }).from(users).where(isNull(users.disabledAt)).get()?.n ?? 0;
        if (active <= 1) throw new AppError(422, 'USER_LOCKOUT', 'Нельзя отключить последнего активного пользователя');
      }
      const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

      return mutate(db, audit, (tx, record) => {
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
      return { id: row.id, login: row.login, name: row.name };
    },
  };
  return svc;
}
```

`src/server/modules/users/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { userCreateSchema, userUpdateSchema } from '../../../shared/schemas/users';
import { parseId } from '../../http/params';
import type { UsersService } from './service';

export function registerUsersRoutes(app: FastifyInstance, deps: { users: UsersService }): void {
  const { users } = deps;

  app.get('/api/v1/users', async () => ({ users: users.list() }));

  app.post('/api/v1/users', async (req, reply) => {
    const body = userCreateSchema.parse(req.body);
    const created = await users.create(body, req.user!.id);
    return reply.status(201).send({ user: users.get(created.id) });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/users/:id', async (req) => {
    const id = parseId(req.params.id);
    const body = userUpdateSchema.parse(req.body);
    return { user: await users.update(id, body, req.user!.id) };
  });
}
```

`src/server/modules/auth/routes.ts` — импорт схемы и маршрут после `GET /api/v1/auth/me`:

```ts
import { passwordChangeSchema } from '../../../shared/schemas/users';
```

```ts
  app.post('/api/v1/auth/password', async (req, reply) => {
    const body = passwordChangeSchema.parse(req.body);
    const user = req.user!;
    // подбор текущего пароля из чужой (украденной) сессии: тот же лимит, что у входа
    const keys = [`password:${user.id}`];
    if (!deps.limiter.tryBegin(keys)) {
      throw new AppError(429, 'RATE_LIMITED', 'Слишком много попыток. Повторите через 15 минут');
    }
    let failed = false;
    try {
      await deps.users.changeOwnPassword(user.id, body.currentPassword, body.newPassword, req.sessionId);
    } catch (e) {
      failed = e instanceof AppError && e.fields?.currentPassword !== undefined;
      throw e;
    } finally {
      deps.limiter.end(keys, failed);
    }
    return reply.status(204).send();
  });
```

`src/server/app.ts` — импорт и регистрация после `registerAuthRoutes(…)`:

```ts
import { registerUsersRoutes } from './modules/users/routes';
```

```ts
  registerUsersRoutes(app, { users });
```

`scripts/user-passwd.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createBackupService } from '../src/server/modules/backup/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';

// Сброс пароля из консоли, когда войти в интерфейс некому: npm run user:passwd [-- <логин>]
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
fs.mkdirSync(config.backupsDir, { recursive: true });
migrateWithBackup({
  db,
  sqlite,
  dbExisted,
  backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
});
const users = createUsersService(db, createAuditService(db));
const prompt = createPrompt();

try {
  const login = process.argv[2] ?? (await prompt.ask('Логин'));
  const password = await prompt.askSecret('Новый пароль (не короче 10 символов)');
  const again = await prompt.askSecret('Повторите пароль');
  if (password !== again) throw new Error('Пароли не совпадают');
  const u = await users.setPasswordByLogin(login, password);
  console.log(`Пароль пользователя «${u.login}» изменён, все его сеансы завершены.`);
} catch (e) {
  if (e instanceof AppError && e.fields) console.error(Object.values(e.fields).join('\n'));
  else console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  prompt.close();
  sqlite.close();
}
```

`package.json` — в `scripts` после `user:add`:

```json
    "user:passwd": "tsx scripts/user-passwd.ts",
```

Спецификация §6.2 — строка 422 таблицы ошибок. Допишите в конец перечня кодов этой строки (перед закрывающей `|`):

```
; `USER_LOCKOUT` (нельзя отключить себя или последнего активного пользователя)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/users-api.test.ts tests/server/users.test.ts tests/server/auth-routes.test.ts tests/server/sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/users.ts src/server/modules/users src/server/modules/auth/routes.ts src/server/app.ts scripts/user-passwd.ts package.json tests/server/users-api.test.ts tests/server/users.test.ts docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md
git commit -m "feat: API пользователей и смены пароля — завершение сессий, атомарный логин, user:passwd

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: API истории действий и часовой пояс в `/meta`

**Files:**
- Create: `src/server/modules/audit/routes.ts`, `tests/server/audit-api.test.ts`
- Modify: `src/server/modules/audit/service.ts` (`AuditRow`, `list`), `src/server/app.ts`, `tests/server/errors-and-health.test.ts`

**Interfaces:**
- Consumes: `CompaniesService.require` (план 2), `createApi` (3a).
- Produces:
  - `AuditRow.userName: string | null`;
  - `AuditService.list({ companyId, limit?, beforeId?, userId?, entity? })`;
  - маршруты:
    - `GET /api/v1/companies/:cid/audit?limit&beforeId&userId&entity` → `{ entries, nextBeforeId }`;
    - `GET /api/v1/audit/system?…` — то же для событий без компании;
  - `GET /api/v1/meta` → `{ appName, timezone }`.

- [ ] **Step 1: Write the failing tests**

`tests/server/audit-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

interface Entry {
  id: number;
  entity: string;
  action: string;
  userName: string | null;
  diff: Record<string, unknown> | null;
}

describe('audit API', () => {
  it('лента компании: новые сверху, имя пользователя, фильтры по сущности и пользователю, страницы', async () => {
    h = await createApi();
    const cid = await h.company('ТОО');
    await h.req('POST', `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT' });
    await h.req('POST', `/api/v1/companies/${cid}/tags`, { name: 'Аренда' });
    const all = (await h.req('GET', `/api/v1/companies/${cid}/audit`)).json() as { entries: Entry[]; nextBeforeId: number | null };
    expect(all.entries.map((e) => e.entity)).toEqual(['tag', 'account', 'company']);
    expect(all.entries[0]).toMatchObject({ action: 'create', userName: 'Тест', diff: { name: 'Аренда' } });
    expect(all.nextBeforeId).toBeNull();

    const accounts = (await h.req('GET', `/api/v1/companies/${cid}/audit?entity=account`)).json().entries as Entry[];
    expect(accounts.map((e) => e.entity)).toEqual(['account']);
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user.id as number;
    expect((await h.req('GET', `/api/v1/companies/${cid}/audit?userId=${me}`)).json().entries).toHaveLength(3);
    expect((await h.req('GET', `/api/v1/companies/${cid}/audit?userId=999`)).json().entries).toHaveLength(0);

    const page1 = (await h.req('GET', `/api/v1/companies/${cid}/audit?limit=2`)).json() as { entries: Entry[]; nextBeforeId: number };
    expect(page1.entries).toHaveLength(2);
    const page2 = (await h.req('GET', `/api/v1/companies/${cid}/audit?limit=2&beforeId=${page1.nextBeforeId}`)).json().entries as Entry[];
    expect(page2.map((e) => e.entity)).toEqual(['company']);
  });

  it('чужая компания не видна; неизвестная — 404; кривой limit — 400', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    await h.req('POST', `/api/v1/companies/${c2}/tags`, { name: 'Чужой' });
    const own = (await h.req('GET', `/api/v1/companies/${c1}/audit`)).json().entries as Entry[];
    expect(own.every((e) => e.entity === 'company')).toBe(true);
    expect((await h.req('GET', '/api/v1/companies/999/audit')).statusCode).toBe(404);
    for (const bad of ['0', '201', 'abc']) {
      expect((await h.req('GET', `/api/v1/companies/${c1}/audit?limit=${bad}`)).statusCode).toBe(400);
    }
    expect((await h.req('GET', `/api/v1/companies/${c1}/audit?entity=DROP%20TABLE`)).statusCode).toBe(400);
  });

  it('системная лента: входы и пользователи, без событий компаний; паролей в diff нет', async () => {
    h = await createApi();
    await h.company();
    await h.req('POST', '/api/v1/users', { login: 'kassir', name: 'Кассир', password: 'kassir-pass-1' });
    const sys = (await h.req('GET', '/api/v1/audit/system')).json().entries as Entry[];
    expect(sys.map((e) => `${e.entity}:${e.action}`)).toEqual(['user:create', 'user:login', 'user:create']);
    expect(JSON.stringify(sys)).not.toContain('kassir-pass-1');
    expect((await h.req('GET', '/api/v1/audit/system?entity=company')).json().entries).toEqual([]);
  });
});
```

`tests/server/errors-and-health.test.ts` — ожидание `/meta`:

```ts
    expect(res.json()).toEqual({ appName: 'Клубный учёт', timezone: 'Asia/Almaty' });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/audit-api.test.ts tests/server/errors-and-health.test.ts`
Expected: FAIL — маршрутов нет, `/meta` без `timezone`.

- [ ] **Step 3: Implement**

`src/server/modules/audit/service.ts` — импорт таблицы пользователей, `AuditRow` и `list`:

```ts
import { auditLog, users } from '../../db/schema';
```

```ts
export interface AuditRow {
  id: number;
  companyId: number | null;
  userId: number | null;
  /** Имя пользователя на момент чтения; null — системное событие или пользователь удалён. */
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  diff: Record<string, unknown> | null;
  at: string;
}

export interface AuditService {
  /** ex — транзакция изменения: запись истории откатится вместе с ним. */
  record(entry: AuditEntry, ex?: Executor): void;
  list(q: { companyId: number | null; limit?: number; beforeId?: number; userId?: number; entity?: string }): AuditRow[];
}
```

```ts
    list({ companyId, limit = 50, beforeId, userId, entity }) {
      const conds: SQL[] = [companyId === null ? isNull(auditLog.companyId) : eq(auditLog.companyId, companyId)];
      if (beforeId !== undefined) conds.push(lt(auditLog.id, beforeId));
      if (userId !== undefined) conds.push(eq(auditLog.userId, userId));
      if (entity !== undefined) conds.push(eq(auditLog.entity, entity));
      return db
        .select({ a: auditLog, userName: users.name })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit(Math.min(Math.max(limit, 1), 200))
        .all()
        .map(({ a, userName }) => ({
          ...a,
          userName: userName ?? null,
          action: a.action as AuditAction,
          diff: a.diff ? (JSON.parse(a.diff) as Record<string, unknown>) : null,
        }));
    },
```

`src/server/modules/audit/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { AuditService } from './service';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1, 'От 1 до 200').max(200, 'От 1 до 200').default(50),
  beforeId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  entity: z.string().regex(/^[a-z_]{1,40}$/, 'Неизвестная сущность').optional(),
});

export function registerAuditRoutes(app: FastifyInstance, deps: { audit: AuditService; companies: CompaniesService }): void {
  const page = (companyId: number | null, raw: unknown) => {
    const q = auditQuery.parse(raw);
    const entries = deps.audit.list({ companyId, ...q });
    const last = entries.at(-1);
    return { entries, nextBeforeId: entries.length === q.limit && last ? last.id : null };
  };

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/audit', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return page(cid, req.query);
  });

  app.get('/api/v1/audit/system', async (req) => page(null, req.query));
}
```

`src/server/app.ts` — `/meta` и регистрация истории после `registerCompaniesRoutes(app, { companies });`:

```ts
import { registerAuditRoutes } from './modules/audit/routes';
```

```ts
  app.get('/api/v1/meta', async () => ({ appName: config.appName, timezone: config.timezone }));
```

```ts
  registerAuditRoutes(app, { audit, companies });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/audit-api.test.ts tests/server/audit.test.ts tests/server/errors-and-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/audit src/server/app.ts tests/server/audit-api.test.ts tests/server/errors-and-health.test.ts
git commit -m "feat: API истории действий — лента компании и системная, фильтры, страницы; часовой пояс в /meta

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: API настроек пользователя (`user_preferences`)

**Files:**
- Create: `src/server/modules/preferences/service.ts`, `src/server/modules/preferences/routes.ts`, `tests/server/preferences.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: таблица `userPreferences` (3a Task 3).
- Produces:
  - `PreferencesService { all(userId): Record<string, unknown>; set(userId, key, value): void }`;
  - `GET /api/v1/preferences` → `{ preferences }`;
  - `PUT /api/v1/preferences/:key` с телом `{ value }` → `{ key, value }`.

- [ ] **Step 1: Write the failing test**

`tests/server/preferences.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';
import { loginAs, ORIGIN_HEADERS } from '../helpers/test-app';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('preferences API', () => {
  it('сохраняет любые JSON-значения и перезаписывает их; у каждого пользователя свои', async () => {
    h = await createApi();
    for (const [key, value] of [
      ['lastCompanyId', 7],
      ['journal.columns', ['date', 'amount']],
      ['sidebar', { collapsed: true }],
      ['empty', null],
    ] as const) {
      const res = await h.req('PUT', `/api/v1/preferences/${key}`, { value });
      expect(res.json()).toEqual({ key, value });
    }
    await h.req('PUT', '/api/v1/preferences/lastCompanyId', { value: 8 });
    expect((await h.req('GET', '/api/v1/preferences')).json().preferences).toEqual({
      lastCompanyId: 8,
      'journal.columns': ['date', 'amount'],
      sidebar: { collapsed: true },
      empty: null,
    });

    await h.req('POST', '/api/v1/users', { login: 'kassir', name: 'Кассир', password: 'kassir-pass-1' });
    const other = await loginAs(h.t, 'kassir', 'kassir-pass-1');
    const res = await h.t.app.inject({ method: 'GET', url: '/api/v1/preferences', headers: { ...ORIGIN_HEADERS, cookie: other } });
    expect(res.json().preferences).toEqual({});
  });

  it('проверки: ключ, отсутствующее и слишком большое значение, лимит числа ключей; история не пишется', async () => {
    h = await createApi();
    expect((await h.req('PUT', '/api/v1/preferences/1bad', { value: 1 })).json().error.fields.key).toBe('Недопустимый ключ');
    expect((await h.req('PUT', '/api/v1/preferences/ok', {})).json().error.fields.value).toBe('Укажите значение');
    const big = await h.req('PUT', '/api/v1/preferences/big', { value: 'x'.repeat(9000) });
    expect(big.json().error.fields.value).toBe('Слишком большое значение');
    for (let i = 0; i < 50; i++) await h.req('PUT', `/api/v1/preferences/k${i}`, { value: i });
    const over = await h.req('PUT', '/api/v1/preferences/k50', { value: 1 });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.fields.key).toBe('Слишком много настроек');
    expect((await h.req('PUT', '/api/v1/preferences/k0', { value: 'обновление' })).statusCode).toBe(200); // существующий ключ можно
    expect(h.auditCount('preference')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/preferences.test.ts`
Expected: FAIL — маршрутов нет.

- [ ] **Step 3: Implement**

`src/server/modules/preferences/service.ts`:

```ts
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { userPreferences } from '../../db/schema';
import { AppError } from '../../errors';

export const PREF_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
export const PREF_VALUE_MAX = 8 * 1024;
export const PREF_KEYS_MAX = 50;

/** Настройки интерфейса пользователя (§4.2): видимые колонки, свёрнутая панель, последняя компания. Историю не пишут. */
export interface PreferencesService {
  all(userId: number): Record<string, unknown>;
  set(userId: number, key: string, value: unknown): void;
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

export function createPreferencesService(db: Db, now: () => Date = () => new Date()): PreferencesService {
  return {
    all(userId) {
      const rows = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all();
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    },

    set(userId, key, value) {
      if (!PREF_KEY_RE.test(key)) throw invalid({ key: 'Недопустимый ключ' });
      const json = JSON.stringify(value);
      if (json.length > PREF_VALUE_MAX) throw invalid({ value: 'Слишком большое значение' });
      db.transaction((tx) => {
        const exists = tx
          .select({ id: userPreferences.id })
          .from(userPreferences)
          .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
          .get();
        if (!exists) {
          const n = tx.select({ n: count() }).from(userPreferences).where(eq(userPreferences.userId, userId)).get()?.n ?? 0;
          if (n >= PREF_KEYS_MAX) throw invalid({ key: 'Слишком много настроек' });
        }
        tx.insert(userPreferences)
          .values({ userId, key, value: json, updatedAt: now().toISOString() })
          .onConflictDoUpdate({ target: [userPreferences.userId, userPreferences.key], set: { value: json, updatedAt: now().toISOString() } })
          .run();
      });
    },
  };
}
```

`src/server/modules/preferences/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { PreferencesService } from './service';

/** Значение — любой JSON, включая null; отсутствие поля value — ошибка. */
function readValue(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('value' in body) || body.value === undefined) {
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { value: 'Укажите значение' });
  }
  return body.value;
}

export function registerPreferencesRoutes(app: FastifyInstance, deps: { preferences: PreferencesService }): void {
  app.get('/api/v1/preferences', async (req) => ({ preferences: deps.preferences.all(req.user!.id) }));

  app.put<{ Params: { key: string } }>('/api/v1/preferences/:key', async (req) => {
    const value = readValue(req.body);
    deps.preferences.set(req.user!.id, req.params.key, value);
    return { key: req.params.key, value };
  });
}
```

`src/server/app.ts` — импорты и регистрация после `registerUsersRoutes(app, { users });`:

```ts
import { registerPreferencesRoutes } from './modules/preferences/routes';
import { createPreferencesService } from './modules/preferences/service';
```

```ts
  registerPreferencesRoutes(app, { preferences: createPreferencesService(db, now) });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/preferences src/server/app.ts tests/server/preferences.test.ts
git commit -m "feat: API настроек пользователя — JSON-значения по ключу, лимиты, без истории

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Экраны «Пользователи» и «Профиль», имя в шапке — ссылка на профиль

**Files:**
- Create: `src/client/pages/settings/UsersSettings.tsx`, `src/client/pages/settings/ProfileSettings.tsx`
- Modify: `src/client/lib/queries.ts`, `src/client/components/AppHeader.tsx`, `src/client/pages/CompanyLayout.tsx`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - `GET/POST /users`, `PATCH /users/:id`, `POST /auth/password` (Task 1);
  - `useMe` (план 1), `Field`, `Pending`, `StaleNotice`, `btnSmall` (3a).
- Produces:
  - `AppUser`, `useUsers()` с ключом `['users']`;
  - `AppHeader({ left?, profileHref? })`;
  - маршруты `/c/:companyId/settings/users` и `/c/:companyId/settings/profile`.

- [ ] **Step 1: Implement**

Экраны вызывают API, покрытый тестами задачи 1. Поведение экранов проверяет e2e задачи 8.

`src/client/lib/queries.ts` — допишите:

```ts
export interface AppUser {
  id: number;
  login: string;
  name: string;
  createdAt: string;
  disabledAt: string | null;
}

export function useUsers() {
  return useQuery<AppUser[], ApiError>({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: AppUser[] }>('/users')).users,
  });
}
```

`src/client/components/AppHeader.tsx` — импорт `Link` и имя пользователя как ссылка на профиль:

```tsx
import { Link, useNavigate } from 'react-router';
```

```tsx
export function AppHeader({ left, profileHref }: { left?: ReactNode; profileHref?: string }) {
```

```tsx
        {profileHref ? (
          <Link to={profileHref} className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
            {me.data?.user.name}
          </Link>
        ) : (
          <span className="text-sm text-white/70">{me.data?.user.name}</span>
        )}
```

(вместо прежней строки `<span className="text-sm text-white/70">{me.data?.user.name}</span>`).

`src/client/pages/CompanyLayout.tsx` — шапка с профилем:

```tsx
      <AppHeader
        left={<CompanySwitcher current={company} companies={companies.data} />}
        profileHref={`/c/${company.id}/settings/profile`}
      />
```

`src/client/pages/settings/UsersSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe } from '../../lib/query';
import { useUsers, type AppUser } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

const badge = 'ml-2 rounded-full bg-field px-2 py-0.5 text-xs font-normal text-muted';
const invalidateUsers = () =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['users'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);

function NewUserForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api('/users', { method: 'POST', body: { login, name, password } }),
    onSuccess: async () => {
      await invalidateUsers();
      onDone();
    },
  });
  const fields = create.error?.fields ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="grid gap-3 rounded-2xl bg-canvas p-4 md:grid-cols-3 md:items-start"
    >
      <Field label="Логин" error={fields.login} hint="Латиница, цифры, точка, дефис">
        {(c) => <input {...c} autoFocus autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Пароль" error={fields.password} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
      </Field>
      {create.error && !create.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense md:col-span-3">
          {create.error.message}
        </p>
      )}
      <div className="flex gap-2 md:col-span-3">
        <button type="submit" disabled={create.isPending || !login.trim() || !password} className={btnPrimary}>
          Создать пользователя
        </button>
        <button type="button" onClick={onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function UserItem({ u, isMe }: { u: AppUser; isMe: boolean }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'password'>('view');
  const [name, setName] = useState(u.name);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const patch = useMutation<unknown, ApiError, { name?: string; password?: string; disabled?: boolean }>({
    mutationFn: (body) => api(`/users/${u.id}`, { method: 'PATCH', body }),
    onSuccess: async (_data, body) => {
      await invalidateUsers();
      setMode('view');
      setPassword('');
      if (body.password !== undefined) setNotice('Пароль сброшен, сеансы пользователя завершены');
      else if (body.disabled === true) setNotice('Пользователь отключён, его сеансы завершены');
      else setNotice(null);
    },
  });
  const open = (next: 'view' | 'rename' | 'password') => {
    patch.reset();
    setNotice(null);
    setName(u.name);
    setPassword('');
    setMode(next);
  };
  const fields = patch.error?.fields ?? {};

  return (
    <li className={`rounded-2xl border border-field p-4 ${u.disabledAt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">
            {u.name}
            {isMe && <span className={badge}>это вы</span>}
            {u.disabledAt && <span className={badge}>отключён</span>}
          </div>
          <div className="text-sm text-muted">{u.login}</div>
        </div>
        {mode === 'view' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => open('rename')} className={btnSmall}>
              Переименовать
            </button>
            {!isMe && (
              <button type="button" onClick={() => open('password')} className={btnSmall}>
                Сбросить пароль
              </button>
            )}
            {!isMe && (
              <button
                type="button"
                onClick={() => {
                  open('view');
                  patch.mutate({ disabled: !u.disabledAt });
                }}
                className={btnSmall}
              >
                {u.disabledAt ? 'Включить' : 'Отключить'}
              </button>
            )}
          </div>
        )}
      </div>
      {mode === 'rename' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ name });
          }}
          className="mt-3 flex flex-wrap items-start gap-2"
        >
          <Field label={`Новое имя для ${u.login}`} error={fields.name} className="min-w-64 flex-1">
            {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <div className="flex gap-2 md:mt-6">
            <button type="submit" disabled={patch.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={() => open('view')} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {mode === 'password' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ password });
          }}
          className="mt-3 flex flex-wrap items-start gap-2"
        >
          <Field
            label={`Новый пароль для ${u.login}`}
            error={fields.password}
            hint="Не короче 10 символов. Сеансы пользователя будут завершены."
            className="min-w-64 flex-1"
          >
            {(c) => (
              <input {...c} autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            )}
          </Field>
          <div className="flex gap-2 md:mt-6">
            <button type="submit" disabled={patch.isPending || !password} className={btnPrimary}>
              Сбросить пароль
            </button>
            <button type="button" onClick={() => open('view')} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      )}
      {patch.error && !patch.error.fields && (
        <p role="alert" className="mt-2 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          {patch.error.message}
        </p>
      )}
    </li>
  );
}

export function UsersSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const users = useUsers();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  if (!users.data || !me.data) return <Pending queries={[users, me]} />;
  const meId = me.data.user.id;

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[users]} />
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Пользователи</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            Добавить пользователя
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">Все пользователи видят все компании. Сброс пароля и отключение сразу завершают сеансы пользователя.</p>
      {creating && (
        <div className="mb-6">
          <NewUserForm onDone={() => setCreating(false)} />
        </div>
      )}
      <ul className="space-y-2">
        {users.data.map((u) => (
          <UserItem key={u.id} u={u} isMe={u.id === meId} />
        ))}
      </ul>
    </section>
  );
}
```

`src/client/pages/settings/ProfileSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { Field } from '../../components/Field';
import { Pending } from '../../components/QueryState';
import { btnPrimary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe, type Me } from '../../lib/query';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

const card = 'space-y-4 rounded-2xl border border-field p-4';

function NameCard({ user }: { user: Me['user'] }) {
  const [name, setName] = useState(user.name);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: ['me'] }), queryClient.invalidateQueries({ queryKey: ['users'] })]),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className={card}
    >
      <h2 className="text-lg font-semibold">Имя</h2>
      <p className="text-sm text-muted">Логин: {user.login}</p>
      <Field label="Имя" error={save.error?.fields?.name}>
        {(c) => (
          <input
            {...c}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              save.reset();
            }}
            className={inputClass}
          />
        )}
      </Field>
      {save.isSuccess && (
        <p role="status" className="text-sm text-muted">
          Имя сохранено
        </p>
      )}
      <button type="submit" disabled={save.isPending || !name.trim() || name.trim() === user.name} className={btnPrimary}>
        Сохранить имя
      </button>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation<unknown, ApiError>({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setAgain('');
    },
  });
  const fields = change.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.reset();
    if (next !== again) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate();
  };
  return (
    <form noValidate onSubmit={submit} className={card}>
      <h2 className="text-lg font-semibold">Пароль</h2>
      <Field label="Текущий пароль" error={fields.currentPassword}>
        {(c) => <input {...c} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Новый пароль" error={fields.newPassword} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Повторите новый пароль" error={mismatch ? 'Пароли не совпадают' : undefined}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />}
      </Field>
      {change.isSuccess && (
        <p role="status" className="text-sm text-income">
          Пароль изменён. Остальные сеансы завершены.
        </p>
      )}
      {change.error && !change.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {change.error.message}
        </p>
      )}
      <button type="submit" disabled={change.isPending || !current || !next || !again} className={btnPrimary}>
        Сменить пароль
      </button>
    </form>
  );
}

export function ProfileSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const me = useMe();
  if (!me.data) return <Pending queries={[me]} />;
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <h1 className="mb-4 text-2xl font-bold">Профиль</h1>
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <NameCard key={me.data.user.name} user={me.data.user} />
        <PasswordCard />
      </div>
    </section>
  );
}
```

`src/client/router.tsx` — импорты и маршруты после `settings/companies`:

```tsx
import { ProfileSettings } from './pages/settings/ProfileSettings';
import { UsersSettings } from './pages/settings/UsersSettings';
```

```tsx
          { path: 'settings/users', element: <UsersSettings /> },
          { path: 'settings/profile', element: <ProfileSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — комментарий над `SECTIONS` замените на `/** Разделы настроек по порядку: справочники компании, затем общие для экземпляра. */` и допишите в конец `SECTIONS` (после «Компании»):

```ts
  { path: 'users', label: 'Пользователи' },
  { path: 'profile', label: 'Профиль' },
```

- [ ] **Step 2: Check**

Run: `npm run typecheck`, `npm test`, `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client
git commit -m "feat: экраны «Пользователи» и «Профиль», имя в шапке ведёт в профиль

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Экран «История действий»

**Files:**
- Create: `src/client/lib/audit-format.ts`, `src/client/pages/settings/AuditSettings.tsx`, `tests/client/audit-format.test.ts`
- Modify: `src/shared/dates.ts`, `tests/shared/dates.test.ts`, `src/client/lib/query.ts` (`useMeta`), `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - `GET /companies/:cid/audit`, `GET /audit/system`, `/meta` с `timezone` (Task 2);
  - `useUsers` (Task 4).
- Produces:
  - `formatDateTime(iso: string, timeZone: string): string` («06.10.2026, 19:30»);
  - `ENTITY_LABELS`, `ACTION_LABELS`, `COMPANY_ENTITIES`, `diffRows(diff): DiffRow[] | null`, `formatBytes(n): string`;
  - `AuditEntry`, `useAuditFeed(companyId | null, filters)` — бесконечная лента с ключом `['audit', companyId, filters]`;
  - маршрут `/c/:companyId/settings/audit`, раздел «История действий».

- [ ] **Step 1: Write the failing tests**

`tests/client/audit-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffRows, formatBytes } from '../../src/client/lib/audit-format';

describe('audit-format', () => {
  it('diffRows: «было → стало» по полям before/after; иначе null', () => {
    expect(diffRows({ before: { name: 'А', archived: false }, after: { name: 'Б', templateParams: { pcCount: 30 } } })).toEqual([
      { field: 'name', before: 'А', after: 'Б' },
      { field: 'archived', before: 'false', after: '—' },
      { field: 'templateParams', before: '—', after: '{"pcCount":30}' },
    ]);
    expect(diffRows({ name: 'Касса' })).toBeNull();
    expect(diffRows({ before: null, after: {} })).toBeNull();
    expect(diffRows(null)).toBeNull();
  });

  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(1024 * 1024)).toBe('1 МБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 ГБ');
  });
});
```

Добавьте `formatDateTime` в импорт `tests/shared/dates.test.ts` и допишите:

```ts
describe('formatDateTime', () => {
  it('дата и время в заданном поясе', () => {
    expect(formatDateTime('2026-10-06T19:30:00.000Z', 'UTC')).toBe('06.10.2026, 19:30');
    expect(formatDateTime('2026-10-06T23:30:00.000Z', 'Etc/GMT-5')).toBe('07.10.2026, 04:30'); // UTC+5, как Алматы
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/audit-format.test.ts tests/shared/dates.test.ts`
Expected: FAIL — нет модуля и функции.

- [ ] **Step 3: Implement**

Допишите в `src/shared/dates.ts`:

```ts
/** Момент времени → «ДД.ММ.ГГГГ, ЧЧ:ММ» в заданном часовом поясе (APP_TIMEZONE из /meta). */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
```

`src/client/lib/audit-format.ts`:

```ts
export const ENTITY_LABELS: Record<string, string> = {
  company: 'Компания',
  project: 'Проект',
  account: 'Счёт',
  category: 'Статья',
  counterparty: 'Контрагент',
  tag: 'Тег',
  split_preset: 'Шаблон разделения',
  user: 'Пользователь',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  restore: 'Восстановление',
  archive: 'В архив',
  unarchive: 'Из архива',
  reorder: 'Порядок',
  login: 'Вход',
  logout: 'Выход',
  password_change: 'Смена пароля',
};

/** Сущности ленты компании (для фильтра). */
export const COMPANY_ENTITIES = ['company', 'project', 'account', 'category', 'counterparty', 'tag', 'split_preset'] as const;

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}

function show(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Строки «поле: было → стало» для diff вида { before, after }; null — показать JSON как есть. */
export function diffRows(diff: Record<string, unknown> | null): DiffRow[] | null {
  if (!diff) return null;
  const { before, after } = diff;
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => ({ field, before: show(b[field]), after: show(a[field]) }));
}

/** Размер файла: «500 Б», «1,5 КБ», «1 МБ». */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1).replace('.', ',').replace(/,0$/, '')} ${units[i]}`;
}
```

`src/client/lib/query.ts` — тип `useMeta`:

```ts
export function useMeta() {
  return useQuery<{ appName: string; timezone: string }, ApiError>({
    queryKey: ['meta'],
    queryFn: () => api('/meta'),
    staleTime: Infinity,
  });
}
```

`src/client/lib/queries.ts` — импорт и бесконечная лента:

```ts
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
```

(замените прежний импорт `useQuery`), и допишите:

```ts
export interface AuditEntry {
  id: number;
  companyId: number | null;
  userId: number | null;
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: string;
  diff: Record<string, unknown> | null;
  at: string;
}

interface AuditPage {
  entries: AuditEntry[];
  nextBeforeId: number | null;
}

/** Лента истории: companyId — события компании, null — системные (пользователи, входы). */
export function useAuditFeed(companyId: number | null, filters: { userId?: number; entity?: string }) {
  const base = companyId === null ? '/audit/system' : `/companies/${companyId}/audit`;
  return useInfiniteQuery<AuditPage, ApiError, InfiniteData<AuditPage, number | null>, readonly unknown[], number | null>({
    queryKey: ['audit', companyId, filters],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (pageParam !== null) p.set('beforeId', String(pageParam));
      if (filters.userId !== undefined) p.set('userId', String(filters.userId));
      if (filters.entity !== undefined) p.set('entity', filters.entity);
      const qs = p.toString();
      return api<AuditPage>(qs ? `${base}?${qs}` : base);
    },
    getNextPageParam: (last) => last.nextBeforeId,
    placeholderData: keepPreviousData, // при смене фильтра фильтры и старая лента не исчезают
  });
}
```

`src/client/pages/settings/AuditSettings.tsx`:

```tsx
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnSecondary, inputClass } from '../../components/ui';
import { ACTION_LABELS, COMPANY_ENTITIES, diffRows, ENTITY_LABELS } from '../../lib/audit-format';
import { useMeta } from '../../lib/query';
import { useAuditFeed, useUsers, type AuditEntry } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Scope = 'company' | 'system';

function AuditItem({ e, timeZone }: { e: AuditEntry; timeZone: string }) {
  const rows = diffRows(e.diff);
  return (
    <li className="rounded-2xl border border-field p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <time dateTime={e.at} className="text-muted">
          {formatDateTime(e.at, timeZone)}
        </time>
        <span className="font-semibold">{e.userName ?? 'Система'}</span>
        <span>{ACTION_LABELS[e.action] ?? e.action}</span>
        <span className="text-muted">
          {ENTITY_LABELS[e.entity] ?? e.entity}
          {e.entityId !== null ? ` №${e.entityId}` : ''}
        </span>
      </div>
      {e.diff && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">Подробности</summary>
          {rows ? (
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="text-muted">
                  <th className="pr-3 font-normal">Поле</th>
                  <th className="pr-3 font-normal">Было</th>
                  <th className="font-normal">Стало</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.field}>
                    <td className="pr-3 align-top">{r.field}</td>
                    <td className="pr-3 align-top text-expense">{r.before}</td>
                    <td className="align-top text-income">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="mt-2 overflow-x-auto rounded-xl bg-field p-3 text-xs">{JSON.stringify(e.diff, null, 2)}</pre>
          )}
        </details>
      )}
    </li>
  );
}

export function AuditSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const meta = useMeta();
  const users = useUsers();
  const [scope, setScope] = useState<Scope>('company');
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const feed = useAuditFeed(scope === 'company' ? company.id : null, {
    ...(userId ? { userId: Number(userId) } : {}),
    ...(entity ? { entity } : {}),
  });

  if (!feed.data || !meta.data || !users.data) return <Pending queries={[feed, meta, users]} />;
  const timeZone = meta.data.timezone;
  const entries = feed.data.pages.flatMap((p) => p.entries);
  const entityOptions: readonly string[] = scope === 'company' ? COMPANY_ENTITIES : ['user'];
  const switchScope = (s: Scope) => {
    setScope(s);
    setEntity('');
  };

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[feed]} />
      <h1 className="mb-4 text-2xl font-bold">История действий</h1>
      <div role="tablist" aria-label="Лента событий" className="mb-4 flex flex-wrap gap-2">
        {(['company', 'system'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            onClick={() => switchScope(s)}
            className={`rounded-xl px-3 py-1.5 text-sm ${scope === s ? 'bg-ink font-semibold text-white' : 'bg-field text-ink hover:brightness-95'}`}
          >
            {s === 'company' ? `Компания «${company.name}»` : 'Система'}
          </button>
        ))}
      </div>
      <div className="mb-4 grid max-w-2xl gap-3 md:grid-cols-2">
        <Field label="Пользователь">
          {(c) => (
            <select {...c} value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass}>
              <option value="">Все</option>
              {users.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Что изменилось">
          {(c) => (
            <select {...c} value={entity} onChange={(e) => setEntity(e.target.value)} className={inputClass}>
              <option value="">Всё</option>
              {entityOptions.map((x) => (
                <option key={x} value={x}>
                  {ENTITY_LABELS[x] ?? x}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {entries.length === 0 && <p className="text-muted">Событий нет.</p>}
      <ol className="space-y-2">
        {entries.map((e) => (
          <AuditItem key={e.id} e={e} timeZone={timeZone} />
        ))}
      </ol>
      {feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className={`${btnSecondary} mt-4`}>
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
}
```

`src/client/router.tsx` — импорт и маршрут после `settings/profile`:

```tsx
import { AuditSettings } from './pages/settings/AuditSettings';
```

```tsx
          { path: 'settings/audit', element: <AuditSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в конец `SECTIONS`:

```ts
  { path: 'audit', label: 'История действий' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client tests/shared/dates.test.ts`, затем `npm run typecheck` и `npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` — зелёные.

```bash
git add src/shared/dates.ts src/client tests/client/audit-format.test.ts tests/shared/dates.test.ts
git commit -m "feat: экран «История действий» — лента компании и системная, фильтры, было → стало

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Экран «Резервная копия» — статус и «Скачать сейчас» через fetch → Blob

**Files:**
- Create: `src/client/pages/settings/BackupSettings.tsx`
- Modify: `src/client/lib/api.ts`, `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - `GET /backup/status`, `GET /backup/download` (план 1, требует `X-Requested-With: fetch`);
  - `formatDateTime`, `formatBytes` (Task 5).
- Produces:
  - `downloadFile(path): Promise<{ blob: Blob; filename: string }>`, `saveBlob(blob, filename): void`;
  - `BackupStatus`, `useBackupStatus()` с ключом `['backup-status']`;
  - маршрут `/c/:companyId/settings/backup`, раздел «Резервная копия».

- [ ] **Step 1: Implement**

Сервер скачивания покрыт тестами плана 1. Клиентское скачивание проверяет e2e задачи 8 (событие `download`, имя файла).

`src/client/lib/api.ts` — допишите:

```ts
/** Скачивание файла через fetch: простая ссылка не годится, маршрут требует X-Requested-With (защита от CSRF). */
export async function downloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  return { blob: await res.blob(), filename };
}

/** Отдаёт Blob браузеру как скачиваемый файл. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

`src/client/lib/queries.ts` — допишите:

```ts
export interface BackupStatus {
  last: { file: string; createdAt: string; size: number } | null;
  copyDir: string | null;
  lastCopyError: string | null;
}

export function useBackupStatus() {
  return useQuery<BackupStatus, ApiError>({ queryKey: ['backup-status'], queryFn: () => api<BackupStatus>('/backup/status') });
}
```

`src/client/pages/settings/BackupSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { downloadFile, saveBlob, type ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/audit-format';
import { queryClient, useMeta } from '../../lib/query';
import { useBackupStatus } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

export function BackupSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const status = useBackupStatus();
  const meta = useMeta();
  const download = useMutation<void, ApiError>({
    mutationFn: async () => {
      const { blob, filename } = await downloadFile('/backup/download');
      saveBlob(blob, filename);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
  });

  if (!status.data || !meta.data) return <Pending queries={[status, meta]} />;
  const s = status.data;

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[status]} />
      <h1 className="mb-2 text-2xl font-bold">Резервная копия</h1>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Архив содержит базу и вложения всех компаний. Автокопия делается каждый день в 04:00 и при запуске, если последней больше суток.
      </p>
      <dl className="mb-6 grid max-w-2xl gap-x-6 gap-y-2 text-sm md:grid-cols-[16rem_1fr]">
        <dt className="text-muted">Последняя автокопия</dt>
        <dd>{s.last ? `${formatDateTime(s.last.createdAt, meta.data.timezone)} · ${formatBytes(s.last.size)}` : 'Ещё не было'}</dd>
        <dt className="text-muted">Папка для копий (BACKUP_COPY_DIR)</dt>
        <dd className="break-all">{s.copyDir ?? 'Не задана — копии хранятся только в data/backups'}</dd>
      </dl>
      {s.lastCopyError && (
        <p role="alert" className={alertClass}>
          Не удалось скопировать архив в BACKUP_COPY_DIR: {s.lastCopyError}
        </p>
      )}
      {download.error && (
        <p role="alert" className={alertClass}>
          {download.error.message}
        </p>
      )}
      <button type="button" onClick={() => download.mutate()} disabled={download.isPending} className={btnPrimary}>
        {download.isPending ? 'Готовим архив…' : 'Скачать сейчас'}
      </button>
    </section>
  );
}
```

`src/client/router.tsx` — импорт и маршрут после `settings/audit`:

```tsx
import { BackupSettings } from './pages/settings/BackupSettings';
```

```tsx
          { path: 'settings/backup', element: <BackupSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в конец `SECTIONS`:

```ts
  { path: 'backup', label: 'Резервная копия' },
```

- [ ] **Step 2: Check**

Run: `npm run typecheck`, `npm test`, `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client
git commit -m "feat: экран «Резервная копия» — статус автокопии, скачивание через fetch → Blob

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Последняя компания, доступный переключатель, «Новая компания» без мигания

**Files:**
- Create: `src/client/lib/company-path.ts`, `tests/client/company-path.test.ts`
- Modify: `src/client/lib/queries.ts`, `src/client/components/CompanySwitcher.tsx` (целиком), `src/client/pages/CompanyGate.tsx` (целиком), `src/client/pages/CompanyLayout.tsx` (целиком), `src/client/pages/NewCompanyPage.tsx` (целиком)

**Interfaces:**
- Consumes: `GET /preferences`, `PUT /preferences/:key` (Task 3).
- Produces:
  - `switchCompanyPath(pathname, companyId): string`;
  - `pickStartCompany(companies, lastId): Company | undefined`;
  - `usePreferences()` с ключом `['preferences']`, `savePreference(key, value): Promise<void>`;
  - ключ настроек `lastCompanyId` (число).

- [ ] **Step 1: Write the failing test**

`tests/client/company-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickStartCompany, switchCompanyPath } from '../../src/client/lib/company-path';
import type { Company } from '../../src/client/lib/queries';

const c = (id: number, archived = false): Company => ({ id, name: `К${id}`, baseCurrency: 'KZT', createdAt: 'x', archivedAt: archived ? 'x' : null });

describe('company-path', () => {
  it('switchCompanyPath: тот же раздел у другой компании', () => {
    expect(switchCompanyPath('/c/5/settings/accounts', 7)).toBe('/c/7/settings/accounts');
    expect(switchCompanyPath('/c/5/log', 12)).toBe('/c/12/log');
    expect(switchCompanyPath('/c/5', 7)).toBe('/c/7');
    expect(switchCompanyPath('/companies/new', 7)).toBe('/c/7/log');
    expect(switchCompanyPath('/c/55x/log', 7)).toBe('/c/7/log');
  });

  it('pickStartCompany: последняя активная, иначе первая активная (Review Focus 5)', () => {
    const list = [c(1), c(2, true), c(3)];
    expect(pickStartCompany(list, 3)?.id).toBe(3);
    expect(pickStartCompany(list, 2)?.id).toBe(1); // в архиве
    expect(pickStartCompany(list, 99)?.id).toBe(1); // удалена
    expect(pickStartCompany(list, '3')?.id).toBe(1); // не число
    expect(pickStartCompany(list, undefined)?.id).toBe(1);
    expect(pickStartCompany([c(2, true)], 2)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/company-path.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Implement**

`src/client/lib/company-path.ts`:

```ts
import type { Company } from './queries';

/** Тот же раздел у другой компании: /c/5/settings/accounts → /c/7/settings/accounts; вне компании — журнал. */
export function switchCompanyPath(pathname: string, companyId: number): string {
  return /^\/c\/\d+(\/|$)/.test(pathname) ? pathname.replace(/^\/c\/\d+/, `/c/${companyId}`) : `/c/${companyId}/log`;
}

/** Стартовая компания: последняя открытая, если она есть и не в архиве; иначе первая активная. */
export function pickStartCompany(companies: readonly Company[], lastId: unknown): Company | undefined {
  const active = companies.filter((c) => !c.archivedAt);
  return active.find((c) => c.id === lastId) ?? active[0];
}
```

`src/client/lib/queries.ts` — импорт `queryClient` и настройки:

```ts
import { queryClient } from './query';
```

```ts
export function usePreferences() {
  return useQuery<Record<string, unknown>, ApiError>({
    queryKey: ['preferences'],
    queryFn: async () => (await api<{ preferences: Record<string, unknown> }>('/preferences')).preferences,
    staleTime: Infinity,
  });
}

export async function savePreference(key: string, value: unknown): Promise<void> {
  await api(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
  queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [key]: value }));
}
```

`src/client/pages/CompanyGate.tsx` целиком:

```tsx
import { Navigate } from 'react-router';
import { LoadError } from '../components/LoadError';
import { pickStartCompany } from '../lib/company-path';
import { useCompanies, usePreferences } from '../lib/queries';

export function CompanyGate() {
  const companies = useCompanies();
  const prefs = usePreferences();
  if (!companies.data) {
    if (companies.error) return <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />;
    return <div className="p-8 text-muted">Загрузка…</div>;
  }
  // настройки не блокируют вход: при их ошибке открываем первую активную компанию
  if (prefs.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  const start = pickStartCompany(companies.data, prefs.data?.lastCompanyId);
  return <Navigate to={start ? `/c/${start.id}/log` : '/companies/new'} replace />;
}
```

`src/client/pages/CompanyLayout.tsx` целиком:

```tsx
import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { LoadError } from '../components/LoadError';
import { savePreference, useCompanies, usePreferences, type Company } from '../lib/queries';

export interface CompanyOutletContext {
  company: Company;
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-5 py-2 text-lg font-semibold ${isActive ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`;

export function CompanyLayout() {
  const { companyId } = useParams();
  const companies = useCompanies();
  const prefs = usePreferences();
  const company = companies.data?.find((c) => String(c.id) === companyId);
  const currentId = company?.id;
  const savedId = prefs.data?.lastCompanyId;

  // запоминаем последнюю открытую компанию; сбой не критичен — стартовый экран откроет первую активную
  useEffect(() => {
    if (currentId === undefined || prefs.data === undefined || savedId === currentId) return;
    savePreference('lastCompanyId', currentId).catch(() => undefined);
  }, [currentId, savedId, prefs.data]);

  if (!companies.data) {
    if (companies.error) return <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />;
    return <div className="p-8 text-muted">Загрузка…</div>;
  }
  if (!company) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader
        left={<CompanySwitcher current={company} companies={companies.data} />}
        profileHref={`/c/${company.id}/settings/profile`}
      />
      <main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-6 md:p-8">
        <nav className="mb-6 flex gap-2">
          <NavLink to={`/c/${company.id}/log`} className={tab}>
            Журнал
          </NavLink>
          <NavLink to={`/c/${company.id}/settings`} className={tab}>
            Настройки
          </NavLink>
        </nav>
        <Outlet context={{ company } satisfies CompanyOutletContext} />
      </main>
    </div>
  );
}
```

`src/client/components/CompanySwitcher.tsx` целиком:

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { switchCompanyPath } from '../lib/company-path';
import type { Company } from '../lib/queries';

const itemClass = 'block w-full truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-field focus:bg-field focus:outline-none';

/** Переключатель компаний: меню с клавиатурой (стрелки, Home/End, Esc), фокус возвращается на кнопку. */
export function CompanySwitcher({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const active = companies.filter((c) => !c.archivedAt);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const focusItem = (index: number) => {
    const list = items();
    if (list.length > 0) list[(index + list.length) % list.length]!.focus();
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // при открытии фокус — на текущей компании
  useEffect(() => {
    if (!open) return;
    const list = items();
    const i = list.findIndex((el) => el.dataset.current === 'true');
    focusItem(i >= 0 ? i : 0);
  }, [open]);

  // клик мимо меню закрывает его (фокус не перехватываем)
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(list.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const choose = (c: Company) => {
    close(true);
    // текущая компания — остаёмся там же (в том числе в настройках); другая — тот же раздел у неё
    if (c.id !== current.id) navigate(switchCompanyPath(location.pathname, c.id));
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex max-w-xs items-center gap-2 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
      >
        {/* доступное имя содержит видимое название компании (WCAG 2.5.3 «Label in Name») */}
        <span className="sr-only">Сменить компанию: </span>
        <span className="truncate">{current.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Компании"
          onKeyDown={onMenuKey}
          className="absolute left-0 z-20 mt-2 w-72 rounded-2xl bg-card p-2 text-ink shadow-xl"
        >
          {active.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              type="button"
              tabIndex={-1}
              data-current={c.id === current.id}
              aria-current={c.id === current.id ? 'true' : undefined}
              onClick={() => choose(c)}
              className={`${itemClass} ${c.id === current.id ? 'font-semibold' : ''}`}
            >
              {c.name}
            </button>
          ))}
          <div role="separator" className="my-1 border-t border-field" />
          <Link role="menuitem" tabIndex={-1} to="/companies/new" onClick={() => setOpen(false)} className={itemClass}>
            + Добавить компанию
          </Link>
          <Link role="menuitem" tabIndex={-1} to={`/c/${current.id}/settings/companies`} onClick={() => setOpen(false)} className={`${itemClass} text-muted`}>
            Все компании
          </Link>
        </div>
      )}
    </div>
  );
}
```

`src/client/pages/NewCompanyPage.tsx` целиком — заголовок и «Отмена» появляются только после загрузки списка, без мигания «Создайте первую компанию» → «Новая компания»:

```tsx
import { Link, useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanyForm } from '../components/CompanyForm';
import { LoadError } from '../components/LoadError';
import { useCompanies } from '../lib/queries';

export function NewCompanyPage() {
  const navigate = useNavigate();
  const companies = useCompanies();

  if (!companies.data) {
    return (
      <div className="min-h-dvh bg-chrome">
        <AppHeader />
        <main className="mx-auto mt-8 max-w-md rounded-3xl bg-card p-8">
          {companies.error ? (
            <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />
          ) : (
            <div className="text-muted">Загрузка…</div>
          )}
        </main>
      </div>
    );
  }

  const all = companies.data;
  const hasActive = all.some((c) => !c.archivedAt);
  const archived = all.find((c) => c.archivedAt);
  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader />
      <main className="mx-auto mt-8 max-w-md rounded-3xl bg-card p-8">
        <h1 className="mb-6 text-2xl font-bold">{hasActive ? 'Новая компания' : 'Создайте первую компанию'}</h1>
        {!hasActive && archived && (
          <p className="mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted">
            Все компании в архиве.{' '}
            <Link to={`/c/${archived.id}/settings/companies`} className="font-semibold text-ink underline">
              Открыть список компаний
            </Link>
            , чтобы вернуть нужную из архива.
          </p>
        )}
        <CompanyForm onCreated={(c) => navigate(`/c/${c.id}/log`, { replace: true })} />
        {hasActive && (
          <Link to="/" className="mt-4 inline-block text-sm font-semibold text-muted underline hover:text-ink">
            Отмена
          </Link>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client`, затем `npm run typecheck` и `npm run test:e2e`
Expected: PASS. Прежний e2e ищет кнопку по имени «Сменить компанию». Доступное имя теперь «Сменить компанию: <название>», подстрока совпадает.

- [ ] **Step 5: Full check and commit**

Run: `npm test` — зелёные.

```bash
git add src/client tests/client/company-path.test.ts
git commit -m "feat: последняя компания в настройках пользователя, доступный переключатель, «Новая компания» без мигания

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: E2E служебных экранов

**Files:**
- Create: `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: экраны задач 4–7; `e2e/server.ts` (пользователь `admin` / `e2e-password-1`, имя «Админ»; стартовый бэкап создаётся при запуске сервера).

- [ ] **Step 1: Write the tests**

`e2e/service-screens.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, user = 'admin', password = 'e2e-password-1') {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(user);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

async function addUser(page: Page, cid: number, login: string, name: string, password: string) {
  await page.goto(`/c/${cid}/settings/users`);
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Логин', { exact: true }).fill(login);
  await page.getByLabel('Имя', { exact: true }).fill(name);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать пользователя' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: login })).toBeVisible();
}

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('пользователи: сброс пароля и отключение сразу завершают чужой сеанс; себя отключить нельзя', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Люди ${Date.now()}`);
  await addUser(page, cid, 'kassir', 'Кассир', 'kassir-pass-1');
  const row = page.getByRole('listitem').filter({ hasText: 'kassir' });
  const meRow = page.getByRole('listitem').filter({ hasText: 'это вы' });
  await expect(meRow.getByRole('button', { name: 'Отключить' })).toHaveCount(0);

  const ctx = await browser.newContext();
  const kassir = await ctx.newPage();
  await login(kassir, 'kassir', 'kassir-pass-1');

  await row.getByRole('button', { name: 'Сбросить пароль' }).click();
  await row.getByLabel('Новый пароль для kassir').fill('kassir-pass-2');
  await row.getByRole('button', { name: 'Сбросить пароль' }).click();
  await expect(row.getByRole('status')).toHaveText('Пароль сброшен, сеансы пользователя завершены');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await login(kassir, 'kassir', 'kassir-pass-2');

  await row.getByRole('button', { name: 'Отключить' }).click();
  await expect(row).toContainText('отключён');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await ctx.close();
});

test('профиль: смена пароля оставляет текущий сеанс и завершает остальные', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Профиль ${Date.now()}`);
  await addUser(page, cid, 'profiler', 'Профилёр', 'profiler-pass-1');

  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await login(a, 'profiler', 'profiler-pass-1');
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await login(b, 'profiler', 'profiler-pass-1');

  await a.getByRole('link', { name: 'Профилёр' }).click(); // имя в шапке ведёт в профиль
  await expect(a.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  await a.getByLabel('Текущий пароль').fill('wrong-password-0');
  await a.getByLabel('Новый пароль', { exact: true }).fill('profiler-pass-2');
  await a.getByLabel('Повторите новый пароль').fill('profiler-pass-2');
  await a.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(a.getByText('Неверный текущий пароль')).toBeVisible();
  await expect(a.getByLabel('Текущий пароль')).toHaveAttribute('aria-invalid', 'true');

  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  await a.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(a.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');
  await a.reload();
  await expect(a.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  await b.reload();
  await expect(b).toHaveURL(/\/login$/);
  await ctxA.close();
  await ctxB.close();
});

test('история: события компании с именем пользователя, фильтр, подробности; системная лента', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО История ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByLabel('Новый тег').fill('Аренда');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Аренда' }).getByRole('button', { name: 'Переименовать' }).click();
  await page.getByLabel('Новое название тега «Аренда»').fill('Аренда зала');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Аренда зала' })).toBeVisible();

  await section(page, 'История действий').click();
  const first = page.getByRole('listitem').first();
  await expect(first).toContainText('Админ');
  await expect(first).toContainText('Изменение');
  await expect(first).toContainText('Тег');
  await first.getByText('Подробности').click();
  await expect(first.getByRole('table')).toContainText('Аренда зала');

  await page.getByLabel('Что изменилось').selectOption('company');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('Компания');

  await page.getByRole('tab', { name: 'Система' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Пользователь');
});

test('резервная копия: статус автокопии и «Скачать сейчас»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Бэкап ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/backup`);
  await expect(page.getByText('Последняя автокопия')).toBeVisible();
  await expect(page.getByText('Ещё не было')).toHaveCount(0); // стартовый бэкап e2e-сервера
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать сейчас' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^backup-\d{8}-\d{6}\.zip$/);
});

test('переключатель: клавиатура, текущая компания не уводит из настроек, последняя компания запоминается', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const alpha = `ТОО Альфа ${stamp}`;
  const beta = `ТОО Бета ${stamp}`;
  const alphaId = await createCompany(page, alpha);
  const betaId = await createCompany(page, beta);

  await page.goto(`/c/${betaId}/settings/accounts`);
  const switcher = page.getByRole('button', { name: /Сменить компанию/ });
  await expect(switcher).toHaveAccessibleName(`Сменить компанию: ${beta}`);

  // выбор текущей компании — остаёмся в настройках, фокус на кнопке
  await switcher.click();
  await page.getByRole('menuitem', { name: beta }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${betaId}/settings/accounts$`));
  await expect(switcher).toBeFocused();

  // клавиатура: стрелка открывает меню на текущей, ↑ — к «Альфе», Enter — тот же раздел у неё
  await switcher.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: beta })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: alpha })).toBeFocused();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/lastCompanyId') && r.request().method() === 'PUT');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/settings/accounts$`));
  await saved;

  // Esc закрывает меню и возвращает фокус
  await switcher.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(switcher).toBeFocused();

  // стартовый экран открывает последнюю компанию
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/log$`));
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: PASS — 5 новых и все прежние.

- [ ] **Step 3: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add e2e/service-screens.spec.ts
git commit -m "test: e2e служебных экранов — пользователи, профиль, история, бэкап, переключатель

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие пунктов шага 3 и хвостов

| Пункт | Где закрыт |
|---|---|
| «Профиль»: имя, смена пароля, завершение остальных сессий | Task 1, Task 4, e2e Task 8 |
| «Пользователи»: список, добавление, сброс пароля, отключение, запреты | Task 1, Task 4, e2e Task 8 |
| `user:passwd` | Task 1 |
| «История действий»: лента, фильтр по пользователю и сущности, diff | Task 2, Task 5, e2e Task 8 |
| «Резервная копия»: «Скачать сейчас», дата автокопии, `BACKUP_COPY_DIR` | Task 6, e2e Task 8 |
| `user_preferences`, последняя компания | Task 3, Task 7, e2e Task 8 |
| Переключатель: стрелки, фокус, WCAG 2.5.3, текущая компания не уводит из настроек | Task 7, e2e Task 8 |
| Мигание «Новая компания» | Task 7 |
| Хвосты плана 1: валидация `limit` в `audit.list`, атомарная уникальность логина, скачивание бэкапа через `fetch` → Blob | Task 2, Task 1, Task 6 |

**Не входит в план 3b (следующие шаги):**
- если `POST /auth/logout` не удался, интерфейс не должен считать пользователя вышедшим (шаги 5–7);
- вошедшего пользователя на `/login` перенаправлять внутрь (шаги 5–7);
- видимые колонки журнала и свёрнутая панель в `user_preferences` появятся вместе с журналом (шаг 5).
