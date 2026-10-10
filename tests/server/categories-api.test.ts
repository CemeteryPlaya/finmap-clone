import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

interface Node {
  id: number;
  companyId: number;
  name: string;
  parentId: number | null;
  systemKey: string | null;
  effectiveSystemKey: string | null;
  archivedAt: string | null;
  children: Node[];
}

const base = (cid: number) => `/api/v1/companies/${cid}/categories`;
const tree = async (cid: number) => (await h.req('GET', base(cid))).json() as { income: Node[]; expense: Node[] };
const add = async (cid: number, body: object) => {
  const res = await h.req('POST', base(cid), body);
  if (res.statusCode !== 201) throw new Error(`add: ${res.statusCode} ${res.body}`);
  return res.json().category as Node;
};
const salaryOf = async (cid: number) => (await tree(cid)).expense.find((n) => n.systemKey === 'salary')!;

describe('categories API', () => {
  it('создание: верхний уровень, дочерняя; дочерняя системной наследует systemKey', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: ' Реклама\u200B ' });
    expect(ads).toMatchObject({ name: 'Реклама', parentId: null, systemKey: null });
    await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const salary = await salaryOf(cid);
    await add(cid, { kind: 'expense', name: 'Администраторы', parentId: salary.id });
    const t = await tree(cid);
    expect(t.expense.find((n) => n.id === ads.id)!.children.map((n) => n.name)).toEqual(['Таргет']);
    expect(t.expense.find((n) => n.id === salary.id)!.children[0]).toMatchObject({ name: 'Администраторы', effectiveSystemKey: 'salary' });
    expect(h.auditCount('category', 'create')).toBe(3);
  });

  it('родитель: другого вида, второго уровня, чужой компании — ошибка поля; архивный — 422', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const income = await add(cid, { kind: 'income', name: 'Бар' });
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const child = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const foreign = await add(other, { kind: 'expense', name: 'Чужая' });
    const field = async (parentId: number) => (await h.req('POST', base(cid), { kind: 'expense', name: 'X', parentId })).json().error.fields?.parentId;
    expect(await field(income.id)).toBe('Родительская категория из другого дерева');
    expect(await field(child.id)).toBe('Вложенность — не больше двух уровней');
    expect(await field(foreign.id)).toBe('Родительская категория не найдена');
    const lonely = await add(cid, { kind: 'expense', name: 'Пустая' });
    await h.req('POST', `${base(cid)}/${lonely.id}/archive`);
    const res = await h.req('POST', base(cid), { kind: 'expense', name: 'X', parentId: lonely.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('переименование: системную нельзя, без изменений — без истории, архивную нельзя', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    expect((await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: 'Маркетинг' })).json().category.name).toBe('Маркетинг');
    await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: ' Маркетинг ' });
    expect(h.auditCount('category', 'update')).toBe(1);
    const sys = await h.req('PATCH', `${base(cid)}/${(await salaryOf(cid)).id}`, { name: 'ФОТ' });
    expect(sys.statusCode).toBe(422);
    expect(sys.json().error.code).toBe('SYSTEM_CATEGORY');
    await h.req('POST', `${base(cid)}/${ads.id}/archive`);
    expect((await h.req('PATCH', `${base(cid)}/${ads.id}`, { name: 'Ещё' })).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('перенос и порядок по правилам §7; устаревший список — 409 (Review Focus 5)', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const target = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const print = await add(cid, { kind: 'expense', name: 'Печать' });
    const salary = await salaryOf(cid);
    const income = await add(cid, { kind: 'income', name: 'Бар' });
    const reorder = (body: object) => h.req('POST', `${base(cid)}/reorder`, body);
    const top = async () => (await tree(cid)).expense.map((n) => n.id);

    // «Печать» (без дочерних) — внутрь «Рекламы» после «Таргета»
    let res = await reorder({ kind: 'expense', parentId: ads.id, ids: [target.id, print.id], moving: print.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().expense.find((n: Node) => n.id === ads.id).children.map((n: Node) => n.name)).toEqual(['Таргет', 'Печать']);
    // «Таргет» — на верхний уровень, первым
    res = await reorder({ kind: 'expense', parentId: null, ids: [target.id, ...(await top())], moving: target.id });
    expect(res.statusCode).toBe(200);
    expect((await top())[0]).toBe(target.id);

    const fail = async (body: object, status: number, code: string) => {
      const r = await reorder(body);
      expect(r.statusCode).toBe(status);
      expect(r.json().error.code).toBe(code);
    };
    // у «Рекламы» есть дочерняя «Печать» — её нельзя сделать дочерней
    await fail({ kind: 'expense', parentId: salary.id, ids: [ads.id], moving: ads.id }, 400, 'VALIDATION');
    // системная остаётся на верхнем уровне
    await fail({ kind: 'expense', parentId: ads.id, ids: [print.id, salary.id], moving: salary.id }, 422, 'SYSTEM_CATEGORY');
    // в категорию второго уровня нельзя — был бы третий уровень
    await fail({ kind: 'expense', parentId: print.id, ids: [target.id], moving: target.id }, 400, 'VALIDATION');
    // в дерево другого вида нельзя
    await fail({ kind: 'expense', parentId: null, ids: [...(await top()), income.id], moving: income.id }, 400, 'VALIDATION');
    // в саму себя нельзя
    await fail({ kind: 'expense', parentId: target.id, ids: [target.id], moving: target.id }, 400, 'VALIDATION');
    // устаревший список (нет одной категории уровня)
    await fail({ kind: 'expense', parentId: null, ids: (await top()).slice(1) }, 409, 'VERSION_CONFLICT');
    // устаревший экран: «Печать» уже перенесли в «Рекламу», а старый список верхнего уровня всё ещё содержит её.
    // Порядок без явного moving не должен молча вернуть её наверх.
    await fail({ kind: 'expense', parentId: null, ids: [...(await top()), print.id] }, 409, 'VERSION_CONFLICT');
    expect((await tree(cid)).expense.find((n) => n.id === ads.id)!.children.map((n) => n.id)).toEqual([print.id]);

    const before = h.auditCount('category', 'reorder');
    await reorder({ kind: 'expense', parentId: null, ids: await top() }); // тот же порядок
    expect(h.auditCount('category', 'reorder')).toBe(before);
  });

  it('порядок дочерних архивного родителя меняется; перенос внутрь архивного — 422', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const a = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const b = await add(cid, { kind: 'expense', name: 'Печать', parentId: ads.id });
    const other = await add(cid, { kind: 'expense', name: 'Прочее' });
    for (const id of [a.id, b.id, ads.id]) expect((await h.req('POST', `${base(cid)}/${id}/archive`)).statusCode).toBe(200);
    const reorder = (body: object) => h.req('POST', `${base(cid)}/reorder`, body);

    const res = await reorder({ kind: 'expense', parentId: ads.id, ids: [b.id, a.id], moving: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().expense.find((n: Node) => n.id === ads.id).children.map((n: Node) => n.id)).toEqual([b.id, a.id]);

    const into = await reorder({ kind: 'expense', parentId: ads.id, ids: [b.id, a.id, other.id], moving: other.id });
    expect(into.statusCode).toBe(422);
    expect(into.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('архив: системные и категории с активными дочерними — нельзя; дочернюю архивного родителя не вернуть', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const tg = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    const act = (id: number, a: 'archive' | 'unarchive') => h.req('POST', `${base(cid)}/${id}/${a}`);
    expect((await act((await salaryOf(cid)).id, 'archive')).json().error.code).toBe('ARCHIVED_REFERENCE');
    const withChild = await act(ads.id, 'archive');
    expect(withChild.statusCode).toBe(422);
    expect(withChild.json().error.message).toBe('Сначала переведите в архив дочерние категории');
    expect((await act(tg.id, 'archive')).statusCode).toBe(200);
    expect((await act(ads.id, 'archive')).statusCode).toBe(200);
    expect((await act(tg.id, 'unarchive')).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await act(ads.id, 'unarchive')).statusCode).toBe(200);
    expect((await act(tg.id, 'unarchive')).json().category.archivedAt).toBeNull();
  });

  it('удаление: системную и с дочерними нельзя, лист — можно', async () => {
    h = await createApi();
    const cid = await h.company();
    const ads = await add(cid, { kind: 'expense', name: 'Реклама' });
    const tg = await add(cid, { kind: 'expense', name: 'Таргет', parentId: ads.id });
    expect((await h.req('DELETE', `${base(cid)}/${(await salaryOf(cid)).id}`)).json().error.code).toBe('SYSTEM_CATEGORY');
    expect((await h.req('DELETE', `${base(cid)}/${ads.id}`)).json().error.code).toBe('IN_USE');
    expect((await h.req('DELETE', `${base(cid)}/${tg.id}`)).statusCode).toBe(204);
    expect((await h.req('DELETE', `${base(cid)}/${ads.id}`)).statusCode).toBe(204);
    expect((await tree(cid)).expense.some((n) => n.id === ads.id)).toBe(false);
    expect(h.auditCount('category', 'delete')).toBe(2);
  });

  it('дерево компании не содержит чужих категорий; чужие id → 404 без истории', async () => {
    h = await createApi();
    const c1 = await h.company();
    const c2 = await h.company();
    const x = await add(c2, { kind: 'expense', name: 'Чужая' });
    const own = await tree(c1);
    const all = [...own.income, ...own.expense].flatMap((n) => [n, ...n.children]);
    expect(all.every((n) => n.companyId === c1)).toBe(true);
    expect(all.some((n) => n.id === x.id)).toBe(false);

    const before = h.auditCount('category');
    const topIds = own.expense.map((n) => n.id);
    const attempts = [
      ['PATCH', `${base(c1)}/${x.id}`, { name: 'X' }],
      ['POST', `${base(c1)}/${x.id}/archive`, undefined],
      ['POST', `${base(c1)}/${x.id}/unarchive`, undefined],
      ['DELETE', `${base(c1)}/${x.id}`, undefined],
      ['POST', `${base(c1)}/reorder`, { kind: 'expense', parentId: null, ids: [...topIds, x.id] }],
    ] as const;
    for (const [method, url, body] of attempts) expect((await h.req(method, url, body)).statusCode).toBe(404);
    expect(h.auditCount('category')).toBe(before);
  });
});
