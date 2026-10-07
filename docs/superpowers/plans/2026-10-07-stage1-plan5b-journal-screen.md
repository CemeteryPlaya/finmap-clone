# Этап 1, план 5b: журнал — экран (таблица, тулбар, окно «Фильтр», колонки) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина интерфейса шага 5 §11 спецификации — экран журнала `/c/:cid/log` вместо заглушки `JournalPage`:
- таблица с колонками §7: дата («сегодня», «вчера»), сумма с цветом по типу и в базовой валюте, счёт и остаток после операции (у перевода — оба), контрагент, статья, проект, комментарий; у разбитых операций — «2 статьи», «3 проекта» с подсказкой и «доля проекта» при фильтре по проекту;
- бесконечная прокрутка (`useInfiniteQuery` + IntersectionObserver), сортировка по дате и сумме;
- фильтр в адресной строке: `?account=<id>` из левой панели работает (решение 3 плана 4b), перезагрузка сохраняет фильтр;
- тулбар: период (все время, сегодня, вчера, текущая и прошлая неделя, текущий и прошлый месяц, текущий год, произвольно) в APP_TIMEZONE, поиск с паузой, сумма от/до в базовой валюте, выгрузка в Excel по текущему фильтру, сброс;
- окно «Фильтр» со всеми условиями §6 и «Готово»;
- выбор видимых колонок, сохраняется в `user_preferences` под ключом `journal.columns`.

Сохранённые фильтры, «Указать», массовые действия и тост «Удалено N — Отменить» — план 5c. Форма операции — шаг 6, мобильная версия — шаг 7.

**Предусловие:** выполнен план 5a — `GET /api/v1/companies/:cid/operations` (фильтр, курсор, `balanceAfter`/`toBalanceAfter`, `attachmentCount`), `GET …/operations/export.xlsx`, `POST …/operations/bulk`, `…/saved-filters`.

**Architecture:**
- **Фильтр живёт в адресной строке.** Чистые функции `src/client/lib/journal-filter.ts` переводят `URLSearchParams` ↔ `JournalUrlState` ↔ параметры API плана 5a. Ключи адреса короткие и человеческие (`account`, `category`, `period=month`, `min`), ключи API — как в `journalQuerySchema` (`accountIds`, `from`/`to`, `amountMin`). Относительный период хранится ключом (`period=month`) и пересчитывается от «сегодня» в APP_TIMEZONE (`useMeta().timezone`) при каждом показе.
- **Данные:** `useJournal(cid, params)` — `useInfiniteQuery` с ключом `['journal', cid, params]` и курсором `nextCursor`; при смене фильтра прежние строки остаются на экране до ответа (`placeholderData`), таблица помечается `aria-busy`. Названия справочников берутся из уже существующих запросов (`useAccounts`, `useCategories`, `useProjects`, `useCounterparties`, `useTags`).
- **Компоненты** в `src/client/components/journal/`: `JournalTable` (настоящая `<table>` с подписью и заголовками, сортировка — кнопки в `<th aria-sort>`), `LoadMore` (наблюдатель + кнопка «Показать ещё»), `SplitHint` (подсказка по наведению и фокусу), `JournalToolbar`, `ColumnsPicker`, `FilterDialog`. Общие: `Popover` (панель у кнопки — немодальный `role="dialog"`: Esc, клик мимо, возврат фокуса) и `Modal` (`<dialog>` с `showModal()`: фокус внутри, Esc, возврат фокуса).
- **Всплывающие элементы — поверх страницы.** Панели `Popover` и подсказки `SplitHint` рисуются порталом в `body` с `position: fixed`; место считает чистая функция `placeFloating`, хук `useFloating` пересчитывает его при прокрутке и изменении окна. Обёртка таблицы с `overflow-x: auto` (она обрезает и по вертикали) их не обрезает.
- **Экран компании — с `key`.** Маршрут не пересоздаёт `JournalPage` при смене `:companyId`, поэтому страница рендерит `<JournalScreen key={company.id} />`: окно «Фильтр», выделение и сообщения одной компании не переходят в другую.
- **Точка подключения шага 6:** свойство `onOpenOperation?: (item: JournalItem) => void` у `JournalTable`. Пока его не передают — клик по строке ничего не делает. Шаг 6 передаст обработчик, который открывает форму операции, и после сохранения вызовет `invalidateOperations(cid)` (появится в плане 5c).

**Tech Stack:** как в планах 1–5a: React 19, react-router 8, TanStack Query 5, Tailwind 4, Playwright. TanStack Table и React Hook Form не установлены — новых пакетов нет, таблица и формы — обычный JSX.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §2 (APP_TIMEZONE), §4.2 (`user_preferences`: видимые колонки журнала), §4.7 (остаток после операции), §6 («Фильтр журнала», решения 2026-10-07), §6.1 (поиск без учёта регистра и «ё»), §7 (Каркас: клик по счёту фильтрует журнал; Журнал: тулбар, колонки, разбитые операции, бесконечная прокрутка, сортировка), §10 (E2E, сценарий 3), §11 шаг 5.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§7, блок «Решения планирования от 2026-10-07 (планы 5b и 5c)») тем же коммитом, что и план.

1. **Ключи адресной строки:** `period` (ключ периода; у «Произвольно» — `from`/`to`), `q`, `min`/`max` (минимальные единицы базовой валюты), `type`, `account`, `category`, `project`, `counterparty`, `tag` (повтором ключа), `noCategory`, `noProject`, `noCounterparty` (`=1`), `sort`, `order`. Значения по умолчанию в адрес не пишутся. Неверные значения (ручная правка адреса) отбрасываются, перепутанные границы меняются местами — журнал не падает и не получает 400.
2. **Неделя — с понедельника.** «Текущая неделя», «текущий месяц», «текущий год» — полные календарные периоды (конец может быть в будущем — сервер это принимает). При выборе «Произвольно» даты начинаются с границ выбранного до этого периода.
3. **Колонки:** настройка `journal.columns` — массив id видимых колонок (`date`, `amount`, `account`, `counterparty`, `category`, `project`, `comment`). Дату и сумму скрыть нельзя (по ним сортируют). Нет настройки или она испорчена — видны все.
4. **Название измерения — «Статья»**, как в настройках, окне «Фильтр» и сообщениях сервера («Без статьи», «Статья расходов не подходит…»). «N категорий» спецификации — «2 статьи», «5 статей»; «N проектов» — «2 проекта». N — число разных значений в строках («не указано» тоже значение); если значение у всех строк одно, показывается оно. Подсказка перечисляет строки: «Аренда · Клуб 1 — 100,00 ₸».
5. **«Доля проекта: X»** — только у разбитых операций (у неразбитой она равна сумме) и только при фильтре по проекту; X — сумма строк выбранных проектов в валюте счёта.
6. **Сумма:** доход «+1 500,00 ₸» зелёным, расход «-1 500,00 ₸» коралловым, перевод «⇄ 1 500,00 ₸» серым, при разных валютах ниже «→ 1,00 $». Если валюта счёта не базовая, ниже — сумма в базовой валюте (`baseAmount`).
7. **Поиск** уходит в адрес через 300 мс после последнего ввода (Enter — сразу); «Сбросить фильтр» отменяет ещё не отправленный поиск. Сумма от/до и даты «Произвольно» применяются по Enter или уходу из поля (пока год набирают по цифре, промежуточные даты не уходят в адрес); неверный ввод подсвечивается и не применяется. Списки из адреса обрезаются до 200 значений — как у сервера (`JOURNAL_LIST_MAX`).
8. **Выгрузка в Excel** — обычная ссылка `<a download>` на `…/operations/export.xlsx?<параметры API>`: GET без побочных эффектов, заголовок `X-Requested-With` не нужен (в отличие от `/backup/download`).
9. **Окно «Фильтр»** показывает тип, счета, статьи (дерево, родительская включает дочерние), проекты, контрагентов (с поиском), теги и флажки «Без статьи / проекта / контрагента». Период, поиск и сумма — в тулбаре. Архивные элементы не предлагаются, кроме уже выбранных (их можно снять). Изменения — в черновике; «Готово» применяет, Esc и «Отмена» закрывают без изменений.
10. **Всплывающие панели и подсказки — порталом поверх страницы** (`position: fixed`): под кнопкой, а если снизу тесно и сверху места больше — над ней, в пределах окна; длинная панель прокручивается внутри. Так обёртка таблицы не обрезает подсказку разбиения и список «Указать» (план 5c). Подсказка разбиения прячется по Esc и не исчезает, пока на неё наведён указатель (WCAG 1.4.13).
11. **Клик по строке** (шаг 6) не срабатывает только на настоящих элементах управления (кнопки, ссылки, поля, списки); подпись «2 статьи» — не они: по §7 клик по ней открывает форму. У строки `tabIndex={-1}` и `data-operation-id` — на неё план 5c переводит фокус после «Указать».

## Global Constraints

