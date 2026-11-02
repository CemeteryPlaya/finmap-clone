# Senet: автоматическая разноска кассовых смен — план

> **Для исполнителя:** выполнять по задачам через superpowers:executing-plans (без субагентов, решение владельца 2026-10-18); ревью — claude-code-harness:harness-review в режиме manual-pass. Шаги отмечаются чекбоксами (`- [ ]`). Команды — в переднем плане с `timeout`; рабочий экземпляр на 3457 не трогать (`npm start` / `npm run stop` / `setup` / `service:*` запрещены).

**Цель:** модуль сам забирает отчёты Senet по сменам клуба и проводит их в журнал (доходы Каспи и Касса, выемки по правилам), нераспознанное отправляет в очередь «Разобрать», а «Сверка Senet» показывает остаток кассы Senet / журнал после каждой смены.

**Архитектура:** модуль `src/server/modules/senet/`.
- **Источник** — интерфейс `SenetSource`. Сейчас реализация `AdminTokenSource`: вход в админ-панель, отчёты в xlsx, разбор в типизированные строки.
- **Забор** пишет сырые xlsx в `FileStore`, а смены, выемки и транзакции — в таблицы `senet_*`.
- **Разноска** — чистые функции: смена → план операций. Ими же пользуются сверка с эталоном и «Проверить на истории».
- **Автопроводка** создаёт операции через `operations.create` внутри транзакции на смену. Связи хранятся в `senet_postings` и `senet_cash_moves.operation_id`.
- **Очередь** — сервис с API, не зависящим от экрана.
- **Запуск:** локально — задача `senet-sync`; на Vercel — маршрут `cron/senet` и пингер GitHub Actions.

**Стек:** Fastify 5, Drizzle (SQLite libsql + Postgres Neon/PGlite), `node:crypto` (AES-256-GCM, HMAC-SHA256), собственные читалка и писатель xlsx (`imports/xlsx-read.ts`, `http/xlsx.ts`), React + TanStack Query, Vitest (unit, server-sqlite, server-pg), Playwright.

**Спецификация:** [docs/superpowers/specs/2026-11-02-senet-autopost-design.md](../specs/2026-11-02-senet-autopost-design.md) (одобрена 2026-11-02). Ссылки вида «С§4.3» — на её разделы. Она изменяет [2026-10-15-senet-integration-design.md](../specs/2026-10-15-senet-integration-design.md) («С15§…»).

## Global Constraints

- Настоящие данные — имена, логины, суммы, название организации Senet, телефоны — не попадают в репозиторий, тесты, снимки, сообщения коммитов. Образцы: «Клуб 1», «Сотрудник А», «Оператор 1…», «Владелец А/Б», «Поставщик 1…», организация `club-demo`.
- `.superpowers/senet-local/` в git не попадает. Всё, что там лежит, читают только локальные скрипты.
- Деньги — целые в тиынах: тенге из xlsx × 100. Время — ISO UTC.
- Время в xlsx — в часах клуба. Перевод — через `APP_TIMEZONE` (`config.timezone`), не через часы сервера.
- **Senet.** Хосты — только `https://{org}.app.enes.tech`. `org` по правилу `^[a-z0-9-]{1,63}$`. Перенаправления не выполняются (`redirect: 'manual'`).
  - Запросы: `POST /api/v2/user/idm_admin_auth/` с телом `{username, password}` → `{token}`; отчёты — `GET /api/v2/stat/reports/` с `Authorization: Token {token}`.
  - `/api/v2/user/disconnect/` не вызывается никогда.
- `SENET_API_BASE` переопределяет `https://{org}.app.enes.tech` только в тестах и e2e.
- **Пределы запроса:** таймаут 60 с; ответ до 20 МБ; пауза 200 мс между запросами; один повтор через 5 с при сетевой ошибке или 5xx.
- **Секреты:** AES-256-GCM. Ключ — `data/secret.key` (32 байта, создаётся при первом подключении) или `SECRET_KEY` (base64 32 байта) в режиме vercel. Наружу — только `credentials_hint`. Колонки с секретами называются `*_secret` (их отсекает `sanitizeDiff`).
- **Миграции:** sqlite `0013_senet.sql`, pg `0003_senet.sql`, генерация `npm run db:generate`. Тесты `schema-parity` и `schema-0013`.
- **Серверные тесты** идут на обоих диалектах (`npm test` гоняет server-sqlite и server-pg).
- **Тексты интерфейса** — по-русски, как на существующих экранах. Ключевые строки:
  - «Обновите доступ к Senet — забор остановлен»;
  - «Senet не принял данные входа. Обновите их в настройках подключения»;
  - «Senet просит подтвердить вход — подключитесь токеном»;
  - «Отчёт «{отчёт}» пришёл в незнакомом формате — сохранён для разбора»;
  - «Не уложились во время — продолжим через час»;
  - «Задайте SECRET_KEY в настройках Vercel»;
  - «Senet уже провёл эту выемку заново — удалите новую операцию»;
  - «Смены раньше этой даты считаются уже внесёнными вручную».
