# «Склад-1a»: товары, партии и FIFO, сервер — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** серверная часть первого плана модуля «Склад» (§14 спецификации): миграция, каталог и группы, история цены продажи, склады проектов, документы «Поступление», «Продажа», «Списание» с FIFO и пересчётом по §5, остатки и стоимость складов, оплата закупки расходом журнала, продажа в журнал (магазин).
- **Ядро:** `src/shared/stock-qty.ts` (количества в тысячных долях, суммы строк), `src/shared/stock-fifo.ts` (чистый проход по партиям, тиын-точное деление стоимости), `src/shared/stock-price.ts` (цена на дату).
- **Сервер:** `src/server/modules/stock/` — каталог, склады, документы с пересчётом, остатки, оплаты, проведение в журнал; маршруты `/api/v1/companies/:cid/stock/…`.
- **Операции журнала:** поле `stockPayments` в создании и правке расхода, оплаты в ответе.
- **Клиент** — план «Склад-1b»; перемещения, инвентаризация, комплекты, импорт — «Склад-2»; аналитика — «Склад-3»; Senet — вне этих планов.

**Предусловие:** ветка `stage1/plan1-skeleton` на коммите 300ba75 (спецификация «Склад» одобрена 2026-10-15). Ожидаемо на старте:
- `npm test` — 1096 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 171 из 171;
- `npm run shots:ux` — 57 из 57.

**После плана 1a:** `npm test` — 1220 пройдено и 1 пропущен; e2e и `shots:ux` не меняются (клиента в плане нет).

**Architecture:**
- **Ядро FIFO** — `runFifo(events)`: события пары `(at, docId, position)` сортируются внутри; поступление создаёт партию, списание берёт из ранних партий, не хватило — часть без партии и без стоимости. Стоимость взятой части — `floor(costLeft × q / qtyLeft)`, последняя единица забирает остаток (bigint).
- **Пересчёт пары** (`recalc.ts`) — читает строки пары из проведённых неудалённых документов, гонит ядро и переписывает `stock_batches` и `stock_allocations`; документы (`docs.ts`) вызывают его в `BEGIN IMMEDIATE` до и после изменения строк.
- **Остатки** (`balance.ts`) считаются тем же ядром по документам; стоимость складов — из сохранённых партий.
- **Оплаты** (`payments.ts`) и проведение (`postings.ts`) живут рядом с документами; операции журнала зовут `payments.ts` напрямую, как зовут `requireCompany`.

**Tech Stack:** Node 24, TypeScript, Fastify 5, zod 4, Drizzle 0.45 + better-sqlite3, Vitest. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-15-warehouse-design.md](../specs/2026-10-15-warehouse-design.md): §1–§3 (решения, понятия, данные), §5 (FIFO и пересчёт), §6 (деньги), §10 (ошибки), §11 (API), §13 (тесты), §14 (планы). Уточнения плана — блок «Решения планирования плана Склад-1» в конце спецификации.

## Решения, принятые при планировании

1. **Разбиение.** План не вмещается в 7 задач, поэтому он разделён: **Склад-1a** (сервер, 6 задач) и **Склад-1b** (клиент, 5 задач). Каждый даёт работающее, проверяемое ПО; 1b начинается там, где закончилась 1a.
2. **Пересчёт пары (склад, товар) — полный проход, не «с даты».** При создании, правке и удалении документа партии и списания затронутых пар (старых и новых) сначала удаляются, затем меняются строки документа (на них ссылаются внешние ключи), затем пары строятся заново по всем проведённым неудалённым документам. Всё — в одной транзакции `BEGIN IMMEDIATE`. Оптимизация (контрольные точки, пересчёт с наименьшей даты) отложена: при ~10^4 строк на пару не нужна (открытый риск плана).
3. **Строгий порядок §5.2.** Порядок событий — `(at, doc.id, position)`. Долг продажи без остатка закрывает только поступление, стоящее в этом порядке раньше (дата не позже продажи) — введённое хоть позже, но «задним числом»; поступление, датированное позже продажи, долг не закрывает. Перенос продажи после поступления долг закрывает.
4. **Ручное списание требует остатка всегда.** После любого пересчёта у списания не должно остаться непокрытого количества, иначе 422 `INSUFFICIENT_STOCK` «Не хватает «{товар}»: на складе {N} {ед.} на {дату}» и откат транзакции — в том числе при правке продажи, удалении поступления или смене склада, если из-за этого не хватает уже проведённому списанию. Продажа может уйти в минус («Нет партии»).
5. **Последствия §5.4 считает сервер.** `dryRun: true` в теле `POST docs` и `PATCH docs/:id`, `?dryRun=1` у `DELETE docs/:id` выполняют ту же запись в транзакции и откатывают её; ответ `{doc: null, impact: {sales, writeoffs, since}}`. `sales` и `writeoffs` — сколько ДРУГИХ документов получили другую себестоимость или другое непокрытое количество; `since` — меньшая из старой и новой дат документа; ничего не затронуто — `{0, 0, null}`. Окно клиента спрашивает «Изменится себестоимость {N} продаж после {даты}» (число в родительном падеже, со списаниями — «… и {M} списаний …»).
6. **Документы.** Удаление мягкое (`deleted_at`), номер не освобождается; номер — `П-`/`Р-`/`С-` и четыре цифры по типу в компании. Дата документа не в будущем по `APP_TIMEZONE` (422 `INVARIANT_6`, как у операций). Типы — только `receipt`, `sale`, `writeoff`, статус всегда `posted`; сумма строки может быть 0. Версия и 409 — как у операций (`VERSION_CONFLICT`); правка без изменений версию не меняет и историю не пишет; тип документа не меняется.
7. **Миграция 0007** содержит все таблицы §3 (комплекты, перемещения, инвентаризация — колонки и таблицы есть, логики нет), чтобы Склад-2 не менял схему. Отличия от §3: у групп `name_key` (уникален в компании, как у тегов) и `created_at`; у документа `updated_at`. Имя файла миграции выдаёт `drizzle-kit`.
8. **Каталог.** `POST items/:id/price` — дата не в будущем (текущая цена всегда равна цене на сегодня), на ту же дату строка истории заменяется; `PATCH items/:id` цену не меняет; единица товара не меняется, пока есть документы; удаление — только товара без документов, иначе архив. Проверки «Комплект в поступлении» и состава комплектов — Склад-2 (комплекты в этом плане создать нельзя). Название товара и группы уникально по `name_key`, архивный дубль — `ARCHIVED_DUPLICATE`.
9. **Остатки.** `GET balance` считается проходом по документам тем же ядром FIFO (в том числе «на дату» — на конец календарного дня `at` по `APP_TIMEZONE`); в ответе все неархивные товары (архивные — пока есть остаток или долг), остаток = остаток партий - непокрытое (`deficit`), «Мало» — `qty < min_qty`, наценка — в сотых долях процента. Таблицы партий и списаний — производные данные для `GET value` (стоимость неархивных складов для левой панели) и будущей аналитики; тест сверяет их с проходом по документам.
10. **Оплаты закупок.** Суммы — в валюте компании; оплачивать можно только расходом со счёта в валюте компании, с контрагентом-поставщиком документа; сумма оплат не больше суммы расхода (422 `STOCK_PAYMENTS_EXCEED` «Оплаты закупок больше суммы расхода»), переплата документа допустима. Оплаты удалённого расхода и удалённого документа не учитываются (каскад — чтением: восстановление расхода возвращает оплату). Смена поставщика, суммы или типа расхода перепроверяет оплаты (422; при массовой смене контрагента — пропуск с причиной). `stockPayments` приходит в `OperationDto` у `GET/POST/PATCH` (в строках журнала его нет); без поля в `PATCH` оплаты не меняются. `GET suppliers/:id/unpaid?operationId=` отдаёт документы с долгом (`own` — оплата правимого расхода) и `lastCategoryId`.
11. **«Провести в журнал».** Счёт и категорию дохода выбирает пользователь; клиент подставляет прошлые для склада (`lastPost` в ответе документа) или категорию «Продажа товаров» (её можно создать в окне). Счёт — только в валюте компании (422). Правка продажи проведённый доход не синхронизирует (в окне видны обе суммы), удаление проведённой продажи доход оставляет, удалённая операция освобождает продажу для нового проведения. Продажа не из ручного ввода (`source` не `manual`) не проводится.
12. **Ссылки.** Проект со складом и контрагент с документами склада не удаляются (422 `INVARIANT_9`): их считает `countOperations` в `references`.
13. **Клиент.** Вкладка «Склад» в верхнем меню; на телефоне — первым пунктом «Ещё» (ссылка сразу на «Остатки»: заголовок получает фокус после перехода). Подвкладки «Остатки», «Документы», «Товары» (адрес `/c/:id/stock/<вкладка>?warehouse=`); «Аналитика» — Склад-3. Склады и группы — «Настройки» → «Склады» (склад «Бар {проект}» одним нажатием, группы без перетаскивания). Новый товар из формы документа создаётся с единицей «шт» и без цены — остальное в «Товарах».
14. **Форма документа.** Цена и сумма связаны: последним правленное остаётся, второе пересчитывается; сохраняется сумма. Форма закрывается с вопросом о несохранённом. «Оплатить» и «Провести в журнал» недоступны (`aria-disabled`), пока в документе есть несохранённые правки.
15. **Левая панель.** Группа «Склад» (строка на склад со стоимостью, итог «Склад: ₸ X») показывается только при наличии складов; «Всего на счетах» считается как раньше — по счетам.
16. **Невидимые символы.** Редакторы файлов превращают набранный `U+202F` в сам символ — после записи файла прогоняйте `escape-invisible.cjs` (см. Global Constraints).

## Global Constraints

- **Без новых npm-пакетов и сети.** Только то, что уже есть: Fastify, Drizzle, better-sqlite3, zod, Vitest.
- **Количество** — целое число тысячных долей единицы (1 шт = 1000); у `pcs` и `pack` кратно 1000 (ошибка «Количество в штуках — целое»), у `l` и `kg` — до трёх знаков; не больше 1 000 000 единиц на строку.
- **Деньги** — целые минимальные единицы базовой валюты компании; сумма строки — сумма закупки или продажи (цена — производная `amount / qty`); тиыны не теряются: сумма себестоимостей равна сумме закупок.
- **Время** — ISO UTC фиксированной ширины (`toISOString`), даты — `YYYY-MM-DD` в `APP_TIMEZONE` (Asia/Almaty).
- **Ошибки** — `AppError(status, code, message, fields?, details?)`, конверт `{error:{code,message,fields?,details?}}`; запись и история — одним `mutate(db, audit, …, {behavior:'immediate'})`; архивная компания — запись запрещена (`requireCompany(db, id, {writable:true})`, 422 `ARCHIVED_REFERENCE`).
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Реальные данные** в тестах и коде запрещены: только выдуманные «Кола 0,5», «Чипсы», «Сироп», «Клуб 1», «Поставщик А», «Сотрудник А».
- **Невидимые символы** (U+2212, U+00A0, U+202F, U+200B) в коде и в комментариях к нему — только текстовыми escape-последовательностями `\u2212`, `\u00A0`, `\u202F`, `\u200B` (в комментариях — обычный дефис). Редакторы файлов превращают набранный escape в сам символ: после записи файла выполните `node .superpowers/sdd/<рабочая папка>/escape-invisible.cjs <файл>` (он возвращает `\uXXXX`). Буквы «П», «Р», «С» номеров документов в коде — только `П`, `Р`, `С` (латинские P, C — другие буквы).
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «замените → на» делайте инструментом правки файлов; если текст разошёлся с планом пробелами или концами строк, копируйте его из файла плана. Файлы пишите инструментами Write/Edit, не here-документами оболочки.
- **Миграция** — только `npm run db:generate` (файл `0007_<имя>.sql` и `meta/0007_snapshot.json` выдаёт drizzle-kit, имя может отличаться); вручную SQL не пишется. В план эти файлы не вставлены.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя с его `data/`, на порту 3460 — демо-экземпляр; их и папку `data/` не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи; `.superpowers/` в git не входит.

## Review Focus

1. **Правка задним числом пересчитывает уже проданное.** Ожидание: поступление или правка закупки с более ранней датой меняет себестоимость последующих продаж и списаний, ответ несёт `impact` («{N} продаж после {даты}»), `dryRun` ничего не пишет и не тратит номер. Тесты: задача 3 «изменение прошлого», задача 4 «правка прошлого», property-тест задачи 3.
2. **Продажа в минус и поздний приход.** Ожидание: продажа без остатка проводится («Нет партии», себестоимость пуста); поступление с более ранней датой, введённое позже, закрывает долг; поступление позже продажи — не закрывает; перенос продажи после поступления закрывает. Тесты: задачи 1 и 3.
3. **Удаление поступления, из которого уже продавали или списывали.** Ожидание: проданное остаётся без партии с предупреждением; ручное списание лишилось остатка — 422 `INSUFFICIENT_STOCK`, документ не удалён, партии прежние. Тесты: задача 3.
4. **Оплаты и удаление расхода.** Ожидание: удаление (в том числе массовое) расхода снимает оплату, восстановление возвращает; удалённое поступление не ломает расход; переплата допустима, оплат больше суммы расхода — 422; чужой поставщик, не поступление, счёт в другой валюте — 422. Тесты: задача 5.
5. **Одновременная правка (409).** Ожидание: вторая правка документа или оплат расхода со старой версией — 409, данные первой целы. Тесты: задачи 4 и 5.
6. **Архивная компания.** Ожидание: чтение работает, любая запись (каталог, склады, документы, `dryRun`, оплаты, проведение) — 422 `ARCHIVED_REFERENCE`, ничего не записано. Тесты: задачи 2, 3, 5, 6.
7. **Точность тиынов.** Ожидание: три продажи по штуке из партии в три штуки за 1,00 — 0,33 + 0,33 + 0,34; сумма склада и себестоимости всегда равна закупкам при любой последовательности. Тесты: задача 1 (свойства), задача 3 (случайные последовательности через API).
8. **Дробное количество у штук и пустые/пограничные входы.** Ожидание: 422/400 с полем и понятным текстом; нулевое, отрицательное, слишком большое количество; пустой документ; неизвестный склад, товар, контрагент; другая компания — 404/422, не 500. Тесты: задачи 1–3.
9. **Склад не меняет деньги на счетах.** Ожидание: `GET balances` (в том числе «Всего на счетах») после поступлений и продаж прежний; проведение продажи в журнал меняет баланс счёта ровно на сумму дохода. Тесты: задачи 4 и 6.
10. **Удаление справочников, на которые ссылается склад.** Ожидание: проект со складом и контрагент с документами — 422 `INVARIANT_9`, не 500. Тесты: задачи 2 и 3.

---

## Карта файлов

```
src/shared/stock-qty.ts                    # единицы, разбор и показ количества, сумма строки и цена (новый)
src/shared/stock-fifo.ts                   # ядро FIFO: runFifo, takeCost, fifoTotals (новый)
src/shared/stock-price.ts                  # priceAt: цена на дату (новый)
src/shared/schemas/stock.ts                # zod-схемы каталога, складов, документов, проведения (новый)
src/shared/schemas/operations.ts           # stockPayments; paidAt экспортирован
src/server/db/schema.ts                    # 11 таблиц склада
src/server/db/migrations/0007_*.sql, meta/ # npm run db:generate
src/server/modules/stock/catalog.ts        # группы, товары, история цены (новый)
src/server/modules/stock/warehouses.ts     # склады проектов (новый)
src/server/modules/stock/recalc.ts         # пересчёт пары: партии и списания (новый)
src/server/modules/stock/docs.ts           # документы: номера, правила, пересчёт, последствия (новый)
src/server/modules/stock/balance.ts        # остатки и стоимость складов (новый)
src/server/modules/stock/payments.ts       # оплаты закупок (новый)
src/server/modules/stock/postings.ts       # продажа в журнал (новый)
src/server/modules/stock/routes.ts         # маршруты /stock (новый)
src/server/modules/operations/service.ts   # stockPayments в создании, правке, ответе
src/server/modules/references/service.ts   # склад и документы считаются ссылками
src/server/app.ts                          # регистрация модуля
tests/helpers/stock.ts                     # stockWorld: компания, склады, товары, документы (новый)
tests/shared/stock-qty.test.ts, stock-fifo.test.ts, stock-price.test.ts
tests/server/schema-0007.test.ts, stock-catalog.test.ts, stock-warehouses.test.ts, stock-docs.test.ts,
  stock-docs-update.test.ts, stock-property.test.ts, stock-balance.test.ts, stock-payments.test.ts, stock-postings.test.ts
```

---

### Task 1: Ядро — количества и FIFO (§5.1, §5.2, §13)

**Files:**
- Create: `src/shared/stock-fifo.ts`, `src/shared/stock-qty.ts`
- Test: `tests/shared/stock-fifo.test.ts` (новый), `tests/shared/stock-qty.test.ts` (новый)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `STOCK_UNITS`, `StockUnit`, `UNIT_LABELS`, `QTY_SCALE`, `QTY_MAX`, `isWholeUnit(unit)`, `qtyError(qty, unit): string | null`, `parseQty(text, unit): {ok:true, qty} | {ok:false, error}`, `formatQty(qty)`, `qtyInputText(qty)`, `lineAmount(price, qty)`, `unitPrice(amount, qty)` (`src/shared/stock-qty.ts`);
  - `FifoEvent = FifoIn | FifoOut` (`{kind, key, at, docId, position, qty[, cost]}`), `runFifo(events): {batches: FifoBatch[]; outs: Map<key, {key, takes: {batchKey|null, qty, cost|null}[], available, uncovered}>}`, `takeCost(costLeft, qtyLeft, q)`, `compareMoment`, `fifoTotals(result)` (`src/shared/stock-fifo.ts`).

- [ ] **Step 1: Write the failing tests**

Создайте `tests/shared/stock-fifo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareMoment, fifoTotals, runFifo, takeCost, type FifoEvent, type FifoIn, type FifoOut } from '../../src/shared/stock-fifo';

let seq = 0;
/** Поступление: key — строка, at — «день», docId растёт сам. */
const inn = (key: number, day: number, qty: number, cost: number, docId = ++seq): FifoIn => ({
  kind: 'in',
  key,
  at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  docId,
  position: 0,
  qty,
  cost,
});
const out = (key: number, day: number, qty: number, docId = ++seq): FifoOut => ({
  kind: 'out',
  key,
  at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  docId,
  position: 0,
  qty,
});

describe('takeCost (§5.2)', () => {
  it('взята вся партия — весь остаток стоимости', () => {
    expect(takeCost(100, 3000, 3000)).toBe(100);
  });
  it('часть — floor(costLeft × q / qtyLeft)', () => {
    expect(takeCost(100, 3000, 1000)).toBe(33);
    expect(takeCost(100, 3000, 2000)).toBe(66);
  });
  it('большая стоимость не теряет точность (bigint)', () => {
    expect(takeCost(9_007_199_254_740_991, 3_000_000, 1_000_000)).toBe(3_002_399_751_580_330);
  });
});

describe('runFifo: партии', () => {
  it('несколько партий списываются от самой ранней', () => {
    const r = runFifo([inn(1, 1, 10_000, 1000), inn(2, 2, 10_000, 1500), out(10, 3, 15_000)]);
    const o = r.outs.get(10)!;
    expect(o.takes).toEqual([
      { batchKey: 1, qty: 10_000, cost: 1000 },
      { batchKey: 2, qty: 5000, cost: 750 },
    ]);
    expect(o.available).toBe(20_000);
    expect(o.uncovered).toBe(0);
    expect(r.batches.map((b) => [b.key, b.qtyLeft, b.costLeft])).toEqual([
      [1, 0, 0],
      [2, 5000, 750],
    ]);
  });

  it('частичное взятие: остаток стоимости остаётся в партии, последняя единица забирает его', () => {
    const r = runFifo([inn(1, 1, 3000, 100), out(10, 2, 1000), out(11, 3, 1000), out(12, 4, 1000)]);
    expect([10, 11, 12].map((k) => r.outs.get(k)!.takes[0]!.cost)).toEqual([33, 33, 34]);
    expect(r.batches[0]).toMatchObject({ qtyLeft: 0, costLeft: 0 });
  });

  it('точность тиынов: себестоимость + остаток = закупка при любом дроблении', () => {
    const events: FifoEvent[] = [inn(1, 1, 7000, 1001), inn(2, 2, 3000, 7)];
    let key = 10;
    for (const q of [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 500]) events.push(out(key++, 3, q));
    const t = fifoTotals(runFifo(events));
    expect(t.costTaken + t.costLeft).toBe(1001 + 7);
    expect(t.qtyTaken + t.qtyLeft).toBe(10_000);
  });

  it('порядок внутри одного момента — по документу и позиции', () => {
    const a = { ...out(10, 1, 1000, 5), position: 1 };
    const b = { ...out(11, 1, 1000, 5), position: 0 };
    const r = runFifo([a, b, inn(1, 1, 1000, 100, 4), { ...inn(2, 1, 1000, 300, 4), position: 1 }]);
    // документ 4 раньше документа 5; внутри 5 первой идёт позиция 0
    expect(r.outs.get(11)!.takes).toEqual([{ batchKey: 1, qty: 1000, cost: 100 }]);
    expect(r.outs.get(10)!.takes).toEqual([{ batchKey: 2, qty: 1000, cost: 300 }]);
  });

  it('compareMoment сравнивает момент, затем документ, затем позицию', () => {
    const m = (at: string, docId: number, position: number) => ({ at, docId, position });
    expect(compareMoment(m('a', 9, 9), m('b', 1, 1))).toBeLessThan(0);
    expect(compareMoment(m('a', 1, 9), m('a', 2, 0))).toBeLessThan(0);
    expect(compareMoment(m('a', 1, 1), m('a', 1, 0))).toBeGreaterThan(0);
    expect(compareMoment(m('a', 1, 1), m('a', 1, 1))).toBe(0);
  });
});

describe('runFifo: минус и его закрытие (§5.3)', () => {
  it('продажа без остатка: партия и себестоимость пустые, «Нет партии»', () => {
    const r = runFifo([out(10, 2, 2000)]);
    expect(r.outs.get(10)).toEqual({ key: 10, takes: [{ batchKey: null, qty: 2000, cost: null }], available: 0, uncovered: 2000 });
  });

  it('остатка хватило на часть: часть из партии, остальное — без партии', () => {
    const r = runFifo([inn(1, 1, 1000, 500), out(10, 2, 3000)]);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 1, qty: 1000, cost: 500 },
      { batchKey: null, qty: 2000, cost: null },
    ]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
  });

  it('поступление с более ранней датой, введённое позже, закрывает долг', () => {
    const sale = out(10, 5, 2000, 1);
    const before = runFifo([sale]);
    expect(before.outs.get(10)!.uncovered).toBe(2000);
    const after = runFifo([sale, inn(1, 3, 5000, 5000, 2)]);
    expect(after.outs.get(10)!.takes).toEqual([{ batchKey: 1, qty: 2000, cost: 2000 }]);
    expect(after.batches[0]).toMatchObject({ qtyLeft: 3000, costLeft: 3000 });
  });

  it('поступление позже продажи долг не закрывает', () => {
    const r = runFifo([out(10, 2, 2000, 1), inn(1, 3, 5000, 5000, 2)]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
    expect(r.batches[0]).toMatchObject({ qtyLeft: 5000, costLeft: 5000 });
  });

  it('перенос продажи на дату после поступления закрывает долг', () => {
    const receipt = inn(1, 3, 5000, 5000, 2);
    expect(runFifo([out(10, 2, 2000, 1), receipt]).outs.get(10)!.uncovered).toBe(2000);
    expect(runFifo([out(10, 4, 2000, 1), receipt]).outs.get(10)!.uncovered).toBe(0);
  });
});

describe('runFifo: изменение прошлого', () => {
  const base = (): FifoEvent[] => [inn(1, 1, 10_000, 1000, 1), inn(2, 5, 10_000, 3000, 2), out(10, 6, 12_000, 3)];

  it('исходное: 10 по 1000 и 2 по 600', () => {
    expect(runFifo(base()).outs.get(10)!.takes).toEqual([
      { batchKey: 1, qty: 10_000, cost: 1000 },
      { batchKey: 2, qty: 2000, cost: 600 },
    ]);
  });

  it('поступление задним числом встаёт в начало и меняет себестоимость последующей продажи', () => {
    const r = runFifo([...base(), inn(3, 0, 4000, 4000, 9)]);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 3, qty: 4000, cost: 4000 },
      { batchKey: 1, qty: 8000, cost: 800 },
    ]);
  });

  it('изменение суммы закупки первой партии пересчитывает продажу', () => {
    const events = base();
    events[0] = inn(1, 1, 10_000, 2000, 1);
    expect(runFifo(events).outs.get(10)!.takes[0]).toEqual({ batchKey: 1, qty: 10_000, cost: 2000 });
  });

  it('удаление поступления, из которого уже продавали: продажа остаётся без партии', () => {
    const events = base().filter((e) => e.key !== 1);
    const r = runFifo(events);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 2, qty: 10_000, cost: 3000 },
      { batchKey: null, qty: 2000, cost: null },
    ]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
  });

  it('порядок входа не влияет на результат', () => {
    const events = [...base(), inn(3, 0, 4000, 4000, 9), out(11, 7, 1000, 10)];
    const forward = runFifo(events);
    const backward = runFifo([...events].reverse());
    expect(backward.batches).toEqual(forward.batches);
    expect([...backward.outs.entries()].sort()).toEqual([...forward.outs.entries()].sort());
  });
});

/** Детерминированный генератор (mulberry32): тест воспроизводим по зерну. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('runFifo: свойства на случайных последовательностях (§13)', () => {
  it('стоимость склада + себестоимость взятого = сумма закупок; qty_left ≥ 0; количество сходится', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const n = 1 + Math.floor(rand() * 40);
      const events: FifoEvent[] = [];
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rand() * 28);
        const qty = (1 + Math.floor(rand() * 9)) * (rand() < 0.5 ? 1000 : 1) * (1 + Math.floor(rand() * 5));
        if (rand() < 0.45) events.push(inn(i + 1, day, qty, Math.floor(rand() * 100_000), i + 1));
        else events.push(out(i + 1, day, qty, i + 1));
      }
      const r = runFifo(events);
      const t = fifoTotals(r);
      const purchased = events.filter((e): e is FifoIn => e.kind === 'in');
      const sold = events.filter((e) => e.kind === 'out');

      expect(r.batches.every((b) => b.qtyLeft >= 0 && b.costLeft >= 0), `seed ${seed}`).toBe(true);
      expect(r.batches.every((b) => b.qtyLeft > 0 || b.costLeft === 0), `seed ${seed}: пустая партия без остатка стоимости`).toBe(true);
      expect(t.costLeft + t.costTaken, `seed ${seed}: деньги`).toBe(purchased.reduce((s, e) => s + e.cost, 0));
      expect(t.qtyLeft + t.qtyTaken, `seed ${seed}: количество`).toBe(purchased.reduce((s, e) => s + e.qty, 0));
      expect(t.qtyTaken + t.uncovered, `seed ${seed}: списано`).toBe(sold.reduce((s, e) => s + e.qty, 0));
      // у каждого списания части в сумме дают его количество, а пустая партия всегда с пустой стоимостью
      for (const e of sold) {
        const o = r.outs.get(e.key)!;
        expect(o.takes.reduce((s, x) => s + x.qty, 0)).toBe(e.qty);
        expect(o.takes.every((x) => (x.batchKey === null) === (x.cost === null))).toBe(true);
        expect(o.uncovered).toBe(o.takes.filter((x) => x.batchKey === null).reduce((s, x) => s + x.qty, 0));
      }
      // порядок входа не важен
      expect(runFifo([...events].reverse()).batches, `seed ${seed}: порядок`).toEqual(r.batches);
    }
  });
});
```

