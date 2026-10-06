# Этап 1, план 4a: курсы и операции — серверное ядро — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина шага 4 §11 спецификации — серверная часть:
- десятичная арифметика курсов и распределение сумм методом наибольшего остатка;
- ручные курсы на дату и фиксированные курсы компании, определение курса по §4.3 (без Нацбанка — см. «Решения»);
- сервис операций: доходы, расходы, переводы, разбиения на строки, теги, все инварианты §4.6 (1–7, 11), пересчёт `rate`/`baseAmount`, оптимистичная блокировка, мягкое удаление и восстановление;
- настоящие проверки «на справочник ссылаются операции» (инвариант 9) и балансы счетов (§4.7) вместо заглушек плана 3a;
- блокировка смены валюты счёта и базовой валюты компании (`CURRENCY_LOCKED`);
- API балансов компании и сводки для переключателя.

Вторая половина шага 4 — **план 4b**: левая панель счетов с балансами, балансы в переключателе, экран «Курсы», блокировка полей валюты в интерфейсе, вложения, `seed:demo` и сверка балансов на нём (§12).

**Architecture:**
- **`src/shared/decimal.ts`** — курсы как `bigint` с 20 знаками после запятой (`Dec`): разбор, деление с half-up, округление до 10 значащих цифр для показа, пересчёт суммы между валютами в минимальных единицах. Без внешних библиотек.
- **`src/shared/money.ts`** — `allocate()`: метод наибольшего остатка (§4.1).
- **Модуль `rates`** — ручные курсы (уровень экземпляра, история с `companyId = null`), фиксированные курсы (уровень компании), `resolve()` по правилам §4.3.
- **Модуль `operations`** — сервис с проверкой инвариантов в одной транзакции с записью (`mutate`), маршруты `POST/GET/PATCH/DELETE …/operations/:id` и `POST …/:id/restore`. Лента журнала с фильтрами — шаг 5.
- **`ReferencesService` / `BalancesService`** — настоящие реализации на таблицах операций, подключаются в `app.ts`. Заглушки остаются значениями по умолчанию для модульных тестов сервисов.

**Tech Stack:** как в планах 1–3 (Node 24, Fastify 5, better-sqlite3, Drizzle 0.45, zod 4, Vitest).

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.1, §4.2 (`companies.baseCurrency`), §4.3, §4.4 (`accounts`), §4.5, §4.6, §4.7, §6 (Валюты, Фиксированные курсы, Операции — кроме списка, Балансы, Компании `summary`), §6.2, §10, §11 шаг 4.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

1. **Курсы Нацбанка пока не загружаются** (решение заказчика 2026-10-06). Источники курса: ручной курс на дату (`exchange_rates.source = 'manual'`) и фиксированный курс компании. Правила §4.3 п. 1–3, 5–6 работают как в спецификации; п. 4 (запрос к Нацбанку при промахе) и таблица `rate_misses` появятся вместе с загрузкой Нацбанка. Колонка `source` сразу допускает `'nbrk'`, чтобы загрузчик добавился без миграции данных.
2. **`big.js` заменён собственным модулем на `bigint`.** Семантика §4.3 сохраняется: 20 знаков после запятой без промежуточного округления, half-up до минимальной единицы результата, показ курса — 10 значащих цифр. Причина: установка пакета требует сетевого доступа, а нужная арифметика укладывается в ~80 строк с тестами.
3. **Пустые строки у дохода/расхода.** Если клиент не прислал строк, сервер создаёт одну строку без статьи и проекта на всю сумму (§4.5: «у дохода и расхода не меньше одной строки»).
4. **Правка удалённой операции** — 409 `VERSION_CONFLICT` «Операция удалена — обновите страницу»: это тот же случай «операцию изменили после загрузки».
5. **Нарушение инварианта 5** (чужой счёт, статья, проект, контрагент, тег) — 422 `INVARIANT_5` с `fields` для подсветки поля (§4.6 п. 12: «нарушение остальных инвариантов — `INVARIANT_<номер>`»).

## Global Constraints

- **Суммы** — целые числа в минимальных единицах валюты счёта, `> 0`, безопасные целые (`Number.isSafeInteger`). Количество знаков — из справочника валют (`getCurrency(code).minorUnits`).
- **Время.** `paidAt` хранится как UTC ISO фиксированной ширины (`new Date(x).toISOString()`); на входе — ISO-строка с `Z` или смещением. Календарная дата операции — дата `paidAt` в `APP_TIMEZONE`. `accrualDate` — `YYYY-MM-DD` или `null`.
- **Курсы** — десятичные строки (`TEXT`, до 10 знаков после запятой на входе), курс за 1 единицу. В `operations.rate` — курс к базовой валюте, округлённый half-up до 10 значащих цифр. `baseAmount` всегда из неокруглённого курса:
  `baseAmount = round_half_up(amount / 10^minor(X) × rate × 10^minor(B))`.
- **Распределение** `baseAmount` по строкам — метод наибольшего остатка пропорционально `amount` строк; при равенстве остатков — по порядку строк; сумма частей равна целому.
- **Определение курса X к базовой B на дату D:**
  1. X = B → `1`;
  2. фиксированный курс компании для X, период которого покрывает D (`validFrom ≤ D ≤ validTo`, пустой `validTo` — бессрочно);
  3. иначе `rate(X→KZT, D) / rate(B→KZT, D)`, курс KZT→KZT = 1;
  4. курс к KZT на D — из `exchange_rates` (любой источник) за D или ближайший предыдущий, но не старше 7 дней;
  5. иначе 422 `RATE_UNAVAILABLE` «Нет курса {валюта} на {ДД.ММ.ГГГГ}».
- **Ручной курс** вводится на одну дату; ключ (date, currency) уникален; ручной курс не перезаписывает существующий. Курс тенге не вводится. Любое изменение ручного курса пишется в историю (`entity: 'rate'`, `companyId: null`).
- **Фиксированный курс** — курс 1 единицы валюты в базовой валюте компании на период; периоды одной валюты в компании не пересекаются; для базовой валюты компании не задаётся. История: `entity: 'fixed_rate'`. Изменение фиксированного курса **не пересчитывает** сохранённые операции.
- **Инварианты операций (§4.6)** проверяются в сервисе до записи; запись и история — в одной транзакции (`mutate`):
  1. сумма `lines.amount` = `amount` (если строки есть);
  2. сумма `lines.baseAmount` = `baseAmount`;
  3. статья соответствует типу (доход — доходная, расход — расходная), у перевода статьи нет;
  4. у перевода `accountId ≠ toAccountId`; при одной валюте `toAmount = amount`;
  5. счёт, статьи, проекты, контрагент, теги — той же компании;
  6. дата `paidAt` не позже конца сегодняшнего дня в `APP_TIMEZONE` и не раньше `openedAt` каждого затронутого счёта;
  7. новый выбор архивного счёта, статьи, проекта, контрагента или тега запрещён; у операции на архивном счёте нельзя менять `amount`, `toAmount`, `paidAt`, `accountId`, `toAccountId`, её нельзя удалить; удалённую операцию на архивном счёте нельзя восстановить;
  11. восстановление заново проверяет 3–7 на текущем состоянии; архивные статья, проект, контрагент, теги, уже бывшие у операции, не мешают.
- **Коды ошибок:** нарушение 7 — `ARCHIVED_REFERENCE`; остальных — `INVARIANT_<n>`; устаревшая версия — 409 `VERSION_CONFLICT`; нет курса — 422 `RATE_UNAVAILABLE`; смена валюты при операциях — 422 `CURRENCY_LOCKED`.
- **Перевод:** строк 0 или 1 (только проект, без статьи, сумма = `amount`); контрагента нет. **Доход/расход:** счёта зачисления и `toAmount` нет.
- **Пересчёт** `rate` и `baseAmount` — при создании и при изменении `paidAt`, `amount`, `accountId`, `toAccountId`, `toAmount`; при правке других полей значения не меняются.
- **Баланс счёта** = `startingBalance` + поступления - списания по операциям со `status = 'actual'` и `deletedAt IS NULL`; перевод уменьшает исходный счёт на `amount`, увеличивает целевой на `toAmount`.
- **Ссылки (инвариант 9)** считают и мягко удалённые операции. `earliestOperationDate` — по неудалённым (удалённая операция при восстановлении снова проверяет `openedAt`, инвариант 11).
- **«Всего на счетах»** — сумма балансов неархивных счетов в базовой валюте по курсу на сегодня; валюты без курса не входят в итог и перечисляются в `unavailable`.
- **Изоляция:** объект другой компании → 404. Архивная компания — только чтение (422 `ARCHIVED_REFERENCE`).
- **Безопасность хуков среды:** shell-команды не должны содержать подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`, коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Код с невидимыми или особыми символами пишется через `\uXXXX`.

## Review Focus

1. **Операция в валюте, отличной от базовой, без курса на дату** — 422 `RATE_UNAVAILABLE` «Нет курса USD на 09.10.2026», операция не создаётся; ручной курс на D действует на D…D+7 и не действует на D+8. Тесты — в задачах 3 и 4.
2. **Правка комментария после смены курса** не меняет `rate` и `baseAmount`; правка суммы пересчитывает по новому курсу. Тест — в задаче 5.
3. **Операция на архивном счёте:** сумма, дата и счета заблокированы, удалить нельзя, комментарий и дата сделки меняются, баланс архивного счёта остаётся нулевым. Тест — в задаче 5.
4. **Восстановление удалённой операции после сдвига `openedAt` счёта позже её даты** — 422 `INVARIANT_6`; восстановление операции с архивной статьёй проходит, с архивным счётом — нет. Тест — в задаче 5.
5. **Перевод KZT → USD**: балансы обоих счетов, `baseAmount` по исходной стороне, итог «всего на счетах» в базовой валюте и валюта без курса в `unavailable`. Тесты — в задачах 6 и 7.

---

## Карта файлов

```
src/shared/
  decimal.ts                 # Dec (bigint, 20 знаков): parseDecimal, decToString, divDec, roundSignificant, convertMinor (новый)
  money.ts                   # + allocate
  dates.ts                   # + addDays
  schemas/rates.ts           # ручные и фиксированные курсы (новый)
  schemas/operations.ts      # операции (новый)
src/server/
  db/schema.ts               # + exchangeRates, fixedRates, operations, operationLines, operationTags
  db/migrations/0003_*.sql   # генерируется drizzle-kit
  modules/rates/{service,routes}.ts        # (новые)
  modules/operations/{service,routes}.ts   # (новые)
  modules/references/service.ts            # + createOperationsReferences (настоящая реализация)
  modules/balances/service.ts              # + createLedgerBalances (настоящая реализация)
  modules/balances/routes.ts               # GET /companies/:cid/balances, GET /companies/summary (новый)
  modules/companies/service.ts             # CURRENCY_LOCKED для baseCurrency
  app.ts                                   # подключение rates, operations, балансов, настоящих ссылок
tests/shared/decimal.test.ts, money.test.ts, dates.test.ts
tests/server/schema-0003.test.ts, rates.test.ts, rates-api.test.ts,
  operations-create.test.ts, operations-update.test.ts, ledger.test.ts, balances-api.test.ts
```

---

### Task 1: Десятичная арифметика курсов и распределение сумм

**Files:**
- Create: `src/shared/decimal.ts`, `tests/shared/decimal.test.ts`
- Modify: `src/shared/money.ts`, `tests/shared/money.test.ts`, `src/shared/dates.ts`, `tests/shared/dates.test.ts`

**Interfaces:**
- Produces:
  - `type Dec = bigint` (значение × 10^20), `DEC_ONE`;
  - `parseDecimal(text: string, maxFraction?: number): Dec | null`;
  - `decToString(d: Dec): string` — без лишних нулей;
  - `divDec(a: Dec, b: Dec): Dec` — half-up на 20-м знаке, `b > 0`, `a ≥ 0`;
  - `roundSignificant(d: Dec, digits?: number): string` — для `operations.rate`, по умолчанию 10 значащих цифр;
  - `convertMinor(amount: number, rate: Dec, fromMinor: number, toMinor: number): number` — half-up от нуля, знак сохраняется;
  - `allocate(total: number, weights: number[]): number[]` — метод наибольшего остатка;
  - `addDays(date: string, days: number): string`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/decimal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { convertMinor, DEC_ONE, decToString, divDec, parseDecimal, roundSignificant } from '../../src/shared/decimal';

const dec = (s: string) => parseDecimal(s)!;

describe('decimal', () => {
  it('parseDecimal: запятая и точка, до 10 знаков после запятой; мусор и отрицательные — null', () => {
    expect(parseDecimal('475,12')).toBe(47512n * 10n ** 18n);
    expect(parseDecimal(' 1.5 ')).toBe(15n * 10n ** 19n);
    expect(parseDecimal('0')).toBe(0n);
    expect(parseDecimal('1.0123456789')).toBe(10123456789n * 10n ** 10n);
    expect(parseDecimal('1.01234567891')).toBeNull();
    for (const bad of ['', 'abc', '-1', '1e3', '1,2,3', '.5']) expect(parseDecimal(bad)).toBeNull();
  });

  it('decToString без лишних нулей', () => {
    expect(decToString(dec('475.1200'))).toBe('475.12');
    expect(decToString(DEC_ONE)).toBe('1');
    expect(decToString(0n)).toBe('0');
  });

  it('divDec: 20 знаков, half-up на последнем', () => {
    expect(decToString(divDec(DEC_ONE, dec('3')))).toBe('0.33333333333333333333');
    expect(decToString(divDec(dec('2'), dec('3')))).toBe('0.66666666666666666667');
    expect(decToString(divDec(dec('520'), dec('475')))).toBe('1.09473684210526315789');
  });

  it('roundSignificant: 10 значащих цифр, half-up', () => {
    expect(roundSignificant(divDec(DEC_ONE, dec('475')))).toBe('0.002105263158');
    expect(roundSignificant(divDec(dec('520'), dec('475')))).toBe('1.094736842');
    expect(roundSignificant(dec('475.12'))).toBe('475.12');
    expect(roundSignificant(dec('9999999999.5'))).toBe('10000000000');
  });

  it('convertMinor: валюты с 0, 2 и 3 знаками, half-up от нуля, знак сохраняется', () => {
    expect(convertMinor(10000, dec('475.12'), 2, 2)).toBe(4751200); // 100.00 USD → 47 512.00 KZT
    expect(convertMinor(1000, dec('3.2'), 0, 2)).toBe(320000); // 1000 JPY → 3 200.00 KZT
    expect(convertMinor(1500, dec('1550.5'), 3, 2)).toBe(232575); // 1.500 KWD → 2 325.75 KZT
    expect(convertMinor(1, dec('0.5'), 2, 2)).toBe(1); // 0.005 → 0.01
    expect(convertMinor(1, dec('0.49'), 2, 2)).toBe(0);
    expect(convertMinor(-1, dec('0.5'), 2, 2)).toBe(-1);
    expect(convertMinor(4751200, divDec(DEC_ONE, dec('475.12')), 2, 2)).toBe(10000);
    expect(convertMinor(123, DEC_ONE, 2, 2)).toBe(123);
  });
});
```

