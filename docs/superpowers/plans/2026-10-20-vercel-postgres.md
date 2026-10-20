# Vercel + Postgres (Neon), локально SQLite — план

> **Для исполнителя:** выполнять по задачам через superpowers:executing-plans (без субагентов, решение владельца 2026-10-18); ревью — claude-code-harness:harness-review в режиме manual-pass. Шаги отмечаются чекбоксами (`- [ ]`). Команды — в переднем плане с `timeout`; рабочий экземпляр на 3457 не трогать (`npm start` / `npm run stop` / `setup` / `service:*` запрещены).

**Цель:** приложение работает в двух режимах из одного кода: локально (ПК клуба, VPS, тесты) на файле SQLite — как сейчас, и на Vercel (Hobby, некоммерческое личное использование) на Postgres из Vercel Marketplace (Neon).

**Архитектура:** один набор сервисов на Drizzle, асинхронный. Диалект выбирается один раз на процесс по `DATABASE_URL`. Две схемы Drizzle с одинаковыми JS-именами (`sqlite-core` и `pg-core`), два каталога миграций и тест паритета между ними. Всё, что Vercel не держит (диск, процесс-долгожитель, тело запроса > 4,5 МБ), уходит за интерфейсы: `FileStore` (диск / Vercel Blob), задания (croner / Vercel Cron), загрузки (тело запроса / клиентская загрузка в Blob).

**Стек:** Fastify 5 (zero-config на Vercel Functions, Fluid compute), Drizzle ORM 0.45 + drizzle-kit 0.31; SQLite → `@libsql/client` (`drizzle-orm/libsql`, файл `file:`); Postgres на Vercel → `@neondatabase/serverless` Pool (`drizzle-orm/neon-serverless`, WebSocket — нужны интерактивные транзакции); Postgres в тестах → `@electric-sql/pglite` (`drizzle-orm/pglite`, в памяти, без Docker); `@vercel/blob`.

**Спецификация:** отдельной нет — решения зафиксированы в этом плане (раздел «Решения»). Исходная задача владельца (2026-10-20): «поднять на Vercel, главная проблема — БД; в идеале PG на Vercel, SQLite для локального теста». Выбран вариант «два диалекта» (PGlite-локально и Turso отклонены владельцем).

## Что мешает сейчас (разведка 2026-10-20)

| Препятствие | Где | Масштаб |
|---|---|---|
| better-sqlite3 синхронный, Drizzle-транзакции с ним не принимают async-колбэк | `src/server/db/client.ts`, 46 файлов модулей | ~578 вызовов `.all()/.get()/.run()/.values()`, 5 `transaction(` |
| Сырые выражения better-sqlite3 | `operations/writer.ts`, `backup/*`, `db/migrate.ts` | 10 вызовов `sqlite.prepare/exec/pragma` |
| Своя SQL-функция `ulower` (регистр + «ё») | `operations/journal.ts:132` | поиск журнала |
| Схема только `sqlite-core`; 128 `integer`, 4 boolean-mode | `src/server/db/schema.ts` (640 строк), миграции 0000–0011 | суммы в `integer` (в PG нужен `bigint`) |
| Сырой SQL в тестах | `tests/**` | 135 вызовов `t.sqlite.prepare` в 45 файлах |
| Файлы на диске | вложения (`fs.writeFileSync`), бэкапы (копия файла БД), логи (pino-roll) | на Vercel диска нет |
| Процесс-долгожитель | `lock.ts`, `jobs/scheduler.ts` (croner, бэкап 04:00), сигналы/IPC | на Vercel нет |
| Кэш превью импорта в памяти процесса | `imports/cache.ts` | разные экземпляры функции |
| Лимит тела запроса Vercel 4,5 МБ | импорт до 30 МБ, вложения до 10 МБ | 413 `FUNCTION_PAYLOAD_TOO_LARGE` |

## Решения

