# Импорт и экспорт, план И-2: импорт — запись и панель — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** второй план импорта (§14 спецификации): файл, проверенный в И-1, записывается в компанию одной транзакцией, а человек делает всё это из правой панели «Импорт из Excel» — на компьютере и на телефоне.
- **Запись (сервер):** справочники внутри транзакции (`createIn`), вставка операций подготовленными выражениями (`OperationsWriter`), `commit.ts`, `POST …/imports`, история (§6.4, §6.5); проверка заново внутри транзакции, 409 и 410 при изменениях; `npm run bench:import`.
- **Панель (клиент):** кнопка «Импортировать» в тулбаре журнала и «Импорт из Excel» в «Ещё» на телефоне; зона файла, «Скачать шаблон», проверка, итог, ошибки, «Счета из файла» с сопоставлением и остатками, «Будет создано», предупреждения, «Импортировать», «Импорт завершён» (§5).
- **Сверка и приёмка:** `npm run import:check`, `.gitignore` для настоящих файлов, README «Импорт из Finmap» (§12); e2e и `shots:ux` — `c42`, `c42b`, `c42c`, `cm-import`.

Отмена импорта и вкладка «Импорты» — план И-3. Экспорт — план Э.

**Предусловие:** ветка `stage1/plan1-skeleton` на коммите этого плана (после fe8f1d7). Ожидаемо на старте:
- `npm test` — 975 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 142 из 142;
- `shots:ux` — 51 из 51.

**Architecture:**
- **Сервер, модуль `src/server/modules/imports/`:**
  - `commit.ts` — `writeImport(tx, deps, input, record)`: строка `imports`, новые счета, изменения существующих счетов, справочники (родители раньше детей), операции, история. Всё берётся из `ImportPlan` предпросмотра И-1 — заново ничего не выводится;
  - `service.ts` — `commit()`: токен из кэша (иначе 410), затем внутри одной транзакции (`mutate`) — `buildPreview` на текущей базе, проверка `canImport` (иначе 422 `IMPORT_INVALID`) и версии проверки `revision` (иначе 409 `IMPORT_CHANGED`), `writeImport`. После записи токен удаляется;
  - `preview.ts` — версия проверки `revision`: 16 знаков SHA-256 содержимого предпросмотра.
- **Сервер, справочники и операции:** `createIn(ex, …)` у категорий, контрагентов, проектов и тегов — создание внутри чужой транзакции без истории (по образцу `AccountsService.create`); `operations/writer.ts` — `createOperationsWriter(sqlite).insertImported(tx, batch)` на подготовленных выражениях `better-sqlite3`.
- **Клиент:**
  - `lib/import-panel.ts` — чистые функции (тексты, причина недоступности «Импортировать», сопоставление счетов, подсказки остатков) и запросы;
  - `components/import/` — `ImportPanel` (правая панель на `Drawer side="right" wide busy`), `ImportPreviewView`, `ImportAccountCard`;
  - `Drawer` получает `busy` (запись идёт — Esc, «Закрыть» и фон панель не закрывают) и `wide` (480 px на компьютере, на телефоне — на весь экран).
- **Скрипты:** `scripts/bench-import.ts` (замер, §10), `scripts/import-check.ts` и `scripts/lib/import-check.ts` (сверка, §12).

**Tech Stack:** Node 24, TypeScript, Fastify 5, zod 4, Drizzle 0.45 + better-sqlite3 (подготовленные выражения), React 19, TanStack Query 5, Tailwind 4, Vitest, Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-12-import-export-design.md](../specs/2026-10-12-import-export-design.md):
- основное: §5 (панель, предпросмотр, счета из файла, «Импортировать», телефон, доступность), §6.2–§6.5 (маршруты, кэш, запись, история), §10 (производительность и замер), §11.2–§11.4 (тесты и снимки), §12 (приёмка и сверка), §13 (README);
- §14, план И-2; блок «Решения планирования плана И-1» (как построен И-1) и блок «Решения планирования плана И-2» — добавлен тем же коммитом, что и план.

Итоги И-1 — [docs/superpowers/followups/2026-10-12-import-1-followups.md](../followups/2026-10-12-import-1-followups.md), раздел «Для плана И-2» обязателен. Исследование — [docs/research/import-export-finmap.md](../../research/import-export-finmap.md), снимок Finmap `docs/research/screens/v2/42-import-excel.png` (в git не попадает). **Настоящий файл владельца не используется и не упоминается:** все тесты, замеры и снимки — на синтетических файлах (`tests/helpers/finmap-like.ts`).

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§14, блок «Решения планирования плана И-2», №1–№19; правки по harness-review — в №3, №9, №10, №16, №17–№19) тем же коммитом, что и план.

1. **Задачи — 7.** Порядок §14 сохранён, но границы — по файлам:
   1. справочники `createIn` и `OperationsWriter`;
   2. `commit.ts`, `POST …/imports`, версия проверки, `bench:import`;
   3. логика панели (`lib/import-panel.ts`), `Drawer.busy` и `wide`;
   4. экран панели (одна панель на компанию — в раскладке компании) и e2e на компьютере;
   5. телефон, доступность пункта «Ещё», «Импорт» в истории действий;
   6. `import:check`, `.gitignore`, README;
   7. `shots:ux`.
2. **Проверка заново — внутри транзакции записи.** `buildPreview` вызывается внутри `mutate(db, audit, …)`. `better-sqlite3` синхронна: между проверкой и записью база не меняется. `rates.resolve` только читает базу (курсы Нацбанка загружает задание по расписанию), поэтому шаг 2 §6.4 («курсы до транзакции») совпадает с проверкой.
3. **Версия проверки и 409.**
   - `ImportPreview.revision` — 16 шестнадцатеричных знаков SHA-256 содержимого предпросмотра без токена. Любое изменение итога меняет версию: числа, счета и их остатки, «Будет создано», ошибки, предупреждения (в том числе W8), дубликаты.
   - Тело `POST …/imports` — `{ token, accounts, revision }`. Ответы:
     - свежая проверка с ошибками — 422 `IMPORT_INVALID` «Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке»;
     - свежая проверка без ошибок, но с другой версией — 409 `IMPORT_CHANGED` «Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз».

     В обоих — `details.preview`, ничего не записано. Если в свежей проверке ошибок нет, но добавлять нечего (тот же файл уже записал другой пользователь), 422 `IMPORT_INVALID` — с текстом «Нечего импортировать: все операции из файла уже есть в компании».
   - Так запись никогда не идёт по итогу, которого человек не видел: категория, добавленная другим пользователем, операция на счёте из файла, тот же файл, записанный другим пользователем.
4. **`details` у ошибок** — `Record<string, unknown>` у `AppError` (сервер) и `ApiError` (клиент): в нём лежит предпросмотр. Строковые поля (`currency`, `date`, `fileCode`) читаются с проверкой типа.
5. **Писатель операций** — `createOperationsWriter(sqlite)` получает соединение `better-sqlite3`, на котором Drizzle открыл транзакцию (тип `Db` не содержит `$client`). Устройство `insertImported(tx, { companyId, importId, userId, at, rows })`:
   - выражения готовятся один раз на вызов;
   - вне транзакции — ошибка;
   - у дохода и расхода — одна строка на всю сумму, у перевода — строка только с проектом;
   - возвращает id в порядке строк.
6. **`createIn` справочников** — без истории, порядок — после имеющихся (по первому появлению в файле):
   - категория — родитель только верхнего уровня того же вида и компании, иначе внутренняя ошибка;
   - проект — шаблон `general`, `templateParams` `{}`, занятое имя — 400, как у обычного создания;
   - тег — уникальность держит индекс `tags_name_key_uq`.
7. **История (§6.5).** Записи создания справочников — те же поля, что у обычного создания, плюс `importId`:
   - счёт — `{ name, currency, startingBalance, openedAt, projectId, importId }`;
   - категория — `{ kind, name, parentId, importId }`;
   - контрагент — `{ type, name, comment, importId }`;
   - проект — `{ name, templateKey, templateParams, applied: { categories: 0, accounts: 0 }, importId }`;
   - тег — `{ name, importId }`.

   Изменённый существующий счёт — `account` `update` `{ before, after, importId }` только с изменившимися полями. Импорт — `import` `create` `{ fileName, counts, created: { accounts: N, categories: N, counterparties: N, projects: N, tags: N } }`. Итог в лог pino пишет маршрут: компания, пользователь, id импорта, строки, добавлено, миллисекунды.
8. **Ответ 201** — `{ import: ImportRecord, counts: ImportCounts }`:
   - `ImportRecord` — `{ id, fileName, fileSize, status, createdAt, counts, created }`, где `created` — числа созданного по видам;
   - в `imports.created` — массивы id.
9. **Бюджеты памяти и `bench:import` (решение контролёра по harness-review).**
   - Пик памяти процесса на файле 50 000 строк — около 450 МБ: больше прежних 400 МБ §10. Потоковое чтение и `worker_threads` сейчас не делаем, предел 50 000 строк остаётся.
   - §10 получает два бюджета пика RSS:
     - файл 16 000 строк (как настоящий) — 400 МБ, жёстко;
     - файл 50 000 строк — принятые 500 МБ. Почему: пик кратковременный (на время загрузки и записи), пользователей несколько, настоящие файлы — около 16 000 строк.
   - §15.3: условие «`bench:import` покажет больше бюджета» сработало (450 МБ при 400 МБ) — перенос в `worker_threads` сознательно отложен, бюджет 50 000 строк поднят.
   - Замер — три свежих дочерних процесса с `--expose-gc`, файлы собираются заранее:
     - «запись 16 000 строк» — загрузка, пересчёт и запись (3 с, 1 с, 5 с) и пик RSS за всё это (400 МБ);
     - «запись 50 000 строк» — загрузка и запись: предпросмотр, план и вставка в одной транзакции; пик RSS (500 МБ);
     - «худший случай кэша» — три файла по 50 000 строк: пик на первом файле (500 МБ), куча кэша после сборки мусора, пик с тремя файлами — без бюджета.
   - Код выхода 1 — только если нарушен бюджет.
   - На машине планировщика (16 ядер): загрузка 1,4 с, пересчёт 0,5 с, запись 0,8 с, пик 345 МБ; запись 50 000 строк — 2,6 с, пик 447 МБ; кэш — около 27 МБ кучи на файл, пик с тремя файлами — около 540 МБ.
10. **Панель.**
    - Состояние живёт в `ImportFlow`: оно монтируется заново при каждом открытии (`Drawer`). Подвал с «Импортировать» рисуется порталом в слот `footer` панели.
    - `File` хранится в состоянии для повторной загрузки при 410.
    - Выбор счетов (`Map` по ключу) переживает «Выбрать другой файл», но не закрытие панели.
    - Запросы предпросмотра нумеруются с момента правки: ответ устаревшего не показывается.
    - Свежий предпросмотр в ответе 409 и 422 проверяется по типу (`isImportPreview`): `token`, `revision`, `canImport`, `accounts`, `errors`, `counts`, `create`.
11. **Сопоставления в запросе** — все карточки явно: выбор человека или то, что показал сервер (`requestMappings`). Без выбора (A1) карточка не отправляется. Поэтому счёт, ушедший в архив между проверкой и записью, даёт A5 (422), а не тихую замену на «новый счёт».
12. **410 «Проверка устарела».** При `preview` и при `POST …/imports` панель сама загружает тот же `File`, пересчитывает с выбором человека и показывает над кнопкой: «Проверка устарела — файл проверен заново. Проверьте итог и нажмите «Импортировать» ещё раз».
13. **Карточка счёта.**
    - Поле «Счёт» — `ComboSelect` с пунктом «Создать новый счёт» (id -1) и активными счетами. Подходит несколько (A1) — поле пустое с ошибкой.
    - Подпись суммы нового счёта — «Текущий остаток, ₸» или «Стартовый баланс, ₸»: с символом валюты, чтобы не совпадать с подписью переключателя.
    - У существующего счёта — «Остаток после импорта (необязательно)» и подсказка «Пусто — после импорта остаток ₸ X».
14. **«Импорт завершён» без строки про «Импорты».** Строка «Отменить импорт можно в «Истории действий» → «Импорты»» появится в И-3 вместе с вкладкой: мёртвых ссылок нет. До И-3 README советует повторять импорт в новой компании. «Создано: …» перечисляет только ненулевые виды; ничего не создано — предложения нет.
15. **Причины недоступности «Импортировать»** сверх §5.3:
    - «Выберите файл»;
    - «Проверяем файл…»;
    - «Выберите другой файл» (ошибка файла);
    - «Проверьте сумму в карточке счёта «…»»;
    - «Исправьте ошибку в карточке счёта «…»: {A2–A5}»;
    - «Импорт сейчас невозможен».

    «Импорт» (`ENTITY_LABELS.import`) появляется в истории действий и её фильтре уже в И-2. Вид записи «Импорт · Создание · {файл}» и «Подробности» — в И-3.
16. **`import:check`.**
    - Итоги по категориям — в валюте компании, по ключу листа: подкатегория, без неё — категория (`nameKey`); системная — по `systemKey` с учётом `FINMAP_SYSTEM_ALIASES`. Так строка «Администраторы» без J, попавшая в «Зарплата → Администраторы», не даёт ложного расхождения.
    - Перевод между валютами сверяется только при зачислении в базовую валюту с F; иначе — предупреждение.
    - База открывается `better-sqlite3` с `readonly` и закрывается и после ошибки: код выхода задаётся через `process.exitCode`, без `process.exit`. Выход 0 — «Совпадает», 1 — расхождения или ошибка.
    - `--today ГГГГ-ММ-ДД` — «сегодня» разбора (строки позже — плановые и не считаются, как при импорте); по умолчанию — сегодня в `APP_TIMEZONE`. Дата печатается в отчёте.
    - Одноимённые подкатегории разных родителей сверяются одной строкой, в подписи — все родители: «Расходы: Зарплата → Администраторы + Офис → Администраторы». Длинная подпись не обрезается: числа — строкой ниже.
17. **Запись — `BEGIN IMMEDIATE`.** У `mutate` — необязательный `{ behavior: 'deferred' | 'immediate' }` (по умолчанию `deferred`, как раньше). `commit()` берёт блокировку записи до проверки: внешний писатель (скрипт, второй процесс) не вклинится между проверкой и вставкой и не вызовет `SQLITE_BUSY` → 500 посреди записи. Занятая база ждёт `busy_timeout` (5 с) ещё до проверки.
18. **Одна панель импорта на компанию — в раскладке компании.** `ImportPanelHost` (в `CompanyLayout`, внутри `OperationFormHost`) держит панель и отдаёт `useOpenImport()`: его вызывают «Импортировать» в тулбаре журнала и «Импорт из Excel» в «Ещё» на телефоне; в архивной компании — `null` (ни кнопки, ни пункта, ни панели). Переход по истории браузера внутри компании, смена ширины окна и скрытие нижней панели не размонтируют панель, пока идёт запись (e2e: «Назад» во время записи).
19. **Описание ограничений файла — у кнопки «Выберите файл»** (`aria-describedby` на «Формат — как выгрузка Finmap…»), а не у зоны перетаскивания: `div` без роли с описанием программы чтения не объявляют. Уточнение §5.8.

## Global Constraints

- **Без новых npm-пакетов и сети.** Только то, что уже есть: `better-sqlite3`, Drizzle, React, TanStack Query, Playwright.
- **Запись (§6.4):**
  - одна транзакция на импорт; любое исключение откатывает всё — ни счетов, ни справочников, ни строки `imports`, ни истории;
  - `status = 'actual'`, `version = 1`, `created_by` — пользователь, `created_at = updated_at` — момент записи, `operations.import_id`;
  - у дохода и расхода — одна строка на всю сумму, `baseAmount` строки = `baseAmount` операции (инварианты 1–2); у перевода — строка только с проектом;
  - операции — в порядке `(paidAt, номер строки)`: id растут по времени;
  - инвариант 6: строк в будущем нет (пропущены при разборе), `openedAt` счёта не позже первой операции файла.
- **История (§6.5):** одна запись `import` `create` на импорт; справочники и счета — обычные записи с `importId`; у импортированных операций своих записей нет.
- **Ошибки:**
  - `AppError(status, code, message, fields?, details?)`, ответ `{error:{code,message,fields?,details?}}`;
  - 410 `IMPORT_EXPIRED` «Проверка устарела — загрузите файл заново»;
  - 422 `IMPORT_INVALID` и 409 `IMPORT_CHANGED` — с `details.preview`;
  - архивная компания — 422 `ARCHIVED_REFERENCE`.
- **Клиент:**
  - файл уходит телом `application/octet-stream`, имя — в `X-File-Name` (`api(…, { file })`, как `lib/attachments.ts`);
  - файл больше 30 МБ отклоняется в браузере до загрузки: «Файл больше 30 МБ»;
  - пересчёт предпросмотра — через 300 мс после последней правки карточки;
  - кнопки, которые становятся недоступны в фокусе, — `aria-disabled` и проверка в обработчике, не `disabled`.
- **Деньги и даты:** деньги — целые минимальные единицы; на экране — `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`; даты — `YYYY-MM-DD` и момент по часам `APP_TIMEZONE` (`Asia/Almaty`).
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Реальные данные** в тестах, снимках и репозитории запрещены: только выдуманные названия («Касса-1», «Банк-2», «Сотрудник А»). Настоящий файл — в `data/` или с именем `*.import-local.*`.
- **Невидимые символы** (U+2212, U+00A0, U+202F, U+200B) в коде — только экранированием `\u2212`, `\u00A0`, `\u202F`, `\u200B`. Копируйте код плана из файла плана как есть.
- **Концы строк:** правки «замените → на» делайте инструментом правки файлов; если текст разошёлся с планом пробелами, копируйте его из файла.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр; их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой; `npm run bench:import` — во временной папке (код выхода 1 — только нарушенный бюджет);
  - `npm run import:check` в задачах не запускается с настоящими данными: только тест на синтетическом файле;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - задачи 3–7 — ещё `npm run test:e2e`; если задача меняет e2e-файлы — два раза подряд;
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи.

## Review Focus

1. **Данные компании изменились между проверкой и записью.** Другой пользователь добавил категорию из файла, перевёл счёт в архив, импортировал тот же файл. Ожидание: запись не идёт по устаревшему итогу. Ответ — 409 `IMPORT_CHANGED` или 422 `IMPORT_INVALID` со свежим предпросмотром, ничего не записано. Панель показывает свежий итог и сообщение, повторное «Импортировать» проходит. Тесты:
   - задача 2 — «между проверкой и записью…», «повторный импорт того же файла…»;
   - задача 4 — e2e «…данные изменились после проверки — 409…».
2. **Проверка пропала из кэша** (вытеснена четвёртой загрузкой, сервер перезапущен) **или токен уже использован.** Ожидание:
   - на 410 панель сама загружает тот же файл с тем же выбором счетов и показывает «Проверка устарела — файл проверен заново…»;
   - повторный `POST` с использованным токеном — 410: двойной записи нет.

   Тесты: задача 2 — «…повтор токена — 410»; задача 4 — e2e «…410 «Проверка устарела»…».
3. **Сбой посреди записи** (исключение после половины операций). Ожидание: ни операций, ни счетов, ни справочников, ни `imports`, ни истории. Тест: задача 2 «атомарность записи».
4. **Остатки после импорта — ровно как ввёл человек.** Это «Текущий остаток» нового счёта и «Остаток после импорта» существующего; дата открытия существующего счёта переносится на первую операцию файла. Ожидание: левая панель и сверка показывают ровно эти суммы, каждая операция проходит `check()`. Тесты:
   - задача 2 — первый тест «счётчики, справочники…, остатки по обоим режимам…»;
   - задача 4 — e2e «файл → проверка…» (левая панель);
   - задача 6 — `import:check` «Совпадает».
5. **Повторное нажатие и закрытие во время записи.** Ожидание:
   - Esc и «Закрыть» во время записи панель не закрывают; «Назад» в браузере уводит со страницы журнала, но панель остаётся и показывает итог;
   - тот же файл второй раз — все строки дубликаты, «Нечего импортировать: все строки — дубликаты», W8.

   Тесты: задача 4 — e2e «Esc во время записи…» и конец «файл → проверка…»; задача 2 — «повторный импорт того же файла…».

---

## Карта файлов

```
src/server/modules/categories/service.ts      # createIn
src/server/modules/counterparties/service.ts  # createIn (add — через общую вставку)
src/server/modules/projects/service.ts        # createIn (шаблон general)
src/server/modules/tags/service.ts            # createIn (add — через createIn)
src/server/modules/operations/writer.ts       # OperationsWriter.insertImported — подготовленные выражения
src/server/modules/imports/commit.ts          # writeImport: imports, счета, справочники, операции, история
src/server/modules/imports/preview.ts         # revision (версия проверки); details.currency с проверкой типа
src/server/modules/imports/service.ts         # commit(): 410, проверка в транзакции, 422/409, запись
src/server/modules/imports/routes.ts          # POST /api/v1/companies/:cid/imports → 201, лог итога
src/server/errors.ts                          # AppError.details: Record<string, unknown>
src/server/app.ts                             # сервисы справочников и писатель — в сервис импорта
src/server/modules/audit/mutate.ts            # необязательный behavior: 'immediate' (BEGIN IMMEDIATE)
src/shared/schemas/imports.ts                 # importCommitSchema, revision, ImportCounts, ImportRecord, ImportCommitResult
src/client/lib/api.ts                         # ApiError.details: Record<string, unknown>
src/client/components/operation/OperationForm.tsx  # details.currency/date — с проверкой типа
src/client/components/Drawer.tsx              # busy, wide
src/client/components/icons.tsx               # UploadIcon, FolderIcon
src/client/lib/import-panel.ts                # тексты, причины, сопоставление счетов, запросы
src/client/components/import/ImportPanel.tsx        # ImportPanelHost и useOpenImport; панель, файл, статусы, подвал, 409/410/422, итог
src/client/components/import/ImportPreviewView.tsx  # итог, ошибки, счета, «Будет создано», предупреждения
src/client/components/import/ImportAccountCard.tsx  # карточка счёта из файла
src/client/components/journal/JournalToolbar.tsx    # ⤒ «Импортировать» после «Ещё»
src/client/pages/JournalPage.tsx              # «Импортировать» открывает панель через useOpenImport
src/client/pages/CompanyLayout.tsx            # ImportPanelHost — одна панель импорта на компанию
src/client/components/MobileTabBar.tsx        # «Импорт из Excel» в «Ещё»
src/client/lib/audit-format.ts                # «Импорт» в истории действий
scripts/bench-import.ts                       # npm run bench:import
scripts/lib/import-check.ts, scripts/import-check.ts  # npm run import:check
scripts/ux-shots.ts                           # c42, c42b, c42c, cm-import
package.json, .gitignore, README.md
tests/helpers/finmap-like.ts                  # finmapLikeMany
tests/server/import-writer.test.ts, import-commit.test.ts, import-check.test.ts, import-zip.test.ts, mutate.test.ts
tests/client/import-panel.test.ts, audit-format.test.ts
e2e/import.spec.ts, e2e/mobile.spec.ts
```

---

### Task 1: Справочники внутри транзакции и вставка операций импорта (§6.4 п. 3.4–3.5)

**Files:**
- Modify: `src/server/modules/categories/service.ts`, `src/server/modules/counterparties/service.ts`, `src/server/modules/projects/service.ts`, `src/server/modules/tags/service.ts`
- Create: `src/server/modules/operations/writer.ts`
- Test: `tests/server/import-writer.test.ts`

**Interfaces:**
- Consumes: `Executor`, `Sqlite` (`src/server/db/client.ts`); `OperationType` (`operations/service.ts`); `tagKey` (`tags/service.ts`); `cleanName` (`shared/text.ts`).
- Produces:
  - `CategoriesService.createIn(ex: Executor, input: { companyId: number; kind: CategoryKind; parentId: number | null; name: string }): CategoryRow` — без истории; родитель — только верхнего уровня того же вида и компании, иначе `Error('Категория {id} не может быть родителем')`;
  - `CounterpartiesService.createIn(ex: Executor, input: { companyId: number; type: CounterpartyType; name: string }): CounterpartyRow`;
  - `ProjectsService.createIn(ex: Executor, input: { companyId: number; name: string }): ProjectRow` — шаблон `general`, `templateParams` `{}`, занятое имя — 400 `VALIDATION`;
  - `TagsService.createIn(ex: Executor, input: { companyId: number; name: string }): TagRow`;
  - `src/server/modules/operations/writer.ts`: `interface ImportedOperation` (`type, paidAt, accrualDate, accountId, amount, toAccountId, toAmount, rate, baseAmount, counterpartyId, comment, categoryId, projectId, tagIds`), `interface ImportBatch { companyId; importId; userId; at; rows }`, `interface OperationsWriter { insertImported(tx: Executor, batch: ImportBatch): number[] }`, `createOperationsWriter(sqlite: Sqlite): OperationsWriter`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-writer.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createOperationsService } from '../../src/server/modules/operations/service';
import { createOperationsWriter, type ImportedOperation } from '../../src/server/modules/operations/writer';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createTagsService } from '../../src/server/modules/tags/service';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z');
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, number>;
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id!;

/** Строка imports для внешнего ключа operations.import_id. */
function importRow(): number {
  return Number(
    w.h.t.sqlite
      .prepare(
        "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (?, ?, 'ф.xlsx', 1, 'x', 'done', '{}', '{}', '[]', ?)",
      )
      .run(w.cid, adminId(), NOW.toISOString()).lastInsertRowid,
  );
}

function services() {
  const db = w.h.t.db;
  const audit = createAuditService(db);
  const categories = createCategoriesService({ db, audit });
  const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty' });
  const companies = createCompaniesService({ db, audit, categories, accounts });
  return {
    audit,
    categories,
    counterparties: createCounterpartiesService({ db, audit }),
    tags: createTagsService({ db, audit }),
    projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
    operations: createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => NOW }),
  };
}

describe('низкоуровневое создание справочников внутри транзакции (§6.4 п. 3.4 спецификации импорта)', () => {
  it('createIn: после имеющихся, без истории; подкатегория — у родителя верхнего уровня; проект — по шаблону «Общий»', async () => {
    w = await opsWorld();
    const s = services();
    const auditBefore = one('SELECT COUNT(*) n FROM audit_log').n;
    const made = w.h.t.db.transaction((tx) => {
      const top = s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: '  Связь  ' });
      const child = s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: top.id, name: 'Интернет' });
      const cp = s.counterparties.createIn(tx, { companyId: w.cid, type: 'employee', name: 'Сотрудник А' });
      const project = s.projects.createIn(tx, { companyId: w.cid, name: 'Клуб 3' });
      const tag = s.tags.createIn(tx, { companyId: w.cid, name: 'Ночь' });
      return { top, child, cp, project, tag };
    });
    expect(made.top).toMatchObject({ kind: 'expense', parentId: null, name: 'Связь', systemKey: null });
    expect(made.child).toMatchObject({ parentId: made.top.id, name: 'Интернет', orderIndex: 0 });
    // после имеющихся на своём уровне: верхний уровень расходов уже есть (системные и «Аренда»)
    expect(made.top.orderIndex).toBe(one("SELECT MAX(order_index) m FROM categories WHERE company_id = ? AND kind = 'expense' AND parent_id IS NULL", w.cid).m);
    expect(made.cp).toMatchObject({ type: 'employee', name: 'Сотрудник А', comment: null, orderIndex: 1 });
    expect(made.project).toMatchObject({ name: 'Клуб 3', templateKey: 'general', templateParams: {}, orderIndex: 2 });
    expect(made.tag).toMatchObject({ name: 'Ночь', nameKey: 'ночь', orderIndex: 1 });
    // проект «Общий» не создаёт ни счетов, ни категорий; история — у вызывающего
    expect(one('SELECT COUNT(*) n FROM accounts WHERE project_id = ?', made.project.id).n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM audit_log').n).toBe(auditBefore);
  });

  it('createIn: родитель другого вида или второго уровня — ошибка, транзакция откатывается', async () => {
    w = await opsWorld();
    const s = services();
    const before = one('SELECT COUNT(*) n FROM categories').n;
    expect(() =>
      w.h.t.db.transaction((tx) => {
        s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: 'Новая' });
        s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: w.income, name: 'Чужой вид' });
      }),
    ).toThrow(`Категория ${w.income} не может быть родителем`);
    expect(one('SELECT COUNT(*) n FROM categories').n).toBe(before);
    // проект с занятым названием (без учёта регистра) — 400, как у обычного создания
    expect(() => w.h.t.db.transaction((tx) => s.projects.createIn(tx, { companyId: w.cid, name: 'клуб 1' }))).toThrow('Проверьте заполнение полей');
  });

  it('add() по-прежнему пишет историю создания (переписан на createIn)', async () => {
    w = await opsWorld();
    const s = services();
    const cp = s.counterparties.add(w.cid, { type: 'supplier', name: 'Поставщик', comment: 'к' }, adminId());
    const tag = s.tags.add(w.cid, 'Утро', adminId());
    expect(all("SELECT entity, entity_id AS eid, diff FROM audit_log WHERE action = 'create' AND entity IN ('counterparty', 'tag') ORDER BY audit_log.id DESC LIMIT 2")).toEqual([
      { entity: 'tag', eid: tag.id, diff: JSON.stringify({ name: 'Утро' }) },
      { entity: 'counterparty', eid: cp.id, diff: JSON.stringify({ type: 'supplier', name: 'Поставщик', comment: 'к' }) },
    ]);
  });
});

