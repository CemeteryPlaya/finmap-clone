import { describe, expect, it } from 'vitest';
import {
  EXPORT_COLUMN_IDS,
  EXPORT_COLUMNS,
  EXPORT_COLUMNS_DEFAULT,
  EXPORT_COLUMNS_MAX,
  EXPORT_GROUPS,
  exportColumnLabel,
  isExportColumnId,
} from '../../src/shared/export-columns';
import { FINMAP_COLUMNS } from '../../src/shared/finmap-format';

describe('каталог колонок «Собрать Excel» (§8.3 спецификации импорта)', () => {
  it('20 уникальных колонок: 14 колонок Finmap и 6 «наших»; «Подконтрагента», «Подпроекта» и «Статуса» нет — мёртвых чипов нет', () => {
    expect(EXPORT_COLUMNS).toHaveLength(20);
    expect(EXPORT_COLUMNS_MAX).toBe(20);
    expect(new Set(EXPORT_COLUMN_IDS).size).toBe(20);
    expect(EXPORT_COLUMNS.filter((c) => !c.ours)).toHaveLength(14);
    expect(EXPORT_COLUMNS.filter((c) => c.ours).map((c) => c.id)).toEqual(['type', 'currency', 'balanceAfter', 'toAmount', 'toCurrency', 'toBalanceAfter']);
    expect(EXPORT_COLUMN_IDS).not.toContain('subcounterparty');
    expect(EXPORT_COLUMN_IDS).not.toContain('subproject');
    expect(EXPORT_COLUMN_IDS).not.toContain('status');
  });

  it('названия колонок Finmap — заголовки шаблона без звёздочки; по умолчанию — они все в порядке шаблона, без «Типа» и без «Остатков и валют»', () => {
    for (const c of EXPORT_COLUMNS.filter((x) => !x.ours)) {
      expect(FINMAP_COLUMNS.find((f) => f.field === c.id)!.header.replace('*', '')).toBe(c.label);
    }
    expect(exportColumnLabel('amount')).toBe('Сумма в валюте счета');
    expect(exportColumnLabel('periodFrom')).toBe('Период начисления (дата "с")');
    expect(EXPORT_COLUMNS_DEFAULT).toEqual(FINMAP_COLUMNS.map((c) => c.field).filter((f) => f !== 'subcounterparty' && f !== 'subproject'));
    expect(EXPORT_COLUMNS_DEFAULT).toHaveLength(14);
  });

  it('группы чипов — как в §8.3, в каждой есть колонки, каждая колонка в одной из групп', () => {
    expect(EXPORT_GROUPS.map((g) => g.label)).toEqual(['Операция', 'Счета', 'Категории', 'Контрагенты', 'Проекты', 'Теги и комментарий', 'Остатки и валюты']);
    for (const g of EXPORT_GROUPS) expect(EXPORT_COLUMNS.some((c) => c.group === g.id), g.label).toBe(true);
    expect(EXPORT_COLUMNS.every((c) => EXPORT_GROUPS.some((g) => g.id === c.group))).toBe(true);
    // группа «Остатки и валюты» — только «наши» колонки
    expect(EXPORT_COLUMNS.filter((c) => c.group === 'balances').every((c) => c.ours)).toBe(true);
  });

  it('isExportColumnId: известные id — да; прочее, в том числе имена полей объекта, — нет', () => {
    expect(isExportColumnId('amount')).toBe(true);
    expect(isExportColumnId('toBalanceAfter')).toBe(true);
    for (const bad of ['', 'Amount', 'subproject', 'constructor', '__proto__', 5, null, undefined]) expect(isExportColumnId(bad), String(bad)).toBe(false);
  });
});
