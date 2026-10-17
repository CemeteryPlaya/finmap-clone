import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { sheetRows } from '../helpers/xlsx-rows';

let w: StockWorld;
afterEach(async () => w?.h.t.cleanup());

interface Row {
  id: string;
  kind: string;
  label: string;
  income: number;
  expense: number;
  archived?: true;
  children?: Row[];
}
interface Projects {
  rows: Row[];
  total: Row;
  meta: { from: string; to: string; status: string; mode: string; currency: string; empty: boolean; stock: boolean; noBatch: number };
}
interface PnlRow {
  id: string;
  total: number | null;
}

const Q3 = 'from=2026-07-01&to=2026-09-30';
const base = () => `/api/v1/companies/${w.cid}/analytics`;
const get = async <T>(url: string): Promise<T> => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
};
const projects = (qs: string) => get<Projects>(`${base()}/projects?${Q3}&${qs}`);
const cell = (qs: string) => get<{ items: { id: number; part: number | null }[]; nextCursor: string | null }>(`${base()}/operations?report=projects&${Q3}&${qs}`);
const sums = (rows: Row[]) => rows.map((r) => [r.label, r.income, r.expense]);
const fieldError = async (url: string) => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(400);
  return (res.json() as { error: { fields: Record<string, string> } }).error.fields;
};

/**
 * Третий квартал 2026 (синтетика, суммы в ₸): «Клуб 1» — доход «Бар» 500 (июль) и «Инвестиции» 5 000 (исключены); «Клуб 2» —
 * «Аренда» 200; «Клуб 3» (в архиве) — «Бар» 400 и «Аренда» 100; без проекта — «Бар» 1 000 с оплатой в сентябре и датой
 * сделки в августе и расход 1 200 (900 «Закуп бара» и 300 «Аренда»), оплативший 1 000 поступления колы; расход 300 с
 * датой сделки в июне (вне периода); перевод. Склад «Клуб 1»: продажа 4 колы (себестоимость 400), списание колы (100);
 * склад «Клуб 2»: продажа без поступления («Нет партии»).
 */