- **Журнал (§7):** тулбар — период (все время, сегодня, вчера, текущая и прошлая неделя, текущий и прошлый месяц, текущий год, произвольно), поиск, сумма от/до (в базовой валюте), «Фильтр» (модалка с полями §6), видимые колонки (`user_preferences`), экспорт в Excel по текущему фильтру. Колонки — дата (дата и время; «сегодня» и «вчера»); сумма (+ зелёным, - красным, перевод нейтральным со стрелкой; если валюта счёта не базовая, вторым рядом — сумма в базовой валюте); счёт и остаток после операции (у перевода оба счёта и оба остатка); контрагент, категория, проект; комментарий. Разбитые операции — «N категорий» / «N проектов» с подсказкой; при фильтре по проекту под суммой «доля проекта: X». Бесконечная прокрутка, сортировка по дате и сумме.
- **Каркас (§7):** клик по счёту в левой панели фильтрует журнал по нему — ссылка `/c/:cid/log?account=<id>` (план 4b).
- **API журнала (план 5a):** `GET /api/v1/companies/:cid/operations?…` → `{ items, nextCursor }`; списки — повтором ключа (`types=income&types=transfer`), флаги — `true`, `amountMin`/`amountMax` — минимальные единицы базовой валюты, `from`/`to` — календарные даты, `sort` (`date` | `amount`), `order` (`asc` | `desc`), `cursor`, `limit` (по умолчанию 50, максимум 200). Элемент — операция со строками (`lines`), `tagIds`, `attachmentCount`, `balanceAfter`, `toBalanceAfter`. Выгрузка — `GET …/operations/export.xlsx` с теми же параметрами без `cursor`/`limit`.
- **Время (§2):** все календарные понятия — «сегодня», «вчера», дата операции, периоды — в APP_TIMEZONE (`useMeta().timezone`), независимо от пояса устройства.
- **Ключи запросов:** журнал — `['journal', cid, params]`; балансы — `['accounts', cid, 'balances']`; сводка — `['companies', 'summary']`; настройки — `['preferences']`.
- **Доступность:** настоящая `<table>` с `<caption>` и `<th scope="col">`; у полей — подписи (`Field`); всплывающие панели и окно управляются с клавиатуры, Esc закрывает и возвращает фокус на кнопку (у кнопки — `aria-haspopup`); подсказка показывается и по фокусу, Esc её прячет; модальное окно — `<dialog>` через `showModal()`.
- **Ширина:** десктоп в приоритете; ниже 768 px ничего не ломается — таблица прокручивается по горизонтали внутри своей обёртки, тулбар переносится (мобильная версия — шаг 7).
- **Без новых npm-пакетов.**
- **E2E:** левая панель `<nav aria-label="Счета">` есть на каждой странице компании — локаторы ограничивайте таблицей (`getByRole('table', { name: 'Операции' })`) или окном; `name:` в Playwright ищет подстроку без учёта регистра (`'Фильтр'` найдёт и «Сбросить фильтр» — используйте `exact: true` или `/^Фильтр/`); данные создавайте через `page.request` с заголовками `origin` и `x-requested-with: fetch`; общую настройку пользователя `admin` возвращайте в `finally`; без фиксированных пауз.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\uXXXX`. Инструмент записи файлов может превратить `\u2212` в сам символ: после записи файлов с такими строками выполните проверку из шага задачи — она падает, если в файле оказался символ вместо экранирования.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Поиск, набранный прямо перед сменой другого условия** (печатает «аренда» и сразу выбирает период): отложенный поиск не должен затереть новый период старым состоянием фильтра — в адресе оба условия. Тест — задача 3 (e2e «тулбар…»).
2. **Адрес, исправленный руками или устаревшая ссылка** (`?account=abc&type=bogus&from=2026-13-01&min=-5&sort=name`): журнал открывается со всеми операциями, без 400 и без «Фильтр · N». Тесты — задача 1 (разбор адреса) и задача 3 (e2e).
3. **Операция около полуночи по Алматы при другом поясе устройства:** «сегодня»/«вчера», время и период считаются в APP_TIMEZONE (23:30 и 00:30 — разные дни). Тест — задача 1 (`dayOf`, `timeLabel`, `periodRange`). E2E-тесты ставят операции «сегодня» и «вчера» по часам Алматы (`todayAgo`, `yesterdayNoon`) и не падают сразу после полуночи.
4. **Валюта счёта не совпадает с базовой; перевод KZT → USD:** сумма в базовой валюте под суммой, у перевода — сумма зачисления, оба счёта и оба остатка, балансы в панели совпадают с остатками. Тесты — задача 2 (сценарий 3 §10) и задача 3.
5. **Испорченная или чужая настройка колонок** (не массив, неизвестные id, пустой массив): видны все колонки или хотя бы дата и сумма; дату и сумму скрыть нельзя; сбой сохранения возвращает прежний выбор. Тесты — задача 1 (`visibleColumns`, `toggleColumn`) и задача 4 (e2e).

---

## Карта файлов

```
src/client/
  lib/journal-filter.ts               # (новый) адрес ↔ фильтр ↔ параметры API, периоды
  lib/journal-format.ts               # (новый) дата, время, знак суммы, «2 статьи», доля проекта
  lib/journal-columns.ts              # (новый) колонки и настройка journal.columns
  lib/floating.ts                     # (новый) место всплывающей панели в окне
  components/useFloating.ts           # (новый) position: fixed у кнопки, пересчёт при прокрутке
  lib/queries.ts                      # + JournalItem, useJournal
  components/Popover.tsx              # (новый) панель у кнопки
  components/Modal.tsx                # (новый) <dialog> с showModal()
  components/journal/JournalTable.tsx # (новый) таблица
  components/journal/SplitHint.tsx    # (новый) подсказка разбиения
  components/journal/LoadMore.tsx     # (новый) бесконечная прокрутка
  components/journal/JournalToolbar.tsx  # (новый) период, поиск, сумма, выгрузка, сброс
  components/journal/ColumnsPicker.tsx   # (новый) видимые колонки
  components/journal/FilterDialog.tsx    # (новый) окно «Фильтр»
  pages/JournalPage.tsx               # экран журнала вместо заглушки
tests/client/{journal,floating}.test.ts   # (новые)
e2e/journal.spec.ts                   # (новый)
README.md
```

---
### Task 1: Чистые функции журнала — адрес ↔ фильтр, периоды, форматирование, колонки

**Files:**
- Create: `src/client/lib/journal-filter.ts`, `src/client/lib/journal-format.ts`, `src/client/lib/journal-columns.ts`, `tests/client/journal.test.ts`

**Interfaces:**
- Consumes: `addDays`, `isValidDate`, `formatDateRu`, `todayInTimezone` (`src/shared/dates.ts`); `formatAmount`, `formatMoney` (`src/shared/money.ts`); `JOURNAL_LIST_MAX` (`src/shared/schemas/journal.ts`, план 5a).
- Produces:
  - `journal-filter.ts`: `PERIODS` (`{ key, label }[]`), `PeriodKey` (`'all' | 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year' | 'custom'`), `OperationType`, `OPERATION_TYPES`, `JournalSortKey`, `JournalSortOrder`, `interface JournalUrlState { period; from?; to?; q?; amountMin?; amountMax?; types; accountIds; categoryIds; projectIds; counterpartyIds; tagIds; withoutCategory; withoutProject; withoutCounterparty; sort; order }`, `EMPTY_JOURNAL_STATE`, `SEARCH_MAX = 200`, `sortedUnique(xs)`, `parseJournalSearch(params: URLSearchParams): JournalUrlState`, `journalSearch(state): URLSearchParams`, `periodRange(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>, today: string): { from?: string; to?: string }`, `journalApiParams(state, today): URLSearchParams`, `filterConditionCount(state): number`, `isFiltered(state): boolean`, `clearFilter(state): JournalUrlState`;
  - `journal-format.ts`: `dayOf(iso, timeZone): string`, `dayLabel(day, today): string`, `timeLabel(iso, timeZone): string`, `pluralRu(n, one, few, many): string`, `splitLabel(count, 'category' | 'project'): string`, `LineLike`, `LineDimension`, `lineDimension(lines, 'categoryId' | 'projectId'): LineDimension`, `projectShare(lines, projectIds): number | null`, `signedMoney(type, minor, currency): string`, `amountInputText(minor, minorUnits): string`;
  - `journal-columns.ts`: `JOURNAL_COLUMNS` (`{ id, label, fixed }[]`), `JournalColumnId`, `JOURNAL_COLUMNS_PREF = 'journal.columns'`, `visibleColumns(pref: unknown): JournalColumnId[]`, `toggleColumn(visible, id): JournalColumnId[]`.

- [ ] **Step 1: Write the failing tests**

