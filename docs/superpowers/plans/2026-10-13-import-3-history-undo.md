# Импорт и экспорт, план И-3: история импортов и отмена — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** третий план импорта (§14 спецификации): у каждого импорта есть запись в «Истории действий» → «Импорты», и его можно отменить одной транзакцией.
- **Сервер:** `GET …/imports` со счётчиками операций, которые удалит отмена (`pending`); `POST …/imports/:id/undo` удаляет операции импорта жёстко, затем неиспользуемые созданные справочники и счета, возвращает стартовый баланс и дату открытия существующих счетов, пишет историю (§6.5, §7.3); отмена в `bench:import`.
- **Клиент:** `ConfirmDialog.cancelLabel`; вкладки-пилюли «Журнал | Импорты» в панели «История действий» (§7.1); список импортов с «Показать ещё» и «Отменить» (§7.2); подтверждение «Не отменять | Отменить импорт» с флажком «Удалить и изменённые», итог в живой области (§7.3); строка «Отменить импорт можно…» в «Импорт завершён»; запись импорта и отмены на странице «История действий».
- **Сверка:** e2e, README «Импорт из Finmap» (повтор — через отмену), `shots:ux` — `c24-history-imports`.

Экспорт — план Э.

**Предусловие:** ветка `stage1/plan1-skeleton` на коммите этого плана (после 260767c). Ожидаемо на старте:
- `npm test` — 1024 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 159 из 159;
- `shots:ux` — 55 из 55.

**Architecture:**
- **Сервер, модуль `src/server/modules/imports/`:**
  - `history.ts` (новый) — `EDITED_SQL` (условие «изменена после импорта»), `chunks` (части списка id для `IN (…)`), `pendingCounts`, `listImports`, `importItem`;
  - `undo.ts` — `undoImport(tx, input, record)`: проверки, жёсткое удаление операций (сначала записи вложений), удаление неиспользуемого созданного в порядке §7.3, возврат полей существующих счетов, отметка `imports`, история. Всё — внутри транзакции вызывающего;
  - `service.ts` — `list()` и `undo()` (`mutate(…, { behavior: 'immediate' })`, архивность компании — ещё раз под блокировкой);
  - `routes.ts` — `GET …/imports`, `POST …/imports/:id/undo`.
- **Общее:** `src/shared/schemas/imports.ts` — `importListQuerySchema`, `ImportListItem`, `ImportListPage`, `importUndoSchema`, `ImportUndoResult`, `ImportUndoResponse`.
- **Клиент:**
  - `lib/import-history.ts` (новый) — вкладки и клавиши, тексты записи, подтверждения и итога, замена записи в кэше, запрос отмены (чистые функции, тесты в node);
  - `components/import/ImportHistory.tsx` (новый) — вкладка «Импорты»: список, «Показать ещё», «Отменить», подтверждение, итог;
  - `components/HistoryDrawer.tsx` — вкладки `HistoryTabs` (tablist, roving tabindex);
  - `components/ConfirmDialog.tsx` — `cancelLabel`;
  - `lib/audit-format.ts` и `pages/settings/AuditSettings.tsx` — запись импорта: имя файла и «Подробности» числами.

**Tech Stack:** Node 24, TypeScript, Fastify 5, zod 4, Drizzle 0.45 + better-sqlite3, React 19, TanStack Query 5, Tailwind 4, Vitest, Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-12-import-export-design.md](../specs/2026-10-12-import-export-design.md):
- основное: §6.1 (`imports`, `operations.import_id`), §6.2 (маршруты и коды), §6.5 (история), §7 (вкладки, список, отмена), §10 (бюджет отмены), §11.2–§11.4 (тесты и снимки), §12 шаг 6, §13 (`ConfirmDialog`, вкладки);
- §14, план И-3; блоки «Решения планирования плана И-1» и «…И-2» (как построены запись и панель) и блок «Решения планирования плана И-3» — добавлен тем же коммитом, что и план.

Итоги И-1 и И-2 — [docs/superpowers/followups/2026-10-12-import-1-followups.md](../followups/2026-10-12-import-1-followups.md), [docs/superpowers/followups/2026-10-13-import-2-followups.md](../followups/2026-10-13-import-2-followups.md). Снимок Finmap — `docs/research/screens/v2/24-history.png` (в git не попадает): вкладки-пилюли «Журнал | Импорты | Стартовый баланс», у записей — «Отмена». **Настоящий файл владельца не используется и не упоминается:** все тесты и снимки — на синтетических файлах (`tests/helpers/finmap-like.ts`).

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§14, блок «Решения планирования плана И-3», №1–№15) тем же коммитом, что и план.

1. **Задачи — 6.** Порядок §14 сохранён, сервер разделён на две задачи:
   1. список `GET …/imports` с `pending`;
   2. отмена: `undo.ts`, `POST …/imports/:id/undo`, отмена в `bench:import`;
   3. `ConfirmDialog.cancelLabel`, вкладки «Журнал | Импорты», список импортов с «Показать ещё»;
   4. отмена в панели, строка «Отменить импорт можно…» в «Импорт завершён», телефон;
   5. запись импорта на странице «История действий»;
   6. README и `shots:ux`.

   Новый файл модуля сверх §3 — `history.ts`: список, `pending` и условие «изменена после импорта» (`EDITED_SQL`), общее для списка и отмены.
2. **Список (уточнение §6.2).**
   - `GET …/imports?limit=20&beforeId=` отвечает `{ items, nextBeforeId }`, как лента истории: `nextBeforeId` — id последней записи полной страницы, иначе `null`. `limit` — от 1 до 100.
   - Запись — `ImportListItem`: `id, fileName, fileSize, status, createdAt, userName, counts, undoneAt, undoneByName, pending`.
   - `pending` есть только у `done`: `{ operations, edited }`. `operations` — все операции импорта, в том числе мягко удалённые; `edited` — изменённые после импорта (§7.3).
   - Список архивной компании читается, кнопки «Отменить» в ней нет.
3. **Счета, изменённые импортом (уточнение §7.3 п. 4).** Возврат идёт по каждому полю отдельно (`startingBalance`, `openedAt`) и только по полям, которые импорт менял:
   - поле возвращается, если его текущее значение всё ещё равно записанному импортом;
   - `openedAt` — ещё и если у счёта не осталось неудалённых операций раньше прежней даты (инвариант 6, как у правки счёта);
   - счёт в архиве не меняется: у архивного счёта нулевой баланс.

   Невозвращённое поле попадает в итог: `kept.accounts[] = { accountId, name, field, reason: 'changed' | 'operations' | 'archived' }`. Так после отмены с оставленными изменёнными операциями стартовый баланс всё же возвращается, а дата открытия остаётся ранней, пока на неё опираются операции. История — `account` `update` только с возвращёнными полями.
4. **Гонки (уточнение §6.2).**
   - Тело отмены — `{ includeEdited, edited }`, где `edited` — сколько изменённых операций видел человек в подтверждении (`pending.edited`). Если с флажком изменённых стало больше — 409 `IMPORT_CHANGED` «После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз», в `details.pending` — свежие числа, ничего не удалено. Без флажка проверки нет: изменённые и так остаются.
   - Повторная отмена (другое окно, другой пользователь) — 409 `IMPORT_UNDONE` «Импорт уже отменён», а не 410: запись импорта есть, повторять нечего.
   - Отмена идёт под `BEGIN IMMEDIATE` (`mutate(…, { behavior: 'immediate' })`), архивность компании проверяется ещё раз под блокировкой. Две отмены не пройдут обе, правка операции не вклинится между проверкой и удалением.
   - Порядок ответов:
     1. архивная компания — 422;
     2. импорта нет или он другой компании — 404;
     3. уже отменён — 409 `IMPORT_UNDONE`;
     4. изменённых больше, чем видел человек, — 409 `IMPORT_CHANGED`;
     5. архивный счёт удаляемой операции — 422 `ARCHIVED_REFERENCE`.
   - Мягко удалённая после импорта операция удаляется всегда и изменённой не считается: человек её уже удалил.
5. **Удаление созданного.**
   - «Используется» считается по ссылкам операций, в том числе мягко удалённых (инвариант 9). Категория используется ещё и тогда, когда у неё есть дети, проект — когда у него есть счета.
   - Созданное импортом, которое потом ушло в архив, но не используется, удаляется.
   - В итоге — число оставленного по видам (`kept.created`) и первые 20 названий (`kept.names`).
   - Ссылки в шаблонах разделения и сохранённых фильтрах — JSON без ключей (инвариант 10), удалению не мешают.
6. **История отмены (§6.5).**
   - `import` `delete` — `{ fileName, deleted, kept }`.
   - Удалённые справочники и счета — записи `delete` с теми же полями, что у обычного удаления, и `importId`.
   - Удалённые изменённые операции — `operation` `delete` `{ type, amount, accountId, paidAt, importId }`. У неизменённых своих записей нет; у мягко удалённых запись удаления уже есть.
   - Вложения удаляются записями, файлы остаются на диске; своей истории у них нет.
   - Итог в лог pino — компания, пользователь, id импорта, число удалённых и оставленных операций, миллисекунды.
7. **Итог `ImportUndoResult`** — `{ deleted: { operations, accounts, categories, counterparties, projects, tags }, kept: { operations, created, names, accounts } }`. Он же лежит в `imports.undo_result` и приходит в ответе `{ import: ImportListItem, result }`.
8. **Подтверждение (уточнение §7.3).**
   - Число удаляемых операций зависит от флажка: без него — все без изменённых, с ним — все. Числительные согласуются: «Будет удалена 1 операция», «Будут удалены 22 операции».
   - Изменённые: «После импорта изменены 3 операции — они останутся.», с флажком — «… — они тоже будут удалены.».
   - Все операции изменены и флажок снят: «Операции из файла «…» не удаляются. Будут удалены созданные импортом…».
   - Флажок «Удалить и изменённые (3)» показывается только при `pending.edited > 0`.
9. **Итог в панели** — например: «Импорт отменён: удалено 1 227 операций, 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Оставлено: 3 изменённые операции, категория «Аренда» (используется), и ещё 4 (используются), стартовый баланс счёта «Касса» (изменён после импорта).» Итог объявляет живая область (`role="status"`, всегда в разметке), на экране — абзац над списком.
10. **Вкладки (уточнение §7.1).**
    - Стрелки ←/→ ходят по кругу, Home и End — на крайние вкладки.
    - На телефоне вкладки и «Отменить» — не ниже 44 px.
    - Доступное имя кнопки — «Отменить импорт «{файл}» от ДД.ММ.ГГГГ, ЧЧ:ММ». Время нужно: в один день бывает несколько импортов.
11. **Фокус после отмены.**
    - Ответ сервера кладётся в кэш списка до закрытия подтверждения: запись становится «Отменён», «Отменить» исчезает, и фокус уходит на вкладку «Импорты» (`ConfirmDialog.onFocusLost`).
    - При ошибке список перечитывается до закрытия подтверждения. Если «Отменить» осталась, фокус возвращается на неё.
    - Ошибка показывается в `role="alert"` над списком.
12. **«Импорт завершён»** получает строку «Отменить импорт можно в «Истории действий» → «Импорты»» — решение 14 плана И-2 закрыто. README «Импорт из Finmap»: повтор — через отмену прежнего импорта, новый шаг 9 «Отмена импорта».
13. **Страница «История действий» (§6.5).**
    - Рядом с «Импорт №N» — имя файла.
    - «Подробности» импорта — «Строк в файле», «Добавлено» (с доходами, расходами и переводами), «Пропущено дубликатов», «Пропущено плановых», «Создано».
    - «Подробности» отмены — «Итог» тем же текстом, что в панели.
    - Запись неизвестного вида показывается JSON, как раньше.
14. **`bench:import`** — замер «write» добавляет отмену 16 000 строк с бюджетом 3 с (§10). На машине планировщика (16 ядер): отмена — 0,27 с, пик памяти — 357 МБ. Запись 50 000 строк дала пик 494 МБ при бюджете 500 МБ; этот замер план не меняет.
15. **e2e и снимки.**
    - Отмена проверяется в новом файле `e2e/import-history.spec.ts`: вкладки, «Показать ещё», отмена, изменённая операция, гонка, архивная компания, телефон. `e2e/import.spec.ts` проверяет записи импорта и отмены на странице истории.
    - `shots:ux` — снимок `c24-history-imports` с парой `24b-history-imports.png`. Снимка Finmap нет: `24-history` уже пара `c24-history`, а общее имя пары перезаписало бы строку в `index.html`.
    - Сценарий снимка — последний: импорт и отмена через API меняют данные демо-компании.

## Global Constraints

- **Без новых npm-пакетов и сети.** Только то, что уже есть: `better-sqlite3`, Drizzle, React, TanStack Query, Playwright.
- **Отмена (§7.3):**
  - одна транзакция `BEGIN IMMEDIATE` на отмену; любое исключение откатывает всё — ни удалений, ни истории, ни отметки `imports`;
  - операции импорта (`import_id = id`) удаляются жёстко; изменённые после импорта (неудалённые, `version > 1` или есть вложение, в том числе удалённое) — только с `includeEdited`; мягко удалённые — всегда;
  - перед операцией удаляются записи её вложений (файлы на диске остаются), строки и теги — каскадом;
  - созданное импортом (`imports.created`) удаляется, только если ещё существует и не используется, в порядке: подкатегории, категории, контрагенты, теги, счета, проекты;
  - запись `imports` получает `status = 'undone'`, `undone_at`, `undone_by`, `undo_result`.
- **История (§6.5):** `import` `delete` с итогом; удалённые справочники и счета — `delete` с `importId`; возвращённые поля существующего счёта — `account` `update` с `importId`; удалённые изменённые операции — `operation` `delete`.
- **Ошибки:**
  - `AppError(status, code, message, fields?, details?)`, ответ `{error:{code,message,fields?,details?}}`;
  - 409 `IMPORT_UNDONE` «Импорт уже отменён»;
  - 409 `IMPORT_CHANGED` «После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз» с `details.pending`;
  - 422 `ARCHIVED_REFERENCE`: «Компания в архиве — изменения недоступны» и «Счёт «…» в архиве — верните его из архива, чтобы отменить импорт»;
  - 404 `NOT_FOUND` «Импорт не найден».
- **Клиент:**
  - `ConfirmDialog` по умолчанию — «Отменить | <действие>», у отмены импорта — «Не отменять | Отменить импорт»;
  - вкладки — `role="tablist"`, `role="tab"` с `aria-selected` и `aria-controls`, `role="tabpanel"`; при новом открытии панели — «Журнал»;
  - после отмены перечитываются журнал, счета и балансы, компании, справочники и история (`invalidateAfterImport`).
- **Деньги и даты:** деньги — целые минимальные единицы; моменты на экране — `formatDateTime` и `formatDateTimeSec` по часам `APP_TIMEZONE` (`Asia/Almaty`).
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Реальные данные** в тестах, снимках и репозитории запрещены: только выдуманные названия («Касса», «Банк-2», «Сотрудник А»).
- **Невидимые символы** (U+2212, U+00A0, U+202F, U+200B) в коде — только экранированием `\u2212`, `\u00A0`, `\u202F`, `\u200B`. Копируйте код плана из файла плана как есть.
- **Концы строк:** правки «замените → на» делайте инструментом правки файлов; если текст разошёлся с планом пробелами или концами строк, копируйте его из файла.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр; их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой; `npm run bench:import` — во временной папке;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - задачи 3–6 — ещё `npm run test:e2e`; если задача меняет e2e-файлы — два раза подряд;
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи.

## Review Focus

1. **Операцию изменили, пока человек читал подтверждение** (другой пользователь, другое окно). Ожидание: с флажком «Удалить и изменённые» — 409 `IMPORT_CHANGED`, ничего не удалено, свежие числа в `details.pending`; без флажка изменённая просто остаётся и названа в итоге. Тест: задача 2 — «повтор — 409 IMPORT_UNDONE; … изменённых стало больше, чем видел человек, — 409 IMPORT_CHANGED…».
2. **Отмену нажали дважды** (два окна, два пользователя). Ожидание: вторая — 409 `IMPORT_UNDONE`, база не меняется; в панели — «Импорт уже отменён», запись «Отменён», кнопки «Отменить» нет, фокус на вкладке. Тесты: задача 2 — тот же тест и конец теста «изменённая после импорта операция…»; задача 4 — e2e «импорт отменили в другом окне…».
3. **Существующий счёт поменяли после импорта** (стартовый баланс правили, добавили операцию между новой и прежней датой открытия). Ожидание: отмена не затирает правку человека и не нарушает инвариант 6 — поля остаются, итог называет их и причину. Тест: задача 2 — «использованное после импорта остаётся…».
4. **Счёт удаляемой операции в архиве.** Ожидание: 422 «Счёт «…» в архиве — верните его из архива, чтобы отменить импорт», ничего не изменилось; после возврата из архива отмена проходит. Тест: задача 2 — «архивный счёт удаляемой операции — 422…».
5. **Большой импорт.** Ожидание: отмена 16 000 операций — одна транзакция в пределах бюджета §10 (3 с), без ошибки «too many SQL variables» на 50 000 id (части по 500). Тесты: задача 2 — «16 000 строк: отмена укладывается в 20 с…» и `bench:import`.

---

## Карта файлов

