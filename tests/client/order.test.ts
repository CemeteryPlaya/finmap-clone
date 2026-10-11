import { describe, expect, it } from 'vitest';
import { mergeSubsetOrder, moveWithinGroup, sortByIds } from '../../src/client/lib/order';

describe('moveWithinGroup', () => {
  it('меняет местами с соседом по группе в полном списке', () => {
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    // группа — счета одного проекта вперемешку со счетами других
    expect(moveWithinGroup([1, 2, 3, 4], [1, 3], 3, -1)).toEqual([3, 2, 1, 4]);
  });

  it('на краю группы и для id не из группы — null', () => {
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 1, -1)).toBeNull();
    expect(moveWithinGroup([1, 2, 3], [1, 2, 3], 3, 1)).toBeNull();
    expect(moveWithinGroup([1, 2, 3], [1, 3], 2, 1)).toBeNull();
  });
});

describe('mergeSubsetOrder — порядок видимой части в полном списке (§7.1 этапа 1.5, Review Focus 1)', () => {
  it('строки подмножества встают на свои прежние места в новом порядке, остальные не двигаются', () => {
    expect(mergeSubsetOrder([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
    // архивный 3 между активными остаётся на месте
    expect(mergeSubsetOrder([1, 3, 2, 4], [4, 2, 1])).toEqual([4, 3, 2, 1]);
  });

  it('тот же порядок — тот же список; чужие id подмножества пропускаются', () => {
    expect(mergeSubsetOrder([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(mergeSubsetOrder([1, 2, 3], [9, 3, 1])).toEqual([3, 2, 1]);
  });

  it('краевые случаи: пустое подмножество, группа из одного, повторы в подмножестве', () => {
    expect(mergeSubsetOrder([1, 2, 3], [])).toEqual([1, 2, 3]);
    expect(mergeSubsetOrder([], [1, 2])).toEqual([]);
    expect(mergeSubsetOrder([1, 2, 3], [2])).toEqual([1, 2, 3]);
    // повтор не должен породить дубль id в полном порядке
    expect(mergeSubsetOrder([1, 2, 3, 4], [3, 3, 1])).toEqual([3, 2, 1, 4]);
  });
});

describe('sortByIds — оптимистичный порядок в кэше', () => {
  it('по списку id; не названные — в конце в прежнем порядке', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(sortByIds(rows, [3, 1]).map((r) => r.id)).toEqual([3, 1, 2, 4]);
    expect(sortByIds(rows, [4, 3, 2, 1]).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });
});
