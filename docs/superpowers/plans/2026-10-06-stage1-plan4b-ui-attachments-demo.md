# Этап 1, план 4b: балансы и курсы в интерфейсе, вложения, демо-набор — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина шага 4 §11 спецификации:
- левая панель счетов с балансами и «Всего на счетах» (§7 «Каркас»), сворачивание панели запоминается в `user_preferences`;
- балансы компаний в переключателе;
- экран «Курсы»: фиксированные курсы компании и ручные курсы на дату (без Нацбанка — решение заказчика);
- блокировка полей валюты в интерфейсе: у счёта с операциями и у компании с операциями или фиксированными курсами;
- вложения операций: загрузка, список, скачивание, мягкое удаление (§4.5);
- `npm run seed:demo` — детерминированный демо-набор §10 и тест сверки SQL-балансов с пересчётом в JS (§12).

**Предусловие:** выполнен план 4a — курсы, операции, `createLedgerBalances`, `createOperationsReferences`, `GET /companies/:cid/balances`, `GET /companies/summary`, `tests/helpers/ops.ts` (`opsWorld`).

**Architecture:**
- **Вложения** передаются телом запроса `application/octet-stream` с заголовками `X-File-Name` (URI-кодированное имя) и `X-File-Type`. Fastify разбирает такое тело встроенным парсером — `@fastify/multipart` и сетевая установка пакетов не нужны. Файлы лежат в `data/uploads/` под случайным именем, в бэкап уже попадают (§9.2). Скачивание всегда идёт как файл (`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`): пользовательский HTML не исполняется в origin приложения.
- **Демо-набор** создаётся настоящими сервисами (те же инварианты и история), детерминированным генератором `mulberry32`. Модуль `scripts/lib/demo.ts` вызывается скриптом и тестом (в тесте — меньше операций).
- **Клиент:** `AccountsPanel` в `CompanyLayout` слева от рабочей области (на ширине < 768 px скрыта до шага 7). Экран «Курсы» — две секции. Флаги `hasOperations` (счёт) и `currencyLocked` (компания) приходят из списков API.

**Tech Stack:** как в планах 1–4a.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.2, §4.3, §4.5 (`attachments`), §4.7, §6 (Вложения, Балансы, Компании `summary`), §7 (Каркас: шапка, левая панель; Настройки: Счета, Компании, Курсы), §9.2, §10 (демо-набор), §11 шаг 4, §12.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

1. **Загрузка файла без multipart.** Тело `application/octet-stream`, имя и тип — в заголовках. Причина: нет сетевого доступа для установки `@fastify/multipart`; один файл на запрос покрывает форму операции (шаг 6).
2. **Лимит вложения — 10 МБ** (спецификация лимита не задаёт): фото чека или PDF-счёта укладываются, бэкап не раздувается. Больше — 413 `TOO_LARGE`.
3. **Клик по счёту в левой панели** ведёт в журнал с параметром `?account=<id>`; фильтр журнала по нему включит шаг 5.
4. **Экран «Курсы» без раздела Нацбанка** — загрузка курсов Нацбанка отложена (§4.3, решение 2026-10-06).
5. **`seed:demo` заливает только пустую базу** и не работает при запущенном приложении — иначе демо-данные смешаются с рабочими.

## Global Constraints

- **Вложение** (`attachments`): id, companyId, operationId, originalName, storedName, mime, size, createdAt, deletedAt. Принадлежит компании операции (инвариант 5). Удаление только помечает запись (`deletedAt`), файл на диске остаётся (§4.5). Имя после `cleanName` — 1–200 символов; размер 1 байт … 10 МБ; к удалённой операции не прикрепляется (409 `VERSION_CONFLICT`).
- **Скачивание вложения:** `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename*=UTF-8''<имя>`, `X-Content-Type-Options: nosniff`. Сохранённый `mime` — только для показа и проходит проверку формата; невалидный → `application/octet-stream`.
- **Левая панель (§7):** «Всего на счетах» в базовой валюте; при валютах без курса под итогом — «курс {X} недоступен»; счета сгруппированы: «Общие», затем проекты по `orderIndex`; у каждого — баланс в своей валюте; архивные счета не показываются; «+ счёт» ведёт в настройки счетов; панель сворачивается, состояние — ключ `sidebar.collapsed` в `user_preferences`.
- **Блокировки валют (§4.2, §4.4, §7):** поле валюты счёта недоступно, если по счёту есть операции (включая удалённые); поле базовой валюты компании — если есть операции или фиксированные курсы. Сервер уже отвечает `CURRENCY_LOCKED` (план 4a); интерфейс показывает подсказку и не даёт выбрать.
- **Курсы в интерфейсе:** ручной курс — общий для экземпляра, на одну дату, к тенге; фиксированный — у компании, к её базовой валюте, на период. Курс вводится с запятой или точкой, до 10 знаков после запятой; показывается с запятой.
- **Демо-набор (§10):** 3 компании, 5 проектов, 8 счетов (KZT и USD), не меньше 60 статей, 150 контрагентов, 10 000 операций за 2 года (около 15 % разбитых, около 10 % переводов), детерминированно.
- **Интерфейс:** тексты на русском, цвета через токены, `Field` для полей, данные раньше ошибки. В левой панели нет элементов `listitem`, `status`, `alert`, `region` — их ищут существующие e2e на экранах настроек.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck` (для задач 4–6 ещё `npm run test:e2e`), коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Код с невидимыми или особыми символами — через `\uXXXX`.

## Review Focus

1. **Валютный счёт без курса на сегодня** — левая панель показывает «курс USD недоступен», итог его не включает; после ввода фиксированного курса итог пересчитывается. Тест — в задаче 5.
2. **Вложение с HTML и скриптом** не открывается в браузере как страница приложения: скачивание как файл, `application/octet-stream`, `nosniff`. Тест — в задаче 2.
3. **Файл больше 10 МБ** — 413 `TOO_LARGE` с русским сообщением, на диске ничего не остаётся; сбой записи в БД удаляет уже записанный файл. Тест — в задаче 2.
4. **`seed:demo` по рабочей базе** — отказ без единой записи; повторный запуск на пустой базе даёт те же данные. Тест — в задаче 3.
5. **Свёрнутая панель** остаётся свёрнутой после перезагрузки (и на другом устройстве того же пользователя). Тест — в задаче 4.

---

## Карта файлов

```
src/server/
  db/schema.ts                       # + attachments
  db/migrations/0004_*.sql           # генерируется
  errors.ts                          # 413 → TOO_LARGE
  modules/attachments/{service,routes}.ts   # (новые)
  modules/accounts/routes.ts         # список: hasOperations
  modules/companies/{service,routes}.ts     # currencyLocked
  app.ts
scripts/lib/demo.ts, scripts/seed-demo.ts, package.json   # seed:demo
src/shared/money.ts                  # + formatMoney
src/client/
  lib/queries.ts                     # балансы, сводка, курсы, флаги
  lib/accounts-panel.ts              # (новый) группы левой панели
  lib/audit-format.ts                # подписи operation, rate, fixed_rate, attachment
  components/AccountsPanel.tsx       # (новый)
  components/CompanySwitcher.tsx     # итоги компаний
  components/AccountForm.tsx         # блокировка валюты
  pages/CompanyLayout.tsx            # панель слева
  pages/settings/RatesSettings.tsx   # (новый)
  pages/settings/{AccountsSettings,CompaniesSettings,AuditSettings,SettingsNav}.tsx
  router.tsx
tests/helpers/api.ts                 # + cookie
tests/server/currency-flags.test.ts, attachments.test.ts, demo.test.ts
tests/shared/money.test.ts, tests/client/{accounts-panel,audit-format}.test.ts
e2e/money.spec.ts                    # (новый)
```

---

### Task 1: Флаги блокировки валют в списках API

**Files:**
- Create: `tests/server/currency-flags.test.ts`
- Modify: `src/server/modules/companies/service.ts`, `src/server/modules/companies/routes.ts`, `src/server/modules/accounts/routes.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `ReferencesService.countOperations` (план 4a — настоящая реализация), таблицы `operations`, `fixedRates`.
- Produces:
  - `CompaniesService.currencyLocked(id): boolean` — есть операции (включая удалённые) или фиксированные курсы;
  - `GET /api/v1/companies` → у каждой компании поле `currencyLocked: boolean`;
  - `GET /api/v1/companies/:cid/accounts` → у каждого счёта поле `hasOperations: boolean`.

- [ ] **Step 1: Write the failing test**

