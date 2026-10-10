# Этап 1.5, план 1.5-2a: журнал — тулбар в одну строку, календарь, таблица, «Показывать полностью» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина плана 1.5-2 из §13 спецификации этапа 1.5:
- тулбар журнала в одну строку без подписей над полями (§5.1): пилюля периода `PeriodMenu` с пунктами Finmap, «За предыдущий год» и «Выбрать даты» на новых `Calendar` и `DateField` (§6.5); поиск с лупой внутри и кнопкой-лупой; составная кнопка «Фильтр · N | ▾» с меню «Быстрые фильтры»; меню «Ещё ▾» с «Сумма От/По», ⟳ «Обновить» (§2.5), колонками и выгрузкой;
- таблица (§5.2–5.3): дата в две строки («4 окт. 2026» и «Сегодня 10:32»), строки одной высоты с содержимым по центру, плашка «Указать», бейдж «системная», «Счёт/остаток» без слова «остаток», колонка «Дата сделки» (по умолчанию выключена), стрелка сортировки только у активной колонки;
- «Показывать полностью» (`journal.wrap`, до двух строк) — в «Ещё» и на странице «Настройки журнала» (§7.5);
- сценарии 17, 18b, 19 скрипта визуальной сверки и прогон `npm run shots:ux`.

**Предусловие:** выполнены планы 1.5-1a и 1.5-1b: `Modal` с «×», `ConfirmDialog`, `focusHeadingSoon` и `isPlainLeftClick` (`lib/focus-heading.ts`), `<h1>` журнала `sr-only`, страница «Настройки журнала» с колонками и «Спрашивать перед закрытием…», `scripts/ux-shots.ts`. Ожидаемо на старте: `npm test` — 646 тестов (+1 пропущен), `npm run test:e2e` — 69.

**Architecture:**
- **Календарь** — чистая логика `lib/calendar.ts` (сетка месяца, клавиши, подписи) с тестами и компонент `Calendar` по шаблону WAI-ARIA «date picker dialog»: таблица `role="grid"`, у дня `role="gridcell"`, в порядке Tab один день. `DateField` — поле-кнопка «С: 04.10.2026» с `Popover` и календарём.
- **Вложенные панели.** Календарь поля даты открывается внутри меню периода. `Popover` получает три правки: панель помечена `data-popover-panel`, вложенная панель рисуется внутри родительской (как сейчас внутри `<dialog>`), поэтому щелчок и фокус во вложенной панели для родительской «свои»; клавишу, которую уже обработала вложенная панель (`defaultPrevented`), родительская не трогает; начальный фокус — на элементе `data-autofocus` (активный день), иначе на первом.
- **Тулбар** собирается из небольших компонентов в `components/journal/`: `PeriodMenu`, `AmountRange`, `FilterButton` (с `SavedFiltersMenu` на стрелке), `MoreMenu` (с `ColumnsPanel`). На телефоне остаётся панель справа (её переделает план 1.5-5): в ней те же меню периода, «Сумма от/до», сортировка, «Фильтр | ▾», выгрузка и сброс.
- **⟳** вызывает новый `refreshOperations(cid)` (`lib/journal-mutations.ts`): то же, что `invalidateOperations` (журнал, счета с балансами, компании), но сбой перечитывания журнала не проглатывается (`throwOnError`) — панель «Ещё» сообщает «Не удалось обновить журнал». Бесконечный запрос перечитывает загруженные страницы на месте — таблица не размонтируется, прокрутка остаётся.
- **Таблица.** Даты — `formatDateShortRu` (`shared/dates.ts`) и `journalDateParts` (`lib/journal-format.ts`). Справочник категорий журнала — `categoryLookup(tree)`: `Map<number, { name, systemKey }>` (§10.3). Ячейки помечены `data-column` — e2e ищут по ним.
- **Настройки.** `journal.columns` получает id `accrualDate`; без сохранённой настройки «Дата сделки» выключена. `journal.wrap` — `boolean` (`lib/preferences.ts`). В «Ещё» обе настройки применяются сразу, на странице «Настройки журнала» — по «Применить».

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §1, §2.2, §2.3, §2.5, §5.1–5.3, §6.5 (только `Calendar` и `DateField`), §7.5, §10.2, §11, §12, §13 (план 1.5-2, блок «Решения планирования плана 1.5-2»). Аудит: [01-shell-journal.md](../../research/ux-parity/01-shell-journal.md) — M3–M6, M8–M11, M15, L3–L7, L9, L11.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

**Вторая половина** — [план 1.5-2b](2026-10-10-stage1_5-plan2b-journal-actions-filter.md): «Указать» окном (§5.4), полоса массовых действий и «Изменить данные» (§5.5), окно «Фильтры» с мультивыборами (§5.6).

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-2») тем же коммитом, что и план.