Создайте `tests/shared/stock-qty.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatQty, isWholeUnit, lineAmount, parseQty, qtyError, qtyInputText, QTY_MAX, unitPrice } from '../../src/shared/stock-qty';

describe('parseQty', () => {
  it('штуки — целое число; запятая и точка с нулями допустимы', () => {
    expect(parseQty('12', 'pcs')).toEqual({ ok: true, qty: 12000 });
    expect(parseQty('2,0', 'pcs')).toEqual({ ok: true, qty: 2000 });
    expect(parseQty(' 1 500 ', 'pack')).toEqual({ ok: true, qty: 1_500_000 });
  });

  it('дробное количество штук — ошибка «Количество в штуках — целое»', () => {
    expect(parseQty('1,5', 'pcs')).toEqual({ ok: false, error: 'Количество в штуках — целое' });
    expect(parseQty('0.001', 'pack')).toEqual({ ok: false, error: 'Количество в штуках — целое' });
  });

  it('литры и килограммы — до трёх знаков', () => {
    expect(parseQty('1,5', 'l')).toEqual({ ok: true, qty: 1500 });
    expect(parseQty('.25', 'kg')).toEqual({ ok: true, qty: 250 });
    expect(parseQty('0,001', 'kg')).toEqual({ ok: true, qty: 1 });
    expect(parseQty('0,0001', 'kg')).toEqual({ ok: false, error: 'Не больше трёх знаков после запятой' });
  });

  it('пусто, ноль, мусор и слишком много — понятные ошибки', () => {
    expect(parseQty('', 'pcs')).toEqual({ ok: false, error: 'Введите количество' });
    expect(parseQty('0', 'pcs')).toEqual({ ok: false, error: 'Количество больше нуля' });
    expect(parseQty('-3', 'pcs').ok).toBe(false);
    expect(parseQty(',', 'l').ok).toBe(false);
    expect(parseQty('1000001', 'pcs')).toEqual({ ok: false, error: 'Слишком большое количество' });
  });
});

describe('qtyError', () => {
  it('сервер: целое больше нуля, у штук кратно 1000, не больше предела', () => {
    expect(qtyError(1000, 'pcs')).toBeNull();
    expect(qtyError(1500, 'pcs')).toBe('Количество в штуках — целое');
    expect(qtyError(1500, 'l')).toBeNull();
    expect(qtyError(0, 'l')).toBe('Количество больше нуля');
    expect(qtyError(1.5, 'l')).toBe('Количество больше нуля');
    expect(qtyError(QTY_MAX + 1, 'l')).toBe('Слишком большое количество');
  });

  it('isWholeUnit', () => {
    expect([isWholeUnit('pcs'), isWholeUnit('pack'), isWholeUnit('l'), isWholeUnit('kg')]).toEqual([true, true, false, false]);
  });
});

describe('formatQty и qtyInputText', () => {
  it('показ с разрядами и без лишних нулей', () => {
    expect(formatQty(2000)).toBe('2');
    expect(formatQty(1500)).toBe('1,5');
    expect(formatQty(250)).toBe('0,25');
    expect(formatQty(1_234_000)).toBe('1\u202F234');
    expect(formatQty(-3000)).toBe('\u22123');
    expect(qtyInputText(1_234_500)).toBe('1234,5');
  });
});

describe('lineAmount и unitPrice', () => {
  it('сумма = цена × количество до тиына half-up', () => {
    expect(lineAmount(15000, 3000)).toBe(45000);
    expect(lineAmount(15000, 1500)).toBe(22500);
    expect(lineAmount(333, 500)).toBe(167); // 166,5 -> 167
    expect(lineAmount(1, 1)).toBe(0);
  });

  it('цена из суммы и количества, количество 0 — 0', () => {
    expect(unitPrice(45000, 3000)).toBe(15000);
    expect(unitPrice(100, 3000)).toBe(33);
    expect(unitPrice(101, 3000)).toBe(34);
    expect(unitPrice(5, 0)).toBe(0);
  });

  it('большие суммы не теряют точность', () => {
    // произведение 9,007e18 не помещается в безопасное целое, результат 9 007 199 254 740 000 — помещается
    expect(lineAmount(9_007_199_254_740, 1_000_000)).toBe(9_007_199_254_740_000);
    expect(unitPrice(9_007_199_254_740_000, 1_000_000)).toBe(9_007_199_254_740);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/stock-qty.test.ts tests/shared/stock-fifo.test.ts`
Expected: FAIL — файлы тестов:  2 failed | 1 passed (3) | тесты:  7 passed (7) (модулей `stock-qty` и `stock-fifo` ещё нет).

- [ ] **Step 3: Write the implementation**

Создайте `src/shared/stock-fifo.ts`:

```ts
/**
 * FIFO по партиям (§5.2 спецификации «Склад»): чистое ядро без базы. Пара (склад, товар) — упорядоченный список
 * событий: поступление создаёт партию, продажа и списание берут из самых ранних партий с остатком.
 * Количества — тысячные доли, стоимости — минимальные единицы валюты. Порядок событий — (at, docId, position);
 * `runFifo` сортирует сам, поэтому проход по любому порядку входа даёт один и тот же результат.
 */
export interface FifoMoment {
  /** ISO-момент UTC фиксированной ширины (`toISOString`): сравнивается как строка. */
  at: string;
  docId: number;
  position: number;
}

export interface FifoIn extends FifoMoment {
  kind: 'in';
  /** Строка документа, создающая партию (origin_line_id). */
  key: number;
  qty: number;
  cost: number;
}

export interface FifoOut extends FifoMoment {
  kind: 'out';
  /** Строка документа, из которой списано. */
  key: number;
  qty: number;
}

export type FifoEvent = FifoIn | FifoOut;

export interface FifoBatch {
  key: number;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
}

/** Часть списания: из партии `batchKey`; пустая партия и пустая стоимость — не хватило остатка (§5.3). */
export interface FifoTake {
  batchKey: number | null;
  qty: number;
  cost: number | null;
}

export interface FifoOutResult {
  key: number;
  takes: FifoTake[];
  /** Остаток пары перед этим списанием. */
  available: number;
  /** Сколько не нашло партии. */
  uncovered: number;
}

export interface FifoResult {
  /** Партии в порядке прихода; остаток — после последнего события. */
  batches: FifoBatch[];
  outs: Map<number, FifoOutResult>;
}

export function compareMoment(a: FifoMoment, b: FifoMoment): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.docId !== b.docId) return a.docId - b.docId;
  return a.position - b.position;
}

/**
 * Стоимость части партии (§5.2): взята вся — остаток стоимости, иначе floor(costLeft × q / qtyLeft).
 * Остаток стоимости остаётся в партии, последняя единица забирает его: сумма себестоимостей равна сумме закупок.
 */
export function takeCost(costLeft: number, qtyLeft: number, q: number): number {
  if (q >= qtyLeft) return costLeft;
  return Number((BigInt(costLeft) * BigInt(q)) / BigInt(qtyLeft));
}

export function runFifo(events: readonly FifoEvent[]): FifoResult {
  const sorted = [...events].sort(compareMoment);
  const batches: FifoBatch[] = [];
  const outs = new Map<number, FifoOutResult>();
  /** Первая партия, в которой может быть остаток: опустошённые не просматриваются заново. */
  let head = 0;
  let stock = 0;
  for (const e of sorted) {
    if (e.kind === 'in') {
      batches.push({ key: e.key, at: e.at, qtyIn: e.qty, costIn: e.cost, qtyLeft: e.qty, costLeft: e.cost });
      stock += e.qty;
      continue;
    }
    const takes: FifoTake[] = [];
    let left = e.qty;
    for (let i = head; i < batches.length && left > 0; i++) {
      const b = batches[i]!;
      if (b.qtyLeft === 0) continue;
      const q = Math.min(left, b.qtyLeft);
      const cost = takeCost(b.costLeft, b.qtyLeft, q);
      b.qtyLeft -= q;
      b.costLeft -= cost;
      takes.push({ batchKey: b.key, qty: q, cost });
      left -= q;
    }
    while (head < batches.length && batches[head]!.qtyLeft === 0) head++;
    if (left > 0) takes.push({ batchKey: null, qty: left, cost: null });
    outs.set(e.key, { key: e.key, takes, available: stock, uncovered: left });
    stock -= e.qty - left;
  }
  return { batches, outs };
}

/** Итоги прохода: остаток и его стоимость, взятое и его себестоимость, не нашедшее партии. */
export function fifoTotals(r: FifoResult): { qtyLeft: number; costLeft: number; qtyTaken: number; costTaken: number; uncovered: number } {
  let costTaken = 0;
  let qtyTaken = 0;
  let uncovered = 0;
  for (const o of r.outs.values()) {
    uncovered += o.uncovered;
    for (const t of o.takes) {
      if (t.batchKey === null) continue;
      qtyTaken += t.qty;
      costTaken += t.cost ?? 0;
    }
  }
  return {
    qtyLeft: r.batches.reduce((s, b) => s + b.qtyLeft, 0),
    costLeft: r.batches.reduce((s, b) => s + b.costLeft, 0),
    qtyTaken,
    costTaken,
    uncovered,
  };
}
```

Создайте `src/shared/stock-qty.ts`:

```ts
/**
 * Количество и цена товара (§5.1 спецификации «Склад»): количество — целое число тысячных долей единицы (1 шт = 1000),
 * деньги — минимальные единицы базовой валюты. Арифметика целочисленная, через bigint: произведение суммы на
 * количество не помещается в безопасное целое.
 */
export const STOCK_UNITS = ['pcs', 'l', 'kg', 'pack'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** Подписи единиц на экране. */
export const UNIT_LABELS: Record<StockUnit, string> = { pcs: 'шт', l: 'л', kg: 'кг', pack: 'уп' };

/** Тысячных долей в единице. */
export const QTY_SCALE = 1000;
/** Наибольшее количество в строке: миллион единиц. */
export const QTY_MAX = 1_000_000 * QTY_SCALE;

export const WHOLE_UNIT_ERROR = 'Количество в штуках — целое';

/** Штуки и упаковки считаются поштучно: дробей нет. */
export function isWholeUnit(unit: StockUnit): boolean {
  return unit === 'pcs' || unit === 'pack';
}

/** Ошибка количества строки документа (для сервера) или null: целое, больше нуля, не больше предела, у «шт» кратно 1000. */
export function qtyError(qty: number, unit: StockUnit): string | null {
  if (!Number.isInteger(qty) || qty <= 0) return 'Количество больше нуля';
  if (qty > QTY_MAX) return 'Слишком большое количество';
  if (isWholeUnit(unit) && qty % QTY_SCALE !== 0) return WHOLE_UNIT_ERROR;
  return null;
}

export type QtyParse = { ok: true; qty: number } | { ok: false; error: string };

/** Текст поля количества → тысячные доли: «2», «1,5», «0.250». У «шт» и «уп» дробной части нет, у «л» и «кг» — до трёх знаков. */
export function parseQty(text: string, unit: StockUnit): QtyParse {
  const s = text.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  if (s === '') return { ok: false, error: 'Введите количество' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: 'Введите количество, например 1,5' };
  const frac = m[2] ?? '';
  if (isWholeUnit(unit) && /[1-9]/.test(frac)) return { ok: false, error: WHOLE_UNIT_ERROR };
  if (!isWholeUnit(unit) && frac.length > 3) return { ok: false, error: 'Не больше трёх знаков после запятой' };
  const qty = Number(`${m[1] || '0'}${frac.padEnd(3, '0').slice(0, 3)}`);
  const error = qtyError(qty, unit);
  return error ? { ok: false, error } : { ok: true, qty };
}

/** Количество для показа: «2», «1,5», «0,25»; разряды — узким неразрывным пробелом. */
export function formatQty(qty: number): string {
  const abs = String(Math.abs(qty)).padStart(4, '0');
  const int = abs.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const frac = abs.slice(-3).replace(/0+$/, '');
  return `${qty < 0 ? '\u2212' : ''}${int}${frac ? `,${frac}` : ''}`;
}

/** Количество в поле ввода: «2», «1,5» — без разрядов, чтобы поле принимало его обратно. */
export function qtyInputText(qty: number): string {
  return formatQty(qty).replace(/\u202F/g, '');
}

/** Сумма строки = цена за единицу × количество, до тиына half-up. */
export function lineAmount(price: number, qty: number): number {
  const n = BigInt(price) * BigInt(qty);
  return Number((2n * n + 1000n) / 2000n);
}

/** Цена за единицу из суммы строки и количества, до тиына half-up; количество 0 — 0. */
export function unitPrice(amount: number, qty: number): number {
  if (qty <= 0) return 0;
  const n = BigInt(amount) * 1000n;
  const q = BigInt(qty);
  return Number((2n * n + q) / (2n * q));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/shared/stock-qty.test.ts tests/shared/stock-fifo.test.ts` — PASS, затем `npm test` и `npm run typecheck`.
Expected: `npm test` - 1125 пройдено и 1 пропущен, typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/shared/stock-qty.ts src/shared/stock-fifo.ts tests/shared/stock-qty.test.ts tests/shared/stock-fifo.test.ts
git commit -m "feat: ядро FIFO и количества склада (Склад-1a, задача 1)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Миграция 0007, каталог, группы, история цены, склады (§3.1, §3.2, §4.3, §4.5, §11)

**Files:**
- Create: `src/server/modules/stock/catalog.ts`, `src/server/modules/stock/routes.ts`, `src/server/modules/stock/warehouses.ts`, `src/shared/schemas/stock.ts`, `src/shared/stock-price.ts`
- Modify: `src/server/app.ts`, `src/server/db/schema.ts`, `src/server/modules/references/service.ts`, `src/shared/schemas/operations.ts`
- Test: `tests/server/schema-0007.test.ts` (новый), `tests/server/stock-catalog.test.ts` (новый), `tests/server/stock-warehouses.test.ts` (новый), `tests/shared/stock-price.test.ts` (новый)
- Create (генерирует drizzle-kit): `src/server/db/migrations/0007_<два слова>.sql`, `src/server/db/migrations/meta/0007_snapshot.json`; Modify: `src/server/db/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: `mutate`, `changedFields` (`modules/audit/mutate`), `requireCompany` (`modules/companies/guard`), `nameField`, `cleanName`, `foldCase`, `todayInTimezone`, `AppError`, `parseId`, `opsWorld` (`tests/helpers/ops.ts`) — все существуют.
- Produces:
  - таблицы `stock_item_groups`, `stock_items`, `stock_item_prices`, `stock_combo_parts`, `stock_warehouses`, `stock_docs`, `stock_doc_lines`, `stock_batches`, `stock_allocations`, `stock_doc_payments`, `stock_doc_postings` (`src/server/db/schema.ts`, миграция 0007);
  - `priceAt(prices: PricePoint[], date): number`, `PricePoint` (`src/shared/stock-price.ts`);
  - zod-схемы и константы `src/shared/schemas/stock.ts`: `STOCK_DOC_TYPES`, `STOCK_DOC_PREFIX`, `WRITEOFF_REASONS`, `stockItemCreateSchema`, `stockItemUpdateSchema`, `stockPriceSchema`, `stockGroupSchema`, `stockWarehouseCreateSchema`, `stockWarehouseUpdateSchema`, `stockDocCreateSchema`, `stockDocUpdateSchema`, `stockDocListSchema`, `stockBalanceSchema`;
  - `createStockCatalogService({db, audit, timezone, now})`: `groups`, `addGroup`, `renameGroup`, `archiveGroup`, `unarchiveGroup`, `items`, `item`, `addItem`, `updateItem`, `setPrice`, `archiveItem`, `unarchiveItem`, `removeItem`; `StockItemDto = row & {prices}`;
  - `createStockWarehousesService({db, audit, now})`: `list`, `create`, `rename`, `archive`, `unarchive`, `require`;
  - `registerStockRoutes(app, deps)` — группы, товары, склады; `GET|POST groups`, `PATCH groups/:id`, `POST groups/:id/archive|unarchive`, `GET|POST items`, `GET|PATCH|DELETE items/:id`, `POST items/:id/price|archive|unarchive`, `GET|POST warehouses`, `PATCH warehouses/:id`, `POST warehouses/:id/archive|unarchive`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/schema-0007.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО 2','KZT','x')").run();
  s.prepare("INSERT INTO projects (company_id, name, template_key, template_params, order_index, created_at) VALUES (1,'Клуб 1','general','{}',0,'x')").run();
  s.prepare("INSERT INTO stock_warehouses (company_id, project_id, name, created_at) VALUES (1,1,'Бар','x')").run();
  s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (1,'Кола 0,5','кола 0,5','pcs','x')").run();
  return s;
}

const insertDoc = (number: string, extra = '') =>
  `INSERT INTO stock_docs (company_id, type, number, at, warehouse_id, created_by, created_at, updated_at, version${extra ? ', ' + extra.split('|')[0] : ''}) VALUES (1,'receipt','${number}','2026-10-01T10:00:00.000Z',1,1,'x','x',1${extra ? ', ' + extra.split('|')[1] : ''})`;

describe('миграция 0007 (§3 спецификации «Склад»)', () => {
  it('все таблицы склада созданы', () => {
    const s = setup();
    const names = (s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stock_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual([
      'stock_allocations',
      'stock_batches',
      'stock_combo_parts',
      'stock_doc_lines',
      'stock_doc_payments',
      'stock_doc_postings',
      'stock_docs',
      'stock_item_groups',
      'stock_item_prices',
      'stock_items',
      'stock_warehouses',
    ]);
  });

  it('у проекта не больше одного склада', () => {
    const s = setup();
    expect(() => s.prepare("INSERT INTO stock_warehouses (company_id, project_id, name, created_at) VALUES (1,1,'Ещё','x')").run()).toThrow(/UNIQUE/);
  });

  it('название товара уникально в компании по ключу, в другой компании — можно', () => {
    const s = setup();
    expect(() => s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (1,'КОЛА 0,5','кола 0,5','pcs','x')").run()).toThrow(/UNIQUE/);
    expect(s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (2,'Кола 0,5','кола 0,5','pcs','x')").run().changes).toBe(1);
  });

  it('номер документа уникален в компании; пара (источник, ключ) — тоже, пустой ключ повторяется', () => {
    const s = setup();
    expect(s.prepare(insertDoc('П-0001')).run().changes).toBe(1);
    expect(() => s.prepare(insertDoc('П-0001')).run()).toThrow(/UNIQUE/);
    expect(s.prepare(insertDoc('П-0002')).run().changes).toBe(1); // source_ref пуст у обоих
    expect(s.prepare(insertDoc('П-0003', "source, source_ref|'senet', 'смена-1'")).run().changes).toBe(1);
    expect(() => s.prepare(insertDoc('П-0004', "source, source_ref|'senet', 'смена-1'")).run()).toThrow(/UNIQUE/);
  });

  it('значения по умолчанию: проведён, вручную, цена 0, не комплект', () => {
    const s = setup();
    s.prepare(insertDoc('П-0001')).run();
    expect(s.prepare('SELECT status, source FROM stock_docs').get()).toEqual({ status: 'posted', source: 'manual' });
    expect(s.prepare('SELECT sale_price, is_combo, min_qty FROM stock_items').get()).toEqual({ sale_price: 0, is_combo: 0, min_qty: null });
  });

  it('внешние ключи: строка документа, партия и оплата не ссылаются в пустоту', () => {
    const s = setup();
    expect(() => s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty) VALUES (99,0,1,1000)').run()).toThrow(/FOREIGN KEY/);
    s.prepare(insertDoc('П-0001')).run();
    s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty, amount) VALUES (1,0,1,1000,500)').run();
    expect(() => s.prepare('INSERT INTO stock_doc_payments (doc_id, operation_id, amount) VALUES (1, 99, 5)').run()).toThrow(/FOREIGN KEY/);
    expect(() => s.prepare("INSERT INTO stock_batches (warehouse_id, item_id, origin_line_id, at, qty_in, cost_in, qty_left, cost_left) VALUES (1,1,99,'x',1,1,1,1)").run()).toThrow(/FOREIGN KEY/);
  });

  it('удаление документа удаляет его строки и их списания', () => {
    const s = setup();
    s.prepare(insertDoc('П-0001')).run();
    s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty, amount) VALUES (1,0,1,1000,500)').run();
    s.prepare('INSERT INTO stock_allocations (line_id, batch_id, qty, cost) VALUES (1, NULL, 1000, NULL)').run();
    s.prepare('DELETE FROM stock_docs WHERE id = 1').run();
    expect((s.prepare('SELECT COUNT(*) n FROM stock_doc_lines').get() as { n: number }).n).toBe(0);
    expect((s.prepare('SELECT COUNT(*) n FROM stock_allocations').get() as { n: number }).n).toBe(0);
  });

  it('история цены: одна строка на товар и дату', () => {
    const s = setup();
    s.prepare("INSERT INTO stock_item_prices (item_id, price, valid_from, created_by, created_at) VALUES (1, 100, '2026-10-01', 1, 'x')").run();
    expect(() => s.prepare("INSERT INTO stock_item_prices (item_id, price, valid_from, created_by, created_at) VALUES (1, 200, '2026-10-01', 1, 'x')").run()).toThrow(/UNIQUE|PRIMARY/);
  });
});
```

Создайте `tests/server/stock-catalog.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const NOW = '2026-10-06T12:00:00.000Z'; // 17:00 по Алматы, сегодня 2026-10-06

async function setup(): Promise<{ w: OpsWorld; stock: string }> {
  w = await opsWorld(NOW);
  return { w, stock: `/api/v1/companies/${w.cid}/stock` };
}

describe('группы товаров', () => {
  it('создание, переименование, архив; название уникально без учёта регистра и «ё»', async () => {
    const { w, stock } = await setup();
    const g = (await w.post(`${stock}/groups`, { name: ' Напитки ' })).group;
    expect(g).toMatchObject({ name: 'Напитки', archivedAt: null });
    const dup = await w.h.req('POST', `${stock}/groups`, { name: 'НАПИТКИ' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('Такая группа уже есть');
    const renamed = await w.h.req('PATCH', `${stock}/groups/${g.id}`, { name: 'Еда' });
    expect(renamed.json().group.name).toBe('Еда');
    expect((await w.h.req('POST', `${stock}/groups/${g.id}/archive`)).json().group.archivedAt).not.toBeNull();
    const again = await w.h.req('POST', `${stock}/groups`, { name: 'еда' });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('ARCHIVED_DUPLICATE');
    expect((await w.h.req('POST', `${stock}/groups/${g.id}/unarchive`)).json().group.archivedAt).toBeNull();
    expect((await w.h.req('GET', `${stock}/groups`)).json().groups).toHaveLength(1);
    expect(w.h.auditCount('stock_group')).toBe(4);
  });
});

describe('товары', () => {
  it('создание: название очищается, цена продажи пишет первую строку истории с сегодняшней датой', async () => {
    const { w, stock } = await setup();
    const res = await w.h.req('POST', `${stock}/items`, { name: '  Кола   0,5 ', unit: 'pcs', salePrice: 50000, barcode: ' 4870000000011 ', minQty: 5000 });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item).toMatchObject({ name: 'Кола 0,5', unit: 'pcs', salePrice: 50000, barcode: '4870000000011', minQty: 5000, isCombo: false, archivedAt: null });
    expect(item.prices).toEqual([{ price: 50000, validFrom: '2026-10-06' }]);
    const free = (await w.post(`${stock}/items`, { name: 'Чипсы', unit: 'pcs' })).item;
    expect(free).toMatchObject({ salePrice: 0, prices: [], barcode: null, minQty: null, groupId: null });
  });

  it('название уникально в компании; архивный дубль предлагает вернуть из архива', async () => {
    const { w, stock } = await setup();
    const a = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs' })).item;
    const dup = await w.h.req('POST', `${stock}/items`, { name: 'кола 0,5', unit: 'pcs' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('Такой товар уже есть');
    await w.h.req('POST', `${stock}/items/${a.id}/archive`);
    const arch = await w.h.req('POST', `${stock}/items`, { name: 'Кола 0,5', unit: 'l' });
    expect(arch.statusCode).toBe(422);
    expect(arch.json().error.code).toBe('ARCHIVED_DUPLICATE');
  });

  it('проверки полей: единица, цена, минимальный остаток, группа чужой компании', async () => {
    const { w, stock } = await setup();
    const bad = await w.h.req('POST', `${stock}/items`, { name: 'X', unit: 'box', salePrice: -1, minQty: 0 });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields).sort()).toEqual(['minQty', 'salePrice', 'unit']);
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/stock/groups`, { name: 'Чужая' })).group.id as number;
    const res = await w.h.req('POST', `${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', groupId: foreign });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVARIANT_5');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/stock/items/${(await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs' })).item.id}`)).statusCode).toBe(404);
  });

  it('PATCH: название, группа, штрихкод, минимальный остаток; архивную группу можно только оставить', async () => {
    const { w, stock } = await setup();
    const g1 = (await w.post(`${stock}/groups`, { name: 'Напитки' })).group.id as number;
    const g2 = (await w.post(`${stock}/groups`, { name: 'Еда' })).group.id as number;
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', groupId: g1 })).item;
    const res = await w.h.req('PATCH', `${stock}/items/${item.id}`, { name: 'Кола 0,33', groupId: g2, barcode: '1', minQty: 3000 });
    expect(res.json().item).toMatchObject({ name: 'Кола 0,33', groupId: g2, barcode: '1', minQty: 3000 });
    await w.h.req('POST', `${stock}/groups/${g2}/archive`);
    expect((await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g2, barcode: '2' })).statusCode).toBe(200); // та же группа
    const moved = await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g1 });
    expect(moved.statusCode).toBe(200);
    const back = await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g2 });
    expect(back.statusCode).toBe(422);
    expect(back.json().error.code).toBe('ARCHIVED_REFERENCE');
    const noop = w.h.auditCount('stock_item', 'update');
    await w.h.req('PATCH', `${stock}/items/${item.id}`, { name: 'Кола 0,33' });
    expect(w.h.auditCount('stock_item', 'update')).toBe(noop); // без изменений история не пишется
  });

  it('удаление: товар без документов удаляется, архив и возврат работают', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 100 })).item;
    expect((await w.h.req('POST', `${stock}/items/${item.id}/archive`)).json().item.archivedAt).not.toBeNull();
    expect((await w.h.req('POST', `${stock}/items/${item.id}/unarchive`)).json().item.archivedAt).toBeNull();
    expect((await w.h.req('DELETE', `${stock}/items/${item.id}`)).statusCode).toBe(204);
    expect((await w.h.req('GET', `${stock}/items/${item.id}`)).statusCode).toBe(404);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_item_prices').get()).toEqual({ n: 0 });
  });
});

describe('история цены продажи (§3.1)', () => {
  it('новая цена с сегодняшней даты меняет текущую; на ту же дату — заменяет строку', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    let res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 60000, validFrom: '2026-10-06' });
    expect(res.json().item).toMatchObject({ salePrice: 60000, prices: [{ price: 60000, validFrom: '2026-10-06' }] });
    res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 65000, validFrom: '2026-10-06' });
    expect(res.json().item.prices).toEqual([{ price: 65000, validFrom: '2026-10-06' }]);
    expect(res.json().item.salePrice).toBe(65000);
  });

  it('цена задним числом остаётся в истории, текущая цена не меняется', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 40000, validFrom: '2026-09-01' });
    expect(res.json().item.salePrice).toBe(50000);
    expect(res.json().item.prices).toEqual([
      { price: 40000, validFrom: '2026-09-01' },
      { price: 50000, validFrom: '2026-10-06' },
    ]);
  });

  it('дата в будущем и неверная дата отклоняются; архивный товар — 422', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const future = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-07' });
    expect(future.statusCode).toBe(400);
    expect(future.json().error.fields.validFrom).toBe('Дата начала не может быть в будущем');
    expect((await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-02-30' })).statusCode).toBe(400);
    await w.h.req('POST', `${stock}/items/${item.id}/archive`);
    expect((await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-06' })).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('вторая такая же цена на ту же дату ничего не пишет', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const before = w.h.auditCount('stock_item', 'update');
    await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 50000, validFrom: '2026-10-06' });
    expect(w.h.auditCount('stock_item', 'update')).toBe(before);
  });
});

