# АК-1 «Аналитика клуба: основа, настройки, Обзор, Выручка» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая часть «Аналитики клуба». Что даёт:
- покрытие данных Senet по дням;
- дашборды в шаблоне «Компьютерный клуб» и раздел «Настройки → Аналитика»;
- группа карточек клуба на главной «Аналитики»;
- отчёты «Выручка клуба» и «Обзор клуба».

**Architecture.**
- **Чистые функции** — в `src/shared/club-analytics/`: покрытие, раскладка по часам, части выручки, колонки, Δ.
- **Сервер** — `src/server/modules/club-analytics/`: контекст клуба, выручка, обзор, настройки, маршруты. Строки берёт SQL, раскладывают и агрегируют чистые функции.
- **Клиент**: каркас `ClubReportScreen` повторно использует контролы финансовой «Аналитики» (`PeriodMenu`, `ChoiceMenu`, `ReportParts`, `report-url`); каталог дашбордов и плиток — общий `src/shared/analytics-catalog.ts`.

**Tech Stack:** Fastify 5, Drizzle (SQLite и Postgres), Zod, React 19, TanStack Query, Vitest (unit, server-sqlite, server-pg), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-club-analytics-design.md` (одобрена 2026-11-03). Решения этого плана — §16 спецификации, их записывает задача 1.

## Global Constraints

- Обе базы: каждая миграция — SQLite (`src/server/db/migrations`, следующая — `0015`) и Postgres (`src/server/db/migrations-pg`, следующая — `0005`).
  - Генерация — `npm run db:generate`, затем переименовать файлы и `tag` в `meta/_journal.json` по смыслу, как `0014_senet_stock_load`.
  - Таблицу зарегистрировать в `schema.ts` и `schema-pg.ts`, как `senetLoad` в 64a8363.
- Суммы Senet — в тиынах, количество — ×1000 (§2.3). На экране `formatMoney(v, 'KZT')`.
- Часы, дни и дни недели — в `config.timezone` (`APP_TIMEZONE`). Неделя — с понедельника, индекс дня недели 0 = Пн.
- Телефон наружу — только `phone_mask`. `phone_hash` не попадает ни в ответ API, ни в xlsx (§12).
- Чтение отчётов: сессия, компания из адреса, архивная компания тоже читается. Запись настроек: CSRF и `requireCompany(db, cid, { writable: true })`, как `savePart` в `analytics/service.ts`.
- Тексты интерфейса — дословно из спецификации, где она их задаёт.
- Только синтетические данные в тестах, снимках и репозитории. Настоящие — только в `.superpowers/senet-local/` и в браузере владельца (§12).
- Проверка задачи: `npm test`, `npm run typecheck`, `npm run lint:async` — зелёные. Серверные тесты идут в проектах `server-sqlite` и `server-pg`.
- Решение владельца 2026-10-18 — без субагентов. Выполняет основная сессия, ревью — harness-review manual-pass. Пуш в `stage1/plan1-skeleton` — без вопроса, force-push — с вопросом.

## Review Focus

1. **Часовой забор не выровнен по полуночи.** Сутки покрываются несколькими пересекающимися окнами `[t−26 ч, t)`. День полный, только если их объединение покрывает его целиком. Тест — задача 1.
2. **«Все клубы» при выключенном клубе или клубе без проекта.**
   - Выключенный клуб с проектом учитывается (§3.1).
   - Клуб без проекта не учитывается и не роняет отчёт.
   
   Тест — задача 5.
3. **Ночная смена через полночь и через границу периода.** Сходимость берёт смены, открытые в периоде, целиком; дневные суммы со сменами не сравниваются (§3.4). Тест — задача 5.
4. **Прошлый период без данных или с дырами.**
   - Δ = «—», если в прошлом периоде нет данных.
   - Δ сумм с «≈», если есть дыры (§2.2).
   
   Тест — задача 7.
5. **«Количество ПК» не задано или проектов несколько.** «Выручка на ПК в день» считается по сумме ПК проектов с заданным параметром. Если ни у одного не задан — плитка недоступна с подсказкой «Задайте количество ПК в карточке проекта» (§13). Тест — задача 9.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/shared/club-analytics/coverage.ts` | Отрезки забора → покрытие дней (`full / partial / none`) |
| `src/shared/club-analytics/hours.ts` | Раскладка отрезка времени по часам местного времени |
| `src/shared/club-analytics/columns.ts` | Дни периода, суммы по колонкам шага с учётом покрытия, прошлый период |
| `src/shared/club-analytics/revenue.ts` | Части выручки по дням, по способу оплаты, карта часов |
| `src/shared/club-analytics/delta.ts` | Δ к прошлому периоду |
| `src/shared/analytics-catalog.ts` | Ключи финансовых карточек, дашборды и плитки клуба, сведение сохранённых настроек с каталогом |
| `src/shared/schemas/club-analytics.ts` | Zod: запрос отчёта клуба, тела настроек |
| `src/templates/types.ts`, `computer-club.ts` | `BusinessTemplate.analytics` вместо `metrics` |
| `src/server/modules/senet/store.ts`, `sync.ts` | `markSpan` после каждого принятого отчёта |
| `src/server/modules/club-analytics/scope.ts` | Клубы компании: проекты-клубы, клубы Senet, ПК, свежесть |
| `src/server/modules/club-analytics/settings.ts` | `analytics_settings`: чтение с умолчаниями, запись с историей |
| `src/server/modules/club-analytics/revenue.ts` | «Выручка клуба»: таблица, разрезы, сходимость, строки ячейки, xlsx |
| `src/server/modules/club-analytics/overview.ts` | «Обзор клуба»: плитки, ряд по дням, лучшие и худшие дни |
| `src/server/modules/club-analytics/routes.ts` | Маршруты `club-analytics/*` и `analytics-settings` |
| `src/client/lib/club-analytics.ts`, `club-url.ts` | Запросы и состояние адреса отчётов клуба |
| `src/client/pages/club/*` | `ClubReportScreen`, `ClubRevenuePage`, `ClubOverviewPage` |
| `src/client/pages/settings/AnalyticsSettings.tsx` | «Настройки → Аналитика» |
| `scripts/lib/senet-club-demo.ts` | Синтетические данные клуба за 60 дней для e2e и снимков |

---

### Task 1: Покрытие данных Senet

**Files:**
- Create: `src/shared/club-analytics/coverage.ts`, `tests/shared/club-coverage.test.ts`, `tests/server/schema-0015.test.ts`
- Modify:
  - `src/server/db/schema-sqlite.ts` (после `senetLoad`), `schema.ts`, `schema-pg.ts`;
  - миграции `0015_senet_data_spans` / pg `0005_senet_data_spans`;
  - `src/server/modules/senet/store.ts`, `src/server/modules/senet/sync.ts`;
  - `tests/server/senet-sync.test.ts`;
  - спецификация, раздел «## 16. Решения планирования плана АК-1» (новый, в конце).

