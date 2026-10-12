# Этап 1.5, план 1.5-5b: телефон — фильтр в один шаг, карточка журнала, формы на 390 px — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина плана 1.5-5 «Телефон» из §13 спецификации этапа 1.5:
- фильтр в один шаг (§8.5): строка «Поиск | ⟳ | воронка · N | ▾», окно «Фильтры» на весь экран с «Периодом» первым полем и блоком «Ещё условия»; панель «Период и условия» убрана; e2e «Выбрать даты» с вложенными календарями «С» и «По» на телефоне (итоги 1.5-2a №3, 1.5-3c №4);
- карточка журнала в порядке Finmap с категорией мелкой 4-й строкой (§8.4, решение владельца 1);
- формы на 390 px (§8.7): на весь экран, ряд операторов, главная кнопка; на сенсорном экране фокус после «создать похожий» и «Дублировать» не поднимает клавиатуру (итоги 1.5-3b «Телефон»); e2e подписок на `visualViewport` (итоги 1.5-3a №1);
- сверка `npm run shots:ux` и список «Проверить на телефоне».

**Предусловие:** выполнен план [1.5-5a](2026-10-12-stage1_5-plan5a-phone-shell.md): шапка с группой «Добавить операцию» (`bar(page)` в `e2e/mobile.spec.ts` находит её и на телефоне), `MobileTabBar` (`<nav aria-label="Разделы">`), экран «Настройки», `expectNoSideScroll`, `todayAgo`, `yesterdayNoon`, `cards` в `e2e/mobile.spec.ts`. Ожидаемо на старте: `npm test`, `npm run typecheck`, `npm run test:e2e` зелёные, `shots:ux` 48/48.

**Architecture:**
- **Фильтр на телефоне** — тот же `FilterDialog`, но черновик окна теперь `FilterDraft`: условия окна и, если окно открыли на телефоне, ещё период, сумма и сортировка. Чистые функции в `lib/journal-filter.ts` (`filterDraftFrom`, `applyFilterDraft`, `clearFilterDraft`, `phoneMoreSet`, `phoneFilterCount`, `journalExportHref`). В окне — существующие `PeriodMenu` и `AmountRange` поверх черновика.
- **Карточка** — `journalCardText` отдаёт строки карточки (дата, сумма, контрагент, счёт, категория), `JournalCards` их раскладывает.
- **Фокус в сумме на сенсорном экране** — чистая `refocusTarget(coarse)` в `focus-trap.ts`; `AmountField` по сигналу ставит фокус в поле или на «×» окна.
- Сервер не меняется.

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §5.1 («Выбрать даты»), §5.6, §8.4, §8.5, §8.7, §11, §12.1 (`e2e/mobile.spec.ts`), §12.2 (`journal-card`), §13 (блок «Решения планирования плана 1.5-5» №7–№10), §14.3 №1. Аудит: [04-mobile.md](../../research/ux-parity/04-mobile.md) — №5, №6, №10, №12, №13. Снимки Finmap: `docs/research/screens/v2/m02-log-closed-panel.png`, `m04-op-open.png`, `m05-income.png`, `m06-filter.png`.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-5», №7–№10) тем же коммитом, что и план.

1. **Строка над карточками (§8.5):** «Поиск» (подсказка «Поиск», лупа слева, кнопка «Найти»), ⟳ «Обновить» (итог в живой области, сбой виден), воронка «Фильтр · N» (N — период, сумма от и до, условия окна; без условий — «Фильтр») и ▾ «Быстрые фильтры». Цели касания — 44 px. ✕ «Сбросить фильтр» в строке нет: «Очистить» в окне снимает период, сумму и условия (сортировка остаётся).
2. **Окно «Фильтры» на телефоне (§8.5):** на весь экран; первым полем — «Период» (то же меню, что пилюля, во всю ширину); затем условия; в конце сворачиваемый блок «Ещё условия» — «Сумма от/до», «Сортировка», «Выгрузить в Excel» (по черновику окна). Блок открыт при открытии окна, если задана сумма или сортировка не «Сначала новые». Всё применяется вместе по «Готово»; «×» и Esc ничего не меняют. Режим телефона запоминается при открытии окна (`FilterDraft.phone`): окно браузера стало шире — набранный период не теряется. Панель «Период и условия» удалена (закрывает отложенные 7 №1–№3).
3. **Карточка (§8.4):** строка 1 — дата «12 окт. 2026» (без «сегодня» и времени) слева, сумма справа, под ней мелко — сумма в базовой валюте или зачисление; строка 2 — контрагент (если есть); строка 3 — счёт («Касса → Kaspi» у перевода); строка 4 — категория мелко серым («Без категории», «2 категории»; у перевода строки нет). Комментария нет. `title` кнопки — «Открыть операцию» (закрывает отложенное 7 №4).
4. **Формы (§8.7, итоги 1.5-3b «Телефон»):** форма остаётся на весь экран (аудит 04 №12), ряд операторов под суммой — вместе с калькулятором. На устройстве с пальцем возвраты фокуса «в сумму» («Добавить и создать похожий», «Дублировать платёж», «Загрузить актуальную», сбой без поля с ошибкой) ставят фокус на «×» окна (`refocusTarget`).
5. **Окно на весь экран телефона** — общий класс `phoneFullScreenModal` в `ui.ts` (форма операции и «Фильтры»).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: фильтр в адресе страницы, периоды «Сегодня» и «Вчера», сумма в базовой валюте под суммой, «Отменить» после удаления. **Мёртвых кнопок нет.**
- **Телефон (§8):** ширина меньше 768 px (`useIsMobile`, варианты `max-md:`/`md:`); проверка на 390×844.
- **Карточка (§8.4):** строка 1 — дата «27 сент. 2026», серым, без времени | сумма со знаком и цветом, под ней мелко сумма в базовой валюте или зачисление; строка 2 — контрагент (если есть); строка 3 — счёт, серым, у перевода «Касса → Kaspi»; строка 4 — категория мелко серым («2 категории», у перевода строки нет). Комментарий не показывается. У кнопки карточки подсказка «Открыть операцию».
- **Фильтр (§8.5):** строка над списком — поле «Поиск» (подпись `sr-only`, лупа слева, плейсхолдер «Поиск»), ⟳, иконка-воронка со счётчиком и рядом ▾ «Быстрые фильтры». Воронка сразу открывает окно «Фильтры» (§5.6), на телефоне на весь экран: первым полем «Период» — то же меню, что пилюля §5.1; в конце сворачиваемый блок «Ещё условия»: «Сумма от/до», «Сортировка», ссылка «Выгрузить в Excel». Панель «Фильтры» справа убирается.
- **Формы (§8.7):** на весь экран, шапка с «×» липкая; раскладка и подписи — как §6; ряд операторов под суммой остаётся вместе с иконкой калькулятора; «Указать», массовые действия и колонки на телефоне не показываются.
- **Время и даты:** «сегодня» — в `APP_TIMEZONE` (`Asia/Almaty`); формат даты карточки — `formatDateShortRu`.
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`; минус — U+2212. **Цвет:** текст цвета расхода — только `text-expense-strong`.
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.** Сервер и схема БД не меняются.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.
- **Концы строк:** правки «найдите → замените» — инструментом правки файлов; копируйте найденный текст из файла, если он разошёлся с планом пробелами.
- **E2E:** порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty`; один пользователь `admin`/`e2e-password-1` и одна база на прогон (имена уникальны); `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общие настройки пользователя восстанавливаются в `try/finally`; без фиксированных пауз. `journal-actions.spec.ts:555` — известный нестабильный тест.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Окно «Фильтры» на телефоне закрыли «×» после смены периода:** фильтр не меняется; «Готово» применяет период, сумму, сортировку и условия вместе; запрос поиска, дошедший до адреса при открытом окне, не теряется. Тесты — задача 1 (unit `applyFilterDraft`, e2e).
2. **Окно браузера стало шире при открытом окне «Фильтры» (поворот телефона):** набранный в окне период применяется по «Готово». Тесты — задача 1 (unit: черновик помнит режим; e2e).
3. **«Выбрать даты» внутри окна на весь экран:** вложенные календари «С» и «По» открываются касанием и помещаются на экране, Esc в календаре закрывает только его. Тест — задача 1 (e2e с `hasTouch`).
4. **Перевод и операция без контрагента в карточке:** пустых строк нет, у перевода нет строки категории; дата — по поясу приложения на границе суток. Тесты — задача 2 (unit, e2e).
5. **Касание: после «Добавить и создать похожий» и «Дублировать платёж»** фокус на «×», не в сумме — клавиатура сама не поднимается. Тесты — задача 3 (unit `refocusTarget`, e2e с `hasTouch`).

---

## Карта файлов

```
src/client/lib/journal-filter.ts                    # phoneFilterCount, FilterDraft, filterDraftFrom, applyFilterDraft, clearFilterDraft, phoneMoreSet, pickPhoneFilterFields, journalExportHref
src/client/components/journal/JournalToolbar.tsx    # строка телефона «Поиск | ⟳ | воронка | ▾», без панели «Период и условия»
src/client/components/journal/FilterButton.tsx      # compact: воронка со счётчиком
src/client/components/journal/FilterDialog.tsx      # черновик FilterDraft, «Период» первым, «Ещё условия», на весь экран
src/client/components/journal/PeriodMenu.tsx        # wide — во всю ширину
src/client/components/journal/JournalCards.tsx      # строки карточки по §8.4
src/client/lib/journal-card.ts                      # дата, сумма, контрагент, счёт, категория
src/client/components/focus-trap.ts                 # refocusTarget
src/client/components/operation/AmountField.tsx     # возврат фокуса на «×» на сенсорном экране
src/client/components/operation/OperationForm.tsx   # MODAL_CLASS через phoneFullScreenModal
src/client/components/ui.ts                         # phoneFullScreenModal
src/client/pages/JournalPage.tsx                    # черновик окна, счётчик воронки, без today у карточек
scripts/ux-shots.ts                                 # cm06-filter
tests/client/journal-panel.test.ts, journal-card.test.ts, focus-trap.test.ts
e2e/mobile.spec.ts
```

---

### Task 1: Фильтр в один шаг — строка над карточками и окно «Фильтры» на весь экран

**Files:**
- Modify: `src/client/lib/journal-filter.ts`, `src/client/components/journal/JournalToolbar.tsx` (полная замена), `src/client/components/journal/FilterButton.tsx` (полная замена), `src/client/components/journal/FilterDialog.tsx` (полная замена), `src/client/components/journal/PeriodMenu.tsx`, `src/client/pages/JournalPage.tsx`, `src/client/components/ui.ts`, `src/client/components/operation/OperationForm.tsx`
- Test: `tests/client/journal-panel.test.ts` (полная замена), `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `PeriodMenu`, `AmountRange`, `MultiSelectField`, `SavedFiltersMenu`, `Modal` (`phoneFullScreen`), `DIMENSIONS`, `dimensionOptions`, `dimensionSelected`, `toggleDimension` (`lib/journal-filter-dialog.ts`), `pickDialogFields`, `applyDialogFields`, `journalApiParams`, `SORT_CHOICES`, `EMPTY_JOURNAL_STATE`.
- Produces:
  - `type PhoneFilterFields = Pick<JournalUrlState, 'period' | 'from' | 'to' | 'amountMin' | 'amountMax' | 'sort' | 'order'>`;
  - `interface FilterDraft { fields: DialogFields; phone: PhoneFilterFields | null }`;
  - `pickPhoneFilterFields(state: JournalUrlState): PhoneFilterFields`; `filterDraftFrom(state: JournalUrlState, phone: boolean): FilterDraft`; `applyFilterDraft(state: JournalUrlState, draft: FilterDraft): JournalUrlState`; `clearFilterDraft(draft: FilterDraft): FilterDraft`; `phoneMoreSet(fields: PhoneFilterFields): boolean`;
  - `phoneFilterCount(state: JournalUrlState): number` (бывшая `panelConditionCount`); `journalExportHref(companyId: number, state: JournalUrlState, today: string): string`;
  - `FilterDialog` — свойства `phone: boolean`, `today: string`, `baseCurrency: string`, `exportHref?: (state: JournalUrlState) => string`, `onApply: (draft: FilterDraft) => void`, `onSave?: (draft: FilterDraft, name: string) => Promise<void>`;
  - `FilterButton` — свойство `compact?: boolean`; `PeriodMenu` — свойство `wide?: boolean`;
  - `phoneFullScreenModal` (`ui.ts`).

