# Этап 1.5, план 1.5-2b: журнал — «Указать» окном, полоса действий и «Изменить данные», окно «Фильтры» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина плана 1.5-2 из §13 спецификации этапа 1.5:
- «Указать» — окно «Редактирование контрагента / категории / проекта» с одним списком и «Сохранить», как в Finmap (§5.4, решение 3 владельца);
- полоса массовых действий на месте строки заголовков, акцентного цвета, с общим чекбоксом «−», «Изменить данные» (окно с тремя полями) и «Удалить»; справа итог выделения «Доход • 2 платежа • 45 666 ₸» (§5.5);
- окно «Фильтры»: «×» в углу без «Отмены», поля — выпадающие мультивыборы с поиском и счётчиком в порядке Finmap, «Недоступный элемент» для неизвестных id (§5.6);
- сценарии «Указать» и «Фильтры» в визуальной сверке и итоговый прогон `npm run shots:ux`.

**Предусловие:** выполнен план [1.5-2a](2026-10-10-stage1_5-plan2a-journal-toolbar-table.md): тулбар в одну строку («Фильтр · N | ▾», «Быстрые фильтры», «Ещё»), `Calendar`/`DateField`, вложенные панели `Popover`, таблица по §5.2 (ячейки с `data-column`, кнопка строки с `data-row-open`, флажок «Выбрать все» с `data-select-all`), токен `income-strong`, «Показывать полностью». Ожидаемо на старте: `npm test` — 659 тестов (+1 пропущен), `npm run test:e2e` — 70.

**Architecture:**
- **«Указать».** Плашка в ячейке — простая кнопка `AssignChip`; окно `AssignDialog` на `Modal` (ширина 480 px) с нынешним `ComboSelect` формы операции и кнопкой «Сохранить». Список и подпись поля — чистые функции `assignOptions` и `assignLabel` в `lib/journal-assign.ts` (те же правила, что в форме: категории только вида операции, контрагенты подходящего типа первыми). Сохранение — прежняя мутация `useAssign` (оптимистично, с `version`, откат и сообщение при 409). Фокус после «Сохранить» ставит новое свойство `Modal.returnFocus` — на кнопку открытия операции в той же строке; Esc и «×» возвращают его на плашку.
- **Полоса действий** — `BulkBar` в новом свойстве `JournalTable.bulkBar`: лежит поверх строки заголовков (`absolute`), строка заголовков остаётся в таблице для программ чтения, её кнопки на это время выходят из порядка Tab. Итог выделения — чистая функция `selectionTotals` (`lib/journal-bulk.ts`). «Изменить данные» — окно `BulkEditDialog` с тремя `ComboSelect` («Не менять» — пустое значение); действия — `bulkEditActions`, по очереди существующими `POST …/bulk`, итог — `bulkEditSummary`.
- **Окно «Фильтры».** Варианты, выбранное и переключение для каждого поля — чистые функции в новом `lib/journal-filter-dialog.ts` (ключи вида `type:income`, `category:12`, `none`, `5`). Компонент `MultiSelectField` — кнопка поля (подпись со счётчиком и значение) и панель `Popover` с поиском и флажками. Адрес и смысл фильтра не меняются.

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §1, §2.2, §2.4, §5.2 (плашка «Указать»), §5.4–5.6, §11, §12, §13 (план 1.5-2, блок «Решения планирования плана 1.5-2»). Аудит: [01-shell-journal.md](../../research/ux-parity/01-shell-journal.md) — H4, M7, M12, M13.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-2») тем же коммитом, что и план.

1. **Поле в окне «Указать»** — нынешний `ComboSelect` формы (кнопка, по нажатию — список с поиском). Ввод в само поле и «+ Создать» первым пунктом придут с §6.6 в плане 1.5-3 и подхватятся окном без правок. Подпись поля контрагента — `COUNTERPARTY_TYPE_SINGULAR` («Сотрудник», «Собственник», …); переименования §6.4 («Владелец», «Тип налога») делает план 1.5-3.
2. **Фокус после «Указать»** — `Modal.returnFocus`: функция, которую окно вызывает при закрытии; если она вернула элемент на странице, фокус встаёт на него, иначе — прежнее правило (кнопка-открыватель, а если её нет — `<h1>`). Если строка после сохранения ушла из выборки, фокус переходит на кнопку строки, занявшей её место, а если строк нет — на заголовок «Журнал» (как в плане 5c).
3. **Полоса действий** лежит поверх строки заголовков; заголовки остаются в DOM, их кнопки получают `tabindex="-1"`, пока полоса видна. Подтверждение удаления остаётся в полосе, как сейчас («как сейчас» в §5.5). Общий чекбокс — кнопка `role="checkbox"` с `aria-checked="mixed"` и именем «Снять выделение»; после неё фокус — на флажке «Выбрать все загруженные операции».
4. **Итог «Изменить данные»:** «Категория: изменено 2, пропущено 2. Проект: изменено 3, пропущено 1»; если полей несколько, причины пропуска подписаны полем: «Категория: Разбитая операция — измените её в форме — 1». Сбой запроса — «Проект: ошибка — {сообщение}», следующие поля — «Контрагент: не выполнено». После «Сохранить» окно закрывается сразу, фокус — на «Изменить данные» (она `aria-disabled`, пока идут запросы).
5. **`MultiSelectField`** — панель с поиском и обычными флажками, а не `PickerList`: `PickerList` — список одного выбора (`listbox` с `aria-activedescendant`), для множественного выбора флажки проще и привычнее программам чтения. Esc закрывает только панель, окно остаётся.
6. **«Недоступный элемент»** — id из адреса, которого нет в справочниках (удалён или из другой компании). Архивный выбранный элемент по-прежнему показывается с пометкой «(архив)».
7. **Панель справа на телефоне** называется «Период и условия», чтобы не совпадать с окном «Фильтры»; саму панель заменит план 1.5-5 (§8.5).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: «Отменить» после удаления, подсветку выделенных строк, фильтр в адресе страницы. **Мёртвых кнопок нет.**
- **«Указать» (§5.4):** нажатие на плашку открывает окно по центру, ширина 480 px; заголовок «Редактирование контрагента», «Редактирование категории» или «Редактирование проекта», «×» справа; одно поле — тот же комбобокс, что в форме; подпись: у контрагента — по категории операции (§6.4), без системной категории — «Мой контрагент»; «Категория»; «Проект». Категории — только вида операции, контрагенты подходящего типа первыми. «Сохранить» на всю ширину, неактивна, пока ничего не выбрано. По «Сохранить» окно закрывается, значение применяется оптимистично через ту же мутацию с `version`; при 409 — откат и сообщение «Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.»; фокус — на кнопку даты в той же строке. Esc и «×» закрывают окно без изменений, вопроса нет. Тоста «Указано — Отменить» нет.
- **Полоса действий (§5.5):** пока есть выделение — на месте строки заголовков, акцентным цветом. Слева: общий чекбокс в состоянии «−» (`aria-checked="mixed"`, имя «Снять выделение»), «✎ Изменить данные», «🗑 Удалить» — с подтверждением, пропусками архивных и тостом «Удалено N — Отменить» на 10 с, как сейчас. Быстрых списков «Категория / Проект / Контрагент» и ссылки «Снять выделение» нет. Справа — итог выделения: по каждому типу в порядке Доход, Расход, Перевод, части через « · »: «Доход • 2 платежа • 45 666 ₸ · Расход • 1 платёж • 8 000 ₸»; сумма — Σ `baseAmount` в базовой валюте компании, формат журнала (§2.2); склонение «платёж / платежа / платежей» — `pluralRu`; итог в `aria-live="polite"`. Окно «Изменить данные»: заголовок «Изменить данные», подзаголовок «Выбрано: N»; три необязательных комбобокса «Контрагент», «Категория» (обоих видов в группах «Доходы» и «Расходы»), «Проект»; «Сохранить» неактивна, пока ничего не выбрано; по очереди `POST …/bulk` — `setCategory`, `setProject`, `setCounterparty`, только для заполненных полей; одно сообщение по каждому полю; если упал запрос, следующие не выполняются, и это видно в итоге. Правила выделения прежние: до 500 строк, только загруженные, смена фильтра снимает выделение.
- **Окно «Фильтры» (§5.6):** заголовок «Фильтры», «×» в углу закрывает без применения, «Отмены» нет. Поля — выпадающие мультивыборы: внутри поиск и флажки; подпись со счётчиком «Проекты (1)»; значение «Все проекты» или названия через запятую с обрезкой. Порядок, две колонки: строка 1 — «Типы платежей и категории» на всю ширину; строка 2 — «Контрагенты» | «Проекты»; строка 3 — «Теги» | «Счета». «Типы платежей и категории»: группы «Тип» (Доход, Расход, Перевод), «Категории дохода» и «Категории расхода» деревом, «Без категории»; в адресе `type` и `category`/`noCategory` раздельно, как раньше. «Без контрагента» и «Без проекта» — первыми пунктами своих списков. Кнопки: «Готово» (главная, слева), «Очистить» (текстовая), «Сохранить фильтр» (справа). Неизвестный id из адреса — пункт «Недоступный элемент» с флажком, его можно снять.
- **Доступность (§11):** `Modal` — фокус при закрытии на открывшую кнопку, если её нет — на `h1`; Tab по кругу; «×» в DOM после заголовка, начальный фокус не на ней. `Popover` — правила R2 плана 5b; внутри модального окна панель рисуется в самом `<dialog>`. `BulkBar` — общий чекбокс `aria-checked="mixed"`, итог в `aria-live="polite"`, после «Удалить» фокус на «Отменить» (как сейчас).
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN)` (₸ после суммы, копейки только ненулевые).
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true` или регулярное выражение с `^`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя тест возвращает в `finally`; без фиксированных пауз. Пока панель мультивыбора открыта, она может перекрывать кнопки окна: перед «Готово» и «Сохранить фильтр» тесты закрывают её Esc.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **«Указать» в строке, которая после сохранения уходит из выборки** (фильтр «Без категории»): фокус не теряется — на кнопке строки, занявшей её место, а если строк не осталось — на заголовке. Тест — задача 1 (e2e).
2. **Esc и «×» в окне «Указать», когда значение уже выбрано в списке, но не сохранено:** операция не меняется, запроса нет, фокус — на плашке. Тест — задача 1 (e2e).
3. **«Изменить данные», когда второй запрос падает:** третий не выполняется, итог показывает выполненное, ошибку и невыполненное. Тест — задача 2 (unit).
4. **Итог выделения со смешанными типами и счётом не в базовой валюте:** суммы — по `baseAmount` в базовой валюте, склонения 1/2/5/21, копейки только ненулевые, пустое выделение — пусто. Тест — задача 2 (unit).
5. **Неизвестный id в адресе** (`?project=999999`): в окне — «Недоступный элемент» отмечен; снятый флажок убирает условие из адреса. Тесты — задача 3 (unit и e2e).
6. **«Снять выделение»:** полоса исчезает вместе с фокусом — он переходит на флажок «Выбрать все загруженные операции», а не на `<body>`. Тест — задача 2 (e2e).

---

## Карта файлов

```
src/client/components/Modal.tsx                     # returnFocus
src/client/lib/journal-assign.ts                    # AssignData, заголовки, assignLabel, assignOptions
src/client/components/journal/AssignDialog.tsx      # (новый) AssignChip, AssignDialog, rowOpenButton
src/client/components/journal/AssignPicker.tsx      # (удаляется)
src/client/lib/journal-bulk.ts                      # selectionTotals, bulkEditActions, bulkEditSummary
src/client/components/journal/BulkEditDialog.tsx    # (новый) «Изменить данные»
src/client/components/journal/BulkBar.tsx           # полоса действий §5.5
src/client/components/journal/JournalTable.tsx      # bulkBar поверх строки заголовков
src/client/components/icons.tsx                     # карандаш, корзина
src/client/lib/journal-filter-dialog.ts             # (новый) варианты, выбранное, переключение полей окна «Фильтры»
src/client/components/MultiSelectField.tsx          # (новый)
src/client/components/journal/FilterDialog.tsx      # окно «Фильтры» §5.6
src/client/components/journal/JournalToolbar.tsx    # панель телефона «Период и условия»
src/client/pages/JournalPage.tsx
scripts/ux-shots.ts                                 # сценарии 03 и 18
tests/client/journal-assign.test.ts, journal-bulk.test.ts, journal-filter-dialog.test.ts (новый)
e2e/journal.spec.ts, journal-actions.spec.ts, mobile.spec.ts, dialogs.spec.ts
```

