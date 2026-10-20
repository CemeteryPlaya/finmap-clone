import { describe, expect, it } from 'vitest';
import type { ReportChartData } from '../../src/client/lib/charts';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';
import { focusChart, focusLabel, rowCategoryId, toggleFocus } from '../../src/client/lib/report-focus';
import { DEFAULT_REPORT_STATE } from '../../src/client/lib/report-url';
import type { ReportRow } from '../../src/shared/report-engine';

const node = (id: number, name: string, patch: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId: null,
  name,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children: [],
  ...patch,
});

const tree: CategoryTree = {
  income: [node(1, 'Бар', { kind: 'income' })],
  expense: [
    node(10, 'Зарплата', { systemKey: 'salary', effectiveSystemKey: 'salary', children: [node(11, 'Администраторы', { parentId: 10, effectiveSystemKey: 'salary' })] }),
    node(20, 'Аренда'),
  ],
};

const row = (id: string, label: string, values: number[], children?: ReportRow[]): ReportRow => ({
  id,
  kind: 'category',
  label,
  values,
  total: values.reduce((s, v) => s + v, 0),
  ...(children ? { children } : {}),
});

describe('выбор одной категории в «Аналитике» (спецификация 2026-10-19, часть 3)', () => {
  it('строка отчёта → категория: только строки категорий с номером', () => {
    expect(rowCategoryId('income:category:12')).toBe(12);
    expect(rowCategoryId('expense:category:7')).toBe(7);
    expect(rowCategoryId('project:5:category:7')).toBe(7);
    for (const id of ['income:category:12:own', 'income:category:none', 'project:none:category:none', 'income:counterparty:3', 'expense:stock:cogs', 'other', 'net', 'balance:start']) {
      expect(rowCategoryId(id), id).toBeNull();
    }
  });

  it('нажатие выбирает, повторное снимает, другая категория — переключает; прочее не меняется', () => {
    const base = { ...DEFAULT_REPORT_STATE, period: 'month' as const, accountIds: [3] };
    const a = toggleFocus(base, 12);
    expect(a).toEqual({ ...base, focusCategoryId: 12 });
    expect(toggleFocus(a, 12)).toEqual({ ...base, focusCategoryId: null });
    expect(toggleFocus(a, 7).focusCategoryId).toBe(7);
  });

  it('подпись плашки: категория или «Родитель → Подкатегория»; неизвестная — null', () => {
    expect(focusLabel(tree, 10)).toBe('Зарплата');
    expect(focusLabel(tree, 11)).toBe('Зарплата → Администраторы');
    expect(focusLabel(tree, 1)).toBe('Бар');
    expect(focusLabel(tree, 99)).toBeNull();
  });

  it('график «детальнее»: у выбранной с подкатегориями — подкатегории, без них — одна её строка (R9)', () => {
    const admins = row('expense:category:11', 'Администраторы', [100]);
    const cashiers = row('expense:category:12', 'Кассиры', [50]);
    const salary = row('expense:category:10', 'Зарплата', [150], [admins, cashiers]);
    const rent = row('expense:category:20', 'Аренда', [80]);
    const chart: ReportChartData = { income: [0], expense: [230], line: [-230], incomeRows: [], expenseRows: [salary, rent] };
    const byParent = focusChart(chart, 10);
    expect(byParent.expenseRows).toEqual([admins, cashiers]);
    expect(byParent).toMatchObject({ income: [0], expense: [230], line: [-230], incomeRows: [] });
    expect(focusChart(chart, 11).expenseRows).toEqual([admins]);
    expect(focusChart(chart, 20).expenseRows).toEqual([rent]);
    expect(focusChart(chart, 99)).toBe(chart);
    expect(focusChart(chart, null)).toBe(chart);
  });
});
