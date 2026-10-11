# Этап 1.5, план 1.5-3b: формы операций — окно на тип, одна колонка, строки-действия, главная кнопка, последний счёт, теги и файлы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая треть плана 1.5-3 из §13 спецификации этапа 1.5 — раскладка окна формы как в Finmap:
- отдельное окно на тип без вкладок; заголовки «Новый доход / расход / перевод», при правке «Доход / Расход / Перевод»; окно 480 px в одну колонку; порядок полей Finmap, у перевода дата первой; «Сумма» и неактивный значок «Валюта» в одной строке; подписи «На счёт», «Со счёта», «Дата поступления денег», «Указать дату списания», «Дата перевода денег» (§6.1, §6.2);
- строки-действия `ActionRow`: «Дата сделки отличается» ⓘ, «Разделить платёж» / «Отменить разделение», «Добавить проект, тег, комментарий, файл» ˅/˄, при правке «Дублировать платёж» и «Удалить платёж» через `ConfirmDialog` (§6.7); строки 4 «Изменить в перевод» нет до плана 1.5-6;
- подтверждения в «Разделить» — тоже `ConfirmDialog` (§2.4; закрывает отложенные 1a №2 и 6a №2);
- главная кнопка на всю ширину цвета типа «Добавить доход» / «Сохранить изменения»; под ней «+ Добавить и создать похожий» только при создании; «Сохранить и создать похожий» при правке убрана (§6.9);
- счёт по умолчанию — последний выбранный этим пользователем в этой компании для этого типа, иначе пусто; фокус при открытии — на первом пустом обязательном поле (§6.2);
- теги — поле-мультивыбор с плашками внутри поля; перетаскивание файлов в зону «Перетяните сюда файл (до 10 МБ) или выберите файл» (§6.7, строка 3);
- сверка экранов формы и итоговый прогон `npm run shots:ux`.

**Предусловие:** выполнен план [1.5-3a](2026-10-11-stage1_5-plan3a-form-lists.md): `lib/picker.ts`, `useComboList` (`components/ComboList.tsx`), `ComboSelect` — поле ввода со списком (`combobox` с именем-подписью), `Field floating` (`floating`, `filled`, `boxRef`, `below`), `floatingControlClass`/`floatingTextareaClass` в `ui.ts`, подпись контрагента `counterpartyLabel`, `createNoun` у списков, «+ Создать» в «Указать». Ожидаемо на старте: `npm test` — около 680 тестов (+1 пропущен), `npm run test:e2e` — 76.

**Следующая часть:** [1.5-3c](2026-10-11-stage1_5-plan3c-datetime-calculator.md) — дата и время, «Зарплата за {месяц}», калькулятор.

**Architecture:**
- **Тексты окна по типу** — чистые `operationTitle`, `submitLabel`, `FIELD_LABELS`, `initialFocusField` в `lib/operation-form.ts`. Тип новой операции задаёт кнопка шапки (`OperationFormHost`), существующей — сама операция; `changeType` остаётся в библиотеке для «Изменить в перевод» (план 1.5-6), форма его больше не вызывает.
- **`OperationForm.tsx`** переписывается целиком (задача 1): одна колонка, поля в порядке §6.2, строки-действия на новом `components/operation/ActionRow.tsx`, удаление через `ConfirmDialog`. Поле даты оплаты в этом плане — прежний `type="date"` с плавающей подписью; `DateTimeField` заменит его в плане 1.5-3c. «Дата сделки» — `DateField` с плавающей подписью.
- **Начальный фокус.** Без вкладок первый элемент окна — поле счёта (у перевода — дата), и `Modal` ставит фокус на него. Окно отмечает этот элемент (`markInitialFocus` в `focus-trap.ts`), и общий хук `useAutoFocus` (из прежнего автофокуса `AmountField`) считает такой фокус «ничьим»: его забирает сумма или пустой счёт. Сам выбор поля — `initialFocusField`.
- **Последний счёт** — `lib/last-account.ts`: `localStorage` `fc.lastAccount.<userId>.<cid>` = `{ income, expense, transferFrom, transferTo }`; запоминается после успешного создания операции; архивный или удалённый счёт не подставляется.
- **Теги** — `TagsField` на `useComboList` из плана 1.5-3a: плашки и поле ввода внутри одной рамки с плавающей подписью «Теги».

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §1, §2.4, §6.1, §6.2, §6.7 (строки 1, 2, 3, 5, 6), §6.9, §8.7, §10.2 (последний счёт в `localStorage`), §11 (`ActionRow`, `ConfirmDialog`), §12, §13 (блок «Решения планирования плана 1.5-3»). Аудит: [02-operation-forms.md](../../research/ux-parity/02-operation-forms.md) — H1, H2, H6, M1–M3, M8, M9, M13, L3–L6, L9.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-3») тем же коммитом, что и план.

1. **Главная кнопка (§6.9):** доход — `bg-income`, расход — `bg-expense`, текст тёмный (`text-ink`, как в Finmap: 5,3:1 и 4,6:1); перевод — `bg-chrome`, текст белый. Белый текст на `income`/`expense` дал бы 3,4–3,6:1 — меньше AA.
2. **«Удалить платёж» (§6.7, строка 6):** `ConfirmDialog` «Удалить платёж?», текст «Операция будет удалена из журнала и итогов.», «Отменить | Удалить» (красная). Пока идёт запрос, обе кнопки недоступны; ошибка — сообщением формы, фокус возвращается на строку. Операция на архивном счёте — строка `aria-disabled` с подсказкой «Удалить нельзя: счёт в архиве («…»)» и остаётся в порядке Tab.
3. **Подтверждения в «Разделить»** — `ConfirmDialog`: «Сменить способ деления?» / «Значения строк будут сброшены.» / «Отменить | Сбросить значения» и «Применить шаблон «…»?» / «Строки будут заменены шаблоном, значения сброшены.» / «Отменить | Применить». Кнопка «Отменить разбиение» внутри разбиения убрана: её роль — строка «Отменить разделение».
4. **«Дата сделки отличается»:** нажатие ставит дату сделки равной дате оплаты и заменяет строку полем «Дата сделки» (фокус — на нём) с кнопкой «✕» «Убрать дату сделки» (фокус — обратно на строку). ⓘ — подсказка при наведении и описание строки для программ чтения.
5. **Начальный фокус (§6.2):** у новой операции — первое пустое обязательное поле: счёт (у перевода сначала «Со счёта», затем «На счёт»), иначе сумма; при правке — сумма. Элемент, на который фокус поставило само окно при открытии, считается «ничьим».
6. **Последний счёт (§6.2, §10.2):** запоминается после успешного создания операции (не при выборе в поле и не при правке) — так в памяти только счёт, на который действительно вносили. Ключ `fc.lastAccount.<userId>.<cid>`, значение `{ income?, expense?, transferFrom?, transferTo? }`; повреждённое значение — пусто.
7. **Строка разбиения в окне 480 px:** «Категория» и «Проект» в одной строке, ниже сумма (или доля) и «×».
8. **Поле тегов:** плашки и поле ввода в одной рамке; выбор пункта добавляет тег и закрывает список; Backspace в пустом поле убирает последний тег. Зона файлов принимает перетаскивание и у новой операции (файлы ждут сохранения), и у существующей (загружаются сразу).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: «Разделить платёж» и при создании, «Сумма зачисления» и курс у перевода между валютами, RateFix, вопрос о несохранённом только при изменениях. **Мёртвых кнопок нет:** строки «Изменить в перевод» до плана 1.5-6 нет — ни заглушкой, ни неактивной.
- **Окна и заголовки (§6.1):** создание — «Новый доход», «Новый расход», «Новый перевод»; правка — «Доход», «Расход», «Перевод». Вкладок типа нет. Окно `max-w-[480px]`, одна колонка; на телефоне — на весь экран, «×» в шапке.
- **Поля сверху вниз (§6.2):** доход и расход — счёт («На счёт» / «Со счёта») → «Сумма, ₸» | «Валюта» → «Категория» → контрагент (подпись §6.4) → дата («Дата поступления денег» / «Указать дату списания») → строки-действия → главная кнопка и «+ Добавить и создать похожий». Перевод — «Дата перевода денег» → «Со счёта» → «На счёт» → «Сумма, {валюта списания}» → «Сумма зачисления» и курс (только между валютами) → строки-действия → кнопки. «Сумма» и «Валюта» — `grid-cols-[1fr_auto]`; «Валюта» — неактивный значок «KZT (₸)» валюты счёта, без счёта значка нет. Разбиение раскрывается на месте категории.
- **Строки-действия (§6.7):** иконка слева, текст, на всю ширину, разделители. Доход и расход: 1 «Дата сделки отличается» ⓘ, 2 «Разделить платёж» / «Отменить разделение», 3 «Добавить проект, тег, комментарий, файл» ˅/˄; при правке ещё 5 «Дублировать платёж» и 6 «Удалить платёж» (красная). Перевод — строки 3, 5, 6. Архивная компания — только поля без строк, только чтение. Блок строки 3: «Проект», «Теги» (мультивыбор с плашками), «Комментарий», зона файлов «Перетяните сюда файл (до 10 МБ) или выберите файл»; если что-то из этого заполнено, блок открыт сразу.
- **Главная кнопка (§6.9):** на всю ширину, высота около 56 px, цвет типа; текст «Добавить доход / расход / перевод», при правке «Сохранить изменения». Под ней по центру текстовая «+ Добавить и создать похожий» — только при создании. «Отмены» нет. Enter сохраняет; блокировки на время запроса, «Загрузить актуальную», RateFix — без изменений.
- **`ActionRow` (§11):** обычная `<button>` с текстом; раскрывающая — с `aria-expanded`; неактивная — `aria-disabled` с подсказкой в `aria-describedby`, остаётся в порядке Tab.
- **`ConfirmDialog` (§2.4, §11):** вложенное `alertdialog`, «Отменить» слева (фокус по умолчанию) и действие справа; Esc закрывает только подтверждение, фокус возвращается туда, где был в форме.
- **Сохраняются контракты планов 6a/6b/7 и 1.5-1a:** автофокус при открытии (в том числе при повторном открытии с данными в кэше), `refocusSignal`, `<fieldset disabled={pending || readOnly}>`, «Загрузить актуальную» при 409, RateFix, фокус после действий с файлами, архивная форма только для чтения (фокус на «×»), вопрос о закрытии с «Больше не спрашивать», форма на весь экран телефона с липкой шапкой и «×» 44 px.
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN)`; поля ввода — `amountInputText`.
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; у каждого теста свой браузерный контекст — `localStorage` (последний счёт) в начале теста пуст; `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя тест возвращает в `finally`; без фиксированных пауз. Элемент с `aria-disabled="true"` Playwright считает недоступным для `click()` — нажатие на него в тесте делается `dispatchEvent('click')`. Известная нестабильность: `journal-actions.spec.ts` (~555).
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Повторное открытие формы того же типа после сохранения** (данные в кэше, счёт запомнен): фокус — в сумме, а не на счёте, который окно сфокусировало первым. Тест — задача 2 (e2e).
2. **Esc во вложенном подтверждении** («Удалить платёж?», «Сменить способ деления?»): закрывается только подтверждение, вопроса «Ваши данные не сохранятся» нет, фокус — на строке или переключателе, с которого спросили. Тест — задача 1 (e2e).
3. **«Удалить платёж» у операции на архивном счёте:** строка видна и в порядке Tab, нажатие ничего не делает, описание объясняет причину. Тест — задача 1 (e2e).
4. **Запомненный счёт ушёл в архив** (или повреждено значение в `localStorage`): поле пустое, ошибок нет. Тесты — задача 2 (unit и e2e).
5. **Перетаскивание не-файла** (текст, ссылка) на зону файлов: ничего не добавляется и не загружается; файл больше 10 МБ — та же ошибка, что при выборе. Тест — задача 3 (unit-правило `isFileDrag` и e2e).

---

## Карта файлов

```
src/client/lib/operation-form.ts                   # operationTitle, submitLabel, FIELD_LABELS, initialFocusField, emptyDraft(…, toAccountId)
src/client/lib/last-account.ts                     # (новый) последний счёт: ключ, разбор, запоминание, подстановка
src/client/components/ui.ts                        # btnIncome, btnExpense, btnTransfer
src/client/components/icons.tsx                    # SplitIcon, CopyIcon, ChevronIcon
src/client/components/focus-trap.ts                # markInitialFocus, isInitialFocus
src/client/components/useAutoFocus.ts              # (новый) isFreeFocus, useAutoFocus
src/client/components/Modal.tsx                    # отметка начального фокуса
src/client/components/DateField.tsx                # floating, error
src/client/components/operation/ActionRow.tsx      # (новый) строка-действие
src/client/components/operation/OperationForm.tsx  # окно на тип, одна колонка, строки-действия, кнопки, последний счёт, теги
src/client/components/operation/AmountField.tsx    # useAutoFocus
src/client/components/operation/ComboSelect.tsx    # autoFocus
src/client/components/operation/SplitEditor.tsx    # ConfirmDialog, раскладка строки, без «Отменить разбиение»
src/client/components/operation/AttachmentsField.tsx # зона перетаскивания
src/client/lib/attachments.ts                      # isFileDrag
scripts/ux-shots.ts                                # сценарии формы
tests/client/operation-form.test.ts, last-account.test.ts (новый), attachments.test.ts
e2e/operation-form.spec.ts, operation-edit.spec.ts, dialogs.spec.ts, mobile.spec.ts, service-screens.spec.ts
```

---

### Task 1: Окно на тип — заголовок, одна колонка, порядок полей, строки-действия, главная кнопка

