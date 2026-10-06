# Этап 1, план 2: компании, проекты, шаблоны типов бизнеса — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шаг 2 §11 спецификации. Результат:
- юрлица (компании) с системными статьями;
- проекты, создаваемые по шаблону типа бизнеса (`general`, `computer-club`);
- применение шаблона: слияние статей без дублей и счета по умолчанию;
- схема и сервисы статей и счетов без экранов, только чтение через API;
- в интерфейсе: переключатель компаний, первая компания, экраны «Проекты» и «Компании».

**Architecture:**
- **Сервер.** Новые таблицы `companies`, `projects`, `accounts`, `categories` (миграция 0001). Модули сервера `companies`, `projects`, `categories`, `accounts`, `templates` — фабрики сервисов плюс функции маршрутов, как в плане 1. Применение шаблона выполняется в одной транзакции SQLite.
- **Шаблоны** — TS-модули в `src/templates/`, общие для сервера и клиента (форма параметров строится из `paramsUi` и проверяется той же zod-схемой).
- **Маршруты клиента:**
  - `/` — выбор компании;
  - `/companies/new` — создание компании;
  - `/c/:companyId/log` — журнал;
  - `/c/:companyId/settings/projects` и `/c/:companyId/settings/companies` — настройки.

**Tech Stack:** как в плане 1 (Node 24, Fastify 5, better-sqlite3, Drizzle 0.45, zod 4, React 19, react-router 8, TanStack Query, Tailwind 4, Vitest, Playwright).

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §2, §4.2, §4.4 (`accounts`, `categories`), §4.6 (п. 8, 12), §5, §6 (Компании, Шаблоны, Проекты), §7 (Каркас, Настройки → Компании/Проекты), §11 шаг 2.

**Ветка:** `stage1/plan1-skeleton` (продолжаем; в `main` не сливаем до завершения всех работ — решение заказчика 2026-10-06).

## Global Constraints

- Все справочники привязаны к `companyId`, имеют `orderIndex` и `archivedAt`. Объект чужой компании → 404.
- `companies`: id, name, baseCurrency, archivedAt, createdAt. В этом плане операций и фиксированных курсов ещё нет, поэтому `baseCurrency` можно менять. Блокировку («нельзя менять при наличии операций/фиксированных курсов») добавит план шага 4.
- `projects`: id, companyId, name, templateKey, templateParams (JSON, валидируется схемой шаблона), orderIndex, archivedAt. `templateKey` после создания не меняется.
- `accounts`: name, currency, startingBalance (целое, минимальные единицы), openedAt (`YYYY-MM-DD`), projectId (nullable, проект той же компании).
- `categories`: kind (`income` | `expense`), parentId (nullable, не больше 2 уровней), name, systemKey (nullable), templateRef (nullable). Уникальность:
  - (companyId, kind, templateRef);
  - (companyId, kind, systemKey).

  `templateRef` с префиксом шаблона (`computer-club:bar`).
- Системные статьи создаются вместе с компанией. Это всегда статьи верхнего уровня:
  - доходные: `investment` «Инвестиции», `loan_repaid` «Возврат займа», `credit_received` «Получение кредита»;
  - расходные: `salary` «Зарплата», `tax` «Налоги», `vat` «НДС», `dividends` «Дивиденды», `credit_repayment` «Погашение кредита», `loan_issued` «Выдача займа».
- Связь системной статьи с типом контрагента: salary → employee; tax и vat → tax; dividends → owner; investment → investor; credit_received и credit_repayment → creditor; loan_issued и loan_repaid → borrower. Дочерняя статья наследует эффективный systemKey родителя.
- Применение шаблона при создании проекта — одна транзакция:
  1. Проверить `templateParams` схемой шаблона.
  2. Слить статьи по `(kind, templateRef)`. Узел `underSystem` добавляет детей к системной статье. Повторное применение ничего не меняет.
  3. Создать счета по умолчанию с `projectId` и `openedAt` = сегодня в `APP_TIMEZONE`. `{project}` в названии счёта заменяется на название проекта. Валюта по умолчанию — базовая валюта компании.
  4. Записать событие в `audit_log`.
- Архивирование:
  - проект — только когда все его счета в архиве;
  - компания — только когда все её счета в архиве; архивная компания скрыта из переключателя и доступна в настройках только для чтения (кроме «Вернуть из архива»).

  Нарушение → 422 `ARCHIVED_REFERENCE`.
- Формат ошибки: `{ error: { code, message, fields? } }`. Ошибки параметров шаблона приходят в `fields` с ключами `templateParams.<ключ>`.
- Тексты интерфейса на русском, бренд из `APP_NAME`. Цвета только через токены `styles.css`.
- Изменяющие запросы клиента идут через обёртку `api()`: `fetch` по умолчанию плюс `X-Requested-With: fetch`.
- Безопасность хуков среды: shell-команды не должны содержать подстроку «.env». Строку нельзя собирать из частей, чтобы обойти хук.
- Каждая задача заканчивается зелёными `npm test` и `npm run typecheck` и коммитом. Сообщение коммита завершается пустой строкой и трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Второй клуб в той же компании.** Статьи шаблона не дублируются, у второго клуба появляются свои «Касса …» и «Kaspi …». Тест — в задаче 5.
2. **Пользователь переименовал или архивировал статью шаблона, затем создал ещё один клуб.** Статья не пересоздаётся, не переименовывается обратно и не возвращается из архива. Тест — в задаче 5.
3. **Чужие id в URL** (`/companies/1/projects/<id проекта компании 2>`). Ответ 404, ничего не меняется. Тест — в задаче 5.
4. **Кривые параметры шаблона** (`pcCount: "30"`, `0`, отсутствует, лишние ключи). Ответ 400 с `fields['templateParams.pcCount']`, лишние ключи отбрасываются. Тест — в задаче 5.
5. **Граница суток.** Проект создан в 19:30 UTC — это 00:30 следующего дня по Алматы. `openedAt` счетов равен дате по Алматы. Тест — в задаче 5.

---

## Карта файлов

```
src/shared/
  system-categories.ts      # системные статьи, типы, связь с контрагентами, effectiveSystemKey
  dates.ts                  # todayInTimezone
  currencies.ts             # (+ isKnownCurrency)
  schemas/companies.ts      # zod-схемы тел запросов компаний
  schemas/projects.ts       # zod-схемы тел запросов проектов
src/templates/
  types.ts, general.ts, computer-club.ts, index.ts
src/server/
  db/schema.ts              # (+ companies, projects, accounts, categories)
  db/client.ts              # (+ Executor)
  db/migrations/0001_*.sql  # генерируется
  http/params.ts            # parseId
  modules/categories/{service.ts, routes.ts}
  modules/accounts/{service.ts, routes.ts}
  modules/companies/{service.ts, routes.ts}
  modules/projects/{service.ts, routes.ts}
  modules/templates/routes.ts
  app.ts                    # (+ сервисы и маршруты)
src/client/
  router.tsx                # (переписан)
  lib/queries.ts            # типы и хуки компаний/проектов/шаблонов
  components/ui.ts          # классы полей и кнопок
  components/AppHeader.tsx
  components/CompanySwitcher.tsx
  components/CompanyForm.tsx
  components/ProjectForm.tsx
  pages/RequireAuth.tsx
  pages/CompanyGate.tsx
  pages/NewCompanyPage.tsx
  pages/CompanyLayout.tsx
  pages/JournalPage.tsx
  pages/settings/SettingsNav.tsx
  pages/settings/ProjectsSettings.tsx
  pages/settings/CompaniesSettings.tsx
  pages/AppShell.tsx        # (удаляется)
tests/
  shared/{system-categories,dates,templates}.test.ts
  server/{schema-0001,categories,accounts,companies,projects}.test.ts
e2e/
  auth.spec.ts              # (правка ожиданий после входа)
  companies.spec.ts
playwright.config.ts        # (+ workers: 1)
```

---

### Task 1: Системные статьи, даты и шаблоны типов бизнеса

**Files:**
- Create: `src/shared/system-categories.ts`, `src/shared/dates.ts`, `src/templates/types.ts`, `src/templates/general.ts`, `src/templates/computer-club.ts`, `src/templates/index.ts`
- Modify: `src/shared/currencies.ts` (добавить `isKnownCurrency`)
- Test: `tests/shared/system-categories.test.ts`, `tests/shared/dates.test.ts`, `tests/shared/templates.test.ts`

**Interfaces:**
- Consumes: `CURRENCIES` (`src/shared/currencies.ts`).
- Produces:
  ```ts
  // system-categories.ts
  type CategoryKind = 'income' | 'expense';
  type SystemKey = 'investment' | 'loan_repaid' | 'credit_received' | 'salary' | 'tax' | 'vat'
    | 'dividends' | 'credit_repayment' | 'loan_issued';
  type CounterpartyType = 'client' | 'supplier' | 'employee' | 'owner' | 'investor' | 'creditor' | 'borrower' | 'tax';
  interface SystemCategoryDef { key: SystemKey; kind: CategoryKind; name: string; counterpartyType: CounterpartyType }
  const SYSTEM_CATEGORIES: readonly SystemCategoryDef[];
  function systemCategory(key: SystemKey): SystemCategoryDef;
  function effectiveSystemKey(own: SystemKey | null, parent: SystemKey | null): SystemKey | null;
  // dates.ts
  function todayInTimezone(timezone: string, now?: Date): string; // YYYY-MM-DD
  // currencies.ts
  function isKnownCurrency(code: string): boolean;
  // templates/types.ts
  interface CategoryLeaf { ref: string; name: string }
  interface CategoryGroup { ref: string; name: string; children?: CategoryLeaf[] }
  interface UnderSystemGroup { underSystem: SystemKey; children: CategoryLeaf[] }
  type CategoryNode = CategoryGroup | UnderSystemGroup;
  interface ParamUi { key: string; label: string; type: 'int' | 'text'; hint?: string }
  interface MetricDef { key: string; label: string; unit: 'money' | 'percent' }
  interface BusinessTemplate {
    key: string; name: string;
    params: z.ZodType<Record<string, unknown>>; paramsUi: ParamUi[];
    categories: { income: CategoryNode[]; expense: CategoryNode[] };
    defaultAccounts: { name: string; currency?: string }[];
    integrations: string[]; metrics: MetricDef[];
  }
  function isUnderSystem(node: CategoryNode): node is UnderSystemGroup;
  // templates/index.ts
  const TEMPLATES: readonly BusinessTemplate[];
  function getTemplate(key: string): BusinessTemplate | undefined;
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/shared/system-categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory } from '../../src/shared/system-categories';

describe('системные статьи', () => {
  it('содержат 3 доходные и 6 расходных статей с русскими названиями', () => {
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === 'income').map((c) => c.key)).toEqual([
      'investment',
      'loan_repaid',
      'credit_received',
    ]);
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === 'expense').map((c) => c.key)).toEqual([
      'salary',
      'tax',
      'vat',
      'dividends',
      'credit_repayment',
      'loan_issued',
    ]);
    expect(systemCategory('loan_repaid').name).toBe('Возврат займа');
    expect(systemCategory('salary').name).toBe('Зарплата');
  });

  it('связывают статьи с типами контрагентов по спецификации', () => {
    const map = Object.fromEntries(SYSTEM_CATEGORIES.map((c) => [c.key, c.counterpartyType]));
    expect(map).toEqual({
      investment: 'investor',
      loan_repaid: 'borrower',
      credit_received: 'creditor',
      salary: 'employee',
      tax: 'tax',
      vat: 'tax',
      dividends: 'owner',
      credit_repayment: 'creditor',
      loan_issued: 'borrower',
    });
  });

  it('дочерняя статья наследует эффективный systemKey родителя', () => {
    expect(effectiveSystemKey(null, 'salary')).toBe('salary');
    expect(effectiveSystemKey('tax', null)).toBe('tax');
    expect(effectiveSystemKey(null, null)).toBeNull();
  });
});
```

`tests/shared/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { todayInTimezone } from '../../src/shared/dates';

describe('todayInTimezone', () => {
  it('возвращает календарную дату в указанном поясе', () => {
    // 19:30 UTC 5 октября = 00:30 6 октября в Алматы (UTC+5)
    expect(todayInTimezone('Asia/Almaty', new Date('2026-10-05T19:30:00.000Z'))).toBe('2026-10-06');
    expect(todayInTimezone('UTC', new Date('2026-10-05T19:30:00.000Z'))).toBe('2026-10-05');
  });
});
```

