# Этап 1.5, план 1.5-3c: формы операций — дата и время оплаты, «Зарплата за {месяц}», калькулятор — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** последняя треть плана 1.5-3 из §13 спецификации этапа 1.5:
- дата и время оплаты в одном поле: «Сегодня, 10.10.2026, 15:58», «Вчера, …», «Воскресенье, 04.10.2026, 10:31»; свой календарь (`Calendar` плана 1.5-2a) и строка «🕒 Время» с полем `ЧЧ:ММ`, «Готово» (§2.3, §6.5);
- правила времени (§2.3): «живое» время новой операции (обновляется раз в минуту, сохраняется точный момент); правка без смены даты и времени не трогает секунды; время, заданное руками, — `ЧЧ:ММ:00`, позже «сейчас» — ошибка «Это время ещё не наступило»; «+ Добавить и создать похожий» сохраняет время, заданное руками; «Дублировать» — «сегодня» и живое время;
- строка «{Категория} за {месяц}» у зарплаты вместо «Дата сделки отличается»: выбор месяца пишет дату сделки первым числом месяца, «Как дата оплаты» её убирает (§6.7, строка 1а; решение владельца 14.3 №4);
- калькулятор по иконке в поле суммы: кнопки пишут в то же выражение, «=» вычисляет и закрывает, ошибка — у поля; кнопки не меньше 44×44 px, ряд операторов на телефоне — тоже (§6.10; закрывает отложенное 6a №1);
- сверка экранов `12-income-datepicker`, `13c-calculator`, `05-op-edit` и итоговый прогон `npm run shots:ux`.

**Предусловие:** выполнены планы [1.5-3a](2026-10-11-stage1_5-plan3a-form-lists.md) и [1.5-3b](2026-10-11-stage1_5-plan3b-form-layout.md): окно на тип, одна колонка, в `OperationEditor` — константа `paidDateField` (поле `type="date"` с плавающей подписью) и строки-действия `rows`, `ActionRow`/`actionRowClass` (`components/operation/ActionRow.tsx`), последний счёт, `useAutoFocus`, `DateField floating`. Ожидаемо на старте: `npm test` — около 690 тестов (+1 пропущен), `npm run test:e2e` — 77.

**Architecture:**
- **Форматы и разбор времени** — чистые функции в `src/shared/dates.ts`: `formatDateTimeField(date, time, today)`, `timeOfDay(iso, timeZone)`, `parseTimeInput(text)`.
- **Черновик формы** (`lib/operation-form.ts`) получает `paidTime` («ЧЧ:ММ» или пусто) и `paidTimeSet` (время задано руками). `paidAtFor(…, time?)` с явным временем отдаёт дату и `ЧЧ:ММ:00` без ограничения «не позже now» — проверка в `buildBody`. `patchBody` (`lib/operation-edit.ts`) сравнивает дату и минуты в `APP_TIMEZONE`. Сервер не меняется: `paidAt` уже принимает момент (§10.3).
- **`DateTimeField`** (новый `components/operation/DateTimeField.tsx`) — кнопка поля с плавающей подписью и `Popover`: `Calendar` с `max` = сегодня, ниже строка «Время» и «Готово». «Живое» время даёт хук `useNowTime` (новый `lib/use-now.ts`), он обновляет его в начале каждой минуты.
- **«Зарплата за {месяц}»** — `SalaryRow` (новый `components/operation/SalaryRow.tsx`): строка вида `ActionRow` (`actionRowClass`) — кнопка `Popover` с сеткой 12 месяцев, годом «‹ ›» и «Как дата оплаты». Текст строки — чистая `salaryRowText`.
- **Калькулятор** — `CalculatorPopover` (новый `components/operation/CalculatorPopover.tsx`) на `Popover`; нажатие кнопки — чистая `pressCalcKey` (новый `lib/calculator.ts`), «=» — прежнее вычисление поля суммы (`evaluateAmount` через `positiveAmount`).

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §2.3, §6.2, §6.5, §6.7 (строка 1а), §6.10, §8.7, §10.3, §11 (`Calendar`, `Popover`), §12, §13 (блок «Решения планирования плана 1.5-3»), §14.3 №4. Аудит: [02-operation-forms.md](../../research/ux-parity/02-operation-forms.md) — H5, M6, M7, M14, L2.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-3») тем же коммитом, что и план.

