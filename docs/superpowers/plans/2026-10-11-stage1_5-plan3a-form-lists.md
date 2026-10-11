# Этап 1.5, план 1.5-3a: формы операций — списки с вводом в поле, «+ Создать», плавающие подписи, подпись контрагента — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая треть плана 1.5-3 из §13 спецификации этапа 1.5 — всё, что касается полей со списком и подписей полей:
- поле со списком — само поле ввода (`input role="combobox"`): печать открывает и фильтрует список, ↓ открывает, Enter выбирает, Esc закрывает только список; список шириной с поле, пункты `py-3 text-base` (§6.6);
- «+ Создать»: при пустом запросе — первым пунктом («+ Создать категорию»), с текстом — после найденных («+ Создать „…“»), как на снимке Finmap `09b`; у счёта справа символ валюты, «(KZT)» из названия убран; у системных категорий бейдж «системная» (§6.6);
- плавающие подписи `Field floating` у полей со списком, суммы, «Доли» и комментария (§6.3); пустое значение больше не пишется текстом «Без категории» — видна подпись поля;
- подпись поля контрагента по системной категории — «Мой контрагент», «Сотрудник», «Владелец», «Инвестор», «Кредитор», «Заёмщик», «Тип налога» и переименования в `shared/counterparties.ts` (§6.4);
- «+ Создать» в окне «Указать» журнала (§5.4 — «тот же комбобокс, что в форме»);
- сценарии списков в визуальной сверке и итоговый прогон `npm run shots:ux`.

**Предусловие:** выполнены планы 1.5-1a/b и 1.5-2a/b. Ожидаемо на старте: `npm test` — 672 теста (+1 пропущен), `npm run test:e2e` — 75.

**Следующие части:** [1.5-3b](2026-10-11-stage1_5-plan3b-form-layout.md) — окно на тип, одна колонка, строки-действия, главная кнопка, последний счёт, теги и файлы; [1.5-3c](2026-10-11-stage1_5-plan3c-datetime-calculator.md) — дата и время, «Зарплата за {месяц}», калькулятор.

**Architecture:**
- **Чистые правила списков** — новый `src/client/lib/picker.ts`: тип `PickerOption` (с `badge` и `suffix`), `pickerItems` (поиск без учёта регистра и «ё», место пункта «+ Создать»), `createItemLabel`, `initialActive`. Тип `PickerOption` переезжает сюда из `components/SearchPicker.tsx` (там остаётся реэкспорт): библиотеки `lib/*` больше не импортируют компоненты.
- **Отрисовка списка** — `PickerListbox` в `components/SearchPicker.tsx`: только `<ul role="listbox">` с группами, бейджем и символом валюты; поле поиска — у владельца. `PickerList` (поиск + список — «Применить шаблон», «+ Тег») и новое поле со списком используют его.
- **Поле со списком** — хук `useComboList` (новый `components/ComboList.tsx`): состояние списка, клавиши, `aria-*` поля и сам список порталом в окно (`<dialog>`) или `body`, место — `useFloating` с новой опцией «ширина как у якоря». `ComboSelect` — поле `Field floating` с `<input>` из хука. Хук пригодится тегам (план 1.5-3b).
- **Плавающая подпись** — `Field` с `floating`: подпись внутри рамки поля, пустое поле — подпись как подсказка, заполненное или в фокусе — мелкая сверху (CSS: именованная группа `group/field`, `data-filled`).

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §1, §5.4, §6.3, §6.4, §6.6, §11 («Комбобокс»), §12, §13 (план 1.5-3, блок «Решения планирования плана 1.5-3»). Аудит: [02-operation-forms.md](../../research/ux-parity/02-operation-forms.md) — M5, M11, M12, L1, L7, L8.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-3») тем же коммитом, что и план.

1. **План 1.5-3 разбит на три части:** 3a — списки и подписи (этот план), 3b — раскладка окна, строки-действия, главная кнопка, последний счёт, теги и файлы, 3c — дата и время, «Зарплата за {месяц}», калькулятор. Каждая часть заканчивается сверкой `shots:ux`.
2. **Место «+ Создать» (§6.6):** при пустом запросе — первым пунктом («+ Создать категорию», как на снимке Finmap `11`), с текстом — после найденных («+ Создать „аре“», как на `09b`), если такого названия ещё нет. Активный пункт при открытии — выбранный, иначе первый вариант (не «+ Создать»): Enter после печати выбирает первый найденный, а не создаёт. Пункт «+ Создать категорию» без названия оставляет список открытым и фокус в поле с подсказкой «Введите название».
3. **Поле со списком (§6.6, §11):** при открытом списке поле пустое, выбранное значение — в подсказке поля (печатать начинают с чистого поля); при закрытом — название выбранного. Нажатие на поле открывает и закрывает список; Enter в закрытом поле открывает список (форму не отправляет); Esc закрывает только список; Tab и уход из поля закрывают список без смены значения. Пункт «Без категории» («Без контрагента», «Без проекта», «Не менять») остаётся в списке.
4. **Бейдж «системная» и символ валюты в пунктах — только для глаз** (`aria-hidden`): доступное имя пункта — название, как его ищут и выбирают.
5. **«+ Создать» в окне «Указать» (§5.4)** — есть (те же правила создания, что в форме: категория — вида операции, контрагент — типа под системную категорию, иначе «Клиент» у дохода и «Поставщик» у расхода); созданное выбирается в поле, сохраняет «Сохранить». В «Изменить данные» «+ Создать» нет: категория там общая для доходов и расходов, вид созданной был бы неоднозначен.
6. **`Field floating`** — у полей со списком, суммы, «Доли, %» в разбиении и комментария. `MultiSelectField` окна «Фильтры» не меняется: подпись со счётчиком у него уже внутри кнопки. `DateField` получает плавающий вариант в плане 1.5-3b (для «Даты сделки»).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: выражения в сумме, RateFix, группы «{Тип}» и «Остальные» в списке контрагентов. **Мёртвых кнопок нет.**
- **Комбобокс (§6.6, §11):** ARIA 1.2 combobox — `input role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`; печать сразу открывает список и фильтрует без учёта регистра и «ё»; ↓ открывает; Enter выбирает; Esc закрывает только список; Tab закрывает без смены значения; при открытии активен выбранный пункт (решение 6a R1). Список шириной с поле, пункты `py-3 text-base`. У счёта справа символ валюты (`PickerOption.suffix`), «(KZT)» в названии нет; у системных категорий — бейдж «системная» (`PickerOption.badge`).
- **«+ Создать» (§6.6):** пустой запрос — «+ Создать категорию / контрагента / проект / тег»; есть текст — «+ Создать „{текст}“». Что создаётся — по правилам плана 6a.
- **Плавающие подписи (§6.3):** подпись внутри поля, высота около 56 px (`h-14`); пустое — подпись как подсказка, заполненное — мелкая сверху; подпись связана с полем `<label for>`. Пустое значение не пишется текстом «Без категории», «Без контрагента», «Без проекта».
- **Подпись контрагента (§6.4):** нет системной категории — «Мой контрагент»; `employee` — «Сотрудник»; `owner` — «Владелец»; `investor` — «Инвестор»; `creditor` — «Кредитор»; `borrower` — «Заёмщик»; `tax` — «Тип налога». В `shared/counterparties.ts`: «Собственник/Собственники» → «Владелец/Владельцы», «Налоговые» → «Типы налогов», «Налоговый орган» → «Тип налога».
- **Сохраняются контракты планов 6a/6b/7 и 1.5-1a:** автофокус суммы при открытии (в том числе при повторном открытии с данными в кэше), `refocusSignal`, `<fieldset disabled={pending || readOnly}>`, «Загрузить актуальную» при 409, RateFix, фокус после действий с файлами, архивная форма только для чтения (фокус на «×»), вопрос о закрытии `ConfirmDialog` с «Больше не спрашивать», форма на весь экран телефона с липкой шапкой и «×» 44 px.
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN)`; поля ввода — `amountInputText`.
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя тест возвращает в `finally`; без фиксированных пауз. Известная нестабильность: `journal-actions.spec.ts` (~555) — при единичном падении перезапустите.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Печать в поле, где уже выбрано значение** («Аренда» → набрали «интернет»): список фильтруется по набранному, а не по «Арендаинтернет»; Esc возвращает прежнее значение; Tab уходит без смены значения. Тест — задача 3 (e2e).
2. **Enter после печати, когда найден существующий пункт:** выбирается найденный, а не «+ Создать „…“»; Enter в закрытом поле не отправляет форму. Тесты — задача 1 (unit `initialActive`) и задача 3 (e2e).
3. **Esc при открытом списке внутри окна** (форма операции, «Указать»): закрывается только список — вопроса «Ваши данные не сохранятся» нет, окно открыто, фокус в поле; второй Esc — обычное поведение окна. Тест — задача 3 (e2e).
4. **«+ Создать категорию» без названия:** ничего не создаётся, список открыт, фокус в поле, подсказка «Введите название»; набранное название создаётся тем же списком. Тест — задача 4 (e2e).
5. **Повторное открытие формы с данными в кэше:** фокус по-прежнему в сумме (контракт плана 1.5-1a); поле со списком не перехватывает его. Тест — существующий `dialogs.spec.ts` (повторное открытие), прогоняется в задаче 3.

---

## Карта файлов

```
src/client/lib/picker.ts                          # (новый) PickerOption, pickerItems, createItemLabel, initialActive
src/shared/counterparties.ts                      # «Владелец(ы)», «Тип(ы) налога(ов)»
src/client/lib/operation-options.ts               # suffix у счёта, badge у системной категории, counterpartyLabel
src/client/lib/journal-assign.ts                  # assignLabel через counterpartyLabel; ASSIGN_CREATE_NOUNS, assignCreate
src/client/components/ui.ts                       # floatingControlClass, floatingTextareaClass, badgeClass
src/client/components/Field.tsx                   # floating, filled, boxRef, below
src/client/components/SearchPicker.tsx            # PickerListbox, pickerItemId; PickerList с «+ Создать» первым и «Введите название»
src/client/components/useFloating.ts              # matchWidth
src/client/components/ComboList.tsx               # (новый) useComboList
src/client/components/operation/ComboSelect.tsx   # поле ввода со списком на useComboList
src/client/components/operation/AmountField.tsx   # плавающая подпись
src/client/components/operation/SplitEditor.tsx   # createNoun, «Доля, %» с плавающей подписью, фокус новой строки
src/client/components/operation/OperationForm.tsx # createNoun, подпись контрагента, комментарий с плавающей подписью
src/client/components/journal/AssignDialog.tsx    # «+ Создать» в «Указать»
src/client/pages/JournalPage.tsx                  # companyId в AssignDialog
scripts/ux-shots.ts                               # сценарии списков (08, 09, 09b, 10, 11)
tests/client/picker.test.ts (новый), operation-options.test.ts, picker-list.test.ts, journal-assign.test.ts
e2e/operation-form.spec.ts, operation-edit.spec.ts, journal-actions.spec.ts, mobile.spec.ts
```

---

### Task 1: Правила списков — `lib/picker.ts`, символ валюты у счёта, бейдж «системная», подпись контрагента

**Files:**
- Create: `src/client/lib/picker.ts`, `tests/client/picker.test.ts`
- Modify: `src/client/components/SearchPicker.tsx` (тип `PickerOption`), `src/shared/counterparties.ts`, `src/client/lib/operation-options.ts`, `src/client/lib/journal-assign.ts`, `tests/client/operation-options.test.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes: `foldCase`, `matchesQuery` (`shared/search.ts`); `getCurrency` (`shared/currencies.ts`); `preferredCounterpartyType` (`lib/operation-options.ts`).
- Produces:
  - `interface PickerOption { id: number; label: string; section?: string; badge?: string; suffix?: string }`, `type PickerItem = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string }`, `pickerItems(options: readonly PickerOption[], query: string, createNoun?: string): PickerItem[]`, `createItemLabel(name: string, noun: string): string`, `initialActive(items: readonly PickerItem[], selectedId: number | null | undefined): number` (`lib/picker.ts`);
  - `SYSTEM_BADGE = 'системная'`, `counterpartyLabel(tree: CategoryTree, categoryId: number | null): string` (`lib/operation-options.ts`); `accountOptions` отдаёт `{ id, label: 'Касса', suffix: '₸' }`; `categoryOptions` — `badge: 'системная'` у категории с собственным `systemKey`.

