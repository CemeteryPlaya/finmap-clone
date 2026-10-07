# Этап 1, план 6a: форма операции — создание (доход, расход, перевод), калькулятор суммы, «Разделить» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина шага 6 §11 спецификации — форма новой операции (§7 «Форма операции») и кнопки шапки «+ Доход», «− Расход», «⇄ Перевод» (§7 «Каркас»):
- форма — модальное окно, на телефоне (меньше 768 px) — на весь экран;
- доход и расход: счёт, сумма, статья, контрагент (для статьи с эффективным `systemKey` сначала подходящий тип), дата оплаты (по умолчанию сегодня, будущий день нельзя), «Дата сделки отличается», свёрнутый блок «Проект, теги, комментарий»;
- перевод: дата, со счёта, на счёт, сумма; при разных валютах — «Сумма зачисления» и вычисленный курс;
- поле суммы с выражениями (`+ − × /`, скобки) на `bigint`-модуле `src/shared/decimal.ts`, запятая и точка, на телефоне — ряд кнопок `+ − × ÷`;
- «Разделить»: строки «статья, проект, сумма или %», остаток, сохранение только при остатке 0, шаблоны разделения (применить с отбрасыванием недоступного — инвариант 10, сохранить текущее);
- выпадающие списки с поиском (правило `ulower` на клиенте), без архивных элементов, «+ Создать „…“» для контрагента, статьи, проекта и тега;
- «Сохранить» и «Сохранить и создать похожий», Enter сохраняет, Esc закрывает (с вопросом при несохранённых изменениях);
- после сохранения — сброс журнала, счетов и компаний (`invalidateOperations`).

Правка существующей операции (клик по строке журнала, конфликт версии, «Удалить», «Дублировать», блокировки архивного счёта), «Указать курс на {D}» при `RATE_UNAVAILABLE` и файлы — план 6b. Мобильная вёрстка остальных экранов — шаг 7.

**Предусловие:** выполнены планы 5a, 5b и 5c (5c — в редакции, переписанной от фактического кода 5b) с решениями по их выполнению: экран журнала (`JournalPage`, `JournalTable` со свойством `onOpenOperation`), `Popover` (портал в `body`, Tab: Shift+Tab с первого элемента — на кнопку, Tab с последнего — закрыть, закрытие при уходе фокуса), `Modal` (`<dialog>` + `showModal()`), `SearchPicker` с внутренней функцией `PickerList`, `invalidateOperations(cid)` в `src/client/lib/journal-mutations.ts`, склейка страниц журнала без повторов по id.

**Architecture:**
- **Чистая логика — отдельно от компонентов, с unit-тестами:** калькулятор `src/shared/calc.ts` (рекурсивный спуск, `Dec` из `decimal.ts`), черновик формы и тело запроса `src/client/lib/operation-form.ts` (поля — текстом, как их видит пользователь; `buildBody` проверяет и переводит в API плана 4a), варианты списков `operation-options.ts`, разбиение и шаблоны `split.ts`, создание справочников из формы `operation-create.ts`.
- **Одна форма на страницу компании.** `OperationFormHost` в `CompanyLayout` держит открытую форму и даёт `useOpenOperationForm()` — его вызывают кнопки шапки (`NewOperationButtons`), а в плане 6b — журнал. Каждое открытие — новая форма (`key`), закрытие идёт через `<dialog>.close()`, поэтому фокус возвращается на кнопку, с которой форму открыли.
- **Esc решает форма.** `Modal` получает необязательный `onCancel`: окно не закрывается по Esc само, форма спрашивает про несохранённые изменения. Esc внутри выпадающего списка закрывает только список (панель `Popover` отменяет событие).
- **Выпадающие списки внутри модального окна.** Всё вне открытого `<dialog>` браузер делает недоступным, поэтому `Popover` рисует панель порталом в само окно (`closest('dialog')`), а не в `body`; `position: fixed` и расчёт места не меняются. `ComboSelect` — поле формы (подпись, ошибка) с кнопкой «Подпись: значение» и `PickerList` в панели; у `PickerList` появляются заголовки групп и пункт «+ Создать „…“».
- **Enter сохраняет** — обычной отправкой `<form>` (кнопка «Сохранить» — `type="submit"`): в `<textarea>` Enter переносит строку, в поле поиска списка Enter выбирает пункт (поле поиска — в панели вне `<form>`).

**Tech Stack:** как в планах 1–5c: React 19, react-router 8, TanStack Query 5, Tailwind 4, zod 4, Vitest, Playwright. Новых пакетов нет: `big.js` заменён `src/shared/decimal.ts` (решение §4.3), React Hook Form не установлен — формы на `useState`.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §2 (APP_TIMEZONE), §4.1 (half-up, наибольший остаток), §4.3 (решение 2026-10-06: `decimal.ts` вместо `big.js`), §4.4 (системные статьи и тип контрагента, `split_presets`), §4.5, §4.6 (инварианты 1, 3, 6, 7, 10), §6.1 (поиск без учёта регистра и «ё»), §7 (Каркас: кнопки шапки; Форма операции; решения 2026-10-07), §10 (unit: калькулятор; E2E: сценарий 4), §11 шаг 6.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§7, блок «Решения планирования от 2026-10-07 (планы 6a и 6b)») тем же коммитом, что и план.

1. **Калькулятор:** операторы `+`, `-` и `−`, `*` и `×`, `/`, `÷` и `:`, скобки, унарные плюс и минус; разделитель — запятая или точка; любые пробелы (в том числе неразрывные) не учитываются. Умножение и деление округляются half-up на 20-м знаке (`Dec`, как курсы), результат — half-up до минимальных единиц валюты счёта. Ошибки: «Введите сумму», «Не удалось вычислить — проверьте выражение», «Деление на ноль», «Слишком большая сумма». Выражение вычисляется при уходе из поля и при сохранении; «сумма больше нуля» проверяет форма.
2. **Дата оплаты — календарная дата.** Новая операция за сегодня — момент «сейчас»; за прошлый день — тот же час и минута суток (по APP_TIMEZONE), что сейчас. Будущий день выбрать нельзя (`max`, проверка формы, инвариант 6 на сервере).
3. **Форма — одна на страницу компании**, кнопки «Доход», «Расход», «Перевод» (с символами `+`, `−`, `⇄`) есть в шапке на любой странице компании, в том числе в настройках. Заголовок окна — «Новая операция»; тип переключается внутри формы. Счёт по умолчанию — первый неархивный; в компании без счетов форма предлагает «Добавить счёт».
4. **Смена типа** сбрасывает статью и разбиение; у перевода нет контрагента и даты сделки (переключатель есть только у дохода и расхода).
5. **«Сохранить и создать похожий»** оставляет форму открытой: сумма, комментарий, файлы и суммы строк разбиения очищаются (доли в процентах остаются), фокус — в поле суммы, над кнопками — «Операция сохранена — можно ввести похожую».
6. **Esc:** без изменений — закрыть; с изменениями — вопрос «Есть несохранённые изменения. Закрыть без сохранения?» с фокусом на «Продолжить»; второй Esc — продолжить ввод. «Отмена» делает то же, что Esc.
7. **«Разделить»:** режимы «Суммами» и «В процентах» (смена режима очищает значения строк). В процентах суммы строк считаются методом наибольшего остатка (`allocate`); строка, которой досталось 0, — ошибка «Слишком маленькая доля для этой суммы». Индикатор — «Не распределено: …», «Распределено больше суммы на …», «Распределено полностью». «Отменить разбиение» возвращает статью и проект первой строки. Не больше 50 строк.
8. **Шаблон разделения (инвариант 10):** удалённые и архивные статьи и проекты и статьи другого вида, чем операция, отбрасываются, их число видно в предупреждении («1 элемент недоступен (удалены, в архиве или другого вида) — не применены»). Строка без статьи и проекта не применяется, её доля остаётся нераспределённой — пользователь распределяет её сам. Не осталось строк — шаблон не применяется. «Сохранить как шаблон» из сумм переводит их в доли методом наибольшего остатка (ровно 100 %).
9. **«+ Создать „…“»** — пункт в конце списка, если такого названия (без учёта регистра и «ё») ещё нет. Статья создаётся верхнего уровня вида операции, проект — по шаблону «Общий», контрагент — подходящего статье типа (по эффективному `systemKey`), иначе «Клиент» у дохода и «Поставщик» у расхода. Ошибка сервера (например, тег с таким именем в архиве) — над кнопками: «Не удалось создать «…»: …».
10. **Списки:** счёт — «Касса (KZT)»; статьи — «Родитель → Дочерняя»; у статьи с эффективным `systemKey` контрагенты подходящего типа идут первыми под заголовком типа («Сотрудники»), остальные — под «Остальные». Уже выбранный архивный элемент остаётся в списке с пометкой «(в архиве)».

## Global Constraints

- **Форма операции (§7):** «модалка; на телефоне на весь экран». Доход и расход: «счёт, сумма в валюте счёта, категория, контрагент, дата оплаты (по умолчанию «сейчас»; выбрать будущий день нельзя), переключатель «Дата сделки отличается» (`accrualDate`, любая дата), свёрнутый блок «Проект, теги, комментарий, файл»». Перевод: «дата, со счёта, на счёт, сумма. Если валюты разные, появляются поле «Сумма зачисления» и вычисленный курс».
- **Поле суммы (§7):** «принимает арифметические выражения (`+ − × /`, скобки) и вычисляет их при потере фокуса»; «результат округляется half-up до минимальной единицы валюты»; «понимает и запятую, и точку как десятичный разделитель, пробелы игнорирует»; «на телефоне (`inputmode="decimal"`) под полем выводится ряд кнопок `+ − × ÷`». Вычисления — `src/shared/decimal.ts` (решение §4.3 вместо `big.js`), без чисел с плавающей точкой.
- **«Разделить» (§7):** «режим строк «категория, проект, сумма или %». Индикатор показывает нераспределённый остаток; сохранить можно, только когда остаток равен 0. Проценты переводятся в суммы методом наибольшего остатка. Можно применить сохранённый шаблон разделения или сохранить текущее разбиение как шаблон.» Инвариант 10: недоступные элементы шаблона отбрасываются с предупреждением; пресет без строк не применяется.
- **Списки (§7):** «с поиском (тем же `ulower`-правилом на клиенте). Архивные элементы не предлагаются. Пункт «+ Создать „…“» создаёт контрагента, категорию, проект или тег прямо из формы. Для категории с эффективным `systemKey` список контрагентов сначала предлагает подходящий тип.» Поиск — `matchesQuery`/`foldCase` из `src/shared/search.ts`.
- **Кнопки и клавиши (§7):** «Сохранить» и «Сохранить и создать похожий» (форма остаётся с теми же значениями, кроме суммы, комментария и файлов); Enter сохраняет (вне многострочного поля), Esc закрывает, при несохранённых изменениях — подтверждение. Ошибки — у полей.
- **API операций (план 4a):** `POST /api/v1/companies/:cid/operations` — `{ type, paidAt, accrualDate, accountId, amount, toAccountId, toAmount, counterpartyId, comment, lines: [{ categoryId, projectId, amount }], tagIds }` → 201 `{ operation }`. Суммы — целые минимальные единицы, больше 0. У дохода и расхода не меньше одной строки, сумма строк равна сумме операции (инвариант 1); у перевода 0 строк или одна с проектом без статьи; при одной валюте `toAmount` равен `amount` (сервер ставит его сам, если не передан). Ошибки — `{ error: { code, message, fields? } }`.
- **Сброс кэшей:** после записи операции — `invalidateOperations(cid)`: `['journal', cid]`, `['accounts', cid]` (балансы, `hasOperations`), `['companies']` (`currencyLocked`, итоги в переключателе).
- **Доступность:** поле — `Field` (подпись, подсказка, ошибка через `aria-describedby`, `aria-invalid`); список — `role="combobox"` + `listbox`/`option` с `aria-activedescendant`; модальное окно — `<dialog>` через `showModal()`; ошибки — `role="alert"`, сообщения — `role="status"`.
- **Без новых npm-пакетов.**
- **E2E:** левая панель `<nav aria-label="Счета">` есть на каждой странице компании — кнопки шапки ищите в `getByRole('banner')`, поля — внутри окна `getByRole('dialog', { name: 'Новая операция' })`; `name:` в Playwright — подстрока без учёта регистра (`'Сохранить'` найдёт и «Сохранить и создать похожий», `'Разделить'` — `exact: true`); панели списков рисуются внутри окна — пункты ищите в окне; данные — через `page.request` с `origin` и `x-requested-with: fetch`; без фиксированных пауз.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\uXXXX`. Инструмент записи файлов может превратить `\u2212` в сам символ: после записи файлов с такими строками выполните проверку из шага задачи — она падает, если в файле оказался символ вместо экранирования.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck` (для задач 4–6 ещё `npm run test:e2e`); коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Сумма, вставленная из банковского приложения или набранная по-разному:** «1 500,50» с неразрывным или узким неразрывным пробелом, «1500.5», «,5», «7.» — верная сумма; «5/0» и «5/(2-2)» — «Деление на ноль», а не бесконечность и не 0; «1/3*3» — 1,00, а не 0,99. Тест — задача 1.
2. **Операция задним числом:** дата прошлого дня — тот же день в APP_TIMEZONE, не соседний (до 01.03.2024 Алматы — UTC+6); правка даты не делает момент будущим. Тест — задача 2 (`paidAtFor`).
3. **Проценты, которые не делятся нацело:** 33,33 + 33,33 + 33,34 % от 1,00 ₸ дают 0,33 + 0,33 + 0,34; сумма строк всегда равна сумме операции; доля, которой достался 0, — ошибка, а не строка с нулём (сервер её отклонил бы). Тест — задача 5 (`splitResult`).
4. **Esc не теряет набранное:** Esc в выпадающем списке закрывает только список; с изменениями — вопрос, второй Esc — назад к вводу; без изменений окно закрывается и фокус возвращается на кнопку шапки. Тест — задача 4 (e2e).
5. **Шаблон разделения со статьёй, ушедшей в архив:** шаблон не применяется молча неверно — предупреждение «1 элемент недоступен», строка остаётся с проектом, её доля учитывается; сохранённый из формы шаблон содержит ровно 100 %. Тесты — задача 5 (unit `applyPreset`, `presetFromSplit` и e2e).

---

## Карта файлов

```
src/shared/calc.ts                           # (новый) калькулятор поля суммы на Dec
src/client/lib/operation-form.ts             # (новый) черновик формы → тело POST, момент оплаты, курс перевода
src/client/lib/operation-options.ts          # (новый) варианты списков: архив, «Родитель → Дочерняя», тип контрагента
src/client/lib/split.ts                      # (новый) разбиение: остаток, проценты → суммы, шаблоны
src/client/lib/operation-create.ts           # (новый) «+ Создать „…“» — контрагент, статья, проект, тег
src/client/components/Popover.tsx            # портал в открытое модальное окно, поле формы у кнопки
src/client/components/SearchPicker.tsx       # PickerList: заголовки групп, «+ Создать „…“»
src/client/components/Modal.tsx              # onCancel: Esc решает владелец окна
src/client/components/AppHeader.tsx          # место для кнопок операций
src/client/components/operation/AmountField.tsx       # (новый) поле суммы с операторами
src/client/components/operation/ComboSelect.tsx       # (новый) выпадающий список с поиском для формы
src/client/components/operation/OperationForm.tsx     # (новый) форма операции
src/client/components/operation/OperationFormHost.tsx # (новый) открытая форма страницы, кнопки шапки
src/client/components/operation/SplitEditor.tsx       # (новый) «Разделить»
src/client/pages/CompanyLayout.tsx           # OperationFormHost и кнопки в шапке
tests/shared/calc.test.ts                    # (новый)
tests/client/{operation-form,operation-options,split}.test.ts   # (новые)
e2e/operation-form.spec.ts                   # (новый)
README.md
```

---
### Task 1: Калькулятор поля суммы

**Files:**
- Create: `src/shared/calc.ts`, `tests/shared/calc.test.ts`

**Interfaces:**
- Consumes: `DEC_ONE`, `divDec`, `type Dec` (`src/shared/decimal.ts`, план 4a).
- Produces: `CalcResult = { ok: true; minor: number } | { ok: false; error: string }`, `CALC_ERRORS` (`empty`, `syntax`, `divZero`, `tooBig`), `CALC_MAX_LENGTH = 200`, `evaluateAmount(text: string, minorUnits: number): CalcResult` — знак результата не проверяется (отрицательный и ноль — `ok`).

- [ ] **Step 1: Write the failing test**