`tests/server/currency-flags.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('флаги блокировки валют в списках', () => {
  it('счёт с операцией (даже удалённой) — hasOperations; компания с операциями или фиксированным курсом — currencyLocked', async () => {
    w = await opsWorld();
    const op = await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    await w.h.req('DELETE', `${w.ops}/${op.operation.id}`);

    const accounts = (await w.h.req('GET', `/api/v1/companies/${w.cid}/accounts`)).json().accounts as { id: number; hasOperations: boolean }[];
    expect(accounts.find((a) => a.id === w.kzt)!.hasOperations).toBe(true);
    expect(accounts.find((a) => a.id === w.usd)!.hasOperations).toBe(false);

    const empty = await w.h.company('Пустая');
    const withFixed = await w.h.company('С курсом');
    await w.post(`/api/v1/companies/${withFixed}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2026-10-01' });
    const list = (await w.h.req('GET', '/api/v1/companies')).json().companies as { id: number; currencyLocked: boolean }[];
    const locked = Object.fromEntries(list.map((c) => [c.id, c.currencyLocked]));
    expect(locked).toEqual({ [w.cid]: true, [empty]: false, [withFixed]: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/currency-flags.test.ts`
Expected: FAIL — полей `hasOperations` и `currencyLocked` нет.

- [ ] **Step 3: Implement**

`src/server/modules/companies/service.ts` — метод в интерфейс и реализацию; проверку в `update` (добавленную планом 4a) переведите на него:

```ts
  /** Базовую валюту менять нельзя: есть операции (включая удалённые) или фиксированные курсы (§4.2). */
  currencyLocked(id: number): boolean;
```

```ts
    currencyLocked(id) {
      const ops = db.select({ n: count() }).from(operations).where(eq(operations.companyId, id)).get()?.n ?? 0;
      const fixed = db.select({ n: count() }).from(fixedRates).where(eq(fixedRates.companyId, id)).get()?.n ?? 0;
      return ops + fixed > 0;
    },
```

В `update` замените блок плана 4a `if (changes.after.baseCurrency !== undefined) { … }` на:

```ts
      if (changes.after.baseCurrency !== undefined && svc.currencyLocked(id)) {
        throw new AppError(422, 'CURRENCY_LOCKED', 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
      }
```

`src/server/modules/companies/routes.ts` — список с флагом:

```ts
  app.get('/api/v1/companies', async () => ({
    companies: companies.list().map((c) => ({ ...c, currencyLocked: companies.currencyLocked(c.id) })),
  }));
```

`src/server/modules/accounts/routes.ts` — зависимость `references` и список с флагом:

```ts
import type { ReferencesService } from '../references/service';
```

```ts
export function registerAccountsRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountsService; companies: CompaniesService; references: ReferencesService },
): void {
```

```ts
  app.get<C>(BASE, async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    // §7: валюта счёта заблокирована, если по нему есть операции (включая удалённые)
    return { accounts: accounts.list(cid).map((a) => ({ ...a, hasOperations: deps.references.countOperations('account', a.id) > 0 })) };
  });
```

`src/server/app.ts`:

```ts
  registerAccountsRoutes(app, { accounts, companies, references });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/currency-flags.test.ts tests/server/companies.test.ts tests/server/accounts-api.test.ts tests/server/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/companies src/server/modules/accounts/routes.ts src/server/app.ts tests/server/currency-flags.test.ts
git commit -m "feat: флаги блокировки валют в списках счетов и компаний

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Вложения операций — загрузка, список, скачивание, мягкое удаление

**Files:**
- Create: `src/server/modules/attachments/service.ts`, `src/server/modules/attachments/routes.ts`, `src/server/db/migrations/0004_*.sql` (генерируется), `tests/server/attachments.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/errors.ts`, `src/server/app.ts`, `tests/helpers/api.ts`

**Interfaces:**
- Consumes: таблица `operations` (4a), `mutate`, `requireCompany`, `cleanName`, `config.uploadsDir`.
- Produces:
  - таблица `attachments`;
  - `ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024`, `AttachmentRow`, `createAttachmentsService(d: { db; audit; uploadsDir; now? })` → `list`, `add`, `open`, `remove`;
  - маршруты:
    - `POST /api/v1/companies/:cid/operations/:id/attachments` (тело — байты файла, `Content-Type: application/octet-stream`, `X-File-Name`, `X-File-Type`) → 201 `{ attachment }`;
    - `GET …/operations/:id/attachments` → `{ attachments }`;
    - `GET /api/v1/companies/:cid/attachments/:id` → файл;
    - `DELETE /api/v1/companies/:cid/attachments/:id` → 204;
  - ошибка 413 → `{ code: 'TOO_LARGE', message: 'Слишком большой запрос: файл — не больше 10 МБ' }`;
  - `ApiHarness.cookie` — кука сессии для запросов в обход `req` (бинарное тело).

- [ ] **Step 1: Write the failing test**

`tests/helpers/api.ts` — кука в интерфейсе и результате:

```ts
export interface ApiHarness {
  t: TestApp;
  req: Req;
  /** Кука сессии admin — для запросов с бинарным телом через t.app.inject. */
  cookie: string;
```

```ts
  return {
    t,
    req,
    cookie,
```

`tests/server/attachments.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN_HEADERS } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const upload = (url: string, data: Buffer, name = 'чек.png', type = 'image/png') =>
  w.h.t.app.inject({
    method: 'POST',
    url,
    headers: {
      ...ORIGIN_HEADERS,
      cookie: w.h.cookie,
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'x-file-type': type,
    },
    payload: data,
  });
const newOp = async () => (await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 })).operation.id as number;

describe('attachments', () => {
  it('загрузка, список, скачивание как файл, мягкое удаление; файл остаётся на диске', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const res = await upload(`${w.ops}/${opId}/attachments`, data);
    expect(res.statusCode).toBe(201);
    const att = res.json().attachment;
    expect(att).toMatchObject({ operationId: opId, originalName: 'чек.png', mime: 'image/png', size: 7, deletedAt: null });
    expect(att.storedName).toMatch(/^[0-9a-f-]{36}\.png$/);
    const onDisk = path.join(w.h.t.config.uploadsDir, att.storedName);
    expect(fs.readFileSync(onDisk).equals(data)).toBe(true);
    expect((await w.h.req('GET', `${w.ops}/${opId}/attachments`)).json().attachments).toHaveLength(1);

    const file = await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(data)).toBe(true);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('чек.png')}`);
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    expect((await w.h.req('DELETE', `/api/v1/companies/${w.cid}/attachments/${att.id}`)).statusCode).toBe(204);
    expect((await w.h.req('GET', `${w.ops}/${opId}/attachments`)).json().attachments).toEqual([]);
    expect((await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`)).statusCode).toBe(404);
    expect(fs.existsSync(onDisk)).toBe(true); // §4.5: физический файл не удаляется
    expect(w.h.auditCount('attachment', 'create')).toBe(1);
    expect(w.h.auditCount('attachment', 'delete')).toBe(1);
  });

  it('HTML со скриптом скачивается как файл, недопустимый тип заменяется (Review Focus 2)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const res = await upload(`${w.ops}/${opId}/attachments`, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html;<script>');
    const att = res.json().attachment;
    expect(att.mime).toBe('application/octet-stream');
    const file = await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(String(file.headers['content-disposition'])).toMatch(/^attachment;/);
  });

  it('проверки: пустой файл, без имени, больше 10 МБ, удалённая операция, не octet-stream, чужая компания (Review Focus 3)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const url = `${w.ops}/${opId}/attachments`;
    const filesBefore = () => (fs.existsSync(w.h.t.config.uploadsDir) ? fs.readdirSync(w.h.t.config.uploadsDir).length : 0);
    const before = filesBefore();

    expect((await upload(url, Buffer.alloc(0))).json().error.fields.file).toBe('Файл пустой');
    expect((await upload(url, Buffer.from('x'), '\u200B')).json().error.fields.name).toBe('Имя файла: от 1 до 200 символов');
    const big = await upload(url, Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({ code: 'TOO_LARGE', message: 'Слишком большой запрос: файл — не больше 10 МБ' });
    const json = await w.h.req('POST', url, { not: 'a file' });
    expect(json.statusCode).toBe(400);
    expect(filesBefore()).toBe(before); // отказ — ничего не записано

    const other = await w.h.company('Чужая');
    expect((await upload(`/api/v1/companies/${other}/operations/${opId}/attachments`, Buffer.from('x'))).statusCode).toBe(404);
    const att = (await upload(url, Buffer.from('x'), 'a.txt', 'text/plain')).json().attachment;
    expect((await w.h.req('GET', `/api/v1/companies/${other}/attachments/${att.id}`)).statusCode).toBe(404);
    expect((await w.h.req('DELETE', `/api/v1/companies/${other}/attachments/${att.id}`)).statusCode).toBe(404);

    await w.h.req('DELETE', `${w.ops}/${opId}`);
    const toDeleted = await upload(url, Buffer.from('x'));
    expect(toDeleted.statusCode).toBe(409);
    expect(toDeleted.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('сбой записи в БД удаляет уже записанный файл (Review Focus 3)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const dir = w.h.t.config.uploadsDir;
    const count = () => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);
    const before = count();
    w.h.t.sqlite.exec("CREATE TEMP TRIGGER audit_down BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
    expect((await upload(`${w.ops}/${opId}/attachments`, Buffer.from('x'))).statusCode).toBe(500);
    w.h.t.sqlite.exec('DROP TRIGGER audit_down');
    expect(count()).toBe(before);
    expect((w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM attachments').get() as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/attachments.test.ts`
Expected: FAIL — маршруты 404, нет поля `cookie`.

- [ ] **Step 3: Implement**

`src/server/db/schema.ts` — таблица в конец файла:

```ts
export const attachments = sqliteTable(
  'attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
    originalName: text('original_name').notNull(),
    /** Имя файла в data/uploads: случайный UUID и расширение исходного файла. */
    storedName: text('stored_name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('attachments_operation_idx').on(t.operationId), uniqueIndex('attachments_stored_uq').on(t.storedName)],
);
```

Run: `npm run db:generate` — создан `0004_<имя>.sql` с таблицей `attachments` и двумя индексами; повторный запуск — без изменений.

`src/server/errors.ts` — перед общей веткой 4xx:

```ts
    if (status === 413) {
      return reply.status(413).send({ error: { code: 'TOO_LARGE', message: 'Слишком большой запрос: файл — не больше 10 МБ' } });
    }
```

`src/server/modules/attachments/service.ts`:

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { attachments, operations } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type AttachmentRow = typeof attachments.$inferSelect;

export interface AttachmentsService {
  list(companyId: number, operationId: number): AttachmentRow[];
  add(companyId: number, operationId: number, file: { name: string; mime: string; data: Buffer }, userId: number): AttachmentRow;
  /** Неудалённое вложение компании и путь к файлу. */
  open(companyId: number, id: number): { row: AttachmentRow; filePath: string };
  /** Мягкое удаление: файл на диске остаётся (§4.5). */
  remove(companyId: number, id: number, userId: number): void;
}

const MIME_RE = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/i;
const EXT_RE = /\.[a-z0-9]{1,10}$/i;
const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте файл', fields);

export function createAttachmentsService(d: { db: Db; audit: AuditService; uploadsDir: string; now?: () => Date }): AttachmentsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireOperation(companyId: number, operationId: number) {
    const op = db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.companyId, companyId))).get();
    if (!op) throw new AppError(404, 'NOT_FOUND', 'Операция не найдена');
    return op;
  }

  function requireAttachment(companyId: number, id: number): AttachmentRow {
    const row = db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.companyId, companyId), isNull(attachments.deletedAt)))
      .get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Вложение не найдено');
    return row;
  }

  return {
    list(companyId, operationId) {
      requireCompany(db, companyId);
      requireOperation(companyId, operationId);
      return db
        .select()
        .from(attachments)
        .where(and(eq(attachments.operationId, operationId), isNull(attachments.deletedAt)))
        .orderBy(asc(attachments.id))
        .all();
    },

    add(companyId, operationId, file, userId) {
      requireCompany(db, companyId, { writable: true });
      const op = requireOperation(companyId, operationId);
      if (op.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу');
      const name = cleanName(file.name);
      if (name.length < 1 || name.length > 200) throw invalid({ name: 'Имя файла: от 1 до 200 символов' });
      if (file.data.length === 0) throw invalid({ file: 'Файл пустой' });
      if (file.data.length > ATTACHMENT_MAX_BYTES) {
        throw new AppError(413, 'TOO_LARGE', 'Слишком большой запрос: файл — не больше 10 МБ');
      }
      const mime = MIME_RE.test(file.mime) ? file.mime.toLowerCase() : 'application/octet-stream';
      const storedName = `${crypto.randomUUID()}${EXT_RE.exec(name)?.[0].toLowerCase() ?? ''}`;
      fs.mkdirSync(d.uploadsDir, { recursive: true });
      const filePath = path.join(d.uploadsDir, storedName);
      fs.writeFileSync(filePath, file.data, { flag: 'wx' });
      try {
        return mutate(db, audit, (tx, record) => {
          const row = tx
            .insert(attachments)
            .values({ companyId, operationId, originalName: name, storedName, mime, size: file.data.length, createdAt: now().toISOString() })
            .returning()
            .get();
          record({ companyId, userId, entity: 'attachment', entityId: row.id, action: 'create', diff: { operationId, name, size: row.size, mime } });
          return row;
        });
      } catch (e) {
        fs.rmSync(filePath, { force: true }); // запись в БД не удалась — файл-сирота не нужен
        throw e;
      }
    },

    open(companyId, id) {
      requireCompany(db, companyId);
      const row = requireAttachment(companyId, id);
      return { row, filePath: path.join(d.uploadsDir, row.storedName) };
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAttachment(companyId, id);
      mutate(db, audit, (tx, record) => {
        tx.update(attachments).set({ deletedAt: now().toISOString() }).where(eq(attachments.id, id)).run();
        record({ companyId, userId, entity: 'attachment', entityId: id, action: 'delete', diff: { operationId: row.operationId, name: row.originalName } });
      });
    },
  };
}
```

`src/server/modules/attachments/routes.ts`:

```ts
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
import { ATTACHMENT_MAX_BYTES, type AttachmentsService } from './service';

