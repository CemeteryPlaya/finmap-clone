import { getCurrency } from '../../../shared/currencies';
import { flattenRows, rowLabel, shareBp, type ReportColumn, type ReportRow } from '../../../shared/report-engine';
import type { XlsxCell, XlsxSheet } from '../../http/xlsx';
import { minorToDecimal } from '../operations/journal-export';

/** Строки, выделенные на экране (остатки, итоги, группы), — полужирным и в файле. */
const BOLD = new Set(['balance:start', 'balance:end', 'nonop', 'net', 'profit', 'income', 'expense']);

/**
 * Лист Excel отчёта (§2.6 спецификации «Аналитика»): колонки и строки — как в таблице на экране: «Название», колонки шага,
 * «Итого»; все строки раскрыты (подкатегории, неоперационные подстроки), вложенность — отступом в названии. Суммы —
 * числа в базовой валюте с форматом валюты; нет значения (нет курса, остатки скрыты) — пустая ячейка. С процентами
 * (percent) после каждой суммы — колонка «%» с долей строки в группе, как «(12,50 %)» на экране.
 */
export function reportSheet(input: { name: string; columns: readonly ReportColumn[]; rows: readonly ReportRow[]; currency: string; percent: boolean }): XlsxSheet {
  const units = getCurrency(input.currency).minorUnits;
  const money = (v: number | null, bold: boolean): XlsxCell => (v === null ? null : { kind: 'number', value: minorToDecimal(v, units), decimals: units, bold });
  const share = (v: number | null, group: number | null, bold: boolean): XlsxCell => {
    const bp = shareBp(v, group);
    return bp === null ? null : { kind: 'number', value: minorToDecimal(bp, 2), decimals: 2, bold };
  };
  const header = [
    { header: 'Название', width: 44 },
    ...input.columns.flatMap((c) => [{ header: c.label, width: 16 }, ...(input.percent ? [{ header: '%', width: 9 }] : [])]),
    { header: 'Итого', width: 16 },
    ...(input.percent ? [{ header: '%', width: 9 }] : []),
  ];
  const rows: XlsxCell[][] = flattenRows(input.rows, () => true).map((line) => {
    const { row } = line;
    const bold = BOLD.has(row.id);
    const label = `${'    '.repeat(line.depth)}${rowLabel(row)}${row.note ? ` — ${row.note}` : ''}`;
    const cells: XlsxCell[] = [{ kind: 'text', value: label, bold }];
    const at = (v: number | null, g: number | null) => [money(v, bold), ...(input.percent ? [line.group ? share(v, g, bold) : null] : [])];
    row.values.forEach((v, i) => cells.push(...at(v, line.group?.values[i] ?? null)));
    cells.push(...at(row.total, line.group?.total ?? null));
    return cells;
  });
  return { name: input.name, columns: header, rows };
}
