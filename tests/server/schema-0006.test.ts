import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','KZT',0,'2026-10-01',0,'x')").run();
  return s;
}

const insertImport =
  "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (1, 1, 'f.xlsx', 10, 'abc', 'done', '{}', '{}', '[]', 'x')";
const insertOp =
  "INSERT INTO operations (company_id, type, status, paid_at, account_id, amount, rate, base_amount, created_by, created_at, updated_at, version, import_id) VALUES (1,'income','actual','2026-10-06T00:00:00.000Z',1,100,'1',100,1,'x','x',1,?)";

describe('миграция 0006 (§6.1 спецификации импорта)', () => {
  it('таблица imports; operations.import_id — null у обычных операций, ссылка на импорт с внешним ключом и индексом', () => {
    const s = setup();
    const imp = s.prepare(insertImport).run();
    expect(s.prepare(insertOp).run(null).changes).toBe(1);
    expect(s.prepare(insertOp).run(imp.lastInsertRowid).changes).toBe(1);
    expect(() => s.prepare(insertOp).run(999)).toThrow(/FOREIGN KEY/);
    expect((s.prepare('SELECT COUNT(*) n FROM operations WHERE import_id IS NULL').get() as { n: number }).n).toBe(1);
    const indexes = (table: string) => (s.prepare(`PRAGMA index_list('${table}')`).all() as { name: string }[]).map((i) => i.name);
    expect(indexes('operations')).toContain('operations_import_idx');
    expect(indexes('imports')).toContain('imports_company_idx');
    // импорт с операциями нельзя удалить жёстко, пока операции ссылаются на него
    expect(() => s.prepare('DELETE FROM imports WHERE id = ?').run(imp.lastInsertRowid)).toThrow(/FOREIGN KEY/);
  });

  it('импорт ссылается на существующие компанию и пользователя; итог отмены и отмена — необязательны', () => {
    const s = setup();
    expect(() => s.prepare(insertImport.replace('VALUES (1, 1,', 'VALUES (2, 1,')).run()).toThrow(/FOREIGN KEY/);
    const id = s.prepare(insertImport).run().lastInsertRowid;
    expect(s.prepare('SELECT status, undo_result, undone_at, undone_by FROM imports WHERE id = ?').get(id)).toEqual({
      status: 'done',
      undo_result: null,
      undone_at: null,
      undone_by: null,
    });
  });
});
