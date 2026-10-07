import { describe, expect, it } from 'vitest';
import { uniqueById } from '../../src/client/lib/journal-format';

describe('uniqueById — строки журнала из страниц без повторов', () => {
  it('убирает повторы по id, оставляя первое вхождение и порядок', () => {
    const items = [
      { id: 3, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
      { id: 1, v: 'd' },
      { id: 2, v: 'e' },
    ];
    expect(uniqueById(items)).toEqual([
      { id: 3, v: 'a' },
      { id: 2, v: 'b' },
      { id: 1, v: 'd' },
    ]);
  });

  it('список без повторов не меняется, пустой остаётся пустым', () => {
    const items = [{ id: 1 }, { id: 2 }];
    expect(uniqueById(items)).toEqual(items);
    expect(uniqueById([])).toEqual([]);
  });
});
