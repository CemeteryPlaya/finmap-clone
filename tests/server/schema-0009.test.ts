import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR, runMigrations } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('миграция 0009 (индекс даты сделки, план А-2)', () => {
  it('индекс operations (company_id, accrual_date); выборка «Прибыли» по дате сделки идёт по индексам, а не перебором таблицы', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig9-'));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[9]!.tag).toMatch(/^0009_/);
    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    runMigrations(db);
    const cols = sqlite.prepare("PRAGMA index_info('operations_company_accrual_idx')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(['company_id', 'accrual_date']);
    const plan = (
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT o.id FROM operations o WHERE o.company_id = 1 AND
             ((o.accrual_date IS NULL AND o.paid_at >= '2026-01-01' AND o.paid_at < '2027-01-01') OR (o.accrual_date >= '2026-01-01' AND o.accrual_date <= '2026-12-31'))`,
        )
        .all() as { detail: string }[]
    ).map((r) => r.detail);
    expect(plan.join('\n')).toMatch(/operations_company_accrual_idx/);
    expect(plan.join('\n')).not.toMatch(/^SCAN o$/m);
    sqlite.close();
  });
});