describe('архивная компания', () => {
  it('чтение разрешено, любая запись — 422 ARCHIVED_REFERENCE', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const group = (await w.post(`${stock}/groups`, { name: 'Напитки' })).group;
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    expect((await w.h.req('GET', `${stock}/items`)).statusCode).toBe(200);
    const writes: [string, string, unknown][] = [
      ['POST', `${stock}/items`, { name: 'Чипсы', unit: 'pcs' }],
      ['PATCH', `${stock}/items/${item.id}`, { barcode: '1' }],
      ['POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-06' }],
      ['POST', `${stock}/items/${item.id}/archive`, undefined],
      ['DELETE', `${stock}/items/${item.id}`, undefined],
      ['POST', `${stock}/groups`, { name: 'Еда' }],
      ['PATCH', `${stock}/groups/${group.id}`, { name: 'Еда' }],
      ['POST', `${stock}/warehouses`, { projectId: w.project, name: 'Бар' }],
    ];
    for (const [method, url, body] of writes) {
      const res = await w.h.req(method as 'POST', url, body);
      expect([res.statusCode, res.json().error.code], `${method} ${url}`).toEqual([422, 'ARCHIVED_REFERENCE']);
    }
  });
});
```

Создайте `tests/server/stock-warehouses.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

async function setup(): Promise<{ w: OpsWorld; stock: string }> {
  w = await opsWorld();
  return { w, stock: `/api/v1/companies/${w.cid}/stock` };
}

describe('склады', () => {
  it('склад создаётся у проекта; у проекта не больше одного', async () => {
    const { w, stock } = await setup();
    const res = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project, name: '  Бар   Клуб 1 ' });
    expect(res.statusCode).toBe(201);
    expect(res.json().warehouse).toMatchObject({ projectId: w.project, name: 'Бар Клуб 1', receiptsSource: 'manual', archivedAt: null, companyId: w.cid });
    const dup = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project, name: 'Второй' });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.fields.projectId).toBe('У проекта уже есть склад');
    expect((await w.h.req('GET', `${stock}/warehouses`)).json().warehouses).toHaveLength(1);
    expect(w.h.auditCount('stock_warehouse', 'create')).toBe(1);
  });

  it('проект чужой компании и архивный проект отклоняются', async () => {
    const { w, stock } = await setup();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const res = await w.h.req('POST', `${stock}/warehouses`, { projectId: foreign, name: 'Бар' });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_5']);
    await w.h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.project2}/archive`);
    const arch = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project2, name: 'Бар' });
    expect([arch.statusCode, arch.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
  });

  it('переименование и архив; склад другой компании не виден', async () => {
    const { w, stock } = await setup();
    const wh = (await w.post(`${stock}/warehouses`, { projectId: w.project, name: 'Бар' })).warehouse;
    expect((await w.h.req('PATCH', `${stock}/warehouses/${wh.id}`, { name: 'Бар 1' })).json().warehouse.name).toBe('Бар 1');
    expect((await w.h.req('POST', `${stock}/warehouses/${wh.id}/archive`)).json().warehouse.archivedAt).not.toBeNull();
    expect((await w.h.req('POST', `${stock}/warehouses/${wh.id}/unarchive`)).json().warehouse.archivedAt).toBeNull();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    expect((await w.h.req('PATCH', `/api/v1/companies/${other}/stock/warehouses/${wh.id}`, { name: 'X' })).statusCode).toBe(404);
    expect((await w.h.req('GET', `/api/v1/companies/${other}/stock/warehouses`)).json().warehouses).toEqual([]);
  });

  it('проект со складом нельзя удалить — только в архив', async () => {
    const { w, stock } = await setup();
    await w.post(`${stock}/warehouses`, { projectId: w.project2, name: 'Бар' });
    const res = await w.h.req('DELETE', `/api/v1/companies/${w.cid}/projects/${w.project2}`);
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_9']);
  });
});
```

Создайте `tests/shared/stock-price.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { priceAt } from '../../src/shared/stock-price';

describe('priceAt', () => {
  const history = [
    { price: 500, validFrom: '2026-09-01' },
    { price: 700, validFrom: '2026-10-01' },
    { price: 600, validFrom: '2026-09-15' },
  ];

  it('последняя строка с validFrom не позже даты, порядок строк не важен', () => {
    expect(priceAt(history, '2026-09-01')).toBe(500);
    expect(priceAt(history, '2026-09-14')).toBe(500);
    expect(priceAt(history, '2026-09-15')).toBe(600);
    expect(priceAt(history, '2026-09-30')).toBe(600);
    expect(priceAt(history, '2026-10-01')).toBe(700);
    expect(priceAt(history, '2027-01-01')).toBe(700);
  });

  it('до первой строки и без истории — 0', () => {
    expect(priceAt(history, '2026-08-31')).toBe(0);
    expect(priceAt([], '2026-10-01')).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/schema-0007.test.ts tests/server/stock-catalog.test.ts tests/server/stock-warehouses.test.ts tests/shared/stock-price.test.ts`
Expected: FAIL — файлы тестов:  4 failed (4) | тесты:  23 failed (23) (таблиц и маршрутов ещё нет).

- [ ] **Step 3: Write the implementation**

Создайте `src/server/modules/stock/catalog.ts`:

```ts
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { StockItemCreate, StockItemUpdate } from '../../../shared/schemas/stock';
import { foldCase } from '../../../shared/search';
import { priceAt, type PricePoint } from '../../../shared/stock-price';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { stockDocLines, stockItemGroups, stockItemPrices, stockItems } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type StockGroupRow = typeof stockItemGroups.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;

/** Товар с историей цены продажи (по возрастанию даты начала). */
export interface StockItemDto extends StockItemRow {
  prices: PricePoint[];
}

export interface StockCatalogService {
  groups(companyId: number): StockGroupRow[];
  addGroup(companyId: number, name: string, userId: number): StockGroupRow;
  renameGroup(companyId: number, id: number, name: string, userId: number): StockGroupRow;
  archiveGroup(companyId: number, id: number, userId: number): StockGroupRow;
  unarchiveGroup(companyId: number, id: number, userId: number): StockGroupRow;
  items(companyId: number): StockItemDto[];
  item(companyId: number, id: number): StockItemDto;
  addItem(companyId: number, input: StockItemCreate, userId: number): StockItemDto;
  updateItem(companyId: number, id: number, patch: StockItemUpdate, userId: number): StockItemDto;
  /** Новая цена продажи с даты `validFrom` (не позже сегодня): пишет историю и пересчитывает текущую цену. */
  setPrice(companyId: number, id: number, input: { price: number; validFrom: string }, userId: number): StockItemDto;
  archiveItem(companyId: number, id: number, userId: number): StockItemDto;
  unarchiveItem(companyId: number, id: number, userId: number): StockItemDto;
  /** Удаление — только товара без документов; иначе архив. */
  removeItem(companyId: number, id: number, userId: number): void;
}

/** Ключ уникальности названия: без учёта регистра, «ё» и невидимых символов. */
export function stockNameKey(name: string): string {
  return foldCase(cleanName(name));
}

export function createStockCatalogService(d: { db: Db; audit: AuditService; timezone: string; now?: () => Date }): StockCatalogService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const today = () => todayInTimezone(d.timezone, now());

  function requireGroup(companyId: number, id: number): StockGroupRow {
    const row = db.select().from(stockItemGroups).where(and(eq(stockItemGroups.id, id), eq(stockItemGroups.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Группа не найдена');
    return row;
  }

  function requireItem(companyId: number, id: number): StockItemRow {
    const row = db.select().from(stockItems).where(and(eq(stockItems.id, id), eq(stockItems.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
    return row;
  }

  function pricesOf(itemId: number): PricePoint[] {
    return db
      .select({ price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
      .from(stockItemPrices)
      .where(eq(stockItemPrices.itemId, itemId))
      .orderBy(asc(stockItemPrices.validFrom))
      .all();
  }

  function dto(row: StockItemRow): StockItemDto {
    return { ...row, prices: pricesOf(row.id) };
  }

  /** Название свободно в компании, включая архивные; архивный дубль — предложение вернуть его из архива. */
  function assertGroupNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db
      .select()
      .from(stockItemGroups)
      .where(and(eq(stockItemGroups.companyId, companyId), eq(stockItemGroups.nameKey, stockNameKey(name))))
      .get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Группа «${clash.name}» есть в архиве — верните её из архива`, { name: 'Такая группа есть в архиве' });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такая группа уже есть' });
  }

  function assertItemNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), eq(stockItems.nameKey, stockNameKey(name))))
      .get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Товар «${clash.name}» есть в архиве — верните его из архива`, { name: 'Такой товар есть в архиве' });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такой товар уже есть' });
  }

  /** Группа товара: из этой компании; архивную можно только оставить, а не выбрать заново. */
  function assertGroupChoice(companyId: number, groupId: number | null, current: number | null): void {
    if (groupId === null) return;
    const group = db.select().from(stockItemGroups).where(and(eq(stockItemGroups.id, groupId), eq(stockItemGroups.companyId, companyId))).get();
    if (!group) throw new AppError(422, 'INVARIANT_5', 'Группа не найдена в этой компании', { groupId: 'Группа не найдена в этой компании' });
    if (group.archivedAt && group.id !== current) throw new AppError(422, 'ARCHIVED_REFERENCE', `Группа «${group.name}» в архиве — выберите другую`);
  }

  function setGroupArchived(companyId: number, id: number, userId: number, archive: boolean): StockGroupRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireGroup(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(stockItemGroups).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockItemGroups.id, id)).returning().get();
      record({ companyId, userId, entity: 'stock_group', entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  function setItemArchived(companyId: number, id: number, userId: number, archive: boolean): StockItemDto {
    requireCompany(db, companyId, { writable: true });
    const row = requireItem(companyId, id);
    if ((row.archivedAt !== null) === archive) return dto(row);
    mutate(db, audit, (tx, record) => {
      tx.update(stockItems).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockItems.id, id)).run();
      record({ companyId, userId, entity: 'stock_item', entityId: id, action: archive ? 'archive' : 'unarchive', diff: { name: row.name } });
    });
    return dto(requireItem(companyId, id));
  }

  const svc: StockCatalogService = {
    groups(companyId) {
      requireCompany(db, companyId);
      return db.select().from(stockItemGroups).where(eq(stockItemGroups.companyId, companyId)).orderBy(asc(stockItemGroups.orderIndex), asc(stockItemGroups.id)).all();
    },

    addGroup(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(rawName);
      assertGroupNameFree(companyId, name);
      return mutate(
        db,
        audit,
        (tx, record) => {
          const next = tx
            .select({ m: sql<number>`coalesce(max(${stockItemGroups.orderIndex}), -1)` })
            .from(stockItemGroups)
            .where(eq(stockItemGroups.companyId, companyId))
            .get();
          const row = tx
            .insert(stockItemGroups)
            .values({ companyId, name, nameKey: stockNameKey(name), orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
            .returning()
            .get();
          record({ companyId, userId, entity: 'stock_group', entityId: row.id, action: 'create', diff: { name } });
          return row;
        },
        { behavior: 'immediate' },
      );
    },

    renameGroup(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireGroup(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Группа в архиве — сначала верните её из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      const name = changes.after.name!;
      assertGroupNameFree(companyId, name, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(stockItemGroups).set({ name, nameKey: stockNameKey(name) }).where(eq(stockItemGroups.id, id)).returning().get();
        record({ companyId, userId, entity: 'stock_group', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archiveGroup: (companyId, id, userId) => setGroupArchived(companyId, id, userId, true),
    unarchiveGroup: (companyId, id, userId) => setGroupArchived(companyId, id, userId, false),

    items(companyId) {
      requireCompany(db, companyId);
      const rows = db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).orderBy(asc(stockItems.nameKey), asc(stockItems.id)).all();
      const prices = db
        .select({ itemId: stockItemPrices.itemId, price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
        .from(stockItemPrices)
        .innerJoin(stockItems, eq(stockItems.id, stockItemPrices.itemId))
        .where(eq(stockItems.companyId, companyId))
        .orderBy(asc(stockItemPrices.validFrom))
        .all();
      const byItem = new Map<number, PricePoint[]>();
      for (const p of prices) byItem.set(p.itemId, [...(byItem.get(p.itemId) ?? []), { price: p.price, validFrom: p.validFrom }]);
      return rows.map((r) => ({ ...r, prices: byItem.get(r.id) ?? [] }));
    },

    item(companyId, id) {
      requireCompany(db, companyId);
      return dto(requireItem(companyId, id));
    },

    addItem(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(input.name);
      assertItemNameFree(companyId, name);
      assertGroupChoice(companyId, input.groupId, null);
      const id = mutate(
        db,
        audit,
        (tx, record) => {
          const t = now().toISOString();
          const row = tx
            .insert(stockItems)
            .values({
              companyId,
              name,
              nameKey: stockNameKey(name),
              groupId: input.groupId,
              unit: input.unit,
              barcode: input.barcode,
              salePrice: input.salePrice,
              minQty: input.minQty,
              createdAt: t,
            })
            .returning({ id: stockItems.id })
            .get();
          if (input.salePrice > 0) {
            tx.insert(stockItemPrices).values({ itemId: row.id, price: input.salePrice, validFrom: today(), createdBy: userId, createdAt: t }).run();
          }
          record({
            companyId,
            userId,
            entity: 'stock_item',
            entityId: row.id,
            action: 'create',
            diff: { name, unit: input.unit, groupId: input.groupId, barcode: input.barcode, salePrice: input.salePrice, minQty: input.minQty },
          });
          return row.id;
        },
        { behavior: 'immediate' },
      );
      return dto(requireItem(companyId, id));
    },

    updateItem(companyId, id, patch, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireItem(companyId, id);
      const wanted: Partial<Pick<StockItemRow, 'name' | 'groupId' | 'unit' | 'barcode' | 'minQty'>> = {};
      if (patch.name !== undefined) wanted.name = cleanName(patch.name);
      if (patch.groupId !== undefined) wanted.groupId = patch.groupId;
      if (patch.unit !== undefined) wanted.unit = patch.unit;
      if (patch.barcode !== undefined) wanted.barcode = patch.barcode;
      if (patch.minQty !== undefined) wanted.minQty = patch.minQty;
      const changes = changedFields(
        { name: before.name, groupId: before.groupId, unit: before.unit, barcode: before.barcode, minQty: before.minQty },
        wanted,
      );
      if (!changes) return dto(before);
      if (changes.after.name !== undefined) assertItemNameFree(companyId, changes.after.name, id);
      if (changes.after.groupId !== undefined) assertGroupChoice(companyId, changes.after.groupId, before.groupId);
      if (changes.after.unit !== undefined) {
        const used = db.select({ n: count() }).from(stockDocLines).where(eq(stockDocLines.itemId, id)).get()?.n ?? 0;
        if (used > 0) {
          throw new AppError(422, 'INVARIANT_9', 'По товару есть документы — единицу изменить нельзя', { unit: 'По товару есть документы' });
        }
      }
      mutate(db, audit, (tx, record) => {
        tx.update(stockItems)
          .set({ ...changes.after, ...(changes.after.name !== undefined ? { nameKey: stockNameKey(changes.after.name) } : {}) })
          .where(eq(stockItems.id, id))
          .run();
        record({ companyId, userId, entity: 'stock_item', entityId: id, action: 'update', diff: changes });
      });
      return dto(requireItem(companyId, id));
    },

    setPrice(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const item = requireItem(companyId, id);
      if (item.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — сначала верните его из архива`);
      const day = today();
      if (input.validFrom > day) {
        throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { validFrom: 'Дата начала не может быть в будущем' });
      }
      const history = pricesOf(id);
      if (history.some((p) => p.validFrom === input.validFrom && p.price === input.price)) return dto(item);
      mutate(
        db,
        audit,
        (tx, record) => {
          tx.insert(stockItemPrices)
            .values({ itemId: id, price: input.price, validFrom: input.validFrom, createdBy: userId, createdAt: now().toISOString() })
            .onConflictDoUpdate({ target: [stockItemPrices.itemId, stockItemPrices.validFrom], set: { price: input.price, createdBy: userId, createdAt: now().toISOString() } })
            .run();
          const next = priceAt(pricesOf(id), day);
          tx.update(stockItems).set({ salePrice: next }).where(eq(stockItems.id, id)).run();
          record({
            companyId,
            userId,
            entity: 'stock_item',
            entityId: id,
            action: 'update',
            diff: { before: { salePrice: item.salePrice }, after: { salePrice: next }, price: input.price, validFrom: input.validFrom },
          });
        },
        { behavior: 'immediate' },
      );
      return dto(requireItem(companyId, id));
    },

    archiveItem: (companyId, id, userId) => setItemArchived(companyId, id, userId, true),
    unarchiveItem: (companyId, id, userId) => setItemArchived(companyId, id, userId, false),

    removeItem(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireItem(companyId, id);
      const used = db.select({ n: count() }).from(stockDocLines).where(eq(stockDocLines.itemId, id)).get()?.n ?? 0;
      if (used > 0) throw new AppError(422, 'INVARIANT_9', 'По товару есть документы — его можно только перевести в архив');
      mutate(db, audit, (tx, record) => {
        tx.delete(stockItemPrices).where(eq(stockItemPrices.itemId, id)).run();
        tx.delete(stockItems).where(eq(stockItems.id, id)).run();
        record({ companyId, userId, entity: 'stock_item', entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
```

Создайте `src/server/modules/stock/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import {
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
  stockPriceSchema,
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockCatalogService } from './catalog';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService }): void {
  const { catalog, warehouses } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/groups`, async (req, reply) => {
    const { name } = stockGroupSchema.parse(req.body);
    return reply.status(201).send({ group: catalog.addGroup(parseId(req.params.cid), name, req.user!.id) });
  });

  app.patch<P>(`${BASE}/groups/:id`, async (req) => {
    const { name } = stockGroupSchema.parse(req.body);
    return { group: catalog.renameGroup(parseId(req.params.cid), parseId(req.params.id), name, req.user!.id) };
  });

  app.post<P>(`${BASE}/groups/:id/archive`, async (req) => ({
    group: catalog.archiveGroup(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/groups/:id/unarchive`, async (req) => ({
    group: catalog.unarchiveGroup(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  // ---- товары
  app.get<C>(`${BASE}/items`, async (req) => ({ items: catalog.items(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/items`, async (req, reply) => {
    const body = stockItemCreateSchema.parse(req.body);
    return reply.status(201).send({ item: catalog.addItem(parseId(req.params.cid), body, req.user!.id) });
  });

  app.get<P>(`${BASE}/items/:id`, async (req) => ({ item: catalog.item(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/items/:id`, async (req) => {
    const body = stockItemUpdateSchema.parse(req.body);
    return { item: catalog.updateItem(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id) };
  });

  app.post<P>(`${BASE}/items/:id/price`, async (req) => {
    const body = stockPriceSchema.parse(req.body);
    return { item: catalog.setPrice(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id) };
  });

  app.post<P>(`${BASE}/items/:id/archive`, async (req) => ({
    item: catalog.archiveItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/items/:id/unarchive`, async (req) => ({
    item: catalog.unarchiveItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.delete<P>(`${BASE}/items/:id`, async (req, reply) => {
    catalog.removeItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  // ---- склады
  app.get<C>(`${BASE}/warehouses`, async (req) => ({ warehouses: warehouses.list(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/warehouses`, async (req, reply) => {
    const body = stockWarehouseCreateSchema.parse(req.body);
    return reply.status(201).send({ warehouse: warehouses.create(parseId(req.params.cid), body, req.user!.id) });
  });

  app.patch<P>(`${BASE}/warehouses/:id`, async (req) => {
    const { name } = stockWarehouseUpdateSchema.parse(req.body);
    return { warehouse: warehouses.rename(parseId(req.params.cid), parseId(req.params.id), name, req.user!.id) };
  });

  app.post<P>(`${BASE}/warehouses/:id/archive`, async (req) => ({
    warehouse: warehouses.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/warehouses/:id/unarchive`, async (req) => ({
    warehouse: warehouses.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

Создайте `src/server/modules/stock/warehouses.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { projects, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type StockWarehouseRow = typeof stockWarehouses.$inferSelect;

export interface StockWarehousesService {
  list(companyId: number): StockWarehouseRow[];
  /** Склад проекта: у проекта не больше одного. */
  create(companyId: number, input: { projectId: number; name: string }, userId: number): StockWarehouseRow;
  rename(companyId: number, id: number, name: string, userId: number): StockWarehouseRow;
  archive(companyId: number, id: number, userId: number): StockWarehouseRow;
  unarchive(companyId: number, id: number, userId: number): StockWarehouseRow;
  /** Склад компании; 404, если его нет. */
  require(companyId: number, id: number): StockWarehouseRow;
}

export function createStockWarehousesService(d: { db: Db; audit: AuditService; now?: () => Date }): StockWarehousesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireRow(companyId: number, id: number): StockWarehouseRow {
    const row = db.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, id), eq(stockWarehouses.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Склад не найден');
    return row;
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): StockWarehouseRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(stockWarehouses).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockWarehouses.id, id)).returning().get();
      record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: archive ? 'archive' : 'unarchive', diff: { name: row.name } });
      return out;
    });
  }

  const svc: StockWarehousesService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db.select().from(stockWarehouses).where(eq(stockWarehouses.companyId, companyId)).orderBy(asc(stockWarehouses.id)).all();
    },

    require(companyId, id) {
      return requireRow(companyId, id);
    },

    create(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(input.name);
      const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).get();
      if (!project) throw new AppError(422, 'INVARIANT_5', 'Проект не найден в этой компании', { projectId: 'Проект не найден в этой компании' });
      if (project.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Проект «${project.name}» в архиве — выберите другой`);
      return mutate(
        db,
        audit,
        (tx, record) => {
          const clash = tx.select().from(stockWarehouses).where(eq(stockWarehouses.projectId, input.projectId)).get();
          if (clash) throw new AppError(422, 'VALIDATION', 'У проекта уже есть склад', { projectId: 'У проекта уже есть склад' });
          const row = tx
            .insert(stockWarehouses)
            .values({ companyId, projectId: input.projectId, name, createdAt: now().toISOString() })
            .returning()
            .get();
          record({ companyId, userId, entity: 'stock_warehouse', entityId: row.id, action: 'create', diff: { name, projectId: input.projectId } });
          return row;
        },
        { behavior: 'immediate' },
      );
    },

    rename(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(stockWarehouses).set({ name: changes.after.name! }).where(eq(stockWarehouses.id, id)).returning().get();
        record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),
  };
  return svc;
}
```

Создайте `src/shared/schemas/stock.ts`:

```ts
import { z } from 'zod';
import { isValidDate } from '../dates';
import { QTY_MAX, STOCK_UNITS } from '../stock-qty';
import { nameField } from '../text';
import { paidAt } from './operations';

export const STOCK_ITEM_NAME_MAX = 100;
export const STOCK_GROUP_NAME_MAX = 50;
export const STOCK_WAREHOUSE_NAME_MAX = 100;
export const STOCK_BARCODE_MAX = 40;
export const STOCK_DOC_LINES_MAX = 200;
export const STOCK_COMMENT_MAX = 2000;

/** Типы документов, которые доступны в плане «Склад-1»; перемещение и инвентаризация — «Склад-2». */
export const STOCK_DOC_TYPES = ['receipt', 'sale', 'writeoff'] as const;
export type StockDocType = (typeof STOCK_DOC_TYPES)[number];
export const STOCK_DOC_TYPE_LABELS: Record<StockDocType, string> = { receipt: 'Поступление', sale: 'Продажа', writeoff: 'Списание' };
/** Буква номера документа: «П-0001», «Р-0001», «С-0001». */
export const STOCK_DOC_PREFIX: Record<StockDocType, string> = { receipt: 'П', sale: 'Р', writeoff: 'С' };

export const WRITEOFF_REASONS = ['defect', 'spoiled', 'own_use', 'other'] as const;
export type WriteoffReason = (typeof WRITEOFF_REASONS)[number];
export const WRITEOFF_REASON_LABELS: Record<WriteoffReason, string> = {
  defect: 'Брак',
  spoiled: 'Испорчено',
  own_use: 'Для своих нужд',
  other: 'Другое',
};

const id = z.number().int().positive();
const money = z.number().int('Сумма — целое число минимальных единиц').min(0, 'Сумма не меньше нуля').max(Number.MAX_SAFE_INTEGER, 'Слишком большая сумма');
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .nullable()
    .transform((v) => v || null);

export const stockGroupSchema = z.object({ name: nameField(STOCK_GROUP_NAME_MAX) });

export const stockItemCreateSchema = z.object({
  name: nameField(STOCK_ITEM_NAME_MAX),
  groupId: id.nullable().default(null),
  unit: z.enum(STOCK_UNITS, { message: 'Выберите единицу' }),
  barcode: nullableText(STOCK_BARCODE_MAX).default(null),
  /** Цена продажи за единицу; больше нуля — пишет первую строку истории с сегодняшней даты. */
  salePrice: money.default(0),
  minQty: z.number().int().min(1, 'Больше нуля').max(QTY_MAX, 'Слишком большое количество').nullable().default(null),
});

export const stockItemUpdateSchema = z.object({
  name: nameField(STOCK_ITEM_NAME_MAX).optional(),
  groupId: id.nullable().optional(),
  unit: z.enum(STOCK_UNITS, { message: 'Выберите единицу' }).optional(),
  barcode: nullableText(STOCK_BARCODE_MAX).optional(),
  minQty: z.number().int().min(1, 'Больше нуля').max(QTY_MAX, 'Слишком большое количество').nullable().optional(),
});

export const stockPriceSchema = z.object({
  price: money,
  validFrom: z.string().refine(isValidDate, 'Неверная дата'),
});

export const stockWarehouseCreateSchema = z.object({
  projectId: id,
  name: nameField(STOCK_WAREHOUSE_NAME_MAX),
});

export const stockWarehouseUpdateSchema = z.object({ name: nameField(STOCK_WAREHOUSE_NAME_MAX) });

const docLine = z.object({
  itemId: id,
  qty: z.number().int('Количество — целое число тысячных долей').min(1, 'Количество больше нуля').max(QTY_MAX, 'Слишком большое количество'),
  /** У поступления — сумма закупки по строке, у продажи — сумма продажи; у списания не передаётся. */
  amount: money.nullable().default(null),
});
const docLines = z.array(docLine).min(1, 'Добавьте хотя бы одну строку').max(STOCK_DOC_LINES_MAX, `Не больше ${STOCK_DOC_LINES_MAX} строк`);
const docComment = nullableText(STOCK_COMMENT_MAX);

export const stockDocCreateSchema = z.object({
  type: z.enum(STOCK_DOC_TYPES, { message: 'Неверный тип документа' }),
  at: paidAt,
  warehouseId: id,
  counterpartyId: id.nullable().default(null),
  reason: z.enum(WRITEOFF_REASONS, { message: 'Неверная причина списания' }).nullable().default(null),
  comment: docComment.optional(),
  lines: docLines,
  /** Только посчитать последствия (§5.4): ничего не записывается. */
  dryRun: z.boolean().default(false),
});

export const stockDocUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  at: paidAt.optional(),
  warehouseId: id.optional(),
  counterpartyId: id.nullable().optional(),
  reason: z.enum(WRITEOFF_REASONS, { message: 'Неверная причина списания' }).nullable().optional(),
  comment: docComment.optional(),
  lines: docLines.optional(),
  dryRun: z.boolean().default(false),
});

export const stockDocListSchema = z.object({
  type: z.enum(STOCK_DOC_TYPES).optional(),
  warehouse: z.coerce.number().int().positive().optional(),
  from: z.string().refine(isValidDate, 'Неверная дата').optional(),
  to: z.string().refine(isValidDate, 'Неверная дата').optional(),
  limit: z.coerce.number().int().min(1, 'От 1 до 500').max(500, 'От 1 до 500').default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const stockBalanceSchema = z.object({
  warehouse: z.coerce.number().int().positive().optional(),
  /** Остаток на конец календарного дня; без даты — сейчас. */
  at: z.string().refine(isValidDate, 'Неверная дата').optional(),
});

export type StockItemCreate = z.output<typeof stockItemCreateSchema>;
export type StockItemUpdate = z.output<typeof stockItemUpdateSchema>;
export type StockDocCreate = z.output<typeof stockDocCreateSchema>;
export type StockDocUpdate = z.output<typeof stockDocUpdateSchema>;
export type StockDocList = z.output<typeof stockDocListSchema>;
```

Создайте `src/shared/stock-price.ts`:

```ts
/** Строка истории цены продажи (§3.1 спецификации «Склад»). */
export interface PricePoint {
  price: number;
  /** Календарная дата `YYYY-MM-DD`, с которой действует цена. */
  validFrom: string;
}

/** Цена на календарную дату: последняя строка с validFrom ≤ date; истории нет или она позже — 0. */
export function priceAt(prices: readonly PricePoint[], date: string): number {
  let best: PricePoint | null = null;
  for (const p of prices) {
    if (p.validFrom <= date && (best === null || p.validFrom > best.validFrom)) best = p;
  }
  return best ? best.price : 0;
}
```

В `src/server/app.ts` замените

```ts
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createSplitPresetsService } from './modules/split-presets/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
```

на

```ts
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockCatalogService } from './modules/stock/catalog';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
```

В `src/server/app.ts` замените

```ts
    journal: createJournal({ db, balances, timezone: config.timezone, now }),
    bulk: createBulkService({ db, operations }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
```

на

```ts
    journal: createJournal({ db, balances, timezone: config.timezone, now }),
    bulk: createBulkService({ db, operations }),
  });
  registerStockRoutes(app, {
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
```

В `src/server/db/schema.ts` замените

```ts
  },
  (t) => [index('saved_filters_owner_idx').on(t.userId, t.companyId)],
);
```

на

```ts
  },
  (t) => [index('saved_filters_owner_idx').on(t.userId, t.companyId)],
);

/* ---------- «Склад» (спецификация «Склад», §3) ---------- */

/** Группа товаров: «Напитки», «Еда». */
export const stockItemGroups = sqliteTable(
  'stock_item_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** foldCase(cleanName(name)): уникальность без учёта регистра, «ё» и невидимых символов. */
    nameKey: text('name_key').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('stock_item_groups_name_key_uq').on(t.companyId, t.nameKey)],
);

/** Товар каталога компании. Количества — тысячные доли единицы, деньги — минимальные единицы базовой валюты. */
export const stockItems = sqliteTable(
  'stock_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    groupId: integer('group_id').references(() => stockItemGroups.id),
    unit: text('unit', { enum: ['pcs', 'l', 'kg', 'pack'] }).notNull(),
    barcode: text('barcode'),
    isCombo: integer('is_combo', { mode: 'boolean' }).notNull().default(false),
    /** Текущая цена продажи за единицу: цена из stock_item_prices на сегодня. */
    salePrice: integer('sale_price').notNull().default(0),
    /** Минимальный остаток для предупреждения «Мало». */
    minQty: integer('min_qty'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('stock_items_name_key_uq').on(t.companyId, t.nameKey), index('stock_items_group_idx').on(t.groupId)],
);

/** История цены продажи: цена на момент t — последняя строка с valid_from ≤ t. */
export const stockItemPrices = sqliteTable(
  'stock_item_prices',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    price: integer('price').notNull(),
    /** Календарная дата `YYYY-MM-DD`. */
    validFrom: text('valid_from').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.validFrom] })],
);

/** Состав комплекта (план «Склад-2»). */
export const stockComboParts = sqliteTable(
  'stock_combo_parts',
  {
    comboId: integer('combo_id')
      .notNull()
      .references(() => stockItems.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    qty: integer('qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.comboId, t.itemId] })],
);

/** Склад проекта: у проекта не больше одного. */
export const stockWarehouses = sqliteTable(
  'stock_warehouses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    /** Откуда поступления (план «Склад-Senet»). */
    receiptsSource: text('receipts_source', { enum: ['manual', 'senet'] }).notNull().default('manual'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('stock_warehouses_project_uq').on(t.projectId), index('stock_warehouses_company_idx').on(t.companyId)],
);

/** Документ склада. Остатки меняются только документами; проведённые документы пересчитывают партии (§5.2). */
export const stockDocs = sqliteTable(
  'stock_docs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: ['receipt', 'sale', 'writeoff', 'transfer', 'count'] }).notNull(),
    /** «П-0001», «Р-0001», «С-0001»: по типу в компании. */
    number: text('number').notNull(),
    /** Момент документа, ISO UTC фиксированной ширины. */
    at: text('at').notNull(),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => stockWarehouses.id),
    toWarehouseId: integer('to_warehouse_id').references(() => stockWarehouses.id),
    /** Поставщик у поступления, покупатель у продажи. */
    counterpartyId: integer('counterparty_id').references(() => counterparties.id),
    reason: text('reason', { enum: ['defect', 'spoiled', 'own_use', 'other'] }),
    status: text('status', { enum: ['draft', 'posted'] }).notNull().default('posted'),
    source: text('source', { enum: ['manual', 'senet', 'import'] }).notNull().default('manual'),
    sourceRef: text('source_ref'),
    comment: text('comment'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('stock_docs_number_uq').on(t.companyId, t.number),
    uniqueIndex('stock_docs_source_uq').on(t.source, t.sourceRef),
    index('stock_docs_warehouse_idx').on(t.warehouseId, t.at),
    index('stock_docs_company_idx').on(t.companyId, t.type, t.at),
    index('stock_docs_counterparty_idx').on(t.counterpartyId),
  ],
);

export const stockDocLines = sqliteTable(
  'stock_doc_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    docId: integer('doc_id')
      .notNull()
      .references(() => stockDocs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    qty: integer('qty').notNull(),
    /** У поступления сумма закупки по строке, у продажи сумма продажи; у списания пусто. */
    amount: integer('amount'),
    countedQty: integer('counted_qty'),
    expectedQty: integer('expected_qty'),
  },
  (t) => [index('stock_doc_lines_doc_idx').on(t.docId, t.position), index('stock_doc_lines_item_idx').on(t.itemId)],
);

/** Партия: приход товара на склад одной строкой документа. Производные данные: пересобираются по документам. */
export const stockBatches = sqliteTable(
  'stock_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => stockWarehouses.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    originLineId: integer('origin_line_id')
      .notNull()
      .references(() => stockDocLines.id),
    sourceBatchId: integer('source_batch_id').references((): AnySQLiteColumn => stockBatches.id),
    at: text('at').notNull(),
    qtyIn: integer('qty_in').notNull(),
    costIn: integer('cost_in').notNull(),
    qtyLeft: integer('qty_left').notNull(),
    costLeft: integer('cost_left').notNull(),
  },
  (t) => [index('stock_batches_pair_idx').on(t.warehouseId, t.itemId, t.at), index('stock_batches_origin_idx').on(t.originLineId)],
);

/** Откуда списана строка продажи или списания; пустая партия — не хватило остатка (§5.3). */
export const stockAllocations = sqliteTable(
  'stock_allocations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lineId: integer('line_id')
      .notNull()
      .references(() => stockDocLines.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id').references(() => stockBatches.id),
    qty: integer('qty').notNull(),
    cost: integer('cost'),
    componentItemId: integer('component_item_id').references(() => stockItems.id),
  },
  (t) => [index('stock_allocations_line_idx').on(t.lineId), index('stock_allocations_batch_idx').on(t.batchId)],
);

/** Оплата закупки: расход журнала погашает поступление. Сумма оплат документа может превышать сумму документа (переплата). */
export const stockDocPayments = sqliteTable(
  'stock_doc_payments',
  {
    docId: integer('doc_id')
      .notNull()
      .references(() => stockDocs.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
    amount: integer('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.operationId] }), index('stock_doc_payments_op_idx').on(t.operationId)],
);

/** Продажа, проведённая доходом в журнал. */
export const stockDocPostings = sqliteTable(
  'stock_doc_postings',
  {
    docId: integer('doc_id')
      .primaryKey()
      .references(() => stockDocs.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
  },
  (t) => [index('stock_doc_postings_op_idx').on(t.operationId)],
);
```

В `src/server/modules/references/service.ts` замените

```ts
import { and, count, countDistinct, eq, isNull, min, or } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { operationLines, operations, operationTags } from '../../db/schema';

export type ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag';
```

на

```ts
import { and, count, countDistinct, eq, isNull, min, or } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { operationLines, operations, operationTags, stockDocs, stockWarehouses } from '../../db/schema';

export type ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag';
```

В `src/server/modules/references/service.ts` замените

```ts
              .get()?.n ?? 0
          );
        case 'counterparty':
          return db.select({ n: count() }).from(operations).where(eq(operations.counterpartyId, id)).get()?.n ?? 0;
        case 'category':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.categoryId, id)).get()?.n ?? 0;
        case 'project':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.projectId, id)).get()?.n ?? 0;
        case 'tag':
          return db.select({ n: count() }).from(operationTags).where(eq(operationTags.tagId, id)).get()?.n ?? 0;
      }
```

на

```ts
              .get()?.n ?? 0
          );
        case 'counterparty':
          // документы склада (поставщик, покупатель) ссылаются на контрагента так же, как операции
          return (db.select({ n: count() }).from(operations).where(eq(operations.counterpartyId, id)).get()?.n ?? 0) + (db.select({ n: count() }).from(stockDocs).where(eq(stockDocs.counterpartyId, id)).get()?.n ?? 0);
        case 'category':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.categoryId, id)).get()?.n ?? 0;
        case 'project':
          // склад проекта — тоже ссылка: проект со складом можно только перевести в архив
          return (db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.projectId, id)).get()?.n ?? 0) + (db.select({ n: count() }).from(stockWarehouses).where(eq(stockWarehouses.projectId, id)).get()?.n ?? 0);
        case 'tag':
          return db.select({ n: count() }).from(operationTags).where(eq(operationTags.tagId, id)).get()?.n ?? 0;
      }
```

В `src/shared/schemas/operations.ts` замените

```ts
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
/** ISO-дата и время с часовым поясом: без пояса момент зависел бы от часов сервера. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const paidAt = z
  .string()
  .refine((s) => ISO_RE.test(s) && isValidDate(s.slice(0, 10)) && !Number.isNaN(Date.parse(s)), 'Неверные дата и время оплаты');
const accrualDate = z.string().refine(isValidDate, 'Неверная дата').nullable();
```

на

```ts
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
/** ISO-дата и время с часовым поясом: без пояса момент зависел бы от часов сервера. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const paidAt = z
  .string()
  .refine((s) => ISO_RE.test(s) && isValidDate(s.slice(0, 10)) && !Number.isNaN(Date.parse(s)), 'Неверные дата и время оплаты');
const accrualDate = z.string().refine(isValidDate, 'Неверная дата').nullable();
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: `[✓] Your SQL migration file ➜ src\server\db\migrations\0007_<два слова>.sql`; появляются `meta/0007_snapshot.json` и запись в `meta/_journal.json`. Повторный запуск сообщает, что изменений нет.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test` и `npm run typecheck`.
Expected: `npm test` - 1150 пройдено и 1 пропущен, typecheck без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/server tests src/shared
git commit -m "feat: миграция 0007, каталог товаров, склады (Склад-1a, задача 2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Документы «Поступление», «Продажа», «Списание» и пересчёт (§3.3, §3.4, §5, §10)

**Files:**
- Create: `src/server/modules/stock/docs.ts`, `src/server/modules/stock/recalc.ts`
- Modify: `src/server/app.ts`, `src/server/modules/stock/routes.ts`
- Test: `tests/helpers/stock.ts` (новый), `tests/server/stock-docs.test.ts` (новый), `tests/server/stock-property.test.ts` (новый)

**Interfaces:**
- Consumes: из задачи 1 — `runFifo`, `FifoEvent`, `qtyError`, `formatQty`, `UNIT_LABELS`; из задачи 2 — таблицы, `stockDocCreateSchema`, `stockDocUpdateSchema`, `stockDocListSchema`, `registerStockRoutes`, `createStockWarehousesService`; `startOfDayUtc`, `addDays`, `formatDateRu`.
- Produces:
  - `Pair {warehouseId, itemId}`, `uniquePairs`, `storedSigs(tx, pair)`, `clearPair(tx, pair)`, `buildPair(tx, pair): {result, sigs}` (`recalc.ts`);
  - `createStockDocsService({db, audit, timezone, now})`: `list(companyId, q): {docs: StockDocListItem[]; hasMore}`, `get(companyId, id): StockDocDto`, `create(companyId, input, userId): DocSaveResult`, `update(companyId, id, patch, userId): DocSaveResult`, `remove(companyId, id, userId, {dryRun?}): DocSaveResult`;
  - `StockDocDto = row & {lines: {id, position, itemId, qty, amount|null, cost|null, uncovered}[]; total}`; `DocImpact {sales, writeoffs, since}`; `DocSaveResult {doc: StockDocDto | null; impact}`;
  - маршруты `GET docs?type=&warehouse=&from=&to=&limit=&offset=`, `GET docs/:id`, `POST docs`, `PATCH docs/:id`, `DELETE docs/:id[?dryRun=1]`; ошибка `INSUFFICIENT_STOCK` (422, `details {itemId, available, at}`);
  - `tests/helpers/stock.ts`: `stockWorld(now?)` — `OpsWorld` плюс `stock`, `wh`, `wh2`, `cola`, `chips`, `syrup`, `supplier`, `buyer`, `doc(body)`, `receipt(at, lines, extra?)`, `sale(...)`, `writeoff(...)`;
  - `references.countOperations('counterparty', id)` считает документы склада.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/helpers/stock.ts`:

```ts
import { opsWorld, type OpsWorld } from './ops';

export interface StockWorld extends OpsWorld {
  /** Базовый путь склада: /api/v1/companies/:cid/stock */
  stock: string;
  /** Склад проекта «Клуб 1». */
  wh: number;
  /** Склад проекта «Клуб 2». */
  wh2: number;
  /** «Кола 0,5», штуки. */
  cola: number;
  /** «Чипсы», штуки. */
  chips: number;
  /** «Сироп», литры. */
  syrup: number;
  /** Поставщик «Поставщик А». */
  supplier: number;
  /** Покупатель «Сотрудник А». */
  buyer: number;
  /** Создаёт документ склада и возвращает его; ошибка запроса — исключение. */
  doc(body: Record<string, unknown>): Promise<any>;
  /** Поступление на склад «Клуб 1»: lines — [товар, количество (тысячные), сумма]. */
  receipt(at: string, lines: [number, number, number][], extra?: Record<string, unknown>): Promise<any>;
  /** Продажа со склада «Клуб 1»: lines — [товар, количество (тысячные), сумма]. */
  sale(at: string, lines: [number, number, number][], extra?: Record<string, unknown>): Promise<any>;
  /** Списание со склада «Клуб 1»: lines — [товар, количество (тысячные)]. */
  writeoff(at: string, lines: [number, number][], extra?: Record<string, unknown>): Promise<any>;
}

/** Мир операций плюс склады обоих клубов, три товара, поставщик и покупатель. «Сейчас» — 2026-10-06 12:00 UTC. */
export async function stockWorld(now?: string): Promise<StockWorld> {
  const w = await opsWorld(now);
  const stock = `/api/v1/companies/${w.cid}/stock`;
  const wh = (await w.post(`${stock}/warehouses`, { projectId: w.project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const wh2 = (await w.post(`${stock}/warehouses`, { projectId: w.project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const item = async (name: string, unit: string, salePrice = 0) =>
    (await w.post(`${stock}/items`, { name, unit, salePrice })).item.id as number;
  const cola = await item('Кола 0,5', 'pcs', 50000);
  const chips = await item('Чипсы', 'pcs', 70000);
  const syrup = await item('Сироп', 'l');
  const supplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  const buyer = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'employee', name: 'Сотрудник А' })).counterparty.id as number;
  const doc = async (body: Record<string, unknown>) => (await w.post(`${stock}/docs`, body)).doc;
  return {
    ...w,
    stock,
    wh,
    wh2,
    cola,
    chips,
    syrup,
    supplier,
    buyer,
    doc,
    receipt: (at, lines, extra = {}) =>
      doc({ type: 'receipt', at, warehouseId: wh, counterpartyId: supplier, lines: lines.map(([itemId, qty, amount]) => ({ itemId, qty, amount })), ...extra }),
    sale: (at, lines, extra = {}) => doc({ type: 'sale', at, warehouseId: wh, lines: lines.map(([itemId, qty, amount]) => ({ itemId, qty, amount })), ...extra }),
    writeoff: (at, lines, extra = {}) =>
      doc({ type: 'writeoff', at, warehouseId: wh, reason: 'defect', lines: lines.map(([itemId, qty]) => ({ itemId, qty })), ...extra }),
  };
}
```

Создайте `tests/server/stock-docs.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const D4 = '2026-10-04T10:00:00.000Z';
const D5 = '2026-10-05T10:00:00.000Z';
const P = 'П'; // «П» — поступление
const R = 'Р'; // «Р» — продажа
const S = 'С'; // «С» — списание

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const rows = <T>(world: StockWorld, sql: string, ...args: unknown[]) => world.h.t.sqlite.prepare(sql).all(...args) as T[];
const state = (world: StockWorld, item: number) =>
  rows<{ qty_left: number; cost_left: number }>(world, 'SELECT qty_left, cost_left FROM stock_batches WHERE item_id = ? ORDER BY at, id', item).map((b) => [b.qty_left, b.cost_left]);

describe('документы: номера, создание, чтение', () => {
  it('номера по типу в компании: П-0001, Р-0001, С-0001; удалённый документ номер не освобождает', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const r2 = await w.receipt(D2, [[w.cola, 10_000, 120_000]]);
    const s1 = await w.sale(D3, [[w.cola, 1000, 50_000]]);
    const o1 = await w.writeoff(D3, [[w.cola, 1000]]);
    expect([r1.number, r2.number, s1.number, o1.number]).toEqual([`${P}-0001`, `${P}-0002`, `${R}-0001`, `${S}-0001`]);
    expect(await w.h.req('DELETE', `${w.stock}/docs/${r2.id}`)).toMatchObject({ statusCode: 200 });
    expect((await w.receipt(D3, [[w.cola, 1000, 1]])).number).toBe(`${P}-0003`);
    expect(r1).toMatchObject({ type: 'receipt', status: 'posted', source: 'manual', version: 1, warehouseId: w.wh, counterpartyId: w.supplier, total: 100_000 });
  });

  it('GET документ: строки с суммой, себестоимостью и «нет партии»', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 2000, 1000]]);
    const sale = await w.sale(D2, [[w.cola, 3000, 150_000]]);
    const got = (await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc;
    expect(got.total).toBe(150_000);
    expect(got.lines).toEqual([{ id: expect.any(Number), position: 0, itemId: w.cola, qty: 3000, amount: 150_000, cost: 1000, uncovered: 1000 }]);
    expect((await w.h.req('GET', `/api/v1/companies/${w.cid}/stock/docs/9999`)).statusCode).toBe(404);
  });

  it('список: фильтры по типу, складу и датам; новые сверху; итог и число строк', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 5000, 50_000]]);
    await w.sale(D3, [[w.cola, 1000, 50_000]]);
    await w.doc({ type: 'receipt', at: D2, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 9000 }] });
    const all = (await w.h.req('GET', `${w.stock}/docs`)).json();
    expect(all.docs.map((d: any) => d.number)).toEqual([`${R}-0001`, `${P}-0002`, `${P}-0001`]);
    expect(all.docs[2]).toMatchObject({ total: 150_000, linesCount: 2 });
    expect(all.hasMore).toBe(false);
    const q = async (query: string) => (await w!.h.req('GET', `${w!.stock}/docs?${query}`)).json().docs.map((d: any) => d.number);
    expect(await q('type=receipt')).toEqual([`${P}-0002`, `${P}-0001`]);
    expect(await q(`warehouse=${w.wh2}`)).toEqual([`${P}-0002`]);
    expect(await q('from=2026-10-02&to=2026-10-02')).toEqual([`${P}-0002`]);
    expect(await q('from=2026-10-02')).toEqual([`${R}-0001`, `${P}-0002`]);
    expect((await w.h.req('GET', `${w.stock}/docs?limit=2`)).json()).toMatchObject({ hasMore: true });
    expect((await w.h.req('GET', `${w.stock}/docs?limit=2&offset=2`)).json().docs).toHaveLength(1);
    expect((await w.h.req('GET', `${w.stock}/docs?type=transfer`)).statusCode).toBe(400);
  });

  it('история: создание документа пишется один раз', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 100]]);
    expect(w.h.auditCount('stock_doc', 'create')).toBe(1);
  });
});