- **Р1. Выбор диалекта.** `DATABASE_URL` начинается с `postgres://`/`postgresql://` → Postgres (Neon). Иначе SQLite-файл `config.dbPath`, как сейчас. Тесты: `TEST_DB=sqlite|pg`, где `pg` — это PGlite в памяти.
- **Р2. Драйвер SQLite — libsql вместо better-sqlite3.** Причина: асинхронные транзакции (`db.transaction(async tx => …)`). Платим за это так: у libsql нет пользовательских функций, поэтому `ulower` уходит (см. Р6). Бэкап делается через `VACUUM INTO`.
- **Р3. Схема — одна на процесс, связывается при открытии БД.** `src/server/db/schema/index.ts` экспортирует таблицы как `export let`. На уровне типов это таблицы `sqlite-core`. `bindSchema('pg')` переназначает привязки на таблицы `pg-core`. Сервисы по-прежнему делают `import { operations } from '../../db/schema'`. Повторная привязка к другому диалекту бросает ошибку. Типизация держится на SQLite-схеме, а тест паритета (Р4) гарантирует, что PG-схема совпадает с ней по именам.
- **Р4. Паритет схем.** `tests/server/schema-parity.test.ts` сравнивает через `getTableConfig` обеих схем набор таблиц, колонки (`name`, `notNull`, наличие default, PK), индексы и уникальные ключи (имена и колонки), внешние ключи (колонки, цель, `onDelete`).
- **Р5. Типы в PG.** Любой `integer` (id, суммы, количества, позиции) → `bigint({ mode: 'number' })`; id — `bigint` с `generatedByDefaultAsIdentity()` (явные id при переносе разрешены). `integer({ mode: 'boolean' })` → `boolean`. `text` → `text`, `real` → `doublePrecision`. Даты остаются ISO-текстом, как сейчас. Парсеры типов драйверов: OID 20 (`int8`) и 1700 (`numeric`) → `Number` (иначе `SUM`/`COUNT` приходят строками). Значения меньше 2^53 гарантированы суммами в тиынах.
- **Р6. Поиск без `ulower`.** Добавляются колонки-свёртки, которые заполняет приложение через `foldCase()` из `src/shared/search.ts`: `operations.comment_fold`, `accounts.name_fold`, `categories.name_fold`, `counterparties.name_fold`, `projects.name_fold`. Запрос в журнале — `col_fold LIKE ? ESCAPE '\'`, и он одинаков в обоих диалектах. Заполнение старых строк — шаг после миграций в коде (`backfillFolds(db)`, идемпотентный: `WHERE *_fold IS NULL`).
- **Р7. Транзакции и запись.** `mutate()` остаётся единственной точкой. В PG первая инструкция транзакции — `SELECT pg_advisory_xact_lock(7001)`: глобальный писатель, как в SQLite. Это сохраняет инварианты FIFO-партий, остатков и отмены без перепроверки всей логики под READ COMMITTED. `behavior: 'immediate'` в PG игнорируется.
- **Р8. Переносимый SQL** (правило ревью; тесты на обоих диалектах ловят нарушения):
  - в `GROUP BY` перечислены все неагрегированные колонки;
  - у `ORDER BY` по колонке с NULL явно указан `NULLS FIRST/LAST`;
  - скалярные `max(a,b)`/`min(a,b)` заменены на `greatest()`/`least()` из `db/sql.ts`;
  - нет `CAST(... AS INTEGER)` — вместо него `asInt()` из `db/sql.ts`;
  - булевы значения передаются параметром, а не `= 1`;
  - нет `instr`, `iif`, `typeof`, `strftime`, `julianday`.
- **Р9. Сырые запросы — только через `src/server/db/raw.ts`:**
  - `rows<T>(ex: Executor, q: SQL): Promise<T[]>`;
  - `one<T>(ex, q): Promise<T | undefined>`;
  - `exec(ex, q): Promise<void>`.

  `first<T>(q): Promise<T | undefined>` заменяет `.get()` у построителя. Запрет `.all()/.get()/.run()/.values()` и `sqlite.prepare` в `src/server/**` проверяет тест `tests/server/no-sync-db.test.ts` (поиск по исходникам).