Допишите в `tests/shared/money.test.ts` (и `allocate` в импорт):

```ts
describe('allocate — метод наибольшего остатка', () => {
  it('части в сумме дают целое, остаток — наибольшим дробным частям, при равенстве — по порядку', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 2])).toEqual([3, 7]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(47512, [33, 33, 34])).toEqual([15679, 15679, 16154]);
    expect(allocate(0, [5, 7])).toEqual([0, 0]);
    expect(allocate(7, [3])).toEqual([7]);
  });

  it('сумма частей всегда равна целому', () => {
    for (const [total, weights] of [
      [999_999_999_999, [1, 2, 3, 4, 5, 6, 7]],
      [1, [3, 3, 3]],
      [12345, [10000, 1, 1]],
    ] as const) {
      const parts = allocate(total, [...weights]);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
      expect(parts.every((p) => Number.isSafeInteger(p) && p >= 0)).toBe(true);
    }
  });
});
```

Добавьте `addDays` в импорт `tests/shared/dates.test.ts` и допишите:

```ts
describe('addDays', () => {
  it('календарный сдвиг через границы месяца и года', () => {
    expect(addDays('2026-10-08', -7)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/decimal.test.ts tests/shared/money.test.ts tests/shared/dates.test.ts`
Expected: FAIL — нет модуля `decimal`, нет `allocate` и `addDays`.

- [ ] **Step 3: Implement**

`src/shared/decimal.ts`:

```ts
/**
 * Десятичные курсы без потери точности (§4.1, §4.3): bigint, хранящий значение × 10^20.
 * Промежуточных округлений нет; half-up — только на 20-м знаке деления и при переводе в минимальные единицы.
 */
export type Dec = bigint;

const SCALE = 20;
export const DEC_ONE: Dec = 10n ** BigInt(SCALE);

/** «475,12» / «1.5» → Dec. null — не неотрицательное число или больше maxFraction знаков после запятой. */
export function parseDecimal(text: string, maxFraction = 10): Dec | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > maxFraction) return null;
  return BigInt(m[1]!) * DEC_ONE + BigInt(frac.padEnd(SCALE, '0'));
}

/** Dec → «475.12» (без лишних нулей). */
export function decToString(d: Dec): string {
  const neg = d < 0n;
  const abs = neg ? -d : d;
  const int = abs / DEC_ONE;
  const frac = (abs % DEC_ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** a / b с округлением half-up на 20-м знаке (a ≥ 0, b > 0). */
export function divDec(a: Dec, b: Dec): Dec {
  if (b <= 0n || a < 0n) throw new Error('divDec: ожидаются a ≥ 0, b > 0');
  return (2n * a * DEC_ONE + b) / (2n * b);
}

/** Курс для показа: half-up до `digits` значащих цифр (§4.3: в operations.rate — 10). */
export function roundSignificant(d: Dec, digits = 10): string {
  if (d <= 0n) return decToString(d);
  const len = d.toString().length;
  if (len <= digits) return decToString(d);
  const drop = 10n ** BigInt(len - digits);
  const q = d / drop;
  const r = d % drop;
  return decToString((2n * r >= drop ? q + 1n : q) * drop);
}

/**
 * Сумма в минимальных единицах валюты X → минимальные единицы валюты B по курсу (Dec за 1 единицу X):
 * round_half_up(amount / 10^fromMinor × rate × 10^toMinor), половина — от нуля, знак сохраняется.
 */
export function convertMinor(amount: number, rate: Dec, fromMinor: number, toMinor: number): number {
  const neg = amount < 0;
  const n = BigInt(Math.abs(amount)) * rate * 10n ** BigInt(toMinor);
  const den = 10n ** BigInt(fromMinor) * DEC_ONE;
  const result = Number((2n * n + den) / (2n * den));
  return neg && result !== 0 ? -result : result;
}
```

Допишите в `src/shared/money.ts`:

```ts
/**
 * Распределение целого total на части пропорционально весам (§4.1): каждая часть округляется вниз,
 * недостающие единицы получают части с наибольшими дробными остатками, при равенстве — по порядку.
 * Сумма частей всегда равна total. Веса — положительные целые, total ≥ 0.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (weights.length === 0 || sum <= 0n) throw new Error('allocate: нужны положительные веса');
  const t = BigInt(total);
  const parts = weights.map((w) => (t * BigInt(w)) / sum);
  const rest = weights.map((w, i) => ({ i, r: (t * BigInt(w)) % sum }));
  let left = Number(t - parts.reduce((s, p) => s + p, 0n));
  rest.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rest) {
    if (left <= 0) break;
    parts[i]! += 1n;
    left--;
  }
  return parts.map((p) => Number(p));
}
```

Допишите в `src/shared/dates.ts`:

```ts
/** Календарная дата `YYYY-MM-DD`, сдвинутая на days дней. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/decimal.ts src/shared/money.ts src/shared/dates.ts tests/shared/decimal.test.ts tests/shared/money.test.ts tests/shared/dates.test.ts
git commit -m "feat: десятичная арифметика курсов на bigint, распределение методом наибольшего остатка

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Миграция 0003 — курсы и операции

**Files:**
- Create: `src/server/db/migrations/0003_*.sql` (генерируется), `tests/server/schema-0003.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/db/migrations/meta/*` (генерируется)

**Interfaces:**
- Produces: таблицы Drizzle `exchangeRates`, `fixedRates`, `operations`, `operationLines`, `operationTags`.

- [ ] **Step 1: Write the failing test**

`tests/server/schema-0003.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','KZT',0,'2026-10-01',0,'x')").run();
  return s;
}

const insertOp = "INSERT INTO operations (company_id, type, status, paid_at, account_id, amount, rate, base_amount, created_by, created_at, updated_at, version) VALUES (1,'income','actual','2026-10-06T00:00:00.000Z',?,100,'1',100,1,'x','x',1)";

describe('миграция 0003', () => {
  it('курс на дату по валюте уникален', () => {
    const s = setup();
    const ins = s.prepare("INSERT INTO exchange_rates (date, currency, rate_to_kzt, source, created_by, fetched_at) VALUES ('2026-10-06','USD',?, 'manual', 1, 'x')");
    ins.run('475.12');
    expect(() => ins.run('480')).toThrow(/UNIQUE/);
  });

  it('операция ссылается на существующий счёт; строки и теги удаляются вместе с операцией', () => {
    const s = setup();
    expect(() => s.prepare(insertOp).run(99)).toThrow(/FOREIGN KEY/);
    const op = s.prepare(insertOp).run(1);
    s.prepare("INSERT INTO tags (company_id, name, name_key, order_index, created_at) VALUES (1,'Т','т',0,'x')").run();
    s.prepare('INSERT INTO operation_lines (operation_id, position, amount, base_amount) VALUES (?,0,100,100)').run(op.lastInsertRowid);
    s.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?,1)').run(op.lastInsertRowid);
    expect(() => s.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?,1)').run(op.lastInsertRowid)).toThrow(/UNIQUE|PRIMARY/);
    s.prepare('DELETE FROM operations WHERE id = ?').run(op.lastInsertRowid);
    expect((s.prepare('SELECT COUNT(*) n FROM operation_lines').get() as { n: number }).n).toBe(0);
    expect((s.prepare('SELECT COUNT(*) n FROM operation_tags').get() as { n: number }).n).toBe(0);
  });

  it('справочник со ссылкой из операции нельзя удалить жёстко (страховка инварианта 9)', () => {
    const s = setup();
    s.prepare(insertOp).run(1);
    expect(() => s.prepare('DELETE FROM accounts WHERE id = 1').run()).toThrow(/FOREIGN KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/schema-0003.test.ts`
Expected: FAIL — `no such table: exchange_rates`.

- [ ] **Step 3: Implement**

`src/server/db/schema.ts` — `primaryKey` в импорт из `drizzle-orm/sqlite-core` и таблицы в конец файла:

```ts
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Календарная дата `YYYY-MM-DD`. */
    date: text('date').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    /** Курс за 1 единицу валюты в тенге, десятичная строка. */
    rateToKzt: text('rate_to_kzt').notNull(),
    source: text('source', { enum: ['nbrk', 'manual'] }).notNull(),
    createdBy: integer('created_by').references(() => users.id),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('exchange_rates_uq').on(t.date, t.currency), index('exchange_rates_currency_idx').on(t.currency, t.date)],
);

export const fixedRates = sqliteTable(
  'fixed_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    /** Курс за 1 единицу валюты в базовой валюте компании. */
    rate: text('rate').notNull(),
    validFrom: text('valid_from').notNull(),
    /** null — бессрочно. */
    validTo: text('valid_to'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('fixed_rates_company_idx').on(t.companyId, t.currency, t.validFrom)],
);

export const operations = sqliteTable(
  'operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
    /** На этапе 1 только 'actual'; 'planned' — для этапа 3. */
    status: text('status', { enum: ['actual', 'planned'] }).notNull(),
    paidAt: text('paid_at').notNull(),
    accrualDate: text('accrual_date'),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: integer('amount').notNull(),
    toAccountId: integer('to_account_id').references(() => accounts.id),
    toAmount: integer('to_amount'),
    /** Курс к базовой валюте для показа (10 значащих цифр). */
    rate: text('rate').notNull(),
    baseAmount: integer('base_amount').notNull(),
    counterpartyId: integer('counterparty_id').references(() => counterparties.id),
    comment: text('comment'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('operations_company_paid_idx').on(t.companyId, t.paidAt, t.id),
    index('operations_account_idx').on(t.accountId),
    index('operations_to_account_idx').on(t.toAccountId),
    index('operations_counterparty_idx').on(t.counterpartyId),
  ],
);

export const operationLines = sqliteTable(
  'operation_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    projectId: integer('project_id').references(() => projects.id),
    amount: integer('amount').notNull(),
    baseAmount: integer('base_amount').notNull(),
  },
  (t) => [
    index('operation_lines_op_idx').on(t.operationId, t.position),
    index('operation_lines_category_idx').on(t.categoryId),
    index('operation_lines_project_idx').on(t.projectId),
  ],
);

export const operationTags = sqliteTable(
  'operation_tags',
  {
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.tagId] }), index('operation_tags_tag_idx').on(t.tagId)],
);
```

Сгенерируйте миграцию:

Run: `npm run db:generate`
Expected: создан `src/server/db/migrations/0003_<случайное_имя>.sql` с пятью `CREATE TABLE` и индексами выше, обновлены `meta/_journal.json` и `meta/0003_snapshot.json`. Повторный запуск сообщает, что изменений нет.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/schema-0003.test.ts tests/server/schema-0002.test.ts tests/server/schema-0001.test.ts tests/server/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/db/schema.ts src/server/db/migrations tests/server/schema-0003.test.ts
git commit -m "feat: миграция 0003 — курсы, фиксированные курсы, операции, строки и теги операций

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Курсы — ручные на дату, фиксированные, определение курса по §4.3

**Files:**
- Create: `src/shared/schemas/rates.ts`, `src/server/modules/rates/service.ts`, `src/server/modules/rates/routes.ts`, `tests/server/rates.test.ts`, `tests/server/rates-api.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `parseDecimal`, `decToString`, `divDec`, `roundSignificant`, `DEC_ONE`, `addDays` (Task 1); таблицы `exchangeRates`, `fixedRates` (Task 2); `mutate`, `changedFields`, `requireCompany` (план 3a).
- Produces:
  - `RatesService`:
    - `resolve(companyId, baseCurrency, currency, date): { rate: Dec; display: string }` — бросает 422 `RATE_UNAVAILABLE`;
    - `kztRate(currency, date): { rate: Dec; date: string; source: 'nbrk' | 'manual' } | null`;
    - `listManual`, `addManual`, `updateManual`, `removeManual`;
    - `listFixed`, `addFixed`, `updateFixed`, `removeFixed`;
  - маршруты:
    - `GET /api/v1/currencies` → `{ currencies }`;
    - `GET /api/v1/rates?date&currency` → `{ rate: { currency, date, rateToKzt, effectiveDate, source } }`;
    - `GET/POST /api/v1/rates/manual`, `PATCH/DELETE /api/v1/rates/manual/:id`;
    - `GET/POST /api/v1/companies/:cid/fixed-rates`, `PATCH/DELETE …/:id`.

- [ ] **Step 1: Write the failing tests**