1. **План 1.5-2 разбит на 1.5-2a и 1.5-2b.** Каждая часть даёт работающий журнал; 2a не трогает «Указать», массовые действия и окно фильтра, кроме плашки «Указать» и названия меню сохранённых фильтров.
2. **Календарь** — таблица `role="grid"`; у дня `role="gridcell"`, `tabindex` (0 у активного дня), имя «4 октября 2026», выбранный — `aria-selected="true"`, сегодня — `aria-current="date"`. Кнопки «« ‹ › »» — «Предыдущий год», «Предыдущий месяц», «Следующий месяц», «Следующий год»; они меняют месяц, фокус остаётся на кнопке.
3. **Вложенные панели `Popover`** — см. «Architecture». Esc в календаре закрывает только календарь, меню периода остаётся; фокус — на поле даты. Порядок Tab панели (первый и последний элемент) и начальный фокус считаются только по её собственным элементам — элементы вложенной панели в него не входят.
4. **«Выбрать даты»** начинается с границ выбранного периода (как прежнее «Произвольно»). Можно задать одну границу; перепутанные границы меняются местами. Подпись пилюли — «04.10.2026 – 10.10.2026», «с 04.10.2026», «по 10.10.2026». Имя пилюли — «Период: {подпись}».
5. **Суммы в «Ещё»** применяются по Enter, уходу из поля и при закрытии панели (панель, закрытая щелчком мимо, не теряет набранное: поле при размонтировании применяет значение, если оно верное). При размонтировании — только если путь страницы тот же, что при открытии поля: после перехода (ссылка «Настройки журнала», «Назад» браузера, смена компании) правка фильтра увела бы чужую страницу обратно в журнал. Вариант «только blur и Enter» не взят: щелчок мимо закрывает панель раньше, чем приходит blur, и набранное терялось бы.
6. **⟳** сообщает «Журнал обновлён» или «Не удалось обновить журнал» в живой области панели «Ещё» (`role="status"`): `refreshOperations` перечитывает журнал с `throwOnError`, а `invalidateQueries` без него сбой проглатывает. Пока идёт запрос, кнопка `aria-disabled`. Ссылка «Настройки журнала» в «Ещё» ставит фокус на `<h1>` страницы (`focusHeadingSoon`).
7. **«Быстрые фильтры»**: пустое меню — пояснение и кнопка «Создать новый фильтр»; она закрывает меню (фокус на ▾) и открывает окно фильтра, после окна фокус возвращается на ▾. Имя стрелки — «Быстрые фильтры». В архивной компании сохранять нечего: пустое меню — только «Сохранённых фильтров нет.», без кнопки и подсказки.
8. **Телефон до плана 1.5-5:** панель справа «Фильтры» остаётся (переименование — в 1.5-2b), но в ней те же `PeriodMenu`, `AmountRange` и «Фильтр | ▾»; «Колонок» и «Ещё» на телефоне нет. Карточки телефона сохраняют прежнюю дату («сегодня 10:30») до плана 1.5-5.
9. **Дата в именах кнопки строки и флажка** — «Открыть операцию: 4 окт. 2026, Сегодня 10:32, +500 ₸», «Выбрать операцию: 4 окт. 2026, Сегодня 10:32, …».
10. **Цвет.** Текст плашки «Указать» и бейджа «системная» — новый токен `income-strong` (#0b7a53): 4,7:1 на `income-soft`. У `text-income` на `bg-income-soft` из §5.2 контраст около 3:1 — меньше AA для мелкого текста. Тот же токен — фон полосы действий в 1.5-2b (5,4:1 с белым).
11. **Ошибка «Применить» в «Настройках журнала»** — «Сохранено: колонки. Не сохранено: вопрос о несохранённом — {причина}» или «Не сохранено: колонки — {причина}». Закрывает отложенное 1b №5.

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: периоды «Сегодня» и «Вчера», фильтр в адресе страницы, подсветка выделенных строк, красный отрицательный остаток, остатки у обоих счетов перевода, сумма в базовой валюте под суммой в валюте. **Мёртвых кнопок нет.**
- **Тулбар (§5.1):** одна строка без подписей над полями, слева направо — пилюля периода, поиск, «Фильтр · N | ▾», «Ещё ▾». Пункты периода: «За текущий год» `year`, «За предыдущий год» `lastYear`, «За текущую неделю» `week`, «За прошлую неделю» `lastWeek`, «За текущий месяц» `month`, «За прошлый месяц» `lastMonth`, «За все время» `all`, «За сегодня» `today`, «За вчера» `yesterday`, «Выбрать даты» `custom`; пункты — кнопки, у текущего `aria-current="true"` и ✓; «Выбрать даты» переключает ту же панель на поля «С» и «По» (`DateField`, без времени) и «Применить»; ключи в адресе не меняются. Поиск — поле с лупой внутри, плейсхолдер «Поиск по счетам, контрагентам, комментариям», доступное имя «Поиск», справа квадратная кнопка-лупа `type="submit"`; живой поиск через 300 мс и по Enter остаётся. «Фильтр · N | ▾»: левая часть открывает окно фильтра, стрелка — «Быстрые фильтры»; пустое состояние — пояснение и «Создать новый фильтр»; при заданном фильтре рядом ✕ «Сбросить фильтр». «Ещё ▾»: «Сумма» — «От» и «По» (доступные имена «Сумма от» и «Сумма до», базовая валюта), ⟳ «Обновить», ▥ «Колонки», ⤓ «Выгрузить в Excel» (ссылка `exportHref`); ▥ раскрывает ниже в той же панели список колонок, «Показывать полностью» и ссылку «Настройки журнала». Переключателя Finmap рядом с суммой нет.
- **Обновление (§2.5):** ⟳ вызывает `invalidateOperations(cid)` — журнал, счета и балансы, компании; загруженные страницы журнала перезапрашиваются, позиция прокрутки сохраняется. Журнал сам при возврате на вкладку не перезапрашивается.
- **Таблица (§5.2):** строки одной высоты, `min-h` 4.5rem, содержимое по центру по вертикали; длинный текст — одна строка с `title`, при `journal.wrap` — до двух (`line-clamp-2`). Флажки 18 px, `accent-color` акцента. Дата — «4 окт. 2026» и ниже серым «10:32», для сегодня и вчера — «Сегодня 10:32», «Вчера 10:32»; кнопка открытия строки с клавиатуры — в ячейке даты. Сумма — обычное начертание, «+» доход, «−» (U+2212) расход, перевод «⇄», ₸ после суммы; вторая строка — сумма в базовой валюте. «Дата сделки» — третья колонка, `accrualDate` «4 окт. 2026», пусто без даты, по умолчанию выключена. «Счёт/остаток»: строка 1 — счёт, строка 2 серым — остаток «114 997 ₸» без слова «остаток», отрицательный красным; у перевода «Касса → Kaspi» и «114 997 ₸ → 20 000 ₸». Категория — название и у категории с собственным `systemKey` бейдж «системная»; у разбитой — «2 категории» с подсказкой. «Указать» — плашка `rounded-md bg-income-soft px-2 py-0.5 text-xs font-medium`, видна всегда. Стрелка сортировки только у активной колонки, у неактивной «↕» при наведении и фокусе.
- **Колонки (§5.3, §10.2):** Дата, Сумма, Дата сделки, Счёт/остаток, Контрагент, Категория, Проект, Комментарий; дата и сумма всегда видны. Без сохранённой настройки — все, кроме «Даты сделки»; сохранённый массив без `accrualDate` — колонка выключена. `journal.wrap` — `boolean`, по умолчанию `false`; значения неизвестного вида — по умолчанию.
- **«Настройки журнала» (§7.5):** флажки колонок в порядке §5.3 («Дата» и «Сумма» отмечены и недоступны), «Показывать полностью (до 2 строк)» → `journal.wrap`, «Спрашивать перед закрытием формы с несохранёнными данными»; «Применить» сохраняет всё вместе.
- **Календарь (§6.5, §11):** шапка «ОКТЯБРЬ 2026», кнопки «« ‹ › »»; неделя с понедельника, дни других месяцев приглушены, сегодня выделено; `max` делает дни после него неактивными с подсказкой «Плановые платежи появятся позже» (в журнале `max` нет). Стрелки — день или неделя, PageUp/PageDown — месяц, Shift+PageUp/PageDown — год, Home/End — начало и конец недели, Enter или пробел — выбор; заголовок месяца `aria-live="polite"`.
- **Доступность (§11):** `Popover` — правила R2 плана 5b без изменений: Tab с кнопки — в панель, Shift+Tab с первого элемента — на кнопку, Tab за последним закрывает панель, уход фокуса закрывает, Esc закрывает и возвращает фокус. Подписи тулбара — доступные имена: «Поиск», «Сумма от», «Сумма до», «Период: {выбранный}».
- **Деньги и даты:** суммы на экране — `formatMoney(…, MONEY_SCREEN)` (₸ после суммы, без нулевых копеек); даты — в `APP_TIMEZONE` (`/meta.timezone`).
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; левая панель `<nav aria-label="Счета">` есть на каждой странице журнала; `name:` в Playwright — подстрока без учёта регистра (где нужно точное совпадение — `exact: true` или регулярное выражение с `^`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя тест возвращает в `finally` к исходному значению; без фиксированных пауз.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой (`e2e/server.ts`); `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Календарь на границах месяцев и лет:** PageUp с 31 марта ведёт на последний день февраля (28 или 29), неделя через Новый год, Home/End в воскресенье и понедельник. Тест — задача 1 (unit).
2. **«Выбрать даты» с одной границей или с «По» раньше «С»:** журнал не пустеет из-за перепутанных дат — границы меняются местами; одна граница — открытый период с подписью «с …» / «по …». Тест — задача 2 (unit).
3. **Сумма в «Ещё», набранная без Enter, когда панель закрыли щелчком мимо:** значение применяется, а не теряется; неверное значение не применяется. Тест — задача 3 (e2e).
4. **⟳ после прокрутки:** загруженные страницы перечитываются (их не меньше, чем было), место прокрутки не сбрасывается к началу, балансы в левой панели обновляются. Тест — задача 3 (e2e).
5. **Сохранённая до этого плана настройка `journal.columns` (без `accrualDate`)** и отсутствие настройки — «Дата сделки» выключена; после включения колонка третья. Тесты — задача 4 (unit и e2e).
6. **Esc в календаре внутри меню периода** закрывает только календарь; меню периода и выбранные в нём даты остаются, фокус — на поле даты. Тест — задача 2 (e2e).

---

## Карта файлов

```
src/shared/dates.ts                                # formatDateShortRu
src/client/styles.css                              # токен income-strong
src/client/lib/calendar.ts                         # (новый) сетка месяца, клавиши, подписи
src/client/lib/journal-filter.ts                   # PERIODS, lastYear, withPeriod, periodLabel
src/client/lib/journal-format.ts                   # journalDateParts, CategoryInfo, categoryLookup
src/client/lib/journal-columns.ts                  # accrualDate, «Счёт/остаток», по умолчанию без «Даты сделки»
src/client/lib/journal-card.ts                     # справочник категорий — объекты
src/client/lib/preferences.ts                      # JOURNAL_WRAP_PREF, journalWrap, prefsSaveError
src/client/components/Popover.tsx                  # вложенные панели, data-autofocus
src/client/components/icons.tsx                    # иконки календаря, поиска, фильтра, обновления, колонок, выгрузки
src/client/components/Calendar.tsx                 # (новый)
src/client/components/DateField.tsx                # (новый)
src/client/components/journal/PeriodMenu.tsx       # (новый) пилюля периода
src/client/components/journal/AmountRange.tsx      # (новый) «Сумма от/до»
src/client/components/journal/FilterButton.tsx     # (новый) «Фильтр · N | ▾»
src/client/components/journal/MoreMenu.tsx         # (новый) «Ещё ▾»
src/client/components/journal/ColumnsPanel.tsx     # (новый) колонки и «Показывать полностью»
src/client/components/journal/ColumnsPicker.tsx    # (удаляется)
src/client/components/journal/SavedFiltersMenu.tsx # «Быстрые фильтры», «Создать новый фильтр»
src/client/components/journal/JournalToolbar.tsx   # одна строка; телефон — панель справа
src/client/components/journal/JournalTable.tsx     # §5.2
src/client/components/journal/AssignPicker.tsx     # плашка «Указать»
src/client/pages/JournalPage.tsx                   # тулбар, ⟳, справочник категорий, wrap
src/client/pages/settings/JournalViewSettings.tsx  # «Показывать полностью», текст ошибки
scripts/ux-shots.ts                                # сценарии 17, 18b, 19
tests/client/calendar.test.ts                      # (новый)
tests/client/journal.test.ts, journal-card.test.ts, preferences.test.ts, tests/shared/dates.test.ts
e2e/journal.spec.ts, journal-actions.spec.ts, mobile.spec.ts, operation-form.spec.ts, operation-edit.spec.ts, dialogs.spec.ts
```

---

### Task 1: Календарь и поле даты; вложенные панели `Popover`

**Files:**
- Create: `src/client/lib/calendar.ts`, `src/client/components/Calendar.tsx`, `src/client/components/DateField.tsx`, `tests/client/calendar.test.ts`
- Modify: `src/client/components/Popover.tsx` (целиком), `src/client/components/icons.tsx`

**Interfaces:**
- Consumes: `addDays`, `formatDateRu` (`src/shared/dates.ts`); `Field` (`components/Field.tsx`); `Popover` (`components/Popover.tsx`).
- Produces:
  - `monthTitle(date: string): string` — «Октябрь 2026»; `longDateRu(date: string): string` — «4 октября 2026»; `weekdayOf(date: string): number` (понедельник — 0); `addMonths(date: string, n: number): string`; `monthWeeks(date: string): string[][]`; `sameMonth(a: string, b: string): boolean`; `moveDate(date: string, key: string, shiftKey: boolean): string | null`; `WEEKDAYS: readonly { short: string; long: string }[]` (`lib/calendar.ts`);
  - `Calendar(props: { value: string | null; today: string; max?: string; onSelect: (date: string) => void })`, `AFTER_MAX_HINT` (`components/Calendar.tsx`);
  - `DateField(props: { label: string; value: string | null; today: string; max?: string; onChange: (date: string) => void; className?: string })` — кнопка с именем «{label}: 04.10.2026» или «{label}: не выбрана», панель «{label}: календарь» (`components/DateField.tsx`);
  - `CalendarIcon()` (`components/icons.tsx`);
  - `Popover`: панель с атрибутом `data-popover-panel`; вложенная панель рисуется в родительской; порядок Tab и начальный фокус (`[data-autofocus]`, иначе первый элемент) — только по своим элементам, без элементов вложенной панели.

- [ ] **Step 1: Write the failing unit tests**

`tests/client/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addMonths, longDateRu, monthTitle, monthWeeks, moveDate, sameMonth, weekdayOf, WEEKDAYS } from '../../src/client/lib/calendar';

describe('календарь (§6.5 этапа 1.5)', () => {
  it('подписи: заголовок месяца и полная дата для программ чтения; неделя с понедельника', () => {
    expect(monthTitle('2026-10-04')).toBe('Октябрь 2026');
    expect(monthTitle('2027-01-31')).toBe('Январь 2027');
    expect(longDateRu('2026-10-04')).toBe('4 октября 2026');
    expect(longDateRu('2026-05-01')).toBe('1 мая 2026');
    expect(WEEKDAYS.map((w) => w.short)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    expect(weekdayOf('2026-10-05')).toBe(0);
    expect(weekdayOf('2026-10-11')).toBe(6);
  });

  it('сетка месяца — целые недели с понедельника, с днями соседних месяцев', () => {
    const october = monthWeeks('2026-10-15');
    expect(october).toHaveLength(5);
    expect(october[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(october[4]![6]).toBe('2026-11-01');
    // февраль 2027 начинается в понедельник и кончается в воскресенье — ровно 4 недели
    const february = monthWeeks('2027-02-10');
    expect(february).toHaveLength(4);
    expect(february[0]![0]).toBe('2027-02-01');
    expect(february[3]![6]).toBe('2027-02-28');
    expect(sameMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(sameMonth('2026-09-30', '2026-10-01')).toBe(false);
  });

  it('сдвиг на месяцы: число не больше последнего дня месяца, через границу года, високосный февраль (Review Focus 1)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('2026-10-04', 12)).toBe('2027-10-04');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('клавиши сетки: день, неделя, начало и конец недели, месяц, год; прочие — null (Review Focus 1)', () => {
    const d = '2026-10-07'; // среда
    expect(moveDate(d, 'ArrowLeft', false)).toBe('2026-10-06');
    expect(moveDate(d, 'ArrowRight', false)).toBe('2026-10-08');
    expect(moveDate(d, 'ArrowUp', false)).toBe('2026-09-30');
    expect(moveDate(d, 'ArrowDown', false)).toBe('2026-10-14');
    expect(moveDate(d, 'Home', false)).toBe('2026-10-05');
    expect(moveDate(d, 'End', false)).toBe('2026-10-11');
    expect(moveDate(d, 'PageUp', false)).toBe('2026-09-07');
    expect(moveDate(d, 'PageDown', false)).toBe('2026-11-07');
    expect(moveDate(d, 'PageUp', true)).toBe('2025-10-07');
    expect(moveDate(d, 'PageDown', true)).toBe('2027-10-07');
    // через Новый год; Home и End в понедельник и воскресенье
    expect(moveDate('2026-12-31', 'ArrowRight', false)).toBe('2027-01-01');
    expect(moveDate('2027-01-03', 'Home', false)).toBe('2026-12-28');
    expect(moveDate('2026-12-28', 'End', false)).toBe('2027-01-03');
    expect(moveDate('2026-03-31', 'PageUp', false)).toBe('2026-02-28');
    expect(moveDate(d, 'Enter', false)).toBeNull();
    expect(moveDate(d, 'a', false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/calendar.test.ts`
Expected: FAIL — модуль `src/client/lib/calendar` не найден.

- [ ] **Step 3: Implement `lib/calendar.ts`**

`src/client/lib/calendar.ts`:

```ts
import { addDays } from '../../shared/dates';

/** Заголовок календаря — именительный падеж (§6.5 этапа 1.5: «ОКТЯБРЬ 2026», заглавные — стилем). */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
/** Полная дата для программ чтения — родительный падеж: «4 октября 2026». */
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Дни недели с понедельника: короткие — в шапке сетки, полные — `abbr` для программ чтения. */
export const WEEKDAYS: readonly { short: string; long: string }[] = [
  { short: 'Пн', long: 'понедельник' },
  { short: 'Вт', long: 'вторник' },
  { short: 'Ср', long: 'среда' },
  { short: 'Чт', long: 'четверг' },
  { short: 'Пт', long: 'пятница' },
  { short: 'Сб', long: 'суббота' },
  { short: 'Вс', long: 'воскресенье' },
];

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `YYYY-MM-DD` → «Октябрь 2026». */
export function monthTitle(date: string): string {
  const [y, m] = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}

/** `YYYY-MM-DD` → «4 октября 2026». */
export function longDateRu(date: string): string {
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS_GENITIVE[m - 1]} ${y}`;
}

/** День недели: понедельник — 0, воскресенье — 6. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Сдвиг на n месяцев; число — не больше последнего дня нового месяца (31 января + 1 месяц = 28 или 29 февраля). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** Даты в одном месяце. */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Недели месяца даты date: от понедельника первой недели до воскресенья последней, с днями соседних месяцев. */
export function monthWeeks(date: string): string[][] {
  const [y, m] = parts(date);
  const first = `${pad(y, 4)}-${pad(m)}-01`;
  const last = `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  const end = addDays(last, 6 - weekdayOf(last));
  const weeks: string[][] = [];
  let day = addDays(first, -weekdayOf(first));
  while (day <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Куда переходит активный день сетки по клавише (§11 этапа 1.5, шаблон WAI-ARIA «date picker»): стрелки — день
 * и неделя, Home/End — начало и конец недели, PageUp/PageDown — месяц, с Shift — год. Другая клавиша — null.
 */
export function moveDate(date: string, key: string, shiftKey: boolean): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return addDays(date, -weekdayOf(date));
    case 'End':
      return addDays(date, 6 - weekdayOf(date));
    case 'PageUp':
      return addMonths(date, shiftKey ? -12 : -1);
    case 'PageDown':
      return addMonths(date, shiftKey ? 12 : 1);
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/client/calendar.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: `Popover` — nested panels and `data-autofocus`**

Замените `src/client/components/Popover.tsx` целиком:

```tsx
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FieldControlProps } from './Field';
import { btnSmall } from './ui';
import { useFloating } from './useFloating';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], a[href]';

/**
 * Всплывающая панель у кнопки: кнопка с aria-haspopup и aria-expanded, панель — немодальный role="dialog".
 * Панель рисуется порталом в body (position: fixed), поэтому её не обрезают контейнеры с прокруткой
 * (обёртка таблицы журнала). При открытии фокус — на элементе с `data-autofocus` (активный день календаря),
 * иначе на первом элементе панели; Esc закрывает и возвращает фокус на кнопку; клик мимо и уход фокуса
 * из кнопки и панели закрывают её.
 * Панель в DOM стоит вне кнопки, поэтому порядок Tab замкнут вручную: Tab с кнопки ведёт в панель,
 * Shift+Tab с первого элемента панели — на кнопку, Tab за последним элементом закрывает панель
 * и возвращает фокус на кнопку.
 * Вложенная панель (календарь поля даты в меню периода, §6.5 этапа 1.5) рисуется внутри родительской
 * (`data-popover-panel`), а в модальном окне — в самом `<dialog>`: для родительской она «своя» — щелчок и фокус
 * в ней родительскую не закрывают; клавиши, которые вложенная панель уже обработала (Esc, Tab на краю),
 * родительская не трогает; первый и последний элемент для Tab и начальный фокус родительская считает только
 * по своим элементам.
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
  /** id и aria-атрибуты поля формы (`Field`): подпись `<label for>`, подсказка и ошибка связываются с кнопкой. */
  control?: FieldControlProps;
  /** Название панели, если оно не совпадает с именем кнопки. */
  panelLabel?: string;
  /**
   * Кнопка недоступна, но остаётся в порядке фокуса (aria-disabled, щелчок не открывает панель): фокус,
   * вернувшийся на неё после выбора, не теряется, пока идёт начатое действие.
   */
  inactive?: boolean;
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
  const name = props.panelLabel ?? props.ariaLabel ?? (typeof props.label === 'string' ? props.label : undefined);

  /** Узел — внутри кнопки или панели (панель не внутри rootRef: она в портале). */
  const inside = (node: Node | null) => !!node && (!!rootRef.current?.contains(node) || !!panelRef.current?.contains(node));
  /** Свой элемент панели, а не вложенной (календарь поля даты): у вложенной панели свой порядок Tab. */
  const own = (el: Element) => el.closest('[data-popover-panel]') === panelRef.current;
  const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(own);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!placed) return;
    const auto = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-autofocus]') ?? []).find(own);
    (auto ?? focusable()[0])?.focus();
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    // фокус ушёл за пределы кнопки и панели (Tab, программный focus) — закрываем
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        {...props.control}
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        aria-disabled={props.inactive || undefined}
        onClick={() => {
          if (!props.inactive) setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          // фокус на кнопке при открытой панели (после Shift+Tab с первого элемента): Esc всё равно закрывает
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
            return;
          }
          if (e.key !== 'Tab' || e.shiftKey || !placed) return;
          const first = focusable()[0];
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
        className={`${props.buttonClassName ?? btnSmall} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
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
            data-popover-panel=""
            style={style}
            onKeyDown={(e) => {
              // клавишу уже обработала вложенная панель или кнопка внутри (Tab на краю вложенной панели)
              if (e.defaultPrevented) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
                return;
              }
              if (e.key !== 'Tab') return;
              const items = focusable();
              const edge = e.shiftKey ? items[0] : items[items.length - 1];
              if (items.length > 0 && document.activeElement !== edge) return;
              e.preventDefault();
              if (e.shiftKey) buttonRef.current?.focus();
              else close(true);
            }}
            className={`z-40 overflow-y-auto rounded-2xl bg-card p-3 text-ink shadow-xl ring-1 ring-field ${props.panelClassName ?? 'w-64'}`}
          >
            {props.children(close)}
          </div>,
          // внутри модального окна (<dialog> через showModal) всё вне окна недоступно — панель рисуется в самом окне;
          // вложенная панель — внутри родительской: щелчок и фокус в ней родительскую не закрывают
          rootRef.current?.closest('dialog, [data-popover-panel]') ?? document.body,
        )}
    </div>
  );
}
```

- [ ] **Step 6: Calendar icon, `Calendar`, `DateField`**

В начало `src/client/components/icons.tsx` (перед `/** Иконки шапки …`) вставьте импорт, а в конец файла — общую обёртку и иконку календаря:

```tsx
import type { ReactNode } from 'react';
```

```tsx
/** Иконки журнала (§5 этапа 1.5): рисунок 16 px; имя кнопке даёт `aria-label` или текст рядом. */
function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  );
}
```

`src/client/components/Calendar.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { addMonths, longDateRu, monthTitle, monthWeeks, moveDate, sameMonth, WEEKDAYS } from '../lib/calendar';

/** Подсказка у дней после max (§6.5 этапа 1.5). */
export const AFTER_MAX_HINT = 'Плановые платежи появятся позже';

/**
 * Сетка месяца (§6.5, §11 этапа 1.5) — шаблон WAI-ARIA «date picker dialog»: таблица role="grid", в порядке Tab
 * один день (roving tabindex), он же получает фокус при открытии (`data-autofocus`, см. Popover). Стрелки — день
 * и неделя, PageUp/PageDown — месяц, Shift+PageUp/PageDown — год, Home/End — начало и конец недели, Enter и пробел —
 * выбор. Дни после max недоступны (aria-disabled) и не выбираются. Заголовок месяца — aria-live: смена месяца
 * слышна. Неделя с понедельника, дни соседних месяцев приглушены, сегодня обведено.
 */
export function Calendar(props: { value: string | null; today: string; max?: string; onSelect: (date: string) => void }) {
  const [active, setActive] = useState(() => props.value ?? (props.max !== undefined && props.today > props.max ? props.max : props.today));
  const gridRef = useRef<HTMLTableElement>(null);
  // фокус переезжает на новый день только после клавиш сетки; кнопки «‹ ›» оставляют его на себе
  const moveFocus = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [active]);

  const blocked = (d: string) => props.max !== undefined && d > props.max;
  const choose = (d: string) => {
    if (!blocked(d)) props.onSelect(d);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, d: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(d);
      return;
    }
    const next = moveDate(d, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    moveFocus.current = true;
    setActive(next);
  };
  const nav = (label: string, sign: string, months: number) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setActive((a) => addMonths(a, months))}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{sign}</span>
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        {nav('Предыдущий год', '«', -12)}
        {nav('Предыдущий месяц', '‹', -1)}
        <p id={titleId} aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold uppercase">
          {monthTitle(active)}
        </p>
        {nav('Следующий месяц', '›', 1)}
        {nav('Следующий год', '»', 12)}
      </div>
      <table ref={gridRef} role="grid" aria-labelledby={titleId} className="w-full border-collapse text-center text-sm">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w.short} scope="col" abbr={w.long} className="pb-1 text-xs font-medium text-muted">
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(active).map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const off = blocked(d);
                const selected = d === props.value;
                return (
                  <td
                    key={d}
                    role="gridcell"
                    tabIndex={d === active ? 0 : -1}
                    data-autofocus={d === active ? '' : undefined}
                    aria-selected={selected}
                    aria-disabled={off || undefined}
                    aria-current={d === props.today ? 'date' : undefined}
                    aria-label={longDateRu(d)}
                    title={off ? AFTER_MAX_HINT : undefined}
                    onClick={() => {
                      setActive(d);
                      choose(d);
                    }}
                    onKeyDown={(e) => onKeyDown(e, d)}
                    className={[
                      'h-9 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      selected ? 'bg-income font-semibold text-white' : 'hover:bg-field',
                      !selected && d === props.today ? 'ring-1 ring-inset ring-income' : '',
                      !selected && !sameMonth(d, active) ? 'text-muted' : '',
                      off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {Number(d.slice(8))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/client/components/DateField.tsx`:

```tsx
import { formatDateRu } from '../../shared/dates';
import { Calendar } from './Calendar';
import { Field } from './Field';
import { CalendarIcon } from './icons';
import { Popover } from './Popover';

export const dateButtonClass =
  'flex w-full items-center justify-between gap-2 rounded-xl bg-field px-4 py-2.5 text-left text-sm outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Поле даты (§6.5 этапа 1.5): кнопка с датой «04.10.2026» и иконкой календаря; открывает `Calendar` во всплывающей
 * панели, выбор дня закрывает её и возвращает фокус на поле. Ввода с клавиатуры в само поле нет — день выбирается
 * в сетке (стрелки, Enter). Имя кнопки — «{подпись}: {дата}», подпись `Field` связана с ней.
 */
export function DateField(props: {
  label: string;
  value: string | null;
  today: string;
  /** Дни после max недоступны (дата оплаты — не позже сегодня); у «Даты сделки» и периода журнала max нет. */
  max?: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const shown = props.value ? formatDateRu(props.value) : null;
  return (
    <Field label={props.label} className={props.className}>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className={shown ? '' : 'text-muted'}>{shown ?? 'Не выбрана'}</span>
              <CalendarIcon />
            </>
          }
          ariaLabel={`${props.label}: ${shown ?? 'не выбрана'}`}
          panelLabel={`${props.label}: календарь`}
          buttonClassName={dateButtonClass}
          panelClassName="w-72"
        >
          {(close) => (
            <Calendar
              value={props.value}
              today={props.today}
              max={props.max}
              onSelect={(date) => {
                props.onChange(date);
                close(true);
              }}
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
```

- [ ] **Step 7: Run all checks**

Run: `npm test` → PASS, 650 (646 + 4), +1 пропущен. Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` → 69 passed: поведение существующих панелей (колонки, сохранённые фильтры, списки «Указать», списки формы) не изменилось. Компоненты `Calendar` и `DateField` подключает задача 2, её e2e их и проверяют.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/calendar.ts src/client/components/Calendar.tsx src/client/components/DateField.tsx src/client/components/Popover.tsx src/client/components/icons.tsx tests/client/calendar.test.ts
git commit -m "feat: календарь и поле даты (§6.5); вложенные всплывающие панели и начальный фокус по data-autofocus

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Меню периода — пилюля «За все время ▾», «За предыдущий год», «Выбрать даты»

**Files:**
- Create: `src/client/components/journal/PeriodMenu.tsx`
- Modify: `src/client/lib/journal-filter.ts`, `src/client/components/journal/JournalToolbar.tsx` (целиком), `tests/client/journal.test.ts`, `e2e/journal.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `DateField` (задача 1), `Popover`, `formatDateRu` (`shared/dates.ts`).
- Produces:
  - `PERIODS` — новый порядок и подписи; `PeriodKey` включает `'lastYear'`; `periodRange` знает `lastYear`;
  - `withPeriod(state: JournalUrlState, period: PeriodKey, range?: { from?: string; to?: string }): JournalUrlState`;
  - `periodLabel(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>): string` (`lib/journal-filter.ts`);
  - `PeriodMenu(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void })` — кнопка «Период: {подпись}», панель «Период» (`components/journal/PeriodMenu.tsx`).

- [ ] **Step 1: Write the failing unit tests**

В `tests/client/journal.test.ts` в импорт из `journal-filter` добавьте `PERIODS`, `periodLabel`, `withPeriod` (импорт станет таким):

```ts
import {
  applyDialogFields,
  clearFilter,
  EMPTY_JOURNAL_STATE,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  PERIODS,
  periodLabel,
  periodRange,
  pickDialogFields,
  withPeriod,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';
```

и после блока `describe('periodRange — …')` вставьте:

```ts
describe('меню периода (§5.1 этапа 1.5)', () => {
  it('пункты и порядок как в Finmap; наши «За сегодня» и «За вчера» — перед «Выбрать даты»', () => {
    expect(PERIODS.map((p) => p.label)).toEqual([
      'За текущий год',
      'За предыдущий год',
      'За текущую неделю',
      'За прошлую неделю',
      'За текущий месяц',
      'За прошлый месяц',
      'За все время',
      'За сегодня',
      'За вчера',
      'Выбрать даты',
    ]);
    expect(PERIODS.map((p) => p.key)).toEqual(['year', 'lastYear', 'week', 'lastWeek', 'month', 'lastMonth', 'all', 'today', 'yesterday', 'custom']);
  });

  it('«За предыдущий год» — с 1 января по 31 декабря прошлого года; ключ в адресе — lastYear', () => {
    expect(periodRange({ period: 'lastYear' }, '2026-10-07')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodRange({ period: 'lastYear' }, '2026-01-01')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(parse('period=lastYear').period).toBe('lastYear');
    expect(journalSearch(state({ period: 'lastYear' })).toString()).toBe('period=lastYear');
  });

  it('withPeriod: у обычного периода границ нет; «Выбрать даты» — одна или две границы, перепутанные меняются местами (Review Focus 2)', () => {
    const custom = state({ period: 'custom', from: '2026-10-01', to: '2026-10-05', q: 'аренда' });
    expect(withPeriod(custom, 'month')).toEqual(state({ period: 'month', q: 'аренда' }));
    expect(withPeriod(state({}), 'custom', { from: '2026-10-10', to: '2026-10-04' })).toEqual(state({ period: 'custom', from: '2026-10-04', to: '2026-10-10' }));
    expect(withPeriod(state({}), 'custom', { to: '2026-10-04' })).toEqual(state({ period: 'custom', to: '2026-10-04' }));
    expect(withPeriod(state({ period: 'today' }), 'custom', {})).toEqual(state({ period: 'custom' }));
  });

  it('подпись пилюли: пункт меню или даты', () => {
    expect(periodLabel({ period: 'all' })).toBe('За все время');
    expect(periodLabel({ period: 'lastYear' })).toBe('За предыдущий год');
    expect(periodLabel({ period: 'custom', from: '2026-10-04', to: '2026-10-10' })).toBe('04.10.2026 – 10.10.2026');
    expect(periodLabel({ period: 'custom', from: '2026-10-04' })).toBe('с 04.10.2026');
    expect(periodLabel({ period: 'custom', to: '2026-10-10' })).toBe('по 10.10.2026');
    expect(periodLabel({ period: 'custom' })).toBe('Выбрать даты');
  });
});
```

Run: `npx vitest run tests/client/journal.test.ts` → FAIL (`withPeriod`, `periodLabel` не экспортируются; порядок `PERIODS` другой).

- [ ] **Step 2: Implement in `lib/journal-filter.ts`**

1) Первую строку импорта

```ts
import { addDays, isValidDate } from '../../shared/dates';
```

замените на

```ts
import { addDays, formatDateRu, isValidDate } from '../../shared/dates';
```

2) Блок `PERIODS`

```ts
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
```

замените на

```ts
/**
 * Пункты меню периода (§5.1 этапа 1.5) в порядке Finmap; «За сегодня» и «За вчера» — наши, перед «Выбрать даты».
 * Относительные периоды считаются от «сегодня» в APP_TIMEZONE. Ключи — значения `period` в адресе.
 */
export const PERIODS = [
  { key: 'year', label: 'За текущий год' },
  { key: 'lastYear', label: 'За предыдущий год' },
  { key: 'week', label: 'За текущую неделю' },
  { key: 'lastWeek', label: 'За прошлую неделю' },
  { key: 'month', label: 'За текущий месяц' },
  { key: 'lastMonth', label: 'За прошлый месяц' },
  { key: 'all', label: 'За все время' },
  { key: 'today', label: 'За сегодня' },
  { key: 'yesterday', label: 'За вчера' },
  { key: 'custom', label: 'Выбрать даты' },
] as const;
```

3) В комментарии к `JournalUrlState` слова `from/to — только у периода «Произвольно».` замените на `from/to — только у периода «Выбрать даты» (custom).`

4) В `periodRange` перед `case 'custom':` вставьте

```ts
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
```

5) После функции `periodRange` вставьте:

```ts
/**
 * Фильтр с другим периодом (меню периода, §5.1 этапа 1.5). У обычного периода границ from/to нет. У «Выбрать даты»
 * границы из range: можно одну; перепутанные меняются местами — журнал не пустеет из-за порядка полей.
 */
export function withPeriod(state: JournalUrlState, period: PeriodKey, range: { from?: string; to?: string } = {}): JournalUrlState {
  const next: JournalUrlState = { ...state, period };
  delete next.from;
  delete next.to;
  if (period !== 'custom') return next;
  let { from, to } = range;
  if (from && to && from > to) [from, to] = [to, from];
  if (from) next.from = from;
  if (to) next.to = to;
  return next;
}

/** Подпись пилюли периода: пункт меню, у своих дат — «04.10.2026 – 10.10.2026», «с 04.10.2026», «по 10.10.2026». */
export function periodLabel(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>): string {
  if (state.period !== 'custom') return PERIODS.find((p) => p.key === state.period)?.label ?? '';
  if (state.from && state.to) return `${formatDateRu(state.from)} – ${formatDateRu(state.to)}`;
  if (state.from) return `с ${formatDateRu(state.from)}`;
  if (state.to) return `по ${formatDateRu(state.to)}`;
  return 'Выбрать даты';
}
```

Run: `npx vitest run tests/client/journal.test.ts tests/client/journal-panel.test.ts` → PASS.

- [ ] **Step 3: Create `PeriodMenu`**

`src/client/components/journal/PeriodMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { PERIODS, periodLabel, periodRange, withPeriod, type JournalUrlState } from '../../lib/journal-filter';
import { DateField } from '../DateField';
import { Popover } from '../Popover';
import { btnPrimary } from '../ui';

export const pillClass =
  'inline-flex max-w-full items-center gap-2 rounded-full bg-field px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/** «Выбрать даты»: поля «С» и «По» с календарём; начинаются с границ выбранного периода (как прежнее «Произвольно»). */
function PeriodDates(props: { state: JournalUrlState; today: string; onApply: (range: { from?: string; to?: string }) => void }) {
  const initial = periodRange(props.state, props.today);
  const [from, setFrom] = useState<string | null>(initial.from ?? null);
  const [to, setTo] = useState<string | null>(initial.to ?? null);
  const ref = useRef<HTMLDivElement>(null);
  // пункт «Выбрать даты» исчез вместе со списком — фокус на поле «С», а не на <body>
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Выбрать даты</p>
      <DateField label="С" value={from} today={props.today} onChange={setFrom} />
      <DateField label="По" value={to} today={props.today} onChange={setTo} />
      <button
        type="button"
        disabled={!from && !to}
        onClick={() => props.onApply({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}
        className={btnPrimary}
      >
        Применить
      </button>
    </div>
  );
}

function PeriodPanel(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void; close: (returnFocus?: boolean) => void }) {
  const { state } = props;
  const [choosing, setChoosing] = useState(false);
  if (choosing) {
    return (
      <PeriodDates
        state={state}
        today={props.today}
        onApply={(range) => {
          props.onChange(withPeriod(state, 'custom', range));
          props.close(true);
        }}
      />
    );
  }
  return (
    <ul className="flex flex-col">
      {PERIODS.map((p) => {
        const current = p.key === state.period;
        return (
          <li key={p.key}>
            <button
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => {
                if (p.key === 'custom') {
                  setChoosing(true);
                  return;
                }
                props.onChange(withPeriod(state, p.key));
                props.close(true);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-field focus-visible:outline-2 focus-visible:outline-focus ${current ? 'font-semibold' : ''}`}
            >
              {p.label}
              {current && (
                <span aria-hidden="true" className="text-income">
                  ✓
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Пилюля периода (§5.1 этапа 1.5): «За все время ▾» открывает меню; пункты — кнопки, у текущего ✓ и
 * aria-current. «Выбрать даты» переключает ту же панель на поля «С» и «По» с календарём и «Применить».
 * Имя кнопки — «Период: {подпись}». Ключи периода в адресе прежние.
 */
export function PeriodMenu(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void }) {
  const label = periodLabel(props.state);
  return (
    <Popover
      label={
        <>
          <span className="truncate">{label}</span>
          <span aria-hidden="true">▾</span>
        </>
      }
      ariaLabel={`Период: ${label}`}
      panelLabel="Период"
      buttonClassName={pillClass}
      panelClassName="w-72"
    >
      {(close) => <PeriodPanel state={props.state} today={props.today} onChange={props.onChange} close={close} />}
    </Popover>
  );
}
```

- [ ] **Step 4: Toolbar uses the menu**

Замените `src/client/components/journal/JournalToolbar.tsx` целиком (поля дат `DateInput` и `<select>` периода уходят; суммы и кнопки пока прежние — их переделает задача 3):

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { parseAmount } from '../../../shared/money';
import { clearFilter, isFiltered, journalApiParams, panelConditionCount, SEARCH_MAX, SORT_CHOICES, type JournalUrlState } from '../../lib/journal-filter';
import { amountInputText } from '../../lib/journal-format';
import { Drawer } from '../Drawer';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');

type OptionalKey = 'q' | 'amountMin' | 'amountMax';

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
            placeholder="Комментарий, контрагент, счёт, категория, проект"
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
 * Тулбар журнала (§5.1 этапа 1.5): пилюля периода, поиск, сумма от/до в базовой валюте, выгрузка в Excel по
 * текущему фильтру, сброс. actions — кнопки окна «Фильтр», сохранённых фильтров и колонок.
 * На телефоне (`mobile`) на виду только поиск и кнопка «Фильтры · N»: остальное, а также сортировка (у карточек
 * нет заголовков колонок) — в панели, выезжающей справа.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  actions?: ReactNode;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  const setAmount = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => onChange(v === undefined ? omit(state, key) : { ...state, [key]: v });
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [searchKey, setSearchKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  // окно стало шире телефона — панели нет, всё снова в тулбаре
  useEffect(() => {
    if (!props.mobile) setPanelOpen(false);
  }, [props.mobile]);

  const period = <PeriodMenu state={state} today={props.today} onChange={onChange} />;
  const search = <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />;
  const amounts = (
    <>
      <AmountInput key={`min-${searchKey}`} label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
      <AmountInput key={`max-${searchKey}`} label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
    </>
  );
  const buttons = (
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
  );

  if (props.mobile) {
    const count = panelConditionCount(state);
    return (
      <div className="mb-4 flex items-end gap-2">
        {search}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className={`${btnSmall} shrink-0 py-2.5`}
        >
          Фильтры{count > 0 && ` · ${count}`}
        </button>
        <Drawer open={panelOpen} title="Фильтры" side="right" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>{period}</div>
            <div className="flex flex-wrap gap-3">{amounts}</div>
            <Field label="Сортировка" className="w-48">
              {(c) => (
                <select
                  {...c}
                  value={`${state.sort}:${state.order}`}
                  onChange={(e) => {
                    const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                    if (choice) onChange({ ...state, sort: choice.sort, order: choice.order });
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
            {buttons}
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {period}
        {search}
        {amounts}
      </div>
      {buttons}
    </div>
  );
}
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 5: Update e2e — `journal.spec.ts`**

В тесте «тулбар: поиск с паузой, период, …» блок от строки

```ts
  // поиск, набранный прямо перед сменой периода, не затирает период (Review Focus 1)
```

до строки

```ts
  await page.getByLabel('Период').selectOption({ label: 'Всё время' });
  await expect(bodyRows(page)).toHaveCount(3);
```

включительно замените на:

```ts
  // период — меню у пилюли (§5.1 этапа 1.5): пункты Finmap «За …», наши «За сегодня» и «За вчера»
  const periodButton = page.getByRole('button', { name: /^Период:/ });
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  const choosePeriod = async (label: string) => {
    await periodButton.click();
    await periodMenu.getByRole('button', { name: label, exact: true }).click();
    await expect(periodMenu).toBeHidden();
    await expect(periodButton).toBeFocused();
  };
  await expect(periodButton).toHaveAccessibleName('Период: За все время');
  await periodButton.click();
  await expect(periodMenu.getByRole('button')).toHaveText([
    'За текущий год',
    'За предыдущий год',
    'За текущую неделю',
    'За прошлую неделю',
    'За текущий месяц',
    'За прошлый месяц',
    /^За все время/,
    'За сегодня',
    'За вчера',
    'Выбрать даты',
  ]);
  await expect(periodMenu.getByRole('button', { name: 'За все время', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(periodMenu.getByRole('button', { name: 'За текущий год', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(periodMenu).toBeHidden();
  await expect(periodButton).toBeFocused();

  // поиск, набранный прямо перед сменой периода, не затирает период (Review Focus 1 плана 5b)
  await page.getByLabel('Поиск').fill('аренда');
  await choosePeriod('За вчера');
  await expect(page).toHaveURL(/period=yesterday&q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(page).toHaveURL(/period=yesterday$/);

  // период — по календарной дате в APP_TIMEZONE
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Аренда за октябрь');
  await expect(bodyRows(page).first().locator('time')).toContainText('вчера');
  await expect(periodButton).toHaveAccessibleName('Период: За вчера');
  await choosePeriod('За сегодня');
  await expect(bodyRows(page)).toHaveCount(2);
  // «За предыдущий год» — новый пункт; операций за прошлый год нет
  await choosePeriod('За предыдущий год');
  await expect(page).toHaveURL(/period=lastYear$/);
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await choosePeriod('За сегодня');
  await expect(bodyRows(page)).toHaveCount(2);

  // «Выбрать даты» начинается с границ выбранного периода; день выбирается в календаре с клавиатуры
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const yesterday = yesterdayNoon().slice(0, 10);
  const ru = (d: string) => d.split('-').reverse().join('.');
  await periodButton.click();
  await periodMenu.getByRole('button', { name: 'Выбрать даты' }).click();
  const fromButton = periodMenu.getByRole('button', { name: /^С:/ });
  await expect(fromButton).toBeFocused();
  await expect(fromButton).toHaveAccessibleName(`С: ${ru(today)}`);
  await expect(periodMenu.getByRole('button', { name: /^По:/ })).toHaveAccessibleName(`По: ${ru(today)}`);
  await fromButton.click();
  const calendar = page.getByRole('dialog', { name: 'С: календарь' });
  await expect(calendar.getByRole('grid')).toBeVisible();
  const activeDay = calendar.locator('[role="gridcell"][tabindex="0"]');
  await expect(activeDay).toBeFocused();
  await expect(activeDay).toHaveAttribute('aria-selected', 'true');
  // Esc в календаре закрывает только его: меню периода остаётся, фокус — на поле «С» (Review Focus 6)
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(periodMenu).toBeVisible();
  await expect(fromButton).toBeFocused();
  // Tab с последнего элемента календаря (активный день) закрывает тоже только календарь: края Tab меню периода
  // считаются по его собственным элементам, без элементов вложенной панели
  await fromButton.click();
  await expect(activeDay).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(calendar).toBeHidden();
  await expect(periodMenu).toBeVisible();
  await expect(fromButton).toBeFocused();
  await fromButton.click();
  await expect(activeDay).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(fromButton).toHaveAccessibleName(`С: ${ru(yesterday)}`);
  await expect(fromButton).toBeFocused();
  await periodMenu.getByRole('button', { name: 'Применить' }).click();
  await expect(page).toHaveURL(new RegExp(`from=${yesterday}&to=${today}$`));
  await expect(periodButton).toHaveAccessibleName(`Период: ${ru(yesterday)} – ${ru(today)}`);
  await expect(bodyRows(page)).toHaveCount(3);
  await choosePeriod('За все время');
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(3);
```

- [ ] **Step 6: Update e2e — `journal-actions.spec.ts` and `mobile.spec.ts`**

`e2e/journal-actions.spec.ts`:

1) После объявления `const letters = …` вставьте помощник:

```ts
/** Период — пункт меню у пилюли (§5.1 этапа 1.5). */
async function choosePeriod(page: Page, label: string) {
  await page.getByRole('button', { name: /^Период:/ }).click();
  await page.getByRole('dialog', { name: 'Период', exact: true }).getByRole('button', { name: label, exact: true }).click();
}
```

2) `await page.getByLabel('Период').selectOption({ label: 'Сегодня' });` → `await choosePeriod(page, 'За сегодня');`

3) `await expect(page.getByLabel('Период')).toHaveValue('custom');` →

```ts
  await expect(page.getByRole('button', { name: /^Период:/ })).toHaveAccessibleName(/^Период: \d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/);
```

4) Обе строки `await page.getByLabel('Период').selectOption({ label: 'Вчера' });` → `await choosePeriod(page, 'За вчера');` и обе строки `await page.getByLabel('Период').selectOption({ label: 'Всё время' });` → `await choosePeriod(page, 'За все время');` (в тесте массовых действий две пары: «Review Focus 4» и «другой фильтр убирает и итог отмены удаления»).

`e2e/mobile.spec.ts`, тест «фильтры на телефоне — в панели справа…»:

1) `await expect(page.getByRole('combobox', { name: 'Период' })).toHaveCount(0);` → `await expect(page.getByRole('button', { name: /^Период:/ })).toHaveCount(0);`

2) Строки

```ts
  await panel.getByLabel('Период').selectOption('yesterday');
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('вчерашний');
  await panel.getByLabel('Период').selectOption('all');
  await expect(list).toHaveCount(3);
```

замените на

```ts
  // период — то же меню у пилюли, что в широком окне; меню рисуется внутри панели
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  await panel.getByRole('button', { name: /^Период:/ }).click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('вчерашний');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /^Период:/ }).click();
  await periodMenu.getByRole('button', { name: 'За все время', exact: true }).click();
  await expect(list).toHaveCount(3);
```

3) `await expect(page.getByRole('combobox', { name: 'Период' })).toBeVisible();` → `await expect(page.getByRole('button', { name: /^Период:/ })).toBeVisible();`

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 654 (650 + 4). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal.spec.ts e2e/journal-actions.spec.ts e2e/mobile.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 69 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/journal-filter.ts src/client/components/journal/PeriodMenu.tsx src/client/components/journal/JournalToolbar.tsx tests/client/journal.test.ts e2e
git commit -m "feat: меню периода как в Finmap — «За …», «За предыдущий год», «Выбрать даты» с календарём

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Тулбар в одну строку — поиск с кнопкой, «Фильтр · N | ▾», «Ещё ▾» с суммой, ⟳, колонками и выгрузкой

**Files:**
- Create: `src/client/components/journal/AmountRange.tsx`, `src/client/components/journal/MoreMenu.tsx`, `src/client/components/journal/ColumnsPanel.tsx`, `src/client/components/journal/FilterButton.tsx`, `tests/client/journal-refresh.test.ts`
- Delete: `src/client/components/journal/ColumnsPicker.tsx`
- Modify: `src/client/lib/journal-mutations.ts`, `src/client/components/icons.tsx`, `src/client/components/journal/SavedFiltersMenu.tsx`, `src/client/components/journal/JournalToolbar.tsx` (целиком), `src/client/pages/JournalPage.tsx`, `e2e/journal.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `PeriodMenu` (задача 2); `invalidateOperations(companyId: number): Promise<void>` и `queryClient` (`lib/journal-mutations.ts`, `lib/query.ts`); `focusHeadingSoon(target?: string)`, `isPlainLeftClick(e)`, `pathOf(to: string)` (`lib/focus-heading.ts`); `usePreferences()` (`lib/queries.ts`); `JOURNAL_COLUMNS`, `JOURNAL_COLUMNS_PREF`, `toggleColumn`, `visibleColumns` (`lib/journal-columns.ts`).
- Produces:
  - `AmountRange(props: { state: JournalUrlState; onChange: (next: JournalUrlState) => void; minorUnits: number })` — поля с именами «Сумма от» и «Сумма до»;
  - `ColumnsPanel()` — флажки колонок (сама читает настройки); экспортирует хук `useInstantPref<T>(key: string, saved: T, failText: string): { value: T; set: (value: T) => void; error: string | null }`;
  - `MoreMenu(props: { companyId: number; state: JournalUrlState; onChange: (next: JournalUrlState) => void; currencySymbol: string; minorUnits: number; exportHref: string; onRefresh: () => Promise<void> })` — кнопка «Ещё», панель «Ещё»;
  - `refreshOperations(companyId: number): Promise<void>` — ⟳; отклоняется, если журнал перечитать не удалось (`lib/journal-mutations.ts`);
  - `FilterButton(props: { count: number; onOpen: () => void; canSave: boolean; companyId: number; filters: SavedFilter[] | undefined; onApply: (f: SavedFilter) => void })`;
  - `SavedFiltersMenu(props: { companyId; filters; onApply; onCreate?: () => void; buttonClassName?: string })` — кнопка «Быстрые фильтры»; без `onCreate` (архивная компания) пустое меню без «Создать новый фильтр»;
  - `JournalToolbar(props: { state; onChange; companyId; baseCurrency; today; filter: ReactNode; onRefresh: () => Promise<void>; mobile?: boolean })`;
  - иконки `SearchIcon`, `FunnelIcon`, `RefreshIcon({ spinning?: boolean })`, `ColumnsIcon`, `DownloadIcon`.

- [ ] **Step 1: Icons**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
export function SearchIcon() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  );
}

export function FunnelIcon() {
  return (
    <Svg>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Svg>
  );
}

export function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <Svg className={spinning ? 'animate-spin motion-reduce:animate-none' : undefined}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Svg>
  );
}

export function ColumnsIcon() {
  return (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </Svg>
  );
}

export function DownloadIcon() {
  return (
    <Svg>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  );
}
```

- [ ] **Step 1a: ⟳ reports a failed refetch — `refreshOperations` (test first)**

`tests/client/journal-refresh.test.ts`:

```ts
import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

describe('⟳ «Обновить» (§2.5 этапа 1.5)', () => {
  afterEach(async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    queryClient.clear();
  });

  it('перечитывает активный журнал; удачно — без ошибки', async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    const { refreshOperations } = await import('../../src/client/lib/journal-mutations');
    let calls = 0;
    const observer = new QueryObserver(queryClient, { queryKey: ['journal', 991, 'q'], queryFn: async () => ++calls, retry: false });
    const stop = observer.subscribe(() => undefined);
    await expect.poll(() => calls).toBe(1);
    await expect(refreshOperations(991)).resolves.toBeUndefined();
    expect(calls).toBe(2);
    stop();
  });

  it('сбой перечитывания журнала не проглатывается — «Ещё» скажет «Не удалось обновить журнал»', async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    const { refreshOperations } = await import('../../src/client/lib/journal-mutations');
    let fail = false;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['journal', 992, 'q'],
      queryFn: async () => {
        if (fail) throw new Error('сбой сети');
        return 1;
      },
      retry: false,
    });
    const stop = observer.subscribe(() => undefined);
    await expect.poll(() => observer.getCurrentResult().status).toBe('success');
    fail = true;
    await expect(refreshOperations(992)).rejects.toThrow('сбой сети');
    stop();
  });
});
```

Run: `npx vitest run tests/client/journal-refresh.test.ts` → FAIL (`refreshOperations` не экспортируется).

В `src/client/lib/journal-mutations.ts` после функции `invalidateOperations` вставьте:

```ts
/**
 * ⟳ «Обновить» (§2.5 этапа 1.5): то же, что после записи, но сбой перечитывания журнала не проглатывается
 * (`throwOnError`; без него invalidateQueries всегда завершается успешно) — панель «Ещё» скажет
 * «Не удалось обновить журнал». Загруженные страницы журнала перечитываются на месте.
 */
export async function refreshOperations(companyId: number): Promise<void> {
  const [journal] = await Promise.allSettled([
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }, { throwOnError: true }),
    queryClient.invalidateQueries({ queryKey: ['accounts', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);
  if (journal.status === 'rejected') throw journal.reason;
}
```

Run: `npx vitest run tests/client/journal-refresh.test.ts` → PASS.

- [ ] **Step 2: `AmountRange`**

`src/client/components/journal/AmountRange.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { parseAmount } from '../../../shared/money';
import type { JournalUrlState } from '../../lib/journal-filter';
import { amountInputText } from '../../lib/journal-format';
import { inputClass } from '../ui';

const amountInput = `${inputClass.replace('py-3', 'py-2').replace('px-4', 'px-3')} text-sm`;

function AmountInput(props: { label: string; placeholder: string; value: number | undefined; minorUnits: number; onCommit: (v: number | undefined) => void }) {
  const shown = props.value === undefined ? '' : amountInputText(props.value, props.minorUnits);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  const errorId = useId();

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
  // панель «Ещё» закрыли щелчком мимо: поле исчезает раньше, чем браузер пришлёт blur, — набранное применяется здесь.
  // Только пока путь страницы тот же, что при появлении поля: после перехода (ссылка «Настройки журнала», «Назад»
  // браузера, смена компании) правка фильтра увела бы уже другую страницу обратно в журнал
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const pathAtMount = useRef(window.location.pathname);
  useEffect(
    () => () => {
      if (window.location.pathname === pathAtMount.current) commitRef.current();
    },
    [],
  );

  return (
    <div className="w-28">
      <input
        aria-label={props.label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode="decimal"
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={amountInput}
      />
      {error && (
        <span id={errorId} className="mt-1 block text-xs text-expense">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * «Сумма от / до» (§5.1 этапа 1.5) в минимальных единицах базовой валюты. Применяется по Enter, уходу из поля
 * и при закрытии панели, в которой стоят поля (Review Focus 3). Видимой подписи у полей нет — только «От» и «По»
 * в самих полях; доступные имена «Сумма от» и «Сумма до».
 */
export function AmountRange(props: { state: JournalUrlState; onChange: (next: JournalUrlState) => void; minorUnits: number }) {
  const set = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => {
    const next = { ...props.state };
    if (v === undefined) delete next[key];
    else next[key] = v;
    props.onChange(next);
  };
  return (
    <div className="flex items-start gap-2">
      <AmountInput label="Сумма от" placeholder="От" value={props.state.amountMin} minorUnits={props.minorUnits} onCommit={set('amountMin')} />
      <AmountInput label="Сумма до" placeholder="По" value={props.state.amountMax} minorUnits={props.minorUnits} onCommit={set('amountMax')} />
    </div>
  );
}
```

- [ ] **Step 3: `ColumnsPanel` instead of `ColumnsPicker`**

Run: `git rm src/client/components/journal/ColumnsPicker.tsx`

`src/client/components/journal/ColumnsPanel.tsx`:

```tsx
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { queryClient } from '../../lib/query';
import { usePreferences } from '../../lib/queries';

/**
 * Настройка пользователя, которая применяется сразу (§5.1 этапа 1.5): выбор виден в тот же миг — и в журнале,
 * через кэш настроек, — а сохраняется в фоне. Учитывается только ответ на последний выбор (быстрые щелчки подряд
 * не путаются): после успеха значение берётся из кэша, после сбоя настройки перечитываются с сервера
 * и показывается ошибка.
 */
export function useInstantPref<T>(key: string, saved: T, failText: string) {
  // флажок отражает выбор сразу: кэш TanStack Query оповещает подписчиков не синхронно
  const [override, setOverride] = useState<{ value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const set = (value: T) => {
    const mine = ++seq.current;
    setOverride({ value });
    setError(null);
    const toCache = () => queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [key]: value }));
    toCache();
    api(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } })
      .then(() => {
        if (mine !== seq.current) return;
        toCache();
        setOverride(null);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOverride(null);
        setError(failText);
        void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      });
  };
  return { value: override ? override.value : saved, set, error };
}

/** Колонки журнала в панели «Ещё» (§5.1, §5.3 этапа 1.5): флажки применяются сразу. Дата и сумма видны всегда. */
export function ColumnsPanel() {
  const prefs = usePreferences();
  const columns = useInstantPref<JournalColumnId[]>(JOURNAL_COLUMNS_PREF, visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]), 'Не удалось сохранить выбор колонок');
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Колонки</legend>
      <div className="grid grid-cols-2 gap-x-4">
        {JOURNAL_COLUMNS.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={c.fixed || columns.value.includes(c.id)}
              disabled={c.fixed}
              onChange={() => columns.set(toggleColumn(columns.value, c.id))}
              className="size-4 accent-income"
            />
            {c.label}
          </label>
        ))}
      </div>
      {columns.error && (
        <p role="alert" className="mt-2 text-xs text-expense">
          {columns.error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: `MoreMenu`**

`src/client/components/journal/MoreMenu.tsx`:

```tsx
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import type { JournalUrlState } from '../../lib/journal-filter';
import { ColumnsIcon, DownloadIcon, RefreshIcon } from '../icons';
import { Popover } from '../Popover';
import { AmountRange } from './AmountRange';
import { ColumnsPanel } from './ColumnsPanel';

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-wait aria-disabled:opacity-60';

interface MoreProps {
  companyId: number;
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  currencySymbol: string;
  minorUnits: number;
  exportHref: string;
  /** ⟳: журнал, счета с балансами и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
}

function MorePanel(props: MoreProps) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const columnsId = useId();
  const settings = `/c/${props.companyId}/settings/journal`;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setStatus('');
    try {
      await props.onRefresh();
      setStatus('Журнал обновлён');
    } catch {
      setStatus('Не удалось обновить журнал');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        <span className="py-2 text-sm font-semibold">Сумма, {props.currencySymbol}</span>
        <AmountRange state={props.state} onChange={props.onChange} minorUnits={props.minorUnits} />
        <button type="button" aria-label="Обновить" title="Обновить" aria-disabled={refreshing || undefined} onClick={() => void refresh()} className={iconButton}>
          <RefreshIcon spinning={refreshing} />
        </button>
        <button
          type="button"
          aria-label="Колонки"
          title="Колонки"
          aria-expanded={columnsOpen}
          aria-controls={columnsOpen ? columnsId : undefined}
          onClick={() => setColumnsOpen((v) => !v)}
          className={iconButton}
        >
          <ColumnsIcon />
        </button>
        <a href={props.exportHref} download aria-label="Выгрузить в Excel" title="Выгрузить в Excel" className={iconButton}>
          <DownloadIcon />
        </a>
      </div>
      <p role="status" className={status ? 'mt-2 text-xs text-muted' : 'sr-only'}>
        {status}
      </p>
      {columnsOpen && (
        <div id={columnsId} className="mt-3 border-t border-field pt-3">
          <ColumnsPanel />
          <Link
            to={settings}
            onClick={(e) => {
              if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(settings));
            }}
            className="mt-3 inline-block text-sm font-semibold text-ink underline"
          >
            Настройки журнала
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * «Ещё ▾» (§5.1 этапа 1.5): в одну строку — «Сумма» От/По в базовой валюте, ⟳ «Обновить», ▥ «Колонки»,
 * ⤓ «Выгрузить в Excel» (по текущему фильтру). ▥ раскрывает ниже в той же панели список колонок и ссылку
 * «Настройки журнала» — вложенного окна нет. Итог ⟳ — в живой области панели.
 */
export function MoreMenu(props: MoreProps) {
  return (
    <Popover
      label={
        <>
          Ещё <span aria-hidden="true">▾</span>
        </>
      }
      ariaLabel="Ещё"
      align="right"
      panelClassName="w-[30rem] max-w-[calc(100vw-1rem)]"
    >
      {() => <MorePanel {...props} />}
    </Popover>
  );
}
```

- [ ] **Step 5: «Быстрые фильтры» and the combined filter button**

В `src/client/components/journal/SavedFiltersMenu.tsx` экспортируемую функцию целиком — от строки

```tsx
/** Меню «Сохранённые фильтры»: применить, переименовать, удалить. Сохраняют фильтр в модалке «Фильтр». */
```

до конца файла — замените на:

```tsx
/**
 * «Быстрые фильтры» (§5.1 этапа 1.5) — стрелка составной кнопки «Фильтр | ▾»: применить, переименовать, удалить
 * сохранённый фильтр. Сохраняют фильтр в окне фильтра; пустое меню ведёт туда кнопкой «Создать новый фильтр»
 * (меню закрывается, фокус — на стрелке, после окна он вернётся сюда же).
 */
export function SavedFiltersMenu(props: {
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
  /** Не передан (архивная компания: сохранять нечего) — пустое меню без «Создать новый фильтр» и подсказки. */
  onCreate?: () => void;
  buttonClassName?: string;
}) {
  return (
    <Popover label={<span aria-hidden="true">▾</span>} ariaLabel="Быстрые фильтры" buttonClassName={props.buttonClassName} panelClassName="w-80">
      {(close) => (
        <div>
          <p className="mb-2 text-sm font-semibold">Быстрые фильтры</p>
          {props.filters === undefined ? (
            <p className="text-sm text-muted">Загрузка…</p>
          ) : props.filters.length === 0 ? (
            props.onCreate ? (
              <div className="text-sm">
                <p className="mb-2 text-muted">Сохранённых фильтров пока нет. Задайте условия в окне фильтра и нажмите «Сохранить фильтр».</p>
                <button
                  type="button"
                  onClick={() => {
                    close(true);
                    props.onCreate?.();
                  }}
                  className="font-semibold text-ink underline"
                >
                  Создать новый фильтр
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">Сохранённых фильтров нет.</p>
            )
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

`src/client/components/journal/FilterButton.tsx`:

```tsx
import type { SavedFilter } from '../../lib/queries';
import { FunnelIcon } from '../icons';
import { SavedFiltersMenu } from './SavedFiltersMenu';

const partClass = 'inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Составная кнопка «Фильтр · N | ▾» (§5.1 этапа 1.5): левая часть открывает окно фильтра (N — число условий окна),
 * стрелка — «Быстрые фильтры» (сохранённые). canSave = false (архивная компания) — без «Создать новый фильтр».
 */
export function FilterButton(props: {
  count: number;
  onOpen: () => void;
  canSave: boolean;
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-field">
      <button type="button" aria-haspopup="dialog" onClick={props.onOpen} className={`${partClass} rounded-l-lg px-3`}>
        <FunnelIcon />
        Фильтр{props.count > 0 && ` · ${props.count}`}
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-muted/40" />
      <SavedFiltersMenu
        companyId={props.companyId}
        filters={props.filters}
        onApply={props.onApply}
        onCreate={props.canSave ? props.onOpen : undefined}
        buttonClassName={`${partClass} rounded-r-lg px-2.5`}
      />
    </div>
  );
}
```

- [ ] **Step 6: Toolbar in one row**

Замените `src/client/components/journal/JournalToolbar.tsx` целиком:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalApiParams, panelConditionCount, SEARCH_MAX, SORT_CHOICES, type JournalUrlState } from '../../lib/journal-filter';
import { Drawer } from '../Drawer';
import { Field } from '../Field';
import { SearchIcon } from '../icons';
import { btnSmall, inputClass } from '../ui';
import { AmountRange } from './AmountRange';
import { MoreMenu } from './MoreMenu';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');
const searchInput = compactInput.replace('px-4', 'pl-10 pr-4');
const squareButton = 'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Поиск (§5.1 этапа 1.5): лупа внутри поля, справа кнопка-лупа «Найти» (применяет сразу); живой поиск через
 * паузу и по Enter остаётся. Подписи над полем нет — доступное имя «Поиск».
 */
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
      className="flex min-w-48 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
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
          placeholder="Поиск по счетам, контрагентам, комментариям"
          onChange={(e) => setText(e.target.value)}
          className={searchInput}
        />
      </div>
      <button type="submit" aria-label="Найти" title="Найти" className={squareButton}>
        <SearchIcon />
      </button>
    </form>
  );
}

/**
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, и «Ещё ▾» (сумма, ⟳, колонки, выгрузка).
 * На телефоне (`mobile`, до плана 1.5-5) на виду только поиск и кнопка «Фильтры · N»: период, сумма, сортировка
 * (у карточек нет заголовков колонок), «Фильтр | ▾», выгрузка и сброс — в панели, выезжающей справа.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  /** «Фильтр · N | ▾». */
  filter: ReactNode;
  /** ⟳ в «Ещё»: журнал, балансы и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [resetKey, setResetKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  // окно стало шире телефона — панели нет, всё снова в тулбаре
  useEffect(() => {
    if (!props.mobile) setPanelOpen(false);
  }, [props.mobile]);

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
  const period = <PeriodMenu state={state} today={props.today} onChange={onChange} />;
  const search = <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} />;

  if (props.mobile) {
    const count = panelConditionCount(state);
    return (
      <div className="mb-4 flex items-center gap-2">
        {search}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className={`${btnSmall} shrink-0 py-2.5`}
        >
          Фильтры{count > 0 && ` · ${count}`}
        </button>
        <Drawer open={panelOpen} title="Фильтры" side="right" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-4">
            <div>{period}</div>
            <div>
              <p className="mb-1 text-sm text-muted">Сумма, {currency.symbol}</p>
              <AmountRange key={resetKey} state={state} onChange={onChange} minorUnits={currency.minorUnits} />
            </div>
            <Field label="Сортировка" className="w-48">
              {(c) => (
                <select
                  {...c}
                  value={`${state.sort}:${state.order}`}
                  onChange={(e) => {
                    const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                    if (choice) onChange({ ...state, sort: choice.sort, order: choice.order });
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
            <div className="flex flex-wrap items-center gap-2">
              {props.filter}
              <a href={exportHref} download className={btnSmall}>
                Выгрузить в Excel
              </a>
              {isFiltered(state) && (
                <button type="button" onClick={reset} className={btnSmall}>
                  Сбросить фильтр
                </button>
              )}
            </div>
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {period}
      {search}
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
        exportHref={exportHref}
        onRefresh={props.onRefresh}
      />
    </div>
  );
}
```

- [ ] **Step 7: Journal page wires the toolbar and ⟳**

В `src/client/pages/JournalPage.tsx`:

1) Импорты

```tsx
import { BulkBar } from '../components/journal/BulkBar';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { JournalCards } from '../components/journal/JournalCards';
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
```

замените на

```tsx
import { BulkBar } from '../components/journal/BulkBar';
import { FilterButton } from '../components/journal/FilterButton';
import { JournalCards } from '../components/journal/JournalCards';
import { FilterDialog } from '../components/journal/FilterDialog';
import { unavailableText } from '../components/journal/SavedFiltersMenu';
```

`import { btnSecondary, btnSmall, noticeClass } from '../components/ui';` → `import { btnSecondary, noticeClass } from '../components/ui';`

`import { operationErrorText, runBulk, useAssign } from '../lib/journal-mutations';` → `import { operationErrorText, refreshOperations, runBulk, useAssign } from '../lib/journal-mutations';`

2) Блок тулбара

```tsx
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        mobile={mobile}
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
            {/* у карточек на телефоне колонок нет */}
            {!mobile && <ColumnsPicker visible={columns} />}
          </>
        }
      />
```

замените на

```tsx
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        mobile={mobile}
        filter={
          <FilterButton
            count={conditions}
            onOpen={() => setFilterOpen(true)}
            canSave={!readOnly}
            companyId={company.id}
            filters={savedFilters.data}
            onApply={(f) => {
              update(stateFromSavedFilter(f.filter, state));
              setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
            }}
          />
        }
        // ⟳ (§2.5): загруженные страницы перечитываются на месте — таблица не размонтируется, прокрутка остаётся;
        // сбой перечитывания журнала «Ещё» показывает
        onRefresh={() => refreshOperations(company.id)}
      />
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 8: Update e2e — `journal.spec.ts`**

1) В тесте «тулбар: …» после строк

```ts
  await expect(page.getByLabel('Поиск')).toHaveValue('ЕЛКА');
  await expect(bodyRows(page)).toHaveCount(1);
```

вставьте:

```ts
  // лупа справа от поля применяет запрос сразу
  await page.getByLabel('Поиск').fill('ёлка в');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page).toHaveURL(/q=%D1%91%D0%BB%D0%BA%D0%B0\+%D0%B2$/);
  await expect(bodyRows(page)).toHaveCount(1);
```

2) В том же тесте блок от строки `// сумма от/до — в базовой валюте компании (по сумме в тенге)` до строки `await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);` (первое её вхождение, перед блоком «адрес, исправленный руками») включительно замените на:

```ts
  // сумма от/до — в меню «Ещё», в базовой валюте компании (по сумме в тенге)
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const moreMenu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(moreMenu.getByLabel('Сумма от')).toBeFocused();
  await moreMenu.getByLabel('Сумма от').fill('1 000');
  await moreMenu.getByLabel('Сумма от').press('Enter');
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(moreMenu.getByLabel('Сумма от')).toHaveValue('1000');
  await moreMenu.getByLabel('Сумма до').fill('1200,5');
  await moreMenu.getByLabel('Сумма до').blur();
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/min=100000&max=120050$/);
  await moreMenu.getByLabel('Сумма до').fill('abc');
  await moreMenu.getByLabel('Сумма до').blur();
  await expect(moreMenu.getByLabel('Сумма до')).toHaveAttribute('aria-invalid', 'true');
  await expect(moreMenu.getByLabel('Сумма до')).toHaveAccessibleDescription('Введите сумму');
  await expect(bodyRows(page)).toHaveCount(1);

  // выгрузка — по текущему фильтру; ссылка отдаёт книгу Excel
  const href = await moreMenu.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href');
  expect(href).toContain(`/api/v1/companies/${cid}/operations/export.xlsx?`);
  expect(href).toContain('amountMin=100000&amountMax=120050');
  const xlsx = await page.request.get(href!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  // набранная без Enter сумма применяется и тогда, когда меню закрыли щелчком мимо (Review Focus 3)
  await moreMenu.getByLabel('Сумма до').fill('2000');
  await panel(page).getByText('Всего на счетах').click();
  await expect(moreMenu).toBeHidden();
  await expect(page).toHaveURL(/min=100000&max=200000$/);
  await expect(bodyRows(page)).toHaveCount(2);

  // «Сбросить фильтр» — ✕ рядом с «Фильтр»
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);
  await more.click();
  await expect(moreMenu.getByLabel('Сумма от')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
```

3) Тест «колонки: выбор сохраняется в настройках пользователя…» замените целиком:

```ts
test('«Ещё»: суммы, ⟳, колонки и выгрузка в одной панели; Tab и Esc как у всех панелей; выбор колонок сохраняется в настройках пользователя', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Колонки ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'Видимый комментарий' });
  await page.reload();
  const header = (name: string) => table(page).getByRole('columnheader', { name, exact: true });
  await expect(header('Комментарий')).toBeVisible();
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  const before = (await (await page.request.get('/api/v1/preferences')).json()).preferences as Record<string, unknown>;

  // настройка общая для пользователя admin и остальных e2e: в конце — прежнее значение
  try {
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // фокус — на первом поле панели
    const amountFrom = menu.getByLabel('Сумма от');
    await expect(amountFrom).toBeFocused();
    // панель — в портале, но порядок Tab не рвётся: Shift+Tab с первого поля ведёт на кнопку, Tab с кнопки — обратно в панель
    await page.keyboard.press('Shift+Tab');
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(amountFrom).toBeFocused();
    // Esc с кнопки (фокус вернулся на неё Shift+Tab) тоже закрывает панель, фокус остаётся на кнопке
    await page.keyboard.press('Shift+Tab');
    await expect(more).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // ▥ «Колонки» раскрывает список в той же панели; дату и сумму не скрыть
    await more.click();
    const columns = menu.getByRole('button', { name: 'Колонки', exact: true });
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('checkbox', { name: 'Дата', exact: true })).toBeDisabled();
    await expect(menu.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeDisabled();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await saved;
    await expect(header('Комментарий')).toHaveCount(0);
    await expect(table(page)).not.toContainText('Видимый комментарий');
    // Esc закрывает панель и возвращает фокус на кнопку
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // Tab за последним элементом панели (ссылка «Настройки журнала») закрывает её и возвращает фокус на кнопку
    await more.click();
    await columns.click();
    await menu.getByRole('link', { name: 'Настройки журнала' }).focus();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // фокус, ушедший за пределы кнопки и панели, закрывает панель
    await more.click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { name: 'Журнал' }).focus();
    await expect(menu).toBeHidden();

    // «Настройки журнала» — страница настроек, фокус на её заголовке; выбор колонок уже там
    await more.click();
    await columns.click();
    await menu.getByRole('link', { name: 'Настройки журнала' }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/journal$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки журнала' })).toBeFocused();
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();

    await page.goto(`/c/${cid}/log`);
    await expect(header('Счёт')).toBeVisible();
    await expect(header('Комментарий')).toHaveCount(0);
  } finally {
    await page.request.put('/api/v1/preferences/journal.columns', { data: { value: before['journal.columns'] ?? null }, headers: csrf(page) });
  }
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
});
```

4) После теста «клик по счёту в левой панели фильтрует журнал; …» вставьте новый тест:

```ts
test('«Ещё» → ⟳ «Обновить»: операция с другого компьютера появляется, загруженные страницы и прокрутка сохраняются, балансы обновляются (§2.5)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Обновить ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(200 - i), accountId: kaspi, amount: 100, comment: `строка ${i}` });
  }
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(bodyRows(page)).toHaveCount(55);
  const kaspiLink = panel(page).getByRole('link', { name: /^Kaspi/ });
  await expect(kaspiLink).toContainText(/₸\s55$/);

  // операцию внесли «с другого компьютера»: журнал сам не перезапрашивается
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 4500, comment: 'с другого компьютера' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(55);
  // страницу прокрутили вниз при открытом меню; ⟳ нажимаем без прокрутки к нему (dispatchEvent не прокручивает)
  await page.evaluate(() => window.scrollTo(0, 900));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(0);
  await menu.getByRole('button', { name: 'Обновить' }).dispatchEvent('click');
  await expect(menu.getByRole('status')).toHaveText('Журнал обновлён');
  // обе загруженные страницы перечитаны: 55 + 1, новая — сверху (Review Focus 4)
  await expect(bodyRows(page)).toHaveCount(56);
  await expect(bodyRows(page).first()).toContainText('с другого компьютера');
  // прокрутка не сброшена к началу; браузер может сдвинуть её на строку, чтобы видимое не уехало (scroll anchoring)
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(100);
  await expect(kaspiLink).toContainText(/₸\s100$/);
});
```

- [ ] **Step 9: Update e2e — `journal-actions.spec.ts` and `mobile.spec.ts`**

`e2e/journal-actions.spec.ts`:

1) В тесте «сохранённые фильтры: сохранить из окна «Фильтр», …» строки

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  const menuButton = page.getByRole('button', { name: 'Сохранённые фильтры' });
```

замените на

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  const menuButton = page.getByRole('button', { name: 'Быстрые фильтры' });

  // пустое меню «Быстрые фильтры»: пояснение и «Создать новый фильтр» — открывает окно фильтра, после окна фокус на ▾
  await menuButton.click();
  const quick = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(quick).toContainText('Сохранённых фильтров пока нет');
  await quick.getByRole('button', { name: 'Создать новый фильтр' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
```

2) В тесте «архивная компания: журнал только для чтения…» после строки `  await expect(page.getByRole('checkbox')).toHaveCount(0);` вставьте:

```ts
  // «Быстрые фильтры» архивной компании: сохранять нечего — ни «Создать новый фильтр», ни подсказки про «Сохранить фильтр»
  await page.getByRole('button', { name: 'Быстрые фильтры' }).click();
  const quick = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(quick).toContainText('Сохранённых фильтров нет.');
  await expect(quick.getByRole('button', { name: 'Создать новый фильтр' })).toHaveCount(0);
  await expect(quick).not.toContainText('Сохранить фильтр');
  await page.keyboard.press('Escape');
```

3) В тесте «сохранённые фильтры: повреждённый не применяется…» строки

```ts
  await page.reload();
  const menuButton = page.getByRole('button', { name: 'Сохранённые фильтры' });
```

замените на

```ts
  await page.reload();
  const menuButton = page.getByRole('button', { name: 'Быстрые фильтры' });
```

`e2e/mobile.spec.ts`, тест «фильтры на телефоне — в панели справа…»:

1) Строки

```ts
  await panel.getByLabel('Сумма от, ₸').fill('200');
  await panel.getByLabel('Сумма от, ₸').press('Enter');
```

замените на

```ts
  await panel.getByLabel('Сумма от').fill('200');
  await panel.getByLabel('Сумма от').press('Enter');
```

2) Строки

```ts
  await panel.getByRole('button', { name: 'Сохранённые фильтры' }).click();
  const saved = page.getByRole('dialog', { name: 'Сохранённые фильтры' });
```

замените на

```ts
  await panel.getByRole('button', { name: 'Быстрые фильтры' }).click();
  const saved = page.getByRole('dialog', { name: 'Быстрые фильтры' });
```

- [ ] **Step 10: Run all checks; e2e twice**

Run: `npm test` → PASS, 656 (654 + 2). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal.spec.ts e2e/journal-actions.spec.ts e2e/mobile.spec.ts e2e/dialogs.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 11: Commit**

```bash
git add src/client/lib/journal-mutations.ts src/client/components/icons.tsx src/client/components/journal src/client/pages/JournalPage.tsx tests/client/journal-refresh.test.ts e2e
git commit -m "feat: тулбар журнала в одну строку — поиск с кнопкой, «Фильтр | ▾» и «Быстрые фильтры», «Ещё» с суммой, ⟳, колонками и выгрузкой

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Таблица — дата в две строки, строки одной высоты, «Счёт/остаток», «Дата сделки», «системная», плашка «Указать»

**Files:**
- Modify: `src/shared/dates.ts`, `src/client/styles.css`, `src/client/lib/journal-format.ts`, `src/client/lib/journal-columns.ts`, `src/client/lib/journal-card.ts`, `src/client/lib/preferences.ts`, `src/client/components/journal/JournalTable.tsx` (целиком), `src/client/components/journal/AssignPicker.tsx`, `src/client/pages/JournalPage.tsx`
- Test: `tests/shared/dates.test.ts`, `tests/client/journal.test.ts`, `tests/client/journal-card.test.ts`, `tests/client/preferences.test.ts`, `e2e/journal.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Consumes: `dayOf`, `timeLabel` (`lib/journal-format.ts`); `CategoryTree`, `CategoryNode` (`lib/queries.ts`).
- Produces:
  - `formatDateShortRu(value: string): string` — «4 окт. 2026» (`shared/dates.ts`);
  - `journalDateParts(iso: string, timeZone: string, today: string): { date: string; time: string }`; `interface CategoryInfo { name: string; systemKey: string | null }`; `categoryLookup(tree: CategoryTree): Map<number, CategoryInfo>` (`lib/journal-format.ts`);
  - `JOURNAL_COLUMNS` с `accrualDate` третьей и подписью «Счёт/остаток»; `JournalColumnId` включает `'accrualDate'`; `visibleColumns(undefined)` — без `accrualDate`;
  - `JOURNAL_WRAP_PREF = 'journal.wrap'`, `journalWrap(prefs: Record<string, unknown> | undefined): boolean` (`lib/preferences.ts`);
  - `JournalLookups.categories: Map<number, CategoryInfo>`; `JournalTableProps.wrap: boolean`; у `<td>` атрибут `data-column`; у кнопки открытия строки — `data-row-open`; у флажка «Выбрать все» — `data-select-all`;
  - токен цвета `income-strong` (`bg-income-strong`, `text-income-strong`).

- [ ] **Step 1: Write the failing unit tests**

`tests/shared/dates.test.ts`: в импорт из `../../src/shared/dates` добавьте `formatDateShortRu` и в конец файла:

```ts
describe('formatDateShortRu', () => {
  it('«4 окт. 2026»: число без нуля, сокращения месяцев как в Finmap, без «г.» (§2.3 этапа 1.5)', () => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    expect(months.map((m) => formatDateShortRu(`2026-${m}-04`))).toEqual([
      '4 янв. 2026',
      '4 февр. 2026',
      '4 мар. 2026',
      '4 апр. 2026',
      '4 мая 2026',
      '4 июн. 2026',
      '4 июл. 2026',
      '4 авг. 2026',
      '4 сент. 2026',
      '4 окт. 2026',
      '4 нояб. 2026',
      '4 дек. 2026',
    ]);
    expect(formatDateShortRu('2026-10-31')).toBe('31 окт. 2026');
  });
});
```

`tests/client/journal.test.ts`:

1) Первую строку импорта `import { toggleColumn, visibleColumns } from '../../src/client/lib/journal-columns';` замените на `import { JOURNAL_COLUMNS, toggleColumn, visibleColumns } from '../../src/client/lib/journal-columns';`; в импорт из `journal-format` добавьте `categoryLookup` и `journalDateParts`; после импортов добавьте `import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';`.

2) В `describe('форматирование строк журнала', …)` после первого `it(…)` вставьте:

```ts
  it('дата в журнале в две строки: «4 окт. 2026» и время; сегодня и вчера — с префиксом; граница суток по Алматы (§5.2 этапа 1.5)', () => {
    const tz = 'Asia/Almaty';
    // 05:30 UTC = 10:30 по Алматы
    expect(journalDateParts('2026-10-07T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '7 окт. 2026', time: 'Сегодня 10:30' });
    expect(journalDateParts('2026-10-06T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '6 окт. 2026', time: 'Вчера 10:30' });
    expect(journalDateParts('2026-10-04T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '4 окт. 2026', time: '10:30' });
    // 23:30 6 октября по Алматы — ещё вчера; 00:30 7 октября — уже сегодня
    expect(journalDateParts('2026-10-06T18:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '6 окт. 2026', time: 'Вчера 23:30' });
    expect(journalDateParts('2026-10-06T19:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '7 окт. 2026', time: 'Сегодня 00:30' });
  });

  it('справочник категорий журнала: «Родитель → Дочерняя» и собственный systemKey — бейдж только у самой системной (§5.2, §10.3)', () => {
    const node = (id: number, name: string, systemKey: string | null, children: CategoryNode[] = []): CategoryNode => ({
      id,
      companyId: 1,
      kind: 'expense',
      parentId: null,
      name,
      systemKey,
      effectiveSystemKey: systemKey,
      templateRef: null,
      orderIndex: 0,
      archivedAt: null,
      children,
    });
    const tree: CategoryTree = {
      income: [node(1, 'Выручка', null)],
      expense: [node(10, 'Зарплата', 'salary', [{ ...node(11, 'Администраторы', null), parentId: 10, effectiveSystemKey: 'salary' }])],
    };
    expect([...categoryLookup(tree)]).toEqual([
      [1, { name: 'Выручка', systemKey: null }],
      [10, { name: 'Зарплата', systemKey: 'salary' }],
      [11, { name: 'Зарплата → Администраторы', systemKey: null }],
    ]);
  });
```

3) Блок `describe('видимые колонки журнала', …)` замените целиком:

```ts
describe('видимые колонки журнала', () => {
  it('нет настройки — все, кроме «Даты сделки»; неизвестные отбрасываются; дата и сумма всегда видны; порядок постоянный (Review Focus 5)', () => {
    expect(visibleColumns(undefined)).toEqual(['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment']);
    expect(visibleColumns('мусор')).toHaveLength(7);
    expect(visibleColumns(['comment', 'bogus', 3, 'account'])).toEqual(['date', 'amount', 'account', 'comment']);
    expect(visibleColumns([])).toEqual(['date', 'amount']);
    // массив, сохранённый до плана 1.5-2, «Дату сделки» не знает — она выключена; включённая — третья
    expect(visibleColumns(['account', 'counterparty', 'category', 'project', 'comment'])).not.toContain('accrualDate');
    expect(visibleColumns(['comment', 'accrualDate'])).toEqual(['date', 'amount', 'accrualDate', 'comment']);
    expect(JOURNAL_COLUMNS.map((c) => c.label)).toEqual(['Дата', 'Сумма', 'Дата сделки', 'Счёт/остаток', 'Контрагент', 'Категория', 'Проект', 'Комментарий']);
  });

  it('переключение колонки; дату и сумму выключить нельзя', () => {
    expect(toggleColumn(['date', 'amount', 'account', 'comment'], 'comment')).toEqual(['date', 'amount', 'account']);
    expect(toggleColumn(['date', 'amount', 'comment'], 'project')).toEqual(['date', 'amount', 'project', 'comment']);
    expect(toggleColumn(['date', 'amount'], 'date')).toEqual(['date', 'amount']);
    expect(toggleColumn(['date', 'amount', 'account'], 'accrualDate')).toEqual(['date', 'amount', 'accrualDate', 'account']);
  });
});
```

`tests/client/preferences.test.ts`: импорт замените на `import { JOURNAL_WRAP_PREF, journalWrap, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../src/client/lib/preferences';` и в конец файла:

```ts
describe('«Показывать полностью» (§5.2, §10.2 этапа 1.5)', () => {
  it('ключ journal.wrap; только true включает, прочее — по умолчанию (выключено)', () => {
    expect(JOURNAL_WRAP_PREF).toBe('journal.wrap');
    expect(journalWrap({ [JOURNAL_WRAP_PREF]: true })).toBe(true);
    for (const v of [false, 'true', 1, null, {}]) expect(journalWrap({ [JOURNAL_WRAP_PREF]: v }), String(v)).toBe(false);
    expect(journalWrap(undefined)).toBe(false);
  });
});
```

`tests/client/journal-card.test.ts`: справочник категорий в `lookups`

```ts
  categories: new Map([
    [10, 'Аренда'],
    [11, 'Зарплата → Администраторы'],
  ]),
```

замените на

```ts
  categories: new Map([
    [10, { name: 'Аренда', systemKey: null }],
    [11, { name: 'Зарплата → Администраторы', systemKey: null }],
  ]),
```

Run: `npx vitest run tests/shared/dates.test.ts tests/client/journal.test.ts tests/client/preferences.test.ts` → FAIL (нет `formatDateShortRu`, `journalDateParts`, `categoryLookup`, `JOURNAL_WRAP_PREF`; колонки прежние).

- [ ] **Step 2: Implement the pure parts**

`src/shared/dates.ts` — после `formatDateRu` вставьте:

```ts
/** Сокращения месяцев, как в Finmap (§2.3 этапа 1.5): «4 окт. 2026», «4 мая 2026». */
const SHORT_MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** `YYYY-MM-DD` → «4 окт. 2026»: число без нуля, без «г.» (журнал, «Дата сделки»). */
export function formatDateShortRu(value: string): string {
  const [y, m, d] = value.split('-');
  return `${Number(d)} ${SHORT_MONTHS[Number(m) - 1]} ${y}`;
}
```

`src/client/lib/journal-format.ts`:

1) Импорты

```ts
import { addDays, formatDateRu } from '../../shared/dates';
import { formatAmount, formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { OperationType } from './journal-filter';
```

замените на

```ts
import { addDays, formatDateRu, formatDateShortRu } from '../../shared/dates';
import { formatAmount, formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { OperationType } from './journal-filter';
import type { CategoryTree } from './queries';
```

2) После функции `timeLabel` вставьте:

```ts
/**
 * Дата операции в таблице журнала (§5.2 этапа 1.5): первая строка — «4 окт. 2026», вторая — время «10:32»,
 * для сегодня и вчера — «Сегодня 10:32», «Вчера 10:32» (сама дата остаётся). Всё — в поясе приложения.
 */
export function journalDateParts(iso: string, timeZone: string, today: string): { date: string; time: string } {
  const day = dayOf(iso, timeZone);
  const prefix = day === today ? 'Сегодня ' : day === addDays(today, -1) ? 'Вчера ' : '';
  return { date: formatDateShortRu(day), time: `${prefix}${timeLabel(iso, timeZone)}` };
}

/** Категория в ячейке журнала: название и собственный systemKey (бейдж «системная» — только у самой системной категории). */
export interface CategoryInfo {
  name: string;
  systemKey: string | null;
}

/** Категории плоским списком для ячеек: «Родитель», «Родитель → Дочерняя» (§5.2, §10.3 этапа 1.5). */
export function categoryLookup(tree: CategoryTree): Map<number, CategoryInfo> {
  const map = new Map<number, CategoryInfo>();
  for (const node of [...tree.income, ...tree.expense]) {
    map.set(node.id, { name: node.name, systemKey: node.systemKey });
    for (const child of node.children) map.set(child.id, { name: `${node.name} → ${child.name}`, systemKey: child.systemKey });
  }
  return map;
}
```

`src/client/lib/journal-columns.ts` — замените целиком:

```ts
/** Колонки журнала (§5.3 этапа 1.5) в порядке показа. Дата и сумма видны всегда — по ним сортируют. */
export const JOURNAL_COLUMNS = [
  { id: 'date', label: 'Дата', fixed: true },
  { id: 'amount', label: 'Сумма', fixed: true },
  { id: 'accrualDate', label: 'Дата сделки', fixed: false },
  { id: 'account', label: 'Счёт/остаток', fixed: false },
  { id: 'counterparty', label: 'Контрагент', fixed: false },
  { id: 'category', label: 'Категория', fixed: false },
  { id: 'project', label: 'Проект', fixed: false },
  { id: 'comment', label: 'Комментарий', fixed: false },
] as const;

export type JournalColumnId = (typeof JOURNAL_COLUMNS)[number]['id'];

/** Ключ настройки пользователя (`user_preferences`): массив id видимых колонок. */
export const JOURNAL_COLUMNS_PREF = 'journal.columns';

/** Без сохранённой настройки — все колонки, кроме «Даты сделки» (§5.3, §10.2 этапа 1.5). */
const DEFAULT_IDS: readonly JournalColumnId[] = JOURNAL_COLUMNS.filter((c) => c.id !== 'accrualDate').map((c) => c.id);

/**
 * Видимые колонки из сохранённой настройки: неизвестные id отбрасываются, дата и сумма добавляются всегда,
 * порядок — как в JOURNAL_COLUMNS. Нет настройки или она не массив — все колонки, кроме «Даты сделки».
 * Сохранённый раньше массив без `accrualDate` оставляет её выключенной.
 */
export function visibleColumns(pref: unknown): JournalColumnId[] {
  if (!Array.isArray(pref)) return [...DEFAULT_IDS];
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

`src/client/lib/preferences.ts` — в конец:

```ts
/** «Показывать полностью» (§5.2, §10.2 этапа 1.5): длинный текст в ячейках журнала — до двух строк. */
export const JOURNAL_WRAP_PREF = 'journal.wrap';

/** Показывать полностью. Значение неизвестного вида — по умолчанию (в одну строку). */
export function journalWrap(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[JOURNAL_WRAP_PREF] === true;
}
```

`src/client/lib/journal-card.ts`: строку

```ts
    title = d.kind === 'many' ? splitLabel(d.count, 'category') : d.id === null ? 'Без категории' : (lookups.categories.get(d.id) ?? '…');
```

замените на

```ts
    title = d.kind === 'many' ? splitLabel(d.count, 'category') : d.id === null ? 'Без категории' : (lookups.categories.get(d.id)?.name ?? '…');
```

Run: `npx vitest run tests/shared/dates.test.ts tests/client/journal.test.ts tests/client/preferences.test.ts tests/client/journal-card.test.ts` → PASS.

- [ ] **Step 3: Colour token**

В `src/client/styles.css` после строки `  --color-income-soft: #dff5ec;` вставьте:

```css
  --color-income-strong: #0b7a53; /* текст на income-soft (плашка «Указать», «системная») — 4,7:1; фон полосы действий под белым текстом — 5,4:1 */
```

- [ ] **Step 4: The table**

Замените `src/client/components/journal/JournalTable.tsx` целиком:

```tsx
import type { MouseEvent, ReactNode } from 'react';
import { formatDateShortRu } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { journalDateParts, lineDimension, projectShare, signedMoney, splitLabel, type CategoryInfo } from '../../lib/journal-format';
import type { Account, JournalItem } from '../../lib/queries';
import { SplitHint } from './SplitHint';

export type { CategoryInfo };

/** Справочники для ячеек журнала (архивные тоже: операции на них ссылаются). */
export interface JournalLookups {
  accounts: Map<number, Account>;
  categories: Map<number, CategoryInfo>;
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
  /** «Показывать полностью» (`journal.wrap`): длинный текст — до двух строк, иначе одна строка с подсказкой. */
  wrap: boolean;
  /**
   * Открыть операцию в форме: клик по строке или кнопка в ячейке даты (с клавиатуры).
   * Не передан — строка не реагирует на клик.
   */
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке: вызывается только там, где оно разрешено (canAssign). */
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

const thClass = 'px-3 text-left text-xs font-semibold text-muted';
/** Строки одной высоты (§5.2 этапа 1.5): высота ячейки работает как минимальная, содержимое — по центру. */
const tdClass = 'h-[4.5rem] px-3 py-2 align-middle';
/** Флажки выделения (§5.2): 18 px, цвет акцента. */
const checkboxClass = 'size-[18px] shrink-0 cursor-pointer accent-income';

function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort'] }) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={thClass} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => props.onSort(props.column, next)}
        className="group inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        {props.label}
        {/* стрелка — только у активной колонки; у остальных «↕» появляется при наведении и фокусе (§5.2) */}
        <span aria-hidden="true" className={active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}>
          {active ? (props.order === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

/**
 * Текст ячейки: одна строка с обрезкой и подсказкой title; при «Показывать полностью» — до двух строк.
 * Без `block` рядом с `line-clamp-2`: в Tailwind 4 `.block` идёт в CSS после `.line-clamp-2` и перебил бы
 * `display: -webkit-box` — обрезки по строкам не было бы.
 */
function CellText({ text, wrap, width = 'max-w-56' }: { text: string; wrap: boolean; width?: string }) {
  return (
    <span title={text} className={`${width} ${wrap ? 'line-clamp-2 break-words' : 'block truncate'}`}>
      {text}
    </span>
  );
}

/** «системная» — у категории с собственным systemKey (§5.2 этапа 1.5). */
function SystemBadge() {
  return <span className="shrink-0 rounded bg-income-soft px-1.5 py-0.5 text-[11px] font-medium text-income-strong">системная</span>;
}

function lineHint(item: JournalItem, lookups: JournalLookups, currency: string): string[] {
  return item.lines.map((l) => {
    const category = l.categoryId === null ? 'без категории' : (lookups.categories.get(l.categoryId)?.name ?? '…');
    const project = l.projectId === null ? 'без проекта' : (lookups.projects.get(l.projectId) ?? '…');
    return `${category} · ${project} — ${formatMoney(l.amount, currency, MONEY_SCREEN)}`;
  });
}

/** Ячейка категории или проекта: значение, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', value: (id: number) => ReactNode, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : value(d.id);
}

/** Остаток после операции в валюте счёта, без слова «остаток» (§5.2); отрицательный — красным. */
function Balance({ account, balance }: { account: Account | undefined; balance: number | null }) {
  if (!account || balance === null) return null;
  return <span className={balance < 0 ? 'text-expense' : 'text-muted'}>{formatMoney(balance, account.currency, MONEY_SCREEN)}</span>;
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection, wrap } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
  const selectedCount = selection ? props.items.filter((i) => selection.selected.has(i.id)).length : 0;
  const allSelected = props.items.length > 0 && selectedCount === props.items.length;

  const onRowClick = (item: JournalItem) => (e: MouseEvent<HTMLTableRowElement>) => {
    // клики по настоящим элементам управления внутри строки — не открытие операции;
    // «2 категории» (подсказка с tabIndex) — открывает: по §7 клик по ним открывает форму
    // события из портала (подсказка) всплывают по дереву React, но в DOM лежат вне строки — их игнорируем
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest('button, a, input, label, select, [role="combobox"], [role="listbox"]')) return;
    props.onOpenOperation?.(item);
  };

  const categoryName = (id: number): ReactNode => {
    const c = lookups.categories.get(id);
    if (!c) return '…';
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <CellText text={c.name} wrap={wrap} />
        {c.systemKey && <SystemBadge />}
      </span>
    );
  };
  const projectName = (id: number): ReactNode => <CellText text={lookups.projects.get(id) ?? '…'} wrap={wrap} />;

  return (
    <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full min-w-[56rem] border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Операции</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {selection && (
              <th scope="col" className={`${thClass} w-8`}>
                <input
                  type="checkbox"
                  data-select-all=""
                  aria-label="Выбрать все загруженные операции"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  onChange={() => selection.onToggleAll(!allSelected)}
                  className={checkboxClass}
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
            const when = journalDateParts(item.paidAt, props.timeZone, props.today);
            const signed = signedMoney(item.type, item.amount, currency);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const dateText = (
              <time dateTime={item.paidAt} className="block whitespace-nowrap text-left">
                <span className="block">{when.date}</span>
                <span className="block text-xs text-muted">{when.time}</span>
              </time>
            );
            const cells: Record<JournalColumnId, ReactNode> = {
              date: props.onOpenOperation ? (
                // с клавиатуры операция открывается кнопкой в ячейке даты (Tab, затем Enter)
                <button
                  type="button"
                  data-row-open=""
                  onClick={() => props.onOpenOperation!(item)}
                  aria-label={`Открыть операцию: ${when.date}, ${when.time}, ${signed}`}
                  className="rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {dateText}
                </button>
              ) : (
                dateText
              ),
              amount: (
                <span className="block whitespace-nowrap tabular-nums">
                  <span className={`block ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {item.type === 'transfer' && (
                      <span className="sr-only">
                        Перевод: со счёта {account?.name ?? '…'} на счёт {toAccount?.name ?? '…'},{' '}
                      </span>
                    )}
                    {signed}
                  </span>
                  {item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null && (
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}</span>
                  )}
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency, MONEY_SCREEN)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency, MONEY_SCREEN)}</span>}
                </span>
              ),
              accrualDate: item.accrualDate && <span className="whitespace-nowrap">{formatDateShortRu(item.accrualDate)}</span>,
              account: (
                <span className="block">
                  <CellText text={item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…')} wrap={wrap} />
                  <span className="block whitespace-nowrap text-xs tabular-nums">
                    <Balance account={account} balance={item.balanceAfter} />
                    {item.type === 'transfer' && toAccount && item.toBalanceAfter !== null && (
                      <>
                        <span aria-hidden="true" className="text-muted">
                          {' → '}
                        </span>
                        <Balance account={toAccount} balance={item.toBalanceAfter} />
                      </>
                    )}
                  </span>
                </span>
              ),
              counterparty: item.counterpartyId === null ? assign('counterparty') : <CellText text={lookups.counterparties.get(item.counterpartyId) ?? '…'} wrap={wrap} />,
              category: dimensionCell(item, 'categoryId', categoryName, hint, assign('category')),
              project: dimensionCell(item, 'projectId', projectName, hint, assign('project')),
              comment: item.comment && <CellText text={item.comment} wrap={wrap} width="max-w-xs" />,
            };
            return (
              <tr
                key={item.id}
                // фокус сюда переводит «Указать» после выбора, если кнопки строки нет
                tabIndex={-1}
                data-operation-id={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field outline-none last:border-0 focus:bg-field/60 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''} ${selection?.selected.has(item.id) ? 'bg-income-soft/40' : ''}`}
              >
                {selection && (
                  <td className="h-[4.5rem] p-0 align-middle">
                    {/* label на всю ячейку: отступы вокруг флажка тоже его переключают, а не открывают операцию */}
                    <label className="flex h-[4.5rem] cursor-pointer items-center px-3">
                      <input
                        type="checkbox"
                        aria-label={[
                          `Выбрать операцию: ${when.date}, ${when.time}`,
                          signed,
                          item.counterpartyId === null ? null : lookups.counterparties.get(item.counterpartyId),
                          item.comment,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        checked={selection.selected.has(item.id)}
                        onChange={() => selection.onToggle(item.id)}
                        className={checkboxClass}
                      />
                    </label>
                  </td>
                )}
                {shown.map((c) => (
                  <td key={c.id} data-column={c.id} className={tdClass}>
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

- [ ] **Step 5: The journal page and the «Указать» chip**

`src/client/pages/JournalPage.tsx`:

1) Удалите функцию целиком:

```tsx
/** Категории плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}
```

2) `import { uniqueById } from '../lib/journal-format';` → `import { categoryLookup, uniqueById } from '../lib/journal-format';`; после строки `import { rememberJournal } from '../lib/last-journal';` вставьте `import { journalWrap } from '../lib/preferences';`; в импорте из `../lib/queries` уберите `type CategoryTree, ` (останется `…, useTags, type Company }`).

3) `      categories: categoryNames(categories.data),` → `      categories: categoryLookup(categories.data),`

4) В `<JournalTable` после строки `          columns={columns}` вставьте `          wrap={journalWrap(prefs.data)}`.

`src/client/components/journal/AssignPicker.tsx`: строку

```tsx
      buttonClassName="rounded-lg px-2 py-1 text-sm font-medium text-income hover:bg-field"
```

замените на

```tsx
      // плашка «Указать» (§5.2 этапа 1.5): видна всегда; текст income-strong — контраст 4,7:1 на светло-зелёном
      buttonClassName="rounded-md bg-income-soft px-2 py-0.5 text-xs font-medium text-income-strong hover:brightness-95"
```

Run: `npm run typecheck` → без ошибок. Run: `npm test` → PASS.

- [ ] **Step 6: Update e2e**

`e2e/journal.spec.ts`:

1) Первая строка: `import { expect, test, type Page } from '@playwright/test';` → `import { expect, test, type Locator, type Page } from '@playwright/test';`

2) В тесте «сценарий 3 §10: …» строки

```ts
  await expect(transfer).toContainText(/500\s₸/);
  await expect(transfer).toContainText(/→ 1\s\$/);
  await expect(transfer).toContainText(/Касса\s*остаток 700\s₸/);
  await expect(transfer).toContainText(/Валютный\s*остаток 1\s\$/);
  await expect(expense).toContainText(/\u2212300\s₸/);
  await expect(expense).toContainText(/остаток 1\s200\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500\s₸/);
  await expect(income).toContainText(/остаток 1\s500\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  await expect(income.locator('time')).toContainText('сегодня');
```

замените на

```ts
  const account = (row: Locator) => row.locator('[data-column="account"]');
  await expect(table(page).getByRole('columnheader', { name: 'Счёт/остаток', exact: true })).toBeVisible();
  await expect(transfer).toContainText(/500\s₸/);
  await expect(transfer).toContainText(/→ 1\s\$/);
  // «Счёт/остаток» (§5.2 этапа 1.5): у перевода оба счёта и оба остатка, слова «остаток» нет
  await expect(account(transfer)).toContainText('Касса → Валютный');
  await expect(account(transfer)).toContainText(/700\s₸\s*→\s*1\s\$/);
  await expect(expense).toContainText(/\u2212300\s₸/);
  await expect(account(expense)).toContainText(/1\s200\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500\s₸/);
  await expect(account(income)).toContainText(/1\s500\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  // в заголовке «Счёт/остаток» слово есть — проверяем только строки
  await expect(table(page).locator('tbody')).not.toContainText('остаток');
  // дата в две строки: «4 окт. 2026», ниже «Сегодня 10:32»
  await expect(income.locator('time')).toHaveText(/^\d{1,2} [а-я]+\.? \d{4}Сегодня \d{2}:\d{2}$/);
  // строки одной высоты (§5.2)
  const heights = await bodyRows(page).evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
  // у последней строки нет нижней границы — допуск 1 px
  expect(Math.max(...heights) - Math.min(...heights), heights.join()).toBeLessThanOrEqual(1);
```

3) В тесте «тулбар: …» строку `  await expect(bodyRows(page).first().locator('time')).toContainText('вчера');` замените на `  await expect(bodyRows(page).first().locator('time')).toContainText(/Вчера \d{2}:\d{2}/);`

4) В тесте ««Ещё»: суммы, ⟳, колонки и выгрузка…»:

строку

```ts
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'Видимый комментарий' });
```

замените на

```ts
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, accrualDate: '2026-09-01', comment: 'Видимый комментарий' });
  // системная категория «Инвестиции» — с бейджем «системная» (§5.2)
  const tree = (await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()) as { income: { id: number; systemKey: string | null }[] };
  const investment = tree.income.find((c) => c.systemKey === 'investment')!.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 200, lines: [{ categoryId: investment, amount: 200 }], comment: 'вклад' });
```

после строк

```ts
  const header = (name: string) => table(page).getByRole('columnheader', { name, exact: true });
  await expect(header('Комментарий')).toBeVisible();
```

вставьте

```ts
  // «Счёт/остаток»; «Дата сделки» без настройки выключена (§5.3, Review Focus 5)
  await expect(header('Счёт/остаток')).toBeVisible();
  await expect(header('Дата сделки')).toHaveCount(0);
  // бейдж «системная» — у системной категории
  const investmentCategory = bodyRows(page).filter({ hasText: 'вклад' }).locator('[data-column="category"]');
  await expect(investmentCategory).toContainText('Инвестиции');
  await expect(investmentCategory).toContainText('системная');
  // стрелка сортировки — только у активной колонки; «↕» у «Суммы» скрыта до наведения
  await expect(table(page).getByRole('columnheader', { name: /Дата/ }).first().locator('[aria-hidden="true"]')).toHaveText('↓');
  await expect(table(page).getByRole('columnheader', { name: /Сумма/ }).locator('[aria-hidden="true"]')).toHaveCSS('opacity', '0');
```

после строки `    await expect(menu.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeDisabled();` вставьте

```ts
    // «Дата сделки» включается здесь же и встаёт третьей колонкой
    const accrualSaved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Дата сделки' }).check();
    await accrualSaved;
    await expect(table(page).getByRole('columnheader').nth(3)).toHaveText('Дата сделки');
    await expect(bodyRows(page).filter({ hasText: 'Видимый комментарий' }).locator('[data-column="accrualDate"]')).toHaveText('1 сент. 2026');
```

и строку `    await expect(header('Счёт')).toBeVisible();` замените на

```ts
    await expect(header('Счёт/остаток')).toBeVisible();
    await expect(header('Дата сделки')).toBeVisible();
```

`e2e/journal-actions.spec.ts`: строку

```ts
  await expect(row('A').getByRole('checkbox')).toHaveAccessibleName(/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210\s₸, операция A$/);
```

замените на

```ts
  await expect(row('A').getByRole('checkbox')).toHaveAccessibleName(/^Выбрать операцию: \d{1,2} \S+ \d{4}, Сегодня \d{2}:\d{2}, \u221210\s₸, операция A$/);
```

`e2e/operation-edit.spec.ts`: `const open = table(page).getByRole('button', { name: /^Открыть операцию: сегодня/ });` → `const open = table(page).getByRole('button', { name: /^Открыть операцию: \d{1,2} \S+ \d{4}, Сегодня/ });`

`e2e/operation-form.spec.ts`: строки

```ts
  await expect(rows.filter({ hasText: 'Выручка' })).toContainText(/остаток 1\s500\s₸/);
  const rent = rows.filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('2 проекта');
  await expect(rent).toContainText(/остаток 1\s200\s₸/);
  const transfer = rows.filter({ hasText: 'Валютный' });
  await expect(transfer).toContainText(/остаток 700\s₸/);
  await expect(transfer).toContainText(/остаток 1\s\$/);
```

замените на

```ts
  // «Счёт/остаток» (§5.2 этапа 1.5): остаток без слова «остаток», у перевода — оба
  const accountCell = (row: Locator) => row.locator('[data-column="account"]');
  await expect(accountCell(rows.filter({ hasText: 'Выручка' }))).toContainText(/1\s500\s₸/);
  const rent = rows.filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('2 проекта');
  await expect(accountCell(rent)).toContainText(/1\s200\s₸/);
  const transfer = rows.filter({ hasText: 'Валютный' });
  await expect(accountCell(transfer)).toContainText(/700\s₸\s*→\s*1\s\$/);
```

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 660 (656 + 4). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal.spec.ts e2e/journal-actions.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/mobile.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src/shared/dates.ts src/client tests e2e
git commit -m "feat: таблица журнала как в Finmap — дата в две строки, строки одной высоты, «Счёт/остаток», «Дата сделки», бейдж «системная», плашка «Указать»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: «Показывать полностью» — в «Ещё» и в «Настройках журнала»

**Files:**
- Modify: `src/client/lib/preferences.ts`, `src/client/components/journal/ColumnsPanel.tsx` (целиком), `src/client/pages/settings/JournalViewSettings.tsx` (целиком), `tests/client/preferences.test.ts`, `e2e/journal.spec.ts`, `e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: `JOURNAL_WRAP_PREF`, `journalWrap` (задача 4); `useInstantPref` (задача 3); `JournalTableProps.wrap` (задача 4, страница уже передаёт `journalWrap(prefs.data)`).
- Produces: `prefsSaveError(saved: readonly string[], failed: string, message: string): string` (`lib/preferences.ts`); флажок «Показывать полностью» в `ColumnsPanel`; флажок «Показывать полностью (до 2 строк)» на странице `settings/journal`.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/preferences.test.ts` в импорт добавьте `prefsSaveError` и в конец файла:

```ts
describe('ошибка «Применить» в «Настройках журнала» (§7.5 этапа 1.5)', () => {
  it('что сохранено и что нет — без неуклюжих оборотов', () => {
    expect(prefsSaveError([], 'колонки', 'Сбой')).toBe('Не сохранено: колонки — Сбой');
    expect(prefsSaveError(['колонки'], 'вопрос о несохранённом', 'Сбой сохранения')).toBe('Сохранено: колонки. Не сохранено: вопрос о несохранённом — Сбой сохранения');
    expect(prefsSaveError(['колонки', '«Показывать полностью»'], 'вопрос о несохранённом', 'Сбой')).toBe(
      'Сохранено: колонки, «Показывать полностью». Не сохранено: вопрос о несохранённом — Сбой',
    );
  });
});
```

Run: `npx vitest run tests/client/preferences.test.ts` → FAIL (`prefsSaveError` не экспортируется).

- [ ] **Step 2: Implement `prefsSaveError`**

В конец `src/client/lib/preferences.ts`:

```ts
/**
 * Текст ошибки «Применить» в «Настройках журнала» (§7.5 этапа 1.5): настройки сохраняются по очереди, на первой
 * ошибке — стоп. saved — что уже сохранено, failed — что нет (со строчной: «колонки», «вопрос о несохранённом»).
 */
export function prefsSaveError(saved: readonly string[], failed: string, message: string): string {
  const head = saved.length > 0 ? `Сохранено: ${saved.join(', ')}. ` : '';
  return `${head}Не сохранено: ${failed} — ${message}`;
}
```

Run: `npx vitest run tests/client/preferences.test.ts` → PASS.

- [ ] **Step 3: The checkbox in «Ещё»**

Замените `src/client/components/journal/ColumnsPanel.tsx` целиком (хук `useInstantPref` прежний, к колонкам добавляется «Показывать полностью»):

```tsx
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap } from '../../lib/preferences';
import { queryClient } from '../../lib/query';
import { usePreferences } from '../../lib/queries';

