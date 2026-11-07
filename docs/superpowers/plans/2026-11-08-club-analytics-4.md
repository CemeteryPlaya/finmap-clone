# АК-4 «Аналитика клуба: Бар и приёмка» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** отчёт «Бар» (§8): таблица товаров и категорий с себестоимостью, маржой, остатком, «хватит на» и ABC, закупки, график выручки и прибыли по шагу; плитка «Маржа бара» в «Обзоре»; замер `bench:club`; README и чек-лист приёмки владельца.

**Architecture.**
- **Забор.** `shop_quantity` и `movements_of_goods` приходят за окно без дат строк. Сейчас окна часового забора начинаются в «последний забор − 26 ч» и перекрываются, поэтому сумма по окнам удваивается. Задача 1 переводит эти два отчёта на окна местных суток.
- **Отчёт** выбирает одно окно на сутки (R33) — так старые перекрытые окна тоже не удваиваются.
- **Продано и выручка** берутся из `senet_sold_items`, как строка «Бар» «Выручки» (R34). Из движения товаров — категория, себестоимость единицы, списания и приход.
- **Чистые функции** — `src/shared/club-analytics/bar.ts`: окно суток, себестоимость единицы, строки товаров и категорий, ABC, «хватит на», столбцы по шагу.
- **Сервер** — `src/server/modules/club-analytics/bar.ts`: отчёт, строки под товаром, Excel. «Обзор» берёт маржу оттуда же.
- **Клиент** — страница `ClubBarPage` на каркасе `ClubReportScreen`: плитки `Tile`, график `StackedBars`, таблица `BarTable`, продажи товара — `ClubRows`.