`tests/server/rates.test.ts` (сервис, правила §4.3):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { AppError } from '../../src/server/errors';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { DEC_ONE } from '../../src/shared/decimal';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup(base = 'KZT') {
  t = createTestDb();
  seedCurrencies(t.db);
  t.sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  const company = t.db.insert(companies).values({ name: 'ТОО', baseCurrency: base, createdAt: 'x' }).returning().get();
  const svc = createRatesService({ db: t.db, audit: createAuditService(t.db), now: () => new Date('2026-10-20T00:00:00.000Z') });
  return { svc, cid: company.id };
}

const unavailable = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('RATE_UNAVAILABLE');
    return (e as AppError).message;
  }
  throw new Error('ожидалась ошибка RATE_UNAVAILABLE');
};

describe('rates: определение курса (§4.3)', () => {
  it('курс базовой валюты = 1 без поиска', () => {
    const { svc, cid } = setup();
    expect(svc.resolve(cid, 'KZT', 'KZT', '2026-10-06')).toEqual({ rate: DEC_ONE, display: '1' });
  });

  it('ручной курс на D действует на D…D+7, не действует на D-1 и D+8', () => {
    const { svc, cid } = setup();
    svc.addManual({ date: '2026-10-01', currency: 'USD', rate: '475,12' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-01').display).toBe('475.12');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-08').display).toBe('475.12');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-10-09'))).toBe('Нет курса USD на 09.10.2026');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-09-30'))).toBe('Нет курса USD на 30.09.2026');
    expect(svc.kztRate('USD', '2026-10-05')).toMatchObject({ date: '2026-10-01', source: 'manual' });
  });

  it('берётся ближайший предыдущий курс, а не первый попавшийся', () => {
    const { svc, cid } = setup();
    svc.addManual({ date: '2026-10-01', currency: 'USD', rate: '470' }, 1);
    svc.addManual({ date: '2026-10-03', currency: 'USD', rate: '480' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-05').display).toBe('480');
  });

  it('кросс-курс через тенге при базовой USD: KZT→USD и EUR→USD', () => {
    const { svc, cid } = setup('USD');
    svc.addManual({ date: '2026-10-06', currency: 'USD', rate: '475' }, 1);
    svc.addManual({ date: '2026-10-06', currency: 'EUR', rate: '520' }, 1);
    expect(svc.resolve(cid, 'USD', 'KZT', '2026-10-06').display).toBe('0.002105263158');
    expect(svc.resolve(cid, 'USD', 'EUR', '2026-10-06').display).toBe('1.094736842');
    // курс EUR на 20.10 есть, а базовой USD к тенге — нет (последний 06.10, старше 7 дней): сообщение называет USD
    svc.addManual({ date: '2026-10-20', currency: 'EUR', rate: '525' }, 1);
    expect(unavailable(() => svc.resolve(cid, 'USD', 'EUR', '2026-10-20'))).toBe('Нет курса USD на 20.10.2026');
  });

  it('фиксированный курс действует на validFrom и validTo включительно, на validTo+1 — уже нет', () => {
    const { svc, cid } = setup();
    svc.addFixed(cid, { currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' }, 1);
    svc.addManual({ date: '2026-11-01', currency: 'USD', rate: '470' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-01').display).toBe('500');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-31').display).toBe('500');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-11-01').display).toBe('470');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-09-30'))).toBe('Нет курса USD на 30.09.2026');
  });
});
```

`tests/server/rates-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('rates API', () => {
  it('справочник валют и курс к тенге на дату с запасным предыдущим днём', async () => {
    h = await createApi('2026-10-20T00:00:00.000Z');
    const codes = (await h.req('GET', '/api/v1/currencies')).json().currencies.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['KZT', 'USD']));
    await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475.12' });
    const res = await h.req('GET', '/api/v1/rates?date=2026-10-03&currency=USD');
    expect(res.json().rate).toEqual({ currency: 'USD', date: '2026-10-03', rateToKzt: '475.12', effectiveDate: '2026-10-01', source: 'manual' });
    const none = await h.req('GET', '/api/v1/rates?date=2026-10-15&currency=USD');
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toMatchObject({ code: 'RATE_UNAVAILABLE', message: 'Нет курса USD на 15.10.2026' });
    expect((await h.req('GET', '/api/v1/rates?date=2026-02-31&currency=USD')).statusCode).toBe(400);
    expect((await h.req('GET', '/api/v1/rates?date=2026-10-15&currency=KZT')).json().rate).toMatchObject({ rateToKzt: '1', source: 'base' });
  });

  it('ручные курсы: создание, дубль даты, тенге, правка, удаление, история без компании', async () => {
    h = await createApi();
    const created = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475,12' });
    expect(created.statusCode).toBe(201);
    expect(created.json().rate).toMatchObject({ date: '2026-10-01', currency: 'USD', rateToKzt: '475.12', source: 'manual' });
    const id = created.json().rate.id as number;
    const dup = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '480' });
    expect(dup.json().error.fields.date).toBe('Курс на эту дату уже есть');
    const kzt = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'KZT', rate: '1' });
    expect(kzt.json().error.fields.currency).toBe('Курс тенге к тенге всегда 1');
    for (const rate of ['0', '-1', 'abc', '1.12345678901']) {
      expect((await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-02', currency: 'USD', rate })).statusCode).toBe(400);
    }
    expect((await h.req('PATCH', `/api/v1/rates/manual/${id}`, { rate: '480' })).json().rate.rateToKzt).toBe('480');
    await h.req('PATCH', `/api/v1/rates/manual/${id}`, { rate: '480.000' }); // то же значение — без истории
    expect((await h.req('GET', '/api/v1/rates/manual')).json().rates).toHaveLength(1);
    expect((await h.req('DELETE', `/api/v1/rates/manual/${id}`)).statusCode).toBe(204);
    expect((await h.req('DELETE', `/api/v1/rates/manual/${id}`)).statusCode).toBe(404);
    const audit = h.t.sqlite.prepare("SELECT action, company_id FROM audit_log WHERE entity = 'rate' ORDER BY id").all();
    expect(audit).toEqual([
      { action: 'create', company_id: null },
      { action: 'update', company_id: null },
      { action: 'delete', company_id: null },
    ]);
  });

  it('фиксированные курсы: периоды не пересекаются, базовую валюту нельзя, чужие id — 404', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const base = `/api/v1/companies/${cid}/fixed-rates`;
    const a = await h.req('POST', base, { currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' });
    expect(a.statusCode).toBe(201);
    expect(a.json().fixedRate).toMatchObject({ currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' });
    const overlap = await h.req('POST', base, { currency: 'USD', rate: '510', validFrom: '2026-10-15', validTo: null });
    expect(overlap.json().error.fields.validFrom).toBe('Период пересекается с другим фиксированным курсом');
    expect((await h.req('POST', base, { currency: 'USD', rate: '510', validFrom: '2026-11-01' })).statusCode).toBe(201);
    const reversed = await h.req('POST', base, { currency: 'USD', rate: '1', validFrom: '2027-02-01', validTo: '2027-01-01' });
    expect(reversed.json().error.fields.validTo).toBe('Дата окончания раньше начала');
    expect((await h.req('POST', base, { currency: 'KZT', rate: '1', validFrom: '2026-10-01' })).json().error.fields.currency).toBe(
      'Это базовая валюта компании',
    );
    // правка: сдвиг конца первого периода в бессрочный пересечётся со вторым
    const id = a.json().fixedRate.id as number;
    expect((await h.req('PATCH', `${base}/${id}`, { validTo: null })).json().error.fields.validFrom).toBe(
      'Период пересекается с другим фиксированным курсом',
    );
    expect((await h.req('PATCH', `${base}/${id}`, { rate: '505' })).json().fixedRate.rate).toBe('505');
    expect((await h.req('GET', base)).json().fixedRates.map((r: { validFrom: string }) => r.validFrom)).toEqual(['2026-10-01', '2026-11-01']);
    expect((await h.req('PATCH', `/api/v1/companies/${other}/fixed-rates/${id}`, { rate: '1' })).statusCode).toBe(404);
    expect((await h.req('DELETE', `/api/v1/companies/${other}/fixed-rates/${id}`)).statusCode).toBe(404);
    expect((await h.req('DELETE', `${base}/${id}`)).statusCode).toBe(204);
    expect(h.auditCount('fixed_rate')).toBe(4); // create ×2, update, delete
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/rates.test.ts tests/server/rates-api.test.ts`
Expected: FAIL — нет модуля `rates`, маршруты 404.

- [ ] **Step 3: Implement**

`src/shared/schemas/rates.ts`:

```ts
import { z } from 'zod';
import { isKnownCurrency } from '../currencies';
import { isValidDate } from '../dates';
import { parseDecimal } from '../decimal';

const rate = z
  .string()
  .trim()
  .refine((s) => {
    const d = parseDecimal(s);
    return d !== null && d > 0n;
  }, 'Курс — положительное число, не больше 10 знаков после запятой');
const date = z.string().refine(isValidDate, 'Неверная дата');
const currency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');

export const manualRateCreateSchema = z.object({ date, currency, rate });
export const manualRateUpdateSchema = z.object({ rate });

export const fixedRateCreateSchema = z.object({
  currency,
  rate,
  validFrom: date,
  validTo: date.nullable().default(null),
});
export const fixedRateUpdateSchema = z.object({
  rate: rate.optional(),
  validFrom: date.optional(),
  validTo: date.nullable().optional(),
});

export const rateQuerySchema = z.object({ date, currency });
```

`src/server/modules/rates/service.ts`:

```ts
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { addDays, formatDateRu } from '../../../shared/dates';
import { DEC_ONE, decToString, divDec, parseDecimal, roundSignificant, type Dec } from '../../../shared/decimal';
import type { Db } from '../../db/client';
import { exchangeRates, fixedRates } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type ManualRateRow = typeof exchangeRates.$inferSelect;
export type FixedRateRow = typeof fixedRates.$inferSelect;

export interface FixedRateInput {
  currency: string;
  rate: string;
  validFrom: string;
  validTo: string | null;
}

export interface RatesService {
  /** Курс валюты currency к базовой валюте компании на календарную дату (§4.3). 422 RATE_UNAVAILABLE, если курса нет. */
  resolve(companyId: number, baseCurrency: string, currency: string, date: string): { rate: Dec; display: string };
  /** Курс к тенге на дату: за эту дату или ближайший предыдущий не старше 7 дней; null — нет. */
  kztRate(currency: string, date: string): { rate: Dec; date: string; source: 'nbrk' | 'manual' | 'base' } | null;
  listManual(): ManualRateRow[];
  addManual(input: { date: string; currency: string; rate: string }, userId: number): ManualRateRow;
  updateManual(id: number, rate: string, userId: number): ManualRateRow;
  removeManual(id: number, userId: number): void;
  listFixed(companyId: number): FixedRateRow[];
  addFixed(companyId: number, input: FixedRateInput, userId: number): FixedRateRow;
  updateFixed(companyId: number, id: number, input: Partial<FixedRateInput>, userId: number): FixedRateRow;
  removeFixed(companyId: number, id: number, userId: number): void;
}

/** Окно запасного курса: ближайший предыдущий, но не старше 7 дней (§4.3 п. 5). */
const FALLBACK_DAYS = 7;

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const unavailable = (currency: string, date: string) => new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${currency} на ${formatDateRu(date)}`);
/** Каноническая запись курса: «475,1200» → «475.12». */
const canonical = (rate: string) => decToString(parseDecimal(rate)!);

export function createRatesService(d: { db: Db; audit: AuditService; now?: () => Date }): RatesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireManual(id: number): ManualRateRow {
    const row = db.select().from(exchangeRates).where(and(eq(exchangeRates.id, id), eq(exchangeRates.source, 'manual'))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Курс не найден');
    return row;
  }

  function requireFixed(companyId: number, id: number): FixedRateRow {
    const row = db.select().from(fixedRates).where(and(eq(fixedRates.id, id), eq(fixedRates.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Фиксированный курс не найден');
    return row;
  }

  /** Период фиксированного курса: конец не раньше начала, не пересекается с другими той же валюты в компании. */
  function checkPeriod(companyId: number, v: FixedRateInput, exceptId?: number): void {
    if (v.validTo !== null && v.validTo < v.validFrom) throw invalid({ validTo: 'Дата окончания раньше начала' });
    const clash = db
      .select({ id: fixedRates.id })
      .from(fixedRates)
      .where(
        and(
          eq(fixedRates.companyId, companyId),
          eq(fixedRates.currency, v.currency),
          v.validTo === null ? undefined : lte(fixedRates.validFrom, v.validTo),
          or(isNull(fixedRates.validTo), gte(fixedRates.validTo, v.validFrom)),
        ),
      )
      .all()
      .some((r) => r.id !== exceptId);
    if (clash) throw invalid({ validFrom: 'Период пересекается с другим фиксированным курсом' });
  }

  const svc: RatesService = {
    kztRate(currency, date) {
      if (currency === 'KZT') return { rate: DEC_ONE, date, source: 'base' }; // тенге к тенге — всегда 1, без записи в таблице
      const row = db
        .select()
        .from(exchangeRates)
        .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.date, date), gte(exchangeRates.date, addDays(date, -FALLBACK_DAYS))))
        .orderBy(desc(exchangeRates.date))
        .limit(1)
        .get();
      return row ? { rate: parseDecimal(row.rateToKzt, 20)!, date: row.date, source: row.source } : null;
    },

    resolve(companyId, baseCurrency, currency, date) {
      if (currency === baseCurrency) return { rate: DEC_ONE, display: '1' };
      const fixed = db
        .select()
        .from(fixedRates)
        .where(
          and(
            eq(fixedRates.companyId, companyId),
            eq(fixedRates.currency, currency),
            lte(fixedRates.validFrom, date),
            or(isNull(fixedRates.validTo), gte(fixedRates.validTo, date)),
          ),
        )
        .get();
      if (fixed) {
        const rate = parseDecimal(fixed.rate, 20)!;
        return { rate, display: roundSignificant(rate) };
      }
      const rx = svc.kztRate(currency, date);
      if (!rx) throw unavailable(currency, date);
      const rb = svc.kztRate(baseCurrency, date);
      if (!rb) throw unavailable(baseCurrency, date);
      const rate = divDec(rx.rate, rb.rate);
      return { rate, display: roundSignificant(rate) };
    },

    listManual() {
      return db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.source, 'manual'))
        .orderBy(desc(exchangeRates.date), asc(exchangeRates.currency))
        .all();
    },

    addManual(input, userId) {
      if (input.currency === 'KZT') throw invalid({ currency: 'Курс тенге к тенге всегда 1' });
      const exists = db
        .select({ id: exchangeRates.id })
        .from(exchangeRates)
        .where(and(eq(exchangeRates.date, input.date), eq(exchangeRates.currency, input.currency)))
        .get();
      if (exists) throw invalid({ date: 'Курс на эту дату уже есть' });
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .insert(exchangeRates)
          .values({
            date: input.date,
            currency: input.currency,
            rateToKzt: canonical(input.rate),
            source: 'manual',
            createdBy: userId,
            fetchedAt: now().toISOString(),
          })
          .returning()
          .get();
        record({ companyId: null, userId, entity: 'rate', entityId: row.id, action: 'create', diff: { date: row.date, currency: row.currency, rate: row.rateToKzt } });
        return row;
      });
    },

    updateManual(id, rate, userId) {
      const before = requireManual(id);
      const changes = changedFields({ rateToKzt: before.rateToKzt }, { rateToKzt: canonical(rate) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(exchangeRates).set(changes.after).where(eq(exchangeRates.id, id)).returning().get();
        record({ companyId: null, userId, entity: 'rate', entityId: id, action: 'update', diff: { date: row.date, currency: row.currency, ...changes } });
        return row;
      });
    },

    removeManual(id, userId) {
      const row = requireManual(id);
      mutate(db, audit, (tx, record) => {
        tx.delete(exchangeRates).where(eq(exchangeRates.id, id)).run();
        record({ companyId: null, userId, entity: 'rate', entityId: id, action: 'delete', diff: { date: row.date, currency: row.currency, rate: row.rateToKzt } });
      });
    },

    listFixed(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(fixedRates)
        .where(eq(fixedRates.companyId, companyId))
        .orderBy(asc(fixedRates.currency), asc(fixedRates.validFrom))
        .all();
    },

    addFixed(companyId, input, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      if (input.currency === company.baseCurrency) throw invalid({ currency: 'Это базовая валюта компании' });
      const v = { ...input, rate: canonical(input.rate) };
      checkPeriod(companyId, v);
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .insert(fixedRates)
          .values({ companyId, currency: v.currency, rate: v.rate, validFrom: v.validFrom, validTo: v.validTo, createdAt: now().toISOString() })
          .returning()
          .get();
        record({ companyId, userId, entity: 'fixed_rate', entityId: row.id, action: 'create', diff: { currency: row.currency, rate: row.rate, validFrom: row.validFrom, validTo: row.validTo } });
        return row;
      });
    },

    updateFixed(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireFixed(companyId, id);
      const patch = { ...input, ...(input.rate !== undefined ? { rate: canonical(input.rate) } : {}) };
      const changes = changedFields({ rate: before.rate, validFrom: before.validFrom, validTo: before.validTo }, patch);
      if (!changes) return before;
      checkPeriod(companyId, { currency: before.currency, rate: before.rate, validFrom: before.validFrom, validTo: before.validTo, ...changes.after }, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(fixedRates).set(changes.after).where(eq(fixedRates.id, id)).returning().get();
        record({ companyId, userId, entity: 'fixed_rate', entityId: id, action: 'update', diff: { currency: row.currency, ...changes } });
        return row;
      });
    },

    removeFixed(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireFixed(companyId, id);
      mutate(db, audit, (tx, record) => {
        tx.delete(fixedRates).where(eq(fixedRates.id, id)).run();
        record({ companyId, userId, entity: 'fixed_rate', entityId: id, action: 'delete', diff: { currency: row.currency, rate: row.rate, validFrom: row.validFrom, validTo: row.validTo } });
      });
    },
  };
  return svc;
}
```

`src/server/modules/rates/routes.ts`:

```ts
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { formatDateRu } from '../../../shared/dates';
import { decToString } from '../../../shared/decimal';
import {
  fixedRateCreateSchema,
  fixedRateUpdateSchema,
  manualRateCreateSchema,
  manualRateUpdateSchema,
  rateQuerySchema,
} from '../../../shared/schemas/rates';
import type { Db } from '../../db/client';
import { currencies } from '../../db/schema';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
import type { RatesService } from './service';

type P = { Params: { id: string } };
type CP = { Params: { cid: string; id: string } };

export function registerRatesRoutes(app: FastifyInstance, deps: { db: Db; rates: RatesService }): void {
  const { rates } = deps;

  app.get('/api/v1/currencies', async () => ({ currencies: deps.db.select().from(currencies).orderBy(asc(currencies.code)).all() }));

  app.get('/api/v1/rates', async (req) => {
    const q = rateQuerySchema.parse(req.query);
    const found = rates.kztRate(q.currency, q.date);
    if (!found) throw new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${q.currency} на ${formatDateRu(q.date)}`);
    return { rate: { currency: q.currency, date: q.date, rateToKzt: decToString(found.rate), effectiveDate: found.date, source: found.source } };
  });

  app.get('/api/v1/rates/manual', async () => ({ rates: rates.listManual() }));

  app.post('/api/v1/rates/manual', async (req, reply) => {
    const body = manualRateCreateSchema.parse(req.body);
    return reply.status(201).send({ rate: rates.addManual(body, req.user!.id) });
  });

  app.patch<P>('/api/v1/rates/manual/:id', async (req) => {
    const id = parseId(req.params.id);
    const { rate } = manualRateUpdateSchema.parse(req.body);
    return { rate: rates.updateManual(id, rate, req.user!.id) };
  });

  app.delete<P>('/api/v1/rates/manual/:id', async (req, reply) => {
    rates.removeManual(parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  const FIXED = '/api/v1/companies/:cid/fixed-rates';

  app.get<{ Params: { cid: string } }>(FIXED, async (req) => ({ fixedRates: rates.listFixed(parseId(req.params.cid)) }));

  app.post<{ Params: { cid: string } }>(FIXED, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = fixedRateCreateSchema.parse(req.body);
    return reply.status(201).send({ fixedRate: rates.addFixed(cid, body, req.user!.id) });
  });

  app.patch<CP>(`${FIXED}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = fixedRateUpdateSchema.parse(req.body);
    return { fixedRate: rates.updateFixed(cid, id, body, req.user!.id) };
  });

  app.delete<CP>(`${FIXED}/:id`, async (req, reply) => {
    rates.removeFixed(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });
}
```

`src/server/app.ts` — импорты и подключение (после `registerSplitPresetsRoutes`):

```ts
import { registerRatesRoutes } from './modules/rates/routes';
import { createRatesService } from './modules/rates/service';
```

```ts
  const rates = createRatesService({ db, audit, now });
  registerRatesRoutes(app, { db, rates });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/rates.test.ts tests/server/rates-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/rates.ts src/server/modules/rates src/server/app.ts tests/server/rates.test.ts tests/server/rates-api.test.ts
git commit -m "feat: курсы — ручные на дату и фиксированные, определение курса по §4.3 без Нацбанка

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Операции — создание и чтение со всеми инвариантами

**Files:**
- Create: `src/shared/schemas/operations.ts`, `src/server/modules/operations/service.ts`, `src/server/modules/operations/routes.ts`, `tests/helpers/ops.ts`, `tests/server/operations-create.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes:
  - `convertMinor` (Task 1), `allocate` (Task 1);
  - таблицы операций (Task 2);
  - `RatesService.resolve` (Task 3);
  - `mutate`, `requireCompany`, `createApi` (план 3a).
- Produces:
  - `operationCreateSchema`, `operationUpdateSchema`;
  - `OperationType`, `LineInput`, `OperationInput`, `OperationLineDto`, `OperationDto`;
  - `createOperationsService(d: { db; audit; rates; timezone; now? })` → `OperationsService { get(companyId, id); create(companyId, input, userId) }`;
  - маршруты `POST /api/v1/companies/:cid/operations` → 201 `{ operation }`, `GET …/operations/:id` → `{ operation }`;
  - тестовый помощник `opsWorld(now?)`.

- [ ] **Step 1: Write the failing tests**

`tests/helpers/ops.ts`:

```ts
import { createApi, type ApiHarness } from './api';

export interface OpsWorld {
  h: ApiHarness;
  cid: number;
  /** Счета: KZT и USD (открыты 2026-10-01, остаток 0). */
  kzt: number;
  usd: number;
  income: number;
  expense: number;
  project: number;
  project2: number;
  counterparty: number;
  tag: number;
  /** URL операций компании. */
  ops: string;
  /** POST с проверкой успеха; возвращает JSON. */
  post(url: string, body: unknown): Promise<any>;
}

/**
 * Компания с двумя счетами, статьями обоих видов, двумя проектами, контрагентом, тегом
 * и ручным курсом USD 475.12 на 2026-10-01. По умолчанию «сейчас» — 2026-10-06 12:00 UTC (17:00 по Алматы).
 */
export async function opsWorld(now = '2026-10-06T12:00:00.000Z'): Promise<OpsWorld> {
  const h = await createApi(now);
  const cid = await h.company('ТОО');
  const base = `/api/v1/companies/${cid}`;
  const post = async (url: string, body: unknown) => {
    const res = await h.req('POST', url, body);
    if (res.statusCode >= 300) throw new Error(`POST ${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const account = async (name: string, currency: string) =>
    (await post(`${base}/accounts`, { name, currency, openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
  const kzt = await account('Касса', 'KZT');
  const usd = await account('Валютный', 'USD');
  const income = (await post(`${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const expense = (await post(`${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const project = (await post(`${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await post(`${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const counterparty = (await post(`${base}/counterparties`, { type: 'client', name: 'ИП Клиент' })).counterparty.id as number;
  const tag = (await post(`${base}/tags`, { name: 'Смена' })).tag.id as number;
  await post('/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475.12' });
  return { h, cid, kzt, usd, income, expense, project, project2, counterparty, tag, ops: `${base}/operations`, post };
}
```

`tests/server/operations-create.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const create = (body: object) => w.h.req('POST', w.ops, body);
const opCount = () => (w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;

describe('operations: создание', () => {
  it('доход в базовой валюте: строка по умолчанию, курс 1, версия 1, теги без повторов, история', async () => {
    w = await opsWorld();
    const res = await create({
      type: 'income',
      paidAt: '2026-10-05T10:00:00+05:00',
      accountId: w.kzt,
      amount: 150000,
      counterpartyId: w.counterparty,
      tagIds: [w.tag, w.tag],
      comment: '  смена  ',
    });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op).toMatchObject({
      type: 'income',
      status: 'actual',
      paidAt: '2026-10-05T05:00:00.000Z',
      amount: 150000,
      rate: '1',
      baseAmount: 150000,
      version: 1,
      deletedAt: null,
      comment: 'смена',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      lines: [{ position: 0, categoryId: null, projectId: null, amount: 150000, baseAmount: 150000 }],
    });
    expect(w.h.auditCount('operation', 'create')).toBe(1);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation).toEqual(op);
  });

  it('расход в USD при базовой KZT: курс на дату, baseAmount, распределение по строкам наибольшим остатком', async () => {
    w = await opsWorld();
    const res = await create({
      type: 'expense',
      paidAt: '2026-10-03T10:00:00Z',
      accountId: w.usd,
      amount: 100,
      lines: [
        { categoryId: w.expense, projectId: w.project, amount: 33 },
        { categoryId: w.expense, projectId: w.project2, amount: 33 },
        { categoryId: w.expense, amount: 34 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    expect(op.lines.map((l: { baseAmount: number }) => l.baseAmount)).toEqual([15679, 15679, 16154]);
  });

  it('нет курса на дату — 422 RATE_UNAVAILABLE, операция не создаётся (Review Focus 1)', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const before = opCount();
    const err = fail(await create({ type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.usd, amount: 100 }), 422, 'RATE_UNAVAILABLE');
    expect(err.message).toBe('Нет курса USD на 09.10.2026');
    expect(opCount()).toBe(before);
  });

  it('инвариант 1: сумма строк не равна сумме операции', async () => {
    w = await opsWorld();
    fail(
      await create({
        type: 'expense',
        paidAt: '2026-10-05T10:00:00Z',
        accountId: w.kzt,
        amount: 100,
        lines: [
          { categoryId: w.expense, amount: 60 },
          { categoryId: w.expense, amount: 30 },
        ],
      }),
      422,
      'INVARIANT_1',
    );
  });

  it('инвариант 3: статья другого вида; статья у перевода', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    fail(await create({ type: 'income', paidAt, accountId: w.kzt, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] }), 422, 'INVARIANT_3');
    fail(
      await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100, lines: [{ categoryId: w.expense, projectId: w.project, amount: 47512 }] }),
      422,
      'INVARIANT_3',
    );
  });

  it('инвариант 4: перевод на тот же счёт; при одной валюте суммы равны; при разных нужна сумма зачисления', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    const kaspi = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.kzt, amount: 100 }), 422, 'INVARIANT_4');
    fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: kaspi, amount: 100, toAmount: 90 }), 422, 'INVARIANT_4');
    const same = await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: kaspi, amount: 100 });
    expect(same.json().operation).toMatchObject({ toAmount: 100, lines: [] });
    const noTo = fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 100 }), 400, 'VALIDATION');
    expect(noTo.fields?.toAmount).toBe('Укажите сумму зачисления');
  });

  it('инвариант 5: счёт, статья, проект, контрагент и тег другой компании — 422 с полем', async () => {
    w = await opsWorld();
    const other = await w.h.company('Чужая');
    const ob = `/api/v1/companies/${other}`;
    const acc = (await w.post(`${ob}/accounts`, { name: 'Чужой', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const cat = (await w.post(`${ob}/categories`, { kind: 'expense', name: 'Чужая' })).category.id;
    const prj = (await w.post(`${ob}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id;
    const cp = (await w.post(`${ob}/counterparties`, { type: 'client', name: 'Чужой' })).counterparty.id;
    const tg = (await w.post(`${ob}/tags`, { name: 'Чужой' })).tag.id;
    const base = { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    expect(fail(await create({ ...base, accountId: acc }), 422, 'INVARIANT_5').fields).toHaveProperty('accountId');
    expect(fail(await create({ ...base, lines: [{ categoryId: cat, amount: 100 }] }), 422, 'INVARIANT_5').fields).toHaveProperty('lines');
    expect(fail(await create({ ...base, lines: [{ projectId: prj, amount: 100 }] }), 422, 'INVARIANT_5').fields).toHaveProperty('lines');
    expect(fail(await create({ ...base, counterpartyId: cp }), 422, 'INVARIANT_5').fields).toHaveProperty('counterpartyId');
    expect(fail(await create({ ...base, tagIds: [tg] }), 422, 'INVARIANT_5').fields).toHaveProperty('tagIds');
  });

  it('инвариант 6: граница суток по Алматы и дата раньше открытия счёта', async () => {
    w = await opsWorld(); // сейчас 2026-10-06 17:00 по Алматы
    const base = { type: 'income', accountId: w.kzt, amount: 100 };
    expect((await create({ ...base, paidAt: '2026-10-06T18:59:00Z' })).statusCode).toBe(201); // 23:59 сегодня
    fail(await create({ ...base, paidAt: '2026-10-06T19:30:00Z' }), 422, 'INVARIANT_6'); // 00:30 завтра
    const early = fail(await create({ ...base, paidAt: '2026-09-30T10:00:00Z' }), 422, 'INVARIANT_6');
    expect(early.message).toBe('Счёт «Касса» открыт 01.10.2026 — операция не может быть раньше');
  });

  it('инвариант 7: новый выбор архивного счёта, статьи, проекта, контрагента, тега', async () => {
    w = await opsWorld();
    const b = `/api/v1/companies/${w.cid}`;
    const safe = (await w.post(`${b}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const store = (await w.post(`${b}/projects`, { name: 'Склад', templateKey: 'general' })).project.id;
    await w.post(`${b}/accounts/${safe}/archive`, {});
    await w.post(`${b}/categories/${w.expense}/archive`, {});
    await w.post(`${b}/projects/${store}/archive`, {});
    await w.post(`${b}/counterparties/${w.counterparty}/archive`, {});
    await w.post(`${b}/tags/${w.tag}/archive`, {});
    const base = { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    for (const body of [
      { ...base, accountId: safe },
      { ...base, lines: [{ categoryId: w.expense, amount: 100 }] },
      { ...base, lines: [{ projectId: store, amount: 100 }] },
      { ...base, counterpartyId: w.counterparty },
      { ...base, tagIds: [w.tag] },
    ]) {
      fail(await create(body), 422, 'ARCHIVED_REFERENCE');
    }
  });

  it('перевод KZT → USD: сумма зачисления, одна строка с проектом, без контрагента', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    const res = await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100, lines: [{ projectId: w.project, amount: 47512 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().operation).toMatchObject({ toAccountId: w.usd, toAmount: 100, rate: '1', baseAmount: 47512, lines: [{ categoryId: null, projectId: w.project, amount: 47512, baseAmount: 47512 }] });
    const tr = { type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 };
    expect(fail(await create({ ...tr, lines: [{ projectId: w.project, amount: 40000 }, { projectId: w.project2, amount: 7512 }] }), 400, 'VALIDATION').fields?.lines).toBe(
      'У перевода — не больше одной строки, с проектом',
    );
    expect(fail(await create({ ...tr, lines: [{ amount: 47512 }] }), 400, 'VALIDATION').fields?.lines).toBe('В строке перевода укажите проект');
    expect(fail(await create({ ...tr, counterpartyId: w.counterparty }), 400, 'VALIDATION').fields?.counterpartyId).toBe('У перевода нет контрагента');
    expect(fail(await create({ type: 'income', paidAt, accountId: w.kzt, amount: 100, toAccountId: w.usd }), 400, 'VALIDATION').fields?.toAccountId).toBe(
      'Счёт зачисления — только у перевода',
    );
  });

  it('проверка тела: дата без часового пояса и несуществующая дата, нулевая и дробная сумма, неизвестный тип — 400; чужая компания — 404', async () => {
    w = await opsWorld();
    const base = { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    for (const body of [
      { ...base, paidAt: '2026-10-05T10:00:00' },
      { ...base, paidAt: '2026-09-31T10:00:00Z' },
      { ...base, amount: 0 },
      { ...base, amount: 1.5 },
      { ...base, type: 'gift' },
    ]) {
      expect((await create(body)).statusCode).toBe(400);
    }
    const op = (await create(base)).json().operation;
    const other = await w.h.company('Другая');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/operations/${op.id}`)).statusCode).toBe(404);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/operations`, base)).statusCode).toBe(422); // счёт чужой — инвариант 5
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/operations-create.test.ts`
Expected: FAIL — маршрут операций 404.

- [ ] **Step 3: Implement**

`src/shared/schemas/operations.ts`:

```ts
import { z } from 'zod';
import { isValidDate } from '../dates';

const id = z.number().int().positive();
// zod 4 .int() сам отклоняет числа вне безопасного диапазона — поэтому отдельные проверки
const money = z
  .number()
  .refine(Number.isInteger, 'Сумма — целое число минимальных единиц')
  .refine((v) => v > 0, 'Сумма больше нуля')
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
/** ISO-дата и время с часовым поясом: без пояса момент зависел бы от часов сервера. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const paidAt = z
  .string()
  .refine((s) => ISO_RE.test(s) && isValidDate(s.slice(0, 10)) && !Number.isNaN(Date.parse(s)), 'Неверные дата и время оплаты');
const accrualDate = z.string().refine(isValidDate, 'Неверная дата').nullable();
const comment = z
  .string()
  .trim()
  .max(2000, 'Не длиннее 2000 символов')
  .nullable()
  .transform((v) => v || null);
const line = z.object({
  categoryId: id.nullable().default(null),
  projectId: id.nullable().default(null),
  amount: money,
});
const lines = z.array(line).max(50, 'Не больше 50 строк');
const tagIds = z.array(id).max(20, 'Не больше 20 тегов');

export const operationCreateSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' }),
  paidAt,
  accrualDate: accrualDate.default(null),
  accountId: id,
  amount: money,
  toAccountId: id.nullable().default(null),
  toAmount: money.nullable().default(null),
  counterpartyId: id.nullable().default(null),
  comment: comment.optional(),
  lines: lines.default([]),
  tagIds: tagIds.default([]),
});

export const operationUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  paidAt: paidAt.optional(),
  accrualDate: accrualDate.optional(),
  accountId: id.optional(),
  amount: money.optional(),
  toAccountId: id.optional(),
  toAmount: money.optional(),
  counterpartyId: id.nullable().optional(),
  comment: comment.optional(),
  lines: lines.optional(),
  tagIds: tagIds.optional(),
});
```

`src/server/modules/operations/service.ts`:

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { convertMinor } from '../../../shared/decimal';
import { allocate } from '../../../shared/money';
import type { Db, Executor } from '../../db/client';
import { accounts, categories, counterparties, operationLines, operations, operationTags, projects, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';

export type OperationType = 'income' | 'expense' | 'transfer';

export interface LineInput {
  categoryId: number | null;
  projectId: number | null;
  amount: number;
}

export interface OperationInput {
  type: OperationType;
  /** ISO-момент; сервис нормализует к UTC фиксированной ширины. */
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  lines: LineInput[];
  tagIds: number[];
}

export interface OperationLineDto extends LineInput {
  id: number;
  position: number;
  baseAmount: number;
}

export type OperationRow = typeof operations.$inferSelect;

export interface OperationDto extends OperationRow {
  lines: OperationLineDto[];
  tagIds: number[];
}

export interface OperationsService {
  get(companyId: number, id: number): OperationDto;
  create(companyId: number, input: OperationInput, userId: number): OperationDto;
}

type AccountRow = typeof accounts.$inferSelect;

interface Checked {
  draft: OperationInput;
  account: AccountRow;
  toAccount: AccountRow | null;
}

const inv = (n: number, message: string, fields?: Record<string, string>) => new AppError(422, `INVARIANT_${n}`, message, fields);
const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const archivedRef = (message: string) => new AppError(422, 'ARCHIVED_REFERENCE', message);
const uniqueIds = (ids: (number | null)[]) => [...new Set(ids.filter((x): x is number => x !== null))];

export function createOperationsService(d: { db: Db; audit: AuditService; rates: RatesService; timezone: string; now?: () => Date }): OperationsService {
  const { db, audit, rates } = d;
  const now = d.now ?? (() => new Date());
  /** Календарная дата момента в APP_TIMEZONE. */
  const dateOf = (iso: string) => todayInTimezone(d.timezone, new Date(iso));

  function load(companyId: number, id: number): OperationDto {
    const row = db.select().from(operations).where(and(eq(operations.id, id), eq(operations.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Операция не найдена');
    const lines = db
      .select()
      .from(operationLines)
      .where(eq(operationLines.operationId, id))
      .orderBy(asc(operationLines.position))
      .all()
      .map((l) => ({ id: l.id, position: l.position, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: l.baseAmount }));
    const tagIds = db
      .select({ tagId: operationTags.tagId })
      .from(operationTags)
      .where(eq(operationTags.operationId, id))
      .all()
      .map((t) => t.tagId)
      .sort((a, b) => a - b);
    return { ...row, lines, tagIds };
  }

  function account(companyId: number, id: number, field: string): AccountRow {
    const row = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))).get();
    if (!row) throw inv(5, 'Счёт не найден в этой компании', { [field]: 'Счёт не найден в этой компании' });
    return row;
  }

  /**
   * Инварианты 1, 3–7 на черновике (§4.6) и его нормализация. prev — операция до правки или восстановления:
   * ссылки, которые у неё уже были, могут оставаться архивными (архив запрещает только новый выбор, инварианты 7 и 11).
   */
  function check(companyId: number, input: OperationInput, prev: OperationInput | null): Checked {
    const draft: OperationInput = {
      ...input,
      paidAt: new Date(input.paidAt).toISOString(),
      lines: input.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: [...new Set(input.tagIds)].sort((a, b) => a - b),
    };
    const acc = account(companyId, draft.accountId, 'accountId');
    let toAcc: AccountRow | null = null;

    if (draft.type === 'transfer') {
      if (draft.toAccountId === null) throw invalid({ toAccountId: 'Выберите счёт зачисления' });
      if (draft.toAccountId === draft.accountId) throw inv(4, 'Счета списания и зачисления совпадают', { toAccountId: 'Выберите другой счёт' });
      toAcc = account(companyId, draft.toAccountId, 'toAccountId');
      if (toAcc.currency === acc.currency) {
        if (draft.toAmount === null) draft.toAmount = draft.amount;
        else if (draft.toAmount !== draft.amount) {
          throw inv(4, 'При одной валюте сумма зачисления равна сумме списания', { toAmount: 'Должна совпадать с суммой списания' });
        }
      } else if (draft.toAmount === null) throw invalid({ toAmount: 'Укажите сумму зачисления' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У перевода нет контрагента' });
      if (draft.lines.length > 1) throw invalid({ lines: 'У перевода — не больше одной строки, с проектом' });
      const line = draft.lines[0];
      if (line?.categoryId != null) throw inv(3, 'У перевода нет статьи', { lines: 'У перевода нет статьи' });
      if (line && line.projectId === null) throw invalid({ lines: 'В строке перевода укажите проект' });
    } else {
      if (draft.toAccountId !== null || draft.toAmount !== null) throw invalid({ toAccountId: 'Счёт зачисления — только у перевода' });
      // у дохода и расхода не меньше одной строки (§4.5): без строк — одна строка на всю сумму
      if (draft.lines.length === 0) draft.lines = [{ categoryId: null, projectId: null, amount: draft.amount }];
    }
    if (draft.lines.length > 0 && draft.lines.reduce((s, l) => s + l.amount, 0) !== draft.amount) {
      throw inv(1, 'Сумма строк не равна сумме операции', { lines: 'Распределите всю сумму операции' });
    }

    // инвариант 6: не в будущем по APP_TIMEZONE и не раньше открытия затронутых счетов
    const date = dateOf(draft.paidAt);
    if (date > todayInTimezone(d.timezone, now())) {
      throw inv(6, 'Дата оплаты в будущем — плановые операции появятся позже', { paidAt: 'Дата оплаты в будущем' });
    }
    for (const a of [acc, toAcc]) {
      if (a && date < a.openedAt) {
        throw inv(6, `Счёт «${a.name}» открыт ${formatDateRu(a.openedAt)} — операция не может быть раньше`, { paidAt: 'Раньше даты открытия счёта' });
      }
    }

    // инвариант 7: новый выбор архивного счёта
    for (const [a, prevId] of [
      [acc, prev?.accountId],
      [toAcc, prev?.toAccountId],
    ] as const) {
      if (a?.archivedAt && a.id !== prevId) throw archivedRef(`Счёт «${a.name}» в архиве — выберите другой`);
    }

    // статьи строк: та же компания (5), вид по типу операции (3), архив — только уже выбранные (7)
    const catIds = uniqueIds(draft.lines.map((l) => l.categoryId));
    const cats = catIds.length ? db.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, catIds))).all() : [];
    if (cats.length !== catIds.length) throw inv(5, 'Статья не найдена в этой компании', { lines: 'Статья не найдена в этой компании' });
    const kind = draft.type === 'income' ? 'income' : 'expense';
    if (cats.some((c) => c.kind !== kind)) {
      throw inv(3, draft.type === 'income' ? 'У дохода — только статьи доходов' : 'У расхода — только статьи расходов', { lines: 'Статья другого вида' });
    }
    const prevCats = new Set(prev?.lines.map((l) => l.categoryId) ?? []);
    const archivedCat = cats.find((c) => c.archivedAt && !prevCats.has(c.id));
    if (archivedCat) throw archivedRef(`Статья «${archivedCat.name}» в архиве — выберите другую`);

    // проекты строк
    const projIds = uniqueIds(draft.lines.map((l) => l.projectId));
    const projs = projIds.length ? db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projIds))).all() : [];
    if (projs.length !== projIds.length) throw inv(5, 'Проект не найден в этой компании', { lines: 'Проект не найден в этой компании' });
    const prevProjs = new Set(prev?.lines.map((l) => l.projectId) ?? []);
    const archivedProj = projs.find((p) => p.archivedAt && !prevProjs.has(p.id));
    if (archivedProj) throw archivedRef(`Проект «${archivedProj.name}» в архиве — выберите другой`);

    // контрагент
    if (draft.counterpartyId !== null) {
      const cp = db
        .select()
        .from(counterparties)
        .where(and(eq(counterparties.id, draft.counterpartyId), eq(counterparties.companyId, companyId)))
        .get();
      if (!cp) throw inv(5, 'Контрагент не найден в этой компании', { counterpartyId: 'Контрагент не найден в этой компании' });
      if (cp.archivedAt && cp.id !== prev?.counterpartyId) throw archivedRef(`Контрагент «${cp.name}» в архиве — выберите другого`);
    }

    // теги
    if (draft.tagIds.length) {
      const rows = db.select().from(tags).where(and(eq(tags.companyId, companyId), inArray(tags.id, draft.tagIds))).all();
      if (rows.length !== draft.tagIds.length) throw inv(5, 'Тег не найден в этой компании', { tagIds: 'Тег не найден в этой компании' });
      const prevTags = new Set(prev?.tagIds ?? []);
      const archivedTag = rows.find((t) => t.archivedAt && !prevTags.has(t.id));
      if (archivedTag) throw archivedRef(`Тег «${archivedTag.name}» в архиве — выберите другой`);
    }

    return { draft, account: acc, toAccount: toAcc };
  }

  /** Курс к базовой валюте на дату оплаты и сумма исходной стороны в базовой валюте (§4.3). */
  function baseOf(companyId: number, baseCurrency: string, c: Checked): { rate: string; baseAmount: number } {
    const { rate, display } = rates.resolve(companyId, baseCurrency, c.account.currency, dateOf(c.draft.paidAt));
    const baseAmount = convertMinor(c.draft.amount, rate, getCurrency(c.account.currency).minorUnits, getCurrency(baseCurrency).minorUnits);
    if (!Number.isSafeInteger(baseAmount)) throw invalid({ amount: 'Слишком большая сумма' });
    return { rate: display, baseAmount };
  }

  /** Строки (baseAmount распределяется наибольшим остатком — инвариант 2) и теги операции. */
  function writeLinesAndTags(tx: Executor, operationId: number, draft: OperationInput, baseAmount: number): void {
    tx.delete(operationLines).where(eq(operationLines.operationId, operationId)).run();
    const bases = draft.lines.length ? allocate(baseAmount, draft.lines.map((l) => l.amount)) : [];
    draft.lines.forEach((l, i) => {
      tx.insert(operationLines)
        .values({ operationId, position: i, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: bases[i]! })
        .run();
    });
    tx.delete(operationTags).where(eq(operationTags.operationId, operationId)).run();
    for (const tagId of draft.tagIds) tx.insert(operationTags).values({ operationId, tagId }).run();
  }

  const svc: OperationsService = {
    get(companyId, id) {
      requireCompany(db, companyId);
      return load(companyId, id);
    },

    create(companyId, input, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      const c = check(companyId, input, null);
      const { rate, baseAmount } = baseOf(companyId, company.baseCurrency, c);
      const { draft } = c;
      const id = mutate(db, audit, (tx, record) => {
        const t = now().toISOString();
        const row = tx
          .insert(operations)
          .values({
            companyId,
            type: draft.type,
            status: 'actual',
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
            accountId: draft.accountId,
            amount: draft.amount,
            toAccountId: draft.toAccountId,
            toAmount: draft.toAmount,
            rate,
            baseAmount,
            counterpartyId: draft.counterpartyId,
            comment: draft.comment,
            createdBy: userId,
            createdAt: t,
            updatedAt: t,
            version: 1,
          })
          .returning({ id: operations.id })
          .get();
        writeLinesAndTags(tx, row.id, draft, baseAmount);
        record({ companyId, userId, entity: 'operation', entityId: row.id, action: 'create', diff: { ...draft, rate, baseAmount } });
        return row.id;
      });
      return load(companyId, id);
    },
  };
  return svc;
}
```

`src/server/modules/operations/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { operationCreateSchema } from '../../../shared/schemas/operations';
import { parseId } from '../../http/params';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(app: FastifyInstance, deps: { operations: OperationsService }): void {
  const { operations } = deps;

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));
}
```

`src/server/app.ts` — импорты и подключение сразу после `registerRatesRoutes(…)`:

```ts
import { registerOperationsRoutes } from './modules/operations/routes';
import { createOperationsService } from './modules/operations/service';
```

```ts
  const operations = createOperationsService({ db, audit, rates, timezone: config.timezone, now });
  registerOperationsRoutes(app, { operations });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/operations-create.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/shared/schemas/operations.ts src/server/modules/operations src/server/app.ts tests/helpers/ops.ts tests/server/operations-create.test.ts
