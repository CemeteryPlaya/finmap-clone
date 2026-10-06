import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/accounts`;
const kaspi = { name: 'Kaspi Gold', currency: 'KZT', startingBalance: 150000 };
const names = async (cid: number) => (await h.req('GET', base(cid))).json().accounts.map((a: { name: string }) => a.name);

describe('accounts API', () => {
  it('создание: openedAt по умолчанию — сегодня в APP_TIMEZONE, история', async () => {
    h = await createApi('2026-10-06T20:00:00.000Z'); // 01:00 7 октября по Алматы
    const cid = await h.company();
    const res = await h.req('POST', base(cid), kaspi);
    expect(res.statusCode).toBe(201);
    expect(res.json().account).toMatchObject({
      name: 'Kaspi Gold',
      currency: 'KZT',
      startingBalance: 150000,
      openedAt: '2026-10-07',
      projectId: null,
      archivedAt: null,
    });
    expect(h.auditCount('account', 'create')).toBe(1);
  });

  it('проверка полей: несуществующая дата, валюта, дробный остаток, пустое имя', async () => {
    h = await createApi();
    const cid = await h.company();
    const res = await h.req('POST', base(cid), { name: '\u200B', currency: 'XXX', startingBalance: 1.5, openedAt: '2026-02-31' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['currency', 'name', 'openedAt', 'startingBalance']);
    expect(res.json().error.fields.startingBalance).toBe('Сумма в минимальных единицах — целое число');
    const huge = await h.req('POST', base(cid), { ...kaspi, startingBalance: 2 ** 60 });
    expect(huge.json().error.fields.startingBalance).toBe('Слишком большая сумма');
  });

  it('счёт нельзя создать в архивном проекте или перенести в него; чужой проект — ошибка поля (Review Focus 1)', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const office = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project.id;
    const foreign = (await h.req('POST', `/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).json().project.id;
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/archive`)).statusCode).toBe(200);

    const toArchived = await h.req('POST', base(cid), { ...kaspi, projectId: office });
    expect(toArchived.statusCode).toBe(422);
    expect(toArchived.json().error.code).toBe('ARCHIVED_REFERENCE');
    const toForeign = await h.req('POST', base(cid), { ...kaspi, projectId: foreign });
    expect(toForeign.statusCode).toBe(400);
    expect(toForeign.json().error.fields.projectId).toBe('Проект не найден в этой компании');

    const acc = (await h.req('POST', base(cid), kaspi)).json().account;
    const move = await h.req('PATCH', `${base(cid)}/${acc.id}`, { projectId: office });
    expect(move.statusCode).toBe(422);
    expect(move.json().error.code).toBe('ARCHIVED_REFERENCE');
    expect(h.auditCount('account', 'update')).toBe(0);
  });

  it('правка полей; PATCH без изменений не пишет историю; архивный счёт не правится', async () => {
    h = await createApi();
    const cid = await h.company();
    const acc = (await h.req('POST', base(cid), { ...kaspi, openedAt: '2026-01-01' })).json().account;
    const res = await h.req('PATCH', `${base(cid)}/${acc.id}`, { name: 'Kaspi Red', startingBalance: 0, openedAt: '2025-12-31', currency: 'USD' });
    expect(res.statusCode).toBe(200);
    expect(res.json().account).toMatchObject({ name: 'Kaspi Red', startingBalance: 0, openedAt: '2025-12-31', currency: 'USD' });
    const same = await h.req('PATCH', `${base(cid)}/${acc.id}`, { name: ' Kaspi  Red ', startingBalance: 0 });
    expect(same.statusCode).toBe(200);
    expect(h.auditCount('account', 'update')).toBe(1);

    expect((await h.req('POST', `${base(cid)}/${acc.id}/archive`)).statusCode).toBe(200);
    const locked = await h.req('PATCH', `${base(cid)}/${acc.id}`, { startingBalance: 100 });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('архив только при нулевом балансе; счёт архивного проекта из архива не вернуть (Review Focus 2)', async () => {
    h = await createApi();
    const cid = await h.company();
    const office = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' })).json().project.id;
    const acc = (await h.req('POST', base(cid), { ...kaspi, projectId: office })).json().account;
    const nonZero = await h.req('POST', `${base(cid)}/${acc.id}/archive`);
    expect(nonZero.statusCode).toBe(422);
    expect(nonZero.json().error).toMatchObject({ code: 'ARCHIVED_REFERENCE', message: 'Счёт можно перевести в архив только при нулевом балансе' });
    await h.req('PATCH', `${base(cid)}/${acc.id}`, { startingBalance: 0 });
    expect((await h.req('POST', `${base(cid)}/${acc.id}/archive`)).json().account.archivedAt).not.toBeNull();
    expect((await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/archive`)).statusCode).toBe(200);

    const blocked = await h.req('POST', `${base(cid)}/${acc.id}/unarchive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');
    await h.req('POST', `/api/v1/companies/${cid}/projects/${office}/unarchive`);
    expect((await h.req('POST', `${base(cid)}/${acc.id}/unarchive`)).json().account.archivedAt).toBeNull();
  });

  it('порядок: новый список применяется; устаревший или с повторами — 409 без изменений (Review Focus 5)', async () => {
    h = await createApi();
    const cid = await h.company();
    const ids: number[] = [];
    for (const name of ['A', 'B', 'C']) ids.push((await h.req('POST', base(cid), { ...kaspi, name })).json().account.id);
    const [a, b, c] = ids as [number, number, number];
    const res = await h.req('POST', `${base(cid)}/reorder`, { ids: [c, a, b] });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts.map((x: { name: string }) => x.name)).toEqual(['C', 'A', 'B']);
    const stale = await h.req('POST', `${base(cid)}/reorder`, { ids: [a, b] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    expect((await h.req('POST', `${base(cid)}/reorder`, { ids: [a, a, b] })).statusCode).toBe(409);
    expect(await names(cid)).toEqual(['C', 'A', 'B']);
    await h.req('POST', `${base(cid)}/reorder`, { ids: [c, a, b] }); // тот же порядок — без истории
    expect(h.auditCount('account', 'reorder')).toBe(1);
  });

  it('удаление неиспользуемого счёта; в архивной компании запись запрещена', async () => {
    h = await createApi();
    const cid = await h.company();
    const acc = (await h.req('POST', base(cid), { ...kaspi, startingBalance: 0 })).json().account;
    const keep = (await h.req('POST', base(cid), { ...kaspi, name: 'Касса', startingBalance: 0 })).json().account;
    expect((await h.req('DELETE', `${base(cid)}/${acc.id}`)).statusCode).toBe(204);
    expect(await names(cid)).toEqual(['Касса']);
    expect(h.auditCount('account', 'delete')).toBe(1);

    await h.req('POST', `${base(cid)}/${keep.id}/archive`);
    expect((await h.req('POST', `/api/v1/companies/${cid}/archive`)).statusCode).toBe(200);
    const attempts = [
      ['POST', base(cid), kaspi],
      ['POST', `${base(cid)}/${keep.id}/unarchive`, undefined],
      ['DELETE', `${base(cid)}/${keep.id}`, undefined],
      ['POST', `${base(cid)}/reorder`, { ids: [keep.id] }],
    ] as const;
    for (const [method, url, body] of attempts) {
      const r = await h.req(method, url, body);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('ARCHIVED_REFERENCE');
    }
  });

  it('чужие id → 404, ничего не меняется и не пишется в историю', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const foreign = (await h.req('POST', base(c2), { ...kaspi, startingBalance: 0 })).json().account;
    const before = h.auditCount('account');
    const attempts = [
      ['PATCH', `${base(c1)}/${foreign.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${foreign.id}/archive`, undefined],
      ['POST', `${base(c1)}/${foreign.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${foreign.id}`, undefined],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('account')).toBe(before);
    expect((await h.req('GET', base(c2))).json().accounts[0]).toMatchObject({ name: 'Kaspi Gold', archivedAt: null });
  });
});
