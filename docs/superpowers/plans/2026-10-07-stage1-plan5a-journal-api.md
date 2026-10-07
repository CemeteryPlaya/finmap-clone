# Этап 1, план 5a: журнал — сервер (список, фильтр, массовые действия, сохранённые фильтры, выгрузка) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** серверная половина шага 5 §11 спецификации («Журнал»):
- `GET /api/v1/companies/:cid/operations` — список с полным фильтром журнала §6, поиском `ulower` (§6.1), сортировкой, курсором и остатком после операции (§4.7);
- `POST …/operations/bulk` — массовые действия §7: `setCategory`, `setProject`, `setCounterparty`, `delete`, `restore`;
- сохранённые фильтры: таблица `saved_filters` (§4.4) и CRUD `…/saved-filters` (только свои), инвариант 10;
- `GET …/operations/export.xlsx` — выгрузка в Excel по тому же фильтру;
- `npm run bench:journal` — замер §12 на демо-наборе §10.

Экран журнала (таблица, тулбар, «Указать», массовые действия в интерфейсе) — план 5b.

**Предусловие:** выполнены планы 4a и 4b — операции, `createLedgerBalances`, вложения, `seedDemo` (`scripts/lib/demo.ts`), `tests/helpers/ops.ts` (`opsWorld`), `ApiHarness.cookie`.

**Architecture:**
- **Фильтр** описан одной zod-схемой в `src/shared/schemas/journal.ts`: её поля общие у строки запроса списка, выгрузки и JSON сохранённого фильтра. Fastify 5 отдаёт повторённый ключ строки запроса массивом, а одиночный — строкой (проверено: `types=income` → `"income"`), поэтому списки проходят через `preprocess`, который оборачивает строку в массив.
- **Список** — два шага: сырой SQL (`drizzle-orm` `sql`) отбирает id страницы по условию `journalWhere` и порядку `(ключ, id)` с курсором по row value `(paid_at, id) < (?, ?)`; затем строки, теги, число вложений и остатки грузятся пачкой по id. Период переводится в границы UTC функцией `startOfDayUtc` (смещение пояса берётся на дату — в Алматы до 01.03.2024 было UTC+6).
- **Остаток после операции** — окно `SUM(delta) OVER (PARTITION BY account_id ORDER BY paid_at, op_id)` по «ногам» операций (у перевода две ноги) в `LedgerBalances.balancesAfter`, по полной истории счетов страницы, без фильтров журнала.
- **Массовые действия** (`src/server/modules/operations/bulk.ts`) вызывают методы `OperationsService` (`update`, `remove`, `restore`) — те же инварианты и та же история. Весь запрос — одна транзакция; запись каждой операции внутри — точка сохранения better-sqlite3: отказ `AppError` откатывает только эту операцию и становится причиной пропуска, любой другой сбой откатывает весь запрос.
- **Выгрузка** — минимальная книга XLSX, собранная `adm-zip` (`src/server/http/xlsx.ts`): inline-строки, числа точной десятичной записью с форматом, даты Excel по часам APP_TIMEZONE.

**Tech Stack:** как в планах 1–4b. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.4 (`saved_filters`), §4.6 (инварианты 3, 5, 7, 10, 11), §4.7 («Остаток после операции»), §6 (Операции, «Фильтр журнала», Сохранённые фильтры, решения 2026-10-07), §6.1, §6.2, §7 «Журнал» (колонки, массовые действия, экспорт), §10, §11 шаг 5, §12.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§6, блок «Решения планирования от 2026-10-07», и строка 422 в §6.2) тем же коммитом, что и план.

1. **Списки в строке запроса — повтором ключа** (`types=income&types=transfer`), одиночное значение тоже принимается. Суммы `amountMin`/`amountMax` — целые минимальные единицы базовой валюты.
2. **«Без статьи / проекта / контрагента» объединяются с выбранными элементами того же измерения через ИЛИ** («Аренда» или без статьи — так выглядит пункт «Без статьи» в выпадающем списке статей), разные измерения — через И.
3. **Удалённые операции журнал не показывает.** Отмена массового удаления восстанавливает по id из ответа `bulk delete`, отдельный список удалённых не нужен.
4. **Курсор непрозрачный** (base64url от JSON `{s, o, v, id}`); курсор другой сортировки или испорченный — 400 `VALIDATION` с полем `cursor`.
5. **Массовые действия:** не больше 500 id (запрос синхронный и держит цикл событий; замер — в `bench:journal`); «Категория», «Проект», «Контрагент» только назначают значение; операция, у которой значение уже такое, попадает в `changed`, но версия и история не меняются; удаление уже удалённой («Операция уже удалена») и восстановление неудалённой («Операция не удалена») — пропуск, поэтому «Отменить» по `changed` не вернёт чужое удаление; операция другой компании — пропуск «Операция не найдена»; выбранный элемент в архиве (`ARCHIVED_REFERENCE`) или из другой компании (`INVARIANT_5`) и архивная компания отклоняют весь запрос.
6. **Сохранённые фильтры личные и историю не пишут** (как `user_preferences`). Хранится JSON фильтра как есть; при выдаче сервер убирает ссылки на удалённые, архивные и чужие элементы и сообщает их число в `unavailable` — план 5b показывает по нему предупреждение (инвариант 10). Период хранится датами; относительные периоды («текущий месяц») — дело клиента.
7. **Выгрузка:** одна строка на операцию; столбцы — колонки журнала §7 плюс тип, валюта, теги и дата сделки; разбиение — статьи и проекты через «; »; предел 50 000 операций (книга собирается в памяти), сверх него — 422 `EXPORT_LIMIT`. Формул в книге нет: все строки — inline-текст, а текст, начинающийся с `=`, `+`, `-`, `@`, табуляции или CR, получает стиль `quotePrefix="1"`, чтобы Excel не превратил его в формулу при правке ячейки. В `workbook.xml` есть `<bookViews><workbookView/></bookViews>` — без него часть версий Excel считает файл повреждённым.
8. **Новые индексы не нужны.** Замер на демо-наборе §10 при планировании (компания с 6940 операциями, p95 на сервере через `app.inject`): первая страница 32 мс, фильтр по статье 40 мс, фильтр по сумме 36 мс, поиск 68 мс, поиск без совпадений 47 мс, выгрузка всей компании 454 мс, балансы 30 мс, сводка 24 мс. Массовые действия на 500 операций (p50): «Контрагент» 2,2 с, удаление 1,4 с, восстановление 1,9 с — сервер на это время занят, поэтому предел 500, а не 1000. Существующий индекс `operations_company_paid_idx (company_id, paid_at, id)` покрывает первую страницу и курсор; остальное — полный перебор компании, который укладывается в бюджет (§6.1). Это закрывает замечание 6 итогов 4a и замечание 11 итогов 4b.
9. **«Указать» (§7) новых маршрутов не требует:** клиент плана 5b шлёт существующий `PATCH /operations/:id` с `version` и одним полем (`counterpartyId` или `lines` из одной строки) и на конфликт получает 409.
10. **Запросы журнала — сырой SQL через `sql` из drizzle-orm** (`db.all`): фильтр с подзапросами `EXISTS`, row value для курсора и оконная функция в построителе запросов выражаются хуже. Все значения уходят параметрами; `sql.raw` — только для фиксированных фрагментов (имена таблиц и столбцов, направление сортировки из перечисления).

## Global Constraints

- **Фильтр журнала (§6):** период `from`/`to` по календарной дате `paidAt` в `APP_TIMEZONE`; `q` — поиск по комментарию, имени контрагента, названию счёта, названиям категорий и проектов строк, регистронезависимый, в том числе для кириллицы; `amountMin`/`amountMax` — в базовой валюте компании, по `baseAmount`; `types[]`, `accountIds[]` (по исходному или целевому счёту), `counterpartyIds[]`, `tagIds[]`; `categoryIds[]`, `projectIds[]` — операция подходит, если хотя бы одна строка совпала, выбор родительской категории включает её дочерние; `withoutCategory` — доход или расход, у которого хотя бы у одной строки нет категории (переводы не учитываются); `withoutProject` — операция, у которой хотя бы у одной строки нет проекта, либо перевод без строк; `withoutCounterparty` — доход или расход без контрагента; сортировка `date` (по `paidAt`, затем по `id`) или `amount` (по `baseAmount`), `asc` или `desc`; курсор и `limit` (по умолчанию 50, максимум 200).
- **Поиск (§6.1):** `ulower(поле) LIKE '%' || ? || '%' ESCAPE '\'`, параметр — уже приведённый к нижнему регистру запрос, в котором экранированы `\`, `%` и `_`.
- **Остаток после операции (§4.7):** оконной функцией по полной истории счёта (без учёта фильтров журнала), в порядке `(paidAt, id)`; для строки перевода — остатки обоих счетов. Баланс — по операциям со `status = actual` и `deletedAt IS NULL`.
- **Массовые действия (§7):** «Категория» меняет единственную строку операций с одной строкой; пропускаются разбитые операции, переводы и операции другого вида, чем выбранная категория. «Проект» меняет единственную строку; переводу без строк создаёт строку; пропускаются разбитые. «Контрагент» — всем выделенным доходам и расходам. «Удалить» пропускает операции, затрагивающие архивный счёт. Итог — «изменено N, пропущено M» с причинами. Версию не проверяют, но увеличивают у изменённых операций и пишут историю.
- **Инвариант 10:** ссылки в JSON `saved_filters` не защищены внешними ключами; недоступные элементы (удалённые или архивные) при применении отбрасываются, пользователь видит предупреждение.
- **Сохранённые фильтры (§6):** `GET/POST /companies/:cid/saved-filters`, `PATCH/DELETE …/:id` — только свои; чужой — 404.
- **Бюджет (§12):** на демо-наборе §10 первая страница журнала, применение фильтра и поиск отвечают на сервере быстрее 300 мс (p95).
- **Ошибки (§6.2):** `{ error: { code, message, fields? } }`; 400 `VALIDATION` с `fields`; 404 — объект не найден или другой компании; 422 `INVARIANT_*`, `ARCHIVED_REFERENCE`, `EXPORT_LIMIT`. Тексты на русском.
- **Деньги и время (§4.1):** суммы — целые минимальные единицы; `paidAt` — UTC ISO фиксированной ширины; календарные даты `YYYY-MM-DD` в `APP_TIMEZONE` (по умолчанию `Asia/Almaty`).
- **Без новых npm-пакетов.** XLSX собирается `adm-zip` (уже в зависимостях).
- **`npm test` остаётся быстрым:** замер на 10 000 операций — только в `npm run bench:journal`; в тестах — не больше нескольких сотен операций.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» делайте инструментом правки файлов, а не скриптом с точным поиском многострочного текста — тот не найдёт `\n` в файле с `\r\n`.
- **Обратная косая в SQL:** в шаблонной строке `sql\`…\`` пишется `ESCAPE '\\'` (две косые в файле — одна в SQL). Файлы с такими строками создавайте инструментом записи файлов, а не через heredoc оболочки: Git Bash схлопывает `\\` в heredoc.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`; коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Невидимые символы в коде — только через `\uXXXX`.

## Review Focus

1. **Операция около полуночи и старые даты:** операция в 00:30 по Алматы попадает в фильтр своего дня, а не предыдущего; за январь 2024 года (тогда UTC+6) граница суток сдвинута на час. Тесты — задача 1 (`startOfDayUtc`) и задача 2 (период по API).
2. **Поиск с `%`, `_` и «ё»:** «100%» находит только комментарий с «100%», а не все с «100»; «за_» — только с подчёркиванием; «ЕЛКА» находит «Ёлка». Тест — задача 2.
3. **Бесконечная прокрутка при сортировке по сумме с одинаковыми суммами:** страницы без пропусков и повторов; курсор от другой сортировки — понятная 400, а не мусор. Тест — задача 2.
4. **Сбой посередине массового действия:** непредвиденная ошибка на второй операции откатывает и первую, и её историю — нет «наполовину применённого» действия. Тест — задача 4.
5. **Выгрузка с «плохим» комментарием и точными суммами:** `<`, `&`, кавычки, управляющий символ и эмодзи в комментарии не ломают XML; комментарий «=HYPERLINK(…)» остаётся текстом (стиль `quotePrefix`, в книге нет `<f>`); суммы — точной записью («1500.50», а не «1500.4999…»). Тесты — задача 6.

---

## Карта файлов

```
src/shared/
  dates.ts                              # + zoneOffsetMs, startOfDayUtc
  schemas/journal.ts                    # (новый) схема фильтра, строки запроса и выгрузки
  schemas/operations.ts                 # + operationBulkSchema, BulkResult
  schemas/saved-filters.ts              # (новый)
src/server/
  http/content-disposition.ts           # (новый) вынесено из вложений
  http/xlsx.ts                          # (новый) минимальная книга XLSX
  db/schema.ts                          # + saved_filters
  db/migrations/0005_*.sql              # генерируется
  modules/balances/service.ts           # + balancesAfter; устаревший комментарий
  modules/references/service.ts         # устаревший комментарий
  modules/operations/journal.ts         # (новый) список, фильтр, курсор, выгрузка
  modules/operations/journal-export.ts  # (новый) лист «Операции»
  modules/operations/bulk.ts            # (новый) массовые действия
  modules/operations/routes.ts          # GET список, GET export.xlsx, POST bulk
  modules/saved-filters/{service,routes}.ts   # (новые)
  modules/attachments/routes.ts         # contentDisposition из http/
  app.ts
scripts/bench-journal.ts, package.json  # bench:journal
tests/shared/{dates,journal-schema}.test.ts
tests/server/{journal-list,journal-balances,operations-bulk,saved-filters,journal-export,journal-demo}.test.ts
README.md
```

---

### Task 1: Схема фильтра журнала и начало суток в APP_TIMEZONE

**Files:**
- Create: `src/shared/schemas/journal.ts`, `tests/shared/journal-schema.test.ts`
- Modify: `src/shared/dates.ts`, `tests/shared/dates.test.ts`

**Interfaces:**
- Consumes: `isValidDate` (`src/shared/dates.ts`).
- Produces:
  - `zoneOffsetMs(t: number, timeZone: string): number` — смещение пояса в момент `t`, мс (местное − UTC);
  - `startOfDayUtc(date: string, timeZone: string): string` — начало календарного дня в поясе как UTC ISO (`2026-10-05`, Алматы → `2026-10-04T19:00:00.000Z`);
  - `journalFilterSchema`, `journalQuerySchema`, `journalExportSchema`; типы `JournalFilter`, `JournalQuery`, `JournalExportQuery`, `JournalSort` (`'date' | 'amount'`), `JournalOrder` (`'asc' | 'desc'`); константы `JOURNAL_LIMIT_DEFAULT = 50`, `JOURNAL_LIMIT_MAX = 200`, `JOURNAL_LIST_MAX = 200`.
  - Поля `JournalFilter` (все необязательные): `from`, `to` (`YYYY-MM-DD`), `q` (обрезанная непустая строка), `amountMin`, `amountMax` (целые ≥ 0), `types` (`('income'|'expense'|'transfer')[]`), `accountIds`, `counterpartyIds`, `tagIds`, `categoryIds`, `projectIds` (`number[]`, без повторов, по возрастанию, непустые), `withoutCategory`, `withoutProject`, `withoutCounterparty` (`true | undefined`). `JournalQuery` — те же поля плюс `sort`, `order` (по умолчанию `date`, `desc`), `cursor?: string`, `limit: number`. `JournalExportQuery` — фильтр плюс `sort`, `order`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/dates.test.ts` — в импорт добавьте новые функции:

```ts
import { addDays, formatDateRu, formatDateTime, isValidDate, startOfDayUtc, todayInTimezone, zoneOffsetMs } from '../../src/shared/dates';
```

и в конец файла:

```ts
describe('startOfDayUtc', () => {
  it('начало суток в Алматы — момент UTC; смещение берётся на эту дату (UTC+6 до 01.03.2024) (Review Focus 1)', () => {
    expect(startOfDayUtc('2026-10-05', 'Asia/Almaty')).toBe('2026-10-04T19:00:00.000Z');
    expect(startOfDayUtc('2024-01-15', 'Asia/Almaty')).toBe('2024-01-14T18:00:00.000Z');
    // 29.02.2024 длился 25 часов: в полночь 1 марта часы перевели на 23:00
    expect(startOfDayUtc('2024-02-29', 'Asia/Almaty')).toBe('2024-02-28T18:00:00.000Z');
    expect(startOfDayUtc('2024-03-01', 'Asia/Almaty')).toBe('2024-02-29T19:00:00.000Z');
  });

  it('пояса с переходом на летнее время и UTC', () => {
    expect(startOfDayUtc('2026-03-29', 'Europe/Berlin')).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfDayUtc('2026-10-25', 'Europe/Berlin')).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDayUtc('2026-10-05', 'UTC')).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('zoneOffsetMs', () => {
  it('смещение в момент времени, миллисекунды не мешают', () => {
    expect(zoneOffsetMs(Date.parse('2026-10-05T05:00:00.500Z'), 'Asia/Almaty')).toBe(5 * 3600_000);
    expect(zoneOffsetMs(Date.parse('2024-01-15T05:00:00.000Z'), 'Asia/Almaty')).toBe(6 * 3600_000);
  });
});
```