git commit -m "feat: операции — создание доходов, расходов и переводов с разбиениями, курсом и инвариантами 1–7

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Операции — правка с версией и пересчётом, мягкое удаление, восстановление

**Files:**
- Create: `tests/server/operations-update.test.ts`
- Modify: `src/server/modules/operations/service.ts`, `src/server/modules/operations/routes.ts`

**Interfaces:**
- Consumes: `check`, `baseOf`, `load`, `writeLinesAndTags` (Task 4, внутри сервиса); `changedFields` (план 3a).
- Produces:
  - `OperationPatch`;
  - `OperationsService.update(companyId, id, patch, userId)`, `remove(companyId, id, userId)`, `restore(companyId, id, userId)` — все возвращают `OperationDto`;
  - маршруты:
    - `PATCH /api/v1/companies/:cid/operations/:id` → `{ operation }`;
    - `DELETE …/:id` → `{ operation }`, мягкое удаление;
    - `POST …/:id/restore` → `{ operation }`.

- [ ] **Step 1: Write the failing tests**

`tests/server/operations-update.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string };
};
const create = async (body: object) => {
  const res = await w.h.req('POST', w.ops, body);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().operation as { id: number; version: number; [k: string]: any };
};
const patch = (id: number, body: object) => w.h.req('PATCH', `${w.ops}/${id}`, body);
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('operations: правка, удаление, восстановление', () => {
  it('версия: устаревшая правка — 409; правка без изменений не меняет версию и не пишет историю', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    const v2 = await patch(op.id, { version: 1, comment: 'а' });
    expect(v2.json().operation).toMatchObject({ comment: 'а', version: 2 });
    expect(fail(await patch(op.id, { version: 1, comment: 'б' }), 409, 'VERSION_CONFLICT').message).toBe('Операция изменена другим пользователем');
    expect((await patch(op.id, { version: 2, comment: ' а ' })).json().operation.version).toBe(2);
    expect(w.h.auditCount('operation', 'update')).toBe(1);
  });

  it('пересчёт: правка комментария после смены курса не меняет rate и baseAmount, правка суммы — пересчитывает (Review Focus 2)', async () => {
    w = await opsWorld();
    const op = await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] });
    expect(op).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    const rateId = (await w.h.req('GET', '/api/v1/rates/manual')).json().rates[0].id;
    await w.h.req('PATCH', `/api/v1/rates/manual/${rateId}`, { rate: '480' });
    const c = (await patch(op.id, { version: 1, comment: 'аренда' })).json().operation;
    expect(c).toMatchObject({ rate: '475.12', baseAmount: 47512, version: 2 });
    const a = (await patch(op.id, { version: 2, amount: 200 })).json().operation;
    expect(a).toMatchObject({ rate: '480', baseAmount: 96000, amount: 200, lines: [{ categoryId: w.expense, amount: 200, baseAmount: 96000 }] });
  });

  it('строки: новое разбиение перераспределяет baseAmount; новая сумма при нескольких строках без строк — INVARIANT_1', async () => {
    w = await opsWorld();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 100,
      lines: [
        { projectId: w.project, amount: 50 },
        { projectId: w.project2, amount: 50 },
      ],
    });
    fail(await patch(op.id, { version: 1, amount: 120 }), 422, 'INVARIANT_1');
    const res = (
      await patch(op.id, {
        version: 1,
        lines: [
          { projectId: w.project, amount: 70 },
          { projectId: w.project2, amount: 30 },
        ],
      })
    ).json().operation;
    expect(res.lines.map((l: { baseAmount: number }) => l.baseAmount)).toEqual([70, 30]);
  });

  it('операция на архивном счёте: сумма, дата и счета заблокированы, удалить нельзя, комментарий и дата сделки меняются (Review Focus 3)', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const inc = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 }); // баланс снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    for (const body of [{ amount: 50 }, { paidAt: '2026-10-04T10:00:00Z' }, { accountId: w.kzt }]) {
      fail(await patch(inc.id, { version: 1, ...body }), 422, 'ARCHIVED_REFERENCE');
    }
    const ok = (await patch(inc.id, { version: 1, comment: 'сверка', accrualDate: '2026-09-01' })).json().operation;
    expect(ok).toMatchObject({ comment: 'сверка', accrualDate: '2026-09-01', amount: 100 });
    expect(fail(await w.h.req('DELETE', `${w.ops}/${inc.id}`), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Операция затрагивает счёт «Сейф» в архиве — удалить её нельзя',
    );
  });

  it('удаление мягкое, версия растёт, история; правка удалённой — 409; восстановление возвращает', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    const del = (await w.h.req('DELETE', `${w.ops}/${op.id}`)).json().operation;
    expect(del.deletedAt).not.toBeNull();
    expect(del.version).toBe(2);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.deletedAt).not.toBeNull();
    expect(fail(await patch(op.id, { version: 2, comment: 'x' }), 409, 'VERSION_CONFLICT').message).toBe('Операция удалена — обновите страницу');
    const back = (await w.h.req('POST', `${w.ops}/${op.id}/restore`)).json().operation;
    expect(back).toMatchObject({ deletedAt: null, version: 3 });
    expect(w.h.auditCount('operation', 'delete')).toBe(1);
    expect(w.h.auditCount('operation', 'restore')).toBe(1);
  });

  it('восстановление: архивная статья не мешает, архивный счёт мешает, openedAt позже даты операции — INVARIANT_6 (Review Focus 4)', async () => {
    w = await opsWorld();
    // архивная статья — восстановление проходит (инвариант 11)
    const withCat = await create({ type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] });
    await w.h.req('DELETE', `${w.ops}/${withCat.id}`);
    await w.post(`/api/v1/companies/${w.cid}/categories/${w.expense}/archive`, {});
    expect((await w.h.req('POST', `${w.ops}/${withCat.id}/restore`)).json().operation.deletedAt).toBeNull();

    // архивный счёт — нельзя
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const x = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 50 });
    const y = await create({ type: 'expense', paidAt: '2026-10-02T11:00:00Z', accountId: safe, amount: 50 });
    await w.h.req('DELETE', `${w.ops}/${x.id}`);
    await w.h.req('DELETE', `${w.ops}/${y.id}`);
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect(fail(await w.h.req('POST', `${w.ops}/${x.id}/restore`), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Счёт «Сейф» в архиве — сначала верните его из архива',
    );

    // дата открытия сдвинута позже даты удалённой операции
    const kaspi = (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const early = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: kaspi, amount: 10 });
    await w.h.req('DELETE', `${w.ops}/${early.id}`);
    expect((await w.h.req('PATCH', `${accountsUrl()}/${kaspi}`, { openedAt: '2026-10-04' })).statusCode).toBe(200);
    fail(await w.h.req('POST', `${w.ops}/${early.id}/restore`), 422, 'INVARIANT_6');
  });

  it('перевод: те же сумма и счета в PATCH не сбрасывают сумму зачисления — и на архивном счёте, и между валютами', async () => {
    w = await opsWorld();
    // KZT → USD: сумма зачисления задана явно, PATCH с той же суммой и комментарием
    const fx = await create({ type: 'transfer', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    const fxRes = await patch(fx.id, { version: 1, amount: 47512, accountId: w.kzt, toAccountId: w.usd, comment: 'обмен' });
    expect(fxRes.statusCode).toBe(200);
    expect(fxRes.json().operation).toMatchObject({ toAmount: 100, comment: 'обмен', baseAmount: 47512 });

    // перевод со счёта, ушедшего в архив: те же значения в PATCH — не правка суммы и счетов
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    const tr = await create({ type: 'transfer', paidAt: '2026-10-03T10:00:00Z', accountId: safe, toAccountId: w.kzt, amount: 100 });
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    const same = await patch(tr.id, { version: 1, amount: 100, accountId: safe, toAccountId: w.kzt, comment: 'сверка' });
    expect(same.statusCode).toBe(200);
    expect(same.json().operation).toMatchObject({ toAmount: 100, comment: 'сверка' });
    fail(await patch(tr.id, { version: 2, amount: 90 }), 422, 'ARCHIVED_REFERENCE');
  });

  it('новый выбор архивного при правке запрещён, уже выбранный архивный остаётся', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100, counterpartyId: w.counterparty });
    await w.post(`/api/v1/companies/${w.cid}/counterparties/${w.counterparty}/archive`, {});
    expect((await patch(op.id, { version: 1, comment: 'с архивным контрагентом' })).statusCode).toBe(200);
    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/archive`, {});
    fail(await patch(op.id, { version: 2, tagIds: [w.tag] }), 422, 'ARCHIVED_REFERENCE');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/operations-update.test.ts`
Expected: FAIL — маршрутов правки, удаления и восстановления нет.

- [ ] **Step 3: Implement**

`src/server/modules/operations/service.ts`:

Импорт `changedFields` рядом с `mutate`:

```ts
import { changedFields, mutate } from '../audit/mutate';
```

Типы и интерфейс — `OperationPatch` и три новых метода:

```ts
export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
  /** Версия, которую видел клиент. */
  version: number;
}