- **Р10. Хранилище файлов.** `FileStore { put(key, data, contentType): Promise<void>; url(key): Promise<string>; get(key): Promise<Buffer>; remove(key): Promise<void>; list(prefix): Promise<string[]> }`. Две реализации: `local` (каталоги `data/uploads`, `data/backups`, как сейчас) и `blob` (Vercel Blob).
- **Р11. Большие загрузки на Vercel.** Вложения (≤ 10 МБ) и файлы импорта (≤ 30 МБ) браузер грузит прямо в Blob (`@vercel/blob/client` `upload()`, токен выдаёт `POST /api/v1/uploads/token` после проверки сессии и CSRF). Серверу передаётся ключ, сервер читает файл из Blob. Скачивание вложения — 302 на URL Blob после проверки сессии. Локальный режим не меняется: тело запроса, как сейчас.
- **Р12. Кэш импорта.** Источник истины — файл в Blob по ключу токена, кэш в памяти — только ускорение. Промах (другой экземпляр) → повторный разбор из Blob. Файлы импорта старше 24 ч удаляет ежедневное задание.
- **Р13. Задания на Vercel.** Один cron `vercel.json`: `{"path":"/api/v1/cron/daily","schedule":"0 23 * * *"}` (23:00 UTC = 04:00 Asia/Almaty; Hobby — раз в сутки, точность ±59 мин). Защита — заголовок `Authorization: Bearer ${CRON_SECRET}`. Что делает задание:
  1. бэкап — выгрузку всех таблиц в `backups/YYYY-MM-DD.json.gz` в Blob, храним 14 последних;
  2. удаление файлов импорта старше 24 ч;
  3. удаление истёкших сессий.

  Neon PITR — второй рубеж. Восстановление в режиме Vercel идёт только скриптом (`npm run restore -- --pg`), кнопка в интерфейсе скрыта.
- **Р14. Режим `DEPLOY_MODE=vercel`.**
  - Нет блокировки, сигналов, croner, ngrok, `@fastify/static`, pino-roll; логи идут в stdout.
  - `trustProxy: true`, IP клиента берётся из `x-forwarded-for` (первый адрес).
  - Статика клиента (`vite build` → `public/`) отдаётся через CDN Vercel, SPA-фолбэк — `rewrites` на `/index.html` для путей не из `/api/`.
  - Регион функций — `fra1`, регион Neon — `aws-eu-central-1` (Франкфурт, ближе всего к KZ).
  - Миграции запускаются на сборке (`vercel-build`) для своей БД окружения. Preview использует ветку Neon от интеграции, Production — основную.
- **Р15. Ограничители частоты.** Вход и `@fastify/rate-limit` остаются в памяти экземпляра. Для личного сайта с одним пользователем это принято сознательно. Записано в README как ограничение режима Vercel.
- **Р16. Тесты.**
  - Vitest-проекты: `unit` (client/shared), `server-sqlite`, `server-pg` (PGlite).
  - `npm test` гоняет все три.
  - e2e по умолчанию идёт на SQLite; `E2E_DB=pg` — полный прогон на PGlite. Он обязателен в конце фаз В-2 и В-4.

## Global Constraints

- Node ≥ 24, ESM, TypeScript 7; пины версий из `package.json` не поднимать без нужды. Новые зависимости: `@libsql/client`, `@neondatabase/serverless`, `ws`, `@electric-sql/pglite`, `@vercel/blob`. Убрать `better-sqlite3`, `@types/better-sqlite3`.
- Локальный режим ведёт себя как раньше: те же экраны, импорт, бэкапы на диск, супервизор, туннели. Все текущие тесты (vitest 1606+1, e2e 229, shots 88) зелёные после каждой задачи.
- Существующая БД владельца (`data/app.db`, миграции 0000–0011) открывается без потерь. Каталог её миграций переезжает, но журнал и хэши миграций не меняются.
- Каждое будущее изменение схемы правится в обеих схемах сразу, и `npm run db:generate` генерирует обе миграции.
- Секреты только в env Vercel / `.env`; в git не класть. Настоящие данные клуба — только в `data/` и временной папке сессии.
- Plans.md не коммитить (владелец коммитит сам).

## Review Focus

1. **Суммы и количества больше 2^31 в PG** (выручка за 5 лет в тиынах): ожидается точное число, а не строка и не переполнение. Тест в задаче 9: операция на 30 000 000 000 тиынов, затем `SUM` в балансах и аналитике возвращает `number` и точное значение на обоих диалектах.
2. **Поиск по кириллице с «Ё» и разным регистром** («ЁЛКА» находит «елка») на обоих диалектах, включая строки, созданные до миграции свёрток. Тесты в задаче 8: `backfillFolds` + поиск.
3. **Две вкладки одновременно проводят расход из одной партии склада** на PG: одна запись проходит, вторая получает понятную ошибку остатка, а не уходит в минус. Тест в задаче 10: два параллельных `mutate` на PGlite.
4. **Импорт реального объёма (16 тыс. строк, файл > 4,5 МБ) на Vercel**: загрузка проходит, превью переживает переход на другой экземпляр, запись укладывается в `maxDuration`. Тест в задаче 15 (промах кэша → повторный разбор) + ручная проверка в задаче 18.
5. **Выгрузка журнала в Excel больше 4,5 МБ** на Vercel: файл скачивается, а не падает с 413. Тест в задаче 15: при ответе > 4 МБ в режиме vercel файл кладётся в Blob, клиент получает 302.