**Interfaces:**
- Produces:
  - `type Span = { from: string; to: string }` — ISO, `to` не входит;
  - `mergeSpans(spans: readonly Span[]): Span[]`;
  - `type DayCoverage = 'full' | 'partial' | 'none'`;
  - `dayCoverage(spans: readonly Span[], days: readonly string[], timeZone: string): DayCoverage[]`;
  - `combineCoverage(lists: readonly DayCoverage[][]): DayCoverage[]` — поэлементный минимум `none < partial < full`;
  - таблица `senetDataSpans`: `id`, `officeId`, `report` (`ReportKind`), `fromAt`, `toAt`; индекс `(office_id, report, from_at)`;
  - `markSpan(tx: Executor, officeId: number, report: ReportKind, from: string, to: string): Promise<void>` в `store.ts`;
  - `loadSpans(ex: Executor, officeIds: readonly number[], reports: readonly ReportKind[], from: string, to: string): Promise<Map<ReportKind, Span[]>>` в `store.ts` — отрезки, пересекающие `[from, to)`, слитые по всем клубам; на «Все клубы» день полный, только если полон у каждого клуба (Ruling R1).

- [ ] **Step 1: Записать решения R1–R4 в §16 спецификации.** Дословно, по строке на решение:
  - **R1.** Вместо `senet_data_days` (§3.2) — `senet_data_spans`: отрезки забора `[from_at, to_at)` по отчёту и клубу, слитые при записи. Часовой забор берёт окна `[t − 26 ч, t)`, не выровненные по полуночи, поэтому «отрезок отметил свои сутки» неверно. День полный, если объединение отрезков покрывает его локальные сутки; частичный — если покрывает часть (так выглядит текущий день). На «Все клубы» день полный, только если он полон у каждого клуба.
  - **R2.** Заполнение задним числом — по `senet_raw` (`from_date`, `to_date`, `report`). Отчёты, которые повторили уже сохранённый файл (тот же `sha256`), в `senet_raw` не попали, поэтому старые дни могут оказаться «нет данных». Лечится «Загрузить за период».
  - **R3.** Плитки шаблона в настройках — ключ `tiles.<шаблон>` вместо `club.tiles` (§10.3): у каждого будущего шаблона свои.
  - **R4.** Факты октябрьских файлов (локально, 14–31.10):
    - Касса продаёт чеки времени и товары бара: почти каждая продажа `cashdesk_transactions` совпадает по секунде и сумме с чеком и строкой `sold_check_items`.
    - Строки `sold_check_items` без количества — это чеки времени, `item` = код чека.
    - Пополнения типа `Check` совпадают по секунде с продажей чека — это зачисление купленного чека, а не новые деньги.
    - Списаний за часы (`office_load_by_zones`) за октябрь локально нет; правило выручки проверяет задача 6 на живых данных.

- [ ] **Step 2: Тесты `tests/shared/club-coverage.test.ts`.** Зона `Asia/Almaty` (UTC+5):
  - `mergeSpans` сливает пересекающиеся и смежные отрезки и сортирует их: `[[10,12],[11,13],[13,14],[16,17]]` (часы) → `[[10,14],[16,17]]`.
  - `dayCoverage`, отрезки — окна часового забора `[t−26ч, t)` для t = каждый час 02.11 00:00…03.11 12:00 местного:
    - 01.11 → `full`;
    - 02.11 → `full`;
    - 03.11 → `partial`;
    - 04.11 → `none`.
  - Граница суток — по местному времени: отрезок `2026-11-01T19:00Z…2026-11-02T19:00Z` даёт 02.11 → `full`, 01.11 → `none`.
  - `combineCoverage([['full','full','none'],['full','partial','full']])` → `['full','partial','none']`.

- [ ] **Step 3: Тест миграции `tests/server/schema-0015.test.ts`** по образцу `schema-0014.test.ts`. Колонки `senet_data_spans`: `['id','office_id','report','from_at','to_at']`. Есть индекс `senet_data_spans_office_report_idx`.
  - **Заполнение задним числом.** Миграция вставляет в отрезки строки `senet_raw` с `office_id`. Тест: две строки `senet_raw` до миграции 0015 — `runMigrations` до 0014, вставка, затем до конца → два отрезка с теми же `from_date` и `to_date`.

- [ ] **Step 4: Тест забора в `tests/server/senet-sync.test.ts`:** «забор отмечает отрезки принятых отчётов».
  - После POST sync с `from=2026-10-01T00:00Z`, `to=2026-10-03T00:00Z` у клуба отрезки `[from,to)` для `sessions`, `cashMoves`, `transactions`, `soldItems`, `checks`, `refills`, `stock`, `goodsMoves`, `load`.
  - Отчёт с незнакомым форматом (поддельный Senet отдаёт для `refill` xlsx с чужими заголовками) отрезка не получает.
  - Повторный забор того же окна не плодит строки: в базе по одному отрезку на отчёт.

- [ ] **Step 5: Запустить тесты, убедиться, что они падают.** `npx vitest run tests/shared/club-coverage.test.ts tests/server/schema-0015.test.ts tests/server/senet-sync.test.ts` → FAIL: нет модуля, таблицы и `markSpan`.

- [ ] **Step 6: Реализовать.**
  - **`coverage.ts`.** Сутки дня — `[startOfDayUtc(day, tz), startOfDayUtc(addDays(day, 1), tz))` из `shared/dates.ts`, а не своё смещение.
  - **Таблица и миграции.** Заполнение задним числом — SQL в файле миграции после `CREATE TABLE`: `INSERT INTO senet_data_spans (office_id, report, from_at, to_at) SELECT office_id, report, from_date, to_date FROM senet_raw WHERE office_id IS NOT NULL`. Слияние отрезков при чтении (`loadSpans` → `mergeSpans`) делает лишние строки безвредными.
  - **`markSpan`.** Выбрать отрезки клуба и отчёта, пересекающие или смежные с `[from,to)`, удалить их и вставить один слитый.
  - **Где вызывать `markSpan` в `sync.ts`** — в той же транзакции, что и запись строк:
    - `sessions`, `cashMoves`, `transactions` — в `withTx` с `writeOfficeBatch`; `cashMoves` — с `movesFrom`;
    - суточные отчёты — в `withTx` с `writeAnalyticsDay`, только для отчётов, где `fetch` вернул не `null`.

- [ ] **Step 7: Запустить тесты, убедиться, что они проходят.** Команда шага 5 → PASS в `unit`, `server-sqlite`, `server-pg`.

- [ ] **Step 8: Коммит**

```bash
git add src/shared/club-analytics/coverage.ts src/server/db src/server/modules/senet/store.ts src/server/modules/senet/sync.ts tests/shared/club-coverage.test.ts tests/server/schema-0015.test.ts tests/server/senet-sync.test.ts docs/superpowers/specs/2026-11-03-club-analytics-design.md
git commit -m "feat(club): покрытие данных Senet отрезками забора"
```

### Task 2: Каталог дашбордов и настройки аналитики (сервер)

**Files:**
- Create:
  - `src/shared/analytics-catalog.ts`, `src/shared/schemas/club-analytics.ts`;
  - `src/server/modules/club-analytics/settings.ts`, `src/server/modules/club-analytics/routes.ts`;
  - `tests/shared/analytics-catalog.test.ts`, `tests/server/analytics-settings.test.ts`;
  - миграции `0016_analytics_settings` / pg `0006_analytics_settings`.
- Modify:
  - `src/templates/types.ts`, `src/templates/computer-club.ts`, `src/templates/general.ts`;
  - `src/server/db/schema*.ts`, `src/server/app.ts`;
  - `src/client/lib/audit-format.ts`.

