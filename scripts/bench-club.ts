import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/server/app';
import { type DbConfig, loadConfig } from '../src/server/config';
import type { Executor } from '../src/server/db/client';
import { openDatabase } from '../src/server/db/client';
import { migrateDatabase } from '../src/server/db/migrate';
import {
  senetConnections,
  senetDataSpans,
  senetGoodsMoves,
  senetLoad,
  senetOffices,
  senetRefills,
  senetShifts,
  senetSoldItems,
  senetStock,
  senetTickets,
  senetTransactions,
} from '../src/server/db/schema';
import { seedCurrencies } from '../src/server/db/seed';
import { withTx } from '../src/server/db/tx';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';

// Замер «Аналитики клуба» (спецификация 2026-11-03-club-analytics, §11; план АК-4, задача 7): год данных одного клуба —
// 150 000 сеансов, 200 000 позиций продаж, абонементы, пополнения, транзакции кассы, смены, окна суток движения и остатков
// бара, отрезки покрытия — любой отчёт за год со сравнением не дольше 800 мс на сервере (p95 из 5 вызовов после прогрева).
// Строки Senet пишутся прямо в базу одной транзакцией; отчёты идут через app.inject. Всё — во временной папке, которая
// удаляется в конце. npm run bench:club; npm run bench:club -- --pg <postgres://…|pglite> — то же на Postgres (база пустая).
// Код выхода 1 — бюджет нарушен или замер не удался.

const NOW = new Date('2026-11-15T06:00:00.000Z');
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };
const BUDGET_MS = 800;
const RUNS = Number(process.env.RUNS ?? 5);
/** Только сценарии, в имени которых есть ONLY (для профиля одного отчёта). */
const ONLY = process.env.ONLY ?? '';
const TZ_MS = 5 * 3_600_000;
const DAY = 86_400_000;
/** Год клуба: местные сутки 01.11.2025–31.10.2026 (UTC+5). */
const FIRST = Date.parse('2025-10-31T19:00:00.000Z');
const DAYS = 365;
const SESSIONS = Number(process.env.N ?? 150_000);
const SALES = Number(process.env.S ?? 200_000);
const GUESTS = 8_000;
const GOODS = [
  { name: 'Кола 0,5', price: 45_000 },
  { name: 'Энергетик', price: 70_000 },
  { name: 'Чипсы', price: 50_000 },
  { name: 'Вода', price: 25_000 },
  { name: 'Сэндвич', price: 90_000 },
];
const HOUR_WEIGHT = [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 8, 9, 9, 8, 6, 3];
const HOUR_TOTAL = HOUR_WEIGHT.reduce((t, w) => t + w, 0);

/** Повторяемый генератор: замер на одних и тех же данных. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}
const r = rng(7);
const iso = (ms: number) => new Date(ms).toISOString();
/** Момент в сутках `d` (0…364) с часом по весу вечернего пика. */
function moment(d: number): number {
  let x = r() * HOUR_TOTAL;
  let h = 0;
  while (x >= HOUR_WEIGHT[h]!) x -= HOUR_WEIGHT[h++]!;
  return FIRST + d * DAY + h * 3_600_000 + Math.floor(r() * 3_600_000);
}

async function insertAll<T>(tx: Executor, table: Parameters<Executor['insert']>[0], rows: readonly T[], size = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await tx.insert(table).values(rows.slice(i, i + size) as never);
}

