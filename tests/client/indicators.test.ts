import { describe, expect, it } from 'vitest';
import {
  ALL_KEY,
  historyRows,
  indicatorsApiParams,
  indicatorsExcelHref,
  indicatorsState,
  partChanged,
  partOptions,
  partSelected,
  togglePart,
} from '../../src/client/lib/indicators';
import type { AuditEntry, CategoryNode, CategoryTree } from '../../src/client/lib/queries';
import { DEFAULT_REPORT_STATE, parseReportSearch } from '../../src/client/lib/report-url';

const node = (id: number, kind: 'income' | 'expense', name: string, extra: Partial<CategoryNode> = {}): CategoryNode =>
  ({ id, companyId: 1, kind, parentId: null, name, systemKey: null, effectiveSystemKey: null, templateRef: null, archivedAt: null, children: [], ...extra }) as CategoryNode;

const tree: CategoryTree = {
  income: [node(1, 'income', 'Бар'), node(2, 'income', 'Инвестиции', { systemKey: 'investment', effectiveSystemKey: 'investment' }), node(3, 'income', 'Старое', { archivedAt: '2026-01-01' })],
  expense: [node(10, 'expense', 'Бар', { children: [node(11, 'expense', 'Закуп бара', { parentId: 10 })] }), node(12, 'expense', 'Аренда')],
};

describe('«Финансовые показатели»: адрес и параметры (§8.1)', () => {
  it('действуют только период и шаг месяцы/кварталы; остальное из адреса отбрасывается', () => {
    const s = indicatorsState(parseReportSearch(new URLSearchParams('period=lastYear&step=week&by=project&view=table&pct=1&account=5&stock=0')));
    expect(s).toEqual({ ...DEFAULT_REPORT_STATE, period: 'lastYear' });
    expect(indicatorsState(parseReportSearch(new URLSearchParams('step=quarter&from=2026-01-01&to=2026-06-30'))).step).toBe('quarter');
    const custom = indicatorsState(parseReportSearch(new URLSearchParams('from=2026-01-01&to=2026-06-30')));
    expect(indicatorsApiParams(custom, '2026-10-06').toString()).toBe('from=2026-01-01&to=2026-06-30&step=month');
    expect(indicatorsExcelHref(7, DEFAULT_REPORT_STATE, '2026-10-06')).toBe('/api/v1/companies/7/analytics/indicators.xlsx?from=2026-01-01&to=2026-12-31&step=month');
  });
});

describe('«Финансовые показатели»: выбор категорий части (§8.2)', () => {
  it('первый пункт — «Все категории…»; категории вида деревом; исключённые и архивные (не выбранные) не предлагаются', () => {
    expect(partOptions('revenue', tree, []).map((o) => [o.key, o.label, o.nested ?? false])).toEqual([
      [ALL_KEY, 'Все категории дохода', false],
      ['1', 'Бар', false],
    ]);
    expect(partOptions('revenue', tree, [3]).map((o) => o.label)).toContain('Старое (архив)');
    expect(partOptions('cogs', tree, []).map((o) => [o.label, o.nested ?? false])).toEqual([
      ['Все категории расхода', false],
      ['Бар', false],
      ['Закуп бара', true],
      ['Аренда', false],
    ]);
    expect(partOptions('operating', tree, [])[0]!.label).toBe('Все категории расхода, кроме налогов и НДС');
  });

  it('«Все категории» — флаг: выбор категории снимает его, выбор «Все» очищает список', () => {
    const all = { allCategories: true, categoryIds: [], includeStock: true };
    expect(partSelected(all)).toEqual([ALL_KEY]);
    const one = togglePart(all, '11');
    expect(one).toEqual({ allCategories: false, categoryIds: [11], includeStock: true });
    expect(partSelected(one)).toEqual(['11']);
    expect(togglePart(one, '11')).toEqual({ allCategories: false, categoryIds: [], includeStock: true });
    expect(togglePart(one, ALL_KEY)).toEqual(all);
  });

  it('изменённые части: порядок id не важен; нетронутое умолчание не отправляется (§17.9)', () => {
    const saved = { allCategories: false, categoryIds: [11, 12], includeStock: true, isDefault: false };
    expect(partChanged(saved, { allCategories: false, categoryIds: [12, 11], includeStock: true })).toBe(false);
    expect(partChanged(saved, { allCategories: false, categoryIds: [11], includeStock: true })).toBe(true);
    expect(partChanged(saved, { allCategories: false, categoryIds: [11, 12], includeStock: false })).toBe(true);
    expect(partChanged({ ...saved, isDefault: true }, saved)).toBe(false);
    expect(partChanged({ ...saved, isDefault: true }, { ...saved, categoryIds: [11] })).toBe(true);
  });
});

describe('«Финансовые показатели»: вкладка «История» (§8.2)', () => {
  it('строки: действие, часть, категории после изменения, сотрудник; чужие записи пропускаются', () => {
    const entry = (id: number, action: string, diff: Record<string, unknown> | null): AuditEntry => ({
      id,
      companyId: 1,
      userId: 1,
      userName: 'Сотрудник А',
      entity: 'indicator_part',
      entityId: null,
      action,
      diff,
      at: '2026-10-06T12:00:00.000Z',
    });
    const rows = historyRows([
      entry(3, 'reset', { part: 'cogs', after: { allCategories: false, categories: [], includeStock: true } }),
      entry(2, 'update', { part: 'revenue', after: { allCategories: true, categories: [], includeStock: false } }),
      entry(1, 'update', { part: 'variable', after: { allCategories: false, categories: ['Закуп бара', 'Аренда'], includeStock: false } }),
      entry(0, 'update', null),
    ]);
    expect(rows.map((r) => [r.action, r.part, r.categories, r.user])).toEqual([
      ['Возврат по умолчанию', 'Себестоимость проданных товаров (COGS)', 'Категорий нет, себестоимость склада (FIFO)', 'Сотрудник А'],
      ['Изменение', 'Выручка', 'Все категории дохода', 'Сотрудник А'],
      ['Изменение', 'Переменные расходы', 'Закуп бара, Аренда', 'Сотрудник А'],
    ]);
  });
});