**Interfaces:**
- Produces (в `analytics-catalog.ts`):
  - `type ClubReportKey = 'overview' | 'revenue' | 'load' | 'guests' | 'bar'`;
  - `interface DashboardDef { key: string; title: string; description: string; help: string; path: string }`. `path` — хвост после `/c/:id/analytics/`, например `club/revenue`;
  - `interface TileDef { key: string; label: string; unit: 'money' | 'percent' | 'number' | 'duration'; byDefault: boolean; report: ClubReportKey | 'journal' }`;
  - `FINANCE_CARD_KEYS = ['cashflow','pnl','statement','projects','indicators','history'] as const`;
  - `CLUB_DASHBOARDS: DashboardDef[]` — ключи `overview`, `revenue`, пути `club`, `club/revenue`; тексты — из таблицы §2.1. «Загрузку», «Гостей» и «Бар» добавят планы АК-2…АК-4;
  - `CLUB_TILES: TileDef[]` — 14 плиток, ключи по порядку:
    - `revenue`, `load`, `guests`, `newGuests`, `revenuePerGuest`, `revenuePerPcDay`, `barShare`, `barMargin` — `byDefault: true`;
    - `refills`, `visitDuration`, `visitsPerGuest`, `returningShare`, `payrollToRevenue`, `rentToRevenue` — `byDefault: false`.
    
    Подписи — из §4.
  - `BUILT_CLUB_REPORTS: ReadonlySet<ClubReportKey | 'journal'> = new Set(['overview', 'revenue', 'journal'])`. Плитка, чей отчёт не построен, недоступна с пометкой `Появится с отчётом «Загрузка»` («Гости», «Бар») — `TILE_SOON: Record<'load'|'guests'|'bar', string>`;
  - `TILES_MAX = 12`;
  - `interface SavedDashboards { groups: { key: string; visible: boolean; cards: { key: string; visible: boolean }[] }[] }`;
  - `interface SavedTiles { items: { key: string; visible: boolean }[] }`;
  - `resolveDashboards(saved: SavedDashboards | null, available: readonly { key: string; cards: readonly string[] }[]): SavedDashboards` — неизвестные группы и карточки отбрасываются; новые добавляются в конец видимыми; порядок сохранённого сохраняется;
  - `resolveTiles(saved: SavedTiles | null, catalog: readonly TileDef[]): SavedTiles` — то же; без сохранённого — каталог по порядку, `visible = byDefault`.
- Produces (шаблоны): `BusinessTemplate.analytics?: { dashboards: readonly DashboardDef[]; tiles: readonly TileDef[] }`. Поле `metrics` и тип `MetricDef` удаляются. У `computerClub` — `analytics: { dashboards: CLUB_DASHBOARDS, tiles: CLUB_TILES }`, у `general` — нет.
- Produces (сервер):
  - `createAnalyticsSettings(d: { db: Db; audit: AuditService; now: () => Date })`.
  - `get(companyId): Promise<AnalyticsSettingsView>`:
    ```ts
    {
      dashboards: SavedDashboards;
      groups: { key: string; title: string }[];          // 'finance' → «Финансы»; ключ шаблона → его name
      tiles: Record<string, SavedTiles>;                 // по ключу шаблона
      catalog: Record<string, { dashboards: DashboardDef[]; tiles: TileDef[] }>;
    }
    ```
    - Группы: `finance` и по одной на каждый шаблон с `analytics`, у которого в компании есть неархивный проект.
    - Сохранённая группа шаблона без проектов отбрасывается.
  - `put(companyId, key: 'dashboards' | `tiles.${string}`, value: unknown, userId): Promise<AnalyticsSettingsView>`:
    - тело проверяется Zod-схемами `savedDashboardsSchema` и `savedTilesSchema`;
    - больше `TILES_MAX` видимых плиток → 400 `VALIDATION`, поле `items`, текст «Не больше 12 плиток»;
    - запись в истории: entity `analytics_settings`, action `update`, diff `{ key, before, after }`; та же настройка — без записи (как `savePart` §17.9);
    - `DELETE …/:key` — «Вернуть как было», с записью истории action `delete`.
  - Маршруты:
    - `GET /api/v1/companies/:cid/analytics-settings`;
    - `PUT /api/v1/companies/:cid/analytics-settings/:key`;
    - `DELETE /api/v1/companies/:cid/analytics-settings/:key`.
  - Таблица `analytics_settings`: `company_id`, `key`, `value` (text JSON), `updated_at`, `updated_by`; первичный ключ `(company_id, key)`.

- [ ] **Step 1: Тесты `tests/shared/analytics-catalog.test.ts`:**
  - `resolveDashboards(null, [{key:'finance',cards:['cashflow','pnl']},{key:'computer-club',cards:['overview','revenue']}])` → всё видимо, порядок как в `available`;
  - сохранённое `[{key:'computer-club',visible:false,cards:[{key:'revenue',visible:true},{key:'gone',visible:true}]}]` → `gone` отброшена, `overview` добавлена в конец видимой, группа `finance` добавлена в конец;
  - `resolveTiles(null, CLUB_TILES).items.filter(i=>i.visible).map(i=>i.key)` → восемь ключей `byDefault`;
  - `CLUB_TILES.length === 14`, ключи уникальны.

- [ ] **Step 2: Тесты `tests/server/analytics-settings.test.ts`** (`opsWorld`; проект «Компьютерный клуб» создаётся `POST …/projects { name: 'Клуб 1', templateKey: 'computer-club', templateParams: { pcCount: 40 } }`):
  - без проекта-клуба GET → `groups` = `[{key:'finance',title:'Финансы'}]`;
  - с проектом → вторая группа `{key:'computer-club',title:'Компьютерный клуб'}`, `tiles['computer-club']` — умолчания;
  - PUT `dashboards` прячет карточку `revenue` → GET её возвращает с `visible:false`; в `/audit` запись `analytics_settings`;
  - PUT `tiles.computer-club` с 13 видимыми → 400, `fields.items` = «Не больше 12 плиток»;
  - повтор того же PUT — новой записи истории нет;
  - DELETE `tiles.computer-club` → умолчания;
  - архивная компания: PUT → 403, GET → 200.

- [ ] **Step 3: Запустить тесты, убедиться, что они падают.** Нет модулей → FAIL.

- [ ] **Step 4: Реализовать.**
  - **История действий.** В `audit-format.ts`: `analytics_settings: 'Настройки аналитики'` в подписях и в списке сущностей компании. Строка diff: поле «Настройка», значение `key`.
  - **Подключить маршруты** в `app.ts` рядом с `registerAnalyticsRoutes`.
  - **Шаблоны.** У «Компьютерного клуба» убрать `metrics`. Тест `tests/shared/templates.test.ts` (строки 50 и 62 проверяют `metrics`) переписать на `analytics`: у клуба `tiles.length === 14` и `dashboards` — `overview`, `revenue`; у «Общего» `analytics` нет.

