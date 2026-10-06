import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/tags`;

describe('tags API', () => {
  it('тег уникален без учёта регистра, «ё» и невидимых символов', async () => {
    h = await createApi();
    const cid = await h.company();
    expect((await h.req('POST', base(cid), { name: 'Ёлка' })).statusCode).toBe(201);
    for (const name of ['ёлка', 'ЕЛКА', ' Елка\u200B ']) {
      const res = await h.req('POST', base(cid), { name });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.name).toBe('Такой тег уже есть');
    }
  });

  it('имя архивного тега: 422 ARCHIVED_DUPLICATE, дубль не создаётся (Review Focus 4)', async () => {
    h = await createApi();
    const cid = await h.company();
    const tag = (await h.req('POST', base(cid), { name: 'елка' })).json().tag;
    await h.req('POST', `${base(cid)}/${tag.id}/archive`);
    const res = await h.req('POST', base(cid), { name: 'Ёлка\u200B' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'ARCHIVED_DUPLICATE', fields: { name: 'Такой тег есть в архиве' } });
    expect((await h.req('GET', base(cid))).json().tags).toHaveLength(1);
    expect((await h.req('POST', `${base(cid)}/${tag.id}/unarchive`)).json().tag.archivedAt).toBeNull();
  });

  it('переименование (в том числе смена регистра), удаление освобождает имя, в другой компании имя свободно', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const a = (await h.req('POST', base(cid), { name: 'аренда' })).json().tag;
    const b = (await h.req('POST', base(cid), { name: 'бар' })).json().tag;
    expect((await h.req('PATCH', `${base(cid)}/${a.id}`, { name: 'Аренда' })).json().tag.name).toBe('Аренда');
    expect((await h.req('PATCH', `${base(cid)}/${b.id}`, { name: 'АРЕНДА' })).json().error.fields.name).toBe('Такой тег уже есть');
    expect((await h.req('POST', base(other), { name: 'Аренда' })).statusCode).toBe(201);
    expect((await h.req('DELETE', `${base(cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('POST', base(cid), { name: 'Аренда' })).statusCode).toBe(201);
    const order = await h.req('POST', `${base(cid)}/reorder`, {
      ids: (await h.req('GET', base(cid))).json().tags.map((t: { id: number }) => t.id).reverse(),
    });
    expect(order.json().tags.map((t: { name: string }) => t.name)).toEqual(['Аренда', 'бар']);
  });

  it('чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = (await h.req('POST', base(c2), { name: 'чужой' })).json().tag;
    const before = h.auditCount('tag');
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('tag')).toBe(before);
  });
});