describe('OperationsWriter.insertImported (§6.4 п. 3.5)', () => {
  const base = { accrualDate: null, toAccountId: null, toAmount: null, rate: '1', counterpartyId: null, comment: null, categoryId: null, projectId: null, tagIds: [] };

  it('доход, расход, перевод с проектом и без: строки, теги, import_id, version 1; каждая проходит check() сервиса операций', async () => {
    w = await opsWorld();
    const s = services();
    const writer = createOperationsWriter(w.h.t.sqlite);
    const importId = importRow();
    const rows: ImportedOperation[] = [
      { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 150_000, baseAmount: 150_000, categoryId: w.income, counterpartyId: w.counterparty, projectId: w.project, tagIds: [w.tag, w.tag], comment: 'выручка', accrualDate: '2026-10-01' },
      { ...base, type: 'expense', paidAt: '2026-10-03T04:00:00.000Z', accountId: w.kzt, amount: 50_000, baseAmount: 50_000, categoryId: w.expense },
      { ...base, type: 'transfer', paidAt: '2026-10-04T04:00:00.000Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100, baseAmount: 47_512, projectId: w.project2 },
      { ...base, type: 'transfer', paidAt: '2026-10-05T04:00:00.000Z', accountId: w.usd, amount: 10, toAccountId: w.kzt, toAmount: 4_751, rate: '475.12', baseAmount: 4_751 },
    ];
    const at = '2026-10-06T12:00:00.000Z';
    const ids = w.h.t.db.transaction((tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at, rows }));
    expect(ids).toHaveLength(4);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const ops = all('SELECT id, type, status, paid_at, version, import_id, created_by, created_at, updated_at, deleted_at FROM operations WHERE import_id = ? ORDER BY id', importId);
    expect(ops.map((o) => [o.type, o.status, o.paid_at, o.version, o.created_by, o.created_at, o.updated_at, o.deleted_at])).toEqual([
      ['income', 'actual', '2026-10-02T04:00:00.000Z', 1, adminId(), at, at, null],
      ['expense', 'actual', '2026-10-03T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-04T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-05T04:00:00.000Z', 1, adminId(), at, at, null],
    ]);
    const income = s.operations.get(w.cid, ids[0]!);
    expect(income).toMatchObject({ accrualDate: '2026-10-01', counterpartyId: w.counterparty, comment: 'выручка', tagIds: [w.tag], baseAmount: 150_000, rate: '1' });
    expect(income.lines).toEqual([{ id: expect.any(Number), position: 0, categoryId: w.income, projectId: w.project, amount: 150_000, baseAmount: 150_000 }]);
    expect(s.operations.get(w.cid, ids[1]!).lines).toMatchObject([{ categoryId: w.expense, projectId: null, amount: 50_000 }]);
    expect(s.operations.get(w.cid, ids[2]!).lines).toMatchObject([{ categoryId: null, projectId: w.project2, amount: 47_512, baseAmount: 47_512 }]);
    expect(s.operations.get(w.cid, ids[3]!).lines).toEqual([]);

    // инварианты: правка без изменений проходит check() и ничего не меняет
    for (const id of ids) expect(s.operations.update(w.cid, id, { version: 1 }, adminId()).version).toBe(1);
    // балансы считаются по записанным операциям, как по обычным
    const balances = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
    expect(balances.get(w.kzt)).toBe(150_000 - 50_000 - 47_512 + 4_751);
    expect(balances.get(w.usd)).toBe(100 - 10);
    // история операций не пишется: одна запись на импорт — у вызывающего (§6.5)
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'operation'").n).toBe(0);
  });

  it('вне транзакции — ошибка, ничего не записано', async () => {
    w = await opsWorld();
    const writer = createOperationsWriter(w.h.t.sqlite);
    const importId = importRow();
    const row: ImportedOperation = { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, baseAmount: 100 };
    expect(() => writer.insertImported(w.h.t.db, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: [row] })).toThrow('только внутри транзакции');
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-writer.test.ts`
Expected: FAIL — модуль `src/server/modules/operations/writer` не найден («Failed to load url»).

- [ ] **Step 3: `createIn` у справочников**

В `src/server/modules/categories/service.ts` замените

```ts
  seedSystem(ex: Executor, companyId: number): void;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number;
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
  add(companyId: number, input: { kind: CategoryKind; name: string; parentId: number | null }, userId: number): CategoryRow;
```

на

```ts
  seedSystem(ex: Executor, companyId: number): void;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number;
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет
   * вызывающий. Порядок — после имеющихся на своём уровне; родитель — верхнего уровня того же вида и компании.
   */
  createIn(ex: Executor, input: { companyId: number; kind: CategoryKind; parentId: number | null; name: string }): CategoryRow;
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
  add(companyId: number, input: { kind: CategoryKind; name: string; parentId: number | null }, userId: number): CategoryRow;
```

В `src/server/modules/categories/service.ts` замените

```ts
    },

    listTree(companyId) {
      const rows = db
```

на

```ts
    },

    createIn(ex, input) {
      if (input.parentId !== null) {
        const p = ex.select().from(categories).where(and(eq(categories.id, input.parentId), eq(categories.companyId, input.companyId))).get();
        if (!p || p.kind !== input.kind || p.parentId !== null) throw new Error(`Категория ${input.parentId} не может быть родителем`);
      }
      return toRow(insert(ex, { companyId: input.companyId, kind: input.kind, parentId: input.parentId, name: cleanName(input.name) }));
    },

    listTree(companyId) {
      const rows = db
```

В `src/server/modules/counterparties/service.ts` замените

```ts
import type { CounterpartyType } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { counterparties } from '../../db/schema';
import { AppError } from '../../errors';
```

на

```ts
import type { CounterpartyType } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { counterparties } from '../../db/schema';
import { AppError } from '../../errors';
```

В `src/server/modules/counterparties/service.ts` замените

```ts
export interface CounterpartiesService {
  list(companyId: number): CounterpartyRow[];
  add(companyId: number, input: CounterpartyInput, userId: number): CounterpartyRow;
  update(companyId: number, id: number, input: Partial<CounterpartyInput>, userId: number): CounterpartyRow;
```

на

```ts
export interface CounterpartiesService {
  list(companyId: number): CounterpartyRow[];
  /** Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий. */
  createIn(ex: Executor, input: { companyId: number; type: CounterpartyType; name: string }): CounterpartyRow;
  add(companyId: number, input: CounterpartyInput, userId: number): CounterpartyRow;
  update(companyId: number, id: number, input: Partial<CounterpartyInput>, userId: number): CounterpartyRow;
```

В `src/server/modules/counterparties/service.ts` замените

```ts
  }

  const svc: CounterpartiesService = {
    list(companyId) {
```

на

```ts
  }

  /** Новый контрагент в конце списка компании. */
  function insert(ex: Executor, v: { companyId: number; type: CounterpartyType; name: string; comment: string | null }): CounterpartyRow {
    const next = ex
      .select({ m: sql<number>`coalesce(max(${counterparties.orderIndex}), -1)` })
      .from(counterparties)
      .where(eq(counterparties.companyId, v.companyId))
      .get();
    return ex
      .insert(counterparties)
      .values({ companyId: v.companyId, type: v.type, name: cleanName(v.name), comment: v.comment, orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
      .returning()
      .get();
  }

  const svc: CounterpartiesService = {
    list(companyId) {
```

В `src/server/modules/counterparties/service.ts` замените

```ts
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
```

на

```ts
    },

    createIn(ex, input) {
      return insert(ex, { ...input, comment: null });
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, (tx, record) => {
        const row = insert(tx, { companyId, type: input.type, name: input.name, comment: input.comment ?? null });
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { type: row.type, name: row.name, comment: row.comment } });
        return row;
```

В `src/server/modules/tags/service.ts` замените

```ts
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { tags } from '../../db/schema';
import { AppError } from '../../errors';
```

на

```ts
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { tags } from '../../db/schema';
import { AppError } from '../../errors';
```

В `src/server/modules/tags/service.ts` замените

```ts
export interface TagsService {
  list(companyId: number): TagRow[];
  add(companyId: number, name: string, userId: number): TagRow;
  rename(companyId: number, id: number, name: string, userId: number): TagRow;
```

на

```ts
export interface TagsService {
  list(companyId: number): TagRow[];
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий.
   * Свободу имени проверяет вызывающий (импорт сопоставляет теги по ключу, включая архивные); повтор ключа отклонит уникальный индекс.
   */
  createIn(ex: Executor, input: { companyId: number; name: string }): TagRow;
  add(companyId: number, name: string, userId: number): TagRow;
  rename(companyId: number, id: number, name: string, userId: number): TagRow;
```

В `src/server/modules/tags/service.ts` замените

```ts
    },

    add(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
```

на

```ts
    },

    createIn(ex, input) {
      const name = cleanName(input.name);
      const next = ex
        .select({ m: sql<number>`coalesce(max(${tags.orderIndex}), -1)` })
        .from(tags)
        .where(eq(tags.companyId, input.companyId))
        .get();
      return ex
        .insert(tags)
        .values({ companyId: input.companyId, name, nameKey: tagKey(name), orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
        .returning()
        .get();
    },

    add(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
```

В `src/server/modules/tags/service.ts` замените

```ts
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
```

на

```ts
      assertNameFree(companyId, name);
      return mutate(db, audit, (tx, record) => {
        const row = svc.createIn(tx, { companyId, name });
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name } });
        return row;
```

В `src/server/modules/projects/service.ts` замените

```ts
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
```

на

```ts
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db, type Executor } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
```

В `src/server/modules/projects/service.ts` замените

```ts
    userId: number,
  ): { project: ProjectRow; applied: { categories: number; accounts: number } };
  update(
    companyId: number,
```

на

```ts
    userId: number,
  ): { project: ProjectRow; applied: { categories: number; accounts: number } };
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §4.7 и §6.4 спецификации импорта): проект по шаблону
   * «Общий» — без параметров, категорий и счетов; без истории — её пишет вызывающий. Порядок — после имеющихся.
   */
  createIn(ex: Executor, input: { companyId: number; name: string }): ProjectRow;
  update(
    companyId: number,
```

В `src/server/modules/projects/service.ts` замените

```ts
  throw new AppError(400, 'VALIDATION', 'Проверьте параметры проекта', fields);
}

export function createProjectsService(d: {
```

на

```ts
  throw new AppError(400, 'VALIDATION', 'Проверьте параметры проекта', fields);
}

/** Шаблон проектов, созданных импортом (§4.7 спецификации импорта): без параметров, категорий и счетов. */
const GENERAL_TEMPLATE = 'general';

export function createProjectsService(d: {
```

В `src/server/modules/projects/service.ts` замените

```ts
        return { project: toRow(row), applied };
      });
    },

```

на

```ts
        return { project: toRow(row), applied };
      });
    },

    createIn(ex, input) {
      const name = cleanName(input.name);
      assertNameFree(input.companyId, name);
      const next = ex
        .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
        .from(projects)
        .where(eq(projects.companyId, input.companyId))
        .get();
      return toRow(
        ex
          .insert(projects)
          .values({
            companyId: input.companyId,
            name,
            templateKey: GENERAL_TEMPLATE,
            templateParams: '{}',
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get(),
      );
    },

```

- [ ] **Step 4: Писатель операций импорта**

Создайте `src/server/modules/operations/writer.ts`:

```ts
import type { Executor, Sqlite } from '../../db/client';
import type { OperationType } from './service';

/**
 * Операция импорта, готовая к записи (§6.4 спецификации импорта): все ссылки — id этой компании, суммы — в минимальных
 * единицах, курс и сумма в базовой валюте уже посчитаны предпросмотром. Инварианты обеспечены построением (§6.4 п. 4).
 */
export interface ImportedOperation {
  type: OperationType;
  /** ISO-момент UTC. */
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  rate: string;
  baseAmount: number;
  counterpartyId: number | null;
  comment: string | null;
  /** Категория единственной строки; у перевода — null. */
  categoryId: number | null;
  /** Проект строки; у перевода без проекта строки нет. */
  projectId: number | null;
  tagIds: number[];
}

export interface ImportBatch {
  companyId: number;
  importId: number;
  userId: number;
  /** Момент записи: created_at = updated_at. */
  at: string;
  /** В порядке записи: id растут по (paidAt, номер строки файла). */
  rows: readonly ImportedOperation[];
}

export interface OperationsWriter {
  /**
   * Вставка операций импорта внутри транзакции вызывающего (§6.4 п. 3.5): подготовленные выражения better-sqlite3,
   * созданные один раз на вызов, — без check() и load() на каждую операцию. status = 'actual', version = 1,
   * import_id. У дохода и расхода — одна строка на всю сумму (baseAmount строки = baseAmount операции, инварианты 1–2);
   * у перевода — строка только с проектом. Возвращает id операций в порядке rows.
   */
  insertImported(tx: Executor, batch: ImportBatch): number[];
}

/** sqlite — то же соединение, что у Drizzle (openDb): подготовленные выражения идут в его открытой транзакции. */
export function createOperationsWriter(sqlite: Sqlite): OperationsWriter {
  return {
    insertImported(_tx, b) {
      // tx — знак, что вызов внутри транзакции; сами вставки идут через соединение, на котором она открыта
      if (!sqlite.inTransaction) throw new Error('insertImported: только внутри транзакции');
      const insertOp = sqlite.prepare(
        `INSERT INTO operations (company_id, type, status, paid_at, accrual_date, account_id, amount, to_account_id, to_amount, rate,
           base_amount, counterparty_id, comment, created_by, created_at, updated_at, version, import_id)
         VALUES (?, ?, 'actual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      const insertLine = sqlite.prepare('INSERT INTO operation_lines (operation_id, position, category_id, project_id, amount, base_amount) VALUES (?, 0, ?, ?, ?, ?)');
      const insertTag = sqlite.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?, ?)');
      const ids: number[] = [];
      for (const r of b.rows) {
        const id = Number(
          insertOp.run(
            b.companyId,
            r.type,
            new Date(r.paidAt).toISOString(),
            r.accrualDate,
            r.accountId,
            r.amount,
            r.toAccountId,
            r.toAmount,
            r.rate,
            r.baseAmount,
            r.counterpartyId,
            r.comment,
            b.userId,
            b.at,
            b.at,
            b.importId,
          ).lastInsertRowid,
        );
        // у перевода строка — только с проектом (§4.5 этапа 1); у дохода и расхода — всегда одна строка на всю сумму
        if (r.type !== 'transfer' || r.projectId !== null) insertLine.run(id, r.type === 'transfer' ? null : r.categoryId, r.projectId, r.amount, r.baseAmount);
        for (const tagId of [...new Set(r.tagIds)].sort((x, y) => x - y)) insertTag.run(id, tagId);
        ids.push(id);
      }
      return ids;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-writer.test.ts tests/server/counterparties.test.ts tests/server/tags.test.ts tests/server/categories.test.ts tests/server/projects.test.ts`
Expected: PASS, 5 файлов.

Run: `npm test`
Expected: 980 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/categories/service.ts src/server/modules/counterparties/service.ts src/server/modules/projects/service.ts src/server/modules/tags/service.ts src/server/modules/operations/writer.ts tests/server/import-writer.test.ts
git commit -m "feat: импорт — справочники внутри транзакции и вставка операций импорта подготовленными выражениями" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Запись одной транзакцией, версия проверки и `bench:import` (§6.2, §6.4, §6.5, §10)

**Files:**
- Modify: `src/server/errors.ts`, `src/server/modules/audit/mutate.ts`, `src/shared/schemas/imports.ts`, `src/server/modules/imports/preview.ts`, `src/server/modules/imports/service.ts`, `src/server/modules/imports/routes.ts`, `src/server/app.ts`, `tests/helpers/finmap-like.ts`, `tests/server/import-zip.test.ts`, `package.json`
- Create: `src/server/modules/imports/commit.ts`, `scripts/bench-import.ts`
- Test: `tests/server/import-commit.test.ts`, `tests/server/mutate.test.ts`

**Interfaces:**
- Consumes:
  - задача 1: `createIn` четырёх справочников, `createOperationsWriter`, `OperationsWriter`, `ImportedOperation`;
  - И-1: `buildPreview(deps, src, requested): { preview; plan }`, `ImportPlan` (`rows: PlannedRow[]`, `accounts`, `accountChanges`, `categories`, `counterparties`, `projects`, `tags`), `Ref = { id } | { key }`, кэш `ImportCache` (`get`, `remove`), `importExpired()`;
  - `AccountsService.create(ex, …)`, `changedFields`, `mutate`.
- Produces:
  - `AppError.details?: Record<string, unknown>`;
  - `mutate(db, audit, fn, opts?: { behavior?: 'deferred' | 'immediate' })` — `'immediate'` открывает транзакцию `BEGIN IMMEDIATE` (решение 17);
  - `src/shared/schemas/imports.ts`: `importCommitSchema` (`token`, `accounts`, `revision` — 16 шестнадцатеричных знаков), `ImportCommitRequest`, `ImportPreview.revision: string`, `ImportCounts`, `ImportCreatedCounts`, `ImportRecord`, `ImportCommitResult`;
  - `preview.ts`: `previewRevision(content: Omit<ImportPreview, 'token' | 'revision'>): string`;
  - `commit.ts`: `ImportWriterDeps`, `ImportWriteInput`, `ImportCreatedIds`, `writeImport(tx, deps, input, record): ImportRecord`;
  - `service.ts`: `ImportsService.commit(companyId, userId, body: ImportCommitRequest): ImportCommitResult` — транзакция `BEGIN IMMEDIATE`; `importInvalid(preview)` (422 `IMPORT_INVALID`; без ошибок и без добавляемых строк — «Нечего импортировать: все операции из файла уже есть в компании»), `importChanged(preview)` (409 `IMPORT_CHANGED`); `createImportsService(d: { db; audit; rates; timezone; now?; cache? } & ImportWriterDeps)`;
  - маршрут `POST /api/v1/companies/:cid/imports` → 201 `ImportCommitResult`;
  - `tests/helpers/finmap-like.ts`: `finmapLikeMany(count: number, opts?: { perDay?: number }): FinmapLikeValue[][]`;
  - `npm run bench:import`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-commit.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createImportsService } from '../../src/server/modules/imports/service';
import { createOperationsService } from '../../src/server/modules/operations/service';
import { createOperationsWriter, type OperationsWriter } from '../../src/server/modules/operations/writer';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createTagsService } from '../../src/server/modules/tags/service';
import type { AccountMapping, ImportCommitResult, ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeMany, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z');
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, any>[];
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id as number;
/** Сколько строк в таблицах, которые меняет импорт: «база не изменилась» — те же числа. */
const tableCounts = () =>
  one(
    `SELECT (SELECT COUNT(*) FROM operations) ops, (SELECT COUNT(*) FROM operation_lines) lines, (SELECT COUNT(*) FROM operation_tags) optags,
            (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM categories) categories, (SELECT COUNT(*) FROM counterparties) cps,
            (SELECT COUNT(*) FROM projects) projects, (SELECT COUNT(*) FROM tags) tags, (SELECT COUNT(*) FROM imports) imports,
            (SELECT COUNT(*) FROM audit_log) audit, (SELECT group_concat(starting_balance || '/' || opened_at) FROM accounts) accountState`,
  );

const importsUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports`;

function upload(rows: FinmapLikeValue[][], cid = w.cid, cookie = w.h.cookie) {
  return w.h.t.app.inject({
    method: 'POST',
    url: `${importsUrl(cid)}/upload`,
    headers: { ...ORIGIN_HEADERS, cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
}
async function uploaded(rows: FinmapLikeValue[][], cid = w.cid): Promise<ImportPreview> {
  const res = await upload(rows, cid);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportPreview;
}
async function previewWith(p: ImportPreview, accounts: AccountMapping[], cid = w.cid): Promise<ImportPreview> {
  const res = await w.h.req('POST', `${importsUrl(cid)}/preview`, { token: p.token, accounts });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportPreview;
}
const commit = (p: ImportPreview, accounts: AccountMapping[] = [], cid = w.cid) => w.h.req('POST', importsUrl(cid), { token: p.token, accounts, revision: p.revision });

/** Доход по существующей категории, зарплата с подкатегорией и периодом, перевод на новый счёт с новым проектом, расход с новыми категорией, контрагентом и тегом. */
const FILE = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({
    paidAt: at('2026-10-03', '22:07:30'),
    periodFrom: '01.09.2026 00:00:00',
    periodTo: '30.09.2026 23:59:59',
    amount: 8500,
    from: 'Касса',
    category: 'Зарплата',
    subcategory: 'Администраторы',
    counterparty: 'Сотрудник А',
  }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2', project: 'Клуб 9' }),
  fr({
    paidAt: at('2026-10-05', '00:30:00'),
    amount: 8200.5,
    from: 'Банк-2',
    category: 'Связь',
    subcategory: 'Интернет',
    counterparty: 'Поставщик Б',
    tags: 'Смена, Ночь',
    comment: 'Интернет за октябрь',
  }),
];

function operationsService() {
  const db = w.h.t.db;
  const audit = createAuditService(db);
  return createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => NOW });
}

describe('POST …/imports: запись одной транзакцией (§6.4, §6.5 спецификации импорта)', () => {
  it('счётчики, справочники с видом, типом и родителем, остатки по обоим режимам, import_id, check(), история; повтор токена — 410', async () => {
    w = await opsWorld();
    const mappings: AccountMapping[] = [
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 2_000_000 },
      { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1_000_000 } },
    ];
    const p = await previewWith(await uploaded(FILE), mappings);
    expect(p.canImport).toBe(true);
    expect(p.revision).toMatch(/^[0-9a-f]{16}$/);

    const res = await commit(p, mappings);
    expect(res.statusCode, res.body).toBe(201);
    const r = res.json() as ImportCommitResult;
    const counts = { rows: 4, income: 1, expense: 2, transfer: 1, added: 4, duplicates: 0, skippedFuture: 0 };
    expect(r).toEqual({
      import: {
        id: expect.any(Number),
        fileName: 'выгрузка.xlsx',
        fileSize: finmapLikeXlsx(FILE).length,
        status: 'done',
        createdAt: NOW.toISOString(),
        counts,
        created: { accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 },
      },
      counts,
    });
    const importId = r.import.id;

    // операции: по времени, все с import_id; зарплата — с датой начисления из периода
    const ops = all('SELECT id, type, paid_at, accrual_date, amount, import_id, version FROM operations WHERE company_id = ? ORDER BY id', w.cid);
    expect(ops.map((o) => [o.type, o.paid_at, o.accrual_date, o.amount, o.import_id, o.version])).toEqual([
      ['income', '2026-09-20T05:00:00.000Z', null, 1_059_600, importId, 1],
      ['expense', '2026-10-03T17:07:30.000Z', '2026-09-01', 850_000, importId, 1],
      ['transfer', '2026-10-04T04:15:00.000Z', null, 5_000_000, importId, 1],
      ['expense', '2026-10-04T19:30:00.000Z', null, 820_050, importId, 1],
    ]);
    // каждая импортированная операция проходит check() сервиса операций (§6.4 п. 4)
    const operations = operationsService();
    for (const o of ops) expect(operations.update(w.cid, o.id, { version: 1 }, adminId()).version).toBe(1);

    // справочники: вид, родитель (системная «Зарплата» и новая «Связь»), тип контрагента по категории
    expect(all('SELECT c.name, c.kind, p.name parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id IN (SELECT value FROM json_each((SELECT created FROM imports WHERE id = ?), \'$.categories\')) ORDER BY c.id', importId)).toEqual([
      { name: 'Связь', kind: 'expense', parent: null },
      { name: 'Администраторы', kind: 'expense', parent: 'Зарплата' },
      { name: 'Интернет', kind: 'expense', parent: 'Связь' },
    ]);
    expect(all('SELECT name, type FROM counterparties WHERE company_id = ? ORDER BY id', w.cid)).toEqual([
      { name: 'ИП Клиент', type: 'client' },
      { name: 'Сотрудник А', type: 'employee' },
      { name: 'Поставщик Б', type: 'supplier' },
    ]);
    expect(one("SELECT template_key, template_params FROM projects WHERE name = 'Клуб 9'")).toEqual({ template_key: 'general', template_params: '{}' });
    expect(all('SELECT t.name FROM operation_tags ot JOIN tags t ON t.id = ot.tag_id ORDER BY t.id').map((t) => t.name)).toEqual(['Смена', 'Ночь']);

    // остатки: «Остаток после импорта» существующего счёта и «Текущий остаток» нового — ровно как указаны
    const balances = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
    const bank = one("SELECT id, starting_balance, opened_at FROM accounts WHERE name = 'Банк-2'");
    expect(balances.get(w.kzt)).toBe(2_000_000);
    expect(balances.get(bank.id)).toBe(1_000_000);
    expect(bank).toMatchObject({ starting_balance: 1_000_000 - (5_000_000 - 820_050), opened_at: '2026-10-04' });
    // дата открытия «Кассы» перенесена на первую операцию файла (инвариант 6)
    expect(one('SELECT opened_at, starting_balance FROM accounts WHERE id = ?', w.kzt)).toEqual({
      opened_at: '2026-09-20',
      starting_balance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000),
    });

    // запись imports: счётчики, id созданного, изменения существующих счетов
    const row = one('SELECT status, counts, created, account_changes, user_id FROM imports WHERE id = ?', importId);
    expect(row.status).toBe('done');
    expect(row.user_id).toBe(adminId());
    expect(JSON.parse(row.counts)).toEqual(counts);
    expect(JSON.parse(row.created)).toEqual({
      accounts: [bank.id],
      categories: expect.any(Array),
      counterparties: expect.any(Array),
      projects: [one("SELECT id FROM projects WHERE name = 'Клуб 9'").id],
      tags: [one("SELECT id FROM tags WHERE name = 'Ночь'").id],
    });
    expect(JSON.parse(row.account_changes)).toEqual([
      { accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000), openedAt: '2026-09-20' } },
    ]);

    // история: одна запись импорта, записи создания справочников и изменения счёта с importId, у операций — ничего
    const audit = all('SELECT entity, action, entity_id eid, diff FROM audit_log WHERE company_id = ? AND audit_log.id > (SELECT MAX(id) FROM audit_log WHERE entity = \'rate\') ORDER BY audit_log.id', w.cid)
      .filter((a) => a.diff?.includes('importId') || a.entity === 'import')
      .map((a) => ({ entity: a.entity as string, action: a.action as string, eid: a.eid as number, diff: JSON.parse(a.diff) }));
    expect(audit.map((a) => `${a.entity} ${a.action}`)).toEqual([
      'account create',
      'account update',
      'category create',
      'category create',
      'category create',
      'counterparty create',
      'counterparty create',
      'project create',
      'tag create',
      'import create',
    ]);
    expect(audit.at(-1)).toEqual({
      entity: 'import',
      action: 'create',
      eid: importId,
      diff: { fileName: 'выгрузка.xlsx', counts, created: { accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 } },
    });
    expect(audit[1]!.diff).toEqual({
      before: { startingBalance: 0, openedAt: '2026-10-01' },
      after: { startingBalance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000), openedAt: '2026-09-20' },
      importId,
    });
    expect(audit.slice(0, -1).every((a) => a.diff.importId === importId)).toBe(true);
    expect(w.h.auditCount('operation')).toBe(0);

    // токен удалён: повторное «Импортировать» — 410
    const again = await commit(p, mappings);
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('IMPORT_EXPIRED');
  });

  it('ошибки строк блокируют запись: 422 IMPORT_INVALID со свежим предпросмотром, база не изменилась', async () => {
    w = await opsWorld();
    const p = await uploaded([...FILE, fr({ paidAt: 'вчера', amount: 1, to: 'Касса' })]);
    expect(p.canImport).toBe(false);
    const before = tableCounts();
    const res = await commit(p);
    expect(res.statusCode).toBe(422);
    const e = res.json().error;
    expect(e).toMatchObject({
      code: 'IMPORT_INVALID',
      message: 'Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке',
    });
    expect(e.details.preview.errors.byCode.map((g: { code: string }) => g.code)).toEqual(['R02']);
    expect(tableCounts()).toEqual(before);
  });

  it('между проверкой и записью: счёт ушёл в архив — 422 (A5); появилась категория — 409 IMPORT_CHANGED, повтор с новой версией использует её', async () => {
    w = await opsWorld();
    const rows = [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, from: 'Валютный', category: 'Обед' })];
    const mapping: AccountMapping[] = [{ key: 'валютный', kind: 'existing', accountId: w.usd }];
    const p = await previewWith(await uploaded(rows), mapping);
    expect(p.canImport).toBe(true);
    expect(p.create.categories.total).toBe(1);

    await w.post(`${w.ops.replace('/operations', '')}/accounts/${w.usd}/archive`, {});
    const before = tableCounts();
    const invalid = await commit(p, mapping);
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.details.preview.accounts[0].errors).toEqual([{ code: 'A5', message: 'Счёт «Валютный» в архиве — выберите другой' }]);
    await w.post(`${w.ops.replace('/operations', '')}/accounts/${w.usd}/unarchive`, {});

    // другой пользователь добавил категорию «Обед»: итог другой — 409 со свежим предпросмотром, ничего не записано
    const lunch = (await w.post(`${w.ops.replace('/operations', '')}/categories`, { kind: 'expense', name: 'Обед' })).category.id as number;
    const changed = await commit(p, mapping);
    expect(changed.statusCode).toBe(409);
    const e = changed.json().error;
    expect(e).toMatchObject({ code: 'IMPORT_CHANGED', message: 'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз' });
    const fresh = e.details.preview as ImportPreview;
    expect(fresh.create.categories.total).toBe(0);
    expect(fresh.revision).not.toBe(p.revision);
    // из архива и новая категория — две записи истории; импорт ничего не записал
    expect(tableCounts()).toEqual({ ...before, categories: before.categories + 1, audit: before.audit + 2 });

    const ok = await commit(fresh, mapping);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as ImportCommitResult).import.created.categories).toBe(0);
    expect(one('SELECT category_id FROM operation_lines').category_id).toBe(lunch);
  });

  it('архивная компания — 422; токен другой компании или пользователя — 410; без версии — 400', async () => {
    w = await opsWorld();
    const p = await uploaded(FILE);
    const other = await w.h.company('Другая');
    expect((await commit(p, [], other)).statusCode).toBe(410);
    await seedUser(w.h.t, 'second', 'second-password-1');
    const cookie2 = await loginAs(w.h.t, 'second', 'second-password-1');
    const asSecond = await w.h.t.app.inject({ method: 'POST', url: importsUrl(), headers: { ...ORIGIN_HEADERS, cookie: cookie2 }, payload: { token: p.token, accounts: [], revision: p.revision } });
    expect(asSecond.statusCode).toBe(410);
    const noRevision = await w.h.req('POST', importsUrl(), { token: p.token, accounts: [] });
    expect(noRevision.statusCode).toBe(400);
    expect(noRevision.json().error.code).toBe('VALIDATION');

    const q = await uploaded(FILE, other);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    const archived = await commit(q, [], other);
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('повторный импорт того же файла: все строки — дубликаты, W8, импортировать нечего (422)', async () => {
    w = await opsWorld();
    expect((await commit(await uploaded(FILE))).statusCode).toBe(201);
    const again = await uploaded(FILE);
    expect(again.counts).toMatchObject({ add: 0, duplicates: 4 });
    expect(again.warnings.map((g) => g.code)).toContain('W8');
    expect(again.canImport).toBe(false);
    const nothing = await commit(again);
    expect(nothing.statusCode).toBe(422);
    // ошибок нет, просто всё уже есть в компании — отдельный текст
    expect(nothing.json().error).toMatchObject({ code: 'IMPORT_INVALID', message: 'Нечего импортировать: все операции из файла уже есть в компании' });
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(4);
  });

  it('валюты: счёт USD без F — курс на дату, с F — F и производный курс; перевод KZT → USD — сумма зачисления по курсу', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 20, baseAmount: 9600, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-02', '12:00:00'), amount: 4751.2, from: 'Касса', to: 'Валютный' }),
    ];
    const res = await commit(await uploaded(rows));
    expect(res.statusCode, res.body).toBe(201);
    expect(all('SELECT type, amount, base_amount, rate, to_amount FROM operations ORDER BY id')).toEqual([
      { type: 'expense', amount: 1000, base_amount: 475_120, rate: '475.12', to_amount: null },
      { type: 'expense', amount: 2000, base_amount: 960_000, rate: '480', to_amount: null },
      { type: 'transfer', amount: 475_120, base_amount: 475_120, rate: '1', to_amount: 1000 },
    ]);
  });
});

describe('атомарность записи (§6.4 п. 5)', () => {
  it('сбой после половины операций — ни операций, ни справочников, ни счетов, ни imports, ни истории', async () => {
    w = await opsWorld();
    const db = w.h.t.db;
    const audit = createAuditService(db);
    const rates = createRatesService({ db, audit });
    const categories = createCategoriesService({ db, audit });
    const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty', now: () => NOW });
    const companies = createCompaniesService({ db, audit, categories, accounts });
    const real = createOperationsWriter(w.h.t.sqlite);
    let written = 0;
    const failing: OperationsWriter = {
      insertImported(tx, batch) {
        written = real.insertImported(tx, { ...batch, rows: batch.rows.slice(0, Math.ceil(batch.rows.length / 2)) }).length;
        throw new Error('сбой записи');
      },
    };
    const imports = createImportsService({
      db,
      audit,
      rates,
      timezone: 'Asia/Almaty',
      now: () => NOW,
      accounts,
      categories,
      counterparties: createCounterpartiesService({ db, audit }),
      projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
      tags: createTagsService({ db, audit }),
      writer: failing,
    });
    const p = imports.upload(w.cid, adminId(), { name: 'выгрузка.xlsx', data: finmapLikeXlsx(FILE) });
    const mappings: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1 } }];
    const q = imports.preview(w.cid, adminId(), { token: p.token, accounts: mappings });
    const before = tableCounts();
    expect(() => imports.commit(w.cid, adminId(), { token: q.token, accounts: mappings, revision: q.revision })).toThrow('сбой записи');
    expect(written).toBe(2);
    expect(tableCounts()).toEqual(before);
  });
});

describe('большой файл (§11.2 «Производительность»)', () => {
  it('16 000 строк: запись укладывается в 20 с, все операции с import_id', { timeout: 120_000 }, async () => {
    w = await opsWorld();
    const rows = finmapLikeMany(16_000);
    const p = await uploaded(rows);
    expect(p.canImport).toBe(true);
    const t0 = performance.now();
    const res = await commit(p);
    const ms = performance.now() - t0;
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    expect((res.json() as ImportCommitResult).counts.added).toBe(16_000);
    expect(one('SELECT COUNT(*) n FROM operations WHERE import_id IS NOT NULL').n).toBe(16_000);
    // бюджет §10 — 5 с на эталонной машине (bench:import); здесь — с запасом для медленного CI
    expect(ms).toBeLessThan(20_000);
  });
});
```

`AppError.details` станет `Record<string, unknown>` (решение 4) — в `tests/server/import-zip.test.ts`:

В `tests/server/import-zip.test.ts` замените

```ts
    expect(err.status).toBe(400);
    expect(err.code).toBe('IMPORT_FILE');
    return { fileCode: err.details!.fileCode!, message: err.message };
  }
  throw new Error('ожидалась ошибка файла');
```

на

```ts
    expect(err.status).toBe(400);
    expect(err.code).toBe('IMPORT_FILE');
    return { fileCode: String(err.details!.fileCode), message: err.message };
  }
  throw new Error('ожидалась ошибка файла');
```

Блокировка записи с начала транзакции (решение 17) — в `tests/server/mutate.test.ts`:

В `tests/server/mutate.test.ts` замените

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { changedFields } from '../../src/server/modules/audit/mutate';
import { createApi, type ApiHarness } from '../helpers/api';

```

на

```ts
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFields, mutate } from '../../src/server/modules/audit/mutate';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createApi, type ApiHarness } from '../helpers/api';

```

В `tests/server/mutate.test.ts` замените

```ts
    expect(changedFields({ a: 1 }, {})).toBeNull();
    expect(changedFields({ a: 1 as number | null }, { a: null })).toEqual({ before: { a: 1 }, after: { a: null } });
  });
});
```

на

```ts
    expect(changedFields({ a: 1 }, {})).toBeNull();
    expect(changedFields({ a: 1 as number | null }, { a: null })).toEqual({ before: { a: 1 }, after: { a: null } });
  });
});