`tests/shared/journal-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { journalExportSchema, journalFilterSchema, journalQuerySchema, type JournalFilter } from '../../src/shared/schemas/journal';

const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('journalQuerySchema (§6 «Фильтр журнала»)', () => {
  it('без параметров — сортировка по дате, новые сверху, страница 50', () => {
    expect(journalQuerySchema.parse({})).toEqual({ sort: 'date', order: 'desc', limit: 50 });
  });

  it('список: одиночное значение строкой (как его отдаёт Fastify) и повтор ключа — массивом; повторы и пустые убираются', () => {
    expect(journalQuerySchema.parse({ types: 'income' }).types).toEqual(['income']);
    const q = journalQuerySchema.parse({ types: ['transfer', 'income', 'transfer'], accountIds: ['3', '1', '', '3'] });
    expect(q.types).toEqual(['income', 'transfer']);
    expect(q.accountIds).toEqual([1, 3]);
    expect(journalQuerySchema.parse({ tagIds: '' }).tagIds).toBeUndefined();
  });

  it('флаги: true, "true", "1" — включены; "false", "0", пусто — не заданы; прочее — ошибка', () => {
    const q = journalQuerySchema.parse({ withoutCategory: '1', withoutProject: 'true', withoutCounterparty: 'false' });
    expect(q).toMatchObject({ withoutCategory: true, withoutProject: true });
    expect(q.withoutCounterparty).toBeUndefined();
    expect(issues(journalQuerySchema.safeParse({ withoutCategory: 'yes' }))).toEqual({ withoutCategory: 'Ожидается true или false' });
  });

  it('пустые строки — как отсутствие параметра; поиск обрезается, пустой поиск не задан', () => {
    expect(journalQuerySchema.parse({ amountMin: '', q: '   ', limit: '', from: '' })).toEqual({ sort: 'date', order: 'desc', limit: 50 });
    expect(journalQuerySchema.parse({ q: '  Аренда ' }).q).toBe('Аренда');
  });

  it('ошибки с полем: дата, конец раньше начала, «до» меньше «от», limit, тип, идентификатор, повтор скалярного ключа', () => {
    expect(issues(journalQuerySchema.safeParse({ from: '2026-02-31' }))).toEqual({ from: 'Неверная дата' });
    expect(issues(journalQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-01' }))).toEqual({ to: 'Конец периода раньше начала' });
    expect(issues(journalQuerySchema.safeParse({ amountMin: '100', amountMax: '50' }))).toEqual({ amountMax: '«До» меньше, чем «от»' });
    expect(issues(journalQuerySchema.safeParse({ limit: '500' }))).toEqual({ limit: 'От 1 до 200' });
    expect(issues(journalQuerySchema.safeParse({ types: 'bogus' }))).toEqual({ 'types.0': 'Неверный тип операции' });
    expect(issues(journalQuerySchema.safeParse({ accountIds: 'abc' }))).toEqual({ 'accountIds.0': 'Неверный идентификатор' });
    expect(journalQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(false);
    expect(journalQuerySchema.safeParse({ amountMin: '10.5' }).success).toBe(false);
  });

  it('сортировка и размер страницы', () => {
    expect(journalQuerySchema.parse({ sort: 'amount', order: 'asc', limit: '10' })).toMatchObject({ sort: 'amount', order: 'asc', limit: 10 });
    expect(journalQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});

describe('journalFilterSchema и journalExportSchema', () => {
  it('сохранённый фильтр: JSON с числами, лишние поля (сортировка, курсор, мусор) отбрасываются', () => {
    const f: JournalFilter = journalFilterSchema.parse({ accountIds: [2, 1], withoutCategory: true, q: ' Бар ', sort: 'amount', cursor: 'x', junk: 1 });
    expect(f).toEqual({ accountIds: [1, 2], withoutCategory: true, q: 'Бар' });
    expect(JSON.parse(JSON.stringify(journalFilterSchema.parse({ withoutProject: false })))).toEqual({});
  });

  it('выгрузка: фильтр и сортировка без курсора и страницы', () => {
    expect(journalExportSchema.parse({ types: 'expense', limit: '10', cursor: 'x' })).toEqual({ types: ['expense'], sort: 'date', order: 'desc' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/dates.test.ts tests/shared/journal-schema.test.ts`
Expected: FAIL — нет `startOfDayUtc`, `zoneOffsetMs` и модуля `schemas/journal`.

- [ ] **Step 3: Implement**

`src/shared/dates.ts` — в конец файла:

```ts
/** Форматтеры по поясу: создание Intl.DateTimeFormat дорогое, а выгрузка зовёт zoneOffsetMs на каждую строку. */
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Смещение пояса timeZone относительно UTC в момент t (мс; местное время минус UTC). */
export function zoneOffsetMs(t: number, timeZone: string): number {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const whole = Math.floor(t / 1000) * 1000; // Intl отбрасывает миллисекунды
  const parts = fmt.formatToParts(new Date(whole));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - whole;
}

/**
 * Начало календарного дня `YYYY-MM-DD` в поясе timeZone — момент UTC в формате `paidAt` (§4.1).
 * Смещение берётся на эту дату: в Алматы до 01.03.2024 было UTC+6, после — UTC+5.
 */
export function startOfDayUtc(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // второй шаг уточняет смещение, если на границе суток оно другое, чем в полночь по UTC
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone)).toISOString();
}
```

`src/shared/schemas/journal.ts`:

```ts
import { z } from 'zod';
import { isValidDate } from '../dates';

export const JOURNAL_LIMIT_DEFAULT = 50;
export const JOURNAL_LIMIT_MAX = 200;
/** Не больше значений в одном списке фильтра (счета, статьи…). */
export const JOURNAL_LIST_MAX = 200;

/** Пустая строка в запросе (`amountMin=`) — то же, что отсутствие параметра. */
const blank = (v: unknown) => (v === '' ? undefined : v);

/**
 * Список значений. Fastify 5 отдаёт повторённый ключ строки запроса массивом (`types=income&types=transfer`),
 * а одиночный — строкой (`types=income`); в JSON сохранённого фильтра — массив. Пустые значения отбрасываются,
 * повторы убираются, порядок — по возрастанию; пустой список — то же, что его отсутствие.
 */
function list<T extends string | number>(item: z.ZodType<T>) {
  return z.preprocess(
    (v) => {
      if (v === undefined) return undefined;
      const xs = (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
      return xs.length ? xs : undefined;
    },
    z
      .array(item)
      .max(JOURNAL_LIST_MAX, `Не больше ${JOURNAL_LIST_MAX} значений`)
      .transform((xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      .optional(),
  );
}

const id = z.coerce.number({ message: 'Неверный идентификатор' }).int('Неверный идентификатор').positive('Неверный идентификатор');
/** Флаг: true, 'true' или '1' — включён; false, 'false', '0' или пусто — не задан. */
const flag = z.preprocess(
  (v) => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' || v === '' ? undefined : v),
  z.literal(true, { message: 'Ожидается true или false' }).optional(),
);
const date = z.preprocess(blank, z.string().refine(isValidDate, 'Неверная дата').optional());
/** Сумма в минимальных единицах базовой валюты компании (сравнивается с baseAmount). */
const amount = z.preprocess(
  blank,
  z.coerce
    .number({ message: 'Неверная сумма' })
    .int('Сумма — целое число минимальных единиц')
    .min(0, 'Сумма не меньше нуля')
    .max(Number.MAX_SAFE_INTEGER, 'Слишком большая сумма')
    .optional(),
);

/** Поля фильтра журнала (§6 «Фильтр журнала»); общие у списка, выгрузки и сохранённого фильтра. */
const filterShape = {
  from: date,
  to: date,
  q: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(200, 'Не длиннее 200 символов')
      .transform((v) => v || undefined)
      .optional(),
  ),
  amountMin: amount,
  amountMax: amount,
  types: list(z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' })),
  accountIds: list(id),
  counterpartyIds: list(id),
  tagIds: list(id),
  categoryIds: list(id),
  projectIds: list(id),
  withoutCategory: flag,
  withoutProject: flag,
  withoutCounterparty: flag,
};

const sortShape = {
  sort: z.preprocess(blank, z.enum(['date', 'amount'], { message: 'Сортировка — date или amount' }).default('date')),
  order: z.preprocess(blank, z.enum(['asc', 'desc'], { message: 'Порядок — asc или desc' }).default('desc')),
};

function checkRanges(f: { from?: string; to?: string; amountMin?: number; amountMax?: number }, ctx: z.RefinementCtx): void {
  if (f.from && f.to && f.from > f.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода раньше начала' });
  if (f.amountMin !== undefined && f.amountMax !== undefined && f.amountMin > f.amountMax) {
    ctx.addIssue({ code: 'custom', path: ['amountMax'], message: '«До» меньше, чем «от»' });
  }
}

/** Фильтр журнала — и для сохранённых фильтров (их JSON проверяется этой же схемой). Лишние поля отбрасываются. */
export const journalFilterSchema = z.object(filterShape).superRefine(checkRanges);

/** Строка запроса списка `GET /companies/:cid/operations`: фильтр, сортировка, курсор и размер страницы. */
export const journalQuerySchema = z
  .object({
    ...filterShape,
    ...sortShape,
    cursor: z.preprocess(blank, z.string().max(500, 'Неверный курсор').optional()),
    limit: z.preprocess(
      blank,
      z.coerce
        .number({ message: 'От 1 до 200' })
        .int('От 1 до 200')
        .min(1, 'От 1 до 200')
        .max(JOURNAL_LIMIT_MAX, 'От 1 до 200')
        .default(JOURNAL_LIMIT_DEFAULT),
    ),
  })
  .superRefine(checkRanges);

/** Строка запроса выгрузки `GET …/operations/export.xlsx`: фильтр и сортировка, без страниц. */
export const journalExportSchema = z.object({ ...filterShape, ...sortShape }).superRefine(checkRanges);

export type JournalFilter = z.output<typeof journalFilterSchema>;
export type JournalQuery = z.output<typeof journalQuerySchema>;
export type JournalExportQuery = z.output<typeof journalExportSchema>;
export type JournalSort = JournalQuery['sort'];
export type JournalOrder = JournalQuery['order'];
```

Примечание: `.extend()` у zod 4 нельзя вызвать на схеме с `superRefine`, поэтому три схемы собраны из общих объектов полей `filterShape` и `sortShape`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/dates.test.ts tests/shared/journal-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/dates.ts src/shared/schemas/journal.ts tests/shared/dates.test.ts tests/shared/journal-schema.test.ts
git commit -m "feat: схема фильтра журнала и начало суток в APP_TIMEZONE

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Список журнала — фильтр, поиск, сортировка, курсор

**Files:**
- Create: `src/server/modules/operations/journal.ts`, `tests/server/journal-list.test.ts`
- Modify: `src/server/modules/operations/routes.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `journalQuerySchema`, `JournalFilter`, `JournalQuery`, `JournalSort`, `JournalOrder` (задача 1); `startOfDayUtc`, `addDays` (`src/shared/dates.ts`); `foldCase` (`src/shared/search.ts`); `requireCompany` (`companies/guard.ts`); типы `OperationDto`, `OperationLineDto` (`operations/service.ts`); SQL-функция `ulower` (регистрируется в `openDb`).
- Produces:
  - `likePattern(q: string): string` — шаблон LIKE по §6.1;
  - `journalWhere(companyId: number, f: JournalFilter, timezone: string): SQL` — условие над `operations o` (без удалённых);
  - `journalOrder(sort: JournalSort, order: JournalOrder): SQL` — `o.paid_at DESC, o.id DESC` и т. п.;
  - `interface JournalItem extends OperationDto { attachmentCount: number }`, `interface JournalPage { items: JournalItem[]; nextCursor: string | null }`;
  - `interface JournalService { list(companyId: number, query: JournalQuery): JournalPage }`;
  - `createJournal(d: { db: Db; timezone: string }): JournalService` (задачи 3 и 6 расширяют зависимости);
  - `GET /api/v1/companies/:cid/operations?…` → 200 `{ items, nextCursor }`; ошибки параметров — 400 `VALIDATION` с `fields`; нет компании — 404;
  - `registerOperationsRoutes(app, { operations, journal })`.

- [ ] **Step 1: Write the failing test**

`tests/server/journal-list.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN_HEADERS } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Item {
  id: number;
  type: string;
  paidAt: string;
  amount: number;
  baseAmount: number;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
  attachmentCount: number;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const get = (qs = '') => w.h.req('GET', qs ? `${w.ops}?${qs}` : w.ops);
const page = async (qs = ''): Promise<Page> => {
  const res = await get(qs);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
};
const ids = async (qs = '') => (await page(qs)).items.map((i) => i.id);
/** Операция через API; по умолчанию — расход 10 ₸ со счёта KZT. */
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const transfer = (paidAt: string, extra: Record<string, unknown> = {}) =>
  op({ type: 'transfer', paidAt, accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, ...extra });
const q = (text: string) => `q=${encodeURIComponent(text)}`;
const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const upload = (opId: number) =>
  w.h.t.app.inject({
    method: 'POST',
    url: `${w.ops}/${opId}/attachments`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'check.png' },
    payload: PNG,
  });