- [ ] **Step 1: Write the failing unit tests**

`tests/client/picker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createItemLabel, initialActive, pickerItems, type PickerOption } from '../../src/client/lib/picker';

const options: PickerOption[] = [
  { id: 0, label: 'Без категории' },
  { id: 1, label: 'Аренда' },
  { id: 2, label: 'Ёлки' },
  { id: 3, label: 'Аренда склада' },
];
const labels = (items: ReturnType<typeof pickerItems>) => items.map((it) => (it.kind === 'option' ? it.option.label : `create:${it.name}`));

describe('pickerItems — пункты списка с поиском (§6.6 этапа 1.5)', () => {
  it('без «+ Создать»: варианты, подходящие под запрос без учёта регистра и «ё»; пустой запрос — все', () => {
    expect(labels(pickerItems(options, ''))).toEqual(['Без категории', 'Аренда', 'Ёлки', 'Аренда склада']);
    expect(labels(pickerItems(options, '  АРЕН '))).toEqual(['Аренда', 'Аренда склада']);
    expect(labels(pickerItems(options, 'елки'))).toEqual(['Ёлки']);
    expect(pickerItems(options, 'нет такого')).toEqual([]);
  });

  it('с «+ Создать»: пустой запрос — пункт первым; с текстом — после найденных, если такого названия ещё нет', () => {
    expect(labels(pickerItems(options, '', 'категорию'))).toEqual(['create:', 'Без категории', 'Аренда', 'Ёлки', 'Аренда склада']);
    expect(labels(pickerItems(options, 'арен', 'категорию'))).toEqual(['Аренда', 'Аренда склада', 'create:арен']);
    expect(labels(pickerItems(options, '  Интернет ', 'категорию'))).toEqual(['create:Интернет']);
    // такое название уже есть (без учёта регистра и «ё») — создавать нечего
    expect(labels(pickerItems(options, 'аренда', 'категорию'))).toEqual(['Аренда', 'Аренда склада']);
    expect(labels(pickerItems(options, 'ЕЛКИ', 'категорию'))).toEqual(['Ёлки']);
  });

  it('подпись пункта «+ Создать»', () => {
    expect(createItemLabel('', 'категорию')).toBe('+ Создать категорию');
    expect(createItemLabel('Аренда', 'категорию')).toBe('+ Создать „Аренда“');
  });
});

describe('initialActive — активный пункт при открытии и после нового запроса', () => {
  it('выбранный; без выбранного — первый вариант, а не «+ Создать»; только «+ Создать» — он', () => {
    expect(initialActive(pickerItems(options, '', 'категорию'), 3)).toBe(4);
    expect(initialActive(pickerItems(options, '', 'категорию'), null)).toBe(1);
    expect(initialActive(pickerItems(options, '', 'категорию'), 99)).toBe(1);
    // Enter после печати выбирает найденное, а не создаёт (Review Focus 2)
    expect(initialActive(pickerItems(options, 'арен', 'категорию'), undefined)).toBe(0);
    expect(initialActive(pickerItems(options, 'Интернет', 'категорию'), undefined)).toBe(0);
    expect(initialActive([], null)).toBe(0);
  });
});
```

В `tests/client/operation-options.test.ts`:

1) Импорт

```ts
import {
  accountOptions,
  categoryOptions,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  tagOptions,
} from '../../src/client/lib/operation-options';
```

замените на

```ts
import {
  accountOptions,
  categoryOptions,
  counterpartyLabel,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  tagOptions,
} from '../../src/client/lib/operation-options';
```

2) Строки

```ts
    expect(accountOptions(accounts, null)).toEqual([{ id: 1, label: 'Касса (KZT)' }]);
    expect(accountOptions(accounts, 2)).toEqual([
      { id: 1, label: 'Касса (KZT)' },
      { id: 2, label: 'Старый (USD) (в архиве)' },
    ]);
```

замените на

```ts
    // символ валюты — справа в пункте (suffix), в названии «(KZT)» нет (§6.6 этапа 1.5)
    expect(accountOptions(accounts, null)).toEqual([{ id: 1, label: 'Касса', suffix: '₸' }]);
    expect(accountOptions(accounts, 2)).toEqual([
      { id: 1, label: 'Касса', suffix: '₸' },
      { id: 2, label: 'Старый (в архиве)', suffix: '$' },
    ]);
```

3) Перед `it('эффективный systemKey дочерней категории …` вставьте:

```ts
  it('бейдж «системная» — только у категории с собственным systemKey, не у её дочерних (как в журнале)', () => {
    const options = categoryOptions(tree, 'expense', []);
    expect(options.find((o) => o.label === 'Зарплата')).toEqual({ id: 10, label: 'Зарплата', badge: 'системная' });
    expect(options.find((o) => o.label === 'Зарплата → Администраторы')).toEqual({ id: 11, label: 'Зарплата → Администраторы' });
    expect(options.find((o) => o.label === 'Помещение')).toEqual({ id: 20, label: 'Помещение' });
  });

  it('подпись поля контрагента — по системной категории (§6.4 этапа 1.5)', () => {
    const system = (id: number, name: string, key: string): CategoryNode => node(id, name, { systemKey: key, effectiveSystemKey: key });
    const all: CategoryTree = {
      income: [system(101, 'Инвестиции', 'investment'), system(102, 'Возврат займа', 'loan_repaid'), system(103, 'Получение кредита', 'credit_received')],
      expense: [...tree.expense, system(104, 'Дивиденды', 'dividends'), system(105, 'Налоги', 'tax')],
    };
    expect(counterpartyLabel(all, null)).toBe('Мой контрагент');
    expect(counterpartyLabel(all, 21)).toBe('Мой контрагент');
    expect(counterpartyLabel(all, 10)).toBe('Сотрудник');
    expect(counterpartyLabel(all, 11)).toBe('Сотрудник');
    expect(counterpartyLabel(all, 104)).toBe('Владелец');
    expect(counterpartyLabel(all, 101)).toBe('Инвестор');
    expect(counterpartyLabel(all, 103)).toBe('Кредитор');
    expect(counterpartyLabel(all, 102)).toBe('Заёмщик');
    expect(counterpartyLabel(all, 105)).toBe('Тип налога');
  });
```

Run: `npx vitest run tests/client/picker.test.ts tests/client/operation-options.test.ts` → FAIL (`lib/picker` нет, `counterpartyLabel` не экспортируется, у счёта прежняя подпись).

- [ ] **Step 2: `lib/picker.ts`**

`src/client/lib/picker.ts`:

```ts
import { foldCase, matchesQuery } from '../../shared/search';

/** Пункт выпадающего списка формы и окон журнала (§6.6 этапа 1.5). */
export interface PickerOption {
  id: number;
  label: string;
  /** Заголовок группы: показывается перед первым вариантом группы (например, «Сотрудники»). */
  section?: string;
  /** Бейдж после названия — «системная» у системной категории. Только для глаз: имя пункта — label. */
  badge?: string;
  /** Текст справа — символ валюты у счёта. Только для глаз: имя пункта — label. */
  suffix?: string;
}

export type PickerItem = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string };

/**
 * Пункты списка с поиском (§6.6 этапа 1.5): варианты, подходящие под запрос (без учёта регистра и «ё», тем же правилом,
 * что сервер), и с `createNoun` — пункт «+ Создать»: при пустом запросе первым («+ Создать категорию», снимок Finmap 11),
 * с текстом — после найденных («+ Создать „аре“», снимок 09b), если такого названия ещё нет.
 */
export function pickerItems(options: readonly PickerOption[], query: string, createNoun?: string): PickerItem[] {
  const name = query.trim();
  const shown: PickerItem[] = options.filter((o) => matchesQuery(o.label, name)).map((option) => ({ kind: 'option', option }));
  if (createNoun === undefined) return shown;
  if (name === '') return [{ kind: 'create', name: '' }, ...shown];
  const exists = options.some((o) => foldCase(o.label) === foldCase(name));
  return exists ? shown : [...shown, { kind: 'create', name }];
}

/** Подпись пункта «+ Создать»: без названия — «+ Создать категорию», с названием — «+ Создать „Аренда“». */
export function createItemLabel(name: string, noun: string): string {
  return name === '' ? `+ Создать ${noun}` : `+ Создать „${name}“`;
}

/**
 * Активный пункт при открытии списка и после нового запроса: выбранный (решение 6a R1), иначе первый вариант —
 * не «+ Создать»: Enter после печати выбирает найденное. Если вариантов нет — первый пункт («+ Создать „…“»).
 */
export function initialActive(items: readonly PickerItem[], selectedId: number | null | undefined): number {
  const selected = items.findIndex((it) => it.kind === 'option' && it.option.id === selectedId);
  if (selected >= 0) return selected;
  const first = items.findIndex((it) => it.kind === 'option');
  return first >= 0 ? first : 0;
}
```

В `src/client/components/SearchPicker.tsx` блок

```ts
export interface PickerOption {
  id: number;
  label: string;
  /** Заголовок группы: показывается перед первым вариантом группы (например, «Сотрудники»). */
  section?: string;
}
```

замените на

```ts
import type { PickerOption } from '../lib/picker';

export type { PickerOption } from '../lib/picker';
```

(перенесите строку `import type { PickerOption } from '../lib/picker';` к остальным импортам в начале файла, если линтер/порядок этого требует; на работу это не влияет).

- [ ] **Step 3: Renames in `shared/counterparties.ts`**

В `src/shared/counterparties.ts`: в `COUNTERPARTY_TYPE_LABELS` строки `  owner: 'Собственники',` → `  owner: 'Владельцы',` и `  tax: 'Налоговые',` → `  tax: 'Типы налогов',`; в `COUNTERPARTY_TYPE_SINGULAR` строки `  owner: 'Собственник',` → `  owner: 'Владелец',` и `  tax: 'Налоговый орган',` → `  tax: 'Тип налога',`. Комментарии к константам дополните: `/** Подписи вкладок и групп списка (множественное число, как в Finmap — §6.4 этапа 1.5). */` и `/** Подписи в списке выбора типа и поля контрагента (единственное число). */`.