async function quarter() {
  w = await stockWorld();
  const c = `/api/v1/companies/${w.cid}/categories`;
  const supply = (await w.post(c, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const tree = (await w.h.req('GET', c)).json() as Record<'income' | 'expense', { id: number; systemKey: string | null }[]>;
  const investment = tree.income.find((x) => x.systemKey === 'investment')!.id;
  const club3 = (await w.post(`/api/v1/companies/${w.cid}/projects`, { name: 'Клуб 3', templateKey: 'general' })).project.id as number;
  for (const account of [w.kzt, w.usd]) await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${account}`, { openedAt: '2026-01-01' });
  const op = async (body: Record<string, unknown>) => (await w.post(w.ops, { accountId: w.kzt, ...body })).operation.id as number;
  const july = await op({ type: 'income', paidAt: '2026-07-05T06:00:00Z', amount: 50_000, lines: [{ categoryId: w.income, projectId: w.project, amount: 50_000 }] });
  await op({ type: 'income', paidAt: '2026-08-01T06:00:00Z', amount: 500_000, lines: [{ categoryId: investment, projectId: w.project, amount: 500_000 }] });
  const august = await op({ type: 'income', paidAt: '2026-09-10T06:00:00Z', accrualDate: '2026-08-15', amount: 100_000, lines: [{ categoryId: w.income, amount: 100_000 }] });
  const rent2 = await op({ type: 'expense', paidAt: '2026-08-01T07:00:00Z', amount: 20_000, lines: [{ categoryId: w.expense, projectId: w.project2, amount: 20_000 }] });
  const rent3 = await op({ type: 'expense', paidAt: '2026-08-02T06:00:00Z', amount: 10_000, lines: [{ categoryId: w.expense, projectId: club3, amount: 10_000 }] });
  const bar3 = await op({ type: 'income', paidAt: '2026-08-03T06:00:00Z', amount: 40_000, lines: [{ categoryId: w.income, projectId: club3, amount: 40_000 }] });
  await op({ type: 'expense', paidAt: '2026-07-20T06:00:00Z', accrualDate: '2026-06-30', amount: 30_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 30_000 }] });
  await w.post(w.ops, { type: 'transfer', paidAt: '2026-07-21T06:00:00Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100 });
  const cola = await w.receipt('2026-07-01T06:00:00Z', [[w.cola, 10_000, 100_000]]);
  const purchase = await op({
    type: 'expense',
    paidAt: '2026-07-03T06:00:00Z',
    amount: 120_000,
    counterpartyId: w.supplier,
    lines: [
      { categoryId: supply, amount: 90_000 },
      { categoryId: w.expense, amount: 30_000 },
    ],
    stockPayments: [{ docId: cola.id, amount: 100_000 }],
  });
  await w.sale('2026-08-10T06:00:00Z', [[w.cola, 4000, 200_000]]);
  await w.writeoff('2026-09-12T06:00:00Z', [[w.cola, 1000]]);
  await w.doc({ type: 'sale', at: '2026-09-20T06:00:00Z', warehouseId: w.wh2, lines: [{ itemId: w.chips, qty: 1000, amount: 70_000 }] });
  expect((await w.h.req('POST', `/api/v1/companies/${w.cid}/projects/${club3}/archive`)).statusCode).toBe(200);
  return { supply, club3, july, august, rent2, rent3, bar3, purchase };
}

/** Итоги «Прибыли» за тот же период и с теми же параметрами: доходы, расходы, прибыль. */
async function pnlTotals(qs: string) {
  const r = await get<{ rows: (PnlRow & { children?: PnlRow[] })[] }>(`${base()}/pnl?${Q3}&step=month&${qs}`);
  return ['income', 'expense', 'profit'].map((id) => r.rows.find((x) => x.id === id)!.total);
}

describe('«Проекты»: GET /companies/:cid/analytics/projects (§7)', () => {
  it('по правилам «Прибыли»: дата сделки, исключения, склад — расходом проекта склада; архивные — вместе; «Без проекта» и «Всего»', async () => {
    const q = await quarter();
    const r = await projects('');
    expect(r.meta).toEqual({ from: '2026-07-01', to: '2026-09-30', status: 'active', mode: 'projects', currency: 'KZT', empty: false, stock: true, noBatch: 1 });
    // «Клуб 1»: себестоимость 400 + списание 100; без проекта: 1 200 - оплата закупки 1 000; инвестиции и расход за июнь не входят
    expect(sums(r.rows)).toEqual([
      ['Клуб 1', 50_000, 50_000],
      ['Клуб 2', 0, 20_000],
      ['Архивные проекты (вместе)', 40_000, 10_000],
      ['Без проекта', 100_000, 20_000],
    ]);
    expect(r.rows.map((x) => x.id)).toEqual([`project:${w.project}`, `project:${w.project2}`, 'project:archived', 'project:none']);
    expect(r.total).toEqual({ id: 'total', kind: 'total', label: 'Всего', income: 190_000, expense: 100_000 });

    // статусы: архивный — своей строкой с пометкой, активные — вместе; «Все» — каждый проект; «Всего» не меняется
    const archived = await projects('status=archived');
    expect(sums(archived.rows)).toEqual([
      ['Клуб 3', 40_000, 10_000],
      ['Активные проекты (вместе)', 50_000, 70_000],
      ['Без проекта', 100_000, 20_000],
    ]);
    expect(archived.rows[0]).toMatchObject({ id: `project:${q.club3}`, archived: true });
    const all = await projects('status=all');
    expect(all.rows.map((x) => x.label)).toEqual(['Клуб 1', 'Клуб 2', 'Клуб 3', 'Без проекта']);
    for (const x of [archived, all]) expect(x.total).toEqual(r.total);
  });

  it('итоги равны итогам «Прибыли» за тот же период, фильтр и склад; строки дают «Всего»', async () => {
    const q = await quarter();
    for (const qs of ['', 'stock=0', `categories=${w.expense}`, `accounts=${w.kzt}`, `counterparties=${w.supplier}&stock=0`, 'withoutCategory=true', `tags=${w.tag}`]) {
      for (const status of ['active', 'archived', 'all']) {
        const r = await projects(`status=${status}&${qs}`);
        expect([r.total.income, r.total.expense, r.total.income - r.total.expense], `${status} ${qs}`).toEqual(await pnlTotals(qs));
        expect([r.rows.reduce((s, x) => s + x.income, 0), r.rows.reduce((s, x) => s + x.expense, 0)]).toEqual([r.total.income, r.total.expense]);
      }
    }
    // склад выключен: оплата закупки — обычный расход, строк склада нет
    expect(sums((await projects('stock=0')).rows)).toEqual([
      ['Клуб 1', 50_000, 0],
      ['Клуб 2', 0, 20_000],
      ['Архивные проекты (вместе)', 40_000, 10_000],
      ['Без проекта', 100_000, 120_000],
    ]);
    // фильтр по категории убирает склад
    const rent = await projects(`categories=${w.expense}`);
    expect(sums(rent.rows)).toEqual([
      ['Клуб 1', 0, 0],
      ['Клуб 2', 0, 20_000],
      ['Архивные проекты (вместе)', 0, 10_000],
      ['Без проекта', 0, 5_000],
    ]);
    expect(rent.meta.noBatch).toBe(0);
    expect(q.club3).toBeGreaterThan(0);
  });

  it('«Проекты с категориями»: категории верхнего уровня и строки склада внутри проекта; пустой период — «Без проекта» и «Всего»', async () => {
    const q = await quarter();
    const r = await projects('mode=categories&status=all');
    const children = (label: string) => sums(r.rows.find((x) => x.label === label)!.children!);
    expect(children('Клуб 1')).toEqual([
      ['Бар', 50_000, 0],
      ['Себестоимость проданных товаров', 0, 40_000],
      ['Списания товаров', 0, 10_000],
    ]);
    expect(children('Без проекта')).toEqual([
      ['Бар', 100_000, 0],
      ['Аренда', 0, 5_000],
      ['Закуп бара', 0, 15_000],
    ]);
    expect(r.rows.find((x) => x.label === 'Без проекта')!.children!.map((x) => x.id)).toEqual([
      `project:none:category:${w.income}`,
      `project:none:category:${w.expense}`,
      `project:none:category:${q.supply}`,
    ]);
    const empty = await get<Projects>(`${base()}/projects?from=2026-01-01&to=2026-01-31&mode=categories`);
    expect(empty.meta.empty).toBe(true);
    expect(sums(empty.rows)).toEqual([['Без проекта', 0, 0]]);
    expect(empty.rows[0]!.children).toBeUndefined();
    expect(empty.total).toMatchObject({ income: 0, expense: 0 });
  });

  it('операции ячейки: доходы, расходы и все операции строки; проекты статуса вместе; категория в проекте; оплата закупки — частью', async () => {
    const q = await quarter();
    const ids = async (qs: string) => (await cell(qs)).items.map((i) => [i.id, i.part]);
    expect(await ids(`row=project:${w.project}&col=income`)).toEqual([[q.july, null]]);
    // расходы «Клуба 1» — только склад: список пуст
    expect(await ids(`row=project:${w.project}&col=expense`)).toEqual([]);
    expect(await ids('row=project:none&col=expense')).toEqual([[q.purchase, 20_000]]);
    expect(await ids('row=project:none&col=expense&stock=0')).toEqual([[q.purchase, null]]);
    expect(await ids('row=project:archived&col=total')).toEqual([
      [q.bar3, null],
      [q.rent3, null],
    ]);
    expect(await ids(`row=project:none:category:${q.supply}&col=expense`)).toEqual([[q.purchase, 15_000]]);
    expect(await ids(`row=project:active&col=expense&stock=0`)).toEqual([[q.rent2, null]]);
    // «Всего» — все операции периода по дате сделки, без инвестиций, перевода и расхода за июнь
    expect((await ids('row=total&col=total')).map(([id]) => id)).toEqual([q.august, q.bar3, q.rent3, q.rent2, q.july, q.purchase]);

    const url = (qs: string) => `${base()}/operations?report=projects&${Q3}&${qs}`;
    expect(await fieldError(url(`row=project:${w.project}:stock:cogs&col=expense`))).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    expect(await fieldError(url('row=income&col=total'))).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    expect(await fieldError(url('row=project:none&col=2026-07-01'))).toEqual({ col: 'Неизвестная колонка' });
    expect(await fieldError(`${base()}/projects?${Q3}&status=closed`)).toEqual({ status: 'Статус — active, archived или all' });
    expect(await fieldError(`${base()}/projects?${Q3}&mode=table`)).toEqual({ mode: 'Режим — projects или categories' });
    expect(await fieldError(`${base()}/projects?from=2026-09-30&to=2026-07-01`)).toEqual({ to: 'Конец периода раньше начала' });
    const other = await w.h.company('Чужая');
    const foreign = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужой', currency: 'KZT', openedAt: '2026-01-01', startingBalance: 0 })).account.id as number;
    expect(await fieldError(`${base()}/projects?${Q3}&accounts=${foreign}`)).toEqual({ accounts: 'Неизвестный счёт' });
  });

  it('границы периода, фильтр проектов и «(вместе)» (разбор задачи 3): склад и «Нет партии» — по периоду, проекты в запросе не читаются, «(вместе)» раскрывается ровно в проекты статуса', async () => {
    const q = await quarter();
    // склад вне периода не входит ни в строки, ни в «Нет партии»: продажа колы (август) и «Нет партии» (сентябрь) — вне июля
    const july = await get<Projects>(`${base()}/projects?from=2026-07-01&to=2026-07-31&status=all`);
    expect(july.meta).toMatchObject({ stock: true, noBatch: 0 });
    expect(sums(july.rows)).toEqual([
      ['Клуб 1', 50_000, 0],
      ['Клуб 2', 0, 0],
      ['Клуб 3', 0, 0],
      ['Без проекта', 0, 20_000],
    ]);
    // фильтр по проектам отчётом не читается: строки и «Всего» те же, что без него
    const plain = await projects('');
    const filtered = await projects(`projects=${w.project2}&withoutProject=true`);
    expect(filtered.rows).toEqual(plain.rows);
    expect(filtered.total).toEqual(plain.total);
    // ячейка: то же — проекты в запросе строку не сужают
    const ids = async (qs: string) => (await cell(qs)).items.map((i) => i.id);
    expect(await ids(`row=project:${w.project}&col=income&projects=${w.project2}`)).toEqual([q.july]);
    // «(вместе)» активных при статусе «архивные»: ровно проекты справочника без архива; сумма ячейки равна строке
    const archived = await projects('status=archived');
    const others = archived.rows.find((x) => x.id === 'project:active')!;
    expect(await ids('row=project:active&col=income')).toEqual([q.july]);
    expect(await ids('row=project:active&col=expense&stock=0')).toEqual([q.rent2]);
    expect(others.income).toBe(50_000);
  });

  it('Excel: сведения об отчёте, колонки экрана, проценты числами и «—», категории с отступом, «Всего»', async () => {
    await quarter();
    const res = await w.h.req('GET', `${base()}/projects.xlsx?${Q3}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Проекты - 06-10-2026 17-00.xlsx');
    const all = sheetRows(res.rawPayload);
    const head = all.findIndex((r) => r[0] === 'Проект');
    expect(all.slice(0, head).map((r) => r[0])).toEqual([
      'Отчёт: Проекты',
      'Период: 01.07.2026 – 30.09.2026',
      'Проекты: активные проекты',
      'Режим: только проекты',
      'Фильтры: нет',
      'Склад: по себестоимости',
      'У 1 продажи себестоимость не определена — прибыль завышена',
    ]);
    expect(all.slice(head)).toEqual([
      ['Проект', 'Доходы', 'Расходы', 'Прибыль', 'Доход / Расход, %', 'Рентабельность, %'],
      ['Клуб 1', '500.00', '500.00', '0.00', '100.00', '0'],
      ['Клуб 2', '0.00', '200.00', '-200.00', '0.00', '—'],
      ['Архивные проекты (вместе)', '400.00', '100.00', '300.00', '400.00', '75'],
      ['Без проекта', '1000.00', '200.00', '800.00', '500.00', '80'],
      ['Всего', '1900.00', '1000.00', '900.00', '190.00', '47'],
    ]);
    const withCategories = sheetRows((await w.h.req('GET', `${base()}/projects.xlsx?${Q3}&mode=categories&status=archived&stock=0`)).rawPayload);
    const at = withCategories.findIndex((r) => r[0] === 'Проект');
    expect(withCategories.slice(0, at).map((r) => r[0])).toContain('Склад: закупки');
    expect(withCategories.slice(at + 1).map((r) => r[0])).toEqual(['Клуб 3 (архив)', '    Бар', '    Аренда', 'Активные проекты (вместе)', '    Бар', '    Аренда', 'Без проекта', '    Бар', '    Аренда', '    Закуп бара', 'Всего']);
  });

  it('withoutProject в запросе операций ячейки отбрасывается: строка «Без проекта» и проекты те же, что без него', async () => {
    const q = await quarter();
    const ids = async (qs: string) => (await cell(qs)).items.map((i) => i.id);
    expect(await ids(`row=project:${w.project}&col=income&withoutProject=true`)).toEqual([q.july]);
    expect(await ids('row=project:none&col=total&withoutProject=true')).toEqual(await ids('row=project:none&col=total'));
    expect((await ids('row=project:none&col=total')).length).toBeGreaterThan(0);
    expect(await ids('row=total&col=total&withoutProject=true')).toEqual(await ids('row=total&col=total'));
  });

  it('длинный период с step=day у ячейки «Проектов» — 200: колонок у отчёта нет, проверка числа колонок не применяется (R11)', async () => {
    await quarter();
    const long = `${base()}/operations?report=projects&from=2026-01-01&to=2026-09-30&step=day&row=project:none&col=total`;
    expect((await w.h.req('GET', long)).statusCode).toBe(200);
    // у «Денег» тот же запрос по-прежнему отвергается
    const cashflow = await w.h.req('GET', `${base()}/operations?report=cashflow&from=2026-01-01&to=2026-09-30&step=day&row=income&col=total`);
    expect(cashflow.statusCode).toBe(400);
  });

  it('нет компании — 404; чужой счёт — 400; архивная компания читается: «Проекты», Excel и операции ячейки', async () => {
    await quarter();
    const paths = [`projects?${Q3}`, `projects.xlsx?${Q3}`, `operations?report=projects&${Q3}&row=project:none&col=total`];
    for (const path of paths) {
      const missing = await w.h.req('GET', `/api/v1/companies/999999/analytics/${path}`);
      expect(missing.statusCode, `${path}: ${missing.body}`).toBe(404);
      expect((missing.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
    const other = await w.h.company('Другая');
    const own = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Своя', currency: 'KZT', openedAt: '2026-01-01', startingBalance: 0 })).account.id as number;
    for (const path of paths) {
      expect(await fieldError(`/api/v1/companies/${other}/analytics/${path}&accounts=${w.kzt}`), path).toEqual({ accounts: 'Неизвестный счёт' });
    }
    await w.post(`/api/v1/companies/${other}/accounts/${own}/archive`, {});
    await w.post(`/api/v1/companies/${other}/archive`, {});
    for (const path of paths) {
      const res = await w.h.req('GET', `/api/v1/companies/${other}/analytics/${path}`);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(200);
    }
  });
});
