# «Склад-1b»: товары, партии и FIFO, клиент — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** клиентская часть первого плана модуля «Склад» (§14 спецификации): вкладка «Склад» с «Остатками», «Документами» и «Товарами», склады и группы в настройках, формы документов «Поступление», «Продажа», «Списание» с предупреждением о пересчёте себестоимости, группа «Склад» в левой панели, поле «Оплата закупки» в расходе, «Оплатить» у поступления, «Провести в журнал» у продажи, телефон, e2e и `shots:ux`.
- **Экран:** `pages/StockPage.tsx` (склад в адресе `?warehouse=`, подвкладки), `pages/stock/BalanceTab.tsx`, `DocsTab.tsx`, `ItemsTab.tsx`, `pages/settings/WarehousesSettings.tsx`.
- **Формы:** `components/stock/DocForm.tsx` (документ), `ItemEditor.tsx`, `PriceDialog.tsx`, `PostToJournal.tsx`, `StockPaymentsField.tsx`, `NumberInput.tsx`.
- **Чистая логика (тесты в node):** `lib/stock.ts` (типы и запросы), `lib/stock-view.ts`, `lib/stock-item-form.ts`, `lib/stock-doc-form.ts`, `lib/stock-payments.ts`, `lib/stock-panel.ts`.
- **Форма расхода:** `lib/operation-form.ts` и `lib/operation-edit.ts` получают `stockPayments`; `OperationFormHost` принимает `prefill` для «Оплатить».

**Предусловие:** ветка на коммите последней задачи плана «Склад-1a». Ожидаемо на старте:
- `npm test` — 1220 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 171 из 171;
- `npm run shots:ux` — 57 из 57.

**После плана 1b:** `npm test` — 1264 пройдено и 1 пропущен; `npm run test:e2e` — 180 из 180; `npm run shots:ux` — 61 из 61 (новые снимки `c44`, `c45`, `c46`, `cm05-stock`).

**Architecture:**
- Данные склада — запросы с ключом `['stock', companyId, …]`; после любого изменения `invalidateStock(companyId)` обновляет каталог, документы, остатки, стоимость и долги.
- Склад выбирается в адресе (`warehouseParam`), подвкладки — вложенные маршруты `stock/balance|docs|items`.
- Форма документа держит черновик (`DocDraft`) с текстовыми полями; `buildDocBody` превращает его в тело запроса; запись — через `dryRun` и вопрос о последствиях.
- Оплата закупки — часть черновика операции (`stockPayments`), поле показывается у расхода с поставщиком, у которого есть неоплаченные поступления.

**Tech Stack:** Node 24, TypeScript, React 19, react-router, TanStack Query 5, Tailwind 4, Vitest (node), Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-15-warehouse-design.md](../specs/2026-10-15-warehouse-design.md): §4 (экран «Склад»), §5.3–§5.4 (нехватка, изменение прошлого), §6 (деньги), §13–§14. API и правила — план [«Склад-1a»](2026-10-15-warehouse-1a.md); уточнения — блок «Решения планирования плана Склад-1» в конце спецификации.

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

- **Без новых npm-пакетов и сети.**
- **Поля количества, цен и сумм** принимают только цифры и один разделитель («,» или «.») — правило `lib/amount-input.ts` (`sanitizeAmountInput`, `parseAmountText`), решение владельца 2026-10-14; у «шт» и «уп» дробной части нет.
- **Деньги** на экране — `formatMoney(…, MONEY_SCREEN)` и `MONEY_SCREEN_BEFORE` в левой панели; количество — `formatQty` / `qtyWithUnit`; даты — по `APP_TIMEZONE`.
- **Клиент** не считает деньги и FIFO сам: правила, себестоимость и остатки — сервер; клиент связывает цену и сумму строки (`lineAmount`, `unitPrice`) и показывает ответы.
- **Тесты:** Vitest в node без DOM — логику выносите в чистые функции `lib/`; Playwright: один воркер, порт 41731, пользователь `admin` / `e2e-password-1`, данные — через `page.request` с `origin` и `x-requested-with: fetch`, без фиксированных пауз; `name:` — подстрока, где нужно точное совпадение — `exact: true`.
- **Доступность:** `Modal` с «×», `ConfirmDialog`; недоступная кнопка, на которой может быть фокус, — `aria-disabled`, не `disabled`; подписи полей — `Field` или `aria-label`.
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Реальные данные** запрещены: только «Кола 0,5», «Чипсы», «Клуб 1», «Поставщик А», «Сотрудник А».
- **Невидимые символы** (U+2212, U+00A0, U+202F, U+200B) в коде и в комментариях к нему — только текстовыми escape-последовательностями `\u2212`, `\u00A0`, `\u202F`, `\u200B` (в комментариях — обычный дефис). Редакторы файлов превращают набранный escape в сам символ: после записи файла выполните `node .superpowers/sdd/<рабочая папка>/escape-invisible.cjs <файл>`. Номера документов в тестах — `П-0001`, `Р-0001`, `С-0001` (кириллица).
- **Концы строк:** рабочая копия в CRLF. Файлы пишите инструментами Write/Edit, не here-документами оболочки; скрипты правок с `\u` в тексте — файлом, а не строкой команды.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя с его `data/`, на порту 3460 — демо-экземпляр; их и папку `data/` не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой; снимки пишите не в репозиторий: `npm run shots:ux -- <папка вне репозитория>`;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - задачи с интерфейсом — ещё `npm run test:e2e` (меняют e2e-файлы — два раза подряд);
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи.

## Review Focus

1. **Ввод количества и сумм.** Ожидание: поля не принимают буквы и второй разделитель; дробное количество штук — ошибка у поля «Количество в штуках — целое»; пустая сумма и отрицательная сумма — ошибка у строки; ничего не уходит на сервер. Тесты: задача 1 (`stock-item-form`, e2e), задача 2 (`stock-doc-form`, e2e).
2. **Правка закупки задним числом.** Ожидание: перед записью окно «Изменится себестоимость {N} продаж после {даты}» с «Сохранить» и «Отменить»; без последствий окна нет; ошибка «Не хватает …» остаётся в форме, документ не создаётся. Тесты: задача 2.
3. **Склад не входит в «Всего на счетах» и не виден в форме операции.** Ожидание: «Всего на счетах» прежний после поступлений и продаж, группа «Склад» показывается, строка ведёт в «Остатки» своего склада, на телефоне та же группа в выезжающей панели. Тесты: задача 3.
4. **Оплата закупки.** Ожидание: поле только у расхода с поставщиком, у которого есть долги, и со счёта в валюте компании; сумма по умолчанию — долг, но не больше остатка суммы расхода; больше суммы расхода — ошибка у поля; смена поставщика, «Создать похожий», «Дублировать» и «Изменить в перевод» оплаты не переносят; «Оплатить» открывает расход с долгом. Тесты: задача 4.
5. **Одновременная правка.** Ожидание: 409 в форме документа — «Документ изменён другим пользователем» и «Загрузить актуальный»; прежние правки не теряются молча. Тесты: задача 5.
6. **Архивная компания.** Ожидание: все вкладки читаются, кнопок «+ …», «Сохранить», «Удалить» нет. Тесты: задачи 1 и 5.
7. **Телефон.** Ожидание: «Ещё» → «Склад», страница без горизонтальной прокрутки, лишние колонки скрыты, форма документа — на весь экран. Тесты: задача 5.
8. **«Нет партии» и «Мало».** Ожидание: проданное без партии — отрицательный остаток и пометка; ниже минимального — «Мало», в том числе при нулевом остатке на втором складе. Тесты: задача 1.

---

## Карта файлов

```
src/client/lib/stock.ts                     # типы и запросы склада, invalidateStock (новый)
src/client/lib/stock-view.ts                # вкладки, склад из адреса, группы, остатки по группам, наценка (новый)
src/client/lib/stock-item-form.ts           # форма товара → тело запроса (новый)
src/client/lib/stock-doc-form.ts            # черновик документа, связь цены и суммы, тело запроса, тексты (новый)
src/client/lib/stock-payments.ts            # оплаты закупки в черновике расхода (новый)
src/client/lib/stock-panel.ts               # группа «Склад» левой панели (новый)
src/client/lib/operation-form.ts, operation-edit.ts   # stockPayments в черновике, теле и PATCH
src/client/lib/settings-sections.ts, audit-format.ts  # раздел «Склады»; сущности истории
src/client/pages/StockPage.tsx              # экран «Склад» (новый)
src/client/pages/stock/BalanceTab.tsx, DocsTab.tsx, ItemsTab.tsx   # подвкладки (новые)
src/client/pages/settings/WarehousesSettings.tsx   # склады и группы (новый)
src/client/components/stock/*.tsx           # DocForm, ItemEditor, PriceDialog, PostToJournal, StockPaymentsField, NumberInput (новые)
src/client/components/operation/OperationForm.tsx, OperationFormHost.tsx   # поле «Оплата закупки», prefill
src/client/components/AccountsPanel.tsx, MobileTabBar.tsx, pages/CompanyLayout.tsx, router.tsx
scripts/ux-shots.ts                         # c44, c45, c46, cm05-stock
README.md                                   # раздел «Склад»
e2e/stock.spec.ts (новый), e2e/mobile.spec.ts, e2e/dictionaries.spec.ts
tests/client/stock-view.test.ts, stock-doc-form.test.ts, stock-payments.test.ts, stock-panel.test.ts (новые)
tests/client/operation-form.test.ts, operation-edit.test.ts, settings-sections.test.ts
```

---

### Task 1: Экран «Склад»: «Остатки», «Товары», «Склады» в настройках (§4.1, §4.3, §4.5)

**Files:**
- Create: `src/client/components/stock/ItemEditor.tsx`, `src/client/components/stock/NumberInput.tsx`, `src/client/components/stock/PriceDialog.tsx`, `src/client/lib/stock-item-form.ts`, `src/client/lib/stock-view.ts`, `src/client/lib/stock.ts`, `src/client/pages/StockPage.tsx`, `src/client/pages/settings/WarehousesSettings.tsx`, `src/client/pages/stock/BalanceTab.tsx`, `src/client/pages/stock/ItemsTab.tsx`
- Modify: `src/client/components/MobileTabBar.tsx`, `src/client/lib/audit-format.ts`, `src/client/lib/settings-sections.ts`, `src/client/pages/CompanyLayout.tsx`, `src/client/router.tsx`
- Test: `e2e/dictionaries.spec.ts`, `e2e/mobile.spec.ts`, `e2e/stock.spec.ts` (новый), `tests/client/settings-sections.test.ts`, `tests/client/stock-view.test.ts` (новый)

**Interfaces:**
- Consumes: API плана 1a — `GET items|groups|warehouses|balance`, `POST|PATCH items`, `POST items/:id/price|archive|unarchive`, `DELETE items/:id`, `POST warehouses`, `PATCH warehouses/:id`, `POST groups`; `Modal`, `Field`, `ComboList`-независимые поля, `EntityActions`, `SettingsList`, `useEditedItem`, `DateField`, `useMeta`, `useCounterparties`, `useProjects`.
- Produces:
  - `useStockGroups|useStockItems|useStockWarehouses(companyId)`, `useStockBalance(companyId, warehouse|null)`, `useStockValue`, `useStockDocs`, `useStockDoc`, `useUnpaid`, `invalidateStock(companyId)` и типы `StockItem`, `StockDoc`, `BalanceItem`, `Unpaid` (`lib/stock.ts`);
  - `STOCK_TABS`, `DEFAULT_STOCK_TAB`, `warehouseParam(search, warehouses)`, `stockHref(companyId, tab, warehouse)`, `filterItems`, `itemSections`, `balanceSections`, `markupText(bp)`, `qtyWithUnit`, `projectsWithoutWarehouse`, `defaultWarehouseName` (`lib/stock-view.ts`);
  - `itemBody(form, minorUnits, creating)` (`lib/stock-item-form.ts`);
  - `StockOutletContext {company, warehouse, warehouses}`; маршруты `/c/:id/stock/balance|items`, `/c/:id/settings/warehouses`; вкладка «Склад» в верхнем меню и пункт «Склад» в «Ещё» на телефоне.

- [ ] **Step 1: Write the failing tests**

Создайте `e2e/stock.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, user = 'admin', password = 'e2e-password-1') {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(user);
  await page.getByPlaceholder('Пароль').fill(password);
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

const main = (page: Page) => page.getByRole('main');

test('склады и группы в настройках, каталог товаров: создание, цена с историей, архив', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Склад ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/projects`, { name: 'Клуб 1', templateKey: 'general' });

  // настройки → «Склады»: склад проекта одним нажатием, затем группа товаров
  await page.goto(`/c/${cid}/settings/warehouses`);
  await expect(page.getByRole('heading', { level: 1, name: 'Склады' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Создать склад «Бар Клуб 1»' }).click();
  const warehouses = main(page).getByRole('list', { name: 'Склады' });
  await expect(warehouses.getByRole('listitem').filter({ hasText: 'Бар Клуб 1' })).toContainText('Клуб 1');
  // у проекта не больше одного склада: кнопки больше нет
  await expect(main(page).getByRole('button', { name: /^Создать склад/ })).toHaveCount(0);

  await main(page).getByRole('button', { name: 'Добавить группу' }).click();
  const groupDialog = page.getByRole('dialog', { name: 'Новая группа' });
  await groupDialog.getByLabel('Название группы').fill('Напитки');
  await groupDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(groupDialog).toBeHidden();
  await expect(main(page).getByRole('list', { name: 'Группы товаров' }).getByRole('listitem').filter({ hasText: 'Напитки' })).toBeVisible();

  // «Склад» в верхнем меню → «Товары»
  await page.goto(`/c/${cid}/log`);
  await main(page).getByRole('link', { name: 'Склад', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Склад' })).toBeVisible();
  await main(page).getByRole('link', { name: 'Товары', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/items$`));
  await expect(main(page).getByText('Товаров пока нет.')).toBeVisible();

  // новый товар: поле цены принимает только цифры и один разделитель
  await main(page).getByRole('button', { name: '+ Товар' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый товар' });
  await dialog.getByLabel('Название товара').fill('Кола 0,5');
  await dialog.getByLabel('Группа').selectOption({ label: 'Напитки' });
  const price = dialog.getByLabel('Цена продажи, ₸');
  await price.fill('abc5,5.5');
  await expect(price).toHaveValue('5,55');
  await price.fill('500');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  const table = main(page).getByRole('table', { name: 'Товары' });
  const row = table.getByRole('row').filter({ hasText: 'Кола 0,5' });
  await expect(row).toContainText(/500\s*₸/);
  await expect(table.getByRole('rowgroup', { name: 'Напитки' })).toBeVisible();

  // дробное количество штук в минимальном остатке — понятная ошибка у поля
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  const editor = page.getByRole('dialog', { name: 'Товар', exact: true });
  await editor.getByLabel(/^Минимальный остаток/).fill('1,5');
  await editor.getByRole('button', { name: 'Сохранить' }).click();
  await expect(editor.getByText('Количество в штуках — целое')).toBeVisible();
  await editor.getByLabel(/^Минимальный остаток/).fill('5');
  await editor.getByRole('button', { name: 'Сохранить' }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText('5 шт');

  // «Изменить цену»: новая цена и история
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'Изменить цену' }).click();
  const priceDialog = page.getByRole('dialog', { name: 'Цена продажи: Кола 0,5' });
  await priceDialog.getByLabel('Новая цена, ₸').fill('550');
  await priceDialog.getByRole('button', { name: 'Сохранить цену' }).click();
  await expect(priceDialog).toBeHidden();
  await expect(row).toContainText(/550\s*₸/);
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'Изменить цену' }).click();
  await expect(priceDialog.getByRole('table', { name: 'История цены' }).getByRole('row')).toHaveCount(1); // та же дата — строка заменена
  await page.keyboard.press('Escape');

  // архив вместо удаления
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'В архив' }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText('в архиве');
});

test('без складов экран «Склад» подсказывает, где его создать', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Без склада ${Date.now()}`);
  await page.goto(`/c/${cid}/stock`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  await expect(main(page).getByText('Складов пока нет.')).toBeVisible();
  await main(page).getByRole('link', { name: 'Создайте склад в настройках' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/warehouses$`));
});

/** Склад клуба с двумя товарами и поставщиком; документы — через API. */
async function stockSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const warehouse2 = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50_000 })).item.id as number;
  const chips = (await apiPost(page, `${base}/stock/items`, { name: 'Чипсы', unit: 'pcs', salePrice: 70_000, minQty: 5000 })).item.id as number;
  const supplier = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  return { base, project, project2, warehouse, warehouse2, cola, chips, supplier };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

test('«Остатки»: остаток, себестоимость, наценка, партии, «Мало» и «Нет партии»; склад выбирается и хранится в адресе', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Остатки ${Date.now()}`);
  const s = await stockSetup(page, cid);
  const docs = `${s.base}/stock/docs`;
  await apiPost(page, docs, {
    type: 'receipt',
    at: hoursAgo(5),
    warehouseId: s.warehouse,
    counterpartyId: s.supplier,
    lines: [
      { itemId: s.cola, qty: 10_000, amount: 100_000 },
      { itemId: s.chips, qty: 3000, amount: 21_000 },
    ],
  });
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(3), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 4000, amount: 200_000 }] });
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(2), warehouseId: s.warehouse, lines: [{ itemId: s.chips, qty: 5000, amount: 350_000 }] });

  await page.goto(`/c/${cid}/stock`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  const table = main(page).getByRole('table', { name: 'Остатки' });
  const cola = table.getByRole('row').filter({ hasText: 'Кола 0,5' }).first();
  await expect(cola).toContainText('6 шт');
  await expect(cola).toContainText(/600\s*₸/); // себестоимость остатка: 6 по 100
  await expect(cola).toContainText(/\+400 %/); // (500 \u2212 100) / 100
  const chips = table.getByRole('row').filter({ hasText: 'Чипсы' }).first();
  await expect(chips).toContainText('\u22122 шт');
  await expect(chips).toContainText('Мало');
  await expect(chips).toContainText('Нет партии');
  await expect(main(page).getByText(/Стоимость склада:/)).toContainText(/₸\s*600/);

  // партии раскрываются: дата, документ, поставщик, остаток, цена закупки
  await table.getByRole('button', { name: 'Партии: Кола 0,5' }).click();
  const batches = main(page).getByRole('table', { name: 'Партии: Кола 0,5' });
  await expect(batches.getByRole('row').nth(1)).toContainText('П-0001');
  await expect(batches.getByRole('row').nth(1)).toContainText('Поставщик А');
  await expect(batches.getByRole('row').nth(1)).toContainText('6 шт из 10 шт');
  await expect(batches.getByRole('row').nth(1)).toContainText(/100\s*₸/);
  await table.getByRole('button', { name: 'Партии: Кола 0,5' }).click();
  await expect(batches).toHaveCount(0);

  // товары без остатка скрыты, пока не включён флажок
  await main(page).getByRole('searchbox', { name: 'Поиск товара' }).fill('кола');
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).toHaveCount(0);
  await main(page).getByRole('searchbox', { name: 'Поиск товара' }).fill('');

  // другой склад — пустые остатки, склад в адресе
  await main(page).getByLabel('Склад', { exact: true }).selectOption({ label: 'Бар Клуб 2' });
  await expect(page).toHaveURL(new RegExp(`/stock/balance\\?warehouse=${s.warehouse2}$`));
  // на втором складе колы нет, а у «Чипсов» остаток 0 ниже минимального — «Мало»
  await expect(table.getByRole('row').filter({ hasText: 'Кола 0,5' })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).toContainText('Мало');
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).not.toContainText('Нет партии');
  await main(page).getByRole('link', { name: 'Товары' }).click();
  await expect(page).toHaveURL(new RegExp(`/stock/items\\?warehouse=${s.warehouse2}$`));
});
```

Создайте `tests/client/stock-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BalanceItem, StockGroup, StockItem } from '../../src/client/lib/stock';
import {
  balanceSections,
  defaultWarehouseName,
  filterItems,
  itemSections,
  markupText,
  priceHistoryRows,
  projectsWithoutWarehouse,
  qtyWithUnit,
  stockHref,
  warehouseParam,
} from '../../src/client/lib/stock-view';

const group = (id: number, name: string): StockGroup => ({ id, companyId: 1, name, orderIndex: id, createdAt: 'x', archivedAt: null });
const item = (id: number, name: string, over: Partial<StockItem> = {}): StockItem => ({
  id,
  companyId: 1,
  name,
  groupId: null,
  unit: 'pcs',
  barcode: null,
  isCombo: false,
  salePrice: 0,
  minQty: null,
  createdAt: 'x',
  archivedAt: null,
  prices: [],
  ...over,
});

describe('warehouseParam и stockHref', () => {
  const warehouses = [{ id: 3 }, { id: 5 }];
  it('склад из адреса — только существующий', () => {
    expect(warehouseParam(new URLSearchParams('warehouse=5'), warehouses)).toBe(5);
    expect(warehouseParam(new URLSearchParams('warehouse=9'), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams('warehouse=abc'), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams(''), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams('warehouse=5'), undefined)).toBeNull();
  });
  it('адрес подвкладки сохраняет склад', () => {
    expect(stockHref(2, 'balance', 3)).toBe('/c/2/stock/balance?warehouse=3');
    expect(stockHref(2, 'items', null)).toBe('/c/2/stock/items');
  });
});

describe('filterItems', () => {
  const groups = [group(1, 'Напитки'), group(2, 'Еда')];
  const items = [item(1, 'Кола 0,5', { groupId: 1, barcode: '4870001' }), item(2, 'Чипсы', { groupId: 2 }), item(3, 'Сироп')];
  it('по названию без учёта регистра, по штрихкоду и по группе', () => {
    expect(filterItems(items, groups, 'КОЛА').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, groups, '4870').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, groups, 'еда').map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, groups, '  ').map((i) => i.id)).toEqual([1, 2, 3]);
    expect(filterItems(items, groups, 'нет такого')).toEqual([]);
  });
});

