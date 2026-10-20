import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { benchDirProblem } from './lib/bench-gate';
import { seedDemo } from './lib/demo';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

// Замер §12 на демо-наборе §10: p95 первой страницы журнала, фильтра и поиска (бюджет 300 мс на сервере),
// выгрузки в Excel, балансов и сводки. Запросы идут через app.inject — сервер без сети.
// npm run bench:journal [-- <папка данных>]; по умолчанию <tmpdir>/finmap-bench-journal — набор заливается
// один раз (около 45 с) и переиспользуется следующими запусками. Пользователь bench создаётся только в свежей демо-копии.
// Безопасность: скрипт пишет только в свою папку: не в папку данных приложения (DATA_DIR) и, для свежей копии, только в
// несуществующую или пустую. Если в папке уже есть app.db, нужен файл-метка bench-demo.marker
// (его пишет сам замер после заливки), а база, открытая только на чтение, должна содержать ровно три демо-компании.
// Массовые действия идут на одноразовой копии базы во временной папке — демо-копия между запусками не меняется.

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DEMO_COMPANY = 'ТОО «Демо Клубы»';
/** Имена компаний демо-набора (scripts/lib/demo.ts). */
const DEMO_COMPANY_NAMES = [DEMO_COMPANY, 'ИП «Демо Бар»', 'Demo Ltd'];
const MARKER = 'bench-demo.marker';
const BUDGET_MS = 300;
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const dir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'finmap-bench-journal'));
const dbFile = path.join(dir, 'app.db');
const markerFile = path.join(dir, MARKER);
const fresh = !fs.existsSync(dbFile);
const gate = benchDirProblem(dir, path.resolve(process.env.DATA_DIR ?? 'data'), !fresh);
if (gate) fail(gate);

// Проверка до любой записи: ни миграций, ни заливки, ни открытия на запись.
if (!fresh) {
  if (!fs.existsSync(markerFile)) {
    fail(`В ${dir} уже есть app.db, но нет файла ${MARKER}: это не демо-копия замера. Ничего не изменено. Укажите другую папку или удалите эту, если она осталась от прерванной заливки.`);
  }
  let names: string[];
  try {
    const ro = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      names = (ro.prepare('SELECT name FROM companies ORDER BY id').all() as { name: string }[]).map((r) => r.name);
    } finally {
      ro.close();
    }
  } catch (e) {
    fail(`Не удалось прочитать ${dbFile} как демо-копию: ${(e as Error).message}. Ничего не изменено.`);
  }
  if (names.length !== DEMO_COMPANY_NAMES.length || !names.every((n) => DEMO_COMPANY_NAMES.includes(n))) {
    fail(`В ${dbFile} не демо-набор (компании: ${names.join(', ') || 'нет'}). Ничего не изменено. Укажите другую папку.`);
  }
} else {
  fs.mkdirSync(dir, { recursive: true });
}

