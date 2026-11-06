# АК-3 «Аналитика клуба: Гости» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** отчёт «Гости» (§7): кто гость (связанные логины и телефоны), визиты, плитки и ряд новых и вернувшихся, возраст, когорты, постоянные гости и карточка гостя с «Это один гость» и «Разделить»; плитки гостей в «Обзоре клуба» (§4).

**Architecture.**
- **Чистые функции** — `src/shared/club-analytics/guest-links.ts` (ключи, общие логины, группы гостей с ручными правками, гость строки) и `guests.ts` (визиты, цифры по корзинам, возраст, когорты, топ).
- **Сервер** — `src/server/modules/club-analytics/guests.ts` (данные гостей, отчёт, карточка, поиск, Excel) и `guest-links.ts` (таблица `senet_guest_links`, правки, история). SQL берёт пары «логин — телефон» и строки, считают чистые функции. «Обзор» берёт цифры гостей оттуда же.
- **Клиент** — страница `ClubGuestsPage` на каркасе `ClubReportScreen`. Плитки — компонент `Tile` «Обзора». Ряд — `StackedBars` с форматом числа. Таблица постоянных гостей, карточка гостя, когорты.

**Tech Stack:** Fastify 5, Drizzle (SQLite и Postgres), Zod, React 19, TanStack Query, Vitest (unit, server-sqlite, server-pg), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-club-analytics-design.md` — §7, §4 (плитки гостей), §11 (маршруты гостей), §12, §14. Решения этого плана — §18 спецификации, их записывает задача 1. Итоги АК-2 — `docs/superpowers/followups/2026-11-06-club-analytics-2-followups.md`.

## Global Constraints

- **Миграции — в обеих базах:**
  - SQLite: `src/server/db/migrations`, следующая — `0019`;
  - Postgres: `src/server/db/migrations-pg`, следующая — `0009`.
- **Генерация миграций:** `npm run db:generate`. Затем переименовать файлы и поправить `tag` в `meta/_journal.json` по смыслу: `0019_senet_guest_links`, `0009_senet_guest_links`.
- **Таблица регистрируется в трёх местах:** `schema-sqlite.ts`, `toPgTables` в `schema-pg.ts` и экспорт в `schema.ts`.
- **Хеш телефона и ключ `phone:…` никогда не уходят наружу** (§7.1, §12): ни в ответ API, ни в Excel, ни в историю действий, ни в журнал сервера. Гость и ключ наружу — только `ref` (R25); телефон — только `phone_mask`.
- **Логины приводятся к нижнему регистру в JS** (`toLocaleLowerCase('ru')`), не в SQL: `lower()` в SQLite не понимает кириллицу.
- **Время:** дни, месяцы и дни недели — в `config.timezone`. Визит относится ко дню своего начала (§2.3).
- **Деньги** Senet — в тиынах; на экране — `clubMoney`.
- **Права:**
  - чтение отчётов — по сессии, архивную компанию тоже можно читать;
  - правка связей — CSRF и `requireCompany(db, cid, { writable: true })`, строка в истории через `mutate`.
- **Тексты интерфейса** — дословно из спецификации, где она их задаёт.
- **Данные** в тестах, снимках и репозитории — только синтетические (§12).
- **Проверка каждой задачи:**
  - `npm test`, `npm run typecheck`, `npm run lint:async` — зелёные;
  - новая логика — в чистых функциях верхнего уровня, CRAP < 10 (crapper с узким `--coverage-command`);
  - полный `npm test` — в задачах 3–6 и 9; в клиентских задачах и задачах с чистыми функциями — тесты задачи и typecheck (как Task 1 Ruling АК-2).
- **Без субагентов** (решение владельца 2026-10-18): выполняет основная сессия, финальное ревью — самопроверка.
- **Пуш** в `stage1/plan1-skeleton` — без вопроса; force-push — только с вопросом.
- **«Загрузить за период» на проде не запускать:** Vercel Blob приостановлен. Проверка на проде — после разморозки.

## Review Focus

1. **Общий логин с телефоном:** строки идут гостю телефона и не склеивают двух людей; строки без телефона попадают в «Общие логины: N сеансов» (R19). Тесты — в задачах 1 и 4.
2. **Хеш телефона не уходит наружу:**
   - его нет в ответах отчёта, карточки и поиска, в листах Excel и в строке истории;
   - `ref` не совпадает с хешем и не содержит его.

   Тесты — в задачах 3, 4 и 5.
3. **«Разделить», потом новые данные:**
   - вынутый ключ не возвращается в группу автоматически;
   - «Это один гость» после «Разделить» снова связывает;
   - «Снять правку» возвращает как было.

   Тесты — в задачах 1 и 3.
4. **Период, захватывающий первые 30 дней данных:** полоса «Данные Senet начинаются {дата} — гости этих дней считаются новыми». Период позже — полосы нет. Тест — в задаче 4.
5. **Регистр и пробелы в логине:** «Ivan», «ivan » и «ИВАН» / «иван» — один ключ. Пустой логин — не ключ. Тест — в задаче 1.

---

### Task 1: Связи гостей — чистые функции

**Files:**
- Create: `src/shared/club-analytics/guest-links.ts`, `tests/shared/club-guest-links.test.ts`
- Modify: спецификация — новый §18 «Решения планирования плана АК-3» (R17–R27, раздел «Решения» ниже)

**Interfaces:**
- Produces:
  ```ts
  export type GuestKey = string; // 'login:{логин в нижнем регистре}' | 'phone:{hash}'
  export const SHARED_LOGIN_PHONES = 3;   // больше 3 разных телефонов — общий логин (§7.1)
  export const SHARED_WINDOW_DAYS = 90;
  export function loginKey(login: string): GuestKey | null;      // trim + toLocaleLowerCase('ru'); '' → null
  export function phoneKey(hash: string | null): GuestKey | null; // null/'' → null
  /** Различные пары «логин — телефон» строк Senet (сеансы, пополнения, чеки, абонементы). */
  export interface KeyPair { login: string; phoneHash: string | null; phoneMask: string | null; lastAt: string }
  export function sharedLogins(pairs: readonly KeyPair[], since: string): Set<GuestKey>;
  export interface GuestLink { kind: 'merge' | 'split'; a: GuestKey; b: GuestKey }
  export interface Guests {
    /** Ключ → номер гостя; номера 0…n−1 по возрастанию наименьшего ключа группы. */
    of: Map<GuestKey, number>;
    /** Ключи гостя по номеру, по возрастанию. */
    keys: GuestKey[][];
  }
  export function groupGuests(pairs: readonly KeyPair[], shared: ReadonlySet<GuestKey>, links: readonly GuestLink[]): Guests;
  /** Гость строки (R18, R19): по логину-ключу, иначе по телефону; 'shared' — общий логин без телефона; 'none' — ни логина, ни телефона. */
  export function rowGuest(g: Guests, shared: ReadonlySet<GuestKey>, login: string, phoneHash: string | null): number | 'shared' | 'none';
  ```

**Правила** (их проверяют тесты):
- **Узлы.** Узлы графа:
  - ключи логинов, кроме общих;
  - ключи телефонов;
  - ключи из правок `merge`.
- **Общий логин.** `sharedLogins`: у логина больше `SHARED_LOGIN_PHONES` разных телефонов среди пар с `lastAt >= since`.
- **Автоматическая связь** — пара, в которой оба ключа есть и ни один не вынут правкой `split`. Связи соединяются через union-find: так получаются связные компоненты.
- **`merge(a, b)`** связывает всегда, даже вынутый ключ. Правка с общим логином не действует.
- **`split`** хранится как `a === b === X` (R18). Ключ X не связывается автоматически ни с кем; правки `merge` с X действуют.
- **`rowGuest`:**
  - логин — ключ (непустой и не общий) → гость логина;
  - иначе есть телефон → гость телефона;
  - иначе: общий логин → `'shared'`, пустой → `'none'`.

- [ ] **Step 1: Тесты** `tests/shared/club-guest-links.test.ts` (хеши — `'h1'`…`'h9'`):
  - **ключи:**
    - `loginKey(' Ivan ')`, `loginKey('ivan')` → `'login:ivan'`;
    - `loginKey('ИВАН')` → `'login:иван'`;
    - `loginKey('  ')` → `null`;
    - `phoneKey(null)` → `null`;
  - **логин с двумя телефонами:** пары `(a,h1)`, `(a,h2)` → один гость `['login:a','phone:h1','phone:h2']`;
  - **телефон с двумя логинами:** `(a,h1)`, `(b,h1)` → один гость;
  - **цепочка из трёх:** `(a,h1)`, `(b,h1)`, `(b,h2)`, `(c,h2)` → один гость с 5 ключами;
  - **общий логин с 4 телефонами** `(guest,h1…h4)` за 90 дней:
    - `sharedLogins` → `{'login:guest'}`;
    - 4 гостя-телефона;
    - `rowGuest(g, shared, 'guest', 'h2')` → гость `phone:h2`;
    - `rowGuest(g, shared, 'guest', null)` → `'shared'`;
  - **те же 4 телефона, но 2 из них раньше `since`** → логин не общий: один гость;
  - **ручное «Разделить» сильнее автоматической связи:**
    - `(a,h1)`, `(b,h1)` и `split(h1,h1)` → гости `[login:a]`, `[login:b]`, `[phone:h1]`;
    - `rowGuest(g, s, 'a', 'h1')` → гость `login:a`;
    - новая пара `(c,h1)` тоже не связывает `c` с `h1`;
  - **`merge` после `split`:** `split(h1,h1)` + `merge(login:a, phone:h1)` → `a` и `h1` — один гость, `b` — отдельно;
  - **`merge` двух логинов без общего телефона:** `(a,h1)`, `(b,h2)` + `merge(login:a, login:b)` → один гость с 4 ключами;
  - **без ключей:** `rowGuest(g, s, '', null)` → `'none'`;
  - **номера гостей** — по возрастанию наименьшего ключа: гость `login:a` раньше гостя `login:b`.
- [ ] **Step 2:** `npx vitest run --project unit tests/shared/club-guest-links.test.ts` → FAIL (нет модуля).
- [ ] **Step 3:** Реализовать `guest-links.ts` по Interfaces и правилам.
- [ ] **Step 4:** Тот же запуск → PASS; crapper на `guest-links.ts` < 10.
- [ ] **Step 5:** Записать §18 спецификации (раздел «Решения» ниже). Коммит `feat(club): связи гостей — ключи, общие логины, группы с правками`.

### Task 2: Визиты, цифры, возраст, когорты — чистые функции

**Files:**
- Create: `src/shared/club-analytics/guests.ts`, `tests/shared/club-guests.test.ts`

**Interfaces:**
- Consumes: `localParts` (`hours.ts`).
- Produces:
  ```ts
  export const VISIT_GAP_SEC = 1800;
  export interface GuestSession { guest: number; startAt: string; endAt: string; debited: number; age: number | null; zone: string; workstation: number | null }
  export interface Visit { guest: number; startAt: string; endAt: string; sessions: GuestSession[] }
  export function visitsOf(sessions: readonly GuestSession[]): Visit[];   // по гостю и началу
  /** Первый визит гостя за всё переданное. */
  export function firstVisits(visits: readonly Visit[]): Map<number, string>;
  export interface GuestFigures { guests: number; newGuests: number; returning: number; visits: number; visitSec: number }
  /** Цифры корзин — локальных дней `[from, to]` включительно: визиты, начатые в корзине. */
  export function guestBuckets(visits: readonly Visit[], first: ReadonlyMap<number, string>, buckets: readonly { from: string; to: string }[], timeZone: string): GuestFigures[];
  export const AGE_LABELS = ['до 14', '14–17', '18–24', '25–34', '35+', 'не указан'] as const;
  export function ageBuckets(ages: readonly (number | null)[]): { label: string; count: number; share: number }[];
  /** Последний указанный возраст гостя в визитах (R23). */
  export function lastAges(visits: readonly Visit[]): Map<number, number | null>;
  export interface CohortRow { month: string; size: number; shares: (number | null)[] } // shares[0…6]
  export function cohorts(visits: readonly Visit[], first: ReadonlyMap<number, string>, months: readonly string[], currentMonth: string, timeZone: string): CohortRow[];
  ```

**Правила** (их проверяют тесты):
- **Визит (R20).** Сеансы одного гостя, отсортированные по началу. Следующий сеанс входит в визит, если его начало минус конец визита меньше `VISIT_GAP_SEC`. Конец визита — наибольший конец его сеансов.
- **`guestBuckets`:**
  - гость корзины — тот, у кого в ней начат визит;
  - «новый» — его первый визит тоже в корзине (`first ≥ начала корзины`);
  - `returning = guests − newGuests`;
  - `visitSec` — сумма длительностей визитов корзины, от начала до конца.
- **`ageBuckets`:**
  - границы: <14, 14–17, 18–24, 25–34, ≥35, `null` → «не указан»;
  - `share` — доля от числа переданных;
  - пустой список → `share` 0 у всех корзин.
- **`cohorts` (R24):**
  - когорта — месяц (`YYYY-MM`) первого визита;
  - `shares[k]` — доля гостей когорты с визитом в месяце `month + k`;
  - месяц позже `currentMonth` → `null`;
  - `size === 0` → все `null`.

- [ ] **Step 1: Тесты** `tests/shared/club-guests.test.ts` (пояс `Asia/Almaty`):
  - **визиты с перерывом 29 и 31 минута:**
    - 10:00–11:00 и 11:29–12:00 → 1 визит 10:00–12:00, 2 сеанса;
    - 10:00–11:00 и 11:31–12:00 → 2 визита;
    - перерыв ровно 30 минут → 2 визита;
    - наложенные сеансы на двух местах 10:00–11:00 и 10:30–11:30 → 1 визит до 11:30;
  - **`guestBuckets` за неделю 02–08.11:**
    - гость 0: первый визит 20.10, визит 03.11;
    - гость 1: первый визит 04.11, второй 06.11;
    - корзина недели → `{ guests: 2, newGuests: 1, returning: 1, visits: 3 }`;
    - корзина дня 06.11 → гость 1 `returning` (первый визит 04.11 раньше дня);
    - визит, начатый 01.11 в 23:50 и закончившийся 02.11, в корзину 02.11 не входит;
  - **`ageBuckets([13, 14, 17, 18, 25, 35, null, null])`** → по корзинам `count` 1, 2, 1, 1, 1, 2; `share` «не указан» — 0.25;
  - **`lastAges`:** визиты гостя с возрастом 19, потом `null`, потом 20 → 20; все `null` → `null`;
  - **когорты с неполным месяцем** (`currentMonth` = `'2026-11'`, месяцы `['2026-09', '2026-10']`):
    - 2 гостя когорты 09: оба в 09, один в 10, никого в 11 → `shares` `[1, 0.5, 0, null, null, null, null]`;
    - когорта 10 без гостей → `size 0`, все `null`;
    - визит 01.11 00:30 по Алматы (31.10 19:30 UTC) относится к месяцу 11.
- [ ] **Step 2:** `npx vitest run --project unit tests/shared/club-guests.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать `guests.ts`.
- [ ] **Step 4:** Тот же запуск → PASS; crapper < 10.
- [ ] **Step 5:** Коммит `feat(club): визиты, цифры гостей, возраст, когорты`.