- **Коммиты** — по-русски, в стиле истории (`feat(senet): …`), с подписью `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Решения плана (уточняют спецификацию, не меняют её)

- **П1. Пять видов совпадения вместо четырёх.** К видам С§4.3 добавлено «первое слово» (`first`). Без него не выразить признаки ЗП эталона: `зарплата` и `аванс` распознаются только первым словом, а `zp` и `зп` — любым. Итого `word | first | phrase | prefix | contains`.
  - `prefix` — без границы слова: `возврат` совпадает с «возвраты».
  - `first` — первое слово целиком: `obed` не совпадает с `obed2`, как `^obed\b` эталона.
- **П2. Слова по умолчанию.** При создании подключения в правила компании записываются обезличенные слова типов:

  | Тип | Слова | Вид совпадения |
  |---|---|---|
  | Каспи | `kaspi`, `каспи` | `phrase` |
  | Признаки ЗП | `zp`, `зп` | `word` |
  | Признаки ЗП | `зарплата`, `аванс` | `first` |
  | Доплата | `dop`, `доп` | `word` |
  | Стажёр | `stajer`, `stazher`, `стажер` | `contains` |
  | Обед | `obed`, `обед`, `еда` | `first` |
  | Брак | `brak`, `брак` | `contains`, флаг `defect` |

  Категории и контрагенты не заполняются. Тип без категории не срабатывает: выемка идёт в очередь с причиной `rule_broken`.
- **П3. Повторная проводка и «Отмена».** У `senet_cash_moves` и `senet_postings` есть колонка `prev_operation_id`: при повторной проводке туда записывается удалённая операция. «Отмена» удаления операции, которая стоит в чьём-то `prev_operation_id`, отказывает (С§5.3).
- **П4. «Не проводить повторно» при удалении.** Окно удаления операции из Senet сначала вызывает `PATCH /senet/links/:operationId {noRepost: true}`, потом обычный `DELETE`. Если удаление не прошло, отметка безвредна: она действует только на удалённую операцию.
- **П5. Строки для аналитики** (С§9.3) заменяются по окну: `DELETE … WHERE office_id = ? AND at >= from AND at < to`, затем вставка — в одной транзакции.
- **П6. Ключ выемки** — `senet_ref` = `{at с мс}|{amount}|{нормализованный комментарий}|{n}`, где `n` — номер повтора одинаковых строк в окне, с 1.

## Review Focus

1. **Пустой комментарий выемки** (ячейка `Comment` пуста). Ожидание: пункт `unrecognized` с текстом «(без комментария)», а «Запомнить» для него недоступно. Тест — задача 8 (`classify`) и задача 12 (`answer`).
2. **Время в xlsx числом Excel**, а не строкой «2026-10-01 10:26:45». Ожидание: тот же момент UTC. Тест — задача 4.
3. **Senet ответил 200 не xlsx** (HTML страницы входа, JSON-ошибка). Ожидание: «незнакомый формат», запуск `partial`, файл сохранён, ничего не проведено. Тест — задачи 4 и 6.
4. **Сбой посреди проводки смены** (ошибка в третьей операции). Ожидание: эта смена откатилась целиком и получила `post_error`, соседние смены проведены. Тест — задача 11.
5. **Две одинаковые выемки в одной смене** (одна секунда, сумма и комментарий). Ожидание: две разные выемки, две операции, повторный забор дублей не создаёт. Тест — задачи 6 и 11.

---

## Часть СА-1 «Основа»

### Задача 1: Пробный забор с владельцем

`[Docs]` `[tdd:skip:research]`

**Files:**
- Create (локально, не в git): `.superpowers/senet-local/probe-admin.mjs`
- Modify: `docs/research/senet-api.md` — раздел «Админ-API (проверено 2026-11-0X)»

**Interfaces:**
- Produces: колонки `shop_quantity`, `movements_of_goods`, `office_load`, `office_load_by_zones` (для задачи 15); есть ли список офисов и касс (для задачи 5); живёт ли прежний токен после нового входа (для задачи 4).

- [ ] **Step 1:** Написать `probe-admin.mjs`.
  - Вход берёт логин и пароль из `SENET_LOGIN` / `SENET_PASSWORD`.
  - Отчёты запрашиваются за вчера, xlsx сохраняются в `.superpowers/senet-local/senet_raw/probe/`.
  - На экран — только заголовки колонок, число строк и типы ячеек. Значения не печатаются.
  - Проверяются кандидаты списка офисов: `/api/v2/offices/`, `/api/v2/office/`, `/api/v2/cashdesk/` — печатаются только код ответа и имена полей.
- [ ] **Step 2:** Владелец запускает скрипт со своими данными. Затем запускает его второй раз и проверяет, отвечает ли первый токен.
- [ ] **Step 3:** Записать в `docs/research/senet-api.md` колонки, найденный эндпоинт списка офисов (или «не найден») и поведение токена. Без значений.
- [ ] **Step 4: Commit** — `docs(senet): пробный забор отчётов админ-API`.

### Задача 2: Схема 0013 / pg 0003

`[Feature]` `[tdd:required]`

**Files:**
- Modify: `src/server/db/schema-sqlite.ts`, `src/server/db/pg-schema.ts`, индекс схемы (`src/server/db/schema.ts` — экспорт новых таблиц)
- Create: миграции `src/server/db/migrations/0013_senet.sql`, `src/server/db/migrations-pg/0003_senet.sql` (через `npm run db:generate`, затем переименование тегов, как у 0012)
- Test: `tests/server/schema-0013.test.ts`; `tests/server/schema-parity.test.ts` проходит без правок

**Interfaces:**
- Produces: таблицы с JS-именами:
  - `senetConnections`, `senetOffices`, `senetShifts`, `senetCashMoves`, `senetPostings`, `senetRules`, `senetReviewItems`, `senetSyncRuns`, `senetRaw`;
  - для аналитики: `senetTransactions`, `senetSoldItems`, `senetBarPurchases`, `senetChecks`, `senetRefills`.

  Колонки — С§9.1–9.3, плюс `prev_operation_id` (П3) у `senet_cash_moves` и `senet_postings`. `senet_stock`, `senet_goods_moves`, `senet_load` здесь не создаются (задача 15).

- [ ] **Step 1: Тест `schema-0013`:**
  - миграция применяется на копии базы 0012;
  - уникальности:
    - `senet_offices (connection_id, senet_office_id, cash_desk_id)`;
    - `senet_shifts (office_id, opened_at)`;
    - `senet_cash_moves (shift_id, senet_ref)`;
    - `senet_postings (shift_id, kind)`;
  - частичный уникальный индекс `senet_review_items (shift_id, cash_move_id, reason) WHERE status = 'open'`; у `cash_move_id IS NULL` уникальность через `COALESCE(cash_move_id, 0)`;
  - вставка второй строки в каждый из уникальных ключей падает.
- [ ] **Step 2:** `timeout 300 npx vitest run tests/server/schema-0013.test.ts` → FAIL (таблиц нет).
- [ ] **Step 3:** Таблицы в обеих схемах.
  - Перечисления — `text` с `enum` в sqlite, `text` в pg, как у `stock_docs.source`.
  - Внешние ключи на `operations`, `categories`, `counterparties` — без `onDelete`: операции удаляются мягко.
- [ ] **Step 4:** `npm run db:generate`; `timeout 600 npm test -- tests/server/schema` → PASS на обоих диалектах.
- [ ] **Step 5: Commit** — `feat(senet): схема 0013 / pg 0003`.

### Задача 3: Секретный ключ, шифрование, хеш телефона

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/secrets.ts`
- Modify: `src/server/config.ts` (`SECRET_KEY: optional`, в `Config` — `secretKey: string | null`), `src/server/app.ts` (создание `Secrets` и передача в сервисы Senet)
- Test: `tests/server/secrets.test.ts`, дополнение `tests/server/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Secrets {
    seal(plain: string): string;            // base64(iv12 | tag16 | ciphertext)
    open(sealed: string): string;           // бросает SecretsError('undecryptable')
    phoneHash(phone: string): string;       // HMAC-SHA256(ключ, «phone:» + только цифры), hex
  }
  function loadSecrets(config: Config, opts?: { create: boolean }): Secrets | null;
  function phoneMask(phone: string): string; // «+7 *** ** 12»; меньше 2 цифр — «—»
  class SecretsError extends Error { code: 'undecryptable' | 'missing' }
  ```
  - `loadSecrets` в режиме vercel читает `config.secretKey`; иначе — `data/secret.key`. При `create: true` файл создаётся с правами `0o600`. Нет ключа и `create: false` → `null`.