`tests/shared/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { systemCategory } from '../../src/shared/system-categories';
import { getTemplate, TEMPLATES } from '../../src/templates';
import { isUnderSystem, type CategoryNode } from '../../src/templates/types';

function refsOf(nodes: CategoryNode[]): string[] {
  return nodes.flatMap((n) => [...(isUnderSystem(n) ? [] : [n.ref]), ...(n.children ?? []).map((c) => c.ref)]);
}

describe('шаблоны', () => {
  it('есть general и computer-club', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual(['computer-club', 'general']);
    expect(getTemplate('computer-club')?.name).toBe('Компьютерный клуб');
    expect(getTemplate('general')?.name).toBe('Общий');
    expect(getTemplate('nope')).toBeUndefined();
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: ref уникальны и с префиксом шаблона', (key, t) => {
    const refs = [...refsOf(t.categories.income), ...refsOf(t.categories.expense)];
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.every((r) => r.startsWith(`${key}:`))).toBe(true);
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: underSystem ссылается на системную статью своего вида', (_k, t) => {
    for (const kind of ['income', 'expense'] as const) {
      for (const n of t.categories[kind]) {
        if (isUnderSystem(n)) expect(systemCategory(n.underSystem).kind).toBe(kind);
      }
    }
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: paramsUi совпадает с полями схемы', (_k, t) => {
    const shape = (t.params as unknown as z.ZodObject<z.ZodRawShape>).shape;
    expect(t.paramsUi.map((p) => p.key)).toEqual(Object.keys(shape));
  });

  it('computer-club: параметры по спецификации', () => {
    const t = getTemplate('computer-club')!;
    expect(t.params.parse({ pcCount: 30 })).toEqual({ pcCount: 30, consoleCount: 0 });
    expect(t.params.safeParse({ pcCount: 0 }).success).toBe(false);
    expect(t.params.safeParse({ pcCount: 30, consoleCount: -1 }).success).toBe(false);
    expect(t.params.safeParse({}).success).toBe(false);
    expect(t.params.parse({ pcCount: 30, extra: 1 })).toEqual({ pcCount: 30, consoleCount: 0 });
    expect(t.defaultAccounts).toEqual([
      { name: 'Касса {project}', currency: 'KZT' },
      { name: 'Kaspi {project}', currency: 'KZT' },
    ]);
    expect(t.integrations).toEqual(['senet']);
    expect(t.metrics.map((m) => m.key)).toEqual(['revenuePerPcPerDay', 'barShare', 'payrollToRevenue', 'rentToRevenue']);
    const salary = t.categories.expense.find(isUnderSystem)!;
    expect(salary.underSystem).toBe('salary');
    expect(salary.children.map((c) => c.name)).toEqual(['Администраторы', 'Премии']);
  });

  it('general: пустой', () => {
    const t = getTemplate('general')!;
    expect(t.params.parse({})).toEqual({});
    expect(t.categories).toEqual({ income: [], expense: [] });
    expect(t.defaultAccounts).toEqual([]);
    expect(t.integrations).toEqual([]);
    expect(t.metrics).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/shared/system-categories.test.ts tests/shared/dates.test.ts tests/shared/templates.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать `src/shared/system-categories.ts`**

```ts
export type CategoryKind = 'income' | 'expense';

export type SystemKey =
  | 'investment'
  | 'loan_repaid'
  | 'credit_received'
  | 'salary'
  | 'tax'
  | 'vat'
  | 'dividends'
  | 'credit_repayment'
  | 'loan_issued';

export type CounterpartyType = 'client' | 'supplier' | 'employee' | 'owner' | 'investor' | 'creditor' | 'borrower' | 'tax';

export interface SystemCategoryDef {
  key: SystemKey;
  kind: CategoryKind;
  name: string;
  counterpartyType: CounterpartyType;
}

export const SYSTEM_CATEGORIES: readonly SystemCategoryDef[] = [
  { key: 'investment', kind: 'income', name: 'Инвестиции', counterpartyType: 'investor' },
  { key: 'loan_repaid', kind: 'income', name: 'Возврат займа', counterpartyType: 'borrower' },
  { key: 'credit_received', kind: 'income', name: 'Получение кредита', counterpartyType: 'creditor' },
  { key: 'salary', kind: 'expense', name: 'Зарплата', counterpartyType: 'employee' },
  { key: 'tax', kind: 'expense', name: 'Налоги', counterpartyType: 'tax' },
  { key: 'vat', kind: 'expense', name: 'НДС', counterpartyType: 'tax' },
  { key: 'dividends', kind: 'expense', name: 'Дивиденды', counterpartyType: 'owner' },
  { key: 'credit_repayment', kind: 'expense', name: 'Погашение кредита', counterpartyType: 'creditor' },
  { key: 'loan_issued', kind: 'expense', name: 'Выдача займа', counterpartyType: 'borrower' },
];

const byKey = new Map(SYSTEM_CATEGORIES.map((c) => [c.key, c]));

export function systemCategory(key: SystemKey): SystemCategoryDef {
  const c = byKey.get(key);
  if (!c) throw new Error(`Неизвестная системная статья: ${key}`);
  return c;
}

export function effectiveSystemKey(own: SystemKey | null, parent: SystemKey | null): SystemKey | null {
  return own ?? parent;
}
```

- [ ] **Step 4: Реализовать `src/shared/dates.ts` и `isKnownCurrency`**

`src/shared/dates.ts`:

```ts
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
```

В конец `src/shared/currencies.ts` добавить:

```ts
export function isKnownCurrency(code: string): boolean {
  return byCode.has(code);
}
```

- [ ] **Step 5: Реализовать шаблоны**

`src/templates/types.ts`:

```ts
import type { z } from 'zod';
import type { SystemKey } from '../shared/system-categories';

export interface CategoryLeaf {
  ref: string;
  name: string;
}

export interface CategoryGroup {
  ref: string;
  name: string;
  children?: CategoryLeaf[];
}

export interface UnderSystemGroup {
  underSystem: SystemKey;
  children: CategoryLeaf[];
}

export type CategoryNode = CategoryGroup | UnderSystemGroup;

export interface ParamUi {
  key: string;
  label: string;
  type: 'int' | 'text';
  hint?: string;
}

export interface MetricDef {
  key: string;
  label: string;
  unit: 'money' | 'percent';
}

export interface BusinessTemplate {
  key: string;
  name: string;
  params: z.ZodType<Record<string, unknown>>;
  paramsUi: ParamUi[];
  categories: { income: CategoryNode[]; expense: CategoryNode[] };
  defaultAccounts: { name: string; currency?: string }[];
  integrations: string[];
  metrics: MetricDef[];
}

export function isUnderSystem(node: CategoryNode): node is UnderSystemGroup {
  return 'underSystem' in node;
}
```

`src/templates/general.ts`:

```ts
import { z } from 'zod';
import type { BusinessTemplate } from './types';

export const general: BusinessTemplate = {
  key: 'general',
  name: 'Общий',
  params: z.object({}),
  paramsUi: [],
  categories: { income: [], expense: [] },
  defaultAccounts: [],
  integrations: [],
  metrics: [],
};
```

`src/templates/computer-club.ts`:

```ts
import { z } from 'zod';
import type { BusinessTemplate, CategoryLeaf } from './types';

const r = (ref: string, name: string): CategoryLeaf => ({ ref: `computer-club:${ref}`, name });

export const computerClub: BusinessTemplate = {
  key: 'computer-club',
  name: 'Компьютерный клуб',
  params: z.object({
    pcCount: z.number({ message: 'Введите число' }).int('Целое число').min(1, 'Не меньше 1'),
    consoleCount: z.number({ message: 'Введите число' }).int('Целое число').min(0, 'Не меньше 0').default(0),
  }),
  paramsUi: [
    { key: 'pcCount', label: 'Количество ПК', type: 'int' },
    { key: 'consoleCount', label: 'Количество консолей', type: 'int', hint: 'Если консолей нет — 0' },
  ],
  categories: {
    income: [
      r('shift-revenue', 'Выручка за смену (игровое время)'),
      r('bar-sales', 'Бар'),
      r('consoles-vip', 'Консоли и VIP'),
      r('tournaments', 'Турниры'),
      r('other-income', 'Прочие доходы'),
      r('adjustment', 'Корректировка / излишек'),
    ],
    expense: [
      { underSystem: 'salary', children: [r('salary-admins', 'Администраторы'), r('salary-bonuses', 'Премии')] },
      {
        ...r('premises', 'Помещение'),
        children: [r('rent', 'Аренда'), r('utilities', 'Коммунальные услуги'), r('electricity', 'Электроэнергия'), r('internet', 'Интернет')],
      },
      {
        ...r('equipment', 'Оборудование'),
        children: [r('computers', 'Компьютерное оборудование'), r('repair', 'Ремонт и обслуживание'), r('furniture', 'Мебель')],
      },
      r('software', 'ПО и подписки'),
      { ...r('bar', 'Бар'), children: [r('bar-purchase', 'Закуп бара')] },
      {
        ...r('marketing', 'Маркетинг'),
        children: [r('ads', 'Реклама'), r('loyalty', 'Лояльность и бонусы за пополнение'), r('prizes', 'Призовые турниров')],
      },
      {
        ...r('operations', 'Эксплуатация'),
        children: [r('consumables', 'Расходники'), r('hygiene', 'Гигиена и уборка'), r('dry-cleaning', 'Химчистка')],
      },
      { ...r('finance', 'Финансы'), children: [r('bank-fees', 'Комиссии банка и эквайринга'), r('cash-collection', 'Инкассация')] },
      {
        ...r('other', 'Прочее'),
        children: [r('corporate', 'Корпоратив'), r('charity', 'Благотворительность'), r('write-offs', 'Списания')],
      },
    ],
  },
  defaultAccounts: [
    { name: 'Касса {project}', currency: 'KZT' },
    { name: 'Kaspi {project}', currency: 'KZT' },
  ],
  integrations: ['senet'],
  metrics: [
    { key: 'revenuePerPcPerDay', label: 'Выручка на ПК в день', unit: 'money' },
    { key: 'barShare', label: 'Доля бара в выручке', unit: 'percent' },
    { key: 'payrollToRevenue', label: 'ФОТ к выручке', unit: 'percent' },
    { key: 'rentToRevenue', label: 'Аренда к выручке', unit: 'percent' },
  ],
};
```

`src/templates/index.ts`:

```ts
import { computerClub } from './computer-club';
import { general } from './general';
import type { BusinessTemplate } from './types';

export const TEMPLATES: readonly BusinessTemplate[] = [computerClub, general];

export function getTemplate(key: string): BusinessTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npx vitest run tests/shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared src/templates tests/shared
git commit -m "feat: системные статьи и шаблоны типов бизнеса (общий, компьютерный клуб)"
```

---

### Task 2: Схема БД: компании, проекты, счета, статьи (миграция 0001)

**Files:**
- Modify: `src/server/db/schema.ts`, `src/server/db/client.ts`
- Create (генерируется): `src/server/db/migrations/0001_*.sql`, `meta/0001_snapshot.json`, правка `meta/_journal.json`
- Test: `tests/server/schema-0001.test.ts`

**Interfaces:**
- Consumes: `openDb`, `runMigrations`, `MIGRATIONS_DIR`, `createBackupService`, `startServer` (план 1).
- Produces:
  ```ts
  // schema.ts
  companies, projects, accounts, categories   // таблицы Drizzle
  // client.ts
  type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/server/schema-0001.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR } from '../../src/server/db/migrate';
