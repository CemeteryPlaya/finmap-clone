import { describe, expect, it } from 'vitest';
import { dropIndexAt, dropInGroup, EDGE_SCROLL_MAX, EDGE_SCROLL_ZONE, edgeScrollStep, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../../src/client/lib/settings-list';

const row = (id: number, name: string, extra: Partial<SettingsRow> = {}): SettingsRow => ({ id, name, archived: false, ...extra });
const ids = (rows: SettingsRow[]) => rows.map((r) => r.id);

describe('visibleRows — что показывает список (§7.1, §7.2 этапа 1.5)', () => {
  it('архивные — в конце своего уровня, порядок внутри сохраняется', () => {
    const rows = [row(1, 'А', { archived: true }), row(2, 'Б'), row(3, 'В'), row(4, 'Г', { archived: true })];
    expect(ids(visibleRows(rows, ''))).toEqual([2, 3, 1, 4]);
  });

  it('подкатегории — сразу под родителем, архивные — в конце среди своих', () => {
    const rows = [
      row(1, 'Реклама'),
      row(2, 'Аренда'),
      row(10, 'Таргет', { parentId: 1, archived: true }),
      row(11, 'Баннеры', { parentId: 1 }),
      row(20, 'Зал', { parentId: 2 }),
    ];
    expect(ids(visibleRows(rows, ''))).toEqual([1, 11, 10, 2, 20]);
  });

  it('поиск без учёта регистра и «ё», по названию и по searchText; пробелы — пустой запрос', () => {
    const rows = [row(1, 'Ёлка'), row(2, 'ИП Иванов', { searchText: 'аренда зала' }), row(3, 'Бар')];
    expect(ids(visibleRows(rows, 'ЕЛК'))).toEqual([1]);
    expect(ids(visibleRows(rows, 'зала'))).toEqual([2]);
    expect(ids(visibleRows(rows, '  '))).toEqual([1, 2, 3]);
  });

  it('найденная подкатегория — вместе с родителем; у найденного родителя ненайденные дочерние скрыты', () => {
    const rows = [row(1, 'Реклама'), row(10, 'Таргет', { parentId: 1 }), row(11, 'Баннеры', { parentId: 1 }), row(2, 'Аренда')];
    expect(ids(visibleRows(rows, 'тарг'))).toEqual([1, 10]);
    expect(ids(visibleRows(rows, 'рекл'))).toEqual([1]);
  });

  it('подкатегория, чьего родителя нет в списке, — на верхнем уровне', () => {
    expect(ids(visibleRows([row(10, 'Таргет', { parentId: 99 }), row(1, 'Бар')], ''))).toEqual([10, 1]);
  });
});

describe('moveGroup — соседи одного уровня без архивных (Review Focus 5)', () => {
  const shown = visibleRows(
    [row(1, 'А'), row(10, 'А1', { parentId: 1 }), row(11, 'А2', { parentId: 1 }), row(2, 'Б'), row(3, 'В', { archived: true })],
    '',
  );

  it('верхний уровень и дочерние одного родителя — разные группы', () => {
    expect(moveGroup(shown, 2)).toEqual([1, 2]);
    expect(moveGroup(shown, 11)).toEqual([10, 11]);
  });

  it('group — отдельный круг: строки другой группы не соседи, даже на одном уровне', () => {
    const rows = [row(1, 'А', { group: 'common' }), row(2, 'Б', { group: '10' }), row(3, 'В', { group: 'common' }), row(4, 'Г', { group: '10' }), row(5, 'Д', { group: '20' })];
    const flat = visibleRows(rows, '');
    expect(moveGroup(flat, 1)).toEqual([1, 3]);
    expect(moveGroup(flat, 4)).toEqual([2, 4]);
    // клуб с одной активной строкой: двигать некого
    expect(moveGroup(flat, 5)).toEqual([5]);
  });

  it('архивная и неизвестная строка не двигаются', () => {
    expect(moveGroup(shown, 3)).toEqual([]);
    expect(moveGroup(shown, 99)).toEqual([]);
  });
});

describe('shiftInGroup — Alt+↑ / Alt+↓', () => {
  it('сдвиг на одно место', () => {
    expect(shiftInGroup([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(shiftInGroup([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });

  it('на краю группы и не из группы — null (Review Focus 5)', () => {
    expect(shiftInGroup([1, 2, 3], 1, -1)).toBeNull();
    expect(shiftInGroup([1, 2, 3], 3, 1)).toBeNull();
    expect(shiftInGroup([1, 2, 3], 9, 1)).toBeNull();
  });
});

describe('перетаскивание за ☰', () => {
  it('dropIndexAt — сколько середин строк выше указателя', () => {
    expect(dropIndexAt([100, 140, 180], 90)).toBe(0);
    expect(dropIndexAt([100, 140, 180], 120)).toBe(1);
    expect(dropIndexAt([100, 140, 180], 500)).toBe(3);
    expect(dropIndexAt([], 10)).toBe(0);
  });

  it('dropInGroup — новый порядок; то же место и строка не из группы — null', () => {
    expect(dropInGroup([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    expect(dropInGroup([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
    expect(dropInGroup([1, 2, 3], 1, 99)).toEqual([2, 3, 1]);
    expect(dropInGroup([1, 2, 3], 2, 1)).toBeNull();
    expect(dropInGroup([1, 2, 3], 9, 0)).toBeNull();
  });
});

describe('movedText — объявление нового места', () => {
  it('«Касса» — место 2 из 3', () => {
    expect(movedText('Касса', [5, 7, 9], 7)).toBe('«Касса» — место 2 из 3');
  });
});

describe('edgeScrollStep — прокрутка у края, пока строку тянут (итоги 1.5-4a)', () => {
  it('в середине области — 0', () => {
    expect(edgeScrollStep(400, 0, 800)).toBe(0);
  });

  it('у нижнего края — вниз; чем ближе к краю, тем быстрее; за краем — не быстрее предела', () => {
    const near = edgeScrollStep(800 - 50, 0, 800);
    const nearer = edgeScrollStep(800 - 10, 0, 800);
    expect(near).toBeGreaterThan(0);
    expect(nearer).toBeGreaterThan(near);
    expect(edgeScrollStep(830, 0, 800)).toBe(EDGE_SCROLL_MAX);
  });

  it('у верхнего края — вверх (отрицательный шаг); край области — её верх, а не верх окна', () => {
    expect(edgeScrollStep(110, 100, 800)).toBeLessThan(0);
    expect(edgeScrollStep(50, 100, 800)).toBe(-EDGE_SCROLL_MAX);
    expect(edgeScrollStep(110, 0, 800)).toBe(0);
  });

  it('указатель точно на краю области — предельный шаг; в слишком короткой области (зоны перекрываются) верхняя зона главнее — вниз только ниже неё', () => {
    expect(edgeScrollStep(0, 0, 800)).toBe(-EDGE_SCROLL_MAX);
    expect(edgeScrollStep(800, 0, 800)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollStep(30, 0, 60)).toBeLessThan(0);
    expect(edgeScrollStep(50, 0, 60)).toBeLessThan(0);
    expect(edgeScrollStep(60, 0, 60)).toBe(EDGE_SCROLL_MAX);
  });

  it('граница зоны ещё не прокручивает', () => {
    expect(edgeScrollStep(EDGE_SCROLL_ZONE, 0, 800)).toBe(0);
    expect(edgeScrollStep(800 - EDGE_SCROLL_ZONE, 0, 800)).toBe(0);
  });
});