- [ ] **Step 1: Тесты:**
  - `seal` → `open` возвращает исходное;
  - два `seal` одного текста различаются;
  - подмена байта → `SecretsError('undecryptable')`;
  - другой ключ → `undecryptable`;
  - `phoneHash('+7 701 234 56 12') === phoneHash('87012345612'.replace(/^8/, '7'))` — нормализация к цифрам с `7`;
  - `phoneMask('+77012345612') === '+7 *** ** 12'`;
  - vercel без `SECRET_KEY` → `loadSecrets(...) === null`;
  - `SECRET_KEY` не base64 32 байта → `loadConfig` бросает «SECRET_KEY — 32 байта в base64».
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать на `node:crypto`. Ключ HMAC выводится из ключа шифрования: `hkdfSync('sha256', key, '', 'senet-phone', 32)`.
- [ ] **Step 4:** Прогнать → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(senet): секретный ключ, шифрование и хеш телефона`.

### Задача 4: `SenetSource` и `AdminTokenSource`

`[Feature]` `[tdd:required]`

**Files:**
- Create:
  - `src/server/modules/senet/source.ts` — типы;
  - `src/server/modules/senet/admin-source.ts`;
  - `src/server/modules/senet/xlsx-reports.ts` — разбор отчётов;
  - `src/server/modules/senet/time.ts`;
  - `tests/helpers/senet-samples.ts` — синтетические xlsx через `buildXlsx`;
  - `tests/helpers/senet-fake.ts` — поддельный сервер.
- Test: `tests/server/senet-source.test.ts`, `tests/server/senet-xlsx.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ReportKind = 'sessions' | 'cashMoves' | 'transactions' | 'soldItems' | 'checks' | 'refills' | 'stock' | 'goodsMoves' | 'load';
  interface OfficeRef { officeId: number; cashDeskId: number }
  interface SessionRow { openedAt: string; closedAt: string | null; openedBy: string; closedBy: string | null; endBalance: number; cash: number; cashless: number }
  interface CashMoveRow { at: string; cashier: string; kind: 'in' | 'out'; amount: number /* > 0 */; comment: string }
  interface TransactionRow { at: string; code: string; kind: 'sell' | 'refund'; amount: number; payment: string }
  interface SoldItemRow { at: string; item: string; qty: number | null; amount: number; payment: string; refund: boolean; comment: string }
  interface CheckRow { at: string; code: string; amount: number; used: boolean; workstation: number | null; guestLogin: string; phone: string | null; cashier: string }
  interface RefillRow { at: string; guestLogin: string; accountType: string; amount: number; workstation: number | null; phone: string | null }
  type ReportRows = { sessions: SessionRow[]; cashMoves: CashMoveRow[]; transactions: TransactionRow[]; soldItems: SoldItemRow[]; checks: CheckRow[]; refills: RefillRow[]; stock: null; goodsMoves: null; load: null };
  interface RawFile { data: Buffer; contentType: string; sha256: string }
  interface SenetSource {
    check(office: OfficeRef, now: Date): Promise<{ officeName: string; shifts: number; lastClosedAt: string | null }>;
    report<K extends ReportKind>(kind: K, office: OfficeRef, from: Date, to: Date): Promise<{ rows: ReportRows[K]; raw: RawFile }>;
  }
  class SenetError extends Error { code: 'auth_rejected' | 'auth_needs_code' | 'unreachable' | 'server_error' | 'bad_format' | 'too_large'; status?: number; report?: ReportKind }
  interface AdminCredentials { username?: string; password?: string; token?: string }
  function createAdminTokenSource(o: {
    org: string; credentials: AdminCredentials; timezone: string;
    fetch?: typeof fetch; base?: string /* SENET_API_BASE */; sleep?: (ms: number) => Promise<void>;
    onToken?: (token: string) => Promise<void>;  // новый токен после входа — сохранить
  }): SenetSource;
  function localToUtc(local: string | number /* число Excel */, timezone: string): string;  // time.ts
  ```
  - Строки `stock`, `goodsMoves`, `load` до задачи 15 — `null`; `raw` возвращается всегда.
  - `type` отчёта: `sessions → cashdesk_session` (+ `cash_desk_id`), `cashMoves → income_outcome`, `transactions → cashdesk_transactions`, `soldItems → sold_check_items`, `checks → checks`, `refills → refill`, `stock → shop_quantity`, `goodsMoves → movements_of_goods`, `load → office_load_by_zones`.
  - Даты запроса — `toISOString()` (мс и `Z`).

- [ ] **Step 1: Образцы и поддельный сервер.**
  - `senetSample(kind, rows)` собирает xlsx с заголовками С§3.4 (порядок колонок, как у настоящих).
  - `startSenetFake({ users, reports })` — Fastify на свободном порту:
    - вход: 200 `{token}`; 400 при неверном пароле; ответ `{needs_verification: true}` для пользователя с флагом `code`;
    - отчёты: проверяют `Authorization: Token`, иначе 401;
    - записывают все запросы для проверок.
- [ ] **Step 2: Тесты `senet-xlsx`:**
  - каждая `ReportKind` разбирается: колонки ищутся по заголовку, перестановка колонок не мешает;
  - открытая смена → `closedAt: null`;
  - «Вынесение» с суммой `-5000` → `{kind:'out', amount: 500000}`;
  - пустой `Comment` → `''`;
  - время строкой и время числом Excel дают одинаковый UTC (Review Focus 2): `'2026-10-01 10:26:45'` при `Asia/Almaty` → `'2026-10-01T05:26:45.000Z'`; мс сохраняются (`…:29.32` → `.320Z`);
  - нет обязательной колонки → `SenetError('bad_format')`.
- [ ] **Step 3: Тесты `senet-source`:**
  - первый запрос входит и вызывает `onToken`;
  - есть токен → вход не вызывается;
  - 401 на отчёт → один повторный вход и повтор запроса; второй 401 → `auth_rejected`;
  - вход 400 → `auth_rejected`; ответ с подтверждением → `auth_needs_code`;
  - 503 → повтор через `sleep(5000)`, затем `server_error`;
  - сеть → `unreachable`;
  - 200 с `text/html` → `bad_format` (Review Focus 3);
  - ответ > 20 МБ (`content-length`) → `too_large`;
  - между двумя отчётами `sleep(200)`;
  - перенаправление 302 не выполняется → `server_error`;
  - `check` за последние сутки возвращает имя офиса из колонки «Офис» и число смен;
  - в записанных запросах нет `disconnect`.
- [ ] **Step 4:** Прогнать → FAIL.
- [ ] **Step 5:** Реализовать.
  - `readXlsx` читает первый лист; строка 1 — заголовки.
  - `localToUtc` строит момент через `zoneOffsetMs` из `src/shared/dates.ts`. Число Excel переводится в локальное время (эпоха 1899-12-30).
  - Тело ответа читается потоково с отсечкой на 20 МБ.
  - Таймаут — `AbortSignal.timeout(60_000)`.
- [ ] **Step 6:** Прогнать → PASS на обоих диалектах; `npm run typecheck`.
- [ ] **Step 7: Commit** — `feat(senet): источник отчётов админ-панели`.

### Задача 5: Подключения и клубы — сервер и «Интеграции»

`[Feature]` `[tdd:required]`

**Files:**
- Create:
  - `src/server/modules/senet/connections.ts`, `src/server/modules/senet/routes.ts`;
  - `src/client/lib/senet.ts` — API-клиент и типы;
  - `src/client/pages/settings/IntegrationsSettings.tsx`;
  - `src/client/components/senet/ConnectionDialog.tsx`, `src/client/components/senet/OfficeForm.tsx`.
- Modify:
  - `src/server/app.ts` — `registerSenetRoutes`;
  - `src/server/modules/audit/service.ts` — `AuditAction`: `'connect' | 'sync' | 'post'`;
  - `src/client/lib/settings-sections.ts` — `{ path: 'integrations', label: 'Интеграции' }` после «Пользователей»;
  - `src/client/router.tsx`.
- Test: `tests/server/senet-connections.test.ts`, `tests/client/senet-integrations.test.ts`

**Interfaces:**
- Consumes: `Secrets` (задача 3), `createAdminTokenSource` (задача 4), `mutate`, `requireCompany`.
- Produces:
  ```ts
  interface SenetConnectionDto { id: number; name: string; org: string; source: 'admin_token' | 'app_key'; authMethod: 'password' | 'token'; credentialsHint: string; status: 'ok' | 'key_rejected' | 'unreachable'; lastSyncAt: string | null; lastError: string | null; archivedAt: string | null; offices: SenetOfficeDto[] }
  interface SenetOfficeDto { id: number; senetOfficeId: number; cashDeskId: number; name: string; enabled: boolean; projectId: number | null; cashAccountId: number | null; kaspiAccountId: number | null; incomeCategoryId: number | null; historyFrom: string | null; cashOffset: number }
  interface SenetConnections {
    list(companyId: number): Promise<SenetConnectionDto[]>;
    check(input: { org: string; authMethod: 'password' | 'token'; username?: string; password?: string; token?: string; officeId?: number; cashDeskId?: number }): Promise<{ officeName: string | null; shifts: number; lastClosedAt: string | null }>;
    create(companyId: number, input: { name: string; org: string; authMethod: 'password' | 'token'; username?: string; password?: string; token?: string }, userId: number): Promise<SenetConnectionDto>;
    update(companyId: number, id: number, patch: { name?: string; credentials?: AdminCredentials; archived?: boolean }, userId: number): Promise<SenetConnectionDto>;
    remove(companyId: number, id: number, userId: number): Promise<void>;   // 409, если есть проводки
    upsertOffice(companyId: number, connectionId: number, input: Omit<SenetOfficeDto, 'id' | 'name'> & { id?: number }, userId: number): Promise<SenetOfficeDto>;
    sourceFor(connectionId: number): Promise<SenetSource>;  // для забора; onToken сохраняет новый токен
  }
  ```
  - **Маршруты** (`/api/v1/companies/:cid/senet/…`): `GET connections`, `POST connections/check`, `POST connections`, `PATCH connections/:id`, `DELETE connections/:id`, `PUT connections/:id/offices`.
  - **Проверки:**
    - валюта счетов — KZT;
    - `projectId` уникален среди включённых клубов компании → 422 «Проект уже связан с другим клубом Senet»;
    - `historyFrom` обязателен у включённого клуба.
  - `create` записывает слова по умолчанию П2 (функция `seedDefaultRules(tx, companyId)` объявляется здесь, правила — задача 10).

- [ ] **Step 1: Серверные тесты** (поддельный сервер, `SENET_API_BASE`):
  - `check` с верным паролем → имя офиса; с неверным → 422 с текстом «Senet не принял данные входа…»;
  - `create` → в базе `credentials_secret` не содержит пароль открытым текстом;
  - в `audit_log.diff` нет `password`, `token`, `credentials_secret`;
  - ответ API не содержит пароля; `credentialsHint` — логин или `••••{4}` для токена;
  - `create` без `SECRET_KEY` в режиме vercel → 422 «Задайте SECRET_KEY в настройках Vercel»;
  - `upsertOffice`: счёт USD → 422; второй клуб с тем же проектом → 422;
  - `remove` при проводках → 409;
  - после `create` в `senet_rules` есть слова П2 без категорий.
- [ ] **Step 2: Клиентский тест:**
  - «Интеграции» в навигации после «Пользователей»;
  - окно подключения: адрес из ссылки `https://club-demo.admin-v2.enes.tech/` даёт `club-demo`, под полем — `https://club-demo.app.enes.tech`;
  - «Сохранить» недоступно до успешной «Проверить»;
  - переключатель «Логин и пароль Senet / Токен» меняет поля.