- [ ] **Step 5: Запустить тесты, убедиться, что они проходят.** Те же файлы плюс `npx vitest run tests/server/templates*` → PASS на обоих диалектах; `npm run typecheck` → без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add src/shared/analytics-catalog.ts src/shared/schemas/club-analytics.ts src/templates src/server/modules/club-analytics src/server/db src/server/app.ts src/client/lib/audit-format.ts tests
git commit -m "feat(club): дашборды шаблона и настройки аналитики компании"
```

### Task 3: «Настройки → Аналитика»

**Files:**
- Create:
  - `src/client/pages/settings/AnalyticsSettings.tsx`;
  - `src/client/lib/analytics-settings.ts`;
  - `tests/client/analytics-settings.test.ts`.
- Modify:
  - `src/client/lib/settings-sections.ts` — пункт `{ path: 'analytics', label: 'Аналитика' }` в группе `view` после «Настроек журнала»;
  - `src/client/router.tsx`.

**Interfaces:**
- Consumes: ответ `GET analytics-settings` (задача 2), `FINANCE_CARD_KEYS`, `ANALYTICS_CARDS` (`src/client/lib/analytics.ts`) — подписи финансовых карточек.
- Produces:
  - `useAnalyticsSettings(companyId)`;
  - `saveAnalyticsSetting(companyId, key, value)`;
  - `resetAnalyticsSetting(companyId, key)` — сброс ключа `['analytics-settings', cid]` и `['analytics', cid]`;
  - чистые функции:
    - `moveCard(d: SavedDashboards, group: string, card: string, dir: -1 | 1): SavedDashboards`;
    - `toggleCard(d, group, card): SavedDashboards`;
    - `toggleGroup(d, group): SavedDashboards`;
    - `moveTile(t: SavedTiles, key, dir): SavedTiles`;
    - `toggleTile(t, key): SavedTiles`;
    - `visibleTileCount(t): number`.

- [ ] **Step 1: Тесты `tests/client/analytics-settings.test.ts`:**
  - `moveCard` первой карточки вверх — без изменений; последней вниз — без изменений; средней вверх — меняется местами с соседом;
  - `toggleGroup` не трогает карточки;
  - `toggleTile` при 12 видимых и невидимой плитке возвращает тот же объект (кнопка недоступна);
  - `visibleTileCount` считает только видимые.

- [ ] **Step 2: Запустить тест, убедиться, что он падает.** `npx vitest run tests/client/analytics-settings.test.ts` → FAIL.

- [ ] **Step 3: Реализовать страницу** по §10.1–10.2.
  - **Блок «Дашборды»:**
    - у группы — переключатель «Показывать»;
    - у карточки — переключатель «Показывать», кнопки «Выше» и «Ниже» с `aria-label` «Выше: {карточка}» и «Ниже: {карточка}»;
    - кнопка «Вернуть как было».
  - **Блок «Плитки «Обзора»»** — для каждого шаблона из `tiles`:
    - переключатели и стрелки, счётчик «{n} из 12»;
    - недоступная плитка — с пометкой из `TILE_SOON`, переключатель работает;
    - на компьютере справа предпросмотр — серые плитки с подписями в выбранном порядке.
  - **Сохранение** — сразу по изменению: `PUT`, оптимистично, при ошибке откат и сообщение.
  - **Перетаскивание** — не в этом плане, хватает стрелок (Ruling R5; в §16).
  - **Архивная компания** — только чтение: кнопки `aria-disabled`, как у других разделов настроек.

- [ ] **Step 4: Запустить тест, убедиться, что он проходит.** Тест шага 1 → PASS; `npm run typecheck`.

- [ ] **Step 5: Коммит.** В §16 спецификации — R5: «Перетаскивание карточек и плиток (§10.1) отложено: порядок меняют стрелки, на телефоне и с клавиатуры они удобнее».

```bash
git add src/client tests/client/analytics-settings.test.ts docs/superpowers/specs/2026-11-03-club-analytics-design.md
git commit -m "feat(club): раздел «Настройки → Аналитика»"
```

### Task 4: Группа «Компьютерный клуб» на главной «Аналитики»

**Files:**
- Create: `src/server/modules/club-analytics/scope.ts`, `tests/server/club-scope.test.ts`, `tests/client/analytics-cards.test.ts`
- Modify: `src/client/pages/AnalyticsPage.tsx`, `src/client/lib/analytics.ts`, `src/client/router.tsx`, `src/server/modules/club-analytics/routes.ts`

**Interfaces:**
- Produces (сервер):
  - `clubScope(db: Db, companyId: number, projectId?: number): Promise<ClubScope>`, где
    ```ts
    ClubScope = {
      projects: { id: number; name: string; archived: boolean; pcCount: number | null }[];  // шаблон computer-club
      offices: { id: number; projectId: number; connectionId: number; lastSyncAt: string | null }[];  // клубы Senet с project_id из projects
      connected: boolean;          // у компании есть неархивное подключение Senet
      freshness: string | null;    // минимальный lastSyncAt подключений offices
    }
    ```
    - `projectId` не из `projects` → 404 `NOT_FOUND`, «Клуб не найден».
    - `pcCount` — из `template_params`.
  - `GET /api/v1/companies/:cid/club-analytics/scope` → `ClubScope` без `offices`, но с `hasOffices: boolean`.
- Produces (клиент):
  - `analyticsGroups(settings: AnalyticsSettingsView, scope: ClubScopeView | null): CardGroup[]`, где
    ```ts
    CardGroup = { key: string; title: string | null; cards: AnalyticsCard[] }
    ```
    - У финансовой группы `title = null`.
    - Скрытые группы и карточки не входят.
    - **Карточки клуба серые** (`href: null`) с подписью:
      - «Подключите Senet в «Интеграциях»» — если `!scope.connected`;
      - «Привяжите клуб Senet к проекту в «Интеграциях»» — если подключение есть, а `hasOffices` нет.
- Consumes: `CLUB_DASHBOARDS`, `useAnalyticsSettings`.

- [ ] **Step 1: Тест `tests/server/club-scope.test.ts`:**
  - проект «Общий» в `projects` не входит;
  - проект-клуб с `pcCount: 40` → `pcCount: 40`, без параметра → `null`;
  - клуб Senet без проекта в `offices` не входит;
  - выключенный клуб с проектом входит;
  - `freshness` — минимальный `lastSyncAt` двух подключений;
  - чужой `projectId` → 404.

- [ ] **Step 2: Тест `tests/client/analytics-cards.test.ts`:**
  - без группы клуба — только финансовые карточки в порядке `ANALYTICS_CARDS`;
  - спрятанная `pnl` не входит;
  - группа клуба с `connected:false` — карточки с `href: null` и подписью Senet;
  - порядок карточек клуба — из настроек.

- [ ] **Step 3: Запустить тесты, убедиться, что они падают.**

- [ ] **Step 4: Реализовать.**
  - `AnalyticsPage` рисует группы по порядку. У группы клуба `<h2>` — название шаблона. Сетка та же.
  - Маршруты `analytics/club` и `analytics/club/revenue` — страницы задач 8–9. До них — `<Navigate to=".." />`, чтобы ссылка не вела в пустоту.

- [ ] **Step 5: Запустить тесты, убедиться, что они проходят.** Тесты шагов 1–2 → PASS на обоих диалектах; `npm run typecheck`.

- [ ] **Step 6: Коммит**

```bash
git add src tests
git commit -m "feat(club): группа «Компьютерный клуб» на главной «Аналитики»"
```

### Task 5: «Выручка клуба» — расчёт и API

**Files:**
- Create:
  - `src/shared/club-analytics/hours.ts`, `columns.ts`, `revenue.ts`;
  - `src/server/modules/club-analytics/revenue.ts`;
  - `tests/shared/club-hours.test.ts`, `tests/shared/club-revenue.test.ts`, `tests/server/club-revenue.test.ts`.
- Modify: `src/shared/schemas/club-analytics.ts`, `src/server/modules/club-analytics/routes.ts`.

**Interfaces:**
- Consumes: `clubScope` (задача 4); `loadSpans`, `dayCoverage`, `combineCoverage` (задача 1); `reportColumns`, `REPORT_MAX_COLUMNS` из `report-engine`.
- Produces (shared):
  - `splitByHour(startAt: string, endAt: string, timeZone: string): { day: string; hour: number; weekday: number; seconds: number }[]` — только `endAt > startAt`;
  - `periodDays(from: string, to: string): string[]` — даты включительно;
  - `previousRange(from: string, to: string): { from: string; to: string }` — та же длина, сразу перед текущим;
  - `sumColumns(byDay: readonly number[], days: readonly string[], columns: readonly ReportColumn[], cov: readonly DayCoverage[]): { values: (number | null)[]; withData: number[]; total: number[] }` — `null`, если в колонке нет дня с данными (`full` или `partial`);
  - `type RevenuePart = 'hours' | 'bar' | 'revenue' | 'refills' | 'desk' | 'diff'`;
  - `revenueByDay(i: RevenueInput, days: readonly string[], timeZone: string): Record<RevenuePart, number[]>`, где
    ```ts
    RevenueInput = {
      load: { startAt: string; endAt: string | null; debited: number }[];
      sold: { at: string; qty: number | null; amount: number; refund: boolean }[];
      refills: { at: string; amount: number; accountType: string }[];
      transactions: { at: string; kind: 'sell' | 'refund'; amount: number; payment: string }[];
    }
    ```
    - `hours` — `debited` в день начала сеанса;
    - `bar` — продажи с `qty` минус возвраты;
    - `revenue` = `hours + bar`;
    - `refills` — Σ пополнений типа `General` (R4: `Check` — зачисление чека, не деньги);
    - `desk` — Σ `sell` − Σ `refund`;
    - `diff` = `desk − revenue`;
  - `deskByPayment(tx, days, tz): Map<string, number[]>` — ключ — значение `payment` как есть;
  - `revenueHeatmap(i: RevenueInput, days, cov, timeZone): (number | null)[][]` — 7 × 24:
    - средняя выручка часа по дням недели с покрытием `full`;
    - `debited` сеанса раскладывается по `splitByHour` пропорционально секундам;
    - продажа бара — в свой час;
    - `null`, если дней этого дня недели с данными нет.
- Produces (API): `GET /api/v1/companies/:cid/club-analytics/revenue`.
  - Запрос — `clubQuerySchema`:
    ```ts
    { from, to, step = 'month', by: 'parts' | 'payment' | 'shifts' | 'cashiers' = 'parts', view: 'table' | 'hours' = 'table', project?: number, compare: boolean = true }
    ```
    Проверка периода — как `checkPeriod` в `schemas/analytics.ts`.
  - Ответ:
    ```ts
    {
      columns: ReportColumn[];
      rows: { id: string; label: string; kind: 'part' | 'info' | 'payment' | 'shift' | 'cashier'; values: (number | null)[]; total: number | null; prevTotal: number | null }[];
      heatmap?: (number | null)[][];
      coverage: { days: number; withData: number; partial: number; missingDays: string[]; columns: { withData: number; total: number }[] };
      prevCoverage: { days: number; withData: number } | null;
      reconcile: { shifts: number; desk: number; revenue: number; diffShifts: { id: number; openedAt: string; diff: number }[] };
      freshness: string | null;
      meta: { from: string; to: string; step: ReportStep; by: string; empty: boolean };
    }
    ```
    - Строки `by=parts` — id `hours`, `bar`, `revenue`, `refills`, `desk`, `diff`. Подписи:
      - «Часы»;
      - «Бар»;
      - «Выручка»;
      - «Справочно: пополнения балансов»;
      - «Справочно: деньги в кассу»;
      - «Справочно: разница».
    - Покрытие: `hours` — по `load`; `bar` — по `soldItems`; `desk` — по `transactions`; весь отчёт — `combineCoverage` трёх.
  - `GET …/revenue/rows?…&row=<id>&col=<key>&cursor=` — строки Senet ячейки, страницы по 50: `{ items: { at: string; kind: 'session' | 'sale' | 'refill' | 'transaction'; label: string; amount: number; workstation: number | null; guest: string; phoneMask: string | null }[]; nextCursor: string | null }`.
  - `GET …/revenue.xlsx` — таблица, как на экране. Писатель `src/server/http/xlsx.ts`, имя файла «{Компания} - Выручка клуба - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx».

- [ ] **Step 1: Тесты `tests/shared/club-hours.test.ts`:**
  - сеанс 01.11 23:30 — 02.11 01:15 местного → `[{day:'2026-11-01',hour:23,seconds:1800},{day:'2026-11-02',hour:0,seconds:3600},{day:'2026-11-02',hour:1,seconds:900}]`;
  - `weekday` 02.11.2026 (понедельник) = 0;
  - `endAt <= startAt` → `[]`.

- [ ] **Step 2: Тесты `tests/shared/club-revenue.test.ts`:**
  - `revenueByDay`: сеанс 01.11 23:30–02.11 01:00 с `debited 1000` → `hours` 01.11 = 1000 (день начала);
  - товар `qty 1000, amount 500` плюс возврат товара `amount 200` → `bar` 300;
  - чек времени (`qty null`) в `bar` не входит;
  - пополнение `Check` в `refills` не входит, `General` входит;
  - `desk` = `sell − refund`;
  - `diff` = `desk − revenue`;
  - `sumColumns`: месяц с днями `none, full, partial` → значение — сумма двух дней с данными, `withData` 2, `total` 3; колонка из одних `none` → `null`;
  - `previousRange('2026-11-01','2026-11-30')` → `{from:'2026-10-02',to:'2026-10-31'}`;
  - `revenueHeatmap`: сеанс 20:00–21:30 с `debited 900` → Пн 20 ч — 600, Пн 21 ч — 300 (один понедельник с данными); вторник без данных — `null`.

- [ ] **Step 3: Тесты `tests/server/club-revenue.test.ts`.**
  - **Подготовка.** Поддельный Senet с `ownAnalytics: true` отдаёт по окну запроса, как `senet-analytics-data.test.ts`. Данные — две смены 01.11 и ночная 01.11 22:01 — 02.11 10:00, сеансы, продажи, пополнения и транзакции. Проект-клуб с `pcCount 10`. Забор `from=2026-11-01T00:00+05`, `to=2026-11-03T00:00+05`.
  - **`by=parts`, период 01.11–02.11, `step=day`:**
    - строки по порядку `hours, bar, revenue, refills, desk, diff`;
    - значения дней совпадают с расчётом вручную;
    - `coverage.withData` = 2;
    - `reconcile.diffShifts` = `[]`, если транзакции смен равны их выручке.
  - **Транзакция ночной смены на 50 ₸ больше** её `revenue` → `reconcile.diffShifts` = `[{ id, diff: 5000 }]`.
  - **Период 01.11–05.11** → `missingDays` = `['2026-11-03','2026-11-04','2026-11-05']`; колонки этих дней `null`.
  - **«Все клубы» и один клуб.** Второй клуб Senet без проекта не влияет на суммы. Выключенный клуб с проектом влияет (Review Focus 2).
  - **`compare`.** `prevTotal` строки `revenue` за 26.10–31.10 без данных = `null`; `prevCoverage.withData` = 0.
  - **`by=payment`** — строки по `payment`; в `rows` нет строк `hours`, `bar`, `revenue`.
  - **`by=shifts`:**
    - строка на смену с id `shift:<id>`, подпись `01.11 10:00 — 22:00 · Сотрудник А`;
    - колонки этого разреза — `revenue`, `bar`, `desk`, `refills`, `outs`, `cashAfter` (ответ `columns` с этими ключами);
    - шаг не действует.
  - **`by=cashiers`** — одна строка «Сотрудник А» с числом смен 3.
  - **`view=hours`** — `heatmap` 7×24.
  - **`rows?row=hours&col=2026-11-01`** — сеансы дня; в JSON ответа нет подстроки значения `phone_hash` ни одной строки (Global Constraints).
  - **`revenue.xlsx`** — 200, тип `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, в файле нет хеша.
  - **Ошибки:** `project` чужой → 404; `step=day` на 2 года → 400 «Слишком много колонок — выберите больший шаг».