---

### Task 1: «Указать» — окно «Редактирование …» с одним списком и «Сохранить»

**Files:**
- Create: `src/client/components/journal/AssignDialog.tsx`
- Delete: `src/client/components/journal/AssignPicker.tsx`
- Modify: `src/client/components/Modal.tsx`, `src/client/lib/journal-assign.ts`, `src/client/components/journal/BulkBar.tsx`, `src/client/pages/JournalPage.tsx`, `tests/client/journal-assign.test.ts`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `ComboSelect` (`components/operation/ComboSelect.tsx`: `label`, `listLabel`, `value`, `options`, `emptyLabel`, `placeholder`, `onChange`); `categoryOptions`, `counterpartyOptions`, `preferredCounterpartyType`, `projectOptions` (`lib/operation-options.ts`); `COUNTERPARTY_TYPE_SINGULAR` (`shared/counterparties.ts`); `useAssign` (`lib/journal-mutations.ts`); кнопка строки `[data-row-open]` (план 1.5-2a).
- Produces:
  - `Modal` — новое свойство `returnFocus?: () => HTMLElement | null`;
  - `interface AssignData { categories: CategoryTree; projects: Project[]; counterparties: Counterparty[] }`, `ASSIGN_TITLES`, `ASSIGN_LIST_LABELS`, `assignLabel(item: AssignTarget, field: AssignField, tree: CategoryTree): string`, `assignOptions(item: AssignTarget, field: AssignField, data: AssignData): PickerOption[]` (`lib/journal-assign.ts`);
  - `interface AssignRequest { item: JournalItem; field: AssignField }`, `rowOpenButton(id: number): HTMLElement | null`, `AssignChip(props: { field: AssignField; onClick: () => void })`, `AssignDialog(props: { request: AssignRequest | null; data: AssignData; onSave: (request: AssignRequest, id: number) => void; onClose: () => void })` (`components/journal/AssignDialog.tsx`).

- [ ] **Step 1: Write the failing unit tests**

В `tests/client/journal-assign.test.ts`:

1) Импорты

```ts
import { ApiError } from '../../src/client/lib/api';
import { assignPatch, canAssign, withAssigned, type AssignTarget } from '../../src/client/lib/journal-assign';
```

замените на

```ts
import { ApiError } from '../../src/client/lib/api';
import { ASSIGN_TITLES, assignLabel, assignOptions, assignPatch, canAssign, withAssigned, type AssignData, type AssignTarget } from '../../src/client/lib/journal-assign';
import type { CategoryNode, Counterparty, Project } from '../../src/client/lib/queries';
```

2) Перед `describe('«Указать»: кэш и мутации', …)` вставьте:

```ts
describe('окно «Указать» (§5.4 этапа 1.5)', () => {
  const ARCH = '2026-10-01T00:00:00.000Z';
  const node = (id: number, name: string, patch: Partial<CategoryNode> = {}): CategoryNode => ({
    id,
    companyId: 1,
    kind: 'expense',
    parentId: null,
    name,
    systemKey: null,
    effectiveSystemKey: null,
    templateRef: null,
    orderIndex: 0,
    archivedAt: null,
    children: [],
    ...patch,
  });
  const cp = (id: number, name: string, type: Counterparty['type'], archivedAt: string | null = null): Counterparty => ({
    id,
    companyId: 1,
    type,
    name,
    comment: null,
    orderIndex: id,
    createdAt: ARCH,
    archivedAt,
  });
  const project = (id: number, name: string, archivedAt: string | null = null): Project => ({
    id,
    companyId: 1,
    name,
    templateKey: 'general',
    templateParams: {},
    orderIndex: id,
    createdAt: ARCH,
    archivedAt,
  });
  const data: AssignData = {
    categories: {
      income: [node(1, 'Выручка', { kind: 'income' })],
      expense: [
        node(10, 'Зарплата', {
          systemKey: 'salary',
          effectiveSystemKey: 'salary',
          children: [node(11, 'Администраторы', { parentId: 10, effectiveSystemKey: 'salary' })],
        }),
        node(20, 'Аренда'),
        node(30, 'Старая', { archivedAt: ARCH }),
      ],
    },
    projects: [project(5, 'Клуб 1'), project(6, 'Закрытый', ARCH)],
    counterparties: [cp(7, 'ИП Клиент', 'client'), cp(8, 'Алина', 'employee'), cp(9, 'Уволен', 'employee', ARCH)],
  };

  it('заголовки окна; подпись поля контрагента — по системной категории операции, иначе «Мой контрагент»', () => {
    expect(ASSIGN_TITLES).toEqual({
      counterparty: 'Редактирование контрагента',
      category: 'Редактирование категории',
      project: 'Редактирование проекта',
    });
    expect(assignLabel(op({ lines: [line(10, null)] }), 'counterparty', data.categories)).toBe('Сотрудник');
    expect(assignLabel(op({ lines: [line(11, null)] }), 'counterparty', data.categories)).toBe('Сотрудник');
    expect(assignLabel(op({ lines: [line(20, null)] }), 'counterparty', data.categories)).toBe('Мой контрагент');
    expect(assignLabel(op({}), 'counterparty', data.categories)).toBe('Мой контрагент');
    expect(assignLabel(op({}), 'category', data.categories)).toBe('Категория');
    expect(assignLabel(op({}), 'project', data.categories)).toBe('Проект');
  });

  it('варианты: без архивных; категории только вида операции; контрагенты подходящего типа — первыми, как в форме', () => {
    expect(assignOptions(op({}), 'category', data).map((o) => o.label)).toEqual(['Зарплата', 'Зарплата → Администраторы', 'Аренда']);
    expect(assignOptions(op({ type: 'income' }), 'category', data).map((o) => o.label)).toEqual(['Выручка']);
    expect(assignOptions(op({ type: 'transfer', lines: [] }), 'category', data)).toEqual([]);
    expect(assignOptions(op({}), 'project', data).map((o) => o.label)).toEqual(['Клуб 1']);
    expect(assignOptions(op({ lines: [line(10, null)] }), 'counterparty', data)).toEqual([
      { id: 8, label: 'Алина', section: 'Сотрудники' },
      { id: 7, label: 'ИП Клиент', section: 'Остальные' },
    ]);
    expect(assignOptions(op({}), 'counterparty', data)).toEqual([
      { id: 7, label: 'ИП Клиент' },
      { id: 8, label: 'Алина' },
    ]);
  });
});
```

Run: `npx vitest run tests/client/journal-assign.test.ts` → FAIL (`ASSIGN_TITLES`, `assignLabel`, `assignOptions`, `AssignData` не экспортируются).

- [ ] **Step 2: Implement in `lib/journal-assign.ts`**

1) Первую строку `import type { JournalItem } from './queries';` замените на:

```ts
import { COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import type { PickerOption } from '../components/SearchPicker';
import { categoryOptions, counterpartyOptions, preferredCounterpartyType, projectOptions } from './operation-options';
import type { CategoryTree, Counterparty, JournalItem, Project } from './queries';
```

2) В конец файла добавьте:

```ts
/** Справочники для «Указать» и «Изменить данные». */
export interface AssignData {
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
}

/** Заголовок окна «Указать» (§5.4 этапа 1.5). */
export const ASSIGN_TITLES: Record<AssignField, string> = {
  counterparty: 'Редактирование контрагента',
  category: 'Редактирование категории',
  project: 'Редактирование проекта',
};

/** Название списка для программ чтения с экрана. */
export const ASSIGN_LIST_LABELS: Record<AssignField, string> = {
  counterparty: 'Контрагенты',
  category: 'Категории',
  project: 'Проекты',
};

/** Категория операции с одной строкой — по ней подбирается тип контрагента (§6.4); у разбитой и без строк — null. */
function singleCategory(item: Pick<AssignTarget, 'lines'>): number | null {
  return item.lines.length === 1 ? item.lines[0]!.categoryId : null;
}

/** Подпись поля в окне «Указать»: у контрагента — по системной категории операции («Сотрудник»), иначе «Мой контрагент». */
export function assignLabel(item: AssignTarget, field: AssignField, tree: CategoryTree): string {
  if (field === 'category') return 'Категория';
  if (field === 'project') return 'Проект';
  const preferred = preferredCounterpartyType(tree, singleCategory(item));
  return preferred ? COUNTERPARTY_TYPE_SINGULAR[preferred] : 'Мой контрагент';
}

/**
 * Варианты списка «Указать» — те же правила, что в форме операции: архивные не предлагаются (инвариант 7),
 * категории — только вида операции (инвариант 3), контрагенты подходящего типа — первыми.
 */
export function assignOptions(item: AssignTarget, field: AssignField, data: AssignData): PickerOption[] {
  if (field === 'counterparty') return counterpartyOptions(data.counterparties, null, preferredCounterpartyType(data.categories, singleCategory(item)));
  if (field === 'project') return projectOptions(data.projects, []);
  return item.type === 'transfer' ? [] : categoryOptions(data.categories, item.type, []);
}
```

Run: `npx vitest run tests/client/journal-assign.test.ts` → PASS.

- [ ] **Step 3: `Modal.returnFocus`**

В `src/client/components/Modal.tsx`:

1) В тип свойств после строки `  phoneFullScreen?: boolean;` вставьте:

```ts
  /**
   * Куда вернуть фокус после закрытия вместо кнопки, с которой открыли окно (после «Указать» — на кнопку строки:
   * плашки уже нет). Вызывается при закрытии; null или элемент не на странице — обычное правило.
   */
  returnFocus?: () => HTMLElement | null;
```

2) В обработчике `onClose` строки

```ts
        props.onClose();
        // кнопки, с которой открыли окно, уже нет (строку журнала удалили) или она не принимает фокус — фокус на заголовок страницы
        const back = opener.current;
```

замените на

```ts
        props.onClose();
        const preferred = props.returnFocus?.() ?? null;
        // кнопки, с которой открыли окно, уже нет (строку журнала удалили) или она не принимает фокус — фокус на заголовок страницы
        const back = preferred?.isConnected ? preferred : opener.current;
```

- [ ] **Step 4: `AssignDialog`; the old picker goes**

Run: `git rm src/client/components/journal/AssignPicker.tsx`

