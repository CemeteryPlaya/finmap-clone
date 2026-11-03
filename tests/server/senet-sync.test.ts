import crypto from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore } from '../../src/server/files/local';
import type { FileStore } from '../../src/server/files/store';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createSenetConnections } from '../../src/server/modules/senet/connections';
import { cleanupSenetRaw, createSenetSync, type SenetSync } from '../../src/server/modules/senet/sync';
import { loadSecrets } from '../../src/server/secrets';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { onPg } from '../helpers/test-db';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

const KEY = crypto.randomBytes(32).toString('base64');
const HISTORY_FROM = '2026-10-01T04:00:00.000Z';

const shiftA: SampleValue[] = ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 10:00:00'), 'Сотрудник А', xlTime('2026-10-01 22:00:00'), 'Сотрудник А', 10_000, 10_000, 0];
const shiftB: SampleValue[] = ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 22:01:00'), 'Сотрудник А', xlTime('2026-10-02 10:00:00'), 'Сотрудник А', 12_000, 12_000, 0];
const move = (local: string, type: 'Внесение средств' | 'Вынесение', amount: number, comment: string | null): SampleValue[] => [
  'Клуб 1',
  xlTime(local),
  'Сотрудник А',
  type,
  type === 'Вынесение' ? -amount : amount,
  comment,
];
const MOVES = [
  move('2026-10-01 10:00:05', 'Внесение средств', 8_000, null),
  move('2026-10-01 21:55:00', 'Вынесение', 2_000, 'kaspi'),
  move('2026-10-01 21:58:00', 'Вынесение', 1_500, 'zp Оператор 1'),
  move('2026-10-01 22:01:30', 'Внесение средств', 10_000, null),
  move('2026-10-02 09:59:00', 'Вынесение', 3_000, 'kaspi'),
  move('2026-10-02 09:59:30', 'Вынесение', 500, 'obed'),
  move('2026-10-02 09:59:30', 'Вынесение', 500, 'obed'),
];
const TX = [['Клуб 1', '01.10.2026-02.10.2026', xlTime('2026-10-01 12:00:00'), 'T1', 'Покупка чека', 5_500, 'Наличный расчет']] as SampleValue[][];

let fake: SenetFake;
let w: OpsWorld;
let files: FileStore;
let now: Date;
let sessions: SampleValue[][];
let moves: SampleValue[][];
let sync: SenetSync;
let connectionId: number;
/** Одни и те же строки — те же байты: zip писателя хранит время создания, а забор не пишет повтор по sha256. */
const samples = new Map<unknown, Buffer>();
const sample = (kind: Parameters<typeof senetSample>[0], rows: SampleValue[][]) => samples.get(rows) ?? samples.set(rows, senetSample(kind, rows)).get(rows)!;
let officeId: number;

beforeEach(async () => {
  sessions = [shiftA, shiftB];
  moves = [...MOVES];
  fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    report: (type) =>
      type === 'cashdesk_session' ? sample('sessions', sessions) : type === 'income_outcome' ? sample('cashMoves', moves) : sample('transactions', TX),
  });
  now = new Date('2026-10-02T06:00:00.000Z');
  w = await opsWorld(now.toISOString(), { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const base = `/api/v1/companies/${w.cid}/senet`;
  connectionId = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  const kaspi = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id;
  officeId = (
    await w.post(`${base}/connections/${connectionId}/offices`, {
      senetOfficeId: 1,
      cashDeskId: 1,
      enabled: true,
      projectId: w.project,
      cashAccountId: w.kzt,
      kaspiAccountId: kaspi,
      incomeCategoryId: w.income,
      historyFrom: HISTORY_FROM,
    })
  ).office.id;
  const db = w.h.t.db;
  const config = w.h.t.config;
  files = createLocalStore(path.join(config.dataDir, 'files'));
  const connections = createSenetConnections({ db, audit: createAuditService(db), config, secrets: () => loadSecrets(config), now: () => now });
  sync = createSenetSync({ db, connections, files, timezone: config.timezone, now: () => now, sleep: async () => {} });
});
afterEach(async () => {
  await w.h.t.cleanup();
  await fake.close();
});

const q = (text: string, ...p: unknown[]) => w.h.t.q(text, ...p);
const gets = (type: string) => fake.requests.filter((r) => r.method === 'GET' && r.query.type === type);

