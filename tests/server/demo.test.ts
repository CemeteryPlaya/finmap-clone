import { afterEach, describe, expect, it } from 'vitest';
import { rng, seedDemo } from '../../scripts/lib/demo';
import { seedCurrencies } from '../../src/server/db/seed';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createTestDb } from '../helpers/test-db';

const dbs: ReturnType<typeof createTestDb>[] = [];
afterEach(() => {
  while (dbs.length) dbs.pop()!.cleanup();
});

const NOW = new Date('2026-10-06T12:00:00.000Z');

function freshDb() {
  const t = createTestDb();
  dbs.push(t);
  seedCurrencies(t.db);
  t.sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('demo','Демо','h','x')").run();
  return t;
}

/** Независимый пересчёт балансов в JS по сырым строкам операций. */
function jsBalances(t: ReturnType<typeof createTestDb>, companyId: number): Map<number, number> {
  const m = new Map<number, number>();
  const accounts = t.sqlite.prepare('SELECT id, starting_balance s FROM accounts WHERE company_id = ?').all(companyId) as { id: number; s: number }[];
  for (const a of accounts) m.set(a.id, a.s);
  const ops = t.sqlite
    .prepare("SELECT type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE company_id = ? AND deleted_at IS NULL AND status = 'actual'")
    .all(companyId) as { type: string; a: number; amount: number; t: number | null; ta: number | null }[];
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

  it('состав по §10, доли разбиений и переводов, SQL-баланс = пересчёт в JS (§12)', () => {
    const t = freshDb();
    const r = seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 500 });
    expect(r).toMatchObject({ companies: 3, projects: 5, accounts: 8, counterparties: 150, operations: 500 });
    expect(r.categories).toBeGreaterThanOrEqual(60);
    const n = (sql: string) => (t.sqlite.prepare(sql).get() as { n: number }).n;
    const split = n('SELECT COUNT(*) n FROM (SELECT operation_id FROM operation_lines GROUP BY operation_id HAVING COUNT(*) > 1)');
    const transfers = n("SELECT COUNT(*) n FROM operations WHERE type = 'transfer'");
    expect(split / 500).toBeGreaterThan(0.08);
    expect(split / 500).toBeLessThan(0.25);
    expect(transfers / 500).toBeGreaterThan(0.04);
    expect(transfers / 500).toBeLessThan(0.16);
    expect(n("SELECT COUNT(*) n FROM accounts WHERE currency = 'USD'")).toBeGreaterThanOrEqual(2);

    const ledger = createLedgerBalances(t.db);
    for (const c of t.sqlite.prepare('SELECT id FROM companies').all() as { id: number }[]) {
      const js = jsBalances(t, c.id);
      const balances = ledger.companyBalances(c.id);
      expect(balances).toHaveLength(js.size); // цикл не должен проходить вхолостую
      for (const b of balances) expect(b.balance).toBe(js.get(b.accountId));
    }
  });

  it('детерминированность: два запуска на пустых базах с одной датой дают одинаковые данные; по непустой базе — отказ без записей (Review Focus 4)', () => {
    const a = freshDb();
    const b = freshDb();
    seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    seedDemo({ db: b.db, timezone: 'Asia/Almaty', now: NOW, operations: 300 });
    const digest = (t: ReturnType<typeof createTestDb>) =>
      JSON.stringify(t.sqlite.prepare('SELECT type, paid_at, account_id, amount, to_amount, base_amount FROM operations ORDER BY id').all());
    expect(digest(a)).toBe(digest(b));

    const before = (a.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;
    expect(() => seedDemo({ db: a.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).toThrow('Демо-набор заливается только в пустую базу');
    expect((a.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n).toBe(before);
  });

  it('сбой посередине откатывает всё: база пуста и пригодна для повторного запуска', () => {
    const t = freshDb();
    t.sqlite.exec("CREATE TEMP TRIGGER stop_ops BEFORE INSERT ON operations WHEN (SELECT COUNT(*) FROM operations) >= 20 BEGIN SELECT RAISE(ABORT, 'stop'); END");
    expect(() => seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 50 })).toThrow('stop');
    t.sqlite.exec('DROP TRIGGER stop_ops');
    const n = (table: string) => (t.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
    expect([n('companies'), n('operations'), n('exchange_rates'), n('audit_log')]).toEqual([0, 0, 0, 0]);
    expect(seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 50 }).operations).toBe(50);
  });

  it('без пользователя — понятная ошибка', () => {
    const t = createTestDb();
    dbs.push(t);
    seedCurrencies(t.db);
    expect(() => seedDemo({ db: t.db, timezone: 'Asia/Almaty', now: NOW, operations: 10 })).toThrow('Сначала создайте пользователя');
  });
});