describe('itemSections', () => {
  it('группы по порядку, затем «Без группы»; архивные в конце группы; пустые группы скрыты', () => {
    const groups = [group(1, 'Напитки'), group(2, 'Еда'), group(3, 'Пустая')];
    const items = [
      item(1, 'Кола 0,5', { groupId: 1, archivedAt: 'x' }),
      item(2, 'Сок', { groupId: 1 }),
      item(3, 'Чипсы', { groupId: 2 }),
      item(4, 'Сироп'),
      item(5, 'Забытый', { groupId: 99 }),
    ];
    expect(itemSections(items, groups).map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([
      ['Напитки', [2, 1]],
      ['Еда', [3]],
      ['Без группы', [4, 5]],
    ]);
  });
});

describe('прочее', () => {
  it('история цены — новые сверху', () => {
    expect(priceHistoryRows([{ price: 1, validFrom: '2026-09-01' }, { price: 3, validFrom: '2026-10-01' }, { price: 2, validFrom: '2026-09-15' }]).map((p) => p.price)).toEqual([3, 2, 1]);
  });
  it('проекты без склада — только неархивные; название «Бар {проект}»', () => {
    const projects = [
      { id: 1, archivedAt: null },
      { id: 2, archivedAt: null },
      { id: 3, archivedAt: 'x' },
    ];
    expect(projectsWithoutWarehouse(projects, [{ projectId: 2 }]).map((p) => p.id)).toEqual([1]);
    expect(defaultWarehouseName('Клуб 1')).toBe('Бар Клуб 1');
  });
});

describe('markupText', () => {
  it('сотые доли процента → «+233,3 %», минус с U+2212, ноль и неизвестная закупка', () => {
    expect(markupText(23_333)).toBe('+233,3 %');
    expect(markupText(10_000)).toBe('+100 %');
    expect(markupText(-1250)).toBe('\u221212,5 %');
    expect(markupText(0)).toBe('0 %');
    expect(markupText(2)).toBe('0 %');
    expect(markupText(null)).toBe('—');
  });
  it('qtyWithUnit', () => {
    expect(qtyWithUnit(8000, 'pcs')).toBe('8 шт');
    expect(qtyWithUnit(1500, 'l')).toBe('1,5 л');
  });
});

describe('balanceSections', () => {
  const groups = [group(1, 'Напитки')];
  const items = [item(1, 'Кола 0,5', { groupId: 1 }), item(2, 'Чипсы'), item(3, 'Сироп', { unit: 'l' })];
  const b = (itemId: number, over: Partial<BalanceItem> = {}): BalanceItem => ({
    itemId,
    qty: 0,
    qtyLeft: 0,
    deficit: 0,
    cost: 0,
    avgCost: null,
    salePrice: 0,
    markupBp: null,
    low: false,
    batches: [],
    ...over,
  });
  const balance = [b(1, { qty: 5000, qtyLeft: 5000, cost: 100 }), b(2), b(3, { qty: -1000, deficit: 1000 })];

  it('без остатка скрыты, долг и «Мало» показываются', () => {
    expect(balanceSections(balance, items, groups, { showEmpty: false, query: '' }).map((s) => [s.title, s.rows.map((r) => r.item.id)])).toEqual([
      ['Напитки', [1]],
      ['Без группы', [3]],
    ]);
    const low = [b(1), b(2, { low: true }), b(3)];
    expect(balanceSections(low, items, groups, { showEmpty: false, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([2]);
  });

  it('«Показывать товары без остатка» и поиск', () => {
    expect(balanceSections(balance, items, groups, { showEmpty: true, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([1, 2, 3]);
    expect(balanceSections(balance, items, groups, { showEmpty: true, query: 'чип' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([2]);
  });

  it('товар без строки остатков не показывается', () => {
    expect(balanceSections([b(1, { qty: 1000, qtyLeft: 1000, cost: 1 })], items, groups, { showEmpty: true, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([1]);
  });
});
```

В `e2e/dictionaries.spec.ts` замените

```ts
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
    'Настройки журнала',
```

на

```ts
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Склады',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
    'Настройки журнала',
```

В `e2e/dictionaries.spec.ts` замените

```ts
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
  ]);
```

на

```ts
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Склады',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
  ]);
```

В `e2e/mobile.spec.ts` замените

```ts
    /^Категории/,
    /^Проекты/,
    /^Теги/,
    /^Пользователи/,
    /^Фиксированные курсы валют/,
    /^Резервное копирование/,
```

на

```ts
    /^Категории/,
    /^Проекты/,
    /^Теги/,
    /^Склады/,
    /^Пользователи/,
    /^Фиксированные курсы валют/,
    /^Резервное копирование/,
```

В `e2e/mobile.spec.ts` замените

```ts
/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

test('нижняя панель «Разделы» (§8.3): «Журнал» и «Ещё» — «Пользователи», «Настройки», «История действий»; пилюли и значок истории на телефоне скрыты; на компьютере панели нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вкладки ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
```

на

```ts
/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

test('нижняя панель «Разделы» (§8.3): «Журнал» и «Ещё» — «Склад», «Пользователи», «Настройки», «История действий»; пилюли и значок истории на телефоне скрыты; на компьютере панели нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вкладки ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
```

В `e2e/mobile.spec.ts` замените

```ts
  // «Ещё» — меню над панелью, внутри экрана; Esc закрывает, фокус — на «Ещё»
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu.getByRole('link')).toHaveText(['Пользователи', 'Настройки']);
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.y + m.height).toBeLessThanOrEqual(box.y);
```

на

```ts
  // «Ещё» — меню над панелью, внутри экрана; Esc закрывает, фокус — на «Ещё»
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu.getByRole('link')).toHaveText(['Склад', 'Пользователи', 'Настройки']);
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.y + m.height).toBeLessThanOrEqual(box.y);
```

В `e2e/mobile.spec.ts` замените

```ts

  // Tab за последним пунктом закрывает меню, фокус — на «Ещё»
  await more.click();
  await expect(menu.getByRole('link', { name: 'Пользователи' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Настройки' })).toBeFocused();
```

на

```ts

  // Tab за последним пунктом закрывает меню, фокус — на «Ещё»
  await more.click();
  await expect(menu.getByRole('link', { name: 'Склад' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Пользователи' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Настройки' })).toBeFocused();
```

В `tests/client/settings-sections.test.ts` замените

```ts
    const groups = settingsGroups('ТОО «Демо Клубы»');
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.path)])).toEqual([
      ['account', null, ['profile', 'companies']],
      ['company', 'ТОО «Демо Клубы»', ['counterparties', 'accounts', 'categories', 'projects', 'tags', 'users', 'rates', 'backup']],
      ['view', 'Визуальные настройки', ['journal']],
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
```

на

```ts
    const groups = settingsGroups('ТОО «Демо Клубы»');
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.path)])).toEqual([
      ['account', null, ['profile', 'companies']],
      ['company', 'ТОО «Демо Клубы»', ['counterparties', 'accounts', 'categories', 'projects', 'tags', 'warehouses', 'users', 'rates', 'backup']],
      ['view', 'Визуальные настройки', ['journal']],
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
```

В `tests/client/settings-sections.test.ts` замените

```ts
      'Категории',
      'Проекты',
      'Теги',
      'Пользователи',
      'Фиксированные курсы валют',
      'Резервное копирование',
```

на

```ts
      'Категории',
      'Проекты',
      'Теги',
      'Склады',
      'Пользователи',
      'Фиксированные курсы валют',
      'Резервное копирование',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/stock-view.test.ts tests/client/settings-sections.test.ts` и `npx playwright test e2e/stock.spec.ts`
Expected: FAIL — файлы тестов:  2 failed (2) | тесты:  1 failed | 2 passed (3); e2e: нет вкладки «Склад» и раздела «Склады».

- [ ] **Step 3: Write the implementation**

Создайте `src/client/components/stock/ItemEditor.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { STOCK_BARCODE_MAX, STOCK_ITEM_NAME_MAX } from '../../../shared/schemas/stock';
import { STOCK_UNITS, UNIT_LABELS, type StockUnit } from '../../../shared/stock-qty';
import { api, type ApiError } from '../../lib/api';
import { invalidateStock, type StockGroup, type StockItem } from '../../lib/stock';
import { emptyItemForm, itemBody, itemFormOf, type ItemForm } from '../../lib/stock-item-form';
import { useEntityActions } from '../../lib/settings-mutations';
import { useHeldWhile } from '../../lib/use-edited';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { ArchivedNote, EntityActions } from '../EntityActions';
import { Field } from '../Field';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * Окно товара (§4.3 спецификации «Склад»): название, группа, единица, штрихкод, минимальный остаток; цену продажи у нового
 * товара — здесь, у существующего — «Изменить цену» (дата начала и новая цена, история сохраняется). Архив вместо удаления,
 * если по товару есть документы (сервер отвечает 422).
 */
export function ItemEditor(props: {
  companyId: number;
  baseCurrency: string;
  item: StockItem | null;
  gone: boolean;
  groups: StockGroup[];
  readOnly: boolean;
  onChangePrice: (item: StockItem) => void;
  onDone: () => void;
}) {
  const { companyId } = props;
  const minorUnits = getCurrency(props.baseCurrency).minorUnits;
  const base = `/companies/${companyId}/stock/items`;
  const fresh = props.item;
  const [form, setForm] = useState<ItemForm>(() => (fresh ? itemFormOf(fresh) : emptyItemForm()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const edit = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
  };
  const refresh = () => invalidateStock(companyId);
  const save = useMutation<unknown, ApiError, Record<string, unknown>>({
    mutationFn: (body) => (fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body })),
    onSuccess: async () => {
      await refresh();
      props.onDone();
    },
    onError: (e) => setErrors(e.fields ?? {}),
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, props.onDone);
  const busy = actions.pending || save.isPending;
  const item = useHeldWhile(fresh, busy);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = itemBody(form, minorUnits, !fresh);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    save.mutate(r.body);
  };

  if (props.gone && !busy) return <p className="text-muted">Товар не найден — возможно, его удалили.</p>;
  const unitProblem = errors.unit;
  return (
    <>
      {item?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} aria-label="Товар" className="grid gap-4">
          <Field label="Название товара" error={errors.name}>
            {(c) => <input {...c} value={form.name} maxLength={STOCK_ITEM_NAME_MAX} onChange={(e) => edit('name', e.target.value)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          <Field label="Группа" error={errors.groupId}>
            {(c) => (
              <select
                {...c}
                value={form.groupId ?? ''}
                disabled={props.readOnly}
                onChange={(e) => edit('groupId', e.target.value === '' ? null : Number(e.target.value))}
                className={inputClass}
              >
                <option value="">Без группы</option>
                {props.groups
                  .filter((g) => !g.archivedAt || g.id === form.groupId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.archivedAt ? ' (в архиве)' : ''}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="Единица" error={unitProblem}>
            {(c) => (
              <select {...c} value={form.unit} disabled={props.readOnly} onChange={(e) => edit('unit', e.target.value as StockUnit)} className={inputClass}>
                {STOCK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Штрихкод" error={errors.barcode}>
            {(c) => <input {...c} value={form.barcode} maxLength={STOCK_BARCODE_MAX} onChange={(e) => edit('barcode', e.target.value)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          {fresh ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-field px-4 py-3 text-sm">
              <span>
                Цена продажи: <strong className="tabular-nums">{formatMoney(fresh.salePrice, props.baseCurrency, MONEY_SCREEN)}</strong>
              </span>
              {!props.readOnly && !fresh.archivedAt && (
                <button type="button" onClick={() => props.onChangePrice(fresh)} className={btnSmall}>
                  Изменить цену
                </button>
              )}
            </div>
          ) : (
            <Field label={`Цена продажи, ${getCurrency(props.baseCurrency).symbol}`} error={errors.price} hint="Можно изменить позже: история цены сохранится">
              {(c) => <NumberInput {...c} value={form.price} onChange={(t) => edit('price', t)} className={inputClass} />}
            </Field>
          )}
          <Field label={`Минимальный остаток, ${UNIT_LABELS[form.unit]}`} error={errors.minQty} hint="Ниже этого остатка в «Остатках» будет пометка «Мало»">
            {(c) => <NumberInput {...c} value={form.minQty} onChange={(t) => edit('minQty', t)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          {!props.readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={save.isPending} className={btnPrimary}>
                Сохранить
              </button>
              <button type="button" onClick={props.onDone} className={btnSecondary}>
                Отмена
              </button>
            </div>
          )}
        </form>
      )}
      {item && !props.readOnly && (
        <EntityActions
          archived={item.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(item.archivedAt !== null)}
          what={`товар «${item.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

Создайте `src/client/components/stock/NumberInput.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';
import { AMOUNT_MAX_LENGTH, sanitizeAmountInput } from '../../lib/amount-input';

/**
 * Поле суммы, цены или количества склада: принимает только цифры и один разделитель («,» или «.», решение владельца
 * 2026-10-14, `lib/amount-input.ts`). Обычное поле без плавающей подписи: подпись — у `Field` или `aria-label`.
 */
export function NumberInput({ value, onChange, ...rest }: { value: string; onChange: (text: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <input
      {...rest}
      inputMode="decimal"
      autoComplete="off"
      maxLength={AMOUNT_MAX_LENGTH}
      value={value}
      onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
    />
  );
}
```

Создайте `src/client/components/stock/PriceDialog.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { api, type ApiError } from '../../lib/api';
import { parseAmountText } from '../../lib/amount-input';
import { invalidateStock, type StockItem } from '../../lib/stock';
import { priceHistoryRows } from '../../lib/stock-view';
import { DateField } from '../DateField';
import { Field } from '../Field';
import { alertClass, btnPrimary, btnSecondary, inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * «Изменить цену» (§4.3 спецификации «Склад»): новая цена продажи и дата, с которой она действует (не позже сегодня).
 * Каждая цена остаётся в истории; цена документа «Продажа» по умолчанию берётся на дату документа.
 */
export function PriceDialog(props: { companyId: number; baseCurrency: string; timeZone: string; item: StockItem; onDone: () => void }) {
  const currency = getCurrency(props.baseCurrency);
  const today = todayInTimezone(props.timeZone);
  const [price, setPrice] = useState('');
  const [validFrom, setValidFrom] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation<unknown, ApiError, { price: number; validFrom: string }>({
    mutationFn: (body) => api(`/companies/${props.companyId}/stock/items/${props.item.id}/price`, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidateStock(props.companyId);
      props.onDone();
    },
    onError: (e) => setErrors(e.fields ?? {}),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseAmountText(price, currency.minorUnits);
    if (!r.ok) {
      setErrors({ price: r.error });
      return;
    }
    setErrors({});
    save.mutate({ price: r.minor, validFrom });
  };
  const history = priceHistoryRows(props.item.prices);
  return (
    <div>
      <form noValidate onSubmit={submit} aria-label="Новая цена" className="grid gap-4">
        <p className="text-sm text-muted">
          Сейчас: <span className="font-semibold text-ink tabular-nums">{formatMoney(props.item.salePrice, props.baseCurrency, MONEY_SCREEN)}</span>
        </p>
        <Field label={`Новая цена, ${currency.symbol}`} error={errors.price}>
          {(c) => <NumberInput {...c} value={price} onChange={(t) => (setPrice(t), setErrors({}))} className={inputClass} />}
        </Field>
        <DateField label="Действует с" value={validFrom} today={today} max={today} onChange={setValidFrom} error={errors.validFrom} />
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить цену
          </button>
          <button type="button" onClick={props.onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {history.length > 0 && (
        <section className="mt-6 border-t border-field pt-4">
          <h3 className="mb-2 text-sm font-semibold">История цены</h3>
          <table aria-label="История цены" className="w-full text-sm">
            <tbody>
              {history.map((p) => (
                <tr key={p.validFrom} className="border-b border-field">
                  <td className="py-1.5">с {formatDateRu(p.validFrom)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(p.price, props.baseCurrency, MONEY_SCREEN)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
```

Создайте `src/client/lib/stock-item-form.ts`:

```ts
import { parseQty, qtyInputText, type StockUnit } from '../../shared/stock-qty';
import { parseAmountText } from './amount-input';
import type { StockItem } from './stock';

/** Тело и ошибки полей формы товара. */
export interface ItemForm {
  name: string;
  groupId: number | null;
  unit: StockUnit;
  barcode: string;
  price: string;
  minQty: string;
}

export const emptyItemForm = (): ItemForm => ({ name: '', groupId: null, unit: 'pcs', barcode: '', price: '', minQty: '' });

export const itemFormOf = (item: StockItem): ItemForm => ({
  name: item.name,
  groupId: item.groupId,
  unit: item.unit,
  barcode: item.barcode ?? '',
  price: '',
  minQty: item.minQty === null ? '' : qtyInputText(item.minQty),
});

/** Форма → тело запроса; ошибки — по полям. Цена учитывается только у нового товара (у существующего — «Изменить цену»). */
export function itemBody(form: ItemForm, minorUnits: number, creating: boolean): { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (form.name.trim() === '') errors.name = 'Введите название';
  let salePrice = 0;
  if (creating && form.price.trim() !== '') {
    const r = parseAmountText(form.price, minorUnits);
    if (r.ok) salePrice = r.minor;
    else errors.price = r.error;
  }
  let minQty: number | null = null;
  if (form.minQty.trim() !== '') {
    const r = parseQty(form.minQty, form.unit);
    if (r.ok) minQty = r.qty;
    else errors.minQty = r.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: Record<string, unknown> = { name: form.name, groupId: form.groupId, unit: form.unit, barcode: form.barcode.trim() || null, minQty };
  if (creating) body.salePrice = salePrice;
  return { ok: true, body };
}
```

Создайте `src/client/lib/stock-view.ts`:

```ts
import { matchesQuery } from '../../shared/search';
import { formatQty, UNIT_LABELS, type StockUnit } from '../../shared/stock-qty';
import type { PricePoint } from '../../shared/stock-price';
import type { BalanceItem, StockGroup, StockItem, StockWarehouse } from './stock';

/** Подвкладки экрана «Склад» (§4 спецификации «Склад»); «Аналитика» появится в плане «Склад-3». */
export const STOCK_TABS = [
  { path: 'balance', label: 'Остатки' },
  { path: 'items', label: 'Товары' },
] as const;
export type StockTabPath = (typeof STOCK_TABS)[number]['path'];

/** Подвкладка по умолчанию, куда ведёт адрес `…/stock`. */
export const DEFAULT_STOCK_TAB: StockTabPath = 'balance';

/** Склад из `?warehouse=`: существующий (неархивный или архивный) склад компании; иначе null — «Все склады». */
export function warehouseParam(search: URLSearchParams, warehouses: readonly Pick<StockWarehouse, 'id'>[] | undefined): number | null {
  const raw = search.get('warehouse');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return warehouses?.some((w) => w.id === id) ? id : null;
}

/** Адрес подвкладки с отбором склада: `/c/1/stock/balance?warehouse=3`. */
export function stockHref(companyId: number, tab: string, warehouse: number | null): string {
  return `/c/${companyId}/stock/${tab}${warehouse === null ? '' : `?warehouse=${warehouse}`}`;
}

/** Название склада для проекта, у которого его ещё нет (§4.5: «Бар {проект}»). */
export function defaultWarehouseName(projectName: string): string {
  return `Бар ${projectName}`;
}

/** Товары, подходящие под запрос: по названию, штрихкоду и названию группы (без учёта регистра и «ё»). */
export function filterItems(items: readonly StockItem[], groups: readonly StockGroup[], query: string): StockItem[] {
  const q = query.trim();
  if (q === '') return [...items];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return items.filter((i) => matchesQuery(`${i.name} ${i.barcode ?? ''} ${i.groupId === null ? '' : (groupName.get(i.groupId) ?? '')}`, q));
}

export interface ItemSection {
  key: string;
  title: string;
  items: StockItem[];
}

/** Товары по группам: группы в порядке справочника, затем «Без группы»; архивные товары — в конце своей группы. Пустые группы не показываются. */
export function itemSections(items: readonly StockItem[], groups: readonly StockGroup[]): ItemSection[] {
  const ordered = (list: readonly StockItem[]) => [...list.filter((i) => !i.archivedAt), ...list.filter((i) => i.archivedAt)];
  const known = new Set(groups.map((g) => g.id));
  const sections: ItemSection[] = groups.map((g) => ({ key: String(g.id), title: g.name, items: ordered(items.filter((i) => i.groupId === g.id)) }));
  sections.push({ key: 'none', title: 'Без группы', items: ordered(items.filter((i) => i.groupId === null || !known.has(i.groupId))) });
  return sections.filter((s) => s.items.length > 0);
}

/** История цены продажи для окна «Цена продажи»: новые сверху. */
export function priceHistoryRows(prices: readonly PricePoint[]): PricePoint[] {
  return [...prices].sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
}

/** Проекты, у которых ещё нет склада (неархивные), — строки «Создать склад» в настройках. */
export function projectsWithoutWarehouse<P extends { id: number; archivedAt: string | null }>(projects: readonly P[], warehouses: readonly Pick<StockWarehouse, 'projectId'>[]): P[] {
  const taken = new Set(warehouses.map((w) => w.projectId));
  return projects.filter((p) => !p.archivedAt && !taken.has(p.id));
}

/** «234,3 %», «\u221212 %», «0 %»; null — закупка неизвестна или равна нулю: «—». */
export function markupText(bp: number | null): string {
  if (bp === null) return '—';
  const percent = Math.abs(bp) / 100;
  const text = (Math.round(percent * 10) / 10).toString().replace('.', ',');
  if (bp === 0 || text === '0') return '0 %';
  return `${bp < 0 ? '\u2212' : '+'}${text} %`;
}

/** «8 шт», «1,5 л». */
export function qtyWithUnit(qty: number, unit: StockUnit): string {
  return `${formatQty(qty)} ${UNIT_LABELS[unit]}`;
}

export interface BalanceRow {
  item: StockItem;
  balance: BalanceItem;
}

export interface BalanceSection {
  key: string;
  title: string;
  rows: BalanceRow[];
}

/**
 * Строки «Остатков» по группам (как «Товары»). Товары без остатка, долга и предупреждений скрыты, пока не включено
 * «Показывать товары без остатка»; поиск — по названию, штрихкоду и группе.
 */
export function balanceSections(
  balance: readonly BalanceItem[],
  items: readonly StockItem[],
  groups: readonly StockGroup[],
  opts: { showEmpty: boolean; query: string },
): BalanceSection[] {
  const byId = new Map(balance.map((b) => [b.itemId, b]));
  const visible = filterItems(items, groups, opts.query).filter((i) => {
    const b = byId.get(i.id);
    if (!b) return false;
    return opts.showEmpty || b.qty !== 0 || b.deficit > 0 || b.low || b.cost !== 0;
  });
  return itemSections(visible, groups).map((s) => ({ ...s, rows: s.items.map((item) => ({ item, balance: byId.get(item.id)! })) }));
}
```

Создайте `src/client/lib/stock.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import type { StockUnit } from '../../shared/stock-qty';
import type { PricePoint } from '../../shared/stock-price';
import { api, type ApiError } from './api';
import { queryClient } from './query';

/** Остатки и стоимость недорогие: обновляются при возврате на вкладку, не чаще раза в 30 с. */
const REFRESH_ON_FOCUS = { refetchOnWindowFocus: true, staleTime: 30_000 } as const;

export interface StockGroup {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface StockItem {
  id: number;
  companyId: number;
  name: string;
  groupId: number | null;
  unit: StockUnit;
  barcode: string | null;
  isCombo: boolean;
  /** Текущая цена продажи за единицу, минимальные единицы валюты. */
  salePrice: number;
  /** Минимальный остаток, тысячные доли единицы. */
  minQty: number | null;
  createdAt: string;
  archivedAt: string | null;
  prices: PricePoint[];
}

export interface StockWarehouse {
  id: number;
  companyId: number;
  projectId: number;
  name: string;
  receiptsSource: 'manual' | 'senet';
  createdAt: string;
  archivedAt: string | null;
}

export interface StockDocLine {
  id: number;
  position: number;
  itemId: number;
  qty: number;
  amount: number | null;
  /** Себестоимость строки продажи или списания; null — у поступления и у строки без партии. */
  cost: number | null;
  /** Сколько из строки не нашло партии («Нет партии»). */
  uncovered: number;
}

export interface DocPayment {
  operationId: number;
  amount: number;
  paidAt: string;
}

export interface StockDocListItem {
  id: number;
  type: StockDocType;
  number: string;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  version: number;
  total: number;
  linesCount: number;
  paid: number;
  posted: boolean;
}

export interface StockDoc extends StockDocListItem {
  lines: StockDocLine[];
  payments: DocPayment[];
  posting: { operationId: number; amount: number } | null;
  lastPost: { accountId: number; categoryId: number | null } | null;
  deletedAt: string | null;
}

/** Чем документ меняет чужие проведённые документы (§5.4 спецификации «Склад»). */
export interface DocImpact {
  sales: number;
  writeoffs: number;
  /** ISO-момент правки; null — чужие документы не затронуты. */
  since: string | null;
}

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
  qty: number;
  qtyLeft: number;
  deficit: number;
  cost: number;
  avgCost: number | null;
  salePrice: number;
  markupBp: number | null;
  low: boolean;
  batches: BalanceBatch[];
}

export interface StockBalance {
  warehouseId: number | null;
  at: string | null;
  items: BalanceItem[];
  total: number;
}

export interface WarehouseValue {
  warehouseId: number;
  projectId: number;
  name: string;
  value: number;
}

export interface StockValue {
  warehouses: WarehouseValue[];
  total: number;
}

export interface UnpaidDoc {
  docId: number;
  number: string;
  at: string;
  total: number;
  paid: number;
  own: number;
  debt: number;
}

export interface Unpaid {
  docs: UnpaidDoc[];
  lastCategoryId: number | null;
}

const base = (companyId: number) => `/companies/${companyId}/stock`;

export function useStockGroups(companyId: number) {
  return useQuery<StockGroup[], ApiError>({
    queryKey: ['stock', companyId, 'groups'],
    queryFn: async () => (await api<{ groups: StockGroup[] }>(`${base(companyId)}/groups`)).groups,
  });
}

export function useStockItems(companyId: number) {
  return useQuery<StockItem[], ApiError>({
    queryKey: ['stock', companyId, 'items'],
    queryFn: async () => (await api<{ items: StockItem[] }>(`${base(companyId)}/items`)).items,
  });
}

export function useStockWarehouses(companyId: number) {
  return useQuery<StockWarehouse[], ApiError>({
    queryKey: ['stock', companyId, 'warehouses'],
    queryFn: async () => (await api<{ warehouses: StockWarehouse[] }>(`${base(companyId)}/warehouses`)).warehouses,
  });
}

/** Остатки на сейчас; warehouse — склад или все. Ключ ['stock', cid, 'balance', …]: сброс ['stock', cid] обновляет и их. */
export function useStockBalance(companyId: number, warehouse: number | null) {
  return useQuery<StockBalance, ApiError>({
    queryKey: ['stock', companyId, 'balance', warehouse],
    queryFn: () => api<StockBalance>(`${base(companyId)}/balance${warehouse === null ? '' : `?warehouse=${warehouse}`}`),
    ...REFRESH_ON_FOCUS,
  });
}

/** Стоимость складов для левой панели (§4.4). */
export function useStockValue(companyId: number) {
  return useQuery<StockValue, ApiError>({
    queryKey: ['stock', companyId, 'value'],
    queryFn: () => api<StockValue>(`${base(companyId)}/value`),
    ...REFRESH_ON_FOCUS,
  });
}

export interface DocsQuery {
  type: StockDocType | null;
  warehouse: number | null;
  limit: number;
}

export function docsQueryString(q: DocsQuery): string {
  const p = new URLSearchParams();
  if (q.type) p.set('type', q.type);
  if (q.warehouse !== null) p.set('warehouse', String(q.warehouse));
  p.set('limit', String(q.limit));
  return p.toString();
}

export function useStockDocs(companyId: number, q: DocsQuery) {
  return useQuery<{ docs: StockDocListItem[]; hasMore: boolean }, ApiError>({
    queryKey: ['stock', companyId, 'docs', docsQueryString(q)],
    queryFn: () => api<{ docs: StockDocListItem[]; hasMore: boolean }>(`${base(companyId)}/docs?${docsQueryString(q)}`),
    // при смене фильтра прежний список остаётся на экране до ответа
    placeholderData: (prev) => prev,
  });
}

export function useStockDoc(companyId: number, id: number | null) {
  return useQuery<StockDoc, ApiError>({
    queryKey: ['stock', companyId, 'doc', id],
    queryFn: async () => (await api<{ doc: StockDoc }>(`${base(companyId)}/docs/${id}`)).doc,
    enabled: id !== null,
    gcTime: 0,
  });
}

/** Поступления поставщика с долгом; operationId — расход, который правят (его оплаты остаются в списке). */
export function useUnpaid(companyId: number, supplierId: number | null, operationId: number | null) {
  return useQuery<Unpaid, ApiError>({
    queryKey: ['stock', companyId, 'unpaid', supplierId, operationId],
    queryFn: () => api<Unpaid>(`${base(companyId)}/suppliers/${supplierId}/unpaid${operationId === null ? '' : `?operationId=${operationId}`}`),
    enabled: supplierId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/** После любого изменения склада: каталог, документы, остатки, стоимость и долги по закупкам. */
export function invalidateStock(companyId: number): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['stock', companyId] });
}
```

Создайте `src/client/pages/settings/WarehousesSettings.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { STOCK_GROUP_NAME_MAX, STOCK_WAREHOUSE_NAME_MAX } from '../../../shared/schemas/stock';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { useProjects } from '../../lib/queries';
import { invalidateStock, useStockGroups, useStockWarehouses } from '../../lib/stock';
import { defaultWarehouseName, projectsWithoutWarehouse } from '../../lib/stock-view';
import { useEntityActions } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile, type EditingId } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Окно названия склада или группы: правка и архив; новая группа — 'new'. */
function NameEditor(props: {
  companyId: number;
  kind: 'warehouses' | 'groups';
  /** Текущая запись; null — создание (только группа). */
  row: { id: number; name: string; archivedAt: string | null } | null;
  gone: boolean;
  label: string;
  what: string;
  max: number;
  onDone: () => void;
}) {
  const base = `/companies/${props.companyId}/stock/${props.kind}`;
  const refresh = () => invalidateStock(props.companyId);
  const [name, setName] = useState(props.row?.name ?? '');
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => (props.row ? api(`${base}/${props.row.id}`, { method: 'PATCH', body: { name } }) : api(base, { method: 'POST', body: { name } })),
    onSuccess: async () => {
      await refresh();
      props.onDone();
    },
  });
  const actions = useEntityActions(props.row ? `${base}/${props.row.id}` : base, refresh, props.onDone);
  const busy = actions.pending || save.isPending;
  const row = useHeldWhile(props.row, busy);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  if (props.gone && !busy) return <p className="text-muted">Запись не найдена — возможно, её удалили.</p>;
  return (
    <>
      {row?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          <Field label={props.label} error={save.error?.fields?.name}>
            {(c) => (
              <input
                {...c}
                value={name}
                maxLength={props.max}
                onChange={(e) => {
                  setName(e.target.value);
                  save.reset();
                }}
                className={inputClass}
              />
            )}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={props.onDone} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {row && (
        <EntityActions
          archived={row.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(row.archivedAt !== null)}
          what={props.what}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}

/**
 * «Склады» (§4.5 спецификации «Склад»): склад у проекта — «Бар {проект}» одним нажатием — и группы товаров.
 * У проекта не больше одного склада; склад и группу можно переименовать и перевести в архив.
 */
export function WarehousesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const warehouses = useStockWarehouses(company.id);
  const groups = useStockGroups(company.id);
  const projects = useProjects(company.id);
  const [editWarehouse, setEditWarehouse] = useState<EditingId>(null);
  const [editGroup, setEditGroup] = useState<EditingId>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const editedWarehouse = useEditedItem(warehouses.data, editWarehouse);
  const editedGroup = useEditedItem(groups.data, editGroup);
  const create = useMutation<unknown, ApiError, { projectId: number; name: string }>({
    mutationFn: (body) => api(`/companies/${company.id}/stock/warehouses`, { method: 'POST', body }),
    onSuccess: () => invalidateStock(company.id),
    onError: (e) => setCreateError(e.fields?.projectId ?? e.message),
  });

  if (!warehouses.data || !groups.data || !projects.data) return <Pending queries={[warehouses, groups, projects]} />;
  const projectName = new Map(projects.data.map((p) => [p.id, p.name]));
  const free = projectsWithoutWarehouse(projects.data, warehouses.data);

  return (
    <section>
      <StaleNotice queries={[warehouses, groups, projects]} />
      <h1 className="mb-4 text-2xl font-bold">Склады</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <p className="mb-4 text-sm text-muted">У каждого проекта — клуба или магазина — не больше одного склада.</p>
      {createError && (
        <p role="alert" className={alertClass}>
          {createError}
        </p>
      )}
      <SettingsList
        label="Склады"
        search={false}
        rows={warehouses.data.map((w) => ({ id: w.id, name: w.name, secondary: projectName.get(w.projectId), archived: w.archivedAt !== null }))}
        addLabel={null}
        onEdit={readOnly ? undefined : (row) => setEditWarehouse(row.id)}
        empty="Складов пока нет."
      />
      {!readOnly && free.length > 0 && (
        <div className="mt-4 grid gap-2">
          <h2 className="text-sm font-semibold">Проекты без склада</h2>
          {free.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-field py-2">
              <span>{p.name}</span>
              <button
                type="button"
                disabled={create.isPending}
                onClick={() => {
                  setCreateError(null);
                  create.mutate({ projectId: p.id, name: defaultWarehouseName(p.name) });
                }}
                className={btnSmall}
              >
                Создать склад «{defaultWarehouseName(p.name)}»
              </button>
            </div>
          ))}
        </div>
      )}
      <h2 className="mt-8 mb-2 text-xl font-bold">Группы товаров</h2>
      <SettingsList
        label="Группы товаров"
        search={false}
        rows={groups.data.map((g) => ({ id: g.id, name: g.name, archived: g.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Добавить группу'}
        onAdd={() => setEditGroup('new')}
        onEdit={readOnly ? undefined : (row) => setEditGroup(row.id)}
        empty="Групп пока нет: «Напитки», «Еда» и т. п."
      />
      <Modal open={editWarehouse !== null} title="Склад" onClose={() => setEditWarehouse(null)} className="max-w-lg">
        {editWarehouse !== null && (
          <NameEditor
            key={editWarehouse}
            companyId={company.id}
            kind="warehouses"
            row={editedWarehouse.item}
            gone={editedWarehouse.gone}
            label="Название склада"
            what="склад"
            max={STOCK_WAREHOUSE_NAME_MAX}
            onDone={() => setEditWarehouse(null)}
          />
        )}
      </Modal>
      <Modal open={editGroup !== null} title={editGroup === 'new' ? 'Новая группа' : 'Группа товаров'} onClose={() => setEditGroup(null)} className="max-w-lg">
        {editGroup !== null && (
          <NameEditor
            key={editGroup}
            companyId={company.id}
            kind="groups"
            row={editedGroup.item}
            gone={editedGroup.gone}
            label="Название группы"
            what="группу"
            max={STOCK_GROUP_NAME_MAX}
            onDone={() => setEditGroup(null)}
          />
        )}
      </Modal>
    </section>
  );
}
```

Создайте `src/client/pages/stock/BalanceTab.tsx`:

```tsx
import { Fragment, useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { unitPrice } from '../../../shared/stock-qty';
import { Pending, StaleNotice } from '../../components/QueryState';
import { inputClass } from '../../components/ui';
import { useMeta } from '../../lib/query';
import { useCounterparties } from '../../lib/queries';
import { useStockBalance, useStockGroups, useStockItems } from '../../lib/stock';
import { balanceSections, markupText, qtyWithUnit } from '../../lib/stock-view';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle tabular-nums';
const flagClass = 'ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium';

/**
 * «Остатки» (§4.1 спецификации «Склад»): товар, остаток, себестоимость остатка, средняя цена закупки, цена продажи,
 * наценка; «Мало» ниже минимального остатка, «Нет партии» — продано без партии (остаток меньше нуля); раскрытая строка
 * показывает партии с датой, количеством, ценой закупки и поставщиком. Итог — стоимость склада.
 */
export function BalanceTab() {
  const { company, warehouse } = useOutletContext<StockOutletContext>();
  const balance = useStockBalance(company.id, warehouse);
  const items = useStockItems(company.id);
  const groups = useStockGroups(company.id);
  const counterparties = useCounterparties(company.id);
  const meta = useMeta();
  const [query, setQuery] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  if (!balance.data || !items.data || !groups.data || !meta.data) return <Pending queries={[balance, items, groups]} />;
  const tz = meta.data.timezone;
  const unitOf = new Map(items.data.map((i) => [i.id, i.unit]));
  const supplier = new Map((counterparties.data ?? []).map((c) => [c.id, c.name]));
  const sections = balanceSections(balance.data.items, items.data, groups.data, { showEmpty, query });
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <StaleNotice queries={[balance, items, groups]} />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <input type="search" aria-label="Поиск товара" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} max-w-xs`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} className="size-[18px] accent-income" />
          Показывать товары без остатка
        </label>
        <p className="ml-auto text-sm text-muted">
          Стоимость склада: <strong className="text-lg text-ink tabular-nums">{formatMoney(balance.data.total, company.baseCurrency, MONEY_SCREEN_BEFORE)}</strong>
        </p>
      </div>
      {sections.length === 0 ? (
        <p className="text-muted">{items.data.length === 0 ? 'Товаров пока нет — добавьте их во вкладке «Товары».' : 'Остатков нет. Оформите «Поступление» во вкладке «Документы».'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Остатки" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Товар
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Остаток
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Себестоимость
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Закупка, средняя
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Цена продажи
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Наценка
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.key} aria-label={s.title}>
                <tr>
                  <th scope="rowgroup" colSpan={6} className="bg-field/60 px-3 py-1.5 text-left text-xs font-semibold text-muted">
                    {s.title}
                  </th>
                </tr>
                {s.rows.map(({ item, balance: b }) => {
                  const expanded = open.has(item.id);
                  const canOpen = b.batches.length > 0;
                  return (
                    <Fragment key={item.id}>
                      <tr className={`border-b border-field ${item.archivedAt ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-2 align-middle">
                          {canOpen ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`Партии: ${item.name}`}
                              onClick={() => toggle(item.id)}
                              className="rounded text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                            >
                              <span aria-hidden="true" className="mr-1 inline-block w-3 text-muted">
                                {expanded ? '▾' : '▸'}
                              </span>
                              {item.name}
                            </button>
                          ) : (
                            <span className="font-medium">{item.name}</span>
                          )}
                          {b.low && <span className={`${flagClass} bg-field text-ink`}>Мало</span>}
                          {b.deficit > 0 && <span className={`${flagClass} bg-expense-soft text-expense-strong`}>Нет партии</span>}
                        </td>
                        <td className={`${tdClass} text-right ${b.qty < 0 ? 'text-expense-strong' : ''}`}>{qtyWithUnit(b.qty, item.unit)}</td>
                        <td className={`${tdClass} text-right`}>{money(b.cost)}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{b.avgCost === null ? '—' : money(b.avgCost)}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{b.salePrice > 0 ? money(b.salePrice) : '—'}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{markupText(b.markupBp)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-field bg-field/30">
                          <td colSpan={6} className="px-3 py-2">
                            <table aria-label={`Партии: ${item.name}`} className="w-full text-sm">
                              <thead>
                                <tr>
                                  <th scope="col" className={thClass}>
                                    Дата
                                  </th>
                                  <th scope="col" className={thClass}>
                                    Документ
                                  </th>
                                  <th scope="col" className={`${thClass} max-md:hidden`}>
                                    Поставщик
                                  </th>
                                  <th scope="col" className={`${thClass} text-right`}>
                                    Осталось
                                  </th>
                                  <th scope="col" className={`${thClass} text-right`}>
                                    Цена закупки
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {b.batches.map((batch) => (
                                  <tr key={batch.lineId}>
                                    <td className={tdClass}>{formatDateRu(todayInTimezone(tz, new Date(batch.at)))}</td>
                                    <td className={tdClass}>{batch.docNumber}</td>
                                    <td className={`${tdClass} max-md:hidden`}>{batch.counterpartyId === null ? '—' : (supplier.get(batch.counterpartyId) ?? '…')}</td>
                                    <td className={`${tdClass} text-right`}>
                                      {qtyWithUnit(batch.qtyLeft, unitOf.get(item.id) ?? item.unit)}
                                      {batch.qtyLeft !== batch.qtyIn && <span className="text-muted"> из {qtyWithUnit(batch.qtyIn, item.unit)}</span>}
                                    </td>
                                    <td className={`${tdClass} text-right`}>{money(unitPrice(batch.costIn, batch.qtyIn))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
```

Создайте `src/client/pages/stock/ItemsTab.tsx`:

```tsx
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { formatQty, UNIT_LABELS } from '../../../shared/stock-qty';
import { ItemEditor } from '../../components/stock/ItemEditor';
import { PriceDialog } from '../../components/stock/PriceDialog';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, inputClass, noticeClass } from '../../components/ui';
import { useMeta } from '../../lib/query';
import { useStockGroups, useStockItems, type StockItem } from '../../lib/stock';
import { filterItems, itemSections } from '../../lib/stock-view';
import { useEditedItem, type EditingId } from '../../lib/use-edited';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle';

/** «Товары» (§4.3 спецификации «Склад»): каталог компании по группам, цена продажи с историей, минимальный остаток. */
export function ItemsTab() {
  const { company } = useOutletContext<StockOutletContext>();
  const items = useStockItems(company.id);
  const groups = useStockGroups(company.id);
  const meta = useMeta();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditingId>(null);
  const [pricing, setPricing] = useState<StockItem | null>(null);
  const readOnly = company.archivedAt !== null;
  const edited = useEditedItem(items.data, editing);

  if (!items.data || !groups.data) return <Pending queries={[items, groups]} />;
  const sections = itemSections(filterItems(items.data, groups.data, query), groups.data);
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);

  return (
    <div>
      <StaleNotice queries={[items, groups]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Поиск товара" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} max-w-xs`} />
        {!readOnly && (
          <button type="button" aria-haspopup="dialog" onClick={() => setEditing('new')} className={btnPrimary}>
            + Товар
          </button>
        )}
      </div>
      {items.data.length === 0 ? (
        <p className="text-muted">Товаров пока нет. Добавьте первый — например, «Кола 0,5».</p>
      ) : sections.length === 0 ? (
        <p className="text-muted">Ничего не найдено.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Товары" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Название
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Ед.
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Штрихкод
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Цена продажи
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Мин. остаток
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.key} aria-label={s.title}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="bg-field/60 px-3 py-1.5 text-left text-xs font-semibold text-muted">
                    {s.title}
                  </th>
                </tr>
                {s.items.map((i) => (
                  <tr key={i.id} className={`border-b border-field hover:bg-field/40 ${i.archivedAt ? 'opacity-60' : ''}`}>
                    <td className={tdClass}>
                      <button type="button" aria-haspopup="dialog" onClick={() => setEditing(i.id)} className="rounded text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                        {i.name}
                      </button>
                      {i.archivedAt && <span className="ml-2 text-xs text-muted">в архиве</span>}
                    </td>
                    <td className={`${tdClass} max-md:hidden`}>{UNIT_LABELS[i.unit]}</td>
                    <td className={`${tdClass} max-md:hidden`}>{i.barcode ?? ''}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{i.salePrice > 0 ? money(i.salePrice) : '—'}</td>
                    <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{i.minQty === null ? '' : `${formatQty(i.minQty)} ${UNIT_LABELS[i.unit]}`}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый товар' : 'Товар'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <ItemEditor
            key={editing}
            companyId={company.id}
            baseCurrency={company.baseCurrency}
            item={edited.item}
            gone={edited.gone}
            groups={groups.data}
            readOnly={readOnly}
            onChangePrice={(item) => {
              setEditing(null);
              setPricing(item);
            }}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={pricing !== null} title={pricing ? `Цена продажи: ${pricing.name}` : 'Цена продажи'} onClose={() => setPricing(null)} className="max-w-md">
        {pricing && meta.data && (
          <PriceDialog
            key={pricing.id}
            companyId={company.id}
            baseCurrency={company.baseCurrency}
            timeZone={meta.data.timezone}
            item={items.data.find((i) => i.id === pricing.id) ?? pricing}
            onDone={() => setPricing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
```

Создайте `src/client/pages/StockPage.tsx`:

```tsx
import { Link, Navigate, NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router';
import { Pending } from '../components/QueryState';
import { inputClass, noticeClass } from '../components/ui';
import { useStockWarehouses, type StockWarehouse } from '../lib/stock';
import { DEFAULT_STOCK_TAB, STOCK_TABS, stockHref, warehouseParam } from '../lib/stock-view';
import type { Company } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Что получают подвкладки экрана «Склад»: компания, выбранный склад (null — все) и список складов. */
export interface StockOutletContext {
  company: Company;
  warehouse: number | null;
  warehouses: StockWarehouse[];
}

/** `…/stock` без подвкладки и неизвестные адреса: на подвкладку по умолчанию, склад из адреса остаётся. */
export function StockIndex() {
  const { company } = useOutletContext<StockOutletContext>();
  const { search } = useLocation();
  return <Navigate to={{ pathname: `/c/${company.id}/stock/${DEFAULT_STOCK_TAB}`, search }} replace />;
}

const pill = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-1.5 text-base font-semibold ${isActive ? 'bg-ink text-white' : 'bg-field text-muted hover:text-ink'}`;

/**
 * Экран «Склад» (§4 спецификации «Склад»): склад в адресе (`?warehouse=`), подвкладки «Остатки», «Документы», «Товары».
 * Маршрут не пересоздаёт страницу при смене компании — содержимое с key.
 */
export function StockPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const warehouses = useStockWarehouses(company.id);
  const [search, setSearch] = useSearchParams();
  if (!warehouses.data) {
    return (
      <section>
        <h1 className="mb-4 text-2xl font-bold">Склад</h1>
        <Pending queries={[warehouses]} />
      </section>
    );
  }
  const list = warehouses.data;
  const warehouse = warehouseParam(search, list);
  const pick = (value: string) => {
    const next = new URLSearchParams(search);
    if (value === '') next.delete('warehouse');
    else next.set('warehouse', value);
    setSearch(next, { replace: true });
  };

  return (
    <section key={company.id}>
      <h1 className="mb-4 text-2xl font-bold">Склад</h1>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Разделы склада" className="flex flex-wrap gap-2">
          {STOCK_TABS.map((t) => (
            <NavLink key={t.path} to={stockHref(company.id, t.path, warehouse)} className={pill}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        {list.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            Склад
            <select aria-label="Склад" value={warehouse ?? ''} onChange={(e) => pick(e.target.value)} className={`${inputClass} w-auto py-2`}>
              <option value="">Все склады</option>
              {list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.archivedAt ? ' (в архиве)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {list.length === 0 && (
        <p className={noticeClass}>
          Складов пока нет.{' '}
          <Link to={`/c/${company.id}/settings/warehouses`} className="font-semibold underline">
            Создайте склад в настройках
          </Link>
          : у каждого проекта — свой склад.
        </p>
      )}
      <Outlet context={{ company, warehouse, warehouses: list } satisfies StockOutletContext} />
    </section>
  );
}
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
  'flex min-h-12 w-full items-center rounded-xl px-3 text-left text-base font-medium text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Пользователи», «Настройки»
 * (экран списка разделов, §8.6), «История действий» (панель §3.4) и «Импорт из Excel» (панель импорта на весь экран,
 * §5.1 спецификации импорта; в архивной компании пункта нет). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
```

на

```tsx
  'flex min-h-12 w-full items-center rounded-xl px-3 text-left text-base font-medium text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Склад», «Пользователи», «Настройки»
 * (экран списка разделов, §8.6), «История действий» (панель §3.4) и «Импорт из Excel» (панель импорта на весь экран,
 * §5.1 спецификации импорта; в архивной компании пункта нет). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
  const inSettings = useMatch('/c/:companyId/settings/*') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
```

на

```tsx
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
  const inSettings = useMatch('/c/:companyId/settings/*') !== null;
  const inStock = useMatch('/c/:companyId/stock/*') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const stock = `/c/${company.id}/stock`;
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
        <NavLink to={journal} onClick={go(journal)} className={tabClass}>
          Журнал
        </NavLink>
        <Popover key={mobile ? 'phone' : 'wide'} label="Ещё" align="right" buttonClassName={inSettings ? `${tabBase} ${currentClass}` : tabClass} panelClassName="w-60">
          {(close) => (
            <ul className="flex flex-col">
              <li>
                <Link to={users} onClick={go(users, close)} className={itemClass}>
                  Пользователи
```

на

```tsx
        <NavLink to={journal} onClick={go(journal)} className={tabClass}>
          Журнал
        </NavLink>
        <Popover key={mobile ? 'phone' : 'wide'} label="Ещё" align="right" buttonClassName={inSettings || inStock ? `${tabBase} ${currentClass}` : tabClass} panelClassName="w-60">
          {(close) => (
            <ul className="flex flex-col">
              <li>
                <Link to={stock} onClick={go(stock, close)} className={itemClass}>
                  Склад
                </Link>
              </li>
              <li>
                <Link to={users} onClick={go(users, close)} className={itemClass}>
                  Пользователи
```

В `src/client/lib/audit-format.ts` замените

```ts
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
  import: 'Импорт',
};

export const ACTION_LABELS: Record<string, string> = {
```

на

```ts
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
  import: 'Импорт',
  stock_item: 'Товар',
  stock_group: 'Группа товаров',
  stock_warehouse: 'Склад',
  stock_doc: 'Документ склада',
};

export const ACTION_LABELS: Record<string, string> = {
```

В `src/client/lib/audit-format.ts` замените

```ts
  'fixed_rate',
  'attachment',
  'import',
] as const;

/** Сущности общей ленты экземпляра (записи без компании): пользователи и ручные курсы. */
```

на

```ts
  'fixed_rate',
  'attachment',
  'import',
  'stock_item',
  'stock_group',
  'stock_warehouse',
  'stock_doc',
] as const;

/** Сущности общей ленты экземпляра (записи без компании): пользователи и ручные курсы. */
```

В `src/client/lib/settings-sections.ts` замените

```ts
        { path: 'categories', label: 'Категории' },
        { path: 'projects', label: 'Проекты' },
        { path: 'tags', label: 'Теги' },
        { path: 'users', label: 'Пользователи' },
        { path: 'rates', label: 'Фиксированные курсы валют' },
        { path: 'backup', label: 'Резервное копирование' },
```

на

```ts
        { path: 'categories', label: 'Категории' },
        { path: 'projects', label: 'Проекты' },
        { path: 'tags', label: 'Теги' },
        { path: 'warehouses', label: 'Склады' },
        { path: 'users', label: 'Пользователи' },
        { path: 'rates', label: 'Фиксированные курсы валют' },
        { path: 'backup', label: 'Резервное копирование' },
```

В `src/client/pages/CompanyLayout.tsx` замените

```tsx
                    <NavLink to={`/c/${company.id}/log`} className={tab}>
                      Журнал
                    </NavLink>
                  </nav>
                  <Outlet context={{ company } satisfies CompanyOutletContext} />
                </main>
```

на

```tsx
                    <NavLink to={`/c/${company.id}/log`} className={tab}>
                      Журнал
                    </NavLink>
                    <NavLink to={`/c/${company.id}/stock`} className={tab}>
                      Склад
                    </NavLink>
                  </nav>
                  <Outlet context={{ company } satisfies CompanyOutletContext} />
                </main>
```

Замените всё содержимое `src/client/router.tsx` на:

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { CompanyGate } from './pages/CompanyGate';
import { CompanyLayout } from './pages/CompanyLayout';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NewCompanyPage } from './pages/NewCompanyPage';
import { RequireAuth } from './pages/RequireAuth';
import { StockIndex, StockPage } from './pages/StockPage';
import { BalanceTab } from './pages/stock/BalanceTab';
import { ItemsTab } from './pages/stock/ItemsTab';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';
import { AccountsSettings } from './pages/settings/AccountsSettings';
import { CategoriesSettings } from './pages/settings/CategoriesSettings';
import { CounterpartiesSettings } from './pages/settings/CounterpartiesSettings';
import { TagsSettings } from './pages/settings/TagsSettings';
import { WarehousesSettings } from './pages/settings/WarehousesSettings';
import { SplitPresetsSettings } from './pages/settings/SplitPresetsSettings';
import { RatesSettings } from './pages/settings/RatesSettings';
import { ProfileSettings } from './pages/settings/ProfileSettings';
import { UsersSettings } from './pages/settings/UsersSettings';
import { AuditSettings } from './pages/settings/AuditSettings';
import { BackupSettings } from './pages/settings/BackupSettings';
import { JournalViewSettings } from './pages/settings/JournalViewSettings';
import { SettingsIndex, SettingsLayout, SettingsRedirect } from './pages/settings/SettingsLayout';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <CompanyGate /> },
      { path: 'companies/new', element: <NewCompanyPage /> },
      {
        path: 'c/:companyId',
        element: <CompanyLayout />,
        children: [
          { index: true, element: <Navigate to="log" replace /> },
          { path: 'log', element: <JournalPage /> },
          {
            path: 'stock',
            element: <StockPage />,
            children: [
              { index: true, element: <StockIndex /> },
              { path: 'balance', element: <BalanceTab /> },
              { path: 'items', element: <ItemsTab /> },
              { path: '*', element: <StockIndex /> },
            ],
          },
          {
            path: 'settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsIndex /> },
              { path: 'profile', element: <ProfileSettings /> },
              { path: 'companies', element: <CompaniesSettings /> },
              { path: 'counterparties', element: <CounterpartiesSettings /> },
              { path: 'accounts', element: <AccountsSettings /> },
              { path: 'categories', element: <CategoriesSettings /> },
              { path: 'projects', element: <ProjectsSettings /> },
              { path: 'projects/split-presets', element: <SplitPresetsSettings /> },
              { path: 'split-presets', element: <SettingsRedirect section="projects/split-presets" /> },
              { path: 'tags', element: <TagsSettings /> },
              { path: 'warehouses', element: <WarehousesSettings /> },
              { path: 'users', element: <UsersSettings /> },
              { path: 'rates', element: <RatesSettings /> },
              { path: 'backup', element: <BackupSettings /> },
              { path: 'journal', element: <JournalViewSettings /> },
              { path: 'audit', element: <AuditSettings /> },
              { path: '*', element: <SettingsRedirect section="counterparties" /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
```

- [ ] **Step 4: Run tests, typecheck and e2e**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e` (два раза подряд).
Expected: `npm test` - 1231 пройдено и 1 пропущен, typecheck без ошибок, e2e — 174 из 174.

- [ ] **Step 5: Commit**

```bash
git add src tests e2e
git commit -m "feat: экран «Склад» — товары, остатки, склады в настройках (Склад-1b, задача 1)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: «Документы» и форма поступления, продажи, списания (§4.2, §5.3, §5.4)

**Files:**
- Create: `src/client/components/stock/DocForm.tsx`, `src/client/lib/stock-doc-form.ts`, `src/client/pages/stock/DocsTab.tsx`
- Modify: `src/client/lib/stock-view.ts`, `src/client/router.tsx`
- Test: `e2e/stock.spec.ts`, `tests/client/stock-doc-form.test.ts` (новый)

**Interfaces:**
- Consumes: из задачи 1 — `useStockItems`, `useStockWarehouses`, `useStockDocs`, `invalidateStock`, `StockOutletContext`; `DateTimeField`, `ComboSelect`, `createFromForm`, `counterpartyOptions`, `paidAtFor`, `paidDateOf`, `shownPaidTime`, `useNow`, `ConfirmDialog`; API `POST|PATCH|DELETE docs` с `dryRun`.
- Produces:
  - `DocDraft`, `DocLineDraft`, `emptyDocDraft`, `setLineQty|setLinePrice|setLineAmount|setLineItem`, `buildDocBody(draft, ctx)`, `draftFromDoc`, `draftTotal`, `impactText(impact, timeZone)`, `docTitle`, `docSubmitLabel`, `paymentState` (`lib/stock-doc-form.ts`);
  - `<DocForm company request onClose>` с `DocFormRequest = {kind:'create', type, warehouse} | {kind:'edit', id}`; `<DocsTab>`; маршрут `/c/:id/stock/docs`; вкладка «Документы» (`STOCK_TABS`).

- [ ] **Step 1: Write the failing tests**

Создайте `tests/client/stock-doc-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StockDoc } from '../../src/client/lib/stock';
import {
  buildDocBody,
  docSubmitLabel,
  docTitle,
  draftFromDoc,
  draftTotal,
  emptyDocDraft,
  impactText,
  isBlankLine,
  newDocLine,
  paymentState,
  setLineAmount,
  setLineItem,
  setLinePrice,
  setLineQty,
  type DocContext,
  type DocDraft,
  type ItemInfo,
} from '../../src/client/lib/stock-doc-form';

const TZ = 'Asia/Almaty';
const NOW = new Date('2026-10-06T12:00:00.000Z'); // 17:00, 06.10.2026
const cola: ItemInfo = { id: 1, unit: 'pcs', prices: [{ price: 50_000, validFrom: '2026-09-01' }, { price: 55_000, validFrom: '2026-10-05' }] };
const syrup: ItemInfo = { id: 2, unit: 'l', prices: [] };
const items = new Map([cola, syrup].map((i) => [i.id, i]));
const ctx = (over: Partial<DocContext> = {}): DocContext => ({ items, currency: 'KZT', today: '2026-10-06', timeZone: TZ, now: NOW, timeOfDayFrom: NOW, ...over });

const line = (over: Partial<ReturnType<typeof newDocLine>> = {}) => ({ ...newDocLine(), ...over });

describe('связь цены и суммы строки', () => {
  it('цена × количество = сумма, до тиына', () => {
    const l = setLinePrice(line({ qty: '3' }), '33,33', 'pcs', 'KZT');
    expect(l).toMatchObject({ price: '33,33', amount: '99,99', driver: 'price' });
    expect(setLinePrice(line({ qty: '1,5' }), '10', 'l', 'KZT').amount).toBe('15');
  });

  it('сумма / количество = цена; сумма остаётся ровно той, что ввели', () => {
    const l = setLineAmount(line({ qty: '3' }), '100', 'pcs', 'KZT');
    expect(l).toMatchObject({ amount: '100', price: '33,33', driver: 'amount' });
  });

  it('смена количества: после правки цены пересчитывается сумма, после правки суммы — цена', () => {
    const byPrice = setLineQty(setLinePrice(line({ qty: '2' }), '10', 'pcs', 'KZT'), '5', 'pcs', 'KZT');
    expect(byPrice).toMatchObject({ qty: '5', price: '10', amount: '50' });
    const byAmount = setLineQty(setLineAmount(line({ qty: '2' }), '100', 'pcs', 'KZT'), '4', 'pcs', 'KZT');
    expect(byAmount).toMatchObject({ qty: '4', amount: '100', price: '25' });
  });

  it('пока количество не разобрано, второе поле не трогается; пустое поле очищает связанное', () => {
    expect(setLinePrice(line({ qty: '' }), '10', 'pcs', 'KZT').amount).toBe('');
    expect(setLineQty(line({ price: '10' }), '1,5', 'pcs', 'KZT')).toMatchObject({ qty: '1,5', amount: '' }); // у штук дроби нет
    expect(setLineAmount(setLineAmount(line({ qty: '2' }), '50', 'pcs', 'KZT'), '', 'pcs', 'KZT')).toMatchObject({ amount: '', price: '' });
    expect(setLinePrice(setLinePrice(line({ qty: '2' }), '10', 'pcs', 'KZT'), '', 'pcs', 'KZT')).toMatchObject({ price: '', amount: '' });
  });

  it('выбор товара в продаже подставляет цену продажи на дату документа', () => {
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-06', 'KZT')).toMatchObject({ itemId: 1, price: '550', amount: '1100' });
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-01', 'KZT')).toMatchObject({ price: '500', amount: '1000' });
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-08-01', 'KZT')).toMatchObject({ itemId: 1, price: '', amount: '' }); // цены тогда ещё не было
    expect(setLineItem(line(), 1, cola, 'sale', '2026-10-06', 'KZT')).toMatchObject({ price: '550', amount: '' });
    expect(setLineItem(line(), 1, cola, 'receipt', '2026-10-06', 'KZT')).toMatchObject({ itemId: 1, price: '' });
    expect(setLineItem(line({ itemId: 1 }), null, undefined, 'sale', '2026-10-06', 'KZT').itemId).toBeNull();
  });

  it('итог — сумма разобранных сумм строк', () => {
    const d = { lines: [line({ amount: '100,50' }), line({ amount: '' }), line({ amount: 'x' }), line({ amount: '2' })] };
    expect(draftTotal(d, 'KZT')).toBe(10_250);
    expect(isBlankLine(line())).toBe(true);
    expect(isBlankLine(line({ qty: '1' }))).toBe(false);
  });
});

describe('buildDocBody', () => {
  const base = (over: Partial<DocDraft> = {}): DocDraft => ({
    ...emptyDocDraft('receipt', '2026-10-06', 7),
    counterpartyId: 3,
    lines: [line({ itemId: 1, qty: '10', price: '100', amount: '1000', driver: 'price' }), line()],
    ...over,
  });

  it('поступление: пустые строки пропускаются, количество и суммы — в тысячных и тиынах, момент — «сейчас»', () => {
    const r = buildDocBody(base(), ctx());
    expect(r).toEqual({
      ok: true,
      body: {
        type: 'receipt',
        at: '2026-10-06T12:00:00.000Z',
        warehouseId: 7,
        counterpartyId: 3,
        reason: null,
        comment: null,
        lines: [{ itemId: 1, qty: 10_000, amount: 100_000 }],
      },
    });
  });

  it('литры с дробью; продажа несёт контрагента; комментарий очищается', () => {
    const r = buildDocBody(base({ type: 'sale', comment: '  смена 1 ', lines: [line({ itemId: 2, qty: '1,5', amount: '12,5' })] }), ctx());
    expect(r).toMatchObject({ ok: true, body: { type: 'sale', comment: 'смена 1', counterpartyId: 3, lines: [{ itemId: 2, qty: 1500, amount: 1250 }] } });
  });

  it('списание: без сумм и контрагента, причина обязательна', () => {
    const d = base({ type: 'writeoff', reason: 'spoiled', counterpartyId: 3, lines: [line({ itemId: 1, qty: '2', amount: '999' })] });
    expect(buildDocBody(d, ctx())).toMatchObject({ ok: true, body: { type: 'writeoff', reason: 'spoiled', counterpartyId: null, lines: [{ itemId: 1, qty: 2000, amount: null }] } });
    expect(buildDocBody({ ...d, reason: null }, ctx())).toEqual({ ok: false, errors: { reason: 'Укажите причину списания' } });
  });

  it('ошибки по полям: склад, товар, количество штук, сумма, пустой документ', () => {
    expect(buildDocBody(base({ warehouseId: null }), ctx())).toEqual({ ok: false, errors: { warehouseId: 'Выберите склад' } });
    expect(buildDocBody(base({ lines: [line(), line()] }), ctx())).toEqual({ ok: false, errors: { lines: 'Добавьте хотя бы одну строку' } });
    const r = buildDocBody(base({ lines: [line({ qty: '1' }), line({ itemId: 1, qty: '1,5', amount: '' }), line({ itemId: 2, qty: '', amount: '-1' })] }), ctx());
    expect(r).toEqual({
      ok: false,
      errors: {
        'lines.0.itemId': 'Выберите товар',
        'lines.1.qty': 'Количество в штуках — целое',
        'lines.1.amount': 'Укажите сумму',
        'lines.2.qty': 'Введите количество',
        'lines.2.amount': 'Сумма не меньше нуля',
      },
    });
  });

  it('дата: будущая — ошибка; руками заданное время позже «сейчас» — ошибка; прошлый день сохраняет время суток', () => {
    expect(buildDocBody(base({ paidDate: '2026-10-07', paidDateSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Дата документа в будущем — так нельзя' } });
    expect(buildDocBody(base({ paidTime: '23:30', paidTimeSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Это время ещё не наступило' } });
    expect(buildDocBody(base({ paidTime: '25:00', paidTimeSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Укажите время в виде ЧЧ:ММ' } });
    const past = buildDocBody(base({ paidDate: '2026-10-01', paidDateSet: true }), ctx());
    expect(past).toMatchObject({ ok: true, body: { at: '2026-10-01T12:00:00.000Z' } });
    const timed = buildDocBody(base({ paidDate: '2026-10-01', paidDateSet: true, paidTime: '09:15', paidTimeSet: true }), ctx());
    expect(timed).toMatchObject({ ok: true, body: { at: '2026-10-01T04:15:00.000Z' } }); // 09:15 по Алматы (UTC+5)
  });

  it('правка без смены даты и времени: момент документа как есть, с секундами', () => {
    const d = base({ paidDate: '2026-10-05', paidDateSet: true, paidTime: '10:00' });
    const r = buildDocBody(d, ctx({ originalAt: '2026-10-05T05:00:07.123Z', timeOfDayFrom: new Date('2026-10-05T05:00:07.123Z') }));
    expect(r).toMatchObject({ ok: true, body: { at: '2026-10-05T05:00:07.123Z' } });
  });
});

describe('draftFromDoc', () => {
  it('сумма и количество — текст полей, цена = сумма / количество, момент — день и время по поясу', () => {
    const doc = {
      id: 5,
      type: 'sale',
      number: 'Р-0001',
      at: '2026-10-05T05:30:00.000Z',
      warehouseId: 7,
      counterpartyId: 3,
      reason: null,
      comment: 'смена',
      version: 2,
      total: 0,
      linesCount: 1,
      paid: 0,
      posted: false,
      lines: [{ id: 1, position: 0, itemId: 2, qty: 1500, amount: 1250, cost: null, uncovered: 0 }],
      payments: [],
      posting: null,
      lastPost: null,
      deletedAt: null,
    } as StockDoc;
    const d = draftFromDoc(doc, items, 'KZT', TZ);
    expect(d).toMatchObject({ type: 'sale', warehouseId: 7, counterpartyId: 3, paidDate: '2026-10-05', paidDateSet: true, paidTime: '10:30', paidTimeSet: false, comment: 'смена' });
    expect(d.lines[0]).toMatchObject({ itemId: 2, qty: '1,5', amount: '12,5', price: '8,33', driver: 'amount' });
  });
});

describe('тексты', () => {
  it('заголовок и кнопка', () => {
    expect(docTitle('receipt', null)).toBe('Новое поступление');
    expect(docTitle('sale', 'Р-0003')).toBe('Продажа Р-0003');
    expect(docTitle('writeoff', null)).toBe('Новое списание');
    expect(docSubmitLabel('sale', false)).toBe('Добавить продажу');
    expect(docSubmitLabel('sale', true)).toBe('Сохранить изменения');
  });

  it('предупреждение о себестоимости: числа в родительном падеже, дата по поясу', () => {
    const since = '2026-10-01T10:00:00.000Z';
    expect(impactText({ sales: 0, writeoffs: 0, since: null }, TZ)).toBeNull();
    expect(impactText({ sales: 1, writeoffs: 0, since }, TZ)).toBe('Изменится себестоимость 1 продажи после 01.10.2026');
    expect(impactText({ sales: 3, writeoffs: 0, since }, TZ)).toBe('Изменится себестоимость 3 продаж после 01.10.2026');
    expect(impactText({ sales: 21, writeoffs: 1, since }, TZ)).toBe('Изменится себестоимость 21 продажи и 1 списания после 01.10.2026');
    expect(impactText({ sales: 0, writeoffs: 5, since }, TZ)).toBe('Изменится себестоимость 5 списаний после 01.10.2026');
  });

  it('состояние оплаты поступления', () => {
    expect(paymentState(100, 0)).toEqual({ kind: 'none', debt: 100 });
    expect(paymentState(100, 40)).toEqual({ kind: 'partial', debt: 60 });
    expect(paymentState(100, 100)).toEqual({ kind: 'paid', debt: 0 });
    expect(paymentState(100, 130)).toEqual({ kind: 'over', debt: -30 });
  });
});
```

В `e2e/stock.spec.ts` замените

```ts
  await main(page).getByRole('link', { name: 'Товары' }).click();
  await expect(page).toHaveURL(new RegExp(`/stock/items\\?warehouse=${s.warehouse2}$`));
});
```

на

```ts
  await main(page).getByRole('link', { name: 'Товары' }).click();
  await expect(page).toHaveURL(new RegExp(`/stock/items\\?warehouse=${s.warehouse2}$`));
});

test('документы: поступление → продажа → остаток и себестоимость; правка закупки предупреждает; списание без остатка — ошибка; удаление продажи', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Документы ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await expect(main(page).getByText('Документов пока нет.')).toBeVisible();

  const pick = async (scope: ReturnType<Page['locator']>, name: string, option: string) => {
    await scope.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option }).click();
  };

  // поступление: две строки, цена и сумма связаны
  await main(page).getByRole('button', { name: '+ Поступление' }).click();
  const receipt = page.getByRole('dialog', { name: 'Новое поступление' });
  await expect(receipt.getByLabel('Склад', { exact: true })).toHaveValue(String(s.warehouse));
  await pick(receipt, 'Поставщик', 'Поставщик А');
  const line1 = receipt.getByRole('group', { name: 'Строка 1' });
  await pick(line1, 'Товар', 'Кола 0,5');
  await line1.getByLabel('Количество, шт').fill('10');
  await line1.getByLabel('Сумма, ₸').fill('1000');
  await expect(line1.getByLabel('Цена, ₸')).toHaveValue('100');
  await receipt.getByRole('button', { name: '+ Добавить строку' }).click();
  const line2 = receipt.getByRole('group', { name: 'Строка 2' });
  await pick(line2, 'Товар', 'Чипсы');
  await line2.getByLabel('Количество, шт').fill('3');
  await line2.getByLabel('Цена, ₸').fill('70');
  await expect(line2.getByLabel('Сумма, ₸')).toHaveValue('210');
  await expect(receipt.locator('p', { hasText: 'Итого:' })).toContainText(/1\s*210\s*₸/);
  await receipt.getByRole('button', { name: 'Добавить поступление' }).click();
  await expect(receipt).toBeHidden();
  const table = main(page).getByRole('table', { name: 'Документы' });
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/1\s*210\s*₸/);

  // продажа: цена по умолчанию — цена продажи товара
  await main(page).getByRole('button', { name: '+ Продажа' }).click();
  const sale = page.getByRole('dialog', { name: 'Новая продажа' });
  const saleLine = sale.getByRole('group', { name: 'Строка 1' });
  await pick(saleLine, 'Товар', 'Кола 0,5');
  await expect(saleLine.getByLabel('Цена, ₸')).toHaveValue('500');
  await saleLine.getByLabel('Количество, шт').fill('4');
  await expect(saleLine.getByLabel('Сумма, ₸')).toHaveValue('2000');
  await sale.getByRole('button', { name: 'Добавить продажу' }).click();
  await expect(sale).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toContainText(/2\s*000\s*₸/);

  // «Остатки»: 6 по 100 ₸
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  const balance = main(page).getByRole('table', { name: 'Остатки' });
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('6 шт');
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText(/600\s*₸/);

  // правка закупки пересчитывает проданное: окно предупреждает
  await main(page).getByRole('link', { name: 'Документы', exact: true }).click();
  await table.getByRole('button', { name: /^Открыть поступление/ }).click();
  const edit = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await edit.getByRole('group', { name: 'Строка 1' }).getByLabel('Сумма, ₸').fill('2000');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Изменится себестоимость' });
  await expect(ask).toContainText('Изменится себестоимость 1 продажи после');
  await ask.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText(/1\s*200\s*₸/); // 6 по 200

  // ручное списание больше остатка — ошибка с названием и остатком, документ не создаётся
  await main(page).getByRole('link', { name: 'Документы', exact: true }).click();
  await main(page).getByRole('button', { name: '+ Списание' }).click();
  const writeoff = page.getByRole('dialog', { name: 'Новое списание' });
  const woLine = writeoff.getByRole('group', { name: 'Строка 1' });
  await pick(woLine, 'Товар', 'Кола 0,5');
  await woLine.getByLabel('Количество, шт').fill('100');
  await writeoff.getByRole('button', { name: 'Добавить списание' }).click();
  await expect(writeoff.getByRole('alert')).toContainText('Не хватает «Кола 0,5»: на складе 6 шт на');
  await woLine.getByLabel('Количество, шт').fill('2');
  await writeoff.getByLabel('Причина списания').selectOption({ label: 'Испорчено' });
  await writeoff.getByRole('button', { name: 'Добавить списание' }).click();
  await expect(writeoff).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'С-0001' })).toContainText('Испорчено');

  // удаление продажи возвращает товар на склад
  await table.getByRole('button', { name: /^Открыть продажа/ }).click();
  const saleEdit = page.getByRole('dialog', { name: 'Продажа Р-0001' });
  await saleEdit.getByRole('button', { name: 'Удалить документ' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить документ?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(saleEdit).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toHaveCount(0);
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('8 шт'); // 10 \u2212 2 списанных
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/stock-doc-form.test.ts` и `npx playwright test e2e/stock.spec.ts -g "документы"`
Expected: FAIL — файлы тестов:  1 failed (1) | тесты:  не запустились: нет импортируемого модуля; e2e: нет вкладки «Документы».

- [ ] **Step 3: Write the implementation**

Создайте `src/client/components/stock/DocForm.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { WRITEOFF_REASON_LABELS, WRITEOFF_REASONS, type StockDocType, type WriteoffReason } from '../../../shared/schemas/stock';
import { UNIT_LABELS } from '../../../shared/stock-qty';
import { api, ApiError } from '../../lib/api';
import { dayOf } from '../../lib/journal-format';
import { createFromForm } from '../../lib/operation-create';
import { shownPaidTime } from '../../lib/operation-form';
import { counterpartyOptions } from '../../lib/operation-options';
import { useCounterparties, type Company, type Counterparty } from '../../lib/queries';
import { useMeta } from '../../lib/query';
import {
  buildDocBody,
  docSubmitLabel,
  docTitle,
  draftFromDoc,
  draftTotal,
  emptyDocDraft,
  impactText,
  newDocLine,
  setLineAmount,
  setLineItem,
  setLinePrice,
  setLineQty,
  DOC_COMMENT_MAX,
  type DocBody,
  type DocDraft,
  type DocLineDraft,
  type ItemInfo,
} from '../../lib/stock-doc-form';
import { invalidateStock, useStockItems, useStockWarehouses, type DocImpact, type StockDoc, type StockItem, type StockWarehouse } from '../../lib/stock';
import { useNow } from '../../lib/use-now';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { DateTimeField } from '../operation/DateTimeField';
import { Pending } from '../QueryState';
import { alertClass, btnDanger, btnIcon, btnSecondary, floatingControlClass, floatingTextareaClass, noticeClass, phoneFullScreenModal } from '../ui';
import { NumberInput } from './NumberInput';

/** Что открыть: новый документ типа или существующий по id. */
export type DocFormRequest = { kind: 'create'; type: StockDocType; warehouse: number | null } | { kind: 'edit'; id: number };

const MODAL_CLASS = `max-w-3xl ${phoneFullScreenModal}`;

interface SaveResult {
  doc: StockDoc | null;
  impact: DocImpact;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');

/**
 * Форма документа «Поступление», «Продажа», «Списание» (§4.2 спецификации «Склад»): дата и время, склад, поставщик или
 * покупатель, причина списания; строки «товар, количество, цена, сумма» (цена и сумма связаны); итог. Перед записью
 * сервер считает последствия (`dryRun`): если изменится себестоимость уже проведённых продаж — окно предупреждает (§5.4).
 */
export function DocForm(props: { company: Company; request: DocFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const editId = props.request.kind === 'edit' ? props.request.id : null;
  const doc = useQuery<StockDoc, ApiError>({
    queryKey: ['stock', props.company.id, 'doc', editId],
    queryFn: async () => (await api<{ doc: StockDoc }>(`/companies/${props.company.id}/stock/docs/${editId}`)).doc,
    enabled: editId !== null,
    gcTime: 0,
  });
  const meta = useMeta();
  const items = useStockItems(props.company.id);
  const warehouses = useStockWarehouses(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const cancel = useRef<() => void>(() => setOpen(false));
  const type = props.request.kind === 'create' ? props.request.type : doc.data?.type;
  const ready = meta.data && items.data && warehouses.data && counterparties.data && (editId === null || doc.data);

  return (
    <Modal open={open} title={type ? docTitle(type, doc.data?.number ?? null) : 'Документ'} onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS} phoneFullScreen>
      {ready && type ? (
        <DocEditor
          company={props.company}
          timeZone={meta.data.timezone}
          items={items.data}
          warehouses={warehouses.data}
          counterparties={counterparties.data}
          type={type}
          initialWarehouse={props.request.kind === 'create' ? props.request.warehouse : null}
          doc={doc.data ?? null}
          close={() => setOpen(false)}
          cancelRef={cancel}
        />
      ) : (
        <Pending queries={[meta, items, warehouses, counterparties, ...(editId !== null ? [doc] : [])]} />
      )}
    </Modal>
  );
}

function DocEditor(p: {
  company: Company;
  timeZone: string;
  items: StockItem[];
  warehouses: StockWarehouse[];
  counterparties: Counterparty[];
  type: StockDocType;
  initialWarehouse: number | null;
  /** Правка существующего документа; null — новый. */
  doc: StockDoc | null;
  close: () => void;
  cancelRef: MutableRefObject<() => void>;
}) {
  const currency = getCurrency(p.company.baseCurrency);
  const clock = useNow(p.timeZone);
  const readOnly = p.company.archivedAt !== null;
  const itemInfo = new Map<number, ItemInfo>(p.items.map((i) => [i.id, { id: i.id, unit: i.unit, prices: i.prices }]));
  const itemById = new Map(p.items.map((i) => [i.id, i]));
  const [doc, setDoc] = useState(p.doc);
  const [initial, setInitial] = useState<DocDraft>(() => {
    if (p.doc) return draftFromDoc(p.doc, itemInfo, p.company.baseCurrency, p.timeZone);
    const active = p.warehouses.filter((w) => !w.archivedAt);
    const warehouseId = p.initialWarehouse ?? (active.length === 1 ? active[0]!.id : null);
    return emptyDocDraft(p.type, todayInTimezone(p.timeZone), warehouseId);
  });
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  /** Вопрос о последствиях правки (§5.4): текст и действие «Сохранить» / «Удалить». */
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: () => Promise<void> } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const type = p.type;
  const base = `/companies/${p.company.id}/stock/docs`;
  const docDay = draft.paidDateSet ? draft.paidDate : clock.today;

  p.cancelRef.current = () => {
    if (pending) return;
    if (dirty && !readOnly) setConfirmClose(true);
    else p.close();
  };

  const set = (patch: Partial<DocDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k) && !errorKeys.some((x) => k.startsWith(`${x}.`)))));
  };
  const setLine = (key: number, fn: (l: DocLineDraft) => DocLineDraft, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? fn(l) : l)) }));
    setErrors((e) => {
      const index = draft.lines.findIndex((l) => l.key === key);
      return Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.some((x) => k === `lines.${index}.${x}`) && k !== 'lines'));
    });
  };

  /** Тело запроса из черновика; ошибки — на поля. */
  const body = (): DocBody | null => {
    const now = new Date();
    const r = buildDocBody(draft, {
      items: itemInfo,
      currency: p.company.baseCurrency,
      today: todayInTimezone(p.timeZone, now),
      timeZone: p.timeZone,
      now,
      timeOfDayFrom: doc ? new Date(doc.at) : now,
      originalAt: doc?.at,
    });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      return null;
    }
    return r.body;
  };

  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && doc) {
      setConflict(true);
      return;
    }
    setErrors(e instanceof ApiError ? (e.fields ?? {}) : {});
    setFormError(errorText(e));
  };

  /** Запись документа: создание или правка (в правке уходят все поля — сервер сам отбросит неизменённое). */
  const write = async (b: DocBody, dryRun: boolean): Promise<SaveResult> => {
    if (doc) {
      const { type: _type, ...fields } = b;
      return api<SaveResult>(`${base}/${doc.id}`, { method: 'PATCH', body: { version: doc.version, ...fields, dryRun } });
    }
    return api<SaveResult>(base, { method: 'POST', body: { ...b, dryRun } });
  };

  const commit = async (b: DocBody) => {
    setPending(true);
    try {
      await write(b, false);
      await invalidateStock(p.company.id);
      p.close();
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
      setAsk(null);
    }
  };

  const submit = async () => {
    if (pending || readOnly) return;
    setFormError(null);
    const b = body();
    if (!b) return;
    setPending(true);
    try {
      const dry = await write(b, true);
      const text = impactText(dry.impact, p.timeZone);
      if (text) {
        setAsk({ title: 'Изменится себестоимость', text, confirm: 'Сохранить', danger: false, run: () => commit(b) });
        return;
      }
    } catch (e) {
      failed(e);
      return;
    } finally {
      setPending(false);
    }
    await commit(b);
  };

  const askDelete = async () => {
    if (!doc || pending) return;
    setFormError(null);
    setPending(true);
    try {
      const dry = await api<SaveResult>(`${base}/${doc.id}?dryRun=1`, { method: 'DELETE' });
      const text = impactText(dry.impact, p.timeZone);
      setAsk({
        title: 'Удалить документ?',
        text: text ?? 'Остатки и себестоимость будут пересчитаны так, будто документа не было.',
        confirm: 'Удалить',
        danger: true,
        run: async () => {
          setPending(true);
          try {
            await api(`${base}/${doc.id}`, { method: 'DELETE' });
            await invalidateStock(p.company.id);
            p.close();
          } catch (e) {
            failed(e);
          } finally {
            setPending(false);
            setAsk(null);
          }
        },
      });
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
    }
  };

  const reload = async () => {
    if (!doc) return;
    setPending(true);
    try {
      const fresh = (await api<{ doc: StockDoc }>(`${base}/${doc.id}`)).doc;
      const next = draftFromDoc(fresh, itemInfo, p.company.baseCurrency, p.timeZone);
      setDoc(fresh);
      setDraft(next);
      setInitial(next);
      setConflict(false);
      setErrors({});
      setFormError(null);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const createItem = async (name: string, key: number): Promise<boolean> => {
    setFormError(null);
    try {
      const created = (await api<{ item: StockItem }>(`/companies/${p.company.id}/stock/items`, { method: 'POST', body: { name, unit: 'pcs' } })).item;
      await invalidateStock(p.company.id);
      setLine(key, (l) => setLineItem(l, created.id, { id: created.id, unit: created.unit, prices: created.prices }, type, docDay, p.company.baseCurrency), 'itemId');
      return true;
    } catch (e) {
      setFormError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
      return false;
    }
  };
  const createCounterparty = async (name: string): Promise<boolean> => {
    setFormError(null);
    try {
      const id = await createFromForm(p.company.id, 'counterparty', name, { kind: 'expense', counterpartyType: type === 'receipt' ? 'supplier' : 'client' });
      set({ counterpartyId: id }, 'counterpartyId');
      return true;
    } catch (e) {
      setFormError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
      return false;
    }
  };

  const total = draftTotal(draft, p.company.baseCurrency);
  const money = (minor: number) => formatMoney(minor, p.company.baseCurrency, MONEY_SCREEN);
  const hasAmounts = type !== 'writeoff';
  const usedItems = new Set(doc?.lines.map((l) => l.itemId) ?? []);
  const itemOptions = (selected: number | null) =>
    p.items.filter((i) => !i.archivedAt || i.id === selected || usedItems.has(i.id)).map((i) => ({ id: i.id, label: i.name, suffix: UNIT_LABELS[i.unit] }));
  const warehouseOptions = p.warehouses.filter((w) => !w.archivedAt || w.id === draft.warehouseId);
  const counterpartyLabel = type === 'receipt' ? 'Поставщик' : 'Покупатель';
  const preferred = type === 'receipt' ? 'supplier' : 'client';
  const originalDay = doc ? dayOf(doc.at, p.timeZone) : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <>
      <form ref={formRef} noValidate onSubmit={onSubmit} aria-label="Документ склада" className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {readOnly && <p className={`${noticeClass} mb-0`}>Компания в архиве — изменения недоступны.</p>}
        {doc?.deletedAt && <p className={`${noticeClass} mb-0`}>Документ удалён.</p>}
        <fieldset disabled={pending || readOnly} className="contents">
          <div className="grid gap-4 md:grid-cols-2">
            <DateTimeField
              label="Дата и время"
              date={docDay}
              time={shownPaidTime({ paidDate: docDay, paidTime: draft.paidTime, paidTimeSet: draft.paidTimeSet }, clock.time, clock.today, originalDay)}
              nowTime={clock.time}
              today={clock.today}
              originalDate={originalDay}
              editing={doc !== null}
              error={errors.at}
              onDateChange={(picked) => (!draft.paidDateSet && picked === clock.today ? undefined : set({ paidDate: picked, paidDateSet: true }, 'at'))}
              onTimeChange={(paidTime) => set({ paidTime, paidTimeSet: true, paidDate: docDay, paidDateSet: true }, 'at')}
            />
            <Field label="Склад" error={errors.warehouseId} floating filled={draft.warehouseId !== null}>
              {(c) => (
                <select
                  {...c}
                  value={draft.warehouseId ?? ''}
                  onChange={(e) => set({ warehouseId: e.target.value === '' ? null : Number(e.target.value) }, 'warehouseId')}
                  className={floatingControlClass}
                >
                  <option value="" disabled hidden />
                  {warehouseOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {type === 'writeoff' ? (
            <Field label="Причина списания" error={errors.reason} floating filled>
              {(c) => (
                <select {...c} value={draft.reason ?? ''} onChange={(e) => set({ reason: e.target.value as WriteoffReason }, 'reason')} className={floatingControlClass}>
                  {WRITEOFF_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {WRITEOFF_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <ComboSelect
              label={counterpartyLabel}
              listLabel="Контрагенты"
              value={draft.counterpartyId}
              options={counterpartyOptions(p.counterparties, draft.counterpartyId, preferred)}
              emptyLabel={type === 'receipt' ? 'Без поставщика' : 'Без покупателя'}
              onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
              onCreate={createCounterparty}
              createNoun={type === 'receipt' ? 'поставщика' : 'покупателя'}
              error={errors.counterpartyId}
            />
          )}

          <div className="grid gap-3" aria-label="Строки документа" role="group">
            {draft.lines.map((l, index) => {
              const item = l.itemId === null ? undefined : itemById.get(l.itemId);
              const unit = item?.unit ?? 'pcs';
              const key = (field: string) => errors[`lines.${index}.${field}`];
              return (
                <div key={l.key} role="group" aria-label={`Строка ${index + 1}`} className={`grid items-start gap-3 rounded-xl border border-field p-3 ${hasAmounts ? 'md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]'}`}>
                  <ComboSelect
                    label="Товар"
                    listLabel="Товары"
                    value={l.itemId}
                    options={itemOptions(l.itemId)}
                    emptyLabel={null}
                    onChange={(id) => setLine(l.key, (x) => setLineItem(x, id, id === null ? undefined : itemInfo.get(id), type, docDay, p.company.baseCurrency), 'itemId')}
                    onCreate={(name) => createItem(name, l.key)}
                    createNoun="товар"
                    error={key('itemId')}
                  />
                  <Field label={`Количество, ${UNIT_LABELS[unit]}`} error={key('qty')} floating filled={l.qty !== ''}>
                    {(c) => <NumberInput {...c} value={l.qty} onChange={(t) => setLine(l.key, (x) => setLineQty(x, t, unit, p.company.baseCurrency), 'qty')} className={floatingControlClass} />}
                  </Field>
                  {hasAmounts && (
                    <>
                      <Field label={`Цена, ${currency.symbol}`} floating filled={l.price !== ''}>
                        {(c) => <NumberInput {...c} value={l.price} onChange={(t) => setLine(l.key, (x) => setLinePrice(x, t, unit, p.company.baseCurrency), 'amount')} className={floatingControlClass} />}
                      </Field>
                      <Field label={`Сумма, ${currency.symbol}`} error={key('amount')} floating filled={l.amount !== ''}>
                        {(c) => <NumberInput {...c} value={l.amount} onChange={(t) => setLine(l.key, (x) => setLineAmount(x, t, unit, p.company.baseCurrency), 'amount')} className={floatingControlClass} />}
                      </Field>
                    </>
                  )}
                  {draft.lines.length > 1 && !readOnly && (
                    <button
                      type="button"
                      aria-label={`Убрать строку ${index + 1}`}
                      title="Убрать строку"
                      onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) }, 'lines')}
                      className={`${btnIcon} mt-3`}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  )}
                </div>
              );
            })}
            {errors.lines && (
              <p role="alert" className="text-sm text-expense-strong">
                {errors.lines}
              </p>
            )}
            {!readOnly && (
              <button type="button" onClick={() => set({ lines: [...draft.lines, newDocLine()] })} className={`${btnSecondary} justify-self-start`}>
                + Добавить строку
              </button>
            )}
          </div>

          {hasAmounts && (
            <p className="text-right text-lg">
              <span className="text-muted">Итого:</span> <strong className="tabular-nums">{money(total)}</strong>
            </p>
          )}
          <Field label="Комментарий" error={errors.comment} floating filled={draft.comment !== ''}>
            {(c) => <textarea {...c} rows={2} maxLength={DOC_COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={floatingTextareaClass} />}
          </Field>
        </fieldset>

        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>Документ изменён другим пользователем</span>
            <button type="button" disabled={pending} onClick={() => void reload()} className="font-semibold underline">
              Загрузить актуальный
            </button>
          </div>
        )}
        {formError && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {formError}
          </p>
        )}
        {!readOnly && !doc?.deletedAt && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="h-12 rounded-xl bg-income px-6 font-semibold text-ink hover:brightness-105 disabled:opacity-50">
              {docSubmitLabel(type, doc !== null)}
            </button>
            {doc && (
              <button type="button" disabled={pending} onClick={() => void askDelete()} className={`${btnDanger} ml-auto`}>
                Удалить документ
              </button>
            )}
          </div>
        )}
      </form>
      <ConfirmDialog
        open={ask !== null}
        title={ask?.title ?? ''}
        text={ask?.text ?? ''}
        confirmLabel={ask?.confirm ?? 'Сохранить'}
        danger={ask?.danger}
        pending={pending}
        onCancel={() => setAsk(null)}
        onConfirm={() => void ask?.run()}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Ваши данные не сохранятся"
        text="Закрыть окно? Введённые данные будут потеряны."
        confirmLabel="Закрыть"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => p.close()}
      />
    </>
  );
}
```

Создайте `src/client/lib/stock-doc-form.ts`:

```ts
import { getCurrency } from '../../shared/currencies';
import { formatDateRu, isValidDate, parseTimeInput, timeOfDay, todayInTimezone } from '../../shared/dates';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import { lineAmount, parseQty, qtyInputText, unitPrice, type StockUnit } from '../../shared/stock-qty';
import { priceAt, type PricePoint } from '../../shared/stock-price';
import { parseAmountText } from './amount-input';
import { amountInputText, dayOf } from './journal-format';
import { paidAtFor, paidDateOf } from './operation-form';
import type { DocImpact, StockDoc } from './stock';

/** Строка документа в форме: количество, цена и сумма — текст полей; цена и сумма связаны (§4.2 спецификации «Склад»). */
export interface DocLineDraft {
  key: number;
  itemId: number | null;
  qty: string;
  price: string;
  amount: string;
  /** Что менялось последним: оно остаётся как есть, второе пересчитывается при смене количества. */
  driver: 'price' | 'amount';
}

/** Черновик документа склада. Дата и время — как у формы операции: нетронутая дата следует за «сегодня», время «живое». */
export interface DocDraft {
  type: StockDocType;
  warehouseId: number | null;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  paidDate: string;
  paidDateSet: boolean;
  paidTime: string;
  paidTimeSet: boolean;
  comment: string;
  lines: DocLineDraft[];
}

/** Что форме нужно знать о товаре. */
export interface ItemInfo {
  id: number;
  unit: StockUnit;
  prices: readonly PricePoint[];
}

let seq = 0;
export const newDocLine = (): DocLineDraft => ({ key: ++seq, itemId: null, qty: '', price: '', amount: '', driver: 'price' });

export function emptyDocDraft(type: StockDocType, today: string, warehouseId: number | null): DocDraft {
  return {
    type,
    warehouseId,
    counterpartyId: null,
    reason: type === 'writeoff' ? 'defect' : null,
    paidDate: today,
    paidDateSet: false,
    paidTime: '',
    paidTimeSet: false,
    comment: '',
    lines: [newDocLine()],
  };
}

/** Заголовок окна: «Новое поступление», «Поступление П-0001». */
export function docTitle(type: StockDocType, number: string | null): string {
  const names: Record<StockDocType, [string, string]> = {
    receipt: ['Новое поступление', 'Поступление'],
    sale: ['Новая продажа', 'Продажа'],
    writeoff: ['Новое списание', 'Списание'],
  };
  return number === null ? names[type][0] : `${names[type][1]} ${number}`;
}

/** Текст главной кнопки: «Добавить поступление» / «Сохранить изменения». */
export function docSubmitLabel(type: StockDocType, editing: boolean): string {
  if (editing) return 'Сохранить изменения';
  return { receipt: 'Добавить поступление', sale: 'Добавить продажу', writeoff: 'Добавить списание' }[type];
}

const minorOf = (currency: string) => getCurrency(currency).minorUnits;

/** Количество изменилось: цена остаётся и пересчитывает сумму, а если последней правили сумму — остаётся она и пересчитывается цена. */
export function setLineQty(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next = { ...line, qty: text };
  const q = parseQty(text, unit);
  if (!q.ok) return next;
  const mu = minorOf(currency);
  if (line.driver === 'amount') {
    const a = parseAmountText(line.amount, mu);
    return a.ok ? { ...next, price: amountInputText(unitPrice(a.minor, q.qty), mu) } : next;
  }
  const p = parseAmountText(line.price, mu);
  return p.ok ? { ...next, amount: amountInputText(lineAmount(p.minor, q.qty), mu) } : next;
}

/** Цена изменилась: сумма = цена × количество. */
export function setLinePrice(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, price: text, driver: 'price' };
  const q = parseQty(line.qty, unit);
  const mu = minorOf(currency);
  const p = parseAmountText(text, mu);
  if (text.trim() === '') return { ...next, amount: '' };
  return q.ok && p.ok ? { ...next, amount: amountInputText(lineAmount(p.minor, q.qty), mu) } : next;
}

/** Сумма изменилась: цена = сумма / количество (до тиына; сохраняется сумма, итог документа точен до тиына). */
export function setLineAmount(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, amount: text, driver: 'amount' };
  const q = parseQty(line.qty, unit);
  const mu = minorOf(currency);
  const a = parseAmountText(text, mu);
  if (text.trim() === '') return { ...next, price: '' };
  return q.ok && a.ok ? { ...next, price: amountInputText(unitPrice(a.minor, q.qty), mu) } : next;
}

/** Выбран товар: у продажи цена по умолчанию — цена продажи товара на дату документа (§4.2). */
export function setLineItem(line: DocLineDraft, itemId: number | null, item: ItemInfo | undefined, type: StockDocType, day: string, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, itemId };
  if (!item || type !== 'sale') return next;
  const price = priceAt(item.prices, day);
  if (price <= 0) return next;
  return setLinePrice({ ...next, qty: line.qty }, amountInputText(price, minorOf(currency)), item.unit, currency);
}

/** Строка пустая: товар не выбран и поля не тронуты — при сохранении пропускается. */
export function isBlankLine(l: DocLineDraft): boolean {
  return l.itemId === null && l.qty.trim() === '' && l.price.trim() === '' && l.amount.trim() === '';
}

/** Итог по строкам (поступление, продажа): сумма разобранных сумм; неразобранные не считаются. */
export function draftTotal(draft: Pick<DocDraft, 'lines'>, currency: string): number {
  const mu = minorOf(currency);
  return draft.lines.reduce((s, l) => {
    const a = parseAmountText(l.amount, mu);
    return a.ok ? s + a.minor : s;
  }, 0);
}

export interface DocBody {
  type: StockDocType;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  lines: { itemId: number; qty: number; amount: number | null }[];
}

export type DocBuild = { ok: true; body: DocBody } | { ok: false; errors: Record<string, string> };

export interface DocContext {
  items: ReadonlyMap<number, ItemInfo>;
  currency: string;
  today: string;
  timeZone: string;
  now: Date;
  /** Откуда взять время суток: у нового документа — «сейчас», у существующего — его прежнее время. */
  timeOfDayFrom: Date;
  /** Правка: момент документа; если дата и время не менялись, он уходит как есть. */
  originalAt?: string;
}

export const DOC_COMMENT_MAX = 2000;

/** Черновик → тело запроса; ошибки — по полям формы (`warehouseId`, `reason`, `at`, `lines`, `lines.N.itemId|qty|amount`). */
export function buildDocBody(draft: DocDraft, ctx: DocContext): DocBuild {
  const errors: Record<string, string> = {};
  const mu = minorOf(ctx.currency);
  if (draft.warehouseId === null) errors.warehouseId = 'Выберите склад';
  if (draft.type === 'writeoff' && draft.reason === null) errors.reason = 'Укажите причину списания';

  const filled = draft.lines.map((l, index) => ({ l, index })).filter(({ l }) => !isBlankLine(l));
  if (filled.length === 0) errors.lines = 'Добавьте хотя бы одну строку';
  const lines: DocBody['lines'] = [];
  filled.forEach(({ l, index }, n) => {
    const item = l.itemId === null ? undefined : ctx.items.get(l.itemId);
    if (!item) {
      errors[`lines.${index}.itemId`] = 'Выберите товар';
      return;
    }
    const q = parseQty(l.qty, item.unit);
    if (!q.ok) errors[`lines.${index}.qty`] = q.error;
    let amount: number | null = null;
    if (draft.type !== 'writeoff') {
      const a = parseAmountText(l.amount, mu);
      if (!a.ok) errors[`lines.${index}.amount`] = l.amount.trim() === '' ? 'Укажите сумму' : a.error;
      else if (a.minor < 0) errors[`lines.${index}.amount`] = 'Сумма не меньше нуля';
      else amount = a.minor;
    }
    if (q.ok && !errors[`lines.${index}.amount`]) lines[n] = { itemId: item.id, qty: q.qty, amount };
  });

  const date = paidDateOf(draft, ctx.today);
  const time = draft.paidTimeSet ? parseTimeInput(draft.paidTime) : undefined;
  const dateUnchanged = ctx.originalAt !== undefined && dayOf(ctx.originalAt, ctx.timeZone) === date;
  if (!isValidDate(date)) errors.at = 'Укажите дату документа';
  else if (date > ctx.today && !dateUnchanged) errors.at = 'Дата документа в будущем — так нельзя';
  else if (time === null) errors.at = 'Укажите время в виде ЧЧ:ММ';
  else if (time !== undefined && Date.parse(paidAtFor(date, ctx.now, ctx.now, ctx.timeZone, time)) > ctx.now.getTime()) errors.at = 'Это время ещё не наступило';
  const comment = draft.comment.trim();
  if (comment.length > DOC_COMMENT_MAX) errors.comment = `Не длиннее ${DOC_COMMENT_MAX} символов`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const original = !draft.paidTimeSet && dateUnchanged ? (ctx.originalAt ?? null) : null;
  return {
    ok: true,
    body: {
      type: draft.type,
      at: original ?? paidAtFor(date, ctx.timeOfDayFrom, ctx.now, ctx.timeZone, time ?? undefined),
      warehouseId: draft.warehouseId!,
      counterpartyId: draft.type === 'writeoff' ? null : draft.counterpartyId,
      reason: draft.type === 'writeoff' ? draft.reason : null,
      comment: comment || null,
      lines,
    },
  };
}

/** Документ → черновик правки: количества и суммы — текстом полей, цена = сумма / количество. */
export function draftFromDoc(doc: StockDoc, items: ReadonlyMap<number, ItemInfo>, currency: string, timeZone: string): DocDraft {
  const mu = minorOf(currency);
  return {
    type: doc.type,
    warehouseId: doc.warehouseId,
    counterpartyId: doc.counterpartyId,
    reason: doc.reason,
    paidDate: dayOf(doc.at, timeZone),
    paidDateSet: true,
    paidTime: timeOfDay(doc.at, timeZone),
    paidTimeSet: false,
    comment: doc.comment ?? '',
    lines: doc.lines.map((l) => ({
      key: ++seq,
      itemId: l.itemId,
      qty: qtyInputText(l.qty),
      price: l.amount === null ? '' : amountInputText(unitPrice(l.amount, l.qty), mu),
      amount: l.amount === null ? '' : amountInputText(l.amount, mu),
      driver: 'amount' as const,
    })),
  };
}

const genitive = (n: number, one: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : many);

/**
 * Предупреждение окна сохранения (§5.4 спецификации «Склад»): «Изменится себестоимость 3 продаж после 01.10.2026»;
 * со списаниями — «… 3 продаж и 1 списания …». Пусто, если чужие документы не затронуты.
 */
export function impactText(impact: DocImpact, timeZone: string): string | null {
  if (impact.sales + impact.writeoffs === 0) return null;
  const parts: string[] = [];
  if (impact.sales > 0) parts.push(`${impact.sales} ${genitive(impact.sales, 'продажи', 'продаж')}`);
  if (impact.writeoffs > 0) parts.push(`${impact.writeoffs} ${genitive(impact.writeoffs, 'списания', 'списаний')}`);
  const since = impact.since ? ` после ${formatDateRu(todayInTimezone(timeZone, new Date(impact.since)))}` : '';
  return `Изменится себестоимость ${parts.join(' и ')}${since}`;
}

/** Остаток суммы документа: «Оплачено X из Y», «Долг Z» или «Переплата Z». */
export function paymentState(total: number, paid: number): { kind: 'none' | 'partial' | 'paid' | 'over'; debt: number } {
  if (paid <= 0) return { kind: 'none', debt: total };
  if (paid < total) return { kind: 'partial', debt: total - paid };
  if (paid === total) return { kind: 'paid', debt: 0 };
  return { kind: 'over', debt: total - paid };
}
```

Создайте `src/client/pages/stock/DocsTab.tsx`:

```tsx
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { STOCK_DOC_TYPE_LABELS, STOCK_DOC_TYPES, WRITEOFF_REASON_LABELS, type StockDocType } from '../../../shared/schemas/stock';
import { DocForm, type DocFormRequest } from '../../components/stock/DocForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { useCounterparties } from '../../lib/queries';
import { useMeta } from '../../lib/query';
import { useStockDocs } from '../../lib/stock';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle';
const PAGE = 100;

const CREATE: { type: StockDocType; label: string }[] = [
  { type: 'receipt', label: '+ Поступление' },
  { type: 'sale', label: '+ Продажа' },
  { type: 'writeoff', label: '+ Списание' },
];

/**
 * «Документы» (§4.2 спецификации «Склад»): список по складу и типу — номер, тип, дата, склад, контрагент, сумма;
 * кнопки «+ Поступление», «+ Продажа», «+ Списание» открывают форму; щелчок по номеру — правка.
 */
export function DocsTab() {
  const { company, warehouse, warehouses } = useOutletContext<StockOutletContext>();
  const meta = useMeta();
  const counterparties = useCounterparties(company.id);
  const [type, setType] = useState<StockDocType | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<{ key: number; request: DocFormRequest } | null>(null);
  const docs = useStockDocs(company.id, { type, warehouse, limit });
  const readOnly = company.archivedAt !== null;

  if (!docs.data || !meta.data) return <Pending queries={[docs]} />;
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  const counterpartyName = new Map((counterparties.data ?? []).map((c) => [c.id, c.name]));
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);
  const canCreate = !readOnly && warehouses.some((w) => !w.archivedAt);
  const open = (request: DocFormRequest) => setForm((f) => ({ key: (f?.key ?? 0) + 1, request }));

  return (
    <div>
      <StaleNotice queries={[docs]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {canCreate &&
          CREATE.map((c) => (
            <button key={c.type} type="button" aria-haspopup="dialog" onClick={() => open({ kind: 'create', type: c.type, warehouse })} className={c.type === 'receipt' ? btnPrimary : btnSecondary}>
              {c.label}
            </button>
          ))}
        <select
          aria-label="Тип документов"
          value={type ?? ''}
          onChange={(e) => {
            setType(e.target.value === '' ? null : (e.target.value as StockDocType));
            setLimit(PAGE);
          }}
          className={`${inputClass} ml-auto w-auto py-2`}
        >
          <option value="">Все документы</option>
          {STOCK_DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {STOCK_DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {docs.data.docs.length === 0 ? (
        <p className="text-muted">Документов пока нет. Начните с «Поступления».</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Документы" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Номер
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Тип
                </th>
                <th scope="col" className={thClass}>
                  Дата
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Склад
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Контрагент
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.data.docs.map((d) => (
                <tr key={d.id} className="border-b border-field hover:bg-field/40">
                  <td className={tdClass}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={`Открыть ${STOCK_DOC_TYPE_LABELS[d.type as StockDocType].toLowerCase()} ${d.number}`}
                      onClick={() => open({ kind: 'edit', id: d.id })}
                      className="rounded font-medium tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {d.number}
                    </button>
                  </td>
                  <td className={`${tdClass} max-md:hidden`}>{STOCK_DOC_TYPE_LABELS[d.type as StockDocType]}</td>
                  <td className={`${tdClass} tabular-nums`}>{formatDateTime(d.at, meta.data.timezone)}</td>
                  <td className={`${tdClass} max-md:hidden`}>{warehouseName.get(d.warehouseId) ?? '…'}</td>
                  <td className={`${tdClass} max-md:hidden`}>
                    {d.type === 'writeoff' ? (d.reason ? WRITEOFF_REASON_LABELS[d.reason] : '') : d.counterpartyId === null ? '—' : (counterpartyName.get(d.counterpartyId) ?? '…')}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{d.type === 'writeoff' ? '—' : money(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {docs.data.hasMore && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={`${btnSecondary} mt-4`}>
          Показать ещё
        </button>
      )}
      {form && <DocForm key={form.key} company={company} request={form.request} onClose={() => setForm(null)} />}
    </div>
  );
}
```

В `src/client/lib/stock-view.ts` замените

```ts
/** Подвкладки экрана «Склад» (§4 спецификации «Склад»); «Аналитика» появится в плане «Склад-3». */
export const STOCK_TABS = [
  { path: 'balance', label: 'Остатки' },
  { path: 'items', label: 'Товары' },
] as const;
export type StockTabPath = (typeof STOCK_TABS)[number]['path'];
```

на

```ts
/** Подвкладки экрана «Склад» (§4 спецификации «Склад»); «Аналитика» появится в плане «Склад-3». */
export const STOCK_TABS = [
  { path: 'balance', label: 'Остатки' },
  { path: 'docs', label: 'Документы' },
  { path: 'items', label: 'Товары' },
] as const;
export type StockTabPath = (typeof STOCK_TABS)[number]['path'];
```

В `src/client/router.tsx` замените

```tsx
import { RequireAuth } from './pages/RequireAuth';
import { StockIndex, StockPage } from './pages/StockPage';
import { BalanceTab } from './pages/stock/BalanceTab';
import { ItemsTab } from './pages/stock/ItemsTab';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';
```

на

```tsx
import { RequireAuth } from './pages/RequireAuth';
import { StockIndex, StockPage } from './pages/StockPage';
import { BalanceTab } from './pages/stock/BalanceTab';
import { DocsTab } from './pages/stock/DocsTab';
import { ItemsTab } from './pages/stock/ItemsTab';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';
```

В `src/client/router.tsx` замените

```tsx
            children: [
              { index: true, element: <StockIndex /> },
              { path: 'balance', element: <BalanceTab /> },
              { path: 'items', element: <ItemsTab /> },
              { path: '*', element: <StockIndex /> },
            ],
```

на

```tsx
            children: [
              { index: true, element: <StockIndex /> },
              { path: 'balance', element: <BalanceTab /> },
              { path: 'docs', element: <DocsTab /> },
              { path: 'items', element: <ItemsTab /> },
              { path: '*', element: <StockIndex /> },
            ],
```

- [ ] **Step 4: Run tests, typecheck and e2e**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e` (два раза подряд).
Expected: `npm test` - 1247 пройдено и 1 пропущен, typecheck без ошибок, e2e — 175 из 175.

- [ ] **Step 5: Commit**

```bash
git add src tests e2e
git commit -m "feat: документы склада — список и форма поступления, продажи, списания (Склад-1b, задача 2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Левая панель — группа «Склад» (§4.4)

**Files:**
- Create: `src/client/lib/stock-panel.ts`
- Modify: `src/client/components/AccountsPanel.tsx`
- Test: `e2e/stock.spec.ts`, `tests/client/stock-panel.test.ts` (новый)

**Interfaces:**
- Consumes: `useStockValue(companyId)` и `StockValue` (задача 1), `AccountsSummary` (общая для панели и выезжающей панели телефона), `GET value`.
- Produces: `stockPanel(value, companyId, currency): {rows: {warehouseId, name, money, href}[]; total: string} | null` (`lib/stock-panel.ts`); группа `role="group"` «Склад» в левой панели.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/client/stock-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stockPanel } from '../../src/client/lib/stock-panel';

describe('stockPanel (§4.4)', () => {
  it('строка на склад со стоимостью, адрес «Остатков» склада и итог «Склад: ₸ X»', () => {
    const panel = stockPanel(
      {
        warehouses: [
          { warehouseId: 3, projectId: 1, name: 'Бар Клуб 1', value: 12_000_000 },
          { warehouseId: 4, projectId: 2, name: 'Бар Клуб 2', value: 0 },
        ],
        total: 12_000_000,
      },
      7,
      'KZT',
    );
    expect(panel).toEqual({
      rows: [
        { warehouseId: 3, name: 'Бар Клуб 1', money: '₸\u00A0120\u202F000', href: '/c/7/stock/balance?warehouse=3' },
        { warehouseId: 4, name: 'Бар Клуб 2', money: '₸\u00A00', href: '/c/7/stock/balance?warehouse=4' },
      ],
      total: 'Склад: ₸\u00A0120\u202F000',
    });
  });

  it('нет данных или нет складов — группы нет', () => {
    expect(stockPanel(undefined, 7, 'KZT')).toBeNull();
    expect(stockPanel({ warehouses: [], total: 0 }, 7, 'KZT')).toBeNull();
  });
});
```

В `e2e/stock.spec.ts` замените

```ts
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('8 шт'); // 10 \u2212 2 списанных
});
```

на

```ts
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('8 шт'); // 10 \u2212 2 списанных
});

test('левая панель: группа «Склад» со стоимостью складов не входит в «Всего на счетах»; строка ведёт в «Остатки» склада; на телефоне — в выезжающей панели', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10_000 });
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse2, lines: [{ itemId: s.chips, qty: 3000, amount: 21_000 }] });

  await page.goto(`/c/${cid}/log`);
  const panel = page.getByRole('navigation', { name: 'Счета' });
  // «Всего на счетах» — только деньги на счетах: 100 ₸; склад (1 210 ₸) в него не входит
  await expect(panel).toContainText(/Всего на счетах\s*₸\s*100(?!\s*\d)/);
  const group = panel.getByRole('group', { name: 'Склад' });
  await expect(group.getByRole('link', { name: /Бар Клуб 1/ })).toContainText(/₸\s*1\s*000/);
  await expect(group.getByRole('link', { name: /Бар Клуб 2/ })).toContainText(/₸\s*210/);
  await expect(group).toContainText(/Склад:\s*₸\s*1\s*210/);

  // продажа уменьшает стоимость склада: панель обновляется после перезагрузки данных
  await apiPost(page, `${s.base}/stock/docs`, { type: 'sale', at: hoursAgo(1), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 4000, amount: 200_000 }] });
  await page.reload();
  await expect(panel.getByRole('group', { name: 'Склад' })).toContainText(/Склад:\s*₸\s*810/);
  await expect(panel).toContainText(/Всего на счетах\s*₸\s*100(?!\s*\d)/);

  // склад нельзя выбрать в форме операции: среди счетов его нет
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новый расход' }).getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await expect(page.getByRole('option', { name: /Бар Клуб/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // строка склада открывает «Остатки» этого склада
  await panel.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse2}$`));
  await expect(main(page).getByLabel('Склад', { exact: true })).toHaveValue(String(s.warehouse2));

  // телефон: та же группа в выезжающей панели «Счета»; переход закрывает панель
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Счета' });
  await expect(drawer.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 1/ })).toBeVisible();
  await drawer.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 1/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse}$`));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/stock-panel.test.ts` и `npx playwright test e2e/stock.spec.ts -g "левая панель"`
Expected: FAIL — файлы тестов:  1 failed (1) | тесты:  не запустились: нет импортируемого модуля; e2e: группы «Склад» в панели нет.

- [ ] **Step 3: Write the implementation**

Создайте `src/client/lib/stock-panel.ts`:

```ts
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import type { StockValue } from './stock';

export interface StockPanelRow {
  warehouseId: number;
  name: string;
  /** «₸ 120 000». */
  money: string;
  /** Адрес «Остатков» этого склада (§4.4: щелчок по строке открывает «Остатки» склада). */
  href: string;
}

export interface StockPanel {
  rows: StockPanelRow[];
  /** «Склад: ₸ 120 000» — итог группы; в «Всего на счетах» он не входит. */
  total: string;
}

/** Группа «Склад» левой панели (§4.4 спецификации «Склад»): строка на склад со стоимостью и итог; нет складов — группы нет. */
export function stockPanel(value: StockValue | undefined, companyId: number, currency: string): StockPanel | null {
  if (!value || value.warehouses.length === 0) return null;
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN_BEFORE);
  return {
    rows: value.warehouses.map((w) => ({ warehouseId: w.warehouseId, name: w.name, money: money(w.value), href: `/c/${companyId}/stock/balance?warehouse=${w.warehouseId}` })),
    total: `Склад: ${money(value.total)}`,
  };
}
```

В `src/client/components/AccountsPanel.tsx` замените

```tsx
import { refreshOperations } from '../lib/journal-mutations';
import { useIsMobile } from '../lib/media';
import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';
import { useSidebarCollapsed } from '../lib/sidebar';
import { AccountEditor } from './AccountEditor';
import { AccountsQuickEdit } from './AccountsQuickEdit';
```

на

```tsx
import { refreshOperations } from '../lib/journal-mutations';
import { useIsMobile } from '../lib/media';
import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';
import { useStockValue } from '../lib/stock';
import { stockPanel } from '../lib/stock-panel';
import { useSidebarCollapsed } from '../lib/sidebar';
import { AccountEditor } from './AccountEditor';
import { AccountsQuickEdit } from './AccountsQuickEdit';
```

В `src/client/components/AccountsPanel.tsx` замените

```tsx
/**
 * Содержимое левой панели (§7, §7.6 этапа 1.5): «Всего на счетах» крупно; строка «Мои счета» с «+» (окно
 * «Добавление нового счёта» прямо над журналом), ✎ (окно «Счета») и ⟳ (§2.5); счета по клубам с балансами —
 * заголовки групп `h3`, только если групп больше одной. Без ролей listitem, status, alert, region: их ищут e2e
 * экранов настроек. onNavigate — переход по ссылке счёта (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: (target: string) => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);
  const [refresh, setRefresh] = useState({ pending: false, failed: false, text: '' });
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
```

на

```tsx
/**
 * Содержимое левой панели (§7, §7.6 этапа 1.5): «Всего на счетах» крупно; строка «Мои счета» с «+» (окно
 * «Добавление нового счёта» прямо над журналом), ✎ (окно «Счета») и ⟳ (§2.5); счета по клубам с балансами —
 * заголовки групп `h3`, только если групп больше одной; под счетами — группа «Склад» со стоимостью складов (§4.4 спецификации «Склад»).
 * Без ролей listitem, status, alert, region: их ищут e2e
 * экранов настроек. onNavigate — переход по ссылке счёта (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: (target: string) => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const stock = stockPanel(useStockValue(company.id).data, company.id, company.baseCurrency);
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);
  const [refresh, setRefresh] = useState({ pending: false, failed: false, text: '' });
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
```

В `src/client/components/AccountsPanel.tsx` замените

```tsx
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {/* окна — вложенные <dialog>: на телефоне поверх выезжающей панели, её Esc и close они не трогают */}
      <Modal open={dialog === 'add'} title="Добавление нового счёта" onClose={close} className="max-w-lg">
        <AccountEditor company={company} account={null} onDone={close} />
```

на

```tsx
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {/* склад — «счёт» только для показа (§4.4 спецификации «Склад»): в «Всего на счетах» не входит, в форме операции его нет */}
      {stock && (
        <div role="group" aria-label="Склад" className="mb-3 border-t border-field pt-3">
          <h3 className="mb-1 truncate px-2 text-xs font-semibold text-muted">Склад</h3>
          {stock.rows.map((r) => (
            <Link key={r.warehouseId} to={r.href} onClick={click(r.href)} className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field">
              <span className="truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums">{r.money}</span>
            </Link>
          ))}
          <p className="px-2 pt-1 text-sm font-semibold tabular-nums">{stock.total}</p>
        </div>
      )}
      {/* окна — вложенные <dialog>: на телефоне поверх выезжающей панели, её Esc и close они не трогают */}
      <Modal open={dialog === 'add'} title="Добавление нового счёта" onClose={close} className="max-w-lg">
        <AccountEditor company={company} account={null} onDone={close} />
```

- [ ] **Step 4: Run tests, typecheck and e2e**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e` (два раза подряд).
Expected: `npm test` - 1249 пройдено и 1 пропущен, typecheck без ошибок, e2e — 176 из 176.

- [ ] **Step 5: Commit**

```bash
git add src tests e2e
git commit -m "feat: левая панель — группа «Склад» со стоимостью складов (Склад-1b, задача 3)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Оплата закупки и «Провести в журнал» (§6.1, §6.3)

**Files:**
- Create: `src/client/components/stock/PostToJournal.tsx`, `src/client/components/stock/StockPaymentsField.tsx`, `src/client/lib/stock-payments.ts`
- Modify: `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/OperationFormHost.tsx`, `src/client/components/stock/DocForm.tsx`, `src/client/lib/operation-edit.ts`, `src/client/lib/operation-form.ts`, `src/client/lib/stock-doc-form.ts`, `src/client/pages/stock/DocsTab.tsx`
- Test: `e2e/stock.spec.ts`, `tests/client/operation-edit.test.ts`, `tests/client/operation-form.test.ts`, `tests/client/stock-doc-form.test.ts`, `tests/client/stock-payments.test.ts` (новый)

**Interfaces:**
- Consumes: `useUnpaid`, `StockDoc` (`posting`, `lastPost`, `payments`, `paid`), `useOpenOperationForm`, `OperationFormRequest`, `buildBody`, `patchBody`, `draftFromOperation`, `duplicateDraft`, `convertToTransferDraft`, `categoryOptions`, `createFromForm`; API `GET suppliers/:id/unpaid`, `POST docs/:id/journal`, `stockPayments` в операциях.
- Produces:
  - `PaymentDraft {docId, amount: string}`, `parsePayments`, `remainingAmount`, `defaultPaymentAmount`, `withDoc|withoutDoc|withAmount`, `distributedText`, `unpaidDocText` (`lib/stock-payments.ts`);
  - `OperationDraft.stockPayments`, `OperationBody.stockPayments`, `OperationRecord.stockPayments?`, `OperationPrefill`, `DraftContext.baseCurrency?`;
  - `paymentLabel(total, paid, currency)`, `paymentSummary(...)` (`lib/stock-doc-form.ts`); `<StockPaymentsField>`, `<PostToJournal>`; `OperationFormRequest` с `prefill`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/client/stock-payments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { UnpaidDoc } from '../../src/client/lib/stock';
import {
  defaultPaymentAmount,
  distributedText,
  parsePayments,
  remainingAmount,
  unpaidDocText,
  withAmount,
  withDoc,
  withoutDoc,
} from '../../src/client/lib/stock-payments';

const doc = (over: Partial<UnpaidDoc> = {}): UnpaidDoc => ({ docId: 4, number: 'П-0001', at: '2026-10-01T10:00:00.000Z', total: 100_000, paid: 40_000, own: 0, debt: 60_000, ...over });

describe('сумма оплаты по умолчанию', () => {
  it('долг документа, но не больше остатка суммы расхода; своя оплата входит в долг', () => {
    expect(defaultPaymentAmount(doc(), null)).toBe(60_000);
    expect(defaultPaymentAmount(doc(), 25_000)).toBe(25_000);
    expect(defaultPaymentAmount(doc(), 90_000)).toBe(60_000);
    expect(defaultPaymentAmount(doc({ own: 30_000, paid: 70_000, debt: 30_000 }), null)).toBe(60_000);
    expect(defaultPaymentAmount(doc({ debt: -5, own: 0 }), null)).toBe(0);
  });

  it('остаток суммы расхода без учёта выбранного документа; сумма не введена — null', () => {
    const payments = [{ docId: 4, amount: '300' }, { docId: 5, amount: '100,5' }];
    expect(remainingAmount(100_000, payments, 2)).toBe(59_950);
    expect(remainingAmount(100_000, payments, 2, 4)).toBe(89_950);
    expect(remainingAmount(10_000, payments, 2)).toBe(0);
    expect(remainingAmount(null, payments, 2)).toBeNull();
  });
});

describe('отметка документов', () => {
  it('новый документ получает сумму по умолчанию, повторная отметка ничего не меняет, снятие убирает', () => {
    const first = withDoc([], doc(), 100_000, 2);
    expect(first).toEqual([{ docId: 4, amount: '600' }]);
    expect(withDoc(first, doc(), 100_000, 2)).toEqual(first);
    // второй документ получает остаток суммы расхода
    expect(withDoc(first, doc({ docId: 5, debt: 90_000, total: 90_000, paid: 0 }), 100_000, 2)).toEqual([
      { docId: 4, amount: '600' },
      { docId: 5, amount: '400' },
    ]);
    expect(withoutDoc(first, 4)).toEqual([]);
    expect(withAmount(first, 4, '1')).toEqual([{ docId: 4, amount: '1' }]);
  });

  it('остатка не осталось — сумма пуста: пользователь введёт её сам', () => {
    expect(withDoc([{ docId: 9, amount: '1000' }], doc(), 100_000, 2)).toEqual([{ docId: 9, amount: '1000' }, { docId: 4, amount: '' }]);
  });
});

describe('parsePayments', () => {
  it('суммы в минимальных единицах и итог', () => {
    expect(parsePayments([{ docId: 4, amount: '600' }, { docId: 5, amount: '0,5' }], 2)).toEqual({
      ok: true,
      list: [{ docId: 4, amount: 60_000 }, { docId: 5, amount: 50 }],
      total: 60_050,
    });
    expect(parsePayments([], 2)).toEqual({ ok: true, list: [], total: 0 });
  });

  it('пустая, нулевая и неверная сумма — ошибка', () => {
    for (const amount of ['', '0', 'x', '-5']) {
      expect(parsePayments([{ docId: 4, amount }], 2)).toEqual({ ok: false, error: 'Укажите сумму оплаты по каждому документу' });
    }
  });
});

describe('тексты', () => {
  it('«Распределено X из Y»', () => {
    expect(distributedText([{ docId: 4, amount: '600' }], 100_000, 'KZT')).toBe('Распределено 600\u00A0₸ из 1\u202F000\u00A0₸');
    expect(distributedText([{ docId: 4, amount: '600' }], null, 'KZT')).toBe('Распределено 600\u00A0₸');
  });

  it('строка документа: номер, дата, сумма, долг или «оплачено»', () => {
    expect(unpaidDocText(doc(), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · долг 600\u00A0₸');
    expect(unpaidDocText(doc({ paid: 100_000, own: 100_000, debt: 0 }), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · долг 1\u202F000\u00A0₸');
    expect(unpaidDocText(doc({ paid: 100_000, debt: 0 }), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · оплачено');
  });
});
```

В `e2e/stock.spec.ts` замените

```ts
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse}$`));
});
```

на

```ts
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse}$`));
});

test('оплата закупки: из расхода журнала, «Оплатить» у поступления, лишняя сумма — ошибка, удаление расхода снимает оплату; продажа → доход журнала', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Оплата ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Закупки' });
  const s = await stockSetup(page, cid);
  const docs = `${s.base}/stock/docs`;
  await apiPost(page, docs, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });
  await apiPost(page, docs, { type: 'receipt', at: hoursAgo(4), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.chips, qty: 2000, amount: 50_000 }] });

  // расход поставщику: «Оплата закупки» появляется, когда у него есть долги
  await page.goto(`/c/${cid}/log`);
  const banner = page.getByRole('banner');
  await banner.getByRole('button', { name: 'Расход', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый расход' });
  await form.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await expect(form.getByRole('group', { name: 'Оплата закупки' })).toHaveCount(0);
  await form.getByRole('combobox', { name: /^(Мой контрагент|Поставщик)/ }).click();
  await page.getByRole('option', { name: 'Поставщик А' }).click();
  const payments = form.getByRole('group', { name: 'Оплата закупки' });
  await expect(payments.getByRole('checkbox')).toHaveCount(2);
  await payments.getByRole('checkbox', { name: /^П-0001/ }).check();
  // сумма расхода была пуста — подставилась долгом документа
  await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('1000');
  await expect(payments.getByLabel('Оплата по П-0001')).toHaveValue('1000');
  await payments.getByLabel('Оплата по П-0001').fill('400');
  await expect(payments).toContainText(/Распределено\s*400\s*₸ из 1\s*000\s*₸/);
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(form).toBeHidden();

  // документы: оплачено 400 из 1 000; в окне поступления — «Оплатить»
  await page.goto(`/c/${cid}/stock/docs`);
  const table = main(page).getByRole('table', { name: 'Документы' });
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/Оплачено\s*400\s*₸ из 1\s*000\s*₸/);
  await expect(table.getByRole('row').filter({ hasText: 'П-0002' })).toContainText(/Долг\s*500\s*₸/);
  await table.getByRole('button', { name: 'Открыть поступление П-0001' }).click();
  const receipt = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await expect(receipt.getByRole('region', { name: 'Оплата' })).toContainText(/Оплачено\s*400\s*₸ из 1\s*000\s*₸\. Долг\s*600\s*₸/);
  await receipt.getByRole('button', { name: 'Оплатить' }).click();
  const expense = page.getByRole('dialog', { name: 'Новый расход' });
  await expect(expense.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('600');
  await expect(expense.getByRole('group', { name: 'Оплата закупки' }).getByLabel('Оплата по П-0001')).toHaveValue('600');
  await expense.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await expense.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(expense).toBeHidden();
  await page.goto(`/c/${cid}/stock/docs`);
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText('Оплачено');
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).not.toContainText('Долг');

  // оплат больше суммы расхода: ошибка у поля, расход не создаётся
  await banner.getByRole('button', { name: 'Расход', exact: true }).click();
  const second = page.getByRole('dialog', { name: 'Новый расход' });
  await second.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await second.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await second.getByRole('combobox', { name: /^(Мой контрагент|Поставщик)/ }).click();
  await page.getByRole('option', { name: 'Поставщик А' }).click();
  const pay2 = second.getByRole('group', { name: 'Оплата закупки' });
  await expect(pay2.getByRole('checkbox')).toHaveCount(1); // П-0001 оплачено полностью
  await pay2.getByRole('checkbox', { name: /^П-0002/ }).check();
  await expect(pay2.getByLabel('Оплата по П-0002')).toHaveValue('100'); // не больше суммы расхода
  await pay2.getByLabel('Оплата по П-0002').fill('200');
  await second.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(pay2.getByRole('alert')).toHaveText('Оплаты закупок больше суммы расхода');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Закрыть' }).click();

  // удаление расхода снимает его оплату (каскад)
  const ops = (await (await page.request.get(`${base}/operations`)).json()) as { items: { id: number; counterpartyId: number | null }[] };
  for (const op of ops.items.filter((o) => o.counterpartyId === s.supplier)) {
    const res = await page.request.delete(`${base}/operations/${op.id}`, { headers: csrf(page) });
    expect(res.status()).toBe(200);
  }
  await page.goto(`/c/${cid}/stock/docs`);
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/Долг\s*1\s*000\s*₸/);

  // продажа → доход журнала (магазин): категория «Продажа товаров» создаётся прямо в окне
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(1), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 2000, amount: 100_000 }] });
  await page.reload();
  await table.getByRole('button', { name: 'Открыть продажа Р-0001' }).click();
  const sale = page.getByRole('dialog', { name: 'Продажа Р-0001' });
  await sale.getByRole('button', { name: 'Провести в журнал' }).click();
  const post = page.getByRole('dialog', { name: 'Провести в журнал' });
  await post.getByRole('button', { name: 'Создать категорию «Продажа товаров»' }).click();
  await expect(post.getByLabel('Категория дохода')).toHaveText(/Продажа товаров/);
  await post.getByRole('button', { name: 'Провести' }).click();
  await expect(post).toBeHidden();
  await expect(sale.getByRole('region', { name: 'Журнал' })).toContainText(/Проведена в журнал: доход 1\s*000\s*₸/);
  await expect(sale.getByRole('button', { name: 'Провести в журнал' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toContainText('В журнале');
  const income = (await (await page.request.get(`${base}/operations`)).json()) as { items: { type: string; comment: string | null; amount: number }[] };
  expect(income.items.filter((o) => o.type === 'income')).toMatchObject([{ comment: 'Продажа Р-0001', amount: 100_000 }]);
});
```

В `tests/client/operation-edit.test.ts` замените

```ts
      tagIds: [2, 1],
      comment: 'аренда',
      split: null,
    });
  });

  it('несколько строк — разбиение в суммах; перевод между валютами — сумма зачисления и проект строки', () => {
    const d = draftFromOperation(
      op({ amount: 1000, lines: [{ categoryId: 7, projectId: 8, amount: 600 }, { categoryId: 7, projectId: null, amount: 400 }] }),
```

на

```ts
      tagIds: [2, 1],
      comment: 'аренда',
      split: null,
      stockPayments: [],
    });
  });

  it('оплаты закупок расхода — в черновик текстом сумм; в PATCH уходят, только если изменились', () => {
    const paid = op({ stockPayments: [{ docId: 4, number: 'П-0001', amount: 60000 }, { docId: 5, number: 'П-0002', amount: 40050 }] });
    expect(draftFromOperation(paid, accounts, TZ).stockPayments).toEqual([{ docId: 4, amount: '600' }, { docId: 5, amount: '400,5' }]);
    expect(patchFor(paid, (d) => d)).toBeNull();
    expect(patchFor(paid, (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
    expect(patchFor(paid, (d) => ({ ...d, stockPayments: [{ docId: 4, amount: '700' }] }))).toEqual({ version: 3, stockPayments: [{ docId: 4, amount: 70000 }] });
    expect(patchFor(paid, (d) => ({ ...d, stockPayments: [] }))).toEqual({ version: 3, stockPayments: [] });
    expect(patchFor(op(), (d) => ({ ...d, stockPayments: [{ docId: 4, amount: '100' }] }))).toEqual({ version: 3, stockPayments: [{ docId: 4, amount: 10000 }] });
  });

  it('«Дублировать» и «Изменить в перевод» оплаты закупки не переносят; перевод предупреждает, что оплата будет убрана', () => {
    const d = { ...draftFromOperation(op(), accounts, TZ), stockPayments: [{ docId: 4, amount: '600' }] };
    expect(duplicateDraft(d, { accounts: new Set([1]), categories: new Set([7]), projects: new Set([8]), counterparties: new Set([5]), tags: new Set([1, 2]) }, '2026-10-07').stockPayments).toEqual([]);
    const r = convertToTransferDraft(d, { category: () => 'Закупки', counterparty: () => 'Поставщик А' });
    expect(r.losses).toEqual(['категория «Закупки»', 'контрагент «Поставщик А»', 'оплата закупки']);
    expect(r.draft.stockPayments).toEqual([]);
  });

  it('несколько строк — разбиение в суммах; перевод между валютами — сумма зачисления и проект строки', () => {
    const d = draftFromOperation(
      op({ amount: 1000, lines: [{ categoryId: 7, projectId: 8, amount: 600 }, { categoryId: 7, projectId: null, amount: 400 }] }),
```

В `tests/client/operation-edit.test.ts` замените

```ts
    expect(r.losses).toEqual(['категория «Зарплата»', 'контрагент «Алина»', 'дата сделки']);
    expect(convertQuestion(r.losses)).toBe('Будут убраны: категория «Зарплата», контрагент «Алина», дата сделки.');
    expect(r.carried).toBeNull();
    expect(r.draft).toEqual({ ...d, type: 'transfer', accountId: 1, toAccountId: null, toAmount: '', categoryId: null, projectId: 8, counterpartyId: null, accrualOn: false, split: null });
  });

  it('доход: прежний счёт — «На счёт», «Со счёта» пусто; прежняя сумма — и сумма, и «Сумма зачисления»; терять нечего — список пуст', () => {
```

на

```ts
    expect(r.losses).toEqual(['категория «Зарплата»', 'контрагент «Алина»', 'дата сделки']);
    expect(convertQuestion(r.losses)).toBe('Будут убраны: категория «Зарплата», контрагент «Алина», дата сделки.');
    expect(r.carried).toBeNull();
    expect(r.draft).toEqual({ ...d, type: 'transfer', accountId: 1, toAccountId: null, toAmount: '', categoryId: null, projectId: 8, counterpartyId: null, accrualOn: false, split: null, stockPayments: [] });
  });

  it('доход: прежний счёт — «На счёт», «Со счёта» пусто; прежняя сумма — и сумма, и «Сумма зачисления»; терять нечего — список пуст', () => {
```

В `tests/client/operation-form.test.ts` замените

```ts
      comment: 'аренда',
      lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
      tagIds: [3, 2],
    });
  });
```

на

```ts
      comment: 'аренда',
      lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
      tagIds: [3, 2],
      stockPayments: [],
    });
  });

  describe('оплата закупки (§6.1 спецификации «Склад»)', () => {
    const paid = (over: Partial<OperationDraft> = {}) => draft({ amount: '1000', counterpartyId: 9, stockPayments: [{ docId: 4, amount: '600' }, { docId: 5, amount: '400,5' }], ...over });

    it('расход со счёта в валюте компании несёт оплаты в минимальных единицах', () => {
      const r = buildBody(paid({ amount: '1000,5' }), { ...ctx, baseCurrency: 'KZT' });
      expect(r).toMatchObject({ ok: true, body: { stockPayments: [{ docId: 4, amount: 60000 }, { docId: 5, amount: 40050 }] } });
    });

    it('оплаты больше суммы расхода и пустая сумма оплаты — ошибка поля', () => {
      expect(buildBody(paid({ amount: '900' }), { ...ctx, baseCurrency: 'KZT' })).toEqual({ ok: false, errors: { stockPayments: 'Оплаты закупок больше суммы расхода' } });
      expect(buildBody(paid({ stockPayments: [{ docId: 4, amount: '' }] }), { ...ctx, baseCurrency: 'KZT' })).toEqual({
        ok: false,
        errors: { stockPayments: 'Укажите сумму оплаты по каждому документу' },
      });
    });

    it('доход, перевод и счёт в другой валюте оплат не отправляют', () => {
      expect(body(paid({ type: 'income' })).stockPayments).toEqual([]);
      expect(buildBody(paid({ accountId: 3 }), { ...ctx, baseCurrency: 'KZT' })).toMatchObject({ ok: true, body: { stockPayments: [] } });
    });

    it('смена типа и «создать похожий» оплат не переносят', () => {
      expect(changeType(paid(), 'income').stockPayments).toEqual([]);
      expect(similarDraft(paid(), '2026-10-07').stockPayments).toEqual([]);
    });
  });
```

В `tests/client/stock-doc-form.test.ts` замените

```ts
  impactText,
  isBlankLine,
  newDocLine,
  paymentState,
  setLineAmount,
  setLineItem,
  setLinePrice,
```

на

```ts
  impactText,
  isBlankLine,
  newDocLine,
  paymentLabel,
  paymentState,
  paymentSummary,
  setLineAmount,
  setLineItem,
  setLinePrice,
```

В `tests/client/stock-doc-form.test.ts` замените

```ts
    expect(paymentState(100, 100)).toEqual({ kind: 'paid', debt: 0 });
    expect(paymentState(100, 130)).toEqual({ kind: 'over', debt: -30 });
  });
});
```

на

```ts
    expect(paymentState(100, 100)).toEqual({ kind: 'paid', debt: 0 });
    expect(paymentState(100, 130)).toEqual({ kind: 'over', debt: -30 });
  });

  it('подписи оплаты: в списке и в окне поступления', () => {
    const nb = String.fromCharCode(0xa0);
    const narrow = String.fromCharCode(0x202f);
    const k = (n: string, tail = '') => n.replace(' ', narrow) + nb + '₸' + tail;
    expect(paymentLabel(100_000, 0, 'KZT')).toBe('Долг ' + k('1 000'));
    expect(paymentLabel(100_000, 40_000, 'KZT')).toBe('Оплачено ' + k('400') + ' из ' + k('1 000'));
    expect(paymentLabel(100_000, 100_000, 'KZT')).toBe('Оплачено');
    expect(paymentLabel(100_000, 130_000, 'KZT')).toBe('Переплата ' + k('300'));
    expect(paymentSummary(100_000, 0, 'KZT')).toBe('Не оплачено. Долг ' + k('1 000'));
    expect(paymentSummary(100_000, 40_000, 'KZT')).toBe('Оплачено ' + k('400') + ' из ' + k('1 000') + '. Долг ' + k('600'));
    expect(paymentSummary(100_000, 100_000, 'KZT')).toBe('Оплачено ' + k('1 000') + ' из ' + k('1 000'));
    expect(paymentSummary(100_000, 130_000, 'KZT')).toBe('Оплачено ' + k('1 300') + ' из ' + k('1 000') + '. Переплата ' + k('300'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client` и `npx playwright test e2e/stock.spec.ts -g "оплата закупки"`
Expected: FAIL — файлы тестов:  4 failed (4) | тесты:  10 failed | 68 passed (78); e2e: в расходе нет «Оплаты закупки».

- [ ] **Step 3: Write the implementation**

Создайте `src/client/components/stock/PostToJournal.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { api, ApiError } from '../../lib/api';
import { invalidateOperations } from '../../lib/journal-mutations';
import { createFromForm } from '../../lib/operation-create';
import { categoryOptions } from '../../lib/operation-options';
import { useAccounts, useCategories, type Company } from '../../lib/queries';
import { invalidateStock, type StockDoc } from '../../lib/stock';
import { Field } from '../Field';
import { Pending } from '../QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';

/** Категория дохода по умолчанию для выручки магазина (§6.3 спецификации «Склад»). */
export const SALES_CATEGORY = 'Продажа товаров';

/**
 * «Провести в журнал» у продажи (§6.3): доход на выбранный счёт — сумма документа, проект склада, комментарий
 * «Продажа {номер}». Счёт и категорию склад запоминает: в следующий раз подставятся прошлые. Счета — только в валюте компании.
 */
export function PostToJournal(props: { company: Company; doc: StockDoc; onDone: (posted: boolean) => void }) {
  const { company, doc } = props;
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  if (!accounts.data || !categories.data) return <Pending queries={[accounts, categories]} />;
  return <PostForm company={company} doc={doc} accounts={accounts.data} categories={categories.data} onDone={props.onDone} />;
}

function PostForm(props: {
  company: Company;
  doc: StockDoc;
  accounts: NonNullable<ReturnType<typeof useAccounts>['data']>;
  categories: NonNullable<ReturnType<typeof useCategories>['data']>;
  onDone: (posted: boolean) => void;
}) {
  const { company, doc } = props;
  const usable = props.accounts.filter((a) => !a.archivedAt && a.currency === company.baseCurrency);
  const options = categoryOptions(props.categories, 'income', [doc.lastPost?.categoryId ?? null]);
  const byName = options.find((o) => o.label === SALES_CATEGORY);
  const [accountId, setAccountId] = useState<number | null>(() => {
    const last = doc.lastPost?.accountId;
    return usable.find((a) => a.id === last)?.id ?? usable[0]?.id ?? null;
  });
  const [categoryId, setCategoryId] = useState<number | null>(() => doc.lastPost?.categoryId ?? byName?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const post = useMutation<unknown, ApiError, { accountId: number; categoryId: number }>({
    mutationFn: (body) => api(`/companies/${company.id}/stock/docs/${doc.id}/journal`, { method: 'POST', body }),
    onSuccess: async () => {
      await Promise.all([invalidateStock(company.id), invalidateOperations(company.id)]);
      props.onDone(true);
    },
    onError: (e) => setError(e.fields?.accountId ?? e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (accountId === null) {
      setError('Выберите счёт');
      return;
    }
    if (categoryId === null) {
      setError('Выберите категорию дохода');
      return;
    }
    setError(null);
    post.mutate({ accountId, categoryId });
  };
  const createCategory = async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await createFromForm(company.id, 'category', SALES_CATEGORY, { kind: 'income', counterpartyType: 'client' });
      setCategoryId(id);
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');
    } finally {
      setCreating(false);
    }
  };

  if (usable.length === 0) {
    return (
      <p className="text-muted">
        Нет счёта в валюте компании ({company.baseCurrency}).{' '}
        <Link to={`/c/${company.id}/settings/accounts`} className="font-semibold underline">
          Добавьте счёт
        </Link>
        .
      </p>
    );
  }
  return (
    <form noValidate onSubmit={submit} aria-label="Провести в журнал" className="grid gap-4">
      <p className="text-sm text-muted">
        В журнал попадёт доход на сумму <strong className="text-ink tabular-nums">{formatMoney(doc.total, company.baseCurrency, MONEY_SCREEN)}</strong> с комментарием «Продажа {doc.number}» и проектом склада.
      </p>
      <Field label="На счёт">
        {(c) => (
          <select {...c} value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))} className={inputClass}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Категория дохода">
        {(c) => (
          <select {...c} value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value === '' ? null : Number(e.target.value))} className={inputClass}>
            <option value="">Выберите категорию</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {!byName && (
        <button type="button" disabled={creating} onClick={() => void createCategory()} className={`${btnSmall} justify-self-start`}>
          Создать категорию «{SALES_CATEGORY}»
        </button>
      )}
      {error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={post.isPending} className={btnPrimary}>
          Провести
        </button>
        <button type="button" onClick={() => props.onDone(false)} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

Создайте `src/client/components/stock/StockPaymentsField.tsx`:

```tsx
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { useUnpaid } from '../../lib/stock';
import {
  distributedText,
  unpaidDocText,
  withAmount,
  withDoc,
  withoutDoc,
  type PaymentDraft,
} from '../../lib/stock-payments';
import { inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * «Оплата закупки» в расходе (§6.1 спецификации «Склад»): неоплаченные поступления выбранного поставщика — номер, дата,
 * сумма, долг. Можно отметить один или несколько и указать сумму к каждому; по умолчанию — долг, но не больше остатка суммы
 * расхода. Поля нет, пока нет поставщика с долгами (и нечего снимать). `operationId` — расход, который правят: его
 * собственные оплаты остаются в списке, даже если документ оплачен полностью.
 */
export function StockPaymentsField(props: {
  companyId: number;
  supplierId: number;
  operationId: number | null;
  currency: string;
  timeZone: string;
  payments: PaymentDraft[];
  /** Сумма расхода, минимальные единицы; null — ещё не введена. */
  amount: number | null;
  /** Первая отмеченная оплата при пустой сумме расхода подставляет её сама. */
  onAmount: (text: string) => void;
  onChange: (payments: PaymentDraft[]) => void;
  error?: string;
}) {
  const unpaid = useUnpaid(props.companyId, props.supplierId, props.operationId);
  const mu = getCurrency(props.currency).minorUnits;
  const docs = unpaid.data?.docs ?? [];
  // отмеченные документы, которых больше нет в списке (удалены), не показываются
  const shown = new Set(docs.map((d) => d.docId));
  if (docs.length === 0) return null;

  return (
    <fieldset className="grid gap-3 rounded-xl border border-field p-3">
      <legend className="px-1 text-sm font-semibold">Оплата закупки</legend>
      {docs.map((d) => {
        const row = props.payments.find((p) => p.docId === d.docId);
        const label = unpaidDocText(d, formatDateRu(todayInTimezone(props.timeZone, new Date(d.at))), props.currency);
        return (
          <div key={d.docId} className="grid gap-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={row !== undefined}
                onChange={(e) => {
                  if (!e.target.checked) {
                    props.onChange(withoutDoc(props.payments, d.docId));
                    return;
                  }
                  const next = withDoc(props.payments, d, props.amount, mu);
                  props.onChange(next);
                  const added = next.find((p) => p.docId === d.docId);
                  if (props.amount === null && added && added.amount !== '') props.onAmount(added.amount);
                }}
                className="mt-0.5 size-[18px] shrink-0 accent-income"
              />
              <span>{label}</span>
            </label>
            {row && (
              <NumberInput
                aria-label={`Оплата по ${d.number}`}
                value={row.amount}
                onChange={(t) => props.onChange(withAmount(props.payments, d.docId, t))}
                className={`${inputClass} ml-7 w-auto max-w-[calc(100%-1.75rem)]`}
              />
            )}
          </div>
        );
      })}
      <p className="text-sm text-muted">
        {distributedText(props.payments.filter((p) => shown.has(p.docId)), props.amount, props.currency)}
      </p>
      {props.error && (
        <p role="alert" className="text-sm text-expense-strong">
          {props.error}
        </p>
      )}
    </fieldset>
  );
}
```

Создайте `src/client/lib/stock-payments.ts`:

```ts
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { getCurrency } from '../../shared/currencies';
import { parseAmountText } from './amount-input';
import { amountInputText } from './journal-format';
import type { UnpaidDoc } from './stock';

/** Оплата закупки в форме расхода: какой документ и сколько платит этот расход (текст поля суммы). */
export interface PaymentDraft {
  docId: number;
  amount: string;
}

export type ParsedPayments = { ok: true; list: { docId: number; amount: number }[]; total: number } | { ok: false; error: string };

/** Разобрать оплаты формы: каждая сумма больше нуля. Пустой список — оплат нет. */
export function parsePayments(payments: readonly PaymentDraft[], minorUnits: number): ParsedPayments {
  const list: { docId: number; amount: number }[] = [];
  for (const p of payments) {
    const r = parseAmountText(p.amount, minorUnits);
    if (!r.ok || r.minor <= 0) return { ok: false, error: 'Укажите сумму оплаты по каждому документу' };
    list.push({ docId: p.docId, amount: r.minor });
  }
  return { ok: true, list, total: list.reduce((s, p) => s + p.amount, 0) };
}

/** Сколько ещё можно распределить из суммы расхода (без учёта документа exceptDocId); null — сумма расхода не введена. */
export function remainingAmount(opAmount: number | null, payments: readonly PaymentDraft[], minorUnits: number, exceptDocId?: number): number | null {
  if (opAmount === null) return null;
  const used = payments.filter((p) => p.docId !== exceptDocId).reduce((s, p) => {
    const r = parseAmountText(p.amount, minorUnits);
    return r.ok ? s + r.minor : s;
  }, 0);
  return Math.max(opAmount - used, 0);
}

/** Сумма по умолчанию: долг документа (без этого расхода), но не больше остатка суммы расхода. */
export function defaultPaymentAmount(doc: Pick<UnpaidDoc, 'debt' | 'own'>, remaining: number | null): number {
  const owed = Math.max(doc.debt + doc.own, 0);
  return remaining === null ? owed : Math.min(owed, remaining);
}

/** Отметить документ: оплата по умолчанию — долг, но не больше остатка суммы расхода. */
export function withDoc(payments: readonly PaymentDraft[], doc: UnpaidDoc, opAmount: number | null, minorUnits: number): PaymentDraft[] {
  if (payments.some((p) => p.docId === doc.docId)) return [...payments];
  const amount = defaultPaymentAmount(doc, remainingAmount(opAmount, payments, minorUnits));
  return [...payments, { docId: doc.docId, amount: amount > 0 ? amountInputText(amount, minorUnits) : '' }];
}

export function withoutDoc(payments: readonly PaymentDraft[], docId: number): PaymentDraft[] {
  return payments.filter((p) => p.docId !== docId);
}

export function withAmount(payments: readonly PaymentDraft[], docId: number, amount: string): PaymentDraft[] {
  return payments.map((p) => (p.docId === docId ? { ...p, amount } : p));
}

/** «Распределено ₸ 600 из ₸ 1 000» — под списком документов. */
export function distributedText(payments: readonly PaymentDraft[], opAmount: number | null, currency: string): string {
  const mu = getCurrency(currency).minorUnits;
  const total = payments.reduce((s, p) => {
    const r = parseAmountText(p.amount, mu);
    return r.ok ? s + r.minor : s;
  }, 0);
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  return opAmount === null ? `Распределено ${money(total)}` : `Распределено ${money(total)} из ${money(opAmount)}`;
}

/** Строка документа в списке: «П-0001 от 01.10.2026 · сумма 1 000 ₸ · долг 600 ₸». */
export function unpaidDocText(doc: UnpaidDoc, dateText: string, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const owed = doc.debt + doc.own;
  return `${doc.number} от ${dateText} · сумма ${money(doc.total)} · ${owed > 0 ? `долг ${money(owed)}` : 'оплачено'}`;
}
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
import { defaultAccounts, readLastAccounts, saveLastAccounts, withSaved } from '../../lib/last-account';
import { useNow } from '../../lib/use-now';
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
import {
  archivedAccountOf,
  convertBlockedHint,
```

на

```tsx
import { defaultAccounts, readLastAccounts, saveLastAccounts, withSaved } from '../../lib/last-account';
import { useNow } from '../../lib/use-now';
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
import { invalidateStock } from '../../lib/stock';
import {
  archivedAccountOf,
  convertBlockedHint,
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
  submitLabel,
  transferRateText,
  type OperationDraft,
} from '../../lib/operation-form';
import {
  accountOptions,
```

на

```tsx
  submitLabel,
  transferRateText,
  type OperationDraft,
  type OperationPrefill,
} from '../../lib/operation-form';
import {
  accountOptions,
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
import { ComboSelect } from './ComboSelect';
import { DateTimeField } from './DateTimeField';
import type { OperationFormRequest } from './OperationFormHost';
import { RateFix, type MissingRate } from './RateFix';
import { SalaryRow } from './SalaryRow';
import { SplitEditor } from './SplitEditor';
```

на

```tsx
import { ComboSelect } from './ComboSelect';
import { DateTimeField } from './DateTimeField';
import type { OperationFormRequest } from './OperationFormHost';
import { StockPaymentsField } from '../stock/StockPaymentsField';
import { RateFix, type MissingRate } from './RateFix';
import { SalaryRow } from './SalaryRow';
import { SplitEditor } from './SplitEditor';
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.kind === 'create' ? props.request.type : operation.data!.type}
          operation={operation.data ?? null}
          onEditingChange={setEditing}
          onTypeChange={setDraftType}
```

на

```tsx
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.kind === 'create' ? props.request.type : operation.data!.type}
          prefill={props.request.kind === 'create' ? props.request.prefill : undefined}
          operation={operation.data ?? null}
          onEditingChange={setEditing}
          onTypeChange={setDraftType}
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
  data: FormData;
  timeZone: string;
  type: OperationType;
  /** Правка существующей операции; null — новая. */
  operation: OperationRecord | null;
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
```

на

```tsx
  data: FormData;
  timeZone: string;
  type: OperationType;
  /** Новая операция из «Оплатить» у поступления склада: что подставить в пустую форму. */
  prefill?: OperationPrefill;
  /** Правка существующей операции; null — новая. */
  operation: OperationRecord | null;
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
  const [remembered] = useState(() => defaultAccounts(p.type, userId === null ? {} : readLastAccounts(userId, p.company.id), p.data.accounts));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() =>
    op ? draftFromOperation(op, accounts, p.timeZone) : emptyDraft(p.type, today, remembered.accountId, remembered.toAccountId),
  );
  const [draft, setDraft] = useState(initial);
  /** Фокус при открытии — первое пустое обязательное поле (§6.2): счёт, иначе сумма; при правке — сумма. */
```

на

```tsx
  const [remembered] = useState(() => defaultAccounts(p.type, userId === null ? {} : readLastAccounts(userId, p.company.id), p.data.accounts));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() =>
    op ? draftFromOperation(op, accounts, p.timeZone) : { ...emptyDraft(p.type, today, remembered.accountId, remembered.toAccountId), ...p.prefill },
  );
  const [draft, setDraft] = useState(initial);
  /** Фокус при открытии — первое пустое обязательное поле (§6.2): счёт, иначе сумма; при правке — сумма. */
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
    // у существующей операции при смене дня сохраняется прежнее время суток
    const timeOfDayFrom = op ? new Date(op.paidAt) : now;
    // buildBody разбирает сумму сам: Enter или главная кнопка без ухода из поля сохраняют текущий текст
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom, originalPaidAt: op?.paidAt });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
```

на

```tsx
    // у существующей операции при смене дня сохраняется прежнее время суток
    const timeOfDayFrom = op ? new Date(op.paidAt) : now;
    // buildBody разбирает сумму сам: Enter или главная кнопка без ухода из поля сохраняют текущий текст
    const r = buildBody(draft, {
      accounts,
      today: todayInTimezone(p.timeZone, now),
      timeZone: p.timeZone,
      now,
      timeOfDayFrom,
      originalPaidAt: op?.paidAt,
      baseCurrency: p.company.baseCurrency,
    });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
        }
      }
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
```

на

```tsx
        }
      }
      void invalidateOperations(p.company.id);
      // оплаты закупок меняют «оплачено» у поступлений склада
      void invalidateStock(p.company.id);
      if (then === 'close') {
        p.close();
        return;
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
    try {
      await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'DELETE' });
      void invalidateOperations(p.company.id);
      setConfirmDelete(false);
      p.onDeleted();
      p.close();
```

на

```tsx
    try {
      await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'DELETE' });
      void invalidateOperations(p.company.id);
      void invalidateStock(p.company.id);
      setConfirmDelete(false);
      p.onDeleted();
      p.close();
```

В `src/client/components/operation/OperationForm.tsx` замените

```tsx
              value={draft.counterpartyId}
              options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
              emptyLabel="Без контрагента"
              onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
              onCreate={(name) => createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId }))}
              createNoun="контрагента"
              error={errors.counterpartyId}
            />
          )}
          {!transfer && paidDateField}
          {readOnly ? (
            // архивная компания: только поля, без строк-действий (§6.7)
```

на

```tsx
              value={draft.counterpartyId}
              options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
              emptyLabel="Без контрагента"
              // оплаты относились к поступлениям прежнего поставщика
              onChange={(counterpartyId) => set({ counterpartyId, stockPayments: [] }, 'counterpartyId', 'stockPayments')}
              onCreate={(name) => createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId, stockPayments: [] }))}
              createNoun="контрагента"
              error={errors.counterpartyId}
            />
          )}
          {draft.type === 'expense' && draft.counterpartyId !== null && account?.currency === p.company.baseCurrency && (
            <StockPaymentsField
              key={draft.counterpartyId}
              companyId={p.company.id}
              supplierId={draft.counterpartyId}
              operationId={op?.id ?? null}
              currency={p.company.baseCurrency}
              timeZone={p.timeZone}
              payments={draft.stockPayments}
              amount={amountMinor}
              onAmount={(amount) => set({ amount }, 'amount')}
              onChange={(stockPayments) => set({ stockPayments }, 'stockPayments')}
              error={errors.stockPayments}
            />
          )}
          {!transfer && paidDateField}
          {readOnly ? (
            // архивная компания: только поля, без строк-действий (§6.7)
```

В `src/client/components/operation/OperationFormHost.tsx` замените

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа или существующую по id. */
export type OperationFormRequest =
  | { kind: 'create'; type: OperationType }
  | {
      kind: 'edit';
      id: number;
```

на

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { OperationPrefill } from '../../lib/operation-form';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа или существующую по id. */
export type OperationFormRequest =
  | {
      kind: 'create';
      type: OperationType;
      /** «Оплатить» у поступления склада: расход с поставщиком, суммой и оплатой документа. */
      prefill?: OperationPrefill;
    }
  | {
      kind: 'edit';
      id: number;
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { WRITEOFF_REASON_LABELS, WRITEOFF_REASONS, type StockDocType, type WriteoffReason } from '../../../shared/schemas/stock';
import { UNIT_LABELS } from '../../../shared/stock-qty';
import { api, ApiError } from '../../lib/api';
import { dayOf } from '../../lib/journal-format';
import { createFromForm } from '../../lib/operation-create';
import { shownPaidTime } from '../../lib/operation-form';
import { counterpartyOptions } from '../../lib/operation-options';
```

на

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { WRITEOFF_REASON_LABELS, WRITEOFF_REASONS, type StockDocType, type WriteoffReason } from '../../../shared/schemas/stock';
import { UNIT_LABELS } from '../../../shared/stock-qty';
import { api, ApiError } from '../../lib/api';
import { amountInputText, dayOf } from '../../lib/journal-format';
import { createFromForm } from '../../lib/operation-create';
import { shownPaidTime } from '../../lib/operation-form';
import { counterpartyOptions } from '../../lib/operation-options';
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
  emptyDocDraft,
  impactText,
  newDocLine,
  setLineAmount,
  setLineItem,
  setLinePrice,
```

на

```tsx
  emptyDocDraft,
  impactText,
  newDocLine,
  paymentSummary,
  setLineAmount,
  setLineItem,
  setLinePrice,
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
  type DocLineDraft,
  type ItemInfo,
} from '../../lib/stock-doc-form';
import { invalidateStock, useStockItems, useStockWarehouses, type DocImpact, type StockDoc, type StockItem, type StockWarehouse } from '../../lib/stock';
import { useNow } from '../../lib/use-now';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { DateTimeField } from '../operation/DateTimeField';
import { Pending } from '../QueryState';
import { alertClass, btnDanger, btnIcon, btnSecondary, floatingControlClass, floatingTextareaClass, noticeClass, phoneFullScreenModal } from '../ui';
import { NumberInput } from './NumberInput';

/** Что открыть: новый документ типа или существующий по id. */
export type DocFormRequest = { kind: 'create'; type: StockDocType; warehouse: number | null } | { kind: 'edit'; id: number };
```

на

```tsx
  type DocLineDraft,
  type ItemInfo,
} from '../../lib/stock-doc-form';
import { invalidateStock, useStockItems, useStockWarehouses, type DocImpact, type StockDoc, type StockItem, type StockWarehouse, type Unpaid } from '../../lib/stock';
import { useNow } from '../../lib/use-now';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { useOpenOperationForm } from '../operation/OperationFormHost';
import { DateTimeField } from '../operation/DateTimeField';
import { Pending } from '../QueryState';
import { alertClass, btnDanger, btnIcon, btnSecondary, btnSmall, floatingControlClass, floatingTextareaClass, noticeClass, phoneFullScreenModal } from '../ui';
import { NumberInput } from './NumberInput';
import { PostToJournal } from './PostToJournal';

/** Что открыть: новый документ типа или существующий по id. */
export type DocFormRequest = { kind: 'create'; type: StockDocType; warehouse: number | null } | { kind: 'edit'; id: number };
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
  /** Вопрос о последствиях правки (§5.4): текст и действие «Сохранить» / «Удалить». */
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: () => Promise<void> } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const type = p.type;
```

на

```tsx
  /** Вопрос о последствиях правки (§5.4): текст и действие «Сохранить» / «Удалить». */
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: () => Promise<void> } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Окно «Провести в журнал» у продажи (§6.3). */
  const [posting, setPosting] = useState(false);
  const openOperation = useOpenOperationForm();
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const type = p.type;
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
    }
  };

  const createItem = async (name: string, key: number): Promise<boolean> => {
    setFormError(null);
    try {
```

на

```tsx
    }
  };

  /** Обновить документ с сервера, не трогая правки формы: изменились оплаты или проведение. */
  const refreshDoc = async () => {
    if (!doc) return;
    try {
      setDoc((await api<{ doc: StockDoc }>(`${base}/${doc.id}`)).doc);
    } catch {
      /* данные обновятся при следующем открытии */
    }
  };

  /** «Оплатить» (§6.1): расход с поставщиком, суммой — долгом документа — и отмеченным документом; категория — прошлая для поставщика. */
  const pay = async () => {
    if (!doc || pending || doc.counterpartyId === null) return;
    const debt = doc.total - doc.paid;
    setPending(true);
    try {
      const unpaid = await api<Unpaid>(`/companies/${p.company.id}/stock/suppliers/${doc.counterpartyId}/unpaid`);
      const amount = amountInputText(debt, currency.minorUnits);
      p.close();
      openOperation({
        kind: 'create',
        type: 'expense',
        prefill: { counterpartyId: doc.counterpartyId, amount, categoryId: unpaid.lastCategoryId, stockPayments: [{ docId: doc.id, amount }] },
      });
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
    }
  };

  const createItem = async (name: string, key: number): Promise<boolean> => {
    setFormError(null);
    try {
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
          </Field>
        </fieldset>

        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>Документ изменён другим пользователем</span>
```

на

```tsx
          </Field>
        </fieldset>

        {doc && !doc.deletedAt && type === 'receipt' && (
          <section aria-label="Оплата" className="grid gap-2 rounded-xl bg-field px-4 py-3 text-sm">
            <p className="font-medium">{paymentSummary(doc.total, doc.paid, p.company.baseCurrency)}</p>
            {doc.payments.length > 0 && (
              <ul aria-label="Оплаты" className="text-muted">
                {doc.payments.map((x) => (
                  <li key={x.operationId}>
                    {formatDateRu(todayInTimezone(p.timeZone, new Date(x.paidAt)))} — {money(x.amount)}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && doc.counterpartyId !== null && doc.total - doc.paid > 0 && (
              <button
                type="button"
                aria-disabled={dirty || pending || undefined}
                title={dirty ? 'Сначала сохраните изменения документа' : undefined}
                onClick={() => {
                  if (!dirty) void pay();
                }}
                className={`${btnSmall} justify-self-start aria-disabled:opacity-50`}
              >
                Оплатить
              </button>
            )}
            {doc.counterpartyId === null && <p className="text-muted">Чтобы оплатить поступление, укажите поставщика.</p>}
          </section>
        )}
        {doc && !doc.deletedAt && type === 'sale' && (
          <section aria-label="Журнал" className="grid gap-2 rounded-xl bg-field px-4 py-3 text-sm">
            {doc.posting ? (
              <p className="font-medium">
                Проведена в журнал: доход {money(doc.posting.amount)}
                {doc.posting.amount !== doc.total && <span className="text-muted"> (сумма документа {money(doc.total)} — операцию журнала правьте отдельно)</span>}
              </p>
            ) : (
              !readOnly &&
              doc.total > 0 && (
                <button
                  type="button"
                  aria-disabled={dirty || pending || undefined}
                  title={dirty ? 'Сначала сохраните изменения документа' : undefined}
                  onClick={() => {
                    if (!dirty) setPosting(true);
                  }}
                  className={`${btnSmall} justify-self-start aria-disabled:opacity-50`}
                >
                  Провести в журнал
                </button>
              )
            )}
          </section>
        )}
        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>Документ изменён другим пользователем</span>
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
          </div>
        )}
      </form>
      <ConfirmDialog
        open={ask !== null}
        title={ask?.title ?? ''}
```

на

```tsx
          </div>
        )}
      </form>
      <Modal open={posting && doc !== null} title="Провести в журнал" onClose={() => setPosting(false)} className="max-w-md">
        {posting && doc && (
          <PostToJournal
            company={p.company}
            doc={doc}
            onDone={(posted) => {
              setPosting(false);
              if (posted) void refreshDoc();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={ask !== null}
        title={ask?.title ?? ''}
```

В `src/client/lib/operation-edit.ts` замените

```ts
  deletedAt: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

type AccountLike = { id: number; currency: string; archivedAt: string | null };
```

на

```ts
  deletedAt: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
  /** Оплаты закупок расхода с номерами поступлений (§6.1 спецификации «Склад»); у операций без оплат — пусто или нет. */
  stockPayments?: { docId: number; number: string; amount: number }[];
}

type AccountLike = { id: number; currency: string; archivedAt: string | null };
```

В `src/client/lib/operation-edit.ts` замените

```ts
    split: split
      ? { mode: 'amount', lines: op.lines.map((l) => newLine({ categoryId: l.categoryId, projectId: l.projectId, value: amountInputText(l.amount, minor) })) }
      : null,
  };
}
```

на

```ts
    split: split
      ? { mode: 'amount', lines: op.lines.map((l) => newLine({ categoryId: l.categoryId, projectId: l.projectId, value: amountInputText(l.amount, minor) })) }
      : null,
    stockPayments: (op.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: amountInputText(p.amount, minor) })),
  };
}
```

В `src/client/lib/operation-edit.ts` замените

```ts

const sameLines = (a: OperationRecord['lines'], b: OperationBody['lines']) =>
  a.length === b.length && a.every((l, i) => l.categoryId === b[i]!.categoryId && l.projectId === b[i]!.projectId && l.amount === b[i]!.amount);
const sameIds = (a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
```

на

```ts

const sameLines = (a: OperationRecord['lines'], b: OperationBody['lines']) =>
  a.length === b.length && a.every((l, i) => l.categoryId === b[i]!.categoryId && l.projectId === b[i]!.projectId && l.amount === b[i]!.amount);
const samePayments = (a: NonNullable<OperationRecord['stockPayments']>, b: OperationBody['stockPayments']) => {
  const key = (l: readonly { docId: number; amount: number }[]) => JSON.stringify([...l].sort((x, y) => x.docId - y.docId).map((p) => [p.docId, p.amount]));
  return key(a) === key(b);
};
const sameIds = (a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
```

В `src/client/lib/operation-edit.ts` замените

```ts
  if (body.comment !== op.comment) patch.comment = body.comment;
  if (!sameLines(op.lines, body.lines)) patch.lines = body.lines;
  if (!sameIds(op.tagIds, body.tagIds)) patch.tagIds = body.tagIds;
  return Object.keys(patch).length > 1 ? patch : null;
}
```

на

```ts
  if (body.comment !== op.comment) patch.comment = body.comment;
  if (!sameLines(op.lines, body.lines)) patch.lines = body.lines;
  if (!sameIds(op.tagIds, body.tagIds)) patch.tagIds = body.tagIds;
  if (!samePayments(op.stockPayments ?? [], body.stockPayments)) patch.stockPayments = body.stockPayments;
  return Object.keys(patch).length > 1 ? patch : null;
}
```

В `src/client/lib/operation-edit.ts` замените

```ts

/** «Дублировать платёж» (§7, §2.3 этапа 1.5): новая операция с теми же значениями, без архивных ссылок, «сегодня» и живое время. */
export function duplicateDraft(draft: OperationDraft, available: Available, today: string): OperationDraft {
  return { ...withoutArchived(draft, available), paidDate: today, paidDateSet: false, paidTime: '', paidTimeSet: false };
}

/** Архивный счёт, который затрагивает операция: сумму, дату оплаты и счета менять нельзя, удалить нельзя (инвариант 7). */
```

на

```ts

/** «Дублировать платёж» (§7, §2.3 этапа 1.5): новая операция с теми же значениями, без архивных ссылок, «сегодня» и живое время. */
export function duplicateDraft(draft: OperationDraft, available: Available, today: string): OperationDraft {
  // оплата закупки остаётся у исходного расхода: копия никого не оплачивает
  return { ...withoutArchived(draft, available), paidDate: today, paidDateSet: false, paidTime: '', paidTimeSet: false, stockPayments: [] };
}

/** Архивный счёт, который затрагивает операция: сумму, дату оплаты и счета менять нельзя, удалить нельзя (инвариант 7). */
```

В `src/client/lib/operation-edit.ts` замените

```ts
    losses.push(`разбиение на ${n} ${pluralRu(n, 'строку', 'строки', 'строк')}`);
  }
  if (draft.accrualOn) losses.push('дата сделки');
  const projects = draft.split ? [...new Set(draft.split.lines.map((l) => l.projectId))] : [draft.projectId];
  const income = draft.type === 'income';
  return {
```

на

```ts
    losses.push(`разбиение на ${n} ${pluralRu(n, 'строку', 'строки', 'строк')}`);
  }
  if (draft.accrualOn) losses.push('дата сделки');
  if (draft.stockPayments.length > 0) losses.push('оплата закупки');
  const projects = draft.split ? [...new Set(draft.split.lines.map((l) => l.projectId))] : [draft.projectId];
  const income = draft.type === 'income';
  return {
```

В `src/client/lib/operation-edit.ts` замените

```ts
      counterpartyId: null,
      accrualOn: false,
      split: null,
    },
    losses,
    carried: income ? draft.amount : null,
```

на

```ts
      counterpartyId: null,
      accrualOn: false,
      split: null,
      stockPayments: [],
    },
    losses,
    carried: income ? draft.amount : null,
```

В `src/client/lib/operation-form.ts` замените

```ts
import type { OperationType } from './journal-filter';
import { parseAmountText } from './amount-input';
import { dayOf } from './journal-format';
import { similarSplit, splitLines, splitResult, type SplitDraft } from './split';

/**
```

на

```ts
import type { OperationType } from './journal-filter';
import { parseAmountText } from './amount-input';
import { dayOf } from './journal-format';
import { parsePayments, type PaymentDraft } from './stock-payments';
import { similarSplit, splitLines, splitResult, type SplitDraft } from './split';

/**
```

В `src/client/lib/operation-form.ts` замените

```ts
  comment: string;
  /** «Разделить» (только доход и расход): строки вместо категории и проекта. null — без разбиения. */
  split: SplitDraft | null;
}

/** Тело POST /companies/:cid/operations (план 4a, `operationCreateSchema`). */
export interface OperationBody {
  type: OperationType;
```

на

```ts
  comment: string;
  /** «Разделить» (только доход и расход): строки вместо категории и проекта. null — без разбиения. */
  split: SplitDraft | null;
  /** Оплата закупки (только расход со счёта в валюте компании, §6.1 спецификации «Склад»): поступления, которые гасит этот расход. */
  stockPayments: PaymentDraft[];
}

/** Что подставить в новую операцию: «Оплатить» у поступления открывает расход с поставщиком, суммой и оплатой документа. */
export type OperationPrefill = Partial<Pick<OperationDraft, 'counterpartyId' | 'amount' | 'categoryId' | 'stockPayments' | 'comment'>>;

/** Тело POST /companies/:cid/operations (план 4a, `operationCreateSchema`). */
export interface OperationBody {
  type: OperationType;
```

В `src/client/lib/operation-form.ts` замените

```ts
  comment: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

export interface AccountLike {
```

на

```ts
  comment: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
  stockPayments: { docId: number; amount: number }[];
}

export interface AccountLike {
```

В `src/client/lib/operation-form.ts` замените

```ts
   * и без «не позже сейчас» (§2.3 этапа 1.5): сохранённое время может быть позже «сейчас» этого устройства.
   */
  originalPaidAt?: string;
}

export type BuildResult = { ok: true; body: OperationBody } | { ok: false; errors: Record<string, string> };
```

на

```ts
   * и без «не позже сейчас» (§2.3 этапа 1.5): сохранённое время может быть позже «сейчас» этого устройства.
   */
  originalPaidAt?: string;
  /** Базовая валюта компании: оплата закупки возможна только со счёта в ней (иначе оплаты в запрос не идут). */
  baseCurrency?: string;
}

export type BuildResult = { ok: true; body: OperationBody } | { ok: false; errors: Record<string, string> };
```

В `src/client/lib/operation-form.ts` замените

```ts
    tagIds: [],
    comment: '',
    split: null,
  };
}
```

на

```ts
    tagIds: [],
    comment: '',
    split: null,
    stockPayments: [],
  };
}
```

В `src/client/lib/operation-form.ts` замените

```ts
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
    toAccountId: type === 'transfer' ? draft.toAccountId : null,
    toAmount: type === 'transfer' ? draft.toAmount : '',
  };
}
```

на

```ts
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
    toAccountId: type === 'transfer' ? draft.toAccountId : null,
    toAmount: type === 'transfer' ? draft.toAmount : '',
    stockPayments: [],
  };
}
```

В `src/client/lib/operation-form.ts` замените

```ts
    comment: '',
    split: draft.split && similarSplit(draft.split),
    paidTime: draft.paidTimeSet ? draft.paidTime : '',
  };
}
```

на

```ts
    comment: '',
    split: draft.split && similarSplit(draft.split),
    paidTime: draft.paidTimeSet ? draft.paidTime : '',
    // оплата закупки относится к одному расходу: у похожего её нет
    stockPayments: [],
  };
}
```

В `src/client/lib/operation-form.ts` замените

```ts
  const comment = draft.comment.trim();
  if (comment.length > COMMENT_MAX) errors.comment = `Не длиннее ${COMMENT_MAX} символов`;

  // правка, дата та же, время не трогали — момент операции без изменений (секунды, без «не позже сейчас»)
  const original = !draft.paidTimeSet && dateUnchanged ? (ctx.originalPaidAt ?? null) : null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
```

на

```ts
  const comment = draft.comment.trim();
  if (comment.length > COMMENT_MAX) errors.comment = `Не длиннее ${COMMENT_MAX} символов`;

  // оплата закупки: только расход со счёта в валюте компании; сумма оплат не больше суммы расхода (§6.1 спецификации «Склад»)
  let stockPayments: OperationBody['stockPayments'] = [];
  if (draft.type === 'expense' && account && (ctx.baseCurrency === undefined || account.currency === ctx.baseCurrency) && draft.stockPayments.length > 0) {
    const r = parsePayments(draft.stockPayments, getCurrency(account.currency).minorUnits);
    if (!r.ok) errors.stockPayments = r.error;
    else if (amount > 0 && r.total > amount) errors.stockPayments = 'Оплаты закупок больше суммы расхода';
    else stockPayments = r.list;
  }

  // правка, дата та же, время не трогали — момент операции без изменений (секунды, без «не позже сейчас»)
  const original = !draft.paidTimeSet && dateUnchanged ? (ctx.originalPaidAt ?? null) : null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
```

В `src/client/lib/operation-form.ts` замените

```ts
          ? splitLines(split, result)
          : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
      tagIds: [...draft.tagIds],
    },
  };
}
```

на

```ts
          ? splitLines(split, result)
          : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
      tagIds: [...draft.tagIds],
      stockPayments,
    },
  };
}
```

В `src/client/lib/stock-doc-form.ts` замените

```ts
import { getCurrency } from '../../shared/currencies';
import { formatDateRu, isValidDate, parseTimeInput, timeOfDay, todayInTimezone } from '../../shared/dates';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import { lineAmount, parseQty, qtyInputText, unitPrice, type StockUnit } from '../../shared/stock-qty';
```

на

```ts
import { getCurrency } from '../../shared/currencies';
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { formatDateRu, isValidDate, parseTimeInput, timeOfDay, todayInTimezone } from '../../shared/dates';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import { lineAmount, parseQty, qtyInputText, unitPrice, type StockUnit } from '../../shared/stock-qty';
```

В `src/client/lib/stock-doc-form.ts` замените

```ts
  if (paid === total) return { kind: 'paid', debt: 0 };
  return { kind: 'over', debt: total - paid };
}
```

на

```ts
  if (paid === total) return { kind: 'paid', debt: 0 };
  return { kind: 'over', debt: total - paid };
}

