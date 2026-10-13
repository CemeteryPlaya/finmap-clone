import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, formatDateTime, zoneOffsetMs } from '../../../shared/dates';
import { EXPORT_COLUMNS, exportColumnLabel, type ExportColumnId } from '../../../shared/export-columns';
import { FINMAP_COLUMNS, type FinmapField } from '../../../shared/finmap-format';
import { formatAmount } from '../../../shared/money';
import type { SystemKey } from '../../../shared/system-categories';
import type { XlsxCell, XlsxSheet } from '../../http/xlsx';

/** Строка операции для выгрузки: категория, системная категория и проект строки (§8.2 спецификации импорта). */
export interface ExportLine {
  /** Название категории строки (у дочерней — её собственное); null — без категории. */
  category: string | null;
  /** Родитель дочерней категории; у верхнего уровня и без категории — null. */
  parent: string | null;
  /** Системная категория строки или её родителя (`effectiveSystemKey`). */
  systemKey: SystemKey | null;
  project: string | null;
  amount: number;
  baseAmount: number;
}

/** Операция выгрузки: названия справочников вместо идентификаторов, строки по порядку. */
export interface ExportOperation {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  paidAt: string;
  accrualDate: string | null;
  amount: number;
  baseAmount: number;
  currency: string;
  accountName: string;
  /** Остаток счёта после операции (§4.7); null — не считался или не нужен. */
  balanceAfter: number | null;
  toAccountName: string | null;
  toAmount: number | null;
  toCurrency: string | null;
  toBalanceAfter: number | null;
  counterpartyName: string | null;
  lines: ExportLine[];
  tags: string[];
  comment: string | null;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Минимальные единицы → десятичная запись без округления и экспоненты: (-150050, 2) → «-1500.50». */
export function minorToDecimal(minor: number, minorUnits: number): string {
  const abs = String(Math.abs(minor)).padStart(minorUnits + 1, '0');
  const int = minorUnits > 0 ? abs.slice(0, -minorUnits) : abs;
  const frac = minorUnits > 0 ? `.${abs.slice(-minorUnits)}` : '';
  return `${minor < 0 ? '-' : ''}${int}${frac}`;
}

/** Момент → дата и время Excel по часам APP_TIMEZONE (дни от 30.12.1899 с долей суток). */
export function excelDateTime(iso: string, timeZone: string): number {
  const t = Date.parse(iso);
  return (t + zoneOffsetMs(t, timeZone) - EXCEL_EPOCH) / DAY_MS;
}

/** Календарная дата `YYYY-MM-DD` → дата Excel. */
export function excelDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY_MS;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Системные категории, у которых дата начисления первого числа месяца уходит периодом (§8.2): зарплата, налоги, НДС. */
const PERIOD_KEYS: readonly SystemKey[] = ['salary', 'tax', 'vat'];

/**
 * Период начисления (§8.2): у зарплаты, налогов и НДС дата начисления — первое число месяца — уходит периодом «с — по»
 * текстом, как в выгрузке Finmap: «01.09.2026 00:00:00» — «30.09.2026 23:59:59». При импорте период возвращается в то же
 * `accrualDate` (§4.3). Другая категория или другое число — null: дата уходит в «Дату начисления».
 */
export function accrualPeriod(accrualDate: string | null, keys: readonly (SystemKey | null)[]): { from: string; to: string } | null {
  if (!accrualDate?.endsWith('-01')) return null;
  if (!keys.some((k) => k !== null && PERIOD_KEYS.includes(k))) return null;
  const [y, m] = accrualDate.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `01.${pad2(m)}.${y} 00:00:00`, to: `${pad2(last)}.${pad2(m)}.${y} 23:59:59` };
}

const textCell = (value: string | null | undefined): XlsxCell => (value ? { kind: 'text', value } : null);
const moneyCell = (minor: number | null, currency: string | null): XlsxCell => {
  if (minor === null || currency === null) return null;
  const units = getCurrency(currency).minorUnits;
  return { kind: 'number', value: minorToDecimal(minor, units), decimals: units };
};

// ——— «Excel» — формат Finmap (§8.2)

export const FINMAP_SHEET_NAME = 'ExportRU';

const FINMAP_WIDTH: Record<FinmapField, number> = {
  paidAt: 17,
  accrualDate: 14,
  periodFrom: 21,
  periodTo: 21,
  amount: 15,
  baseAmount: 15,
  fromAccount: 22,
  toAccount: 22,
  category: 24,
  subcategory: 24,
  counterparty: 24,
  subcounterparty: 16,
  project: 20,
  subproject: 16,
  tags: 20,
  comment: 40,
};

/**
 * Лист «Excel» (§8.2): 16 колонок шаблона импорта Finmap, заголовки — тексты шаблона. Операция — строка; разбитая
 * (несколько строк) — строка на каждую строку операции: сумма, категория и проект — строки, остальное повторяется. Суммы
 * положительные; тип следует из «Со счета» и «На счет». У перевода категория, контрагент и дата начисления не пишутся.
 */