### Task 3: Ручные правки — `senet_guest_links`, API, история

**Files:**
- Create:
  - `src/server/modules/club-analytics/guest-links.ts`;
  - миграции `0019_senet_guest_links.sql` и pg `0009_senet_guest_links.sql`;
  - тест `tests/server/club-guest-links.test.ts`.
- Modify:
  - `schema-sqlite.ts`, `schema-pg.ts` (`toPgTables`), `schema.ts`;
  - `src/shared/schemas/club-analytics.ts`;
  - `routes.ts` и сборку модулей (там же, где `createClubZones`);
  - `src/client/lib/audit-format.ts` — `ENTITY_LABELS.senet_guest_link = 'Связь гостей'` и сущность в `COMPANY_ENTITIES`;
  - тест схемы `schema-0013` — проверить новую таблицу.

**Interfaces:**
- **Таблица** `senet_guest_links`:
  - `id`;
  - `company_id` → `companies`;
  - `key_a`, `key_b` (text);
  - `kind` (`merge | split`);
  - `created_by` → `users`;
  - `created_at`.

  Уникальный ключ — `(company_id, kind, key_a, key_b)`. У `merge` ключи хранятся по возрастанию, у `split` — `key_a = key_b`.
- **`ref`:**
  ```ts
  /** Ссылка на ключ наружу (R25): первые 16 hex sha256('guest:' + key). */
  export function keyRef(key: GuestKey): string;
  /** Правки компании для groupGuests. */
  export async function guestLinks(db: Db, companyId: number): Promise<(GuestLink & { id: number; createdAt: string })[]>;
  /** Пары компании (по всем клубам Senet её подключений, R17): логин, хеш, маска, последнее время — из senet_load, senet_refills, senet_checks, senet_tickets. */
  export async function companyPairs(db: Db, companyId: number): Promise<KeyPair[]>;
  /** Группы гостей компании на сегодня: пары, общие логины за 90 дней до now, правки. */
  export async function companyGuests(db: Db, companyId: number, now: string): Promise<{ guests: Guests; shared: Set<GuestKey>; pairs: KeyPair[]; links: Awaited<ReturnType<typeof guestLinks>> }>;
  export function createGuestLinks(d: { db: Db; audit: AuditService; now: () => Date }): {
    create(companyId: number, input: GuestLinkInput, userId: number): Promise<{ id: number }>;
    remove(companyId: number, linkId: number, userId: number): Promise<void>;
  };
  ```
