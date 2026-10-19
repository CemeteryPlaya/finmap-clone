# Отмена действий журнала, категория в «Аналитике», контрагенты системных категорий, шаблоны импорта склада — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (решение владельца 2026-10-18: без субагентов; исполнение — claude-code-harness `harness-work` в режиме Solo, ревью — `harness-review` manual-pass). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** четыре просьбы владельца от 2026-10-19: в системной категории — только контрагенты закреплённого типа; «Отмена» действий с операциями в «Истории действий» с каскадом; выбор одной категории в «Деньгах», «Прибыли» и «Проектах» нажатием; явная кнопка «Выбрать файл» и шаблоны .xlsx с выпадающими списками в импорте склада.

**Architecture:**
- **Контрагенты** — только клиент: `counterpartyOptions` получает обязательный режим `'only' | 'first'`; форма операции и «Указать» — `'only'`, документ склада сохраняет прежние секции (`'first'`). Тип для разбиения — общий тип всех строк (`commonCounterpartyType`).
- **Отмена** — новая таблица `audit_undo` (запись истории → запись «Отмена», миграция 0011) и сервис `operations/undo.ts`. Каскад — неотменённые действия той же операции с `id ≥ выбранного`, от последнего к выбранному, в одной транзакции `BEGIN IMMEDIATE`; каждый шаг — новый метод `operations.revert`, который идёт тем же кодом и теми же проверками, что правка, удаление и восстановление, но обычных записей истории не пишет (вложенные `mutate` — точки сохранения better-sqlite3, как в массовых действиях `bulk.ts`). Лента истории отдаёт у каждой записи `undoneBy` и `undoable`.
- **Категория в «Аналитике»** — только клиент: параметр адреса `cat=<id>` в `ReportUrlState.focusCategoryId`; в параметрах API категории фильтра заменяются выбранной (`categories=<id>`, без `withoutCategory`). Сервер уже берёт подкатегории (`withChildren`) и убирает строки склада при фильтре по категориям (`stockKept`) — серверных изменений нет.
- **Шаблоны склада** — писатель XLSX учится выпадающим спискам (`<dataValidations>`) и скрытым листам; новый `stock/import-template.ts` собирает книгу по данным компании; маршрут `GET stock/import/:kind/template.xlsx`.

**Tech Stack:** Node 24, TypeScript, Fastify 5, zod 4, Drizzle + better-sqlite3, React 19, react-router, TanStack Query 5, Tailwind 4, Vitest (node), Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-19-journal-undo-analytics-focus-design.md](../specs/2026-10-19-journal-undo-analytics-focus-design.md) — части 1–4 и их «Решения исполнителя» (обязательны). Пункт 5 (Vercel) отложен — не планируется.

**Предусловие:** ветка `stage1/plan1-skeleton` на f9bbb7d или позже. На старте: `npm test` — 1569 пройдено, 1 пропущен; `npm run typecheck` чист; `npm run test:e2e` — 222 из 222; `npm run shots:ux` — 85 из 85.

**После плана:** все прежние тесты зелёные; новых тестов vitest не меньше 35; e2e не меньше 228; `shots:ux` — 88 (новые снимки — в задачах 3, 5 и 7).

## Решения, принятые при планировании

В задаче 8 решения переносятся в спецификацию блоком «Решения планирования».

1. **Режим списка контрагентов.** `counterpartyOptions(counterparties, selected, preferred, mode)` — `mode` обязателен (typecheck находит все вызовы). `'only'`: при `preferred` — только контрагенты этого типа плюс уже выбранный (любого типа, в общем порядке списка), без заголовков секций; без `preferred` — все. `'first'` — прежнее поведение (тип секцией, затем «Остальные»): им пользуется только `DocForm` склада («Поставщики» в поступлении, «Клиенты» в продаже), потому что спецификация меняет лишь системные категории.
2. **Тип для нескольких строк** — `commonCounterpartyType(tree, categoryIds)`: тип есть, если у всех строк он одинаковый и не `null` («Налоги» и «НДС» — один тип `tax`, R6); иначе `null` и список полный. Им пользуется форма операции (список, подпись поля и тип для «+ Создать»). «Указать» — только у операции с одной строкой (R8). «Зарплата за месяц» (`salaryCategory`) по-прежнему смотрит первую строку.
3. **Что отменяется.** Записи истории с `entity = 'operation'` и действием `create | update | delete | restore` (`UNDOABLE_ACTIONS`). Отменить можно, если записи нет в `audit_undo`, строка операции существует (жёстко удалённая отменой импорта — нет) и, пока операция удалена, `id` записи не меньше последнего неотменённого «Удаления» этой операции (R5). Компания в архиве — 422 `ARCHIVED_REFERENCE`, как у правки; в интерфейсе кнопки нет.
4. **Шаг отмены по действию:** `create` → мягкое удаление; `update` → правка к значениям `diff.before`; `delete` → восстановление; `restore` → удаление. Шаг, который уже совпадает с состоянием (удаление удалённой), ничего не меняет. Правка идёт через общий код `update`: проверки `check()`, инвариант 7 (архивный счёт), пересчёт курса при смене денежных полей, оплаты закупок (`stockPayments` из «было»). Правило «у перевода нет даты сделки» срабатывает только при смене типа **в** перевод (`next.type === 'transfer'`), иначе нельзя было бы вернуть расход с датой сделки.
5. **Без обычных записей.** Шаги отмены не пишут `update`/`delete`/`restore` — иначе их можно было бы «отменить» и тем повторить отменённое (спецификация запрещает). Пишется одна запись `action: 'undo'`, `entity: 'operation'`, `entityId` — операция, `diff: {type, undone: {id, action, type}[] /* от новой к старой, R10 */, deleted: boolean /* операция удалена после отмены */}`; в `audit_undo` — строка на каждую отменённую запись. Версия операции растёт на каждом шаге.
6. **Конфликт.** Клиент присылает `ids` из окна подтверждения; сервер пересчитывает каскад в транзакции; не совпадает (порядок не важен) — 409 `VERSION_CONFLICT` «Действия с операцией изменились — обновите историю», ничего не записано. Ошибка любого шага — откат всего, сообщение шага (например, «Категория «Аренда» в архиве — выберите другую»).
7. **API отмены.** `GET /api/v1/companies/:cid/audit/:id/undo` → `{entries: UndoPreviewEntry[]}` (каскад для окна); `POST` того же адреса с `{ids: number[]}` (1–1000) → `{undone: number[], undoId: number, operation: {id: number, deleted: boolean}}`. Ошибки: нет записи в компании — 404 «Запись истории не найдена»; не операция или не то действие — 422 `UNDO_UNSUPPORTED` «Это действие отменить нельзя»; запись раньше удаления удалённой операции — 422 `UNDO_UNSUPPORTED` «Операция удалена — сначала отмените её удаление» (R5); уже отменена — 409 `UNDO_DONE` «Действие уже отменено»; операции нет — 404 «Операция больше не существует»; каскад длиннее 1000 — 422 `UNDO_TOO_LONG` (R14).
8. **Где кнопка.** «Отмена» — только в панели «История действий» (вкладка «Журнал»), как в спецификации. Полная страница «История действий» показывает пометку «Отменено» и записи «Отмена», без кнопки.
9. **Выбор категории в адресе** — `cat=<id>`, последним параметром; разбор мягкий (неверное — нет выбора; повтор — первое значение). Неизвестный id убирается, как фильтры, с текстом «Из ссылки убраны фильтры, которых больше нет: выбранная категория». Выбор меняет адрес записью в историю браузера (`update(next, {push: true})`), чтобы «Назад» снимал его; прочие контролы — как раньше, без записи. «Сбросить» снимает выбор (`changedControls.category`); в число на кнопке «Фильтры» телефона выбор не входит (видна плашка).
10. **Где нажимается категория.** «Деньги» и «Прибыль» в разрезе «По категориям»: сегмент кольца и сегмент столбца стека (мышью), строка легенды кольца и легенды стека (кнопки, клавиатура), название строки таблицы. Щелчок по колонке стека вне сегментов и клавиатура по колонкам по-прежнему выбирают колонку периода (§2.5 спецификации «Аналитика», R4). В таблице у строки с подкатегориями название выбирает категорию, а раскрытие уходит на отдельную кнопку-шеврон «Подкатегории «…»» с `aria-expanded`. «Проекты» с категориями: название строки категории (и щелчок по строке) выбирает категорию вместо списка всех операций строки; «Доходы» и «Расходы» строки открывают свои операции, как раньше. Не нажимаются: «Прочие», «Без категории», «Без подкатегории», «…», строки склада, групп и остатков. Плашка «Категория: {название} ×» видна при выборе в любом разрезе и режиме.
11. **График «детальнее».** Если у выбранной категории есть подкатегории, кольцо и стек её группы строятся по подкатегориям (`focusChart`); нажатие на подкатегорию переключает выбор на неё, и график показывает одну её строку (R9).
12. **Шаблон склада.** Книга: первый лист «Товары» или «Поступления» (заголовки и 2 строки примера), «Как заполнять» (правила столбцом A), скрытый «Списки». Пример каталога: «Кола 0,5 | Напитки | шт | | 350» и «Чипсы | Снеки | шт | | 400». Пример поступлений: вчерашняя дата (по `APP_TIMEZONE`), «Поставщик А», «Кола 0,5», 24, сумма 7200; та же дата, «Поставщик А», «Чипсы», 10, цена 250. Списки: каталог — «Группа» (неархивные группы компании по имени), «Единица» (`шт`, `л`, `кг`, `уп`); поступления — «Товар» (неархивные некомплекты по имени), «Поставщик» (неархивные контрагенты типа «Поставщик» по имени). Пустой список — без выпадающего списка у столбца. Проверка ячеек: `type="list"`, `allowBlank="1"`, `showErrorMessage="1"`, `errorStyle="information"`, заголовок «Нет в списке», текст «Такого значения нет в списке — при импорте оно будет создано»; диапазон — строки 2…`STOCK_IMPORT_MAX_ROWS + 1`. Имена файлов: «Шаблон товаров.xlsx», «Шаблон поступлений.xlsx».