**Files:**
- Create: `src/client/components/operation/ActionRow.tsx`, `src/client/components/useAutoFocus.ts`
- Modify: `src/client/lib/operation-form.ts`, `src/client/components/ui.ts`, `src/client/components/icons.tsx`, `src/client/components/focus-trap.ts`, `src/client/components/Modal.tsx`, `src/client/components/DateField.tsx`, `src/client/components/operation/OperationForm.tsx` (целиком), `src/client/components/operation/AmountField.tsx`, `src/client/components/operation/SplitEditor.tsx`, `tests/client/operation-form.test.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/dialogs.spec.ts`, `e2e/mobile.spec.ts`, `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `ComboSelect` (поле ввода, имя — подпись), `Field` с `floating`/`filled`, `floatingControlClass`, `floatingTextareaClass`, `counterpartyLabel` (план 1.5-3a); `ConfirmDialog` (`open`, `title`, `text`, `confirmLabel`, `danger`, `pending`, `onConfirm`, `onCancel`, `onFocusLost`); `DateField`, `Calendar` (план 1.5-2a); `firstTabbable` (`focus-trap.ts`).
- Produces:
  - `operationTitle(type: OperationType, editing: boolean): string`, `submitLabel(type: OperationType, editing: boolean): string`, `FIELD_LABELS: Record<OperationType, { account: string; paidDate: string }>` (`lib/operation-form.ts`);
  - `btnIncome`, `btnExpense`, `btnTransfer` (`ui.ts`); `SplitIcon`, `CopyIcon`, `ChevronIcon({ up }: { up?: boolean })` (`icons.tsx`);
  - `markInitialFocus(el: HTMLElement): void`, `isInitialFocus(el: unknown): boolean` (`focus-trap.ts`); `isFreeFocus(el: Element | null): boolean`, `useAutoFocus(ref: RefObject<HTMLElement | null>, enabled: boolean | undefined): void` (`components/useAutoFocus.ts`);
  - `actionRowClass`, `ActionRow(props: { icon: ReactNode; label: string; onClick: () => void; expanded?: boolean; danger?: boolean; disabledHint?: string; info?: string; muted?: boolean; buttonRef?: Ref<HTMLButtonElement> })` (`components/operation/ActionRow.tsx`) — план 1.5-3c строит на `actionRowClass` строку «Зарплата за …»;
  - `DateField` — новые свойства `floating?: boolean`, `error?: string`;
  - `SplitEditor` — свойство `onCancel` удалено;
  - в `OperationForm.tsx` у `OperationEditor` — константа `paidDateField` (поле даты оплаты) и строки-действия в `rows`; план 1.5-3c заменяет `paidDateField` на `DateTimeField` и строку «Дата сделки» — на «Зарплата за …» у зарплаты.

- [ ] **Step 1: Write the failing unit tests**

В `tests/client/operation-form.test.ts`:
1) в импорт из `'../../src/client/lib/operation-form'` добавьте `FIELD_LABELS`, `operationTitle`, `submitLabel`;
2) в конец файла добавьте:

```ts
describe('окно по типу (§6.1, §6.2, §6.9 этапа 1.5)', () => {
  it('заголовок: «Новый доход» при создании, «Доход» при правке', () => {
    expect(operationTitle('income', false)).toBe('Новый доход');
    expect(operationTitle('expense', false)).toBe('Новый расход');
    expect(operationTitle('transfer', false)).toBe('Новый перевод');
    expect(operationTitle('income', true)).toBe('Доход');
    expect(operationTitle('expense', true)).toBe('Расход');
    expect(operationTitle('transfer', true)).toBe('Перевод');
  });

  it('главная кнопка: «Добавить доход / расход / перевод», при правке — «Сохранить изменения»', () => {
    expect(submitLabel('income', false)).toBe('Добавить доход');
    expect(submitLabel('expense', false)).toBe('Добавить расход');
    expect(submitLabel('transfer', false)).toBe('Добавить перевод');
    expect(submitLabel('transfer', true)).toBe('Сохранить изменения');
  });

  it('подписи счёта и даты оплаты — как в Finmap', () => {
    expect(FIELD_LABELS).toEqual({
      income: { account: 'На счёт', paidDate: 'Дата поступления денег' },
      expense: { account: 'Со счёта', paidDate: 'Указать дату списания' },
      transfer: { account: 'Со счёта', paidDate: 'Дата перевода денег' },
    });
  });
});
```

Run: `npx vitest run tests/client/operation-form.test.ts` → FAIL (`operationTitle`, `submitLabel`, `FIELD_LABELS` не экспортируются).

- [ ] **Step 2: Texts in `lib/operation-form.ts`**

В конец `src/client/lib/operation-form.ts` добавьте:

```ts
/** Заголовки окна и текст главной кнопки по типу (§6.1, §6.9 этапа 1.5). */
const TYPE_TEXTS: Record<OperationType, { create: string; edit: string; submit: string }> = {
  income: { create: 'Новый доход', edit: 'Доход', submit: 'Добавить доход' },
  expense: { create: 'Новый расход', edit: 'Расход', submit: 'Добавить расход' },
  transfer: { create: 'Новый перевод', edit: 'Перевод', submit: 'Добавить перевод' },
};

/** Заголовок окна формы: «Новый доход» при создании, «Доход» при правке (§6.1 этапа 1.5). */
export function operationTitle(type: OperationType, editing: boolean): string {
  return editing ? TYPE_TEXTS[type].edit : TYPE_TEXTS[type].create;
}

/** Текст главной кнопки: «Добавить доход» при создании, «Сохранить изменения» при правке (§6.9 этапа 1.5). */
export function submitLabel(type: OperationType, editing: boolean): string {
  return editing ? 'Сохранить изменения' : TYPE_TEXTS[type].submit;
}

/** Подписи счёта и даты оплаты по типу, как в Finmap (§6.2 этапа 1.5); второй счёт перевода — «На счёт». */
export const FIELD_LABELS: Record<OperationType, { account: string; paidDate: string }> = {
  income: { account: 'На счёт', paidDate: 'Дата поступления денег' },
  expense: { account: 'Со счёта', paidDate: 'Указать дату списания' },
  transfer: { account: 'Со счёта', paidDate: 'Дата перевода денег' },
};
```

Run: `npx vitest run tests/client/operation-form.test.ts` → PASS.

- [ ] **Step 3: Buttons, icons**

В `src/client/components/ui.ts` после строки `export const btnDanger = …` вставьте:

```ts
/** Главная кнопка формы операции (§6.9 этапа 1.5): на всю ширину, 56 px, цвет типа; тёмный текст на income и expense — 5,3:1 и 4,6:1. */
const btnMain = 'h-14 w-full rounded-xl px-4 text-base font-semibold hover:brightness-95 disabled:opacity-50';
export const btnIncome = `${btnMain} bg-income text-ink`;
export const btnExpense = `${btnMain} bg-expense text-ink`;
export const btnTransfer = `${btnMain} bg-chrome text-white`;
```

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** Иконки строк-действий формы операции (§6.7 этапа 1.5). */
export function SplitIcon() {
  return (
    <Svg>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M6 7v1a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7" />
      <line x1="12" y1="12" x2="12" y2="17" />
    </Svg>
  );
}

export function CopyIcon() {
  return (
    <Svg>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

/** Стрелка раскрывающей строки: ˅ свёрнуто, ˄ раскрыто. */
export function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <Svg className={up ? 'rotate-180' : undefined}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}
```

- [ ] **Step 4: Initial focus set by the window counts as free**

В `src/client/components/focus-trap.ts` в конец файла добавьте:

```ts
/** Элементы, на которые фокус поставило само окно при открытии (Modal), — пока фокус на них. */
const initialFocus = new WeakSet<Element>();

/**
 * Отметить элемент, на который окно поставило фокус при открытии (§6.2 этапа 1.5): для автофокуса полей формы он
 * «ничей» — сумма или пустой счёт его заберут. Отметка снимается, как только элемент теряет фокус.
 */
export function markInitialFocus(el: HTMLElement): void {
  initialFocus.add(el);
  el.addEventListener('blur', () => initialFocus.delete(el), { once: true });
}

export function isInitialFocus(el: unknown): boolean {
  return el instanceof Element && initialFocus.has(el);
}
```

`src/client/components/useAutoFocus.ts`:

```ts
import { useEffect, type RefObject } from 'react';
import { isInitialFocus } from './focus-trap';

/**
 * «Ничей» фокус (планы 6a, 1.5-1a, §6.2 этапа 1.5): страница, само окно, «×» окна, радиокнопка или элемент, на который
 * фокус поставило окно при открытии. Такой фокус поле с автофокусом забирает; выбранный человеком — нет.
 */
export function isFreeFocus(el: Element | null): boolean {
  return (
    el === null ||
    el === document.body ||
    el instanceof HTMLDialogElement ||
    (el instanceof HTMLInputElement && el.type === 'radio') ||
    (el instanceof HTMLElement && el.hasAttribute('data-modal-close')) ||
    isInitialFocus(el)
  );
}

/**
 * Поставить фокус в поле при появлении, если он «ничей»: кадр спустя — окно `<dialog>` к этому моменту уже открыто
 * через showModal(). Если человек успел выбрать другое поле (focusin не на «ничьём» элементе) — не трогаем.
 */
export function useAutoFocus(ref: RefObject<HTMLElement | null>, enabled: boolean | undefined): void {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== ref.current && !isFreeFocus(e.target instanceof Element ? e.target : null)) stop();
    };
    document.addEventListener('focusin', onFocusIn);
    frame = requestAnimationFrame(() => {
      stop();
      if (isFreeFocus(document.activeElement)) ref.current?.focus();
    });
    return stop;
  }, [enabled]);
}
```

В `src/client/components/Modal.tsx`:
1) строку `import { cycleTab, firstTabbable, focusPageHeading } from './focus-trap';` замените на `import { cycleTab, firstTabbable, focusPageHeading, markInitialFocus } from './focus-trap';`;
2) строки

```ts
        const first = contentRef.current ? firstTabbable(contentRef.current) : null;
        (first ?? dialog).focus();
```

замените на

```ts
        const first = contentRef.current ? firstTabbable(contentRef.current) : null;
        (first ?? dialog).focus();
        // фокус поставило окно, а не человек: поле с автофокусом (сумма, пустой счёт) его заберёт
        if (first) markInitialFocus(first);
```

В `src/client/components/operation/AmountField.tsx`:
1) строку `import { useEffect, useLayoutEffect, useRef, useState } from 'react';` замените на

```ts
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAutoFocus } from '../useAutoFocus';
```

2) эффект автофокуса целиком — от строки `  useEffect(() => {` с комментарием `    // кадр спустя: окно <dialog> к этому моменту уже открыто через showModal()` до его закрывающей `  }, [props.autoFocus]);` — замените на

```ts
  // фокус в поле при появлении, если он «ничей» (окно только что открылось) — useAutoFocus
  useAutoFocus(ref, props.autoFocus);
```

3) в описании свойства `autoFocus` текст замените на `/** Поставить фокус в поле при появлении, если он ничей (страница, окно, «×», элемент, сфокусированный окном при открытии); иначе не трогать. */`.

- [ ] **Step 5: `DateField` with a floating label**

В `src/client/components/DateField.tsx`:
1) после константы `dateButtonClass` вставьте

```ts
/** Кнопка поля даты с плавающей подписью (§6.3 этапа 1.5): высота 56 px, значение под подписью. */
const floatingDateButtonClass =
  'flex h-14 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 pt-5 pb-1 text-left text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
```

2) в тип свойств после `  className?: string;` вставьте

```ts
  /** Подпись внутри поля (§6.3 этапа 1.5) — «Дата сделки» в форме операции. */
  floating?: boolean;
  error?: string;
```

3) строку `    <Field label={props.label} className={props.className}>` замените на `    <Field label={props.label} className={props.className} floating={props.floating} filled={shown !== null} error={props.error}>`;
4) строку `              <span className={shown ? '' : 'text-muted'}>{shown ?? 'Не выбрана'}</span>` замените на `              <span className={`truncate ${shown ? '' : 'text-muted'}`}>{shown ?? (props.floating ? '' : 'Не выбрана')}</span>`;
5) строку `          buttonClassName={dateButtonClass}` замените на `          buttonClassName={props.floating ? floatingDateButtonClass : dateButtonClass}`.

- [ ] **Step 6: `ActionRow`**

`src/client/components/operation/ActionRow.tsx`:

```tsx
import { useId, type ReactNode, type Ref } from 'react';

/** Вид строки-действия (§6.7 этапа 1.5): на всю ширину, иконка слева, текст; разделитель — у обёртки. */
export const actionRowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-3 text-left text-base outline-none hover:bg-canvas focus-visible:ring-2 focus-visible:ring-focus aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * Строка-действие под полями формы операции (§6.7, §11 этапа 1.5): обычная `<button>` с текстом. Раскрывающая —
 * с `aria-expanded`; неактивная — `aria-disabled` с подсказкой в `aria-describedby` (видна под строкой), остаётся
 * в порядке Tab и ничего не делает; `info` — ⓘ справа: подсказка при наведении и описание для программ чтения.
 */
export function ActionRow(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  expanded?: boolean;
  danger?: boolean;
  disabledHint?: string;
  info?: string;
  /** Текст приглушён (месяц зарплаты по умолчанию, план 1.5-3c). */
  muted?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const hintId = useId();
  const infoId = useId();
  const describedBy = [props.disabledHint ? hintId : null, props.info ? infoId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="border-b border-field">
      <button
        ref={props.buttonRef}
        type="button"
        aria-expanded={props.expanded}
        aria-disabled={props.disabledHint ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => {
          if (!props.disabledHint) props.onClick();
        }}
        className={`${actionRowClass} ${props.danger ? 'text-expense' : 'text-ink'}`}
      >
        <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center ${props.danger ? 'text-expense' : 'text-muted'}`}>
          {props.icon}
        </span>
        <span className={`min-w-0 flex-1 ${props.muted ? 'text-muted' : ''}`}>{props.label}</span>
        {props.info && (
          <span aria-hidden="true" title={props.info} className="grid size-6 shrink-0 place-items-center text-muted">
            ⓘ
          </span>
        )}
      </button>
      {props.disabledHint && (
        <span id={hintId} className="block px-1 pb-2 text-sm text-muted">
          {props.disabledHint}
        </span>
      )}
      {props.info && (
        <span id={infoId} className="sr-only">
          {props.info}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: `SplitEditor` — `ConfirmDialog`, row layout, no inner cancel**

В `src/client/components/operation/SplitEditor.tsx`:
1) после строки `import { api, ApiError } from '../../lib/api';` вставьте `import { ConfirmDialog } from '../ConfirmDialog';` (перенесите к остальным импортам компонентов, если удобнее);
2) из типа свойств удалите строки

```ts
  /** Отменить разбиение: вернуться к одной категории и проекту. */
  onCancel: () => void;
```

3) блок подтверждения в разметке

```tsx
      {confirm && (
        <div role="group" aria-label="Подтверждение" className="flex flex-wrap items-center gap-2 rounded-xl bg-field px-3 py-2 text-sm">
          <span>{confirm.kind === 'mode' ? 'Значения строк будут сброшены.' : 'Строки будут заменены шаблоном, значения сброшены.'}</span>
          <button
            type="button"
            autoFocus
            onClick={() => (confirm.kind === 'mode' ? switchMode(confirm.mode) : apply(confirm.preset))}
            className={btnSmall}
          >
            Сбросить значения
          </button>
          <button type="button" onClick={() => setConfirm(null)} className={btnSmall}>
            Оставить как есть
          </button>
        </div>
      )}
```

удалите целиком;

4) строку открытия строки разбиения и её сетку

```tsx
        <div key={line.key} role="group" aria-label={`Строка ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
```

замените на

```tsx
        <div key={line.key} role="group" aria-label={`Строка ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-2">
```

и над строкой `      {split.lines.map((line, i) => (` вставьте комментарий `      {/* окно 480 px (§6.1 этапа 1.5): категория и проект — в одну строку, ниже сумма (или доля) и «×» */}`.

5) в этой строке после второго `ComboSelect` (проект) поле суммы/доли и кнопку «×» оберните: строку `          {split.mode === 'amount' ? (` замените на

```tsx
          <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          {split.mode === 'amount' ? (
```

а после закрывающей `</button>` кнопки «Убрать строку» (перед `</div>` строки) вставьте `          </div>`; у этой кнопки класс `` className={`${btnSmall} md:mt-3`} `` замените на `` className={`${btnSmall} mt-3`} ``;

6) кнопку внизу

```tsx
      <button type="button" onClick={props.onCancel} className="justify-self-start text-sm font-semibold text-muted underline">
        Отменить разбиение
      </button>
```

замените на подтверждение (роль кнопки отмены — строка «Отменить разделение» в форме):

```tsx
      {/* подтверждение — вложенное окно (§2.4 этапа 1.5): Esc закрывает только его, вопроса формы нет (отложенное 6a №2) */}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'preset' ? `Применить шаблон «${confirm.preset.name}»?` : 'Сменить способ деления?'}
        text={confirm?.kind === 'preset' ? 'Строки будут заменены шаблоном, значения сброшены.' : 'Значения строк будут сброшены.'}
        confirmLabel={confirm?.kind === 'preset' ? 'Применить' : 'Сбросить значения'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'mode') switchMode(confirm.mode);
          else if (confirm?.kind === 'preset') apply(confirm.preset);
        }}
        // переключатель или кнопка шаблона исчезли — фокус на «+ Строка»
        onFocusLost={() => sectionRef.current?.querySelector<HTMLElement>('[data-add-line]')?.focus()}
      />
```

7) у `<section ref={sectionRef} aria-label="Разбиение" className="… md:col-span-2">` удалите `md:col-span-2` из класса.

- [ ] **Step 8: `OperationForm.tsx`**

Перед заменой посмотрите `git log --oneline -8 -- src/client/components/operation/OperationForm.tsx` и `git diff 4bdaf80 -- src/client/components/operation/OperationForm.tsx`: текст ниже — состояние файла после плана 1.5-3a плюс изменения этой задачи. Если в файле есть правки, которых нет ниже (исправления ревью 1.5-3a), перенесите их в новый текст.

`src/client/components/operation/OperationForm.tsx` целиком:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Link } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import { uploadAttachment, uploadErrorText, useAttachments } from '../../lib/attachments';
import type { OperationType } from '../../lib/journal-filter';
import { invalidateOperations } from '../../lib/journal-mutations';
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, withoutArchived, type Available, type OperationRecord } from '../../lib/operation-edit';
import {
  buildBody,
  COMMENT_MAX,
  emptyDraft,
  FIELD_LABELS,
  operationTitle,
  positiveAmount,
  similarDraft,
  submitLabel,
  transferRateText,
  type OperationDraft,
} from '../../lib/operation-form';
import { accountOptions, categoryOptions, counterpartyLabel, counterpartyOptions, preferredCounterpartyType, projectOptions, tagOptions } from '../../lib/operation-options';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import {
  savePreference,
  useAccounts,
  useCategories,
  useCounterparties,
  usePreferences,
  useProjects,
  useSplitPresets,
  useTags,
  type Account,
  type CategoryTree,
  type Company,
  type Counterparty,
  type Project,
  type SplitPreset,
  type Tag,
} from '../../lib/queries';
import { useMeta } from '../../lib/query';
import { startSplit } from '../../lib/split';
import { ConfirmDialog } from '../ConfirmDialog';
import { DateField } from '../DateField';
import { Field } from '../Field';
import { CalendarIcon, ChevronIcon, CopyIcon, SplitIcon, TrashIcon } from '../icons';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import { SearchPicker } from '../SearchPicker';
import {
  alertClass,
  btnExpense,
  btnIcon,
  btnIncome,
  btnPrimary,
  btnSecondary,
  btnSmall,
  btnTransfer,
  floatingControlClass,
  floatingTextareaClass,
  noticeClass,
} from '../ui';
import { ActionRow } from './ActionRow';
import { AmountField } from './AmountField';
import { AttachmentsField } from './AttachmentsField';
import { ComboSelect } from './ComboSelect';
import type { OperationFormRequest } from './OperationFormHost';
import { RateFix, type MissingRate } from './RateFix';
import { SplitEditor } from './SplitEditor';

export interface FormData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
  presets: SplitPreset[];
}

/** Подсказка у полей, которые нельзя менять: операция затрагивает архивный счёт (инвариант 7, §7). */
const LOCKED_HINT = 'счёт в архиве';

/**
 * Окно 480 px в одну колонку (§6.1 этапа 1.5); на телефоне (меньше 768 px) — на весь экран (§7); в PWA на iPhone поля
 * не уходят под вырез экрана и «домашнюю» полосу (safe-area).
 */
const MODAL_CLASS =
  'max-w-[480px] max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none max-md:pr-[env(safe-area-inset-right)] max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)]';

/** Главная кнопка — цвета типа (§6.9 этапа 1.5). */
const SUBMIT_CLASS: Record<OperationType, string> = { income: btnIncome, expense: btnExpense, transfer: btnTransfer };

/** Ошибки полей из ответа сервера: `lines.0.amount` → `lines`, `tagIds.1` → `tagIds`. */
export function serverFieldErrors(fields: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields ?? {})) out[key.split('.')[0]!] ??= message;
  return out;
}

/**
 * Форма операции (§7, §6 этапа 1.5): отдельное окно на тип — доход, расход, перевод. Окно открыто, пока форма
 * смонтирована; закрытие — через `<dialog>.close()`, чтобы фокус вернулся на кнопку, с которой форму открыли.
 */
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(props.request.kind === 'edit');
  const deleted = useRef(false);
  const editId = props.request.kind === 'edit' ? props.request.id : null;
  // операция для правки — всегда свежая с сервера: версия нужна для PATCH
  const operation = useQuery<OperationRecord, ApiError>({
    queryKey: ['operation', props.company.id, editId],
    queryFn: async () => (await api<{ operation: OperationRecord }>(`/companies/${props.company.id}/operations/${editId}`)).operation,
    enabled: editId !== null,
    gcTime: 0,
  });
  const cancel = useRef<() => void>(() => setOpen(false));
  const meta = useMeta();
  const accounts = useAccounts(props.company.id);
  const categories = useCategories(props.company.id);
  const projects = useProjects(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const tags = useTags(props.company.id);
  const presets = useSplitPresets(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags, ...(editId !== null ? [operation] : [])];
  const data: FormData | null =
    accounts.data && categories.data && projects.data && counterparties.data && tags.data
      ? {
          accounts: accounts.data,
          categories: categories.data,
          projects: projects.data,
          counterparties: counterparties.data,
          tags: tags.data,
          // шаблоны разделения форму не блокируют: не загрузились — список пуст
          presets: presets.data ?? [],
        }
      : null;
  // тип новой операции задаёт кнопка шапки, существующей — она сама (§6.1 этапа 1.5); пока операция грузится — «Операция»
  const type = props.request.kind === 'create' ? props.request.type : operation.data?.type;

  return (
    <Modal
      open={open}
      title={type ? operationTitle(type, editing) : 'Операция'}
      onClose={() => {
        props.onClose();
        // после удаления строки, с которой открыли форму, больше нет — фокус туда, куда просил открывший
        const target = deleted.current && props.request.kind === 'edit' ? props.request.focusAfterDelete?.() : null;
        if (target) requestAnimationFrame(() => target.focus());
      }}
      onCancel={() => cancel.current()}
      className={MODAL_CLASS}
      phoneFullScreen
    >
      {data && meta.data && (editId === null || operation.data) ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.kind === 'create' ? props.request.type : operation.data!.type}
          operation={operation.data ?? null}
          onEditingChange={setEditing}
          onDeleted={() => (deleted.current = true)}
          close={() => setOpen(false)}
          cancelRef={cancel}
        />
      ) : (
        <Pending queries={queries} />
      )}
    </Modal>
  );
}