describe('FIFO по документам (§5.2)', () => {
  it('продажа берёт из самых ранних партий; остаток партии и стоимость сходятся', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.receipt(D2, [[w.cola, 10_000, 150_000]]);
    const sale = await w.sale(D3, [[w.cola, 12_000, 600_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc.lines[0]).toMatchObject({ cost: 100_000 + 30_000, uncovered: 0 });
    expect(state(w, w.cola)).toEqual([[0, 0], [8000, 120_000]]);
    const allocs = rows<{ qty: number; cost: number }>(w, 'SELECT qty, cost FROM stock_allocations ORDER BY id');
    expect(allocs).toEqual([{ qty: 10_000, cost: 100_000 }, { qty: 2000, cost: 30_000 }]);
  });

  it('тиыны: три продажи по штуке из партии в 3 штуки за 1,00 — 0,33 + 0,33 + 0,34', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 100]]);
    const costs: number[] = [];
    for (const at of [D2, D3, D4]) {
      const s = await w.sale(at, [[w.cola, 1000, 50_000]]);
      costs.push((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost);
    }
    expect(costs).toEqual([33, 33, 34]);
    expect(state(w, w.cola)).toEqual([[0, 0]]);
  });

  it('пары независимы: другой товар и другой склад не влияют друг на друга', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 5000, 50_000], [w.chips, 5000, 90_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 5000, amount: 70_000 }] });
    const s = await w.sale(D2, [[w.cola, 2000, 100_000], [w.chips, 1000, 70_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines.map((l: any) => l.cost)).toEqual([20_000, 18_000]);
    expect(rows(w, 'SELECT warehouse_id w, item_id i, qty_left q FROM stock_batches ORDER BY warehouse_id, item_id')).toEqual([
      { w: w.wh, i: w.cola, q: 3000 },
      { w: w.wh, i: w.chips, q: 4000 },
      { w: w.wh2, i: w.cola, q: 5000 },
    ]);
  });

  it('ручное списание берёт по FIFO так же, как продажа, и не имеет суммы', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    const o = await w.writeoff(D2, [[w.cola, 1000]], { reason: 'spoiled' });
    expect(o).toMatchObject({ reason: 'spoiled', counterpartyId: null, total: 0 });
    expect((await w.h.req('GET', `${w.stock}/docs/${o.id}`)).json().doc.lines[0]).toMatchObject({ amount: null, cost: 10_000, uncovered: 0 });
  });
});

describe('нехватка остатка (§5.3)', () => {
  it('продажа без остатка проводится: строка «Нет партии», себестоимости нет', async () => {
    const w = await world();
    const s = await w.sale(D2, [[w.cola, 2000, 100_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 2000 });
    expect(rows(w, 'SELECT batch_id, qty, cost FROM stock_allocations')).toEqual([{ batch_id: null, qty: 2000, cost: null }]);
  });

  it('поступление с более ранней датой, введённое позже, закрывает долг продажи', async () => {
    const w = await world();
    const s = await w.sale(D3, [[w.cola, 2000, 100_000]]);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 5000, amount: 50_000 }] });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: 20_000, uncovered: 0 });
    expect(state(w, w.cola)).toEqual([[3000, 30_000]]);
  });

  it('поступление позже продажи долг не закрывает', async () => {
    const w = await world();
    const s = await w.sale(D2, [[w.cola, 2000, 100_000]]);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D3, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 5000, amount: 50_000 }] });
    expect(res.impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 2000 });
  });

  it('ручное списание без остатка — 422 с названием, остатком и датой; ничего не записано', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 2000, 20_000]]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'defect', lines: [{ itemId: w.cola, qty: 5000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 2 шт на 02.10.2026', details: { itemId: w.cola, available: 2000 } });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 1 }]);
    expect(state(w, w.cola)).toEqual([[2000, 20_000]]);
    // следующий номер не потерян откатом
    expect((await w.writeoff(D2, [[w.cola, 1000]])).number).toBe(`${S}-0001`);
  });

  it('списание литров показывает остаток с дробью', async () => {
    const w = await world();
    await w.receipt(D1, [[w.syrup, 1500, 3000]]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'spoiled', lines: [{ itemId: w.syrup, qty: 2000 }] });
    expect(res.json().error.message).toBe('Не хватает «Сироп»: на складе 1,5 л на 02.10.2026');
  });
});

describe('изменение прошлого (§5.4)', () => {
  it('поступление задним числом встаёт в начало и меняет себестоимость уже проданного; предупреждение со счётом продаж', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000]]);
    await w.receipt(D3, [[w.cola, 10_000, 300_000]]);
    const s = await w.sale(D4, [[w.cola, 12_000, 600_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(100_000 + 60_000);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 4000, amount: 400_000 }] });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    // теперь сначала 4 по 100,00, затем 8 по 10,00 (партия D2)
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(400_000 + 80_000);
    expect(state(w, w.cola)).toEqual([[0, 0], [2000, 20_000], [10_000, 300_000]]);
  });

  it('dryRun считает последствия и не пишет: ни документа, ни номера, ни истории', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 2000, 100_000]]);
    const before = w.h.auditCount('stock_doc');
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 999_000 }], dryRun: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 2 }]);
    expect(w.h.auditCount('stock_doc')).toBe(before);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(20_000);
    expect((await w.receipt(D4, [[w.cola, 1000, 1]])).number).toBe(`${P}-0002`);
  });

  it('удаление поступления, из которого уже продавали: продажа остаётся без партии, документ пропадает из списка', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D2, [[w.cola, 4000, 200_000]]);
    const probe = await w.h.req('DELETE', `${w.stock}/docs/${r.id}?dryRun=1`);
    expect(probe.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).json().doc.deletedAt).toBeNull();
    const del = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect(del.json().doc).toMatchObject({ version: 2 });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_batches')).toEqual([{ n: 0 }]);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs.map((d: any) => d.id)).toEqual([s.id]);
    // повторное удаление — без последствий и без второй записи в истории
    const again = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(again.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    expect(w.h.auditCount('stock_doc', 'delete')).toBe(1);
  });

  it('удаление поступления, из которого уже списали вручную, — 422, всё остаётся как было', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.writeoff(D2, [[w.cola, 4000]]);
    const res = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 0 шт на 02.10.2026' });
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).json().doc).toMatchObject({ deletedAt: null, version: 1 });
    expect(state(w, w.cola)).toEqual([[6000, 60_000]]);
  });

  it('удаление продажи возвращает партии на склад', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D2, [[w.cola, 4000, 200_000]]);
    expect(state(w, w.cola)).toEqual([[6000, 60_000]]);
    await w.h.req('DELETE', `${w.stock}/docs/${s.id}`);
    expect(state(w, w.cola)).toEqual([[10_000, 100_000]]);
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_allocations')).toEqual([{ n: 0 }]);
  });
});