## Решения по ревью плана (harness-review, manual-pass, 2026-10-20: REQUEST_CHANGES, 2 major, 9 minor, 4 вопроса)

- **R1 (M1, Plans.md).** В `Plans.md` добавлена «Phase 3» — задачи 1–8 этого плана с DoD, зависимостями (1; 2 → 3; 4 → 5; 6 → 7; все → 8) и метками `[lane:gate]`, `[tdd:required]` (у задачи 8 — `[tdd:skip:docs]`). `Plans.md` по-прежнему не коммитится.
- **R2 (M2, прежние e2e).** Задача 1 не добавляет новый e2e, а переписывает проверку «Зарплаты» в `e2e/operation-form.spec.ts:232-242`. Задача 3 правит `e2e/service-screens.spec.ts:312-316` под кнопки «Отмена» (R5). Итог e2e — не меньше 228.
- **R3 (вопрос 1, статус спецификации).** Владелец одобрил спецификацию 2026-10-19 (постановка задачи). Задача 8 ставит статус «Одобрена владельцем 2026-10-19; реализована».
- **R4 (вопрос 2, столбец и сегмент графика).** Следуем спецификации: щелчок мышью по сегменту стека выбирает категорию сегмента. Щелчок по колонке вне сегментов и клавиатура по-прежнему выбирают колонку периода. Клавиатурный путь к категории — кнопки легенды. Новая чистая функция `segmentAt(series, column, value)` в `src/client/lib/charts.ts`; у `ChartColumns` появляется необязательный `pick?: (index: number, y: number) => boolean`: `true` — щелчок ушёл в выбор категории. Решение 10 исправлено.
- **R5 (вопрос 3, отмена при удалённой операции).** Пока операция удалена, отменяемы только записи с `id ≥` её последнего неотменённого «Удаления». Раньше — 422 `UNDO_UNSUPPORTED` «Операция удалена — сначала отмените её удаление». После отмены удаления более ранние записи снова отменяемы, как в спецификации. Решения 3 и 7 исправлены.
- **R6 (вопрос 4, «Налоги» + «НДС»).** Общий тип строк остаётся: в постановке владельца правило звучит как «одна системная категория (один тип)».
- **R7 (m1, числа тестов).** Новых тестов vitest — не меньше 35, итог — не меньше 1604 пройденных.
- **R8 (m2).** Окно «Указать» есть только у операции с одной строкой (`canAssign`), поэтому `journal-assign.ts` получает лишь `mode: 'only'`. Тест разбитой операции в «Указать» не пишется, `singleCategory` остаётся.
- **R9 (m3).** `focusChart`: если выбранная категория с подкатегориями — показываются её подкатегории; если без подкатегорий — одна её строка (так и у подкатегории).
- **R10 (m4).** Запись «Отмена» хранит тип у каждого действия: `diff.undone: {id: number; action: string; type: string | null}[]`. Тип берётся из `diff.type` отменённой записи.
- **R11 (m5).** У записи «Отмена» в «Подробностях» полной страницы — понятные строки (`undoDetails`) вместо JSON: «Отменено» и «Записи истории».
- **R12 (m6).** Апострофы `xmlText` не экранирует, поэтому `formula1` содержит `'Списки'!$A$2:$A$4` как есть. Тест разбирает атрибуты и текст элемента, а не сравнивает строку XML целиком.
- **R13 (m7).** Тест задачи 6 читает `xl/worksheets/sheet1.xml` скачанного файла и проверяет `<dataValidation>` с `sqref` и `formula1`.
- **R14 (m8).** Предел `ids` поднят до 1000. Каскад длиннее — 422 `UNDO_TOO_LONG` «Слишком много действий для одной отмены — отмените сначала более поздние» (и в предпросмотре).
- **R15 (m9).** В итогах задачи 8 записать: отмена правок не снимает у операции импорта пометку «изменена» — версия остаётся больше 1, как и после восстановления.

Повторная проверка (2026-10-20): **APPROVE**, 0 critical, 0 major, 4 minor — закрыты решениями R16–R19.

- **R16 (typecheck вне плана).** В Files задачи 2 добавлен `tests/server/import-undo.test.ts:550-556`: подменный `AuditService` возвращает `real.record(...)` (тип `number`). В Files задачи 3 — `tests/client/indicators.test.ts:73`: в литерал `AuditEntry` добавить `undoneBy: null, undoable: false`. Поля клиента остаются обязательными.
- **R17 (красный прогон задачи 4).** Шаг 3 задачи 4 запускает и `tests/client/charts.test.ts`; в «Карту файлов» добавлены `charts.ts` и `ChartColumns.tsx`.
- **R18 (клавиатура и `pick`).** `ChartColumns` вызывает `pick` только у щелчка мышью (`e.detail > 0`). Enter и пробел всегда выбирают колонку. В e2e задачи 5 — проверка: Enter на колонке стека не даёт плашки.
- **R19 (координаты в e2e).** Прямоугольник сегмента стека получает `data-segment={rowId}`. e2e щёлкает в центр его `boundingBox()`, не вычисляя доли сумм.
- **Мелочи из наблюдений.** Кнопка «Отмена» на телефоне — не меньше 44 px (`max-md:min-h-11`, как у вкладок панели). В e2e задачи 3 — проверка высоты на 390 px. В `Plans.md` DoD снимков записан как «+1 снимок» (порядок задач свободный). У задачи 11 — «два прогона».

## Global Constraints