- [ ] **Step 1: Write the failing unit test**

Замените `tests/client/journal-panel.test.ts` целиком:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyFilterDraft,
  clearFilterDraft,
  EMPTY_JOURNAL_STATE,
  filterDraftFrom,
  journalExportHref,
  phoneFilterCount,
  phoneMoreSet,
  pickPhoneFilterFields,
  SORT_CHOICES,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('воронка на телефоне (§8.5 этапа 1.5)', () => {
  it('считает всё, что задаёт окно «Фильтры» на телефоне: период, сумму от и до, условия окна; поиск и сортировка не в счёт', () => {
    expect(phoneFilterCount(EMPTY_JOURNAL_STATE)).toBe(0);
    expect(phoneFilterCount(state({ q: 'аренда', sort: 'amount', order: 'asc' }))).toBe(0);
    expect(phoneFilterCount(state({ period: 'month' }))).toBe(1);
    expect(phoneFilterCount(state({ period: 'custom', from: '2026-10-01' }))).toBe(1);
    expect(phoneFilterCount(state({ amountMin: 100, amountMax: 500 }))).toBe(2);
    // условия окна — по разделу, как у кнопки «Фильтр»: два счёта — одно условие, «без категории» и категория — одно
    expect(phoneFilterCount(state({ types: ['expense'], accountIds: [1, 2], categoryIds: [3], withoutCategory: true }))).toBe(3);
    expect(phoneFilterCount(state({ period: 'today', amountMin: 0, tagIds: [7] }))).toBe(3);
  });

  it('сортировка списком: четыре варианта, без повторов', () => {
    expect(SORT_CHOICES.map((s) => `${s.sort}:${s.order}`)).toEqual(['date:desc', 'date:asc', 'amount:desc', 'amount:asc']);
  });
});

