import { getCurrency } from '../../../shared/currencies';
import { zoneOffsetMs } from '../../../shared/dates';
import type { XlsxCell, XlsxSheet } from '../../http/xlsx';

/** Строка выгрузки: операция с названиями справочников (§7, колонки журнала). */
export interface ExportOperation {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  paidAt: string;
  accrualDate: string | null;
  amount: number;
  baseAmount: number;
  currency: string;
  accountName: string;
  /** Остаток счёта после операции (§4.7); null — не посчитан. */
  balanceAfter: number | null;
  toAccountName: string | null;
  toAmount: number | null;
  toCurrency: string | null;
  toBalanceAfter: number | null;
  counterpartyName: string | null;
  /** Статьи и проекты строк по порядку, без повторов. */
  categories: string[];
  projects: string[];
  tags: string[];
  comment: string | null;
}

const TYPE_LABEL = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' } as const;
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

const text = (value: string | null | undefined): XlsxCell => (value ? { kind: 'text', value } : null);
const money = (minor: number | null, currency: string | null): XlsxCell => {
  if (minor === null || currency === null) return null;
  const units = getCurrency(currency).minorUnits;
  return { kind: 'number', value: minorToDecimal(minor, units), decimals: units };
};

/**
 * Лист «Операции»: одна строка на операцию, как в журнале. Сумма со знаком (расход — минус, перевод — без знака),
 * в валюте счёта и в базовой валюте; у перевода — счёт, сумма и остаток зачисления. Разбитая операция —
 * статьи и проекты строк через «; ».
 */
export function journalSheet(ops: ExportOperation[], baseCurrency: string, timeZone: string): XlsxSheet {
  return {
    name: 'Операции',
    columns: [
      { header: 'Дата', width: 17 },
      { header: 'Тип', width: 10 },
      { header: 'Сумма', width: 15 },
      { header: 'Валюта', width: 8 },
      { header: `Сумма, ${baseCurrency}`, width: 15 },
      { header: 'Счёт', width: 22 },
      { header: 'Остаток', width: 15 },
      { header: 'Счёт зачисления', width: 22 },
      { header: 'Сумма зачисления', width: 15 },
      { header: 'Остаток зачисления', width: 15 },
      { header: 'Контрагент', width: 24 },
      { header: 'Статья', width: 28 },
      { header: 'Проект', width: 20 },
      { header: 'Теги', width: 16 },
      { header: 'Комментарий', width: 40 },
      { header: 'Дата сделки', width: 12 },
    ],
    rows: ops.map((o) => {
      const sign = o.type === 'expense' ? -1 : 1;
      return [
        { kind: 'datetime', value: excelDateTime(o.paidAt, timeZone) },
        text(TYPE_LABEL[o.type]),
        money(sign * o.amount, o.currency),
        text(o.currency),
        money(sign * o.baseAmount, baseCurrency),
        text(o.accountName),
        money(o.balanceAfter, o.currency),
        text(o.toAccountName),
        money(o.toAmount, o.toCurrency),
        money(o.toBalanceAfter, o.toCurrency),
        text(o.counterpartyName),
        text(o.categories.join('; ')),
        text(o.projects.join('; ')),
        text(o.tags.join('; ')),
        text(o.comment),
        o.accrualDate ? { kind: 'date', value: excelDate(o.accrualDate) } : null,
      ];
    }),
  };
}
