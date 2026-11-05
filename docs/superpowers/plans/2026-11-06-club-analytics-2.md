# АК-2 «Аналитика клуба: Загрузка» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** отчёт «Загрузка» (§6): загрузка ПК по часам, дням недели и зонам; зоны клуба в «Изменить»; плитка «Загрузка ПК», линия загрузки и «Часы пик» в «Обзоре клуба» (§4, R7).

**Architecture.**
- **Чистые функции** — `src/shared/club-analytics/load.ts`: слияние сеансов места, раскладка по дням и часам (`splitByHour`), средние по колонкам шага, карта «день недели × час», крайние часы, итоги зоны.
- **Сервер** — `src/server/modules/club-analytics/load.ts` (отчёт, сеансы ячейки, Excel) и `zones.ts` (зоны клуба). Строки берёт SQL, считают чистые функции. «Обзор» берёт загрузку из того же модуля.
- **Клиент** — страница `ClubLoadPage` на каркасе `ClubReportScreen` из АК-1; общий график процентов `PercentLinesChart`; карта часов из «Выручки», обобщённая форматом значения.

**Tech Stack:** Fastify 5, Drizzle (SQLite и Postgres), Zod, React 19, TanStack Query, Vitest (unit, server-sqlite, server-pg), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-club-analytics-design.md` — §6, §4 («Загрузка ПК», «Часы пик», график «Выручка и загрузка по дням»), §13, R7. Решения этого плана — §17 спецификации, их записывает задача 1. Итоги АК-1 — `docs/superpowers/followups/2026-11-03-club-analytics-1-followups.md`.

## Global Constraints

- Обе базы: миграция — SQLite (`src/server/db/migrations`, следующая — `0018`) и Postgres (`src/server/db/migrations-pg`, следующая — `0008`). Генерация — `npm run db:generate`, затем имена файлов и `tag` в `meta/_journal.json` по смыслу (`0018_senet_zones`, `0008_senet_zones`). Таблица — в `schema-sqlite.ts` и `schema-pg.ts`.
- Часы, дни и дни недели — в `config.timezone`. Неделя с понедельника, индекс дня недели 0 = Пн (`localParts`).
- Загрузка — доля 0…1; на экране «42,5 %» (`marginText` от базисных пунктов, как плитки АК-1). Деньги Senet — тиыны, на экране `clubMoney` (целые тенге).
- Телефон наружу — только `phone_mask` (§12).
- Чтение отчётов — сессия, архивная компания читается. Запись зон — CSRF и `requireCompany(db, cid, { writable: true })`, строка в истории через `mutate`.
- Тексты интерфейса — дословно из спецификации, где она их задаёт.
- Только синтетические данные в тестах, снимках и репозитории (§12).
- Проверка задачи: `npm test`, `npm run typecheck`, `npm run lint:async` — зелёные. Новая логика — в верхнеуровневых чистых функциях, CRAP < 10 (crapper с узким `--coverage-command`).
- Решение владельца 2026-10-18 — без субагентов: выполняет основная сессия, финальное ревью — самопроверка. Пуш в `stage1/plan1-skeleton` — без вопроса, force-push — с вопросом.
- «Загрузить за период» на проде не запускать: Vercel Blob приостановлен (итоги АК-1, «Известное»). Проверка на проде — после разморозки.

## Review Focus

1. **Сеанс, начатый до периода и закончившийся в нём** (ночной сеанс в первый день периода): его часы внутри периода входят в загрузку. Выборка — `start_at` от начала периода − 24 ч. Тест — задача 3.
2. **Текущий (неполный) день и дни без данных** не тянут средние вниз: загрузка — только по полным дням (R10). Тест — задачи 1 и 3.
3. **Сеанс без места (`workstation` пустой)** не сливается с чужими и не теряется. Тест — задача 1.
4. **«Все клубы», у одного клуба нет «Количества ПК»** — знаменатель по местам из данных и подсказка (§13, R9), а не завышенная загрузка. Тест — задача 3.
5. **Удаление подключения с заданными зонами** не падает на Postgres (внешний ключ `senet_zones`), как было с таблицами аналитики в АК-1. Тест — задача 2.

---

### Task 1: Расчёт загрузки — чистые функции

**Files:**
- Create: `src/shared/club-analytics/load.ts`, `tests/shared/club-load.test.ts`
- Modify: `docs/superpowers/specs/2026-11-03-club-analytics-design.md` — новый §17 «Решения планирования плана АК-2» (R9–R16 ниже)

**Interfaces:**
- Consumes: `splitByHour`, `localParts` (`hours.ts`); `mergeSpans`, `Span`, `DayCoverage` (`coverage.ts`); `ReportColumn` (`report-engine`).
- Produces:
  ```ts
  export interface LoadSession { startAt: string; endAt: string | null; zone: string; workstation: number | null; debited: number }
  /** Занятые секунды: зона → [индекс дня периода][час 0–23]. */
  export type Occupancy = Map<string, number[][]>;
  export function occupancy(sessions: readonly LoadSession[], days: readonly string[], timeZone: string): Occupancy;
  export function sumZones(occ: Occupancy, days: number): number[][];
  export function loadColumns(occ: number[][], seats: number, days: readonly string[], cov: readonly DayCoverage[], columns: readonly ReportColumn[]): (number | null)[];
  export function loadTotal(occ: number[][], seats: number, cov: readonly DayCoverage[]): number | null;
  export function loadByDay(occ: number[][], seats: number, cov: readonly DayCoverage[]): (number | null)[];
  export function loadHeatmap(occ: number[][], seats: number, days: readonly string[], cov: readonly DayCoverage[]): (number | null)[][];
  export interface HourCell { weekday: number; hour: number; value: number }
  export function extremeHours(map: readonly (readonly (number | null)[])[], n: number, order: 'max' | 'min'): HourCell[];
  export interface ZoneStats { sessions: number; sessionsPerSeatDay: number | null; avgSessionSec: number | null; hours: number; debited: number; debitedPerSeatHour: number | null }
  export function zoneStats(sessions: readonly LoadSession[], seats: number, fullDays: number): ZoneStats;
  ```

Правила (их проверяют тесты): сеанс без `endAt` не учитывается; сеансы одного места (`zone` + `workstation`) сливаются `mergeSpans` перед `splitByHour`; сеанс без места не сливается; часть сеанса вне `days` отбрасывается. Средние — только по дням `cov === 'full'` (R10): `loadColumns` — Σ занятого по полным дням колонки / (мест × 86 400 × полных дней), колонка без полных дней — `null`; `loadTotal` — то же за весь период; `loadByDay` — по дню, неполный день — `null`; `loadHeatmap` — `[weekday][hour]`, среднее по полным дням этого дня недели, нет таких дней — `null`. `extremeHours` пропускает `null`, при равенстве — раньше день недели, затем час. `zoneStats`: сеансы — закрытые, начатые в периоде; «на место в день» и «на место в час» — по `fullDays` (0 → `null`).

- [ ] **Step 1: Тесты `tests/shared/club-load.test.ts`** (пояс `Asia/Almaty`, UTC+5; дни `['2026-11-02', '2026-11-03']`, 02.11 — понедельник):
  - `occupancy` — место 1 зоны «A»: 19:30–21:00 и наложенный 20:00–20:30 → `occ.get('A')[0][19] === 1800`, `[0][20] === 3600`. Место 2 зоны «B» 23:30–00:30 → `[0][23] === 1800`, `[1][0] === 1800`. Сеанс без конца не учитывается. Два сеанса без места 10:00–10:30 в зоне «A» → `[0][10] === 3600` (не слиты). Сеанс зоны «C» 01.11 23:00 – 02.11 01:00 → только `occ.get('C')[0][0] === 3600`.
  - `loadColumns` / `loadTotal` / `loadByDay` — 2 места, 02.11 полный, 03.11 `partial`: занято 02.11 всего 17 280 с → `loadTotal === 0.1` (17 280 / (2 × 86 400)); `loadByDay → [0.1, null]`; колонка на оба дня — `0.1`; колонка только 03.11 — `null`.
  - `loadHeatmap` — 02.11 полный, занято час 20 — 3600 с, мест 2 → `map[0][20] === 0.5`; `map[1][20] === null` (вторника с данными нет).
  - `extremeHours` — карта с 0.9 (Пт 20), 0.9 (Пн 21), 0.1 (Ср 5), `null` остальное: `max`, n 2 → `[{weekday:0,hour:21,value:0.9},{weekday:4,hour:20,value:0.9}]`; `min`, n 1 → `[{weekday:2,hour:5,value:0.1}]`.
  - `zoneStats` — 3 закрытых сеанса по 1 ч, списано 300/0/600 ₸ (в тиынах), 2 места, 1 полный день → `{sessions:3, sessionsPerSeatDay:1.5, avgSessionSec:3600, hours:3, debited:90000, debitedPerSeatHour:1875}`; `fullDays 0` → средние `null`.
- [ ] **Step 2:** `npx vitest run --project unit tests/shared/club-load.test.ts` → FAIL (нет модуля).
- [ ] **Step 3:** Реализовать `load.ts` по Interfaces и правилам выше.
- [ ] **Step 4:** Тот же запуск → PASS; crapper на `load.ts` < 10.
- [ ] **Step 5:** Записать §17 спецификации (R9–R16 — раздел «Решения» ниже), коммит `feat(club): расчёт загрузки — слияние сеансов, часы, средние, карта`.

### Task 2: Зоны клуба — таблица, API, удаление

**Files:**
- Create: `src/server/modules/club-analytics/zones.ts`, миграции `0018_senet_zones.sql` / pg `0008_senet_zones.sql`, `tests/server/club-zones.test.ts`
- Modify: `schema-sqlite.ts`, `schema-pg.ts` (`senetZones`), `src/shared/schemas/club-analytics.ts` (`zonesInputSchema`), `club-analytics/routes.ts`, `src/server/app.ts`, `src/server/modules/senet/connections.ts` (удаление — и `senetZones`)

**Interfaces:**
- Таблица `senet_zones`: `id`, `office_id` → `senet_offices.id`, `zone` text, `seats` integer not null; уникальный `(office_id, zone)`. Нет строки — места «по данным» (§6.1).
- `zonesInputSchema = z.object({ zones: z.array(z.object({ zone: z.string().min(1).max(100), seats: z.number().int().min(1).max(1000).nullable() })).max(50) })`.
- Produces:
  ```ts
  export interface ZoneView { zone: string; found: number; seats: number | null }
  export function createClubZones(d: { db: Db; audit: AuditService; now: () => Date }): {
    list(companyId: number, officeId: number): Promise<ZoneView[]>;   // зоны из senet_load за 30 дней до now ∪ сохранённые, по имени
    put(companyId: number, officeId: number, input: ZonesInput, userId: number): Promise<ZoneView[]>;
  };
  /** Места зон клубов для отчёта: своё число, иначе найденное за 30 дней до `until`. */
  export async function zoneSeats(db: Db, officeIds: readonly number[], until: string): Promise<Map<number, Map<string, number>>>;
  ```
  `found` — число разных `workstation` зоны в `senet_load` за 30 дней до `now`. `seats: null` во входе — удалить строку. Клуб чужой компании — 404. История: `entity: 'senet_zones'`, `diff: { office, before, after }`.
- Маршруты: `GET /api/v1/companies/:cid/senet/offices/:id/zones`, `PUT …/zones`.

- [ ] **Step 1: Тесты `tests/server/club-zones.test.ts`** (фикстура `tests/helpers/club-senet.ts`; её сеансы: «VIP» место 7, «Общий» место 3):
  - `GET` → `[{zone:'VIP',found:1,seats:null},{zone:'Общий',found:1,seats:null}]`, порядок — по имени (`localeCompare('ru')`).
  - `PUT {zones:[{zone:'VIP',seats:10}]}` → `VIP seats 10`; строка истории `senet_zones`; `seats:null` удаляет строку; `seats:0` → 400; архивная компания → 422.
  - Клуб другой компании → 404.
  - Удаление подключения с сохранёнными зонами → 200, `senet_zones` пуста (оба диалекта — Review Focus 5).
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/club-zones.test.ts` → FAIL.
- [ ] **Step 3:** Миграции (`npm run db:generate`, переименовать), схемы, `zones.ts`, маршруты, удаление в `connections.ts` рядом с `senetLoad`.
- [ ] **Step 4:** Тот же тест на `server-sqlite` и `server-pg` → PASS.
- [ ] **Step 5:** Коммит `feat(club): зоны клуба — места по данным и свои, API`.

