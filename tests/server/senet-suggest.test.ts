import { afterEach, describe, expect, it } from 'vitest';
import { suggest } from '../../src/server/modules/senet/suggest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

/** Предложения пункта очереди (спецификация 2026-11-02-senet-autopost, §6.3; план, задача 12). */
describe('suggest', () => {
  it('подсказка правила, затем частая пара по общим словам, затем по той же сумме за 30 дней; не больше трёх, без повторов', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const t = w.h.t;
    const cat = async (name: string) => (await w!.post(`/api/v1/companies/${w!.cid}/categories`, { kind: 'expense', name })).category.id as number;
    const [water, cleaning, repair] = [await cat('Вода'), await cat('Уборка'), await cat('Ремонт')];
    await t.q("INSERT INTO senet_connections (id, company_id, name, org, auth_method, credentials_secret, credentials_hint, created_at, created_by) VALUES (900, ?, 'К', 'club-demo', 'token', 's', 'h', 'x', 1)", w.cid);
    await t.q('INSERT INTO senet_offices (id, connection_id, senet_office_id) VALUES (900, 900, 1)');
    await t.q("INSERT INTO senet_shifts (id, office_id, opened_at, end_balance, updated_at) VALUES (900, 900, 'a', 0, 'x')");
    let n = 0;
    const posted = async (comment: string, amount: number, categoryId: number, at = '2026-10-10T10:00:00.000Z') => {
      const op = (await w!.post(w!.ops, { type: 'expense', paidAt: '2026-10-10T10:00:00.000Z', accountId: w!.kzt, amount, lines: [{ categoryId, amount }] })).operation.id;
      await t.q("INSERT INTO senet_cash_moves (shift_id, senet_ref, kind, amount, at, comment, operation_id) VALUES (900, ?, 'out', ?, ?, ?, ?)", `r${++n}`, amount, at, comment, op);
    };
    await posted('вода 19л', 1500, water);
    await posted('вода бутыль', 1500, water);
    await posted('вода', 1600, cleaning);
    await posted('кран', 7000, repair);
    await posted('кран кухня', 7000, repair);
    // выемка старше 30 дней (у операции дата своя)
    await posted('старое', 7000, cleaning, '2026-09-01T10:00:00.000Z');

    const list = await suggest(t.db, { companyId: w.cid, comment: 'Вода, привезли', amount: 7000, at: '2026-10-20T10:00:00.000Z', hint: { categoryId: cleaning } });
    expect(list.map((s) => [s.categoryId, s.counterpartyId])).toEqual([
      [cleaning, null],
      [water, null],
      [repair, null],
    ]);
    expect(list.map((s) => s.label)).toEqual(['Уборка', 'Вода', 'Ремонт']);

    const plain = await suggest(t.db, { companyId: w.cid, comment: 'что-то', amount: 1, at: '2026-10-20T10:00:00.000Z', hint: null });
    expect(plain).toEqual([]);
  });
});