describe('журнал: GET /companies/:cid/operations', () => {
  it('по умолчанию новые сверху, при равной дате — больший id выше; удалённые скрыты; строки, теги и число вложений', async () => {
    w = await opsWorld();
    const a = await op({ paidAt: '2026-10-02T10:00:00Z', tagIds: [w.tag], lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z' });
    const c = await op({ paidAt: '2026-10-03T10:00:00Z' });
    const d = await op({ paidAt: '2026-10-04T10:00:00Z' });
    await w.h.req('DELETE', `${w.ops}/${d}`);
    expect((await upload(a)).statusCode).toBe(201);
    const second = (await upload(a)).json().attachment.id as number;
    await w.h.req('DELETE', `/api/v1/companies/${w.cid}/attachments/${second}`);

    const p = await page();
    expect(p.items.map((i) => i.id)).toEqual([c, b, a]);
    expect(p.nextCursor).toBeNull();
    expect(p.items[2]).toMatchObject({
      id: a,
      type: 'expense',
      amount: 1000,
      tagIds: [w.tag],
      attachmentCount: 1,
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }],
    });
    expect(p.items[0]!.attachmentCount).toBe(0);
  });

  it('период — по календарной дате оплаты в APP_TIMEZONE: 23:30 и 00:30 по Алматы попадают в разные дни (Review Focus 1)', async () => {
    w = await opsWorld();
    const late = await op({ paidAt: '2026-10-04T18:30:00Z' }); // 23:30 4 октября по Алматы
    const early = await op({ paidAt: '2026-10-04T19:30:00Z' }); // 00:30 5 октября по Алматы
    expect(await ids('from=2026-10-05&to=2026-10-05')).toEqual([early]);
    expect(await ids('to=2026-10-04')).toEqual([late]);
    expect(await ids('from=2026-10-04')).toEqual([early, late]);
  });

  it('поиск без учёта регистра и «ё»: комментарий, контрагент, счёт списания и зачисления, статья и проект строки; % и _ — буквально (Review Focus 2)', async () => {
    w = await opsWorld();
    const byComment = await op({ paidAt: '2026-10-02T10:00:00Z', comment: 'Ёлка в зале' });
    const byCounterparty = await op({ type: 'income', paidAt: '2026-10-02T11:00:00Z', counterpartyId: w.counterparty });
    const byAccount = await op({ paidAt: '2026-10-02T12:00:00Z', accountId: w.usd, amount: 100 });
    const byTarget = await transfer('2026-10-02T13:00:00Z');
    const bySplit = await op({
      paidAt: '2026-10-02T14:00:00Z',
      lines: [
        { projectId: w.project, amount: 500 },
        { categoryId: w.expense, projectId: w.project2, amount: 500 },
      ],
    });
    const percent = await op({ paidAt: '2026-10-02T15:00:00Z', comment: 'Предоплата 100% за_октябрь' });
    await op({ paidAt: '2026-10-02T16:00:00Z', comment: 'Предоплата 1000 заXоктябрь' });

    expect(await ids(q('ЕЛКА'))).toEqual([byComment]);
    expect(await ids(q('клиент'))).toEqual([byCounterparty]);
    expect(await ids(q('ВАЛЮТН'))).toEqual([byTarget, byAccount]);
    expect(await ids(q('аренд'))).toEqual([bySplit]);
    expect(await ids(q('клуб 2'))).toEqual([bySplit]);
    expect(await ids(q('100%'))).toEqual([percent]);
    expect(await ids(q('за_'))).toEqual([percent]);
    expect(await ids(q('нет такого'))).toEqual([]);
  });

  it('сумма от/до — в базовой валюте по baseAmount; тип — строкой или повтором ключа; счёт — списания или зачисления; контрагент; тег', async () => {
    w = await opsWorld();
    const usd = await op({ paidAt: '2026-10-02T10:00:00Z', accountId: w.usd, amount: 100 }); // $1,00 = 475,12 ₸
    const small = await op({ paidAt: '2026-10-02T11:00:00Z', amount: 1000 }); // 10 ₸
    const income = await op({ type: 'income', paidAt: '2026-10-02T12:00:00Z', counterpartyId: w.counterparty, tagIds: [w.tag] });
    const tr = await transfer('2026-10-02T13:00:00Z');

    expect(await ids('amountMin=40000&amountMax=47512')).toEqual([tr, usd]);
    expect(await ids('amountMax=40000')).toEqual([income, small]);
    expect(await ids('types=income')).toEqual([income]);
    expect(await ids('types=income&types=transfer')).toEqual([tr, income]);
    expect(await ids(`accountIds=${w.usd}`)).toEqual([tr, usd]);
    expect(await ids(`counterpartyIds=${w.counterparty}`)).toEqual([income]);
    expect(await ids(`tagIds=${w.tag}`)).toEqual([income]);
    expect(await ids(`types=expense&accountIds=${w.kzt}`)).toEqual([small]);
  });

  it('статьи: родительская включает дочерние, подходит любая строка разбиения; проекты — любая строка', async () => {
    w = await opsWorld();
    const base = `/api/v1/companies/${w.cid}/categories`;
    const parent = (await w.post(base, { kind: 'expense', name: 'Помещение' })).category.id as number;
    const child = (await w.post(base, { kind: 'expense', name: 'Коммуналка', parentId: parent })).category.id as number;
    const a = await op({ paidAt: '2026-10-02T10:00:00Z', lines: [{ categoryId: child, amount: 1000 }] });
    const b = await op({
      paidAt: '2026-10-02T11:00:00Z',
      lines: [
        { projectId: w.project, amount: 400 },
        { categoryId: w.expense, projectId: w.project2, amount: 600 },
      ],
    });
    expect(await ids(`categoryIds=${parent}`)).toEqual([a]);
    expect(await ids(`categoryIds=${child}`)).toEqual([a]);
    expect(await ids(`categoryIds=${w.expense}`)).toEqual([b]);
    expect(await ids(`categoryIds=${parent}&categoryIds=${w.expense}`)).toEqual([b, a]);
    expect(await ids(`projectIds=${w.project2}`)).toEqual([b]);
  });

  it('«без статьи», «без проекта», «без контрагента» — по §6; с выбранными элементами того же измерения — через ИЛИ, между измерениями — И', async () => {
    w = await opsWorld();
    const bare = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z' }); // одна строка без статьи и проекта, без контрагента
    const full = await op({ paidAt: '2026-10-02T11:00:00Z', counterpartyId: w.counterparty, lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    const half = await op({
      paidAt: '2026-10-02T12:00:00Z',
      counterpartyId: w.counterparty,
      lines: [
        { categoryId: w.expense, projectId: w.project, amount: 500 },
        { projectId: w.project2, amount: 500 },
      ],
    });
    const trBare = await transfer('2026-10-02T13:00:00Z');
    await transfer('2026-10-02T14:00:00Z', { lines: [{ projectId: w.project, amount: 47512 }] });

    expect(await ids('withoutCategory=true')).toEqual([half, bare]);
    expect(await ids('withoutProject=1')).toEqual([trBare, bare]);
    expect(await ids('withoutCounterparty=true')).toEqual([bare]);
    expect(await ids(`categoryIds=${w.expense}&withoutCategory=true`)).toEqual([half, full, bare]);
    expect(await ids('withoutCategory=true&withoutProject=true')).toEqual([bare]);
    expect(await ids('withoutCategory=false')).toHaveLength(5);
  });

  it('сортировка по сумме и курсор: страницы без пропусков и повторов при равных суммах; курсор другой сортировки или испорченный — 400 (Review Focus 3)', async () => {
    w = await opsWorld();
    const amounts = [3000, 1000, 3000, 2000, 3000, 1000, 5000];
    const made: { id: number; amount: number }[] = [];
    for (const [i, amount] of amounts.entries()) made.push({ id: await op({ paidAt: `2026-10-0${2 + (i % 3)}T1${i}:00:00Z`, amount }), amount });

    const walk = async (qs: string) => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const p: Page = await page(`${qs}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...p.items.map((i) => i.id));
        cursor = p.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      return { seen, pages };
    };
    const desc = [...made].sort((x, y) => y.amount - x.amount || y.id - x.id).map((x) => x.id);
    expect(await walk('sort=amount&order=desc')).toEqual({ seen: desc, pages: 4 });
    expect((await walk('sort=amount&order=asc')).seen).toEqual([...desc].reverse());
    expect((await walk('sort=date&order=desc')).seen).toEqual(await ids('limit=200'));

    const first = await page('sort=amount&limit=2');
    expect(fail(await get(`sort=date&limit=2&cursor=${first.nextCursor}`), 400, 'VALIDATION').fields).toEqual({
      cursor: 'Список изменился — загрузите его заново',
    });
    fail(await get('cursor=zzz'), 400, 'VALIDATION');
  });

  it('ошибки параметров — 400 с полем; чужая компания — 404; операции другой компании не видны даже по её счёту', async () => {
    w = await opsWorld();
    expect(fail(await get('limit=500'), 400, 'VALIDATION').fields).toEqual({ limit: 'От 1 до 200' });
    expect(fail(await get('from=2026-10-05&to=2026-10-01'), 400, 'VALIDATION').fields).toEqual({ to: 'Конец периода раньше начала' });
    expect(fail(await get('types=bogus'), 400, 'VALIDATION').fields).toEqual({ 'types.0': 'Неверный тип операции' });
    fail(await w.h.req('GET', '/api/v1/companies/999999/operations'), 404, 'NOT_FOUND');

    const other = await w.h.company('Другая');
    const acc = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужая касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await w.post(`/api/v1/companies/${other}/operations`, { type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: acc, amount: 100 });
    expect(await ids(`accountIds=${acc}`)).toEqual([]);
    expect(await ids()).toEqual([]);
  });
});
```

Справка по `opsWorld`: «сейчас» — 2026-10-06 12:00 UTC; счета `kzt` («Касса») и `usd` («Валютный») открыты 2026-10-01; статьи `income` («Бар»), `expense` («Аренда»); проекты `project` («Клуб 1»), `project2` («Клуб 2»); контрагент «ИП Клиент»; тег «Смена»; ручной курс USD 475,12 на 2026-10-01.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/journal-list.test.ts`
Expected: FAIL — `GET …/operations` отвечает 404 (маршрута нет).

- [ ] **Step 3: Implement**

`src/server/modules/operations/journal.ts` (создайте инструментом записи файлов: в строке с `ESCAPE '\\'` должны остаться две обратные косые):

```ts
import { and, asc, count, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { addDays, startOfDayUtc } from '../../../shared/dates';
import type { JournalFilter, JournalOrder, JournalQuery, JournalSort } from '../../../shared/schemas/journal';
import { foldCase } from '../../../shared/search';
import type { Db } from '../../db/client';
import { attachments, operationLines, operations, operationTags } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { OperationDto, OperationLineDto } from './service';

export interface JournalItem extends OperationDto {
  /** Сколько у операции неудалённых вложений. */
  attachmentCount: number;
}

export interface JournalPage {
  items: JournalItem[];
  /** Курсор следующей страницы; null — дальше ничего нет. */
  nextCursor: string | null;
}

export interface JournalService {
  /** Страница журнала (§6): фильтр, сортировка, курсор. Удалённые операции не показываются. */
  list(companyId: number, query: JournalQuery): JournalPage;
}

/** Шаблон LIKE (§6.1): запрос в нижнем регистре и с «е» вместо «ё»; `\`, `%` и `_` экранированы. */
export function likePattern(q: string): string {
  return `%${foldCase(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const idList = (ids: number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);

/** Условия через ИЛИ в скобках; null — ни одного. */
function anyOf(parts: (SQL | false | undefined)[]): SQL | null {
  const xs = parts.filter((p): p is SQL => !!p);
  return xs.length ? sql`(${sql.join(xs, sql` OR `)})` : null;
}

/**
 * Условие фильтра журнала (§6) над `operations o`, без удалённых операций.
 * Внутри одного измерения «без …» объединяется с выбранными элементами через ИЛИ («Аренда» или без статьи),
 * разные измерения — через И.
 */
export function journalWhere(companyId: number, f: JournalFilter, timezone: string): SQL {
  const conds: SQL[] = [sql`o.company_id = ${companyId}`, sql`o.deleted_at IS NULL`];
  // период — по календарной дате paidAt в APP_TIMEZONE: [начало from; начало to + 1)
  if (f.from) conds.push(sql`o.paid_at >= ${startOfDayUtc(f.from, timezone)}`);
  if (f.to) conds.push(sql`o.paid_at < ${startOfDayUtc(addDays(f.to, 1), timezone)}`);
  // сумма — в базовой валюте компании
  if (f.amountMin !== undefined) conds.push(sql`o.base_amount >= ${f.amountMin}`);
  if (f.amountMax !== undefined) conds.push(sql`o.base_amount <= ${f.amountMax}`);
  if (f.types) conds.push(sql`o.type IN (${sql.join(f.types.map((t) => sql`${t}`), sql`, `)})`);
  if (f.accountIds) conds.push(sql`(o.account_id IN (${idList(f.accountIds)}) OR o.to_account_id IN (${idList(f.accountIds)}))`);
  if (f.tagIds) conds.push(sql`EXISTS (SELECT 1 FROM operation_tags ft WHERE ft.operation_id = o.id AND ft.tag_id IN (${idList(f.tagIds)}))`);

  const counterparty = anyOf([
    f.counterpartyIds && sql`o.counterparty_id IN (${idList(f.counterpartyIds)})`,
    // доход или расход без контрагента
    f.withoutCounterparty && sql`(o.type <> 'transfer' AND o.counterparty_id IS NULL)`,
  ]);
  if (counterparty) conds.push(counterparty);

  const category = anyOf([
    // хотя бы одна строка; родительская статья включает дочерние (вложенность не больше двух уровней, §4.4)
    f.categoryIds &&
      sql`EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.category_id IN (SELECT c.id FROM categories c WHERE c.company_id = ${companyId} AND (c.id IN (${idList(f.categoryIds)}) OR c.parent_id IN (${idList(f.categoryIds)}))))`,
    // доход или расход, у которого хотя бы у одной строки нет статьи; переводы не учитываются
    f.withoutCategory && sql`(o.type <> 'transfer' AND EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.category_id IS NULL))`,
  ]);
  if (category) conds.push(category);

  const project = anyOf([
    f.projectIds && sql`EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.project_id IN (${idList(f.projectIds)}))`,
    // хотя бы у одной строки нет проекта, либо перевод без строк
    f.withoutProject &&
      sql`(EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.project_id IS NULL) OR (o.type = 'transfer' AND NOT EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id)))`,
  ]);
  if (project) conds.push(project);

  if (f.q) {
    // §6.1: ulower(поле) LIKE '%запрос%' ESCAPE '\'. Подзапросы по справочникам не зависят от строки операции —
    // SQLite вычисляет их один раз
    const p = likePattern(f.q);
    const like = (column: string) => sql`ulower(${sql.raw(column)}) LIKE ${p} ESCAPE '\\'`;
    const named = (table: string) => sql`SELECT id FROM ${sql.raw(table)} WHERE company_id = ${companyId} AND ${like('name')}`;
    conds.push(
      sql`(${like('o.comment')} OR o.counterparty_id IN (${named('counterparties')}) OR o.account_id IN (${named('accounts')}) OR o.to_account_id IN (${named('accounts')}) OR EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND (fl.category_id IN (${named('categories')}) OR fl.project_id IN (${named('projects')}))))`,
    );
  }
  return sql.join(conds, sql` AND `);
}

/** Порядок журнала: по дате — (paidAt, id), по сумме — (baseAmount, id). */
export function journalOrder(sort: JournalSort, order: JournalOrder): SQL {
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return sql.raw(sort === 'date' ? `o.paid_at ${dir}, o.id ${dir}` : `o.base_amount ${dir}, o.id ${dir}`);
}

interface CursorKey {
  s: JournalSort;
  o: JournalOrder;
  /** paidAt или baseAmount последней строки страницы. */
  v: string | number;
  id: number;
}

const encodeCursor = (k: CursorKey) => Buffer.from(JSON.stringify(k)).toString('base64url');

function decodeCursor(raw: string, sort: JournalSort, order: JournalOrder): CursorKey {
  let k: Partial<CursorKey> | null = null;
  try {
    k = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorKey> | null;
  } catch {
    k = null;
  }
  const valueOk = sort === 'date' ? typeof k?.v === 'string' : Number.isSafeInteger(k?.v);
  if (!k || k.s !== sort || k.o !== order || !Number.isSafeInteger(k.id) || !valueOk) {
    // курсор другой сортировки или испорченный — клиент начинает список заново
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { cursor: 'Список изменился — загрузите его заново' });
  }
  return k as CursorKey;
}

export function createJournal(d: { db: Db; timezone: string }): JournalService {
  const { db, timezone } = d;

  /** Операции страницы в заданном порядке: со строками, тегами и числом вложений. */
  function loadItems(ids: number[]): JournalItem[] {
    if (ids.length === 0) return [];
    const rows = new Map(db.select().from(operations).where(inArray(operations.id, ids)).all().map((r) => [r.id, r]));
    const lines = new Map<number, OperationLineDto[]>();
    for (const l of db
      .select()
      .from(operationLines)
      .where(inArray(operationLines.operationId, ids))
      .orderBy(asc(operationLines.operationId), asc(operationLines.position))
      .all()) {
      const xs = lines.get(l.operationId) ?? [];
      xs.push({ id: l.id, position: l.position, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: l.baseAmount });
      lines.set(l.operationId, xs);
    }
    const tags = new Map<number, number[]>();
    for (const t of db.select().from(operationTags).where(inArray(operationTags.operationId, ids)).orderBy(asc(operationTags.tagId)).all()) {
      tags.set(t.operationId, [...(tags.get(t.operationId) ?? []), t.tagId]);
    }
    const files = new Map(
      db
        .select({ operationId: attachments.operationId, n: count() })
        .from(attachments)
        .where(and(inArray(attachments.operationId, ids), isNull(attachments.deletedAt)))
        .groupBy(attachments.operationId)
        .all()
        .map((r) => [r.operationId, r.n]),
    );
    return ids.map((id) => ({ ...rows.get(id)!, lines: lines.get(id) ?? [], tagIds: tags.get(id) ?? [], attachmentCount: files.get(id) ?? 0 }));
  }

  return {
    list(companyId, q) {
      requireCompany(db, companyId);
      const conds = [journalWhere(companyId, q, timezone)];
      if (q.cursor) {
        // ключ сортировки и id последней строки предыдущей страницы: (key, id) строго дальше
        const c = decodeCursor(q.cursor, q.sort, q.order);
        const key = sql.raw(q.sort === 'date' ? 'o.paid_at' : 'o.base_amount');
        conds.push(sql`(${key}, o.id) ${sql.raw(q.order === 'asc' ? '>' : '<')} (${c.v}, ${c.id})`);
      }
      const found = db.all<{ id: number; paidAt: string; baseAmount: number }>(
        sql`SELECT o.id AS id, o.paid_at AS paidAt, o.base_amount AS baseAmount FROM operations o WHERE ${sql.join(conds, sql` AND `)} ORDER BY ${journalOrder(q.sort, q.order)} LIMIT ${q.limit + 1}`,
      );
      const more = found.length > q.limit;
      const rows = more ? found.slice(0, q.limit) : found;
      const last = rows.at(-1);
      return {
        items: loadItems(rows.map((r) => r.id)),
        nextCursor: more && last ? encodeCursor({ s: q.sort, o: q.order, v: q.sort === 'date' ? last.paidAt : last.baseAmount, id: last.id }) : null,
      };
    },
  };
}
```

`src/server/modules/operations/routes.ts` — замените файл целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { journalQuerySchema } from '../../../shared/schemas/journal';
import { operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { parseId } from '../../http/params';
import type { JournalService } from './journal';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(app: FastifyInstance, deps: { operations: OperationsService; journal: JournalService }): void {
  const { operations, journal } = deps;

  // журнал: фильтр и курсор в строке запроса (§6)
  app.get<C>(BASE, async (req) => journal.list(parseId(req.params.cid), journalQuerySchema.parse(req.query)));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — импорт после `import { createAttachmentsService } from './modules/attachments/service';`:

```ts
import { createJournal } from './modules/operations/journal';
```

и вместо `registerOperationsRoutes(app, { operations });`:

```ts
  registerOperationsRoutes(app, { operations, journal: createJournal({ db, timezone: config.timezone }) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/journal-list.test.ts tests/server/operations-create.test.ts tests/server/operations-update.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/operations/journal.ts src/server/modules/operations/routes.ts src/server/app.ts tests/server/journal-list.test.ts
git commit -m "feat: список журнала — фильтр §6, поиск ulower, сортировка и курсор

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Остаток после операции

**Files:**
- Create: `tests/server/journal-balances.test.ts`
- Modify: `src/server/modules/balances/service.ts`, `src/server/modules/references/service.ts`, `src/server/modules/operations/journal.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `createJournal`, `JournalItem` (задача 2); `createLedgerBalances` (план 4a).
- Produces:
  - `LedgerBalances.balancesAfter(companyId: number, scope?: { operationIds: number[]; accountIds: number[] }): Map<string, number>` — ключ `${operationId}:${accountId}`;
  - `JournalItem.balanceAfter: number | null`, `JournalItem.toBalanceAfter: number | null`;
  - `createJournal(d: { db: Db; balances: LedgerBalances; timezone: string }): JournalService`.

- [ ] **Step 1: Write the failing test**

`tests/server/journal-balances.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Item {
  id: number;
  balanceAfter: number | null;
  toBalanceAfter: number | null;
}

const items = async (qs = '') => {
  const res = await w.h.req('GET', qs ? `${w.ops}?${qs}` : w.ops);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().items as Item[]).map(({ id, balanceAfter, toBalanceAfter }) => ({ id, balanceAfter, toBalanceAfter }));
};
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;

describe('журнал: остаток после операции (§4.7)', () => {
  it('по полной истории счёта в порядке (paidAt, id), без учёта фильтра; у перевода — оба счёта; удалённые не учитываются', async () => {
    w = await opsWorld();
    // стартовый остаток счёта KZT — 1000 ₸
    expect((await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { startingBalance: 100000 })).statusCode).toBe(200);
    const a = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z', amount: 50000 });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z', amount: 20000 });
    const d = await op({ type: 'income', paidAt: '2026-10-03T10:00:00Z', amount: 10000 }); // та же дата, id больше — после b
    const c = await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const e = await op({ paidAt: '2026-10-01T10:00:00Z', amount: 5000 }); // внесена последней, но по дате — первая
    const f = await op({ type: 'income', paidAt: '2026-10-02T09:00:00Z', amount: 7000 });
    await w.h.req('DELETE', `${w.ops}/${f}`); // удалённая не влияет на остатки

    // 1000 − 50 = 950; +500 = 1450; −200 = 1250; +100 = 1350; −475,12 = 874,88 ₸; USD: 0 + 1,00 $
    expect(await items()).toEqual([
      { id: c, balanceAfter: 87488, toBalanceAfter: 100 },
      { id: d, balanceAfter: 135000, toBalanceAfter: null },
      { id: b, balanceAfter: 125000, toBalanceAfter: null },
      { id: a, balanceAfter: 145000, toBalanceAfter: null },
      { id: e, balanceAfter: 95000, toBalanceAfter: null },
    ]);
    // фильтр не меняет остатки: они считаются по всей истории счёта
    expect(await items('types=expense')).toEqual([
      { id: b, balanceAfter: 125000, toBalanceAfter: null },
      { id: e, balanceAfter: 95000, toBalanceAfter: null },
    ]);
    expect(await items(`accountIds=${w.usd}`)).toEqual([{ id: c, balanceAfter: 87488, toBalanceAfter: 100 }]);
    // страница с курсором — те же значения
    const second = (await w.h.req('GET', `${w.ops}?limit=2`)).json().nextCursor as string;
    expect((await items(`limit=2&cursor=${second}`)).map((x) => x.balanceAfter)).toEqual([125000, 145000]);

    // остаток после последней операции = баланс счёта
    const ledger = createLedgerBalances(w.h.t.db).companyBalances(w.cid);
    expect(ledger.find((x) => x.accountId === w.kzt)!.balance).toBe(87488);
    expect(ledger.find((x) => x.accountId === w.usd)!.balance).toBe(100);
  });

  it('восстановление удалённой операции снова включает её в историю', async () => {
    w = await opsWorld();
    const a = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z', amount: 3000 });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z', amount: 1000 });
    await w.h.req('DELETE', `${w.ops}/${a}`);
    expect(await items()).toEqual([{ id: b, balanceAfter: -1000, toBalanceAfter: null }]);
    await w.h.req('POST', `${w.ops}/${a}/restore`);
    expect(await items()).toEqual([
      { id: b, balanceAfter: 2000, toBalanceAfter: null },
      { id: a, balanceAfter: 3000, toBalanceAfter: null },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/journal-balances.test.ts`
Expected: FAIL — в элементах нет `balanceAfter` и `toBalanceAfter`.

- [ ] **Step 3: Implement**

`src/server/modules/balances/service.ts`:

1. Устаревший комментарий интерфейса (замечание 5 итогов 4a). Замените

```ts
/** Баланс счёта (§4.7). До шага 4 операций нет — баланс равен стартовому остатку. */
```

на

```ts
/** Баланс счёта (§4.7). Заглушка createBalancesService (баланс = стартовый остаток) — значение по умолчанию для модульных тестов. */
```

2. Метод в интерфейс `LedgerBalances` — замените

```ts
export interface LedgerBalances extends BalancesService {
  /** Балансы всех счетов компании (включая архивные) в их валютах. */
  companyBalances(companyId: number): AccountBalance[];
}
```

на

```ts
export interface LedgerBalances extends BalancesService {
  /** Балансы всех счетов компании (включая архивные) в их валютах. */
  companyBalances(companyId: number): AccountBalance[];
  /**
   * Остаток счёта после операции (§4.7): оконная функция по полной истории счёта — фактические неудалённые
   * операции в порядке (paidAt, id), без учёта фильтров журнала. Ключ — `${operationId}:${accountId}`;
   * у перевода есть оба ключа. scope — только эти операции, окно — по полной истории этих счетов
   * (страница журнала); без scope — все операции компании (выгрузка).
   */
  balancesAfter(companyId: number, scope?: { operationIds: number[]; accountIds: number[] }): Map<string, number>;
}
```

3. Реализация — в объект, который возвращает `createLedgerBalances`, после метода `companyBalances` (после его закрывающего `},`) добавьте:

```ts
    balancesAfter(companyId, scope) {
      if (scope && (scope.operationIds.length === 0 || scope.accountIds.length === 0)) return new Map();
      const list = (ids: number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
      const fromScope = scope ? sql`AND account_id IN (${list(scope.accountIds)})` : sql.empty();
      const toScope = scope ? sql`AND to_account_id IN (${list(scope.accountIds)})` : sql.empty();
      const only = scope ? sql`WHERE r.op_id IN (${list(scope.operationIds)})` : sql.empty();
      // каждая операция — «нога» по счёту операции (доход — приход, иначе списание), перевод — ещё нога по счёту зачисления
      const rows = db.all<{ operationId: number; accountId: number; balance: number }>(sql`
        WITH legs AS (
          SELECT id AS op_id, paid_at, account_id, CASE WHEN type = 'income' THEN amount ELSE -amount END AS delta
            FROM operations
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'actual' ${fromScope}
          UNION ALL
          SELECT id, paid_at, to_account_id, to_amount
            FROM operations
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'actual' AND type = 'transfer' ${toScope}
        ),
        running AS (
          SELECT op_id, account_id,
                 SUM(delta) OVER (PARTITION BY account_id ORDER BY paid_at, op_id ROWS UNBOUNDED PRECEDING) AS run
            FROM legs
        )
        SELECT r.op_id AS operationId, r.account_id AS accountId, a.starting_balance + r.run AS balance
          FROM running r JOIN accounts a ON a.id = r.account_id
        ${only}`);
      return new Map(rows.map((r) => [`${r.operationId}:${r.accountId}`, r.balance]));
    },
```

(`sql` уже импортирован в этом файле из `drizzle-orm`.)

`src/server/modules/references/service.ts` — устаревший комментарий (замечание 5 итогов 4a). Замените строку

```ts
 * До шага 4 операций нет: заглушка отвечает «ссылок нет». Шаг 4 подставляет настоящую реализацию с тестами.
```

на

```ts
 * Заглушка createReferencesService («ссылок нет») — значение по умолчанию для модульных тестов;
 * приложение использует createOperationsReferences.
```

`src/server/modules/operations/journal.ts`:

1. Импорт после `import { AppError } from '../../errors';`:

```ts
import type { LedgerBalances } from '../balances/service';
```

2. Поля элемента — замените

```ts
export interface JournalItem extends OperationDto {
  /** Сколько у операции неудалённых вложений. */
  attachmentCount: number;
}
```

на

```ts
export interface JournalItem extends OperationDto {
  /** Сколько у операции неудалённых вложений. */
  attachmentCount: number;
  /** Остаток счёта операции после неё (у перевода — счёта списания), по полной истории счёта (§4.7). */
  balanceAfter: number | null;
  /** У перевода — остаток счёта зачисления после операции; у дохода и расхода null. */
  toBalanceAfter: number | null;
}
```

3. Зависимости — замените

```ts
export function createJournal(d: { db: Db; timezone: string }): JournalService {
  const { db, timezone } = d;
```

на

```ts
export function createJournal(d: { db: Db; balances: LedgerBalances; timezone: string }): JournalService {
  const { db, balances, timezone } = d;
```

4. Функцию `loadItems` замените целиком:

```ts
  /** Операции страницы в заданном порядке: со строками, тегами, числом вложений и остатками после операции. */
  function loadItems(companyId: number, ids: number[]): JournalItem[] {
    if (ids.length === 0) return [];
    const rows = new Map(db.select().from(operations).where(inArray(operations.id, ids)).all().map((r) => [r.id, r]));
    const lines = new Map<number, OperationLineDto[]>();
    for (const l of db
      .select()
      .from(operationLines)
      .where(inArray(operationLines.operationId, ids))
      .orderBy(asc(operationLines.operationId), asc(operationLines.position))
      .all()) {
      const xs = lines.get(l.operationId) ?? [];
      xs.push({ id: l.id, position: l.position, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: l.baseAmount });
      lines.set(l.operationId, xs);
    }
    const tags = new Map<number, number[]>();
    for (const t of db.select().from(operationTags).where(inArray(operationTags.operationId, ids)).orderBy(asc(operationTags.tagId)).all()) {
      tags.set(t.operationId, [...(tags.get(t.operationId) ?? []), t.tagId]);
    }
    const files = new Map(
      db
        .select({ operationId: attachments.operationId, n: count() })
        .from(attachments)
        .where(and(inArray(attachments.operationId, ids), isNull(attachments.deletedAt)))
        .groupBy(attachments.operationId)
        .all()
        .map((r) => [r.operationId, r.n]),
    );
    // окно — по полной истории счетов этой страницы (§4.7), фильтр журнала на него не влияет
    const accountIds = [...new Set([...rows.values()].flatMap((r) => (r.toAccountId === null ? [r.accountId] : [r.accountId, r.toAccountId])))];
    const after = balances.balancesAfter(companyId, { operationIds: ids, accountIds });
    return ids.map((id) => {
      const row = rows.get(id)!;
      return {
        ...row,
        lines: lines.get(id) ?? [],
        tagIds: tags.get(id) ?? [],
        attachmentCount: files.get(id) ?? 0,
        balanceAfter: after.get(`${id}:${row.accountId}`) ?? null,
        toBalanceAfter: row.toAccountId === null ? null : (after.get(`${id}:${row.toAccountId}`) ?? null),
      };
    });
  }
```

5. В `list` замените `items: loadItems(rows.map((r) => r.id)),` на:

```ts
        items: loadItems(companyId, rows.map((r) => r.id)),
```

`src/server/app.ts` — вместо `registerOperationsRoutes(app, { operations, journal: createJournal({ db, timezone: config.timezone }) });`:

```ts
  registerOperationsRoutes(app, { operations, journal: createJournal({ db, balances, timezone: config.timezone }) });
```

(`balances` — уже объявленная выше в `buildApp` константа `createLedgerBalances(db)`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/journal-balances.test.ts tests/server/journal-list.test.ts tests/server/ledger.test.ts tests/server/balances-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/balances/service.ts src/server/modules/references/service.ts src/server/modules/operations/journal.ts src/server/app.ts tests/server/journal-balances.test.ts
git commit -m "feat: остаток после операции в журнале — окно по полной истории счёта

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Массовые действия

**Files:**
- Create: `src/server/modules/operations/bulk.ts`, `tests/server/operations-bulk.test.ts`
- Modify: `src/shared/schemas/operations.ts`, `src/server/modules/operations/routes.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `OperationsService` (`get`, `update`, `remove`, `restore` — план 4a), `requireCompany`, таблицы `categories`, `projects`, `counterparties`; `createJournal` (задача 3).
- Produces:
  - `operationBulkSchema` — `{ action: 'setCategory', ids, categoryId } | { action: 'setProject', ids, projectId } | { action: 'setCounterparty', ids, counterpartyId } | { action: 'delete', ids } | { action: 'restore', ids }`, `ids` — 1…500 положительных целых;
  - `BULK_MAX = 500`, типы `OperationBulkInput`, `BulkSkip { id: number; reason: string }`, `BulkResult { changed: number[]; skipped: BulkSkip[] }` (`src/shared/schemas/operations.ts`);
  - `interface BulkService { run(companyId: number, input: OperationBulkInput, userId: number): BulkResult }`, `createBulkService(d: { db: Db; operations: OperationsService }): BulkService`;
  - `POST /api/v1/companies/:cid/operations/bulk` → 200 `{ changed, skipped }`;
  - `registerOperationsRoutes(app, { operations, journal, bulk })`.

- [ ] **Step 1: Write the failing test**

`tests/server/operations-bulk.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createBulkService } from '../../src/server/modules/operations/bulk';
import { createOperationsService, type OperationsService } from '../../src/server/modules/operations/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const split = (cat: number | null) => [
  { categoryId: cat, projectId: w.project, amount: 400 },
  { categoryId: cat, projectId: w.project2, amount: 600 },
];
const bulk = (body: Record<string, unknown>) => w.h.req('POST', `${w.ops}/bulk`, body);
const ok = async (body: Record<string, unknown>) => {
  const res = await bulk(body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { changed: number[]; skipped: { id: number; reason: string }[] };
};
const getOp = async (id: number) => (await w.h.req('GET', `${w.ops}/${id}`)).json().operation;
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('массовые действия: POST /companies/:cid/operations/bulk (§7)', () => {
  it('«Категория»: меняет единственную строку; пропускает переводы, разбитые, другой вид, удалённые и чужие — с причинами', async () => {
    w = await opsWorld();
    const single = await op({ lines: [{ projectId: w.project, amount: 1000 }] });
    const income = await op({ type: 'income' });
    const splitOp = await op({ lines: split(null) });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const gone = await op({});
    await w.h.req('DELETE', `${w.ops}/${gone}`);
    const before = w.h.auditCount('operation', 'update');

    const r = await ok({ action: 'setCategory', categoryId: w.expense, ids: [single, income, splitOp, tr, gone, 999999, single] });
    expect(r.changed).toEqual([single]);
    expect(r.skipped).toEqual([
      { id: income, reason: 'Статья расходов не подходит для дохода' },
      { id: splitOp, reason: 'Разбитая операция — измените её в форме' },
      { id: tr, reason: 'У перевода нет статьи' },
      { id: gone, reason: 'Операция удалена' },
      { id: 999999, reason: 'Операция не найдена' },
    ]);
    expect(await getOp(single)).toMatchObject({ version: 2, lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    expect((await getOp(income)).version).toBe(1);
    expect(w.h.auditCount('operation', 'update')).toBe(before + 1);

    // повтор — значение уже такое: операция в changed, версия и история не меняются
    expect(await ok({ action: 'setCategory', categoryId: w.expense, ids: [single] })).toEqual({ changed: [single], skipped: [] });
    expect((await getOp(single)).version).toBe(2);
    expect(w.h.auditCount('operation', 'update')).toBe(before + 1);
  });

  it('«Проект»: меняет единственную строку, переводу без строк создаёт строку, разбитые пропускает', async () => {
    w = await opsWorld();
    const single = await op({ lines: [{ categoryId: w.expense, amount: 1000 }] });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const splitOp = await op({ lines: split(w.expense) });
    const r = await ok({ action: 'setProject', projectId: w.project2, ids: [single, tr, splitOp] });
    expect(r).toEqual({ changed: [single, tr], skipped: [{ id: splitOp, reason: 'Разбитая операция — измените её в форме' }] });
    expect((await getOp(single)).lines).toMatchObject([{ categoryId: w.expense, projectId: w.project2, amount: 1000 }]);
    expect(await getOp(tr)).toMatchObject({ version: 2, lines: [{ categoryId: null, projectId: w.project2, amount: 47512, baseAmount: 47512 }] });
  });

  it('«Контрагент»: доходы и расходы, в том числе разбитые; переводы пропускаются', async () => {
    w = await opsWorld();
    const exp = await op({});
    const inc = await op({ type: 'income' });
    const splitOp = await op({ lines: split(w.expense) });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const r = await ok({ action: 'setCounterparty', counterpartyId: w.counterparty, ids: [exp, inc, splitOp, tr] });
    expect(r).toEqual({ changed: [exp, inc, splitOp], skipped: [{ id: tr, reason: 'У перевода нет контрагента' }] });
    for (const id of [exp, inc, splitOp]) expect((await getOp(id)).counterpartyId).toBe(w.counterparty);
  });

  it('«Удалить» пропускает операции на архивном счёте и уже удалённые; «Отменить» возвращает только удалённые этим действием', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const locked = await op({ type: 'income', accountId: safe, amount: 100 });
    await op({ accountId: safe, amount: 100, paidAt: '2026-10-02T11:00:00Z' }); // баланс сейфа снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    const a = await op({});
    const b = await op({});
    await w.h.req('DELETE', `${w.ops}/${b}`);

    const del = await ok({ action: 'delete', ids: [a, b, locked] });
    expect(del).toEqual({
      changed: [a],
      skipped: [
        { id: b, reason: 'Операция уже удалена' },
        { id: locked, reason: 'Операция затрагивает счёт «Сейф» в архиве — удалить её нельзя' },
      ],
    });
    expect((await getOp(a)).deletedAt).not.toBeNull();
    expect((await getOp(b)).version).toBe(2); // удалена раньше — версия не выросла второй раз
    expect(w.h.auditCount('operation', 'delete')).toBe(2);

    // «Отменить» шлёт changed из ответа; неудалённая операция в списке пропускается
    const back = await ok({ action: 'restore', ids: [...del.changed, locked] });
    expect(back).toEqual({ changed: [a], skipped: [{ id: locked, reason: 'Операция не удалена' }] });
    expect(await getOp(a)).toMatchObject({ deletedAt: null, version: 3 });
    expect((await getOp(b)).deletedAt).not.toBeNull();
  });

  it('«Отменить» после массового удаления не возвращает операцию, которую раньше удалил другой пользователь', async () => {
    w = await opsWorld();
    const x = await op({});
    const y = await op({});
    await seedUser(w.h.t, 'buh', 'buh-password-1');
    const cookie = await loginAs(w.h.t, 'buh', 'buh-password-1');
    expect((await w.h.t.app.inject({ method: 'DELETE', url: `${w.ops}/${x}`, headers: { ...ORIGIN_HEADERS, cookie } })).statusCode).toBe(200);

    const del = await ok({ action: 'delete', ids: [x, y] });
    expect(del).toEqual({ changed: [y], skipped: [{ id: x, reason: 'Операция уже удалена' }] });
    expect(await ok({ action: 'restore', ids: del.changed })).toEqual({ changed: [y], skipped: [] });
    expect((await getOp(x)).deletedAt).not.toBeNull();
    expect((await getOp(y)).deletedAt).toBeNull();
  });

  it('операция другой компании в списке — пропуск «Операция не найдена», у себя она не меняется', async () => {
    w = await opsWorld();
    const mine = await op({});
    const other = await w.h.company('Другая');
    const acc = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужая касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const foreignOp = (await w.post(`/api/v1/companies/${other}/operations`, { type: 'expense', paidAt: '2026-10-02T10:00:00Z', accountId: acc, amount: 100 }))
      .operation.id as number;
    for (const body of [{ action: 'setCounterparty', counterpartyId: w.counterparty }, { action: 'delete' }, { action: 'restore' }]) {
      expect(await ok({ ...body, ids: [mine, foreignOp] })).toEqual({ changed: [mine], skipped: [{ id: foreignOp, reason: 'Операция не найдена' }] });
    }
    const theirs = (await w.h.req('GET', `/api/v1/companies/${other}/operations/${foreignOp}`)).json().operation;
    expect(theirs).toMatchObject({ counterpartyId: null, deletedAt: null, version: 1 });
  });

  it('«Отменить» пропускает операцию на архивном счёте и нарушившую инвариант 6 после сдвига даты открытия', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const x = await op({ type: 'income', accountId: safe, amount: 50 });
    const y = await op({ accountId: safe, amount: 50, paidAt: '2026-10-02T11:00:00Z' });
    const kaspi = (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const early = await op({ type: 'income', accountId: kaspi, amount: 10 });
    const fine = await op({});
    expect((await ok({ action: 'delete', ids: [x, y, early, fine] })).changed).toEqual([x, y, early, fine]);
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect((await w.h.req('PATCH', `${accountsUrl()}/${kaspi}`, { openedAt: '2026-10-04' })).statusCode).toBe(200);

    const r = await ok({ action: 'restore', ids: [x, early, fine] });
    expect(r.changed).toEqual([fine]);
    expect(r.skipped).toEqual([
      { id: x, reason: 'Счёт «Сейф» в архиве — сначала верните его из архива' },
      { id: early, reason: 'Счёт «Kaspi» открыт 04.10.2026 — операция не может быть раньше' },
    ]);
  });

  it('выбранный элемент в архиве или из другой компании, архивная компания, пустой список — отказ всего запроса, ничего не меняется', async () => {
    w = await opsWorld();
    const a = await op({});
    const cats = `/api/v1/companies/${w.cid}/categories`;
    const old = (await w.post(cats, { kind: 'expense', name: 'Старая' })).category.id;
    await w.post(`${cats}/${old}/archive`, {});
    expect(fail(await bulk({ action: 'setCategory', categoryId: old, ids: [a] }), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Статья «Старая» в архиве — выберите другую',
    );
    const other = await w.h.company('Другая');
    const foreign = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id;
    fail(await bulk({ action: 'setProject', projectId: foreign, ids: [a] }), 422, 'INVARIANT_5');
    expect((await getOp(a)).version).toBe(1);

    await w.post(`/api/v1/companies/${other}/archive`, {});
    fail(await w.h.req('POST', `/api/v1/companies/${other}/operations/bulk`, { action: 'delete', ids: [a] }), 422, 'ARCHIVED_REFERENCE');
    fail(await bulk({ action: 'delete', ids: [] }), 400, 'VALIDATION');
    fail(await bulk({ action: 'rename', ids: [a] }), 400, 'VALIDATION');
    fail(await bulk({ action: 'delete', ids: Array.from({ length: 501 }, (_, i) => i + 1) }), 400, 'VALIDATION');
  });

  it('непредвиденный сбой посередине откатывает весь запрос — и уже применённые операции, и историю (Review Focus 4)', async () => {
    w = await opsWorld();
    const a = await op({});
    const b = await op({});
    const db = w.h.t.db;
    const audit = createAuditService(db);
    const real = createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => new Date('2026-10-06T12:00:00.000Z') });
    let calls = 0;
    const flaky: OperationsService = {
      ...real,
      update: (...args) => {
        if (++calls === 2) throw new Error('диск отвалился');
        return real.update(...args);
      },
    };
    const before = w.h.auditCount('operation', 'update');
    expect(() => createBulkService({ db, operations: flaky }).run(w.cid, { action: 'setCounterparty', counterpartyId: w.counterparty, ids: [a, b] }, 1)).toThrow(
      'диск отвалился',
    );
    expect(await getOp(a)).toMatchObject({ counterpartyId: null, version: 1 });
    expect(w.h.auditCount('operation', 'update')).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/operations-bulk.test.ts`
Expected: FAIL — нет модуля `operations/bulk`.

- [ ] **Step 3: Implement**

`src/shared/schemas/operations.ts` — в конец файла (`id` — уже объявленная в начале файла схема идентификатора):

```ts

/**
 * Не больше операций в одном массовом действии: запрос синхронный (better-sqlite3) и держит цикл событий —
 * 500 операций на демо-наборе обрабатываются за время, указанное в решениях плана 5a.
 */
export const BULK_MAX = 500;
const bulkIds = z.array(id).min(1, 'Выберите операции').max(BULK_MAX, `Не больше ${BULK_MAX} операций за раз`);

/** Массовые действия журнала (§7): без проверки версии, каждая изменённая операция получает новую версию и запись в истории. */
export const operationBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setCategory'), ids: bulkIds, categoryId: id }),
  z.object({ action: z.literal('setProject'), ids: bulkIds, projectId: id }),
  z.object({ action: z.literal('setCounterparty'), ids: bulkIds, counterpartyId: id }),
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({ action: z.literal('restore'), ids: bulkIds }),
]);

export type OperationBulkInput = z.output<typeof operationBulkSchema>;

export interface BulkSkip {
  id: number;
  /** Причина по-русски — показывается в итоге «изменено N, пропущено M». */
  reason: string;
}

export interface BulkResult {
  /**
   * Операции, к которым действие применено. У «Категории», «Проекта», «Контрагента» — в том числе те, где значение
   * уже было таким. Удаление уже удалённой и восстановление неудалённой — пропуск: «Отменить» по changed
   * не вернёт операцию, которую удалили раньше и не этим действием.
   */
  changed: number[];
  skipped: BulkSkip[];
}
```

`src/server/modules/operations/bulk.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { BulkResult, BulkSkip, OperationBulkInput } from '../../../shared/schemas/operations';
import type { Db } from '../../db/client';
import { categories, counterparties, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { OperationsService } from './service';

export interface BulkService {
  /**
   * Массовое действие (§7 «Массовые действия»): версию не проверяет, у изменённых операций увеличивает её и пишет
   * историю. Неподходящие операции пропускаются с причиной. Выбранная статья, проект или контрагент другой компании
   * или в архиве — отказ всего запроса (инварианты 5 и 7), как и архивная компания.
   */
  run(companyId: number, input: OperationBulkInput, userId: number): BulkResult;
}

const DELETED = 'Операция удалена';
const SPLIT = 'Разбитая операция — измените её в форме';

/** Выбранный элемент справочника: та же компания (инвариант 5) и не в архиве (инвариант 7). */
function chosen<T extends { name: string; archivedAt: string | null }>(row: T | undefined, notFound: string, archived: (name: string) => string): T {
  if (!row) throw new AppError(422, 'INVARIANT_5', notFound);
  if (row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', archived(row.name));
  return row;
}

export function createBulkService(d: { db: Db; operations: OperationsService }): BulkService {
  const { db, operations: ops } = d;

  /** Действие над одной операцией: null — применено, строка — причина пропуска. */
  function action(companyId: number, input: OperationBulkInput, userId: number): (id: number) => string | null {
    switch (input.action) {
      case 'setCategory': {
        const cat = chosen(
          db.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.companyId, companyId))).get(),
          'Статья не найдена в этой компании',
          (name) => `Статья «${name}» в архиве — выберите другую`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.type === 'transfer') return 'У перевода нет статьи';
          if (op.lines.length !== 1) return SPLIT;
          // инвариант 3: вид статьи — по типу операции
          if (op.type !== cat.kind) return cat.kind === 'income' ? 'Статья доходов не подходит для расхода' : 'Статья расходов не подходит для дохода';
          const line = op.lines[0]!;
          ops.update(companyId, id, { version: op.version, lines: [{ categoryId: cat.id, projectId: line.projectId, amount: line.amount }] }, userId);
          return null;
        };
      }
      case 'setProject': {
        const project = chosen(
          db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).get(),
          'Проект не найден в этой компании',
          (name) => `Проект «${name}» в архиве — выберите другой`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.lines.length > 1) return SPLIT;
          // перевод без строк получает строку с проектом на всю сумму (§4.5)
          const line = op.lines[0];
          const lines = [{ categoryId: line?.categoryId ?? null, projectId: project.id, amount: line?.amount ?? op.amount }];
          ops.update(companyId, id, { version: op.version, lines }, userId);
          return null;
        };
      }
      case 'setCounterparty': {
        const cp = chosen(
          db.select().from(counterparties).where(and(eq(counterparties.id, input.counterpartyId), eq(counterparties.companyId, companyId))).get(),
          'Контрагент не найден в этой компании',
          (name) => `Контрагент «${name}» в архиве — выберите другого`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.type === 'transfer') return 'У перевода нет контрагента';
          ops.update(companyId, id, { version: op.version, counterpartyId: cp.id }, userId);
          return null;
        };
      }
      case 'delete':
        // уже удалённая — пропуск, а не «изменено»: иначе «Отменить» по changed вернул бы операцию,
        // удалённую раньше (возможно, другим пользователем). На архивном счёте remove отвечает
        // ARCHIVED_REFERENCE (инвариант 7) — это причина пропуска
        return (id) => {
          if (ops.get(companyId, id).deletedAt) return 'Операция уже удалена';
          ops.remove(companyId, id, userId);
          return null;
        };
      case 'restore':
        // восстановление перепроверяет инварианты 3–7 (инвариант 11); отказ — причина пропуска
        return (id) => {
          if (!ops.get(companyId, id).deletedAt) return 'Операция не удалена';
          ops.restore(companyId, id, userId);
          return null;
        };
    }
  }

  return {
    run(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const apply = action(companyId, input, userId);
      const changed: number[] = [];
      const skipped: BulkSkip[] = [];
      // Одна транзакция на запрос. Запись каждой операции (mutate) внутри неё — точка сохранения better-sqlite3:
      // отказ по одной операции (AppError) откатывает только её, любой другой сбой — весь запрос.
      db.transaction(() => {
        for (const id of new Set(input.ids)) {
          try {
            const reason = apply(id);
            if (reason) skipped.push({ id, reason });
            else changed.push(id);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            skipped.push({ id, reason: e.message });
          }
        }
      });
      return { changed, skipped };
    },
  };
}
```

Почему так: `mutate` внутри `ops.update/remove/restore` вызывает `db.transaction`, а better-sqlite3 превращает вложенную транзакцию в `SAVEPOINT` (так же работает `seedDemo`). `version` из только что прочитанной операции передаётся в `update`, поэтому проверка версии фактически не действует (§7: «последняя запись выигрывает»), а `update` сам увеличивает версию и пишет историю; без изменений он ничего не пишет.

`src/server/modules/operations/routes.ts` — замените файл целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { journalQuerySchema } from '../../../shared/schemas/journal';
import { operationBulkSchema, operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { parseId } from '../../http/params';
import type { BulkService } from './bulk';
import type { JournalService } from './journal';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(
  app: FastifyInstance,
  deps: { operations: OperationsService; journal: JournalService; bulk: BulkService },
): void {
  const { operations, journal, bulk } = deps;

  // журнал: фильтр и курсор в строке запроса (§6)
  app.get<C>(BASE, async (req) => journal.list(parseId(req.params.cid), journalQuerySchema.parse(req.query)));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.post<C>(`${BASE}/bulk`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = operationBulkSchema.parse(req.body);
    return bulk.run(cid, body, req.user!.id);
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — импорт перед `import { createJournal } from './modules/operations/journal';`:

```ts
import { createBulkService } from './modules/operations/bulk';
```

и вместо `registerOperationsRoutes(app, { operations, journal: createJournal({ db, balances, timezone: config.timezone }) });`:

```ts
  registerOperationsRoutes(app, {
    operations,
    journal: createJournal({ db, balances, timezone: config.timezone }),
    bulk: createBulkService({ db, operations }),
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/operations-bulk.test.ts tests/server/operations-update.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/operations.ts src/server/modules/operations/bulk.ts src/server/modules/operations/routes.ts src/server/app.ts tests/server/operations-bulk.test.ts
git commit -m "feat: массовые действия журнала — категория, проект, контрагент, удаление и восстановление

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Сохранённые фильтры

**Files:**
- Create: `src/shared/schemas/saved-filters.ts`, `src/server/modules/saved-filters/service.ts`, `src/server/modules/saved-filters/routes.ts`, `src/server/db/migrations/0005_*.sql` и `meta/0005_snapshot.json` (генерируются), `tests/server/saved-filters.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/db/migrations/meta/_journal.json` (генерируется), `src/server/app.ts`

**Interfaces:**
- Consumes: `journalFilterSchema`, `JournalFilter` (задача 1); `nameField`, `cleanName` (`src/shared/text.ts`); `requireCompany`; `seedUser`, `loginAs`, `ORIGIN_HEADERS` (`tests/helpers/test-app.ts`).
- Produces:
  - таблица `saved_filters` (id, user_id → users ON DELETE CASCADE, company_id → companies, name, filter JSON, created_at, updated_at; индекс `(user_id, company_id)`);
  - `savedFilterCreateSchema` (`{ name, filter }`), `savedFilterUpdateSchema` (`{ name?, filter? }`), `SAVED_FILTER_NAME_MAX = 100`;
  - `SavedFilterRow { id; companyId; name; filter: JournalFilter; unavailable: number; createdAt; updatedAt }`;
  - `createSavedFiltersService(d: { db: Db; now?: () => Date }): SavedFiltersService` с `list(userId, companyId)`, `add(userId, companyId, input)`, `update(userId, companyId, id, input)`, `remove(userId, companyId, id)`;
  - маршруты `GET/POST /api/v1/companies/:cid/saved-filters` (`{ savedFilters }` / 201 `{ savedFilter }`), `PATCH …/:id` (`{ savedFilter }`), `DELETE …/:id` (204).

- [ ] **Step 1: Write the failing test**

`tests/server/saved-filters.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const url = () => `/api/v1/companies/${w.cid}/saved-filters`;
const list = async () => (await w.h.req('GET', url())).json().savedFilters as { id: number; name: string; filter: Record<string, unknown>; unavailable: number }[];

describe('сохранённые фильтры журнала (§4.4, §6)', () => {
  it('создание, список, переименование, удаление; фильтр нормализуется той же схемой, что строка запроса журнала', async () => {
    w = await opsWorld();
    const res = await w.h.req('POST', url(), {
      name: '  Аренда   клубов ',
      filter: { categoryIds: [w.expense], types: ['expense'], q: ' аренда ', withoutProject: true, withoutCategory: false, sort: 'amount', junk: 1 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().savedFilter;
    expect(created).toMatchObject({
      companyId: w.cid,
      name: 'Аренда клубов',
      filter: { categoryIds: [w.expense], types: ['expense'], q: 'аренда', withoutProject: true },
      unavailable: 0,
    });
    expect(Object.keys(created.filter).sort()).toEqual(['categoryIds', 'q', 'types', 'withoutProject']);
    expect(await list()).toEqual([created]);

    const renamed = (await w.h.req('PATCH', `${url()}/${created.id}`, { name: 'Аренда' })).json().savedFilter;
    expect(renamed).toMatchObject({ name: 'Аренда', filter: created.filter });
    const refiltered = (await w.h.req('PATCH', `${url()}/${created.id}`, { filter: { tagIds: [w.tag] } })).json().savedFilter;
    expect(refiltered.filter).toEqual({ tagIds: [w.tag] });

    expect((await w.h.req('DELETE', `${url()}/${created.id}`)).statusCode).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('только свои: другой пользователь не видит чужой фильтр и получает 404 при правке и удалении', async () => {
    w = await opsWorld();
    const mine = (await w.post(url(), { name: 'Мой', filter: {} })).savedFilter.id as number;
    await seedUser(w.h.t, 'buh', 'buh-password-1');
    const cookie = await loginAs(w.h.t, 'buh', 'buh-password-1');
    const as = (method: 'GET' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      w.h.t.app.inject({ method, url: path, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload ? { payload } : {}) });

    expect((await as('GET', url())).json().savedFilters).toEqual([]);
    fail(await as('PATCH', `${url()}/${mine}`, { name: 'Чужой' }), 404, 'NOT_FOUND');
    fail(await as('DELETE', `${url()}/${mine}`), 404, 'NOT_FOUND');
    expect((await list())[0]!.name).toBe('Мой');

    // свой фильтр под адресом другой компании — тоже 404
    const other = await w.h.company('Другая');
    fail(await w.h.req('PATCH', `/api/v1/companies/${other}/saved-filters/${mine}`, { name: 'x' }), 404, 'NOT_FOUND');
  });

  it('проверка: фильтр — схемой журнала (поле с путём), название обязательно; архивная компания — только чтение', async () => {
    w = await opsWorld();
    expect(fail(await w.h.req('POST', url(), { name: 'Период', filter: { from: '2026-10-05', to: '2026-10-01' } }), 400, 'VALIDATION').fields).toEqual({
      'filter.to': 'Конец периода раньше начала',
    });
    fail(await w.h.req('POST', url(), { name: 'Тип', filter: { types: ['bogus'] } }), 400, 'VALIDATION');
    fail(await w.h.req('POST', url(), { name: '   ', filter: {} }), 400, 'VALIDATION');

    const other = await w.h.company('Архивная');
    await w.post(`/api/v1/companies/${other}/archive`, {});
    fail(await w.h.req('POST', `/api/v1/companies/${other}/saved-filters`, { name: 'x', filter: {} }), 422, 'ARCHIVED_REFERENCE');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/saved-filters`)).statusCode).toBe(200);
  });

  it('инвариант 10: ссылки на удалённые, архивные и чужие элементы отбрасываются при выдаче, сервер сообщает их число; после разархивации возвращаются', async () => {
    w = await opsWorld();
    const other = await w.h.company('Другая');
    const foreignTag = (await w.post(`/api/v1/companies/${other}/tags`, { name: 'Чужой' })).tag.id as number;
    const created = (
      await w.post(url(), { name: 'С архивом', filter: { categoryIds: [w.expense, 999999], tagIds: [w.tag, foreignTag], accountIds: [w.kzt] } })
    ).savedFilter;
    expect(created).toMatchObject({ filter: { categoryIds: [w.expense], tagIds: [w.tag], accountIds: [w.kzt] }, unavailable: 2 });

    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/archive`, {});
    const [archived] = await list();
    expect(archived!.filter).toEqual({ categoryIds: [w.expense], accountIds: [w.kzt] });
    expect(archived!.unavailable).toBe(3);

    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/unarchive`, {});
    expect((await list())[0]).toMatchObject({ filter: { tagIds: [w.tag] }, unavailable: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/saved-filters.test.ts`
Expected: FAIL — маршрутов `saved-filters` нет (404).

- [ ] **Step 3: Implement the table and migration**

`src/server/db/schema.ts` — в конец файла:

```ts

export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Владелец: фильтр видит и меняет только он (§6). */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** JSON фильтра журнала (journalFilterSchema); ссылки на справочники без внешних ключей (инвариант 10). */
    filter: text('filter').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('saved_filters_owner_idx').on(t.userId, t.companyId)],
);
```

Run: `npm run db:generate`
Expected: новый файл `src/server/db/migrations/0005_<случайное имя>.sql` с `CREATE TABLE \`saved_filters\`` (внешние ключи на `users` с `ON DELETE cascade` и на `companies`) и `CREATE INDEX \`saved_filters_owner_idx\``; обновлены `meta/_journal.json` и `meta/0005_snapshot.json`. Других изменений в SQL быть не должно — если они есть, схема расходится с миграциями: остановитесь и сообщите.

- [ ] **Step 4: Implement the service and routes**

`src/shared/schemas/saved-filters.ts`:

```ts
import { z } from 'zod';
import { nameField } from '../text';
import { journalFilterSchema } from './journal';

export const SAVED_FILTER_NAME_MAX = 100;

/** Сохранённый фильтр журнала: JSON проверяется той же схемой, что строка запроса списка (§4.4, §6). */
export const savedFilterCreateSchema = z.object({ name: nameField(SAVED_FILTER_NAME_MAX), filter: journalFilterSchema });
export const savedFilterUpdateSchema = z.object({ name: nameField(SAVED_FILTER_NAME_MAX).optional(), filter: journalFilterSchema.optional() });
```

`src/server/modules/saved-filters/service.ts`:

```ts
import { and, asc, eq, isNull } from 'drizzle-orm';
import { journalFilterSchema, type JournalFilter } from '../../../shared/schemas/journal';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { accounts, categories, counterparties, projects, savedFilters, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';

export interface SavedFilterRow {
  id: number;
  companyId: number;
  name: string;
  /** Фильтр без недоступных ссылок — его можно сразу применять к журналу. */
  filter: JournalFilter;
  /** Сколько ссылок отброшено: элемент удалён, в архиве или из другой компании (инвариант 10). */
  unavailable: number;
  createdAt: string;
  updatedAt: string;
}

/** Личные сохранённые фильтры журнала (§4.4, §6): чужие не видны (404). Как и настройки пользователя, историю не пишут. */
export interface SavedFiltersService {
  list(userId: number, companyId: number): SavedFilterRow[];
  add(userId: number, companyId: number, input: { name: string; filter: JournalFilter }): SavedFilterRow;
  update(userId: number, companyId: number, id: number, input: { name?: string; filter?: JournalFilter }): SavedFilterRow;
  remove(userId: number, companyId: number, id: number): void;
}

/** Поля фильтра со ссылками на справочники. */
const REF_FIELDS = ['accountIds', 'categoryIds', 'projectIds', 'counterpartyIds', 'tagIds'] as const;
type RefField = (typeof REF_FIELDS)[number];
type Available = Record<RefField, Set<number>>;

export function createSavedFiltersService(d: { db: Db; now?: () => Date }): SavedFiltersService {
  const { db } = d;
  const now = d.now ?? (() => new Date());

  /** Доступные для фильтра элементы справочников компании — не в архиве. */
  function available(companyId: number): Available {
    const set = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));
    return {
      accountIds: set(db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), isNull(accounts.archivedAt))).all()),
      categoryIds: set(db.select({ id: categories.id }).from(categories).where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt))).all()),
      projectIds: set(db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt))).all()),
      counterpartyIds: set(
        db.select({ id: counterparties.id }).from(counterparties).where(and(eq(counterparties.companyId, companyId), isNull(counterparties.archivedAt))).all(),
      ),
      tagIds: set(db.select({ id: tags.id }).from(tags).where(and(eq(tags.companyId, companyId), isNull(tags.archivedAt))).all()),
    };
  }

  /** Хранимый JSON → фильтр без недоступных ссылок и их число. JSON читается той же схемой (устаревшие поля отбрасываются). */
  function toRow(r: typeof savedFilters.$inferSelect, avail: Available): SavedFilterRow {
    const parsed = journalFilterSchema.safeParse(JSON.parse(r.filter));
    const filter: JournalFilter = parsed.success ? { ...parsed.data } : {};
    let unavailable = 0;
    for (const field of REF_FIELDS) {
      const ids = filter[field];
      if (!ids) continue;
      const kept = ids.filter((x) => avail[field].has(x));
      unavailable += ids.length - kept.length;
      filter[field] = kept.length ? kept : undefined;
    }
    return { id: r.id, companyId: r.companyId, name: r.name, filter, unavailable, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  function requireOwn(userId: number, companyId: number, id: number): typeof savedFilters.$inferSelect {
    const row = db
      .select()
      .from(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, userId), eq(savedFilters.companyId, companyId)))
      .get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Фильтр не найден');
    return row;
  }

  return {
    list(userId, companyId) {
      requireCompany(db, companyId);
      const avail = available(companyId);
      return db
        .select()
        .from(savedFilters)
        .where(and(eq(savedFilters.userId, userId), eq(savedFilters.companyId, companyId)))
        .orderBy(asc(savedFilters.id))
        .all()
        .map((r) => toRow(r, avail));
    },

    add(userId, companyId, input) {
      requireCompany(db, companyId, { writable: true });
      const t = now().toISOString();
      const row = db
        .insert(savedFilters)
        .values({ userId, companyId, name: cleanName(input.name), filter: JSON.stringify(input.filter), createdAt: t, updatedAt: t })
        .returning()
        .get();
      return toRow(row, available(companyId));
    },

    update(userId, companyId, id, input) {
      requireCompany(db, companyId, { writable: true });
      requireOwn(userId, companyId, id);
      const row = db
        .update(savedFilters)
        .set({
          ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
          ...(input.filter !== undefined ? { filter: JSON.stringify(input.filter) } : {}),
          updatedAt: now().toISOString(),
        })
        .where(eq(savedFilters.id, id))
        .returning()
        .get();
      return toRow(row, available(companyId));
    },

    remove(userId, companyId, id) {
      requireCompany(db, companyId, { writable: true });
      requireOwn(userId, companyId, id);
      db.delete(savedFilters).where(eq(savedFilters.id, id)).run();
    },
  };
}
```

`src/server/modules/saved-filters/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { savedFilterCreateSchema, savedFilterUpdateSchema } from '../../../shared/schemas/saved-filters';
import { parseId } from '../../http/params';
import type { SavedFiltersService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/saved-filters';

export function registerSavedFiltersRoutes(app: FastifyInstance, deps: { savedFilters: SavedFiltersService }): void {
  const svc = deps.savedFilters;

  app.get<C>(BASE, async (req) => ({ savedFilters: svc.list(req.user!.id, parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = savedFilterCreateSchema.parse(req.body);
    return reply.status(201).send({ savedFilter: svc.add(req.user!.id, cid, body) });
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = savedFilterUpdateSchema.parse(req.body);
    return { savedFilter: svc.update(req.user!.id, cid, id, body) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    svc.remove(req.user!.id, parseId(req.params.cid), parseId(req.params.id));
    return reply.status(204).send();
  });
}
```

`src/server/app.ts` — импорты перед `import { registerSplitPresetsRoutes } from './modules/split-presets/routes';`:

```ts
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
```

и строкой перед `registerAttachmentsRoutes(app, { … });`:

```ts
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/saved-filters.test.ts tests/server/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/db/schema.ts src/server/db/migrations src/shared/schemas/saved-filters.ts src/server/modules/saved-filters src/server/app.ts tests/server/saved-filters.test.ts
git commit -m "feat: сохранённые фильтры журнала — только свои, недоступные ссылки отбрасываются (инвариант 10)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Выгрузка журнала в Excel

**Files:**
- Create: `src/server/http/content-disposition.ts`, `src/server/http/xlsx.ts`, `src/server/modules/operations/journal-export.ts`, `tests/server/journal-export.test.ts`
- Modify: `src/server/modules/attachments/routes.ts`, `src/server/modules/operations/journal.ts`, `src/server/modules/operations/routes.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `journalExportSchema`, `JournalExportQuery` (задача 1); `journalWhere`, `journalOrder`, `createJournal` (задачи 2–3); `LedgerBalances.balancesAfter` (задача 3); `zoneOffsetMs`, `todayInTimezone` (`src/shared/dates.ts`); `getCurrency` (`src/shared/currencies.ts`); `adm-zip`.
- Produces:
  - `contentDisposition(name: string): string` (`src/server/http/content-disposition.ts`) — перенесено из маршрутов вложений без изменений;
  - `XlsxCell`, `XlsxSheet`, `XLSX_MIME`, `xmlText(s)`, `columnName(index)`, `buildXlsx(sheet): Buffer` (`src/server/http/xlsx.ts`);
  - `ExportOperation`, `minorToDecimal(minor, minorUnits): string`, `excelDateTime(iso, timeZone): number`, `excelDate(date): number`, `journalSheet(ops, baseCurrency, timeZone): XlsxSheet` (`journal-export.ts`);
  - `JournalService.exportXlsx(companyId: number, query: JournalExportQuery): { fileName: string; data: Buffer }`, `JOURNAL_EXPORT_MAX = 50_000`;
  - `createJournal(d: { db: Db; balances: LedgerBalances; timezone: string; now?: () => Date; exportLimit?: number }): JournalService`;
  - `GET /api/v1/companies/:cid/operations/export.xlsx?…` → 200, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition` по RFC 8187 с именем «Операции {компания} {дата}.xlsx»; больше предела — 422 `EXPORT_LIMIT`.

- [ ] **Step 1: Write the failing test**

`tests/server/journal-export.test.ts`:

```ts
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createJournal } from '../../src/server/modules/operations/journal';
import { excelDate, excelDateTime, minorToDecimal } from '../../src/server/modules/operations/journal-export';
import { buildXlsx, columnName, xmlText } from '../../src/server/http/xlsx';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const exportUrl = (qs = '') => `${w.ops}/export.xlsx${qs ? `?${qs}` : ''}`;
const sheetOf = (body: Buffer) => new AdmZip(body).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');