`src/client/components/journal/AssignDialog.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSIGN_LABELS, ASSIGN_LIST_LABELS, ASSIGN_TITLES, assignLabel, assignOptions, type AssignData, type AssignField } from '../../lib/journal-assign';
import type { JournalItem } from '../../lib/queries';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { btnPrimary } from '../ui';

export interface AssignRequest {
  item: JournalItem;
  field: AssignField;
}

/** Кнопка открытия операции в строке журнала (ячейка даты, `data-row-open`), если строка на странице. */
export function rowOpenButton(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`tr[data-operation-id="${id}"] [data-row-open]`);
}

/** Плашка «Указать» в пустой ячейке (§5.2, §5.4 этапа 1.5): видна всегда, открывает окно «Редактирование …». */
export function AssignChip(props: { field: AssignField; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={ASSIGN_LABELS[props.field]}
      onClick={props.onClick}
      className="rounded-md bg-income-soft px-2 py-0.5 text-xs font-medium text-income-strong hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
    >
      Указать
    </button>
  );
}

function AssignForm(props: { request: AssignRequest; data: AssignData; onSave: (id: number) => void }) {
  const { item, field } = props.request;
  const [value, setValue] = useState<number | null>(null);
  // список строится один раз на окно, а не на каждую перерисовку журнала
  const options = useMemo(() => assignOptions(item, field, props.data), [item, field, props.data]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value !== null) props.onSave(value);
      }}
    >
      <ComboSelect
        label={assignLabel(item, field, props.data.categories)}
        listLabel={ASSIGN_LIST_LABELS[field]}
        value={value}
        options={options}
        emptyLabel={null}
        placeholder="Выберите"
        onChange={setValue}
      />
      <button type="submit" disabled={value === null} className={`${btnPrimary} mt-6 w-full py-3`}>
        Сохранить
      </button>
    </form>
  );
}

/**
 * «Указать» (§5.4 этапа 1.5): окно по центру, 480 px — «Редактирование контрагента / категории / проекта», одно поле
 * со списком (тот же комбобокс, что в форме) и «Сохранить», недоступная, пока ничего не выбрано. По «Сохранить» окно
 * закрывается, значение применяет владелец (оптимистично, с version); фокус — на кнопку открытия операции в той же
 * строке: плашки уже нет. Esc и «×» закрывают без изменений, фокус — на плашке.
 */
export function AssignDialog(props: { request: AssignRequest | null; data: AssignData; onSave: (request: AssignRequest, id: number) => void; onClose: () => void }) {
  // заголовок нужен и в кадре закрытия, когда запроса уже нет
  const [title, setTitle] = useState('');
  // строка, где сохранили: туда возвращается фокус; Esc и «×» — null (фокус на плашку)
  const savedId = useRef<number | null>(null);
  useEffect(() => {
    if (!props.request) return;
    setTitle(ASSIGN_TITLES[props.request.field]);
    savedId.current = null;
  }, [props.request]);
  return (
    <Modal
      open={props.request !== null}
      title={props.request ? ASSIGN_TITLES[props.request.field] : title}
      onClose={props.onClose}
      className="max-w-[480px]"
      returnFocus={() => (savedId.current === null ? null : rowOpenButton(savedId.current))}
    >
      {props.request && (
        <AssignForm
          key={`${props.request.item.id}-${props.request.field}`}
          request={props.request}
          data={props.data}
          onSave={(id) => {
            const request = props.request!;
            savedId.current = request.item.id;
            props.onSave(request, id);
          }}
        />
      )}
    </Modal>
  );
}
```

`src/client/components/journal/BulkBar.tsx` (пока прежняя, её переделает задача 2) — импорты

```tsx
import { useEffect, useRef, useState } from 'react';
import { BULK_MAX, type BulkAction } from '../../lib/journal-bulk';
import { SearchPicker } from '../SearchPicker';
import { btnDanger, btnSecondary, btnSmall } from '../ui';
import { categoryPickerOptions, type AssignData } from './AssignPicker';
```

замените на

```tsx
import { useEffect, useRef, useState } from 'react';
import type { AssignData } from '../../lib/journal-assign';
import { BULK_MAX, type BulkAction } from '../../lib/journal-bulk';
import { categoryOptions } from '../../lib/operation-options';
import { SearchPicker } from '../SearchPicker';
import { btnDanger, btnSecondary, btnSmall } from '../ui';
```

и строки

```tsx
    ...categoryPickerOptions(props.data.categories.income).map((o) => ({ ...o, label: `Доход: ${o.label}` })),
    ...categoryPickerOptions(props.data.categories.expense).map((o) => ({ ...o, label: `Расход: ${o.label}` })),
```

замените на

```tsx
    ...categoryOptions(props.data.categories, 'income', []).map((o) => ({ ...o, label: `Доход: ${o.label}` })),
    ...categoryOptions(props.data.categories, 'expense', []).map((o) => ({ ...o, label: `Расход: ${o.label}` })),
```

- [ ] **Step 5: The journal page opens the dialog**

В `src/client/pages/JournalPage.tsx`:

1) `import { AssignPicker } from '../components/journal/AssignPicker';` → `import { AssignChip, AssignDialog, rowOpenButton, type AssignRequest } from '../components/journal/AssignDialog';`

2) Функцию

```tsx
/** Фокус на строку операции (у строки tabIndex=-1 и data-operation-id). */
function focusRow(id: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`tr[data-operation-id="${id}"]`)?.focus());
}
```

замените на

```tsx
/** Фокус на кнопку открытия операции в строке (ячейка даты). */
function focusRowOpen(id: number): void {
  requestAnimationFrame(() => rowOpenButton(id)?.focus());
}
```

3) В эффекте «назначенная строка ушла из выборки…» строку `    if (next !== undefined) focusRow(next);` замените на `    if (next !== undefined) focusRowOpen(next);`, а комментарий над эффектом — на `// назначенная строка ушла из выборки («Без категории»), и фокус остался на <body>: на кнопку строки, занявшей её место, или на заголовок`.

4) После строки `  const assign = useAssign(company.id, setActionError);` вставьте:

```tsx
  // «Указать» (§5.4): окно открыто для этой строки и поля
  const [assignRequest, setAssignRequest] = useState<AssignRequest | null>(null);
```

5) Комментарий `  // один объект между перерисовками: от него зависят списки «Указать» (AssignPicker)` замените на `  // один объект между перерисовками: от него зависят списки окон «Указать» и «Изменить данные»`.

6) Блок

```tsx
          renderAssign={
            readOnly
              ? undefined
              : (item, field) => (
                  <AssignPicker
                    item={item}
                    field={field}
                    data={assignData}
                    onPick={(id) => {
                      setActionError(null);
                      assign.mutate({ item, field, id });
                      // кнопка «Указать» исчезает вместе с пустой ячейкой — фокус на строку операции
                      focusRow(item.id);
                      assigned.current = { id: item.id, index: items.findIndex((i) => i.id === item.id) };
                    }}
                  />
                )
          }
```

замените на

```tsx
          renderAssign={readOnly ? undefined : (item, field) => <AssignChip field={field} onClick={() => setAssignRequest({ item, field })} />}
```

7) После закрывающего `/>` компонента `<FilterDialog … />` вставьте:

```tsx
      {!readOnly && (
        <AssignDialog
          request={assignRequest}
          data={assignData}
          onClose={() => setAssignRequest(null)}
          onSave={({ item, field }, id) => {
            setAssignRequest(null);
            setActionError(null);
            assign.mutate({ item, field, id });
            // строка может уйти из выборки («Без категории»): эффект выше переведёт фокус на соседнюю
            assigned.current = { id: item.id, index: items.findIndex((i) => i.id === item.id) };
          }}
        />
      )}
```

Run: `npm run typecheck` → без ошибок. Run: `npm test` → PASS.

- [ ] **Step 6: Update e2e — `journal-actions.spec.ts`**

1) Первая строка: `import { expect, test, type Page } from '@playwright/test';` → `import { expect, test, type Locator, type Page } from '@playwright/test';`

2) После помощника `choosePeriod` вставьте:

```ts
/** «Указать» через окно (§5.4 этапа 1.5): плашка → поле со списком → пункт → «Сохранить». */
async function assignVia(page: Page, row: Locator, chip: string, list: string, option: string) {
  await row.getByRole('button', { name: chip }).click();
  const dialog = page.getByRole('dialog', { name: /^Редактирование/ });
  await expect(dialog).toBeVisible();
  await dialog.locator('button[aria-haspopup="dialog"]').click();
  await page.getByRole('listbox', { name: list }).getByRole('option', { name: option, exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
}
```

3) Тест `test('«Указать»: список с поиском и клавиатурой, значение сохраняется сразу; конфликт версии — откат и сообщение', …)` замените целиком:

```ts
test('«Указать»: окно «Редактирование …» с одним списком и «Сохранить»; Esc и «×» ничего не меняют; конфликт версии — откат и сообщение', async ({ page }) => {
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
  const openButton = (letter: string) => row(letter).getByRole('button', { name: /^Открыть операцию/ });

  // где есть «Указать»: доход — все три поля; разбитая операция — нигде; перевод — только проект
  await expect(row('A').getByRole('button', { name: /^Указать/ })).toHaveCount(3);
  await expect(row('B').getByRole('button', { name: /^Указать/ })).toHaveCount(0);
  await expect(row('C').getByRole('button', { name: /^Указать/ })).toHaveCount(1);
  await expect(row('C').getByRole('button', { name: 'Указать проект' })).toBeVisible();

  // категория с клавиатуры: окно с одним полем, фокус на нём; «Сохранить» недоступна, пока ничего не выбрано
  await row('A').getByRole('button', { name: 'Указать категорию' }).click();
  const categoryDialog = page.getByRole('dialog', { name: 'Редактирование категории' });
  await expect(categoryDialog).toBeVisible();
  const save = categoryDialog.getByRole('button', { name: 'Сохранить' });
  await expect(save).toBeDisabled();
  const categoryField = categoryDialog.getByRole('button', { name: /^Категория:/ });
  await expect(categoryField).toBeFocused();
  await page.keyboard.press('Enter');
  const search = page.getByRole('combobox', { name: 'Категории: поиск' });
  await expect(search).toBeFocused();
  // доход видит только доходные категории
  const categoryOptions = page.getByRole('listbox', { name: 'Категории' }).getByRole('option');
  await expect(categoryOptions).toHaveText(['Инвестиции', 'Возврат займа', 'Получение кредита', 'Бар', 'Игровое время']);
  await search.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await search.press('Enter');
  await expect(categoryField).toHaveAccessibleName('Категория: Бар');
  await expect(categoryField).toBeFocused();
  // до «Сохранить» операция не меняется
  await expect(row('A').getByRole('button', { name: 'Указать категорию' })).toHaveCount(1);
  await save.click();
  await expect(categoryDialog).toBeHidden();
  await expect(row('A')).toContainText('Бар');
  await expect(row('A').getByRole('button', { name: 'Указать категорию' })).toHaveCount(0);
  // плашки больше нет — фокус на кнопке открытия операции в той же строке
  await expect(openButton('A')).toBeFocused();

  // Esc и «×» закрывают окно без изменений, даже если пункт уже выбран; фокус — на плашке (Review Focus 2)
  const projectChip = row('A').getByRole('button', { name: 'Указать проект' });
  const projectDialog = page.getByRole('dialog', { name: 'Редактирование проекта' });
  await projectChip.click();
  await expect(projectDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(projectDialog).toBeHidden();
  await expect(projectChip).toBeFocused();
  let patches = 0;
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches += 1;
  });
  await projectChip.click();
  await projectDialog.getByRole('button', { name: /^Проект:/ }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
  await expect(projectDialog.getByRole('button', { name: /^Проект:/ })).toHaveAccessibleName('Проект: Клуб 1');
  await projectDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(projectDialog).toBeHidden();
  await expect(projectChip).toBeFocused();
  await expect(row('A')).not.toContainText('Клуб 1');
  expect(patches).toBe(0);

  // проект переводу без строк — мышью
  await row('C').getByRole('button', { name: 'Указать проект' }).click();
  // журнал перечитывается после сохранения — дождёмся его, чтобы правка «в другом окне» ниже пришла позже
  const reloaded = page.waitForResponse((r) => r.url().includes(`/companies/${cid}/operations?`) && r.request().method() === 'GET');
  await projectDialog.getByRole('button', { name: /^Проект:/ }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
  await projectDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row('C')).toContainText('Клуб 1');
  await reloaded;
  await expect(openButton('C')).toBeFocused();

  // контрагент: подпись поля — «Мой контрагент» (у операции нет системной категории).
  // Конфликт: операцию изменили в другом окне — значение откатывается, сообщение о конфликте, журнал обновлён
  const patched = await page.request.patch(`${base}/operations/${income.id}`, { data: { version: 2, comment: 'операция A изменена' }, headers: csrf(page) });
  expect(patched.status(), await patched.text()).toBe(200);
  const counterpartyDialog = page.getByRole('dialog', { name: 'Редактирование контрагента' });
  const pickClient = async () => {
    await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
    await counterpartyDialog.getByRole('button', { name: /^Мой контрагент:/ }).click();
    await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
    await counterpartyDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(counterpartyDialog).toBeHidden();
  };
  await pickClient();
  await expect(page.getByRole('alert')).toContainText('Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.');
  await expect(row('A')).toContainText('операция A изменена');
  await expect(row('A').getByRole('button', { name: 'Указать контрагента' })).toBeVisible();
  // повтор с новой версией проходит; после перезагрузки значения на месте
  await pickClient();
  await expect(row('A')).toContainText('ИП Клиент');
  await page.reload();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Бар');
  await expect(row('C')).toContainText('Клуб 1');
});
```

