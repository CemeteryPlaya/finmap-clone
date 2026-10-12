import { getCurrency } from '../../../shared/currencies';
import { isValidDate, startOfDayUtc } from '../../../shared/dates';
import { columnTitle, headerField, isHeaderRow, nameKey, type FinmapField } from '../../../shared/finmap-format';
import { CATEGORY_NAME_MAX } from '../../../shared/schemas/categories';
import { COUNTERPARTY_NAME_MAX } from '../../../shared/schemas/counterparties';
import { PROJECT_NAME_MAX } from '../../../shared/schemas/projects';
import { TAG_NAME_MAX } from '../../../shared/schemas/tags';
import { cleanName } from '../../../shared/text';
import { fileError, IMPORT_MAX_ROWS, MESSAGES as M, tooManyRows, type RowIssue } from './errors';
import { CELL_TOO_LONG, type Cell, type SheetData, type SheetRow } from './xlsx-read';

/** Разбор строк файла в строки импорта (§4 спецификации импорта): чистые функции, без базы. */

export type ImportType = 'income' | 'expense' | 'transfer';

/** Счёт из файла: ключ сравнения (nameKey) и название, как в файле (после cleanName). */
export interface FileAccount {
  key: string;
  name: string;
}

export interface ImportRow {
  /** Номер строки Excel (у CSV — номер записи). */
  row: number;
  type: ImportType;
  /** Момент оплаты, ISO UTC: время ячейки — по часам APP_TIMEZONE. */
  paidAt: string;
  /** Календарная дата оплаты в APP_TIMEZONE. */
  date: string;
  /** «ГГГГ-ММ-ДД ЧЧ:ММ» по часам APP_TIMEZONE — часть ключа дубликата (§5.5). */
  minute: string;
  accrualDate: string | null;
  /** «Сумма в валюте счета» без знака, точной десятичной записью («8200.5»); в минимальные единицы — по валюте счёта (§4.2). */
  amount: string;
  /** «Сумма в валюте компании» в минимальных единицах базовой валюты; null — не заполнена. */
  baseAmount: number | null;
  /** Счёт операции: у дохода — «На счет», у расхода и перевода — «Со счета». */
  account: FileAccount;
  /** Счёт зачисления перевода. */
  toAccount: FileAccount | null;
  category: string | null;
  subcategory: string | null;
  counterparty: string | null;
  project: string | null;
  tags: string[];
  comment: string | null;
}

export interface ParseContext {
  timezone: string;
  /** Базовая валюта компании: в ней «Сумма в валюте компании». */
  baseCurrency: string;
  /** Сегодня в APP_TIMEZONE: строки позже — плановые (W1). */
  today: string;
}

export interface ParsedFile {
  headerRow: number;
  /** Непустые строки данных. */
  total: number;
  /** Строки без ошибок, кроме плановых. */
  rows: ImportRow[];
  /** Номера плановых строк (дата платежа в будущем): пропущены с W1. */
  future: number[];
  /** Ошибки R* и предупреждения W* разбора. */
  issues: RowIssue[];
}

// ——— числа ———

/** Точная десятичная запись без экспоненты и лишних нулей («8200.5», «0»). */
export interface ParsedNumber {
  negative: boolean;
  value: string;
}

/** Цифры digits × 10^-scale → запись; maxSignificant — округлить half-up до стольких значащих цифр. */
function normalize(negative: boolean, digits: string, scale: number, maxSignificant?: number): ParsedNumber {
  let d = digits.replace(/^0+/, '');
  if (d === '') return { negative: false, value: '0' };
  if (maxSignificant !== undefined && d.length > maxSignificant) {
    const drop = d.length - maxSignificant;
    let keep = BigInt(d.slice(0, maxSignificant));
    if (d.charCodeAt(maxSignificant) - 48 >= 5) keep += 1n;
    d = keep.toString();
    scale -= drop;
  }
  let value: string;
  if (scale <= 0) value = d + '0'.repeat(-scale);
  else {
    const padded = d.padStart(scale + 1, '0');
    const int = padded.slice(0, padded.length - scale);
    const frac = padded.slice(padded.length - scale).replace(/0+$/, '');
    value = frac ? `${int}.${frac}` : int;
  }
  return { negative: negative && value !== '0', value };
}