type P = { Params: { cid: string; id: string } };

/** Заголовок с URI-кодированным именем файла; битая кодировка — пустое имя (ошибка поля). */
function headerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export function registerAttachmentsRoutes(app: FastifyInstance, deps: { attachments: AttachmentsService }): void {
  const { attachments } = deps;

  // файл приходит телом запроса целиком: multipart не нужен (одно вложение на запрос)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ATTACHMENT_MAX_BYTES }, (_req, body, done) => done(null, body));

  app.post<P>('/api/v1/companies/:cid/operations/:id/attachments', { bodyLimit: ATTACHMENT_MAX_BYTES }, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError(400, 'VALIDATION', 'Отправьте файл телом запроса application/octet-stream', { file: 'Нет файла' });
    }
    const mime = typeof req.headers['x-file-type'] === 'string' ? req.headers['x-file-type'] : '';
    const attachment = attachments.add(cid, id, { name: headerName(req.headers['x-file-name']), mime, data: req.body }, req.user!.id);
    return reply.status(201).send({ attachment });
  });

  app.get<P>('/api/v1/companies/:cid/operations/:id/attachments', async (req) => ({
    attachments: attachments.list(parseId(req.params.cid), parseId(req.params.id)),
  }));

  app.get<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
    const { row, filePath } = attachments.open(parseId(req.params.cid), parseId(req.params.id));
    if (!fs.existsSync(filePath)) throw new AppError(404, 'NOT_FOUND', 'Файл вложения не найден');
    // всегда как файл: пользовательский HTML не должен исполняться в origin приложения
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
    attachments.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });
}
```

`src/server/app.ts` — импорты и регистрация после `registerOperationsRoutes(…)`:

```ts
import { registerAttachmentsRoutes } from './modules/attachments/routes';
import { createAttachmentsService } from './modules/attachments/service';
```

```ts
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

`tests/helpers/api.ts` — изменения из Step 1 (поле `cookie`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/attachments.test.ts tests/server/backup.test.ts tests/server/errors-and-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/db src/server/errors.ts src/server/modules/attachments src/server/app.ts tests/helpers/api.ts tests/server/attachments.test.ts
git commit -m "feat: вложения операций — загрузка телом запроса, скачивание как файл, мягкое удаление

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Демо-набор `seed:demo` и сверка балансов (§10, §12)

**Files:**
- Create: `scripts/lib/demo.ts`, `scripts/seed-demo.ts`, `tests/server/demo.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: сервисы компаний, проектов, счетов, статей, контрагентов, курсов, операций (планы 2–4a); `createOperationsReferences`, `createLedgerBalances` (4a); `allocate` (4a); `isLockHeld` (план 1).
- Produces:
  - `rng(seed): () => number` — детерминированный генератор;
  - `seedDemo(d: { db; timezone; now: Date; operations?: number }): DemoResult` — бросает `Error`, если в базе есть компании или нет пользователя;
  - `DemoResult { companies; projects; accounts; categories; counterparties; operations }`;
  - `npm run seed:demo [-- <число операций>]`.

- [ ] **Step 1: Write the failing test**

`tests/server/demo.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { rng, seedDemo } from '../../scripts/lib/demo';
import { seedCurrencies } from '../../src/server/db/seed';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createTestDb } from '../helpers/test-db';

const dbs: ReturnType<typeof createTestDb>[] = [];
afterEach(() => {
  while (dbs.length) dbs.pop()!.cleanup();
});

const NOW = new Date('2026-10-06T12:00:00.000Z');

function freshDb() {
  const t = createTestDb();
  dbs.push(t);
  seedCurrencies(t.db);
  t.sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('demo','Демо','h','x')").run();
  return t;
}

/** Независимый пересчёт балансов в JS по сырым строкам операций. */
function jsBalances(t: ReturnType<typeof createTestDb>, companyId: number): Map<number, number> {
  const m = new Map<number, number>();
  const accounts = t.sqlite.prepare('SELECT id, starting_balance s FROM accounts WHERE company_id = ?').all(companyId) as { id: number; s: number }[];
  for (const a of accounts) m.set(a.id, a.s);
  const ops = t.sqlite
    .prepare("SELECT type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE company_id = ? AND deleted_at IS NULL AND status = 'actual'")
    .all(companyId) as { type: string; a: number; amount: number; t: number | null; ta: number | null }[];
  for (const o of ops) {
    m.set(o.a, m.get(o.a)! + (o.type === 'income' ? o.amount : -o.amount));
    if (o.type === 'transfer') m.set(o.t!, m.get(o.t!)! + o.ta!);
  }
  return m;
}