`tests/shared/calc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CALC_ERRORS, evaluateAmount } from '../../src/shared/calc';

const ok = (text: string, minorUnits = 2) => {
  const r = evaluateAmount(text, minorUnits);
  if (!r.ok) throw new Error(`«${text}»: ${r.error}`);
  return r.minor;
};
const err = (text: string, minorUnits = 2) => {
  const r = evaluateAmount(text, minorUnits);
  if (r.ok) throw new Error(`«${text}» вычислилось в ${r.minor}`);
  return r.error;
};

describe('evaluateAmount — калькулятор поля суммы (§7, §10)', () => {
  it('число: запятая и точка, пробелы (и неразрывные) не учитываются', () => {
    expect(ok('1500')).toBe(150000);
    expect(ok('1 500,50')).toBe(150050);
    expect(ok('1500.5')).toBe(150050);
    expect(ok('1\u00A0500')).toBe(150000);
    expect(ok('1\u202F500,5')).toBe(150050);
    expect(ok(',5')).toBe(50);
    expect(ok('7.')).toBe(700);
  });

  it('приоритет операций, скобки, левая ассоциативность', () => {
    expect(ok('2+3*4')).toBe(1400);
    expect(ok('(2+3)*4')).toBe(2000);
    expect(ok('10-2-3')).toBe(500);
    expect(ok('100/4/5')).toBe(500);
    expect(ok('((1+2)*(3+4))')).toBe(2100);
    expect(ok(' 1 500 + 2 500,50 ')).toBe(400050);
  });

  it('знаки операций с кнопок и клавиатуры: × ÷ \u2212 и : * -', () => {
    expect(ok('10×3')).toBe(3000);
    expect(ok('10÷4')).toBe(250);
    expect(ok('10\u22123')).toBe(700);
    expect(ok('10:4')).toBe(250);
    expect(ok('10*3-5')).toBe(2500);
  });

  it('унарный минус и плюс; отрицательный результат — не ошибка калькулятора (проверяет форма)', () => {
    expect(ok('-5+10')).toBe(500);
    expect(ok('+5')).toBe(500);
    expect(ok('-(2+3)')).toBe(-500);
    expect(ok('2*-3')).toBe(-600);
    expect(ok('0')).toBe(0);
  });

  it('округление half-up до минимальных единиц валюты (0, 2 и 3 знака)', () => {
    expect(ok('10/3')).toBe(333);
    expect(ok('20/3')).toBe(667);
    expect(ok('0,005')).toBe(1);
    expect(ok('0,0049')).toBe(0);
    expect(ok('-0,005')).toBe(-1);
    expect(ok('10/4', 0)).toBe(3); // 2,5 JPY → 3
    expect(ok('1/3', 3)).toBe(333);
    expect(ok('1/3*3')).toBe(100); // 0,99999999999999999999 → 1,00
  });

  it('деление на ноль — ошибка (§10)', () => {
    expect(err('5/0')).toBe(CALC_ERRORS.divZero);
    expect(err('5/(2-2)')).toBe(CALC_ERRORS.divZero);
    expect(err('5÷0,0')).toBe(CALC_ERRORS.divZero);
  });

  it('пустое поле и неверные выражения', () => {
    expect(err('')).toBe(CALC_ERRORS.empty);
    expect(err('   ')).toBe(CALC_ERRORS.empty);
    for (const bad of ['2+', '(2', '2)', 'abc', '1,2,3', '2**3', '1e3', '()', '2(3)', '.', '5%']) {
      expect(err(bad), bad).toBe(CALC_ERRORS.syntax);
    }
    expect(err(`1+${'1'.repeat(200)}`)).toBe(CALC_ERRORS.syntax);
  });

  it('слишком большая сумма — ошибка, а не потеря точности', () => {
    expect(ok('90071992547409,91')).toBe(9007199254740991);
    expect(err('90071992547409,92')).toBe(CALC_ERRORS.tooBig);
    expect(err('99999999999999*99999999999999')).toBe(CALC_ERRORS.tooBig);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/calc.test.ts`
Expected: FAIL — модуля `src/shared/calc` нет.

- [ ] **Step 3: Implement**

`src/shared/calc.ts`:

```ts
import { DEC_ONE, divDec, type Dec } from './decimal';

/**
 * Калькулятор поля суммы (§7 «Поле суммы»): `+ - × /` (также `-`, `*`, `÷`, `:`), скобки, унарный минус;
 * десятичный разделитель — запятая или точка; пробелы (в том числе неразрывные) не учитываются.
 * Арифметика — `Dec` из decimal.ts (решение §4.3: вместо big.js): 20 знаков после запятой, умножение и деление
 * округляются half-up на 20-м знаке; результат — half-up (от нуля) до минимальных единиц валюты.
 */
export type CalcResult = { ok: true; minor: number } | { ok: false; error: string };

export const CALC_ERRORS = {
  empty: 'Введите сумму',
  syntax: 'Не удалось вычислить — проверьте выражение',
  divZero: 'Деление на ноль',
  tooBig: 'Слишком большая сумма',
} as const;

/** Длиннее — ошибка: заодно ограничивает глубину скобок. */
export const CALC_MAX_LENGTH = 200;

type Op = '+' | '-' | '*' | '/';
type Token = { kind: 'num'; value: Dec } | { kind: 'op'; value: Op } | { kind: '(' } | { kind: ')' };

const OPS: Record<string, Op> = {
  '+': '+',
  '-': '-',
  '\u2212': '-',
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
  ':': '/',
};

class CalcError extends Error {
  constructor(readonly reason: keyof typeof CALC_ERRORS) {
    super(reason);
  }
}

const SCALE_DIGITS = 20;

function tokenize(text: string): Token[] {
  const s = text.replace(/\s/g, '');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const op = OPS[ch];
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i++;
    } else if (ch === '(' || ch === ')') {
      tokens.push({ kind: ch });
      i++;
    } else {
      const m = /^(\d*)(?:[.,](\d*))?/.exec(s.slice(i))!;
      const int = m[1] ?? '';
      const frac = m[2] ?? '';
      if (int === '' && frac === '') throw new CalcError('syntax');
      if (frac.length > SCALE_DIGITS) throw new CalcError('syntax');
      tokens.push({ kind: 'num', value: BigInt(int || '0') * DEC_ONE + BigInt(frac.padEnd(SCALE_DIGITS, '0')) });
      i += m[0].length;
    }
  }
  return tokens;
}

const abs = (d: Dec): Dec => (d < 0n ? -d : d);
const withSign = (negative: boolean, d: Dec): Dec => (negative ? -d : d);

/** a × b, half-up (от нуля) на 20-м знаке. */
function mul(a: Dec, b: Dec): Dec {
  const q = (2n * abs(a) * abs(b) + DEC_ONE) / (2n * DEC_ONE);
  return withSign(a < 0n !== b < 0n, q);
}

/** a / b, half-up (от нуля) на 20-м знаке; деление на ноль — ошибка. */
function div(a: Dec, b: Dec): Dec {
  if (b === 0n) throw new CalcError('divZero');
  return withSign(a < 0n !== b < 0n, divDec(abs(a), abs(b)));
}

/** Рекурсивный спуск: expr := term (± term)*; term := factor (×/ factor)*; factor := ±factor | число | (expr). */
function parse(tokens: Token[]): Dec {
  let pos = 0;
  const peek = () => tokens[pos];

  function factor(): Dec {
    const t = peek();
    if (!t) throw new CalcError('syntax');
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      pos++;
      const v = factor();
      return t.value === '-' ? -v : v;
    }
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (t.kind === '(') {
      pos++;
      const v = expr();
      if (peek()?.kind !== ')') throw new CalcError('syntax');
      pos++;
      return v;
    }
    throw new CalcError('syntax');
  }

  function term(): Dec {
    let v = factor();
    for (let t = peek(); t?.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      pos++;
      const rhs = factor();
      v = t.value === '*' ? mul(v, rhs) : div(v, rhs);
    }
    return v;
  }

  function expr(): Dec {
    let v = term();
    for (let t = peek(); t?.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      pos++;
      const rhs = term();
      v = t.value === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  const value = expr();
  if (pos !== tokens.length) throw new CalcError('syntax');
  return value;
}

/** Dec → минимальные единицы валюты: half-up, половина — от нуля. */
function toMinor(d: Dec, minorUnits: number): number {
  const scale = 10n ** BigInt(SCALE_DIGITS - minorUnits);
  const q = (2n * abs(d) + scale) / (2n * scale);
  const minor = Number(withSign(d < 0n, q));
  if (!Number.isSafeInteger(minor)) throw new CalcError('tooBig');
  return minor === 0 ? 0 : minor;
}

/**
 * Выражение из поля суммы → минимальные единицы валюты. Знак не проверяется: «сумма больше нуля» — правило формы.
 * «1 500,50» → 150050; «(100+50)*2» → 30000; «10/3» → 333; «5/0» — «Деление на ноль».
 */
export function evaluateAmount(text: string, minorUnits: number): CalcResult {
  if (text.trim() === '') return { ok: false, error: CALC_ERRORS.empty };
  if (text.length > CALC_MAX_LENGTH) return { ok: false, error: CALC_ERRORS.syntax };
  try {
    return { ok: true, minor: toMinor(parse(tokenize(text)), minorUnits) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: CALC_ERRORS[e.reason] };
    throw e;
  }
}
```

Проверка, что экранирования не превратились в символы:

```bash
node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212\u200b]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/shared/calc.ts tests/shared/calc.test.ts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/calc.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/calc.ts tests/shared/calc.test.ts
git commit -m "feat: калькулятор поля суммы — выражения, запятая и точка, half-up до минимальных единиц

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Черновик формы операции → тело запроса

**Files:**
- Create: `src/client/lib/operation-form.ts`, `tests/client/operation-form.test.ts`

**Interfaces:**
- Consumes: `evaluateAmount` (задача 1); `getCurrency` (`src/shared/currencies.ts`); `isValidDate`, `startOfDayUtc`, `zoneOffsetMs` (`src/shared/dates.ts`); `DEC_ONE`, `divDec`, `roundSignificant` (`src/shared/decimal.ts`); `OperationType` (`src/client/lib/journal-filter.ts`, план 5b).
- Produces (`src/client/lib/operation-form.ts`):
  - `interface OperationDraft { type; accountId: number | null; amount: string; toAccountId: number | null; toAmount: string; paidDate: string; accrualOn: boolean; accrualDate: string; categoryId: number | null; projectId: number | null; counterpartyId: number | null; tagIds: number[]; comment: string }` (задача 5 добавит `split`);
  - `interface OperationBody` — тело `POST /operations`; `interface AccountLike { id; currency }`; `interface DraftContext { accounts: ReadonlyMap<number, AccountLike>; today; timeZone; now: Date; timeOfDayFrom: Date }`; `type BuildResult = { ok: true; body } | { ok: false; errors: Record<string, string> }`; `COMMENT_MAX = 2000`;
  - `emptyDraft(type, today, accountId = null)`, `changeType(draft, type)`, `similarDraft(draft)`, `paidAtFor(date, ref: Date, now: Date, timeZone): string`, `positiveAmount(text, minorUnits)` (как `evaluateAmount`, но ноль и минус — «Сумма больше нуля»), `buildBody(draft, ctx): BuildResult` (ключи ошибок — как у сервера: `accountId`, `amount`, `toAccountId`, `toAmount`, `paidAt`, `accrualDate`, `comment`), `transferRateText(amount, from, toAmount, to): string | null`.

- [ ] **Step 1: Write the failing test**

`tests/client/operation-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildBody,
  changeType,
  emptyDraft,
  paidAtFor,
  similarDraft,
  transferRateText,
  type DraftContext,
  type OperationDraft,
} from '../../src/client/lib/operation-form';

const TZ = 'Asia/Almaty';
// 07.10.2026, 10:30:00.123 по Алматы (UTC+5)
const NOW = new Date('2026-10-07T05:30:00.123Z');

const ctx: DraftContext = {
  accounts: new Map([
    [1, { id: 1, currency: 'KZT' }],
    [2, { id: 2, currency: 'KZT' }],
    [3, { id: 3, currency: 'USD' }],
    [4, { id: 4, currency: 'JPY' }],
  ]),
  today: '2026-10-07',
  timeZone: TZ,
  now: NOW,
  timeOfDayFrom: NOW,
};

const draft = (patch: Partial<OperationDraft>): OperationDraft => ({ ...emptyDraft('expense', '2026-10-07', 1), ...patch });
const body = (d: OperationDraft) => {
  const r = buildBody(d, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.body;
};
const errors = (d: OperationDraft) => {
  const r = buildBody(d, ctx);
  if (r.ok) throw new Error('ожидались ошибки');
  return r.errors;
};

describe('paidAtFor — момент оплаты из даты формы', () => {
  it('сегодня — «сейчас»; прошлый день — то же время суток по Алматы', () => {
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ)).toBe('2026-10-07T05:30:00.123Z');
    expect(paidAtFor('2026-10-05', NOW, NOW, TZ)).toBe('2026-10-05T05:30:00.123Z');
  });

  it('прежнее время операции переносится на новую дату, но не позже «сейчас»', () => {
    const lateEvening = new Date('2026-10-05T18:30:00.000Z'); // 23:30 по Алматы
    expect(paidAtFor('2026-10-06', lateEvening, NOW, TZ)).toBe('2026-10-06T18:30:00.000Z');
    expect(paidAtFor('2026-10-07', lateEvening, NOW, TZ)).toBe(NOW.toISOString());
  });

  it('до 01.03.2024 в Алматы было UTC+6 — граница суток по дате операции', () => {
    expect(paidAtFor('2024-01-15', NOW, NOW, TZ)).toBe('2024-01-15T04:30:00.123Z');
  });
});

describe('buildBody — черновик формы → тело POST /operations', () => {
  it('расход: выражение в сумме, одна строка со статьёй и проектом, комментарий без краевых пробелов', () => {
    expect(
      body(draft({ amount: '1 000 + 500,5', categoryId: 7, projectId: 8, counterpartyId: 9, tagIds: [3, 2], comment: '  аренда  ' })),
    ).toEqual({
      type: 'expense',
      paidAt: '2026-10-07T05:30:00.123Z',
      accrualDate: null,
      accountId: 1,
      amount: 150050,
      toAccountId: null,
      toAmount: null,
      counterpartyId: 9,
      comment: 'аренда',
      lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
      tagIds: [3, 2],
    });
  });

  it('доход без статьи — строка на всю сумму; дата сделки — только при включённом переключателе', () => {
    const b = body(draft({ type: 'income', amount: '100', accrualOn: true, accrualDate: '2026-09-30', comment: '   ' }));
    expect(b).toMatchObject({ type: 'income', accrualDate: '2026-09-30', comment: null, lines: [{ categoryId: null, projectId: null, amount: 10000 }] });
    expect(body(draft({ amount: '100', accrualOn: false, accrualDate: '2026-09-30' })).accrualDate).toBeNull();
  });

  it('сумма округляется до минимальных единиц валюты счёта (JPY — без дробной части)', () => {
    expect(body(draft({ accountId: 4, amount: '10/4' })).amount).toBe(3);
    expect(body(draft({ amount: '10/3' })).amount).toBe(333);
  });

  it('перевод в одной валюте: сумма зачисления не передаётся, строк нет; с проектом — одна строка без статьи', () => {
    const t = draft({ type: 'transfer', accountId: 1, toAccountId: 2, amount: '500', toAmount: '999', counterpartyId: 9, categoryId: 7 });
    expect(body(t)).toMatchObject({ type: 'transfer', toAccountId: 2, toAmount: null, counterpartyId: null, lines: [] });
    expect(body({ ...t, projectId: 8 }).lines).toEqual([{ categoryId: null, projectId: 8, amount: 50000 }]);
    // у перевода нет даты сделки — включённый раньше у расхода переключатель не действует
    expect(body({ ...t, accrualOn: true, accrualDate: '2026-09-30' }).accrualDate).toBeNull();
  });

  it('перевод KZT → USD: «Сумма зачисления» в валюте счёта зачисления', () => {
    expect(body(draft({ type: 'transfer', accountId: 1, toAccountId: 3, amount: '50 000', toAmount: '100' }))).toMatchObject({
      amount: 5000000,
      toAccountId: 3,
      toAmount: 10000,
    });
  });

  it('ошибки по полям: счёт, сумма, счёт зачисления, сумма зачисления, будущая дата, дата сделки, длинный комментарий', () => {
    expect(errors(draft({ accountId: null, amount: '' }))).toEqual({ accountId: 'Выберите счёт' });
    expect(errors(draft({ amount: '' }))).toEqual({ amount: 'Введите сумму' });
    expect(errors(draft({ amount: '0' }))).toEqual({ amount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '5-10' }))).toEqual({ amount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '5/0' }))).toEqual({ amount: 'Деление на ноль' });
    expect(errors(draft({ type: 'transfer', amount: '1' }))).toEqual({ toAccountId: 'Выберите счёт зачисления' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 1 }))).toEqual({ toAccountId: 'Выберите другой счёт' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 3 }))).toEqual({ toAmount: 'Укажите сумму зачисления' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 3, toAmount: '0' }))).toEqual({ toAmount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '1', paidDate: '2026-10-08' }))).toEqual({ paidAt: 'Дата оплаты в будущем — так нельзя' });
    expect(errors(draft({ amount: '1', paidDate: '' }))).toEqual({ paidAt: 'Укажите дату оплаты' });
    expect(errors(draft({ amount: '1', accrualOn: true, accrualDate: '2026-02-30' }))).toEqual({ accrualDate: 'Укажите дату сделки' });
    expect(errors(draft({ amount: '1', comment: 'я'.repeat(2001) }))).toEqual({ comment: 'Не длиннее 2000 символов' });
  });
});

