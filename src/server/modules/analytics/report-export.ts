import { getCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { flattenRows, rowLabel, shareBp, type ReportBy, type ReportColumn, type ReportRow, type ReportStep } from '../../../shared/report-engine';
import { indicatorDef, type IndicatorRow } from '../../../shared/report-indicators';
import { noBatchText } from '../../../shared/report-pnl';
import { incomeExpenseBp, marginPercent, projectLines, projectRowLabel, type ProjectRow } from '../../../shared/report-projects';
import { STATEMENT_SUMMARY, type StatementSummary } from '../../../shared/report-statement';
import type { XlsxCell, XlsxSheet } from '../../http/xlsx';
import { excelDateTime, minorToDecimal } from '../operations/journal-export';

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

/** Операция в Excel выписки: движение и остаток после операции — в валюте счёта; названия, как в таблице на экране. */
export interface StatementExportRow {
  paidAt: string;
  delta: number;
  balance: number;
  counterparty: string | null;
  category: string | null;
  project: string | null;
  comment: string | null;
}

/**
 * Лист Excel «Выписки по счету» (§2.6, §6): над таблицей — отчёт, счёт с валютой, период и сводка числами в валюте счёта
 * (как на экране, по порядку STATEMENT_SUMMARY); таблица — колонки экрана, операции новые сверху.
 */
export function statementSheet(input: {
  account: { name: string; currency: string; archived: boolean; openedAt: string };
  from: string;
  to: string;
  summary: StatementSummary;
  rows: readonly StatementExportRow[];
  timeZone: string;
}): XlsxSheet {
  const units = getCurrency(input.account.currency).minorUnits;
  const money = (v: number): XlsxCell => ({ kind: 'number', value: minorToDecimal(v, units), decimals: units });
  const text = (v: string | null): XlsxCell => (v ? { kind: 'text', value: v } : null);
  const preamble: XlsxCell[][] = [
    [{ kind: 'text', value: 'Отчёт: Выписка по счету', bold: true }],
    [{ kind: 'text', value: `Счёт: ${input.account.name}${input.account.archived ? ' (архив)' : ''}, ${input.account.currency}` }],
    [{ kind: 'text', value: `Период: ${formatDateRu(input.from)} – ${formatDateRu(input.to)}` }],
    ...STATEMENT_SUMMARY.map(({ key, label }) => [{ kind: 'text', value: label } as XlsxCell, money(input.summary[key])]),
    // счёт открыт внутри периода (R2): стартовый остаток уже в остатке на начало
    ...(input.account.openedAt > input.from
      ? [[{ kind: 'text', value: `Счёт открыт ${formatDateRu(input.account.openedAt)} — стартовый остаток учтён в остатке на начало` } as XlsxCell]]
      : []),
  ];
  return {
    name: 'Выписка',
    columns: [
      { header: 'Дата и время', width: 20 },
      { header: 'Сумма', width: 16 },
      { header: 'Остаток после операции', width: 16 },
      { header: 'Контрагент', width: 24 },
      { header: 'Категория', width: 28 },
      { header: 'Проект', width: 20 },
      { header: 'Комментарий', width: 40 },
    ],
    rows: input.rows.map((r) => [
      { kind: 'datetime', value: excelDateTime(r.paidAt, input.timeZone) },
      money(r.delta),
      money(r.balance),
      text(r.counterparty),
      text(r.category),
      text(r.project),
      text(r.comment),
    ]),
    preamble,
  };
}

/**
 * Лист Excel «Проектов» (§2.6, §7): колонки экрана — «Проект», «Доходы», «Расходы», «Прибыль», «Доход / Расход, %»,
 * «Рентабельность, %»; строки в порядке экрана, категории проекта — с отступом под ним, «Всего» — полужирным. Проценты —
 * числа (2 знака и целое), при нуле делителя — «—», как на экране.
 */
export function projectsSheet(input: { rows: readonly ProjectRow[]; total: ProjectRow; currency: string; info: readonly string[] }): XlsxSheet {
  const units = getCurrency(input.currency).minorUnits;
  const money = (v: number, bold: boolean): XlsxCell => ({ kind: 'number', value: minorToDecimal(v, units), decimals: units, bold });
  const percent = (v: number | null, decimals: number, bold: boolean): XlsxCell =>
    v === null ? { kind: 'text', value: '—', bold } : { kind: 'number', value: minorToDecimal(v, decimals), decimals, bold };
  const rows = projectLines(input.rows, input.total).map(({ row, parent }): XlsxCell[] => {
    const bold = row.kind === 'total';
    const profit = row.income - row.expense;
    return [
      { kind: 'text', value: `${parent ? '    ' : ''}${projectRowLabel(row)}`, bold },
      money(row.income, bold),
      money(row.expense, bold),
      money(profit, bold),
      percent(incomeExpenseBp(row.income, row.expense), 2, bold),
      percent(marginPercent(profit, row.income), 0, bold),
    ];
  });
  return {
    name: 'Проекты',
    columns: [
      { header: 'Проект', width: 40 },
      { header: 'Доходы', width: 16 },
      { header: 'Расходы', width: 16 },
      { header: 'Прибыль', width: 16 },
      { header: 'Доход / Расход, %', width: 18 },
      { header: 'Рентабельность, %', width: 18 },
    ],
    rows,
    preamble: input.info.map((text, i): XlsxCell[] => [{ kind: 'text', value: text, bold: i === 0 }]),
  };
}

/**
 * Лист Excel «Финансовых показателей» (§2.6, §8.1): «Показатель», колонки шага, «Итого» — как на экране. Деньги — числа в
 * базовой валюте; «Процент маржи» — целые проценты числами, при нулевой Выручке — «—» текстом.
 */
export function indicatorsSheet(input: { columns: readonly ReportColumn[]; rows: readonly IndicatorRow[]; currency: string; info: readonly string[] }): XlsxSheet {
  const units = getCurrency(input.currency).minorUnits;
  const cell = (row: IndicatorRow, v: number | null): XlsxCell => {
    if (v === null) return { kind: 'text', value: '—' };
    return indicatorDef(row.id).percent ? { kind: 'number', value: String(v), decimals: 0 } : { kind: 'number', value: minorToDecimal(v, units), decimals: units };
  };
  return {
    name: 'Показатели',
    columns: [{ header: 'Показатель', width: 28 }, ...input.columns.map((c) => ({ header: c.label, width: 16 })), { header: 'Итого', width: 16 }],
    rows: input.rows.map((row): XlsxCell[] => [{ kind: 'text', value: indicatorDef(row.id).percent ? `${row.label}, %` : row.label }, ...row.values.map((v) => cell(row, v)), cell(row, row.total)]),
    preamble: input.info.map((text, i): XlsxCell[] => [{ kind: 'text', value: text, bold: i === 0 }]),
  };
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
  /** Шаг и разрез — у отчётов по колонкам шага; у «Проектов» их нет. */
  step?: ReportStep;
  by?: ReportBy;
  /** Свои строки отчёта после периода («Проекты: активные проекты»). */
  extra?: readonly string[];
  filters: string;
  /** Только у «Прибыли»: склад учтён по себестоимости. */
  stock?: boolean;
  noBatch?: number;
}): string[] {
  const lines = [`Отчёт: ${input.title}`, `Период: ${formatDateRu(input.from)} – ${formatDateRu(input.to)}`];
  if (input.step) lines.push(`Шаг: ${STEP_TEXT[input.step]}`);
  if (input.by) lines.push(`Разрез: ${BY_TEXT[input.by]}`);
  lines.push(...(input.extra ?? []), `Фильтры: ${input.filters}`);
  if (input.stock !== undefined) lines.push(`Склад: ${input.stock ? 'по себестоимости' : 'закупки'}`);
  if (input.noBatch !== undefined && input.noBatch > 0) lines.push(noBatchText(input.noBatch));
  return lines;
}
