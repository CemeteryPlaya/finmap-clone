# Этап 1, план 5c: журнал — действия (сохранённые фильтры, «Указать», массовые действия, «Отменить») — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина интерфейса шага 5 §11 спецификации — действия на экране журнала:
- сохранённые фильтры: «Сохранить фильтр» в окне «Фильтр», меню «Сохранённые фильтры» (применить, переименовать, удалить), предупреждение о недоступных условиях (инвариант 10);
- «Указать» в пустой ячейке контрагента, статьи или проекта: список с поиском, оптимистичное сохранение `PATCH` с `version`, откат и сообщение при ошибке и конфликте (409);
- массовые действия по выделенным строкам: «Статья», «Проект», «Контрагент», «Удалить» с подтверждением; итог «изменено N, пропущено M» с причинами; тост «Удалено N — Отменить» на 10 секунд (`bulk restore` по `changed` из ответа удаления);
- после любого изменения операций — сброс кэшей журнала, счетов (`['accounts', cid]`: балансы, `hasOperations`) и компаний (`['companies']`: `currencyLocked`, итоги).

**Предусловие:** выполнены планы 5a (API журнала, массовых действий, сохранённых фильтров) и 5b (экран журнала: `JournalPage`, `JournalTable`, `JournalToolbar`, `FilterDialog`, `Popover`, `Modal`, `journal-filter.ts`, `e2e/journal.spec.ts`).

**Architecture:**
- **Сохранённые фильтры** — запрос `useSavedFilters(cid)` (ключ `['saved-filters', cid]`) и чистые функции `savedFilterFromState` / `stateFromSavedFilter` (JSON фильтра API плана 5a ↔ фильтр адресной строки). Меню — на `Popover` плана 5b.
- **«Указать» и массовые действия** используют общий `SearchPicker` — кнопку с выпадающим списком с поиском (combobox + listbox: стрелки, Enter, Esc). Правила «где есть „Указать“» и тело `PATCH` — чистые функции `journal-assign.ts`. Оптимистичное изменение правит строки во всех страницах `['journal', cid, …]` через `setQueriesData` и откатывается по снимку.
- **`invalidateOperations(cid)`** (`src/client/lib/journal-mutations.ts`) — единая точка сброса после изменения операций: `['journal', cid]`, `['accounts', cid]`, `['companies']`. Её же вызовет форма операции шага 6 (вместе с `onOpenOperation` таблицы — точкой подключения из плана 5b).
- **Выделение** — множество id в `JournalPage`, только среди загруженных строк; колонка флажков в `JournalTable` (`selection`). Итог действия и тост — области `role="status"`.

**Tech Stack:** как в планах 1–5b. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.4 (`saved_filters`), §4.6 (инварианты 3, 7, 10), §6 (Сохранённые фильтры, Операции `bulk`, решения 2026-10-07), §6.2 (409 `VERSION_CONFLICT`), §7 Журнал («Фильтр» — «Сохранить фильтр», сохранённые фильтры, «Указать», массовые действия), §11 шаг 5.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§7, блок «Решения планирования от 2026-10-07 (планы 5b и 5c)») тем же коммитом, что и план 5b.

1. **Сохранение фильтра** — в окне «Фильтр»: «Сохранить фильтр» открывает поле «Название фильтра» и кнопку «Сохранить». Сохраняются условия окна и тулбара (период, поиск, сумма); период — датами (решение 6 плана 5a), сортировка не сохраняется. После сохранения окно применяет фильтр и закрывается; ошибка (пустое название) — у поля, окно остаётся открытым.
2. **Применение сохранённого фильтра** заменяет все условия, сортировка остаётся текущей; даты — период «Произвольно». Если сервер убрал недоступные ссылки (`unavailable > 0`), у пункта меню видно «(N условий недоступно)», а после применения — сообщение «Фильтр «…»: N условий недоступно (удалены или в архиве) — они не применены.» до «Скрыть» или следующего применения.
3. **«Указать»** (§7) — у операции с одной строкой: контрагент и статья — у дохода и расхода, проект — ещё у перевода без строк (ему создаётся строка на всю сумму). В списке нет архивных элементов (инвариант 7), статьи — только вида операции (инвариант 3). `PATCH` шлёт `version` и одно поле. При ошибке значение откатывается и над таблицей — сообщение (`role="alert"`); при 409 — «Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.» В любом случае журнал, счета и компании перечитываются.
4. **Выделение** — флажки строк и «Выбрать все загруженные операции» в заголовке (только загруженные страницы); не больше 500 (BULK_MAX плана 5a) — иначе действия недоступны с подсказкой. Смена фильтра или компании снимает выделение. После «Статья», «Проект», «Контрагент» выделение остаётся (можно назначить следующее), после удаления снимается.
5. **«Статья» в массовых действиях** предлагает статьи обоих видов с пометкой «Доход: …» / «Расход: …»: сервер сам пропускает операции другого вида с причиной.
6. **Итог** — «Статья: изменено N, пропущено M» и список причин с числом операций («Разбитая операция — измените её в форме — 2»).
7. **Тост «Удалено N — Отменить»** висит 10 секунд и не останавливается. Область `role="status"` есть на странице всегда, чтобы появление текста объявлялось. Фокус переходит на «Отменить» (выделенные строки и кнопка подтверждения исчезли); когда тост закрывается, фокус, если был в нём, переходит на заголовок «Журнал». «Отменить» шлёт `bulk restore` с `changed` из ответа удаления — операции, удалённые раньше другим действием, не возвращаются (решение 5 плана 5a).

## Global Constraints

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
2. **Сохранённый фильтр, тег которого ушёл в архив:** в меню — «(1 условие недоступно)», при применении — предупреждение, фильтр применяется без тега. Тест — задача 1.
3. **«Отменить» после удаления:** возвращаются ровно удалённые операции, балансы в левой панели возвращаются к прежним, фокус не теряется (на «Отменить», затем на заголовке). Тест — задача 3.
4. **Выделение и смена фильтра:** строки, которые ушли из списка после смены периода, не остаются выделенными — массовое действие не уходит на невидимые операции. Тест — задача 3.
5. **Пустое название при сохранении фильтра:** окно не закрывается, поле помечено ошибкой сервера, фильтр не применяется. Тест — задача 1.

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
### Task 1: Сохранённые фильтры — сохранить, применить, переименовать, удалить; предупреждение о недоступных условиях