**Tech Stack:** Fastify 5, Drizzle (SQLite и Postgres), Zod, React 19, TanStack Query, Vitest (unit, server-sqlite, server-pg), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-club-analytics-design.md`:
- §8 «Бар»;
- §4 — плитка «Маржа бара»;
- §2.3 — к каким суткам относятся остатки и движение;
- §3.3, §11 — маршруты и бюджет;
- §14 — тесты, бенчмарк, приёмка;
- §15 — содержание АК-4.

Решения этого плана — §20 спецификации; их записывает задача 1. Итоги АК-3 — `docs/superpowers/followups/2026-11-06-club-analytics-3-followups.md`.

## Global Constraints

- **Миграций нет.** Таблицы `senet_stock`, `senet_goods_moves`, `senet_sold_items`, `senet_bar_purchases` и индексы `(office_id, from_at)` / `(office_id, at)` уже есть. Новая таблица (`senet_day_stats`) появляется только по решению владельца после `bench:club`; задача 6 её не строит.
- **Единицы:**
  - количество Senet — ×1000 (`qty`, `sold_qty`, `write_off_qty`, `actual_qty`);
  - деньги — тиыны;
  - себестоимость единицы — тиыны за 1 шт (за `qty = 1000`).
- **Экран:**
  - деньги — `clubMoney`;
  - количество — до 3 знаков без лишних нулей, как у склада (`stock-qty.ts`);
  - доли — `shareText`.
- **Время.** Сутки, шаг и дни — в `config.timezone`. Неделя начинается в понедельник (§2.3).
- **Права:**
  - чтение — по сессии, архивную компанию тоже можно читать;
  - изменяющих маршрутов в АК-4 нет.
- **Тексты интерфейса** — дословно из спецификации, где она их задаёт:
  - «нет цены прихода»;
  - «без себестоимости: N товаров»;
  - «Закуплено из кассы»;
  - «Приход в Senet по цене прихода»;
  - подсказка разницы «покупка не заведена приходом в Senet или приход без выемки»;
  - разрезы «По товарам», «По категориям».
- **Данные** в тестах, снимках и репозитории — только синтетические (§12). Названия товаров настоящего бара в репозиторий не попадают.
- **Проверка каждой задачи:**
  - `npm test`, `npm run typecheck`, `npm run lint:async` — зелёные;
  - новая логика — в чистых функциях верхнего уровня, CRAP < 10 (crapper с узким `--coverage-command`);
  - полный `npm test` — в задачах 1, 3, 4 и 7; в клиентских задачах и задачах с чистыми функциями — тесты задачи и typecheck (как Task 1 Ruling АК-2).
- **Без субагентов** (решение владельца 2026-10-18): выполняет основная сессия, финальное ревью — самопроверка.
- **Пуш** в `stage1/plan1-skeleton` — без вопроса; force-push — только с вопросом.
- **Прод.** Выкладка — после задачи 7, как в АК-3. «Загрузить за период» на проде запускать только по слову владельца.

## Review Focus

1. **Старые перекрытые окна движения товаров** (до задачи 1): окно `[03:05Z, 03:05Z + 24 ч)` рядом с выровненными окнами суток. Списания и приход за сутки не удваиваются, у каждых суток одно окно (R33). Тесты — в задачах 2 и 3.
2. **Возврат товара:** строка продаж с `refund` уменьшает «продано» и выручку. Товар только с возвратами:
   - выручка ≤ 0;
   - класс C;
   - маржа «—».

   Тест — в задаче 2.
3. **Товар продан, но его нет в движении товаров** (новый товар, Senet ещё не прислал движение):
   - строка есть, категория «Без категории»;
   - себестоимость «нет цены прихода», прибыль и маржа не считаются;
   - под таблицей — «без себестоимости: 1 товар» (склонение — `pluralRu`: «2 товара», «5 товаров»).

   Тест — в задаче 3.
4. **Период короче 14 дней или кончается в будущем** («этот месяц»):
   - «хватит на» считается по последним дням с полными продажами из 30 суток до `min(конец периода, сегодня)`;
   - если таких дней меньше 14 — среднее по тем, что есть;
   - нет ни одного — «—».

   Тест — в задаче 2 (`daysLeft`) и задаче 3 (период из 3 дней).
5. **«Все клубы» с двумя клубами, один товар в обоих:**
   - одна строка;
   - продано и остаток — суммы по клубам;
   - окна суток выбираются у каждого клуба отдельно.

   Тест — в задаче 3.

---

### Task 1: Забор остатков и движения товаров по местным суткам

**Files:**
- Modify: `src/server/modules/senet/sync.ts`, `src/server/modules/senet/time.ts`
- Test: `tests/server/senet-sync.test.ts` — и функция окон (блок `localDayWindows`), и забор
- Modify: спецификация — новый §20 «Решения планирования плана АК-4» (раздел «Решения» ниже); `Plans.md` — Phase 9 (строки 82–88 со статусом `cc:TODO`)

**Interfaces:**
- Produces:
  ```ts
  /** Окна местных суток, пересекающих [from, to) (R32): [полночь, следующая полночь); последнее — до `to`. */
  export function localDayWindows(from: string, to: string, timezone: string): [string, string][];
  ```
  Полночь — `startOfDayUtc(day, tz)` (`src/shared/dates.ts`). Первое окно начинается в полночь суток `from`, то есть раньше `from`, если `from` не полночь.

**Изменение `sync.ts`.**
- `stock` и `goodsMoves` убираются из цикла окон по 24 ч от `from`.
- Они забираются отдельным циклом по `localDayWindows(from, to, d.timezone)`: каждое окно пишется своей транзакцией через `writeAnalyticsDay(tx, { officeId, from: w0, to: w1, stock, goodsMoves, phone })` (остальные отчёты — `undefined`) и отмечается `markSpan` своим окном.
- Строки суток заменяются прежним `inWindow` (тот же `from_at`): повторный забор текущих суток перезаписывает их.
- Старые окна не удаляются (R33).
- Проверка на 2000 строк этих отчётов не касается, как и сейчас.

- [ ] **Step 1: Тесты** (`tests/server/senet-sync.test.ts`, пояс `Asia/Almaty`, UTC+5):
  - `localDayWindows('2026-10-01T03:05:00.000Z', '2026-10-02T12:00:00.000Z', 'Asia/Almaty')` → `[['2026-09-30T19:00:00.000Z','2026-10-01T19:00:00.000Z'], ['2026-10-01T19:00:00.000Z','2026-10-02T12:00:00.000Z']]`;
  - `from` ровно в полночь → первое окно начинается в `from`;
  - `from === to` → `[]`;
  - **повторный часовой забор:** после `manual` и `hourly` (как в тесте «повторный забор») запросы `shop_quantity` и `movements_of_goods` начинаются только в местные полночи (`from_date` каждого из них оканчивается на `T19:00:00.000Z`);
  - `SELECT COUNT(DISTINCT from_at)` в `senet_goods_moves` равно числу суток окна; повтор текущих суток не добавляет окон;
  - тест отрезков (`забор отмечает отрезки…`): ожидание `day('goodsMoves')` и `day('stock')` меняется — отрезок начинается в местную полночь суток `HISTORY_FROM`.
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/senet-sync.test.ts` → FAIL (нет `localDayWindows`, окна от `from`).
- [ ] **Step 3:** Реализовать `localDayWindows` и цикл в `sync.ts`.
- [ ] **Step 4:** Тот же запуск и `--project server-pg` → PASS; полный `npm test`; crapper на `sync.ts` — `runConnection` не выше прежнего, при росте — вынести цикл в функцию верхнего уровня.
- [ ] **Step 5:** Записать §20 спецификации и Phase 9 в `Plans.md`. Коммит `feat(senet): остатки и движение товаров — окнами местных суток`.

### Task 2: Бар — чистые функции

**Files:**
- Create: `src/shared/club-analytics/bar.ts`, `tests/shared/club-bar.test.ts`

