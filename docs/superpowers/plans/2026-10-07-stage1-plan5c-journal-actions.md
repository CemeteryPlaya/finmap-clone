# Этап 1, план 5c: журнал — действия (сохранённые фильтры, «Указать», массовые действия, «Отменить») — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина интерфейса шага 5 §11 спецификации — действия на экране журнала:
- сохранённые фильтры: «Сохранить фильтр» в окне «Фильтр», меню «Сохранённые фильтры» (применить, переименовать, удалить), предупреждение о недоступных условиях (инвариант 10);
- «Указать» в пустой ячейке контрагента, статьи или проекта: список с поиском, оптимистичное сохранение `PATCH` с `version`, откат и сообщение при ошибке и конфликте (409);
- массовые действия по выделенным строкам: «Статья», «Проект», «Контрагент», «Удалить» с подтверждением; итог «изменено N, пропущено M» с причинами; тост «Удалено N — Отменить» на 10 секунд (`bulk restore` по `changed` из ответа удаления);
- после любого изменения операций — сброс кэшей журнала, счетов (`['accounts', cid]`: балансы, `hasOperations`) и компаний (`['companies']`: `currencyLocked`, итоги).

**Предусловие:** выполнены планы 5a (API журнала, массовых действий, сохранённых фильтров) и 5b **в том виде, в каком он реализован** (коммит `4d8ad10`): экран журнала `JournalPage` → `JournalScreen key={company.id}`, `JournalTable`, `JournalToolbar`, `FilterDialog`, `Popover`, `Modal`, `journal-filter.ts` (в том числе `DialogFields`, `pickDialogFields`, `applyDialogFields`), `journal-format.ts` (в том числе `uniqueById`), `e2e/journal.spec.ts`.

**Правки — точечные, от фактического кода 5b.** Шаги ниже меняют файлы 5b только парами «замените … на …» (каждый фрагмент встречается в файле ровно один раз) или дописывают в конец; файлы 5b целиком не заменяются. Так не теряются правки 5b, которых не было в первом тексте плана: строки журнала без повторов (`uniqueById`), «Показать ещё» только не на заглушке (`!journal.isPlaceholderData &&`), клик по строке только из самой строки (`e.currentTarget.contains(e.target as Node)`), скрытая подпись перевода «Перевод: со счёта … на счёт …», `aria-disabled` у «Показать ещё», порядок Tab и Esc в `Popover`, «Готово» в «Фильтре» поверх текущего фильтра (`applyDialogFields`), ошибка журнала под тулбаром. После правок `JournalPage.tsx` и `JournalTable.tsx` шаг задачи проверяет, что эти места на месте.

**Architecture:**
- **Сохранённые фильтры** — запрос `useSavedFilters(cid)` (ключ `['saved-filters', cid]`) и чистые функции `savedFilterFromState` / `stateFromSavedFilter` (JSON фильтра API плана 5a ↔ фильтр адресной строки). Меню — на `Popover` плана 5b.
- **«Указать» и массовые действия** используют общий `SearchPicker` — кнопку с выпадающим списком с поиском (combobox + listbox: стрелки, Enter, Esc). Правила «где есть „Указать“» и тело `PATCH` — чистые функции `journal-assign.ts`. Оптимистичное изменение правит строки во всех страницах `['journal', cid, …]` через `setQueriesData` и откатывается по снимку.
- **`invalidateOperations(cid)`** (`src/client/lib/journal-mutations.ts`) — единая точка сброса после изменения операций: `['journal', cid]`, `['accounts', cid]`, `['companies']`. Её же вызовет форма операции шага 6 (вместе с `onOpenOperation` таблицы — точкой подключения из плана 5b).
- **Выделение** — множество id в экране компании (`JournalScreen` с `key={company.id}`, план 5b), только среди загруженных строк; колонка флажков в `JournalTable` (`selection`). Итог действия и тост — области `role="status"`.
- **Тулбар на экране всегда, когда справочники загружены:** пока у запроса журнала нет ни данных, ни ошибки (например, после ошибки и смены поиска — новый ключ запроса), под тулбаром — «Загрузка…», а не заглушка вместо всего экрана: поле поиска не пропадает вместе с фокусом.
- **Тост «Отменить» живёт выше экрана компании** — в `JournalPage`, и помнит компанию, где удаляли (`UndoState.companyId`): после перехода в другую компанию в течение 10 секунд «Отменить» восстанавливает операции именно там.

**Tech Stack:** как в планах 1–5b. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.4 (`saved_filters`), §4.6 (инварианты 3, 7, 10), §6 (Сохранённые фильтры, Операции `bulk`, решения 2026-10-07), §6.2 (409 `VERSION_CONFLICT`), §7 Журнал («Фильтр» — «Сохранить фильтр», сохранённые фильтры, «Указать», массовые действия), §11 шаг 5.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§7, блок «Решения планирования от 2026-10-07 (планы 5b и 5c)»).

1. **Сохранение фильтра** — в окне «Фильтр»: «Сохранить фильтр» открывает поле «Название фильтра» и кнопку «Сохранить». Сохраняются условия окна поверх ТЕКУЩЕГО фильтра — той же `applyDialogFields`, что у «Готово» (поиск, дошедший до адреса при открытом окне, не заменяется устаревшим), с периодом, поиском и суммой тулбара; период — датами (решение 6 плана 5a), сортировка не сохраняется. После сохранения окно применяет фильтр и закрывается; ошибка (пустое название) — у поля, окно остаётся открытым. После переименования фокус — на переименованном пункте, после удаления меню закрывается и фокус — на его кнопке.
2. **Применение сохранённого фильтра** заменяет все условия, сортировка остаётся текущей; даты — период «Произвольно». Если сервер убрал недоступные ссылки (`unavailable > 0`), у пункта меню видно «(N условий недоступно)», а после применения — сообщение «Фильтр «…»: N условий недоступно (удалены или в архиве) — они не применены.» до «Скрыть» или следующего применения.
3. **«Указать»** (§7) — у операции с одной строкой: контрагент и статья — у дохода и расхода, проект — ещё у перевода без строк (ему создаётся строка на всю сумму). В списке нет архивных элементов (инвариант 7), статьи — только вида операции (инвариант 3). `PATCH` шлёт `version` и одно поле. При ошибке значение откатывается и над таблицей — сообщение (`role="alert"`); при 409 — «Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.», а если операцию удалили — «Операция удалена другим пользователем. Журнал обновлён.» В любом случае журнал, счета и компании перечитываются. Кнопка «Указать» после выбора исчезает — фокус переходит на строку операции (у неё `tabIndex={-1}`, план 5b). Список «Указать» — в панели `Popover` (портал, план 5b): обёртка таблицы его не обрезает.
4. **Выделение** — флажки строк и «Выбрать все загруженные операции» в заголовке (только загруженные страницы); не больше 500 (BULK_MAX плана 5a) — иначе действия недоступны с подсказкой. Смена фильтра или компании снимает выделение. После «Статья», «Проект», «Контрагент» выделение остаётся (можно назначить следующее), после удаления снимается. Пока действие выполняется, списки «Статья», «Проект», «Контрагент» помечены `aria-disabled` (щелчок не открывает список), а не `disabled`: после выбора фокус возвращается на кнопку списка и не падает на `<body>`.
5. **«Статья» в массовых действиях** предлагает статьи обоих видов с пометкой «Доход: …» / «Расход: …»: сервер сам пропускает операции другого вида с причиной.
6. **Итог** — «Статья: изменено N, пропущено M» и список причин с числом операций («Разбитая операция — измените её в форме — 2»).
7. **Тост «Удалено N — Отменить»** висит 10 секунд и не останавливается. Область `role="status"` есть на странице всегда, чтобы появление текста объявлялось. Фокус переходит на «Отменить» (выделенные строки и кнопка подтверждения исчезли); когда тост закрывается, фокус, если был в нём, переходит на заголовок «Журнал». «Отменить» шлёт `bulk restore` с `changed` из ответа удаления в ту компанию, где удаляли, — даже если пользователь уже перешёл в другую; операции, удалённые раньше другим действием, не возвращаются (решение 5 плана 5a).

## Global Constraints

- **Код 5b не откатывать:** правки `JournalPage.tsx`, `JournalTable.tsx`, `FilterDialog.tsx`, `Popover.tsx` — только точечные, как в шагах; после них — проверка из шага задачи (`uniqueById(`, `!journal.isPlaceholderData &&`, `applyDialogFields(`, `e.currentTarget.contains(e.target as Node)`, «Перевод: со счёта»).

- **Массовые действия (§7):** «Категория» меняет единственную строку операций с одной строкой, пропускаются разбитые операции, переводы и операции другого вида, чем выбранная категория; «Проект» меняет единственную строку, переводу без строк создаёт строку, пропускаются разбитые; «Контрагент» — всем выделенным доходам и расходам; «Удалить» с подтверждением, пропускаются операции на архивном счёте, затем тост «Удалено N — Отменить» на 10 секунд (`bulk restore`); после каждого действия — итог «изменено N, пропущено M» с причинами; массовые действия не проверяют `version`.
- **«Указать» (§7):** в пустой ячейке контрагента, категории или проекта, только у операций с одной строкой (для проекта — также у перевода); выпадающий список с поиском; значение сохраняется сразу, оптимистично, с откатом при ошибке; передаёт `version` и при конфликте получает 409.
- **Сохранённые фильтры (§4.4, §6, инвариант 10, план 5a):** `GET/POST /api/v1/companies/:cid/saved-filters` → `{ savedFilters }` / 201 `{ savedFilter }`, `PATCH …/:id` (`{ name }`) → `{ savedFilter }`, `DELETE …/:id` → 204; только свои. `SavedFilter = { id, companyId, name, filter, unavailable, createdAt, updatedAt }`; `filter` — JSON `journalFilterSchema` (поля API, период датами); недоступные ссылки сервер убирает и сообщает их число в `unavailable` — пользователь видит предупреждение.
- **API массовых действий (план 5a):** `POST …/operations/bulk` с `{ action, ids, categoryId | projectId | counterpartyId }`, `ids` — 1…500 → `{ changed: number[], skipped: { id, reason }[] }`; выбранный элемент в архиве или из другой компании — 422 на весь запрос.
- **Сброс кэшей:** любое изменение операций сбрасывает `['journal', cid]`, `['accounts', cid]` (балансы и `hasOperations`) и `['companies']` (`currencyLocked`, итоги в переключателе) — функция `invalidateOperations(cid)`.
- **Доступность:** списки с поиском — `role="combobox"` + `role="listbox"`/`option` с `aria-activedescendant`, стрелки, Enter, Esc с возвратом фокуса на кнопку; у флажков строк — подписи с датой и суммой; итог и тост — `role="status"`, ошибки — `role="alert"`; подтверждение удаления ставит фокус на «Отмена».
- **E2E:** левая панель `<nav aria-label="Счета">` есть на каждой странице компании; `name:` в Playwright ищет подстроку без учёта регистра (`'Проект'` найдёт и «Указать проект» — ограничивайте область или `exact: true`); у выпадающего «Период» тоже есть `option` — опции ищите внутри `getByRole('listbox', { name })`; данные — через `page.request` с `origin` и `x-requested-with: fetch`; без фиксированных пауз.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\uXXXX`; после записи файлов с такими строками — проверка из шага задачи.
- **Концы строк:** рабочая копия в CRLF. Правки «найдите → замените» — инструментом правки файлов.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **«Указать» по операции, которую только что изменили в другом окне:** значение откатывается, видно «Операция изменена другим пользователем…», журнал перечитан, повтор с новой версией проходит. Тест — задача 2.
2. **Удалили и сразу перешли в другую компанию:** тост остаётся, «Отменить» возвращает операции в той компании, где их удалили, балансы в левой панели возвращаются; фокус не теряется (на «Отменить», затем на заголовке). Тест — задача 3.
3. **Ошибка журнала, затем новый поиск:** тулбар не пропадает, поле поиска не теряет фокус и набранный текст, журнал загружается. Тест — задача 1.
4. **Выделение и смена фильтра; массовое действие в процессе:** строки, ушедшие из списка, не остаются выделенными; после выбора в «Статья» фокус остаётся на кнопке списка. Тест — задача 3.
5. **«Указать» в последней строке короткой таблицы:** список не обрезан обёрткой таблицы с прокруткой — последний вариант виден и нажимается (проверка `elementFromPoint`). Тест — задача 2.

---

## Карта файлов

```
src/client/
  lib/journal-filter.ts               # + SavedJournalFilter, savedFilterFromState, stateFromSavedFilter
  lib/queries.ts                      # + SavedFilter, useSavedFilters
  lib/journal-assign.ts               # (новый) где есть «Указать», тело PATCH, оптимистичная правка
  lib/journal-mutations.ts            # (новый) invalidateOperations, useAssign, runBulk
  lib/journal-bulk.ts                 # (новый) типы и итог массового действия
  components/SearchPicker.tsx         # (новый) кнопка со списком с поиском
  components/Popover.tsx              # + inactive (aria-disabled)
  components/journal/SavedFiltersMenu.tsx  # (новый)
  components/journal/AssignPicker.tsx      # (новый)
  components/journal/BulkBar.tsx           # (новый)
  components/journal/UndoToast.tsx         # (новый)
  components/journal/FilterDialog.tsx      # + «Сохранить фильтр»
  components/journal/JournalTable.tsx      # + «Указать», колонка выделения
  pages/JournalPage.tsx
