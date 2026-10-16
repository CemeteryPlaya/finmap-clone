import { describe, expect, it } from 'vitest';
import { addDays, startOfDayUtc } from '../../src/shared/dates';
import { convertMinor, DEC_ONE, parseDecimal, type Dec } from '../../src/shared/decimal';
import {
  aggregate,
  balanceSeries,
  bucketOf,
  cashflowRows,
  columnCount,
  columnLabel,
  columnStarts,
  drillRange,
  hidesBalances,
  maxReportTo,
  parseDrillRow,
  reportColumns,
  sharePercent,
  type AccountLeg,
  type BalanceAccount,
  type ReportBy,
  type ReportDicts,
  type ReportLine,
  type ReportRow,
  type ReportStep,
  type TransferLeg,
} from '../../src/shared/report-engine';

const TZ = 'Asia/Almaty';

/** Момент по часам Алматы: «2026-10-14 00:30» → ISO UTC (смещение берётся на эту дату). */
const almaty = (date: string, time = '12:00') => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(Date.parse(startOfDayUtc(date, TZ)) + (h * 60 + m) * 60_000).toISOString();
};

const dicts: ReportDicts = {
  categories: [
    { id: 1, kind: 'income', parentId: null, name: 'Бар', archived: false },
    { id: 2, kind: 'income', parentId: null, name: 'Игровое время', archived: false },
    { id: 3, kind: 'income', parentId: 2, name: 'ПК', archived: false },
    { id: 4, kind: 'income', parentId: 2, name: 'Консоли', archived: false },
    { id: 5, kind: 'income', parentId: null, name: 'Старая категория', archived: true },
    { id: 6, kind: 'income', parentId: null, name: 'Архив без сумм', archived: true },
    { id: 10, kind: 'expense', parentId: null, name: 'Аренда', archived: false },
    { id: 11, kind: 'expense', parentId: null, name: 'Закуп бара', archived: false },
  ],
  counterparties: [
    { id: 20, name: 'Поставщик А', archived: false },
    { id: 21, name: 'Сотрудник А', archived: false },
  ],
  projects: [
    { id: 30, name: 'Клуб 1', archived: false },
    { id: 31, name: 'Клуб 2', archived: false },
    { id: 32, name: 'Клуб 3', archived: true },
  ],
};

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

const ids = (rows: readonly ReportRow[] | undefined) => (rows ?? []).map((r) => r.id);

describe('колонки шага (§2.3)', () => {
  it('месяцы года: 12 колонок «Январь 2026»…«Декабрь 2026», key — дата начала', () => {
    const cols = reportColumns('2026-01-01', '2026-12-31', 'month');
    expect(cols).toHaveLength(12);
    expect(cols[0]).toEqual({ key: '2026-01-01', from: '2026-01-01', to: '2026-01-31', label: 'Январь 2026' });
    expect(cols[1]!.to).toBe('2026-02-28');
    expect(cols[11]).toEqual({ key: '2026-12-01', from: '2026-12-01', to: '2026-12-31', label: 'Декабрь 2026' });
  });

  it('неполные первая и последняя колонки обрезаются границами периода', () => {
    expect(reportColumns('2026-01-15', '2026-03-10', 'month').map((c) => [c.from, c.to])).toEqual([
      ['2026-01-15', '2026-01-31'],
      ['2026-02-01', '2026-02-28'],
      ['2026-03-01', '2026-03-10'],
    ]);
    // 01.01.2026 — четверг: первая неделя — 1–4 января, последняя — 26–31 января
    const weeks = reportColumns('2026-01-01', '2026-01-31', 'week');
    expect(weeks.map((c) => c.label)).toEqual(['1–4 янв', '5–11 янв', '12–18 янв', '19–25 янв', '26–31 янв']);
    expect(weeks[0]!.key).toBe('2026-01-01');
  });

  it('подписи: день, неделя через месяц и через год, квартал', () => {
    expect(columnLabel('2026-10-14', '2026-10-14', 'day')).toBe('14 окт');
    expect(columnLabel('2026-10-12', '2026-10-18', 'week')).toBe('12–18 окт');
    expect(columnLabel('2025-09-29', '2025-10-05', 'week')).toBe('29 сен – 5 окт');
    expect(columnLabel('2025-12-29', '2026-01-04', 'week')).toBe('29 дек 2025 – 4 янв 2026');
    expect(columnLabel('2026-10-18', '2026-10-18', 'week')).toBe('18 окт');
    expect(reportColumns('2026-01-01', '2026-12-31', 'quarter').map((c) => c.label)).toEqual(['I кв. 2026', 'II кв. 2026', 'III кв. 2026', 'IV кв. 2026']);
  });

  it('граница года: дни 30.12–02.01 и квартал, начатый в ноябре', () => {
    expect(reportColumns('2025-12-30', '2026-01-02', 'day').map((c) => c.label)).toEqual(['30 дек', '31 дек', '1 янв', '2 янв']);
    expect(reportColumns('2025-11-15', '2026-02-01', 'quarter').map((c) => [c.from, c.to, c.label])).toEqual([
      ['2025-11-15', '2025-12-31', 'IV кв. 2025'],
      ['2026-01-01', '2026-02-01', 'I кв. 2026'],
    ]);
  });

  it('columnCount совпадает с числом колонок на любых периодах', () => {
    const steps: ReportStep[] = ['day', 'week', 'month', 'quarter'];
    const random = rng(7);
    for (let i = 0; i < 300; i++) {
      const from = dateFrom(random, '2023-01-01', 900);
      const to = dateFrom(random, from, 400);
      const step = steps[Math.floor(random() * 4)]!;
      expect(columnCount(from, to, step)).toBe(reportColumns(from, to, step).length);
    }
    expect(columnCount('2026-01-01', '2026-12-31', 'day')).toBe(365);
    expect(columnCount('2026-10-17', '2026-10-16', 'month')).toBe(0);
  });

  it('предел периода — 5 лет: последний допустимый день', () => {
    expect(maxReportTo('2022-01-01')).toBe('2026-12-31');
    expect(maxReportTo('2024-02-29')).toBe('2029-02-27');
  });
});

