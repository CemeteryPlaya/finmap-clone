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
import { seedDemo } from './lib/demo';

// Замер §12 на демо-наборе §10: p95 первой страницы журнала, фильтра и поиска (бюджет 300 мс на сервере),
// выгрузки в Excel, балансов и сводки. Запросы идут через app.inject — сервер без сети.
// npm run bench:journal [-- <папка данных>]; по умолчанию <tmpdir>/finmap-bench-journal — набор заливается
// один раз (около 45 с) и переиспользуется следующими запусками. Пользователь bench — только в демо-копии.

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DEMO_COMPANY = 'ТОО «Демо Клубы»';
const BUDGET_MS = 300;
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };

const dir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'finmap-bench-journal'));
fs.mkdirSync(dir, { recursive: true });
const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
seedCurrencies(db);

const one = <T>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const companies = one<{ n: number }>('SELECT COUNT(*) n FROM companies')!.n;
if (companies > 0 && !one('SELECT id FROM companies WHERE name = ?', DEMO_COMPANY)) {
  console.error(`В ${config.dbPath} не демо-набор — укажите пустую папку или копию после npm run seed:demo.`);
  process.exit(1);
}
if (!one('SELECT id FROM users WHERE login = ?', LOGIN)) {
  await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
}
if (companies === 0) {
  console.log(`Заливаю демо-набор в ${dir} (около 45 с)…`);
  const started = Date.now();
  seedDemo({ db, timezone: config.timezone, now: NOW });
  console.log(`Готово за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
}

const cid = one<{ id: number }>('SELECT id FROM companies WHERE name = ?', DEMO_COMPANY)!.id;
const premises = one<{ id: number }>("SELECT id FROM categories WHERE company_id = ? AND template_ref = 'computer-club:premises'", cid)!.id;
const opCount = one<{ n: number }>('SELECT COUNT(*) n FROM operations WHERE company_id = ? AND deleted_at IS NULL', cid)!.n;

const app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
await app.ready();

/** Новая сессия на каждый сценарий: лимит API — 300 запросов в минуту на сессию (§8). */
async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (res.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${res.statusCode} ${res.body}`);
  return `sid=${sid.value}`;
}

interface Result {
  name: string;
  p50: number;
  p95: number;
  budget: boolean;
}

async function measure(name: string, url: string, runs: number, budget: boolean): Promise<Result> {
  const cookie = await login();
  const call = async () => {
    const t = performance.now();
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    const ms = performance.now() - t;
    if (res.statusCode !== 200) throw new Error(`${name}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    return ms;
  };
  for (let i = 0; i < 3; i++) await call(); // прогрев
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await call());
  return summarize(name, times, budget);
}

function summarize(name: string, times: number[], budget: boolean): Result {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { name, p50: at(0.5), p95: at(0.95), budget };
}

const ops = `/api/v1/companies/${cid}/operations`;

/** Массовое действие: время запроса; все переданные операции должны оказаться в changed. */
async function bulk(cookie: string, body: object, expectChanged: number): Promise<number> {
  const t = performance.now();
  const res = await app.inject({ method: 'POST', url: `${ops}/bulk`, headers: { ...HEADERS, cookie }, payload: body });
  const ms = performance.now() - t;
  const changed = res.statusCode === 200 ? (res.json() as { changed: number[] }).changed.length : -1;
  if (changed !== expectChanged) throw new Error(`Массовое действие: ${res.statusCode}, изменено ${changed} из ${expectChanged}: ${res.body.slice(0, 200)}`);
  return ms;
}

const results = [
  await measure('Первая страница журнала', `${ops}?limit=50`, 50, true),
  await measure('Фильтр: «Помещение» с дочерними, расходы, 2026 год', `${ops}?categoryIds=${premises}&types=expense&from=2026-01-01&to=2026-12-31`, 50, true),
  await measure('Фильтр: от 50 000 ₸, по сумме', `${ops}?amountMin=5000000&sort=amount`, 50, true),
  await measure('Поиск «аренда»', `${ops}?q=${encodeURIComponent('аренда')}`, 50, true),
  await measure('Поиск без совпадений', `${ops}?q=${encodeURIComponent('нет такого текста')}`, 50, true),
  await measure(`Выгрузка в Excel (${opCount} операций)`, `${ops}/export.xlsx`, 10, false),
  await measure('Балансы счетов', `/api/v1/companies/${cid}/balances`, 50, false),
  await measure('Сводка компаний', '/api/v1/companies/summary', 50, false),
];

// Массовые действия на BULK_MAX = 500 операций — без бюджета §12, но запрос синхронный и держит сервер всё это время.
// Замер меняет демо-копию: контрагент чередуется между двумя, каждое удаление сразу отменяется восстановлением.
const bulkIds = (
  sqlite
    .prepare("SELECT id FROM operations WHERE company_id = ? AND deleted_at IS NULL AND type <> 'transfer' ORDER BY id DESC LIMIT 500")
    .all(cid) as { id: number }[]
).map((r) => r.id);
const cps = (sqlite.prepare('SELECT id FROM counterparties WHERE company_id = ? AND archived_at IS NULL ORDER BY id LIMIT 2').all(cid) as { id: number }[]).map(
  (r) => r.id,
);
const bulkCookie = await login();
const setTimes: number[] = [];
const deleteTimes: number[] = [];
const restoreTimes: number[] = [];
for (let i = 0; i < 6; i++) setTimes.push(await bulk(bulkCookie, { action: 'setCounterparty', counterpartyId: cps[i % 2], ids: bulkIds }, bulkIds.length));
for (let i = 0; i < 3; i++) {
  deleteTimes.push(await bulk(bulkCookie, { action: 'delete', ids: bulkIds }, bulkIds.length));
  restoreTimes.push(await bulk(bulkCookie, { action: 'restore', ids: bulkIds }, bulkIds.length));
}
results.push(
  summarize(`Массово: контрагент, ${bulkIds.length} операций`, setTimes, false),
  summarize(`Массово: удалить ${bulkIds.length} операций`, deleteTimes, false),
  summarize(`Массово: восстановить ${bulkIds.length} операций`, restoreTimes, false),
);

console.log(`\nДемо-набор: ${dir}; компания «${DEMO_COMPANY}», операций: ${opCount}. Бюджет §12 — ${BUDGET_MS} мс (p95).\n`);
for (const r of results) {
  const verdict = r.budget ? (r.p95 < BUDGET_MS ? 'OK' : 'ПРЕВЫШЕН') : 'без бюджета';
  console.log(`${r.name.padEnd(54)} p50 ${r.p50.toFixed(1).padStart(7)} мс   p95 ${r.p95.toFixed(1).padStart(7)} мс   ${verdict}`);
}
await app.close();
sqlite.close();
if (results.some((r) => r.budget && r.p95 >= BUDGET_MS)) process.exitCode = 1;
