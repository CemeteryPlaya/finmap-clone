import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS_DEFAULT } from '../../src/shared/export-columns';
import { EXPORT_COLUMNS_PREF, savedExportColumns, toggleExportColumn } from '../../src/client/lib/export-columns';

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
});