tests/client/{journal-saved-filter,journal-assign,journal-bulk}.test.ts   # (новые)
e2e/journal-actions.spec.ts           # (новый)
README.md
```

---
### Task 1: Сохранённые фильтры — сохранить, применить, переименовать, удалить; предупреждение о недоступных условиях; тулбар при загрузке журнала

**Files:**
- Create: `e2e/journal-actions.spec.ts`, `src/client/components/journal/SavedFiltersMenu.tsx`, `tests/client/journal-saved-filter.test.ts`
- Modify: `src/client/lib/journal-filter.ts`, `src/client/lib/queries.ts`, `src/client/components/journal/FilterDialog.tsx`, `src/client/pages/JournalPage.tsx`

**Interfaces:**
- Consumes: `JournalUrlState`, `DialogFields`, `applyDialogFields`, `EMPTY_JOURNAL_STATE`, `OPERATION_TYPES`, `periodRange`, `sortedUnique` (план 5b, `journal-filter.ts`); `pluralRu` (план 5b, `journal-format.ts`); `Popover`, `FilterDialog`, `JournalPage` (план 5b); `api`, `ApiError`; `queryClient`; `Field`; API сохранённых фильтров плана 5a.
- Produces:
  - `journal-filter.ts`: `interface SavedJournalFilter` (поля API: `from?`, `to?`, `q?`, `amountMin?`, `amountMax?`, `types?`, `accountIds?`, `categoryIds?`, `projectIds?`, `counterpartyIds?`, `tagIds?`, `withoutCategory?: true`, `withoutProject?: true`, `withoutCounterparty?: true`), `savedFilterFromState(state, today): SavedJournalFilter`, `stateFromSavedFilter(filter, current: Pick<JournalUrlState, 'sort' | 'order'>): JournalUrlState`;
  - `queries.ts`: `interface SavedFilter`, `useSavedFilters(companyId)` — ключ `['saved-filters', companyId]`;
  - `SavedFiltersMenu({ companyId, filters, onApply })`, `unavailableText(n): string` («1 условие недоступно», «2 условия недоступны», «5 условий недоступно»); пункты меню — кнопки «Применить фильтр «…»», «Переименовать фильтр «…»», «Удалить фильтр «…»»; после переименования и отмены фокус — на кнопке «Применить…» пункта, после удаления меню закрывается с фокусом на его кнопке;
  - `FilterDialog` получает обязательное свойство `onSave: (draft: DialogFields, name: string) => Promise<void>` и кнопку «Сохранить фильтр»; `JournalPage` сохраняет `savedFilterFromState(applyDialogFields(state, draft), today)`;
  - `JournalPage`: после загрузки справочников тулбар есть всегда; пока у журнала нет ни данных, ни ошибки — «Загрузка…» под тулбаром.

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-saved-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, savedFilterFromState, stateFromSavedFilter, type JournalUrlState } from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('сохранённый фильтр ↔ фильтр журнала', () => {
  it('сохраняется только заданное; относительный период — датами (решение 6 плана 5a); сортировка не сохраняется', () => {
    expect(savedFilterFromState(EMPTY_JOURNAL_STATE, '2026-10-07')).toEqual({});
    expect(
      savedFilterFromState(
        state({ period: 'month', q: 'бар', amountMin: 0, types: ['income'], tagIds: [3, 4], withoutProject: true, sort: 'amount', order: 'asc' }),
        '2026-10-07',
      ),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31', q: 'бар', amountMin: 0, types: ['income'], tagIds: [3, 4], withoutProject: true });
    expect(savedFilterFromState(state({ period: 'custom', from: '2026-01-05' }), '2026-10-07')).toEqual({ from: '2026-01-05' });
  });

  it('применение: даты — «Произвольно», без дат — «Всё время», остальное заменяется, сортировка текущая', () => {
    expect(stateFromSavedFilter({ from: '2026-10-01', to: '2026-10-31', accountIds: [5, 2], withoutCategory: true }, { sort: 'amount', order: 'asc' })).toEqual(
      state({ period: 'custom', from: '2026-10-01', to: '2026-10-31', accountIds: [2, 5], withoutCategory: true, sort: 'amount', order: 'asc' }),
    );
    expect(stateFromSavedFilter({ q: 'аренда', types: ['transfer', 'income'] }, { sort: 'date', order: 'desc' })).toEqual(
      state({ q: 'аренда', types: ['income', 'transfer'] }),
    );
  });

  it('туда и обратно без потерь (кроме относительного периода)', () => {
    const s = state({ period: 'custom', from: '2026-02-01', amountMax: 99, counterpartyIds: [7], withoutCounterparty: true, projectIds: [1] });
    expect(stateFromSavedFilter(savedFilterFromState(s, '2026-10-07'), s)).toEqual(s);
  });
});
```

`e2e/journal-actions.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/**
 * Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем
 * (инвариант 6) — проверки «сегодня» и периода не падают сразу после полуночи.
 */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};

/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const bodyRows = (page: Page) => table(page).locator('tbody tr');
/** Буквы операций в порядке строк журнала: у каждой операции комментарий «операция X». */
const letters = async (page: Page) => (await bodyRows(page).allInnerTexts()).map((t) => /операция ([A-Z])/.exec(t)?.[1] ?? '?').join('');

test('сохранённые фильтры: сохранить из окна «Фильтр», применить, переименовать, удалить; предупреждение о недоступных условиях', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сохранённые ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const shift = (await apiPost(page, `${base}/tags`, { name: 'Смена' })).tag.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 100, tagIds: [shift], comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');

  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  const menuButton = page.getByRole('button', { name: 'Сохранённые фильтры' });

  // период «Сегодня» в тулбаре + доходы в окне → «Сохранить фильтр»
  await page.getByLabel('Период').selectOption({ label: 'Сегодня' });
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('   ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByLabel('Название фильтра')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Название фильтра').fill('Доходы за день');
  await dialog.getByLabel('Название фильтра').press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(() => letters(page)).toBe('CA');

  // применить после сброса: период сохранён датами — «Произвольно»
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect.poll(() => letters(page)).toBe('CBA');
  await menuButton.click();
  await page.getByRole('button', { name: 'Применить фильтр «Доходы за день»' }).click();
  await expect(menuButton).toBeFocused();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&type=income$/);
  await expect(page.getByLabel('Период')).toHaveValue('custom');
  await expect.poll(() => letters(page)).toBe('CA');

  // переименовать
  await menuButton.click();
  await page.getByRole('button', { name: 'Переименовать фильтр «Доходы за день»' }).click();
  await page.getByLabel('Новое название фильтра «Доходы за день»').fill('Доходы');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  // поле названия исчезло — фокус на переименованном фильтре
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeFocused();
  await page.keyboard.press('Escape');

  // фильтр по тегу; тег уходит в архив — при применении предупреждение, условие отброшено (инвариант 10)
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('Смены');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => letters(page)).toBe('A');
  await apiPost(page, `${base}/tags/${shift}/archive`, {});
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await page.reload();
  await menuButton.click();
  const shifts = page.getByRole('button', { name: /^Применить фильтр «Смены»/ });
  await expect(shifts).toHaveAccessibleName('Применить фильтр «Смены», 1 условие недоступно');
  await expect(shifts).toContainText('(1 условие недоступно)');
  await shifts.click();
  await expect(page.getByRole('status').filter({ hasText: 'Фильтр «Смены»' })).toHaveText(/1 условие недоступно \(удалены или в архиве\) — они не применены/);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(() => letters(page)).toBe('CBA');

  // удалить — с подтверждением
  await menuButton.click();
  await page.getByRole('button', { name: 'Удалить фильтр «Смены»' }).click();
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  // пункт исчез — меню закрыто, фокус на его кнопке
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await expect(shifts).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeVisible();
});

test('ошибка журнала, затем новый поиск: тулбар остаётся на месте, поле поиска не теряет фокус', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 200, comment: 'операция B' });

  // журнал отвечает ошибкой (400 — без повторов запроса): ошибка под тулбаром
  const journalUrl = /\/api\/v1\/companies\/\d+\/operations\?/;
  await page.route(journalUrl, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION', message: 'Сбой журнала для теста' } }) }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Сбой журнала для теста');
  await page.unroute(journalUrl);

  // поиск уходит в адрес — у нового запроса ещё нет ни данных, ни ошибки; тулбар не пропадает, ввод продолжается
  const search = page.getByLabel('Поиск');
  await search.fill('опер');
  await expect(page).toHaveURL(/q=/);
  await expect(search).toBeFocused();
  await search.pressSequentially('ация A');
  await expect(search).toHaveValue('операция A');
  await expect.poll(() => letters(page)).toBe('A');
  await expect(search).toBeFocused();
});
```