### Task 3: Отчёт «Загрузка» — сервер

**Files:**
- Create: `src/server/modules/club-analytics/load.ts`, `tests/server/club-load.test.ts`
- Modify: `src/shared/schemas/club-analytics.ts` (`loadQuerySchema`, `loadRowsQuerySchema`), `club-analytics/routes.ts`, `src/server/app.ts`. Общую фикстуру `tests/helpers/club-senet.ts` не менять: её сеансы — аренда ПК в тестах «Выручки»; тест загрузки передаёт `clubWorld({ ...CLUB_DATA, load: [...] })`.

**Interfaces:**
- Consumes: задача 1 целиком; `zoneSeats` (задача 2); `clubScope`, `loadSpans`, `combineCoverage`, `dayCoverage`, `periodDays`, `previousRange`, `reportColumns` (АК-1).
- `loadQuerySchema` — общие параметры клуба (`clubShape`) + `by: 'all' | 'zones'` (по умолчанию `all`), `superRefine(checkPeriod)`. `loadRowsQuerySchema` — те же + `weekday` 0–6, `hour` 0–23, `cursor`.
- Produces:
  ```ts
  export interface ClubLoadData {
    days: string[]; cov: DayCoverage[]; occ: Occupancy; seats: number;
    /** Подсказка о местах (§6.1, §13) или null. */
    seatsNote: string | null;
    zones: { id: string; label: string; seats: number; found: number }[];
  }
  export async function clubLoad(db: Db, tz: string, scope: ClubScope, from: string, to: string, now: string): Promise<ClubLoadData>;
  export function createClubLoad(d: { db: Db; timezone: string; now: () => Date }): {
    load(companyId: number, q: LoadQuery): Promise<LoadReport>;
    rows(companyId: number, q: LoadRowsQuery): Promise<{ items: CellItem[]; nextCursor: string | null }>;
    xlsx(companyId: number, q: LoadQuery): Promise<{ fileName: string; data: Buffer }>;
  };
  ```
  `GET …/club-analytics/load` → `LoadReport`:
  ```ts
  {
    columns: ReportColumn[];
    series: { id: string; label: string; values: (number | null)[] }[];   // by=all — один ряд «Все зоны»; by=zones — по зоне
    total: number | null; prevTotal: number | null;
    heatmap: (number | null)[][];                 // 7 × 24
    idle: HourCell[];                             // 5 часов недели с наименьшей загрузкой (§6.3)
    zones: (ZoneStats & { id: string; label: string; seats: number; load: number | null })[];  // последняя строка — id 'all', «Все зоны»
    seats: { total: number; zones: { label: string; seats: number }[]; note: string | null };
    coverage; prevCoverage; freshness;
    meta: { from; to; step; by; empty: boolean; noZones: boolean };
  }
  ```
  Правила: строки `senet_load` клубов с `end_at` не пусто, `start_at` в `[начало − 24 ч, конец)` (Review Focus 1). Покрытие — отрезки отчёта `load` (`loadSpans`). Места итога (R9): Σ «Количества ПК» клубов с клубом Senet (`pcsOf` из `overview.ts`); если 0 — Σ мест зон и `note` «Задайте количество ПК в карточке проекта». Если Σ мест зон ≠ ПК проекта — `note` «По данным Senet в зонах {N} ПК, в проекте — {M}. Проверьте «Количество ПК» или зоны» (§6.1). Строка «В расчёте» — клиент собирает из `seats`. Зона в «Все клубы» с несколькими клубами — `label` «{Клуб} · {зона}», `id` «{officeId}:{зона}» (R14). Нет сеансов по зонам — `meta.noZones` (§13). Ячейка карты (`rows`) — сеансы, пересекающие этот час этого дня недели в периоде, по началу, страницы по 50 (R15); `CellItem` как у выручки (`kind: 'session'`). Excel — листы «Зоны» (таблица) и «По часам» (карта, проценты с двумя знаками).