describe('mutate: когда берётся блокировка записи', () => {
  it('immediate — с начала транзакции: другое соединение не начнёт запись; deferred — до первой записи может', async () => {
    h = await createApi();
    const other = new Database(path.join(h.t.dir, 'app.db'), { timeout: 0 });
    try {
      const audit = createAuditService(h.t.db);
      /** Другое соединение пробует начать запись (без ожидания): удалось ли. */
      const otherCanWrite = () => {
        try {
          other.exec('BEGIN IMMEDIATE');
          other.exec('ROLLBACK');
          return true;
        } catch {
          return false;
        }
      };
      expect(mutate(h.t.db, audit, () => otherCanWrite())).toBe(true);
      expect(mutate(h.t.db, audit, () => otherCanWrite(), { behavior: 'immediate' })).toBe(false);
      // после транзакции блокировки нет
      expect(otherCanWrite()).toBe(true);
    } finally {
      other.close();
    }
  });
});
```

Синтетический «большой» файл — общий для теста, замера и снимков. В `tests/helpers/finmap-like.ts`:

В `tests/helpers/finmap-like.ts` замените

```ts
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
```

на

```ts
}

/**
 * Много строк «как у Finmap» для замеров и проверки скорости (§10, §11.2): доходы на «Касса-1» и «Банк-2», расходы с
 * «Касса-1», 15 категорий доходов, «Зарплата» и 22 категории расходов, 86 контрагентов, редкие тег и комментарий.
 * Даты — с 15.03.2023, perDay строк в день (по умолчанию 14: 16 000 строк — до мая 2026), время 08:00–19:59.
 */
export function finmapLikeMany(count: number, opts: { perDay?: number } = {}): FinmapLikeValue[][] {
  const perDay = opts.perDay ?? 14;
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2023, 2, 15) + Math.floor(i / perDay) * 86_400_000).toISOString().slice(0, 10);
    const income = i % 3 !== 0;
    return finmapLikeRow({
      paidAt: excelSerial(day, `${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
      amount: 1000 + (i % 977) + 0.5,
      ...(income ? { to: i % 2 ? 'Касса-1' : 'Банк-2' } : { from: 'Касса-1' }),
      category: income ? `Доход ${i % 15}` : i % 4 ? 'Зарплата' : `Расход ${i % 22}`,
      counterparty: `Контрагент ${i % 86}`,
      tags: i % 50 ? null : 'Смена',
      comment: i % 7 ? null : `Комментарий ${i}`,
    });
  });
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/mutate.test.ts`
Expected: FAIL — `mutate` без `behavior` открывает отложенную транзакцию: другое соединение начинает запись.

Run: `npx vitest run tests/server/import-commit.test.ts`
Expected: FAIL — у предпросмотра нет `revision`, `POST …/imports` отвечает 404; `createImportsService` не принимает `writer`.

- [ ] **Step 3: Ошибки, схемы и версия проверки**

В `src/server/errors.ts` замените

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе (у RATE_UNAVAILABLE — валюта и дата для «Указать курс на {D}»). */
    public readonly details?: Record<string, string>,
  ) {
    super(message);
```

на

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /**
     * Данные для действия в интерфейсе: у RATE_UNAVAILABLE — валюта и дата для «Указать курс на {D}», у IMPORT_FILE —
     * код F*, у IMPORT_INVALID и IMPORT_CHANGED — свежий предпросмотр импорта.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
```

В `src/server/modules/audit/mutate.ts` замените

```ts
import type { AuditEntry, AuditService } from './service';

/** Изменение справочника и запись в историю — одной транзакцией: либо оба, либо ничего. */
export function mutate<T>(db: Db, audit: AuditService, fn: (tx: Executor, record: (entry: AuditEntry) => void) => T): T {
  return db.transaction((tx) => fn(tx, (entry) => audit.record(entry, tx)));
}

```

на

```ts
import type { AuditEntry, AuditService } from './service';

/**
 * Изменение справочника и запись в историю — одной транзакцией: либо оба, либо ничего. `behavior: 'immediate'` —
 * блокировка записи берётся в начале транзакции (BEGIN IMMEDIATE), а не при первой записи: проверка внутри транзакции
 * и запись после неё не разделяются чужой записью (запись импорта, решение 17 плана И-2).
 */
export function mutate<T>(
  db: Db,
  audit: AuditService,
  fn: (tx: Executor, record: (entry: AuditEntry) => void) => T,
  opts: { behavior?: 'deferred' | 'immediate' } = {},
): T {
  return db.transaction((tx) => fn(tx, (entry) => audit.record(entry, tx)), { behavior: opts.behavior ?? 'deferred' });
}

```

В `src/shared/schemas/imports.ts` замените

```ts
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** Группа ошибок или предупреждений: код, текст, число строк и до 20 первых номеров. */
```

на

```ts
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/**
 * Тело POST …/imports (§6.2): то же, что у предпросмотра, и версия проверки, которую видел человек. Свежая проверка
 * внутри транзакции записи с другой версией — 409 IMPORT_CHANGED (решение 4 плана И-2).
 */
export const importCommitSchema = importRequestSchema.extend({
  revision: z.string().regex(/^[0-9a-f]{16}$/, 'Проверка устарела — загрузите файл заново'),
});
export type ImportCommitRequest = z.infer<typeof importCommitSchema>;

/** Группа ошибок или предупреждений: код, текст, число строк и до 20 первых номеров. */
```

В `src/shared/schemas/imports.ts` замените

```ts
  duplicates: { count: number; rows: number[] };
  canImport: boolean;
}

```

на

```ts
  duplicates: { count: number; rows: number[] };
  canImport: boolean;
  /** Версия проверки (16 шестнадцатеричных знаков): меняется с любым изменением итога; её отправляет «Импортировать». */
  revision: string;
}

/** Счётчики импорта (imports.counts, §6.1). */
export interface ImportCounts {
  /** Непустых строк данных в файле. */
  rows: number;
  income: number;
  expense: number;
  transfer: number;
  /** Добавлено операций. */
  added: number;
  duplicates: number;
  skippedFuture: number;
}

/** Сколько создано импортом. */
export interface ImportCreatedCounts {
  accounts: number;
  categories: number;
  counterparties: number;
  projects: number;
  tags: number;
}

/** Запись импорта в ответе (§6.2). */
export interface ImportRecord {
  id: number;
  fileName: string;
  fileSize: number;
  status: 'done' | 'undone';
  createdAt: string;
  counts: ImportCounts;
  created: ImportCreatedCounts;
}

/** Ответ 201 POST …/imports. */
export interface ImportCommitResult {
  import: ImportRecord;
  counts: ImportCounts;
}

```

В `src/server/modules/imports/preview.ts` замените

```ts
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
```

на

```ts
import crypto from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
```

В `src/server/modules/imports/preview.ts` замените

```ts
}

export function buildPreview(deps: PreviewDeps, src: PreviewSource, requested: AccountMapping[]): { preview: ImportPreview; plan: ImportPlan } {
  const { db, timezone } = deps;
```

на

```ts
}

/**
 * Версия проверки: 16 шестнадцатеричных знаков SHA-256 содержимого предпросмотра без токена. Любое изменение итога —
 * числа, счета и их остатки, «Будет создано», ошибки, предупреждения, дубликаты — меняет версию.
 */
export function previewRevision(content: Omit<ImportPreview, 'token' | 'revision'>): string {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

export function buildPreview(deps: PreviewDeps, src: PreviewSource, requested: AccountMapping[]): { preview: ImportPreview; plan: ImportPlan } {
  const { db, timezone } = deps;
```

В `src/server/modules/imports/preview.ts` замените

```ts
        if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
        // курса может не быть и у базовой валюты компании (не KZT): R16 называет валюту, курса которой нет
        rateCache.set(k, { missing: e.details?.currency ?? currency });
      }
    }
```

на

```ts
        if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
        // курса может не быть и у базовой валюты компании (не KZT): R16 называет валюту, курса которой нет
        rateCache.set(k, { missing: typeof e.details?.currency === 'string' ? e.details.currency : currency });
      }
    }
```

В `src/server/modules/imports/preview.ts` замените

```ts
  const byType = (t: ImportType) => src.parsed.rows.filter((r) => r.type === t).length;

  const preview: ImportPreview = {
    token: src.token,
    file: { name: src.file.name, size: src.file.size, rows: src.parsed.total },
    counts: {
```

на

```ts
  const byType = (t: ImportType) => src.parsed.rows.filter((r) => r.type === t).length;

  const content: Omit<ImportPreview, 'token' | 'revision'> = {
    file: { name: src.file.name, size: src.file.size, rows: src.parsed.total },
    counts: {
```

В `src/server/modules/imports/preview.ts` замените

```ts
    canImport: rowErrors.length === 0 && accountErrors === 0 && counted.length > 0,
  };
  return {
    preview,
```

на

```ts
    canImport: rowErrors.length === 0 && accountErrors === 0 && counted.length > 0,
  };
  // версия проверки: запись сравнивает её с проверкой, которую видел человек (решение 4 плана И-2)
  const preview: ImportPreview = { token: src.token, ...content, revision: previewRevision(content) };
  return {
    preview,
```

- [ ] **Step 4: Запись (`commit.ts`)**

Создайте `src/server/modules/imports/commit.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { ImportCounts, ImportCreatedCounts, ImportRecord } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { accounts, imports } from '../../db/schema';
import type { AccountsService } from '../accounts/service';
import { changedFields } from '../audit/mutate';
import type { AuditEntry } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CounterpartiesService } from '../counterparties/service';
import type { ImportedOperation, OperationsWriter } from '../operations/writer';
import type { ProjectsService } from '../projects/service';
import type { TagsService } from '../tags/service';
import type { Ref } from './match';
import type { ImportPlan } from './preview';

/** Сервисы записи импорта: низкоуровневое создание внутри транзакции и вставка операций (§6.4 спецификации импорта). */
export interface ImportWriterDeps {
  accounts: AccountsService;
  categories: CategoriesService;
  counterparties: CounterpartiesService;
  projects: ProjectsService;
  tags: TagsService;
  writer: OperationsWriter;
}

export interface ImportWriteInput {
  companyId: number;
  userId: number;
  /** Момент записи: imports.created_at, created_at и updated_at операций. */
  at: string;
  file: { name: string; size: number; sha256: string };
  counts: ImportCounts;
  plan: ImportPlan;
}

/** Id созданного импортом (imports.created, §6.1): по ним отмена (план И-3) удаляет неиспользуемое. */
export interface ImportCreatedIds {
  accounts: number[];
  categories: number[];
  counterparties: number[];
  projects: number[];
  tags: number[];
}

/**
 * Запись плана импорта внутри транзакции вызывающего (§6.4 п. 3): строка imports, новые счета, изменения существующих
 * счетов, справочники (категории верхнего уровня, подкатегории, контрагенты, проекты, теги — родители раньше детей),
 * операции, история (§6.5). Любое исключение откатывает всё. Ссылка плана на новый элемент без созданного элемента —
 * внутренняя ошибка (план строится вместе со справочниками, этого не бывает).
 */
export function writeImport(tx: Executor, deps: ImportWriterDeps, input: ImportWriteInput, record: (entry: AuditEntry) => void): ImportRecord {
  const { companyId, userId, at, plan, file, counts } = input;
  const { id: importId } = tx
    .insert(imports)
    .values({
      companyId,
      userId,
      fileName: file.name,
      fileSize: file.size,
      fileSha256: file.sha256,
      status: 'done',
      counts: JSON.stringify(counts),
      created: '{}',
      accountChanges: '[]',
      createdAt: at,
    })
    .returning({ id: imports.id })
    .get();
  const created: ImportCreatedIds = { accounts: [], categories: [], counterparties: [], projects: [], tags: [] };
  const audit = (entity: string, entityId: number, action: 'create' | 'update', diff: Record<string, unknown>) =>
    record({ companyId, userId, entity, entityId, action, diff: { ...diff, importId } });

  // новые счета: стартовый баланс и дата открытия — из плана (§5.4)
  const accountIds = new Map<string, number>();
  for (const a of plan.accounts) {
    const row = deps.accounts.create(tx, { companyId, name: a.name, currency: a.currency, startingBalance: a.startingBalance, openedAt: a.openedAt });
    accountIds.set(a.key, row.id);
    created.accounts.push(row.id);
    audit('account', row.id, 'create', { name: row.name, currency: row.currency, startingBalance: row.startingBalance, openedAt: row.openedAt, projectId: row.projectId });
  }
  // существующие счета: перенос даты открытия и новый стартовый баланс; прежние значения — в account_changes
  for (const c of plan.accountChanges) {
    tx.update(accounts).set(c.after).where(eq(accounts.id, c.accountId)).run();
    const changes = changedFields(c.before, c.after);
    if (changes) audit('account', c.accountId, 'update', changes);
  }

  const resolve = (r: Ref, made: Map<string, number>, what: string): number => {
    if ('id' in r) return r.id;
    const id = made.get(r.key);
    if (id === undefined) throw new Error(`Импорт: ${what} «${r.key}» не создан`);
    return id;
  };
  // справочники в порядке плана: категории верхнего уровня, затем подкатегории (родитель уже создан)
  const categoryIds = new Map<string, number>();
  for (const c of plan.categories) {
    const parentId = c.parent ? resolve(c.parent, categoryIds, 'категория') : null;
    const row = deps.categories.createIn(tx, { companyId, kind: c.kind, parentId, name: c.name });
    categoryIds.set(c.key, row.id);
    created.categories.push(row.id);
    audit('category', row.id, 'create', { kind: row.kind, name: row.name, parentId: row.parentId });
  }
  const counterpartyIds = new Map<string, number>();
  for (const c of plan.counterparties) {
    const row = deps.counterparties.createIn(tx, { companyId, type: c.type, name: c.name });
    counterpartyIds.set(c.key, row.id);
    created.counterparties.push(row.id);
    audit('counterparty', row.id, 'create', { type: row.type, name: row.name, comment: row.comment });
  }
  const projectIds = new Map<string, number>();
  for (const p of plan.projects) {
    const row = deps.projects.createIn(tx, { companyId, name: p.name });
    projectIds.set(p.key, row.id);
    created.projects.push(row.id);
    audit('project', row.id, 'create', { name: row.name, templateKey: row.templateKey, templateParams: row.templateParams, applied: { categories: 0, accounts: 0 } });
  }
  const tagIds = new Map<string, number>();
  for (const t of plan.tags) {
    const row = deps.tags.createIn(tx, { companyId, name: t.name });
    tagIds.set(t.key, row.id);
    created.tags.push(row.id);
    audit('tag', row.id, 'create', { name: row.name });
  }

  // операции — по (paidAt, номер строки): id растут по времени (§6.4 п. 3.5)
  const rows: ImportedOperation[] = plan.rows.map((r) => ({
    type: r.type,
    paidAt: r.paidAt,
    accrualDate: r.accrualDate,
    accountId: resolve(r.account, accountIds, 'счёт'),
    amount: r.amount,
    toAccountId: r.toAccount ? resolve(r.toAccount, accountIds, 'счёт') : null,
    toAmount: r.toAmount,
    rate: r.rate,
    baseAmount: r.baseAmount,
    counterpartyId: r.counterparty ? resolve(r.counterparty, counterpartyIds, 'контрагент') : null,
    comment: r.comment,
    categoryId: r.category ? resolve(r.category, categoryIds, 'категория') : null,
    projectId: r.project ? resolve(r.project, projectIds, 'проект') : null,
    tagIds: r.tags.map((t) => resolve(t, tagIds, 'тег')),
  }));
  deps.writer.insertImported(tx, { companyId, importId, userId, at, rows });

  // одна запись истории на импорт; у операций своих записей нет (§6.5)
  const createdCounts: ImportCreatedCounts = {
    accounts: created.accounts.length,
    categories: created.categories.length,
    counterparties: created.counterparties.length,
    projects: created.projects.length,
    tags: created.tags.length,
  };
  record({ companyId, userId, entity: 'import', entityId: importId, action: 'create', diff: { fileName: file.name, counts, created: createdCounts } });
  tx.update(imports)
    .set({ created: JSON.stringify(created), accountChanges: JSON.stringify(plan.accountChanges) })
    .where(eq(imports.id, importId))
    .run();
  return { id: importId, fileName: file.name, fileSize: file.size, status: 'done', createdAt: at, counts, created: createdCounts };
}
```

- [ ] **Step 5: Сервис, маршрут и сборка приложения**

В `src/server/modules/imports/service.ts` замените

```ts
import crypto from 'node:crypto';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { createImportCache, type ImportCache } from './cache';
import { parseSheet } from './parse-row';
import { buildPreview } from './preview';
```

на

```ts
import crypto from 'node:crypto';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportCommitRequest, ImportCommitResult, ImportCounts, ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { createImportCache, type ImportCache } from './cache';
import { writeImport, type ImportWriterDeps } from './commit';
import { parseSheet } from './parse-row';
import { buildPreview } from './preview';
```

В `src/server/modules/imports/service.ts` замените

```ts
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';

/** Импорт: проверка файла без записи (§5.2, §6.2 спецификации импорта). Запись и отмена — планы И-2 и И-3. */
export interface ImportsService {
  /** Разбор файла, кэш и предпросмотр по сопоставлению счетов по умолчанию. */
```

на

```ts
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';

/** Импорт: проверка файла и запись (§5.2, §6.2, §6.4 спецификации импорта). Отмена — план И-3. */
export interface ImportsService {
  /** Разбор файла, кэш и предпросмотр по сопоставлению счетов по умолчанию. */
```

В `src/server/modules/imports/service.ts` замените

```ts
  /** Предпросмотр по кэшу с сопоставлением счетов из запроса; токена нет — 410 IMPORT_EXPIRED. */
  preview(companyId: number, userId: number, body: ImportRequest): ImportPreview;
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
```

на

```ts
  /** Предпросмотр по кэшу с сопоставлением счетов из запроса; токена нет — 410 IMPORT_EXPIRED. */
  preview(companyId: number, userId: number, body: ImportRequest): ImportPreview;
  /**
   * Запись одной транзакцией (§6.4): проверка заново внутри транзакции; ошибки — 422 IMPORT_INVALID, другая версия
   * проверки — 409 IMPORT_CHANGED (в обоих — свежий предпросмотр в details.preview); токена нет — 410. Успех удаляет токен.
   */
  commit(companyId: number, userId: number, body: ImportCommitRequest): ImportCommitResult;
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
```

В `src/server/modules/imports/service.ts` замените

```ts

export const importExpired = () => new AppError(410, 'IMPORT_EXPIRED', 'Проверка устарела — загрузите файл заново');

/** Не больше символов (кодовых точек) в имени файла предпросмотра. */
```

на

```ts

export const importExpired = () => new AppError(410, 'IMPORT_EXPIRED', 'Проверка устарела — загрузите файл заново');
/**
 * Проверка внутри записи не даёт импортировать: ошибки (счёт ушёл в архив, справочник в архиве) или нечего добавлять —
 * все строки уже есть в компании (тот же файл записал другой пользователь). Панель показывает свежий предпросмотр.
 */
export const importInvalid = (preview: ImportPreview) => {
  const errors = preview.errors.total > 0 || preview.accounts.some((a) => a.mapping === null || a.errors.length > 0);
  const message =
    !errors && preview.counts.add === 0
      ? 'Нечего импортировать: все операции из файла уже есть в компании'
      : 'Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке';
  return new AppError(422, 'IMPORT_INVALID', message, undefined, { preview });
};
/** Проверка внутри записи даёт другой итог, чем видел человек: панель показывает свежий и ждёт нового нажатия. */
export const importChanged = (preview: ImportPreview) =>
  new AppError(409, 'IMPORT_CHANGED', 'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз', undefined, { preview });

/** Не больше символов (кодовых точек) в имени файла предпросмотра. */
```

В `src/server/modules/imports/service.ts` замените

```ts
}

export function createImportsService(d: { db: Db; rates: RatesService; timezone: string; now?: () => Date; cache?: ImportCache }): ImportsService {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());
```

на

```ts
}

export function createImportsService(
  d: { db: Db; audit: AuditService; rates: RatesService; timezone: string; now?: () => Date; cache?: ImportCache } & ImportWriterDeps,
): ImportsService {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());
```

В `src/server/modules/imports/service.ts` замените

```ts
    },

    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
```

на

```ts
    },

    commit(companyId, userId, body) {
      requireCompany(db, companyId, { writable: true });
      const entry = cache.get(body.token, companyId, userId);
      if (!entry) throw importExpired();
      const src = { token: body.token, companyId, file: entry.file, parsed: entry.parsed };
      // проверка заново — внутри транзакции записи: better-sqlite3 синхронна, между проверкой и записью база не меняется;
      // курсы — только чтение базы (rates.resolve), поэтому и они здесь (§6.4 п. 1–2). BEGIN IMMEDIATE: блокировка записи
      // берётся до проверки — чужая запись (скрипт, второй процесс) не вклинится между проверкой и записью (решение 17)
      const record = mutate(
        db,
        d.audit,
        (tx, audit) => {
          const { preview, plan } = buildPreview(deps, src, body.accounts);
          if (!preview.canImport) throw importInvalid(preview);
          if (preview.revision !== body.revision) throw importChanged(preview);
          const counts: ImportCounts = {
            rows: preview.file.rows,
            income: preview.counts.income,
            expense: preview.counts.expense,
            transfer: preview.counts.transfer,
            added: plan.rows.length,
            duplicates: preview.counts.duplicates,
            skippedFuture: preview.counts.skippedFuture,
          };
          return writeImport(tx, d, { companyId, userId, at: now().toISOString(), file: entry.file, counts, plan }, audit);
        },
        { behavior: 'immediate' },
      );
      // записанный файл повторно не записывается: второй запрос с тем же токеном — 410
      cache.remove(body.token);
      return { import: record, counts: record.counts };
    },

    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
```

В `src/server/modules/imports/routes.ts` замените

```ts
import type { FastifyInstance } from 'fastify';
import { importRequestSchema } from '../../../shared/schemas/imports';
import { AppError } from '../../errors';
import { contentDisposition } from '../../http/content-disposition';
```

на

```ts
import type { FastifyInstance } from 'fastify';
import { importCommitSchema, importRequestSchema } from '../../../shared/schemas/imports';
import { AppError } from '../../errors';
import { contentDisposition } from '../../http/content-disposition';
```

В `src/server/modules/imports/routes.ts` замените

```ts
  app.post<C>(`${BASE}/preview`, async (req) => imports.preview(parseId(req.params.cid), req.user!.id, importRequestSchema.parse(req.body)));

  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
    const { fileName, data } = imports.template();
```

на

```ts
  app.post<C>(`${BASE}/preview`, async (req) => imports.preview(parseId(req.params.cid), req.user!.id, importRequestSchema.parse(req.body)));

  app.post<C>(BASE, async (req, reply) => {
    const companyId = parseId(req.params.cid);
    const started = performance.now();
    const result = imports.commit(companyId, req.user!.id, importCommitSchema.parse(req.body));
    // итог — без содержимого файла (§6.5)
    req.log.info(
      { companyId, userId: req.user!.id, importId: result.import.id, rows: result.counts.rows, added: result.counts.added, ms: Math.round(performance.now() - started) },
      'Импорт записан',
    );
    return reply.status(201).send(result);
  });

  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
    const { fileName, data } = imports.template();
```

В `src/server/app.ts` замените

```ts
import { registerRatesRoutes } from './modules/rates/routes';
import { createOperationsService } from './modules/operations/service';
import { createRatesService } from './modules/rates/service';
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
```

на

```ts
import { registerRatesRoutes } from './modules/rates/routes';
import { createOperationsService } from './modules/operations/service';
import { createOperationsWriter } from './modules/operations/writer';
import { createRatesService } from './modules/rates/service';
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
```

В `src/server/app.ts` замените

```ts
  registerCategoriesRoutes(app, { categories, companies });
  registerAccountsRoutes(app, { accounts, companies, references });
  registerCounterpartiesRoutes(app, { counterparties: createCounterpartiesService({ db, audit, references, now }) });
  registerTagsRoutes(app, { tags: createTagsService({ db, audit, references, now }) });
  registerSplitPresetsRoutes(app, { splitPresets: createSplitPresetsService({ db, audit, now }) });
  const rates = createRatesService({ db, audit, now });
```

на

```ts
  registerCategoriesRoutes(app, { categories, companies });
  registerAccountsRoutes(app, { accounts, companies, references });
  const counterparties = createCounterpartiesService({ db, audit, references, now });
  registerCounterpartiesRoutes(app, { counterparties });
  const tags = createTagsService({ db, audit, references, now });
  registerTagsRoutes(app, { tags });
  registerSplitPresetsRoutes(app, { splitPresets: createSplitPresetsService({ db, audit, now }) });
  const rates = createRatesService({ db, audit, now });
```

В `src/server/app.ts` замените

```ts
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
  registerImportsRoutes(app, { imports: createImportsService({ db, rates, timezone: config.timezone, now }) });
  const backup =
    deps.backup ??
```

на

```ts
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
  registerImportsRoutes(app, {
    imports: createImportsService({
      db,
      audit,
      rates,
      timezone: config.timezone,
      now,
      accounts,
      categories,
      counterparties,
      projects,
      tags,
      writer: createOperationsWriter(deps.sqlite),
    }),
  });
  const backup =
    deps.backup ??
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-commit.test.ts tests/server/mutate.test.ts tests/server/imports-api.test.ts tests/server/import-preview.test.ts tests/server/import-zip.test.ts`
Expected: PASS.

- [ ] **Step 7: Замер `bench:import`**

Создайте `scripts/bench-import.ts`:

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import type { ImportCommitResult, ImportPreview } from '../src/shared/schemas/imports';
import { finmapLikeMany, finmapLikeXlsx } from '../tests/helpers/finmap-like';

// Замер импорта (§10 спецификации импорта), три свежих процесса:
// 1) «write» — синтетический файл «как у Finmap» на 16 000 строк: загрузка с проверкой, пересчёт предпросмотра и запись
//    одной транзакцией (бюджеты 3 с, 1 с, 5 с) и пик памяти процесса за всё это (бюджет 400 МБ);
// 2) «commit50k» — 50 000 строк (предел §2.3): загрузка и запись — предпросмотр, план и вставка в одной транзакции;
//    пик памяти процесса (принятый бюджет 500 МБ, решение 9 плана И-2);
// 3) «cache» — худший случай кэша проверки, три файла по 50 000 строк в трёх компаниях: пик на первом файле
//    (бюджет 500 МБ), память кэша (куча после сборки мусора, оценка §10 — около 25 МБ на файл) и пик с тремя файлами.
// Код выхода 1 — только если нарушен бюджет. Запросы идут через app.inject. npm run bench:import. Файлы собираются
// заранее, замеры идут в дочерних процессах — сборка файлов и прошлый замер не попадают в пик памяти следующего.
// Всё — во временной папке, которая удаляется в конце; папка данных приложения не трогается. Настоящие файлы владельца
// не используются. В CI не входит.

const NOW = new Date('2026-10-06T12:00:00.000Z');
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };
const BUDGET_MS = { upload: 3000, preview: 1000, commit: 5000 };
/** Пик памяти процесса (§10): файл 16 000 строк — 400 МБ; 50 000 строк — принятые 500 МБ. */
const RSS_BUDGET_16K_MB = 400;
const RSS_BUDGET_50K_MB = 500;
const FILE_16K = '16k.xlsx';
const FILE_50K = '50k.xlsx';
const PHASES = ['write', 'commit50k', 'cache'] as const;

type Phase = (typeof PHASES)[number];

const mb = (bytes: number) => bytes / 1024 / 1024;
/** Пик памяти процесса с его начала, МБ (resourceUsage().maxRSS — в килобайтах). */
const peakMb = () => process.resourceUsage().maxRSS / 1024;

if (process.argv[2] !== '--measure') {
  // родительский процесс: файлы на диск, каждый замер — в своём дочернем процессе с --expose-gc
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-import-'));
  let failed = false;
  try {
    fs.writeFileSync(path.join(dir, FILE_16K), finmapLikeXlsx(finmapLikeMany(16_000)));
    fs.writeFileSync(path.join(dir, FILE_50K), finmapLikeXlsx(finmapLikeMany(50_000, { perDay: 40 })));
    console.log(`Замер импорта (§10 спецификации импорта), Node ${process.version}, ${os.cpus().length} ядер`);
    for (const phase of PHASES) {
      const child = spawnSync(process.execPath, [...process.execArgv, '--expose-gc', fileURLToPath(import.meta.url), '--measure', dir, phase], { stdio: 'inherit' });
      if (child.status !== 0) failed = true;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? '\nИтог: бюджет нарушен' : '\nИтог: все бюджеты соблюдены');
  process.exitCode = failed ? 1 : 0;
} else {
  const phase = PHASES.find((p) => p === process.argv[4]);
  if (!phase) throw new Error(`Неизвестный замер: ${process.argv[4]}`);
  await measure(process.argv[3]!, phase);
}

async function measure(dir: string, phase: Phase): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  /** Куча после сборки мусора, МБ: столько держат живые объекты (кэш проверки). */
  const heapMb = () => {
    gc?.();
    return mb(process.memoryUsage().heapUsed);
  };
  const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: path.join(dir, `data-${phase}`), RATES_SOURCE: 'fixtures' });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  seedCurrencies(db);
  await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
  const app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
  await app.ready();

  const lines: string[] = [];
  let over = false;
  const report = (name: string, ms: number, budget?: number) => {
    const verdict = budget === undefined ? 'без бюджета' : ms <= budget ? `OK (бюджет ${budget} мс)` : `ПРЕВЫШЕН (бюджет ${budget} мс)`;
    if (budget !== undefined && ms > budget) over = true;
    lines.push(`${name.padEnd(48)} ${ms.toFixed(0).padStart(7)} мс   ${verdict}`);
  };
  const reportPeak = (name: string, budget: number) => {
    const peak = peakMb();
    if (peak > budget) over = true;
    lines.push(`${name}: ${peak.toFixed(0)} МБ — ${peak <= budget ? 'OK' : 'ПРЕВЫШЕН'} (бюджет ${budget} МБ)`);
  };

  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
    const sid = login.cookies.find((c) => c.name === 'sid');
    if (login.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${login.statusCode} ${login.body}`);
    const headers = { ...HEADERS, cookie: `sid=${sid.value}` };
    const company = async (name: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/companies', headers, payload: { name } });
      if (res.statusCode !== 201) throw new Error(`Компания: ${res.statusCode} ${res.body}`);
      return (res.json() as { company: { id: number } }).company.id;
    };
    const upload = async (cid: number, file: Buffer) => {
      const t = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${cid}/imports/upload`,
        headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('замер.xlsx') },
        payload: file,
      });
      const ms = performance.now() - t;
      if (res.statusCode !== 200) throw new Error(`Загрузка: ${res.statusCode} ${res.body.slice(0, 300)}`);
      return { ms, preview: res.json() as ImportPreview };
    };
    const commit = async (cid: number, p: ImportPreview, rows: number) => {
      const t = performance.now();
      const res = await app.inject({ method: 'POST', url: `/api/v1/companies/${cid}/imports`, headers, payload: { token: p.token, accounts: [], revision: p.revision } });
      const ms = performance.now() - t;
      if (res.statusCode !== 201) throw new Error(`Запись: ${res.statusCode} ${res.body.slice(0, 300)}`);
      if ((res.json() as ImportCommitResult).counts.added !== rows) throw new Error(`Записаны не все ${rows} операций`);
      return ms;
    };

    if (phase === 'write') {
      const cid = await company('Замер импорта');
      const file = fs.readFileSync(path.join(dir, FILE_16K));
      lines.push(`Файл: 16 000 строк, ${mb(file.length).toFixed(1)} МБ`);
      const up = await upload(cid, file);
      if (!up.preview.canImport || up.preview.counts.add !== 16_000) throw new Error('Проверка файла 16 000 строк не прошла');
      report('Загрузка и проверка (upload)', up.ms, BUDGET_MS.upload);
      const t = performance.now();
      const again = await app.inject({ method: 'POST', url: `/api/v1/companies/${cid}/imports/preview`, headers, payload: { token: up.preview.token, accounts: [] } });
      if (again.statusCode !== 200) throw new Error(`Пересчёт: ${again.statusCode} ${again.body.slice(0, 300)}`);
      report('Пересчёт предпросмотра (preview)', performance.now() - t, BUDGET_MS.preview);
      report('Запись одной транзакцией (POST /imports)', await commit(cid, again.json() as ImportPreview, 16_000), BUDGET_MS.commit);
      reportPeak('Пик памяти процесса: загрузка, пересчёт и запись 16 000 строк', RSS_BUDGET_16K_MB);
    } else if (phase === 'commit50k') {
      // предел файла: предпросмотр, план и вставка 50 000 строк — внутри одной транзакции записи
      const cid = await company('Замер записи 50 000');
      const big = fs.readFileSync(path.join(dir, FILE_50K));
      lines.push(`Файл: 50 000 строк, ${mb(big.length).toFixed(1)} МБ`);
      const up = await upload(cid, big);
      if (!up.preview.canImport || up.preview.counts.add !== 50_000) throw new Error('Проверка файла 50 000 строк не прошла');
      report('Загрузка и проверка 50 000 строк', up.ms);
      report('Запись 50 000 строк одной транзакцией', await commit(cid, up.preview, 50_000));
      reportPeak('Пик памяти процесса: загрузка и запись 50 000 строк', RSS_BUDGET_50K_MB);
    } else {
      // три файла по 50 000 строк в трёх компаниях — кэш (не больше 3 файлов) держит все три
      const big = fs.readFileSync(path.join(dir, FILE_50K));
      lines.push(`Файл: 50 000 строк, ${mb(big.length).toFixed(1)} МБ`);
      const heapBefore = heapMb();
      for (let i = 1; i <= 3; i++) {
        const res = await upload(await company(`Замер кэша ${i}`), big);
        report(`Загрузка 50 000 строк, файл ${i} из 3`, res.ms);
        if (i === 1) reportPeak('Пик памяти процесса на первом файле 50 000 строк', RSS_BUDGET_50K_MB);
      }
      lines.push(`Кэш: 3 файла по 50 000 строк занимают ${(heapMb() - heapBefore).toFixed(0)} МБ кучи (оценка §10 — около 25 МБ на файл)`);
      lines.push(`Пик памяти процесса с тремя файлами в кэше: ${peakMb().toFixed(0)} МБ (без бюджета)`);
    }
  } catch (e) {
    over = true;
    lines.push(`Ошибка замера: ${(e as Error).message}`);
  } finally {
    await app.close();
    sqlite.close();
  }

  const titles: Record<Phase, string> = { write: 'Запись 16 000 строк', commit50k: 'Запись 50 000 строк', cache: 'Худший случай кэша' };
  console.log(`\n${titles[phase]}:`);
  for (const l of lines) console.log(l);
  process.exitCode = over ? 1 : 0;
}
```

В `package.json` замените

```json
    "bench:journal": "tsx scripts/bench-journal.ts",
