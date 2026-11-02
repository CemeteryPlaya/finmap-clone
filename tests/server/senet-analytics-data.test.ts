import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { onPg } from '../helpers/test-db';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

const KEY = crypto.randomBytes(32).toString('base64');
const PHONE = 77012345612;
const SESSIONS = [
  ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 10:00:00'), 'Сотрудник А', xlTime('2026-10-01 22:00:00'), 'Сотрудник А', 0, 0, 0],
  ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 22:01:00'), 'Сотрудник А', xlTime('2026-10-02 10:00:00'), 'Сотрудник А', 0, 0, 0],
] as SampleValue[][];
const sold = (local: string, item: string, qty: number | null, amount: number, status = 'Использовано'): SampleValue[] => [xlTime(local), item, qty, amount, 'Наличный расчет', status, null];
const check = (local: string, code: string, phone: number | null): SampleValue[] => ['Клуб 1', 'Клуб 1', 'Сотрудник А', code, 'Да', 1000, 7, 'гость1', phone, xlTime(local)];
const refill = (local: string, phone: number | null): SampleValue[] => ['Клуб 1', xlTime(local), 'гость1', 'General', phone, 500, 7];

let x: { w: OpsWorld; fake: SenetFake; base: string; conn: number; data: Record<string, SampleValue[][]> } | null = null;
afterEach(async () => {
  await x?.w.h.t.cleanup();
  await x?.fake.close();
  x = null;
});

async function setup() {
  const data: Record<string, SampleValue[][]> = {
    sold: [sold('2026-10-01 12:00:00', 'Напиток 1', 2, 1500), sold('2026-10-01 23:00:00', 'A1B2', null, 1000), sold('2026-10-02 09:00:00', 'Напиток 1', 1, 750, 'Возвраты')],
    checks: [check('2026-10-01 20:00:00', 'C1', PHONE), check('2026-10-02 01:00:00', 'C2', null)],
    refills: [refill('2026-10-01 20:00:00', PHONE)],
  };
  // отчёт по суткам: строки окна запроса
  const inWindow = (rows: SampleValue[][], col: number, q: Record<string, string>) =>
    rows.filter((r) => {
      const ms = Math.round(((r[col] as { value: number }).value - 25_569) * 86_400_000) - 5 * 3_600_000;
      return ms >= Date.parse(q.from_date!) && ms < Date.parse(q.to_date!);
    });
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    ownAnalytics: true,
    report: (type, q) =>
      type === 'cashdesk_session'
        ? senetSample('sessions', SESSIONS)
        : type === 'sold_check_items'
          ? senetSample('soldItems', inWindow(data.sold!, 0, q))
          : type === 'checks'
            ? senetSample('checks', inWindow(data.checks!, 9, q))
            : type === 'refill'
              ? senetSample('refills', inWindow(data.refills!, 1, q))
              : senetSample(type === 'income_outcome' ? 'cashMoves' : 'transactions', []),
  });
  const w = await opsWorld('2026-10-02T06:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const base = `/api/v1/companies/${w.cid}/senet`;
  const conn = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  await w.post(`${base}/connections/${conn}/offices`, { senetOfficeId: 1, enabled: false });
  await w.h.t.q("UPDATE senet_offices SET enabled = ?, history_from = '2026-10-01T04:00:00.000Z'", onPg ? true : 1);
  x = { w, fake, base, conn, data };
  return x;
}
const sync = async () => (await x!.w.h.req('POST', `${x!.base}/connections/${x!.conn}/sync`, {})).json().runs[0];
const count = async (table: string) => Number((await x!.w.h.t.q(`SELECT COUNT(*) n FROM ${table}`))[0]!.n);

/** Данные для склада и аналитики (спецификация 2026-11-02-senet-autopost, §9.3; план, задача 15). */
describe('данные для аналитики', () => {
  it('продажи, чеки и пополнения — окнами по суткам; продажа — к своей смене; телефон — только хеш и маска', async () => {
    await setup();
    expect((await sync()).result).toBe('ok');
    const days = x!.fake.requests.filter((r) => r.query.type === 'sold_check_items').map((r) => r.query.from_date);
    expect(days).toEqual(['2026-10-01T04:00:00.000Z', '2026-10-02T04:00:00.000Z']);
    const items = await x!.w.h.t.q('SELECT s.item, s.qty, s.amount, s.refund, sh.opened_at FROM senet_sold_items s LEFT JOIN senet_shifts sh ON sh.id = s.shift_id ORDER BY s.at');
    expect(items.map((i) => [i.item, i.qty, i.amount, Boolean(i.refund), i.opened_at])).toEqual([
      ['Напиток 1', 2000, 150_000, false, '2026-10-01T05:00:00.000Z'],
      ['A1B2', null, 100_000, false, '2026-10-01T17:01:00.000Z'],
      ['Напиток 1', 1000, 75_000, true, '2026-10-01T17:01:00.000Z'],
    ]);
    expect([await count('senet_checks'), await count('senet_refills')]).toEqual([2, 1]);
    for (const table of ['senet_checks', 'senet_refills']) {
      const rows = await x!.w.h.t.q(`SELECT * FROM ${table}`);
      expect(JSON.stringify(rows)).not.toContain('7012345612');
    }
    const masked = await x!.w.h.t.q('SELECT phone_hash h, phone_mask m FROM senet_checks ORDER BY at');
    expect(masked[0]).toMatchObject({ m: '+7 *** ** 12' });
    expect(String(masked[0]!.h)).toMatch(/^[0-9a-f]{64}$/);
    expect(masked[1]).toEqual({ h: null, m: null });
  });

  it('повторный забор окна заменяет строки: дублей нет, исчезнувшая строка исчезает', async () => {
    await setup();
    await sync();
    x!.data.checks = [x!.data.checks![0]!];
    await sync();
    expect([await count('senet_sold_items'), await count('senet_checks'), await count('senet_refills')]).toEqual([3, 1, 1]);
  });

  it('ровно 2000 строк за сутки — Senet обрезал отчёт: запуск partial с текстом', async () => {
    await setup();
    x!.data.sold = Array.from({ length: 2000 }, (_, i) => sold(`2026-10-01 12:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, `Товар ${i}`, 1, 100));
    const run = await sync();
    expect(run.result).toBe('partial');
    expect(run.error).toBe('Отчёт «sold_check_items» за 01.10.2026 пришёл ровно на 2000 строк — Senet мог его обрезать');
  });
});