- **Вход правки:** `guestLinkInputSchema = { kind: 'merge' | 'split', a: ref, b: ref }`, где `ref` — `/^[0-9a-f]{16}$/`.
  - `merge`: `a` и `b` — ссылки гостей. Каждая ссылка разрешается в ключ, `ref` которого с ней совпадает.
  - `split`: `a` — ключ, который вынимают; `b` — гость, из которого его вынимают.
- **Ошибки:**
  - ссылки нет среди ключей компании → 404 «Гость не найден»;
  - `merge` одного и того же гостя → 422 «Это уже один гость»;
  - `split` ключа не из гостя `b` или гостя из одного ключа → 422 «Нечего разделять»;
  - такая же правка уже есть → вернуть её `id`, без новой строки истории;
  - архивная компания → 422, как в остальных правках.
- **Маршруты:**
  - `POST /api/v1/companies/:cid/club-analytics/guests/links` → `{ id }`;
  - `DELETE …/guests/links/:id` → 204; чужая или несуществующая правка → 404.
- **История:**
  - сущность `senet_guest_link`, действие `create` или `delete`;
  - `diff` — `{ after: { kind, a, b } }` или `{ before: … }`;
  - вместо ключей — подписи: логин или маска телефона (по `pairs`), никогда не хеш.