**Files:**
- Create: `src/client/components/journal/SavedFiltersMenu.tsx`, `tests/client/journal-saved-filter.test.ts`, `e2e/journal-actions.spec.ts`
- Modify: `src/client/lib/journal-filter.ts`, `src/client/lib/queries.ts`, `src/client/components/journal/FilterDialog.tsx`, `src/client/pages/JournalPage.tsx`

**Interfaces:**
- Consumes: `JournalUrlState`, `EMPTY_JOURNAL_STATE`, `OPERATION_TYPES`, `periodRange`, `sortedUnique` (план 5b, `journal-filter.ts`); `pluralRu` (план 5b, `journal-format.ts`); `Popover`, `FilterDialog`, `JournalPage` (план 5b); `api`, `ApiError`; `queryClient`; `Field`; API сохранённых фильтров плана 5a.
- Produces:
  - `journal-filter.ts`: `interface SavedJournalFilter` (поля API: `from?`, `to?`, `q?`, `amountMin?`, `amountMax?`, `types?`, `accountIds?`, `categoryIds?`, `projectIds?`, `counterpartyIds?`, `tagIds?`, `withoutCategory?: true`, `withoutProject?: true`, `withoutCounterparty?: true`), `savedFilterFromState(state, today): SavedJournalFilter`, `stateFromSavedFilter(filter, current: Pick<JournalUrlState, 'sort' | 'order'>): JournalUrlState`;
  - `queries.ts`: `interface SavedFilter`, `useSavedFilters(companyId)` — ключ `['saved-filters', companyId]`;
  - `SavedFiltersMenu({ companyId, filters, onApply })`, `unavailableText(n): string` («1 условие недоступно», «2 условия недоступны», «5 условий недоступно»); пункты меню — кнопки «Применить фильтр «…»», «Переименовать фильтр «…»», «Удалить фильтр «…»»;
  - `FilterDialog` получает обязательное свойство `onSave: (draft: JournalUrlState, name: string) => Promise<void>` и кнопку «Сохранить фильтр».

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

`e2e/journal-actions.spec.ts` (вспомогательные функции и первый тест; задачи 2 и 3 дописывают тесты в конец файла):

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

/** Момент n минут назад: операции не могут быть в будущем (инвариант 6). */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

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
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(3), accountId: kaspi, amount: 100, tagIds: [shift], comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minutesAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');

  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр' });
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
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeVisible();
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
  await expect(shifts).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-saved-filter.test.ts`
Expected: FAIL — нет `savedFilterFromState`.

Run: `npx playwright test e2e/journal-actions.spec.ts`
Expected: FAIL — нет кнопки «Сохранить фильтр».

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

`src/client/lib/queries.ts` — после строки `import type { CounterpartyType } from '../../shared/system-categories';` добавьте:

```ts
import type { SavedJournalFilter } from './journal-filter';
```

и допишите в конец файла:

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
import { useState } from 'react';
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

function SavedFilterItem(props: { filter: SavedFilter; companyId: number; onApply: () => void }) {
  const { filter } = props;
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(filter.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const url = `/companies/${props.companyId}/saved-filters/${filter.id}`;

  const run = async (request: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: ['saved-filters', props.companyId] });
      setMode('view');
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
            void run(() => api(url, { method: 'PATCH', body: { name } }));
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
            <button type="button" onClick={() => setMode('view')} className={btnSmall}>
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
          <button type="button" disabled={pending} onClick={() => void run(() => api(url, { method: 'DELETE' }))} className={`${btnDanger} px-3 py-1.5 text-sm`}>
            Да, удалить
          </button>
          <button type="button" autoFocus onClick={() => setMode('view')} className={`${btnSecondary} px-3 py-1.5 text-sm`}>
            Отмена
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-0.5">
      <button
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

`src/client/components/journal/FilterDialog.tsx` — замените файл целиком:

```ts
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { matchesQuery } from '../../../shared/search';
import { sortedUnique, type JournalUrlState, type OperationType } from '../../lib/journal-filter';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from '../../lib/queries';
import { Modal } from '../Modal';
import { Field } from '../Field';
import { btnPrimary, btnSecondary, inputClass } from '../ui';

export interface FilterDialogData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
}

interface Option {
  id: number;
  label: string;
  /** Отступ дочерней статьи. */
  nested?: boolean;
}

const TYPE_LABELS: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };
type ListField = 'accountIds' | 'categoryIds' | 'projectIds' | 'counterpartyIds' | 'tagIds';
type FlagField = 'withoutCategory' | 'withoutProject' | 'withoutCounterparty';

/** Архивные элементы не предлагаются — кроме уже выбранных (например, из адреса): их можно снять. */
function options<T extends { id: number; name: string; archivedAt: string | null }>(rows: T[], selected: readonly number[]): Option[] {
  return rows
    .filter((r) => !r.archivedAt || selected.includes(r.id))
    .map((r) => ({ id: r.id, label: r.archivedAt ? `${r.name} (архив)` : r.name }));
}

function categoryOptions(nodes: CategoryNode[], selected: readonly number[]): Option[] {
  return nodes.flatMap((n) => {
    const children = n.children
      .filter((c) => (!c.archivedAt && !n.archivedAt) || selected.includes(c.id))
      .map((c) => ({ id: c.id, label: c.archivedAt || n.archivedAt ? `${c.name} (архив)` : c.name, nested: true }));
    const self = !n.archivedAt || selected.includes(n.id) ? [{ id: n.id, label: n.archivedAt ? `${n.name} (архив)` : n.name }] : [];
    return [...self, ...children];
  });
}