function OperationEditor(p: {
  company: Company;
  data: FormData;
  timeZone: string;
  type: OperationType;
  /** Правка существующей операции; null — новая. */
  operation: OperationRecord | null;
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
  onEditingChange: (editing: boolean) => void;
  /** Операция удалена: окно закроется, фокус — не на исчезнувшую строку. */
  onDeleted: () => void;
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
  cancelRef: MutableRefObject<() => void>;
}) {
  const today = todayInTimezone(p.timeZone);
  // архивная компания — только просмотр: поля недоступны, строк-действий, кнопок сохранения и файлов нет
  const readOnly = p.company.archivedAt !== null;
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() => (op ? draftFromOperation(op, accounts, p.timeZone) : emptyDraft(p.type, today, firstAccount)));
  const [draft, setDraft] = useState(initial);
  /** «Удалить платёж» (§6.7 этапа 1.5): подтверждение — вложенное окно. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 409 при сохранении правки: операцию изменили или удалили после того, как форму открыли. */
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null);
  /** RATE_UNAVAILABLE: какого курса нет; «Повторить» сохраняет тем же способом (lastThen). */
  const [missingRate, setMissingRate] = useState<MissingRate | null>(null);
  const lastThen = useRef<'close' | 'similar'>('close');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** «Больше не спрашивать» (§2.4 этапа 1.5): настройка пользователя; флажок в вопросе — до нажатия «Закрыть». */
  const prefs = usePreferences();
  const skipAsk = skipCloseConfirm(prefs.data);
  const [dontAsk, setDontAsk] = useState(false);
  // блок строки «Добавить проект, тег, комментарий, файл» раскрыт, если в нём уже что-то есть (§6.7 этапа 1.5)
  const [more, setMore] = useState(() => readOnly || initial.projectId !== null || initial.tagIds.length > 0 || initial.comment !== '');
  const [refocusAmount, setRefocusAmount] = useState(0);
  /** Строка «Дата сделки отличается» и поле «Дата сделки» сменяют друг друга: куда перевести фокус после смены. */
  const [accrualFocus, setAccrualFocus] = useState<'field' | 'row' | null>(null);
  const accrualRowRef = useRef<HTMLButtonElement>(null);
  // файлы операции раскрывают тот же блок; их список приходит отдельным запросом (его же использует AttachmentsField)
  const hasFiles = (useAttachments(p.company.id, op?.id ?? null).data?.length ?? 0) > 0;
  useEffect(() => {
    if (hasFiles) setMore(true);
  }, [hasFiles]);
  /** Файлы, выбранные до создания операции: загружаются сразу после него (§7). */
  const [files, setFiles] = useState<File[]>([]);
  /** Ошибка сохранения: фокус — на первое поле с ошибкой или действие в сообщении (поля были недоступны, фокус потерян). */
  const formRef = useRef<HTMLFormElement>(null);
  const [errorFocus, setErrorFocus] = useState(0);
  const dirty = files.length > 0 || JSON.stringify(draft) !== JSON.stringify(initial);
  /** Только просмотр: поле суммы недоступно, начальный фокус — на «×» окна. */
  const closeButton = () => formRef.current?.closest('dialog')?.querySelector<HTMLButtonElement>('[data-modal-close]') ?? null;

  useEffect(() => {
    if (!readOnly) return;
    closeButton()?.focus({ preventScroll: true });
    // окно ещё может открываться (данные были в кэше): showModal() переставил бы фокус на первый элемент
    const frame = requestAnimationFrame(() => {
      const close = closeButton();
      if (close?.isConnected && document.activeElement !== close) close.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [readOnly]);

  useEffect(() => {
    if (!accrualFocus) return;
    const target = accrualFocus === 'row' ? accrualRowRef.current : formRef.current?.querySelector<HTMLElement>('[data-accrual-field] button');
    target?.focus();
    setAccrualFocus(null);
  }, [accrualFocus]);

  useEffect(() => {
    if (!errorFocus) return;
    const form = formRef.current;
    const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>('[role="alert"] button');
    if (target) target.focus();
    else setRefocusAmount((n) => n + 1);
  }, [errorFocus]);

  // Esc и «×»: пока идёт запрос — ничего (окно закрылось бы, а операция всё равно сохранится); есть несохранённые
  // изменения и вопрос не выключен — спросить (вложенное окно, его Esc сюда не доходит); иначе закрыть.
  // Вложенные подтверждения («Удалить платёж?», разбиение) свои Esc обрабатывают сами
  p.cancelRef.current = () => {
    if (pending) return;
    if (dirty && !skipAsk) {
      setDontAsk(false);
      setConfirmClose(true);
    } else p.close();
  };

  const account = draft.accountId === null ? undefined : accounts.get(draft.accountId);
  const toAccount = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId);
  const currency = getCurrency(account?.currency ?? p.company.baseCurrency);
  const toCurrency = toAccount ? getCurrency(toAccount.currency) : null;
  const transfer = draft.type === 'transfer';
  const labels = FIELD_LABELS[draft.type];
  const crossCurrency = transfer && toCurrency !== null && toCurrency.code !== currency.code;
  const kind = draft.type === 'income' ? 'income' : 'expense';
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);
  const amountParsed = positiveAmount(draft.amount, currency.minorUnits);
  const amountMinor = amountParsed.ok ? amountParsed.minor : null;
  // подходящий тип контрагента — по категории операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
  // операция на архивном счёте: сумма, дата оплаты и счета заблокированы, удалить нельзя (инвариант 7)
  const locked = op ? archivedAccountOf(op, accounts) : null;
  const lockHint = locked ? LOCKED_HINT : undefined;

  /**
   * «+ Создать „…“» (§7): создать элемент справочника и выбрать его. Контрагент получает тип, подходящий категории,
   * иначе «Клиент» у дохода и «Поставщик» у расхода. apply — функцией от свежего черновика: создание идёт асинхронно.
   */
  const createItem = async (what: CreatableKind, name: string, apply: (d: OperationDraft, id: number) => OperationDraft) => {
    setFormError(null);
    try {
      const counterpartyType = preferredCounterpartyType(p.data.categories, mainCategory) ?? (kind === 'income' ? 'client' : 'supplier');
      const id = await createFromForm(p.company.id, what, name, { kind, counterpartyType });
      setDraft((d) => apply(d, id));
    } catch (e) {
      const message = e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера';
      setFormError(`Не удалось создать «${name}»: ${message}`);
    }
  };
  const createLine = (field: 'categoryId' | 'projectId') => (name: string, key: number) =>
    void createItem(field === 'categoryId' ? 'category' : 'project', name, (d, id) =>
      d.split ? { ...d, split: { ...d.split, lines: d.split.lines.map((l) => (l.key === key ? { ...l, [field]: id } : l)) } } : d,
    );

  /** Изменение полей: сбрасывает их ошибки и сообщение «сохранено». */
  const set = (patch: Partial<OperationDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
    // курс, которого не хватало, относился к прежней дате/счёту
    if ('paidDate' in patch || 'accountId' in patch || 'toAccountId' in patch) setMissingRate(null);
    if (errorKeys.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k))));
  };

  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
    lastThen.current = then;
    setMissingRate(null);
    const now = new Date();
    // у существующей операции при смене дня сохраняется прежнее время суток
    const timeOfDayFrom = op ? new Date(op.paidAt) : now;
    // buildBody вычисляет выражение в сумме само: Enter или главная кнопка без ухода из поля сохраняют результат
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    try {
      if (op) {
        // в PATCH — только изменённые поля (итоги плана 4a, п. 1); без изменений запроса нет
        const patch = patchBody(op, r.body, p.timeZone);
        if (patch) await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'PATCH', body: patch });
      } else {
        const created = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body })).operation;
        const failed: string[] = [];
        for (const f of files) {
          try {
            await uploadAttachment(p.company.id, created.id, f);
          } catch (e) {
            failed.push(`«${f.name}»: ${uploadErrorText(e)}`);
          }
        }
        setFiles([]);
        if (failed.length > 0) {
          // операция уже есть: форма переходит к её правке, чтобы файл можно было выбрать заново
          void invalidateOperations(p.company.id);
          const saved = draftFromOperation(created, accounts, p.timeZone);
          setOp(created);
          p.onEditingChange(true);
          setDraft(saved);
          setInitial(saved);
          setMore(true);
          setFormError(`Операция сохранена, но не загружено: ${failed.join('; ')}`);
          setErrorFocus((n) => n + 1);
          return;
        }
      }
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      // после правки: архивные счёт, категории и прочее в новую операцию не переносятся (инвариант 7)
      const next = op ? withoutArchived(similarDraft(draft), available()) : similarDraft(draft);
      setOp(null);
      p.onEditingChange(false);
      setDraft(next);
      setInitial(next);
      setStatus('Операция сохранена — можно ввести похожую');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_UNAVAILABLE' && e.details?.currency && e.details.date) {
        setMissingRate({ message: e.message, currency: e.details.currency, date: e.details.date });
        setErrorFocus((x) => x + 1);
        return;
      }
      if (op && e instanceof ApiError && e.status === 409) {
        if (e.message.startsWith('Операция удалена')) {
          setConflict('deleted');
          // строки больше нет: «Закрыть» вернёт фокус на заголовок журнала
          p.onDeleted();
        } else setConflict('changed');
        void invalidateOperations(p.company.id);
        setErrorFocus((n) => n + 1);
        return;
      }
      setErrors(serverFieldErrors(e instanceof ApiError ? e.fields : undefined));
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
      setErrorFocus((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  /** «Загрузить актуальную» (§7): форма показывает свежую версию, свои изменения пользователь вносит заново. */
  const reload = async () => {
    if (!op) return;
    setPending(true);
    try {
      const fresh = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations/${op.id}`)).operation;
      if (fresh.deletedAt) {
        setConflict('deleted');
        p.onDeleted();
        return;
      }
      const next = draftFromOperation(fresh, accounts, p.timeZone);
      setOp(fresh);
      setDraft(next);
      setInitial(next);
      setConflict(null);
      setErrors({});
      setFormError(null);
      setStatus('Загружена актуальная версия — внесите изменения заново');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** Неархивные элементы справочников: только их может выбрать новая операция (инвариант 7). */
  const available = (): Available => {
    const ids = <T extends { id: number; archivedAt: string | null }>(xs: readonly T[]) => new Set(xs.filter((x) => !x.archivedAt).map((x) => x.id));
    const categories = new Set(
      [...p.data.categories.income, ...p.data.categories.expense].flatMap((n) =>
        n.archivedAt ? [] : [n.id, ...n.children.filter((c) => !c.archivedAt).map((c) => c.id)],
      ),
    );
    return { accounts: ids(p.data.accounts), categories, projects: ids(p.data.projects), counterparties: ids(p.data.counterparties), tags: ids(p.data.tags) };
  };

  /** «Удалить платёж» после подтверждения: успех — окно закрывается; ошибка — сообщение, фокус возвращается на строку. */
  const remove = async () => {
    if (!op) return;
    setPending(true);
    setFormError(null);
    try {
      await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'DELETE' });
      void invalidateOperations(p.company.id);
      setConfirmDelete(false);
      p.onDeleted();
      p.close();
    } catch (e) {
      setConfirmDelete(false);
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** «Дублировать платёж» (§6.7): новая операция с теми же значениями на сегодня; закрыть её без сохранения — с вопросом. */
  const duplicate = () => {
    const copy = duplicateDraft(draft, available(), today);
    setOp(null);
    p.onEditingChange(false);
    setFiles([]);
    setDraft(copy);
    setInitial(emptyDraft(copy.type, today, firstAccount));
    setErrors({});
    setFormError(null);
    setConflict(null);
    setMissingRate(null);
    setStatus('Это копия — проверьте и сохраните');
    setRefocusAmount((n) => n + 1);
  };

  /** «Разделить платёж» / «Отменить разделение» (§6.7, строка 2): разбиение — на месте категории. */
  const toggleSplit = () => {
    if (draft.split) {
      set({ split: null, categoryId: draft.split.lines[0]?.categoryId ?? null, projectId: draft.split.lines[0]?.projectId ?? null }, 'lines');
    } else set({ split: startSplit(draft.categoryId, draft.projectId, draft.amount) }, 'lines');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    void submit('close');
  };

  if (!op && activeAccounts.length === 0) {
    return (
      <div>
        <p className="mb-4 text-muted">В компании нет счетов — операцию не к чему привязать.</p>
        <div className="flex gap-2">
          <Link to={`/c/${p.company.id}/settings/accounts`} onClick={p.close} className={btnPrimary}>
            Добавить счёт
          </Link>
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const accountField = (label: string, key: 'accountId' | 'toAccountId') => (
    <ComboSelect
      label={label}
      listLabel="Счета"
      value={draft[key]}
      options={accountOptions(p.data.accounts, draft[key])}
      emptyLabel={null}
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
      disabled={!!locked}
      hint={lockHint}
    />
  );

  // дата оплаты — пока календарная дата (`type="date"`); дату и время (`DateTimeField`) добавит план 1.5-3c
  const paidDateField = (
    <Field label={labels.paidDate} error={errors.paidAt} hint={lockHint} floating filled>
      {(c) => (
        <input
          {...c}
          type="date"
          max={today}
          disabled={!!locked}
          value={draft.paidDate}
          onChange={(e) => set({ paidDate: e.target.value }, 'paidAt')}
          className={floatingControlClass}
        />
      )}
    </Field>
  );

  const amountField = (
    <AmountField
      label={`Сумма, ${currency.symbol}`}
      value={draft.amount}
      onChange={(amount) => set({ amount }, 'amount')}
      minorUnits={currency.minorUnits}
      error={errors.amount}
      autoFocus
      refocusSignal={refocusAmount}
      disabled={!!locked}
      hint={lockHint}
    />
  );

  /** «Дата сделки» вместо строки «Дата сделки отличается» (§6.7, строка 1); «✕» возвращает строку. */
  const accrualField = (
    <div data-accrual-field="" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b border-field py-2">
      <DateField label="Дата сделки" value={draft.accrualDate} today={today} floating error={errors.accrualDate} onChange={(accrualDate) => set({ accrualDate }, 'accrualDate')} />
      {!readOnly && (
        <button
          type="button"
          aria-label="Убрать дату сделки"
          title="Убрать дату сделки"
          onClick={() => {
            set({ accrualOn: false }, 'accrualDate');
            setAccrualFocus('row');
          }}
          className={`${btnIcon} mt-3`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );

  /** Блок строки «Добавить проект, тег, комментарий, файл» — в одну колонку (§6.7, строка 3). */
  const moreBlock = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-field py-3">
      {!draft.split && (
        <ComboSelect
          label="Проект"
          listLabel="Проекты"
          value={draft.projectId}
          options={projectOptions(p.data.projects, [draft.projectId])}
          emptyLabel="Без проекта"
          onChange={(projectId) => set({ projectId }, 'lines')}
          onCreate={(name) => void createItem('project', name, (d, projectId) => ({ ...d, projectId }))}
          createNoun="проект"
          error={transfer ? errors.lines : undefined}
        />
      )}
      <TagsField
        tags={p.data.tags}
        value={draft.tagIds}
        onChange={(tagIds) => set({ tagIds }, 'tagIds')}
        onCreate={(name) => void createItem('tag', name, (d, id) => ({ ...d, tagIds: [...d.tagIds, id] }))}
        error={errors.tagIds}
      />
      <Field label="Комментарий" error={errors.comment} floating filled={draft.comment !== ''}>
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
      <AttachmentsField companyId={p.company.id} operationId={op?.id ?? null} pending={files} onPendingChange={setFiles} readOnly={readOnly} />
    </div>
  );

  /**
   * Строки-действия (§6.7 этапа 1.5) в порядке Finmap: 1 «Дата сделки отличается», 2 «Разделить платёж», 3 «Добавить
   * проект, тег, комментарий, файл» (его блок — сразу под ней), 5 «Дублировать платёж», 6 «Удалить платёж». У перевода —
   * 3, 5, 6. Строка 4 «Изменить в перевод» появится в плане 1.5-6: до тех пор её нет совсем (мёртвых кнопок нет).
   */
  const rows = (
    <div className="border-t border-field">
      {!transfer &&
        (draft.accrualOn ? (
          accrualField
        ) : (
          <ActionRow
            buttonRef={accrualRowRef}
            icon={<CalendarIcon />}
            label="Дата сделки отличается"
            info="Дата начисления для отчёта о прибылях и убытках"
            onClick={() => {
              set({ accrualOn: true, accrualDate: draft.paidDate }, 'accrualDate');
              setAccrualFocus('field');
            }}
          />
        ))}
      {!transfer && <ActionRow icon={<SplitIcon />} label={draft.split ? 'Отменить разделение' : 'Разделить платёж'} onClick={toggleSplit} />}
      <ActionRow icon={<ChevronIcon up={more} />} label="Добавить проект, тег, комментарий, файл" expanded={more} onClick={() => setMore((v) => !v)} />
      {more && moreBlock}
      {op && <ActionRow icon={<CopyIcon />} label="Дублировать платёж" onClick={duplicate} />}
      {op && (
        <ActionRow
          icon={<TrashIcon />}
          label="Удалить платёж"
          danger
          onClick={() => setConfirmDelete(true)}
          disabledHint={locked ? `Удалить нельзя: ${LOCKED_HINT} («${locked.name}»)` : undefined}
        />
      )}
    </div>
  );

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} noValidate aria-label="Операция" className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {readOnly && <p className={`${noticeClass} mb-0`}>Компания в архиве — изменения недоступны.</p>}
        {/* пока запрос идёт, поля недоступны: «похожий» копирует ровно то, что ушло на сервер */}
        <fieldset disabled={pending || readOnly} className="contents">
          {/* порядок полей — как в Finmap (§6.2 этапа 1.5); у перевода дата первой */}
          {transfer && paidDateField}
          {accountField(labels.account, 'accountId')}
          {transfer && accountField('На счёт', 'toAccountId')}
          {transfer ? (
            amountField
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              {amountField}
              {account && <CurrencyBadge code={currency.code} symbol={currency.symbol} />}
            </div>
          )}
          {crossCurrency && toCurrency && (
            <AmountField
              label={`Сумма зачисления, ${toCurrency.symbol}`}
              value={draft.toAmount}
              onChange={(toAmount) => set({ toAmount }, 'toAmount')}
              minorUnits={toCurrency.minorUnits}
              error={errors.toAmount}
              disabled={!!locked}
              hint={lockHint ?? rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits)}
            />
          )}
          {!transfer &&
            (draft.split ? (
              <SplitEditor
                companyId={p.company.id}
                kind={kind}
                value={draft.split}
                onChange={(split) => set({ split }, 'lines')}
                total={amountMinor}
                currency={currency.code}
                minorUnits={currency.minorUnits}
                categories={p.data.categories}
                projects={p.data.projects}
                presets={p.data.presets}
                error={errors.lines}
                onCreateCategory={createLine('categoryId')}
                onCreateProject={createLine('projectId')}
              />
            ) : (
              <ComboSelect
                label="Категория"
                listLabel="Категории"
                value={draft.categoryId}
                options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
                emptyLabel="Без категории"
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                onCreate={(name) => void createItem('category', name, (d, categoryId) => ({ ...d, categoryId }))}
                createNoun="категорию"
                error={errors.lines}
              />
            ))}
          {!transfer && (
            <ComboSelect
              label={counterpartyLabel(p.data.categories, mainCategory)}
              listLabel="Контрагенты"
              value={draft.counterpartyId}
              options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
              emptyLabel="Без контрагента"
              onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
              onCreate={(name) => void createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId }))}
              createNoun="контрагента"
              error={errors.counterpartyId}
            />
          )}
          {!transfer && paidDateField}
          {readOnly ? (
            // архивная компания: только поля, без строк-действий (§6.7)
            <>
              {!transfer && draft.accrualOn && accrualField}
              {moreBlock}
            </>
          ) : (
            rows
          )}
        </fieldset>

        {missingRate && <RateFix missing={missingRate} companyId={p.company.id} pending={pending} onRetry={() => void submit(lastThen.current)} />}
        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>{conflict === 'changed' ? 'Операция изменена другим пользователем' : 'Операция удалена другим пользователем'}</span>
            {conflict === 'changed' ? (
              <button type="button" disabled={pending} onClick={() => void reload()} className="font-semibold underline">
                Загрузить актуальную
              </button>
            ) : (
              <button type="button" onClick={p.close} className="font-semibold underline">
                Закрыть
              </button>
            )}
          </div>
        )}
        {formError && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {formError}
          </p>
        )}
        {/* область role="status" есть всегда — меняется только текст, так его объявляют программы чтения с экрана */}
        <p role="status" className={status ? 'rounded-xl bg-income-soft px-4 py-3 text-sm text-income' : 'sr-only'}>
          {status}
        </p>

        {/* в архивной форме кнопок нет: закрывает только «×» окна, как в Finmap */}
        {!readOnly && (
          <div className="grid justify-items-center gap-1">
            <button type="submit" disabled={pending} className={SUBMIT_CLASS[draft.type]}>
              {submitLabel(draft.type, op !== null)}
            </button>
            {/* «создать похожий» — только при создании; при правке его роль — «Дублировать платёж» (§6.9) */}
            {!op && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void submit('similar')}
                className="flex items-center gap-2 rounded-lg px-3 py-2 font-semibold text-ink hover:bg-canvas disabled:opacity-50"
              >
                <span aria-hidden="true" className="text-xl leading-none text-muted">
                  +
                </span>
                Добавить и создать похожий
              </button>
            )}
          </div>
        )}
      </form>
      <ConfirmDialog
        open={confirmClose}
        title="Ваши данные не сохранятся"
        text="Закрыть окно? Введённые данные будут потеряны."
        confirmLabel="Закрыть"
        checkbox={{ label: 'Больше не спрашивать', checked: dontAsk, onChange: setDontAsk }}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          // сбой сохранения настройки не мешает закрыть окно: в следующий раз просто спросят снова
          if (dontAsk) savePreference(SKIP_CLOSE_CONFIRM_PREF, true).catch(() => undefined);
          p.close();
        }}
        // «×» или поле, с которого спросили, исчезли — фокус в поле суммы
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить платёж?"
        text="Операция будет удалена из журнала и итогов."
        confirmLabel="Удалить"
        danger
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
    </>
  );
}

/** «Валюта» рядом с суммой (§6.2 этапа 1.5): неактивный значок валюты счёта — ввод в другой валюте не делается (§1). */
function CurrencyBadge(props: { code: string; symbol: string }) {
  return (
    <div className="flex h-14 flex-col justify-center rounded-xl bg-field px-4">
      <span className="text-xs text-muted">Валюта</span>
      <span className="whitespace-nowrap">
        {props.code} ({props.symbol})
      </span>
    </div>
  );
}

/** Подсказка у «Суммы зачисления»: курс из двух сумм, когда обе введены. */
function rateHint(draft: OperationDraft, from: string, fromMinor: number, to: string, toMinor: number): string | undefined {
  const a = positiveAmount(draft.amount, fromMinor);
  const b = positiveAmount(draft.toAmount, toMinor);
  const text = a.ok && b.ok ? transferRateText(a.minor, from, b.minor, to) : null;
  return text ? `Курс: ${text}` : undefined;
}

/** Теги операции: выбранные — с кнопкой «убрать», добавление — список с поиском (поле с плашками — задача 3). */
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; onCreate: (name: string) => void; error?: string }) {
  const names = new Map(props.tags.map((t) => [t.id, t.name]));
  const options = tagOptions(props.tags, props.value).filter((o) => !props.value.includes(o.id));
  return (
    <div role="group" aria-label="Теги">
      <span className="mb-1 block text-sm text-muted">Теги</span>
      <div className="flex flex-wrap items-center gap-2">
        {props.value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-field px-3 py-1 text-sm">
            {names.get(id) ?? '…'}
            <button type="button" aria-label={`Убрать тег «${names.get(id) ?? ''}»`} onClick={() => props.onChange(props.value.filter((x) => x !== id))} className="text-muted hover:text-ink">
              ×
            </button>
          </span>
        ))}
        <SearchPicker
          label="+ Тег"
          ariaLabel="Добавить тег"
          listLabel="Теги"
          options={options}
          onPick={(id) => props.onChange([...props.value, id])}
          onCreate={props.onCreate}
          createNoun="тег"
          buttonClassName={btnSmall}
        />
      </div>
      {props.error && <span className="mt-1 block text-sm text-expense">{props.error}</span>}
    </div>
  );
}
```

Run: `npm run typecheck` → без ошибок (`grep -rn "onCancel=" src/client/components/operation/OperationForm.tsx` — у `SplitEditor` его нет).

- [ ] **Step 9: E2E — `e2e/operation-form.spec.ts`**

1) Строку

```ts
const form = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });
```

замените на

```ts
/** Окно новой операции (§6.1 этапа 1.5): своё на тип. */
const form = (page: Page) => page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });
const TITLES = { Доход: 'Новый доход', Расход: 'Новый расход', Перевод: 'Новый перевод' } as const;
/** Главная кнопка формы (§6.9 этапа 1.5). */
const submit = (scope: Locator) => scope.getByRole('button', { name: /^(Добавить (доход|расход|перевод)|Сохранить изменения)$/ });
```

2) В `openForm` строки

```ts
  await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
  await expect(form(page)).toBeVisible();
  return form(page);
```

замените на

```ts
  await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: TITLES[button], exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
```

3) Во всём файле замените (все вхождения):
- `dialog.getByRole('button', { name: 'Сохранить', exact: true })` → `submit(dialog)`;
- `dialog.getByRole('button', { name: 'Сохранить и создать похожий' })` → `dialog.getByRole('button', { name: 'Добавить и создать похожий' })`;
- `dialog.getByRole('button', { name: 'Проект, теги, комментарий' })` → `dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })`;
- `dialog.getByRole('button', { name: 'Разделить', exact: true })` → `dialog.getByRole('button', { name: 'Разделить платёж' })`;
- `pick(page, 'Счёт', 'Касса')` → `pick(page, 'На счёт', 'Касса')` (оба места — у дохода).

4) Тест «доход, расход и перевод…»: строку `  await expect(dialog.getByRole('radio', { name: 'Доход' })).toBeChecked();` замените на