describe('changeType, similarDraft, transferRateText', () => {
  it('смена типа сбрасывает статью; у перевода нет контрагента; из перевода — без счёта зачисления', () => {
    const d = draft({ amount: '5', categoryId: 7, counterpartyId: 9, projectId: 8, comment: 'к' });
    expect(changeType(d, 'income')).toMatchObject({ type: 'income', amount: '5', categoryId: null, counterpartyId: 9, projectId: 8, comment: 'к' });
    const t = changeType(d, 'transfer');
    expect(t).toMatchObject({ type: 'transfer', categoryId: null, counterpartyId: null });
    expect(changeType({ ...t, toAccountId: 2, toAmount: '7' }, 'expense')).toMatchObject({ toAccountId: null, toAmount: '' });
    expect(changeType(d, 'expense')).toBe(d);
  });

  it('«создать похожий» — без суммы и комментария, остальное как было', () => {
    const d = draft({ amount: '5', toAmount: '6', comment: 'к', categoryId: 7, tagIds: [1], paidDate: '2026-10-01' });
    expect(similarDraft(d)).toEqual({ ...d, amount: '', toAmount: '', comment: '' });
  });

  it('курс перевода — за единицу более дорогой валюты, 10 значащих цифр', () => {
    expect(transferRateText(5000000, 'KZT', 10000, 'USD')).toBe('1 USD = 500 KZT');
    expect(transferRateText(10000, 'USD', 4751200, 'KZT')).toBe('1 USD = 475,12 KZT');
    expect(transferRateText(100, 'KZT', 3, 'JPY')).toBe('1 KZT = 3 JPY');
    expect(transferRateText(30000, 'KZT', 100, 'CNY')).toBe('1 CNY = 300 KZT');
    expect(transferRateText(100000, 'KZT', 2100, 'KWD')).toBe('1 KWD = 476,1904762 KZT');
    expect(transferRateText(0, 'KZT', 10000, 'USD')).toBeNull();
    expect(transferRateText(100, 'KZT', 100, 'KZT')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/operation-form.test.ts`
Expected: FAIL — модуля `operation-form` нет.

- [ ] **Step 3: Implement**

`src/client/lib/operation-form.ts`:

```ts
import { evaluateAmount } from '../../shared/calc';
import { getCurrency } from '../../shared/currencies';
import { isValidDate, startOfDayUtc, zoneOffsetMs } from '../../shared/dates';
import { DEC_ONE, divDec, roundSignificant } from '../../shared/decimal';
import type { OperationType } from './journal-filter';

/**
 * Черновик формы операции (§7 «Форма операции»): то, что видит пользователь. Суммы — текст поля (в нём может
 * быть выражение калькулятора), даты — календарные `YYYY-MM-DD` в APP_TIMEZONE.
 */
export interface OperationDraft {
  type: OperationType;
  accountId: number | null;
  amount: string;
  /** Перевод: счёт зачисления. */
  toAccountId: number | null;
  /** Перевод между валютами: «Сумма зачисления». */
  toAmount: string;
  paidDate: string;
  /** «Дата сделки отличается». */
  accrualOn: boolean;
  accrualDate: string;
  categoryId: number | null;
  projectId: number | null;
  counterpartyId: number | null;
  tagIds: number[];
  comment: string;
}

/** Тело POST /companies/:cid/operations (план 4a, `operationCreateSchema`). */
export interface OperationBody {
  type: OperationType;
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

export interface AccountLike {
  id: number;
  currency: string;
}

export interface DraftContext {
  accounts: ReadonlyMap<number, AccountLike>;
  /** «Сегодня» в APP_TIMEZONE: выбрать будущий день нельзя (инвариант 6). */
  today: string;
  timeZone: string;
  now: Date;
  /** Откуда взять время суток для paidAt: у новой операции — «сейчас», у существующей — её прежнее время. */
  timeOfDayFrom: Date;
}

export type BuildResult = { ok: true; body: OperationBody } | { ok: false; errors: Record<string, string> };

export const COMMENT_MAX = 2000;

export function emptyDraft(type: OperationType, today: string, accountId: number | null = null): OperationDraft {
  return {
    type,
    accountId,
    amount: '',
    toAccountId: null,
    toAmount: '',
    paidDate: today,
    accrualOn: false,
    accrualDate: today,
    categoryId: null,
    projectId: null,
    counterpartyId: null,
    tagIds: [],
    comment: '',
  };
}

/** Смена типа в новой операции: статья другого вида и контрагент у перевода не переносятся. */
export function changeType(draft: OperationDraft, type: OperationType): OperationDraft {
  if (type === draft.type) return draft;
  return {
    ...draft,
    type,
    categoryId: null,
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
    toAccountId: type === 'transfer' ? draft.toAccountId : null,
    toAmount: type === 'transfer' ? draft.toAmount : '',
  };
}

/** «Сохранить и создать похожий» (§7): те же значения, кроме суммы, комментария и файлов. */
export function similarDraft(draft: OperationDraft): OperationDraft {
  return { ...draft, amount: '', toAmount: '', comment: '' };
}

const DAY_MS = 86_400_000;

/**
 * Момент оплаты для даты из формы: дата `date` и время суток момента `ref` (в поясе приложения), но не позже `now`.
 * Новая операция за сегодня — ровно «сейчас»; за прошлый день — тот же час; правка даты сохраняет прежнее время.
 */
export function paidAtFor(date: string, ref: Date, now: Date, timeZone: string): string {
  const wall = ref.getTime() + zoneOffsetMs(ref.getTime(), timeZone);
  const msOfDay = ((wall % DAY_MS) + DAY_MS) % DAY_MS;
  const t = Date.parse(startOfDayUtc(date, timeZone)) + msOfDay;
  return new Date(Math.min(t, now.getTime())).toISOString();
}

/** Сумма поля → минимальные единицы (> 0) или текст ошибки. */
export function positiveAmount(text: string, minorUnits: number): { ok: true; minor: number } | { ok: false; error: string } {
  const r = evaluateAmount(text, minorUnits);
  if (!r.ok) return r;
  if (r.minor <= 0) return { ok: false, error: 'Сумма больше нуля' };
  return r;
}

/**
 * Черновик → тело запроса создания операции; ошибки — по полям формы (ключи как у ответа сервера:
 * `accountId`, `amount`, `toAccountId`, `toAmount`, `paidAt`, `accrualDate`, `comment`).
 */
export function buildBody(draft: OperationDraft, ctx: DraftContext): BuildResult {
  const errors: Record<string, string> = {};
  const account = draft.accountId === null ? undefined : ctx.accounts.get(draft.accountId);
  if (!account) errors.accountId = 'Выберите счёт';

  let amount = 0;
  if (account) {
    const r = positiveAmount(draft.amount, getCurrency(account.currency).minorUnits);
    if (r.ok) amount = r.minor;
    else errors.amount = r.error;
  }

  let toAccountId: number | null = null;
  let toAmount: number | null = null;
  if (draft.type === 'transfer') {
    const to = draft.toAccountId === null ? undefined : ctx.accounts.get(draft.toAccountId);
    if (!to) errors.toAccountId = 'Выберите счёт зачисления';
    else if (to.id === draft.accountId) errors.toAccountId = 'Выберите другой счёт';
    else {
      toAccountId = to.id;
      if (account && to.currency !== account.currency) {
        if (draft.toAmount.trim() === '') errors.toAmount = 'Укажите сумму зачисления';
        else {
          const r = positiveAmount(draft.toAmount, getCurrency(to.currency).minorUnits);
          if (r.ok) toAmount = r.minor;
          else errors.toAmount = r.error;
        }
      }
    }
  }

  if (!isValidDate(draft.paidDate)) errors.paidAt = 'Укажите дату оплаты';
  else if (draft.paidDate > ctx.today) errors.paidAt = 'Дата оплаты в будущем — так нельзя';
  // у перевода даты сделки нет (§7): переключатель есть только у дохода и расхода
  const accrual = draft.accrualOn && draft.type !== 'transfer';
  if (accrual && !isValidDate(draft.accrualDate)) errors.accrualDate = 'Укажите дату сделки';
  const comment = draft.comment.trim();
  if (comment.length > COMMENT_MAX) errors.comment = `Не длиннее ${COMMENT_MAX} символов`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const transfer = draft.type === 'transfer';
  return {
    ok: true,
    body: {
      type: draft.type,
      paidAt: paidAtFor(draft.paidDate, ctx.timeOfDayFrom, ctx.now, ctx.timeZone),
      accrualDate: accrual ? draft.accrualDate : null,
      accountId: account!.id,
      amount,
      toAccountId,
      toAmount,
      counterpartyId: transfer ? null : draft.counterpartyId,
      comment: comment || null,
      // у перевода строка только с проектом (§4.5); у дохода и расхода — одна строка на всю сумму
      lines: transfer
        ? draft.projectId === null
          ? []
          : [{ categoryId: null, projectId: draft.projectId, amount }]
        : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
      tagIds: [...draft.tagIds],
    },
  };
}

const toDec = (minor: number, currency: string) => (BigInt(minor) * DEC_ONE) / 10n ** BigInt(getCurrency(currency).minorUnits);

/**
 * Курс перевода между валютами из двух сумм (§7: «вычисленный курс»): за единицу более дорогой валюты,
 * 10 значащих цифр — «1 USD = 500 KZT», а не «1 KZT = 0,002 USD». null — суммы не заданы или валюта одна.
 */
export function transferRateText(amount: number, from: string, toAmount: number, to: string): string | null {
  if (amount <= 0 || toAmount <= 0 || from === to) return null;
  const a = toDec(amount, from);
  const b = toDec(toAmount, to);
  const [unit, other, num, den] = b >= a ? [from, to, b, a] : [to, from, a, b];
  return `1 ${unit} = ${roundSignificant(divDec(num, den)).replace('.', ',')} ${other}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/operation-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/client/lib/operation-form.ts tests/client/operation-form.test.ts
git commit -m "feat: черновик формы операции — проверка полей, момент оплаты, тело запроса, курс перевода

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Поле суммы с операторами и выпадающие списки с поиском

**Files:**
- Create: `src/client/lib/operation-options.ts`, `src/client/components/operation/ComboSelect.tsx`, `src/client/components/operation/AmountField.tsx`, `tests/client/operation-options.test.ts`
- Modify: `src/client/components/Popover.tsx`, `src/client/components/SearchPicker.tsx`

**Interfaces:**
- Consumes: `Popover`, `SearchPicker`, `PickerOption` (план 5b/5c); `Field`, `FieldControlProps`; `foldCase`, `matchesQuery` (`src/shared/search.ts`); `COUNTERPARTY_TYPE_LABELS` (`src/shared/counterparties.ts`); `SYSTEM_CATEGORIES`, `CounterpartyType` (`src/shared/system-categories.ts`); типы `Account`, `CategoryNode`, `CategoryTree`, `Counterparty`, `Project`, `Tag` (`src/client/lib/queries.ts`); `CALC_MAX_LENGTH` (задача 1); `positiveAmount` (задача 2); `amountInputText` (`src/client/lib/journal-format.ts`, план 5b).
- Produces:
  - `Popover`: свойства `control?: FieldControlProps` (id и aria-атрибуты поля на кнопке) и `panelLabel?: string`; внутри открытого `<dialog>` панель рисуется в нём;
  - `SearchPicker.tsx`: `PickerOption.section?: string`; `export function PickerList(props: { label; options; onPick; onCreate?: (name: string) => void })`; `SearchPicker` получает `onCreate?: (name: string) => void`; пункт создания — «+ Создать „<название>“»;
  - `operation-options.ts`: `accountOptions(accounts, selected)`, `categoryOptions(tree, kind, selected[])`, `projectOptions(projects, selected[])`, `tagOptions(tags, selected[])`, `findCategory(tree, id)`, `preferredCounterpartyType(tree, categoryId): CounterpartyType | null`, `counterpartyOptions(counterparties, selected, preferred)` — все возвращают `PickerOption[]`;
  - `ComboSelect({ label, listLabel, value, options, emptyLabel: string | null, placeholder?, onChange(id | null), onCreate?(name), error?, hint?, disabled?, className? })` — имя кнопки «<label>: <значение>», пустое значение — пункт с `emptyLabel`; `selectButtonClass`;
  - `AmountField({ label, value, onChange, minorUnits, error?, hint?, disabled?, focusSignal?, className? })` — `inputMode="decimal"`, вычисление при уходе из поля, группа «Операторы: <label>» с кнопками «Оператор плюс», «Оператор минус», «Оператор умножение», «Оператор деление» (видна ниже 768 px), `focusSignal` — поставить фокус при появлении и при каждом изменении.

- [ ] **Step 1: Write the failing test**

`tests/client/operation-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  accountOptions,
  categoryOptions,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  tagOptions,
} from '../../src/client/lib/operation-options';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from '../../src/client/lib/queries';

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

const tree: CategoryTree = {
  income: [node(1, 'Выручка', { kind: 'income' })],
  expense: [
    node(10, 'Зарплата', {
      systemKey: 'salary',
      effectiveSystemKey: 'salary',
      children: [node(11, 'Администраторы', { parentId: 10, effectiveSystemKey: 'salary' })],
    }),
    node(20, 'Помещение', { children: [node(21, 'Аренда', { parentId: 20 }), node(22, 'Свет', { parentId: 20, archivedAt: ARCH })] }),
    node(30, 'Старое', { archivedAt: ARCH, children: [node(31, 'Дочерняя', { parentId: 30 })] }),
  ],
};

const account = (id: number, name: string, currency: string, archivedAt: string | null = null) =>
  ({ id, name, currency, archivedAt }) as Account;
const cp = (id: number, name: string, type: Counterparty['type'], archivedAt: string | null = null) => ({ id, name, type, archivedAt }) as Counterparty;

describe('варианты списков формы операции', () => {
  it('архивные не предлагаются, уже выбранный архивный остаётся с пометкой', () => {
    const accounts = [account(1, 'Касса', 'KZT'), account(2, 'Старый', 'USD', ARCH)];
    expect(accountOptions(accounts, null)).toEqual([{ id: 1, label: 'Касса (KZT)' }]);
    expect(accountOptions(accounts, 2)).toEqual([
      { id: 1, label: 'Касса (KZT)' },
      { id: 2, label: 'Старый (USD) (в архиве)' },
    ]);
    const projects = [{ id: 5, name: 'Клуб', archivedAt: null }, { id: 6, name: 'Закрытый', archivedAt: ARCH }] as Project[];
    expect(projectOptions(projects, [null])).toEqual([{ id: 5, label: 'Клуб' }]);
    expect(projectOptions(projects, [6])).toHaveLength(2);
    const tags = [{ id: 7, name: 'нал', archivedAt: null }, { id: 8, name: 'старый', archivedAt: ARCH }] as Tag[];
    expect(tagOptions(tags, [])).toEqual([{ id: 7, label: 'нал' }]);
    expect(tagOptions(tags, [8])).toEqual([
      { id: 7, label: 'нал' },
      { id: 8, label: 'старый (в архиве)' },
    ]);
  });

  it('статьи: только вида операции, дочерние — «Родитель → Дочерняя»; дочерняя архивного родителя — архивная', () => {
    expect(categoryOptions(tree, 'income', [])).toEqual([{ id: 1, label: 'Выручка' }]);
    expect(categoryOptions(tree, 'expense', [null]).map((o) => o.label)).toEqual(['Зарплата', 'Зарплата → Администраторы', 'Помещение', 'Помещение → Аренда']);
    expect(categoryOptions(tree, 'expense', [31]).map((o) => o.label)).toContain('Старое → Дочерняя (в архиве)');
  });

  it('эффективный systemKey дочерней статьи → подходящий тип контрагента; обычная статья — без предпочтения', () => {
    expect(findCategory(tree, 11)?.name).toBe('Администраторы');
    expect(findCategory(tree, 99)).toBeUndefined();
    expect(preferredCounterpartyType(tree, 10)).toBe('employee');
    expect(preferredCounterpartyType(tree, 11)).toBe('employee');
    expect(preferredCounterpartyType(tree, 21)).toBeNull();
    expect(preferredCounterpartyType(tree, null)).toBeNull();
  });

  it('контрагенты: подходящий тип первым с заголовком группы, остальные — после', () => {
    const list = [cp(1, 'ТОО Свет', 'supplier'), cp(2, 'Айгерим', 'employee'), cp(3, 'Уволен', 'employee', ARCH), cp(4, 'Бауыржан', 'employee')];
    expect(counterpartyOptions(list, null, null)).toEqual([
      { id: 1, label: 'ТОО Свет' },
      { id: 2, label: 'Айгерим' },
      { id: 4, label: 'Бауыржан' },
    ]);
    expect(counterpartyOptions(list, null, 'employee')).toEqual([
      { id: 2, label: 'Айгерим', section: 'Сотрудники' },
      { id: 4, label: 'Бауыржан', section: 'Сотрудники' },
      { id: 1, label: 'ТОО Свет', section: 'Остальные' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/operation-options.test.ts`
Expected: FAIL — модуля `operation-options` нет.

- [ ] **Step 3: Implement**

`src/client/components/Popover.tsx` — правки (места — из плана 5b; если код после решений по выполнению 5b выглядит иначе, внесите те же изменения по смыслу):

1. Найдите:

```tsx
import { createPortal } from 'react-dom';
```

   замените на:

```tsx
import { createPortal } from 'react-dom';
import type { FieldControlProps } from './Field';
```

2. Найдите:

```tsx
  disabled?: boolean;
```

   замените на:

```tsx
  disabled?: boolean;
  /** id и aria-атрибуты поля формы (`Field`): подпись `<label for>`, подсказка и ошибка связываются с кнопкой. */
  control?: FieldControlProps;
  /** Название панели, если оно не совпадает с именем кнопки. */
  panelLabel?: string;
```

3. Найдите:

```tsx
  const name = props.ariaLabel ?? 
```

   замените на:

```tsx
  const name = props.panelLabel ?? props.ariaLabel ?? 
```

4. Найдите:

```tsx
        ref={buttonRef}
```

   замените на:

```tsx
        {...props.control}
        ref={buttonRef}
```

5. Найдите:

```tsx
          document.body,
```

   замените на:

```tsx
          // внутри модального окна (<dialog> через showModal) всё вне окна недоступно — панель рисуется в самом окне
          rootRef.current?.closest('dialog') ?? document.body,
```

`src/client/components/SearchPicker.tsx` — правки. Файл создаёт план 5c; если после его выполнения места правок выглядят иначе, внесите изменения по смыслу: экспортируйте `PickerList`; у варианта — необязательный `section` и заголовок группы (`<li role="presentation">`) перед первым вариантом группы; с `onCreate` последним пунктом списка (`role="option"`, стрелки и Enter доходят и до него) идёт «+ Создать „<набранное>“», если варианта с таким названием (сравнение через `foldCase`) нет; `SearchPicker` передаёт `onCreate` в `PickerList` и закрывает панель перед вызовом. Решение по выполнению 5c про `aria-disabled` не затрагивается — оставьте его как есть:

1. Найдите:

```tsx
import { matchesQuery } from '../../shared/search';
```

   замените на:

```tsx
import { foldCase, matchesQuery } from '../../shared/search';
```

2. Найдите:

```tsx
  label: string;
}
```

   замените на:

```tsx
  label: string;
  /** Заголовок группы: показывается перед первым вариантом группы (например, «Сотрудники»). */
  section?: string;
}
```

3. Замените комментарий и функцию `PickerList` целиком — от строки `/**` с текстом «Список с поиском (шаблон combobox + listbox)…» до закрывающей скобки функции (перед комментарием «Кнопка с выпадающим списком с поиском…») — на код ниже. Функция становится экспортируемой: её использует выпадающий список формы.

```tsx
type Item = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string };

/**
 * Список с поиском (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают выбор,
 * Enter выбирает, Esc закрывает. Поиск — без учёта регистра и «ё» (тем же правилом, что сервер, §6.1).
 * С `onCreate` последним пунктом идёт «+ Создать „…“», если такого названия ещё нет (§7).
 */
export function PickerList(props: { label: string; options: PickerOption[]; onPick: (id: number) => void; onCreate?: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = props.options.filter((o) => matchesQuery(o.label, query));
  const name = query.trim();
  const exists = props.options.some((o) => foldCase(o.label) === foldCase(name));
  const items: Item[] = [
    ...shown.map((option) => ({ kind: 'option' as const, option })),
    ...(props.onCreate && name !== '' && !exists ? [{ kind: 'create' as const, name }] : []),
  ];
  const itemId = (it: Item) => (it.kind === 'option' ? `${listId}-${it.option.id}` : `${listId}-create`);
  const current = items[Math.min(active, items.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (current) document.getElementById(itemId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current && itemId(current)]);

  const choose = (it: Item) => (it.kind === 'option' ? props.onPick(it.option.id) : props.onCreate?.(it.name));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
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
        role="combobox"
        aria-label={`${props.label}: поиск`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? itemId(current) : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Поиск"
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <ul id={listId} role="listbox" aria-label={props.label} className="max-h-60 overflow-y-auto">
        {items.map((it, i) => {
          const prev = items[i - 1];
          const section = it.kind === 'option' ? it.option.section : undefined;
          const prevSection = prev?.kind === 'option' ? prev.option.section : undefined;
          return [
            section && section !== prevSection ? (
              <li key={`section-${section}`} role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold text-muted">
                {section}
              </li>
            ) : null,
            <li
              key={itemId(it)}
              id={itemId(it)}
              role="option"
              aria-selected={it === current}
              // фокус остаётся в поле поиска
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(it)}
              className={`cursor-pointer truncate rounded-lg px-3 py-1.5 text-sm ${it === current ? 'bg-field' : ''} ${it.kind === 'create' ? 'font-medium text-income' : ''}`}
            >
              {it.kind === 'option' ? it.option.label : `+ Создать „${it.name}“`}
            </li>,
          ];
        })}
      </ul>
      {items.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
    </div>
  );
}
```

4. Найдите:

```tsx
  onPick: (id: number) => void;
  buttonClassName?: string;
```

   замените на:

```tsx
  onPick: (id: number) => void;
  /** «+ Создать „…“»: создаёт элемент с набранным названием (§7). */
  onCreate?: (name: string) => void;
  buttonClassName?: string;
```

5. Найдите:

```tsx
            props.onPick(id);
          }}
        />
```

   замените на:

```tsx
            props.onPick(id);
          }}
          onCreate={
            props.onCreate &&
            ((name) => {
              close(true);
              props.onCreate!(name);
            })
          }
        />
```

`src/client/lib/operation-options.ts`:

```ts
import { COUNTERPARTY_TYPE_LABELS } from '../../shared/counterparties';
import { SYSTEM_CATEGORIES, type CounterpartyType } from '../../shared/system-categories';
import type { PickerOption } from '../components/SearchPicker';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';

/**
 * Варианты выпадающих списков формы операции (§7): архивные не предлагаются (инвариант 7), но уже выбранный
 * архивный элемент остаётся в списке с пометкой «(в архиве)» — правка операции не теряет его.
 */
const ARCHIVED = ' (в архиве)';

type Archivable = { id: number; archivedAt: string | null };
const keep = (x: Archivable, selected: readonly (number | null)[]) => !x.archivedAt || selected.includes(x.id);
const mark = (label: string, x: Archivable) => (x.archivedAt ? label + ARCHIVED : label);

export function accountOptions(accounts: readonly Account[], selected: number | null): PickerOption[] {
  return accounts.filter((a) => keep(a, [selected])).map((a) => ({ id: a.id, label: mark(`${a.name} (${a.currency})`, a) }));
}

/** Статьи вида kind: «Родитель», «Родитель → Дочерняя». Дочерняя архивного родителя тоже считается архивной. */
export function categoryOptions(tree: CategoryTree, kind: 'income' | 'expense', selected: readonly (number | null)[]): PickerOption[] {
  return tree[kind].flatMap((n) => [
    ...(keep(n, selected) ? [{ id: n.id, label: mark(n.name, n) }] : []),
    ...n.children
      .map((c) => ({ ...c, archivedAt: c.archivedAt ?? n.archivedAt }))
      .filter((c) => keep(c, selected))
      .map((c) => ({ id: c.id, label: mark(`${n.name} → ${c.name}`, c) })),
  ]);
}

export function projectOptions(projects: readonly Project[], selected: readonly (number | null)[]): PickerOption[] {
  return projects.filter((p) => keep(p, selected)).map((p) => ({ id: p.id, label: mark(p.name, p) }));
}

export function tagOptions(tags: readonly Tag[], selected: readonly number[]): PickerOption[] {
  return tags.filter((t) => keep(t, selected)).map((t) => ({ id: t.id, label: mark(t.name, t) }));
}

/** Статья дерева по id (верхний уровень или дочерняя). */
export function findCategory(tree: CategoryTree, id: number | null): CategoryNode | undefined {
  if (id === null) return undefined;
  for (const n of [...tree.income, ...tree.expense]) {
    if (n.id === id) return n;
    const child = n.children.find((c) => c.id === id);
    if (child) return child;
  }
  return undefined;
}

/** Тип контрагента, который подходит статье с эффективным systemKey (§4.4): «Зарплата» → сотрудник. */
export function preferredCounterpartyType(tree: CategoryTree, categoryId: number | null): CounterpartyType | null {
  const key = findCategory(tree, categoryId)?.effectiveSystemKey;
  return SYSTEM_CATEGORIES.find((c) => c.key === key)?.counterpartyType ?? null;
}

/**
 * Контрагенты: для статьи с эффективным systemKey сначала подходящий тип («Сотрудники»), затем «Остальные» (§7).
 */
export function counterpartyOptions(counterparties: readonly Counterparty[], selected: number | null, preferred: CounterpartyType | null): PickerOption[] {
  const list = counterparties.filter((c) => keep(c, [selected])).map((c) => ({ id: c.id, label: mark(c.name, c), type: c.type }));
  if (!preferred) return list.map(({ id, label }) => ({ id, label }));
  return [
    ...list.filter((c) => c.type === preferred).map(({ id, label }) => ({ id, label, section: COUNTERPARTY_TYPE_LABELS[preferred] })),
    ...list.filter((c) => c.type !== preferred).map(({ id, label }) => ({ id, label, section: 'Остальные' })),
  ];
}
```

`src/client/components/operation/ComboSelect.tsx`:

```tsx
import { Field } from '../Field';
import { Popover } from '../Popover';
import { PickerList, type PickerOption } from '../SearchPicker';

/** Пункт «без значения» в списке: id справочников всегда положительные. */
const NONE = 0;

export const selectButtonClass =
  'flex w-full items-center justify-between gap-2 rounded-xl bg-field px-4 py-3 text-left outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Выпадающий список с поиском для поля формы (§7): кнопка с текущим значением, по нажатию — панель с поиском
 * (без учёта регистра и «ё»), пункт «без значения» и, с `onCreate`, «+ Создать „…“». Имя кнопки —
 * «Подпись: значение», подпись поля и ошибка связаны с кнопкой через `Field`.
 */
export function ComboSelect(props: {
  label: string;
  /** Название списка для программ чтения с экрана: «Статьи». */
  listLabel: string;
  value: number | null;
  options: PickerOption[];
  /** Подпись пустого значения: «Без статьи». null — пустого значения нет (счёт). */
  emptyLabel: string | null;
  placeholder?: string;
  onChange: (id: number | null) => void;
  onCreate?: (name: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = props.options.find((o) => o.id === props.value);
  const text = selected?.label ?? (props.value === null ? (props.emptyLabel ?? props.placeholder ?? 'Выберите') : '…');
  const options = props.emptyLabel === null ? props.options : [{ id: NONE, label: props.emptyLabel }, ...props.options];
  return (
    <Field label={props.label} error={props.error} hint={props.hint} className={props.className}>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className={`truncate ${props.value === null ? 'text-muted' : ''}`}>{text}</span>
              <span aria-hidden="true" className="text-muted">
                ▾
              </span>
            </>
          }
          ariaLabel={`${props.label}: ${text}`}
          panelLabel={props.listLabel}
          buttonClassName={selectButtonClass}
          disabled={props.disabled}
          panelClassName="w-80"
        >
          {(close) => (
            <PickerList
              label={props.listLabel}
              options={options}
              onPick={(id) => {
                close(true);
                props.onChange(id === NONE ? null : id);
              }}
              onCreate={
                props.onCreate &&
                ((name) => {
                  close(true);
                  props.onCreate!(name);
                })
              }
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
```

`src/client/components/operation/AmountField.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CALC_MAX_LENGTH } from '../../../shared/calc';
import { positiveAmount } from '../../lib/operation-form';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { inputClass } from '../ui';

/** Кнопки операторов под полем на телефоне: цифровая клавиатура их не показывает (§7). */
const OPERATORS = [
  { symbol: '+', name: 'плюс' },
  { symbol: '\u2212', name: 'минус' },
  { symbol: '×', name: 'умножение' },
  { symbol: '÷', name: 'деление' },
] as const;

/**
 * Поле суммы (§7): принимает выражение (`+ - × /`, скобки, запятая или точка) и вычисляет его при уходе
 * из поля — в поле остаётся результат, округлённый до минимальных единиц валюты. Ниже 768 px под полем —
 * ряд операторов; нажатие вставляет оператор в позицию курсора и не уводит фокус из поля.
 */
export function AmountField(props: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  minorUnits: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Поставить фокус в поле: при появлении и при каждом изменении значения (после «Сохранить и создать похожий»). */
  focusSignal?: number;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  /** Куда поставить курсор после вставки оператора — сразу после отрисовки нового значения. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current === null || !input) return;
    input.focus();
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [props.value]);

  useEffect(() => {
    // кадр спустя: окно <dialog> к этому моменту уже открыто через showModal()
    if (props.focusSignal) requestAnimationFrame(() => ref.current?.focus());
  }, [props.focusSignal]);

  const evaluate = () => {
    if (props.value.trim() === '') return;
    const r = positiveAmount(props.value, props.minorUnits);
    if (r.ok) props.onChange(amountInputText(r.minor, props.minorUnits));
    setCalcError(r.ok ? null : r.error);
  };

  const insert = (symbol: string) => {
    const input = ref.current;
    if (!input) return;
    const focused = document.activeElement === input;
    const start = focused ? (input.selectionStart ?? props.value.length) : props.value.length;
    const end = focused ? (input.selectionEnd ?? start) : start;
    caret.current = start + symbol.length;
    props.onChange(props.value.slice(0, start) + symbol + props.value.slice(end));
    setCalcError(null);
  };

  return (
    <Field label={props.label} error={props.error ?? calcError ?? undefined} hint={props.hint} className={props.className}>
      {(c) => (
        <>
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
            placeholder="0"
            className={`${inputClass} text-lg font-semibold tabular-nums`}
          />
          {!props.disabled && (
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
          )}
        </>
      )}
    </Field>
  );
}
```

Проверка экранирований:

```bash
node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212\u200b]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/client/components/operation/AmountField.tsx src/client/components/SearchPicker.tsx src/client/lib/operation-options.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/operation-options.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/journal-actions.spec.ts` — «Указать» и массовые действия на `SearchPicker` и `Popover` работают как раньше.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/client/components/Popover.tsx src/client/components/SearchPicker.tsx src/client/lib/operation-options.ts src/client/components/operation/ComboSelect.tsx src/client/components/operation/AmountField.tsx tests/client/operation-options.test.ts
git commit -m "feat: поле суммы с кнопками операторов и выпадающие списки с поиском для формы операции

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Форма новой операции — кнопки шапки, доход, расход, перевод, Enter и Esc, «Сохранить и создать похожий»

**Files:**
- Create: `src/client/components/operation/OperationFormHost.tsx`, `src/client/components/operation/OperationForm.tsx`, `e2e/operation-form.spec.ts`
- Modify: `src/client/components/Modal.tsx`, `src/client/components/AppHeader.tsx`, `src/client/pages/CompanyLayout.tsx`

**Interfaces:**
- Consumes: задачи 1–3; `Modal`, `Field`, `Pending`, `SearchPicker`, классы `ui.ts`; `api`, `ApiError`; `useMeta`; `useAccounts`, `useCategories`, `useProjects`, `useCounterparties`, `useTags` и типы `queries.ts`; `invalidateOperations` (план 5c); `todayInTimezone`, `getCurrency`.
- Produces:
  - `Modal`: свойство `onCancel?: () => void` — с ним Esc не закрывает окно сам;
  - `AppHeader`: свойство `actions?: ReactNode` (между левой и правой частью шапки, шапка переносится);
  - `OperationFormHost.tsx`: `type OperationFormRequest = { kind: 'create'; type: OperationType }` (план 6b добавит `edit`), `useOpenOperationForm(): (request) => void`, `OperationFormHost({ company, children })`, `NewOperationButtons()` — кнопки с именами «Доход», «Расход», «Перевод» (символы `+`, `−`, `⇄` скрыты от программ чтения с экрана);
  - `OperationForm.tsx`: `OperationForm({ company, request, onClose })` — окно «Новая операция», форма `aria-label="Операция"`; `interface FormData { accounts; categories; projects; counterparties; tags }`; `serverFieldErrors(fields)` (`lines.0.amount` → `lines`).

- [ ] **Step 1: Write the failing test**

`e2e/operation-form.spec.ts`:

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

const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
const form = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });

/** Открыть форму кнопкой шапки: «Доход», «Расход» или «Перевод». */
async function openForm(page: Page, button: 'Доход' | 'Расход' | 'Перевод') {
  await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
  await expect(form(page)).toBeVisible();
  return form(page);
}

/** Выбрать значение в выпадающем списке формы: кнопка «Подпись: …», затем пункт списка. */
async function pick(page: Page, label: string, option: string) {
  await form(page).getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(form(page).getByRole('button', { name: new RegExp(`^${label}: ${option.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
}

test('доход, расход и перевод KZT → USD через форму: выражение в сумме, курс перевода, балансы и журнал', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Форма ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });
  await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Выручка' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  // курс компании: доллары входят в «Всего на счетах»
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await page.reload();

  // доход: выражение вычисляется при уходе из поля, Enter в поле суммы сохраняет
  let dialog = await openForm(page, 'Доход');
  await expect(dialog.getByRole('radio', { name: 'Доход' })).toBeChecked();
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await pick(page, 'Счёт', 'Касса (KZT)');
  await pick(page, 'Статья', 'Выручка');
  await amount.fill('1 500 + 500');
  await amount.blur();
  await expect(amount).toHaveValue('2000');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(table(page).locator('tbody tr').filter({ hasText: 'Выручка' })).toContainText(/\+2\s000,00\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/3\s000,00\s₸/);

  // расход с комментарием из свёрнутого блока
  dialog = await openForm(page, 'Расход');
  await pick(page, 'Статья', 'Аренда');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('300');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByLabel('Комментарий').fill('за октябрь');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const rent = table(page).locator('tbody tr').filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('за октябрь');
  await expect(rent).toContainText(/300,00\s₸/);

  // перевод в другую валюту: «Сумма зачисления» и вычисленный курс
  dialog = await openForm(page, 'Перевод');
  await expect(dialog.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveCount(0);
  await pick(page, 'Со счёта', 'Касса (KZT)');
  await pick(page, 'На счёт', 'Валютный (USD)');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('500');
  await dialog.getByRole('textbox', { name: /^Сумма зачисления/ }).fill('1');
  await expect(dialog.getByText('Курс: 1 USD = 500 KZT')).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/2\s200,00\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/1,00\s\$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*2\s700,00\s₸/);
});

test('ошибки у полей, Esc с вопросом о несохранённом, «Сохранить и создать похожий», контрагенты под статью «Зарплата»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Похожий ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'ТОО Ромашка' });
  await apiPost(page, `${base}/counterparties`, { type: 'employee', name: 'Айгерим' });
  await page.reload();

  // пустая сумма и деление на ноль — ошибки у поля, окно остаётся открытым
  const dialog = await openForm(page, 'Расход');
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Введите сумму');
  await amount.fill('5/0');
  await amount.blur();
  await expect(dialog).toContainText('Деление на ноль');

  // Esc при несохранённых изменениях спрашивает; второй Esc — продолжить ввод
  await amount.fill('10');
  await amount.press('Escape');
  const question = dialog.getByRole('group', { name: 'Несохранённые изменения' });
  await expect(question).toBeVisible();
  await expect(question.getByRole('button', { name: 'Продолжить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toBeHidden();
  await expect(dialog).toBeVisible();
  // Esc внутри списка с поиском закрывает только список
  await dialog.getByRole('button', { name: /^Статья:/ }).click();
  await expect(dialog.getByRole('listbox', { name: 'Статьи' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox', { name: 'Статьи' })).toBeHidden();
  await expect(question).toBeHidden();
  await expect(dialog.getByRole('button', { name: /^Статья:/ })).toBeFocused();

  // «Зарплата» (системная статья): сначала сотрудники, затем остальные
  await pick(page, 'Статья', 'Зарплата');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  const people = dialog.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option');
  await expect(people).toHaveText(['Без контрагента', 'Айгерим', 'ТОО Ромашка']);
  await expect(dialog.getByRole('listbox', { name: 'Контрагенты' })).toContainText('Сотрудники');
  await page.keyboard.press('Escape');
  await pick(page, 'Статья', 'Аренда');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  await expect(people).toHaveText(['Без контрагента', 'ТОО Ромашка', 'Айгерим']);
  await page.keyboard.press('Escape');

  // «Сохранить и создать похожий»: статья и контрагент остаются, сумма и комментарий — нет
  await pick(page, 'Контрагент', 'ТОО Ромашка');
  await amount.fill('100');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByLabel('Комментарий').fill('первый');
  await dialog.getByRole('button', { name: 'Сохранить и создать похожий' }).click();
  await expect(dialog.getByRole('status')).toContainText('Операция сохранена');
  await expect(amount).toHaveValue('');
  await expect(amount).toBeFocused();
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Контрагент: ТОО Ромашка' })).toBeVisible();
  await amount.fill('200');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  const rows = table(page).locator('tbody tr').filter({ hasText: 'ТОО Ромашка' });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'первый' })).toContainText(/100,00/);
  await expect(rows.filter({ hasNotText: 'первый' })).toContainText(/200,00/);

  // без изменений Esc закрывает сразу; фокус возвращается на кнопку шапки
  await openForm(page, 'Доход');
  await page.keyboard.press('Escape');
  await expect(form(page)).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true })).toBeFocused();
});

test('ширина 390 px: форма на весь экран, сумма через кнопки-операторы (§10, сценарий 4)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  // на десктопе ряда операторов нет
  let dialog = await openForm(page, 'Расход');
  await expect(dialog.getByRole('group', { name: /^Операторы/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  dialog = await openForm(page, 'Расход');
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(box.height).toBeGreaterThanOrEqual(843);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await amount.click();
  await page.keyboard.type('1000');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  await expect(amount).toBeFocused();
  await page.keyboard.type('3');
  await dialog.getByRole('button', { name: 'Оператор минус' }).click();
  await page.keyboard.type('500');
  await expect(amount).toHaveValue('1000×3\u2212500');
  await amount.blur();
  await expect(amount).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(table(page).locator('tbody tr').first()).toContainText(/2\s500,00\s₸/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/operation-form.spec.ts`
Expected: FAIL — в шапке нет кнопки «Доход».

- [ ] **Step 3: Implement**

`src/client/components/Modal.tsx` — правки:

1. Найдите:

```tsx
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 */
export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
```

   замените на:

```tsx
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 * С `onCancel` окно по Esc само не закрывается: решает владелец (например, спрашивает про несохранённые изменения).
 */
export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  children: ReactNode;
  className?: string;
}) {
```

2. Найдите:

```tsx
      aria-labelledby={titleId}
      onClose={() => {
```

   замените на:

```tsx
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
        if (e.key !== 'Escape' || !props.onCancel || e.defaultPrevented) return;
        e.preventDefault();
        props.onCancel();
      }}
      onCancel={(e) => {
        if (!props.onCancel) return;
        e.preventDefault();
        props.onCancel();
      }}
      onClose={() => {
```

`src/client/components/AppHeader.tsx` — правки:

1. Найдите:

```tsx
export function AppHeader({ left, profileHref }: { left?: ReactNode; profileHref?: string }) {
```

   замените на:

```tsx
export function AppHeader({ left, actions, profileHref }: { left?: ReactNode; actions?: ReactNode; profileHref?: string }) {
```

2. Найдите:

```tsx
    <header className="flex items-center justify-between gap-4 px-6 py-4 text-white">
```

   замените на:

```tsx
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 text-white">
```

3. Найдите:

```tsx
        {left}
      </div>
```

   замените на:

```tsx
        {left}
      </div>
      {actions}
```

`src/client/components/operation/OperationFormHost.tsx`:

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа. */
export type OperationFormRequest = { kind: 'create'; type: OperationType };

const OpenContext = createContext<(request: OperationFormRequest) => void>(() => undefined);

/** Открыть форму операции из любого места страницы компании (кнопки шапки, журнал). */
export function useOpenOperationForm(): (request: OperationFormRequest) => void {
  return useContext(OpenContext);
}

/**
 * Форма операции на странице компании: одна на всю страницу, открывается кнопками «Доход», «Расход»,
 * «Перевод» в шапке. Каждое открытие — новая форма (key), закрытие возвращает фокус туда, откуда открыли.
 */
export function OperationFormHost(props: { company: Company; children: ReactNode }) {
  const [current, setCurrent] = useState<{ key: number; request: OperationFormRequest } | null>(null);
  const open = useCallback((request: OperationFormRequest) => setCurrent({ key: Date.now(), request }), []);
  return (
    <OpenContext.Provider value={open}>
      {props.children}
      {current && <OperationForm key={current.key} company={props.company} request={current.request} onClose={() => setCurrent(null)} />}
    </OpenContext.Provider>
  );
}

const BUTTONS: { type: OperationType; symbol: string; label: string; className: string }[] = [
  { type: 'income', symbol: '+', label: 'Доход', className: 'bg-income text-white' },
  { type: 'expense', symbol: '\u2212', label: 'Расход', className: 'bg-expense text-white' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', className: 'bg-chrome-2 text-white' },
];

/** Кнопки шапки «+ Доход», «- Расход», «⇄ Перевод» (§7 «Каркас»; у минуса — знак U+2212). */
export function NewOperationButtons() {
  const open = useOpenOperationForm();
  return (
    <div className="flex gap-2">
      {BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          aria-haspopup="dialog"
          onClick={() => open({ kind: 'create', type: b.type })}
          className={`rounded-xl px-3 py-2 text-sm font-semibold hover:brightness-110 ${b.className}`}
        >
          <span aria-hidden="true">{b.symbol}</span> {b.label}
        </button>
      ))}
    </div>
  );
}
```

`src/client/components/operation/OperationForm.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Link } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import type { OperationType } from '../../lib/journal-filter';
import { invalidateOperations } from '../../lib/journal-mutations';
import {
  buildBody,
  changeType,
  emptyDraft,
  positiveAmount,
  similarDraft,
  transferRateText,
  COMMENT_MAX,
  type OperationDraft,
} from '../../lib/operation-form';
import { accountOptions, categoryOptions, counterpartyOptions, preferredCounterpartyType, projectOptions, tagOptions } from '../../lib/operation-options';
import { useMeta } from '../../lib/query';
import {
  useAccounts,
  useCategories,
  useCounterparties,
  useProjects,
  useTags,
  type Account,
  type CategoryTree,
  type Company,
  type Counterparty,
  type Project,
  type Tag,
} from '../../lib/queries';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import { SearchPicker } from '../SearchPicker';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
import { AmountField } from './AmountField';
import { ComboSelect } from './ComboSelect';
import type { OperationFormRequest } from './OperationFormHost';

export interface FormData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
}

const TYPES: { type: OperationType; label: string }[] = [
  { type: 'income', label: 'Доход' },
  { type: 'expense', label: 'Расход' },
  { type: 'transfer', label: 'Перевод' },
];

/** Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7). */
const MODAL_CLASS = 'max-w-2xl max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none';

/** Ошибки полей из ответа сервера: `lines.0.amount` → `lines`, `tagIds.1` → `tagIds`. */
export function serverFieldErrors(fields: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields ?? {})) out[key.split('.')[0]!] ??= message;
  return out;
}

/**
 * Форма операции (§7): доход, расход, перевод. Окно открыто, пока форма смонтирована; закрытие — через
 * `<dialog>.close()`, чтобы фокус вернулся на кнопку, с которой форму открыли.
 */
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const cancel = useRef<() => void>(() => setOpen(false));
  const meta = useMeta();
  const accounts = useAccounts(props.company.id);
  const categories = useCategories(props.company.id);
  const projects = useProjects(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const tags = useTags(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags];
  const data: FormData | null =
    accounts.data && categories.data && projects.data && counterparties.data && tags.data
      ? { accounts: accounts.data, categories: categories.data, projects: projects.data, counterparties: counterparties.data, tags: tags.data }
      : null;

  return (
    <Modal open={open} title="Новая операция" onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS}>
      {data && meta.data ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.type}
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
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
  cancelRef: MutableRefObject<() => void>;
}) {
  const today = todayInTimezone(p.timeZone);
  const typeName = useId();
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const [initial, setInitial] = useState(() => emptyDraft(p.type, today, firstAccount));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [more, setMore] = useState(false);
  const [focusAmount, setFocusAmount] = useState(1);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  /** Вопрос о несохранённом: фокус на «Продолжить», после ответа — туда, где был. */
  const continueRef = useRef<HTMLButtonElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (confirmClose) continueRef.current?.focus();
    else focusBefore.current?.focus();
  }, [confirmClose]);

  // Esc: открыт вопрос — продолжить ввод; есть несохранённые изменения — спросить; иначе закрыть
  p.cancelRef.current = () => {
    if (confirmClose) setConfirmClose(false);
    else if (dirty) {
      focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else p.close();
  };

  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const account = draft.accountId === null ? undefined : accounts.get(draft.accountId);
  const toAccount = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId);
  const currency = getCurrency(account?.currency ?? p.company.baseCurrency);
  const toCurrency = toAccount ? getCurrency(toAccount.currency) : null;
  const transfer = draft.type === 'transfer';
  const crossCurrency = transfer && toCurrency !== null && toCurrency.code !== currency.code;
  const kind = draft.type === 'income' ? 'income' : 'expense';
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);

  /** Изменение полей: сбрасывает их ошибки и сообщение «сохранено». */
  const set = (patch: Partial<OperationDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
    if (errorKeys.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k))));
  };

  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
    const now = new Date();
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom: now });
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
      await api(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body });
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      const next = similarDraft(draft);
      setDraft(next);
      setInitial(next);
      setStatus('Операция сохранена — можно ввести похожую');
      setFocusAmount((n) => n + 1);
    } catch (e) {
      setErrors(serverFieldErrors(e instanceof ApiError ? e.fields : undefined));
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit('close');
  };

  if (activeAccounts.length === 0) {
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
      placeholder="Выберите счёт"
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Операция" className="grid gap-4">
      <fieldset>
        <legend className="sr-only">Тип операции</legend>
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-field p-1">
          {TYPES.map((t) => (
            <label
              key={t.type}
              className="relative cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-muted has-[:checked]:bg-card has-[:checked]:text-ink has-[:checked]:shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
            >
              <input
                type="radio"
                name={typeName}
                value={t.type}
                checked={draft.type === t.type}
                onChange={() => {
                  setDraft((d) => changeType(d, t.type));
                  setErrors({});
                }}
                // поверх подписи и прозрачная: нажатие попадает в саму радиокнопку
                className="absolute inset-0 cursor-pointer appearance-none rounded-lg opacity-0"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        {accountField(transfer ? 'Со счёта' : 'Счёт', 'accountId')}
        {transfer && accountField('На счёт', 'toAccountId')}
        <AmountField
          label={`Сумма, ${currency.symbol}`}
          value={draft.amount}
          onChange={(amount) => set({ amount }, 'amount')}
          minorUnits={currency.minorUnits}
          error={errors.amount}
          focusSignal={focusAmount}
        />
        {crossCurrency && toCurrency && (
          <AmountField
            label={`Сумма зачисления, ${toCurrency.symbol}`}
            value={draft.toAmount}
            onChange={(toAmount) => set({ toAmount }, 'toAmount')}
            minorUnits={toCurrency.minorUnits}
            error={errors.toAmount}
            hint={rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits)}
          />
        )}
      </div>

      {!transfer && (
        <div className="grid gap-4 md:grid-cols-2">
          <ComboSelect
            label="Статья"
            listLabel="Статьи"
            value={draft.categoryId}
            options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
            emptyLabel="Без статьи"
            onChange={(categoryId) => set({ categoryId }, 'lines')}
            error={errors.lines}
          />
          <ComboSelect
            label="Контрагент"
            listLabel="Контрагенты"
            value={draft.counterpartyId}
            options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, draft.categoryId))}
            emptyLabel="Без контрагента"
            onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
            error={errors.counterpartyId}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={transfer ? 'Дата' : 'Дата оплаты'} error={errors.paidAt}>
          {(c) => (
            <input {...c} type="date" max={today} value={draft.paidDate} onChange={(e) => set({ paidDate: e.target.value }, 'paidAt')} className={inputClass} />
          )}
        </Field>
        {!transfer && (
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm md:pt-7">
              <input type="checkbox" checked={draft.accrualOn} onChange={(e) => set({ accrualOn: e.target.checked }, 'accrualDate')} />
              Дата сделки отличается
            </label>
            {draft.accrualOn && (
              <Field label="Дата сделки" error={errors.accrualDate}>
                {(c) => (
                  <input {...c} type="date" value={draft.accrualDate} onChange={(e) => set({ accrualDate: e.target.value }, 'accrualDate')} className={inputClass} />
                )}
              </Field>
            )}
          </div>
        )}
      </div>

      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="text-sm font-semibold text-muted hover:text-ink">
          <span aria-hidden="true">{more ? '▾' : '▸'}</span> Проект, теги, комментарий
        </button>
        {more && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <ComboSelect
              label="Проект"
              listLabel="Проекты"
              value={draft.projectId}
              options={projectOptions(p.data.projects, [draft.projectId])}
              emptyLabel="Без проекта"
              onChange={(projectId) => set({ projectId }, 'lines')}
              error={transfer ? errors.lines : undefined}
            />
            <TagsField tags={p.data.tags} value={draft.tagIds} onChange={(tagIds) => set({ tagIds }, 'tagIds')} error={errors.tagIds} />
            <Field label="Комментарий" error={errors.comment} className="md:col-span-2">
              {(c) => (
                <textarea {...c} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={inputClass} />
              )}
            </Field>
          </div>
        )}
      </div>

      {formError && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {formError}
        </p>
      )}
      {status && (
        <p role="status" className="rounded-xl bg-income-soft px-4 py-3 text-sm text-income">
          {status}
        </p>
      )}

      {confirmClose ? (
        <div role="group" aria-label="Несохранённые изменения" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Есть несохранённые изменения. Закрыть без сохранения?</span>
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть без сохранения
          </button>
          <button type="button" ref={continueRef} onClick={() => setConfirmClose(false)} className={btnPrimary}>
            Продолжить
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" disabled={pending} onClick={() => void submit('similar')} className={btnSecondary}>
            Сохранить и создать похожий
          </button>
          <button type="button" onClick={() => p.cancelRef.current()} className={btnSecondary}>
            Отмена
          </button>
        </div>
      )}
    </form>
  );
}

/** Подсказка у «Суммы зачисления»: курс из двух сумм, когда обе введены. */
function rateHint(draft: OperationDraft, from: string, fromMinor: number, to: string, toMinor: number): string | undefined {
  const a = positiveAmount(draft.amount, fromMinor);
  const b = positiveAmount(draft.toAmount, toMinor);
  const text = a.ok && b.ok ? transferRateText(a.minor, from, b.minor, to) : null;
  return text ? `Курс: ${text}` : undefined;
}

/** Теги операции: выбранные — с кнопкой «убрать», добавление — список с поиском. */
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; error?: string }) {
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
        <SearchPicker label="+ Тег" ariaLabel="Добавить тег" listLabel="Теги" options={options} onPick={(id) => props.onChange([...props.value, id])} buttonClassName={btnSmall} />
      </div>
      {props.error && <span className="mt-1 block text-sm text-expense">{props.error}</span>}
    </div>
  );
}
```

`src/client/pages/CompanyLayout.tsx` — правки:

1. Найдите:

```tsx
import { LoadError } from '../components/LoadError';
```

   замените на:

```tsx
import { LoadError } from '../components/LoadError';
import { NewOperationButtons, OperationFormHost } from '../components/operation/OperationFormHost';
```

2. Замените весь `return (…)` компонента `CompanyLayout` (от `return (` до `);` перед последней `}` файла) на:

```tsx
  return (
    <OperationFormHost company={company}>
      <div className="min-h-dvh bg-chrome">
        <AppHeader
          left={<CompanySwitcher current={company} companies={companies.data} />}
          actions={<NewOperationButtons />}
          profileHref={`/c/${company.id}/settings/profile`}
        />
        <div className="mx-4 flex items-start gap-4">
          <AccountsPanel company={company} />
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-6 md:p-8">
            <nav className="mb-6 flex gap-2">
              <NavLink to={`/c/${company.id}/log`} className={tab}>
                Журнал
              </NavLink>
              <NavLink to={`/c/${company.id}/settings`} className={tab}>
                Настройки
              </NavLink>
            </nav>
            <Outlet context={{ company } satisfies CompanyOutletContext} />
          </main>
        </div>
      </div>
    </OperationFormHost>
  );
