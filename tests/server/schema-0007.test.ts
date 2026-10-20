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
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО 2','KZT','x')").run();
  s.prepare("INSERT INTO projects (company_id, name, template_key, template_params, order_index, created_at) VALUES (1,'Клуб 1','general','{}',0,'x')").run();
  s.prepare("INSERT INTO stock_warehouses (company_id, project_id, name, created_at) VALUES (1,1,'Бар','x')").run();
  s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (1,'Кола 0,5','кола 0,5','pcs','x')").run();
  return s;
}

const insertDoc = (number: string, extra = '') =>
  `INSERT INTO stock_docs (company_id, type, number, at, warehouse_id, created_by, created_at, updated_at, version${extra ? ', ' + extra.split('|')[0] : ''}) VALUES (1,'receipt','${number}','2026-10-01T10:00:00.000Z',1,1,'x','x',1${extra ? ', ' + extra.split('|')[1] : ''})`;

describe('миграция 0007 (§3 спецификации «Склад»)', () => {
  it('все таблицы склада созданы', async () => {
    const s = await setup();
    const names = (s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stock_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual([
      'stock_allocations',
      'stock_batches',
      'stock_combo_parts',
      'stock_doc_lines',
      'stock_doc_payments',
      'stock_doc_postings',
      'stock_docs',
      'stock_item_groups',
      'stock_item_prices',
      'stock_items',
      'stock_warehouses',
    ]);
  });

  it('у проекта не больше одного склада', async () => {
    const s = await setup();
    expect(() => s.prepare("INSERT INTO stock_warehouses (company_id, project_id, name, created_at) VALUES (1,1,'Ещё','x')").run()).toThrow(/UNIQUE/);
  });

  it('название товара уникально в компании по ключу, в другой компании — можно', async () => {
    const s = await setup();
    expect(() => s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (1,'КОЛА 0,5','кола 0,5','pcs','x')").run()).toThrow(/UNIQUE/);
    expect(s.prepare("INSERT INTO stock_items (company_id, name, name_key, unit, created_at) VALUES (2,'Кола 0,5','кола 0,5','pcs','x')").run().changes).toBe(1);
  });

  it('номер документа уникален в компании; пара (источник, ключ) — тоже, пустой ключ повторяется', async () => {
    const s = await setup();
    expect(s.prepare(insertDoc('П-0001')).run().changes).toBe(1);
    expect(() => s.prepare(insertDoc('П-0001')).run()).toThrow(/UNIQUE/);
    expect(s.prepare(insertDoc('П-0002')).run().changes).toBe(1); // source_ref пуст у обоих
    expect(s.prepare(insertDoc('П-0003', "source, source_ref|'senet', 'смена-1'")).run().changes).toBe(1);
    expect(() => s.prepare(insertDoc('П-0004', "source, source_ref|'senet', 'смена-1'")).run()).toThrow(/UNIQUE/);
  });

  it('значения по умолчанию: проведён, вручную, цена 0, не комплект', async () => {
    const s = await setup();
    s.prepare(insertDoc('П-0001')).run();
    expect(s.prepare('SELECT status, source FROM stock_docs').get()).toEqual({ status: 'posted', source: 'manual' });
    expect(s.prepare('SELECT sale_price, is_combo, min_qty FROM stock_items').get()).toEqual({ sale_price: 0, is_combo: 0, min_qty: null });
  });

  it('внешние ключи: строка документа, партия и оплата не ссылаются в пустоту', async () => {
    const s = await setup();
    expect(() => s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty) VALUES (99,0,1,1000)').run()).toThrow(/FOREIGN KEY/);
    s.prepare(insertDoc('П-0001')).run();
    s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty, amount) VALUES (1,0,1,1000,500)').run();
    expect(() => s.prepare('INSERT INTO stock_doc_payments (doc_id, operation_id, amount) VALUES (1, 99, 5)').run()).toThrow(/FOREIGN KEY/);
    expect(() => s.prepare("INSERT INTO stock_batches (warehouse_id, item_id, origin_line_id, at, qty_in, cost_in, qty_left, cost_left) VALUES (1,1,99,'x',1,1,1,1)").run()).toThrow(/FOREIGN KEY/);
  });

  it('удаление документа удаляет его строки и их списания', async () => {
    const s = await setup();
    s.prepare(insertDoc('П-0001')).run();
    s.prepare('INSERT INTO stock_doc_lines (doc_id, position, item_id, qty, amount) VALUES (1,0,1,1000,500)').run();
    s.prepare('INSERT INTO stock_allocations (line_id, batch_id, qty, cost) VALUES (1, NULL, 1000, NULL)').run();
    s.prepare('DELETE FROM stock_docs WHERE id = 1').run();
    expect((s.prepare('SELECT COUNT(*) n FROM stock_doc_lines').get() as { n: number }).n).toBe(0);
    expect((s.prepare('SELECT COUNT(*) n FROM stock_allocations').get() as { n: number }).n).toBe(0);
  });

  it('история цены: одна строка на товар и дату', async () => {
    const s = await setup();
    s.prepare("INSERT INTO stock_item_prices (item_id, price, valid_from, created_by, created_at) VALUES (1, 100, '2026-10-01', 1, 'x')").run();
    expect(() => s.prepare("INSERT INTO stock_item_prices (item_id, price, valid_from, created_by, created_at) VALUES (1, 200, '2026-10-01', 1, 'x')").run()).toThrow(/UNIQUE|PRIMARY/);
  });
});
