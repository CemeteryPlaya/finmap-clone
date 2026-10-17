import { describe, expect, it } from 'vitest';
import { startOfDayUtc } from '../../src/shared/dates';
import { columnStarts, reportColumns, type ReportDicts, type ReportLine } from '../../src/shared/report-engine';
import {
  defaultPart,
  indicatorPercentText,
  indicatorRows,
  INDICATOR_PARTS,
  partCategories,
  partText,
  templateCategoryIds,
  type IndicatorLine,
  type IndicatorPart,
  type PartConfig,
} from '../../src/shared/report-indicators';
import { pnlRows, type StockCost } from '../../src/shared/report-pnl';

const TZ = 'Asia/Almaty';
const almaty = (date: string) => new Date(Date.parse(startOfDayUtc(date, TZ)) + 12 * 3_600_000).toISOString();

/** Справочники: «Инвестиции» исключены (§5.1); «Налоги» и «НДС» — системные; «Кола» — подкатегория «Закупа бара». */
const dicts: ReportDicts = {
  categories: [
    { id: 1, kind: 'income', parentId: null, name: 'Бар', archived: false },
    { id: 2, kind: 'income', parentId: null, name: 'Инвестиции', archived: false, systemKey: 'investment' },
    { id: 3, kind: 'income', parentId: null, name: 'Игровое время', archived: false },
    { id: 10, kind: 'expense', parentId: null, name: 'Аренда', archived: false },
    { id: 11, kind: 'expense', parentId: null, name: 'Закуп бара', archived: false },
    { id: 12, kind: 'expense', parentId: 11, name: 'Кола', archived: false },
    { id: 13, kind: 'expense', parentId: null, name: 'Налоги', archived: false, systemKey: 'tax' },
    { id: 14, kind: 'expense', parentId: 13, name: 'ИПН', archived: false },
    { id: 15, kind: 'expense', parentId: null, name: 'НДС', archived: false, systemKey: 'vat' },
  ],
  counterparties: [],
  projects: [{ id: 30, name: 'Клуб 1', archived: false }],
};

const line = (type: 'income' | 'expense', amount: number, categoryId: number | null, date: string, cut = 0): IndicatorLine => ({
  at: almaty(date),
  type,
  accountId: 1,
  categoryId,
  projectId: 30,
  counterpartyId: null,
  amount,
  cut,
});

const columns = reportColumns('2026-07-01', '2026-09-30', 'month');
const starts = columnStarts(columns, TZ);

/** Июль–сентябрь: доходы «Бар», «Игровое время», без категории и «Инвестиции»; расходы — аренда, закуп (оплатил склад), кола, налоги, НДС. */
const lines: IndicatorLine[] = [
  line('income', 100_000, 1, '2026-07-05'),
  line('income', 300_000, 3, '2026-08-05'),
  line('income', 5_000, null, '2026-08-06'),
  line('income', 1_000_000, 2, '2026-08-07'),
  line('expense', 50_000, 10, '2026-07-10'),
  line('expense', 40_000, 11, '2026-07-11', 30_000),
  line('expense', 7_000, 12, '2026-08-12'),
  line('expense', 9_000, 14, '2026-09-01'),
  line('expense', 2_000, 15, '2026-09-02'),
  line('expense', 1_000, null, '2026-09-03'),
  line('income', 999_000, 1, '2026-10-01'),
];
const costs: StockCost[] = [
  { at: almaty('2026-08-20'), kind: 'cogs', projectId: 30, amount: 20_000 },
  { at: almaty('2026-09-20'), kind: 'writeoff', projectId: 30, amount: 4_000 },
];

const parts = (over: Partial<Record<IndicatorPart, Partial<PartConfig>>> = {}): Record<IndicatorPart, PartConfig> => {
  const base = { cogs: [11], variable: [11, 10] };
  return Object.fromEntries(INDICATOR_PARTS.map((p) => [p, { ...defaultPart(p, base), ...over[p] }])) as Record<IndicatorPart, PartConfig>;
};
const row = (r: ReturnType<typeof indicatorRows>, id: string) => r.rows.find((x) => x.id === id)!;
const pnl = (stock: boolean) =>
  pnlRows({
    columns,
    starts,
    lines: lines.map(({ cut, ...l }): ReportLine => ({ ...l, amount: l.amount - (stock ? cut : 0) })),
    by: 'category',
    dicts,
    filter: {},
    stock: stock ? { costs, noBatch: [] } : null,
  });