```

Проверка экранирований:

```bash
node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212\u200b]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/client/components/operation/OperationFormHost.tsx src/client/components/operation/OperationForm.tsx e2e/operation-form.spec.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/operation-form.spec.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/Modal.tsx src/client/components/AppHeader.tsx src/client/pages/CompanyLayout.tsx src/client/components/operation/OperationFormHost.tsx src/client/components/operation/OperationForm.tsx e2e/operation-form.spec.ts
git commit -m "feat: форма операции — доход, расход и перевод из шапки; Enter, Esc, «Сохранить и создать похожий»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: «Разделить» — строки суммами и в процентах, шаблоны разделения

**Files:**
- Create: `src/client/lib/split.ts`, `src/client/components/operation/SplitEditor.tsx`, `tests/client/split.test.ts`
- Modify: `src/client/lib/operation-form.ts`, `src/client/components/operation/OperationForm.tsx`, `tests/client/operation-form.test.ts`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Consumes: `evaluateAmount` (задача 1); `allocate` (`money.ts`); `formatBp`, `parsePercentToBp` (`percent.ts`); `SPLIT_TOTAL_BP` (`schemas/split-presets.ts`); `pluralRu` (`journal-format.ts`); `useSplitPresets`, `SplitPreset` (`queries.ts`); `ComboSelect`, `AmountField`, `categoryOptions`, `projectOptions` (задача 3); API шаблонов разделения плана 3a (`POST /companies/:cid/split-presets` — `{ name, lines: [{ categoryId, projectId, bp }] }`).
- Produces:
  - `split.ts`: `SplitMode = 'amount' | 'percent'`, `interface SplitLineDraft { key; categoryId; projectId; value }`, `interface SplitDraft { mode; lines }`, `SPLIT_MAX_LINES = 50`, `newLine(patch?)`, `startSplit(categoryId, projectId, amountText)`, `interface SplitResult { amounts; errors; left; ok }`, `splitResult(split, total: number | null, minorUnits)`, `splitLines(split, result)`, `similarSplit(split)`, `interface PresetLine { categoryId; projectId; bp }`, `interface PresetContext`, `presetContext(tree, projects, kind)`, `applyPreset(lines, ctx): { split: SplitDraft | null; dropped: number }`, `droppedText(n)`, `presetFromSplit(split, result): { ok: true; lines } | { ok: false; error }`;
  - `OperationDraft.split: SplitDraft | null` (`emptyDraft` — `null`; `changeType` сбрасывает; `similarDraft` — `similarSplit`; `buildBody` — строки разбиения, ошибка `lines`, если остаток не 0);
  - `SplitEditor({ companyId, kind, value, onChange, onCancel, total, currency, minorUnits, categories, projects, presets, error? })` — `section` «Разбиение», строки — группы «Строка N», поля «Статья», «Проект», «Сумма» или «Доля, %», кнопки «Убрать строку N», «+ Строка», «Применить шаблон», «Сохранить как шаблон», «Отменить разбиение»; `FormData.presets`.