- **Без новых npm-пакетов и сети.** Только синтетические данные: «Кола 0,5», «Чипсы», «Клуб 1», «Клуб 2», «Поставщик А», «Сотрудник А».
- **Терминология:** «Категория», никогда «Статья».
- **Тесты:** Vitest в node без DOM (логика клиента — в чистых функциях `src/client/lib/`); Playwright — один воркер, порт 41731, `admin` / `e2e-password-1`, данные через `page.request` с `origin` и `x-requested-with: fetch`, без фиксированных пауз.
- **Доступность:** `Modal` с «×», `ConfirmDialog` (`role="alertdialog"`); кнопки-переключатели — `aria-pressed`; недоступная фокусируемая кнопка — `aria-disabled`; подписи полей — `Field` или `aria-label`.
- **Невидимые символы** (U+2212, U+00A0, U+202F, U+200B) в коде — только escape-последовательностями; после записи файла — `node .superpowers/sdd-tools/sdd-tpl/escape-invisible.cjs <файлы>` (заголовки тестов он не правит — там обычный дефис).
- **Концы строк:** рабочая копия в CRLF; файлы — инструментами Write/Edit; скрипты правок — файлом в scratchpad, с нормализацией `\r\n`. Хук блокирует команды bash с подстрокой `.key` — такие правки только Edit.
- **Безопасность среды:** никогда `npm start`, `npm run stop`, `npm run setup`, `service:*`, `schtasks`, `icacls`; порты 3457 и 3460 и папка `data/` не трогаются; `shots:ux` — во временную папку вне репозитория; в командах нет подстроки «.env».
- **Время:** команды переднего плана с `timeout` (vitest 600 с, typecheck 300 с, e2e 1200 с, shots 900 с); никаких фоновых ожиданий.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`; задачи с интерфейсом — ещё `npm run test:e2e` (меняют e2e — два прогона подряд); коммит с файлами поимённо (`package-lock.json` и `Plans.md` — никогда) и трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Отмена правки, после которой справочник ушёл в архив.** Ожидание: 422 с причиной («Категория «Аренда» в архиве — выберите другую»), операция и история не изменились, запись по-прежнему отменяема. Тест: задача 2.
2. **Каскад, сломавшийся на середине.** Ожидание: первый шаг (позднее действие) не остаётся применённым — откат всей транзакции, `audit_undo` пуст. Тест: задача 2.
3. **Отмена «Изменить в перевод».** Ожидание: расход возвращается с датой сделки, контрагентом и категорией; курс и сумма в базовой валюте пересчитаны. Тест: задача 2.
4. **Ссылка с `cat` на удалённую категорию или категорию другой компании.** Ожидание: выбор снимается с текстом «Из ссылки убраны фильтры…», отчёт не падает 400. Тест: задача 4.
5. **Шаблон для компании с пустыми справочниками и с комплектами и архивом.** Ожидание: книга открывается, проверка импорта шаблона — без ошибок; комплектов и архивных в «Списках» нет; пустой список не даёт выпадающего списка. Тест: задача 6.

---

## Карта файлов

```
src/client/lib/operation-options.ts          # counterpartyOptions(…, mode), commonCounterpartyType, counterpartyLabelOf
src/client/lib/journal-assign.ts             # «Указать»: общий тип строк
src/client/components/operation/OperationForm.tsx, journal/BulkEditDialog.tsx, stock/DocForm.tsx   # вызовы с mode
src/server/db/schema.ts, src/server/db/migrations/0011_*.sql (+ meta)   # таблица audit_undo
src/server/modules/audit/service.ts, mutate.ts   # действие undo, record → id, undoneBy/undoable в ленте
src/server/modules/operations/service.ts     # revert (шаг отмены без обычной истории)
src/server/modules/operations/undo.ts        # (новый) каскад, предпросмотр, отмена
src/server/modules/operations/routes.ts, src/server/app.ts
src/shared/schemas/audit.ts                  # (новый) схема и типы отмены
src/client/lib/queries.ts, history.ts, audit-format.ts
src/client/lib/operation-undo.ts             # (новый) запросы и тексты окна отмены
src/client/components/ConfirmDialog.tsx      # details — список под текстом
src/client/components/HistoryDrawer.tsx, src/client/pages/settings/AuditSettings.tsx
src/client/lib/report-url.ts, report-settings.ts
src/client/lib/report-focus.ts               # (новый) строка → категория, переключение, подпись, график
src/client/lib/charts.ts, src/client/components/charts/ChartColumns.tsx   # segmentAt, pick (R4, R17, R18)
src/client/components/analytics/CategoryFocus.tsx   # (новый) плашка
src/client/components/analytics/ReportCharts.tsx, ReportTable.tsx, ProjectsTable.tsx
src/client/components/charts/DonutChart.tsx, StackedBars.tsx
src/client/pages/analytics/ReportScreen.tsx, ProjectsPage.tsx
src/server/http/xlsx.ts                      # выпадающие списки, скрытые листы
src/server/modules/stock/import-template.ts  # (новый) шаблоны склада
src/server/modules/stock/import.ts, routes.ts
src/client/lib/stock-import.ts, src/client/components/stock/StockImportDialog.tsx
tests/…, e2e/history-undo.spec.ts (новый), e2e/…, scripts/ux-shots.ts
README.md, спецификация, docs/superpowers/followups/…
```

---

### Task 1: Контрагенты системных категорий (часть 1)

**Files:**
- Modify: `src/client/lib/operation-options.ts`, `src/client/lib/journal-assign.ts`, `src/client/components/operation/OperationForm.tsx:398-420,936-948`, `src/client/components/journal/BulkEditDialog.tsx:33`, `src/client/components/stock/DocForm.tsx:467`
- Test: `tests/client/operation-options.test.ts`, `tests/client/journal-assign.test.ts`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CounterpartyListMode = 'only' | 'first';
  export function counterpartyOptions(counterparties: readonly Counterparty[], selected: number | null, preferred: CounterpartyType | null, mode: CounterpartyListMode): PickerOption[];
  export function commonCounterpartyType(tree: CategoryTree, categoryIds: readonly (number | null)[]): CounterpartyType | null;
  export function counterpartyLabelOf(type: CounterpartyType | null): string; // COUNTERPARTY_TYPE_SINGULAR[type] или «Мой контрагент»
  ```
  `counterpartyLabel(tree, id)` остаётся и становится `counterpartyLabelOf(preferredCounterpartyType(tree, id))`.

- [ ] **Step 1: Тесты** `tests/client/operation-options.test.ts` — прежний тест «подходящий тип первым…» (строки 122–130) заменяется:
  - `контрагенты системной категории: только закреплённый тип, выбранный другого типа остаётся`: `list = [cp(1, 'Поставщик А', 'supplier'), cp(2, 'Сотрудник А', 'employee'), cp(3, 'Сотрудник Б', 'employee', ARCH), cp(4, 'Сотрудник В', 'employee')]`. `counterpartyOptions(list, null, 'employee', 'only')` → `[{id: 2, label: 'Сотрудник А'}, {id: 4, label: 'Сотрудник В'}]`; `(list, 1, 'employee', 'only')` → `[{id: 1, label: 'Поставщик А'}, {id: 2, …}, {id: 4, …}]`; `(list, 3, 'employee', 'only')` → `[{id: 2, …}, {id: 3, label: 'Сотрудник Б (в архиве)'}, {id: 4, …}]`; `(list, null, null, 'only')` → три неархивных без `section`.
  - `режим first — прежние секции (документ склада)`: `(list, null, 'supplier', 'first')` → `[{id: 1, label: 'Поставщик А', section: 'Поставщики'}, {id: 2, …, section: 'Остальные'}, {id: 4, …, section: 'Остальные'}]`.
  - `общий тип строк разбиения`: `commonCounterpartyType(tree, [10, 11]) === 'employee'`; `(tree, [10, 21]) === null`; `(tree, [10, null]) === null`; `(tree, []) === null`; `(all, [105, 106]) === 'tax'`; `counterpartyLabelOf(null) === 'Мой контрагент'`, `counterpartyLabelOf('owner') === 'Владелец'`.
  - `tests/client/journal-assign.test.ts`: ожидание строк 140–143 — `[{id: 8, label: 'Алина'}]` (R8: других правок нет).
- [ ] **Step 2:** `timeout 600 npx vitest run tests/client/operation-options.test.ts tests/client/journal-assign.test.ts` — FAIL.
- [ ] **Step 3: Реализация** по решениям 1–2. `OperationForm`: `const categoryIds = draft.split ? draft.split.lines.map((l) => l.categoryId) : [draft.categoryId]; const preferred = commonCounterpartyType(p.data.categories, categoryIds);` — для `options`, подписи (`counterpartyLabelOf(preferred)`) и `createItem` (`preferred ?? (kind === 'income' ? 'client' : 'supplier')`). `journal-assign.ts` — только `mode: 'only'` (R8). `BulkEditDialog` — `(…, null, null, 'only')`; `DocForm` — `(…, preferred, 'first')`.
- [ ] **Step 4: e2e** (R2) — прежняя проверка «Зарплаты» в `e2e/operation-form.spec.ts:232-242` переписывается: в «Зарплате» список `['+ Создать контрагента', 'Без контрагента', 'Айгерим']`, заголовков «Сотрудники» и «Остальные» нет; «Аренда» — прежние `['+ Создать контрагента', 'Без контрагента', 'ТОО Ромашка', 'Айгерим']`. В тот же тест: выбрать в «Аренде» «ТОО Ромашка», затем категорию «Зарплата» → в списке «Сотрудник» есть «ТОО Ромашка» (уже выбранный другого типа) и «Айгерим». Новых e2e-тестов задача не добавляет.
- [ ] **Step 5:** `timeout 600 npm test`, `timeout 300 npm run typecheck`, `timeout 1200 npm run test:e2e` (дважды) — PASS.
- [ ] **Step 6: Коммит** `feat: контрагенты системных категорий — только закреплённый тип`.