```

на

```json
    "bench:journal": "tsx scripts/bench-journal.ts",
    "bench:import": "tsx scripts/bench-import.ts",
```

Run: `npm run bench:import`
Expected: три таблицы — «Запись 16 000 строк», «Запись 50 000 строк», «Худший случай кэша» — и «Итог: все бюджеты соблюдены», код выхода 0. На машине планировщика:
- 16 000 строк: загрузка 1,4 с, пересчёт 0,5 с, запись 0,8 с, пик 345 МБ (бюджет 400 МБ);
- 50 000 строк: запись 2,6 с, пик 447 МБ (бюджет 500 МБ);
- кэш — около 80 МБ кучи на три файла, пик с тремя файлами — около 540 МБ (без бюджета).

Любое «ПРЕВЫШЕН» — остановитесь и сообщите контролёру с цифрами: бюджеты §10 — решение 9, их не меняют в задаче. Цифры — в отчёт задачи для итогов плана.

- [ ] **Step 8: Full check**

Run: `npm test`
Expected: 989 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 9: Commit**

```bash
git add src/server/errors.ts src/server/modules/audit/mutate.ts tests/server/mutate.test.ts src/shared/schemas/imports.ts src/server/modules/imports/preview.ts src/server/modules/imports/commit.ts src/server/modules/imports/service.ts src/server/modules/imports/routes.ts src/server/app.ts tests/helpers/finmap-like.ts tests/server/import-zip.test.ts tests/server/import-commit.test.ts scripts/bench-import.ts package.json
git commit -m "feat: импорт — запись одной транзакцией (BEGIN IMMEDIATE), версия проверки и 409, история импорта; bench:import" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Логика панели импорта, `Drawer.busy` и широкая панель (§5.1–§5.6)

**Files:**
- Modify: `src/client/lib/api.ts`, `src/client/components/operation/OperationForm.tsx`, `src/client/components/Drawer.tsx`, `src/client/components/icons.tsx`
- Create: `src/client/lib/import-panel.ts`
- Test: `tests/client/import-panel.test.ts`

**Interfaces:**
- Consumes:
  - задача 2: `ImportPreview` (с `revision`), `ImportPreviewAccount`, `ImportIssueGroup`, `AccountMapping`, `ImportCommitResult`;
  - маршруты `POST …/imports/upload`, `…/imports/preview`, `…/imports`; `GET /api/v1/imports/template.xlsx`;
  - `api()`, `invalidateOperations`, `pluralRu`, `formatMoney`, `formatAmount`, `parseAmount`, `COUNTERPARTY_TYPE_SINGULAR`.
- Produces:
  - `ApiError.details?: Record<string, unknown>`;
  - `Drawer` — новые свойства `busy?: boolean` (Esc, «Закрыть» и фон не закрывают; «Закрыть» — `aria-disabled`) и `wide?: boolean` (`w-full md:w-[min(30rem,calc(100vw-3rem))]`);
  - `icons.tsx`: `UploadIcon`, `FolderIcon`;
  - `src/client/lib/import-panel.ts`:
    - постоянные: `IMPORT_MAX_BYTES`, `IMPORT_ACCEPT`, `NEW_ACCOUNT = -1`, `PREVIEW_DEBOUNCE_MS = 300`, `IMPORT_TEMPLATE_HREF`;
    - тексты: `importSizeError(size)`, `formatCount(n)`, `issueRowsText(g)`, `issueText(g)`, `checkSummary(p)`, `blockReason(p, { refreshing, invalidCards })`, `checkStatus(p)`, `createGroups(p): CreateGroup[]`, `signedMoney(minor, currency)`, `newAccountHint(balance, movement, currency)`, `existingAccountHint(target, balance, movement, currency)`, `doneText(result)`;
    - сопоставление счетов: `interface CardDraft`, `draftFromCard(card, baseCurrency)`, `mappingFromDraft(key, draft, accountCurrency): { mapping; error }`, `requestMappings(p, choices)`, `needsRemembered(p, choices)`, `isImportPreview(x)`;
    - запросы: `uploadImport(companyId, file)`, `previewImport(companyId, token, accounts)`, `commitImport(companyId, preview, accounts)`, `invalidateAfterImport(companyId)`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/client/import-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  blockReason,
  checkStatus,
  checkSummary,
  createGroups,
  doneText,
  draftFromCard,
  existingAccountHint,
  importSizeError,
  isImportPreview,
  issueText,
  mappingFromDraft,
  needsRemembered,
  newAccountHint,
  NEW_ACCOUNT,
  requestMappings,
  signedMoney,
} from '../../src/client/lib/import-panel';
import type { AccountMapping, ImportPreview, ImportPreviewAccount } from '../../src/shared/schemas/imports';

const card = (over: Partial<ImportPreviewAccount> = {}): ImportPreviewAccount => ({
  key: 'касса',
  fileName: 'Касса',
  rows: 2,
  mapping: { key: 'касса', kind: 'existing', accountId: 7 },
  currency: 'KZT',
  movement: 1_000_000,
  existing: { balance: 50_000, openedAt: '2026-10-01', newOpenedAt: null },
  archivedHint: false,
  errors: [],
  ...over,
});

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  token: 'a'.repeat(32),
  file: { name: 'выгрузка.xlsx', size: 1000, rows: 16_028 },
  counts: { income: 9_812, expense: 6_104, transfer: 112, add: 16_028, duplicates: 0, skippedFuture: 0 },
  period: { from: '2023-03-15', to: '2026-10-11' },
  accounts: [card()],
  create: {
    categories: { total: 0, items: [] },
    counterparties: { total: 0, items: [] },
    projects: { total: 0, items: [] },
    tags: { total: 0, items: [] },
  },
  errors: { total: 0, byCode: [] },
  warnings: [],
  duplicates: { count: 0, rows: [] },
  canImport: true,
  revision: '0123456789abcdef',
  ...over,
});

describe('панель импорта: тексты (§5.3, §5.6 спецификации импорта)', () => {
  it('итог проверки, номера строк, размер файла', () => {
    expect(checkSummary(preview())).toBe('В файле 16\u202F028 операций: доходов 9\u202F812, расходов 6\u202F104, переводов 112. Период: 15.03.2023 – 11.10.2026');
    expect(checkSummary(preview({ file: { name: 'ф', size: 1, rows: 1 }, counts: { income: 1, expense: 0, transfer: 0, add: 0, duplicates: 1, skippedFuture: 0 }, period: null }))).toBe(
      'В файле 1 операция: доходов 1, расходов 0, переводов 0',
    );
    expect(issueText({ code: 'R01', message: 'Нет даты платежа', count: 7, rows: [15, 230, 231] })).toBe('Нет даты платежа — строки 15, 230, 231 и ещё 4');
    expect(issueText({ code: 'R04', message: 'Нет суммы', count: 1, rows: [9] })).toBe('Нет суммы — строка 9');
    expect(issueText({ code: 'W8', message: 'Этот файл уже импортирован', count: 1, rows: [] })).toBe('Этот файл уже импортирован');
    expect(importSizeError(30 * 1024 * 1024)).toBeNull();
    expect(importSizeError(30 * 1024 * 1024 + 1)).toBe('Файл больше 30 МБ');
  });

  it('причина недоступности «Импортировать» и живая область', () => {
    expect(blockReason(preview(), { refreshing: false, invalidCards: [] })).toBeNull();
    expect(checkStatus(preview())).toBe('Проверка завершена: ошибок нет, можно импортировать');
    expect(blockReason(preview(), { refreshing: true, invalidCards: [] })).toBe('Проверяем изменения…');
    expect(blockReason(preview(), { refreshing: false, invalidCards: ['Банк'] })).toBe('Проверьте сумму в карточке счёта «Банк»');
    const withErrors = preview({ errors: { total: 23, byCode: [] }, canImport: false });
    expect(blockReason(withErrors, { refreshing: false, invalidCards: [] })).toBe('Исправьте ошибки в файле и загрузите его снова');
    expect(checkStatus(withErrors)).toBe('Найдено ошибок: 23');
    const unchosen = preview({ accounts: [card({ mapping: null, currency: null, errors: [{ code: 'A1', message: 'Выберите счёт для «Касса» — подходит несколько' }] })], canImport: false });
    expect(blockReason(unchosen, { refreshing: false, invalidCards: [] })).toBe('Выберите счёт для «Касса»');
    const archived = preview({ accounts: [card({ errors: [{ code: 'A5', message: 'Счёт «Касса» в архиве — выберите другой' }] })], canImport: false });
    expect(blockReason(archived, { refreshing: false, invalidCards: [] })).toBe('Исправьте ошибку в карточке счёта «Касса»: Счёт «Касса» в архиве — выберите другой');
    const dup = preview({ counts: { income: 1, expense: 0, transfer: 0, add: 0, duplicates: 1, skippedFuture: 0 }, canImport: false });
    expect(blockReason(dup, { refreshing: false, invalidCards: [] })).toBe('Нечего импортировать: все строки — дубликаты');
    expect(checkStatus(dup)).toBe('Проверка завершена. Нечего импортировать: все строки — дубликаты');
  });

  it('«Будет создано»: категории по видам с родителем, контрагенты с типом, «и ещё N», пустые группы скрыты', () => {
    const groups = createGroups(
      preview({
        create: {
          categories: {
            total: 203,
            items: [
              { name: 'Бар', kind: 'income', rows: 3 },
              { name: 'Администраторы', kind: 'expense', parent: 'Зарплата', rows: 2 },
            ],
          },
          counterparties: { total: 1, items: [{ name: 'Сотрудник А', type: 'employee', rows: 2 }] },
          projects: { total: 0, items: [] },
          tags: { total: 1, items: [{ name: 'Ночь', rows: 1 }] },
        },
      }),
    );
    expect(groups).toEqual([
      {
        key: 'categories',
        title: 'Категории',
        total: 203,
        sections: [
          { title: 'Доходы', items: [{ name: 'Бар' }] },
          { title: 'Расходы', items: [{ name: 'Зарплата → Администраторы' }] },
        ],
        more: 201,
      },
      { key: 'counterparties', title: 'Контрагенты', total: 1, sections: [{ title: null, items: [{ name: 'Сотрудник А', note: 'Сотрудник' }] }], more: 0 },
      { key: 'tags', title: 'Теги', total: 1, sections: [{ title: null, items: [{ name: 'Ночь' }] }], more: 0 },
    ]);
  });

  it('суммы карточки: движение со знаком, стартовый баланс и остаток после импорта по обоим режимам', () => {
    expect(signedMoney(1_014_981_300, 'KZT')).toBe('+10\u202F149\u202F813\u00A0₸');
    expect(signedMoney(-250_000, 'KZT')).toBe('\u22122\u202F500\u00A0₸');
    expect(newAccountHint(null, 400_000, 'KZT')).toBe('Остаток после импорта: ₸\u00A04\u202F000');
    expect(newAccountHint({ mode: 'current', amount: 1_000_000 }, 400_000, 'KZT')).toBe('Стартовый баланс: ₸\u00A06\u202F000');
    expect(newAccountHint({ mode: 'start', amount: 1_000_000 }, 400_000, 'KZT')).toBe('Остаток после импорта: ₸\u00A014\u202F000');
    expect(newAccountHint({ mode: 'current', amount: 0 }, 400_000, 'KZT')).toBe('Стартовый баланс: \u2212₸\u00A04\u202F000');
    expect(existingAccountHint(null, 50_000, 1_000_000, 'KZT')).toBe('Пусто — после импорта остаток ₸\u00A010\u202F500');
  });

  it('итог записи: созданное без нулей, склонения', () => {
    const counts = { rows: 16_028, income: 1, expense: 1, transfer: 0, added: 16_028, duplicates: 0, skippedFuture: 0 };
    const result = (created: { accounts: number; categories: number; counterparties: number; projects: number; tags: number }) => ({
      import: { id: 1, fileName: 'ф', fileSize: 1, status: 'done' as const, createdAt: '2026-10-12T10:00:00.000Z', counts, created },
      counts,
    });
    expect(doneText(result({ accounts: 2, categories: 37, counterparties: 86, projects: 0, tags: 1 }))).toBe(
      'Добавлено 16\u202F028 операций. Создано: 2 счёта, 37 категорий, 86 контрагентов, 1 тег. Пропущено дубликатов: 0',
    );
    expect(doneText(result({ accounts: 0, categories: 0, counterparties: 0, projects: 1, tags: 0 }))).toBe('Добавлено 16\u202F028 операций. Создано: 1 проект. Пропущено дубликатов: 0');
    expect(doneText(result({ accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 }))).toBe('Добавлено 16\u202F028 операций. Пропущено дубликатов: 0');
  });
});