**Interfaces:**
- Consumes: `localParts` (`hours.ts`), `startOfDayUtc`, `addDays` (`dates.ts`).
- Produces:
  ```ts
  export const ABC_A = 0.8;
  export const ABC_B = 0.95;
  export const RECENT_DAYS = 14;    // «хватит на» — по 14 последним дням с данными (§8.1)
  export const RECENT_LOOKBACK = 30; // … из 30 суток до конца (R36)
  export const LOW_DAYS = 3;        // меньше 3 дней — красная ячейка
  export type Abc = 'A' | 'B' | 'C';
  export const NO_CATEGORY = 'Без категории';

  export interface BarWindow { officeId: number; fromAt: string; toAt: string }
  /** Окно суток (R33): ключ `${officeId}|${день}`. Окно относится к суткам наибольшего пересечения; у суток — окно наибольшего
   *  пересечения, при равенстве — с более поздним `fromAt`. */
  export function dayWindows<W extends BarWindow>(windows: readonly W[], tz: string): Map<string, W>;

  export interface BarSale { officeId: number; at: string; item: string; qty: number; amount: number } // возврат — qty и amount с минусом
  export interface BarMove extends BarWindow { item: string; category: string; writeOffQty: number; restockSum: number; restockPrice: number | null; soldQty: number; soldCost: number | null }
  export interface BarStock extends BarWindow { item: string; actualQty: number | null; restockPrice: number | null }

  /** Себестоимость единицы (R35): Σ soldCost / (Σ soldQty / 1000) окон периода; иначе последняя restockPrice до конца периода; иначе нет. */
  export function unitCosts(periodMoves: readonly BarMove[], earlier: readonly (BarMove | BarStock)[]): Map<string, number>;
  /** Последняя непустая категория товара по `toAt` (R35). */
  export function categoriesOf(moves: readonly BarMove[]): Map<string, string>;
  /** Остаток товара (R36): Σ по клубам `actualQty` из окна последних суток клуба, где товар есть. */
  export function lastStock(stock: readonly BarStock[], tz: string): Map<string, number>;
  export function abcOf(rows: readonly { key: string; revenue: number }[]): Map<string, Abc>;
  /** «Хватит на», дней (R36): остаток / (продано за дни / дней); нет продаж, остатка или дней — null. */
  export function daysLeft(stockQty: number | null, soldQty: number, days: number): number | null;

  export interface BarRow {
    key: string;          // товар или категория
    category: string;     // у строки категории — она сама
    soldQty: number;
    revenue: number;
    cost: number | null;  // null — нет цены прихода
    profit: number | null;
    margin: number | null; // прибыль / выручку; выручка ≤ 0 — null
    writeOffQty: number;
    stockQty: number | null; // у категории — null
    daysLeft: number | null; // у категории — null
    abc: Abc;
  }
  export interface BarInput {
    sales: readonly BarSale[];
    moves: readonly BarMove[];            // окна суток периода (dayWindows)
    costs: ReadonlyMap<string, number>;
    categories: ReadonlyMap<string, string>;
    stock: ReadonlyMap<string, number>;
    recent: { sold: ReadonlyMap<string, number>; days: number };
  }
  /** Строки товаров: товары продаж и движения периода; по убыванию выручки, равные — `localeCompare('ru')`. */
  export function barItems(input: BarInput): BarRow[];
  /** Строки категорий (R38): суммы товаров; себестоимость — null, только если у всех товаров категории её нет. */
  export function barCategories(items: readonly BarRow[]): BarRow[];
  /** Столбцы графика (R39) по корзинам шага: себестоимость, прибыль и выручка товаров без цены прихода. */
  export function barColumns(sales: readonly BarSale[], costs: ReadonlyMap<string, number>, buckets: readonly { from: string; to: string }[], tz: string): { cost: number; profit: number; noCost: number }[];
  ```

**Правила** (их проверяют тесты):
- себестоимость товара = `Math.round(soldQty × unit / 1000)`;
- прибыль = выручка − себестоимость;
- у категории без себестоимости хотя бы у одного товара себестоимость и прибыль считаются по товарам с ней; маржа категории — по ним же.