1. **`formatDateTimeField(date, time, today)`** вместо `(iso, today)` из §2.3: поле показывает черновик — календарную дату и «ЧЧ:ММ» (заданное руками или «сейчас»), а не готовый момент. Формат — как в §2.3.
2. **Панель даты и времени:** выбор дня ставит дату и не закрывает панель; время применяется по «Готово» или Enter в поле «Время» (неверное — ошибка «Введите время в виде ЧЧ:ММ» в панели, панель остаётся); Esc и уход из панели закрывают её без применения набранного времени (выбранный день уже применён). Если поле «Время» не трогали, «Готово» время не задаёт — оно остаётся «живым».
3. **Ошибки времени** — у поля даты (`errors.paidAt`): «Это время ещё не наступило» (§2.3) и «Укажите время в виде ЧЧ:ММ» (повреждённый черновик). Сервер по-прежнему пропускает до конца текущего дня (инвариант 6).
4. **Правка:** поле показывает время операции (`paidTime` из `paidAt`), но оно не «задано руками»: при той же дате `paidAt` не уходит (если минуты совпали — тоже), при смене даты — прежнее время суток с секундами. Время, изменённое руками, — `ЧЧ:ММ:00`.
5. **«Зарплата за {месяц}»:** месяц в именительном падеже со строчной («Зарплата за сентябрь»); если год месяца не совпадает с годом даты оплаты — с годом («Зарплата за декабрь 2025»). Без даты сделки — месяц даты оплаты, текст приглушён. Панель: год «‹ ›», 12 месяцев (выбранный отмечен `aria-pressed`), «Как дата оплаты». Строка показывается при эффективном `systemKey = salary` у категории операции (у разбитой — у первой строки).
6. **Калькулятор:** иконка — в поле суммы (у суммы перевода тоже), у «Суммы зачисления» и сумм строк разбиения её нет. Панель: строка выражения (то же значение, что в поле) и кнопки 7 8 9 ÷ / 4 5 6 × / 1 2 3 «минус» / 0 , = + / ( ) C ⌫; минус — U+2212, как у ряда операторов. Выражение длиннее `CALC_MAX_LENGTH` не растёт. «=» закрывает панель и при ошибке — ошибка видна у поля. Подсказка поля суммы — «Можно писать выражения: 1500+250*2» (у заблокированной суммы вместо неё — «счёт в архиве»).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: выражения в поле суммы и ряд операторов на телефоне, RateFix. **Мёртвых кнопок нет.**
- **Время операции (§2.3):** `paidAt` — момент; вводится дата и время до минуты в `APP_TIMEZONE` (пояс устройства не учитывается). Новая операция, время не трогали: поле показывает «сейчас» и обновляется раз в минуту; с сегодняшней датой `paidAt` = точный момент сохранения; с другой датой — эта дата и текущее время суток, но не позже «сейчас». Задали руками — дата + `ЧЧ:ММ:00`. Правка, время не трогали: при неизменной дате `paidAt` в PATCH не уходит (секунды сохраняются); при смене даты — новая дата и прежнее время суток с секундами, не позже «сейчас». Задали руками — дата + `ЧЧ:ММ:00`; `patchBody` сравнивает дату и минуты в `APP_TIMEZONE`. Время позже «сейчас», заданное руками, — ошибка у поля «Это время ещё не наступило». «+ Добавить и создать похожий» сохраняет дату и время, если время задали руками, иначе время «живое». «Дублировать» — дата «сегодня», время «живое». `accrualDate` — календарная дата без времени.
- **Формат поля (§2.3):** «Сегодня, 10.10.2026, 15:58», «Вчера, 09.10.2026, 22:09», иначе день недели с заглавной: «Воскресенье, 04.10.2026, 10:31».
- **`DateTimeField` (§6.5):** значение по §2.3, подпись по типу (§6.2), иконка календаря; в панели `Calendar` и под ним строка «🕒 Время» с полем `ЧЧ:ММ`; поле времени принимает `9:05`, `09:05`, `0905`; неверное значение — ошибка у поля; выбор дня ставит дату и оставляет время; панель закрывается Esc или кнопкой «Готово». Ввода с клавиатуры в само поле даты нет. Для `paidAt` `max` = сегодня; дни после него неактивны с подсказкой «Плановые платежи появятся позже».
- **`Calendar` (§11):** шаблон WAI-ARIA «date picker dialog» — без изменений (план 1.5-2a).
- **Строка 1а (§6.7):** «{Категория} за {месяц}» вместо строки «Дата сделки отличается», если у категории эффективный `systemKey = salary`; без `accrualDate` месяц — из даты оплаты, текст серый; нажатие — выбор месяца в `Popover` (сетка 12 месяцев, год «‹ ›», «Как дата оплаты»); выбор месяца — `accrualDate` = первое число месяца; «Как дата оплаты» — `accrualDate = null`; смена категории на несистемную возвращает строку 1, `accrualDate` сохраняется.
- **Калькулятор (§6.10):** иконка внутри поля суммы справа (`aria-label` «Калькулятор») открывает `Popover`: строка выражения; кнопки 7 8 9 ÷ / 4 5 6 × / 1 2 3 «минус» / 0 , = + / ( ) C ⌫, каждая не меньше 44×44 px. Кнопки пишут в то же выражение поля; «=» вычисляет через `evaluateAmount` и закрывает панель, ошибка — у поля. Остаётся ввод выражений с клавиатуры и ряд операторов под полем на телефоне. Подсказка поля: «Можно писать выражения: 1500+250*2».
- **Сохраняются контракты планов 6a/6b/7, 1.5-1a и 1.5-3b:** автофокус (первое пустое обязательное поле, иначе сумма), `refocusSignal`, `<fieldset disabled={pending || readOnly}>`, «Загрузить актуальную», RateFix, архивная форма только для чтения, вопрос о закрытии, форма на весь экран телефона.
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN)`; поля ввода — `amountInputText`.
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty` (UTC+5); один пользователь `admin`/`e2e-password-1` и одна база на прогон; у каждого теста свой браузерный контекст (последний счёт в начале пуст); `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; без фиксированных пауз. Проверки «сегодня» не должны падать около полуночи: время операции — `todayAgo(n)`, проверка будущего времени пропускается в последние минуты суток.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Правка без смены даты и времени** (поменяли только комментарий или вписали то же время руками): `paidAt` в PATCH не уходит — секунды и миллисекунды операции сохраняются. Тесты — задача 2 (unit) и задача 3 (e2e).
2. **Дата в прошлом в другом часовом поясе** (до 01.03.2024 Алматы был UTC+6) и время около полуночи («00:05»): момент считается по смещению на ту дату; «Вчера» на границе месяца и года. Тесты — задачи 1 и 2 (unit).
3. **Время, заданное руками, позже «сейчас» сегодня** — ошибка у поля, запроса нет; в прошлый день то же «позднее» время — можно. Тесты — задача 2 (unit) и задача 3 (e2e).
4. **«Зарплата за …» через границу года** (оплата в январе, начисление за декабрь): год в тексте строки, дата сделки — `YYYY-12-01` прошлого года. Тесты — задача 4 (unit и e2e: в январе — переход года в панели).
5. **Калькулятор: выражение у предела длины и деление на ноль** — кнопки не удлиняют выражение сверх `CALC_MAX_LENGTH`; «=» с ошибкой закрывает панель, ошибка у поля, значение остаётся для правки. Тесты — задача 5 (unit и e2e).

---

## Карта файлов

```
src/shared/dates.ts                                  # formatDateTimeField, timeOfDay, parseTimeInput
src/client/lib/operation-form.ts                     # paidTime, paidTimeSet, paidAtFor(…, time?), buildBody, similarDraft; salaryRowText, firstOfMonth
src/client/lib/operation-edit.ts                     # draftFromOperation (время), duplicateDraft, patchBody по минутам
src/client/lib/operation-options.ts                  # salaryCategory
src/client/lib/use-now.ts                            # (новый) msToNextMinute, useNowTime
src/client/lib/calculator.ts                         # (новый) CALC_ROWS, CALC_KEY_NAMES, pressCalcKey
src/client/components/icons.tsx                      # ClockIcon, CalculatorIcon
src/client/components/operation/DateTimeField.tsx    # (новый)
src/client/components/operation/SalaryRow.tsx        # (новый)
src/client/components/operation/CalculatorPopover.tsx # (новый)
src/client/components/operation/AmountField.tsx      # calculator, подсказка, операторы 44 px
src/client/components/operation/OperationForm.tsx    # DateTimeField, «Зарплата за …», калькулятор
scripts/ux-shots.ts                                  # сценарии 12 и 13
tests/shared/dates.test.ts, tests/client/operation-form.test.ts, operation-edit.test.ts, operation-options.test.ts, use-now.test.ts (новый), calculator.test.ts (новый)
e2e/operation-form.spec.ts, operation-edit.spec.ts, mobile.spec.ts
```

---

### Task 1: Форматы и разбор времени в `shared/dates.ts`

**Files:**
- Modify: `src/shared/dates.ts`, `tests/shared/dates.test.ts`

**Interfaces:**
- Consumes: `addDays`, `formatDateRu` (`shared/dates.ts`).
- Produces: `formatDateTimeField(date: string, time: string, today: string): string`, `timeOfDay(iso: string, timeZone: string): string`, `parseTimeInput(text: string): string | null`.

- [ ] **Step 1: Write the failing tests**

В `tests/shared/dates.test.ts` в импорт из `'../../src/shared/dates'` добавьте `formatDateTimeField`, `parseTimeInput`, `timeOfDay`; в конец файла добавьте:

```ts
describe('formatDateTimeField — поле даты и времени формы (§2.3 этапа 1.5)', () => {
  it('«Сегодня», «Вчера», иначе день недели с заглавной', () => {
    expect(formatDateTimeField('2026-10-10', '15:58', '2026-10-10')).toBe('Сегодня, 10.10.2026, 15:58');
    expect(formatDateTimeField('2026-10-09', '22:09', '2026-10-10')).toBe('Вчера, 09.10.2026, 22:09');
    expect(formatDateTimeField('2026-10-04', '10:31', '2026-10-10')).toBe('Воскресенье, 04.10.2026, 10:31');
    expect(formatDateTimeField('2026-10-05', '09:00', '2026-10-10')).toBe('Понедельник, 05.10.2026, 09:00');
    expect(formatDateTimeField('2026-10-03', '00:05', '2026-10-10')).toBe('Суббота, 03.10.2026, 00:05');
  });

  it('«Вчера» через границу месяца и года (Review Focus 2)', () => {
    expect(formatDateTimeField('2026-10-31', '23:59', '2026-11-01')).toBe('Вчера, 31.10.2026, 23:59');
    expect(formatDateTimeField('2026-12-31', '12:00', '2027-01-01')).toBe('Вчера, 31.12.2026, 12:00');
  });
});

describe('timeOfDay — время суток момента в поясе приложения', () => {
  it('«ЧЧ:ММ» в 24-часовом формате; смещение — на дату момента (UTC+6 до 01.03.2024)', () => {
    expect(timeOfDay('2026-10-10T10:58:00.000Z', 'Asia/Almaty')).toBe('15:58');
    expect(timeOfDay('2026-10-09T19:05:30.000Z', 'Asia/Almaty')).toBe('00:05');
    expect(timeOfDay('2024-01-15T04:30:00.000Z', 'Asia/Almaty')).toBe('10:30');
    expect(timeOfDay('2026-10-10T10:58:00.000Z', 'UTC')).toBe('10:58');
  });
});

describe('parseTimeInput — поле «Время» (§6.5 этапа 1.5)', () => {
  it('принимает 9:05, 09:05, 0905, 905, 9.05 и пробелы по краям', () => {
    expect(parseTimeInput('9:05')).toBe('09:05');
    expect(parseTimeInput('09:05')).toBe('09:05');
    expect(parseTimeInput('0905')).toBe('09:05');
    expect(parseTimeInput('905')).toBe('09:05');
    expect(parseTimeInput('9.05')).toBe('09:05');
    expect(parseTimeInput(' 23:59 ')).toBe('23:59');
    expect(parseTimeInput('0:00')).toBe('00:00');
  });

  it('неверное — null', () => {
    for (const bad of ['', '9', '24:00', '12:60', '12:5', 'ab:cd', '12345', '-1:00', '12:00:00']) expect(parseTimeInput(bad), bad).toBeNull();
  });
});
```

Run: `npx vitest run tests/shared/dates.test.ts` → FAIL (функции не экспортируются).

- [ ] **Step 2: Implement**

В конец `src/shared/dates.ts` добавьте:

```ts
/** Дни недели с заглавной для поля даты формы (§2.3 этапа 1.5); индекс — getUTCDay(). */
const WEEKDAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

/**
 * Значение поля даты и времени формы (§2.3 этапа 1.5): «Сегодня, 10.10.2026, 15:58», «Вчера, 09.10.2026, 22:09», иначе
 * день недели с заглавной — «Воскресенье, 04.10.2026, 10:31». date и today — календарные даты в APP_TIMEZONE, time — «ЧЧ:ММ».
 */
export function formatDateTimeField(date: string, time: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const head = date === today ? 'Сегодня' : date === addDays(today, -1) ? 'Вчера' : WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${head}, ${formatDateRu(date)}, ${time}`;
}

/** Форматтеры времени суток по поясу. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Время суток момента в поясе timeZone: «ЧЧ:ММ», 24 часа. */
export function timeOfDay(iso: string, timeZone: string): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** Ввод времени (§6.5 этапа 1.5): «9:05», «09:05», «0905», «905», «9.05» → «09:05»; иначе null. */
export function parseTimeInput(text: string): string | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${m[2]}`;
}
```

Run: `npx vitest run tests/shared/dates.test.ts` → PASS.

- [ ] **Step 3: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`.