/** Строка «Оплата» в списке документов: «Долг 1 000 ₸», «Оплачено 400 ₸ из 1 000 ₸», «Оплачено», «Переплата 50 ₸». */
export function paymentLabel(total: number, paid: number, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const state = paymentState(total, paid);
  if (state.kind === 'none') return `Долг ${money(total)}`;
  if (state.kind === 'partial') return `Оплачено ${money(paid)} из ${money(total)}`;
  if (state.kind === 'paid') return 'Оплачено';
  return `Переплата ${money(-state.debt)}`;
}

/** Итог оплаты в окне поступления (§6.1): «Оплачено X из Y. Долг Z» или «… Переплата Z». */
export function paymentSummary(total: number, paid: number, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const state = paymentState(total, paid);
  if (state.kind === 'none') return `Не оплачено. Долг ${money(total)}`;
  const head = `Оплачено ${money(paid)} из ${money(total)}`;
  if (state.kind === 'partial') return `${head}. Долг ${money(state.debt)}`;
  if (state.kind === 'over') return `${head}. Переплата ${money(-state.debt)}`;
  return head;
}
```

В `src/client/pages/stock/DocsTab.tsx` замените

```tsx
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { STOCK_DOC_TYPE_LABELS, STOCK_DOC_TYPES, WRITEOFF_REASON_LABELS, type StockDocType } from '../../../shared/schemas/stock';
import { DocForm, type DocFormRequest } from '../../components/stock/DocForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { useCounterparties } from '../../lib/queries';
```

на

```tsx
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { STOCK_DOC_TYPE_LABELS, STOCK_DOC_TYPES, WRITEOFF_REASON_LABELS, type StockDocType } from '../../../shared/schemas/stock';
import { DocForm, type DocFormRequest } from '../../components/stock/DocForm';
import { paymentLabel } from '../../lib/stock-doc-form';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { useCounterparties } from '../../lib/queries';
```

В `src/client/pages/stock/DocsTab.tsx` замените

```tsx
                <th scope="col" className={`${thClass} text-right`}>
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
```

на

```tsx
                <th scope="col" className={`${thClass} text-right`}>
                  Сумма
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Оплата / журнал
                </th>
              </tr>
            </thead>
            <tbody>