export interface OperationsService {
  get(companyId: number, id: number): OperationDto;
  create(companyId: number, input: OperationInput, userId: number): OperationDto;
  update(companyId: number, id: number, patch: OperationPatch, userId: number): OperationDto;
  /** Мягкое удаление. */
  remove(companyId: number, id: number, userId: number): OperationDto;
  restore(companyId: number, id: number, userId: number): OperationDto;
}

/** Поля, правка которых пересчитывает курс и сумму в базовой валюте (§4.3) и запрещена на архивном счёте (инвариант 7). */
const MONEY_FIELDS = ['paidAt', 'amount', 'accountId', 'toAccountId', 'toAmount'] as const;
```

Внутри `createOperationsService` — два помощника рядом с `load`:

```ts
  function draftOf(op: OperationDto): OperationInput {
    return {
      type: op.type,
      paidAt: op.paidAt,
      accrualDate: op.accrualDate,
      accountId: op.accountId,
      amount: op.amount,
      toAccountId: op.toAccountId,
      toAmount: op.toAmount,
      counterpartyId: op.counterpartyId,
      comment: op.comment,
      lines: op.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: op.tagIds,
    };
  }

  /** Архивный счёт, который затрагивает операция (инвариант 7); null — таких нет. */
  function archivedAccountOf(op: OperationRow): AccountRow | null {
    const ids = [op.accountId, op.toAccountId].filter((x): x is number => x !== null);
    return db.select().from(accounts).where(inArray(accounts.id, ids)).all().find((a) => a.archivedAt) ?? null;
  }