`tests/client/journal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toggleColumn, visibleColumns } from '../../src/client/lib/journal-columns';
import {
  clearFilter,
  EMPTY_JOURNAL_STATE,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  periodRange,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';
import {
  amountInputText,
  dayLabel,
  dayOf,
  lineDimension,
  pluralRu,
  projectShare,
  signedMoney,
  splitLabel,
  timeLabel,
} from '../../src/client/lib/journal-format';

const parse = (qs: string) => parseJournalSearch(new URLSearchParams(qs));
const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('periodRange — периоды тулбара от «сегодня» в APP_TIMEZONE', () => {
  it('среда 07.10.2026: сегодня, вчера, неделя с понедельника, месяц, год', () => {
    const today = '2026-10-07';
    const r = (period: JournalUrlState['period']) => periodRange({ period }, today);
    expect(r('all')).toEqual({});
    expect(r('today')).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(r('yesterday')).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    expect(r('week')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(r('lastWeek')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(r('month')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r('lastMonth')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(r('year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange({ period: 'custom', from: '2026-01-05' }, today)).toEqual({ from: '2026-01-05' });
  });

  it('границы года, месяца и недели: 1 января — четверг, воскресенье, високосный февраль', () => {
    expect(periodRange({ period: 'week' }, '2026-01-01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(periodRange({ period: 'lastWeek' }, '2026-01-01')).toEqual({ from: '2025-12-22', to: '2025-12-28' });
    expect(periodRange({ period: 'lastMonth' }, '2026-01-01')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange({ period: 'yesterday' }, '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' });
    expect(periodRange({ period: 'week' }, '2026-03-01')).toEqual({ from: '2026-02-23', to: '2026-03-01' });
    expect(periodRange({ period: 'month' }, '2024-02-29')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('адресная строка ↔ фильтр', () => {
  it('пустая строка — фильтр по умолчанию; ?account=5 из левой панели — фильтр по счёту', () => {
    expect(parse('')).toEqual(EMPTY_JOURNAL_STATE);
    expect(parse('account=5')).toEqual(state({ accountIds: [5] }));
  });

  it('туда и обратно: все поля сохраняются, строка — без значений по умолчанию', () => {
    const full = state({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'Аренда 100%',
      amountMin: 100000,
      amountMax: 500000,
      types: ['income', 'transfer'],
      accountIds: [1, 7],
      categoryIds: [3],
      projectIds: [4],
      counterpartyIds: [9],
      tagIds: [2],
      withoutCategory: true,
      withoutProject: true,
      withoutCounterparty: true,
      sort: 'amount',
      order: 'asc',
    });
    const qs = journalSearch(full).toString();
    expect(qs).toBe(
      'from=2026-01-01&to=2026-01-31&q=%D0%90%D1%80%D0%B5%D0%BD%D0%B4%D0%B0+100%25&min=100000&max=500000&type=income&type=transfer' +
        '&account=1&account=7&category=3&project=4&counterparty=9&tag=2&noCategory=1&noProject=1&noCounterparty=1&sort=amount&order=asc',
    );
    expect(parse(qs)).toEqual(full);
    expect(journalSearch(EMPTY_JOURNAL_STATE).toString()).toBe('');
    expect(journalSearch(state({ period: 'month' })).toString()).toBe('period=month');
    expect(journalSearch(state({ period: 'custom' })).toString()).toBe('period=custom');
    expect(parse('period=custom')).toEqual(state({ period: 'custom' }));
  });

  it('ручная правка адреса не ломает журнал: мусор отбрасывается, перепутанные границы меняются местами', () => {
    expect(parse('account=abc&account=0&account=-3&account=12&account=12&type=bogus&type=expense&sort=name&order=up&noCategory=yes')).toEqual(
      state({ accountIds: [12], types: ['expense'] }),
    );
    expect(parse('from=2026-02-31&to=2026-03-05')).toEqual(state({ period: 'custom', to: '2026-03-05' }));
    expect(parse('from=2026-03-05&to=2026-03-01')).toEqual(state({ period: 'custom', from: '2026-03-01', to: '2026-03-05' }));
    expect(parse('min=500&max=100')).toMatchObject({ amountMin: 100, amountMax: 500 });
    expect(parse('min=1.5&max=99999999999999999')).toEqual(EMPTY_JOURNAL_STATE);
    expect(parse(`q=${'я'.repeat(300)}`).q).toHaveLength(200);
    expect(parse('q=%20%20')).toEqual(EMPTY_JOURNAL_STATE);
    // списков не больше, чем принимает сервер (JOURNAL_LIST_MAX) — иначе журнал получил бы 400
    const many = new URLSearchParams(Array.from({ length: 250 }, (_, i) => ['account', String(i + 1)]));
    expect(parseJournalSearch(many).accountIds).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    // относительный период важнее дат: «текущий месяц» после перезагрузки остаётся текущим
    expect(parse('period=month&from=2020-01-01')).toEqual(state({ period: 'month' }));
  });

  it('параметры API (план 5a): период датами, списки повтором ключа, флаги true, сортировка всегда', () => {
    const p = journalApiParams(state({ period: 'today', q: 'бар', amountMin: 100, types: ['expense'], accountIds: [1, 2], withoutProject: true }), '2026-10-07');
    expect(p.toString()).toBe(
      'from=2026-10-07&to=2026-10-07&q=%D0%B1%D0%B0%D1%80&amountMin=100&types=expense&accountIds=1&accountIds=2&withoutProject=true&sort=date&order=desc',
    );
    expect(journalApiParams(EMPTY_JOURNAL_STATE, '2026-10-07').toString()).toBe('sort=date&order=desc');
  });

  it('число условий модалки, «есть фильтр» и сброс с сохранением сортировки', () => {
    expect(filterConditionCount(state({ accountIds: [1], categoryIds: [2], withoutCategory: true, withoutCounterparty: true }))).toBe(3);
    expect(filterConditionCount(state({ q: 'x', period: 'today' }))).toBe(0);
    expect(isFiltered(EMPTY_JOURNAL_STATE)).toBe(false);
    expect(isFiltered(state({ sort: 'amount' }))).toBe(false);
    expect(isFiltered(state({ amountMax: 0 }))).toBe(true);
    expect(isFiltered(state({ period: 'year' }))).toBe(true);
    expect(clearFilter(state({ q: 'x', tagIds: [1], sort: 'amount', order: 'asc' }))).toEqual(state({ sort: 'amount', order: 'asc' }));
  });
});

describe('форматирование строк журнала', () => {
  it('дата и время — в поясе приложения: 23:30 и 00:30 по Алматы — разные дни', () => {
    expect(dayOf('2026-10-04T18:30:00.000Z', 'Asia/Almaty')).toBe('2026-10-04');
    expect(dayOf('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBe('2026-10-05');
    expect(timeLabel('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBe('00:30');
    expect(timeLabel('2026-10-04T18:05:00.000Z', 'Asia/Almaty')).toBe('23:05');
    expect(dayLabel('2026-10-07', '2026-10-07')).toBe('сегодня');
    expect(dayLabel('2026-10-06', '2026-10-07')).toBe('вчера');
    expect(dayLabel('2025-12-31', '2026-01-01')).toBe('вчера');
    expect(dayLabel('2026-10-05', '2026-10-07')).toBe('05.10.2026');
  });

  it('множественное число и подпись разбитой операции', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => pluralRu(n, 'а', 'б', 'в')).join('')).toBe('аббввввабвав');
    expect(splitLabel(2, 'category')).toBe('2 статьи');
    expect(splitLabel(5, 'category')).toBe('5 статей');
    expect(splitLabel(21, 'project')).toBe('21 проект');
    expect(splitLabel(3, 'project')).toBe('3 проекта');
  });

  it('измерение строк: одно значение на все строки или несколько разных («не указано» — тоже значение)', () => {
    const l = (categoryId: number | null, projectId: number | null, amount = 100) => ({ categoryId, projectId, amount });
    expect(lineDimension([], 'projectId')).toEqual({ kind: 'single', id: null });
    expect(lineDimension([l(1, null)], 'categoryId')).toEqual({ kind: 'single', id: 1 });
    expect(lineDimension([l(1, 5), l(1, 6)], 'categoryId')).toEqual({ kind: 'single', id: 1 });
    expect(lineDimension([l(1, 5), l(1, 6)], 'projectId')).toEqual({ kind: 'many', count: 2 });
    expect(lineDimension([l(1, 5), l(null, 5), l(2, 5)], 'categoryId')).toEqual({ kind: 'many', count: 3 });
  });

  it('доля проекта — только у разбитой операции и при фильтре по проекту', () => {
    const lines = [
      { categoryId: 1, projectId: 5, amount: 400 },
      { categoryId: 1, projectId: 6, amount: 600 },
      { categoryId: 1, projectId: null, amount: 50 },
    ];
    expect(projectShare(lines, [5])).toBe(400);
    expect(projectShare(lines, [5, 6])).toBe(1000);
    expect(projectShare(lines, [7])).toBe(0);
    expect(projectShare(lines, [])).toBeNull();
    expect(projectShare([lines[0]!], [5])).toBeNull();
  });

  it('сумма со знаком по типу и текст поля суммы', () => {
    expect(signedMoney('income', 150050, 'KZT')).toBe('+1\u202F500,50\u00A0₸');
    expect(signedMoney('expense', 500, 'USD')).toBe('\u22125,00\u00A0$');
    expect(signedMoney('transfer', 1000, 'JPY')).toBe('1\u202F000\u00A0¥');
    expect(amountInputText(150000, 2)).toBe('1500');
    expect(amountInputText(150050, 2)).toBe('1500,5');
    expect(amountInputText(5, 2)).toBe('0,05');
    expect(amountInputText(0, 2)).toBe('0');
    expect(amountInputText(1234, 0)).toBe('1234');
  });
});

describe('видимые колонки журнала', () => {
  it('нет настройки — все; неизвестные отбрасываются; дата и сумма всегда видны; порядок постоянный', () => {
    expect(visibleColumns(undefined)).toEqual(['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment']);
    expect(visibleColumns('мусор')).toHaveLength(7);
    expect(visibleColumns(['comment', 'bogus', 3, 'account'])).toEqual(['date', 'amount', 'account', 'comment']);
    expect(visibleColumns([])).toEqual(['date', 'amount']);
  });

  it('переключение колонки; дату и сумму выключить нельзя', () => {
    expect(toggleColumn(['date', 'amount', 'account', 'comment'], 'comment')).toEqual(['date', 'amount', 'account']);
    expect(toggleColumn(['date', 'amount', 'comment'], 'project')).toEqual(['date', 'amount', 'project', 'comment']);
    expect(toggleColumn(['date', 'amount'], 'date')).toEqual(['date', 'amount']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal.test.ts`
Expected: FAIL — модулей `journal-filter`, `journal-format`, `journal-columns` нет.

- [ ] **Step 3: Implement**

`src/client/lib/journal-filter.ts`:

```ts
import { addDays, isValidDate } from '../../shared/dates';
import { JOURNAL_LIST_MAX } from '../../shared/schemas/journal';

/** Периоды тулбара журнала (§7). Относительные периоды считаются от «сегодня» в APP_TIMEZONE. */
export const PERIODS = [
  { key: 'all', label: 'Всё время' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Текущая неделя' },
  { key: 'lastWeek', label: 'Прошлая неделя' },
  { key: 'month', label: 'Текущий месяц' },
  { key: 'lastMonth', label: 'Прошлый месяц' },
  { key: 'year', label: 'Текущий год' },
  { key: 'custom', label: 'Произвольно' },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];
export type OperationType = 'income' | 'expense' | 'transfer';
export type JournalSortKey = 'date' | 'amount';
export type JournalSortOrder = 'asc' | 'desc';

export const OPERATION_TYPES: readonly OperationType[] = ['income', 'expense', 'transfer'];

/**
 * Фильтр журнала в адресной строке. Списки — по возрастанию без повторов; суммы — минимальные единицы
 * базовой валюты компании; from/to — только у периода «Произвольно».
 */
export interface JournalUrlState {
  period: PeriodKey;
  from?: string;
  to?: string;
  q?: string;
  amountMin?: number;
  amountMax?: number;
  types: OperationType[];
  accountIds: number[];
  categoryIds: number[];
  projectIds: number[];
  counterpartyIds: number[];
  tagIds: number[];
  withoutCategory: boolean;
  withoutProject: boolean;
  withoutCounterparty: boolean;
  sort: JournalSortKey;
  order: JournalSortOrder;
}

export const EMPTY_JOURNAL_STATE: JournalUrlState = {
  period: 'all',
  types: [],
  accountIds: [],
  categoryIds: [],
  projectIds: [],
  counterpartyIds: [],
  tagIds: [],
  withoutCategory: false,
  withoutProject: false,
  withoutCounterparty: false,
  sort: 'date',
  order: 'desc',
};

/** Ключи адресной строки для списков: `?account=5` из левой панели (решение 3 плана 4b) — тот же ключ. */
const LIST_KEYS = {
  accountIds: 'account',
  categoryIds: 'category',
  projectIds: 'project',
  counterpartyIds: 'counterparty',
  tagIds: 'tag',
} as const;
type ListField = keyof typeof LIST_KEYS;
const LIST_FIELDS = Object.keys(LIST_KEYS) as ListField[];

const FLAG_KEYS = {
  withoutCategory: 'noCategory',
  withoutProject: 'noProject',
  withoutCounterparty: 'noCounterparty',
} as const;
type FlagField = keyof typeof FLAG_KEYS;
const FLAG_FIELDS = Object.keys(FLAG_KEYS) as FlagField[];

/** Длина поиска — как у сервера (journalFilterSchema). */
export const SEARCH_MAX = 200;

/** Без повторов, по возрастанию. */
export const sortedUnique = <T extends number | string>(xs: T[]): T[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Идентификаторы из адреса: только положительные целые, без повторов, не больше, чем принимает сервер. */
function ids(values: string[]): number[] {
  return sortedUnique(values.filter((v) => /^\d{1,15}$/.test(v)).map(Number).filter((n) => n > 0 && Number.isSafeInteger(n))).slice(0, JOURNAL_LIST_MAX);
}

function minor(value: string | null): number | undefined {
  if (value === null || !/^\d{1,16}$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

const isPeriod = (v: string | null): v is PeriodKey => PERIODS.some((p) => p.key === v);

/**
 * Адресная строка → фильтр. Разбор мягкий: неверные значения отбрасываются, перепутанные границы
 * периода и суммы меняются местами — журнал не должен падать из-за ручной правки адреса.
 */
export function parseJournalSearch(params: URLSearchParams): JournalUrlState {
  const state: JournalUrlState = { ...EMPTY_JOURNAL_STATE };
  let from = params.get('from') ?? undefined;
  let to = params.get('to') ?? undefined;
  if (from !== undefined && !isValidDate(from)) from = undefined;
  if (to !== undefined && !isValidDate(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const period = params.get('period');
  if (isPeriod(period) && period !== 'custom') state.period = period;
  else if (period === 'custom' || from || to) {
    state.period = 'custom';
    if (from) state.from = from;
    if (to) state.to = to;
  }

  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX).trim();
  if (q) state.q = q;
  let amountMin = minor(params.get('min'));
  let amountMax = minor(params.get('max'));
  if (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax) [amountMin, amountMax] = [amountMax, amountMin];
  if (amountMin !== undefined) state.amountMin = amountMin;
  if (amountMax !== undefined) state.amountMax = amountMax;

  state.types = OPERATION_TYPES.filter((t) => params.getAll('type').includes(t));
  for (const field of LIST_FIELDS) state[field] = ids(params.getAll(LIST_KEYS[field]));
  for (const field of FLAG_FIELDS) state[field] = params.get(FLAG_KEYS[field]) === '1';
  if (params.get('sort') === 'amount') state.sort = 'amount';
  if (params.get('order') === 'asc') state.order = 'asc';
  return state;
}

/** Фильтр → адресная строка: только отличия от значений по умолчанию, в постоянном порядке. */
export function journalSearch(state: JournalUrlState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.period === 'custom') {
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (!state.from && !state.to) p.set('period', 'custom');
  } else if (state.period !== 'all') p.set('period', state.period);
  if (state.q) p.set('q', state.q);
  if (state.amountMin !== undefined) p.set('min', String(state.amountMin));
  if (state.amountMax !== undefined) p.set('max', String(state.amountMax));
  for (const t of state.types) p.append('type', t);
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(LIST_KEYS[field], String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(FLAG_KEYS[field], '1');
  if (state.sort !== 'date') p.set('sort', state.sort);
  if (state.order !== 'desc') p.set('order', state.order);
  return p;
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // понедельник — 0
}

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Границы периода (включительно) от сегодняшней даты в APP_TIMEZONE; неделя — с понедельника. */
export function periodRange(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>, today: string): { from?: string; to?: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (state.period) {
    case 'all':
      return {};
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case 'week': {
      const monday = addDays(today, -weekday(today));
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'lastWeek': {
      const monday = addDays(today, -weekday(today) - 7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: lastDayOfMonth(y, m) };
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: lastDayOfMonth(py, pm) };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom':
      return { ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}) };
  }
}

/**
 * Параметры API журнала и выгрузки (план 5a): списки — повтором ключа, флаги — `true`, суммы — минимальные единицы.
 * Без курсора и размера страницы.
 */
export function journalApiParams(state: JournalUrlState, today: string): URLSearchParams {
  const p = new URLSearchParams();
  const range = periodRange(state, today);
  if (range.from) p.set('from', range.from);
  if (range.to) p.set('to', range.to);
  if (state.q) p.set('q', state.q);
  if (state.amountMin !== undefined) p.set('amountMin', String(state.amountMin));
  if (state.amountMax !== undefined) p.set('amountMax', String(state.amountMax));
  for (const t of state.types) p.append('types', t);
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(field, String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(field, 'true');
  p.set('sort', state.sort);
  p.set('order', state.order);
  return p;
}

/** Сколько условий выбрано в модалке «Фильтр»: тип, счета, статьи, проекты, контрагенты, теги (по измерению). */
export function filterConditionCount(state: JournalUrlState): number {
  return [
    state.types.length > 0,
    state.accountIds.length > 0,
    state.categoryIds.length > 0 || state.withoutCategory,
    state.projectIds.length > 0 || state.withoutProject,
    state.counterpartyIds.length > 0 || state.withoutCounterparty,
    state.tagIds.length > 0,
  ].filter(Boolean).length;
}

/** Задано хоть одно условие (включая период, поиск и сумму) — сортировка не в счёт. */
export function isFiltered(state: JournalUrlState): boolean {
  return state.period !== 'all' || !!state.q || state.amountMin !== undefined || state.amountMax !== undefined || filterConditionCount(state) > 0;
}

/** Сброс условий с сохранением сортировки. */
export function clearFilter(state: JournalUrlState): JournalUrlState {
  return { ...EMPTY_JOURNAL_STATE, sort: state.sort, order: state.order };
}
```