describe('черновик окна «Фильтры» (§5.6, §8.5 этапа 1.5)', () => {
  const current = state({ period: 'month', q: 'аренда', amountMin: 100, types: ['expense'], sort: 'amount', order: 'asc' });

  it('на компьютере — только условия окна: период, поиск, сумма и сортировка остаются текущими', () => {
    const draft = filterDraftFrom(current, false);
    expect(draft.phone).toBeNull();
    const next = applyFilterDraft(state({ ...current, q: 'новый' }), { ...draft, fields: { ...draft.fields, types: ['income'] } });
    expect(next).toStrictEqual(state({ period: 'month', q: 'новый', amountMin: 100, types: ['income'], sort: 'amount', order: 'asc' }));
  });

  it('на телефоне — ещё период, сумма и сортировка; поиск берётся текущий (дошёл до адреса, пока окно было открыто)', () => {
    const draft = filterDraftFrom(current, true);
    expect(draft.phone).toStrictEqual({ period: 'month', amountMin: 100, sort: 'amount', order: 'asc' });
    const next = applyFilterDraft(state({ ...current, q: 'новый' }), {
      fields: draft.fields,
      phone: { period: 'custom', from: '2026-10-01', amountMax: 500, sort: 'date', order: 'desc' },
    });
    // сумму «от» в черновике сняли — в фильтре её нет совсем
    expect(next).toStrictEqual(state({ period: 'custom', from: '2026-10-01', q: 'новый', amountMax: 500, types: ['expense'] }));
  });

  it('pickPhoneFilterFields не пишет пустые границы и суммы', () => {
    expect(pickPhoneFilterFields(EMPTY_JOURNAL_STATE)).toStrictEqual({ period: 'all', sort: 'date', order: 'desc' });
    expect(pickPhoneFilterFields(state({ period: 'custom', to: '2026-10-05', amountMax: 0 }))).toStrictEqual({
      period: 'custom',
      to: '2026-10-05',
      amountMax: 0,
      sort: 'date',
      order: 'desc',
    });
  });

  it('«Очистить»: на телефоне — условия, период и сумма, сортировка остаётся; на компьютере — только условия окна', () => {
    const phone = clearFilterDraft(filterDraftFrom(current, true));
    expect(phone).toStrictEqual({ fields: filterDraftFrom(EMPTY_JOURNAL_STATE, false).fields, phone: { period: 'all', sort: 'amount', order: 'asc' } });
    expect(applyFilterDraft(current, phone)).toStrictEqual(state({ q: 'аренда', sort: 'amount', order: 'asc' }));
    const desktop = clearFilterDraft(filterDraftFrom(current, false));
    expect(desktop.phone).toBeNull();
    expect(applyFilterDraft(current, desktop)).toStrictEqual(state({ period: 'month', q: 'аренда', amountMin: 100, sort: 'amount', order: 'asc' }));
  });

  it('«Ещё условия» открыт при открытии окна, если задана сумма или сортировка не «Сначала новые»', () => {
    expect(phoneMoreSet(pickPhoneFilterFields(EMPTY_JOURNAL_STATE))).toBe(false);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ period: 'today' })))).toBe(false);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ amountMax: 0 })))).toBe(true);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ order: 'asc' })))).toBe(true);
  });

  it('выгрузка в Excel — по фильтру, параметрами API журнала', () => {
    expect(journalExportHref(5, state({ period: 'today', types: ['expense'] }), '2026-10-12')).toBe(
      '/api/v1/companies/5/operations/export.xlsx?from=2026-10-12&to=2026-10-12&types=expense&sort=date&order=desc',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/journal-panel.test.ts`
Expected: FAIL — `phoneFilterCount`, `filterDraftFrom` и другие не экспортируются.

- [ ] **Step 3: Черновик окна в `lib/journal-filter.ts`**

В `src/client/lib/journal-filter.ts` замените

```ts
/**
 * Число условий на кнопке «Фильтры» на телефоне (§7 «Мобильная версия»): всё, что спрятано в выезжающей
 * панели, — период, сумма от и до (каждая) и условия окна «Фильтр». Поиск на виду, сортировка не в счёт.
 */
export function panelConditionCount(state: JournalUrlState): number {
```

на

```ts
/**
 * Число условий на воронке телефона (§8.5 этапа 1.5): всё, что задаёт окно «Фильтры» на телефоне, — период, сумма
 * от и до (каждая) и условия окна. Поиск на виду, сортировка не в счёт.
 */
export function phoneFilterCount(state: JournalUrlState): number {
```

После функции `journalApiParams` добавьте:

```ts
/** Ссылка «Выгрузить в Excel» по фильтру — те же параметры, что у журнала. */
export function journalExportHref(companyId: number, state: JournalUrlState, today: string): string {
  return `/api/v1/companies/${companyId}/operations/export.xlsx?${journalApiParams(state, today).toString()}`;
}
```

После функции `applyDialogFields` добавьте:

```ts
/** Поля окна «Фильтры» на телефоне сверх условий окна (§8.5 этапа 1.5): период, сумма от и до, сортировка. */
export type PhoneFilterFields = Pick<JournalUrlState, 'period' | 'from' | 'to' | 'amountMin' | 'amountMax' | 'sort' | 'order'>;

/**
 * Черновик окна «Фильтры»: условия окна и — если окно открыли на телефоне — период, сумма и сортировка. Режим
 * запоминается при открытии: окно браузера стало шире при открытом окне — набранный период не теряется.
 */
export interface FilterDraft {
  fields: DialogFields;
  phone: PhoneFilterFields | null;
}

/** Период, сумма и сортировка фильтра; пустые границы и суммы не пишутся. */
export function pickPhoneFilterFields(state: JournalUrlState): PhoneFilterFields {
  const f: PhoneFilterFields = { period: state.period, sort: state.sort, order: state.order };
  if (state.from !== undefined) f.from = state.from;
  if (state.to !== undefined) f.to = state.to;
  if (state.amountMin !== undefined) f.amountMin = state.amountMin;
  if (state.amountMax !== undefined) f.amountMax = state.amountMax;
  return f;
}

/** Начальный черновик окна по текущему фильтру. */
export function filterDraftFrom(state: JournalUrlState, phone: boolean): FilterDraft {
  return { fields: pickDialogFields(state), phone: phone ? pickPhoneFilterFields(state) : null };
}

/**
 * «Готово» и «Сохранить фильтр»: черновик поверх ТЕКУЩЕГО фильтра. Поиск остаётся текущим всегда; на компьютере ещё
 * период, сумма и сортировка; на телефоне их задаёт черновик (снятая в нём граница или сумма снимается и в фильтре).
 */
export function applyFilterDraft(state: JournalUrlState, draft: FilterDraft): JournalUrlState {
  const next = applyDialogFields(state, draft.fields);
  if (!draft.phone) return next;
  delete next.from;
  delete next.to;
  delete next.amountMin;
  delete next.amountMax;
  return { ...next, ...draft.phone };
}

/** «Очистить»: условия окна, на телефоне — ещё период и сумма; сортировка остаётся (как у «Сбросить фильтр»). */
export function clearFilterDraft(draft: FilterDraft): FilterDraft {
  return {
    fields: pickDialogFields(EMPTY_JOURNAL_STATE),
    phone: draft.phone ? { period: 'all', sort: draft.phone.sort, order: draft.phone.order } : null,
  };
}

/** Блок «Ещё условия» открыт при открытии окна: задана сумма или сортировка не «Сначала новые». */
export function phoneMoreSet(f: PhoneFilterFields): boolean {
  return f.amountMin !== undefined || f.amountMax !== undefined || f.sort !== EMPTY_JOURNAL_STATE.sort || f.order !== EMPTY_JOURNAL_STATE.order;
}
```

Run: `npx vitest run tests/client/journal-panel.test.ts` → PASS.

- [ ] **Step 4: Write the failing e2e tests**

В `e2e/mobile.spec.ts` замените тест `'фильтры на телефоне — в панели справа: период, сумма, сортировка, окно «Фильтры» поверх панели, сброс; поиск на виду'` целиком (от его `test(` до закрывающей `});`) на:

```ts
test('фильтр на телефоне в один шаг (§8.5): поиск, ⟳, воронка со счётчиком и ▾ в одной строке; окно «Фильтры» на весь экран — «Период» первым, «Ещё условия», «Готово» применяет всё вместе', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фильтры ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: cash, amount: 50000, comment: 'выручка' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 30000, comment: 'аренда' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: cash, amount: 10000, comment: 'вчерашний' });
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(3);
  // строка над списком: поиск, ⟳, воронка и ▾; панели «Период и условия», пилюли периода и «Ещё» журнала нет
  const main = page.getByRole('main');
  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const refresh = main.getByRole('button', { name: 'Обновить' });
  const funnel = main.getByRole('button', { name: /^Фильтр( · \d+)?$/ });
  const quick = main.getByRole('button', { name: 'Быстрые фильтры' });
  await expect(search).toHaveAttribute('placeholder', 'Поиск');
  await expect(page.getByRole('button', { name: /^Период и условия/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Период:/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Ещё', exact: true })).toHaveCount(0);
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const target of [search, refresh, funnel, quick]) boxes.push((await target.boundingBox())!);
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(centre(boxes[i]!) - centre(boxes[0]!)), 'одна строка').toBeLessThan(10);
    expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x);
    expect(boxes[i]!.height, 'цель касания').toBeGreaterThanOrEqual(44);
  }
  expect(boxes[3]!.x + boxes[3]!.width).toBeLessThanOrEqual(PHONE.width);
  await expectNoSideScroll(page, 'строка поиска');

  // ⟳ перечитывает журнал: операция, добавленная в обход экрана, появляется; итог — в живой области
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 5000 });
  await refresh.click();
  await expect(list).toHaveCount(4);
  await expect(page.getByText('Журнал обновлён')).toBeAttached();

  // воронка сразу открывает окно «Фильтры» на весь экран; «Период» — первым полем
  await expect(funnel).toHaveAccessibleName('Фильтр');
  await funnel.click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const d = (await dialog.boundingBox())!;
  expect(d.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(d.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const period = dialog.getByRole('button', { name: /^Период:/ });
  const types = dialog.getByRole('button', { name: /^Типы платежей и категории/ });
  expect((await period.boundingBox())!.y).toBeLessThan((await types.boundingBox())!.y);
  await expect(period).toHaveAccessibleName('Период: За все время');
  // смена периода — только в черновике: «×» закрывает без изменений (Review Focus 1)
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  await period.click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await expect(period).toHaveAccessibleName('Период: За вчера');
  await expect(list).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(funnel).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));

  // «Готово» применяет вместе период, условия окна, сумму и сортировку
  await funnel.click();
  await expect(period).toHaveAccessibleName('Период: За все время');
  await period.click();
  await periodMenu.getByRole('button', { name: 'За сегодня', exact: true }).click();
  await types.click();
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await page.keyboard.press('Escape');
  const more = dialog.getByRole('button', { name: 'Ещё условия' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await dialog.getByLabel('Сумма от').fill('60');
  await dialog.getByLabel('Сумма от').press('Enter');
  await dialog.getByLabel('Сортировка').selectOption({ label: 'Сначала крупные' });
  // выгрузка — по черновику окна
  await expect(dialog.getByRole('link', { name: 'Выгрузить в Excel' })).toHaveAttribute(
    'href',
    /\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&amountMin=6000&types=expense&sort=amount&order=desc$/,
  );
  await expect(list).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?period=today&min=6000&type=expense&sort=amount$`));
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText(/\u2212300\s₸/);
  // на воронке — период, сумма «от» и тип
  await expect(funnel).toHaveAccessibleName('Фильтр · 3');

  // окно открывается с применённым; «Ещё условия» уже открыт — задана сумма
  await funnel.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByLabel('Сумма от')).toHaveValue('60');
  // «Очистить» снимает период, условия и сумму; сортировка остаётся
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await expect(period).toHaveAccessibleName('Период: За все время');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?sort=amount$`));
  await expect(list).toHaveCount(4);
  await expect(funnel).toHaveAccessibleName('Фильтр');

  // «Быстрые фильтры» — рядом с воронкой; Esc закрывает только список
  await quick.click();
  const saved = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(saved).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saved).toBeHidden();
  await expect(quick).toBeFocused();

  // поиск — без окна
  await search.fill('вчерашн');
  await expect(list).toHaveCount(1);
  await search.fill('');
  await expect(list).toHaveCount(4);

  // окно открыто, а окно браузера стало шире (поворот телефона): набранный период не теряется (Review Focus 2)
  await funnel.click();
  await period.click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(/period=yesterday/);
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
});
```

В тесте `'ширина 390 px: журнал, все разделы настроек, история с подробностями и форма не прокручиваются вбок'` замените

```ts
  // окно «Фильтры» поверх панели: длинное название категории переносится, панель поля не шире экрана
  await page.getByRole('button', { name: /^Период и условия/ }).click();
  await page.getByRole('dialog', { name: 'Период и условия' }).getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });
```

на

```ts
  // окно «Фильтры» (воронка, §8.5): длинное название категории переносится, панель поля не шире экрана
  await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });
```

В тесте `'панель даты: фокус на дне, не в поле «Время»; …'` (группа `'касание (pointer: coarse), панели календаря на телефоне 390×844'`) замените

```ts
    // период журнала: меню внутри панели «Период и условия», ширина та же, что у остальных календарей
    await page.getByRole('button', { name: /^Период и условия/ }).click();
    const filters = page.getByRole('dialog', { name: 'Период и условия' });
    await filters.getByRole('button', { name: /^Период:/ }).click();
```

на

```ts
    // период журнала: первое поле окна «Фильтры» (§8.5), меню внутри окна, ширина та же, что у остальных календарей
    await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).click();
    const filters = page.getByRole('dialog', { name: 'Фильтры', exact: true });
    await filters.getByRole('button', { name: /^Период:/ }).click();