```

Методы в объект `svc` после `create`:

```ts
    update(companyId, id, patch, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (current.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу');
      if (patch.version !== current.version) throw new AppError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем');
      const prev = draftOf(current);
      const next: OperationInput = { ...prev, lines: prev.lines, tagIds: prev.tagIds };
      for (const [key, value] of Object.entries(patch)) {
        if (key !== 'version' && value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
      }
      if (patch.paidAt !== undefined) next.paidAt = new Date(patch.paidAt).toISOString();
      // новая сумма без новых строк: единственная строка следует за суммой
      if (patch.amount !== undefined && patch.lines === undefined && prev.lines.length === 1) {
        next.lines = [{ ...prev.lines[0]!, amount: next.amount }];
      }
      // перевод: при реальной смене суммы или счетов сумма зачисления при одной валюте пересчитывается в check();
      // те же значения в PATCH (форма шлёт поля целиком) ничего не сбрасывают
      if (
        next.type === 'transfer' &&
        patch.toAmount === undefined &&
        (next.amount !== prev.amount || next.accountId !== prev.accountId || next.toAccountId !== prev.toAccountId)
      ) {
        next.toAmount = null;
      }

      const c = check(companyId, next, prev);
      // инвариант 7: на нормализованном черновике — сравниваются реальные значения, а не присутствие полей в PATCH
      const locked = archivedAccountOf(current);
      if (locked && MONEY_FIELDS.some((f) => JSON.stringify(c.draft[f] ?? null) !== JSON.stringify(prev[f] ?? null))) {
        throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — сумму, дату и счета менять нельзя`);
      }
      const changes = changedFields(prev, c.draft);
      if (!changes) return current;
      const recalc = MONEY_FIELDS.some((f) => f in changes.after);
      const { rate, baseAmount } = recalc ? baseOf(companyId, company.baseCurrency, c) : { rate: current.rate, baseAmount: current.baseAmount };
      const { draft } = c;
      mutate(db, audit, (tx, record) => {
        tx.update(operations)
          .set({
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
            accountId: draft.accountId,
            amount: draft.amount,
            toAccountId: draft.toAccountId,
            toAmount: draft.toAmount,
            counterpartyId: draft.counterpartyId,
            comment: draft.comment,
            rate,
            baseAmount,
            updatedAt: now().toISOString(),
            version: current.version + 1,
          })
          .where(eq(operations.id, id))
          .run();
        writeLinesAndTags(tx, id, draft, baseAmount);
        record({
          companyId,
          userId,
          entity: 'operation',
          entityId: id,
          action: 'update',
          diff: { ...changes, ...(recalc ? { recalculated: { rate: [current.rate, rate], baseAmount: [current.baseAmount, baseAmount] } } : {}) },
        });
      });
      return load(companyId, id);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (current.deletedAt) return current;
      const locked = archivedAccountOf(current);
      if (locked) throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — удалить её нельзя`);
      mutate(db, audit, (tx, record) => {
        tx.update(operations)
          .set({ deletedAt: now().toISOString(), updatedAt: now().toISOString(), version: current.version + 1 })
          .where(eq(operations.id, id))
          .run();
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'delete', diff: { type: current.type, amount: current.amount, paidAt: current.paidAt } });
      });
      return load(companyId, id);
    },

    restore(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (!current.deletedAt) return current;
      const locked = archivedAccountOf(current);
      if (locked) throw archivedRef(`Счёт «${locked.name}» в архиве — сначала верните его из архива`);
      // инвариант 11: 3–7 на текущем состоянии справочников; уже выбранные архивные ссылки не мешают
      check(companyId, draftOf(current), draftOf(current));
      mutate(db, audit, (tx, record) => {
        tx.update(operations)
          .set({ deletedAt: null, updatedAt: now().toISOString(), version: current.version + 1 })
          .where(eq(operations.id, id))
          .run();
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'restore' });
      });
      return load(companyId, id);
    },