```ts
  // отдельное окно на тип: вкладок нет, окно не шире 480 px, кнопка — «Добавить доход» (§6.1, §6.9)
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(480);
  await expect(submit(dialog)).toHaveText('Добавить доход');
```

а после строки `  await pick(page, 'Категория', 'Выручка');` (первой в этом тесте) вставьте

```ts
  // «Валюта» — значок валюты счёта рядом с суммой (§6.2)
  await expect(dialog.getByText('KZT (₸)')).toBeVisible();
  // «Дата сделки отличается» — строка-действие: открывает поле «Дата сделки», «✕» возвращает строку (§6.7)
  const accrualRow = dialog.getByRole('button', { name: 'Дата сделки отличается' });
  await expect(accrualRow).toHaveAccessibleDescription('Дата начисления для отчёта о прибылях и убытках');
  await accrualRow.click();
  await expect(dialog.getByRole('button', { name: /^Дата сделки:/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Убрать дату сделки' }).click();
  await expect(accrualRow).toBeFocused();
```

в части перевода после строки `  dialog = await openForm(page, 'Перевод');` вставьте

```ts
  // у перевода дата — первой, затем «Со счёта», «На счёт», сумма; значка «Валюта» нет (§6.2)
  const top = async (l: Locator) => (await l.boundingBox())!.y;
  expect(await top(dialog.getByLabel('Дата перевода денег'))).toBeLessThan(await top(field(dialog, 'Со счёта')));
  expect(await top(field(dialog, 'Со счёта'))).toBeLessThan(await top(field(dialog, 'На счёт')));
  expect(await top(field(dialog, 'На счёт'))).toBeLessThan(await top(dialog.getByRole('textbox', { name: /^Сумма,/ })));
  await expect(dialog.getByText('Валюта', { exact: true })).toHaveCount(0);
```

5) Тест «„Разделить“ в процентах…» — фрагмент

```ts
  // в первой строке уже стоит вся сумма: смена режима сбрасывает значения — сначала вопрос
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await expect(split.getByRole('group', { name: 'Подтверждение' })).toContainText('Значения строк будут сброшены');
  await split.getByRole('button', { name: 'Оставить как есть' }).click();
  await expect(split.getByRole('radio', { name: 'Суммами' })).toBeChecked();
  await expect(split.getByRole('group', { name: 'Строка 1' }).getByRole('textbox', { name: /^Сумма/ })).toHaveValue('1000');
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await split.getByRole('button', { name: 'Сбросить значения' }).click();
```

замените на

```ts
  // в первой строке уже стоит вся сумма: смена способа сбрасывает значения — сначала вопрос (вложенное окно)
  await split.getByRole('radio', { name: 'В процентах' }).click();
  const reset = page.getByRole('alertdialog', { name: 'Сменить способ деления?' });
  await expect(reset).toHaveAccessibleDescription('Значения строк будут сброшены.');
  // Esc закрывает только вопрос: окно открыто, вопроса о несохранённом нет (Review Focus 2, отложенное 6a №2)
  await page.keyboard.press('Escape');
  await expect(reset).toBeHidden();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await reset.getByRole('button', { name: 'Отменить' }).click();
  await expect(split.getByRole('radio', { name: 'Суммами' })).toBeChecked();
  await expect(split.getByRole('group', { name: 'Строка 1' }).getByRole('textbox', { name: /^Сумма/ })).toHaveValue('1000');
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await reset.getByRole('button', { name: 'Сбросить значения' }).click();
```

и строки

```ts
  // в первой строке стоит сумма операции: шаблон заменит строки — сначала вопрос
  await split.getByRole('button', { name: 'Сбросить значения' }).click();
```

замените на

```ts
  // в первой строке стоит сумма операции: шаблон заменит строки — сначала вопрос
  await page.getByRole('alertdialog', { name: 'Применить шаблон «Север и Юг»?' }).getByRole('button', { name: 'Применить' }).click();
  // строка 2 стала «Отменить разделение»
  await expect(dialog.getByRole('button', { name: 'Отменить разделение' })).toBeVisible();
```