- [ ] **Step 1: Тесты `tests/server/club-load.test.ts`** (оба диалекта; клуб `pcCount 10`; сеансы фикстуры: «VIP» 7 — 01.11 20:00–21:30, «Общий» 3 — 01.11 23:30–02.11 01:00 и 02.11 14:00–15:00; тест добавляет сеанс без конца (`close` — `null`) и «Общий» 5 — 31.10 23:00–01.11 01:00, а для него — забор `{ from: '2026-10-30T19:00:00.000Z', to: '2026-10-31T19:00:00.000Z' }`):
  - `from=2026-11-01&to=2026-11-02&step=day&compare=0`: занято 5 400 + 5 400 + 3 600 + 3 600 = 18 000 с → `total` = 18 000 / (10 × 86 400 × 2); сеанс без конца не входит; час 31.10 23:00 не входит, час 01.11 00:00–01:00 входит.
  - `by=zones` → ряды «VIP» и «Общий»; `zones` — три строки, последняя «Все зоны» с `seats 10`.
  - Места: зоны найдены по 1 месту, ПК 10 → `seats.note` «По данным Senet в зонах 2 ПК, в проекте — 10. Проверьте «Количество ПК» или зоны»; после `PUT` зон 7 и 3 → `note null`; `pcCount` убран из проекта → знаменатель 10 (места зон), `note` «Задайте количество ПК в карточке проекта».
  - Текущий день `partial` (период до 03.11 при `now` 03.11 06:00Z) не входит в `total`; `prevTotal null` без данных прошлого периода.
  - `heatmap[6][20]` (01.11 — воскресенье, единственное полное воскресенье): VIP занят весь час 20:00–21:00 → 3 600 / (10 × 3 600) = `0.1`; `idle` — 5 ячеек, по возрастанию.
  - `rows?weekday=6&hour=20` → один сеанс VIP 7 с маской `+7 *** ** 12`, без `phone_hash` в ответе.
  - `load.xlsx` → 200 `spreadsheetml`; чужой клуб → 404.
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/club-load.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать; `clubLoad` — экспорт для «Обзора».
- [ ] **Step 4:** PASS на `server-sqlite` и `server-pg`; прежние `club-revenue` и `club-overview` PASS (фикстура менялась); crapper < 10.
- [ ] **Step 5:** Коммит `feat(club): отчёт «Загрузка» — API, сеансы ячейки, Excel`.

