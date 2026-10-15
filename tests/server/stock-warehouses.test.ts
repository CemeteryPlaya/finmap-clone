import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

async function setup(): Promise<{ w: OpsWorld; stock: string }> {
  w = await opsWorld();
  return { w, stock: `/api/v1/companies/${w.cid}/stock` };
}

describe('склады', () => {
  it('склад создаётся у проекта; у проекта не больше одного', async () => {
    const { w, stock } = await setup();
    const res = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project, name: '  Бар   Клуб 1 ' });
    expect(res.statusCode).toBe(201);
    expect(res.json().warehouse).toMatchObject({ projectId: w.project, name: 'Бар Клуб 1', receiptsSource: 'manual', archivedAt: null, companyId: w.cid });
    const dup = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project, name: 'Второй' });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.fields.projectId).toBe('У проекта уже есть склад');
    expect((await w.h.req('GET', `${stock}/warehouses`)).json().warehouses).toHaveLength(1);
    expect(w.h.auditCount('stock_warehouse', 'create')).toBe(1);
  });

  it('проект чужой компании и архивный проект отклоняются', async () => {
    const { w, stock } = await setup();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const res = await w.h.req('POST', `${stock}/warehouses`, { projectId: foreign, name: 'Бар' });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_5']);
    await w.h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.project2}/archive`);
    const arch = await w.h.req('POST', `${stock}/warehouses`, { projectId: w.project2, name: 'Бар' });
    expect([arch.statusCode, arch.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
  });

  it('переименование и архив; склад другой компании не виден', async () => {
    const { w, stock } = await setup();
    const wh = (await w.post(`${stock}/warehouses`, { projectId: w.project, name: 'Бар' })).warehouse;
    expect((await w.h.req('PATCH', `${stock}/warehouses/${wh.id}`, { name: 'Бар 1' })).json().warehouse.name).toBe('Бар 1');
    expect((await w.h.req('POST', `${stock}/warehouses/${wh.id}/archive`)).json().warehouse.archivedAt).not.toBeNull();
    expect((await w.h.req('POST', `${stock}/warehouses/${wh.id}/unarchive`)).json().warehouse.archivedAt).toBeNull();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    expect((await w.h.req('PATCH', `/api/v1/companies/${other}/stock/warehouses/${wh.id}`, { name: 'X' })).statusCode).toBe(404);
    expect((await w.h.req('GET', `/api/v1/companies/${other}/stock/warehouses`)).json().warehouses).toEqual([]);
  });

  it('проект со складом нельзя удалить — только в архив', async () => {
    const { w, stock } = await setup();
    await w.post(`${stock}/warehouses`, { projectId: w.project2, name: 'Бар' });
    const res = await w.h.req('DELETE', `/api/v1/companies/${w.cid}/projects/${w.project2}`);
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_9']);
  });
});