`src/client/lib/journal-format.ts`:

```ts
import { addDays, formatDateRu, todayInTimezone } from '../../shared/dates';
import { formatAmount, formatMoney } from '../../shared/money';
import type { OperationType } from './journal-filter';

/** Календарная дата момента времени в поясе приложения (APP_TIMEZONE). */
export function dayOf(iso: string, timeZone: string): string {
  return todayInTimezone(timeZone, new Date(iso));
}

/** Подпись даты в журнале: «сегодня», «вчера» или «ДД.ММ.ГГГГ». */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'сегодня';
  if (day === addDays(today, -1)) return 'вчера';
  return formatDateRu(day);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Время «ЧЧ:ММ» в поясе приложения. */
export function timeLabel(iso: string, timeZone: string): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** Русское множественное число: 1 статья, 2 статьи, 5 статей, 11 статей, 21 статья. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

/** «2 статьи», «5 проектов» — подпись разбитой операции (§7; «N категорий» спецификации — статьи, как везде в интерфейсе). */
export function splitLabel(count: number, what: 'category' | 'project'): string {
  return what === 'category'
    ? `${count} ${pluralRu(count, 'статья', 'статьи', 'статей')}`
    : `${count} ${pluralRu(count, 'проект', 'проекта', 'проектов')}`;
}

export interface LineLike {
  categoryId: number | null;
  projectId: number | null;
  amount: number;
}

/**
 * Значение измерения у строк операции: одно на все строки (`single`, может быть null — «не указано»)
 * или несколько разных (`many` с их числом; «не указано» тоже считается значением).
 */
export type LineDimension = { kind: 'single'; id: number | null } | { kind: 'many'; count: number };

export function lineDimension(lines: readonly LineLike[], key: 'categoryId' | 'projectId'): LineDimension {
  const values = new Set(lines.map((l) => l[key]));
  if (values.size <= 1) return { kind: 'single', id: lines[0]?.[key] ?? null };
  return { kind: 'many', count: values.size };
}

/**
 * «Доля проекта» (§7): при фильтре по проекту у разбитой операции — сумма её строк с выбранными проектами
 * в валюте счёта. У неразбитой операции и без фильтра по проекту — null.
 */
export function projectShare(lines: readonly LineLike[], projectIds: readonly number[]): number | null {
  if (projectIds.length === 0 || lines.length < 2) return null;
  const chosen = new Set(projectIds);
  return lines.filter((l) => l.projectId !== null && chosen.has(l.projectId)).reduce((s, l) => s + l.amount, 0);
}

/** Сумма со знаком по типу: доход «+1 500,00 ₸», расход «-1 500,00 ₸», перевод без знака. */
export function signedMoney(type: OperationType, minor: number, currency: string): string {
  const sign = type === 'income' ? '+' : type === 'expense' ? '\u2212' : '';
  return `${sign}${formatMoney(minor, currency)}`;
}

/** Минимальные единицы → текст поля ввода: «1500», «1500,5», «0,05» (без разрядов и лишних нулей). */
export function amountInputText(minor: number, minorUnits: number): string {
  return formatAmount(minor, minorUnits)
    .replace(/\u202F/g, '')
    .replace(/(,\d*?)0+$/, '$1')
    .replace(/,$/, '');
}
```

`src/client/lib/journal-columns.ts`:

```ts
/** Колонки журнала (§7) в порядке показа. Дата и сумма видны всегда — по ним сортируют. */
export const JOURNAL_COLUMNS = [
  { id: 'date', label: 'Дата', fixed: true },
  { id: 'amount', label: 'Сумма', fixed: true },
  { id: 'account', label: 'Счёт', fixed: false },
  { id: 'counterparty', label: 'Контрагент', fixed: false },
  { id: 'category', label: 'Статья', fixed: false },
  { id: 'project', label: 'Проект', fixed: false },
  { id: 'comment', label: 'Комментарий', fixed: false },
] as const;

export type JournalColumnId = (typeof JOURNAL_COLUMNS)[number]['id'];

/** Ключ настройки пользователя (`user_preferences`): массив id видимых колонок. */
export const JOURNAL_COLUMNS_PREF = 'journal.columns';

const ALL_IDS: readonly JournalColumnId[] = JOURNAL_COLUMNS.map((c) => c.id);

/**
 * Видимые колонки из сохранённой настройки: неизвестные id отбрасываются, дата и сумма добавляются всегда,
 * порядок — как в JOURNAL_COLUMNS. Нет настройки или она не массив — все колонки.
 */
export function visibleColumns(pref: unknown): JournalColumnId[] {
  if (!Array.isArray(pref)) return [...ALL_IDS];
  const chosen = new Set(pref.filter((x): x is string => typeof x === 'string'));
  return JOURNAL_COLUMNS.filter((c) => c.fixed || chosen.has(c.id)).map((c) => c.id);
}

/** Включить или выключить колонку; дату и сумму выключить нельзя. */
export function toggleColumn(visible: readonly JournalColumnId[], id: JournalColumnId): JournalColumnId[] {
  if (JOURNAL_COLUMNS.find((c) => c.id === id)?.fixed) return [...visible];
  const next = new Set(visible);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return JOURNAL_COLUMNS.filter((c) => next.has(c.id)).map((c) => c.id);
}
```

Проверьте, что экранирования `\u2212`, `\u202F`, `\u00A0` остались текстом:

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/client/lib/journal-format.ts tests/client/journal.test.ts`
Expected: ничего не выводит, код выхода 0.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/client/lib/journal-filter.ts src/client/lib/journal-format.ts src/client/lib/journal-columns.ts tests/client/journal.test.ts
git commit -m "feat: фильтр журнала в адресной строке, периоды в APP_TIMEZONE, форматирование строк и колонки

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: Таблица журнала, бесконечная прокрутка и сортировка; фильтр по счёту из левой панели

**Files:**
- Create: `src/client/lib/floating.ts`, `src/client/components/useFloating.ts`, `src/client/components/journal/JournalTable.tsx`, `src/client/components/journal/SplitHint.tsx`, `src/client/components/journal/LoadMore.tsx`, `tests/client/floating.test.ts`, `e2e/journal.spec.ts`
- Modify: `src/client/lib/queries.ts`, `src/client/pages/JournalPage.tsx`

**Interfaces:**
- Consumes: всё из задачи 1; `useAccounts`, `useCategories`, `useProjects`, `useCounterparties`, `usePreferences`, типы `Account`, `CategoryTree` (`src/client/lib/queries.ts`); `useMeta` (`src/client/lib/query.ts`); `Pending`, `StaleNotice` (`components/QueryState.tsx`); `btnSecondary` (`components/ui.ts`); `CompanyOutletContext` (`pages/CompanyLayout.tsx`); API списка журнала плана 5a.
- Produces:
  - `queries.ts`: `interface OperationLine`, `interface JournalItem` (поля операции + `lines`, `tagIds`, `attachmentCount`, `balanceAfter`, `toBalanceAfter`), `interface JournalPageData { items; nextCursor }`, `JOURNAL_PAGE_SIZE = 50`, `useJournal(companyId: number, params: string | null)` — ключ `['journal', companyId, params]`, `null` — запрос выключен;
  - `placeFloating(anchor: AnchorRect, size: { width; height }, viewport: { width; height }, align: 'left' | 'right' = 'left'): FloatingPosition` (`{ top; left; maxHeight }`), `FLOATING_GAP = 8` (`lib/floating.ts`);
  - `useFloating(open: boolean, anchorRef, floatingRef, align?): CSSProperties` (`components/useFloating.ts`) — стиль `position: fixed` для элемента в портале; пока место не посчитано — `visibility: hidden`. План 5b задача 4 строит на нём `Popover`;
  - `SplitHint({ label, lines }: { label: string; lines: string[] })` — подсказка порталом, Esc прячет;
  - `LoadMore({ hasNext, loading, failed, onLoad })` — кнопка «Показать ещё» и наблюдатель; после ошибки загрузки (`failed`) наблюдатель отключён;
  - `JournalTable(props: JournalTableProps)`, `interface JournalLookups { accounts: Map<number, Account>; categories, projects, counterparties: Map<number, string> }`; `JournalTableProps` — `items`, `columns`, `lookups`, `baseCurrency`, `timeZone`, `today`, `projectFilter`, `sort`, `order`, `onSort(sort, order)`, `busy`, `onOpenOperation?` (точка подключения шага 6). Таблица: `<table>` с подписью «Операции», сортируемые заголовки «Дата» и «Сумма» — кнопки в `<th aria-sort>`; у строки `tabIndex={-1}` и `data-operation-id`;
  - `JournalPage` — `<JournalScreen key={company.id} company={company} />`; экран: фильтр из адреса, таблица, «Показать ещё», заголовок `<h1 tabIndex={-1}>Журнал</h1>`.

- [ ] **Step 1: Write the failing tests**

`tests/client/floating.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { placeFloating } from '../../src/client/lib/floating';

