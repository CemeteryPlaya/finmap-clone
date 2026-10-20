# Plans

Источник задач Phase 1–2: `docs/superpowers/plans/2026-10-18-warehouse-2-3.md` (решения 1–12, R1–R15). Спецификация: `docs/superpowers/specs/2026-10-15-warehouse-design.md`. Phase 3 — свой источник (см. ниже).
Решение владельца 2026-10-18: без субагентов — Solo, реализует основная сессия; ревью — harness-review manual-pass.

## Phase 1 — Склад-2

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 1 | `[Feature]` `[lane:gate]` `[tdd:required]` Многоскладское ядро FIFO: `runStock`, `qtyAt`, `runFifo` — обёртка (план, задача 1) | tests/shared/stock-fifo.test.ts PASS (перемещение, туда-обратно, излишек, qtyAt, свойственный тест); npm test и typecheck PASS | - | cc:完了 [5c84693] |
| 2 | `[Feature]` `[lane:gate]` `[tdd:required]` Пересчёт по группам и документ «Перемещение» (задача 2, R5–R9, R15) | tests/server/stock-transfer.test.ts и stock-property PASS; npm test и typecheck PASS | 1 | cc:完了 [37c6881] |
| 3 | `[Feature]` `[lane:gate]` `[tdd:required]` Комплекты (задача 3, R2, R3) | tests/server/stock-combo.test.ts PASS; npm test и typecheck PASS | 2 | cc:完了 [126d77d] |
| 4 | `[Feature]` `[lane:gate]` `[tdd:required]` Инвентаризация: черновик и проведение (задача 4, R7, R11) | tests/server/stock-count.test.ts PASS; npm test и typecheck PASS | 3 | cc:完了 [b120005] |
| 5 | `[Feature]` `[lane:gate]` `[tdd:required]` Импорт каталога и поступлений (задача 5, R1, R10) | tests/server/stock-import.test.ts PASS, прежние import-* PASS; npm test и typecheck PASS | 4 | cc:完了 [27e6540] |
| 6 | `[Feature]` `[lane:gate]` `[tdd:required]` Экраны перемещения, инвентаризации, комплектов, импорта (задача 6, R13) | клиентские тесты PASS; npm test, typecheck, test:e2e PASS | 5 | cc:完了 [b9676a9] |
| 7 | `[Test]` `[lane:gate]` `[tdd:skip:e2e-and-docs]` e2e и снимки Склад-2, README (задача 7) | e2e/stock-2.spec.ts PASS два прогона; shots:ux 82/82 | 6 | cc:完了 [1e094a1] |

## Phase 2 — Склад-3

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 8 | `[Feature]` `[lane:gate]` `[tdd:required]` API аналитики склада (задача 8, R4, R15) | tests/server/stock-analytics.test.ts PASS; npm test и typecheck PASS | 7 | cc:完了 [f6634c7] |
| 9 | `[Feature]` `[lane:gate]` `[tdd:required]` Вкладка «Аналитика» и «Динамика цен» (задача 9) | tests/client/stock-analytics.test.ts PASS; npm test и typecheck PASS | 8 | cc:完了 [6586afe] |
| 10 | `[Test]` `[lane:gate]` `[tdd:skip:e2e-and-docs]` e2e, снимки, README, приёмка, итоги (задача 10, R14) | e2e два прогона PASS; shots:ux 85/85; bench:reports в бюджете | 9 | cc:完了 [8dcf7e0] |

## Phase 3 — Отмена в истории, категория в «Аналитике», контрагенты, шаблоны склада

Источник задач: `docs/superpowers/plans/2026-10-20-journal-undo-analytics-focus.md` (решения 1–12, R1–R15). Спецификация: `docs/superpowers/specs/2026-10-19-journal-undo-analytics-focus-design.md`. Solo, ревью — harness-review manual-pass.

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 11 | `[Feature]` `[lane:gate]` `[tdd:required]` Контрагенты системных категорий (план, задача 1; R2, R6, R8) | tests/client/operation-options и journal-assign PASS; e2e/operation-form PASS; npm test, typecheck, test:e2e PASS два прогона | - | cc:完了 [e7b5e97] |
| 12 | `[Feature]` `[lane:gate]` `[tdd:required]` Отмена — схема 0011 и сервер (задача 2; R5, R10, R14) | tests/server/operations-undo, schema-0011, audit-api PASS; npm test и typecheck PASS | - | cc:完了 [c24802f] |
| 13 | `[Feature]` `[lane:gate]` `[tdd:required]` Отмена — интерфейс (задача 3; R2, R10, R11) | tests/client/operation-undo, history, audit-format PASS; e2e/history-undo и service-screens PASS два прогона; shots:ux +1 снимок (c65) | 12 | cc:完了 [1b94a86] |
| 14 | `[Feature]` `[lane:gate]` `[tdd:required]` Категория в «Аналитике» — состояние (задача 4; R4, R9) | tests/client/report-url, report-focus, charts PASS; npm test и typecheck PASS | - | cc:完了 [dcaf5f2] |
| 15 | `[Feature]` `[lane:gate]` `[tdd:required]` Категория в «Аналитике» — интерфейс (задача 5; R4) | e2e/analytics и analytics-projects PASS два прогона; shots:ux +1 снимок (c66) | 14 | cc:完了 [5337eac] |
| 16 | `[Feature]` `[lane:gate]` `[tdd:required]` Шаблоны склада — сервер и писатель XLSX (задача 6; R12, R13) | tests/server/xlsx-writer, stock-import-template PASS; npm test и typecheck PASS | - | cc:完了 [cd6ea70] |
| 17 | `[Feature]` `[lane:gate]` `[tdd:required]` Окно импорта склада — «Выбрать файл», «Скачать шаблон» (задача 7) | tests/client/stock-import PASS; e2e/stock-2 PASS два прогона; shots:ux +1 снимок (c67) | 16 | cc:完了 [ab5a962] |
| 18 | `[Docs]` `[lane:gate]` `[tdd:skip:docs]` README, спецификация, итоги, полный прогон (задача 8; R3, R15) | npm test ≥ 1604 + 1 пропущен; typecheck; e2e ≥ 228; shots:ux 88/88 | 11, 13, 15, 17 | cc:完了 [4a32c1f] |