- [ ] **Step 4: Запустить тесты, убедиться, что они падают.**

- [ ] **Step 5: Реализовать.**
  - **Выборка.** Строки клубов `scope.offices` выбираются за `[начало from, конец to)` в UTC; для `compare` — ещё и за прошлый период. Остальное — в чистых функциях.
  - **Сходимость.** Смены клубов, открытые в периоде и закрытые: Σ `revenue` против Σ транзакций `at ∈ [openedAt, closedAt]`. Разница больше 100 тиынов (1 ₸) попадает в `diffShifts`.
  - **Разрез `shifts`:**
    - `outs` — Σ выемок смены (`senet_cash_moves.kind = 'out'`);
    - `cashAfter` — `endBalance` смены;
    - журнал не нужен: ссылка ведёт в «Сверку».

- [ ] **Step 6: Запустить тесты, убедиться, что они проходят.** Три файла → PASS в `unit`, `server-sqlite`, `server-pg`.

- [ ] **Step 7: Коммит**

```bash
git add src/shared src/server/modules/club-analytics tests
git commit -m "feat(club): «Выручка клуба» — части, разрезы, карта часов, сходимость со сменами"
```

### Task 6: Проверка правила выручки на живых данных (ворота)

Без кода, если правило подтвердилось. Выполняется после деплоя задачи 5 (пуш в `stage1/plan1-skeleton` — Vercel собирает сам; дождаться `READY`).