describe('даты по APP_TIMEZONE (§3.1)', () => {
  it('границы колонок — начало дня в Алматы: UTC+6 до 01.03.2024, UTC+5 после', () => {
    const before = columnStarts(reportColumns('2024-01-15', '2024-01-16', 'day'), TZ);
    expect(before).toEqual(['2024-01-14T18:00:00.000Z', '2024-01-15T18:00:00.000Z', '2024-01-16T18:00:00.000Z']);
    const after = columnStarts(reportColumns('2026-10-13', '2026-10-14', 'day'), TZ);
    expect(after).toEqual(['2026-10-12T19:00:00.000Z', '2026-10-13T19:00:00.000Z', '2026-10-14T19:00:00.000Z']);
  });

  it('23:30 — тот же день, 00:30 — следующий; до и после смены пояса', () => {
    for (const [d1, d2] of [
      ['2024-01-15', '2024-01-16'],
      ['2026-10-13', '2026-10-14'],
    ] as const) {
      const starts = columnStarts(reportColumns(d1, d2, 'day'), TZ);
      expect(bucketOf(starts, almaty(d1, '23:30'))).toBe(0);
      expect(bucketOf(starts, almaty(d2, '00:30'))).toBe(1);
      expect(bucketOf(starts, almaty(d1, '00:00'))).toBe(0);
      expect(bucketOf(starts, almaty(d2, '23:59'))).toBe(1);
      // вне периода
      expect(bucketOf(starts, new Date(Date.parse(almaty(d1, '00:00')) - 1).toISOString())).toBe(-1);
      expect(bucketOf(starts, starts[2]!)).toBe(-1);
    }
  });

  it('месяц, начатый 01.03.2024: 29.02 23:30 ещё февраль (UTC+6), 01.03 00:30 — март (UTC+5)', () => {
    const starts = columnStarts(reportColumns('2024-02-01', '2024-03-31', 'month'), TZ);
    expect(bucketOf(starts, almaty('2024-02-29', '23:30'))).toBe(0);
    expect(bucketOf(starts, almaty('2024-03-01', '00:30'))).toBe(1);
  });
});