```
src/shared/schemas/imports.ts                 # importListQuerySchema, ImportListItem, ImportListPage, importUndoSchema, ImportUndoResult, ImportUndoResponse
src/server/modules/imports/history.ts         # EDITED_SQL, chunks, pendingCounts, listImports, importItem (новый)
src/server/modules/imports/undo.ts            # undoImport — отмена внутри транзакции (новый)
src/server/modules/imports/service.ts         # list(), undo()
src/server/modules/imports/routes.ts          # GET …/imports, POST …/imports/:id/undo
scripts/bench-import.ts                       # отмена 16 000 строк, бюджет 3 с
src/client/components/ConfirmDialog.tsx       # cancelLabel
src/client/lib/import-panel.ts                # operationsText, createdParts — общие с историей
src/client/lib/import-history.ts              # вкладки, тексты, замена записи в кэше, запрос отмены (новый)
src/client/lib/queries.ts                     # useImports
src/client/components/import/ImportHistory.tsx  # вкладка «Импорты»: список, «Отменить», подтверждение, итог (новый)
src/client/components/HistoryDrawer.tsx       # HistoryTabs — «Журнал | Импорты»
src/client/components/import/ImportPanel.tsx  # «Отменить импорт можно в «Истории действий» → «Импорты»»
src/client/lib/audit-format.ts                # auditSubject, importDetails
src/client/pages/settings/AuditSettings.tsx   # имя файла и «Подробности» импорта
scripts/ux-shots.ts                           # c24-history-imports
README.md
tests/helpers/imports.ts                      # importRows — импорт через API для тестов (новый)
tests/server/import-list.test.ts, tests/server/import-undo.test.ts  # (новые)
tests/client/import-history.test.ts (новый), tests/client/audit-format.test.ts
e2e/import-history.spec.ts (новый), e2e/import.spec.ts
```

---

### Task 1: Список импортов — `GET …/imports` с `pending` (§6.2, §7.2)

**Files:**
- Modify: `src/shared/schemas/imports.ts`, `src/server/modules/imports/service.ts`, `src/server/modules/imports/routes.ts`
- Create: `src/server/modules/imports/history.ts`, `tests/helpers/imports.ts`
- Test: `tests/server/import-list.test.ts`

**Interfaces:**
- Consumes: `imports`, `operations`, `users`, `attachments` (`src/server/db/schema.ts`); `Executor` (`src/server/db/client.ts`); `ImportCounts` (`src/shared/schemas/imports.ts`); `requireCompany` (`companies/guard.ts`); `opsWorld` (`tests/helpers/ops.ts`); `finmapLikeXlsx`, `finmapLikeRow`, `excelSerial` (`tests/helpers/finmap-like.ts`).
- Produces:
  - `src/shared/schemas/imports.ts`: `importListQuerySchema` (`limit` 1–100, по умолчанию 20; `beforeId?`), `type ImportListQuery`, `interface ImportPending { operations: number; edited: number }`, `interface ImportListItem { id; fileName; fileSize; status: 'done' | 'undone'; createdAt; userName: string | null; counts: ImportCounts; undoneAt: string | null; undoneByName: string | null; pending: ImportPending | null }`, `interface ImportListPage { items: ImportListItem[]; nextBeforeId: number | null }`;
  - `src/server/modules/imports/history.ts`: `EDITED_SQL` (SQL-условие для `FROM operations`), `IN_CHUNK = 500`, `chunks<T>(items: readonly T[], size?): T[][]`, `pendingCounts(ex: Executor, importIds: readonly number[]): Map<number, ImportPending>`, `listImports(ex: Executor, companyId: number, q: ImportListQuery): ImportListPage`, `importItem(ex: Executor, companyId: number, id: number): ImportListItem | null`;
  - `ImportsService.list(companyId: number, q: ImportListQuery): ImportListPage`;
  - маршрут `GET /api/v1/companies/:cid/imports?limit&beforeId` → 200 `ImportListPage`;
  - `tests/helpers/imports.ts`: `importRows(w: OpsWorld, rows: FinmapLikeValue[][], opts?: { accounts?: AccountMapping[]; name?: string; cid?: number }): Promise<ImportCommitResult>`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/helpers/imports.ts`:

```ts
import type { AccountMapping, ImportCommitResult, ImportPreview } from '../../src/shared/schemas/imports';
import { finmapLikeXlsx, type FinmapLikeValue } from './finmap-like';
import type { OpsWorld } from './ops';
import { ORIGIN_HEADERS } from './test-app';

/**
 * Импорт синтетического файла через API: загрузка, пересчёт с сопоставлениями (если заданы) и запись. Возвращает ответ
 * 201; любой другой ответ — исключение с телом.
 */
export async function importRows(
  w: OpsWorld,
  rows: FinmapLikeValue[][],
  opts: { accounts?: AccountMapping[]; name?: string; cid?: number } = {},
): Promise<ImportCommitResult> {
  const base = `/api/v1/companies/${opts.cid ?? w.cid}/imports`;
  const up = await w.h.t.app.inject({
    method: 'POST',
    url: `${base}/upload`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(opts.name ?? 'выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
  if (up.statusCode !== 200) throw new Error(`upload: ${up.statusCode} ${up.body}`);
  let p = up.json() as ImportPreview;
  if (opts.accounts) {
    const res = await w.h.req('POST', `${base}/preview`, { token: p.token, accounts: opts.accounts });
    if (res.statusCode !== 200) throw new Error(`preview: ${res.statusCode} ${res.body}`);
    p = res.json() as ImportPreview;
  }
  const res = await w.h.req('POST', base, { token: p.token, accounts: opts.accounts ?? [], revision: p.revision });
  if (res.statusCode !== 201) throw new Error(`commit: ${res.statusCode} ${res.body}`);
  return res.json() as ImportCommitResult;
}
```

Создайте `tests/server/import-list.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportListPage } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr } from '../helpers/finmap-like';
import { importRows } from '../helpers/imports';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = '2026-10-06T12:00:00.000Z';
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const listUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports`;

async function list(query = '', cid = w.cid): Promise<ImportListPage> {
  const res = await w.h.req('GET', `${listUrl(cid)}${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportListPage;
}

/** Три расхода с «Кассы» по «Аренде» — по одному в день. */
const FILE_A = [1, 2, 3].map((d) => fr({ paidAt: at(`2026-10-0${d}`, '10:00:00'), amount: 100 * d, from: 'Касса', category: 'Аренда' }));
/** Доход на новый счёт «Сейф». */
const FILE_B = [fr({ paidAt: at('2026-10-04', '11:00:00'), amount: 50, to: 'Сейф', category: 'Бар' })];

describe('GET …/imports — список «Импорты» (§6.2, §7.2 спецификации импорта)', () => {
  it('новые сверху: файл, размер, кто и когда, счётчики; pending — все операции импорта, изменённых нет', async () => {
    w = await opsWorld(NOW);
    expect(await list()).toEqual({ items: [], nextBeforeId: null });
    const a = await importRows(w, FILE_A, { name: 'январь.xlsx' });
    const b = await importRows(w, FILE_B, { name: 'февраль.xlsx' });

    const page = await list();
    expect(page.nextBeforeId).toBeNull();
    expect(page.items.map((i) => i.id)).toEqual([b.import.id, a.import.id]);
    expect(page.items[1]).toEqual({
      id: a.import.id,
      fileName: 'январь.xlsx',
      fileSize: a.import.fileSize,
      status: 'done',
      createdAt: NOW,
      userName: 'Тест',
      counts: { rows: 3, income: 0, expense: 3, transfer: 0, added: 3, duplicates: 0, skippedFuture: 0 },
      undoneAt: null,
      undoneByName: null,
      pending: { operations: 3, edited: 0 },
    });
    expect(page.items[0]!.pending).toEqual({ operations: 1, edited: 0 });
  });

  it('pending.edited: правка (version > 1) и вложение — изменённые; мягко удалённая — не изменённая, но в operations', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE_A);
    const ids = (w.h.t.sqlite.prepare('SELECT id FROM operations WHERE import_id = ? ORDER BY id').all(r.import.id) as { id: number }[]).map((o) => o.id);
    // правка комментария — version 2
    const edit = await w.h.req('PATCH', `${w.ops}/${ids[0]}`, { version: 1, comment: 'проверено' });
    expect(edit.statusCode, edit.body).toBe(200);
    // вложение (версия не меняется) — тоже изменение, даже удалённое
    w.h.t.sqlite
      .prepare("INSERT INTO attachments (company_id, operation_id, original_name, stored_name, mime, size, created_at, deleted_at) VALUES (?, ?, 'чек.png', 'x.png', 'image/png', 1, ?, ?)")
      .run(w.cid, ids[1], NOW, NOW);
    // мягкое удаление: удаляется отменой всегда, изменённой не считается
    const del = await w.h.req('DELETE', `${w.ops}/${ids[2]}`);
    expect(del.statusCode, del.body).toBe(200);

    expect((await list()).items[0]!.pending).toEqual({ operations: 3, edited: 2 });
    expect(one('SELECT version FROM operations WHERE id = ?', ids[1]).version).toBe(1);
  });

  it('«Показать ещё»: limit и beforeId; чужая компания не видна; архивная — список есть; неверный limit — 400; нет компании — 404', async () => {
    w = await opsWorld(NOW);
    const first = await importRows(w, FILE_A, { name: '1.xlsx' });
    const second = await importRows(w, FILE_B, { name: '2.xlsx' });
    const other = await w.h.company('Другая');

    const p1 = await list('?limit=1');
    expect(p1.items.map((i) => i.fileName)).toEqual(['2.xlsx']);
    expect(p1.nextBeforeId).toBe(second.import.id);
    const p2 = await list(`?limit=1&beforeId=${p1.nextBeforeId}`);
    expect(p2.items.map((i) => i.id)).toEqual([first.import.id]);
    expect(p2.nextBeforeId).toBe(first.import.id);
    expect(await list(`?limit=1&beforeId=${first.import.id}`)).toEqual({ items: [], nextBeforeId: null });

    expect((await list('', other)).items).toEqual([]);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    expect((await list('', other)).items).toEqual([]);

    const bad = await w.h.req('GET', `${listUrl()}?limit=0`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
    expect((await w.h.req('GET', listUrl(99_999))).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-list.test.ts`
Expected: FAIL — `GET …/imports` отвечает 404 вместо 200 (маршрута ещё нет).

- [ ] **Step 3: Схема списка**

Добавьте в конец `src/shared/schemas/imports.ts`:

```ts
/** Запрос списка импортов (§6.2, §7.2): GET …/imports?limit=20&beforeId=. */
export const importListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'От 1 до 100').max(100, 'От 1 до 100').default(20),
  beforeId: z.coerce.number().int().positive().optional(),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

/** Операции импорта, которые удалит отмена (§7.2): всего и изменённых после импорта. */
export interface ImportPending {
  /** Все операции импорта, в том числе мягко удалённые. */
  operations: number;
  /** Изменённые после импорта (§7.3): неудалённые, с version > 1 или с вложением. */
  edited: number;
}

/** Запись списка «Импорты» (§7.2): новые сверху. */
export interface ImportListItem {
  id: number;
  fileName: string;
  fileSize: number;
  status: 'done' | 'undone';
  createdAt: string;
  /** Кто импортировал; null — пользователь удалён. */
  userName: string | null;
  counts: ImportCounts;
  undoneAt: string | null;
  undoneByName: string | null;
  /** Только у status = 'done'. */
  pending: ImportPending | null;
}

/** Ответ GET …/imports: страница и id для «Показать ещё» (null — больше нет). */
export interface ImportListPage {
  items: ImportListItem[];
  nextBeforeId: number | null;
}
```

- [ ] **Step 4: Список и `pending` (`history.ts`)**

Создайте `src/server/modules/imports/history.ts`:

```ts
import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { ImportCounts, ImportListItem, ImportListPage, ImportListQuery, ImportPending } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { imports, operations, users } from '../../db/schema';

/**
 * Изменённая после импорта операция (§7.3 спецификации импорта): неудалённая, у которой version > 1 (правка, «Указать»,
 * массовое действие, удаление и восстановление) или есть вложение — любое, в том числе удалённое. Условие — для запроса
 * FROM operations без псевдонима.
 */
export const EDITED_SQL = sql`(operations.deleted_at IS NULL AND (operations.version > 1 OR EXISTS (SELECT 1 FROM attachments a WHERE a.operation_id = operations.id)))`;

/** Не больше id в одном IN (…): предел переменных SQLite — 32 766, импорт — до 50 000 операций. */
export const IN_CHUNK = 500;

/** Части списка id по IN_CHUNK. */
export function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Операции импортов, которые удалит отмена: всего и изменённых после импорта; импорта без операций в ответе нет. */
export function pendingCounts(ex: Executor, importIds: readonly number[]): Map<number, ImportPending> {
  const out = new Map<number, ImportPending>();
  for (const part of chunks(importIds)) {
    const rows = ex
      .select({
        importId: operations.importId,
        operations: sql<number>`count(*)`,
        edited: sql<number>`coalesce(sum(CASE WHEN ${EDITED_SQL} THEN 1 ELSE 0 END), 0)`,
      })
      .from(operations)
      .where(inArray(operations.importId, part))
      .groupBy(operations.importId)
      .all();
    for (const r of rows) if (r.importId !== null) out.set(r.importId, { operations: r.operations, edited: r.edited });
  }
  return out;
}

type ImportRow = typeof imports.$inferSelect;

function toItem(row: ImportRow, userName: string | null, undoneByName: string | null, pending: ImportPending | null): ImportListItem {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    status: row.status,
    createdAt: row.createdAt,
    userName,
    counts: JSON.parse(row.counts) as ImportCounts,
    undoneAt: row.undoneAt,
    undoneByName,
    pending: row.status === 'done' ? (pending ?? { operations: 0, edited: 0 }) : null,
  };
}

/** Записи импортов компании с именами пользователей и pending у неотменённых; новые сверху. */
function select(ex: Executor, conds: SQL[], limit: number): ImportListItem[] {
  const undoneBy = alias(users, 'undone_by_user');
  const rows = ex
    .select({ i: imports, userName: users.name, undoneByName: undoneBy.name })
    .from(imports)
    .leftJoin(users, eq(users.id, imports.userId))
    .leftJoin(undoneBy, eq(undoneBy.id, imports.undoneBy))
    .where(and(...conds))
    .orderBy(desc(imports.id))
    .limit(limit)
    .all();
  const pending = pendingCounts(
    ex,
    rows.filter((r) => r.i.status === 'done').map((r) => r.i.id),
  );
  return rows.map((r) => toItem(r.i, r.userName ?? null, r.undoneByName ?? null, pending.get(r.i.id) ?? null));
}

/** Список «Импорты» (§7.2): страница по beforeId; nextBeforeId — id последней записи полной страницы. */
export function listImports(ex: Executor, companyId: number, q: ImportListQuery): ImportListPage {
  const conds: SQL[] = [eq(imports.companyId, companyId)];
  if (q.beforeId !== undefined) conds.push(lt(imports.id, q.beforeId));
  const items = select(ex, conds, q.limit);
  const last = items.at(-1);
  return { items, nextBeforeId: items.length === q.limit && last ? last.id : null };
}

/** Одна запись импорта компании; null — нет такой. */
export function importItem(ex: Executor, companyId: number, id: number): ImportListItem | null {
  return select(ex, [eq(imports.companyId, companyId), eq(imports.id, id)], 1)[0] ?? null;
}
```

- [ ] **Step 5: Сервис и маршрут**

В `src/server/modules/imports/service.ts` замените

```ts
import type { ImportCommitRequest, ImportCommitResult, ImportCounts, ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
```

на

```ts
import type { ImportCommitRequest, ImportCommitResult, ImportCounts, ImportListPage, ImportListQuery, ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
```

Замените

```ts
import { writeImport, type ImportWriterDeps } from './commit';
```

на

```ts
import { writeImport, type ImportWriterDeps } from './commit';
import { listImports } from './history';
```

Замените

```ts
/** Импорт: проверка файла и запись (§5.2, §6.2, §6.4 спецификации импорта). Отмена — план И-3. */
```

на

```ts
/** Импорт: проверка файла, запись, список и отмена (§5.2, §6.2, §6.4, §7 спецификации импорта). */
```

Замените

```ts
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
}
```

на

```ts
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
  /** Список «Импорты» (§7.2): новые сверху, у неотменённых — pending; архивная компания — тоже (только чтение). */
  list(companyId: number, q: ImportListQuery): ImportListPage;
}
```

Замените

```ts
    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
    },
  };
```

на

```ts
    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
    },

    list(companyId, q) {
      requireCompany(db, companyId);
      return listImports(db, companyId, q);
    },
  };
```

В `src/server/modules/imports/routes.ts` замените

```ts
import { importCommitSchema, importRequestSchema } from '../../../shared/schemas/imports';
```

на

```ts
import { importCommitSchema, importListQuerySchema, importRequestSchema } from '../../../shared/schemas/imports';
```

Замените

```ts
  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
```

на

```ts
  // список «Импорты» (§7.2): новые сверху, «Показать ещё» — по beforeId
  app.get<C>(BASE, async (req) => imports.list(parseId(req.params.cid), importListQuerySchema.parse(req.query)));

  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-list.test.ts tests/server/imports-api.test.ts tests/server/import-commit.test.ts`
Expected: PASS.

- [ ] **Step 7: Full check**

Run: `npm test`
Expected: 1027 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 8: Commit**

```bash
git add src/shared/schemas/imports.ts src/server/modules/imports/history.ts src/server/modules/imports/service.ts src/server/modules/imports/routes.ts tests/helpers/imports.ts tests/server/import-list.test.ts
git commit -m "feat: импорт — список «Импорты»: GET …/imports с pending (всего и изменённых операций)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Отмена импорта на сервере — `undo.ts`, `POST …/imports/:id/undo`, `bench:import` (§6.2, §6.5, §7.3, §10)