### Task 2: Отмена действий — схема и сервер (часть 2)

**Files:**
- Modify: `src/server/db/schema.ts`; Create: `src/server/db/migrations/0011_*.sql` и `meta/0011_snapshot.json`, `meta/_journal.json` (только `timeout 120 npm run db:generate`)
- Modify: `src/server/modules/audit/service.ts`, `src/server/modules/audit/mutate.ts`, `src/server/modules/operations/service.ts`, `src/server/modules/operations/routes.ts`, `src/server/app.ts`
- Create: `src/server/modules/operations/undo.ts`, `src/shared/schemas/audit.ts`
- Test: `tests/server/operations-undo.test.ts` (новый), `tests/server/schema-0011.test.ts` (новый), `tests/server/audit-api.test.ts`, `tests/server/import-undo.test.ts:550-556` (R16: подменный `record` возвращает `number`)

**Interfaces:**
- Produces:
  ```ts
  // schema.ts
  export const auditUndo = sqliteTable('audit_undo', {
    auditId: integer('audit_id').primaryKey().references(() => auditLog.id),
    undoId: integer('undo_id').notNull().references(() => auditLog.id),
  });
  // audit/service.ts
  export type AuditAction = … | 'undo';
  export const UNDOABLE_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;
  export interface AuditRow { …; undoneBy: number | null; undoable: boolean }
  record(entry: AuditEntry, ex?: Executor): number;          // id новой записи
  // mutate.ts: fn(tx, record: (entry: AuditEntry) => number)
  // operations/service.ts
  export type RevertStep = { kind: 'fields'; before: Partial<OperationInput> } | { kind: 'delete' } | { kind: 'restore' };
  revert(companyId: number, id: number, step: RevertStep, userId: number): void; // только внутри транзакции вызывающего
  // shared/schemas/audit.ts
  export const UNDO_CASCADE_MAX = 1000;
  export const auditUndoSchema = z.object({ ids: z.array(id).min(1).max(UNDO_CASCADE_MAX) });
  export interface UndoneAction { id: number; action: 'create' | 'update' | 'delete' | 'restore'; type: 'income' | 'expense' | 'transfer' | null } // diff.undone записи «Отмена» (R10)
  export interface UndoPreviewEntry { id: number; action: 'create' | 'update' | 'delete' | 'restore'; type: 'income' | 'expense' | 'transfer' | null; at: string; userName: string | null }
  export interface UndoPreview { entries: UndoPreviewEntry[] }
  export interface UndoResult { undone: number[]; undoId: number; operation: { id: number; deleted: boolean } }
  // operations/undo.ts
  export interface OperationUndoService { preview(companyId: number, entryId: number): UndoPreview; run(companyId: number, entryId: number, ids: number[], userId: number): UndoResult }
  export function createOperationUndoService(d: { db: Db; audit: AuditService; operations: OperationsService }): OperationUndoService;
  export function assertCascadeSize(n: number): void;                                   // > UNDO_CASCADE_MAX — 422 UNDO_TOO_LONG (R14)
  export function undoBlock(ex: Executor, companyId: number, operationId: number): number | null; // R5: id последнего неотменённого «Удаления» удалённой операции
  ```

- [ ] **Step 1: Тесты** `tests/server/schema-0011.test.ts` (образец — `schema-0010.test.ts`): `journal.entries[11].tag` — `/^0011_/`; `PRAGMA table_info('audit_undo')` → `[['audit_id', 1, 1], ['undo_id', 1, 0]]`.
- [ ] **Step 2: Тесты** `tests/server/operations-undo.test.ts` на `opsWorld()`; помощники в файле: `feed()` — `GET …/audit?entity=operation`, `preview(id)`, `undo(id)` — предпросмотр и `POST` с его `ids`. Расход по умолчанию: счёт «Касса», 10 000,00 (`1_000_000`), категория `expense`, проект `project`, `paidAt` 2026-10-05.
  - `отмена правки: поля «было», одна запись «Отмена», без новых правок`: правка суммы на 1 500 000 и комментария «Клуб 2» (запись U) → `preview(U).entries` = `[{id: U, action: 'update', type: 'expense', userName: 'Админ'…}]`; `POST` → 200, `undone: [U]`, `operation.deleted === false`; операция: `amount 1_000_000`, `lines[0].amount 1_000_000`, `comment null`, версия 3; `auditCount('operation', 'update') === 1`, `auditCount('operation', 'undo') === 1`; в ленте у U `undoneBy === undoId`, `undoable === false`; запись «Отмена» — `diff = {type: 'expense', undone: [{id: U, action: 'update', type: 'expense'}], deleted: false}`, `undoable === false`.
  - `каскад: отмена первой правки отменяет и вторую`: U1 сумма → 2 000 000, U2 комментарий «Клуб 2»; `preview(U1)` → id `[U2, U1]`; после — сумма 1 000 000, комментарий null, обе отмечены.
  - `отмена удаления и восстановления`: DELETE (D) → отмена D → `deletedAt null`; снова DELETE (D2), restore (R) → отмена R → операция удалена.
  - `отмена добавления удаляет операцию, у её действий «Отмены» нет`: C, U → `preview(C)` = `[U, C]` → `deleted: true`; в ленте у C и U `undoable false`; `preview(C)` — 409 `UNDO_DONE`.
  - `пока операция удалена, отменяемо только удаление; после его отмены — снова и прежние` (R5): C, U (сумма 2 000 000), D. В ленте у C и U `undoable false`, у D — true; `preview(U)` и `POST U` — 422 `UNDO_UNSUPPORTED` «Операция удалена — сначала отмените её удаление»; отмена D → у C и U `undoable true`; `preview(U)` = `[U]` → сумма 1 000 000. Второй случай: D, R (восстановление), отмена R (операция снова удалена) → отменяемо только D.
  - `«Изменить в перевод» отменяется` (Review Focus 3): расход с `accrualDate '2026-10-03'` и контрагентом → PATCH `{version, type: 'transfer', toAccountId: usd, toAmount: 2_000, counterpartyId: null, accrualDate: null, lines: [{categoryId: null, projectId: project, amount: 1_000_000}]}` → отмена → `type 'expense'`, `accrualDate '2026-10-03'`, контрагент, категория `expense`, `toAccountId null`, `toAmount null`, `rate` и `baseAmount` — как до перевода; запись «Отмена» — `undone: [{id, action: 'update', type: 'transfer'}]`, `type: 'expense'` (R10).
  - `длинный каскад — 422 UNDO_TOO_LONG`: тест на чистой функции `assertCascadeSize(n)` из `undo.ts` (`1000` — без ошибки, `1001` — 422 `UNDO_TOO_LONG` «Слишком много действий для одной отмены — отмените сначала более поздние»), без 1001 правки через API.
  - `архив: 422, ничего не изменено, запись отменяема` (Review Focus 1): категория «Аренда» (`expense`) и вторая «Свет»; правка категории на «Свет», «Аренда» в архив (`POST categories/:id/archive`) → `POST` отмены — 422 `ARCHIVED_REFERENCE` «Категория «Аренда» в архиве — выберите другую»; категория операции — «Свет», `auditCount('operation', 'undo') === 0`, у записи `undoable true`.
  - `каскад откатывается целиком` (Review Focus 2): правка категории на «Свет» (U1), правка суммы (U2), «Аренда» в архив → отмена U1 — 422; сумма — после U2, `SELECT COUNT(*) FROM audit_undo` = 0.
  - `конфликт: каскад изменился после предпросмотра — 409`: `preview(U1)` = `[U1]`, затем правка U2, `POST U1 {ids: [U1]}` → 409 `VERSION_CONFLICT` «Действия с операцией изменились — обновите историю»; ничего не изменилось.
  - `что отменить нельзя`: запись `entity 'category'` → 422 `UNDO_UNSUPPORTED`; запись другой компании → 404; операция удалена жёстко (`DELETE FROM operations WHERE id = ?` через `h.t.sqlite`) → в ленте `undoable false`, `preview` — 404 «Операция больше не существует»; компания в архиве → `POST` 422 `ARCHIVED_REFERENCE`.
  - `оплаты закупок возвращаются`: на `stockWorld()` поступление на 10 000,00 от «Поставщик А», расход 6 000,00 поставщику с `stockPayments: [{docId, amount: 600_000}]`, правка оплаты на `400_000` (и суммы) → отмена → `GET operation` → `stockPayments[0].amount === 600_000`.
  - `audit-api.test.ts`: у записей не операций `undoneBy null`, `undoable false`; у записи «Создание» операции — `undoable true`.