### Task 4: «Обзор» — плитка «Загрузка ПК», загрузка по дням, «Часы пик»; каталог

**Files:**
- Modify: `src/shared/analytics-catalog.ts`, `src/server/modules/club-analytics/overview.ts`, `tests/server/club-overview.test.ts`, `tests/server/analytics-settings.test.ts`, `tests/client/analytics-settings.test.ts` (карточек клуба стало три)

**Interfaces:**
- Catalog: `CLUB_DASHBOARDS` + `{ key: 'load', title: 'Загрузка', description: 'Загрузка ПК по часам, дням недели и зонам', help: 'Сколько ПК занято: по часам, дням недели и зонам. Загрузка часа — занятое время мест, делённое на число ПК. Средние — только по дням с полными данными.', path: 'club/load' }` — после «Выручки клуба» (порядок таблицы §2.1). `BUILT_CLUB_REPORTS` + `'load'`.
- Overview ответ дополняется: `days[].load: number | null`; `peak: HourCell[]` (3 часа, §4). Плитка `load`: `value = loadTotal`, `prev` — за прошлый период, `spark = loadByDay`, `kind 'share'` (Δ в п. п., R16), `href 'club/load'`.

- [ ] **Step 1: Тесты:** «Обзор» по умолчанию — плитка `load` `available: true`, `value` = `total` отчёта «Загрузка» за тот же период; `days[0].load` = загрузка 01.11; `peak` — 3 ячейки по убыванию. Настройки: группа «Компьютерный клуб» — карточки `overview`, `revenue`, `load`; сохранённая до АК-2 настройка получает `load` в конце видимой (§10.3).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать: `overview.ts` вызывает `clubLoad` (задача 3) для текущего и прошлого периода, `MEASURES.load`; Excel «Обзора» — колонка «Загрузка, %» на листе «По дням».
- [ ] **Step 4:** PASS (оба диалекта); crapper < 10.
- [ ] **Step 5:** Коммит `feat(club): «Обзор» — плитка «Загрузка ПК», загрузка по дням, часы пик`.