describe('проверки документа (§10)', () => {
  const body = (w: StockWorld, over: Record<string, unknown>) => ({
    type: 'receipt',
    at: D1,
    warehouseId: w.wh,
    counterpartyId: w.supplier,
    lines: [{ itemId: w.cola, qty: 1000, amount: 100 }],
    ...over,
  });
  const post = (w: StockWorld, over: Record<string, unknown>) => w.h.req('POST', `${w.stock}/docs`, body(w, over));

  it('штуки — только целые; литры — до трёх знаков', async () => {
    const w = await world();
    const res = await post(w, { lines: [{ itemId: w.cola, qty: 1500, amount: 100 }] });
    expect([res.statusCode, res.json().error.fields]).toEqual([400, { 'lines.0.qty': 'Количество в штуках — целое' }]);
    expect((await post(w, { lines: [{ itemId: w.syrup, qty: 1500, amount: 100 }] })).statusCode).toBe(201);
    expect((await post(w, { lines: [{ itemId: w.syrup, qty: 0, amount: 100 }] })).statusCode).toBe(400);
  });

  it('суммы: у поступления и продажи обязательны, у списания их нет; причина — только у списания', async () => {
    const w = await world();
    expect((await post(w, { lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ 'lines.0.amount': 'Укажите сумму строки' });
    expect((await post(w, { type: 'sale', counterpartyId: null, lines: [{ itemId: w.cola, qty: 1000 }] })).statusCode).toBe(400);
    expect((await post(w, { type: 'writeoff', counterpartyId: null, reason: 'defect' })).json().error.fields).toEqual({ 'lines.0.amount': 'У списания нет суммы' });
    expect((await post(w, { type: 'writeoff', counterpartyId: null, lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ reason: 'Укажите причину списания' });
    expect((await post(w, { reason: 'defect' })).json().error.fields).toEqual({ reason: 'Причина — только у списания' });
    expect((await post(w, { type: 'writeoff', reason: 'defect', lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ counterpartyId: 'У списания нет контрагента' });
  });

  it('склад, товар и контрагент другой компании отклоняются; неизвестные поля и пустые строки — 400', async () => {
    const w = await world();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const proj = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const foreignWh = (await w.post(`/api/v1/companies/${other}/stock/warehouses`, { projectId: proj, name: 'Чужой' })).warehouse.id as number;
    expect((await post(w, { warehouseId: foreignWh })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { lines: [{ itemId: 99_999, qty: 1000, amount: 1 }] })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { counterpartyId: 99_999 })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { lines: [] })).statusCode).toBe(400);
    expect((await post(w, { type: 'transfer' })).statusCode).toBe(400);
    expect((await post(w, { at: '2026-10-01' })).statusCode).toBe(400);
  });

  it('дата в будущем по APP_TIMEZONE — 422; сегодняшняя можно', async () => {
    const w = await world();
    const future = await post(w, { at: '2026-10-07T00:00:00.000Z' });
    expect([future.statusCode, future.json().error.code]).toEqual([422, 'INVARIANT_6']);
    expect((await post(w, { at: '2026-10-06T11:59:00.000Z' })).statusCode).toBe(201);
  });

  it('архивный товар, склад и контрагент — только уже выбранные; новый выбор — 422', async () => {
    const w = await world();
    await w.h.req('POST', `${w.stock}/items/${w.chips}/archive`);
    const item = await post(w, { lines: [{ itemId: w.chips, qty: 1000, amount: 1 }] });
    expect([item.statusCode, item.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    expect((await post(w, { warehouseId: w.wh2 })).json().error.code).toBe('ARCHIVED_REFERENCE');
    await w.h.req('POST', `/api/v1/companies/${w.cid}/counterparties/${w.supplier}/archive`);
    expect((await post(w, {})).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('единицу товара с документами менять и сам товар удалять нельзя; контрагента и проект со складом — тоже', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 100]]);
    const unit = await w.h.req('PATCH', `${w.stock}/items/${w.cola}`, { unit: 'l' });
    expect([unit.statusCode, unit.json().error.fields]).toEqual([422, { unit: 'По товару есть документы' }]);
    expect((await w.h.req('PATCH', `${w.stock}/items/${w.chips}`, { unit: 'l' })).statusCode).toBe(200);
    expect((await w.h.req('DELETE', `${w.stock}/items/${w.cola}`)).json().error.code).toBe('INVARIANT_9');
    expect((await w.h.req('DELETE', `/api/v1/companies/${w.cid}/counterparties/${w.supplier}`)).json().error.code).toBe('INVARIANT_9');
  });
});

describe('архивная компания', () => {
  it('документы читаются, любая запись — 422 ARCHIVED_REFERENCE', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    expect((await w.h.req('GET', `${w.stock}/docs`)).statusCode).toBe(200);
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).statusCode).toBe(200);
    const writes: [string, string, unknown][] = [
      ['POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }] }],
      ['POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }], dryRun: true }],
      ['PATCH', `${w.stock}/docs/${r.id}`, { version: 1, comment: 'x' }],
      ['DELETE', `${w.stock}/docs/${r.id}`, undefined],
    ];
    for (const [method, url, payload] of writes) {
      const res = await w.h.req(method as 'POST', url, payload);
      expect([res.statusCode, res.json().error.code], `${method} ${url}`).toEqual([422, 'ARCHIVED_REFERENCE']);
    }
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 1 }]);
  });
});
```

Создайте `tests/server/stock-property.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { runFifo, type FifoEvent } from '../../src/shared/stock-fifo';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

/** Детерминированный генератор (mulberry32): последовательность воспроизводится по зерну. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Counts {
  n: number;
}

/** Инварианты §13: деньги и количество сходятся, остатки не отрицательны, база равна свежему пересчёту. */
function assertInvariants(world: StockWorld, label: string): void {
  const s = world.h.t.sqlite;
  const one = <T>(sql: string) => s.prepare(sql).get() as T;
  const purchased = one<{ v: number }>(
    "SELECT COALESCE(SUM(l.amount), 0) v FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.type = 'receipt' AND d.deleted_at IS NULL",
  ).v;
  const left = one<{ v: number }>('SELECT COALESCE(SUM(cost_left), 0) v FROM stock_batches').v;
  const taken = one<{ v: number }>('SELECT COALESCE(SUM(cost), 0) v FROM stock_allocations').v;
  expect(left + taken, `${label}: стоимость склада + себестоимость = закупки`).toBe(purchased);

  const qtyIn = one<{ v: number }>('SELECT COALESCE(SUM(qty_in), 0) v FROM stock_batches').v;
  const qtyLeft = one<{ v: number }>('SELECT COALESCE(SUM(qty_left), 0) v FROM stock_batches').v;
  const qtyTaken = one<{ v: number }>('SELECT COALESCE(SUM(qty), 0) v FROM stock_allocations WHERE batch_id IS NOT NULL').v;
  expect(qtyLeft + qtyTaken, `${label}: количество`).toBe(qtyIn);
  expect(one<Counts>('SELECT COUNT(*) n FROM stock_batches WHERE qty_left < 0 OR cost_left < 0 OR (qty_left = 0 AND cost_left <> 0)').n, `${label}: отрицательные остатки`).toBe(0);

  // у каждой живой строки списания части дают её количество, у удалённых документов нет ни партий, ни списаний
  const bad = s
    .prepare(
      `SELECT l.id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
        WHERE d.type IN ('sale', 'writeoff') AND d.deleted_at IS NULL
          AND l.qty <> (SELECT COALESCE(SUM(a.qty), 0) FROM stock_allocations a WHERE a.line_id = l.id)`,
    )
    .all();
  expect(bad, `${label}: части списания`).toEqual([]);
  expect(
    one<Counts>(
      `SELECT COUNT(*) n FROM stock_batches b JOIN stock_doc_lines l ON l.id = b.origin_line_id JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NOT NULL`,
    ).n,
    `${label}: партии удалённых`,
  ).toBe(0);
  expect(
    one<Counts>(
      `SELECT COUNT(*) n FROM stock_allocations a JOIN stock_doc_lines l ON l.id = a.line_id JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NOT NULL`,
    ).n,
    `${label}: списания удалённых`,
  ).toBe(0);

  // база равна независимому пересчёту по живым документам
  const lines = s
    .prepare(
      `SELECT l.id lineId, l.doc_id docId, l.position position, l.qty qty, l.amount amount, l.item_id itemId, d.warehouse_id warehouseId, d.type type, d.at at
         FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NULL`,
    )
    .all() as { lineId: number; docId: number; position: number; qty: number; amount: number | null; itemId: number; warehouseId: number; type: string; at: string }[];
  const pairs = new Map<string, FifoEvent[]>();
  for (const l of lines) {
    const key = `${l.warehouseId}:${l.itemId}`;
    const ev: FifoEvent =
      l.type === 'receipt'
        ? { kind: 'in', key: l.lineId, at: l.at, docId: l.docId, position: l.position, qty: l.qty, cost: l.amount ?? 0 }
        : { kind: 'out', key: l.lineId, at: l.at, docId: l.docId, position: l.position, qty: l.qty };
    pairs.set(key, [...(pairs.get(key) ?? []), ev]);
  }
  for (const [key, events] of pairs) {
    const fresh = runFifo(events);
    for (const o of fresh.outs.values()) {
      const stored = s.prepare('SELECT COALESCE(SUM(cost), 0) cost, COALESCE(SUM(CASE WHEN batch_id IS NULL THEN qty END), 0) unc FROM stock_allocations WHERE line_id = ?').get(o.key) as { cost: number; unc: number };
      expect([stored.cost, stored.unc], `${label}: строка ${o.key} пары ${key}`).toEqual([o.takes.reduce((a, t) => a + (t.cost ?? 0), 0), o.uncovered]);
    }
    const [wh, item] = key.split(':').map(Number);
    const storedLeft = (s.prepare('SELECT COALESCE(SUM(qty_left), 0) q, COALESCE(SUM(cost_left), 0) c FROM stock_batches WHERE warehouse_id = ? AND item_id = ?').get(wh, item) as { q: number; c: number });
    expect([storedLeft.q, storedLeft.c], `${label}: остаток пары ${key}`).toEqual([fresh.batches.reduce((a, b) => a + b.qtyLeft, 0), fresh.batches.reduce((a, b) => a + b.costLeft, 0)]);
  }
}

describe('случайные последовательности документов (§13)', () => {
  it('после любой последовательности создания, правки и удаления инварианты FIFO сохраняются', async () => {
    for (const seed of [11, 22, 33, 44]) {
      const world = await stockWorld('2026-10-06T12:00:00.000Z');
      w = world;
      const rand = rng(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
      const items = [world.cola, world.chips];
      const at = () => `2026-10-0${1 + Math.floor(rand() * 5)}T${String(8 + Math.floor(rand() * 10)).padStart(2, '0')}:00:00.000Z`;
      const lines = (withAmount: boolean) =>
        Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
          itemId: pick(items),
          qty: (1 + Math.floor(rand() * 6)) * 1000,
          ...(withAmount ? { amount: Math.floor(rand() * 50_000) } : {}),
        }));
      const live: { id: number; version: number; type: string }[] = [];
      let saved = 0;
      for (let step = 0; step < 45; step++) {
        const roll = rand();
        let res;
        const label = `seed ${seed} шаг ${step}`;
        if (roll < 0.3) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'receipt', at: at(), warehouseId: world.wh, lines: lines(true) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'receipt' });
        } else if (roll < 0.55) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'sale', at: at(), warehouseId: world.wh, lines: lines(true) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'sale' });
        } else if (roll < 0.65) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'writeoff', at: at(), warehouseId: world.wh, reason: 'defect', lines: lines(false) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'writeoff' });
        } else if (live.length > 0 && roll < 0.85) {
          const doc = pick(live);
          const withAmount = doc.type !== 'writeoff';
          res = await world.h.req('PATCH', `${world.stock}/docs/${doc.id}`, { version: doc.version, at: at(), lines: lines(withAmount) });
          if (res.statusCode === 200) doc.version += 1;
        } else if (live.length > 0) {
          const doc = pick(live);
          res = await world.h.req('DELETE', `${world.stock}/docs/${doc.id}`);
          if (res.statusCode === 200) live.splice(live.indexOf(doc), 1);
        } else continue;
        expect([200, 201, 422], `${label}: ${res.body}`).toContain(res.statusCode);
        if (res.statusCode !== 422) saved++;
        if (res.statusCode === 422) expect(res.json().error.code, label).toBe('INSUFFICIENT_STOCK');
        assertInvariants(world, label);
      }
      expect(saved, `seed ${seed}: последовательность не пустая`).toBeGreaterThan(20);
      await world.h.t.cleanup();
      w = null;
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/stock-docs.test.ts tests/server/stock-property.test.ts`
Expected: FAIL — файлы тестов:  2 failed (2) | тесты:  не запустились: нет импортируемого модуля (маршрутов документов ещё нет).

- [ ] **Step 3: Write the implementation**

Создайте `src/server/modules/stock/docs.ts`:

```ts
import { and, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { addDays, formatDateRu, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import {
  STOCK_DOC_PREFIX,
  type StockDocCreate,
  type StockDocList,
  type StockDocType,
  type StockDocUpdate,
  type WriteoffReason,
} from '../../../shared/schemas/stock';
import { formatQty, qtyError, UNIT_LABELS } from '../../../shared/stock-qty';
import type { Db, Executor } from '../../db/client';
import { counterparties, stockDocLines, stockDocs, stockItems, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;

export interface StockDocLineDto {
  id: number;
  position: number;
  itemId: number;
  qty: number;
  /** Сумма закупки (поступление) или продажи; у списания — null. */
  amount: number | null;
  /** Себестоимость строки продажи или списания по партиям; у поступления и у строки без партии — null. */
  cost: number | null;
  /** Сколько из строки не нашло партии (§5.3, «Нет партии»). */
  uncovered: number;
}

export interface StockDocDto extends StockDocRow {
  lines: StockDocLineDto[];
  /** Сумма строк (поступление, продажа); у списания 0. */
  total: number;
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
export interface DocImpact {
  sales: number;
  writeoffs: number;
  /** Момент правки (ISO): меньшая из старой и новой даты документа; null — чужие документы не затронуты. */
  since: string | null;
}

export interface DocSaveResult {
  /** null — пробный расчёт (`dryRun`): ничего не записано. */
  doc: StockDocDto | null;
  impact: DocImpact;
}

export interface StockDocsService {
  list(companyId: number, q: StockDocList): { docs: StockDocListItem[]; hasMore: boolean };
  get(companyId: number, id: number): StockDocDto;
  create(companyId: number, input: StockDocCreate, userId: number): DocSaveResult;
  update(companyId: number, id: number, patch: StockDocUpdate, userId: number): DocSaveResult;
  /** Мягкое удаление: остатки пересчитываются так, будто документа не было. */
  remove(companyId: number, id: number, userId: number, opts?: { dryRun?: boolean }): DocSaveResult;
}

interface Draft {
  type: StockDocType;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  lines: { itemId: number; qty: number; amount: number | null }[];
}

/** Пробный расчёт: исключение откатывает транзакцию и несёт результат. */
class DryRun extends Error {
  constructor(readonly impact: DocImpact) {
    super('dry run');
  }
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const NO_IMPACT: DocImpact = { sales: 0, writeoffs: 0, since: null };

export function createStockDocsService(d: { db: Db; audit: AuditService; timezone: string; now?: () => Date }): StockDocsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const dateOf = (iso: string) => todayInTimezone(d.timezone, new Date(iso));

  function requireRow(ex: Executor, companyId: number, id: number): StockDocRow {
    const row = ex.select().from(stockDocs).where(and(eq(stockDocs.id, id), eq(stockDocs.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Документ не найден');
    return row;
  }

  function dtoOf(ex: Executor, row: StockDocRow): StockDocDto {
    const lines = ex.select().from(stockDocLines).where(eq(stockDocLines.docId, row.id)).orderBy(stockDocLines.position).all();
    const sums = new Map<number, { cost: number | null; covered: number }>();
    if (lines.length > 0 && (row.type === 'sale' || row.type === 'writeoff')) {
      const rows = ex.all<{ lineId: number; cost: number | null; covered: number }>(sql`
        SELECT line_id AS lineId, SUM(cost) AS cost, COALESCE(SUM(CASE WHEN batch_id IS NOT NULL THEN qty END), 0) AS covered
          FROM stock_allocations WHERE line_id IN (${sql.join(lines.map((l) => sql`${l.id}`), sql`, `)}) GROUP BY line_id`);
      for (const r of rows) sums.set(r.lineId, { cost: r.cost, covered: r.covered });
    }
    const dtoLines: StockDocLineDto[] = lines.map((l) => {
      const s = sums.get(l.id);
      const out = row.type === 'sale' || row.type === 'writeoff';
      return {
        id: l.id,
        position: l.position,
        itemId: l.itemId,
        qty: l.qty,
        amount: l.amount,
        cost: out && s ? s.cost : null,
        uncovered: out ? l.qty - (s?.covered ?? 0) : 0,
      };
    });
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0) };
  }

  function draftOf(dto: StockDocDto): Draft {
    return {
      type: dto.type as StockDocType,
      at: dto.at,
      warehouseId: dto.warehouseId,
      counterpartyId: dto.counterpartyId,
      reason: dto.reason,
      comment: dto.comment,
      lines: dto.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, amount: l.amount })),
    };
  }

  /**
   * Правила документа (§10): склад, контрагент и товары — из этой компании; архивные — только уже выбранные в этом документе;
   * количество — по единице товара; суммы — у поступления и продажи, причина — у списания; дата не в будущем.
   */
  function check(ex: Executor, companyId: number, input: Draft, prev: Draft | null): Draft {
    const draft: Draft = { ...input, at: new Date(input.at).toISOString(), lines: input.lines.map((l) => ({ ...l })) };

    const wh = ex.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, draft.warehouseId), eq(stockWarehouses.companyId, companyId))).get();
    if (!wh) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { warehouseId: 'Склад не найден в этой компании' });
    if (wh.archivedAt && wh.id !== prev?.warehouseId) throw new AppError(422, 'ARCHIVED_REFERENCE', `Склад «${wh.name}» в архиве — выберите другой`);

    if (dateOf(draft.at) > todayInTimezone(d.timezone, now())) {
      throw new AppError(422, 'INVARIANT_6', 'Дата документа в будущем', { at: 'Дата документа в будущем' });
    }

    if (draft.type === 'writeoff') {
      if (draft.reason === null) throw invalid({ reason: 'Укажите причину списания' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У списания нет контрагента' });
    } else if (draft.reason !== null) {
      throw invalid({ reason: 'Причина — только у списания' });
    }

    if (draft.counterpartyId !== null) {
      const cp = ex
        .select()
        .from(counterparties)
        .where(and(eq(counterparties.id, draft.counterpartyId), eq(counterparties.companyId, companyId)))
        .get();
      if (!cp) throw new AppError(422, 'INVARIANT_5', 'Контрагент не найден в этой компании', { counterpartyId: 'Контрагент не найден в этой компании' });
      if (cp.archivedAt && cp.id !== prev?.counterpartyId) throw new AppError(422, 'ARCHIVED_REFERENCE', `Контрагент «${cp.name}» в архиве — выберите другого`);
    }

    const ids = [...new Set(draft.lines.map((l) => l.itemId))];
    const items = new Map(
      ex
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, ids)))
        .all()
        .map((i) => [i.id, i]),
    );
    const prevItems = new Set(prev?.lines.map((l) => l.itemId) ?? []);
    draft.lines.forEach((l, i) => {
      const item = items.get(l.itemId);
      if (!item) throw new AppError(422, 'INVARIANT_5', 'Товар не найден в этой компании', { [`lines.${i}.itemId`]: 'Товар не найден в этой компании' });
      if (item.archivedAt && !prevItems.has(item.id)) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — выберите другой`);
      const qtyProblem = qtyError(l.qty, item.unit);
      if (qtyProblem) throw invalid({ [`lines.${i}.qty`]: qtyProblem });
      if (draft.type === 'writeoff') {
        if (l.amount !== null) throw invalid({ [`lines.${i}.amount`]: 'У списания нет суммы' });
      } else if (l.amount === null) {
        throw invalid({ [`lines.${i}.amount`]: 'Укажите сумму строки' });
      }
    });
    return draft;
  }

  /** Номер по типу в компании: «П-0001», «Р-0001», «С-0001». Удалённые документы номер не освобождают. */
  function nextNumber(ex: Executor, companyId: number, type: StockDocType): string {
    const row = ex
      .select({ m: sql<number>`coalesce(max(cast(substr(${stockDocs.number}, 3) as integer)), 0)` })
      .from(stockDocs)
      .where(and(eq(stockDocs.companyId, companyId), eq(stockDocs.type, type)))
      .get();
    return `${STOCK_DOC_PREFIX[type]}-${String((row?.m ?? 0) + 1).padStart(4, '0')}`;
  }

  function insertLines(tx: Executor, docId: number, lines: Draft['lines']): void {
    lines.forEach((l, i) => {
      tx.insert(stockDocLines).values({ docId, position: i, itemId: l.itemId, qty: l.qty, amount: l.amount }).run();
    });
  }

  /**
   * Изменение документа с пересчётом (§5.2): до правки убираются партии и списания затронутых пар, затем меняются
   * строки, затем пары строятся заново по всем документам. Ручное списание, которому после правки не хватает остатка,
   * откатывает всю транзакцию ответом 422 (§5.3). Возвращает, у скольких чужих продаж и списаний изменилась себестоимость (§5.4).
   */
  function rebuild(tx: Executor, pairs: Pair[], docId: number, sinceAt: string, change: () => void): DocImpact {
    const touched = uniquePairs(pairs);
    const before = new Map<number, LineSig>();
    for (const p of touched) for (const [k, v] of storedSigs(tx, p)) before.set(k, v);
    for (const p of touched) clearPair(tx, p);
    change();
    const changed = { sale: new Set<number>(), writeoff: new Set<number>() };
    for (const p of touched) {
      const { result, sigs } = buildPair(tx, p);
      for (const s of sigs.values()) {
        if (s.type === 'writeoff' && s.uncovered > 0) {
          const item = tx.select().from(stockItems).where(eq(stockItems.id, p.itemId)).get()!;
          const available = result.outs.get(s.lineId)!.available;
          throw new AppError(
            422,
            'INSUFFICIENT_STOCK',
            `Не хватает «${item.name}»: на складе ${formatQty(available)} ${UNIT_LABELS[item.unit]} на ${formatDateRu(dateOf(s.at))}`,
            undefined,
            { itemId: item.id, available, at: s.at },
          );
        }
        const old = before.get(s.lineId);
        if (s.docId !== docId && old && (old.cost !== s.cost || old.uncovered !== s.uncovered)) changed[s.type].add(s.docId);
      }
    }
    const sales = changed.sale.size;
    const writeoffs = changed.writeoff.size;
    return sales + writeoffs === 0 ? NO_IMPACT : { sales, writeoffs, since: sinceAt };
  }

  /** Транзакция записи; пробный расчёт откатывается исключением DryRun. */
  function run(dryRun: boolean, fn: (tx: Executor, record: (entry: AuditEntry) => void) => DocSaveResult): DocSaveResult {
    try {
      return mutate(
        db,
        audit,
        (tx, record) => {
          const out = fn(tx, record);
          if (dryRun) throw new DryRun(out.impact);
          return out;
        },
        { behavior: 'immediate' },
      );
    } catch (e) {
      if (e instanceof DryRun) return { doc: null, impact: e.impact };
      throw e;
    }
  }

  const pairsOf = (draft: Pick<Draft, 'warehouseId' | 'lines'>): Pair[] => draft.lines.map((l) => ({ warehouseId: draft.warehouseId, itemId: l.itemId }));

  const svc: StockDocsService = {
    list(companyId, q) {
      requireCompany(db, companyId);
      const conds: SQL[] = [eq(stockDocs.companyId, companyId), isNull(stockDocs.deletedAt)];
      if (q.type) conds.push(eq(stockDocs.type, q.type));
      if (q.warehouse) conds.push(eq(stockDocs.warehouseId, q.warehouse));
      if (q.from) conds.push(gte(stockDocs.at, startOfDayUtc(q.from, d.timezone)));
      if (q.to) conds.push(lt(stockDocs.at, startOfDayUtc(addDays(q.to, 1), d.timezone)));
      const rows = db
        .select()
        .from(stockDocs)
        .where(and(...conds))
        .orderBy(desc(stockDocs.at), desc(stockDocs.id))
        .limit(q.limit + 1)
        .offset(q.offset)
        .all();
      const page = rows.slice(0, q.limit);
      const totals = new Map<number, { total: number; n: number }>();
      if (page.length > 0) {
        const agg = db.all<{ docId: number; total: number; n: number }>(sql`
          SELECT doc_id AS docId, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
            FROM stock_doc_lines WHERE doc_id IN (${sql.join(page.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY doc_id`);
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0 })),
        hasMore: rows.length > q.limit,
      };
    },

    get(companyId, id) {
      requireCompany(db, companyId);
      return dtoOf(db, requireRow(db, companyId, id));
    },

    create(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return run(input.dryRun, (tx, record) => {
        const draft = check(
          tx,
          companyId,
          {
            type: input.type,
            at: input.at,
            warehouseId: input.warehouseId,
            counterpartyId: input.counterpartyId,
            reason: input.reason,
            comment: input.comment ?? null,
            lines: input.lines,
          },
          null,
        );
        const t = now().toISOString();
        const number = nextNumber(tx, companyId, draft.type);
        const row = tx
          .insert(stockDocs)
          .values({
            companyId,
            type: draft.type,
            number,
            at: draft.at,
            warehouseId: draft.warehouseId,
            counterpartyId: draft.counterpartyId,
            reason: draft.reason,
            status: 'posted',
            source: 'manual',
            comment: draft.comment,
            createdBy: userId,
            createdAt: t,
            updatedAt: t,
            version: 1,
          })
          .returning()
          .get();
        const impact = rebuild(tx, pairsOf(draft), row.id, draft.at, () => insertLines(tx, row.id, draft.lines));
        record({ companyId, userId, entity: 'stock_doc', entityId: row.id, action: 'create', diff: { number, ...draft } });
        return { doc: dtoOf(tx, row), impact };
      });
    },

    update(companyId, id, patch, userId) {
      requireCompany(db, companyId, { writable: true });
      return run(patch.dryRun, (tx, record) => {
        const current = requireRow(tx, companyId, id);
        if (current.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Документ удалён — обновите страницу');
        if (patch.version !== current.version) throw new AppError(409, 'VERSION_CONFLICT', 'Документ изменён другим пользователем');
        if (current.type !== 'receipt' && current.type !== 'sale' && current.type !== 'writeoff') {
          throw new AppError(422, 'VALIDATION', 'Этот документ изменить нельзя');
        }
        const currentDto = dtoOf(tx, current);
        const prev = draftOf(currentDto);
        const next: Draft = {
          ...prev,
          ...(patch.at !== undefined ? { at: patch.at } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.counterpartyId !== undefined ? { counterpartyId: patch.counterpartyId } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
          ...(patch.lines !== undefined ? { lines: patch.lines } : {}),
        };
        const draft = check(tx, companyId, next, prev);
        const changes = changedFields(prev, draft);
        if (!changes) return { doc: currentDto, impact: NO_IMPACT };
        const sinceAt = draft.at < prev.at ? draft.at : prev.at;
        const impact = rebuild(tx, [...pairsOf(prev), ...pairsOf(draft)], id, sinceAt, () => {
          const updated = tx
            .update(stockDocs)
            .set({
              at: draft.at,
              warehouseId: draft.warehouseId,
              counterpartyId: draft.counterpartyId,
              reason: draft.reason,
              comment: draft.comment,
              updatedAt: now().toISOString(),
              version: current.version + 1,
            })
            .where(and(eq(stockDocs.id, id), eq(stockDocs.version, current.version)))
            .returning({ id: stockDocs.id })
            .get();
          if (!updated) throw new AppError(409, 'VERSION_CONFLICT', 'Документ изменён другим пользователем');
          tx.delete(stockDocLines).where(eq(stockDocLines.docId, id)).run();
          insertLines(tx, id, draft.lines);
        });
        record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'update', diff: { number: current.number, type: current.type, ...changes } });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
    },

    remove(companyId, id, userId, opts = {}) {
      requireCompany(db, companyId, { writable: true });
      return run(opts.dryRun === true, (tx, record) => {
        const current = requireRow(tx, companyId, id);
        if (current.deletedAt) return { doc: dtoOf(tx, current), impact: NO_IMPACT };
        const dto = dtoOf(tx, current);
        const impact = rebuild(tx, pairsOf(draftOf(dto)), id, current.at, () => {
          tx.update(stockDocs).set({ deletedAt: now().toISOString(), updatedAt: now().toISOString(), version: current.version + 1 }).where(eq(stockDocs.id, id)).run();
        });
        record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'delete', diff: { number: current.number, type: current.type, at: current.at, total: dto.total } });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
    },
  };
  return svc;
}
```

Создайте `src/server/modules/stock/recalc.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { runFifo, type FifoEvent, type FifoResult } from '../../../shared/stock-fifo';
import type { Executor } from '../../db/client';
import { stockAllocations, stockBatches } from '../../db/schema';

/** Пара (склад, товар): партии и списания считаются отдельно по каждой паре (§5.2). */
export interface Pair {
  warehouseId: number;
  itemId: number;
}

export const pairKey = (p: Pair): string => `${p.warehouseId}:${p.itemId}`;

/** Список пар без повторов. */
export function uniquePairs(pairs: readonly Pair[]): Pair[] {
  const seen = new Map<string, Pair>();
  for (const p of pairs) seen.set(pairKey(p), { warehouseId: p.warehouseId, itemId: p.itemId });
  return [...seen.values()];
}

/** Состояние строки списания (продажи, списания) пары: сколько себестоимости и сколько осталось без партии. */
export interface LineSig {
  lineId: number;
  docId: number;
  type: 'sale' | 'writeoff';
  at: string;
  qty: number;
  cost: number;
  uncovered: number;
}

interface PairRow {
  lineId: number;
  docId: number;
  position: number;
  type: string;
  at: string;
  qty: number;
  amount: number | null;
}

/** Строки пары из непомеченных удалёнными проведённых документов поступления, продажи и списания. */
function liveRows(tx: Executor, p: Pair): PairRow[] {
  return tx.all<PairRow>(sql`
    SELECT l.id AS lineId, l.doc_id AS docId, l.position AS position, d.type AS type, d.at AS at, l.qty AS qty, l.amount AS amount
      FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId}
       AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('receipt', 'sale', 'writeoff')`);
}

/** События пары для ядра FIFO. */
export function eventsOf(rows: readonly PairRow[]): FifoEvent[] {
  return rows.map((r) =>
    r.type === 'receipt'
      ? { kind: 'in', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty, cost: r.amount ?? 0 }
      : { kind: 'out', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty },
  );
}

/** Строки списания пары как они записаны в базе сейчас (до пересчёта): для подсчёта изменившихся продаж. */
export function storedSigs(tx: Executor, p: Pair): Map<number, LineSig> {
  const rows = tx.all<{ lineId: number; docId: number; type: 'sale' | 'writeoff'; at: string; qty: number; covered: number; cost: number }>(sql`
    SELECT l.id AS lineId, l.doc_id AS docId, d.type AS type, d.at AS at, l.qty AS qty,
           COALESCE(SUM(CASE WHEN a.batch_id IS NOT NULL THEN a.qty END), 0) AS covered,
           COALESCE(SUM(a.cost), 0) AS cost
      FROM stock_doc_lines l
      JOIN stock_docs d ON d.id = l.doc_id
      LEFT JOIN stock_allocations a ON a.line_id = l.id
     WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId}
       AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('sale', 'writeoff')
     GROUP BY l.id`);
  return new Map(rows.map((r) => [r.lineId, { lineId: r.lineId, docId: r.docId, type: r.type, at: r.at, qty: r.qty, cost: r.cost, uncovered: r.qty - r.covered }]));
}

/** Шаг 1: убрать партии и списания пары. Вызывается до изменения строк документов — на них ссылаются внешние ключи. */
export function clearPair(tx: Executor, p: Pair): void {
  tx.run(sql`
    DELETE FROM stock_allocations
     WHERE line_id IN (SELECT l.id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId})
        OR batch_id IN (SELECT id FROM stock_batches WHERE warehouse_id = ${p.warehouseId} AND item_id = ${p.itemId})`);
  tx.delete(stockBatches).where(and(eq(stockBatches.warehouseId, p.warehouseId), eq(stockBatches.itemId, p.itemId))).run();
}

const CHUNK = 400;

/** Шаг 2: построить партии и списания пары по документам (§5.2) и записать их. */
export function buildPair(tx: Executor, p: Pair): { result: FifoResult; sigs: Map<number, LineSig> } {
  const rows = liveRows(tx, p);
  const result = runFifo(eventsOf(rows));
  const byLine = new Map(rows.map((r) => [r.lineId, r]));
  const batchIds = new Map<number, number>();
  for (const b of result.batches) {
    const row = tx
      .insert(stockBatches)
      .values({
        warehouseId: p.warehouseId,
        itemId: p.itemId,
        originLineId: b.key,
        sourceBatchId: null,
        at: b.at,
        qtyIn: b.qtyIn,
        costIn: b.costIn,
        qtyLeft: b.qtyLeft,
        costLeft: b.costLeft,
      })
      .returning({ id: stockBatches.id })
      .get();
    batchIds.set(b.key, row.id);
  }
  const values: (typeof stockAllocations.$inferInsert)[] = [];
  const sigs = new Map<number, LineSig>();
  for (const o of result.outs.values()) {
    const line = byLine.get(o.key)!;
    let cost = 0;
    for (const t of o.takes) {
      values.push({ lineId: o.key, batchId: t.batchKey === null ? null : batchIds.get(t.batchKey)!, qty: t.qty, cost: t.cost });
      cost += t.cost ?? 0;
    }
    sigs.set(o.key, { lineId: o.key, docId: line.docId, type: line.type as 'sale' | 'writeoff', at: line.at, qty: line.qty, cost, uncovered: o.uncovered });
  }
  for (let i = 0; i < values.length; i += CHUNK) tx.insert(stockAllocations).values(values.slice(i, i + CHUNK)).run();
  return { result, sigs };
}
```

В `src/server/app.ts` замените

```ts
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockCatalogService } from './modules/stock/catalog';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
```

на

```ts
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
```

В `src/server/app.ts` замените

```ts
  registerStockRoutes(app, {
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

на

```ts
  registerStockRoutes(app, {
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

В `src/server/modules/stock/routes.ts` замените

```ts
import type { FastifyInstance } from 'fastify';
import {
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
```

на

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  stockDocCreateSchema,
  stockDocListSchema,
  stockDocUpdateSchema,
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
```

В `src/server/modules/stock/routes.ts` замените

```ts
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockCatalogService } from './catalog';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService }): void {
  const { catalog, warehouses } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

на

```ts
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService }): void {
  const { catalog, warehouses, docs } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

В `src/server/modules/stock/routes.ts` замените

```ts
  app.post<P>(`${BASE}/warehouses/:id/unarchive`, async (req) => ({
    warehouse: warehouses.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

на

```ts
  app.post<P>(`${BASE}/warehouses/:id/unarchive`, async (req) => ({
    warehouse: warehouses.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  // ---- документы
  app.get<C>(`${BASE}/docs`, async (req) => docs.list(parseId(req.params.cid), stockDocListSchema.parse(req.query)));

  app.get<P>(`${BASE}/docs/:id`, async (req) => ({ doc: docs.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.post<C>(`${BASE}/docs`, async (req, reply) => {
    const body = stockDocCreateSchema.parse(req.body);
    const out = docs.create(parseId(req.params.cid), body, req.user!.id);
    return reply.status(body.dryRun ? 200 : 201).send(out);
  });

  app.patch<P>(`${BASE}/docs/:id`, async (req) => {
    const body = stockDocUpdateSchema.parse(req.body);
    return docs.update(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id);
  });

  // ?dryRun=1 — только последствия, документ остаётся
  app.delete<P>(`${BASE}/docs/:id`, async (req) => {
    const { dryRun } = z.object({ dryRun: z.enum(['1', '0']).optional() }).parse(req.query);
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` и `npm run typecheck`.
Expected: `npm test` - 1176 пройдено и 1 пропущен, typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server tests
git commit -m "feat: документы склада, FIFO-пересчёт, последствия правки (Склад-1a, задача 3)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Остатки, стоимость складов, правка документов и 409 (§4.1, §4.4, §5.4, §11)

**Files:**
- Create: `src/server/modules/stock/balance.ts`
- Modify: `src/server/app.ts`, `src/server/modules/stock/routes.ts`
- Test: `tests/server/stock-balance.test.ts` (новый), `tests/server/stock-docs-update.test.ts` (новый)

**Interfaces:**
- Consumes: из задач 1–3 — `runFifo`, таблицы, `createStockDocsService`, `stockWorld`, `stockBalanceSchema`.
- Produces:
  - `createStockBalanceService({db, timezone, now})`: `balance(companyId, {warehouse?, at?}): {warehouseId, at, items: BalanceItem[], total}`, `value(companyId): {warehouses: {warehouseId, projectId, name, value}[]; total}`;
  - `BalanceItem {itemId, qty, qtyLeft, deficit, cost, avgCost|null, salePrice, markupBp|null, low, batches: {lineId, docId, docNumber, warehouseId, counterpartyId, at, qtyIn, costIn, qtyLeft, costLeft}[]}`;
  - маршруты `GET balance?warehouse=&at=`, `GET value`; `registerStockRoutes` получает `balance`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/stock-balance.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const D4 = '2026-10-04T10:00:00.000Z';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const balance = async (world: StockWorld, query = '') => (await world.h.req('GET', `${world.stock}/balance${query}`)).json();
const itemRow = (b: any, id: number) => b.items.find((i: any) => i.itemId === id);

describe('остатки', () => {
  it('товар: остаток, стоимость, средняя закупка, наценка и партии с номером документа и поставщиком', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 10_000, 100_000]]); // 10,00 за шт
    await w.receipt(D2, [[w.cola, 10_000, 150_000]]); // 15,00 за шт
    await w.sale(D3, [[w.cola, 12_000, 600_000]]);
    const b = await balance(w);
    expect(itemRow(b, w.cola)).toMatchObject({
      qty: 8000,
      qtyLeft: 8000,
      deficit: 0,
      cost: 120_000,
      avgCost: 15_000,
      salePrice: 50_000,
      markupBp: 23_333, // (500 \u2212 150) / 150 = 233,33 %
      low: false,
    });
    expect(itemRow(b, w.cola).batches).toEqual([
      { lineId: expect.any(Number), docId: expect.any(Number), docNumber: 'П-0002', warehouseId: w.wh, counterpartyId: w.supplier, at: D2, qtyIn: 10_000, costIn: 150_000, qtyLeft: 8000, costLeft: 120_000 },
    ]);
    expect(b.total).toBe(120_000);
    expect(r1.number).toBe('П-0001');
    // товары без движения тоже в списке, с нулями
    expect(itemRow(b, w.chips)).toMatchObject({ qty: 0, cost: 0, avgCost: null, markupBp: null, batches: [] });
  });

  it('продажа без партии: остаток отрицательный, «Нет партии» через deficit', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 10_000]]);
    await w.sale(D2, [[w.cola, 3000, 150_000]]);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: -2000, qtyLeft: 0, deficit: 2000, cost: 0, avgCost: null });
    // долг закрывается поступлением с более ранней датой
    await w.receipt(D1, [[w.cola, 5000, 50_000]]);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: 3000, deficit: 0, cost: 30_000 });
  });

  it('«Мало»: остаток ниже минимального, в том числе нулевой и отрицательный', async () => {
    const w = await world();
    await w.h.req('PATCH', `${w.stock}/items/${w.cola}`, { minQty: 5000 });
    await w.receipt(D1, [[w.cola, 6000, 60_000]]);
    expect(itemRow(await balance(w), w.cola).low).toBe(false);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    expect(itemRow(await balance(w), w.cola).low).toBe(true);
    expect(itemRow(await balance(w), w.chips).low).toBe(false); // минимум не задан
  });

  it('склад: отбор по складу и сумма по всем', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 6000, amount: 90_000 }] });
    const all = await balance(w);
    expect([itemRow(all, w.cola).qty, itemRow(all, w.cola).cost, itemRow(all, w.cola).batches.length, all.total]).toEqual([10_000, 130_000, 2, 130_000]);
    const one = await balance(w, `?warehouse=${w.wh2}`);
    expect([itemRow(one, w.cola).qty, one.total, one.warehouseId]).toEqual([6000, 90_000, w.wh2]);
  });

  it('на дату: состояние на конец дня и цена продажи на ту дату', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D3, [[w.cola, 4000, 200_000]]);
    await w.h.req('POST', `${w.stock}/items/${w.cola}/price`, { price: 40_000, validFrom: '2026-09-01' });
    await w.h.req('POST', `${w.stock}/items/${w.cola}/price`, { price: 55_000, validFrom: '2026-10-03' });
    // история цены: 40,00 с 01.09, 500,00 с 06.10 (первая цена товара), 55,00 с 03.10
    const day2 = await balance(w, '?at=2026-10-02');
    expect(itemRow(day2, w.cola)).toMatchObject({ qty: 10_000, cost: 100_000, salePrice: 40_000 });
    expect(day2.at).toBe('2026-10-02');
    // продажа 3-го по UTC в 10:00 — это 15:00 по Алматы того же дня: конец дня 3-го её включает
    expect(itemRow(await balance(w, '?at=2026-10-03'), w.cola)).toMatchObject({ qty: 6000, cost: 60_000, salePrice: 55_000 });
    expect(itemRow(await balance(w, '?at=2026-09-30'), w.cola)).toMatchObject({ qty: 0, cost: 0, salePrice: 40_000 });
    expect(itemRow(await balance(w, '?at=2026-08-31'), w.cola)).toMatchObject({ qty: 0, salePrice: 0 });
    expect((await w.h.req('GET', `${w.stock}/balance?at=2026-13-01`)).statusCode).toBe(400);
  });

  it('архивный товар виден, только пока есть остаток или долг', async () => {
    const w = await world();
    await w.receipt(D1, [[w.chips, 1000, 10_000]]);
    await w.h.req('POST', `${w.stock}/items/${w.cola}/archive`);
    expect(itemRow(await balance(w), w.cola)).toBeUndefined();
    await w.h.req('POST', `${w.stock}/items/${w.chips}/archive`);
    expect(itemRow(await balance(w), w.chips)).toMatchObject({ qty: 1000 });
  });

  it('удалённые документы в остатки не входят', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: 0, cost: 0, batches: [] });
  });
});

