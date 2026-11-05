import crypto from 'node:crypto';
import { expect } from 'vitest';
import { opsWorld, type OpsWorld } from './ops';
import { startSenetFake, type SenetFake } from './senet-fake';
import { senetSample, xlTime, type SampleValue } from './senet-samples';

/**
 * Клуб с подключением Senet и забором 01–02.11 (спецификация «Аналитика клуба»; план АК-1, задачи 5 и 9). Деньги образцов —
 * тенге, ответов API — тиыны. Клуб 1 привязан к проекту «Клуб 3» (pcCount 10), клуб 2 — без проекта.
 */
export const KEY = crypto.randomBytes(32).toString('base64');
export const session = (open: string, close: string, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(open), 'Сотрудник А', xlTime(close), 'Сотрудник А', end, end, 0];
export const move = (local: string, type: 'Внесение средств' | 'Вынесение', amount: number, comment: string | null): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', type, type === 'Вынесение' ? -amount : amount, comment];
export const tx = (local: string, amount: number, payment: string): SampleValue[] => ['Клуб 1', '01.11.2026-02.11.2026', xlTime(local), `T${local}`, 'Покупка чека', amount, payment];
export const sold = (local: string, item: string, qty: number | null, amount: number): SampleValue[] => [xlTime(local), item, qty, amount, 'Наличный расчет', 'Использовано', null];
export const refill = (local: string, type: string, amount: number): SampleValue[] => ['Клуб 1', xlTime(local), 'гость1', type, 77012345612, amount, 7];
export const ticket = (local: string, name: string, price: number): SampleValue[] => ['гость1', '+77012345612', name, xlTime(local), price, 180];
export const load = (open: string, close: string, zone: string, ws: number, login: string, debited: number): SampleValue[] => ['Клуб 1', xlTime(open), xlTime(close), zone, ws, login, '+77012345612', 19, 'Тариф 1', debited, 0, 0.0625];

// смены: дневная 01.11, ночная 01.11 22:01 — 02.11 10:00, дневная 02.11; выручка смены = остаток − внесение + выемки
export const SESSIONS = [session('2026-11-01 10:00:00', '2026-11-01 22:00:00', 3_000), session('2026-11-01 22:01:00', '2026-11-02 10:00:00', 4_000), session('2026-11-02 10:01:00', '2026-11-02 22:00:00', 5_000)];
export const MOVES = [move('2026-11-01 10:00:05', 'Внесение средств', 1_000, null), move('2026-11-01 22:01:30', 'Внесение средств', 3_000, null), move('2026-11-02 10:01:30', 'Внесение средств', 4_000, null), move('2026-11-02 21:00:00', 'Вынесение', 500, 'obed')];
export const CLUB_DATA = {
  tx: [tx('2026-11-01 12:00:00', 2_000, 'Наличный расчет'), tx('2026-11-01 23:00:00', 1_000, 'Безналичный расчет'), tx('2026-11-02 15:00:00', 1_500, 'Наличный расчет')],
  sold: [sold('2026-11-01 12:00:00', 'Напиток 1', 2, 1_500), sold('2026-11-01 12:00:00', 'A1B2', null, 1_000), sold('2026-11-02 15:00:00', 'Напиток 1', 1, 750)],
  refills: [refill('2026-11-01 20:00:00', 'General', 500), refill('2026-11-02 11:00:00', 'Check', 1_000)],
  tickets: [ticket('2026-11-01 15:00:00', '2+1 Standart', 750), ticket('2026-11-02 16:00:00', '3+2', 1_500)],
  load: [load('2026-11-01 20:00:00', '2026-11-01 21:30:00', 'VIP', 7, 'гость1', 900), load('2026-11-01 23:30:00', '2026-11-02 01:00:00', 'Общий', 3, 'гость2', 600), load('2026-11-02 14:00:00', '2026-11-02 15:00:00', 'Общий', 3, 'гость2', 400)],
};
export const T = (tenge: number) => tenge * 100;


export interface ClubWorld {
  w: OpsWorld;
  fake: SenetFake;
  c: string;
  conn: number;
  club: number;
  office: number;
  close(): Promise<void>;
}

/** Строки окна запроса: время — в колонке col (число Excel в часах клуба, UTC+5). */
export const inWindow = (rows: SampleValue[][], col: number, q: Record<string, string>) =>
  rows.filter((r) => {
    const ms = Math.round(((r[col] as { value: number }).value - 25_569) * 86_400_000) - 5 * 3_600_000;
    return ms >= Date.parse(q.from_date!) && ms < Date.parse(q.to_date!);
  });

export async function clubWorld(data = CLUB_DATA): Promise<ClubWorld> {
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    ownAnalytics: true,
    report: (type, q) => {
      const pick: Record<string, () => Buffer> = {
        cashdesk_session: () => senetSample('sessions', SESSIONS),
        income_outcome: () => senetSample('cashMoves', MOVES),
        cashdesk_transactions: () => senetSample('transactions', inWindow(data.tx, 2, q)),
        sold_check_items: () => senetSample('soldItems', inWindow(data.sold, 0, q)),
        refill: () => senetSample('refills', inWindow(data.refills, 1, q)),
        office_load_by_zones: () => senetSample('load', inWindow(data.load, 1, q)),
        tickets: () => senetSample('tickets', inWindow(data.tickets, 3, q)),
      };
      return (pick[type] ?? (() => senetSample(type === 'checks' ? 'checks' : type === 'shop_quantity' ? 'stock' : 'goodsMoves', [])))();
    },
  });
  const w = await opsWorld('2026-11-03T06:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const c = `/api/v1/companies/${w.cid}`;
  const club = (await w.post(`${c}/projects`, { name: 'Клуб 3', templateKey: 'computer-club', templateParams: { pcCount: 10 } })).project.id as number;
  const conn = (await w.post(`${c}/senet/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id as number;
  // клуб выключен, но привязан к проекту — учитывается; второй клуб без проекта — нет (Review Focus 2)
  const office = (await w.post(`${c}/senet/connections/${conn}/offices`, { senetOfficeId: 1, cashDeskId: 1, enabled: false, projectId: club })).office.id as number;
  await w.post(`${c}/senet/connections/${conn}/offices`, { senetOfficeId: 2, cashDeskId: 1, enabled: false });
  const res = await w.h.req('POST', `${c}/senet/connections/${conn}/sync`, { from: '2026-10-31T19:00:00.000Z', to: '2026-11-02T19:00:00.000Z' });
  expect(res.json().runs[0]).toMatchObject({ result: 'ok' });
  return { w, fake, c, conn, club, office, close: async () => { await w.h.t.cleanup(); await fake.close(); } };
}
