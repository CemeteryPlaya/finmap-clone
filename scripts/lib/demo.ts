import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../../src/server/db/client';
import { categories as categoriesTable, companies as companiesTable, exchangeRates, users } from '../../src/server/db/schema';
import { createAccountsService, type AccountRow } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createOperationsService, type LineInput, type OperationInput } from '../../src/server/modules/operations/service';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createOperationsReferences } from '../../src/server/modules/references/service';
import { COUNTERPARTY_TYPES, COUNTERPARTY_TYPE_SINGULAR } from '../../src/shared/counterparties';
import { addDays, todayInTimezone } from '../../src/shared/dates';
import { allocate } from '../../src/shared/money';

export interface DemoResult {
  companies: number;
  projects: number;
  accounts: number;
  categories: number;
  counterparties: number;
  operations: number;
}

/** Детерминированный генератор mulberry32: одинаковое зерно — одинаковая последовательность в [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  companyId: number;
  accounts: AccountRow[];
  income: number[];
  expense: number[];
  projects: number[];
  counterparties: number[];
}

/**
 * Демо-набор §10 через настоящие сервисы (те же инварианты и история): 3 компании, 5 проектов, 8 счетов,
 * не меньше 60 статей, 150 контрагентов, `operations` операций за 2 года. Только в пустую базу.
 */
export function seedDemo(d: { db: Db; timezone: string; now: Date; operations?: number }): DemoResult {
  const { db } = d;
  const user = db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1).get();
  if (!user) throw new Error('Сначала создайте пользователя: npm run user:add');
  if ((db.select({ n: count() }).from(companiesTable).get()?.n ?? 0) > 0) {
    throw new Error('Демо-набор заливается только в пустую базу: в ней уже есть компании');
  }
  // всё или ничего: сбой посередине не оставляет полубазу, которую повторный запуск уже не примет.
  // Транзакции сервисов внутри становятся точками сохранения (better-sqlite3).
  return db.transaction(() => fill(d, user.id));
}