### Task 5: Клиент — вид по умолчанию отчёта, шаг по видам, карта с форматом, график процентов

**Files:**
- Create: `src/client/components/charts/PercentLinesChart.tsx`, `tests/client/club-load.test.ts` (часть про `club-url`)
- Modify: `src/client/lib/club-url.ts`, `src/client/lib/club-analytics.ts`, `src/client/pages/club/ClubReportScreen.tsx`, `src/client/pages/club/ClubOverviewPage.tsx`, `src/client/components/club/HoursHeatmap.tsx`, `src/client/pages/club/ClubRevenuePage.tsx`, `tests/client/club-url.test.ts`, `tests/client/club-overview.test.ts` (тест `clubChangedFor` — новый четвёртый параметр «шаг виден»)

**Interfaces:**
- `parseClubSearch(params, byChoices, defaultView: ClubView = 'chart')`, `clubSearch(state, byChoices, defaultView = 'chart')`: вид в адресе пишется, только если отличается от `defaultView`. `useClubSettings` передаёт `views[0]` (R13). Выручка и Обзор не меняются (их `views[0]` — `chart`).
- `ClubReportScreen`: проп `stepIn?: readonly ClubView[]` вместо `stepless` — шаг виден только в этих видах (не задан — во всех); `ClubOverviewPage` — `stepIn={[]}`; `clubChangedFor(state, byValues, range, stepShown: boolean)`.
- `ClubReportKind` + `'load'`.
- `HoursHeatmap` props: `{ title; map; busy; format: (v: number) => string; caption: string; onCell?: (weekday: number, hour: number) => void; active?: { weekday: number; hour: number } | null }`; цвет — `heatColor(v, max)` как было; ячейки с `onCell` — кнопки (`aria-pressed`). «Выручка» передаёт `clubMoney` и прежнюю подпись.
- `PercentLinesChart` props: `{ title; columns: readonly { key: string; label: string }[]; lines: readonly { id: string; label: string; values: readonly (number | null)[] }[]; bars?: { label: string; values: readonly number[]; currency: string }; busy?: boolean }` — линии процентов 0–100 % (с `bars` — ось процентов справа, деньги слева), `null` — разрыв линии; колонки — `ChartColumns` с подсказкой; легенда снизу.