const pgAt = process.argv.indexOf('--pg');
const pgUrl = pgAt >= 0 ? process.argv[pgAt + 1] : undefined;
if (pgAt >= 0 && !pgUrl) {
  console.log('Ошибка замера: после --pg нужен адрес пустой базы postgres://… или pglite');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-club-'));
const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
const dbConfig: DbConfig = pgUrl === undefined ? { kind: 'sqlite', path: config.dbPath } : pgUrl === 'pglite' ? { kind: 'pglite' } : { kind: 'neon', url: pgUrl };
const opened = await openDatabase(dbConfig);
const { sqlite, db } = opened;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let failed = false;
let over = false;

/** Строки Senet клуба на год. */
async function seedClub(officeId: number): Promise<void> {
  const load: (typeof senetLoad.$inferInsert)[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    const g = Math.floor(r() ** 2 * GUESTS);
    const check = i % 4 === 3;
    const start = moment(Math.floor(r() * DAYS));
    const minutes = 60 + Math.floor(r() * 180);
    const vip = r() < 0.25;
    load.push({
      officeId,
      startAt: iso(start),
      endAt: iso(start + minutes * 60_000),
      zone: vip ? 'VIP' : 'Общий зал',
      workstation: vip ? 31 + Math.floor(r() * 10) : 1 + Math.floor(r() * 30),
      guestLogin: check ? `C${i.toString(36).toUpperCase().slice(-3)}` : `guest${g}`,
      phoneHash: check ? null : `hash-${g}`,
      phoneMask: check ? null : `+7 *** ** ${String(g % 100).padStart(2, '0')}`,
      age: 18 + (g % 20),
      debited: r() < 0.5 ? 0 : minutes * 600,
      durationSec: minutes * 60,
    });
  }
  const sold: (typeof senetSoldItems.$inferInsert)[] = [];
  for (let i = 0; i < SALES; i++) {
    const at = iso(moment(Math.floor(r() * DAYS)));
    if (r() < 0.85) {
      const g = GOODS[Math.floor(r() * GOODS.length)]!;
      const qty = 1 + Math.floor(r() * 3);
      sold.push({ officeId, at, item: g.name, qty: qty * 1000, amount: g.price * qty, payment: 'Наличный расчет' });
    } else sold.push({ officeId, at, item: `C${i.toString(36).toUpperCase().slice(-3)}`, qty: null, amount: 100_000, payment: 'Наличный расчет' });
  }
  const tickets = Array.from({ length: 30_000 }, (_, i): typeof senetTickets.$inferInsert => ({ officeId, at: iso(moment(Math.floor(r() * DAYS))), guestLogin: `guest${i % GUESTS}`, ticket: '3 часа', price: 100_000 }));
  const refills = Array.from({ length: 60_000 }, (_, i): typeof senetRefills.$inferInsert => {
    const check = i % 4 === 3;
    return { officeId, at: iso(moment(Math.floor(r() * DAYS))), guestLogin: check ? `C${i.toString(36).toUpperCase().slice(-3)}` : `guest${i % GUESTS}`, accountType: check ? 'Check' : 'General', amount: 100_000, phoneHash: check ? null : `hash-${i % GUESTS}` };
  });
  const transactions = refills.map((x, i): typeof senetTransactions.$inferInsert => ({ officeId, at: x.at, code: `T${i}`, kind: 'sell', amount: x.amount, payment: i % 3 ? 'Наличный расчет' : 'Безналичный расчет' }));
  const shifts: (typeof senetShifts.$inferInsert)[] = [];
  const moves: (typeof senetGoodsMoves.$inferInsert)[] = [];
  const stock: (typeof senetStock.$inferInsert)[] = [];
  for (let d = 0; d < DAYS; d++) {
    const day = FIRST + d * DAY;
    for (const [open, close] of [
      [day + 5 * 3_600_000, day + 17 * 3_600_000],
      [day + 17 * 3_600_000, day + 29 * 3_600_000],
    ] as const) {
      shifts.push({ officeId, openedAt: iso(open), closedAt: iso(close), openedBy: 'Кассир', closedBy: 'Кассир', endBalance: 0, revenue: 5_000_000, updatedAt: iso(close) });
    }
    for (const g of GOODS) {
      const w = { officeId, fromAt: iso(day), toAt: iso(day + DAY), item: g.name };
      moves.push({ ...w, category: g.name === 'Чипсы' || g.name === 'Сэндвич' ? 'Еда' : 'Напитки', soldQty: 90_000, soldCost: Math.round(g.price * 0.55) * 90, writeOffQty: d % 7 ? 0 : 1000, restockSum: 0, restockPrice: Math.round(g.price * 0.55) });
      stock.push({ ...w, actualQty: 60_000, restockPrice: Math.round(g.price * 0.55) });
    }
  }
  const spans = ['sessions', 'cashMoves', 'transactions', 'soldItems', 'checks', 'refills', 'stock', 'goodsMoves', 'load', 'tickets'].map((report) => ({ officeId, report, fromAt: iso(FIRST), toAt: iso(FIRST + DAYS * DAY) }));
  await withTx(db, async (tx) => {
    await insertAll(tx, senetLoad, load);
    await insertAll(tx, senetSoldItems, sold);
    await insertAll(tx, senetTickets, tickets);
    await insertAll(tx, senetRefills, refills);
    await insertAll(tx, senetTransactions, transactions);
    await insertAll(tx, senetShifts, shifts);
    await insertAll(tx, senetGoodsMoves, moves);
    await insertAll(tx, senetStock, stock);
    await insertAll(tx, senetDataSpans, spans);
  });
}

try {
  await migrateDatabase(opened);
  await seedCurrencies(db);
  const user = await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
  app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
  await app.ready();
  const target = app;
  const login = async () => {
    const res = await target.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
    const sid = res.cookies.find((c) => c.name === 'sid');
    if (res.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${res.statusCode} ${res.body}`);
    return { ...HEADERS, cookie: `sid=${sid.value}` };
  };
  let headers = await login();
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    const res = await target.inject({ method, url, headers, payload: payload as object });
    if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body.slice(0, 300)}`);
    return res.json() as any;
  };

  const cid = (await call('POST', '/api/v1/companies', { name: 'Замер клуба' })).company.id as number;
  const api = `/api/v1/companies/${cid}`;
  const project = (await call('POST', `${api}/projects`, { name: 'Клуб 1', templateKey: 'computer-club', templateParams: { pcCount: 40 } })).project.id as number;
  const [conn] = await db
    .insert(senetConnections)
    .values({ companyId: cid, name: 'Клуб', org: 'bench', authMethod: 'password', credentialsSecret: '-', credentialsHint: '-', createdAt: NOW.toISOString(), createdBy: user.id, lastSyncAt: NOW.toISOString() })
    .returning({ id: senetConnections.id });
  const [office] = await db.insert(senetOffices).values({ connectionId: conn!.id, senetOfficeId: 1, projectId: project }).returning({ id: senetOffices.id });
  const t0 = performance.now();
  await seedClub(office!.id);
  const seeded = `Данные: ${SESSIONS} сеансов, ${SALES} продаж, год ${iso(FIRST).slice(0, 10)}…; запись ${((performance.now() - t0) / 1000).toFixed(0)} с`;
  // все отчёты «Обзора»: 12 плиток — выручка, загрузка, гости, бар
  const tiles = ['revenue', 'load', 'guests', 'newGuests', 'revenuePerGuest', 'revenuePerPcDay', 'barShare', 'barMargin', 'visitDuration', 'visitsAll', 'checks', 'returningShare'];
  await call('PUT', `${api}/analytics-settings/tiles.computer-club`, { items: tiles.map((key) => ({ key, visible: true })) });

  const year = 'from=2025-11-01&to=2026-10-31&step=month&compare=1';
  const scenarios: [string, string][] = [
    ['«Обзор», 12 плиток', `overview?from=2025-11-01&to=2026-10-31&compare=1`],
    ['«Выручка» по частям', `revenue?${year}&by=parts`],
    ['«Выручка» по оплате', `revenue?${year}&by=payment`],
    ['«Выручка» по сменам', `revenue?${year}&by=shifts`],
    ['«Выручка» по кассирам', `revenue?${year}&by=cashiers`],
    ['«Выручка» по часам', `revenue?${year}&view=hours`],
    ['«Загрузка», все зоны', `load?${year}&by=all`],
    ['«Загрузка» по зонам', `load?${year}&by=zones`],
    ['«Гости»', `guests?${year}`],
    ['«Бар» по товарам', `bar?${year}&by=items`],
    ['«Бар» по категориям', `bar?${year}&by=categories`],
  ];
  const lines: string[] = [];
  for (const [name, url] of scenarios.filter(([n]) => n.includes(ONLY))) {
    headers = await login();
    const run = async () => {
      const start = performance.now();
      await call('GET', `${api}/club-analytics/${url}`);
      return performance.now() - start;
    };
    await run();
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) times.push(await run());
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(0.95 * RUNS) - 1]!;
    if (p95 > BUDGET_MS) over = true;
    lines.push(`${name.padEnd(28)} p50 ${times[Math.ceil(0.5 * RUNS) - 1]!.toFixed(0).padStart(6)} мс   p95 ${p95.toFixed(0).padStart(6)} мс  ${p95 <= BUDGET_MS ? 'OK' : 'ПРЕВЫШЕН'}`);
  }
  console.log(`\nЗамер «Аналитики клуба» (§11), ${pgUrl === undefined ? 'SQLite' : pgUrl === 'pglite' ? 'PGlite' : 'Postgres'}, Node ${process.version}, бюджет ${BUDGET_MS} мс (p95 из ${RUNS} вызовов после прогрева). ${seeded}\n`);
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
void TZ_MS;