**Files:**
- Modify: `src/shared/schemas/imports.ts`, `src/server/modules/imports/service.ts`, `src/server/modules/imports/routes.ts`, `scripts/bench-import.ts`
- Create: `src/server/modules/imports/undo.ts`
- Test: `tests/server/import-undo.test.ts`

**Interfaces:**
- Consumes: из задачи 1 — `EDITED_SQL`, `chunks`, `importItem` (`history.ts`), `importRows` (`tests/helpers/imports.ts`), `ImportListItem`; `ImportCreatedIds` (`commit.ts`); `PlannedAccountChange` (`preview.ts`); `changedFields`, `mutate` (`audit/mutate.ts`); `AuditEntry` (`audit/service.ts`); `todayInTimezone` (`shared/dates.ts`).
- Produces:
  - `src/shared/schemas/imports.ts`: `importUndoSchema` (`{ includeEdited: boolean; edited: number }`), `type ImportUndoRequest`, `type ImportCreatedEntity = 'account' | 'category' | 'counterparty' | 'project' | 'tag'`, `interface ImportKeptAccountField { accountId; name; field: 'startingBalance' | 'openedAt'; reason: 'changed' | 'operations' | 'archived' }`, `interface ImportUndoResult { deleted: { operations } & ImportCreatedCounts; kept: { operations; created: ImportCreatedCounts; names: { entity: ImportCreatedEntity; name }[]; accounts: ImportKeptAccountField[] } }`, `interface ImportUndoResponse { import: ImportListItem; result: ImportUndoResult }`;
  - `src/server/modules/imports/undo.ts`: `interface UndoInput { companyId; importId; userId; at: string; includeEdited: boolean; edited: number; timezone: string }`, `undoImport(tx: Executor, input: UndoInput, record: (entry: AuditEntry) => void): ImportUndoResult`;
  - `ImportsService.undo(companyId: number, userId: number, importId: number, body: ImportUndoRequest): ImportUndoResponse`;
  - маршрут `POST /api/v1/companies/:cid/imports/:id/undo` → 200 `ImportUndoResponse`; 404, 409 `IMPORT_UNDONE`, 409 `IMPORT_CHANGED`, 422 `ARCHIVED_REFERENCE`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-undo.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountMapping, ImportPreview, ImportUndoResponse } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeMany, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { importRows } from '../helpers/imports';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = '2026-10-06T12:00:00.000Z';
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, any>[];
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id as number;
const undoUrl = (id: number, cid = w.cid) => `/api/v1/companies/${cid}/imports/${id}/undo`;
const undo = (id: number, body: object = { includeEdited: false, edited: 0 }, cid = w.cid) => w.h.req('POST', undoUrl(id, cid), body);

/** Строки таблиц, которые меняют импорт и отмена (без истории и imports), и состояние счетов. */
const dataState = () =>
  one(
    `SELECT (SELECT COUNT(*) FROM operations) ops, (SELECT COUNT(*) FROM operation_lines) lines, (SELECT COUNT(*) FROM operation_tags) optags,
            (SELECT COUNT(*) FROM attachments) files, (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM categories) categories,
            (SELECT COUNT(*) FROM counterparties) cps, (SELECT COUNT(*) FROM projects) projects, (SELECT COUNT(*) FROM tags) tags,
            (SELECT group_concat(id || ':' || starting_balance || '/' || opened_at) FROM accounts) accountState`,
  );
/** Вместе с историей и imports: «ничего не изменилось». */
const fullState = () => ({ ...dataState(), audit: one('SELECT COUNT(*) n FROM audit_log').n, imports: one("SELECT group_concat(id || ':' || status) s FROM imports").s });

/**
 * Доход на существующую «Кассу» раньше её даты открытия (перенос openedAt), зарплата с новой подкатегорией и новым
 * контрагентом, перевод на новый счёт «Банк-2» с новым проектом, расход с «Банка-2» с новыми категорией, подкатегорией,
 * контрагентом и тегом «Ночь» (тег «Смена» уже есть).
 */
const FILE = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы', counterparty: 'Сотрудник А' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2', project: 'Клуб 9' }),
  fr({
    paidAt: at('2026-10-05', '00:30:00'),
    amount: 8200.5,
    from: 'Банк-2',
    category: 'Связь',
    subcategory: 'Интернет',
    counterparty: 'Поставщик Б',
    tags: 'Смена, Ночь',
  }),
];
const MAPPINGS: AccountMapping[] = [
  { key: 'касса', kind: 'existing', accountId: 0, targetBalance: 2_000_000 },
  { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1_000_000 } },
];
const mappings = (): AccountMapping[] => MAPPINGS.map((m) => (m.kind === 'existing' ? { ...m, accountId: w.kzt } : m));
const opId = (importId: number, type: string, amount: number) => one('SELECT id FROM operations WHERE import_id = ? AND type = ? AND amount = ?', importId, type, amount).id as number;