- [ ] **Step 4: `lib/operation-options.ts`**

1) Импорты в начале файла

```ts
import { COUNTERPARTY_TYPE_LABELS } from '../../shared/counterparties';
import { SYSTEM_CATEGORIES, type CounterpartyType } from '../../shared/system-categories';
import type { PickerOption } from '../components/SearchPicker';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';
```

замените на

```ts
import { COUNTERPARTY_TYPE_LABELS, COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import { getCurrency } from '../../shared/currencies';
import { SYSTEM_CATEGORIES, type CounterpartyType } from '../../shared/system-categories';
import type { PickerOption } from './picker';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';
```

2) Функции `accountOptions` и `categoryOptions` целиком

```ts
export function accountOptions(accounts: readonly Account[], selected: number | null): PickerOption[] {
  return accounts.filter((a) => keep(a, [selected])).map((a) => ({ id: a.id, label: mark(`${a.name} (${a.currency})`, a) }));
}

/** Категории вида kind: «Родитель», «Родитель → Дочерняя». Дочерняя архивного родителя тоже считается архивной. */
export function categoryOptions(tree: CategoryTree, kind: 'income' | 'expense', selected: readonly (number | null)[]): PickerOption[] {
  return tree[kind].flatMap((n) => [
    ...(keep(n, selected) ? [{ id: n.id, label: mark(n.name, n) }] : []),
    ...n.children
      .map((c) => ({ ...c, archivedAt: c.archivedAt ?? n.archivedAt }))
      .filter((c) => keep(c, selected))
      .map((c) => ({ id: c.id, label: mark(`${n.name} → ${c.name}`, c) })),
  ]);
}
```

замените на

```ts
/** Бейдж системной категории в списках (§6.6 этапа 1.5) — тот же текст, что в журнале. */
export const SYSTEM_BADGE = 'системная';

/** Счета: название, символ валюты — справа в пункте (§6.6 этапа 1.5: «(KZT)» в названии нет). */
export function accountOptions(accounts: readonly Account[], selected: number | null): PickerOption[] {
  return accounts.filter((a) => keep(a, [selected])).map((a) => ({ id: a.id, label: mark(a.name, a), suffix: getCurrency(a.currency).symbol }));
}

/** Бейдж «системная» — у категории с собственным systemKey (у дочерних системной его нет, как в журнале). */
const withBadge = (option: PickerOption, node: Pick<CategoryNode, 'systemKey'>): PickerOption => (node.systemKey ? { ...option, badge: SYSTEM_BADGE } : option);

/** Категории вида kind: «Родитель», «Родитель → Дочерняя». Дочерняя архивного родителя тоже считается архивной. */
export function categoryOptions(tree: CategoryTree, kind: 'income' | 'expense', selected: readonly (number | null)[]): PickerOption[] {
  return tree[kind].flatMap((n) => [
    ...(keep(n, selected) ? [withBadge({ id: n.id, label: mark(n.name, n) }, n)] : []),
    ...n.children
      .map((c) => ({ ...c, archivedAt: c.archivedAt ?? n.archivedAt }))
      .filter((c) => keep(c, selected))
      .map((c) => withBadge({ id: c.id, label: mark(`${n.name} → ${c.name}`, c) }, c)),
  ]);
}
```

3) После функции `preferredCounterpartyType` вставьте:

```ts
/**
 * Подпись поля контрагента (§6.4 этапа 1.5): по системной категории операции — «Сотрудник», «Владелец», «Инвестор»,
 * «Кредитор», «Заёмщик», «Тип налога»; без системной категории — «Мой контрагент», как в Finmap.
 */
export function counterpartyLabel(tree: CategoryTree, categoryId: number | null): string {
  const preferred = preferredCounterpartyType(tree, categoryId);
  return preferred ? COUNTERPARTY_TYPE_SINGULAR[preferred] : 'Мой контрагент';
}
```

- [ ] **Step 5: `lib/journal-assign.ts` — та же подпись**

1) Строки импорта

```ts
import { COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import type { PickerOption } from '../components/SearchPicker';
import { categoryOptions, counterpartyOptions, preferredCounterpartyType, projectOptions } from './operation-options';
```

замените на

```ts
import { categoryOptions, counterpartyLabel, counterpartyOptions, preferredCounterpartyType, projectOptions } from './operation-options';
import type { PickerOption } from './picker';
```

2) В `assignLabel` строки

```ts
  const preferred = preferredCounterpartyType(tree, singleCategory(item));
  return preferred ? COUNTERPARTY_TYPE_SINGULAR[preferred] : 'Мой контрагент';
```

замените на

```ts
  return counterpartyLabel(tree, singleCategory(item));
```

Run: `npx vitest run tests/client/picker.test.ts tests/client/operation-options.test.ts tests/client/journal-assign.test.ts` → PASS. Run: `npm run typecheck` → без ошибок.

- [ ] **Step 6: E2E — счёт без «(KZT)» в названии**

В `e2e/operation-form.spec.ts` замените (все вхождения):
- `pick(page, 'Счёт', 'Касса (KZT)')` → `pick(page, 'Счёт', 'Касса')` (2 места);
- `pick(page, 'Со счёта', 'Касса (KZT)')` → `pick(page, 'Со счёта', 'Касса')` (2 места);
- `pick(page, 'На счёт', 'Валютный (USD)')` → `pick(page, 'На счёт', 'Валютный')` (2 места).

В `e2e/operation-edit.spec.ts`:
- `dialog.getByRole('button', { name: 'Счёт: Касса (KZT)' })` → `dialog.getByRole('button', { name: 'Счёт: Касса' })`;
- `dialog.getByRole('button', { name: 'Счёт: Старый (KZT) (в архиве)' })` → `dialog.getByRole('button', { name: 'Счёт: Старый (в архиве)' })`.

(Символ валюты в пункте задача 1 ещё не рисует — он появится в задаче 2; имя пункта уже «Касса».)

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS (672 + 5 новых). Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/picker.ts tests/client/picker.test.ts src/client/components/SearchPicker.tsx src/shared/counterparties.ts src/client/lib/operation-options.ts src/client/lib/journal-assign.ts tests/client/operation-options.test.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts
git commit -m "feat: правила списков формы — «+ Создать» по месту Finmap, символ валюты у счёта, бейдж «системная», подпись контрагента «Мой контрагент»/«Владелец»/«Тип налога»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Плавающие подписи `Field floating`; список с «+ Создать» первым, бейджем и символом валюты

**Files:**
- Modify: `src/client/components/ui.ts`, `src/client/components/Field.tsx`, `src/client/components/SearchPicker.tsx`, `src/client/components/operation/ComboSelect.tsx`, `src/client/components/operation/AmountField.tsx`, `src/client/components/operation/SplitEditor.tsx`, `src/client/components/operation/OperationForm.tsx`, `tests/client/picker-list.test.ts`, `e2e/operation-form.spec.ts`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `pickerItems`, `createItemLabel`, `initialActive`, `PickerItem`, `PickerOption` (задача 1).
- Produces:
  - `floatingControlClass`, `floatingTextareaClass`, `badgeClass` (`components/ui.ts`);
  - `Field` — новые необязательные свойства `floating?: boolean`, `filled?: boolean`, `boxRef?: Ref<HTMLDivElement>`, `below?: ReactNode`;
  - `pickerItemId(listId: string, it: PickerItem): string`, `PickerListbox(props: { id: string; label: string; items: readonly PickerItem[]; active: number; selectedId?: number | null; createNoun?: string; onChoose: (it: PickerItem) => void; onHover: (index: number) => void; className?: string })` (`components/SearchPicker.tsx`);
  - `PickerList` и `SearchPicker` — новое свойство `createNoun?: string` (обязательно вместе с `onCreate`); `ComboSelect` — новое свойство `createNoun?: string`.

- [ ] **Step 1: Update the PickerList render test (fails)**

`tests/client/picker-list.test.ts` целиком:

```ts
import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PickerList } from '../../src/client/components/SearchPicker';

const options = [
  { id: 1, label: 'Касса', suffix: '₸' },
  { id: 2, label: 'Карта' },
  { id: 3, label: 'Депозит', badge: 'системная' },
];

const render = (selectedId: number | null, create = false) =>
  renderToString(
    createElement(
      StrictMode,
      null,
      createElement(PickerList, { label: 'Счета', options, onPick: () => {}, selectedId, ...(create ? { onCreate: () => {}, createNoun: 'счёт' } : {}) }),
    ),
  );

/** Пункт, на который указывает aria-activedescendant: [0] — открывающий тег и название, [1] — название. */
const activeOption = (html: string) => {
  const id = /aria-activedescendant="([^"]+)"/.exec(html)?.[1];
  expect(id).toBeTruthy();
  return new RegExp(`<li id="${id!.replace(/[:.]/g, '\\$&')}"[^>]*><span[^>]*>([^<]*)</span>`).exec(html);
};

// Проверяется только первая отрисовка (на сервере эффекты не выполняются). Повторное открытие списка
// и StrictMode-эффект проверяет e2e/operation-form.spec.ts (aria-activedescendant после повторного открытия).
describe('PickerList: активный пункт при первой отрисовке', () => {
  it('при открытии активен выбранный пункт и он отмечен aria-selected', () => {
    const li = activeOption(render(3));
    expect(li?.[1]).toBe('Депозит');
    expect(li?.[0]).toContain('aria-selected="true"');
  });

  it('без выбранного значения активен первый пункт, aria-selected нигде нет', () => {
    const html = render(null);
    expect(activeOption(html)?.[1]).toBe('Касса');
    expect(html).not.toContain('aria-selected="true"');
  });
});

describe('PickerList: «+ Создать», бейдж и символ валюты (§6.6 этапа 1.5)', () => {
  it('«+ Создать счёт» — первым пунктом, но активен первый вариант', () => {
    const html = render(null, true);
    expect(/<li[^>]*role="option"[^>]*><span[^>]*>([^<]*)<\/span>/.exec(html)?.[1]).toBe('+ Создать счёт');
    expect(activeOption(html)?.[1]).toBe('Касса');
  });

  it('бейдж и символ валюты видны, но скрыты от программ чтения: имя пункта — название', () => {
    const html = render(null);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>системная<\/span>/);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>₸<\/span>/);
  });
});
```

Run: `npx vitest run tests/client/picker-list.test.ts` → FAIL (название не в `<span>`, нет «+ Создать счёт», бейджа и символа).

- [ ] **Step 2: Classes in `ui.ts`**

В `src/client/components/ui.ts` после строки `export const inputClass = …` вставьте:

```ts
/**
 * Поле с плавающей подписью (§6.3 этапа 1.5): высота 56 px, место под мелкую подпись сверху. Подпись рисует `Field floating`.
 */
export const floatingControlClass = 'block h-14 w-full rounded-xl bg-field px-4 pt-5 pb-1 text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
/** Многострочное поле с плавающей подписью (комментарий). */
export const floatingTextareaClass = 'block w-full rounded-xl bg-field px-4 pt-6 pb-2 text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
/** Бейдж «системная» (§5.2, §6.6 этапа 1.5): текст income-strong на income-soft — 4,7:1. */
export const badgeClass = 'shrink-0 rounded bg-income-soft px-1.5 py-0.5 text-[11px] font-medium text-income-strong';
```

- [ ] **Step 3: `Field floating`**

`src/client/components/Field.tsx` целиком:

```tsx
import { useId, type ReactNode, type Ref } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Плавающая подпись (§6.3 этапа 1.5): пустое поле без фокуса — подпись на месте значения, как подсказка; поле
 * с значением (`data-filled`) или в фокусе — мелкая подпись сверху. Нажатие на подпись проходит в поле (pointer-events-none).
 */
const floatingLabelClass =
  'pointer-events-none absolute top-1/2 left-4 z-[1] max-w-[calc(100%-3.5rem)] -translate-y-1/2 truncate text-base text-muted transition-all group-focus-within/field:top-2 group-focus-within/field:translate-y-0 group-focus-within/field:text-xs group-data-[filled]/field:top-2 group-data-[filled]/field:translate-y-0 group-data-[filled]/field:text-xs';

/**
 * Подпись, подсказка и ошибка поля, связанные с элементом ввода: label for, aria-invalid, aria-describedby.
 * `floating` — подпись внутри рамки поля (§6.3 этапа 1.5); элемент ввода должен быть с `floatingControlClass`
 * (или своей рамкой высотой не меньше 56 px), `filled` — в поле есть значение. `boxRef` — рамка поля (от неё
 * выпадающий список считает место и ширину), `below` — содержимое под рамкой, до подсказки (ряд операторов суммы).
 */
export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  floating?: boolean;
  filled?: boolean;
  boxRef?: Ref<HTMLDivElement>;
  below?: ReactNode;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ');
  const control: FieldControlProps = {
    id,
    ...(props.error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
  return (
    <div className={props.className ?? 'block'}>
      {props.floating ? (
        <div ref={props.boxRef} data-filled={props.filled ? '' : undefined} className="group/field relative">
          {props.children(control)}
          <label htmlFor={id} className={floatingLabelClass}>
            {props.label}
          </label>
        </div>
      ) : (
        <>
          <label htmlFor={id} className="mb-1 block text-sm text-muted">
            {props.label}
          </label>
          {props.children(control)}
        </>
      )}
      {props.below}
      {props.hint && (
        <span id={hintId} className="mt-1 block text-xs text-muted">
          {props.hint}
        </span>
      )}
      {props.error && (
        <span id={errorId} className="mt-1 block text-sm text-expense">
          {props.error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `PickerListbox` and `PickerList` in `SearchPicker.tsx`**

`src/client/components/SearchPicker.tsx` целиком:

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createItemLabel, initialActive, pickerItems, type PickerItem, type PickerOption } from '../lib/picker';
import { Popover } from './Popover';
import { badgeClass } from './ui';

export type { PickerOption } from '../lib/picker';

/** id пункта списка — для aria-activedescendant поля. */
export const pickerItemId = (listId: string, it: PickerItem): string => (it.kind === 'option' ? `${listId}-${it.option.id}` : `${listId}-create`);

/**
 * Список вариантов (шаблон combobox + listbox, §6.6 этапа 1.5) без поля ввода: поле — у владельца (`PickerList`,
 * поле со списком формы), фокус всегда в нём, активный пункт — `aria-activedescendant`. Пункты `py-3 text-base`;
 * у варианта справа — бейдж («системная») и символ валюты, оба только для глаз (имя пункта — название); варианты
 * с `section` собираются в группы (`role="group"` с названием). Нажатие мышью не уводит фокус из поля.
 */
export function PickerListbox(props: {
  id: string;
  label: string;
  items: readonly PickerItem[];
  active: number;
  /** Уже выбранное значение: отмечено `aria-selected`. */
  selectedId?: number | null;
  /** Что создаёт пункт «+ Создать»: «категорию». */
  createNoun?: string;
  onChoose: (it: PickerItem) => void;
  onHover: (index: number) => void;
  className?: string;
}) {
  const current = props.items.length > 0 ? props.items[Math.min(props.active, props.items.length - 1)] : undefined;
  const currentId = current ? pickerItemId(props.id, current) : null;

  useEffect(() => {
    if (currentId) document.getElementById(currentId)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  // подряд идущие пункты одной группы — вместе; пункты без группы и «+ Создать» — сами по себе
  const groups: { section?: string; entries: { it: PickerItem; i: number }[] }[] = [];
  props.items.forEach((it, i) => {
    const section = it.kind === 'option' ? it.option.section : undefined;
    const last = groups[groups.length - 1];
    if (section && last?.section === section) last.entries.push({ it, i });
    else groups.push({ section, entries: [{ it, i }] });
  });

  const optionItem = ({ it, i }: { it: PickerItem; i: number }) => {
    const selected = it.kind === 'option' && it.option.id === props.selectedId;
    return (
      <li
        key={pickerItemId(props.id, it)}
        id={pickerItemId(props.id, it)}
        role="option"
        aria-selected={selected}
        // фокус остаётся в поле ввода
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => props.onHover(i)}
        onClick={() => props.onChoose(it)}
        className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-3 text-base ${it === current ? 'bg-field' : ''} ${selected ? 'font-semibold' : ''} ${it.kind === 'create' ? 'font-medium text-income-strong' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">{it.kind === 'option' ? it.option.label : createItemLabel(it.name, props.createNoun ?? '')}</span>
        {it.kind === 'option' && it.option.badge && (
          <span aria-hidden="true" className={badgeClass}>
            {it.option.badge}
          </span>
        )}
        {it.kind === 'option' && it.option.suffix && (
          <span aria-hidden="true" className="shrink-0 text-muted">
            {it.option.suffix}
          </span>
        )}
      </li>
    );
  };

  return (
    <ul id={props.id} role="listbox" aria-label={props.label} className={props.className}>
      {groups.map((g) =>
        g.section ? (
          <li key={`section-${g.entries[0]!.i}`} role="group" aria-label={g.section}>
            <span aria-hidden="true" className="block px-3 pt-2 pb-1 text-xs font-semibold text-muted">
              {g.section}
            </span>
            <ul role="none">{g.entries.map(optionItem)}</ul>
          </li>
        ) : (
          g.entries.map(optionItem)
        ),
      )}
    </ul>
  );
}

/**
 * Список с полем поиска (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают активный пункт
 * (`aria-activedescendant`), Enter выбирает, Esc закрывает. При открытии активен уже выбранный пункт
 * (`selectedId`, у него `aria-selected`). Поиск — без учёта регистра и «ё» (§6.1). С `onCreate` есть пункт
 * «+ Создать» (§6.6 этапа 1.5): при пустом запросе — первым («+ Создать тег»; нажатие оставляет фокус в поиске
 * с подсказкой «Введите название»), с текстом — после найденных, если такого названия ещё нет.
 */
export function PickerList(props: {
  label: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  onCreate?: (name: string) => void;
  /** Что создаёт «+ Создать»: «тег». Обязательно вместе с onCreate. */
  createNoun?: string;
  /** Уже выбранное значение: активно при открытии, отмечено `aria-selected`. */
  selectedId?: number | null;
}) {
  const noun = props.onCreate ? (props.createNoun ?? '') : undefined;
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [active, setActive] = useState(() => initialActive(pickerItems(props.options, '', noun), props.selectedId));
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const items = pickerItems(props.options, query, noun);
  const current = items.length > 0 ? items[Math.min(active, items.length - 1)] : undefined;

  const choose = (it: PickerItem) => {
    if (it.kind === 'option') props.onPick(it.option.id);
    else if (it.name !== '') props.onCreate?.(it.name);
    else {
      // «+ Создать тег» без названия: ничего не создаётся, фокус — в поиске с подсказкой
      setNaming(true);
      searchRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(a + 1, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) choose(current);
    }
  };

  return (
    <div>
      <input
        ref={searchRef}
        role="combobox"
        aria-label={`${props.label}: поиск`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? pickerItemId(listId, current) : undefined}
        value={query}
        onChange={(e) => {
          // новый запрос — снова первый найденный пункт (сброс здесь, а не в эффекте: эффект при открытии затёр бы выбранный пункт)
          setQuery(e.target.value);
          setActive(initialActive(pickerItems(props.options, e.target.value, noun), undefined));
        }}
        onKeyDown={onKeyDown}
        placeholder={naming ? 'Введите название' : 'Поиск'}
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <PickerListbox
        id={listId}
        label={props.label}
        items={items}
        active={active}
        selectedId={props.selectedId}
        createNoun={props.createNoun}
        onChoose={choose}
        onHover={setActive}
        className="max-h-60 overflow-y-auto"
      />
      {items.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
    </div>
  );
}

/** Кнопка с выпадающим списком с поиском: «Применить шаблон» в разбиении, «+ Тег» в форме. */
export function SearchPicker(props: {
  label: string;
  ariaLabel?: string;
  /** Название списка для программ чтения с экрана. */
  listLabel: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  /** «+ Создать»: создаёт элемент с набранным названием (§7). */
  onCreate?: (name: string) => void;
  /** Что создаёт «+ Создать»: «тег». Обязательно вместе с onCreate. */
  createNoun?: string;
  buttonClassName?: string;
  align?: 'left' | 'right';
  /** Недоступна без потери фокуса (aria-disabled) — см. Popover. */
  inactive?: boolean;
}) {
  return (
    <Popover
      label={props.label}
      ariaLabel={props.ariaLabel}
      buttonClassName={props.buttonClassName}
      align={props.align}
      inactive={props.inactive}
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
          onCreate={
            props.onCreate &&
            ((name) => {
              close(true);
              props.onCreate!(name);
            })
          }
          createNoun={props.createNoun}
        />
      )}
    </Popover>
  );
}
```

- [ ] **Step 5: `createNoun` through `ComboSelect` and the forms**

В `src/client/components/operation/ComboSelect.tsx`:
1) в тип свойств после строки `  onCreate?: (name: string) => void;` вставьте `  /** Что создаёт «+ Создать»: «категорию», «контрагента», «проект». Обязательно вместе с onCreate. */` и `  createNoun?: string;`;
2) в `<PickerList` после блока `onCreate={…}` (перед `/>`) вставьте строку `              createNoun={props.createNoun}`.

В `src/client/components/operation/OperationForm.tsx`:
- у `ComboSelect` с `label="Категория"` после строки `onCreate={(name) => void createItem('category', name, (d, categoryId) => ({ ...d, categoryId }))}` вставьте `                createNoun="категорию"`;
- у `ComboSelect` с `label="Контрагент"` после строки `onCreate={(name) => void createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId }))}` вставьте `            createNoun="контрагента"`;
- у `ComboSelect` с `label="Проект"` после строки `onCreate={(name) => void createItem('project', name, (d, projectId) => ({ ...d, projectId }))}` вставьте `                createNoun="проект"`;
- в `TagsField` у `<SearchPicker` после строки `          onCreate={props.onCreate}` вставьте `          createNoun="тег"`;
- блок комментария