---

## Фаза В-1. Асинхронный слой данных (только SQLite, поведение не меняется)

Переходный приём на время фазы: `withTx(db, async (tx) => …)` поверх better-sqlite3 — `BEGIN IMMEDIATE` / `SAVEPOINT` для вложенных, `COMMIT` / `ROLLBACK`. Его удаляет задача 8, когда драйвер станет libsql. Модули переводятся снизу вверх по графу вызовов, тесты зелёные после каждой задачи.

### Задача 1: Каркас асинхронного доступа

**Files:**
- Create: `src/server/db/raw.ts`, `src/server/db/tx.ts` (временный `withTx`)
- Modify: `src/server/modules/audit/mutate.ts`, `tests/helpers/test-app.ts`, `tests/helpers/test-db.ts`, `tests/helpers/api.ts`
- Test: `tests/server/db-raw.test.ts`, `tests/server/no-sync-db.test.ts`

**Interfaces:**
- Produces: `rows<T>(ex: Executor, q: SQL): Promise<T[]>`; `one<T>(ex, q): Promise<T | undefined>`; `exec(ex, q): Promise<void>`; `first<T>(q: PromiseLike<T[]>): Promise<T | undefined>`; `mutate<T>(db, audit, fn: (tx, record) => Promise<T>, opts?): Promise<T>`; хелпер тестов `t.sql<T>(q: SQL): Promise<T[]>` вместо `t.sqlite.prepare(...)`.

- [ ] Тест `db-raw.test.ts`: `rows` возвращает массив объектов с именами колонок как в SQL; `one` на пустом результате даёт `undefined`; `withTx` откатывает обе вставки, если колбэк бросил после `await`; вложенный `withTx` откатывает только свою часть.
- [ ] Тест `no-sync-db.test.ts`: в `src/server/**/*.ts` нет `/\.(all|get|run|values)\(\)/` и `sqlite\.(prepare|exec)` вне `db/client.ts`, `db/tx.ts`, `db/migrate.ts`, `modules/backup/*`, `operations/writer.ts`. Список исключений в тесте сокращается по мере задач 2–8; в задаче 8 он становится пустым.
- [ ] Реализовать `raw.ts`, `tx.ts`; `mutate` делает `fn` async и работает через `withTx`. Вызывающие в этой задаче — только audit.
- [ ] Хелперы тестов: добавить `t.sql`, перевести `api.ts` (`auditCount` → async). Остальные тесты пока используют `t.sqlite` (он остаётся до задачи 8).
- [ ] `npx vitest run tests/server/db-raw.test.ts tests/server/no-sync-db.test.ts tests/server/audit.test.ts` → PASS; `npm run typecheck` → чисто.
- [ ] Commit `refactor(db): асинхронные помощники и withTx`.

### Задачи 2–7: Перевод модулей на async

Шаги каждой задачи одинаковы:
1. Сервисы модуля возвращают `Promise`, вызовы построителя через `await`, `.get()` → `first()`, сырые запросы → `raw.ts`, транзакции → `withTx`/`mutate`.
2. Маршруты делают `await`.
3. Тесты модуля переводятся на `await` и `t.sql`.
4. Модуль удаляется из списка исключений `no-sync-db.test.ts`.
5. Прогон тестов модуля + `npm run typecheck`, затем полный `npm test` в конце задачи.
6. Коммит `refactor(<модуль>): async`.

| # | Модули | Особенности |
|---|---|---|
| 2 | `auth`, `users`, `preferences`, `audit`, `companies`, `saved-filters` | `sessions.ts` вызывается в хуке Fastify на каждый запрос — хук становится async |
| 3 | `accounts`, `categories`, `counterparties`, `projects`, `tags`, `dictionaries`, `references`, `split-presets`, `templates`, `rates`, `db/seed.ts` | `seedCurrencies` → async, вызывающие в `main.ts` и скриптах |
| 4 | `operations` (кроме `writer.ts`), `balances` | `bulk.ts`, `undo.ts` — транзакции с `behavior: 'immediate'` → `withTx` |
| 5 | `imports`, экспорт (`http/xlsx.ts` потребители), `operations/writer.ts` | `writer.ts`: подготовленные выражения → `tx.insert(...).values(chunk)` пачками по 500 строк; `bench:import` на 16 тыс. строк не хуже текущего более чем в 1,5 раза |
| 6 | `analytics` | только чтение; сверка — существующие тесты отчётов без правок ожиданий |
| 7 | `stock` | FIFO-списание внутри `mutate`; e2e `stock*.spec.ts` |