- [ ] **Step 1: Тесты** `tests/server/club-guest-links.test.ts` (оба диалекта; фикстура `clubWorld` + строки `senet_load` с телефонами):
  - **`companyPairs`:**
    - пары из сеанса и пополнения одного логина с одним телефоном → одна пара;
    - `lastAt` — наибольшее время;
    - клуб другой компании не попадает;
  - **`merge` двух логинов без общего телефона:**
    - `companyGuests` → один гость;
    - строка истории `senet_guest_link`/`create` с `after.a`, `after.b` — логины;
    - `JSON.stringify` строки истории не содержит хешей фикстуры;
  - **повторный такой же `merge`** → тот же `id`, строк истории по-прежнему одна;
  - **`split` телефона из гостя из двух логинов** → три гостя. `DELETE` правки → снова один гость, строка истории `delete`;
  - **ошибки:**
    - `split` гостя из одного ключа → 422;
    - `merge` гостя с самим собой → 422;
    - неизвестный `ref` → 404;
    - архивная компания → 422;
    - `DELETE` правки чужой компании → 404;
  - **`keyRef('phone:h1')`** — 16 hex, не равен `'h1'` и не содержит его.
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/club-guest-links.test.ts` → FAIL.
- [ ] **Step 3:** Таблица и миграции (`npm run db:generate`, переименование), модуль, схема, маршруты, подпись истории.
- [ ] **Step 4:** Тест на `server-sqlite` и `server-pg` → PASS; `npm test`; crapper < 10.
- [ ] **Step 5:** Коммит `feat(club): ручные связи гостей — «Это один гость», «Разделить», история`.

### Task 4: Отчёт «Гости» — сервер

**Files:**
- Create: `src/server/modules/club-analytics/guests.ts`, `tests/server/club-guests.test.ts`
- Modify:
  - `src/shared/schemas/club-analytics.ts` — `guestsQuerySchema`: `project`, `from`, `to`, `step`, `compare` — как у `loadQuerySchema`, без `by`;
  - `routes.ts`, сборка модулей;
  - `load.ts` — экспортировать `coverageOf` (покрытие отчёта `load`);
  - `tests/helpers/club-senet.ts` — у `load(…)` необязательный телефон (по умолчанию прежний).

**Interfaces:**
- Consumes:
  - задачи 1–3;
  - `clubScope`;
  - `clubDays(db, tz, ids, from, to)` — части выручки и пополнения по дням;
  - `coverageOf`;
  - `reportColumns`, `previousRange`, `periodDays`.
- Produces:
  ```ts
  /** Гости клубов отчёта (§7): все закрытые сеансы клубов за всё время, разложенные по гостям компании. */
  export interface ClubGuestsData {
    days: string[]; cov: DayCoverage[];
    visits: Visit[]; first: Map<number, string>;
    guests: Guests; pairs: KeyPair[];
    /** Сеансов периода без гостя и с общим логином без телефона. */
    unassigned: { noGuest: number; shared: number };
    /** Потрачено (абонементы + списано за сеансы, R21) и пополнено гостями в периоде. */
    spent: Map<number, number>; refilled: Map<number, number>;
    /** Локальный день первого закрытого сеанса клубов отчёта; нет — null. */
    dataStart: string | null;
  }
  export async function clubGuests(db: Db, tz: string, companyId: number, scope: ClubScope, from: string, to: string, now: string): Promise<ClubGuestsData>;
  export interface GuestRowView { ref: string; logins: string[]; masks: string[]; visits: number; visitSec: number; spent: number; refilled: number; firstVisit: string; lastVisit: string }
  /** Выручка и пополнения периода (Σ частей `clubDays`). */
  export interface GuestMoney { revenue: number | null; refills: number | null }
  export function buildGuestsReport(cur: ClubGuestsData, prev: ClubGuestsData | null, money: { cur: GuestMoney; prev: GuestMoney | null }, q: GuestsQuery, approx: boolean): GuestsReport;
  export function guestsSheets(data: GuestsReport, q: GuestsQuery): XlsxSheet[];
  export function createClubGuests(d: { db: Db; timezone: string; now: () => Date }): { guests; xlsx; card; search }; // card и search — задача 5
  ```
- **Ответ `GET …/club-analytics/guests`** (`GuestsReport` + `freshness`):
  - **`tiles`** — 7 плиток в форме `OverviewTile` (`spark: []`, `href: ''`), по порядку §7.2:

    | `key` | Подпись | `unit` | `kind` | Значение |
    |---|---|---|---|---|
    | `guests` | «Уникальных гостей» | number | sum | — |
    | `newGuests` | «Новых» | number | sum | — |
    | `returning` | «Вернувшихся» | number | sum | — |
    | `visitsPerGuest` | «Визитов на гостя» | number | avg | — |
    | `hoursPerGuest` | «Часов на гостя» | duration | avg | `visitSec / guests` |
    | `revenuePerGuest` | «Потратил на гостя» | money | avg | выручка периода (часы + бар, `clubDays`) / гостей |
    | `refillsPerGuest` | «Пополнений на гостя» | money | avg | пополнения периода / гостей |

    Плитка «Потратил на гостя» помечена: «выручка / гостей».
  - **`columns`, `series`** — колонки шага и ряды `[{ id: 'new', label: 'Новые' }, { id: 'returning', label: 'Вернувшиеся' }]`. Значения — `guestBuckets` по колонкам; у колонки без дней с данными — `null` (R27).
  - **`top`** — `GuestRowView[]`, 50 гостей периода с наибольшим `spent`. При равенстве — больше визитов, затем по `ref`.
    - Логины — исходные логины пар гостя по алфавиту.
    - Маски — различные маски пар гостя.
    - `firstVisit` — за всё время; `lastVisit` — последний визит в периоде (R22).
  - **`ages`** — `ageBuckets(lastAges(визиты периода))` по гостям периода.
  - **`cohorts`** — строки по месяцам периода от `from` до `to` (R24); `currentMonth` — месяц `now`.
  - **`unassigned`.**
  - **`firstDaysNote`** — `«Данные Senet начинаются {ДД.ММ.ГГГГ} — гости этих дней считаются новыми»`. Показывается, если `[from, to]` пересекает `[dataStart, dataStart + 29 дней]`; иначе `null`.
  - **`coverage`, `prevCoverage`, `meta`:** `{ from, to, step, empty }`.
- **Excel `guests.xlsx`** — листы «Постоянные гости» (колонки таблицы, маски) и «Когорты». Без хешей и ключей.

- [ ] **Step 1: Тесты** `tests/server/club-guests.test.ts`. Оба диалекта, клуб и период 02–08.11:
  - **гость с двумя логинами** `a`, `b` и общим телефоном → в `top` одна строка `logins: ['a', 'b']`, плитка `guests` = 1;
  - **«Все клубы» и один клуб:** второй клуб компании, гость `a` играл там → `guests` по «Все клубы» — тот же гость (1), по второму клубу — 1;
  - **новые и вернувшиеся:** гость с сеансом 20.10 и 03.11 → `returning` 1; гость только 04.11 → `newGuests` 1;
    - в ряду по дням колонка 04.11 → `new` 1;
    - день без данных (нет отрезка `load`) → `null` в обоих рядах;
  - **общий логин** `guest` с 4 телефонами:
    - сеансы с телефонами — четыре гостя;
    - сеанс `guest` без телефона → `unassigned.shared` 1;
    - сеанс без логина и телефона → `noGuest` 1;
  - **потрачено (R21):** абонемент гостя 5 000 ₸ + списано за сеанс 300 ₸ → `spent` 530 000 тиынов;
    - пополнение 2 000 ₸ → `refilled` 200 000;
    - «Потратил на гостя» — `revenue` отчёта / гостей;
  - **`firstDaysNote`:**
    - первый сеанс клуба 20.10, период 02–08.11 → полоса с «20.10.2026»;
    - период 01–07.12 → `null`;
  - **Δ:** `compare=1`, прошлая неделя с 1 гостем → `tiles.guests.prev` 1;
  - **когорты:** период 01.10–30.11, `now` 06.11:
    - строка `2026-10` с `shares[1]` — доля гостей октября, пришедших в ноябре;
    - `shares[2…6]` — `null`;
  - **ни одного хеша фикстуры** в `JSON.stringify(ответа)` и в `JSON.stringify(guestsSheets(…))`.
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/club-guests.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
  - Сеансы, пополнения и абонементы клубов отчёта берутся SQL-запросами.
  - Связи — `companyGuests`.
  - Цифры считают чистые функции. Сборка ответа — в чистой `buildGuestsReport`.
- [ ] **Step 4:** Тест на обоих диалектах → PASS; `npm test`; crapper < 10.
- [ ] **Step 5:** Коммит `feat(club): отчёт «Гости» — сервер, Excel`.

### Task 5: Карточка гостя и поиск — сервер

**Files:**
- Modify: `src/server/modules/club-analytics/guests.ts`, `src/shared/schemas/club-analytics.ts`, `routes.ts`, `tests/server/club-guests.test.ts`

**Interfaces:**
- **`GET …/club-analytics/guests/:guest`** — параметры `project`, `from`, `to` (`guestCardQuerySchema`).
  - Гость находится по `ref` любого его ключа; не найден → 404 «Гость не найден».
  - Ответ:
    ```ts
    {
      ref: string;
      logins: { ref: string; login: string }[];
      phones: { ref: string; mask: string }[];
      visits: { startAt: string; endAt: string; places: string; spent: number }[]; // визиты периода, новые сверху; places — «VIP · ПК 3, Общий зал · ПК 12»
      totals: { visits: number; visitSec: number; spent: number; refilled: number };
      edits: { id: number; kind: 'merge' | 'split'; label: string; createdAt: string }[]; // правки с ключами гостя
    }
    ```
  - Подписи правок:
    - `merge` — «Объединён: {логин или маска другого ключа}»;
    - `split` — «Вынут: {логин или маска}».
- **`GET …/club-analytics/guests/search?q=`** (`guestSearchQuerySchema`: `q` — от 2 до 50 знаков, после `trim`).
  - Совпадение:
    - логин содержит `q` без учёта регистра;
    - или цифры `q` — конец цифр маски.
  - Общие логины не предлагаются.
  - Ответ — до 10 гостей `{ ref, logins: string[], masks: string[], lastAt: string }`, недавние первыми.
- Маршрут `search` регистрируется до `:guest`.

- [ ] **Step 1: Тесты** (дополнить `club-guests.test.ts`, оба диалекта):
  - **карточка по `ref` второго логина гостя** → тот же гость; `logins` — оба; `visits` — 2, новые сверху; `totals.spent` — как в `top`;
  - **после `split` телефона** `edits` — одна правка «Вынут: +7 *** ** 12»;
  - **несуществующий `ref`** → 404;
  - **поиск:**
    - `q=GUE` находит `guest001`;
    - `q=12` находит гостя с маской на «12»;
    - общий логин `guest` не предлагается;
    - `q=a` → 400;
  - **ни одного хеша** в ответах карточки и поиска.
- [ ] **Step 2–4:** FAIL → реализовать → PASS на обоих диалектах; `npm test`.
- [ ] **Step 5:** Коммит `feat(club): карточка гостя и поиск гостей — сервер`.

### Task 6: Каталог и «Обзор» — плитки гостей

**Files:**
- Modify:
  - `src/shared/analytics-catalog.ts`: `CLUB_DASHBOARDS` + `guests`; `BUILT_CLUB_REPORTS` + `guests`;
  - `overview.ts`;
  - `src/client/lib/club-overview.ts` (`tileValueText`);
  - тесты:
    - `tests/server/club-overview.test.ts`;
    - `tests/client/club-overview.test.ts`;
    - перечни карточек: `analytics-cards`, `templates`, `analytics-settings`, `mobile:383` (как Task 4 Ruling АК-2).

**Interfaces:**
- **Карточка `guests` в `CLUB_DASHBOARDS`:**
  - `title` — «Гости»;
  - `description` — «Уникальные, новые и вернувшиеся гости, когорты, постоянные гости»;
  - `path` — `club/guests`;
  - `help` — «Гость — связанные логины и телефоны: логины с общим телефоном считаются одним гостем. Визит — сеансы с перерывом меньше 30 минут. Новый — первый визит за всё время данных попал в период.».
- **«Обзор»:** `Period = ClubDays & { load: LoadFigures; guests: GuestDayFigures | null }`.
  - `GuestDayFigures = { total: GuestFigures; byDay: GuestFigures[] }` — `guestBuckets` за период и по дням.
  - Считается только если среди видимых плиток есть плитка отчёта `guests`, как `journalOf`.
- **`MEASURES`:**
  - `guests`, `newGuests` — итог и ряд по дням;
  - `revenuePerGuest` — выручка / гостей, ряд — по дням;
  - `visitDuration` — `visitSec / visits`;
  - `visitsPerGuest` — `visits / guests`;
  - `returningShare` — `returning / guests`.

  День без данных (`revenueCoverage` `none`) — `null` в ряду.
- **`tileKind`:** `avg` — `revenuePerPcDay`, `revenuePerGuest`, `visitDuration`, `visitsPerGuest`; `percent` — `share`; остальное — `sum`.
- **`REPORT_HREF.guests`** — `'club/guests'`.
- **`tileValueText`:**
  - `duration` — `durationText` (`club-load.ts`);
  - `number` — `toLocaleString('ru-RU', { maximumFractionDigits: 1 })`.

- [ ] **Step 1: Тесты:**
  - **сервер:** плитки по умолчанию «Гостей» и «Новых гостей» — с числом, без пометки «Появится с отчётом «Гости»»; «Выручка на гостя» = `revenue / guests`; с `visitsPerGuest` в настройках плиток — значение и `kind: 'avg'`;
  - **без видимых плиток гостей** отчёт гостей не считается: плитки `guests` нет, `tiles.length` — как в настройке;
  - **клиент:**
    - `tileValueText` плитки `visitDuration` 5 100 → «1 ч 25 мин»;
    - `visitsPerGuest` 1.43 → «1,4»;
    - `overviewHref(5, 'club/guests', 'from=…', '')`;
  - **перечни карточек** — с «Гостями».
- [ ] **Step 2–4:** FAIL → реализовать → PASS (оба диалекта); `npm test`.
- [ ] **Step 5:** Коммит `feat(club): «Обзор» — плитки гостей; карточка «Гости»`.

### Task 7: Страница «Гости»

**Files:**
- Create:
  - `src/client/lib/club-guests.ts`;
  - `src/client/pages/club/ClubGuestsPage.tsx`;
  - `src/client/components/club/GuestsTable.tsx`, `CohortTable.tsx`;
  - `tests/client/club-guests.test.ts`.
- Modify:
  - `StackedBars.tsx` — необязательный `format?: (v: number) => string`; по умолчанию — деньги, как было;
  - маршрут `club/guests`;
  - `ClubReportKind` + `'guests'`.

**Interfaces:**
- **Типы и функции:**
  - `GuestsView` — ответ задачи 4;
  - `sortGuests(rows: GuestRowView[], key: keyof GuestRowView, dir: 'asc' | 'desc'): GuestRowView[]` — логины и маски сравниваются по первому элементу, `localeCompare('ru')`;
  - `cohortMonthText('2026-10')` → «окт 2026»;
  - `shareText(0.5)` → «50 %».
- **Страница:**
  - виды `['chart', 'table']`; график — по умолчанию, шаг — только в графике (`stepIn: ['chart']`); `excel`;
  - над видом:
    - полоса `firstDaysNote`;
    - 7 плиток `Tile`;
    - строка «Без гостя: N сеансов · Общие логины: M сеансов» (части с 0 не показываются);
  - **«график»** — `StackedBars` «Новые и вернувшиеся гости»: ряды «Новые» и «Вернувшиеся», формат — число;
  - **«таблица»** — `GuestsTable`, топ-50:
    - колонки — по §7.4;
    - сортировка — кнопкой в заголовке колонки, с `aria-sort`; по умолчанию — «Потратил», по убыванию;
    - у «Потратил» подсказка: «на часы: абонементы и аренда ПК; покупки бара за кассой гостю не привязаны»;
    - щелчок по строке открывает карточку (задача 8) под таблицей;
  - **под видом** (в обоих видах):
    - «Когорты» — `CohortTable`: месяц, гостей, «0…6 мес.»; пустая ячейка — «»;
    - «Возраст» — список «{корзина} — {доля}».
- **Тексты:**
  - `HELP` — `help` карточки задачи 6 плюс «Логины, у которых за 90 дней больше 3 разных телефонов, — общие: они не связывают гостей.»;
  - подзаголовок — `description` карточки.

- [ ] **Step 1: Тесты** `tests/client/club-guests.test.ts`:
  - `sortGuests` по `visits` `asc` и `desc`;
  - по `logins` — кириллица раньше латиницы, как в `localeCompare('ru')`;
  - при равенстве порядок исходный;
  - `cohortMonthText`, `shareText(0.333)` → «33,3 %»;
  - строка «Без гостя…»: `{ noGuest: 2, shared: 0 }` → «Без гостя: 2 сеанса».
- [ ] **Step 2–4:** FAIL → реализовать → PASS; typecheck.
- [ ] **Step 5:** Коммит `feat(club): страница «Гости» — плитки, ряд, постоянные гости, когорты, возраст`.

### Task 8: Карточка гостя — клиент

**Files:**
- Create: `src/client/components/club/GuestCard.tsx`
- Modify: `src/client/lib/club-guests.ts`, `tests/client/club-guests.test.ts`, `ClubGuestsPage.tsx`

**Interfaces:**
- **Запрос:** `GET …/guests/:ref?{apiParams без step и compare}`, ключ `['analytics', cid, 'club', 'guest', ref, params]`.
- **Блок карточки:**
  - заголовок — логины через запятую;
  - «Логины» и «Телефоны» (маски);
  - у каждого ключа кнопка «Разделить», если ключей больше одного → `POST links { kind: 'split', a: ключ.ref, b: гость.ref }`;
  - итоги;
  - визиты: дата, «20:05–23:40», места, «Потратил»;
  - «Правки»: подпись и «Снять» → `DELETE links/:id`;
  - «Это один гость»: поле поиска (от 2 знаков, задержка 300 мс) → список найденных без самого гостя, у каждого «Объединить» → `POST links { kind: 'merge', a: гость.ref, b: найденный.ref }`.
- **После правки** — сброс запросов `['analytics', cid, 'club']`; карточка остаётся открытой по тому же `ref`.
- **Архивная компания** (`company.archivedAt`) — кнопок правки нет.
- **Ошибка правки** — текст ответа в `role="alert"`.
- **Функции:**
  - `visitTimeText(startAt, endAt, tz)` → «03.11 20:05–23:40»;
  - визит через полночь → «03.11 23:30–04.11 01:10».

- [ ] **Step 1: Тест:** `visitTimeText` — обычный визит и визит через полночь (пояс `Asia/Almaty`). Поток карточки проверяет e2e задачи 9.
- [ ] **Step 2–4:** FAIL → реализовать → PASS; typecheck.
- [ ] **Step 5:** Коммит `feat(club): карточка гостя — визиты, «Это один гость», «Разделить»`.

### Task 9: Демо, e2e, снимки, README, итоги

**Files:**
- Modify:
  - `scripts/lib/senet-club-demo.ts`;
  - `e2e/club-analytics.spec.ts`;
  - `scripts/ux-shots.ts`;
  - `README.md` (раздел «Аналитика клуба» — «Гости»);
  - `Plans.md`.
- Create: `docs/superpowers/followups/2026-11-06-club-analytics-3-followups.md`.

- [ ] **Step 1: Демо.**
  - Гости 1–10 в каждом пятом сеансе входят под вторым логином `guest{NNN}m` с тем же телефоном.
  - Логин `club` — 5 разных телефонов, часть сеансов без телефона.
- [ ] **Step 2: e2e** (дополнить `club-analytics.spec.ts`):
  - главная — карточка «Гости»;
  - «Гости», вид «график» — 7 плиток, график «Новые и вернувшиеся гости», «Когорты» и «Возраст»;
  - строка «Общие логины: …»;
  - «таблица»:
    - строка `guest001, guest001m`;
    - сортировка по «Визитов» меняет порядок;
    - щелчок открывает карточку с двумя логинами;
  - «Разделить» логин `guest001m` → в таблице две строки; «Снять» → снова одна;
  - «Это один гость»: поиск `guest002`, «Объединить» → строка `guest001, guest001m, guest002`; затем «Снять»;
  - «Обзор» — плитки «Гостей» и «Новых гостей» с числом, ссылка ведёт на «Гостей» с тем же периодом;
  - Excel «Гостей» скачивается.
- [ ] **Step 3:** `npx playwright test e2e/club-analytics.spec.ts` и `E2E_DB=pg …` → PASS.
- [ ] **Step 4: Снимки** (`npm run shots:ux` → все PASS):
  - c84 — «Гости», график;
  - c85 — таблица и карточка гостя;
  - c86 — когорты и возраст;
  - cm87 — «Гости» на телефоне.
- [ ] **Step 5: README и итоги.** Записать R17–R27 и чек-лист владельцу:
  - два логина знакомого постоянного гостя показаны одним гостем (§14);
  - общие логины клуба распознаны;
  - доля вернувшихся правдоподобна.
- [ ] **Step 6: Финальная проверка.** `npm test`, `npm run typecheck`, `npm run lint:async`, `npx playwright test` → PASS. Известные падения `analytics-pnl:244` и `mobile:1255` записать в итоги. Коммит `test(club): «Гости» — e2e, снимки, README`, пуш.

---

## Решения (§18 спецификации; записывает задача 1)

- **R17. Чьи данные.**
  - **Связи гостей** считаются по данным всех клубов Senet компании. Ключи общие для компании: гость один и тот же в «Все клубы» и в одном клубе.
  - **Гость отчёта** — тот, у кого в периоде начат визит. Пополнения, чеки и абонементы:
    - только связывают логины с телефонами;
    - входят в «потратил» и «пополнил» гостя.
- **R18. «Разделить».**
  - Вынимает ключ из автоматических связей. Хранится как `split` с `key_a = key_b`.
  - «Это один гость» с этим ключом по-прежнему действует.
  - **Строка Senet** относится к гостю своего логина, если логин — ключ (непустой и не общий); иначе — к гостю телефона.
- **R19. Общий логин.**
  - Это логин, у которого больше 3 разных телефонов за 90 дней до сегодня — как места зон в АК-2.
  - Его строки с телефоном идут гостю телефона. Строки без телефона попадают в «Общие логины: N сеансов».
  - В «Это один гость» общий логин не предлагается.
- **R20. Визит.**
  - Только закрытые сеансы, как в «Загрузке».
  - Визит относится ко дню своего начала. Длительность — от начала первого сеанса до конца последнего.
  - Перерыв ровно 30 минут начинает новый визит.
- **R21. «Потратил» гостя** = абонементы (по дате покупки) + списано за сеансы периода, то есть часы (R6).
  - Бар гостю не привязан: в `senet_sold_items` гостя нет.
  - Плитка «Потратил на гостя» = выручка (часы + бар) / гостей, как в §7.2.
- **R22. Первый и последний визит.**
  - Первый визит — за всё время данных клубов отчёта.
  - Последний визит в таблице — в периоде.
  - Начало данных — первый закрытый сеанс клубов отчёта.
- **R23. Возраст** — последний указанный в визитах периода; не указан — «не указан».
- **R24. Когорты.**
  - Строки — месяцы периода.
  - Ячейки считают визиты за всё время, в том числе после конца периода.
  - Месяц позже текущего — пустой. Текущий месяц неполный, но значение у него есть.
- **R25. `ref`.**
  - Ключ и гость наружу — `ref`: первые 16 hex `sha256('guest:' + ключ)`.
  - У гостя `ref` — это `ref` его наименьшего ключа: логины идут раньше телефонов.
  - Карточка находит гостя по `ref` любого его ключа.
  - Хеш телефона из `ref` без секрета сервера не получить.
- **R26. Где открывается карточка и что щёлкается.**
  - Карточка гостя — блок под таблицей, не отдельная страница.
  - Колонки ряда гостей список не открывают, как колонки «Загрузки». Гости — в таблице и карточке.
- **R27. Ряд по шагу.**
  - Гость колонки — тот, у кого визит начат в колонке. Новый — его первый визит тоже в колонке.
  - Колонка без дней с данными — «нет данных».
  - Неполные дни считаются по тем данным, что есть.
  - Цифры гостей за весь период пересчитываются в JS из всех сеансов клубов. Скорость на реальном объёме замеряет `bench:club` в АК-4.