const viewport = { width: 1280, height: 720 };
const anchor = (top: number, left: number, width = 80, height = 30) => ({ top, bottom: top + height, left, right: left + width });

describe('placeFloating — место всплывающей панели в окне', () => {
  it('под кнопкой, если снизу хватает места; высота — не больше свободного места', () => {
    expect(placeFloating(anchor(100, 200), { width: 288, height: 250 }, viewport)).toEqual({ top: 138, left: 200, maxHeight: 574 });
  });

  it('над кнопкой, если снизу не хватает, а сверху места больше', () => {
    // кнопка у нижнего края: снизу 720 - 690 - 16 = 14 px, сверху 660 - 16 = 644 px
    expect(placeFloating(anchor(660, 200), { width: 288, height: 250 }, viewport)).toEqual({ top: 402, left: 200, maxHeight: 644 });
  });

  it('длинная панель — там, где места больше, высотой со свободное место (прокручивается внутри)', () => {
    expect(placeFloating(anchor(300, 200), { width: 288, height: 900 }, viewport)).toEqual({ top: 338, left: 200, maxHeight: 374 });
    expect(placeFloating(anchor(400, 200), { width: 288, height: 900 }, viewport)).toEqual({ top: 8, left: 200, maxHeight: 384 });
  });

  it('по правому краю кнопки и в пределах окна по горизонтали', () => {
    expect(placeFloating(anchor(100, 1000), { width: 288, height: 100 }, viewport, 'right').left).toBe(792);
    expect(placeFloating(anchor(100, 1200), { width: 288, height: 100 }, viewport).left).toBe(984);
    expect(placeFloating(anchor(100, 0, 40), { width: 288, height: 100 }, viewport, 'right').left).toBe(8);
  });
});
```

`e2e/journal.spec.ts` (вспомогательные функции и два первых теста; следующие задачи дописывают тесты в конец файла):

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
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });

test('сценарий 3 §10: доход, расход на два проекта, перевод KZT → USD — балансы в панели и остатки в журнале', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сценарий ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const north = (await apiPost(page, `${base}/projects`, { name: 'Клуб Север', templateKey: 'general' })).project.id;
  const south = (await apiPost(page, `${base}/projects`, { name: 'Клуб Юг', templateKey: 'general' })).project.id;
  const revenue = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Выручка' })).category.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  // курс компании, чтобы доллары вошли в «Всего на счетах» (ручной курс общий для всех e2e — его не трогаем)
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });

  await apiPost(page, `${base}/operations`, {
    type: 'income',
    paidAt: todayAgo(3),
    accountId: cash,
    amount: 50000,
    lines: [{ categoryId: revenue, projectId: north, amount: 50000 }],
  });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: cash,
    amount: 30000,
    lines: [
      { categoryId: rent, projectId: north, amount: 10000 },
      { categoryId: rent, projectId: south, amount: 20000 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: cash, amount: 50000, toAccountId: usd, toAmount: 100 });

  await page.reload();
  // левая панель: 1000 + 500 - 300 - 500 = 700 ₸; $1 по курсу 500 — итог 1200 ₸
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/700,00\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/1,00\s\$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*1\s200,00\s₸/);

  // журнал: новые сверху, у каждой строки — остаток после операции по своему счёту
  await expect(bodyRows(page)).toHaveCount(3);
  const [transfer, expense, income] = [bodyRows(page).nth(0), bodyRows(page).nth(1), bodyRows(page).nth(2)];
  await expect(transfer).toContainText(/500,00\s₸/);
  await expect(transfer).toContainText(/→ 1,00\s\$/);
  await expect(transfer).toContainText(/Касса\s*остаток 700,00\s₸/);
  await expect(transfer).toContainText(/Валютный\s*остаток 1,00\s\$/);
  await expect(expense).toContainText(/\u2212300,00\s₸/);
  await expect(expense).toContainText(/остаток 1\s200,00\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500,00\s₸/);
  await expect(income).toContainText(/остаток 1\s500,00\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  await expect(income.locator('time')).toContainText('сегодня');

  // подсказка разбиения — при наведении и при фокусе с клавиатуры
  await expense.getByText('2 проекта').hover();
  await expect(page.getByRole('tooltip')).toContainText(/Аренда · Клуб Юг — 200,00\s₸/);
  await expense.getByText('2 проекта').focus();
  await expect(expense.getByText('2 проекта')).toHaveAccessibleDescription(/Аренда · Клуб Север — 100,00\s₸/);
  await expect(page.getByRole('tooltip')).toBeVisible();
  // Esc прячет подсказку, фокус остаётся (WCAG 1.4.13)
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(expense.getByText('2 проекта')).toBeFocused();
});

test('клик по счёту в левой панели фильтрует журнал; бесконечная прокрутка; сортировка по сумме', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(200 - i), accountId: kaspi, amount: i * 100 });
  }
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 9900 });

  await page.reload();
  // первая страница — 50 операций; прокрутка вниз догружает остальные
  await expect(bodyRows(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(bodyRows(page)).toHaveCount(56);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);

  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${cash}$`));
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText(/\u221299,00\s₸/);

  await panel(page).getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(bodyRows(page)).toHaveCount(50);
  // по дате новые сверху: последняя внесённая — 55,00 ₸
  await expect(bodyRows(page).first()).toContainText(/\+55,00\s₸/);

  // сортировка по сумме: по возрастанию, затем по убыванию; фильтр по счёту сохраняется, адрес — тоже
  const amountHeader = table(page).getByRole('columnheader', { name: /Сумма/ });
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(bodyRows(page).first()).toContainText(/\+55,00\s₸/);
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(bodyRows(page).first()).toContainText(/\+1,00\s₸/);
  await expect(page).toHaveURL(new RegExp(`account=${kaspi}&sort=amount&order=asc$`));
  await page.reload();
  await expect(bodyRows(page).first()).toContainText(/\+1,00\s₸/);
  await expect(table(page).getByRole('columnheader', { name: /Дата/ })).not.toHaveAttribute('aria-sort', /.+/);
});
```

Проверьте экранирования:

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" e2e/journal.spec.ts`
Expected: ничего не выводит.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/floating.test.ts`
Expected: FAIL — нет модуля `lib/floating`.

Run: `npx playwright test e2e/journal.spec.ts`
Expected: FAIL — на странице журнала нет таблицы «Операции».

- [ ] **Step 3: Implement**

`src/client/lib/queries.ts` — допишите в конец файла (`useInfiniteQuery`, `InfiniteData`, `api` и `ApiError` уже импортированы):

```ts
export interface OperationLine {
  id: number;
  position: number;
  categoryId: number | null;
  projectId: number | null;
  amount: number;
  baseAmount: number;
}

/** Элемент журнала (`GET /companies/:cid/operations`, план 5a): операция со строками, тегами, вложениями и остатками. */
export interface JournalItem {
  id: number;
  companyId: number;
  type: 'income' | 'expense' | 'transfer';
  status: 'actual' | 'planned';
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
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  lines: OperationLine[];
  tagIds: number[];
  attachmentCount: number;
  /** Остаток счёта операции после неё (у перевода — счёта списания), по всей истории счёта. */
  balanceAfter: number | null;
  /** У перевода — остаток счёта зачисления после операции. */
  toBalanceAfter: number | null;
}

export interface JournalPageData {
  items: JournalItem[];
  nextCursor: string | null;
}

export const JOURNAL_PAGE_SIZE = 50;

/**
 * Журнал с бесконечной прокруткой. params — строка запроса фильтра (journalApiParams) или null, пока она
 * не готова (нет часового пояса). Ключ ['journal', cid, params]: сброс ['journal', cid] обновляет все фильтры.
 */
