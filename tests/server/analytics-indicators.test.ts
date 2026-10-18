import { afterEach, describe, expect, it } from 'vitest';
import { marginPercent } from '../../src/shared/report-projects';
import { opsWorld } from '../helpers/ops';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { sheetRows } from '../helpers/xlsx-rows';

let w: StockWorld | Awaited<ReturnType<typeof opsWorld>>;
afterEach(async () => w?.h.t.cleanup());

interface Part {
  allCategories: boolean;
  categoryIds: number[];
  includeStock: boolean;
  isDefault: boolean;
}
type Parts = Record<'revenue' | 'cogs' | 'variable' | 'operating', Part>;
interface Indicators {
  columns: { key: string; label: string }[];
  rows: { id: string; label: string; values: (number | null)[]; total: number | null }[];
  parts: Parts;
  meta: { from: string; to: string; step: string; currency: string; empty: boolean; stock: boolean; noBatch: number };
}

const Q3 = 'from=2026-07-01&to=2026-09-30';
const base = () => `/api/v1/companies/${w.cid}/analytics`;
const get = async <T>(url: string): Promise<T> => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
};
const indicators = (qs = '') => get<Indicators>(`${base()}/indicators?${Q3}&${qs}`);
const values = (r: Indicators, id: string) => {
  const row = r.rows.find((x) => x.id === id)!;
  return [...row.values, row.total];
};
const put = async (part: string, body: Record<string, unknown>) => {
  const res = await w.h.req('PUT', `${base()}/indicators/parts/${part}`, body);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { parts: Parts }).parts;
};
const pnl = async (qs = '') => {
  const r = await get<{ rows: { id: string; values: number[]; total: number }[] }>(`${base()}/pnl?${Q3}&step=month&${qs}`);
  const at = (id: string) => {
    const row = r.rows.find((x) => x.id === id)!;
    return [...row.values, row.total];
  };
  return { income: at('income'), expense: at('expense'), profit: at('profit') };
};

/**
 * Третий квартал 2026 (синтетика, ₸): доходы «Бар» 500 (июль) и 1 000 (август), «Инвестиции» 5 000 (исключены); расходы —
 * «Аренда» 200 (июль), расход 1 200 (900 «Закуп бара» и 300 «Аренда»), оплативший 1 000 поступления колы; «Налоги» 100 (сентябрь).
 * Склад «Клуб 1»: продажа 4 колы (себестоимость 400, август), списание колы (100, сентябрь).
 */