```bash
git add src/shared/dates.ts tests/shared/dates.test.ts
git commit -m "feat: форматы даты и времени поля формы — «Сегодня, 10.10.2026, 15:58», разбор «9:05»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Правила времени в черновике формы — `paidTime`, `paidAtFor`, `buildBody`, `patchBody`

**Files:**
- Modify: `src/client/lib/operation-form.ts`, `src/client/lib/operation-edit.ts`, `tests/client/operation-form.test.ts`, `tests/client/operation-edit.test.ts`

**Interfaces:**
- Consumes: `timeOfDay`, `parseTimeInput` (задача 1); `dayOf` (`lib/journal-format.ts`).
- Produces:
  - `OperationDraft.paidTime: string` («ЧЧ:ММ»; пусто — «живое» время новой операции), `OperationDraft.paidTimeSet: boolean` (время задано руками);
  - `paidAtFor(date: string, ref: Date, now: Date, timeZone: string, time?: string): string`;
  - `buildBody` — ошибки `paidAt`: «Это время ещё не наступило», «Укажите время в виде ЧЧ:ММ»;
  - `similarDraft` переносит время, заданное руками; `duplicateDraft` — «сегодня» и живое время; `draftFromOperation` — `paidTime` из `paidAt`, `paidTimeSet: false`; `patchBody` сравнивает дату и минуты.

- [ ] **Step 1: Write the failing tests**

В `tests/client/operation-form.test.ts` в конец файла добавьте:

```ts
describe('время оплаты (§2.3 этапа 1.5)', () => {
  it('paidAtFor с явным временем — дата и ЧЧ:ММ:00 в поясе приложения, без ограничения «не позже now»', () => {
    expect(paidAtFor('2026-10-06', NOW, NOW, TZ, '22:09')).toBe('2026-10-06T17:09:00.000Z');
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ, '23:59')).toBe('2026-10-07T18:59:00.000Z');
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ, '00:05')).toBe('2026-10-06T19:05:00.000Z');
    // до 01.03.2024 в Алматы было UTC+6 (Review Focus 2)
    expect(paidAtFor('2024-01-15', NOW, NOW, TZ, '09:05')).toBe('2024-01-15T03:05:00.000Z');
  });

  it('время не трогали — «живое»: сегодня — точный момент сохранения, другая дата — текущее время суток', () => {
    expect(emptyDraft('expense', '2026-10-07')).toMatchObject({ paidTime: '', paidTimeSet: false });
    expect(body(draft({ amount: '1' })).paidAt).toBe(NOW.toISOString());
    expect(body(draft({ amount: '1', paidDate: '2026-10-05' })).paidAt).toBe('2026-10-05T05:30:00.123Z');
  });

  it('время задано руками: в теле — дата и ЧЧ:ММ:00; позже «сейчас» сегодня — ошибка; в прошлый день — можно (Review Focus 3)', () => {
    expect(body(draft({ amount: '1', paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true })).paidAt).toBe('2026-10-06T17:09:00.000Z');
    expect(body(draft({ amount: '1', paidTime: '10:30', paidTimeSet: true })).paidAt).toBe('2026-10-07T05:30:00.000Z');
    expect(errors(draft({ amount: '1', paidTime: '10:31', paidTimeSet: true }))).toEqual({ paidAt: 'Это время ещё не наступило' });
    expect(errors(draft({ amount: '1', paidTime: '25:00', paidTimeSet: true }))).toEqual({ paidAt: 'Укажите время в виде ЧЧ:ММ' });
  });

  it('«создать похожий»: время, заданное руками, и дата переносятся; «живое» время остаётся живым', () => {
    const manual = draft({ amount: '5', paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true });
    expect(similarDraft(manual)).toMatchObject({ paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true, amount: '' });
    const fromEdit = draft({ amount: '5', paidDate: '2026-10-06', paidTime: '18:15', paidTimeSet: false });
    expect(similarDraft(fromEdit)).toMatchObject({ paidDate: '2026-10-06', paidTime: '', paidTimeSet: false });
  });
});
```

В `tests/client/operation-edit.test.ts`:
1) в `describe('draftFromOperation', …)` в конец добавьте

```ts
  it('время операции — в поле (ЧЧ:ММ по Алматы), но не «задано руками»', () => {
    expect(draftFromOperation(op(), accounts, TZ)).toMatchObject({ paidDate: '2026-10-05', paidTime: '18:15', paidTimeSet: false });
  });