describe('seed:demo', () => {
  it('rng детерминирован', () => {
    const a = rng(7);
    const b = rng(7);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('состав по §10, доли разбиений и переводов, SQL-баланс = пересчёт в JS (§12)', () => {
    const t = freshDb();
    const r = seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 800 });
    expect(r).toMatchObject({ companies: 3, projects: 5, accounts: 8, counterparties: 150, operations: 800 });
    expect(r.categories).toBeGreaterThanOrEqual(60);
    const n = (sql: string) => (t.sqlite.prepare(sql).get() as { n: number }).n;
    const split = n('SELECT COUNT(*) n FROM (SELECT operation_id FROM operation_lines GROUP BY operation_id HAVING COUNT(*) > 1)');
    const transfers = n("SELECT COUNT(*) n FROM operations WHERE type = 'transfer'");
    expect(split / 800).toBeGreaterThan(0.08);
    expect(split / 800).toBeLessThan(0.25);
    expect(transfers / 800).toBeGreaterThan(0.04);
    expect(transfers / 800).toBeLessThan(0.16);
    expect(n("SELECT COUNT(*) n FROM accounts WHERE currency = 'USD'")).toBeGreaterThanOrEqual(2);

    const ledger = createLedgerBalances(t.db);
    for (const c of t.sqlite.prepare('SELECT id FROM companies').all() as { id: number }[]) {
      const js = jsBalances(t, c.id);
      for (const b of ledger.companyBalances(c.id)) expect(b.balance).toBe(js.get(b.accountId));
    }
  });

  it('детерминированность: два запуска на пустых базах дают одинаковые данные; по непустой базе — отказ без записей (Review Focus 4)', () => {
    const a = freshDb();
    const b = freshDb();
    seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    seedDemo({ db: b.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    const digest = (t: ReturnType<typeof createTestDb>) =>
      JSON.stringify(t.sqlite.prepare('SELECT type, paid_at, account_id, amount, to_amount, base_amount FROM operations ORDER BY id').all());
    expect(digest(a)).toBe(digest(b));

    const before = (a.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;
    expect(() => seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).toThrow('Демо-набор заливается только в пустую базу');
    expect((a.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n).toBe(before);
  });

  it('без пользователя — понятная ошибка', () => {
    const t = createTestDb();
    dbs.push(t);
    seedCurrencies(t.db);
    expect(() => seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).toThrow('Сначала создайте пользователя');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/demo.test.ts`
Expected: FAIL — нет модуля `scripts/lib/demo`.

- [ ] **Step 3: Implement**

`scripts/lib/demo.ts`:

```ts
import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../../src/server/db/client';
import { categories as categoriesTable, companies as companiesTable, exchangeRates, users } from '../../src/server/db/schema';
import { createAccountsService, type AccountRow } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createOperationsService, type LineInput, type OperationInput } from '../../src/server/modules/operations/service';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createOperationsReferences } from '../../src/server/modules/references/service';
import { COUNTERPARTY_TYPES, COUNTERPARTY_TYPE_SINGULAR } from '../../src/shared/counterparties';
import { addDays, todayInTimezone } from '../../src/shared/dates';
import { allocate } from '../../src/shared/money';

export interface DemoResult {
  companies: number;
  projects: number;
  accounts: number;
  categories: number;
  counterparties: number;
  operations: number;
}

/** Детерминированный генератор mulberry32: одинаковое зерно — одинаковая последовательность в [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  companyId: number;
  accounts: AccountRow[];
  income: number[];
  expense: number[];
  projects: number[];
  counterparties: number[];
}

/**
 * Демо-набор §10 через настоящие сервисы (те же инварианты и история): 3 компании, 5 проектов, 8 счетов,
 * не меньше 60 статей, 150 контрагентов, `operations` операций за 2 года. Только в пустую базу.
 */
export function seedDemo(d: { db: Db; timezone: string; now: Date; operations?: number }): DemoResult {
  const { db, timezone: tz } = d;
  const total = d.operations ?? 10_000;
  const now = () => d.now;
  const user = db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1).get();
  if (!user) throw new Error('Сначала создайте пользователя: npm run user:add');
  if ((db.select({ n: count() }).from(companiesTable).get()?.n ?? 0) > 0) {
    throw new Error('Демо-набор заливается только в пустую базу: в ней уже есть компании');
  }
  const uid = user.id;

  const audit = createAuditService(db, now);
  const references = createOperationsReferences(db, tz);
  const balances = createLedgerBalances(db);
  const categories = createCategoriesService({ db, audit, references, now });
  const accounts = createAccountsService({ db, audit, references, balances, timezone: tz, now });
  const companies = createCompaniesService({ db, audit, categories, accounts, now });
  const projects = createProjectsService({ db, audit, companies, categories, accounts, references, timezone: tz, now });
  const counterparties = createCounterpartiesService({ db, audit, references, now });
  const rates = createRatesService({ db, audit, now });
  const operations = createOperationsService({ db, audit, rates, timezone: tz, now });

  const random = rng(20261006);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const today = todayInTimezone(tz, d.now);
  const start = addDays(today, -730);

  // курсы USD к тенге на каждый день истории (и неделю до неё): детерминированная «волна» около 475
  db.transaction((tx) => {
    for (let i = -7; i <= 730; i++) {
      tx.insert(exchangeRates)
        .values({
          date: addDays(start, i),
          currency: 'USD',
          rateToKzt: (475 + 15 * Math.sin(i / 45)).toFixed(2),
          source: 'manual',
          createdBy: uid,
          fetchedAt: d.now.toISOString(),
        })
        .run();
    }
  });

  // компании и проекты
  const c1 = companies.create({ name: 'ТОО «Демо Клубы»', baseCurrency: 'KZT' }, uid);
  const c2 = companies.create({ name: 'ИП «Демо Бар»', baseCurrency: 'KZT' }, uid);
  const c3 = companies.create({ name: 'Demo Ltd', baseCurrency: 'USD' }, uid);
  projects.create(c1.id, { name: 'Клуб на Абая', templateKey: 'computer-club', templateParams: { pcCount: 40 } }, uid);
  projects.create(c1.id, { name: 'Клуб на Сатпаева', templateKey: 'computer-club', templateParams: { pcCount: 25, consoleCount: 4 } }, uid);
  projects.create(c1.id, { name: 'Склад', templateKey: 'general', templateParams: {} }, uid);
  const bar = projects.create(c2.id, { name: 'Бар', templateKey: 'general', templateParams: {} }, uid).project;
  projects.create(c3.id, { name: 'Офис', templateKey: 'general', templateParams: {} }, uid);

  // счета: шаблонные открыты «сегодня» — переносим открытие на начало истории; всего 8
  for (const a of accounts.list(c1.id)) accounts.update(c1.id, a.id, { openedAt: start, startingBalance: 1_000_000_00 }, uid);
  accounts.add(c1.id, { name: 'Валютный USD', currency: 'USD', openedAt: start, startingBalance: 5_000_00 }, uid);
  accounts.add(c2.id, { name: 'Касса бара', currency: 'KZT', openedAt: start, projectId: bar.id, startingBalance: 200_000_00 }, uid);
  accounts.add(c2.id, { name: 'Kaspi бара', currency: 'KZT', openedAt: start, projectId: bar.id }, uid);
  accounts.add(c3.id, { name: 'Счёт USD', currency: 'USD', openedAt: start, startingBalance: 10_000_00 }, uid);

  // статьи: шаблон клуба уже дал свои; добавляем статьи бару и офису, затем добираем до 60
  categories.add(c2.id, { kind: 'income', name: 'Выручка бара', parentId: null }, uid);
  for (const name of ['Закупка напитков', 'Закупка закусок', 'Аренда', 'Коммунальные услуги']) {
    categories.add(c2.id, { kind: 'expense', name, parentId: null }, uid);
  }
  categories.add(c3.id, { kind: 'income', name: 'Услуги', parentId: null }, uid);
  for (const name of ['Хостинг', 'Связь', 'Бухгалтерия']) categories.add(c3.id, { kind: 'expense', name, parentId: null }, uid);
  const categoryCount = () => db.select({ n: count() }).from(categoriesTable).get()?.n ?? 0;
  for (let i = 1; categoryCount() < 60; i++) categories.add(c3.id, { kind: 'expense', name: `Прочие расходы ${i}`, parentId: null }, uid);

  // контрагенты: 100 / 30 / 20
  for (const [companyId, n] of [
    [c1.id, 100],
    [c2.id, 30],
    [c3.id, 20],
  ] as const) {
    for (let i = 1; i <= n; i++) {
      const type = COUNTERPARTY_TYPES[i % COUNTERPARTY_TYPES.length]!;
      counterparties.add(companyId, { type, name: `${COUNTERPARTY_TYPE_SINGULAR[type]} ${String(i).padStart(3, '0')}` }, uid);
    }
  }

  const ctx = (companyId: number): Ctx => {
    const cats = db.select().from(categoriesTable).where(eq(categoriesTable.companyId, companyId)).all();
    return {
      companyId,
      accounts: accounts.list(companyId),
      income: cats.filter((c) => c.kind === 'income').map((c) => c.id),
      expense: cats.filter((c) => c.kind === 'expense').map((c) => c.id),
      projects: projects.list(companyId).map((p) => p.id),
      counterparties: counterparties.list(companyId).map((c) => c.id),
    };
  };
  const ctxs = [ctx(c1.id), ctx(c2.id), ctx(c3.id)];

  // операции: 70 % / 20 % / 10 % по компаниям, ~10 % переводов, ~15 % разбитых, ~1 % удалённых
  for (let i = 0; i < total; i++) {
    const r = random();
    const c = r < 0.7 ? ctxs[0]! : r < 0.9 ? ctxs[1]! : ctxs[2]!;
    const date = addDays(start, int(1, 730));
    const at = new Date(`${date}T${String(int(4, 16)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00.000Z`);
    const paidAt = (at > d.now ? d.now : at).toISOString();
    const account = pick(c.accounts);
    const minor = account.currency === 'USD' ? int(10, 2_000) * 100 : int(1_000, 200_000) * 100;
    const kindRoll = random();
    let input: OperationInput;
    if (kindRoll < 0.1 && c.accounts.length > 1) {
      const to = pick(c.accounts.filter((a) => a.id !== account.id));
      const toAmount =
        to.currency === account.currency ? null : account.currency === 'KZT' ? Math.max(1, Math.round(minor / 475)) : minor * 475;
      const lines: LineInput[] = random() < 0.3 ? [{ categoryId: null, projectId: pick(c.projects), amount: minor }] : [];
      input = { type: 'transfer', paidAt, accrualDate: null, accountId: account.id, amount: minor, toAccountId: to.id, toAmount, counterpartyId: null, comment: null, lines, tagIds: [] };
    } else {
      const type = kindRoll < 0.45 ? 'income' : 'expense';
      const cats = type === 'income' ? c.income : c.expense;
      let lines: LineInput[];
      if (random() < 0.15) {
        const parts = allocate(minor, Array.from({ length: int(2, 3) }, () => int(1, 5)));
        lines = parts.map((amount) => ({ categoryId: pick(cats), projectId: pick(c.projects), amount }));
      } else {
        lines = [{ categoryId: random() < 0.9 ? pick(cats) : null, projectId: random() < 0.8 ? pick(c.projects) : null, amount: minor }];
      }
      input = {
        type,
        paidAt,
        accrualDate: null,
        accountId: account.id,
        amount: minor,
        toAccountId: null,
        toAmount: null,
        counterpartyId: random() < 0.6 ? pick(c.counterparties) : null,
        comment: random() < 0.2 ? `Демо-операция ${i + 1}` : null,
        lines,
        tagIds: [],
      };
    }
    const op = operations.create(c.companyId, input, uid);
    if (random() < 0.01) operations.remove(c.companyId, op.id, uid);
  }

  return {
    companies: 3,
    projects: ctxs.reduce((s, x) => s + x.projects.length, 0),
    accounts: ctxs.reduce((s, x) => s + x.accounts.length, 0),
    categories: categoryCount(),
    counterparties: ctxs.reduce((s, x) => s + x.counterparties.length, 0),
    operations: total,
  };
}
```

`scripts/seed-demo.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { isLockHeld } from '../src/server/lock';
import { createBackupService } from '../src/server/modules/backup/service';
import { seedDemo } from './lib/demo';

// Демо-набор §10 для проверки и замеров: npm run seed:demo [-- <число операций, по умолчанию 10000>]
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (isLockHeld(config.lockPath)) {
  console.error('Приложение запущено — остановите его перед заливкой демо-набора.');
  process.exit(1);
}
const count = Number(process.argv[2] ?? 10_000);
if (!Number.isInteger(count) || count < 1) {
  console.error('Число операций — целое больше нуля.');
  process.exit(1);
}
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.backupsDir, { recursive: true });
const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
try {
  migrateWithBackup({
    db,
    sqlite,
    dbExisted,
    backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
  });
  seedCurrencies(db);
  // тысячи коротких транзакций без fsync на каждую; для демо-набора это допустимо
  sqlite.pragma('synchronous = OFF');
  const started = Date.now();
  const r = seedDemo({ db, timezone: config.timezone, now: new Date(), operations: count });
  console.log(
    `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с: компаний ${r.companies}, проектов ${r.projects}, счетов ${r.accounts}, ` +
      `статей ${r.categories}, контрагентов ${r.counterparties}, операций ${r.operations}.`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
```

`package.json` — в `scripts` после `user:passwd`:

```json
    "seed:demo": "tsx scripts/seed-demo.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/demo.test.ts`
Expected: PASS. Если тест длиннее 15 с (`testTimeout`), уменьшите число операций в тестах, а не увеличивайте таймаут.

- [ ] **Step 5: Full check, manual run and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

Ручная проверка на временной папке данных (рабочую базу не трогает; в Git Bash) — запуск без пользователя:

```bash
DATA_DIR=$(mktemp -d) SESSION_SECRET=$(printf 'd%.0s' {1..40}) npm run seed:demo -- 50
```

Expected: сообщение «Сначала создайте пользователя: npm run user:add» и код выхода 1.

```bash
git add scripts/lib/demo.ts scripts/seed-demo.ts package.json tests/server/demo.test.ts
git commit -m "feat: seed:demo — детерминированный демо-набор §10 и сверка SQL-балансов с пересчётом в JS

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Левая панель счетов и итоги в переключателе компаний

**Files:**
- Create: `src/client/lib/accounts-panel.ts`, `src/client/components/AccountsPanel.tsx`, `tests/client/accounts-panel.test.ts`, `e2e/money.spec.ts`
- Modify: `src/shared/money.ts`, `tests/shared/money.test.ts`, `src/client/lib/queries.ts`, `src/client/pages/CompanyLayout.tsx`, `src/client/components/CompanySwitcher.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/v1/companies/:cid/balances` → `{ accounts: [{ accountId, currency, balance }], total: { currency, amount, unavailable } }` (план 4a);
  - `GET /api/v1/companies/summary` → `{ companies: [{ id, name, total }] }` (план 4a);
  - флаги `currencyLocked` и `hasOperations` (Task 1);
  - `usePreferences`, `savePreference` (план 3b).
- Produces:
  - `formatMoney(minor, currency): string` — «1 500,50 ₸» (сумма, неразрывный пробел, символ валюты);
  - типы `Company.currencyLocked`, `Account.hasOperations`, `CompanyTotal`, `Balances`, `CompanySummary`;
  - `useBalances(companyId)` — ключ `['accounts', companyId, 'balances']`. Это продолжение ключа счетов: каждое обновление `['accounts', cid]` на экранах «Счета» и «Проекты» обновляет и балансы, править эти экраны не нужно;
  - `useCompaniesSummary(enabled)` — ключ `['companies', 'summary']`, обновляется вместе со списком компаний;
  - `groupAccounts(accounts, projects): AccountGroup[]`;
  - `AccountsPanel` — `<nav aria-label="Счета">`: кнопки «Свернуть панель счетов» и «Развернуть панель счетов», ссылки счетов `/c/:cid/log?account=<id>`, ссылка «+ счёт».

- [ ] **Step 1: Write the failing tests**

`tests/shared/money.test.ts` — добавьте `formatMoney` в импорт из `../../src/shared/money` и блок в конец файла:

```ts
describe('formatMoney', () => {
  it('сумма с символом валюты через неразрывный пробел', () => {
    expect(formatMoney(150050, 'KZT')).toBe('1\u202F500,50\u00A0₸');
    expect(formatMoney(-500, 'USD')).toBe('\u22125,00\u00A0$');
    expect(formatMoney(1000, 'JPY')).toBe('1\u202F000\u00A0¥');
  });
});
```

`tests/client/accounts-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupAccounts } from '../../src/client/lib/accounts-panel';
import type { Account, Project } from '../../src/client/lib/queries';

const account = (id: number, projectId: number | null, archived = false): Account => ({
  id,
  companyId: 1,
  projectId,
  name: `Счёт ${id}`,
  currency: 'KZT',
  startingBalance: 0,
  openedAt: '2026-10-01',
  orderIndex: id,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: archived ? '2026-10-02T00:00:00.000Z' : null,
  hasOperations: false,
});
const project = (id: number, name: string): Project => ({
  id,
  companyId: 1,
  name,
  templateKey: 'general',
  templateParams: {},
  orderIndex: id,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
});

describe('groupAccounts', () => {
  it('«Общие», затем проекты в их порядке; архивные счета и пустые группы скрыты', () => {
    const groups = groupAccounts(
      [account(1, 20), account(2, null), account(3, 10), account(4, null, true), account(5, 30, true)],
      [project(20, 'Клуб 2'), project(10, 'Клуб 1'), project(30, 'Склад')],
    );
    expect(groups.map((g) => [g.title, g.items.map((a) => a.id)])).toEqual([
      ['Общие', [2]],
      ['Клуб 2', [1]],
      ['Клуб 1', [3]],
    ]);
  });

  it('нет активных счетов — нет групп', () => {
    expect(groupAccounts([account(1, null, true)], [])).toEqual([]);
  });
});
```

`e2e/money.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
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

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

test('левая панель: балансы и итог, переход в журнал, свёрнутая панель остаётся свёрнутой; итоги в переключателе', async ({ page }) => {
  await login(page);
  const name = `ТОО Панель ${Date.now()}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const safe = (await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 50000 });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: minuteAgo(), accountId: kaspi, toAccountId: safe, amount: 20000 });

  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*1\s500,00\s₸/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/1\s300,00\s₸/);
  await expect(panel.getByRole('link', { name: /^Сейф/ })).toContainText(/200,00\s₸/);
  await expect(panel).toContainText('Общие');

  await panel.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));

  // переключатель: у компании — её итог
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await expect(page.getByRole('menuitem', { name })).toContainText(/1\s500,00\s₸/);
  await page.keyboard.press('Escape');

  // свернуть — и после перезагрузки панель свёрнута (Review Focus 5)
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Свернуть панель счетов' }).click();
  await saved;
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);
  await page.reload();
  await expect(panel.getByRole('button', { name: 'Развернуть панель счетов' })).toBeVisible();
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);

  // развернуть обратно: настройка общая для пользователя admin и остальных e2e
  const restored = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Развернуть панель счетов' }).click();
  await restored;
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/money.test.ts tests/client/accounts-panel.test.ts`
Expected: FAIL — нет `formatMoney`, нет модуля `accounts-panel`.

- [ ] **Step 3: Implement**

`src/shared/money.ts` — импорт в начало файла и функция в конец:

```ts
import { getCurrency } from './currencies';
```

```ts
/** Сумма с символом валюты: «1 500,50 ₸» — неразрывный пробел не даёт символу уехать на другую строку. */
export function formatMoney(minor: number, currency: string): string {
  const c = getCurrency(currency);
  return `${formatAmount(minor, c.minorUnits)}\u00A0${c.symbol}`;
}
```

`src/client/lib/queries.ts`:
- в `Company` после `archivedAt` добавьте поле:

```ts
  /** Базовую валюту менять нельзя: есть операции или фиксированные курсы (§4.2). */
  currencyLocked: boolean;
```

- в `Account` после `archivedAt` добавьте поле:

```ts
  /** По счёту есть операции (включая удалённые) — валюту менять нельзя (§4.4). */
  hasOperations: boolean;
```

- после `useAccounts` добавьте:

```ts
export interface CompanyTotal {
  currency: string;
  amount: number;
  /** Валюты счетов без курса на сегодня: в итог не вошли. */
  unavailable: string[];
}

export interface Balances {
  accounts: { accountId: number; currency: string; balance: number }[];
  total: CompanyTotal;
}

/** Ключ — продолжение ключа счетов: обновление ['accounts', cid] обновляет и балансы. */
export function useBalances(companyId: number) {
  return useQuery<Balances, ApiError>({
    queryKey: ['accounts', companyId, 'balances'],
    queryFn: () => api<Balances>(`/companies/${companyId}/balances`),
  });
}

export interface CompanySummary {
  id: number;
  name: string;
  total: CompanyTotal;
}

/** Итоги компаний для переключателя; запрашиваются при открытии меню. */
export function useCompaniesSummary(enabled: boolean) {
  return useQuery<CompanySummary[], ApiError>({
    queryKey: ['companies', 'summary'],
    queryFn: async () => (await api<{ companies: CompanySummary[] }>('/companies/summary')).companies,
    enabled,
  });
}
```

Новые обязательные поля `Company.currencyLocked` и `Account.hasOperations` могут сломать проверку типов там, где объекты `Company` или `Account` собираются вручную (тесты `tests/client`). Добавьте туда `currencyLocked: false` и `hasOperations: false`.

`src/client/lib/accounts-panel.ts`:

```ts
import type { Account, Project } from './queries';

export interface AccountGroup {
  key: string;
  title: string;
  items: Account[];
}

/** Группы левой панели (§7): «Общие», затем проекты в их порядке; архивные счета и пустые группы не показываются. */
export function groupAccounts(accounts: Account[], projects: Project[]): AccountGroup[] {
  const active = accounts.filter((a) => !a.archivedAt);
  return [
    { key: 'common', title: 'Общие', items: active.filter((a) => a.projectId === null) },
    ...projects.map((p) => ({ key: String(p.id), title: p.name, items: active.filter((a) => a.projectId === p.id) })),
  ].filter((g) => g.items.length > 0);
}
```

`src/client/components/AccountsPanel.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney } from '../../shared/money';
import { groupAccounts } from '../lib/accounts-panel';
import { savePreference, useAccounts, useBalances, usePreferences, useProjects, type Company } from '../lib/queries';
import { btnIcon, btnSmall } from './ui';

const PREF_KEY = 'sidebar.collapsed';

/**
 * Левая панель (§7): «Всего на счетах» в базовой валюте и счета по группам с балансами; сворачивается,
 * состояние — в настройках пользователя. Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 * На узком экране скрыта (мобильная версия — шаг 7).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const prefs = usePreferences();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  // выбор виден сразу; сохраняется в фоне, сбой сохранения не мешает работе
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? prefs.data?.[PREF_KEY] === true;
  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    savePreference(PREF_KEY, next).catch(() => undefined);
  };

  if (collapsed) {
    return (
      <nav aria-label="Счета" className="hidden shrink-0 md:block">
        <button type="button" aria-expanded={false} aria-label="Развернуть панель счетов" onClick={toggle} className={btnIcon}>
          <span aria-hidden="true">»</span>
        </button>
      </nav>
    );
  }

  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;

  return (
    <nav aria-label="Счета" className="hidden w-64 shrink-0 self-start rounded-3xl bg-card p-4 md:block">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">Всего на счетах</p>
          <p className="truncate text-xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency) : '…'}</p>
          {total?.unavailable.map((code) => (
            <p key={code} className="text-xs text-expense">
              курс {code} недоступен
            </p>
          ))}
        </div>
        <button type="button" aria-expanded={true} aria-label="Свернуть панель счетов" onClick={toggle} className={btnIcon}>
          <span aria-hidden="true">«</span>
        </button>
      </div>
      {failed && (
        <p className="mb-2 text-xs text-expense">
          Не удалось загрузить счета.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void balances.refetch();
              void accounts.refetch();
              void projects.refetch();
            }}
          >
            Повторить
          </button>
        </p>
      )}
      {groups.map((g) => (
        <div key={g.key} className="mb-3">
          <p className="mb-1 truncate px-2 text-xs font-semibold text-muted">{g.title}</p>
          {g.items.map((a) => {
            const balance = balanceOf.get(a.id);
            return (
              <Link
                key={a.id}
                to={`/c/${company.id}/log?account=${a.id}`}
                className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field"
              >
                <span className="truncate">{a.name}</span>
                <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense' : ''}`}>
                  {balance === undefined ? '…' : formatMoney(balance, a.currency)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      <Link to={`/c/${company.id}/settings/accounts`} className={`${btnSmall} inline-block`}>
        + счёт
      </Link>
    </nav>
  );
}
```

`src/client/pages/CompanyLayout.tsx` — импорт `AccountsPanel` и разметка под шапкой:

```tsx
import { AccountsPanel } from '../components/AccountsPanel';
```

Замените блок `<main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-6 md:p-8"> … </main>` на:

```tsx
      <div className="mx-4 flex items-start gap-4">
        <AccountsPanel company={company} />
        <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-6 md:p-8">
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
```

`src/client/components/CompanySwitcher.tsx`:
- импорты:

```tsx
import { formatMoney } from '../../shared/money';
import { useCompaniesSummary, type Company } from '../lib/queries';
```

(вместо `import type { Company } from '../lib/queries';`);
- рядом с `itemClass`:

```tsx
const companyItemClass =
  'flex w-full items-baseline justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-field focus:bg-field focus:outline-none';
```

- в теле компонента после `const active = …`:

```tsx
  // итоги — при открытии меню: свежие, без запросов на каждой странице
  const summary = useCompaniesSummary(open);
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));
```

- кнопка компании в меню (доступное имя по-прежнему начинается с названия компании):

```tsx
          {active.map((c) => {
            const t = totals.get(c.id);
            return (
              <button
                key={c.id}
                role="menuitem"
                type="button"
                tabIndex={-1}
                data-current={c.id === current.id}
                aria-current={c.id === current.id ? 'true' : undefined}
                onClick={() => choose(c)}
                className={`${companyItemClass} ${c.id === current.id ? 'font-semibold' : ''}`}
              >
                <span className="truncate">{c.name}</span>
                {t && (
                  <span className="shrink-0 text-xs font-normal tabular-nums text-muted">
                    {formatMoney(t.amount, t.currency)}
                    {t.unavailable.length > 0 && ` · без ${t.unavailable.join(', ')}`}
                  </span>
                )}
              </button>
            );
          })}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/money.test.ts tests/client/accounts-panel.test.ts`
Expected: PASS.

Run: `npm run test:e2e`
Expected: PASS — новый `e2e/money.spec.ts` и все прежние (панель не добавляет ролей, которые ищут прежние тесты).

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/money.ts tests/shared/money.test.ts src/client tests/client e2e/money.spec.ts
git commit -m "feat: левая панель счетов с балансами и итоги компаний в переключателе

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Экран «Курсы»: фиксированные курсы компании и ручные курсы на дату

**Files:**
- Create: `src/client/pages/settings/RatesSettings.tsx`
- Modify: `src/client/lib/queries.ts`, `src/client/pages/settings/SettingsNav.tsx`, `src/client/router.tsx`, `e2e/money.spec.ts`

**Interfaces:**
- Consumes:
  - `GET/POST /api/v1/rates/manual`, `PATCH/DELETE /api/v1/rates/manual/:id` — строки `{ id, date, currency, rateToKzt, source, createdBy, fetchedAt }`;
  - `GET/POST /api/v1/companies/:cid/fixed-rates`, `PATCH/DELETE …/:id` — строки `{ id, companyId, currency, rate, validFrom, validTo }`;
  - ошибки полей: `date`, `currency`, `rate`, `validFrom`, `validTo` (план 4a).
- Produces:
  - `useManualRates()` (ключ `['rates-manual']`), `useFixedRates(companyId)` (ключ `['fixed-rates', companyId]`), типы `ManualRate`, `FixedRate`;
  - экран `/c/:cid/settings/rates`, пункт «Курсы» в навигации настроек после «Шаблоны разделения»;
  - разметка экрана:
    - две области: «Фиксированные курсы компании» и «Ручные курсы на дату»;
    - формы добавления — `role="form"` с именами «Новый фиксированный курс» и «Новый курс на дату»;
    - строки — `listitem`.

- [ ] **Step 1: Write the failing e2e test**

В конец `e2e/money.spec.ts`:

```ts
const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('курсы: валюта без курса — предупреждение; фиксированный курс включает её в итог; ручные курсы на дату', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Курсы ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Евро-счёт', currency: 'EUR', openedAt: '2020-01-01', startingBalance: 1000 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  // Review Focus 1: валюта без курса не входит в итог, под итогом — предупреждение
  await expect(panel).toContainText('курс EUR недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*0,00\s₸/);
  await expect(panel.getByRole('link', { name: /^Евро-счёт/ })).toContainText(/10,00\s€/);

  await page.getByRole('link', { name: 'Настройки' }).click();
  await section(page, 'Курсы').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  // фиксированный курс компании
  const fixed = page.getByRole('region', { name: 'Фиксированные курсы компании' });
  const fixedForm = fixed.getByRole('form', { name: 'Новый фиксированный курс' });
  await fixedForm.getByLabel('Валюта').selectOption('EUR');
  await fixedForm.getByLabel('Курс к KZT').fill('500');
  await fixedForm.getByLabel('Действует с').fill('2020-01-01');
  await fixedForm.getByRole('button', { name: 'Добавить курс' }).click();
  const fixedRow = fixed.getByRole('listitem').filter({ hasText: 'EUR' });
  await expect(fixedRow).toContainText('1 EUR = 500 KZT');
  await expect(fixedRow).toContainText('с 01.01.2020, бессрочно');
  await expect(panel).not.toContainText('недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*5\s000,00\s₸/);

  await fixedRow.getByRole('button', { name: 'Изменить' }).click();
  await fixedRow.getByLabel('Курс 1 EUR').fill('510');
  await fixedRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(fixedRow).toContainText('1 EUR = 510 KZT');
  await expect(panel).toContainText(/Всего на счетах\s*5\s100,00\s₸/);

  // ручной курс на дату: добавить, изменить, удалить
  const manual = page.getByRole('region', { name: 'Ручные курсы на дату' });
  const manualForm = manual.getByRole('form', { name: 'Новый курс на дату' });
  await manualForm.getByLabel('Дата').fill('2020-03-15');
  await manualForm.getByLabel('Валюта').selectOption('GBP');
  await manualForm.getByLabel('Курс к тенге').fill('520,5');
  await manualForm.getByRole('button', { name: 'Добавить курс' }).click();
  const manualRow = manual.getByRole('listitem').filter({ hasText: '15.03.2020' });
  await expect(manualRow).toContainText('GBP');
  await expect(manualRow).toContainText('520,5');

  await manualRow.getByRole('button', { name: 'Изменить' }).click();
  await manualRow.getByLabel('Курс к тенге').fill('521');
  await manualRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(manualRow).toContainText('1 GBP = 521 KZT');

  await manualRow.getByRole('button', { name: 'Удалить' }).click();
  await manualRow.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(manual.getByRole('listitem').filter({ hasText: '15.03.2020' })).toHaveCount(0);

  // ошибка поля из сервера: неверный курс
  await manualForm.getByLabel('Дата').fill('2020-03-16');
  await manualForm.getByLabel('Курс к тенге').fill('abc');
  await manualForm.getByRole('button', { name: 'Добавить курс' }).click();
  await expect(manualForm.getByLabel('Курс к тенге')).toHaveAttribute('aria-invalid', 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/money.spec.ts -g "курсы"`
Expected: FAIL — в навигации настроек нет ссылки «Курсы».

- [ ] **Step 3: Implement**

`src/client/lib/queries.ts` — после `useCompaniesSummary`:

```ts
export interface ManualRate {
  id: number;
  date: string;
  currency: string;
  /** Курс за 1 единицу валюты в тенге, десятичная строка с точкой. */
  rateToKzt: string;
  source: 'nbrk' | 'manual';
  createdBy: number | null;
  fetchedAt: string;
}

export function useManualRates() {
  return useQuery<ManualRate[], ApiError>({
    queryKey: ['rates-manual'],
    queryFn: async () => (await api<{ rates: ManualRate[] }>('/rates/manual')).rates,
  });
}

export interface FixedRate {
  id: number;
  companyId: number;
  currency: string;
  /** Курс к базовой валюте компании, десятичная строка с точкой. */
  rate: string;
  validFrom: string;
  validTo: string | null;
}

export function useFixedRates(companyId: number) {
  return useQuery<FixedRate[], ApiError>({
    queryKey: ['fixed-rates', companyId],
    queryFn: async () => (await api<{ fixedRates: FixedRate[] }>(`/companies/${companyId}/fixed-rates`)).fixedRates,
  });
}
```

`src/client/pages/settings/RatesSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useFixedRates, useManualRates } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

/** Курс для показа — с десятичной запятой, как его вводят. */
const showRate = (rate: string) => rate.replace('.', ',');

/** Курсы меняют «Всего на счетах» и блокировку валют: обновляем балансы всех компаний и список компаний со сводкой. */
const refreshTotals = () =>
  Promise.all([
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'accounts' && q.queryKey[2] === 'balances' }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);

/** Ошибка без привязки к полю — общим сообщением; ошибки полей показывают сами поля. */
const generalError = (...errors: (ApiError | null)[]) => errors.find((e) => e && !e.fields) ?? null;

const MANUAL_PAGE = 100;

function FixedRatesSection({ companyId, baseCurrency, readOnly }: { companyId: number; baseCurrency: string; readOnly: boolean }) {
  const rates = useFixedRates(companyId);
  const base = `/companies/${companyId}/fixed-rates`;
  const choices = CURRENCIES.filter((c) => c.code !== baseCurrency);
  const [currency, setCurrency] = useState(baseCurrency === 'USD' ? 'EUR' : 'USD');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ rate: '', validFrom: '', validTo: '' });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['fixed-rates', companyId] }), refreshTotals()]);

  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api(base, { method: 'POST', body: { currency, rate, validFrom, validTo: validTo || null } }),
    onSuccess: async () => {
      await refresh();
      setRate('');
      setValidFrom('');
      setValidTo('');
    },
  });
  const update = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}`, { method: 'PATCH', body: { rate: edit.rate, validFrom: edit.validFrom, validTo: edit.validTo || null } }),
    onSuccess: async () => {
      await refresh();
      setEditingId(null);
    },
  });
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeletingId(null);
      await refresh();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    remove.reset();
  };
  const error = generalError(create.error, update.error, remove.error);

  return (
    <section aria-labelledby="fixed-rates-title" className="mb-10">
      <h2 id="fixed-rates-title" className="mb-1 text-xl font-bold">
        Фиксированные курсы компании
      </h2>
      <p className="mb-4 text-sm text-muted">Курс валюты к {baseCurrency} на период. Пока он действует, курс на дату для этой компании не используется.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          {rates.data.length === 0 && <p className="mb-4 text-muted">Фиксированных курсов нет.</p>}
          <ul className="mb-4 space-y-2">
            {rates.data.map((r) => (
              <li key={r.id} className="rounded-2xl border border-field px-4 py-3">
                {editingId === r.id ? (
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(r.id);
                    }}
                    className="flex flex-wrap items-start gap-2"
                  >
                    <Field label={`Курс 1 ${r.currency}`} error={update.error?.fields?.rate} className="w-40">
                      {(c) => <input {...c} autoFocus inputMode="decimal" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} className={inputClass} />}
                    </Field>
                    <Field label="Действует с" error={update.error?.fields?.validFrom} className="w-44">
                      {(c) => <input {...c} type="date" value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} className={inputClass} />}
                    </Field>
                    <Field label="Действует по" hint="Пусто — бессрочно" error={update.error?.fields?.validTo} className="w-44">
                      {(c) => <input {...c} type="date" value={edit.validTo} onChange={(e) => setEdit({ ...edit, validTo: e.target.value })} className={inputClass} />}
                    </Field>
                    <div className="flex gap-2 md:mt-6">
                      <button type="submit" disabled={update.isPending} className={btnPrimary}>
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          update.reset();
                        }}
                        className={btnSecondary}
                      >
                        Отмена
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold">
                        1 {r.currency} = {showRate(r.rate)} {baseCurrency}
                      </span>{' '}
                      <span className="text-muted">
                        {r.validTo ? `с ${formatDateRu(r.validFrom)} по ${formatDateRu(r.validTo)}` : `с ${formatDateRu(r.validFrom)}, бессрочно`}
                      </span>
                    </span>
                    {!readOnly &&
                      (deletingId === r.id ? (
                        <ConfirmDelete
                          what={`фиксированный курс ${r.currency}`}
                          pending={remove.isPending}
                          onConfirm={() => remove.mutate(r.id)}
                          onCancel={() => setDeletingId(null)}
                        />
                      ) : (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setEdit({ rate: showRate(r.rate), validFrom: r.validFrom, validTo: r.validTo ?? '' });
                              setEditingId(r.id);
                            }}
                            className={btnSmall}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setDeletingId(r.id);
                            }}
                            className={btnSmall}
                          >
                            Удалить
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && (
        <form
          aria-label="Новый фиксированный курс"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            resetMessages();
            create.mutate();
          }}
          className="flex flex-wrap items-start gap-2"
        >
          <Field label="Валюта" error={create.error?.fields?.currency} className="w-56">
            {(c) => (
              <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {choices.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`Курс к ${baseCurrency}`} error={create.error?.fields?.rate} className="w-40">
            {(c) => <input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Действует с" error={create.error?.fields?.validFrom} className="w-44">
            {(c) => <input {...c} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Действует по" hint="Пусто — бессрочно" error={create.error?.fields?.validTo} className="w-44">
            {(c) => <input {...c} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} />}
          </Field>
          <button type="submit" disabled={create.isPending} className={`${btnPrimary} md:mt-6`}>
            Добавить курс
          </button>
        </form>
      )}
    </section>
  );
}