- [ ] **Step 1: Write the failing tests**

`tests/client/split.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';
import {
  applyPreset,
  droppedText,
  newLine,
  presetContext,
  presetFromSplit,
  similarSplit,
  splitLines,
  splitResult,
  startSplit,
  type SplitDraft,
} from '../../src/client/lib/split';

const lines = (mode: SplitDraft['mode'], ...values: string[]): SplitDraft => ({
  mode,
  lines: values.map((value, i) => newLine({ categoryId: 10 + i, projectId: null, value })),
});
const strip = (s: SplitDraft | null) => s && { mode: s.mode, lines: s.lines.map(({ categoryId, projectId, value }) => ({ categoryId, projectId, value })) };

const node = (id: number, kind: 'income' | 'expense', archivedAt: string | null = null, children: CategoryNode[] = []): CategoryNode => ({
  id,
  companyId: 1,
  kind,
  parentId: null,
  name: `c${id}`,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt,
  children,
});

describe('splitResult — строки разбиения и нераспределённый остаток', () => {
  it('суммами: выражения в строках, остаток и готовность', () => {
    const r = splitResult(lines('amount', '600', '300+100'), 100000, 2);
    expect(r).toEqual({ amounts: [60000, 40000], errors: [null, null], left: 0, ok: true });
    expect(splitResult(lines('amount', '600', '300'), 100000, 2)).toMatchObject({ left: 10000, ok: false });
    expect(splitResult(lines('amount', '600', '500'), 100000, 2)).toMatchObject({ left: -10000, ok: false });
    expect(splitResult(lines('amount', '600', ''), 100000, 2)).toMatchObject({ errors: [null, 'Введите сумму'], left: 40000, ok: false });
    expect(splitResult(lines('amount', '1000', '0'), 100000, 2).errors[1]).toBe('Сумма больше нуля');
    expect(splitResult(lines('amount', '1000', '1/0'), 100000, 2).errors[1]).toBe('Деление на ноль');
    expect(splitResult(lines('amount', '600', '400'), null, 2)).toMatchObject({ left: null, ok: false });
  });

  it('в процентах: доли переводятся в суммы методом наибольшего остатка, сумма строк равна сумме операции', () => {
    const r = splitResult(lines('percent', '33,33', '33,33', '33,34'), 100, 2);
    expect(r.ok).toBe(true);
    expect(r.amounts).toEqual([33, 33, 34]);
    const thirds = splitResult(lines('percent', '50', '25', '25'), 1001, 2);
    expect(thirds.amounts).toEqual([501, 250, 250]);
    expect(thirds.amounts.reduce((s, a) => s! + a!, 0)).toBe(1001);
    expect(splitResult(lines('percent', '70', '20'), 100000, 2)).toMatchObject({ left: 1000, ok: false });
    expect(splitResult(lines('percent', '70', 'abc'), 100000, 2).errors[1]).toBe('Введите долю, например 25 или 12,5');
    expect(splitResult(lines('percent', '100', '0'), 100000, 2).errors[1]).toBe('Доля больше 0');
    // 1 тиын на 99,99 % и 0,01 %: вторая строка получила бы 0
    expect(splitResult(lines('percent', '99,99', '0,01'), 1, 2)).toMatchObject({ amounts: [1, 0], ok: false, errors: [null, 'Слишком маленькая доля для этой суммы'] });
    expect(splitResult(lines('percent', '60', '40'), null, 2)).toMatchObject({ left: 0, ok: false });
  });

  it('splitLines, startSplit, similarSplit', () => {
    const s = lines('percent', '75', '25');
    expect(splitLines(s, splitResult(s, 1000, 2))).toEqual([
      { categoryId: 10, projectId: null, amount: 750 },
      { categoryId: 11, projectId: null, amount: 250 },
    ]);
    expect(strip(startSplit(7, 8, '1500'))).toEqual({
      mode: 'amount',
      lines: [
        { categoryId: 7, projectId: 8, value: '1500' },
        { categoryId: null, projectId: null, value: '' },
      ],
    });
    expect(similarSplit(s)).toBe(s);
    expect(strip(similarSplit(lines('amount', '1', '2')))!.lines.map((l) => l.value)).toEqual(['', '']);
  });
});

describe('шаблоны разделения', () => {
  const tree: CategoryTree = {
    income: [node(1, 'income')],
    expense: [node(10, 'expense'), node(11, 'expense', '2026-10-01T00:00:00Z'), node(12, 'expense', '2026-10-01T00:00:00Z', [node(13, 'expense')])],
  };
  const ctx = presetContext(tree, [{ id: 5, archivedAt: null }, { id: 6, archivedAt: '2026-10-01T00:00:00Z' }], 'expense');

  it('применение: недоступные элементы отбрасываются и считаются (инвариант 10); строка без статьи и проекта не применяется', () => {
    const r = applyPreset(
      [
        { categoryId: 10, projectId: 5, bp: 5000 },
        { categoryId: 11, projectId: 5, bp: 2000 }, // статья в архиве — остаётся проект
        { categoryId: 13, projectId: 6, bp: 2000 }, // дочерняя архивной и архивный проект — строки нет
        { categoryId: 1, projectId: null, bp: 500 }, // статья доходов в расходе
        { categoryId: 99, projectId: null, bp: 500 }, // удалённая статья
      ],
      ctx,
    );
    expect(r.dropped).toBe(5);
    expect(strip(r.split)).toEqual({
      mode: 'percent',
      lines: [
        { categoryId: 10, projectId: 5, value: '50' },
        { categoryId: null, projectId: 5, value: '20' },
      ],
    });
    expect(splitResult(r.split!, 1000, 2).left).toBe(3000);
    expect(applyPreset([{ categoryId: 11, projectId: null, bp: 10000 }], ctx)).toEqual({ split: null, dropped: 1 });
    expect(droppedText(1)).toBe('1 элемент недоступен');
    expect(droppedText(3)).toBe('3 элемента недоступны');
    expect(droppedText(5)).toBe('5 элементов недоступно');
  });

  it('сохранение: доли из процентов как есть, из сумм — наибольшим остатком до ровно 100 %', () => {
    const p = lines('percent', '33,33', '66,67');
    expect(presetFromSplit(p, splitResult(p, 100, 2))).toEqual({
      ok: true,
      lines: [
        { categoryId: 10, projectId: null, bp: 3333 },
        { categoryId: 11, projectId: null, bp: 6667 },
      ],
    });
    const a = lines('amount', '1', '1', '1');
    const saved = presetFromSplit(a, splitResult(a, 300, 2));
    expect(saved.ok && saved.lines.map((l) => l.bp)).toEqual([3334, 3333, 3333]);
    expect(presetFromSplit(lines('percent', '50', '40'), splitResult(lines('percent', '50', '40'), 100, 2))).toEqual({ ok: false, error: 'Распределите 100 %' });
    const empty: SplitDraft = { mode: 'percent', lines: [newLine({ value: '100' })] };
    expect(presetFromSplit(empty, splitResult(empty, 100, 2))).toEqual({ ok: false, error: 'В каждой строке укажите статью или проект' });
  });
});
```