```

`src/server/modules/operations/routes.ts` — импорт `operationUpdateSchema` и три маршрута после `GET`:

```ts
import { operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
```

```ts
  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/operations-update.test.ts tests/server/operations-create.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/operations tests/server/operations-update.test.ts
git commit -m "feat: операции — правка с версией и пересчётом курса, мягкое удаление и восстановление по инвариантам 7 и 11

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Настоящие проверки ссылок и балансы, блокировка смены валют

**Files:**
- Create: `tests/server/ledger.test.ts`
- Modify: `src/server/modules/references/service.ts`, `src/server/modules/balances/service.ts`, `src/server/modules/companies/service.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: таблицы операций (Task 2); операции через API (Tasks 4–5); `ReferencesService`, `BalancesService` (план 3a).
- Produces:
  - `createOperationsReferences(db, timezone): ReferencesService` — настоящая реализация инварианта 9 и `earliestOperationDate`;
  - `AccountBalance { accountId; currency; balance; archived }`, `LedgerBalances extends BalancesService { companyBalances(companyId): AccountBalance[] }`, `createLedgerBalances(db): LedgerBalances`;
  - `CompaniesService.update`: 422 `CURRENCY_LOCKED` при смене базовой валюты, если в компании есть операции (включая удалённые) или фиксированные курсы.
- Заглушки `createReferencesService()` и `createBalancesService()` остаются: это значения по умолчанию для модульных тестов отдельных сервисов. `app.ts` подключает настоящие реализации.

- [ ] **Step 1: Write the failing tests**

`tests/server/ledger.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const create = async (body: object) => {
  const res = await w.h.req('POST', w.ops, body);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().operation as { id: number };
};
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('ledger: балансы и ссылки операций', () => {
  it('баланс: старт + доходы - расходы, перевод между валютами, удалённые не считаются; совпадает с пересчётом в JS (Review Focus 5)', async () => {
    w = await opsWorld();
    await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { startingBalance: 100000 });
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: 50000 });
    await create({
      type: 'expense',
      paidAt: '2026-10-03T10:00:00Z',
      accountId: w.kzt,
      amount: 20000,
      lines: [
        { projectId: w.project, amount: 15000 },
        { projectId: w.project2, amount: 5000 },
      ],
    });
    await create({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    const gone = await create({ type: 'expense', paidAt: '2026-10-04T11:00:00Z', accountId: w.kzt, amount: 999 });
    await w.h.req('DELETE', `${w.ops}/${gone.id}`);

    const ledger = createLedgerBalances(w.h.t.db);
    const byId = new Map(ledger.companyBalances(w.cid).map((b) => [b.accountId, b]));
    expect(byId.get(w.kzt)).toMatchObject({ currency: 'KZT', balance: 82488, archived: false });
    expect(byId.get(w.usd)).toMatchObject({ currency: 'USD', balance: 100 });
    expect(ledger.accountBalance({ id: w.kzt, startingBalance: 100000 })).toBe(82488);

    // независимый пересчёт по всем операциям (критерий §12)
    const rows = w.h.t.sqlite
      .prepare("SELECT type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE deleted_at IS NULL AND status = 'actual'")
      .all() as { type: string; a: number; amount: number; t: number | null; ta: number | null }[];
    const js = new Map<number, number>();
    for (const r of rows) {
      js.set(r.a, (js.get(r.a) ?? 0) + (r.type === 'income' ? r.amount : -r.amount));
      if (r.type === 'transfer') js.set(r.t!, (js.get(r.t!) ?? 0) + r.ta!);
    }
    expect(100000 + js.get(w.kzt)!).toBe(82488);
    expect(js.get(w.usd)).toBe(100);

    // архив только при нулевом балансе — теперь по настоящему балансу
    const arch = await w.h.req('POST', `${accountsUrl()}/${w.kzt}/archive`);
    expect(arch.statusCode).toBe(422);
    expect(arch.json().error.message).toBe('Счёт можно перевести в архив только при нулевом балансе');
  });

  it('баланс архивного счёта остаётся нулевым: правка допустимых полей его не меняет', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const inc = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 });
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect((await w.h.req('PATCH', `${w.ops}/${inc.id}`, { version: 1, comment: 'сверка', accrualDate: '2026-09-01' })).statusCode).toBe(200);
    expect((await w.h.req('PATCH', `${w.ops}/${inc.id}`, { version: 2, amount: 50 })).statusCode).toBe(422);
    expect((await w.h.req('DELETE', `${w.ops}/${inc.id}`)).statusCode).toBe(422);
    const ledger = createLedgerBalances(w.h.t.db);
    expect(ledger.companyBalances(w.cid).find((b) => b.accountId === safe)).toMatchObject({ balance: 0, archived: true });
  });

  it('инвариант 9: на что ссылается операция (даже удалённая), то удалить нельзя; неиспользуемое — можно', async () => {
    w = await opsWorld();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 100,
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 100 }],
    });
    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    const b = `/api/v1/companies/${w.cid}`;
    for (const url of [`${b}/categories/${w.expense}`, `${b}/projects/${w.project}`, `${b}/counterparties/${w.counterparty}`, `${b}/tags/${w.tag}`, `${b}/accounts/${w.kzt}`]) {
      const res = await w.h.req('DELETE', url);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('INVARIANT_9');
    }
    expect((await w.h.req('DELETE', `${b}/categories/${w.income}`)).statusCode).toBe(204);
    expect((await w.h.req('DELETE', `${b}/projects/${w.project2}`)).statusCode).toBe(204);
  });

  it('валюта счёта с операциями заблокирована; дату открытия нельзя сдвинуть позже первой операции', async () => {
    w = await opsWorld();
    await create({ type: 'income', paidAt: '2026-10-03T10:00:00Z', accountId: w.kzt, amount: 100 });
    const cur = await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { currency: 'USD' });
    expect(cur.statusCode).toBe(422);
    expect(cur.json().error.code).toBe('CURRENCY_LOCKED');
    const late = await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-10-04' });
    expect(late.json().error.code).toBe('INVARIANT_6');
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-10-03' })).statusCode).toBe(200);
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-09-01' })).statusCode).toBe(200);
    // у счёта без операций валюту менять можно
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.usd}`, { currency: 'KZT' })).statusCode).toBe(200);
  });

  it('базовая валюта компании блокируется операциями (даже удалёнными) и фиксированными курсами', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    const locked = await w.h.req('PATCH', `/api/v1/companies/${w.cid}`, { baseCurrency: 'USD' });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error).toMatchObject({
      code: 'CURRENCY_LOCKED',
      message: 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя',
    });
    expect((await w.h.req('PATCH', `/api/v1/companies/${w.cid}`, { name: 'ТОО новое' })).statusCode).toBe(200);

    const withFixed = await w.h.company('С курсом');
    await w.post(`/api/v1/companies/${withFixed}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2026-10-01' });
    expect((await w.h.req('PATCH', `/api/v1/companies/${withFixed}`, { baseCurrency: 'USD' })).json().error.code).toBe('CURRENCY_LOCKED');

    const empty = await w.h.company('Пустая');
    expect((await w.h.req('PATCH', `/api/v1/companies/${empty}`, { baseCurrency: 'USD' })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/ledger.test.ts`
Expected: FAIL — нет `createLedgerBalances`; заглушки разрешают удаление справочников, смену валют и архив счёта с оборотами.

- [ ] **Step 3: Implement**

`src/server/modules/references/service.ts` — импорты в начало файла и настоящая реализация в конец:

```ts
import { and, count, countDistinct, eq, isNull, min, or } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { operationLines, operations, operationTags } from '../../db/schema';
```

```ts
/** Настоящая реализация на таблицах операций (шаг 4). Ссылки считают и мягко удалённые операции (инвариант 9). */
export function createOperationsReferences(db: Db, timezone: string): ReferencesService {
  return {
    countOperations(entity, id) {
      switch (entity) {
        case 'account':
          return (
            db
              .select({ n: count() })
              .from(operations)
              .where(or(eq(operations.accountId, id), eq(operations.toAccountId, id)))
              .get()?.n ?? 0
          );
        case 'counterparty':
          return db.select({ n: count() }).from(operations).where(eq(operations.counterpartyId, id)).get()?.n ?? 0;
        case 'category':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.categoryId, id)).get()?.n ?? 0;
        case 'project':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.projectId, id)).get()?.n ?? 0;
        case 'tag':
          return db.select({ n: count() }).from(operationTags).where(eq(operationTags.tagId, id)).get()?.n ?? 0;
      }
    },

    earliestOperationDate(accountId) {
      // только неудалённые: удалённая операция при восстановлении снова проверит openedAt (инвариант 11)
      const row = db
        .select({ first: min(operations.paidAt) })
        .from(operations)
        .where(and(or(eq(operations.accountId, accountId), eq(operations.toAccountId, accountId)), isNull(operations.deletedAt)))
        .get();
      return row?.first ? todayInTimezone(timezone, new Date(row.first)) : null;
    },
  };
}
```

`src/server/modules/balances/service.ts` — импорты в начало и реализация в конец:

```ts
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { accounts, operations } from '../../db/schema';
```

```ts
export interface AccountBalance {
  accountId: number;
  currency: string;
  balance: number;
  archived: boolean;
}