### Задача 8: libsql вместо better-sqlite3, свёртки поиска

**Files:**
- Modify: `src/server/db/client.ts`, `src/server/db/migrate.ts`, `src/server/db/schema.ts`, `src/server/modules/operations/journal.ts`, `src/server/modules/backup/service.ts`, `src/server/modules/backup/restore.ts`, `src/server/main.ts`, `src/server/app.ts` (`AppDeps.sqlite` убрать), `scripts/*.ts`, где открывается БД, `package.json`
- Create: `src/server/db/migrations/0012_*.sql` (сгенерировать), `src/server/db/backfill.ts`
- Delete: `src/server/db/tx.ts`
- Test: `tests/server/search-fold.test.ts`, `tests/server/backup.test.ts`, `tests/server/db.test.ts`

**Interfaces:**
- Produces: `openDb(cfg: { kind: 'sqlite'; path: string }): Promise<{ db: Db; close(): Promise<void> }>`; `backfillFolds(db: Db): Promise<number>` (сколько строк заполнено); колонки `comment_fold`, `name_fold` (Р6); `Executor` = `Db | транзакция libsql`.

- [ ] Тест `search-fold.test.ts`: операция с комментарием «ЁЛКА» до миграции свёрток (вставка с `comment_fold = NULL`), затем `backfillFolds` → поиск `q=елка` находит её. Новая операция «Ёж» находится по `ёж` и `ЕЖ`. `%` и `_` в запросе ищутся буквально.
- [ ] Тест `backup.test.ts` (дополнение): бэкап через `VACUUM INTO` открывается как БД с тем же числом операций; бэкап при открытой транзакции на запись не ломает её.
- [ ] Схема + миграция 0012 (колонки `*_fold`, индексов не нужно). Запись `*_fold` во всех местах вставки и изменения имён и комментария (accounts, categories, counterparties, projects, operations, импорт). `journal.ts` переходит на `*_fold LIKE`.
- [ ] `client.ts` на `drizzle-orm/libsql` (`file:` + путь, `PRAGMA foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=WAL`). Миграции — `drizzle-orm/libsql/migrator`. `appliedMigrationsCount` через `rows`. `withTx` → `db.transaction(async tx => …)`, удалить `tx.ts`. Убрать `better-sqlite3` из зависимостей. Список исключений `no-sync-db` пуст; `t.sqlite` удалён из хелперов.
- [ ] Проверка на копии БД владельца (`data/app.db` копируется во временную папку сессии, не трогая рабочий экземпляр): приложение на `E2E_PORT=3459` поднимается, миграция 0012 и backfill проходят, балансы счетов совпадают с рабочим экземпляром.
- [ ] `npm test` (vitest + e2e ×2 + `npm run shots:ux`) → всё зелёное; `npm run bench:journal`, `bench:reports` — не хуже более чем в 1,5 раза (цифры в followups).
- [ ] Commit `feat(db): libsql вместо better-sqlite3, свёртки поиска`.

---

## Фаза В-2. Postgres-диалект (проверка на PGlite)

### Задача 9: PG-схема, миграции, паритет, привязка

**Files:**
- Move: `src/server/db/schema.ts` → `src/server/db/schema/sqlite.ts`; `src/server/db/migrations/*` → `src/server/db/migrations/sqlite/`
- Create: `src/server/db/schema/pg.ts`, `src/server/db/schema/index.ts`, `src/server/db/migrations/pg/` (baseline 0000), `drizzle.sqlite.config.ts`, `drizzle.pg.config.ts` (удалить `drizzle.config.ts`)
- Modify: `package.json` (`db:generate` = обе конфигурации), `src/server/db/migrate.ts` (`MIGRATIONS_DIR` по диалекту)
- Test: `tests/server/schema-parity.test.ts`, `tests/server/pg-bigint.test.ts`

**Interfaces:**
- Produces: `type Dialect = 'sqlite' | 'pg'`; `bindSchema(d: Dialect): void`; `currentDialect(): Dialect`; таблицы из `db/schema` — те же имена, что сейчас.