Проверьте экранирования:

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" tests/client/journal-saved-filter.test.ts e2e/journal-actions.spec.ts`
Expected: ничего не выводит.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-saved-filter.test.ts`
Expected: FAIL — нет `savedFilterFromState`.

Run: `npx playwright test e2e/journal-actions.spec.ts`
Expected: FAIL — нет кнопки «Сохранить фильтр»; после ошибки журнала и нового поиска тулбар пропадает (поле поиска теряет фокус).

- [ ] **Step 3: Implement**

`src/client/lib/journal-filter.ts` — допишите в конец файла:

```ts
/**
 * JSON сохранённого фильтра (journalFilterSchema плана 5a): поля API, период — датами, пустые списки
 * и выключенные флаги не пишутся. Сортировка не сохраняется.
 */
export interface SavedJournalFilter {
  from?: string;
  to?: string;
  q?: string;
  amountMin?: number;
  amountMax?: number;
  types?: OperationType[];
  accountIds?: number[];
  categoryIds?: number[];
  projectIds?: number[];
  counterpartyIds?: number[];
  tagIds?: number[];
  withoutCategory?: true;
  withoutProject?: true;
  withoutCounterparty?: true;
}

/** Текущий фильтр → JSON для сохранения. Относительный период («текущий месяц») сохраняется датами (решение 6 плана 5a). */
export function savedFilterFromState(state: JournalUrlState, today: string): SavedJournalFilter {
  const f: SavedJournalFilter = { ...periodRange(state, today) };
  if (state.q) f.q = state.q;
  if (state.amountMin !== undefined) f.amountMin = state.amountMin;
  if (state.amountMax !== undefined) f.amountMax = state.amountMax;
  if (state.types.length) f.types = [...state.types];
  for (const field of LIST_FIELDS) if (state[field].length) f[field] = [...state[field]];
  for (const field of FLAG_FIELDS) if (state[field]) f[field] = true;
  return f;
}

/** Сохранённый фильтр → фильтр журнала: даты — период «Произвольно», сортировка остаётся текущей. */
export function stateFromSavedFilter(filter: SavedJournalFilter, current: Pick<JournalUrlState, 'sort' | 'order'>): JournalUrlState {
  const state: JournalUrlState = { ...EMPTY_JOURNAL_STATE, sort: current.sort, order: current.order };
  if (filter.from || filter.to) {
    state.period = 'custom';
    if (filter.from) state.from = filter.from;
    if (filter.to) state.to = filter.to;
  }
  if (filter.q) state.q = filter.q;
  if (filter.amountMin !== undefined) state.amountMin = filter.amountMin;
  if (filter.amountMax !== undefined) state.amountMax = filter.amountMax;
  state.types = OPERATION_TYPES.filter((t) => filter.types?.includes(t));
  for (const field of LIST_FIELDS) state[field] = sortedUnique(filter[field] ?? []);
  for (const field of FLAG_FIELDS) state[field] = filter[field] === true;
  return state;
}
```

`src/client/lib/queries.ts` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import type { CounterpartyType } from '../../shared/system-categories';
```

на

```ts
import type { CounterpartyType } from '../../shared/system-categories';
import type { SavedJournalFilter } from './journal-filter';
```

`src/client/lib/queries.ts` — допишите в конец файла:

```ts
export interface SavedFilter {
  id: number;
  companyId: number;
  name: string;
  /** Фильтр без недоступных ссылок (сервер их убирает). */
  filter: SavedJournalFilter;
  /** Сколько ссылок убрано: элемент удалён, в архиве или из другой компании (инвариант 10). */
  unavailable: number;
  createdAt: string;
  updatedAt: string;
}

/** Личные сохранённые фильтры журнала в компании. */
export function useSavedFilters(companyId: number) {
  return useQuery<SavedFilter[], ApiError>({
    queryKey: ['saved-filters', companyId],
    queryFn: async () => (await api<{ savedFilters: SavedFilter[] }>(`/companies/${companyId}/saved-filters`)).savedFilters,
  });
}
```

`src/client/components/journal/SavedFiltersMenu.tsx`:

```ts
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { pluralRu } from '../../lib/journal-format';
import { queryClient } from '../../lib/query';
import type { SavedFilter } from '../../lib/queries';
import { Popover } from '../Popover';
import { btnDanger, btnSecondary, btnSmall, inputClass } from '../ui';

/** «N условий недоступно»: ссылки фильтра на удалённые, архивные или чужие элементы (инвариант 10). */
export function unavailableText(n: number): string {
  return `${n} ${pluralRu(n, 'условие недоступно', 'условия недоступны', 'условий недоступно')}`;
}

const errorText = (e: unknown) => (e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');

function SavedFilterItem(props: { filter: SavedFilter; companyId: number; onApply: () => void; onRemoved: () => void }) {
  const { filter } = props;
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(filter.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const url = `/companies/${props.companyId}/saved-filters/${filter.id}`;
  // поле названия и подтверждение исчезают — фокус возвращается на кнопку фильтра, а не теряется
  const applyRef = useRef<HTMLButtonElement>(null);
  const [focusApply, setFocusApply] = useState(false);
  useEffect(() => {
    if (mode !== 'view' || !focusApply) return;
    applyRef.current?.focus();
    setFocusApply(false);
  }, [mode, focusApply]);
  const back = () => {
    setMode('view');
    setFocusApply(true);
  };

  const run = async (request: () => Promise<unknown>, done: () => void) => {
    setPending(true);
    setError(null);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: ['saved-filters', props.companyId] });
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  if (mode === 'rename') {
    return (
      <li className="py-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(url, { method: 'PATCH', body: { name } }), back);
          }}
          className="flex flex-col gap-2"
        >
          <input
            aria-label={`Новое название фильтра «${filter.name}»`}
            aria-invalid={error ? true : undefined}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className={`${inputClass} py-1.5 text-sm`}
          />
          {error && <p className="text-xs text-expense">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnSmall}>
              Сохранить
            </button>
            <button type="button" onClick={back} className={btnSmall}>
              Отмена
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === 'delete') {
    return (
      <li role="group" aria-label={`Удаление фильтра «${filter.name}»`} className="flex flex-col gap-2 py-1 text-sm">
        <span>Удалить фильтр «{filter.name}»?</span>
        {error && <p className="text-xs text-expense">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => void run(() => api(url, { method: 'DELETE' }), props.onRemoved)} className={`${btnDanger} px-3 py-1.5 text-sm`}>
            Да, удалить
          </button>
          <button type="button" autoFocus onClick={back} className={`${btnSecondary} px-3 py-1.5 text-sm`}>
            Отмена
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-0.5">
      <button
        ref={applyRef}
        type="button"
        aria-label={`Применить фильтр «${filter.name}»${filter.unavailable > 0 ? `, ${unavailableText(filter.unavailable)}` : ''}`}
        onClick={props.onApply}
        className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-field"
      >
        {filter.name}
        {filter.unavailable > 0 && <span className="ml-1 text-xs text-expense">({unavailableText(filter.unavailable)})</span>}
      </button>
      <button
        type="button"
        aria-label={`Переименовать фильтр «${filter.name}»`}
        title="Переименовать"
        onClick={() => setMode('rename')}
        className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-field"
      >
        <span aria-hidden="true">✎</span>
      </button>
      <button
        type="button"
        aria-label={`Удалить фильтр «${filter.name}»`}
        title="Удалить"
        onClick={() => setMode('delete')}
        className="rounded-lg px-2 py-1 text-sm text-expense hover:bg-field"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
}

/** Меню «Сохранённые фильтры»: применить, переименовать, удалить. Сохраняют фильтр в модалке «Фильтр». */
export function SavedFiltersMenu(props: { companyId: number; filters: SavedFilter[] | undefined; onApply: (f: SavedFilter) => void }) {
  return (
    <Popover label="Сохранённые фильтры" panelClassName="w-80">
      {(close) => (
        <div>
          <p className="mb-2 text-sm font-semibold">Сохранённые фильтры</p>
          {props.filters === undefined ? (
            <p className="text-sm text-muted">Загрузка…</p>
          ) : props.filters.length === 0 ? (
            <p className="text-sm text-muted">Пока нет. Задайте условия и нажмите «Сохранить фильтр» в окне «Фильтр».</p>
          ) : (
            <ul>
              {props.filters.map((f) => (
                <SavedFilterItem
                  key={f.id}
                  filter={f}
                  companyId={props.companyId}
                  onApply={() => {
                    props.onApply(f);
                    close(true);
                  }}
                  // удалённый пункт исчезает — фокус на кнопку меню
                  onRemoved={() => close(true)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
```

`src/client/components/journal/FilterDialog.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { useState, type ReactNode } from 'react';
```

на

```ts
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
```

2. Замените

```ts
import { Modal } from '../Modal';
```

на

```ts
import { Field } from '../Field';
import { Modal } from '../Modal';
```

3. Замените

```ts
function FilterForm(props: { state: JournalUrlState; data: FilterDialogData; onApply: (next: DialogFields) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<DialogFields>(() => pickDialogFields(props.state));
  const [cpQuery, setCpQuery] = useState('');
```

на

```ts
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: DialogFields) => void;
  onCancel: () => void;
  onSave: (draft: DialogFields, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DialogFields>(() => pickDialogFields(props.state));
  const [cpQuery, setCpQuery] = useState('');
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
```

4. Замените

```ts
  const counterparties = options(data.counterparties, draft.counterpartyIds).filter(
```

на

```ts
  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await props.onSave(draft, name);
      props.onApply(draft);
    } catch (e) {
      setSaveError(e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');
    } finally {
      setSaving(false);
    }
  };

  const counterparties = options(data.counterparties, draft.counterpartyIds).filter(
```

5. Замените

```ts
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
```

на

```ts
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" aria-expanded={naming} onClick={() => setNaming((v) => !v)} className={btnSecondary}>
          Сохранить фильтр
        </button>
```

6. Замените

```ts
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
```

на

```ts
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
      {naming && (
        <div className="mt-4 flex flex-wrap items-start gap-2 rounded-2xl bg-field/50 p-3">
          <Field label="Название фильтра" error={saveError} hint="Сохраняются условия окна, период, поиск и сумма; период — датами" className="min-w-56 flex-1">
            {(c) => (
              <input
                {...c}
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter сохраняет фильтр, а не применяет окно
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
                className={`${inputClass} py-2`}
              />
            )}
          </Field>
          <button type="button" disabled={saving} onClick={() => void save()} className={`${btnPrimary} mt-6`}>
            Сохранить
          </button>
        </div>
      )}
    </form>
```

7. Замените

```ts
  /** Только поля модалки: их накладывают на текущий фильтр, а не на снимок при открытии. */
  onApply: (next: DialogFields) => void;
  onClose: () => void;
}) {
```

на

```ts
  /** Только поля модалки: их накладывают на текущий фильтр, а не на снимок при открытии. */
  onApply: (next: DialogFields) => void;
  onClose: () => void;
  /**
   * Сохраняет поля окна как именованный фильтр — тоже поверх текущего фильтра (applyDialogFields);
   * при успехе окно применяет черновик и закрывается.
   */
  onSave: (draft: DialogFields, name: string) => Promise<void>;
}) {
```

