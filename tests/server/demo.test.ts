import { afterEach, describe, expect, it } from 'vitest';
import { rng, seedDemo } from '../../scripts/lib/demo';
import { seedCurrencies } from '../../src/server/db/seed';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createTestDb, type TestDb } from '../helpers/test-db';

const dbs: TestDb[] = [];
afterEach(async () => {
  while (dbs.length) await dbs.pop()!.cleanup();
});

const NOW = new Date('2026-10-06T12:00:00.000Z');

async function freshDb() {
  const t = await createTestDb();
  dbs.push(t);
  await seedCurrencies(t.db);
  await t.q("INSERT INTO users (login, name, password_hash, created_at) VALUES ('demo','Демо','h','x')");
  return t;
}

/** Независимый пересчёт балансов в JS по сырым строкам операций. */
async function jsBalances(t: TestDb, companyId: number): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const accounts = (await t.q('SELECT id, starting_balance s FROM accounts WHERE company_id = ?', companyId)) as { id: number; s: number }[];
  for (const a of accounts) m.set(a.id, a.s);
  const ops = (await t.q("SELECT type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE company_id = ? AND deleted_at IS NULL AND status = 'actual'", companyId)) as { type: string; a: number; amount: number; t: number | null; ta: number | null }[];
  for (const o of ops) {
    m.set(o.a, m.get(o.a)! + (o.type === 'income' ? o.amount : -o.amount));
    if (o.type === 'transfer') m.set(o.t!, m.get(o.t!)! + o.ta!);
  }
  return m;
}

describe('seed:demo', () => {
  it('rng детерминирован', () => {
    const a = rng(7);
    const b = rng(7);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('состав по §10, доли разбиений и переводов, SQL-баланс = пересчёт в JS (§12)', async () => {
    const t = await freshDb();
    const r = await seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 500 });
    expect(r).toMatchObject({ companies: 3, projects: 5, accounts: 8, counterparties: 150, operations: 500 });
    expect(r.categories).toBeGreaterThanOrEqual(60);
    const n = async (sql: string) => ((await t.q(sql))[0] as { n: number }).n;
    const split = await n('SELECT COUNT(*) n FROM (SELECT operation_id FROM operation_lines GROUP BY operation_id HAVING COUNT(*) > 1)');
    const transfers = await n("SELECT COUNT(*) n FROM operations WHERE type = 'transfer'");
    expect(split / 500).toBeGreaterThan(0.08);
    expect(split / 500).toBeLessThan(0.25);
    expect(transfers / 500).toBeGreaterThan(0.04);
    expect(transfers / 500).toBeLessThan(0.16);
    expect(await n("SELECT COUNT(*) n FROM accounts WHERE currency = 'USD'")).toBeGreaterThanOrEqual(2);

    const ledger = createLedgerBalances(t.db);
    for (const c of (await t.q('SELECT id FROM companies')) as { id: number }[]) {
      const js = await jsBalances(t, c.id);
      const balances = await ledger.companyBalances(c.id);
      expect(balances).toHaveLength(js.size); // цикл не должен проходить вхолостую
      for (const b of balances) expect(b.balance).toBe(js.get(b.accountId));
    }
  });

  it('детерминированность: два запуска на пустых базах с одной датой дают одинаковые данные; по непустой базе — отказ без записей (Review Focus 4)', async () => {
    const a = await freshDb();
    const b = await freshDb();
    await seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    await seedDemo({ db: b.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    const digest = async (t: TestDb) =>
      JSON.stringify((await t.q('SELECT type, paid_at, account_id, amount, to_amount, base_amount FROM operations ORDER BY id')));
    expect(await digest(a)).toBe(await digest(b));

    const before = ((await a.q('SELECT COUNT(*) n FROM operations'))[0] as { n: number }).n;
    await expect(seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).rejects.toThrow('Демо-набор заливается только в пустую базу');
    expect(((await a.q('SELECT COUNT(*) n FROM operations'))[0] as { n: number }).n).toBe(before);
  });

  it('сбой посередине откатывает всё: база пуста и пригодна для повторного запуска', async () => {
    const t = await freshDb();
    await t.failOn('stop_ops', { table: 'operations', event: 'INSERT', message: 'stop', when: '(SELECT COUNT(*) FROM operations) >= 20' });
    await expect(seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 50 })).rejects.toThrow('stop');
    await t.dropFail('stop_ops', 'operations');
    const n = async (table: string) => ((await t.q(`SELECT COUNT(*) n FROM ${table}`))[0] as { n: number }).n;
    expect([await n('companies'), await n('operations'), await n('exchange_rates'), await n('audit_log')]).toEqual([0, 0, 0, 0]);
    expect((await seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 50 })).operations).toBe(50);
  });

  it('без пользователя — понятная ошибка', async () => {
    const t = await createTestDb();
    dbs.push(t);
    await seedCurrencies(t.db);
    await expect(seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).rejects.toThrow('Сначала создайте пользователя');
  });
});
