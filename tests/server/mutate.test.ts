import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFields, mutate } from '../../src/server/modules/audit/mutate';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('changedFields', () => {
  it('оставляет только изменённые поля; null — изменений нет', () => {
    expect(changedFields({ a: 1, b: 'x', p: { k: 1 } }, { a: 1, b: 'y' })).toEqual({ before: { b: 'x' }, after: { b: 'y' } });
    expect(changedFields({ a: 1, p: { k: 1 } }, { p: { k: 1 } })).toBeNull();
    expect(changedFields({ a: 1 }, {})).toBeNull();
    expect(changedFields({ a: 1 as number | null }, { a: null })).toEqual({ before: { a: 1 }, after: { a: null } });
  });
});

describe('mutate: когда берётся блокировка записи', () => {
  it('immediate — с начала транзакции: другое соединение не начнёт запись; deferred — до первой записи может', async () => {
    h = await createApi();
    const other = new Database(path.join(h.t.dir, 'app.db'), { timeout: 0 });
    try {
      const audit = createAuditService(h.t.db);
      /** Другое соединение пробует начать запись (без ожидания): удалось ли. */
      const otherCanWrite = () => {
        try {
          other.exec('BEGIN IMMEDIATE');
          other.exec('ROLLBACK');
          return true;
        } catch {
          return false;
        }
      };
      expect(mutate(h.t.db, audit, () => otherCanWrite())).toBe(true);
      expect(mutate(h.t.db, audit, () => otherCanWrite(), { behavior: 'immediate' })).toBe(false);
      // после транзакции блокировки нет
      expect(otherCanWrite()).toBe(true);
    } finally {
      other.close();
    }
  });
});

describe('история и транзакции', () => {
  it('PATCH без изменений не пишет историю (компании и проекты)', async () => {
    h = await createApi();
    const cid = await h.company('ТОО');
    expect((await h.req('PATCH', `/api/v1/companies/${cid}`, { name: ' ТОО ', baseCurrency: 'KZT' })).statusCode).toBe(200);
    expect(h.auditCount('company', 'update')).toBe(0);

    const p = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Клуб 1', templateKey: 'computer-club', templateParams: { pcCount: 30 } })).json().project;
    const same = await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Клуб\u200B 1', templateParams: { pcCount: 30 } });
    expect(same.statusCode).toBe(200);
    expect(h.auditCount('project', 'update')).toBe(0);

    await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Клуб 2', templateParams: { pcCount: 30 } });
    const row = h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'project' AND action = 'update'").get() as { diff: string };
    expect(JSON.parse(row.diff)).toEqual({ before: { name: 'Клуб 1' }, after: { name: 'Клуб 2' } });
  });

  it('сбой записи истории откатывает изменение: оба действия в одной транзакции', async () => {
    h = await createApi();
    const cid = await h.company('A');
    const p = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project;
    const s = h.t.sqlite;
    const categoriesBefore = (s.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n;
    s.exec("CREATE TEMP TRIGGER audit_down BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
    expect((await h.req('PATCH', `/api/v1/companies/${cid}`, { name: 'Б' })).statusCode).toBe(500);
    expect((await h.req('POST', `/api/v1/companies/${cid}/archive`)).statusCode).toBe(500);
    expect((await h.req('POST', '/api/v1/companies', { name: 'В' })).statusCode).toBe(500);
    expect((await h.req('PATCH', `/api/v1/companies/${cid}/projects/${p.id}`, { name: 'Склад' })).statusCode).toBe(500);
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${p.id}/archive`)).statusCode).toBe(500);
    s.exec('DROP TRIGGER audit_down');

    const companies = (await h.req('GET', '/api/v1/companies')).json().companies;
    expect(companies).toEqual([expect.objectContaining({ id: cid, name: 'A', archivedAt: null })]);
    expect((s.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBe(categoriesBefore);
    const projects = (await h.req('GET', `/api/v1/companies/${cid}/projects`)).json().projects;
    expect(projects).toEqual([expect.objectContaining({ name: 'Офис', archivedAt: null })]);
  });
});