8. Замените

```ts
        onCancel={props.onClose}
      />
```

на

```ts
        onCancel={props.onClose}
        onSave={props.onSave}
      />
```

`src/client/pages/JournalPage.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { FilterDialog } from '../components/journal/FilterDialog';
```

на

```ts
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
```

2. Замените

```ts
import { applyDialogFields, filterConditionCount, isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
```

на

```ts
import { api } from '../lib/api';
import {
  applyDialogFields,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  savedFilterFromState,
  stateFromSavedFilter,
  type DialogFields,
  type JournalUrlState,
} from '../lib/journal-filter';
```

3. Замените

```ts
import { useMeta } from '../lib/query';
```

на

```ts
import { queryClient, useMeta } from '../lib/query';
```

4. Замените

```ts
useProjects, useTags, type CategoryTree, type Company } from '../lib/queries';
```

на

```ts
useProjects, useSavedFilters, useTags, type CategoryTree, type Company } from '../lib/queries';
```

5. Замените

```ts
  const [filterOpen, setFilterOpen] = useState(false);
```

на

```ts
  const [filterOpen, setFilterOpen] = useState(false);
  const savedFilters = useSavedFilters(company.id);
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);
```

6. Замените

```ts
  if (!lookups || !tags.data || !timeZone || !today) return <Pending queries={lookupQueries} />;
  if (!journal.data && !journal.error) return <Pending queries={[...lookupQueries, journal]} />;
```

на

```ts
  // без справочников журнал не показать; дальше тулбар на экране всегда — и пока грузится новый запрос журнала
  // (например, после ошибки и смены поиска): иначе поле поиска пропало бы вместе с фокусом
  if (!lookups || !tags.data || !timeZone || !today) return <Pending queries={lookupQueries} />;
```

7. Замените

```ts
  const conditions = filterConditionCount(state);
```

на

```ts
  const conditions = filterConditionCount(state);
  // сохраняются поля окна поверх ТЕКУЩЕГО фильтра — как у «Готово», без устаревшего поиска из снимка
  const saveFilter = async (draft: DialogFields, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(applyDialogFields(state, draft), today) } });
    await queryClient.invalidateQueries({ queryKey: ['saved-filters', company.id] });
  };
```

8. Замените

```ts
            <ColumnsPicker visible={columns} />
```

на

```ts
            <SavedFiltersMenu
              companyId={company.id}
              filters={savedFilters.data}
              onApply={(f) => {
                update(stateFromSavedFilter(f.filter, state));
                setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
              }}
            />
            <ColumnsPicker visible={columns} />
```

9. Замените

```ts
        onClose={() => setFilterOpen(false)}
      />
      {!journal.data ? (
```

на

```ts
        onClose={() => setFilterOpen(false)}
        onSave={saveFilter}
      />
      {notice && (
        <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {!journal.data && !journal.error ? (
        <p className="py-8 text-center text-muted">Загрузка…</p>
      ) : !journal.data ? (
```

У кнопки пункта меню доступное имя «Применить фильтр «…»» (с числом недоступных условий): видимое название входит в него (WCAG 2.5.3), а кнопки «Переименовать…» и «Удалить…» не совпадают с ним по подстроке. Тест «ошибка журнала» отвечает на первый запрос журнала 400 (`page.route`, без повторов запроса) и проверяет, что после нового поиска поле поиска остаётся в фокусе: с прежним `if (!journal.data && !journal.error) return <Pending …>` он падает.

Проверьте, что правки не затёрли код плана 5b:

Run: `node -e "const fs = require('fs'); const need = { 'src/client/pages/JournalPage.tsx': ['uniqueById(', '!journal.isPlaceholderData &&', 'applyDialogFields('], 'src/client/components/journal/JournalTable.tsx': ['e.currentTarget.contains(e.target as Node)', 'Перевод: со счёта'] }; for (const [f, xs] of Object.entries(need)) { const s = fs.readFileSync(f, 'utf8'); for (const x of xs) if (!s.includes(x)) { console.error(f + ': пропало «' + x + '» — правка затёрла код плана 5b'); process.exit(1); } }"`
Expected: ничего не выводит, код выхода 0.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-saved-filter.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-filter.ts src/client/lib/queries.ts src/client/components/journal/SavedFiltersMenu.tsx src/client/components/journal/FilterDialog.tsx src/client/pages/JournalPage.tsx tests/client/journal-saved-filter.test.ts e2e/journal-actions.spec.ts
git commit -m "feat: сохранённые фильтры журнала — сохранить, применить, переименовать, удалить; тулбар остаётся при загрузке журнала

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: «Указать» — список с поиском, оптимистичное сохранение с версией, откат и 409

**Files:**
- Create: `src/client/components/SearchPicker.tsx`, `src/client/components/journal/AssignPicker.tsx`, `src/client/lib/journal-assign.ts`, `src/client/lib/journal-mutations.ts`, `tests/client/journal-assign.test.ts`
- Modify: `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `JournalItem`, `JournalPageData`, `CategoryNode`, `CategoryTree`, `Counterparty`, `Project` (`queries.ts`); `Popover` (план 5b); `matchesQuery` (`src/shared/search.ts`); `api`, `ApiError`; `queryClient`; `JournalTable` (план 5b: у строки `tabIndex={-1}` и `data-operation-id`); `PATCH /operations/:id` (план 4a; 409 `VERSION_CONFLICT`).
- Produces:
  - `journal-assign.ts`: `type AssignField = 'counterparty' | 'category' | 'project'`, `ASSIGN_LABELS` («Указать контрагента», «Указать статью», «Указать проект»), `AssignTarget`, `canAssign(item, field): boolean`, `interface AssignPatch`, `assignPatch(item, field, id): AssignPatch`, `withAssigned(item, field, id)`;
  - `journal-mutations.ts`: `invalidateOperations(companyId): Promise<void>`, `operationErrorText(e: unknown): string` (409 «изменена» — «… Журнал обновлён — проверьте и повторите.», 409 «удалена» — «Операция удалена другим пользователем. Журнал обновлён.», прочее — текст сервера), `useAssign(companyId, onError: (message: string) => void)` — мутация `{ item, field, id }`;
  - `SearchPicker(props: { label; ariaLabel?; listLabel; options: PickerOption[]; onPick: (id: number) => void; buttonClassName?; align? })`, `interface PickerOption { id: number; label: string }` — поле поиска `combobox` с именем «{listLabel}: поиск», список `listbox` с именем listLabel;
  - `AssignPicker({ item, field, data, onPick })`, `interface AssignData { categories; projects; counterparties }`, `categoryPickerOptions(nodes): PickerOption[]`;
  - `JournalTable`: свойство `renderAssign?: (item, field) => ReactNode` — вызывается только там, где `canAssign`;
  - `JournalPage`: после выбора в «Указать» фокус — на строку операции (`focusRow(id)`: `tr[data-operation-id]`).

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-assign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { assignPatch, canAssign, withAssigned, type AssignTarget } from '../../src/client/lib/journal-assign';
import { operationErrorText } from '../../src/client/lib/journal-mutations';

const FIELDS = ['counterparty', 'category', 'project'] as const;
const line = (categoryId: number | null, projectId: number | null, amount = 1000) => ({ id: 1, position: 0, categoryId, projectId, amount, baseAmount: amount });
const op = (patch: Partial<AssignTarget>): AssignTarget => ({
  type: 'expense',
  version: 3,
  amount: 1000,
  baseAmount: 1000,
  counterpartyId: null,
  lines: [line(null, null)],
  ...patch,
});

describe('«Указать» (§7)', () => {
  it('только пустая ячейка операции с одной строкой; проект — ещё у перевода без строк', () => {
    const bare = op({});
    expect(FIELDS.map((f) => canAssign(bare, f))).toEqual([true, true, true]);
    const filled = op({ counterpartyId: 5, lines: [line(7, 8)] });
    expect(FIELDS.map((f) => canAssign(filled, f))).toEqual([false, false, false]);
    // разбитая операция — только через форму
    const split = op({ lines: [line(null, null, 400), line(null, null, 600)] });
    expect(FIELDS.map((f) => canAssign(split, f))).toEqual([false, false, false]);
    // перевод: нет контрагента и статьи; проект — если строки нет или в ней нет проекта
    const transfer = op({ type: 'transfer', lines: [] });
    expect(FIELDS.map((f) => canAssign(transfer, f))).toEqual([false, false, true]);
    expect(canAssign(op({ type: 'transfer', lines: [line(null, 9)] }), 'project')).toBe(false);
  });

  it('тело PATCH: версия и одно поле; строка сохраняет остальные значения и сумму; перевод получает строку на всю сумму', () => {
    expect(assignPatch(op({}), 'counterparty', 5)).toEqual({ version: 3, counterpartyId: 5 });
    expect(assignPatch(op({ lines: [line(null, 8)] }), 'category', 7)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 8, amount: 1000 }] });
    expect(assignPatch(op({ lines: [line(7, null)] }), 'project', 9)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 9, amount: 1000 }] });
    expect(assignPatch(op({ type: 'transfer', amount: 47512, lines: [] }), 'project', 9)).toEqual({
      version: 3,
      lines: [{ categoryId: null, projectId: 9, amount: 47512 }],
    });
  });

  it('оптимистичный показ: значение подставлено, остальное как было', () => {
    expect(withAssigned(op({}), 'counterparty', 5).counterpartyId).toBe(5);
    expect(withAssigned(op({ lines: [line(null, 8)] }), 'category', 7).lines).toEqual([line(7, 8)]);
    expect(withAssigned(op({ type: 'transfer', amount: 500, baseAmount: 500, lines: [] }), 'project', 9).lines).toEqual([
      { id: 0, position: 0, categoryId: null, projectId: 9, amount: 500, baseAmount: 500 },
    ]);
  });

  it('текст ошибки: конфликт версии — журнал обновлён; удалённая операция — без «повторите»; прочее — как есть', () => {
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем'))).toBe(
      'Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.',
    );
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу'))).toBe(
      'Операция удалена другим пользователем. Журнал обновлён.',
    );
    expect(operationErrorText(new ApiError(422, 'ARCHIVED_REFERENCE', 'Статья «Старая» в архиве — выберите другую'))).toBe('Статья «Старая» в архиве — выберите другую');
    expect(operationErrorText(new Error('x'))).toBe('Ошибка сервера');
  });
});
```

`e2e/journal-actions.spec.ts` — допишите в конец файла:

```ts
test('«Указать»: список с поиском и клавиатурой, значение сохраняется сразу; конфликт версии — откат и сообщение', async ({ page }) => {
  // высокое окно: под последней строкой таблицы хватает места, и список открывается вниз — за край обёртки таблицы
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  const cid = await createCompany(page, `ТОО Указать ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' });
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Игровое время' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Барная стойка' }); // расходная — доходу не предлагается
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  await apiPost(page, `${base}/counterparties`, { name: 'ИП Клиент', type: 'client' });
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 100, comment: 'операция A' })).operation;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: kaspi,
    amount: 300,
    comment: 'операция B',
    lines: [
      { projectId: club, amount: 100 },
      { amount: 200 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: kaspi, toAccountId: cash, amount: 50, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });

  // где есть «Указать»: доход — все три поля; разбитая операция — нигде; перевод — только проект
  await expect(row('A').getByRole('button', { name: /^Указать/ })).toHaveCount(3);
  await expect(row('B').getByRole('button', { name: /^Указать/ })).toHaveCount(0);
  await expect(row('C').getByRole('button', { name: /^Указать/ })).toHaveCount(1);
  await expect(row('C').getByRole('button', { name: 'Указать проект' })).toBeVisible();

  // статья с клавиатуры: поиск, стрелка, Enter; доход видит только доходные статьи
  await row('A').getByRole('button', { name: 'Указать статью' }).click();
  const search = page.getByRole('combobox', { name: 'Статьи: поиск' });
  await expect(search).toBeFocused();
  const categoryOptions = page.getByRole('listbox', { name: 'Статьи' }).getByRole('option');
  await expect(categoryOptions).toHaveText(['Инвестиции', 'Возврат займа', 'Получение кредита', 'Бар', 'Игровое время']);
  // список у последней строки не обрезан обёрткой таблицы (overflow-x: auto): он ниже её нижнего края и виден целиком
  const listBox = (await page.getByRole('listbox', { name: 'Статьи' }).boundingBox())!;
  const wrapperBox = (await table(page).locator('xpath=..').boundingBox())!;
  expect(listBox.y + listBox.height).toBeGreaterThan(wrapperBox.y + wrapperBox.height);
  await expect(categoryOptions.last()).toBeInViewport();
  const lastOptionHit = await categoryOptions
    .last()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
    });
  expect(lastOptionHit).toBe(true);
  await search.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(row('A')).toContainText('Бар');
  await expect(row('A').getByRole('button', { name: 'Указать статью' })).toHaveCount(0);
  // кнопки больше нет — фокус на строке операции, а не на body
  await expect(row('A')).toBeFocused();

  // Esc закрывает список, фокус — на кнопке
  await row('A').getByRole('button', { name: 'Указать проект' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Проекты' })).toHaveCount(0);
  await expect(row('A').getByRole('button', { name: 'Указать проект' })).toBeFocused();

  // проект переводу без строк — мышью
  await row('C').getByRole('button', { name: 'Указать проект' }).click();
  // журнал перечитывается после сохранения — дождёмся его, чтобы правка «в другом окне» ниже пришла позже
  const reloaded = page.waitForResponse((r) => r.url().includes(`/companies/${cid}/operations?`) && r.request().method() === 'GET');
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
  await expect(row('C')).toContainText('Клуб 1');
  await reloaded;

  // конфликт: операцию изменили в другом окне — значение откатывается, сообщение о конфликте, журнал обновлён
  const patched = await page.request.patch(`${base}/operations/${income.id}`, { data: { version: 2, comment: 'операция A изменена' }, headers: csrf(page) });
  expect(patched.status(), await patched.text()).toBe(200);
  await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
  await expect(page.getByRole('alert')).toContainText('Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.');
  await expect(row('A')).toContainText('операция A изменена');
  await expect(row('A').getByRole('button', { name: 'Указать контрагента' })).toBeVisible();
  // повтор с новой версией проходит; после перезагрузки значения на месте
  await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
  await expect(row('A')).toContainText('ИП Клиент');
  await page.reload();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Бар');
  await expect(row('C')).toContainText('Клуб 1');
});
```

Проверьте экранирования:

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" tests/client/journal-assign.test.ts e2e/journal-actions.spec.ts`
Expected: ничего не выводит.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-assign.test.ts`
Expected: FAIL — нет модуля `journal-assign`.

Run: `npx playwright test e2e/journal-actions.spec.ts -g "Указать"`
Expected: FAIL — нет кнопок «Указать».

- [ ] **Step 3: Implement**

`src/client/lib/journal-assign.ts`:

```ts
import type { JournalItem } from './queries';

/** Поле, которое можно «Указать» в пустой ячейке журнала (§7). */
export type AssignField = 'counterparty' | 'category' | 'project';

export const ASSIGN_LABELS: Record<AssignField, string> = {
  counterparty: 'Указать контрагента',
  category: 'Указать статью',
  project: 'Указать проект',
};

export type AssignTarget = Pick<JournalItem, 'type' | 'version' | 'amount' | 'baseAmount' | 'counterpartyId' | 'lines'>;

/**
 * «Указать» есть только в пустой ячейке операции с одной строкой; проект — ещё у перевода без строк (§7).
 * У перевода нет контрагента и статьи.
 */
export function canAssign(item: AssignTarget, field: AssignField): boolean {
  const single = item.lines.length === 1 ? item.lines[0]! : null;
  switch (field) {
    case 'counterparty':
      return item.type !== 'transfer' && item.counterpartyId === null && single !== null;
    case 'category':
      return item.type !== 'transfer' && single !== null && single.categoryId === null;
    case 'project':
      return (single !== null && single.projectId === null) || (item.type === 'transfer' && item.lines.length === 0);
  }
}

export interface AssignPatch {
  version: number;
  counterpartyId?: number;
  lines?: { categoryId: number | null; projectId: number | null; amount: number }[];
}

/**
 * Тело PATCH /operations/:id для «Указать»: версия, которую видел пользователь (при конфликте — 409),
 * и одно поле — контрагент или строки из одной строки (план 5a, решение 9).
 */
export function assignPatch(item: AssignTarget, field: AssignField, id: number): AssignPatch {
  if (field === 'counterparty') return { version: item.version, counterpartyId: id };
  const line = item.lines[0];
  return {
    version: item.version,
    lines: [
      {
        categoryId: field === 'category' ? id : (line?.categoryId ?? null),
        projectId: field === 'project' ? id : (line?.projectId ?? null),
        amount: line?.amount ?? item.amount,
      },
    ],
  };
}

/** Операция с указанным значением — для оптимистичного показа до ответа сервера. */
export function withAssigned<T extends AssignTarget>(item: T, field: AssignField, id: number): T {
  if (field === 'counterparty') return { ...item, counterpartyId: id };
  const line = item.lines[0] ?? { id: 0, position: 0, categoryId: null, projectId: null, amount: item.amount, baseAmount: item.baseAmount };
  return { ...item, lines: [{ ...line, ...(field === 'category' ? { categoryId: id } : { projectId: id }) }] };
}
```

`src/client/lib/journal-mutations.ts`:

```ts
import { useMutation, type InfiniteData } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { assignPatch, withAssigned, type AssignField } from './journal-assign';
import type { JournalItem, JournalPageData } from './queries';
import { queryClient } from './query';

/**
 * После любого изменения операций — «Указать», массовые действия, форма операции (шаг 6):
 * журнал, счета (балансы и `hasOperations`) и компании (`currencyLocked`, итоги в переключателе).
 */
export async function invalidateOperations(companyId: number): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['accounts', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);
}

/**
 * Текст ошибки записи для пользователя. На конфликт версии (409) — что журнал обновлён: операцию изменили
 * («…проверьте и повторите») или удалили (повторять нечего).
 */
export function operationErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  if (e.status !== 409) return e.message;
  return e.message.startsWith('Операция удалена') ? 'Операция удалена другим пользователем. Журнал обновлён.' : `${e.message}. Журнал обновлён — проверьте и повторите.`;
}

type JournalData = InfiniteData<JournalPageData, string | null>;

interface AssignVars {
  item: JournalItem;
  field: AssignField;
  id: number;
}

/**
 * «Указать» (§7): значение видно сразу (оптимистично), PATCH с version; при ошибке — откат и текст ошибки,
 * в любом случае журнал, счета и компании перечитываются.
 */
export function useAssign(companyId: number, onError: (message: string) => void) {
  return useMutation<unknown, unknown, AssignVars, { snapshot: [readonly unknown[], JournalData | undefined][] }>({
    mutationFn: ({ item, field, id }) => api(`/companies/${companyId}/operations/${item.id}`, { method: 'PATCH', body: assignPatch(item, field, id) }),
    onMutate: async ({ item, field, id }) => {
      await queryClient.cancelQueries({ queryKey: ['journal', companyId] });
      const snapshot = queryClient.getQueriesData<JournalData>({ queryKey: ['journal', companyId] });
      queryClient.setQueriesData<JournalData>({ queryKey: ['journal', companyId] }, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === item.id ? withAssigned(x, field, id) : x)) })),
        },
      );
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data);
      onError(operationErrorText(e));
    },
    onSettled: () => invalidateOperations(companyId),
  });
}
```

`src/client/components/SearchPicker.tsx`:

```ts
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { matchesQuery } from '../../shared/search';
import { Popover } from './Popover';

export interface PickerOption {
  id: number;
  label: string;
}

/**
 * Список с поиском (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают выбор,
 * Enter выбирает, Esc закрывает. Поиск — без учёта регистра и «ё» (тем же правилом, что сервер, §6.1).
 */
function PickerList(props: { label: string; options: PickerOption[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = props.options.filter((o) => matchesQuery(o.label, query));
  const optionId = (o: PickerOption) => `${listId}-${o.id}`;
  const current = shown[Math.min(active, shown.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) props.onPick(current.id);
    }
  };

  return (
    <div>
      <input
        role="combobox"
        aria-label={`${props.label}: поиск`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(current) : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Поиск"
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <ul id={listId} role="listbox" aria-label={props.label} className="max-h-60 overflow-y-auto">
        {shown.map((o) => (
          <li
            key={o.id}
            id={optionId(o)}
            role="option"
            aria-selected={o === current}
            // фокус остаётся в поле поиска
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(shown.indexOf(o))}
            onClick={() => props.onPick(o.id)}
            className={`cursor-pointer truncate rounded-lg px-3 py-1.5 text-sm ${o === current ? 'bg-field' : ''}`}
          >
            {o.label}
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
    </div>
  );
}

/** Кнопка с выпадающим списком с поиском: «Указать» в ячейке журнала, выбор для массового действия. */
export function SearchPicker(props: {
  label: string;
  ariaLabel?: string;
  /** Название списка для программ чтения с экрана. */
  listLabel: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  buttonClassName?: string;
  align?: 'left' | 'right';
}) {
  return (
    <Popover
      label={props.label}
      ariaLabel={props.ariaLabel}
      buttonClassName={props.buttonClassName}
      align={props.align}
      panelClassName="w-72"
    >
      {(close) => (
        <PickerList
          label={props.listLabel}
          options={props.options}
          onPick={(id) => {
            close(true);
            props.onPick(id);
          }}
        />
      )}
    </Popover>
  );
}
```

`src/client/components/journal/AssignPicker.tsx`:

```ts
import { ASSIGN_LABELS, type AssignField } from '../../lib/journal-assign';
import type { CategoryNode, CategoryTree, Counterparty, JournalItem, Project } from '../../lib/queries';
import { SearchPicker, type PickerOption } from '../SearchPicker';

export interface AssignData {
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
}

/** Статьи для выбора: без архивных, дочерние — «Родитель → Дочерняя». */
export function categoryPickerOptions(nodes: CategoryNode[]): PickerOption[] {
  return nodes
    .filter((n) => !n.archivedAt)
    .flatMap((n) => [{ id: n.id, label: n.name }, ...n.children.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: `${n.name} → ${c.name}` }))]);
}

/** Варианты «Указать»: архивные не предлагаются (инвариант 7); статьи — только вида операции (инвариант 3). */
function optionsFor(item: JournalItem, field: AssignField, data: AssignData): PickerOption[] {
  if (field === 'counterparty') return data.counterparties.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }));
  if (field === 'project') return data.projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }));
  return item.type === 'transfer' ? [] : categoryPickerOptions(data.categories[item.type]);
}