- [ ] **Step 3:** `timeout 600 npx vitest run tests/server/operations-undo.test.ts tests/server/schema-0011.test.ts tests/server/audit-api.test.ts` — FAIL.
- [ ] **Step 4: Схема.** `auditUndo` в `schema.ts`, затем `timeout 120 npm run db:generate` — файл `0011_<имя>.sql` с `CREATE TABLE audit_undo` (имя выдаёт drizzle-kit, не править).
- [ ] **Step 5: Реализация.**
  - `audit/service.ts`: `record` — `.returning({id}).get().id`; `list` — `leftJoin(auditUndo, eq(auditUndo.auditId, auditLog.id))` и `leftJoin(operations, and(eq(auditLog.entity, 'operation'), eq(operations.id, auditLog.entityId), eq(operations.companyId, auditLog.companyId)))`; `undoable` — решение 3: у удалённой операции ещё `audit_log.id >= (SELECT MAX(d.id) …)` по неотменённым записям `delete` этой операции (подзапрос в `select`; правило R5 — одно выражение, им же пользуется `undo.ts` через общую функцию `undoBlock(ex, companyId, operationId): number | null` — id, раньше которого отменять нельзя, `null` — ограничения нет).
  - `operations/service.ts`: тела `update`, `remove`, `restore` выносятся во внутренние `doUpdate(companyId, id, patch, userId, opts: {history: boolean})` и т. п.; публичные методы — с `history: true`, `revert` — с `history: false` (решение 4 и 5); внутри `doUpdate` поле `patch.type` имеет тип `OperationType`; правило даты сделки — `typeChange && next.type === 'transfer'`. Публичное поведение не меняется (прежние тесты операций — без правок).
  - `operations/undo.ts`: `cascade(companyId, entry)` — `SELECT` записей операции с `id >= entry.id`, действием из `UNDOABLE_ACTIONS` и без `audit_undo`, по убыванию id. `run`: `requireCompany(db, companyId, {writable: true})`; `db.transaction(() => { … }, {behavior: 'immediate'})`: проверки решения 7 (с R5 и `assertCascadeSize`), сравнение `ids` (решение 6), шаги `operations.revert` по решению 4, затем `audit.record(…, tx)` записи «Отмена» и вставка `audit_undo`. `preview` — те же проверки без записи.
  - Маршруты в `operations/routes.ts` (`deps.undo`), подключение в `app.ts`.
- [ ] **Step 6:** тот же запуск — PASS; `timeout 600 npm test`, `timeout 300 npm run typecheck` — PASS (прежние `operations-audit`, `bulk`, `import-undo` — без изменений ожиданий; в `import-undo` меняется только подменный `record`, R16).
- [ ] **Step 7: Коммит** `feat: отмена действий с операциями — каскад, таблица audit_undo (миграция 0011)`.

### Task 3: Отмена действий — интерфейс (часть 2)