describe('разрезы и нулевые строки (§2.4, §3.3)', () => {
  const cols = reportColumns('2026-01-01', '2026-03-31', 'month');
  const starts = columnStarts(cols, TZ);
  const lines: ReportLine[] = [
    line('2026-01-10', 'income', 1000, { categoryId: 1, projectId: 30, counterpartyId: 20 }),
    line('2026-01-11', 'income', 300, { categoryId: 3, projectId: 31 }),
    line('2026-02-11', 'income', 200, { categoryId: 2 }),
    line('2026-03-01', 'income', 50, { categoryId: 5 }),
    line('2026-03-02', 'income', 70),
    line('2026-02-05', 'expense', 400, { categoryId: 10, counterpartyId: 21, projectId: 30 }),
    // вне периода — не учитывается
    line('2026-04-01', 'income', 9999, { categoryId: 1 }),
  ];

  it('по категориям: верхний уровень, подкатегории, «Без подкатегории», архивная с суммой, «Без категории»', () => {
    const { income, expense, empty } = aggregate({ lines, starts, by: 'category', dicts, filter: {} });
    expect(empty).toBe(false);
    expect(income.values).toEqual([1300, 200, 120]);
    expect(ids(income.row.children)).toEqual(['income:category:1', 'income:category:2', 'income:category:5', 'income:category:none']);
    const game = income.row.children![1]!;
    expect(game.values).toEqual([300, 200, 0]);
    expect(game.total).toBe(500);
    // свои строки родителя при подкатегориях — отдельная строка; неархивная подкатегория без сумм — нулями
    expect(game.children!.map((c) => [c.id, c.label, c.values])).toEqual([
      ['income:category:2:own', 'Без подкатегории', [0, 200, 0]],
      ['income:category:3', 'ПК', [300, 0, 0]],
      ['income:category:4', 'Консоли', [0, 0, 0]],
    ]);
    expect(income.row.children![2]).toMatchObject({ label: 'Старая категория', archived: true, values: [0, 0, 50] });
    expect(income.row.children![3]).toMatchObject({ label: 'Без категории', values: [0, 0, 70], total: 70 });
    // нулевые категории расхода показываются нулями
    expect(expense.row.children!.map((c) => [c.label, c.total])).toEqual([
      ['Аренда', 400],
      ['Закуп бара', 0],
    ]);
  });

  it('по контрагентам — только с суммами и «Без контрагента»; по проектам — неархивные нулями', () => {
    const byCp = aggregate({ lines, starts, by: 'counterparty', dicts, filter: {} });
    expect(byCp.income.row.children!.map((c) => [c.label, c.total])).toEqual([
      ['Поставщик А', 1000],
      ['Без контрагента', 620],
    ]);
    const byProject = aggregate({ lines, starts, by: 'project', dicts, filter: {} });
    expect(byProject.income.row.children!.map((c) => [c.label, c.total])).toEqual([
      ['Клуб 1', 1000],
      ['Клуб 2', 300],
      ['Без проекта', 320],
    ]);
    expect(byProject.expense.row.children!.map((c) => [c.label, c.total])).toEqual([
      ['Клуб 1', 400],
      ['Клуб 2', 0],
    ]);
  });

  it('пустой период — только итоговые строки; фильтр по измерению убирает нулевые строки этого измерения', () => {
    const none = aggregate({ lines: [], starts, by: 'category', dicts, filter: {} });
    expect(none.empty).toBe(true);
    expect(none.income.row.children).toBeUndefined();
    expect(none.income.row.values).toEqual([0, 0, 0]);
    const filtered = aggregate({ lines: lines.filter((l) => l.categoryId === 10), starts, by: 'category', dicts, filter: { categoryIds: [10] } });
    expect(ids(filtered.expense.row.children)).toEqual(['expense:category:10']);
    expect(filtered.income.row.children).toBeUndefined();
  });

  it('значение не из справочника не теряется: строка «…»', () => {
    const r = aggregate({ lines: [line('2026-01-05', 'expense', 10, { counterpartyId: 99 })], starts, by: 'counterparty', dicts, filter: {} });
    expect(r.expense.row.children).toEqual([expect.objectContaining({ id: 'expense:counterparty:99', label: '…', total: 10 })]);
  });

  it('архивная подкатегория и архивный родитель с суммами показываются с пометкой, без сумм — скрыты', () => {
    const withArchive: ReportDicts = {
      ...dicts,
      categories: [
        { id: 40, kind: 'income', parentId: null, name: 'Родитель А', archived: false },
        { id: 41, kind: 'income', parentId: 40, name: 'Архивная подкатегория', archived: true },
        { id: 42, kind: 'income', parentId: 40, name: 'Архивная без сумм', archived: true },
        { id: 43, kind: 'income', parentId: null, name: 'Архивный родитель', archived: true },
        { id: 44, kind: 'income', parentId: 43, name: 'Дочерняя', archived: false },
        { id: 45, kind: 'income', parentId: null, name: 'Архивный родитель без сумм', archived: true },
      ],
    };
    const r = aggregate({ lines: [line('2026-01-10', 'income', 100, { categoryId: 41 }), line('2026-02-10', 'income', 70, { categoryId: 44 })], starts, by: 'category', dicts: withArchive, filter: {} });
    expect(ids(r.income.row.children)).toEqual(['income:category:40', 'income:category:43']);
    const [parent, archivedParent] = r.income.row.children! as [ReportRow, ReportRow];
    expect(parent.archived).toBeUndefined();
    expect(parent.total).toBe(100);
    expect(parent.children!.map((c) => [c.id, c.archived, c.total])).toEqual([['income:category:41', true, 100]]);
    // дочерняя неархивная при архивном родителе показывается с пометкой «архив»
    expect(archivedParent).toMatchObject({ archived: true, total: 70 });
    expect(archivedParent.children!.map((c) => [c.id, c.archived, c.total])).toEqual([['income:category:44', true, 70]]);
    expect(r.income.row.total).toBe(170);
  });

  it('архивный контрагент и проект с суммами показываются с пометкой, без сумм — скрыты', () => {
    const withArchive: ReportDicts = {
      ...dicts,
      counterparties: [...dicts.counterparties, { id: 22, name: 'Бывший поставщик', archived: true }, { id: 23, name: 'Архивный без сумм', archived: true }],
    };
    const byCp = aggregate({
      lines: [line('2026-01-05', 'expense', 40, { counterpartyId: 22 }), line('2026-01-06', 'expense', 10, { counterpartyId: 20 })],
      starts,
      by: 'counterparty',
      dicts: withArchive,
      filter: {},
    });
    expect(byCp.expense.row.children!.map((c) => [c.label, c.archived, c.total])).toEqual([
      ['Поставщик А', undefined, 10],
      ['Бывший поставщик', true, 40],
    ]);
    const byProject = aggregate({
      lines: [line('2026-01-05', 'expense', 25, { projectId: 32 }), line('2026-01-06', 'expense', 5, { projectId: 30 })],
      starts,
      by: 'project',
      dicts,
      filter: {},
    });
    expect(byProject.expense.row.children!.map((c) => [c.label, c.archived, c.total])).toEqual([
      ['Клуб 1', undefined, 5],
      ['Клуб 2', undefined, 0],
      ['Клуб 3', true, 25],
    ]);
  });

  it('фильтр не по счетам скрывает остатки', () => {
    expect(hidesBalances({})).toBe(false);
    expect(hidesBalances({ accountIds: [1] })).toBe(false);
    expect(hidesBalances({ categoryIds: [] })).toBe(false);
    for (const f of [{ categoryIds: [1] }, { counterpartyIds: [2] }, { projectIds: [3] }, { tagIds: [4] }, { withoutCategory: true }, { withoutCounterparty: true }, { withoutProject: true }]) {
      expect(hidesBalances(f)).toBe(true);
    }
  });
});