/**
 * Настройка пользователя, которая применяется сразу (§5.1 этапа 1.5): выбор виден в тот же миг — и в журнале,
 * через кэш настроек, — а сохраняется в фоне. Учитывается только ответ на последний выбор (быстрые щелчки подряд
 * не путаются): после успеха значение берётся из кэша, после сбоя настройки перечитываются с сервера
 * и показывается ошибка.
 */
export function useInstantPref<T>(key: string, saved: T, failText: string) {
  // флажок отражает выбор сразу: кэш TanStack Query оповещает подписчиков не синхронно
  const [override, setOverride] = useState<{ value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const set = (value: T) => {
    const mine = ++seq.current;
    setOverride({ value });
    setError(null);
    const toCache = () => queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [key]: value }));
    toCache();
    api(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } })
      .then(() => {
        if (mine !== seq.current) return;
        toCache();
        setOverride(null);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOverride(null);
        setError(failText);
        void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      });
  };
  return { value: override ? override.value : saved, set, error };
}

/**
 * Колонки журнала и «Показывать полностью» в панели «Ещё» (§5.1, §5.3 этапа 1.5): флажки применяются сразу.
 * Дата и сумма видны всегда.
 */
export function ColumnsPanel() {
  const prefs = usePreferences();
  const columns = useInstantPref<JournalColumnId[]>(JOURNAL_COLUMNS_PREF, visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]), 'Не удалось сохранить выбор колонок');
  const wrap = useInstantPref<boolean>(JOURNAL_WRAP_PREF, journalWrap(prefs.data), 'Не удалось сохранить «Показывать полностью»');
  const error = columns.error ?? wrap.error;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Колонки</legend>
      <div className="grid grid-cols-2 gap-x-4">
        {JOURNAL_COLUMNS.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={c.fixed || columns.value.includes(c.id)}
              disabled={c.fixed}
              onChange={() => columns.set(toggleColumn(columns.value, c.id))}
              className="size-4 accent-income"
            />
            {c.label}
          </label>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 border-t border-field pt-2 text-sm">
        <input type="checkbox" checked={wrap.value} onChange={(e) => wrap.set(e.target.checked)} className="size-4 accent-income" />
        Показывать полностью
        <span className="text-xs text-muted">(до 2 строк)</span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-expense">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: The settings page**

Замените `src/client/pages/settings/JournalViewSettings.tsx` целиком:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap, prefsSaveError, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import { savePreference, usePreferences } from '../../lib/queries';

/**
 * «Настройки журнала» (§7.5 этапа 1.5): видимые колонки (в том числе «Дата сделки»), «Показывать полностью
 * (до 2 строк)» и вопрос о несохранённом в форме операции. «Применить» сохраняет всё вместе; список в «Ещё»
 * журнала применяется сразу. Окончательный вид страницы — план 1.5-4.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm prefs={prefs.data} />;
}

interface Saved {
  columns: JournalColumnId[];
  wrap: boolean;
  ask: boolean;
}

function JournalViewForm({ prefs }: { prefs: Record<string, unknown> }) {
  const [columns, setColumns] = useState<JournalColumnId[]>(() => visibleColumns(prefs[JOURNAL_COLUMNS_PREF]));
  const [wrap, setWrap] = useState(() => journalWrap(prefs));
  const [ask, setAsk] = useState(() => !skipCloseConfirm(prefs));
  // что реально сохранено: от него считается «есть изменения» и после частичного сбоя он отражает правду
  const [saved, setSaved] = useState<Saved>({ columns, wrap, ask });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'status' | 'button' | null>(null);

  // только изменённое и по очереди: неизменённая настройка не затирает более новое значение из другой вкладки
  const changes = [
    { changed: columns.join() !== saved.columns.join(), name: 'колонки', save: () => savePreference(JOURNAL_COLUMNS_PREF, columns), mark: (s: Saved): Saved => ({ ...s, columns }) },
    { changed: wrap !== saved.wrap, name: '«Показывать полностью»', save: () => savePreference(JOURNAL_WRAP_PREF, wrap), mark: (s: Saved): Saved => ({ ...s, wrap }) },
    { changed: ask !== saved.ask, name: 'вопрос о несохранённом', save: () => savePreference(SKIP_CLOSE_CONFIRM_PREF, !ask), mark: (s: Saved): Saved => ({ ...s, ask }) },
  ].filter((c) => c.changed);
  const dirty = changes.length > 0;

  // кнопка и поля отключены на время сохранения: фокус возвращается сюда, когда оно закончилось
  useEffect(() => {
    if (pending || !refocus.current) return;
    (refocus.current === 'status' ? statusRef.current : buttonRef.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [pending]);

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    let done = saved;
    const savedNames: string[] = [];
    let ok = true;
    try {
      for (const c of changes) {
        try {
          await c.save();
          done = c.mark(done);
          savedNames.push(c.name);
        } catch (e) {
          ok = false;
          setError(prefsSaveError(savedNames, c.name, e instanceof ApiError ? e.message : 'Ошибка сервера'));
          return;
        }
      }
      setStatus('Настройки сохранены');
    } finally {
      setSaved(done);
      refocus.current = ok ? 'status' : 'button';
      setPending(false);
    }
  };

  const edited = () => {
    setStatus(null);
    setError(null);
  };

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">Настройки журнала</h1>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Колонки</legend>
        <div className="grid gap-2">
          {JOURNAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.fixed || columns.includes(c.id)}
                disabled={c.fixed}
                onChange={() => {
                  edited();
                  setColumns((v) => toggleColumn(v, c.id));
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Строки</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => {
              edited();
              setWrap(e.target.checked);
            }}
          />
          Показывать полностью (до 2 строк)
        </label>
        <p className="mt-1 text-xs text-muted">Без флажка длинные названия и комментарии обрезаются в одну строку, полный текст — в подсказке.</p>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Форма операции</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ask}
            onChange={(e) => {
              edited();
              setAsk(e.target.checked);
            }}
          />
          Спрашивать перед закрытием формы с несохранёнными данными
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className={status ? 'mb-4 text-sm text-income outline-none' : 'sr-only'}>
        {status}
      </p>
      <button ref={buttonRef} type="button" disabled={pending || !dirty} onClick={() => void apply()} className={btnPrimary}>
        Применить
      </button>
    </section>
  );
}
```

Run: `npm run typecheck` → без ошибок. Run: `npm test` → PASS.

- [ ] **Step 5: Update e2e**

`e2e/journal.spec.ts`, тест ««Ещё»: суммы, ⟳, колонки и выгрузка…»:

0) После строки с операцией `comment: 'вклад'` (её добавила задача 4) вставьте операцию с длинным комментарием:

```ts
  const longComment = 'Длинный комментарий для проверки переноса строк в журнале. '.repeat(8).trim();
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 300, comment: longComment });
```

1) Перед строкой

```ts
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
```

(колонка «Комментарий» ещё видна) вставьте:

```ts
    // «Показывать полностью»: длинный текст — до двух строк вместо одной (§5.2). Проверяем высоту, а не только класс:
    // класс без действующего display: -webkit-box ничего не обрезает
    const comment = bodyRows(page).filter({ hasText: 'Длинный комментарий' }).locator('[data-column="comment"] [title]');
    const lineHeight = await comment.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await comment.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
    const wrapSaved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.wrap') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Показывать полностью' }).check();
    await wrapSaved;
    await expect.poll(async () => (await comment.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
    expect((await comment.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
    await expect(comment).toHaveCSS('display', '-webkit-box');
    // строки по-прежнему одной высоты (у последней нет нижней границы — допуск 1 px)
    const heights = await bodyRows(page).evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(Math.max(...heights) - Math.min(...heights), heights.join()).toBeLessThanOrEqual(1);
```

2) В `finally` после строки с `journal.columns` добавьте:

```ts
    await page.request.put('/api/v1/preferences/journal.wrap', { data: { value: before['journal.wrap'] ?? null }, headers: csrf(page) });
```

3) Последние строки теста

```ts
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
});
```

замените на

```ts
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
  await expect(bodyRows(page).first().locator('[data-column="account"] [title]')).toHaveClass(/truncate/);
});
```

`e2e/dialogs.spec.ts`, тест ««Настройки журнала»: …»:

1) После строки `    await expect(page.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeChecked();` вставьте:

```ts
    await expect(page.getByRole('checkbox', { name: 'Дата сделки', exact: true })).not.toBeChecked();
    const wrap = page.getByRole('checkbox', { name: 'Показывать полностью (до 2 строк)' });
    await expect(wrap).not.toBeChecked();
```

2) Строки

```ts
    await ask.check();
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await apply.click();
    await expect(page.getByRole('alert')).toHaveText('Колонки сохранены, но вопрос о несохранённом — нет: Сбой сохранения');
```

замените на

```ts
    await ask.check();
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await wrap.check();
    await apply.click();
    await expect(page.getByRole('alert')).toHaveText('Сохранено: колонки, «Показывать полностью». Не сохранено: вопрос о несохранённом — Сбой сохранения');
```

3) После строки `    await expect(page.getByRole('columnheader', { name: 'Комментарий' })).toHaveCount(0);` вставьте:

```ts
    // «Показывать полностью» — название счёта до двух строк
    await expect(page.getByRole('table', { name: 'Операции' }).locator('[data-column="account"] [title]').first()).toHaveClass(/line-clamp-2/);
```

4) Строки

```ts
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();
    await expect(apply).toBeDisabled();
  } finally {
```

замените на

```ts
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();
    await expect(wrap).toBeChecked();
    await expect(apply).toBeDisabled();
  } finally {
```

5) В `finally` после строки `    await putPref('journal.columns', before['journal.columns'] ?? null);` добавьте `    await putPref('journal.wrap', before['journal.wrap'] ?? null);`.

- [ ] **Step 6: Run all checks; e2e twice**

Run: `npm test` → PASS, 661 (660 + 1). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal.spec.ts e2e/dialogs.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/preferences.ts src/client/components/journal/ColumnsPanel.tsx src/client/pages/settings/JournalViewSettings.tsx tests/client/preferences.test.ts e2e
git commit -m "feat: «Показывать полностью» (journal.wrap) — в «Ещё» и в «Настройках журнала»; понятная ошибка частичного сохранения

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Визуальная сверка журнала — сценарии 17, 18b, 19 и прогон `npm run shots:ux`

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: кнопки «Период: …», «Быстрые фильтры», «Ещё» (задачи 2–3); `SCENARIOS` скрипта (план 1.5-1b).
- Produces: снимки `c17-period-dd.png`, `c18b-filter-saved-dd.png`, `c19-toolbar-more.png` в папке сверки; итог сверки журнала в отчёте задачи.

- [ ] **Step 1: Add the scenarios**

В `scripts/ux-shots.ts` в массив `SCENARIOS` перед сценарием `c18-filter-modal.png` вставьте:

```ts
  {
    ours: 'c17-period-dd.png',
    finmap: '17-period-dd.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: /^Период:/ }).click();
      await p.getByRole('dialog', { name: 'Период', exact: true }).waitFor();
    },
  },
```

а после сценария `c18-filter-modal.png`:

```ts
  {
    ours: 'c18b-filter-saved-dd.png',
    finmap: '18b-filter-saved-dd.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Быстрые фильтры' }).click();
      await p.getByRole('dialog', { name: 'Быстрые фильтры' }).waitFor();
    },
  },
  {
    ours: 'c19-toolbar-more.png',
    finmap: '19-toolbar-more.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).waitFor();
    },
  },
```

Run: `npm run typecheck` → без ошибок. Run: `npx vitest run tests/shared/terminology.test.ts` → PASS.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: строки `✓ c01-log.png` … и итог `Готово: …\parity\index.html — снято 36 из 36.` Скрипт поднимает свой сервер на порту 41741 с временной папкой и удаляет её после работы. Если сценарий упал (`✗ …`), прочитайте сообщение: обычно это локатор, не нашедший элемент на демо-данных. Исправьте локатор сценария, а не продукт, и запустите ещё раз.

- [ ] **Step 3: Compare the journal screens and write the result into the task report**

Откройте инструментом чтения изображений пары из `docs/research/screens/v2/` (Finmap) и `docs/research/screens/v2/parity/` (наши): `01-log.png` ↔ `c01-log.png`, `02-row-hover.png` ↔ `c02-row-hover.png`, `03-ukazat-popover.png` ↔ `c03-ukazat-popover.png`, `04-bulk-selected.png` ↔ `c04-bulk-selected.png`, `17-period-dd.png` ↔ `c17-period-dd.png`, `18-filter-modal.png` ↔ `c18-filter-modal.png`, `18b-filter-saved-dd.png` ↔ `c18b-filter-saved-dd.png`, `19-toolbar-more.png` ↔ `c19-toolbar-more.png`, `36-settings-log-view.png` ↔ `c36-settings-log-view.png`.

В отчёт задачи (не в файл) запишите таблицу «экран — совпадает по раскладке / отличается намеренно (почему) / отличается (что исправить)». Ожидаемо:
- **совпадают** 01 (тулбар в одну строку, дата в две строки, «Счёт/остаток», плашки «Указать», «системная», строки одной высоты), 02, 17, 18b, 19, 36;
- **отличаются намеренно:** 01 — пункты «За сегодня» и «За вчера», ✕ «Сбросить фильтр», сумма в базовой валюте и остатки обоих счетов перевода; 19 — нет переключателя рядом с суммой (§5.1), колонки раскрываются в той же панели;
- **ещё не совпадают, их делает план 1.5-2b:** 03 («Указать» — пока выпадающий список, в 2b — окно), 04 (полоса действий и итог выделения), 18 (окно фильтра с мультивыборами).

Контролёр переносит таблицу в файл итогов плана. В git папка сверки не попадает (`git status` её не показывает).

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS, 661. Run: `npm run typecheck` → без ошибок. Run: `npm run test:e2e` → 70 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — сценарии меню периода, «Быстрых фильтров» и «Ещё»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-10-stage1_5-plan2a-followups.md` (пишет контролёр).
- Следующий план — [1.5-2b](2026-10-10-stage1_5-plan2b-journal-actions-filter.md): «Указать» окном, полоса действий с «Изменить данные» и итогом, окно «Фильтры».
- Замечания для итогов (followups):
  - `DateField` и `Calendar` готовы для формы операции (план 1.5-3: «Дата сделки», `DateTimeField` с `max` = сегодня);
  - на телефоне панель «Фильтры» и дата карточки «сегодня 10:30» — до плана 1.5-5;
  - кнопка ⟳ в «Мои счета» левой панели — план 1.5-4 (§7.6), на телефоне — 1.5-5 (§8.5).
