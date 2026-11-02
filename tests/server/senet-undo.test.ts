import { describe, expect, it } from 'vitest';
import { assertSenetRestorable } from '../../src/server/modules/senet/links';
import { opsWorld } from '../helpers/ops';

/**
 * «Отмена» удаления операции Senet (спецификация 2026-11-02-senet-autopost, §5.3, П3 плана): если модуль уже провёл
 * замену, восстановить старую нельзя — иначе выемка окажется в журнале дважды.
 */
describe('восстановление операции Senet', () => {
  it('замена есть — 409 с текстом, в том числе через «Восстановить»; замены нет — можно', async () => {
    const w = await opsWorld();
    try {
      const t = w.h.t;
      const op = async () => (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-02T00:00:00Z', accountId: w.kzt, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] })).operation.id as number;
      const [old, replacement, plain] = [await op(), await op(), await op()];
      await t.q("INSERT INTO senet_connections (id, company_id, name, org, auth_method, credentials_secret, credentials_hint, created_at, created_by) VALUES (900, ?, 'К', 'club-demo', 'token', 's', 'h', 'x', 1)", w.cid);
      await t.q('INSERT INTO senet_offices (id, connection_id, senet_office_id) VALUES (900, 900, 1)');
      await t.q("INSERT INTO senet_shifts (id, office_id, opened_at, end_balance, updated_at) VALUES (900, 900, 'a', 0, 'x')");
      await t.q("INSERT INTO senet_cash_moves (shift_id, senet_ref, kind, amount, at, operation_id, prev_operation_id) VALUES (900, 'r1', 'out', 1, 'x', ?, ?)", replacement, old);
      await t.q("INSERT INTO senet_postings (shift_id, kind, operation_id, amount, created_at) VALUES (900, 'cash', ?, 1, 'x')", plain);

      await expect(assertSenetRestorable(t.db, old)).rejects.toMatchObject({ status: 409, message: 'Senet уже провёл эту выемку заново — удалите новую операцию' });
      await expect(assertSenetRestorable(t.db, plain)).resolves.toBeUndefined();

      await w.h.req('DELETE', `${w.ops}/${old}`);
      const refused = await w.h.req('POST', `${w.ops}/${old}/restore`);
      expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'SENET_REPLACED']);
      await w.h.req('DELETE', `${w.ops}/${plain}`);
      expect((await w.h.req('POST', `${w.ops}/${plain}/restore`)).statusCode).toBe(200);
    } finally {
      await w.h.t.cleanup();
    }
  });
});