export function finmapSheet(ops: ExportOperation[], baseCurrency: string, timeZone: string): XlsxSheet {
  const rows: XlsxCell[][] = [];
  for (const o of ops) {
    const transfer = o.type === 'transfer';
    const paidAt: XlsxCell = { kind: 'datetime', value: excelDateTime(o.paidAt, timeZone) };
    // у перевода и операции без строк — одна строка с суммами операции; у дохода и расхода — строка на строку операции
    const parts: (ExportLine | null)[] = transfer || o.lines.length === 0 ? [o.lines[0] ?? null] : o.lines;
    for (const line of parts) {
      const period = transfer ? null : accrualPeriod(o.accrualDate, [line?.systemKey ?? null]);
      const cells: Record<FinmapField, XlsxCell> = {
        paidAt,
        accrualDate: transfer || period || !o.accrualDate ? null : { kind: 'date', value: excelDate(o.accrualDate) },
        periodFrom: textCell(period?.from),
        periodTo: textCell(period?.to),
        amount: moneyCell(transfer || !line ? o.amount : line.amount, o.currency),
        baseAmount: moneyCell(transfer || !line ? o.baseAmount : line.baseAmount, baseCurrency),
        fromAccount: textCell(o.type === 'income' ? null : o.accountName),
        toAccount: textCell(o.type === 'income' ? o.accountName : transfer ? o.toAccountName : null),
        category: transfer ? null : textCell(line?.parent ?? line?.category),
        subcategory: transfer ? null : textCell(line?.parent ? line.category : null),
        counterparty: transfer ? null : textCell(o.counterpartyName),
        subcounterparty: null,
        project: textCell(line?.project),
        subproject: null,
        tags: textCell(o.tags.join(', ')),
        comment: textCell(o.comment),
      };
      rows.push(FINMAP_COLUMNS.map((c) => cells[c.field]));
    }
  }
  return {
    name: FINMAP_SHEET_NAME,
    columns: FINMAP_COLUMNS.map((c) => ({ header: c.header, width: FINMAP_WIDTH[c.field] })),
    rows,
  };
}

// ——— «Собрать Excel» (§8.3)

export const CUSTOM_SHEET_NAME = 'Журнал';

const TYPE_LABEL = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' } as const;
/** Знак суммы в файле: расход — минус, доход и перевод — без знака (как превью Finmap, §8.3). */
const SIGN = { income: 1, expense: -1, transfer: 1 } as const;

/** Значение колонки: ячейка файла и её текст для превью окна — из одного места, чтобы превью не расходилось с файлом. */
interface Value {
  cell: XlsxCell;
  text: string;
}

const NONE: Value = { cell: null, text: '' };
const textValue = (s: string | null | undefined): Value => (s ? { cell: { kind: 'text', value: s }, text: s } : NONE);
const moneyValue = (minor: number | null, currency: string | null): Value => {
  const cell = moneyCell(minor, currency);
  return cell && minor !== null && currency !== null ? { cell, text: formatAmount(minor, getCurrency(currency).minorUnits) } : NONE;
};
const unique = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

interface ColumnContext {
  baseCurrency: string;
  timeZone: string;
}

/** Период начисления операции: у перевода нет; у разбитой — если хотя бы у одной строки подходящая категория (§8.2). */
const periodOf = (o: ExportOperation) => (o.type === 'transfer' ? null : accrualPeriod(o.accrualDate, o.lines.map((l) => l.systemKey)));

/**
 * Значения колонок «Собрать Excel»: одна строка на операцию. У разбитой операции категории, подкатегории и проекты строк
 * — через «; ». Суммы со знаком (расход — минус, перевод — без знака). «Дата начисления» пишется всегда, период «с» и «по» —
 * по правилу §8.2 (у Finmap в выгрузке заполнены и дата, и период).
 */
