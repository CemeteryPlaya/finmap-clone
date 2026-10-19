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
| 11 | `[Feature]` `[lane:gate]` `[tdd:required]` Контрагенты системных категорий (план, задача 1; R2, R6, R8) | tests/client/operation-options и journal-assign PASS; e2e/operation-form PASS; npm test, typecheck, test:e2e PASS два прогона | - | cc:TODO |
| 12 | `[Feature]` `[lane:gate]` `[tdd:required]` Отмена — схема 0011 и сервер (задача 2; R5, R10, R14) | tests/server/operations-undo, schema-0011, audit-api PASS; npm test и typecheck PASS | - | cc:TODO |
| 13 | `[Feature]` `[lane:gate]` `[tdd:required]` Отмена — интерфейс (задача 3; R2, R10, R11) | tests/client/operation-undo, history, audit-format PASS; e2e/history-undo и service-screens PASS два прогона; shots:ux +1 снимок (c65) | 12 | cc:TODO |
| 14 | `[Feature]` `[lane:gate]` `[tdd:required]` Категория в «Аналитике» — состояние (задача 4; R4, R9) | tests/client/report-url, report-focus, charts PASS; npm test и typecheck PASS | - | cc:TODO |
| 15 | `[Feature]` `[lane:gate]` `[tdd:required]` Категория в «Аналитике» — интерфейс (задача 5; R4) | e2e/analytics и analytics-projects PASS два прогона; shots:ux +1 снимок (c66) | 14 | cc:TODO |
| 16 | `[Feature]` `[lane:gate]` `[tdd:required]` Шаблоны склада — сервер и писатель XLSX (задача 6; R12, R13) | tests/server/xlsx-writer, stock-import-template PASS; npm test и typecheck PASS | - | cc:TODO |
| 17 | `[Feature]` `[lane:gate]` `[tdd:required]` Окно импорта склада — «Выбрать файл», «Скачать шаблон» (задача 7) | tests/client/stock-import PASS; e2e/stock-2 PASS два прогона; shots:ux +1 снимок (c67) | 16 | cc:TODO |
| 18 | `[Docs]` `[lane:gate]` `[tdd:skip:docs]` README, спецификация, итоги, полный прогон (задача 8; R3, R15) | npm test ≥ 1604 + 1 пропущен; typecheck; e2e ≥ 228; shots:ux 88/88 | 11, 13, 15, 17 | cc:TODO |