```tsx
            <Field label="Комментарий" error={errors.comment} className="md:col-span-2">
              {(c) => (
                <textarea {...c} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={inputClass} />
              )}
            </Field>
```

замените на

```tsx
            <Field label="Комментарий" error={errors.comment} className="md:col-span-2" floating filled={draft.comment !== ''}>
              {(c) => (
                <textarea
                  {...c}
                  rows={2}
                  maxLength={COMMENT_MAX}
                  value={draft.comment}
                  onChange={(e) => set({ comment: e.target.value }, 'comment')}
                  className={floatingTextareaClass}
                />
              )}
            </Field>
```

и в импорте из `'../ui'` добавьте `floatingTextareaClass` (строка `import { alertClass, btnDanger, btnPrimary, btnSecondary, btnSmall, floatingTextareaClass, inputClass, noticeClass } from '../ui';`).

В `src/client/components/operation/SplitEditor.tsx`:
- у `ComboSelect` с `label="Категория"` после строки `onCreate={props.onCreateCategory && ((name) => props.onCreateCategory!(name, line.key))}` вставьте `            createNoun="категорию"`;
- у `ComboSelect` с `label="Проект"` после строки `onCreate={props.onCreateProject && ((name) => props.onCreateProject!(name, line.key))}` вставьте `            createNoun="проект"`;
- поле «Доля, %»:

```tsx
            <Field
              label="Доля, %"
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency, MONEY_SCREEN)}` : undefined}
            >
              {(c) => <input {...c} inputMode="decimal" autoComplete="off" value={line.value} onChange={(e) => setLine(i, { value: e.target.value })} className={inputClass} />}
            </Field>
```

замените на

```tsx
            <Field
              label="Доля, %"
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency, MONEY_SCREEN)}` : undefined}
              floating
              filled={line.value !== ''}
            >
              {(c) => (
                <input {...c} inputMode="decimal" autoComplete="off" value={line.value} onChange={(e) => setLine(i, { value: e.target.value })} className={floatingControlClass} />
              )}
            </Field>
```

и строку импорта `import { btnSmall, inputClass } from '../ui';` замените на `import { btnSmall, floatingControlClass, inputClass } from '../ui';`; у кнопки «Убрать строку» класс `` className={`${btnSmall} md:mt-7`} `` замените на `` className={`${btnSmall} md:mt-3`} `` (подписи теперь внутри полей).

- [ ] **Step 6: `AmountField` with a floating label**

В `src/client/components/operation/AmountField.tsx`:
1) строку `import { inputClass } from '../ui';` замените на `import { floatingControlClass } from '../ui';`;
2) блок `return (` … `);` компонента целиком замените на:

```tsx
  // ряд операторов — под рамкой поля (Field below), чтобы плавающая подпись стояла по центру самого поля
  const operators = props.disabled ? null : (
    <div role="group" aria-label={`Операторы: ${props.label}`} className="mt-2 grid grid-cols-4 gap-2 md:hidden">
      {OPERATORS.map((op) => (
        <button
          key={op.symbol}
          type="button"
          aria-label={`Оператор ${op.name}`}
          // фокус остаётся в поле: выражение не вычисляется посреди набора
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(op.symbol)}
          className="rounded-xl bg-field py-2 text-lg font-semibold"
        >
          {op.symbol}
        </button>
      ))}
    </div>
  );

  return (
    <Field
      label={props.label}
      error={props.error ?? calcError ?? undefined}
      hint={props.hint}
      className={props.className}
      floating
      filled={props.value !== ''}
      below={operators}
    >
      {(c) => (
        <input
          {...c}
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          maxLength={CALC_MAX_LENGTH}
          disabled={props.disabled}
          value={props.value}
          onChange={(e) => {
            props.onChange(e.target.value);
            setCalcError(null);
          }}
          onBlur={evaluate}
          className={`${floatingControlClass} font-semibold tabular-nums`}
        />
      )}
    </Field>
  );
```

(подсказка `placeholder="0"` убрана: на её месте теперь подпись поля).

Run: `npx vitest run tests/client/picker-list.test.ts` → PASS. Run: `npm run typecheck` → без ошибок.

- [ ] **Step 7: E2E — «+ Создать» первым, бейдж в тексте пункта**

В `e2e/operation-form.spec.ts` (тест «ошибки у полей…»):
- `await expect(people).toHaveText(['Без контрагента', 'Айгерим', 'ТОО Ромашка']);` → `await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'Айгерим', 'ТОО Ромашка']);`
- `await expect(people).toHaveText(['Без контрагента', 'ТОО Ромашка', 'Айгерим']);` → `await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'ТОО Ромашка', 'Айгерим']);`

В `e2e/journal-actions.spec.ts` (тест «„Указать“: окно …»): строку

```ts
  await expect(categoryOptions).toHaveText(['Инвестиции', 'Возврат займа', 'Получение кредита', 'Бар', 'Игровое время']);
```

замените на

```ts
  // у системных категорий — бейдж «системная» (его текст входит в текст пункта, но не в имя)
  await expect(categoryOptions).toHaveText([/^Инвестиции/, /^Возврат займа/, /^Получение кредита/, 'Бар', 'Игровое время']);
```

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS (+2 новых). Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/ui.ts src/client/components/Field.tsx src/client/components/SearchPicker.tsx src/client/components/operation/ComboSelect.tsx src/client/components/operation/AmountField.tsx src/client/components/operation/SplitEditor.tsx src/client/components/operation/OperationForm.tsx tests/client/picker-list.test.ts e2e/operation-form.spec.ts e2e/journal-actions.spec.ts
git commit -m "feat: плавающие подписи полей; списки с «+ Создать» первым, бейджем «системная» и символом валюты

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Поле со списком — ввод прямо в поле (`useComboList`, `ComboSelect`)

**Files:**
- Create: `src/client/components/ComboList.tsx`
- Modify: `src/client/components/useFloating.ts`, `src/client/components/operation/ComboSelect.tsx`, `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/SplitEditor.tsx`, `src/client/components/journal/AssignDialog.tsx`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `pickerItems`, `initialActive`, `PickerItem`, `PickerOption` (задача 1); `PickerListbox`, `pickerItemId`, `Field` с `floating`/`filled`/`boxRef`, `floatingControlClass` (задача 2); `counterpartyLabel` (задача 1).
- Produces:
  - `useFloating(open, anchorRef, floatingRef, align = 'left', matchWidth = false)` — с `matchWidth` панель шириной с якорь;
  - `interface ComboListOptions { listLabel: string; options: readonly PickerOption[]; selectedId: number | null; text: string; onPick: (id: number) => void; onCreate?: (name: string) => void; createNoun?: string }`, `interface ComboList { open: boolean; inputProps: ComboInputProps; anchorRef: RefObject<HTMLDivElement | null>; list: ReactNode }`, `useComboList(o: ComboListOptions): ComboList` (`components/ComboList.tsx`) — план 1.5-3b строит на нём поле тегов;
  - `ComboSelect` — те же свойства, что раньше (`placeholder` больше не используется и удаляется из типа); доступное имя поля — подпись (`combobox` «Категория»), значение — название выбранного (`toHaveValue`).

- [ ] **Step 1: `useFloating` — width of the anchor**

`src/client/components/useFloating.ts` целиком:

```ts
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placeFloating, type FloatingPosition } from '../lib/floating';

/**
 * Стиль всплывающего элемента (панели, подсказки, списка), который рисуется порталом с position: fixed: место
 * считается от якоря до первой отрисовки и пересчитывается при прокрутке (любого контейнера), изменении окна и размера
 * самого элемента. Пока места нет — элемент невидим. `matchWidth` — ширина как у якоря (список поля, §6.6 этапа 1.5).
 */
export function useFloating(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  align: 'left' | 'right' = 'left',
  matchWidth = false,
): CSSProperties {
  const [pos, setPos] = useState<(FloatingPosition & { width?: number }) | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const rect = anchor.getBoundingClientRect();
      const width = matchWidth ? rect.width : undefined;
      const next = {
        ...placeFloating(rect, { width: width ?? floating.offsetWidth, height: floating.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }, align),
        width,
      };
      setPos((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight && prev.width === next.width ? prev : next,
      );
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
  }, [open, align, anchorRef, floatingRef, matchWidth]);

  if (!pos) return { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
  return { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight, ...(pos.width !== undefined ? { width: pos.width } : {}) };
}
```

- [ ] **Step 2: `useComboList`**

`src/client/components/ComboList.tsx`:

```tsx
import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { initialActive, pickerItems, type PickerItem, type PickerOption } from '../lib/picker';
import { PickerListbox, pickerItemId } from './SearchPicker';
import { useFloating } from './useFloating';

export interface ComboListOptions {
  /** Название списка для программ чтения с экрана: «Категории». */
  listLabel: string;
  options: readonly PickerOption[];
  /** Выбранный пункт: активен при открытии, отмечен aria-selected. */
  selectedId: number | null;
  /** Текст поля при закрытом списке — название выбранного (у поля тегов — пусто). */
  text: string;
  onPick: (id: number) => void;
  /** «+ Создать»: с ним в списке есть пункт создания. */
  onCreate?: (name: string) => void;
  /** Что создаёт «+ Создать»: «категорию». Обязательно вместе с onCreate. */
  createNoun?: string;
}

/** Атрибуты и обработчики `<input role="combobox">`. */
export interface ComboInputProps {
  ref: RefObject<HTMLInputElement | null>;
  role: 'combobox';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  'aria-autocomplete': 'list';
  'aria-activedescendant': string | undefined;
  autoComplete: 'off';
  value: string;
  placeholder: string | undefined;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export interface ComboList {
  open: boolean;
  inputProps: ComboInputProps;
  /** Рамка поля: от неё список получает место и ширину. */
  anchorRef: RefObject<HTMLDivElement | null>;
  /** Открытый список — порталом в окно (`<dialog>`, иначе он был бы недоступен) или в body; закрыт — null. */
  list: ReactNode;
}

/**
 * Поле со списком (§6.6, §11 этапа 1.5; ARIA 1.2 combobox): поле — само поле ввода. Печать открывает список
 * и фильтрует его (без учёта регистра и «ё»); ↓ и нажатие открывают; Enter выбирает активный пункт, а в закрытом
 * поле открывает список (форму не отправляет); Esc закрывает только список (окно клавишу не видит); Tab и уход
 * из поля закрывают список без смены значения. При открытом списке поле пустое, выбранное — в подсказке поля:
 * печатают с чистого поля. Активный пункт при открытии — выбранный, после печати — первый найденный.
 * «+ Создать категорию» без названия оставляет список открытым, фокус — в поле с подсказкой «Введите название».
 */
export function useComboList(o: ComboListOptions): ComboList {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const style = useFloating(open, anchorRef, listRef, 'left', true);
  const noun = o.onCreate ? (o.createNoun ?? '') : undefined;
  const items = pickerItems(o.options, open ? query : '', noun);
  const current = open && items.length > 0 ? items[Math.min(active, items.length - 1)] : undefined;

  const show = () => {
    setOpen(true);
    setQuery('');
    setActive(initialActive(pickerItems(o.options, '', noun), o.selectedId));
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    setNaming(false);
  };
  const search = (q: string) => {
    setOpen(true);
    setQuery(q);
    setActive(initialActive(pickerItems(o.options, q, noun), undefined));
  };
  const choose = (it: PickerItem) => {
    if (it.kind === 'create') {
      if (it.name === '') {
        setNaming(true);
        inputRef.current?.focus();
        return;
      }
      close();
      o.onCreate?.(it.name);
      return;
    }
    close();
    o.onPick(it.option.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) show();
      else setActive((a) => (e.key === 'ArrowDown' ? Math.max(0, Math.min(a + 1, items.length - 1)) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter') {
      // Enter в поле списка не отправляет форму
      e.preventDefault();
      if (!open) show();
      else if (current) choose(current);
    } else if (e.key === 'Escape' && open) {
      // закрывается только список: preventDefault — `<dialog>` не закроется сам, stopPropagation — Modal не спросит
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && open) {
      close();
    }
  };

  const inputProps: ComboInputProps = {
    ref: inputRef,
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-autocomplete': 'list',
    'aria-activedescendant': current ? pickerItemId(listId, current) : undefined,
    autoComplete: 'off',
    value: open ? query : o.text,
    placeholder: open ? (naming ? 'Введите название' : o.text || undefined) : undefined,
    onChange: (e) => {
      const raw = e.target.value;
      // список закрыт, в поле — выбранное значение, курсор после него: запросом считается только напечатанное
      search(!open && o.text !== '' && raw.startsWith(o.text) ? raw.slice(o.text.length) : raw);
    },
    onClick: () => (open ? close() : show()),
    onKeyDown,
    onBlur: close,
  };

  const list = open
    ? createPortal(
        <div
          ref={listRef}
          style={style}
          // щелчок по заголовку группы, пустому месту или полосе прокрутки не уводит фокус из поля
          onMouseDown={(e) => e.preventDefault()}
          className="z-40 overflow-y-auto rounded-2xl bg-card p-2 text-ink shadow-xl ring-1 ring-field"
        >
          <PickerListbox
            id={listId}
            label={o.listLabel}
            items={items}
            active={active}
            selectedId={o.selectedId}
            createNoun={o.createNoun}
            onChoose={choose}
            onHover={setActive}
          />
          {items.length === 0 && <p className="px-3 py-2 text-sm text-muted">Ничего не найдено</p>}
        </div>,
        anchorRef.current?.closest('dialog') ?? document.body,
      )
    : null;

  return { open, inputProps, anchorRef, list };
}
```

- [ ] **Step 3: `ComboSelect` on `useComboList`**

`src/client/components/operation/ComboSelect.tsx` целиком:

```tsx
import type { PickerOption } from '../../lib/picker';
import { useComboList } from '../ComboList';
import { Field } from '../Field';
import { floatingControlClass } from '../ui';

/** Пункт «без значения» в списке: id справочников всегда положительные. */
const NONE = 0;

/**
 * Поле со списком формы (§6.6 этапа 1.5): поле ввода с плавающей подписью (§6.3), печать фильтрует список
 * (без учёта регистра и «ё»), пункт «без значения» («Без категории»), с `onCreate` — «+ Создать». Имя поля — подпись,
 * значение — название выбранного; пустое значение не пишется текстом — видна подпись. Подпись, подсказка и ошибка
 * связаны с полем через `Field`. Клавиши — `useComboList`.
 */
export function ComboSelect(props: {
  label: string;
  /** Название списка для программ чтения с экрана: «Категории». */
  listLabel: string;
  value: number | null;
  options: PickerOption[];
  /** Пункт пустого значения в списке: «Без категории». null — пустого значения нет (счёт). */
  emptyLabel: string | null;
  onChange: (id: number | null) => void;
  onCreate?: (name: string) => void;
  /** Что создаёт «+ Создать»: «категорию», «контрагента», «проект». Обязательно вместе с onCreate. */
  createNoun?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = props.options.find((o) => o.id === props.value);
  // значение есть, а пункта нет (справочник ещё грузится) — «…»
  const text = selected?.label ?? (props.value === null ? '' : '…');
  const options = props.emptyLabel === null ? props.options : [{ id: NONE, label: props.emptyLabel }, ...props.options];
  const combo = useComboList({
    listLabel: props.listLabel,
    options,
    selectedId: props.value ?? (props.emptyLabel === null ? null : NONE),
    text,
    onPick: (id) => props.onChange(id === NONE ? null : id),
    onCreate: props.onCreate,
    createNoun: props.createNoun,
  });
  return (
    <Field
      label={props.label}
      error={props.error}
      hint={props.hint}
      className={props.className}
      floating
      filled={combo.open || text !== ''}
      boxRef={combo.anchorRef}
    >
      {(control) => (
        <>
          <input {...control} {...combo.inputProps} disabled={props.disabled} className={`${floatingControlClass} truncate pr-10`} />
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted">
            ▾
          </span>
          {combo.list}
        </>
      )}
    </Field>
  );
}
```

(экспорт `selectButtonClass` удалён: проверьте `grep -rn "selectButtonClass" src` — использований быть не должно.)

- [ ] **Step 4: Callers**

В `src/client/components/operation/OperationForm.tsx`:
1) в импорте из `'../../lib/operation-options'` добавьте `counterpartyLabel`:
   `import { accountOptions, categoryOptions, counterpartyLabel, counterpartyOptions, preferredCounterpartyType, projectOptions, tagOptions } from '../../lib/operation-options';`
2) в `accountField` удалите строку `      placeholder="Выберите счёт"`;
3) у поля контрагента строку `            label="Контрагент"` замените на `            label={counterpartyLabel(p.data.categories, mainCategory)}` (подпись по системной категории, §6.4).

В `src/client/components/journal/AssignDialog.tsx` у `<ComboSelect` удалите строку `        placeholder="Выберите"`.

В `src/client/components/operation/SplitEditor.tsx` в эффекте фокуса строк строку

```ts
      rows[rows.length - 1]?.querySelector<HTMLElement>('button')?.focus();
```

замените на

```ts
      // новая строка — фокус в её первое поле (категория — поле ввода со списком)
      rows[rows.length - 1]?.querySelector<HTMLElement>('input, button')?.focus();
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 5: E2E — `e2e/operation-form.spec.ts`**

1) Помощник `pick` (комментарий и функция целиком)

```ts
/** Выбрать значение в выпадающем списке формы: кнопка «Подпись: …», затем пункт списка (список — в окне формы). */
async function pick(page: Page, label: string, option: string, scope: Locator = form(page)) {
  await scope.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('button', { name: new RegExp(`^${label}: ${option.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
}
```

замените на

```ts
/** Поле со списком (§6.6 этапа 1.5): `input role="combobox"`, имя — подпись поля. */
const field = (scope: Locator, label: string) => scope.getByRole('combobox', { name: label, exact: true });

/** Выбрать значение в поле со списком: нажатие открывает список (он рисуется в окне формы), затем пункт. */
async function pick(page: Page, label: string, option: string, scope: Locator = form(page)) {
  await field(scope, label).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(field(scope, label)).toHaveValue(option);
}
```

2) Тест «ошибки у полей, …»: фрагмент от строки `  // Esc внутри списка с поиском закрывает только список: окно открыто, вопроса нет, фокус на кнопке списка` до строки `  await pick(page, 'Контрагент', 'ТОО Ромашка');` включительно замените на

```ts
  // Esc при открытом списке закрывает только список: окно открыто, вопроса нет, фокус остаётся в поле (Review Focus 3)
  const category = field(dialog, 'Категория');
  await category.click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(question).toBeHidden();
  await expect(category).toBeFocused();
  // печать в поле открывает список и фильтрует его; «+ Создать „…“» — после найденного; Enter выбирает найденное (Review Focus 2)
  await category.fill('АРЕН');
  await expect(dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option')).toHaveText(['Аренда', '+ Создать „АРЕН“']);
  await category.press('Enter');
  await expect(category).toHaveValue('Аренда');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  // печать поверх выбранного: ищется набранное; Esc возвращает прежнее значение (Review Focus 1)
  await category.fill('интернет');
  await expect(dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option')).toHaveText(['+ Создать „интернет“']);
  await category.press('Escape');
  await expect(category).toHaveValue('Аренда');
  await expect(dialog).toBeVisible();

  // «Зарплата» (системная категория): поле контрагента — «Сотрудник» (§6.4), сначала сотрудники, затем остальные
  await pick(page, 'Категория', 'Зарплата');
  await field(dialog, 'Сотрудник').click();
  const people = dialog.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option');
  await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'Айгерим', 'ТОО Ромашка']);
  await expect(dialog.getByRole('listbox', { name: 'Контрагенты' })).toContainText('Сотрудники');
  await page.keyboard.press('Escape');
  // обычная категория — «Мой контрагент»
  await pick(page, 'Категория', 'Аренда');
  await field(dialog, 'Мой контрагент').click();
  await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'ТОО Ромашка', 'Айгерим']);
  await page.keyboard.press('Escape');

  // после выбора значения список открывается на нём: aria-activedescendant поля указывает на выбранный пункт
  await category.click();
  const selected = dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда', exact: true });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(category).toHaveAttribute('aria-activedescendant', (await selected.getAttribute('id'))!);
  // Tab закрывает список без смены значения
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(category).toHaveValue('Аренда');
  await expect(dialog).toBeVisible();

  // «Сохранить и создать похожий»: категория и контрагент остаются, сумма и комментарий — нет
  await pick(page, 'Мой контрагент', 'ТОО Ромашка');
```

и строки

```ts
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Контрагент: ТОО Ромашка' })).toBeVisible();
```

замените на

```ts
  await expect(category).toHaveValue('Аренда');
  await expect(field(dialog, 'Мой контрагент')).toHaveValue('ТОО Ромашка');
```

3) Тест «„Разделить“ в процентах…»:
- `await expect(split.getByRole('group', { name: 'Строка 3' }).getByRole('button', { name: /^Категория:/ })).toBeFocused();` → `await expect(field(split.getByRole('group', { name: 'Строка 3' }), 'Категория')).toBeFocused();`
- строки

```ts
  await expect(line1.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await expect(line1.getByRole('button', { name: 'Проект: Север' })).toBeVisible();
```

  → 

```ts
  await expect(field(line1, 'Категория')).toHaveValue('Аренда');
  await expect(field(line1, 'Проект')).toHaveValue('Север');
```

- строки

```ts
  await expect(line2.getByRole('button', { name: 'Категория: Без категории' })).toBeVisible();
  await expect(line2.getByRole('button', { name: 'Проект: Юг' })).toBeVisible();
```

  → (пустое значение не пишется текстом — §6.3)

```ts
  await expect(field(line2, 'Категория')).toHaveValue('');
  await expect(field(line2, 'Проект')).toHaveValue('Юг');
```

4) Тест «сценарий 3 §10…»: `await expect(line2.getByRole('button', { name: /^Категория:/ })).toBeFocused();` → `await expect(field(line2, 'Категория')).toBeFocused();`

5) Тест «„+ Создать „…“» прямо из формы…»: фрагмент от строки `  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();` до строки `  await expect(dialog.getByRole('button', { name: 'Проект: Клуб Центр' })).toBeVisible();` включительно замените на

