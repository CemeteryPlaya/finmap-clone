import { describe, expect, it } from 'vitest';
import { startOfDayUtc } from '../../src/shared/dates';
import { columnStarts, parseDrillRow, reportColumns, shareBp, sharePercent, type ReportDicts, type ReportLine, type ReportRow } from '../../src/shared/report-engine';
import { isFullyPaid, paymentExclusions, pnlExcludedCategories, pnlRows, stockKept, type StockCost, type StockInput } from '../../src/shared/report-pnl';

const TZ = 'Asia/Almaty';
const almaty = (date: string) => new Date(Date.parse(startOfDayUtc(date, TZ)) + 12 * 3_600_000).toISOString();

/** Категории компании: системные «Инвестиции» (доход) и «Дивиденды» (расход) с подкатегорией, «Зарплата» — обычный расход. */
const dicts: ReportDicts = {
  categories: [
    { id: 1, kind: 'income', parentId: null, name: 'Бар', archived: false },
    { id: 2, kind: 'income', parentId: null, name: 'Инвестиции', archived: false, systemKey: 'investment' },
    { id: 10, kind: 'expense', parentId: null, name: 'Аренда', archived: false },
    { id: 11, kind: 'expense', parentId: null, name: 'Закуп бара', archived: false },
    { id: 12, kind: 'expense', parentId: null, name: 'Дивиденды', archived: false, systemKey: 'dividends' },
    { id: 13, kind: 'expense', parentId: 12, name: 'Дивиденды учредителю', archived: false },
    { id: 14, kind: 'expense', parentId: null, name: 'Зарплата', archived: false, systemKey: 'salary' },
    { id: 15, kind: 'expense', parentId: null, name: 'Погашение кредита', archived: false, systemKey: 'credit_repayment' },
  ],
  counterparties: [{ id: 20, name: 'Поставщик А', archived: false }],
  projects: [
    { id: 30, name: 'Клуб 1', archived: false },
    { id: 31, name: 'Клуб 2', archived: false },
    { id: 32, name: 'Клуб 3', archived: true },
  ],
};

const Q3 = reportColumns('2026-07-01', '2026-09-30', 'month');
const starts = columnStarts(Q3, TZ);

const line = (date: string, type: 'income' | 'expense', amount: number, extra: Partial<ReportLine> = {}): ReportLine => ({
  at: almaty(date),
  type,
  accountId: 1,
  categoryId: null,
  projectId: null,
  counterpartyId: null,
  amount,
  ...extra,
});
const cost = (date: string, kind: StockCost['kind'], amount: number, projectId = 30): StockCost => ({ at: almaty(date), kind, projectId, amount });
const find = (rows: readonly ReportRow[], id: string): ReportRow => {
  for (const r of rows) {
    if (r.id === id) return r;
    const inner = r.children?.find((c) => c.id === id);
    if (inner) return inner;
  }
  throw new Error(`нет строки ${id}`);
};
const run = (lines: ReportLine[], extra: { by?: 'category' | 'counterparty' | 'project'; stock?: StockInput | null; filter?: Parameters<typeof pnlRows>[0]['filter'] } = {}) =>
  pnlRows({ columns: Q3, starts, lines, by: extra.by ?? 'category', dicts, filter: extra.filter ?? {}, stock: extra.stock ?? null });

const LINES = [
  line('2026-07-10', 'income', 100_000, { categoryId: 1, projectId: 30 }),
  line('2026-08-05', 'income', 50_000, { categoryId: 2 }),
  line('2026-08-20', 'expense', 30_000, { categoryId: 10, projectId: 30, counterpartyId: 20 }),
  line('2026-09-01', 'expense', 20_000, { categoryId: 13 }),
  line('2026-09-02', 'expense', 40_000, { categoryId: 14, projectId: 31 }),
  line('2026-09-03', 'expense', 7_000, { categoryId: 15 }),
];

