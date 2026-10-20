import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDemo } from '../../scripts/lib/demo';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness | undefined;
afterEach(async () => {
  await h?.t.cleanup();
  h = undefined;
});

const NOW = '2026-10-06T12:00:00.000Z';

interface Item {
  id: number;
  accountId: number;
  toAccountId: number | null;
  balanceAfter: number | null;
  toBalanceAfter: number | null;
}

describe('журнал на демо-наборе (§10, §12)', () => {
  it('курсор проходит все операции ровно по разу в порядке (paidAt, id); остатки после операции = независимый пересчёт в JS; выгрузка — все строки', async () => {
    h = await createApi(NOW);
    await seedDemo({ db: h.t.db, timezone: 'Asia/Almaty', now: new Date(NOW), operations: 300 });
    const cid = ((await h.t.q('SELECT id FROM companies ORDER BY id LIMIT 1'))[0] as { id: number }).id;
    const ops = `/api/v1/companies/${cid}/operations`;

    // все страницы журнала
    const seen: Item[] = [];
    let cursor: string | null = null;
    do {
      const res = await h.req('GET', `${ops}?limit=37${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode, res.body).toBe(200);
      const page = res.json() as { items: Item[]; nextCursor: string | null };
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const expected = (await h.t.q('SELECT id FROM operations WHERE company_id = ? AND deleted_at IS NULL ORDER BY paid_at DESC, id DESC', cid)) as { id: number }[];
    expect(expected.length).toBeGreaterThan(100);
    // проверка не должна терять переводы и удалённые операции
    const count = async (where: string) => ((await h!.t.q(`SELECT COUNT(*) n FROM operations WHERE company_id = ? AND ${where}`, cid))[0] as { n: number }).n;
    expect(await count("type = 'transfer' AND deleted_at IS NULL")).toBeGreaterThan(0);
    expect(await count('deleted_at IS NOT NULL')).toBeGreaterThan(0);
    expect(seen.map((i) => i.id)).toEqual(expected.map((r) => r.id));

    // независимый пересчёт остатков: история каждого счёта по (paidAt, id) от стартового остатка
    const balance = new Map(
      ((await h.t.q('SELECT id, starting_balance b FROM accounts WHERE company_id = ?', cid)) as { id: number; b: number }[]).map((a) => [a.id, a.b]),
    );
    const rows = (await h.t.q(
        "SELECT id, type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE company_id = ? AND deleted_at IS NULL AND status = 'actual' ORDER BY paid_at, id",
      cid)) as { id: number; type: string; a: number; amount: number; t: number | null; ta: number | null }[];
    const after = new Map<string, number>();
    for (const o of rows) {
      balance.set(o.a, balance.get(o.a)! + (o.type === 'income' ? o.amount : -o.amount));
      after.set(`${o.id}:${o.a}`, balance.get(o.a)!);
      if (o.type === 'transfer') {
        balance.set(o.t!, balance.get(o.t!)! + o.ta!);
        after.set(`${o.id}:${o.t}`, balance.get(o.t!)!);
      }
    }
    for (const i of seen) {
      expect(i.balanceAfter).toBe(after.get(`${i.id}:${i.accountId}`));
      expect(i.toBalanceAfter).toBe(i.toAccountId === null ? null : after.get(`${i.id}:${i.toAccountId}`));
    }
    // последний остаток счёта = его баланс (§4.7)
    for (const b of await createLedgerBalances(h.t.db).companyBalances(cid)) expect(b.balance).toBe(balance.get(b.accountId));

    // выгрузка всей компании в формате Finmap: заголовок + строка на строку операции (у разбитой — несколько, у перевода — одна)
    const xlsx = await h.req('GET', `${ops}/export.xlsx`);
    expect(xlsx.statusCode).toBe(200);
    const sheet = new AdmZip(xlsx.rawPayload).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    const exportedRows = (
      (await h.t.q(
          `SELECT SUM(CASE WHEN o.type = 'transfer' THEN 1 ELSE (SELECT CASE WHEN COUNT(*) > 1 THEN COUNT(*) ELSE 1 END FROM operation_lines l WHERE l.operation_id = o.id) END) n
             FROM operations o WHERE o.company_id = ? AND o.deleted_at IS NULL`,
        cid))[0] as { n: number }
    ).n;
    expect(exportedRows).toBeGreaterThan(expected.length); // в демо-наборе есть разбитые операции
    expect(sheet.match(/<row /g)).toHaveLength(exportedRows + 1);
  });
});