describe('стоимость складов и левая панель (§4.4)', () => {
  it('стоимость по складам = сумма остатков партий; архивный склад не показывается', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.chips, qty: 1000, amount: 7777 }] });
    const v = (await w.h.req('GET', `${w.stock}/value`)).json();
    expect(v).toEqual({
      warehouses: [
        { warehouseId: w.wh, projectId: w.project, name: 'Бар Клуб 1', value: 80_000 },
        { warehouseId: w.wh2, projectId: w.project2, name: 'Бар Клуб 2', value: 7777 },
      ],
      total: 87_777,
    });
    expect(v.total).toBe((await balance(w)).total); // сохранённые партии и расчёт по документам сходятся
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    expect((await w.h.req('GET', `${w.stock}/value`)).json().total).toBe(80_000);
  });

  it('склад не входит в «Всего на счетах» и не меняет балансы счетов', async () => {
    const w = await world();
    const before = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    const after = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    expect(after).toEqual(before);
    expect(after.total.amount).toBe(0);
    expect((await w.h.req('GET', `${w.stock}/value`)).json().total).toBe(80_000);
  });
});
```

Создайте `tests/server/stock-docs-update.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const D4 = '2026-10-04T10:00:00.000Z';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const patch = (world: StockWorld, id: number, body: Record<string, unknown>) => world.h.req('PATCH', `${world.stock}/docs/${id}`, body);
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const rows = <T>(world: StockWorld, sql: string, ...args: unknown[]) => world.h.t.sqlite.prepare(sql).all(...args) as T[];