describe('панель импорта: сопоставление счетов (§5.4)', () => {
  it('черновик карточки из сопоставления сервера и обратно', () => {
    expect(draftFromCard(card(), 'KZT')).toEqual({ choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' });
    const fresh = card({ key: 'банк', fileName: 'Банк', mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'USD', balance: { mode: 'start', amount: 150_050 } }, currency: 'USD' });
    expect(draftFromCard(fresh, 'KZT')).toEqual({ choice: NEW_ACCOUNT, name: 'Банк', currency: 'USD', mode: 'start', amount: '1\u202F500,50', target: '' });
    expect(draftFromCard(card({ mapping: null, currency: null }), 'KZT')).toMatchObject({ choice: null, currency: 'KZT' });

    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'USD', mode: 'current', amount: ' 1 500,5 ', target: '' }, null)).toEqual({
      mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'USD', balance: { mode: 'current', amount: 150_050 } },
      error: null,
    });
    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'KZT', mode: 'start', amount: '', target: '' }, null).mapping).toMatchObject({ balance: null });
    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'KZT', mode: 'start', amount: '12abc', target: '' }, null)).toEqual({
      mapping: null,
      error: 'Введите сумму, например 1 500,50',
    });
    expect(mappingFromDraft('касса', { choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '\u22121 000' }, 'KZT')).toEqual({
      mapping: { key: 'касса', kind: 'existing', accountId: 7, targetBalance: -100_000 },
      error: null,
    });
    expect(mappingFromDraft('касса', { choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' }, 'KZT').mapping).toEqual({
      key: 'касса',
      kind: 'existing',
      accountId: 7,
      targetBalance: null,
    });
    expect(mappingFromDraft('касса', { choice: null, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' }, null)).toEqual({ mapping: null, error: null });
  });

  it('выбор по ключу переживает «Выбрать другой файл»: в запросе — выбор человека, иначе то, что показал сервер; A1 не отправляется', () => {
    const chosen: AccountMapping = { key: 'касса', kind: 'existing', accountId: 9 };
    const choices = new Map<string, AccountMapping>([
      ['касса', chosen],
      ['чужой', { key: 'чужой', kind: 'existing', accountId: 1 }],
    ]);
    const p = preview({
      accounts: [card(), card({ key: 'банк', fileName: 'Банк', mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: null } }), card({ key: 'сейф', mapping: null })],
    });
    expect(requestMappings(p, choices)).toEqual([chosen, { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: null }]);
    expect(needsRemembered(p, choices)).toBe(true);
    expect(needsRemembered(p, new Map([['касса', { key: 'касса', kind: 'existing', accountId: 7 }]]))).toBe(false);
    expect(needsRemembered(p, new Map())).toBe(false);
  });

  it('свежий предпросмотр в ответе 409/422 распознаётся', () => {
    expect(isImportPreview(preview())).toBe(true);
    expect(isImportPreview({ token: 'x' })).toBe(false);
    expect(isImportPreview(null)).toBe(false);
    // ошибки, счётчики и «Будет создано» — тоже по типу: панель показывает их без проверок
    expect(isImportPreview({ ...preview(), errors: { total: '1', byCode: [] } })).toBe(false);
    expect(isImportPreview({ ...preview(), counts: null })).toBe(false);
    expect(isImportPreview({ ...preview(), create: { ...preview().create, tags: { total: 0 } } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/import-panel.test.ts`
Expected: FAIL — модуль `src/client/lib/import-panel` не найден.

- [ ] **Step 3: `details` у ошибок клиента (решение 4)**

В `src/client/lib/api.ts` замените

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе (у RATE_UNAVAILABLE — `currency` и `date`). */
    public readonly details?: Record<string, string>,
  ) {
    super(message);
```

на

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе: у RATE_UNAVAILABLE — `currency` и `date`, у IMPORT_INVALID и IMPORT_CHANGED — `preview`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
```

В `src/client/lib/api.ts` замените

```ts
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, string> };
  } | null;
  if (!res.ok) {
```

на

```ts
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> };
  } | null;
  if (!res.ok) {
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_UNAVAILABLE' && e.details?.currency && e.details.date) {
        setMissingRate({ message: e.message, currency: e.details.currency, date: e.details.date });
        setErrorFocus((x) => x + 1);
        return;
```

на

```tsx
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      const currency = e instanceof ApiError ? e.details?.currency : undefined;
      const date = e instanceof ApiError ? e.details?.date : undefined;
      if (e instanceof ApiError && e.code === 'RATE_UNAVAILABLE' && typeof currency === 'string' && typeof date === 'string') {
        setMissingRate({ message: e.message, currency, date });
        setErrorFocus((x) => x + 1);
        return;
```

- [ ] **Step 4: Логика панели**

Создайте `src/client/lib/import-panel.ts`:

```ts
import { getCurrency, isKnownCurrency } from '../../shared/currencies';
import { formatDateRu } from '../../shared/dates';
import { COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import { formatAmount, formatMoney, MONEY_SCREEN, MONEY_SCREEN_BEFORE, parseAmount } from '../../shared/money';
import type {
  AccountMapping,
  ImportCommitResult,
  ImportIssueGroup,
  ImportPreview,
  ImportPreviewAccount,
} from '../../shared/schemas/imports';
import { api } from './api';
import { invalidateOperations } from './journal-mutations';
import { pluralRu } from './journal-format';
import { queryClient } from './query';

/**
 * Панель «Импорт из Excel» (§5 спецификации импорта): чистые функции состояния и текстов (тесты — в node без DOM)
 * и запросы к API импорта.
 */

/** Предел файла (§2.4): больше — отказ в браузере, до загрузки. */
export const IMPORT_MAX_BYTES = 30 * 1024 * 1024;
/** Подсказка окна выбора файла. */
export const IMPORT_ACCEPT = '.xlsx,.csv';
/** Пункт «Создать новый счёт» в поле «Счёт» карточки (id справочников всегда положительные). */
export const NEW_ACCOUNT = -1;
/** Пауза перед пересчётом предпросмотра после правки карточки счёта (§5.3). */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Ошибка размера до загрузки; null — размер подходит. */
export function importSizeError(size: number): string | null {
  return size > IMPORT_MAX_BYTES ? 'Файл больше 30 МБ' : null;
}

/** «16 028» — разряды узким неразрывным пробелом, как у сумм. */
export const formatCount = (n: number) => formatAmount(n, 0);

/** Номера строк группы: «строка 15», «строки 15, 230, 231 и ещё 4»; без номеров (W8) — пусто. */
export function issueRowsText(g: Pick<ImportIssueGroup, 'count' | 'rows'>): string {
  if (g.rows.length === 0) return '';
  const more = g.count - g.rows.length;
  return `${g.rows.length === 1 && more === 0 ? 'строка' : 'строки'} ${g.rows.join(', ')}${more > 0 ? ` и ещё ${formatCount(more)}` : ''}`;
}

/** Пункт списка ошибок и предупреждений (§5.3): «Нет даты платежа — строки 15, 230, 231 и ещё 4». */
export function issueText(g: ImportIssueGroup): string {
  const rows = issueRowsText(g);
  return rows ? `${g.message} — ${rows}` : g.message;
}

const operations = (n: number) => `${formatCount(n)} ${pluralRu(n, 'операция', 'операции', 'операций')}`;

/** Первая строка итога (§5.3): «В файле 16 028 операций: доходов 9 812, расходов 6 104, переводов 112. Период: 15.03.2023 – 11.10.2026». */
export function checkSummary(p: ImportPreview): string {
  const c = p.counts;
  const period = p.period ? `. Период: ${formatDateRu(p.period.from)} – ${formatDateRu(p.period.to)}` : '';
  return `В файле ${operations(p.file.rows)}: доходов ${formatCount(c.income)}, расходов ${formatCount(c.expense)}, переводов ${formatCount(c.transfer)}${period}`;
}

/** Ошибки в карточке счёта: первая карточка с ошибкой и её текст. */
function firstAccountError(p: ImportPreview): { card: ImportPreviewAccount; message: string } | null {
  for (const card of p.accounts) {
    if (card.mapping === null) return { card, message: `Выберите счёт для «${card.fileName}»` };
    if (card.errors.length > 0) return { card, message: `Исправьте ошибку в карточке счёта «${card.fileName}»: ${card.errors[0]!.message}` };
  }
  return null;
}

/**
 * Почему «Импортировать» недоступна (§5.3 п. 6); null — можно импортировать. invalidCards — названия карточек, где
 * сумма введена с ошибкой (она ещё не ушла на сервер).
 */
export function blockReason(p: ImportPreview, opts: { refreshing: boolean; invalidCards: readonly string[] }): string | null {
  if (opts.refreshing) return 'Проверяем изменения…';
  if (opts.invalidCards.length > 0) return `Проверьте сумму в карточке счёта «${opts.invalidCards[0]}»`;
  if (p.errors.total > 0) return 'Исправьте ошибки в файле и загрузите его снова';
  const account = firstAccountError(p);
  if (account) return account.message;
  if (p.counts.add === 0) return p.counts.duplicates > 0 ? 'Нечего импортировать: все строки — дубликаты' : 'Нечего импортировать';
  return p.canImport ? null : 'Импорт сейчас невозможен';
}

/** Живая область после проверки (§5.8): «Найдено ошибок: 23» или «Проверка завершена: ошибок нет, можно импортировать». */
export function checkStatus(p: ImportPreview): string {
  if (p.errors.total > 0) return `Найдено ошибок: ${formatCount(p.errors.total)}`;
  const reason = blockReason(p, { refreshing: false, invalidCards: [] });
  return reason ? `Проверка завершена. ${reason}` : 'Проверка завершена: ошибок нет, можно импортировать';
}

/** Группа «Будет создано» (§5.3 п. 4): заголовок со счётчиком, разделы (у категорий — «Доходы», «Расходы») и «и ещё N». */
export interface CreateGroup {
  key: 'categories' | 'counterparties' | 'projects' | 'tags';
  title: string;
  total: number;
  sections: { title: string | null; items: { name: string; note?: string }[] }[];
  more: number;
}

/** Непустые группы «Будет создано» в порядке спецификации. */
export function createGroups(p: ImportPreview): CreateGroup[] {
  const groups: CreateGroup[] = [];
  const c = p.create;
  if (c.categories.total > 0) {
    const name = (i: (typeof c.categories.items)[number]) => (i.parent ? `${i.parent} → ${i.name}` : i.name);
    const sections = [
      { title: 'Доходы', items: c.categories.items.filter((i) => i.kind === 'income').map((i) => ({ name: name(i) })) },
      { title: 'Расходы', items: c.categories.items.filter((i) => i.kind === 'expense').map((i) => ({ name: name(i) })) },
    ].filter((s) => s.items.length > 0);
    groups.push({ key: 'categories', title: 'Категории', total: c.categories.total, sections, more: c.categories.total - c.categories.items.length });
  }
  const plain = (key: 'counterparties' | 'projects' | 'tags', title: string) => {
    const g = c[key];
    if (g.total === 0) return;
    const items = g.items.map((i) => (i.type ? { name: i.name, note: COUNTERPARTY_TYPE_SINGULAR[i.type] } : { name: i.name }));
    groups.push({ key, title, total: g.total, sections: [{ title: null, items }], more: g.total - g.items.length });
  };
  plain('counterparties', 'Контрагенты');
  plain('projects', 'Проекты');
  plain('tags', 'Теги');
  return groups;
}

/** «+10 149 813 ₸», «\u22122 500 ₸»: движение счёта со знаком. */
export function signedMoney(minor: number, currency: string): string {
  return `${minor > 0 ? '+' : ''}${formatMoney(minor, currency, MONEY_SCREEN)}`;
}

const balanceText = (minor: number, currency: string) => formatMoney(minor, currency, MONEY_SCREEN_BEFORE);

/**
 * Вычисленное значение под полем суммы нового счёта (§5.4): «Текущий остаток» B — «Стартовый баланс: B \u2212 движение»;
 * «Стартовый баланс» S — «Остаток после импорта: S + движение»; пусто — «Остаток после импорта: движение».
 */
export function newAccountHint(balance: { mode: 'current' | 'start'; amount: number } | null, movement: number, currency: string): string {
  if (balance === null) return `Остаток после импорта: ${balanceText(movement, currency)}`;
  if (balance.mode === 'current') return `Стартовый баланс: ${balanceText(balance.amount - movement, currency)}`;
  return `Остаток после импорта: ${balanceText(balance.amount + movement, currency)}`;
}

/** Подсказка поля «Остаток после импорта» существующего счёта: пусто — каким станет остаток без поля. */
export function existingAccountHint(target: number | null, balance: number, movement: number, currency: string): string {
  return target === null
    ? `Пусто — после импорта остаток ${balanceText(balance + movement, currency)}`
    : 'Стартовый баланс пересчитается так, чтобы после импорта остаток был этой суммой';
}

/** Черновик карточки счёта: поле «Счёт» и поля сумм — как их видит человек (текст ещё может быть неверным). */
export interface CardDraft {
  /** id счёта, NEW_ACCOUNT или null — не выбран (A1). */
  choice: number | null;
  name: string;
  currency: string;
  mode: 'current' | 'start';
  /** Сумма нового счёта (текст поля). */
  amount: string;
  /** «Остаток после импорта» существующего счёта (текст поля). */
  target: string;
}

/** Текст поля суммы из минимальных единиц: «1 500,50». */
const amountText = (minor: number, currency: string) => formatAmount(minor, isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2);

/** Черновик из сопоставления, которое прислал сервер (по умолчанию или из запроса). */
export function draftFromCard(card: ImportPreviewAccount, baseCurrency: string): CardDraft {
  const m = card.mapping;
  const blank: CardDraft = { choice: null, name: card.fileName, currency: baseCurrency, mode: 'current', amount: '', target: '' };
  if (!m) return blank;
  if (m.kind === 'existing') {
    const currency = card.currency ?? baseCurrency;
    return { ...blank, choice: m.accountId, target: m.targetBalance == null ? '' : amountText(m.targetBalance, currency) };
  }
  return {
    ...blank,
    choice: NEW_ACCOUNT,
    name: m.name,
    currency: m.currency,
    mode: m.balance?.mode ?? 'current',
    amount: m.balance ? amountText(m.balance.amount, m.currency) : '',
  };
}

/** Текст ошибки суммы, как в форме счёта. */
function amountError(currency: string): string {
  const minor = isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2;
  return minor > 0 ? `Введите сумму, например 1 500,${'5'.padEnd(minor, '0')}` : 'Введите сумму без дробной части, например 1 500';
}

/**
 * Сопоставление из черновика для запроса предпросмотра. Неверная сумма — error (запрос не уходит, кнопка недоступна);
 * счёт не выбран — mapping null (на сервер не отправляется: остаётся A1). accountCurrency — валюта выбранного существующего счёта.
 */
export function mappingFromDraft(key: string, d: CardDraft, accountCurrency: string | null): { mapping: AccountMapping | null; error: string | null } {
  if (d.choice === null) return { mapping: null, error: null };
  if (d.choice !== NEW_ACCOUNT) {
    const currency = accountCurrency ?? 'KZT';
    const target = d.target.trim() === '' ? null : parseAmount(d.target, isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2);
    if (target === null && d.target.trim() !== '') return { mapping: null, error: amountError(currency) };
    return { mapping: { key, kind: 'existing', accountId: d.choice, targetBalance: target }, error: null };
  }
  const amount = d.amount.trim() === '' ? null : parseAmount(d.amount, isKnownCurrency(d.currency) ? getCurrency(d.currency).minorUnits : 2);
  if (amount === null && d.amount.trim() !== '') return { mapping: null, error: amountError(d.currency) };
  return { mapping: { key, kind: 'new', name: d.name, currency: d.currency, balance: amount === null ? null : { mode: d.mode, amount } }, error: null };
}

/**
 * Сопоставления для запроса (§5.4): выбор человека по ключу счёта (он переживает «Выбрать другой файл») или то, что
 * показал сервер. Только счета этого файла; невыбранные (A1) не отправляются.
 */
export function requestMappings(p: ImportPreview, choices: ReadonlyMap<string, AccountMapping>): AccountMapping[] {
  return p.accounts.flatMap((card) => {
    const m = choices.get(card.key) ?? card.mapping;
    return m ? [m] : [];
  });
}

/** В новом файле есть счета, выбранные человеком раньше иначе, чем по умолчанию: нужен пересчёт с этим выбором. */
export function needsRemembered(p: ImportPreview, choices: ReadonlyMap<string, AccountMapping>): boolean {
  return p.accounts.some((card) => {
    const m = choices.get(card.key);
    return m !== undefined && JSON.stringify(m) !== JSON.stringify(card.mapping);
  });
}

/** Итог записи (§5.6): «Добавлено 16 028 операций. Создано: 2 счёта, 37 категорий, 86 контрагентов, 1 тег. Пропущено дубликатов: 0». */
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
  return `Добавлено ${operations(r.counts.added)}.${created} Пропущено дубликатов: ${formatCount(r.counts.duplicates)}`;
}

/** Свежий предпросмотр в ответе 409 и 422 (details.preview). */
export function isImportPreview(x: unknown): x is ImportPreview {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<ImportPreview>;
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  return (
    typeof p.token === 'string' &&
    typeof p.revision === 'string' &&
    typeof p.canImport === 'boolean' &&
    Array.isArray(p.accounts) &&
    obj(p.errors) &&
    typeof p.errors.total === 'number' &&
    Array.isArray(p.errors.byCode) &&
    obj(p.counts) &&
    typeof p.counts.add === 'number' &&
    obj(p.create) &&
    (['categories', 'counterparties', 'projects', 'tags'] as const).every((k) => obj(p.create![k]) && Array.isArray(p.create![k].items))
  );
}

// ——— запросы ———

/** Загрузка файла: байты телом application/octet-stream, имя — в X-File-Name (как у вложений, §6.2). */
export function uploadImport(companyId: number, file: File): Promise<ImportPreview> {
  return api<ImportPreview>(`/companies/${companyId}/imports/upload`, { method: 'POST', file: { data: file, name: file.name } });
}

export function previewImport(companyId: number, token: string, accounts: AccountMapping[]): Promise<ImportPreview> {
  return api<ImportPreview>(`/companies/${companyId}/imports/preview`, { method: 'POST', body: { token, accounts } });
}

export function commitImport(companyId: number, p: ImportPreview, accounts: AccountMapping[]): Promise<ImportCommitResult> {
  return api<ImportCommitResult>(`/companies/${companyId}/imports`, { method: 'POST', body: { token: p.token, accounts, revision: p.revision } });
}

/** Ссылка «Скачать шаблон» (§5.2): GET по сессии. */
export const IMPORT_TEMPLATE_HREF = '/api/v1/imports/template.xlsx';

/** После записи (§5.6): журнал, счета и балансы, компании, справочники и история. */
export async function invalidateAfterImport(companyId: number): Promise<void> {
  await Promise.all([
    invalidateOperations(companyId),
    ...['categories', 'counterparties', 'projects', 'tags', 'audit', 'imports'].map((k) => queryClient.invalidateQueries({ queryKey: [k, companyId] })),
  ]);
}
```

- [ ] **Step 5: `Drawer.busy`, `Drawer.wide` и значки**

В `src/client/components/Drawer.tsx` замените

```tsx
  /** «Закрыть» в левом углу (панель «Счета» на телефоне, §8.1 этапа 1.5); по умолчанию — справа. */
  closeAt?: 'left' | 'right';
  children: ReactNode;
}) {
```

на

```tsx
  /** «Закрыть» в левом углу (панель «Счета» на телефоне, §8.1 этапа 1.5); по умолчанию — справа. */
  closeAt?: 'left' | 'right';
  /**
   * Идёт запись (импорт, §5.1 спецификации импорта): Esc, «Закрыть» и касание фона панель не закрывают — как у формы
   * операции (решение 6b). «Закрыть» остаётся в порядке Tab с aria-disabled.
   */
  busy?: boolean;
  /** Широкая панель: 480 px на компьютере, на телефоне — на весь экран (импорт, §5.1 и §5.7 спецификации импорта). */
  wide?: boolean;
  children: ReactNode;
}) {
```

В `src/client/components/Drawer.tsx` замените

```tsx
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
```

на

```tsx
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const busy = useRef(false);
  busy.current = props.busy === true;
  const close = () => {
    if (!busy.current) ref.current?.close();
  };

  useEffect(() => {
```

В `src/client/components/Drawer.tsx` замените

```tsx
  // на телефоне цель касания 44 px (btnClose)
  const closeButton = (
    <button type="button" aria-label="Закрыть" onClick={() => ref.current?.close()} className={btnClose}>
      <span aria-hidden="true">✕</span>
    </button>
```

на

```tsx
  // на телефоне цель касания 44 px (btnClose)
  const closeButton = (
    <button type="button" aria-label="Закрыть" aria-disabled={props.busy || undefined} onClick={close} className={`${btnClose} aria-disabled:opacity-50`}>
      <span aria-hidden="true">✕</span>
    </button>
```

В `src/client/components/Drawer.tsx` замените

```tsx
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => cycleTab(e, ref.current)}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) ref.current?.close();
        pressedOnBackdrop.current = false;
      }}
```

на

```tsx
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        cycleTab(e, ref.current);
        // Esc во время записи: без отмены keydown браузер закрыл бы окно (повторный cancel отменить нельзя)
        if (e.key === 'Escape' && busy.current) e.preventDefault();
      }}
      onCancel={(e) => {
        if (busy.current && e.target === e.currentTarget) e.preventDefault();
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) close();
        pressedOnBackdrop.current = false;
      }}