4) Тест `test('«Указать»: два выбора подряд в одной строке — без ложного конфликта версии; строка ушла из фильтра — фокус на соседней или на заголовке', …)` замените целиком:

```ts
test('«Указать»: два сохранения подряд в одной строке — без ложного конфликта версии; строка ушла из фильтра — фокус на соседней или на заголовке', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  const cid = await createCompany(page, `ТОО Подряд ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await apiPost(page, `${base}/counterparties`, { name: 'ИП Клиент', type: 'client' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });

  // ответ PATCH задержан: второе сохранение уходит, пока первое ещё в пути, — с версией из ответа первого, а не со старой
  const patches: number[] = [];
  const patchUrl = new RegExp(`/api/v1/companies/${cid}/operations/\\d+$`);
  await page.route(patchUrl, async (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push((route.request().postDataJSON() as { version: number }).version);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue().catch(() => undefined);
  });
  await assignVia(page, row('A'), 'Указать контрагента', 'Контрагенты', 'ИП Клиент');
  await assignVia(page, row('A'), 'Указать категорию', 'Категории', 'Аренда');
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Аренда');
  await expect.poll(() => patches).toEqual([1, 2]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute(patchUrl);
  await page.reload();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Аренда');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // «Без категории»: назначенная строка уходит из выборки — фокус на кнопку строки, занявшей её место,
  // а когда строк нет — на заголовок (Review Focus 1)
  await page.goto(`/c/${cid}/log?noCategory=1`);
  await expect.poll(() => letters(page)).toBe('CB');
  await assignVia(page, row('C'), 'Указать категорию', 'Категории', 'Аренда');
  await expect.poll(() => letters(page)).toBe('B');
  await expect(row('B').getByRole('button', { name: /^Открыть операцию/ })).toBeFocused();
  await assignVia(page, row('B'), 'Указать категорию', 'Категории', 'Аренда');
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});
```

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 661 (659 + 2). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal-actions.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src/client/components/Modal.tsx src/client/lib/journal-assign.ts src/client/components/journal src/client/pages/JournalPage.tsx tests/client/journal-assign.test.ts e2e/journal-actions.spec.ts
git commit -m "feat: «Указать» окном, как в Finmap — «Редактирование …», один список и «Сохранить»; фокус на кнопку строки

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Полоса действий на месте заголовков — общий чекбокс, «Изменить данные», итог выделения

**Files:**
- Create: `src/client/components/journal/BulkEditDialog.tsx`
- Modify: `src/client/lib/journal-bulk.ts`, `src/client/components/icons.tsx`, `src/client/components/journal/BulkBar.tsx` (целиком), `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`, `tests/client/journal-bulk.test.ts`, `e2e/journal-actions.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `AssignData` (задача 1); `ComboSelect`; `categoryOptions`, `counterpartyOptions`, `projectOptions` (`lib/operation-options.ts`); `pluralRu` (`lib/journal-format.ts`); `runBulk`, `operationErrorText` (`lib/journal-mutations.ts`); `bulkSummary`, `BulkResult`, `BulkSummary` (`lib/journal-bulk.ts`); флажок `[data-select-all]` (план 1.5-2a).
- Produces:
  - `type BulkEditAction`, `interface BulkEditValues { counterpartyId: number | null; categoryId: number | null; projectId: number | null }`, `bulkEditActions(v: BulkEditValues): BulkEditAction[]`, `bulkEditSummary(done, failed, notRun): BulkSummary`, `selectionTotals(items: readonly { type: OperationType; baseAmount: number }[], baseCurrency: string): string` (`lib/journal-bulk.ts`);
  - `BulkEditDialog(props: { open: boolean; count: number; data: AssignData; onClose: () => void; onSave: (actions: BulkEditAction[]) => void })`;
  - `BulkBar(props: { items: readonly Pick<JournalItem, 'type' | 'baseAmount'>[]; baseCurrency: string; data: AssignData; pending: boolean; onRun: (action: BulkAction) => Promise<void> | void; onEdit: (actions: BulkEditAction[]) => Promise<void> | void; onClear: () => void })`;
  - `JournalTableProps.bulkBar?: ReactNode`;
  - иконки `PencilIcon`, `TrashIcon`.

- [ ] **Step 1: Write the failing unit tests**

В `tests/client/journal-bulk.test.ts` импорт замените на

```ts
import { bulkEditActions, bulkEditSummary, bulkSummary, selectionTotals } from '../../src/client/lib/journal-bulk';
```

и в конец файла добавьте:

```ts
describe('итог выделения (§5.5 этапа 1.5)', () => {
  const op = (type: 'income' | 'expense' | 'transfer', baseAmount: number) => ({ type, baseAmount });
  /** Неразрывные пробелы денег (U+00A0, U+202F) → обычные: так ожидания читаются. */
  const plain = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

  it('по типам в порядке Доход, Расход, Перевод; «платёж / платежа / платежей»; сумма — в базовой валюте; копейки только ненулевые (Review Focus 4)', () => {
    expect(plain(selectionTotals([op('expense', 800000), op('income', 4500000), op('income', 66600)], 'KZT'))).toBe('Доход • 2 платежа • 45 666 ₸ · Расход • 1 платёж • 8 000 ₸');
    expect(plain(selectionTotals([op('transfer', 50000), ...Array.from({ length: 5 }, () => op('expense', 100))], 'KZT'))).toBe('Расход • 5 платежей • 5 ₸ · Перевод • 1 платёж • 500 ₸');
    expect(plain(selectionTotals(Array.from({ length: 21 }, () => op('income', 150050)), 'KZT'))).toBe('Доход • 21 платёж • 31 510,50 ₸');
    // у счёта в долларах baseAmount уже в базовой валюте компании
    expect(plain(selectionTotals([op('income', 150050)], 'USD'))).toBe('Доход • 1 платёж • 1 500,50 $');
    expect(selectionTotals([], 'KZT')).toBe('');
  });
});

describe('«Изменить данные» (§5.5 этапа 1.5)', () => {
  const r = (changed: number[], skipped: { id: number; reason: string }[] = []) => ({ changed, skipped });

  it('только заполненные поля, по очереди: категория, проект, контрагент', () => {
    expect(bulkEditActions({ counterpartyId: 3, categoryId: null, projectId: 5 })).toEqual([
      { action: 'setProject', projectId: 5 },
      { action: 'setCounterparty', counterpartyId: 3 },
    ]);
    expect(bulkEditActions({ counterpartyId: null, categoryId: null, projectId: null })).toEqual([]);
    expect(bulkEditActions({ counterpartyId: 1, categoryId: 2, projectId: 3 }).map((a) => a.action)).toEqual(['setCategory', 'setProject', 'setCounterparty']);
  });

  it('итог — по каждому полю; если полей несколько, причины подписаны полем', () => {
    expect(bulkEditSummary([{ action: 'setCategory', result: r([1, 2], [{ id: 3, reason: 'Разбитая операция — измените её в форме' }]) }], null, [])).toEqual({
      text: 'Категория: изменено 2, пропущено 1',
      reasons: [{ reason: 'Разбитая операция — измените её в форме', count: 1 }],
    });
    expect(
      bulkEditSummary(
        [
          { action: 'setCategory', result: r([1], [{ id: 3, reason: 'Разбитая операция — измените её в форме' }]) },
          { action: 'setProject', result: r([1, 3]) },
        ],
        null,
        [],
      ),
    ).toEqual({
      text: 'Категория: изменено 1, пропущено 1. Проект: изменено 2, пропущено 0',
      reasons: [{ reason: 'Категория: Разбитая операция — измените её в форме', count: 1 }],
    });
  });

  it('упал запрос — следующие не выполняются, это видно в итоге (Review Focus 3)', () => {
    expect(bulkEditSummary([{ action: 'setCategory', result: r([1]) }], { action: 'setProject', message: 'Сбой' }, ['setCounterparty'])).toEqual({
      text: 'Категория: изменено 1, пропущено 0. Проект: ошибка — Сбой. Контрагент: не выполнено',
      reasons: [],
    });
    expect(bulkEditSummary([], { action: 'setCategory', message: 'Нет связи' }, []).text).toBe('Категория: ошибка — Нет связи');
  });
});
```

Run: `npx vitest run tests/client/journal-bulk.test.ts` → FAIL (новых функций нет).

- [ ] **Step 2: Implement in `lib/journal-bulk.ts`**

В начало файла вставьте импорты:

```ts
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { OperationType } from './journal-filter';
import { pluralRu } from './journal-format';
```

и в конец файла:

```ts
/** «Изменить данные» (§5.5 этапа 1.5): действия, которые назначают значение. */
export type BulkEditAction = Extract<BulkAction, { action: 'setCategory' | 'setProject' | 'setCounterparty' }>;

/** Поля окна «Изменить данные»; null — «Не менять». */
export interface BulkEditValues {
  counterpartyId: number | null;
  categoryId: number | null;
  projectId: number | null;
}

/** Действия для заполненных полей в порядке выполнения (§5.5): категория, проект, контрагент. */
export function bulkEditActions(v: BulkEditValues): BulkEditAction[] {
  const actions: BulkEditAction[] = [];
  if (v.categoryId !== null) actions.push({ action: 'setCategory', categoryId: v.categoryId });
  if (v.projectId !== null) actions.push({ action: 'setProject', projectId: v.projectId });
  if (v.counterpartyId !== null) actions.push({ action: 'setCounterparty', counterpartyId: v.counterpartyId });
  return actions;
}

/**
 * Итог «Изменить данные» (§5.5): по каждому полю — «Категория: изменено N, пропущено M»; если полей несколько,
 * причины пропуска подписаны полем. Сбой — «Проект: ошибка — …», поля после него — «Контрагент: не выполнено».
 */
export function bulkEditSummary(
  done: readonly { action: BulkEditAction['action']; result: BulkResult }[],
  failed: { action: BulkEditAction['action']; message: string } | null,
  notRun: readonly BulkEditAction['action'][],
): BulkSummary {
  const several = done.length + (failed ? 1 : 0) + notRun.length > 1;
  const parts = done.map((d) => ({ action: d.action, summary: bulkSummary(d.action, d.result) }));
  return {
    text: [
      ...parts.map((p) => p.summary.text),
      ...(failed ? [`${TITLES[failed.action]}: ошибка — ${failed.message}`] : []),
      ...notRun.map((a) => `${TITLES[a]}: не выполнено`),
    ].join('. '),
    reasons: parts.flatMap((p) => p.summary.reasons.map((r) => (several ? { reason: `${TITLES[p.action]}: ${r.reason}`, count: r.count } : r))),
  };
}

const TYPE_TITLES: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

/**
 * Итог выделения в полосе действий (§5.5 этапа 1.5): по каждому типу в порядке Доход, Расход, Перевод —
 * «Доход • 2 платежа • 45 666 ₸», части через « · »; сумма — Σ baseAmount в базовой валюте компании.
 */
export function selectionTotals(items: readonly { type: OperationType; baseAmount: number }[], baseCurrency: string): string {
  return (['income', 'expense', 'transfer'] as const)
    .flatMap((type) => {
      const ofType = items.filter((i) => i.type === type);
      if (ofType.length === 0) return [];
      const sum = ofType.reduce((s, i) => s + i.baseAmount, 0);
      return [`${TYPE_TITLES[type]} • ${ofType.length} ${pluralRu(ofType.length, 'платёж', 'платежа', 'платежей')} • ${formatMoney(sum, baseCurrency, MONEY_SCREEN)}`];
    })
    .join(' · ');
}
```

Run: `npx vitest run tests/client/journal-bulk.test.ts` → PASS.

- [ ] **Step 3: Icons and the «Изменить данные» dialog**

В конец `src/client/components/icons.tsx`:

```tsx
export function PencilIcon() {
  return (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
  );
}
```

`src/client/components/journal/BulkEditDialog.tsx`:

