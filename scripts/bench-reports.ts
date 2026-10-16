import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';

// Замер отчётов «Аналитики» (§3.2 спецификации «Аналитика»): отчёт за год по 50 000 строк операций — не больше 300 мс на
// сервере (p95). Синтетическая компания: два года по 50 000 строк (каждая четвёртая операция разбита на две строки,
// у каждой пятой дата сделки сдвинута до 20 дней — часто в соседний месяц), переводы, склад с документами через API
// (продажи, списания, «Нет партии») и оплаты закупок. Строки операций пишутся прямо в базу одной транзакцией — так
// быстрее, чем через API; отчёты идут через app.inject. npm run bench:reports. Всё — во временной папке, которая
// удаляется в конце; папка данных приложения не трогается. Код выхода 1 — бюджет нарушен или замер не удался.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-reports-'));
const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
const { sqlite, db } = openDb(config.dbPath);
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let failed = false;
let over = false;

try {
  runMigrations(db);
  seedCurrencies(db);
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

  // операции: 40 000 в год, каждая четвёртая — две строки (50 000 строк в год), 2 % — переводы без строк
  const insertOp = sqlite.prepare(
    `INSERT INTO operations (company_id, type, status, paid_at, accrual_date, account_id, amount, to_account_id, to_amount, rate, base_amount,
       counterparty_id, comment, created_by, created_at, updated_at, version)
     VALUES (?, ?, 'actual', ?, ?, ?, ?, ?, ?, '1', ?, ?, NULL, ?, ?, ?, 1)`,
  );
  const insertLine = sqlite.prepare('INSERT INTO operation_lines (operation_id, position, category_id, project_id, amount, base_amount) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPayment = sqlite.prepare('INSERT INTO stock_doc_payments (doc_id, operation_id, amount) VALUES (?, ?, ?)');
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
  const stamp = NOW.toISOString();
  let lines2026 = 0;
  const insertYears = sqlite.transaction((yearFrom: number, yearTo: number) => {
    for (let y = yearFrom; y <= yearTo; y++) {
      const start = Date.UTC(y, 0, 1) - 5 * 3_600_000;
      const span = Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1);
      let lines = 0;
      for (let i = 0; lines < LINES_PER_YEAR; i++) {
        const paid = new Date(start + Math.floor(random() * span)).toISOString();
        const account = pick(accounts);
        if (i % 50 === 0) {
          insertOp.run(cid, 'transfer', paid, null, account, 500_000, account === accounts[0] ? accounts[1] : accounts[0], 500_000, 500_000, null, user.id, stamp, stamp);
          continue;
        }
        const type = random() < 0.45 ? 'expense' : 'income';
        const split = i % 4 === 0;
        const parts = split ? [Math.floor(random() * 2_000_000) + 1000, Math.floor(random() * 2_000_000) + 1000] : [Math.floor(random() * 4_000_000) + 1000];
        const amount = parts.reduce((s, x) => s + x, 0);
        const accrual = i % 5 === 0 ? new Date(Date.parse(paid) + Math.floor((random() - 0.5) * 40) * 86_400_000).toISOString().slice(0, 10) : null;
        const op = insertOp.run(cid, type, paid, accrual, account, amount, null, null, amount, random() < 0.6 ? pick(counterparties) : null, user.id, stamp, stamp).lastInsertRowid as number;
        parts.forEach((part, position) => insertLine.run(op, position, pick(type === 'income' ? income : expense), random() < 0.8 ? pick(projects) : null, part, part));
        if (type === 'expense' && i % 97 === 0) insertPayment.run(pick(receipts), op, Math.min(amount, 6_000_000));
        lines += parts.length;
      }
      if (y === 2026) lines2026 = lines;
    }
  });
  insertYears(2025, 2026);

  const lines: string[] = [`Компания: строк операций за 2026 год — ${lines2026}, всего операций — ${(sqlite.prepare('SELECT COUNT(*) AS n FROM operations').get() as { n: number }).n}`];
  const year = 'from=2026-01-01&to=2026-12-31';
  const scenarios: [string, string][] = [
    ['«Деньги»: год по месяцам, по категориям', `cashflow?${year}`],
    ['«Деньги»: год по неделям, по контрагентам', `cashflow?${year}&step=week&by=counterparty`],
    ['«Прибыль»: год по месяцам, склад', `pnl?${year}`],
    ['«Прибыль»: год по неделям, по проектам, склад', `pnl?${year}&step=week&by=project`],
    ['«Прибыль»: год по кварталам, без склада', `pnl?${year}&step=quarter&stock=0`],
  ];
  const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
  const runScenario = async (name: string, url: string) => {
    headers = await login();
    const call = async () => {
      const t = performance.now();
      const res = await target.inject({ method: 'GET', url: `${api}/analytics/${url}`, headers });
      const ms = performance.now() - t;
      if (res.statusCode !== 200) throw new Error(`${name}: ${res.statusCode} ${res.body.slice(0, 200)}`);
      return { ms, body: res.json() as { rows: { id: string; total: number | null }[] } };
    };
    const first = await call();
    if (!first.body.rows.some((r) => r.id === 'income' && (r.total ?? 0) > 0)) throw new Error(`${name}: пустой отчёт — замер ничего не измерил`);
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
    if (p95 > BUDGET_MS) over = true;
    lines.push(
      `${name.padEnd(52)} p50 ${p50.toFixed(1).padStart(7)} мс   p95 ${p95.toFixed(1).padStart(7)} мс  [${p95s.map((x) => x.toFixed(0)).join(' / ')}]  ${p95 <= BUDGET_MS ? 'OK' : 'ПРЕВЫШЕН'}`,
    );
  };
  for (const [name, url] of scenarios) await runScenario(name, url);
  // пять лет истории: к 2025–2026 добавляются 2022–2024, отчёт за 2026 год тот же — растёт только объём операций до периода
  insertYears(HISTORY_FROM, HISTORY_TO);
  lines.push(`История: операций всего — ${(sqlite.prepare('SELECT COUNT(*) AS n FROM operations').get() as { n: number }).n} (${HISTORY_FROM}–2026)`);
  await runScenario('«Деньги»: год по месяцам, 5 лет истории', `cashflow?${year}`);
  await runScenario('«Прибыль»: год по месяцам, склад, 5 лет истории', `pnl?${year}`);
  console.log(`\nЗамер отчётов (§3.2 спецификации «Аналитика»), Node ${process.version}, бюджет ${BUDGET_MS} мс (медиана p95 из ${REPEATS} повторов по ${RUNS} вызовов; в скобках p95 каждого повтора):\n`);
  for (const l of lines) console.log(l);
} catch (e) {
  failed = true;
  console.log(`Ошибка замера: ${(e as Error).message}`);
} finally {
  await app?.close();
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? '\nИтог: ошибка замера' : over ? '\nИтог: бюджет нарушен' : '\nИтог: бюджет соблюдён');
process.exitCode = failed || over ? 1 : 0;
