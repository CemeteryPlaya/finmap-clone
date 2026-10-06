import { describe, expect, it } from 'vitest';
import { moveWithinGroup } from '../../src/client/lib/order';

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