- [ ] **Step 3:** Прогнать → FAIL.
- [ ] **Step 4:** Реализовать сервис, маршруты и экраны: карточка «Senet», список подключений, окно, форма клуба с полями С§8.1.
  - Подсказка «Загружать с даты» — «Смены раньше этой даты считаются уже внесёнными вручную».
  - «Номер клуба Senet» — поле ввода, если задача 1 не нашла список офисов; иначе выбор из списка.
- [ ] **Step 5:** Прогнать → PASS; `npm run typecheck`.
- [ ] **Step 6: Commit** — `feat(senet): подключения, клубы и раздел «Интеграции»`.

### Задача 6: Забор — окно, смены, выемки, сырые файлы, журнал забора

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/sync.ts`, `src/server/modules/senet/store.ts` (запись разобранного)
- Modify: `src/server/modules/cron/daily.ts` (очистка `senet/raw/` и `senet_raw` старше 90 дней, `senet_sync_runs` сверх 500), `src/server/modules/senet/routes.ts`
- Test: `tests/server/senet-sync.test.ts`

**Interfaces:**
- Consumes: `SenetConnections.sourceFor`, `ReportRows`, `FileStore`.
- Produces:
  ```ts
  type SyncTrigger = 'hourly' | 'cron' | 'manual' | 'period';
  interface SyncResult { runId: number; result: 'ok' | 'partial' | 'failed'; counts: Record<string, number>; error: string | null; budgetExceeded: boolean }
  interface SenetSync {
    run(o: { companyId?: number; connectionId?: number; officeId?: number; trigger: SyncTrigger; from?: string; to?: string; deadline?: number /* Date.now() + мс */ }): Promise<SyncResult[]>;
    status(companyId: number): Promise<{ rejected: { connectionId: number; name: string }[] }>;  // для баннера
  }
  // Хук после записи смен клуба — подключается в задаче 11:
  type AfterOfficeSync = (tx: Executor, officeId: number) => Promise<void>;
  ```
  - **Окно клуба** — С§7: начало = min(открытие самой ранней незакрытой смены, `last_sync_at − 26 ч`), при первом заборе — `history_from`; конец — сейчас. Длинное окно режется по 7 дней.
  - **Отчёты окна:** `sessions` и `transactions` — за окно; `cashMoves` — с `начало − 1 сутки` до конца.
  - **Запись клуба — одна транзакция:**
    1. Upsert `senet_shifts` по `(office_id, opened_at)`: `end_balance`, `cash_in`, `cash_out`, `revenue`, `revenue_tx`. Окно смены и формулы — функции задачи 9; до неё сумма считается заглушкой `computeShiftTotals`, которую задача 9 заменит.
    2. Upsert `senet_cash_moves` по `(shift_id, senet_ref)` (П6). Выемка, которой нет в новом ответе и которая лежит внутри окна запроса, получает `missing_in_senet = 1`.
    3. Сырые файлы: `FileStore.put('senet/raw/{connection}/{report}/{from}_{to}_{sha}.xlsx')` и строка `senet_raw`; повтор `sha256` не пишется.
    4. `AfterOfficeSync`.
  - **Статусы:**
    - `auth_rejected` / `auth_needs_code` → подключение `key_rejected`, `last_error` — текст С§11, дальше не опрашивается;
    - `unreachable` / `server_error` → `unreachable`, запуск `failed`;
    - `bad_format` → `partial`;
    - `deadline` истёк → оставшиеся клубы пропущены, `partial`, текст «Не уложились во время — продолжим через час».
  - **Маршруты:** `POST connections/:id/sync {from?, to?}` → `{runId}` (выполняется сразу, ответ после завершения; не больше 366 дней); `GET sync-runs/:id`; `GET status`.

- [ ] **Step 1: Тесты** (поддельный сервер с образцами двух дней, `now` фиксирован):
  - первый забор берёт с `history_from`;
  - второй — с `last_sync_at − 26 ч`;
  - открытая смена → начало окна ≤ её открытия, после её закрытия смена закрывается тем же ключом;
  - повтор забора не меняет число строк;
  - две одинаковые выемки → две строки с `|1` и `|2` (Review Focus 5);
  - выемка исчезла → `missing_in_senet`;
  - 401 после входа → `key_rejected`, следующий `run({trigger:'hourly'})` его не опрашивает, `status().rejected` содержит подключение;
  - HTML вместо xlsx → `partial`, файл в `FileStore`, смены не тронуты (Review Focus 3);
  - `deadline` в прошлом → `budgetExceeded`;
  - `runDaily` удаляет сырые файлы старше 90 дней.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS на обоих диалектах.
- [ ] **Step 5: Commit** — `feat(senet): забор смен и выемок, сырые файлы, журнал забора`.

### Задача 7: Расписание, ручной запуск, баннер

`[Feature]` `[tdd:required]`

**Files:**
- Modify:
  - `src/server/main.ts` — задача `{ name: 'senet-sync', cron: '5 * * * *', run: () => inLine(db, () => senetSync.run({ trigger: 'hourly' })) }`;
  - `src/server/modules/cron/routes.ts` — `GET /api/v1/cron/senet`;
  - `vercel.json` — второй cron `{ "path": "/api/v1/cron/senet", "schedule": "5 0 * * *" }`;
  - `src/client/pages/CompanyLayout.tsx` — баннер;
  - `src/client/pages/settings/IntegrationsSettings.tsx` — «Обновить сейчас», «Загрузить за период».
- Create: `.github/workflows/senet-sync.yml`, `src/client/components/senet/AccessBanner.tsx`
- Test: `tests/server/senet-cron.test.ts`, `tests/server/main-senet.test.ts` (sqlite-only, по образцу `main*.test.ts`), `tests/client/senet-banner.test.ts`

**Interfaces:**
- Consumes: `SenetSync.run`, `SenetSync.status`.
- Produces:
  - `GET /api/v1/cron/senet` → `{ runs: SyncResult[] }` или 409 `{ code: 'SENET_SYNC_RUNNING' }`;
  - внутри: `deadline = start + 240_000`;
  - блокировка: в pg — `pg_try_advisory_lock(7002)` / `pg_advisory_unlock(7002)`; в sqlite — флаг процесса.
- Пингер: `on: schedule: - cron: '5 * * * *'` + `workflow_dispatch`; шаг `curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/v1/cron/senet"`.