/**
 * Число из ячейки XLSX («10596», «8200.5», «1.2345E+5», «1317.0000000000002»). Excel хранит до 15 значащих цифр —
 * дальше шум двоичной дроби, он отбрасывается округлением до 15 цифр.
 */
export function parseCellNumber(text: string): ParsedNumber | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const exp = m[4] ? Number(m[4]) : 0;
  if (Math.abs(exp) > 400) return null;
  return normalize(m[1] === '-', (m[2] ?? '') + (m[3] ?? ''), (m[3] ?? '').length - exp, 15);
}

/**
 * Сумма текстом (§4.2): пробелы, U+00A0, U+202F и «₸» убираются; минус «-» или «\u2212», плюс допустим;
 * есть и точка, и запятая — последняя из них десятичная, другая — разряды; один знак — десятичный.
 */
export function parseTextAmount(text: string): ParsedNumber | null {
  let s = text.replace(/[\s\u00A0\u202F₸]/g, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('\u2212')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    const group = dec === '.' ? ',' : '.';
    if (s.indexOf(dec) !== s.lastIndexOf(dec)) return null;
    // разряды: целая часть — 1–3 цифры и группы ровно по 3 («1,2,3.4» и «1.5,0» — не число)
    const intPart = s.slice(0, s.indexOf(dec));
    if (!new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(intPart) || s.indexOf(dec) < s.lastIndexOf(group)) return null;
    s = s.split(group).join('').replace(dec, '.');
  } else if (comma >= 0) {
    if (s.indexOf(',') !== comma) return null;
    s = s.replace(',', '.');
  } else if (dot >= 0 && s.indexOf('.') !== dot) return null;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  return normalize(negative, m[1]! + (m[2] ?? ''), (m[2] ?? '').length);
}

/** Сумма ячейки: число — точно, без parseFloat; текст — по правилам §4.2. */
export function parseAmountCell(cell: Cell): ParsedNumber | null {
  return cell.kind === 'number' ? parseCellNumber(cell.value) : parseTextAmount(cell.value);
}

/** Запись → минимальные единицы с half-up; rounded — было больше знаков, чем у валюты (W10); null — не безопасное целое (R07). */
export function decimalToMinor(value: string, minorUnits: number): { minor: number; rounded: boolean } | null {
  const [int = '0', frac = ''] = value.split('.');
  let minor: bigint;
  let rounded = false;
  if (frac.length <= minorUnits) minor = BigInt(int + frac.padEnd(minorUnits, '0'));
  else {
    minor = BigInt(int + frac.slice(0, minorUnits));
    if (frac.charCodeAt(minorUnits) - 48 >= 5) minor += 1n;
    rounded = true;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { minor: Number(minor), rounded };
}

// ——— даты ———

/** Дата и секунды суток по часам компании. */
export interface WallTime {
  date: string;
  seconds: number;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** 01.03.1900 — первая дата без ошибки Excel 1900 года (29.02.1900); 31.12.9999 — последняя дата Excel. */
const EXCEL_MIN = 61;
const EXCEL_MAX = 2_958_465;
/** Даты вне 01.03.1900–31.12.9999 не принимаются (§4.3): у числа Excel и у текста. */
const MIN_DATE = '1900-03-01';

/**
 * Число Excel → дата и время (§4.3): целая часть — дни от 30.12.1899 (+1 462 при date1904), дробная — доля суток.
 * Время округляется до секунды; 86 400 секунд — следующие сутки. Дата вне 01.03.1900–31.12.9999 — null.
 */
export function fromExcelSerial(serial: number, date1904: boolean): WallTime | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds >= 86_400) {
    days += 1;
    seconds -= 86_400;
  }
  if (date1904) days += 1462;
  if (days < EXCEL_MIN || days > EXCEL_MAX) return null;
  return { date: new Date(EXCEL_EPOCH + days * DAY_MS).toISOString().slice(0, 10), seconds };
}