**Files:**
- Modify: спецификация, §16 — решение R6 с итогом.

- [ ] **Step 1: Собрать цифры.** В браузере владельца (вкладка Chrome с его сессией, только `GET`) — `GET /api/v1/companies/1/club-analytics/revenue?from=2026-11-01&to=<вчера>&step=day&by=parts&compare=0` и тот же запрос с `by=shifts`.
  - Записать в `.superpowers/senet-local/ak1-check.md` (не в git): суммы строк и `reconcile`.
  - Логины и маски не выписывать.

- [ ] **Step 2: Сверить с ожидаемым.**
  - **(а)** `reconcile.diffShifts` пуст — деньги в кассу сходятся со «Сверкой».
  - **(б)** За любые 7 полных дней «Часы» ≈ «деньги в кассу» − «Бар» + «пополнения балансов» с точностью ±10 %. Потраченное на время берётся из купленных чеков и пополнений, остатки балансов за неделю малы. Сильное расхождение означает, что источник «Часов» или пополнений понят неверно.
  - **(в)** Нет двойного счёта бара. На 20 продажах бара из `…/revenue/rows?row=bar` нет сеанса того же гостя (`…/rows?row=hours` того дня) со списанием, равным цене товара, в ту же минуту. Если такой сеанс есть, товары оплачиваются с баланса и уже сидят в «Часах».

- [ ] **Step 3: Записать итог.** В §16 спецификации — `R6. Проверка правила выручки на данных 01.11–<дата>: (а) … (б) … (в) …; правило подтверждено / изменено так: …`.
  - **Если правило не подтвердилось** — поправить `revenueByDay` и тест задачи 5 под новое правило в отдельном коммите: тест первым, потом код.
  - **Если причина неясна** — остановиться и спросить владельца.

- [ ] **Step 4: Коммит**

```bash
git add docs/superpowers/specs/2026-11-03-club-analytics-design.md
git commit -m "docs: «Аналитика клуба» — проверка правила выручки на данных клуба"
```

### Task 7: Каркас страницы отчёта клуба

**Files:**
- Create:
  - `src/shared/club-analytics/delta.ts`;
  - `src/client/lib/club-url.ts`, `src/client/lib/club-analytics.ts`;
  - `src/client/pages/club/ClubReportScreen.tsx`;
  - `src/client/components/club/CoverageBanner.tsx`;
  - `tests/shared/club-delta.test.ts`, `tests/client/club-url.test.ts`.

**Interfaces:**
- Consumes:
  - `PeriodMenu`, `ChoiceMenu`, `ChangedMark`, `ReportHeader`, `RefreshButton`, `ExcelLink`, `ViewSwitch`;
  - `reportRange`, `stepChoices`, `effectiveStep`, `REPORT_PERIODS`, `customRangeError`, `STEP_LABELS` из `report-url.ts`;
  - `GET …/club-analytics/scope`.
- Produces:
  - `delta(cur: number | null, prev: number | null, kind: 'sum' | 'avg' | 'share', approx: boolean): { text: string; tone: 'up' | 'down' | 'flat' } | null`:
    - `null`, если `prev` — `null` или 0 при `kind !== 'share'`;
    - `sum` и `avg` — «+12 %» и «−5 %», округление до целого;
    - `share` — «+3 п. п.»;
    - `approx && kind === 'sum'` → префикс «≈ »;
  - `ClubUrlState = { view: 'chart' | 'table' | 'hours'; period: ReportPeriod; from?: string; to?: string; step: ReportStep; by: string; project: number | null; compare: boolean }`;
  - `parseClubSearch(p: URLSearchParams, byChoices: readonly string[]): ClubUrlState`;
  - `clubSearch(s): URLSearchParams` — только отличия от умолчаний: `view=chart`, `period=year`, `step=month`, первый `by`, `project=null`, `compare=true`;
  - `clubApiParams(s, today): URLSearchParams` — `from`, `to`, действующий шаг, `by`, `view` (`hours` — как есть, иначе `table`), `project`, `compare=0|1`;
  - `ClubReportScreen` — props:
    ```ts
    {
      company: Company;
      title: string;
      subtitle: string;
      help: string;
      report: 'overview' | 'revenue';
      byChoices?: Choice<string>[];
      views: ('chart' | 'table' | 'hours')[];
      children: (ctx: {
        state: ClubUrlState;
        apiParams: string | null;
        update(s: ClubUrlState): void;
        timeZone: string;
        today: string;
      }) => ReactNode;
    }
    ```
    Рисует заголовок, панель контролов в порядке §2.2, подпись свежести «Данные Senet на ДД.ММ ЧЧ:ММ», «Сбросить» и окно «Фильтры» на телефоне — как `ReportScreen`.
  - `CoverageBanner({ coverage, companyId })` — полоса §3.3: «За N дней периода нет данных Senet — суммы неполные. Загрузить: Настройки → Интеграции → «Загрузить за период»». Ссылка на `/c/:id/settings/integrations`. При `withData === 0` — пустое состояние с той же ссылкой.