describe('«Прибыль»: исключения и строки (§5.1, §5.2)', () => {
  it('исключены системные инвестиции, дивиденды (с подкатегорией), займы и кредиты; зарплата — обычный расход', () => {
    expect([...pnlExcludedCategories(dicts.categories)].sort((a, b) => a - b)).toEqual([2, 12, 13, 15]);
  });

  it('«Прибыль», «Доходы», «Расходы»: исключённые категории не видны даже нулями, прибыль = доходы - расходы по колонкам', () => {
    const r = run(LINES);
    expect(r.rows.map((x) => [x.id, x.label])).toEqual([
      ['profit', 'Прибыль'],
      ['income', 'Доходы'],
      ['expense', 'Расходы'],
    ]);
    expect(find(r.rows, 'income').children!.map((c) => [c.label, c.total])).toEqual([['Бар', 100_000]]);
    expect(find(r.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([
      ['Аренда', 30_000],
      ['Закуп бара', 0],
      ['Зарплата', 40_000],
    ]);
    expect(find(r.rows, 'income').values).toEqual([100_000, 0, 0]);
    expect(find(r.rows, 'expense').values).toEqual([0, 30_000, 40_000]);
    expect(find(r.rows, 'profit').values).toEqual([100_000, -30_000, -40_000]);
    expect(find(r.rows, 'profit').total).toBe(30_000);
    expect(r).toMatchObject({ empty: false, noBatch: 0 });
  });

  it('пустой период — только итоговые строки с нулями; одни исключённые операции — тоже пусто', () => {
    for (const lines of [[], [line('2026-08-05', 'income', 50_000, { categoryId: 2 })]]) {
      const r = run(lines);
      expect(r.empty).toBe(true);
      expect(r.rows.map((x) => [x.id, x.total, x.children?.length ?? 0])).toEqual([
        ['profit', 0, 0],
        ['income', 0, 0],
        ['expense', 0, 0],
      ]);
    }
  });

  it('«Прибыль» раскрывается в операции обеих групп; строки склада — нет; доля в сотых процента со знаком', () => {
    expect(parseDrillRow('profit')).toEqual({ types: ['income', 'expense'], dim: null, id: null, own: false });
    expect(parseDrillRow('expense:stock:cogs')).toBeNull();
    expect(shareBp(1250, 10_000)).toBe(1250);
    expect(shareBp(-1250, 10_000)).toBe(-1250);
    expect(shareBp(-1, 30_000)).toBe(0);
    expect(shareBp(5, 0)).toBeNull();
    expect(sharePercent(-1250, 10_000)).toBe('\u221212,50\u00A0%');
  });
});

describe('«Прибыль»: склад по себестоимости (§5.3)', () => {
  const stock: StockInput = {
    costs: [cost('2026-07-15', 'cogs', 12_000), cost('2026-08-15', 'cogs', 3_000, 31), cost('2026-09-10', 'writeoff', 1_500), cost('2026-10-01', 'cogs', 99_999)],
    noBatch: [
      { at: almaty('2026-08-16'), projectId: 30 },
      { at: almaty('2026-09-20'), projectId: 31 },
      { at: almaty('2026-10-02'), projectId: 30 },
    ],
  };

  it('по категориям: «Себестоимость проданных товаров» и «Списания товаров» в конце «Расходов», в итогах и прибыли; вне периода — нет', () => {
    const r = run(LINES, { stock });
    const expense = find(r.rows, 'expense');
    expect(expense.children!.map((c) => [c.id, c.kind, c.label])).toEqual([
      ['expense:category:10', 'category', 'Аренда'],
      ['expense:category:11', 'category', 'Закуп бара'],
      ['expense:category:14', 'category', 'Зарплата'],
      ['expense:stock:cogs', 'stock', 'Себестоимость проданных товаров'],
      ['expense:stock:writeoff', 'stock', 'Списания товаров'],
    ]);
    expect(find(r.rows, 'expense:stock:cogs').values).toEqual([12_000, 3_000, 0]);
    expect(find(r.rows, 'expense:stock:writeoff').values).toEqual([0, 0, 1_500]);
    expect(expense.values).toEqual([12_000, 33_000, 41_500]);
    expect(expense.total).toBe(86_500);
    expect(find(r.rows, 'profit').values).toEqual([88_000, -33_000, -41_500]);
    // «Нет партии»: две продажи в периоде, третья — в октябре
    expect(r.noBatch).toBe(2);
  });

  it('по контрагентам — строки «(склад)»; по проектам — суммы склада в строке проекта склада, архивный проект с одним складом виден', () => {
    const byCp = run(LINES, { by: 'counterparty', stock });
    expect(find(byCp.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([
      ['Поставщик А', 30_000],
      ['Без контрагента', 40_000],
      ['Себестоимость (склад)', 15_000],
      ['Списания (склад)', 1_500],
    ]);
    const byProject = run(LINES, { by: 'project', stock: { costs: [...stock.costs, cost('2026-07-20', 'writeoff', 500, 32)], noBatch: [] } });
    expect(find(byProject.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([
      ['Клуб 1', 43_500],
      ['Клуб 2', 43_000],
      ['Клуб 3', 500],
    ]);
    expect(find(byProject.rows, 'expense').total).toBe(87_000);
  });

  it('фильтр: категории, контрагенты, теги, счета убирают склад; проекты оставляют склады выбранных проектов', () => {
    expect(stockKept({ categoryIds: [10] }, 30)).toBe(false);
    expect(stockKept({ tagIds: [1] }, 30)).toBe(false);
    expect(stockKept({ accountIds: [1] }, 30)).toBe(false);
    expect(stockKept({ withoutCounterparty: true }, 30)).toBe(false);
    expect(stockKept({ projectIds: [31] }, 30)).toBe(false);
    expect(stockKept({ projectIds: [31], withoutProject: true }, 31)).toBe(true);
    expect(stockKept({ withoutProject: true }, 30)).toBe(false);
    expect(stockKept({}, 30)).toBe(true);
    const byCategory = run(LINES.filter((l) => l.categoryId === 10), { stock, filter: { categoryIds: [10] } });
    expect(find(byCategory.rows, 'expense').children!.map((c) => c.id)).toEqual(['expense:category:10']);
    expect(byCategory.noBatch).toBe(0);
    const club2 = run(LINES.filter((l) => l.projectId === 31), { stock, filter: { projectIds: [31] } });
    expect(find(club2.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([
      ['Аренда', 0],
      ['Закуп бара', 0],
      ['Зарплата', 40_000],
      ['Себестоимость проданных товаров', 3_000],
    ]);
    expect(club2.noBatch).toBe(1);
  });

  it('в периоде только документы склада: отчёт не пустой, строки склада есть, категорий нулями нет', () => {
    const r = run([], { stock });
    expect(r.empty).toBe(false);
    expect(find(r.rows, 'expense').children!.map((c) => c.id)).toEqual(['expense:stock:cogs', 'expense:stock:writeoff']);
    expect(find(r.rows, 'income').children).toBeUndefined();
    expect(find(r.rows, 'profit').total).toBe(-16_500);
  });

  it('склад включён, документов нет, операции есть — строки склада нулями; пустой период — без них', () => {
    const r = run(LINES, { stock: { costs: [], noBatch: [] } });
    expect(find(r.rows, 'expense:stock:cogs').total).toBe(0);
    expect(run([], { stock: { costs: [], noBatch: [] } }).rows.map((x) => x.children?.length ?? 0)).toEqual([0, 0, 0]);
  });
});

describe('оплата закупки делится по строкам расхода (allocate, §5.3)', () => {
  it('пропорционально суммам строк, сумма частей равна оплате', () => {
    expect([
      ...paymentExclusions([
        {
          paid: 25_000,
          lines: [
            { id: 1, amount: 30_000 },
            { id: 2, amount: 20_000 },
          ],
        },
      ]),
    ]).toEqual([
      [1, 15_000],
      [2, 10_000],
    ]);
    // 2 тиына на три строки по 1: остаток — первым по порядку
    const odd = paymentExclusions([
      {
        paid: 2,
        lines: [
          { id: 1, amount: 1 },
          { id: 2, amount: 1 },
          { id: 3, amount: 1 },
        ],
      },
    ]);
    expect([...odd.values()]).toEqual([1, 1, 0]);
  });

  it('оплата больше суммы расхода — исключается весь расход; нулевая оплата и отрицательная строка — без исключения', () => {
    expect([...paymentExclusions([{ paid: 900, lines: [{ id: 7, amount: 500 }] }])]).toEqual([[7, 500]]);
    expect(paymentExclusions([{ paid: 0, lines: [{ id: 7, amount: 500 }] }]).size).toBe(0);
    expect(
      paymentExclusions([
        {
          paid: 100,
          lines: [
            { id: 7, amount: 500 },
            { id: 8, amount: -100 },
          ],
        },
      ]).size,
    ).toBe(0);
  });

  it('R1: «полностью оплачена» — из той же логики исключения; расход с отрицательной строкой не считается оплаченным', () => {
    const full = { paid: 900, lines: [{ id: 7, amount: 500 }] };
    const partial = { paid: 100, lines: [{ id: 7, amount: 500 }] };
    const negative = {
      paid: 400,
      lines: [
        { id: 7, amount: 500 },
        { id: 8, amount: -100 },
      ],
    };
    expect(isFullyPaid(full)).toBe(true);
    expect(isFullyPaid(partial)).toBe(false);
    expect(isFullyPaid({ paid: 0, lines: full.lines })).toBe(false);
    // сумма строк = 400 = оплата, но отрицательная строка отменяет исключение: срез 0, а не 400
    expect(isFullyPaid(negative)).toBe(false);
    expect(paymentExclusions([negative]).size).toBe(0);
  });
});