```ts
  const person = field(dialog, 'Сотрудник');
  await person.fill('Асель');
  await dialog.getByRole('option', { name: '+ Создать „Асель“' }).click();
  await expect(person).toHaveValue('Асель');

  // категория: Enter на пункте «+ Создать» тоже создаёт
  const category = field(dialog, 'Категория');
  await category.fill('Интернет');
  await category.press('ArrowDown');
  // активный пункт — тот, на который указывает aria-activedescendant поля
  const createId = await dialog.getByRole('option', { name: '+ Создать „Интернет“' }).getAttribute('id');
  await expect(category).toHaveAttribute('aria-activedescendant', createId!);
  await category.press('Enter');
  await expect(category).toHaveValue('Интернет');
  // такое название уже есть (без учёта регистра) — «Создать» не предлагается
  await category.fill('интернет');
  await expect(dialog.getByRole('option', { name: /Создать/ })).toHaveCount(0);
  await category.press('Escape');

  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  const project = field(dialog, 'Проект');
  await project.fill('Клуб Центр');
  await dialog.getByRole('option', { name: '+ Создать „Клуб Центр“' }).click();
  await expect(project).toHaveValue('Клуб Центр');
```

- [ ] **Step 6: E2E — other files**

`e2e/operation-edit.spec.ts`:
- строки

```ts
  await expect(dialog.getByRole('button', { name: 'Счёт: Касса' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
```

  → 

```ts
  await expect(dialog.getByRole('combobox', { name: 'Счёт', exact: true })).toHaveValue('Касса');
  await expect(dialog.getByRole('combobox', { name: 'Категория', exact: true })).toHaveValue('Аренда');
```

- в части «„Дублировать“» строку `  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();` → `  await expect(dialog.getByRole('combobox', { name: 'Категория', exact: true })).toHaveValue('Аренда');`
- в тесте «операция на архивном счёте…» строку `  await expect(dialog.getByRole('button', { name: 'Счёт: Старый (в архиве)' })).toBeDisabled();` замените на

```ts
  const account = dialog.getByRole('combobox', { name: 'Счёт', exact: true });
  await expect(account).toHaveValue('Старый (в архиве)');
  await expect(account).toBeDisabled();
```

`e2e/mobile.spec.ts`:
- строки

```ts
  await dialog.getByRole('button', { name: /^Категория:/ }).click();
  await dialog.getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
```

  → 

```ts
  const category = dialog.getByRole('combobox', { name: 'Категория', exact: true });
  await category.click();
  await dialog.getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(category).toHaveValue('Аренда');
```

- строки

```ts
  // счёт по умолчанию — «Касса_без_пробелов_…»: кнопка списка не растягивает форму
  await expect(newForm(page).getByRole('button', { name: /^Счёт: Касса_без_пробелов/ })).toBeVisible();
```

  → 

```ts
  // счёт по умолчанию — «Касса_без_пробелов_…»: поле со списком не растягивает форму
  await expect(newForm(page).getByRole('combobox', { name: 'Счёт', exact: true })).toHaveValue(/^Касса_без_пробелов/);
```

`e2e/journal-actions.spec.ts`, тест «„Указать“: окно …»:
- фрагмент

```ts
  const categoryField = categoryDialog.getByRole('button', { name: /^Категория:/ });
  await expect(categoryField).toBeFocused();
  await page.keyboard.press('Enter');
  const search = page.getByRole('combobox', { name: 'Категории: поиск' });
  await expect(search).toBeFocused();
  // доход видит только доходные категории
  const categoryOptions = page.getByRole('listbox', { name: 'Категории' }).getByRole('option');
  // у системных категорий — бейдж «системная» (его текст входит в текст пункта, но не в имя)
  await expect(categoryOptions).toHaveText([/^Инвестиции/, /^Возврат займа/, /^Получение кредита/, 'Бар', 'Игровое время']);
  await search.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await search.press('Enter');
  await expect(categoryField).toHaveAccessibleName('Категория: Бар');
  await expect(categoryField).toBeFocused();
```

  → 

```ts
  const categoryField = categoryDialog.getByRole('combobox', { name: 'Категория', exact: true });
  await expect(categoryField).toBeFocused();
  // Enter в закрытом поле открывает список; фокус остаётся в поле
  await page.keyboard.press('Enter');
  // доход видит только доходные категории; у системных — бейдж «системная» (его текст входит в текст пункта, но не в имя)
  const categoryOptions = page.getByRole('listbox', { name: 'Категории' }).getByRole('option');
  await expect(categoryOptions).toHaveText([/^Инвестиции/, /^Возврат займа/, /^Получение кредита/, 'Бар', 'Игровое время']);
  await expect(categoryField).toBeFocused();
  await categoryField.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await categoryField.press('Enter');
  await expect(categoryField).toHaveValue('Бар');
  await expect(categoryField).toBeFocused();
```

- в цикле `for (const closeWith of ['Escape', 'cross'] as const)` строки

```ts
    await projectDialog.getByRole('button', { name: /^Проект:/ }).click();
    await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
    await expect(projectDialog.getByRole('button', { name: /^Проект:/ })).toHaveAccessibleName('Проект: Клуб 1');
```

  → 

```ts
    await projectDialog.getByRole('combobox', { name: 'Проект', exact: true }).click();
    await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
    await expect(projectDialog.getByRole('combobox', { name: 'Проект', exact: true })).toHaveValue('Клуб 1');
```

- остальные два места `await projectDialog.getByRole('button', { name: /^Проект:/ }).click();` → `await projectDialog.getByRole('combobox', { name: 'Проект', exact: true }).click();`
- `await counterpartyDialog.getByRole('button', { name: /^Мой контрагент:/ }).click();` → `await counterpartyDialog.getByRole('combobox', { name: 'Мой контрагент', exact: true }).click();`

Тесты «массовые действия…» и «„Изменить данные“ в фильтре „Без категории“…»:
- `await editDialog.getByRole('button', { name: /^Категория:/ }).click();` (2 места) → `await editDialog.getByRole('combobox', { name: 'Категория', exact: true }).click();`
- `await editDialog.getByRole('button', { name: /^Проект:/ }).click();` → `await editDialog.getByRole('combobox', { name: 'Проект', exact: true }).click();`

- [ ] **Step 7: Run the form tests repeatedly (spec §14.2 risk)**

Run: `npx playwright test e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/dialogs.spec.ts e2e/journal-actions.spec.ts --repeat-each=5`
Expected: всё проходит. Тест «нет курса на дату» при повторах падает и до этого плана (отложенное 1a №1: курс CHF общий для прогона) — его падение во 2-м и следующих повторах не считается; остальные — зелёные во всех повторах.

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/ComboList.tsx src/client/components/useFloating.ts src/client/components/operation/ComboSelect.tsx src/client/components/operation/OperationForm.tsx src/client/components/operation/SplitEditor.tsx src/client/components/journal/AssignDialog.tsx e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/journal-actions.spec.ts e2e/mobile.spec.ts
git commit -m "feat: поле со списком — ввод прямо в поле, список шириной с поле, подпись контрагента по категории

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: «+ Создать» в окне «Указать»

**Files:**
- Modify: `src/client/lib/journal-assign.ts`, `src/client/components/journal/AssignDialog.tsx`, `src/client/pages/JournalPage.tsx`, `tests/client/journal-assign.test.ts`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `createFromForm(companyId, what, name, { kind, counterpartyType })`, `CreatableKind` (`lib/operation-create.ts`); `ComboSelect` с `onCreate`/`createNoun` (задача 3).
- Produces: `ASSIGN_CREATE_NOUNS: Record<AssignField, string>`, `assignCreate(item: AssignTarget, field: AssignField, tree: CategoryTree): { what: CreatableKind; kind: 'income' | 'expense'; counterpartyType: CounterpartyType }` (`lib/journal-assign.ts`); `AssignDialog` — новое обязательное свойство `companyId: number`.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/journal-assign.test.ts`:
1) в импорте из `'../../src/client/lib/journal-assign'` добавьте `ASSIGN_CREATE_NOUNS` и `assignCreate`;
2) в конец `describe('окно «Указать» (§5.4 этапа 1.5)', …)` (перед его закрывающей `});`) вставьте:

```ts
  it('«+ Создать» в окне: что создаётся — по правилам формы (категория — вида операции, контрагент — под системную категорию)', () => {
    expect(ASSIGN_CREATE_NOUNS).toEqual({ counterparty: 'контрагента', category: 'категорию', project: 'проект' });
    expect(assignCreate(op({ type: 'income' }), 'category', data.categories)).toEqual({ what: 'category', kind: 'income', counterpartyType: 'client' });
    expect(assignCreate(op({}), 'counterparty', data.categories)).toEqual({ what: 'counterparty', kind: 'expense', counterpartyType: 'supplier' });
    expect(assignCreate(op({ lines: [line(10, null)] }), 'counterparty', data.categories)).toEqual({ what: 'counterparty', kind: 'expense', counterpartyType: 'employee' });
    expect(assignCreate(op({ type: 'transfer', lines: [] }), 'project', data.categories)).toMatchObject({ what: 'project' });
  });
```

(`op` и `line` — помощники, уже объявленные в этом файле; `op({})` — расход.)

Run: `npx vitest run tests/client/journal-assign.test.ts` → FAIL (`assignCreate` не экспортируется).

- [ ] **Step 2: `lib/journal-assign.ts`**

1) В начало файла добавьте импорты:

```ts
import type { CounterpartyType } from '../../shared/system-categories';
import type { CreatableKind } from './operation-create';
```

2) В конец файла добавьте:

```ts
/** Что создаёт «+ Создать» в окне «Указать» (§5.4, §6.6 этапа 1.5). */
export const ASSIGN_CREATE_NOUNS: Record<AssignField, string> = {
  counterparty: 'контрагента',
  category: 'категорию',
  project: 'проект',
};

/**
 * «+ Создать» в окне «Указать» — те же правила, что в форме (план 6a): категория — верхнего уровня вида операции,
 * контрагент — типа под системную категорию операции, иначе «Клиент» у дохода и «Поставщик» у расхода.
 */
export function assignCreate(item: AssignTarget, field: AssignField, tree: CategoryTree): { what: CreatableKind; kind: 'income' | 'expense'; counterpartyType: CounterpartyType } {
  const kind = item.type === 'income' ? 'income' : 'expense';
  const counterpartyType = preferredCounterpartyType(tree, singleCategory(item)) ?? (kind === 'income' ? 'client' : 'supplier');
  return { what: field, kind, counterpartyType };
}
```

Run: `npx vitest run tests/client/journal-assign.test.ts` → PASS.

- [ ] **Step 3: `AssignDialog` — create in the field**

В `src/client/components/journal/AssignDialog.tsx`:
1) импорты в начале файла

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSIGN_LABELS, ASSIGN_LIST_LABELS, ASSIGN_TITLES, assignLabel, assignOptions, type AssignData, type AssignField } from '../../lib/journal-assign';
import type { JournalItem } from '../../lib/queries';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { btnPrimary } from '../ui';
```