describe('POST …/imports/:id/undo — отмена (§7.3 спецификации импорта)', () => {
  it('чистая отмена: база как до импорта — счета (openedAt и startingBalance), справочники, системные категории; imports — undone; история', async () => {
    w = await opsWorld(NOW);
    const before = dataState();
    const systemBefore = all('SELECT id FROM categories WHERE company_id = ? AND system_key IS NOT NULL ORDER BY id', w.cid);
    const r = await importRows(w, FILE, { accounts: mappings() });
    expect(one('SELECT opened_at FROM accounts WHERE id = ?', w.kzt).opened_at).toBe('2026-09-20');
    const auditBefore = one('SELECT MAX(id) m FROM audit_log').m as number;

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ImportUndoResponse;
    expect(body.result).toEqual({
      deleted: { operations: 4, accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 },
      kept: { operations: 0, created: { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 }, names: [], accounts: [] },
    });
    expect(body.import).toMatchObject({ id: r.import.id, status: 'undone', undoneAt: NOW, undoneByName: 'Тест', pending: null });

    // база как до импорта: «Касса» — прежние стартовый баланс и дата открытия; системные категории на месте
    expect(dataState()).toEqual(before);
    expect(all('SELECT id FROM categories WHERE company_id = ? AND system_key IS NOT NULL ORDER BY id', w.cid)).toEqual(systemBefore);
    const row = one('SELECT status, undone_at, undone_by, undo_result FROM imports WHERE id = ?', r.import.id);
    expect(row).toMatchObject({ status: 'undone', undone_at: NOW, undone_by: adminId() });
    expect(JSON.parse(row.undo_result)).toEqual(body.result);

    // история: удаление созданного с importId, возврат «Кассы», запись отмены; операций без своей истории — нет
    const audit = all('SELECT entity, action, entity_id eid, diff FROM audit_log WHERE id > ? ORDER BY id', auditBefore).map((a) => ({
      entity: a.entity as string,
      action: a.action as string,
      eid: a.eid as number,
      diff: JSON.parse(a.diff),
    }));
    expect(audit.map((a) => `${a.entity} ${a.action}`)).toEqual([
      'category delete',
      'category delete',
      'category delete',
      'counterparty delete',
      'counterparty delete',
      'tag delete',
      'account delete',
      'project delete',
      'account update',
      'import delete',
    ]);
    expect(audit.slice(0, -1).every((a) => a.diff.importId === r.import.id)).toBe(true);
    expect(audit[0]!.diff).toEqual({ kind: 'expense', name: 'Администраторы', parentId: expect.any(Number), importId: r.import.id });
    expect(audit[8]!.diff).toEqual({
      before: { startingBalance: expect.any(Number), openedAt: '2026-09-20' },
      after: { startingBalance: 0, openedAt: '2026-10-01' },
      importId: r.import.id,
    });
    expect(audit[9]).toEqual({ entity: 'import', action: 'delete', eid: r.import.id, diff: { fileName: 'выгрузка.xlsx', ...body.result } });

    // тот же файл после отмены — не дубликаты и без W8 «уже импортирован»
    const again = await w.h.t.app.inject({
      method: 'POST',
      url: `/api/v1/companies/${w.cid}/imports/upload`,
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
      payload: finmapLikeXlsx(FILE),
    });
    const p = again.json() as ImportPreview;
    expect(p.counts).toMatchObject({ add: 4, duplicates: 0 });
    expect(p.warnings.map((g) => g.code)).not.toContain('W8');
  });

  it('изменённая после импорта операция без флажка остаётся вместе со своими справочниками; мягко удалённая удаляется всегда', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const internet = opId(r.import.id, 'expense', 820_050);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'проверено' })).statusCode).toBe(200);
    const salary = opId(r.import.id, 'expense', 850_000);
    expect((await w.h.req('DELETE', `${w.ops}/${salary}`)).statusCode).toBe(200);

    const res = await undo(r.import.id, { includeEdited: false, edited: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 3, accounts: 0, categories: 1, counterparties: 1, projects: 1, tags: 0 });
    expect(result.kept).toEqual({
      operations: 1,
      created: { accounts: 1, categories: 2, counterparties: 1, projects: 0, tags: 1 },
      names: [
        { entity: 'category', name: 'Интернет' },
        { entity: 'category', name: 'Связь' },
        { entity: 'counterparty', name: 'Поставщик Б' },
        { entity: 'tag', name: 'Ночь' },
        { entity: 'account', name: 'Банк-2' },
      ],
      accounts: [],
    });
    // осталась только изменённая; «Касса» без операций импорта — прежние стартовый баланс и дата открытия
    expect(all('SELECT id, comment, import_id FROM operations WHERE company_id = ?', w.cid)).toEqual([{ id: internet, comment: 'проверено', import_id: r.import.id }]);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual({ starting_balance: 0, opened_at: '2026-10-01' });
    // мягко удалённая зарплата удалена жёстко, «Администраторы» и «Сотрудник А» свободны и удалены
    expect(one("SELECT COUNT(*) n FROM categories WHERE name = 'Администраторы'").n).toBe(0);
    expect(one("SELECT COUNT(*) n FROM counterparties WHERE name = 'Сотрудник А'").n).toBe(0);
    // записи удаления операций в истории нет: изменённая осталась, а у удалённой уже есть своя запись удаления
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'operation' AND action = 'delete'").n).toBe(1);
    expect((await undo(r.import.id)).statusCode).toBe(409);
  });

  it('«Удалить и изменённые»: удаляются и они — сначала записи вложений; у изменённых — запись удаления в истории', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const internet = opId(r.import.id, 'expense', 820_050);
    const income = opId(r.import.id, 'income', 1_059_600);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'проверено' })).statusCode).toBe(200);
    w.h.t.sqlite
      .prepare("INSERT INTO attachments (company_id, operation_id, original_name, stored_name, mime, size, created_at) VALUES (?, ?, 'чек.png', 'x.png', 'image/png', 1, ?)")
      .run(w.cid, income, NOW);

    const res = await undo(r.import.id, { includeEdited: true, edited: 2 });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 4, accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 });
    expect(result.kept.operations).toBe(0);
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM attachments').n).toBe(0);
    const deletes = all("SELECT entity_id, diff FROM audit_log WHERE entity = 'operation' AND action = 'delete' ORDER BY entity_id");
    expect(deletes.map((d) => [d.entity_id, JSON.parse(d.diff)])).toEqual([
      [income, { type: 'income', amount: 1_059_600, accountId: w.kzt, paidAt: '2026-09-20T05:00:00.000Z', importId: r.import.id }],
      [internet, { type: 'expense', amount: 820_050, accountId: expect.any(Number), paidAt: '2026-10-04T19:30:00.000Z', importId: r.import.id }],
    ]);
  });

  it('использованное после импорта остаётся: контрагент в новой операции; «Касса» — стартовый баланс изменён, операция раньше прежней даты открытия', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const employee = one("SELECT id FROM counterparties WHERE name = 'Сотрудник А'").id as number;
    await w.post(w.ops, {
      type: 'expense',
      paidAt: '2026-09-25T06:00:00.000Z',
      accrualDate: null,
      accountId: w.kzt,
      amount: 100,
      toAccountId: null,
      toAmount: null,
      counterpartyId: employee,
      comment: null,
      lines: [{ categoryId: w.expense, projectId: null, amount: 100 }],
      tagIds: [],
    });
    const patch = await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { startingBalance: 777 });
    expect(patch.statusCode, patch.body).toBe(200);

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.kept.names).toEqual([{ entity: 'counterparty', name: 'Сотрудник А' }]);
    expect(result.kept.accounts).toEqual([
      { accountId: w.kzt, name: 'Касса', field: 'startingBalance', reason: 'changed' },
      { accountId: w.kzt, name: 'Касса', field: 'openedAt', reason: 'operations' },
    ]);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual({ starting_balance: 777, opened_at: '2026-09-20' });
    // ни одной записи «account update» от отмены: оба поля оставлены
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'account' AND action = 'update' AND diff LIKE '%importId%' AND id > (SELECT MAX(id) FROM audit_log WHERE entity = 'import' AND action = 'create')").n).toBe(0);
  });

  it('архивный счёт удаляемой операции — 422, ничего не изменилось; из архива — отмена проходит', async () => {
    w = await opsWorld(NOW);
    // остаток «Банка-2» после импорта — 0: такой счёт можно перевести в архив
    const zeroBank: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 0 } }];
    const r = await importRows(w, FILE, { accounts: zeroBank });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    await w.post(`/api/v1/companies/${w.cid}/accounts/${bank}/archive`, {});
    const before = fullState();
    const res = await undo(r.import.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'ARCHIVED_REFERENCE', message: 'Счёт «Банк-2» в архиве — верните его из архива, чтобы отменить импорт' });
    expect(fullState()).toEqual(before);
    await w.post(`/api/v1/companies/${w.cid}/accounts/${bank}/unarchive`, {});
    expect((await undo(r.import.id)).statusCode).toBe(200);
  });

  it('повтор — 409 IMPORT_UNDONE; чужая компания — 404; архивная компания — 422; изменённых стало больше, чем видел человек, — 409 IMPORT_CHANGED; неверное тело — 400', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const other = await w.h.company('Другая');
    expect((await undo(r.import.id, undefined, other)).statusCode).toBe(404);
    expect((await undo(r.import.id, { includeEdited: true })).statusCode).toBe(400);

    // с флажком: человек видел 0 изменённых, а за это время одну операцию изменили — ничего не удалено
    const internet = opId(r.import.id, 'expense', 820_050);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'правка' })).statusCode).toBe(200);
    const before = fullState();
    const changed = await undo(r.import.id, { includeEdited: true, edited: 0 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toMatchObject({
      code: 'IMPORT_CHANGED',
      message: 'После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз',
      details: { pending: { operations: 4, edited: 1 } },
    });
    expect(fullState()).toEqual(before);
    // без флажка изменённая просто остаётся — согласие не нужно
    expect((await undo(r.import.id, { includeEdited: false, edited: 0 })).statusCode).toBe(200);
    const again = await undo(r.import.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'IMPORT_UNDONE', message: 'Импорт уже отменён' });

    // архивная компания (без операций и счетов) — 422 до всего остального
    const empty = await w.h.company('Пустая');
    const r2 = await importRows(w, [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 1, to: 'Сейф' })], { cid: empty, accounts: [{ key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'current', amount: 0 } }] });
    const safe = one('SELECT id FROM accounts WHERE company_id = ?', empty).id as number;
    await w.post(`/api/v1/companies/${empty}/accounts/${safe}/archive`, {});
    expect((await w.h.req('POST', `/api/v1/companies/${empty}/archive`, {})).statusCode).toBe(200);
    const archived = await undo(r2.import.id, undefined, empty);
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.message).toBe('Компания в архиве — изменения недоступны');
  });

  it('16 000 строк: отмена укладывается в 20 с, операций импорта не осталось', { timeout: 120_000 }, async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, finmapLikeMany(16_000));
    const t0 = performance.now();
    const res = await undo(r.import.id);
    const ms = performance.now() - t0;
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect((res.json() as ImportUndoResponse).result.deleted.operations).toBe(16_000);
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    // бюджет §10 — 3 с на эталонной машине (bench:import); здесь — с запасом для медленного CI
    expect(ms).toBeLessThan(20_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-undo.test.ts`
Expected: FAIL — `POST …/imports/:id/undo` отвечает 404 вместо 200 (маршрута ещё нет).

- [ ] **Step 3: Схема отмены**

Добавьте в конец `src/shared/schemas/imports.ts`:

```ts
/**
 * Тело POST …/imports/:id/undo (§6.2, §7.3): удалять ли изменённые после импорта операции и сколько изменённых видел
 * человек в подтверждении (pending.edited). С includeEdited изменённых стало больше — 409 IMPORT_CHANGED (решение 4 плана И-3).
 */
export const importUndoSchema = z.object({
  includeEdited: z.boolean(),
  edited: z.number().int().min(0),
});
export type ImportUndoRequest = z.infer<typeof importUndoSchema>;

/** Справочник, который создал импорт. */
export type ImportCreatedEntity = 'account' | 'category' | 'counterparty' | 'project' | 'tag';

/** Поле существующего счёта, которое отмена не вернула: изменено после импорта, есть операции раньше прежней даты, счёт в архиве. */
export interface ImportKeptAccountField {
  accountId: number;
  name: string;
  field: 'startingBalance' | 'openedAt';
  reason: 'changed' | 'operations' | 'archived';
}

/** Итог отмены (§7.3): imports.undo_result и ответ отмены. */
export interface ImportUndoResult {
  deleted: { operations: number } & ImportCreatedCounts;
  kept: {
    /** Изменённые после импорта операции, которые остались (без «Удалить и изменённые»). */
    operations: number;
    /** Созданное импортом, которое используется и осталось, — по видам. */
    created: ImportCreatedCounts;
    /** Первые 20 названий оставленного созданного. */
    names: { entity: ImportCreatedEntity; name: string }[];
    /** Поля существующих счетов, которые остались как есть. */
    accounts: ImportKeptAccountField[];
  };
}

/** Ответ 200 POST …/imports/:id/undo: запись импорта после отмены и итог. */
export interface ImportUndoResponse {
  import: ImportListItem;
  result: ImportUndoResult;
}
```

- [ ] **Step 4: Отмена (`undo.ts`)**

Создайте `src/server/modules/imports/undo.ts`:

```ts
import { and, eq, inArray, isNotNull, isNull, min, or, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportCreatedCounts, ImportCreatedEntity, ImportKeptAccountField, ImportUndoResult } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { accounts, attachments, categories, counterparties, imports, operationLines, operations, operationTags, projects, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields } from '../audit/mutate';
import type { AuditEntry } from '../audit/service';
import type { ImportCreatedIds } from './commit';
import { chunks, EDITED_SQL } from './history';
import type { PlannedAccountChange } from './preview';

export interface UndoInput {
  companyId: number;
  importId: number;
  userId: number;
  /** Момент отмены: imports.undone_at. */
  at: string;
  /** «Удалить и изменённые». */
  includeEdited: boolean;
  /** Сколько изменённых операций видел человек в подтверждении. */
  edited: number;
  timezone: string;
}

/** Множественное число вида — ключ ImportCreatedCounts. */
const PLURAL: Record<ImportCreatedEntity, keyof ImportCreatedCounts> = {
  account: 'accounts',
  category: 'categories',
  counterparty: 'counterparties',
  project: 'projects',
  tag: 'tags',
};
const zero = (): ImportCreatedCounts => ({ accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 });
/** Не больше названий оставленного в итоге. */
const KEPT_NAMES_MAX = 20;

/** Есть ли хоть одна строка: «используется». */
const exists = (row: unknown) => row !== undefined;

/**
 * Отмена импорта внутри транзакции вызывающего (§7.3 спецификации импорта): проверки, жёсткое удаление операций импорта
 * (изменённые — только с includeEdited), удаление неиспользуемых созданных справочников и счетов, возврат стартового
 * баланса и даты открытия существующих счетов, отметка imports и история (§6.5). Ошибка — исключение: вызывающий
 * откатывает всё.
 */
export function undoImport(tx: Executor, input: UndoInput, record: (entry: AuditEntry) => void): ImportUndoResult {
  const { companyId, importId, userId } = input;
  const row = tx.select().from(imports).where(and(eq(imports.id, importId), eq(imports.companyId, companyId))).get();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Импорт не найден');
  if (row.status !== 'done') throw new AppError(409, 'IMPORT_UNDONE', 'Импорт уже отменён');

  // операции импорта: изменённые после импорта остаются без «Удалить и изменённые»
  const ops = tx
    .select({
      id: operations.id,
      type: operations.type,
      amount: operations.amount,
      accountId: operations.accountId,
      toAccountId: operations.toAccountId,
      paidAt: operations.paidAt,
      edited: sql<number>`${EDITED_SQL}`,
    })
    .from(operations)
    .where(eq(operations.importId, importId))
    .all();
  const editedCount = ops.filter((o) => o.edited === 1).length;
  // пока человек читал подтверждение, изменили ещё операции: с флажком они удалились бы без его ведома
  if (input.includeEdited && editedCount > input.edited) {
    throw new AppError(
      409,
      'IMPORT_CHANGED',
      'После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз',
      undefined,
      { pending: { operations: ops.length, edited: editedCount } },
    );
  }
  const doomed = input.includeEdited ? ops : ops.filter((o) => o.edited !== 1);

  // инвариант 7: операции архивного счёта не удаляются
  const touched = [...new Set(doomed.flatMap((o) => (o.toAccountId === null ? [o.accountId] : [o.accountId, o.toAccountId])))];
  for (const part of chunks(touched)) {
    const archived = tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(and(inArray(accounts.id, part), isNotNull(accounts.archivedAt)))
      .get();
    if (archived) throw new AppError(422, 'ARCHIVED_REFERENCE', `Счёт «${archived.name}» в архиве — верните его из архива, чтобы отменить импорт`);
  }

  // жёсткое удаление: сначала записи вложений (файлы на диске остаются), строки и теги — каскадом
  for (const part of chunks(doomed.map((o) => o.id))) {
    tx.delete(attachments).where(inArray(attachments.operationId, part)).run();
    tx.delete(operations).where(inArray(operations.id, part)).run();
  }
  // у изменённых есть своя история в панели: запись удаления, чтобы панель не предлагала их открыть (§6.5)
  for (const o of doomed) {
    if (o.edited !== 1) continue;
    record({ companyId, userId, entity: 'operation', entityId: o.id, action: 'delete', diff: { type: o.type, amount: o.amount, accountId: o.accountId, paidAt: o.paidAt, importId } });
  }

  const deleted = { operations: doomed.length, ...zero() };
  const keptCreated = zero();
  const keptNames: ImportUndoResult['kept']['names'] = [];
  const keep = (entity: ImportCreatedEntity, name: string) => {
    keptCreated[PLURAL[entity]]++;
    if (keptNames.length < KEPT_NAMES_MAX) keptNames.push({ entity, name });
  };
  const remove = (entity: ImportCreatedEntity, id: number, diff: Record<string, unknown>) => {
    deleted[PLURAL[entity]]++;
    record({ companyId, userId, entity, entityId: id, action: 'delete', diff: { ...diff, importId } });
  };

  // созданное импортом — если ещё есть и больше не используется (ссылки считают и мягко удалённые операции, инвариант 9)
  const created = JSON.parse(row.created) as Partial<ImportCreatedIds>;
  const load = <T>(ids: number[] | undefined, fn: (part: number[]) => T[]): T[] => chunks(ids ?? []).flatMap(fn);

  // 1–2: подкатегории, затем категории верхнего уровня (у оставшейся категории не должно быть детей)
  const cats = load(created.categories, (part) => tx.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, part))).all());
  for (const c of [...cats.filter((x) => x.parentId !== null), ...cats.filter((x) => x.parentId === null)]) {
    const used =
      exists(tx.select({ id: operationLines.id }).from(operationLines).where(eq(operationLines.categoryId, c.id)).limit(1).get()) ||
      exists(tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, c.id)).limit(1).get());
    if (used) keep('category', c.name);
    else {
      tx.delete(categories).where(eq(categories.id, c.id)).run();
      remove('category', c.id, { kind: c.kind, name: c.name, parentId: c.parentId });
    }
  }
  // 3: контрагенты
  const cps = load(created.counterparties, (part) =>
    tx.select().from(counterparties).where(and(eq(counterparties.companyId, companyId), inArray(counterparties.id, part))).all(),
  );
  for (const c of cps) {
    if (exists(tx.select({ id: operations.id }).from(operations).where(eq(operations.counterpartyId, c.id)).limit(1).get())) keep('counterparty', c.name);
    else {
      tx.delete(counterparties).where(eq(counterparties.id, c.id)).run();
      remove('counterparty', c.id, { type: c.type, name: c.name });
    }
  }
  // 4: теги
  const tgs = load(created.tags, (part) => tx.select().from(tags).where(and(eq(tags.companyId, companyId), inArray(tags.id, part))).all());
  for (const t of tgs) {
    if (exists(tx.select({ id: operationTags.operationId }).from(operationTags).where(eq(operationTags.tagId, t.id)).limit(1).get())) keep('tag', t.name);
    else {
      tx.delete(tags).where(eq(tags.id, t.id)).run();
      remove('tag', t.id, { name: t.name });
    }
  }
  // 5: счета без операций
  const accs = load(created.accounts, (part) => tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, part))).all());
  for (const a of accs) {
    const used = tx
      .select({ id: operations.id })
      .from(operations)
      .where(or(eq(operations.accountId, a.id), eq(operations.toAccountId, a.id)))
      .limit(1)
      .get();
    if (exists(used)) keep('account', a.name);
    else {
      tx.delete(accounts).where(eq(accounts.id, a.id)).run();
      remove('account', a.id, { name: a.name, currency: a.currency });
    }
  }
  // 6: проекты — без операций и без счетов
  const prjs = load(created.projects, (part) => tx.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, part))).all());
  for (const p of prjs) {
    const used =
      exists(tx.select({ id: operationLines.id }).from(operationLines).where(eq(operationLines.projectId, p.id)).limit(1).get()) ||
      exists(tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.projectId, p.id)).limit(1).get());
    if (used) keep('project', p.name);
    else {
      tx.delete(projects).where(eq(projects.id, p.id)).run();
      remove('project', p.id, { name: p.name, templateKey: p.templateKey });
    }
  }

  // существующие счета: поле возвращается к значению до импорта, если с импорта его не меняли; дата открытия — ещё и
  // если не осталось операций раньше прежней даты (инвариант 6); счёт в архиве не меняется (решение 3 плана И-3)
  const keptAccounts: ImportKeptAccountField[] = [];
  for (const change of JSON.parse(row.accountChanges) as PlannedAccountChange[]) {
    const acc = tx.select().from(accounts).where(and(eq(accounts.id, change.accountId), eq(accounts.companyId, companyId))).get();
    if (!acc) continue;
    const patch: { startingBalance?: number; openedAt?: string } = {};
    for (const field of ['startingBalance', 'openedAt'] as const) {
      if (change.before[field] === change.after[field]) continue;
      let reason: ImportKeptAccountField['reason'] | null = null;
      if (acc.archivedAt) reason = 'archived';
      else if (acc[field] !== change.after[field]) reason = 'changed';
      else if (field === 'openedAt') {
        const first = tx
          .select({ first: min(operations.paidAt) })
          .from(operations)
          .where(and(or(eq(operations.accountId, acc.id), eq(operations.toAccountId, acc.id)), isNull(operations.deletedAt)))
          .get()?.first;
        if (first && todayInTimezone(input.timezone, new Date(first)) < change.before.openedAt) reason = 'operations';
      }
      if (reason) keptAccounts.push({ accountId: acc.id, name: acc.name, field, reason });
      else if (field === 'startingBalance') patch.startingBalance = change.before.startingBalance;
      else patch.openedAt = change.before.openedAt;
    }
    const changes = changedFields({ startingBalance: acc.startingBalance, openedAt: acc.openedAt }, patch);
    if (!changes) continue;
    tx.update(accounts).set(patch).where(eq(accounts.id, acc.id)).run();
    record({ companyId, userId, entity: 'account', entityId: acc.id, action: 'update', diff: { ...changes, importId } });
  }

  const result: ImportUndoResult = {
    deleted,
    kept: { operations: ops.length - doomed.length, created: keptCreated, names: keptNames, accounts: keptAccounts },
  };
  tx.update(imports).set({ status: 'undone', undoneAt: input.at, undoneBy: userId, undoResult: JSON.stringify(result) }).where(eq(imports.id, importId)).run();
  record({ companyId, userId, entity: 'import', entityId: importId, action: 'delete', diff: { fileName: row.fileName, ...result } });
  return result;
}
```

- [ ] **Step 5: Сервис и маршрут**

В `src/server/modules/imports/service.ts` замените

```ts
import type { ImportCommitRequest, ImportCommitResult, ImportCounts, ImportListPage, ImportListQuery, ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
```

на

```ts
import type {
  ImportCommitRequest,
  ImportCommitResult,
  ImportCounts,
  ImportListPage,
  ImportListQuery,
  ImportPreview,
  ImportRequest,
  ImportUndoRequest,
  ImportUndoResponse,
} from '../../../shared/schemas/imports';
```

Замените

```ts
import { listImports } from './history';
```

на

```ts
import { importItem, listImports } from './history';
```

Замените

```ts
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';
```

на

```ts
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';
import { undoImport } from './undo';
```

Замените

```ts
  list(companyId: number, q: ImportListQuery): ImportListPage;
}
```

на

```ts
  list(companyId: number, q: ImportListQuery): ImportListPage;
  /**
   * Отмена одной транзакцией (§7.3), блокировка записи — до проверок: импорт другой компании — 404; уже отменён — 409
   * IMPORT_UNDONE; с includeEdited изменённых больше, чем видел человек, — 409 IMPORT_CHANGED; архивная компания или
   * архивный счёт удаляемой операции — 422 ARCHIVED_REFERENCE.
   */
  undo(companyId: number, userId: number, importId: number, body: ImportUndoRequest): ImportUndoResponse;
}
```

Замените

```ts
    list(companyId, q) {
      requireCompany(db, companyId);
      return listImports(db, companyId, q);
    },
  };
```

на

```ts
    list(companyId, q) {
      requireCompany(db, companyId);
      return listImports(db, companyId, q);
    },

    undo(companyId, userId, importId, body) {
      requireCompany(db, companyId, { writable: true });
      // BEGIN IMMEDIATE: две отмены одного импорта не пройдут обе — вторая увидит status = 'undone' (409)
      const result = mutate(
        db,
        d.audit,
        (tx, audit) => {
          // компания могла уйти в архив после проверки выше (другой процесс): проверка — уже под блокировкой записи
          requireCompany(tx, companyId, { writable: true });
          return undoImport(tx, { companyId, importId, userId, at: now().toISOString(), timezone, ...body }, audit);
        },
        { behavior: 'immediate' },
      );
      return { import: importItem(db, companyId, importId)!, result };
    },
  };
```

В `src/server/modules/imports/routes.ts` замените

```ts
import { importCommitSchema, importListQuerySchema, importRequestSchema } from '../../../shared/schemas/imports';
```

на

```ts
import { importCommitSchema, importListQuerySchema, importRequestSchema, importUndoSchema } from '../../../shared/schemas/imports';
```

Замените

```ts
  app.get<C>(BASE, async (req) => imports.list(parseId(req.params.cid), importListQuerySchema.parse(req.query)));
```

на

```ts
  app.get<C>(BASE, async (req) => imports.list(parseId(req.params.cid), importListQuerySchema.parse(req.query)));

  app.post<{ Params: { cid: string; id: string } }>(`${BASE}/:id/undo`, async (req) => {
    const companyId = parseId(req.params.cid);
    const importId = parseId(req.params.id);
    const started = performance.now();
    const result = imports.undo(companyId, req.user!.id, importId, importUndoSchema.parse(req.body));
    // итог — числа, без названий (§6.5)
    req.log.info(
      { companyId, userId: req.user!.id, importId, deleted: result.result.deleted.operations, kept: result.result.kept.operations, ms: Math.round(performance.now() - started) },
      'Импорт отменён',
    );
    return result;
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-undo.test.ts tests/server/import-list.test.ts tests/server/import-commit.test.ts`
Expected: PASS.

- [ ] **Step 7: Отмена в `bench:import`**

В `scripts/bench-import.ts` замените

```ts
import type { ImportCommitResult, ImportPreview } from '../src/shared/schemas/imports';
```

на

```ts
import type { ImportCommitResult, ImportPreview, ImportUndoResponse } from '../src/shared/schemas/imports';
```

Замените

```ts
// 1) «write» — синтетический файл «как у Finmap» на 16 000 строк: загрузка с проверкой, пересчёт предпросмотра и запись
//    одной транзакцией (бюджеты 3 с, 1 с, 5 с) и пик памяти процесса за всё это (бюджет 400 МБ);
```

на

```ts
// 1) «write» — синтетический файл «как у Finmap» на 16 000 строк: загрузка с проверкой, пересчёт предпросмотра, запись
//    одной транзакцией и отмена (бюджеты 3 с, 1 с, 5 с, 3 с) и пик памяти процесса за всё это (бюджет 400 МБ);
```

Замените

```ts
const BUDGET_MS = { upload: 3000, preview: 1000, commit: 5000 };
```

на

```ts
const BUDGET_MS = { upload: 3000, preview: 1000, commit: 5000, undo: 3000 };
```

Замените

```ts
      if ((res.json() as ImportCommitResult).counts.added !== rows) throw new Error(`Записаны не все ${rows} операций`);
      return ms;
    };
```

на

```ts
      const result = res.json() as ImportCommitResult;
      if (result.counts.added !== rows) throw new Error(`Записаны не все ${rows} операций`);
      return { ms, importId: result.import.id };
    };
```

Замените

```ts
      report('Запись одной транзакцией (POST /imports)', await commit(cid, again.json() as ImportPreview, 16_000), BUDGET_MS.commit);
      reportPeak('Пик памяти процесса: загрузка, пересчёт и запись 16 000 строк', RSS_BUDGET_16K_MB);
```

на

```ts
      const written = await commit(cid, again.json() as ImportPreview, 16_000);
      report('Запись одной транзакцией (POST /imports)', written.ms, BUDGET_MS.commit);
      // отмена (§7.3): жёсткое удаление 16 000 операций и созданных справочников одной транзакцией
      const t2 = performance.now();
      const undone = await app.inject({ method: 'POST', url: `/api/v1/companies/${cid}/imports/${written.importId}/undo`, headers, payload: { includeEdited: false, edited: 0 } });
      if (undone.statusCode !== 200) throw new Error(`Отмена: ${undone.statusCode} ${undone.body.slice(0, 300)}`);
      if ((undone.json() as ImportUndoResponse).result.deleted.operations !== 16_000) throw new Error('Отмена удалила не все 16 000 операций');
      report('Отмена (POST /imports/:id/undo)', performance.now() - t2, BUDGET_MS.undo);
      reportPeak('Пик памяти процесса: загрузка, пересчёт, запись и отмена 16 000 строк', RSS_BUDGET_16K_MB);
