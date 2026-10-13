import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS_DEFAULT } from '../../src/shared/export-columns';
import {
  columnPositionText,
  columnRemovedText,
  dropExportColumn,
  EXPORT_COLUMNS_PREF,
  focusIndexAfterRemove,
  savedExportColumns,
  shiftExportColumn,
  toggleExportColumn,
} from '../../src/client/lib/export-columns';

describe('набор колонок «Собрать Excel» (§8.3 спецификации импорта)', () => {
  it('настройка называется export.columns', () => {
    expect(EXPORT_COLUMNS_PREF).toBe('export.columns');
  });

  it('нет настройки, не массив или пусто после отбрасывания — набор по умолчанию (все колонки Finmap)', () => {
    for (const bad of [undefined, null, 'amount', 5, {}, [], ['nope'], [1, null, 'constructor']]) {
      expect(savedExportColumns(bad), JSON.stringify(bad)).toEqual([...EXPORT_COLUMNS_DEFAULT]);
    }
    // копия: правка результата не портит общий набор
    savedExportColumns(undefined).push('type');
    expect(savedExportColumns(undefined)).toHaveLength(14);
  });

  it('сохранённый набор: порядок сохраняется, неизвестные id и повторы отбрасываются', () => {
    expect(savedExportColumns(['comment', 'nope', 'amount', 'comment', 7, 'type'])).toEqual(['comment', 'amount', 'type']);
  });

  it('чип: включённая колонка добавляется в конец, выключенная убирается — порядок остальных не меняется', () => {
    expect(toggleExportColumn(['amount', 'paidAt'], 'comment')).toEqual(['amount', 'paidAt', 'comment']);
    expect(toggleExportColumn(['amount', 'paidAt', 'comment'], 'paidAt')).toEqual(['amount', 'comment']);
    expect(toggleExportColumn(['amount'], 'amount')).toEqual([]);
    const before = ['amount'] as const;
    toggleExportColumn(before, 'type');
    expect(before).toEqual(['amount']);
  });

  it('Alt+← / Alt+→: колонка встаёт на соседнее место; на краю и вне набора — null; исходный набор не меняется', () => {
    const cols = ['paidAt', 'amount', 'comment'] as const;
    expect(shiftExportColumn(cols, 'amount', 1)).toEqual(['paidAt', 'comment', 'amount']);
    expect(shiftExportColumn(cols, 'amount', -1)).toEqual(['amount', 'paidAt', 'comment']);
    expect(shiftExportColumn(cols, 'paidAt', -1)).toBeNull();
    expect(shiftExportColumn(cols, 'comment', 1)).toBeNull();
    expect(shiftExportColumn(cols, 'type', 1)).toBeNull();
    expect(cols).toEqual(['paidAt', 'amount', 'comment']);
  });

  it('перетаскивание: колонку отпустили на место среди остальных; то же место и колонка вне набора — null; индекс за краями — к краю', () => {
    const cols = ['paidAt', 'amount', 'comment', 'type'] as const;
    expect(dropExportColumn(cols, 'type', 0)).toEqual(['type', 'paidAt', 'amount', 'comment']);
    expect(dropExportColumn(cols, 'paidAt', 3)).toEqual(['amount', 'comment', 'type', 'paidAt']);
    expect(dropExportColumn(cols, 'amount', 1)).toBeNull(); // осталась на своём месте
    expect(dropExportColumn(cols, 'amount', -5)).toEqual(['amount', 'paidAt', 'comment', 'type']);
    expect(dropExportColumn(cols, 'amount', 99)).toEqual(['paidAt', 'comment', 'type', 'amount']);
    expect(dropExportColumn(cols, 'tags', 0)).toBeNull();
  });

  it('объявления: место колонки после перестановки и остаток после «×»; фокус после «×» — на ближайшую оставшуюся колонку', () => {
    expect(columnPositionText(['paidAt', 'amount', 'comment'], 'amount')).toBe('Сумма в валюте счета — колонка 2 из 3');
    expect(columnRemovedText('type', 5)).toBe('Колонка «Тип» убрана. Осталось колонок: 5');
    const cols = ['paidAt', 'amount', 'comment'] as const;
    expect(focusIndexAfterRemove(cols, 'paidAt')).toBe(0);
    expect(focusIndexAfterRemove(cols, 'amount')).toBe(1);
    expect(focusIndexAfterRemove(cols, 'comment')).toBe(1); // последняя — фокус на новую последнюю
    expect(focusIndexAfterRemove(['amount'], 'amount')).toBeNull();
    expect(focusIndexAfterRemove(cols, 'type')).toBeNull();
  });
});
