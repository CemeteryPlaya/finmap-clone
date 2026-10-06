import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

type Req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => Promise<LightMyRequestResponse>;

async function setup(now?: string) {
  t = await createTestApp({}, undefined, now ? () => new Date(now) : undefined);
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req: Req = (method, url, payload) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload } : {}) });
  const company = (await req('POST', '/api/v1/companies', { name: 'ТОО' })).json().company as { id: number };
  return { req, cid: company.id };
}

const club = (name: string, pcCount: unknown = 30) => ({ name, templateKey: 'computer-club', templateParams: { pcCount } });

describe('projects API', () => {
  it('GET /templates отдаёт шаблоны без схем', async () => {
    const { req } = await setup();
    const res = await req('GET', '/api/v1/templates');
    expect(res.json().templates.map((x: { key: string }) => x.key)).toEqual(['computer-club', 'general']);
    for (const tpl of res.json().templates) {
      expect(Object.keys(tpl).sort()).toEqual(['defaultAccounts', 'integrations', 'key', 'name', 'paramsUi']);
    }
    expect(res.json().templates[0].paramsUi[0]).toEqual({ key: 'pcCount', label: 'Количество ПК', type: 'int' });
    expect(res.json().templates[0].defaultAccounts).toEqual(['Касса {project}', 'Kaspi {project}']);
  });

  it('создание клуба применяет шаблон: статьи, счета KZT с projectId, история', async () => {
    const { req, cid } = await setup();
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб на Ленина'));
    expect(res.statusCode).toBe(201);
    const { project, applied } = res.json();
    expect(project).toMatchObject({ name: 'Клуб на Ленина', templateKey: 'computer-club', templateParams: { pcCount: 30, consoleCount: 0 } });
    expect(applied.categories).toBeGreaterThan(20);
    expect(applied.accounts).toBe(2);

    const tree = (await req('GET', `/api/v1/companies/${cid}/categories`)).json();
    const salary = tree.expense.find((c: { systemKey: string }) => c.systemKey === 'salary');
    expect(salary.children.map((c: { name: string; effectiveSystemKey: string }) => [c.name, c.effectiveSystemKey])).toEqual([
      ['Администраторы', 'salary'],
      ['Премии', 'salary'],
    ]);
    const accounts = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts;
    expect(accounts.map((a: { name: string; currency: string; projectId: number }) => [a.name, a.currency, a.projectId])).toEqual([
      ['Касса Клуб на Ленина', 'KZT', project.id],
      ['Kaspi Клуб на Ленина', 'KZT', project.id],
    ]);
    const audit = t.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'project'").all();
    expect(audit).toEqual([{ action: 'create' }]);
  });

  it('второй клуб не дублирует статьи, но получает свои счета (Review Focus 1)', async () => {
    const { req, cid } = await setup();
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб 1'));
    const count = () => (t.sqlite.prepare('SELECT COUNT(*) n FROM categories WHERE company_id = ?').get(cid) as { n: number }).n;
    const before = count();
    const second = (await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб 2'))).json();
    expect(second.applied).toEqual({ categories: 0, accounts: 2 });
    expect(count()).toBe(before);
    const names = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts.map((a: { name: string }) => a.name);
    expect(names).toEqual(['Касса Клуб 1', 'Kaspi Клуб 1', 'Касса Клуб 2', 'Kaspi Клуб 2']);
  });

  it('длинное название проекта (100 символов) и «$» в названии не ломают имена счетов', async () => {
    const { req, cid } = await setup();
    const long = 'К'.repeat(100);
    expect((await req('POST', `/api/v1/companies/${cid}/projects`, club(long))).statusCode).toBe(201);
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Клуб $& $$'));
    const names = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts.map((a: { name: string }) => a.name);
    expect(names).toContain(`Kaspi ${long}`);
    expect(names).toContain('Касса Клуб $& $$');
  });

  it('проект «Общий» без статей и счетов', async () => {
    const { req, cid } = await setup();
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Офис', templateKey: 'general' });
    expect(res.statusCode).toBe(201);
    expect(res.json().applied).toEqual({ categories: 0, accounts: 0 });
    expect(res.json().project.templateParams).toEqual({});
  });

  it('кривые параметры шаблона дают 400 с полями templateParams.* (Review Focus 4)', async () => {
    const { req, cid } = await setup();
    for (const bad of [{ pcCount: '30' }, { pcCount: 0 }, {}, { pcCount: 2.5 }]) {
      const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'computer-club', templateParams: bad });
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.fields)).toEqual(['templateParams.pcCount']);
    }
    const unknown = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'nope' });
    expect(unknown.json().error.fields).toEqual({ templateKey: 'Неизвестный тип бизнеса' });
    const extra = await req('POST', `/api/v1/companies/${cid}/projects`, {
      name: 'X',
      templateKey: 'computer-club',
      templateParams: { pcCount: 5, hack: true },
    });
    expect(extra.json().project.templateParams).toEqual({ pcCount: 5, consoleCount: 0 });
    expect(t.sqlite.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({ n: 1 });
  });

  it('openedAt счетов — дата в APP_TIMEZONE (Review Focus 5)', async () => {
    const { req, cid } = await setup('2026-10-05T19:30:00.000Z');
    await req('POST', `/api/v1/companies/${cid}/projects`, club('Ночной'));
    const accounts = (await req('GET', `/api/v1/companies/${cid}/accounts`)).json().accounts;
    expect(accounts.map((a: { openedAt: string }) => a.openedAt)).toEqual(['2026-10-06', '2026-10-06']);
  });

  it('правка имени и параметров; templateKey не меняется', async () => {
    const { req, cid } = await setup();
    const { project } = (await req('POST', `/api/v1/companies/${cid}/projects`, club('A'))).json();
    const res = await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, {
      name: 'Б',
      templateParams: { pcCount: 40, consoleCount: 2 },
      templateKey: 'general',
    });
    expect(res.json().project).toMatchObject({ name: 'Б', templateKey: 'computer-club', templateParams: { pcCount: 40, consoleCount: 2 } });
    const bad = await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { templateParams: { pcCount: -1 } });
    expect(bad.statusCode).toBe(400);
  });

  it('архив проекта только без активных счетов; архивный проект не правится', async () => {
    const { req, cid } = await setup();
    const { project } = (await req('POST', `/api/v1/companies/${cid}/projects`, club('A'))).json();
    const blocked = await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');
    t.sqlite.prepare("UPDATE accounts SET archived_at = 'x' WHERE project_id = ?").run(project.id);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`)).json().project.archivedAt).not.toBeNull();
    expect((await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { name: 'Z' })).statusCode).toBe(422);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/unarchive`)).json().project.archivedAt).toBeNull();
  });

  it('чужие id → 404 и ничего не меняется (Review Focus 3)', async () => {
    const { req, cid } = await setup();
    const other = (await req('POST', '/api/v1/companies', { name: 'Чужая' })).json().company.id as number;
    const { project } = (await req('POST', `/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).json();
    expect((await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { name: 'Взлом' })).statusCode).toBe(404);
    expect((await req('POST', `/api/v1/companies/${cid}/projects/${project.id}/archive`)).statusCode).toBe(404);
    expect((await req('GET', '/api/v1/companies/999/projects')).statusCode).toBe(404);
    expect((await req('GET', '/api/v1/companies/999/categories')).statusCode).toBe(404);
    expect((t.sqlite.prepare('SELECT name FROM projects WHERE id = ?').get(project.id) as { name: string }).name).toBe('Чужой');
  });

  it('в архивной компании проект не создаётся', async () => {
    const { req, cid } = await setup();
    await req('POST', `/api/v1/companies/${cid}/archive`);
    const res = await req('POST', `/api/v1/companies/${cid}/projects`, { name: 'X', templateKey: 'general' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('название проекта уникально в компании без учёта регистра и пробелов, архивные считаются', async () => {
    const { req, cid } = await setup();
    const url = `/api/v1/companies/${cid}/projects`;
    expect((await req('POST', url, club('Клуб'))).statusCode).toBe(201);
    for (const name of ['Клуб', ' клуб ']) {
      const dup = await req('POST', url, club(name));
      expect(dup.statusCode).toBe(400);
      expect(dup.json().error.code).toBe('VALIDATION');
      expect(dup.json().error.fields).toEqual({ name: 'Проект с таким названием уже есть' });
    }
    const other = (await req('POST', '/api/v1/companies', { name: 'Другая' })).json().company.id as number;
    expect((await req('POST', `/api/v1/companies/${other}/projects`, club('Клуб'))).statusCode).toBe(201);

    const second = (await req('POST', url, club('Второй'))).json().project;
    const clash = await req('PATCH', `${url}/${second.id}`, { name: 'КЛУБ' });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error.fields).toEqual({ name: 'Проект с таким названием уже есть' });
    const own = await req('PATCH', `${url}/${second.id}`, { name: 'второй' });
    expect(own.statusCode).toBe(200);
    expect(own.json().project.name).toBe('второй');

    // архивный проект тоже занимает имя
    const third = (await req('POST', `${url}`, { name: 'Офис', templateKey: 'general' })).json().project;
    await req('POST', `${url}/${third.id}/archive`);
    expect((await req('POST', url, { name: 'офис', templateKey: 'general' })).statusCode).toBe(400);
  });

  it('PATCH templateParams сливается с сохранёнными', async () => {
    const { req, cid } = await setup();
    const { project } = (
      await req('POST', `/api/v1/companies/${cid}/projects`, {
        name: 'Клуб',
        templateKey: 'computer-club',
        templateParams: { pcCount: 30, consoleCount: 4 },
      })
    ).json();
    const res = await req('PATCH', `/api/v1/companies/${cid}/projects/${project.id}`, { templateParams: { pcCount: 40 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.templateParams).toEqual({ pcCount: 40, consoleCount: 4 });
  });
});
