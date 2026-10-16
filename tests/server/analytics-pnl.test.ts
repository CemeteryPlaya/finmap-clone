import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld;
afterEach(async () => w?.h.t.cleanup());

interface Row {
  id: string;
  kind: string;
  label: string;
  values: (number | null)[];
  total: number | null;
  children?: Row[];
}
interface Report {
  columns: { key: string; label: string }[];
  rows: Row[];
  meta: { empty: boolean; stock?: boolean; noBatch?: number };
}
interface Item {
  id: number;
  type: string;
  paidAt: string;
  accrualDate: string | null;
  lines: { categoryId: number | null; baseAmount: number }[];
}

const Q3 = 'from=2026-07-01&to=2026-09-30&step=month';
const base = () => `/api/v1/companies/${w.cid}/analytics`;
const get = async <T>(url: string): Promise<T> => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
};
const pnl = (qs: string) => get<Report>(`${base()}/pnl?${qs}`);
const cell = (qs: string) => get<{ items: { id: number; part: number | null }[] }>(`${base()}/operations?report=pnl&${Q3}&${qs}`);
const find = (rows: Row[], id: string): Row => {
  for (const r of rows) {
    if (r.id === id) return r;
    const inner = r.children?.find((c) => c.id === id);
    if (inner) return inner;
  }
  throw new Error(`нет строки ${id}`);
};
/** Строки разреза с суммами: [название, итог]. */
const named = (rows: Row[], id: string) => find(rows, id).children!.filter((c) => c.total !== 0 || c.kind === 'stock').map((c) => [c.label, c.total]);

/**
 * Третий квартал 2026 (синтетика): доходы «Бар» 500 ₸ в июле и 1 000 ₸ с оплатой в сентябре и датой сделки в августе;
 * «Инвестиции» 5 000 ₸ (исключены); зарплата 400 ₸ с оплатой в сентябре за август; разбитый расход 300 ₸ с датой сделки
 * в июне; перевод. Склад «Клуб 1»: поступления колы 10 шт за 1 000 ₸ и чипсов 5 шт за 250 ₸; расход 1 200 ₸ (900 ₸
 * «Закуп бара» и 300 ₸ «Аренда») оплатил 1 000 ₸ колы; расход 250 ₸ целиком оплатил чипсы. Продажи: 4 колы в августе
 * (себестоимость 400 ₸), 7 чипсов в сентябре (5 с партией — 250 ₸, 2 — «Нет партии»), кола со склада «Клуб 2» без
 * поступлений («Нет партии»); списание колы в сентябре — 100 ₸.
 */