замените на

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import {
  ASSIGN_CREATE_NOUNS,
  ASSIGN_LABELS,
  ASSIGN_LIST_LABELS,
  ASSIGN_TITLES,
  assignCreate,
  assignLabel,
  assignOptions,
  type AssignData,
  type AssignField,
} from '../../lib/journal-assign';
import { createFromForm } from '../../lib/operation-create';
import type { JournalItem } from '../../lib/queries';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { alertClass, btnPrimary } from '../ui';
```

2) Функцию `AssignForm` целиком замените на

```tsx
function AssignForm(props: { companyId: number; request: AssignRequest; data: AssignData; onSave: (id: number) => void }) {
  const { item, field } = props.request;
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // список строится один раз на окно, а не на каждую перерисовку журнала; новый элемент справочника его обновит
  const options = useMemo(() => assignOptions(item, field, props.data), [item, field, props.data]);
  /** «+ Создать „…“» (§5.4, §6.6): элемент создаётся и выбирается в поле; операция меняется только по «Сохранить». */
  const create = async (name: string) => {
    setError(null);
    const c = assignCreate(item, field, props.data.categories);
    try {
      setValue(await createFromForm(props.companyId, c.what, name, { kind: c.kind, counterpartyType: c.counterpartyType }));
    } catch (e) {
      setError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
    }
  };
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
        onChange={(id) => {
          setError(null);
          setValue(id);
        }}
        onCreate={(name) => void create(name)}
        createNoun={ASSIGN_CREATE_NOUNS[field]}
      />
      {error && (
        <p role="alert" className={`${alertClass} mt-3 mb-0`}>
          {error}
        </p>
      )}
      <button type="submit" disabled={value === null} className={`${btnPrimary} mt-6 w-full py-3`}>
        Сохранить
      </button>
    </form>
  );
}
```

3) В сигнатуре `AssignDialog` тип свойств `props: { request: AssignRequest | null; data: AssignData; onSave: …; onClose: () => void }` дополните полем `companyId: number;` (первым), а в `<AssignForm` добавьте `companyId={props.companyId}` перед `key=…`.

В `src/client/pages/JournalPage.tsx` у `<AssignDialog` перед строкой `          request={assignRequest}` вставьте `          companyId={company.id}`.

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 4: E2E**

В `e2e/journal-actions.spec.ts`, тест «„Указать“: окно …»: в списке категорий теперь первым идёт «+ Создать категорию». Строку

```ts
  await expect(categoryOptions).toHaveText([/^Инвестиции/, /^Возврат займа/, /^Получение кредита/, 'Бар', 'Игровое время']);
```

замените на

```ts
  await expect(categoryOptions).toHaveText(['+ Создать категорию', /^Инвестиции/, /^Возврат займа/, /^Получение кредита/, 'Бар', 'Игровое время']);
```

В конец файла добавьте тест:

```ts
test('«Указать»: «+ Создать» в окне — проект по названию; «+ Создать контрагента» без названия просит ввести название', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Указать создать ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'операция A' });
  await page.reload();
  const row = bodyRows(page).filter({ hasText: 'операция A' });

  // проект: набранное название — «+ Создать „…“» после найденного; созданный выбран в поле, сохраняет «Сохранить»
  await row.getByRole('button', { name: 'Указать проект' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'Редактирование проекта' });
  const project = projectDialog.getByRole('combobox', { name: 'Проект', exact: true });
  await project.fill('Клуб Новый');
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: '+ Создать „Клуб Новый“' }).click();
  await expect(project).toHaveValue('Клуб Новый');
  await projectDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(projectDialog).toBeHidden();
  await expect(row).toContainText('Клуб Новый');

  // контрагент: «+ Создать контрагента» без названия — ничего не создаётся, фокус в поле, подсказка (Review Focus 4)
  await row.getByRole('button', { name: 'Указать контрагента' }).click();
  const cpDialog = page.getByRole('dialog', { name: 'Редактирование контрагента' });
  const person = cpDialog.getByRole('combobox', { name: 'Мой контрагент', exact: true });
  await person.click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: '+ Создать контрагента' }).click();
  await expect(person).toBeFocused();
  await expect(person).toHaveAttribute('placeholder', 'Введите название');
  await expect(page.getByRole('listbox', { name: 'Контрагенты' })).toBeVisible();
  await page.keyboard.type('ИП Новый');
  // найденного нет — активен «+ Создать „ИП Новый“», Enter создаёт
  await person.press('Enter');
  await expect(person).toHaveValue('ИП Новый');
  await cpDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row).toContainText('ИП Новый');
  // у дохода без системной категории — «Клиент»
  const people = (await (await page.request.get(`${base}/counterparties`)).json()).counterparties as { name: string; type: string }[];
  expect(people.find((c) => c.name === 'ИП Новый')!.type).toBe('client');
});
```

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/journal-assign.ts src/client/components/journal/AssignDialog.tsx src/client/pages/JournalPage.tsx tests/client/journal-assign.test.ts e2e/journal-actions.spec.ts
git commit -m "feat: «+ Создать» в окне «Указать» — те же правила, что в форме

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Визуальная сверка списков формы; итоговый прогон `npm run shots:ux`

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: поле со списком (задача 3), «+ Создать» первым пунктом (задача 2).
- Produces: снимки `c08`–`c11` и новый `c09b-category-typed.png`; итог сверки в отчёте задачи.

- [ ] **Step 1: Update the scenarios**

В `scripts/ux-shots.ts`:

1) Помощник `formList` целиком

```ts
const formList = (field: RegExp) => async (p: Page) => {
  await openForm('Доход')(p);
  await newForm(p).getByRole('button', { name: field }).click();
  await p.getByRole('listbox').first().waitFor();
};
```

замените на

```ts
/** Список поля формы дохода: поле со списком (§6.6 этапа 1.5), имя — подпись поля. */
const formList = (field: string) => async (p: Page) => {
  await openForm('Доход')(p);
  await newForm(p).getByRole('combobox', { name: field, exact: true }).click();
  await p.getByRole('listbox').first().waitFor();
};
```

2) Три сценария `c08`–`c10`

```ts
  { ours: 'c08-income-account-dd.png', finmap: '08-income-account-dd.png', path: 'log', act: formList(/^Счёт:/) },
  { ours: 'c09-income-category-dd.png', finmap: '09-income-category-dd.png', path: 'log', act: formList(/^Категория:/) },
  { ours: 'c10-income-counterparty-dd.png', finmap: '10-income-counterparty-dd.png', path: 'log', act: formList(/^Контрагент:/) },
```

замените на

```ts
  { ours: 'c08-income-account-dd.png', finmap: '08-income-account-dd.png', path: 'log', act: formList('Счёт') },
  { ours: 'c09-income-category-dd.png', finmap: '09-income-category-dd.png', path: 'log', act: formList('Категория') },
  {
    ours: 'c09b-category-typed.png',
    finmap: '09b-category-typed.png',
    path: 'log',
    act: async (p) => {
      // как на снимке Finmap: расход, в поле категории набрано «аре» — найденное и «+ Создать „аре“» после него
      await openForm('Расход')(p);
      await newForm(p).getByRole('combobox', { name: 'Категория', exact: true }).fill('аре');
      await p.getByRole('listbox').first().waitFor();
    },
  },
  { ours: 'c10-income-counterparty-dd.png', finmap: '10-income-counterparty-dd.png', path: 'log', act: formList('Мой контрагент') },
  {
    ours: 'c11-income-project-dd.png',
    finmap: '11-income-project-dd.png',
    path: 'log',
    act: async (p) => {
      // «+ Создать проект» — первым пунктом пустого запроса
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: /^Проект, теги, комментарий/ }).click();
      await newForm(p).getByRole('combobox', { name: 'Проект', exact: true }).click();
      await p.getByRole('listbox').first().waitFor();
    },
  },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: итог `Готово: …\parity\index.html — снято 38 из 38.` Скрипт работает на порту 41741 с временной папкой. Упавший сценарий (`✗ …`) — почти всегда локатор: исправьте сценарий, а не продукт, и запустите ещё раз.

- [ ] **Step 3: Compare the form screens and write the result into the task report**

Откройте инструментом чтения изображений пары `docs/research/screens/v2/<снимок Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `05-op-edit` ↔ `c05-op-edit`, `06-income` ↔ `c06-income`, `07-income-expanded` ↔ `c07-income-expanded`, `08-income-account-dd` ↔ `c08-…`, `09-income-category-dd` ↔ `c09-…`, `09b-category-typed` ↔ `c09b-…`, `10-income-counterparty-dd` ↔ `c10-…`, `11-income-project-dd` ↔ `c11-…`, `15-expense` ↔ `c15-expense`, `16-transfer` ↔ `c16-transfer`, а также `03-ukazat-popover` ↔ `c03-ukazat-popover`. Экранов `12-income-datepicker` и `13c-calculator` пока нет — они появятся в плане 1.5-3c.

В отчёт задачи (не в файл) запишите таблицу «экран — совпадает по раскладке / отличается намеренно (почему) / отличается (что исправить и в каком плане)». Ожидаемо:
- **совпадают:** списки 08, 09, 09b, 10, 11 (поле ввода, список шириной с поле под ним, крупные пункты, «+ Создать проект» первым, «+ Создать „аре“» после найденного, ₸ у счетов справа, бейдж «системная»); подписи внутри полей; «Мой контрагент»; окно 03 с полем ввода;
- **отличаются намеренно:** пункты «Без категории» / «Без контрагента» в списке (ими сбрасывают значение); группы «Сотрудники / Остальные»; бейдж «системная», а не «SYSTEM»; цвета;
- **отличаются, исправит план 1.5-3b:** окно 672 px в две колонки, вкладки типа, заголовок «Новая операция» / «Изменить операцию», кнопки внизу ряда, «Дата сделки отличается» флажком, счёт подставлен заранее; **план 1.5-3c:** дата без времени, нет калькулятора.

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck` → без ошибок. Run: `npm run test:e2e` → все проходят.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — списки формы: ввод в поле и «+ Создать»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-11-stage1_5-plan3a-followups.md` (пишет контролёр).
- Следующий план — [1.5-3b](2026-10-11-stage1_5-plan3b-form-layout.md): окно на тип и заголовки, одна колонка, строки-действия, главная кнопка, последний счёт и фокус на первом пустом поле, теги на `useComboList`, перетаскивание файлов.
- Замечания для итогов (followups):
  - `SearchPicker` («Применить шаблон», «+ Тег») ещё с отдельным полем поиска; поле тегов переходит на `useComboList` в плане 1.5-3b;
  - бейдж и символ валюты в пунктах — только для глаз (решение 4): программа чтения не слышит «системная» в списке.