```

Замените

```ts
      report('Запись 50 000 строк одной транзакцией', await commit(cid, up.preview, 50_000));
```

на

```ts
      report('Запись 50 000 строк одной транзакцией', (await commit(cid, up.preview, 50_000)).ms);
```

Run: `npm run bench:import`
Expected: в замере «Запись 16 000 строк» — строка «Отмена (POST /imports/:id/undo) … OK (бюджет 3000 мс)» (у планировщика — около 270 мс) и итог «Итог: все бюджеты соблюдены». «ПРЕВЫШЕН» в строке отмены или в пике памяти 16 000 строк — остановитесь и сообщите контролёру с цифрами. «ПРЕВЫШЕН» только в пике памяти 50 000 строк (этот замер задача не меняет; у планировщика 494 МБ при бюджете 500 МБ) — запишите цифры в отчёт задачи и продолжайте. Цифры — в отчёт задачи для итогов плана.

- [ ] **Step 8: Full check**

Run: `npm test`
Expected: 1034 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 9: Commit**

```bash
git add src/shared/schemas/imports.ts src/server/modules/imports/undo.ts src/server/modules/imports/service.ts src/server/modules/imports/routes.ts scripts/bench-import.ts tests/server/import-undo.test.ts
git commit -m "feat: импорт — отмена одной транзакцией: операции, неиспользуемые справочники и счета, возврат счетов, история; bench:import" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ConfirmDialog.cancelLabel`, вкладки «Журнал | Импорты» и список импортов (§7.1, §7.2, §13)

**Files:**
- Modify: `src/client/components/ConfirmDialog.tsx`, `src/client/lib/import-panel.ts`, `src/client/lib/queries.ts`, `src/client/components/HistoryDrawer.tsx`
- Create: `src/client/lib/import-history.ts`, `src/client/components/import/ImportHistory.tsx`
- Test: `tests/client/import-history.test.ts`, `e2e/import-history.spec.ts`

**Interfaces:**
- Consumes: из задачи 1 — `ImportListItem`, `ImportListPage`, маршрут `GET …/imports`; `formatDateTime`, `formatDateTimeSec` (`shared/dates.ts`); `formatCount` (`lib/import-panel.ts`); `useMeta` (`lib/query.ts`); `Pending` (`components/QueryState.tsx`); `btnSecondary` (`components/ui.ts`).
- Produces:
  - `ConfirmDialogProps.cancelLabel?: string` — подпись левой кнопки, по умолчанию «Отменить»;
  - `lib/import-panel.ts`: `operationsText(n: number): string` («1 230 операций») — экспорт вместо внутренней `operations`;
  - `lib/import-history.ts`: `type HistoryTab = 'log' | 'imports'`, `HISTORY_TABS`, `tabAfterKey(current: HistoryTab, key: string): HistoryTab | null`, `importAddedText(item): string`, `importUndoneText(item, timeZone): string | null`, `importMetaText(item, timeZone): string`;
  - `lib/queries.ts`: `useImports(companyId: number)` — бесконечный запрос `['imports', companyId]`, страницы по 20, `refetchOnMount: 'always'`;
  - `components/import/ImportHistory.tsx`: `ImportHistory({ company })` — в задаче 4 получит `onFocusLost`;
  - `components/HistoryDrawer.tsx`: внутренний `HistoryTabs`; `HistoryPanel` и `HistoryButton` — без изменений сигнатуры.

- [ ] **Step 1: Write the failing test**

Создайте `tests/client/import-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HISTORY_TABS, importAddedText, importMetaText, importUndoneText, tabAfterKey } from '../../src/client/lib/import-history';
import type { ImportListItem } from '../../src/shared/schemas/imports';

const TZ = 'Asia/Almaty';

/** Запись списка: импорт 12.10.2026 15:02:11 по Алматы, 1 230 операций. */
function item(over: Partial<ImportListItem> = {}): ImportListItem {
  return {
    id: 7,
    fileName: 'выгрузка.xlsx',
    fileSize: 1000,
    status: 'done',
    createdAt: '2026-10-12T10:02:11.000Z',
    userName: 'Сотрудник А',
    counts: { rows: 1_230, income: 700, expense: 496, transfer: 34, added: 1_230, duplicates: 0, skippedFuture: 0 },
    undoneAt: null,
    undoneByName: null,
    pending: { operations: 1_230, edited: 0 },
    ...over,
  };
}

describe('вкладки «Журнал | Импорты» (§7.1 спецификации импорта)', () => {
  it('две вкладки; ←/→ по кругу, Home и End — крайние, другие клавиши — null', () => {
    expect(HISTORY_TABS.map((t) => t.label)).toEqual(['Журнал', 'Импорты']);
    expect(tabAfterKey('log', 'ArrowRight')).toBe('imports');
    expect(tabAfterKey('imports', 'ArrowRight')).toBe('log');
    expect(tabAfterKey('log', 'ArrowLeft')).toBe('imports');
    expect(tabAfterKey('imports', 'Home')).toBe('log');
    expect(tabAfterKey('log', 'End')).toBe('imports');
    expect(tabAfterKey('log', 'Enter')).toBeNull();
    expect(tabAfterKey('log', 'ArrowDown')).toBeNull();
  });
});

