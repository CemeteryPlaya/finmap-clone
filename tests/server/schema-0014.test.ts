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

/** Миграция 0014 (план 2026-11-02-senet-autopost, задача 15): остатки бара, движение товаров и загрузка клуба. */
describe('миграция 0014 (Senet: остатки, движение, загрузка)', () => {
  it('создаёт senet_stock, senet_goods_moves и senet_load с индексами клуба и времени', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig14-'));
    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    runMigrations(db);
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('senet_stock')).toEqual(['id', 'office_id', 'from_at', 'to_at', 'item', 'sold_qty', 'restock_qty', 'write_off_qty', 'restock_price', 'restock_sum', 'selling_price', 'sold_sum', 'actual_qty']);
    expect(cols('senet_goods_moves')).toEqual([
      'id',
      'office_id',
      'from_at',
      'to_at',
      'source_order',
      'cashier',
      'category',
      'item',
      'restock_qty',
      'write_off_qty',
      'restock_price',
      'restock_sum',
      'total_qty',
      'sold_qty',
      'selling_price',
      'sold_sum',
      'sold_cost',
      'profit',
      'comment',
    ]);
    expect(cols('senet_load')).toEqual([
      'id',
      'office_id',
      'start_at',
      'end_at',
      'zone',
      'workstation',
      'guest_login',
      'phone_hash',
      'phone_mask',
      'age',
      'tariff',
      'debited',
      'refilled',
      'duration_sec',
    ]);
    const indexes = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'senet_%' AND (tbl_name IN ('senet_stock', 'senet_goods_moves', 'senet_load')) ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(['senet_goods_moves_office_from_idx', 'senet_load_office_start_idx', 'senet_stock_office_from_idx']);
    sqlite.close();
  });
});
