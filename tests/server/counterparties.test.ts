import { afterEach, describe, expect, it } from 'vitest';
import { COUNTERPARTY_TYPES } from '../../src/shared/counterparties';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/counterparties`;

describe('counterparties API', () => {
  it('создание всех типов; пустой комментарий → null; неизвестный тип — ошибка поля', async () => {
    h = await createApi();
    const cid = await h.company();
    for (const type of COUNTERPARTY_TYPES) {
      const res = await h.req('POST', base(cid), { type, name: `К ${type}`, comment: '   ' });
      expect(res.statusCode).toBe(201);
      expect(res.json().counterparty).toMatchObject({ type, comment: null, archivedAt: null });
    }
    const bad = await h.req('POST', base(cid), { type: 'friend', name: 'X' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.type).toBe('Выберите тип контрагента');
    const list = (await h.req('GET', base(cid))).json().counterparties;
    expect(list).toHaveLength(COUNTERPARTY_TYPES.length);
    expect(h.auditCount('counterparty', 'create')).toBe(COUNTERPARTY_TYPES.length);
  });

  it('правка, архив, порядок и удаление; PATCH без изменений не пишет историю', async () => {
    h = await createApi();
    const cid = await h.company();
    const a = (await h.req('POST', base(cid), { type: 'supplier', name: 'ИП Иванов', comment: 'аренда' })).json().counterparty;
    const b = (await h.req('POST', base(cid), { type: 'client', name: 'ТОО Альфа' })).json().counterparty;
    const upd = await h.req('PATCH', `${base(cid)}/${a.id}`, { type: 'employee', comment: '' });
    expect(upd.json().counterparty).toMatchObject({ type: 'employee', name: 'ИП Иванов', comment: null });
    await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'ИП  Иванов', comment: null });
    expect(h.auditCount('counterparty', 'update')).toBe(1);

    const order = await h.req('POST', `${base(cid)}/reorder`, { ids: [b.id, a.id] });
    expect(order.json().counterparties.map((c: { id: number }) => c.id)).toEqual([b.id, a.id]);
    expect((await h.req('POST', `${base(cid)}/reorder`, { ids: [a.id] })).statusCode).toBe(409);

    expect((await h.req('POST', `${base(cid)}/${a.id}/archive`)).json().counterparty.archivedAt).not.toBeNull();
    expect((await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'Y' })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await h.req('POST', `${base(cid)}/${a.id}/unarchive`)).json().counterparty.archivedAt).toBeNull();
    expect((await h.req('DELETE', `${base(cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('GET', base(cid))).json().counterparties.map((c: { id: number }) => c.id)).toEqual([b.id]);
  });

  it('чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = (await h.req('POST', base(c2), { type: 'client', name: 'Чужой' })).json().counterparty;
    const before = h.auditCount('counterparty');
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['POST', `${base(c1)}/${x.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    // в списке порядка компании 1 чужого id нет — список не совпадает с текущим
    expect((await h.req('POST', `${base(c1)}/reorder`, { ids: [x.id] })).statusCode).toBe(409);
    expect(h.auditCount('counterparty')).toBe(before);
    expect((await h.req('GET', base(c2))).json().counterparties[0]).toMatchObject({ name: 'Чужой', archivedAt: null });
  });
});