/** Забор смен и выемок (план 2026-11-02-senet-autopost, задача 6). */
describe('забор Senet', () => {
  it('первый забор: окно с «Загружать с даты», смены с выручкой, выемки по окнам смен, сырые файлы, журнал забора', async () => {
    const [run] = await sync.run({ trigger: 'manual', connectionId });
    expect(run).toMatchObject({ result: 'ok', error: null, budgetExceeded: false });
    expect(gets('cashdesk_session')[0]!.query).toMatchObject({ from_date: HISTORY_FROM, to_date: now.toISOString() });
    expect(gets('income_outcome')[0]!.query.from_date).toBe('2026-09-30T04:00:00.000Z');

    const shifts = await q('SELECT opened_at, closed_at, end_balance, cash_in, cash_out, revenue, revenue_tx FROM senet_shifts ORDER BY opened_at');
    expect(shifts).toEqual([
      { opened_at: '2026-10-01T05:00:00.000Z', closed_at: '2026-10-01T17:00:00.000Z', end_balance: 1_000_000, cash_in: 800_000, cash_out: 350_000, revenue: 550_000, revenue_tx: 550_000 },
      { opened_at: '2026-10-01T17:01:00.000Z', closed_at: '2026-10-02T05:00:00.000Z', end_balance: 1_200_000, cash_in: 1_000_000, cash_out: 400_000, revenue: 600_000, revenue_tx: null },
    ]);
    const perShift = await q('SELECT s.opened_at o, COUNT(m.id) n FROM senet_cash_moves m JOIN senet_shifts s ON s.id = m.shift_id GROUP BY s.opened_at ORDER BY s.opened_at');
    expect(perShift.map((r) => Number(r.n))).toEqual([3, 4]);
    const obed = await q("SELECT senet_ref FROM senet_cash_moves WHERE comment = 'obed' ORDER BY senet_ref");
    expect(obed.map((r) => String(r.senet_ref).split('|').at(-1))).toEqual(['1', '2']);

    const raw = await q("SELECT report, file_key FROM senet_raw WHERE report IN ('sessions', 'cashMoves', 'transactions') ORDER BY report");
    expect(raw.map((r) => r.report)).toEqual(['cashMoves', 'sessions', 'transactions']);
    expect((await files.get(String(raw[0]!.file_key)))!.subarray(0, 2).toString()).toBe('PK');
    const [conn] = await q('SELECT last_sync_at, status FROM senet_connections');
    expect(conn).toEqual({ last_sync_at: now.toISOString(), status: 'ok' });
    expect(await q('SELECT trigger, result FROM senet_sync_runs')).toEqual([{ trigger: 'manual', result: 'ok' }]);
  });

  it('повторный забор: окно с «последний забор − 26 ч», дублей нет, исчезнувшая выемка отмечена', async () => {
    await sync.run({ trigger: 'manual', connectionId });
    now = new Date('2026-10-02T12:00:00.000Z');
    moves = MOVES.filter((m) => m[5] !== 'zp Оператор 1');
    await sync.run({ trigger: 'hourly' });
    expect(gets('cashdesk_session').at(-1)!.query.from_date).toBe('2026-10-01T04:00:00.000Z');
    expect((await q('SELECT COUNT(*) n FROM senet_shifts'))[0]!.n).toBe(2);
    expect((await q('SELECT COUNT(*) n FROM senet_cash_moves'))[0]!.n).toBe(7);
    expect((await q("SELECT COUNT(*) n FROM senet_raw WHERE report IN ('sessions', 'cashMoves', 'transactions')"))[0]!.n).toBe(4);
    const flagged = (await q('SELECT comment, missing_in_senet m FROM senet_cash_moves')).filter((r) => Boolean(r.m)).map((r) => r.comment);
    expect(flagged).toEqual(['zp Оператор 1']);
  });

  it('открытая смена: забирается с пустым концом, выемки — к ней; после закрытия — та же смена', async () => {
    sessions = [shiftA, shiftB, ['Клуб 1', 'Клуб 1', xlTime('2026-10-02 10:01:00'), 'Сотрудник А', null, null, 12_000, 12_000, 0]];
    moves = [...MOVES, move('2026-10-02 10:01:10', 'Внесение средств', 12_000, null)];
    await sync.run({ trigger: 'manual', connectionId });
    const open = await q('SELECT id, closed_at FROM senet_shifts WHERE opened_at = ?', '2026-10-02T05:01:00.000Z');
    expect(open[0]!.closed_at).toBeNull();
    expect((await q('SELECT COUNT(*) n FROM senet_cash_moves WHERE shift_id = ?', open[0]!.id))[0]!.n).toBe(1);

    now = new Date('2026-10-04T12:00:00.000Z');
    sessions = [shiftA, shiftB, ['Клуб 1', 'Клуб 1', xlTime('2026-10-02 10:01:00'), 'Сотрудник А', xlTime('2026-10-02 22:00:00'), 'Сотрудник А', 15_000, 15_000, 0]];
    await sync.run({ trigger: 'hourly' });
    // окно начинается не позже открытия незакрытой смены
    expect(gets('cashdesk_session').at(-1)!.query.from_date! <= '2026-10-02T05:01:00.000Z').toBe(true);
    const closed = await q('SELECT id, closed_at FROM senet_shifts WHERE opened_at = ?', '2026-10-02T05:01:00.000Z');
    expect(closed).toEqual([{ id: open[0]!.id, closed_at: '2026-10-02T17:00:00.000Z' }]);
  });

  it('401 после входа — key_rejected; часовой забор его не опрашивает; статус для баннера', async () => {
    fake.report = () => ({ status: 401, body: '{}', contentType: 'application/json' });
    const [run] = await sync.run({ trigger: 'manual', connectionId });
    expect(run!.result).toBe('failed');
    expect(await q('SELECT status, last_error FROM senet_connections')).toEqual([{ status: 'key_rejected', last_error: 'Senet не принял данные входа. Обновите их в настройках подключения' }]);
    const before = fake.requests.length;
    expect(await sync.run({ trigger: 'hourly' })).toEqual([]);
    expect(fake.requests.length).toBe(before);
    expect(await sync.status(w.cid)).toEqual({ rejected: [{ connectionId, name: 'К' }] });
  });

  it('HTML вместо xlsx — partial, файл сохранён, смены не записаны', async () => {
    fake.report = (type) => (type === 'income_outcome' ? { status: 200, body: '<html>вход</html>', contentType: 'text/html' } : senetSample('sessions', sessions));
    const [run] = await sync.run({ trigger: 'manual', connectionId });
    expect(run!.result).toBe('partial');
    expect(run!.error).toBe('Отчёт «income_outcome» пришёл в незнакомом формате — сохранён для разбора');
    const raw = await q("SELECT file_key FROM senet_raw WHERE report = 'cashMoves'");
    expect((await files.get(String(raw[0]!.file_key)))!.toString()).toContain('html');
    expect((await q('SELECT COUNT(*) n FROM senet_shifts'))[0]!.n).toBe(0);
  });

  it('время вышло — клубы пропущены, partial с текстом', async () => {
    const [run] = await sync.run({ trigger: 'cron', deadline: Date.now() - 1 });
    expect(run).toMatchObject({ result: 'partial', budgetExceeded: true, error: 'Не уложились во время — продолжим через час' });
    expect(fake.requests).toHaveLength(0);
  });

  it('«Загрузить за период» режет окно на отрезки по 7 дней', async () => {
    now = new Date('2026-10-20T00:00:00.000Z');
    const [run] = await sync.run({ trigger: 'period', connectionId, from: '2026-10-01T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z' });
    expect(run!.counts.chunks).toBe(3);
    expect(gets('cashdesk_session').map((r) => [r.query.from_date, r.query.to_date])).toEqual([
      ['2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z'],
      ['2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
      ['2026-10-15T00:00:00.000Z', '2026-10-16T00:00:00.000Z'],
    ]);
  }, 60_000);

  it('выключенный клуб: «Загрузить за период» забирает историю, ничего не проводя', async () => {
    await q('UPDATE senet_offices SET enabled = ?', onPg ? false : 0);
    const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/senet/connections/${connectionId}/sync`, { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T06:00:00.000Z' });
    expect(res.json().runs[0]).toMatchObject({ result: 'ok', error: null, counts: { chunks: 1, done: 1, shifts: 2 } });
    expect(Number((await q('SELECT COUNT(*) n FROM senet_postings'))[0]!.n)).toBe(0);
  }, 60_000);

  it('«Обновить сейчас» без включённых клубов — объясняет, что сделать', async () => {
    await q('UPDATE senet_offices SET enabled = ?', onPg ? false : 0);
    const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/senet/connections/${connectionId}/sync`, {});
    expect(res.json().runs[0]).toMatchObject({ result: 'ok', counts: { chunks: 0 } });
    expect(res.json().runs[0].error).toBe('Ни один клуб не включён — забирать нечего. Включите клуб в «Изменить» или загрузите историю через «Загрузить за период»');
    expect(gets('cashdesk_session')).toEqual([]);
  });

  it('маршруты: «Обновить сейчас», «Загрузить за период» не больше 366 дней, ход запуска, статус', async () => {
    const base = `/api/v1/companies/${w.cid}/senet`;
    const res = await w.h.req('POST', `${base}/connections/${connectionId}/sync`, {});
    expect(res.statusCode).toBe(200);
    const [run] = res.json().runs;
    expect(run).toMatchObject({ result: 'ok', counts: { chunks: 1, done: 1 } });
    const got = await w.h.req('GET', `${base}/sync-runs/${run.runId}`);
    expect(got.json().run).toMatchObject({ trigger: 'manual', result: 'ok', counts: { chunks: 1 } });
    const long = await w.h.req('POST', `${base}/connections/${connectionId}/sync`, { from: '2025-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z' });
    expect(long.statusCode).toBe(400);
    expect(long.json().error.fields.to).toBe('Не больше 366 дней за раз');
    expect((await w.h.req('GET', `${base}/status`)).json()).toEqual({ rejected: [] });
  });

  it('сырые файлы старше 90 дней удаляются вместе с записью', async () => {
    await sync.run({ trigger: 'manual', connectionId });
    const [old] = await q("SELECT id, file_key FROM senet_raw WHERE report IN ('sessions', 'cashMoves', 'transactions') ORDER BY id");
    await q("UPDATE senet_raw SET fetched_at = '2026-06-01T00:00:00.000Z' WHERE id = ?", old!.id);
    expect(await cleanupSenetRaw(w.h.t.db, files, now)).toBe(1);
    expect(await files.get(String(old!.file_key))).toBeNull();
    expect((await q("SELECT COUNT(*) n FROM senet_raw WHERE report IN ('sessions', 'cashMoves', 'transactions')"))[0]!.n).toBe(2);
  });
});