import { startServer } from '../../src/server/main';
import { createTestDb } from '../helpers/test-db';
import { testConfig } from '../helpers/test-app';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('миграция 0001', () => {
  it('создаёт таблицы и уникальные индексы статей', () => {
    const t = createTestDb();
    cleanup = t.cleanup;
    const s = t.sqlite;
    s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
    s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО', 'KZT', 'x')").run();
    const ins = s.prepare(
      "INSERT INTO categories (company_id, kind, parent_id, name, system_key, template_ref, order_index, created_at) VALUES (1, ?, NULL, ?, ?, ?, 0, 'x')",
    );
    ins.run('expense', 'Зарплата', 'salary', null);
    expect(() => ins.run('expense', 'Зарплата 2', 'salary', null)).toThrow(/UNIQUE/);
    ins.run('income', 'Доп', 'salary', null); // другой вид — допустимо на уровне БД
    ins.run('expense', 'Бар', null, 'computer-club:bar');
    expect(() => ins.run('expense', 'Бар 2', null, 'computer-club:bar')).toThrow(/UNIQUE/);
    ins.run('expense', 'Без ссылки 1', null, null);
    ins.run('expense', 'Без ссылки 2', null, null); // NULL не конфликтует
    expect(() =>
      s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','XXX',0,'2026-10-06',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('при старте с БД на миграции 0000 делает бэкап перед миграцией', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig-'));
    cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.backupsDir, { recursive: true });

    // каталог миграций только с 0000
    const only0 = path.join(dir, 'migrations-0000');
    fs.cpSync(MIGRATIONS_DIR, only0, { recursive: true });
    const journalPath = path.join(only0, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    {
      const { sqlite, db } = openDb(config.dbPath);
      migrate(db, { migrationsFolder: only0 });
      sqlite.close();
    }
    // свежий «вчерашний» бэкап, чтобы стартовый ensureRecent не создал ещё один
    const fresh = path.join(config.backupsDir, 'backup-20261005-120000.zip');
    fs.writeFileSync(fresh, 'x');

    const s = await startServer(config, { logger: false, handleSignals: false });
    try {
      const zips = fs.readdirSync(config.backupsDir).filter((f) => f.endsWith('.zip'));
      expect(zips.length).toBe(2); // fresh + pre-migration
      const res = await s.app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200); // сервер поднялся на мигрированной БД
    } finally {
      await s.stop();
    }
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/schema-0001.test.ts`
Expected: FAIL — `no such table: companies`.

- [ ] **Step 3: Добавить таблицы в `src/server/db/schema.ts`**

Заменить первую строку импорта и дописать в конец файла:

```ts
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
```

```ts
export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  baseCurrency: text('base_currency')
    .notNull()
    .references(() => currencies.code),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    templateKey: text('template_key').notNull(),
    templateParams: text('template_params').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('projects_company_idx').on(t.companyId, t.orderIndex)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: integer('project_id').references(() => projects.id),
    name: text('name').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    startingBalance: integer('starting_balance').notNull(),
    openedAt: text('opened_at').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('accounts_company_idx').on(t.companyId, t.orderIndex)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id),
    name: text('name').notNull(),
    systemKey: text('system_key'),
    templateRef: text('template_ref'),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    uniqueIndex('categories_template_ref_uq').on(t.companyId, t.kind, t.templateRef),
    uniqueIndex('categories_system_key_uq').on(t.companyId, t.kind, t.systemKey),
    index('categories_company_idx').on(t.companyId, t.kind, t.parentId),
  ],
);
```

В `src/server/db/client.ts` после `export type Db = …` добавить:

```ts
/** База или транзакция Drizzle — сервисы принимают любое, чтобы работать внутри общей транзакции. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
```

- [ ] **Step 4: Сгенерировать миграцию**

Run: `npm run db:generate`
Expected: появились `src/server/db/migrations/0001_*.sql` и `meta/0001_snapshot.json`; в SQL есть `CREATE TABLE companies`, `projects`, `accounts`, `categories` и два `CREATE UNIQUE INDEX` по статьям. Существующую миграцию 0000 не трогать.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/schema-0001.test.ts && npm test && npm run typecheck`
Expected: PASS; существующие тесты (в том числе `db.test.ts` — «применяет все миграции кода») зелёные.

- [ ] **Step 6: Commit**

```bash
git add src/server/db tests/server/schema-0001.test.ts
git commit -m "feat: таблицы компаний, проектов, счетов и статей (миграция 0001)"
```

---

### Task 3: Сервисы статей и счетов

**Files:**
- Create: `src/server/modules/categories/service.ts`, `src/server/modules/accounts/service.ts`
- Test: `tests/server/categories.test.ts`, `tests/server/accounts.test.ts`

**Interfaces:**
- Consumes: `Executor`, `Db` (задача 2); таблицы `categories`, `accounts`, `companies`; `SYSTEM_CATEGORIES`, `effectiveSystemKey`, `SystemKey`, `CategoryKind`, `systemCategory` (задача 1); `BusinessTemplate`, `isUnderSystem` (задача 1); `isKnownCurrency` (задача 1); `AppError` (план 1).
- Produces:
  ```ts
  // categories/service.ts
  interface CategoryRow { id: number; companyId: number; kind: CategoryKind; parentId: number | null; name: string;
    systemKey: SystemKey | null; templateRef: string | null; orderIndex: number; archivedAt: string | null }
  interface CategoryNodeDto extends CategoryRow { effectiveSystemKey: SystemKey | null; children: CategoryNodeDto[] }
  interface CategoriesService {
    seedSystem(ex: Executor, companyId: number): void;
    mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number; // сколько создано
    listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
  }
  function createCategoriesService(db: Db, now?: () => Date): CategoriesService;
  // accounts/service.ts
  interface AccountRow { id: number; companyId: number; projectId: number | null; name: string; currency: string;
    startingBalance: number; openedAt: string; orderIndex: number; createdAt: string; archivedAt: string | null }
  interface AccountsService {
    create(ex: Executor, input: { companyId: number; projectId?: number | null; name: string; currency: string;
      startingBalance?: number; openedAt: string }): AccountRow;
    list(companyId: number): AccountRow[];
    countActive(companyId: number, projectId?: number): number;
  }
  function createAccountsService(db: Db, now?: () => Date): AccountsService;
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/server/categories.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { getTemplate } from '../../src/templates';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  seedCurrencies(t.db);
  const company = t.db.insert(companies).values({ name: 'ТОО', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  const svc = createCategoriesService(t.db, () => new Date('2026-10-06T00:00:00.000Z'));
  return { svc, companyId: company.id };
}

describe('categories', () => {
  it('seedSystem создаёт 9 системных статей верхнего уровня', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    const tree = svc.listTree(companyId);
    expect(tree.income.map((c) => c.name)).toEqual(['Инвестиции', 'Возврат займа', 'Получение кредита']);
    expect(tree.expense.map((c) => c.systemKey)).toEqual(['salary', 'tax', 'vat', 'dividends', 'credit_repayment', 'loan_issued']);
    expect(tree.expense.every((c) => c.parentId === null && c.effectiveSystemKey === c.systemKey)).toBe(true);
  });

  it('mergeTemplate кладёт детей underSystem под системную статью и наследует systemKey', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    const created = svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    expect(created).toBeGreaterThan(20);
    const salary = svc.listTree(companyId).expense.find((c) => c.systemKey === 'salary')!;
    expect(salary.children.map((c) => c.name)).toEqual(['Администраторы', 'Премии']);
    expect(salary.children.every((c) => c.systemKey === null && c.effectiveSystemKey === 'salary')).toBe(true);
    const premises = svc.listTree(companyId).expense.find((c) => c.templateRef === 'computer-club:premises')!;
    expect(premises.children.map((c) => c.name)).toEqual(['Аренда', 'Коммунальные услуги', 'Электроэнергия', 'Интернет']);
    expect(premises.effectiveSystemKey).toBeNull();
  });

  it('mergeTemplate идемпотентен', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    const before = JSON.stringify(svc.listTree(companyId));
    expect(svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    expect(JSON.stringify(svc.listTree(companyId))).toBe(before);
  });

  it('mergeTemplate не трогает переименованные и архивные статьи шаблона (Review Focus 2)', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    t.sqlite.prepare("UPDATE categories SET name = 'Аренда зала' WHERE template_ref = 'computer-club:rent'").run();
    t.sqlite.prepare("UPDATE categories SET archived_at = 'x' WHERE template_ref = 'computer-club:charity'").run();
    expect(svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    const rows = t.sqlite
      .prepare("SELECT name, archived_at FROM categories WHERE template_ref IN ('computer-club:rent','computer-club:charity') ORDER BY template_ref")
      .all() as { name: string; archived_at: string | null }[];
    expect(rows).toEqual([
      { name: 'Благотворительность', archived_at: 'x' },
      { name: 'Аренда зала', archived_at: null },
    ]);
  });

  it('mergeTemplate без системных статей падает понятной ошибкой', () => {
    const { svc, companyId } = setup();
    expect(() => svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toThrow(/salary/);
  });
});
```

`tests/server/accounts.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companies, projects } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  seedCurrencies(t.db);
  const c1 = t.db.insert(companies).values({ name: 'A', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  const c2 = t.db.insert(companies).values({ name: 'B', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  return { svc: createAccountsService(t.db, () => new Date('2026-10-06T00:00:00.000Z')), c1: c1.id, c2: c2.id };
}

describe('accounts', () => {
  it('создаёт счета по порядку и отдаёт только счета своей компании', () => {
    const { svc, c1, c2 } = setup();
    const a = svc.create(t.db, { companyId: c1, name: ' Касса ', currency: 'KZT', openedAt: '2026-10-06' });
    svc.create(t.db, { companyId: c1, name: 'USD', currency: 'USD', openedAt: '2026-10-06', startingBalance: 1000 });
    svc.create(t.db, { companyId: c2, name: 'Чужой', currency: 'KZT', openedAt: '2026-10-06' });
    expect(a).toMatchObject({ name: 'Касса', startingBalance: 0, orderIndex: 0, projectId: null, archivedAt: null });
    expect(svc.list(c1).map((x) => [x.name, x.orderIndex, x.startingBalance])).toEqual([
      ['Касса', 0, 0],
      ['USD', 1, 1000],
    ]);
  });

  it('отклоняет неизвестную валюту, пустое имя, дробный баланс, кривую дату и чужой проект', () => {
    const { svc, c1, c2 } = setup();
    const fieldsOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return Object.keys((e as { fields?: Record<string, string> }).fields ?? {});
      }
      throw new Error('ожидалась ошибка');
    };
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'XXX', openedAt: '2026-10-06' }))).toEqual(['currency']);
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: '  ', currency: 'KZT', openedAt: '2026-10-06' }))).toEqual(['name']);
    expect(
      fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '2026-10-06', startingBalance: 1.5 })),
    ).toEqual(['startingBalance']);
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '06.10.2026' }))).toEqual(['openedAt']);
    const foreignProject = t.db
      .insert(projects)
      .values({ companyId: c2, name: 'Чужой', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' })
      .returning()
      .get();
    expect(
      fieldsOf(() => svc.create(t.db, { companyId: c1, projectId: foreignProject.id, name: 'X', currency: 'KZT', openedAt: '2026-10-06' })),
    ).toEqual(['projectId']);
  });

  it('countActive считает неархивные счета компании и отдельно проекта', () => {
    const { svc, c1 } = setup();
    const p = t.db
      .insert(projects)
      .values({ companyId: c1, name: 'Клуб', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' })
      .returning()
      .get();
    svc.create(t.db, { companyId: c1, name: 'A', currency: 'KZT', openedAt: '2026-10-06' });
    svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P1', currency: 'KZT', openedAt: '2026-10-06' });
    const b = svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P2', currency: 'KZT', openedAt: '2026-10-06' });
    t.sqlite.prepare('UPDATE accounts SET archived_at = ? WHERE id = ?').run('x', b.id);
    expect(svc.countActive(c1)).toBe(2);
    expect(svc.countActive(c1, p.id)).toBe(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/server/categories.test.ts tests/server/accounts.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать `src/server/modules/categories/service.ts`**

```ts
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory, type CategoryKind, type SystemKey } from '../../../shared/system-categories';
import { isUnderSystem, type BusinessTemplate } from '../../../templates/types';
import type { Db, Executor } from '../../db/client';
import { categories } from '../../db/schema';

export interface CategoryRow {
  id: number;
  companyId: number;
  kind: CategoryKind;
  parentId: number | null;
  name: string;
  systemKey: SystemKey | null;
  templateRef: string | null;
  orderIndex: number;
  archivedAt: string | null;
}

export interface CategoryNodeDto extends CategoryRow {
  effectiveSystemKey: SystemKey | null;
  children: CategoryNodeDto[];
}

export interface CategoriesService {
  seedSystem(ex: Executor, companyId: number): void;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number;
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
}

function toRow(r: typeof categories.$inferSelect): CategoryRow {
  return {
    id: r.id,
    companyId: r.companyId,
    kind: r.kind,
    parentId: r.parentId,
    name: r.name,
    systemKey: r.systemKey as SystemKey | null,
    templateRef: r.templateRef,
    orderIndex: r.orderIndex,
    archivedAt: r.archivedAt,
  };
}

export function createCategoriesService(db: Db, now: () => Date = () => new Date()): CategoriesService {
  function nextOrder(ex: Executor, companyId: number, kind: CategoryKind, parentId: number | null): number {
    const row = ex
      .select({ m: sql<number>`coalesce(max(${categories.orderIndex}), -1)` })
      .from(categories)
      .where(
        and(
          eq(categories.companyId, companyId),
          eq(categories.kind, kind),
          parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        ),
      )
      .get();
    return (row?.m ?? -1) + 1;
  }

  function insert(
    ex: Executor,
    v: { companyId: number; kind: CategoryKind; parentId: number | null; name: string; systemKey?: SystemKey; templateRef?: string },
  ) {
    return ex
      .insert(categories)
      .values({
        companyId: v.companyId,
        kind: v.kind,
        parentId: v.parentId,
        name: v.name,
        systemKey: v.systemKey ?? null,
        templateRef: v.templateRef ?? null,
        orderIndex: nextOrder(ex, v.companyId, v.kind, v.parentId),
        createdAt: now().toISOString(),
      })
      .returning()
      .get();
  }

  function findByRef(ex: Executor, companyId: number, kind: CategoryKind, ref: string) {
    return ex
      .select()
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.templateRef, ref)))
      .get();
  }

  return {
    seedSystem(ex, companyId) {
      for (const def of SYSTEM_CATEGORIES) {
        insert(ex, { companyId, kind: def.kind, parentId: null, name: def.name, systemKey: def.key });
      }
    },

    mergeTemplate(ex, companyId, template) {
      let created = 0;
      for (const kind of ['income', 'expense'] as const) {
        for (const node of template.categories[kind]) {
          let parentId: number;
          if (isUnderSystem(node)) {
            if (systemCategory(node.underSystem).kind !== kind) {
              throw new Error(`Системная статья ${node.underSystem} не относится к виду ${kind}`);
            }
            const sys = ex
              .select()
              .from(categories)
              .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.systemKey, node.underSystem)))
              .get();
            if (!sys) throw new Error(`В компании ${companyId} нет системной статьи ${node.underSystem}`);
            parentId = sys.id;
          } else {
            const existing = findByRef(ex, companyId, kind, node.ref);
            if (existing) parentId = existing.id;
            else {
              parentId = insert(ex, { companyId, kind, parentId: null, name: node.name, templateRef: node.ref }).id;
              created++;
            }
          }
          for (const child of node.children ?? []) {
            if (findByRef(ex, companyId, kind, child.ref)) continue;
            insert(ex, { companyId, kind, parentId, name: child.name, templateRef: child.ref });
            created++;
          }
        }
      }
      return created;
    },

    listTree(companyId) {
      const rows = db
        .select()
        .from(categories)
        .where(eq(categories.companyId, companyId))
        .orderBy(asc(categories.orderIndex), asc(categories.id))
        .all()
        .map(toRow);
      const byId = new Map<number, CategoryNodeDto>();
      for (const r of rows) byId.set(r.id, { ...r, effectiveSystemKey: r.systemKey, children: [] });
      const result = { income: [] as CategoryNodeDto[], expense: [] as CategoryNodeDto[] };
      for (const node of byId.values()) {
        const parent = node.parentId === null ? undefined : byId.get(node.parentId);
        if (parent) {
          node.effectiveSystemKey = effectiveSystemKey(node.systemKey, parent.systemKey);
          parent.children.push(node);
        } else {
          result[node.kind].push(node);
        }
      }
      return result;
    },
  };
}
```

- [ ] **Step 4: Реализовать `src/server/modules/accounts/service.ts`**

```ts
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { isKnownCurrency } from '../../../shared/currencies';
import type { Db, Executor } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Название счёта шаблона = префикс + название проекта (до 100), поэтому лимит с запасом. */
export const ACCOUNT_NAME_MAX = 120;