- [ ] **Step 1: Тесты** `tests/shared/club-bar.test.ts` (пояс `Asia/Almaty`, сутки 01.11 = `[2026-10-31T19:00Z, 2026-11-01T19:00Z)`):
  - **`dayWindows`, старые окна (Review Focus 1):**
    - окна клуба 1: `A [10-31T19:00, 11-01T19:00)`, `B [11-01T03:05, 11-02T03:05)`, `C [11-01T19:00, 11-02T19:00)`;
    - результат: `1|2026-11-01 → A`, `1|2026-11-02 → C`;
    - `B` не выбран: он отнесён к 01.11, где проигрывает `A`.
  - **`dayWindows`, только старые окна:** `B` один → `1|2026-11-01 → B`, `1|2026-11-02` нет.
  - **`dayWindows`, частичное окно текущих суток:** `[11-01T19:00, 11-02T07:00)` → `1|2026-11-02`.
  - **`dayWindows`, два клуба:** окна с одинаковым временем у клубов 1 и 2 → два ключа.
  - **`unitCosts`:**
    - окна с `soldQty` 2000 / `soldCost` 76000 и 1000 / 38000 → 38000;
    - `soldQty` 0 во всех окнах периода и `restockPrice` 40000 в раннем окне → 40000;
    - нет ни того, ни другого → товара нет в карте;
    - `soldCost` null не считается.
  - **`abcOf`, граница 80 %:**
    - выручки `a 50, b 30, c 15, d 5` → `A, A, B, C` (у `c` до него ровно 80 % → B);
    - товар с выручкой 0 и с −10 → C;
    - все нули → все C.
  - **`daysLeft`:**
    - `(10000, 14000, 14)` → 10;
    - `(10000, 0, 14)` → null;
    - `(null, 5000, 14)` → null;
    - `(5000, 5000, 3)` → 3;
    - `(1000, 7000, 14)` → ≈ 2 (меньше `LOW_DAYS`).
  - **`barItems`:**
    - продажа 2 шт за 1500 ₸ + возврат 1 шт за −750 ₸ → `soldQty` 1000, `revenue` 75000;
    - себестоимость единицы 38000 → `cost` 38000, `profit` 37000, `margin` 37000/75000;
    - **только возврат (Review Focus 2):** `revenue` −75000, `abc` 'C', `margin` null;
    - товар без себестоимости → `cost`, `profit`, `margin` null;
    - товар без продаж, но со списанием в движении → строка с `soldQty` 0 и `writeOffQty`;
    - **«хватит на»:** `stock` 10000, `recent.sold` 14000 за `days` 14 → `daysLeft` 10.
  - **`barCategories`:**
    - два товара «Напитки» (с себестоимостью и без) → одна строка: `revenue` — сумма обоих, `cost` — только первого;
    - `stockQty` и `daysLeft` — null;
    - ABC — по категориям.
  - **`barColumns`:** продажи 01.11 и 02.11, у одного товара нет себестоимости, корзины по суткам → `[{ cost, profit, noCost }, …]`; `cost + profit + noCost` колонки = выручка бара колонки.
- [ ] **Step 2:** `npx vitest run --project unit tests/shared/club-bar.test.ts` → FAIL (нет модуля).
- [ ] **Step 3:** Реализовать `bar.ts` по Interfaces и правилам.
- [ ] **Step 4:** Тот же запуск → PASS; crapper на `bar.ts` < 10.
- [ ] **Step 5:** Коммит `feat(club): бар — окна суток, себестоимость, ABC, «хватит на» (чистые функции)`.

### Task 3: Отчёт «Бар» — сервер

**Files:**
- Create: `src/server/modules/club-analytics/bar.ts`, `tests/server/club-bar.test.ts`
- Modify:
  - `src/shared/schemas/club-analytics.ts`;
  - `src/server/modules/club-analytics/routes.ts`;
  - `src/server/app.ts`.

**Interfaces:**
- Consumes: Task 2; `clubScope`, `loadSpans`, `combineCoverage` / `dayCoverage`, `reportColumns`, `previousRange`, `buildXlsx`, `reportInfo`.
- Produces:
  ```ts
  // schemas/club-analytics.ts
  export const BAR_BYS = ['items', 'categories'] as const;
  export const barQuerySchema;      // { ...clubShape, by: 'items' (по умолчанию) | 'categories' }
  export const barRowsQuerySchema;  // { ...clubShape, item: string 1..200, cursor }
  export type BarQuery; export type BarRowsQuery;

  // server/modules/club-analytics/bar.ts
  /** Данные бара периода (`from`–`to`): продажи, окна суток, себестоимость единицы, категории, остаток, продажи для «хватит на», покрытие. */
  export interface ClubBarData { … }
  export async function clubBar(db: Db, tz: string, ids: number[], from: string, to: string, today: string): Promise<ClubBarData>;
  /** Маржа бара (R40): за период и по дням; нет товаров с себестоимостью — null. Для «Обзора». */
  export function barMarginFigures(d: ClubBarData, days: readonly string[], tz: string): { total: number | null; byDay: (number | null)[] };
  export function createClubBar(d: { db: Db; timezone: string; now: () => Date }): {
    bar(cid: number, q: BarQuery): Promise<BarReport>;
    rows(cid: number, q: BarRowsQuery): Promise<{ items: { at: string; qty: number; amount: number; refund: boolean }[]; next: number | null }>;
    xlsx(cid: number, q: BarQuery): Promise<{ name: string; data: Buffer }>;
  };
  export type ClubBar = ReturnType<typeof createClubBar>;
  ```
- **Маршруты:**
  - `GET …/club-analytics/bar`;
  - `GET …/club-analytics/bar/rows` — продажи товара периода, по времени, страницами по 50;
  - `GET …/club-analytics/bar.xlsx`.
- **Ответ `bar`** (поля как у других отчётов клуба, §11):
  ```ts
  {
    tiles: OverviewTile[];   // barRevenue «Выручка бара», barCost «Себестоимость», barProfit «Прибыль бара» — sum; barMargin «Маржа бара» — share
    rows: BarRow[];          // по `by`
    noCost: number;          // товаров без себестоимости
    columns: ReportColumn[]; // шаг
    series: { id: 'cost' | 'profit' | 'noCost'; label: 'Себестоимость' | 'Прибыль' | 'Без себестоимости'; values: (number | null)[] }[];
    purchases: { desk: number; restock: number; diff: number };
    coverage; prevCoverage; freshness; meta;
  }
  ```