```

В `src/client/pages/stock/DocsTab.tsx` замените

```tsx
                    {d.type === 'writeoff' ? (d.reason ? WRITEOFF_REASON_LABELS[d.reason] : '') : d.counterpartyId === null ? '—' : (counterpartyName.get(d.counterpartyId) ?? '…')}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{d.type === 'writeoff' ? '—' : money(d.total)}</td>
                </tr>
              ))}
            </tbody>
```

на

```tsx
                    {d.type === 'writeoff' ? (d.reason ? WRITEOFF_REASON_LABELS[d.reason] : '') : d.counterpartyId === null ? '—' : (counterpartyName.get(d.counterpartyId) ?? '…')}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{d.type === 'writeoff' ? '—' : money(d.total)}</td>
                  <td className={`${tdClass} max-md:hidden`}>
                    {d.type === 'receipt' ? paymentLabel(d.total, d.paid, company.baseCurrency) : d.type === 'sale' && d.posted ? 'В журнале' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
```

- [ ] **Step 4: Run tests, typecheck and e2e**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e` (два раза подряд).
Expected: `npm test` - 1264 пройдено и 1 пропущен, typecheck без ошибок, e2e — 177 из 177.

- [ ] **Step 5: Commit**

```bash
git add src tests e2e
git commit -m "feat: оплата закупки в расходе и у поступления, продажа в журнал (Склад-1b, задача 4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Телефон, 409 и архивная компания, `shots:ux`, README (§4, §13)

**Files:**
- Modify: `README.md`, `scripts/ux-shots.ts`, `src/client/components/MobileTabBar.tsx`, `src/client/components/stock/DocForm.tsx`, `src/client/pages/StockPage.tsx`
- Test: `e2e/stock.spec.ts`

**Interfaces:**
- Consumes: всё из задач 1–4; `scripts/ux-shots.ts` (`apiOf`, `SCENARIOS`, `shoot`).
- Produces: заголовок экрана «Склад» получает фокус после перехода из «Ещё» (ссылка ведёт сразу на «Остатки»); e2e телефона, 409 и архивной компании; снимки `c44-stock-balance.png`, `c45-stock-docs.png`, `c46-stock-receipt-form.png`, `cm05-stock.png`; раздел README «Склад».

- [ ] **Step 1: Write the failing tests**

Единственный новый код-тест — e2e; unit-тестов у задачи нет.

В `e2e/stock.spec.ts` замените

```ts
  const income = (await (await page.request.get(`${base}/operations`)).json()) as { items: { type: string; comment: string | null; amount: number }[] };
  expect(income.items.filter((o) => o.type === 'income')).toMatchObject([{ comment: 'Продажа Р-0001', amount: 100_000 }]);
});
```

на

```ts
  const income = (await (await page.request.get(`${base}/operations`)).json()) as { items: { type: string; comment: string | null; amount: number }[] };
  expect(income.items.filter((o) => o.type === 'income')).toMatchObject([{ comment: 'Продажа Р-0001', amount: 100_000 }]);
});

