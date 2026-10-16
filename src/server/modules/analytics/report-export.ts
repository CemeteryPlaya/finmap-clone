import { getCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { flattenRows, rowLabel, shareBp, type ReportBy, type ReportColumn, type ReportRow, type ReportStep } from '../../../shared/report-engine';
import { noBatchText } from '../../../shared/report-pnl';
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
export function reportSheet(input: {
  name: string;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  currency: string;
  percent: boolean;
  /** Строки сведений над таблицей (reportInfo); без них лист начинается с заголовков. */
  info?: readonly string[];
}): XlsxSheet {
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
  const preamble = input.info?.map((text, i): XlsxCell[] => [{ kind: 'text', value: text, bold: i === 0 }]);
  return { name: input.name, columns: header, rows, ...(preamble && preamble.length > 0 ? { preamble } : {}) };
}

const STEP_TEXT: Record<ReportStep, string> = { day: 'по дням', week: 'по неделям', month: 'по месяцам', quarter: 'по кварталам' };
const BY_TEXT: Record<ReportBy, string> = { category: 'по категориям', counterparty: 'по контрагентам', project: 'по проектам' };

/** Названия выбранных значений фильтров отчёта (§2.4) по измерениям — как они стоят в панели фильтров. */
export interface FilterNames {
  accounts: string[];
  categories: string[];
  counterparties: string[];
  projects: string[];
  tags: string[];
  withoutCategory: boolean;
  withoutCounterparty: boolean;
  withoutProject: boolean;
}

/** Фильтры одной строкой: «Счета: Kaspi; Категории: Бар, Аренда; Без проекта»; нет фильтров — «нет». */
export function filterText(f: FilterNames): string {
  const parts: string[] = [];
  const add = (label: string, names: readonly string[]) => names.length > 0 && parts.push(`${label}: ${names.join(', ')}`);
  add('Счета', f.accounts);
  add('Категории', f.categories);
  add('Контрагенты', f.counterparties);
  add('Проекты', f.projects);
  add('Теги', f.tags);
  if (f.withoutCategory) parts.push('Без категории');
  if (f.withoutCounterparty) parts.push('Без контрагента');
  if (f.withoutProject) parts.push('Без проекта');
  return parts.length > 0 ? parts.join('; ') : 'нет';
}

/**
 * Строки сведений над таблицей Excel (R13): название отчёта, период, шаг, разрез, фильтры; у «Прибыли» — как учтён склад
 * и, если есть продажи без партии, предупреждение «прибыль завышена». Без них файл, открытый позже, не говорит, при каких
 * настройках получены цифры.
 */
export function reportInfo(input: {
  title: string;
  from: string;
  to: string;
  step: ReportStep;
  by: ReportBy;
  filters: string;
  /** Только у «Прибыли»: склад учтён по себестоимости. */
  stock?: boolean;
  noBatch?: number;
}): string[] {
  const lines = [
    `Отчёт: ${input.title}`,
    `Период: ${formatDateRu(input.from)} – ${formatDateRu(input.to)}`,
    `Шаг: ${STEP_TEXT[input.step]}`,
    `Разрез: ${BY_TEXT[input.by]}`,
    `Фильтры: ${input.filters}`,
  ];
  if (input.stock !== undefined) lines.push(`Склад: ${input.stock ? 'по себестоимости' : 'закупки'}`);
  if (input.noBatch !== undefined && input.noBatch > 0) lines.push(noBatchText(input.noBatch));
  return lines;
}