- [ ] **Step 1: Тесты `tests/shared/club-delta.test.ts`:**
  - `delta(112, 100, 'sum', false)` → `{text:'+12 %',tone:'up'}`;
  - `delta(95, 100, 'avg', false)` → `{text:'−5 %',tone:'down'}` (минус — U+2212);
  - `delta(0.43, 0.40, 'share', false)` → `{text:'+3 п. п.',tone:'up'}`;
  - `delta(112, 100, 'sum', true).text` → `'≈ +12 %'`;
  - `delta(5, null, 'sum', false)` → `null`;
  - `delta(5, 0, 'sum', false)` → `null`.

- [ ] **Step 2: Тесты `tests/client/club-url.test.ts`:**
  - пустой адрес → умолчания;
  - `clubSearch(умолчания).toString()` → `''`;
  - `project=abc` → `null`;
  - `by=unknown` → первый `byChoices`;
  - `clubApiParams` при `period=year` и `step=day` даёт действующий шаг `week` (больше 92 колонок);
  - `view=hours` → `view=hours`;
  - `compare=0` при `compare:false`.

- [ ] **Step 3: Запустить тесты, убедиться, что они падают.**

- [ ] **Step 4: Реализовать.**
  - **Список клубов:** «Все клубы» и проекты из `scope.projects` без архивных. Если проект один, список не показывается.
  - **Сравнение** — переключатель «Сравнить с прошлым периодом».

- [ ] **Step 5: Запустить тесты, убедиться, что они проходят.** Тесты шагов 1–2 → PASS; `npm run typecheck`.

- [ ] **Step 6: Коммит**

```bash
git add src tests
git commit -m "feat(club): каркас страницы отчёта клуба — контролы, покрытие, Δ"
```

### Task 8: Страница «Выручка клуба»

**Files:**
- Create: `src/client/pages/club/ClubRevenuePage.tsx`, `src/client/components/club/ClubTable.tsx`, `src/client/components/club/HoursHeatmap.tsx`, `src/client/components/club/ClubRows.tsx`, `tests/client/club-revenue-page.test.ts`
- Modify: `src/client/router.tsx` (`analytics/club/revenue`)

**Interfaces:**
- Consumes: ответ `revenue` и `revenue/rows` (задача 5), `ClubReportScreen`, `CoverageBanner`, `delta` (задача 7), `BarsLineChart` из `components/charts`.
- Produces:
  - `revenueCellTitle(row: { label: string }, col: ReportColumn | null): string` — «Бар за 01.11» или «Бар за период»;
  - `heatColor(value: number | null, max: number): string` — 6 ступеней от `bg-field` к `bg-income`; `null` → класс серой штриховки;
  - `missingText(withData: number, total: number): string | null` — «данные не за все дни (N из M)» или `null`.

- [ ] **Step 1: Тесты `tests/client/club-revenue-page.test.ts`:**
  - `revenueCellTitle({label:'Бар'}, {key:'2026-11-01',label:'1 ноя',…})` → «Бар за 1 ноя»;
  - `heatColor(0, 100)` и `heatColor(100, 100)` — разные ступени;
  - `heatColor(null, 100)` — класс «нет данных»;
  - `missingText(2, 3)` → «данные не за все дни (2 из 3)»;
  - `missingText(3, 3)` → `null`.

- [ ] **Step 2: Запустить тест, убедиться, что он падает.**

- [ ] **Step 3: Реализовать** по §5.
  - **Разрезы:** «По частям», «По способу оплаты», «По сменам», «По кассирам». Виды: «график», «таблица», «по часам».
  - **Таблица** — первая колонка закреплена, итог справа, Δ под итогом. Ячейка `null` — «нет данных» серым. В заголовке колонки — `missingText`.
  - **Справочные строки** — курсивом, после «Выручки». У «Справочно: разница» — `HelpButton` с текстом подсказки §5.1.
  - **Строка «Не сходится со сменами: X ₸»** — над таблицей, если `reconcile.diffShifts` не пуст. Щелчок раскрывает список смен со ссылками `/c/:id/senet/shifts`.
  - **График** — столбцы «Часы» и «Бар» с накоплением по колонкам; линия «Деньги в кассу».
  - **По часам** — `HoursHeatmap`: строки Пн–Вс, колонки 0–23. Подпись ячейки для программ чтения — «Пн, 20:00–21:00: 6 000 ₸».
  - **Щелчок по ячейке** — `ClubRows` под таблицей: заголовок `revenueCellTitle`, «×», страницы по 50. Фокус — как в `ReportScreen` §2.5.
  - **Разрез «По сменам»** — строка ведёт в «Сверку».
  - **Excel** — `…/revenue.xlsx?<clubApiParams>`.

- [ ] **Step 4: Запустить тест, убедиться, что он проходит.** Тест шага 1 → PASS; `npm run typecheck`.

- [ ] **Step 5: Коммит**

```bash
git add src tests
git commit -m "feat(club): страница «Выручка клуба»"
```

### Task 9: «Обзор клуба»

**Files:**
- Create: `src/server/modules/club-analytics/overview.ts`, `src/client/pages/club/ClubOverviewPage.tsx`, `src/client/components/club/Tile.tsx`, `tests/server/club-overview.test.ts`, `tests/client/club-overview.test.ts`
- Modify: `src/server/modules/analytics/service.ts` (метод `dealTotal`), `src/server/modules/club-analytics/routes.ts`, `src/client/router.tsx` (`analytics/club`)

**Interfaces:**
- Consumes: расчёт выручки задачи 5, `clubScope`, `resolveTiles`, `BUILT_CLUB_REPORTS`, `TILE_SOON`, `delta`.
- Produces:
  - `AnalyticsService.dealTotal(companyId: number, q: { from: string; to: string; projectIds: readonly number[]; categoryIds: readonly number[] }): Promise<number>`:
    - Σ `base_amount` строк расходов по дате сделки (правила «Прибыли», §3.1 спецификации 2026-10-16);
    - категории — вместе с подкатегориями;
    - результат — положительное число.
  - `GET /api/v1/companies/:cid/club-analytics/overview?from&to&project&compare`:
    ```ts
    {
      tiles: {
        key: string; label: string; unit: TileDef['unit'];
        value: number | null; prev: number | null; approx: boolean;
        spark: (number | null)[];
        available: boolean; note: string | null;
        href: string;
      }[];
      days: { day: string; revenue: number | null; coverage: DayCoverage }[];
      best: { day: string; revenue: number }[];
      worst: { day: string; revenue: number }[];
      coverage; prevCoverage; freshness;
    }
    ```
    - `tiles` — только видимые по настройкам, в их порядке.
    - Плитки АК-1:
      - `revenue`;
      - `revenuePerPcDay` = (часы + бар) / (Σ `pcCount` проектов с параметром × дней с данными);
      - `barShare` = бар / выручку, доля 0…1;
      - `refills`;
      - `payrollToRevenue` — категории с `effectiveSystemKey = 'salary'` проектов-клубов / выручку;
      - `rentToRevenue` — категория `templateRef = 'computer-club:rent'` и её подкатегории / выручку.
    - Остальные плитки — `available: false`, `note` из `TILE_SOON`, `value: null`.
    - `pcCount` не задан ни у одного проекта → `revenuePerPcDay` `available: false`, `note`: «Задайте количество ПК в карточке проекта».
    - `best` и `worst` — по 3 дня, только `coverage = 'full'`. Если таких дней меньше 6, списки не пересекаются: сначала `best`.