```tsx
import { useState } from 'react';
import type { AssignData } from '../../lib/journal-assign';
import { bulkEditActions, type BulkEditAction, type BulkEditValues } from '../../lib/journal-bulk';
import { categoryOptions, counterpartyOptions, projectOptions } from '../../lib/operation-options';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { btnPrimary } from '../ui';

const NOTHING: BulkEditValues = { counterpartyId: null, categoryId: null, projectId: null };

function BulkEditForm(props: { count: number; data: AssignData; onSave: (actions: BulkEditAction[]) => void }) {
  const [values, setValues] = useState<BulkEditValues>(NOTHING);
  const actions = bulkEditActions(values);
  const set = (key: keyof BulkEditValues) => (id: number | null) => setValues((v) => ({ ...v, [key]: id }));
  // категории обоих видов — группами: каждой операции подойдёт категория её вида, остальные сервер пропустит
  const categories = [
    ...categoryOptions(props.data.categories, 'income', []).map((o) => ({ ...o, section: 'Доходы' })),
    ...categoryOptions(props.data.categories, 'expense', []).map((o) => ({ ...o, section: 'Расходы' })),
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (actions.length > 0) props.onSave(actions);
      }}
      className="flex flex-col gap-4"
    >
      <p className="-mt-2 text-sm text-muted">Выбрано: {props.count}</p>
      <ComboSelect
        label="Контрагент"
        listLabel="Контрагенты"
        value={values.counterpartyId}
        options={counterpartyOptions(props.data.counterparties, null, null)}
        emptyLabel="Не менять"
        onChange={set('counterpartyId')}
      />
      <ComboSelect label="Категория" listLabel="Категории" value={values.categoryId} options={categories} emptyLabel="Не менять" onChange={set('categoryId')} />
      <ComboSelect label="Проект" listLabel="Проекты" value={values.projectId} options={projectOptions(props.data.projects, [])} emptyLabel="Не менять" onChange={set('projectId')} />
      <p className="text-xs text-muted">Меняются только заполненные поля. Разбитые операции и переводы, которым поле не подходит, пропускаются — итог покажет причины.</p>
      <button type="submit" disabled={actions.length === 0} className={`${btnPrimary} w-full py-3`}>
        Сохранить
      </button>
    </form>
  );
}

/**
 * «Изменить данные» (§5.5 этапа 1.5): три необязательных поля — «Контрагент», «Категория» (доходы и расходы
 * группами), «Проект»; «Сохранить» недоступна, пока ничего не выбрано. По «Сохранить» окно закрывается сразу,
 * действия выполняет владелец.
 */
export function BulkEditDialog(props: { open: boolean; count: number; data: AssignData; onClose: () => void; onSave: (actions: BulkEditAction[]) => void }) {
  return (
    <Modal open={props.open} title="Изменить данные" onClose={props.onClose} className="max-w-[480px]">
      <BulkEditForm count={props.count} data={props.data} onSave={props.onSave} />
    </Modal>
  );
}
```

- [ ] **Step 4: The bar**

Замените `src/client/components/journal/BulkBar.tsx` целиком:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { AssignData } from '../../lib/journal-assign';
import { BULK_MAX, selectionTotals, type BulkAction, type BulkEditAction } from '../../lib/journal-bulk';
import type { JournalItem } from '../../lib/queries';
import { PencilIcon, TrashIcon } from '../icons';
import { BulkEditDialog } from './BulkEditDialog';

const barButton =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60 aria-disabled:opacity-60';

/**
 * Полоса массовых действий (§5.5 этапа 1.5): пока есть выделение, лежит на месте строки заголовков таблицы,
 * акцентным цветом. Слева — общий чекбокс со знаком минус (снимает выделение), «Изменить данные» (окно с тремя полями)
 * и «Удалить» с подтверждением в полосе; справа — итог выделения по типам в базовой валюте (aria-live).
 * Не больше BULK_MAX операций за раз. Пока действие выполняется, «Изменить данные» только помечена недоступной
 * (aria-disabled): фокус, вернувшийся на неё после окна, не теряется.
 */
export function BulkBar(props: {
  /** Выбранные загруженные операции — для итога. */
  items: readonly Pick<JournalItem, 'type' | 'baseAmount'>[];
  baseCurrency: string;
  data: AssignData;
  pending: boolean;
  onRun: (action: BulkAction) => Promise<void> | void;
  onEdit: (actions: BulkEditAction[]) => Promise<void> | void;
  onClear: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // «Отмена» убирает сфокусированную кнопку: фокус возвращается на «Удалить», как только она снова на месте
  const refocusDelete = useRef(false);
  // и после «Отмены», и после неудачного удаления: фокус на «Удалить», когда она снова на месте и доступна
  useEffect(() => {
    if (!confirm && !props.pending && refocusDelete.current) {
      refocusDelete.current = false;
      deleteRef.current?.focus();
    }
  }, [confirm, props.pending]);
  const count = props.items.length;
  const tooMany = count > BULK_MAX;
  const disabled = props.pending || tooMany;

  return (
    <>
      <div role="region" aria-label="Действия с выбранными" className="flex min-h-12 flex-wrap items-center gap-2 bg-income-strong px-3 py-1.5 text-white">
        <button
          type="button"
          role="checkbox"
          aria-checked="mixed"
          aria-label="Снять выделение"
          title="Снять выделение"
          onClick={props.onClear}
          className="grid size-[18px] shrink-0 place-items-center rounded bg-white text-sm leading-none font-bold text-income-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <span aria-hidden="true">{'\u2212'}</span>
        </button>
        {tooMany ? (
          <span className="text-sm">Не больше {BULK_MAX} операций за раз — снимите часть выделения</span>
        ) : (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-disabled={props.pending || undefined}
              onClick={() => {
                if (!props.pending) setEditOpen(true);
              }}
              className={barButton}
            >
              <PencilIcon />
              Изменить данные
            </button>
            {!confirm && (
              <button ref={deleteRef} type="button" disabled={disabled} onClick={() => setConfirm(true)} className={barButton}>
                <TrashIcon />
                Удалить
              </button>
            )}
          </>
        )}
        {confirm && !tooMany && (
          <span role="group" aria-label="Подтверждение удаления" className="flex flex-wrap items-center gap-2 text-sm">
            <span>Удалить выбранные операции ({count})? Отменить можно будет 10 секунд.</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                // ошибка: полоса остаётся — эффект выше вернёт фокус на «Удалить»; при успехе полосы уже нет (ссылка пуста)
                refocusDelete.current = true;
                setConfirm(false);
                void props.onRun({ action: 'delete' });
              }}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-expense hover:brightness-95 disabled:opacity-60"
            >
              Да, удалить
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                refocusDelete.current = true;
                setConfirm(false);
              }}
              className={barButton}
            >
              Отмена
            </button>
          </span>
        )}
        <p aria-live="polite" className="ml-auto text-sm font-semibold">
          {selectionTotals(props.items, props.baseCurrency)}
        </p>
      </div>
      <BulkEditDialog
        open={editOpen}
        count={count}
        data={props.data}
        onClose={() => setEditOpen(false)}
        onSave={(actions) => {
          setEditOpen(false);
          void props.onEdit(actions);
        }}
      />
    </>
  );
}
```

- [ ] **Step 5: The table puts the bar over the header row**

В `src/client/components/journal/JournalTable.tsx`:

1) В `JournalTableProps` после блока `selection?: { … };` вставьте:

```ts
  /**
   * Полоса массовых действий (§5.5 этапа 1.5): пока есть выделение, лежит поверх строки заголовков. Заголовки
   * остаются в таблице для программ чтения, их кнопки на это время выходят из порядка Tab.
   */
  bulkBar?: ReactNode;
```

2) Сигнатуру `function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort'] }) {` замените на

```tsx
function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort']; covered?: boolean }) {
```

и в её кнопке строку `        onClick={() => props.onSort(props.column, next)}` замените на

```tsx
        tabIndex={props.covered ? -1 : undefined}
        onClick={() => props.onSort(props.column, next)}
```

3) Строку `  const { lookups, columns, selection, wrap } = props;` замените на

```tsx
  const { lookups, columns, selection, wrap } = props;
  const covered = props.bulkBar !== undefined;
```

4) Строки

```tsx
    <div className="overflow-x-auto">
      <table aria-busy={props.busy}
```

замените на

```tsx
    <div className="relative overflow-x-auto">
      {props.bulkBar && <div className="absolute inset-x-0 top-0 z-10">{props.bulkBar}</div>}
      <table aria-busy={props.busy}
```

5) У флажка «Выбрать все» строку `                  data-select-all=""` замените на

```tsx
                  data-select-all=""
                  tabIndex={covered ? -1 : undefined}
```

6) Строку `                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} />` замените на

```tsx
                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} covered={covered} />
```

- [ ] **Step 6: The journal page**

В `src/client/pages/JournalPage.tsx`:

1) `import { bulkSummary, type BulkAction, type BulkSummary } from '../lib/journal-bulk';` → `import { bulkEditSummary, bulkSummary, type BulkAction, type BulkEditAction, type BulkResult, type BulkSummary } from '../lib/journal-bulk';`

2) `  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);` замените на

```tsx
  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedIds = selectedItems.map((i) => i.id);
```

3) После функции `run` (перед комментарием `// сохраняются поля окна поверх ТЕКУЩЕГО фильтра …`) вставьте:

```tsx
  // «Изменить данные» (§5.5): по очереди только заполненные поля; упал запрос — следующие не выполняются, итог это показывает
  const runEdit = async (actions: BulkEditAction[], ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    props.onClearUndoSummary();
    const done: { action: BulkEditAction['action']; result: BulkResult }[] = [];
    let failed: { action: BulkEditAction['action']; message: string } | null = null;
    let next = 0;
    for (; next < actions.length; next++) {
      const action = actions[next]!;
      try {
        done.push({ action: action.action, result: await runBulk(company.id, ids, action) });
      } catch (e) {
        failed = { action: action.action, message: operationErrorText(e) };
        break;
      }
    }
    setSummary(bulkEditSummary(done, failed, failed ? actions.slice(next + 1).map((a) => a.action) : []));
    setBulkPending(false);
  };
```

4) Удалите блок

```tsx
      {!mobile && selectedIds.length > 0 && (
        <BulkBar count={selectedIds.length} data={assignData} pending={bulkPending} onRun={(action) => run(action, selectedIds)} onClear={() => setSelected(new Set())} />
      )}
```

5) В `<JournalTable` строки (строка `onOpenOperation={openOperation}` есть и у `<JournalCards`, поэтому — вместе со следующей)

```tsx
          onOpenOperation={openOperation}
          renderAssign={readOnly ? undefined : (item, field) => <AssignChip field={field} onClick={() => setAssignRequest({ item, field })} />}
```

замените на

```tsx
          onOpenOperation={openOperation}
          renderAssign={readOnly ? undefined : (item, field) => <AssignChip field={field} onClick={() => setAssignRequest({ item, field })} />}
          bulkBar={
            !mobile && selectedItems.length > 0 ? (
              <BulkBar
                items={selectedItems}
                baseCurrency={company.baseCurrency}
                data={assignData}
                pending={bulkPending}
                onRun={(action) => run(action, selectedIds)}
                onEdit={(actions) => runEdit(actions, selectedIds)}
                onClear={() => {
                  setSelected(new Set());
                  // полоса исчезла вместе с фокусом — он переходит на флажок «Выбрать все» в открывшейся строке заголовков
                  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-select-all]')?.focus());
                }}
              />
            ) : undefined
          }
```

Run: `npm run typecheck` → без ошибок. Run: `npm test` → PASS.

- [ ] **Step 7: Update e2e**

`e2e/journal-actions.spec.ts`, тест «массовые действия: …»:

1) Строку заголовка теста

```ts
test('массовые действия: категория с итогом и причинами, проект, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
```

замените на

```ts
test('массовые действия: полоса на месте заголовков с итогом выделения, «Изменить данные» с итогом и причинами, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
```

2) Блок от строки `  // выбрать все загруженные → «Категория»: расходы с одной строкой меняются, разбитая и доход пропущены с причинами` до строк

```ts
  // удалить две операции: подтверждение, тост с фокусом на «Отменить», балансы пересчитаны
  await bar.getByRole('button', { name: 'Снять выделение' }).click();
  await expect(bar).toHaveCount(0);
```

включительно замените на:

```ts
  // выбрать все загруженные: полоса встаёт на место строки заголовков, справа — итог выделения по типам (§5.5)
  const selectAll = table(page).getByRole('checkbox', { name: 'Выбрать все загруженные операции' });
  await selectAll.check();
  await expect(bar).toContainText(/Доход • 1 платёж • 40\s₸ · Расход • 3 платежа • 60\s₸/);
  const clear = bar.getByRole('checkbox', { name: 'Снять выделение' });
  await expect(clear).toHaveAttribute('aria-checked', 'mixed');
  const barBox = (await bar.boundingBox())!;
  const headBox = (await table(page).locator('thead').boundingBox())!;
  expect(Math.abs(barBox.y - headBox.y)).toBeLessThanOrEqual(1);
  // кнопки строки заголовков под полосой не попадают в порядок Tab
  await expect(selectAll).toHaveAttribute('tabindex', '-1');

  // «Изменить данные»: категория и проект одним сохранением; что не подходит — пропущено с причинами
  const edit = bar.getByRole('button', { name: 'Изменить данные' });
  await edit.click();
  const editDialog = page.getByRole('dialog', { name: 'Изменить данные' });
  await expect(editDialog).toContainText('Выбрано: 4');
  const editSave = editDialog.getByRole('button', { name: 'Сохранить' });
  await expect(editSave).toBeDisabled();
  await editDialog.getByRole('button', { name: /^Категория:/ }).click();
  const categoryList = page.getByRole('listbox', { name: 'Категории' });
  await expect(categoryList.getByRole('group', { name: 'Доходы' })).toBeVisible();
  await categoryList.getByRole('group', { name: 'Расходы' }).getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(editSave).toBeEnabled();
  await editDialog.getByRole('button', { name: /^Проект:/ }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 2' }).click();
  await editSave.click();
  await expect(editDialog).toBeHidden();
  // фокус — снова на «Изменить данные»
  await expect(edit).toBeFocused();
  const summary = page.getByRole('status').filter({ hasText: 'Категория:' });
  await expect(summary).toContainText('Категория: изменено 2, пропущено 2. Проект: изменено 3, пропущено 1');
  await expect(summary).toContainText('Категория: Разбитая операция — измените её в форме — 1');
  await expect(summary).toContainText('Категория: Категория расходов не подходит для дохода — 1');
  await expect(row('A')).toContainText('Аренда');
  await expect(row('B')).toContainText('Аренда');
  await expect(row('D')).not.toContainText('Аренда');
  await expect(row('D')).toContainText('Клуб 2');
  // выделение остаётся
  await expect(bar).toContainText(/Расход • 3 платежа/);

  // общий чекбокс снимает выделение; фокус — на флажке «Выбрать все» (Review Focus 6)
  await clear.click();
  await expect(bar).toHaveCount(0);
  await expect(selectAll).toBeFocused();

  // удалить две операции: подтверждение, тост с фокусом на «Отменить», балансы пересчитаны
```

3) Строку `  await expect(bar).toContainText('Выбрано: 1');` замените на `  await expect(bar).toContainText(/Расход • 1 платёж • 10\s₸/);`

`e2e/mobile.spec.ts`, тест «выделение из широкого окна на телефоне снимается…»: строку `  await expect(bulk).toContainText('Выбрано: 1');` замените на `  await expect(bulk).toContainText('Доход • 1 платёж');`.

- [ ] **Step 8: Run all checks; e2e twice**

Run: `npm test` → PASS, 665 (661 + 4). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal-actions.spec.ts e2e/mobile.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 9: Commit**

```bash
git add src/client/lib/journal-bulk.ts src/client/components src/client/pages/JournalPage.tsx tests/client/journal-bulk.test.ts e2e
git commit -m "feat: полоса действий на месте заголовков — общий чекбокс, «Изменить данные», итог выделения «Доход • 2 платежа • …»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Окно «Фильтры» — мультивыборы в порядке Finmap, «×» без «Отмены», «Недоступный элемент»

**Files:**
- Create: `src/client/lib/journal-filter-dialog.ts`, `src/client/components/MultiSelectField.tsx`, `tests/client/journal-filter-dialog.test.ts`
- Modify: `src/client/components/journal/FilterDialog.tsx` (целиком), `src/client/components/journal/JournalToolbar.tsx`, `e2e/journal.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/dialogs.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `DialogFields`, `pickDialogFields`, `sortedUnique`, `OPERATION_TYPES`, `OperationType` (`lib/journal-filter.ts`); `Popover`; `matchesQuery` (`shared/search.ts`).
- Produces:
  - `interface FilterDialogData { accounts; categories; projects; counterparties; tags }`, `interface MultiOption { key: string; label: string; section?: string; nested?: boolean }`, `type FilterDimension = 'typesCategories' | 'counterparties' | 'projects' | 'tags' | 'accounts'`, `DIMENSIONS`, `UNAVAILABLE = 'Недоступный элемент'`, `dimensionOptions(dim, data, draft): MultiOption[]`, `dimensionSelected(dim, draft): string[]`, `toggleDimension(dim, draft, key): DialogFields` (`lib/journal-filter-dialog.ts`);
  - `MultiSelectField(props: { label: string; allLabel: string; options: MultiOption[]; selected: readonly string[]; onToggle: (key: string) => void })` — кнопка с именем «{подпись}[ (N)]: {значение}», панель «{подпись}» с полем «{подпись}: поиск» и флажками;
  - `FilterDialog` — окно «Фильтры» (свойства прежние);
  - панель телефона в `JournalToolbar` — «Период и условия».

- [ ] **Step 1: Write the failing unit tests**

`tests/client/journal-filter-dialog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, pickDialogFields, type DialogFields } from '../../src/client/lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, UNAVAILABLE, type FilterDialogData } from '../../src/client/lib/journal-filter-dialog';
import type { Account, CategoryNode, Counterparty, Project, Tag } from '../../src/client/lib/queries';

const ARCH = '2026-10-01T00:00:00.000Z';
const node = (id: number, name: string, patch: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId: null,
  name,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children: [],
  ...patch,
});
/** Строка справочника: функциям окна нужны только id, название и архив. */
const row = <T,>(id: number, name: string, archivedAt: string | null = null) => ({ id, name, archivedAt }) as unknown as T;

const data: FilterDialogData = {
  accounts: [row<Account>(1, 'Касса'), row<Account>(2, 'Старый', ARCH)],
  categories: {
    income: [node(10, 'Выручка', { kind: 'income' })],
    expense: [node(20, 'Помещение', { children: [node(21, 'Коммуналка', { parentId: 20 }), node(22, 'Свет', { parentId: 20, archivedAt: ARCH })] })],
  },
  projects: [row<Project>(5, 'Клуб 1')],
  counterparties: [row<Counterparty>(7, 'ИП Поставщик'), row<Counterparty>(8, 'Ушёл', ARCH)],
  tags: [row<Tag>(9, 'Смена')],
};
const empty: DialogFields = pickDialogFields(EMPTY_JOURNAL_STATE);

describe('окно «Фильтры» (§5.6 этапа 1.5)', () => {
  it('поля в порядке Finmap', () => {
    expect(DIMENSIONS.map((d) => [d.label, d.allLabel])).toEqual([
      ['Типы платежей и категории', 'Все типы и категории'],
      ['Контрагенты', 'Все контрагенты'],
      ['Проекты', 'Все проекты'],
      ['Теги', 'Все теги'],
      ['Счета', 'Все счета'],
    ]);
  });

  it('«Типы платежей и категории»: группа «Тип», категории дохода и расхода деревом, «Без категории»; архивные — только выбранные', () => {
    expect(dimensionOptions('typesCategories', data, empty)).toEqual([
      { key: 'type:income', label: 'Доход', section: 'Тип' },
      { key: 'type:expense', label: 'Расход', section: 'Тип' },
      { key: 'type:transfer', label: 'Перевод', section: 'Тип' },
      { key: 'category:10', label: 'Выручка', section: 'Категории дохода' },
      { key: 'category:20', label: 'Помещение', section: 'Категории расхода' },
      { key: 'category:21', label: 'Коммуналка', section: 'Категории расхода', nested: true },
      { key: 'none', label: 'Без категории' },
    ]);
    expect(dimensionOptions('typesCategories', data, { ...empty, categoryIds: [22] })).toContainEqual({
      key: 'category:22',
      label: 'Свет (архив)',
      section: 'Категории расхода',
      nested: true,
    });
  });

  it('«Без контрагента» и «Без проекта» — первыми; архивные — только выбранные; неизвестный id — «Недоступный элемент» (Review Focus 5)', () => {
    expect(dimensionOptions('counterparties', data, empty)).toEqual([
      { key: 'none', label: 'Без контрагента' },
      { key: '7', label: 'ИП Поставщик' },
    ]);
    expect(dimensionOptions('counterparties', data, { ...empty, counterpartyIds: [8, 99] })).toEqual([
      { key: 'none', label: 'Без контрагента' },
      { key: '7', label: 'ИП Поставщик' },
      { key: '8', label: 'Ушёл (архив)' },
      { key: '99', label: UNAVAILABLE },
    ]);
    expect(dimensionOptions('projects', data, { ...empty, projectIds: [999999] })).toEqual([
      { key: 'none', label: 'Без проекта' },
      { key: '5', label: 'Клуб 1' },
      { key: '999999', label: 'Недоступный элемент' },
    ]);
    expect(dimensionOptions('typesCategories', data, { ...empty, categoryIds: [77] })).toContainEqual({ key: 'category:77', label: 'Недоступный элемент' });
    expect(dimensionOptions('tags', data, empty)).toEqual([{ key: '9', label: 'Смена' }]);
    expect(dimensionOptions('accounts', data, empty)).toEqual([{ key: '1', label: 'Касса' }]);
  });

  it('выбранное и переключение: тип и категория раздельно, «без …» — флагом; id по возрастанию; недоступный снимается', () => {
    let d = toggleDimension('typesCategories', empty, 'type:expense');
    d = toggleDimension('typesCategories', d, 'category:20');
    d = toggleDimension('typesCategories', d, 'none');
    expect(d).toMatchObject({ types: ['expense'], categoryIds: [20], withoutCategory: true });
    expect(dimensionSelected('typesCategories', d)).toEqual(['type:expense', 'category:20', 'none']);
    d = toggleDimension('typesCategories', d, 'type:income');
    expect(d.types).toEqual(['income', 'expense']);
    d = toggleDimension('typesCategories', d, 'type:expense');
    expect(d.types).toEqual(['income']);
    d = toggleDimension('counterparties', d, 'none');
    expect(d.withoutCounterparty).toBe(true);
    expect(dimensionSelected('counterparties', d)).toEqual(['none']);
    d = toggleDimension('projects', d, '6');
    d = toggleDimension('projects', d, '5');
    expect(d.projectIds).toEqual([5, 6]);
    d = toggleDimension('projects', d, '6');
    expect(dimensionSelected('projects', d)).toEqual(['5']);
    d = toggleDimension('tags', d, '9');
    d = toggleDimension('accounts', d, '1');
    expect([dimensionSelected('tags', d), dimensionSelected('accounts', d)]).toEqual([['9'], ['1']]);
    expect(toggleDimension('projects', { ...empty, projectIds: [999999] }, '999999').projectIds).toEqual([]);
  });
});
```

Run: `npx vitest run tests/client/journal-filter-dialog.test.ts` → FAIL (модуль не найден).

- [ ] **Step 2: Implement `lib/journal-filter-dialog.ts`**

