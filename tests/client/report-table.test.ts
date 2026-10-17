import { describe, expect, it } from 'vitest';
import type { ReportRow } from '../../src/shared/report-engine';
import {
  cellTitle,
  columnHint,
  DEFAULT_EXPANDED,
  isDrillRow,
  listMissesStock,
  moneyText,
  nextCell,
  noBatchText,
  percentText,
  projectsListMissesStock,
  ROW_HELP,
  rowLabel,
  tableLines,
} from '../../src/client/lib/report-table';

const row = (id: string, kind: ReportRow['kind'], values: (number | null)[], children?: ReportRow[], extra: Partial<ReportRow> = {}): ReportRow => ({
  id,
  kind,
  label: id,
  values,
  total: values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0),
  ...(children ? { children } : {}),
  ...extra,
});

const rows: ReportRow[] = [
  row('balance:start', 'balance', [100, 200]),
  row('nonop', 'info', [5, null], [row('nonop:fx', 'info', [5, null])]),
  row('net', 'info', [-30, 40]),
  row('income', 'group', [800, 0], [row('income:category:1', 'category', [600, 0], [row('income:category:2', 'category', [100, 0]), row('income:category:1:own', 'category', [500, 0])]), row('income:category:none', 'category', [200, 0])]),
  row('expense', 'group', [830, 0], [row('expense:category:5', 'category', [830, 0], undefined, { archived: true })]),
];

describe('строки таблицы отчёта (§4.1)', () => {
  it('по умолчанию раскрыты группы, неоперационные и подкатегории свёрнуты', () => {
    const lines = tableLines(rows, new Set(DEFAULT_EXPANDED));
    expect(lines.map((l) => [l.row.id, l.depth, l.expandable, l.expanded, l.tone])).toEqual([
      ['balance:start', 0, false, false, 'balance'],
      ['nonop', 0, true, false, 'balance'],
      ['net', 0, false, false, 'total'],
      ['income', 0, true, true, 'group'],
      ['income:category:1', 1, true, false, 'plain'],
      ['income:category:none', 1, false, false, 'plain'],
      ['expense', 0, true, true, 'group'],
      ['expense:category:5', 1, false, false, 'plain'],
    ]);
  });

  it('раскрытая подкатегория и неоперационные — дети сразу под строкой', () => {
    const lines = tableLines(rows, new Set(['nonop', 'income', 'income:category:1']));
    expect(lines.map((l) => l.row.id)).toEqual(['balance:start', 'nonop', 'nonop:fx', 'net', 'income', 'income:category:1', 'income:category:2', 'income:category:1:own', 'income:category:none', 'expense']);
    expect(lines.find((l) => l.row.id === 'nonop:fx')!.tone).toBe('muted');
    expect(lines.find((l) => l.row.id === 'income:category:2')!.depth).toBe(2);
  });

  it('проценты — доля в своей группе по колонке и по «Итого»; у групп 100 %; у остатков и при нулевой группе — нет', () => {
    const lines = tableLines(rows, new Set(['income', 'income:category:1', 'nonop']));
    const get = (id: string) => lines.find((l) => l.row.id === id)!;
    expect(percentText(get('income'), 0)).toBe('(100,00\u00A0%)');
    expect(percentText(get('income:category:1'), 0)).toBe('(75,00\u00A0%)');
    expect(percentText(get('income:category:2'), null)).toBe('(12,50\u00A0%)');
    expect(percentText(get('income:category:none'), 1)).toBeNull();
    expect(percentText(get('balance:start'), 0)).toBeNull();
    expect(percentText(get('nonop:fx'), 0)).toBeNull();
  });

  it('ячейки, которые открывают список операций, и заголовок списка «{строка} за {колонка}» (§2.5)', () => {
    expect(['balance:start', 'nonop', 'nonop:fx', 'net', 'income', 'income:category:1', 'income:category:1:own', 'expense:category:5'].map((id) => isDrillRow(row(id, 'info', [0]))))
      .toEqual([false, false, false, true, true, true, true, true]);
    const bar = { ...row('income:category:1', 'category', [1]), label: 'Бар' };
    expect(cellTitle(bar, { key: '2026-10-01', from: '2026-10-01', to: '2026-10-31', label: 'Октябрь 2026' })).toBe('Бар за октябрь 2026');
    expect(cellTitle(bar, { key: '2026-10-12', from: '2026-10-12', to: '2026-10-18', label: '12–18 окт' })).toBe('Бар за 12–18 окт');
    expect(cellTitle(bar, { key: '2026-10-01', from: '2026-10-01', to: '2026-12-31', label: 'IV кв. 2026' })).toBe('Бар за IV кв. 2026');
    expect(cellTitle(bar, null)).toBe('Бар за весь период');
  });

  it('суммы, архивная строка, подсказка колонки', () => {
    expect(moneyText(150_000, 'KZT')).toBe('₸\u00A01\u202F500');
    expect(moneyText(-5000, 'KZT')).toBe('\u2212₸\u00A050');
    expect(moneyText(null, 'KZT')).toBe('');
    expect(rowLabel(rows[4]!.children![0]!)).toBe('expense:category:5 (архив)');
    expect(columnHint({ key: '2026-10-12', from: '2026-10-12', to: '2026-10-18', label: '12–18 окт' })).toBe('12.10.2026 – 18.10.2026');
    expect(columnHint({ key: '2026-10-14', from: '2026-10-14', to: '2026-10-14', label: '14 окт' })).toBe('14.10.2026');
  });

  it('стрелки между ячейками-кнопками: строки без кнопок и пустые ячейки пропускаются, Home и End — края строки', () => {
    const T = true;
    const F = false;
    // строки: остаток (кнопок нет), чистый поток, поступления (в средней колонке нет значения), списания
    const grid = [
      [F, F, F],
      [T, T, T],
      [T, F, T],
      [T, T, T],
    ];
    expect(nextCell(grid, { row: 1, col: 0 }, 'ArrowRight')).toEqual({ row: 1, col: 1 });
    expect(nextCell(grid, { row: 1, col: 2 }, 'ArrowRight')).toBeNull();
    expect(nextCell(grid, { row: 2, col: 0 }, 'ArrowRight')).toEqual({ row: 2, col: 2 });
    expect(nextCell(grid, { row: 2, col: 2 }, 'ArrowLeft')).toEqual({ row: 2, col: 0 });
    expect(nextCell(grid, { row: 1, col: 0 }, 'ArrowLeft')).toBeNull();
    expect(nextCell(grid, { row: 1, col: 1 }, 'ArrowDown')).toEqual({ row: 3, col: 1 });
    expect(nextCell(grid, { row: 1, col: 0 }, 'ArrowDown')).toEqual({ row: 2, col: 0 });
    expect(nextCell(grid, { row: 1, col: 1 }, 'ArrowUp')).toBeNull();
    expect(nextCell(grid, { row: 3, col: 1 }, 'ArrowUp')).toEqual({ row: 1, col: 1 });
    expect(nextCell(grid, { row: 3, col: 1 }, 'ArrowDown')).toBeNull();
    expect(nextCell(grid, { row: 2, col: 2 }, 'Home')).toEqual({ row: 2, col: 0 });
    expect(nextCell(grid, { row: 2, col: 0 }, 'End')).toEqual({ row: 2, col: 2 });
    expect(nextCell(grid, { row: 2, col: 0 }, 'Home')).toBeNull();
    expect(nextCell(grid, { row: 0, col: 1 }, 'ArrowRight')).toBeNull();
  });
});

