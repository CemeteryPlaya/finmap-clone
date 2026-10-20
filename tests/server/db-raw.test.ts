import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exec, first, one, rows } from '../../src/server/db/raw';
import { withTx } from '../../src/server/db/tx';
import { currencies } from '../../src/server/db/schema';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const count = async () => (await one<{ n: number }>(t.db, sql`SELECT COUNT(*) AS n FROM currencies`))!.n;
const add = (code: string) => exec(t.db, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES (${code}, ${code}, ${code}, 2)`);

describe('raw', () => {
  it('rows — объекты с именами колонок из SQL', async () => {
    await add('KZT');
    expect(await rows(t.db, sql`SELECT code AS c, minor_units AS m FROM currencies`)).toEqual([{ c: 'KZT', m: 2 }]);
  });

  it('one — undefined на пустом результате', async () => {
    expect(await one(t.db, sql`SELECT code FROM currencies`)).toBeUndefined();
  });

  it('first — первая строка построителя или undefined', async () => {
    expect(await first(t.db.select().from(currencies))).toBeUndefined();
    await add('USD');
    expect((await first(t.db.select().from(currencies)))?.code).toBe('USD');
  });
});

describe('withTx', () => {
  it('откатывает обе вставки, если колбэк бросил после await', async () => {
    await expect(
      withTx(t.db, async (tx) => {
        await exec(tx, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('A', 'A', 'A', 2)`);
        await Promise.resolve();
        await exec(tx, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('B', 'B', 'B', 2)`);
        throw new Error('стоп');
      }),
    ).rejects.toThrow('стоп');
    expect(await count()).toBe(0);
  });

  it('вложенный withTx откатывает только свою часть', async () => {
    await withTx(t.db, async (tx) => {
      await exec(tx, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('A', 'A', 'A', 2)`);
      await expect(
        withTx(tx, async (inner) => {
          await exec(inner, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('B', 'B', 'B', 2)`);
          throw new Error('внутри');
        }),
      ).rejects.toThrow('внутри');
    });
    expect(await rows(t.db, sql`SELECT code FROM currencies`)).toEqual([{ code: 'A' }]);
  });

  it('параллельные транзакции выполняются по очереди и обе фиксируются', async () => {
    const slow = (code: string) =>
      withTx(t.db, async (tx) => {
        await exec(tx, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES (${code}, ${code}, ${code}, 2)`);
        await new Promise((r) => setTimeout(r, 5));
        return code;
      });
    expect(await Promise.all([slow('A'), slow('B'), slow('C')])).toEqual(['A', 'B', 'C']);
    expect(await count()).toBe(3);
  });

  it('возвращает результат колбэка', async () => {
    expect(await withTx(t.db, async () => 42)).toBe(42);
  });
});
