# Этап 1, план 3a: справочники и общая инфраструктура — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина шага 3 §11 спецификации. Результат:
- API и экраны настроек счетов и статей (с правилами перемещения), контрагентов, тегов и шаблонов разделения;
- порядок и удаление проектов, переименование счетов «Касса/Kaspi …» вместе с проектом;
- общая инфраструктура:
  - изменение справочника и запись в историю в одной транзакции;
  - пустой `PATCH` не пишет историю;
  - чистка названий от невидимых символов, русские сообщения zod;
  - бэкап перед миграцией во всех скриптах;
- обязательные пункты из `docs/superpowers/followups/2026-10-06-stage1-plan2-followups.md` и замечания итогового harness-ревью плана 2.

Вторая половина шага 3 вынесена в **план 3b**: пользователи, профиль, история действий, резервная копия, `user_preferences` API, доступность переключателя компаний.

**Architecture:**
- **Сервер.** Модули `accounts`, `categories`, `counterparties`, `tags`, `split-presets`, `projects`. Каждый модуль — фабрика сервиса плюс функция маршрутов, как в планах 1–2.
- **Общие помощники.**
  - `mutate()` выполняет изменение и запись истории в одной транзакции SQLite.
  - `changedFields()` оставляет только реально изменённые поля.
  - `assertSameSet()` / `isSameOrder()` проверяют список при смене порядка.
  - `requireCompany()` проверяет компанию без циклической зависимости сервисов.
- **Заглушки шага 4.** Проверка «на справочник ссылаются операции» (инвариант 9) и баланс счёта идут через интерфейсы `ReferencesService` и `BalancesService`. До шага 4 они отвечают «ссылок нет» и «баланс = стартовый остаток».
- **Клиент.**
  - Экраны настроек показывают сначала данные: ошибка фонового обновления выводится плашкой над уже загруженными данными.
  - Поля ввода через компонент `Field` (`label for`, `aria-invalid`, `aria-describedby`).
  - Порядок проектов, счетов и статей меняется кнопками ↑/↓. Статьи дополнительно перетаскиваются мышью (HTML5 drag-and-drop) и переносятся через список «Перенести в». У контрагентов, тегов и шаблонов разделения порядок есть только в API (§6): §7 не требует его на экранах.

**Tech Stack:** как в планах 1–2 (Node 24, Fastify 5, better-sqlite3, Drizzle 0.45, zod 4, React 19, react-router 8, TanStack Query 5, Tailwind 4, Vitest 5, Playwright).

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.2 (`user_preferences`, только таблица), §4.4, §4.6 (п. 5, 7, 8, 9, 10, 12, 13), §6 (Справочники), §6.1, §6.2, §7 (Настройки: Проекты, Счета, Категории, Контрагенты, Теги, Шаблоны разделения), §10, §11 шаг 3.

**Ветка:** `stage1/plan1-skeleton` (продолжаем). В `main` не сливаем до завершения всех работ — решение заказчика 2026-10-06.

## Global Constraints

- **Справочники.** Все справочники привязаны к `companyId` и имеют `orderIndex` и `archivedAt`. Объект чужой компании → 404, ничего не меняется и не пишется в историю.
- **Архивная компания** доступна только для чтения: любая запись в её справочники → 422 `ARCHIVED_REFERENCE`.
- **Архивный элемент справочника** правке не подлежит: `PATCH` → 422 `ARCHIVED_REFERENCE` «… в архиве — сначала верните …». Разрешены только «Вернуть из архива», удаление и смена порядка.
- **Инвариант 7 (новый выбор).** Нельзя выбрать архивный проект для счёта, архивную статью или проект в строке шаблона разделения, архивного родителя для статьи. Ответ → 422 `ARCHIVED_REFERENCE`.
- **Инвариант 8 (архивирование):**
  - счёт — только при нулевом балансе;
  - проект — только когда все его счета в архиве (уже есть);
  - системные статьи не архивируются;
  - статья с активными дочерними не архивируется;
  - нельзя вернуть из архива счёт архивного проекта и дочернюю статью архивного родителя.
- **Инвариант 9 (жёсткое удаление)** — только если на элемент не ссылается ни одна операция, включая мягко удалённые. Проверка через `ReferencesService.countOperations(entity, id)`. До шага 4 это заглушка, которая всегда возвращает 0. Нарушение → 422 `INVARIANT_9`.
- **Удаление при других ссылках.** Если на элемент ссылаются не операции, а записи справочников (дочерние статьи, счета проекта), ответ → 422 `IN_USE`.
- **Статьи (§4.4, §7):**
  - перемещаются только внутри своего дерева (`income` / `expense`);
  - вложенность не больше 2 уровней;
  - статью с дочерними нельзя сделать дочерней;
  - системные остаются на верхнем уровне, но в них можно вкладывать.

  Системную статью нельзя переименовать, удалить или вложить → 422 `SYSTEM_CATEGORY`. Архивировать её тоже нельзя → 422 `ARCHIVED_REFERENCE` (инвариант 8).
- **Слияние шаблона после ручного переноса.** Если пользователь перенёс группу шаблона во второй уровень или в архив, новые дочерние статьи шаблона встают на верхний уровень. Третьего уровня и детей в архивной группе не бывает.
- **Теги** уникальны в компании, включая архивные. Сравнение без учёта регистра, «ё» и невидимых символов: колонка `name_key` = `foldCase(cleanName(name))`. Активный дубль → 400 `fields.name`. Архивный дубль → 422 `ARCHIVED_DUPLICATE`, клиент предлагает «Вернуть из архива».
- **Шаблоны разделения.** Строки `[{categoryId, projectId, bp}]`, где `bp` — сотые доли процента. Ограничения:
  - сумма долей ровно 10000;
  - в каждой строке есть статья или проект;
  - строки не повторяются;
  - статьи одного вида;
  - ссылки той же компании и не архивные — только при сохранении строк, правка одного имени их не перепроверяет (инвариант 10).
- **Смена порядка** (`POST …/reorder`, тело `{ ids }`). `ids` — полный список элементов группы в новом порядке:
  - для счетов, проектов, контрагентов, тегов и шаблонов разделения группа = все элементы компании;
  - для статей группа = дети одного родителя одного вида, плюс статьи, которые туда переносятся.

  Если список устарел или содержит повторы → 409 `VERSION_CONFLICT` «Список изменился — обновите страницу и повторите». Если порядок не изменился, запись и история не делаются.
- **История.** Каждое изменение справочника и его запись в историю выполняются в одной транзакции (`mutate`). `PATCH` без реальных изменений возвращает 200 и не пишет историю. В `diff` правки попадают только изменённые поля: `{ before: {...}, after: {...} }`.
- **Названия** проходят `cleanName`: NFC, без невидимых символов (`U+00AD`, `U+180E`, `U+200B–U+200F`, `U+202A–U+202E`, `U+2060–U+2064`, `U+FEFF`), пробелы схлопнуты, края обрезаны. Длина проверяется после чистки.
- **Сообщения проверки** только на русском: `installZodRu()` вызывается при старте сервера (`buildApp`) и клиента (`main.tsx`).
- **Формат ошибки:** `{ error: { code, message, fields? } }`. Коды `SYSTEM_CATEGORY`, `IN_USE`, `ARCHIVED_DUPLICATE` (все 422) и `VERSION_CONFLICT` для устаревшего списка порядка (409) внесены в таблицу §6.2 спецификации вместе с этим планом.
- **Интерфейс:**
  - тексты на русском, цвета только через токены `styles.css`;
  - изменяющие запросы идут через `api()`;
  - поля ввода через `Field`;
  - удаление подтверждается встроенным блоком `ConfirmDelete`, без `window.confirm`;
  - экраны настроек показывают данные раньше ошибки.
- **Безопасность хуков среды:** shell-команды не должны содержать подстроку «.env». Строку нельзя собирать из частей, чтобы обойти хук.
- **Завершение задачи.** Каждая задача заканчивается зелёными `npm test` и `npm run typecheck` и коммитом. Задачи с клиентским кодом (9–14) дополнительно проходят `npm run test:e2e`. Сообщение коммита завершается пустой строкой и трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Счёт в архивном проекте.** Создание счёта с `projectId` архивного проекта или перенос счёта в него → 422 `ARCHIVED_REFERENCE`, история не пишется. Тест — в задаче 4.
2. **Возврат из архива счёта архивного проекта.** Иначе получился бы активный счёт в архивном проекте, и проект нарушил бы инвариант 8. Ответ → 422. После возврата проекта возврат счёта проходит. Тест — в задаче 4.
3. **Пользователь перестроил группу шаблона, затем создал ещё один клуб.** Группа перенесена во второй уровень или в архив. Новые дочерние статьи шаблона встают на верхний уровень: третьего уровня нет, детей в архивной группе нет. Тест — в задаче 5.
4. **Тег с именем архивного**, отличающимся регистром, «ё» или невидимым символом («Ёлка\u200B» против архивного «елка»). Ответ → 422 `ARCHIVED_DUPLICATE`, дубль не создаётся, в интерфейсе есть кнопка «Вернуть из архива». Тесты — в задачах 6 и 14.
5. **Устаревший список порядка.** Другой пользователь добавил элемент или перенёс статью после загрузки экрана. Ответ → 409 `VERSION_CONFLICT`, порядок не меняется. Тесты — в задачах 4 и 5.

---

## Карта файлов

```
src/shared/
  text.ts                    # cleanName, nameField (новый)
  search.ts                  # foldCase, matchesQuery (новый)
  dates.ts                   # + isValidDate, formatDateRu
  zod-ru.ts                  # installZodRu (новый)
  money.ts                   # parseAmount, formatAmount (новый)
  percent.ts                 # parsePercentToBp, formatBp (новый)
  counterparties.ts          # типы контрагентов и подписи (новый)
  schemas/common.ts          # reorderSchema (новый)
  schemas/accounts.ts        # (новый)
  schemas/categories.ts      # (новый)
  schemas/counterparties.ts  # (новый)
  schemas/tags.ts            # (новый)
  schemas/split-presets.ts   # (новый)
  schemas/companies.ts, schemas/projects.ts   # nameField, renameAccounts
src/templates/computer-club.ts                # верхняя граница pcCount/consoleCount
src/server/
  config.ts                  # сообщение APP_TIMEZONE без двойного префикса
  app.ts                     # installZodRu, новые сервисы и маршруты
  main.ts                    # migrateWithBackup
  db/client.ts               # ulower через foldCase
  db/migrate.ts              # + migrateWithBackup
  db/schema.ts               # + counterparties, tags, split_presets, user_preferences
  db/migrations/0002_*.sql   # генерируется drizzle-kit
  modules/audit/service.ts   # record(entry, ex?)
  modules/audit/mutate.ts    # mutate, changedFields (новый)
  modules/companies/guard.ts # requireCompany (новый)
  modules/dictionaries/order.ts   # assertSameSet, isSameOrder (новый)
  modules/references/service.ts   # заглушка инварианта 9 (новый)
  modules/balances/service.ts     # заглушка баланса (новый)
  modules/accounts/{service,routes}.ts
  modules/categories/{service,routes}.ts
  modules/counterparties/{service,routes}.ts  # (новый)
  modules/tags/{service,routes}.ts            # (новый)
  modules/split-presets/{service,routes}.ts   # (новый)
  modules/projects/{service,routes}.ts
  modules/companies/service.ts
  modules/templates/routes.ts                 # + defaultAccounts
scripts/setup.ts, scripts/user-add.ts         # migrateWithBackup
src/client/
  main.tsx                   # installZodRu
  router.tsx                 # новые экраны настроек
  lib/query.ts               # 401 не перезагружает страницу из-за запроса 'me'
  lib/queries.ts             # типы и хуки справочников
  lib/order.ts               # moveWithinGroup (новый)
  lib/numbers.ts             # parseIntInput (новый)
  lib/category-moves.ts      # planMove, planShift, parentChoices (новый)
  components/Field.tsx, QueryState.tsx, ReorderButtons.tsx, ConfirmDelete.tsx   # (новые)
  components/ProjectForm.tsx, AccountForm.tsx (новый), ui.ts
  pages/settings/SettingsNav.tsx
  pages/settings/ProjectsSettings.tsx, CompaniesSettings.tsx
  pages/settings/AccountsSettings.tsx, CategoriesSettings.tsx, CounterpartiesSettings.tsx,
  pages/settings/TagsSettings.tsx, SplitPresetsSettings.tsx                     # (новые)
tests/helpers/api.ts         # createApi (новый)
tests/shared/*.test.ts, tests/client/*.test.ts, tests/server/*.test.ts
e2e/dictionaries.spec.ts     # (новый)
```

---

### Task 1: Общие помощники — названия, поиск, даты, русские сообщения zod

**Files:**
- Create: `src/shared/text.ts`, `src/shared/search.ts`, `src/shared/zod-ru.ts`, `tests/helpers/api.ts`, `tests/shared/text.test.ts`, `tests/server/names.test.ts`
- Modify: `src/shared/dates.ts`, `src/server/db/client.ts`, `src/shared/schemas/companies.ts`, `src/shared/schemas/projects.ts`, `src/server/config.ts:38-48`, `src/templates/computer-club.ts:10-11`, `src/server/app.ts`, `src/client/main.tsx`, `tests/shared/dates.test.ts`, `tests/server/config.test.ts`, `tests/shared/templates.test.ts`

**Interfaces:**
- Produces:
  - `cleanName(value: string): string`;
  - `nameField(max: number, emptyMessage?: string)` — zod-схема строки: чистка, затем длина 1..max;
  - `foldCase(value: string): string`, `matchesQuery(text: string, query: string): boolean`;
  - `isValidDate(value: string): boolean`;
  - `installZodRu(): void`;
  - тестовый помощник `createApi(now?: string): Promise<ApiHarness>` с полями `t`, `req(method, url, payload?)`, `company(name?)`, `auditCount(entity, action?)`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { foldCase, matchesQuery } from '../../src/shared/search';
import { cleanName, nameField } from '../../src/shared/text';

describe('cleanName', () => {
  it('убирает невидимые символы, схлопывает пробелы, обрезает края, нормализует NFC', () => {
    expect(cleanName('  Клуб\u200B  на\u00A0Ленина\uFEFF ')).toBe('Клуб на Ленина');
    expect(cleanName('\u200B\u200C\u200D\u2060\u00AD')).toBe('');
    expect(cleanName('e\u0301')).toBe('\u00E9');
  });

  it('nameField проверяет длину уже очищенного названия', () => {
    const f = nameField(5);
    expect(f.safeParse(' абв\u200B ').data).toBe('абв');
    expect(f.safeParse('\u200B').error?.issues[0]?.message).toBe('Введите название');
    expect(f.safeParse('абвгде').error?.issues[0]?.message).toBe('Не длиннее 5 символов');
    expect(nameField(5, 'Введите имя').safeParse('').error?.issues[0]?.message).toBe('Введите имя');
  });
});