- [ ] Тест паритета (Р4) — красный, пока нет `pg.ts`.
- [ ] `pg.ts` по правилам Р5, имена индексов и ограничений те же. Данные, которые миграции SQLite вставляли сами (проверить `grep INSERT src/server/db/migrations/sqlite/*.sql`), переносятся в PG-baseline отдельным SQL-блоком.
- [ ] `bindSchema` (Р3) + тест: после `bindSchema('pg')` `import { operations }` отдаёт PG-таблицу; повторный `bindSchema('sqlite')` бросает ошибку.
- [ ] Тест `pg-bigint.test.ts` (Review Focus 1) — на PGlite, после задачи 10 зелёный.
- [ ] Старая БД владельца с журналом миграций из `migrations/` открывается после переноса каталога (тест `db.test.ts`: файл с применёнными 0000–0011 → 0 новых применений, кроме 0012).
- [ ] Commit `feat(db): pg-схема и миграции, тест паритета`.

### Задача 10: Открытие БД по конфигу, Postgres-драйверы

**Files:**
- Modify: `src/server/db/client.ts`, `src/server/config.ts` (`DATABASE_URL`), `src/server/modules/audit/mutate.ts`, `src/server/main.ts`, `tests/helpers/test-db.ts`, `tests/helpers/test-app.ts`, скрипты, открывающие БД (`scripts/user-add.ts`, `user-passwd.ts`, `seed-demo.ts`, `import-check.ts`, `bench-*.ts`) — через `openDb(config.db)`
- Test: `tests/server/db-open.test.ts`, `tests/server/pg-writer-lock.test.ts`

**Interfaces:**
- Consumes: `bindSchema` (задача 9).
- Produces: `openDb(cfg: DbConfig): Promise<{ db: Db; dialect: Dialect; close(): Promise<void> }>`, где `type DbConfig = { kind: 'sqlite'; path: string } | { kind: 'neon'; url: string } | { kind: 'pglite' }`; `Config.db: DbConfig`.

- [ ] Тесты: `DATABASE_URL=postgres://…` → `config.db.kind === 'neon'`; без него — `sqlite` с `dbPath`; PGlite открывается, миграции применяются, `SELECT sum(x)` по `bigint` даёт `number`.
- [ ] Neon: `Pool` из `@neondatabase/serverless`, `neonConfig.webSocketConstructor = ws`, парсеры OID 20/1700 → `Number`. PGlite: опция `parsers` с теми же OID.
- [ ] `mutate` в PG: `pg_advisory_xact_lock(7001)` первой инструкцией (Р7). Тест `pg-writer-lock.test.ts` (Review Focus 3): партия на 1 шт., два параллельных списания по 1 шт. → одно успешно, второе — ошибка «Недостаточно остатка» (текст из текущего сервиса склада), итоговый остаток 0.
- [ ] Commit `feat(db): открытие Postgres (Neon, PGlite)`.

### Задача 11: Все серверные тесты на обоих диалектах

**Files:**
- Modify: `vitest.config.ts` (проекты `unit`, `server-sqlite`, `server-pg`), `tests/helpers/*`; модули, где тесты на PG упадут
- Create: `src/server/db/sql.ts` (`greatest`, `least`, `asInt`, `nullsLast(col, dir)`)

- [ ] `TEST_DB=pg npx vitest run --project server-pg` — первый прогон, список падений сохраняется в рабочие заметки.
- [ ] Исправлять по правилам Р8, без веток `if (dialect)` в сервисах. Исключение — `db/sql.ts`, `db/client.ts`, `db/migrate.ts`, бэкап (там ветки допустимы). Порядок сортировки и формат ответов API одинаковы на обоих диалектах; ожидания тестов не правятся под PG.
- [ ] `npm test` → все три проекта зелёные. В итоге задачи записать число тестов по проектам.
- [ ] Commit `fix(db): переносимый SQL для Postgres` (по коммиту на модуль, если правок много).

### Задача 12: e2e и замеры на PG

**Files:**
- Modify: `e2e/server.ts` (`E2E_DB=pg` → PGlite), `playwright.config.ts`, `scripts/bench-*.ts` (`--pg <url>`)

- [ ] `E2E_DB=pg npx playwright test` → 229/229, дважды.
- [ ] Бенчи на PGlite не показательны, поэтому их запускаем на ветке Neon (задача 18) и сравниваем с SQLite; цель — журнал и отчёты p95 < 1 с на «5 лет истории».
- [ ] Commit `test(e2e): прогон на Postgres`.

---

## Фаза В-3. Режим Vercel

### Задача 13: Точка входа, статика, конфиг