export interface AccountRow {
  id: number;
  companyId: number;
  projectId: number | null;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface AccountsService {
  create(
    ex: Executor,
    input: { companyId: number; projectId?: number | null; name: string; currency: string; startingBalance?: number; openedAt: string },
  ): AccountRow;
  list(companyId: number): AccountRow[];
  countActive(companyId: number, projectId?: number): number;
}

export function createAccountsService(db: Db, now: () => Date = () => new Date()): AccountsService {
  return {
    create(ex, input) {
      const name = input.name.trim();
      const startingBalance = input.startingBalance ?? 0;
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > ACCOUNT_NAME_MAX) fields.name = `Название счёта: от 1 до ${ACCOUNT_NAME_MAX} символов`;
      if (!isKnownCurrency(input.currency)) fields.currency = 'Неизвестная валюта';
      if (!Number.isSafeInteger(startingBalance)) fields.startingBalance = 'Стартовый баланс — целое число минимальных единиц';
      if (!DATE_RE.test(input.openedAt)) fields.openedAt = 'Дата открытия в формате ГГГГ-ММ-ДД';
      if (input.projectId != null) {
        const p = ex.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, input.projectId)).get();
        if (!p || p.companyId !== input.companyId) fields.projectId = 'Проект не найден в этой компании';
      }
      if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

      const next = ex
        .select({ m: sql<number>`coalesce(max(${accounts.orderIndex}), -1)` })
        .from(accounts)
        .where(eq(accounts.companyId, input.companyId))
        .get();
      return ex
        .insert(accounts)
        .values({
          companyId: input.companyId,
          projectId: input.projectId ?? null,
          name,
          currency: input.currency,
          startingBalance,
          openedAt: input.openedAt,
          orderIndex: (next?.m ?? -1) + 1,
          createdAt: now().toISOString(),
        })
        .returning()
        .get();
    },

    list(companyId) {
      return db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id)).all();
    },

    countActive(companyId, projectId) {
      const conds = [eq(accounts.companyId, companyId), isNull(accounts.archivedAt)];
      if (projectId !== undefined) conds.push(eq(accounts.projectId, projectId));
      return db.select({ n: count() }).from(accounts).where(and(...conds)).get()?.n ?? 0;
    },
  };
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/categories.test.ts tests/server/accounts.test.ts && npm run typecheck`
Expected: PASS (8 тестов).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/categories src/server/modules/accounts tests/server/categories.test.ts tests/server/accounts.test.ts
git commit -m "feat: сервисы статей (системные, слияние шаблона, дерево) и счетов"
```

---

### Task 4: Компании: сервис и API

**Files:**
- Create: `src/shared/schemas/companies.ts`, `src/server/http/params.ts`, `src/server/modules/companies/service.ts`, `src/server/modules/companies/routes.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/companies.test.ts`

**Interfaces:**
- Consumes: `CategoriesService`, `AccountsService` (задача 3); `AuditService`, `AppError` (план 1); `isKnownCurrency` (задача 1).
- Produces:
  ```ts
  // shared/schemas/companies.ts
  const companyCreateSchema: z.ZodType<{ name: string; baseCurrency: string }>;
  const companyUpdateSchema: z.ZodType<{ name?: string; baseCurrency?: string }>;
  // http/params.ts
  function parseId(value: unknown): number; // невалидный → AppError 404 NOT_FOUND
  // companies/service.ts
  interface CompanyRow { id: number; name: string; baseCurrency: string; createdAt: string; archivedAt: string | null }
  interface CompaniesService {
    list(): CompanyRow[];
    require(id: number, opts?: { writable?: boolean }): CompanyRow; // 404 / 422 ARCHIVED_REFERENCE
    create(input: { name: string; baseCurrency: string }, userId: number): CompanyRow;
    update(id: number, input: { name?: string; baseCurrency?: string }, userId: number): CompanyRow;
    archive(id: number, userId: number): CompanyRow;
    unarchive(id: number, userId: number): CompanyRow;
  }
  function createCompaniesService(d: { db: Db; audit: AuditService; categories: CategoriesService;
    accounts: AccountsService; now?: () => Date }): CompaniesService;
  // companies/routes.ts — GET/POST /api/v1/companies, PATCH /api/v1/companies/:id,
  //   POST /api/v1/companies/:id/archive, POST /api/v1/companies/:id/unarchive
  function registerCompaniesRoutes(app: FastifyInstance, deps: { companies: CompaniesService }): void;
  ```
  В `buildApp` создаются `categories`, `accounts`, `companies` и регистрируются маршруты компаний. Задача 5 добавит проекты, шаблоны, чтение статей и счетов.

- [ ] **Step 1: Написать падающий тест**