**Files:**
- Modify: `src/client/lib/queries.ts:262-272`, `src/client/lib/history.ts`, `src/client/lib/audit-format.ts:28-40`, `src/client/components/ConfirmDialog.tsx`, `src/client/components/HistoryDrawer.tsx`, `src/client/pages/settings/AuditSettings.tsx`
- Create: `src/client/lib/operation-undo.ts`, `e2e/history-undo.spec.ts`
- Test: `tests/client/history.test.ts`, `tests/client/operation-undo.test.ts` (новый), `tests/client/audit-format.test.ts`, `tests/client/indicators.test.ts:73` (R16: `undoneBy: null, undoable: false`); `e2e/service-screens.spec.ts:312-316`; `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: API и типы задачи 2 (`UndoPreview`, `UndoResult`, `auditUndoSchema`).
- Produces:
  ```ts
  // queries.ts — AuditEntry: + undoneBy: number | null; undoable: boolean
  // history.ts — HistoryItem: + undone: boolean; undoable: boolean
  // operation-undo.ts
  export function fetchUndoPreview(companyId: number, entryId: number): Promise<UndoPreview>;
  export function runUndo(companyId: number, entryId: number, ids: number[]): Promise<UndoResult>;
  export function undoConfirmText(n: number): string;
  export function undoEntryLine(e: UndoPreviewEntry, timeZone: string): string;
  export function undoDoneText(n: number): string;
  // audit-format.ts
  export function undoDetails(e: AuditEntry): { label: string; value: string }[] | null; // R11
  // ConfirmDialog — details?: readonly string[] (список под текстом, aria-label «Что отменится»)
  ```

- [ ] **Step 1: Тесты.**
  - `tests/client/operation-undo.test.ts`: `undoConfirmText(1)` = «Отменится 1 действие. Операция вернётся в состояние до него.»; `(2)` = «Отменятся 2 действия. Операция вернётся в состояние до них.»; `(5)` = «Отменятся 5 действий. Операция вернётся в состояние до них.»; `undoEntryLine({id: 7, action: 'update', type: 'expense', at: '2026-10-06T12:00:00.000Z', userName: 'Админ'}, 'Asia/Almaty')` = «Изменён расход · 06.10.2026, 17:00:00 · Админ»; `userName null` → «… · Система»; `undoDoneText(1)` = «Отменено 1 действие», `(3)` = «Отменено 3 действия».
  - `tests/client/history.test.ts`: запись `action 'undo'`, `diff {type: 'expense', undone: [{id: 5, action: 'update', type: 'transfer'}, {id: 4, action: 'create', type: 'expense'}], deleted: true}` → `title` «Отмена», `changes` «Отменено: изменён перевод, добавлен расход», `undoable false`; у операции, чья последняя запись — такая «Отмена», `openable false`; при `deleted: false` — `openable true`; у записи с `undoneBy: 9` — `undone true`; `undoable` переносится из записи.
  - `tests/client/audit-format.test.ts`: `ACTION_LABELS.undo === 'Отмена'`; `undoDetails` записи «Отмена» с тем же `diff` → `[{label: 'Отменено', value: 'изменён перевод, добавлен расход'}, {label: 'Записи истории', value: '№5, №4'}]` (R11); у других записей — `null`.
- [ ] **Step 2:** `timeout 600 npx vitest run tests/client/operation-undo.test.ts tests/client/history.test.ts tests/client/audit-format.test.ts` — FAIL.
- [ ] **Step 3: Реализация.**
  - `history.ts`: заголовок записи «Отмена» и строка «Отменено: …» (глаголы и существительные — те же `VERBS` и `NOUNS`, строчными); `openable` — по последнему состоянию операции в ленте: `delete` или «Отмена» с `deleted: true` → нельзя открыть.
  - `ConfirmDialog`: `details` — `<ul aria-label="Что отменится">` между текстом и флажком.
  - `HistoryDrawer` → `HistoryList`: строка — `flex`: прежняя кнопка открытия операции (или блок) и справа — у `undoable` (и компания не в архиве) кнопка «Отмена» (`aria-label` «Отмена: {title}, {meta}», на телефоне `max-md:min-h-11`), у `undone` — пометка «Отменено» (`text-muted`). Нажатие: `fetchUndoPreview` → `ConfirmDialog` (`title` «Отменить действия?», `text` `undoConfirmText(n)`, `details` — `undoEntryLine` каждой, `cancelLabel` «Закрыть», `confirmLabel` «Отменить действия», `danger`, `pending` на время запроса). Успех — `invalidateOperations(company.id)` (как после сохранения формы) и ключ `['audit', company.id]`, итог `undoDoneText` в `role="status"`; ошибка (в т. ч. 409) — `role="alert"` с текстом сервера; фокус после закрытия — на заголовок вкладки (`onFocusLost`), как у импортов.
  - `AuditSettings`: у записи с `undoneBy` — пометка «Отменено» после названия действия; записи «Отмена» подписываются `ACTION_LABELS`, «Подробности» — `importDetails(e) ?? undoDetails(e)` (R11; `undoDetails` — в `audit-format.ts`, тексты действий — общие с `history.ts`).
- [ ] **Step 3a: Прежний e2e** (R2) `e2e/service-screens.spec.ts:312-316`: удалённый расход — у записи «Удалён расход» (`items.nth(0)`) одна кнопка, «Отмена: Удалён расход, …»; у «Добавлен расход» (`items.nth(2)`) кнопок нет (R5); открытие дохода — `items.nth(1).getByRole('button', { name: /^Изменён доход/ })`.
- [ ] **Step 4: e2e** `e2e/history-undo.spec.ts`:
  - `отмена правки из «Истории действий»`: расход 10 000 через API, правка суммы на 15 000 через API → значок «История действий» → у «Изменён расход» «Отмена» → окно «Отменить действия?» с текстом «Отменится 1 действие…» и одной строкой «Изменён расход · … · Админ» → «Отменить действия» → в журнале сумма «10 000»; у записи — «Отменено», кнопки «Отмена» у неё нет; сверху — запись «Отмена» с «Отменено: изменён расход».
  - `отмена удаления возвращает операцию в журнал`: удаление через API → «Отмена» у «Удалён расход» → операция снова в журнале. На ширине 390 px (через «Ещё» → «История действий») высота кнопки «Отмена» не меньше 44 px.
  - `каскад: окно перечисляет все действия, «Закрыть» ничего не меняет`: две правки → «Отмена» у первой → в списке 2 строки, «Отменятся 2 действия…»; «Закрыть» — сумма прежняя; затем «Отменить действия» — сумма исходная.
- [ ] **Step 5: Снимок** `c65-history-undo.png` (пара `m65-history-undo.png` — заглушка): панель «История действий» с открытым окном отмены каскада из двух действий.
- [ ] **Step 6:** `timeout 600 npm test`, `timeout 300 npm run typecheck`, `timeout 1200 npm run test:e2e` (дважды), `timeout 900 npm run shots:ux -- <временная папка>` — PASS (86 снимков).
- [ ] **Step 7: Коммит** `feat: «Отмена» в «Истории действий» — окно подтверждения со списком и пометка «Отменено»`.

### Task 4: Категория в «Аналитике» — состояние и чистые функции (часть 3)

**Files:**
- Modify: `src/client/lib/report-url.ts`, `src/client/lib/charts.ts` (R4)
- Create: `src/client/lib/report-focus.ts`
- Test: `tests/client/report-url.test.ts`, `tests/client/report-focus.test.ts` (новый), `tests/client/charts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // report-url.ts
  ReportUrlState.focusCategoryId: number | null;   // DEFAULT null, адрес `cat`
  changedControls(...) → + category: boolean;
  export function withFocus(state: ReportUrlState): ReportUrlState; // категории фильтра → [focus], withoutCategory → false
  // report-focus.ts
  export function rowCategoryId(rowId: string): number | null;
  export function toggleFocus(state: ReportUrlState, categoryId: number): ReportUrlState;
  export function focusLabel(tree: CategoryTree, categoryId: number): string | null;
  export function focusChart(chart: ReportChartData, focus: number | null): ReportChartData;
  // charts.ts (R4): id ряда, чей сегмент колонки содержит значение (сегменты — как у stackColumn); вне сегментов — null
  export function segmentAt(series: readonly StackSeries[], column: number, value: number): string | null;
  ```
  `reportApiParams`, `projectsApiParams` (а значит и `reportExcelHref`, `projectsExcelHref`) строятся от `withFocus(state)`; `usesIds` учитывает выбор; `dropUnknownIds` снимает неизвестный выбор (`dropped` + «выбранная категория»); `projectsState` и `columnsReportState` выбор сохраняют.

- [ ] **Step 1: Тесты** `tests/client/report-url.test.ts`:
  - `cat в адресе`: `parseReportSearch(new URLSearchParams('cat=12')).focusCategoryId === 12`; `'cat=0'`, `'cat=abc'`, `'cat=-3'` → `null`; `'cat=5&cat=7'` → 5; `reportSearch({...DEFAULT_REPORT_STATE, period: 'month', categoryIds: [3], focusCategoryId: 12}).toString() === 'period=month&category=3&cat=12'`; без выбора `cat` нет.
  - `выбор заменяет категории фильтра, остальные условия действуют`: `reportApiParams({...DEFAULT_REPORT_STATE, categoryIds: [3, 4], withoutCategory: true, accountIds: [9], focusCategoryId: 12}, '2026-10-20')` → `getAll('categories')` = `['12']`, `has('withoutCategory') === false`, `getAll('accounts')` = `['9']`; то же у `projectsApiParams` (с `mode: 'categories'`); без выбора — прежние `['3', '4']` и `withoutCategory=true`.
  - `dropUnknownIds`: выбор 99 при известных `{3, 12}` → `focusCategoryId null`, `dropped` = `['выбранная категория']`; выбор 12 — тот же объект.
  - `changedControls(...).category` при выборе — true; `isReportChanged` — true; `phoneReportCount` не меняется от выбора; `resetReportState` снимает выбор.
- [ ] **Step 2: Тесты** `tests/client/report-focus.test.ts`:
  - `rowCategoryId`: `'income:category:12'` → 12; `'expense:category:7'` → 7; `'project:5:category:7'` → 7; `'income:category:12:own'`, `'income:category:none'`, `'project:none:category:none'`, `'income:counterparty:3'`, `'expense:stock:cogs'`, `'other'`, `'net'`, `'balance:start'` → null.
  - `toggleFocus`: null → 12; 12 + 12 → null; 12 + 7 → 7; прочие поля состояния не меняются.
  - `focusLabel`: дерево с «Зарплата» (10) и подкатегорией «Администраторы» (11) → `(tree, 10)` «Зарплата», `(tree, 11)` «Зарплата → Администраторы», `(tree, 99)` null.
  - `focusChart` (R9): `expenseRows = [row('expense:category:10', children: [row('expense:category:11'), row('expense:category:12')]), row('expense:category:20')]`; `focus 10` → `expenseRows` — два ребёнка, `incomeRows`, `income`, `expense`, `line` — те же; `focus 11` → `[row 11]`; `focus 20` → `[row 20]`; `focus 99` и `null` → тот же объект.
  - `tests/client/charts.test.ts`, `segmentAt` (R4): ряды `a` [300], `b` [200], `c` [-100] в колонке 0 → `segmentAt(…, 0, 150) === 'a'`, `(…, 450) === 'b'`, `(…, -50) === 'c'`, `(…, 600) === null`, `(…, 0)` — `'a'` (нижняя граница сегмента включается, верхняя — нет), колонка без сумм → `null`.
- [ ] **Step 3:** `timeout 600 npx vitest run tests/client/report-url.test.ts tests/client/report-focus.test.ts tests/client/charts.test.ts` — FAIL (R17).
- [ ] **Step 4: Реализация** по решению 9; `rowCategoryId` — `/(?:^|:)category:([1-9]\d{0,14})$/`.
- [ ] **Step 5:** тот же запуск — PASS; `timeout 600 npm test`, `timeout 300 npm run typecheck` — PASS.
- [ ] **Step 6: Коммит** `feat: выбранная категория отчёта в адресе (cat) и чистые функции выбора`.

### Task 5: Категория в «Аналитике» — интерфейс (часть 3)

**Files:**
- Modify: `src/client/lib/report-settings.ts:66-69`, `src/client/pages/analytics/ReportScreen.tsx`, `src/client/pages/analytics/ProjectsPage.tsx`, `src/client/components/analytics/ReportCharts.tsx`, `ReportTable.tsx`, `ProjectsTable.tsx`, `src/client/components/charts/DonutChart.tsx`, `StackedBars.tsx`, `ChartColumns.tsx` (R4: `pick?: (index: number, y: number) => boolean`)
- Create: `src/client/components/analytics/CategoryFocus.tsx`
- Test: `e2e/analytics.spec.ts`, `e2e/analytics-projects.spec.ts`, `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: задача 4.
- Produces:
  ```ts
  update(next: ReportUrlState, opts?: { push?: boolean }): void;     // report-settings
  export function CategoryFocus(props: { label: string; onClear: () => void }): JSX.Element; // «Категория: {label}» и «×» (aria-label «Снять выбор категории»)
  // общие необязательные пропсы выбора у ReportCharts, ReportTable, ProjectsTable, DonutChart, StackedBars:
  focus?: { selected: number | null; canSelect: (rowId: string) => boolean; onSelect: (categoryId: number) => void };
  ```
  `canSelect` — `rowCategoryId(id) !== null` и id есть в `categoryLookup`; у «Денег» и «Прибыли» — только при `state.by === 'category'`, у «Проектов» — при `mode === 'categories'`.