- [ ] **Step 1: Тесты** `tests/client/club-url.test.ts`: `parseClubSearch(new URLSearchParams(''), [], 'hours').view === 'hours'`; `clubSearch({…, view:'hours'}, [], 'hours').has('view') === false`; `clubSearch({…, view:'chart'}, [], 'hours').get('view') === 'chart'`; `clubChangedFor(state с step 'week', [], range, false).step === false`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализовать. **Step 4:** PASS, `npm run typecheck`, e2e `club-analytics.spec.ts` PASS (Обзор и Выручка не изменились).
- [ ] **Step 5:** Коммит `refactor(club): вид по умолчанию и шаг по видам отчёта; карта часов с форматом; график процентов`.

### Task 6: Страница «Загрузка»

**Files:**
- Create: `src/client/lib/club-load.ts`, `src/client/pages/club/ClubLoadPage.tsx`, `src/client/components/club/ZonesTable.tsx`
- Modify: `src/client/router.tsx` (`club/load`), `tests/client/club-load.test.ts`

**Interfaces:**
- `club-load.ts`: тип `LoadView` (ответ задачи 3); `loadText(v: number | null): string` — «42,5 %», `null` → «нет данных»; `seatsLine(seats): string` — «В расчёте: 40 ПК (Общий зал 30, VIP 10)» (§6.1); `hourLabel(cell: HourCell): string` — «Пт 20:00–21:00 — 94 %»; `durationText(sec: number | null): string` — «1 ч 25 мин».
- Страница: виды `['hours', 'chart', 'table']` (карта по умолчанию, §6.3); разрез «Все зоны / По зонам» (`by`) — только в «график» (`byIn`), шаг — только в «график» (`stepIn`); под заголовком `seatsLine` и `seats.note` (если есть); `meta.noZones` — «Senet не прислал сеансы по зонам — проверьте отчёт «Загрузка клуба»» (§13).
  - «По часам» — `HoursHeatmap` с `loadText`, подпись «Средняя загрузка часа по дням с полными данными»; щелчок по ячейке — `ClubRows` с `…/load/rows?weekday&hour`, заголовок «Сеансы: Пт, 20:00–21:00».
  - «График» — `PercentLinesChart` по `series`.
  - «Таблица» — `ZonesTable`: колонки «Мест», «Загрузка», «Сеансов», «Сеансов на место в день», «Средняя длительность», «Часов всего», «Списано за часы», «Списано на место в час» (§6.3); строка «Все зоны» последней, жирно.
  - «Часы простоя» — под видом, 5 часов `idle`, подсказка «Время для акций» (§6.3).
  - Excel — `load.xlsx`.