```

2) в `describe('patchBody — …', …)` в конец добавьте

```ts
  it('время (§2.3 этапа 1.5): без смены даты и времени — без paidAt, секунды сохраняются; та же минута руками — тоже; другое время — ЧЧ:ММ:00 (Review Focus 1)', () => {
    const o = op({ paidAt: '2026-10-05T13:15:42.250Z' }); // 05.10, 18:15:42 по Алматы
    expect(patchFor(o, (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
    expect(patchFor(o, (d) => ({ ...d, paidTime: '18:15', paidTimeSet: true }))).toBeNull();
    expect(patchFor(o, (d) => ({ ...d, paidTime: '09:05', paidTimeSet: true }))).toEqual({ version: 3, paidAt: '2026-10-05T04:05:00.000Z' });
    // смена даты без времени — прежнее время суток с секундами
    expect(patchFor(o, (d) => ({ ...d, paidDate: '2026-10-04' }))).toEqual({ version: 3, paidAt: '2026-10-04T13:15:42.250Z' });
    // смена даты и времени
    expect(patchFor(o, (d) => ({ ...d, paidDate: '2026-10-04', paidTime: '23:00', paidTimeSet: true }))).toEqual({ version: 3, paidAt: '2026-10-04T18:00:00.000Z' });
  });
```

3) в `describe('duplicateDraft, archivedAccountOf', …)` в первый тест после `expect(duplicateDraft(d, available, '2026-10-07')).toMatchObject({ … });` добавьте

```ts
    // «Дублировать»: дата «сегодня», время «живое»
    expect(duplicateDraft({ ...d, paidTime: '18:15', paidTimeSet: true }, available, '2026-10-07')).toMatchObject({ paidDate: '2026-10-07', paidTime: '', paidTimeSet: false });
```

Run: `npx vitest run tests/client/operation-form.test.ts tests/client/operation-edit.test.ts` → FAIL.

- [ ] **Step 2: `lib/operation-form.ts`**

1) Строку импорта `import { isValidDate, startOfDayUtc, zoneOffsetMs } from '../../shared/dates';` замените на `import { isValidDate, parseTimeInput, startOfDayUtc, zoneOffsetMs } from '../../shared/dates';`.

2) В `interface OperationDraft` после поля `  paidDate: string;` вставьте

```ts
  /**
   * Время оплаты «ЧЧ:ММ» в APP_TIMEZONE (§2.3 этапа 1.5). Пусто — у новой операции «живое» время (поле показывает
   * «сейчас»); у правки — время операции. Используется при сохранении, только если `paidTimeSet`.
   */
  paidTime: string;
  /** Время задано руками: сохраняется дата + ЧЧ:ММ:00. Нет — «сейчас» у новой, прежнее время с секундами у правки. */
  paidTimeSet: boolean;
```

3) В `emptyDraft` после строки `    paidDate: today,` вставьте

```ts
    paidTime: '',
    paidTimeSet: false,
```

4) Функцию `similarDraft` целиком замените на

```ts
/**
 * «+ Добавить и создать похожий» (§7, §2.3 этапа 1.5): те же значения, кроме суммы, комментария и файлов (суммы строк
 * разбиения — тоже). Время, заданное руками, остаётся вместе с датой (выручка за смену двумя операциями); иначе — «живое».
 */
export function similarDraft(draft: OperationDraft): OperationDraft {
  return {
    ...draft,
    amount: '',
    toAmount: '',
    comment: '',
    split: draft.split && similarSplit(draft.split),
    paidTime: draft.paidTimeSet ? draft.paidTime : '',
  };
}
```

5) Функцию `paidAtFor` целиком (с комментарием) замените на

```ts
/**
 * Момент оплаты для даты из формы. С `time` («ЧЧ:ММ», задано руками, §2.3 этапа 1.5) — дата и ЧЧ:ММ:00 в поясе
 * приложения, без ограничения «не позже now»: проверка — в buildBody. Без `time` — время суток момента `ref`
 * (в поясе приложения), но не позже `now`: новая операция за сегодня — ровно «сейчас», за прошлый день — тот же час,
 * правка даты сохраняет прежнее время.
 */
export function paidAtFor(date: string, ref: Date, now: Date, timeZone: string, time?: string): string {
  const start = Date.parse(startOfDayUtc(date, timeZone));
  if (time !== undefined) {
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    return new Date(start + (hours * 60 + minutes) * 60_000).toISOString();
  }
  const wall = ref.getTime() + zoneOffsetMs(ref.getTime(), timeZone);
  const msOfDay = ((wall % DAY_MS) + DAY_MS) % DAY_MS;
  return new Date(Math.min(start + msOfDay, now.getTime())).toISOString();
}
```

6) В `buildBody`:
- строки

```ts
  if (!isValidDate(draft.paidDate)) errors.paidAt = 'Укажите дату оплаты';
  else if (draft.paidDate > ctx.today) errors.paidAt = 'Дата оплаты в будущем — так нельзя';
```

  замените на

```ts
  // время, заданное руками (§2.3 этапа 1.5): «ЧЧ:ММ», не позже «сейчас»
  const time = draft.paidTimeSet ? parseTimeInput(draft.paidTime) : undefined;
  if (!isValidDate(draft.paidDate)) errors.paidAt = 'Укажите дату оплаты';
  else if (draft.paidDate > ctx.today) errors.paidAt = 'Дата оплаты в будущем — так нельзя';
  else if (time === null) errors.paidAt = 'Укажите время в виде ЧЧ:ММ';
  else if (time !== undefined && Date.parse(paidAtFor(draft.paidDate, ctx.now, ctx.now, ctx.timeZone, time)) > ctx.now.getTime()) {
    errors.paidAt = 'Это время ещё не наступило';
  }
```

- строку `      paidAt: paidAtFor(draft.paidDate, ctx.timeOfDayFrom, ctx.now, ctx.timeZone),` замените на `      paidAt: paidAtFor(draft.paidDate, ctx.timeOfDayFrom, ctx.now, ctx.timeZone, time ?? undefined),`.

- [ ] **Step 3: `lib/operation-edit.ts`**

1) Строку `import { getCurrency } from '../../shared/currencies';` дополните импортом ниже: `import { timeOfDay } from '../../shared/dates';`.

2) В `draftFromOperation` после строки `    paidDate,` вставьте

```ts
    // поле показывает время операции, но оно не «задано руками»: без правки времени paidAt не меняется (§2.3)
    paidTime: timeOfDay(op.paidAt, timeZone),
    paidTimeSet: false,
```

3) В комментарии к `patchBody` фразу «Дата оплаты отправляется, только если сменился день (время суток прежнее).» замените на «Дата оплаты отправляется, только если сменились дата или минуты в APP_TIMEZONE (§2.3 этапа 1.5): правка без смены времени не трогает секунды.», а строку

```ts
  if (dayOf(body.paidAt, timeZone) !== dayOf(op.paidAt, timeZone)) patch.paidAt = body.paidAt;
```

замените на

```ts
  const minute = (iso: string) => `${dayOf(iso, timeZone)} ${timeOfDay(iso, timeZone)}`;
  if (minute(body.paidAt) !== minute(op.paidAt)) patch.paidAt = body.paidAt;
```

4) Функцию `duplicateDraft` (с комментарием) замените на

```ts
/** «Дублировать платёж» (§7, §2.3 этапа 1.5): новая операция с теми же значениями, без архивных ссылок, «сегодня» и живое время. */
export function duplicateDraft(draft: OperationDraft, available: Available, today: string): OperationDraft {
  return { ...withoutArchived(draft, available), paidDate: today, paidTime: '', paidTimeSet: false };
}
```

Run: `npx vitest run tests/client/operation-form.test.ts tests/client/operation-edit.test.ts` → PASS. Run: `npm run typecheck` → без ошибок (форма ещё не задаёт время руками: `paidTimeSet` всегда `false`, поведение прежнее).

- [ ] **Step 4: Full check and commit**

Run: `npm test` → PASS. Run: `npm run test:e2e` → все проходят (поведение формы не меняется).

```bash
git add src/client/lib/operation-form.ts src/client/lib/operation-edit.ts tests/client/operation-form.test.ts tests/client/operation-edit.test.ts
git commit -m "feat: правила времени оплаты — ЧЧ:ММ:00 руками, «не позже сейчас», секунды при правке, время в «похожем»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `DateTimeField` — дата и время в одном поле со своим календарём

**Files:**
- Create: `src/client/lib/use-now.ts`, `tests/client/use-now.test.ts`, `src/client/components/operation/DateTimeField.tsx`
- Modify: `src/client/components/icons.tsx`, `src/client/components/operation/OperationForm.tsx`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes: `formatDateTimeField`, `parseTimeInput`, `timeOfDay` (задача 1); `paidTime`, `paidTimeSet` (задача 2); `Calendar` (`value`, `today`, `max`, `onSelect`), `Popover` (`control`, `label`, `ariaLabel`, `panelLabel`, `buttonClassName`, `panelClassName`, `disabled`, `children(close)`), `Field` с `floating`.
- Produces:
  - `msToNextMinute(nowMs: number): number`, `useNowTime(timeZone: string): string` (`lib/use-now.ts`);
  - `ClockIcon` (`icons.tsx`);
  - `DateTimeField(props: { label: string; date: string; time: string; nowTime: string; today: string; error?: string; hint?: string; disabled?: boolean; onDateChange: (date: string) => void; onTimeChange: (time: string) => void })` — кнопка с именем «{подпись}: {значение}», панель «{подпись}: календарь» с полем «Время» и кнопкой «Готово».

- [ ] **Step 1: Write the failing unit test**

`tests/client/use-now.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { msToNextMinute } from '../../src/client/lib/use-now';

describe('«живое» время поля даты (§2.3 этапа 1.5)', () => {
  it('следующее обновление — в начале следующей минуты', () => {
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:00.000Z'))).toBe(60_000);
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:59.900Z'))).toBe(100);
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:30.250Z'))).toBe(29_750);
  });
});
```

Run: `npx vitest run tests/client/use-now.test.ts` → FAIL.

- [ ] **Step 2: `lib/use-now.ts`, `ClockIcon`**

`src/client/lib/use-now.ts`:

```ts
import { useEffect, useState } from 'react';
import { timeOfDay } from '../../shared/dates';

/** Мс до начала следующей минуты. */
export function msToNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000);
}

/** «Сейчас» «ЧЧ:ММ» в поясе приложения; обновляется в начале каждой минуты (§2.3 этапа 1.5: «живое» время новой операции). */
export function useNowTime(timeZone: string): string {
  const [time, setTime] = useState(() => timeOfDay(new Date().toISOString(), timeZone));
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setTime(timeOfDay(new Date().toISOString(), timeZone));
      timer = window.setTimeout(tick, msToNextMinute(Date.now()));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [timeZone]);
  return time;
}
```

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** Часы — строка «Время» в календаре поля даты (§6.5 этапа 1.5). */
export function ClockIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Svg>
  );
}
```

Run: `npx vitest run tests/client/use-now.test.ts` → PASS.

- [ ] **Step 3: `DateTimeField`**

`src/client/components/operation/DateTimeField.tsx`:

```tsx
import { useState } from 'react';
import { formatDateTimeField, parseTimeInput } from '../../../shared/dates';
import { Calendar } from '../Calendar';
import { Field } from '../Field';
import { CalendarIcon, ClockIcon } from '../icons';
import { Popover } from '../Popover';
import { btnPrimary, inputClass } from '../ui';

/** Кнопка поля с плавающей подписью (§6.3 этапа 1.5): высота 56 px, значение под подписью. */
const fieldButtonClass =
  'flex h-14 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 pt-5 pb-1 text-left text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Панель поля даты и времени: календарь (дни после сегодня недоступны) и строка «Время» с «Готово». Выбор дня сразу
 * ставит дату и панель не закрывает; время применяется по «Готово» или Enter, только если его меняли (иначе остаётся
 * «живым»); неверное — ошибка в панели. Esc и уход из панели закрывают её без применения набранного времени.
 */
function DateTimePanel(props: {
  date: string;
  time: string;
  today: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  close: () => void;
}) {
  const [text, setText] = useState(props.time);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (edited) {
      const time = parseTimeInput(text);
      if (time === null) {
        setError('Введите время в виде ЧЧ:ММ');
        return;
      }
      props.onTime(time);
    }
    props.close();
  };
  return (
    <div>
      <Calendar value={props.date} today={props.today} max={props.today} onSelect={props.onDate} />
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-t border-field pt-3">
        <span aria-hidden="true" className="mt-3 text-muted">
          <ClockIcon />
        </span>
        <Field label="Время" error={error ?? undefined}>
          {(c) => (
            <input
              {...c}
              inputMode="numeric"
              autoComplete="off"
              placeholder="ЧЧ:ММ"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setEdited(true);
                setError(null);
              }}
              onKeyDown={(e) => {
                // Enter применяет время и закрывает панель, а не отправляет форму
                if (e.key !== 'Enter') return;
                e.preventDefault();
                apply();
              }}
              className={`${inputClass} py-2`}
            />
          )}
        </Field>
        <button type="button" onClick={apply} className={`${btnPrimary} mt-6`}>
          Готово
        </button>
      </div>
    </div>
  );
}

/**
 * Дата и время оплаты (§2.3, §6.5 этапа 1.5): «Сегодня, 10.10.2026, 15:58», «Вчера, …», иначе день недели. Подпись —
 * по типу операции (§6.2), иконка календаря. Ввода с клавиатуры в само поле нет: день выбирается в календаре, время —
 * в строке «Время». `time` — время, заданное руками или время операции; пусто — показывается «сейчас» (`nowTime`).
 */