describe('проценты и ячейки (§2.5, §4.1)', () => {
  it('доля строки в группе: два знака, у группы 100 %, при нулевой группе — нет', () => {
    expect(sharePercent(125, 1000)).toBe('12,50\u00A0%');
    expect(sharePercent(1, 3)).toBe('33,33\u00A0%');
    expect(sharePercent(1000, 1000)).toBe('100,00\u00A0%');
    expect(sharePercent(0, 1000)).toBe('0,00\u00A0%');
    expect(sharePercent(5, 0)).toBeNull();
    expect(sharePercent(null, 10)).toBeNull();
  });

  it('отрицательная доля: модуль округляется отдельно, знак возвращается потом', () => {
    expect(sharePercent(-125, 1000)).toBe('\u221212,50\u00A0%');
    expect(sharePercent(125, -1000)).toBe('\u221212,50\u00A0%');
    expect(sharePercent(-125, -1000)).toBe('12,50\u00A0%');
    // половина базисного пункта округляется от нуля в обе стороны одинаково
    expect(sharePercent(1, 20_000)).toBe('0,01\u00A0%');
    expect(sharePercent(-1, 20_000)).toBe('\u22120,01\u00A0%');
    // ноль после округления — без знака
    expect(sharePercent(-1, 100_000)).toBe('0,00\u00A0%');
  });

  it('строки, которые раскрываются в список операций', () => {
    expect(parseDrillRow('net')).toEqual({ types: ['income', 'expense'], dim: null, id: null, own: false });
    expect(parseDrillRow('expense')).toEqual({ types: ['expense'], dim: null, id: null, own: false });
    expect(parseDrillRow('income:category:12')).toEqual({ types: ['income'], dim: 'category', id: 12, own: false });
    expect(parseDrillRow('income:category:12:own')).toEqual({ types: ['income'], dim: 'category', id: 12, own: true });
    expect(parseDrillRow('expense:counterparty:none')).toEqual({ types: ['expense'], dim: 'counterparty', id: null, own: false });
    for (const bad of ['balance:start', 'nonop', 'nonop:fx', 'income:project:5:own', 'income:category:none:own', 'income:tag:1', 'income:category:0', 'income:category:01']) {
      expect(parseDrillRow(bad)).toBeNull();
    }
  });

  it('границы ячейки: колонка по ключу или весь период', () => {
    const cols = reportColumns('2026-01-15', '2026-03-10', 'month');
    expect(drillRange(cols, '2026-02-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(drillRange(cols, 'total')).toEqual({ from: '2026-01-15', to: '2026-03-10' });
    expect(drillRange(cols, '2026-02-02')).toBeNull();
  });
});

/** Курс USD → KZT по датам; null — нет курса. */
const usdRates = (table: Record<string, string>, fallback: string | null = null) => (currency: string, date: string): Dec | null => {
  if (currency !== 'USD') return null;
  const keys = Object.keys(table).filter((d) => d <= date).sort();
  const text = keys.length ? table[keys.at(-1)!]! : fallback;
  return text === null ? null : parseDecimal(text)!;
};

describe('остатки и неоперационные изменения (§4.1)', () => {
  // январь–март 2026 по месяцам; касса в тенге с начала года, долларовый счёт открыт 10.02 со 100 $
  const cols = reportColumns('2026-01-01', '2026-03-31', 'month');
  const starts = columnStarts(cols, TZ);
  const accounts: BalanceAccount[] = [
    { id: 1, currency: 'KZT', startingBalance: 100_000_00, openedAt: '2025-12-01' },
    { id: 2, currency: 'USD', startingBalance: 100_00, openedAt: '2026-02-10' },
  ];
  // до периода по кассе: +50 000 ₸
  const opening = new Map([[1, 50_000_00]]);
  const rates = usdRates({ '2026-01-01': '450', '2026-02-20': '500', '2026-03-15': '480' });
  // январь: доход 20 000 ₸; февраль: расход 10 $ (по курсу операции 5 000 ₸); март: перевод 50 $ → 24 000 ₸ (base 24 000 ₸)
  const lines: ReportLine[] = [
    line('2026-01-20', 'income', 20_000_00, { accountId: 1, categoryId: 1 }),
    line('2026-02-25', 'expense', 5000_00, { accountId: 2, categoryId: 10 }),
  ];
  const legs: AccountLeg[] = [
    { at: almaty('2026-01-20'), accountId: 1, delta: 20_000_00 },
    { at: almaty('2026-02-25'), accountId: 2, delta: -10_00 },
    { at: almaty('2026-03-20'), accountId: 2, delta: -50_00 },
    { at: almaty('2026-03-20'), accountId: 1, delta: 24_000_00 },
  ];
  const transfers: TransferLeg[] = [{ at: almaty('2026-03-20'), from: 2, to: 1, base: 24_000_00 }];

  it('остатки на границах, стартовые остатки, переводы и курсовая разница с долларовым счётом', () => {
    const series = balanceSeries({ columns: cols, starts, accounts, opening, legs, transfers, baseCurrency: 'KZT', rate: rates, today: '2026-10-16' });
    // начало января: 150 000; начало февраля: 170 000; начало марта: 170 000 + 90 $ × 500 = 215 000;
    // конец марта: 194 000 ₸ + 40 $ × 480 = 213 200
    expect(series.at).toEqual([150_000_00, 170_000_00, 215_000_00, 213_200_00]);
    expect(series.starting).toEqual([0, 50_000_00, 0]);
    expect(series.transfers).toEqual([0, 0, 0]);
    expect(series.missing).toBeNull();

    const { rows } = cashflowRows({ columns: cols, starts, lines, by: 'category', dicts, filter: {}, balances: { series, accountIds: new Set([1, 2]) } });
    expect(ids(rows)).toEqual(['balance:start', 'balance:end', 'nonop', 'net', 'income', 'expense']);
    const [start, end, nonop, net] = rows as [ReportRow, ReportRow, ReportRow, ReportRow];
    expect(start.values).toEqual([150_000_00, 170_000_00, 215_000_00]);
    expect(start.total).toBe(150_000_00);
    expect(end.values).toEqual([170_000_00, 215_000_00, 213_200_00]);
    expect(end.total).toBe(213_200_00);
    expect(net.values).toEqual([20_000_00, -5000_00, 0]);
    // февраль: 215 000 - 170 000 - (-5 000) = 50 000 = стартовые 50 000; курсовая 0
    // март: 213 200 - 215 000 - 0 = -1 800 = курсовая (переоценка 90 $ с 500 на 480, перевод по 480)
    expect(nonop.values).toEqual([0, 50_000_00, -1800_00]);
    expect(nonop.children!.map((c) => [c.id, c.values])).toEqual([
      ['nonop:starting', [0, 50_000_00, 0]],
      ['nonop:transfers', [0, 0, 0]],
      ['nonop:excluded', [0, 0, 0]],
      ['nonop:fx', [0, 0, -1800_00]],
    ]);
  });

  it('выбранная часть счетов: перевод на кассу — «Переводы», поток второго счёта — «Исключённые из отчёта счета»', () => {
    const only = accounts.filter((a) => a.id === 1);
    const series = balanceSeries({ columns: cols, starts, accounts: only, opening, legs, transfers, baseCurrency: 'KZT', rate: rates, today: '2026-10-16' });
    expect(series.at).toEqual([150_000_00, 170_000_00, 170_000_00, 194_000_00]);
    expect(series.transfers).toEqual([0, 0, 24_000_00]);
    const { rows } = cashflowRows({ columns: cols, starts, lines, by: 'category', dicts, filter: {}, balances: { series, accountIds: new Set([1]) } });
    const nonop = rows.find((r) => r.id === 'nonop')!;
    expect(nonop.children!.map((c) => c.values)).toEqual([
      [0, 0, 0],
      [0, 0, 24_000_00],
      [0, 5000_00, 0],
      [0, 0, 0],
    ]);
  });

  it('нет курса: остатки на этой границе пусты, строки с пояснением, итог не считается', () => {
    const noMarch = usdRates({ '2026-01-01': '450', '2026-02-20': '500' });
    const series = balanceSeries({
      columns: cols,
      starts,
      accounts,
      opening,
      legs,
      transfers,
      baseCurrency: 'KZT',
      // курс есть только до 28.02: на 31.03 его нет
      rate: (c, d) => (d >= '2026-03-01' ? null : noMarch(c, d)),
      today: '2026-10-16',
    });
    expect(series.at).toEqual([150_000_00, 170_000_00, 215_000_00, null]);
    expect(series.missing).toEqual({ currency: 'USD', date: '2026-03-31' });
    const { rows } = cashflowRows({ columns: cols, starts, lines, by: 'category', dicts, filter: {}, balances: { series, accountIds: new Set([1, 2]) } });
    const end = rows.find((r) => r.id === 'balance:end')!;
    expect(end.values).toEqual([170_000_00, 215_000_00, null]);
    expect(end.total).toBeNull();
    expect(end.note).toBe('Нет курса USD на 31.03.2026');
    const fx = rows.find((r) => r.id === 'nonop')!.children!.find((c) => c.id === 'nonop:fx')!;
    expect(fx.values).toEqual([0, 0, null]);
    expect(fx.total).toBeNull();
  });

  it('нет курса только для стартового остатка: остатки нулевые и курса не требуют, «Стартовые остатки» и «Курсовая разница» пусты с пояснением', () => {
    // долларовый счёт открыт в феврале со 100 $ и в феврале же потрачен целиком: остатки на границах равны нулю
    const usd: BalanceAccount[] = [{ id: 2, currency: 'USD', startingBalance: 100_00, openedAt: '2026-02-10' }];
    const series = balanceSeries({
      columns: cols,
      starts,
      accounts: usd,
      opening: new Map(),
      legs: [{ at: almaty('2026-02-25'), accountId: 2, delta: -100_00 }],
      transfers: [],
      baseCurrency: 'KZT',
      rate: () => null,
      today: '2026-10-16',
    });
    expect(series.at).toEqual([0, 0, 0, 0]);
    expect(series.starting).toEqual([0, null, 0]);
    expect(series.missing).toEqual({ currency: 'USD', date: '2026-02-28' });
    const { rows } = cashflowRows({ columns: cols, starts, lines: [], by: 'category', dicts, filter: {}, balances: { series, accountIds: new Set([2]) } });
    const nonop = rows.find((r) => r.id === 'nonop')!;
    expect(nonop.children!.find((c) => c.id === 'nonop:starting')).toMatchObject({ values: [0, null, 0], total: null });
    expect(nonop.children!.find((c) => c.id === 'nonop:fx')).toMatchObject({ values: [0, null, 0], total: null });
    expect(rows.find((r) => r.id === 'balance:end')!.note).toBe('Нет курса USD на 28.02.2026');
  });

  it('будущие колонки: курс — на сегодня, нулевая сумма валюты курса не требует', () => {
    const future = reportColumns('2026-10-01', '2026-12-31', 'month');
    const s = columnStarts(future, TZ);
    const calls: string[] = [];
    const series = balanceSeries({
      columns: future,
      starts: s,
      accounts: [{ id: 2, currency: 'USD', startingBalance: 10_00, openedAt: '2026-01-01' }, { id: 3, currency: 'EUR', startingBalance: 0, openedAt: '2026-01-01' }],
      opening: new Map(),
      legs: [],
      transfers: [],
      baseCurrency: 'KZT',
      rate: (c, d) => {
        calls.push(`${c} ${d}`);
        return c === 'USD' ? 500n * DEC_ONE : null;
      },
      today: '2026-10-16',
    });
    expect(series.at).toEqual([5000_00, 5000_00, 5000_00, 5000_00]);
    expect(series.missing).toBeNull();
    expect(new Set(calls)).toEqual(new Set(['USD 2026-09-30', 'USD 2026-10-16']));
  });

  it('фильтр не по счетам: вместо остатков строка «Остатки скрыты»', () => {
    const { rows } = cashflowRows({ columns: cols, starts, lines, by: 'category', dicts, filter: { categoryIds: [1] }, balances: null });
    expect(ids(rows)).toEqual(['balance:hidden', 'net', 'income', 'expense']);
    expect(rows[0]!.label).toMatch(/^Остатки скрыты/);
    expect(rows[0]!.values).toEqual([null, null, null]);
  });
});

/** Детерминированный генератор (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateFrom(random: () => number, from: string, spanDays: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + Math.floor(random() * spanDays))).toISOString().slice(0, 10);
}

/**
 * Случайная компания: 2–4 счёта (тенге или доллары; при kztOnly — только тенге), операции с 1–3 строками, переводы.
 * Входы движка собираются так же, как на сервере: строки операций с суммой в базовой валюте, движения счетов, переводы.
 */
function randomWorld(random: () => number, kztOnly: boolean) {
  const steps: ReportStep[] = ['day', 'week', 'month', 'quarter'];
  let step = steps[Math.floor(random() * 4)]!;
  const from = dateFrom(random, '2025-06-01', 200);
  let to = dateFrom(random, from, step === 'day' ? 80 : 500);
  if (columnCount(from, to, step) > 92) step = 'month';
  if (columnCount(from, to, step) > 92) to = from;
  const columns = reportColumns(from, to, step);
  const starts = columnStarts(columns, TZ);
  const accounts: BalanceAccount[] = [];
  const count = 2 + Math.floor(random() * 3);
  for (let id = 1; id <= count; id++) {
    accounts.push({
      id,
      currency: kztOnly || random() < 0.6 ? 'KZT' : 'USD',
      startingBalance: Math.floor(random() * 1_000_000),
      openedAt: dateFrom(random, '2025-05-01', 450),
    });
  }
  const usdRate = 400 + Math.floor(random() * 200);
  const rate = (currency: string, date: string): Dec | null => (currency === 'USD' ? BigInt(usdRate + (Number(date.slice(8)) % 7)) * DEC_ONE : null);
  const lines: ReportLine[] = [];
  const legs: AccountLeg[] = [];
  const transfers: TransferLeg[] = [];
  const opening = new Map<number, number>();
  const startAt = starts[0]!;
  const endAt = starts.at(-1)!;
  for (let i = 0; i < 60; i++) {
    const a = accounts[Math.floor(random() * accounts.length)]!;
    // операция не раньше открытия счёта (инвариант 6); дни — вокруг периода [from \u2212 60; to + 30], чтобы в большинстве миров были строки внутри него
    const lo = addDays(from, -60);
    const hi = addDays(to, 30);
    const first = a.openedAt > lo ? a.openedAt : lo;
    if (first > hi) continue;
    const day = dateFrom(random, first, Math.round((Date.parse(hi) - Date.parse(first)) / 86_400_000) + 1);
    const at = almaty(day, `${String(Math.floor(random() * 24)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}`);
    const amount = 1 + Math.floor(random() * 100_000);
    const base = a.currency === 'KZT' ? amount : amount * usdRate;
    const kind = random();
    const leg = (accountId: number, delta: number) => {
      if (at < startAt) opening.set(accountId, (opening.get(accountId) ?? 0) + delta);
      else if (at < endAt) legs.push({ at, accountId, delta });
    };
    if (kind < 0.2 && accounts.length > 1) {
      const b = accounts.find((x) => x.id !== a.id && x.openedAt <= day);
      if (!b) continue;
      const toAmount = b.currency === a.currency ? amount : b.currency === 'KZT' ? amount * usdRate : Math.max(1, Math.round(amount / usdRate));
      leg(a.id, -amount);
      leg(b.id, toAmount);
      if (at >= startAt && at < endAt) transfers.push({ at, from: a.id, to: b.id, base });
      continue;
    }
    const type = kind < 0.6 ? 'income' : 'expense';
    leg(a.id, type === 'income' ? amount : -amount);
    // строки: 1–3 части суммы в базовой валюте, случайные категории, контрагенты и проекты
    const n = 1 + Math.floor(random() * 3);
    let left = base;
    const cats = dicts.categories.filter((c) => c.kind === type);
    for (let j = 0; j < n; j++) {
      const part = j === n - 1 ? left : Math.floor(left / 2);
      left -= part;
      const pick = <T>(xs: readonly T[]) => (random() < 0.2 ? null : xs[Math.floor(random() * xs.length)]!);
      lines.push({
        at,
        type,
        accountId: a.id,
        categoryId: pick(cats)?.id ?? null,
        projectId: pick(dicts.projects)?.id ?? null,
        counterpartyId: pick(dicts.counterparties)?.id ?? null,
        amount: part,
      });
    }
  }
  // часть счетов вне набора остатков (как архивные без фильтра «Счета»)
  const set = accounts.filter((x) => x.id !== 1 || random() < 0.5);
  return { columns, starts, accounts: set, opening, legs, transfers, lines, rate };
}

function checkRow(r: ReportRow): void {
  const total = r.values.some((v) => v === null) ? null : r.values.reduce<number>((s, v) => s + v!, 0);
  if (!r.id.startsWith('balance:')) expect(r.total).toBe(total);
  for (const c of r.children ?? []) checkRow(c);
}

describe('свойства (§11)', () => {
  it('конец - начало = чистый поток + неоперационные; сумма колонок = «Итого»; итог разреза = итог группы', () => {
    const random = rng(20261016);
    for (let i = 0; i < 150; i++) {
      const kztOnly = i % 2 === 0;
      const w = randomWorld(random, kztOnly);
      const by = (['category', 'counterparty', 'project'] as ReportBy[])[i % 3]!;
      const series = balanceSeries({ ...w, baseCurrency: 'KZT', today: '2026-10-16' });
      const { rows } = cashflowRows({ ...w, by, dicts, filter: {}, balances: { series, accountIds: new Set(w.accounts.map((a) => a.id)) } });
      const get = (id: string) => rows.find((r) => r.id === id)!;
      const [start, end, nonop, net] = [get('balance:start'), get('balance:end'), get('nonop'), get('net')];
      for (let c = 0; c < w.columns.length; c++) {
        if (end.values[c] === null || start.values[c] === null) continue;
        expect(end.values[c]! - start.values[c]!).toBe(net.values[c]! + nonop.values[c]!);
        expect(nonop.children!.reduce((s, x) => s + x.values[c]!, 0)).toBe(nonop.values[c]);
        // начало следующей колонки = конец предыдущей
        if (c > 0) expect(start.values[c]).toBe(end.values[c - 1]);
        // только тенге: курсовой разницы нет — тождество точное, без «остатка»
        if (kztOnly) expect(nonop.children!.find((x) => x.id === 'nonop:fx')!.values[c]).toBe(0);
      }
      if (start.total !== null && end.total !== null && nonop.total !== null) expect(end.total - start.total).toBe(net.total! + nonop.total);
      for (const r of rows) checkRow(r);
      for (const g of [get('income'), get('expense')]) {
        const children = g.children ?? [];
        for (let c = 0; c < w.columns.length; c++) {
          expect(children.reduce((s, x) => s + x.values[c]!, 0)).toBe(g.values[c]);
          for (const x of children) if (x.children) expect(x.children.reduce((s, y) => s + y.values[c]!, 0)).toBe(x.values[c]);
        }
      }
    }
  });
});

describe('независимая проверка остатков и курсовой разницы (§11)', () => {
  const TODAY = '2026-10-16';
  type World = ReturnType<typeof randomWorld>;
  const bucket = (w: World, at: string) => {
    for (let c = 0; c < w.columns.length; c++) if (at >= w.starts[c]! && at < w.starts[c + 1]!) return c;
    return -1;
  };

  /** Остатки на границах колонок прямым пересчётом по сырым данным мира, без движка: счёт за счётом, валюта за валютой. */
  function independentAt(w: World): number[] {
    const days = [...w.columns.map((c) => c.from), addDays(w.columns.at(-1)!.to, 1)];
    return days.map((day, k) => {
      const sums: Record<string, number> = {};
      for (const a of w.accounts) {
        let sum = (w.opening.get(a.id) ?? 0) + (a.openedAt < day ? a.startingBalance : 0);
        for (const leg of w.legs) if (leg.accountId === a.id && leg.at < w.starts[k]!) sum += leg.delta;
        sums[a.currency] = (sums[a.currency] ?? 0) + sum;
      }
      const rateDay = addDays(day, -1) > TODAY ? TODAY : addDays(day, -1);
      let total = 0;
      for (const [currency, sum] of Object.entries(sums)) {
        if (sum === 0) continue;
        total += currency === 'KZT' ? sum : convertMinor(sum, w.rate(currency, rateDay)!, 2, 2);
      }
      return total;
    });
  }

  it('тенге: остаток на конец = стартовые остатки открытых счетов + движения до периода + все движения; курсовой разницы нет', () => {
    const random = rng(7_000_001);
    let withLines = 0;
    for (let i = 0; i < 120; i++) {
      const w = randomWorld(random, true);
      if (w.lines.some((l) => l.at >= w.starts[0]! && l.at < w.starts.at(-1)!)) withLines++;
      const series = balanceSeries({ ...w, baseCurrency: 'KZT', today: TODAY });
      const { rows } = cashflowRows({ ...w, by: 'category', dicts, filter: {}, balances: { series, accountIds: new Set(w.accounts.map((a) => a.id)) } });
      const end = rows.find((r) => r.id === 'balance:end')!;
      const endDay = addDays(w.columns.at(-1)!.to, 1);
      let expected = 0;
      for (const a of w.accounts) {
        expected += (a.openedAt < endDay ? a.startingBalance : 0) + (w.opening.get(a.id) ?? 0);
        for (const leg of w.legs) if (leg.accountId === a.id) expected += leg.delta;
      }
      expect(end.total).toBe(expected);
      expect(independentAt(w).at(-1)).toBe(expected);
    }
    // миры без строк внутри периода — меньшинство
    expect(withLines).toBeGreaterThan(96);
  });

  it('доллары: остатки на каждой границе и курсовая разница совпадают с пересчётом по сырым данным', () => {
    const random = rng(7_000_002);
    let withUsd = 0;
    for (let i = 0; i < 120; i++) {
      const w = randomWorld(random, false);
      if (w.accounts.some((a) => a.currency === 'USD')) withUsd++;
      const series = balanceSeries({ ...w, baseCurrency: 'KZT', today: TODAY });
      const inSet = new Set(w.accounts.map((a) => a.id));
      const { rows } = cashflowRows({ ...w, by: 'category', dicts, filter: {}, balances: { series, accountIds: inSet } });
      const at = independentAt(w);
      expect(series.at).toEqual(at);
      const fx = rows.find((r) => r.id === 'nonop')!.children!.find((c) => c.id === 'nonop:fx')!;
      const n = w.columns.length;
      const net = new Array<number>(n).fill(0);
      const excluded = new Array<number>(n).fill(0);
      const transfers = new Array<number>(n).fill(0);
      for (const l of w.lines) {
        const c = bucket(w, l.at);
        if (c < 0) continue;
        const signed = l.type === 'income' ? l.amount : -l.amount;
        net[c]! += signed;
        if (!inSet.has(l.accountId)) excluded[c]! -= signed;
      }
      for (const t of w.transfers) {
        const c = bucket(w, t.at);
        if (c < 0) continue;
        if (inSet.has(t.to)) transfers[c]! += t.base;
        if (inSet.has(t.from)) transfers[c]! -= t.base;
      }
      for (let c = 0; c < n; c++) {
        const col = w.columns[c]!;
        const opened = w.accounts.filter((a) => a.openedAt >= col.from && a.openedAt <= col.to);
        let starting = 0;
        for (const currency of ['KZT', 'USD']) {
          const sum = opened.filter((a) => a.currency === currency).reduce((s, a) => s + a.startingBalance, 0);
          if (sum === 0) continue;
          const day = addDays(col.to, 1);
          const rateDay = addDays(day, -1) > TODAY ? TODAY : addDays(day, -1);
          starting += currency === 'KZT' ? sum : convertMinor(sum, w.rate(currency, rateDay)!, 2, 2);
        }
        // переоценка = всё изменение остатка, кроме потока, стартовых остатков, переводов и потока исключённых счетов
        expect(fx.values[c]).toBe(at[c + 1]! - at[c]! - net[c]! - starting - transfers[c]! - excluded[c]!);
      }
    }
    expect(withUsd).toBeGreaterThan(60);
  });
});