const VALUE: Record<ExportColumnId, (o: ExportOperation, c: ColumnContext) => Value> = {
  paidAt: (o, c) => ({ cell: { kind: 'datetime', value: excelDateTime(o.paidAt, c.timeZone) }, text: formatDateTime(o.paidAt, c.timeZone).replace(', ', ' ') }),
  accrualDate: (o) => (o.accrualDate ? { cell: { kind: 'date', value: excelDate(o.accrualDate) }, text: formatDateRu(o.accrualDate) } : NONE),
  periodFrom: (o) => textValue(periodOf(o)?.from),
  periodTo: (o) => textValue(periodOf(o)?.to),
  amount: (o) => moneyValue(SIGN[o.type] * o.amount, o.currency),
  baseAmount: (o, c) => moneyValue(SIGN[o.type] * o.baseAmount, c.baseCurrency),
  type: (o) => textValue(TYPE_LABEL[o.type]),
  fromAccount: (o) => textValue(o.type === 'income' ? null : o.accountName),
  toAccount: (o) => textValue(o.type === 'income' ? o.accountName : o.type === 'transfer' ? o.toAccountName : null),
  category: (o) => textValue(unique(o.lines.map((l) => l.parent ?? l.category)).join('; ')),
  subcategory: (o) => textValue(unique(o.lines.map((l) => (l.parent ? l.category : null))).join('; ')),
  counterparty: (o) => textValue(o.counterpartyName),
  project: (o) => textValue(unique(o.lines.map((l) => l.project)).join('; ')),
  tags: (o) => textValue(o.tags.join(', ')),
  comment: (o) => textValue(o.comment),
  currency: (o) => textValue(o.currency),
  balanceAfter: (o) => moneyValue(o.balanceAfter, o.currency),
  toAmount: (o) => moneyValue(o.toAmount, o.toCurrency),
  toCurrency: (o) => textValue(o.toCurrency),
  toBalanceAfter: (o) => moneyValue(o.toBalanceAfter, o.toCurrency),
};

const CUSTOM_WIDTH: Record<ExportColumnId, number> = {
  paidAt: 17,
  accrualDate: 14,
  periodFrom: 21,
  periodTo: 21,
  amount: 15,
  baseAmount: 15,
  type: 10,
  fromAccount: 22,
  toAccount: 22,
  category: 24,
  subcategory: 24,
  counterparty: 24,
  project: 20,
  tags: 20,
  comment: 40,
  currency: 10,
  balanceAfter: 15,
  toAmount: 15,
  toCurrency: 10,
  toBalanceAfter: 15,
};

/** Сумма как число минимальных единиц; вне безопасного целого — null (ячейка итога остаётся пустой). */
const safeSum = (xs: number[]): number | null => {
  const sum = xs.reduce((s, x) => s + x, 0);
  return Number.isSafeInteger(sum) ? sum : null;
};

/**
 * Строка «Итого» (§8.3), полужирным, значения — не формулы: «Сумма в валюте компании» — сумма значений со знаком;
 * «Сумма в валюте счета» — только если у всех операций одна валюта; «Сумма зачисления» — только если у всех переводов одна
 * валюта зачисления; остальные колонки пусты. Подпись «Итого» — в первой колонке без суммы (если такая есть). Операций
 * нет — строки нет.
 */
function totalsRow(ops: ExportOperation[], columns: readonly ExportColumnId[], baseCurrency: string): XlsxCell[] | null {
  if (ops.length === 0) return null;
  const transfers = ops.filter((o) => o.type === 'transfer');
  const currencies = new Set(ops.map((o) => o.currency));
  const toCurrencies = new Set(transfers.map((o) => o.toCurrency));
  const total = (id: ExportColumnId): Value => {
    if (id === 'baseAmount') return moneyValue(safeSum(ops.map((o) => SIGN[o.type] * o.baseAmount)), baseCurrency);
    if (id === 'amount' && currencies.size === 1) return moneyValue(safeSum(ops.map((o) => SIGN[o.type] * o.amount)), ops[0]!.currency);
    if (id === 'toAmount' && transfers.length > 0 && toCurrencies.size === 1) return moneyValue(safeSum(transfers.map((o) => o.toAmount ?? 0)), transfers[0]!.toCurrency);
    return NONE;
  };
  const cells = columns.map((id) => total(id).cell);
  const label = cells.findIndex((c) => c === null);
  return cells.map((cell, i) => (i === label ? { kind: 'text', value: 'Итого', bold: true } : cell && { ...cell, bold: true }));
}

/** Лист «Собрать Excel»: колонки в заданном порядке, строка на операцию, внизу «Итого». */
export function customSheet(ops: ExportOperation[], columns: readonly ExportColumnId[], baseCurrency: string, timeZone: string): XlsxSheet {
  const ctx: ColumnContext = { baseCurrency, timeZone };
  const rows = ops.map((o) => columns.map((id) => VALUE[id](o, ctx).cell));
  const totals = totalsRow(ops, columns, baseCurrency);
  if (totals) rows.push(totals);
  return { name: CUSTOM_SHEET_NAME, columns: columns.map((id) => ({ header: exportColumnLabel(id), width: CUSTOM_WIDTH[id] })), rows };
}

/** Превью окна «Собрать Excel» (§8.3): для каждой операции — текст каждой колонки каталога; окно берёт нужные и в своём порядке. */
export function customPreview(ops: ExportOperation[], baseCurrency: string, timeZone: string): Record<ExportColumnId, string>[] {
  const ctx: ColumnContext = { baseCurrency, timeZone };
  return ops.map((o) => Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.id, VALUE[c.id](o, ctx).text])) as Record<ExportColumnId, string>);
}
