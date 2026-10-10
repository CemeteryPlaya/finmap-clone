import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const base = (cid: number) => `/api/v1/companies/${cid}/split-presets`;

async function world() {
  h = await createApi();
  const cid = await h.company();
  const other = await h.company();
  const project = async (c: number, name: string) =>
    (await h.req('POST', `/api/v1/companies/${c}/projects`, { name, templateKey: 'general' })).json().project.id as number;
  const category = async (c: number, kind: string, name: string) =>
    (await h.req('POST', `/api/v1/companies/${c}/categories`, { kind, name })).json().category.id as number;
  return {
    cid,
    other,
    p1: await project(cid, 'Клуб 1'),
    p2: await project(cid, 'Клуб 2'),
    rent: await category(cid, 'expense', 'Аренда'),
    bar: await category(cid, 'income', 'Бар'),
    foreignCategory: await category(other, 'expense', 'Чужая'),
    project,
  };
}

describe('split-presets API', () => {
  it('создание: доли в сумме 100%, строки со категорией и/или проектом', async () => {
    const w = await world();
    const res = await h.req('POST', base(w.cid), {
      name: 'Аренда пополам',
      lines: [
        { categoryId: w.rent, projectId: w.p1, bp: 6000 },
        { categoryId: w.rent, projectId: w.p2, bp: 4000 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().splitPreset).toMatchObject({
      name: 'Аренда пополам',
      lines: [
        { categoryId: w.rent, projectId: w.p1, bp: 6000 },
        { categoryId: w.rent, projectId: w.p2, bp: 4000 },
      ],
    });
    const onlyProjects = await h.req('POST', base(w.cid), { name: 'Проекты', lines: [{ projectId: w.p1, bp: 10000 }] });
    expect(onlyProjects.json().splitPreset.lines).toEqual([{ categoryId: null, projectId: w.p1, bp: 10000 }]);
    expect(h.auditCount('split_preset', 'create')).toBe(2);
  });

  it('проверки строк: сумма ≠ 100%, пустая строка, повтор, разные виды категорий', async () => {
    const w = await world();
    const linesError = async (lines: object[]) => (await h.req('POST', base(w.cid), { name: 'X', lines })).json().error.fields.lines;
    expect(await linesError([{ projectId: w.p1, bp: 5000 }, { projectId: w.p2, bp: 4999 }])).toBe('Сумма долей должна быть 100% (сейчас 99,99%)');
    expect(await linesError([{ bp: 10000 }])).toBe('В каждой строке укажите категорию или проект');
    expect(await linesError([{ projectId: w.p1, bp: 5000 }, { projectId: w.p1, bp: 5000 }])).toBe('Строки повторяются');
    expect(await linesError([{ categoryId: w.rent, bp: 5000 }, { categoryId: w.bar, bp: 5000 }])).toBe('Категории шаблона должны быть одного вида');
    expect(await linesError([])).toBe('Добавьте хотя бы одну строку');
  });

  it('чужие категории и проекты — ошибка поля; архивные — 422', async () => {
    const w = await world();
    const foreign = await h.req('POST', base(w.cid), { name: 'X', lines: [{ categoryId: w.foreignCategory, bp: 10000 }] });
    expect(foreign.json().error.fields.lines).toBe('Категория не найдена в этой компании');
    const foreignProject = await w.project(w.other, 'Чужой');
    const fp = await h.req('POST', base(w.cid), { name: 'X', lines: [{ projectId: foreignProject, bp: 10000 }] });
    expect(fp.json().error.fields.lines).toBe('Проект не найден в этой компании');
    await h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.p2}/archive`);
    const archived = await h.req('POST', base(w.cid), { name: 'X', lines: [{ projectId: w.p2, bp: 10000 }] });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('правка имени не перепроверяет старые строки (инвариант 10); архив, порядок, удаление, чужие id', async () => {
    const w = await world();
    const a = (await h.req('POST', base(w.cid), { name: 'A', lines: [{ projectId: w.p2, bp: 10000 }] })).json().splitPreset;
    const b = (await h.req('POST', base(w.cid), { name: 'B', lines: [{ projectId: w.p1, bp: 10000 }] })).json().splitPreset;
    await h.req('POST', `/api/v1/companies/${w.cid}/projects/${w.p2}/archive`);
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { name: 'A2' })).json().splitPreset.name).toBe('A2');
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { lines: [{ projectId: w.p2, bp: 10000 }] })).statusCode).toBe(200); // не изменились
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { lines: [{ projectId: w.p2, bp: 5000 }, { projectId: w.p1, bp: 5000 }] })).statusCode).toBe(422);
    expect(h.auditCount('split_preset', 'update')).toBe(1);

    expect((await h.req('POST', `${base(w.cid)}/reorder`, { ids: [b.id, a.id] })).json().splitPresets.map((p: { name: string }) => p.name)).toEqual(['B', 'A2']);
    expect((await h.req('POST', `${base(w.cid)}/${a.id}/archive`)).json().splitPreset.archivedAt).not.toBeNull();
    expect((await h.req('PATCH', `${base(w.cid)}/${a.id}`, { name: 'Z' })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await h.req('DELETE', `${base(w.cid)}/${a.id}`)).statusCode).toBe(204);
    expect((await h.req('PATCH', `${base(w.other)}/${b.id}`, { name: 'Z' })).statusCode).toBe(404);
    expect((await h.req('DELETE', `${base(w.other)}/${b.id}`)).statusCode).toBe(404);
  });
});