```

и в той же группе после этого теста (перед закрывающей `});` группы) добавьте:

```ts
  test('«Выбрать даты» в окне «Фильтры»: вложенные календари «С» и «По» открываются касанием и помещаются на экране; Esc закрывает только календарь; «Применить» и «Готово» задают период', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Даты касанием ${Date.now()}`);
    const base = `/api/v1/companies/${cid}`;
    const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: cash, amount: 50000 });
    await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: cash, amount: 10000 });
    await page.reload();
    await page.setViewportSize(PHONE);
    const list = cards(page).getByRole('listitem');
    await expect(list).toHaveCount(2);
    const yesterday = yesterdayNoon().slice(0, 10);
    const ru = (d: string) => d.split('-').reverse().join('.');
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    /** Имя ячейки дня в календаре: «11 октября 2026». */
    const dayName = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

    await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
    const period = dialog.getByRole('button', { name: /^Период:/ });
    const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
    // «За вчера», затем «Выбрать даты»: поля начинаются с границ выбранного периода — календари откроются на месяце вчерашнего дня
    await period.tap();
    await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).tap();
    await period.tap();
    await periodMenu.getByRole('button', { name: 'Выбрать даты' }).tap();
    const from = periodMenu.getByRole('button', { name: /^С:/ });
    const to = periodMenu.getByRole('button', { name: /^По:/ });
    await expect(from).toHaveAccessibleName(`С: ${ru(yesterday)}`);
    await from.tap();
    const fromCalendar = page.getByRole('dialog', { name: 'С: календарь' });
    await expect(fromCalendar.getByRole('grid')).toBeVisible();
    const box = (await fromCalendar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    await fromCalendar.getByRole('gridcell', { name: dayName(yesterday) }).tap();
    await expect(fromCalendar).toBeHidden();
    await expect(periodMenu).toBeVisible();
    await expect(from).toHaveAccessibleName(`С: ${ru(yesterday)}`);
    // Esc в календаре «По» закрывает только его: меню периода и окно «Фильтры» остаются (Review Focus 3)
    await to.tap();
    const toCalendar = page.getByRole('dialog', { name: 'По: календарь' });
    await expect(toCalendar.getByRole('grid')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toCalendar).toBeHidden();
    await expect(periodMenu).toBeVisible();
    await expect(dialog).toBeVisible();
    await to.tap();
    await toCalendar.getByRole('gridcell', { name: dayName(yesterday) }).tap();
    await periodMenu.getByRole('button', { name: 'Применить' }).tap();
    await expect(period).toHaveAccessibleName(`Период: ${ru(yesterday)}`);
    await dialog.getByRole('button', { name: 'Готово' }).tap();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?from=${yesterday}&to=${yesterday}$`));
    await expect(list).toHaveCount(1);
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx playwright test e2e/mobile.spec.ts -g "фильтр на телефоне в один шаг|Выбрать даты» в окне"`
Expected: FAIL — в строке нет ⟳ и воронки (`main.getByRole('button', { name: 'Обновить' })` не находится).

- [ ] **Step 6: Окно на весь экран телефона — общий класс**

В `src/client/components/ui.ts` после определения `btnClose` добавьте:

```ts
/**
 * Окно на весь экран телефона (форма операции §8.7, «Фильтры» §8.5 этапа 1.5) — вместе с `Modal phoneFullScreen`:
 * без отступов и скруглений, поля не уходят под вырез экрана и «домашнюю» полосу (safe-area).
 */
export const phoneFullScreenModal =
  'max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none max-md:pr-[env(safe-area-inset-right)] max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)]';
```

В `src/client/components/operation/OperationForm.tsx` в импорте из `'../ui'` после `noticeClass,` добавьте `phoneFullScreenModal,`, а

```tsx
const MODAL_CLASS =
  'max-w-[480px] max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none max-md:pr-[env(safe-area-inset-right)] max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)]';
```

замените на

```tsx
const MODAL_CLASS = `max-w-[480px] ${phoneFullScreenModal}`;
```

- [ ] **Step 7: `PeriodMenu` во всю ширину**

В `src/client/components/journal/PeriodMenu.tsx` после определения `pillClass` добавьте:

```tsx
/** Меню периода во всю ширину поля — первое поле окна «Фильтры» на телефоне (§8.5 этапа 1.5, снимок Finmap m06). */
const wideClass =
  'flex min-h-12 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';