test('телефон: «Ещё» → «Склад», остатки без лишних колонок, поступление в окне на весь экран', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон склад ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });

  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await page.goto(`/c/${cid}/log`);
  // вкладок-пилюль на телефоне нет: «Склад» — в меню «Ещё» нижней панели
  await expect(page.getByRole('main').getByRole('link', { name: 'Склад', exact: true })).toBeHidden();
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('link', { name: 'Склад' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Склад' })).toBeFocused();

  // остатки: на узком экране только товар, остаток и себестоимость; страница не прокручивается вбок
  const balance = main(page).getByRole('table', { name: 'Остатки' });
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('10 шт');
  await expect(balance.getByRole('columnheader', { name: 'Цена продажи' })).toBeHidden();
  await expect(balance.getByRole('columnheader', { name: 'Себестоимость' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // документы: форма поступления — окно на весь экран
  await main(page).getByRole('link', { name: 'Документы', exact: true }).click();
  await main(page).getByRole('button', { name: '+ Поступление' }).click();
  const receipt = page.getByRole('dialog', { name: 'Новое поступление' });
  const box = (await receipt.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([phone.width, phone.height]);
  await receipt.getByLabel('Склад', { exact: true }).selectOption({ label: 'Бар Клуб 1' });
  const line = receipt.getByRole('group', { name: 'Строка 1' });
  await line.getByRole('combobox', { name: 'Товар', exact: true }).click();
  await page.getByRole('option', { name: 'Чипсы' }).click();
  await line.getByLabel('Количество, шт').fill('5');
  await line.getByLabel('Сумма, ₸').fill('250');
  await expect(line.getByLabel('Цена, ₸')).toHaveValue('50');
  expect(await receipt.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await receipt.getByRole('button', { name: 'Добавить поступление' }).click();
  await expect(receipt).toBeHidden();
  await expect(main(page).getByRole('table', { name: 'Документы' }).getByRole('row').filter({ hasText: 'П-0002' })).toContainText(/250\s*₸/);
});

test('одновременная правка документа: «Документ изменён другим пользователем» и «Загрузить актуальный»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Конфликт ${Date.now()}`);
  const s = await stockSetup(page, cid);
  const created = await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.cola, qty: 1000, amount: 10_000 }] });
  await page.goto(`/c/${cid}/stock/docs`);
  await main(page).getByRole('table', { name: 'Документы' }).getByRole('button', { name: 'Открыть поступление П-0001' }).click();
  const dialog = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await dialog.getByLabel('Комментарий').fill('моя правка');
  // тем временем другой пользователь правит тот же документ
  const res = await page.request.patch(`${s.base}/stock/docs/${created.doc.id}`, { data: { version: 1, comment: 'чужая правка' }, headers: csrf(page) });
  expect(res.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Документ изменён другим пользователем');
  await dialog.getByRole('button', { name: 'Загрузить актуальный' }).click();
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('чужая правка');
});

test('архивная компания: склад только для чтения — кнопок создания нет, документ открывается без кнопок сохранения', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив склад ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 1000, amount: 10_000 }] });
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});

  await page.goto(`/c/${cid}/stock/docs`);
  await expect(main(page).getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
  await expect(main(page).getByRole('button', { name: '+ Поступление' })).toHaveCount(0);
  await main(page).getByRole('table', { name: 'Документы' }).getByRole('button', { name: 'Открыть поступление П-0001' }).click();
  const dialog = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await expect(dialog.getByRole('button', { name: 'Сохранить изменения' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Удалить документ' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await main(page).getByRole('link', { name: 'Товары', exact: true }).click();
  await expect(main(page).getByRole('button', { name: '+ Товар' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test e2e/stock.spec.ts -g "телефон"`
Expected: FAIL — падает e2e «телефон» (на этом шаге он единственный новый); e2e телефона: заголовок «Склад» не получает фокус после перехода из «Ещё», а форма поступления без выбранного склада не сохраняется (склад выбирается в тесте).

- [ ] **Step 3: Write the implementation**

В `README.md` замените

```md
  - массовых действий и «Указать» на телефоне нет — они в таблице на компьютере;
  - приложение можно добавить на главный экран телефона (PWA): название — из `APP_NAME`, иконка своя; без офлайн-режима.

- **Эксплуатация (шаг 8):**
  - режим `vps` с Caddy и systemd;
  - автозапуск `npm run service:install` (Windows — при входе пользователя, без окна; Linux — systemd);
```

на

```md
  - массовых действий и «Указать» на телефоне нет — они в таблице на компьютере;
  - приложение можно добавить на главный экран телефона (PWA): название — из `APP_NAME`, иконка своя; без офлайн-режима.

- **Склад (планы Склад-1a и Склад-1b, спецификация [«Склад»](docs/superpowers/specs/2026-10-15-warehouse-design.md)):**
  - вкладка «Склад» рядом с «Журналом» (на телефоне — «Ещё» → «Склад»): «Остатки», «Документы», «Товары»; склады и группы товаров — «Настройки» → «Склады»;
  - документы «Поступление», «Продажа», «Списание»: себестоимость по FIFO, партии пересчитываются при правке и удалении документа любой даты; перед записью окно предупреждает, у скольких проданных позиций изменится себестоимость;
  - продажа без остатка проводится («Нет партии»), поступление с более ранней датой закрывает такой долг; ручное списание без остатка — ошибка;
  - цена продажи хранит историю; поля количества и сумм принимают только цифры и один разделитель;
  - оплата закупки: в расходе журнала у поставщика с долгами появляется «Оплата закупки», у поступления — «Оплатить», «Оплачено X из Y», долг или переплата; удаление расхода снимает оплату;
  - «Провести в журнал» у продажи создаёт доход (магазин); в левой панели под счетами — группа «Склад» со стоимостью, в «Всего на счетах» она не входит.
  - Перемещения, инвентаризация, комплекты и импорт — план Склад-2; аналитика — Склад-3.

- **Эксплуатация (шаг 8):**
  - режим `vps` с Caddy и systemd;
  - автозапуск `npm run service:install` (Windows — при входе пользователя, без окна; Linux — systemd);
```

В `scripts/ux-shots.ts` замените

```ts
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '13:00:00'), amount: 700 }),
];

/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */
const SCENARIOS: Scenario[] = [
  { ours: 'c01-log.png', finmap: '01-log.png', path: 'log' },
```

на

```ts
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '13:00:00'), amount: 700 }),
];

