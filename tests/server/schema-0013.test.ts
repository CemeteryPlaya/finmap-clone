import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** Миграция 0013 (план 2026-11-02-senet-autopost, задача 2): таблицы Senet и их уникальные ключи. */
describe('миграция 0013 (Senet)', () => {
  function fresh() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig13-'));
    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    runMigrations(db);
    sqlite.exec(`
      INSERT INTO users (id, login, name, password_hash, created_at) VALUES (1, 'a', 'А', 'x', 'x');
      INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KZT', 'Тенге', '₸', 2);
      INSERT INTO companies (id, name, base_currency, created_at) VALUES (1, 'К', 'KZT', 'x');
      INSERT INTO senet_connections (id, company_id, name, org, auth_method, credentials_secret, credentials_hint, created_at, created_by)
        VALUES (1, 1, 'Клубы', 'club-demo', 'password', 'sealed', 'login', 'x', 1);
      INSERT INTO senet_offices (id, connection_id, senet_office_id, cash_desk_id) VALUES (1, 1, 1, 1);
      INSERT INTO senet_shifts (id, office_id, opened_at, end_balance, updated_at) VALUES (1, 1, '2026-10-01T05:26:45.000Z', 0, 'x');
      INSERT INTO senet_cash_moves (id, shift_id, senet_ref, kind, amount, at) VALUES (1, 1, 'r|1', 'out', 100, 'x');
      INSERT INTO senet_postings (shift_id, kind, operation_id, amount, created_at) VALUES (1, 'cash', NULL, 100, 'x');
      INSERT INTO senet_review_items (shift_id, cash_move_id, reason, open_key, created_at) VALUES (1, 1, 'unrecognized', '1|1|unrecognized', 'x');
      INSERT INTO senet_raw (connection_id, report, from_date, to_date, fetched_at, status, file_key, sha256) VALUES (1, 'sessions', 'a', 'b', 'x', 200, 'k', 'h1');
    `);
    return sqlite;
  }

  it('создаёт таблицы Senet (вместе с 0014, 0015, 0017, 0018 и 0019)', () => {
    const sqlite = fresh();
    const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'senet_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual([
      'senet_bar_purchases',
      'senet_cash_moves',
      'senet_checks',
      'senet_connections',
      'senet_data_spans',
      'senet_goods_moves',
      'senet_guest_links',
      'senet_load',
      'senet_offices',
      'senet_postings',
      'senet_raw',
      'senet_refills',
      'senet_review_items',
      'senet_rules',
      'senet_shifts',
      'senet_sold_items',
      'senet_stock',
      'senet_sync_runs',
      'senet_tickets',
      'senet_transactions',
      'senet_zones',
    ]);
    sqlite.close();
  });

  it.each([
    ['клуб: (подключение, офис, касса)', 'INSERT INTO senet_offices (connection_id, senet_office_id, cash_desk_id) VALUES (1, 1, 1)'],
    ['смена: (клуб, начало)', "INSERT INTO senet_shifts (office_id, opened_at, end_balance, updated_at) VALUES (1, '2026-10-01T05:26:45.000Z', 0, 'x')"],
    ['выемка: (смена, ключ Senet)', "INSERT INTO senet_cash_moves (shift_id, senet_ref, kind, amount, at) VALUES (1, 'r|1', 'out', 100, 'x')"],
    ['проводка: (смена, вид)', "INSERT INTO senet_postings (shift_id, kind, amount, created_at) VALUES (1, 'cash', 5, 'x')"],
    ['открытый пункт очереди', "INSERT INTO senet_review_items (shift_id, cash_move_id, reason, open_key, created_at) VALUES (1, 1, 'unrecognized', '1|1|unrecognized', 'x')"],
    ['сырой файл: (подключение, sha256)', "INSERT INTO senet_raw (connection_id, report, from_date, to_date, fetched_at, status, file_key, sha256) VALUES (1, 'sessions', 'c', 'd', 'x', 200, 'k2', 'h1')"],
  ])('уникальность — %s', (_name, insert) => {
    const sqlite = fresh();
    expect(() => sqlite.exec(insert)).toThrow(/UNIQUE/);
    sqlite.close();
  });

  it('закрытые пункты очереди (open_key = NULL) не мешают друг другу', () => {
    const sqlite = fresh();
    sqlite.exec("UPDATE senet_review_items SET status = 'answered', open_key = NULL");
    const add = "INSERT INTO senet_review_items (shift_id, cash_move_id, reason, status, created_at) VALUES (1, 1, 'unrecognized', 'answered', 'x')";
    sqlite.exec(add);
    sqlite.exec(add);
    expect((sqlite.prepare('SELECT COUNT(*) n FROM senet_review_items').get() as { n: number }).n).toBe(3);
    sqlite.close();
  });

  it('у правил пять видов совпадения и флаги по умолчанию', () => {
    const sqlite = fresh();
    for (const m of ['word', 'first', 'phrase', 'prefix', 'contains']) {
      sqlite.exec(`INSERT INTO senet_rules (company_id, type, pattern, match, created_at, created_by) VALUES (1, 'keyword', '${m}', '${m}', 'x', 1)`);
    }
    expect(sqlite.prepare("SELECT DISTINCT flags, priority, created_from_review c FROM senet_rules").all()).toEqual([{ flags: '{}', priority: 0, c: 0 }]);
    sqlite.close();
  });
});