- [ ] **Step 1: Тесты** `tests/client/club-load.test.ts`: `loadText(0.425) === '42,5 %'` (NBSP перед %), `loadText(null) === 'нет данных'`; `seatsLine({ total: 40, zones: [{label:'Общий зал',seats:30},{label:'VIP',seats:10}], note: null }) === 'В расчёте: 40 ПК (Общий зал 30, VIP 10)'`, без зон — «В расчёте: 40 ПК»; `hourLabel({weekday:4,hour:20,value:0.94}) === 'Пт 20:00–21:00 — 94 %'`; `durationText(5100) === '1 ч 25 мин'`, `durationText(null) === '—'`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализовать. **Step 4:** PASS, typecheck.
- [ ] **Step 5:** Коммит `feat(club): страница «Загрузка» — карта, график по зонам, таблица зон, часы простоя`.

### Task 7: «Обзор» на клиенте — загрузка на графике, «Часы пик»

**Files:**
- Modify: `src/client/lib/club-overview.ts` (`OverviewView.days[].load`, `peak`), `src/client/pages/club/ClubOverviewPage.tsx`, `tests/client/club-overview.test.ts`

**Interfaces:** график «Выручка и загрузка по дням» — `PercentLinesChart` c `bars` (выручка, KZT) и линией «Загрузка» (§4); блок «Часы пик» — 3 строки `hourLabel`, ссылка «Загрузка» → `club/load` с периодом и клубом «Обзора». Плитка «Загрузка ПК» — уже из сервера (задача 4), значение — `tileValueText` (процент).

- [ ] **Step 1: Тест:** `overviewHref(5, 'club/load', 'from=…&to=…', '')` → `/c/5/analytics/club/load?from=…&to=…`; `tileValueText` плитки `load` 0.94 → «94 %».
- [ ] **Step 2–4:** FAIL → реализовать → PASS, typecheck.
- [ ] **Step 5:** Коммит `feat(club): «Обзор» — выручка и загрузка по дням, часы пик`.

### Task 8: Блок «Зоны» в «Изменить» клуба Senet

**Files:**
- Create: `src/client/components/senet/OfficeZones.tsx`
- Modify: `src/client/components/senet/OfficeForm.tsx`