**Files:**
- Create: `src/server.ts` (точка входа, которую Vercel распознаёт для Fastify), `vercel.json`, `src/server/serverless.ts`
- Modify: `src/server/config.ts` (`DEPLOY_MODE` += `'vercel'`, обязательны `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`; `ALLOWED_ORIGINS` по умолчанию из `VERCEL_PROJECT_PRODUCTION_URL`), `src/server/app.ts` (`trustProxy`, без `@fastify/static` в vercel), `src/server/security/client-ip.ts`, `src/server/logger.ts`, `vite.config.ts` (outDir по `VERCEL`), `package.json` (`vercel-build`: `vite build` + `tsx scripts/migrate.ts`)
- Create: `scripts/migrate.ts`
- Test: `tests/server/config.test.ts`, `tests/server/client-ip.test.ts`, `tests/server/vercel-entry.test.ts`, `tests/server/deploy-files.test.ts`

**Interfaces:**
- Produces: `createServerlessApp(env): Promise<FastifyInstance>` — открывает БД один раз на экземпляр (кэш модуля), без миграций, блокировки и планировщика.

- [ ] Тесты конфига: `vercel` без `DATABASE_URL`/`CRON_SECRET` → понятная ошибка; `vercel` с SQLite-путём → ошибка «На Vercel нужен Postgres».
- [ ] Тест `client-ip`: в режиме `vercel` берётся первый адрес из `x-forwarded-for`.
- [ ] Тест `vercel-entry`: `createServerlessApp` на PGlite отвечает `/api/v1/health` и не пишет в `data/`.
- [ ] `vercel.json`:
  - `regions: ["fra1"]`;
  - `functions` с `maxDuration: 60` для точки входа;
  - `rewrites` для SPA (всё, что не `/api/` и не файл, → `/index.html`);
  - `crons` (Р13).
- [ ] Проверить `npx vercel build` локально (без деплоя): сборка проходит, `@node-rs/argon2` для linux-x64 попадает в бандл.
- [ ] Commit `feat(deploy): режим vercel`.

### Задача 14: FileStore и вложения через Blob

**Files:**
- Create: `src/server/files/store.ts` (интерфейс), `src/server/files/local.ts`, `src/server/files/blob.ts`, `src/server/modules/uploads/routes.ts` (`POST /api/v1/uploads/token`)
- Modify: `src/server/modules/attachments/service.ts`, `routes.ts`, клиент: загрузка и скачивание вложений (`src/client/**`, где сейчас `application/octet-stream` на `/attachments`)
- Test: `tests/server/attachments.test.ts`, `tests/server/file-store.test.ts`, e2e `operation-edit.spec.ts` (вложения)

**Interfaces:**
- Produces: `FileStore` (Р10); `POST /api/v1/uploads/token` — тело `{ kind: 'attachment' | 'import', fileName, size }` → токен клиентской загрузки, только для вошедшего пользователя с CSRF, `size` не больше лимита типа; `POST /api/v1/companies/:cid/operations/:id/attachments` в vercel-режиме принимает `{ blobKey }`.

- [ ] Сначала свериться с документацией `@vercel/blob` (Context7): есть ли приватные хранилища и подписанные ссылки. Если есть — скачивание через подписанную ссылку; если нет — 302 на неугадываемый URL после проверки сессии (Р11).
- [ ] Тесты: `local` ведёт себя как сейчас (существующие тесты не меняются); `blob` с подменным клиентом — `put/get/remove/list`; токен на 11 МБ для вложения → 400; без сессии → 401.
- [ ] Commit `feat(files): вложения через Vercel Blob`.

### Задача 15: Импорт и выгрузки в режиме Vercel

**Files:**
- Modify: `src/server/modules/imports/routes.ts`, `cache.ts`, `service.ts`; клиент панели импорта; `src/server/http/xlsx.ts` (отправка ответа)
- Test: `tests/server/import-cache.test.ts`, `tests/server/imports-api.test.ts`, `tests/server/journal-export.test.ts`

- [ ] Тест (Review Focus 4): загрузка `{ blobKey }`, затем кэш очищается (имитация другого экземпляра), превью и запись по тому же токену работают и дают тот же результат.
- [ ] Тест (Review Focus 5): в режиме vercel ответ выгрузки > 4 МБ → файл в `FileStore` под `exports/`, ответ 302; ≤ 4 МБ → как сейчас.
- [ ] Commit `feat(imports): импорт и выгрузки через Blob на Vercel`.

### Задача 16: Ежедневное задание и бэкапы в режиме Vercel