describe('«Финансовые показатели»: умолчания и категории частей (§8.2)', () => {
  it('умолчания: «Выручка» — все доходы; «Себестоимость» и «Переменные» — склад и категории шаблона; «Операционные» — все и склад', () => {
    const template = { cogs: [11], variable: [11, 10] };
    expect(defaultPart('revenue', template)).toEqual({ allCategories: true, categoryIds: [], includeStock: false });
    expect(defaultPart('cogs', template)).toEqual({ allCategories: false, categoryIds: [11], includeStock: true });
    expect(defaultPart('variable', template)).toEqual({ allCategories: false, categoryIds: [11, 10], includeStock: true });
    expect(defaultPart('operating', template)).toEqual({ allCategories: true, categoryIds: [], includeStock: true });
    // компания без шаблона «Компьютерный клуб»: категорий шаблона нет — только склад
    expect(defaultPart('cogs', { cogs: [], variable: [] })).toEqual({ allCategories: false, categoryIds: [], includeStock: true });
  });

  it('категории шаблона — по ссылке шаблона и порядку справочника', () => {
    const cats = [
      { id: 5, templateRef: 'computer-club:loyalty' },
      { id: 6, templateRef: null },
      { id: 7, templateRef: 'computer-club:bar-purchase' },
    ];
    expect(templateCategoryIds(cats, ['computer-club:bar-purchase', 'computer-club:loyalty'])).toEqual([5, 7]);
    expect(templateCategoryIds(cats, [])).toEqual([]);
  });

  it('«Все категории» — флаг: новая категория входит; список — только выбранные с подкатегориями; исключённые — никогда', () => {
    const all = partCategories('revenue', { allCategories: true, categoryIds: [], includeStock: false }, dicts.categories);
    expect([...all.ids]).toEqual([1, 3]);
    expect(all.uncategorized).toBe(true);
    const later = [...dicts.categories, { id: 4, kind: 'income' as const, parentId: null, name: 'Турниры', archived: false }];
    expect([...partCategories('revenue', { allCategories: true, categoryIds: [], includeStock: false }, later).ids]).toEqual([1, 3, 4]);
    const list = partCategories('revenue', { allCategories: false, categoryIds: [1, 2], includeStock: false }, later);
    expect([...list.ids]).toEqual([1]);
    expect(list.uncategorized).toBe(false);
    expect([...partCategories('cogs', { allCategories: false, categoryIds: [11], includeStock: true }, dicts.categories).ids]).toEqual([11, 12]);
    // «Операционные расходы» — все расходы без налогов и НДС (и их подкатегорий)
    expect([...partCategories('operating', { allCategories: true, categoryIds: [], includeStock: true }, dicts.categories).ids]).toEqual([10, 11, 12]);
    expect([...partCategories('variable', { allCategories: true, categoryIds: [], includeStock: true }, dicts.categories).ids]).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('текст части: «Все категории…», названия, «Категорий нет», склад', () => {
    expect(partText('revenue', { allCategories: true, includeStock: false }, [])).toBe('Все категории дохода');
    expect(partText('cogs', { allCategories: false, includeStock: true }, ['Закуп бара'])).toBe('Закуп бара, себестоимость склада (FIFO)');
    expect(partText('variable', { allCategories: false, includeStock: false }, [])).toBe('Категорий нет');
    expect(partText('operating', { allCategories: true, includeStock: true }, [])).toBe('Все категории расхода, кроме налогов и НДС, себестоимость склада (FIFO)');
    expect([indicatorPercentText(null), indicatorPercentText(14), indicatorPercentText(-3), indicatorPercentText(0)]).toEqual(['—', '14%', '\u22123%', '0%']);
  });
});

describe('«Финансовые показатели»: формулы и сверка с «Прибылью» (§8.1)', () => {
  it('показатели по колонкам и «Итого»; вне периода и исключённые не входят', () => {
    const r = indicatorRows({ starts, lines, categories: dicts.categories, parts: parts(), stock: costs });
    expect(r.empty).toBe(false);
    // Выручка: июль 1 000, август 3 050 (с «Без категории»), сентябрь 0
    // Себестоимость: «Закуп бара» 400 - оплата 300 + «Кола» 70 + склад 200 и 40
    expect(row(r, 'gross')).toEqual({ id: 'gross', label: 'Валовая прибыль', values: [100_000 - 10_000, 305_000 - 7_000 - 20_000, -4_000], total: 364_000 });
    // Переменные: закуп и кола (без оплаты) + аренда + склад
    expect(row(r, 'marginal').values).toEqual([100_000 - 10_000 - 50_000, 305_000 - 7_000 - 20_000, -4_000]);
    // Операционные: все расходы без налогов и НДС (с «Без категории») и склад
    expect(row(r, 'ebitda').values).toEqual([40_000, 278_000, -4_000 - 1_000]);
    // Процент маржи: Прибыль ÷ Выручка; в сентябре выручки нет — «—»
    const profit = pnl(true).rows.find((x) => x.id === 'profit')!;
    expect(profit.values).toEqual([40_000, 278_000, -16_000]);
    expect(row(r, 'margin').values).toEqual([40, 91, null]);
    expect(row(r, 'margin').total).toBe(Math.round((302_000 * 100) / 405_000));
  });

  it('при «Всех категориях» показатели сходятся со строками «Прибыли» — со складом и без', () => {
    for (const stock of [true, false]) {
      const p = pnl(stock);
      const total = (id: string) => p.rows.find((x) => x.id === id)!.values as number[];
      const stockRows = (p.rows.find((x) => x.id === 'expense')!.children ?? []).filter((c) => c.kind === 'stock');
      const all = { allCategories: true, categoryIds: [], includeStock: stock };
      const r = indicatorRows({ starts, lines, categories: dicts.categories, parts: parts({ cogs: all, variable: all }), stock: stock ? costs : null });
      // Выручка = «Доходы»; Маржинальный доход («все расходы») = «Прибыль»
      const revenue = total('income');
      expect(row(r, 'marginal').values).toEqual(total('profit'));
      // EBITDA = «Прибыль» + налоги и НДС
      expect(row(r, 'ebitda').values).toEqual(total('profit').map((v, i) => v + [0, 0, 11_000][i]!));
      // Себестоимость только склад = строки склада «Прибыли»
      const onlyStock = indicatorRows({ starts, lines, categories: dicts.categories, parts: parts({ cogs: { allCategories: false, categoryIds: [], includeStock: true } }), stock: stock ? costs : null });
      const stockSum = revenue.map((_, i) => stockRows.reduce((s, x) => s + (x.values[i] as number), 0));
      expect(row(onlyStock, 'gross').values).toEqual(revenue.map((v, i) => v - stockSum[i]!));
    }
  });

  it('флажок склада у части: включён — оплата закупки вычитается и строки склада входят; выключен — расход целиком, склада нет', () => {
    const on = indicatorRows({ starts, lines, categories: dicts.categories, parts: parts({ cogs: { allCategories: false, categoryIds: [11], includeStock: true } }), stock: costs });
    const off = indicatorRows({ starts, lines, categories: dicts.categories, parts: parts({ cogs: { allCategories: false, categoryIds: [11], includeStock: false } }), stock: costs });
    expect(row(on, 'gross').values).toEqual([90_000, 278_000, -4_000]);
    expect(row(off, 'gross').values).toEqual([60_000, 298_000, 0]);
    // у компании без склада (stock null) флажок ничего не добавляет
    const none = indicatorRows({ starts, lines: lines.map((l) => ({ ...l, cut: 0 })), categories: dicts.categories, parts: parts(), stock: null });
    expect(row(none, 'gross').values).toEqual([60_000, 298_000, 0]);
  });

  it('пустой период: нули, «Процент маржи» — «—»', () => {
    const r = indicatorRows({ starts, lines: [], categories: dicts.categories, parts: parts(), stock: [] });
    expect(r.empty).toBe(true);
    expect(r.rows.map((x) => [x.id, x.values, x.total])).toEqual([
      ['gross', [0, 0, 0], 0],
      ['marginal', [0, 0, 0], 0],
      ['ebitda', [0, 0, 0], 0],
      ['margin', [null, null, null], null],
    ]);
  });
});