```

В `src/client/components/Drawer.tsx` замените

```tsx
        else focusPageHeading();
      }}
      className={`my-0 h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none bg-card p-0 text-ink shadow-2xl transition-transform duration-200 backdrop:bg-black/40 motion-reduce:transition-none ${side}`}
    >
      {props.open && (
```

на

```tsx
        else focusPageHeading();
      }}
      className={`my-0 h-dvh max-h-none ${props.wide ? 'w-full md:w-[min(30rem,calc(100vw-3rem))]' : 'w-[min(22rem,calc(100vw-3rem))]'} max-w-none bg-card p-0 text-ink shadow-2xl transition-transform duration-200 backdrop:bg-black/40 motion-reduce:transition-none ${side}`}
    >
      {props.open && (
```

В `src/client/components/icons.tsx` замените

```tsx
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

```

на

```tsx
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

/** ⤒ — «Импортировать» в тулбаре журнала (§5.1 спецификации импорта). */
export function UploadIcon() {
  return (
    <Svg>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Svg>
  );
}

/** Папка зоны файла панели импорта (§5.2 спецификации импорта): 32 px. */
export function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/client/import-panel.test.ts`
Expected: PASS, 8 тестов.

Run: `npm test`
Expected: 997 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e`
Expected: 142 из 142 (`Drawer` без `busy` и `wide` ведёт себя как раньше).

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/api.ts src/client/components/operation/OperationForm.tsx src/client/lib/import-panel.ts src/client/components/Drawer.tsx src/client/components/icons.tsx tests/client/import-panel.test.ts
git commit -m "feat: импорт — логика панели: тексты, сопоставление счетов, запросы; Drawer.busy и широкая панель" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Панель «Импорт из Excel» на компьютере (§5.1–§5.6, §5.8, §11.3)

**Files:**
- Create: `src/client/components/import/ImportAccountCard.tsx`, `src/client/components/import/ImportPreviewView.tsx`, `src/client/components/import/ImportPanel.tsx`
- Modify: `src/client/components/journal/JournalToolbar.tsx`, `src/client/pages/JournalPage.tsx`, `src/client/pages/CompanyLayout.tsx`
- Test: `e2e/import.spec.ts`

**Interfaces:**
- Consumes:
  - задача 3: всё из `lib/import-panel.ts`, `Drawer` (`busy`, `wide`, `footer`), `UploadIcon`, `FolderIcon`;
  - `ComboSelect`, `Field`, `accountOptions`, `useAccounts`, `formatFileSize`, `isFileDrag`, `nameKey`.
- Produces:
  - `src/client/components/import/ImportPanel.tsx`:
    - `ImportPanelHost({ company, children })` — одна панель импорта на компанию (решение 18), в `CompanyLayout` внутри `OperationFormHost`;
    - `useOpenImport(): (() => void) | null` — открыть панель; `null` — архивная компания;
    - `ImportPanel({ company, open, onClose })` — сама панель;
  - `ImportPreviewView`, `ImportAccountCard` (используются только панелью);
  - `JournalToolbar` — свойство `onImport?: () => void`: ⤒ «Импортировать» — последняя кнопка тулбара на компьютере, `aria-haspopup="dialog"`; без свойства кнопки нет;
  - доступность для e2e и снимков:
    - панель — `dialog` «Импорт из Excel»; скрытое поле файла — `[data-import-file]`;
    - заголовки `h3` «Проверка файла» и «Импорт завершён»;
    - карточки — `article` с именем-названием из файла; поле «Счёт для «…»» (combobox);
    - `radiogroup` «Указать остаток»; поле «Текущий остаток, ₸» / «Стартовый баланс, ₸»;
    - группы «Будет создано» — кнопки «Категории: N» с `aria-expanded`;
    - живая область `role="status"`.

- [ ] **Step 1: Write the failing test**

Создайте `e2e/import.spec.ts`:

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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const panel = (page: Page) => page.getByRole('dialog', { name: 'Импорт из Excel' });
/** Выбор файла: скрытое поле панели (кнопка «Выберите файл» открывает его окно выбора). */
const chooseFile = (page: Page, rows: FinmapLikeValue[][], name = 'выгрузка.xlsx') =>
  panel(page).locator('[data-import-file]').setInputFiles({ name, mimeType: XLSX_MIME, buffer: finmapLikeXlsx(rows) });

/** Синтетический файл: доход на существующую «Кассу», перевод на новый «Банк-2», расход с новыми категорией и контрагентом. */
const ROWS = [
  fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2025-03-17', '12:00:00'), amount: 200, from: 'Банк-2', category: 'Связь', counterparty: 'Поставщик Б' }),
];

async function companyWithCash(page: Page, title: string): Promise<number> {
  await login(page);
  const cid = await createCompany(page, `ТОО ${title} ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  return cid;
}

test('«Импортировать» — последняя кнопка тулбара, открывает панель «Импорт из Excel»; «Скачать шаблон» скачивает .xlsx; файл больше 30 МБ отклоняется до загрузки', async ({ page }) => {
  await companyWithCash(page, 'Импорт панель');
  const open = page.getByRole('main').getByRole('button', { name: 'Импортировать' });
  await expect(open).toHaveAttribute('aria-haspopup', 'dialog');
  await open.click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('Перетяните сюда файл (до 30 МБ)')).toBeVisible();
  // ограничения файла — в описании кнопки «Выберите файл» (§5.8)
  await expect(panel(page).getByRole('button', { name: 'Выберите файл' })).toHaveAccessibleDescription(
    'Формат — как выгрузка Finmap «Excel» или шаблон: .xlsx или .csv. Импортируется первый лист',
  );
  // кнопка «Импортировать» в подвале есть, но недоступна: файла ещё нет
  const go = panel(page).getByRole('button', { name: 'Импортировать' });
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(go).toHaveAccessibleDescription('Выберите файл');

  const download = page.waitForEvent('download');
  await panel(page).getByRole('link', { name: 'Скачать шаблон' }).click();
  expect((await download).suggestedFilename()).toBe('Шаблон импорта.xlsx');

  // больше 30 МБ — отказ в браузере, без запроса
  let uploads = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/imports/upload')) uploads++;
  });
  await panel(page)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'большой.xlsx', mimeType: XLSX_MIME, buffer: Buffer.alloc(30 * 1024 * 1024 + 1) });
  await expect(panel(page).getByRole('alert')).toHaveText('Файл больше 30 МБ');
  expect(uploads).toBe(0);

  // Esc закрывает панель, фокус возвращается на «Импортировать»
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(open).toBeFocused();
});

test('файл → проверка: итог, «Касса» сопоставлена, новый «Банк-2» с «Текущим остатком»; «Импортировать» → «Импорт завершён», журнал и левая панель обновились', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт запись');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);

  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await expect(p.getByText(/^В файле 3 операции: доходов 1, расходов 1, переводов 1\. Период: 15\.03\.2025 – 17\.03\.2025$/)).toBeVisible();
  await expect(p.getByText('Будет добавлено: 3')).toBeVisible();
  await expect(p.getByRole('status')).toHaveText('Проверка завершена: ошибок нет, можно импортировать');
  // строка файла: имя и «Выбрать другой файл»
  await expect(p.getByText('выгрузка.xlsx')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Выбрать другой файл' })).toBeVisible();

  const cash = p.getByRole('article', { name: 'Касса' });
  await expect(cash.getByRole('combobox', { name: 'Счёт для «Касса»' })).toHaveValue('Касса');
  await expect(cash.getByText(/^Операций: 2 · движение: \+1\s000\s₸$/)).toBeVisible();
  await expect(cash.getByText(/^Текущий остаток: ₸\s0$/)).toBeVisible();
  await expect(cash.getByText('Дата открытия будет перенесена')).toHaveCount(0);

  const bank = p.getByRole('article', { name: 'Банк-2' });
  await expect(bank.getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toHaveValue('Создать новый счёт');
  await expect(bank.getByLabel('Название')).toHaveValue('Банк-2');
  await expect(bank.getByRole('radiogroup', { name: 'Указать остаток' }).getByRole('radio', { name: 'Текущий остаток' })).toBeChecked();
  await expect(bank.getByText(/^Остаток после импорта: ₸\s300$/)).toBeVisible();
  // «Текущий остаток» 1 000 → «Стартовый баланс: ₸ 700»; пока идёт пересчёт, «Импортировать» недоступна
  const recheck = page.waitForResponse((r) => r.url().endsWith('/imports/preview'));
  await bank.getByLabel('Текущий остаток, ₸').fill('1 000');
  await expect(bank.getByText(/^Стартовый баланс: ₸\s700$/)).toBeVisible();
  await recheck;
  const go = p.getByRole('button', { name: 'Импортировать' });
  await expect(go).not.toHaveAttribute('aria-disabled', 'true');

  // «Будет создано»: группы свёрнуты, кнопки с числом
  const categories = p.getByRole('button', { name: 'Категории: 2' });
  await expect(categories).toHaveAttribute('aria-expanded', 'false');
  await categories.click();
  await expect(p.getByText('Бар', { exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Контрагенты: 1' })).toBeVisible();

  await go.click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  const done = 'Добавлено 3 операции. Создано: 1 счёт, 2 категории, 1 контрагент. Пропущено дубликатов: 0';
  // итог виден под заголовком и объявлен в живой области (§5.8)
  await expect(p.getByRole('paragraph').filter({ hasText: done })).toBeVisible();
  await expect(p.getByRole('status')).toHaveText(done);
  await p.getByRole('button', { name: 'Готово' }).click();
  await expect(p).toBeHidden();
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toBeFocused();

  // журнал и левая панель — без перезагрузки страницы
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(3);
  const accounts = page.getByRole('navigation', { name: 'Счета' });
  await expect(accounts.getByRole('link', { name: /^Банк-2/ })).toContainText(/₸\s1\s000$/);
  await expect(accounts.getByRole('link', { name: /^Касса/ })).toContainText(/₸\s1\s000$/);
  // повторный файл: всё — дубликаты, импортировать нечего
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  await expect(p.getByText(/^Дубликаты: 3 — уже есть в компании, будут пропущены/)).toBeVisible();
  await expect(p.getByRole('button', { name: 'Импортировать' })).toHaveAccessibleDescription('Нечего импортировать: все строки — дубликаты');
  expect(cid).toBeGreaterThan(0);
});

test('файл с ошибками: список ошибок, «Импортировать» недоступна с причиной; ошибка файла — сообщение и «Выбрать другой файл»', async ({ page }) => {
  await companyWithCash(page, 'Импорт ошибки');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, [...ROWS, fr({ paidAt: 'вчера', amount: 1, to: 'Касса' }), fr({ paidAt: at('2025-03-18'), amount: null, to: 'Касса' })]);
  const p = panel(page);
  const alert = p.getByRole('alert').filter({ hasText: 'Найдено ошибок' });
  await expect(alert).toContainText('Найдено ошибок: 2. Исправьте файл и загрузите его снова');
  await expect(alert.getByRole('listitem')).toHaveText(['Не удалось прочитать дату платежа «вчера» — строка 5', 'Нет суммы — строка 6']);
  await expect(p.getByRole('status')).toHaveText('Найдено ошибок: 2');
  const go = p.getByRole('button', { name: 'Импортировать' });
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(go).toHaveAccessibleDescription('Исправьте ошибки в файле и загрузите его снова');
  let commits = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/imports$/.test(r.url())) commits++;
  });
  // aria-disabled остаётся в порядке Tab: Enter ничего не отправляет
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toBeFocused();
  expect(commits).toBe(0);

  // не XLSX и не CSV — ошибка файла F2 под строкой файла
  await p.locator('[data-import-file]').setInputFiles({ name: 'отчёт.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(p.getByRole('alert').filter({ hasText: 'Нужен файл' })).toHaveText('Нужен файл .xlsx или .csv');
  await expect(go).toHaveAccessibleDescription('Выберите другой файл');
});

test('Esc во время записи панель не закрывает, «Назад» в браузере — тоже; 410 «Проверка устарела» — файл проверяется заново, после повторного нажатия импорт проходит', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт занята');
  // в журнал — из настроек, переходом внутри приложения: «Назад» в браузере вернёт в настройки
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log`));
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  // первый POST …/imports — 410 (кэш вытеснен): панель сама загружает файл заново и просит нажать ещё раз
  let first = true;
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST' || !first) return route.fallback();
    first = false;
    await route.fulfill({ status: 410, json: { error: { code: 'IMPORT_EXPIRED', message: 'Проверка устарела — загрузите файл заново' } } });
  });
  const reupload = page.waitForResponse((r) => r.url().endsWith('/imports/upload'));
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await reupload;
  await expect(p.getByRole('alert').filter({ hasText: 'Проверка устарела' })).toHaveText(
    'Проверка устарела — файл проверен заново. Проверьте итог и нажмите «Импортировать» ещё раз',
  );
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  // запись задержана: панель занята — Esc и «Закрыть» её не закрывают
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.fallback();
  });
  const go = p.getByRole('button', { name: /^Импорт/ });
  await go.click();
  await expect(go).toHaveText('Импортируем…');
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  const closeButton = p.getByRole('button', { name: 'Закрыть' });
  await expect(closeButton).toHaveAttribute('aria-disabled', 'true');
  await closeButton.focus();
  await page.keyboard.press('Enter');
  await expect(p).toBeVisible();
  // «Назад» в браузере уводит с журнала, но панель живёт в раскладке компании — запись видна до конца
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/tags$`));
  await expect(p).toBeVisible();
  release();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
});

test('выбор счёта переживает «Выбрать другой файл»; данные изменились после проверки — 409, свежий итог и сообщение, повторное «Импортировать» проходит', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт изменения');
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  // «Банк-2» → существующий «Сейф»
  const bankAccount = p.getByRole('article', { name: 'Банк-2' }).getByRole('combobox', { name: 'Счёт для «Банк-2»' });
  await bankAccount.click();
  const chosen = page.waitForResponse((r) => r.url().endsWith('/imports/preview'));
  await page.getByRole('option', { name: 'Сейф' }).click();
  await chosen;
  await expect(bankAccount).toHaveValue('Сейф');
  await expect(p.getByRole('article', { name: 'Банк-2' }).getByText(/^Текущий остаток: ₸\s0$/)).toBeVisible();

  // другой файл с тем же счётом: выбор «Сейф» применён сразу, без нового выбора
  await chooseFile(page, [fr({ paidAt: at('2025-03-18', '09:00:00'), amount: 300, from: 'Банк-2', category: 'Связь' })], 'исправленный.xlsx');
  await expect(p.getByText('исправленный.xlsx')).toBeVisible();
  await expect(p.getByRole('article', { name: 'Банк-2' }).getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toHaveValue('Сейф');
  await expect(p.getByRole('button', { name: 'Категории: 1' })).toBeVisible();

  // другой пользователь создал категорию «Связь»: запись видит другой итог — 409 и свежий предпросмотр
  await apiPost(page, `/api/v1/companies/${cid}/categories`, { kind: 'expense', name: 'Связь' });
  const go = p.getByRole('button', { name: 'Импортировать' });
  await go.click();
  await expect(p.getByRole('alert').filter({ hasText: 'изменились' })).toHaveText(
    'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз',
  );
  await expect(p.getByRole('button', { name: /^Категории:/ })).toHaveCount(0);
  await go.click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await expect(p.getByRole('status')).toHaveText('Добавлено 1 операция. Пропущено дубликатов: 0');
});

test('архивная компания: кнопки «Импортировать» нет', async ({ page }) => {
  await login(page);
  // в архив — только компания без активных счетов
  const cid = await createCompany(page, `ТОО Импорт архив ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.reload();
  await expect(page.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/import.spec.ts`
Expected: FAIL — в тулбаре нет кнопки «Импортировать».

- [ ] **Step 3: Карточка счёта из файла**

Создайте `src/client/components/import/ImportAccountCard.tsx`:

```tsx
import { useId, useState } from 'react';
import { CURRENCIES, getCurrency, isKnownCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { nameKey } from '../../../shared/finmap-format';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import type { AccountMapping, ImportPreviewAccount } from '../../../shared/schemas/imports';
import {
  draftFromCard,
  existingAccountHint,
  formatCount,
  mappingFromDraft,
  NEW_ACCOUNT,
  newAccountHint,
  signedMoney,
  type CardDraft,
} from '../../lib/import-panel';
import { accountOptions } from '../../lib/operation-options';
import type { Account } from '../../lib/queries';
import { Field } from '../Field';
import { ComboSelect } from '../operation/ComboSelect';
import { inputClass } from '../ui';

/**
 * Карточка «Счета из файла» (§5.4 спецификации импорта): название из файла (`h4`), число операций и движение,
 * поле «Счёт» — «Создать новый счёт» или активный счёт компании. Новый счёт — название, валюта, «Текущий остаток» или
 * «Стартовый баланс» и вычисленное значение под суммой; существующий — текущий остаток, «Остаток после импорта» и
 * перенос даты открытия. Черновик полей — в карточке; верное сопоставление уходит наверх (пересчёт через 300 мс).
 */
export function ImportAccountCard(props: {
  card: ImportPreviewAccount;
  /** Счета компании, включая архивные (подсказка «Есть счёт «…» в архиве»). */
  accounts: readonly Account[];
  baseCurrency: string;
  onChange: (key: string, mapping: AccountMapping | null, error: string | null) => void;
}) {
  const { card } = props;
  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card, props.baseCurrency));
  const [amountError, setAmountError] = useState<string | null>(null);
  const titleId = useId();
  const hintId = useId();
  const active = props.accounts.filter((a) => !a.archivedAt);
  const chosen = props.accounts.find((a) => a.id === draft.choice) ?? null;
  const archived = props.accounts.find((a) => a.archivedAt && nameKey(a.name) === card.key);

  const update = (patch: Partial<CardDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const account = props.accounts.find((a) => a.id === next.choice) ?? null;
    const { mapping, error } = mappingFromDraft(card.key, next, account?.currency ?? null);
    setAmountError(error);
    props.onChange(card.key, mapping, error);
  };

  const currency = draft.choice === NEW_ACCOUNT ? draft.currency : (chosen?.currency ?? card.currency ?? props.baseCurrency);
  const minorUnits = isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2;
  const parsed = mappingFromDraft(card.key, draft, chosen?.currency ?? null).mapping;
  // ошибки сервера; «Выберите счёт» (A1) — у поля «Счёт»
  const pickError = card.errors.find((e) => e.code === 'A1' || e.code === 'A5')?.message;
  const otherErrors = card.errors.filter((e) => e.code !== 'A1' && e.code !== 'A5');

  return (
    <article aria-labelledby={titleId} className="grid gap-3 rounded-xl border border-field p-3">
      <div>
        <h4 id={titleId} className="font-semibold [overflow-wrap:anywhere]">
          {card.fileName}
        </h4>
        <p className="text-sm text-muted">
          Операций: {formatCount(card.rows)}
          {card.currency && isKnownCurrency(card.currency) && ` · движение: ${signedMoney(card.movement, card.currency)}`}
        </p>
      </div>
      <ComboSelect
        label={`Счёт для «${card.fileName}»`}
        listLabel="Счета"
        value={draft.choice}
        options={[{ id: NEW_ACCOUNT, label: 'Создать новый счёт' }, ...accountOptions(active, null)]}
        emptyLabel={null}
        error={pickError}
        onChange={(id) => update({ choice: id, target: '' })}
      />
      {draft.choice === NEW_ACCOUNT && archived && <p className="text-sm text-muted">Есть счёт «{archived.name}» в архиве</p>}

      {draft.choice === NEW_ACCOUNT && (
        <>
          <Field label="Название">
            {(c) => <input {...c} value={draft.name} maxLength={120} onChange={(e) => update({ name: e.target.value })} className={inputClass} />}
          </Field>
          <Field label="Валюта">
            {(c) => (
              <select {...c} value={draft.currency} onChange={(e) => update({ currency: e.target.value })} className={inputClass}>
                {CURRENCIES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div role="radiogroup" aria-label="Указать остаток" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {(
              [
                ['current', 'Текущий остаток'],
                ['start', 'Стартовый баланс'],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="flex min-h-11 items-center gap-2">
                <input type="radio" name={`${titleId}-mode`} checked={draft.mode === mode} onChange={() => update({ mode })} className="size-4 accent-income" />
                {label}
              </label>
            ))}
          </div>
          <Field label={`${draft.mode === 'current' ? 'Текущий остаток' : 'Стартовый баланс'}, ${isKnownCurrency(draft.currency) ? getCurrency(draft.currency).symbol : draft.currency}`} error={amountError ?? undefined}>
            {(c) => (
              <input
                {...c}
                inputMode="decimal"
                aria-describedby={[c['aria-describedby'], hintId].filter(Boolean).join(' ')}
                value={draft.amount}
                placeholder={minorUnits > 0 ? '0,00' : '0'}
                onChange={(e) => update({ amount: e.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <p id={hintId} aria-live="polite" className="-mt-2 text-sm text-muted">
            {card.currency && isKnownCurrency(card.currency) && parsed?.kind === 'new' ? newAccountHint(parsed.balance, card.movement, card.currency) : ''}
          </p>
        </>
      )}

      {draft.choice !== null && draft.choice !== NEW_ACCOUNT && card.existing && card.currency && isKnownCurrency(card.currency) && (
        <>
          <p className="text-sm">Текущий остаток: {formatMoney(card.existing.balance, card.currency, MONEY_SCREEN_BEFORE)}</p>
          <Field label="Остаток после импорта (необязательно)" error={amountError ?? undefined}>
            {(c) => (
              <input
                {...c}
                inputMode="decimal"
                aria-describedby={[c['aria-describedby'], hintId].filter(Boolean).join(' ')}
                value={draft.target}
                onChange={(e) => update({ target: e.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <p id={hintId} aria-live="polite" className="-mt-2 text-sm text-muted">
            {existingAccountHint(parsed?.kind === 'existing' ? (parsed.targetBalance ?? null) : null, card.existing.balance, card.movement, card.currency)}
          </p>
          {card.existing.newOpenedAt && <p className="text-sm text-muted">Дата открытия будет перенесена на {formatDateRu(card.existing.newOpenedAt)}</p>}
        </>
      )}

      {otherErrors.length > 0 && (
        <ul className="text-sm text-expense-strong">
          {otherErrors.map((e) => (
            <li key={`${e.code}-${e.message}`}>{e.message}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Предпросмотр**

Создайте `src/client/components/import/ImportPreviewView.tsx`:

```tsx
import { useId, useState, type Ref } from 'react';
import type { AccountMapping, ImportPreview } from '../../../shared/schemas/imports';
import { checkSummary, createGroups, formatCount, issueRowsText, issueText, type CreateGroup } from '../../lib/import-panel';
import type { Account } from '../../lib/queries';
import { alertClass } from '../ui';
import { ImportAccountCard } from './ImportAccountCard';

/** Группа «Будет создано» (§5.3 п. 4, §5.8): кнопка с aria-expanded и счётчиком в имени, по умолчанию свёрнута. */
function CreateGroupView({ group }: { group: CreateGroup }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="border-b border-field py-1 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-medium focus-visible:outline-2 focus-visible:outline-focus"
      >
        {group.title}: {formatCount(group.total)}
        <span aria-hidden="true" className="text-muted">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div id={listId} className="pb-2 text-sm">
          {group.sections.map((s) => (
            <div key={s.title ?? ''} className="mb-1">
              {s.title && <p className="mt-1 text-xs font-semibold text-muted">{s.title}</p>}
              <ul>
                {s.items.map((i) => (
                  <li key={i.name} className="[overflow-wrap:anywhere]">
                    {i.name}
                    {i.note && <span className="text-muted"> · {i.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {group.more > 0 && <p className="text-muted">и ещё {formatCount(group.more)}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Предпросмотр (§5.3 спецификации импорта) сверху вниз: итог (`h3` «Проверка файла», фокус на нём после проверки),
 * ошибки (`role="alert"`), «Счета из файла», «Будет создано», предупреждения.
 */
export function ImportPreviewView(props: {
  preview: ImportPreview;
  headingRef: Ref<HTMLHeadingElement>;
  accounts: readonly Account[];
  baseCurrency: string;
  onCardChange: (key: string, mapping: AccountMapping | null, error: string | null) => void;
}) {
  const p = props.preview;
  const groups = createGroups(p);
  return (
    <div className="grid gap-4">
      <section className="grid gap-1">
        <h3 ref={props.headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          Проверка файла
        </h3>
        <p className="text-sm">{checkSummary(p)}</p>
        <p className="text-sm font-semibold">Будет добавлено: {formatCount(p.counts.add)}</p>
        {p.duplicates.count > 0 && (
          <p className="text-sm">
            Дубликаты: {formatCount(p.duplicates.count)} — уже есть в компании, будут пропущены ({issueRowsText({ count: p.duplicates.count, rows: p.duplicates.rows })})
          </p>
        )}
        {p.counts.skippedFuture > 0 && <p className="text-sm">Плановые: {formatCount(p.counts.skippedFuture)} — пропущены</p>}
      </section>

      {p.errors.total > 0 && (
        <div role="alert" className={`${alertClass} mb-0`}>
          <p className="font-semibold">Найдено ошибок: {formatCount(p.errors.total)}. Исправьте файл и загрузите его снова</p>
          <ul className="mt-1 list-disc pl-5">
            {p.errors.byCode.map((g) => (
              <li key={`${g.code}-${g.message}`} className="[overflow-wrap:anywhere]">
                {issueText(g)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="grid gap-3">
        <h3 className="font-semibold">Счета из файла</h3>
        {p.accounts.map((card) => (
          <ImportAccountCard key={card.key} card={card} accounts={props.accounts} baseCurrency={props.baseCurrency} onChange={props.onCardChange} />
        ))}
      </section>

      {groups.length > 0 && (
        <section>
          <h3 className="font-semibold">Будет создано</h3>
          {groups.map((g) => (
            <CreateGroupView key={g.key} group={g} />
          ))}
        </section>
      )}

      {p.warnings.length > 0 && (
        <section>
          <h3 className="font-semibold">Предупреждения</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {p.warnings.map((g) => (
              <li key={`${g.code}-${g.message}`} className="[overflow-wrap:anywhere]">
                {issueText(g)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Панель**

Создайте `src/client/components/import/ImportPanel.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AccountMapping, ImportCommitResult, ImportPreview } from '../../../shared/schemas/imports';
import { ApiError } from '../../lib/api';
import { formatFileSize, isFileDrag } from '../../lib/attachments';
import {
  blockReason,
  checkStatus,
  commitImport,
  doneText,
  IMPORT_ACCEPT,
  IMPORT_TEMPLATE_HREF,
  importSizeError,
  invalidateAfterImport,
  isImportPreview,
  needsRemembered,
  previewImport,
  PREVIEW_DEBOUNCE_MS,
  requestMappings,
  uploadImport,
} from '../../lib/import-panel';
import { useAccounts, type Company } from '../../lib/queries';
import { Drawer } from '../Drawer';
import { DownloadIcon, FolderIcon } from '../icons';
import { alertClass, btnPrimary, btnSecondary } from '../ui';
import { ImportPreviewView } from './ImportPreviewView';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'fileError'; message: string }
  | { kind: 'preview'; preview: ImportPreview }
  | { kind: 'done'; result: ImportCommitResult };

/** 410 (кэш вытеснен, сервер перезапущен): файл проверяется заново сам (§5.6). */
const EXPIRED_NOTICE = 'Проверка устарела — файл проверен заново. Проверьте итог и нажмите «Импортировать» ещё раз';

/** Текст ошибки запроса: у файла — сообщение F* или «Нет файла», остальное — сообщение сервера. */
function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  return e.fields?.file ?? e.message;
}

const expired = (e: unknown) => e instanceof ApiError && e.code === 'IMPORT_EXPIRED';

const OpenImportContext = createContext<(() => void) | null>(null);

/** Открыть панель импорта; null — импорт недоступен (архивная компания) или вне раскладки компании. */
export function useOpenImport(): (() => void) | null {
  return useContext(OpenImportContext);
}

/**
 * Одна панель импорта на компанию — в раскладке компании (CompanyLayout), а не в журнале или нижней панели: переход
 * по истории браузера, смена ширины окна или скрытие нижней панели не размонтируют её, пока идёт запись (решение 18
 * плана И-2). Открывают её «Импортировать» в тулбаре журнала и «Импорт из Excel» в «Ещё» на телефоне.
 */
export function ImportPanelHost({ company, children }: { company: Company; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  // в архивную компанию импорт запрещён (§1.2 спецификации импорта): ни кнопки, ни пункта, ни панели
  const canImport = company.archivedAt === null;
  return (
    <OpenImportContext.Provider value={canImport ? show : null}>
      {children}
      {canImport && <ImportPanel company={company} open={open} onClose={() => setOpen(false)} />}
    </OpenImportContext.Provider>
  );
}

/**
 * Правая панель «Импорт из Excel» (§5 спецификации импорта). 480 px на компьютере, на телефоне — на весь экран; пока
 * идёт запись, панель не закрывается (Drawer.busy). Содержимое (и состояние) монтируется заново при каждом открытии;
 * подвал с «Импортировать» — в закреплённом низу панели (портал в слот `footer`).
 */
export function ImportPanel({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <Drawer open={open} side="right" wide title="Импорт из Excel" onClose={onClose} busy={busy} footer={<div ref={setFooter} />}>
      <ImportFlow company={company} footer={footer} onBusy={setBusy} onDone={onClose} />
    </Drawer>
  );
}

function ImportFlow(props: { company: Company; footer: HTMLDivElement | null; onBusy: (busy: boolean) => void; onDone: () => void }) {
  const cid = props.company.id;
  const accounts = useAccounts(cid);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  /** Карточки с неверной суммой: ключ → название из файла. */
  const [invalid, setInvalid] = useState<ReadonlyMap<string, string>>(new Map());
  /** Выбор человека по ключу счёта: переживает «Выбрать другой файл» (§5.4). */
  const choices = useRef(new Map<string, AccountMapping>());
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Номер последнего запроса предпросмотра: ответ устаревшего не показывается. */
  const seq = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ n: number; to: 'heading' | 'done' } | null>(null);
  const reasonId = useId();
  const hintId = useId();
  const preview = phase.kind === 'preview' ? phase.preview : null;

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!focusTarget) return;
    (focusTarget.to === 'heading' ? headingRef : doneRef).current?.focus();
  }, [focusTarget]);

  const show = (p: ImportPreview, focus: boolean) => {
    setPhase({ kind: 'preview', preview: p });
    setStatus(checkStatus(p));
    if (focus) setFocusTarget((f) => ({ n: (f?.n ?? 0) + 1, to: 'heading' }));
  };

  /** Загрузка и проверка; выбор счетов из прошлого файла применяется сразу (§5.4). */
  const check = async (f: File, after?: string) => {
    const n = ++seq.current;
    clearTimeout(timer.current);
    setRefreshing(false);
    setPhase({ kind: 'checking' });
    setStatus('Проверяем файл…');
    try {
      let p = await uploadImport(cid, f);
      if (after || needsRemembered(p, choices.current)) p = await previewImport(cid, p.token, requestMappings(p, choices.current));
      if (n !== seq.current) return;
      show(p, true);
      setNotice(after ?? null);
    } catch (e) {
      if (n !== seq.current) return;
      const message = errorText(e);
      setPhase({ kind: 'fileError', message });
      setStatus(message);
    }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    const tooBig = importSizeError(f.size);
    setNotice(null);
    setInvalid(new Map());
    if (tooBig) {
      // файл не загружается: прежний выбор остаётся
      setSizeError(tooBig);
      setStatus(tooBig);
      return;
    }
    setSizeError(null);
    setFile(f);
    void check(f);
  };

  /** Пересчёт по кэшу с текущим сопоставлением (n — номер правки); 410 — файл проверяется заново. */
  const refresh = async (base: ImportPreview, n: number) => {
    try {
      const p = await previewImport(cid, base.token, requestMappings(base, choices.current));
      if (n !== seq.current) return;
      show(p, false);
      setRefreshing(false);
    } catch (e) {
      if (n !== seq.current) return;
      setRefreshing(false);
      if (expired(e) && file) void check(file, EXPIRED_NOTICE);
      else setNotice(errorText(e));
    }
  };

  const onCardChange = (key: string, mapping: AccountMapping | null, error: string | null) => {
    setNotice(null);
    setInvalid((prev) => {
      const next = new Map(prev);
      if (error) next.set(key, preview?.accounts.find((a) => a.key === key)?.fileName ?? key);
      else next.delete(key);
      return next;
    });
    if (mapping) choices.current.set(key, mapping);
    else choices.current.delete(key);
    clearTimeout(timer.current);
    // номер — с момента правки: ответ более раннего пересчёта уже устарел и не показывается
    const n = ++seq.current;
    if (error || !preview) {
      setRefreshing(false);
      return;
    }
    // до ответа «Импортировать» недоступна (§5.3)
    setRefreshing(true);
    const base = preview;
    timer.current = setTimeout(() => void refresh(base, n), PREVIEW_DEBOUNCE_MS);
  };

  const reason = preview ? blockReason(preview, { refreshing, invalidCards: [...invalid.values()] }) : null;

  const commit = async () => {
    if (!preview || reason || committing) return;
    setCommitting(true);
    props.onBusy(true);
    setNotice(null);
    setStatus('Импортируем…');
    try {
      const result = await commitImport(cid, preview, requestMappings(preview, choices.current));
      setPhase({ kind: 'done', result });
      setStatus(doneText(result));
      setFocusTarget((f) => ({ n: (f?.n ?? 0) + 1, to: 'done' }));
      void invalidateAfterImport(cid);
    } catch (e) {
      const fresh = e instanceof ApiError ? e.details?.preview : undefined;
      if (e instanceof ApiError && (e.code === 'IMPORT_CHANGED' || e.code === 'IMPORT_INVALID') && isImportPreview(fresh)) {
        // за время проверки данные изменились: свежий предпросмотр и новое нажатие (§5.6)
        show(fresh, false);
        setNotice(e.message);
      } else if (expired(e) && file) {
        void check(file, EXPIRED_NOTICE);
      } else {
        setNotice(errorText(e));
        setStatus(errorText(e));
      }
    } finally {
      setCommitting(false);
      props.onBusy(false);
    }
  };

  const pick = () => inputRef.current?.click();
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={IMPORT_ACCEPT}
      data-import-file=""
      tabIndex={-1}
      aria-hidden="true"
      className="hidden"
      onChange={(e) => {
        choose(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  const footerContent =
    phase.kind === 'done' ? (
      <button type="button" onClick={props.onDone} className={`${btnPrimary} h-12 w-full`}>
        Готово
      </button>
    ) : (
      <div className="grid gap-2">
        {notice && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {notice}
          </p>
        )}
        {(() => {
          const why = committing
            ? null
            : preview
              ? reason
              : phase.kind === 'checking'
                ? 'Проверяем файл…'
                : phase.kind === 'fileError'
                  ? 'Выберите другой файл'
                  : 'Выберите файл';
          const disabled = committing || why !== null;
          return (
            <>
              <button
                type="button"
                aria-disabled={disabled || undefined}
                aria-describedby={why ? reasonId : undefined}
                onClick={() => void commit()}
                className={`${btnPrimary} h-12 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
              >
                {committing ? 'Импортируем…' : 'Импортировать'}
              </button>
              {why && (
                <p id={reasonId} className="text-center text-sm text-muted">
                  {why}
                </p>
              )}
            </>
          );
        })()}
      </div>
    );

  return (
    <div className="grid gap-4">
      {fileInput}
      <p role="status" className="sr-only">
        {status}
      </p>
      {phase.kind === 'done' ? (
        <section className="grid gap-2">
          <h3 ref={doneRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            Импорт завершён
          </h3>
          <p>{doneText(phase.result)}</p>
        </section>
      ) : (
        <>
          {file === null ? (
            <div
              data-drop-zone=""
              onDragOver={(e) => {
                if (!isFileDrag([...e.dataTransfer.types])) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                setDragging(false);
                if (!isFileDrag([...e.dataTransfer.types])) return;
                e.preventDefault();
                choose(e.dataTransfer.files[0]);
              }}
              className={`grid justify-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${dragging ? 'border-income bg-income-soft' : 'border-field'}`}
            >
              <span className="text-income-strong">
                <FolderIcon />
              </span>
              <p className="font-semibold [@media(pointer:coarse)]:hidden">Перетяните сюда файл (до 30 МБ)</p>
              <p className="text-sm text-muted [@media(pointer:coarse)]:hidden">или</p>
              <button type="button" onClick={pick} aria-describedby={hintId} className={`${btnSecondary} max-md:h-11 max-md:w-full`}>
                Выберите файл
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-field px-3 py-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium">{file.name}</span> <span className="text-sm text-muted">· {formatFileSize(file.size)}</span>
              </span>
              <button type="button" onClick={() => !committing && pick()} aria-disabled={committing || undefined} className={`${btnSecondary} max-md:h-11 max-md:w-full`}>
                Выбрать другой файл
              </button>
            </div>
          )}
          {sizeError && (
            <p role="alert" className="text-sm text-expense-strong">
              {sizeError}
            </p>
          )}
          <a href={IMPORT_TEMPLATE_HREF} download className="flex min-h-11 items-center gap-2 rounded-xl border border-field px-3 text-sm font-medium hover:bg-field">
            <DownloadIcon />
            Скачать шаблон
          </a>
          <p id={hintId} className="text-sm text-muted">
            Формат — как выгрузка Finmap «Excel» или шаблон: .xlsx или .csv. Импортируется первый лист
          </p>
          {phase.kind === 'checking' && <p className="text-sm text-muted">Проверяем файл…</p>}
          {phase.kind === 'fileError' && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {phase.message}
            </p>
          )}
          {preview && (
            <ImportPreviewView
              preview={preview}
              headingRef={headingRef}
              accounts={accounts.data ?? []}
              baseCurrency={props.company.baseCurrency}
              onCardChange={onCardChange}
            />
          )}
        </>
      )}
      {props.footer && createPortal(footerContent, props.footer)}
    </div>
  );
}
```

- [ ] **Step 6: Кнопка «Импортировать» в тулбаре журнала**

В `src/client/components/journal/JournalToolbar.tsx` замените

```tsx
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalExportHref, SEARCH_MAX, type JournalUrlState } from '../../lib/journal-filter';
import { RefreshIcon, SearchIcon } from '../icons';
import { inputClass } from '../ui';
import { MoreMenu } from './MoreMenu';
```

на

```tsx
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalExportHref, SEARCH_MAX, type JournalUrlState } from '../../lib/journal-filter';
import { RefreshIcon, SearchIcon, UploadIcon } from '../icons';
import { inputClass } from '../ui';
import { MoreMenu } from './MoreMenu';
```

В `src/client/components/journal/JournalToolbar.tsx` замените

```tsx
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, и «Ещё ▾» (сумма, ⟳, колонки, выгрузка).
 * На телефоне (`mobile`, §8.5) — «Поиск», ⟳ и воронка «Фильтр · N | ▾»: период, сумма, сортировка и выгрузка — в окне
 * «Фильтры», оно открывается воронкой сразу.
```

на

```tsx
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, «Ещё ▾» (сумма, ⟳, колонки, выгрузка) и ⤒ «Импортировать» (спецификация импорта, §5.1).
 * На телефоне (`mobile`, §8.5) — «Поиск», ⟳ и воронка «Фильтр · N | ▾»: период, сумма, сортировка и выгрузка — в окне
 * «Фильтры», оно открывается воронкой сразу.
```

В `src/client/components/journal/JournalToolbar.tsx` замените

```tsx
  onPrefError?: (text: string) => void;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
```

на

```tsx
  onPrefError?: (text: string) => void;
  mobile?: boolean;
  /** ⤒ «Импортировать» — последняя кнопка тулбара (§5.1 спецификации импорта); нет — кнопки нет (архивная компания). */
  onImport?: () => void;
}) {
  const { state, onChange } = props;
```

В `src/client/components/journal/JournalToolbar.tsx` замените

```tsx
        onPrefError={props.onPrefError}
      />
    </div>
  );
```

на

```tsx
        onPrefError={props.onPrefError}
      />
      {props.onImport && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={props.onImport}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-field px-3 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <UploadIcon />
          Импортировать
        </button>
      )}
    </div>
  );
```

В `src/client/pages/JournalPage.tsx` замените

```tsx
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { useOpenOperationForm } from '../components/operation/OperationFormHost';
```

на

```tsx
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { useOpenImport } from '../components/import/ImportPanel';
import { LoadMore } from '../components/journal/LoadMore';
import { useOpenOperationForm } from '../components/operation/OperationFormHost';
```

В `src/client/pages/JournalPage.tsx` замените

```tsx
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  const openForm = useOpenOperationForm();
  const savedFilters = useSavedFilters(company.id);
```

на

```tsx
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  // панель импорта живёт в раскладке компании (ImportPanelHost); null — архивная компания
  const openImport = useOpenImport();
  const openForm = useOpenOperationForm();
  const savedFilters = useSavedFilters(company.id);
```

В `src/client/pages/JournalPage.tsx` замените

```tsx
        // колонки и «Показывать полностью» не сохранились, а «Ещё» уже закрыт — ошибку видно на странице
        onPrefError={setActionError}
      />
      <FilterDialog
```

на

```tsx
        // колонки и «Показывать полностью» не сохранились, а «Ещё» уже закрыт — ошибку видно на странице
        onPrefError={setActionError}
        // в архивную компанию импорт запрещён (§1.2 спецификации импорта): кнопки нет
        onImport={openImport ?? undefined}
      />
      <FilterDialog
```

Одна панель импорта на компанию — в раскладке компании (решение 18):

В `src/client/pages/CompanyLayout.tsx` замените

```tsx
import { CompanyBlockButton } from '../components/CompaniesDrawer';
import { HistoryButton } from '../components/HistoryDrawer';
import { LoadError } from '../components/LoadError';
import { MobileTabBar } from '../components/MobileTabBar';
```

на

```tsx
import { CompanyBlockButton } from '../components/CompaniesDrawer';
import { HistoryButton } from '../components/HistoryDrawer';
import { ImportPanelHost } from '../components/import/ImportPanel';
import { LoadError } from '../components/LoadError';
import { MobileTabBar } from '../components/MobileTabBar';
```

В `src/client/pages/CompanyLayout.tsx` замените

```tsx
  return (
    <OperationFormHost company={company}>
      <div className="min-h-dvh bg-chrome">
        <AppHeader
          // в зоне настроек панель счетов не нужна (§8.6)
          menuButton={inSettings ? undefined : <AccountsDrawerButton company={company} />}
          company={<CompanyBlockButton current={company} companies={companies.data} />}
          // архивная компания — только чтение: кнопок новых операций нет ни на компьютере, ни на телефоне
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
          tools={<HistoryButton company={company} />}
          menu={{ companyId: company.id, companyName: company.name }}
        />
        <div className="flex items-start gap-4 md:mx-4">
          {inSettings ? (
            <Outlet context={{ company } satisfies CompanyOutletContext} />
          ) : (
            <>
              <AccountsPanel company={company} />
              <main className={mainCardClass}>
                <nav className="mb-6 flex gap-2 max-md:hidden">
                  <NavLink to={`/c/${company.id}/log`} className={tab}>
                    Журнал
                  </NavLink>
                </nav>
                <Outlet context={{ company } satisfies CompanyOutletContext} />
              </main>
            </>
          )}
        </div>
        <MobileTabBar company={company} />
      </div>
    </OperationFormHost>
  );
```

на

```tsx
  return (
    <OperationFormHost company={company}>
      <ImportPanelHost company={company}>
        <div className="min-h-dvh bg-chrome">
          <AppHeader
            // в зоне настроек панель счетов не нужна (§8.6)
            menuButton={inSettings ? undefined : <AccountsDrawerButton company={company} />}
            company={<CompanyBlockButton current={company} companies={companies.data} />}
            // архивная компания — только чтение: кнопок новых операций нет ни на компьютере, ни на телефоне
            actions={company.archivedAt ? undefined : <NewOperationButtons />}
            tools={<HistoryButton company={company} />}
            menu={{ companyId: company.id, companyName: company.name }}
          />
          <div className="flex items-start gap-4 md:mx-4">
            {inSettings ? (
              <Outlet context={{ company } satisfies CompanyOutletContext} />
            ) : (
              <>
                <AccountsPanel company={company} />
                <main className={mainCardClass}>
                  <nav className="mb-6 flex gap-2 max-md:hidden">
                    <NavLink to={`/c/${company.id}/log`} className={tab}>
                      Журнал
                    </NavLink>
                  </nav>
                  <Outlet context={{ company } satisfies CompanyOutletContext} />
                </main>
              </>
            )}
          </div>
          <MobileTabBar company={company} />
        </div>
      </ImportPanelHost>
    </OperationFormHost>
  );
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npx playwright test e2e/import.spec.ts`
Expected: 6 passed.

Run: `npm test`
Expected: 997 пройдено и 1 пропущен.

Run: `npm run test:e2e` — два раза подряд.
Expected: оба раза 148 из 148.

- [ ] **Step 8: Commit**

```bash
git add src/client/components/import/ImportAccountCard.tsx src/client/components/import/ImportPreviewView.tsx src/client/components/import/ImportPanel.tsx src/client/components/journal/JournalToolbar.tsx src/client/pages/JournalPage.tsx src/client/pages/CompanyLayout.tsx e2e/import.spec.ts
git commit -m "feat: импорт — панель «Импорт из Excel»: файл, шаблон, проверка, счета из файла, «Импортировать», 409 и 410" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Телефон — «Импорт из Excel» в «Ещё»; «Импорт» в истории действий (§5.1, §5.7, §6.5)

**Files:**
- Modify: `src/client/components/MobileTabBar.tsx`, `src/client/lib/audit-format.ts`
- Test: `e2e/mobile.spec.ts`, `tests/client/audit-format.test.ts`

**Interfaces:**
- Consumes: задача 4 — `useOpenImport()` (панель живёт в `ImportPanelHost` раскладки компании); `Drawer.wide` (на телефоне — на весь экран).
- Produces:
  - пункт «Импорт из Excel» в меню «Ещё» нижней панели — последним, после «История действий»; в архивной компании пункта нет; закрытие панели возвращает фокус на «Ещё»;
  - `ENTITY_LABELS.import = 'Импорт'`, `'import'` в `COMPANY_ENTITIES` (фильтр страницы «История действий»).

- [ ] **Step 1: Write the failing tests**

В `tests/client/audit-format.test.ts` замените

```ts
  it('у каждой сущности фильтров есть подпись; операции, курсы и вложения — в своих лентах', () => {
    for (const e of [...COMPANY_ENTITIES, ...SYSTEM_ENTITIES]) expect(ENTITY_LABELS[e]).toBeTruthy();
    expect(ENTITY_LABELS).toMatchObject({ operation: 'Операция', rate: 'Курс', fixed_rate: 'Фиксированный курс', attachment: 'Вложение' });
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment']));
    expect(SYSTEM_ENTITIES).toEqual(['user', 'rate']);
  });
```

на

```ts
  it('у каждой сущности фильтров есть подпись; операции, курсы и вложения — в своих лентах', () => {
    for (const e of [...COMPANY_ENTITIES, ...SYSTEM_ENTITIES]) expect(ENTITY_LABELS[e]).toBeTruthy();
    expect(ENTITY_LABELS).toMatchObject({ operation: 'Операция', rate: 'Курс', fixed_rate: 'Фиксированный курс', attachment: 'Вложение', import: 'Импорт' });
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment', 'import']));
    expect(SYSTEM_ENTITIES).toEqual(['user', 'rate']);
  });
```

В `e2e/mobile.spec.ts` замените

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page) {
```

на

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { excelSerial, finmapLikeRow, finmapLikeXlsx } from '../tests/helpers/finmap-like';

async function login(page: Page) {
```

В `e2e/mobile.spec.ts` замените

```ts
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
```

на

```ts
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeFocused();
  await page.keyboard.press('Tab');
  // последний пункт — «Импорт из Excel» (§5.1 спецификации импорта)
  await expect(menu.getByRole('button', { name: 'Импорт из Excel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
```

В `e2e/mobile.spec.ts` замените

```ts
  await page.mouse.up();
});

```

на

```ts
  await page.mouse.up();
});

test('«Ещё» → «Импорт из Excel» (§5.1, §5.7 спецификации импорта): панель на весь экран, «Выберите файл» во всю ширину, суммы с цифровой клавиатурой, без прокрутки вбок; закрыли — фокус на «Ещё»; в архивной компании пункта нет', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = (await apiPost(page, '/api/v1/companies', { name: `ТОО Импорт телефон ${Date.now()}` })).company.id as number;
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.goto(`/c/${cid}/log`);
  const tabs = page.getByRole('navigation', { name: 'Разделы', exact: true });
  const more = tabs.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  // на телефоне в тулбаре журнала кнопки нет — вход через «Ещё»
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toHaveCount(0);
  await more.click();
  await menu.getByRole('button', { name: 'Импорт из Excel' }).click();
  const panel = page.getByRole('dialog', { name: 'Импорт из Excel' });
  await expect(panel).toBeVisible();
  // панель выезжает справа (200 мс): ждём, пока встанет на место
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(0);
  expect(Math.round((await panel.boundingBox())!.width)).toBe(PHONE.width);
  const pick = (await panel.getByRole('button', { name: 'Выберите файл' }).boundingBox())!;
  expect(pick.height).toBeGreaterThanOrEqual(44);
  // во всю ширину зоны файла (отступы панели и зоны — по 16 px)
  expect(pick.width).toBeGreaterThan(PHONE.width - 80);

  await panel.locator('[data-import-file]').setInputFiles({
    name: 'выгрузка.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: finmapLikeXlsx([
      finmapLikeRow({ paidAt: excelSerial('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
      finmapLikeRow({ paidAt: excelSerial('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк с очень длинным названием для проверки ширины', comment: 'x' }),
    ]),
  });
  await expect(panel.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  const bank = panel.getByRole('article', { name: /^Банк с очень длинным/ });
  await expect(bank.getByLabel('Текущий остаток, ₸')).toHaveAttribute('inputmode', 'decimal');
  // «Импортировать» — в закреплённом низу панели, внутри экрана
  const go = (await panel.getByRole('button', { name: 'Импортировать' }).boundingBox())!;
  expect(go.y + go.height).toBeLessThanOrEqual(PHONE.height);
  expect(go.width).toBeGreaterThan(PHONE.width - 64);
  await expectNoSideScroll(page, 'панель импорта');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();

  // архивная компания: пункта «Импорт из Excel» нет
  const archived = (await apiPost(page, '/api/v1/companies', { name: `ТОО Импорт архив ${Date.now()}` })).company.id as number;
  await apiPost(page, `/api/v1/companies/${archived}/archive`, {});
  await page.goto(`/c/${archived}/log`);
  await more.click();
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Импорт из Excel' })).toHaveCount(0);
});

```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: FAIL — у `ENTITY_LABELS` нет `import`.

Run: `npx playwright test e2e/mobile.spec.ts -g "Импорт из Excel|меню «Ещё»"`
Expected: FAIL — в «Ещё» нет пункта «Импорт из Excel».

- [ ] **Step 3: Пункт «Импорт из Excel» и «Импорт» в истории**

В `src/client/components/MobileTabBar.tsx` замените

```tsx
import type { Company } from '../lib/queries';
import { HistoryPanel } from './HistoryDrawer';
import { Popover } from './Popover';

```

на

```tsx
import type { Company } from '../lib/queries';
import { HistoryPanel } from './HistoryDrawer';
import { useOpenImport } from './import/ImportPanel';
import { Popover } from './Popover';

```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Пользователи», «Настройки»
 * (экран списка разделов, §8.6) и «История действий» (панель §3.4). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
 * фокус на `<h1>` новой страницы; закрытие истории возвращает фокус на «Ещё». На компьютере панели нет.
```

на

```tsx
/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Пользователи», «Настройки»
 * (экран списка разделов, §8.6), «История действий» (панель §3.4) и «Импорт из Excel» (панель импорта на весь экран,
 * §5.1 спецификации импорта; в архивной компании пункта нет). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
 * фокус на `<h1>` новой страницы; закрытие истории возвращает фокус на «Ещё». На компьютере панели нет.
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
    if (!mobile) setHistory(false);
  }, [mobile]);
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
```

на

```tsx
    if (!mobile) setHistory(false);
  }, [mobile]);
  // в архивную компанию импорт запрещён (§1.2 спецификации импорта): пункта нет. Панель — в раскладке компании
  const openImport = useOpenImport();
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
                </button>
              </li>
            </ul>
          )}
```

на

```tsx
                </button>
              </li>
              {openImport && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      // фокус сначала на «Ещё»: панель импорта вернёт его туда при закрытии (§5.1 спецификации импорта)
                      close(true);
                      openImport();
                    }}
                    className={itemClass}
                  >
                    Импорт из Excel
                  </button>
                </li>
              )}
            </ul>
          )}
```

В `src/client/lib/audit-format.ts` замените

```ts
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
};

```

на

```ts
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
  import: 'Импорт',
};

```

В `src/client/lib/audit-format.ts` замените

```ts
  'fixed_rate',
  'attachment',
] as const;

```

на

```ts
  'fixed_rate',
  'attachment',
  'import',
] as const;

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/audit-format.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/mobile.spec.ts -g "Импорт из Excel|меню «Ещё»"`
Expected: 2 passed.

Run: `npm test`
Expected: 997 пройдено и 1 пропущен.

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e` — два раза подряд.
Expected: оба раза 149 из 149.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/MobileTabBar.tsx src/client/lib/audit-format.ts tests/client/audit-format.test.ts e2e/mobile.spec.ts
git commit -m "feat: импорт — «Импорт из Excel» в «Ещё» на телефоне; «Импорт» в истории действий" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Сверка `import:check` и README «Импорт из Finmap» (§12, §13)

**Files:**
- Create: `scripts/lib/import-check.ts`, `scripts/import-check.ts`
- Modify: `package.json`, `.gitignore`, `README.md`
- Test: `tests/server/import-check.test.ts`

**Interfaces:**
- Consumes:
  - И-1: `readImportFile(data, name)`, `parseSheet(sheet, ctx)`, `decimalToMinor(value, minorUnits)`, `nameKey`, `systemKeyOf`;
  - задача 2: `POST …/imports` — в тесте.
- Produces:
  - `scripts/lib/import-check.ts`: `interface CheckLine { what; file; db; currency }`, `interface CheckReport { company; fileName; today; rows; counts; accounts; categories; notes; mismatches }`, `checkImport(input: { sqlite; companyId; data; fileName; timezone; today }): CheckReport`, `formatReport(r): string[]`;
  - `npm run import:check -- <файл> <id компании> [--today ГГГГ-ММ-ДД]` — база только на чтение и закрывается и после ошибки, «сегодня» разбора печатается; выход 0 «Совпадает» и 1 «Расхождений: N» или ошибка;
  - `.gitignore`: `*.import-local.*`;
  - README: «Что уже работает» — импорт; раздел «Импорт из Finmap» (шаги §12 без реальных данных); команды `import:check` и `bench:import`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-check.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { checkImport, formatReport } from '../../scripts/lib/import-check';
import type { ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

/** Синтетический файл: доходы и расходы по «Кассе», перевод на новый «Банк-2», зарплата с подкатегорией, строка без категории, плановая строка. */
const ROWS = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-09-21', '10:00:00'), amount: 1000, to: 'Касса' }),
  fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы', counterparty: 'Сотрудник А' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2026-10-05', '00:30:00'), amount: 8200.5, from: 'Банк-2', category: 'Связь' }),
  fr({ paidAt: at('2026-12-01', '10:00:00'), amount: 1, to: 'Касса', category: 'Бар' }),
];
const CTX = { timezone: 'Asia/Almaty', today: '2026-10-06', fileName: 'выгрузка.xlsx' };

async function importFile(rows = ROWS): Promise<void> {
  const up = await w.h.t.app.inject({
    method: 'POST',
    url: `/api/v1/companies/${w.cid}/imports/upload`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
  const p = up.json() as ImportPreview;
  const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/imports`, { token: p.token, accounts: [], revision: p.revision });
  expect(res.statusCode, res.body).toBe(201);
}

describe('сверка импорта npm run import:check (§12 спецификации импорта)', () => {
  it('после импорта — «Совпадает»: число операций, движение счетов и итоги по категориям; плановая строка не считается', async () => {
    w = await opsWorld();
    await importFile();
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(ROWS), ...CTX });
    expect(r.today).toBe('2026-10-06');
    expect(r.rows).toEqual({ total: 6, future: 1, errors: 0 });
    expect(r.counts).toEqual([
      { what: 'доходы', file: 2, db: 2, currency: null },
      { what: 'расходы', file: 2, db: 2, currency: null },
      { what: 'переводы', file: 1, db: 1, currency: null },
    ]);
    expect(r.accounts).toEqual([
      { what: 'Касса, KZT', file: 1_159_600 - 850_000 - 5_000_000, db: 1_159_600 - 850_000 - 5_000_000, currency: 'KZT' },
      { what: 'Банк-2, KZT', file: 5_000_000 - 820_050, db: 5_000_000 - 820_050, currency: 'KZT' },
    ]);
    expect(r.categories.map((l) => [l.what, l.file, l.db])).toEqual([
      ['Доходы: Бар', 1_059_600, 1_059_600],
      ['Доходы: Без категории', 100_000, 100_000],
      ['Расходы: Зарплата → Администраторы', -850_000, -850_000],
      ['Расходы: Связь', -820_050, -820_050],
    ]);
    expect(r.notes).toEqual([]);
    expect(r.mismatches).toBe(0);
    expect(formatReport(r).at(-1)).toBe('Итог: Совпадает');
    expect(formatReport(r)[1]).toBe('Сегодня для разбора: 06.10.2026 — строки с датой платежа позже пропущены как плановые (--today ГГГГ-ММ-ДД — другая дата)');
    // другая «сегодня»: декабрьская строка уже не плановая — в файле на одну строку больше, чем в базе
    const later = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(ROWS), ...CTX, today: '2026-12-31' });
    expect(later.rows.future).toBe(0);
    expect(later.counts[0]).toEqual({ what: 'доходы', file: 3, db: 2, currency: null });
  });

  it('одноимённые подкатегории разных родителей: одна строка сверки, в подписи — оба родителя', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 100, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы' }),
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 200, from: 'Касса', category: 'Офис', subcategory: 'Администраторы' }),
    ];
    await importFile(rows);
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(rows), ...CTX });
    expect(r.categories).toEqual([{ what: 'Расходы: Зарплата → Администраторы + Офис → Администраторы', file: -30_000, db: -30_000, currency: 'KZT' }]);
    expect(r.mismatches).toBe(0);
    const text = formatReport(r);
    // длинная подпись не обрезается: числа — строкой ниже
    expect(text).toContain('  Расходы: Зарплата → Администраторы + Офис → Администраторы');
  });

  it('операция, добавленная после импорта, — расхождения по счёту и категории; строка с неизвестным счётом — предупреждение', async () => {
    w = await opsWorld();
    await importFile();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 777, lines: [{ categoryId: w.income, projectId: null, amount: 777 }] });
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx([...ROWS, fr({ paidAt: at('2026-10-01'), amount: 5, to: 'Сейф' })]), ...CTX });
    // «Касса» и «Доходы: Бар»; число доходов совпало случайно (строка «Сейфа» в файле, лишняя операция в базе)
    expect(r.mismatches).toBe(2);
    expect(r.counts[0]).toEqual({ what: 'доходы', file: 3, db: 3, currency: null });
    expect(r.accounts[0]).toMatchObject({ what: 'Касса, KZT', db: r.accounts[0]!.file + 777 });
    expect(r.notes).toEqual(['Нет счёта в компании для: Сейф — их строки не сверялись']);
    const text = formatReport(r);
    expect(text.at(-1)).toBe('Итог: Расхождений: 2');
    expect(text.some((l) => l.startsWith('≠ Доходы: Бар'))).toBe(true);
  });

  it('ошибка файла — тем же текстом, что в панели; нет компании — понятная ошибка', async () => {
    w = await opsWorld();
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: Buffer.from('%PDF-1.4'), ...CTX, fileName: 'отчёт.pdf' })).toThrow('Нужен файл .xlsx или .csv');
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: 999_999, data: finmapLikeXlsx(ROWS), ...CTX })).toThrow('Компании с id 999999 нет');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-check.test.ts`
Expected: FAIL — модуль `scripts/lib/import-check` не найден.

- [ ] **Step 3: Сверка**

Создайте `scripts/lib/import-check.ts`:

```ts
import { getCurrency, isKnownCurrency } from '../../src/shared/currencies';
import { formatDateRu } from '../../src/shared/dates';
import { nameKey, systemKeyOf } from '../../src/shared/finmap-format';
import { formatAmount } from '../../src/shared/money';
import type { Sqlite } from '../../src/server/db/client';
import { decimalToMinor, parseSheet } from '../../src/server/modules/imports/parse-row';
import { readImportFile } from '../../src/server/modules/imports/read-file';

/**
 * Сверка импорта (§12 спецификации импорта): файл читается тем же разборщиком, а база — только запросами SELECT.
 * Движение счетов и итоги по категориям считаются по файлу независимо от кода записи и сравниваются с агрегатами
 * по неудалённым фактическим операциям компании. Плановые строки (дата в будущем) пропускаются, как при импорте;
 * дубликаты, пропущенные импортом, уже есть в компании — сверка их видит в базе.
 */

export interface CheckLine {
  /** Подпись строки: «доходы», «Касса, KZT», «Расходы: Зарплата → Администраторы». */
  what: string;
  file: number;
  db: number;
  /** Валюта сумм; null — это число операций. */
  currency: string | null;
}

export interface CheckReport {
  company: string;
  fileName: string;
  /** «Сегодня» разбора: строки позже — плановые и не считаются. */
  today: string;
  rows: { total: number; future: number; errors: number };
  counts: CheckLine[];
  accounts: CheckLine[];
  /** Итоги по категориям — в базовой валюте компании. */
  categories: CheckLine[];
  /** Что не сверялось и почему. */
  notes: string[];
  mismatches: number;
}

interface AccountRow {
  id: number;
  name: string;
  currency: string;
}

const units = (currency: string) => (isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2);
const KIND_TITLE = { income: 'Доходы', expense: 'Расходы' } as const;

/** Ключ итога по категории: системная — по systemKey, иначе по nameKey листа (подкатегории, а без неё — категории). */
function categoryKey(kind: 'income' | 'expense', leaf: string | null, systemKey: string | null): string {
  if (leaf === null) return `${kind}|—`;
  return systemKey ? `${kind}|sys:${systemKey}` : `${kind}|${nameKey(leaf)}`;
}

export function checkImport(input: { sqlite: Sqlite; companyId: number; data: Buffer; fileName: string; timezone: string; today: string }): CheckReport {
  const { sqlite, companyId } = input;
  const company = sqlite.prepare('SELECT name, base_currency AS base FROM companies WHERE id = ?').get(companyId) as { name: string; base: string } | undefined;
  if (!company) throw new Error(`Компании с id ${companyId} нет`);
  const parsed = parseSheet(readImportFile(input.data, input.fileName), { timezone: input.timezone, baseCurrency: company.base, today: input.today });
  const accounts = sqlite.prepare('SELECT id, name, currency FROM accounts WHERE company_id = ? ORDER BY order_index, id').all(companyId) as AccountRow[];
  const byKey = new Map<string, AccountRow>();
  for (const a of accounts) if (!byKey.has(nameKey(a.name))) byKey.set(nameKey(a.name), a);
  const notes: string[] = [];
  const missing = new Set<string>();

  // ——— файл
  const fileCounts = { income: 0, expense: 0, transfer: 0 };
  const fileMove = new Map<number, number>();
  /** Итоги по ключу листа; titles — подписи «Родитель → Подкатегория» всех строк с этим ключом. */
  const fileCats = new Map<string, { kind: 'income' | 'expense'; titles: Set<string>; sum: number }>();
  let crossSkipped = 0;
  let baseSkipped = 0;
  const move = (id: number, delta: number) => fileMove.set(id, (fileMove.get(id) ?? 0) + delta);
  for (const r of parsed.rows) {
    fileCounts[r.type]++;
    const acc = byKey.get(r.account.key);
    if (!acc) {
      missing.add(r.account.name);
      continue;
    }
    const amount = decimalToMinor(r.amount, units(acc.currency))?.minor ?? 0;
    move(acc.id, r.type === 'income' ? amount : -amount);
    if (r.type === 'transfer' && r.toAccount) {
      const to = byKey.get(r.toAccount.key);
      if (!to) missing.add(r.toAccount.name);
      else if (to.currency === acc.currency) move(to.id, amount);
      else if (to.currency === company.base && r.baseAmount !== null) move(to.id, r.baseAmount);
      else crossSkipped++;
      continue;
    }
    if (r.type === 'transfer') continue;
    // итоги по категориям — в валюте компании: у счёта в базовой валюте — сумма счёта, иначе «Сумма в валюте компании»
    const base = acc.currency === company.base ? amount : r.baseAmount;
    if (base === null) {
      baseSkipped++;
      continue;
    }
    const kind = r.type;
    const leaf = r.subcategory ?? r.category;
    const key = categoryKey(kind, leaf, r.subcategory ? null : r.category ? systemKeyOf(r.category, kind) : null);
    const c = fileCats.get(key) ?? { kind, titles: new Set<string>(), sum: 0 };
    c.titles.add(r.category ? (r.subcategory ? `${r.category} → ${r.subcategory}` : r.category) : 'Без категории');
    c.sum += kind === 'income' ? base : -base;
    fileCats.set(key, c);
  }
  if (missing.size) notes.push(`Нет счёта в компании для: ${[...missing].join(', ')} — их строки не сверялись`);
  if (crossSkipped) notes.push(`Переводов между валютами без суммы в валюте компании: ${crossSkipped} — сумма зачисления не сверялась`);
  if (baseSkipped) notes.push(`Строк на счетах не в валюте компании без «Суммы в валюте компании»: ${baseSkipped} — в итогах по категориям не учтены`);

  // ——— база: неудалённые фактические операции компании
  const live = "company_id = ? AND deleted_at IS NULL AND status = 'actual'";
  const dbCounts = Object.fromEntries(
    (sqlite.prepare(`SELECT type, COUNT(*) n FROM operations WHERE ${live} GROUP BY type`).all(companyId) as { type: string; n: number }[]).map((r) => [r.type, r.n]),
  );
  const dbMove = new Map<number, number>();
  const moves = sqlite
    .prepare(
      `SELECT account_id AS id, SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS m FROM operations WHERE ${live} GROUP BY account_id
       UNION ALL
       SELECT to_account_id AS id, SUM(to_amount) AS m FROM operations WHERE ${live} AND type = 'transfer' GROUP BY to_account_id`,
    )
    .all(companyId, companyId) as { id: number; m: number }[];
  for (const r of moves) dbMove.set(r.id, (dbMove.get(r.id) ?? 0) + r.m);
  const dbCats = new Map<string, { kind: 'income' | 'expense'; titles: Set<string>; sum: number }>();
  const lines = sqlite
    .prepare(
      `SELECT o.type AS kind, c.name AS name, c.system_key AS systemKey, p.name AS parent, SUM(l.base_amount) AS sum
         FROM operations o JOIN operation_lines l ON l.operation_id = o.id
         LEFT JOIN categories c ON c.id = l.category_id LEFT JOIN categories p ON p.id = c.parent_id
        WHERE o.company_id = ? AND o.deleted_at IS NULL AND o.status = 'actual' AND o.type <> 'transfer'
        GROUP BY o.type, l.category_id`,
    )
    .all(companyId) as { kind: 'income' | 'expense'; name: string | null; systemKey: string | null; parent: string | null; sum: number }[];
  for (const r of lines) {
    const key = categoryKey(r.kind, r.name, r.systemKey);
    const c = dbCats.get(key) ?? { kind: r.kind, titles: new Set<string>(), sum: 0 };
    c.titles.add(r.name === null ? 'Без категории' : r.parent ? `${r.parent} → ${r.name}` : r.name);
    c.sum += r.kind === 'income' ? r.sum : -r.sum;
    dbCats.set(key, c);
  }

  // ——— сравнение
  const counts: CheckLine[] = (['income', 'expense', 'transfer'] as const).map((t) => ({
    what: { income: 'доходы', expense: 'расходы', transfer: 'переводы' }[t],
    file: fileCounts[t],
    db: dbCounts[t] ?? 0,
    currency: null,
  }));
  const accountLines: CheckLine[] = accounts
    .filter((a) => fileMove.has(a.id) || dbMove.has(a.id))
    .map((a) => ({ what: `${a.name}, ${a.currency}`, file: fileMove.get(a.id) ?? 0, db: dbMove.get(a.id) ?? 0, currency: a.currency }));
  // подпись — по базе (там известен родитель), иначе по файлу; одноимённые подкатегории разных родителей сверяются вместе,
  // и в подписи видны все родители: «Расходы: Зарплата → Администраторы + Офис → Администраторы»
  const label = (k: string) => {
    const c = (dbCats.get(k) ?? fileCats.get(k))!;
    return `${KIND_TITLE[c.kind]}: ${[...c.titles].sort((a, b) => a.localeCompare(b, 'ru')).join(' + ')}`;
  };
  const catLines: CheckLine[] = [...new Set([...fileCats.keys(), ...dbCats.keys()])]
    .map((k) => ({ what: label(k), file: fileCats.get(k)?.sum ?? 0, db: dbCats.get(k)?.sum ?? 0, currency: company.base }))
    .sort((a, b) => a.what.localeCompare(b.what, 'ru'));
  const mismatches = [...counts, ...accountLines, ...catLines].filter((l) => l.file !== l.db).length;
  return {
    company: company.name,
    fileName: input.fileName,
    today: input.today,
    rows: { total: parsed.total, future: parsed.future.length, errors: new Set(parsed.issues.filter((i) => i.code.startsWith('R')).map((i) => i.row)).size },
    counts,
    accounts: accountLines,
    categories: catLines,
    notes,
    mismatches,
  };
}

/** Таблица «файл | база | разница» и итог «Совпадает» или «Расхождений: N». */
export function formatReport(r: CheckReport): string[] {
  const value = (n: number, currency: string | null) => (currency === null ? formatAmount(n, 0) : formatAmount(n, units(currency)));
  const table = (title: string, lines: CheckLine[]) => [
    '',
    title,
    `${'  '.padEnd(46)}${'файл'.padStart(18)}${'база'.padStart(18)}${'разница'.padStart(18)}`,
    ...lines.flatMap((l) => {
      const mark = l.file === l.db ? '  ' : '≠ ';
      const numbers = `${value(l.file, l.currency).padStart(18)}${value(l.db, l.currency).padStart(18)}${value(l.file - l.db, l.currency).padStart(18)}`;
      // длинная подпись не обрезается (в ней родители одноимённых подкатегорий): числа — строкой ниже
      return l.what.length > 44 ? [`${mark}${l.what}`, `${' '.repeat(46)}${numbers}`] : [`${mark}${l.what.padEnd(44)}${numbers}`];
    }),
  ];
  return [
    `Сверка импорта: файл «${r.fileName}», компания «${r.company}»`,
    `Сегодня для разбора: ${formatDateRu(r.today)} — строки с датой платежа позже пропущены как плановые (--today ГГГГ-ММ-ДД — другая дата)`,
    `Строк данных в файле: ${formatAmount(r.rows.total, 0)}; плановых пропущено: ${formatAmount(r.rows.future, 0)}; строк с ошибками: ${formatAmount(r.rows.errors, 0)}`,
    ...table('Операции, штук', r.counts),
    ...table('Движение по счетам (поступления минус списания), в валюте счёта', r.accounts),
    ...table('Итоги по категориям (доходы плюс, расходы минус), в валюте компании', r.categories),
    ...(r.notes.length ? ['', ...r.notes.map((n) => `Внимание: ${n}`)] : []),
    '',
    r.mismatches === 0 ? 'Итог: Совпадает' : `Итог: Расхождений: ${r.mismatches}`,
  ];
}
```

Создайте `scripts/import-check.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/server/config';
import { AppError } from '../src/server/errors';
import { isValidDate, todayInTimezone } from '../src/shared/dates';
import { checkImport, formatReport } from './lib/import-check';

// Сверка импорта с файлом (§12 спецификации импорта):
//   npm run import:check -- <файл .xlsx или .csv> <id компании> [--today ГГГГ-ММ-ДД]
// id компании — число в адресе журнала: /c/<id>/log. --today — «сегодня» для разбора (строки позже — плановые и не
// считаются, как при импорте); по умолчанию — сегодня в APP_TIMEZONE. База открывается только на чтение (приложение может
// работать); файл читается тем же разборщиком, что импорт, и никуда не копируется. Выход 0 — «Совпадает», 1 — расхождения
// или ошибка.

const USAGE = 'Использование: npm run import:check -- <файл .xlsx или .csv> <id компании из адреса /c/<id>/log> [--today ГГГГ-ММ-ДД]';

function main(): number {
  const args = process.argv.slice(2);
  const at = args.indexOf('--today');
  const todayArg = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0) args.splice(at, 2);
  const [file, cidArg] = args;
  const companyId = Number(cidArg);
  if (!file || !Number.isSafeInteger(companyId) || companyId <= 0 || args.length !== 2) {
    console.error(USAGE);
    return 1;
  }
  if (at >= 0 && (!todayArg || !isValidDate(todayArg))) {
    console.error(`Неверная дата --today: ${todayArg ?? '(нет)'} — нужна ГГГГ-ММ-ДД`);
    return 1;
  }
  if (!fs.existsSync(file)) {
    console.error(`Файл не найден: ${file}`);
    return 1;
  }

  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  if (!fs.existsSync(config.dbPath)) {
    console.error(`База не найдена: ${config.dbPath}`);
    return 1;
  }
  const sqlite = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = checkImport({
      sqlite,
      companyId,
      data: fs.readFileSync(file),
      fileName: path.basename(file),
      timezone: config.timezone,
      today: todayArg ?? todayInTimezone(config.timezone),
    });
    console.log(formatReport(report).join('\n'));
    return report.mismatches === 0 ? 0 : 1;
  } catch (e) {
    // ошибка файла (F*) — тем же текстом, что в панели импорта
    console.error(e instanceof AppError ? e.message : `Сверка не удалась: ${(e as Error).message}`);
    return 1;
  } finally {
    // и после ошибки: база закрывается до выхода
    sqlite.close();
  }
}

process.exitCode = main();
```

В `package.json` замените

```json
    "bench:import": "tsx scripts/bench-import.ts",
```

на

```json
    "bench:import": "tsx scripts/bench-import.ts",
    "import:check": "tsx scripts/import-check.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-check.test.ts`
Expected: PASS, 4 теста.

Run: `npm run import:check`
Expected: строка «Использование: npm run import:check -- <файл .xlsx или .csv> <id компании из адреса /c/<id>/log> [--today ГГГГ-ММ-ДД]», код выхода 1. С настоящими данными скрипт в задаче не запускается.

- [ ] **Step 5: `.gitignore` и README**

В `.gitignore` замените

```text
# Данные приложения: БД (включая WAL/SHM), загрузки, логи, бэкапы
data/
*.db
*.db-wal
```

на

```text
# Данные приложения: БД (включая WAL/SHM), загрузки, логи, бэкапы
data/

# Настоящие файлы для импорта (спецификация импорта, §11): журнал.import-local.xlsx и т. п.
*.import-local.*
*.db
*.db-wal
```

В `README.md` замените

```md
  - «Мои компании» карточками (архивные — отдельным блоком), «Пользователи» с «это вы» и «отключён», «Профиль» — одна форма с именем и сменой пароля; фиксированные и ручные курсы валют правятся в окнах; «Резервное копирование» — карточка «Автоматическая копия» (расписание, последняя копия, папка) и «Скачать сейчас»; ошибки показаны понятным языком.

Пока нет (следующие шаги): отчёты.

## Требования
```

на

```md
  - «Мои компании» карточками (архивные — отдельным блоком), «Пользователи» с «это вы» и «отключён», «Профиль» — одна форма с именем и сменой пароля; фиксированные и ручные курсы валют правятся в окнах; «Резервное копирование» — карточка «Автоматическая копия» (расписание, последняя копия, папка) и «Скачать сейчас»; ошибки показаны понятным языком.

- **Импорт из Finmap (план И-2):**
  - «Импортировать» в тулбаре журнала (на телефоне — «Ещё» → «Импорт из Excel») открывает панель «Импорт из Excel»: файл .xlsx или .csv в формате выгрузки Finmap «Excel» или шаблона («Скачать шаблон»), до 30 МБ и 50 000 строк;
  - проверка без записи: итог, ошибки по строкам, счета из файла с сопоставлением (новый счёт — «Текущий остаток» или «Стартовый баланс», существующий — «Остаток после импорта»), что будет создано, предупреждения, дубликаты;
  - «Импортировать» записывает всё одной транзакцией; если данные компании за время проверки изменились, панель показывает обновлённый итог;
  - сверка с файлом — `npm run import:check` (раздел «Импорт из Finmap»).

Пока нет (следующие шаги): отмена импорта и вкладка «Импорты» (план И-3), экспорт в формате Finmap (план Э), отчёты.

## Требования
```

В `README.md` замените

````md
```

## Если что-то не работает

````

на

````md
```

## Импорт из Finmap

Журнал из Finmap переносится файлом «Excel» — 16 колонок, тот же формат, что шаблон импорта Finmap. Подходит и файл, заполненный по нашему шаблону («Скачать шаблон» в панели импорта). Проверяйте на отдельной тестовой компании: отмены импорта пока нет (появится в плане И-3), поэтому для повтора создайте новую компанию.

1. **В Finmap:**
   - запишите текущие остатки каждого счёта и «Всего на счетах»;
   - запишите итоги по категориям за всё время (Аналитика → по категориям) для доходов и расходов;
   - «Экспортировать в» → «Excel» за всё время, без фильтра.
2. **Файл с настоящими данными** держите вне репозитория: в папке `data/` или с именем вида `журнал.import-local.xlsx` — такие файлы git не видит.
3. **В клоне:**
   - создайте компанию, например «Клуб (проверка)», базовая валюта KZT, без проектов;
   - в журнале нажмите «Импортировать» (на телефоне — «Ещё» → «Импорт из Excel») и выберите файл.
4. **Проверка файла** ничего не записывает. Сверьте:
   - число операций и период — как в Finmap;
   - ошибок 0. Ошибки показаны с номерами строк Excel: исправьте файл и выберите его снова («Выбрать другой файл» — выбор счетов сохранится);
   - «Счета из файла»: для каждого счёта — «Создать новый счёт» или существующий счёт;
   - «Будет создано»: категории, контрагенты, проекты, теги. Если системные категории Finmap («Зарплата», «Налоги» и другие) попали в новые, сообщите разработчику их названия: они добавляются в `FINMAP_SYSTEM_ALIASES`.
5. **Остатки.** У нового счёта оставьте «Текущий остаток» и введите остаток из Finmap: стартовый баланс посчитается сам, его значение видно под полем. У существующего счёта есть необязательное «Остаток после импорта».
6. **«Импортировать»** записывает всё одной транзакцией: 16 000 строк — несколько секунд, панель в это время не закрывается. Итог — «Импорт завершён» с числом добавленных операций и созданных справочников.
   - «Данные компании изменились после проверки…» — компанию изменили за это время: посмотрите обновлённый итог и нажмите «Импортировать» ещё раз.
   - «Проверка устарела — файл проверен заново…» — сервер перезапускался или проверял другие файлы. Панель сама проверила файл заново: нажмите «Импортировать» ещё раз.
7. **Сверка:**
   - остатки счетов в левой панели и «Всего на счетах» — ровно как в Finmap;
   - `npm run import:check -- <путь к файлу> <id компании>`; id компании — число в адресе журнала `/c/<id>/log`. Скрипт открывает базу только на чтение (приложение можно не останавливать), печатает «файл | база | разница» для числа операций, движения счетов и итогов по категориям и заканчивает строкой «Итог: Совпадает» или «Итог: Расхождений: N»;
   - итоги по категориям из скрипта — как записанные в Finmap;
   - несколько операций около полуночи (22:00–02:00) — та же дата и время, что в Finmap;
   - «Зарплата за {месяц}» — та же «Дата сделки».
8. **Повторный импорт того же файла** показывает все строки дубликатами, «Этот файл уже импортирован» и «Нечего импортировать: все строки — дубликаты».

## Если что-то не работает

````

В `README.md` замените

```md
| `npm run seed:demo -- [число операций] [дата ГГГГ-ММ-ДД]` | Демо-набор (3 компании, 8 счетов, по умолчанию 10 000 операций за 2 года) — только в пустую базу и при остановленном приложении. Нужен пользователь (`npm run user:add`). Для отдельной демо-базы задайте `DATA_DIR` |
| `npm run bench:journal -- [папка]` | Замер скорости журнала на демо-наборе (§12): первая страница, фильтр и поиск должны отвечать на сервере быстрее 300 мс (p95). Набор заливается во временную папку один раз, около 45 с. Замер пишет только в свою папку (рядом с `app.db` лежит метка `bench-demo.marker`; чужую базу он не открывает на запись), весь замер идёт на одноразовой копии во временной папке, демо-копия между запусками не меняется |
| `npm run shots:ux -- [папка]` | Визуальная сверка с Finmap (§12.3 этапа 1.5): поднимает свой сервер на временной базе с демо-набором (порт `SHOTS_PORT`, по умолчанию 41741), снимает наши экраны на 1440×900 и 390×844 под парными к снимкам Finmap именами и пишет `index.html` «Finmap \| наш». По умолчанию — в `docs/research/screens/v2/parity/` (в git не попадает) |

```

на

```md
| `npm run seed:demo -- [число операций] [дата ГГГГ-ММ-ДД]` | Демо-набор (3 компании, 8 счетов, по умолчанию 10 000 операций за 2 года) — только в пустую базу и при остановленном приложении. Нужен пользователь (`npm run user:add`). Для отдельной демо-базы задайте `DATA_DIR` |
| `npm run bench:journal -- [папка]` | Замер скорости журнала на демо-наборе (§12): первая страница, фильтр и поиск должны отвечать на сервере быстрее 300 мс (p95). Набор заливается во временную папку один раз, около 45 с. Замер пишет только в свою папку (рядом с `app.db` лежит метка `bench-demo.marker`; чужую базу он не открывает на запись), весь замер идёт на одноразовой копии во временной папке, демо-копия между запусками не меняется |
| `npm run import:check -- <файл> <id компании>` | Сверка импорта с файлом (§12 спецификации импорта): число операций, движение счетов и итоги по категориям — «файл \| база \| разница» и «Итог: Совпадает» или «Итог: Расхождений: N». База открывается только на чтение; id компании — из адреса `/c/<id>/log` |
| `npm run bench:import` | Замер импорта (§10 спецификации импорта) на синтетическом файле во временной папке: загрузка, пересчёт и запись 16 000 строк (бюджеты 3 с, 1 с и 5 с) и худший случай кэша проверки — три файла по 50 000 строк (пик памяти, бюджет 400 МБ). Настоящие файлы не нужны, в CI не входит |
| `npm run shots:ux -- [папка]` | Визуальная сверка с Finmap (§12.3 этапа 1.5): поднимает свой сервер на временной базе с демо-набором (порт `SHOTS_PORT`, по умолчанию 41741), снимает наши экраны на 1440×900 и 390×844 под парными к снимкам Finmap именами и пишет `index.html` «Finmap \| наш». По умолчанию — в `docs/research/screens/v2/parity/` (в git не попадает) |

```

Run: `git check-ignore -v журнал.import-local.xlsx`
Expected: строка с `.gitignore` и шаблоном `*.import-local.*`.

- [ ] **Step 6: Full check**

Run: `npm test`
Expected: 1001 пройдено и 1 пропущен (в том числе `tests/shared/terminology.test.ts` — README без слова «статья»).

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run test:e2e`
Expected: 149 из 149.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/import-check.ts scripts/import-check.ts tests/server/import-check.test.ts package.json .gitignore README.md
git commit -m "feat: импорт — сверка npm run import:check; README «Импорт из Finmap»" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Снимки `shots:ux` панели импорта и итоговая проверка (§11.4)

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes:
  - задача 2: `finmapLikeSample`, `finmapLikeRow`, `finmapLikeXlsx`, `excelSerial` (`tests/helpers/finmap-like.ts`);
  - задачи 4–5: панель «Импорт из Excel», `[data-import-file]`, `h3` «Проверка файла», группы «Будет создано», пункт «Ещё» → «Импорт из Excel».
- Produces: снимки §11.4:
  - `c42-import-excel` — пара к Finmap `42-import-excel`, пустая панель;
  - `c42b-import-preview` — предпросмотр синтетического файла, первая группа «Будет создано» раскрыта;
  - `c42c-import-errors` — предпросмотр с ошибками;
  - `cm-import` — панель на телефоне 390×844 с предпросмотром.

  Ключи «пар Finmap» у снимков без пары — `42b-import-preview.png`, `42c-import-errors.png`, `m42-import.png`: в `index.html` слева «нет снимка Finmap». Всего сценариев — 55.

- [ ] **Step 1: Сценарии**

В `scripts/ux-shots.ts` замените

```ts
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { seedDemo } from './lib/demo';

```

на

```ts
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { excelSerial, finmapLikeRow, finmapLikeSample, finmapLikeXlsx, type FinmapLikeValue } from '../tests/helpers/finmap-like';
import { seedDemo } from './lib/demo';

```

В `scripts/ux-shots.ts` замените

```ts
  return dialog;
};

/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */
```

на

```ts
  return dialog;
};

/** Панель «Импорт из Excel» (§5 спецификации импорта): «Импортировать» в тулбаре журнала или «Ещё» → «Импорт из Excel» на телефоне. */
const importPanel = (p: Page) => p.getByRole('dialog', { name: 'Импорт из Excel' });
const openImport = async (p: Page, phone = false) => {
  if (phone) {
    await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
    await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'Импорт из Excel' }).click();
  } else {
    await p.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  }
  await importPanel(p).getByRole('button', { name: 'Выберите файл' }).waitFor();
};
/** Синтетический файл «как у Finmap» (tests/helpers/finmap-like.ts) — без настоящих данных; ждёт итог проверки. */
const importFile = async (p: Page, rows: FinmapLikeValue[][], expect: 'Проверка файла' | 'Найдено ошибок') => {
  await importPanel(p)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'выгрузка.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: finmapLikeXlsx(rows) });
  await (expect === 'Проверка файла' ? importPanel(p).getByRole('heading', { level: 3, name: 'Проверка файла' }) : importPanel(p).getByText(/^Найдено ошибок: \d+\./)).waitFor();
};
/** Файл с ошибками строк: дата текстом, пустая сумма, строка без счёта. */
const IMPORT_ERRORS = [
  ...finmapLikeSample(),
  finmapLikeRow({ paidAt: 'вчера', amount: 1500, to: 'Касса-1' }),
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '12:00:00'), amount: null, to: 'Касса-1' }),
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '13:00:00'), amount: 700 }),
];