- [ ] **Step 1: e2e** `e2e/analytics.spec.ts`, тест `«Деньги»: нажатие на категорию оставляет только её, повторное и «Назад» снимают`: компания с расходами «Аренда» (2 операции) и «Зарплата» (1) за текущий месяц, `period=month`. Легенда кольца «Списания» → кнопка «Аренда» → адрес содержит `cat=<id аренды>`, плашка «Категория: Аренда», в легенде кольца только «Аренда», под графиками — 2 операции; кнопка «Аренда» с `aria-pressed="true"`. Повторное нажатие → `cat` нет, плашки нет. Снова «Аренда», затем `page.goBack()` → плашки нет; `page.goForward()` → плашка. «×» плашки → выбора нет. Стек «Списания по категориям» (R4, R19): `page.mouse.click` в центр `boundingBox()` прямоугольника `[data-segment="expense:category:<id зарплаты>"]` текущего месяца → плашка «Категория: Зарплата»; снять выбор; щелчок по колонке выше сегментов → колонка выбрана (`aria-pressed="true"`), плашки нет; Enter на кнопке колонки стека (R18) — колонка, плашки нет. Вид «таблица» (у «Зарплата» через API подкатегория «Администраторы» с одной операцией): кнопка-шеврон «Подкатегории «Зарплата»» раскрывает строку (`aria-expanded="true"`), адрес без `cat`; кнопка-название «Зарплата» → в таблице нет строки «Аренда», плашка «Категория: Зарплата»; в виде «график» кольцо «Списания» показывает «Администраторы» (решение 11).
- [ ] **Step 2: e2e** `e2e/analytics-projects.spec.ts`, тест `«Проекты с категориями»: название категории выбирает её`: `projectsSetup`, `?mode=categories` → кнопка «Бар» в строке проекта «Клуб 1» → плашка «Категория: Бар», строк «Аренда» нет; «Доходы» строки «Бар» по-прежнему открывают список операций. Прежний тест про клавиши (строки 212–245) остаётся зелёным.
- [ ] **Step 3: Реализация** по решениям 9–11: `ReportScreen` и `ProjectsPage` — плашка над отчётом при выборе (подпись `focusLabel`), выбор через `update(toggleFocus(state, id), {push: true})`; `ReportCharts` — `focusChart` перед `donutSlices`; `DonutChart` — `onClick` у `<path>` части (мышь) и легенда кнопками `aria-pressed`; `StackedBars` — легенда кнопками, `data-segment={rowId}` у прямоугольника сегмента (R19) и `pick` у `ChartColumns`: только при `e.detail > 0` (R18) значение под курсором (обратное `yOf`) → `segmentAt` → если ряд выбираемый — выбор категории, иначе — колонка (R4); `ReportTable` — название категории кнопкой `aria-pressed`, у раскрываемой — отдельный шеврон; `ProjectsTable` — название строки категории и щелчок по строке переключают выбор (ячейка названия остаётся в сетке стрелок).
- [ ] **Step 4: Снимок** `c66-analytics-category.png` (заглушка `m66-analytics-category.png`): «Деньги» с выбранной «Аренда» — плашка и график.
- [ ] **Step 5:** `timeout 600 npm test`, `timeout 300 npm run typecheck`, `timeout 1200 npm run test:e2e` (дважды), `timeout 900 npm run shots:ux -- <временная папка>` — PASS (87).
- [ ] **Step 6: Коммит** `feat: выбор одной категории в «Деньгах», «Прибыли» и «Проектах»`.

### Task 6: Шаблоны импорта склада — сервер и писатель XLSX (часть 4)

**Files:**
- Modify: `src/server/http/xlsx.ts`, `src/server/modules/stock/import.ts` (экспорт `ITEM_COLUMNS`, `RECEIPT_COLUMNS`), `src/server/modules/stock/routes.ts`
- Create: `src/server/modules/stock/import-template.ts`
- Test: `tests/server/xlsx-writer.test.ts`, `tests/server/stock-import-template.test.ts` (новый)

**Interfaces:**
- Produces:
  ```ts
  // xlsx.ts
  export interface XlsxListValidation { column: number; fromRow: number; toRow: number; source: string /* 'Списки'!$A$2:$A$4 */ }
  XlsxSheet.hidden?: boolean;               // <sheet … state="hidden">
  XlsxSheet.validations?: XlsxListValidation[];
  // import-template.ts
  export const STOCK_TEMPLATE_RULES: Record<StockImportKind, readonly string[]>;
  /** Листы шаблона: данные, «Как заполнять» (один столбец «Правила»), скрытые «Списки» — для проверки содержимого в тестах (читатель импорта видит только первый лист). */
  export function stockTemplateSheets(ex: Executor, companyId: number, kind: StockImportKind, today: string): XlsxSheet[];
  export function stockImportTemplate(ex: Executor, companyId: number, kind: StockImportKind, today: string): { fileName: string; data: Buffer };
  // routes.ts: GET /api/v1/companies/:cid/stock/import/:kind/template.xlsx (kind — items | receipts, иначе 404)
  ```
  `<dataValidations>` пишется сразу после `</sheetData>` (порядок ECMA-376); атрибуты — решение 12; `formula1` — `source`, экранированный `xmlText`.

- [ ] **Step 1: Тесты** `tests/server/xlsx-writer.test.ts`:
  - `скрытый лист`: книга из листов «А» и «Б» (`hidden: true`) → в `xl/workbook.xml` `<sheet name="Б" sheetId="2" state="hidden" r:id="rId2"/>`, у «А» атрибута `state` нет.
  - `выпадающий список`: лист с `validations: [{column: 1, fromRow: 2, toRow: 5001, source: "'Списки'!$A$2:$A$4"}]` → в `sheet1.xml` `<dataValidations count="1"><dataValidation type="list" errorStyle="information" allowBlank="1" showErrorMessage="1" errorTitle="Нет в списке" error="Такого значения нет в списке — при импорте оно будет создано" sqref="B2:B5001">` с текстом `formula1` — `'Списки'!$A$2:$A$4` (апострофы `xmlText` не экранирует, R12); сверка — разбором атрибутов и текста, не строкой XML целиком; блок стоит сразу после `</sheetData>`; без `validations` — элемента нет.