## Phase 4 — Vercel + Postgres (Neon), локально SQLite

Источник задач: `docs/superpowers/plans/2026-10-20-vercel-postgres.md` (решения Р1–Р16). Спецификации нет — решения в плане. Solo, ревью — harness-review manual-pass. Вариант «два диалекта» выбран владельцем 2026-10-20.

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 19 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: помощники raw/first, временный withTx, async mutate (задача 1) | db-raw, no-sync-db, audit PASS; typecheck | - | cc:完了 [3641a6b] |
| 20 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — auth, users, preferences, audit, companies, saved-filters (задача 2) | тесты модулей; npm test PASS | 19 | cc:完了 [2fd4890] |
| 21 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — справочники, seed (задача 3) | npm test PASS | 20 | cc:完了 [f6f08a1] |
| 22 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — operations, balances (задача 4) | npm test PASS | 21 | cc:完了 [4b5ce09] |
| 23 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — imports, экспорт, writer пачками (задача 5) | npm test PASS; bench:import ≤ 1,5× | 22 | cc:完了 [e8bb3b5] |
| 24 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — analytics (задача 6) | npm test PASS | 22 | cc:完了 [2fd4890] |
| 25 | `[Refactor]` `[lane:gate]` `[tdd:required]` В-1: async — stock (задача 7) | npm test, e2e stock* PASS | 22 | cc:完了 [f6f08a1] |
| 26 | `[Feature]` `[lane:gate]` `[tdd:required]` В-1: libsql вместо better-sqlite3, свёртки поиска 0012, бэкап VACUUM INTO (задача 8) | search-fold, backup PASS; npm test, e2e ×2, shots 88; бенчи ≤ 1,5×; копия БД владельца открывается | 23, 24, 25 | cc:完了 [39d47b9] |
| 27 | `[Feature]` `[lane:gate]` `[tdd:required]` В-2: pg-схема, миграции pg, паритет, bindSchema (задача 9) | schema-parity PASS | 26 | cc:完了 [91ac9e5] |
| 28 | `[Feature]` `[lane:gate]` `[tdd:required]` В-2: openDb по конфигу — Neon, PGlite; advisory lock (задача 10) | db-open, pg-bigint, pg-writer-lock PASS | 27 | cc:完了 [3424b8a] |
| 29 | `[Fix]` `[lane:gate]` `[tdd:required]` В-2: все серверные тесты на обоих диалектах (задача 11) | npm test: unit, server-sqlite, server-pg PASS | 28 | cc:done [01a2165] |
| 30 | `[Test]` `[lane:gate]` `[tdd:skip:e2e]` В-2: e2e на PGlite (задача 12) | E2E_DB=pg 229/229 ×2 | 29 | cc:done [1754dc3] |
| 31 | `[Feature]` `[lane:gate]` `[tdd:required]` В-3: DEPLOY_MODE=vercel, точка входа, vercel.json (задача 13) | config, client-ip, vercel-entry PASS; vercel build локально | 29 | cc:done [46ebe3e] |
| 32 | `[Feature]` `[lane:gate]` `[tdd:required]` В-3: FileStore, вложения через Blob (задача 14) | file-store, attachments PASS; e2e operation-edit | 31 | cc:done [7d99b35] |
| 33 | `[Feature]` `[lane:gate]` `[tdd:required]` В-3: импорт и выгрузки через Blob (задача 15) | import-cache, imports-api, journal-export PASS | 32 | cc:done [e9f17de] |
| 34 | `[Feature]` `[lane:gate]` `[tdd:required]` В-3: cron daily, бэкап Postgres в Blob (задача 16) | cron, pg-dump PASS | 32 | cc:done [e2d3116] |
| 35 | `[Feature]` `[lane:gate]` `[tdd:required]` В-4: перенос SQLite → Postgres (задача 17) | sqlite-to-pg PASS | 30, 34 | cc:done [f4cd3d6] |
| 36 | `[Docs]` `[lane:gate]` `[tdd:skip:deploy]` В-4: запуск на Vercel с владельцем, README, итоги (задача 18; код, README и followups готовы — ждёт аккаунта владельца) | прод работает; чек-лист; e2e PG ×2; followups | 33, 35 | cc:TODO |