export function DateTimeField(props: {
  label: string;
  date: string;
  time: string;
  nowTime: string;
  today: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
}) {
  const shown = formatDateTimeField(props.date, props.time || props.nowTime, props.today);
  return (
    <Field label={props.label} error={props.error} hint={props.hint} floating filled>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className="truncate">{shown}</span>
              <CalendarIcon />
            </>
          }
          ariaLabel={`${props.label}: ${shown}`}
          panelLabel={`${props.label}: календарь`}
          buttonClassName={fieldButtonClass}
          panelClassName="w-80"
          disabled={props.disabled}
        >
          {(close) => (
            <DateTimePanel
              date={props.date}
              time={props.time || props.nowTime}
              today={props.today}
              onDate={props.onDateChange}
              onTime={props.onTimeChange}
              close={() => close(true)}
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
```

- [ ] **Step 4: Use it in the form**

В `src/client/components/operation/OperationForm.tsx`:
1) после строки `import { invalidateOperations } from '../../lib/journal-mutations';` вставьте `import { useNowTime } from '../../lib/use-now';` (место среди импортов `../../lib/*` — любое); после строки `import { ComboSelect } from './ComboSelect';` вставьте `import { DateTimeField } from './DateTimeField';`; из импорта `'../ui'` уберите `floatingControlClass`;
2) после строки `  const today = todayInTimezone(p.timeZone);` (в начале `OperationEditor`) вставьте

```ts
  // «живое» время новой операции: поле показывает «сейчас» и обновляется раз в минуту (§2.3 этапа 1.5)
  const nowTime = useNowTime(p.timeZone);
```

3) блок

```tsx
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
```

замените на

```tsx
  /** Дата и время оплаты (§2.3, §6.5 этапа 1.5): у перевода — первым полем, у дохода и расхода — после контрагента. */
  const paidDateField = (
    <DateTimeField
      label={labels.paidDate}
      date={draft.paidDate}
      time={draft.paidTime}
      nowTime={nowTime}
      today={today}
      error={errors.paidAt}
      hint={lockHint}
      disabled={!!locked}
      onDateChange={(paidDate) => set({ paidDate }, 'paidAt')}
      onTimeChange={(paidTime) => set({ paidTime, paidTimeSet: true }, 'paidAt')}
    />
  );
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 5: E2E — helpers and the rate test**

В `e2e/operation-form.spec.ts` после строки `const table = (page: Page) => page.getByRole('table', { name: 'Операции' });` вставьте

```ts
/** Сегодня по Алматы (APP_TIMEZONE e2e-сервера), `YYYY-MM-DD`. */
const almatyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
const shiftDay = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** `YYYY-MM-DD` → «ДД.ММ.ГГГГ». */
const ru = (iso: string) => iso.split('-').reverse().join('.');
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * Выбрать день в календаре открытой панели поля даты (§6.5 этапа 1.5): фокус — на сегодняшнем дне; Shift+PageUp и PageUp
 * ведут к нужному месяцу, затем день — мышью по имени ячейки «15 июня 2021».
 */
async function pickDay(page: Page, panel: Locator, iso: string) {
  const [ty, tm] = almatyToday().split('-').map(Number) as [number, number];
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  let months = (ty - y) * 12 + (tm - m);
  for (; months >= 12; months -= 12) await page.keyboard.press('Shift+PageUp');
  for (; months > 0; months -= 1) await page.keyboard.press('PageUp');
  await panel.getByRole('gridcell', { name: `${d} ${MONTHS_GENITIVE[m - 1]} ${y}` }).click();
}
```

Тест «нет курса на дату…»: строку `  await dialog.getByLabel('Указать дату списания').fill('2021-06-15');` замените на

```ts
  // дата — в календаре поля «Указать дату списания» (§6.5); «Готово» закрывает панель, время остаётся «живым»
  await dialog.getByRole('button', { name: /^Указать дату списания:/ }).click();
  const calendar = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await pickDay(page, calendar, '2021-06-15');
  await calendar.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog.getByRole('button', { name: /^Указать дату списания:/ })).toHaveAccessibleName(/^Указать дату списания: Вторник, 15\.06\.2021, \d{2}:\d{2}$/);
```

(15.06.2021 — вторник.)

- [ ] **Step 6: E2E — date and time tests**

В конец `e2e/operation-form.spec.ts` добавьте:

```ts
test('дата и время оплаты: «Сегодня, …, ЧЧ:ММ», свой календарь и строка «Время»; время руками переносится в «похожий»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Время ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  // «живое» время: сегодня и «сейчас» (§2.3)
  await expect(when).toHaveAccessibleName(/^Указать дату списания: Сегодня, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);

  // вчера, 9:05: день — в календаре (панель не закрывается), время — в строке «Время», «Готово» закрывает
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Время').fill('9:05');
  await panel.getByRole('button', { name: 'Готово' }).click();
  await expect(panel).toBeHidden();
  await expect(when).toBeFocused();
  const yesterday = shiftDay(almatyToday(), -1);
  await expect(when).toHaveAccessibleName(`Указать дату списания: Вчера, ${ru(yesterday)}, 09:05`);
  const at = new Date(`${yesterday}T09:05:00+05:00`).toISOString();

  // «+ Добавить и создать похожий»: время, заданное руками, остаётся — выручку за смену вносят двумя операциями
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  let request = nextCreate(page);
  await dialog.getByRole('button', { name: 'Добавить и создать похожий' }).click();
  expect((await request).postDataJSON().paidAt).toBe(at);
  await expect(dialog.getByRole('status')).toContainText('Операция сохранена');
  await expect(when).toHaveAccessibleName(`Указать дату списания: Вчера, ${ru(yesterday)}, 09:05`);
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('200');
  request = nextCreate(page);
  await submit(dialog).click();
  expect((await request).postDataJSON().paidAt).toBe(at);
  await expect(dialog).toBeHidden();

  // неверное время — ошибка в панели, панель остаётся; Esc закрывает её, время остаётся «живым»
  const again = await openForm(page, 'Расход');
  const againWhen = again.getByRole('button', { name: /^Указать дату списания:/ });
  await againWhen.click();
  await panel.getByLabel('Время').fill('25:00');
  await panel.getByRole('button', { name: 'Готово' }).click();
  await expect(panel).toContainText('Введите время в виде ЧЧ:ММ');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(again).toBeVisible();
  await expect(againWhen).toHaveAccessibleName(/^Указать дату списания: Сегодня, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
});

test('время позже «сейчас», заданное руками, — ошибка у поля «Это время ещё не наступило»', async ({ page }) => {
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  test.skip(nowHm >= '23:58', 'в последние минуты суток будущего времени «сегодня» уже нет');
  await login(page);
  const cid = await createCompany(page, `ТОО Будущее время ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Доход');
  await pick(page, 'На счёт', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('50');
  const when = dialog.getByRole('button', { name: /^Дата поступления денег:/ });
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Дата поступления денег: календарь' });
  await panel.getByLabel('Время').fill('23:59');
  await panel.getByRole('button', { name: 'Готово' }).click();
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/operations$/.test(new URL(r.url()).pathname)) posts += 1;
  });
  await submit(dialog).click();
  await expect(when).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Это время ещё не наступило');
  await expect(dialog).toBeVisible();
  expect(posts).toBe(0);
});
```


В конец `e2e/operation-edit.spec.ts` добавьте:

```ts
test('правка времени оплаты (§2.3): поле показывает время операции; без смены времени секунды не трогаются; время руками — ЧЧ:ММ:00', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Время правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const paidAt = todayAgo(500);
  const id = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt, accountId: cash, amount: 10000, comment: 'время' })).operation.id;
  await page.reload();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(paidAt));

  await rows(page).first().getByText('время').click();
  const dialog = editForm(page);
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  await expect(when).toHaveAccessibleName(`Указать дату списания: Сегодня, ${day.split('-').reverse().join('.')}, ${hm}`);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  // правка без смены даты и времени — paidAt не уходит: секунды операции сохраняются (Review Focus 1)
  await dialog.getByLabel('Комментарий').fill('время 2');
  let patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'время 2' });
  await expect(dialog).toBeHidden();

  // время руками — ЧЧ:ММ:00 (00:00 сегодня всегда не позже «сейчас»)
  await rows(page).first().getByText('время 2').click();
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await panel.getByLabel('Время').fill('00:00');
  await panel.getByLabel('Время').press('Enter');
  await expect(panel).toBeHidden();
  const midnight = new Date(`${day}T00:00:00+05:00`).toISOString();
  patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 2, paidAt: midnight });
  await expect(dialog).toBeHidden();
  const saved = (await (await page.request.get(`${base}/operations/${id}`)).json()).operation as { paidAt: string };
  expect(saved.paidAt).toBe(midnight);
});
```

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Проверьте, что в `e2e/operation-form.spec.ts` нет невидимых символов: `grep -nP "[\x{200B}\x{00A0}\x{202F}]" e2e/operation-form.spec.ts` → пусто. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/use-now.ts tests/client/use-now.test.ts src/client/components/icons.tsx src/client/components/operation/DateTimeField.tsx src/client/components/operation/OperationForm.tsx e2e/operation-form.spec.ts e2e/operation-edit.spec.ts
git commit -m "feat: дата и время оплаты в одном поле — «Сегодня, 10.10.2026, 15:58», свой календарь и строка «Время»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: «Зарплата за {месяц}» — строка 1а

**Files:**
- Create: `src/client/components/operation/SalaryRow.tsx`
- Modify: `src/client/lib/operation-form.ts`, `src/client/lib/operation-options.ts`, `src/client/components/operation/OperationForm.tsx`, `tests/client/operation-form.test.ts`, `tests/client/operation-options.test.ts`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Consumes: `actionRowClass` (`components/operation/ActionRow.tsx`, план 1.5-3b); `Popover`; `HistoryIcon` (`icons.tsx`); `findCategory` (`lib/operation-options.ts`).
- Produces:
  - `salaryRowText(categoryName: string, accrualDate: string | null, paidDate: string): { text: string; muted: boolean }`, `firstOfMonth(year: number, month: number): string` (`lib/operation-form.ts`);
  - `salaryCategory(tree: CategoryTree, categoryId: number | null): CategoryNode | undefined` (`lib/operation-options.ts`);
  - `SalaryRow(props: { text: string; muted: boolean; selectedMonth: string | null; activeMonth: string; onPick: (date: string) => void; onClear: () => void })` — кнопка с именем `text`, панель «Месяц начисления».

- [ ] **Step 1: Write the failing unit tests**

В `tests/client/operation-form.test.ts`: в импорт добавьте `firstOfMonth`, `salaryRowText`; в конец файла:

```ts
describe('«Зарплата за {месяц}» (§6.7 строка 1а этапа 1.5)', () => {
  it('без даты сделки — месяц даты оплаты, приглушённо; с ней — её месяц', () => {
    expect(salaryRowText('Зарплата', null, '2026-10-04')).toEqual({ text: 'Зарплата за октябрь', muted: true });
    expect(salaryRowText('Зарплата', '2026-09-01', '2026-10-04')).toEqual({ text: 'Зарплата за сентябрь', muted: false });
    expect(salaryRowText('Администраторы', '2026-05-01', '2026-10-04')).toEqual({ text: 'Администраторы за май', muted: false });
  });

  it('другой год — с годом; дата сделки — первое число месяца (Review Focus 4)', () => {
    expect(salaryRowText('Зарплата', '2025-12-01', '2026-01-05')).toEqual({ text: 'Зарплата за декабрь 2025', muted: false });
    expect(firstOfMonth(2025, 12)).toBe('2025-12-01');
    expect(firstOfMonth(2026, 1)).toBe('2026-01-01');
  });
});
```

В `tests/client/operation-options.test.ts`: в импорт добавьте `salaryCategory`; в `describe('варианты списков формы операции', …)` в конец добавьте

```ts
  it('категория зарплаты — по эффективному systemKey, в том числе дочерняя', () => {
    expect(salaryCategory(tree, 10)?.name).toBe('Зарплата');
    expect(salaryCategory(tree, 11)?.name).toBe('Администраторы');
    expect(salaryCategory(tree, 21)).toBeUndefined();
    expect(salaryCategory(tree, null)).toBeUndefined();
  });
