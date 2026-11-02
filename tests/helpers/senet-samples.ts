import { buildXlsx, type XlsxCell } from '../../src/server/http/xlsx';

/**
 * Синтетические отчёты Senet (план 2026-11-02-senet-autopost, задача 4): те же заголовки и виды ячеек, что у настоящих
 * выгрузок админ-панели (даты — числа Excel в часах клуба, пустые ячейки отсутствуют), выдуманные значения.
 */
export const SENET_HEADERS = {
  sessions: ['Офис', 'Касса', 'Время начала сеанса', 'Пользователь открывший сессию', 'Время конца сеанса', 'Пользователь закрывший сессию', 'Сумма', 'Наличный расчет', 'Безналичный расчет'],
  cashMoves: ['Офис', 'Дата операции', 'Логин кассира', 'Тип операции', 'Сумма операции', 'Comment'],
  transactions: ['Офис', 'Временной период', 'Дата транзакции', 'Код транзакции', 'Тип операции', 'Сумма операции', 'Способ оплаты'],
  soldItems: ['Дата операции', 'Код чека', 'Продано', 'Сумма', 'Тип операции', 'Статус чека', 'Comment'],
  checks: ['Офис', 'Касса', 'Логин кассира', 'Код чека', 'Использован', 'Сумма', 'Номер рабочей станции', 'Логин пользователя', 'Номер телефона', 'Дата покупки'],
  refills: ['Офис', 'Дата пополнения', 'Логин пользователя', 'Тип аккаунта', 'Номер телефона', 'Сумма', 'Номер рабочей станции'],
} as const;

export type SampleKind = keyof typeof SENET_HEADERS;
export type SampleValue = string | number | XlsxCell | null;

/** Местное время клуба «YYYY-MM-DD HH:MM:SS[.mmm]» → ячейка даты Excel (дни от 30.12.1899 с долей суток). */
export function xlTime(local: string): XlsxCell {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(local);
  if (!m) throw new Error(`xlTime: ${local}`);
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, Number((m[7] ?? '0').padEnd(3, '0')));
  return { kind: 'datetime', value: ms / 86_400_000 + 25_569 };
}

const cell = (v: SampleValue): XlsxCell => {
  if (v === null) return null;
  if (typeof v === 'number') return { kind: 'number', value: String(v), decimals: Number.isInteger(v) ? 0 : 2 };
  if (typeof v === 'string') return { kind: 'text', value: v };
  return v;
};

/** Отчёт с заголовками headers (по умолчанию — настоящими для kind) и строками rows. */
export function senetSample(kind: SampleKind, rows: SampleValue[][], headers: readonly string[] = SENET_HEADERS[kind]): Buffer {
  return buildXlsx({ name: 'Sheet1', columns: headers.map((header) => ({ header, width: 16 })), rows: rows.map((r) => r.map(cell)) });
}

/** Строки двух смен «Клуба 1» 01.10.2026 (касса «Сотрудник А»): день и ночь. */
export const TWO_SHIFTS: SampleValue[][] = [
  ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 10:26:45'), 'Сотрудник А', xlTime('2026-10-01 22:13:46'), 'Сотрудник А', 10_000, 10_000, 0],
  ['Клуб 1', 'Клуб 1', xlTime('2026-10-01 22:14:59'), 'Сотрудник А', xlTime('2026-10-02 09:57:46'), 'Сотрудник А', 12_000, 12_000, 0],
];