/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */
```

В `scripts/ux-shots.ts` замените

```ts
  { ours: 'c35-settings-backup.png', finmap: '35-settings-backup.png', path: 'settings/backup' },
  { ours: 'c36-settings-log-view.png', finmap: '36-settings-log-view.png', path: 'settings/journal' },
  {
    ours: 'cm01-accounts.png',
```

на

```ts
  { ours: 'c35-settings-backup.png', finmap: '35-settings-backup.png', path: 'settings/backup' },
  { ours: 'c36-settings-log-view.png', finmap: '36-settings-log-view.png', path: 'settings/journal' },
  // панель «Импорт из Excel» (§11.4 спецификации импорта): пустая — пара к Finmap 42; предпросмотр и ошибки — снимков Finmap нет
  { ours: 'c42-import-excel.png', finmap: '42-import-excel.png', path: 'log', act: (p) => openImport(p) },
  {
    ours: 'c42b-import-preview.png',
    finmap: '42b-import-preview.png',
    path: 'log',
    act: async (p) => {
      await openImport(p);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
      // первая группа «Будет создано» раскрыта (в демо-компании категории файла уже есть — это контрагенты)
      await importPanel(p).getByRole('button', { name: /^(Категории|Контрагенты|Проекты|Теги): \d+$/ }).first().click();
    },
  },
  {
    ours: 'c42c-import-errors.png',
    finmap: '42c-import-errors.png',
    path: 'log',
    act: async (p) => {
      await openImport(p);
      await importFile(p, IMPORT_ERRORS, 'Найдено ошибок');
    },
  },
  {
    ours: 'cm01-accounts.png',
```

В `scripts/ux-shots.ts` замените

```ts
  // экран «Настройки» на телефоне (§8.6); снимка Finmap нет — в index.html слева «нет снимка Finmap»
  { ours: 'cm07-settings.png', finmap: 'm07-settings.png', phone: true, path: 'settings' },
];

```

на

```ts
  // экран «Настройки» на телефоне (§8.6); снимка Finmap нет — в index.html слева «нет снимка Finmap»
  { ours: 'cm07-settings.png', finmap: 'm07-settings.png', phone: true, path: 'settings' },
  {
    // панель импорта на телефоне 390×844 — на весь экран (§5.7 спецификации импорта); снимка Finmap нет
    ours: 'cm-import.png',
    finmap: 'm42-import.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await openImport(p, true);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
    },
  },
];