6) Тест «нет курса на дату…»: `dialog.getByLabel('Дата оплаты')` → `dialog.getByLabel('Указать дату списания')`.

- [ ] **Step 10: E2E — `e2e/operation-edit.spec.ts`**

1) Строку `const editForm = (page: Page) => page.getByRole('dialog', { name: 'Изменить операцию' });` замените на

```ts
/** Окно правки (§6.1 этапа 1.5): заголовок — тип операции. */
const editForm = (page: Page) => page.getByRole('dialog', { name: /^(Доход|Расход|Перевод)$/ });
/** Главная кнопка формы (§6.9 этапа 1.5). */
const submit = (scope: Locator) => scope.getByRole('button', { name: /^(Добавить (доход|расход|перевод)|Сохранить изменения)$/ });
```

и в первой строке файла `import { expect, test, type Page } from '@playwright/test';` добавьте `type Locator`.

2) Во всём файле замените (все вхождения):
- `dialog.getByRole('button', { name: 'Сохранить', exact: true })` → `submit(dialog)`;
- `page.getByRole('dialog', { name: 'Новая операция' })` → в тестах «правка из журнала…», «фокус и закрытие формы…», «409: „Дублировать“…», «файлы: выбранный до сохранения…» — `page.getByRole('dialog', { name: 'Новый расход' })`; в тесте «файл, который сервер не принял…» — `page.getByRole('dialog', { name: 'Новый доход' })`;
- `getByRole('button', { name: 'Дублировать' })` → `getByRole('button', { name: 'Дублировать платёж' })`;
- `getByRole('button', { name: 'Проект, теги, комментарий, файл' })` → `getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })`.

3) Тест «правка из журнала…»: строку `  await expect(dialog.getByRole('combobox', { name: 'Счёт', exact: true })).toHaveValue('Касса');` замените на

```ts
  // окно правки называется по типу; счёт расхода — «Со счёта»; кнопка — «Сохранить изменения» (§6.1, §6.2, §6.9)
  await expect(page.getByRole('dialog', { name: 'Расход', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(submit(dialog)).toHaveText('Сохранить изменения');
  await expect(dialog.getByRole('button', { name: 'Добавить и создать похожий' })).toHaveCount(0);
```

а фрагмент от строки `  // «Удалить» с подтверждением; Esc отменяет только подтверждение` до конца теста (до строки `  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();` включительно) замените на

```ts
  // «Удалить платёж» — вложенное окно «Удалить платёж?»: Esc закрывает только его, фокус — на строке (Review Focus 2)
  await rows(page).first().getByText('новый').click();
  dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  const remove = dialog.getByRole('button', { name: 'Удалить платёж' });
  await remove.click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить платёж?' });
  await expect(confirm.getByRole('button')).toHaveText(['×', 'Отменить', 'Удалить']);
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  // строки, с которой открыли форму, больше нет — фокус на заголовке журнала
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
```

4) Тест «операция на архивном счёте…»: фрагмент

```ts
  const account = dialog.getByRole('combobox', { name: 'Счёт', exact: true });
  await expect(account).toHaveValue('Старый (в архиве)');
  await expect(account).toBeDisabled();
  await expect(dialog.getByLabel('Дата оплаты')).toBeDisabled();
  const remove = dialog.getByRole('button', { name: 'Удалить', exact: true });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription('Удалить нельзя: счёт в архиве («Старый»)');
```

замените на

```ts
  const account = dialog.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(account).toHaveValue('Старый (в архиве)');
  await expect(account).toBeDisabled();
  await expect(dialog.getByLabel('Дата поступления денег')).toBeDisabled();
  // «Удалить платёж» видна и в порядке Tab, но неактивна с причиной; нажатие ничего не делает (Review Focus 3)
  const remove = dialog.getByRole('button', { name: 'Удалить платёж' });
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  await expect(remove).toHaveAccessibleDescription('Удалить нельзя: счёт в архиве («Старый»)');
  await remove.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
```

- [ ] **Step 11: E2E — `dialogs.spec.ts`, `mobile.spec.ts`, `service-screens.spec.ts`**

`e2e/dialogs.spec.ts`:
- в тесте «закрытие формы не прокручивает журнал…» `page.getByRole('dialog', { name: 'Изменить операцию' })` → `page.getByRole('dialog', { name: 'Доход', exact: true })`;
- в тесте «телефон: «×» окна…» `page.getByRole('dialog', { name: 'Новая операция' })` → `page.getByRole('dialog', { name: 'Новый расход' })`;
- в тесте «окно: «×» закрывает форму…»: `const form = page.getByRole('dialog', { name: 'Новая операция' });` → `const form = page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });`; строки

```ts
  // Shift+Tab с первого элемента содержимого — на «×»; ещё раз — по кругу, но внутри окна
  await form.getByRole('radio', { name: 'Доход' }).focus();
```

  → 

```ts
  // Shift+Tab с первого элемента содержимого (поле счёта: вкладок типа нет) — на «×»; ещё раз — по кругу, но внутри окна
  await form.getByRole('combobox', { name: 'На счёт', exact: true }).focus();
```

  `const edit = page.getByRole('dialog', { name: 'Изменить операцию' });` → `const edit = page.getByRole('dialog', { name: 'Доход', exact: true });`; `const phoneForm = page.getByRole('dialog', { name: 'Новая операция' });` → `const phoneForm = page.getByRole('dialog', { name: 'Новый расход' });`; `phoneForm.getByRole('button', { name: /^Проект, теги, комментарий/ })` → `phoneForm.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })`;
- в тесте «вопрос о несохранённом…» `const form = page.getByRole('dialog', { name: 'Новая операция' });` → `const form = page.getByRole('dialog', { name: 'Новый расход' });`;
- в тесте «„Настройки журнала“…» `page.getByRole('dialog', { name: 'Новая операция' })` → `page.getByRole('dialog', { name: 'Новый доход' })`.

`e2e/mobile.spec.ts`:
- `const newForm = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });` → `const newForm = (page: Page) => page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });`
- `await expect(newForm(page).getByRole('radio', { name: 'Перевод' })).toBeChecked();` → `await expect(page.getByRole('dialog', { name: 'Новый перевод', exact: true })).toBeVisible();`
- `await expect(newForm(page).getByRole('radio', { name: 'Расход' })).toBeChecked();` → `await expect(page.getByRole('dialog', { name: 'Новый расход', exact: true })).toBeVisible();`
- в тесте «сценарий 4 §10…» `await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();` → `await dialog.getByRole('button', { name: 'Добавить расход' }).click();`; `const edit = page.getByRole('dialog', { name: 'Изменить операцию' });` → `const edit = page.getByRole('dialog', { name: 'Расход', exact: true });`; `await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();` → `await edit.getByRole('button', { name: 'Сохранить изменения' }).click();`
- в тесте «ширина 390 px…» `newForm(page).getByRole('button', { name: 'Проект, теги, комментарий' })` → `newForm(page).getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })`; `newForm(page).getByRole('combobox', { name: 'Счёт', exact: true })` → `newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })`;
- в тесте «архивная компания…» `const view = page.getByRole('dialog', { name: 'Изменить операцию' });` → `const view = page.getByRole('dialog', { name: 'Расход', exact: true });`; строку `  for (const name of ['Сохранить', 'Сохранить и создать похожий', 'Дублировать', 'Удалить']) {` → `  for (const name of ['Сохранить изменения', 'Добавить и создать похожий', 'Дублировать платёж', 'Удалить платёж']) {`; `await expect(view.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);` → `await expect(view.getByRole('button', { name: 'Сохранить изменения' })).toHaveCount(0);`

`e2e/service-screens.spec.ts`: `const form = page.getByRole('dialog', { name: 'Изменить операцию' });` → `const form = page.getByRole('dialog', { name: 'Доход', exact: true });`

Проверьте, что старых имён не осталось: `grep -rn "Новая операция\|Изменить операцию\|Проект, теги, комментарий'\|'Оставить как есть'" e2e` → пусто.

- [ ] **Step 12: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npx playwright test e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/dialogs.spec.ts --repeat-each=3` → зелёные (кроме известного «нет курса на дату» в повторах). Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/operation-form.ts src/client/components/ui.ts src/client/components/icons.tsx src/client/components/focus-trap.ts src/client/components/useAutoFocus.ts src/client/components/Modal.tsx src/client/components/DateField.tsx src/client/components/operation/ActionRow.tsx src/client/components/operation/OperationForm.tsx src/client/components/operation/AmountField.tsx src/client/components/operation/SplitEditor.tsx tests/client/operation-form.test.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/dialogs.spec.ts e2e/mobile.spec.ts e2e/service-screens.spec.ts
git commit -m "feat: форма операции как в Finmap — окно на тип, одна колонка, строки-действия, «Удалить платёж?» и подтверждения разбиения окном, главная кнопка цвета типа

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Последний выбранный счёт и фокус на первом пустом обязательном поле

**Files:**
- Create: `src/client/lib/last-account.ts`, `tests/client/last-account.test.ts`
- Modify: `src/client/lib/operation-form.ts`, `src/client/components/operation/ComboSelect.tsx`, `src/client/components/operation/OperationForm.tsx`, `tests/client/operation-form.test.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/dialogs.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `useAutoFocus` (задача 1); `useMe()` (`lib/query.ts`, `data.user.id`).
- Produces:
  - `interface LastAccounts { income?: number; expense?: number; transferFrom?: number; transferTo?: number }`, `lastAccountKey(userId: number, companyId: number): string`, `parseLastAccounts(raw: string | null): LastAccounts`, `withSaved(last: LastAccounts, type: OperationType, accountId: number, toAccountId: number | null): LastAccounts`, `defaultAccounts(type: OperationType, last: LastAccounts, accounts: readonly { id: number; archivedAt: string | null }[]): { accountId: number | null; toAccountId: number | null }`, `readLastAccounts(userId, companyId): LastAccounts`, `saveLastAccounts(userId, companyId, last): void` (`lib/last-account.ts`);
  - `emptyDraft(type, today, accountId = null, toAccountId = null)`; `initialFocusField(draft: Pick<OperationDraft, 'type' | 'accountId' | 'toAccountId'>, editing: boolean): 'accountId' | 'toAccountId' | 'amount'` (`lib/operation-form.ts`);
  - `ComboSelect` — новое свойство `autoFocus?: boolean`.

- [ ] **Step 1: Write the failing unit tests**

`tests/client/last-account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultAccounts, lastAccountKey, parseLastAccounts, withSaved } from '../../src/client/lib/last-account';

const ARCH = '2026-10-01T00:00:00.000Z';
const accounts = [
  { id: 1, archivedAt: null },
  { id: 2, archivedAt: null },
  { id: 3, archivedAt: ARCH },
];

describe('последний выбранный счёт (§6.2 этапа 1.5)', () => {
  it('ключ — пользователь и компания', () => {
    expect(lastAccountKey(7, 12)).toBe('fc.lastAccount.7.12');
  });

  it('разбор: только положительные целые id известных полей; повреждённое или чужое — пусто (Review Focus 4)', () => {
    expect(parseLastAccounts(null)).toEqual({});
    expect(parseLastAccounts('не json')).toEqual({});
    expect(parseLastAccounts('[1,2]')).toEqual({});
    expect(parseLastAccounts('{"income":1,"expense":"2","transferFrom":-3,"transferTo":2.5,"x":4}')).toEqual({ income: 1 });
    expect(parseLastAccounts('{"income":1,"expense":2,"transferFrom":1,"transferTo":2}')).toEqual({ income: 1, expense: 2, transferFrom: 1, transferTo: 2 });
  });

  it('запоминание: у дохода и расхода — свой счёт, у перевода — оба', () => {
    expect(withSaved({ income: 1 }, 'expense', 2, null)).toEqual({ income: 1, expense: 2 });
    expect(withSaved({ expense: 2 }, 'transfer', 1, 2)).toEqual({ expense: 2, transferFrom: 1, transferTo: 2 });
  });

  it('подстановка: запомненный счёт, если он есть и не в архиве; иначе пусто, как в Finmap', () => {
    const last = { income: 1, expense: 3, transferFrom: 2, transferTo: 99 };
    expect(defaultAccounts('income', last, accounts)).toEqual({ accountId: 1, toAccountId: null });
    expect(defaultAccounts('expense', last, accounts)).toEqual({ accountId: null, toAccountId: null });
    expect(defaultAccounts('transfer', last, accounts)).toEqual({ accountId: 2, toAccountId: null });
    expect(defaultAccounts('income', {}, accounts)).toEqual({ accountId: null, toAccountId: null });
  });
});
```

В `tests/client/operation-form.test.ts`: в импорт добавьте `initialFocusField`; в конец файла добавьте

```ts
describe('фокус при открытии (§6.2 этапа 1.5)', () => {
  it('первое пустое обязательное поле: счёт (у перевода — «Со счёта», затем «На счёт»), иначе сумма; при правке — сумма', () => {
    expect(initialFocusField(emptyDraft('expense', '2026-10-07'), false)).toBe('accountId');
    expect(initialFocusField(emptyDraft('expense', '2026-10-07', 1), false)).toBe('amount');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', 1), false)).toBe('toAccountId');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', 1, 2), false)).toBe('amount');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', null, 2), false)).toBe('accountId');
    expect(initialFocusField(emptyDraft('income', '2026-10-07'), true)).toBe('amount');
  });
});
```