- [ ] **Step 1: Тесты:**
  - без секрета → 401;
  - с секретом → вызывает `run({trigger:'cron', deadline})`;
  - параллельный второй вызов → 409;
  - в `main` есть задача `senet-sync` с cron `5 * * * *`;
  - баннер «Обновите доступ к Senet — забор остановлен» виден при `rejected.length > 0` и ведёт на `settings/integrations`.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать. Кнопки забора недоступны во время запроса, строка хода — «Загружено N из M отрезков» по `counts.chunks`.
- [ ] **Step 4:** Прогнать → PASS.
- [ ] **Step 5: Commit** — `feat(senet): расписание, cron/senet, пингер GitHub Actions, баннер доступа`.

---

## Часть СА-2 «Разноска»

### Задача 8: Нормализация, правила, классификация выемки

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/posting/normalize.ts`, `src/server/modules/senet/posting/rules.ts`, `src/server/modules/senet/posting/classify.ts`, `src/server/modules/senet/posting/bar.ts`
- Test: `tests/server/senet-classify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function normalize(comment: string): string;  // нижний регистр, ё→е, [^\p{L}\p{N}_] → пробел, схлопнуть, обрезать
  type MatchMode = 'word' | 'first' | 'phrase' | 'prefix' | 'contains';
  type RuleType = 'exact' | 'kaspi' | 'trainee' | 'salary_word' | 'extra_pay_word' | 'employee_alias' | 'master' | 'owner_word' | 'owner_a_alias' | 'lunch' | 'keyword' | 'bar_item' | 'bar_supplier';
  interface RuleRow { id: number; officeId: number | null; type: RuleType; pattern: string; match: MatchMode; priority: number; categoryId: number | null; counterpartyId: number | null; commentTemplate: string | null; flags: { mistaken?: boolean; defect?: boolean }; archived: boolean }
  interface RuleSet { /* собирается buildRuleSet; поля — на усмотрение исполнителя */ }
  function buildRuleSet(rows: RuleRow[], officeId: number, active: { categories: Set<number>; counterparties: Set<number> }): RuleSet;
  type Classified =
    | { kind: 'kaspi' }
    | { kind: 'expense'; group: 'salary' | 'lunch' | 'bar' | 'other'; categoryId: number; counterpartyId: number | null; comment: string | null; ruleId: number | null }
    | { kind: 'extra_pay'; categoryId: number; ruleId: number }  // получатель — в задаче 9
    | { kind: 'review'; reason: 'unrecognized' | 'name_only' | 'salary_no_name' | 'rule_broken'; hint: { categoryId?: number; counterpartyId?: number } | null };
  function classify(comment: string, rules: RuleSet): Classified;
  interface BarLine { itemText: string; qty: number; price: number /* тиыны */; amount: number }
  function parseBarPurchase(comment: string): BarLine[];  // все /([^\d]+?)\s*(\d+)\s*x\s*(\d+)/g по normalize
  ```
  - **Порядок** — С§4.3: exact → kaspi → trainee → salary → master → dividends → name_only → lunch → keyword (по `priority`) → bar → review.
  - **Правила клуба:** правило с `officeId` действует только в своём клубе.
  - **Сломанное правило:** архивное правило не учитывается. Правило со ссылкой на неактивную категорию или контрагента, или тип без настроечной строки категории → `rule_broken`.
  - **Комментарий** `{orig}` → исходный текст, обрезанный по краям.

- [ ] **Step 1: Тесты** — синтетический набор правил: «Оператор 1» (алиасы `op1`, `оп1`), «Оператор 2» (ошибочный алиас `vlad`), мастер `master1`, владельцы `vla`/`vlb`/`deti`, поставщики:
  - `normalize('  ZP, Оп1!! ')` === `'zp оп1'`; `normalize('Ёлка')` === `'елка'`;
  - **каспи:** `kaspi` → `{kind:'kaspi'}`; `kaspi 5000` → не каспи (фраза целиком);
  - **ЗП:**
    - `zp op1` → ЗП, Оператор 1;
    - `аванс op1` → ЗП;
    - `op1 аванс` → `unrecognized`: `аванс` не первым словом не признак ЗП, а `name_only` требует одного слова;
    - `zp vlad` → ЗП, Оператор 2 (ошибочный алиас);
    - `dop zp` → `extra_pay`;
    - `zp` → `salary_no_name` с подсказкой категории ЗП;
  - **стажёр:** `zp stajer` → ЗП без контрагента, комментарий `стажер`; `stajer` → то же (≤ 3 слов);
  - **мастер:** `master1 кран` → категория мастера, контрагент мастер;
  - **дивиденды:** `vla` → А; `vla deti` → Б; `vlb` → Б; `vla за май` → Б; ни одна ветка не создаёт контрагента;
  - **только имя:** `op1` → `name_only` с подсказкой (ЗП, Оператор 1);
  - **обед:** `obed` → lunch; `obed2` → не lunch;
  - **ключевые слова:** `voda` (phrase) → категория; `вода 5л` → не совпадает; `возвраты гостю` (prefix `возврат`, `{orig}`) → комментарий `возвраты гостю`;
  - **бар:**
    - `gorilla45x500` → bar, поставщик по умолчанию;
    - `sandwich10x500hot dog10x500` → поставщик выпечки;
    - `dizzy брак` → bar, комментарий `dizzy брак`;
    - `parseBarPurchase('sandwich10x500hot dog10x500')` → две строки, `amount` 500000 каждая;
  - **иначе:** `что-то` → `unrecognized`; `''` → `unrecognized` (Review Focus 1);
  - архивная категория у правила ЗП → `rule_broken`;
  - правило клуба 2 не действует в клубе 1.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS.
- [ ] **Step 5: Commit** — `feat(senet): нормализация, правила и классификация выемок`.

### Задача 9: План смены и сверка с эталоном

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/posting/plan.ts`, `scripts/senet-parity.ts`
- Modify: `src/server/modules/senet/sync.ts` — заменить `computeShiftTotals` на `shiftWindows` + `shiftTotals`
- Test: `tests/server/senet-plan.test.ts`, `tests/server/senet-parity.test.ts` (пропуск без `.superpowers/senet-local/senet_raw`)