describe('запись списка «Импорты» (§7.2)', () => {
  it('добавлено и дубликаты; кто и когда — до секунд по часам компании', () => {
    expect(importAddedText(item())).toBe('Добавлено 1\u202F230 операций · пропущено дубликатов 0');
    expect(importAddedText(item({ counts: { ...item().counts, added: 1, duplicates: 3 } }))).toBe('Добавлено 1 операция · пропущено дубликатов 3');
    expect(importMetaText(item(), TZ)).toBe('Сотрудник А · 12.10.2026, 15:02:11');
    expect(importMetaText(item({ userName: null }), TZ)).toBe('Пользователь удалён · 12.10.2026, 15:02:11');
  });

  it('«Отменён 12.10.2026, 15:40 (Сотрудник А)» — только у отменённого', () => {
    expect(importUndoneText(item(), TZ)).toBeNull();
    expect(importUndoneText(item({ status: 'undone', undoneAt: '2026-10-12T10:40:00.000Z', undoneByName: 'Сотрудник А', pending: null }), TZ)).toBe(
      'Отменён 12.10.2026, 15:40 (Сотрудник А)',
    );
    expect(importUndoneText(item({ status: 'undone', undoneAt: '2026-10-12T10:40:00.000Z', undoneByName: null, pending: null }), TZ)).toBe('Отменён 12.10.2026, 15:40');
  });
});
```

Создайте `e2e/import-history.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../tests/helpers/finmap-like';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Импорт синтетического файла через API: загрузка, пересчёт с сопоставлениями (если заданы) и запись. */
async function apiImport(page: Page, cid: number, rows: FinmapLikeValue[][], name = 'выгрузка.xlsx', accounts?: unknown[]): Promise<number> {
  const up = await page.request.post(`/api/v1/companies/${cid}/imports/upload`, {
    headers: { ...csrf(page), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    data: finmapLikeXlsx(rows),
  });
  expect(up.status(), await up.text()).toBe(200);
  let p = (await up.json()) as { token: string; revision: string };
  if (accounts) p = await apiPost(page, `/api/v1/companies/${cid}/imports/preview`, { token: p.token, accounts });
  const done = await apiPost(page, `/api/v1/companies/${cid}/imports`, { token: p.token, accounts: accounts ?? [], revision: p.revision });
  return done.import.id as number;
}

/** Компания с «Кассой» (открыта 01.01.2020); открыт её журнал. */
async function companyWithCash(page: Page, title: string): Promise<number> {
  await login(page);
  const cid = await createCompany(page, `ТОО ${title} ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  return cid;
}

/** Доход и расход на «Кассу», перевод на новый «Банк-2», расход с новыми категорией и контрагентом. */
const ROWS = [
  fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2025-03-17', '12:00:00'), amount: 200, from: 'Банк-2', category: 'Связь', counterparty: 'Поставщик Б' }),
];

const history = (page: Page) => page.getByRole('dialog', { name: 'История действий' });
const openHistory = async (page: Page) => {
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  await expect(history(page)).toBeVisible();
};

test('«История действий»: вкладки «Журнал | Импорты» — стрелки переключают и переводят фокус; запись импорта; при новом открытии — «Журнал»', async ({ page }) => {
  const cid = await companyWithCash(page, 'История импортов');
  await apiImport(page, cid, ROWS, 'март.xlsx');
  await openHistory(page);
  const tabs = history(page).getByRole('tablist', { name: 'Разделы истории' });
  const log = tabs.getByRole('tab', { name: 'Журнал' });
  const imports = tabs.getByRole('tab', { name: 'Импорты' });
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await expect(imports).toHaveAttribute('aria-selected', 'false');
  // в порядке Tab — только выбранная вкладка
  await expect(log).toHaveAttribute('tabindex', '0');
  await expect(imports).toHaveAttribute('tabindex', '-1');
  await expect(history(page).getByRole('tabpanel', { name: 'Журнал' })).toBeVisible();

  await log.focus();
  await page.keyboard.press('ArrowRight');
  await expect(imports).toBeFocused();
  await expect(imports).toHaveAttribute('aria-selected', 'true');
  const panel = history(page).getByRole('tabpanel', { name: 'Импорты' });
  const item = panel.getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item.getByText('март.xlsx', { exact: true })).toHaveAttribute('title', 'март.xlsx');
  await expect(item).toContainText('Добавлено 3 операции · пропущено дубликатов 0');
  await expect(item.getByText(/^Админ · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  // по кругу: → с последней — на первую, ← с первой — на последнюю
  await page.keyboard.press('ArrowRight');
  await expect(log).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(imports).toBeFocused();
  await page.keyboard.press('Home');
  await expect(log).toBeFocused();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(imports).toHaveAttribute('aria-selected', 'true');

  // закрыть и открыть снова — «Журнал»
  await page.keyboard.press('Escape');
  await expect(history(page)).toBeHidden();
  await openHistory(page);
  await expect(history(page).getByRole('tab', { name: 'Журнал' })).toHaveAttribute('aria-selected', 'true');
});

test('«Импорты»: пусто — «Импортов пока не было.»; больше 20 — «Показать ещё» догружает остальные', async ({ page }) => {
  const cid = await companyWithCash(page, 'Много импортов');
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await expect(history(page).getByText('Импортов пока не было.')).toBeVisible();
  await page.keyboard.press('Escape');

  // 21 импорт по одной операции: суммы разные — не дубликаты
  for (let i = 1; i <= 21; i++) await apiImport(page, cid, [fr({ paidAt: at('2025-03-15', '10:00:00'), amount: i, to: 'Касса' })], `файл ${i}.xlsx`);
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const items = history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(items).toHaveCount(20);
  await expect(items.first()).toContainText('файл 21.xlsx');
  await history(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(items).toHaveCount(21);
  await expect(items.last()).toContainText('файл 1.xlsx');
  await expect(history(page).getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/import-history.test.ts`
Expected: FAIL — модуль `src/client/lib/import-history` не найден («Failed to load url»).

- [ ] **Step 3: `cancelLabel` у `ConfirmDialog`**

В `src/client/components/ConfirmDialog.tsx` замените

```tsx
  /** Кнопка действия справа: «Закрыть», «Удалить», «Изменить». */
  confirmLabel: string;
```

на

```tsx
  /** Кнопка действия справа: «Закрыть», «Удалить», «Изменить». */
  confirmLabel: string;
  /** Левая кнопка (по умолчанию «Отменить»): «Не отменять», когда действие само называется «Отменить импорт» (§7.3 спецификации импорта). */
  cancelLabel?: string;
```

Замените

```tsx
  /** Флажок под текстом (только в вопросе о несохранённом — «Больше не спрашивать»). */
```

на

```tsx
  /** Флажок под текстом: «Больше не спрашивать» в вопросе о несохранённом, «Удалить и изменённые (3)» при отмене импорта. */
```

Замените

```tsx
 * родительского окна. Кнопки в порядке Finmap: слева «Отменить» (фокус по умолчанию), справа действие.
```

на

```tsx
 * родительского окна. Кнопки в порядке Finmap: слева «Отменить» или `cancelLabel` (фокус по умолчанию), справа действие.
```

Замените

```tsx
            <button ref={cancelRef} type="button" disabled={props.pending} onClick={cancel} className={btnSecondary}>
              Отменить
            </button>
```

на

```tsx
            <button ref={cancelRef} type="button" disabled={props.pending} onClick={cancel} className={btnSecondary}>
              {props.cancelLabel ?? 'Отменить'}
            </button>
```

- [ ] **Step 4: `operationsText` — общий с историей**

В `src/client/lib/import-panel.ts` замените

```ts
const operations = (n: number) => `${formatCount(n)} ${pluralRu(n, 'операция', 'операции', 'операций')}`;
```

на

```ts
/** «1 230 операций», «1 операция». */
export const operationsText = (n: number) => `${formatCount(n)} ${pluralRu(n, 'операция', 'операции', 'операций')}`;
```

Замените

```ts
  const total = extra ? fileRows(p.file.rows) : operations(p.file.rows);
```

на

```ts
  const total = extra ? fileRows(p.file.rows) : operationsText(p.file.rows);
```

Замените

```ts
  return `Добавлено ${operations(r.counts.added)}.${created} Пропущено дубликатов: ${formatCount(r.counts.duplicates)}`;
```

на

```ts
  return `Добавлено ${operationsText(r.counts.added)}.${created} Пропущено дубликатов: ${formatCount(r.counts.duplicates)}`;
```

- [ ] **Step 5: Тексты и вкладки (`lib/import-history.ts`), запрос списка**

Создайте `src/client/lib/import-history.ts`:

```ts
import { formatDateTime, formatDateTimeSec } from '../../shared/dates';
import type { ImportListItem } from '../../shared/schemas/imports';
import { formatCount, operationsText } from './import-panel';

/**
 * Вкладка «Импорты» панели «История действий» (§7 спецификации импорта): вкладки, тексты записей, подтверждения и итога
 * отмены (тесты — в node без DOM) и запрос отмены.
 */

export type HistoryTab = 'log' | 'imports';

/** Вкладки-пилюли панели (§7.1): «Стартового баланса», как у Finmap, нет — такого действия у нас нет. */
export const HISTORY_TABS: readonly { key: HistoryTab; label: string }[] = [
  { key: 'log', label: 'Журнал' },
  { key: 'imports', label: 'Импорты' },
];

/** Вкладка после клавиши (roving tabindex, §7.1): ←/→ по кругу, Home и End — крайние; другая клавиша — null. */
export function tabAfterKey(current: HistoryTab, key: string): HistoryTab | null {
  const i = HISTORY_TABS.findIndex((t) => t.key === current);
  const n = HISTORY_TABS.length;
  switch (key) {
    case 'ArrowRight':
      return HISTORY_TABS[(i + 1) % n]!.key;
    case 'ArrowLeft':
      return HISTORY_TABS[(i - 1 + n) % n]!.key;
    case 'Home':
      return HISTORY_TABS[0]!.key;
    case 'End':
      return HISTORY_TABS[n - 1]!.key;
    default:
      return null;
  }
}

/** Вторая строка записи (§7.2): «Добавлено 1 230 операций · пропущено дубликатов 0». */
export function importAddedText(item: ImportListItem): string {
  return `Добавлено ${operationsText(item.counts.added)} · пропущено дубликатов ${formatCount(item.counts.duplicates)}`;
}

/** У отменённого (§7.2): «Отменён 12.10.2026, 15:40 (Сотрудник А)». */
export function importUndoneText(item: ImportListItem, timeZone: string): string | null {
  if (item.status !== 'undone' || item.undoneAt === null) return null;
  return `Отменён ${formatDateTime(item.undoneAt, timeZone)}${item.undoneByName ? ` (${item.undoneByName})` : ''}`;
}

/** Третья строка (§7.2): «Сотрудник А · 12.10.2026, 15:02:11». */
export function importMetaText(item: ImportListItem, timeZone: string): string {
  return `${item.userName ?? 'Пользователь удалён'} · ${formatDateTimeSec(item.createdAt, timeZone)}`;
}
```

В `src/client/lib/queries.ts` замените

```ts
import type { CounterpartyType } from '../../shared/system-categories';
```

на

```ts
import type { ImportListPage } from '../../shared/schemas/imports';
import type { CounterpartyType } from '../../shared/system-categories';
```

Замените

```ts
export interface BackupStatus {
```

на

```ts
/** Список «Импорты» панели «История действий» (§7.2 спецификации импорта): по 20, «Показать ещё»; при каждом открытии свежий. */
export function useImports(companyId: number) {
  return useInfiniteQuery<ImportListPage, ApiError, InfiniteData<ImportListPage, number | null>, readonly unknown[], number | null>({
    queryKey: ['imports', companyId],
    initialPageParam: null,
    queryFn: ({ pageParam }) => api<ImportListPage>(`/companies/${companyId}/imports?limit=20${pageParam === null ? '' : `&beforeId=${pageParam}`}`),
    getNextPageParam: (last) => last.nextBeforeId,
    refetchOnMount: 'always',
  });
}

export interface BackupStatus {
```

- [ ] **Step 6: Run unit tests to verify they pass**

Run: `npx vitest run tests/client/import-history.test.ts tests/client/import-panel.test.ts`
Expected: PASS.

- [ ] **Step 7: Вкладка «Импорты» и вкладки панели**

Создайте `src/client/components/import/ImportHistory.tsx`:

```tsx
import { importAddedText, importMetaText, importUndoneText } from '../../lib/import-history';
import { useMeta } from '../../lib/query';
import { useImports, type Company } from '../../lib/queries';
import { Pending } from '../QueryState';
import { btnSecondary } from '../ui';

/**
 * Вкладка «Импорты» панели «История действий» (§7.2 спецификации импорта): импорты компании, новые сверху, «Показать ещё».
 */
export function ImportHistory({ company }: { company: Company }) {
  const feed = useImports(company.id);
  const meta = useMeta();
  // прошлый список при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !meta.data) return <Pending queries={[feed, meta]} />;
  const timeZone = meta.data.timezone;
  const items = feed.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <p className="text-sm text-muted">Импортов пока не было.</p>;

  return (
    <div>
      <ul aria-label="Импорты" className="divide-y divide-field">
        {items.map((it) => {
          const undone = importUndoneText(it, timeZone);
          return (
            <li key={it.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1 px-2 py-1">
                <span title={it.fileName} className="block truncate font-semibold">
                  {it.fileName}
                </span>
                <span className="block text-sm">{importAddedText(it)}</span>
                {undone && <span className="block text-sm">{undone}</span>}
                <span className="block text-xs text-muted">{importMetaText(it, timeZone)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className={`${btnSecondary} mt-3 w-full`}>
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
```

В `src/client/components/HistoryDrawer.tsx` замените

```tsx
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
```

на

```tsx
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { HISTORY_TABS, tabAfterKey, type HistoryTab } from '../lib/import-history';
```

Замените

```tsx
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
```

на

```tsx
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { ImportHistory } from './import/ImportHistory';
```

Замените

```tsx
/**
 * Правая панель «История действий» (§3.4 этапа 1.5) — последние действия с операциями. Открывается значком в шапке
 * (компьютер) и пунктом «История действий» в «Ещё» нижней панели (телефон, §8.3). Закрытие — фокус на то, чем открыли.
 */
```

на

```tsx
/**
 * Правая панель «История действий» (§3.4 этапа 1.5) — вкладки «Журнал» (последние действия с операциями) и «Импорты»
 * (§7 спецификации импорта). Открывается значком в шапке (компьютер) и пунктом «История действий» в «Ещё» нижней панели
 * (телефон, §8.3). Закрытие — фокус на то, чем открыли. Содержимое монтируется заново при каждом открытии — вкладка
 * снова «Журнал».
 */
```

Замените

```tsx
      <HistoryList
        company={company}
        onOpenOperation={(id) => {
          pendingOperation.current = id;
          onClose();
        }}
      />
    </Drawer>
```

на

```tsx
      <HistoryTabs
        company={company}
        onOpenOperation={(id) => {
          pendingOperation.current = id;
          onClose();
        }}
      />
    </Drawer>
```

Замените

```tsx
function HistoryList(props: { company: Company; onOpenOperation: (id: number) => void }) {
```

на

```tsx
/**
 * Вкладки-пилюли «Журнал | Импорты» (§7.1 спецификации импорта): tablist, стрелки ←/→ (и Home, End) переключают вкладку
 * и переводят на неё фокус — в порядке Tab только выбранная вкладка (roving tabindex).
 */
function HistoryTabs(props: { company: Company; onOpenOperation: (id: number) => void }) {
  const [tab, setTab] = useState<HistoryTab>('log');
  const refs = useRef(new Map<HistoryTab, HTMLButtonElement>());
  const id = useId();
  const tabId = (t: HistoryTab) => `${id}-tab-${t}`;
  const panelId = (t: HistoryTab) => `${id}-panel-${t}`;
  return (
    <div>
      <div role="tablist" aria-label="Разделы истории" className="mb-3 grid grid-cols-2 gap-1">
        {HISTORY_TABS.map((t) => (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el);
              else refs.current.delete(t.key);
            }}
            type="button"
            role="tab"
            id={tabId(t.key)}
            aria-selected={tab === t.key}
            aria-controls={panelId(t.key)}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const next = tabAfterKey(tab, e.key);
              if (!next) return;
              e.preventDefault();
              setTab(next);
              refs.current.get(next)?.focus();
            }}
            className={`rounded-xl px-3 py-2 text-sm max-md:min-h-11 ${tab === t.key ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field/60'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === 'log' ? <HistoryList company={props.company} onOpenOperation={props.onOpenOperation} /> : <ImportHistory company={props.company} />}
      </div>
    </div>
  );
}

function HistoryList(props: { company: Company; onOpenOperation: (id: number) => void }) {
```

- [ ] **Step 8: Run e2e to verify the tabs**

Run: `npx playwright test e2e/import-history.spec.ts e2e/service-screens.spec.ts e2e/operation-edit.spec.ts e2e/dialogs.spec.ts`
Expected: PASS — вкладки, список и «Показать ещё»; прежняя лента «Последние действия» на вкладке «Журнал» и подтверждения с «Отменить» не изменились.

- [ ] **Step 9: Full check**

Run: `npm test`
Expected: 1037 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e` — два раза подряд.
Expected: 161 из 161 оба раза.

- [ ] **Step 10: Commit**

```bash
git add src/client/components/ConfirmDialog.tsx src/client/lib/import-panel.ts src/client/lib/import-history.ts src/client/lib/queries.ts src/client/components/import/ImportHistory.tsx src/client/components/HistoryDrawer.tsx tests/client/import-history.test.ts e2e/import-history.spec.ts
git commit -m "feat: история действий — вкладки «Журнал | Импорты», список импортов; ConfirmDialog.cancelLabel" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: «Отменить» в панели — подтверждение, флажок, итог, обновление данных (§5.6, §7.2, §7.3)

**Files:**
- Modify: `src/client/lib/import-panel.ts`, `src/client/lib/import-history.ts`, `src/client/components/import/ImportHistory.tsx`, `src/client/components/HistoryDrawer.tsx`, `src/client/components/import/ImportPanel.tsx`
- Test: `tests/client/import-history.test.ts`, `e2e/import-history.spec.ts`

**Interfaces:**
- Consumes: из задачи 2 — `ImportUndoRequest`, `ImportUndoResponse`, `ImportUndoResult`, `ImportCreatedEntity`, `ImportKeptAccountField`, маршрут `POST …/imports/:id/undo`; из задачи 3 — `operationsText`, `ImportHistory`, `HistoryTabs`, `ConfirmDialog.cancelLabel`, `useImports`; `invalidateAfterImport` (`lib/import-panel.ts`); `queryClient` (`lib/query.ts`); `ApiError` (`lib/api.ts`); `pluralRu` (`lib/journal-format.ts`); `alertClass`, `btnSmall` (`components/ui.ts`).
- Produces:
  - `lib/import-panel.ts`: `createdParts(c: ImportCreatedCounts): string[]` («2 счёта», «12 категорий»…), `doneText` — через неё;
  - `lib/import-history.ts`: `undoButtonLabel(item, timeZone)`, `undoCheckboxLabel(edited)`, `undoConfirmText(item, includeEdited)`, `undoResultText(result: ImportUndoResult): string`, `replaceImportItem(data, item)`, `undoImport(companyId, importId, body): Promise<ImportUndoResponse>`;
  - `ImportHistory({ company, onFocusLost })` — `onFocusLost` ставит фокус на вкладку «Импорты», когда кнопки «Отменить» уже нет.

- [ ] **Step 1: Write the failing test**

В `tests/client/import-history.test.ts` замените

```ts
import { describe, expect, it } from 'vitest';
import { HISTORY_TABS, importAddedText, importMetaText, importUndoneText, tabAfterKey } from '../../src/client/lib/import-history';
import type { ImportListItem } from '../../src/shared/schemas/imports';
```

на

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_TABS,
  importAddedText,
  importMetaText,
  importUndoneText,
  replaceImportItem,
  tabAfterKey,
  undoButtonLabel,
  undoCheckboxLabel,
  undoConfirmText,
  undoImport,
  undoResultText,
} from '../../src/client/lib/import-history';
import type { ImportListItem, ImportListPage, ImportUndoResult } from '../../src/shared/schemas/imports';
```

Добавьте в конец `tests/client/import-history.test.ts`:

```ts
const zero = { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 };

describe('кнопка «Отменить» и подтверждение отмены (§7.2–§7.3)', () => {
  it('доступное имя «Отменить» называет файл и момент импорта', () => {
    expect(undoButtonLabel(item(), TZ)).toBe('Отменить импорт «выгрузка.xlsx» от 12.10.2026, 15:02');
  });

  it('без изменённых: сколько операций удалится и что будет с созданным', () => {
    expect(undoConfirmText(item(), false)).toBe(
      'Будут удалены 1\u202F230 операций из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.',
    );
    expect(undoConfirmText(item({ pending: { operations: 1, edited: 0 } }), false)).toMatch(/^Будет удалена 1 операция из файла/);
    expect(undoConfirmText(item({ pending: { operations: 22, edited: 0 } }), false)).toMatch(/^Будут удалены 22 операции из файла/);
  });

  it('с изменёнными: без флажка они останутся, с флажком — тоже удалятся; флажок называет их число', () => {
    const p = item({ pending: { operations: 1_230, edited: 3 } });
    expect(undoConfirmText(p, false)).toBe(
      'Будут удалены 1\u202F227 операций из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются. После импорта изменены 3 операции — они останутся.',
    );
    expect(undoConfirmText(p, true)).toMatch(/^Будут удалены 1\u202F230 операций .* После импорта изменены 3 операции — они тоже будут удалены\.$/);
    expect(undoConfirmText(item({ pending: { operations: 5, edited: 1 } }), false)).toMatch(/После импорта изменена 1 операция — она останется\.$/);
    expect(undoCheckboxLabel(3)).toBe('Удалить и изменённые (3)');
  });

  it('все операции изменены, флажок снят — операции не удаляются', () => {
    expect(undoConfirmText(item({ pending: { operations: 2, edited: 2 } }), false)).toBe(
      'Операции из файла «выгрузка.xlsx» не удаляются. Будут удалены созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются. После импорта изменены 2 операции — они останутся.',
    );
  });
});

describe('итог отмены (§7.3)', () => {
  it('удалено и оставлено: изменённые операции, используемые справочники, поля счетов', () => {
    const r: ImportUndoResult = {
      deleted: { operations: 1_227, accounts: 2, categories: 12, counterparties: 25, projects: 0, tags: 1 },
      kept: {
        operations: 3,
        created: { ...zero, categories: 1 },
        names: [{ entity: 'category', name: 'Аренда' }],
        accounts: [],
      },
    };
    expect(undoResultText(r)).toBe(
      'Импорт отменён: удалено 1\u202F227 операций, 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Оставлено: 3 изменённые операции, категория «Аренда» (используется).',
    );
  });

  it('ничего не оставлено — без «Оставлено»; больше названий, чем в итоге, — «и ещё N»; поля счетов с причиной', () => {
    expect(undoResultText({ deleted: { operations: 4, ...zero }, kept: { operations: 0, created: zero, names: [], accounts: [] } })).toBe('Импорт отменён: удалено 4 операции.');
    const r: ImportUndoResult = {
      deleted: { operations: 1, ...zero },
      kept: {
        operations: 0,
        created: { ...zero, counterparties: 22 },
        names: Array.from({ length: 20 }, (_, i) => ({ entity: 'counterparty' as const, name: `К${i}` })),
        accounts: [
          { accountId: 1, name: 'Касса', field: 'startingBalance', reason: 'changed' },
          { accountId: 1, name: 'Касса', field: 'openedAt', reason: 'operations' },
          { accountId: 2, name: 'Сейф', field: 'openedAt', reason: 'archived' },
        ],
      },
    };
    const text = undoResultText(r);
    expect(text).toMatch(/^Импорт отменён: удалено 1 операция\. Оставлено: контрагент «К0» \(используется\), /);
    expect(text).toContain('контрагент «К19» (используется), и ещё 2 (используются), ');
    expect(text).toMatch(
      /стартовый баланс счёта «Касса» \(изменён после импорта\), дата открытия счёта «Касса» \(есть операции раньше прежней даты\), дата открытия счёта «Сейф» \(счёт в архиве\)\.$/,
    );
  });
});

describe('список после отмены и запрос', () => {
  it('replaceImportItem: запись заменяется в своей странице, остальные — те же объекты', () => {
    const a = item({ id: 9 });
    const b = item({ id: 7 });
    const data = { pages: [{ items: [a], nextBeforeId: 9 }, { items: [b], nextBeforeId: null }] as ImportListPage[], pageParams: [null, 9] };
    const undone = item({ id: 7, status: 'undone', pending: null });
    const next = replaceImportItem(data, undone)!;
    expect(next.pages[1]!.items).toEqual([undone]);
    expect(next.pages[0]!.items[0]).toBe(a);
    expect(next.pageParams).toEqual([null, 9]);
    expect(replaceImportItem(undefined, undone)).toBeUndefined();
  });

  it('undoImport: POST …/imports/:id/undo с флажком и числом изменённых, которое видел человек', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await undoImport(5, 7, { includeEdited: true, edited: 3 });
    expect(calls[0]!.url).toBe('/api/v1/companies/5/imports/7/undo');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ includeEdited: true, edited: 3 });
  });
});

afterEach(() => vi.unstubAllGlobals());
```

Добавьте в конец `e2e/import-history.spec.ts`:

```ts
const panel = (page: Page) => page.getByRole('dialog', { name: 'Импорт из Excel' });
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Отменить импорт?' });
/** Кнопка «Отменить» записи импорта: доступное имя называет файл и момент импорта. */
const undoButton = (page: Page, file: string) =>
  history(page).getByRole('button', { name: new RegExp(`^Отменить импорт «${file}» от \\d{2}\\.\\d{2}\\.\\d{4}, \\d{2}:\\d{2}$`) });

test('«Отменить»: «Импорт завершён» подсказывает, где отменить; «Не отменять | Отменить импорт» → итог в живой области, «Отменён», журнал пуст, «Банк-2» удалён', async ({ page }) => {
  await companyWithCash(page, 'Отмена импорта');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await panel(page)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'выгрузка.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: finmapLikeXlsx(ROWS) });
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await panel(page).getByRole('button', { name: 'Импортировать' }).click();
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await expect(panel(page).getByText('Отменить импорт можно в «Истории действий» → «Импорты»')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(3);

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const undo = undoButton(page, 'выгрузка.xlsx');
  await expect(undo).toHaveText('Отменить');
  await undo.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toHaveAccessibleDescription(
    'Будут удалены 3 операции из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.',
  );
  // изменённых нет — флажка нет; слева «Не отменять» (фокус), справа «Отменить импорт»
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Не отменять' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(history(page)).toBeVisible();
  await expect(undo).toBeFocused();

  await undo.click();
  const done = page.waitForResponse((r) => /\/imports\/\d+\/undo$/.test(r.url()));
  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  expect((await done).status()).toBe(200);
  const result = 'Импорт отменён: удалено 3 операции, 1 счёт, 2 категории, 1 контрагент.';
  await expect(history(page).getByRole('status')).toHaveText(result);
  const item = history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(item).toContainText(/Отменён \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Админ\)/);
  // «Отменить» исчезла вместе с подтверждением — фокус на вкладке «Импорты»
  await expect(undo).toHaveCount(0);
  await expect(history(page).getByRole('tab', { name: 'Импорты' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByText('Операций пока нет.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Банк-2/ })).toHaveCount(0);
});

test('изменённая после импорта операция: текст и флажок «Удалить и изменённые (1)»; без флажка она остаётся', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена с правкой');
  await apiImport(page, cid, ROWS);
  const journal = await (await page.request.get(`/api/v1/companies/${cid}/operations`)).json();
  const income = (journal.items as { id: number; version: number; type: string }[]).find((o) => o.type === 'income')!;
  const res = await page.request.patch(`/api/v1/companies/${cid}/operations/${income.id}`, { data: { version: income.version, comment: 'сверено' }, headers: csrf(page) });
  expect(res.status(), await res.text()).toBe(200);
  await page.reload();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await undoButton(page, 'выгрузка.xlsx').click();
  const dialog = confirmDialog(page);
  await expect(dialog).toHaveAccessibleDescription(/^Будут удалены 2 операции из файла «выгрузка\.xlsx».* После импорта изменена 1 операция — она останется\.$/);
  const box = dialog.getByRole('checkbox', { name: 'Удалить и изменённые (1)' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(dialog).toHaveAccessibleDescription(/^Будут удалены 3 операции .* — она тоже будет удалена\.$/);
  await box.uncheck();
  await dialog.getByRole('button', { name: 'Отменить импорт' }).click();
  await expect(history(page).getByRole('status')).toHaveText(
    'Импорт отменён: удалено 2 операции, 1 счёт, 1 категория, 1 контрагент. Оставлено: 1 изменённая операция, категория «Бар» (используется).',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
});

test('импорт отменили в другом окне, пока открыто подтверждение: «Импорт уже отменён», запись «Отменён», фокус на вкладке', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена дважды');
  const id = await apiImport(page, cid, ROWS);
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await undoButton(page, 'выгрузка.xlsx').click();
  await expect(confirmDialog(page)).toBeVisible();
  await apiPost(page, `/api/v1/companies/${cid}/imports/${id}/undo`, { includeEdited: false, edited: 0 });

  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  await expect(history(page).getByRole('alert')).toHaveText('Импорт уже отменён');
  await expect(confirmDialog(page)).toBeHidden();
  await expect(history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem')).toContainText('Отменён');
  await expect(undoButton(page, 'выгрузка.xlsx')).toHaveCount(0);
  await expect(history(page).getByRole('tab', { name: 'Импорты' })).toBeFocused();
});

test('архивная компания: список импортов есть, кнопки «Отменить» нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Отмена архив ${Date.now()}`);
  // остаток нового «Сейфа» после импорта — 0: счёт и компанию можно перевести в архив
  await apiImport(page, cid, [fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 100, to: 'Сейф' })], 'архив.xlsx', [
    { key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'current', amount: 0 } },
  ]);
  const accounts = await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json();
  await apiPost(page, `/api/v1/companies/${cid}/accounts/${accounts.accounts[0].id}/archive`, {});
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.reload();
  await expect(page.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await expect(history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem')).toContainText('архив.xlsx');
  await expect(history(page).getByRole('button', { name: /^Отменить/ })).toHaveCount(0);
});