/**
 * Склад для снимков «Склад» (план Склад-1): склад первого проекта, три синтетических товара, поступление и продажа.
 * Повторный вызов ничего не создаёт — сценарии идут каждый в своём входе, данные общие.
 */
const seedStock = async (p: Page) => {
  const { cid, headers } = apiOf(p);
  const base = `/api/v1/companies/${cid}`;
  const get = async (url: string) => (await (await p.request.get(url)).json()) as any;
  const post = async (url: string, data: unknown) => {
    const res = await p.request.post(url, { headers, data });
    if (!res.ok()) throw new Error(`${url}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as any;
  };
  if ((await get(`${base}/stock/warehouses`)).warehouses.length > 0) return;
  const project = (await get(`${base}/projects`)).projects.find((x: { archivedAt: string | null }) => !x.archivedAt);
  const warehouse = (await post(`${base}/stock/warehouses`, { projectId: project.id, name: `Бар ${project.name}` })).warehouse.id as number;
  const group = (await post(`${base}/stock/groups`, { name: 'Напитки' })).group.id as number;
  const item = async (name: string, salePrice: number, extra: Record<string, unknown> = {}) =>
    (await post(`${base}/stock/items`, { name, unit: 'pcs', salePrice, ...extra })).item.id as number;
  const cola = await item('Кола 0,5', 50_000, { groupId: group });
  const chips = await item('Чипсы', 70_000, { minQty: 5000 });
  const supplier = (await post(`${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  await post(`${base}/stock/docs`, {
    type: 'receipt',
    at: '2026-10-08T10:00:00.000Z',
    warehouseId: warehouse,
    counterpartyId: supplier,
    lines: [
      { itemId: cola, qty: 24_000, amount: 240_000 },
      { itemId: chips, qty: 3000, amount: 21_000 },
    ],
  });
  await post(`${base}/stock/docs`, { type: 'sale', at: '2026-10-09T10:00:00.000Z', warehouseId: warehouse, lines: [{ itemId: cola, qty: 6000, amount: 300_000 }] });
};
const stockTable = (p: Page) => p.getByRole('main').getByRole('table', { name: 'Остатки' });

/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */
const SCENARIOS: Scenario[] = [
  { ours: 'c01-log.png', finmap: '01-log.png', path: 'log' },
```

В `scripts/ux-shots.ts` замените

```ts
      await history.getByRole('button', { name: /^Отменить импорт «выгрузка-октябрь\.xlsx»/ }).waitFor();
    },
  },
];

function fail(message: string): never {
```

на

```ts
      await history.getByRole('button', { name: /^Отменить импорт «выгрузка-октябрь\.xlsx»/ }).waitFor();
    },
  },
  // «Склад» (план Склад-1): остатки, документы, форма поступления; на телефоне — «Остатки» через «Ещё»
  {
    ours: 'c44-stock-balance.png',
    finmap: '44-stock-balance.png',
    path: 'stock/balance',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await stockTable(p).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
      await stockTable(p).getByRole('button', { name: 'Партии: Кола 0,5' }).click();
    },
  },
  {
    ours: 'c45-stock-docs.png',
    finmap: '45-stock-docs.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('table', { name: 'Документы' }).locator('tbody tr').first().waitFor();
    },
  },
  {
    ours: 'c46-stock-receipt-form.png',
    finmap: '46-stock-receipt-form.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: '+ Поступление' }).click();
      await p.getByRole('dialog', { name: 'Новое поступление' }).getByRole('group', { name: 'Строка 1' }).waitFor();
    },
  },
  {
    ours: 'cm05-stock.png',
    finmap: 'm05-stock.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('link', { name: 'Склад' }).click();
      await stockTable(p).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
    },
  },
];

