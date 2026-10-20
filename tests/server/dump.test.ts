import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { boundTables } from '../../src/server/db/schema';
import { dumpDatabase, restoreDatabase } from '../../src/server/modules/backup/dump';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Выгрузка всей базы в JSON.gz и загрузка обратно (план 2026-10-20-vercel-postgres, задача 16): бэкап Postgres на Vercel
 * и перенос SQLite → Postgres (задача 17). Идёт на обоих диалектах.
 */

let w: StockWorld | null = null;
let target: TestDb | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  await target?.cleanup();
  w = null;
  target = null;
});

/** Все строки всех таблиц по возрастанию id (или всех колонок), значения — как отдаёт Drizzle. */
async function snapshot(db: TestDb['db']) {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(boundTables())) {
    const rows = (await db.select().from(table as never)) as Record<string, unknown>[];
    out[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe('dump / restore', () => {
  it('туда и обратно: те же строки во всех таблицах; новые строки получают свободные id', async () => {
    w = await stockWorld();
    // данные всех видов: операции со строками и тегом, подкатегория, склад с документами и комплектом, курс
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: 30_000_000_000, categoryId: w.income, tagIds: [w.tag] });
    const sub = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Подаренная', parentId: w.expense })).category.id as number;
    await w.post(w.ops, { type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: w.kzt, amount: 500, categoryId: sub });
    await w.receipt('2026-10-02T10:00:00.000Z', [[w.cola, 4000, 40_000]]);
    await w.combo('Набор', [[w.cola, 1000], [w.chips, 2000]]);
    await w.writeoff('2026-10-03T10:00:00.000Z', [[w.cola, 1000]]);
    const before = await snapshot(w.h.t.db);
    expect(before.operations!.length).toBeGreaterThan(1);

    const dump = await dumpDatabase(w.h.t.db, new Date('2026-10-20T00:00:00Z'));
    const parsed = JSON.parse(zlib.gunzipSync(dump).toString('utf8')) as { format: string; version: number; createdAt: string; tables: Record<string, unknown[]> };
    expect(parsed).toMatchObject({ format: 'finmap-clone-dump', version: 1, createdAt: '2026-10-20T00:00:00.000Z' });
    expect(Object.keys(parsed.tables).sort()).toEqual(Object.keys(boundTables()).sort());

    target = await createTestDb();
    const report = await restoreDatabase(target.db, dump);
    expect(report.rows).toBe(Object.values(parsed.tables).reduce((s, t) => s + t.length, 0));
    expect(await snapshot(target.db)).toEqual(before);

    // последовательности id сдвинуты: вставка без id не конфликтует с перенесёнными строками
    const maxOp = Math.max(...(await target.q<{ id: number }>('SELECT id FROM operations')).map((r) => r.id));
    await target.q("INSERT INTO tags (company_id, name, name_key, order_index, created_at) VALUES (?, 'Новый', 'новый', 99, 'x')", w.cid);
    const maxTag = Math.max(...(await w.h.t.q<{ id: number }>('SELECT id FROM tags')).map((r) => r.id));
    expect((await target.q<{ id: number }>("SELECT id FROM tags WHERE name = 'Новый'"))[0]!.id).toBeGreaterThan(maxTag);
    expect(maxOp).toBeGreaterThan(0);
  });

  it('в непустую базу без force — отказ, ничего не меняется; с force — замена целиком', async () => {
    w = await stockWorld();
    const dump = await dumpDatabase(w.h.t.db);
    target = await createTestDb();
    await restoreDatabase(target.db, dump);
    const companies = async () => (await target!.q<{ n: number }>('SELECT COUNT(*) AS n FROM companies'))[0]!.n;
    const n = await companies();
    await expect(restoreDatabase(target.db, dump)).rejects.toThrow('База не пустая');
    expect(await companies()).toBe(n);
    await restoreDatabase(target.db, dump, { force: true });
    expect(await companies()).toBe(n);
  });

  it('чужой файл — понятная ошибка', async () => {
    target = await createTestDb();
    await expect(restoreDatabase(target.db, zlib.gzipSync(JSON.stringify({ format: 'other' })))).rejects.toThrow('Это не выгрузка базы');
    await expect(restoreDatabase(target.db, Buffer.from('не gzip'))).rejects.toThrow('Это не выгрузка базы');
  });
});