`tests/server/companies.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

async function setup() {
  t = await createTestApp();
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload } : {}) });
  return { req };
}

describe('companies API', () => {
  it('создаёт компанию с системными статьями и пишет историю', async () => {
    const { req } = await setup();
    const res = await req('POST', '/api/v1/companies', { name: '  ТОО Ромашка ' });
    expect(res.statusCode).toBe(201);
    const { company } = res.json();
    expect(company).toMatchObject({ name: 'ТОО Ромашка', baseCurrency: 'KZT', archivedAt: null });
    const n = t.sqlite.prepare('SELECT COUNT(*) n FROM categories WHERE company_id = ? AND system_key IS NOT NULL').get(company.id) as { n: number };
    expect(n.n).toBe(9);
    const audit = t.sqlite.prepare("SELECT action, company_id FROM audit_log WHERE entity = 'company'").all();
    expect(audit).toEqual([{ action: 'create', company_id: company.id }]);
    const list = await req('GET', '/api/v1/companies');
    expect(list.json().companies.map((c: { name: string }) => c.name)).toEqual(['ТОО Ромашка']);
  });

  it('валидирует название и валюту', async () => {
    const { req } = await setup();
    const res = await req('POST', '/api/v1/companies', { name: '', baseCurrency: 'XXX' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['baseCurrency', 'name']);
  });

  it('переименовывает и меняет базовую валюту', async () => {
    const { req } = await setup();
    const { company } = (await req('POST', '/api/v1/companies', { name: 'A' })).json();
    const res = await req('PATCH', `/api/v1/companies/${company.id}`, { name: 'Б', baseCurrency: 'USD' });
    expect(res.json().company).toMatchObject({ name: 'Б', baseCurrency: 'USD' });
    expect((await req('PATCH', '/api/v1/companies/999', { name: 'X' })).statusCode).toBe(404);
    expect((await req('PATCH', '/api/v1/companies/abc', { name: 'X' })).statusCode).toBe(404);
    // Number() превратил бы эти строки в существующий id — строгий parseId обязан дать 404
    expect((await req('PATCH', `/api/v1/companies/${company.id}e0`, { name: 'X' })).statusCode).toBe(404);
    expect((await req('PATCH', `/api/v1/companies/${company.id}.0`, { name: 'X' })).statusCode).toBe(404);
    const empty = await req('PATCH', `/api/v1/companies/${company.id}`, {});
    expect(empty.statusCode).toBe(200);
    expect(empty.json().company).toMatchObject({ name: 'Б', baseCurrency: 'USD' });
  });

  it('архив: только без активных счетов; архивная компания только для чтения', async () => {
    const { req } = await setup();
    const { company } = (await req('POST', '/api/v1/companies', { name: 'A' })).json();
    t.sqlite
      .prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (?,'К','KZT',0,'2026-10-06',0,'x')")
      .run(company.id);
    const blocked = await req('POST', `/api/v1/companies/${company.id}/archive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');

    t.sqlite.prepare("UPDATE accounts SET archived_at = 'x' WHERE company_id = ?").run(company.id);
    const ok = await req('POST', `/api/v1/companies/${company.id}/archive`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().company.archivedAt).not.toBeNull();

    const rename = await req('PATCH', `/api/v1/companies/${company.id}`, { name: 'B' });
    expect(rename.statusCode).toBe(422);
    expect(rename.json().error.code).toBe('ARCHIVED_REFERENCE');

    const back = await req('POST', `/api/v1/companies/${company.id}/unarchive`);
    expect(back.json().company.archivedAt).toBeNull();
    const actions = t.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'company' ORDER BY id").all() as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['create', 'archive', 'unarchive']);
  });

  it('без входа — 401', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/companies' })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/companies.test.ts`
Expected: FAIL — 404 на `/api/v1/companies`.

- [ ] **Step 3: Схемы и разбор id**

`src/shared/schemas/companies.ts`:

```ts
import { z } from 'zod';
import { isKnownCurrency } from '../currencies';

const name = z.string().trim().min(1, 'Введите название').max(100, 'Не длиннее 100 символов');
const baseCurrency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');

export const companyCreateSchema = z.object({ name, baseCurrency: baseCurrency.default('KZT') });
export const companyUpdateSchema = z.object({ name: name.optional(), baseCurrency: baseCurrency.optional() });
```

`src/server/http/params.ts`:

```ts
import { AppError } from '../errors';

export function parseId(value: unknown): number {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(404, 'NOT_FOUND', 'Не найдено');
  return n;
}
```

- [ ] **Step 4: Сервис компаний**

`src/server/modules/companies/service.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { companies } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';

export interface CompanyRow {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface CompaniesService {
  list(): CompanyRow[];
  require(id: number, opts?: { writable?: boolean }): CompanyRow;
  create(input: { name: string; baseCurrency: string }, userId: number): CompanyRow;
  update(id: number, input: { name?: string; baseCurrency?: string }, userId: number): CompanyRow;
  archive(id: number, userId: number): CompanyRow;
  unarchive(id: number, userId: number): CompanyRow;
}

export function createCompaniesService(d: {
  db: Db;
  audit: AuditService;
  categories: CategoriesService;
  accounts: AccountsService;
  now?: () => Date;
}): CompaniesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  const svc: CompaniesService = {
    list() {
      return db.select().from(companies).orderBy(asc(companies.id)).all();
    },

    require(id, opts = {}) {
      const row = db.select().from(companies).where(eq(companies.id, id)).get();
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Компания не найдена');
      if (opts.writable && row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Компания в архиве — изменения недоступны');
      return row;
    },

    create(input, userId) {
      return db.transaction((tx) => {
        const row = tx
          .insert(companies)
          .values({ name: input.name, baseCurrency: input.baseCurrency, createdAt: now().toISOString() })
          .returning()
          .get();
        d.categories.seedSystem(tx, row.id);
        audit.record({ companyId: row.id, userId, entity: 'company', entityId: row.id, action: 'create', diff: { ...input } });
        return row;
      });
    },

    update(id, input, userId) {
      const before = svc.require(id, { writable: true });
      if (input.name === undefined && input.baseCurrency === undefined) return before; // пустой PATCH — ничего не меняем
      const row = db
        .update(companies)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}) })
        .where(eq(companies.id, id))
        .returning()
        .get();
      audit.record({
        companyId: id,
        userId,
        entity: 'company',
        entityId: id,
        action: 'update',
        diff: { before: { name: before.name, baseCurrency: before.baseCurrency }, after: { ...input } },
      });
      return row;
    },

    archive(id, userId) {
      const row = svc.require(id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив все счета компании');
      }
      const out = db.update(companies).set({ archivedAt: now().toISOString() }).where(eq(companies.id, id)).returning().get();
      audit.record({ companyId: id, userId, entity: 'company', entityId: id, action: 'archive' });
      return out;
    },

    unarchive(id, userId) {
      const row = svc.require(id);
      if (!row.archivedAt) return row;
      const out = db.update(companies).set({ archivedAt: null }).where(eq(companies.id, id)).returning().get();
      audit.record({ companyId: id, userId, entity: 'company', entityId: id, action: 'unarchive' });
      return out;
    },
  };
  return svc;
}
```

- [ ] **Step 5: Маршруты компаний и подключение в `buildApp`**

`src/server/modules/companies/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { companyCreateSchema, companyUpdateSchema } from '../../../shared/schemas/companies';
import { parseId } from '../../http/params';
import type { CompaniesService } from './service';

export function registerCompaniesRoutes(app: FastifyInstance, deps: { companies: CompaniesService }): void {
  const { companies } = deps;

  app.get('/api/v1/companies', async () => ({ companies: companies.list() }));

  app.post('/api/v1/companies', async (req, reply) => {
    const body = companyCreateSchema.parse(req.body);
    return reply.status(201).send({ company: companies.create(body, req.user!.id) });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/companies/:id', async (req) => {
    const id = parseId(req.params.id);
    companies.require(id);
    const body = companyUpdateSchema.parse(req.body);
    return { company: companies.update(id, body, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/archive', async (req) => ({
    company: companies.archive(parseId(req.params.id), req.user!.id),
  }));

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/unarchive', async (req) => ({
    company: companies.unarchive(parseId(req.params.id), req.user!.id),
  }));
}
```

`PATCH` сначала проверяет существование (`companies.require(id)` → 404), потом тело (400). Так запрос к несуществующей компании с кривым телом даёт 404, а не 400.

В `src/server/app.ts` добавить импорты:

```ts
import { createAccountsService } from './modules/accounts/service';
import { createCategoriesService } from './modules/categories/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
```

и после `registerAuthRoutes(...)` вставить:

```ts
  const categories = createCategoriesService(db, now);
  const accounts = createAccountsService(db, now);
  const companies = createCompaniesService({ db, audit, categories, accounts, now });
  registerCompaniesRoutes(app, { companies });
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/companies.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/schemas/companies.ts src/server/http src/server/modules/companies src/server/app.ts tests/server/companies.test.ts
git commit -m "feat: компании — создание с системными статьями, правка, архив, API"
```

---

### Task 5: Проекты по шаблонам, применение шаблона и чтение статей и счетов

**Files:**
- Create: `src/shared/schemas/projects.ts`, `src/server/modules/projects/service.ts`, `src/server/modules/projects/routes.ts`, `src/server/modules/templates/routes.ts`, `src/server/modules/categories/routes.ts`, `src/server/modules/accounts/routes.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/projects.test.ts`

**Interfaces:**
- Consumes: `CompaniesService` (задача 4); `CategoriesService`, `AccountsService` (задача 3); `getTemplate`, `TEMPLATES` (задача 1); `todayInTimezone` (задача 1); `parseId` (задача 4); `Config.timezone` (план 1).
- Produces:
  ```ts
  // shared/schemas/projects.ts
  const projectCreateSchema: z.ZodType<{ name: string; templateKey: string; templateParams: Record<string, unknown> }>;
  const projectUpdateSchema: z.ZodType<{ name?: string; templateParams?: Record<string, unknown> }>;
  // projects/service.ts
  interface ProjectRow { id: number; companyId: number; name: string; templateKey: string;
    templateParams: Record<string, unknown>; orderIndex: number; createdAt: string; archivedAt: string | null }
  interface ProjectsService {
    list(companyId: number): ProjectRow[];
    create(companyId: number, input: { name: string; templateKey: string; templateParams: Record<string, unknown> }, userId: number):
      { project: ProjectRow; applied: { categories: number; accounts: number } };
    update(companyId: number, id: number, input: { name?: string; templateParams?: Record<string, unknown> }, userId: number): ProjectRow;
    archive(companyId: number, id: number, userId: number): ProjectRow;
    unarchive(companyId: number, id: number, userId: number): ProjectRow;
  }
  function createProjectsService(d: { db: Db; audit: AuditService; companies: CompaniesService; categories: CategoriesService;
    accounts: AccountsService; timezone: string; now?: () => Date }): ProjectsService;
  // маршруты:
  //   GET  /api/v1/templates → { templates: { key, name, integrations, paramsUi }[] }
  //   GET  /api/v1/companies/:cid/projects → { projects }
  //   POST /api/v1/companies/:cid/projects → 201 { project, applied }
  //   PATCH /api/v1/companies/:cid/projects/:id → { project }
  //   POST /api/v1/companies/:cid/projects/:id/archive | /unarchive → { project }
  //   GET  /api/v1/companies/:cid/categories → { income: CategoryNodeDto[], expense: CategoryNodeDto[] }
  //   GET  /api/v1/companies/:cid/accounts → { accounts: AccountRow[] }
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/server/projects.test.ts`:

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

type Req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => Promise<LightMyRequestResponse>;

async function setup(now?: string) {
  t = await createTestApp({}, undefined, now ? () => new Date(now) : undefined);
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req: Req = (method, url, payload) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload } : {}) });
  const company = (await req('POST', '/api/v1/companies', { name: 'ТОО' })).json().company as { id: number };
  return { req, cid: company.id };
}

const club = (name: string, pcCount: unknown = 30) => ({ name, templateKey: 'computer-club', templateParams: { pcCount } });