**Files:**
- Create: `src/server/modules/backup/pg-dump.ts` (выгрузка всех таблиц в JSON.gz и загрузка обратно), `src/server/modules/cron/routes.ts`
- Modify: `src/server/modules/backup/routes.ts` (в vercel: список и скачивание из Blob, восстановления нет), `scripts/restore.ts` (`--pg`), клиент экрана бэкапов (скрыть «Восстановить» в vercel)
- Test: `tests/server/cron.test.ts`, `tests/server/pg-dump.test.ts`

- [ ] Тесты: `/api/v1/cron/daily` без `Bearer CRON_SECRET` → 401. С ним: создан `backups/<дата>.json.gz`, из 16 бэкапов остаются 14, файлы импорта старше 24 ч удалены, истёкшие сессии удалены. `pg-dump` туда и обратно на PGlite даёт те же строки во всех таблицах и правильные значения последовательностей id (следующая вставка не конфликтует).
- [ ] Commit `feat(backup): ежедневное задание Vercel и бэкап Postgres`.

---

## Фаза В-4. Перенос данных и запуск

### Задача 17: Перенос SQLite → Postgres

**Files:**
- Create: `scripts/sqlite-to-pg.ts` (`npm run db:to-pg -- --from <файл.db> --to <DATABASE_URL> [--files]`)
- Test: `tests/server/sqlite-to-pg.test.ts`

- [ ] Тест: БД SQLite с демо-данными (`seed:demo`) → PGlite.
  - Число строк по каждой таблице совпадает.
  - Сумма `amount` и `base_amount` по операциям совпадает.
  - Ответы `/balances` и `/analytics/pnl` за весь период одинаковы на обеих базах.
  - Повторный запуск на непустую цель → отказ с сообщением, без частичной записи.
- [ ] Скрипт работает так:
  1. миграции цели;
  2. копирование таблиц в порядке внешних ключей пачками по 1000 строк в одной транзакции;
  3. `setval` для identity-колонок;
  4. `--files` — загрузка вложений из `data/uploads` в Blob с теми же ключами;
  5. отчёт сверки в stdout.
- [ ] Commit `feat(scripts): перенос SQLite → Postgres`.

### Задача 18: Запуск на Vercel (вместе с владельцем) и итоги

Шаги, где нужен аккаунт владельца, делает владелец; я готовлю команды и проверяю результат.

- [ ] **Владелец:**
  1. `npx vercel login`, `npx vercel link` (новый проект, план Hobby).
  2. Marketplace → Neon (Free, регион Frankfurt) → подключить к проекту.
  3. Storage → Blob → подключить.
  4. Env: `SESSION_SECRET` (32+ случайных байта), `CRON_SECRET`, `DEPLOY_MODE=vercel`, `APP_NAME`, `TIMEZONE=Asia/Almaty`.
  5. Сверить лимиты бесплатных планов Neon/Blob с объёмом данных.
- [ ] `npx vercel env pull .env.vercel.local` (в `.gitignore` уже `.env.*`). Затем `npm run db:to-pg -- --from <копия data/app.db> --to $DATABASE_URL --files` — на ветке Neon `preview`, потом на основной.
- [ ] Первый деплой `npx vercel --prod`, создание пользователя: `DATABASE_URL=… npm run user:add` (скрипт уже поддерживает PG после задачи 10).
- [ ] Бенчи на Neon (задача 12), e2e `E2E_DB=pg` ×2, чек-лист ручной проверки:
  - вход;
  - журнал и поиск «ё»;
  - импорт реального файла;
  - вложение 8 МБ;
  - выгрузка Excel;
  - все вкладки «Аналитики»;
  - склад: приход, списание, инвентаризация;
  - телефон;
  - на следующее утро — бэкап в Blob.
- [ ] README: раздел «Vercel» (команды выше, ограничения Р13, Р15, восстановление из бэкапа). Followups `docs/superpowers/followups/2026-10-20-vercel-postgres.md` с цифрами тестов и бенчей.
- [ ] Commit `docs: запуск на Vercel`.

## Порядок и объём

- В-1 (задачи 1–8) — самая большая часть, примерно 60 % работы: перевод ~578 вызовов и 135 тестовых `prepare`. После неё локальный режим уже работает на libsql — точка остановки без риска.
- В-2 (9–12): Postgres проверяется локально без облака.
- В-3 (13–16): Vercel-специфика.
- В-4 (17–18): перенос и запуск.
- Каждая фаза заканчивается полным `npm test`, e2e ×2, shots и записью в followups.