Run: `npx vitest run tests/client/last-account.test.ts tests/client/operation-form.test.ts` → FAIL.

- [ ] **Step 2: `lib/last-account.ts`, `initialFocusField`, `emptyDraft`**

`src/client/lib/last-account.ts`:

```ts
import type { OperationType } from './journal-filter';

/**
 * Последние выбранные счета (§6.2, §10.2 этапа 1.5): у дохода и расхода — свой, у перевода — оба. Удобство одного
 * устройства — в localStorage, а не в настройках пользователя; запоминается после успешного создания операции.
 */
export interface LastAccounts {
  income?: number;
  expense?: number;
  transferFrom?: number;
  transferTo?: number;
}

const KEYS = ['income', 'expense', 'transferFrom', 'transferTo'] as const;

export const lastAccountKey = (userId: number, companyId: number): string => `fc.lastAccount.${userId}.${companyId}`;

/** Значение из localStorage: только положительные целые id известных полей; повреждённое — пусто. */
export function parseLastAccounts(raw: string | null): LastAccounts {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: LastAccounts = {};
  for (const key of KEYS) {
    const id = (value as Record<string, unknown>)[key];
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) out[key] = id;
  }
  return out;
}

/** Запомнить счета сохранённой операции. */
export function withSaved(last: LastAccounts, type: OperationType, accountId: number, toAccountId: number | null): LastAccounts {
  if (type === 'transfer') return { ...last, transferFrom: accountId, ...(toAccountId !== null ? { transferTo: toAccountId } : {}) };
  return { ...last, [type]: accountId };
}

/** Счета новой операции: запомненные, если они есть и не в архиве; иначе пусто, как в Finmap (02-L9). */
export function defaultAccounts(
  type: OperationType,
  last: LastAccounts,
  accounts: readonly { id: number; archivedAt: string | null }[],
): { accountId: number | null; toAccountId: number | null } {
  const live = (id: number | undefined) => (id !== undefined && accounts.some((a) => a.id === id && !a.archivedAt) ? id : null);
  if (type === 'transfer') return { accountId: live(last.transferFrom), toAccountId: live(last.transferTo) };
  return { accountId: live(last[type]), toAccountId: null };
}

/** Прочитать память; недоступное хранилище (приватный режим) — пусто. */
export function readLastAccounts(userId: number, companyId: number): LastAccounts {
  try {
    return parseLastAccounts(localStorage.getItem(lastAccountKey(userId, companyId)));
  } catch {
    return {};
  }
}

export function saveLastAccounts(userId: number, companyId: number, last: LastAccounts): void {
  try {
    localStorage.setItem(lastAccountKey(userId, companyId), JSON.stringify(last));
  } catch {
    // без памяти поле счёта просто будет пустым
  }
}
```

В `src/client/lib/operation-form.ts`:
1) функцию `emptyDraft` целиком замените на

```ts
export function emptyDraft(type: OperationType, today: string, accountId: number | null = null, toAccountId: number | null = null): OperationDraft {
  return {
    type,
    accountId,
    amount: '',
    toAccountId: type === 'transfer' ? toAccountId : null,
    toAmount: '',
    paidDate: today,
    accrualOn: false,
    accrualDate: today,
    categoryId: null,
    projectId: null,
    counterpartyId: null,
    tagIds: [],
    comment: '',
    split: null,
  };
}
```

2) в конец файла добавьте

```ts
/**
 * Поле для фокуса при открытии формы (§6.2 этапа 1.5): у новой операции — первое пустое обязательное поле: счёт
 * (у перевода «Со счёта», затем «На счёт»), иначе сумма; при правке — сумма.
 */
export function initialFocusField(draft: Pick<OperationDraft, 'type' | 'accountId' | 'toAccountId'>, editing: boolean): 'accountId' | 'toAccountId' | 'amount' {
  if (editing) return 'amount';
  if (draft.accountId === null) return 'accountId';
  if (draft.type === 'transfer' && draft.toAccountId === null) return 'toAccountId';
  return 'amount';
}
```

Run: `npx vitest run tests/client/last-account.test.ts tests/client/operation-form.test.ts` → PASS.

- [ ] **Step 3: `ComboSelect.autoFocus`**

В `src/client/components/operation/ComboSelect.tsx`:
1) после строки `import { Field } from '../Field';` вставьте `import { useAutoFocus } from '../useAutoFocus';`;
2) в тип свойств после `  className?: string;` вставьте `  /** Фокус в поле при появлении, если он «ничей» (§6.2 этапа 1.5: пустой счёт при открытии формы). */` и `  autoFocus?: boolean;`;
3) после вызова `useComboList(…)` вставьте строку `  useAutoFocus(combo.inputProps.ref, props.autoFocus);`.

- [ ] **Step 4: `OperationForm.tsx` — remembered account and initial focus**

1) Строку `import { useMeta } from '../../lib/query';` замените на `import { useMe, useMeta } from '../../lib/query';`; после строки импорта `'../../lib/journal-mutations'` вставьте `import { defaultAccounts, readLastAccounts, saveLastAccounts, withSaved } from '../../lib/last-account';`; в импорт из `'../../lib/operation-form'` добавьте `initialFocusField`.

2) Строки

```ts
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() => (op ? draftFromOperation(op, accounts, p.timeZone) : emptyDraft(p.type, today, firstAccount)));
  const [draft, setDraft] = useState(initial);
```

замените на

```ts
  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  // последний счёт этого пользователя в этой компании для этого типа (§6.2 этапа 1.5); не выбирался или в архиве — пусто
  const userId = useMe().data?.user.id ?? null;
  const [remembered] = useState(() => defaultAccounts(p.type, userId === null ? {} : readLastAccounts(userId, p.company.id), p.data.accounts));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() =>
    op ? draftFromOperation(op, accounts, p.timeZone) : emptyDraft(p.type, today, remembered.accountId, remembered.toAccountId),
  );
  const [draft, setDraft] = useState(initial);
  /** Фокус при открытии — первое пустое обязательное поле (§6.2): счёт, иначе сумма; при правке — сумма. */
  const [focusField] = useState(() => initialFocusField(initial, p.operation !== null));
```

3) В `submit` после строки

```ts
        const created = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body })).operation;
```

вставьте

```ts
        // запомнить счета новой операции (решение 6 плана 1.5-3b): в следующий раз они подставятся сами
        if (userId !== null) saveLastAccounts(userId, p.company.id, withSaved(readLastAccounts(userId, p.company.id), r.body.type, r.body.accountId, r.body.toAccountId));
```

4) В `duplicate` строку `    setInitial(emptyDraft(copy.type, today, firstAccount));` замените на `    setInitial(emptyDraft(copy.type, today, remembered.accountId, remembered.toAccountId));`.

5) В `accountField` у `<ComboSelect` после строки `      hint={lockHint}` вставьте `      autoFocus={focusField === key}`.

6) В `amountField` строку `      autoFocus` замените на `      autoFocus={focusField === 'amount'}`.

Run: `npm run typecheck` → без ошибок; `grep -n "firstAccount" src/client/components/operation/OperationForm.tsx` → пусто.

- [ ] **Step 5: E2E — the account is empty on the first opening of each type**

У каждого e2e-теста свой браузерный контекст: при первом открытии формы каждого типа счёт пуст, фокус — на нём. Правки:

`e2e/operation-form.spec.ts`:
- тест «доход, расход и перевод…»: строку `  await expect(amount).toBeFocused();` (сразу после `const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });`) замените на

```ts
  // счёт ещё не выбирался — поле пустое, фокус на нём (§6.2)
  await expect(field(dialog, 'На счёт')).toHaveValue('');
  await expect(field(dialog, 'На счёт')).toBeFocused();
```

  в части расхода после строки `  dialog = await openForm(page, 'Расход');` вставьте `  await pick(page, 'Со счёта', 'Касса');`;
- тест «ошибки у полей…»: после строки `  const dialog = await openForm(page, 'Расход');` вставьте `  await pick(page, 'Со счёта', 'Касса');`;
- тест «„Разделить“ в процентах…»: после первой строки `  let dialog = await openForm(page, 'Расход');` вставьте `  await pick(page, 'Со счёта', 'Касса');` (второе открытие расхода в этом тесте — уже с запомненной «Кассой»);
- тест «сценарий 3 §10…»: строки

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
```

  → 

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(field(dialog, 'На счёт')).toBeFocused();
```

  строки

```ts
  dialog = await openForm(page, 'Расход');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
```

  → 

```ts
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
  await pick(page, 'Со счёта', 'Касса');
```

  строки

```ts
  dialog = await openForm(page, 'Перевод');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
```

  → (дата у перевода первой, но фокус — на пустом «Со счёта»)

```ts
  dialog = await openForm(page, 'Перевод');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
```

- тест «„+ Создать „…“» прямо из формы…»: после строки `  const dialog = await openForm(page, 'Расход');` вставьте `  await pick(page, 'Со счёта', 'Касса');`;
- тест «нет курса на дату…»: после строки `  const dialog = await openForm(page, 'Расход');` вставьте `  await pick(page, 'Со счёта', 'Франки');`.
- в конец файла добавьте тест:

```ts
test('последний счёт и фокус при открытии: пустой счёт — фокус на нём; после сохранения счёт запомнен для типа; архивный — пусто', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Последний счёт ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await page.reload();

  // счёт не выбирался — поле пустое, как в Finmap, и фокус на нём
  let dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
  await pick(page, 'Со счёта', 'Kaspi');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // тот же тип — запомненный счёт; данные в кэше, окно сфокусировало счёт, а фокус всё равно в сумме (Review Focus 1)
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('Kaspi');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // у дохода — свой счёт, он ещё не выбирался
  dialog = await openForm(page, 'Доход');
  await expect(field(dialog, 'На счёт')).toHaveValue('');
  await expect(field(dialog, 'На счёт')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // запомненный счёт ушёл в архив — поле снова пустое (Review Focus 4)
  await apiPost(page, `${base}/accounts/${kaspi}/archive`, {});
  await page.reload();
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
});
```

`e2e/operation-edit.spec.ts`:
- тест «фокус и закрытие формы…»: строки

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.fill('100');
```

  → 

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  const account = dialog.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(account).toBeFocused();
  await account.click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await amount.fill('100');
```

- тест «файлы: выбранный до сохранения…»: после строки `  let dialog = page.getByRole('dialog', { name: 'Новый расход' });` вставьте

```ts
  await dialog.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
```

- тест «файл, который сервер не принял…»: после строки `  const dialog = page.getByRole('dialog', { name: 'Новый доход' });` вставьте

```ts
  await dialog.getByRole('combobox', { name: 'На счёт', exact: true }).click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
```

`e2e/dialogs.spec.ts`, тест «окно: «×» закрывает форму…»:
- строку `  await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();` (первую, после `const close = …`) замените на `  await expect(form.getByRole('combobox', { name: 'На счёт', exact: true })).toBeFocused();`;
- цикл повторного открытия

```ts
  // повторное открытие в той же странице: данные в кэше, содержимое монтируется вместе с окном — фокус снова в сумме
  for (const label of ['Расход', 'Доход', 'Перевод'] as const) {
    await page.getByRole('banner').getByRole('button', { name: label, exact: true }).click();
    await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
  }
```

  замените на

```ts
  // повторное открытие в той же странице: данные в кэше, содержимое монтируется вместе с окном — фокус снова
  // на первом пустом обязательном поле (счёт не выбирался); с запомненным счётом — в сумме (operation-form.spec.ts)
  for (const [label, account] of [['Расход', 'Со счёта'], ['Доход', 'На счёт'], ['Перевод', 'Со счёта']] as const) {
    await page.getByRole('banner').getByRole('button', { name: label, exact: true }).click();
    await expect(form.getByRole('combobox', { name: account, exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
  }
```

  (правка операции дальше в тесте — фокус по-прежнему в сумме);
- тест «вопрос о несохранённом…»: строки

```ts
    await expense.click();
    await expect(amount).toBeFocused();
    await amount.fill('250');
```

  → 

```ts
    await expense.click();
    await expect(form.getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();
    await amount.fill('250');
```

`e2e/mobile.spec.ts`:
- тест «нижняя панель…»: `  await expect(newForm(page).getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();` → `  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();`
- тест «сценарий 4 §10…»: строку `  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();` (на компьютере, перед проверкой ряда операторов) → `  await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();`; строки

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
```

  → 

```ts
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  const account = dialog.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(account).toBeFocused();
  await account.click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
```

- тест «ширина 390 px…»: строки

```ts
  // счёт по умолчанию — «Касса_без_пробелов_…»: поле со списком не растягивает форму
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue(/^Касса_без_пробелов/);
```

  → 

```ts
  // длинное название счёта «Касса_без_пробелов_…»: поле со списком не растягивает форму
  await newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await newForm(page).getByRole('option', { name: /^Касса_без_пробелов/ }).click();
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue(/^Касса_без_пробелов/);
```

  выбранный счёт делает форму изменённой, поэтому ниже в этом тесте строки

```ts
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
```

  (сразу после проверки положения «×») замените на

```ts
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Закрыть' }).click();
  await expect(newForm(page)).toBeHidden();
