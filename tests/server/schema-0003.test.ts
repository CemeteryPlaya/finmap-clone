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
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','KZT',0,'2026-10-01',0,'x')").run();
  return s;
}

const insertOp = "INSERT INTO operations (company_id, type, status, paid_at, account_id, amount, rate, base_amount, created_by, created_at, updated_at, version) VALUES (1,'income','actual','2026-10-06T00:00:00.000Z',?,100,'1',100,1,'x','x',1)";

describe('миграция 0003', () => {
  it('курс на дату по валюте уникален', () => {
    const s = setup();
    const ins = s.prepare("INSERT INTO exchange_rates (date, currency, rate_to_kzt, source, created_by, fetched_at) VALUES ('2026-10-06','USD',?, 'manual', 1, 'x')");
    ins.run('475.12');
    expect(() => ins.run('480')).toThrow(/UNIQUE/);
  });

  it('операция ссылается на существующий счёт; строки и теги удаляются вместе с операцией', () => {
    const s = setup();
    expect(() => s.prepare(insertOp).run(99)).toThrow(/FOREIGN KEY/);
    const op = s.prepare(insertOp).run(1);
    s.prepare("INSERT INTO tags (company_id, name, name_key, order_index, created_at) VALUES (1,'Т','т',0,'x')").run();
    s.prepare('INSERT INTO operation_lines (operation_id, position, amount, base_amount) VALUES (?,0,100,100)').run(op.lastInsertRowid);
    s.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?,1)').run(op.lastInsertRowid);
    expect(() => s.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?,1)').run(op.lastInsertRowid)).toThrow(/UNIQUE|PRIMARY/);
    s.prepare('DELETE FROM operations WHERE id = ?').run(op.lastInsertRowid);
    expect((s.prepare('SELECT COUNT(*) n FROM operation_lines').get() as { n: number }).n).toBe(0);
    expect((s.prepare('SELECT COUNT(*) n FROM operation_tags').get() as { n: number }).n).toBe(0);
  });

  it('справочник со ссылкой из операции нельзя удалить жёстко (страховка инварианта 9)', () => {
    const s = setup();
    s.prepare(insertOp).run(1);
    expect(() => s.prepare('DELETE FROM accounts WHERE id = 1').run()).toThrow(/FOREIGN KEY/);
  });
});