const LIST_LABELS: Record<AssignField, string> = { counterparty: 'Контрагенты', category: 'Статьи', project: 'Проекты' };

/** «Указать» в пустой ячейке журнала: список с поиском, выбор сохраняется сразу. */
export function AssignPicker(props: { item: JournalItem; field: AssignField; data: AssignData; onPick: (id: number) => void }) {
  return (
    <SearchPicker
      label="Указать"
      ariaLabel={ASSIGN_LABELS[props.field]}
      listLabel={LIST_LABELS[props.field]}
      options={optionsFor(props.item, props.field, props.data)}
      onPick={props.onPick}
      buttonClassName="rounded-lg px-2 py-1 text-sm font-medium text-income hover:bg-field"
    />
  );
}
```

`src/client/components/journal/JournalTable.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
```

на

```ts
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
```

2. Замените

```ts
  onOpenOperation?: (item: JournalItem) => void;
}
```

на

```ts
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке (§7): вызывается только там, где оно разрешено (canAssign). */
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
}
```

3. Замените

```ts
/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[]): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? null : (names.get(d.id) ?? '…');
}
```

на

```ts
/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : (names.get(d.id) ?? '…');
}
```

4. Замените

```ts
            const share = projectShare(item.lines, props.projectFilter);
```

на

```ts
            const share = projectShare(item.lines, props.projectFilter);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
```

5. Замените

```ts
              counterparty: item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint),
              project: dimensionCell(item, 'projectId', lookups.projects, hint),
```

на

```ts
              counterparty: item.counterpartyId === null ? assign('counterparty') : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint, assign('category')),
              project: dimensionCell(item, 'projectId', lookups.projects, hint, assign('project')),
```

`src/client/pages/JournalPage.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
```

на

```ts
import { AssignPicker } from '../components/journal/AssignPicker';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
```

2. Замените

```ts
import { uniqueById } from '../lib/journal-format';
```

на

```ts
import { uniqueById } from '../lib/journal-format';
import { useAssign } from '../lib/journal-mutations';
```

3. Замените

```ts
/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
```

на

```ts
/** Фокус на строку операции (у строки tabIndex=-1 и data-operation-id). */
function focusRow(id: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`tr[data-operation-id="${id}"]`)?.focus());
}

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
```

4. Замените

```ts
  const [notice, setNotice] = useState<string | null>(null);
```

на

```ts
  const [notice, setNotice] = useState<string | null>(null);
  // ошибка «Указать» (конфликт версии, архив) — над таблицей, пока её не скроют или не начнут новое действие
  const [actionError, setActionError] = useState<string | null>(null);
  const assign = useAssign(company.id, setActionError);
```

5. Замените

```ts
  const conditions = filterConditionCount(state);
```

на

```ts
  const conditions = filterConditionCount(state);
  const assignData = { categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! };