**Что читает `clubBar`:**
- **продажи периода** — `senet_sold_items` с `qty IS NOT NULL` по `at`; возврат — с минусом;
- **продажи для «хватит на»:**
  - `[min(to, today) − 29 суток, min(to, today)]`;
  - дни с полным покрытием `soldItems`, последние `RECENT_DAYS` из них;
- **движение** — окна `senet_goods_moves`, пересекающие период ± 1 сутки, затем `dayWindows` и только сутки периода; для `unitCosts` и `categoriesOf` — и окна раньше периода (все до `to`);
- **остатки** — окна `senet_stock`, пересекающие `[from − 30 суток, to]`; `dayWindows`; `lastStock` по суткам ≤ `to`;
- **закупки:**
  - Σ `senet_bar_purchases.amount` выемок (`senet_cash_moves` → `senet_shifts.office_id`) с `at` в периоде;
  - приход — Σ `restock_sum` окон суток периода;
  - `diff = desk − restock`;
- **покрытие (R41)** — `combineCoverage` отчётов `soldItems` и `goodsMoves`.

**Δ плиток** — как в «Обзоре»:
- суммы — в процентах, «≈» при неполных данных;
- маржа — в процентных пунктах.

**Excel `bar.xlsx`:**
- лист «Товары» или «Категории» по `by` — колонки §8.1, ABC буквой, «хватит на» числом;
- лист «По шагу» — колонки шага × три ряда;
- лист «Закупки» — три строки;
- шапка — `reportInfo`.

- [ ] **Step 1: Тесты** `tests/server/club-bar.test.ts` (оба диалекта, `clubWorld()`; продажи — фикстура `CLUB_DATA.sold`; окна движения и остатков вставляются SQL):
  - **товары:**
    - `GET bar?from=2026-11-01&to=2026-11-02` — строка «Напиток 1»:
      - `soldQty` 3000;
      - `revenue` T(2250) — равна строке «Бар» отчёта `revenue` за тот же период;
      - себестоимость по окнам 01.11 и 02.11 (`soldCost` T(380) за 1 шт) → `cost` T(1140), `margin` (2250 − 1140) / 2250;
    - чек времени `A1B2` в строках не появляется;
  - **старые окна не удваивают (Review Focus 1):** к выровненным окнам 01.11 и 02.11 добавить окно `[11-01T03:05Z, 11-02T03:05Z)` со списанием 5 шт → `writeOffQty` равен сумме выровненных окон;
  - **новый товар без движения (Review Focus 3):**
    - продажа «Товар 9» без строк движения → строка с `category` 'Без категории', `cost` null;
    - `noCost` 1;
    - на клиенте `pluralRu` даёт «1 товар» (проверяет задача 5);
  - **по категориям:** `by=categories` → строки «Напитки» и «Без категории»; `stockQty` null;
  - **остаток и «хватит на»:**
    - окно остатков 02.11: `actual_qty` 10000;
    - продажи за 2 дня с полным покрытием → `daysLeft` = 10000 / (3000 / 2);
    - **период из 3 дней (Review Focus 4)** — по тем же 2 дням;
  - **«Все клубы» (Review Focus 5):**
    - второй клуб с проектом-клубом, то же «Напиток 1»: продажа 1 шт и остаток 5000;
    - одна строка: `soldQty` и `stockQty` — суммы по клубам;
    - `project=<id клуба 1>` — только его цифры;
  - **закупки:** выемка «Бар» с разобранной закупкой T(1000) и окна с `restock_sum` T(800) → `{ desk: T(1000), restock: T(800), diff: T(200) }`;
  - **плитки и сравнение:** `compare=1` → у `barRevenue` есть `prev`; маржа — `kind: 'share'`;
  - **покрытие:** день без окна движения → `coverage.withData` меньше числа дней; полоса — как у других отчётов;
  - **строки товара:** `bar/rows?item=Напиток 1` → продажи и возврат по времени, `next` null; второй страницы нет;
  - **Excel:**
    - `bar.xlsx` → листы «Товары», «По шагу», «Закупки»;
    - `bar.xlsx?by=categories` → лист «Категории»;
  - **ошибки:**
    - чужая компания — 404;
    - `by=x` — 400 «Разрез — items или categories».