describe('правка документа: версия и 409', () => {
  it('правка увеличивает версию и пишет историю с изменёнными полями', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const res = await patch(w, r.id, { version: 1, comment: ' пересчитали ', lines: [{ itemId: w.cola, qty: 8000, amount: 96_000 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc).toMatchObject({ version: 2, comment: 'пересчитали', total: 96_000, lines: [{ qty: 8000, amount: 96_000 }] });
    expect(res.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    const audit = rows<{ diff: string }>(w, "SELECT diff FROM audit_log WHERE entity = 'stock_doc' AND action = 'update'");
    expect(audit).toHaveLength(1);
    const diff = JSON.parse(audit[0]!.diff);
    expect(diff.after.comment).toBe('пересчитали');
    expect(diff.before.lines).toEqual([{ itemId: w.cola, qty: 10_000, amount: 100_000 }]);
  });

  it('две вкладки: вторая правка со старой версией — 409, документ остаётся как после первой', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const first = await patch(w, r.id, { version: 1, comment: 'первая вкладка' });
    expect(first.statusCode).toBe(200);
    const second = await patch(w, r.id, { version: 1, comment: 'вторая вкладка' });
    expect([second.statusCode, second.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect(await getDoc(w, r.id)).toMatchObject({ comment: 'первая вкладка', version: 2 });
    expect(w.h.auditCount('stock_doc', 'update')).toBe(1);
  });

  it('удалённый документ править нельзя — 409', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    const res = await patch(w, r.id, { version: 2, comment: 'x' });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
  });

  it('те же значения — без записи: версия и история прежние', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]], { comment: 'тот же' });
    const res = await patch(w, r.id, { version: 1, comment: 'тот же', at: D1, counterpartyId: w.supplier, lines: [{ itemId: w.cola, qty: 1000, amount: 100 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.version).toBe(1);
    expect(w.h.auditCount('stock_doc', 'update')).toBe(0);
  });

  it('чужая компания — 404; тип документа не меняется; неверная версия и пустая правка — 400', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    expect((await w.h.req('PATCH', `/api/v1/companies/${other}/stock/docs/${r.id}`, { version: 1, comment: 'x' })).statusCode).toBe(404);
    expect((await patch(w, r.id, { comment: 'без версии' })).statusCode).toBe(400);
    await patch(w, r.id, { version: 1, type: 'sale', comment: 'тип игнорируется' });
    expect((await getDoc(w, r.id)).type).toBe('receipt');
  });
});

describe('правка прошлого: пересчёт последующих продаж (§5.4)', () => {
  it('сумма закупки и дата поступления меняют себестоимость продажи; в ответе — сколько продаж затронуто', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 4000, 200_000]]);
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(40_000);
    const cost = await patch(w, r.id, { version: 1, lines: [{ itemId: w.cola, qty: 10_000, amount: 200_000 }] });
    expect(cost.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(80_000);
    // перенос поступления на дату после продажи — продажа остаётся без партии
    const moved = await patch(w, r.id, { version: 2, at: D4 });
    expect(moved.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 }); // с меньшей из старой и новой дат
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    // и обратно
    await patch(w, r.id, { version: 3, at: D2 });
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: 80_000, uncovered: 0 });
  });

  it('перенос самой продажи на дату после поступления закрывает долг', async () => {
    const w = await world();
    await w.receipt(D3, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D1, [[w.cola, 4000, 200_000]]);
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    const res = await patch(w, s.id, { version: 1, at: D4 });
    expect(res.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null }); // чужих продаж нет — предупреждать не о чём
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: 40_000, uncovered: 0 });
  });

  it('предупреждение считает и списания; продажа с несколькими изменившимися строками — одна', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000], [w.chips, 10_000, 100_000]]);
    await w.writeoff(D3, [[w.cola, 1000]]);
    await w.sale(D3, [[w.cola, 1000, 50_000], [w.chips, 1000, 50_000]]);
    const res = await w.post(`${w.stock}/docs`, {
      type: 'receipt',
      at: D1,
      warehouseId: w.wh,
      lines: [{ itemId: w.cola, qty: 2000, amount: 180_000 }, { itemId: w.chips, qty: 1000, amount: 90_000 }],
    });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 1, since: D1 });
  });

  it('dryRun правки считает последствия и ничего не пишет', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 4000, 200_000]]);
    const res = await patch(w, r.id, { version: 1, lines: [{ itemId: w.cola, qty: 10_000, amount: 300_000 }], dryRun: true });
    expect(res.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect(await getDoc(w, r.id)).toMatchObject({ version: 1, total: 100_000 });
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(40_000);
    expect(w.h.auditCount('stock_doc', 'update')).toBe(0);
  });

  it('правка продажи, из-за которой следующему ручному списанию не хватит, — 422 и откат', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 5000, 50_000]]);
    const s = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    await w.writeoff(D3, [[w.cola, 4000]]); // как раз весь остаток
    const res = await patch(w, s.id, { version: 1, lines: [{ itemId: w.cola, qty: 2000, amount: 100_000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 3 шт на 03.10.2026' });
    expect(await getDoc(w, s.id)).toMatchObject({ version: 1, total: 50_000 });
    expect(rows(w, 'SELECT qty_left q, cost_left c FROM stock_batches')).toEqual([{ q: 0, c: 0 }]);
  });

  it('смена склада переносит движение: старая пара освобождается, новая получает партию', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await patch(w, r.id, { version: 1, warehouseId: w.wh2 });
    expect(rows(w, 'SELECT warehouse_id w, qty_left q FROM stock_batches')).toEqual([{ w: w.wh2, q: 4000 }]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'defect', lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK'); // на прежнем складе товара уже нет
  });

  it('смена товара в строке пересчитывает обе пары', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    const s = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(10_000);
    await patch(w, r.id, { version: 1, lines: [{ itemId: w.chips, qty: 4000, amount: 40_000 }] });
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 1000 });
    expect(rows(w, 'SELECT item_id i, qty_left q FROM stock_batches')).toEqual([{ i: w.chips, q: 4000 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/stock-balance.test.ts tests/server/stock-docs-update.test.ts`
Expected: FAIL — файлы тестов:  1 failed | 1 passed (2) | тесты:  9 failed | 12 passed (21) (маршрутов `balance` и `value` ещё нет; тесты правки документов проходят — правка уже есть с задачи 3).

- [ ] **Step 3: Write the implementation**

Создайте `src/server/modules/stock/balance.ts`:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import { addDays, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import { runFifo, type FifoEvent } from '../../../shared/stock-fifo';
import { priceAt } from '../../../shared/stock-price';
import type { Db } from '../../db/client';
import { stockItemPrices, stockItems } from '../../db/schema';
import { requireCompany } from '../companies/guard';

/** Партия в остатках: приход одной строкой документа. */
export interface BalanceBatch {
  lineId: number;
  docId: number;
  docNumber: string;
  warehouseId: number;
  counterpartyId: number | null;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
}

export interface BalanceItem {
  itemId: number;
  /** Остаток с учётом проданного без партии: может быть меньше нуля. */
  qty: number;
  /** Остаток партий. */
  qtyLeft: number;
  /** Проданное и списанное без партии (§5.3, «Нет партии»). */
  deficit: number;
  /** Себестоимость остатка партий. */
  cost: number;
  /** Средняя цена закупки остатка за единицу; null — остатка партий нет. */
  avgCost: number | null;
  /** Цена продажи на дату остатков. */
  salePrice: number;
  /** Наценка в сотых долях процента ((цена \u2212 закупка) / закупка); null — закупка неизвестна или равна нулю. */
  markupBp: number | null;
  /** Остаток ниже минимального. */
  low: boolean;
  batches: BalanceBatch[];
}

export interface BalanceResult {
  warehouseId: number | null;
  /** Календарная дата остатков; null — на сейчас. */
  at: string | null;
  items: BalanceItem[];
  /** Стоимость склада: сумма остатков партий. */
  total: number;
}

export interface WarehouseValue {
  warehouseId: number;
  projectId: number;
  name: string;
  value: number;
}

export interface StockBalanceService {
  /** Остатки по товарам и партиям на конец дня `at` (без даты — сейчас), по складу или по всем. */
  balance(companyId: number, q: { warehouse?: number; at?: string }): BalanceResult;
  /** Стоимость неархивных складов — для левой панели; в «Всего на счетах» не входит. */
  value(companyId: number): { warehouses: WarehouseValue[]; total: number };
}

interface Row {
  lineId: number;
  docId: number;
  number: string;
  type: string;
  at: string;
  position: number;
  warehouseId: number;
  counterpartyId: number | null;
  itemId: number;
  qty: number;
  amount: number | null;
}

export function createStockBalanceService(d: { db: Db; timezone: string; now?: () => Date }): StockBalanceService {
  const { db } = d;
  const now = d.now ?? (() => new Date());

  return {
    balance(companyId, q) {
      requireCompany(db, companyId);
      const bound = q.at ? startOfDayUtc(addDays(q.at, 1), d.timezone) : null;
      const day = q.at ?? todayInTimezone(d.timezone, now());
      const rows = db.all<Row>(sql`
        SELECT l.id AS lineId, d.id AS docId, d.number AS number, d.type AS type, d.at AS at, l.position AS position,
               d.warehouse_id AS warehouseId, d.counterparty_id AS counterpartyId, l.item_id AS itemId, l.qty AS qty, l.amount AS amount
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('receipt', 'sale', 'writeoff')
           ${q.warehouse ? sql`AND d.warehouse_id = ${q.warehouse}` : sql.empty()}
           ${bound ? sql`AND d.at < ${bound}` : sql.empty()}`);

      const pairs = new Map<string, Row[]>();
      for (const r of rows) {
        const key = `${r.warehouseId}:${r.itemId}`;
        const list = pairs.get(key);
        if (list) list.push(r);
        else pairs.set(key, [r]);
      }
      const byItem = new Map<number, { qtyLeft: number; deficit: number; cost: number; batches: BalanceBatch[] }>();
      for (const list of pairs.values()) {
        const events: FifoEvent[] = list.map((r) =>
          r.type === 'receipt'
            ? { kind: 'in', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty, cost: r.amount ?? 0 }
            : { kind: 'out', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty },
        );
        const result = runFifo(events);
        const info = new Map(list.map((r) => [r.lineId, r]));
        const acc = byItem.get(list[0]!.itemId) ?? { qtyLeft: 0, deficit: 0, cost: 0, batches: [] };
        for (const o of result.outs.values()) acc.deficit += o.uncovered;
        for (const b of result.batches) {
          acc.qtyLeft += b.qtyLeft;
          acc.cost += b.costLeft;
          if (b.qtyLeft > 0) {
            const r = info.get(b.key)!;
            acc.batches.push({
              lineId: b.key,
              docId: r.docId,
              docNumber: r.number,
              warehouseId: r.warehouseId,
              counterpartyId: r.counterpartyId,
              at: b.at,
              qtyIn: b.qtyIn,
              costIn: b.costIn,
              qtyLeft: b.qtyLeft,
              costLeft: b.costLeft,
            });
          }
        }
        byItem.set(list[0]!.itemId, acc);
      }

      const prices = new Map<number, { price: number; validFrom: string }[]>();
      for (const p of db
        .select({ itemId: stockItemPrices.itemId, price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
        .from(stockItemPrices)
        .innerJoin(stockItems, eq(stockItems.id, stockItemPrices.itemId))
        .where(eq(stockItems.companyId, companyId))
        .all()) {
        prices.set(p.itemId, [...(prices.get(p.itemId) ?? []), { price: p.price, validFrom: p.validFrom }]);
      }

      const items: BalanceItem[] = [];
      for (const item of db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).orderBy(asc(stockItems.nameKey), asc(stockItems.id)).all()) {
        const acc = byItem.get(item.id) ?? { qtyLeft: 0, deficit: 0, cost: 0, batches: [] };
        const qty = acc.qtyLeft - acc.deficit;
        // архивный товар без остатка и долга в списке не нужен
        if (item.archivedAt && qty === 0 && acc.deficit === 0) continue;
        const avgCost = acc.qtyLeft > 0 ? Number((2n * BigInt(acc.cost) * 1000n + BigInt(acc.qtyLeft)) / (2n * BigInt(acc.qtyLeft))) : null;
        const salePrice = q.at ? priceAt(prices.get(item.id) ?? [], day) : item.salePrice;
        items.push({
          itemId: item.id,
          qty,
          qtyLeft: acc.qtyLeft,
          deficit: acc.deficit,
          cost: acc.cost,
          avgCost,
          salePrice,
          markupBp: avgCost !== null && avgCost > 0 ? Math.round(((salePrice - avgCost) * 10000) / avgCost) : null,
          low: item.minQty !== null && qty < item.minQty,
          batches: acc.batches.sort((a, b) => (a.at === b.at ? a.lineId - b.lineId : a.at < b.at ? -1 : 1)),
        });
      }
      return { warehouseId: q.warehouse ?? null, at: q.at ?? null, items, total: items.reduce((s, i) => s + i.cost, 0) };
    },

    value(companyId) {
      requireCompany(db, companyId);
      const warehouses = db.all<WarehouseValue>(sql`
        SELECT w.id AS warehouseId, w.project_id AS projectId, w.name AS name, COALESCE(SUM(b.cost_left), 0) AS value
          FROM stock_warehouses w LEFT JOIN stock_batches b ON b.warehouse_id = w.id
         WHERE w.company_id = ${companyId} AND w.archived_at IS NULL
         GROUP BY w.id ORDER BY w.id`);
      return { warehouses, total: warehouses.reduce((s, w) => s + w.value, 0) };
    },
  };
}
```

В `src/server/app.ts` замените

```ts
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { registerStockRoutes } from './modules/stock/routes';
```

на

```ts
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockBalanceService } from './modules/stock/balance';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { registerStockRoutes } from './modules/stock/routes';
```

В `src/server/app.ts` замените

```ts
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

на

```ts
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
    balance: createStockBalanceService({ db, timezone: config.timezone, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

В `src/server/modules/stock/routes.ts` замените

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  stockDocCreateSchema,
  stockDocListSchema,
  stockDocUpdateSchema,
```

на

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  stockBalanceSchema,
  stockDocCreateSchema,
  stockDocListSchema,
  stockDocUpdateSchema,
```

В `src/server/modules/stock/routes.ts` замените

```ts
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import type { StockWarehousesService } from './warehouses';
```

на

```ts
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockBalanceService } from './balance';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import type { StockWarehousesService } from './warehouses';
```

В `src/server/modules/stock/routes.ts` замените

```ts
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService }): void {
  const { catalog, warehouses, docs } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

на

```ts
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService }): void {
  const { catalog, warehouses, docs, balance } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

В `src/server/modules/stock/routes.ts` замените

```ts
    const { dryRun } = z.object({ dryRun: z.enum(['1', '0']).optional() }).parse(req.query);
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });
}
```

на

```ts
    const { dryRun } = z.object({ dryRun: z.enum(['1', '0']).optional() }).parse(req.query);
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // ---- остатки и стоимость
  app.get<C>(`${BASE}/balance`, async (req) => balance.balance(parseId(req.params.cid), stockBalanceSchema.parse(req.query)));

  app.get<C>(`${BASE}/value`, async (req) => balance.value(parseId(req.params.cid)));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` и `npm run typecheck`.
Expected: `npm test` - 1197 пройдено и 1 пропущен, typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server tests
git commit -m "feat: остатки, стоимость складов, правка документов и 409 (Склад-1a, задача 4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Оплата закупки расходом журнала (§3.5, §6.1, §10)

**Files:**
- Create: `src/server/modules/stock/payments.ts`
- Modify: `src/server/app.ts`, `src/server/modules/operations/service.ts`, `src/server/modules/stock/docs.ts`, `src/server/modules/stock/routes.ts`, `src/shared/schemas/operations.ts`
- Test: `tests/server/stock-payments.test.ts` (новый)

**Interfaces:**
- Consumes: `createOperationsService` и `OperationInput`/`OperationDto`/`OperationPatch` (`modules/operations/service.ts`), `operationCreateSchema`/`operationUpdateSchema`, `stockWorld`, таблицы `stock_doc_payments`.
- Produces:
  - `StockPaymentInput {docId, amount}`, `StockPaymentDto {docId, amount, number}`, `operationPayments(ex, operationId)`, `paidByDoc(ex, docIds): Map`, `docPayments(ex, docId): {operationId, amount, paidAt}[]`, `assertOperationPayments(ex, companyId, op, payments)`, `replaceOperationPayments(tx, operationId, payments)`, `unpaidDocs(db, companyId, counterpartyId, operationId|null): {docs: {docId, number, at, total, paid, own, debt}[]; lastCategoryId}` (`payments.ts`);
  - `OperationInput.stockPayments?`, `OperationDto.stockPayments?` (у `get`/`create`/`update`);
  - тело `POST|PATCH operations` принимает `stockPayments: [{docId, amount}]` (создание — по умолчанию `[]`, правка — без поля оплаты не меняются);
  - `StockDocDto.paid`, `StockDocDto.payments: {operationId, amount, paidAt}[]`, `StockDocListItem.paid`;
  - маршрут `GET suppliers/:id/unpaid?operationId=`; ошибка `STOCK_PAYMENTS_EXCEED` (422).

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/stock-payments.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const PAID = '2026-10-05T10:00:00.000Z';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

/** Расход поставщику со счёта «Касса» (KZT). */
const expenseBody = (world: StockWorld, over: Record<string, unknown> = {}) => ({
  type: 'expense',
  paidAt: PAID,
  accountId: world.kzt,
  amount: 100_000,
  counterpartyId: world.supplier,
  lines: [{ categoryId: world.expense, projectId: world.project, amount: 100_000 }],
  ...over,
});
const expense = (world: StockWorld, over: Record<string, unknown> = {}) => world.h.req('POST', world.ops, expenseBody(world, over));
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const unpaid = async (world: StockWorld, query = '') => (await world.h.req('GET', `${world.stock}/suppliers/${world.supplier}/unpaid${query}`)).json();

describe('оплата закупки из расхода журнала (§6.1)', () => {
  it('расход оплачивает часть поступления: у документа — оплачено и операция, у расхода — номера документов', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 250_000]]);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op.stockPayments).toEqual([{ docId: r.id, number: 'П-0001', amount: 100_000 }]);
    const doc = await getDoc(w, r.id);
    expect(doc).toMatchObject({ total: 250_000, paid: 100_000, payments: [{ operationId: op.id, amount: 100_000, paidAt: PAID }] });
    const list = (await w.h.req('GET', `${w.stock}/docs`)).json().docs[0];
    expect([list.total, list.paid]).toEqual([250_000, 100_000]);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.stockPayments).toHaveLength(1);
    expect(w.h.auditCount('operation', 'create')).toBe(1);
  });

  it('несколько документов одним расходом; один документ несколькими расходами; долг считается по всем', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 60_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 90_000]]);
    await expense(w, { amount: 100_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 100_000 }], stockPayments: [{ docId: r1.id, amount: 60_000 }, { docId: r2.id, amount: 40_000 }] });
    await expense(w, { amount: 20_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 20_000 }], stockPayments: [{ docId: r2.id, amount: 20_000 }] });
    expect(await getDoc(w, r1.id)).toMatchObject({ paid: 60_000 });
    expect(await getDoc(w, r2.id)).toMatchObject({ paid: 60_000 });
    const u = await unpaid(w);
    expect(u.docs).toEqual([{ docId: r2.id, number: 'П-0002', at: D2, total: 90_000, paid: 60_000, own: 0, debt: 30_000 }]); // r1 оплачен полностью
  });

  it('переплата допустима: долг отрицательный, документ из списка долгов уходит', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 50_000]]);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect(res.statusCode).toBe(201);
    const doc = await getDoc(w, r.id);
    expect(doc.total - doc.paid).toBe(-50_000);
    expect((await unpaid(w)).docs).toEqual([]);
  });

  it('сумма оплат больше суммы расхода — 422 «Оплаты закупок больше суммы расхода», ничего не записано', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 80_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 80_000]]);
    const res = await expense(w, { amount: 100_000, stockPayments: [{ docId: r1.id, amount: 80_000 }, { docId: r2.id, amount: 30_000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'STOCK_PAYMENTS_EXCEED', message: 'Оплаты закупок больше суммы расхода', fields: { stockPayments: 'Оплаты закупок больше суммы расхода' } });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get()).toEqual({ n: 0 });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_payments').get()).toEqual({ n: 0 });
  });

  it('проверки: только расход, поставщик обязателен и тот же, документ — неудалённое поступление, без повторов, счёт в валюте компании, сумма больше нуля', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 50_000]]);
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const otherSupplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const other = await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh, counterpartyId: otherSupplier, lines: [{ itemId: w.chips, qty: 1000, amount: 10_000 }] });
    const code = async (over: Record<string, unknown>) => {
      const res = await expense(w, over);
      return [res.statusCode, res.json().error.code, res.json().error.message];
    };
    const pay = [{ docId: r.id, amount: 10_000 }];
    expect(await code({ type: 'income', lines: [{ categoryId: w.income, projectId: w.project, amount: 100_000 }], stockPayments: pay })).toEqual([422, 'VALIDATION', 'Оплата закупки — только у расхода']);
    expect(await code({ counterpartyId: null, stockPayments: pay })).toEqual([422, 'VALIDATION', 'Для оплаты закупки выберите поставщика']);
    expect(await code({ stockPayments: [{ docId: other.id, amount: 10_000 }] })).toEqual([422, 'VALIDATION', 'Поступление П-0002 — от другого поставщика']);
    expect(await code({ stockPayments: [{ docId: sale.id, amount: 10_000 }] })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
    expect(await code({ stockPayments: [{ docId: 99_999, amount: 10_000 }] })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
    expect(await code({ stockPayments: [{ docId: r.id, amount: 1000 }, { docId: r.id, amount: 2000 }] })).toEqual([422, 'VALIDATION', 'Документ указан в оплатах дважды']);
    expect(await code({ accountId: w.usd, amount: 10_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 10_000 }], stockPayments: pay })).toEqual([
      422,
      'VALIDATION',
      'Оплата закупки — только со счёта в валюте компании (KZT)',
    ]);
    expect((await expense(w, { stockPayments: [{ docId: r.id, amount: 0 }] })).statusCode).toBe(400);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(await code({ stockPayments: pay })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
  });

  it('поступление другой компании оплатить нельзя', async () => {
    const w = await world();
    const otherCid = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const proj = (await w.post(`/api/v1/companies/${otherCid}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const wh = (await w.post(`/api/v1/companies/${otherCid}/stock/warehouses`, { projectId: proj, name: 'Чужой' })).warehouse.id as number;
    const item = (await w.post(`/api/v1/companies/${otherCid}/stock/items`, { name: 'Кола 0,5', unit: 'pcs' })).item.id as number;
    const foreign = (await w.post(`/api/v1/companies/${otherCid}/stock/docs`, { type: 'receipt', at: D1, warehouseId: wh, lines: [{ itemId: item, qty: 1000, amount: 1 }] })).doc;
    const res = await expense(w, { stockPayments: [{ docId: foreign.id, amount: 1 }] });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_5']);
  });
});

describe('каскад: оплаты следуют за расходом и документом', () => {
  it('удаление расхода снимает оплату, восстановление возвращает; массовое удаление — так же', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
    expect((await unpaid(w)).docs).toEqual([]);

    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    expect(await getDoc(w, r.id)).toMatchObject({ paid: 0, payments: [] });
    expect((await unpaid(w)).docs).toMatchObject([{ docId: r.id, paid: 0, debt: 100_000 }]);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0].paid).toBe(0);

    await w.h.req('POST', `${w.ops}/${op.id}/restore`);
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.stockPayments).toHaveLength(1);

    await w.h.req('POST', `${w.ops}/bulk`, { action: 'delete', ids: [op.id] });
    expect((await getDoc(w, r.id)).paid).toBe(0);
    await w.h.req('POST', `${w.ops}/bulk`, { action: 'restore', ids: [op.id] });
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
  });

  it('удаление поступления: расход остаётся обычным расходом, оплата на нём не показывается, ошибок нет', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    expect((await w.h.req('DELETE', `${w.stock}/docs/${r.id}`)).statusCode).toBe(200);
    const got = (await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation;
    expect([got.deletedAt, got.stockPayments]).toEqual([null, []]);
    // правка такого расхода не спотыкается об удалённый документ
    const edit = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'ок' });
    expect(edit.statusCode).toBe(200);
    expect((await unpaid(w)).docs).toEqual([]);
  });
});

describe('правка расхода с оплатами и 409', () => {
  it('список оплат заменяется целиком; без поля оплаты остаются; те же значения — без записи', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 60_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 60_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r1.id, amount: 60_000 }] })).json().operation;
    const same = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r1.id, amount: 60_000 }] });
    expect(same.json().operation.version).toBe(1);
    const keep = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'без поля оплат' });
    expect(keep.json().operation).toMatchObject({ version: 2, stockPayments: [{ docId: r1.id, amount: 60_000 }] });
    const moved = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 2, stockPayments: [{ docId: r2.id, amount: 40_000 }] });
    expect(moved.json().operation).toMatchObject({ version: 3, stockPayments: [{ docId: r2.id, amount: 40_000 }] });
    expect([(await getDoc(w, r1.id)).paid, (await getDoc(w, r2.id)).paid]).toEqual([0, 40_000]);
    const cleared = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 3, stockPayments: [] });
    expect(cleared.json().operation.stockPayments).toEqual([]);
    expect((await getDoc(w, r2.id)).paid).toBe(0);
    const diff = w.h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'operation' AND action = 'update' ORDER BY id DESC LIMIT 1").get() as { diff: string };
    expect(JSON.parse(diff.diff).before.stockPayments).toEqual([{ docId: r2.id, amount: 40_000 }]);
  });

  it('две вкладки: только оплата меняется, вторая со старой версией — 409, оплаты первой целы', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, {})).json().operation;
    const first = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r.id, amount: 70_000 }] });
    expect(first.statusCode).toBe(200);
    const second = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r.id, amount: 30_000 }] });
    expect([second.statusCode, second.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect((await getDoc(w, r.id)).paid).toBe(70_000);
  });

  it('уменьшение суммы расхода ниже оплат, смена поставщика и перевод в перевод запрещены, пока оплаты есть', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    const lower = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, amount: 50_000 });
    expect([lower.statusCode, lower.json().error.code]).toEqual([422, 'STOCK_PAYMENTS_EXCEED']);
    const otherSupplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const changed = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, counterpartyId: otherSupplier });
    expect([changed.statusCode, changed.json().error.message]).toEqual([422, 'Поступление П-0001 — от другого поставщика']);
    const bulk = await w.h.req('POST', `${w.ops}/bulk`, { action: 'setCounterparty', ids: [op.id], counterpartyId: otherSupplier });
    expect(bulk.json()).toEqual({ changed: [], skipped: [{ id: op.id, reason: 'Поступление П-0001 — от другого поставщика' }] });
    const toTransfer = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, type: 'transfer', toAccountId: w.usd, toAmount: 1, counterpartyId: null, lines: [{ projectId: w.project, categoryId: null, amount: 100_000 }] });
    expect(toTransfer.statusCode).toBe(422);
    // снять оплату и тогда менять
    expect((await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [], counterpartyId: otherSupplier })).statusCode).toBe(200);
  });

  it('«своя» оплата в списке долгов при правке: own и долг без этого расхода', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { amount: 60_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 60_000 }], stockPayments: [{ docId: r.id, amount: 60_000 }] })).json().operation;
    expect((await unpaid(w)).docs).toMatchObject([{ docId: r.id, paid: 60_000, own: 0, debt: 40_000 }]);
    expect((await unpaid(w, `?operationId=${op.id}`)).docs).toMatchObject([{ docId: r.id, paid: 60_000, own: 60_000, debt: 40_000 }]);
    // документ, полностью оплаченный этим расходом, остаётся в списке при его правке
    const full = await expense(w, { amount: 40_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 40_000 }], stockPayments: [{ docId: r.id, amount: 40_000 }] });
    expect((await unpaid(w)).docs).toEqual([]);
    expect((await unpaid(w, `?operationId=${full.json().operation.id}`)).docs).toMatchObject([{ docId: r.id, own: 40_000, debt: 0 }]);
  });
});

describe('подсказка категории и архивная компания', () => {
  it('lastCategoryId — категория последнего расхода с оплатой этому поставщику', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    expect((await unpaid(w)).lastCategoryId).toBeNull();
    const cat2 = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Закупки' })).category.id as number;
    await expense(w, { amount: 10_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 10_000 }], stockPayments: [{ docId: r.id, amount: 10_000 }] });
    await expense(w, { paidAt: '2026-10-05T12:00:00.000Z', amount: 20_000, lines: [{ categoryId: cat2, projectId: w.project, amount: 20_000 }], stockPayments: [{ docId: r.id, amount: 20_000 }] });
    await expense(w, { paidAt: '2026-10-05T13:00:00.000Z', amount: 5000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 5000 }] }); // без оплаты закупки — не считается
    expect((await unpaid(w)).lastCategoryId).toBe(cat2);
  });

  it('в архивной компании список долгов читается, расход с оплатой создать нельзя', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    expect((await unpaid(w)).docs).toHaveLength(1);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/stock-payments.test.ts`
Expected: FAIL — файлы тестов:  1 failed (1) | тесты:  14 failed (14) (оплат в расходе ещё нет).

- [ ] **Step 3: Write the implementation**

Создайте `src/server/modules/stock/payments.ts`:

```ts
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { operationLines, operations, stockDocPayments, stockDocs } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';

/** Оплата поступления расходом журнала (§3.5, §6.1 спецификации «Склад»). */
export interface StockPaymentInput {
  docId: number;
  amount: number;
}

export interface StockPaymentDto extends StockPaymentInput {
  number: string;
}

/** Оплата глазами документа: какой расход и когда. */
export interface DocPayment {
  operationId: number;
  amount: number;
  paidAt: string;
}

export interface UnpaidDoc {
  docId: number;
  number: string;
  at: string;
  total: number;
  /** Сколько уже оплачено всеми неудалёнными расходами, включая расход, который правят. */
  paid: number;
  /** Сколько платит расход, который правят (0 — другой расход или новый). */
  own: number;
  /** Долг: сумма документа минус всё оплаченное; может быть отрицательным (переплата). */
  debt: number;
}

export interface UnpaidResult {
  docs: UnpaidDoc[];
  /** Категория последнего расхода с оплатой закупки этому поставщику — подсказка для формы. */
  lastCategoryId: number | null;
}

/** Расход без причины, по которой оплаты не действуют: удалённый расход оплату снимает (каскад, §6.1). */
const activeOp = (opAlias = 'o') => sql.raw(`${opAlias}.deleted_at IS NULL`);

/** Оплаты операции с номерами документов; оплаты удалённых документов не показываются. */
export function operationPayments(ex: Executor, operationId: number): StockPaymentDto[] {
  return ex
    .select({ docId: stockDocPayments.docId, amount: stockDocPayments.amount, number: stockDocs.number })
    .from(stockDocPayments)
    .innerJoin(stockDocs, and(eq(stockDocs.id, stockDocPayments.docId), isNull(stockDocs.deletedAt)))
    .where(eq(stockDocPayments.operationId, operationId))
    .orderBy(asc(stockDocPayments.docId))
    .all();
}

/** Сколько оплачено по каждому документу неудалёнными расходами. */
export function paidByDoc(ex: Executor, docIds: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (docIds.length === 0) return out;
  const rows = ex.all<{ docId: number; paid: number }>(sql`
    SELECT p.doc_id AS docId, SUM(p.amount) AS paid
      FROM stock_doc_payments p JOIN operations o ON o.id = p.operation_id
     WHERE ${activeOp()} AND p.doc_id IN (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})
     GROUP BY p.doc_id`);
  for (const r of rows) out.set(r.docId, r.paid);
  return out;
}

/** Оплаты документа: расходы, которые не удалены. */
export function docPayments(ex: Executor, docId: number): DocPayment[] {
  return ex.all<DocPayment>(sql`
    SELECT p.operation_id AS operationId, p.amount AS amount, o.paid_at AS paidAt
      FROM stock_doc_payments p JOIN operations o ON o.id = p.operation_id
     WHERE ${activeOp()} AND p.doc_id = ${docId}
     ORDER BY o.paid_at, o.id`);
}

/**
 * Проверка оплат расхода (§6.1, §10): оплачивает только расход со счёта в валюте компании и с контрагентом; документы —
 * неудалённые поступления этого контрагента из этой компании; без повторов; сумма оплат не больше суммы расхода.
 * Переплата документа допустима.
 */
export function assertOperationPayments(
  ex: Executor,
  companyId: number,
  op: { type: string; amount: number; counterpartyId: number | null; accountCurrency: string; baseCurrency: string },
  payments: readonly StockPaymentInput[],
): void {
  if (payments.length === 0) return;
  const fail = (code: string, message: string) => new AppError(422, code, message, { stockPayments: message });
  if (op.type !== 'expense') throw fail('VALIDATION', 'Оплата закупки — только у расхода');
  if (op.accountCurrency !== op.baseCurrency) throw fail('VALIDATION', `Оплата закупки — только со счёта в валюте компании (${op.baseCurrency})`);
  if (op.counterpartyId === null) throw fail('VALIDATION', 'Для оплаты закупки выберите поставщика');
  if (new Set(payments.map((p) => p.docId)).size !== payments.length) throw fail('VALIDATION', 'Документ указан в оплатах дважды');
  const docs = new Map(
    ex
      .select()
      .from(stockDocs)
      .where(and(eq(stockDocs.companyId, companyId), inArray(stockDocs.id, payments.map((p) => p.docId))))
      .all()
      .map((d) => [d.id, d]),
  );
  for (const p of payments) {
    const doc = docs.get(p.docId);
    if (!doc || doc.deletedAt || doc.type !== 'receipt') throw fail('INVARIANT_5', 'Поступление не найдено или удалено');
    if (doc.counterpartyId !== op.counterpartyId) throw fail('VALIDATION', `Поступление ${doc.number} — от другого поставщика`);
  }
  if (payments.reduce((s, p) => s + p.amount, 0) > op.amount) throw fail('STOCK_PAYMENTS_EXCEED', 'Оплаты закупок больше суммы расхода');
}

/** Записать оплаты операции вместо прежних (в транзакции записи операции). */
export function replaceOperationPayments(tx: Executor, operationId: number, payments: readonly StockPaymentInput[]): void {
  tx.delete(stockDocPayments).where(eq(stockDocPayments.operationId, operationId)).run();
  for (const p of payments) tx.insert(stockDocPayments).values({ docId: p.docId, operationId, amount: p.amount }).run();
}

/** Поступления поставщика с долгом — для поля «Оплата закупки» расхода и для «Оплатить» у документа. */
export function unpaidDocs(db: Db, companyId: number, counterpartyId: number, operationId: number | null): UnpaidResult {
  requireCompany(db, companyId);
  const rows = db.all<{ docId: number; number: string; at: string; total: number }>(sql`
    SELECT d.id AS docId, d.number AS number, d.at AS at, COALESCE((SELECT SUM(l.amount) FROM stock_doc_lines l WHERE l.doc_id = d.id), 0) AS total
      FROM stock_docs d
     WHERE d.company_id = ${companyId} AND d.counterparty_id = ${counterpartyId} AND d.type = 'receipt' AND d.deleted_at IS NULL AND d.status = 'posted'
     ORDER BY d.at, d.id`);
  const paid = paidByDoc(db, rows.map((r) => r.docId));
  const own = new Map<number, number>();
  if (operationId !== null && rows.length > 0) {
    for (const p of db
      .select({ docId: stockDocPayments.docId, amount: stockDocPayments.amount })
      .from(stockDocPayments)
      .where(eq(stockDocPayments.operationId, operationId))
      .all()) {
      own.set(p.docId, p.amount);
    }
  }
  const docs = rows
    .map((r) => ({ ...r, paid: paid.get(r.docId) ?? 0, own: own.get(r.docId) ?? 0, debt: r.total - (paid.get(r.docId) ?? 0) }))
    .filter((r) => r.debt > 0 || r.own > 0);
  const last = db
    .select({ categoryId: operationLines.categoryId })
    .from(operations)
    .innerJoin(operationLines, eq(operationLines.operationId, operations.id))
    .innerJoin(stockDocPayments, eq(stockDocPayments.operationId, operations.id))
    .where(and(eq(operations.companyId, companyId), eq(operations.counterpartyId, counterpartyId), isNull(operations.deletedAt)))
    .orderBy(desc(operations.paidAt), desc(operations.id), asc(operationLines.position))
    .limit(1)
    .get();
  return { docs, lastCategoryId: last?.categoryId ?? null };
}
```

В `src/server/app.ts` замените

```ts
    bulk: createBulkService({ db, operations }),
  });
  registerStockRoutes(app, {
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
```

на

```ts
    bulk: createBulkService({ db, operations }),
  });
  registerStockRoutes(app, {
    db,
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
```

В `src/server/modules/operations/service.ts` замените

```ts
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';

export type OperationType = 'income' | 'expense' | 'transfer';
```

на

```ts
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { assertOperationPayments, operationPayments, replaceOperationPayments, type StockPaymentDto, type StockPaymentInput } from '../stock/payments';

export type OperationType = 'income' | 'expense' | 'transfer';
```

В `src/server/modules/operations/service.ts` замените

```ts
  comment: string | null;
  lines: LineInput[];
  tagIds: number[];
}

export interface OperationLineDto extends LineInput {
```

на

```ts
  comment: string | null;
  lines: LineInput[];
  tagIds: number[];
  /** Оплата закупки: какие поступления склада гасит этот расход. Нет поля — оплат нет. */
  stockPayments?: StockPaymentInput[];
}

export interface OperationLineDto extends LineInput {
```

В `src/server/modules/operations/service.ts` замените

```ts
export interface OperationDto extends OperationRow {
  lines: OperationLineDto[];
  tagIds: number[];
}

export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
```

на

```ts
export interface OperationDto extends OperationRow {
  lines: OperationLineDto[];
  tagIds: number[];
  /** Оплаты закупок расхода с номерами поступлений; у строк журнала не заполняется. */
  stockPayments?: StockPaymentDto[];
}

export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
```

В `src/server/modules/operations/service.ts` замените

```ts
      .all()
      .map((t) => t.tagId)
      .sort((a, b) => a - b);
    return { ...row, lines, tagIds };
  }

  function draftOf(op: OperationDto): OperationInput {
```

на

```ts
      .all()
      .map((t) => t.tagId)
      .sort((a, b) => a - b);
    return { ...row, lines, tagIds, stockPayments: operationPayments(db, id) };
  }

  function draftOf(op: OperationDto): OperationInput {
```

В `src/server/modules/operations/service.ts` замените

```ts
      comment: op.comment,
      lines: op.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: op.tagIds,
    };
  }
```

на

```ts
      comment: op.comment,
      lines: op.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: op.tagIds,
      stockPayments: (op.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: p.amount })),
    };
  }
```

В `src/server/modules/operations/service.ts` замените

```ts
      paidAt: new Date(input.paidAt).toISOString(),
      lines: input.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: [...new Set(input.tagIds)].sort((a, b) => a - b),
    };
    const acc = account(companyId, draft.accountId, 'accountId');
    let toAcc: AccountRow | null = null;
```

на

```ts
      paidAt: new Date(input.paidAt).toISOString(),
      lines: input.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: [...new Set(input.tagIds)].sort((a, b) => a - b),
      stockPayments: (input.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: p.amount })).sort((a, b) => a.docId - b.docId),
    };
    const acc = account(companyId, draft.accountId, 'accountId');
    let toAcc: AccountRow | null = null;
```

В `src/server/modules/operations/service.ts` замените

```ts
      if (archivedTag) throw archivedRef(`Тег «${archivedTag.name}» в архиве — выберите другой`);
    }

    return { draft, account: acc, toAccount: toAcc };
  }
```

на

```ts
      if (archivedTag) throw archivedRef(`Тег «${archivedTag.name}» в архиве — выберите другой`);
    }

    // оплаты закупок: расход со счёта в валюте компании, поставщик и поступления из этой компании (§6.1)
    assertOperationPayments(
      db,
      companyId,
      { type: draft.type, amount: draft.amount, counterpartyId: draft.counterpartyId, accountCurrency: acc.currency, baseCurrency: requireCompany(db, companyId).baseCurrency },
      draft.stockPayments ?? [],
    );

    return { draft, account: acc, toAccount: toAcc };
  }
```

В `src/server/modules/operations/service.ts` замените

```ts
          .returning({ id: operations.id })
          .get();
        writeLinesAndTags(tx, row.id, draft, baseAmount);
        record({ companyId, userId, entity: 'operation', entityId: row.id, action: 'create', diff: { ...draft, rate, baseAmount } });
        return row.id;
      });
```

на

```ts
          .returning({ id: operations.id })
          .get();
        writeLinesAndTags(tx, row.id, draft, baseAmount);
        if (draft.stockPayments?.length) replaceOperationPayments(tx, row.id, draft.stockPayments);
        record({ companyId, userId, entity: 'operation', entityId: row.id, action: 'create', diff: { ...draft, rate, baseAmount } });
        return row.id;
      });
```

В `src/server/modules/operations/service.ts` замените

```ts
          .get();
        if (!updated) throw new AppError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем');
        writeLinesAndTags(tx, id, draft, baseAmount);
        record({
          companyId,
          userId,
```

на

```ts
          .get();
        if (!updated) throw new AppError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем');
        writeLinesAndTags(tx, id, draft, baseAmount);
        if (changes.after.stockPayments !== undefined) replaceOperationPayments(tx, id, draft.stockPayments ?? []);
        record({
          companyId,
          userId,
```

В `src/server/modules/stock/docs.ts` замените

```ts
import { changedFields, mutate } from '../audit/mutate';
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;
```

на

```ts
import { changedFields, mutate } from '../audit/mutate';
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { docPayments, paidByDoc, type DocPayment } from './payments';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;
```

В `src/server/modules/stock/docs.ts` замените

```ts
  lines: StockDocLineDto[];
  /** Сумма строк (поступление, продажа); у списания 0. */
  total: number;
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
```

на

```ts
  lines: StockDocLineDto[];
  /** Сумма строк (поступление, продажа); у списания 0. */
  total: number;
  /** Оплачено расходами журнала (поступление); у остальных 0. Долг = total \u2212 paid, отрицательный — переплата. */
  paid: number;
  /** Расходы журнала, которые платят по поступлению. */
  payments: DocPayment[];
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
  paid: number;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
```

В `src/server/modules/stock/docs.ts` замените

```ts
        uncovered: out ? l.qty - (s?.covered ?? 0) : 0,
      };
    });
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0) };
  }

  function draftOf(dto: StockDocDto): Draft {
```

на

```ts
        uncovered: out ? l.qty - (s?.covered ?? 0) : 0,
      };
    });
    const payments = row.type === 'receipt' ? docPayments(ex, row.id) : [];
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0), paid: payments.reduce((s, p) => s + p.amount, 0), payments };
  }

  function draftOf(dto: StockDocDto): Draft {
```

В `src/server/modules/stock/docs.ts` замените

```ts
            FROM stock_doc_lines WHERE doc_id IN (${sql.join(page.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY doc_id`);
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0 })),
        hasMore: rows.length > q.limit,
      };
    },
