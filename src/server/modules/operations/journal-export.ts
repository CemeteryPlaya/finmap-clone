import { getCurrency } from '../../../shared/currencies';
import { zoneOffsetMs } from '../../../shared/dates';
import { FINMAP_COLUMNS, type FinmapField } from '../../../shared/finmap-format';
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