```

Run: `npx vitest run tests/client/operation-form.test.ts tests/client/operation-options.test.ts` → FAIL.

- [ ] **Step 2: Pure functions**

В конец `src/client/lib/operation-form.ts`:

```ts
/** Месяцы строки «{Категория} за {месяц}»: именительный падеж со строчной (§6.7 строка 1а этапа 1.5). */
const MONTHS_LOWER = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * Строка «Зарплата за сентябрь» (§6.7 строка 1а этапа 1.5): месяц — из даты сделки, а если её нет — из даты оплаты
 * (тогда текст приглушён). Год пишется, если он не совпадает с годом даты оплаты: «Зарплата за декабрь 2025».
 */
export function salaryRowText(categoryName: string, accrualDate: string | null, paidDate: string): { text: string; muted: boolean } {
  const source = accrualDate ?? paidDate;
  const month = Number(source.slice(5, 7));
  const year = source.slice(0, 4) === paidDate.slice(0, 4) ? '' : ` ${source.slice(0, 4)}`;
  return { text: `${categoryName} за ${MONTHS_LOWER[month - 1]}${year}`, muted: accrualDate === null };
}

/** Первое число месяца `YYYY-MM-01` — дата сделки при выборе месяца зарплаты (решение владельца 14.3 №4). */
export function firstOfMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}
```

В `src/client/lib/operation-options.ts` после функции `findCategory`:

```ts
/** Категория зарплаты (эффективный systemKey = salary): у неё вместо «Дата сделки отличается» — «{Категория} за {месяц}». */
export function salaryCategory(tree: CategoryTree, categoryId: number | null): CategoryNode | undefined {
  const node = findCategory(tree, categoryId);
  return node?.effectiveSystemKey === 'salary' ? node : undefined;
}
```

Run: `npx vitest run tests/client/operation-form.test.ts tests/client/operation-options.test.ts` → PASS.

- [ ] **Step 3: `SalaryRow`**

`src/client/components/operation/SalaryRow.tsx`:

```tsx
import { useState } from 'react';
import { firstOfMonth } from '../../lib/operation-form';
import { HistoryIcon } from '../icons';
import { Popover } from '../Popover';
import { actionRowClass } from './ActionRow';

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Сетка месяцев: год «‹ ›», 12 месяцев (выбранный — aria-pressed, фокус при открытии — на активном), «Как дата оплаты». */
function MonthGrid(props: { selected: string | null; active: string; onPick: (date: string) => void; onClear: () => void }) {
  const [year, setYear] = useState(Number(props.active.slice(0, 4)));
  const nav = (label: string, sign: string, delta: number) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setYear((y) => y + delta)}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{sign}</span>
    </button>
  );
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        {nav('Предыдущий год', '‹', -1)}
        <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold">
          {year}
        </p>
        {nav('Следующий год', '›', 1)}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_NAMES.map((name, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`;
          const selected = key === props.selected;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={selected}
              aria-label={`${name} ${year}`}
              data-autofocus={key === props.active ? '' : undefined}
              onClick={() => props.onPick(firstOfMonth(year, i + 1))}
              className={`min-h-11 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'bg-income font-semibold text-white' : 'hover:bg-field'}`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={props.onClear} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-income-strong hover:bg-field">
        Как дата оплаты
      </button>
    </div>
  );
}

/**
 * «{Категория} за {месяц}» (§6.7 строка 1а этапа 1.5) — вместо «Дата сделки отличается» у зарплаты: строка вида ActionRow,
 * нажатие открывает выбор месяца. Месяц пишет дату сделки первым числом месяца, «Как дата оплаты» её убирает.
 */
export function SalaryRow(props: {
  text: string;
  muted: boolean;
  /** `YYYY-MM` выбранного месяца (даты сделки) или null. */
  selectedMonth: string | null;
  /** `YYYY-MM`, с которого открывается панель: выбранный месяц, иначе месяц даты оплаты. */
  activeMonth: string;
  onPick: (date: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="border-b border-field">
      <Popover
        label={
          <>
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center text-muted">
              <HistoryIcon />
            </span>
            <span className={`min-w-0 flex-1 ${props.muted ? 'text-muted' : ''}`}>{props.text}</span>
          </>
        }
        ariaLabel={props.text}
        panelLabel="Месяц начисления"
        buttonClassName={`${actionRowClass} text-ink`}
        panelClassName="w-72"
      >
        {(close) => (
          <MonthGrid
            selected={props.selectedMonth}
            active={props.activeMonth}
            onPick={(date) => {
              props.onPick(date);
              close(true);
            }}
            onClear={() => {
              props.onClear();
              close(true);
            }}
          />
        )}
      </Popover>
    </div>
  );
}
```

- [ ] **Step 4: Use it in the form**

В `src/client/components/operation/OperationForm.tsx`:
1) в импорт из `'../../lib/operation-form'` добавьте `salaryRowText`; в импорт из `'../../lib/operation-options'` — `salaryCategory`; после строки `import { RateFix, type MissingRate } from './RateFix';` вставьте `import { SalaryRow } from './SalaryRow';`;
2) после строки `  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;` вставьте

```ts
  // зарплата (эффективный systemKey = salary): вместо «Дата сделки отличается» — «{Категория} за {месяц}» (§6.7, строка 1а)
  const salary = salaryCategory(p.data.categories, mainCategory);
```

3) в `rows` блок

```tsx
      {!transfer &&
        (draft.accrualOn ? (
          accrualField
        ) : (
```

замените на

```tsx
      {!transfer &&
        (salary ? (
          <SalaryRow
            {...salaryRowText(salary.name, draft.accrualOn ? draft.accrualDate : null, draft.paidDate)}
            selectedMonth={draft.accrualOn ? draft.accrualDate.slice(0, 7) : null}
            activeMonth={(draft.accrualOn ? draft.accrualDate : draft.paidDate).slice(0, 7)}
            onPick={(accrualDate) => set({ accrualOn: true, accrualDate }, 'accrualDate')}
            onClear={() => set({ accrualOn: false }, 'accrualDate')}
          />
        ) : draft.accrualOn ? (
          accrualField
        ) : (
```

(остальная часть блока — `ActionRow` «Дата сделки отличается» и закрывающие скобки — без изменений; смена категории на несистемную возвращает строку 1, дата сделки остаётся в черновике — поле «Дата сделки».)

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 5: E2E**

В конец `e2e/operation-form.spec.ts` добавьте:

```ts
test('«Зарплата за {месяц}»: месяц оплаты серым; выбор месяца — дата сделки первым числом; несистемная категория — поле «Дата сделки»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Зарплата за ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await page.reload();
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const CAP = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));
  const [y, m] = almatyToday().split('-').map(Number) as [number, number];
  // прошлый месяц; в январе — декабрь прошлого года (Review Focus 4)
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const pad = (n: number) => String(n).padStart(2, '0');

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('8000');
  await pick(page, 'Категория', 'Зарплата');
  // без даты сделки — месяц даты оплаты; строки «Дата сделки отличается» нет
  const current = dialog.getByRole('button', { name: `Зарплата за ${MONTHS[m - 1]}`, exact: true });
  await expect(current).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Дата сделки отличается' })).toHaveCount(0);

  // выбор прошлого месяца в панели: год «‹ ›», 12 месяцев
  await current.click();
  const months = page.getByRole('dialog', { name: 'Месяц начисления' });
  if (prev.y !== y) await months.getByRole('button', { name: 'Предыдущий год' }).click();
  await months.getByRole('button', { name: `${CAP[prev.m - 1]} ${prev.y}`, exact: true }).click();
  await expect(months).toBeHidden();
  const label = `Зарплата за ${MONTHS[prev.m - 1]}${prev.y !== y ? ` ${prev.y}` : ''}`;
  await expect(dialog.getByRole('button', { name: label, exact: true })).toBeFocused();

  // «Как дата оплаты» убирает дату сделки; снова прошлый месяц
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await months.getByRole('button', { name: 'Как дата оплаты' }).click();
  await expect(current).toBeVisible();
  await current.click();
  if (prev.y !== y) await months.getByRole('button', { name: 'Предыдущий год' }).click();
  await months.getByRole('button', { name: `${CAP[prev.m - 1]} ${prev.y}`, exact: true }).click();

  // несистемная категория — снова «Дата сделки», дата сделки сохранилась
  await pick(page, 'Категория', 'Аренда');
  await expect(dialog.getByRole('button', { name: /^Дата сделки:/ })).toHaveAccessibleName(`Дата сделки: 01.${pad(prev.m)}.${prev.y}`);
  await pick(page, 'Категория', 'Зарплата');
  await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  const request = nextCreate(page);
  await submit(dialog).click();
  expect((await request).postDataJSON().accrualDate).toBe(`${prev.y}-${pad(prev.m)}-01`);
  await expect(dialog).toBeHidden();
});
```

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/operation/SalaryRow.tsx src/client/lib/operation-form.ts src/client/lib/operation-options.ts src/client/components/operation/OperationForm.tsx tests/client/operation-form.test.ts tests/client/operation-options.test.ts e2e/operation-form.spec.ts
git commit -m "feat: строка «Зарплата за {месяц}» — дата сделки первым числом выбранного месяца

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Калькулятор в поле суммы

**Files:**
- Create: `src/client/lib/calculator.ts`, `tests/client/calculator.test.ts`, `src/client/components/operation/CalculatorPopover.tsx`
- Modify: `src/client/components/icons.tsx`, `src/client/components/operation/AmountField.tsx`, `src/client/components/operation/OperationForm.tsx`, `e2e/operation-form.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `CALC_MAX_LENGTH`, `evaluateAmount` (`shared/calc.ts`); `positiveAmount` (`lib/operation-form.ts`); `Popover`.
- Produces: `CALC_ROWS: readonly (readonly string[])[]`, `CALC_KEY_NAMES: Readonly<Record<string, string>>`, `pressCalcKey(expr: string, key: string): string` (`lib/calculator.ts`); `CalculatorIcon` (`icons.tsx`); `CalculatorPopover(props: { value: string; onChange: (text: string) => void; onEquals: () => void })`; `AmountField` — новое свойство `calculator?: boolean`, подсказка `CALC_HINT = 'Можно писать выражения: 1500+250*2'`.

- [ ] **Step 1: Write the failing unit test**

`tests/client/calculator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CALC_MAX_LENGTH, evaluateAmount } from '../../src/shared/calc';
import { CALC_KEY_NAMES, CALC_ROWS, pressCalcKey } from '../../src/client/lib/calculator';

describe('калькулятор поля суммы (§6.10 этапа 1.5)', () => {
  it('раскладка кнопок: 7 8 9 ÷ / 4 5 6 × / 1 2 3 \u2212 / 0 , = + / ( ) C ⌫; минус — U+2212', () => {
    expect(CALC_ROWS).toEqual([
      ['7', '8', '9', '÷'],
      ['4', '5', '6', '×'],
      ['1', '2', '3', '\u2212'],
      ['0', ',', '=', '+'],
      ['(', ')', 'C', '⌫'],
    ]);
    expect(CALC_KEY_NAMES['\u2212']).toBe('Минус');
    expect(CALC_KEY_NAMES['=']).toBe('Вычислить');
  });

  it('кнопки пишут в то же выражение; C очищает, ⌫ стирает последний символ', () => {
    let expr = '';
    for (const key of ['1', '5', '0', '0', '+', '2', '5', '0', '×', '2']) expr = pressCalcKey(expr, key);
    expect(expr).toBe('1500+250×2');
    expect(evaluateAmount(expr, 2)).toEqual({ ok: true, minor: 200000 });
    expect(pressCalcKey('12', '⌫')).toBe('1');
    expect(pressCalcKey('', '⌫')).toBe('');
    expect(pressCalcKey('12+3', 'C')).toBe('');
    expect(evaluateAmount(pressCalcKey('10', '\u2212') + '4', 2)).toEqual({ ok: true, minor: 600 });
  });

  it('у предела длины выражение не растёт (Review Focus 5)', () => {
    const full = '1'.repeat(CALC_MAX_LENGTH);
    expect(pressCalcKey(full, '2')).toBe(full);
    expect(pressCalcKey(full, '⌫')).toHaveLength(CALC_MAX_LENGTH - 1);
  });
});
```

Run: `npx vitest run tests/client/calculator.test.ts` → FAIL.

- [ ] **Step 2: `lib/calculator.ts`, `CalculatorIcon`**

`src/client/lib/calculator.ts`:

```ts
import { CALC_MAX_LENGTH } from '../../shared/calc';

/** Кнопки калькулятора по строкам (§6.10 этапа 1.5); минус — U+2212, как у ряда операторов поля суммы. */
export const CALC_ROWS: readonly (readonly string[])[] = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '\u2212'],
  ['0', ',', '=', '+'],
  ['(', ')', 'C', '⌫'],
];

/** Имена кнопок для программ чтения (у цифр имя — сама цифра). */
export const CALC_KEY_NAMES: Readonly<Record<string, string>> = {
  '÷': 'Деление',
  '×': 'Умножение',
  '\u2212': 'Минус',
  '+': 'Плюс',
  '=': 'Вычислить',
  ',': 'Запятая',
  '(': 'Открыть скобку',
  ')': 'Закрыть скобку',
  C: 'Очистить',
  '⌫': 'Стереть символ',
};

/** Нажатие кнопки, кроме «=»: выражение поля после нажатия. C — очистить, ⌫ — стереть последний символ; длиннее CALC_MAX_LENGTH не растёт. */
export function pressCalcKey(expr: string, key: string): string {
  if (key === 'C') return '';
  if (key === '⌫') return expr.slice(0, -1);
  const next = expr + key;
  return next.length > CALC_MAX_LENGTH ? expr : next;
}
```

В конец `src/client/components/icons.tsx`:

```tsx
/** Калькулятор — иконка в поле суммы (§6.10 этапа 1.5). */
export function CalculatorIcon() {
  return (
    <Svg>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="11" x2="8.01" y2="11" />
      <line x1="12" y1="11" x2="12.01" y2="11" />
      <line x1="16" y1="11" x2="16.01" y2="11" />
      <line x1="8" y1="15" x2="8.01" y2="15" />
      <line x1="12" y1="15" x2="12.01" y2="15" />
      <line x1="16" y1="15" x2="16.01" y2="15" />
      <line x1="8" y1="19" x2="16" y2="19" />
    </Svg>
  );
}
```

Run: `npx vitest run tests/client/calculator.test.ts` → PASS.

- [ ] **Step 3: `CalculatorPopover`**

`src/client/components/operation/CalculatorPopover.tsx`:

```tsx
import { CALC_KEY_NAMES, CALC_ROWS, pressCalcKey } from '../../lib/calculator';
import { CalculatorIcon } from '../icons';
import { Popover } from '../Popover';

/**
 * Калькулятор (§6.10 этапа 1.5): иконка в поле суммы открывает панель — строку выражения (то же значение, что в поле)
 * и кнопки не меньше 44×44 px. Кнопки пишут в выражение поля; «=» вычисляет его (`onEquals` — то же, что уход из поля)
 * и закрывает панель — ошибка видна у поля. Esc закрывает панель и возвращает фокус на иконку.
 */