describe('projects API', () => {
  it('GET /templates отдаёт шаблоны без схем', async () => {
    const { req } = await setup();
    const res = await req('GET', '/api/v1/templates');
    expect(res.json().templates.map((x: { key: string }) => x.key)).toEqual(['computer-club', 'general']);
    expect(res.json().templates[0].paramsUi[0]).toEqual({ key: 'pcCount', label: 'Количество ПК', type: 'int' });
  });

  it('создание клуба применяет шаблон: статьи, счета KZT с projectId, история', async () => {
    const { req, cid } = await setup();
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб на Ленина'));
    expect(res.statusCode).toBe(201);
    const { project, applied } = res.json();
    expect(project).toMatchObject({ name: 'Клуб на Ленина', templateKey: 'computer-club', templateParams: { pcCount: 30, consoleCount: 0 } });
    expect(applied.categories).toBeGreaterThan(20);
    expect(applied.accounts).toBe(2);

    const tree = (await req('GET', `/api/v1/companies/${cid}/categories`)).json();
    const salary = tree.expense.find((c: { systemKey: string }) => c.systemKey === 'salary');
    expect(salary.children.map((c: { name: string; effectiveSystemKey: string }) => [c.name, c.effectiveSystemKey])).toEqual([
      ['Администраторы', 'salary'],
      ['Премии', 'salary'],
    ]);
    const accounts = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts;
    expect(accounts.map((a: { name: string; currency: string; projectId: number }) => [a.name, a.currency, a.projectId])).toEqual([
      ['Касса Клуб на Ленина', 'KZT', project.id],
      ['Kaspi Клуб на Ленина', 'KZT', project.id],
    ]);
    const audit = t.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'project'").all();
    expect(audit).toEqual([{ action: 'create' }]);
  });

  it('второй клуб не дублирует статьи, но получает свои счета (Review Focus 1)', async () => {
    const { req, cid } = await setup();
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб 1'));
    const count = () => (t.sqlite.prepare('SELECT COUNT(*) n FROM categories WHERE company_id = ?').get(cid) as { n: number }).n;
    const before = count();
    const second = (await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб 2'))).json();
    expect(second.applied).toEqual({ categories: 0, accounts: 2 });
    expect(count()).toBe(before);
    const names = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts.map((a: { name: string }) => a.name);
    expect(names).toEqual(['Касса Клуб 1', 'Kaspi Клуб 1', 'Касса Клуб 2', 'Kaspi Клуб 2']);
  });

  it('длинное название проекта (100 символов) и «$» в названии не ломают имена счетов', async () => {
    const { req, cid } = await setup();
    const long = 'К'.repeat(100);
    expect((await req('POST', `/api/v1/companies/${cid}/projects`, club(long))).statusCode).toBe(201);
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб $& $$'));
    const names = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts.map((a: { name: string }) => a.name);
    expect(names).toContain(`Kaspi ${long}`);
    expect(names).toContain('Касса Клуб $& $$');
  });

  it('проект «Общий» без статей и счетов', async () => {
    const { req, cid } = await setup();
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' });
    expect(res.statusCode).toBe(201);
    expect(res.json().applied).toEqual({ categories: 0, accounts: 0 });
    expect(res.json().project.templateParams).toEqual({});
  });

  it('кривые параметры шаблона дают 400 с полями templateParams.* (Review Focus 4)', async () => {
    const { req, cid } = await setup();
    for (const bad of [{ pcCount: '30' }, { pcCount: 0 }, {}, { pcCount: 2.5 }]) {
      const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'computer-club', templateParams: bad });
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.fields)).toEqual(['templateParams.pcCount']);
    }
    const unknown = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'nope' });
    expect(unknown.json().error.fields).toEqual({ templateKey: 'Неизвестный тип бизнеса' });
    const extra = await req('POST', `/api/v1/companies/${cid}/projects`, {
      name: 'X',
      templateKey: 'computer-club',
      templateParams: { pcCount: 5, hack: true },
    });
    expect(extra.json().project.templateParams).toEqual({ pcCount: 5, consoleCount: 0 });
    expect(t.sqlite.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({ n: 1 });
  });

  it('openedAt счетов — дата в APP_TIMEZONE (Review Focus 5)', async () => {
    const { req, cid } = await setup('2026-10-05T19:30:00.000Z');
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Ночной'));
    const accounts = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts;
    expect(accounts.map((a: { openedAt: string }) => a.openedAt)).toEqual(['2026-10-06', '2026-10-06']);
  });

  it('правка имени и параметров; templateKey не меняется', async () => {
    const { req, cid } = await setup();
    const { project } = (await req('POST', `/api/v1/companies/${cid}/projects`, club('A'))).json();
    const res = await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, {
      name: 'Б',
      templateParams: { pcCount: 40, consoleCount: 2 },
      templateKey: 'general',
    });
    expect(res.json().project).toMatchObject({ name: 'Б', templateKey: 'computer-club', templateParams: { pcCount: 40, consoleCount: 2 } });
    const bad = await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { templateParams: { pcCount: -1 } });
    expect(bad.statusCode).toBe(400);
  });

  it('архив проекта только без активных счетов; архивный проект не правится', async () => {
    const { req, cid } = await setup();
    const { project } = (await req('POST', `/api/v1/companies/${cid}/projects`, club('A'))).json();
    const blocked = await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');
    t.sqlite.prepare("UPDATE accounts SET archived_at = 'x' WHERE project_id = ?").run(project.id);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`)).json().project.archivedAt).not.toBeNull();
    expect((await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { name: 'Z' })).statusCode).toBe(422);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/unarchive`)).json().project.archivedAt).toBeNull();
  });

  it('чужие id → 404 и ничего не меняется (Review Focus 3)', async () => {
    const { req, cid } = await setup();
    const other = (await req('POST', '/api/v1/companies', { name: 'Чужая' })).json().company.id as number;
    const { project } = (await req('POST', `/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).json();
    expect((await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { name: 'Взлом' })).statusCode).toBe(404);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`)).statusCode).toBe(404);
    expect((await req('GET', '/api/v1/companies/999/projects')).statusCode).toBe(404);
    expect((await req('GET', '/api/v1/companies/999/categories')).statusCode).toBe(404);
    expect((t.sqlite.prepare('SELECT name FROM projects WHERE id = ?').get(project.id) as { name: string }).name).toBe('Чужой');
  });

  it('в архивной компании проект не создаётся', async () => {
    const { req, cid } = await setup();
    await req('POST', `/api/v1/companies/${cid}/archive`);
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'general' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ARCHIVED_REFERENCE');
  });
});
```

Тест передаёт часы в `createTestApp` третьим аргументом. Поэтому в `tests/helpers/test-app.ts` расширить сигнатуру:

```ts
export async function createTestApp(
  overrides: Record<string, string> = {},
  extraRoutes?: (app: FastifyInstance) => void,
  now?: () => Date,
): Promise<TestApp> {
  const t = createTestDb();
  const config = testConfig(t.dir, overrides);
  const app = await buildApp({ config, db: t.db, sqlite: t.sqlite, logger: false, extraRoutes, now });
  // ... остальное без изменений
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/projects.test.ts`
Expected: FAIL — 404 на `/api/v1/templates`.

- [ ] **Step 3: Схемы проектов**

`src/shared/schemas/projects.ts`:

```ts
import { z } from 'zod';

const name = z.string().trim().min(1, 'Введите название').max(100, 'Не длиннее 100 символов');
const params = z.record(z.string(), z.unknown());

export const projectCreateSchema = z.object({
  name,
  templateKey: z.string().min(1, 'Выберите тип бизнеса'),
  templateParams: params.default({}),
});

export const projectUpdateSchema = z.object({ name: name.optional(), templateParams: params.optional() });
```

- [ ] **Step 4: Сервис проектов**

`src/server/modules/projects/service.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import type { Db } from '../../db/client';
import { projects } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CompaniesService } from '../companies/service';

export interface ProjectRow {
  id: number;
  companyId: number;
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectsService {
  list(companyId: number): ProjectRow[];
  create(
    companyId: number,
    input: { name: string; templateKey: string; templateParams: Record<string, unknown> },
    userId: number,
  ): { project: ProjectRow; applied: { categories: number; accounts: number } };
  update(companyId: number, id: number, input: { name?: string; templateParams?: Record<string, unknown> }, userId: number): ProjectRow;
  archive(companyId: number, id: number, userId: number): ProjectRow;
  unarchive(companyId: number, id: number, userId: number): ProjectRow;
}

function toRow(r: typeof projects.$inferSelect): ProjectRow {
  return { ...r, templateParams: JSON.parse(r.templateParams) as Record<string, unknown> };
}

function validateParams(template: BusinessTemplate, raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = template.params.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = `templateParams.${issue.path.join('.') || '_'}`;
    fields[key] ??= issue.message;
  }
  throw new AppError(400, 'VALIDATION', 'Проверьте параметры проекта', fields);
}

export function createProjectsService(d: {
  db: Db;
  audit: AuditService;
  companies: CompaniesService;
  categories: CategoriesService;
  accounts: AccountsService;
  timezone: string;
  now?: () => Date;
}): ProjectsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireProject(companyId: number, id: number): ProjectRow {
    const row = db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Проект не найден');
    return toRow(row);
  }

  const svc: ProjectsService = {
    list(companyId) {
      d.companies.require(companyId);
      return db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(asc(projects.orderIndex), asc(projects.id)).all().map(toRow);
    },

    create(companyId, input, userId) {
      const company = d.companies.require(companyId, { writable: true });
      const template = getTemplate(input.templateKey);
      if (!template) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { templateKey: 'Неизвестный тип бизнеса' });
      const params = validateParams(template, input.templateParams);

      return db.transaction((tx) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
          .from(projects)
          .where(eq(projects.companyId, companyId))
          .get();
        const row = tx
          .insert(projects)
          .values({
            companyId,
            name: input.name,
            templateKey: template.key,
            templateParams: JSON.stringify(params),
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get();
        const createdCategories = d.categories.mergeTemplate(tx, companyId, template);
        const openedAt = todayInTimezone(d.timezone, now());
        for (const acc of template.defaultAccounts) {
          d.accounts.create(tx, {
            companyId,
            projectId: row.id,
            name: acc.name.replaceAll('{project}', () => input.name),
            currency: acc.currency ?? company.baseCurrency,
            openedAt,
          });
        }
        const applied = { categories: createdCategories, accounts: template.defaultAccounts.length };
        audit.record({
          companyId,
          userId,
          entity: 'project',
          entityId: row.id,
          action: 'create',
          diff: { name: input.name, templateKey: template.key, templateParams: params, applied },
        });
        return { project: toRow(row), applied };
      });
    },

    update(companyId, id, input, userId) {
      d.companies.require(companyId, { writable: true });
      const before = requireProject(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — изменения недоступны');
      const template = getTemplate(before.templateKey);
      if (!template) throw new Error(`Шаблон ${before.templateKey} не найден`);
      const set: Partial<typeof projects.$inferInsert> = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.templateParams !== undefined) set.templateParams = JSON.stringify(validateParams(template, input.templateParams));
      if (Object.keys(set).length === 0) return before;
      const row = toRow(db.update(projects).set(set).where(eq(projects.id, id)).returning().get());
      audit.record({
        companyId,
        userId,
        entity: 'project',
        entityId: id,
        action: 'update',
        diff: { before: { name: before.name, templateParams: before.templateParams }, after: { name: row.name, templateParams: row.templateParams } },
      });
      return row;
    },

    archive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(companyId, id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив счета проекта');
      }
      const out = toRow(db.update(projects).set({ archivedAt: now().toISOString() }).where(eq(projects.id, id)).returning().get());
      audit.record({ companyId, userId, entity: 'project', entityId: id, action: 'archive' });
      return out;
    },

    unarchive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (!row.archivedAt) return row;
      const out = toRow(db.update(projects).set({ archivedAt: null }).where(eq(projects.id, id)).returning().get());
      audit.record({ companyId, userId, entity: 'project', entityId: id, action: 'unarchive' });
      return out;
    },
  };
  return svc;
}
```

- [ ] **Step 5: Маршруты проектов, шаблонов, статей, счетов**

`src/server/modules/projects/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { projectCreateSchema, projectUpdateSchema } from '../../../shared/schemas/projects';
import { parseId } from '../../http/params';
import type { ProjectsService } from './service';

type P = { Params: { cid: string; id: string } };

export function registerProjectsRoutes(app: FastifyInstance, deps: { projects: ProjectsService }): void {
  const { projects } = deps;

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/projects', async (req) => ({
    projects: projects.list(parseId(req.params.cid)),
  }));

  app.post<{ Params: { cid: string } }>('/api/v1/companies/:cid/projects', async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = projectCreateSchema.parse(req.body);
    return reply.status(201).send(projects.create(cid, body, req.user!.id));
  });

  app.patch<P>('/api/v1/companies/:cid/projects/:id', async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = projectUpdateSchema.parse(req.body);
    return { project: projects.update(cid, id, body, req.user!.id) };
  });

  app.post<P>('/api/v1/companies/:cid/projects/:id/archive', async (req) => ({
    project: projects.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>('/api/v1/companies/:cid/projects/:id/unarchive', async (req) => ({
    project: projects.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
```

`src/server/modules/templates/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { TEMPLATES } from '../../../templates';

export function registerTemplatesRoutes(app: FastifyInstance): void {
  app.get('/api/v1/templates', async () => ({
    templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, integrations: t.integrations, paramsUi: t.paramsUi })),
  }));
}
```

`src/server/modules/categories/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { CategoriesService } from './service';

export function registerCategoriesRoutes(app: FastifyInstance, deps: { categories: CategoriesService; companies: CompaniesService }): void {
  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/categories', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return deps.categories.listTree(cid);
  });
}
```

`src/server/modules/accounts/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { AccountsService } from './service';

export function registerAccountsRoutes(app: FastifyInstance, deps: { accounts: AccountsService; companies: CompaniesService }): void {
  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/accounts', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return { accounts: deps.accounts.list(cid) };
  });
}
```

В `src/server/app.ts` добавить импорты:

```ts
import { registerAccountsRoutes } from './modules/accounts/routes';
import { registerCategoriesRoutes } from './modules/categories/routes';
import { registerProjectsRoutes } from './modules/projects/routes';
import { createProjectsService } from './modules/projects/service';
import { registerTemplatesRoutes } from './modules/templates/routes';
```

и сразу после `registerCompaniesRoutes(app, { companies });` вставить:

```ts
  const projects = createProjectsService({ db, audit, companies, categories, accounts, timezone: config.timezone, now });
  registerTemplatesRoutes(app);
  registerProjectsRoutes(app, { projects });
  registerCategoriesRoutes(app, { categories, companies });
  registerAccountsRoutes(app, { accounts, companies });
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/projects.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/schemas/projects.ts src/server/modules src/server/app.ts tests/helpers/test-app.ts tests/server/projects.test.ts
git commit -m "feat: проекты по шаблонам — применение шаблона, правка, архив, чтение статей и счетов"
```

---

### Task 6: Клиент: каркас компании, переключатель, первая компания

**Files:**
- Create: `src/client/lib/queries.ts`, `src/client/components/ui.ts`, `src/client/components/AppHeader.tsx`, `src/client/components/CompanySwitcher.tsx`, `src/client/components/CompanyForm.tsx`, `src/client/pages/RequireAuth.tsx`, `src/client/pages/CompanyGate.tsx`, `src/client/pages/NewCompanyPage.tsx`, `src/client/pages/CompanyLayout.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/companies.spec.ts`
- Modify: `src/client/router.tsx`, `e2e/auth.spec.ts`, `playwright.config.ts`
- Delete: `src/client/pages/AppShell.tsx`

**Interfaces:**
- Consumes: API компаний (задача 4), `api()`, `ApiError`, `queryClient`, `useMe`, `useMeta` (план 1), `CURRENCIES` (план 1).
- Produces:
  ```ts
  // lib/queries.ts
  interface Company { id: number; name: string; baseCurrency: string; createdAt: string; archivedAt: string | null }
  interface Project { id: number; companyId: number; name: string; templateKey: string;
    templateParams: Record<string, unknown>; orderIndex: number; createdAt: string; archivedAt: string | null }
  interface TemplateInfo { key: string; name: string; integrations: string[]; paramsUi: { key: string; label: string; type: 'int' | 'text'; hint?: string }[] }
  function useCompanies(): UseQueryResult<Company[], ApiError>;
  function useProjects(companyId: number): UseQueryResult<Project[], ApiError>;
  function useTemplates(): UseQueryResult<TemplateInfo[], ApiError>;
  // components/ui.ts
  const inputClass: string; const btnPrimary: string; const btnSecondary: string; const btnDanger: string;
  // components/CompanyForm.tsx
  function CompanyForm(props: { onCreated: (c: Company) => void }): JSX.Element;
  ```
  Подписи для e2e:
  - поля «Название компании», «Базовая валюта»; кнопка «Создать компанию»;
  - кнопка переключателя с `aria-label` «Сменить компанию»; пункт «Добавить компанию»;
  - вкладки «Журнал» и «Настройки»; заголовок «Журнал»;
  - заголовок `/companies/new`: «Создайте первую компанию», если активных компаний нет, иначе «Новая компания».

- [ ] **Step 1: Написать e2e-тест (падающий)**

В `playwright.config.ts` в объект `defineConfig({...})` добавить `workers: 1,`: e2e-тесты делят один сервер и одну БД.

`e2e/auth.spec.ts` — после этого плана экран после входа зависит от наличия компаний. Заменить строку
`await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();` (обе, до и после `reload`) на
`await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();`.
Остальные проверки (alert, «Админ», заголовок «Учёт», выход) не меняются.

`e2e/companies.spec.ts`:

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
  await page.getByLabel('Базовая валюта').selectOption('KZT');
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

test('компании: создание, переключение', async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const first = `ТОО Ромашка ${suffix}`;
  const second = `ИП Лютик ${suffix}`;

  const firstId = await createCompany(page, first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(first);

  const secondId = await createCompany(page, second);
  expect(secondId).not.toBe(firstId);
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(second);

  await page.getByRole('button', { name: 'Сменить компанию' }).click();
  await page.getByRole('menuitem', { name: first }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/log$`));
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(first);

  await page.goto('/c/999999/log');
  await expect(page).not.toHaveURL(/\/c\/999999\//); // неизвестная компания → редирект…
  await expect(page).toHaveURL(/\/c\/\d+\/log$/); // …на первую активную
});
```

Run: `npm run test:e2e -- e2e/companies.spec.ts`
Expected: FAIL — нет поля «Название компании».

- [ ] **Step 2: Общие классы и запросы**

`src/client/components/ui.ts`:

```ts
export const inputClass = 'w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
export const btnPrimary = 'rounded-xl bg-income px-4 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-50';
export const btnSecondary = 'rounded-xl bg-field px-4 py-2.5 font-medium text-ink hover:brightness-95 disabled:opacity-50';
export const btnDanger = 'rounded-xl bg-expense-soft px-4 py-2.5 font-medium text-expense hover:brightness-95 disabled:opacity-50';
```

`src/client/lib/queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api, type ApiError } from './api';