**Interfaces:** только у сохранённого клуба (`office !== null`); список зон: зона, «Найдено по данным за 30 дней: N», поле «Своё число ПК» (пусто — по данным); кнопка «Сохранить зоны» → `PUT …/offices/:id/zones`; ошибки поля — из ответа 400; архивная компания — поля недоступны. Нет зон — «Сеансов по зонам за 30 дней нет».

- [ ] **Step 1: Тест** в `tests/client/club-load.test.ts`: `parseSeats(text: string): { seats: number | null } | { error: string }` из `club-load.ts` — `'' → { seats: null }`, `' 12 ' → { seats: 12 }`, `'0'` и `'1001'` и `'1,5'` → `{ error: 'От 1 до 1000' }`. Форму проверяет e2e задачи 9.
- [ ] **Step 2–4:** FAIL → реализовать → PASS.
- [ ] **Step 5:** Коммит `feat(senet): зоны клуба в «Изменить» — свои места ПК`.

### Task 9: Демо, e2e, снимки, README, итоги

**Files:**
- Modify: `e2e/club-analytics.spec.ts`, `scripts/ux-shots.ts`, `README.md` (раздел «Аналитика клуба» — «Загрузка», зоны), `docs/superpowers/followups/2026-11-06-club-analytics-2-followups.md` (новый)

- [ ] **Step 1: e2e** (дополнить `club-analytics.spec.ts`; демо уже даёт «Общий зал» 30 мест и «VIP» 10):
  - главная: карточка «Загрузка»;
  - «Загрузка»: по умолчанию карта 7×24 с процентами; щелчок по ячейке — сеансы с маской телефона; «В расчёте: 40 ПК (Общий зал 30, VIP 10)»; «Таблица» — строки зон и «Все зоны»; «Часы простоя» — 5 строк;
  - «Изменить» клуба: зона «VIP» 12 → на «Загрузке» подсказка «По данным Senet в зонах 42 ПК, в проекте — 40. Проверьте «Количество ПК» или зоны»;
  - «Обзор»: плитка «Загрузка ПК» с процентом, «Часы пик» — 3 строки, ссылка ведёт на «Загрузку» с тем же периодом.
- [ ] **Step 2:** `npx playwright test e2e/club-analytics.spec.ts` и `E2E_DB=pg …` → PASS.
- [ ] **Step 3: Снимки** c80 «Загрузка» — карта, c81 — таблица зон, c82 — «Изменить» клуба с зонами, cm83 — «Загрузка» на телефоне; `npm run shots:ux` → все PASS.
- [ ] **Step 4:** README и итоги: R9–R16, чек-лист владельцу (карта загрузки похожа на клуб; места зон верные; «Часы пик» правдоподобны).
- [ ] **Step 5:** `npm test`, `npm run typecheck`, `npm run lint:async`, `npx playwright test` → PASS (известные `analytics-pnl:244`, `mobile:1255` — в итоги). Коммит `test(club): «Загрузка» — e2e, снимки, README`, пуш.

---

## Решения (§17 спецификации; записывает задача 1)

- **R9. Места итога.** Знаменатель — Σ «Количества ПК» проектов-клубов, у которых есть клуб Senet. Если хоть у одного такого клуба ПК не заданы — Σ мест зон (свои или по данным) и подсказка «Задайте количество ПК в карточке проекта» (§13).
- **R10. Средние — только по полным дням.** Текущий день и дни с частью данных в загрузку, карту и Δ не входят (§3.2).
- **R11. Сеанс без места** не сливается с другими: наложение одного места не проверить.
- **R12. Сеансы через границу периода** обрезаются по периоду; берутся сеансы, начатые не раньше чем за 24 ч до начала периода.
- **R13. Вид по умолчанию** — первый вид отчёта: у «Загрузки» карта (§6.3), у «Выручки» и «Обзора» — график, как было.
- **R14. Зоны в «Все клубы»** с несколькими клубами — отдельно по клубам: «{Клуб} · {зона}».
- **R15. Ячейка карты** открывает сеансы, пересекающие этот час этого дня недели в периоде.
- **R16. Δ загрузки** — в процентных пунктах, как у долей (§2.2).