export interface LedgerBalances extends BalancesService {
  /** Балансы всех счетов компании (включая архивные) в их валютах. */
  companyBalances(companyId: number): AccountBalance[];
}

/**
 * Баланс = startingBalance + поступления - списания по фактическим неудалённым операциям (§4.7).
 * Перевод уменьшает исходный счёт на amount и увеличивает целевой на toAmount.
 */
export function createLedgerBalances(db: Db): LedgerBalances {
  function movements(filter: { companyId?: number; accountId?: number }): Map<number, number> {
    const scope: SQL[] = [isNull(operations.deletedAt), eq(operations.status, 'actual')];
    if (filter.companyId !== undefined) scope.push(eq(operations.companyId, filter.companyId));
    const outgoing = db
      .select({
        accountId: operations.accountId,
        delta: sql<number>`sum(case when ${operations.type} = 'income' then ${operations.amount} else -${operations.amount} end)`,
      })
      .from(operations)
      .where(and(...scope, filter.accountId !== undefined ? eq(operations.accountId, filter.accountId) : undefined))
      .groupBy(operations.accountId)
      .all();
    const incoming = db
      .select({ accountId: operations.toAccountId, delta: sql<number>`sum(${operations.toAmount})` })
      .from(operations)
      .where(and(...scope, eq(operations.type, 'transfer'), filter.accountId !== undefined ? eq(operations.toAccountId, filter.accountId) : undefined))
      .groupBy(operations.toAccountId)
      .all();
    const m = new Map<number, number>();
    for (const r of outgoing) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    for (const r of incoming) if (r.accountId !== null) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    return m;
  }

  return {
    accountBalance(account) {
      return account.startingBalance + (movements({ accountId: account.id }).get(account.id) ?? 0);
    },

    companyBalances(companyId) {
      const m = movements({ companyId });
      return db
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, companyId))
        .orderBy(asc(accounts.orderIndex), asc(accounts.id))
        .all()
        .map((a) => ({ accountId: a.id, currency: a.currency, balance: a.startingBalance + (m.get(a.id) ?? 0), archived: a.archivedAt !== null }));
    },
  };
}
```

`src/server/modules/companies/service.ts` — импорты и проверка в `update` перед `mutate`:

```ts
import { asc, count, eq } from 'drizzle-orm';
import { companies, fixedRates, operations } from '../../db/schema';
```

(замените прежние импорты `asc, eq` и `companies`), и в `update` после `if (!changes) return before;`:

```ts
      if (changes.after.baseCurrency !== undefined) {
        // §4.2: базовая валюта неизменна, если есть хотя бы одна операция (включая удалённые) или фиксированный курс
        const ops = db.select({ n: count() }).from(operations).where(eq(operations.companyId, id)).get()?.n ?? 0;
        const fixed = db.select({ n: count() }).from(fixedRates).where(eq(fixedRates.companyId, id)).get()?.n ?? 0;
        if (ops + fixed > 0) {
          throw new AppError(422, 'CURRENCY_LOCKED', 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
        }
      }
```

`src/server/app.ts` — настоящие реализации вместо заглушек:

```ts
import { createLedgerBalances } from './modules/balances/service';
import { createOperationsReferences } from './modules/references/service';
```

(вместо импортов `createBalancesService` и `createReferencesService`), и:

```ts
  const references = createOperationsReferences(db, config.timezone);
  const balances = createLedgerBalances(db);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/ledger.test.ts tests/server/operations-update.test.ts tests/server/accounts-api.test.ts tests/server/companies.test.ts`
Expected: PASS. Тесты задачи 5 по архивному счёту проходят и с настоящим балансом: обороты на таких счетах в сумме дают ноль.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/references/service.ts src/server/modules/balances/service.ts src/server/modules/companies/service.ts src/server/app.ts tests/server/ledger.test.ts
git commit -m "feat: настоящие балансы и ссылки операций, блокировка смены валюты счёта и компании

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: API балансов компании и сводки для переключателя

**Files:**
- Create: `src/server/modules/balances/routes.ts`, `tests/server/balances-api.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `LedgerBalances` (Task 6), `RatesService.resolve` (Task 3), `convertMinor` (Task 1), `CompaniesService`.
- Produces:
  - `CompanyTotal { currency; amount; unavailable: string[] }`;
  - `GET /api/v1/companies/:cid/balances` → `{ accounts: [{ accountId, currency, balance }], total: CompanyTotal }`;
  - `GET /api/v1/companies/summary` → `{ companies: [{ id, name, total }] }` — только активные компании.

- [ ] **Step 1: Write the failing test**

`tests/server/balances-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('balances API', () => {
  it('балансы счетов и «всего на счетах» по курсу на сегодня; валюта без курса — в unavailable (Review Focus 5)', async () => {
    w = await opsWorld(); // сегодня 2026-10-06, курс USD от 2026-10-01 ещё действует
    const accounts = `/api/v1/companies/${w.cid}/accounts`;
    await w.h.req('PATCH', `${accounts}/${w.kzt}`, { startingBalance: 100000 });
    await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    w.h.t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('EUR','Евро','€',2)").run();
    const eur = (await w.post(accounts, { name: 'Евро', currency: 'EUR', openedAt: '2026-10-01', startingBalance: 1000 })).account.id;

    const res = await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`);
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual([
      { accountId: w.kzt, currency: 'KZT', balance: 52488 },
      { accountId: w.usd, currency: 'USD', balance: 100 },
      { accountId: eur, currency: 'EUR', balance: 1000 },
    ]);
    expect(res.json().total).toEqual({ currency: 'KZT', amount: 100000, unavailable: ['EUR'] });
  });

  it('сводка для переключателя: активные компании, итог в своей базовой валюте', async () => {
    w = await opsWorld();
    const usdCo = (await w.post('/api/v1/companies', { name: 'USD Ltd', baseCurrency: 'USD' })).company.id;
    await w.post(`/api/v1/companies/${usdCo}/accounts`, { name: 'Сейф', currency: 'USD', openedAt: '2026-10-01', startingBalance: 500 });
    const archived = await w.h.company('Архивная');
    await w.post(`/api/v1/companies/${archived}/archive`, {});

    const list = (await w.h.req('GET', '/api/v1/companies/summary')).json().companies as { id: number; name: string; total: object }[];
    expect(list.map((c) => c.id)).toEqual([w.cid, usdCo]);
    expect(list.find((c) => c.id === usdCo)!.total).toEqual({ currency: 'USD', amount: 500, unavailable: [] });
    expect(list.find((c) => c.id === w.cid)!.total).toEqual({ currency: 'KZT', amount: 0, unavailable: [] });
  });

  it('неизвестная компания — 404', async () => {
    w = await opsWorld();
    const res = await w.h.req('GET', '/api/v1/companies/999/balances');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Компания не найдена'); // ответ маршрута, а не «маршрут не найден»
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/balances-api.test.ts`
Expected: FAIL — маршруты 404.

- [ ] **Step 3: Implement**

`src/server/modules/balances/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { convertMinor } from '../../../shared/decimal';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
import type { CompaniesService, CompanyRow } from '../companies/service';
import type { RatesService } from '../rates/service';
import type { LedgerBalances } from './service';

export interface CompanyTotal {
  currency: string;
  amount: number;
  /** Валюты, по которым нет курса на сегодня: их счета не вошли в итог. */
  unavailable: string[];
}

export function registerBalancesRoutes(
  app: FastifyInstance,
  deps: { companies: CompaniesService; ledger: LedgerBalances; rates: RatesService; timezone: string; now?: () => Date },
): void {
  const now = deps.now ?? (() => new Date());

  /** «Всего на счетах» (§4.7): неархивные счета в базовой валюте по курсу на сегодня. */
  function total(company: CompanyRow): CompanyTotal {
    const sums = new Map<string, number>();
    for (const b of deps.ledger.companyBalances(company.id)) {
      if (!b.archived) sums.set(b.currency, (sums.get(b.currency) ?? 0) + b.balance);
    }
    const today = todayInTimezone(deps.timezone, now());
    const baseMinor = getCurrency(company.baseCurrency).minorUnits;
    let amount = 0;
    const unavailable: string[] = [];
    for (const [currency, sum] of sums) {
      try {
        const { rate } = deps.rates.resolve(company.id, company.baseCurrency, currency, today);
        amount += convertMinor(sum, rate, getCurrency(currency).minorUnits, baseMinor);
      } catch (e) {
        if (e instanceof AppError && e.code === 'RATE_UNAVAILABLE') unavailable.push(currency);
        else throw e;
      }
    }
    return { currency: company.baseCurrency, amount, unavailable: unavailable.sort() };
  }

  app.get('/api/v1/companies/summary', async () => ({
    companies: deps.companies
      .list()
      .filter((c) => !c.archivedAt)
      .map((c) => ({ id: c.id, name: c.name, total: total(c) })),
  }));

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/balances', async (req) => {
    const company = deps.companies.require(parseId(req.params.cid));
    return {
      accounts: deps.ledger.companyBalances(company.id).map(({ accountId, currency, balance }) => ({ accountId, currency, balance })),
      total: total(company),
    };
  });
}
```

`src/server/app.ts` — импорт и регистрация сразу после `registerOperationsRoutes(…)`:

```ts
import { registerBalancesRoutes } from './modules/balances/routes';
```

```ts
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/balances-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/balances/routes.ts src/server/app.ts tests/server/balances-api.test.ts
git commit -m "feat: API балансов компании и сводки «всего на счетах» для переключателя

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие §10 и шага 4 в этом плане

| Требование | Где |
|---|---|
| `money.ts`: half-up, распределение наибольшим остатком (сумма частей = целое) | Task 1 |
| Курсы: кросс-курс, валюты с 0 и 3 знаками, правило 7 дней, курс базовой = 1 | Tasks 1, 3 |
| Ручной курс на D: действует на D…D+7, не влияет на соседние даты; не перезаписывается | Task 3 |
| Фиксированный курс на `validFrom` и `validTo` включительно, на `validTo + 1` — нет; пересечения отклоняются | Task 3 |
| Сервис операций: CRUD и инварианты 1–7 по тесту на пункт | Tasks 4, 5 |
| Инвариант 7 по подправилам (новый выбор, правка, удаление, восстановление, баланс архивного счёта нулевой) | Tasks 4, 5, 6 (баланс — тест «баланс архивного счёта остаётся нулевым») |
| Инвариант 11: архивная статья не мешает восстановлению, архивный счёт — мешает | Task 5 |
| Мягкое удаление и восстановление | Task 5 |
| Пересчёт `rate` и `baseAmount` при правке | Task 5 |
| Конфликт версии | Task 5 |
| Блокировка смены валют | Task 6 |
| Инвариант 9 на настоящих операциях | Task 6 |
| Баланс на смешанных операциях и переводах между валютами, сверка с пересчётом в JS | Task 6 |
| Изоляция компаний | Tasks 3, 4, 7 |
| «Всего на счетах», валюта без курса | Task 7 |

**Перенесено в план 4b:**
- интерфейс: левая панель счетов с балансами и «Всего на счетах», балансы в переключателе, экран «Курсы» (ручные и фиксированные), блокировка полей валюты на экранах «Счета» и «Компании», подписи новых сущностей в истории (`operation`, `rate`, `fixed_rate`);
- вложения (`attachments`, `data/uploads`, загрузка/скачивание/мягкое удаление);
- `seed:demo` (3 компании, 5 проектов, 8 счетов, 60 статей, 150 контрагентов, 10 000 операций) и тест сверки SQL-балансов с пересчётом в JS на нём (§12).

**Не входит в шаг 4:** лента журнала с фильтрами, поиском и массовыми действиями (шаг 5), форма операции (шаг 6), загрузка курсов Нацбанка (по решению заказчика — позже).