const sectionClass = 'min-w-0 rounded-2xl bg-field/50 p-3';
const legendClass = 'px-1 text-sm font-semibold';
const checkClass = 'flex items-center gap-2 py-0.5 text-sm';

function CheckList(props: { items: Option[]; selected: readonly number[]; onToggle: (id: number) => void; empty: string }) {
  if (props.items.length === 0) return <p className="py-1 text-sm text-muted">{props.empty}</p>;
  return (
    <div className="max-h-48 overflow-y-auto">
      {props.items.map((o) => (
        <label key={o.id} className={`${checkClass} ${o.nested ? 'pl-5' : ''}`}>
          <input type="checkbox" checked={props.selected.includes(o.id)} onChange={() => props.onToggle(o.id)} />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={sectionClass}>
      <legend className={legendClass}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Модалка «Фильтр» (§7): все условия фильтра журнала §6, кроме периода, поиска и суммы (они в тулбаре).
 * Меняет черновик; «Готово» применяет его, Esc и «Отмена» закрывают без изменений.
 */
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: JournalUrlState) => void;
  onCancel: () => void;
  onSave: (draft: JournalUrlState, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<JournalUrlState>(props.state);
  const [cpQuery, setCpQuery] = useState('');
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const { data } = props;

  const toggle = (field: ListField) => (id: number) =>
    setDraft((d) => ({ ...d, [field]: d[field].includes(id) ? d[field].filter((x) => x !== id) : sortedUnique([...d[field], id]) }));
  const toggleType = (t: OperationType) =>
    setDraft((d) => ({ ...d, types: (['income', 'expense', 'transfer'] as const).filter((x) => (x === t ? !d.types.includes(t) : d.types.includes(x))) }));
  const flag = (field: FlagField, label: string) => (
    <label className={`${checkClass} font-medium`}>
      <input type="checkbox" checked={draft[field]} onChange={() => setDraft((d) => ({ ...d, [field]: !d[field] }))} />
      {label}
    </label>
  );
  const clear = () =>
    setDraft((d) => ({
      ...d,
      types: [],
      accountIds: [],
      categoryIds: [],
      projectIds: [],
      counterpartyIds: [],
      tagIds: [],
      withoutCategory: false,
      withoutProject: false,
      withoutCounterparty: false,
    }));

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
    (o) => draft.counterpartyIds.includes(o.id) || matchesQuery(o.label, cpQuery),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(draft);
      }}
    >
      <div className="grid max-h-[60dvh] gap-3 overflow-y-auto md:grid-cols-2">
        <Section legend="Тип операции">
          {(['income', 'expense', 'transfer'] as const).map((t) => (
            <label key={t} className={checkClass}>
              <input type="checkbox" checked={draft.types.includes(t)} onChange={() => toggleType(t)} />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </Section>
        <Section legend="Счета">
          <CheckList items={options(data.accounts, draft.accountIds)} selected={draft.accountIds} onToggle={toggle('accountIds')} empty="Счетов нет" />
        </Section>
        <Section legend="Статьи">
          {flag('withoutCategory', 'Без статьи')}
          <p className="mt-1 text-xs text-muted">Доходы</p>
          <CheckList items={categoryOptions(data.categories.income, draft.categoryIds)} selected={draft.categoryIds} onToggle={toggle('categoryIds')} empty="Статей нет" />
          <p className="mt-1 text-xs text-muted">Расходы</p>
          <CheckList items={categoryOptions(data.categories.expense, draft.categoryIds)} selected={draft.categoryIds} onToggle={toggle('categoryIds')} empty="Статей нет" />
        </Section>
        <Section legend="Проекты">
          {flag('withoutProject', 'Без проекта')}
          <CheckList items={options(data.projects, draft.projectIds)} selected={draft.projectIds} onToggle={toggle('projectIds')} empty="Проектов нет" />
        </Section>
        <Section legend="Контрагенты">
          {flag('withoutCounterparty', 'Без контрагента')}
          <input
            type="search"
            aria-label="Найти контрагента"
            placeholder="Найти контрагента"
            value={cpQuery}
            onChange={(e) => setCpQuery(e.target.value)}
            // Enter в поиске не применяет фильтр
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            className={`${inputClass} my-1 py-1.5 text-sm`}
          />
          <CheckList items={counterparties} selected={draft.counterpartyIds} onToggle={toggle('counterpartyIds')} empty="Никого не нашли" />
        </Section>
        <Section legend="Теги">
          <CheckList items={options(data.tags, draft.tagIds)} selected={draft.tagIds} onToggle={toggle('tagIds')} empty="Тегов нет" />
        </Section>
      </div>
      <p className="mt-3 text-xs text-muted">
        Внутри одного раздела подходит любой из выбранных вариантов («Аренда» или «Без статьи»), между разделами — все условия сразу. Родительская статья включает
        дочерние.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" aria-expanded={naming} onClick={() => setNaming((v) => !v)} className={btnSecondary}>
          Сохранить фильтр
        </button>
        <button type="button" onClick={clear} className={btnSecondary}>
          Очистить
        </button>
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
  );
}

export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: JournalUrlState) => void;
  onClose: () => void;
  /** Сохраняет черновик как именованный фильтр; при успехе окно применяет черновик и закрывается. */
  onSave: (draft: JournalUrlState, name: string) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title="Фильтр" onClose={props.onClose}>
      <FilterForm
        state={props.state}
        data={props.data}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
        onCancel={props.onClose}
        onSave={props.onSave}
      />
    </Modal>
  );
}
```

`src/client/pages/JournalPage.tsx` — замените файл целиком:

```ts
import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSmall } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { api } from '../lib/api';
import {
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  savedFilterFromState,
  stateFromSavedFilter,
  type JournalUrlState,
} from '../lib/journal-filter';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useSavedFilters, useTags, type CategoryTree } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}

/** Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка. */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const meta = useMeta();
  const prefs = usePreferences();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseJournalSearch(params), [params]);
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const journal = useJournal(company.id, today ? journalApiParams(state, today).toString() : null);
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  const savedFilters = useSavedFilters(company.id);
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties, tags];
  if (!journal.data || !lookups || !tags.data || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);
  const conditions = filterConditionCount(state);
  const saveFilter = async (draft: JournalUrlState, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(draft, today) } });
    await queryClient.invalidateQueries({ queryKey: ['saved-filters', company.id] });
  };

  return (
    <section>
      <StaleNotice queries={queries} />
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        actions={
          <>
            <button type="button" aria-haspopup="dialog" onClick={() => setFilterOpen(true)} className={btnSmall}>
              Фильтр{conditions > 0 && ` · ${conditions}`}
            </button>
            <SavedFiltersMenu
              companyId={company.id}
              filters={savedFilters.data}
              onApply={(f) => {
                update(stateFromSavedFilter(f.filter, state));
                setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
              }}
            />
            <ColumnsPicker visible={columns} />
          </>
        }
      />
      <FilterDialog
        open={filterOpen}
        state={state}
        data={{ accounts: accounts.data!, categories: categories.data!, projects: projects.data!, counterparties: counterparties.data!, tags: tags.data }}
        onApply={update}
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
      {items.length === 0 ? (
        <p className="py-8 text-center text-muted">{isFiltered(state) ? 'По этому фильтру операций нет.' : 'Операций пока нет.'}</p>
      ) : (
        <JournalTable
          items={items}
          columns={columns}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          projectFilter={state.projectIds}
          sort={state.sort}
          order={state.order}
          onSort={(sort, order) => update({ ...state, sort, order })}
          busy={journal.isPlaceholderData}
        />
      )}
      <LoadMore hasNext={journal.hasNextPage} loading={journal.isFetchingNextPage} onLoad={() => void journal.fetchNextPage()} />
    </section>
  );
}
```

У кнопки пункта меню доступное имя «Применить фильтр «…»» (с числом недоступных условий): видимое название входит в него (WCAG 2.5.3), а кнопки «Переименовать…» и «Удалить…» не совпадают с ним по подстроке.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-saved-filter.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-filter.ts src/client/lib/queries.ts src/client/components/journal/SavedFiltersMenu.tsx src/client/components/journal/FilterDialog.tsx src/client/pages/JournalPage.tsx tests/client/journal-saved-filter.test.ts e2e/journal-actions.spec.ts
git commit -m "feat: сохранённые фильтры журнала — сохранить, применить, переименовать, удалить; предупреждение о недоступных условиях

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: «Указать» — список с поиском, оптимистичное сохранение с версией, откат и 409

**Files:**
- Create: `src/client/lib/journal-assign.ts`, `src/client/lib/journal-mutations.ts`, `src/client/components/SearchPicker.tsx`, `src/client/components/journal/AssignPicker.tsx`, `tests/client/journal-assign.test.ts`
- Modify: `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `JournalItem`, `JournalPageData`, `CategoryNode`, `CategoryTree`, `Counterparty`, `Project` (`queries.ts`); `Popover` (план 5b); `matchesQuery` (`src/shared/search.ts`); `api`, `ApiError`; `queryClient`; `JournalTable` (план 5b); `PATCH /operations/:id` (план 4a; 409 `VERSION_CONFLICT`).
- Produces:
  - `journal-assign.ts`: `type AssignField = 'counterparty' | 'category' | 'project'`, `ASSIGN_LABELS` («Указать контрагента», «Указать статью», «Указать проект»), `AssignTarget`, `canAssign(item, field): boolean`, `interface AssignPatch`, `assignPatch(item, field, id): AssignPatch`, `withAssigned(item, field, id)`;
  - `journal-mutations.ts`: `invalidateOperations(companyId): Promise<void>`, `operationErrorText(e: unknown): string`, `useAssign(companyId, onError: (message: string) => void)` — мутация `{ item, field, id }`;
  - `SearchPicker(props: { label; ariaLabel?; listLabel; options: PickerOption[]; onPick: (id: number) => void; buttonClassName?; align? })`, `interface PickerOption { id: number; label: string }` — поле поиска `combobox` с именем «{listLabel}: поиск», список `listbox` с именем listLabel;
  - `AssignPicker({ item, field, data, onPick })`, `interface AssignData { categories; projects; counterparties }`, `categoryPickerOptions(nodes): PickerOption[]`;
  - `JournalTable`: свойство `renderAssign?: (item, field) => ReactNode` — вызывается только там, где `canAssign`.

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-assign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assignPatch, canAssign, withAssigned, type AssignTarget } from '../../src/client/lib/journal-assign';

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
});
```

`e2e/journal-actions.spec.ts` — допишите в конец файла:

```ts
test('«Указать»: список с поиском и клавиатурой, значение сохраняется сразу; конфликт версии — откат и сообщение', async ({ page }) => {
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
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(3), accountId: kaspi, amount: 100, comment: 'операция A' })).operation;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: minutesAgo(2),
    accountId: kaspi,
    amount: 300,
    comment: 'операция B',
    lines: [
      { projectId: club, amount: 100 },
      { amount: 200 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: minutesAgo(1), accountId: kaspi, toAccountId: cash, amount: 50, comment: 'операция C' });
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
  await search.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(row('A')).toContainText('Бар');
  await expect(row('A').getByRole('button', { name: 'Указать статью' })).toHaveCount(0);

  // Esc закрывает список, фокус — на кнопке
  await row('A').getByRole('button', { name: 'Указать проект' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Проекты' })).toHaveCount(0);
  await expect(row('A').getByRole('button', { name: 'Указать проект' })).toBeFocused();

  // проект переводу без строк — мышью
  await row('C').getByRole('button', { name: 'Указать проект' }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
  await expect(row('C')).toContainText('Клуб 1');

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

/** Текст ошибки записи для пользователя: на конфликт версии — что журнал обновлён и можно повторить. */
export function operationErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  if (e.status === 409) return `${e.message}. Журнал обновлён — проверьте и повторите.`;
  return e.message;
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
    <Popover label={props.label} ariaLabel={props.ariaLabel} buttonClassName={props.buttonClassName} align={props.align} panelClassName="w-72">
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

`src/client/components/journal/JournalTable.tsx` — замените файл целиком:

```ts
import type { MouseEvent, ReactNode } from 'react';
import { formatMoney } from '../../../shared/money';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { dayLabel, dayOf, lineDimension, projectShare, signedMoney, splitLabel, timeLabel } from '../../lib/journal-format';
import type { Account, JournalItem } from '../../lib/queries';
import { SplitHint } from './SplitHint';

/** Названия справочников для ячеек журнала (архивные тоже: операции на них ссылаются). */
export interface JournalLookups {
  accounts: Map<number, Account>;
  categories: Map<number, string>;
  projects: Map<number, string>;
  counterparties: Map<number, string>;
}

export interface JournalTableProps {
  items: JournalItem[];
  columns: readonly JournalColumnId[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  /** Выбранные в фильтре проекты: у разбитых операций под суммой — «доля проекта». */
  projectFilter: readonly number[];
  sort: JournalSortKey;
  order: JournalSortOrder;
  onSort: (sort: JournalSortKey, order: JournalSortOrder) => void;
  busy: boolean;
  /**
   * Точка подключения формы операции (шаг 6): клик по строке открывает операцию. Пока не передаётся —
   * строка не реагирует на клик.
   */
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке (§7): вызывается только там, где оно разрешено (canAssign). */
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
}

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-top';

function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort'] }) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={thClass} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => props.onSort(props.column, next)} className="inline-flex items-center gap-1 rounded hover:text-ink">
        {props.label}
        <span aria-hidden="true">{active ? (props.order === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function lineHint(item: JournalItem, lookups: JournalLookups, currency: string): string[] {
  return item.lines.map((l) => {
    const category = l.categoryId === null ? 'без статьи' : (lookups.categories.get(l.categoryId) ?? '…');
    const project = l.projectId === null ? 'без проекта' : (lookups.projects.get(l.projectId) ?? '…');
    return `${category} · ${project} — ${formatMoney(l.amount, currency)}`;
  });
}

/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : (names.get(d.id) ?? '…');
}

function AccountLine({ account, balance }: { account: Account | undefined; balance: number | null }) {
  return (
    <span className="block">
      <span className="block truncate">{account?.name ?? '…'}</span>
      {account && balance !== null && (
        <span className={`block text-xs tabular-nums ${balance < 0 ? 'text-expense' : 'text-muted'}`}>остаток {formatMoney(balance, account.currency)}</span>
      )}
    </span>
  );
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));

  const onRowClick = (item: JournalItem) => (e: MouseEvent<HTMLTableRowElement>) => {
    // клики по кнопкам, ссылкам и флажкам внутри строки — не открытие операции
    if ((e.target as HTMLElement).closest('button, a, input, label, [tabindex]')) return;
    props.onOpenOperation?.(item);
  };

  return (
    <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full min-w-[56rem] border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Операции</caption>
        <thead>
          <tr className="border-b border-field">
            {shown.map((c) =>
              c.id === 'date' || c.id === 'amount' ? (
                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} />
              ) : (
                <th key={c.id} scope="col" className={thClass}>
                  {c.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => {
            const account = lookups.accounts.get(item.accountId);
            const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
            const currency = account?.currency ?? props.baseCurrency;
            const hint = lineHint(item, lookups, currency);
            const share = projectShare(item.lines, props.projectFilter);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const cells: Record<JournalColumnId, ReactNode> = {
              date: (
                <time dateTime={item.paidAt} className="whitespace-nowrap">
                  {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                  <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                </time>
              ),
              amount: (
                <span className="block whitespace-nowrap tabular-nums">
                  <span className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {signedMoney(item.type, item.amount, currency)}
                  </span>
                  {item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null && (
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency)}</span>
                  )}
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency)}</span>}
                </span>
              ),
              account: (
                <>
                  <AccountLine account={account} balance={item.balanceAfter} />
                  {item.type === 'transfer' && (
                    <span className="mt-1 flex gap-1">
                      <span aria-hidden="true" className="text-muted">
                        →
                      </span>
                      <AccountLine account={toAccount} balance={item.toBalanceAfter} />
                    </span>
                  )}
                </>
              ),
              counterparty: item.counterpartyId === null ? assign('counterparty') : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint, assign('category')),
              project: dimensionCell(item, 'projectId', lookups.projects, hint, assign('project')),
              comment: item.comment && (
                <span className="line-clamp-2 max-w-xs break-words" title={item.comment}>
                  {item.comment}
                </span>
              ),
            };
            return (
              <tr
                key={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field last:border-0 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''}`}
              >
                {shown.map((c) => (
                  <td key={c.id} className={tdClass}>
                    {cells[c.id]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`src/client/pages/JournalPage.tsx` — замените файл целиком:

```ts
import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { AssignPicker } from '../components/journal/AssignPicker';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSmall } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { api } from '../lib/api';
import {
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  savedFilterFromState,
  stateFromSavedFilter,
  type JournalUrlState,
} from '../lib/journal-filter';
import { useAssign } from '../lib/journal-mutations';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useSavedFilters, useTags, type CategoryTree } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}

/** Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка. */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const meta = useMeta();
  const prefs = usePreferences();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseJournalSearch(params), [params]);
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const journal = useJournal(company.id, today ? journalApiParams(state, today).toString() : null);
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  const savedFilters = useSavedFilters(company.id);
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);
  // ошибка «Указать» (конфликт версии, архив) — над таблицей, пока её не скроют или не начнут новое действие
  const [actionError, setActionError] = useState<string | null>(null);
  const assign = useAssign(company.id, setActionError);

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties, tags];
  if (!journal.data || !lookups || !tags.data || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);
  const conditions = filterConditionCount(state);
  const saveFilter = async (draft: JournalUrlState, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(draft, today) } });
    await queryClient.invalidateQueries({ queryKey: ['saved-filters', company.id] });
  };

  return (
    <section>
      <StaleNotice queries={queries} />
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        actions={
          <>
            <button type="button" aria-haspopup="dialog" onClick={() => setFilterOpen(true)} className={btnSmall}>
              Фильтр{conditions > 0 && ` · ${conditions}`}
            </button>
            <SavedFiltersMenu
              companyId={company.id}
              filters={savedFilters.data}
              onApply={(f) => {
                update(stateFromSavedFilter(f.filter, state));
                setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
              }}
            />
            <ColumnsPicker visible={columns} />
          </>
        }
      />
      <FilterDialog
        open={filterOpen}
        state={state}
        data={{ accounts: accounts.data!, categories: categories.data!, projects: projects.data!, counterparties: counterparties.data!, tags: tags.data }}
        onApply={update}
        onClose={() => setFilterOpen(false)}
        onSave={saveFilter}
      />
      {actionError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {items.length === 0 ? (
        <p className="py-8 text-center text-muted">{isFiltered(state) ? 'По этому фильтру операций нет.' : 'Операций пока нет.'}</p>
      ) : (
        <JournalTable
          items={items}
          columns={columns}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          projectFilter={state.projectIds}
          sort={state.sort}
          order={state.order}
          onSort={(sort, order) => update({ ...state, sort, order })}
          busy={journal.isPlaceholderData}
          renderAssign={(item, field) => (
            <AssignPicker
              item={item}
              field={field}
              data={{ categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! }}
              onPick={(id) => {
                setActionError(null);
                assign.mutate({ item, field, id });
              }}
            />
          )}
        />
      )}
      <LoadMore hasNext={journal.hasNextPage} loading={journal.isFetchingNextPage} onLoad={() => void journal.fetchNextPage()} />
    </section>
  );
}
```

Почему так: снимок `getQueriesData` берётся до оптимистичной правки и возвращается при ошибке; `cancelQueries` не даёт идущему запросу журнала затереть оптимистичное значение. `onSettled` сбрасывает журнал, счета и компании и при успехе, и при ошибке — после 409 строка приходит с новой версией, и повтор проходит.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-assign.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-assign.ts src/client/lib/journal-mutations.ts src/client/components/SearchPicker.tsx src/client/components/journal/AssignPicker.tsx src/client/components/journal/JournalTable.tsx src/client/pages/JournalPage.tsx tests/client/journal-assign.test.ts e2e/journal-actions.spec.ts
git commit -m "feat: «Указать» в журнале — список с поиском, оптимистичное сохранение с версией, откат при ошибке и конфликте

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Массовые действия, итог с причинами и «Удалено N — Отменить»

**Files:**
- Create: `src/client/lib/journal-bulk.ts`, `src/client/components/journal/BulkBar.tsx`, `src/client/components/journal/UndoToast.tsx`, `tests/client/journal-bulk.test.ts`
- Modify: `src/client/lib/journal-mutations.ts`, `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/journal-actions.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `invalidateOperations`, `operationErrorText` (задача 2); `SearchPicker`, `categoryPickerOptions`, `AssignData` (задача 2); `dayLabel`, `dayOf`, `timeLabel`, `signedMoney` (план 5b); `POST …/operations/bulk` (план 5a).
- Produces:
  - `journal-bulk.ts`: `BULK_MAX = 500`, `type BulkAction` (`{ action: 'setCategory'; categoryId } | { action: 'setProject'; projectId } | { action: 'setCounterparty'; counterpartyId } | { action: 'delete' } | { action: 'restore' }`), `interface BulkResult { changed: number[]; skipped: { id: number; reason: string }[] }`, `bulkSummary(action, result): { text: string; reasons: { reason: string; count: number }[] }`;
  - `journal-mutations.ts`: `runBulk(companyId, ids, action): Promise<BulkResult>`;
  - `BulkBar({ count, data, pending, onRun, onClear })` — `role="region"` «Действия с выбранными»: «Выбрано: N», «Статья», «Проект», «Контрагент», «Удалить» (подтверждение «Да, удалить» / «Отмена»), «Снять выделение»;
  - `UndoToast({ toast, pending, onUndo, onClose, focusAfter })`, `UNDO_TOAST_MS = 10_000`;
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

`e2e/journal-actions.spec.ts` — после строки

```ts
const bodyRows = (page: Page) => table(page).locator('tbody tr');
```

добавьте

```ts
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
```

и допишите в конец файла:

```ts
test('массовые действия: статья с итогом и причинами, проект, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Массовые ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const club2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minutesAgo(5), accountId: kaspi, amount: 1000, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minutesAgo(4), accountId: kaspi, amount: 2000, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: minutesAgo(3),
    accountId: kaspi,
    amount: 3000,
    comment: 'операция C',
    lines: [
      { projectId: club, amount: 1000 },
      { projectId: club2, amount: 2000 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(2), accountId: kaspi, amount: 4000, comment: 'операция D' });
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
});
```

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" e2e/journal-actions.spec.ts`
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

/** Итог массового действия (§7): «Статья: изменено 3, пропущено 2» и причины пропуска с числом операций. */
export function bulkSummary(action: BulkAction['action'], r: BulkResult): { text: string; reasons: { reason: string; count: number }[] } {
  const counts = new Map<string, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return {
    text: `${TITLES[action]}: изменено ${r.changed.length}, пропущено ${r.skipped.length}`,
    reasons: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}
```

`src/client/lib/journal-mutations.ts` — после строки `import { assignPatch, withAssigned, type AssignField } from './journal-assign';` добавьте:

```ts
import type { BulkAction, BulkResult } from './journal-bulk';
```

и допишите в конец файла:

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

`src/client/components/journal/BulkBar.tsx`:

```ts
import { useState } from 'react';
import { BULK_MAX, type BulkAction } from '../../lib/journal-bulk';
import { SearchPicker } from '../SearchPicker';
import { btnDanger, btnSecondary, btnSmall } from '../ui';
import { categoryPickerOptions, type AssignData } from './AssignPicker';

/**
 * Массовые действия с выбранными строками (§7): «Статья», «Проект», «Контрагент» (только назначают значение),
 * «Удалить» с подтверждением. Не больше BULK_MAX операций за раз.
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
          />
          <SearchPicker
            label="Проект"
            listLabel="Проекты"
            options={props.data.projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
            onPick={(projectId) => props.onRun({ action: 'setProject', projectId })}
            buttonClassName={pickerClass}
          />
          <SearchPicker
            label="Контрагент"
            listLabel="Контрагенты"
            options={props.data.counterparties.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }))}
            onPick={(counterpartyId) => props.onRun({ action: 'setCounterparty', counterpartyId })}
            buttonClassName={pickerClass}
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

`src/client/components/journal/JournalTable.tsx` — замените файл целиком:

```ts
import type { MouseEvent, ReactNode } from 'react';
import { formatMoney } from '../../../shared/money';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { dayLabel, dayOf, lineDimension, projectShare, signedMoney, splitLabel, timeLabel } from '../../lib/journal-format';
import type { Account, JournalItem } from '../../lib/queries';
import { SplitHint } from './SplitHint';

/** Названия справочников для ячеек журнала (архивные тоже: операции на них ссылаются). */
export interface JournalLookups {
  accounts: Map<number, Account>;
  categories: Map<number, string>;
  projects: Map<number, string>;
  counterparties: Map<number, string>;
}

export interface JournalTableProps {
  items: JournalItem[];
  columns: readonly JournalColumnId[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  /** Выбранные в фильтре проекты: у разбитых операций под суммой — «доля проекта». */
  projectFilter: readonly number[];
  sort: JournalSortKey;
  order: JournalSortOrder;
  onSort: (sort: JournalSortKey, order: JournalSortOrder) => void;
  busy: boolean;
  /**
   * Точка подключения формы операции (шаг 6): клик по строке открывает операцию. Пока не передаётся —
   * строка не реагирует на клик.
   */
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке (§7): вызывается только там, где оно разрешено (canAssign). */
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
  /** Выделение строк для массовых действий: колонка флажков слева. */
  selection?: {
    selected: ReadonlySet<number>;
    onToggle: (id: number) => void;
    onToggleAll: (select: boolean) => void;
  };
}

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-top';

function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort'] }) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={thClass} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => props.onSort(props.column, next)} className="inline-flex items-center gap-1 rounded hover:text-ink">
        {props.label}
        <span aria-hidden="true">{active ? (props.order === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function lineHint(item: JournalItem, lookups: JournalLookups, currency: string): string[] {
  return item.lines.map((l) => {
    const category = l.categoryId === null ? 'без статьи' : (lookups.categories.get(l.categoryId) ?? '…');
    const project = l.projectId === null ? 'без проекта' : (lookups.projects.get(l.projectId) ?? '…');
    return `${category} · ${project} — ${formatMoney(l.amount, currency)}`;
  });
}

/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : (names.get(d.id) ?? '…');
}

function AccountLine({ account, balance }: { account: Account | undefined; balance: number | null }) {
  return (
    <span className="block">
      <span className="block truncate">{account?.name ?? '…'}</span>
      {account && balance !== null && (
        <span className={`block text-xs tabular-nums ${balance < 0 ? 'text-expense' : 'text-muted'}`}>остаток {formatMoney(balance, account.currency)}</span>
      )}
    </span>
  );
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
  const selectedCount = selection ? props.items.filter((i) => selection.selected.has(i.id)).length : 0;
  const allSelected = props.items.length > 0 && selectedCount === props.items.length;

  const onRowClick = (item: JournalItem) => (e: MouseEvent<HTMLTableRowElement>) => {
    // клики по кнопкам, ссылкам и флажкам внутри строки — не открытие операции
    if ((e.target as HTMLElement).closest('button, a, input, label, [tabindex]')) return;
    props.onOpenOperation?.(item);
  };

  return (
    <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full min-w-[56rem] border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Операции</caption>
        <thead>
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
              c.id === 'date' || c.id === 'amount' ? (
                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} />
              ) : (
                <th key={c.id} scope="col" className={thClass}>
                  {c.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => {
            const account = lookups.accounts.get(item.accountId);
            const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
            const currency = account?.currency ?? props.baseCurrency;
            const hint = lineHint(item, lookups, currency);
            const share = projectShare(item.lines, props.projectFilter);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const cells: Record<JournalColumnId, ReactNode> = {
              date: (
                <time dateTime={item.paidAt} className="whitespace-nowrap">
                  {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                  <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                </time>
              ),
              amount: (
                <span className="block whitespace-nowrap tabular-nums">
                  <span className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {signedMoney(item.type, item.amount, currency)}
                  </span>
                  {item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null && (
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency)}</span>
                  )}
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency)}</span>}
                </span>
              ),
              account: (
                <>
                  <AccountLine account={account} balance={item.balanceAfter} />
                  {item.type === 'transfer' && (
                    <span className="mt-1 flex gap-1">
                      <span aria-hidden="true" className="text-muted">
                        →
                      </span>
                      <AccountLine account={toAccount} balance={item.toBalanceAfter} />
                    </span>
                  )}
                </>
              ),
              counterparty: item.counterpartyId === null ? assign('counterparty') : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint, assign('category')),
              project: dimensionCell(item, 'projectId', lookups.projects, hint, assign('project')),
              comment: item.comment && (
                <span className="line-clamp-2 max-w-xs break-words" title={item.comment}>
                  {item.comment}
                </span>
              ),
            };
            return (
              <tr
                key={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field last:border-0 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''} ${selection?.selected.has(item.id) ? 'bg-income-soft/40' : ''}`}
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
                {shown.map((c) => (
                  <td key={c.id} className={tdClass}>
                    {cells[c.id]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`src/client/pages/JournalPage.tsx` — замените файл целиком:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { AssignPicker } from '../components/journal/AssignPicker';
import { BulkBar } from '../components/journal/BulkBar';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
import { UndoToast } from '../components/journal/UndoToast';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSmall } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { api } from '../lib/api';
import {
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  savedFilterFromState,
  stateFromSavedFilter,
  type JournalUrlState,
} from '../lib/journal-filter';
import { bulkSummary, type BulkAction } from '../lib/journal-bulk';
import { operationErrorText, runBulk, useAssign } from '../lib/journal-mutations';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useSavedFilters, useTags, type CategoryTree } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}

/** Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка. */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const meta = useMeta();
  const prefs = usePreferences();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseJournalSearch(params), [params]);
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const journal = useJournal(company.id, today ? journalApiParams(state, today).toString() : null);
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  const savedFilters = useSavedFilters(company.id);
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);
  // ошибка «Указать» (конфликт версии, архив) — над таблицей, пока её не скроют или не начнут новое действие
  const [actionError, setActionError] = useState<string | null>(null);
  const assign = useAssign(company.id, setActionError);
  // массовые действия: выделение (только загруженные строки), итог, тост отмены удаления
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [summary, setSummary] = useState<ReturnType<typeof bulkSummary> | null>(null);
  const [toast, setToast] = useState<{ key: number; count: number; ids: number[] } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const filterKey = params.toString();
  // другой фильтр или другая компания — выделение снимается
  useEffect(() => setSelected(new Set()), [filterKey, company.id]);

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties, tags];
  if (!journal.data || !lookups || !tags.data || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);
  const conditions = filterConditionCount(state);
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const run = async (action: BulkAction, ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    try {
      const result = await runBulk(company.id, ids, action);
      setSummary(bulkSummary(action.action, result));
      if (action.action === 'delete') {
        setSelected(new Set());
        if (result.changed.length > 0) setToast({ key: Date.now(), count: result.changed.length, ids: result.changed });
      }
    } catch (e) {
      setActionError(operationErrorText(e));
    } finally {
      setBulkPending(false);
    }
  };
  const assignData = { categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! };
  const saveFilter = async (draft: JournalUrlState, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(draft, today) } });
    await queryClient.invalidateQueries({ queryKey: ['saved-filters', company.id] });
  };

  return (
    <section>
      <StaleNotice queries={queries} />
      <h1 ref={headingRef} tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        actions={
          <>
            <button type="button" aria-haspopup="dialog" onClick={() => setFilterOpen(true)} className={btnSmall}>
              Фильтр{conditions > 0 && ` · ${conditions}`}
            </button>
            <SavedFiltersMenu
              companyId={company.id}
              filters={savedFilters.data}
              onApply={(f) => {
                update(stateFromSavedFilter(f.filter, state));
                setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
              }}
            />
            <ColumnsPicker visible={columns} />
          </>
        }
      />
      <FilterDialog
        open={filterOpen}
        state={state}
        data={{ accounts: accounts.data!, categories: categories.data!, projects: projects.data!, counterparties: counterparties.data!, tags: tags.data }}
        onApply={update}
        onClose={() => setFilterOpen(false)}
        onSave={saveFilter}
      />
      {actionError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {summary && (
        <div role="status" className="mb-4 rounded-xl bg-field px-4 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">{summary.text}</span>
            <button type="button" onClick={() => setSummary(null)} className="font-semibold underline">
              Скрыть
            </button>
          </div>
          {summary.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {summary.reasons.map((r) => (
                <li key={r.reason}>
                  {r.reason} — {r.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {selectedIds.length > 0 && (
        <BulkBar count={selectedIds.length} data={assignData} pending={bulkPending} onRun={(action) => void run(action, selectedIds)} onClear={() => setSelected(new Set())} />
      )}
      {items.length === 0 ? (
        <p className="py-8 text-center text-muted">{isFiltered(state) ? 'По этому фильтру операций нет.' : 'Операций пока нет.'}</p>
      ) : (
        <JournalTable
          items={items}
          columns={columns}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          projectFilter={state.projectIds}
          sort={state.sort}
          order={state.order}
          onSort={(sort, order) => update({ ...state, sort, order })}
          busy={journal.isPlaceholderData}
          renderAssign={(item, field) => (
            <AssignPicker
              item={item}
              field={field}
              data={assignData}
              onPick={(id) => {
                setActionError(null);
                assign.mutate({ item, field, id });
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
      )}
      <LoadMore hasNext={journal.hasNextPage} loading={journal.isFetchingNextPage} onLoad={() => void journal.fetchNextPage()} />
      <UndoToast
        toast={toast}
        pending={bulkPending}
        onUndo={() => {
          const ids = toast?.ids ?? [];
          setToast(null);
          void run({ action: 'restore' }, ids);
        }}
        onClose={() => setToast(null)}
        focusAfter={() => headingRef.current}
      />
    </section>
  );
}
```

`README.md`:

1. Замените строку `Сделаны шаги 1–4 этапа 1 и серверная часть шага 5 (§11 спецификации):` на `Сделаны шаги 1–5 этапа 1 (§11 спецификации):`.
2. В списке «**Экран журнала (шаг 5):**» после строки `  - фильтр хранится в адресе страницы; клик по счёту в левой панели фильтрует журнал.` добавьте строку:

```
  - сохранённые фильтры, «Указать» в пустой ячейке, массовые действия с итогом и «Отменить» после удаления.
```

3. Замените строку `Пока нет (следующие шаги): сохранённые фильтры, «Указать» и массовые действия на экране журнала, форма операции, отчёты, мобильная версия и PWA.` на `Пока нет (следующие шаги): форма операции в интерфейсе, отчёты, мобильная версия и PWA.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-bulk.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (два прогона e2e подряд — тост и фокус не должны давать нестабильности).

```bash
git add src/client/lib/journal-bulk.ts src/client/lib/journal-mutations.ts src/client/components/journal/BulkBar.tsx src/client/components/journal/UndoToast.tsx src/client/components/journal/JournalTable.tsx src/client/pages/JournalPage.tsx tests/client/journal-bulk.test.ts e2e/journal-actions.spec.ts README.md
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

Вне этого плана: форма операции и клик по строке (шаг 6 — подключается через `onOpenOperation` таблицы и `invalidateOperations`); мобильная версия журнала (шаг 7).