const DMY = /^(\d{1,2})[^\d\s](\d{1,2})[^\d\s](\d{4})(?:[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const SERIAL = /^\d+(?:\.\d+)?$/;

function wall(y: string, mo: string, d: string, h = '0', mi = '0', s = '0'): WallTime | null {
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const [hh, mm, ss] = [Number(h), Number(mi), Number(s)];
  if (!isValidDate(date) || date < MIN_DATE || hh > 23 || mm > 59 || ss > 59) return null;
  return { date, seconds: hh * 3600 + mm * 60 + ss };
}

/**
 * Дата ячейки (§4.3): число Excel; текст «д.м.гггг», «дд-мм-гггг», «дд/мм/гггг» (любой одиночный разделитель-не-цифра)
 * с временем «ч:мм» или «чч:мм:сс» через пробел или T; ISO «гггг-мм-дд[ чч:мм[:сс]]»; цифры с точкой — число Excel.
 * Без времени — 00:00:00. null — не разобралось, такой даты нет (31.02) или она вне 01.03.1900–31.12.9999.
 */
export function parseWallTime(cell: Cell, date1904: boolean): WallTime | null {
  if (cell.kind === 'number') return fromExcelSerial(Number(cell.value), date1904);
  const t = cell.value.trim();
  let m = DMY.exec(t);
  if (m) return wall(m[3]!, m[2]!, m[1]!, m[4], m[5], m[6]);
  m = ISO.exec(t);
  if (m) return wall(m[1]!, m[2]!, m[3]!, m[4], m[5], m[6]);
  if (SERIAL.test(t)) return fromExcelSerial(Number(t), date1904);
  return null;
}

/** Дата и время по часам timeZone → момент UTC (§4.3: начало суток плюс секунды; в Алматы без летнего времени это точно). */
export function wallToIso(w: WallTime, timeZone: string): string {
  return new Date(Date.parse(startOfDayUtc(w.date, timeZone)) + w.seconds * 1000).toISOString();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ——— заголовки и строки ———

/** Строка заголовков (§2.2): первая из строк 1–10 с «Дата платежа» и «Сумма в валюте счета». */
export function findHeader(rows: SheetRow[]): { headerRow: number; columns: Map<FinmapField, number>; issues: RowIssue[] } {
  const head = rows.find((r) => r.row <= 10 && isHeaderRow([...r.cells.values()].map((c) => c.value)));
  if (!head) {
    throw fileError('F6', 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»');
  }
  const columns = new Map<FinmapField, number>();
  const issues: RowIssue[] = [];
  for (const [col, cell] of [...head.cells].sort((a, b) => a[0] - b[0])) {
    const field = headerField(cell.value);
    if (field === null) {
      issues.push({ code: 'W7', message: M.W7(cleanName(cell.value)), row: head.row });
      continue;
    }
    if (columns.has(field)) throw fileError('F6', `Колонка «${columnTitle(field)}» встречается дважды`);
    columns.set(field, col);
  }
  if (!columns.has('fromAccount') && !columns.has('toAccount')) {
    throw fileError('F6', 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»');
  }
  return { headerRow: head.row, columns, issues };
}

/** Что колонки называют в R11. */
const R11_WHAT: Partial<Record<FinmapField, string>> = {
  accrualDate: 'дату начисления',
  periodFrom: 'начало периода начисления',
  periodTo: 'конец периода начисления',
};

export type RowResult = { kind: 'row'; row: ImportRow; issues: RowIssue[] } | { kind: 'future'; issues: RowIssue[] } | { kind: 'error'; issues: RowIssue[] };

/** Одна строка данных (§4.1–§4.8). Ошибки R* — строка не импортируется; дата в будущем — строка пропускается с W1. */
export function parseRow(sheetRow: SheetRow, columns: Map<FinmapField, number>, ctx: ParseContext, date1904 = false): RowResult {
  const n = sheetRow.row;
  const issues: RowIssue[] = [];
  const err = (code: RowIssue['code'], message: string) => issues.push({ code, message, row: n });
  const cell = (f: FinmapField): Cell | undefined => {
    const col = columns.get(f);
    return col === undefined ? undefined : sheetRow.cells.get(col);
  };
  const raw = (f: FinmapField) => cell(f)?.value.trim() ?? '';
  const name = (f: FinmapField) => cleanName(cell(f)?.value ?? '');

  // R18: ошибка Excel или слишком длинная ячейка в распознанной колонке
  const checkErrors = (skipPaidAt: boolean) => {
    for (const [field, col] of columns) {
      if (skipPaidAt && field === 'paidAt') continue;
      const c = sheetRow.cells.get(col);
      if (c?.kind === 'error') err('R18', c.value === CELL_TOO_LONG ? M.R18_LONG : M.R18_EXCEL(c.value, columnTitle(field)));
    }
  };

  // дата платежа: будущая строка — плановая операция Finmap, пропускается с одним W1 — даже с ошибкой Excel в других ячейках
  const paidCell = cell('paidAt');
  let paid: WallTime | null = null;
  if (paidCell?.kind === 'error') {
    checkErrors(false);
    return { kind: 'error', issues };
  }
  if (!paidCell || raw('paidAt') === '') err('R01', M.R01);
  else {
    paid = parseWallTime(paidCell, date1904);
    if (!paid) err('R02', M.R02(raw('paidAt')));
    else if (Number(paid.date.slice(0, 4)) < 1990) err('R03', M.R03);
    else if (paid.date > ctx.today) return { kind: 'future', issues: [{ code: 'W1', message: M.W1, row: n }] };
  }
  const dateIssues = issues.length;
  checkErrors(true);
  if (issues.length > dateIssues) return { kind: 'error', issues };

  // тип по счетам (§4.1)
  const from = name('fromAccount');
  const to = name('toAccount');
  const type: ImportType | null = from && to ? 'transfer' : from ? 'expense' : to ? 'income' : null;
  if (!type) err('R08', M.R08);
  else if (type === 'transfer' && nameKey(from) === nameKey(to)) err('R09', M.R09);

  // сумма (§4.2): точная запись без знака; в минимальные единицы — по валюте счёта, в предпросмотре
  let amount: string | null = null;
  const amountCell = cell('amount');
  if (!amountCell || raw('amount') === '') err('R04', M.R04);
  else {
    const p = parseAmountCell(amountCell);
    if (!p) err('R05', M.R05(raw('amount')));
    else if (p.value === '0') err('R06', M.R06);
    else if (p.negative && type === 'income') err('R10', M.R10);
    else amount = p.value;
  }

  // «Сумма в валюте компании»: в минимальных единицах базовой валюты; ноль — как пусто
  let baseAmount: number | null = null;
  const baseCell = cell('baseAmount');
  if (baseCell && raw('baseAmount') !== '') {
    const p = parseAmountCell(baseCell);
    const units = getCurrency(ctx.baseCurrency).minorUnits;
    if (!p) err('R05', M.R05(raw('baseAmount')));
    else if (p.negative && type === 'income') err('R10', M.R10);
    else if (p.value !== '0') {
      const minor = decimalToMinor(p.value, units);
      if (!minor) err('R07', M.R07);
      else {
        // округлилось до нуля («0,004») — как пусто: курс считается по правилам, а не нулевой
        baseAmount = minor.minor === 0 ? null : minor.minor;
        if (minor.rounded) issues.push({ code: 'W10', message: M.W10(units), row: n });
      }
    }
  }

  // дата начисления (§4.3): B важнее C; D только проверяется; у перевода не переносится
  let accrualDate: string | null = null;
  const dates: Partial<Record<FinmapField, string>> = {};
  for (const f of ['accrualDate', 'periodFrom', 'periodTo'] as const) {
    const c = cell(f);
    if (!c || raw(f) === '') continue;
    if (type === 'transfer') continue;
    const w = parseWallTime(c, date1904);
    if (!w) err('R11', M.R11(R11_WHAT[f]!, raw(f)));
    else dates[f] = w.date;
  }
  if (type === 'transfer' && (raw('accrualDate') || raw('periodFrom'))) issues.push({ code: 'W3', message: M.W3, row: n });
  if (dates.periodFrom && dates.periodTo && dates.periodTo < dates.periodFrom) err('R11', M.R11_PERIOD);
  if (dates.accrualDate && dates.periodFrom) issues.push({ code: 'W6', message: M.W6, row: n });
  accrualDate = dates.accrualDate ?? dates.periodFrom ?? null;

  // категория, контрагент (§4.5, §4.6): у перевода не переносятся
  let category: string | null = name('category') || null;
  let subcategory: string | null = name('subcategory') || null;
  let counterparty: string | null = name('subcounterparty') || name('counterparty') || null;
  if (type === 'transfer') {
    if (category || subcategory || counterparty) issues.push({ code: 'W2', message: M.W2, row: n });
    category = subcategory = counterparty = null;
  } else {
    if (subcategory && !category) err('R12', M.R12);
    if (category && category.length > CATEGORY_NAME_MAX) err('R13', M.R13('Категория', CATEGORY_NAME_MAX));
    if (subcategory && subcategory.length > CATEGORY_NAME_MAX) err('R13', M.R13('Подкатегория', CATEGORY_NAME_MAX));
    if (name('subcounterparty')) issues.push({ code: 'W4', message: M.W4, row: n });
    if (counterparty && counterparty.length > COUNTERPARTY_NAME_MAX) err('R13', M.R13('Контрагент', COUNTERPARTY_NAME_MAX));
  }

  // проект (§4.7): подпроект не переносится
  const project = name('project') || null;
  if (project && project.length > PROJECT_NAME_MAX) err('R13', M.R13('Проект', PROJECT_NAME_MAX));
  if (name('subproject')) issues.push({ code: 'W5', message: M.W5, row: n });

  // теги (§4.8): через запятую, без пустых и повторов
  const tags: string[] = [];
  const tagKeys = new Set<string>();
  for (const part of (cell('tags')?.value ?? '').split(',')) {
    const t = cleanName(part);
    if (!t || tagKeys.has(nameKey(t))) continue;
    tagKeys.add(nameKey(t));
    tags.push(t);
  }
  if (tags.length > 20) err('R14', M.R14);
  if (tags.some((t) => t.length > TAG_NAME_MAX)) err('R13', M.R13('Тег', TAG_NAME_MAX));

  // комментарий
  const comment = raw('comment') || null;
  if (comment && comment.length > 2000) err('R15', M.R15);

  if (issues.some((i) => i.code.startsWith('R')) || !type || !paid || amount === null) return { kind: 'error', issues };
  const account = type === 'income' ? { key: nameKey(to), name: to } : { key: nameKey(from), name: from };
  return {
    kind: 'row',
    issues,
    row: {
      row: n,
      type,
      paidAt: wallToIso(paid, ctx.timezone),
      date: paid.date,
      minute: `${paid.date} ${pad2(Math.floor(paid.seconds / 3600))}:${pad2(Math.floor((paid.seconds % 3600) / 60))}`,
      accrualDate,
      amount,
      baseAmount,
      account,
      toAccount: type === 'transfer' ? { key: nameKey(to), name: to } : null,
      category,
      subcategory,
      counterparty,
      project,
      tags,
      comment,
    },
  };
}

/**
 * Лист → строки импорта (§2.3, §4): строка заголовков, пустые строки пропускаются молча и не считаются;
 * больше 50 000 строк данных — F5, ни одной — F7.
 */
export function parseSheet(sheet: SheetData, ctx: ParseContext): ParsedFile {
  const { headerRow, columns, issues } = findHeader(sheet.rows);
  const cols = [...columns.values()];
  const data = sheet.rows.filter((r) => r.row > headerRow && cols.some((c) => (r.cells.get(c)?.value.trim() ?? '') !== ''));
  if (data.length > IMPORT_MAX_ROWS) throw tooManyRows();
  if (data.length === 0) throw fileError('F7', 'В файле нет операций');
  const rows: ImportRow[] = [];
  const future: number[] = [];
  for (const r of data) {
    const res = parseRow(r, columns, ctx, sheet.date1904);
    issues.push(...res.issues);
    if (res.kind === 'row') rows.push(res.row);
    else if (res.kind === 'future') future.push(r.row);
  }
  return { headerRow, total: data.length, rows, future, issues };
}