function fill(d: { db: Db; timezone: string; now: Date; operations?: number }, uid: number): DemoResult {
  const { db, timezone: tz } = d;
  const total = d.operations ?? 10_000;
  const now = () => d.now;
  const audit = createAuditService(db, now);
  const references = createOperationsReferences(db, tz);
  const balances = createLedgerBalances(db);
  const categories = createCategoriesService({ db, audit, references, now });
  const accounts = createAccountsService({ db, audit, references, balances, timezone: tz, now });
  const companies = createCompaniesService({ db, audit, categories, accounts, now });
  const projects = createProjectsService({ db, audit, companies, categories, accounts, references, timezone: tz, now });
  const counterparties = createCounterpartiesService({ db, audit, references, now });
  const rates = createRatesService({ db, audit, now });
  const operations = createOperationsService({ db, audit, rates, timezone: tz, now });

  const random = rng(20261006);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const today = todayInTimezone(tz, d.now);
  const start = addDays(today, -730);

  // курсы USD к тенге на каждый день истории (и неделю до неё): «волна» около 475. Источник nbrk — так выглядят
  // курсы из фикстур (§4.3): без записей в истории и не в списке ручных курсов
  db.transaction((tx) => {
    for (let i = -7; i <= 730; i++) {
      tx.insert(exchangeRates)
        .values({
          date: addDays(start, i),
          currency: 'USD',
          rateToKzt: (475 + 15 * Math.sin(i / 45)).toFixed(2),
          source: 'nbrk',
          createdBy: null, // createdBy — только у ручных курсов
          fetchedAt: d.now.toISOString(),
        })
        .run();
    }
  });

  // компании и проекты
  const c1 = companies.create({ name: 'ТОО «Демо Клубы»', baseCurrency: 'KZT' }, uid);
  const c2 = companies.create({ name: 'ИП «Демо Бар»', baseCurrency: 'KZT' }, uid);
  const c3 = companies.create({ name: 'Demo Ltd', baseCurrency: 'USD' }, uid);
  projects.create(c1.id, { name: 'Клуб на Абая', templateKey: 'computer-club', templateParams: { pcCount: 40 } }, uid);
  projects.create(c1.id, { name: 'Клуб на Сатпаева', templateKey: 'computer-club', templateParams: { pcCount: 25, consoleCount: 4 } }, uid);
  projects.create(c1.id, { name: 'Склад', templateKey: 'general', templateParams: {} }, uid);
  const bar = projects.create(c2.id, { name: 'Бар', templateKey: 'general', templateParams: {} }, uid).project;
  projects.create(c3.id, { name: 'Офис', templateKey: 'general', templateParams: {} }, uid);

  // счета: шаблонные открыты «сегодня» — переносим открытие на начало истории; всего 8
  for (const a of accounts.list(c1.id)) accounts.update(c1.id, a.id, { openedAt: start, startingBalance: 1_000_000_00 }, uid);
  accounts.add(c1.id, { name: 'Валютный USD', currency: 'USD', openedAt: start, startingBalance: 5_000_00 }, uid);
  accounts.add(c2.id, { name: 'Касса бара', currency: 'KZT', openedAt: start, projectId: bar.id, startingBalance: 200_000_00 }, uid);
  accounts.add(c2.id, { name: 'Kaspi бара', currency: 'KZT', openedAt: start, projectId: bar.id, startingBalance: 500_000_00 }, uid);
  accounts.add(c3.id, { name: 'Счёт USD', currency: 'USD', openedAt: start, startingBalance: 10_000_00 }, uid);

  // статьи: шаблон клуба уже дал свои; добавляем статьи бару и офису, затем добираем до 60
  categories.add(c2.id, { kind: 'income', name: 'Выручка бара', parentId: null }, uid);
  for (const name of ['Закупка напитков', 'Закупка закусок', 'Аренда', 'Коммунальные услуги']) {
    categories.add(c2.id, { kind: 'expense', name, parentId: null }, uid);
  }
  categories.add(c3.id, { kind: 'income', name: 'Услуги', parentId: null }, uid);
  for (const name of ['Хостинг', 'Связь', 'Бухгалтерия']) categories.add(c3.id, { kind: 'expense', name, parentId: null }, uid);
  const categoryCount = () => db.select({ n: count() }).from(categoriesTable).get()?.n ?? 0;
  for (let i = 1; categoryCount() < 60; i++) categories.add(c3.id, { kind: 'expense', name: `Прочие расходы ${i}`, parentId: null }, uid);

  // контрагенты: 100 / 30 / 20
  for (const [companyId, n] of [
    [c1.id, 100],
    [c2.id, 30],
    [c3.id, 20],
  ] as const) {
    for (let i = 1; i <= n; i++) {
      const type = COUNTERPARTY_TYPES[i % COUNTERPARTY_TYPES.length]!;
      counterparties.add(companyId, { type, name: `${COUNTERPARTY_TYPE_SINGULAR[type]} ${String(i).padStart(3, '0')}` }, uid);
    }
  }

  const ctx = (companyId: number): Ctx => {
    const cats = db.select().from(categoriesTable).where(eq(categoriesTable.companyId, companyId)).all();
    return {
      companyId,
      accounts: accounts.list(companyId),
      income: cats.filter((c) => c.kind === 'income').map((c) => c.id),
      expense: cats.filter((c) => c.kind === 'expense').map((c) => c.id),
      projects: projects.list(companyId).map((p) => p.id),
      counterparties: counterparties.list(companyId).map((c) => c.id),
    };
  };
  const ctxs = [ctx(c1.id), ctx(c2.id), ctx(c3.id)];

  // операции: 70 % / 20 % / 10 % по компаниям; ~10 % переводов, ~50 % доходов, ~40 % расходов (балансы растут);
  // ~15 % разбитых, ~1 % удалённых
  for (let i = 0; i < total; i++) {
    const r = random();
    const c = r < 0.7 ? ctxs[0]! : r < 0.9 ? ctxs[1]! : ctxs[2]!;
    const date = addDays(start, int(1, 730));
    const at = new Date(`${date}T${String(int(4, 16)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00.000Z`);
    const paidAt = (at > d.now ? d.now : at).toISOString();
    const account = pick(c.accounts);
    const minor = account.currency === 'USD' ? int(10, 2_000) * 100 : int(1_000, 200_000) * 100;
    const kindRoll = random();
    let input: OperationInput;
    if (kindRoll < 0.1 && c.accounts.length > 1) {
      const to = pick(c.accounts.filter((a) => a.id !== account.id));
      const toAmount =
        to.currency === account.currency ? null : account.currency === 'KZT' ? Math.max(1, Math.round(minor / 475)) : minor * 475;
      const lines: LineInput[] = random() < 0.3 ? [{ categoryId: null, projectId: pick(c.projects), amount: minor }] : [];
      input = { type: 'transfer', paidAt, accrualDate: null, accountId: account.id, amount: minor, toAccountId: to.id, toAmount, counterpartyId: null, comment: null, lines, tagIds: [] };
    } else {
      const type = kindRoll < 0.6 ? 'income' : 'expense';
      const cats = type === 'income' ? c.income : c.expense;
      let lines: LineInput[];
      if (random() < 0.15) {
        const parts = allocate(minor, Array.from({ length: int(2, 3) }, () => int(1, 5)));
        lines = parts.map((amount) => ({ categoryId: pick(cats), projectId: pick(c.projects), amount }));
      } else {
        lines = [{ categoryId: random() < 0.9 ? pick(cats) : null, projectId: random() < 0.8 ? pick(c.projects) : null, amount: minor }];
      }
      input = {
        type,
        paidAt,
        accrualDate: null,
        accountId: account.id,
        amount: minor,
        toAccountId: null,
        toAmount: null,
        counterpartyId: random() < 0.6 ? pick(c.counterparties) : null,
        comment: random() < 0.2 ? `Демо-операция ${i + 1}` : null,
        lines,
        tagIds: [],
      };
    }
    const op = operations.create(c.companyId, input, uid);
    if (random() < 0.01) operations.remove(c.companyId, op.id, uid);
  }

  return {
    companies: 3,
    projects: ctxs.reduce((s, x) => s + x.projects.length, 0),
    accounts: ctxs.reduce((s, x) => s + x.accounts.length, 0),
    categories: categoryCount(),
    counterparties: ctxs.reduce((s, x) => s + x.counterparties.length, 0),
    operations: total,
  };
}