```

на

```ts
            FROM stock_doc_lines WHERE doc_id IN (${sql.join(page.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY doc_id`);
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      const paid = paidByDoc(db, page.filter((r) => r.type === 'receipt').map((r) => r.id));
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0, paid: paid.get(r.id) ?? 0 })),
        hasMore: rows.length > q.limit,
      };
    },
```

В `src/server/modules/stock/routes.ts` замените

```ts
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import { parseId } from '../../http/params';
import type { StockBalanceService } from './balance';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService }): void {
  const { catalog, warehouses, docs, balance } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

на

```ts
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import type { Db } from '../../db/client';
import { parseId } from '../../http/params';
import type { StockBalanceService } from './balance';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import { unpaidDocs } from './payments';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { db: Db; catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService }): void {
  const { db, catalog, warehouses, docs, balance } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

В `src/server/modules/stock/routes.ts` замените

```ts
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // ---- остатки и стоимость
  app.get<C>(`${BASE}/balance`, async (req) => balance.balance(parseId(req.params.cid), stockBalanceSchema.parse(req.query)));
```

на

```ts
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // ---- оплата закупок: поступления поставщика с долгом (§6.1)
  app.get<P>(`${BASE}/suppliers/:id/unpaid`, async (req) => {
    const { operationId } = z.object({ operationId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return unpaidDocs(db, parseId(req.params.cid), parseId(req.params.id), operationId ?? null);
  });

  // ---- остатки и стоимость
  app.get<C>(`${BASE}/balance`, async (req) => balance.balance(parseId(req.params.cid), stockBalanceSchema.parse(req.query)));
```

В `src/shared/schemas/operations.ts` замените

```ts
});
const lines = z.array(line).max(50, 'Не больше 50 строк');
const tagIds = z.array(id).max(20, 'Не больше 20 тегов');

export const operationCreateSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' }),
```

на

```ts
});
const lines = z.array(line).max(50, 'Не больше 50 строк');
const tagIds = z.array(id).max(20, 'Не больше 20 тегов');
/** Оплата закупки (§6.1 спецификации «Склад»): сколько этот расход платит по поступлению. */
const stockPayments = z.array(z.object({ docId: id, amount: money })).max(50, 'Не больше 50 оплат');

export const operationCreateSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' }),
```

В `src/shared/schemas/operations.ts` замените

```ts
  comment: comment.optional(),
  lines: lines.default([]),
  tagIds: tagIds.default([]),
});

export const operationUpdateSchema = z.object({
```

на

```ts
  comment: comment.optional(),
  lines: lines.default([]),
  tagIds: tagIds.default([]),
  stockPayments: stockPayments.default([]),
});

export const operationUpdateSchema = z.object({
```

В `src/shared/schemas/operations.ts` замените

```ts
  comment: comment.optional(),
  lines: lines.optional(),
  tagIds: tagIds.optional(),
});

/**
```

на

```ts
  comment: comment.optional(),
  lines: lines.optional(),
  tagIds: tagIds.optional(),
  /** Без поля оплаты не меняются; список целиком заменяет прежний. */
  stockPayments: stockPayments.optional(),
});

/**
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` и `npm run typecheck`.
Expected: `npm test` - 1211 пройдено и 1 пропущен, typecheck без ошибок (существующие тесты операций проходят без правок: поле `stockPayments` необязательное).

- [ ] **Step 5: Commit**

```bash
git add src/server src/shared tests
git commit -m "feat: оплата закупки из расхода журнала (Склад-1a, задача 5)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Продажа в журнал (магазин) (§6.3, §11)

**Files:**
- Create: `src/server/modules/stock/postings.ts`
- Modify: `src/server/app.ts`, `src/server/modules/stock/docs.ts`, `src/server/modules/stock/routes.ts`, `src/shared/schemas/stock.ts`
- Test: `tests/server/stock-postings.test.ts` (новый)

**Interfaces:**
- Consumes: `OperationsService.create` (задача 5), `stockWorld`, таблица `stock_doc_postings`, `stockJournalSchema`.
- Produces:
  - `createStockPostingsService({db, audit, operations}).post(companyId, docId, {accountId, categoryId}, userId): {operationId}`;
  - `postingOf(ex, docId): {operationId, amount} | null`, `postedDocs(ex, ids): Set`, `lastPostOf(ex, warehouseId): {accountId, categoryId} | null` (`postings.ts`);
  - `StockDocDto.posting`, `StockDocDto.lastPost`, `StockDocListItem.posted`;
  - маршрут `POST docs/:id/journal` → 201 `{operationId, doc}`; ошибки `ALREADY_POSTED` (422), `VALIDATION` для не-продажи, нулевой суммы, не ручной продажи и счёта не в валюте компании.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/stock-postings.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const R = 'Р';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const journal = (world: StockWorld, docId: number, body?: Record<string, unknown>) =>
  world.h.req('POST', `${world.stock}/docs/${docId}/journal`, body ?? { accountId: world.kzt, categoryId: world.income });
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const opCount = (world: StockWorld) => (world.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;

describe('продажа → доход журнала (§6.3)', () => {
  it('создаёт доход на выбранный счёт: сумма документа, категория, проект склада, поставщик-покупатель, комментарий «Продажа {номер}»', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const sale = await w.sale(D2, [[w.cola, 2000, 100_000], [w.chips, 1000, 70_000]], { counterpartyId: w.buyer });
    const res = await journal(w, sale.id);
    expect(res.statusCode).toBe(201);
    const { operationId, doc } = res.json();
    expect(doc.posting).toEqual({ operationId, amount: 170_000 });
    const op = (await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation;
    expect(op).toMatchObject({
      type: 'income',
      status: 'actual',
      accountId: w.kzt,
      amount: 170_000,
      paidAt: D2,
      counterpartyId: w.buyer,
      comment: `Продажа ${R}-0001`,
      lines: [{ categoryId: w.income, projectId: w.project, amount: 170_000 }],
    });
    // деньги пришли на счёт; склад в «Всего на счетах» по-прежнему не входит
    const balances = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    expect(balances.accounts.find((a: any) => a.accountId === w.kzt).balance).toBe(170_000);
    expect(balances.total.amount).toBe(170_000);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0]).toMatchObject({ id: sale.id, posted: true });
    // себестоимость расходом в журнал не попадает
    expect(opCount(w)).toBe(1);
  });

  it('повтор невозможен; после удаления операции продажу можно провести снова', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const first = (await journal(w, sale.id)).json();
    const again = await journal(w, sale.id);
    expect([again.statusCode, again.json().error.code, again.json().error.message]).toEqual([422, 'ALREADY_POSTED', 'Продажа уже проведена в журнал']);
    expect(opCount(w)).toBe(1);

    await w.h.req('DELETE', `${w.ops}/${first.operationId}`);
    expect((await getDoc(w, sale.id)).posting).toBeNull();
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0].posted).toBe(false);
    const second = await journal(w, sale.id);
    expect(second.statusCode).toBe(201);
    expect(second.json().operationId).not.toBe(first.operationId);
    expect((await getDoc(w, sale.id)).posting).toMatchObject({ operationId: second.json().operationId });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 1 });
  });

  it('правка продажи операцию не меняет: в документе видно две суммы', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const { operationId } = (await journal(w, sale.id)).json();
    await w.h.req('PATCH', `${w.stock}/docs/${sale.id}`, { version: 1, lines: [{ itemId: w.cola, qty: 1000, amount: 60_000 }] });
    const doc = await getDoc(w, sale.id);
    expect([doc.total, doc.posting.amount]).toEqual([60_000, 50_000]);
    expect((await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation.amount).toBe(50_000);
    // удаление проведённой продажи оставляет доход в журнале: деньги получены
    await w.h.req('DELETE', `${w.stock}/docs/${sale.id}`);
    expect((await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation.deletedAt).toBeNull();
  });

  it('склад запоминает счёт и категорию прошлого проведения', async () => {
    const w = await world();
    const cat2 = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'income', name: 'Продажа товаров' })).category.id as number;
    const s1 = await w.sale(D1, [[w.cola, 1000, 50_000]]);
    const s2 = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await getDoc(w, s1.id)).lastPost).toBeNull();
    await journal(w, s1.id, { accountId: w.kzt, categoryId: cat2 });
    expect((await getDoc(w, s2.id)).lastPost).toEqual({ accountId: w.kzt, categoryId: cat2 });
    // у другого склада памяти нет
    const other = await w.doc({ type: 'sale', at: D3, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }] });
    expect((await getDoc(w, other.id)).lastPost).toBeNull();
    // у не-продажи поля нет
    expect((await getDoc(w, (await w.receipt(D1, [[w.cola, 1000, 1]])).id)).lastPost).toBeNull();
  });
});

describe('правила проведения и откат', () => {
  it('только продажа; нулевая сумма и продажа из Senet — 422; чужой документ — 404', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    const o = await w.writeoff(D1, [[w.cola, 1000]]);
    const free = await w.sale(D1, [[w.chips, 1000, 0]]);
    const fromSenet = await w.sale(D1, [[w.chips, 1000, 100]]);
    w.h.t.sqlite.prepare("UPDATE stock_docs SET source = 'senet', source_ref = 'смена-1' WHERE id = ?").run(fromSenet.id);
    const msg = async (id: number) => (await journal(w, id)).json().error.message;
    expect(await msg(r.id)).toBe('В журнал проводится только продажа');
    expect(await msg(o.id)).toBe('В журнал проводится только продажа');
    expect(await msg(free.id)).toBe('Сумма продажи равна нулю — проводить нечего');
    expect(await msg(fromSenet.id)).toBe('Выручка бара проводится из смены в «Сверке Senet»');
    expect((await journal(w, 99_999)).statusCode).toBe(404);
    expect(opCount(w)).toBe(0);
  });

  it('ошибка операции журнала откатывает проведение целиком: операции и связи нет', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const wrongKind = await journal(w, sale.id, { accountId: w.kzt, categoryId: w.expense });
    expect([wrongKind.statusCode, wrongKind.json().error.code]).toEqual([422, 'INVARIANT_3']);
    const spare = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Запасная', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    await w.h.req('POST', `/api/v1/companies/${w.cid}/accounts/${spare}/archive`);
    const archived = await journal(w, sale.id, { accountId: spare, categoryId: w.income });
    expect([archived.statusCode, archived.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    const early = await w.sale('2026-09-20T10:00:00.000Z', [[w.cola, 1000, 50_000]]); // раньше открытия счёта 2026-10-01
    const tooEarly = await journal(w, early.id);
    expect([tooEarly.statusCode, tooEarly.json().error.code]).toEqual([422, 'INVARIANT_6']);
    expect(opCount(w)).toBe(0);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 0 });
    expect((await getDoc(w, sale.id)).posting).toBeNull();
  });

  it('счёт в другой валюте или чужой компании отклоняется: сумма документа — в валюте компании', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const usd = await journal(w, sale.id, { accountId: w.usd, categoryId: w.income });
    expect([usd.statusCode, usd.json().error.code, usd.json().error.message]).toEqual([422, 'VALIDATION', 'Выручка проводится на счёт в валюте компании (KZT)']);
    const missing = await journal(w, sale.id, { accountId: 99_999, categoryId: w.income });
    expect([missing.statusCode, missing.json().error.code]).toEqual([422, 'INVARIANT_5']);
    expect(opCount(w)).toBe(0);
  });

  it('архивная компания: проведение запрещено; поля тела обязательны', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await journal(w, sale.id, { accountId: w.kzt })).statusCode).toBe(400);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    const res = await journal(w, sale.id);
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    expect(opCount(w)).toBe(0);
  });

  it('история: проведение записывается у документа, создание операции — у операции', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    await journal(w, sale.id);
    expect(w.h.auditCount('operation', 'create')).toBe(1);
    expect(w.h.auditCount('stock_doc', 'update')).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/stock-postings.test.ts`
Expected: FAIL — файлы тестов:  1 failed (1) | тесты:  9 failed (9) (маршрута проведения ещё нет).

- [ ] **Step 3: Write the implementation**

Создайте `src/server/modules/stock/postings.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { accounts, operations, stockDocPostings, stockDocs, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { OperationsService } from '../operations/service';

/** Выручка продажи, проведённая доходом в журнал (§6.3 спецификации «Склад»). */
export interface DocPosting {
  operationId: number;
  /** Сумма операции журнала: правка продажи её не меняет, и они могут разойтись. */
  amount: number;
}

/** Что выбрано в прошлый раз для склада: счёт и категория (§6.3: «выбор запоминается для склада»). */
export interface LastPost {
  accountId: number;
  categoryId: number | null;
}

/** Проведение продажи, которое не удалено: удалённая операция освобождает продажу для нового проведения. */
export function postingOf(ex: Executor, docId: number): DocPosting | null {
  const row = ex
    .select({ operationId: stockDocPostings.operationId, amount: operations.amount })
    .from(stockDocPostings)
    .innerJoin(operations, and(eq(operations.id, stockDocPostings.operationId), isNull(operations.deletedAt)))
    .where(eq(stockDocPostings.docId, docId))
    .get();
  return row ?? null;
}

/** Какие из продаж проведены (для списка документов). */
export function postedDocs(ex: Executor, docIds: readonly number[]): Set<number> {
  if (docIds.length === 0) return new Set();
  const rows = ex.all<{ docId: number }>(sql`
    SELECT p.doc_id AS docId FROM stock_doc_postings p JOIN operations o ON o.id = p.operation_id
     WHERE o.deleted_at IS NULL AND p.doc_id IN (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})`);
  return new Set(rows.map((r) => r.docId));
}

/** Счёт и категория последнего проведения продаж этого склада. */
export function lastPostOf(ex: Executor, warehouseId: number): LastPost | null {
  const row = ex.get<{ accountId: number; categoryId: number | null }>(sql`
    SELECT o.account_id AS accountId, (SELECT l.category_id FROM operation_lines l WHERE l.operation_id = o.id ORDER BY l.position LIMIT 1) AS categoryId
      FROM stock_doc_postings p
      JOIN stock_docs d ON d.id = p.doc_id
      JOIN operations o ON o.id = p.operation_id AND o.deleted_at IS NULL
     WHERE d.warehouse_id = ${warehouseId}
     ORDER BY o.paid_at DESC, o.id DESC LIMIT 1`);
  return row ?? null;
}

export interface PostInput {
  accountId: number;
  categoryId: number;
}

export interface StockPostingsService {
  /** «Провести в журнал»: доходная операция на сумму продажи, проект склада, комментарий «Продажа {номер}». Повтор невозможен. */
  post(companyId: number, docId: number, input: PostInput, userId: number): { operationId: number };
}

export function createStockPostingsService(d: { db: Db; audit: AuditService; operations: OperationsService }): StockPostingsService {
  const { db, audit, operations: ops } = d;
  return {
    post(companyId, docId, input, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      return mutate(
        db,
        audit,
        (tx, record) => {
          const doc = tx.select().from(stockDocs).where(and(eq(stockDocs.id, docId), eq(stockDocs.companyId, companyId))).get();
          if (!doc || doc.deletedAt) throw new AppError(404, 'NOT_FOUND', 'Документ не найден');
          if (doc.type !== 'sale') throw new AppError(422, 'VALIDATION', 'В журнал проводится только продажа');
          if (doc.source !== 'manual') throw new AppError(422, 'VALIDATION', 'Выручка бара проводится из смены в «Сверке Senet»');
          if (postingOf(tx, docId)) throw new AppError(422, 'ALREADY_POSTED', 'Продажа уже проведена в журнал');
          const total = tx.get<{ total: number }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM stock_doc_lines WHERE doc_id = ${docId}`)?.total ?? 0;
          if (total <= 0) throw new AppError(422, 'VALIDATION', 'Сумма продажи равна нулю — проводить нечего');
          // сумма документа — в валюте компании: на счёт в другой валюте она попала бы числом без пересчёта
          const account = tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, companyId))).get();
          if (!account) throw new AppError(422, 'INVARIANT_5', 'Счёт не найден в этой компании', { accountId: 'Счёт не найден в этой компании' });
          if (account.currency !== company.baseCurrency) {
            const message = `Выручка проводится на счёт в валюте компании (${company.baseCurrency})`;
            throw new AppError(422, 'VALIDATION', message, { accountId: message });
          }
          const wh = tx.select().from(stockWarehouses).where(eq(stockWarehouses.id, doc.warehouseId)).get()!;
          const op = ops.create(
            companyId,
            {
              type: 'income',
              paidAt: doc.at,
              accrualDate: null,
              accountId: input.accountId,
              amount: total,
              toAccountId: null,
              toAmount: null,
              counterpartyId: doc.counterpartyId,
              comment: `Продажа ${doc.number}`,
              lines: [{ categoryId: input.categoryId, projectId: wh.projectId, amount: total }],
              tagIds: [],
            },
            userId,
          );
          // прежнее проведение, чья операция удалена, заменяется новым
          tx.delete(stockDocPostings).where(eq(stockDocPostings.docId, docId)).run();
          tx.insert(stockDocPostings).values({ docId, operationId: op.id }).run();
          record({ companyId, userId, entity: 'stock_doc', entityId: docId, action: 'update', diff: { posted: { operationId: op.id, amount: total, number: doc.number } } });
          return { operationId: op.id };
        },
        { behavior: 'immediate' },
      );
    },
  };
}
```

В `src/server/app.ts` замените

```ts
import { createStockBalanceService } from './modules/stock/balance';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
```

на

```ts
import { createStockBalanceService } from './modules/stock/balance';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { createStockPostingsService } from './modules/stock/postings';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
```

В `src/server/app.ts` замените

```ts
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
    balance: createStockBalanceService({ db, timezone: config.timezone, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

на

```ts
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
    balance: createStockBalanceService({ db, timezone: config.timezone, now }),
    postings: createStockPostingsService({ db, audit, operations }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
```

В `src/server/modules/stock/docs.ts` замените

```ts
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { docPayments, paidByDoc, type DocPayment } from './payments';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;
```

на

```ts
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { docPayments, paidByDoc, type DocPayment } from './payments';
import { lastPostOf, postedDocs, postingOf, type DocPosting, type LastPost } from './postings';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;
```

В `src/server/modules/stock/docs.ts` замените

```ts
  paid: number;
  /** Расходы журнала, которые платят по поступлению. */
  payments: DocPayment[];
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
  paid: number;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
```

на

```ts
  paid: number;
  /** Расходы журнала, которые платят по поступлению. */
  payments: DocPayment[];
  /** Продажа, проведённая в журнал; null — не проведена или операция удалена. */
  posting: DocPosting | null;
  /** У продажи: счёт и категория прошлого проведения этого склада — подсказка для окна «Провести в журнал». */
  lastPost: LastPost | null;
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
  paid: number;
  /** Продажа проведена в журнал. */
  posted: boolean;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
```

В `src/server/modules/stock/docs.ts` замените

```ts
      };
    });
    const payments = row.type === 'receipt' ? docPayments(ex, row.id) : [];
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0), paid: payments.reduce((s, p) => s + p.amount, 0), payments };
  }

  function draftOf(dto: StockDocDto): Draft {
```

на

```ts
      };
    });
    const payments = row.type === 'receipt' ? docPayments(ex, row.id) : [];
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0), paid: payments.reduce((s, p) => s + p.amount, 0),
      payments,
      posting: row.type === 'sale' ? postingOf(ex, row.id) : null,
      lastPost: row.type === 'sale' ? lastPostOf(ex, row.warehouseId) : null,
    };
  }

  function draftOf(dto: StockDocDto): Draft {
```

В `src/server/modules/stock/docs.ts` замените

```ts
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      const paid = paidByDoc(db, page.filter((r) => r.type === 'receipt').map((r) => r.id));
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0, paid: paid.get(r.id) ?? 0 })),
        hasMore: rows.length > q.limit,
      };
    },
```

на

```ts
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      const paid = paidByDoc(db, page.filter((r) => r.type === 'receipt').map((r) => r.id));
      const posted = postedDocs(db, page.filter((r) => r.type === 'sale').map((r) => r.id));
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0, paid: paid.get(r.id) ?? 0, posted: posted.has(r.id) })),
        hasMore: rows.length > q.limit,
      };
    },
```

В `src/server/modules/stock/routes.ts` замените

```ts
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
  stockPriceSchema,
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
```

на

```ts
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
  stockJournalSchema,
  stockPriceSchema,
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
```

В `src/server/modules/stock/routes.ts` замените

```ts
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import { unpaidDocs } from './payments';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { db: Db; catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService }): void {
  const { db, catalog, warehouses, docs, balance } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

на

```ts
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import { unpaidDocs } from './payments';
import type { StockPostingsService } from './postings';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { db: Db; catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService; postings: StockPostingsService }): void {
  const { db, catalog, warehouses, docs, balance, postings } = deps;

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));
```

В `src/server/modules/stock/routes.ts` замените

```ts
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // ---- оплата закупок: поступления поставщика с долгом (§6.1)
  app.get<P>(`${BASE}/suppliers/:id/unpaid`, async (req) => {
    const { operationId } = z.object({ operationId: z.coerce.number().int().positive().optional() }).parse(req.query);
```

на

```ts
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // продажа → доход журнала (§6.3)
  app.post<P>(`${BASE}/docs/:id/journal`, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { operationId } = postings.post(cid, id, stockJournalSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ operationId, doc: docs.get(cid, id) });
  });

  // ---- оплата закупок: поступления поставщика с долгом (§6.1)
  app.get<P>(`${BASE}/suppliers/:id/unpaid`, async (req) => {
    const { operationId } = z.object({ operationId: z.coerce.number().int().positive().optional() }).parse(req.query);
```

В `src/shared/schemas/stock.ts` замените

```ts
  offset: z.coerce.number().int().min(0).default(0),
});

export const stockBalanceSchema = z.object({
  warehouse: z.coerce.number().int().positive().optional(),
  /** Остаток на конец календарного дня; без даты — сейчас. */
```

на

```ts
  offset: z.coerce.number().int().min(0).default(0),
});

/** «Провести в журнал»: на какой счёт и в какой категории дохода. */
export const stockJournalSchema = z.object({ accountId: id, categoryId: id });

export const stockBalanceSchema = z.object({
  warehouse: z.coerce.number().int().positive().optional(),
  /** Остаток на конец календарного дня; без даты — сейчас. */
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` и `npm run typecheck`.
Expected: `npm test` - 1220 пройдено и 1 пропущен, typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server src/shared tests
git commit -m "feat: продажа склада в журнал (Склад-1a, задача 6)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Финальное ревью ветки; файл итогов `docs/superpowers/followups/2026-10-15-warehouse-1a-followups.md` пишет контролёр.
- Следом выполняется «Склад-1b» (клиент): он начинается с коммита последней задачи этого плана.
- Открытые риски плана:
  - **Полный пересчёт пары** при каждой записи документа (решение 2): на десятках тысяч строк одного товара запись замедлится; позже — контрольные точки.
  - **Правка проведённой продажи** не меняет доход в журнале (решение 11): суммы могут разойтись, клиент показывает обе.
  - **Дата документа не в будущем** — уточнение к спецификации; предоплатные поступления «на завтра» вводятся в день поступления.
  - **«Нет партии» не исчезает сама:** поставьте поступление датой не позже продажи или заведите начальные остатки поступлением на дату начала учёта. Остатки показывают `deficit` и `deficitAt`, стоимость складов — `hasDeficit` (для 1b).
  - **Одинаковое время у поступления и продажи:** документы с равным временем упорядочиваются по номеру документа, поэтому поступление, введённое после продажи с тем же временем, встаёт позже неё. Решение: датировать поступление на минуту раньше (текст для README 1b).
  - **Миграция** выдана drizzle-kit: имя файла в репозитории может отличаться от имени у исполнителя; тесты его не называют.
  - **Восстановление операции проведения:** если удалённую операцию проведения восстановить после повторного проведения, в журнале будут два дохода — известный случай.