describe('foldCase / matchesQuery', () => {
  it('без учёта регистра и «ё»', () => {
    expect(foldCase('ЁЛКА Ёж')).toBe('елка еж');
    expect(matchesQuery('ИП Иванов', 'иван')).toBe(true);
    expect(matchesQuery('Ёлка', 'ЕЛК')).toBe(true);
    expect(matchesQuery('Ромашка', 'лютик')).toBe(false);
    expect(matchesQuery('что угодно', '   ')).toBe(true);
  });
});
```

Добавьте `isValidDate` в импорт `tests/shared/dates.test.ts` (`import { isValidDate, todayInTimezone } from '../../src/shared/dates';`) и допишите в конец файла:

```ts
describe('isValidDate', () => {
  it('формат YYYY-MM-DD и существующая календарная дата', () => {
    expect(isValidDate('2026-10-06')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(isValidDate('06.10.2026')).toBe(false);
  });
});
```

Допишите в `describe('loadConfig', …)` файла `tests/server/config.test.ts`:

```ts
  it('ошибка APP_TIMEZONE — без двойного префикса', () => {
    let message = '';
    try {
      loadConfig({ ...base, APP_TIMEZONE: 'Mars/Olympus' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('APP_TIMEZONE: неизвестный часовой пояс');
    expect(message).not.toContain('APP_TIMEZONE: APP_TIMEZONE');
  });
```

Допишите в конец `tests/shared/templates.test.ts`:

```ts
describe('computer-club: границы параметров', () => {
  it('pcCount и consoleCount не больше 1000', () => {
    const params = getTemplate('computer-club')!.params;
    expect(params.safeParse({ pcCount: 1000, consoleCount: 1000 }).success).toBe(true);
    expect(params.safeParse({ pcCount: 1001 }).error?.issues[0]?.message).toBe('Не больше 1000');
    expect(params.safeParse({ pcCount: 1, consoleCount: 1001 }).error?.issues[0]?.message).toBe('Не больше 1000');
  });
});
```

`tests/helpers/api.ts` (помощник для всех API-тестов этого плана):

```ts
import type { LightMyRequestResponse } from 'fastify';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from './test-app';

export type Req = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) => Promise<LightMyRequestResponse>;

export interface ApiHarness {
  t: TestApp;
  req: Req;
  /** Создаёт компанию через API и возвращает её id. */
  company(name?: string): Promise<number>;
  /** Сколько записей истории по сущности (и действию). */
  auditCount(entity: string, action?: string): number;
}

/** Приложение с валютами KZT и USD и вошедшим пользователем admin. */
export async function createApi(now?: string): Promise<ApiHarness> {
  const t = await createTestApp({}, undefined, now ? () => new Date(now) : undefined);
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req: Req = (method, url, payload) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  let n = 0;
  return {
    t,
    req,
    async company(name) {
      const res = await req('POST', '/api/v1/companies', { name: name ?? `ТОО ${++n}` });
      if (res.statusCode !== 201) throw new Error(`company: ${res.statusCode} ${res.body}`);
      return (res.json() as { company: { id: number } }).company.id;
    },
    auditCount(entity, action) {
      const row = action
        ? t.sqlite.prepare('SELECT COUNT(*) n FROM audit_log WHERE entity = ? AND action = ?').get(entity, action)
        : t.sqlite.prepare('SELECT COUNT(*) n FROM audit_log WHERE entity = ?').get(entity);
      return (row as { n: number }).n;
    },
  };
}
```

`tests/server/names.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('названия и сообщения проверки', () => {
  it('невидимые символы вырезаются, название из одних невидимых символов отклоняется', async () => {
    h = await createApi();
    const empty = await h.req('POST', '/api/v1/companies', { name: '\u200B\u2060 \uFEFF' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.fields.name).toBe('Введите название');
    const ok = await h.req('POST', '/api/v1/companies', { name: ' ТОО\u200B   «Ромашка» ' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().company.name).toBe('ТОО «Ромашка»');
    const project = await h.req('POST', `/api/v1/companies/${ok.json().company.id}/projects`, { name: '\u200B', templateKey: 'general' });
    expect(project.json().error.fields.name).toBe('Введите название');
  });

  it('сообщения zod по умолчанию — на русском', async () => {
    h = await createApi();
    const wrongType = await h.req('POST', '/api/v1/companies', { name: 123 });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error.fields.name).toBe('Неверный формат значения');
    const missing = await h.req('POST', '/api/v1/companies', {});
    expect(missing.json().error.fields.name).toBe('Обязательное поле');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/text.test.ts tests/shared/dates.test.ts tests/server/config.test.ts tests/shared/templates.test.ts tests/server/names.test.ts`
Expected: FAIL — нет модулей `text`/`search`, нет `isValidDate`, двойной префикс, `pcCount: 1001` проходит, английские сообщения zod.

- [ ] **Step 3: Implement**

`src/shared/text.ts`:

```ts
import { z } from 'zod';

/** Невидимые символы, из-за которых «пустое» или «то же самое» название выглядит иначе. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Название справочника: NFC, без невидимых символов, пробелы схлопнуты, края обрезаны. */
export function cleanName(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** zod-поле названия: чистит и проверяет длину уже очищенной строки. */
export function nameField(max: number, emptyMessage = 'Введите название') {
  return z
    .string()
    .transform(cleanName)
    .pipe(z.string().min(1, emptyMessage).max(max, `Не длиннее ${max} символов`));
}
```

`src/shared/search.ts`:

```ts
/** Регистронезависимое сравнение для кириллицы: нижний регистр по правилам ru и «ё» → «е» (§6.1). */
export function foldCase(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

/** Текст содержит запрос (без учёта регистра и «ё»); пустой запрос подходит всем. */
export function matchesQuery(text: string, query: string): boolean {
  const q = foldCase(query.trim());
  return q === '' || foldCase(text).includes(q);
}
```

Допишите в `src/shared/dates.ts`:

```ts
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Строка `YYYY-MM-DD` и существующая календарная дата (2026-02-31 — нет). */
export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
```

`src/shared/zod-ru.ts`:

```ts
import { z } from 'zod';

let installed = false;

/**
 * Русские сообщения zod там, где у схемы нет своего текста. Вызывается один раз при старте
 * сервера (buildApp) и клиента (main.tsx). Свои сообщения схем имеют приоритет над этими.
 */
export function installZodRu(): void {
  if (installed) return;
  installed = true;
  z.config(z.locales.ru());
  z.config({
    customError: (issue) => {
      if (issue.code === 'invalid_type') return issue.input === undefined ? 'Обязательное поле' : 'Неверный формат значения';
      return undefined;
    },
  });
}
```

`src/server/db/client.ts` — `ulower` использует общий `foldCase` (поведение то же):

```ts
import { foldCase } from '../../shared/search';
```

```ts
export function ulower(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return foldCase(String(value));
}
```

`src/shared/schemas/companies.ts` — импорт `nameField` и новая строка `const name` (импорт `z` остаётся: он нужен для `baseCurrency`):

```ts
import { nameField } from '../text';
```

```ts
const name = nameField(100);
```

`src/shared/schemas/projects.ts` целиком:

```ts
import { z } from 'zod';
import { nameField } from '../text';

const name = nameField(100);
const params = z.record(z.string(), z.unknown());

export const projectCreateSchema = z.object({
  name,
  templateKey: z.string().min(1, 'Выберите тип бизнеса'),
  templateParams: params.default({}),
});

export const projectUpdateSchema = z.object({ name: name.optional(), templateParams: params.optional() });
```

`src/server/config.ts` — сообщение без префикса (путь `APP_TIMEZONE:` добавляет `loadConfig`):

```ts
    }, 'неизвестный часовой пояс'),
```

`src/templates/computer-club.ts` — верхние границы:

```ts
    pcCount: z.number({ message: 'Введите число' }).int('Целое число').min(1, 'Не меньше 1').max(1000, 'Не больше 1000'),
    consoleCount: z.number({ message: 'Введите число' }).int('Целое число').min(0, 'Не меньше 0').max(1000, 'Не больше 1000').default(0),
```

`src/server/app.ts` — импорт и первая строка `buildApp`:

```ts
import { installZodRu } from '../shared/zod-ru';
```

```ts
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  installZodRu();
  const { config, db } = deps;
```

`src/client/main.tsx` — до `createRoot`:

```ts
import { installZodRu } from '../shared/zod-ru';
```

```ts
installZodRu();

createRoot(document.getElementById('root')!).render(
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared tests/server/config.test.ts tests/server/names.test.ts tests/server/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/text.ts src/shared/search.ts src/shared/zod-ru.ts src/shared/dates.ts src/server/db/client.ts src/shared/schemas/companies.ts src/shared/schemas/projects.ts src/server/config.ts src/templates/computer-club.ts src/server/app.ts src/client/main.tsx tests/helpers/api.ts tests/shared/text.test.ts tests/shared/dates.test.ts tests/server/config.test.ts tests/shared/templates.test.ts tests/server/names.test.ts
git commit -m "feat: чистка названий, русские сообщения zod, проверка календарной даты

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: История в одной транзакции, пустой PATCH без истории, бэкап перед миграцией в скриптах

**Files:**
- Create: `src/server/modules/audit/mutate.ts`, `tests/server/mutate.test.ts`, `tests/server/migrate.test.ts`
- Modify: `src/server/modules/audit/service.ts`, `src/server/modules/companies/service.ts`, `src/server/modules/projects/service.ts`, `src/server/db/migrate.ts`, `src/server/main.ts:87-91`, `scripts/setup.ts:96-97`, `scripts/user-add.ts:11-14`

**Interfaces:**
- Consumes: `cleanName` (Task 1).
- Produces:
  - `AuditService.record(entry: AuditEntry, ex?: Executor): void` — пишет через переданную транзакцию;
  - `mutate<T>(db: Db, audit: AuditService, fn: (tx: Executor, record: (entry: AuditEntry) => void) => T): T`;
  - `changedFields<T extends object>(before: T, patch: Partial<T>): { before: Partial<T>; after: Partial<T> } | null`;
  - `migrateWithBackup(d: { db: Db; sqlite: Sqlite; dbExisted: boolean; backup: { create(reason: 'pre-migration'): unknown } }): void`.

- [ ] **Step 1: Write the failing tests**

`tests/server/mutate.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { changedFields } from '../../src/server/modules/audit/mutate';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('changedFields', () => {
  it('оставляет только изменённые поля; null — изменений нет', () => {
    expect(changedFields({ a: 1, b: 'x', p: { k: 1 } }, { a: 1, b: 'y' })).toEqual({ before: { b: 'x' }, after: { b: 'y' } });
    expect(changedFields({ a: 1, p: { k: 1 } }, { p: { k: 1 } })).toBeNull();
    expect(changedFields({ a: 1 }, {})).toBeNull();
    expect(changedFields({ a: 1 as number | null }, { a: null })).toEqual({ before: { a: 1 }, after: { a: null } });
  });
});

describe('история и транзакции', () => {
  it('PATCH без изменений не пишет историю (компании и проекты)', async () => {
    h = await createApi();
    const cid = await h.company('ТОО');
    expect((await h.req('PATCH', `/api/v1/companies/${cid}`, { name: ' ТОО ', baseCurrency: 'KZT' })).statusCode).toBe(200);
    expect(h.auditCount('company', 'update')).toBe(0);

    const p = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Клуб 1', templateKey: 'computer-club', templateParams: { pcCount: 30 } })).json().project;
    const same = await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Клуб\u200B 1', templateParams: { pcCount: 30 } });
    expect(same.statusCode).toBe(200);
    expect(h.auditCount('project', 'update')).toBe(0);

    await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Клуб 2', templateParams: { pcCount: 30 } });
    const row = h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'project' AND action = 'update'").get() as { diff: string };
    expect(JSON.parse(row.diff)).toEqual({ before: { name: 'Клуб 1' }, after: { name: 'Клуб 2' } });
  });

  it('сбой записи истории откатывает изменение: оба действия в одной транзакции', async () => {
    h = await createApi();
    const cid = await h.company('A');
    const p = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project;
    const s = h.t.sqlite;
    const categoriesBefore = (s.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n;
    s.exec("CREATE TEMP TRIGGER audit_down BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
    expect((await h.req('PATCH', `/api/v1/companies/${cid}`, { name: 'Б' })).statusCode).toBe(500);
    expect((await h.req('POST', `/api/v1/companies/${cid}/archive`)).statusCode).toBe(500);
    expect((await h.req('POST', '/api/v1/companies', { name: 'В' })).statusCode).toBe(500);
    expect((await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Склад' })).statusCode).toBe(500);
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${p.id}/archive`)).statusCode).toBe(500);
    s.exec('DROP TRIGGER audit_down');

    const companies = (await h.req('GET', '/api/v1/companies')).json().companies;
    expect(companies).toEqual([expect.objectContaining({ id: cid, name: 'A', archivedAt: null })]);
    expect((s.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBe(categoriesBefore);
    const projects = (await h.req('GET', `/api/v1/companies/${cid}/projects`)).json().projects;
    expect(projects).toEqual([expect.objectContaining({ name: 'Офис', archivedAt: null })]);
  });
});
```

`tests/server/migrate.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { appliedMigrationsCount, codeMigrationsCount, migrateWithBackup, MIGRATIONS_DIR } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function fakeBackup() {
  const calls: string[] = [];
  return { calls, backup: { create: (reason: 'pre-migration') => void calls.push(reason) } };
}

describe('migrateWithBackup', () => {
  it('новая БД и актуальная БД — без бэкапа; отстающая — бэкап, затем миграции', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-migwb-'));

    const fresh = openDb(path.join(dir, 'fresh.db'));
    const f = fakeBackup();
    migrateWithBackup({ db: fresh.db, sqlite: fresh.sqlite, dbExisted: false, backup: f.backup });
    expect(f.calls).toEqual([]);
    migrateWithBackup({ db: fresh.db, sqlite: fresh.sqlite, dbExisted: true, backup: f.backup });
    expect(f.calls).toEqual([]);
    fresh.sqlite.close();

    const only0 = path.join(dir, 'migrations-0000');
    fs.cpSync(MIGRATIONS_DIR, only0, { recursive: true });
    const journalPath = path.join(only0, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    const old = openDb(path.join(dir, 'old.db'));
    migrate(old.db, { migrationsFolder: only0 });
    const o = fakeBackup();
    migrateWithBackup({ db: old.db, sqlite: old.sqlite, dbExisted: true, backup: o.backup });
    expect(o.calls).toEqual(['pre-migration']);
    expect(appliedMigrationsCount(old.sqlite)).toBe(codeMigrationsCount());
    old.sqlite.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/mutate.test.ts tests/server/migrate.test.ts`
Expected: FAIL — нет `mutate.ts`, нет `migrateWithBackup`; пустой PATCH пишет историю; изменение остаётся при сбое истории.

- [ ] **Step 3: Implement**

`src/server/modules/audit/service.ts` — `record` пишет через переданный исполнитель:

```ts
import type { Db, Executor } from '../../db/client';
```

```ts
export interface AuditService {
  /** ex — транзакция изменения: запись истории откатится вместе с ним. */
  record(entry: AuditEntry, ex?: Executor): void;
  list(q: { companyId: number | null; limit?: number; beforeId?: number }): AuditRow[];
}
```

```ts
    record(entry, ex) {
      (ex ?? db)
        .insert(auditLog)
        .values({
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          action: entry.action,
          diff: entry.diff ? JSON.stringify(sanitizeDiff(entry.diff)) : null,
          at: now().toISOString(),
        })
        .run();
    },
```

`src/server/modules/audit/mutate.ts`:

```ts
import type { Db, Executor } from '../../db/client';
import type { AuditEntry, AuditService } from './service';

/** Изменение справочника и запись в историю — одной транзакцией: либо оба, либо ничего. */
export function mutate<T>(db: Db, audit: AuditService, fn: (tx: Executor, record: (entry: AuditEntry) => void) => T): T {
  return db.transaction((tx) => fn(tx, (entry) => audit.record(entry, tx)));
}

/** Только реально изменившиеся поля; null — изменений нет (пустой PATCH не пишет историю). */
export function changedFields<T extends object>(before: T, patch: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(next)) continue;
    b[key] = before[key];
    a[key] = next;
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}
```

`src/server/modules/companies/service.ts` целиком:

```ts
import { asc, eq } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { companies } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';

export interface CompanyRow {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface CompaniesService {
  list(): CompanyRow[];
  require(id: number, opts?: { writable?: boolean }): CompanyRow;
  create(input: { name: string; baseCurrency: string }, userId: number): CompanyRow;
  update(id: number, input: { name?: string; baseCurrency?: string }, userId: number): CompanyRow;
  archive(id: number, userId: number): CompanyRow;
  unarchive(id: number, userId: number): CompanyRow;
}

export function createCompaniesService(d: {
  db: Db;
  audit: AuditService;
  categories: CategoriesService;
  accounts: AccountsService;
  now?: () => Date;
}): CompaniesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  const svc: CompaniesService = {
    list() {
      return db.select().from(companies).orderBy(asc(companies.id)).all();
    },

    require(id, opts = {}) {
      const row = db.select().from(companies).where(eq(companies.id, id)).get();
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Компания не найдена');
      if (opts.writable && row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Компания в архиве — изменения недоступны');
      return row;
    },

    create(input, userId) {
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .insert(companies)
          .values({ name: cleanName(input.name), baseCurrency: input.baseCurrency, createdAt: now().toISOString() })
          .returning()
          .get();
        d.categories.seedSystem(tx, row.id);
        record({ companyId: row.id, userId, entity: 'company', entityId: row.id, action: 'create', diff: { name: row.name, baseCurrency: row.baseCurrency } });
        return row;
      });
    },

    update(id, input, userId) {
      const before = svc.require(id, { writable: true });
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ name: before.name, baseCurrency: before.baseCurrency }, patch);
      if (!changes) return before; // пустой или ничего не меняющий PATCH
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(companies).set(changes.after).where(eq(companies.id, id)).returning().get();
        record({ companyId: id, userId, entity: 'company', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive(id, userId) {
      const row = svc.require(id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив все счета компании');
      }
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(companies).set({ archivedAt: now().toISOString() }).where(eq(companies.id, id)).returning().get();
        record({ companyId: id, userId, entity: 'company', entityId: id, action: 'archive' });
        return out;
      });
    },

    unarchive(id, userId) {
      const row = svc.require(id);
      if (!row.archivedAt) return row;
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(companies).set({ archivedAt: null }).where(eq(companies.id, id)).returning().get();
        record({ companyId: id, userId, entity: 'company', entityId: id, action: 'unarchive' });
        return out;
      });
    },
  };
  return svc;
}
```

`src/server/modules/projects/service.ts` — импорты, `create`, `update`, `archive`, `unarchive` переходят на `mutate`, `update` — на `changedFields`. Замените импорты верхней части файла на:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import { cleanName } from '../../../shared/text';
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db } from '../../db/client';
import { projects } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CompaniesService } from '../companies/service';
```

и методы `create` … `unarchive` объекта `svc` на:

```ts
    create(companyId, input, userId) {
      const company = d.companies.require(companyId, { writable: true });
      const template = getTemplate(input.templateKey);
      if (!template) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { templateKey: 'Неизвестный тип бизнеса' });
      const params = validateParams(template, input.templateParams);
      const name = cleanName(input.name);
      assertNameFree(companyId, name);

      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
          .from(projects)
          .where(eq(projects.companyId, companyId))
          .get();
        const row = tx
          .insert(projects)
          .values({
            companyId,
            name,
            templateKey: template.key,
            templateParams: JSON.stringify(params),
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get();
        const createdCategories = d.categories.mergeTemplate(tx, companyId, template);
        const openedAt = todayInTimezone(d.timezone, now());
        for (const acc of template.defaultAccounts) {
          d.accounts.create(tx, {
            companyId,
            projectId: row.id,
            name: acc.name.replaceAll('{project}', () => name),
            currency: acc.currency ?? company.baseCurrency,
            openedAt,
          });
        }
        const applied = { categories: createdCategories, accounts: template.defaultAccounts.length };
        record({
          companyId,
          userId,
          entity: 'project',
          entityId: row.id,
          action: 'create',
          diff: { name, templateKey: template.key, templateParams: params, applied },
        });
        return { project: toRow(row), applied };
      });
    },

    update(companyId, id, input, userId) {
      d.companies.require(companyId, { writable: true });
      const before = requireProject(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — изменения недоступны');
      const template = getTemplate(before.templateKey);
      if (!template) throw new Error(`Шаблон ${before.templateKey} не найден`);
      const patch: { name?: string; templateParams?: Record<string, unknown> } = {};
      if (input.name !== undefined) patch.name = cleanName(input.name);
      if (input.templateParams !== undefined) {
        patch.templateParams = validateParams(template, { ...before.templateParams, ...input.templateParams });
      }
      const changes = changedFields({ name: before.name, templateParams: before.templateParams }, patch);
      if (!changes) return before;
      const newName = changes.after.name;
      if (newName !== undefined) assertNameFree(companyId, newName, id);
      return mutate(db, audit, (tx, record) => {
        const set: Partial<typeof projects.$inferInsert> = {};
        if (newName !== undefined) set.name = newName;
        if (changes.after.templateParams !== undefined) set.templateParams = JSON.stringify(changes.after.templateParams);
        const row = toRow(tx.update(projects).set(set).where(eq(projects.id, id)).returning().get());
        record({ companyId, userId, entity: 'project', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(companyId, id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив счета проекта');
      }
      return mutate(db, audit, (tx, record) => {
        const out = toRow(tx.update(projects).set({ archivedAt: now().toISOString() }).where(eq(projects.id, id)).returning().get());
        record({ companyId, userId, entity: 'project', entityId: id, action: 'archive' });
        return out;
      });
    },

    unarchive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (!row.archivedAt) return row;
      return mutate(db, audit, (tx, record) => {
        const out = toRow(tx.update(projects).set({ archivedAt: null }).where(eq(projects.id, id)).returning().get());
        record({ companyId, userId, entity: 'project', entityId: id, action: 'unarchive' });
        return out;
      });
    },
```

`src/server/db/migrate.ts` — допишите:

```ts
/**
 * Миграции с бэкапом перед ними, если существующая БД отстаёт от кода (§9.2).
 * Общая точка для startServer и скриптов setup / user:add.
 */
export function migrateWithBackup(d: {
  db: Db;
  sqlite: Sqlite;
  dbExisted: boolean;
  backup: { create(reason: 'pre-migration'): unknown };
}): void {
  const applied = appliedMigrationsCount(d.sqlite);
  if (d.dbExisted && applied > 0 && applied < codeMigrationsCount()) d.backup.create('pre-migration');
  runMigrations(d.db);
}
```

`src/server/main.ts` — импорт `import { migrateWithBackup } from './db/migrate';` вместо `appliedMigrationsCount, codeMigrationsCount, runMigrations`, и три строки

```ts
    const applied = appliedMigrationsCount(sqlite);
    if (dbExisted && applied > 0 && applied < codeMigrationsCount()) backup.create('pre-migration');
    runMigrations(db);
```

замените на

```ts
    migrateWithBackup({ db, sqlite, dbExisted, backup });
```

`scripts/setup.ts` — импорты `migrateWithBackup` (вместо `runMigrations`) и `createBackupService`:

```ts
import { migrateWithBackup } from '../src/server/db/migrate';
import { createBackupService } from '../src/server/modules/backup/service';
```

и строки

```ts
const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
```

замените на

```ts
const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
fs.mkdirSync(config.backupsDir, { recursive: true });
migrateWithBackup({
  db,
  sqlite,
  dbExisted,
  backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
});
```

`scripts/user-add.ts` — те же два импорта (вместо `runMigrations`) и строки

```ts
const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
```

замените на тот же блок с `dbExisted`, `fs.mkdirSync(config.backupsDir, …)` и `migrateWithBackup(…)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/mutate.test.ts tests/server/migrate.test.ts tests/server/companies.test.ts tests/server/projects.test.ts tests/server/projects-service.test.ts tests/server/schema-0001.test.ts tests/server/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/audit src/server/modules/companies/service.ts src/server/modules/projects/service.ts src/server/db/migrate.ts src/server/main.ts scripts/setup.ts scripts/user-add.ts tests/server/mutate.test.ts tests/server/migrate.test.ts
git commit -m "feat: изменение и история одной транзакцией, пустой PATCH без истории, бэкап перед миграцией в скриптах

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Миграция 0002 — контрагенты, теги, шаблоны разделения, настройки пользователя

**Files:**
- Create: `src/shared/counterparties.ts`, `src/server/db/migrations/0002_*.sql` (генерируется), `tests/server/schema-0002.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/db/migrations/meta/*` (генерируется)

**Interfaces:**
- Produces:
  - таблицы Drizzle `counterparties`, `tags` (с `nameKey`), `splitPresets`, `userPreferences`;
  - `COUNTERPARTY_TYPES` (кортеж из 8 типов), `COUNTERPARTY_TYPE_LABELS` (множественное число, для вкладок), `COUNTERPARTY_TYPE_SINGULAR`.

- [ ] **Step 1: Write the failing test**

`tests/server/schema-0002.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО 1','KZT','x'), ('ТОО 2','KZT','x')").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  return s;
}

describe('миграция 0002', () => {
  it('теги уникальны в компании по name_key, включая архивные', () => {
    const s = setup();
    const ins = s.prepare("INSERT INTO tags (company_id, name, name_key, order_index, created_at, archived_at) VALUES (?, ?, ?, 0, 'x', ?)");
    ins.run(1, 'Аренда', 'аренда', 'y');
    expect(() => ins.run(1, 'аренда', 'аренда', null)).toThrow(/UNIQUE/);
    ins.run(2, 'Аренда', 'аренда', null);
  });

  it('контрагенты и шаблоны разделения ссылаются на компанию', () => {
    const s = setup();
    s.prepare("INSERT INTO counterparties (company_id, type, name, comment, order_index, created_at) VALUES (1,'client','ИП','',0,'x')").run();
    expect(() =>
      s.prepare("INSERT INTO counterparties (company_id, type, name, order_index, created_at) VALUES (99,'client','ИП',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
    s.prepare("INSERT INTO split_presets (company_id, name, lines, order_index, created_at) VALUES (1,'50/50','[]',0,'x')").run();
    expect(() =>
      s.prepare("INSERT INTO split_presets (company_id, name, lines, order_index, created_at) VALUES (99,'50/50','[]',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('user_preferences: пара (user_id, key) уникальна, удаляются вместе с пользователем', () => {
    const s = setup();
    const ins = s.prepare("INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (1, ?, '1', 'x')");
    ins.run('lastCompanyId');
    expect(() => ins.run('lastCompanyId')).toThrow(/UNIQUE/);
    s.prepare('DELETE FROM users WHERE id = 1').run();
    expect((s.prepare('SELECT COUNT(*) n FROM user_preferences').get() as { n: number }).n).toBe(0);
  });

  it('внешние ключи плана 2: categories.parent_id и accounts.project_id', () => {
    const s = setup();
    expect(() =>
      s.prepare("INSERT INTO categories (company_id, kind, parent_id, name, order_index, created_at) VALUES (1,'expense',999,'X',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      s
        .prepare("INSERT INTO accounts (company_id, project_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,999,'К','KZT',0,'2026-10-06',0,'x')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/schema-0002.test.ts`
Expected: FAIL — `no such table: tags`.

- [ ] **Step 3: Implement**

`src/shared/counterparties.ts`:

```ts
import type { CounterpartyType } from './system-categories';

export const COUNTERPARTY_TYPES = [
  'client',
  'supplier',
  'employee',
  'owner',
  'investor',
  'creditor',
  'borrower',
  'tax',
] as const satisfies readonly CounterpartyType[];

/** Подписи вкладок (множественное число). */
export const COUNTERPARTY_TYPE_LABELS: Record<CounterpartyType, string> = {
  client: 'Клиенты',
  supplier: 'Поставщики',
  employee: 'Сотрудники',
  owner: 'Собственники',
  investor: 'Инвесторы',
  creditor: 'Кредиторы',
  borrower: 'Заёмщики',
  tax: 'Налоговые',
};

/** Подписи в списке выбора типа (единственное число). */
export const COUNTERPARTY_TYPE_SINGULAR: Record<CounterpartyType, string> = {
  client: 'Клиент',
  supplier: 'Поставщик',
  employee: 'Сотрудник',
  owner: 'Собственник',
  investor: 'Инвестор',
  creditor: 'Кредитор',
  borrower: 'Заёмщик',
  tax: 'Налоговый орган',
};
```

`src/server/db/schema.ts` — импорт и новые таблицы в конец файла:

```ts
import { COUNTERPARTY_TYPES } from '../../shared/counterparties';
```

```ts
export const counterparties = sqliteTable(
  'counterparties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: COUNTERPARTY_TYPES }).notNull(),
    name: text('name').notNull(),
    comment: text('comment'),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('counterparties_company_idx').on(t.companyId, t.orderIndex)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** foldCase(cleanName(name)): уникальность без учёта регистра, «ё» и невидимых символов. */
    nameKey: text('name_key').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('tags_name_key_uq').on(t.companyId, t.nameKey), index('tags_company_idx').on(t.companyId, t.orderIndex)],
);

export const splitPresets = sqliteTable(
  'split_presets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** JSON `[{categoryId, projectId, bp}]`; ссылки без внешних ключей (инвариант 10). */
    lines: text('lines').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('split_presets_company_idx').on(t.companyId, t.orderIndex)],
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** JSON-значение. */
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('user_preferences_uq').on(t.userId, t.key)],
);
```

Сгенерируйте миграцию:

Run: `npm run db:generate`
Expected: создан `src/server/db/migrations/0002_<случайное_имя>.sql` и обновлены `meta/_journal.json`, `meta/0002_snapshot.json`. Содержимое SQL должно совпасть по смыслу с:

```sql
CREATE TABLE `counterparties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`comment` text,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `counterparties_company_idx` ON `counterparties` (`company_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `split_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`lines` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `split_presets_company_idx` ON `split_presets` (`company_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_key_uq` ON `tags` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `tags_company_idx` ON `tags` (`company_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_uq` ON `user_preferences` (`user_id`,`key`);
```

Повторный запуск `npm run db:generate` должен сообщить, что изменений нет (схема и миграции не расходятся).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/schema-0002.test.ts tests/server/schema-0001.test.ts tests/server/migrate.test.ts`
Expected: PASS. Тест бэкапа перед миграцией из `schema-0001.test.ts` теперь проверяет переход 0000 → 0002.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/counterparties.ts src/server/db/schema.ts src/server/db/migrations tests/server/schema-0002.test.ts
git commit -m "feat: миграция 0002 — контрагенты, теги, шаблоны разделения, настройки пользователя

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: API счетов — создание, правка, архив, порядок, удаление (с заглушками инварианта 9 и баланса)

**Files:**
- Create: `src/shared/schemas/common.ts`, `src/shared/schemas/accounts.ts`, `src/server/modules/companies/guard.ts`, `src/server/modules/dictionaries/order.ts`, `src/server/modules/references/service.ts`, `src/server/modules/balances/service.ts`, `tests/server/accounts-api.test.ts`
- Modify: `src/server/modules/accounts/service.ts` (целиком), `src/server/modules/accounts/routes.ts` (целиком), `src/server/modules/companies/service.ts` (`require`), `src/server/app.ts`, `tests/server/accounts.test.ts`, `tests/server/projects-service.test.ts:20`

**Interfaces:**
- Consumes: `mutate`, `changedFields` (Task 2); `cleanName`, `nameField`, `isValidDate` (Task 1).
- Produces:
  - `reorderSchema` — `{ ids: number[] }`;
  - `ACCOUNT_NAME_MAX = 120` (переезжает в `src/shared/schemas/accounts.ts`, сервис реэкспортирует);
  - `accountCreateSchema`, `accountUpdateSchema`;
  - `requireCompany(ex: Executor, id: number, opts?: { writable?: boolean }): CompanyRow`;
  - `assertSameSet(current: readonly number[], ids: readonly number[]): void` (409 `VERSION_CONFLICT`), `isSameOrder(current, ids): boolean`;
  - `ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag'`;
  - `ReferencesService { countOperations(entity, id): number; earliestOperationDate(accountId): string | null }`, `createReferencesService()`;
  - `BalancesService { accountBalance(account: { id: number; startingBalance: number }): number }`, `createBalancesService()`;
  - `createAccountsService(d: { db; audit; references?; balances?; timezone: string; now? })`;
  - `AccountsService`: прежние `create(ex, input)`, `list`, `countActive` плюс `countByProject(companyId, projectId)`, `add(companyId, input, userId)`, `update(companyId, id, patch, userId)`, `archive`, `unarchive`, `reorder(companyId, ids, userId): AccountRow[]`, `remove(companyId, id, userId): void`;
  - маршруты:
    - `POST /api/v1/companies/:cid/accounts` → 201 `{ account }`;
    - `PATCH …/accounts/:id` → `{ account }`;
    - `DELETE …/accounts/:id` → 204;
    - `POST …/accounts/:id/archive` и `/unarchive` → `{ account }`;
    - `POST …/accounts/reorder` → `{ accounts }`.

- [ ] **Step 1: Write the failing tests**

`tests/server/accounts-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/accounts`;
const kaspi = { name: 'Kaspi Gold', currency: 'KZT', startingBalance: 150000 };
const names = async (cid: number) => (await h.req('GET', base(cid))).json().accounts.map((a: { name: string }) => a.name);

