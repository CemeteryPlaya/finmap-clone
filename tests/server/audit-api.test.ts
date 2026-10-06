import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

interface Entry {
  id: number;
  entity: string;
  action: string;
  userName: string | null;
  diff: Record<string, unknown> | null;
}

describe('audit API', () => {
  it('лента компании: новые сверху, имя пользователя, фильтры по сущности и пользователю, страницы', async () => {
    h = await createApi();
    const cid = await h.company('ТОО');
    await h.req('POST', `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT' });
    await h.req('POST', `/api/v1/companies/${cid}/tags`, { name: 'Аренда' });
    const all = (await h.req('GET', `/api/v1/companies/${cid}/audit`)).json() as { entries: Entry[]; nextBeforeId: number | null };
    expect(all.entries.map((e) => e.entity)).toEqual(['tag', 'account', 'company']);
    expect(all.entries[0]).toMatchObject({ action: 'create', userName: 'Тест', diff: { name: 'Аренда' } });
    expect(all.nextBeforeId).toBeNull();

    const accounts = (await h.req('GET', `/api/v1/companies/${cid}/audit?entity=account`)).json().entries as Entry[];
    expect(accounts.map((e) => e.entity)).toEqual(['account']);
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user.id as number;
    expect((await h.req('GET', `/api/v1/companies/${cid}/audit?userId=${me}`)).json().entries).toHaveLength(3);
    expect((await h.req('GET', `/api/v1/companies/${cid}/audit?userId=999`)).json().entries).toHaveLength(0);

    const page1 = (await h.req('GET', `/api/v1/companies/${cid}/audit?limit=2`)).json() as { entries: Entry[]; nextBeforeId: number };
    expect(page1.entries).toHaveLength(2);
    const page2 = (await h.req('GET', `/api/v1/companies/${cid}/audit?limit=2&beforeId=${page1.nextBeforeId}`)).json().entries as Entry[];
    expect(page2.map((e) => e.entity)).toEqual(['company']);
  });

  it('чужая компания не видна; неизвестная — 404; кривой limit — 400', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    await h.req('POST', `/api/v1/companies/${c2}/tags`, { name: 'Чужой' });
    const own = (await h.req('GET', `/api/v1/companies/${c1}/audit`)).json().entries as Entry[];
    expect(own.every((e) => e.entity === 'company')).toBe(true);
    expect((await h.req('GET', '/api/v1/companies/999/audit')).statusCode).toBe(404);
    for (const bad of ['0', '201', 'abc']) {
      expect((await h.req('GET', `/api/v1/companies/${c1}/audit?limit=${bad}`)).statusCode).toBe(400);
    }
    expect((await h.req('GET', `/api/v1/companies/${c1}/audit?entity=DROP%20TABLE`)).statusCode).toBe(400);
  });

  it('системная лента: входы и пользователи, без событий компаний; паролей в diff нет', async () => {
    h = await createApi();
    await h.company();
    await h.req('POST', '/api/v1/users', { login: 'kassir', name: 'Кассир', password: 'kassir-pass-1' });
    const sys = (await h.req('GET', '/api/v1/audit/system')).json().entries as Entry[];
    expect(sys.map((e) => `${e.entity}:${e.action}`)).toEqual(['user:create', 'user:login', 'user:create']);
    expect(JSON.stringify(sys)).not.toContain('kassir-pass-1');
    expect((await h.req('GET', '/api/v1/audit/system?entity=company')).json().entries).toEqual([]);
  });
});