const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures' });
if (fresh) {
  const seeded = openDb(config.dbPath);
  runMigrations(seeded.db);
  await seedCurrencies(seeded.db);
  await createUsersService(seeded.db, createAuditService(seeded.db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
  console.log(`Заливаю демо-набор в ${dir} (около 45 с)…`);
  const started = Date.now();
  await seedDemo({ db: seeded.db, timezone: config.timezone, now: NOW });
  seeded.sqlite.close();
  fs.writeFileSync(markerFile, 'Демо-копия для npm run bench:journal. Создана замером; без этого файла замер не станет её использовать.\n');
  console.log(`Готово за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
}

// Весь замер идёт на одноразовой копии во временной папке: входы пишут в журнал аудита, массовые действия меняют операции,
// а демо-копия между запусками не должна меняться.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-scratch-'));
const scratchConfig = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: scratchDir, RATES_SOURCE: 'fixtures' });
let scratch: ReturnType<typeof openDb>;
try {
  const source = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    await source.backup(scratchConfig.dbPath);
  } finally {
    source.close();
  }
  scratch = openDb(scratchConfig.dbPath);
} catch (e) {
  fs.rmSync(scratchDir, { recursive: true, force: true });
  fail(`Не удалось подготовить одноразовую копию: ${(e as Error).message}`);
}
const { sqlite, db } = scratch;
const cleanup = async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(scratchDir, { recursive: true, force: true });
};

const one = <T>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const cid = one<{ id: number }>('SELECT id FROM companies WHERE name = ?', DEMO_COMPANY)!.id;
const premises = one<{ id: number }>("SELECT id FROM categories WHERE company_id = ? AND template_ref = 'computer-club:premises'", cid)!.id;
const opCount = one<{ n: number }>('SELECT COUNT(*) n FROM operations WHERE company_id = ? AND deleted_at IS NULL', cid)!.n;

const app = await buildApp({ config: scratchConfig, db, sqlite, logger: false, now: () => NOW });
await app.ready();

type Inject = typeof app.inject;

/** Новая сессия на каждый сценарий: лимит API — 300 запросов в минуту на сессию (§8). */
async function login(target: { inject: Inject } = app): Promise<string> {
  const res = await target.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
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

/** Число найденных записей в ответе; 0 — сценарий ничего не измерил. */
type Count = (res: Awaited<ReturnType<Inject>>) => number;
const items: Count = (res) => (res.json() as { items: unknown[] }).items.length;
const accounts: Count = (res) => (res.json() as { accounts: unknown[] }).accounts.length;
const companiesIn: Count = (res) => (res.json() as { companies: unknown[] }).companies.length;
/** Строки данных в Excel без заголовка. */
const xlsxRows: Count = (res) => {
  const sheet = new AdmZip(res.rawPayload).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
  return (sheet.match(/<row /g)?.length ?? 0) - 1;
};

async function measure(name: string, url: string, runs: number, budget: boolean, count: Count | null): Promise<Result> {
  const cookie = await login();
  const call = async (check: boolean) => {
    const t = performance.now();
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    const ms = performance.now() - t;
    if (res.statusCode !== 200) throw new Error(`${name}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    if (check && count && count(res) === 0) throw new Error(`${name}: пустой результат — замер ничего не измерил`);
    return ms;
  };
  await call(true);
  for (let i = 0; i < 2; i++) await call(false); // прогрев
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await call(false));
  return summarize(name, times, budget);
}

function summarize(name: string, times: number[], budget: boolean): Result {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { name, p50: at(0.5), p95: at(0.95), budget };
}

const ops = `/api/v1/companies/${cid}/operations`;

let results: Result[];
try {
  results = [
    await measure('Первая страница журнала', `${ops}?limit=50`, 50, true, items),
    await measure('Фильтр: «Помещение» с дочерними, расходы, 2026 год', `${ops}?categoryIds=${premises}&types=expense&from=2026-01-01&to=2026-12-31`, 50, true, items),
    await measure('Фильтр: от 50 000 ₸, по сумме', `${ops}?amountMin=5000000&sort=amount`, 50, true, items),
    await measure('Поиск «аренда»', `${ops}?q=${encodeURIComponent('аренда')}`, 50, true, items),
    await measure('Поиск без совпадений', `${ops}?q=${encodeURIComponent('нет такого текста')}`, 50, true, null),
    await measure(`Выгрузка в Excel (${opCount} операций)`, `${ops}/export.xlsx`, 10, false, xlsxRows),
    await measure('Балансы счетов', `/api/v1/companies/${cid}/balances`, 50, false, accounts),
    await measure('Сводка компаний', '/api/v1/companies/summary', 50, false, companiesIn),
  ];
} catch (e) {
  await cleanup();
  fail((e as Error).message);
}

// Массовые действия на BULK_MAX = 500 операций — без бюджета §12, но запрос синхронный и держит сервер всё это время.
// Идут последними: меняют одноразовую копию.
const bulkIds = (
  sqlite
    .prepare("SELECT id FROM operations WHERE company_id = ? AND deleted_at IS NULL AND type <> 'transfer' ORDER BY id DESC LIMIT 500")
    .all(cid) as { id: number }[]
).map((r) => r.id);
const cps = (sqlite.prepare('SELECT id FROM counterparties WHERE company_id = ? AND archived_at IS NULL ORDER BY id LIMIT 2').all(cid) as { id: number }[]).map(
  (r) => r.id,
);

/** Массовое действие: время запроса; все переданные операции должны оказаться в changed. */
async function bulk(cookie: string, body: object, expectChanged: number): Promise<number> {
  const t = performance.now();
  const res = await app.inject({ method: 'POST', url: `${ops}/bulk`, headers: { ...HEADERS, cookie }, payload: body });
  const ms = performance.now() - t;
  const changed = res.statusCode === 200 ? (res.json() as { changed: number[] }).changed.length : -1;
  if (changed !== expectChanged) throw new Error(`Массовое действие: ${res.statusCode}, изменено ${changed} из ${expectChanged}: ${res.body.slice(0, 200)}`);
  return ms;
}

const setTimes: number[] = [];
const deleteTimes: number[] = [];
const restoreTimes: number[] = [];
try {
  if (bulkIds.length === 0 || cps.length < 2) throw new Error('Массовые действия: в демо-копии нет операций или двух контрагентов');
  const bulkCookie = await login();
  for (let i = 0; i < 6; i++) setTimes.push(await bulk(bulkCookie, { action: 'setCounterparty', counterpartyId: cps[i % 2], ids: bulkIds }, bulkIds.length));
  for (let i = 0; i < 3; i++) {
    deleteTimes.push(await bulk(bulkCookie, { action: 'delete', ids: bulkIds }, bulkIds.length));
    restoreTimes.push(await bulk(bulkCookie, { action: 'restore', ids: bulkIds }, bulkIds.length));
  }
} catch (e) {
  await cleanup();
  fail((e as Error).message);
}
await cleanup();

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
if (results.some((r) => r.budget && r.p95 >= BUDGET_MS)) process.exitCode = 1;