function ManualRatesSection() {
  const rates = useManualRates();
  const choices = CURRENCIES.filter((c) => c.code !== 'KZT');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(MANUAL_PAGE);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRate, setEditRate] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rates-manual'] }), refreshTotals()]);

  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api('/rates/manual', { method: 'POST', body: { date, currency, rate } }),
    onSuccess: async () => {
      await refresh();
      setRate('');
    },
  });
  const update = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`/rates/manual/${id}`, { method: 'PATCH', body: { rate: editRate } }),
    onSuccess: async () => {
      await refresh();
      setEditingId(null);
    },
  });
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`/rates/manual/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeletingId(null);
      await refresh();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    remove.reset();
  };
  const error = generalError(create.error, update.error, remove.error);
  // новые даты сверху; при равной дате — по коду валюты
  const list = [...(rates.data ?? [])]
    .filter((r) => !filter || r.currency === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));

  return (
    <section aria-labelledby="manual-rates-title">
      <h2 id="manual-rates-title" className="mb-1 text-xl font-bold">
        Ручные курсы на дату
      </h2>
      <p className="mb-4 text-sm text-muted">
        Курс к тенге на дату — общий для всех компаний. Если на дату курса нет, берётся ближайший предыдущий, не старше 7 дней.
      </p>
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      <form
        aria-label="Новый курс на дату"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          resetMessages();
          create.mutate();
        }}
        className="mb-4 flex flex-wrap items-start gap-2"
      >
        <Field label="Дата" error={create.error?.fields?.date} className="w-44">
          {(c) => <input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Валюта" error={create.error?.fields?.currency} className="w-56">
          {(c) => (
            <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
              {choices.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} — {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Курс к тенге" error={create.error?.fields?.rate} className="w-40">
          {(c) => <input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />}
        </Field>
        <button type="submit" disabled={create.isPending} className={`${btnPrimary} md:mt-6`}>
          Добавить курс
        </button>
      </form>
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          <Field label="Показать валюту" className="mb-3 w-56">
            {(c) => (
              <select
                {...c}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setShown(MANUAL_PAGE);
                }}
                className={inputClass}
              >
                <option value="">Все валюты</option>
                {[...new Set(rates.data.map((r) => r.currency))].sort().map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {list.length === 0 && <p className="text-muted">Курсов нет.</p>}
          <ul className="space-y-2">
            {list.slice(0, shown).map((r) => (
              <li key={r.id} className="rounded-2xl border border-field px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="text-muted">{formatDateRu(r.date)}</span>{' '}
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rateToKzt)} KZT
                    </span>
                    {r.source === 'nbrk' && <span className="ml-2 text-xs text-muted">Нацбанк</span>}
                  </span>
                  {editingId === r.id ? (
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        update.mutate(r.id);
                      }}
                      className="flex flex-wrap items-start gap-2"
                    >
                      <Field label="Курс к тенге" error={update.error?.fields?.rate} className="w-40">
                        {(c) => <input {...c} autoFocus inputMode="decimal" value={editRate} onChange={(e) => setEditRate(e.target.value)} className={inputClass} />}
                      </Field>
                      <div className="flex gap-2 md:mt-6">
                        <button type="submit" disabled={update.isPending} className={btnPrimary}>
                          Сохранить
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            update.reset();
                          }}
                          className={btnSecondary}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : deletingId === r.id ? (
                    <ConfirmDelete
                      what={`курс ${r.currency} на ${formatDateRu(r.date)}`}
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(r.id)}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setEditRate(showRate(r.rateToKzt));
                          setEditingId(r.id);
                        }}
                        className={btnSmall}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(r.id);
                        }}
                        className={btnSmall}
                      >
                        Удалить
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" onClick={() => setShown(shown + MANUAL_PAGE)} className={`${btnSecondary} mt-3`}>
              Показать ещё ({list.length - shown})
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function RatesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <h1 className="mb-4 text-2xl font-bold">Курсы валют</h1>
      <FixedRatesSection
        key={company.id}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        readOnly={company.archivedAt !== null}
      />
      <ManualRatesSection />
    </section>
  );
}
```