**Interfaces:**
- Consumes: `classify`, `RuleSet`, `CashMoveRow`, `SessionRow`.
- Produces:
  ```ts
  interface ShiftInput { openedAt: string; closedAt: string; endBalance: number }
  interface MoveInput { id?: number; at: string; kind: 'in' | 'out'; amount: number; comment: string }
  function shiftWindows(shifts: ShiftInput[], moves: MoveInput[], prevClosedAt: string | null): { shift: ShiftInput; moves: MoveInput[] }[];
  function shiftTotals(endBalance: number, moves: MoveInput[]): { cashIn: number; cashOut: number; revenue: number };
  interface PlannedOp { ref: { kind: 'move'; moveIndex: number } | { kind: 'income'; income: 'kaspi' | 'cash' }; paidAt: string; accountId: number; amount: number; categoryId: number; counterpartyId: number | null; comment: string | null; ruleId: number | null }
  interface PlannedReview { moveIndex: number | null; reason: 'unrecognized' | 'name_only' | 'salary_no_name' | 'rule_broken' | 'no_kaspi' | 'negative_cash'; hint: object | null }
  interface ShiftPlan { revenue: number; kaspi: number; cash: number; ops: PlannedOp[]; reviews: PlannedReview[]; warnings: ('deposit_mismatch' | 'revenue_tx_mismatch')[]; barPurchases: { moveIndex: number; lines: BarLine[]; mismatch: boolean }[] }
  interface OfficeAccounts { cashAccountId: number; kaspiAccountId: number; incomeCategoryId: number }
  function planShift(o: { shift: ShiftInput; moves: MoveInput[]; prevEndBalance: number | null; revenueTx: number | null; rules: RuleSet; accounts: OfficeAccounts }): ShiftPlan;
  function placeLateOp(plan: ShiftPlan, closedAt: string): string;  // время для операции из очереди (С§4.4)
  ```
  - **Окно** — `(prevClosedAt, closedAt]`; у первой смены без `prevClosedAt` — `(openedAt − 10 с, closedAt]`.
  - **Время** — С§4.4, `X` = `closedAt` без мс.
  - **Доплата** получает первого контрагента ЗП в порядке выемок; нет такого → `salary_no_name`.
  - **Каспи / Касса** — С§4.2:
    - `kaspi = 0` → без операции, отзыв `no_kaspi`;
    - `cash < 0` → без двух доходов, отзыв `negative_cash`.

- [ ] **Step 1: Тесты:**
  - **окно:** выемка за 3 мин до закрытия, а следующая смена открылась на минуту раньше этой выемки → выемка в первой смене;
  - **выручка:** `endBalance 10000, in 3000, out [kaspi 2000, zp op1 1500]` → `revenue 10500`, `kaspi 2000`, `cash 8500`;
  - **предупреждения:** внесение ≠ `prevEndBalance` → `deposit_mismatch`; `revenueTx` ≠ выручки → `revenue_tx_mismatch`;
  - **время** (`X = 10:00:00`): `zp, zp, obed, gorilla, voda, мусор` → ЗП 10:00, 10:00; обед 10:01; бар 10:02; вода 10:03; мусор 10:04; доходы 10:05;
  - **без ЗП:** обед в 10:00;
  - **без расходов:** доходы в 10:01;
  - **доплата:** `dop zp` после `zp op1` → Оператор 1; без ЗП → `salary_no_name`;
  - нет kaspi → `no_kaspi`; касса < 0 → `negative_cash`;
  - **бар:** `parseBarPurchase` с несходящейся суммой → `mismatch: true`;
  - **`placeLateOp`** ставит после последней прочей выемки, но не позже доходов.
- [ ] **Step 2:** `scripts/senet-parity.ts`:
  - запускает `python -c` с обёрткой: импорт `senet_to_finmap` из `.superpowers/senet-local`, `build_shifts` + `shift_to_ops`, вывод JSON;
  - строит `rules.json` из констант эталона (`EMPLOYEES`, `OWNER_FAMILY_WORDS`, `BAR_SUPPLIERS`, `OTHER_RULES`…) с выдуманными id категорий и контрагентов по именам;
  - прогоняет `planShift` по тем же xlsx и сравнивает по ключу «время, счёт, категория, контрагент, сумма, комментарий»;
  - строки эталона «проверить» сравниваются с `reviews`;
  - выводит число совпадений и расхождения;
  - проверяет остаток «Сумма + 88».

  Тест `senet-parity` вызывает скрипт за 08–31.10.2026 и ждёт `0` расхождений; без каталога — `it.skip`.
- [ ] **Step 3:** Прогнать → FAIL.
- [ ] **Step 4:** Реализовать `plan.ts`; в `sync.ts` использовать `shiftWindows` / `shiftTotals`.
- [ ] **Step 5:** Прогнать → PASS. Локально `timeout 300 npx tsx scripts/senet-parity.ts --from 2026-10-08 --to 2026-11-01` → «Расхождений: 0». Если не 0 — разобрать по эталону, а не подгонять тест.
- [ ] **Step 6: Commit** — `feat(senet): план смены и сверка с эталоном`.

### Задача 10: Правила разноски — API, экран, «Проверить на истории»

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/rules-service.ts`, `src/client/components/senet/RulesTab.tsx`, `src/client/components/senet/HistoryCheck.tsx`
- Modify: `src/server/modules/senet/routes.ts`, `src/server/modules/senet/connections.ts` (`seedDefaultRules`), `src/client/pages/settings/IntegrationsSettings.tsx` (вкладки «Подключения» / «Правила разноски»)
- Test: `tests/server/senet-rules.test.ts`, `tests/client/senet-rules.test.ts`

**Interfaces:**
- Consumes: `RuleRow`, `buildRuleSet`, `planShift`.
- Produces:
  - `GET rules` → `RuleRow[]`;
  - `POST rules`; `PATCH rules/:id`; `DELETE rules/:id` (архив);
  - `PUT rules/order {type: 'keyword', ids: number[]}` — `priority` по порядку;
  - `POST rules/check-history {officeId, from, to}` → `{ total: number; recognized: number; unrecognized: { moveId; at; amount; comment; reason }[]; differs: { moveId; operationId; was: {categoryId, counterpartyId}; would: {categoryId, counterpartyId} }[] }`.
  - **Проверки:** `pattern` нормализуется при сохранении; пустой `pattern` допустим только у настроечных строк типа; дубль `(type, pattern, officeId)` → 422 «Такое правило уже есть».
  - **История:** правка правил пишется как сущность `senet_rule`.

- [ ] **Step 1: Тесты:**
  - CRUD;
  - нормализация `pattern`;
  - порядок ключевых слов;
  - «Проверить на истории» по выемкам из образца → `recognized`, список нераспознанных;
  - `differs` содержит выемку, проведённую вручную в другую категорию;
  - в базе после вызова ничего не изменилось (число операций и пунктов очереди то же);
  - **клиент:** секции С§8.1; перетаскивание ключевых слов; «только для клуба»; итог «Распознано N из M».
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS.
- [ ] **Step 5: Commit** — `feat(senet): правила разноски и «Проверить на истории»`.

### Задача 11: Автопроводка

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/post.ts`, `src/server/modules/senet/links.ts`
- Modify:
  - `src/server/modules/senet/sync.ts` — `AfterOfficeSync` = `postOffice`;
  - `src/server/modules/operations/service.ts`:
    - `restoreOp` вызывает `assertSenetRestorable(db, id)`;
    - `get` добавляет `senet: { shiftId: number; kind: 'move' | 'kaspi' | 'cash' } | null`;
  - `src/client/components/operation/OperationForm.tsx` — галочка «Не проводить повторно из Senet» в подтверждении удаления, только при `senet !== null`.
- Test: `tests/server/senet-post.test.ts`, `tests/server/senet-undo.test.ts`, `tests/client/operation-senet-delete.test.ts`

