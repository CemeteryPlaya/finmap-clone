import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/server/app';
import { sql } from 'drizzle-orm';
import { type DbConfig, loadConfig } from '../src/server/config';
import { openDatabase } from '../src/server/db/client';
import { migrateDatabase } from '../src/server/db/migrate';
import { one } from '../src/server/db/raw';
import { operationLines, operations, stockDocPayments } from '../src/server/db/schema';
import { seedCurrencies } from '../src/server/db/seed';
import { withTx } from '../src/server/db/tx';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';

// Замер отчётов «Аналитики» (§3.2 спецификации «Аналитика»): отчёт за год по 50 000 строк операций — не больше 300 мс на
// сервере (p95). Синтетическая компания: два года по 50 000 строк (каждая четвёртая операция разбита на две строки,
// у каждой пятой дата сделки сдвинута до 20 дней — часто в соседний месяц), переводы, склад с документами через API
// (продажи, списания, «Нет партии») и оплаты закупок. Строки операций пишутся прямо в базу одной транзакцией — так
// быстрее, чем через API; отчёты идут через app.inject. npm run bench:reports. Всё — во временной папке, которая
// удаляется в конце; папка данных приложения не трогается. Код выхода 1 — бюджет нарушен или замер не удался.
// npm run bench:reports -- --pg <postgres://…|pglite> — тот же замер на Postgres (план 2026-10-20-vercel-postgres, задача 12):
// база должна быть пустой (отдельная ветка Neon) — замер её заполняет и не чистит.

const NOW = new Date('2027-01-15T06:00:00.000Z');
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };
const BUDGET_MS = 300;
const LINES_PER_YEAR = 50_000;
const RUNS = 20;
/** Повторов замера на сценарий: бюджет проверяется по медиане p95 трёх повторов (p95 одного повтора шумит сильнее запаса). */
const REPEATS = 3;
/** Годы истории, которые добавляются перед сценариями «5 лет истории» (к 2025–2026). */
const HISTORY_FROM = 2022;
const HISTORY_TO = 2024;