describe('журнал: выгрузка в Excel (§7)', () => {
  it('вспомогательные: суммы — точной десятичной записью, даты Excel по часам Алматы, буквы столбцов, текст для XML', () => {
    expect(minorToDecimal(150050, 2)).toBe('1500.50');
    expect(minorToDecimal(-5, 2)).toBe('-0.05');
    expect(minorToDecimal(30, 2)).toBe('0.30');
    expect(minorToDecimal(1234, 0)).toBe('1234');
    expect(minorToDecimal(-1234567, 3)).toBe('-1234.567');
    expect(excelDate('2026-10-05')).toBe(46300);
    expect(excelDateTime('2026-10-05T05:00:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 10 / 24, 9); // 10:00 по Алматы
    expect(excelDateTime('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 0.5 / 24, 9); // 00:30 следующего дня
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(xmlText('<b>&"\u0007\uD800ok\u{1F389}')).toBe('&lt;b&gt;&amp;&quot;ok\u{1F389}');
  });

  it('файл XLSX: части пакета, заголовки, числа и даты с форматом, остатки, разбиения, экранирование; имя файла по RFC 8187 (Review Focus 5)', async () => {
    w = await opsWorld();
    await op({
      type: 'income',
      paidAt: '2026-10-05T05:00:00Z',
      amount: 150050,
      accrualDate: '2026-09-30',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      comment: '<b>Тест & "кавычки"</b>\u0007 \u{1F389}',
      lines: [
        { categoryId: w.income, projectId: w.project, amount: 100000 },
        { categoryId: w.income, projectId: w.project2, amount: 50050 },
      ],
    });
    await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100 });
    await op({ paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100 });

    const res = await w.h.req('GET', exportUrl());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="________ ___ 2026-10-06.xlsx"; filename*=UTF-8''${encodeURIComponent('Операции ТОО 2026-10-06.xlsx')}`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');

    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="Операции" sheetId="1" r:id="rId1"/>');
    expect(zip.getEntry('[Content_Types].xml')!.getData().toString('utf8')).toContain('/xl/worksheets/sheet1.xml');

    const xml = sheetOf(res.rawPayload);
    expect(xml.match(/<row /g)).toHaveLength(4); // заголовок + 3 операции, новые сверху
    expect(xml).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Дата</t></is></c>');
    expect(xml).toContain('<t xml:space="preserve">Сумма, KZT</t>');
    expect(xml).toContain('<t xml:space="preserve">Остаток зачисления</t>');
    // доход 1500,50 ₸: дата и время, суммы, остаток после (−475,12 + 1500,50), статья без повтора, проекты и тег, дата сделки
    expect(xml).toMatch(/<c r="A2" s="2"><v>46300\.41666/);
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Доход</t></is></c>');
    expect(xml).toContain('<c r="C2" s="5"><v>1500.50</v></c>');
    expect(xml).toContain('<c r="E2" s="5"><v>1500.50</v></c>');
    expect(xml).toContain('<c r="G2" s="5"><v>1025.38</v></c>');
    expect(xml).toContain('<c r="K2" t="inlineStr"><is><t xml:space="preserve">ИП Клиент</t></is></c>');
    expect(xml).toContain('<c r="L2" t="inlineStr"><is><t xml:space="preserve">Бар</t></is></c>');
    expect(xml).toContain('<c r="M2" t="inlineStr"><is><t xml:space="preserve">Клуб 1; Клуб 2</t></is></c>');
    expect(xml).toContain('<c r="N2" t="inlineStr"><is><t xml:space="preserve">Смена</t></is></c>');
    expect(xml).toContain('<t xml:space="preserve">&lt;b&gt;Тест &amp; &quot;кавычки&quot;&lt;/b&gt; \u{1F389}</t>');
    expect(xml).toContain('<c r="P2" s="3"><v>46295</v></c>');
    expect(xml).not.toContain('\u0007');
    // перевод: без знака, счёт и сумма зачисления, оба остатка
    expect(xml).toContain('<c r="C3" s="5"><v>475.12</v></c>');
    expect(xml).toContain('<c r="G3" s="5"><v>-475.12</v></c>');
    expect(xml).toContain('<c r="H3" t="inlineStr"><is><t xml:space="preserve">Валютный</t></is></c>');
    expect(xml).toContain('<c r="I3" s="5"><v>1.00</v></c>');
    expect(xml).toContain('<c r="J3" s="5"><v>0.00</v></c>');
    // расход в USD: минус в валюте счёта и в базовой
    expect(xml).toContain('<c r="C4" s="5"><v>-1.00</v></c>');
    expect(xml).toContain('<c r="D4" t="inlineStr"><is><t xml:space="preserve">USD</t></is></c>');
    expect(xml).toContain('<c r="E4" s="5"><v>-475.12</v></c>');
    expect(xml).not.toContain('<c r="H4"'); // пустые ячейки не пишутся
  });

  it('текст, похожий на формулу (=, +, -, @, табуляция, CR в начале), — строка со стилем quotePrefix; формул в книге нет (Review Focus 5)', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', comment: '=HYPERLINK("http://evil","x")' });
    await op({ paidAt: '2026-10-03T10:00:00Z', comment: '+7 777 123' });
    await op({ paidAt: '2026-10-04T10:00:00Z', comment: '@SUM(A1)' });
    await op({ paidAt: '2026-10-05T10:00:00Z', comment: '-скидка' });
    await op({ paidAt: '2026-10-05T11:00:00Z', comment: 'обычный' });
    const zip = new AdmZip((await w.h.req('GET', exportUrl())).rawPayload);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('<c r="O2" t="inlineStr"><is><t xml:space="preserve">обычный</t></is></c>');
    expect(xml).toContain('<c r="O3" t="inlineStr" s="7"><is><t xml:space="preserve">-скидка</t></is></c>');
    expect(xml).toContain('<c r="O4" t="inlineStr" s="7"><is><t xml:space="preserve">@SUM(A1)</t></is></c>');
    expect(xml).toContain('<c r="O5" t="inlineStr" s="7"><is><t xml:space="preserve">+7 777 123</t></is></c>');
    expect(xml).toContain('<c r="O6" t="inlineStr" s="7"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)</t></is></c>');
    // стиль 7 — quotePrefix; книга с bookViews (без неё старые версии Excel ругаются на файл)
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('<cellXfs count="8">');
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs>');
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<bookViews><workbookView/></bookViews><sheets>');

    // табуляция и CR в начале (комментарий операции их обрезает — проверяем писатель напрямую)
    const raw = buildXlsx({ name: 'Лист', columns: [{ header: 'A', width: 5 }], rows: [[{ kind: 'text', value: '\t=1' }], [{ kind: 'text', value: '\r=2' }], [{ kind: 'text', value: 'a=1' }]] });
    const sheet = new AdmZip(raw).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(sheet).toContain('<c r="A2" t="inlineStr" s="7">');
    expect(sheet).toContain('<c r="A3" t="inlineStr" s="7">');
    expect(sheet).toContain('<c r="A4" t="inlineStr"><is>');
  });

  it('тот же фильтр, что у журнала, и сортировка; чужая компания — 404; ошибка фильтра — 400', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', amount: 300 });
    await op({ type: 'income', paidAt: '2026-10-03T10:00:00Z', amount: 200 });
    await op({ paidAt: '2026-10-04T10:00:00Z', amount: 100 });
    const xml = sheetOf((await w.h.req('GET', exportUrl('types=expense&sort=amount&order=asc'))).rawPayload);
    expect(xml.match(/<row /g)).toHaveLength(3);
    expect(xml).toContain('<c r="C2" s="5"><v>-1.00</v></c>');
    expect(xml).toContain('<c r="C3" s="5"><v>-3.00</v></c>');
    expect((await w.h.req('GET', '/api/v1/companies/999999/operations/export.xlsx')).statusCode).toBe(404);
    expect((await w.h.req('GET', exportUrl('from=2026-10-05&to=2026-10-01'))).json().error.code).toBe('VALIDATION');
  });

  it('больше предела выгрузки — 422 EXPORT_LIMIT, пустой фильтр — книга только с заголовком', async () => {
    w = await opsWorld();
    for (const day of ['02', '03', '04']) await op({ paidAt: `2026-10-${day}T10:00:00Z` });
    const db = w.h.t.db;
    const journal = createJournal({ db, balances: createLedgerBalances(db), timezone: 'Asia/Almaty', exportLimit: 2 });
    const q = { sort: 'date', order: 'desc' } as const;
    expect(() => journal.exportXlsx(w.cid, q)).toThrow('Больше 2 операций — сузьте период или фильтр');
    expect(sheetOf(journal.exportXlsx(w.cid, { ...q, from: '2026-10-04' }).data).match(/<row /g)).toHaveLength(2);
    expect(sheetOf(journal.exportXlsx(w.cid, { ...q, q: 'нет такого' }).data).match(/<row /g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/journal-export.test.ts`
Expected: FAIL — нет модулей `journal-export` и `http/xlsx`.

- [ ] **Step 3: Move Content-Disposition into a shared helper**

`src/server/http/content-disposition.ts`:

```ts
/** Content-Disposition по RFC 6266/8187: ASCII-запасное имя и полное имя в UTF-8 (кодируются и символы '()*). */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
```

`src/server/modules/attachments/routes.ts` — удалите локальную функцию `contentDisposition` вместе с её комментарием (блок от `/** Content-Disposition по RFC 6266/8187` до закрывающей `}`) и добавьте импорт после `import { AppError } from '../../errors';`:

```ts
import { contentDisposition } from '../../http/content-disposition';
```

- [ ] **Step 4: Implement the XLSX writer**

`src/server/http/xlsx.ts` (создайте инструментом записи файлов — регулярные выражения содержат `\uXXXX`):

```ts
import AdmZip from 'adm-zip';

/**
 * Ячейка листа:
 * - text — строка (inline string: без общей таблицы строк, формулой не считается);
 * - number — десятичная запись без экспоненты («-1500.50») и число знаков после запятой для формата;
 * - datetime / date — дата Excel: дни от 30.12.1899, у datetime — с долей суток.
 */
export type XlsxCell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string; decimals: number }
  | { kind: 'datetime'; value: number }
  | { kind: 'date'; value: number }
  | null;

export interface XlsxSheet {
  /** Имя листа: до 31 символа, без []:*?/\. */
  name: string;
  columns: { header: string; width: number }[];
  rows: XlsxCell[][];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Индексы стилей в cellXfs (styles.xml ниже). */
const STYLE = { header: 1, datetime: 2, date: 3, int: 4, dec2: 5, dec3: 6, quoted: 7 } as const;

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CONTENT_TYPES = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
const ROOT_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
// 164 — дата и время, 165 — дата, 166 — три знака после запятой; 3 и 4 — встроенные «# ##0» и «# ##0,00»;
// последний xf — quotePrefix: Excel показывает текст как есть и не превращает его в формулу при правке ячейки
const STYLES = `<styleSheet xmlns="${NS_MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Символы, недопустимые в XML 1.0: управляющие (кроме табуляции и переводов строки), одиночные суррогаты, U+FFFE и U+FFFF. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Текст для XML: недопустимые символы удаляются, & < > " экранируются. */
export function xmlText(s: string): string {
  return s.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Номер столбца с нуля → буквы Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Начало текста, которое Excel и LibreOffice при правке или импорте принимают за формулу. */
const FORMULA_START = /^[=+\-@\t\r]/;

const numberStyle = (decimals: number) => (decimals === 0 ? STYLE.int : decimals === 2 ? STYLE.dec2 : decimals === 3 ? STYLE.dec3 : 0);

function cellXml(ref: string, cell: XlsxCell, style?: number): string {
  if (cell === null) return '';
  switch (cell.kind) {
    case 'text': {
      // формул в листе нет (<f> не пишется); текст, похожий на формулу, — со стилем quotePrefix
      const value = xmlText(cell.value);
      const s = style ?? (FORMULA_START.test(value) ? STYLE.quoted : 0);
      return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${value}</t></is></c>`;
    }
    case 'number':
      return `<c r="${ref}" s="${numberStyle(cell.decimals)}"><v>${cell.value}</v></c>`;
    case 'datetime':
      return `<c r="${ref}" s="${STYLE.datetime}"><v>${cell.value}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="${STYLE.date}"><v>${cell.value}</v></c>`;
  }
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const header = `<row r="1">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}1`, { kind: 'text', value: c.header }, STYLE.header)).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${row.map((cell, i) => cellXml(`${columnName(i)}${r + 2}`, cell)).join('')}</row>`);
  // строка заголовков закреплена
  return `<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body.join('')}</sheetData></worksheet>`;
}

/** Минимальная книга XLSX с одним листом (ECMA-376): строки — inline, числа и даты — с форматом. */
export function buildXlsx(sheet: XlsxSheet): Buffer {
  const zip = new AdmZip();
  const add = (name: string, xml: string) => zip.addFile(name, Buffer.from(HEAD + xml, 'utf8'));
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', ROOT_RELS);
  add('xl/workbook.xml', `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${xmlText(sheet.name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  add('xl/styles.xml', STYLES);
  add('xl/worksheets/sheet1.xml', sheetXml(sheet));
  return zip.toBuffer();
}
```

- [ ] **Step 5: Implement the journal sheet and the export method**

`src/server/modules/operations/journal-export.ts`:

```ts
import { getCurrency } from '../../../shared/currencies';
import { zoneOffsetMs } from '../../../shared/dates';
import type { XlsxCell, XlsxSheet } from '../../http/xlsx';

/** Строка выгрузки: операция с названиями справочников (§7, колонки журнала). */
export interface ExportOperation {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  paidAt: string;
  accrualDate: string | null;
  amount: number;
  baseAmount: number;
  currency: string;
  accountName: string;
  /** Остаток счёта после операции (§4.7); null — не посчитан. */
  balanceAfter: number | null;
  toAccountName: string | null;
  toAmount: number | null;
  toCurrency: string | null;
  toBalanceAfter: number | null;
  counterpartyName: string | null;
  /** Статьи и проекты строк по порядку, без повторов. */
  categories: string[];
  projects: string[];
  tags: string[];
  comment: string | null;
}

const TYPE_LABEL = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' } as const;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Минимальные единицы → десятичная запись без округления и экспоненты: (-150050, 2) → «-1500.50». */
export function minorToDecimal(minor: number, minorUnits: number): string {
  const abs = String(Math.abs(minor)).padStart(minorUnits + 1, '0');
  const int = minorUnits > 0 ? abs.slice(0, -minorUnits) : abs;
  const frac = minorUnits > 0 ? `.${abs.slice(-minorUnits)}` : '';
  return `${minor < 0 ? '-' : ''}${int}${frac}`;
}

/** Момент → дата и время Excel по часам APP_TIMEZONE (дни от 30.12.1899 с долей суток). */
export function excelDateTime(iso: string, timeZone: string): number {
  const t = Date.parse(iso);
  return (t + zoneOffsetMs(t, timeZone) - EXCEL_EPOCH) / DAY_MS;
}

/** Календарная дата `YYYY-MM-DD` → дата Excel. */
export function excelDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY_MS;
}

const text = (value: string | null | undefined): XlsxCell => (value ? { kind: 'text', value } : null);
const money = (minor: number | null, currency: string | null): XlsxCell => {
  if (minor === null || currency === null) return null;
  const units = getCurrency(currency).minorUnits;
  return { kind: 'number', value: minorToDecimal(minor, units), decimals: units };
};

/**
 * Лист «Операции»: одна строка на операцию, как в журнале. Сумма со знаком (расход — минус, перевод — без знака),
 * в валюте счёта и в базовой валюте; у перевода — счёт, сумма и остаток зачисления. Разбитая операция —
 * статьи и проекты строк через «; ».
 */
export function journalSheet(ops: ExportOperation[], baseCurrency: string, timeZone: string): XlsxSheet {
  return {
    name: 'Операции',
    columns: [
      { header: 'Дата', width: 17 },
      { header: 'Тип', width: 10 },
      { header: 'Сумма', width: 15 },
      { header: 'Валюта', width: 8 },
      { header: `Сумма, ${baseCurrency}`, width: 15 },
      { header: 'Счёт', width: 22 },
      { header: 'Остаток', width: 15 },
      { header: 'Счёт зачисления', width: 22 },
      { header: 'Сумма зачисления', width: 15 },
      { header: 'Остаток зачисления', width: 15 },
      { header: 'Контрагент', width: 24 },
      { header: 'Статья', width: 28 },
      { header: 'Проект', width: 20 },
      { header: 'Теги', width: 16 },
      { header: 'Комментарий', width: 40 },
      { header: 'Дата сделки', width: 12 },
    ],
    rows: ops.map((o) => {
      const sign = o.type === 'expense' ? -1 : 1;
      return [
        { kind: 'datetime', value: excelDateTime(o.paidAt, timeZone) },
        text(TYPE_LABEL[o.type]),
        money(sign * o.amount, o.currency),
        text(o.currency),
        money(sign * o.baseAmount, baseCurrency),
        text(o.accountName),
        money(o.balanceAfter, o.currency),
        text(o.toAccountName),
        money(o.toAmount, o.toCurrency),
        money(o.toBalanceAfter, o.toCurrency),
        text(o.counterpartyName),
        text(o.categories.join('; ')),
        text(o.projects.join('; ')),
        text(o.tags.join('; ')),
        text(o.comment),
        o.accrualDate ? { kind: 'date', value: excelDate(o.accrualDate) } : null,
      ];
    }),
  };
}
```

`src/server/modules/operations/journal.ts`:

1. Импорты. Замените

```ts
import { addDays, startOfDayUtc } from '../../../shared/dates';
import type { JournalFilter, JournalOrder, JournalQuery, JournalSort } from '../../../shared/schemas/journal';
```

на

```ts
import { addDays, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import type { JournalExportQuery, JournalFilter, JournalOrder, JournalQuery, JournalSort } from '../../../shared/schemas/journal';
```

после `import { AppError } from '../../errors';` добавьте

```ts
import { buildXlsx } from '../../http/xlsx';
```

и перед `import type { OperationDto, OperationLineDto } from './service';` добавьте

```ts
import { journalSheet, type ExportOperation } from './journal-export';
```

2. Интерфейс сервиса. Замените

```ts
  list(companyId: number, query: JournalQuery): JournalPage;
}
```

на

```ts
  list(companyId: number, query: JournalQuery): JournalPage;
  /** Выгрузка в Excel по тому же фильтру, без страниц (§7). Больше exportLimit операций — 422 EXPORT_LIMIT. */
  exportXlsx(companyId: number, query: JournalExportQuery): { fileName: string; data: Buffer };
}

/** Не больше операций в одной выгрузке: книга собирается в памяти. */
export const JOURNAL_EXPORT_MAX = 50_000;
```

3. Зависимости. Замените

```ts
export function createJournal(d: { db: Db; balances: LedgerBalances; timezone: string }): JournalService {
  const { db, balances, timezone } = d;
```

на

```ts
export function createJournal(d: { db: Db; balances: LedgerBalances; timezone: string; now?: () => Date; exportLimit?: number }): JournalService {
  const { db, balances, timezone } = d;
  const now = d.now ?? (() => new Date());
  const exportLimit = d.exportLimit ?? JOURNAL_EXPORT_MAX;
```

4. Метод выгрузки — в возвращаемый объект после метода `list` (после его закрывающего `},`):

```ts
    exportXlsx(companyId, q) {
      const company = requireCompany(db, companyId);
      const where = journalWhere(companyId, q, timezone);
      const rows = db.all<{
        id: number;
        type: ExportOperation['type'];
        paidAt: string;
        accrualDate: string | null;
        amount: number;
        baseAmount: number;
        comment: string | null;
        accountId: number;
        accountName: string;
        currency: string;
        toAccountId: number | null;
        toAccountName: string | null;
        toCurrency: string | null;
        toAmount: number | null;
        counterpartyName: string | null;
      }>(sql`
        SELECT o.id AS id, o.type AS type, o.paid_at AS paidAt, o.accrual_date AS accrualDate, o.amount AS amount,
               o.base_amount AS baseAmount, o.comment AS comment, o.account_id AS accountId, a.name AS accountName,
               a.currency AS currency, o.to_account_id AS toAccountId, ta.name AS toAccountName, ta.currency AS toCurrency,
               o.to_amount AS toAmount, cp.name AS counterpartyName
          FROM operations o
          JOIN accounts a ON a.id = o.account_id
          LEFT JOIN accounts ta ON ta.id = o.to_account_id
          LEFT JOIN counterparties cp ON cp.id = o.counterparty_id
         WHERE ${where}
         ORDER BY ${journalOrder(q.sort, q.order)}
         LIMIT ${exportLimit + 1}`);
      if (rows.length > exportLimit) {
        throw new AppError(422, 'EXPORT_LIMIT', `Больше ${exportLimit.toLocaleString('ru-RU')} операций — сузьте период или фильтр`);
      }

      // строки и теги — одним запросом на всю выгрузку (тот же фильтр подзапросом, без длинных списков id)
      const lines = new Map<number, { categories: string[]; projects: string[] }>();
      for (const l of db.all<{ operationId: number; category: string | null; project: string | null }>(sql`
        SELECT l.operation_id AS operationId, c.name AS category, p.name AS project
          FROM operation_lines l
          LEFT JOIN categories c ON c.id = l.category_id
          LEFT JOIN projects p ON p.id = l.project_id
         WHERE l.operation_id IN (SELECT o.id FROM operations o WHERE ${where})
         ORDER BY l.operation_id, l.position`)) {
        const x = lines.get(l.operationId) ?? { categories: [], projects: [] };
        if (l.category && !x.categories.includes(l.category)) x.categories.push(l.category);
        if (l.project && !x.projects.includes(l.project)) x.projects.push(l.project);
        lines.set(l.operationId, x);
      }
      const tagNames = new Map<number, string[]>();
      for (const t of db.all<{ operationId: number; name: string }>(sql`
        SELECT ot.operation_id AS operationId, t.name AS name
          FROM operation_tags ot JOIN tags t ON t.id = ot.tag_id
         WHERE ot.operation_id IN (SELECT o.id FROM operations o WHERE ${where})
         ORDER BY t.order_index, t.id`)) {
        tagNames.set(t.operationId, [...(tagNames.get(t.operationId) ?? []), t.name]);
      }
      const after = balances.balancesAfter(companyId);

      const ops: ExportOperation[] = rows.map((r) => ({
        ...r,
        balanceAfter: after.get(`${r.id}:${r.accountId}`) ?? null,
        toBalanceAfter: r.toAccountId === null ? null : (after.get(`${r.id}:${r.toAccountId}`) ?? null),
        categories: lines.get(r.id)?.categories ?? [],
        projects: lines.get(r.id)?.projects ?? [],
        tags: tagNames.get(r.id) ?? [],
      }));
      // имя файла без символов, запрещённых в Windows
      const safeName = company.name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
      return {
        fileName: `Операции ${safeName} ${todayInTimezone(timezone, now())}.xlsx`,
        data: buildXlsx(journalSheet(ops, company.baseCurrency, timezone)),
      };
    },
```

`src/server/modules/operations/routes.ts` — замените файл целиком:

```ts
import type { FastifyInstance } from 'fastify';
import { journalExportSchema, journalQuerySchema } from '../../../shared/schemas/journal';
import { operationBulkSchema, operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { contentDisposition } from '../../http/content-disposition';
import { parseId } from '../../http/params';
import { XLSX_MIME } from '../../http/xlsx';
import type { BulkService } from './bulk';
import type { JournalService } from './journal';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(
  app: FastifyInstance,
  deps: { operations: OperationsService; journal: JournalService; bulk: BulkService },
): void {
  const { operations, journal, bulk } = deps;

  // журнал: фильтр и курсор в строке запроса (§6)
  app.get<C>(BASE, async (req) => journal.list(parseId(req.params.cid), journalQuerySchema.parse(req.query)));

  // выгрузка по тому же фильтру; статический сегмент export.xlsx важнее параметра :id
  app.get<C>(`${BASE}/export.xlsx`, async (req, reply) => {
    const { fileName, data } = journal.exportXlsx(parseId(req.params.cid), journalExportSchema.parse(req.query));
    reply.header('Content-Type', XLSX_MIME);
    reply.header('Content-Disposition', contentDisposition(fileName));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(data);
  });

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.post<C>(`${BASE}/bulk`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = operationBulkSchema.parse(req.body);
    return bulk.run(cid, body, req.user!.id);
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/app.ts` — в вызове `registerOperationsRoutes` замените `journal: createJournal({ db, balances, timezone: config.timezone }),` на:

```ts
    journal: createJournal({ db, balances, timezone: config.timezone, now }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/journal-export.test.ts tests/server/attachments.test.ts tests/server/journal-list.test.ts`
Expected: PASS (тест вложений проверяет, что перенос `contentDisposition` ничего не изменил).

- [ ] **Step 7: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/http src/server/modules/attachments/routes.ts src/server/modules/operations/journal.ts src/server/modules/operations/journal-export.ts src/server/modules/operations/routes.ts src/server/app.ts tests/server/journal-export.test.ts
git commit -m "feat: выгрузка журнала в Excel по текущему фильтру (XLSX через adm-zip)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Замер §12, проверка на демо-наборе, README

**Files:**
- Create: `scripts/bench-journal.ts`, `tests/server/journal-demo.test.ts`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Consumes: `seedDemo` (`scripts/lib/demo.ts`), `buildApp`, `loadConfig`, `openDb`, `runMigrations`, `seedCurrencies`, `createUsersService`, `createAuditService`; `createApi` (`tests/helpers/api.ts`); `createLedgerBalances`; маршруты задач 2–6.
- Produces: `npm run bench:journal [-- <папка данных>]` — p50/p95 сценариев и вердикт по бюджету 300 мс (код выхода 1 при превышении); тест корректности журнала на демо-наборе из 300 операций.

- [ ] **Step 1: Write the correctness test**

`tests/server/journal-demo.test.ts`:

```ts
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDemo } from '../../scripts/lib/demo';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness | undefined;
afterEach(async () => {
  await h?.t.cleanup();
  h = undefined;
});

const NOW = '2026-10-06T12:00:00.000Z';

interface Item {
  id: number;
  accountId: number;
  toAccountId: number | null;
  balanceAfter: number | null;
  toBalanceAfter: number | null;
}

describe('журнал на демо-наборе (§10, §12)', () => {
  it('курсор проходит все операции ровно по разу в порядке (paidAt, id); остатки после операции = независимый пересчёт в JS; выгрузка — все строки', async () => {
    h = await createApi(NOW);
    seedDemo({ db: h.t.db, timezone: 'Asia/Almaty', now: new Date(NOW), operations: 300 });
    const s = h.t.sqlite;
    const cid = (s.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get() as { id: number }).id;
    const ops = `/api/v1/companies/${cid}/operations`;

    // все страницы журнала
    const seen: Item[] = [];
    let cursor: string | null = null;
    do {
      const res = await h.req('GET', `${ops}?limit=37${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode, res.body).toBe(200);
      const page = res.json() as { items: Item[]; nextCursor: string | null };
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const expected = s
      .prepare('SELECT id FROM operations WHERE company_id = ? AND deleted_at IS NULL ORDER BY paid_at DESC, id DESC')
      .all(cid) as { id: number }[];
    expect(expected.length).toBeGreaterThan(100);
    expect(seen.map((i) => i.id)).toEqual(expected.map((r) => r.id));

    // независимый пересчёт остатков: история каждого счёта по (paidAt, id) от стартового остатка
    const balance = new Map(
      (s.prepare('SELECT id, starting_balance b FROM accounts WHERE company_id = ?').all(cid) as { id: number; b: number }[]).map((a) => [a.id, a.b]),
    );
    const rows = s
      .prepare(
        "SELECT id, type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE company_id = ? AND deleted_at IS NULL AND status = 'actual' ORDER BY paid_at, id",
      )
      .all(cid) as { id: number; type: string; a: number; amount: number; t: number | null; ta: number | null }[];
    const after = new Map<string, number>();
    for (const o of rows) {
      balance.set(o.a, balance.get(o.a)! + (o.type === 'income' ? o.amount : -o.amount));
      after.set(`${o.id}:${o.a}`, balance.get(o.a)!);
      if (o.type === 'transfer') {
        balance.set(o.t!, balance.get(o.t!)! + o.ta!);
        after.set(`${o.id}:${o.t}`, balance.get(o.t!)!);
      }
    }
    for (const i of seen) {
      expect(i.balanceAfter).toBe(after.get(`${i.id}:${i.accountId}`));
      expect(i.toBalanceAfter).toBe(i.toAccountId === null ? null : after.get(`${i.id}:${i.toAccountId}`));
    }
    // последний остаток счёта = его баланс (§4.7)
    for (const b of createLedgerBalances(h.t.db).companyBalances(cid)) expect(b.balance).toBe(balance.get(b.accountId));

    // выгрузка всей компании: заголовок + все операции
    const xlsx = await h.req('GET', `${ops}/export.xlsx`);
    expect(xlsx.statusCode).toBe(200);
    const sheet = new AdmZip(xlsx.rawPayload).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(sheet.match(/<row /g)).toHaveLength(expected.length + 1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/server/journal-demo.test.ts`
Expected: PASS (задачи 2–6 уже реализованы; тест страхует их вместе на реалистичных данных — разбиения, переводы между валютами, удалённые операции). Если тест падает, ошибка в задачах 2–6: найдите причину, а не правьте тест.

- [ ] **Step 3: Write the benchmark script**

`scripts/bench-journal.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { seedDemo } from './lib/demo';

// Замер §12 на демо-наборе §10: p95 первой страницы журнала, фильтра и поиска (бюджет 300 мс на сервере),
// выгрузки в Excel, балансов и сводки. Запросы идут через app.inject — сервер без сети.
// npm run bench:journal [-- <папка данных>]; по умолчанию <tmpdir>/finmap-bench-journal — набор заливается
// один раз (около 45 с) и переиспользуется следующими запусками. Пользователь bench — только в демо-копии.

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DEMO_COMPANY = 'ТОО «Демо Клубы»';
const BUDGET_MS = 300;
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };

const dir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'finmap-bench-journal'));
fs.mkdirSync(dir, { recursive: true });
const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
seedCurrencies(db);

const one = <T>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const companies = one<{ n: number }>('SELECT COUNT(*) n FROM companies')!.n;
if (companies > 0 && !one('SELECT id FROM companies WHERE name = ?', DEMO_COMPANY)) {
  console.error(`В ${config.dbPath} не демо-набор — укажите пустую папку или копию после npm run seed:demo.`);
  process.exit(1);
}
if (!one('SELECT id FROM users WHERE login = ?', LOGIN)) {
  await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
}
if (companies === 0) {
  console.log(`Заливаю демо-набор в ${dir} (около 45 с)…`);
  const started = Date.now();
  seedDemo({ db, timezone: config.timezone, now: NOW });
  console.log(`Готово за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
}

const cid = one<{ id: number }>('SELECT id FROM companies WHERE name = ?', DEMO_COMPANY)!.id;
const premises = one<{ id: number }>("SELECT id FROM categories WHERE company_id = ? AND template_ref = 'computer-club:premises'", cid)!.id;
const opCount = one<{ n: number }>('SELECT COUNT(*) n FROM operations WHERE company_id = ? AND deleted_at IS NULL', cid)!.n;

const app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
await app.ready();

/** Новая сессия на каждый сценарий: лимит API — 300 запросов в минуту на сессию (§8). */
async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (res.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${res.statusCode} ${res.body}`);
  return `sid=${sid.value}`;
}

interface Result {
  name: string;
  p50: number;
  p95: number;
  budget: boolean;
}

async function measure(name: string, url: string, runs: number, budget: boolean): Promise<Result> {
  const cookie = await login();
  const call = async () => {
    const t = performance.now();
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    const ms = performance.now() - t;
    if (res.statusCode !== 200) throw new Error(`${name}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    return ms;
  };
  for (let i = 0; i < 3; i++) await call(); // прогрев
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await call());
  return summarize(name, times, budget);
}

function summarize(name: string, times: number[], budget: boolean): Result {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { name, p50: at(0.5), p95: at(0.95), budget };
}

const ops = `/api/v1/companies/${cid}/operations`;

/** Массовое действие: время запроса; все переданные операции должны оказаться в changed. */
async function bulk(cookie: string, body: object, expectChanged: number): Promise<number> {
  const t = performance.now();
  const res = await app.inject({ method: 'POST', url: `${ops}/bulk`, headers: { ...HEADERS, cookie }, payload: body });
  const ms = performance.now() - t;
  const changed = res.statusCode === 200 ? (res.json() as { changed: number[] }).changed.length : -1;
  if (changed !== expectChanged) throw new Error(`Массовое действие: ${res.statusCode}, изменено ${changed} из ${expectChanged}: ${res.body.slice(0, 200)}`);
  return ms;
}

const results = [
  await measure('Первая страница журнала', `${ops}?limit=50`, 50, true),
  await measure('Фильтр: «Помещение» с дочерними, расходы, 2026 год', `${ops}?categoryIds=${premises}&types=expense&from=2026-01-01&to=2026-12-31`, 50, true),
  await measure('Фильтр: от 50 000 ₸, по сумме', `${ops}?amountMin=5000000&sort=amount`, 50, true),
  await measure('Поиск «аренда»', `${ops}?q=${encodeURIComponent('аренда')}`, 50, true),
  await measure('Поиск без совпадений', `${ops}?q=${encodeURIComponent('нет такого текста')}`, 50, true),
  await measure(`Выгрузка в Excel (${opCount} операций)`, `${ops}/export.xlsx`, 10, false),
  await measure('Балансы счетов', `/api/v1/companies/${cid}/balances`, 50, false),
  await measure('Сводка компаний', '/api/v1/companies/summary', 50, false),
];

// Массовые действия на BULK_MAX = 500 операций — без бюджета §12, но запрос синхронный и держит сервер всё это время.
// Замер меняет демо-копию: контрагент чередуется между двумя, каждое удаление сразу отменяется восстановлением.
const bulkIds = (
  sqlite
    .prepare("SELECT id FROM operations WHERE company_id = ? AND deleted_at IS NULL AND type <> 'transfer' ORDER BY id DESC LIMIT 500")
    .all(cid) as { id: number }[]
).map((r) => r.id);
const cps = (sqlite.prepare('SELECT id FROM counterparties WHERE company_id = ? AND archived_at IS NULL ORDER BY id LIMIT 2').all(cid) as { id: number }[]).map(
  (r) => r.id,
);
const bulkCookie = await login();
const setTimes: number[] = [];
const deleteTimes: number[] = [];
const restoreTimes: number[] = [];
for (let i = 0; i < 6; i++) setTimes.push(await bulk(bulkCookie, { action: 'setCounterparty', counterpartyId: cps[i % 2], ids: bulkIds }, bulkIds.length));
for (let i = 0; i < 3; i++) {
  deleteTimes.push(await bulk(bulkCookie, { action: 'delete', ids: bulkIds }, bulkIds.length));
  restoreTimes.push(await bulk(bulkCookie, { action: 'restore', ids: bulkIds }, bulkIds.length));
}
results.push(
  summarize(`Массово: контрагент, ${bulkIds.length} операций`, setTimes, false),
  summarize(`Массово: удалить ${bulkIds.length} операций`, deleteTimes, false),
  summarize(`Массово: восстановить ${bulkIds.length} операций`, restoreTimes, false),
);

console.log(`\nДемо-набор: ${dir}; компания «${DEMO_COMPANY}», операций: ${opCount}. Бюджет §12 — ${BUDGET_MS} мс (p95).\n`);
for (const r of results) {
  const verdict = r.budget ? (r.p95 < BUDGET_MS ? 'OK' : 'ПРЕВЫШЕН') : 'без бюджета';
  console.log(`${r.name.padEnd(54)} p50 ${r.p50.toFixed(1).padStart(7)} мс   p95 ${r.p95.toFixed(1).padStart(7)} мс   ${verdict}`);
}
await app.close();
sqlite.close();
if (results.some((r) => r.budget && r.p95 >= BUDGET_MS)) process.exitCode = 1;
```

`package.json` — в `scripts` после строки `"seed:demo": …`:

```json
    "bench:journal": "tsx scripts/bench-journal.ts",
```

- [ ] **Step 4: Run the benchmark**

Run: `npm run bench:journal`
Expected: первый запуск заливает демо-набор во временную папку (около 45 с); затем таблица из 11 строк. У пяти строк с бюджетом — «OK» (при планировании p95: первая страница 32 мс, фильтры 36–40 мс, поиск 47–68 мс; выгрузка около 450 мс; массовые действия на 500 операций, p50: «Контрагент» около 2,2 с, удаление около 1,4 с, восстановление около 1,9 с — без бюджета). Повторный запуск не заливает набор заново.

Если какая-то строка с бюджетом — «ПРЕВЫШЕН», не подбирайте индексы наугад: остановитесь и сообщите контролёру результаты и `EXPLAIN QUERY PLAN` медленного запроса.

- [ ] **Step 5: Update README**

`README.md`:

1. Замените `Сделаны шаги 1–4 этапа 1 (§11 спецификации):` на:

```markdown
Сделаны шаги 1–4 этапа 1 и серверная часть шага 5 (§11 спецификации):
```

2. После строки `  - валюту счёта и базовую валюту компании нельзя сменить, если уже есть операции.` добавьте:

```markdown
- **Журнал, сервер (шаг 5):**
  - список операций с фильтром, поиском без учёта регистра и «ё», сортировкой по дате и сумме и постраничной загрузкой;
  - остаток счёта после каждой операции;
  - массовые действия: статья, проект, контрагент, удаление и восстановление;
  - личные сохранённые фильтры;
  - выгрузка в Excel по текущему фильтру.
```

3. Замените `Пока нет (следующие шаги): журнал и форма операции в интерфейсе, отчёты, мобильная версия и PWA.` на:

```markdown
Пока нет (следующие шаги): экран журнала и форма операции, отчёты, мобильная версия и PWA.
```

4. В таблицу «Разработка» после строки `npm run seed:demo …` добавьте:

```markdown
| `npm run bench:journal -- [папка]` | Замер скорости журнала на демо-наборе (§12): первая страница, фильтр и поиск должны отвечать на сервере быстрее 300 мс (p95). Набор заливается во временную папку один раз, около 45 с |
```

- [ ] **Step 6: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (e2e — проверка, что перенос `contentDisposition` и новые маршруты ничего не задели в интерфейсе).

```bash
git add scripts/bench-journal.ts package.json README.md tests/server/journal-demo.test.ts
git commit -m "feat: замер журнала на демо-наборе (bench:journal) и проверка курсора, остатков и выгрузки

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §6 Фильтр журнала: период по дате в APP_TIMEZONE, `amountMin/Max` по `baseAmount`, `types`, `accountIds` (исходный или целевой), `counterpartyIds`, `tagIds` | Tasks 1, 2 |
| §6 `categoryIds`/`projectIds` — любая строка, родитель включает дочерние | Task 2 |
| §6 `withoutCategory`, `withoutProject`, `withoutCounterparty` | Task 2 |
| §6 сортировка `date`/`amount`, `asc`/`desc`, курсор, `limit` 50/200 | Tasks 1, 2 |
| §6.1 поиск `ulower`, экранирование `\ % _`, кириллица и «ё» | Task 2 |
| §4.7 остаток после операции — окно по полной истории, оба счёта перевода | Tasks 3, 7 |
| §6 `POST …/bulk`, §7 массовые действия: правила пропуска, без проверки версии, новая версия и история, итог с причинами | Task 4 |
| §4.6 инварианты 3, 5, 7, 11 в массовых действиях; архивная компания | Task 4 |
| §4.4 `saved_filters`, §6 «Сохранённые фильтры» (только свои), инвариант 10 | Task 5 |
| §6 `GET …/export.xlsx`, §7 «экспорт в Excel по текущему фильтру» | Task 6 |
| §10 демо-набор, §12 бюджет 300 мс (p95) | Task 7 (`bench:journal`, тест на демо-наборе) |
| Итоги 4a, замечание 5 (устаревшие комментарии заглушек); 4a-6 и 4b-11 (замеры балансов и сводки) | Tasks 3, 7 |

Вне этого плана: экран журнала, тулбар, «Указать», массовые действия и предупреждение о недоступных ссылках сохранённого фильтра в интерфейсе (план 5b); форма операции (шаг 6).