async function quarter() {
  w = await stockWorld();
  const c = `/api/v1/companies/${w.cid}/categories`;
  const supply = (await w.post(c, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const tree = (await w.h.req('GET', c)).json() as Record<'income' | 'expense', { id: number; systemKey: string | null }[]>;
  const list = [...tree.income, ...tree.expense];
  const key = (k: string) => list.find((x) => x.systemKey === k)!.id;
  for (const account of [w.kzt, w.usd]) await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${account}`, { openedAt: '2026-01-01' });
  const op = async (body: Record<string, unknown>) => (await w.post(w.ops, { accountId: w.kzt, ...body })).operation.id as number;
  const july = await op({ type: 'income', paidAt: '2026-07-05T06:00:00Z', amount: 50_000, lines: [{ categoryId: w.income, projectId: w.project, amount: 50_000 }] });
  const august = await op({ type: 'income', paidAt: '2026-09-10T06:00:00Z', accrualDate: '2026-08-15', amount: 100_000, lines: [{ categoryId: w.income, amount: 100_000 }] });
  const investment = await op({ type: 'income', paidAt: '2026-08-01T06:00:00Z', amount: 500_000, lines: [{ categoryId: key('investment'), amount: 500_000 }] });
  const salary = await op({ type: 'expense', paidAt: '2026-09-05T06:00:00Z', accrualDate: '2026-08-01', amount: 40_000, lines: [{ categoryId: key('salary'), amount: 40_000 }] });
  const june = await op({
    type: 'expense',
    paidAt: '2026-07-20T06:00:00Z',
    accrualDate: '2026-06-30',
    amount: 30_000,
    lines: [
      { categoryId: w.expense, projectId: w.project, amount: 20_000 },
      { categoryId: supply, projectId: w.project2, amount: 10_000 },
    ],
  });
  await w.post(w.ops, { type: 'transfer', paidAt: '2026-07-21T06:00:00Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100 });
  const cola = await w.receipt('2026-07-01T06:00:00Z', [[w.cola, 10_000, 100_000]]);
  const chips = await w.receipt('2026-07-02T06:00:00Z', [[w.chips, 5000, 25_000]]);
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
  const paidOff = await op({
    type: 'expense',
    paidAt: '2026-07-04T06:00:00Z',
    amount: 25_000,
    counterpartyId: w.supplier,
    lines: [{ categoryId: supply, amount: 25_000 }],
    stockPayments: [{ docId: chips.id, amount: 25_000 }],
  });
  await w.sale('2026-08-10T06:00:00Z', [[w.cola, 4000, 200_000]]);
  await w.sale('2026-09-15T06:00:00Z', [[w.chips, 7000, 70_000]]);
  await w.doc({ type: 'sale', at: '2026-09-20T06:00:00Z', warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 50_000 }] });
  await w.writeoff('2026-09-12T06:00:00Z', [[w.cola, 1000]]);
  return { supply, july, august, investment, salary, june, purchase, paidOff, excluded: ['investment', 'dividends', 'loan_issued', 'loan_repaid', 'credit_received', 'credit_repayment'].map(key) };
}

describe('«Прибыль»: GET /companies/:cid/analytics/pnl', () => {
  it('склад включён: дата сделки, исключения, оплата закупки делится по строкам, себестоимость, списания, «Нет партии»', async () => {
    const q = await quarter();
    const r = await pnl(Q3);
    expect(r.columns.map((x) => x.label)).toEqual(['Июль 2026', 'Август 2026', 'Сентябрь 2026']);
    expect(r.meta).toMatchObject({ empty: false, stock: true, noBatch: 2 });
    expect(r.rows.map((x) => [x.id, x.label])).toEqual([
      ['profit', 'Прибыль'],
      ['income', 'Доходы'],
      ['expense', 'Расходы'],
    ]);
    // доход с датой сделки в августе — в августе; инвестиции не видны даже нулём
    expect(find(r.rows, 'income').values).toEqual([50_000, 100_000, 0]);
    expect(find(r.rows, 'income').children!.map((x) => x.label)).toEqual(['Бар']);
    // 1 000 ₸ оплаты колы делится по строкам 900 и 300: 750 и 250 — в расходах остаются 150 и 50; расход за чипсы — целиком склад
    expect(named(r.rows, 'expense')).toEqual([
      ['Зарплата', 40_000],
      ['Аренда', 5_000],
      ['Закуп бара', 15_000],
      ['Себестоимость проданных товаров', 65_000],
      ['Списания товаров', 10_000],
    ]);
    expect(find(r.rows, 'expense:stock:cogs').values).toEqual([0, 40_000, 25_000]);
    expect(find(r.rows, 'expense').values).toEqual([20_000, 80_000, 35_000]);
    expect(find(r.rows, 'profit').values).toEqual([30_000, 20_000, -35_000]);
    expect(find(r.rows, 'profit').total).toBe(15_000);
    // исключённые системные категории не видны даже нулями
    const shown = new Set(find(r.rows, 'expense').children!.map((x) => x.id));
    for (const id of q.excluded) expect(shown.has(`expense:category:${id}`)).toBe(false);

    // по проектам: себестоимость и списания — в строке проекта склада «Клуб 1»
    const byProject = await pnl(`${Q3}&by=project`);
    expect(named(byProject.rows, 'expense')).toEqual([
      ['Клуб 1', 75_000],
      ['Без проекта', 60_000],
    ]);
    // фильтр по категории убирает склад и предупреждение
    const filtered = await pnl(`${Q3}&categories=${q.supply}`);
    expect(named(filtered.rows, 'expense')).toEqual([['Закуп бара', 15_000]]);
    expect(filtered.meta.noBatch).toBe(0);
  });

  it('склад выключен: оплаты закупок — обычные расходы своих категорий, строк склада нет; «Деньги» переключатель не меняет', async () => {
    await quarter();
    const r = await pnl(`${Q3}&stock=0`);
    expect(r.meta).toMatchObject({ stock: false, noBatch: 0 });
    expect(named(r.rows, 'expense')).toEqual([
      ['Зарплата', 40_000],
      ['Аренда', 30_000],
      ['Закуп бара', 115_000],
    ]);
    expect(find(r.rows, 'profit').values).toEqual([-95_000, 60_000, 0]);
    const on = await get<unknown>(`${base()}/cashflow?${Q3}&stock=1`);
    const off = await get<unknown>(`${base()}/cashflow?${Q3}&stock=0`);
    expect(off).toEqual(on);
  });

  it('сверка с журналом: «Прибыль» без склада = доходы и расходы журнала по дате сделки без переводов и исключённых категорий', async () => {
    const q = await quarter();
    const r = await pnl(`${Q3}&stock=0`);
    const items = (await get<{ items: Item[] }>(`${w.ops}?limit=200`)).items;
    const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(iso));
    const sums = { income: [0, 0, 0], expense: [0, 0, 0] };
    for (const i of items) {
      if (i.type === 'transfer') continue;
      const date = i.accrualDate ?? day(i.paidAt);
      if (date < '2026-07-01' || date > '2026-09-30') continue;
      const month = Number(date.slice(5, 7)) - 7;
      for (const l of i.lines) if (l.categoryId === null || !q.excluded.includes(l.categoryId)) sums[i.type as 'income' | 'expense'][month]! += l.baseAmount;
    }
    expect(find(r.rows, 'income').values).toEqual(sums.income);
    expect(find(r.rows, 'expense').values).toEqual(sums.expense);
    expect(find(r.rows, 'profit').total).toBe(sums.income.reduce((a, b) => a + b) - sums.expense.reduce((a, b) => a + b));
  });

  it('пустой период: только итоговые строки, без строк склада; компания без складов — склад не учитывается', async () => {
    await quarter();
    const empty = await pnl('from=2026-01-01&to=2026-03-31&step=month');
    expect(empty.meta).toMatchObject({ empty: true, noBatch: 0 });
    expect(empty.rows.map((x) => [x.id, x.total, x.children?.length ?? 0])).toEqual([
      ['profit', 0, 0],
      ['income', 0, 0],
      ['expense', 0, 0],
    ]);
    const other = await w.h.company('ТОО Без склада');
    expect(((await w.h.req('GET', `/api/v1/companies/${other}/analytics/pnl?${Q3}`)).json() as Report).meta.stock).toBe(false);
  });
});

describe('операции ячейки «Прибыли»', () => {
  it('по дате сделки; часть расхода без оплаты закупки; целиком оплативший закупку расход не входит; исключённые — нет', async () => {
    const q = await quarter();
    // доход оплачен в сентябре, сделка — в августе
    expect((await cell('row=income&col=2026-08-01')).items.map((i) => [i.id, i.part])).toEqual([[q.august, null]]);
    expect((await cell(`row=expense:category:${q.supply}&col=2026-07-01`)).items.map((i) => [i.id, i.part])).toEqual([[q.purchase, 15_000]]);
    expect((await cell(`row=expense:category:${w.expense}&col=total`)).items.map((i) => [i.id, i.part])).toEqual([[q.purchase, 5_000]]);
    // без склада: расход за чипсы — в «Закупе бара», разбитый расход — частью строки
    expect((await cell(`row=expense:category:${q.supply}&col=total&stock=0`)).items.map((i) => [i.id, i.part])).toEqual([
      [q.paidOff, null],
      [q.purchase, 90_000],
    ]);
    // «Прибыль» за квартал: новые по дате платежа сверху; инвестиции, перевод и расход с датой сделки в июне — нет
    expect((await cell('row=profit&col=total')).items.map((i) => i.id)).toEqual([q.august, q.salary, q.july, q.purchase]);
  });
});

describe('«Прибыль»: переключатель склада и разрез склада', () => {
  it('сверка по колонкам: расходы без склада минус со складом = исключённые части оплат минус (себестоимость + списания)', async () => {
    await quarter();
    const on = await pnl(Q3);
    const off = await pnl(`${Q3}&stock=0`);
    // оплаты закупок 1 000 ₸ (кола) и 250 ₸ (чипсы) приходятся на расходы июля
    const excludedParts = [125_000, 0, 0];
    const cogs = find(on.rows, 'expense:stock:cogs').values as number[];
    const writeoff = find(on.rows, 'expense:stock:writeoff').values as number[];
    const withStock = find(on.rows, 'expense').values as number[];
    const withoutStock = find(off.rows, 'expense').values as number[];
    for (let i = 0; i < 3; i++) expect(withoutStock[i]! - withStock[i]!, `колонка ${i}`).toBe(excludedParts[i]! - (cogs[i]! + writeoff[i]!));
  });

  it('фильтр по контрагенту и «Без категории» убирают строки склада и «Нет партии»; без фильтра склад по контрагентам — «(склад)»', async () => {
    await quarter();
    const stockRows = (r: Report) => (find(r.rows, 'expense').children ?? []).filter((c) => c.kind === 'stock').map((c) => c.label);
    expect(stockRows(await pnl(`${Q3}&counterparties=${w.supplier}`))).toEqual([]);
    expect((await pnl(`${Q3}&counterparties=${w.supplier}`)).meta.noBatch).toBe(0);
    expect(stockRows(await pnl(`${Q3}&withoutCategory=true`))).toEqual([]);
    expect((await pnl(`${Q3}&withoutCategory=true`)).meta.noBatch).toBe(0);
    expect(stockRows(await pnl(`${Q3}&by=counterparty`))).toEqual(['Себестоимость (склад)', 'Списания (склад)']);
    // фильтр по проекту склада оставляет склад, по другому проекту — убирает (у «Клуба 2» себестоимости нет, только «Нет партии»)
    expect(stockRows(await pnl(`${Q3}&projects=${w.project}`))).toEqual(['Себестоимость проданных товаров', 'Списания товаров']);
    expect(stockRows(await pnl(`${Q3}&projects=${w.project2}`))).toEqual([]);
  });
});

describe('операции ячейки «Прибыли»: «полностью оплачен» как в отчёте (R1)', () => {
  /** Расход поставщику в июле на данные суммы; оплата закупки — поступлением сиропа. */
  async function spend(lines: { categoryId: number; amount: number }[], pay: number) {
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    const receipt = await w.receipt('2026-07-01T06:00:00Z', [[w.syrup, 1000, Math.max(pay, 1000)]]);
    return (await w.post(w.ops, { accountId: w.kzt, type: 'expense', paidAt: '2026-07-06T06:00:00Z', amount, counterpartyId: w.supplier, lines, stockPayments: [{ docId: receipt.id, amount: pay }] })).operation
      .id as number;
  }
  const open = async () => {
    w = await stockWorld();
    await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { openedAt: '2026-01-01' });
  };
  const category = async (name: string) => (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name })).category.id as number;

  it('расход с отрицательной строкой оплаченным не считается: остаётся в списке, как и в сумме отчёта', async () => {
    await open();
    const r = await category('Прочее Р');
    const s = await category('Прочее С');
    // API не принимает отрицательную строку (сумма больше нуля): в базе её создаёт правка данных
    const op = await spend(
      [
        { categoryId: r, amount: 15_000 },
        { categoryId: s, amount: 5_000 },
      ],
      20_000, // оплата равна сумме расхода: старое условие «сумма больше оплат» убрало бы его из списка
    );
    w.h.t.sqlite.prepare('UPDATE operation_lines SET amount = -5000, base_amount = -5000 WHERE operation_id = ? AND category_id = ?').run(op, s);
    expect((await cell(`row=expense:category:${r}&col=total`)).items.map((i) => [i.id, i.part])).toEqual([[op, 15_000]]);
    const report = await pnl(Q3);
    expect(find(report.rows, `expense:category:${r}`).total).toBe(15_000);
    expect(find(report.rows, `expense:category:${s}`).total).toBe(-5_000);
  });

  it('фильтр оставил одну из строк: срез считается по всем строкам расхода — как в отчёте', async () => {
    await open();
    const p = await category('Закупка П');
    const o = await category('Закупка О');
    const lines = [
      { categoryId: p, amount: 10_000 },
      { categoryId: o, amount: 10_000 },
    ];
    const full = await spend(lines, 20_000); // обе строки оплачены целиком
    const half = await spend(lines, 10_000); // оплата делится 5 000 и 5 000
    // строка «П» без фильтра: оплаченный целиком расход не входит, половинный — частью 5 000
    expect((await cell(`row=expense:category:${p}&col=total`)).items.map((i) => [i.id, i.part])).toEqual([[half, 5_000]]);
    // фильтр оставил только «П»: то же
    expect((await cell(`row=expense&col=total&categories=${p}`)).items.map((i) => [i.id, i.part])).toEqual([[half, 5_000]]);
    const report = await pnl(`${Q3}&categories=${p}`);
    expect(find(report.rows, `expense:category:${p}`).total).toBe(5_000);
    // без склада оплачены не считаются: оба расхода в списке
    expect((await cell(`row=expense:category:${p}&col=total&stock=0`)).items.map((i) => i.id)).toEqual([half, full]);
  });
});

describe('«Прибыль»: ограничения запросов и «Нет партии» под фильтром проекта (R15)', () => {
  const failure = async (url: string) => {
    const res = await w.h.req('GET', url);
    expect(res.statusCode, res.body).toBe(400);
    return res.json().error.fields as Record<string, string>;
  };

  it('ячейка строки склада («Себестоимость», «Списания») в операции не раскрывается - 400 с полем row', async () => {
    await quarter();
    for (const row of ['expense:stock:cogs', 'expense:stock:writeoff']) {
      expect(await failure(`${base()}/operations?report=pnl&${Q3}&row=${row}&col=total`), row).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    }
  });

  it('счёт другой компании в «Прибыли» и в её операциях ячейки - 400 «Неизвестный счёт»', async () => {
    await quarter();
    const other = await w.h.company('ТОО Другая');
    const foreign = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: '2026-01-01', startingBalance: 0 })).account.id as number;
    expect(await failure(`${base()}/pnl?${Q3}&accounts=${foreign}`)).toEqual({ accounts: 'Неизвестный счёт' });
    expect(await failure(`${base()}/operations?report=pnl&${Q3}&row=income&col=total&accounts=${foreign}`)).toEqual({ accounts: 'Неизвестный счёт' });
  });

  it('«Нет партии» считается по проекту склада: у каждого клуба по одной продаже, без проекта-фильтра - две', async () => {
    await quarter();
    expect((await pnl(Q3)).meta.noBatch).toBe(2);
    expect((await pnl(`${Q3}&projects=${w.project}`)).meta.noBatch).toBe(1);
    expect((await pnl(`${Q3}&projects=${w.project2}`)).meta.noBatch).toBe(1);
  });
});

describe('операции ячейки «Прибыли»: страницы с пропуском полностью оплаченных расходов (R15)', () => {
  it('limit меньше числа строк, часть строк пропущена: обход по nextCursor без пропусков и повторов до null', async () => {
    w = await stockWorld();
    await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { openedAt: '2026-01-01' });
    const p = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Закупка П' })).category.id as number;
    const o = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Закупка О' })).category.id as number;
    const lines = [
      { categoryId: p, amount: 10_000 },
      { categoryId: o, amount: 10_000 },
    ];
    const spend = async (day: number, pay: number) => {
      const receipt = await w.receipt('2026-07-01T06:00:00Z', [[w.syrup, 1000, Math.max(pay, 1000)]]);
      const at = `2026-07-${String(day).padStart(2, '0')}T06:00:00Z`;
      return (await w.post(w.ops, { accountId: w.kzt, type: 'expense', paidAt: at, amount: 20_000, counterpartyId: w.supplier, lines, stockPayments: [{ docId: receipt.id, amount: pay }] })).operation.id as number;
    };
    // старые - новые: по два оплаченных целиком подряд между частично оплаченными и в начале списка
    await spend(2, 20_000);
    const half1 = await spend(3, 10_000);
    await spend(4, 20_000);
    await spend(5, 20_000);
    const half2 = await spend(6, 10_000);
    await spend(7, 20_000);
    const half3 = await spend(8, 10_000);
    await spend(9, 20_000);
    const url = (extra: string) => `${base()}/operations?report=pnl&${Q3}&row=expense:category:${p}&col=total${extra}`;
    const page = async (extra: string) => {
      const res = await w.h.req('GET', url(extra));
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { items: { id: number; part: number | null }[]; nextCursor: string | null };
    };
    const expected = [half3, half2, half1];
    expect((await page('&limit=200')).items.map((i) => i.id)).toEqual(expected);
    for (const limit of [1, 2]) {
      const seen: number[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const next: { items: { id: number; part: number | null }[]; nextCursor: string | null } = await page(`&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(next.items.length, `limit=${limit}`).toBeLessThanOrEqual(limit);
        seen.push(...next.items.map((i) => i.id));
        cursor = next.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor, `limit=${limit}: обход закончился`).toBeNull();
      expect(seen, `limit=${limit}`).toEqual(expected);
    }
  });
});