describe('«Прибыль» в таблице (§5.2, §5.3)', () => {
  it('«Прибыль» выделена, как итог; строки склада — с пояснением «?», в операции не раскрываются', () => {
    const lines = tableLines(
      [row('profit', 'info', [700]), row('income', 'group', [1000]), row('expense', 'group', [300], [row('expense:stock:cogs', 'stock', [300])])],
      new Set(DEFAULT_EXPANDED),
    );
    expect(lines.map((l) => [l.row.id, l.tone, l.group?.id ?? null])).toEqual([
      ['profit', 'total', null],
      ['income', 'group', 'income'],
      ['expense', 'group', 'expense'],
      ['expense:stock:cogs', 'plain', 'expense'],
    ]);
    expect(isDrillRow(row('profit', 'info', [700]))).toBe(true);
    expect(isDrillRow(row('expense:stock:cogs', 'stock', [300]))).toBe(false);
    expect(ROW_HELP['expense:stock:cogs']).toMatch(/FIFO/);
    expect(ROW_HELP['expense:stock:writeoff']).toMatch(/Списание/);
  });

  it('подпись «склад в список не входит» (R14): только «Прибыль» со складом и строки «Расходы», «Прибыль», проект', () => {
    for (const row of ['expense', 'profit', 'expense:project:7', 'expense:project:null']) expect(listMissesStock('pnl', true, row), row).toBe(true);
    for (const row of ['income', 'expense:category:3', 'expense:counterparty:2', 'income:project:7']) expect(listMissesStock('pnl', true, row), row).toBe(false);
    // склад выключен или его нет в компании, и «Деньги» - подписи нет
    expect(listMissesStock('pnl', false, 'expense')).toBe(false);
    expect(listMissesStock('pnl', undefined, 'profit')).toBe(false);
    expect(listMissesStock('cashflow', true, 'expense')).toBe(false);
  });

  it('предупреждение «Нет партии»: 1, 21 — «продажи», 2, 5, 11 — «продаж»', () => {
    expect(noBatchText(1)).toBe('У 1 продажи себестоимость не определена — прибыль завышена');
    expect(noBatchText(21)).toBe('У 21 продажи себестоимость не определена — прибыль завышена');
    for (const n of [2, 5, 11, 111]) expect(noBatchText(n)).toBe(`У ${n} продаж себестоимость не определена — прибыль завышена`);
  });

  it('«Проекты» (§7): подпись про склад — у расходов и всех операций строки проекта со складом; у доходов и категорий — нет', () => {
    expect(projectsListMissesStock(true, 'project:5', 'expense')).toBe(true);
    expect(projectsListMissesStock(true, 'total', 'total')).toBe(true);
    expect(projectsListMissesStock(true, 'project:5', 'income')).toBe(false);
    expect(projectsListMissesStock(true, 'project:5:category:3', 'expense')).toBe(false);
    expect(projectsListMissesStock(false, 'project:5', 'expense')).toBe(false);
  });
});