```ts
import { OPERATION_TYPES, sortedUnique, type DialogFields, type OperationType } from './journal-filter';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';

/** Справочники окна «Фильтры». */
export interface FilterDialogData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
}

/** Пункт выпадающего мультивыбора (§5.6 этапа 1.5): ключ, подпись, группа и отступ дочерней категории. */
export interface MultiOption {
  key: string;
  label: string;
  section?: string;
  nested?: boolean;
}

export type FilterDimension = 'typesCategories' | 'counterparties' | 'projects' | 'tags' | 'accounts';

/** Поля окна в порядке Finmap: подпись (со счётчиком выбранного) и значение, когда ничего не выбрано. */
export const DIMENSIONS: readonly { dim: FilterDimension; label: string; allLabel: string }[] = [
  { dim: 'typesCategories', label: 'Типы платежей и категории', allLabel: 'Все типы и категории' },
  { dim: 'counterparties', label: 'Контрагенты', allLabel: 'Все контрагенты' },
  { dim: 'projects', label: 'Проекты', allLabel: 'Все проекты' },
  { dim: 'tags', label: 'Теги', allLabel: 'Все теги' },
  { dim: 'accounts', label: 'Счета', allLabel: 'Все счета' },
];

/** Подпись id из адреса, которого нет в справочниках (удалён или из другой компании, 5b №5): его можно снять. */
export const UNAVAILABLE = 'Недоступный элемент';

/** Ключ «без значения»: «Без категории», «Без контрагента», «Без проекта». */
const NONE = 'none';
const TYPE_PREFIX = 'type:';
const CATEGORY_PREFIX = 'category:';
const TYPE_LABELS: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

type Row = { id: number; name: string; archivedAt: string | null };

/** Архивные не предлагаются — кроме уже выбранных (их можно снять); выбранные id без строки — «Недоступный элемент». */
function rowOptions(rows: readonly Row[], selected: readonly number[]): MultiOption[] {
  const known = new Set(rows.map((r) => r.id));
  return [
    ...rows.filter((r) => !r.archivedAt || selected.includes(r.id)).map((r) => ({ key: String(r.id), label: r.archivedAt ? `${r.name} (архив)` : r.name })),
    ...selected.filter((id) => !known.has(id)).map((id) => ({ key: String(id), label: UNAVAILABLE })),
  ];
}

/** Категории вида деревом: дочерняя — с отступом; дочерняя архивного родителя тоже считается архивной. */
function categoryRows(nodes: readonly CategoryNode[], selected: readonly number[], section: string): MultiOption[] {
  return nodes.flatMap((n) => {
    const self = !n.archivedAt || selected.includes(n.id) ? [{ key: `${CATEGORY_PREFIX}${n.id}`, label: n.archivedAt ? `${n.name} (архив)` : n.name, section }] : [];
    const children = n.children
      .filter((c) => (!c.archivedAt && !n.archivedAt) || selected.includes(c.id))
      .map((c) => ({ key: `${CATEGORY_PREFIX}${c.id}`, label: c.archivedAt || n.archivedAt ? `${c.name} (архив)` : c.name, section, nested: true }));
    return [...self, ...children];
  });
}

/** Пункты поля окна «Фильтры» (§5.6). */
export function dimensionOptions(dim: FilterDimension, data: FilterDialogData, draft: DialogFields): MultiOption[] {
  switch (dim) {
    case 'typesCategories': {
      const all = [...data.categories.income, ...data.categories.expense];
      const known = new Set(all.flatMap((n) => [n.id, ...n.children.map((c) => c.id)]));
      return [
        ...OPERATION_TYPES.map((t) => ({ key: `${TYPE_PREFIX}${t}`, label: TYPE_LABELS[t], section: 'Тип' })),
        ...categoryRows(data.categories.income, draft.categoryIds, 'Категории дохода'),
        ...categoryRows(data.categories.expense, draft.categoryIds, 'Категории расхода'),
        ...draft.categoryIds.filter((id) => !known.has(id)).map((id) => ({ key: `${CATEGORY_PREFIX}${id}`, label: UNAVAILABLE })),
        { key: NONE, label: 'Без категории' },
      ];
    }
    case 'counterparties':
      return [{ key: NONE, label: 'Без контрагента' }, ...rowOptions(data.counterparties, draft.counterpartyIds)];
    case 'projects':
      return [{ key: NONE, label: 'Без проекта' }, ...rowOptions(data.projects, draft.projectIds)];
    case 'tags':
      return rowOptions(data.tags, draft.tagIds);
    case 'accounts':
      return rowOptions(data.accounts, draft.accountIds);
  }
}

/** Ключи отмеченных пунктов поля. */
export function dimensionSelected(dim: FilterDimension, draft: DialogFields): string[] {
  switch (dim) {
    case 'typesCategories':
      return [...draft.types.map((t) => `${TYPE_PREFIX}${t}`), ...draft.categoryIds.map((id) => `${CATEGORY_PREFIX}${id}`), ...(draft.withoutCategory ? [NONE] : [])];
    case 'counterparties':
      return [...(draft.withoutCounterparty ? [NONE] : []), ...draft.counterpartyIds.map(String)];
    case 'projects':
      return [...(draft.withoutProject ? [NONE] : []), ...draft.projectIds.map(String)];
    case 'tags':
      return draft.tagIds.map(String);
    case 'accounts':
      return draft.accountIds.map(String);
  }
}

const toggleId = (ids: readonly number[], id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : sortedUnique([...ids, id]));

/** Отметить или снять пункт поля: черновик окна с изменённым условием (адрес и смысл фильтра прежние). */
export function toggleDimension(dim: FilterDimension, draft: DialogFields, key: string): DialogFields {
  switch (dim) {
    case 'typesCategories': {
      if (key === NONE) return { ...draft, withoutCategory: !draft.withoutCategory };
      if (key.startsWith(TYPE_PREFIX)) {
        const t = key.slice(TYPE_PREFIX.length) as OperationType;
        return { ...draft, types: OPERATION_TYPES.filter((x) => (x === t ? !draft.types.includes(t) : draft.types.includes(x))) };
      }
      return { ...draft, categoryIds: toggleId(draft.categoryIds, Number(key.slice(CATEGORY_PREFIX.length))) };
    }
    case 'counterparties':
      return key === NONE ? { ...draft, withoutCounterparty: !draft.withoutCounterparty } : { ...draft, counterpartyIds: toggleId(draft.counterpartyIds, Number(key)) };
    case 'projects':
      return key === NONE ? { ...draft, withoutProject: !draft.withoutProject } : { ...draft, projectIds: toggleId(draft.projectIds, Number(key)) };
    case 'tags':
      return { ...draft, tagIds: toggleId(draft.tagIds, Number(key)) };
    case 'accounts':
      return { ...draft, accountIds: toggleId(draft.accountIds, Number(key)) };
  }
}
```

Run: `npx vitest run tests/client/journal-filter-dialog.test.ts` → PASS.

- [ ] **Step 3: `MultiSelectField`**

`src/client/components/MultiSelectField.tsx`:

```tsx
import { useState } from 'react';
import { matchesQuery } from '../../shared/search';
import type { MultiOption } from '../lib/journal-filter-dialog';
import { Popover } from './Popover';

const fieldClass = 'flex w-full min-w-0 items-center justify-between gap-2 rounded-xl bg-field px-4 py-2 text-left outline-none focus:ring-2 focus:ring-focus';

function MultiPanel(props: { label: string; options: MultiOption[]; selected: readonly string[]; onToggle: (key: string) => void }) {
  const [query, setQuery] = useState('');
  // отмеченные видны и при поиске — их можно снять
  const shown = props.options.filter((o) => props.selected.includes(o.key) || matchesQuery(o.label, query));
  const groups: { section?: string; items: MultiOption[] }[] = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (o.section && last?.section === o.section) last.items.push(o);
    else groups.push({ section: o.section, items: [o] });
  }
  const item = (o: MultiOption) => (
    <label key={o.key} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field ${o.nested ? 'pl-7' : ''}`}>
      <input type="checkbox" checked={props.selected.includes(o.key)} onChange={() => props.onToggle(o.key)} className="size-4 shrink-0 accent-income" />
      {/* длинное название без пробелов переносится, а не растягивает панель */}
      <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
    </label>
  );
  return (
    <div>
      <input
        type="search"
        aria-label={`${props.label}: поиск`}
        placeholder="Поиск"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Enter в поиске ничего не применяет
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <div className="max-h-72 overflow-y-auto">
        {groups.map((g, i) =>
          g.section ? (
            <fieldset key={`${g.section}-${i}`} className="mb-1 min-w-0">
              <legend className="px-2 pt-2 pb-1 text-xs font-semibold text-muted">{g.section}</legend>
              {g.items.map(item)}
            </fieldset>
          ) : (
            <div key={`plain-${i}`}>{g.items.map(item)}</div>
          ),
        )}
        {shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">Ничего не найдено</p>}
      </div>
    </div>
  );
}

/**
 * Выпадающий мультивыбор (§5.6 этапа 1.5): кнопка поля — сверху подпись со счётчиком «Проекты (1)», ниже значение
 * («Все проекты» или названия через запятую с обрезкой); панель — поиск (без учёта регистра и «ё») и флажки,
 * группы — `fieldset` с названием. Флажки — обычные `checkbox`: множественный выбор без особой клавиатурной схемы.
 * Esc закрывает только панель (Popover), окно остаётся.
 */
export function MultiSelectField(props: { label: string; allLabel: string; options: MultiOption[]; selected: readonly string[]; onToggle: (key: string) => void }) {
  const count = props.selected.length;
  const title = count > 0 ? `${props.label} (${count})` : props.label;
  const chosen = props.options.filter((o) => props.selected.includes(o.key)).map((o) => o.label);
  const value = chosen.length > 0 ? chosen.join(', ') : props.allLabel;
  return (
    <Popover
      label={
        <>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-muted">{title}</span>
            <span className="truncate text-sm">{value}</span>
          </span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </>
      }
      ariaLabel={`${title}: ${value}`}
      panelLabel={props.label}
      buttonClassName={fieldClass}
      panelClassName="w-80 max-w-[calc(100vw-2rem)]"
    >
      {() => <MultiPanel label={props.label} options={props.options} selected={props.selected} onToggle={props.onToggle} />}
    </Popover>
  );
}
```

- [ ] **Step 4: The dialog**

Замените `src/client/components/journal/FilterDialog.tsx` целиком:

```tsx
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { pickDialogFields, type DialogFields, type JournalUrlState } from '../../lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, type FilterDialogData, type FilterDimension } from '../../lib/journal-filter-dialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, btnSecondary, inputClass } from '../ui';

export type { FilterDialogData };

const NOTHING: DialogFields = {
  types: [],
  accountIds: [],
  categoryIds: [],
  projectIds: [],
  counterpartyIds: [],
  tagIds: [],
  withoutCategory: false,
  withoutProject: false,
  withoutCounterparty: false,
};

/** Раскладка в две колонки (§5.6): «Типы платежей и категории» — на всю ширину. */
const FIELD_CLASS: Record<FilterDimension, string> = { typesCategories: 'md:col-span-2', counterparties: '', projects: '', tags: '', accounts: '' };

/**
 * Поля окна «Фильтры» (§5.6 этапа 1.5) — все условия фильтра журнала, кроме периода, поиска и суммы (они в тулбаре).
 * Меняет черновик; «Готово» применяет его поверх текущего фильтра, «×» и Esc закрывают без изменений.
 */
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: DialogFields) => void;
  /** Не передан (архивная компания) — «Сохранить фильтр» не показывается. */
  onSave?: (draft: DialogFields, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DialogFields>(() => pickDialogFields(props.state));
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${FIELD_CLASS[d.dim]}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, draft)}
              selected={dimensionSelected(d.dim, draft)}
              onToggle={(key) => setDraft((current) => toggleDimension(d.dim, current, key))}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Среди типов, среди категорий, контрагентов и т. д. подходит любой из отмеченных вариантов («Аренда» или «Без категории»), а разные поля и тип с категорией действуют
        вместе: «Расход» и «Аренда» — расходы на аренду. Родительская категория включает дочерние.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft(NOTHING)} className="text-sm font-semibold text-muted underline hover:text-ink">
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
 * Окно «Фильтры» (§5.6 этапа 1.5): «×» в углу закрывает без применения, «Отмены» нет. Поля — выпадающие
 * мультивыборы в порядке Finmap; кнопки «Готово», «Очистить», «Сохранить фильтр».
 */
export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  /** Только поля окна: их накладывают на текущий фильтр, а не на снимок при открытии. */
  onApply: (next: DialogFields) => void;
  onClose: () => void;
  /**
   * Сохраняет поля окна как именованный фильтр — тоже поверх текущего фильтра (applyDialogFields);
   * при успехе окно применяет черновик и закрывается.
   */
  onSave?: (draft: DialogFields, name: string) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose}>
      <FilterForm
        state={props.state}
        data={props.data}
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