export function useJournal(companyId: number, params: string | null) {
  return useInfiniteQuery<JournalPageData, ApiError, InfiniteData<JournalPageData, string | null>, readonly unknown[], string | null>({
    queryKey: ['journal', companyId, params],
    enabled: params !== null,
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params ?? '');
      p.set('limit', String(JOURNAL_PAGE_SIZE));
      if (pageParam !== null) p.set('cursor', pageParam);
      return api<JournalPageData>(`/companies/${companyId}/operations?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    // при смене фильтра старые строки остаются на экране до ответа; журнал другой компании не показывается
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}
```

`src/client/lib/floating.ts`:

```ts
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingPosition {
  top: number;
  left: number;
  /** Не выше свободного места: длинная панель прокручивается внутри себя. */
  maxHeight: number;
}

/** Отступ от кнопки и от краёв окна, px. */
export const FLOATING_GAP = 8;
const MIN_HEIGHT = 120;

/**
 * Место всплывающей панели у кнопки в координатах окна (position: fixed): под кнопкой, а если снизу не хватает
 * места и сверху его больше — над ней; по горизонтали — от левого или правого края кнопки, в пределах окна.
 * Панель живёт вне контейнеров с прокруткой, поэтому её не обрезает, например, обёртка таблицы.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right' = 'left',
): FloatingPosition {
  const below = viewport.height - anchor.bottom - FLOATING_GAP * 2;
  const above = anchor.top - FLOATING_GAP * 2;
  const up = size.height > below && above > below;
  const maxHeight = Math.max(MIN_HEIGHT, up ? above : below);
  const height = Math.min(size.height, maxHeight);
  const top = up ? Math.max(FLOATING_GAP, anchor.top - FLOATING_GAP - height) : anchor.bottom + FLOATING_GAP;
  const wanted = align === 'right' ? anchor.right - size.width : anchor.left;
  const left = Math.max(FLOATING_GAP, Math.min(wanted, viewport.width - size.width - FLOATING_GAP));
  return { top, left, maxHeight };
}
```

`src/client/components/useFloating.ts`:

```ts
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placeFloating, type FloatingPosition } from '../lib/floating';

/**
 * Стиль всплывающего элемента (панели, подсказки), который рисуется порталом в body с position: fixed:
 * место считается от кнопки до первой отрисовки и пересчитывается при прокрутке (любого контейнера),
 * изменении окна и размера самого элемента. Пока места нет — элемент невидим.
 */
export function useFloating(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  align: 'left' | 'right' = 'left',
): CSSProperties {
  const [pos, setPos] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const next = placeFloating(
        anchor.getBoundingClientRect(),
        { width: floating.offsetWidth, height: floating.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight ? prev : next));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (floatingRef.current) observer?.observe(floatingRef.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [open, align, anchorRef, floatingRef]);

  return pos ? { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}
```

`src/client/components/journal/SplitHint.tsx`:

```ts
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloating } from '../useFloating';

/**
 * Подпись разбитой операции («2 проекта») с подсказкой по строкам (WCAG 1.4.13): видна при наведении
 * и при фокусе с клавиатуры, на неё можно навести указатель, Esc её прячет. Подсказка рисуется порталом
 * (position: fixed) — обёртка таблицы с прокруткой её не обрезает. Программа чтения с экрана получает
 * текст строк как описание (aria-describedby на скрытый элемент).
 */
export function SplitHint({ label, lines }: { label: string; lines: string[] }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const style = useFloating(show, anchorRef, tipRef);

  const open = () => {
    window.clearTimeout(hideTimer.current);
    setShow(true);
  };
  // небольшая задержка: указатель успевает перейти с подписи на подсказку
  const closeSoon = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShow(false), 150);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  return (
    <>
      <span
        ref={anchorRef}
        tabIndex={0}
        aria-describedby={id}
        onMouseEnter={open}
        onMouseLeave={closeSoon}
        onFocus={open}
        onBlur={() => setShow(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && show) {
            e.stopPropagation();
            setShow(false);
          }
        }}
        className="cursor-help rounded underline decoration-dotted underline-offset-4 outline-none focus:ring-2 focus:ring-focus"
      >
        {label}
      </span>
      <span id={id} hidden>
        {lines.join('; ')}
      </span>
      {show &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={style}
            onMouseEnter={open}
            onMouseLeave={closeSoon}
            className="z-40 w-max max-w-xs rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg"
          >
            {lines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </span>,
          document.body,
        )}
    </>
  );
}
```

`src/client/components/journal/LoadMore.tsx`:

```ts
import { useEffect, useRef } from 'react';
import { btnSecondary } from '../ui';

/**
 * Бесконечная прокрутка: когда низ списка подходит к экрану (запас 400 px), грузится следующая страница.
 * Наблюдатель пересоздаётся после каждой загрузки — если низ всё ещё виден, сразу грузится следующая.
 * После ошибки загрузки наблюдатель отключается (иначе запросы шли бы по кругу): продолжение — кнопкой.
 * Кнопка «Показать ещё» — и для клавиатуры, и на случай, если наблюдатель не сработал.
 */
export function LoadMore(props: { hasNext: boolean; loading: boolean; failed: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoad = useRef(props.onLoad);
  onLoad.current = props.onLoad;

  useEffect(() => {
    const el = ref.current;
    if (!el || !props.hasNext || props.loading || props.failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoad.current();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [props.hasNext, props.loading, props.failed]);

  if (!props.hasNext) return null;
  return (
    <div ref={ref} className="mt-4 flex flex-col items-center gap-2">
      {props.failed && !props.loading && (
        <p role="alert" className="text-sm text-expense">
          Не удалось загрузить продолжение списка.
        </p>
      )}
      <button type="button" onClick={props.onLoad} disabled={props.loading} className={btnSecondary}>
        {props.loading ? 'Загрузка…' : 'Показать ещё'}
      </button>
    </div>
  );
}
```

`src/client/components/journal/JournalTable.tsx`:

```ts
import type { MouseEvent, ReactNode } from 'react';
import { formatMoney } from '../../../shared/money';
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

/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[]): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? null : (names.get(d.id) ?? '…');
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
    // клики по настоящим элементам управления внутри строки — не открытие операции;
    // «2 статьи» (подсказка с tabIndex) — открывает: по §7 клик по ним открывает форму
    if ((e.target as HTMLElement).closest('button, a, input, label, select, [role="combobox"], [role="listbox"]')) return;
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
              counterparty: item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint),
              project: dimensionCell(item, 'projectId', lookups.projects, hint),
              comment: item.comment && (
                <span className="line-clamp-2 max-w-xs break-words" title={item.comment}>
                  {item.comment}
                </span>
              ),
            };
            return (
              <tr
                key={item.id}
                // фокус сюда переводит «Указать» после выбора: кнопка в ячейке исчезает (план 5c)
                tabIndex={-1}
                data-operation-id={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field outline-none last:border-0 focus:bg-field/60 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''}`}
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
import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
import { useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, type CategoryTree, type Company } from '../lib/queries';
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

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties];
  if (!journal.data || !lookups || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);

  return (
    <section>
      <StaleNotice queries={queries} />
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
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
      <LoadMore
        hasNext={journal.hasNextPage}
        loading={journal.isFetchingNextPage}
        failed={journal.isFetchNextPageError}
        onLoad={() => void journal.fetchNextPage()}
      />
    </section>
  );
}
```

Заметки:
- остатки после операции считает сервер по полной истории счёта (§4.7) — клиент только показывает `balanceAfter`/`toBalanceAfter`;
- названия архивных счетов, статей и проектов тоже есть в справочниках (`useAccounts`, дерево статей) — старые операции показывают их имена;
- `onOpenOperation` не передаётся: строка не реагирует на клик до шага 6;
- описание для программ чтения с экрана — скрытый элемент рядом с подписью, видимая подсказка — в портале: `aria-describedby` работает и когда подсказка закрыта.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/floating.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal.spec.ts e2e/companies.spec.ts e2e/money.spec.ts`
Expected: PASS (тест компаний ищет заголовок «Журнал», тест левой панели — переход по `?account=`).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/queries.ts src/client/lib/floating.ts src/client/components/useFloating.ts tests/client/floating.test.ts src/client/components/journal/JournalTable.tsx src/client/components/journal/SplitHint.tsx src/client/components/journal/LoadMore.tsx src/client/pages/JournalPage.tsx e2e/journal.spec.ts
git commit -m "feat: таблица журнала с остатками, разбиениями, бесконечной прокруткой и сортировкой; фильтр по счёту из левой панели

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Тулбар — период, поиск, сумма от/до, выгрузка в Excel, сброс

**Files:**
- Create: `src/client/components/journal/JournalToolbar.tsx`
- Modify: `src/client/pages/JournalPage.tsx`, `e2e/journal.spec.ts`

**Interfaces:**
- Consumes: `PERIODS`, `periodRange`, `journalApiParams`, `isFiltered`, `clearFilter`, `SEARCH_MAX`, `JournalUrlState`, `PeriodKey` (задача 1); `amountInputText` (задача 1); `getCurrency` (`src/shared/currencies.ts`); `parseAmount` (`src/shared/money.ts`); `Field`; `btnSmall`, `inputClass`; `JournalPage` (задача 2).
- Produces:
  - `JournalToolbar(props: { state: JournalUrlState; onChange: (next: JournalUrlState) => void; companyId: number; baseCurrency: string; today: string; actions?: ReactNode })` — поля «Период» (и «С», «По» у «Произвольно»), «Поиск» (`role="search"`), «Сумма от, ₸», «Сумма до, ₸» (символ базовой валюты), ссылка «Выгрузить в Excel», кнопка «Сбросить фильтр» (только когда фильтр задан); `actions` — место для кнопок «Фильтр», «Сохранённые фильтры», «Колонки»;
  - `SEARCH_DEBOUNCE_MS = 300`.

- [ ] **Step 1: Write the failing e2e test**

`e2e/journal.spec.ts` — допишите в конец файла:

```ts
test('тулбар: поиск с паузой, период, сумма от/до в базовой валюте, выгрузка по фильтру, сброс; фильтр переживает перезагрузку', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Тулбар ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const dollars = (await apiPost(page, `${base}/accounts`, { name: 'Доллары', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(5), accountId: kaspi, amount: 150000, comment: 'Ёлка в зале' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: kaspi, amount: 30000, comment: 'Аренда за октябрь' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: dollars, amount: 200 });

  await page.reload();
  await expect(bodyRows(page)).toHaveCount(3);
  // валюта счёта не базовая — под суммой сумма в тенге: $2 × 500 = 1000 ₸
  await expect(bodyRows(page).filter({ hasText: /\u22122,00\s\$/ })).toContainText(/1\s000,00\s₸/);

  // поиск — без учёта регистра и «ё», запрос уходит после паузы и попадает в адрес
  await page.getByLabel('Поиск').fill('ЕЛКА');
  await expect(page).toHaveURL(/q=%D0%95%D0%9B%D0%9A%D0%90$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Ёлка в зале');
  await page.reload();
  await expect(page.getByLabel('Поиск')).toHaveValue('ЕЛКА');
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(bodyRows(page)).toHaveCount(3);

  // поиск, набранный прямо перед сменой периода, не затирает период (Review Focus 1)
  await page.getByLabel('Поиск').fill('аренда');
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(page).toHaveURL(/period=yesterday&q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(page).toHaveURL(/period=yesterday$/);

  // период — по календарной дате в APP_TIMEZONE
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(page).toHaveURL(/period=yesterday$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Аренда за октябрь');
  await expect(bodyRows(page).first().locator('time')).toContainText('вчера');
  await page.getByLabel('Период').selectOption({ label: 'Сегодня' });
  await expect(bodyRows(page)).toHaveCount(2);
  // «Произвольно» начинается с границ выбранного периода
  await page.getByLabel('Период').selectOption({ label: 'Произвольно' });
  const from = await page.getByLabel('С', { exact: true }).inputValue();
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByLabel('По', { exact: true })).toHaveValue(from);
  await expect(bodyRows(page)).toHaveCount(2);
  // дата границы применяется по Enter или уходу из поля, а не на каждую набранную цифру
  const yesterday = yesterdayNoon().slice(0, 10);
  await page.getByLabel('С', { exact: true }).fill(yesterday);
  await page.getByLabel('С', { exact: true }).press('Enter');
  await expect(page).toHaveURL(new RegExp(`from=${yesterday}&to=${from}$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await page.getByLabel('Период').selectOption({ label: 'Всё время' });
  await expect(bodyRows(page)).toHaveCount(3);

  // сумма от/до — в базовой валюте компании (по сумме в тенге)
  await page.getByLabel('Сумма от, ₸').fill('1 000');
  await page.getByLabel('Сумма от, ₸').press('Enter');
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByLabel('Сумма от, ₸')).toHaveValue('1000');
  await page.getByLabel('Сумма до, ₸').fill('1200,5');
  await page.getByLabel('Сумма до, ₸').blur();
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/min=100000&max=120050$/);
  await page.getByLabel('Сумма до, ₸').fill('abc');
  await page.getByLabel('Сумма до, ₸').blur();
  await expect(page.getByLabel('Сумма до, ₸')).toHaveAttribute('aria-invalid', 'true');
  await expect(bodyRows(page)).toHaveCount(1);

  // выгрузка — по текущему фильтру; ссылка отдаёт книгу Excel
  const href = await page.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href');
  expect(href).toContain(`/api/v1/companies/${cid}/operations/export.xlsx?`);
  expect(href).toContain('amountMin=100000&amountMax=120050');
  const xlsx = await page.request.get(href!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByLabel('Сумма от, ₸')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);

  // адрес, исправленный руками: мусор отбрасывается, журнал открывается (Review Focus 2)
  await page.goto(`/c/${cid}/log?account=abc&type=bogus&from=2026-13-01&min=-5&sort=name`);
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);
});
```

Run: `node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" e2e/journal.spec.ts`
Expected: ничего не выводит.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/journal.spec.ts -g "тулбар"`
Expected: FAIL — нет поля «Поиск».

- [ ] **Step 3: Implement**

`src/client/components/journal/JournalToolbar.tsx`:

```ts
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { isValidDate } from '../../../shared/dates';
import { parseAmount } from '../../../shared/money';
import { clearFilter, isFiltered, journalApiParams, PERIODS, periodRange, SEARCH_MAX, type JournalUrlState, type PeriodKey } from '../../lib/journal-filter';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');

type OptionalKey = 'from' | 'to' | 'q' | 'amountMin' | 'amountMax';

/** Фильтр без необязательных полей keys. */
function omit(state: JournalUrlState, ...keys: OptionalKey[]): JournalUrlState {
  const next = { ...state };
  for (const k of keys) delete next[k];
  return next;
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  // последнее значение, которое ушло в адресную строку: отличает внешнюю смену (сброс) от своей
  const sent = useRef(value);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (q === sent.current) return;
    const t = setTimeout(() => {
      sent.current = q;
      onSearchRef.current(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <form
      role="search"
      className="min-w-48 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        sent.current = q;
        onSearchRef.current(q);
      }}
    >
      <Field label="Поиск">
        {(c) => (
          <input
            {...c}
            type="search"
            value={text}
            maxLength={SEARCH_MAX}
            placeholder="Комментарий, контрагент, счёт, статья, проект"
            onChange={(e) => setText(e.target.value)}
            className={compactInput}
          />
        )}
      </Field>
    </form>
  );
}