function fail(message: string): never {
```

В `src/client/components/MobileTabBar.tsx` замените

```tsx
  const inStock = useMatch('/c/:companyId/stock/*') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const stock = `/c/${company.id}/stock`;
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
```

на

```tsx
  const inStock = useMatch('/c/:companyId/stock/*') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const stock = `/c/${company.id}/stock/balance`;
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
```

В `src/client/components/stock/DocForm.tsx` замените

```tsx
              const unit = item?.unit ?? 'pcs';
              const key = (field: string) => errors[`lines.${index}.${field}`];
              return (
                <div key={l.key} role="group" aria-label={`Строка ${index + 1}`} className={`grid items-start gap-3 rounded-xl border border-field p-3 ${hasAmounts ? 'md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]'}`}>
                  <ComboSelect
                    label="Товар"
                    listLabel="Товары"
```

на

```tsx
              const unit = item?.unit ?? 'pcs';
              const key = (field: string) => errors[`lines.${index}.${field}`];
              return (
                <div key={l.key} role="group" aria-label={`Строка ${index + 1}`} className={`grid items-start gap-3 rounded-xl border border-field p-3 ${hasAmounts ? 'md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(7rem,1fr))_auto]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]'}`}>
                  <ComboSelect
                    label="Товар"
                    listLabel="Товары"
```

В `src/client/pages/StockPage.tsx` замените

```tsx
  const [search, setSearch] = useSearchParams();
  if (!warehouses.data) {
    return (
      <section>
        <h1 className="mb-4 text-2xl font-bold">Склад</h1>
        <Pending queries={[warehouses]} />
      </section>
```

на

```tsx
  const [search, setSearch] = useSearchParams();
  if (!warehouses.data) {
    return (
      <section key={company.id}>
        <h1 className="mb-4 text-2xl font-bold">Склад</h1>
        <Pending queries={[warehouses]} />
      </section>
```

- [ ] **Step 4: Run tests, typecheck, e2e and shots**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e` (два раза подряд), затем `npm run shots:ux -- <папка вне репозитория>`.
Expected: `npm test` - 1264 пройдено и 1 пропущен, typecheck без ошибок, e2e — 180 из 180, `shots:ux` — «снято 61 из 61 сценариев».

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/ux-shots.ts src e2e
git commit -m "feat: телефон, снимки shots:ux, README «Склад» (Склад-1b, задача 5)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Финальное ревью всей ветки; файл итогов `docs/superpowers/followups/2026-10-15-warehouse-1b-followups.md` пишет контролёр.
- Приёмка с владельцем (по списку из спецификации: поступление, продажа, остаток и себестоимость, оплата из расхода, телефон) — после плана «Склад-3» (README «Склад» и приёмка по §14).
- Открытые риски плана:
  - **Форма документа и форма операции** — две формы с похожими приёмами (черновик, ошибки, вопрос о несохранённом); общего каркаса нет, расхождения возможны.
  - **Товар из формы документа** создаётся с единицей «шт»; литровые товары заводятся в «Товарах» заранее.
  - **Остатки на дату** есть в API, но не в интерфейсе (нужны инвентаризации плана «Склад-2»).
  - **Окно с ComboSelect в таблице строк** на телефоне длинное; прокрутка внутри окна — штатная.
