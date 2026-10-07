import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const url = () => `/api/v1/companies/${w.cid}/saved-filters`;
const list = async () => (await w.h.req('GET', url())).json().savedFilters as { id: number; name: string; filter: Record<string, unknown>; unavailable: number }[];

describe('сохранённые фильтры журнала (§4.4, §6)', () => {
  it('создание, список, переименование, удаление; фильтр нормализуется той же схемой, что строка запроса журнала', async () => {
    w = await opsWorld();
    const res = await w.h.req('POST', url(), {
      name: '  Аренда   клубов ',
      filter: { categoryIds: [w.expense], types: ['expense'], q: ' аренда ', withoutProject: true, withoutCategory: false, sort: 'amount', junk: 1 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().savedFilter;
    expect(created).toMatchObject({
      companyId: w.cid,
      name: 'Аренда клубов',
      filter: { categoryIds: [w.expense], types: ['expense'], q: 'аренда', withoutProject: true },
      unavailable: 0,
    });
    expect(Object.keys(created.filter).sort()).toEqual(['categoryIds', 'q', 'types', 'withoutProject']);
    expect(await list()).toEqual([created]);

    const renamed = (await w.h.req('PATCH', `${url()}/${created.id}`, { name: 'Аренда' })).json().savedFilter;
    expect(renamed).toMatchObject({ name: 'Аренда', filter: created.filter });
    const refiltered = (await w.h.req('PATCH', `${url()}/${created.id}`, { filter: { tagIds: [w.tag] } })).json().savedFilter;
    expect(refiltered.filter).toEqual({ tagIds: [w.tag] });

    expect((await w.h.req('DELETE', `${url()}/${created.id}`)).statusCode).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('только свои: другой пользователь не видит чужой фильтр и получает 404 при правке и удалении', async () => {
    w = await opsWorld();
    const mine = (await w.post(url(), { name: 'Мой', filter: {} })).savedFilter.id as number;
    await seedUser(w.h.t, 'buh', 'buh-password-1');
    const cookie = await loginAs(w.h.t, 'buh', 'buh-password-1');
    const as = (method: 'GET' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      w.h.t.app.inject({ method, url: path, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload ? { payload } : {}) });

    expect((await as('GET', url())).json().savedFilters).toEqual([]);
    fail(await as('PATCH', `${url()}/${mine}`, { name: 'Чужой' }), 404, 'NOT_FOUND');
    fail(await as('DELETE', `${url()}/${mine}`), 404, 'NOT_FOUND');
    expect((await list())[0]!.name).toBe('Мой');

    // свой фильтр под адресом другой компании — тоже 404
    const other = await w.h.company('Другая');
    fail(await w.h.req('PATCH', `/api/v1/companies/${other}/saved-filters/${mine}`, { name: 'x' }), 404, 'NOT_FOUND');
  });

  it('проверка: фильтр — схемой журнала (поле с путём), название обязательно; архивная компания — только чтение', async () => {
    w = await opsWorld();
    expect(fail(await w.h.req('POST', url(), { name: 'Период', filter: { from: '2026-10-05', to: '2026-10-01' } }), 400, 'VALIDATION').fields).toEqual({
      'filter.to': 'Конец периода раньше начала',
    });
    fail(await w.h.req('POST', url(), { name: 'Тип', filter: { types: ['bogus'] } }), 400, 'VALIDATION');
    fail(await w.h.req('POST', url(), { name: '   ', filter: {} }), 400, 'VALIDATION');

    const other = await w.h.company('Архивная');
    await w.post(`/api/v1/companies/${other}/archive`, {});
    fail(await w.h.req('POST', `/api/v1/companies/${other}/saved-filters`, { name: 'x', filter: {} }), 422, 'ARCHIVED_REFERENCE');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/saved-filters`)).statusCode).toBe(200);
  });

  it('инвариант 10: ссылки на удалённые, архивные и чужие элементы отбрасываются при выдаче, сервер сообщает их число; после разархивации возвращаются', async () => {
    w = await opsWorld();
    const other = await w.h.company('Другая');
    const foreignTag = (await w.post(`/api/v1/companies/${other}/tags`, { name: 'Чужой' })).tag.id as number;
    const created = (
      await w.post(url(), { name: 'С архивом', filter: { categoryIds: [w.expense, 999999], tagIds: [w.tag, foreignTag], accountIds: [w.kzt] } })
    ).savedFilter;
    expect(created).toMatchObject({ filter: { categoryIds: [w.expense], tagIds: [w.tag], accountIds: [w.kzt] }, unavailable: 2 });

    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/archive`, {});
    const [archived] = await list();
    expect(archived!.filter).toEqual({ categoryIds: [w.expense], accountIds: [w.kzt] });
    expect(archived!.unavailable).toBe(3);

    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/unarchive`, {});
    expect((await list())[0]).toMatchObject({ filter: { tagIds: [w.tag] }, unavailable: 2 });
  });
});
