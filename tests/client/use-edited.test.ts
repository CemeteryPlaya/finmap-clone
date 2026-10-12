import { describe, expect, it } from 'vitest';
import { editedItem } from '../../src/client/lib/use-edited';

const a = { id: 1, name: 'Альфа' };
const b = { id: 2, name: 'Бета' };

describe('editedItem — окно правки по id (R5 плана 1.5-4b)', () => {
  it('найден — свежий элемент из списка', () => {
    expect(editedItem(null, [a, b], 2)).toEqual({ item: b, gone: false });
    expect(editedItem(a, [{ ...a, name: 'Альфа 2' }], 1)).toEqual({ item: { id: 1, name: 'Альфа 2' }, gone: false });
  });

  it('пропал из списка — последний найденный снимок и gone', () => {
    expect(editedItem(a, [b], 1)).toEqual({ item: a, gone: true });
  });

  it('снимок другого id не подменяет пропавший элемент', () => {
    expect(editedItem(b, [b], 1)).toEqual({ item: null, gone: true });
  });

  it('создание и закрытое окно — без элемента и без «не найден»', () => {
    expect(editedItem(a, [a], 'new')).toEqual({ item: null, gone: false });
    expect(editedItem(a, [a], null)).toEqual({ item: null, gone: false });
  });

  it('список ещё не загружен — элемента нет', () => {
    expect(editedItem(null, undefined, 1)).toEqual({ item: null, gone: true });
  });
});