function AmountInput(props: { label: string; value: number | undefined; minorUnits: number; onCommit: (v: number | undefined) => void }) {
  const shown = props.value === undefined ? '' : amountInputText(props.value, props.minorUnits);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();

  // значение сменилось снаружи (сброс, другая граница) — показываем его
  useEffect(() => {
    setText(shown);
    setError(undefined);
  }, [shown]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      setError(undefined);
      if (props.value !== undefined) props.onCommit(undefined);
      return;
    }
    const minor = parseAmount(t, props.minorUnits);
    if (minor === null) return setError('Введите сумму');
    if (minor < 0) return setError('Сумма не меньше нуля');
    setError(undefined);
    if (minor !== props.value) props.onCommit(minor);
  };

  return (
    <Field label={props.label} error={error} className="w-32">
      {(c) => (
        <input
          {...c}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={compactInput}
        />
      )}
    </Field>
  );
}

/**
 * Граница периода. Дата применяется по уходу из поля или Enter, а не на каждое изменение: пока год набирают
 * по цифре, промежуточные даты («0002-…») не уходят в адрес и не меняют границы местами.
 */
function DateInput(props: { label: string; value: string | undefined; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value ?? '');
  useEffect(() => setText(props.value ?? ''), [props.value]);
  const commit = () => {
    if (text === (props.value ?? '')) return;
    if (text === '' || isValidDate(text)) props.onCommit(text);
  };
  return (
    <Field label={props.label} className="w-40">
      {(c) => (
        <input
          {...c}
          type="date"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={compactInput}
        />
      )}
    </Field>
  );
}

function PeriodPicker({ state, today, onChange }: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void }) {
  const choose = (period: PeriodKey) => {
    // «Произвольно» начинается с границ выбранного сейчас периода — их удобно поправить
    if (period === 'custom') onChange({ ...omit(state, 'from', 'to'), period, ...periodRange(state, today) });
    else onChange({ ...omit(state, 'from', 'to'), period });
  };
  const setBound = (key: 'from' | 'to', value: string) => {
    onChange(value ? { ...state, period: 'custom', [key]: value } : { ...omit(state, key), period: 'custom' });
  };
  return (
    <>
      <Field label="Период" className="w-48">
        {(c) => (
          <select {...c} value={state.period} onChange={(e) => choose(e.target.value as PeriodKey)} className={compactInput}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {state.period === 'custom' && (
        <>
          <DateInput label="С" value={state.from} onCommit={(v) => setBound('from', v)} />
          <DateInput label="По" value={state.to} onCommit={(v) => setBound('to', v)} />
        </>
      )}
    </>
  );
}

/**
 * Тулбар журнала (§7): период, поиск, сумма от/до в базовой валюте, выгрузка в Excel по текущему фильтру, сброс.
 * actions — кнопки модалки «Фильтр», сохранённых фильтров и колонок (их добавляют следующие задачи).
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  actions?: ReactNode;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  const setAmount = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => onChange(v === undefined ? omit(state, key) : { ...state, [key]: v });
  // сброс пересоздаёт поле поиска: набранный, но ещё не отправленный запрос не вернёт фильтр после сброса
  const [searchKey, setSearchKey] = useState(0);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <PeriodPicker state={state} today={props.today} onChange={onChange} />
        <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />
        <AmountInput label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
        <AmountInput label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.actions}
        <a href={exportHref} download className={btnSmall}>
          Выгрузить в Excel
        </a>
        {isFiltered(state) && (
          <button
            type="button"
            onClick={() => {
              setSearchKey((k) => k + 1);
              onChange(clearFilter(state));
            }}
            className={btnSmall}
          >
            Сбросить фильтр
          </button>
        )}
      </div>
    </div>
  );
}
```

Почему поиск устроен так: таймер паузы вызывает последнюю версию `onSearch` (через ref), поэтому условие, выбранное за эти 300 мс (период, счёт), не затирается старым состоянием фильтра (Review Focus 1). `sent` хранит последнее отправленное значение — смену поиска снаружи (сброс, сохранённый фильтр) поле отличает от своей. «Сбросить фильтр» меняет `key` поля поиска: поле пересоздаётся, и набранный, но ещё не отправленный запрос не вернёт условие после сброса. Даты «Произвольно» (`DateInput`) применяются по Enter или уходу из поля, как сумма.

`src/client/pages/JournalPage.tsx` — замените файл целиком:

```ts
import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
import { useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, type CategoryTree, type Company } from '../lib/queries';
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

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties];
  if (!journal.data || !lookups || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);

  return (
    <section>
      <StaleNotice queries={queries} />
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
      <JournalToolbar state={state} onChange={update} companyId={company.id} baseCurrency={company.baseCurrency} today={today} />
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
      <LoadMore
        hasNext={journal.hasNextPage}
        loading={journal.isFetchingNextPage}
        failed={journal.isFetchNextPageError}
        onLoad={() => void journal.fetchNextPage()}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/journal/JournalToolbar.tsx src/client/pages/JournalPage.tsx e2e/journal.spec.ts
git commit -m "feat: тулбар журнала — период в APP_TIMEZONE, поиск с паузой, сумма от/до, выгрузка в Excel по фильтру

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Видимые колонки в настройках пользователя

**Files:**
- Create: `src/client/components/Popover.tsx`, `src/client/components/journal/ColumnsPicker.tsx`
- Modify: `src/client/pages/JournalPage.tsx`, `e2e/journal.spec.ts`

**Interfaces:**
- Consumes: `JOURNAL_COLUMNS`, `JOURNAL_COLUMNS_PREF`, `toggleColumn`, `visibleColumns`, `JournalColumnId` (задача 1); `useFloating` (задача 2); `api` (`lib/api.ts`); `queryClient` (`query.ts`); `btnSmall`; `JournalToolbar` (задача 3).
- Produces:
  - `Popover(props: { label: ReactNode; ariaLabel?: string; buttonClassName?: string; align?: 'left' | 'right'; panelClassName?: string; disabled?: boolean; children: (close: (returnFocus?: boolean) => void) => ReactNode })` — кнопка с `aria-haspopup="dialog"` и `aria-expanded`; панель — немодальный `role="dialog"` с именем кнопки, рисуется порталом в `body` (`useFloating`, задача 2), поэтому контейнеры с прокруткой её не обрезают; при открытии фокус на первом элементе панели (после расчёта места — в невидимый элемент фокус не переходит), Esc закрывает и возвращает фокус, клик мимо и уход фокуса закрывают. План 5c строит на нём сохранённые фильтры и списки «Указать»;
  - `ColumnsPicker({ visible }: { visible: readonly JournalColumnId[] })` — кнопка «Колонки», флажки «Видимые колонки».

- [ ] **Step 1: Write the failing e2e test**

`e2e/journal.spec.ts` — допишите в конец файла:

```ts
test('колонки: выбор сохраняется в настройках пользователя и переживает перезагрузку; дату и сумму не скрыть', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Колонки ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'Видимый комментарий' });
  await page.reload();
  const header = (name: string) => table(page).getByRole('columnheader', { name, exact: true });
  await expect(header('Комментарий')).toBeVisible();

  // настройка общая для пользователя admin и остальных e2e: после теста все колонки снова видны
  try {
    const columns = page.getByRole('button', { name: 'Колонки', exact: true });
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('checkbox', { name: 'Дата' })).toBeDisabled();
    // фокус — на первом доступном флажке
    await expect(page.getByRole('checkbox', { name: 'Счёт' })).toBeFocused();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await page.getByRole('checkbox', { name: 'Комментарий' }).uncheck();
    await saved;
    await expect(header('Комментарий')).toHaveCount(0);
    await expect(table(page)).not.toContainText('Видимый комментарий');
    // Esc закрывает панель и возвращает фокус на кнопку
    await page.keyboard.press('Escape');
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await expect(columns).toBeFocused();

    await page.reload();
    await expect(header('Счёт')).toBeVisible();
    await expect(header('Комментарий')).toHaveCount(0);
  } finally {
    await page.request.put('/api/v1/preferences/journal.columns', { data: { value: null }, headers: csrf(page) });
  }
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/journal.spec.ts -g "колонки"`
Expected: FAIL — нет кнопки «Колонки».

- [ ] **Step 3: Implement**

`src/client/components/Popover.tsx`:

```ts
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { btnSmall } from './ui';
import { useFloating } from './useFloating';

/**
 * Всплывающая панель у кнопки: кнопка с aria-haspopup и aria-expanded, панель — немодальный role="dialog".
 * Панель рисуется порталом в body (position: fixed), поэтому её не обрезают контейнеры с прокруткой
 * (обёртка таблицы журнала). При открытии фокус — на первом элементе панели; Esc закрывает и возвращает
 * фокус на кнопку; клик мимо и уход фокуса из кнопки и панели закрывают её.
 * children получает close(returnFocus) — закрыть панель после выбора.
 */
export function Popover(props: {
  /** Видимая подпись кнопки. */
  label: ReactNode;
  /** Доступное имя кнопки и панели, если подпись — не текст или нужна другая. */
  ariaLabel?: string;
  buttonClassName?: string;
  /** Выравнивание панели по кнопке. */
  align?: 'left' | 'right';
  panelClassName?: string;
  disabled?: boolean;
  children: (close: (returnFocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const style = useFloating(open, buttonRef, panelRef, props.align);
  // до расчёта места панель невидима, а в невидимый элемент фокус не переходит
  const placed = open && style.visibility !== 'hidden';
  const name = props.ariaLabel ?? (typeof props.label === 'string' ? props.label : undefined);

  /** Узел — внутри кнопки или панели (панель не внутри rootRef: она в портале). */
  const inside = (node: Node | null) => !!node && (!!rootRef.current?.contains(node) || !!panelRef.current?.contains(node));

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (placed) panelRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex="0"], a[href], select')?.focus();
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        // события из портала всплывают по дереву React: фокус ушёл и из кнопки, и из панели — закрываем
        if (open && e.relatedTarget && !inside(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
        className={props.buttonClassName ?? btnSmall}
      >
        {props.label}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={name}
            style={style}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
            className={`z-40 overflow-y-auto rounded-2xl bg-card p-3 text-ink shadow-xl ring-1 ring-field ${props.panelClassName ?? 'w-64'}`}
          >
            {props.children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}
```

`src/client/components/journal/ColumnsPicker.tsx`:

```ts
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, type JournalColumnId } from '../../lib/journal-columns';
import { queryClient } from '../../lib/query';
import { Popover } from '../Popover';

/**
 * «Колонки»: флажки видимых колонок журнала. Выбор виден сразу и сохраняется в настройках пользователя
 * (`journal.columns`). Учитывается только ответ на последний выбор (быстрые щелчки подряд не путаются):
 * после успеха выбор берётся из кэша настроек, после сбоя настройки перечитываются с сервера
 * и показывается ошибка.
 */
export function ColumnsPicker({ visible }: { visible: readonly JournalColumnId[] }) {
  const [error, setError] = useState<string | null>(null);
  // флажок отражает выбор сразу: кэш TanStack Query оповещает подписчиков не синхронно
  const [override, setOverride] = useState<JournalColumnId[] | null>(null);
  const seq = useRef(0);
  const current = override ?? visible;

  const toggle = (id: JournalColumnId) => {
    const next = toggleColumn(current, id);
    const mine = ++seq.current;
    setOverride(next);
    setError(null);
    queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [JOURNAL_COLUMNS_PREF]: next }));
    api(`/preferences/${encodeURIComponent(JOURNAL_COLUMNS_PREF)}`, { method: 'PUT', body: { value: next } })
      .then(() => {
        if (mine !== seq.current) return;
        queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [JOURNAL_COLUMNS_PREF]: next }));
        setOverride(null);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOverride(null);
        setError('Не удалось сохранить выбор колонок');
        void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      });
  };

  return (
    <Popover label="Колонки">
      {() => (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Видимые колонки</legend>
          {JOURNAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={c.fixed || current.includes(c.id)} disabled={c.fixed} onChange={() => toggle(c.id)} />
              {c.label}
              {c.fixed && <span className="text-xs text-muted">(всегда)</span>}
            </label>
          ))}
          {error && (
            <p role="alert" className="mt-2 text-xs text-expense">
              {error}
            </p>
          )}
        </fieldset>
      )}
    </Popover>
  );
}
```

Флажок держит выбор в своём состоянии (`override`): кэш TanStack Query оповещает подписчиков не синхронно, и без этого флажок на мгновение возвращался бы в прежнее положение (Playwright ловит это как «клик не изменил состояние»). После ответа на последний выбор (`seq`) `override` снимается: при успехе выбор берётся из кэша настроек, при сбое настройки перечитываются с сервера — не из устаревшего снимка.

`src/client/pages/JournalPage.tsx` — замените файл целиком:

```ts
import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
import { useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, type CategoryTree, type Company } from '../lib/queries';
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

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  const queries = [meta, journal, accounts, categories, projects, counterparties];
  if (!journal.data || !lookups || !timeZone || !today) return <Pending queries={queries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  const items = journal.data.pages.flatMap((p) => p.items);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);

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
        actions={<ColumnsPicker visible={columns} />}
      />
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
      <LoadMore
        hasNext={journal.hasNextPage}
        loading={journal.isFetchingNextPage}
        failed={journal.isFetchNextPageError}
        onLoad={() => void journal.fetchNextPage()}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/Popover.tsx src/client/components/journal/ColumnsPicker.tsx src/client/pages/JournalPage.tsx e2e/journal.spec.ts