describe('accounts API', () => {
  it('создание: openedAt по умолчанию — сегодня в APP_TIMEZONE, история', async () => {
    h = await createApi('2026-10-06T20:00:00.000Z'); // 01:00 7 октября по Алматы
    const cid = await h.company();
    const res = await h.req('POST', base(cid), kaspi);
    expect(res.statusCode).toBe(201);
    expect(res.json().account).toMatchObject({
      name: 'Kaspi Gold',
      currency: 'KZT',
      startingBalance: 150000,
      openedAt: '2026-10-07',
      projectId: null,
      archivedAt: null,
    });
    expect(h.auditCount('account', 'create')).toBe(1);
  });

  it('проверка полей: несуществующая дата, валюта, дробный остаток, пустое имя', async () => {
    h = await createApi();
    const cid = await h.company();
    const res = await h.req('POST', base(cid), { name: '\u200B', currency: 'XXX', startingBalance: 1.5, openedAt: '2026-02-31' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['currency', 'name', 'openedAt', 'startingBalance']);
    const huge = await h.req('POST', base(cid), { ...kaspi, startingBalance: 2 ** 60 });
    expect(huge.json().error.fields.startingBalance).toBe('Слишком большая сумма');
  });

  it('счёт нельзя создать в архивном проекте или перенести в него; чужой проект — ошибка поля (Review Focus 1)', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const office = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project.id;
    const foreign = (await h.req('POST', `/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).json().project.id;
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/archive`)).statusCode).toBe(200);

    const toArchived = await h.req('POST', base(cid), { ...kaspi, projectId: office });
    expect(toArchived.statusCode).toBe(422);
    expect(toArchived.json().error.code).toBe('ARCHIVED_REFERENCE');
    const toForeign = await h.req('POST', base(cid), { ...kaspi, projectId: foreign });
    expect(toForeign.statusCode).toBe(400);
    expect(toForeign.json().error.fields.projectId).toBe('Проект не найден в этой компании');

    const acc = (await h.req('POST', base(cid), kaspi)).json().account;
    const move = await h.req('PATCH', `${base(cid)}/${acc.id}`, { projectId: office });
    expect(move.statusCode).toBe(422);
    expect(move.json().error.code).toBe('ARCHIVED_REFERENCE');
    expect(h.auditCount('account', 'update')).toBe(0);
  });

  it('правка полей; PATCH без изменений не пишет историю; архивный счёт не правится', async () => {
    h = await createApi();
    const cid = await h.company();
    const acc = (await h.req('POST', base(cid), { ...kaspi, openedAt: '2026-01-01' })).json().account;
    const res = await h.req('PATCH', `${base(cid)}/${acc.id}`, { name: 'Kaspi Red', startingBalance: 0, openedAt: '2025-12-31', currency: 'USD' });
    expect(res.statusCode).toBe(200);
    expect(res.json().account).toMatchObject({ name: 'Kaspi Red', startingBalance: 0, openedAt: '2025-12-31', currency: 'USD' });
    const same = await h.req('PATCH', `${base(cid)}/${acc.id}`, { name: ' Kaspi  Red ', startingBalance: 0 });
    expect(same.statusCode).toBe(200);
    expect(h.auditCount('account', 'update')).toBe(1);

    expect((await h.req('POST', `${base(cid)}/${acc.id}/archive`)).statusCode).toBe(200);
    const locked = await h.req('PATCH', `${base(cid)}/${acc.id}`, { startingBalance: 100 });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('архив только при нулевом балансе; счёт архивного проекта из архива не вернуть (Review Focus 2)', async () => {
    h = await createApi();
    const cid = await h.company();
    const office = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project.id;
    const acc = (await h.req('POST', base(cid), { ...kaspi, projectId: office })).json().account;
    const nonZero = await h.req('POST', `${base(cid)}/${acc.id}/archive`);
    expect(nonZero.statusCode).toBe(422);
    expect(nonZero.json().error).toMatchObject({ code: 'ARCHIVED_REFERENCE', message: 'Счёт можно перевести в архив только при нулевом балансе' });
    await h.req('PATCH', `${base(cid)}/${acc.id}`, { startingBalance: 0 });
    expect((await h.req('POST', `${base(cid)}/${acc.id}/archive`)).json().account.archivedAt).not.toBeNull();
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/archive`)).statusCode).toBe(200);

    const blocked = await h.req('POST', `${base(cid)}/${acc.id}/unarchive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');
    await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/unarchive`);
    expect((await h.req('POST', `${base(cid)}/${acc.id}/unarchive`)).json().account.archivedAt).toBeNull();
  });

  it('порядок: новый список применяется; устаревший или с повторами — 409 без изменений (Review Focus 5)', async () => {
    h = await createApi();
    const cid = await h.company();
    const ids: number[] = [];
    for (const name of ['A', 'B', 'C']) ids.push((await h.req('POST', base(cid), { ...kaspi, name })).json().account.id);
    const [a, b, c] = ids as [number, number, number];
    const res = await h.req('POST', `${base(cid)}/reorder`, { ids: [c, a, b] });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts.map((x: { name: string }) => x.name)).toEqual(['C', 'A', 'B']);
    const stale = await h.req('POST', `${base(cid)}/reorder`, { ids: [a, b] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    expect((await h.req('POST', `${base(cid)}/reorder`, { ids: [a, a, b] })).statusCode).toBe(409);
    expect(await names(cid)).toEqual(['C', 'A', 'B']);
    await h.req('POST', `${base(cid)}/reorder`, { ids: [c, a, b] }); // тот же порядок — без истории
    expect(h.auditCount('account', 'reorder')).toBe(1);
  });

  it('удаление неиспользуемого счёта; в архивной компании запись запрещена', async () => {
    h = await createApi();
    const cid = await h.company();
    const acc = (await h.req('POST', base(cid), { ...kaspi, startingBalance: 0 })).json().account;
    const keep = (await h.req('POST', base(cid), { ...kaspi, name: 'Касса', startingBalance: 0 })).json().account;
    expect((await h.req('DELETE', `${base(cid)}/${acc.id}`)).statusCode).toBe(204);
    expect(await names(cid)).toEqual(['Касса']);
    expect(h.auditCount('account', 'delete')).toBe(1);

    await h.req('POST', `${base(cid)}/${keep.id}/archive`);
    expect((await h.req('POST', `/api/v1/companies/${cid}/archive`)).statusCode).toBe(200);
    const attempts = [
      ['POST', base(cid), kaspi],
      ['POST', `${base(cid)}/${keep.id}/unarchive`, undefined],
      ['DELETE', `${base(cid)}/${keep.id}`, undefined],
      ['POST', `${base(cid)}/reorder`, { ids: [keep.id] }],
    ] as const;
    for (const [method, url, body] of attempts) {
      const r = await h.req(method, url, body);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('ARCHIVED_REFERENCE');
    }
  });

  it('чужие id → 404, ничего не меняется и не пишется в историю', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const foreign = (await h.req('POST', base(c2), { ...kaspi, startingBalance: 0 })).json().account;
    const before = h.auditCount('account');
    const attempts = [
      ['PATCH', `${base(c1)}/${foreign.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${foreign.id}/archive`, undefined],
      ['POST', `${base(c1)}/${foreign.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${foreign.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('account')).toBe(before);
    expect((await h.req('GET', base(c2))).json().accounts[0]).toMatchObject({ name: 'Kaspi Gold', archivedAt: null });
  });
});
```

`tests/server/accounts.test.ts` — новые импорты и `setup` под новую сигнатуру фабрики, плюс проверка второй строки теста валидации и новый `describe` для заглушек. Импорты целиком:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companies, projects } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { AppError } from '../../src/server/errors';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import type { BalancesService } from '../../src/server/modules/balances/service';
import type { ReferencesService } from '../../src/server/modules/references/service';
import { createTestDb } from '../helpers/test-db';
```

Строку `return { svc: createAccountsService(t.db, …), … }` в `setup()` замените на:

```ts
  const svc = createAccountsService({
    db: t.db,
    audit: createAuditService(t.db),
    timezone: 'Asia/Almaty',
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  });
  return { svc, c1: c1.id, c2: c2.id };
```

В тест «отклоняет неизвестную валюту…» после проверки `'06.10.2026'` добавьте:

```ts
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '2026-02-31' }))).toEqual(['openedAt']);
```

В конец файла:

```ts
describe('accounts: ссылки операций и баланс (заглушки шага 4 подменяются)', () => {
  it('удаление, смена валюты, сдвиг openedAt и архив учитывают операции и баланс', () => {
    t = createTestDb();
    seedCurrencies(t.db);
    const company = t.db.insert(companies).values({ name: 'A', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
    const references: ReferencesService = { countOperations: () => 1, earliestOperationDate: () => '2026-10-01' };
    const balances: BalancesService = { accountBalance: () => 500 };
    const svc = createAccountsService({ db: t.db, audit: createAuditService(t.db), references, balances, timezone: 'Asia/Almaty' });
    const acc = svc.add(company.id, { name: 'Касса', currency: 'KZT', openedAt: '2026-09-01' }, 1);
    const code = (fn: () => unknown): string => {
      try {
        fn();
        return 'OK';
      } catch (e) {
        return (e as AppError).code;
      }
    };
    expect(code(() => svc.remove(company.id, acc.id, 1))).toBe('INVARIANT_9');
    expect(code(() => svc.update(company.id, acc.id, { currency: 'USD' }, 1))).toBe('CURRENCY_LOCKED');
    expect(code(() => svc.update(company.id, acc.id, { openedAt: '2026-10-02' }, 1))).toBe('INVARIANT_6');
    expect(code(() => svc.update(company.id, acc.id, { openedAt: '2026-10-01' }, 1))).toBe('OK');
    expect(code(() => svc.archive(company.id, acc.id, 1))).toBe('ARCHIVED_REFERENCE');
  });
});
```

`tests/server/projects-service.test.ts:20` — новая сигнатура:

```ts
    const accounts = createAccountsService({ db: t.db, audit, timezone: 'Asia/Almaty', now });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/accounts-api.test.ts tests/server/accounts.test.ts`
Expected: FAIL — маршрутов записи нет (404), фабрика принимает `(db, now)`.

- [ ] **Step 3: Implement**

`src/shared/schemas/common.ts`:

```ts
import { z } from 'zod';

/** Новый порядок группы: полный список id без повторов. */
export const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(5000, 'Слишком длинный список'),
});
```

`src/shared/schemas/accounts.ts`:

```ts
import { z } from 'zod';
import { isKnownCurrency } from '../currencies';
import { isValidDate } from '../dates';
import { nameField } from '../text';

/** Название счёта шаблона = префикс + название проекта (до 100), поэтому лимит с запасом. */
export const ACCOUNT_NAME_MAX = 120;

const name = nameField(ACCOUNT_NAME_MAX);
const currency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');
// zod 4 .int() сам отклоняет числа вне безопасного диапазона — поэтому две отдельные проверки
const startingBalance = z
  .number()
  .refine(Number.isInteger, 'Сумма в минимальных единицах — целое число')
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
const openedAt = z.string().refine(isValidDate, 'Неверная дата');
const projectId = z.number().int().positive().nullable();

export const accountCreateSchema = z.object({
  name,
  currency,
  startingBalance: startingBalance.default(0),
  openedAt: openedAt.optional(),
  projectId: projectId.default(null),
});

export const accountUpdateSchema = z.object({
  name: name.optional(),
  currency: currency.optional(),
  startingBalance: startingBalance.optional(),
  openedAt: openedAt.optional(),
  projectId: projectId.optional(),
});
```

`src/server/modules/companies/guard.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { companies } from '../../db/schema';
import { AppError } from '../../errors';

/**
 * Компания по id: 404, если её нет; 422 ARCHIVED_REFERENCE при записи в архивную.
 * Отдельно от CompaniesService, чтобы сервисы справочников не зависели от него по кругу.
 */
export function requireCompany(ex: Executor, id: number, opts: { writable?: boolean } = {}): typeof companies.$inferSelect {
  const row = ex.select().from(companies).where(eq(companies.id, id)).get();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Компания не найдена');
  if (opts.writable && row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Компания в архиве — изменения недоступны');
  return row;
}
```

`src/server/modules/companies/service.ts` — `require` делегирует охраннику (импорт `AppError` остаётся: он нужен в `archive`):

```ts
import { requireCompany } from './guard';
```

```ts
    require(id, opts = {}) {
      return requireCompany(db, id, opts);
    },
```

`src/server/modules/dictionaries/order.ts`:

```ts
import { AppError } from '../../errors';

/** Новый порядок содержит ровно те же элементы без повторов; иначе список устарел (кто-то добавил, удалил или перенёс элемент). */
export function assertSameSet(current: readonly number[], ids: readonly number[]): void {
  const want = new Set(current);
  if (new Set(ids).size !== ids.length || ids.length !== want.size || ids.some((id) => !want.has(id))) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Список изменился — обновите страницу и повторите');
  }
}

/** Порядок не изменился — запись и история не нужны. */
export function isSameOrder(current: readonly number[], ids: readonly number[]): boolean {
  return current.length === ids.length && current.every((id, i) => id === ids[i]);
}
```

`src/server/modules/references/service.ts`:

```ts
export type ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag';

/**
 * Ссылки операций на справочники (инвариант 9) — интерфейс сервиса операций.
 * До шага 4 операций нет: заглушка отвечает «ссылок нет». Шаг 4 подставляет настоящую реализацию с тестами.
 */
export interface ReferencesService {
  /** Сколько операций (включая мягко удалённые) ссылается на элемент справочника. */
  countOperations(entity: ReferenceEntity, id: number): number;
  /** Дата самой ранней операции счёта (`YYYY-MM-DD` в APP_TIMEZONE); null — операций нет. */
  earliestOperationDate(accountId: number): string | null;
}

export function createReferencesService(): ReferencesService {
  return { countOperations: () => 0, earliestOperationDate: () => null };
}
```

`src/server/modules/balances/service.ts`:

```ts
/** Баланс счёта (§4.7). До шага 4 операций нет — баланс равен стартовому остатку. */
export interface BalancesService {
  accountBalance(account: { id: number; startingBalance: number }): number;
}

export function createBalancesService(): BalancesService {
  return { accountBalance: (a) => a.startingBalance };
}
```

`src/server/modules/accounts/service.ts` целиком:

```ts
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { isKnownCurrency } from '../../../shared/currencies';
import { isValidDate, todayInTimezone } from '../../../shared/dates';
import { ACCOUNT_NAME_MAX } from '../../../shared/schemas/accounts';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { createBalancesService, type BalancesService } from '../balances/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export { ACCOUNT_NAME_MAX };

export interface AccountRow {
  id: number;
  companyId: number;
  projectId: number | null;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface AccountInput {
  name: string;
  currency: string;
  startingBalance?: number;
  /** По умолчанию — сегодня в APP_TIMEZONE. */
  openedAt?: string;
  projectId?: number | null;
}

export interface AccountPatch {
  name?: string;
  currency?: string;
  startingBalance?: number;
  openedAt?: string;
  projectId?: number | null;
}

export interface AccountsService {
  /** Низкоуровневое создание внутри чужой транзакции (применение шаблона); историю пишет вызывающий. */
  create(
    ex: Executor,
    input: { companyId: number; projectId?: number | null; name: string; currency: string; startingBalance?: number; openedAt: string },
  ): AccountRow;
  list(companyId: number): AccountRow[];
  countActive(companyId: number, projectId?: number): number;
  /** Все счета проекта, включая архивные (удаление проекта). */
  countByProject(companyId: number, projectId: number): number;
  add(companyId: number, input: AccountInput, userId: number): AccountRow;
  update(companyId: number, id: number, input: AccountPatch, userId: number): AccountRow;
  archive(companyId: number, id: number, userId: number): AccountRow;
  unarchive(companyId: number, id: number, userId: number): AccountRow;
  reorder(companyId: number, ids: number[], userId: number): AccountRow[];
  remove(companyId: number, id: number, userId: number): void;
}

export function createAccountsService(d: {
  db: Db;
  audit: AuditService;
  references?: ReferencesService;
  balances?: BalancesService;
  timezone: string;
  now?: () => Date;
}): AccountsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();
  const balances = d.balances ?? createBalancesService();

  /** Поля счёта; проект — той же компании, новый выбор архивного проекта запрещён (инвариант 7). */
  function validate(ex: Executor, companyId: number, v: AccountPatch): void {
    const fields: Record<string, string> = {};
    if (v.name !== undefined && (v.name.length < 1 || v.name.length > ACCOUNT_NAME_MAX)) {
      fields.name = `Название счёта: от 1 до ${ACCOUNT_NAME_MAX} символов`;
    }
    if (v.currency !== undefined && !isKnownCurrency(v.currency)) fields.currency = 'Неизвестная валюта';
    if (v.startingBalance !== undefined && !Number.isSafeInteger(v.startingBalance)) {
      fields.startingBalance = 'Стартовый баланс — целое число минимальных единиц';
    }
    if (v.openedAt !== undefined && !isValidDate(v.openedAt)) fields.openedAt = 'Неверная дата открытия (ГГГГ-ММ-ДД)';
    let archivedProject = false;
    if (v.projectId !== undefined && v.projectId !== null) {
      const p = ex
        .select({ companyId: projects.companyId, archivedAt: projects.archivedAt })
        .from(projects)
        .where(eq(projects.id, v.projectId))
        .get();
      if (!p || p.companyId !== companyId) fields.projectId = 'Проект не найден в этой компании';
      else if (p.archivedAt) archivedProject = true;
    }
    if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
    if (archivedProject) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — выберите другой');
  }

  function requireAccount(companyId: number, id: number): AccountRow {
    const row = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Счёт не найден');
    return row;
  }

  const svc: AccountsService = {
    create(ex, input) {
      const name = cleanName(input.name);
      const startingBalance = input.startingBalance ?? 0;
      validate(ex, input.companyId, { name, currency: input.currency, startingBalance, openedAt: input.openedAt, projectId: input.projectId ?? null });
      const next = ex
        .select({ m: sql<number>`coalesce(max(${accounts.orderIndex}), -1)` })
        .from(accounts)
        .where(eq(accounts.companyId, input.companyId))
        .get();
      return ex
        .insert(accounts)
        .values({
          companyId: input.companyId,
          projectId: input.projectId ?? null,
          name,
          currency: input.currency,
          startingBalance,
          openedAt: input.openedAt,
          orderIndex: (next?.m ?? -1) + 1,
          createdAt: now().toISOString(),
        })
        .returning()
        .get();
    },

    list(companyId) {
      return db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id)).all();
    },

    countActive(companyId, projectId) {
      const conds = [eq(accounts.companyId, companyId), isNull(accounts.archivedAt)];
      if (projectId !== undefined) conds.push(eq(accounts.projectId, projectId));
      return db.select({ n: count() }).from(accounts).where(and(...conds)).get()?.n ?? 0;
    },

    countByProject(companyId, projectId) {
      return (
        db
          .select({ n: count() })
          .from(accounts)
          .where(and(eq(accounts.companyId, companyId), eq(accounts.projectId, projectId)))
          .get()?.n ?? 0
      );
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, (tx, record) => {
        const row = svc.create(tx, {
          companyId,
          name: input.name,
          currency: input.currency,
          startingBalance: input.startingBalance,
          openedAt: input.openedAt ?? todayInTimezone(d.timezone, now()),
          projectId: input.projectId ?? null,
        });
        record({
          companyId,
          userId,
          entity: 'account',
          entityId: row.id,
          action: 'create',
          diff: { name: row.name, currency: row.currency, startingBalance: row.startingBalance, openedAt: row.openedAt, projectId: row.projectId },
        });
        return row;
      });
    },

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireAccount(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт в архиве — сначала верните его из архива');
      const patch: AccountPatch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields(
        { name: before.name, currency: before.currency, startingBalance: before.startingBalance, openedAt: before.openedAt, projectId: before.projectId },
        patch,
      );
      if (!changes) return before;
      const after = changes.after;
      validate(db, companyId, after);
      if (after.currency !== undefined && references.countOperations('account', id) > 0) {
        throw new AppError(422, 'CURRENCY_LOCKED', 'По счёту есть операции — валюту изменить нельзя');
      }
      if (after.openedAt !== undefined) {
        const earliest = references.earliestOperationDate(id);
        if (earliest !== null && after.openedAt > earliest) {
          throw new AppError(422, 'INVARIANT_6', `Есть операции от ${earliest} — дата открытия не может быть позже`);
        }
      }
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(accounts).set(after).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (row.archivedAt) return row;
      if (balances.accountBalance(row) !== 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт можно перевести в архив только при нулевом балансе');
      }
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(accounts).set({ archivedAt: now().toISOString() }).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'archive' });
        return out;
      });
    },

    unarchive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (!row.archivedAt) return row;
      if (row.projectId !== null) {
        const p = db.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, row.projectId)).get();
        if (p?.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект счёта в архиве — сначала верните проект');
      }
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'unarchive' });
        return out;
      });
    },

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((a) => a.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((accountId, i) => tx.update(accounts).set({ orderIndex: i }).where(eq(accounts.id, accountId)).run());
          record({ companyId, userId, entity: 'account', action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (references.countOperations('account', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На счёт ссылаются операции — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(accounts).where(eq(accounts.id, id)).run();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'delete', diff: { name: row.name, currency: row.currency } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/accounts/routes.ts` целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { accountCreateSchema, accountUpdateSchema } from '../../../shared/schemas/accounts';
import { reorderSchema } from '../../../shared/schemas/common';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { AccountsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/accounts';

export function registerAccountsRoutes(app: FastifyInstance, deps: { accounts: AccountsService; companies: CompaniesService }): void {
  const { accounts } = deps;

  app.get<C>(BASE, async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return { accounts: accounts.list(cid) };
  });

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = accountCreateSchema.parse(req.body);
    return reply.status(201).send({ account: accounts.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { accounts: accounts.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = accountUpdateSchema.parse(req.body);
    return { account: accounts.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    accounts.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    account: accounts.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    account: accounts.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — импорты заглушек и новая сборка сервисов. Добавьте импорты:

```ts
import { createBalancesService } from './modules/balances/service';
import { createReferencesService } from './modules/references/service';
```

и строку `const accounts = createAccountsService(db, now);` замените на:

```ts
  const references = createReferencesService();
  const balances = createBalancesService();
  const accounts = createAccountsService({ db, audit, references, balances, timezone: config.timezone, now });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/accounts-api.test.ts tests/server/accounts.test.ts tests/server/projects.test.ts tests/server/projects-service.test.ts tests/server/companies.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/common.ts src/shared/schemas/accounts.ts src/server/modules/companies src/server/modules/dictionaries src/server/modules/references src/server/modules/balances src/server/modules/accounts src/server/app.ts tests/server/accounts-api.test.ts tests/server/accounts.test.ts tests/server/projects-service.test.ts
git commit -m "feat: API счетов — правка, архив при нулевом балансе, порядок, удаление; заглушки ссылок и баланса

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: API статей — создание, переименование, перенос и порядок, архив, удаление; слияние шаблона после ручного переноса

**Files:**
- Create: `src/shared/schemas/categories.ts`, `tests/server/categories-api.test.ts`
- Modify: `src/server/modules/categories/service.ts` (целиком), `src/server/modules/categories/routes.ts` (целиком), `src/server/app.ts`, `tests/server/categories.test.ts`, `tests/server/projects-service.test.ts:19`

**Interfaces:**
- Consumes:
  - `mutate`, `changedFields` (Task 2);
  - `requireCompany`, `isSameOrder`, `ReferencesService` (Task 4);
  - `cleanName`, `nameField` (Task 1).
- Produces:
  - `CATEGORY_NAME_MAX = 100`, `categoryCreateSchema` (`{ kind, name, parentId }`), `categoryUpdateSchema` (`{ name }`), `categoryReorderSchema` (`{ kind, parentId, ids, moving }`);
  - `createCategoriesService(d: { db; audit; references?; now? })`;
  - `CategoriesService`: прежние методы плюс:
    - `add(companyId, { kind, name, parentId }, userId): CategoryRow`;
    - `rename(companyId, id, name, userId): CategoryRow`;
    - `move(companyId, { kind, parentId, ids, moving? }, userId): void` — `moving` единственная статья, переносимая в этот уровень; другие «лишние» id → 409;
    - `archive`, `unarchive`, `remove`;
  - маршруты:
    - `POST /api/v1/companies/:cid/categories` → 201 `{ category }`;
    - `PATCH …/categories/:id` → `{ category }`;
    - `DELETE …/categories/:id` → 204;
    - `POST …/categories/:id/archive` и `/unarchive` → `{ category }`;
    - `POST …/categories/reorder` → дерево `{ income, expense }`.

- [ ] **Step 1: Write the failing tests**

`tests/server/categories-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

interface Node {
  id: number;
  companyId: number;
  name: string;
  parentId: number | null;
  systemKey: string | null;
  effectiveSystemKey: string | null;
  archivedAt: string | null;
  children: Node[];
}

const base = (cid: number) => `/api/v1/companies/${cid}/categories`;
const tree = async (cid: number) => (await h.req('GET', base(cid))).json() as { income: Node[]; expense: Node[] };
const add = async (cid: number, body: object) => {
  const res = await h.req('POST', base(cid), body);
  if (res.statusCode !== 201) throw new Error(`add: ${res.statusCode} ${res.body}`);
  return res.json().category as Node;
};
const salaryOf = async (cid: number) => (await tree(cid)).expense.find((n) => n.systemKey === 'salary')!;

describe('categories API', () => {
  it('создание: верхний уровень, дочерняя; дочерняя системной наследует systemKey', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: ' Реклама\u200B ' });
    expect(ads).toMatchObject({ name: 'Реклама', parentId: null, systemKey: null });
    await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const salary = await salaryOf(cid);
    await add(cid, { kind: 'expense', name: 'Администраторы', parentId: salary.id });
    const t = await tree(cid);
    expect(t.expense.find((n) => n.id === ads.id)!.children.map((n) => n.name)).toEqual(['Таргет']);
    expect(t.expense.find((n) => n.id === salary.id)!.children[0]).toMatchObject({ name: 'Администраторы', effectiveSystemKey: 'salary' });
    expect(h.auditCount('category', 'create')).toBe(3);
  });

  it('родитель: другого вида, второго уровня, чужой компании — ошибка поля; архивный — 422', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const income = await add(cid, { kind: 'income', name: 'Бар' });
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const child = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const foreign = await add(other, { kind: 'expense', name: 'Чужая' });
    const field = async (parentId: number) => (await h.req('POST', base(cid), { kind: 'expense', name: 'X', parentId })).json().error.fields?.parentId;
    expect(await field(income.id)).toBe('Родительская статья из другого дерева');
    expect(await field(child.id)).toBe('Вложенность — не больше двух уровней');
    expect(await field(foreign.id)).toBe('Родительская статья не найдена');
    const lonely = await add(cid, { kind: 'expense', name: 'Пустая' });
    await h.req('POST', `${base(cid)}/${lonely.id}/archive`);
    const res = await h.req('POST', base(cid), { kind: 'expense', name: 'X', parentId: lonely.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('переименование: системную нельзя, без изменений — без истории, архивную нельзя', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    expect((await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: 'Маркетинг' })).json().category.name).toBe('Маркетинг');
    await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: ' Маркетинг ' });
    expect(h.auditCount('category', 'update')).toBe(1);
    const sys = await h.req('PATCH', `${base(cid)}/${(await salaryOf(cid)).id}`, { name: 'ФОТ' });
    expect(sys.statusCode).toBe(422);
    expect(sys.json().error.code).toBe('SYSTEM_CATEGORY');
    await h.req('POST', `${base(cid)}/${ads.id}/archive`);
    expect((await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: 'Ещё' })).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('перенос и порядок по правилам §7; устаревший список — 409 (Review Focus 5)', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const target = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const print = await add(cid, { kind: 'expense', name: 'Печать' });
    const salary = await salaryOf(cid);
    const income = await add(cid, { kind: 'income', name: 'Бар' });
    const reorder = (body: object) => h.req('POST', `${base(cid)}/reorder`, body);
    const top = async () => (await tree(cid)).expense.map((n) => n.id);

    // «Печать» (без дочерних) — внутрь «Рекламы» после «Таргета»
    let res = await reorder({ kind: 'expense', parentId: ads.id, ids: [target.id, print.id], moving: print.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().expense.find((n: Node) => n.id === ads.id).children.map((n: Node) => n.name)).toEqual(['Таргет', 'Печать']);
    // «Таргет» — на верхний уровень, первым
    res = await reorder({ kind: 'expense', parentId: null, ids: [target.id, ...(await top())], moving: target.id });
    expect(res.statusCode).toBe(200);
    expect((await top())[0]).toBe(target.id);

    const fail = async (body: object, status: number, code: string) => {
      const r = await reorder(body);
      expect(r.statusCode).toBe(status);
      expect(r.json().error.code).toBe(code);
    };
    // у «Рекламы» есть дочерняя «Печать» — её нельзя сделать дочерней
    await fail({ kind: 'expense', parentId: salary.id, ids: [ads.id], moving: ads.id }, 400, 'VALIDATION');
    // системная остаётся на верхнем уровне
    await fail({ kind: 'expense', parentId: ads.id, ids: [print.id, salary.id], moving: salary.id }, 422, 'SYSTEM_CATEGORY');
    // в статью второго уровня нельзя — был бы третий уровень
    await fail({ kind: 'expense', parentId: print.id, ids: [target.id], moving: target.id }, 400, 'VALIDATION');
    // в дерево другого вида нельзя
    await fail({ kind: 'expense', parentId: null, ids: [...(await top()), income.id], moving: income.id }, 400, 'VALIDATION');
    // в саму себя нельзя
    await fail({ kind: 'expense', parentId: target.id, ids: [target.id], moving: target.id }, 400, 'VALIDATION');
    // устаревший список (нет одной статьи уровня)
    await fail({ kind: 'expense', parentId: null, ids: (await top()).slice(1) }, 409, 'VERSION_CONFLICT');
    // устаревший экран: «Печать» уже перенесли в «Рекламу», а старый список верхнего уровня всё ещё содержит её.
    // Порядок без явного moving не должен молча вернуть её наверх.
    await fail({ kind: 'expense', parentId: null, ids: [...(await top()), print.id] }, 409, 'VERSION_CONFLICT');
    expect((await tree(cid)).expense.find((n) => n.id === ads.id)!.children.map((n) => n.id)).toEqual([print.id]);

    const before = h.auditCount('category', 'reorder');
    await reorder({ kind: 'expense', parentId: null, ids: await top() }); // тот же порядок
    expect(h.auditCount('category', 'reorder')).toBe(before);
  });

  it('архив: системные и статьи с активными дочерними — нельзя; дочернюю архивного родителя не вернуть', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const tg = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const act = (id: number, a: 'archive' | 'unarchive') => h.req('POST', `${base(cid)}/${id}/${a}`);
    expect((await act((await salaryOf(cid)).id, 'archive')).json().error.code).toBe('ARCHIVED_REFERENCE');
    const withChild = await act(ads.id, 'archive');
    expect(withChild.statusCode).toBe(422);
    expect(withChild.json().error.message).toBe('Сначала переведите в архив дочерние статьи');
    expect((await act(tg.id, 'archive')).statusCode).toBe(200);
    expect((await act(ads.id, 'archive')).statusCode).toBe(200);
    expect((await act(tg.id, 'unarchive')).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await act(ads.id, 'unarchive')).statusCode).toBe(200);
    expect((await act(tg.id, 'unarchive')).json().category.archivedAt).toBeNull();
  });

  it('удаление: системную и с дочерними нельзя, лист — можно', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const tg = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    expect((await h.req('DELETE', `${base(cid)}/${(await salaryOf(cid)).id}`)).json().error.code).toBe('SYSTEM_CATEGORY');
    expect((await h.req('DELETE', `${base(cid)}/${ads.id}`)).json().error.code).toBe('IN_USE');
    expect((await h.req('DELETE', `${base(cid)}/${tg.id}`)).statusCode).toBe(204);
    expect((await h.req('DELETE', `${base(cid)}/${ads.id}`)).statusCode).toBe(204);
    expect((await tree(cid)).expense.some((n) => n.id === ads.id)).toBe(false);
    expect(h.auditCount('category', 'delete')).toBe(2);
  });

  it('дерево компании не содержит чужих статей; чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = await add(c2, { kind: 'expense', name: 'Чужая' });
    const own = await tree(c1);
    const all = [...own.income, ...own.expense].flatMap((n) => [n, ...n.children]);
    expect(all.every((n) => n.companyId === c1)).toBe(true);
    expect(all.some((n) => n.id === x.id)).toBe(false);

    const before = h.auditCount('category');
    const topIds = own.expense.map((n) => n.id);
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['POST', `${base(c1)}/${x.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
      ['POST', `${base(c1)}/reorder`, { kind: 'expense', parentId: null, ids: [...topIds, x.id] }],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('category')).toBe(before);
  });
});
```

`tests/server/categories.test.ts` — импорт `createAuditService` и новая сигнатура в `setup()`:

```ts
import { createAuditService } from '../../src/server/modules/audit/service';
```

```ts
  const svc = createCategoriesService({ db: t.db, audit: createAuditService(t.db), now: () => new Date('2026-10-06T00:00:00.000Z') });
```

и в конец `describe('categories', …)`:

```ts
  it.each(['moved', 'archived'] as const)(
    'mergeTemplate: группа шаблона %s — новые дочерние встают на верхний уровень (Review Focus 3)',
    (variant) => {
      const { svc, companyId } = setup();
      const club = getTemplate('computer-club')!;
      svc.seedSystem(t.db, companyId);
      svc.mergeTemplate(t.db, companyId, club);
      const s = t.sqlite;
      const premises = s.prepare("SELECT id FROM categories WHERE template_ref = 'computer-club:premises'").get() as { id: number };
      // пользователь убрал дочерние «Помещения», затем перенёс группу в свою или отправил в архив
      s.prepare('DELETE FROM categories WHERE parent_id = ?').run(premises.id);
      if (variant === 'moved') {
        const mine = svc.add(companyId, { kind: 'expense', name: 'Моя группа', parentId: null }, 1);
        s.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(mine.id, premises.id);
      } else {
        s.prepare("UPDATE categories SET archived_at = 'x' WHERE id = ?").run(premises.id);
      }
      expect(svc.mergeTemplate(t.db, companyId, club)).toBe(4);
      const depth3 = s
        .prepare('SELECT COUNT(*) n FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.parent_id IS NOT NULL')
        .get() as { n: number };
      expect(depth3.n).toBe(0);
      const underPremises = s.prepare('SELECT COUNT(*) n FROM categories WHERE parent_id = ?').get(premises.id) as { n: number };
      expect(underPremises.n).toBe(0);
      const rent = s.prepare("SELECT parent_id FROM categories WHERE template_ref = 'computer-club:rent'").get() as { parent_id: number | null };
      expect(rent.parent_id).toBeNull();
    },
  );
```

`tests/server/projects-service.test.ts:19`:

```ts
    const categories = createCategoriesService({ db: t.db, audit, now });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/categories-api.test.ts tests/server/categories.test.ts`
Expected: FAIL — маршрутов записи нет, фабрика принимает `(db, now)`.

- [ ] **Step 3: Implement**

`src/shared/schemas/categories.ts`:

```ts
import { z } from 'zod';
import { nameField } from '../text';

export const CATEGORY_NAME_MAX = 100;

const kind = z.enum(['income', 'expense'], { message: 'Неверный вид статьи' });
const id = z.number().int().positive();

export const categoryCreateSchema = z.object({
  kind,
  name: nameField(CATEGORY_NAME_MAX),
  parentId: id.nullable().default(null),
});

export const categoryUpdateSchema = z.object({ name: nameField(CATEGORY_NAME_MAX) });

/**
 * Новый порядок детей parentId (null — верхний уровень) в дереве kind. `moving` — единственная статья,
 * которая переносится сюда из другого места; null — только смена порядка.
 */
export const categoryReorderSchema = z.object({
  kind,
  parentId: id.nullable(),
  ids: z.array(id).max(1000, 'Слишком длинный список'),
  moving: id.nullable().default(null),
});
```

`src/server/modules/categories/service.ts` целиком:

```ts
import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory, type CategoryKind, type SystemKey } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import { isUnderSystem, type BusinessTemplate } from '../../../templates/types';
import type { Db, Executor } from '../../db/client';
import { categories } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export interface CategoryRow {
  id: number;
  companyId: number;
  kind: CategoryKind;
  parentId: number | null;
  name: string;
  systemKey: SystemKey | null;
  templateRef: string | null;
  orderIndex: number;
  archivedAt: string | null;
}

export interface CategoryNodeDto extends CategoryRow {
  effectiveSystemKey: SystemKey | null;
  children: CategoryNodeDto[];
}

export interface CategoriesService {
  seedSystem(ex: Executor, companyId: number): void;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number;
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
  add(companyId: number, input: { kind: CategoryKind; name: string; parentId: number | null }, userId: number): CategoryRow;
  rename(companyId: number, id: number, name: string, userId: number): CategoryRow;
  /** Новый порядок детей parentId (null — верхний уровень) дерева kind; статьи из других мест переносятся сюда. */
  move(companyId: number, input: { kind: CategoryKind; parentId: number | null; ids: number[]; moving?: number | null }, userId: number): void;
  archive(companyId: number, id: number, userId: number): CategoryRow;
  unarchive(companyId: number, id: number, userId: number): CategoryRow;
  remove(companyId: number, id: number, userId: number): void;
}

function toRow(r: typeof categories.$inferSelect): CategoryRow {
  return {
    id: r.id,
    companyId: r.companyId,
    kind: r.kind,
    parentId: r.parentId,
    name: r.name,
    systemKey: r.systemKey as SystemKey | null,
    templateRef: r.templateRef,
    orderIndex: r.orderIndex,
    archivedAt: r.archivedAt,
  };
}

const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [field]: message });

export function createCategoriesService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): CategoriesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function levelCondition(companyId: number, kind: CategoryKind, parentId: number | null): SQL | undefined {
    return and(
      eq(categories.companyId, companyId),
      eq(categories.kind, kind),
      parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
    );
  }

  function nextOrder(ex: Executor, companyId: number, kind: CategoryKind, parentId: number | null): number {
    const row = ex
      .select({ m: sql<number>`coalesce(max(${categories.orderIndex}), -1)` })
      .from(categories)
      .where(levelCondition(companyId, kind, parentId))
      .get();
    return (row?.m ?? -1) + 1;
  }

  function insert(
    ex: Executor,
    v: { companyId: number; kind: CategoryKind; parentId: number | null; name: string; systemKey?: SystemKey; templateRef?: string },
  ) {
    return ex
      .insert(categories)
      .values({
        companyId: v.companyId,
        kind: v.kind,
        parentId: v.parentId,
        name: v.name,
        systemKey: v.systemKey ?? null,
        templateRef: v.templateRef ?? null,
        orderIndex: nextOrder(ex, v.companyId, v.kind, v.parentId),
        createdAt: now().toISOString(),
      })
      .returning()
      .get();
  }

  function findByRef(ex: Executor, companyId: number, kind: CategoryKind, ref: string) {
    return ex
      .select()
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.templateRef, ref)))
      .get();
  }

  function find(companyId: number, id: number) {
    return db.select().from(categories).where(and(eq(categories.id, id), eq(categories.companyId, companyId))).get();
  }

  function requireCategory(companyId: number, id: number): CategoryRow {
    const r = find(companyId, id);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Статья не найдена');
    return toRow(r);
  }

  function childIds(companyId: number, kind: CategoryKind, parentId: number | null): number[] {
    return db
      .select({ id: categories.id })
      .from(categories)
      .where(levelCondition(companyId, kind, parentId))
      .orderBy(asc(categories.orderIndex), asc(categories.id))
      .all()
      .map((r) => r.id);
  }

  function hasChildren(id: number, activeOnly = false): boolean {
    const conds: SQL[] = [eq(categories.parentId, id)];
    if (activeOnly) conds.push(isNull(categories.archivedAt));
    return (db.select({ n: count() }).from(categories).where(and(...conds)).get()?.n ?? 0) > 0;
  }

  /** Родитель для вложения: та же компания и вид, верхний уровень, не в архиве (вложенность ≤ 2). */
  function checkParent(companyId: number, kind: CategoryKind, parentId: number): void {
    const p = find(companyId, parentId);
    if (!p) throw invalid('parentId', 'Родительская статья не найдена');
    if (p.kind !== kind) throw invalid('parentId', 'Родительская статья из другого дерева');
    if (p.parentId !== null) throw invalid('parentId', 'Вложенность — не больше двух уровней');
    if (p.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Родительская статья в архиве');
  }

  function setArchived(companyId: number, id: number, userId: number, archivedAt: string | null): CategoryRow {
    return mutate(db, audit, (tx, record) => {
      const out = toRow(tx.update(categories).set({ archivedAt }).where(eq(categories.id, id)).returning().get());
      record({ companyId, userId, entity: 'category', entityId: id, action: archivedAt ? 'archive' : 'unarchive' });
      return out;
    });
  }

  const svc: CategoriesService = {
    seedSystem(ex, companyId) {
      for (const def of SYSTEM_CATEGORIES) {
        insert(ex, { companyId, kind: def.kind, parentId: null, name: def.name, systemKey: def.key });
      }
    },

    mergeTemplate(ex, companyId, template) {
      let created = 0;
      for (const kind of ['income', 'expense'] as const) {
        for (const node of template.categories[kind]) {
          let parentId: number | null;
          if (isUnderSystem(node)) {
            if (systemCategory(node.underSystem).kind !== kind) {
              throw new Error(`Системная статья ${node.underSystem} не относится к виду ${kind}`);
            }
            const sys = ex
              .select()
              .from(categories)
              .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.systemKey, node.underSystem)))
              .get();
            if (!sys) throw new Error(`В компании ${companyId} нет системной статьи ${node.underSystem}`);
            parentId = sys.id;
          } else {
            const existing = findByRef(ex, companyId, kind, node.ref);
            if (existing) {
              // группу перенесли во второй уровень или в архив — новые дочерние встают на верхний уровень
              parentId = existing.parentId === null && !existing.archivedAt ? existing.id : null;
            } else {
              parentId = insert(ex, { companyId, kind, parentId: null, name: node.name, templateRef: node.ref }).id;
              created++;
            }
          }
          for (const child of node.children ?? []) {
            if (findByRef(ex, companyId, kind, child.ref)) continue;
            insert(ex, { companyId, kind, parentId, name: child.name, templateRef: child.ref });
            created++;
          }
        }
      }
      return created;
    },

    listTree(companyId) {
      const rows = db
        .select()
        .from(categories)
        .where(eq(categories.companyId, companyId))
        .orderBy(asc(categories.orderIndex), asc(categories.id))
        .all()
        .map(toRow);
      const byId = new Map<number, CategoryNodeDto>();
      for (const r of rows) byId.set(r.id, { ...r, effectiveSystemKey: r.systemKey, children: [] });
      const result = { income: [] as CategoryNodeDto[], expense: [] as CategoryNodeDto[] };
      for (const node of byId.values()) {
        const parent = node.parentId === null ? undefined : byId.get(node.parentId);
        if (parent) {
          node.effectiveSystemKey = effectiveSystemKey(node.systemKey, parent.systemKey);
          parent.children.push(node);
        } else {
          result[node.kind].push(node);
        }
      }
      return result;
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      if (input.parentId !== null) checkParent(companyId, input.kind, input.parentId);
      return mutate(db, audit, (tx, record) => {
        const row = toRow(insert(tx, { companyId, kind: input.kind, parentId: input.parentId, name: cleanName(input.name) }));
        record({ companyId, userId, entity: 'category', entityId: row.id, action: 'create', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
        return row;
      });
    },

    rename(companyId, id, name, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireCategory(companyId, id);
      if (before.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную статью нельзя переименовать');
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Статья в архиве — сначала верните её из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(name) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = toRow(tx.update(categories).set(changes.after).where(eq(categories.id, id)).returning().get());
        record({ companyId, userId, entity: 'category', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    move(companyId, { kind, parentId, ids, moving = null }, userId) {
      requireCompany(db, companyId, { writable: true });
      if (parentId !== null) checkParent(companyId, kind, parentId);
      const current = childIds(companyId, kind, parentId);
      const stale = () => new AppError(409, 'VERSION_CONFLICT', 'Список изменился — обновите страницу и повторите');
      if (new Set(ids).size !== ids.length || current.some((id) => !ids.includes(id))) throw stale();
      const moved: number[] = [];
      for (const id of ids) {
        if (current.includes(id)) continue;
        const c = requireCategory(companyId, id); // чужой id — 404
        // переносится только явно названная статья; любая другая «лишняя» значит, что экран устарел
        // (её уже перенёс другой пользователь) — молча вернуть её назад нельзя
        if (id !== moving) throw stale();
        if (c.kind !== kind) throw invalid('ids', 'Статью нельзя перенести в дерево другого вида');
        if (parentId !== null) {
          if (c.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системная статья остаётся на верхнем уровне');
          if (c.id === parentId) throw invalid('ids', 'Статью нельзя вложить в саму себя');
          if (hasChildren(c.id)) throw invalid('ids', 'Статью с дочерними нельзя сделать дочерней');
        }
        if (c.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Статья в архиве — сначала верните её из архива');
        moved.push(id);
      }
      if (moved.length === 0 && isSameOrder(current, ids)) return;
      mutate(db, audit, (tx, record) => {
        ids.forEach((categoryId, i) => tx.update(categories).set({ parentId, orderIndex: i }).where(eq(categories.id, categoryId)).run());
        record({ companyId, userId, entity: 'category', action: 'reorder', diff: { kind, parentId, ids, moved } });
      });
    },

    archive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Системные статьи не архивируются');
      if (row.archivedAt) return row;
      if (hasChildren(id, true)) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив дочерние статьи');
      return setArchived(companyId, id, userId, now().toISOString());
    },

    unarchive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (!row.archivedAt) return row;
      if (row.parentId !== null && find(companyId, row.parentId)?.archivedAt) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала верните из архива родительскую статью');
      }
      return setArchived(companyId, id, userId, null);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную статью нельзя удалить');
      if (hasChildren(id)) throw new AppError(422, 'IN_USE', 'Сначала удалите или перенесите дочерние статьи');
      if (references.countOperations('category', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На статью ссылаются операции — её можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(categories).where(eq(categories.id, id)).run();
        record({ companyId, userId, entity: 'category', entityId: id, action: 'delete', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/categories/routes.ts` целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { categoryCreateSchema, categoryReorderSchema, categoryUpdateSchema } from '../../../shared/schemas/categories';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { CategoriesService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/categories';

export function registerCategoriesRoutes(app: FastifyInstance, deps: { categories: CategoriesService; companies: CompaniesService }): void {
  const { categories } = deps;

  app.get<C>(BASE, async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return categories.listTree(cid);
  });

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = categoryCreateSchema.parse(req.body);
    return reply.status(201).send({ category: categories.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = categoryReorderSchema.parse(req.body);
    categories.move(cid, body, req.user!.id);
    return categories.listTree(cid);
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { name } = categoryUpdateSchema.parse(req.body);
    return { category: categories.rename(cid, id, name, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    categories.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    category: categories.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    category: categories.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — строку `const categories = createCategoriesService(db, now);` перенесите **после** создания `references` и замените:

```ts
  const references = createReferencesService();
  const balances = createBalancesService();
  const categories = createCategoriesService({ db, audit, references, now });
  const accounts = createAccountsService({ db, audit, references, balances, timezone: config.timezone, now });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/categories-api.test.ts tests/server/categories.test.ts tests/server/projects.test.ts tests/server/projects-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/categories.ts src/server/modules/categories src/server/app.ts tests/server/categories-api.test.ts tests/server/categories.test.ts tests/server/projects-service.test.ts
git commit -m "feat: API статей — перенос по правилам дерева, архив, удаление; слияние шаблона после ручного переноса

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: API контрагентов и тегов

**Files:**
- Create: `src/shared/schemas/counterparties.ts`, `src/shared/schemas/tags.ts`, `src/server/modules/counterparties/service.ts`, `src/server/modules/counterparties/routes.ts`, `src/server/modules/tags/service.ts`, `src/server/modules/tags/routes.ts`, `tests/server/counterparties.test.ts`, `tests/server/tags.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes:
  - таблицы `counterparties`, `tags`, `COUNTERPARTY_TYPES` (Task 3);
  - `mutate`, `changedFields` (Task 2);
  - `requireCompany`, `assertSameSet`, `isSameOrder`, `ReferencesService`, `reorderSchema` (Task 4);
  - `cleanName`, `nameField`, `foldCase` (Task 1).
- Produces:
  - `COUNTERPARTY_NAME_MAX = 200`, `COUNTERPARTY_COMMENT_MAX = 1000`, `counterpartyCreateSchema`, `counterpartyUpdateSchema`;
  - `TAG_NAME_MAX = 50`, `tagSchema`;
  - `createCounterpartiesService(d: { db; audit; references?; now? })` и `createTagsService(d: { db; audit; references?; now? })`: `list`, `add`, `update`, `archive`, `unarchive`, `reorder`, `remove`;
  - маршруты `/api/v1/companies/:cid/counterparties` и `/api/v1/companies/:cid/tags`:
    - `GET` → `{ counterparties }` / `{ tags }`;
    - `POST` → 201 `{ counterparty }` / `{ tag }`;
    - `PATCH /:id`;
    - `DELETE /:id` → 204;
    - `POST /:id/archive`, `/:id/unarchive`;
    - `POST /reorder` → `{ counterparties }` / `{ tags }`;
  - ошибка тега с именем архивного: 422 `ARCHIVED_DUPLICATE`, `fields.name = 'Такой тег есть в архиве'`.

- [ ] **Step 1: Write the failing tests**

`tests/server/counterparties.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { COUNTERPARTY_TYPES } from '../../src/shared/counterparties';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/counterparties`;

describe('counterparties API', () => {
  it('создание всех типов; пустой комментарий → null; неизвестный тип — ошибка поля', async () => {
    h = await createApi();
    const cid = await h.company();
    for (const type of COUNTERPARTY_TYPES) {
      const res = await h.req('POST', base(cid), { type, name: `К ${type}`, comment: '   ' });
      expect(res.statusCode).toBe(201);
      expect(res.json().counterparty).toMatchObject({ type, comment: null, archivedAt: null });
    }
    const bad = await h.req('POST', base(cid), { type: 'friend', name: 'X' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.type).toBe('Выберите тип контрагента');
    const list = (await h.req('GET', base(cid))).json().counterparties;
    expect(list).toHaveLength(COUNTERPARTY_TYPES.length);
    expect(h.auditCount('counterparty', 'create')).toBe(COUNTERPARTY_TYPES.length);
  });

  it('правка, архив, порядок и удаление; PATCH без изменений не пишет историю', async () => {
    h = await createApi();
    const cid = await h.company();
    const a = (await h.req('POST', base(cid), { type: 'supplier', name: 'ИП Иванов', comment: 'аренда' })).json().counterparty;
    const b = (await h.req('POST', base(cid), { type: 'client', name: 'ТОО Альфа' })).json().counterparty;
    const upd = await h.req('PATCH', `${base(cid)}/${a.id}`, { type: 'employee', comment: '' });
    expect(upd.json().counterparty).toMatchObject({ type: 'employee', name: 'ИП Иванов', comment: null });
    await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'ИП  Иванов', comment: null });
    expect(h.auditCount('counterparty', 'update')).toBe(1);

    const order = await h.req('POST', `${base(cid)}/reorder`, { ids: [b.id, a.id] });
    expect(order.json().counterparties.map((c: { id: number }) => c.id)).toEqual([b.id, a.id]);
    expect((await h.req('POST', `${base(cid)}/reorder`, { ids: [a.id] })).statusCode).toBe(409);

    expect((await h.req('POST', `${base(cid)}/${a.id}/archive`)).json().counterparty.archivedAt).not.toBeNull();
    expect((await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'Y' })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await h.req('POST', `${base(cid)}/${a.id}/unarchive`)).json().counterparty.archivedAt).toBeNull();
    expect((await h.req('DELETE', `${base(cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('GET', base(cid))).json().counterparties.map((c: { id: number }) => c.id)).toEqual([b.id]);
  });

  it('чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = (await h.req('POST', base(c2), { type: 'client', name: 'Чужой' })).json().counterparty;
    const before = h.auditCount('counterparty');
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['POST', `${base(c1)}/${x.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    // в списке порядка компании 1 чужого id нет — список не совпадает с текущим
    expect((await h.req('POST', `${base(c1)}/reorder`, { ids: [x.id] })).statusCode).toBe(409);
    expect(h.auditCount('counterparty')).toBe(before);
    expect((await h.req('GET', base(c2))).json().counterparties[0]).toMatchObject({ name: 'Чужой', archivedAt: null });
  });
});
```

`tests/server/tags.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/tags`;

describe('tags API', () => {
  it('тег уникален без учёта регистра, «ё» и невидимых символов', async () => {
    h = await createApi();
    const cid = await h.company();
    expect((await h.req('POST', base(cid), { name: 'Ёлка' })).statusCode).toBe(201);
    for (const name of ['ёлка', 'ЕЛКА', ' Елка\u200B ']) {
      const res = await h.req('POST', base(cid), { name });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.name).toBe('Такой тег уже есть');
    }
  });

  it('имя архивного тега: 422 ARCHIVED_DUPLICATE, дубль не создаётся (Review Focus 4)', async () => {
    h = await createApi();
    const cid = await h.company();
    const tag = (await h.req('POST', base(cid), { name: 'елка' })).json().tag;
    await h.req('POST', `${base(cid)}/${tag.id}/archive`);
    const res = await h.req('POST', base(cid), { name: 'Ёлка\u200B' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'ARCHIVED_DUPLICATE', fields: { name: 'Такой тег есть в архиве' } });
    expect((await h.req('GET', base(cid))).json().tags).toHaveLength(1);
    expect((await h.req('POST', `${base(cid)}/${tag.id}/unarchive`)).json().tag.archivedAt).toBeNull();
  });

  it('переименование (в том числе смена регистра), удаление освобождает имя, в другой компании имя свободно', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const a = (await h.req('POST', base(cid), { name: 'аренда' })).json().tag;
    const b = (await h.req('POST', base(cid), { name: 'бар' })).json().tag;
    expect((await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'Аренда' })).json().tag.name).toBe('Аренда');
    expect((await h.req('PATCH', `${base(cid)}/${b.id}`, { name: 'АРЕНДА' })).json().error.fields.name).toBe('Такой тег уже есть');
    expect((await h.req('POST', base(other), { name: 'Аренда' })).statusCode).toBe(201);
    expect((await h.req('DELETE', `${base(cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('POST', base(cid), { name: 'Аренда' })).statusCode).toBe(201);
    const order = await h.req('POST', `${base(cid)}/reorder`, {
      ids: (await h.req('GET', base(cid))).json().tags.map((t: { id: number }) => t.id).reverse(),
    });
    expect(order.json().tags.map((t: { name: string }) => t.name)).toEqual(['Аренда', 'бар']);
  });

  it('чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = (await h.req('POST', base(c2), { name: 'чужой' })).json().tag;
    const before = h.auditCount('tag');
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('tag')).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/counterparties.test.ts tests/server/tags.test.ts`
Expected: FAIL — маршруты 404.

- [ ] **Step 3: Implement**

`src/shared/schemas/counterparties.ts`:

```ts
import { z } from 'zod';
import { COUNTERPARTY_TYPES } from '../counterparties';
import { nameField } from '../text';

export const COUNTERPARTY_NAME_MAX = 200;
export const COUNTERPARTY_COMMENT_MAX = 1000;

const type = z.enum(COUNTERPARTY_TYPES, { message: 'Выберите тип контрагента' });
/** Пустой комментарий хранится как null. */
const comment = z
  .string()
  .trim()
  .max(COUNTERPARTY_COMMENT_MAX, `Не длиннее ${COUNTERPARTY_COMMENT_MAX} символов`)
  .nullable()
  .transform((v) => v || null);

export const counterpartyCreateSchema = z.object({
  type,
  name: nameField(COUNTERPARTY_NAME_MAX),
  comment: comment.optional(),
});

export const counterpartyUpdateSchema = z.object({
  type: type.optional(),
  name: nameField(COUNTERPARTY_NAME_MAX).optional(),
  comment: comment.optional(),
});
```

`src/shared/schemas/tags.ts`:

```ts
import { z } from 'zod';
import { nameField } from '../text';

export const TAG_NAME_MAX = 50;

export const tagSchema = z.object({ name: nameField(TAG_NAME_MAX) });
```

`src/server/modules/counterparties/service.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CounterpartyType } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { counterparties } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export type CounterpartyRow = typeof counterparties.$inferSelect;

export interface CounterpartyInput {
  type: CounterpartyType;
  name: string;
  comment?: string | null;
}

export interface CounterpartiesService {
  list(companyId: number): CounterpartyRow[];
  add(companyId: number, input: CounterpartyInput, userId: number): CounterpartyRow;
  update(companyId: number, id: number, input: Partial<CounterpartyInput>, userId: number): CounterpartyRow;
  archive(companyId: number, id: number, userId: number): CounterpartyRow;
  unarchive(companyId: number, id: number, userId: number): CounterpartyRow;
  reorder(companyId: number, ids: number[], userId: number): CounterpartyRow[];
  remove(companyId: number, id: number, userId: number): void;
}

const ENTITY = 'counterparty';

export function createCounterpartiesService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): CounterpartiesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function requireRow(companyId: number, id: number): CounterpartyRow {
    const row = db.select().from(counterparties).where(and(eq(counterparties.id, id), eq(counterparties.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Контрагент не найден');
    return row;
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): CounterpartyRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx
        .update(counterparties)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(counterparties.id, id))
        .returning()
        .get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  const svc: CounterpartiesService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(counterparties)
        .where(eq(counterparties.companyId, companyId))
        .orderBy(asc(counterparties.orderIndex), asc(counterparties.id))
        .all();
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${counterparties.orderIndex}), -1)` })
          .from(counterparties)
          .where(eq(counterparties.companyId, companyId))
          .get();
        const row = tx
          .insert(counterparties)
          .values({
            companyId,
            type: input.type,
            name: cleanName(input.name),
            comment: input.comment ?? null,
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get();
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { type: row.type, name: row.name, comment: row.comment } });
        return row;
      });
    },

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Контрагент в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ type: before.type, name: before.name, comment: before.comment }, patch);
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(counterparties).set(changes.after).where(eq(counterparties.id, id)).returning().get();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((r) => r.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((rowId, i) => tx.update(counterparties).set({ orderIndex: i }).where(eq(counterparties.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      if (references.countOperations('counterparty', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На контрагента ссылаются операции — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(counterparties).where(eq(counterparties.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { type: row.type, name: row.name } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/counterparties/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { counterpartyCreateSchema, counterpartyUpdateSchema } from '../../../shared/schemas/counterparties';
import { parseId } from '../../http/params';
import type { CounterpartiesService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/counterparties';

export function registerCounterpartiesRoutes(app: FastifyInstance, deps: { counterparties: CounterpartiesService }): void {
  const svc = deps.counterparties;

  app.get<C>(BASE, async (req) => ({ counterparties: svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = counterpartyCreateSchema.parse(req.body);
    return reply.status(201).send({ counterparty: svc.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { counterparties: svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = counterpartyUpdateSchema.parse(req.body);
    return { counterparty: svc.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    counterparty: svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    counterparty: svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/modules/tags/service.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export type TagRow = typeof tags.$inferSelect;

export interface TagsService {
  list(companyId: number): TagRow[];
  add(companyId: number, name: string, userId: number): TagRow;
  rename(companyId: number, id: number, name: string, userId: number): TagRow;
  archive(companyId: number, id: number, userId: number): TagRow;
  unarchive(companyId: number, id: number, userId: number): TagRow;
  reorder(companyId: number, ids: number[], userId: number): TagRow[];
  remove(companyId: number, id: number, userId: number): void;
}

const ENTITY = 'tag';

/** Ключ уникальности тега: без учёта регистра, «ё» и невидимых символов. */
export function tagKey(name: string): string {
  return foldCase(cleanName(name));
}

export function createTagsService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): TagsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function requireRow(companyId: number, id: number): TagRow {
    const row = db.select().from(tags).where(and(eq(tags.id, id), eq(tags.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Тег не найден');
    return row;
  }

  /** Имя свободно в компании, включая архивные теги; архивный дубль — предложение вернуть его. */
  function assertNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db.select().from(tags).where(and(eq(tags.companyId, companyId), eq(tags.nameKey, tagKey(name)))).get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Тег «${clash.name}» есть в архиве — верните его из архива`, {
        name: 'Такой тег есть в архиве',
      });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такой тег уже есть' });
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): TagRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(tags).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(tags.id, id)).returning().get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  const svc: TagsService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db.select().from(tags).where(eq(tags.companyId, companyId)).orderBy(asc(tags.orderIndex), asc(tags.id)).all();
    },

    add(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(rawName);
      assertNameFree(companyId, name);
      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${tags.orderIndex}), -1)` })
          .from(tags)
          .where(eq(tags.companyId, companyId))
          .get();
        const row = tx
          .insert(tags)
          .values({ companyId, name, nameKey: tagKey(name), orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
          .returning()
          .get();
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name } });
        return row;
      });
    },

    rename(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Тег в архиве — сначала верните его из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      const name = changes.after.name!;
      assertNameFree(companyId, name, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(tags).set({ name, nameKey: tagKey(name) }).where(eq(tags.id, id)).returning().get();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((r) => r.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((rowId, i) => tx.update(tags).set({ orderIndex: i }).where(eq(tags.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      if (references.countOperations('tag', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'Тег стоит на операциях — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(tags).where(eq(tags.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/tags/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { tagSchema } from '../../../shared/schemas/tags';
import { parseId } from '../../http/params';
import type { TagsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/tags';

export function registerTagsRoutes(app: FastifyInstance, deps: { tags: TagsService }): void {
  const svc = deps.tags;

  app.get<C>(BASE, async (req) => ({ tags: svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const { name } = tagSchema.parse(req.body);
    return reply.status(201).send({ tag: svc.add(cid, name, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { tags: svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { name } = tagSchema.parse(req.body);
    return { tag: svc.rename(cid, id, name, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    tag: svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    tag: svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — импорты:

```ts
import { registerCounterpartiesRoutes } from './modules/counterparties/routes';
import { createCounterpartiesService } from './modules/counterparties/service';
import { registerTagsRoutes } from './modules/tags/routes';
import { createTagsService } from './modules/tags/service';
```

и после `registerAccountsRoutes(app, { accounts, companies });`:

```ts
  registerCounterpartiesRoutes(app, { counterparties: createCounterpartiesService({ db, audit, references, now }) });
  registerTagsRoutes(app, { tags: createTagsService({ db, audit, references, now }) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/counterparties.test.ts tests/server/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/counterparties.ts src/shared/schemas/tags.ts src/server/modules/counterparties src/server/modules/tags src/server/app.ts tests/server/counterparties.test.ts tests/server/tags.test.ts
git commit -m "feat: API контрагентов и тегов; тег с именем архивного предлагает восстановление

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: API шаблонов разделения

**Files:**
- Create: `src/shared/percent.ts`, `src/shared/schemas/split-presets.ts`, `src/server/modules/split-presets/service.ts`, `src/server/modules/split-presets/routes.ts`, `tests/shared/percent.test.ts`, `tests/server/split-presets.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes:
  - таблица `splitPresets` (Task 3);
  - `mutate`, `changedFields` (Task 2);
  - `requireCompany`, `assertSameSet`, `isSameOrder`, `reorderSchema` (Task 4);
  - `nameField`, `cleanName` (Task 1).
- Produces:
  - `parsePercentToBp(text: string): number | null`, `formatBp(bp: number): string`;
  - `SPLIT_TOTAL_BP = 10000`, `SPLIT_PRESET_NAME_MAX = 100`, `splitPresetCreateSchema` (`{ name, lines }`), `splitPresetUpdateSchema`;
  - `SplitLine { categoryId: number | null; projectId: number | null; bp: number }`;
  - `createSplitPresetsService(d: { db; audit; now? })`: `list`, `add`, `update`, `archive`, `unarchive`, `reorder`, `remove`;
  - маршруты `/api/v1/companies/:cid/split-presets`, формы ответа `{ splitPreset }` / `{ splitPresets }`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/percent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBp, parsePercentToBp } from '../../src/shared/percent';

describe('проценты в сотых долях (bp)', () => {
  it('parsePercentToBp: запятая и точка, до двух знаков, знак %', () => {
    expect(parsePercentToBp('50')).toBe(5000);
    expect(parsePercentToBp('33,33')).toBe(3333);
    expect(parsePercentToBp('33.3')).toBe(3330);
    expect(parsePercentToBp(' 12,5 % ')).toBe(1250);
    expect(parsePercentToBp('0,01')).toBe(1);
    expect(parsePercentToBp('1,234')).toBeNull();
    expect(parsePercentToBp('-5')).toBeNull();
    expect(parsePercentToBp('abc')).toBeNull();
    expect(parsePercentToBp('')).toBeNull();
  });

  it('formatBp: без лишних нулей', () => {
    expect(formatBp(5000)).toBe('50');
    expect(formatBp(3333)).toBe('33,33');
    expect(formatBp(3330)).toBe('33,3');
    expect(formatBp(1)).toBe('0,01');
    expect(formatBp(10000)).toBe('100');
  });
});
```

`tests/server/split-presets.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/split-presets`;

async function world() {
  h = await createApi();
  const cid = await h.company();
  const other = await h.company();
  const project = async (c: number, name: string) =>
    (await h.req('POST', `/api/v1/companies/${c}/projects`, { name, templateKey: 'general' })).json().project.id as number;
  const category = async (c: number, kind: string, name: string) =>
    (await h.req('POST', `/api/v1/companies/${c}/categories`, { kind, name })).json().category.id as number;
  return {
    cid,
    other,
    p1: await project(cid, 'Клуб 1'),
    p2: await project(cid, 'Клуб 2'),
    rent: await category(cid, 'expense', 'Аренда'),
    bar: await category(cid, 'income', 'Бар'),
    foreignCategory: await category(other, 'expense', 'Чужая'),
    project,
  };
}

describe('split-presets API', () => {
  it('создание: доли в сумме 100%, строки со статьёй и/или проектом', async () => {
    const w = await world();
    const res = await h.req('POST', base(w.cid), {
      name: 'Аренда пополам',
      lines: [
        { categoryId: w.rent, projectId: w.p1, bp: 6000 },
        { categoryId: w.rent, projectId: w.p2, bp: 4000 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().splitPreset).toMatchObject({
      name: 'Аренда пополам',
      lines: [
        { categoryId: w.rent, projectId: w.p1, bp: 6000 },
        { categoryId: w.rent, projectId: w.p2, bp: 4000 },
      ],
    });
    const onlyProjects = await h.req('POST', base(w.cid), { name: 'Проекты', lines: [{ projectId: w.p1, bp: 10000 }] });
    expect(onlyProjects.json().splitPreset.lines).toEqual([{ categoryId: null, projectId: w.p1, bp: 10000 }]);
    expect(h.auditCount('split_preset', 'create')).toBe(2);
  });

  it('проверки строк: сумма ≠ 100%, пустая строка, повтор, разные виды статей', async () => {
    const w = await world();
    const linesError = async (lines: object[]) => (await h.req('POST', base(w.cid), { name: 'X', lines })).json().error.fields.lines;
    expect(await linesError([{ projectId: w.p1, bp: 5000 }, { projectId: w.p2, bp: 4999 }])).toBe('Сумма долей должна быть 100% (сейчас 99,99%)');
    expect(await linesError([{ bp: 10000 }])).toBe('В каждой строке укажите статью или проект');
    expect(await linesError([{ projectId: w.p1, bp: 5000 }, { projectId: w.p1, bp: 5000 }])).toBe('Строки повторяются');
    expect(await linesError([{ categoryId: w.rent, bp: 5000 }, { categoryId: w.bar, bp: 5000 }])).toBe('Статьи шаблона должны быть одного вида');
    expect(await linesError([])).toBe('Добавьте хотя бы одну строку');
  });

  it('чужие статьи и проекты — ошибка поля; архивные — 422', async () => {
    const w = await world();
    const foreign = await h.req('POST', base(w.cid), { name: 'X', lines: [{ categoryId: w.foreignCategory, bp: 10000 }] });
    expect(foreign.json().error.fields.lines).toBe('Статья не найдена в этой компании');
    const foreignProject = await w.project(w.other, 'Чужой');
    const fp = await h.req('POST', base(w.cid), { name: 'X', lines: [{ projectId: foreignProject, bp: 10000 }] });
    expect(fp.json().error.fields.lines).toBe('Проект не найден в этой компании');
    await h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.p2}/archive`);
    const archived = await h.req('POST', base(w.cid), { name: 'X', lines: [{ projectId: w.p2, bp: 10000 }] });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('правка имени не перепроверяет старые строки (инвариант 10); архив, порядок, удаление, чужие id', async () => {
    const w = await world();
    const a = (await h.req('POST', base(w.cid), { name: 'A', lines: [{ projectId: w.p2, bp: 10000 }] })).json().splitPreset;
    const b = (await h.req('POST', base(w.cid), { name: 'B', lines: [{ projectId: w.p1, bp: 10000 }] })).json().splitPreset;
    await h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.p2}/archive`);
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { name: 'A2' })).json().splitPreset.name).toBe('A2');
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { lines: [{ projectId: w.p2, bp: 10000 }] })).statusCode).toBe(200); // не изменились
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { lines: [{ projectId: w.p2, bp: 5000 }, { projectId: w.p1, bp: 5000 }] })).statusCode).toBe(422);
    expect(h.auditCount('split_preset', 'update')).toBe(1);

    expect((await h.req('POST', `${base(w.cid)}/reorder`, { ids: [b.id, a.id] })).json().splitPresets.map((p: { name: string }) => p.name)).toEqual(['B', 'A2']);
    expect((await h.req('POST', `${base(w.cid)}/${a.id}/archive`)).json().splitPreset.archivedAt).not.toBeNull();
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { name: 'Z' })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await h.req('DELETE', `${base(w.cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('PATCH', `${base(w.other)}/${b.id}`, { name: 'Z' })).statusCode).toBe(404);
    expect((await h.req('DELETE', `${base(w.other)}/${b.id}`)).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/percent.test.ts tests/server/split-presets.test.ts`
Expected: FAIL — нет модуля `percent`, маршруты 404.

- [ ] **Step 3: Implement**

`src/shared/percent.ts`:

```ts
/** «33,33» / «33.3» / «50 %» → сотые доли процента (bp): 3333 / 3330 / 5000. null — не число или больше двух знаков. */
export function parsePercentToBp(text: string): number | null {
  const s = text.replace(/\s/g, '').replace(/%$/, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(bp) ? bp : null;
}

/** Сотые доли процента → «33,33», «33,3», «50». */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
```

`src/shared/schemas/split-presets.ts`:

```ts
import { z } from 'zod';
import { formatBp } from '../percent';
import { nameField } from '../text';

export const SPLIT_TOTAL_BP = 10000;
export const SPLIT_PRESET_NAME_MAX = 100;

const id = z.number().int().positive();

const line = z.object({
  categoryId: id.nullable().default(null),
  projectId: id.nullable().default(null),
  bp: z.number().int('Доля — целое число сотых долей процента').min(1, 'Доля больше 0').max(SPLIT_TOTAL_BP, 'Не больше 100%'),
});

const lines = z
  .array(line)
  .min(1, 'Добавьте хотя бы одну строку')
  .max(20, 'Не больше 20 строк')
  .superRefine((ls, ctx) => {
    if (ls.some((l) => l.categoryId === null && l.projectId === null)) {
      ctx.addIssue({ code: 'custom', message: 'В каждой строке укажите статью или проект' });
      return;
    }
    const keys = ls.map((l) => `${l.categoryId}:${l.projectId}`);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'Строки повторяются' });
      return;
    }
    const sum = ls.reduce((s, l) => s + l.bp, 0);
    if (sum !== SPLIT_TOTAL_BP) ctx.addIssue({ code: 'custom', message: `Сумма долей должна быть 100% (сейчас ${formatBp(sum)}%)` });
  });

export const splitPresetCreateSchema = z.object({ name: nameField(SPLIT_PRESET_NAME_MAX), lines });
export const splitPresetUpdateSchema = z.object({ name: nameField(SPLIT_PRESET_NAME_MAX).optional(), lines: lines.optional() });
```

`src/server/modules/split-presets/service.ts`:

```ts
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { categories, projects, splitPresets } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';

export interface SplitLine {
  categoryId: number | null;
  projectId: number | null;
  bp: number;
}

export interface SplitPresetRow {
  id: number;
  companyId: number;
  name: string;
  lines: SplitLine[];
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface SplitPresetsService {
  list(companyId: number): SplitPresetRow[];
  add(companyId: number, input: { name: string; lines: SplitLine[] }, userId: number): SplitPresetRow;
  update(companyId: number, id: number, input: { name?: string; lines?: SplitLine[] }, userId: number): SplitPresetRow;
  archive(companyId: number, id: number, userId: number): SplitPresetRow;
  unarchive(companyId: number, id: number, userId: number): SplitPresetRow;
  reorder(companyId: number, ids: number[], userId: number): SplitPresetRow[];
  remove(companyId: number, id: number, userId: number): void;
}

const ENTITY = 'split_preset';

function toRow(r: typeof splitPresets.$inferSelect): SplitPresetRow {
  return { ...r, lines: JSON.parse(r.lines) as SplitLine[] };
}

const invalidLines = (message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { lines: message });

export function createSplitPresetsService(d: { db: Db; audit: AuditService; now?: () => Date }): SplitPresetsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireRow(companyId: number, id: number): SplitPresetRow {
    const row = db.select().from(splitPresets).where(and(eq(splitPresets.id, id), eq(splitPresets.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Шаблон разделения не найден');
    return toRow(row);
  }

  /** Статьи и проекты строк: той же компании (инвариант 5), не в архиве (инвариант 7), статьи одного вида. */
  function checkRefs(companyId: number, lines: SplitLine[]): void {
    const catIds = [...new Set(lines.flatMap((l) => (l.categoryId === null ? [] : [l.categoryId])))];
    const projIds = [...new Set(lines.flatMap((l) => (l.projectId === null ? [] : [l.projectId])))];
    const cats = catIds.length
      ? db.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, catIds))).all()
      : [];
    const projs = projIds.length
      ? db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projIds))).all()
      : [];
    if (cats.length !== catIds.length) throw invalidLines('Статья не найдена в этой компании');
    if (projs.length !== projIds.length) throw invalidLines('Проект не найден в этой компании');
    if (new Set(cats.map((c) => c.kind)).size > 1) throw invalidLines('Статьи шаблона должны быть одного вида');
    const archived = [...cats, ...projs].find((x) => x.archivedAt);
    if (archived) throw new AppError(422, 'ARCHIVED_REFERENCE', `«${archived.name}» в архиве — выберите другой элемент`);
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): SplitPresetRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx
        .update(splitPresets)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(splitPresets.id, id))
        .returning()
        .get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return toRow(out);
    });
  }

  const svc: SplitPresetsService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(splitPresets)
        .where(eq(splitPresets.companyId, companyId))
        .orderBy(asc(splitPresets.orderIndex), asc(splitPresets.id))
        .all()
        .map(toRow);
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      checkRefs(companyId, input.lines);
      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${splitPresets.orderIndex}), -1)` })
          .from(splitPresets)
          .where(eq(splitPresets.companyId, companyId))
          .get();
        const row = toRow(
          tx
            .insert(splitPresets)
            .values({
              companyId,
              name: cleanName(input.name),
              lines: JSON.stringify(input.lines),
              orderIndex: (next?.m ?? -1) + 1,
              createdAt: now().toISOString(),
            })
            .returning()
            .get(),
        );
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name: row.name, lines: row.lines } });
        return row;
      });
    },

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Шаблон в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ name: before.name, lines: before.lines }, patch);
      if (!changes) return before;
      const { name, lines } = changes.after;
      if (lines !== undefined) checkRefs(companyId, lines); // старые строки не перепроверяем (инвариант 10)
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .update(splitPresets)
          .set({ ...(name !== undefined ? { name } : {}), ...(lines !== undefined ? { lines: JSON.stringify(lines) } : {}) })
          .where(eq(splitPresets.id, id))
          .returning()
          .get();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return toRow(row);
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((r) => r.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((rowId, i) => tx.update(splitPresets).set({ orderIndex: i }).where(eq(splitPresets.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      // на шаблоны разделения операции не ссылаются — удаление всегда возможно
      mutate(db, audit, (tx, record) => {
        tx.delete(splitPresets).where(eq(splitPresets.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/split-presets/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { splitPresetCreateSchema, splitPresetUpdateSchema } from '../../../shared/schemas/split-presets';
import { parseId } from '../../http/params';
import type { SplitPresetsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/split-presets';

export function registerSplitPresetsRoutes(app: FastifyInstance, deps: { splitPresets: SplitPresetsService }): void {
  const svc = deps.splitPresets;

  app.get<C>(BASE, async (req) => ({ splitPresets: svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = splitPresetCreateSchema.parse(req.body);
    return reply.status(201).send({ splitPreset: svc.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { splitPresets: svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = splitPresetUpdateSchema.parse(req.body);
    return { splitPreset: svc.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    splitPreset: svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    splitPreset: svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — импорты и регистрация после тегов:

```ts
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createSplitPresetsService } from './modules/split-presets/service';
```

```ts
  registerSplitPresetsRoutes(app, { splitPresets: createSplitPresetsService({ db, audit, now }) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/percent.test.ts tests/server/split-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/percent.ts src/shared/schemas/split-presets.ts src/server/modules/split-presets src/server/app.ts tests/shared/percent.test.ts tests/server/split-presets.test.ts
git commit -m "feat: API шаблонов разделения — доли в сумме 100%, ссылки своей компании

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Проекты — порядок, удаление, переименование счетов вместе с проектом

**Files:**
- Create: `tests/server/projects-extra.test.ts`
- Modify: `src/server/modules/projects/service.ts` (целиком), `src/server/modules/projects/routes.ts` (целиком), `src/shared/schemas/projects.ts`, `src/server/modules/templates/routes.ts`, `src/server/app.ts`, `tests/server/projects.test.ts:24-29`

**Interfaces:**
- Consumes:
  - `mutate`, `changedFields` (Task 2);
  - `assertSameSet`, `isSameOrder`, `ReferencesService`, `reorderSchema`, `AccountsService.countByProject` (Task 4).
- Produces:
  - `projectUpdateSchema` с полем `renameAccounts?: boolean`;
  - `ProjectsService.update(...)` возвращает `{ project, renamedAccounts }`, `PATCH /projects/:id` отдаёт то же;
  - `ProjectsService.reorder(companyId, ids, userId): ProjectRow[]` → `POST …/projects/reorder` → `{ projects }`;
  - `ProjectsService.remove(companyId, id, userId): void` → `DELETE …/projects/:id` → 204;
  - `GET /api/v1/templates`: поле `defaultAccounts: string[]` (шаблоны названий с `{project}`).

- [ ] **Step 1: Write the failing tests**

`tests/server/projects-extra.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { computerClub } from '../../src/templates/computer-club';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const projectsUrl = (cid: number) => `/api/v1/companies/${cid}/projects`;
const accountsUrl = (cid: number) => `/api/v1/companies/${cid}/accounts`;
const club = (name: string) => ({ name, templateKey: 'computer-club', templateParams: { pcCount: 10 } });
const accountNames = async (cid: number) => (await h.req('GET', accountsUrl(cid))).json().accounts.map((a: { name: string }) => a.name);

describe('projects: переименование счетов, порядок, удаление', () => {
  it('renameAccounts переименовывает «Касса/Kaspi …», кроме изменённых вручную и архивных', async () => {
    h = await createApi();
    const cid = await h.company();
    const p1 = (await h.req('POST', projectsUrl(cid), club('Клуб 1'))).json().project;
    const p2 = (await h.req('POST', projectsUrl(cid), club('Клуб 2'))).json().project;
    const accs = (await h.req('GET', accountsUrl(cid))).json().accounts as { id: number; name: string }[];
    const byName = (n: string) => accs.find((a) => a.name === n)!.id;
    await h.req('PATCH', `${accountsUrl(cid)}/${byName('Kaspi Клуб 1')}`, { name: 'Kaspi Gold' });
    await h.req('POST', `${accountsUrl(cid)}/${byName('Касса Клуб 2')}/archive`);

    const r1 = await h.req('PATCH', `${projectsUrl(cid)}/${p1.id}`, { name: 'Клуб на Абая', renameAccounts: true });
    expect(r1.json()).toMatchObject({ project: { name: 'Клуб на Абая' }, renamedAccounts: 1 });
    const r2 = await h.req('PATCH', `${projectsUrl(cid)}/${p2.id}`, { name: 'Клуб на Сатпаева', renameAccounts: true });
    expect(r2.json().renamedAccounts).toBe(1);
    expect(await accountNames(cid)).toEqual(['Касса Клуб на Абая', 'Kaspi Gold', 'Касса Клуб 2', 'Kaspi Клуб на Сатпаева']);
  });

  it('без renameAccounts счета не меняются', async () => {
    h = await createApi();
    const cid = await h.company();
    const p = (await h.req('POST', projectsUrl(cid), club('Клуб 1'))).json().project;
    const res = await h.req('PATCH', `${projectsUrl(cid)}/${p.id}`, { name: 'Клуб 9' });
    expect(res.json()).toMatchObject({ project: { name: 'Клуб 9' }, renamedAccounts: 0 });
    expect(await accountNames(cid)).toEqual(['Касса Клуб 1', 'Kaspi Клуб 1']);
  });

  it('счёт шаблона без своей валюты получает базовую валюту компании', async () => {
    h = await createApi();
    const cid = (await h.req('POST', '/api/v1/companies', { name: 'USD Ltd', baseCurrency: 'USD' })).json().company.id as number;
    // у шаблонов в коде валюта счетов задана явно (KZT) — подменяем на время теста (файл идёт в своём процессе)
    const saved = computerClub.defaultAccounts;
    computerClub.defaultAccounts = [{ name: 'Сейф {project}' }, { name: 'Kaspi {project}', currency: 'KZT' }];
    try {
      expect((await h.req('POST', projectsUrl(cid), club('Клуб'))).statusCode).toBe(201);
    } finally {
      computerClub.defaultAccounts = saved;
    }
    const accs = (await h.req('GET', accountsUrl(cid))).json().accounts.map((a: { name: string; currency: string }) => [a.name, a.currency]);
    expect(accs).toEqual([
      ['Сейф Клуб', 'USD'],
      ['Kaspi Клуб', 'KZT'],
    ]);
  });

  it('порядок проектов; устаревший список — 409', async () => {
    h = await createApi();
    const cid = await h.company();
    const a = (await h.req('POST', projectsUrl(cid), { name: 'A', templateKey: 'general' })).json().project.id as number;
    const b = (await h.req('POST', projectsUrl(cid), { name: 'B', templateKey: 'general' })).json().project.id as number;
    const res = await h.req('POST', `${projectsUrl(cid)}/reorder`, { ids: [b, a] });
    expect(res.json().projects.map((p: { name: string }) => p.name)).toEqual(['B', 'A']);
    expect((await h.req('POST', `${projectsUrl(cid)}/reorder`, { ids: [a] })).statusCode).toBe(409);
    expect(h.auditCount('project', 'reorder')).toBe(1);
  });

  it('удаление: только без счетов (включая архивные); чужие id — 404', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const office = (await h.req('POST', projectsUrl(cid), { name: 'Офис', templateKey: 'general' })).json().project.id as number;
    const acc = (await h.req('POST', accountsUrl(cid), { name: 'Сейф', currency: 'KZT', projectId: office })).json().account.id as number;
    await h.req('POST', `${accountsUrl(cid)}/${acc}/archive`);
    const blocked = await h.req('DELETE', `${projectsUrl(cid)}/${office}`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('IN_USE');
    expect((await h.req('DELETE', `${projectsUrl(other)}/${office}`)).statusCode).toBe(404);
    await h.req('DELETE', `${accountsUrl(cid)}/${acc}`);
    expect((await h.req('DELETE', `${projectsUrl(cid)}/${office}`)).statusCode).toBe(204);
    expect((await h.req('GET', projectsUrl(cid))).json().projects).toEqual([]);
    expect(h.auditCount('project', 'delete')).toBe(1);
  });
});
```

`tests/server/projects.test.ts` — тест `GET /templates отдаёт шаблоны без схем` целиком:

```ts
  it('GET /templates отдаёт шаблоны без схем', async () => {
    const { req } = await setup();
    const res = await req('GET', '/api/v1/templates');
    expect(res.json().templates.map((x: { key: string }) => x.key)).toEqual(['computer-club', 'general']);
    for (const tpl of res.json().templates) {
      expect(Object.keys(tpl).sort()).toEqual(['defaultAccounts', 'integrations', 'key', 'name', 'paramsUi']);
    }
    expect(res.json().templates[0].paramsUi[0]).toEqual({ key: 'pcCount', label: 'Количество ПК', type: 'int' });
    expect(res.json().templates[0].defaultAccounts).toEqual(['Касса {project}', 'Kaspi {project}']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/projects-extra.test.ts tests/server/projects.test.ts`
Expected: FAIL — нет `renamedAccounts`, маршрутов `reorder` и `DELETE`, поля `defaultAccounts`.

- [ ] **Step 3: Implement**

`src/shared/schemas/projects.ts` — схема правки:

```ts
export const projectUpdateSchema = z.object({
  name: name.optional(),
  templateParams: params.optional(),
  /** Переименовать счета шаблона («Касса {старое}» → «Касса {новое}»). */
  renameAccounts: z.boolean().optional(),
});
```

`src/server/modules/projects/service.ts` целиком:

```ts
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import { cleanName } from '../../../shared/text';
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CompaniesService } from '../companies/service';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export interface ProjectRow {
  id: number;
  companyId: number;
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectsService {
  list(companyId: number): ProjectRow[];
  create(
    companyId: number,
    input: { name: string; templateKey: string; templateParams: Record<string, unknown> },
    userId: number,
  ): { project: ProjectRow; applied: { categories: number; accounts: number } };
  update(
    companyId: number,
    id: number,
    input: { name?: string; templateParams?: Record<string, unknown>; renameAccounts?: boolean },
    userId: number,
  ): { project: ProjectRow; renamedAccounts: number };
  archive(companyId: number, id: number, userId: number): ProjectRow;
  unarchive(companyId: number, id: number, userId: number): ProjectRow;
  reorder(companyId: number, ids: number[], userId: number): ProjectRow[];
  remove(companyId: number, id: number, userId: number): void;
}

function toRow(r: typeof projects.$inferSelect): ProjectRow {
  return { ...r, templateParams: JSON.parse(r.templateParams) as Record<string, unknown> };
}

function validateParams(template: BusinessTemplate, raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = template.params.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = `templateParams.${issue.path.join('.') || '_'}`;
    fields[key] ??= issue.message;
  }
  throw new AppError(400, 'VALIDATION', 'Проверьте параметры проекта', fields);
}

export function createProjectsService(d: {
  db: Db;
  audit: AuditService;
  companies: CompaniesService;
  categories: CategoriesService;
  accounts: AccountsService;
  references?: ReferencesService;
  timezone: string;
  now?: () => Date;
}): ProjectsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function requireProject(companyId: number, id: number): ProjectRow {
    const row = db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Проект не найден');
    return toRow(row);
  }

  function assertNameFree(companyId: number, name: string, exceptId?: number): void {
    const key = ulower(name.trim());
    const clash = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), sql`ulower(trim(${projects.name})) = ${key}`))
      .all()
      .some((r) => r.id !== exceptId);
    if (clash) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Проект с таким названием уже есть' });
  }

  const svc: ProjectsService = {
    list(companyId) {
      d.companies.require(companyId);
      return db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(asc(projects.orderIndex), asc(projects.id)).all().map(toRow);
    },

    create(companyId, input, userId) {
      const company = d.companies.require(companyId, { writable: true });
      const template = getTemplate(input.templateKey);
      if (!template) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { templateKey: 'Неизвестный тип бизнеса' });
      const params = validateParams(template, input.templateParams);
      const name = cleanName(input.name);
      assertNameFree(companyId, name);

      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
          .from(projects)
          .where(eq(projects.companyId, companyId))
          .get();
        const row = tx
          .insert(projects)
          .values({
            companyId,
            name,
            templateKey: template.key,
            templateParams: JSON.stringify(params),
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get();
        const createdCategories = d.categories.mergeTemplate(tx, companyId, template);
        const openedAt = todayInTimezone(d.timezone, now());
        for (const acc of template.defaultAccounts) {
          d.accounts.create(tx, {
            companyId,
            projectId: row.id,
            name: acc.name.replaceAll('{project}', () => name),
            currency: acc.currency ?? company.baseCurrency,
            openedAt,
          });
        }
        const applied = { categories: createdCategories, accounts: template.defaultAccounts.length };
        record({
          companyId,
          userId,
          entity: 'project',
          entityId: row.id,
          action: 'create',
          diff: { name, templateKey: template.key, templateParams: params, applied },
        });
        return { project: toRow(row), applied };
      });
    },

    update(companyId, id, input, userId) {
      d.companies.require(companyId, { writable: true });
      const before = requireProject(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — изменения недоступны');
      const template = getTemplate(before.templateKey);
      if (!template) throw new Error(`Шаблон ${before.templateKey} не найден`);
      const patch: { name?: string; templateParams?: Record<string, unknown> } = {};
      if (input.name !== undefined) patch.name = cleanName(input.name);
      if (input.templateParams !== undefined) {
        patch.templateParams = validateParams(template, { ...before.templateParams, ...input.templateParams });
      }
      const changes = changedFields({ name: before.name, templateParams: before.templateParams }, patch);
      if (!changes) return { project: before, renamedAccounts: 0 };
      const newName = changes.after.name;
      if (newName !== undefined) assertNameFree(companyId, newName, id);
      return mutate(db, audit, (tx, record) => {
        const set: Partial<typeof projects.$inferInsert> = {};
        if (newName !== undefined) set.name = newName;
        if (changes.after.templateParams !== undefined) set.templateParams = JSON.stringify(changes.after.templateParams);
        const project = toRow(tx.update(projects).set(set).where(eq(projects.id, id)).returning().get());
        let renamedAccounts = 0;
        if (input.renameAccounts && newName !== undefined) {
          // только счета с исходным названием шаблона; изменённые вручную и архивные не трогаем
          for (const acc of template.defaultAccounts) {
            const from = acc.name.replaceAll('{project}', () => before.name);
            const to = acc.name.replaceAll('{project}', () => newName);
            renamedAccounts += tx
              .update(accounts)
              .set({ name: to })
              .where(and(eq(accounts.companyId, companyId), eq(accounts.projectId, id), eq(accounts.name, from), isNull(accounts.archivedAt)))
              .run().changes;
          }
        }
        record({
          companyId,
          userId,
          entity: 'project',
          entityId: id,
          action: 'update',
          diff: { ...changes, ...(renamedAccounts ? { renamedAccounts } : {}) },
        });
        return { project, renamedAccounts };
      });
    },

    archive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(companyId, id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив счета проекта');
      }
      return mutate(db, audit, (tx, record) => {
        const out = toRow(tx.update(projects).set({ archivedAt: now().toISOString() }).where(eq(projects.id, id)).returning().get());
        record({ companyId, userId, entity: 'project', entityId: id, action: 'archive' });
        return out;
      });
    },

    unarchive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (!row.archivedAt) return row;
      return mutate(db, audit, (tx, record) => {
        const out = toRow(tx.update(projects).set({ archivedAt: null }).where(eq(projects.id, id)).returning().get());
        record({ companyId, userId, entity: 'project', entityId: id, action: 'unarchive' });
        return out;
      });
    },

    reorder(companyId, ids, userId) {
      d.companies.require(companyId, { writable: true });
      const current = svc.list(companyId).map((p) => p.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((projectId, i) => tx.update(projects).set({ orderIndex: i }).where(eq(projects.id, projectId)).run());
          record({ companyId, userId, entity: 'project', action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (d.accounts.countByProject(companyId, id) > 0) {
        throw new AppError(422, 'IN_USE', 'У проекта есть счета — удалите их или переведите проект в архив');
      }
      if (references.countOperations('project', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На проект ссылаются операции — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(projects).where(eq(projects.id, id)).run();
        record({ companyId, userId, entity: 'project', entityId: id, action: 'delete', diff: { name: row.name, templateKey: row.templateKey } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/projects/routes.ts` целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { projectCreateSchema, projectUpdateSchema } from '../../../shared/schemas/projects';
import { parseId } from '../../http/params';
import type { ProjectsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/projects';

export function registerProjectsRoutes(app: FastifyInstance, deps: { projects: ProjectsService }): void {
  const { projects } = deps;

  app.get<C>(BASE, async (req) => ({ projects: projects.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = projectCreateSchema.parse(req.body);
    return reply.status(201).send(projects.create(cid, body, req.user!.id));
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { projects: projects.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = projectUpdateSchema.parse(req.body);
    return projects.update(cid, id, body, req.user!.id);
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    projects.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    project: projects.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    project: projects.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/modules/templates/routes.ts` — описание шаблона без схем, плюс шаблоны названий счетов:

```ts
  app.get('/api/v1/templates', async () => ({
    templates: TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      integrations: t.integrations,
      paramsUi: t.paramsUi,
      defaultAccounts: t.defaultAccounts.map((a) => a.name),
    })),
  }));
```

`src/server/app.ts` — проекты получают `references`:

```ts
  const projects = createProjectsService({ db, audit, companies, categories, accounts, references, timezone: config.timezone, now });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/projects-extra.test.ts tests/server/projects.test.ts tests/server/projects-service.test.ts tests/server/mutate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/projects.ts src/server/modules/projects src/server/modules/templates/routes.ts src/server/app.ts tests/server/projects-extra.test.ts tests/server/projects.test.ts
git commit -m "feat: проекты — порядок, удаление без счетов, переименование счетов шаблона

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: Клиент — общие компоненты, данные раньше ошибки, экраны «Проекты» и «Компании»

**Files:**
- Create: `src/client/components/Field.tsx`, `src/client/components/QueryState.tsx`, `src/client/components/ReorderButtons.tsx`, `src/client/components/ConfirmDelete.tsx`, `src/client/lib/order.ts`, `src/client/lib/numbers.ts`, `tests/client/order.test.ts`, `tests/client/numbers.test.ts`
- Modify: `src/client/components/ui.ts`, `src/client/lib/query.ts`, `src/client/lib/queries.ts`, `src/client/components/ProjectForm.tsx` (целиком), `src/client/pages/settings/ProjectsSettings.tsx` (целиком), `src/client/pages/settings/CompaniesSettings.tsx` (целиком), `src/client/pages/settings/SettingsNav.tsx` (целиком)

**Interfaces:**
- Consumes:
  - `PATCH /projects/:id` → `{ project, renamedAccounts }`, `POST /projects/reorder`, `DELETE /projects/:id`;
  - `defaultAccounts` в `/templates` (Task 8);
  - `installZodRu` (Task 1).
- Produces:
  - `Field({ label, error?, hint?, className?, children: (control: FieldControlProps) => ReactNode })`, где `FieldControlProps = { id; 'aria-invalid'?; 'aria-describedby'? }`;
  - `Pending({ queries })` — экран до первой загрузки; `StaleNotice({ queries })` — плашка при сбое фонового обновления;
  - `ReorderButtons({ label, onUp, onDown, disabled? })`;
  - `ConfirmDelete({ what, pending, onConfirm, onCancel })`;
  - `moveWithinGroup(ids, group, id, delta): number[] | null`;
  - `parseIntInput(text): { ok: true; value } | { ok: false; error }`;
  - классы `btnIcon`, `btnSmall`, `alertClass`, `noticeClass`;
  - `SettingsNav` со списком `SECTIONS`: следующие задачи добавляют свои разделы перед «Компании».

- [ ] **Step 1: Write the failing tests**

`tests/client/order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moveWithinGroup } from '../../src/client/lib/order';

describe('moveWithinGroup', () => {
  it('меняет местами с соседом по группе в полном списке', () => {
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    // группа — счета одного проекта вперемешку со счетами других
    expect(moveWithinGroup([1, 2, 3, 4], [1, 3], 3, -1)).toEqual([3, 2, 1, 4]);
  });

  it('на краю группы и для id не из группы — null', () => {
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 1, -1)).toBeNull();
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 3, 1)).toBeNull();
    expect(moveWithinGroup([1, 2, 3], [1, 3], 2, 1)).toBeNull();
  });
});
```

`tests/client/numbers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseIntInput } from '../../src/client/lib/numbers';

describe('parseIntInput', () => {
  it('целые числа, пробелы между разрядами игнорируются', () => {
    expect(parseIntInput('30')).toEqual({ ok: true, value: 30 });
    expect(parseIntInput(' 1 000 ')).toEqual({ ok: true, value: 1000 });
    expect(parseIntInput('-5')).toEqual({ ok: true, value: -5 });
  });

  it('«1e3», дроби и мусор — ошибка по-русски', () => {
    for (const bad of ['1e3', '1.5', '1,5', '12abc', '', '0x10']) {
      expect(parseIntInput(bad)).toEqual({ ok: false, error: 'Введите целое число' });
    }
    expect(parseIntInput('99999999999999999999')).toEqual({ ok: false, error: 'Слишком большое число' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client`
Expected: FAIL — модулей `order` и `numbers` нет.

- [ ] **Step 3: Implement**

`src/client/lib/order.ts`:

```ts
/**
 * Новый порядок полного списка ids после сдвига id на одну позицию внутри группы `group`
 * (например, счета одного проекта). null — двигать некуда.
 */
export function moveWithinGroup(ids: readonly number[], group: readonly number[], id: number, delta: -1 | 1): number[] | null {
  const gi = group.indexOf(id);
  const neighbor = group[gi + delta];
  if (gi < 0 || neighbor === undefined) return null;
  const out = [...ids];
  const a = out.indexOf(id);
  const b = out.indexOf(neighbor);
  if (a < 0 || b < 0) return null;
  out[a] = neighbor;
  out[b] = id;
  return out;
}
```

`src/client/lib/numbers.ts`:

```ts
/** Целое число из поля ввода: пробелы игнорируются, минус допустим; «1e3», «1.5», «12abc» — ошибка. */
export function parseIntInput(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const s = text.replace(/\s/g, '');
  if (!/^-?\d+$/.test(s)) return { ok: false, error: 'Введите целое число' };
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'Слишком большое число' };
  return { ok: true, value };
}
```

`src/client/components/ui.ts` — допишите:

```ts
export const btnSmall = 'rounded-lg bg-field px-3 py-1.5 text-sm font-medium text-ink hover:brightness-95 disabled:opacity-50';
export const btnIcon = 'rounded-lg bg-field px-2.5 py-1.5 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-30';
export const alertClass = 'mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense';
export const noticeClass = 'mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted';
```

`src/client/components/Field.tsx`:

```tsx
import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** Подпись, подсказка и ошибка поля, связанные с элементом ввода: label for, aria-invalid, aria-describedby. */
export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ');
  const control: FieldControlProps = {
    id,
    ...(props.error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
  return (
    <div className={props.className ?? 'block'}>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {props.label}
      </label>
      {props.children(control)}
      {props.hint && (
        <span id={hintId} className="mt-1 block text-xs text-muted">
          {props.hint}
        </span>
      )}
      {props.error && (
        <span id={errorId} className="mt-1 block text-sm text-expense">
          {props.error}
        </span>
      )}
    </div>
  );
}
```

`src/client/components/QueryState.tsx`:

```tsx
import { LoadError } from './LoadError';

interface QueryLike {
  data: unknown;
  error: { message: string } | null;
  refetch: () => unknown;
}

/** Пока каких-то данных нет: ошибка с «Повторить» или «Загрузка…». */
export function Pending({ queries }: { queries: QueryLike[] }) {
  const failed = queries.find((q) => q.data === undefined && q.error);
  if (failed?.error) return <LoadError message={failed.error.message} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  return <div className="text-muted">Загрузка…</div>;
}

/** Данные уже показаны, а фоновое обновление не удалось: плашка над ними, данные остаются на экране. */
export function StaleNotice({ queries }: { queries: QueryLike[] }) {
  const failed = queries.find((q) => q.error);
  if (!failed?.error) return null;
  return (
    <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
      <span>Не удалось обновить данные: {failed.error.message}</span>
      <button type="button" onClick={() => queries.forEach((q) => void q.refetch())} className="font-semibold underline">
        Повторить
      </button>
    </p>
  );
}
```

`src/client/components/ReorderButtons.tsx`:

```tsx
import { btnIcon } from './ui';

/** «Выше» / «Ниже» — доступная с клавиатуры замена перетаскиванию. null — двигать некуда. */
export function ReorderButtons(props: { label: string; onUp: (() => void) | null; onDown: (() => void) | null; disabled?: boolean }) {
  const disabled = props.disabled ?? false;
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        aria-label={`Выше: ${props.label}`}
        title="Выше"
        disabled={disabled || !props.onUp}
        onClick={props.onUp ?? undefined}
        className={btnIcon}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Ниже: ${props.label}`}
        title="Ниже"
        disabled={disabled || !props.onDown}
        onClick={props.onDown ?? undefined}
        className={btnIcon}
      >
        ↓
      </button>
    </span>
  );
}
```

`src/client/components/ConfirmDelete.tsx`:

```tsx
import { btnDanger, btnSecondary } from './ui';

/** Встроенное подтверждение удаления (без window.confirm); фокус сразу на безопасной «Отмене». */
export function ConfirmDelete(props: { what: string; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={`Удаление: ${props.what}`} className="flex flex-wrap items-center gap-2 text-sm">
      <span>Удалить {props.what}? Это нельзя отменить.</span>
      <button type="button" disabled={props.pending} onClick={props.onConfirm} className={btnDanger}>
        Да, удалить
      </button>
      <button type="button" autoFocus onClick={props.onCancel} className={btnSecondary}>
        Отмена
      </button>
    </div>
  );
}
```

`src/client/lib/query.ts` — `QueryCache` пропускает запрос `me`. Первый заход без сессии обрабатывает `RequireAuth` через `<Navigate>`, без перезагрузки страницы:

```ts
export const queryClient: QueryClient = new QueryClient({
  // 401 на /auth/me — обычный первый заход без сессии: RequireAuth сам уводит на вход без перезагрузки
  queryCache: new QueryCache({ onError: (err, query) => (query.queryKey[0] === 'me' ? undefined : handleUnauthorized(err)) }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
```

(остальные опции `QueryClient` без изменений).

`src/client/lib/queries.ts` — в `TemplateInfo` добавьте поле:

```ts
  /** Шаблоны названий счетов по умолчанию, `{project}` — название проекта. */
  defaultAccounts: string[];
```

`src/client/pages/settings/SettingsNav.tsx` целиком:

```tsx
import { NavLink } from 'react-router';

/** Разделы настроек по порядку; «Компании» всегда последние. */
const SECTIONS: readonly { path: string; label: string }[] = [
  { path: 'projects', label: 'Проекты' },
  { path: 'companies', label: 'Компании' },
];

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

export function SettingsNav({ companyId }: { companyId: number }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Разделы настроек">
      {SECTIONS.map((s) => (
        <NavLink key={s.path} to={`/c/${companyId}/settings/${s.path}`} className={link}>
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

`src/client/components/ProjectForm.tsx` целиком:

```tsx
import { useState, type FormEvent } from 'react';
import { getTemplate } from '../../templates';
import { parseIntInput } from '../lib/numbers';
import type { TemplateInfo } from '../lib/queries';
import { Field } from './Field';
import { btnPrimary, btnSecondary, inputClass } from './ui';

export interface ProjectFormValues {
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  /** Только при правке с изменённым названием: переименовать счета шаблона вместе с проектом. */
  renameAccounts?: boolean;
}

function toInputs(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]));
}

export function ProjectForm(props: {
  templates: TemplateInfo[];
  mode: 'create' | 'edit';
  initial?: ProjectFormValues;
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [templateKey, setTemplateKey] = useState(props.initial?.templateKey ?? props.templates[0]?.key ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(toInputs(props.initial?.templateParams ?? {}));
  const [renameAccounts, setRenameAccounts] = useState(true);
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const info = props.templates.find((t) => t.key === templateKey);
  const fields = { ...props.serverFields, ...clientFields };
  const offerRename =
    props.mode === 'edit' && props.initial !== undefined && name.trim() !== props.initial.name && (info?.defaultAccounts.length ?? 0) > 0;
  const accountPatterns = (info?.defaultAccounts ?? []).map((a) => `«${a.replaceAll('{project}', '…')}»`).join(', ');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const raw: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const p of info?.paramsUi ?? []) {
      const s = (inputs[p.key] ?? '').trim();
      if (s === '') continue; // пусто — значение по умолчанию схемы или «обязательное поле»
      if (p.type === 'int') {
        const n = parseIntInput(s);
        if (n.ok) raw[p.key] = n.value;
        else errors[`templateParams.${p.key}`] = n.error;
      } else {
        raw[p.key] = s;
      }
    }
    let params = raw;
    if (Object.keys(errors).length === 0) {
      const parsed = getTemplate(templateKey)?.params.safeParse(raw);
      if (parsed && !parsed.success) {
        for (const issue of parsed.error.issues) errors[`templateParams.${issue.path.join('.')}`] ??= issue.message;
      } else if (parsed) {
        // отправляем значения после схемы: очищенное поле получает значение по умолчанию, а не старое с сервера
        params = parsed.data;
      }
    }
    setClientFields(errors);
    if (Object.keys(errors).length > 0) return;
    props.onSubmit({ name, templateKey, templateParams: params, ...(offerRename ? { renameAccounts } : {}) });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">
      <Field label="Название проекта" error={fields.name}>
        {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />}
      </Field>
      <Field label="Тип бизнеса" error={fields.templateKey}>
        {(c) => (
          <select
            {...c}
            value={templateKey}
            disabled={props.mode === 'edit'}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setInputs({});
              setClientFields({});
            }}
            className={inputClass}
          >
            {props.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {info?.paramsUi.map((p) => (
        <Field key={p.key} label={p.label} hint={p.hint} error={fields[`templateParams.${p.key}`]}>
          {(c) => (
            <input
              {...c}
              inputMode={p.type === 'int' ? 'numeric' : 'text'}
              value={inputs[p.key] ?? ''}
              onChange={(e) => setInputs((v) => ({ ...v, [p.key]: e.target.value }))}
              className={inputClass}
            />
          )}
        </Field>
      ))}
      {offerRename && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={renameAccounts} onChange={(e) => setRenameAccounts(e.target.checked)} className="mt-1" />
          <span>Переименовать счета проекта ({accountPatterns}), если их названия не меняли вручную</span>
        </label>
      )}
      {props.serverError && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать проект' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

`src/client/pages/settings/ProjectsSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnDanger, btnPrimary, btnSecondary, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { moveWithinGroup } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Action = { path: string; method: 'POST' | 'DELETE'; body?: unknown };

function paramsSummary(p: Project, t: TemplateInfo | undefined): string {
  return (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
}

export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/projects`;
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
    ]);

  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: { name: v.name, templateKey: v.templateKey, templateParams: v.templateParams } }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<{ renamedAccounts: number }, ApiError, { id: number; values: ProjectFormValues }>({
    mutationFn: ({ id, values }) =>
      api(`${base}/${id}`, {
        method: 'PATCH',
        body: {
          name: values.name,
          templateParams: values.templateParams,
          ...(values.renameAccounts !== undefined ? { renameAccounts: values.renameAccounts } : {}),
        },
      }),
    onSuccess: async (res) => {
      await invalidate();
      setEditingId(null);
      if (res.renamedAccounts > 0) setNotice(`Переименовано счетов: ${res.renamedAccounts}`);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method, body: a.body }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });

  const resetMessages = () => {
    create.reset();
    update.reset();
    action.reset();
    setNotice(null);
  };
  const openCreate = () => {
    resetMessages();
    setEditingId(null);
    setDeletingId(null);
    setCreating(true);
  };
  const openEdit = (id: number) => {
    resetMessages();
    setCreating(false);
    setDeletingId(null);
    setEditingId(id);
  };
  const run = (a: Action) => {
    resetMessages();
    action.mutate(a);
  };

  if (!projects.data || !templates.data) return <Pending queries={[projects, templates]} />;
  const list = projects.data;
  const templateList = templates.data;
  const ids = list.map((p) => p.id);
  const tpl = (key: string) => templateList.find((t) => t.key === key);
  const shift = (id: number, delta: -1 | 1) => {
    const next = moveWithinGroup(ids, ids, id, delta);
    return next ? () => run({ path: `${base}/reorder`, method: 'POST', body: { ids: next } }) : null;
  };

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[projects, templates]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Проекты</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={openCreate} className={btnPrimary}>
            Добавить проект
          </button>
        )}
      </div>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {notice && (
        <p role="status" className={noticeClass}>
          {notice}
        </p>
      )}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <ProjectForm
            templates={templateList}
            mode="create"
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {list.length === 0 && !creating && <p className="text-muted">Проектов пока нет. Проект — это клуб, магазин или офис внутри компании.</p>}
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <ProjectForm
                templates={templateList}
                mode="edit"
                initial={{ name: p.name, templateKey: p.templateKey, templateParams: p.templateParams }}
                pending={update.isPending}
                serverFields={update.error?.fields}
                serverError={update.error && !update.error.fields ? update.error.message : undefined}
                onSubmit={(values) => update.mutate({ id: p.id, values })}
                onCancel={() => {
                  setEditingId(null);
                  update.reset();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {p.name}
                    {p.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {tpl(p.templateKey)?.name ?? p.templateKey}
                    {paramsSummary(p, tpl(p.templateKey)) && ` · ${paramsSummary(p, tpl(p.templateKey))}`}
                  </div>
                </div>
                {!readOnly &&
                  (deletingId === p.id ? (
                    <ConfirmDelete
                      what={`проект «${p.name}»`}
                      pending={action.isPending}
                      onConfirm={() => run({ path: `${base}/${p.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <ReorderButtons label={p.name} disabled={action.isPending} onUp={shift(p.id, -1)} onDown={shift(p.id, 1)} />
                      {!p.archivedAt && (
                        <button type="button" onClick={() => openEdit(p.id)} className={btnSecondary}>
                          Изменить
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => run({ path: `${base}/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                        className={p.archivedAt ? btnSecondary : btnDanger}
                      >
                        {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(p.id);
                        }}
                        className={btnSecondary}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/client/pages/settings/CompaniesSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnDanger, btnPrimary, btnSecondary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCompanies, type Company } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

function CompanyRow({ c, currentId }: { c: Company; currentId: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState(c.name);
  const [baseCurrency, setBaseCurrency] = useState(c.baseCurrency);
  const dirty = name.trim() !== c.name || baseCurrency !== c.baseCurrency;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['companies'] });

  const save = useMutation<unknown, ApiError>({
    // отправляем только изменённые поля: позже смена валюты блокируется при наличии операций, переименование — нет
    mutationFn: () =>
      api(`/companies/${c.id}`, {
        method: 'PATCH',
        body: {
          ...(name.trim() !== c.name ? { name } : {}),
          ...(baseCurrency !== c.baseCurrency ? { baseCurrency } : {}),
        },
      }),
    onSuccess: invalidate,
  });
  const toggle = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidate();
      if (!c.archivedAt && c.id === currentId) navigate('/', { replace: true });
    },
  });
  const fields = save.error?.fields ?? {};
  const rowError = toggle.error ?? (save.error && !save.error.fields ? save.error : null);
  const readOnly = c.archivedAt !== null;

  return (
    <li className={`rounded-2xl border border-field p-4 ${readOnly ? 'opacity-70' : ''}`}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-start">
        <Field label="Название" error={fields.name}>
          {(f) => <input {...f} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Базовая валюта" error={fields.baseCurrency}>
          {(f) => (
            <select {...f} value={baseCurrency} disabled={readOnly} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass}>
              {CURRENCIES.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex gap-2 md:mt-6">
          {!readOnly && (
            <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={btnPrimary}>
              Сохранить
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              save.reset();
              toggle.mutate();
            }}
            className={readOnly ? btnSecondary : btnDanger}
          >
            {readOnly ? 'Вернуть из архива' : 'В архив'}
          </button>
        </div>
      </div>
      {readOnly && <p className="mt-2 text-sm text-muted">В архиве</p>}
      {rowError && (
        <p role="alert" className="mt-2 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          {rowError.message}
        </p>
      )}
    </li>
  );
}

export function CompaniesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const companies = useCompanies();
  if (!companies.data) return <Pending queries={[companies]} />;
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[companies]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Компании</h1>
        <Link to="/companies/new" className={btnPrimary}>
          Добавить компанию
        </Link>
      </div>
      <ul className="space-y-2">
        {companies.data.map((c) => (
          <CompanyRow key={`${c.id}-${c.name}-${c.baseCurrency}-${c.archivedAt}`} c={c} currentId={company.id} />
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client`, затем `npm run typecheck` и `npm run test:e2e`
Expected: PASS. Существующие e2e (вход, компании, проекты по шаблонам, истёкшая сессия) проходят без изменений: подписи полей теперь связаны через `label for`.

- [ ] **Step 5: Full check and commit**

Run: `npm test` — зелёные.

```bash
git add src/client tests/client
git commit -m "feat: клиент — поля с aria, данные раньше ошибки, порядок и удаление проектов, переименование счетов

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Экран «Счета»

**Files:**
- Create: `src/shared/money.ts`, `src/client/components/AccountForm.tsx`, `src/client/pages/settings/AccountsSettings.tsx`, `tests/shared/money.test.ts`
- Modify: `src/shared/dates.ts`, `tests/shared/dates.test.ts`, `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - API счетов (Task 4);
  - `Field`, `Pending`, `StaleNotice`, `ReorderButtons`, `ConfirmDelete`, `moveWithinGroup`, `alertClass`, `noticeClass` (Task 9).
- Produces:
  - `parseAmount(text: string, minorUnits: number): number | null`, `formatAmount(minor: number, minorUnits: number): string` (разряды через `U+202F`, минус `U+2212`);
  - `formatDateRu('2026-10-06') === '06.10.2026'`;
  - тип `Account`, хук `useAccounts(companyId)` с ключом `['accounts', companyId]`;
  - маршрут `/c/:companyId/settings/accounts`, раздел «Счета» в `SettingsNav`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from '../../src/shared/money';

describe('parseAmount', () => {
  it('запятая или точка, пробелы, знак минус → минимальные единицы', () => {
    expect(parseAmount('1 500,50', 2)).toBe(150050);
    expect(parseAmount('1\u202F500.5', 2)).toBe(150050);
    expect(parseAmount('0', 2)).toBe(0);
    expect(parseAmount(',5', 2)).toBe(50);
    expect(parseAmount('-10', 2)).toBe(-1000);
    expect(parseAmount('\u221210', 2)).toBe(-1000);
    expect(parseAmount('-0', 2)).toBe(0);
    expect(parseAmount('100', 0)).toBe(100);
    expect(parseAmount('1,234', 3)).toBe(1234);
  });

  it('лишние знаки после запятой, мусор и слишком большие числа — null', () => {
    expect(parseAmount('1,005', 2)).toBeNull();
    expect(parseAmount('1,5', 0)).toBeNull();
    for (const bad of ['', '-', ',', 'abc', '1e3', '1,2,3', '--1']) expect(parseAmount(bad, 2)).toBeNull();
    expect(parseAmount('99999999999999999', 2)).toBeNull();
  });
});

describe('formatAmount', () => {
  it('разряды узким неразрывным пробелом, запятая перед дробной частью', () => {
    expect(formatAmount(150050, 2)).toBe('1\u202F500,50');
    expect(formatAmount(5, 2)).toBe('0,05');
    expect(formatAmount(-1234567, 2)).toBe('\u221212\u202F345,67');
    expect(formatAmount(1000, 0)).toBe('1\u202F000');
    expect(formatAmount(0, 2)).toBe('0,00');
  });

  it('formatAmount → parseAmount возвращает исходное значение', () => {
    for (const v of [0, 1, 99, 150050, -77, 123456789]) expect(parseAmount(formatAmount(v, 2), 2)).toBe(v);
  });
});
```

Добавьте `formatDateRu` в импорт `tests/shared/dates.test.ts` и допишите:

```ts
describe('formatDateRu', () => {
  it('ГГГГ-ММ-ДД → ДД.ММ.ГГГГ', () => {
    expect(formatDateRu('2026-10-06')).toBe('06.10.2026');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/money.test.ts tests/shared/dates.test.ts`
Expected: FAIL — нет модуля `money` и функции `formatDateRu`.

- [ ] **Step 3: Implement**

`src/shared/money.ts`:

```ts
/**
 * Сумма из поля ввода → минимальные единицы валюты: «1 500,50», «1500.5», «-10», «,5».
 * Больше знаков после запятой, чем у валюты, — null (округление появится вместе с калькулятором суммы на шаге 6).
 */
export function parseAmount(text: string, minorUnits: number): number | null {
  const s = text.replace(/[\s\u00A0\u202F]/g, '').replace('\u2212', '-').replace(',', '.');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return null;
  if (frac.length > minorUnits) return null;
  const value = Number(int + frac.padEnd(minorUnits, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return m[1] === '-' && value !== 0 ? -value : value;
}

/** Минимальные единицы → «1 500,50»: разряды через узкий неразрывный пробел, минус — «\u2212». */
export function formatAmount(minor: number, minorUnits: number): string {
  const abs = String(Math.abs(minor)).padStart(minorUnits + 1, '0');
  const int = minorUnits > 0 ? abs.slice(0, -minorUnits) : abs;
  const frac = minorUnits > 0 ? abs.slice(-minorUnits) : '';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return `${minor < 0 ? '\u2212' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}
```

Допишите в `src/shared/dates.ts`:

```ts
/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ`. */
export function formatDateRu(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
}
```

`src/client/lib/queries.ts` — допишите:

```ts
export interface Account {
  id: number;
  companyId: number;
  projectId: number | null;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useAccounts(companyId: number) {
  return useQuery<Account[], ApiError>({
    queryKey: ['accounts', companyId],
    queryFn: async () => (await api<{ accounts: Account[] }>(`/companies/${companyId}/accounts`)).accounts,
  });
}
```

`src/client/components/AccountForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { CURRENCIES, getCurrency } from '../../shared/currencies';
import { formatAmount, parseAmount } from '../../shared/money';
import type { Account, Project } from '../lib/queries';
import { Field } from './Field';
import { btnPrimary, btnSecondary, inputClass } from './ui';

export interface AccountFormValues {
  name: string;
  currency: string;
  projectId: number | null;
  /** null — дата открытия по умолчанию (сегодня на сервере, в APP_TIMEZONE). */
  openedAt: string | null;
  startingBalance: number;
}

export function AccountForm(props: {
  mode: 'create' | 'edit';
  initial?: Account;
  defaultCurrency: string;
  projects: Project[];
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: AccountFormValues) => void;
  onCancel: () => void;
}) {
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [currency, setCurrency] = useState(init?.currency ?? props.defaultCurrency);
  const [projectId, setProjectId] = useState(init?.projectId != null ? String(init.projectId) : '');
  const [openedAt, setOpenedAt] = useState(init?.openedAt ?? '');
  const [balance, setBalance] = useState(init ? formatAmount(init.startingBalance, getCurrency(init.currency).minorUnits) : '0');
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const fields = { ...props.serverFields, ...clientFields };
  // архивные проекты не предлагаются (инвариант 7), кроме текущего проекта счёта
  const choices = props.projects.filter((p) => !p.archivedAt || p.id === init?.projectId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const minor = getCurrency(currency).minorUnits;
    const amount = parseAmount(balance, minor);
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Введите название';
    if (amount === null) {
      errors.startingBalance = minor > 0 ? `Введите сумму, например 1 500,${'5'.padEnd(minor, '0')}` : 'Введите сумму без дробной части, например 1 500';
    }
    if (props.mode === 'edit' && !openedAt) errors.openedAt = 'Укажите дату открытия';
    setClientFields(errors);
    if (amount === null || Object.keys(errors).length > 0) return;
    props.onSubmit({ name, currency, projectId: projectId ? Number(projectId) : null, openedAt: openedAt || null, startingBalance: amount });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 rounded-2xl bg-canvas p-4 md:grid-cols-2">
      <Field label="Название счёта" error={fields.name}>
        {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaspi Gold" className={inputClass} />}
      </Field>
      <Field label="Валюта" error={fields.currency}>
        {(c) => (
          <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Проект" error={fields.projectId}>
        {(c) => (
          <select {...c} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
            <option value="">Без проекта (общий счёт)</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archivedAt ? ' (в архиве)' : ''}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label="Дата открытия"
        error={fields.openedAt}
        hint={props.mode === 'create' ? 'Пусто — сегодня. Чтобы вносить прошлые операции, поставьте дату раньше.' : undefined}
      >
        {(c) => <input {...c} type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Остаток на дату открытия" error={fields.startingBalance}>
        {(c) => <input {...c} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className={inputClass} />}
      </Field>
      {props.serverError && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense md:col-span-2">
          {props.serverError}
        </p>
      )}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать счёт' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

`src/client/pages/settings/AccountsSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { formatAmount } from '../../../shared/money';
import { AccountForm, type AccountFormValues } from '../../components/AccountForm';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnDanger, btnPrimary, btnSecondary, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { moveWithinGroup } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useAccounts, useProjects, type Account } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Action = { path: string; method: 'POST' | 'DELETE'; body?: unknown };

function toBody(v: AccountFormValues) {
  return {
    name: v.name,
    currency: v.currency,
    projectId: v.projectId,
    startingBalance: v.startingBalance,
    ...(v.openedAt ? { openedAt: v.openedAt } : {}),
  };
}

export function AccountsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/accounts`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['accounts', company.id] });

  const create = useMutation<unknown, ApiError, AccountFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: toBody(v) }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; values: AccountFormValues }>({
    mutationFn: ({ id, values }) => api(`${base}/${id}`, { method: 'PATCH', body: toBody(values) }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method, body: a.body }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });

  const resetMessages = () => {
    create.reset();
    update.reset();
    action.reset();
  };
  const openCreate = () => {
    resetMessages();
    setEditingId(null);
    setDeletingId(null);
    setCreating(true);
  };
  const openEdit = (id: number) => {
    resetMessages();
    setCreating(false);
    setDeletingId(null);
    setEditingId(id);
  };
  const run = (a: Action) => {
    resetMessages();
    action.mutate(a);
  };

  if (!accounts.data || !projects.data) return <Pending queries={[accounts, projects]} />;
  const list = accounts.data;
  const projectList = projects.data;
  const ids = list.map((a) => a.id);
  const groups = [
    { key: 'common', title: 'Общие счета', items: list.filter((a) => a.projectId === null) },
    ...projectList.map((p) => ({
      key: `p${p.id}`,
      title: p.archivedAt ? `${p.name} (в архиве)` : p.name,
      items: list.filter((a) => a.projectId === p.id),
    })),
  ].filter((g) => g.items.length > 0);
  const shift = (group: Account[], id: number, delta: -1 | 1) => {
    const next = moveWithinGroup(
      ids,
      group.map((a) => a.id),
      id,
      delta,
    );
    return next ? () => run({ path: `${base}/reorder`, method: 'POST', body: { ids: next } }) : null;
  };

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[accounts, projects]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Счета</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={openCreate} className={btnPrimary}>
            Добавить счёт
          </button>
        )}
      </div>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <AccountForm
            mode="create"
            defaultCurrency={company.baseCurrency}
            projects={projectList}
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {list.length === 0 && !creating && <p className="text-muted">Счетов пока нет. Счёт — это касса, карта или банковский счёт.</p>}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
          <ul className="space-y-2">
            {g.items.map((a) => {
              const cur = getCurrency(a.currency);
              return (
                <li key={a.id} className={`rounded-2xl border border-field p-4 ${a.archivedAt ? 'opacity-60' : ''}`}>
                  {editingId === a.id ? (
                    <AccountForm
                      mode="edit"
                      initial={a}
                      defaultCurrency={company.baseCurrency}
                      projects={projectList}
                      pending={update.isPending}
                      serverFields={update.error?.fields}
                      serverError={update.error && !update.error.fields ? update.error.message : undefined}
                      onSubmit={(values) => update.mutate({ id: a.id, values })}
                      onCancel={() => {
                        setEditingId(null);
                        update.reset();
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {a.name} <span className="font-normal text-muted">{a.currency}</span>
                          {a.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                        </div>
                        <div className="text-sm text-muted">
                          Остаток на {formatDateRu(a.openedAt)}: {formatAmount(a.startingBalance, cur.minorUnits)} {cur.symbol}
                        </div>
                      </div>
                      {!readOnly &&
                        (deletingId === a.id ? (
                          <ConfirmDelete
                            what={`счёт «${a.name}»`}
                            pending={action.isPending}
                            onConfirm={() => run({ path: `${base}/${a.id}`, method: 'DELETE' })}
                            onCancel={() => setDeletingId(null)}
                          />
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <ReorderButtons
                              label={a.name}
                              disabled={action.isPending}
                              onUp={shift(g.items, a.id, -1)}
                              onDown={shift(g.items, a.id, 1)}
                            />
                            {!a.archivedAt && (
                              <button type="button" onClick={() => openEdit(a.id)} className={btnSecondary}>
                                Изменить
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => run({ path: `${base}/${a.id}/${a.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                              className={a.archivedAt ? btnSecondary : btnDanger}
                            >
                              {a.archivedAt ? 'Вернуть из архива' : 'В архив'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                resetMessages();
                                setDeletingId(a.id);
                              }}
                              className={btnSecondary}
                            >
                              Удалить
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
```

`src/client/router.tsx` — импорт и маршрут после `settings/projects`:

```tsx
import { AccountsSettings } from './pages/settings/AccountsSettings';
```

```tsx
          { path: 'settings/accounts', element: <AccountsSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в `SECTIONS` после «Проекты»:

```ts
  { path: 'accounts', label: 'Счета' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/money.test.ts tests/shared/dates.test.ts`, затем `npm run typecheck` и `npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` — зелёные.

```bash
git add src/shared/money.ts src/shared/dates.ts src/client tests/shared/money.test.ts tests/shared/dates.test.ts
git commit -m "feat: экран «Счета» — группы по проектам, остаток на дату открытия, архив и порядок

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Экран «Статьи» — два дерева, перетаскивание, «Перенести в…», ↑/↓

**Files:**
- Create: `src/client/lib/category-moves.ts`, `src/client/pages/settings/CategoriesSettings.tsx`, `tests/client/category-moves.test.ts`
- Modify: `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - API статей (Task 5);
  - `Field`, `Pending`, `StaleNotice`, `ReorderButtons`, `ConfirmDelete`, `btnSmall`, `alertClass`, `noticeClass` (Task 9).
- Produces:
  - `CategoryNode`, `CategoryTree`, `useCategories(companyId)` с ключом `['categories', companyId]`;
  - `MovePlan { kind; parentId; ids; moving }`: `planMove` передаёт `moving` = переносимая статья, `planShift` — `null`;
  - `moveError(tree, node, parentId): string | null`;
  - `planMove(tree, nodeId, { parentId, beforeId }): MovePlan | string`;
  - `planShift(tree, nodeId, delta): MovePlan | null`;
  - `parentChoices(tree, node): CategoryNode[]`;
  - маршрут `/c/:companyId/settings/categories`, раздел «Статьи».

- [ ] **Step 1: Write the failing test**

`tests/client/category-moves.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moveError, parentChoices, planMove, planShift } from '../../src/client/lib/category-moves';
import type { CategoryNode } from '../../src/client/lib/queries';

const n = (id: number, parentId: number | null, extra: Partial<CategoryNode> = {}, children: CategoryNode[] = []): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId,
  name: `c${id}`,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children,
  ...extra,
});

// 1 — системная (дочерняя 11), 2 — группа (21, 22), 3 — лист, 4 — в архиве
const tree = [n(1, null, { systemKey: 'salary' }, [n(11, 1)]), n(2, null, {}, [n(21, 2), n(22, 2)]), n(3, null), n(4, null, { archivedAt: 'x' })];

describe('перемещение статей на клиенте (те же правила, что на сервере)', () => {
  it('planMove: в другую группу, в конец, внутри группы, на верхний уровень', () => {
    expect(planMove(tree, 21, { parentId: 1, beforeId: 11 })).toEqual({ kind: 'expense', parentId: 1, ids: [21, 11], moving: 21 });
    expect(planMove(tree, 3, { parentId: 2, beforeId: null })).toEqual({ kind: 'expense', parentId: 2, ids: [21, 22, 3], moving: 3 });
    expect(planMove(tree, 22, { parentId: 2, beforeId: 21 })).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: 22 });
    expect(planMove(tree, 21, { parentId: null, beforeId: 3 })).toEqual({ kind: 'expense', parentId: null, ids: [1, 2, 21, 3, 4], moving: 21 });
  });

  it('planMove: запреты §7', () => {
    expect(planMove(tree, 1, { parentId: 2, beforeId: null })).toBe('Системная статья остаётся на верхнем уровне');
    expect(planMove(tree, 2, { parentId: 3, beforeId: null })).toBe('Статью с дочерними нельзя сделать дочерней');
    expect(planMove(tree, 3, { parentId: 21, beforeId: null })).toBe('Вкладывать можно только в статью верхнего уровня');
    expect(planMove(tree, 3, { parentId: 3, beforeId: null })).toBe('Статью нельзя вложить в саму себя');
    expect(planMove(tree, 3, { parentId: 4, beforeId: null })).toBe('Родительская статья в архиве');
    expect(planMove(tree, 99, { parentId: null, beforeId: null })).toBe('Статья не найдена');
    expect(moveError(tree, tree[2]!, null)).toBeNull();
  });

  it('planShift и parentChoices', () => {
    expect(planShift(tree, 22, -1)).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: null });
    expect(planShift(tree, 21, -1)).toBeNull();
    expect(planShift(tree, 4, 1)).toBeNull();
    expect(planShift(tree, 2, 1)).toEqual({ kind: 'expense', parentId: null, ids: [1, 3, 2, 4], moving: null });
    expect(parentChoices(tree, tree[2]!).map((p) => p.id)).toEqual([1, 2]);
    expect(parentChoices(tree, tree[1]!.children[0]!).map((p) => p.id)).toEqual([1, 3]);
    expect(parentChoices(tree, tree[0]!)).toEqual([]);
    expect(parentChoices(tree, tree[1]!)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/category-moves.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Implement**

`src/client/lib/queries.ts` — допишите:

```ts
export interface CategoryNode {
  id: number;
  companyId: number;
  kind: 'income' | 'expense';
  parentId: number | null;
  name: string;
  systemKey: string | null;
  effectiveSystemKey: string | null;
  templateRef: string | null;
  orderIndex: number;
  archivedAt: string | null;
  children: CategoryNode[];
}

export interface CategoryTree {
  income: CategoryNode[];
  expense: CategoryNode[];
}

export function useCategories(companyId: number) {
  return useQuery<CategoryTree, ApiError>({
    queryKey: ['categories', companyId],
    queryFn: () => api<CategoryTree>(`/companies/${companyId}/categories`),
  });
}
```

`src/client/lib/category-moves.ts`:

```ts
import type { CategoryNode } from './queries';

/** Тело POST /categories/reorder: новый порядок детей parentId в дереве kind; moving — переносимая сюда статья. */
export interface MovePlan {
  kind: 'income' | 'expense';
  parentId: number | null;
  ids: number[];
  moving: number | null;
}

function findNode(tree: readonly CategoryNode[], id: number): CategoryNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const child = node.children.find((c) => c.id === id);
    if (child) return child;
  }
  return undefined;
}

/** Почему статью нельзя вложить в parentId (null — можно). Те же правила, что на сервере (§7). */
export function moveError(tree: readonly CategoryNode[], node: CategoryNode, parentId: number | null): string | null {
  if (parentId === null) return null;
  const parent = tree.find((p) => p.id === parentId);
  if (!parent) return 'Вкладывать можно только в статью верхнего уровня';
  if (parent.id === node.id) return 'Статью нельзя вложить в саму себя';
  if (parent.archivedAt) return 'Родительская статья в архиве';
  if (node.systemKey) return 'Системная статья остаётся на верхнем уровне';
  if (node.children.length > 0) return 'Статью с дочерними нельзя сделать дочерней';
  return null;
}

/** Статья встаёт в список детей parentId перед beforeId (null — в конец). Строка — причина запрета. */
export function planMove(
  tree: readonly CategoryNode[],
  nodeId: number,
  target: { parentId: number | null; beforeId: number | null },
): MovePlan | string {
  const node = findNode(tree, nodeId);
  if (!node) return 'Статья не найдена';
  const err = moveError(tree, node, target.parentId);
  if (err) return err;
  const level = target.parentId === null ? tree : (tree.find((p) => p.id === target.parentId)?.children ?? []);
  const ids = level.map((c) => c.id).filter((id) => id !== nodeId);
  const at = target.beforeId === null ? -1 : ids.indexOf(target.beforeId);
  if (at < 0) ids.push(nodeId);
  else ids.splice(at, 0, nodeId);
  return { kind: node.kind, parentId: target.parentId, ids, moving: nodeId };
}

/** Сдвиг на одну позицию среди соседей; null — двигать некуда. */
export function planShift(tree: readonly CategoryNode[], nodeId: number, delta: -1 | 1): MovePlan | null {
  const node = findNode(tree, nodeId);
  if (!node) return null;
  const level = node.parentId === null ? tree : (findNode(tree, node.parentId)?.children ?? []);
  const ids = level.map((c) => c.id);
  const i = ids.indexOf(nodeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return { kind: node.kind, parentId: node.parentId, ids, moving: null };
}

/** Куда можно перенести статью через «Перенести в…»: допустимые родители, кроме текущего. */
export function parentChoices(tree: readonly CategoryNode[], node: CategoryNode): CategoryNode[] {
  return tree.filter((p) => p.id !== node.parentId && moveError(tree, node, p.id) === null);
}
```

`src/client/pages/settings/CategoriesSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { parentChoices, planMove, planShift, type MovePlan } from '../../lib/category-moves';
import { queryClient } from '../../lib/query';
import { useCategories, type CategoryNode } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Kind = 'income' | 'expense';
type Action = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown };

const TITLES: Record<Kind, string> = { income: 'Доходы', expense: 'Расходы' };
const badge = 'ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted';

function TreeSection(props: {
  kind: Kind;
  nodes: CategoryNode[];
  base: string;
  readOnly: boolean;
  pending: boolean;
  /** true — запрос прошёл. */
  run: (a: Action) => Promise<boolean>;
  onLocalError: (message: string) => void;
}) {
  const { kind, nodes, base } = props;
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const move = (plan: MovePlan | string | null) => {
    if (plan === null) return;
    if (typeof plan === 'string') props.onLocalError(plan);
    else void props.run({ path: `${base}/reorder`, method: 'POST', body: plan });
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await props.run({ path: base, method: 'POST', body: { kind, name, parentId: parentId ? Number(parentId) : null } })) setName('');
  };
  const dropPlan = (target: CategoryNode) =>
    dragId === null ? null : planMove(nodes, dragId, { parentId: target.parentId, beforeId: target.id });

  const row = (n: CategoryNode) => {
    const editable = !props.readOnly && !n.systemKey;
    const choices = parentChoices(nodes, n);
    const canChooseParent = editable && !n.archivedAt && (choices.length > 0 || n.parentId !== null);
    const up = planShift(nodes, n.id, -1);
    const down = planShift(nodes, n.id, 1);
    return (
      // имя строки — название статьи: текст строки включает подписи выпадающего списка «Перенести в…»
      <li key={n.id} aria-label={n.name}>
        <div
          draggable={!props.readOnly && renamingId !== n.id}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', String(n.id));
            e.dataTransfer.effectAllowed = 'move';
            setDragId(n.id);
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => {
            const plan = dragId !== n.id ? dropPlan(n) : null;
            if (plan !== null && typeof plan !== 'string') e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const plan = dropPlan(n);
            setDragId(null);
            move(plan);
          }}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-field ${n.archivedAt ? 'opacity-60' : ''}`}
        >
          {renamingId === n.id ? (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await props.run({ path: `${base}/${n.id}`, method: 'PATCH', body: { name: renameValue } })) setRenamingId(null);
              }}
            >
              <input
                aria-label={`Новое название статьи «${n.name}»`}
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className={inputClass}
              />
              <button type="submit" disabled={!renameValue.trim() || props.pending} className={btnPrimary}>
                Сохранить
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className={btnSecondary}>
                Отмена
              </button>
            </form>
          ) : (
            <>
              <span className="min-w-0">
                {!props.readOnly && (
                  <span aria-hidden="true" className="mr-2 cursor-grab text-muted">
                    ⠿
                  </span>
                )}
                {n.name}
                {n.systemKey && <span className={badge}>системная</span>}
                {n.archivedAt && <span className={badge}>в архиве</span>}
              </span>
              {!props.readOnly &&
                (deletingId === n.id ? (
                  <ConfirmDelete
                    what={`статью «${n.name}»`}
                    pending={props.pending}
                    onConfirm={async () => {
                      if (await props.run({ path: `${base}/${n.id}`, method: 'DELETE' })) setDeletingId(null);
                    }}
                    onCancel={() => setDeletingId(null)}
                  />
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <ReorderButtons label={n.name} disabled={props.pending} onUp={up ? () => move(up) : null} onDown={down ? () => move(down) : null} />
                    {canChooseParent && (
                      <select
                        aria-label={`Перенести «${n.name}»`}
                        value=""
                        onChange={(e) =>
                          move(planMove(nodes, n.id, { parentId: e.target.value === 'top' ? null : Number(e.target.value), beforeId: null }))
                        }
                        className="rounded-lg bg-field px-2 py-1.5 text-sm"
                      >
                        <option value="" disabled>
                          Перенести в…
                        </option>
                        {n.parentId !== null && <option value="top">Верхний уровень</option>}
                        {choices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {editable && !n.archivedAt && (
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(n.name);
                          setRenamingId(n.id);
                        }}
                        className={btnSmall}
                      >
                        Переименовать
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        onClick={() => void props.run({ path: `${base}/${n.id}/${n.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                        className={btnSmall}
                      >
                        {n.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                    )}
                    {editable && (
                      <button type="button" onClick={() => setDeletingId(n.id)} className={btnSmall}>
                        Удалить
                      </button>
                    )}
                  </span>
                ))}
            </>
          )}
        </div>
        {n.children.length > 0 && <ul className="ml-6 border-l border-field pl-2">{n.children.map((c) => row(c))}</ul>}
      </li>
    );
  };

  return (
    <section aria-labelledby={`categories-${kind}`} className="rounded-2xl border border-field p-4">
      <h2 id={`categories-${kind}`} className="mb-3 text-lg font-semibold">
        {TITLES[kind]}
      </h2>
      {!props.readOnly && (
        <form onSubmit={add} className="mb-4 grid gap-2 md:grid-cols-[1fr_12rem_auto] md:items-end">
          <Field label={kind === 'income' ? 'Новая статья доходов' : 'Новая статья расходов'}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Родитель">
            {(c) => (
              <select {...c} value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
                <option value="">Верхний уровень</option>
                {nodes
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <button type="submit" disabled={!name.trim() || props.pending} className={btnPrimary}>
            Добавить
          </button>
        </form>
      )}
      <ul>{nodes.map((n) => row(n))}</ul>
    </section>
  );
}

export function CategoriesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const categories = useCategories(company.id);
  const [localError, setLocalError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/categories`;
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method, body: a.body }),
    // и после ошибки (например, 409 «список изменился») — свежее дерево
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
  });
  const run = async (a: Action): Promise<boolean> => {
    setLocalError(null);
    action.reset();
    try {
      await action.mutateAsync(a);
      return true;
    } catch {
      return false;
    }
  };

  if (!categories.data) return <Pending queries={[categories]} />;
  const tree = categories.data;
  const serverError = action.error ? (action.error.fields ? Object.values(action.error.fields).join('. ') : action.error.message) : null;
  const error = localError ?? serverError;

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[categories]} />
      <h1 className="mb-2 text-2xl font-bold">Статьи</h1>
      <p className="mb-4 text-sm text-muted">
        Перетащите статью мышью или используйте ↑/↓ и «Перенести в…». Вложенность — не больше двух уровней; системные статьи остаются на
        верхнем уровне, но в них можно вкладывать.
      </p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {(['income', 'expense'] as const).map((kind) => (
          <TreeSection
            key={kind}
            kind={kind}
            nodes={tree[kind]}
            base={base}
            readOnly={readOnly}
            pending={action.isPending}
            run={run}
            onLocalError={setLocalError}
          />
        ))}
      </div>
    </section>
  );
}
```

`src/client/router.tsx` — импорт и маршрут после `settings/accounts`:

```tsx
import { CategoriesSettings } from './pages/settings/CategoriesSettings';
```

```tsx
          { path: 'settings/categories', element: <CategoriesSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в `SECTIONS` после «Счета»:

```ts
  { path: 'categories', label: 'Статьи' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client`, затем `npm run typecheck` и `npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` — зелёные.

```bash
git add src/client tests/client/category-moves.test.ts
git commit -m "feat: экран «Статьи» — два дерева, перетаскивание, перенос и порядок по правилам §7

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 12: Экраны «Контрагенты» (вкладки по типам, поиск) и «Теги» (восстановление архивного вместо дубля)

**Files:**
- Create: `src/client/pages/settings/CounterpartiesSettings.tsx`, `src/client/pages/settings/TagsSettings.tsx`
- Modify: `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - API контрагентов и тегов (Task 6);
  - `COUNTERPARTY_TYPES`, `COUNTERPARTY_TYPE_LABELS`, `COUNTERPARTY_TYPE_SINGULAR` (Task 3);
  - `matchesQuery`, `foldCase`, `cleanName` (Task 1);
  - компоненты Task 9.
- Produces:
  - `Counterparty`, `useCounterparties(companyId)` с ключом `['counterparties', companyId]`;
  - `Tag`, `useTags(companyId)` с ключом `['tags', companyId]`;
  - маршруты `/c/:companyId/settings/counterparties` и `/c/:companyId/settings/tags`;
  - разделы «Контрагенты» и «Теги».

- [ ] **Step 1: Implement**

Логика экранов — фильтр, поиск, сравнение имён — построена на уже покрытых тестами функциях (`matchesQuery`, `foldCase`, `cleanName`). Поведение экранов проверяет e2e задачи 14.

`src/client/lib/queries.ts` — импорт типа и новые хуки:

```ts
import type { CounterpartyType } from '../../shared/system-categories';
```

```ts
export interface Counterparty {
  id: number;
  companyId: number;
  type: CounterpartyType;
  name: string;
  comment: string | null;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useCounterparties(companyId: number) {
  return useQuery<Counterparty[], ApiError>({
    queryKey: ['counterparties', companyId],
    queryFn: async () => (await api<{ counterparties: Counterparty[] }>(`/companies/${companyId}/counterparties`)).counterparties,
  });
}

export interface Tag {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useTags(companyId: number) {
  return useQuery<Tag[], ApiError>({
    queryKey: ['tags', companyId],
    queryFn: async () => (await api<{ tags: Tag[] }>(`/companies/${companyId}/tags`)).tags,
  });
}
```

`src/client/pages/settings/CounterpartiesSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { COUNTERPARTY_TYPE_LABELS, COUNTERPARTY_TYPE_SINGULAR, COUNTERPARTY_TYPES } from '../../../shared/counterparties';
import { matchesQuery } from '../../../shared/search';
import type { CounterpartyType } from '../../../shared/system-categories';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCounterparties } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Tab = 'all' | CounterpartyType;
type Action = { path: string; method: 'POST' | 'DELETE' };

interface Draft {
  type: CounterpartyType;
  name: string;
  comment: string;
}

function CounterpartyForm(props: {
  initial: Draft;
  submitLabel: string;
  pending: boolean;
  fields?: Record<string, string>;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const fields = props.fields ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(draft);
      }}
      className="grid gap-3 rounded-2xl bg-canvas p-4 md:grid-cols-[12rem_1fr_1fr_auto] md:items-start"
    >
      <Field label="Тип" error={fields.type}>
        {(c) => (
          <select {...c} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CounterpartyType })} className={inputClass}>
            {COUNTERPARTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {COUNTERPARTY_TYPE_SINGULAR[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Название контрагента" error={fields.name}>
        {(c) => <input {...c} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Комментарий" error={fields.comment}>
        {(c) => <input {...c} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} className={inputClass} />}
      </Field>
      <div className="flex gap-2 md:mt-6">
        <button type="submit" disabled={props.pending || !draft.name.trim()} className={btnPrimary}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className={btnSecondary}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}

export function CounterpartiesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const counterparties = useCounterparties(company.id);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [createKey, setCreateKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/counterparties`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['counterparties', company.id] });
  const toBody = (d: Draft) => ({ type: d.type, name: d.name, comment: d.comment });

  const create = useMutation<unknown, ApiError, Draft>({
    mutationFn: (d) => api(base, { method: 'POST', body: toBody(d) }),
    onSuccess: async () => {
      await invalidate();
      setCreateKey((k) => k + 1); // пустая форма для следующего контрагента
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; draft: Draft }>({
    mutationFn: ({ id, draft }) => api(`${base}/${id}`, { method: 'PATCH', body: toBody(draft) }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    action.reset();
  };

  if (!counterparties.data) return <Pending queries={[counterparties]} />;
  const all = counterparties.data;
  const visible = all
    .filter((c) => (tab === 'all' || c.type === tab) && matchesQuery(`${c.name} ${c.comment ?? ''}`, query))
    .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
  const error = action.error ?? (create.error && !create.error.fields ? create.error : null) ?? (update.error && !update.error.fields ? update.error : null);
  const tabs: Tab[] = ['all', ...COUNTERPARTY_TYPES];

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[counterparties]} />
      <h1 className="mb-4 text-2xl font-bold">Контрагенты</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!readOnly && (
        <div className="mb-6">
          <CounterpartyForm
            key={`${createKey}-${tab}`}
            initial={{ type: tab === 'all' ? 'client' : tab, name: '', comment: '' }}
            submitLabel="Добавить"
            pending={create.isPending}
            fields={create.error?.fields}
            onSubmit={(d) => {
              resetMessages();
              create.mutate(d);
            }}
          />
        </div>
      )}
      <div role="tablist" aria-label="Типы контрагентов" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls="counterparties-panel"
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-1.5 text-sm ${tab === t ? 'bg-ink font-semibold text-white' : 'bg-field text-ink hover:brightness-95'}`}
          >
            {t === 'all' ? 'Все' : COUNTERPARTY_TYPE_LABELS[t]}{' '}
            <span className={tab === t ? 'text-white/70' : 'text-muted'}>{t === 'all' ? all.length : all.filter((c) => c.type === t).length}</span>
          </button>
        ))}
      </div>
      <Field label="Поиск" className="mb-4 block max-w-md">
        {(c) => <input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или комментарий" className={inputClass} />}
      </Field>
      <div id="counterparties-panel" role="tabpanel">
        {visible.length === 0 && <p className="text-muted">{all.length === 0 ? 'Контрагентов пока нет.' : 'Ничего не найдено.'}</p>}
        <ul className="space-y-2">
          {visible.map((c) => (
            <li key={c.id} className={`rounded-2xl border border-field p-4 ${c.archivedAt ? 'opacity-60' : ''}`}>
              {editingId === c.id ? (
                <CounterpartyForm
                  initial={{ type: c.type, name: c.name, comment: c.comment ?? '' }}
                  submitLabel="Сохранить"
                  pending={update.isPending}
                  fields={update.error?.fields}
                  onSubmit={(draft) => update.mutate({ id: c.id, draft })}
                  onCancel={() => {
                    setEditingId(null);
                    update.reset();
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {c.name}
                      {c.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                    </div>
                    <div className="text-sm text-muted">
                      {COUNTERPARTY_TYPE_SINGULAR[c.type]}
                      {c.comment ? ` · ${c.comment}` : ''}
                    </div>
                  </div>
                  {!readOnly &&
                    (deletingId === c.id ? (
                      <ConfirmDelete
                        what={`контрагента «${c.name}»`}
                        pending={action.isPending}
                        onConfirm={() => action.mutate({ path: `${base}/${c.id}`, method: 'DELETE' })}
                        onCancel={() => setDeletingId(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!c.archivedAt && (
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setDeletingId(null);
                              setEditingId(c.id);
                            }}
                            className={btnSmall}
                          >
                            Изменить
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            action.mutate({ path: `${base}/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                          }}
                          className={btnSmall}
                        >
                          {c.archivedAt ? 'Вернуть из архива' : 'В архив'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setDeletingId(c.id);
                          }}
                          className={btnSmall}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

`src/client/pages/settings/TagsSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useTags } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Action = { path: string; method: 'POST' | 'DELETE' };

/** То же сравнение, что у сервера (name_key): без учёта регистра, «ё» и невидимых символов. */
const sameTag = (a: string, b: string) => foldCase(cleanName(a)) === foldCase(cleanName(b));

export function TagsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const tags = useTags(company.id);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/tags`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tags', company.id] });

  const create = useMutation<unknown, ApiError, string>({
    mutationFn: (n) => api(base, { method: 'POST', body: { name: n } }),
    onSuccess: async () => {
      await invalidate();
      setName('');
    },
  });
  const rename = useMutation<unknown, ApiError, { id: number; name: string }>({
    mutationFn: (v) => api(`${base}/${v.id}`, { method: 'PATCH', body: { name: v.name } }),
    onSuccess: async () => {
      await invalidate();
      setRenamingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });
  const resetMessages = () => {
    create.reset();
    rename.reset();
    action.reset();
  };

  if (!tags.data) return <Pending queries={[tags]} />;
  const list = tags.data;
  // имя совпало с архивным тегом — предлагаем вернуть его вместо дубля (§4.4)
  const archivedMatch = create.error?.code === 'ARCHIVED_DUPLICATE' ? list.find((t) => t.archivedAt && sameTag(t.name, name)) : undefined;
  const error = action.error ?? (rename.error && !rename.error.fields ? rename.error : null);

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[tags]} />
      <h1 className="mb-4 text-2xl font-bold">Теги</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!readOnly && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            resetMessages();
            create.mutate(name);
          }}
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          <Field label="Новый тег" error={archivedMatch ? undefined : create.error?.fields?.name} className="min-w-64 flex-1">
            {(c) => (
              <input
                {...c}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  create.reset();
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="submit" disabled={!name.trim() || create.isPending} className={btnPrimary}>
            Добавить
          </button>
        </form>
      )}
      {archivedMatch && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-field px-4 py-3 text-sm">
          <span>Тег «{archivedMatch.name}» есть в архиве.</span>
          <button
            type="button"
            className={btnPrimary}
            onClick={() =>
              action.mutate(
                { path: `${base}/${archivedMatch.id}/unarchive`, method: 'POST' },
                {
                  onSuccess: () => {
                    create.reset();
                    setName('');
                  },
                },
              )
            }
          >
            Вернуть из архива
          </button>
        </div>
      )}
      {list.length === 0 && <p className="text-muted">Тегов пока нет. Теги помогают отмечать операции поперёк статей и проектов.</p>}
      <ul className="space-y-2">
        {list.map((t) => (
          <li key={t.id} className={`rounded-2xl border border-field px-4 py-3 ${t.archivedAt ? 'opacity-60' : ''}`}>
            {renamingId === t.id ? (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate({ id: t.id, name: renameValue });
                }}
                className="flex flex-wrap items-start gap-2"
              >
                <Field label={`Новое название тега «${t.name}»`} error={rename.error?.fields?.name} className="min-w-64 flex-1">
                  {(c) => <input {...c} autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className={inputClass} />}
                </Field>
                <div className="flex gap-2 md:mt-6">
                  <button type="submit" disabled={!renameValue.trim() || rename.isPending} className={btnPrimary}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(null);
                      rename.reset();
                    }}
                    className={btnSecondary}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold">
                  {t.name}
                  {t.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs font-normal text-muted">В архиве</span>}
                </span>
                {!readOnly &&
                  (deletingId === t.id ? (
                    <ConfirmDelete
                      what={`тег «${t.name}»`}
                      pending={action.isPending}
                      onConfirm={() => action.mutate({ path: `${base}/${t.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {!t.archivedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setRenameValue(t.name);
                            setRenamingId(t.id);
                          }}
                          className={btnSmall}
                        >
                          Переименовать
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          action.mutate({ path: `${base}/${t.id}/${t.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                        }}
                        className={btnSmall}
                      >
                        {t.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(t.id);
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
    </section>
  );
}
```

`src/client/router.tsx` — импорты и маршруты после `settings/categories`:

```tsx
import { CounterpartiesSettings } from './pages/settings/CounterpartiesSettings';
import { TagsSettings } from './pages/settings/TagsSettings';
```

```tsx
          { path: 'settings/counterparties', element: <CounterpartiesSettings /> },
          { path: 'settings/tags', element: <TagsSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в `SECTIONS` после «Статьи»:

```ts
  { path: 'counterparties', label: 'Контрагенты' },
  { path: 'tags', label: 'Теги' },
```

- [ ] **Step 2: Check**

Run: `npm run typecheck`, `npm test`, `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client
git commit -m "feat: экраны «Контрагенты» (вкладки, поиск) и «Теги» (возврат архивного вместо дубля)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Экран «Шаблоны разделения»

**Files:**
- Create: `src/client/pages/settings/SplitPresetsSettings.tsx`
- Modify: `src/client/lib/queries.ts`, `src/client/router.tsx`, `src/client/pages/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes:
  - API шаблонов разделения (Task 7);
  - `parsePercentToBp`, `formatBp`, `SPLIT_TOTAL_BP` (Task 7);
  - `useCategories`, `CategoryNode`, `CategoryTree` (Task 11);
  - `useProjects`, компоненты Task 9.
- Produces:
  - `SplitLine`, `SplitPreset`, `useSplitPresets(companyId)` с ключом `['split-presets', companyId]`;
  - маршрут `/c/:companyId/settings/split-presets`, раздел «Шаблоны разделения».

- [ ] **Step 1: Implement**

Разбор процентов (`parsePercentToBp`) и правило «ровно 100%» покрыты тестами задачи 7. Экран проверяет e2e задачи 14.

`src/client/lib/queries.ts` — допишите:

```ts
export interface SplitLine {
  categoryId: number | null;
  projectId: number | null;
  /** Сотые доли процента, 10000 = 100%. */
  bp: number;
}

export interface SplitPreset {
  id: number;
  companyId: number;
  name: string;
  lines: SplitLine[];
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useSplitPresets(companyId: number) {
  return useQuery<SplitPreset[], ApiError>({
    queryKey: ['split-presets', companyId],
    queryFn: async () => (await api<{ splitPresets: SplitPreset[] }>(`/companies/${companyId}/split-presets`)).splitPresets,
  });
}
```

`src/client/pages/settings/SplitPresetsSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { formatBp, parsePercentToBp } from '../../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../../shared/schemas/split-presets';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnIcon, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCategories, useProjects, useSplitPresets, type CategoryNode, type CategoryTree, type Project, type SplitLine, type SplitPreset } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Kind = 'income' | 'expense';
type Action = { path: string; method: 'POST' | 'DELETE' };

interface LineDraft {
  categoryId: string;
  projectId: string;
  percent: string;
}

interface Draft {
  name: string;
  kind: Kind;
  lines: LineDraft[];
}

interface Option {
  id: number;
  label: string;
  archived: boolean;
}

const emptyLine = (): LineDraft => ({ categoryId: '', projectId: '', percent: '' });

/** Статьи дерева плоским списком: «Родитель», «Родитель → Дочерняя». */
function flatten(nodes: CategoryNode[]): Option[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: n.name, archived: n.archivedAt !== null },
    ...n.children.map((c) => ({ id: c.id, label: `${n.name} → ${c.name}`, archived: c.archivedAt !== null || n.archivedAt !== null })),
  ]);
}

function toDraft(p: SplitPreset, tree: CategoryTree): Draft {
  const firstCategory = p.lines.find((l) => l.categoryId !== null)?.categoryId;
  const isIncome = firstCategory != null && flatten(tree.income).some((o) => o.id === firstCategory);
  return {
    name: p.name,
    kind: isIncome ? 'income' : 'expense',
    lines: p.lines.map((l) => ({
      categoryId: l.categoryId === null ? '' : String(l.categoryId),
      projectId: l.projectId === null ? '' : String(l.projectId),
      percent: formatBp(l.bp),
    })),
  };
}

/** Выпадающий список: архивные не предлагаются, но уже выбранный архивный элемент виден с пометкой. */
function OptionSelect(props: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const selected = props.options.find((o) => String(o.id) === props.value);
  return (
    <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)} className={inputClass}>
      <option value="">—</option>
      {props.options
        .filter((o) => !o.archived)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      {selected?.archived && <option value={props.value}>{selected.label} (в архиве)</option>}
      {props.value !== '' && !selected && <option value={props.value}>(удалено)</option>}
    </select>
  );
}

function PresetForm(props: {
  initial: Draft;
  tree: CategoryTree;
  projects: Project[];
  submitLabel: string;
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (body: { name: string; lines: SplitLine[] }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const categoryOptions = flatten(props.tree[draft.kind]);
  const projectOptions: Option[] = props.projects.map((p) => ({ id: p.id, label: p.name, archived: p.archivedAt !== null }));
  const parsed = draft.lines.map((l) => parsePercentToBp(l.percent));
  const total = parsed.reduce<number>((s, bp) => s + (bp ?? 0), 0);
  const linesValid = draft.lines.every((l, i) => (parsed[i] ?? 0) > 0 && (l.categoryId !== '' || l.projectId !== ''));
  const canSave = draft.name.trim() !== '' && linesValid && total === SPLIT_TOTAL_BP && !props.pending;
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setDraft({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    props.onSubmit({
      name: draft.name,
      lines: draft.lines.map((l, i) => ({
        categoryId: l.categoryId ? Number(l.categoryId) : null,
        projectId: l.projectId ? Number(l.projectId) : null,
        bp: parsed[i] ?? 0,
      })),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Название шаблона" error={props.serverFields?.name}>
          {(c) => <input {...c} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />}
        </Field>
        <Field label="Вид статей">
          {(c) => (
            <select
              {...c}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind, lines: draft.lines.map((l) => ({ ...l, categoryId: '' })) })}
              className={inputClass}
            >
              <option value="expense">Расходы</option>
              <option value="income">Доходы</option>
            </select>
          )}
        </Field>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-normal">Статья</th>
            <th className="pb-1 font-normal">Проект</th>
            <th className="w-32 pb-1 font-normal">Доля, %</th>
            <th className="w-12 pb-1">
              <span className="sr-only">Удалить строку</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((l, i) => (
            <tr key={i}>
              <td className="pb-2 pr-2">
                <OptionSelect label={`Статья, строка ${i + 1}`} value={l.categoryId} options={categoryOptions} onChange={(v) => setLine(i, { categoryId: v })} />
              </td>
              <td className="pb-2 pr-2">
                <OptionSelect label={`Проект, строка ${i + 1}`} value={l.projectId} options={projectOptions} onChange={(v) => setLine(i, { projectId: v })} />
              </td>
              <td className="pb-2 pr-2">
                <input
                  aria-label={`Доля %, строка ${i + 1}`}
                  aria-invalid={l.percent !== '' && parsed[i] === null ? true : undefined}
                  inputMode="decimal"
                  value={l.percent}
                  onChange={(e) => setLine(i, { percent: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td className="pb-2">
                <button
                  type="button"
                  aria-label={`Удалить строку ${i + 1}`}
                  disabled={draft.lines.length <= 1}
                  onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                  className={btnIcon}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={draft.lines.length >= 20}
          onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
          className={btnSmall}
        >
          + Строка
        </button>
        <p role="status" className={`text-sm font-semibold ${total === SPLIT_TOTAL_BP ? 'text-income' : 'text-expense'}`}>
          Распределено {formatBp(total)}% из 100%
          {total !== SPLIT_TOTAL_BP && ` · ${total < SPLIT_TOTAL_BP ? 'осталось' : 'лишние'} ${formatBp(Math.abs(SPLIT_TOTAL_BP - total))}%`}
        </p>
      </div>
      {(props.serverFields?.lines ?? props.serverError) && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {props.serverFields?.lines ?? props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!canSave} className={btnPrimary}>
          {props.submitLabel}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function SplitPresetsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const presets = useSplitPresets(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/split-presets`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['split-presets', company.id] });

  const create = useMutation<unknown, ApiError, { name: string; lines: SplitLine[] }>({
    mutationFn: (body) => api(base, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; body: { name: string; lines: SplitLine[] } }>({
    mutationFn: ({ id, body }) => api(`${base}/${id}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    action.reset();
  };

  if (!presets.data || !categories.data || !projects.data) return <Pending queries={[presets, categories, projects]} />;
  const list = presets.data;
  const tree = categories.data;
  const projectList = projects.data;
  const categoryLabel = new Map([...flatten(tree.income), ...flatten(tree.expense)].map((o) => [o.id, o.label]));
  const projectName = new Map(projectList.map((p) => [p.id, p.name]));
  const summary = (p: SplitPreset) =>
    p.lines
      .map((l) => {
        const parts = [
          l.categoryId === null ? null : (categoryLabel.get(l.categoryId) ?? '(удалено)'),
          l.projectId === null ? null : (projectName.get(l.projectId) ?? '(удалено)'),
        ].filter(Boolean);
        return `${parts.join(' · ')} — ${formatBp(l.bp)}%`;
      })
      .join('; ');

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[presets, categories, projects]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Шаблоны разделения</h1>
        {!readOnly && !creating && (
          <button
            type="button"
            onClick={() => {
              resetMessages();
              setEditingId(null);
              setCreating(true);
            }}
            className={btnPrimary}
          >
            Добавить шаблон
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">Шаблон делит сумму операции между статьями и проектами в заданных долях; сумма долей — ровно 100%.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <PresetForm
            initial={{ name: '', kind: 'expense', lines: [emptyLine(), emptyLine()] }}
            tree={tree}
            projects={projectList}
            submitLabel="Сохранить шаблон"
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(body) => create.mutate(body)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {list.length === 0 && !creating && <p className="text-muted">Шаблонов пока нет.</p>}
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <PresetForm
                initial={toDraft(p, tree)}
                tree={tree}
                projects={projectList}
                submitLabel="Сохранить шаблон"
                pending={update.isPending}
                serverFields={update.error?.fields}
                serverError={update.error && !update.error.fields ? update.error.message : undefined}
                onSubmit={(body) => update.mutate({ id: p.id, body })}
                onCancel={() => {
                  setEditingId(null);
                  update.reset();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {p.name}
                    {p.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                  </div>
                  <div className="text-sm text-muted">{summary(p)}</div>
                </div>
                {!readOnly &&
                  (deletingId === p.id ? (
                    <ConfirmDelete
                      what={`шаблон «${p.name}»`}
                      pending={action.isPending}
                      onConfirm={() => action.mutate({ path: `${base}/${p.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!p.archivedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setCreating(false);
                            setEditingId(p.id);
                          }}
                          className={btnSmall}
                        >
                          Изменить
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          action.mutate({ path: `${base}/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                        }}
                        className={btnSmall}
                      >
                        {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(p.id);
                        }}
                        className={btnSmall}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/client/router.tsx` — импорт и маршрут после `settings/tags`:

```tsx
import { SplitPresetsSettings } from './pages/settings/SplitPresetsSettings';
```

```tsx
          { path: 'settings/split-presets', element: <SplitPresetsSettings /> },
```

`src/client/pages/settings/SettingsNav.tsx` — в `SECTIONS` после «Теги»:

```ts
  { path: 'split-presets', label: 'Шаблоны разделения' },
```

- [ ] **Step 2: Check**

Run: `npm run typecheck`, `npm test`, `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client
git commit -m "feat: экран «Шаблоны разделения» — строки статья/проект/доля, индикатор распределения

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: E2E справочников

**Files:**
- Create: `e2e/dictionaries.spec.ts`

**Interfaces:**
- Consumes: экраны задач 9–13; `e2e/server.ts` (пользователь `admin` / `e2e-password-1`).

- [ ] **Step 1: Write the tests**

`e2e/dictionaries.spec.ts`:

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

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('счета: создание в USD, архив только при нулевом остатке, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await section(page, 'Счета').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));

  await page.getByRole('button', { name: 'Добавить счёт' }).click();
  await page.getByLabel('Название счёта').fill('Сейф');
  await page.getByLabel('Валюта').selectOption('USD');
  await page.getByLabel('Остаток на дату открытия').fill('1 500,505');
  await page.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(page.getByText('Введите сумму, например 1 500,50')).toBeVisible();
  await expect(page.getByLabel('Остаток на дату открытия')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Остаток на дату открытия').fill('1 500,50');
  await page.getByRole('button', { name: 'Создать счёт' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Сейф' });
  await expect(row).toContainText(/1\s500,50\s\$/);
  await row.getByRole('button', { name: 'В архив' }).click();
  await expect(page.getByRole('alert')).toHaveText('Счёт можно перевести в архив только при нулевом балансе');

  await row.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Остаток на дату открытия').fill('0');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await row.getByRole('button', { name: 'В архив' }).click();
  await expect(row).toContainText('В архиве');

  await row.getByRole('button', { name: 'Удалить' }).click();
  await row.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Сейф' })).toHaveCount(0);
});

test('статьи: вложение, «Перенести в…», переименование, перетаскивание; системные не переименовываются', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Статьи ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/categories`);
  const expense = page.getByRole('region', { name: 'Расходы' });
  const item = (name: string) => expense.getByRole('listitem', { name, exact: true });

  await expense.getByLabel('Новая статья расходов').fill('Реклама');
  await expense.getByRole('button', { name: 'Добавить' }).click();
  await expect(item('Реклама')).toBeVisible();
  await expense.getByLabel('Новая статья расходов').fill('Таргет');
  await expense.getByLabel('Родитель').selectOption({ label: 'Реклама' });
  await expense.getByRole('button', { name: 'Добавить' }).click();
  await expect(item('Реклама').getByRole('listitem', { name: 'Таргет', exact: true })).toBeVisible();

  // системная «Зарплата»: значок есть, переименовать нельзя
  await expect(item('Зарплата')).toContainText('системная');
  await expect(item('Зарплата').getByRole('button', { name: 'Переименовать' })).toHaveCount(0);

  // «Таргет» — на верхний уровень через «Перенести в…»
  await expense.getByLabel('Перенести «Таргет»').selectOption('top');
  await expect(item('Реклама').getByRole('listitem', { name: 'Таргет', exact: true })).toHaveCount(0);
  await expect(item('Таргет')).toBeVisible();

  await item('Таргет').getByRole('button', { name: 'Переименовать' }).click();
  await expense.getByLabel('Новое название статьи «Таргет»').fill('Таргетинг');
  await expense.getByRole('button', { name: 'Сохранить' }).click();
  await expect(item('Таргетинг')).toBeVisible();

  // перетаскивание: «Таргетинг» встаёт перед «Зарплатой»
  await item('Таргетинг').locator(':scope > div').dragTo(item('Зарплата').locator(':scope > div'));
  await expect
    .poll(async () => {
      const tree = (await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()) as { expense: { name: string }[] };
      const names = tree.expense.map((n) => n.name);
      return names.indexOf('Таргетинг') === names.indexOf('Зарплата') - 1;
    })
    .toBe(true);
});

test('контрагенты по вкладкам и поиск; тег с именем архивного предлагает вернуть его', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Контрагенты ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/counterparties`);

  await page.getByLabel('Тип', { exact: true }).selectOption('supplier');
  await page.getByLabel('Название контрагента').fill('ИП Иванов');
  await page.getByLabel('Комментарий').fill('аренда зала');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Тип', { exact: true }).selectOption('employee');
  await page.getByLabel('Название контрагента').fill('Пётр Админов');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('tab', { name: /Поставщики/ }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel).toContainText('ИП Иванов');
  await page.getByRole('tab', { name: /Все/ }).click();
  await page.getByLabel('Поиск').fill('петр'); // регистр и «ё» не важны
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel).toContainText('Пётр Админов');

  await section(page, 'Теги').click();
  await page.getByLabel('Новый тег').fill('Ёлка');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const tag = page.getByRole('listitem').filter({ hasText: 'Ёлка' });
  await tag.getByRole('button', { name: 'В архив' }).click();
  await expect(tag).toContainText('В архиве');

  await page.getByLabel('Новый тег').fill('елка');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const offer = page.getByRole('alert').filter({ hasText: 'есть в архиве' });
  await expect(offer).toContainText('Тег «Ёлка» есть в архиве');
  await offer.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(tag.getByRole('button', { name: 'В архив' })).toBeVisible();
});

test('шаблон разделения: сохранить можно только при 100%', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разделение ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/projects`);
  for (const name of ['Клуб 1', 'Клуб 2']) {
    await page.getByRole('button', { name: 'Добавить проект' }).click();
    await page.getByLabel('Название проекта').fill(name);
    await page.getByLabel('Тип бизнеса').selectOption('general');
    await page.getByRole('button', { name: 'Создать проект' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
  }

  await section(page, 'Шаблоны разделения').click();
  await page.getByRole('button', { name: 'Добавить шаблон' }).click();
  await page.getByLabel('Название шаблона').fill('Аренда пополам');
  await page.getByLabel('Проект, строка 1').selectOption({ label: 'Клуб 1' });
  await page.getByLabel('Доля %, строка 1').fill('50');
  await page.getByLabel('Проект, строка 2').selectOption({ label: 'Клуб 2' });
  await page.getByLabel('Доля %, строка 2').fill('40');
  await expect(page.getByRole('status').filter({ hasText: 'Распределено' })).toHaveText('Распределено 90% из 100% · осталось 10%');
  await expect(page.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled();
  await page.getByLabel('Доля %, строка 2').fill('50');
  await page.getByRole('button', { name: 'Сохранить шаблон' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Аренда пополам' });
  await expect(row).toContainText('Клуб 1 — 50%');
  await expect(row).toContainText('Клуб 2 — 50%');
});

test('переименование проекта переименовывает его счета; ↑/↓ меняют порядок счетов', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Переименование ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/projects`);
  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Клуб А');
  await page.getByLabel('Тип бизнеса').selectOption('computer-club');
  await page.getByLabel('Количество ПК').fill('1e3');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByText('Введите целое число')).toBeVisible();
  await page.getByLabel('Количество ПК').fill('10');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  await page.getByRole('listitem').filter({ hasText: 'Клуб А' }).getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Название проекта').fill('Клуб Б');
  await expect(page.getByLabel('Переименовать счета')).toBeChecked();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('status')).toHaveText('Переименовано счетов: 2');

  await section(page, 'Счета').click();
  const group = page.getByRole('region', { name: 'Клуб Б' });
  await expect(group.getByRole('listitem')).toHaveCount(2);
  await expect(group.getByRole('listitem').first()).toContainText('Касса Клуб Б');
  await group.getByRole('button', { name: 'Ниже: Касса Клуб Б' }).click();
  await expect(group.getByRole('listitem').first()).toContainText('Kaspi Клуб Б');
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: PASS — новые 5 тестов и 5 прежних.

- [ ] **Step 3: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add e2e/dictionaries.spec.ts
git commit -m "test: e2e справочников — счета, статьи с перетаскиванием, контрагенты, теги, шаблоны разделения

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие обязательных пунктов плана 2 и замечаний ревью

| Пункт | Где закрыт |
|---|---|
| `accounts.create` принимает архивный проект | Task 4 (`validate`, Review Focus 1) |
| `openedAt` — только формат | Task 1 (`isValidDate`), Task 4 |
| API записи статей: родитель той же компании и вида, глубина ≤ 2, перенесённая группа шаблона | Task 5 |
| Общий помощник «изменение + история в одной транзакции» | Task 2 (`mutate`), Tasks 4–8 |
| Экраны настроек: данные раньше ошибки, aria у полей, русские ошибки чисел | Task 9 (`Pending`, `StaleNotice`, `Field`, `parseIntInput`), Tasks 10–13 |
| Двойной префикс `APP_TIMEZONE` | Task 1 |
| 401 не трогает запрос `me` | Task 9 |
| Предложить переименовать «Касса/Kaspi …» | Task 8, Task 9, e2e Task 14 |
| Тесты: межкомпанейный `listTree`, RF3 шире, `/templates` без схем, базовая валюта счёта шаблона, внешние ключи | Task 5, Tasks 4–8, Task 8, Task 8, Task 3 |
| Порядок и удаление проектов | Task 8, Task 9 |
| `migrateWithBackup()` для `setup`, `user:add` и `startServer` | Task 2 |
| Очищенный параметр проекта молча сохранял старое значение | Task 9 (`ProjectForm` отправляет значения после схемы) |
| Пустой `PATCH` писал историю | Task 2 |
| Английские сообщения zod | Task 1 (`installZodRu`) |
| Нет верхней границы `pcCount` | Task 1 |
| Название из одних невидимых символов | Task 1 (`cleanName`, `nameField`) |
| Тесты CASCADE и unique (хвост плана 1) | Task 3 |

**Перенесено в план 3b:**
- пользователи и профиль, `POST /auth/password`, `user:passwd`;
- история действий: API с фильтрами, проверка `limit` в `audit.list`, экран;
- экран резервной копии (`fetch` → Blob);
- `user_preferences` API и последняя компания в `CompanyGate`;
- доступность переключателя компаний: стрелки, возврат фокуса, WCAG 2.5.3, выбор текущей компании не уводит из настроек;
- мигание `NewCompanyPage`;
- атомарная проверка уникальности логина.

**Не входит в этап 3a по спецификации:** `GET /companies/summary` и балансы (шаг 4).

**Для шага 4 (заметки ревью плана):**
- На экране «Счета» поле валюты остаётся редактируемым. Сервер вернёт `CURRENCY_LOCKED`, когда появятся операции. Шаг 4 должен блокировать поле заранее (§7: «валюта заблокирована, если есть операции»).
- `setup.ts` делает бэкап перед миграцией, но всё ещё не проверяет lock и порт (хвост плана 1, план шага 8).
