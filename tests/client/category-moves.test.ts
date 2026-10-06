import { describe, expect, it } from 'vitest';
import { moveError, parentChoices, planMove, planShift } from '../../src/client/lib/category-moves';
import type { CategoryNode } from '../../src/client/lib/queries';

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

// 1 — системная (дочерняя 11), 2 — группа (21, 22), 3 — лист, 4 — в архиве
const tree = [n(1, null, { systemKey: 'salary' }, [n(11, 1)]), n(2, null, {}, [n(21, 2), n(22, 2)]), n(3, null), n(4, null, { archivedAt: 'x' })];

describe('перемещение статей на клиенте (те же правила, что на сервере)', () => {
  it('planMove: в другую группу, в конец, внутри группы, на верхний уровень', () => {
    expect(planMove(tree, 21, { parentId: 1, beforeId: 11 })).toEqual({ kind: 'expense', parentId: 1, ids: [21, 11], moving: 21 });
    expect(planMove(tree, 3, { parentId: 2, beforeId: null })).toEqual({ kind: 'expense', parentId: 2, ids: [21, 22, 3], moving: 3 });
    expect(planMove(tree, 22, { parentId: 2, beforeId: 21 })).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: 22 });
    expect(planMove(tree, 21, { parentId: null, beforeId: 3 })).toEqual({ kind: 'expense', parentId: null, ids: [1, 2, 21, 3, 4], moving: 21 });
  });

  it('planMove: запреты §7', () => {
    expect(planMove(tree, 1, { parentId: 2, beforeId: null })).toBe('Системная статья остаётся на верхнем уровне');
    expect(planMove(tree, 2, { parentId: 3, beforeId: null })).toBe('Статью с дочерними нельзя сделать дочерней');
    expect(planMove(tree, 3, { parentId: 21, beforeId: null })).toBe('Вкладывать можно только в статью верхнего уровня');
    expect(planMove(tree, 3, { parentId: 3, beforeId: null })).toBe('Статью нельзя вложить в саму себя');
    expect(planMove(tree, 3, { parentId: 4, beforeId: null })).toBe('Родительская статья в архиве');
    expect(planMove(tree, 99, { parentId: null, beforeId: null })).toBe('Статья не найдена');
    expect(moveError(tree, tree[2]!, null)).toBeNull();
  });

  it('planShift и parentChoices', () => {
    expect(planShift(tree, 22, -1)).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: null });
    expect(planShift(tree, 21, -1)).toBeNull();
    expect(planShift(tree, 4, 1)).toBeNull();
    expect(planShift(tree, 2, 1)).toEqual({ kind: 'expense', parentId: null, ids: [1, 3, 2, 4], moving: null });
    expect(parentChoices(tree, tree[2]!).map((p) => p.id)).toEqual([1, 2]);
    expect(parentChoices(tree, tree[1]!.children[0]!).map((p) => p.id)).toEqual([1, 3]);
    expect(parentChoices(tree, tree[0]!)).toEqual([]);
    expect(parentChoices(tree, tree[1]!)).toEqual([]);
  });
});