`tests/client/operation-form.test.ts` — правки:

1. Найдите:

```ts
} from '../../src/client/lib/operation-form';
```

   замените на:

```ts
} from '../../src/client/lib/operation-form';
import { newLine } from '../../src/client/lib/split';
```

2. Найдите:

```ts
describe('changeType, similarDraft, transferRateText', () => {
```

   замените на:

```ts
describe('buildBody — разбиение', () => {
  const split = (mode: 'amount' | 'percent', ...values: string[]) => ({
    mode,
    lines: values.map((value, i) => newLine({ categoryId: 7 + i, projectId: i === 0 ? 8 : null, value })),
  });

  it('строки разбиения вместо статьи и проекта; проценты — наибольшим остатком', () => {
    expect(body(draft({ amount: '1000', categoryId: 99, split: split('amount', '600', '400') })).lines).toEqual([
      { categoryId: 7, projectId: 8, amount: 60000 },
      { categoryId: 8, projectId: null, amount: 40000 },
    ]);
    expect(body(draft({ amount: '1', split: split('percent', '33,33', '33,33', '33,34') })).lines.map((l) => l.amount)).toEqual([33, 33, 34]);
  });

  it('сохранить можно, только когда остаток равен 0; у перевода разбиения нет', () => {
    expect(errors(draft({ amount: '1000', split: split('amount', '600', '300') }))).toEqual({ lines: 'Распределите всю сумму: остаток должен быть 0' });
    expect(errors(draft({ amount: '1000', split: split('amount', '600', '0', '400') }))).toEqual({ lines: 'Проверьте строки разбиения' });
    expect(errors(draft({ amount: '', split: split('amount', '600', '400') }))).toEqual({ amount: 'Введите сумму' });
    const t = draft({ type: 'transfer', toAccountId: 2, amount: '10', split: split('amount', '5', '5') });
    expect(body(t).lines).toEqual([]);
  });
});

describe('changeType, similarDraft, transferRateText', () => {
```

3. Найдите:

```ts
    const d = draft({ amount: '5', toAmount: '6', comment: 'к', categoryId: 7, tagIds: [1], paidDate: '2026-10-01' });
    expect(similarDraft(d)).toEqual({ ...d, amount: '', toAmount: '', comment: '' });
```

   замените на:

```ts
    const d = draft({ amount: '5', toAmount: '6', comment: 'к', categoryId: 7, tagIds: [1], paidDate: '2026-10-01' });
    expect(similarDraft(d)).toEqual({ ...d, amount: '', toAmount: '', comment: '' });
    const percent = { mode: 'percent' as const, lines: [newLine({ categoryId: 7, value: '60' }), newLine({ categoryId: 8, value: '40' })] };
    expect(similarDraft(draft({ split: percent })).split).toBe(percent);
    const amounts = { mode: 'amount' as const, lines: [newLine({ categoryId: 7, value: '60' })] };
    expect(similarDraft(draft({ split: amounts })).split!.lines[0]).toMatchObject({ categoryId: 7, value: '' });
    expect(changeType(draft({ split: amounts }), 'income').split).toBeNull();
```

`e2e/operation-form.spec.ts` — правки:

1. Найдите:

```ts
/** Выбрать значение в выпадающем списке формы: кнопка «Подпись: …», затем пункт списка. */
async function pick(page: Page, label: string, option: string) {
  await form(page).getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(form(page).getByRole('button', { name: new RegExp(`^${label}: ${option.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
}
```

   замените на:

```ts
/** Выбрать значение в выпадающем списке формы: кнопка «Подпись: …», затем пункт списка (список — в окне формы). */
async function pick(page: Page, label: string, option: string, scope: Locator = form(page)) {
  await scope.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('button', { name: new RegExp(`^${label}: ${option.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
}
```

2. Найдите:

```ts
import { expect, test, type Page } from '@playwright/test';
```

   замените на:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
```

и в конец файла:

```ts
test('«Разделить» в процентах на два проекта; шаблон разделения: применить с недоступной статьёй, сохранить текущее', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разбиение ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const north = (await apiPost(page, `${base}/projects`, { name: 'Север', templateKey: 'general' })).project.id;
  const south = (await apiPost(page, `${base}/projects`, { name: 'Юг', templateKey: 'general' })).project.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const light = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Свет' })).category.id;
  await apiPost(page, `${base}/split-presets`, {
    name: 'Север и Юг',
    lines: [
      { categoryId: rent, projectId: north, bp: 7000 },
      { categoryId: light, projectId: south, bp: 3000 },
    ],
  });
  await apiPost(page, `${base}/categories/${light}/archive`, {});
  await page.reload();

  // проценты: остаток виден, сохранить можно только при 0
  let dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('1000');
  await dialog.getByRole('button', { name: 'Разделить', exact: true }).click();
  const split = dialog.getByRole('region', { name: 'Разбиение' });
  await split.getByRole('radio', { name: 'В процентах' }).check();
  const line1 = split.getByRole('group', { name: 'Строка 1' });
  const line2 = split.getByRole('group', { name: 'Строка 2' });
  await pick(page, 'Статья', 'Аренда', line1);
  await pick(page, 'Проект', 'Север', line1);
  await line1.getByLabel('Доля, %').fill('60');
  await pick(page, 'Статья', 'Аренда', line2);
  await pick(page, 'Проект', 'Юг', line2);
  await line2.getByLabel('Доля, %').fill('30');
  await expect(split.getByRole('status').first()).toHaveText('Не распределено: 10 %');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(split).toContainText('Распределите всю сумму');
  await expect(dialog).toBeVisible();
  await line2.getByLabel('Доля, %').fill('40');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');
  await expect(line1).toContainText(/= 600,00\s₸/);
  await expect(line2).toContainText(/= 400,00\s₸/);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText('Аренда');
  await expect(row).toContainText('2 проекта');
  await expect(row).toContainText(/1\s000,00\s₸/);

  // шаблон: статья «Свет» в архиве — отброшена с предупреждением, её строка остаётся с проектом
  dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Разделить', exact: true }).click();
  await split.getByRole('button', { name: 'Применить шаблон' }).click();
  await dialog.getByRole('option', { name: 'Север и Юг' }).click();
  await expect(split).toContainText('Шаблон «Север и Юг»: 1 элемент недоступен');
  await expect(line1.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  await expect(line1.getByRole('button', { name: 'Проект: Север' })).toBeVisible();
  await expect(line1.getByLabel('Доля, %')).toHaveValue('70');
  await expect(line2.getByRole('button', { name: 'Статья: Без статьи' })).toBeVisible();
  await expect(line2.getByRole('button', { name: 'Проект: Юг' })).toBeVisible();
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');

  // текущее разбиение — новым шаблоном
  await split.getByRole('button', { name: 'Сохранить как шаблон' }).click();
  await split.getByLabel('Название шаблона').fill('Без света');
  await split.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(split).toContainText('Шаблон «Без света» сохранён.');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const presets = (await (await page.request.get(`${base}/split-presets`)).json()).splitPresets as { name: string; lines: unknown[] }[];
  expect(presets.find((p) => p.name === 'Без света')!.lines).toEqual([
    { categoryId: rent, projectId: north, bp: 7000 },
    { categoryId: null, projectId: south, bp: 3000 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/split.test.ts tests/client/operation-form.test.ts`
Expected: FAIL — модуля `split` нет.

- [ ] **Step 3: Implement**

`src/client/lib/split.ts`:

```ts
import { evaluateAmount } from '../../shared/calc';
import { allocate } from '../../shared/money';
import { formatBp, parsePercentToBp } from '../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../shared/schemas/split-presets';
import { pluralRu } from './journal-format';
import type { CategoryTree } from './queries';

/**
 * «Разделить» (§7): строки «статья, проект, сумма или %». Суммы строк — текст поля (выражение калькулятора),
 * доли — проценты с двумя знаками; проценты переводятся в суммы методом наибольшего остатка (§4.1, `allocate`).
 */
export type SplitMode = 'amount' | 'percent';

export interface SplitLineDraft {
  /** Ключ строки для React: строки добавляются и удаляются. */
  key: number;
  categoryId: number | null;
  projectId: number | null;
  /** Сумма (в режиме «суммами») или доля в процентах (в режиме «в процентах»). */
  value: string;
}

export interface SplitDraft {
  mode: SplitMode;
  lines: SplitLineDraft[];
}

/** Не больше строк у операции (`operationCreateSchema`). */
export const SPLIT_MAX_LINES = 50;

let lastKey = 0;
export function newLine(patch: Partial<Omit<SplitLineDraft, 'key'>> = {}): SplitLineDraft {
  lastKey += 1;
  return { key: lastKey, categoryId: null, projectId: null, value: '', ...patch };
}

/** Начать разбиение: первая строка — текущие статья, проект и вся сумма, вторая — пустая. */
export function startSplit(categoryId: number | null, projectId: number | null, amountText: string): SplitDraft {
  return { mode: 'amount', lines: [newLine({ categoryId, projectId, value: amountText }), newLine()] };
}

export interface SplitResult {
  /** Суммы строк в минимальных единицах; null — значение строки не разобрать. */
  amounts: (number | null)[];
  /** Ошибки строк (по порядку); null — строка в порядке или пустая. */
  errors: (string | null)[];
  /**
   * Нераспределённый остаток: в режиме «суммами» — минимальные единицы (отрицательный — распределено больше),
   * «в процентах» — сотые доли процента. null — общая сумма ещё не введена (в режиме «суммами»).
   */
  left: number | null;
  /** Все строки заполнены верно и остаток равен 0 — разбиение можно сохранить. */
  ok: boolean;
}

/** Строки разбиения при общей сумме total (null — сумма не введена или с ошибкой). */
export function splitResult(split: SplitDraft, total: number | null, minorUnits: number): SplitResult {
  if (split.mode === 'amount') {
    const parsed = split.lines.map((l) => (l.value.trim() === '' ? null : evaluateAmount(l.value, minorUnits)));
    const errors = parsed.map((r) => (r === null ? 'Введите сумму' : !r.ok ? r.error : r.minor <= 0 ? 'Сумма больше нуля' : null));
    const amounts = parsed.map((r, i) => (r?.ok && errors[i] === null ? r.minor : null));
    const sum = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
    const left = total === null ? null : total - sum;
    return { amounts, errors, left, ok: left === 0 && errors.every((e) => e === null) };
  }
  const bps = split.lines.map((l) => parsePercentToBp(l.value));
  const errors: (string | null)[] = bps.map((bp) => (bp === null ? 'Введите долю, например 25 или 12,5' : bp <= 0 ? 'Доля больше 0' : null));
  const left = SPLIT_TOTAL_BP - bps.reduce<number>((s, bp) => s + (bp ?? 0), 0);
  let amounts: (number | null)[] = split.lines.map(() => null);
  if (left === 0 && !errors.some((e) => e !== null) && total !== null && total > 0) {
    amounts = allocate(total, bps as number[]);
    amounts.forEach((a, i) => {
      if (a === 0) errors[i] = 'Слишком маленькая доля для этой суммы';
    });
  }
  return { amounts, errors, left, ok: left === 0 && total !== null && errors.every((e) => e === null) };
}

/** Строки тела запроса из разбиения, которое можно сохранить (`splitResult(...).ok`). */
export function splitLines(split: SplitDraft, result: SplitResult): { categoryId: number | null; projectId: number | null; amount: number }[] {
  return split.lines.map((l, i) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: result.amounts[i]! }));
}

/** «Сохранить и создать похожий»: суммы строк очищаются, доли в процентах остаются. */
export function similarSplit(split: SplitDraft): SplitDraft {
  return split.mode === 'percent' ? split : { ...split, lines: split.lines.map((l) => ({ ...l, value: '' })) };
}

export interface PresetLine {
  categoryId: number | null;
  projectId: number | null;
  bp: number;
}

/** Доступность элементов для шаблона: статья — вид и архив (дочерняя архивного родителя тоже в архиве), проект — архив. */
export interface PresetContext {
  categories: ReadonlyMap<number, { kind: 'income' | 'expense'; archived: boolean }>;
  projects: ReadonlyMap<number, { archived: boolean }>;
  kind: 'income' | 'expense';
}

export function presetContext(tree: CategoryTree, projects: readonly { id: number; archivedAt: string | null }[], kind: 'income' | 'expense'): PresetContext {
  const categories = new Map<number, { kind: 'income' | 'expense'; archived: boolean }>();
  for (const n of [...tree.income, ...tree.expense]) {
    categories.set(n.id, { kind: n.kind, archived: n.archivedAt !== null });
    for (const c of n.children) categories.set(c.id, { kind: c.kind, archived: c.archivedAt !== null || n.archivedAt !== null });
  }
  return { categories, projects: new Map(projects.map((p) => [p.id, { archived: p.archivedAt !== null }])), kind };
}

/**
 * Применение шаблона разделения (инвариант 10): удалённые, архивные статьи и проекты, а также статьи другого вида
 * отбрасываются (`dropped` — сколько); строка без статьи и проекта не применяется, её доля остаётся
 * нераспределённой. Не осталось строк — шаблон не применяется (`split: null`).
 */
export function applyPreset(lines: readonly PresetLine[], ctx: PresetContext): { split: SplitDraft | null; dropped: number } {
  let dropped = 0;
  const kept: SplitLineDraft[] = [];
  for (const l of lines) {
    const cat = l.categoryId === null ? undefined : ctx.categories.get(l.categoryId);
    const categoryOk = l.categoryId !== null && !!cat && !cat.archived && cat.kind === ctx.kind;
    const proj = l.projectId === null ? undefined : ctx.projects.get(l.projectId);
    const projectOk = l.projectId !== null && !!proj && !proj.archived;
    if (l.categoryId !== null && !categoryOk) dropped++;
    if (l.projectId !== null && !projectOk) dropped++;
    if (!categoryOk && !projectOk) continue;
    kept.push(newLine({ categoryId: categoryOk ? l.categoryId : null, projectId: projectOk ? l.projectId : null, value: formatBp(l.bp) }));
  }
  return { split: kept.length > 0 ? { mode: 'percent', lines: kept } : null, dropped };
}

/** «1 элемент недоступен», «2 элемента недоступны», «5 элементов недоступно». */
export function droppedText(n: number): string {
  return `${n} ${pluralRu(n, 'элемент недоступен', 'элемента недоступны', 'элементов недоступно')}`;
}

/**
 * «Сохранить как шаблон»: доли строк в сотых долях процента. Разбиение в суммах переводится в доли методом
 * наибольшего остатка; сумма долей — ровно 100 %.
 */
export function presetFromSplit(split: SplitDraft, result: SplitResult): { ok: true; lines: PresetLine[] } | { ok: false; error: string } {
  if (split.lines.some((l) => l.categoryId === null && l.projectId === null)) return { ok: false, error: 'В каждой строке укажите статью или проект' };
  let bps: number[];
  if (split.mode === 'percent') {
    if (result.left !== 0 || result.errors.some((e) => e !== null && e !== 'Слишком маленькая доля для этой суммы')) {
      return { ok: false, error: 'Распределите 100 %' };
    }
    bps = split.lines.map((l) => parsePercentToBp(l.value)!);
  } else {
    if (result.amounts.some((a) => a === null)) return { ok: false, error: 'Заполните суммы строк' };
    bps = allocate(SPLIT_TOTAL_BP, result.amounts as number[]);
    if (bps.some((bp) => bp === 0)) return { ok: false, error: 'Строка меньше 0,01 % — для шаблона слишком мала' };
  }
  return { ok: true, lines: split.lines.map((l, i) => ({ categoryId: l.categoryId, projectId: l.projectId, bp: bps[i]! })) };
}
```

`src/client/lib/operation-form.ts` — правки:

1. Найдите:

```ts
import type { OperationType } from './journal-filter';
```

   замените на:

```ts
import type { OperationType } from './journal-filter';
import { similarSplit, splitLines, splitResult, type SplitDraft } from './split';
```

2. Найдите:

```ts
  tagIds: number[];
  comment: string;
}

/** Тело POST
```

   замените на:

```ts
  tagIds: number[];
  comment: string;
  /** «Разделить» (только доход и расход): строки вместо статьи и проекта. null — без разбиения. */
  split: SplitDraft | null;
}

/** Тело POST
```

3. Найдите:

```ts
    tagIds: [],
    comment: '',
  };
}
```

   замените на:

```ts
    tagIds: [],
    comment: '',
    split: null,
  };
}
```

4. Найдите:

```ts
    categoryId: null,
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
```

   замените на:

```ts
    categoryId: null,
    split: null,
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
```

5. Найдите:

```ts
/** «Сохранить и создать похожий» (§7): те же значения, кроме суммы, комментария и файлов. */
export function similarDraft(draft: OperationDraft): OperationDraft {
  return { ...draft, amount: '', toAmount: '', comment: '' };
}
```

   замените на:

```ts
/** «Сохранить и создать похожий» (§7): те же значения, кроме суммы, комментария и файлов (суммы строк разбиения — тоже). */
export function similarDraft(draft: OperationDraft): OperationDraft {
  return { ...draft, amount: '', toAmount: '', comment: '', split: draft.split && similarSplit(draft.split) };
}
```

6. Найдите:

```ts
  let amount = 0;
  if (account) {
    const r = positiveAmount(draft.amount, getCurrency(account.currency).minorUnits);
    if (r.ok) amount = r.minor;
    else errors.amount = r.error;
  }
```

   замените на:

```ts
  let amount = 0;
  if (account) {
    const r = positiveAmount(draft.amount, getCurrency(account.currency).minorUnits);
    if (r.ok) amount = r.minor;
    else errors.amount = r.error;
  }

  // разбиение: сохранить можно, только когда остаток равен 0 (§7)
  const split = draft.type !== 'transfer' && draft.split ? draft.split : null;
  const result = split && account ? splitResult(split, errors.amount ? null : amount, getCurrency(account.currency).minorUnits) : null;
  if (split && result && !errors.amount && !result.ok) {
    errors.lines = result.left !== 0 ? 'Распределите всю сумму: остаток должен быть 0' : 'Проверьте строки разбиения';
  }
```

7. Найдите:

```ts
      // у перевода строка только с проектом (§4.5); у дохода и расхода — одна строка на всю сумму
      lines: transfer
        ? draft.projectId === null
          ? []
          : [{ categoryId: null, projectId: draft.projectId, amount }]
        : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
```

   замените на:

```ts
      // у перевода строка только с проектом (§4.5); у дохода и расхода — строки разбиения или одна на всю сумму
      lines: transfer
        ? draft.projectId === null
          ? []
          : [{ categoryId: null, projectId: draft.projectId, amount }]
        : split && result
          ? splitLines(split, result)
          : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
```

`src/client/components/operation/SplitEditor.tsx`:

```tsx
import { useId, useState } from 'react';
import { formatBp } from '../../../shared/percent';
import { formatMoney } from '../../../shared/money';
import { api, ApiError } from '../../lib/api';
import { categoryOptions, projectOptions } from '../../lib/operation-options';
import { queryClient } from '../../lib/query';
import type { CategoryTree, Project, SplitPreset } from '../../lib/queries';
import {
  applyPreset,
  droppedText,
  newLine,
  presetContext,
  presetFromSplit,
  splitResult,
  SPLIT_MAX_LINES,
  type SplitDraft,
  type SplitLineDraft,
  type SplitMode,
} from '../../lib/split';
import { Field } from '../Field';
import { SearchPicker } from '../SearchPicker';
import { btnSmall, inputClass } from '../ui';
import { AmountField } from './AmountField';
import { ComboSelect } from './ComboSelect';

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: 'amount', label: 'Суммами' },
  { mode: 'percent', label: 'В процентах' },
];

/**
 * Разбиение операции (§7 «Разделить»): строки «статья, проект, сумма или %», индикатор нераспределённого
 * остатка, применение сохранённого шаблона разделения и сохранение текущего разбиения как шаблона.
 */
export function SplitEditor(props: {
  companyId: number;
  kind: 'income' | 'expense';
  value: SplitDraft;
  onChange: (split: SplitDraft) => void;
  /** Отменить разбиение: вернуться к одной статье и проекту. */
  onCancel: () => void;
  /** Сумма операции в минимальных единицах; null — ещё не введена. */
  total: number | null;
  currency: string;
  minorUnits: number;
  categories: CategoryTree;
  projects: Project[];
  presets: SplitPreset[];
  error?: string;
}) {
  const modeName = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ name: string; error: string | null; pending: boolean } | null>(null);
  const split = props.value;
  const result = splitResult(split, props.total, props.minorUnits);

  const setLine = (index: number, patch: Partial<SplitLineDraft>) =>
    props.onChange({ ...split, lines: split.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const leftText =
    result.left === null
      ? 'Введите сумму операции'
      : result.left === 0
        ? 'Распределено полностью'
        : split.mode === 'amount'
          ? result.left > 0
            ? `Не распределено: ${formatMoney(result.left, props.currency)}`
            : `Распределено больше суммы на ${formatMoney(-result.left, props.currency)}`
          : result.left > 0
            ? `Не распределено: ${formatBp(result.left)} %`
            : `Распределено больше 100 % на ${formatBp(-result.left)} %`;

  const apply = (preset: SplitPreset) => {
    const r = applyPreset(preset.lines, presetContext(props.categories, props.projects, props.kind));
    if (r.split) props.onChange(r.split);
    setNotice(
      r.split === null
        ? `Шаблон «${preset.name}» не применён: все его статьи и проекты недоступны (удалены, в архиве или другого вида).`
        : r.dropped > 0
          ? `Шаблон «${preset.name}»: ${droppedText(r.dropped)} (удалены, в архиве или другого вида) — не применены.`
          : null,
    );
  };

  const savePreset = async () => {
    if (!saving) return;
    const lines = presetFromSplit(split, result);
    if (!lines.ok) {
      setSaving({ ...saving, error: lines.error });
      return;
    }
    setSaving({ ...saving, pending: true, error: null });
    try {
      await api(`/companies/${props.companyId}/split-presets`, { method: 'POST', body: { name: saving.name, lines: lines.lines } });
      await queryClient.invalidateQueries({ queryKey: ['split-presets', props.companyId] });
      setSaving(null);
      setNotice(`Шаблон «${saving.name.trim()}» сохранён.`);
    } catch (e) {
      const fields = e instanceof ApiError ? e.fields : undefined;
      setSaving({ ...saving, pending: false, error: fields?.name ?? fields?.lines ?? (e instanceof ApiError ? e.message : 'Ошибка сервера') });
    }
  };

  return (
    <section aria-label="Разбиение" className="grid gap-3 rounded-2xl bg-canvas p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="inline-flex gap-1 rounded-xl bg-field p-1">
          <legend className="sr-only">Как делить</legend>
          {MODES.map((m) => (
            <label
              key={m.mode}
              className="relative cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold text-muted has-[:checked]:bg-card has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
            >
              <input
                type="radio"
                name={modeName}
                checked={split.mode === m.mode}
                onChange={() => props.onChange({ mode: m.mode, lines: split.lines.map((l) => ({ ...l, value: '' })) })}
                className="absolute inset-0 cursor-pointer appearance-none rounded-lg opacity-0"
              />
              {m.label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <SearchPicker
            label="Применить шаблон"
            listLabel="Шаблоны разделения"
            options={props.presets.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
            onPick={(id) => apply(props.presets.find((p) => p.id === id)!)}
            buttonClassName={btnSmall}
          />
          <button type="button" onClick={() => setSaving({ name: '', error: null, pending: false })} className={btnSmall}>
            Сохранить как шаблон
          </button>
        </div>
      </div>

      {split.lines.map((line, i) => (
        <div key={line.key} role="group" aria-label={`Строка ${i + 1}`} className="grid items-start gap-2 md:grid-cols-[1fr_1fr_10rem_auto]">
          <ComboSelect
            label="Статья"
            listLabel="Статьи"
            value={line.categoryId}
            options={categoryOptions(props.categories, props.kind, [line.categoryId])}
            emptyLabel="Без статьи"
            onChange={(categoryId) => setLine(i, { categoryId })}
          />
          <ComboSelect
            label="Проект"
            listLabel="Проекты"
            value={line.projectId}
            options={projectOptions(props.projects, [line.projectId])}
            emptyLabel="Без проекта"
            onChange={(projectId) => setLine(i, { projectId })}
          />
          {split.mode === 'amount' ? (
            <AmountField
              label="Сумма"
              value={line.value}
              onChange={(value) => setLine(i, { value })}
              minorUnits={props.minorUnits}
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
            />
          ) : (
            <Field
              label="Доля, %"
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency)}` : undefined}
            >
              {(c) => <input {...c} inputMode="decimal" autoComplete="off" value={line.value} onChange={(e) => setLine(i, { value: e.target.value })} className={inputClass} />}
            </Field>
          )}
          <button
            type="button"
            aria-label={`Убрать строку ${i + 1}`}
            disabled={split.lines.length <= 1}
            onClick={() => props.onChange({ ...split, lines: split.lines.filter((_, j) => j !== i) })}
            className={`${btnSmall} md:mt-7`}
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={split.lines.length >= SPLIT_MAX_LINES}
          onClick={() => props.onChange({ ...split, lines: [...split.lines, newLine()] })}
          className={btnSmall}
        >
          + Строка
        </button>
        <p role="status" className={`text-sm font-semibold ${result.left === 0 ? 'text-income' : 'text-expense'}`}>
          {leftText}
        </p>
      </div>
      {props.error && <p className="text-sm text-expense">{props.error}</p>}
      {notice && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-field px-3 py-2 text-sm">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {saving && (
        <div role="group" aria-label="Новый шаблон разделения" className="flex flex-wrap items-end gap-2">
          <Field label="Название шаблона" error={saving.error ?? undefined} className="min-w-48 flex-1">
            {(c) => (
              <input
                {...c}
                autoFocus
                value={saving.name}
                onChange={(e) => setSaving({ ...saving, name: e.target.value, error: null })}
                onKeyDown={(e) => {
                  // Enter здесь сохраняет шаблон, а не операцию
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void savePreset();
                  }
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="button" disabled={saving.pending} onClick={() => void savePreset()} className={btnSmall}>
            Сохранить шаблон
          </button>
          <button type="button" onClick={() => setSaving(null)} className={btnSmall}>
            Не сохранять
          </button>
        </div>
      )}
      <button type="button" onClick={props.onCancel} className="justify-self-start text-sm font-semibold text-muted underline">
        Отменить разбиение
      </button>
    </section>
  );
}
```

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
import { useMeta } from '../../lib/query';
```

   замените на:

```tsx
import { useMeta } from '../../lib/query';
import { startSplit } from '../../lib/split';
```

2. Найдите:

```tsx
  useProjects,
  useTags,
```

   замените на:

```tsx
  useProjects,
  useSplitPresets,
  useTags,
```

3. Найдите:

```tsx
  type Project,
  type Tag,
} from '../../lib/queries';
```

   замените на:

```tsx
  type Project,
  type SplitPreset,
  type Tag,
} from '../../lib/queries';
```

4. Найдите:

```tsx
import { ComboSelect } from './ComboSelect';
```

   замените на:

```tsx
import { ComboSelect } from './ComboSelect';
import { SplitEditor } from './SplitEditor';
```

5. Найдите:

```tsx
  tags: Tag[];
}
```

   замените на:

```tsx
  tags: Tag[];
  presets: SplitPreset[];
}
```

6. Найдите:

```tsx
  const tags = useTags(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags];
```

   замените на:

```tsx
  const tags = useTags(props.company.id);
  const presets = useSplitPresets(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags, presets];
```

7. Найдите:

```tsx
    accounts.data && categories.data && projects.data && counterparties.data && tags.data
      ? { accounts: accounts.data, categories: categories.data, projects: projects.data, counterparties: counterparties.data, tags: tags.data }
```

   замените на:

```tsx
    accounts.data && categories.data && projects.data && counterparties.data && tags.data && presets.data
      ? {
          accounts: accounts.data,
          categories: categories.data,
          projects: projects.data,
          counterparties: counterparties.data,
          tags: tags.data,
          presets: presets.data,
        }
```

8. Найдите:

```tsx
      {!transfer && (
        <div className="grid gap-4 md:grid-cols-2">
          <ComboSelect
            label="Статья"
            listLabel="Статьи"
            value={draft.categoryId}
            options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
            emptyLabel="Без статьи"
            onChange={(categoryId) => set({ categoryId }, 'lines')}
            error={errors.lines}
          />
          <ComboSelect
            label="Контрагент"
            listLabel="Контрагенты"
            value={draft.counterpartyId}
            options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, draft.categoryId))}
```

   замените на:

```tsx
      {!transfer && (
        <div className="grid gap-4 md:grid-cols-2">
          {draft.split ? (
            <SplitEditor
              companyId={p.company.id}
              kind={kind}
              value={draft.split}
              onChange={(split) => set({ split }, 'lines')}
              onCancel={() => set({ split: null, categoryId: draft.split!.lines[0]?.categoryId ?? null, projectId: draft.split!.lines[0]?.projectId ?? null }, 'lines')}
              total={amountMinor}
              currency={currency.code}
              minorUnits={currency.minorUnits}
              categories={p.data.categories}
              projects={p.data.projects}
              presets={p.data.presets}
              error={errors.lines}
            />
          ) : (
            <div>
              <ComboSelect
                label="Статья"
                listLabel="Статьи"
                value={draft.categoryId}
                options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
                emptyLabel="Без статьи"
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                error={errors.lines}
              />
              <button
                type="button"
                onClick={() => set({ split: startSplit(draft.categoryId, draft.projectId, draft.amount) }, 'lines')}
                className="mt-1 text-sm font-semibold text-income hover:underline"
              >
                Разделить
              </button>
            </div>
          )}
          <ComboSelect
            label="Контрагент"
            listLabel="Контрагенты"
            value={draft.counterpartyId}
            options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
```

9. Найдите:

```tsx
            <ComboSelect
              label="Проект"
              listLabel="Проекты"
              value={draft.projectId}
              options={projectOptions(p.data.projects, [draft.projectId])}
              emptyLabel="Без проекта"
              onChange={(projectId) => set({ projectId }, 'lines')}
              error={transfer ? errors.lines : undefined}
            />
```

   замените на:

```tsx
            {!draft.split && (
              <ComboSelect
                label="Проект"
                listLabel="Проекты"
                value={draft.projectId}
                options={projectOptions(p.data.projects, [draft.projectId])}
                emptyLabel="Без проекта"
                onChange={(projectId) => set({ projectId }, 'lines')}
                error={transfer ? errors.lines : undefined}
              />
            )}
```

10. Найдите:

```tsx
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);
```

   замените на:

```tsx
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);
  const amountParsed = positiveAmount(draft.amount, currency.minorUnits);
  const amountMinor = amountParsed.ok ? amountParsed.minor : null;
  // подходящий тип контрагента — по статье операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
```

Проверка экранирований:

```bash
node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212\u200b]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/client/lib/split.ts src/client/components/operation/SplitEditor.tsx tests/client/split.test.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/split.test.ts tests/client/operation-form.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/operation-form.spec.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/split.ts src/client/lib/operation-form.ts src/client/components/operation/SplitEditor.tsx src/client/components/operation/OperationForm.tsx tests/client/split.test.ts tests/client/operation-form.test.ts e2e/operation-form.spec.ts
git commit -m "feat: «Разделить» в форме операции — суммы и проценты, шаблоны разделения

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: «+ Создать „…“» — контрагент, статья, проект и тег прямо из формы

**Files:**
- Create: `src/client/lib/operation-create.ts`
- Modify: `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/SplitEditor.tsx`, `e2e/operation-form.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `api`, `queryClient`; API справочников планов 2–3a: `POST /companies/:cid/counterparties` (`{ type, name }` → `{ counterparty }`), `…/categories` (`{ kind, name, parentId }` → `{ category }`), `…/projects` (`{ name, templateKey: 'general' }` → `{ project, applied }`), `…/tags` (`{ name }` → `{ tag }`; имя архивного тега — 422 `ARCHIVED_DUPLICATE`); `preferredCounterpartyType` (задача 3); `PickerList.onCreate`, `SearchPicker.onCreate`, `ComboSelect.onCreate` (задача 3).
- Produces: `operation-create.ts`: `type CreatableKind = 'counterparty' | 'category' | 'project' | 'tag'`, `createFromForm(companyId, what, name, { kind, counterpartyType }): Promise<number>` — создаёт и дожидается обновлённого списка; `SplitEditor` получает `onCreateCategory?(name, key)` и `onCreateProject?(name, key)`.

- [ ] **Step 1: Write the failing test**

`e2e/operation-form.spec.ts` — в конец файла:

```ts
test('«+ Создать „…“» прямо из формы: контрагент с типом под статью, статья, проект, тег; тег из архива — ошибка', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Создать ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const old = (await apiPost(page, `${base}/tags`, { name: 'старый' })).tag.id;
  await apiPost(page, `${base}/tags/${old}/archive`, {});
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('700');
  // «Зарплата» — системная статья: новый контрагент создаётся сотрудником
  await pick(page, 'Статья', 'Зарплата');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  await dialog.getByRole('combobox', { name: 'Контрагенты: поиск' }).fill('Асель');
  await dialog.getByRole('option', { name: '+ Создать „Асель“' }).click();
  await expect(dialog.getByRole('button', { name: 'Контрагент: Асель' })).toBeVisible();

  // статья: Enter на пункте «+ Создать» тоже создаёт
  await dialog.getByRole('button', { name: /^Статья:/ }).click();
  const search = dialog.getByRole('combobox', { name: 'Статьи: поиск' });
  await search.fill('Интернет');
  await search.press('ArrowDown');
  await expect(dialog.getByRole('option', { name: '+ Создать „Интернет“' })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Статья: Интернет' })).toBeVisible();
  // такое название уже есть (без учёта регистра) — «Создать» не предлагается
  await dialog.getByRole('button', { name: /^Статья:/ }).click();
  await search.fill('интернет');
  await expect(dialog.getByRole('option', { name: /Создать/ })).toHaveCount(0);
  await search.press('Escape');

  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByRole('button', { name: /^Проект:/ }).click();
  await dialog.getByRole('combobox', { name: 'Проекты: поиск' }).fill('Клуб Центр');
  await dialog.getByRole('option', { name: '+ Создать „Клуб Центр“' }).click();
  await expect(dialog.getByRole('button', { name: 'Проект: Клуб Центр' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('нал');
  await dialog.getByRole('option', { name: '+ Создать „нал“' }).click();
  await expect(dialog.getByRole('group', { name: 'Теги' })).toContainText('нал');
  // архивный тег не предлагается, а создать такой же нельзя — сообщение сервера
  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('старый');
  await dialog.getByRole('option', { name: '+ Создать „старый“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «старый»');

  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText('Интернет');
  await expect(row).toContainText('Асель');
  await expect(row).toContainText('Клуб Центр');
  const people = (await (await page.request.get(`${base}/counterparties`)).json()).counterparties as { name: string; type: string }[];
  expect(people.find((c) => c.name === 'Асель')!.type).toBe('employee');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/operation-form.spec.ts -g "Создать"`
Expected: FAIL — в списке контрагентов нет пункта «+ Создать „Асель“».

- [ ] **Step 3: Implement**

`src/client/lib/operation-create.ts`:

```ts
import type { CounterpartyType } from '../../shared/system-categories';
import { api } from './api';
import { queryClient } from './query';

/** Что можно создать прямо из формы операции пунктом «+ Создать „…“» (§7). */
export type CreatableKind = 'counterparty' | 'category' | 'project' | 'tag';

/**
 * Создать элемент справочника из формы операции и дождаться обновлённого списка — новый элемент сразу виден
 * в выпадающем списке под своим названием. Возвращает id; ошибка сервера — исключение `ApiError`.
 * Статья — верхнего уровня вида операции, проект — по шаблону «Общий» (без параметров и счетов).
 */
export async function createFromForm(
  companyId: number,
  what: CreatableKind,
  name: string,
  opts: { kind: 'income' | 'expense'; counterpartyType: CounterpartyType },
): Promise<number> {
  const base = `/companies/${companyId}`;
  let id: number;
  switch (what) {
    case 'counterparty':
      id = (await api<{ counterparty: { id: number } }>(`${base}/counterparties`, { method: 'POST', body: { type: opts.counterpartyType, name } })).counterparty.id;
      await queryClient.invalidateQueries({ queryKey: ['counterparties', companyId] });
      break;
    case 'category':
      id = (await api<{ category: { id: number } }>(`${base}/categories`, { method: 'POST', body: { kind: opts.kind, name, parentId: null } })).category.id;
      await queryClient.invalidateQueries({ queryKey: ['categories', companyId] });
      break;
    case 'project':
      id = (await api<{ project: { id: number } }>(`${base}/projects`, { method: 'POST', body: { name, templateKey: 'general' } })).project.id;
      await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
      break;
    case 'tag':
      id = (await api<{ tag: { id: number } }>(`${base}/tags`, { method: 'POST', body: { name } })).tag.id;
      await queryClient.invalidateQueries({ queryKey: ['tags', companyId] });
      break;
  }
  return id;
}
```

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
import { invalidateOperations } from '../../lib/journal-mutations';
```

   замените на:

```tsx
import { invalidateOperations } from '../../lib/journal-mutations';
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
```

2. Найдите:

```tsx
  // подходящий тип контрагента — по статье операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
```

   замените на:

```tsx
  // подходящий тип контрагента — по статье операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;

  /**
   * «+ Создать „…“» (§7): создать элемент справочника и выбрать его. Контрагент получает тип, подходящий статье,
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
```

3. Найдите:

```tsx
              presets={p.data.presets}
              error={errors.lines}
            />
```

   замените на:

```tsx
              presets={p.data.presets}
              error={errors.lines}
              onCreateCategory={createLine('categoryId')}
              onCreateProject={createLine('projectId')}
            />
```

4. Найдите:

```tsx
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                error={errors.lines}
              />
              <button
```

   замените на:

```tsx
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                onCreate={(name) => void createItem('category', name, (d, categoryId) => ({ ...d, categoryId }))}
                error={errors.lines}
              />
              <button
```

5. Найдите:

```tsx
            onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
```

   замените на:

```tsx
            onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
            onCreate={(name) => void createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId }))}
```

6. Найдите:

```tsx
                onChange={(projectId) => set({ projectId }, 'lines')}
                error={transfer ? errors.lines : undefined}
```

   замените на:

```tsx
                onChange={(projectId) => set({ projectId }, 'lines')}
                onCreate={(name) => void createItem('project', name, (d, projectId) => ({ ...d, projectId }))}
                error={transfer ? errors.lines : undefined}
```

7. Найдите:

```tsx
            <TagsField tags={p.data.tags} value={draft.tagIds} onChange={(tagIds) => set({ tagIds }, 'tagIds')} error={errors.tagIds} />
```

   замените на:

```tsx
            <TagsField
              tags={p.data.tags}
              value={draft.tagIds}
              onChange={(tagIds) => set({ tagIds }, 'tagIds')}
              onCreate={(name) => void createItem('tag', name, (d, id) => ({ ...d, tagIds: [...d.tagIds, id] }))}
              error={errors.tagIds}
            />
```

8. Найдите:

```tsx
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; error?: string }) {
```

   замените на:

```tsx
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; onCreate: (name: string) => void; error?: string }) {
```

9. Найдите:

```tsx
        <SearchPicker label="+ Тег" ariaLabel="Добавить тег" listLabel="Теги" options={options} onPick={(id) => props.onChange([...props.value, id])} buttonClassName={btnSmall} />
```

   замените на:

```tsx
        <SearchPicker
          label="+ Тег"
          ariaLabel="Добавить тег"
          listLabel="Теги"
          options={options}
          onPick={(id) => props.onChange([...props.value, id])}
          onCreate={props.onCreate}
          buttonClassName={btnSmall}
        />
```

`src/client/components/operation/SplitEditor.tsx` — правки:

1. Найдите:

```tsx
  presets: SplitPreset[];
  error?: string;
}) {
```

   замените на:

```tsx
  presets: SplitPreset[];
  error?: string;
  /** «+ Создать „…“» в строке: создать статью или проект и выбрать его в строке с ключом key. */
  onCreateCategory?: (name: string, key: number) => void;
  onCreateProject?: (name: string, key: number) => void;
}) {
```

2. Найдите:

```tsx
            onChange={(categoryId) => setLine(i, { categoryId })}
```

   замените на:

```tsx
            onChange={(categoryId) => setLine(i, { categoryId })}
            onCreate={props.onCreateCategory && ((name) => props.onCreateCategory!(name, line.key))}
```

3. Найдите:

```tsx
            onChange={(projectId) => setLine(i, { projectId })}
```

   замените на:

```tsx
            onChange={(projectId) => setLine(i, { projectId })}
            onCreate={props.onCreateProject && ((name) => props.onCreateProject!(name, line.key))}
```

`README.md` — правка:

1. Найдите:

```md
Пока нет (следующие шаги): форма операции в интерфейсе, отчёты, мобильная версия и PWA.
```

   замените на:

```md
- **Форма операции (шаг 6):**
  - кнопки «Доход», «Расход», «Перевод» в шапке: доход, расход, перевод, в том числе между валютами (сумма зачисления и курс);
  - в поле суммы можно писать выражения (`1500+250*2`), на телефоне под полем — кнопки операторов;
  - «Разделить» по статьям и проектам — суммами или в процентах, шаблоны разделения;
  - контрагента, статью, проект и тег можно создать прямо из формы; «Сохранить и создать похожий».

Пока нет (следующие шаги): правка операции из журнала и вложения в форме, отчёты, мобильная версия и PWA.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/operation-form.spec.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (два прогона e2e подряд: создание справочников асинхронное).

```bash
git add src/client/lib/operation-create.ts src/client/components/operation/OperationForm.tsx src/client/components/operation/SplitEditor.tsx e2e/operation-form.spec.ts README.md
git commit -m "feat: создание контрагента, статьи, проекта и тега прямо из формы операции

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