git commit -m "feat: выбор видимых колонок журнала — в настройках пользователя

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Окно «Фильтр» со всеми условиями §6

**Files:**
- Create: `src/client/components/Modal.tsx`, `src/client/components/journal/FilterDialog.tsx`
- Modify: `src/client/pages/JournalPage.tsx`, `e2e/journal.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `JournalUrlState`, `OperationType`, `sortedUnique`, `filterConditionCount` (задача 1); `matchesQuery` (`src/shared/search.ts`); типы `Account`, `CategoryNode`, `CategoryTree`, `Counterparty`, `Project`, `Tag`, хук `useTags` (`queries.ts`); `btnPrimary`, `btnSecondary`, `btnSmall`, `inputClass`.
- Produces:
  - `Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string })` — `<dialog aria-labelledby>` через `showModal()`; содержимое монтируется заново при каждом открытии; при закрытии фокус возвращается на элемент, с которого открыли;
  - `interface FilterDialogData { accounts; categories; projects; counterparties; tags }`, `FilterDialog(props: { open; state; data; onApply: (next: JournalUrlState) => void; onClose: () => void })` — окно «Фильтр»: «Готово», «Очистить», «Отмена». План 5c добавит свойство `onSave` и кнопку «Сохранить фильтр»;
  - кнопка тулбара «Фильтр» (`aria-haspopup="dialog"`), при выбранных условиях — «Фильтр · N».

- [ ] **Step 1: Write the failing e2e test**

`e2e/journal.spec.ts` — допишите в конец файла:

```ts
test('модалка «Фильтр»: все условия §6, «Готово» применяет, Esc закрывает без изменений; счёт из левой панели отмечен', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фильтр ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const room = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Помещение' })).category.id;
  const utilities = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Коммуналка', parentId: room })).category.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const supplier = (await apiPost(page, `${base}/counterparties`, { name: 'ИП Поставщик', type: 'supplier' })).counterparty.id;
  await apiPost(page, `${base}/counterparties`, { name: 'ТОО Арендодатель', type: 'supplier' });
  const tag = (await apiPost(page, `${base}/tags`, { name: 'Смена' })).tag.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(4),
    accountId: kaspi,
    amount: 100,
    counterpartyId: supplier,
    comment: 'операция A',
    lines: [{ categoryId: utilities, projectId: club, amount: 100 }],
  });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: cash, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 300, tagIds: [tag], comment: 'операция C' });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: kaspi, toAccountId: cash, amount: 400, comment: 'операция D' });
  const comments = async () => (await table(page).locator('tbody tr').allInnerTexts()).map((t) => /операция ([A-D])/.exec(t)?.[1]).join('');

  await page.reload();
  await expect(bodyRows(page)).toHaveCount(4);
  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });

  // тип и родительская статья (включает дочернюю)
  await filterButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Расход' }).check();
  await dialog.getByRole('checkbox', { name: 'Помещение' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}$`));
  await expect(filterButton).toHaveText('Фильтр · 2');
  await expect.poll(comments).toBe('A');

  // «Без статьи» — вместе с выбранной статьёй через ИЛИ
  await filterButton.click();
  await expect(dialog.getByRole('checkbox', { name: 'Расход' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Без статьи' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('BA');

  // Esc закрывает без изменений
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Перевод' }).check();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));

  // «Очистить», поиск контрагента, тег, «Без проекта»
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByLabel('Найти контрагента').fill('постав');
  await expect(dialog.getByRole('checkbox', { name: 'ТОО Арендодатель' })).toHaveCount(0);
  await dialog.getByLabel('Найти контрагента').press('Enter'); // Enter в поиске не применяет фильтр
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'ИП Поставщик' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`counterparty=${supplier}$`));
  await expect.poll(comments).toBe('A');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('C');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByRole('checkbox', { name: 'Без проекта' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('DCB');

  // счёт из левой панели — отмечен в модалке, его можно снять
  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect.poll(comments).toBe('DB');
  await expect(filterButton).toHaveText('Фильтр · 1');
  await filterButton.click();
  await expect(dialog.getByRole('checkbox', { name: 'Наличные' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Наличные' }).uncheck();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/journal.spec.ts -g "модалка"`
Expected: FAIL — нет кнопки «Фильтр».

- [ ] **Step 3: Implement**

`src/client/components/Modal.tsx`:

```ts
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Модальное окно на `<dialog>`: открывается через showModal() — браузер держит фокус внутри окна,
 * делает остальную страницу недоступной и закрывает окно по Esc. При закрытии фокус возвращается
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 */
export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        props.onClose();
        opener.current?.focus();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-3xl bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40 ${props.className ?? 'max-w-2xl'}`}
    >
      {props.open && (
        <div className="p-6">
          <h2 id={titleId} className="mb-4 text-xl font-bold">
            {props.title}
          </h2>
          {props.children}
        </div>
      )}
    </dialog>
  );
}
```

`src/client/components/journal/FilterDialog.tsx`:

```ts
import { useState, type ReactNode } from 'react';
import { matchesQuery } from '../../../shared/search';
import { sortedUnique, type JournalUrlState, type OperationType } from '../../lib/journal-filter';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from '../../lib/queries';
import { Modal } from '../Modal';
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
function FilterForm(props: { state: JournalUrlState; data: FilterDialogData; onApply: (next: JournalUrlState) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<JournalUrlState>(props.state);
  const [cpQuery, setCpQuery] = useState('');
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
        <button type="button" onClick={clear} className={btnSecondary}>
          Очистить
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: JournalUrlState) => void;
  onClose: () => void;
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
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSmall } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { filterConditionCount, isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
import { useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useTags, type CategoryTree, type Company } from '../lib/queries';
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
      />
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
      <LoadMore
        hasNext={journal.hasNextPage}
        loading={journal.isFetchingNextPage}
        failed={journal.isFetchNextPageError}
        onLoad={() => void journal.fetchNextPage()}
      />
    </section>
  );
}
```

`README.md` — замените строку

```
Пока нет (следующие шаги): экран журнала и форма операции, отчёты, мобильная версия и PWA.
```

на

```
- **Экран журнала (шаг 5):**
  - таблица операций: дата («сегодня», «вчера»), сумма по типу и в базовой валюте, счёт и остаток после операции (у перевода — оба), контрагент, статья, проект, комментарий; у разбитых операций — «2 проекта» с подсказкой;
  - бесконечная прокрутка, сортировка по дате и сумме;
  - период, поиск, сумма от/до, окно «Фильтр» со всеми условиями, выбор колонок, выгрузка в Excel по фильтру;
  - фильтр хранится в адресе страницы; клик по счёту в левой панели фильтрует журнал.

Пока нет (следующие шаги): сохранённые фильтры, «Указать» и массовые действия на экране журнала, форма операции, отчёты, мобильная версия и PWA.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/journal.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/Modal.tsx src/client/components/journal/FilterDialog.tsx src/client/pages/JournalPage.tsx e2e/journal.spec.ts README.md
git commit -m "feat: окно «Фильтр» журнала — тип, счета, статьи, проекты, контрагенты, теги и «без …»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §7 Каркас: клик по счёту в левой панели фильтрует журнал (`?account=`, решение 3 плана 4b) | Tasks 1, 2 (e2e «клик по счёту…»), 5 (счёт отмечен в окне) |
| §7 Тулбар: период (9 вариантов) в APP_TIMEZONE | Tasks 1 (`periodRange`), 3 |
| §7 Тулбар: поиск (§6.1 — на сервере), сумма от/до в базовой валюте | Task 3 |
| §7 Тулбар: «Фильтр» — модалка с полями §6, «Готово» | Task 5 («Сохранить фильтр» — план 5c) |
| §7 Тулбар: видимые колонки в `user_preferences` | Tasks 1, 4 |
| §7 Тулбар: экспорт в Excel по текущему фильтру | Task 3 (ссылка, ответ 200) |
| §7 Колонки: дата с «сегодня»/«вчера», сумма по типу и в базовой валюте, счёт и остаток (у перевода оба), контрагент, статья, проект, комментарий | Tasks 1, 2 |
| §7 Разбитые операции: «N статей/проектов» с подсказкой; «доля проекта» при фильтре по проекту | Tasks 1, 2 |
| §7 Бесконечная прокрутка, сортировка по дате и сумме | Task 2 |
| §7 Клик по строке открывает форму | точка подключения `onOpenOperation` (Task 2); форма — шаг 6 |
| §10 E2E, сценарий 3: доход, расход на два проекта, перевод KZT → USD; балансы в панели и остатки в журнале | Task 2 |
| §4.2 `user_preferences`: видимые колонки журнала | Task 4 |

Вне этого плана: сохранённые фильтры, «Указать», массовые действия, тост «Удалено N — Отменить», сброс кэшей после изменений операций (план 5c); форма операции (шаг 6); мобильная версия журнала (шаг 7).