```

- [ ] **Step 2: Run shots**

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run shots:ux`
Expected: «снято 55 из 55». Откройте `docs/research/screens/v2/parity/c42-import-excel.png`, `c42b-import-preview.png`, `c42c-import-errors.png`, `cm-import.png`. Проверьте:
- **c42:** справа панель 480 px — «Импорт из Excel», зона с папкой, «Перетяните сюда файл (до 30 МБ)», «или», «Выберите файл»; ниже «Скачать шаблон» и серый текст про формат; внизу «Импортировать» на всю ширину и «Выберите файл» под ней;
- **c42b:** строка файла «выгрузка.xlsx · 2 КБ» и «Выбрать другой файл»; карточки «Касса-1» и «Банк-2» с полем «Счёт для «…»» и суммами; «Будет создано» — раскрытая группа;
- **c42c:** красный блок «Найдено ошибок: 3…» со списком строк; под «Импортировать» — «Исправьте ошибки в файле и загрузите его снова»;
- **cm-import:** панель на весь экран 390 px, без прокрутки вбок; «Импортировать» внизу.

- [ ] **Step 3: Final check**

Run: `npm test`
Expected: 1001 пройдено и 1 пропущен.

Run: `npm run test:e2e` — два раза подряд.
Expected: оба раза 149 из 149.

Run: `npm run bench:import`
Expected: как в задаче 2 — «Итог: все бюджеты соблюдены», код выхода 0. Цифры — в отчёт задачи для итогов плана.

- [ ] **Step 4: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: импорт — снимки shots:ux панели импорта (c42, c42b, c42c, cm-import)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги и отложенные замечания — `docs/superpowers/followups/2026-10-12-import-2-followups.md` (пишет контролёр). В них:
  - цифры `npm run bench:import` (задачи 2 и 7): время, пик памяти на 16 000 строк (бюджет 400 МБ) и на 50 000 строк (принятый бюджет 500 МБ, решение 9), пик с тремя файлами в кэше;
  - раздел «Для плана И-3»:
    - в `imports.created` — массивы id;
    - в `imports.account_changes` — `before` и `after` каждого изменённого счёта;
    - история импорта — `import` `create`, справочники — `create` с `importId`;
    - строка «Отменить импорт можно в «Истории действий» → «Импорты»» добавляется в «Импорт завершён» вместе с вкладкой (решение 14);
    - `ENTITY_LABELS.import` уже есть.
- Проверка на настоящем файле — владельцем по README «Импорт из Finmap» в тестовой компании: остатки и `npm run import:check`. Итог записывается без реальных сумм и названий (§12).
- Следующий шаг — план И-3 «История импортов и отмена» (§14).
