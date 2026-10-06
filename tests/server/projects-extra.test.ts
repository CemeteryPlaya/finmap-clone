import { afterEach, describe, expect, it } from 'vitest';
import { computerClub } from '../../src/templates/computer-club';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const projectsUrl = (cid: number) => `/api/v1/companies/${cid}/projects`;
const accountsUrl = (cid: number) => `/api/v1/companies/${cid}/accounts`;
const club = (name: string) => ({ name, templateKey: 'computer-club', templateParams: { pcCount: 10 } });
const accountNames = async (cid: number) => (await h.req('GET', accountsUrl(cid))).json().accounts.map((a: { name: string }) => a.name);

describe('projects: переименование счетов, порядок, удаление', () => {
  it('renameAccounts переименовывает «Касса/Kaspi …», кроме изменённых вручную и архивных', async () => {
    h = await createApi();
    const cid = await h.company();
    const p1 = (await h.req('POST', projectsUrl(cid), club('Клуб 1'))).json().project;
    const p2 = (await h.req('POST', projectsUrl(cid), club('Клуб 2'))).json().project;
    const accs = (await h.req('GET', accountsUrl(cid))).json().accounts as { id: number; name: string }[];
    const byName = (n: string) => accs.find((a) => a.name === n)!.id;
    await h.req('PATCH', `${accountsUrl(cid)}/${byName('Kaspi Клуб 1')}`, { name: 'Kaspi Gold' });
    await h.req('POST', `${accountsUrl(cid)}/${byName('Касса Клуб 2')}/archive`);

    const r1 = await h.req('PATCH', `${projectsUrl(cid)}/${p1.id}`, { name: 'Клуб на Абая', renameAccounts: true });
    expect(r1.json()).toMatchObject({ project: { name: 'Клуб на Абая' }, renamedAccounts: 1 });
    const r2 = await h.req('PATCH', `${projectsUrl(cid)}/${p2.id}`, { name: 'Клуб на Сатпаева', renameAccounts: true });
    expect(r2.json().renamedAccounts).toBe(1);
    expect(await accountNames(cid)).toEqual(['Касса Клуб на Абая', 'Kaspi Gold', 'Касса Клуб 2', 'Kaspi Клуб на Сатпаева']);
  });

  it('без renameAccounts счета не меняются', async () => {
    h = await createApi();
    const cid = await h.company();
    const p = (await h.req('POST', projectsUrl(cid), club('Клуб 1'))).json().project;
    const res = await h.req('PATCH', `${projectsUrl(cid)}/${p.id}`, { name: 'Клуб 9' });
    expect(res.json()).toMatchObject({ project: { name: 'Клуб 9' }, renamedAccounts: 0 });
    expect(await accountNames(cid)).toEqual(['Касса Клуб 1', 'Kaspi Клуб 1']);
  });

  it('счёт шаблона без своей валюты получает базовую валюту компании', async () => {
    h = await createApi();
    const cid = (await h.req('POST', '/api/v1/companies', { name: 'USD Ltd', baseCurrency: 'USD' })).json().company.id as number;
    // у шаблонов в коде валюта счетов задана явно (KZT) — подменяем на время теста (файл идёт в своём процессе)
    const saved = computerClub.defaultAccounts;
    computerClub.defaultAccounts = [{ name: 'Сейф {project}' }, { name: 'Kaspi {project}', currency: 'KZT' }];
    try {
      expect((await h.req('POST', projectsUrl(cid), club('Клуб'))).statusCode).toBe(201);
    } finally {
      computerClub.defaultAccounts = saved;
    }
    const accs = (await h.req('GET', accountsUrl(cid))).json().accounts.map((a: { name: string; currency: string }) => [a.name, a.currency]);
    expect(accs).toEqual([
      ['Сейф Клуб', 'USD'],
      ['Kaspi Клуб', 'KZT'],
    ]);
  });

  it('порядок проектов; устаревший список — 409', async () => {
    h = await createApi();
    const cid = await h.company();
    const a = (await h.req('POST', projectsUrl(cid), { name: 'A', templateKey: 'general' })).json().project.id as number;
    const b = (await h.req('POST', projectsUrl(cid), { name: 'B', templateKey: 'general' })).json().project.id as number;
    const res = await h.req('POST', `${projectsUrl(cid)}/reorder`, { ids: [b, a] });
    expect(res.json().projects.map((p: { name: string }) => p.name)).toEqual(['B', 'A']);
    expect((await h.req('POST', `${projectsUrl(cid)}/reorder`, { ids: [a] })).statusCode).toBe(409);
    expect(h.auditCount('project', 'reorder')).toBe(1);
  });

  it('удаление: только без счетов (включая архивные); чужие id — 404', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const office = (await h.req('POST', projectsUrl(cid), { name: 'Офис', templateKey: 'general' })).json().project.id as number;
    const acc = (await h.req('POST', accountsUrl(cid), { name: 'Сейф', currency: 'KZT', projectId: office })).json().account.id as number;
    await h.req('POST', `${accountsUrl(cid)}/${acc}/archive`);
    const blocked = await h.req('DELETE', `${projectsUrl(cid)}/${office}`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('IN_USE');
    expect((await h.req('DELETE', `${projectsUrl(other)}/${office}`)).statusCode).toBe(404);
    await h.req('DELETE', `${accountsUrl(cid)}/${acc}`);
    expect((await h.req('DELETE', `${projectsUrl(cid)}/${office}`)).statusCode).toBe(204);
    expect((await h.req('GET', projectsUrl(cid))).json().projects).toEqual([]);
    expect(h.auditCount('project', 'delete')).toBe(1);
  });
});
