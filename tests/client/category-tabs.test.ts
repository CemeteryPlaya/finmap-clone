import { describe, expect, it } from 'vitest';
import { CATEGORY_TABS, applyCategoryOrder, categoryReorderPlan, categoryShiftPlan, categoryRows, categoryTab, parentOptions } from '../../src/client/lib/category-tabs';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';

const n = (id: number, parentId: number | null, extra: Partial<CategoryNode> = {}, children: CategoryNode[] = []): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId,
  name: `c${id}`,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children,
  ...extra,
});

// расходы: 1 — системная (дочерняя 11), 2 — своя (21, 22 в архиве), 3 — своя, 4 — системная
const tree: CategoryTree = {
  income: [n(30, null, { kind: 'income', systemKey: 'investment' }), n(31, null, { kind: 'income' })],
  expense: [n(1, null, { systemKey: 'salary' }, [n(11, 1)]), n(2, null, {}, [n(21, 2), n(22, 2, { archivedAt: 'x' })]), n(3, null), n(4, null, { systemKey: 'tax' })],
};

describe('вкладки «Категорий» (§7.2 этапа 1.5)', () => {
  it('порядок и подписи как в Finmap', () => {
    expect(CATEGORY_TABS.map((t) => [t.tab, t.label])).toEqual([
      ['system-income', 'Системные категории дохода'],
      ['system-expense', 'Системные категории расхода'],
      ['my-income', 'Мои категории дохода'],
      ['my-expense', 'Мои категории расхода'],
    ]);
  });

  it('параметр адреса: известный — он, иначе «Мои категории расхода»', () => {
    expect(categoryTab('system-income')).toBe('system-income');
    expect(categoryTab(null)).toBe('my-expense');
    expect(categoryTab('nope')).toBe('my-expense');
  });
});

describe('categoryRows — строки вкладки', () => {
  it('«Мои»: свои категории верхнего уровня вида, под каждой — её дочерние', () => {
    expect(categoryRows(tree, 'my-expense').map((r) => [r.id, r.parentId, r.topLevel, r.system, r.archived])).toEqual([
      [2, null, true, false, false],
      [21, 2, false, false, false],
      [22, 2, false, false, true],
      [3, null, true, false, false],
    ]);
    expect(categoryRows(tree, 'my-income').map((r) => r.id)).toEqual([31]);
  });

  it('«Системные»: системные с дочерними; дочерние — обычные строки', () => {
    expect(categoryRows(tree, 'system-expense').map((r) => [r.id, r.system])).toEqual([
      [1, true],
      [11, false],
      [4, true],
    ]);
  });
});

describe('categoryReorderPlan — порядок вкладки в полном порядке уровня (Review Focus 1)', () => {
  it('свои на верхнем уровне меняются местами, системные остаются на своих местах', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [3, 2])).toEqual({ kind: 'expense', parentId: null, ids: [1, 3, 2, 4], moving: null });
  });

  it('системная между своими остаётся на своём месте', () => {
    const mixed: CategoryTree = { income: [], expense: [n(2, null), n(1, null, { systemKey: 'salary' }), n(3, null)] };
    expect(categoryReorderPlan(mixed, 'my-expense', [3, 2])).toEqual({ kind: 'expense', parentId: null, ids: [3, 1, 2], moving: null });
  });

  it('дочерние — порядок детей родителя', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [22, 21])).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: null });
  });

  it('пустая группа и неизвестный id — null', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [])).toBeNull();
    expect(categoryReorderPlan(tree, 'my-expense', [99])).toBeNull();
  });
});

describe('parentOptions — «Перенести в…» (Review Focus 2)', () => {
  const level = tree.expense;

  it('лист верхнего уровня: «Верхний уровень» и все допустимые родители, включая системные', () => {
    expect(parentOptions(level, level[2]!).map((o) => o.value)).toEqual(['top', '1', '2', '4']);
    expect(parentOptions(level, level[2]!)[0]).toEqual({ value: 'top', label: 'Верхний уровень' });
  });

  it('категория с дочерними — только «Верхний уровень»', () => {
    expect(parentOptions(level, level[1]!).map((o) => o.value)).toEqual(['top']);
  });

  it('подкатегория: её родитель и другие допустимые', () => {
    expect(parentOptions(level, level[1]!.children[0]!).map((o) => o.value)).toEqual(['top', '1', '2', '3', '4']);
  });
});

describe('parentOptions — архивный родитель', () => {
  const level = [n(1, null, { archivedAt: 'x' }), n(2, null), n(3, null, {}, [n(31, 3)]), n(4, null, { archivedAt: 'x' }, [n(41, 4)])];

  it('архивная категория не предлагается как новый родитель', () => {
    expect(parentOptions(level, level[1]!).map((o) => o.value)).toEqual(['top', '3']);
  });

  it('архивный текущий родитель остаётся в списке', () => {
    expect(parentOptions(level, level[3]!.children[0]!).map((o) => o.value)).toEqual(['top', '2', '3', '4']);
  });
});

describe('categoryShiftPlan — ↑ ↓ в окне категории', () => {
  const mixed: CategoryTree = {
    income: [],
    expense: [n(1, null, { systemKey: 'salary' }), n(2, null), n(3, null, { archivedAt: 'x' }), n(4, null), n(5, null, { systemKey: 'tax' })],
  };

  it('среди видимых своих: системные и архивные остаются на местах', () => {
    expect(categoryShiftPlan(mixed, 'my-expense', 4, -1)).toEqual({ kind: 'expense', parentId: null, ids: [1, 4, 3, 2, 5], moving: null });
  });

  it('на краю группы и у архивной — null', () => {
    expect(categoryShiftPlan(mixed, 'my-expense', 2, -1)).toBeNull();
    expect(categoryShiftPlan(mixed, 'my-expense', 4, 1)).toBeNull();
    expect(categoryShiftPlan(mixed, 'my-expense', 3, 1)).toBeNull();
  });
});

describe('applyCategoryOrder', () => {
  it('верхний уровень и дети родителя', () => {
    expect(applyCategoryOrder(tree, { kind: 'expense', parentId: null, ids: [4, 3, 2, 1], moving: null }).expense.map((x) => x.id)).toEqual([4, 3, 2, 1]);
    const out = applyCategoryOrder(tree, { kind: 'expense', parentId: 2, ids: [22, 21], moving: null });
    expect(out.expense[1]!.children.map((x) => x.id)).toEqual([22, 21]);
    expect(out.income).toBe(tree.income);
  });
});