**Interfaces:**
- Consumes: `planShift`, `OperationsService.create`, `withTx`.
- Produces:
  ```ts
  function postOffice(tx: Executor, officeId: number): Promise<{ posted: number; queued: number; errors: number }>;
  function repostIncomes(companyId: number, shiftId: number, userId: number): Promise<void>;  // «Перепровести доходы смены»
  function setNoRepost(companyId: number, operationId: number, value: boolean, userId: number): Promise<void>;
  function assertSenetRestorable(ex: Executor, operationId: number): Promise<void>;  // AppError 409 «Senet уже провёл эту выемку заново — удалите новую операцию»
  function senetLinkOf(ex: Executor, operationId: number): Promise<{ shiftId: number; kind: 'move' | 'kaspi' | 'cash' } | null>;
  ```
  - **Маршруты:** `PATCH links/:operationId {noRepost}`; `POST shifts/:id/repost-incomes`.
  - **Смены:** проводятся закрытые смены клуба с `opened_at ≥ history_from`.
  - **Транзакция:** `withTx` на смену; сбой → откат смены, `senet_shifts.post_error = текст`, остальные смены идут дальше (Review Focus 4).
  - **Операции:** `operations.create(companyId, input, connection.createdBy)`:
    - `lines: [{ categoryId, projectId: office.projectId, amount }]`;
    - `accrualDate` = дата `paidAt` по `APP_TIMEZONE`;
    - история — с `diff.via = 'senet'`.
  - **Проведённое:** проводка жива, если `operations.deleted_at IS NULL`. Удалённая без `no_repost` → новая операция, старая — в `prev_operation_id`.
  - **Изменения после проведения:**
    - `revenue` или распределение изменились → `changed_after_post = 1`, доходы не трогаются;
    - `repostIncomes` правит обе суммы через `operations.update` и снимает отметку.
  - **Аналитика:** `senet_bar_purchases` записывается по плану.

- [ ] **Step 1: Тесты:**
  - забор образца → операции:
    - счета, категории, контрагенты, проект;
    - `paidAt` по С§4.4;
    - `accrualDate`;
  - повторный забор → то же число операций;
  - смена до `history_from` не проводится;
  - открытая смена не проводится, после закрытия — проводится;
  - ошибка `operations.create` на 3-й операции (подмена) → смена без операций, `post_error`, соседняя проведена;
  - удалить операцию выемки → следующий забор провёл заново, `prev_operation_id` = старая;
  - `setNoRepost` + удалить → не проводится;
  - «Отмена» удаления старой → 409 с текстом (`senet-undo`); без замены — восстановление проходит, проводка снова её;
  - изменилась выручка → `changed_after_post`, суммы доходов прежние; `repostIncomes` → новые суммы;
  - новая поздняя выемка → проведена с `placeLateOp`;
  - две одинаковые выемки → две операции (Review Focus 5);
  - **клиент:** галочка есть только у операции с `senet`; при отмеченной галочке `PATCH links` уходит раньше `DELETE`.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS на обоих диалектах; `npm test` целиком (операции и отмена не сломаны).
- [ ] **Step 5: Commit** — `feat(senet): автопроводка смен`.

### Задача 12: Очередь «Разобрать»

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/review.ts`, `src/server/modules/senet/suggest.ts`, `src/client/components/senet/ReviewQueue.tsx`
- Modify: `src/server/modules/senet/post.ts` (пункты из `plan.reviews`; закрытие пунктов, ставших распознаваемыми), `src/server/modules/senet/routes.ts`
- Test: `tests/server/senet-review.test.ts`, `tests/server/senet-suggest.test.ts`, `tests/client/senet-review.test.ts`

**Interfaces:**
- Consumes: `classify`, `placeLateOp`, `OperationsService.create/update`, `RulesService.create`.
- Produces:
  ```ts
  interface ReviewItemDto { id: number; shiftId: number; shiftLabel: string; officeId: number; cashMoveId: number | null; amount: number | null; comment: string | null; reason: PlannedReview['reason']; suggestions: { categoryId: number; counterpartyId: number | null; label: string }[]; status: 'open' | 'answered' | 'dismissed' }
  type ReviewAnswer =
    | { kind: 'expense'; categoryId: number; counterpartyId: number | null; comment: string | null; remember: boolean }
    | { kind: 'kaspi'; amount: number }        // no_kaspi: amount 0 — «Каспи не было»
    | { kind: 'incomes'; kaspi: number; cash: number }  // negative_cash
    | { kind: 'dismiss' };
  interface SenetReview {
    list(companyId: number, o: { status?: 'open' | 'answered' | 'dismissed'; officeId?: number }): Promise<ReviewItemDto[]>;
    answer(companyId: number, id: number, a: ReviewAnswer, by: { userId: number; via: 'web' | 'telegram' }): Promise<ReviewItemDto>;
  }
  function suggest(ex: Executor, item: { companyId: number; comment: string; amount: number; at: string; hint: object | null }): Promise<ReviewItemDto['suggestions']>;  // ≤ 3, без повторов
  ```
  - **Маршруты:** `GET review?status=&office=`, `POST review/:id/answer` (тело — `ReviewAnswer`, `via` = `web`). Права — как у `POST operations`; правило с `remember` — как у правки справочников.
  - **`answer` — одна транзакция:**
    - `expense` → операция по `placeLateOp`;
    - `remember` → правило `exact` с `created_from_review = 1`; затем открытые пункты компании с тем же нормализованным комментарием проводятся и закрываются;
    - `kaspi` → доход Каспи `amount` и доход Касса минус `amount` (`operations.update`);
    - `incomes` → два дохода;
    - `dismiss` → `no_repost = 1` у выемки.
  - **Отказы:**
    - `remember` при пустом комментарии → 422 «Нельзя запомнить пустой комментарий» (Review Focus 1);
    - повторный ответ → 409.

- [ ] **Step 1: Тесты:**
  - каждый `reason` появляется при заборе образца;
  - пункт не дублируется при повторном заборе;
  - `answer expense` создаёт операцию и закрывает пункт: `answered_by`, `answered_via = 'web'`;
  - `remember` создаёт правило и закрывает второй пункт с тем же комментарием;
  - вызов сервиса с `via: 'telegram'` сохраняет `telegram`;
  - `no_kaspi` с суммой 2000 → доход Каспи 2000, Касса уменьшилась на 2000;
  - `no_kaspi` с 0 → закрыт без операций;
  - `negative_cash` → два дохода;
  - `dismiss` → следующий забор пункт не создаёт;
  - добавили алиас → следующий забор провёл выемку и закрыл пункт;
  - `suggest`: подсказка правила первой, затем частая пара по общим словам, затем по сумме за 30 дней; не больше 3;
  - **клиент:** карточка С§8.4; предложения заполняют поля; «Запомнить для "{комментарий}"» скрыто у пустого комментария.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS.
- [ ] **Step 5: Commit** — `feat(senet): очередь «Разобрать»`.

---

## Часть СА-3 «Сверка и данные»

### Задача 13: API сверки

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/server/modules/senet/reconcile.ts`
- Modify: `src/server/modules/senet/routes.ts`
- Test: `tests/server/senet-reconcile.test.ts`