- [ ] **Step 2:** `npx vitest run --project server-sqlite tests/server/club-bar.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать схемы, `bar.ts`, маршруты, подключение в `app.ts`. SQL только читает строки; считают функции задачи 2.
- [ ] **Step 4:** Тот же запуск и `--project server-pg` → PASS; полный `npm test`; crapper на `bar.ts` < 10.
- [ ] **Step 5:** Коммит `feat(club): отчёт «Бар» — товары, категории, закупки, Excel`.

### Task 4: Каталог и «Обзор» — карточка «Бар», плитка «Маржа бара»

**Files:**
- Modify:
  - `src/shared/analytics-catalog.ts`;
  - `src/server/modules/club-analytics/overview.ts`;
  - `src/client/lib/club-analytics.ts` (`ClubReportKind` + `'bar'`).
- Test:
  - `tests/server/club-overview.test.ts`;
  - `tests/shared/analytics-catalog.test.ts`;
  - тесты перечня карточек: `grep -rn "Гости" tests e2e`, где перечисляются карточки группы.

**Interfaces:**
- Consumes: `clubBar`, `barMarginFigures` (Task 3).
- **Каталог:**
  - `CLUB_DASHBOARDS` + `{ key: 'bar', title: 'Бар', description: 'Продажи, маржа и остатки по товарам, ABC', help: 'Продажи бара по товарам и категориям: выручка, себестоимость по цене прихода, прибыль, маржа, списания, остаток и на сколько дней его хватит, ABC по выручке. Ниже — закупки из кассы и приход в Senet.', path: 'club/bar' }`;
  - `BUILT_CLUB_REPORTS` + `'bar'`;
  - `TILE_SOON.bar` остаётся — тип не меняется, ключ больше не используется.
- **«Обзор»:**
  - `REPORT_HREF.bar = 'club/bar'`;
  - `MEASURES.barMargin` — значение и ряд из `barMarginFigures`;
  - данные бара читаются, только если плитка `barMargin` видна — как гости в АК-3.

- [ ] **Step 1: Тесты:**
  - «Обзор» с видимой `barMargin`:
    - плитка доступна, `href` 'club/bar';
    - `value` = маржа товаров с себестоимостью за период;
    - ряд по дням;
    - `prev` при `compare=1`;
  - без себестоимости ни у одного товара → `value` null, плитка доступна;
  - настройки: пометки «Появится с отчётом «Бар»» нет ни у одной плитки;
  - `resolveDashboards` для сохранённой настройки без `bar` → карточка `bar` в конце, видимая.
- [ ] **Step 2:** запуск тестов задачи → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Тесты задачи на обоих диалектах → PASS; полный `npm test`. e2e «Обзора» проверял пометку «Бара» (Task 6 АК-3) — поправить на плитку «Маржа бара» со ссылкой; сам прогон e2e — в задаче 6.
- [ ] **Step 5:** Коммит `feat(club): «Бар» на витрине; «Маржа бара» в «Обзоре»`.

### Task 5: Страница «Бар»

**Files:**
- Create:
  - `src/client/lib/club-bar.ts`;
  - `src/client/pages/club/ClubBarPage.tsx`;
  - `src/client/components/club/BarTable.tsx`;
  - `tests/client/club-bar.test.ts`.
- Modify: `src/client/router.tsx` — маршрут `club/bar`.

**Interfaces:**
- Consumes: ответ Task 3; `ClubReportScreen`, `Tile`, `StackedBars`, `ClubRows`, `shareText`, `clubMoney`, `pluralRu`.
- Produces:
  ```ts
  export interface BarView extends ClubReportBase { tiles: OverviewTile[]; rows: BarRowView[]; noCost: number; columns: ReportColumn[]; series: …; purchases: { desk: number; restock: number; diff: number }; … }
  export type BarSortKey = Exclude<keyof BarRowView, 'category'> | 'category';
  export function sortBar(rows: readonly BarRowView[], key: BarSortKey, dir: 'asc' | 'desc'): BarRowView[]; // null — в конце при любом направлении
  export function daysLeftText(v: number | null): string;  // null → «—»; 2.46 → «2,5»; целое — без запятой
  export function noCostText(n: number): string | null;    // 0 → null; «без себестоимости: 1 товар» / «2 товара» / «5 товаров»
  export function qtyText(qty: number): string;            // ×1000 → «3», «1,5», «0,125»
  ```

**Страница:**
- **Контролы:**
  - виды — «график / таблица», по умолчанию график (R13);
  - шаг — только в графике;
  - разрез «По товарам / По категориям» — только в таблице;
  - Excel.
- **Над видом:** 4 плитки.
- **График** — `StackedBars` «Выручка и прибыль бара»: ряды «Себестоимость», «Прибыль», «Без себестоимости», деньги; колонки не выбираются (R39).
- **Таблица** — `BarTable` с колонками §8.1 по порядку и сортировкой по щелчку на заголовке:
  - «нет цены прихода» в пустой себестоимости;
  - «—» в пустых прибыли и марже;
  - «хватит на» меньше 3 — класс `text-expense`;
  - ABC — буква;
  - строка «Итого» — суммы продано, выручки, себестоимости, прибыли, списаний и маржа итога.
- **Под таблицей:**
  - `noCostText`;
  - блок «Закупки» — три строки §8.2; у разницы, отличной от 0, подсказка (`HelpButton`).
- **Щелчок по товару** в разрезе «По товарам» открывает `ClubRows` с продажами товара (`bar/rows`), повторный щелчок закрывает. В разрезе «По категориям» строки не щёлкаются.
- **Телефон:** таблица прокручивается вбок, первая колонка закреплена — как `GuestsTable`.

- [ ] **Step 1: Тесты** `tests/client/club-bar.test.ts`:
  - `sortBar` по `margin` asc и desc — null последними;
  - `daysLeftText(null)` → «—»;
  - `daysLeftText(2.46)` → «2,5»;
  - `daysLeftText(10)` → «10»;
  - `noCostText(0)` → null;
  - `noCostText(1)` → «без себестоимости: 1 товар»;
  - `noCostText(5)` → «без себестоимости: 5 товаров»;
  - `qtyText(1500)` → «1,5».
- [ ] **Step 2–4:** FAIL → реализовать lib, таблицу, страницу, маршрут → PASS; typecheck.
- [ ] **Step 5:** Коммит `feat(club): страница «Бар» — плитки, график, таблица товаров, закупки`.

### Task 6: Демо, e2e, снимки, README

**Files:**
- Modify:
  - `scripts/lib/senet-club-demo.ts`;
  - `e2e/club-analytics.spec.ts`;
  - `scripts/ux-shots.ts`;
  - `README.md` — раздел «Аналитика клуба», «Бар».

- [ ] **Step 1: Демо.** `clubDemoReports` отдаёт `shop_quantity` и `movements_of_goods` за окно запроса из продаж окна:
  - `GOODS` получают категорию: «Напитки» — кола, энергетик, вода; «Еда» — чипсы, сэндвич;
  - цена прихода — 55 % цены, у «Сэндвича» её нет — `restock_price` и `sold_cost` пустые;
  - списание — 1 шт «Чипсов» в каждые седьмые сутки;
  - приход — 48 шт товара в понедельник;
  - остаток: 60 шт в начале, минус проданное и списанное, плюс приход.

  Детерминированно, без новых случайных чисел: остальные демо-данные не меняются.
- [ ] **Step 2: e2e** (дополнить `club-analytics.spec.ts`):
  - главная — карточка «Бар»;
  - «Бар», график: 4 плитки и график «Выручка и прибыль бара»;
  - «таблица»:
    - 5 строк товаров;
    - у «Сэндвича» «нет цены прихода»;
    - под таблицей «без себестоимости: 1 товар»;
    - сортировка по «Маржа» меняет порядок;
    - щелчок по «Кола 0,5» открывает продажи;
  - «По категориям» — строки «Напитки», «Еда»;
  - «Обзор» — «Маржа бара» с числом, ссылка ведёт на «Бар» с тем же периодом;
  - Excel «Бара» скачивается.
- [ ] **Step 3:** `npx playwright test e2e/club-analytics.spec.ts` и `E2E_DB=pg …` → PASS.
- [ ] **Step 4: Снимки** (`npm run shots:ux` → все PASS):
  - c88 — «Бар», график;
  - c89 — таблица товаров и закупки;
  - cm90 — «Бар» на телефоне.

  Если номера заняты — следующие свободные; ledger-ruling.
- [ ] **Step 5: README** — раздел «Бар»:
  - что считается и откуда (R34–R39);
  - окна суток (R32, R33);
  - как исправить старые сутки: «Загрузить за период».

  Коммит `test(club): «Бар» — демо, e2e, снимки, README`.

### Task 7: `bench:club`, приёмка, итоги

**Files:**
- Create:
  - `scripts/bench-club.ts`;
  - `docs/superpowers/followups/2026-11-08-club-analytics-4-followups.md`.
- Modify:
  - `package.json` — `"bench:club": "tsx scripts/bench-club.ts"`;
  - `Plans.md`.

**Замер** (§11) — по образцу `bench-reports.ts`:
- **Где:** временная папка, своя база, `buildApp` и `app.inject`. Папка данных приложения не трогается.
- **Флаг** `--pg <url|pglite>` — тот же замер на Postgres.
- **Синтетический клуб на год** — строки пишутся прямо в базу одной транзакцией:
  - 150 000 сеансов (2 зоны, 40 мест, вечерний пик, 8 000 гостей, каждый четвёртый — чек);
  - 200 000 строк продаж: 85 % товаров 5 видов, остальное — чеки времени;
  - 30 000 абонементов;
  - 60 000 пополнений;
  - транзакции кассы;
  - смены;
  - окна суток движения и остатков (365 × 5 товаров);
  - отрезки покрытия всех отчётов на год.
- **Отчёты за год со сравнением, p95 из 5 прогонов после прогрева:**
  - `overview` (все плитки видимы);
  - `revenue` по `parts`, `payment`, `shifts`, `cashiers` и вид `hours`;
  - `load` (`all`, `zones`);
  - `guests`;
  - `bar` (`items`, `categories`).
- **Вывод:** таблица «отчёт — p95 мс — бюджет 800». Код выхода 1, если бюджет нарушен.

- [ ] **Step 1:** Написать `bench-club.ts`.
- [ ] **Step 2:** Запустить `npm run bench:club` и `npm run bench:club -- --pg pglite`. Результат — в итоги.
- [ ] **Step 3: Если отчёт дольше 800 мс:**
  - не чинить в этом плане;
  - записать в итоги отчёт, мс и где уходит время (по `performance.now()` этапов);
  - в `Plans.md` — строка `cc:TODO` «Аналитика клуба: бюджет 800 мс — {отчёты}»;
  - в итоговом сообщении — вопрос владельцу: суточные агрегаты `senet_day_stats` (§11) или другое.

  Это ledger-ruling, не стоп.
- [ ] **Step 4: Итоги АК-4** (`…-4-followups.md`, формат итогов АК-3):
  - что сделано;
  - R32–R42;
  - решения по задачам;
  - известное.

  **Чек-лист приёмки владельца — вся «Аналитика клуба» (§14):**
  1. деньги в кассу за неделю совпадают со «Сверкой», а разница с выручкой объяснена;
  2. карта загрузки похожа на то, что владелец видит в клубе;
  3. два логина знакомого постоянного гостя показаны одним гостем;
  4. топ товаров бара похож на правду;
  5. «Выручка бара» в «Баре» равна строке «Бар» в «Выручке» за тот же период;
  6. остаток трёх ходовых товаров на сегодня совпадает с Senet;
  7. «Закуплено из кассы» за месяц похоже на выемки «Бар» в «Сверке»;
  8. пункты 5–7 итогов АК-3 (одноразовые чеки).
- [ ] **Step 5: Финальная проверка:**
  - `npm test`, `npm run typecheck`, `npm run lint:async`, `npx playwright test` → PASS;
  - известные падения (`analytics-pnl:244`, `mobile:1255`) — в итоги, если они ещё есть;
  - `Plans.md` — строки 82–88 `cc:完了`;
  - самопроверка ветки (harness-review manual-pass) по Review Focus;
  - коммит `docs(club): итоги АК-4, bench:club, чек-лист приёмки`, пуш, выкладка на прод (`create_deployment`), проверка «Бара» на проде за месяц: статус 200 и время ответа.

---

## Решения (§20 спецификации; записывает задача 1)

- **R32. Окна остатков и движения.**
  - `shop_quantity` и `movements_of_goods` забираются окнами местных суток: `[полночь, следующая полночь)`, у текущих суток — до момента забора.
  - Повторный забор суток заменяет их строки: у окна тот же `from_at`.
  - Причина: эти отчёты приходят без дат строк, а прежние окна от «последний забор − 26 ч» перекрывались — сумма по окнам удваивалась.
- **R33. Окно суток в отчёте.**
  - Каждое окно относится к суткам наибольшего пересечения. У суток берётся одно окно — с наибольшим пересечением, при равенстве — с более поздним началом.
  - Старые окна (до R32) не удаляются: полные окна суток перебивают их сами.
  - Цена: в сутках только со старыми окнами списания, приход и остаток сдвинуты на часы. Лечится «Загрузить за период».
- **R34. Продано и выручка товара** — из продаж Senet (`senet_sold_items`, строки с количеством, возврат с минусом), как строка «Бар» в «Выручке». Выручка бара в двух отчётах совпадает.
  - Из движения товаров берутся категория, себестоимость единицы, списания и приход.
  - Названия товаров в продажах и в движении совпадают — проверено на выгрузках 13–31.10.
- **R35. Себестоимость и категория.**
  - Себестоимость = продано × себестоимость единицы.
  - Себестоимость единицы = Σ «себестоимость проданного» / Σ «продано» окон суток периода.
  - Нет продаж в окнах — последняя цена прихода товара до конца периода. Нет и её — «нет цены прихода».
  - Категория — последняя непустая из движения до конца периода; нет — «Без категории».
- **R36. Остаток и «хватит на».**
  - Остаток — «фактический остаток» товара в окне остатков последних суток периода, где товар есть.
  - «Хватит на» = остаток / среднее «продано в день». Среднее — за последние 14 дней с полными продажами из 30 суток до конца периода (но не позже сегодня); дней меньше — за те, что есть.
  - Нет продаж — «—». До 1 знака после запятой; меньше 3 дней — красная.
- **R37. ABC.**
  - Товары — по убыванию выручки периода, равные — по названию.
  - A — доля выручки товаров до него меньше 80 %; B — меньше 95 %; иначе C.
  - Выручка ≤ 0 — C.
- **R38. «По категориям»:**
  - строки — категории;
  - колонки — продано, выручка, себестоимость, прибыль, маржа, списано, ABC;
  - без остатка и «хватит на»;
  - себестоимость категории — по товарам, у которых она есть.
- **R39. Виды.**
  - **«График»** — столбцы по шагу: «Себестоимость», «Прибыль», «Без себестоимости» (выручка товаров без цены прихода). Высота столбца — выручка бара. Колонки не выбираются.
  - **«Таблица»** — товары или категории. Щелчок по товару открывает его продажи периода под таблицей.
  - **Над видом** — плитки «Выручка бара», «Себестоимость», «Прибыль бара», «Маржа бара» с Δ к прошлому периоду.
- **R40. «Маржа бара»** (плитка «Обзора» и «Бара») = прибыль / выручку товаров с себестоимостью. Таких товаров нет — «—».
- **R41. Покрытие «Бара».** День полный, если полны продажи и движение товаров (§3.3).
- **R42. `bench:club`.**
  - Синтетический клуб на год, все пять отчётов, p95 из 5 прогонов.
  - Превышение 800 мс в АК-4 не чинится: оно записывается в итоги, а решение (`senet_day_stats` или другое) принимается с владельцем.