```

6. Замените

```ts
      {notice && (
```

на

```ts
      {actionError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {notice && (
```

7. Замените

```ts
          busy={journal.isPlaceholderData}
        />
```

на

```ts
          busy={journal.isPlaceholderData}
          renderAssign={(item, field) => (
            <AssignPicker
              item={item}
              field={field}
              data={assignData}
              onPick={(id) => {
                setActionError(null);
                assign.mutate({ item, field, id });
                // кнопка «Указать» исчезает вместе с пустой ячейкой — фокус на строку операции
                focusRow(item.id);
              }}
            />
          )}
        />
```

В e2e правка «в другом окне» отправляется только после ответа на перечитывание журнала, вызванное предыдущим «Указать»: иначе поздний ответ мог бы принести новую версию раньше выбора, и конфликта не было бы. Проверка «не обрезан» сравнивает список с обёрткой таблицы и проверяет `elementFromPoint` у последнего варианта: `boundingBox` обрезку не видит, а точка в обрезанной части попадает в другой элемент.

Почему так: снимок `getQueriesData` берётся до оптимистичной правки и возвращается при ошибке; `cancelQueries` не даёт идущему запросу журнала затереть оптимистичное значение. `onSettled` сбрасывает журнал, счета и компании и при успехе, и при ошибке — после 409 строка приходит с новой версией, и повтор проходит. Оптимистичная правка меняет строку на всех страницах; повторы по id страница всё равно убирает (`uniqueById` плана 5b).

Проверьте, что правки не затёрли код плана 5b:

Run: `node -e "const fs = require('fs'); const need = { 'src/client/pages/JournalPage.tsx': ['uniqueById(', '!journal.isPlaceholderData &&', 'applyDialogFields('], 'src/client/components/journal/JournalTable.tsx': ['e.currentTarget.contains(e.target as Node)', 'Перевод: со счёта'] }; for (const [f, xs] of Object.entries(need)) { const s = fs.readFileSync(f, 'utf8'); for (const x of xs) if (!s.includes(x)) { console.error(f + ': пропало «' + x + '» — правка затёрла код плана 5b'); process.exit(1); } }"`
Expected: ничего не выводит, код выхода 0.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-assign.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-assign.ts src/client/lib/journal-mutations.ts src/client/components/SearchPicker.tsx src/client/components/journal/AssignPicker.tsx tests/client/journal-assign.test.ts src/client/components/journal/JournalTable.tsx src/client/pages/JournalPage.tsx e2e/journal-actions.spec.ts
git commit -m "feat: «Указать» в журнале — список с поиском, оптимистичное сохранение с версией, откат при ошибке и конфликте

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Массовые действия, итог с причинами и «Удалено N — Отменить»

**Files:**
- Create: `src/client/components/journal/BulkBar.tsx`, `src/client/components/journal/UndoToast.tsx`, `src/client/lib/journal-bulk.ts`, `tests/client/journal-bulk.test.ts`
- Modify: `src/client/lib/journal-mutations.ts`, `src/client/components/Popover.tsx`, `src/client/components/SearchPicker.tsx`, `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/journal-actions.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `invalidateOperations`, `operationErrorText` (задача 2); `SearchPicker`, `categoryPickerOptions`, `AssignData` (задача 2); `Popover` (план 5b); `dayLabel`, `dayOf`, `timeLabel`, `signedMoney` (план 5b); `POST …/operations/bulk` (план 5a).
- Produces:
  - `journal-bulk.ts`: `BULK_MAX = 500`, `type BulkAction` (`{ action: 'setCategory'; categoryId } | { action: 'setProject'; projectId } | { action: 'setCounterparty'; counterpartyId } | { action: 'delete' } | { action: 'restore' }`), `interface BulkResult { changed: number[]; skipped: { id: number; reason: string }[] }`, `interface BulkSummary { text: string; reasons: { reason: string; count: number }[] }`, `bulkSummary(action, result): BulkSummary`;
  - `journal-mutations.ts`: `runBulk(companyId, ids, action): Promise<BulkResult>`;
  - `Popover`: свойство `inactive?: boolean` — `aria-disabled`, щелчок не открывает панель, кнопка остаётся в порядке фокуса; `SearchPicker`: то же свойство `inactive`;
  - `BulkBar({ count, data, pending, onRun, onClear })` — `role="region"` «Действия с выбранными»: «Выбрано: N», «Статья», «Проект», «Контрагент» (пока `pending` — `inactive`), «Удалить» (подтверждение «Да, удалить» / «Отмена»), «Снять выделение»;
  - `UndoToast({ toast, pending, onUndo, onClose, focusAfter })`, `UNDO_TOAST_MS = 10_000`;
  - `JournalPage` держит тост (`interface UndoState { key; companyId; count; ids }`) и итог «Отмены удаления» с компанией; `JournalScreen` получает `onDeleted(ids)`, `undoSummary`, `onClearUndoSummary()`; заголовок — `<h1 id="journal-heading">`;
  - `JournalTable`: свойство `selection?: { selected: ReadonlySet<number>; onToggle: (id) => void; onToggleAll: (select: boolean) => void }` — колонка флажков «Выбрать все загруженные операции» и «Выбрать операцию: {дата} {время}, {сумма}».

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-bulk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bulkSummary } from '../../src/client/lib/journal-bulk';

describe('итог массового действия (§7)', () => {
  it('«изменено N, пропущено M» и причины с числом операций в порядке первого появления', () => {
    expect(
      bulkSummary('setCategory', {
        changed: [1, 2, 3],
        skipped: [
          { id: 4, reason: 'Разбитая операция — измените её в форме' },
          { id: 5, reason: 'У перевода нет статьи' },
          { id: 6, reason: 'Разбитая операция — измените её в форме' },
        ],
      }),
    ).toEqual({
      text: 'Статья: изменено 3, пропущено 3',
      reasons: [
        { reason: 'Разбитая операция — измените её в форме', count: 2 },
        { reason: 'У перевода нет статьи', count: 1 },
      ],
    });
    expect(bulkSummary('delete', { changed: [1], skipped: [] })).toEqual({ text: 'Удаление: изменено 1, пропущено 0', reasons: [] });
    expect(bulkSummary('restore', { changed: [], skipped: [{ id: 1, reason: 'Операция не удалена' }] }).text).toBe('Отмена удаления: изменено 0, пропущено 1');
  });
});
```

`e2e/journal-actions.spec.ts` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
const bodyRows = (page: Page) => table(page).locator('tbody tr');
```

на

```ts
const bodyRows = (page: Page) => table(page).locator('tbody tr');
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
```

`e2e/journal-actions.spec.ts` — допишите в конец файла:

```ts
test('массовые действия: статья с итогом и причинами, проект, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
  await login(page);
  const name = `ТОО Массовые ${Date.now()}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  const otherName = `ТОО Соседняя ${Date.now()}`;
  const other = (await apiPost(page, '/api/v1/companies', { name: otherName })).company.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const club2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(5), accountId: kaspi, amount: 1000, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(4), accountId: kaspi, amount: 2000, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(3),
    accountId: kaspi,
    amount: 3000,
    comment: 'операция C',
    lines: [
      { projectId: club, amount: 1000 },
      { projectId: club2, amount: 2000 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 4000, comment: 'операция D' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('DCBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });
  const bar = page.getByRole('region', { name: 'Действия с выбранными' });
  const kaspiLink = panel(page).getByRole('link', { name: /^Kaspi/ });
  // 1000 - 10 - 20 - 30 + 40 = 980 ₸
  await expect(kaspiLink).toContainText(/980,00\s₸/);

  // выбрать все загруженные → «Статья»: расходы с одной строкой меняются, разбитая и доход пропущены с причинами
  await table(page).getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  await expect(bar).toContainText('Выбрано: 4');
  await bar.getByRole('button', { name: 'Статья', exact: true }).click();
  await page.getByRole('listbox', { name: 'Статьи' }).getByRole('option', { name: 'Расход: Аренда' }).click();
  const summary = page.getByRole('status').filter({ hasText: 'Статья:' });
  await expect(summary).toContainText('Статья: изменено 2, пропущено 2');
  // фокус после выбора — на кнопке списка, а не на body
  await expect(bar.getByRole('button', { name: 'Статья', exact: true })).toBeFocused();
  await expect(summary).toContainText('Разбитая операция — измените её в форме — 1');
  await expect(summary).toContainText('Статья расходов не подходит для дохода — 1');
  await expect(row('A')).toContainText('Аренда');
  await expect(row('B')).toContainText('Аренда');
  await expect(row('D')).not.toContainText('Аренда');
  // выделение остаётся — можно назначить ещё и проект
  await expect(bar).toContainText('Выбрано: 4');
  await bar.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 2' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Проект:' })).toContainText('Проект: изменено 3, пропущено 1');
  await expect(row('D')).toContainText('Клуб 2');

  // удалить две операции: подтверждение, тост с фокусом на «Отменить», балансы пересчитаны
  await bar.getByRole('button', { name: 'Снять выделение' }).click();
  await expect(bar).toHaveCount(0);

  // смена фильтра снимает выделение: действие не уйдёт на строки, которых уже не видно (Review Focus 4)
  await row('A').getByRole('checkbox').check();
  await expect(bar).toContainText('Выбрано: 1');
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(bar).toHaveCount(0);
  await page.getByLabel('Период').selectOption({ label: 'Всё время' });
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(row('A').getByRole('checkbox')).not.toBeChecked();
  await row('A').getByRole('checkbox').check();
  await row('D').getByRole('checkbox').check();
  await expect(row('A').getByRole('checkbox')).toHaveAccessibleName(/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210,00\s₸$/);
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  const undo = page.getByRole('button', { name: 'Отменить' });
  await expect(page.getByRole('status').filter({ hasText: 'Удалено 2' })).toBeVisible();
  await expect(undo).toBeFocused();
  await expect.poll(() => letters(page)).toBe('CB');
  await expect(kaspiLink).toContainText(/950,00\s₸/);

  // «Отменить» возвращает именно эти операции
  await undo.click();
  await expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 2, пропущено 0');
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(kaspiLink).toContainText(/980,00\s₸/);
  await expect(page.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();

  // удалили и сразу перешли в другую компанию: тост остаётся, «Отменить» возвращает операции той компании, где удаляли
  await row('B').getByRole('checkbox').check();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(undo).toBeFocused();
  await expect.poll(() => letters(page)).toBe('DCA');
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('menuitem', { name: otherName }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}/log$`));
  await expect(page.getByText('Операций пока нет.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await undo.click();
  await expect(undo).toHaveCount(0);
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 1, пропущено 0');
  await expect(kaspiLink).toContainText(/980,00\s₸/);
});
```

Проверьте экранирования:

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" tests/client/journal-bulk.test.ts e2e/journal-actions.spec.ts`
Expected: ничего не выводит.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-bulk.test.ts`
Expected: FAIL — нет модуля `journal-bulk`.

Run: `npx playwright test e2e/journal-actions.spec.ts -g "массовые"`
Expected: FAIL — нет флажка «Выбрать все загруженные операции».

- [ ] **Step 3: Implement**

`src/client/lib/journal-bulk.ts`:

```ts
/** Не больше операций за одно массовое действие — как у сервера (BULK_MAX плана 5a). */
export const BULK_MAX = 500;

/** Тело POST /companies/:cid/operations/bulk без списка id (план 5a). */
export type BulkAction =
  | { action: 'setCategory'; categoryId: number }
  | { action: 'setProject'; projectId: number }
  | { action: 'setCounterparty'; counterpartyId: number }
  | { action: 'delete' }
  | { action: 'restore' };

export interface BulkResult {
  changed: number[];
  skipped: { id: number; reason: string }[];
}

const TITLES: Record<BulkAction['action'], string> = {
  setCategory: 'Статья',
  setProject: 'Проект',
  setCounterparty: 'Контрагент',
  delete: 'Удаление',
  restore: 'Отмена удаления',
};

export interface BulkSummary {
  text: string;
  reasons: { reason: string; count: number }[];
}

/** Итог массового действия (§7): «Статья: изменено 3, пропущено 2» и причины пропуска с числом операций. */
export function bulkSummary(action: BulkAction['action'], r: BulkResult): BulkSummary {
  const counts = new Map<string, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return {
    text: `${TITLES[action]}: изменено ${r.changed.length}, пропущено ${r.skipped.length}`,
    reasons: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}
```

`src/client/lib/journal-mutations.ts` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { assignPatch, withAssigned, type AssignField } from './journal-assign';
```

на

```ts
import { assignPatch, withAssigned, type AssignField } from './journal-assign';
import type { BulkAction, BulkResult } from './journal-bulk';
```

`src/client/lib/journal-mutations.ts` — допишите в конец файла:

```ts
/** Массовое действие над выбранными операциями (§7); журнал, счета и компании перечитываются и при ошибке. */
export async function runBulk(companyId: number, ids: number[], action: BulkAction): Promise<BulkResult> {
  try {
    return await api<BulkResult>(`/companies/${companyId}/operations/bulk`, { method: 'POST', body: { ...action, ids } });
  } finally {
    void invalidateOperations(companyId);
  }
}
```

`src/client/components/Popover.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
  panelClassName?: string;
  disabled?: boolean;
```

на

```ts
  panelClassName?: string;
  disabled?: boolean;
  /**
   * Кнопка недоступна, но остаётся в порядке фокуса (aria-disabled, щелчок не открывает панель): фокус,
   * вернувшийся на неё после выбора, не теряется, пока идёт начатое действие.
   */
  inactive?: boolean;
```

2. Замените

```ts
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
```

на

```ts
        disabled={props.disabled}
        aria-disabled={props.inactive || undefined}
        onClick={() => {
          if (!props.inactive) setOpen((v) => !v);
        }}
```

3. Замените

```ts
        className={props.buttonClassName ?? btnSmall}
      >
```

на

```ts
        className={`${props.buttonClassName ?? btnSmall} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
      >
```

`src/client/components/SearchPicker.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
  align?: 'left' | 'right';
}) {
```

на

```ts
  align?: 'left' | 'right';
  /** Недоступна без потери фокуса (aria-disabled) — см. Popover. */
  inactive?: boolean;
}) {
```

2. Замените

```ts
      align={props.align}
```

на

```ts
      align={props.align}
      inactive={props.inactive}
```

`src/client/components/journal/BulkBar.tsx`:

```ts
import { useState } from 'react';
import { BULK_MAX, type BulkAction } from '../../lib/journal-bulk';
import { SearchPicker } from '../SearchPicker';
import { btnDanger, btnSecondary, btnSmall } from '../ui';
import { categoryPickerOptions, type AssignData } from './AssignPicker';

/**
 * Массовые действия с выбранными строками (§7): «Статья», «Проект», «Контрагент» (только назначают значение),
 * «Удалить» с подтверждением. Не больше BULK_MAX операций за раз. Пока действие выполняется, списки только помечены
 * недоступными (aria-disabled): после выбора фокус возвращается на кнопку списка и там остаётся.
 */
export function BulkBar(props: { count: number; data: AssignData; pending: boolean; onRun: (action: BulkAction) => void; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const tooMany = props.count > BULK_MAX;
  const disabled = props.pending || tooMany;
  const pickerClass = btnSmall;
  const categoryOptions = [
    ...categoryPickerOptions(props.data.categories.income).map((o) => ({ ...o, label: `Доход: ${o.label}` })),
    ...categoryPickerOptions(props.data.categories.expense).map((o) => ({ ...o, label: `Расход: ${o.label}` })),
  ];

  return (
    <div role="region" aria-label="Действия с выбранными" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-field/60 px-3 py-2">
      <span className="text-sm font-semibold">Выбрано: {props.count}</span>
      {tooMany ? (
        <span className="text-sm text-expense">Не больше {BULK_MAX} операций за раз — снимите часть выделения</span>
      ) : (
        <>
          <SearchPicker
            label="Статья"
            listLabel="Статьи"
            options={categoryOptions}
            onPick={(categoryId) => props.onRun({ action: 'setCategory', categoryId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          <SearchPicker
            label="Проект"
            listLabel="Проекты"
            options={props.data.projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
            onPick={(projectId) => props.onRun({ action: 'setProject', projectId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          <SearchPicker
            label="Контрагент"
            listLabel="Контрагенты"
            options={props.data.counterparties.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }))}
            onPick={(counterpartyId) => props.onRun({ action: 'setCounterparty', counterpartyId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          {!confirm && (
            <button type="button" disabled={disabled} onClick={() => setConfirm(true)} className={`${btnSmall} text-expense`}>
              Удалить
            </button>
          )}
        </>
      )}
      {confirm && !tooMany && (
        <span role="group" aria-label="Подтверждение удаления" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Удалить выбранные операции ({props.count})? Отменить можно будет 10 секунд.</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setConfirm(false);
              props.onRun({ action: 'delete' });
            }}
            className={`${btnDanger} px-3 py-1.5 text-sm`}
          >
            Да, удалить
          </button>
          <button type="button" autoFocus onClick={() => setConfirm(false)} className={`${btnSecondary} px-3 py-1.5 text-sm`}>
            Отмена
          </button>
        </span>
      )}
      <button type="button" onClick={props.onClear} className="ml-auto text-sm font-semibold underline">
        Снять выделение
      </button>
    </div>
  );
}
```

`src/client/components/journal/UndoToast.tsx`:

```ts
import { useEffect, useRef } from 'react';

/** Сколько висит тост «Удалено N — Отменить» (§7). */
export const UNDO_TOAST_MS = 10_000;

/**
 * Тост после массового удаления. Область `role="status"` есть на странице всегда — так программа чтения
 * с экрана объявляет появившийся текст. Фокус переходит на «Отменить» (выбранные строки и кнопка
 * подтверждения исчезли); когда тост закрывается, фокус, если был в нём, уходит на заголовок журнала.
 */
export function UndoToast(props: {
  toast: { key: number; count: number } | null;
  pending: boolean;
  onUndo: () => void;
  onClose: () => void;
  focusAfter: () => HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const focusAfter = useRef(props.focusAfter);
  focusAfter.current = props.focusAfter;

  const finish = (action: () => void) => {
    const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
    action();
    if (hadFocus) focusAfter.current()?.focus();
  };

  const key = props.toast?.key;
  useEffect(() => {
    if (key === undefined) return;
    undoRef.current?.focus();
    const t = setTimeout(() => finish(() => onClose.current()), UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [key]);

  return (
    <div ref={rootRef} role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
      {props.toast && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-ink px-5 py-3 text-sm text-white shadow-2xl">
          <span>Удалено {props.toast.count}</span>
          <button ref={undoRef} type="button" disabled={props.pending} onClick={() => finish(props.onUndo)} className="font-semibold text-income-soft underline">
            Отменить
          </button>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => finish(props.onClose)} className="text-white/70 hover:text-white">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

`src/client/components/journal/JournalTable.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
}
```

на

```ts
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
  /** Выделение строк для массовых действий: колонка флажков слева. */
  selection?: {
    selected: ReadonlySet<number>;
    onToggle: (id: number) => void;
    onToggleAll: (select: boolean) => void;
  };
}
```

2. Замените

```ts
export function JournalTable(props: JournalTableProps) {
  const { lookups, columns } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
```

на

```ts
export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
  const selectedCount = selection ? props.items.filter((i) => selection.selected.has(i.id)).length : 0;
  const allSelected = props.items.length > 0 && selectedCount === props.items.length;
```

3. Замените

```ts
          <tr className="border-b border-field">
            {shown.map((c) =>
```

на

```ts
          <tr className="border-b border-field">
            {selection && (
              <th scope="col" className={`${thClass} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Выбрать все загруженные операции"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  onChange={() => selection.onToggleAll(!allSelected)}
                />
              </th>
            )}
            {shown.map((c) =>
```

4. Замените

```ts
                className={`border-b border-field outline-none last:border-0 focus:bg-field/60 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''}`}
              >
```

на

```ts
                className={`border-b border-field outline-none last:border-0 focus:bg-field/60 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''} ${selection?.selected.has(item.id) ? 'bg-income-soft/40' : ''}`}
              >
                {selection && (
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      aria-label={`Выбрать операцию: ${dayLabel(dayOf(item.paidAt, props.timeZone), props.today)} ${timeLabel(item.paidAt, props.timeZone)}, ${signedMoney(item.type, item.amount, currency)}`}
                      checked={selection.selected.has(item.id)}
                      onChange={() => selection.onToggle(item.id)}
                    />
                  </td>
                )}
```

`src/client/pages/JournalPage.tsx` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```ts
import { useMemo, useState } from 'react';
```

на

```ts
import { useEffect, useMemo, useState } from 'react';
```

2. Замените

```ts
import { AssignPicker } from '../components/journal/AssignPicker';
```

на

```ts
import { AssignPicker } from '../components/journal/AssignPicker';
import { BulkBar } from '../components/journal/BulkBar';
```

3. Замените

```ts
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
```

на

```ts
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
import { UndoToast } from '../components/journal/UndoToast';
```

4. Замените

```ts
import { useAssign } from '../lib/journal-mutations';
```

на

```ts
import { bulkSummary, type BulkAction, type BulkSummary } from '../lib/journal-bulk';
import { operationErrorText, runBulk, useAssign } from '../lib/journal-mutations';
```

5. Замените

```ts
/**
 * Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка.
 * Маршрут не пересоздаёт страницу при смене компании, поэтому экран компании — с key: окно «Фильтр»,
 * выделение и сообщения начинаются заново.
 */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <JournalScreen key={company.id} company={company} />;
}

function JournalScreen({ company }: { company: Company }) {
```

на

```ts
/** id заголовка «Журнал»: на него уходит фокус, когда закрывается тост. */
const HEADING_ID = 'journal-heading';

interface UndoState {
  key: number;
  /** Компания, где удалили: после смены компании «Отменить» восстанавливает операции именно в ней. */
  companyId: number;
  count: number;
  ids: number[];
}

/**
 * Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка.
 * Маршрут не пересоздаёт страницу при смене компании, поэтому экран компании — с key: окно «Фильтр»,
 * выделение и сообщения начинаются заново. Тост «Удалено N — Отменить» живёт выше — он помнит компанию.
 */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const [toast, setToast] = useState<UndoState | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoSummary, setUndoSummary] = useState<{ companyId: number; summary: BulkSummary } | null>(null);

  const undo = async (t: UndoState) => {
    setToast(null);
    setUndoPending(true);
    try {
      setUndoSummary({ companyId: t.companyId, summary: bulkSummary('restore', await runBulk(t.companyId, t.ids, { action: 'restore' })) });
    } catch (e) {
      setUndoSummary({ companyId: t.companyId, summary: { text: operationErrorText(e), reasons: [] } });
    } finally {
      setUndoPending(false);
    }
  };

  return (
    <>
      <JournalScreen
        key={company.id}
        company={company}
        onDeleted={(ids) => setToast({ key: Date.now(), companyId: company.id, count: ids.length, ids })}
        undoSummary={undoSummary?.companyId === company.id ? undoSummary.summary : null}
        onClearUndoSummary={() => setUndoSummary(null)}
      />
      <UndoToast
        toast={toast}
        pending={undoPending}
        onUndo={() => toast && void undo(toast)}
        onClose={() => setToast(null)}
        focusAfter={() => document.getElementById(HEADING_ID)}
      />
    </>
  );
}

function JournalScreen(props: {
  company: Company;
  onDeleted: (ids: number[]) => void;
  undoSummary: BulkSummary | null;
  onClearUndoSummary: () => void;
}) {
  const { company } = props;
```

6. Замените

```ts
  const assign = useAssign(company.id, setActionError);
```

на

```ts
  const assign = useAssign(company.id, setActionError);
  // массовые действия: выделение (только загруженные строки), итог, тост отмены удаления (в JournalPage)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const filterKey = params.toString();
  // другой фильтр — выделение снимается (другая компания — новый экран, см. key выше)
  useEffect(() => setSelected(new Set()), [filterKey]);
```

7. Замените

```ts
  const assignData = { categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! };
```

на

```ts
  const assignData = { categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! };
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const shownSummary = props.undoSummary ?? summary;
  const run = async (action: BulkAction, ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    props.onClearUndoSummary();
    try {
      const result = await runBulk(company.id, ids, action);
      setSummary(bulkSummary(action.action, result));
      if (action.action === 'delete') {
        setSelected(new Set());
        if (result.changed.length > 0) props.onDeleted(result.changed);
      }
    } catch (e) {
      setActionError(operationErrorText(e));
    } finally {
      setBulkPending(false);
    }
  };
```

8. Замените

```ts
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
```

на

```ts
      <h1 id={HEADING_ID} tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
```

9. Замените

```ts
      {notice && (
```

на

```ts
      {shownSummary && (
        <div role="status" className="mb-4 rounded-xl bg-field px-4 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">{shownSummary.text}</span>
            <button
              type="button"
              onClick={() => {
                setSummary(null);
                props.onClearUndoSummary();
              }}
              className="font-semibold underline"
            >
              Скрыть
            </button>
          </div>
          {shownSummary.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {shownSummary.reasons.map((r) => (
                <li key={r.reason}>
                  {r.reason} — {r.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && (
```

10. Замените

```ts
      {!journal.data && !journal.error ? (
```

на

```ts
      {selectedIds.length > 0 && (
        <BulkBar count={selectedIds.length} data={assignData} pending={bulkPending} onRun={(action) => void run(action, selectedIds)} onClear={() => setSelected(new Set())} />
      )}
      {!journal.data && !journal.error ? (
```

11. Замените

```ts
                focusRow(item.id);
              }}
            />
          )}
        />
```

на

```ts
                focusRow(item.id);
              }}
            />
          )}
          selection={{
            selected,
            onToggle: (id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            onToggleAll: (select) => setSelected(select ? new Set(items.map((i) => i.id)) : new Set()),
          }}
        />
```

`README.md` — точечные правки (каждый фрагмент встречается в файле один раз):

1. Замените

```md
Сделаны шаги 1–4 этапа 1 и серверная часть шага 5 (§11 спецификации):
```

на

```md
Сделаны шаги 1–5 этапа 1 (§11 спецификации):
```

2. Замените

```md
  - фильтр хранится в адресе страницы; клик по счёту в левой панели фильтрует журнал.
```

на

```md
  - фильтр хранится в адресе страницы; клик по счёту в левой панели фильтрует журнал;
  - сохранённые фильтры, «Указать» в пустой ячейке, массовые действия с итогом и «Отменить» после удаления.
```

3. Замените

```md
Пока нет (следующие шаги): сохранённые фильтры, «Указать» и массовые действия на экране журнала, форма операции, отчёты, мобильная версия и PWA.
```

на

```md
Пока нет (следующие шаги): форма операции в интерфейсе, отчёты, мобильная версия и PWA.
```

Компанию в e2e переключатель выбирает по точному сохранённому названию (`name`), а не по шаблону: так тест не зависит от компаний других тестов с похожими названиями.

Проверьте, что правки не затёрли код плана 5b:

Run: `node -e "const fs = require('fs'); const need = { 'src/client/pages/JournalPage.tsx': ['uniqueById(', '!journal.isPlaceholderData &&', 'applyDialogFields('], 'src/client/components/journal/JournalTable.tsx': ['e.currentTarget.contains(e.target as Node)', 'Перевод: со счёта'] }; for (const [f, xs] of Object.entries(need)) { const s = fs.readFileSync(f, 'utf8'); for (const x of xs) if (!s.includes(x)) { console.error(f + ': пропало «' + x + '» — правка затёрла код плана 5b'); process.exit(1); } }"`
Expected: ничего не выводит, код выхода 0.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-bulk.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (два прогона e2e подряд — тост и фокус не должны давать нестабильности).

```bash
git add src/client/lib/journal-bulk.ts tests/client/journal-bulk.test.ts src/client/lib/journal-mutations.ts src/client/components/Popover.tsx src/client/components/SearchPicker.tsx src/client/components/journal/BulkBar.tsx src/client/components/journal/UndoToast.tsx src/client/components/journal/JournalTable.tsx src/client/pages/JournalPage.tsx e2e/journal-actions.spec.ts README.md
git commit -m "feat: массовые действия журнала — статья, проект, контрагент, удаление с «Отменить», итог с причинами

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §7 «Фильтр»: «Сохранить фильтр»; сохранённые фильтры в тулбаре | Task 1 |
| §4.6 инвариант 10: недоступные элементы сохранённого фильтра отбрасываются, пользователь видит предупреждение | Task 1 (`unavailable` плана 5a) |
| §6 сохранённые фильтры — только свои (сервер, план 5a); переименование и удаление в интерфейсе | Task 1 |
| §7 «Указать»: только у операций с одной строкой (проект — и у перевода), список с поиском, сразу, оптимистично, с откатом; `version` и 409 | Task 2 |
| §4.6 инварианты 3 и 7 в выборе: статьи вида операции, без архивных | Task 2 (сервер всё равно проверяет) |
| §7 массовые действия: «Категория», «Проект», «Контрагент», «Удалить» с подтверждением; итог «изменено N, пропущено M» с причинами | Task 3 |
| §7 тост «Удалено N — Отменить» на 10 секунд (`bulk restore`) | Task 3 |
| Сброс `['accounts', cid]`, `['companies']` и журнала после любого изменения операций | Tasks 2, 3 (`invalidateOperations`) |
| Тулбар журнала не пропадает, пока грузится новый запрос после ошибки (замечание повторного ревью 5b) | Task 1 |

Вне этого плана: форма операции и клик по строке (шаг 6 — подключается через `onOpenOperation` таблицы и `invalidateOperations`); мобильная версия журнала (шаг 7).