test('телефон: «Ещё» → «История действий» → «Импорты» — вкладки и «Отменить» не меньше 44 px, длинное имя файла не раздвигает панель', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена телефон');
  await apiImport(page, cid, ROWS, `${'очень-длинное-имя-выгрузки-'.repeat(4)}.xlsx`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'История действий' }).click();
  const tab = history(page).getByRole('tab', { name: 'Импорты' });
  expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await tab.click();
  const undo = history(page).getByRole('button', { name: /^Отменить импорт/ });
  await expect(undo).toBeVisible();
  const b = (await undo.boundingBox())!;
  const d = (await history(page).boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.x + b.width).toBeLessThanOrEqual(d.x + d.width);
  expect(d.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/import-history.test.ts`
Expected: FAIL — `undoConfirmText` и другие функции отмены не экспортируются из `src/client/lib/import-history`.

- [ ] **Step 3: `createdParts` — общая с итогом отмены**

В `src/client/lib/import-panel.ts` замените

```ts
  AccountMapping,
  ImportCommitResult,
  ImportIssueGroup,
```

на

```ts
  AccountMapping,
  ImportCommitResult,
  ImportCreatedCounts,
  ImportIssueGroup,
```

Замените

```ts
/** Итог записи (§5.6): «Добавлено 1 230 операций. Создано: 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Пропущено дубликатов: 0». */
export function doneText(r: ImportCommitResult): string {
  const c = r.import.created;
  const parts = [
    c.accounts && `${formatCount(c.accounts)} ${pluralRu(c.accounts, 'счёт', 'счёта', 'счетов')}`,
    c.categories && `${formatCount(c.categories)} ${pluralRu(c.categories, 'категория', 'категории', 'категорий')}`,
    c.counterparties && `${formatCount(c.counterparties)} ${pluralRu(c.counterparties, 'контрагент', 'контрагента', 'контрагентов')}`,
    c.projects && `${formatCount(c.projects)} ${pluralRu(c.projects, 'проект', 'проекта', 'проектов')}`,
    c.tags && `${formatCount(c.tags)} ${pluralRu(c.tags, 'тег', 'тега', 'тегов')}`,
  ].filter(Boolean);
  const created = parts.length > 0 ? ` Создано: ${parts.join(', ')}.` : '';
```

на

```ts
/** Ненулевые виды созданного (или удалённого отменой): «2 счёта», «12 категорий», «25 контрагентов», «1 тег». */
export function createdParts(c: ImportCreatedCounts): string[] {
  return [
    c.accounts && `${formatCount(c.accounts)} ${pluralRu(c.accounts, 'счёт', 'счёта', 'счетов')}`,
    c.categories && `${formatCount(c.categories)} ${pluralRu(c.categories, 'категория', 'категории', 'категорий')}`,
    c.counterparties && `${formatCount(c.counterparties)} ${pluralRu(c.counterparties, 'контрагент', 'контрагента', 'контрагентов')}`,
    c.projects && `${formatCount(c.projects)} ${pluralRu(c.projects, 'проект', 'проекта', 'проектов')}`,
    c.tags && `${formatCount(c.tags)} ${pluralRu(c.tags, 'тег', 'тега', 'тегов')}`,
  ].filter((x): x is string => typeof x === 'string');
}

/** Итог записи (§5.6): «Добавлено 1 230 операций. Создано: 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Пропущено дубликатов: 0». */
export function doneText(r: ImportCommitResult): string {
  const parts = createdParts(r.import.created);
  const created = parts.length > 0 ? ` Создано: ${parts.join(', ')}.` : '';
```

- [ ] **Step 4: Тексты отмены и запрос (`lib/import-history.ts`)**

В `src/client/lib/import-history.ts` замените

```ts
import { formatDateTime, formatDateTimeSec } from '../../shared/dates';
import type { ImportListItem } from '../../shared/schemas/imports';
import { formatCount, operationsText } from './import-panel';
```

на

```ts
import type { InfiniteData } from '@tanstack/react-query';
import { formatDateTime, formatDateTimeSec } from '../../shared/dates';
import type {
  ImportCreatedEntity,
  ImportKeptAccountField,
  ImportListItem,
  ImportListPage,
  ImportUndoRequest,
  ImportUndoResponse,
  ImportUndoResult,
} from '../../shared/schemas/imports';
import { api } from './api';
import { createdParts, formatCount, operationsText } from './import-panel';
import { pluralRu } from './journal-format';
```

Добавьте в конец `src/client/lib/import-history.ts`:

```ts
/** Доступное имя кнопки «Отменить» (§7.2): «Отменить импорт «выгрузка.xlsx» от 12.10.2026, 15:02». */
export function undoButtonLabel(item: ImportListItem, timeZone: string): string {
  return `Отменить импорт «${item.fileName}» от ${formatDateTime(item.createdAt, timeZone)}`;
}

/** Флажок подтверждения (§7.3): «Удалить и изменённые (3)». */
export function undoCheckboxLabel(edited: number): string {
  return `Удалить и изменённые (${formatCount(edited)})`;
}

/**
 * Текст подтверждения отмены (§7.3): сколько операций удалится, с флажком — и изменённые; если изменённые есть — что
 * с ними будет. Все операции изменены и флажок снят — операций не удаляется.
 */
export function undoConfirmText(item: ImportListItem, includeEdited: boolean): string {
  const p = item.pending ?? { operations: 0, edited: 0 };
  const n = includeEdited ? p.operations : p.operations - p.edited;
  const rest = 'созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.';
  const head =
    n > 0
      ? `${pluralRu(n, 'Будет удалена', 'Будут удалены', 'Будут удалены')} ${operationsText(n)} из файла «${item.fileName}», а также ${rest}`
      : `Операции из файла «${item.fileName}» не удаляются. Будут удалены ${rest}`;
  if (p.edited === 0) return head;
  const edited = `После импорта ${pluralRu(p.edited, 'изменена', 'изменены', 'изменены')} ${operationsText(p.edited)}`;
  const fate = includeEdited
    ? pluralRu(p.edited, 'она тоже будет удалена', 'они тоже будут удалены', 'они тоже будут удалены')
    : pluralRu(p.edited, 'она останется', 'они останутся', 'они останутся');
  return `${head} ${edited} — ${fate}.`;
}

const ENTITY_SINGULAR: Record<ImportCreatedEntity, string> = {
  account: 'счёт',
  category: 'категория',
  counterparty: 'контрагент',
  project: 'проект',
  tag: 'тег',
};

/** Поле счёта, оставленное как есть: «стартовый баланс счёта «Касса» (изменён после импорта)». */
function keptAccountText(k: ImportKeptAccountField): string {
  const what = k.field === 'startingBalance' ? 'стартовый баланс' : 'дата открытия';
  const why =
    k.reason === 'archived'
      ? 'счёт в архиве'
      : k.reason === 'operations'
        ? 'есть операции раньше прежней даты'
        : k.field === 'startingBalance'
          ? 'изменён после импорта'
          : 'изменена после импорта';
  return `${what} счёта «${k.name}» (${why})`;
}

/**
 * Итог отмены (§7.3) — в живую область панели: «Импорт отменён: удалено 1 227 операций, 2 счёта, 12 категорий,
 * 25 контрагентов, 1 тег. Оставлено: 3 изменённые операции, категория «Аренда» (используется).»
 */
export function undoResultText(r: ImportUndoResult): string {
  const deleted = [operationsText(r.deleted.operations), ...createdParts(r.deleted)];
  const keptTotal = r.kept.created.accounts + r.kept.created.categories + r.kept.created.counterparties + r.kept.created.projects + r.kept.created.tags;
  const more = keptTotal - r.kept.names.length;
  const kept = [
    ...(r.kept.operations > 0
      ? [`${formatCount(r.kept.operations)} ${pluralRu(r.kept.operations, 'изменённая операция', 'изменённые операции', 'изменённых операций')}`]
      : []),
    ...r.kept.names.map((x) => `${ENTITY_SINGULAR[x.entity]} «${x.name}» (используется)`),
    ...(more > 0 ? [`и ещё ${formatCount(more)} (используются)`] : []),
    ...r.kept.accounts.map(keptAccountText),
  ];
  return `Импорт отменён: удалено ${deleted.join(', ')}.${kept.length > 0 ? ` Оставлено: ${kept.join(', ')}.` : ''}`;
}

/** Запись импорта после отмены — вместо прежней в загруженных страницах списка (до перечитывания). */
export function replaceImportItem(
  data: InfiniteData<ImportListPage, number | null> | undefined,
  item: ImportListItem,
): InfiniteData<ImportListPage, number | null> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === item.id ? item : x)) })) };
}