`src/client/pages/settings/SettingsNav.tsx` — в `SECTIONS` после `split-presets`:

```ts
  { path: 'rates', label: 'Курсы' },
```

`src/client/router.tsx` — импорт и маршрут после `settings/split-presets`:

```tsx
import { RatesSettings } from './pages/settings/RatesSettings';
```

```tsx
          { path: 'settings/rates', element: <RatesSettings /> },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:e2e`
Expected: PASS — оба теста `e2e/money.spec.ts` и все прежние.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/client e2e/money.spec.ts
git commit -m "feat: экран «Курсы» — фиксированные курсы компании и ручные курсы на дату

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Блокировка валют в формах и подписи новых сущностей в истории

**Files:**
- Modify: `src/client/components/AccountForm.tsx`, `src/client/pages/settings/AccountsSettings.tsx`, `src/client/pages/settings/CompaniesSettings.tsx`, `src/client/lib/audit-format.ts`, `src/client/pages/settings/AuditSettings.tsx`, `tests/client/audit-format.test.ts`, `e2e/money.spec.ts`

**Interfaces:**
- Consumes: `Account.hasOperations`, `Company.currencyLocked` (Task 4); сущности истории `operation`, `fixed_rate`, `attachment` (с компанией) и `rate` (без компании) — планы 4a и 4b.
- Produces:
  - `AccountForm` с необязательным свойством `currencyLocked`;
  - `SYSTEM_ENTITIES = ['user', 'rate']`;
  - `COMPANY_ENTITIES` дополнены `operation`, `fixed_rate`, `attachment`.