```

замените

```tsx
export function PeriodMenu(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void }) {
```

на

```tsx
export function PeriodMenu(props: {
  state: JournalUrlState;
  today: string;
  onChange: (next: JournalUrlState) => void;
  /** Во всю ширину — первое поле окна «Фильтры» на телефоне (§8.5 этапа 1.5). */
  wide?: boolean;
}) {
```

и `      buttonClassName={pillClass}` — на `      buttonClassName={props.wide ? wideClass : pillClass}`.

- [ ] **Step 8: `FilterButton` — воронка со счётчиком**

Замените `src/client/components/journal/FilterButton.tsx` целиком:

```tsx
import type { SavedFilter } from '../../lib/queries';
import { FunnelIcon } from '../icons';
import { SavedFiltersMenu } from './SavedFiltersMenu';

const partClass = 'inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Составная кнопка «Фильтр · N | ▾» (§5.1 этапа 1.5): левая часть открывает окно фильтра (N — число условий),
 * стрелка — «Быстрые фильтры» (сохранённые). canSave = false (архивная компания) — без «Создать новый фильтр».
 * compact — телефон (§8.5): воронка с числом вместо подписи (имя кнопки то же — «Фильтр · N»), цели касания 44 px.
 */
export function FilterButton(props: {
  count: number;
  onOpen: () => void;
  canSave: boolean;
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
  compact?: boolean;
}) {
  const name = `Фильтр${props.count > 0 ? ` · ${props.count}` : ''}`;
  const size = props.compact ? ' min-h-11' : '';
  return (
    <div className="inline-flex shrink-0 items-center rounded-lg bg-field">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={props.compact ? name : undefined}
        title={props.compact ? 'Фильтр' : undefined}
        onClick={props.onOpen}
        className={`${partClass} rounded-l-lg px-3${size}`}
      >
        <FunnelIcon />
        {props.compact ? (
          props.count > 0 && (
            <span aria-hidden="true" className="tabular-nums">
              {props.count}
            </span>
          )
        ) : (
          name
        )}
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-muted/40" />
      <SavedFiltersMenu
        companyId={props.companyId}
        filters={props.filters}
        onApply={props.onApply}
        onCreate={props.canSave ? props.onOpen : undefined}
        buttonClassName={`${partClass} rounded-r-lg px-2.5${size}`}
      />
    </div>
  );
}
```

- [ ] **Step 9: `FilterDialog` — черновик `FilterDraft`, «Период» и «Ещё условия» на телефоне**

Замените `src/client/components/journal/FilterDialog.tsx` целиком:

```tsx
import { useId, useState } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { ApiError } from '../../lib/api';
import {
  applyFilterDraft,
  clearFilterDraft,
  filterDraftFrom,
  phoneMoreSet,
  pickPhoneFilterFields,
  SORT_CHOICES,
  type FilterDraft,
  type JournalUrlState,
} from '../../lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, type FilterDialogData, type FilterDimension } from '../../lib/journal-filter-dialog';
import { Field } from '../Field';
import { ChevronIcon } from '../icons';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, btnSecondary, btnSmall, inputClass, phoneFullScreenModal } from '../ui';
import { AmountRange } from './AmountRange';
import { PeriodMenu } from './PeriodMenu';

export type { FilterDialogData };

const compactInput = inputClass.replace('py-3', 'py-2');

/** Раскладка в две колонки (§5.6): «Типы платежей и категории» — на всю ширину. */
const FIELD_CLASS: Record<FilterDimension, string> = { typesCategories: 'md:col-span-2', counterparties: '', projects: '', tags: '', accounts: '' };

/**
 * «Ещё условия» окна «Фильтры» на телефоне (§8.5 этапа 1.5): сумма от и до, сортировка и «Выгрузить в Excel» — всё по
 * черновику окна (view — черновик поверх текущего фильтра). Сворачивается кнопкой с aria-expanded.
 */
function PhoneMore(props: {
  view: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  baseCurrency: string;
  exportHref?: (state: JournalUrlState) => string;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(props.initiallyOpen);
  const id = useId();
  const currency = getCurrency(props.baseCurrency);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-sm font-semibold text-ink hover:bg-field/60 focus-visible:outline-2 focus-visible:outline-focus"
      >
        Ещё условия
        <ChevronIcon up={open} />
      </button>
      {open && (
        <div id={id} className="mt-2 flex flex-col gap-4">
          <div>
            <p className="mb-1 text-sm text-muted">Сумма, {currency.symbol}</p>
            <AmountRange state={props.view} onChange={props.onChange} minorUnits={currency.minorUnits} />
          </div>
          <Field label="Сортировка" className="w-56">
            {(c) => (
              <select
                {...c}
                value={`${props.view.sort}:${props.view.order}`}
                onChange={(e) => {
                  const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                  if (choice) props.onChange({ ...props.view, sort: choice.sort, order: choice.order });
                }}
                className={compactInput}
              >
                {SORT_CHOICES.map((s) => (
                  <option key={`${s.sort}:${s.order}`} value={`${s.sort}:${s.order}`}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {props.exportHref && (
            <a href={props.exportHref(props.view)} download className={`${btnSmall} self-start`}>
              Выгрузить в Excel
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Поля окна «Фильтры» (§5.6, §8.5 этапа 1.5). Черновик — условия окна, а если окно открыли на телефоне, ещё период
 * (первым полем), сумма и сортировка (блок «Ещё условия»). «Готово» применяет черновик поверх текущего фильтра,
 * «×» и Esc закрывают без изменений. Режим телефона запоминается при открытии.
 */
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  phone: boolean;
  today: string;
  baseCurrency: string;
  exportHref?: (state: JournalUrlState) => string;
  onApply: (draft: FilterDraft) => void;
  /** Не передан (архивная компания) — «Сохранить фильтр» не показывается. */
  onSave?: (draft: FilterDraft, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<FilterDraft>(() => filterDraftFrom(props.state, props.phone));
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // черновик поверх текущего фильтра — для меню периода, сумм, сортировки и ссылки выгрузки
  const view = applyFilterDraft(props.state, draft);
  const setPhone = (next: JournalUrlState) => setDraft((d) => ({ ...d, phone: pickPhoneFilterFields(next) }));

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await props.onSave?.(draft, name);
      props.onApply(draft);
    } catch (e) {
      setSaveError(e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(draft);
      }}
    >
      {draft.phone && (
        <div className="mb-3">
          <PeriodMenu state={view} today={props.today} onChange={setPhone} wide />
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${FIELD_CLASS[d.dim]}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, draft.fields)}
              selected={dimensionSelected(d.dim, draft.fields)}
              onToggle={(key) => setDraft((current) => ({ ...current, fields: toggleDimension(d.dim, current.fields, key) }))}
            />
          </div>
        ))}
      </div>
      {draft.phone && (
        <PhoneMore view={view} onChange={setPhone} baseCurrency={props.baseCurrency} exportHref={props.exportHref} initiallyOpen={phoneMoreSet(draft.phone)} />
      )}
      <p className="mt-3 text-xs text-muted">
        Среди типов, среди категорий, контрагентов и т. д. подходит любой из отмеченных вариантов («Аренда» или «Без категории»), а разные поля и тип с категорией действуют
        вместе: «Расход» и «Аренда» — расходы на аренду. Родительская категория включает дочерние.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft(clearFilterDraft)} className="text-sm font-semibold text-muted underline hover:text-ink">
          Очистить
        </button>
        {props.onSave && (
          <button type="button" aria-expanded={naming} onClick={() => setNaming((v) => !v)} className={`${btnSecondary} ml-auto`}>
            Сохранить фильтр
          </button>
        )}
      </div>
      {naming && props.onSave && (
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
                    if (!saving) void save();
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

/**
 * Окно «Фильтры» (§5.6, §8.5 этапа 1.5): «×» в углу закрывает без применения, «Отмены» нет. Поля — выпадающие
 * мультивыборы в порядке Finmap; кнопки «Готово», «Очистить», «Сохранить фильтр». На телефоне — на весь экран,
 * с «Периодом» первым полем и блоком «Ещё условия».
 */
export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  /** Окно открыто на телефоне: в черновике ещё период, сумма и сортировка. */
  phone: boolean;
  today: string;
  baseCurrency: string;
  /** Ссылка «Выгрузить в Excel» по фильтру (на телефоне — в «Ещё условия»). */
  exportHref?: (state: JournalUrlState) => string;
  /** Черновик окна: его накладывают на текущий фильтр (`applyFilterDraft`), а не на снимок при открытии. */
  onApply: (draft: FilterDraft) => void;
  onClose: () => void;
  /** Сохраняет черновик как именованный фильтр — тоже поверх текущего фильтра; при успехе окно применяет черновик и закрывается. */
  onSave?: (draft: FilterDraft, name: string) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose} className={`max-w-[818px] ${phoneFullScreenModal}`} phoneFullScreen>
      <FilterForm
        state={props.state}
        data={props.data}
        phone={props.phone}
        today={props.today}
        baseCurrency={props.baseCurrency}
        exportHref={props.exportHref}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
        onSave={props.onSave}
      />
    </Modal>
  );
}
```

`setDraft(clearFilterDraft)` передаёт функцию как обновление состояния: `clearFilterDraft(текущий черновик)`.

- [ ] **Step 10: `JournalToolbar` — строка телефона без панели**

Замените `src/client/components/journal/JournalToolbar.tsx` целиком:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalExportHref, SEARCH_MAX, type JournalUrlState } from '../../lib/journal-filter';
import { RefreshIcon, SearchIcon } from '../icons';
import { inputClass } from '../ui';
import { MoreMenu } from './MoreMenu';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');
const searchInput = compactInput.replace('px-4', 'pl-10 pr-4');
/** Квадратная кнопка тулбара; на телефоне цель касания 44 px. */
const squareButton =
  'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-wait aria-disabled:opacity-60 max-md:size-11';

/**
 * Поиск (§5.1, §8.5 этапа 1.5): лупа внутри поля, справа кнопка-лупа «Найти» (применяет сразу); живой поиск через
 * паузу и по Enter остаётся. Подписи над полем нет — доступное имя «Поиск».
 */
function SearchBox({ value, onSearch, placeholder }: { value: string; onSearch: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  // последнее значение, которое ушло в адресную строку: отличает внешнюю смену (сброс) от своей
  const sent = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    timerRef.current = t;
    return () => clearTimeout(t);
  }, [text]);

  return (
    <form
      role="search"
      className="flex min-w-48 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        // «Найти» применяет сразу: отложенный живой поиск не нужен
        clearTimeout(timerRef.current);
        sent.current = q;
        onSearchRef.current(q);
      }}
    >
      <div className="relative min-w-0 flex-1">
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          aria-label="Поиск"
          value={text}
          maxLength={SEARCH_MAX}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          className={`${searchInput} max-md:h-11`}
        />
      </div>
      <button type="submit" aria-label="Найти" title="Найти" className={squareButton}>
        <SearchIcon />
      </button>
    </form>
  );
}

/** ⟳ «Обновить» в строке над карточками (§2.5, §8.5 этапа 1.5): итог — в живой области под строкой, сбой виден. */
function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [state, setState] = useState({ pending: false, failed: false, text: '' });
  const running = useRef(false);
  const run = async () => {
    // aria-disabled не гасит нажатие, а disabled уронил бы фокус клавиатуры на body
    if (running.current) return;
    running.current = true;
    setState({ pending: true, failed: false, text: '' });
    try {
      await onRefresh();
      setState({ pending: false, failed: false, text: 'Журнал обновлён' });
    } catch {
      setState({ pending: false, failed: true, text: 'Не удалось обновить журнал' });
    } finally {
      running.current = false;
    }
  };
  return (
    <>
      <button type="button" aria-label="Обновить" title="Обновить" aria-disabled={state.pending || undefined} onClick={() => void run()} className={squareButton}>
        <RefreshIcon spinning={state.pending} />
      </button>
      <p role="status" className={state.failed ? 'order-last basis-full text-xs text-expense-strong' : 'sr-only'}>
        {state.text}
      </p>
    </>
  );
}

/**
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, и «Ещё ▾» (сумма, ⟳, колонки, выгрузка).
 * На телефоне (`mobile`, §8.5) — «Поиск», ⟳ и воронка «Фильтр · N | ▾»: период, сумма, сортировка и выгрузка — в окне
 * «Фильтры», оно открывается воронкой сразу.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  /** «Фильтр · N | ▾». */
  filter: ReactNode;
  /** ⟳: журнал, балансы и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
  /** Сбой сохранения колонок или «Показывать полностью» после закрытия «Ещё». */
  onPrefError?: (text: string) => void;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [resetKey, setResetKey] = useState(0);

  const reset = () => {
    setResetKey((k) => k + 1);
    onChange(clearFilter(state));
  };
  const setQuery = (q: string) => {
    const next = { ...state };
    if (q) next.q = q;
    else delete next.q;
    onChange(next);
  };

  if (props.mobile) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} placeholder="Поиск" />
        <RefreshButton onRefresh={props.onRefresh} />
        {props.filter}
      </div>
    );
  }

  const currency = getCurrency(props.baseCurrency);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <PeriodMenu state={state} today={props.today} onChange={onChange} />
      <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} placeholder="Поиск по счетам, контрагентам, комментариям" />
      {props.filter}
      {isFiltered(state) && (
        <button type="button" aria-label="Сбросить фильтр" title="Сбросить фильтр" onClick={reset} className={squareButton}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
      <MoreMenu
        companyId={props.companyId}
        state={state}
        onChange={onChange}
        currencySymbol={currency.symbol}
        minorUnits={currency.minorUnits}
        exportHref={journalExportHref(props.companyId, state, props.today)}
        onRefresh={props.onRefresh}
        onPrefError={props.onPrefError}
      />
    </div>
  );
}
```

- [ ] **Step 11: `JournalPage` — черновик окна и счётчик воронки**

В `src/client/pages/JournalPage.tsx`:

замените импорт

```tsx
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

на

```tsx
import {
  applyFilterDraft,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalExportHref,
  journalSearch,
  parseJournalSearch,
  phoneFilterCount,
  savedFilterFromState,
  stateFromSavedFilter,
  type FilterDraft,
  type JournalUrlState,
} from '../lib/journal-filter';
```

замените `  const conditions = filterConditionCount(state);` на

```tsx
  // на телефоне воронка считает и период с суммой: они тоже в окне «Фильтры» (§8.5)
  const conditions = mobile ? phoneFilterCount(state) : filterConditionCount(state);
```

замените

```tsx
  // сохраняются поля окна поверх ТЕКУЩЕГО фильтра — как у «Готово», без устаревшего поиска из снимка
  const saveFilter = async (draft: DialogFields, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(applyDialogFields(state, draft), today) } });
```

на

```tsx
  // сохраняется черновик окна поверх ТЕКУЩЕГО фильтра — как у «Готово», без устаревшего поиска из снимка
  const saveFilter = async (draft: FilterDraft, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(applyFilterDraft(state, draft), today) } });
```

в `<FilterButton` после `            count={conditions}` добавьте строку `            compact={mobile}`;

в `<FilterDialog` замените

```tsx
        // поля модалки — поверх текущего фильтра: поиск, дошедший до адреса при открытом окне, не теряется
        onApply={(draft) => update(applyDialogFields(state, draft))}
```

на

```tsx
        // на телефоне в окне ещё период, сумма и сортировка (§8.5); режим окно запоминает при открытии
        phone={mobile}
        today={today}
        baseCurrency={company.baseCurrency}
        exportHref={(s) => journalExportHref(company.id, s, today)}
        // черновик окна — поверх текущего фильтра: поиск, дошедший до адреса при открытом окне, не теряется
        onApply={(draft) => update(applyFilterDraft(state, draft))}
```

Проверьте, что старых имён не осталось: `grep -rn "panelConditionCount\|applyDialogFields\|Период и условия" src/client` → только `applyDialogFields` в `src/client/lib/journal-filter.ts` (её вызывает `applyFilterDraft`).

- [ ] **Step 12: Run the tests**

Run: `npx vitest run tests/client/journal-panel.test.ts tests/client/journal.test.ts` → PASS. Run: `npx playwright test e2e/mobile.spec.ts e2e/journal.spec.ts e2e/dialogs.spec.ts` → PASS (окно «Фильтры» на компьютере не изменилось).

- [ ] **Step 13: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/journal-filter.ts src/client/components/journal/JournalToolbar.tsx src/client/components/journal/FilterButton.tsx src/client/components/journal/FilterDialog.tsx src/client/components/journal/PeriodMenu.tsx src/client/pages/JournalPage.tsx src/client/components/ui.ts src/client/components/operation/OperationForm.tsx tests/client/journal-panel.test.ts e2e/mobile.spec.ts
git commit -m "feat: телефон — фильтр в один шаг: «Поиск | ⟳ | воронка · N | ▾», окно «Фильтры» на весь экран с «Периодом» первым и «Ещё условия»; панель «Период и условия» убрана

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Карточка журнала в порядке Finmap

**Files:**
- Modify: `src/client/lib/journal-card.ts` (полная замена), `src/client/components/journal/JournalCards.tsx` (полная замена), `src/client/pages/JournalPage.tsx`
- Test: `tests/client/journal-card.test.ts` (полная замена), `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `formatDateShortRu` (`shared/dates.ts`); `dayOf`, `lineDimension`, `signedMoney`, `splitLabel` (`lib/journal-format.ts`); `formatMoney`, `MONEY_SCREEN`.
- Produces: `interface JournalCardText { date: string; amount: string; extra: string | null; counterparty: string | null; account: string; category: string | null }`; `journalCardText(item: JournalItem, lookups: JournalLookups, ctx: { baseCurrency: string; timeZone: string }): JournalCardText`; `JournalCards` без свойства `today`; строки карточки помечены `data-card-line="date|amount|counterparty|account|category"`.

- [ ] **Step 1: Write the failing unit test**

Замените `tests/client/journal-card.test.ts` целиком:

```ts
import { describe, expect, it } from 'vitest';
import type { JournalLookups } from '../../src/client/components/journal/JournalTable';
import { journalCardText, type JournalCardText } from '../../src/client/lib/journal-card';
import type { Account, JournalItem, OperationLine } from '../../src/client/lib/queries';

const TZ = 'Asia/Almaty';
const ctx = { baseCurrency: 'KZT', timeZone: TZ };

const account = (id: number, name: string, currency: string): Account => ({
  id,
  companyId: 1,
  projectId: null,
  name,
  currency,
  startingBalance: 0,
  openedAt: '2020-01-01',
  orderIndex: id,
  createdAt: '2020-01-01T00:00:00.000Z',
  archivedAt: null,
  hasOperations: true,
});

const lookups: JournalLookups = {
  accounts: new Map([
    [1, account(1, 'Касса', 'KZT')],
    [2, account(2, 'Валютный', 'USD')],
  ]),
  categories: new Map([
    [10, { name: 'Аренда', systemKey: null }],
    [11, { name: 'Зарплата → Администраторы', systemKey: null }],
  ]),
  projects: new Map([[20, 'Клуб Север']]),
  counterparties: new Map([[30, 'ТОО Ромашка']]),
};

const line = (categoryId: number | null, projectId: number | null, amount: number, position = 0): OperationLine => ({
  id: position + 1,
  position,
  categoryId,
  projectId,
  amount,
  baseAmount: amount,
});

const item = (patch: Partial<JournalItem>): JournalItem => ({
  id: 1,
  companyId: 1,
  type: 'expense',
  status: 'actual',
  paidAt: '2026-10-07T05:30:00.000Z', // 10:30 по Алматы
  accrualDate: null,
  accountId: 1,
  amount: 250000,
  toAccountId: null,
  toAmount: null,
  rate: '1',
  baseAmount: 250000,
  counterpartyId: null,
  comment: null,
  createdBy: 1,
  createdAt: '2026-10-07T05:30:00.000Z',
  updatedAt: '2026-10-07T05:30:00.000Z',
  version: 1,
  deletedAt: null,
  lines: [line(10, null, 250000)],
  tagIds: [],
  attachmentCount: 0,
  balanceAfter: null,
  toBalanceAfter: null,
  ...patch,
});

/** Неразрывные пробелы денег (U+00A0, U+202F) → обычные: так ожидания читаются. */
const plain = (card: JournalCardText) =>
  Object.fromEntries(Object.entries(card).map(([k, v]) => [k, v === null ? null : v.replace(/[\u00A0\u202F]/g, ' ')]));

describe('карточка операции в журнале на телефоне (§8.4 этапа 1.5)', () => {
  it('расход: дата без времени, сумма со знаком, контрагент, счёт, категория; комментария нет', () => {
    expect(plain(journalCardText(item({ counterpartyId: 30, comment: 'за октябрь' }), lookups, ctx))).toEqual({
      date: '7 окт. 2026',
      amount: '\u22122 500 ₸',
      extra: null,
      counterparty: 'ТОО Ромашка',
      account: 'Касса',
      category: 'Аренда',
    });
  });

  it('разбитый доход — «2 категории»; без категории — «Без категории»; без контрагента — строки нет', () => {
    const split = item({ type: 'income', paidAt: '2026-10-06T03:00:00.000Z', lines: [line(10, 20, 100000), line(11, 20, 150000, 1)] });
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ date: '6 окт. 2026', amount: '+2 500 ₸', counterparty: null, category: '2 категории' });
    const none = item({ paidAt: '2026-10-01T13:15:00.000Z', lines: [line(null, 20, 250000)] });
    expect(journalCardText(none, lookups, ctx)).toMatchObject({ date: '1 окт. 2026', category: 'Без категории' });
  });

  it('дата — по поясу приложения: 19:30 UTC 6 октября — уже 7 октября в Алматы', () => {
    expect(journalCardText(item({ paidAt: '2026-10-06T19:30:00.000Z' }), lookups, ctx).date).toBe('7 окт. 2026');
  });

  it('перевод между валютами: оба счёта, сумма без знака, зачисление в валюте получателя; строки категории нет', () => {
    const transfer = item({ type: 'transfer', accountId: 1, toAccountId: 2, amount: 50000, toAmount: 100, lines: [] });
    expect(plain(journalCardText(transfer, lookups, ctx))).toMatchObject({
      account: 'Касса → Валютный',
      amount: '500 ₸',
      extra: '→ 1 $',
      counterparty: null,
      category: null,
    });
  });

  it('счёт не в базовой валюте — под суммой сумма в базовой; неизвестные справочники — «…»', () => {
    const usd = item({ accountId: 2, amount: 100, baseAmount: 50000, counterpartyId: 99, lines: [line(77, null, 100)] });
    expect(plain(journalCardText(usd, lookups, ctx))).toMatchObject({ category: '…', account: 'Валютный', amount: '\u22121 $', extra: '500 ₸', counterparty: '…' });
    expect(journalCardText(item({ accountId: 5 }), lookups, ctx).account).toBe('…');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/journal-card.test.ts`
Expected: FAIL — у карточки ещё поля `title` и `details`, дата «сегодня 10:30».

- [ ] **Step 3: `lib/journal-card.ts`**

Замените `src/client/lib/journal-card.ts` целиком:

```ts
import { formatDateShortRu } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { JournalLookups } from '../components/journal/JournalTable';
import { dayOf, lineDimension, signedMoney, splitLabel } from './journal-format';
import type { JournalItem } from './queries';

/** Текст карточки операции в журнале на телефоне (§8.4 этапа 1.5, как в Finmap). */
export interface JournalCardText {
  /** Строка 1 слева: дата «27 сент. 2026» без времени, в поясе приложения. */
  date: string;
  /** Строка 1 справа: сумма со знаком в валюте счёта. */
  amount: string;
  /** Мелко под суммой: зачисление перевода в другой валюте («→ 1 $») или сумма в базовой валюте; иначе null. */
  extra: string | null;
  /** Строка 2: контрагент; нет — null (пустой строки нет). */
  counterparty: string | null;
  /** Строка 3: счёт; у перевода — «Касса → Kaspi». */
  account: string;
  /** Строка 4 мелко: категория, «2 категории» у разбитой, «Без категории»; у перевода — null (решение владельца 1, §14.3). */
  category: string | null;
}

export function journalCardText(item: JournalItem, lookups: JournalLookups, ctx: { baseCurrency: string; timeZone: string }): JournalCardText {
  const account = lookups.accounts.get(item.accountId);
  const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
  const currency = account?.currency ?? ctx.baseCurrency;

  let category: string | null = null;
  if (item.type !== 'transfer') {
    const d = lineDimension(item.lines, 'categoryId');
    category = d.kind === 'many' ? splitLabel(d.count, 'category') : d.id === null ? 'Без категории' : (lookups.categories.get(d.id)?.name ?? '…');
  }

  let extra: string | null = null;
  if (item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null) {
    extra = `→ ${formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}`;
  } else if (currency !== ctx.baseCurrency) {
    extra = formatMoney(item.baseAmount, ctx.baseCurrency, MONEY_SCREEN);
  }

  return {
    date: formatDateShortRu(dayOf(item.paidAt, ctx.timeZone)),
    amount: signedMoney(item.type, item.amount, currency),
    extra,
    counterparty: item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
    account: item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…'),
    category,
  };
}
```

Run: `npx vitest run tests/client/journal-card.test.ts` → PASS.

- [ ] **Step 4: Write the failing e2e test**

В `e2e/mobile.spec.ts` после строки `const newForm = (page: Page) => page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });` добавьте:

```ts
/** «12 окт. 2026» — дата карточки журнала (§8.4), как formatDateShortRu. */
const SHORT_MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** Сегодня по Алматы — APP_TIMEZONE e2e-сервера. */
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
```

После теста `'журнал карточками догружается при прокрутке; …'` добавьте:

```ts
test('карточка журнала (§8.4): дата слева и сумма справа, контрагент, счёт, категория мелко; у перевода строки категории нет; комментария нет; подсказка «Открыть операцию»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Карточка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const supplier = (await apiPost(page, `${base}/counterparties`, { name: 'ТОО Ромашка', type: 'supplier' })).counterparty.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(5),
    accountId: cash,
    amount: 250000,
    counterpartyId: supplier,
    comment: 'за октябрь',
    lines: [{ categoryId: rent, projectId: null, amount: 250000 }],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(4), accountId: cash, toAccountId: kaspi, amount: 10000 });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 5000 });
  await page.setViewportSize(PHONE);
  await page.reload();

  const items = cards(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  const line = (card: Locator, name: string) => card.locator(`[data-card-line="${name}"]`);
  const expense = items.filter({ hasText: 'ТОО Ромашка' });
  await expect(line(expense, 'date')).toHaveText(shortDate(todayIso()));
  await expect(line(expense, 'amount')).toHaveText(/\u22122\s500\s₸/);
  await expect(line(expense, 'counterparty')).toHaveText('ТОО Ромашка');
  await expect(line(expense, 'account')).toHaveText('Касса');
  await expect(line(expense, 'category')).toHaveText('Аренда');
  // сверху вниз: дата, контрагент, счёт, категория; сумма — в строке даты, справа
  const ys: number[] = [];
  for (const name of ['date', 'counterparty', 'account', 'category']) ys.push((await line(expense, name).boundingBox())!.y);
  expect(ys).toEqual([...ys].sort((a, b) => a - b));
  expect(new Set(ys).size).toBe(4);
  const date = (await line(expense, 'date').boundingBox())!;
  const amount = (await line(expense, 'amount').boundingBox())!;
  expect(amount.x).toBeGreaterThan(date.x + date.width);
  expect(Math.abs(amount.y - date.y)).toBeLessThan(8);
  // комментария нет; подсказка кнопки — «Открыть операцию» (отложенное 7 №4)
  await expect(expense).not.toContainText('за октябрь');
  await expect(expense.getByRole('button')).toHaveAttribute('title', 'Открыть операцию');
  // перевод: «Касса → Kaspi», без строк контрагента и категории (Review Focus 4)
  const transfer = items.filter({ hasText: 'Касса → Kaspi' });
  await expect(line(transfer, 'account')).toHaveText('Касса → Kaspi');
  await expect(line(transfer, 'category')).toHaveCount(0);
  await expect(line(transfer, 'counterparty')).toHaveCount(0);
  // доход без категории и контрагента: «Без категории», пустой строки контрагента нет
  const income = items.filter({ hasText: /\+50\s₸/ });
  await expect(line(income, 'category')).toHaveText('Без категории');
  await expect(line(income, 'counterparty')).toHaveCount(0);
});
```

В тесте `'сценарий 4 §10, ширина 390 px: …'` замените

```ts
  // журнал — карточки: сумма, категория, счёт, дата; таблицы и флажков выделения нет
```

на

```ts
  // журнал — карточки: дата, сумма, счёт, категория (§8.4); таблицы и флажков выделения нет
```

и строку `  await expect(card).toContainText(/сегодня \d\d:\d\d/);` — на `  await expect(card).toContainText(shortDate(todayIso()));`.

В тесте `'журнал карточками догружается при прокрутке; …'` замените `  await expect(list.last()).toContainText('№55');` на

```ts
  // комментария в карточке нет (§8.4): последняя — самая ранняя операция, 55 ₸
  await expect(list.last()).toContainText(/\+55\s₸/);
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "карточка журнала"`
Expected: FAIL — строк `data-card-line` нет.

- [ ] **Step 6: `JournalCards`**

Замените `src/client/components/journal/JournalCards.tsx` целиком:

```tsx
import { journalCardText } from '../../lib/journal-card';
import type { JournalItem } from '../../lib/queries';
import type { JournalLookups } from './JournalTable';

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense-strong',
  transfer: 'text-transfer',
};

/**
 * Журнал на телефоне (§8.4 этапа 1.5, как в Finmap): карточка — дата слева и сумма справа, затем контрагент, счёт и
 * мелко категория. Карточка — кнопка «Открыть операцию»: форма на весь экран, после закрытия фокус — на карточке.
 * Выделения и «Указать» здесь нет — они в таблице на компьютере.
 */
export function JournalCards(props: {
  items: JournalItem[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  busy: boolean;
  onOpenOperation: (item: JournalItem) => void;
}) {
  return (
    <ul aria-label="Операции" aria-busy={props.busy} className={`divide-y divide-field ${props.busy ? 'opacity-60' : ''}`}>
      {props.items.map((item) => {
        const c = journalCardText(item, props.lookups, props);
        return (
          <li key={item.id}>
            <button
              type="button"
              data-operation-id={item.id}
              title="Открыть операцию"
              onClick={() => props.onOpenOperation(item)}
              className="block w-full rounded-lg py-3 text-left outline-none focus-visible:bg-field/60 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="flex items-start justify-between gap-3">
                <span data-card-line="date" className="pt-0.5 text-sm text-muted">
                  {c.date}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span data-card-line="amount" className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {c.amount}
                  </span>
                  {c.extra && <span className="block text-xs text-muted">{c.extra}</span>}
                </span>
              </span>
              {c.counterparty && (
                <span data-card-line="counterparty" className="block truncate">
                  {c.counterparty}
                </span>
              )}
              <span data-card-line="account" className="block truncate text-sm text-muted">
                {c.account}
              </span>
              {c.category && (
                <span data-card-line="category" className="block truncate text-xs text-muted">
                  {c.category}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

В `src/client/pages/JournalPage.tsx` в `<JournalCards` удалите строку `          today={today}` (дата карточки больше не зависит от «сегодня»).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/client/journal-card.test.ts` → PASS. Run: `npx playwright test e2e/mobile.spec.ts` → PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/journal-card.ts src/client/components/journal/JournalCards.tsx src/client/pages/JournalPage.tsx tests/client/journal-card.test.ts e2e/mobile.spec.ts
git commit -m "feat: карточка журнала как в Finmap — дата и сумма, контрагент, счёт, категория мелко; без комментария, подсказка «Открыть операцию»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Формы на 390 px, клавиатура после «создать похожий» и «Дублировать», подписки на `visualViewport`

**Files:**
- Modify: `src/client/components/focus-trap.ts`, `src/client/components/operation/AmountField.tsx`
- Test: `tests/client/focus-trap.test.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `fieldAutoFocusAllowed`, `isCoarsePointer` (`focus-trap.ts`); `data-modal-close` у «×» окна (`Modal`); `useFloating` (подписка на `visualViewport` только пока список открыт).
- Produces: `refocusTarget(coarse: boolean): 'field' | 'close'`.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/focus-trap.test.ts` замените строку импорта на

```ts
import { fieldAutoFocusAllowed, refocusTarget, tabTarget, tabbable, type TabCandidate } from '../../src/client/components/focus-trap';
```

и после блока `describe('fieldAutoFocusAllowed: …')` добавьте:

```ts
describe('refocusTarget: куда вернуть фокус «в сумму» («создать похожий», «Дублировать платёж»)', () => {
  it('на компьютере — в поле; на устройстве с пальцем — на «×» окна, иначе поднимется экранная клавиатура', () => {
    expect(refocusTarget(false)).toBe('field');
    expect(refocusTarget(true)).toBe('close');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/focus-trap.test.ts`
Expected: FAIL — `refocusTarget` не экспортируется.

- [ ] **Step 3: `refocusTarget`**

В конец `src/client/components/focus-trap.ts` добавьте:

```ts
/**
 * Куда вернуть фокус, когда форма просит фокус в сумме («Добавить и создать похожий», «Дублировать платёж», «Загрузить
 * актуальную», сбой без поля с ошибкой): на компьютере — в поле; на устройстве с пальцем — на «×» окна (итоги 1.5-3b
 * «Телефон»): фокус в поле поднял бы экранную клавиатуру, поле человек выберет сам.
 */
export function refocusTarget(coarse: boolean): 'field' | 'close' {
  return fieldAutoFocusAllowed(coarse) ? 'field' : 'close';
}
```

Run: `npx vitest run tests/client/focus-trap.test.ts` → PASS.

- [ ] **Step 4: Write the failing e2e tests**

В `e2e/mobile.spec.ts` после теста `'список поля над экранной клавиатурой телефона: …'` добавьте:

```ts
test('список поля следит за видимой областью (visualViewport) только пока открыт: подписка при открытии, пересчёт по её событию, отписка при закрытии', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Видимая область ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  for (let i = 1; i <= 18; i++) await apiPost(page, `${base}/categories`, { kind: 'expense', name: `Категория ${String(i).padStart(2, '0')}` });
  await page.setViewportSize(PHONE);
  await page.reload();
  // подменная видимая область — до открытия списка, со счётчиком подписок (итоги 1.5-3a №1)
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    const w = window as unknown as { __vvListeners: number };
    w.__vvListeners = 0;
    const add = fake.addEventListener.bind(fake);
    const remove = fake.removeEventListener.bind(fake);
    fake.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => {
      w.__vvListeners++;
      add(...args);
    };
    fake.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => {
      w.__vvListeners--;
      remove(...args);
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
  });
  const listeners = () => page.evaluate(() => (window as unknown as { __vvListeners: number }).__vvListeners);

  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  const category = dialog.getByRole('combobox', { name: 'Категория', exact: true });
  await expect(category).toBeVisible();
  expect(await listeners(), 'пока списка нет, подписок нет').toBe(0);
  await category.click();
  const listbox = dialog.getByRole('listbox', { name: 'Категории' });
  const panel = listbox.locator('..');
  await expect(listbox).toBeVisible();
  await expect.poll(listeners).toBeGreaterThan(0);
  // клавиатура поднялась: над ней 500 px; событие — только у visualViewport, размер окна не менялся
  await page.evaluate(() => {
    const v = window.visualViewport as unknown as EventTarget & { height: number };
    v.height = 500;
    v.dispatchEvent(new Event('resize'));
  });
  await expect(async () => {
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }).toPass();
  // список закрыт — подписок на видимую область не осталось
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect.poll(listeners).toBe(0);
});

test('формы на 390 px (§8.7): доход, расход, перевод — на весь экран без прокрутки вбок, ряд операторов и калькулятор, главная кнопка во всю ширину, «×» в липкой шапке; «Указать», выделения и колонок на телефоне нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Формы 390 ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 30000 });
  await page.setViewportSize(PHONE);
  await page.reload();
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  // «Указать», выделение и колонки на телефоне не показываются
  await expect(page.getByRole('button', { name: /Указать/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Колонки' })).toHaveCount(0);

  for (const [label, title, submit] of [
    ['Доход', 'Новый доход', 'Добавить доход'],
    ['Расход', 'Новый расход', 'Добавить расход'],
    ['Перевод', 'Новый перевод', 'Добавить перевод'],
  ] as const) {
    await bar(page).getByRole('button', { name: label, exact: true }).click();
    const form = page.getByRole('dialog', { name: title, exact: true });
    const box = (await form.boundingBox())!;
    expect(box.width, title).toBeGreaterThanOrEqual(PHONE.width - 1);
    expect(box.height, title).toBeGreaterThanOrEqual(PHONE.height - 1);
    // ряд операторов под суммой — вместе с иконкой калькулятора (§8.7)
    await expect(form.getByRole('group', { name: /^Операторы/ }).first()).toBeVisible();
    await expect(form.getByRole('button', { name: 'Калькулятор' }).first()).toBeVisible();
    await expectNoSideScroll(page, title);
    // главная кнопка — внизу формы во всю ширину; «×» в липкой шапке видна и после прокрутки
    const main = form.getByRole('button', { name: submit, exact: true });
    await main.scrollIntoViewIfNeeded();
    const b = (await main.boundingBox())!;
    expect(b.width, `${title}: ширина главной кнопки`).toBeGreaterThan(PHONE.width - 64);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await expect(form.getByRole('button', { name: 'Закрыть', exact: true })).toBeInViewport();
    await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(form).toBeHidden();
  }
});
```

В группу `test.describe('касание (pointer: coarse), ширина 390 px', …)` после теста `'форма операции открывается без фокуса в поле: …'` добавьте:

```ts
  test('после «Добавить и создать похожий» и «Дублировать платёж» фокус — на «×», а не в сумме: экранная клавиатура сама не поднимается', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Похожий касанием ${Date.now()}`);
    await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
    await page.reload();
    await page.setViewportSize(PHONE);
    await bar(page).getByRole('button', { name: 'Расход', exact: true }).tap();
    const form = newForm(page);
    const amount = form.getByRole('textbox', { name: /^Сумма,/ });
    await form.getByRole('combobox', { name: 'Со счёта', exact: true }).tap();
    await form.getByRole('option', { name: 'Касса', exact: true }).tap();
    await amount.tap();
    await amount.fill('150');
    await form.getByRole('button', { name: 'Добавить и создать похожий' }).tap();
    await expect(form.getByText('Операция сохранена — можно ввести похожую')).toBeVisible();
    // Review Focus 5
    await expect(form.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(amount).not.toBeFocused();
    await form.getByRole('button', { name: 'Закрыть', exact: true }).tap();
    await expect(form).toBeHidden();

    // «Дублировать платёж» в открытой операции: копия, фокус — на «×»
    await cards(page).getByRole('button').first().tap();
    const edit = page.getByRole('dialog', { name: 'Расход', exact: true });
    await edit.getByRole('button', { name: 'Дублировать платёж' }).tap();
    const copy = page.getByRole('dialog', { name: 'Новый расход', exact: true });
    await expect(copy.getByText('Это копия — проверьте и сохраните')).toBeVisible();
    await expect(copy.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(copy.getByRole('textbox', { name: /^Сумма,/ })).not.toBeFocused();
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx playwright test e2e/mobile.spec.ts -g "создать похожий» и «Дублировать|visualViewport\) только пока|формы на 390"`
Expected: FAIL только у теста касания — после «создать похожий» фокус в сумме. Тесты видимой области и форм на 390 px проходят сразу: они закрепляют уже сделанное (итоги 1.5-3a, §8.7) — так и должно быть.

- [ ] **Step 6: `AmountField` — возврат фокуса по `refocusTarget`**

В `src/client/components/operation/AmountField.tsx` после строки `import { useAutoFocus } from '../useAutoFocus';` добавьте `import { isCoarsePointer, refocusTarget } from '../focus-trap';` и замените

```tsx
  // явный возврат фокуса после «Добавить и создать похожий»: один раз, когда новое состояние уже в DOM
  useEffect(() => {
    if (props.refocusSignal) ref.current?.focus();
  }, [props.refocusSignal]);
```

на

```tsx
  // явный возврат фокуса («Добавить и создать похожий», «Дублировать платёж»): один раз, когда новое состояние уже в DOM.
  // На устройстве с пальцем — на «×» окна: фокус в поле поднял бы экранную клавиатуру (refocusTarget)
  useEffect(() => {
    if (!props.refocusSignal) return;
    if (refocusTarget(isCoarsePointer()) === 'field') ref.current?.focus();
    else ref.current?.closest('dialog')?.querySelector<HTMLElement>('[data-modal-close]')?.focus({ preventScroll: true });
  }, [props.refocusSignal]);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/client/focus-trap.test.ts` → PASS. Run: `npx playwright test e2e/mobile.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts` → PASS (на компьютере фокус после «создать похожий» по-прежнему в сумме).

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/focus-trap.ts src/client/components/operation/AmountField.tsx tests/client/focus-trap.test.ts e2e/mobile.spec.ts
git commit -m "feat: формы на телефоне — после «создать похожий» и «Дублировать» фокус на «×», клавиатура не поднимается; e2e форм на 390 px и подписок на visualViewport

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Визуальная сверка телефона и «Проверить на телефоне»

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: окно «Фильтры» на телефоне (задача 1), карточка (задача 2), формы (задача 3); сценарии `cm01`–`cm05`, `cm07` (план 1.5-5a).
- Produces: снимок `cm06-filter.png`; итог сверки этапа «Телефон» и список «Проверить на телефоне» в отчёте задачи.

- [ ] **Step 1: Add the scenario**

В `scripts/ux-shots.ts` в `SCENARIOS` после сценария `cm05-income.png` (перед сценарием `cm07-settings.png`) вставьте:

```ts
  {
    ours: 'cm06-filter.png',
    finmap: 'm06-filter.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      // воронка сразу открывает окно «Фильтры» на весь экран, «Период» — первым полем (§8.5)
      await p.getByRole('main').getByRole('button', { name: /^Фильтр( · \d+)?$/ }).click();
      await p.getByRole('dialog', { name: 'Фильтры', exact: true }).waitFor();
    },
  },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 49 из 49.` Упавший сценарий — исправьте его локатор и запустите ещё раз.

- [ ] **Step 3: Compare and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `m01-log` ↔ `cm01-accounts`, `m02-log-closed-panel` ↔ `cm02-log`, `m03-more` ↔ `cm03-more`, `m04-op-open` ↔ `cm04-op-open`, `m05-income` ↔ `cm05-income`, `m06-filter` ↔ `cm06-filter`; `cm07-settings` — без пары.

В отчёт задачи (не в файл) — таблица по этим экранам: «совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** строка «Поиск | ⟳ | воронка | ▾» над списком; карточка — дата слева, сумма справа, контрагент, счёт; окно «Фильтры» — «Период» первым, затем «Типы платежей и категории», «Контрагенты», «Проекты», «Теги», «Счета», «Готово» и «Сохранить фильтр»; строки-действия в форме правки; «Новый доход» с главной кнопкой во всю ширину;
- **отличаются намеренно:** категория мелкой 4-й строкой карточки (решение владельца 1); окна формы и «Фильтры» — на весь экран, а не карточкой (решения 7 и 9 плана 1.5-5); ряд операторов под суммой (§8.7); блок «Ещё условия» (сумма, сортировка, выгрузка) — наш; «Очистить» в окне; сумма в базовой валюте под суммой (наше); нет «Изменить в перевод» (план 1.5-6) и «Сделать повторяющимся» (этап 3); цвета и шрифт;
- **отличается:** не ожидается; если найдётся — отдельной строкой таблицы с планом, где исправлять (1.5-6 или отложенное).

Там же — список **«Проверить на телефоне»** (Playwright этого не воспроизводит; контролёр переносит его в итоги плана):
- экранная клавиатура (Gboard, iOS Safari): списки категорий и контрагентов над клавиатурой и прокручиваются до последнего пункта; набор поверх выбранного значения («Аренда» + «и») без задвоения и потери букв; после выбора пункта клавиатура закрывается; iOS «Готово» / ⌄ при открытом списке — список закрывается, набранное не сохраняется (итоги 1.5-3a);
- «+ Строка» в разбиении на сенсорном экране: фокус на кнопке, новая строка прокручивается в видимую область (итоги 1.5-3a);
- Safari, iPhone: касание иконки калькулятора не вычисляет поле до открытия; протяжка пальцем с иконки в сторону; набор в строке «Время» при открытой клавиатуре (итоги 1.5-3c);
- окно «Фильтры» на весь экран: поля «Сумма от/до» и «Название фильтра» видны над клавиатурой, «×» в липкой шапке доступна; меню периода и календари «С» / «По» касанием на устройстве;
- форма на весь экран с клавиатурой: «Добавить …» достижима прокруткой; после «создать похожий» и «Дублировать» клавиатура не выскакивает, VoiceOver и TalkBack читают «Операция сохранена — можно ввести похожую» / «Это копия — проверьте и сохраните»;
- Android: системная «Назад» в форме, в вопросе о несохранённом и в окне «Фильтры» (отложенное 1.5-1a №3);
- iOS: страница под открытой формой и окном «Фильтры» не прокручивается (отложенное 7 №6).

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят. Проверьте, что панели «Период и условия» не осталось: `grep -rn "Период и условия\|panelConditionCount" src e2e scripts` → пусто.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap на телефоне — окно «Фильтры» в один шаг

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания, итог визуальной сверки и список «Проверить на телефоне» — `docs/superpowers/followups/2026-10-12-stage1_5-plan5b-followups.md` (пишет контролёр).
- План 1.5-5 закрыт целиком: §8.1–§8.7. Закрыты отложенные: 7 №1–№3 (панель фильтров на телефоне убрана), 7 №4 (подсказка у карточки), итоги 1.5-2a №3 и 1.5-3c №4 (e2e «Выбрать даты» и вложенные календари на телефоне), итоги 1.5-3a №1 (e2e подписок на `visualViewport`), итоги 1.5-3b «Телефон» (форма на весь экран, операторы под суммой, клавиатура после «создать похожий» и «Дублировать»).
- Следующий план — 1.5-6 «Изменить в перевод» (§6.8, §10.1).