async function quarter() {
  const s = await stockWorld();
  w = s;
  const c = `/api/v1/companies/${s.cid}/categories`;
  const supply = (await s.post(c, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const tree = (await s.h.req('GET', c)).json() as Record<'income' | 'expense', { id: number; systemKey: string | null }[]>;
  const investment = tree.income.find((x) => x.systemKey === 'investment')!.id;
  const tax = tree.expense.find((x) => x.systemKey === 'tax')!.id;
  for (const account of [s.kzt, s.usd]) await s.h.req('PATCH', `/api/v1/companies/${s.cid}/accounts/${account}`, { openedAt: '2026-01-01' });
  const op = async (body: Record<string, unknown>) => (await s.post(s.ops, { accountId: s.kzt, ...body })).operation.id as number;
  const bar = await op({ type: 'income', paidAt: '2026-07-05T06:00:00Z', amount: 50_000, lines: [{ categoryId: s.income, amount: 50_000 }] });
  await op({ type: 'income', paidAt: '2026-08-05T06:00:00Z', amount: 100_000, lines: [{ categoryId: s.income, amount: 100_000 }] });
  await op({ type: 'income', paidAt: '2026-08-06T06:00:00Z', amount: 500_000, lines: [{ categoryId: investment, amount: 500_000 }] });
  const rent = await op({ type: 'expense', paidAt: '2026-07-10T06:00:00Z', amount: 20_000, lines: [{ categoryId: s.expense, amount: 20_000 }] });
  await op({ type: 'expense', paidAt: '2026-09-10T06:00:00Z', amount: 10_000, lines: [{ categoryId: tax, amount: 10_000 }] });
  const cola = await s.receipt('2026-07-01T06:00:00Z', [[s.cola, 10_000, 100_000]]);
  const purchase = await op({
    type: 'expense',
    paidAt: '2026-07-03T06:00:00Z',
    amount: 120_000,
    counterpartyId: s.supplier,
    lines: [
      { categoryId: supply, amount: 90_000 },
      { categoryId: s.expense, amount: 30_000 },
    ],
    stockPayments: [{ docId: cola.id, amount: 100_000 }],
  });
  await s.sale('2026-08-10T06:00:00Z', [[s.cola, 4000, 200_000]]);
  await s.writeoff('2026-09-12T06:00:00Z', [[s.cola, 1000]]);
  return { s, supply, tax, bar, rent, purchase };
}

describe('«Финансовые показатели»: GET /companies/:cid/analytics/indicators (§8)', () => {
  it('умолчания: «Выручка» и «Операционные» — все категории, склад в частях расходов; Процент маржи = Прибыль ÷ Выручка', async () => {
    const q = await quarter();
    const r = await indicators();
    expect(r.columns.map((c) => c.label)).toEqual(['Июль 2026', 'Август 2026', 'Сентябрь 2026']);
    expect(r.meta).toEqual({ from: '2026-07-01', to: '2026-09-30', step: 'month', currency: 'KZT', empty: false, stock: true, noBatch: 0 });
    // «Общий» шаблон: в «Себестоимости» и «Переменных» только склад
    expect(r.parts.cogs).toEqual({ allCategories: false, categoryIds: [], includeStock: true, isDefault: true });
    expect(r.parts.operating).toEqual({ allCategories: true, categoryIds: [], includeStock: true, isDefault: true });
    expect(r.rows.map((x) => x.label)).toEqual(['Валовая прибыль', 'Маржинальный доход', 'EBITDA', 'Процент маржи']);
    // себестоимость — только склад: 400 в августе, 100 в сентябре
    expect(values(r, 'gross')).toEqual([50_000, 60_000, -10_000, 100_000]);
    // операционные: аренда 200 + 300, закуп 900 - оплата 750 (allocate 1 000 на 900/300) + склад; налоги не входят
    const p = await pnl();
    expect(values(r, 'ebitda')).toEqual(p.profit.map((v, i) => v + [0, 0, 10_000, 10_000][i]!));
    expect(values(r, 'margin')).toEqual([marginPercent(p.profit[0]!, 50_000), marginPercent(p.profit[1]!, 100_000), null, marginPercent(p.profit[3]!, 150_000)]);
    expect(values(r, 'margin')).toEqual([20, 60, null, 33]);
    expect(q.tax).toBeGreaterThan(0);
  });

  it('при «Всех категориях» Маржинальный доход = «Прибыль» со складом; без склада у части — расходы целиком, как «Прибыль» без склада', async () => {
    await quarter();
    await put('variable', { allCategories: true, categoryIds: [], includeStock: true });
    const on = await indicators();
    const p = await pnl();
    expect(values(on, 'marginal')).toEqual(p.profit);
    // «Выручка» — итог «Доходов» «Прибыли»: Валовая прибыль при пустой «Себестоимости» без склада
    await put('cogs', { allCategories: false, categoryIds: [], includeStock: false });
    expect(values(await indicators(), 'gross')).toEqual(p.income);
    await put('variable', { allCategories: true, categoryIds: [], includeStock: false });
    const off = await pnl('stock=0');
    expect(values(await indicators(), 'marginal')).toEqual(off.profit);
  });

  it('категория, созданная после настройки: входит в «Все категории», но не в список', async () => {
    const q = await quarter();
    await put('cogs', { allCategories: false, categoryIds: [q.supply], includeStock: false });
    await put('variable', { allCategories: true, categoryIds: [], includeStock: false });
    const before = await indicators();
    const late = (await q.s.post(`/api/v1/companies/${q.s.cid}/categories`, { kind: 'expense', name: 'Расходники' })).category.id as number;
    await q.s.post(q.s.ops, { type: 'expense', accountId: q.s.kzt, paidAt: '2026-09-15T06:00:00Z', amount: 7_000, lines: [{ categoryId: late, amount: 7_000 }] });
    const after = await indicators();
    expect(values(after, 'gross')).toEqual(values(before, 'gross'));
    expect(values(after, 'marginal')).toEqual(values(before, 'marginal').map((v, i) => v! - [0, 0, 7_000, 7_000][i]!));
  });

  it('пустой период: нули и «—» у Процента маржи', async () => {
    await quarter();
    const r = await get<Indicators>(`${base()}/indicators?from=2025-01-01&to=2025-06-30&step=quarter`);
    expect(r.meta.empty).toBe(true);
    expect(r.rows.map((x) => [x.id, ...values(r, x.id)])).toEqual([
      ['gross', 0, 0, 0],
      ['marginal', 0, 0, 0],
      ['ebitda', 0, 0, 0],
      ['margin', null, null, null],
    ]);
  });

  it('шаблон «Компьютерный клуб»: «Закуп бара» в «Себестоимости», пять категорий в «Переменных»', async () => {
    w = await opsWorld();
    await w.post(`/api/v1/companies/${w.cid}/projects`, { name: 'Клуб 3', templateKey: 'computer-club', templateParams: { pcCount: 10 } });
    const tree = (await w.h.req('GET', `/api/v1/companies/${w.cid}/categories`)).json() as { expense: { id: number; name: string; children: { id: number; name: string; templateRef: string | null }[] }[] };
    const byName = new Map(tree.expense.flatMap((c) => c.children).map((c) => [c.name, c.id]));
    const r = await indicators();
    expect(r.parts.cogs).toEqual({ allCategories: false, categoryIds: [byName.get('Закуп бара')], includeStock: true, isDefault: true });
    const variable = ['Закуп бара', 'Лояльность и бонусы за пополнение', 'Призовые турниров', 'Расходники', 'Комиссии банка и эквайринга'].map((n) => byName.get(n)!);
    expect([...r.parts.variable.categoryIds].sort((a, b) => a - b)).toEqual([...variable].sort((a, b) => a - b));
    expect(r.parts.variable.includeStock).toBe(true);
  });

  it('ошибки: шаг только месяцы и кварталы, период до 5 лет', async () => {
    w = await opsWorld();
    for (const qs of ['step=week', 'step=day']) expect((await w.h.req('GET', `${base()}/indicators?${Q3}&${qs}`)).statusCode).toBe(400);
    expect((await w.h.req('GET', `${base()}/indicators?from=2020-01-01&to=2026-12-31`)).statusCode).toBe(400);
  });
});

describe('«Финансовые показатели»: настройка частей и история (§8.2, §9)', () => {
  it('PUT сохраняет часть и пишет историю; повтор без изменений — без записи; DELETE «Вернуть по умолчанию»', async () => {
    const q = await quarter();
    const parts = await put('cogs', { allCategories: false, categoryIds: [q.supply, q.supply], includeStock: false });
    expect(parts.cogs).toEqual({ allCategories: false, categoryIds: [q.supply], includeStock: false, isDefault: false });
    await put('cogs', { allCategories: false, categoryIds: [q.supply], includeStock: false });
    // «Выручка»: склада нет — флажок не сохраняется
    expect((await put('revenue', { allCategories: false, categoryIds: [q.s.income], includeStock: true })).revenue).toEqual({
      allCategories: false,
      categoryIds: [q.s.income],
      includeStock: false,
      isDefault: false,
    });
    expect(w.h.auditCount('indicator_part', 'update')).toBe(2);
    const reset = await w.h.req('DELETE', `${base()}/indicators/parts/cogs`);
    expect(reset.statusCode, reset.body).toBe(200);
    expect((reset.json() as { parts: Parts }).parts.cogs).toEqual({ allCategories: false, categoryIds: [], includeStock: true, isDefault: true });
    // уже по умолчанию — ничего не пишется
    expect((await w.h.req('DELETE', `${base()}/indicators/parts/cogs`)).statusCode).toBe(200);
    expect(w.h.auditCount('indicator_part', 'reset')).toBe(1);
    const history = (await get<{ entries: { action: string; userName: string; diff: { part: string; before: { text: string }; after: { text: string; categories: string[] } } }[] }>(
      `/api/v1/companies/${w.cid}/audit?entity=indicator_part`,
    )).entries;
    expect(history.map((e) => [e.action, e.diff.part, e.diff.before.text, e.diff.after.text])).toEqual([
      ['reset', 'cogs', 'Закуп бара', 'Категорий нет, себестоимость склада (FIFO)'],
      ['update', 'revenue', 'Все категории дохода', expect.any(String)],
      ['update', 'cogs', 'Категорий нет, себестоимость склада (FIFO)', 'Закуп бара'],
    ]);
    expect(history[0]!.userName).toBe('Тест');
  });

  it('то же, что умолчание, не сохраняется и не пишет историю; порядок id не важен (§17.9)', async () => {
    const q = await quarter();
    // «Выручка» по умолчанию — все категории дохода: такой же PUT ничего не меняет
    expect((await put('revenue', { allCategories: true, categoryIds: [], includeStock: false })).revenue.isDefault).toBe(true);
    const other = (await q.s.post(`/api/v1/companies/${q.s.cid}/categories`, { kind: 'expense', name: 'Расходники' })).category.id as number;
    await put('variable', { allCategories: false, categoryIds: [q.supply, other], includeStock: true });
    await put('variable', { allCategories: false, categoryIds: [other, q.supply], includeStock: true });
    expect(w.h.auditCount('indicator_part')).toBe(1);
  });

  it('удалённая категория выпадает из сохранённой части, и следующее «Сохранить» проходит', async () => {
    const q = await quarter();
    const unused = (await q.s.post(`/api/v1/companies/${q.s.cid}/categories`, { kind: 'expense', name: 'Химчистка' })).category.id as number;
    await put('variable', { allCategories: false, categoryIds: [q.supply, unused], includeStock: true });
    const del = await w.h.req('DELETE', `/api/v1/companies/${q.s.cid}/categories/${unused}`);
    expect(del.statusCode, del.body).toBeLessThan(300);
    expect((await indicators()).parts.variable.categoryIds).toEqual([q.supply]);
    expect((await put('variable', { allCategories: false, categoryIds: [q.supply], includeStock: false })).variable).toEqual({
      allCategories: false,
      categoryIds: [q.supply],
      includeStock: false,
      isDefault: false,
    });
  });

  it('инвестиции, дивиденды, займы и кредиты в показатели не входят — 400', async () => {
    const q = await quarter();
    const tree = (await w.h.req('GET', `/api/v1/companies/${q.s.cid}/categories`)).json() as Record<'income' | 'expense', { id: number; systemKey: string | null }[]>;
    const investment = tree.income.find((x) => x.systemKey === 'investment')!.id;
    const dividends = tree.expense.find((x) => x.systemKey === 'dividends')!.id;
    for (const [part, id] of [['revenue', investment], ['operating', dividends]] as const) {
      const res = await w.h.req('PUT', `${base()}/indicators/parts/${part}`, { allCategories: false, categoryIds: [id], includeStock: false });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toEqual({ categoryIds: 'Инвестиции, дивиденды, займы и кредиты в показатели не входят' });
    }
    expect(w.h.auditCount('indicator_part')).toBe(0);
  });

  it('400 — чужая или не того вида категория, неверное тело; 404 — неизвестная часть; архивная компания — только чтение', async () => {
    const q = await quarter();
    const bad = await w.h.req('PUT', `${base()}/indicators/parts/revenue`, { allCategories: false, categoryIds: [q.supply], includeStock: false });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toEqual({ categoryIds: 'Неизвестная категория дохода' });
    expect((await w.h.req('PUT', `${base()}/indicators/parts/cogs`, { allCategories: 'да' })).statusCode).toBe(400);
    expect((await w.h.req('PUT', `${base()}/indicators/parts/profit`, { allCategories: true, categoryIds: [], includeStock: true })).statusCode).toBe(404);
    w.h.t.sqlite.prepare('UPDATE companies SET archived_at = ? WHERE id = ?').run('2026-10-06T00:00:00.000Z', w.cid);
    const archived = await w.h.req('PUT', `${base()}/indicators/parts/cogs`, { allCategories: true, categoryIds: [], includeStock: true });
    expect(archived.statusCode).toBe(422);
    expect((await w.h.req('DELETE', `${base()}/indicators/parts/cogs`)).statusCode).toBe(422);
    expect((await w.h.req('GET', `${base()}/indicators?${Q3}`)).statusCode).toBe(200);
    expect(w.h.auditCount('indicator_part')).toBe(0);
  });
});

describe('«Финансовые показатели»: операции ячейки и Excel (§8.1, §2.5, §2.6)', () => {
  it('операции показателя: доходы «Выручки» и расходы его части; склад части — расход, целиком оплативший закупку, не входит', async () => {
    const q = await quarter();
    const cell = async (qs: string) =>
      (await get<{ items: { id: number; part: number | null }[] }>(`${base()}/operations?report=indicators&${Q3}&step=month&${qs}`)).items.map((i) => [i.id, i.part]);
    await put('cogs', { allCategories: false, categoryIds: [q.supply], includeStock: true });
    // июль: доход «Бар» и закуп: 900 «Закупа бара» минус оплата 750 — часть 150
    expect(await cell('row=gross&col=2026-07-01')).toEqual([
      [q.bar, null],
      [q.purchase, 15_000],
    ]);
    await put('cogs', { allCategories: false, categoryIds: [q.supply], includeStock: false });
    expect(await cell('row=gross&col=2026-07-01')).toEqual([
      [q.bar, null],
      [q.purchase, 90_000],
    ]);
    // «Процент маржи» — все строки «Прибыли» колонки (со складом компании): аренда, закуп (часть без оплаты), доход
    expect((await cell('row=margin&col=2026-07-01')).map(([id]) => id)).toEqual([q.rent, q.bar, q.purchase]);
    expect((await w.h.req('GET', `${base()}/operations?report=indicators&${Q3}&step=month&row=profit&col=total`)).statusCode).toBe(400);
  });

  it('Excel: сведения с настройкой частей, колонки экрана, проценты числами и «—»', async () => {
    await quarter();
    const res = await w.h.req('GET', `${base()}/indicators.xlsx?${Q3}&step=quarter`);
    expect(res.statusCode).toBe(200);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toMatch(/ТОО - Финансовые показатели - 06-10-2026 17-00\.xlsx/);
    const rows = sheetRows(res.rawPayload);
    expect(rows.slice(0, 8).map((r) => r[0])).toEqual([
      'Отчёт: Финансовые показатели',
      'Период: 01.07.2026 – 30.09.2026',
      'Шаг: по кварталам',
      'Выручка: Все категории дохода',
      'Себестоимость проданных товаров (COGS): Категорий нет, себестоимость склада (FIFO)',
      'Переменные расходы: Категорий нет, себестоимость склада (FIFO)',
      'Операционные расходы: Все категории расхода, кроме налогов и НДС, себестоимость склада (FIFO)',
      'Фильтры: нет',
    ]);
    expect(rows.slice(8)).toEqual([
      ['Показатель', 'III кв. 2026', 'Итого'],
      ['Валовая прибыль', '1000.00', '1000.00'],
      ['Маржинальный доход', '1000.00', '1000.00'],
      ['EBITDA', '600.00', '600.00'],
      ['Процент маржи, %', '33', '33'],
    ]);
    const empty = sheetRows((await w.h.req('GET', `${base()}/indicators.xlsx?from=2025-01-01&to=2025-03-31`)).rawPayload);
    expect(empty.at(-1)).toEqual(['Процент маржи, %', '—', '—', '—', '—']);
  });
});