/** Отмена импорта (§6.2): POST …/imports/:id/undo. */
export function undoImport(companyId: number, importId: number, body: ImportUndoRequest): Promise<ImportUndoResponse> {
  return api<ImportUndoResponse>(`/companies/${companyId}/imports/${importId}/undo`, { method: 'POST', body });
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `npx vitest run tests/client/import-history.test.ts tests/client/import-panel.test.ts`
Expected: PASS.

- [ ] **Step 6: «Отменить» во вкладке «Импорты» и строка в «Импорт завершён»**

Замените содержимое `src/client/components/import/ImportHistory.tsx` целиком:

```tsx
import { useState } from 'react';
import type { ImportListItem } from '../../../shared/schemas/imports';
import { ApiError } from '../../lib/api';
import {
  importAddedText,
  importMetaText,
  importUndoneText,
  replaceImportItem,
  undoButtonLabel,
  undoCheckboxLabel,
  undoConfirmText,
  undoImport,
  undoResultText,
} from '../../lib/import-history';
import { invalidateAfterImport } from '../../lib/import-panel';
import { queryClient, useMeta } from '../../lib/query';
import { useImports, type Company } from '../../lib/queries';
import { ConfirmDialog } from '../ConfirmDialog';
import { Pending } from '../QueryState';
import { alertClass, btnSecondary, btnSmall } from '../ui';

/**
 * Вкладка «Импорты» панели «История действий» (§7.2–§7.3 спецификации импорта): импорты компании, новые сверху,
 * «Показать ещё»; у неотменённого — «Отменить» с подтверждением «Не отменять | Отменить импорт». Итог отмены — в живой
 * области; кнопка «Отменить» исчезает вместе с подтверждением — фокус уходит на вкладку (onFocusLost).
 */
export function ImportHistory({ company, onFocusLost }: { company: Company; onFocusLost: () => void }) {
  const feed = useImports(company.id);
  const meta = useMeta();
  const [confirm, setConfirm] = useState<ImportListItem | null>(null);
  const [includeEdited, setIncludeEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ask = (item: ImportListItem) => {
    setIncludeEdited(false);
    setError(null);
    setConfirm(item);
  };

  const run = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    setResult('');
    try {
      const r = await undoImport(company.id, confirm.id, { includeEdited, edited: confirm.pending?.edited ?? 0 });
      // запись — «Отменён» до перечитывания: кнопка «Отменить» исчезает вместе с подтверждением
      queryClient.setQueryData(['imports', company.id], (d: Parameters<typeof replaceImportItem>[0]) => replaceImportItem(d, r.import));
      setResult(undoResultText(r.result));
      setConfirm(null);
      void invalidateAfterImport(company.id);
    } catch (e) {
      // уже отменён (409), изменены ещё операции (409), счёт в архиве (422): свежий список — до закрытия подтверждения,
      // чтобы фокус вернулся на «Отменить», если она осталась
      setError(e instanceof ApiError ? e.message : 'Ошибка сервера');
      await queryClient.invalidateQueries({ queryKey: ['imports', company.id] });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  // прошлый список при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !meta.data) return <Pending queries={[feed, meta]} />;
  const timeZone = meta.data.timezone;
  const items = feed.data.pages.flatMap((p) => p.items);
  const canUndo = company.archivedAt === null;
  const edited = confirm?.pending?.edited ?? 0;

  return (
    <div>
      <p role="status" className="sr-only">
        {result}
      </p>
      {result && <p className="mb-3 rounded-xl bg-field px-4 py-3 text-sm">{result}</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Импортов пока не было.</p>
      ) : (
        <ul aria-label="Импорты" className="divide-y divide-field">
          {items.map((it) => {
            const undone = importUndoneText(it, timeZone);
            return (
              <li key={it.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1 px-2 py-1">
                  <span title={it.fileName} className="block truncate font-semibold">
                    {it.fileName}
                  </span>
                  <span className="block text-sm">{importAddedText(it)}</span>
                  {undone && <span className="block text-sm">{undone}</span>}
                  <span className="block text-xs text-muted">{importMetaText(it, timeZone)}</span>
                </div>
                {canUndo && it.status === 'done' && (
                  <button type="button" aria-label={undoButtonLabel(it, timeZone)} onClick={() => ask(it)} className={`${btnSmall} mt-1 shrink-0 max-md:min-h-11`}>
                    Отменить
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className={`${btnSecondary} mt-3 w-full`}>
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title="Отменить импорт?"
        text={confirm ? undoConfirmText(confirm, includeEdited) : ''}
        cancelLabel="Не отменять"
        confirmLabel="Отменить импорт"
        danger
        pending={busy}
        checkbox={edited > 0 ? { label: undoCheckboxLabel(edited), checked: includeEdited, onChange: setIncludeEdited } : undefined}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
        onFocusLost={onFocusLost}
      />
    </div>
  );
}
```

В `src/client/components/HistoryDrawer.tsx` замените

```tsx
<ImportHistory company={props.company} />}
```

на

```tsx
<ImportHistory company={props.company} onFocusLost={() => refs.current.get('imports')?.focus()} />}
```

В `src/client/components/import/ImportPanel.tsx` замените

```tsx
          <p>{doneText(phase.result)}</p>
        </section>
```

на

```tsx
          <p>{doneText(phase.result)}</p>
          <p className="text-sm text-muted">Отменить импорт можно в «Истории действий» → «Импорты»</p>
        </section>
```

- [ ] **Step 7: Run e2e to verify the undo**

Run: `npx playwright test e2e/import-history.spec.ts e2e/import.spec.ts`
Expected: PASS.

- [ ] **Step 8: Full check**

Run: `npm test`
Expected: 1045 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e` — два раза подряд.
Expected: 166 из 166 оба раза.

- [ ] **Step 9: Commit**

```bash
git add src/client/lib/import-panel.ts src/client/lib/import-history.ts src/client/components/import/ImportHistory.tsx src/client/components/HistoryDrawer.tsx src/client/components/import/ImportPanel.tsx tests/client/import-history.test.ts e2e/import-history.spec.ts
git commit -m "feat: импорт — «Отменить» во вкладке «Импорты»: «Не отменять | Отменить импорт», флажок изменённых, итог, обновление данных" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Запись импорта на странице «История действий» (§6.5)

**Files:**
- Modify: `src/client/lib/audit-format.ts`, `src/client/pages/settings/AuditSettings.tsx`
- Test: `tests/client/audit-format.test.ts`, `e2e/import.spec.ts`

**Interfaces:**
- Consumes: из задачи 4 — `undoResultText` (`lib/import-history.ts`), `createdParts`, `operationsText` (`lib/import-panel.ts`); `formatCount` (`lib/import-panel.ts`); `ImportUndoResult`.
- Produces: `lib/audit-format.ts` — `auditSubject(e: { entity; diff }): string | null` (имя файла у импорта), `importDetails(e: { entity; action; diff }): { label: string; value: string }[] | null` («Подробности» импорта и отмены; null — показывать как раньше).

- [ ] **Step 1: Write the failing test**

В `tests/client/audit-format.test.ts` замените

```ts
import { COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, pageDiff, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';
```

на

```ts
import { auditSubject, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, importDetails, pageDiff, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';
```

После теста «страница «История действий»: у каждого поля строки операции есть русское название…» — то есть после строк

```ts
    expect(names).toEqual(['Тип', 'Счёт', 'Счёт зачисления', 'Сумма', 'Сумма зачисления', 'Контрагент', 'Дата сделки', 'Комментарий', 'Категория и проект', 'Теги', 'Дата']);
  });
```

и перед последней строкой файла `});` — вставьте:

```ts
  it('импорт на странице «История действий»: имя файла рядом с «Импорт №…», в подробностях — числа (§6.5 спецификации импорта)', () => {
    const diff = {
      fileName: 'выгрузка.xlsx',
      counts: { rows: 1_232, income: 700, expense: 496, transfer: 34, added: 1_230, duplicates: 0, skippedFuture: 2 },
      created: { accounts: 2, categories: 12, counterparties: 25, projects: 0, tags: 1 },
    };
    expect(auditSubject({ entity: 'import', diff })).toBe('выгрузка.xlsx');
    expect(auditSubject({ entity: 'tag', diff: { name: 'x', fileName: 'y' } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'create', diff })).toEqual([
      { label: 'Строк в файле', value: '1\u202F232' },
      { label: 'Добавлено', value: '1\u202F230 операций (доходов 700, расходов 496, переводов 34)' },
      { label: 'Пропущено дубликатов', value: '0' },
      { label: 'Пропущено плановых', value: '2' },
      { label: 'Создано', value: '2 счёта, 12 категорий, 25 контрагентов, 1 тег' },
    ]);
    expect(importDetails({ entity: 'import', action: 'create', diff: { ...diff, created: { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 } } })!.at(-1)).toEqual({
      label: 'Создано',
      value: 'ничего',
    });
  });

  it('отмена импорта: в подробностях — итог; запись другого вида или с неполным diff — как есть (null)', () => {
    const zero = { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 };
    const diff = {
      fileName: 'выгрузка.xlsx',
      deleted: { operations: 3, ...zero, accounts: 1 },
      kept: { operations: 1, created: { ...zero, categories: 1 }, names: [{ entity: 'category', name: 'Бар' }], accounts: [] },
    };
    expect(importDetails({ entity: 'import', action: 'delete', diff })).toEqual([
      { label: 'Итог', value: 'Импорт отменён: удалено 3 операции, 1 счёт. Оставлено: 1 изменённая операция, категория «Бар» (используется).' },
    ]);
    expect(importDetails({ entity: 'import', action: 'delete', diff: { fileName: 'x', deleted: { operations: 1 } } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'create', diff: { fileName: 'x' } })).toBeNull();
    expect(importDetails({ entity: 'tag', action: 'create', diff: { name: 'x' } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'create', diff: null })).toBeNull();
  });
```

В `e2e/import.spec.ts` замените тест

```ts
test('запись об импорте в «Истории действий»: «Импорт №…», «Создание», в подробностях — имя файла и числа', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт история');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await p.getByRole('button', { name: 'Готово' }).click();

  await page.goto(`/c/${cid}/settings/audit`);
  const item = page.getByRole('listitem').filter({ hasText: /Импорт №\d+/ });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Создание');
  await item.getByText('Подробности').click();
  const details = item.locator('pre');
  await expect(details).toContainText('"fileName": "выгрузка.xlsx"');
  await expect(details).toContainText('"created"');
});
```

на

```ts
test('запись об импорте в «Истории действий»: «Импорт №…», «Создание», имя файла, в подробностях — числа; отмена — «Удаление» с итогом', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт история');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await p.getByRole('button', { name: 'Готово' }).click();

  await page.goto(`/c/${cid}/settings/audit`);
  const created = page.getByRole('listitem').filter({ hasText: /Импорт №\d+/ });
  await expect(created).toHaveCount(1);
  await expect(created).toContainText('Создание');
  await expect(created).toContainText('выгрузка.xlsx');
  await created.getByText('Подробности').click();
  await expect(created.getByRole('definition')).toHaveText([
    '3',
    '3 операции (доходов 1, расходов 1, переводов 1)',
    '0',
    '0',
    '1 счёт, 2 категории, 1 контрагент',
  ]);
  await expect(created.getByRole('term')).toHaveText(['Строк в файле', 'Добавлено', 'Пропущено дубликатов', 'Пропущено плановых', 'Создано']);

  // отмена — запись «Удаление» того же импорта с итогом в подробностях
  const list = await (await page.request.get(`/api/v1/companies/${cid}/imports`)).json();
  await apiPost(page, `/api/v1/companies/${cid}/imports/${list.items[0].id}/undo`, { includeEdited: false, edited: 0 });
  await page.reload();
  const deleted = page.getByRole('listitem').filter({ hasText: /Импорт №\d+/ }).filter({ hasText: 'Удаление' });
  await expect(deleted).toContainText('выгрузка.xlsx');
  await deleted.getByText('Подробности').click();
  await expect(deleted.getByRole('definition')).toHaveText('Импорт отменён: удалено 3 операции, 1 счёт, 2 категории, 1 контрагент.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: FAIL — `auditSubject` и `importDetails` не экспортируются из `src/client/lib/audit-format`.

- [ ] **Step 3: `auditSubject` и `importDetails`**

В `src/client/lib/audit-format.ts` замените первую строку файла

```ts
export const ENTITY_LABELS: Record<string, string> = {
```

на

```ts
import type { ImportUndoResult } from '../../shared/schemas/imports';
import { undoResultText } from './import-history';
import { createdParts, formatCount, operationsText } from './import-panel';

export const ENTITY_LABELS: Record<string, string> = {
```

Добавьте в конец `src/client/lib/audit-format.ts`:

```ts
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCounts = <K extends string>(v: unknown, keys: readonly K[]): v is Record<K, number> => isObj(v) && keys.every((k) => typeof v[k] === 'number');
const COUNT_KEYS = ['rows', 'income', 'expense', 'transfer', 'added', 'duplicates', 'skippedFuture'] as const;
const CREATED_KEYS = ['accounts', 'categories', 'counterparties', 'projects', 'tags'] as const;

/** Что изменилось, кроме сущности и номера: у импорта — имя файла («Импорт №5 · выгрузка.xlsx», §6.5 спецификации импорта). */
export function auditSubject(e: { entity: string; diff: Record<string, unknown> | null }): string | null {
  return e.entity === 'import' && typeof e.diff?.fileName === 'string' ? e.diff.fileName : null;
}

/**
 * «Подробности» записи импорта на странице «История действий» (§6.5 спецификации импорта): у импорта — числа строк,
 * добавленного, пропущенного и созданного, у отмены — её итог. null — запись не импорта или неизвестного вида
 * (показывается как есть).
 */
export function importDetails(e: { entity: string; action: string; diff: Record<string, unknown> | null }): { label: string; value: string }[] | null {
  if (e.entity !== 'import' || !e.diff) return null;
  const d = e.diff;
  if (e.action === 'create' && isCounts(d.counts, COUNT_KEYS) && isCounts(d.created, CREATED_KEYS)) {
    const c = d.counts;
    const created = createdParts(d.created);
    return [
      { label: 'Строк в файле', value: formatCount(c.rows) },
      { label: 'Добавлено', value: `${operationsText(c.added)} (доходов ${formatCount(c.income)}, расходов ${formatCount(c.expense)}, переводов ${formatCount(c.transfer)})` },
      { label: 'Пропущено дубликатов', value: formatCount(c.duplicates) },
      { label: 'Пропущено плановых', value: formatCount(c.skippedFuture) },
      { label: 'Создано', value: created.length > 0 ? created.join(', ') : 'ничего' },
    ];
  }
  if (e.action === 'delete' && isObj(d.deleted) && isObj(d.kept)) {
    const kept = d.kept;
    if (
      isCounts(d.deleted, ['operations', ...CREATED_KEYS] as const) &&
      typeof kept.operations === 'number' &&
      isCounts(kept.created, CREATED_KEYS) &&
      Array.isArray(kept.names) &&
      Array.isArray(kept.accounts)
    ) {
      return [{ label: 'Итог', value: undoResultText({ deleted: d.deleted, kept: kept as unknown as ImportUndoResult['kept'] }) }];
    }
  }
  return null;
}
```

- [ ] **Step 4: Страница «История действий»**

В `src/client/pages/settings/AuditSettings.tsx` замените

```tsx
import { ACTION_LABELS, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, pageDiff, SYSTEM_ENTITIES } from '../../lib/audit-format';
```

на

```tsx
import { ACTION_LABELS, auditSubject, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, importDetails, pageDiff, SYSTEM_ENTITIES } from '../../lib/audit-format';
```

Замените

```tsx
  const diff = pageDiff(e);
  const rows = diffRows(diff, e.entity);
```

на

```tsx
  const diff = pageDiff(e);
  const rows = diffRows(diff, e.entity);
  // импорт (§6.5 спецификации импорта): имя файла в строке записи, в подробностях — числа или итог отмены
  const subject = auditSubject(e);
  const details = importDetails(e);
```

Замените

```tsx
          {e.entityId !== null ? ` №${e.entityId}` : ''}
        </span>
      </div>
```

на

```tsx
          {e.entityId !== null ? ` №${e.entityId}` : ''}
        </span>
        {subject && <span className="min-w-0 [overflow-wrap:anywhere]">{subject}</span>}
      </div>
```

Замените

```tsx
          {rows ? (
```

на

```tsx
          {details ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {details.map((d) => (
                <div key={d.label} className="contents">
                  <dt className="text-muted">{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : rows ? (
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/import.spec.ts -g "запись об импорте"`
Expected: PASS.

- [ ] **Step 6: Full check**

Run: `npm test`
Expected: 1047 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e` — два раза подряд.
Expected: 166 из 166 оба раза.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/audit-format.ts src/client/pages/settings/AuditSettings.tsx tests/client/audit-format.test.ts e2e/import.spec.ts
git commit -m "feat: история действий — запись импорта: имя файла, «Подробности» числами, итог отмены" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: README «Импорт из Finmap» и `shots:ux` — `c24-history-imports` (§11.4, §12 шаг 6, §13)

**Files:**
- Modify: `README.md`, `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: из задач 2–4 — `POST …/imports`, `POST …/imports/:id/undo`, вкладка «Импорты» с кнопкой «Отменить импорт «…» от …»; в `scripts/ux-shots.ts` — `Page`, `FinmapLikeValue`, `finmapLikeXlsx`, `finmapLikeSample`, `banner`, `table`, `Scenario`.
- Produces: снимок `c24-history-imports.png` (пара `24b-history-imports.png`, снимка Finmap нет) — последний сценарий `SCENARIOS`.

- [ ] **Step 1: README**

В `README.md` замените

```md
  - панель «История действий» по иконке в шапке: последние операции, «Тип: Расход → Перевод» у смены типа, «Подробнее» — полная лента;
```

на

```md
  - панель «История действий» по иконке в шапке: вкладка «Журнал» — последние операции, «Тип: Расход → Перевод» у смены типа; вкладка «Импорты» — импорты файлов с отменой; «Подробнее» — полная лента;
```

Замените

```md
- **Импорт из Finmap (план И-2):**
```

на

```md
- **Импорт из Finmap (планы И-2 и И-3):**
```

Замените

```md
  - сверка с файлом — `npm run import:check` (раздел «Импорт из Finmap»).

Пока нет (следующие шаги): отмена импорта и вкладка «Импорты» (план И-3), экспорт в формате Finmap (план Э), отчёты.
```

на

```md
  - сверка с файлом — `npm run import:check` (раздел «Импорт из Finmap»);
  - «История действий» → вкладка «Импорты»: кто, когда и какой файл импортировал; «Отменить» удаляет операции импорта, а созданные им счета и справочники — если они больше нигде не используются; операции, изменённые после импорта, по умолчанию остаются.

Пока нет (следующие шаги): экспорт в формате Finmap (план Э), отчёты.
```

Замените

```md
Импортируйте в новую пустую компанию: отмены импорта пока нет (появится в плане И-3), поэтому для повтора создайте новую компанию.
```

на

```md
Импортируйте в новую пустую компанию. Чтобы повторить импорт (например, с исправленным файлом), отмените прежний — «История действий» → «Импорты» → «Отменить импорт» (шаг 9) — и импортируйте снова в ту же компанию.
```

Замените

```md
8. **Повторный импорт того же файла** показывает все строки дубликатами, «Этот файл уже импортирован» и «Нечего импортировать: все строки — дубликаты».
```

на

```md
8. **Повторный импорт того же файла** показывает все строки дубликатами, «Этот файл уже импортирован» и «Нечего импортировать: все строки — дубликаты».
9. **Отмена импорта:** значок «История действий» в шапке (на телефоне — «Ещё» → «История действий») → вкладка «Импорты» → «Отменить» у нужного файла → «Отменить импорт».
   - Удаляются все операции импорта, а также созданные им счета, категории, контрагенты, проекты и теги — если на них больше ничего не ссылается. Системные категории и всё, что было в компании до импорта, остаётся. У счетов, которые были до импорта, возвращаются прежние стартовый баланс и дата открытия — если их не меняли после импорта и не осталось операций раньше прежней даты открытия.
   - Операции, которые после импорта правили или к которым прикрепили файл, по умолчанию остаются — подтверждение называет их число. Флажок «Удалить и изменённые» удаляет и их.
   - Что осталось и почему, видно в итоге: «Импорт отменён: удалено … Оставлено: …». Запись импорта остаётся в списке с пометкой «Отменён».
   - Счёт в архиве мешает отмене: верните его из архива и отмените снова.
   - После отмены журнал пуст (если в компании не было других операций): импортируйте файл снова с шага 3.
```

В строке таблицы команд `npm run bench:import` замените

```md
загрузка, пересчёт и запись 16 000 строк (бюджеты 3 с, 1 с и 5 с; пик памяти 16 000 строк — не больше 400 МБ)
```

на

```md
загрузка, пересчёт, запись и отмена 16 000 строк (бюджеты 3 с, 1 с, 5 с и 3 с; пик памяти 16 000 строк — не больше 400 МБ)
```

- [ ] **Step 2: Сценарий снимка**

В `scripts/ux-shots.ts` замените

```ts
/** Файл с ошибками строк: дата текстом, пустая сумма, строка без счёта. */
```

на

```ts
/** Компания открытой страницы и заголовки защиты от CSRF — для запросов API из сценария. */
const apiOf = (p: Page) => {
  const url = new URL(p.url());
  return { cid: Number(/\/c\/(\d+)\//.exec(url.pathname)![1]), headers: { origin: url.origin, 'x-requested-with': 'fetch' } };
};
/** Импорт синтетического файла через API (вкладка «Импорты», §7 спецификации импорта): загрузка и запись; id импорта. */
const importViaApi = async (p: Page, name: string, rows: FinmapLikeValue[][]): Promise<number> => {
  const { cid, headers } = apiOf(p);
  const up = await p.request.post(`/api/v1/companies/${cid}/imports/upload`, {
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    data: finmapLikeXlsx(rows),
  });
  if (!up.ok()) throw new Error(`Загрузка: ${up.status()} ${await up.text()}`);
  const preview = (await up.json()) as { token: string; revision: string };
  const done = await p.request.post(`/api/v1/companies/${cid}/imports`, { headers, data: { token: preview.token, accounts: [], revision: preview.revision } });
  if (!done.ok()) throw new Error(`Запись: ${done.status()} ${await done.text()}`);
  return ((await done.json()) as { import: { id: number } }).import.id;
};
/** Отмена импорта через API (без изменённых операций). */
const undoViaApi = async (p: Page, importId: number) => {
  const { cid, headers } = apiOf(p);
  const res = await p.request.post(`/api/v1/companies/${cid}/imports/${importId}/undo`, { headers, data: { includeEdited: false, edited: 0 } });
  if (!res.ok()) throw new Error(`Отмена: ${res.status()} ${await res.text()}`);
};
/** Файл с ошибками строк: дата текстом, пустая сумма, строка без счёта. */
```

Замените

```ts
    act: async (p) => {
      await openImport(p, true);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
    },
  },
];
```

на

```ts
    act: async (p) => {
      await openImport(p, true);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
    },
  },
  {
    // вкладка «Импорты» (§7 спецификации импорта) — пара к Finmap 24 «История действий» (там снимок c24-history):
    // отменённый импорт и импорт с «Отменить». Сценарий последний: импорт меняет данные демо-компании
    ours: 'c24-history-imports.png',
    finmap: '24b-history-imports.png',
    path: 'log',
    act: async (p) => {
      await undoViaApi(p, await importViaApi(p, 'выгрузка-сентябрь.xlsx', finmapLikeSample()));
      await importViaApi(p, 'выгрузка-октябрь.xlsx', finmapLikeSample());
      // импорт и отмена шли мимо интерфейса: журнал, счета и балансы — заново
      await p.reload();
      await table(p).locator('tbody tr').first().waitFor();
      await banner(p).getByRole('button', { name: 'История действий' }).click();
      const history = p.getByRole('dialog', { name: 'История действий' });
      await history.getByRole('tab', { name: 'Импорты' }).click();
      await history.getByRole('button', { name: /^Отменить импорт «выгрузка-октябрь\.xlsx»/ }).waitFor();
    },
  },
];
```

- [ ] **Step 3: Снимки**

Run: `npm run shots:ux`
Expected: «Готово: …index.html — снято 56 из 56.» В `docs/research/screens/v2/parity/c24-history-imports.png` — панель «История действий», выбрана вкладка «Импорты»: сверху «выгрузка-октябрь.xlsx» с кнопкой «Отменить», ниже «выгрузка-сентябрь.xlsx» со строкой «Отменён …» и без кнопки. Снимки в git не попадают.

- [ ] **Step 4: Full check**

Run: `npm test`
Expected: 1047 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e`
Expected: 166 из 166.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/ux-shots.ts
git commit -m "docs: импорт — README: повтор через «Отменить импорт», шаг «Отмена импорта»; shots:ux — вкладка «Импорты»" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