- [ ] **Step 2: Тесты** `tests/server/stock-import-template.test.ts` на `stockWorld()` (+ группа «Напитки» через `POST stock/groups`, комплект «Чипсы + кола», архивный товар «Сироп» через `POST items/:id/archive`, архивный поставщик «Поставщик Б»):
  - `шаблон каталога`: `GET …/stock/import/items/template.xlsx` → 200, `Content-Type` `XLSX_MIME`, `Content-Disposition` с «Шаблон товаров.xlsx»; `sheetRows` → `[['Название', 'Группа', 'Единица', 'Штрихкод', 'Цена продажи'], ['Кола 0,5', 'Напитки', 'шт', '', '350'], ['Чипсы', 'Снеки', 'шт', '', '400']]`; листы книги (`xl/workbook.xml` через AdmZip): «Товары», «Как заполнять», «Списки» с `state="hidden"`; в `xl/worksheets/sheet1.xml` скачанного файла (R13) — два `<dataValidation type="list">`: `sqref` `B2:B5001` с `formula1` `'Списки'!$A$2:$A$2` и `C2:C5001` с `'Списки'!$B$2:$B$5`. `stockTemplateSheets(…, 'items', '2026-10-06')`: у «Списки» колонки «Группа» и «Единица», строки — «Напитки» и «шт», «л», «кг», «уп» (у групп столбец A короче — пустые ячейки `null`); `validations` первого листа — `{column: 1, fromRow: 2, toRow: 5001, source: "'Списки'!$A$2:$A$2"}` и `{column: 2, fromRow: 2, toRow: 5001, source: "'Списки'!$B$2:$B$5"}`.
  - `шаблон поступлений`: «Шаблон поступлений.xlsx»; заголовки `['Дата', 'Поставщик', 'Товар', 'Количество', 'Сумма', 'Цена']`; примеры с датой 05.10.2026 (вчера от «сейчас» 2026-10-06); `stockTemplateSheets(…, 'receipts', …)` — «Списки»: «Товар» — «Кола 0,5», «Чипсы» (без «Сироп» и «Чипсы + кола»), «Поставщик» — «Поставщик А» (без «Поставщик Б» и «ИП Клиент»).
  - `шаблон проходит проверку импорта` (Review Focus 5): файл шаблона → `POST …/stock/import/items?commit=0` и `…/receipts?warehouse=wh&commit=0` → `errorsTotal === 0`, `rows === 2`.
  - `пустые справочники`: новая компания без групп, товаров и поставщиков → оба шаблона 200, проверка импорта — `errorsTotal 0`; у столбцов «Группа», «Товар», «Поставщик» выпадающих списков нет, у «Единица» — есть.
  - `неизвестный вид — 404`, чужая компания — 404.
- [ ] **Step 3:** `timeout 600 npx vitest run tests/server/xlsx-writer.test.ts tests/server/stock-import-template.test.ts` — FAIL.
- [ ] **Step 4: Реализация** по решению 12; правила «Как заполнять» (точный текст):
  - каталог: «Заполняйте первый лист «Товары». Строки 2–3 — примеры: замените или удалите их.»; «Обязательный столбец — «Название». Товар с названием, которое уже есть в каталоге, пропускается.»; «Группа и Единица выбираются из списка в ячейке; новую группу можно вписать — она будет создана.»; «Единица — шт, л, кг или уп; пусто — шт.»; «Цена продажи — число, копейки через точку или запятую: 350 или 350,50.»; «Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.»
  - поступления: «Заполняйте первый лист «Поступления». Строки 2–3 — примеры: замените или удалите их.»; «Обязательные столбцы — «Дата», «Товар», «Количество» и «Сумма» или «Цена».»; «Дата — дд.мм.гггг или дд.мм.гггг чч:мм; без времени — 12:00. Дата в будущем — ошибка.»; «Товар и Поставщик выбираются из списка в ячейке; новое название можно вписать — товар (в штуках) или поставщик будет создан.»; «Количество в шт и уп — целое, в л и кг — до трёх знаков после запятой.»; «Сумма — за всю строку, Цена — за единицу; если заполнены обе, берётся Сумма.»; «Строки с одной датой и одним поставщиком становятся одним поступлением на склад, выбранный в окне импорта.»; «Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.»
  - Книга — `buildXlsx(…, {strings: 'shared'})`; «сегодня» — `todayInTimezone(timezone, now())` сервиса склада.
- [ ] **Step 5:** тот же запуск — PASS; `timeout 600 npm test`, `timeout 300 npm run typecheck` — PASS.
- [ ] **Step 6: Коммит** `feat: шаблоны импорта склада с выпадающими списками; списки и скрытые листы в писателе XLSX`.

### Task 7: Окно импорта склада — «Выбрать файл» и «Скачать шаблон» (часть 4)

**Files:**
- Modify: `src/client/lib/stock-import.ts`, `src/client/components/stock/StockImportDialog.tsx`
- Test: `tests/client/stock-import.test.ts`, `e2e/stock-2.spec.ts:174-179`, `scripts/ux-shots.ts:646`

**Interfaces:**
- Consumes: маршрут шаблона задачи 6.
- Produces:
  ```ts
  export function stockTemplateHref(companyId: number, kind: StockImportKind): string; // /api/v1/companies/{id}/stock/import/{kind}/template.xlsx
  export function chosenFileText(file: { name: string } | null): string;            // имя файла или «Файл не выбран»
  ```

- [ ] **Step 1: Тесты** `tests/client/stock-import.test.ts`: `stockTemplateHref(5, 'items') === '/api/v1/companies/5/stock/import/items/template.xlsx'`, `'receipts'` — аналогично; `chosenFileText(null) === 'Файл не выбран'`, `chosenFileText({name: 'каталог.xlsx'}) === 'каталог.xlsx'`.
- [ ] **Step 2:** `timeout 600 npx vitest run tests/client/stock-import.test.ts` — FAIL.
- [ ] **Step 3: Реализация.** Окно: строка «Файл» — кнопка `btnSecondary` «Выбрать файл» (открывает скрытый `<input type="file" data-stock-import-file accept=".xlsx,.csv" class="hidden" tabIndex={-1} aria-hidden>`, значение сбрасывается после выбора, как в `ImportPanel`), рядом — `chosenFileText` (`aria-live="polite"`, длинное имя обрезается с `title`); ссылка «Скачать шаблон» (`<a href={stockTemplateHref(...)} download>`) под текстом о столбцах. Прежний `<label>…<input>` удаляется.
- [ ] **Step 4: e2e** `e2e/stock-2.spec.ts`: выбор файла — `dialog.locator('[data-stock-import-file]').setInputFiles(...)`, затем видно имя «каталог.csv»; новый тест `«Скачать шаблон» поступлений: файл проходит проверку импорта`: ссылка ведёт на `…/receipts/template.xlsx`; файл по ней через `page.request.get` → в окне «Импорт поступлений» `setInputFiles` с ним → «Проверить» → ошибок нет, «Загрузить» доступна. `scripts/ux-shots.ts:646` — тот же локатор.
- [ ] **Step 5: Снимок** `c67-stock-import-file.png` (заглушка `m67-stock-import-file.png`): окно «Импорт поступлений» с кнопкой «Выбрать файл», именем файла и «Скачать шаблон».
- [ ] **Step 6:** `timeout 600 npm test`, `timeout 300 npm run typecheck`, `timeout 1200 npm run test:e2e` (дважды), `timeout 900 npm run shots:ux -- <временная папка>` — PASS (88).
- [ ] **Step 7: Коммит** `feat: импорт склада — кнопка «Выбрать файл» и «Скачать шаблон»`.

### Task 8: README, спецификация, итоги и полный прогон

**Files:**
- Modify: `README.md` (разделы журнала / «История действий», «Аналитики», «Склада»), `docs/superpowers/specs/2026-10-19-journal-undo-analytics-focus-design.md` (статус «Одобрена владельцем 2026-10-19; реализована» — R3; блок «Решения планирования» — решения 1–12 и R1–R15)
- Create: `docs/superpowers/followups/2026-10-20-journal-undo-analytics-focus.md` (итоги: числа тестов, отклонения, отложенное — Vercel)

- [ ] **Step 1:** README: «Отмена» в «Истории действий» (каскад, что не отменяется, импорт — через «Импорты»); выбор категории нажатием в «Деньгах», «Прибыли», «Проектах» (плашка, `cat` в ссылке, «Назад»); «Выбрать файл» и «Скачать шаблон» в импорте склада; контрагенты системных категорий.
- [ ] **Step 2:** спецификация и итоги, как в задаче 10 плана «Склад-2/3»; в итогах — R15 (пометка «изменена» у операций импорта после отмены правок остаётся).
- [ ] **Step 3: Полный прогон:** `timeout 600 npm test` (не меньше 1604 пройдено, 1 пропущен), `timeout 300 npm run typecheck`, `timeout 1200 npm run test:e2e` (не меньше 228), `timeout 900 npm run shots:ux -- <временная папка>` (88 из 88) — числа в итоги.
- [ ] **Step 4: Коммит** `docs: README, решения и итоги плана «Отмена, категория в Аналитике, шаблоны склада»`.