export function CalculatorPopover(props: { value: string; onChange: (text: string) => void; onEquals: () => void }) {
  return (
    <Popover
      label={<CalculatorIcon />}
      ariaLabel="Калькулятор"
      buttonClassName="grid size-10 place-items-center rounded-lg text-muted hover:bg-card focus-visible:outline-2 focus-visible:outline-focus"
      align="right"
      panelClassName="w-72"
    >
      {(close) => (
        <div>
          <output aria-live="polite" className="mb-2 block min-h-11 truncate rounded-xl bg-field px-3 py-2 text-right text-xl font-semibold tabular-nums">
            {props.value || '0'}
          </output>
          <div className="grid grid-cols-4 gap-1.5">
            {CALC_ROWS.flat().map((key) => (
              <button
                key={key}
                type="button"
                aria-label={CALC_KEY_NAMES[key]}
                onClick={() => {
                  if (key === '=') {
                    props.onEquals();
                    close(true);
                  } else props.onChange(pressCalcKey(props.value, key));
                }}
                className={`min-h-11 min-w-11 rounded-xl text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  key === '=' ? 'bg-income-strong text-white' : /^[\d,]$/.test(key) ? 'bg-field' : 'bg-canvas'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 4: `AmountField` — icon, hint, 44 px operators**

В `src/client/components/operation/AmountField.tsx`:
1) после строки `import { useAutoFocus } from '../useAutoFocus';` вставьте `import { CalculatorPopover } from './CalculatorPopover';`;
2) после константы `OPERATORS` вставьте

```ts
/** Подсказка поля суммы с калькулятором (§6.10 этапа 1.5). */
export const CALC_HINT = 'Можно писать выражения: 1500+250*2';
```

3) в тип свойств после `  className?: string;` вставьте `  /** Иконка калькулятора в поле и подсказка про выражения (§6.10): у основной суммы формы. */` и `  calculator?: boolean;`;
4) в ряду операторов у кнопки класс `"rounded-xl bg-field py-2 text-lg font-semibold"` замените на `"min-h-11 rounded-xl bg-field py-2 text-lg font-semibold"` (цель касания не меньше 44 px — отложенное 6a №1);
5) в `return (` у `<Field` строку `      hint={props.hint}` замените на `      hint={props.hint ?? (props.calculator ? CALC_HINT : undefined)}`, а содержимое функции-ребёнка

```tsx
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
```

замените на

```tsx
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
            className={`${floatingControlClass} font-semibold tabular-nums ${props.calculator && !props.disabled ? 'pr-14' : ''}`}
          />
          {props.calculator && !props.disabled && (
            <div className="absolute top-1/2 right-2 -translate-y-1/2">
              <CalculatorPopover
                value={props.value}
                onChange={(text) => {
                  props.onChange(text);
                  setCalcError(null);
                }}
                onEquals={evaluate}
              />
            </div>
          )}
        </>
      )}
```

В `src/client/components/operation/OperationForm.tsx` в `amountField` после строки `      hint={lockHint}` вставьте `      calculator`.

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 5: E2E**

В конец `e2e/operation-form.spec.ts` добавьте:

```ts
test('калькулятор по иконке в поле суммы: кнопки пишут в выражение, «=» вычисляет и закрывает; ошибка — у поля; кнопки не меньше 44 px', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Калькулятор ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveAccessibleDescription('Можно писать выражения: 1500+250*2');
  const calc = dialog.getByRole('button', { name: 'Калькулятор' });
  await calc.click();
  const panel = page.getByRole('dialog', { name: 'Калькулятор' });
  for (const key of ['1', '5', '0', '0', 'Плюс', '2', '5', '0', 'Умножение', '2']) await panel.getByRole('button', { name: key, exact: true }).click();
  await expect(amount).toHaveValue('1500+250×2');
  await expect(panel.locator('output')).toHaveText('1500+250×2');
  const box = (await panel.getByRole('button', { name: '7', exact: true }).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await panel.getByRole('button', { name: 'Вычислить' }).click();
  await expect(panel).toBeHidden();
  await expect(amount).toHaveValue('2000');
  await expect(calc).toBeFocused();

  // деление на ноль: «=» закрывает панель, ошибка — у поля, выражение остаётся для правки (Review Focus 5)
  await calc.click();
  await panel.getByRole('button', { name: 'Деление' }).click();
  await panel.getByRole('button', { name: '0', exact: true }).click();
  await panel.getByRole('button', { name: 'Вычислить' }).click();
  await expect(panel).toBeHidden();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Деление на ноль');
  await expect(amount).toHaveValue('2000÷0');
  // «C» очищает; Esc закрывает только панель — окно открыто
  await calc.click();
  await panel.getByRole('button', { name: 'Очистить' }).click();
  await expect(amount).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(calc).toBeFocused();
});
```

В `e2e/mobile.spec.ts`, тест «сценарий 4 §10…», после строки `  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();` вставьте

```ts
  // ряд операторов — цель касания не меньше 44 px (отложенное 6a №1); рядом — иконка калькулятора
  expect((await dialog.getByRole('button', { name: 'Оператор умножение' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(dialog.getByRole('button', { name: 'Калькулятор' })).toBeVisible();
```

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/calculator.ts tests/client/calculator.test.ts src/client/components/icons.tsx src/client/components/operation/CalculatorPopover.tsx src/client/components/operation/AmountField.tsx src/client/components/operation/OperationForm.tsx e2e/operation-form.spec.ts e2e/mobile.spec.ts
git commit -m "feat: калькулятор по иконке в поле суммы; операторы на телефоне — 44 px

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Визуальная сверка — календарь, калькулятор, правка; итоговый прогон `npm run shots:ux`

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: `DateTimeField` (задача 3), «Зарплата за …» (задача 4), калькулятор (задача 5).
- Produces: снимки `c12-income-datepicker.png`, `c13-calculator.png`; итог сверки плана 1.5-3 в отчёте задачи.

- [ ] **Step 1: Add the scenarios**

В `scripts/ux-shots.ts` в `SCENARIOS` после сценария `c11-income-project-dd.png` вставьте:

```ts
  {
    ours: 'c12-income-datepicker.png',
    finmap: '12-income-datepicker.png',
    path: 'log',
    act: async (p) => {
      // календарь поля «Дата поступления денег» со строкой «Время» (§6.5)
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: /^Дата поступления денег:/ }).click();
      await p.getByRole('dialog', { name: 'Дата поступления денег: календарь' }).waitFor();
    },
  },
  {
    ours: 'c13-calculator.png',
    finmap: '13c-calculator.png',
    path: 'log',
    act: async (p) => {
      // калькулятор по иконке в поле суммы (§6.10)
      await openForm('Расход')(p);
      await newForm(p).getByRole('button', { name: 'Калькулятор' }).click();
      await p.getByRole('dialog', { name: 'Калькулятор' }).waitFor();
    },
  },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 40 из 40.` Часы браузера заморожены на 10.10.2026 15:58 по Алматы: поле даты должно показать «Сегодня, 10.10.2026, 15:58», как на снимке Finmap `06`. Упавший сценарий — исправьте локатор сценария и запустите ещё раз.

- [ ] **Step 3: Compare the form screens and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `05-op-edit` ↔ `c05-op-edit`, `06-income` ↔ `c06-income`, `07-income-expanded` ↔ `c07-income-expanded`, `09-income-category-dd` ↔ `c09-income-category-dd`, `12-income-datepicker` ↔ `c12-income-datepicker`, `13c-calculator` ↔ `c13-calculator`, `15-expense` ↔ `c15-expense`, `16-transfer` ↔ `c16-transfer`, а также телефон `m04-op-open` ↔ `cm04-op-open`, `m05-income` ↔ `cm05-income`.

В отчёт задачи (не в файл) — таблица по экранам 05, 06, 07, 09, 12, 13, 15, 16 (и телефону): «совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** поле «Сегодня, 10.10.2026, 15:58» с иконкой календаря и подписью по типу; календарь (месяц в шапке, «« ‹ › »», неделя с понедельника, сегодня выделено) и строка «Время»; иконка калькулятора в поле суммы; на `05` — строки «Зарплата за {месяц}» (если первая операция демо-журнала — зарплата), «Разделить платёж», «Добавить проект…», «Дублировать платёж», «Удалить платёж», «Сохранить изменения»;
- **отличаются намеренно:** калькулятор своего вида (§6.10, §14.1) с кнопками ( ) C ⌫ и без AC ± %; в календаре кнопка «Готово» и поле «Время» вводом; нет «Сделать повторяющимся» (этап 3) и «Изменить в перевод» (план 1.5-6); цвета и шрифт;
- **отличается, план 1.5-5:** раскладка телефона (кнопки операций, нижняя панель) — формы на телефоне уже по §8.7.

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — календарь с временем и калькулятор формы

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-11-stage1_5-plan3c-followups.md` (пишет контролёр).
- План 1.5-3 закрыт целиком: §6.1–6.7 (кроме строки 4), §6.9, §6.10, §2.3. Закрыты отложенные: 6a №1 (кнопки операторов 44 px; вставка оператора кнопкой у предела длины — `pressCalcKey` в калькуляторе, у ряда операторов осталось как было).
- Следующий план — 1.5-4 «Экраны настроек». Строка 4 «Изменить в перевод» и `convertToTransferDraft` — план 1.5-6 (место в `rows` уже отмечено комментарием).
- Замечания для итогов (followups):
  - форма, открытая через полночь, показывает «Вчера» и сохраняет вчерашнюю дату (как и раньше, отложенное 6a №5);
  - время, набранное в панели и не применённое «Готово», теряется при Esc и уходе из панели (решение 2).