- [ ] **Step 1: Тесты `tests/server/club-overview.test.ts`** (данные задачи 5):
  - **Плитки по умолчанию** — видимые и доступные `revenue`, `revenuePerPcDay`, `barShare` в порядке каталога; `load`, `guests`, `newGuests`, `revenuePerGuest`, `barMargin` — `available:false` с пометками.
  - **`revenuePerPcDay`** при `pcCount 10` и двух днях = выручка / 20.
  - **`payrollToRevenue`:** расход 1 000 ₸ в категории «Администраторы» (под «Зарплатой») проекта-клуба. После включения плитки настройкой — доля = 100 000 / выручку. Расход того же вида в другом проекте не входит.
  - **Без `pcCount`** — пометка «Задайте количество ПК в карточке проекта».
  - **`best` и `worst`** не содержат частичных дней.
  - **`compare`** — `prev` за прошлый период без данных = `null`.

- [ ] **Step 2: Тесты `tests/client/club-overview.test.ts`** — чистая функция `tileValueText(tile)`:
  - деньги — `formatMoney`;
  - доля 0.425 → «42,5 %»;
  - `value null` и `available false` → пометка;
  - `value null` и `available true` → «нет данных».

- [ ] **Step 3: Запустить тесты, убедиться, что они падают.**

- [ ] **Step 4: Реализовать.**
  - **Страница** — §4:
    - сетка плиток: 4 в ряд на компьютере, 2 на телефоне;
    - в плитке — значение, Δ (`delta`), мини-график без осей;
    - плитка — ссылка `href` с тем же периодом и клубом.
  - **Под плитками:**
    - график «Выручка по дням» — столбцы. Линия загрузки появится в АК-2 (Ruling R7, в §16: «Загрузка на графике «Обзора» — с отчётом «Загрузка»»);
    - «Лучшие и худшие дни».
  - **«Часы пик»** — не в этом плане, с АК-2. Тот же R7.
  - **Excel** — плитки и ряд по дням, `…/overview.xlsx`.

- [ ] **Step 5: Запустить тесты, убедиться, что они проходят.** Тесты шагов 1–2 → PASS на обоих диалектах; `npm run typecheck`.

- [ ] **Step 6: Коммит**

```bash
git add src tests docs/superpowers/specs/2026-11-03-club-analytics-design.md
git commit -m "feat(club): «Обзор клуба» — плитки, Δ, ряд по дням, лучшие и худшие дни"
```

### Task 10: Демо-данные, e2e, снимки, README

**Files:**
- Create: `scripts/lib/senet-club-demo.ts`, `e2e/club-analytics.spec.ts`
- Modify:
  - `e2e/server.ts` — поддельный Senet отдаёт и данные клуба;
  - `scripts/ux-shots.ts`;
  - `README.md` — раздел «Аналитика клуба»;
  - `docs/superpowers/followups/2026-11-03-club-analytics-1-followups.md` (новый).

**Interfaces:**
- Produces: `clubDemoReports(now: number): (type: string, q: Record<string, string>) => Buffer | null` — синтетические отчёты за 60 дней по окну запроса:
  - ~40 сеансов в день по двум зонам «Общий зал» (30 ПК) и «VIP» (10 ПК), вечерний пик;
  - продажи бара 5 товаров;
  - пополнения `General` и `Check`;
  - транзакции, сходящиеся со сменами;
  - выдуманные логины `guest001…`, телефоны `+7700000xxxx`;
  - детерминированно: псевдослучайность от дня.
  
  Встраивается в `startSenetDemo` через `report`.

- [ ] **Step 1: e2e `e2e/club-analytics.spec.ts`** (`test.describe.configure({ mode: 'serial' })`, вход как в `senet.spec.ts`):
  - **Подготовка:** компания, проект «Клуб 1» с шаблоном «Компьютерный клуб» и 40 ПК, подключение демо-Senet, клуб привязан к проекту, «Загрузить за период» на 30 дней.
  - **Главная «Аналитики»:** группа «Компьютерный клуб» с карточками «Обзор клуба» и «Выручка клуба».
  - **«Обзор клуба»:**
    - три плитки со значениями;
    - в адресе `?period=month` полоса «нет данных» за дни до загрузки;
    - щелчок по «Выручка» ведёт на «Выручку клуба» с тем же периодом.
  - **«Выручка клуба»:**
    - строки «Часы», «Бар», «Выручка», три справочные;
    - «По часам» — карта 7×24;
    - щелчок по ячейке — список сеансов с масками `+7 *** ** xx`;
    - «Excel» скачивается.
  - **«Настройки → Аналитика»:**
    - скрыть «Выручку клуба» → на главной её нет;
    - `page.goto('/c/:id/analytics/club/revenue')` открывает отчёт;
    - «Вернуть как было» возвращает карточку.
  - **Телефон** (`viewport 390×844`): «Обзор» — плитки в 2 колонки, контролы в окне «Фильтры».

- [ ] **Step 2: Запустить e2e.** `npx playwright test e2e/club-analytics.spec.ts` → PASS. Затем `E2E_DB=pg npx playwright test e2e/club-analytics.spec.ts` → PASS.

- [ ] **Step 3: Снимки.** `scripts/ux-shots.ts` — добавить снимки, светлая и тёмная тема:
  - «Обзор клуба»;
  - «Выручка клуба» — таблица и «по часам»;
  - «Настройки → Аналитика»;
  - телефон «Обзора».
  
  `npm run shots:ux` → все снимки PASS.

- [ ] **Step 4: README и итоги.**
  - **README «Аналитика клуба»:**
    - что такое выручка и деньги в кассу и почему они расходятся;
    - дни без данных и «Загрузить за период»;
    - «Настройки → Аналитика»;
    - «Количество ПК» проекта.
  - **Итоги в `followups`:**
    - решения R1–R7;
    - что осталось АК-2…АК-4;
    - чек-лист владельцу:
      - «деньги в кассу» за неделю = «Сверка»;
      - разница с выручкой объяснима;
      - плитки «Обзора» правдоподобны.

- [ ] **Step 5: Полная проверка.** `npm test`, `npm run typecheck`, `npm run lint:async`, `npx playwright test` → PASS. Известные падения `analytics-pnl:244` и `mobile:1254` зависят от даты и падали до Phase 5 — записать в итоги, если повторятся.

- [ ] **Step 6: Коммит и пуш**

```bash
git add scripts e2e README.md docs/superpowers/followups/2026-11-03-club-analytics-1-followups.md
git commit -m "test(club): демо-данные клуба, e2e и снимки; README «Аналитика клуба»"
git push origin stage1/plan1-skeleton
```

---

## Планы после АК-1
- **АК-2 «Загрузка»** — `senet_zones`, блок «Зоны» в «Изменить» клуба, слияние наложенных сеансов поверх `splitByHour`, карта, график, таблица зон; плитка «Загрузка ПК», линия загрузки и «Часы пик» в «Обзоре».
- **АК-3 «Гости»** — связи гостей (`senet_guest_links`, общий логин — больше 3 телефонов за 90 дней), визиты, когорты, постоянные гости и карточка; плитки гостей.
- **АК-4 «Бар» и приёмка** — таблица товаров, ABC, закупки; плитка «Маржа бара»; `bench:club`; чек-лист приёмки.

Каждый из них добавляет свой ключ в `CLUB_DASHBOARDS` и `BUILT_CLUB_REPORTS`: настройки компании подхватят новую карточку в конце группы (§10.3).
