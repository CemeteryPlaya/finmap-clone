import { describe, expect, it } from 'vitest';
import type { ReportRow } from '../../src/shared/report-engine';
import { columnHint, DEFAULT_EXPANDED, moneyText, percentText, rowLabel, tableLines } from '../../src/client/lib/report-table';

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

  it('суммы, архивная строка, подсказка колонки', () => {
    expect(moneyText(150_000, 'KZT')).toBe('₸\u00A01\u202F500');
    expect(moneyText(-5000, 'KZT')).toBe('\u2212₸\u00A050');
    expect(moneyText(null, 'KZT')).toBe('');
    expect(rowLabel(rows[4]!.children![0]!)).toBe('expense:category:5 (архив)');
    expect(columnHint({ key: '2026-10-12', from: '2026-10-12', to: '2026-10-18', label: '12–18 окт' })).toBe('12.10.2026 – 18.10.2026');
    expect(columnHint({ key: '2026-10-14', from: '2026-10-14', to: '2026-10-14', label: '14 окт' })).toBe('14.10.2026');
  });
});