В `src/client/components/journal/JournalToolbar.tsx` строку

```tsx
        <Drawer open={panelOpen} title="Фильтры" side="right" onClose={() => setPanelOpen(false)}>
```

замените на

```tsx
        {/* до плана 1.5-5; название не совпадает с окном «Фильтры», которое открывается поверх */}
        <Drawer open={panelOpen} title="Период и условия" side="right" onClose={() => setPanelOpen(false)}>
```

Run: `npm run typecheck` → без ошибок. Run: `npm test` → PASS.

- [ ] **Step 5: Update e2e — `journal.spec.ts`**

Тесты «модалка «Фильтр»: все условия §6, …» и ««Готово» в окне «Фильтр» не затирает поиск, …» (два последних теста файла) замените целиком:

```ts
test('окно «Фильтры»: мультивыборы в порядке Finmap, «Готово» применяет, Esc и «×» закрывают без изменений; счёт из левой панели отмечен; недоступный id снимается', async ({ page }) => {
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
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const field = (label: string) => dialog.getByRole('button', { name: new RegExp(`^${label}`) });
  const panelOf = (label: string) => dialog.getByRole('dialog', { name: label, exact: true });
  const done = async () => {
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await expect(dialog).toBeHidden();
  };

  // поля в порядке Finmap; «Отмены» нет — закрывает «×»
  await filterButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([/^Типы платежей и категории/, /^Контрагенты/, /^Проекты/, /^Теги/, /^Счета/]);
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveCount(0);
  await expect(field('Проекты')).toHaveAccessibleName('Проекты: Все проекты');

  // тип и родительская категория (включает дочернюю) — в одном поле; счётчик в подписи
  await field('Типы платежей и категории').click();
  const types = panelOf('Типы платежей и категории');
  await expect(types.getByRole('group', { name: 'Тип' })).toBeVisible();
  await types.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await types.getByRole('checkbox', { name: 'Помещение', exact: true }).check();
  await expect(field('Типы платежей и категории')).toHaveAccessibleName('Типы платежей и категории (2): Расход, Помещение');
  // Esc закрывает только список, окно остаётся
  await page.keyboard.press('Escape');
  await expect(types).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(field('Типы платежей и категории')).toBeFocused();
  await done();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}$`));
  await expect(filterButton).toHaveText('Фильтр · 2');
  await expect.poll(comments).toBe('A');

  // «Без категории» — вместе с выбранной категорией через ИЛИ
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await expect(types.getByRole('checkbox', { name: 'Расход', exact: true })).toBeChecked();
  await types.getByRole('checkbox', { name: 'Без категории' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('BA');

  // Esc закрывает без изменений; «×» — тоже
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await types.getByRole('checkbox', { name: 'Перевод', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await types.getByRole('checkbox', { name: 'Перевод', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));

  // «Очистить», поиск контрагента («Без контрагента» — первым пунктом), тег, «Без проекта»
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Контрагенты').click();
  const counterparties = panelOf('Контрагенты');
  await expect(counterparties.getByRole('checkbox').first()).toHaveAccessibleName('Без контрагента');
  await counterparties.getByLabel('Контрагенты: поиск').fill('постав');
  await expect(counterparties.getByRole('checkbox', { name: 'ТОО Арендодатель' })).toHaveCount(0);
  await counterparties.getByLabel('Контрагенты: поиск').press('Enter'); // Enter в поиске не применяет фильтр
  await expect(dialog).toBeVisible();
  await counterparties.getByRole('checkbox', { name: 'ИП Поставщик' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`counterparty=${supplier}$`));
  await expect.poll(comments).toBe('A');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Теги').click();
  await panelOf('Теги').getByRole('checkbox', { name: 'Смена' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('C');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Проекты').click();
  const projects = panelOf('Проекты');
  await expect(projects.getByRole('checkbox').first()).toHaveAccessibleName('Без проекта');
  await projects.getByRole('checkbox', { name: 'Без проекта' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('DCB');

  // счёт из левой панели — отмечен в окне, его можно снять
  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect.poll(comments).toBe('DB');
  await expect(filterButton).toHaveText('Фильтр · 1');
  await filterButton.click();
  await expect(field('Счета')).toHaveAccessibleName('Счета (1): Наличные');
  await field('Счета').click();
  await expect(panelOf('Счета').getByRole('checkbox', { name: 'Наличные' })).toBeChecked();
  await panelOf('Счета').getByRole('checkbox', { name: 'Наличные' }).uncheck();
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);

  // id из адреса, которого нет в справочниках, — «Недоступный элемент»: отмечен, его можно снять (5b №5, Review Focus 5)
  await page.goto(`/c/${cid}/log?project=999999`);
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await filterButton.click();
  await expect(field('Проекты')).toHaveAccessibleName('Проекты (1): Недоступный элемент');
  await field('Проекты').click();
  await expect(projects.getByRole('checkbox', { name: 'Недоступный элемент' })).toBeChecked();
  await projects.getByRole('checkbox', { name: 'Недоступный элемент' }).uncheck();
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);
});

test('«Готово» в окне «Фильтры» не затирает поиск, дошедший до адреса, пока окно было открыто', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Поиск и фильтр ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'аренда зала' });
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(1);

  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  // окно открывается раньше, чем истекает пауза поиска (300 мс): запрос доходит до адреса при открытом окне
  await search.fill('аренда');
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Доход', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/q=/);
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/type=income/);
  await expect(search).toHaveValue('аренда');
});
```

- [ ] **Step 6: Update e2e — other files**

`e2e/journal-actions.spec.ts`:

1) Инструментом правки замените все вхождения `getByRole('dialog', { name: 'Фильтр', exact: true })` на `getByRole('dialog', { name: 'Фильтры', exact: true })` (три: тест сохранённых фильтров, тест архивной компании, тест повреждённого фильтра).

2) В тесте «сохранённые фильтры: сохранить из окна «Фильтр», …» строки

```ts
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('   ');
```

замените на

```ts
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Доход', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('   ');
```

и строки

```ts
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
```

замените на

```ts
  await dialog.getByRole('button', { name: /^Теги/ }).click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
```

3) В тесте «сохранённые фильтры: повреждённый не применяется…» строки

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
```

замените на

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Доход', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
```

`e2e/dialogs.spec.ts`: `  const filter = page.getByRole('dialog', { name: 'Фильтр', exact: true });` → `  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });`

`e2e/mobile.spec.ts`:

1) В тесте «фильтры на телефоне — в панели справа…» `  const panel = page.getByRole('dialog', { name: 'Фильтры' });` → `  const panel = page.getByRole('dialog', { name: 'Период и условия' });`

2) Там же строки

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
```

замените на

```ts
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Готово' }).click();
```

3) В тесте «ширина 390 px: …» строки

```ts
  await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await expect(filter.getByRole('checkbox', { name: 'Оборудование_для_компьютерного_клуба_без_пробелов' })).toBeVisible();
  await expectNoSideScroll(page, 'окно «Фильтр»');
```

замените на

```ts
  await page.getByRole('dialog', { name: 'Период и условия' }).getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  // длинное название — в списке поля «Типы платежей и категории»: переносится, панель не шире экрана
  await filter.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await expect(filter.getByRole('checkbox', { name: 'Оборудование_для_компьютерного_клуба_без_пробелов' })).toBeVisible();
  await expectNoSideScroll(page, 'окно «Фильтры»');
```

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 669 (665 + 4). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/journal.spec.ts e2e/journal-actions.spec.ts e2e/dialogs.spec.ts e2e/mobile.spec.ts` → PASS.
Run: `npm run test:e2e` дважды → 70 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/journal-filter-dialog.ts src/client/components/MultiSelectField.tsx src/client/components/journal/FilterDialog.tsx src/client/components/journal/JournalToolbar.tsx tests/client/journal-filter-dialog.test.ts e2e
git commit -m "feat: окно «Фильтры» как в Finmap — мультивыборы с поиском и счётчиком, «×» без «Отмены», «Недоступный элемент»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Визуальная сверка журнала — «Указать» и «Фильтры»; итоговый прогон `npm run shots:ux`

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: окно «Редактирование …» (задача 1), окно «Фильтры» (задача 3), сценарии плана 1.5-2a.
- Produces: снимки `c03-ukazat-popover.png` (окно «Указать») и `c18-filter-modal.png` (окно «Фильтры»); итог сверки журнала в отчёте задачи.

- [ ] **Step 1: Update the scenarios**

В `scripts/ux-shots.ts`, сценарий `c03-ukazat-popover.png`, строки

```ts
      await table(p).getByRole('button', { name: /Указать/ }).first().click();
      await p.getByRole('listbox').first().waitFor();
```

замените на

```ts
      await table(p).getByRole('button', { name: /Указать/ }).first().click();
      await p.getByRole('dialog', { name: /^Редактирование/ }).waitFor();
```

сценарий `c18-filter-modal.png`, строку

```ts
      await p.getByRole('dialog', { name: 'Фильтр', exact: true }).waitFor();
```

замените на

```ts
      await p.getByRole('dialog', { name: 'Фильтры', exact: true }).waitFor();
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: итог `Готово: …\parity\index.html — снято 36 из 36.` Скрипт работает на порту 41741 с временной папкой. Упавший сценарий (`✗ …`) — почти всегда локатор: исправьте сценарий, а не продукт, и запустите ещё раз.

- [ ] **Step 3: Compare the journal screens and write the result into the task report**

Откройте инструментом чтения изображений пары `docs/research/screens/v2/<снимок Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `01-log` ↔ `c01-log`, `02-row-hover` ↔ `c02-row-hover`, `03-ukazat-popover` ↔ `c03-ukazat-popover`, `04-bulk-selected` ↔ `c04-bulk-selected`, `17-period-dd` ↔ `c17-period-dd`, `18-filter-modal` ↔ `c18-filter-modal`, `18b-filter-saved-dd` ↔ `c18b-filter-saved-dd`, `19-toolbar-more` ↔ `c19-toolbar-more`, `36-settings-log-view` ↔ `c36-settings-log-view`, а также `m02-log-closed-panel` ↔ `cm02-log` (телефон не должен был сломаться).

В отчёт задачи (не в файл) запишите таблицу «экран — совпадает по раскладке / отличается намеренно (почему) / отличается (что исправить)». Ожидаемо:
- **совпадают** все экраны журнала: 01, 02, 03 (окно «Редактирование …», один список, «Сохранить» на всю ширину), 04 (полоса на месте заголовков, «−», «Изменить данные», «Удалить», итог справа), 17, 18 (заголовок «Фильтры», «×», поля в порядке Finmap), 18b, 19, 36;
- **отличаются намеренно:** пункты периода «За сегодня» и «За вчера»; ✕ «Сбросить фильтр»; «Очистить» в окне «Фильтры»; подсветка выделенных строк; поле «Указать» — пока кнопка со списком (ввод в поле — план 1.5-3); подпись поля — сверху, а не плавающая (план 1.5-3);
- **телефон (cm02):** работает, раскладка Finmap — план 1.5-5.

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS, 669. Run: `npm run typecheck` → без ошибок. Run: `npm run test:e2e` → 70 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — окна «Указать» и «Фильтры»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-10-stage1_5-plan2b-followups.md` (пишет контролёр).
- План 1.5-2 закрывает отложенные 5b №2 (радиокнопки в `Popover` не понадобились — меню периода из кнопок) и 5b №5 («Недоступный элемент»); 5b №3 закрыт ещё в 1.5-1a (балансы) и здесь (⟳ журнала).
- Следующий план — 1.5-3 «Формы операций»: `ComboSelect` с вводом в поле и «+ Создать» (окна «Указать» и «Изменить данные» подхватят его без правок), `Field floating`, `DateTimeField` на `Calendar` из 1.5-2a, подписи контрагента «Владелец», «Тип налога».
- Замечания для итогов (followups):
  - полоса действий лежит поверх строки заголовков: если её содержимое не помещается в одну строку (узкое окно и подтверждение удаления), она закрывает верх первой строки таблицы, пока видна;
  - «Указать» и «Изменить данные» не предлагают «+ Создать» — появится с §6.6 в плане 1.5-3.