/** Повторяемый генератор: замер на одних и тех же данных. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

const pgAt = process.argv.indexOf('--pg');
const pgUrl = pgAt >= 0 ? process.argv[pgAt + 1] : undefined;
if (pgAt >= 0 && !pgUrl) {
  console.log('Ошибка замера: после --pg нужен адрес пустой базы postgres://… или pglite');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-reports-'));
const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
const dbConfig: DbConfig = pgUrl === undefined ? { kind: 'sqlite', path: config.dbPath } : pgUrl === 'pglite' ? { kind: 'pglite' } : { kind: 'neon', url: pgUrl };
const opened = await openDatabase(dbConfig);
const { sqlite, db } = opened;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let failed = false;
let over = false;
const count = async (table: string) => (await one<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM ${sql.raw(table)}`))!.n;

try {
  await migrateDatabase(opened);
  if ((await count('users')) > 0) throw new Error('база не пустая: замер заполняет её сам — укажите пустую базу (ветку Neon)');
  await seedCurrencies(db);
  const user = await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
  app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
  await app.ready();
  const target = app;
  /** Новая сессия: лимит API — 300 запросов в минуту на сессию, поэтому вход повторяется каждые 250 запросов и на каждый сценарий. */
  const login = async () => {
    const res = await target.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
    const sid = res.cookies.find((c) => c.name === 'sid');
    if (res.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${res.statusCode} ${res.body}`);
    return { ...HEADERS, cookie: `sid=${sid.value}` };
  };
  let headers = await login();
  let calls = 0;
  const post = async (url: string, payload: unknown) => {
    if (++calls % 250 === 0) headers = await login();
    const res = await target.inject({ method: 'POST', url, headers, payload: payload as object });
    if (res.statusCode >= 300) throw new Error(`POST ${url}: ${res.statusCode} ${res.body.slice(0, 300)}`);
    return res.json() as any;
  };

  const cid = (await post('/api/v1/companies', { name: 'Замер отчётов' })).company.id as number;
  const api = `/api/v1/companies/${cid}`;
  const accounts: number[] = [];
  for (const name of ['Касса Клуб 1', 'Касса Клуб 2', 'Kaspi']) {
    accounts.push((await post(`${api}/accounts`, { name, currency: 'KZT', openedAt: '2024-12-01', startingBalance: 100_000_000 })).account.id);
  }
  const income: number[] = [];
  const expense: number[] = [];
  for (const name of ['Игровое время', 'Бар', 'Турниры', 'Аренда приставок']) income.push((await post(`${api}/categories`, { kind: 'income', name })).category.id);
  for (const name of ['Аренда', 'Закуп бара', 'Коммунальные', 'Интернет', 'Реклама', 'Ремонт', 'Расходники', 'Комиссии банка']) {
    expense.push((await post(`${api}/categories`, { kind: 'expense', name })).category.id);
  }
  const projects: number[] = [];
  for (const name of ['Клуб 1', 'Клуб 2']) projects.push((await post(`${api}/projects`, { name, templateKey: 'general' })).project.id);
  const counterparties: number[] = [];
  for (let i = 1; i <= 30; i++) counterparties.push((await post(`${api}/counterparties`, { type: 'client', name: `Контрагент ${i}` })).counterparty.id);
  const supplier = (await post(`${api}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;

  // склад «Клуб 1»: 10 товаров, поступления раз в месяц, продажи каждые три дня, списания раз в месяц
  const warehouse = (await post(`${api}/stock/warehouses`, { projectId: projects[0], name: 'Бар Клуб 1' })).warehouse.id as number;
  const items: number[] = [];
  for (let i = 1; i <= 10; i++) items.push((await post(`${api}/stock/items`, { name: `Товар ${i}`, unit: 'pcs', salePrice: 50_000 })).item.id);
  const receipts: number[] = [];
  const random = rng(42);
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      receipts.push(
        (
          await post(`${api}/stock/docs`, {
            type: 'receipt',
            at: `${y}-${mm}-01T04:00:00.000Z`,
            warehouseId: warehouse,
            counterpartyId: supplier,
            lines: items.map((itemId) => ({ itemId, qty: 20_000, amount: 600_000 })),
          })
        ).doc.id,
      );
      for (let d = 2; d <= 28; d += 3) {
        await post(`${api}/stock/docs`, {
          type: 'sale',
          at: `${y}-${mm}-${String(d).padStart(2, '0')}T10:00:00.000Z`,
          warehouseId: warehouse,
          lines: items.map((itemId) => ({ itemId, qty: 1000 + Math.floor(random() * 3) * 1000, amount: 100_000 })),
        });
      }
      await post(`${api}/stock/docs`, { type: 'writeoff', at: `${y}-${mm}-01T05:00:00.000Z`, warehouseId: warehouse, reason: 'defect', lines: [{ itemId: items[0], qty: 1000 }] });
    }
  }

  // операции: 40 000 в год, каждая четвёртая — две строки (50 000 строк в год), 2 % — переводы без строк. Пишутся пачками
  // через Drizzle одной транзакцией — одинаково на SQLite и Postgres; id пачки идут по возрастанию в порядке строк
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
  const stamp = NOW.toISOString();
  const CHUNK = 1000;
  let lines2026 = 0;
  type Op = { row: typeof operations.$inferInsert; parts: { categoryId: number; projectId: number | null; amount: number }[]; payment: { docId: number; amount: number } | null };
  const opRow = (o: Pick<Op['row'], 'type' | 'paidAt' | 'accrualDate' | 'accountId' | 'amount' | 'toAccountId' | 'toAmount' | 'counterpartyId'>): Op['row'] => ({
    ...o,
    companyId: cid,
    status: 'actual',
    rate: '1',
    baseAmount: o.amount,
    comment: null,
    createdBy: user.id,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
  });
  const writeOps = async (ops: Op[]) => {
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK);
      const ids = (await db.insert(operations).values(chunk.map((o) => o.row)).returning({ id: operations.id })).map((r) => r.id).sort((a, b) => a - b);
      const lineRows = chunk.flatMap((o, k) => o.parts.map((p, position) => ({ operationId: ids[k]!, position, ...p, baseAmount: p.amount })));
      for (let j = 0; j < lineRows.length; j += CHUNK) await db.insert(operationLines).values(lineRows.slice(j, j + CHUNK));
      const payments = chunk.flatMap((o, k) => (o.payment ? [{ ...o.payment, operationId: ids[k]! }] : []));
      if (payments.length) await db.insert(stockDocPayments).values(payments);
    }
  };
  const insertYears = (yearFrom: number, yearTo: number) =>
    withTx(db, async () => {
      for (let y = yearFrom; y <= yearTo; y++) {
        const ops: Op[] = [];
        const start = Date.UTC(y, 0, 1) - 5 * 3_600_000;
        const span = Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1);
        let lines = 0;
        for (let i = 0; lines < LINES_PER_YEAR; i++) {
          const paidAt = new Date(start + Math.floor(random() * span)).toISOString();
          const accountId = pick(accounts);
          if (i % 50 === 0) {
            const to = accountId === accounts[0] ? accounts[1]! : accounts[0]!;
            ops.push({ row: opRow({ type: 'transfer', paidAt, accrualDate: null, accountId, amount: 500_000, toAccountId: to, toAmount: 500_000, counterpartyId: null }), parts: [], payment: null });
            continue;
          }
          const type = random() < 0.45 ? 'expense' : 'income';
          const split = i % 4 === 0;
          const parts = split ? [Math.floor(random() * 2_000_000) + 1000, Math.floor(random() * 2_000_000) + 1000] : [Math.floor(random() * 4_000_000) + 1000];
          const amount = parts.reduce((s, x) => s + x, 0);
          const accrualDate = i % 5 === 0 ? new Date(Date.parse(paidAt) + Math.floor((random() - 0.5) * 40) * 86_400_000).toISOString().slice(0, 10) : null;
          const row = opRow({ type, paidAt, accrualDate, accountId, amount, toAccountId: null, toAmount: null, counterpartyId: random() < 0.6 ? pick(counterparties) : null });
          const lineParts = parts.map((part) => ({ categoryId: pick(type === 'income' ? income : expense), projectId: random() < 0.8 ? pick(projects) : null, amount: part }));
          ops.push({ row, parts: lineParts, payment: type === 'expense' && i % 97 === 0 ? { docId: pick(receipts), amount: Math.min(amount, 6_000_000) } : null });
          lines += parts.length;
        }
        await writeOps(ops);
        if (y === 2026) lines2026 = lines;
      }
    });
  await insertYears(2025, 2026);

  const lines: string[] = [`База: ${pgUrl === undefined ? 'SQLite' : pgUrl === 'pglite' ? 'PGlite' : 'Postgres (Neon)'}. Компания: строк операций за 2026 год — ${lines2026}, всего операций — ${await count('operations')}`];
  const year = 'from=2026-01-01&to=2026-12-31';
  const scenarios: [string, string][] = [
    ['«Деньги»: год по месяцам, по категориям', `cashflow?${year}`],
    ['«Деньги»: год по неделям, по контрагентам', `cashflow?${year}&step=week&by=counterparty`],
    ['«Прибыль»: год по месяцам, склад', `pnl?${year}`],
    ['«Прибыль»: год по неделям, по проектам, склад', `pnl?${year}&step=week&by=project`],
    ['«Прибыль»: год по кварталам, без склада', `pnl?${year}&step=quarter&stock=0`],
    ['«Проекты»: год, все проекты с категориями, склад', `projects?${year}&status=all&mode=categories`],
  ];
  const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
  /** gate=false — справочный сценарий: печатается, но бюджет §3.2 (год в 50 000 строк) не проверяет. */
  const runScenario = async (name: string, url: string, gate = true) => {
    headers = await login();
    const call = async () => {
      const t = performance.now();
      const res = await target.inject({ method: 'GET', url: `${api}/analytics/${url}`, headers });
      const ms = performance.now() - t;
      if (res.statusCode !== 200) throw new Error(`${name}: ${res.statusCode} ${res.body.slice(0, 200)}`);
      return { ms, body: res.json() as { rows?: { id: string; total: number | null }[]; total?: { income: number }; summary?: { income: number } } };
    };
    const first = await call();
    // «Проекты» (§7) отвечают строками проектов и «Всего», «Выписка» — сводкой, остальные отчёты — деревом строк с группой «Поступления»/«Доходы»
    const income = first.body.total?.income ?? first.body.summary?.income ?? first.body.rows?.find((r) => r.id === 'income')?.total ?? 0;
    if (income <= 0) throw new Error(`${name}: пустой отчёт — замер ничего не измерил`);
    await call();
    const p50s: number[] = [];
    const p95s: number[] = [];
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) times.push((await call()).ms);
      times.sort((a, b) => a - b);
      p50s.push(times[Math.ceil(0.5 * RUNS) - 1]!);
      p95s.push(times[Math.ceil(0.95 * RUNS) - 1]!);
    }
    const p50 = median(p50s);
    const p95 = median(p95s);
    if (gate && p95 > BUDGET_MS) over = true;
    const verdict = !gate ? 'справочно' : p95 <= BUDGET_MS ? 'OK' : 'ПРЕВЫШЕН';
    lines.push(
      `${name.padEnd(52)} p50 ${p50.toFixed(1).padStart(7)} мс   p95 ${p95.toFixed(1).padStart(7)} мс  [${p95s.map((x) => x.toFixed(0)).join(' / ')}]  ${verdict}`,
    );
  };
  for (const [name, url] of scenarios) await runScenario(name, url);
  // пять лет истории по 50 000 строк в год (стресс, примерно в 8 раз больше журнала клуба): к 2025–2026 добавляются
  // 2022–2024, отчёт за 2026 год тот же — растёт только объём операций до периода. Справочно: бюджет §3.2 задан на год
  // в 50 000 строк; если реальный журнал дорастёт до таких объёмов — остаток на начало хранить снимками по месяцам.
  await insertYears(HISTORY_FROM, HISTORY_TO);
  lines.push(`История: операций всего — ${await count('operations')} (${HISTORY_FROM}–2026)`);
  await runScenario('«Деньги»: год по месяцам, 5 лет истории', `cashflow?${year}`, false);
  await runScenario('«Прибыль»: год по месяцам, склад, 5 лет истории', `pnl?${year}`, false);
  // «Выписка по счету» (§6) загруженного счёта: сводка за год и первая страница при пяти годах истории (R5, справочно)
  await runScenario('«Выписка»: счёт за год, 5 лет истории', `statement?account=${accounts[0]}&${year}`, false);
  console.log(`\nЗамер отчётов (§3.2 спецификации «Аналитика»), Node ${process.version}, бюджет ${BUDGET_MS} мс (медиана p95 из ${REPEATS} повторов по ${RUNS} вызовов; в скобках p95 каждого повтора):\n`);
  for (const l of lines) console.log(l);
} catch (e) {
  failed = true;
  console.log(`Ошибка замера: ${(e as Error).message}`);
} finally {
  await app?.close();
  await opened.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? '\nИтог: ошибка замера' : over ? '\nИтог: бюджет нарушен' : '\nИтог: бюджет соблюдён');
process.exitCode = failed || over ? 1 : 0;