```

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/last-account.ts tests/client/last-account.test.ts src/client/lib/operation-form.ts src/client/components/operation/ComboSelect.tsx src/client/components/operation/OperationForm.tsx tests/client/operation-form.test.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/dialogs.spec.ts e2e/mobile.spec.ts
git commit -m "feat: последний выбранный счёт по типу и фокус на первом пустом обязательном поле формы

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Теги — поле с плашками; перетаскивание файлов

**Files:**
- Modify: `src/client/components/operation/OperationForm.tsx` (`TagsField`), `src/client/components/operation/AttachmentsField.tsx`, `src/client/lib/attachments.ts`, `tests/client/attachments.test.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes: `useComboList` (план 1.5-3a), `Field` с `floating`/`filled`/`boxRef`, `tagOptions`.
- Produces: `isFileDrag(types: readonly string[]): boolean` (`lib/attachments.ts`); `TagsField` — поле `combobox` «Теги», плашки с кнопками «Убрать тег «…»»; зона перетаскивания `[data-drop-zone]` в `AttachmentsField`.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/attachments.test.ts` добавьте в импорт из `'../../src/client/lib/attachments'` имя `isFileDrag` и в конец файла:

```ts
describe('перетаскивание в зону файлов (§6.7 этапа 1.5)', () => {
  it('принимаются только файлы: текст и ссылки не перетаскиваются (Review Focus 5)', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag(['text/uri-list', 'text/html'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });
});
```

(если в файле нет `describe`/`it`/`expect` в импорте из `vitest` — они уже есть: файл — набор unit-тестов вложений.)

Run: `npx vitest run tests/client/attachments.test.ts` → FAIL (`isFileDrag` не экспортируется).

- [ ] **Step 2: `isFileDrag` and the drop zone**

В конец `src/client/lib/attachments.ts` добавьте:

```ts
/** Перетаскивают файлы (а не текст или ссылку): только их принимает зона «Перетяните сюда файл» (§6.7 этапа 1.5). */
export function isFileDrag(types: readonly string[]): boolean {
  return types.includes('Files');
}
```

В `src/client/components/operation/AttachmentsField.tsx`:
1) в импорт из `'../../lib/attachments'` добавьте `isFileDrag`;
2) после строки `  const [removing, setRemoving] = useState(false);` вставьте `  /** Над зоной тащат файлы — подсветка. */` и `  const [dragging, setDragging] = useState(false);`;
3) блок выбора файла

```tsx
      {/* поле выбора скрыто, видна подпись-кнопка; фокус с клавиатуры подсвечивает подпись */}
      {!props.readOnly && (
      <>
      <input
        id={inputId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        ref={inputRef}
        aria-label="Добавить файл"
        aria-describedby={hintId}
        disabled={uploading}
        onChange={(e) => {
          void choose(e.target.files);
          e.target.value = '';
        }}
        className="peer sr-only"
      />
      <label htmlFor={inputId} className="inline-block cursor-pointer rounded-lg bg-field px-3 py-1.5 text-sm font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-focus">
        {uploading ? 'Загрузка…' : '+ Файл'}
      </label>
      <span id={hintId} className="ml-2 text-xs text-muted">PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV до 10 МБ</span>
      </>
      )}
```

замените на

```tsx
      {/* зона файлов (§6.7 этапа 1.5): перетаскивание или «выберите файл»; поле выбора скрыто, фокус с клавиатуры на нём подсвечивает всю зону */}
      {!props.readOnly && (
        <div
          data-drop-zone=""
          onDragOver={(e) => {
            if (uploading || !isFileDrag([...e.dataTransfer.types])) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            setDragging(false);
            if (uploading || !isFileDrag([...e.dataTransfer.types])) return;
            e.preventDefault();
            void choose(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus ${dragging ? 'border-income bg-income-soft' : 'border-field'}`}
        >
          <input
            id={inputId}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            ref={inputRef}
            aria-label="Добавить файл"
            aria-describedby={hintId}
            disabled={uploading}
            onChange={(e) => {
              void choose(e.target.files);
              e.target.value = '';
            }}
            className="peer sr-only"
          />
          {uploading ? (
            <span>Загрузка…</span>
          ) : (
            <span>
              Перетяните сюда файл (до 10 МБ) или{' '}
              <label htmlFor={inputId} className="cursor-pointer font-semibold text-income-strong underline">
                выберите файл
              </label>
            </span>
          )}
          <span id={hintId} className="mt-1 block text-xs text-muted">
            PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV
          </span>
        </div>
      )}
```

(класс `peer` у скрытого поля больше не нужен, но и не мешает; подсветка фокуса — у всей зоны через `has-[input:focus-visible]`.)

Run: `npx vitest run tests/client/attachments.test.ts` → PASS.

- [ ] **Step 3: `TagsField` on `useComboList`**

В `src/client/components/operation/OperationForm.tsx`:
1) после строки `import { ConfirmDialog } from '../ConfirmDialog';` вставьте `import { useComboList } from '../ComboList';`; строку `import { SearchPicker } from '../SearchPicker';` удалите; из импорта `'../ui'` уберите `btnSmall`;
2) функцию `TagsField` целиком замените на

```tsx
/**
 * Теги (§6.7 строка 3 этапа 1.5): поле-мультивыбор — выбранные плашками внутри поля с плавающей подписью «Теги»,
 * печать ищет и добавляет («+ Создать „…“» — новый тег). Выбор пункта добавляет тег и закрывает список; Backspace
 * в пустом поле убирает последний тег; «×» на плашке убирает её тег.
 */
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; onCreate: (name: string) => void; error?: string }) {
  const names = new Map(props.tags.map((t) => [t.id, t.name]));
  const options = tagOptions(props.tags, props.value).filter((o) => !props.value.includes(o.id));
  const combo = useComboList({
    listLabel: 'Теги',
    options,
    selectedId: null,
    text: '',
    onPick: (id) => props.onChange([...props.value, id]),
    onCreate: props.onCreate,
    createNoun: 'тег',
  });
  const { onKeyDown, ...inputProps } = combo.inputProps;
  return (
    <Field label="Теги" error={props.error} floating filled={props.value.length > 0 || combo.open} boxRef={combo.anchorRef}>
      {(control) => (
        <div className="flex min-h-14 flex-wrap items-center gap-1.5 rounded-xl bg-field px-4 pt-6 pb-2 focus-within:ring-2 focus-within:ring-focus">
          {props.value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-sm">
              {names.get(id) ?? '…'}
              <button
                type="button"
                aria-label={`Убрать тег «${names.get(id) ?? ''}»`}
                onClick={() => props.onChange(props.value.filter((x) => x !== id))}
                className="text-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
          <input
            {...control}
            {...inputProps}
            onKeyDown={(e) => {
              // Backspace в пустом поле убирает последний тег
              if (e.key === 'Backspace' && e.currentTarget.value === '' && props.value.length > 0) props.onChange(props.value.slice(0, -1));
              onKeyDown(e);
            }}
            className="min-w-24 flex-1 bg-transparent py-1 text-base outline-none"
          />
          {combo.list}
        </div>
      )}
    </Field>
  );
}
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 4: E2E**

`e2e/operation-form.spec.ts`, тест «„+ Создать „…“» прямо из формы…» — фрагмент

```ts
  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('нал');
  await dialog.getByRole('option', { name: '+ Создать „нал“' }).click();
  await expect(dialog.getByRole('group', { name: 'Теги' })).toContainText('нал');
  // архивный тег не предлагается, а создать такой же нельзя — сообщение сервера
  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('старый');
  await dialog.getByRole('option', { name: '+ Создать „старый“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «старый»');
```

замените на

```ts
  // теги — поле с плашками внутри (§6.7): печать ищет, «+ Создать „…“» создаёт и добавляет плашку
  const tags = field(dialog, 'Теги');
  await tags.fill('нал');
  await dialog.getByRole('option', { name: '+ Создать „нал“' }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toBeVisible();
  await expect(tags).toBeFocused();
  // Backspace в пустом поле убирает последнюю плашку; выбор из списка возвращает её
  await tags.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toHaveCount(0);
  await tags.click();
  await dialog.getByRole('option', { name: 'нал', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toBeVisible();
  // архивный тег не предлагается, а создать такой же нельзя — сообщение сервера
  await tags.fill('старый');
  await dialog.getByRole('option', { name: '+ Создать „старый“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «старый»');
```

`e2e/operation-edit.spec.ts`, тест «файлы: выбранный до сохранения…»: после строк

```ts
  await expect(files).toContainText('чек.png');
  await expect(files).toContainText('загрузится после сохранения');
```

вставьте

```ts
  // перетаскивание в зону «Перетяните сюда файл (до 10 МБ) или выберите файл» (§6.7): файл ждёт сохранения
  const zone = dialog.locator('[data-drop-zone]');
  await expect(zone).toContainText('Перетяните сюда файл (до 10 МБ) или выберите файл');
  const dropped = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['a;b\n1;2\n'], 'перетащен.csv', { type: 'text/csv' }));
    return dt;
  });
  await zone.dispatchEvent('dragover', { dataTransfer: dropped });
  await zone.dispatchEvent('drop', { dataTransfer: dropped });
  await expect(files).toContainText('перетащен.csv');
  // перетаскивание текста — не файл: ничего не добавляется (Review Focus 5)
  const text = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'просто текст');
    return dt;
  });
  await zone.dispatchEvent('drop', { dataTransfer: text });
  await expect(files.getByText('просто текст')).toHaveCount(0);
```

и после строки `  await expect(link).toBeVisible();` (правка, файл «чек.png» в списке) вставьте

```ts
  // перетащенный до сохранения файл тоже загрузился
  await expect(dialog.getByRole('link', { name: 'перетащен.csv' })).toBeVisible();
```

(в тесте ниже есть проверки удаления «чек.png» и фокуса на «×» соседней строки — соседом теперь может быть «перетащен.csv» или «выписка.csv»: строку `  await expect(dialog.getByRole('button', { name: 'Удалить файл «выписка.csv»' })).toBeFocused();` замените на `  await expect(dialog.getByRole('button', { name: /^Удалить файл «(перетащен|выписка)\.csv»$/ })).toBeFocused();`.)

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/operation/OperationForm.tsx src/client/components/operation/AttachmentsField.tsx src/client/lib/attachments.ts tests/client/attachments.test.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts
git commit -m "feat: теги — поле с плашками и поиском; перетаскивание файлов в форму операции

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Визуальная сверка формы; итоговый прогон `npm run shots:ux`

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: окна по типу и строки-действия (задача 1), пустой счёт по умолчанию (задача 2), теги и зона файлов (задача 3).
- Produces: снимки экранов формы `c05`–`c11`, `c14`–`c16`, `cm04`, `cm05`; итог сверки в отчёте задачи.

- [ ] **Step 1: Update the scenarios**

В `scripts/ux-shots.ts`:
1) `const newForm = (p: Page) => p.getByRole('dialog', { name: 'Новая операция' });` → `const newForm = (p: Page) => p.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });`
2) в сценарии `c05-op-edit.png` и `cm04-op-open.png`: `p.getByRole('dialog', { name: 'Изменить операцию' })` → `p.getByRole('dialog', { name: /^(Доход|Расход|Перевод)$/ })`;
3) в `c07-income-expanded.png` и `c11-income-project-dd.png`: `newForm(p).getByRole('button', { name: /^Проект, теги, комментарий/ })` → `newForm(p).getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })`;
4) `formList('Счёт')` → `formList('На счёт')`.

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 38 из 38.` Упавший сценарий — исправьте локатор сценария и запустите ещё раз.

- [ ] **Step 3: Compare the form screens and write the result into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `05-op-edit` ↔ `c05-op-edit`, `06-income` ↔ `c06-income`, `07-income-expanded` ↔ `c07-income-expanded`, `08-income-account-dd` ↔ `c08-…`, `09-income-category-dd` ↔ `c09-…`, `10-income-counterparty-dd` ↔ `c10-…`, `11-income-project-dd` ↔ `c11-…`, `14-after-escape` ↔ `c14-after-escape`, `15-expense` ↔ `c15-expense`, `16-transfer` ↔ `c16-transfer`, телефон `m04-op-open` ↔ `cm04-op-open`, `m05-income` ↔ `cm05-income`. `12-income-datepicker` и `13c-calculator` — план 1.5-3c.

В отчёт задачи (не в файл) — таблица «экран — совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** заголовки по типу, окно 480 px в одну колонку, порядок полей (у перевода дата первой), «Сумма» с «Валютой» в строке, подписи внутри полей, строки-действия и их порядок, широкая кнопка цвета типа и «+ Добавить и создать похожий», пустой счёт в новой форме, «Сохранить изменения» в правке;
- **отличаются намеренно:** «Разделить платёж» и в новой форме; «Сумма зачисления» и курс у перевода между валютами; нет «Сделать повторяющимся» (этап 3); нет «Изменить в перевод» до плана 1.5-6; «Валюта» не выбирается (§1); кнопки без градиента;
- **отличаются, исправит план 1.5-3c:** дата без времени и браузерный календарь (`DateTimeField`), нет калькулятора в поле суммы, нет строки «Зарплата за {месяц}» (на `05`).

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — окна формы операции по типу

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-11-stage1_5-plan3b-followups.md` (пишет контролёр).
- Закрыты отложенные замечания: 1a №2 (строка «Удалить операцию?» — теперь `ConfirmDialog`), 6a №2 (Esc в подтверждении разбиения открывал вопрос формы), 6b №3 («Не удалять» доступна во время запроса — в `ConfirmDialog` обе кнопки недоступны).
- Следующий план — [1.5-3c](2026-10-11-stage1_5-plan3c-datetime-calculator.md): `DateTimeField` вместо `paidDateField`, правила времени, «Зарплата за {месяц}» вместо строки «Дата сделки» у зарплаты, калькулятор.
- Замечания для итогов (followups):
  - память последнего счёта — на устройстве (`localStorage`): на другом компьютере счёт снова пуст (§10.2, так задумано);
  - `SearchPicker` с отдельным полем поиска остался у «Применить шаблон» в разбиении.
