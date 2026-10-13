import { afterEach, describe, expect, it } from 'vitest';
import type { ImportListPage } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr } from '../helpers/finmap-like';
import { importRows } from '../helpers/imports';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = '2026-10-06T12:00:00.000Z';
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const listUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports`;

async function list(query = '', cid = w.cid): Promise<ImportListPage> {
  const res = await w.h.req('GET', `${listUrl(cid)}${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportListPage;
}

/** Три расхода с «Кассы» по «Аренде» — по одному в день. */
const FILE_A = [1, 2, 3].map((d) => fr({ paidAt: at(`2026-10-0${d}`, '10:00:00'), amount: 100 * d, from: 'Касса', category: 'Аренда' }));
/** Доход на новый счёт «Сейф». */
const FILE_B = [fr({ paidAt: at('2026-10-04', '11:00:00'), amount: 50, to: 'Сейф', category: 'Бар' })];

describe('GET …/imports — список «Импорты» (§6.2, §7.2 спецификации импорта)', () => {
  it('новые сверху: файл, размер, кто и когда, счётчики; pending — все операции импорта, изменённых нет', async () => {
    w = await opsWorld(NOW);
    expect(await list()).toEqual({ items: [], nextBeforeId: null });
    const a = await importRows(w, FILE_A, { name: 'январь.xlsx' });
    const b = await importRows(w, FILE_B, { name: 'февраль.xlsx' });

    const page = await list();
    expect(page.nextBeforeId).toBeNull();
    expect(page.items.map((i) => i.id)).toEqual([b.import.id, a.import.id]);
    expect(page.items[1]).toEqual({
      id: a.import.id,
      fileName: 'январь.xlsx',
      fileSize: a.import.fileSize,
      status: 'done',
      createdAt: NOW,
      userName: 'Тест',
      counts: { rows: 3, income: 0, expense: 3, transfer: 0, added: 3, duplicates: 0, skippedFuture: 0 },
      undoneAt: null,
      undoneByName: null,
      pending: { operations: 3, edited: 0 },
    });
    expect(page.items[0]!.pending).toEqual({ operations: 1, edited: 0 });
  });

  it('pending.edited: правка (version > 1) и вложение — изменённые; мягко удалённая — не изменённая, но в operations', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE_A);
    const ids = (w.h.t.sqlite.prepare('SELECT id FROM operations WHERE import_id = ? ORDER BY id').all(r.import.id) as { id: number }[]).map((o) => o.id);
    // правка комментария — version 2
    const edit = await w.h.req('PATCH', `${w.ops}/${ids[0]}`, { version: 1, comment: 'проверено' });
    expect(edit.statusCode, edit.body).toBe(200);
    // вложение (версия не меняется) — тоже изменение, даже удалённое
    w.h.t.sqlite
      .prepare("INSERT INTO attachments (company_id, operation_id, original_name, stored_name, mime, size, created_at, deleted_at) VALUES (?, ?, 'чек.png', 'x.png', 'image/png', 1, ?, ?)")
      .run(w.cid, ids[1], NOW, NOW);
    // мягкое удаление: удаляется отменой всегда, изменённой не считается
    const del = await w.h.req('DELETE', `${w.ops}/${ids[2]}`);
    expect(del.statusCode, del.body).toBe(200);

    expect((await list()).items[0]!.pending).toEqual({ operations: 3, edited: 2 });
    expect(one('SELECT version FROM operations WHERE id = ?', ids[1]).version).toBe(1);
  });

  it('«Показать ещё»: limit и beforeId; чужая компания не видна; архивная — список есть; неверный limit — 400; нет компании — 404', async () => {
    w = await opsWorld(NOW);
    const first = await importRows(w, FILE_A, { name: '1.xlsx' });
    const second = await importRows(w, FILE_B, { name: '2.xlsx' });
    const other = await w.h.company('Другая');

    const p1 = await list('?limit=1');
    expect(p1.items.map((i) => i.fileName)).toEqual(['2.xlsx']);
    expect(p1.nextBeforeId).toBe(second.import.id);
    const p2 = await list(`?limit=1&beforeId=${p1.nextBeforeId}`);
    expect(p2.items.map((i) => i.id)).toEqual([first.import.id]);
    expect(p2.nextBeforeId).toBe(first.import.id);
    expect(await list(`?limit=1&beforeId=${first.import.id}`)).toEqual({ items: [], nextBeforeId: null });

    expect((await list('', other)).items).toEqual([]);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    expect((await list('', other)).items).toEqual([]);

    const bad = await w.h.req('GET', `${listUrl()}?limit=0`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
    expect((await w.h.req('GET', listUrl(99_999))).statusCode).toBe(404);
  });
});
