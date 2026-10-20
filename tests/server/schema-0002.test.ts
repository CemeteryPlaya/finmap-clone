import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void | Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function setup() {
  const t = await createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite!;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО 1','KZT','x'), ('ТОО 2','KZT','x')").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  return s;
}

describe('миграция 0002', () => {
  it('теги уникальны в компании по name_key, включая архивные', async () => {
    const s = await setup();
    const ins = s.prepare("INSERT INTO tags (company_id, name, name_key, order_index, created_at, archived_at) VALUES (?, ?, ?, 0, 'x', ?)");
    ins.run(1, 'Аренда', 'аренда', 'y');
    expect(() => ins.run(1, 'аренда', 'аренда', null)).toThrow(/UNIQUE/);
    ins.run(2, 'Аренда', 'аренда', null);
  });

  it('контрагенты и шаблоны разделения ссылаются на компанию', async () => {
    const s = await setup();
    s.prepare("INSERT INTO counterparties (company_id, type, name, comment, order_index, created_at) VALUES (1,'client','ИП','',0,'x')").run();
    expect(() =>
      s.prepare("INSERT INTO counterparties (company_id, type, name, order_index, created_at) VALUES (99,'client','ИП',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
    s.prepare("INSERT INTO split_presets (company_id, name, lines, order_index, created_at) VALUES (1,'50/50','[]',0,'x')").run();
    expect(() =>
      s.prepare("INSERT INTO split_presets (company_id, name, lines, order_index, created_at) VALUES (99,'50/50','[]',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('user_preferences: пара (user_id, key) уникальна, удаляются вместе с пользователем', async () => {
    const s = await setup();
    const ins = s.prepare("INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (1, ?, '1', 'x')");
    ins.run('lastCompanyId');
    expect(() => ins.run('lastCompanyId')).toThrow(/UNIQUE/);
    s.prepare('DELETE FROM users WHERE id = 1').run();
    expect((s.prepare('SELECT COUNT(*) n FROM user_preferences').get() as { n: number }).n).toBe(0);
  });

  it('внешние ключи плана 2: categories.parent_id и accounts.project_id', async () => {
    const s = await setup();
    expect(() =>
      s.prepare("INSERT INTO categories (company_id, kind, parent_id, name, order_index, created_at) VALUES (1,'expense',999,'X',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      s
        .prepare("INSERT INTO accounts (company_id, project_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,999,'К','KZT',0,'2026-10-06',0,'x')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