- [ ] **Step 1: Write the failing tests**

`tests/client/audit-format.test.ts` — импорт:

```ts
import { COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';
```

и тест в блок `describe('audit-format', …)`:

```ts
  it('у каждой сущности фильтров есть подпись; операции, курсы и вложения — в своих лентах', () => {
    for (const e of [...COMPANY_ENTITIES, ...SYSTEM_ENTITIES]) expect(ENTITY_LABELS[e]).toBeTruthy();
    expect(ENTITY_LABELS).toMatchObject({ operation: 'Операция', rate: 'Курс', fixed_rate: 'Фиксированный курс', attachment: 'Вложение' });
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment']));
    expect(SYSTEM_ENTITIES).toEqual(['user', 'rate']);
  });
```

В конец `e2e/money.spec.ts`:

```ts
test('валюта счёта с операциями и базовая валюта компании с операциями заблокированы', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const freeName = `ТОО Без операций ${stamp}`;
  await createCompany(page, freeName);
  const name = `ТОО Валюта ${stamp}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Пустой', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 100 });

  await page.goto(`/c/${cid}/settings/accounts`);
  const row = page.getByRole('listitem').filter({ hasText: 'Kaspi' });
  await row.getByRole('button', { name: 'Изменить' }).click();
  await expect(row.getByLabel('Валюта')).toBeDisabled();
  await expect(row).toContainText('По счёту есть операции — валюту изменить нельзя');
  await row.getByRole('button', { name: 'Отмена' }).click();
  const empty = page.getByRole('listitem').filter({ hasText: 'Пустой' });
  await empty.getByRole('button', { name: 'Изменить' }).click();
  await expect(empty.getByLabel('Валюта')).toBeEnabled();
  await empty.getByRole('button', { name: 'Отмена' }).click();

  await page.goto(`/c/${cid}/settings/companies`);
  const locked = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await expect(locked.getByLabel('Базовая валюта')).toBeDisabled();
  await expect(locked).toContainText('В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
  const free = page.getByRole('listitem').filter({ has: page.locator(`input[value="${freeName}"]`) });
  await expect(free.getByLabel('Базовая валюта')).toBeEnabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: FAIL — нет `SYSTEM_ENTITIES`, нет подписей.

Run: `npx playwright test e2e/money.spec.ts -g "заблокированы"`
Expected: FAIL — поле валюты доступно.

- [ ] **Step 3: Implement**

`src/client/lib/audit-format.ts`:
- в `ENTITY_LABELS` после `user`:

```ts
  operation: 'Операция',
  rate: 'Курс',
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
```

- списки сущностей:

```ts
/** Сущности ленты компании (для фильтра). */
export const COMPANY_ENTITIES = [
  'company',
  'project',
  'account',
  'category',
  'counterparty',
  'tag',
  'split_preset',
  'operation',
  'fixed_rate',
  'attachment',
] as const;

/** Сущности общей ленты экземпляра (записи без компании): пользователи и ручные курсы. */
export const SYSTEM_ENTITIES = ['user', 'rate'] as const;
```

`src/client/pages/settings/AuditSettings.tsx` — импорт `SYSTEM_ENTITIES` из `../../lib/audit-format` и строка выбора списка:

```tsx
  const entityOptions: readonly string[] = scope === 'company' ? COMPANY_ENTITIES : SYSTEM_ENTITIES;
```

`src/client/components/AccountForm.tsx`:
- в свойства после `onCancel`:

```ts
  /** По счёту есть операции: валюту менять нельзя (§4.4). */
  currencyLocked?: boolean;
```

- поле «Валюта»:

```tsx
      <Field
        label="Валюта"
        error={fields.currency}
        hint={props.currencyLocked ? 'По счёту есть операции — валюту изменить нельзя' : undefined}
      >
        {(c) => (
          <select {...c} value={currency} disabled={props.currencyLocked} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
```

`src/client/pages/settings/AccountsSettings.tsx` — в форме правки (`mode="edit"`) добавьте свойство:

```tsx
                      currencyLocked={a.hasOperations}
```

`src/client/pages/settings/CompaniesSettings.tsx` — поле «Базовая валюта» в `CompanyRow`:

```tsx
        <Field
          label="Базовая валюта"
          error={fields.baseCurrency}
          hint={c.currencyLocked ? 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя' : undefined}
        >
          {(f) => (
            <select
              {...f}
              value={baseCurrency}
              disabled={readOnly || c.currencyLocked}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className={inputClass}
            >
              {CURRENCIES.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code}
                </option>
              ))}
            </select>
          )}
        </Field>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: PASS.

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/client tests/client/audit-format.test.ts e2e/money.spec.ts
git commit -m "feat: блокировка валют в формах счёта и компании, подписи операций, курсов и вложений в истории

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §7 Каркас: левая панель — «Всего на счетах», «курс X недоступен», группы «Общие» и проекты, баланс в валюте счёта, «+ счёт», сворачивание в `user_preferences` | Task 4 (e2e «левая панель…»), Task 5 (предупреждение и пересчёт) |
| §7 Шапка: балансы компаний в переключателе | Task 4 |
| §7 Настройки → Курсы (без Нацбанка, решение 2026-10-06) | Task 5 |
| §4.2, §4.4, §7: блокировка валюты счёта и базовой валюты компании в интерфейсе | Tasks 1, 6 |
| §4.5 `attachments`, §6 Вложения: загрузка, список, скачивание, мягкое удаление; файл остаётся на диске | Task 2 |
| §9.2 вложения в бэкапе (папка `data/uploads/` уже входит в архив) | Task 2 (файлы пишутся в `config.uploadsDir`) |
| §10 демо-набор: 3 компании, 5 проектов, 8 счетов, ≥ 60 статей, 150 контрагентов, 10 000 операций, ~15 % разбитых, ~10 % переводов | Task 3 |
| §12 сверка SQL-балансов с пересчётом в JS | Task 3 |
| История: подписи операций, курсов, фиксированных курсов, вложений | Task 6 |

Вне этого плана: журнал операций с фильтром по счёту (шаг 5), форма операции и прикрепление файлов в ней (шаг 6), мобильная версия панели (шаг 7), загрузка курсов Нацбанка (отложена).