export interface Company {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface Project {
  id: number;
  companyId: number;
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface TemplateInfo {
  key: string;
  name: string;
  integrations: string[];
  paramsUi: { key: string; label: string; type: 'int' | 'text'; hint?: string }[];
}

export function useCompanies() {
  return useQuery<Company[], ApiError>({
    queryKey: ['companies'],
    queryFn: async () => (await api<{ companies: Company[] }>('/companies')).companies,
  });
}

export function useProjects(companyId: number) {
  return useQuery<Project[], ApiError>({
    queryKey: ['projects', companyId],
    queryFn: async () => (await api<{ projects: Project[] }>(`/companies/${companyId}/projects`)).projects,
  });
}

export function useTemplates() {
  return useQuery<TemplateInfo[], ApiError>({
    queryKey: ['templates'],
    queryFn: async () => (await api<{ templates: TemplateInfo[] }>('/templates')).templates,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 3: Шапка, проверка входа, переключатель, форма компании**

`src/client/pages/RequireAuth.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router';
import { useMe } from '../lib/query';

export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (me.error?.status === 401) return <Navigate to="/login" replace />;
  if (me.error) return <div className="p-8 text-expense">{me.error.message}</div>;
  return <Outlet />;
}
```

`src/client/components/AppHeader.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { queryClient, useMe, useMeta } from '../lib/query';

export function AppHeader({ left }: { left?: ReactNode }) {
  const me = useMe();
  const meta = useMeta();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-4 text-white">
      <div className="flex min-w-0 items-center gap-4">
        <span className="shrink-0 text-lg font-bold">{meta.data?.appName}</span>
        {left}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="text-sm text-white/70">{me.data?.user.name}</span>
        <button onClick={() => logout.mutate()} className="rounded-xl bg-chrome-2 px-4 py-2 text-sm hover:bg-white/10">
          Выйти
        </button>
      </div>
    </header>
  );
}
```

`src/client/components/CompanySwitcher.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Company } from '../lib/queries';

export function CompanySwitcher({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const active = companies.filter((c) => !c.archivedAt);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-label="Сменить компанию"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-xs items-center gap-2 truncate rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
      >
        <span className="truncate">{current.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-2 w-72 rounded-2xl bg-card p-2 text-ink shadow-xl">
          {active.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`/c/${c.id}/log`);
              }}
              className={`block w-full truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-field ${c.id === current.id ? 'font-semibold' : ''}`}
            >
              {c.name}
            </button>
          ))}
          <div className="my-1 border-t border-field" />
          <Link role="menuitem" to="/companies/new" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm hover:bg-field">
            + Добавить компанию
          </Link>
          <Link
            role="menuitem"
            to={`/c/${current.id}/settings/companies`}
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-muted hover:bg-field"
          >
            Все компании
          </Link>
        </div>
      )}
    </div>
  );
}
```

Пункт «+ Добавить компанию» находится по `getByRole('menuitem', { name: '+ Добавить компанию' })`. В e2e пункт выбирается по имени компании, имена не пересекаются.

`src/client/components/CompanyForm.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CURRENCIES } from '../../shared/currencies';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { btnPrimary, inputClass } from './ui';

export function CompanyForm({ onCreated }: { onCreated: (c: Company) => void }) {
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('KZT');
  const create = useMutation<{ company: Company }, ApiError>({
    mutationFn: () => api('/companies', { method: 'POST', body: { name, baseCurrency } }),
    onSuccess: async ({ company }) => {
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      onCreated(company);
    },
  });
  const fields = create.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Название компании</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ТОО «Ромашка»" className={inputClass} />
        {fields.name && <span className="mt-1 block text-sm text-expense">{fields.name}</span>}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Базовая валюта</span>
        <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        {fields.baseCurrency && <span className="mt-1 block text-sm text-expense">{fields.baseCurrency}</span>}
      </label>
      {create.error && !create.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {create.error.message}
        </p>
      )}
      <button type="submit" disabled={create.isPending || !name.trim()} className={btnPrimary}>
        {create.isPending ? 'Создаём…' : 'Создать компанию'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Страницы и маршрутизация**

`src/client/pages/CompanyGate.tsx`:

```tsx
import { Navigate } from 'react-router';
import { useCompanies } from '../lib/queries';

export function CompanyGate() {
  const companies = useCompanies();
  if (companies.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (companies.error) return <div className="p-8 text-expense">{companies.error.message}</div>;
  const first = companies.data.find((c) => !c.archivedAt);
  return <Navigate to={first ? `/c/${first.id}/log` : '/companies/new'} replace />;
}
```

`src/client/pages/NewCompanyPage.tsx`:

```tsx
import { Link, useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanyForm } from '../components/CompanyForm';
import { useCompanies } from '../lib/queries';

export function NewCompanyPage() {
  const navigate = useNavigate();
  const companies = useCompanies();
  const all = companies.data ?? [];
  const hasActive = all.some((c) => !c.archivedAt);
  const archived = all.find((c) => c.archivedAt);
  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader />
      <main className="mx-auto mt-8 max-w-md rounded-3xl bg-card p-8">
        <h1 className="mb-6 text-2xl font-bold">{hasActive ? 'Новая компания' : 'Создайте первую компанию'}</h1>
        {!hasActive && archived && (
          <p className="mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted">
            Все компании в архиве.{' '}
            <Link to={`/c/${archived.id}/settings/companies`} className="font-semibold text-ink underline">
              Открыть список компаний
            </Link>
            , чтобы вернуть нужную из архива.
          </p>
        )}
        <CompanyForm onCreated={(c) => navigate(`/c/${c.id}/log`, { replace: true })} />
      </main>
    </div>
  );
}
```

`src/client/pages/CompanyLayout.tsx`:

```tsx
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { useCompanies, type Company } from '../lib/queries';

export interface CompanyOutletContext {
  company: Company;
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-5 py-2 text-lg font-semibold ${isActive ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`;

export function CompanyLayout() {
  const { companyId } = useParams();
  const companies = useCompanies();
  if (companies.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (companies.error) return <div className="p-8 text-expense">{companies.error.message}</div>;
  const company = companies.data.find((c) => String(c.id) === companyId);
  if (!company) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader left={<CompanySwitcher current={company} companies={companies.data} />} />
      <main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-6 md:p-8">
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
  );
}
```

Если пользователь открыл `/c/<id>/...` архивной компании, `CompanyLayout` её найдёт: страница настроек должна открываться и для архивной компании. Переключатель показывает только активные компании.

`src/client/pages/JournalPage.tsx`:

```tsx
export function JournalPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Журнал</h1>
      <p className="mt-2 text-muted">Журнал операций появится на следующих шагах.</p>
    </section>
  );
}
```

`src/client/router.tsx` (полностью):

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { CompanyGate } from './pages/CompanyGate';
import { CompanyLayout } from './pages/CompanyLayout';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NewCompanyPage } from './pages/NewCompanyPage';
import { RequireAuth } from './pages/RequireAuth';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <CompanyGate /> },
      { path: 'companies/new', element: <NewCompanyPage /> },
      {
        path: 'c/:companyId',
        element: <CompanyLayout />,
        children: [
          { index: true, element: <Navigate to="log" replace /> },
          { path: 'log', element: <JournalPage /> },
          { path: 'settings', element: <Navigate to="projects" replace /> },
          { path: 'settings/projects', element: <ProjectsSettings /> },
          { path: 'settings/companies', element: <CompaniesSettings /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
```

Страницы настроек появятся в задаче 7. Чтобы задача 6 собиралась, создать временные заготовки:

`src/client/pages/settings/ProjectsSettings.tsx`:

```tsx
export function ProjectsSettings() {
  return <h1 className="text-2xl font-bold">Проекты</h1>;
}
```

`src/client/pages/settings/CompaniesSettings.tsx`:

```tsx
export function CompaniesSettings() {
  return <h1 className="text-2xl font-bold">Компании</h1>;
}
```

Удалить `src/client/pages/AppShell.tsx` (`git rm src/client/pages/AppShell.tsx`).

- [ ] **Step 5: Убедиться, что всё проходит**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: PASS — оба файла e2e (`auth.spec.ts` с заменёнными ожиданиями, `companies.spec.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/client e2e playwright.config.ts
git commit -m "feat: интерфейс компаний — первая компания, переключатель, вкладки"
```

---

### Task 7: Клиент: настройки «Проекты» и «Компании»

**Files:**
- Create: `src/client/components/ProjectForm.tsx`, `src/client/pages/settings/SettingsNav.tsx`
- Modify: `src/client/pages/settings/ProjectsSettings.tsx`, `src/client/pages/settings/CompaniesSettings.tsx`, `e2e/companies.spec.ts`

**Interfaces:**
- Consumes: `useProjects`, `useTemplates`, `useCompanies`, `Project`, `TemplateInfo`, `Company` (задача 6); `CompanyOutletContext` (задача 6); `getTemplate` (задача 1, общий модуль); API проектов (задача 5), API компаний (задача 4).
- Produces: подписи для e2e:
  - кнопка «Добавить проект»; поля «Название проекта», «Тип бизнеса», а также поля из `paramsUi` («Количество ПК», «Количество консолей»); кнопки «Создать проект», «Сохранить», «В архив», «Вернуть из архива»;
  - вкладки настроек «Проекты» и «Компании»;
  - на странице компаний: поле «Название» в каждой строке и кнопка «Сохранить».

- [ ] **Step 1: Расширить e2e (падающий)**

Добавить в `e2e/companies.spec.ts` второй тест:

```ts
test('проекты по шаблонам: клуб и общий', async ({ page }) => {
  await login(page);
  const companyName = `ТОО Клубы ${Date.now()}`;
  const cid = await createCompany(page, companyName);

  await page.getByRole('link', { name: 'Настройки' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects$`));

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Клуб на Ленина');
  await page.getByLabel('Тип бизнеса').selectOption('computer-club');
  await page.getByLabel('Количество ПК').fill('0');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByText('Не меньше 1')).toBeVisible(); // клиентская проверка той же схемой
  await page.getByLabel('Количество ПК').fill('30');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Клуб на Ленина' });
  await expect(row).toContainText('Компьютерный клуб');
  await expect(row).toContainText('Количество ПК: 30');

  const tree = await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json();
  const salary = tree.expense.find((c: { systemKey: string | null }) => c.systemKey === 'salary');
  expect(salary.children.map((c: { name: string }) => c.name)).toEqual(['Администраторы', 'Премии']);
  const accounts = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(accounts.map((a: { name: string }) => a.name)).toEqual(['Касса Клуб на Ленина', 'Kaspi Клуб на Ленина']);

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Офис');
  await page.getByLabel('Тип бизнеса').selectOption('general');
  await expect(page.getByLabel('Количество ПК')).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Офис' })).toContainText('Общий');
  const after = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(after).toHaveLength(2);

  // переименование компании на экране «Компании»
  await page.getByRole('link', { name: 'Компании' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/companies$`));
  const renamed = `ТОО Клубы переим ${Date.now()}`;
  const companyRow = page.getByRole('listitem').filter({ has: page.locator(`input[value="${companyName}"]`) });
  await companyRow.getByLabel('Название').fill(renamed);
  await companyRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(renamed);
});
```

Run: `npm run test:e2e -- e2e/companies.spec.ts`
Expected: FAIL — нет кнопки «Добавить проект».

- [ ] **Step 2: Навигация настроек и форма проекта**

`src/client/pages/settings/SettingsNav.tsx`:

```tsx
import { NavLink } from 'react-router';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

export function SettingsNav({ companyId }: { companyId: number }) {
  return (
    <nav className="mb-6 flex gap-2" aria-label="Разделы настроек">
      <NavLink to={`/c/${companyId}/settings/projects`} className={link}>
        Проекты
      </NavLink>
      <NavLink to={`/c/${companyId}/settings/companies`} className={link}>
        Компании
      </NavLink>
    </nav>
  );
}
```

`src/client/components/ProjectForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { getTemplate } from '../../templates';
import type { TemplateInfo } from '../lib/queries';
import { btnPrimary, btnSecondary, inputClass } from './ui';

export interface ProjectFormValues {
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
}

function toInputs(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]));
}

export function ProjectForm(props: {
  templates: TemplateInfo[];
  mode: 'create' | 'edit';
  initial?: ProjectFormValues;
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [templateKey, setTemplateKey] = useState(props.initial?.templateKey ?? props.templates[0]?.key ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(toInputs(props.initial?.templateParams ?? {}));
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const info = props.templates.find((t) => t.key === templateKey);
  const fields = { ...props.serverFields, ...clientFields };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const raw: Record<string, unknown> = {};
    for (const p of info?.paramsUi ?? []) {
      const s = (inputs[p.key] ?? '').trim();
      if (s === '') continue;
      raw[p.key] = p.type === 'int' ? Number(s) : s;
    }
    const schema = getTemplate(templateKey)?.params;
    const parsed = schema?.safeParse(raw);
    if (parsed && !parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[`templateParams.${issue.path.join('.')}`] ??= issue.message;
      setClientFields(next);
      return;
    }
    setClientFields({});
    props.onSubmit({ name, templateKey, templateParams: raw });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-canvas p-4">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Название проекта</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />
        {fields.name && <span className="mt-1 block text-sm text-expense">{fields.name}</span>}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Тип бизнеса</span>
        <select
          value={templateKey}
          disabled={props.mode === 'edit'}
          onChange={(e) => {
            setTemplateKey(e.target.value);
            setInputs({});
            setClientFields({});
          }}
          className={inputClass}
        >
          {props.templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        {fields.templateKey && <span className="mt-1 block text-sm text-expense">{fields.templateKey}</span>}
      </label>
      {info?.paramsUi.map((p) => (
        <label key={p.key} className="block">
          <span className="mb-1 block text-sm text-muted">{p.label}</span>
          <input
            inputMode={p.type === 'int' ? 'numeric' : 'text'}
            value={inputs[p.key] ?? ''}
            onChange={(e) => setInputs((v) => ({ ...v, [p.key]: e.target.value }))}
            className={inputClass}
          />
          {p.hint && <span className="mt-1 block text-xs text-muted">{p.hint}</span>}
          {fields[`templateParams.${p.key}`] && (
            <span className="mt-1 block text-sm text-expense">{fields[`templateParams.${p.key}`]}</span>
          )}
        </label>
      ))}
      {props.serverError && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать проект' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Страница «Проекты»**

`src/client/pages/settings/ProjectsSettings.tsx` (полностью):

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { btnDanger, btnPrimary, btnSecondary } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

function paramsSummary(p: Project, t: TemplateInfo | undefined): string {
  return (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
}

export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
    ]);

  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(`/companies/${company.id}/projects`, { method: 'POST', body: v }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; values: ProjectFormValues }>({
    mutationFn: ({ id, values }) =>
      api(`/companies/${company.id}/projects/${id}`, { method: 'PATCH', body: { name: values.name, templateParams: values.templateParams } }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const toggleArchive = useMutation<unknown, ApiError, Project>({
    mutationFn: (p) => api(`/companies/${company.id}/projects/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  if (projects.isPending || templates.isPending) return <div className="text-muted">Загрузка…</div>;
  if (projects.error || templates.error) return <div className="text-expense">{(projects.error ?? templates.error)!.message}</div>;
  const tpl = (key: string) => templates.data.find((t) => t.key === key);

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Проекты</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            Добавить проект
          </button>
        )}
      </div>
      {readOnly && <p className="mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted">Компания в архиве — изменения недоступны.</p>}
      {toggleArchive.error && (
        <p role="alert" className="mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {toggleArchive.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <ProjectForm
            templates={templates.data}
            mode="create"
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {projects.data.length === 0 && !creating && (
        <p className="text-muted">Проектов пока нет. Проект — это клуб, магазин или офис внутри компании.</p>
      )}
      <ul className="space-y-2">
        {projects.data.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <ProjectForm
                templates={templates.data}
                mode="edit"
                initial={{ name: p.name, templateKey: p.templateKey, templateParams: p.templateParams }}
                pending={update.isPending}
                serverFields={update.error?.fields}
                serverError={update.error && !update.error.fields ? update.error.message : undefined}
                onSubmit={(values) => update.mutate({ id: p.id, values })}
                onCancel={() => {
                  setEditingId(null);
                  update.reset();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {p.name}
                    {p.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {tpl(p.templateKey)?.name ?? p.templateKey}
                    {paramsSummary(p, tpl(p.templateKey)) && ` · ${paramsSummary(p, tpl(p.templateKey))}`}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    {!p.archivedAt && (
                      <button type="button" onClick={() => setEditingId(p.id)} className={btnSecondary}>
                        Изменить
                      </button>
                    )}
                    <button type="button" onClick={() => toggleArchive.mutate(p)} className={p.archivedAt ? btnSecondary : btnDanger}>
                      {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Страница «Компании»**

`src/client/pages/settings/CompaniesSettings.tsx` (полностью):

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { btnDanger, btnPrimary, btnSecondary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCompanies, type Company } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

function CompanyRow({ c, currentId }: { c: Company; currentId: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState(c.name);
  const [baseCurrency, setBaseCurrency] = useState(c.baseCurrency);
  const dirty = name.trim() !== c.name || baseCurrency !== c.baseCurrency;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['companies'] });

  const save = useMutation<unknown, ApiError>({
    // отправляем только изменённые поля: позже смена валюты блокируется при наличии операций, переименование — нет
    mutationFn: () =>
      api(`/companies/${c.id}`, {
        method: 'PATCH',
        body: {
          ...(name.trim() !== c.name ? { name } : {}),
          ...(baseCurrency !== c.baseCurrency ? { baseCurrency } : {}),
        },
      }),
    onSuccess: invalidate,
  });
  const toggle = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidate();
      if (!c.archivedAt && c.id === currentId) navigate('/', { replace: true });
    },
  });
  const error = save.error ?? toggle.error;
  const readOnly = c.archivedAt !== null;

  return (
    <li className={`rounded-2xl border border-field p-4 ${readOnly ? 'opacity-70' : ''}`}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Название</span>
          <input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Базовая валюта</span>
          <select value={baseCurrency} disabled={readOnly} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {!readOnly && (
            <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={btnPrimary}>
              Сохранить
            </button>
          )}
          <button type="button" onClick={() => toggle.mutate()} className={readOnly ? btnSecondary : btnDanger}>
            {readOnly ? 'Вернуть из архива' : 'В архив'}
          </button>
        </div>
      </div>
      {readOnly && <p className="mt-2 text-sm text-muted">В архиве</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          {error.fields ? Object.values(error.fields).join('. ') : error.message}
        </p>
      )}
    </li>
  );
}

export function CompaniesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const companies = useCompanies();
  if (companies.isPending) return <div className="text-muted">Загрузка…</div>;
  if (companies.error) return <div className="text-expense">{companies.error.message}</div>;
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Компании</h1>
        <Link to="/companies/new" className={btnPrimary}>
          Добавить компанию
        </Link>
      </div>
      <ul className="space-y-2">
        {companies.data.map((c) => (
          <CompanyRow key={`${c.id}-${c.name}-${c.baseCurrency}-${c.archivedAt}`} c={c} currentId={company.id} />
        ))}
      </ul>
    </section>
  );
}
```

`key` включает изменяемые поля: после сохранения строка пересоздаётся с новыми значениями и сбрасывает признак «изменено».

- [ ] **Step 5: Убедиться, что всё проходит**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: PASS (4 e2e-теста: 2 в `companies.spec.ts`, 2 в `auth.spec.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/client e2e
git commit -m "feat: настройки — проекты по шаблонам с формой параметров и список компаний"
```

---

## После этого плана

Готов шаг 2 §11. План 3 (шаг 3) построит на этих сервисах экраны справочников:
- счета: создание, правка, архив только при нулевом балансе;
- категории: дерево, перетаскивание с правилами вложенности, системные статьи заблокированы;
- контрагенты, теги, шаблоны разделения;
- «Профиль», «Пользователи», «История действий», «Резервная копия», `user_preferences` (последняя компания, свёрнутая панель);
- скрипт `user:passwd`.

Блокировку смены `baseCurrency` при наличии операций и фиксированных курсов добавит план шага 4.

**Сознательно отложено из §6/§7 (ревью плана 2):**
- **Порядок и удаление проектов** (`POST …/projects/reorder`, `DELETE …/projects/:id`) переходят в план 3 вместе с общим механизмом порядка и удаления всех справочников. В плане 3 удаление проверяет инвариант 9: ни одна операция и ни один счёт (в том числе архивные) не ссылаются на проект.
- **`GET /companies/summary`** (балансы для переключателя) — план шага 4, когда появятся операции и балансы.
- **Архивирование клуба.** После плана 2 проект или компанию с клубом нельзя архивировать: в интерфейсе ещё нельзя архивировать счета (422 с понятным текстом). Это снимет план 3 (экран счетов).

**Заметки для плана 3:**
- Перетаскивание статей может переместить группу шаблона под другую статью. Тогда слияние нового шаблона не должно создавать третий уровень: детей класть под группу, только если она на верхнем уровне, иначе — под системную/верхнюю статью или пропускать с записью в историю.
- Переключатель компаний: добавить навигацию стрелками и управление фокусом для `role="menu"`.
- `accounts.create` получит публичный маршрут — проверки `projectId` той же компании и формата `openedAt` уже есть (план 2).
