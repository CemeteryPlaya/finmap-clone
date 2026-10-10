import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

type Entry = { action: string; entityId: number; diff: Record<string, unknown> | null };
const entries = async (): Promise<Entry[]> => (await w.h.req('GET', `/api/v1/companies/${w.cid}/audit?entity=operation&limit=20`)).json().entries;

describe('история операций для панели «История действий» (§3.4 этапа 1.5)', () => {
  it('правка пишет тип; удаление и восстановление — тип, сумму, счёт и дату', async () => {
    w = await opsWorld();
    const op = (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 131700, lines: [{ categoryId: w.expense, amount: 131700 }] })).operation;
    expect((await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'аренда' })).statusCode).toBe(200);
    expect((await w.h.req('DELETE', `${w.ops}/${op.id}`)).statusCode).toBe(200);
    expect((await w.h.req('POST', `${w.ops}/${op.id}/restore`)).statusCode).toBe(200);

    const list = await entries();
    expect(list.map((e) => e.action)).toEqual(['restore', 'delete', 'update', 'create']);
    const [restore, del, update, create] = list;
    expect(create!.diff).toMatchObject({ type: 'expense', amount: 131700, accountId: w.kzt });
    expect(update!.diff).toMatchObject({ type: 'expense', after: { comment: 'аренда' } });
    for (const e of [del!, restore!]) {
      expect(e.diff).toMatchObject({ type: 'expense', amount: 131700, accountId: w.kzt });
      expect(typeof e.diff!.paidAt).toBe('string');
    }
  });
});