**Interfaces:**
- Consumes: таблицы `senet_*`, остатки счёта (`balances` / ledger — та же функция, что у «Счетов» на момент времени).
- Produces:
  ```ts
  type ShiftState = 'ok' | 'cash_diff' | 'review' | 'not_posted' | 'open' | 'changed' | 'deposit_mismatch';
  interface ShiftRowDto { id: number; officeId: number; openedAt: string; closedAt: string | null; cashier: string; revenue: number; revenueTx: number | null; kaspi: { posted: number; senet: number }; cash: { posted: number; senet: number }; moves: { posted: number; total: number; queued: number }; cashAfter: { senet: number /* end_balance + cash_offset */; journal: number }; states: ShiftState[] }
  // GET shifts?project=&from=&to=&onlyDiff= →
  { rows: ShiftRowDto[]; totals: Pick<ShiftRowDto, 'revenue' | 'kaspi' | 'cash'>; firstCashDiffId: number | null }
  // GET shifts/:id → ShiftRowDto & { moves: (CashMove & { ruleId; operationId; noRepost; missingInSenet })[]; incomes: ...; warnings: string[]; operations: OperationDto[] }
  ```
  - **«Касса после смены, журнал»** — остаток `cash_account_id` на момент `max(closed_at, paidAt последней операции смены)` включительно.
  - **Смены до `history_from`:** `not_posted`; их операции относятся к смене по С15§6.2 (счёт клуба, `paid_at` в `[opened_at, closed_at + 3 ч)`).
  - **`firstCashDiffId`** — самая ранняя смена периода, где `journal ≠ senet`.
  - **`GET offices/:id/history-from-suggestion`** → `{ openedAt: string | null }` — начало первой сохранённой закрытой смены, после закрытия которой на счёте кассы клуба нет операций (С§5.5). Нет сохранённых смен → `null`.

- [ ] **Step 1: Тесты:**
  - после автопроводки образца `cashAfter.journal === cashAfter.senet` при `cash_offset` = разнице начального остатка счёта;
  - ручная лишняя операция в середине → `cash_diff` с этой смены, `firstCashDiffId` = она;
  - каждое состояние из `ShiftState` на своём образце;
  - `onlyDiff`;
  - итоги;
  - `history-from-suggestion`: операции журнала до закрытия 2-й смены образца → начало 3-й;
  - раскрытая смена содержит правила и ссылки на операции.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS.
- [ ] **Step 5: Commit** — `feat(senet): API «Сверки Senet»`.

### Задача 14: Экран «Сверка Senet»

`[Feature]` `[tdd:required]`

**Files:**
- Create: `src/client/pages/SenetPage.tsx`, `src/client/components/senet/ShiftsTable.tsx`, `src/client/components/senet/ShiftDetails.tsx`
- Modify:
  - `src/client/router.tsx` — `c/:companyId/senet/:tab`, где `tab` = `shifts | review`;
  - `src/client/pages/CompanyLayout.tsx` — вкладка «Сверка Senet» после «Журнала», видна при подключении, со счётчиком очереди;
  - `src/client/components/MobileTabBar.tsx` — «Ещё» → «Сверка Senet».
- Test: `tests/client/senet-page.test.ts`

**Interfaces:**
- Consumes: API задачи 13, `ReviewQueue` (задача 12), `AccessBanner` (задача 7).

- [ ] **Step 1: Тесты:**
  - вкладка скрыта без подключения;
  - колонки С§8.3;
  - строка `firstCashDiffId` подсвечена, «К первому расхождению» прокручивает к ней;
  - раскрытая смена — выемки с правилом и ссылкой, переключатель «Не проводить повторно», кнопка «Перепровести доходы смены» только при `changed`;
  - вкладка «Разобрать (K)»;
  - на узком экране строки — карточками.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать: отбор клуба и периода — как в журнале, «Только с расхождениями». В форме клуба (`OfficeForm`) рядом с «Загружать с даты» — кнопка «Предложить» (`history-from-suggestion`).
- [ ] **Step 4:** Прогнать → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(senet): экран «Сверка Senet»`.

### Задача 15: Данные для склада и аналитики

`[Feature]` `[tdd:required]`

**Files:**
- Modify: `src/server/modules/senet/sync.ts`, `src/server/modules/senet/store.ts`, `src/server/modules/senet/xlsx-reports.ts`
- Если задача 1 дала колонки: добавить в схемы `senet_stock`, `senet_goods_moves`, `senet_load` миграцией `0014` / pg `0004`.
- Test: `tests/server/senet-analytics-data.test.ts`

**Interfaces:**
- Consumes: `ReportRows`, `Secrets.phoneHash`, `phoneMask`.
- Produces: заполненные `senet_transactions`, `senet_sold_items` (с `shift_id` по окну смены), `senet_checks`, `senet_refills` по П5; `stock`, `goodsMoves`, `load` — по колонкам задачи 1, иначе только сырой файл.

- [ ] **Step 1: Тесты:**
  - забор окна заполняет таблицы;
  - повторный забор того же окна не меняет число строк;
  - строка, исчезнувшая из Senet, исчезает из таблицы;
  - в `senet_checks` и `senet_refills` нет телефона открытым текстом (поиск цифр образца по всем колонкам);
  - `phone_mask` = `+7 *** ** 12`;
  - `soldItems` время → `shift_id` своей смены.
- [ ] **Step 2:** Прогнать → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогнать → PASS на обоих диалектах.
- [ ] **Step 5: Commit** — `feat(senet): данные для склада и аналитики`.

### Задача 16: e2e, снимки, README, итог

`[Test]` `[tdd:skip:e2e-and-docs]`

**Files:**
- Create: `e2e/senet.spec.ts`
- Modify:
  - `e2e/server.ts` — поддельный сервер Senet и `SENET_API_BASE`;
  - `scripts/ux-shots.ts` — `c68-integrations.png`, `c69-senet-connection.png`, `c70-senet-rules.png`, `c71-senet-history-check.png`, `c72-senet-shifts.png`, `c73-senet-shift-open.png`, `c74-senet-review.png`;
  - `README.md` — раздел «Senet — временный источник» (С§12.6).
- Create: `docs/superpowers/followups/2026-11-0X-senet-autopost-followups.md`

- [ ] **Step 1:** e2e:
  - подключение через поддельный сервер;
  - клуб и связи;
  - «Загрузить за период»;
  - журнал показывает операции смены;
  - очередь: ответ с «Запомнить»;
  - «Сверка Senet»: «К первому расхождению» после ручной операции;
  - удаление с «Не проводить повторно»;
  - неверный пароль → баннер;
  - телефон: «Ещё» → «Сверка Senet», карточки.
- [ ] **Step 2:** `timeout 900 npm run test:e2e -- e2e/senet.spec.ts` — два прогона PASS; `E2E_DB=pg` — один прогон PASS.
- [ ] **Step 3:** `timeout 900 npm run shots:ux` → все снимки, +7 новых.
- [ ] **Step 4:** README: отдельный пользователь Senet, токен вручную, «Обновите доступ к Senet», `SECRET_KEY`, секреты репозитория `CRON_SECRET` / `APP_URL` и включение пингера.
- [ ] **Step 5:** Полный прогон: `npm test`, `npm run typecheck`, `npm run lint:async`, `npm run test:e2e`.
- [ ] **Step 6:** Чек-лист приёмки С§12.5 в followups — для прогона с владельцем.
- [ ] **Step 7: Commit** — `test(senet): e2e, снимки, README`.

---

## Phase 5 в `Plans.md`

| Task | Задача плана | Depends |
|---|---|---|
| 37 | 1 Пробный забор | - |
| 38 | 2 Схема | - |
| 39 | 3 Секреты | 38 |
| 40 | 4 Источник | 39 |
| 41 | 5 Подключения | 40 |
| 42 | 6 Забор | 41 |
| 43 | 7 Расписание | 42 |
| 44 | 8 Классификация | 38 |
| 45 | 9 План и эталон | 44 |
| 46 | 10 Правила | 41, 45 |
| 47 | 11 Автопроводка | 42, 45 |
| 48 | 12 Очередь | 46, 47 |
| 49 | 13 API сверки | 47 |
| 50 | 14 Экран сверки | 48, 49 |
| 51 | 15 Данные | 37, 42 |
| 52 | 16 e2e, README | 43, 50, 51 |
