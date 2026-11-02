import { readXlsx, type Cell, type SheetRow } from '../imports/xlsx-read';
import { SenetError, type ReportKind, type ReportRows } from './source';
import { localToUtc } from './time';

/**
 * Разбор отчётов админ-панели Senet (§3.3–3.4). Колонки ищутся по заголовку первой строки — русскому (выгрузка из
 * интерфейса) или английскому (API без Accept-Language, пробный забор 2026-11-03). Заголовки незнакомы, но колонок
 * столько же — разбор по позиции, как у эталона senet_to_finmap.py; иначе — bad_format. Даты — числа Excel в часах клуба.
 * Колонки перечислены в порядке файла; `null` — колонка есть в файле, но разбору не нужна.
 */
type Col = readonly [field: string | null, ...headers: string[]];
const COLUMNS: Record<Parsed, readonly Col[]> = {
  sessions: [
    ['office', 'Офис', 'Office name'],
    [null, 'Касса', 'Cashdesk'],
    ['openedAt', 'Время начала сеанса', 'Session start date'],
    ['openedBy', 'Пользователь открывший сессию', 'User who opened session'],
    ['closedAt', 'Время конца сеанса', 'Session end date'],
    ['closedBy', 'Пользователь закрывший сессию', 'User who closed session'],
    ['endBalance', 'Сумма', 'Total amount'],
    ['cash', 'Наличный расчет', 'Cash'],
    ['cashless', 'Безналичный расчет', 'Cashless'],
  ],
  cashMoves: [
    ['office', 'Офис', 'Office name'],
    ['at', 'Дата операции', 'Operation date'],
    ['cashier', 'Логин кассира', 'Cashier login'],
    ['type', 'Тип операции', 'Operation type'],
    ['amount', 'Сумма операции', 'Operation amount'],
    ['comment', 'Comment'],
  ],
  transactions: [
    ['office', 'Офис', 'Office name'],
    [null, 'Временной период', 'Time period'],
    ['at', 'Дата транзакции', 'Transaction date'],
    ['code', 'Код транзакции', 'Transaction code'],
    ['type', 'Тип операции', 'Operation type'],
    ['amount', 'Сумма операции', 'Operation amount'],
    ['payment', 'Способ оплаты', 'Payment method'],
  ],
  soldItems: [
    ['at', 'Дата операции', 'Operation date'],
    ['item', 'Код чека', 'Check code'],
    ['qty', 'Продано', 'Sold'],
    ['amount', 'Сумма', 'Amount'],
    ['payment', 'Тип операции', 'Operation type'],
    ['status', 'Статус чека', 'Check status'],
    ['comment', 'Comment'],
  ],
  checks: [
    ['office', 'Офис', 'Office name'],
    [null, 'Касса', 'Cashdesk'],
    ['cashier', 'Логин кассира', 'Cashier login'],
    ['code', 'Код чека', 'Check code'],
    ['used', 'Использован', 'Used'],
    ['amount', 'Сумма', 'Amount'],
    ['workstation', 'Номер рабочей станции', 'Workstation num'],
    ['guestLogin', 'Логин пользователя', 'User login'],
    ['phone', 'Номер телефона', 'Phone number'],
    ['at', 'Дата покупки', 'Purchase date'],
  ],
  refills: [
    ['office', 'Офис', 'Office name'],
    ['at', 'Дата пополнения', 'Refill date'],
    ['guestLogin', 'Логин пользователя', 'User login'],
    ['accountType', 'Тип аккаунта', 'Account type'],
    ['phone', 'Номер телефона', 'Phone number'],
    ['amount', 'Сумма', 'Amount'],
    ['workstation', 'Номер рабочей станции', 'Workstation num'],
  ],
};

type Parsed = Exclude<ReportKind, 'stock' | 'goodsMoves' | 'load'>;
const headerKey = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');
/** Возврат, «да», статус возврата — по-русски и по-английски. */
const REFUND = /возврат|refund|return/i;
const YES = /^(да|yes|true|1)$/i;

/** Номера колонок полей: по заголовкам; не нашлись — по позиции при том же числе колонок; иначе null. */
function locate(cols: readonly Col[], head: SheetRow | undefined): Record<string, number> | null {
  const at = new Map<string, number>();
  for (const [i, c] of head?.cells ?? []) at.set(headerKey(c.value), i);
  const byHeader: Record<string, number> = {};
  let found = true;
  for (const [field, ...headers] of cols) {
    if (!field) continue;
    const i = headers.map((h) => at.get(headerKey(h))).find((x) => x !== undefined);
    if (i === undefined) found = false;
    else byHeader[field] = i;
  }
  if (found) return byHeader;
  if ((head?.cells.size ?? 0) !== cols.length) return null;
  const byPosition: Record<string, number> = {};
  cols.forEach(([field], i) => {
    if (field) byPosition[field] = i;
  });
  return byPosition;
}

export function parseReport<K extends ReportKind>(kind: K, data: Buffer, timezone: string): { rows: ReportRows[K]; officeName: string | null } {
  const bad = () => new SenetError('bad_format', { report: kind });
  if (data.subarray(0, 2).toString('latin1') !== 'PK') throw bad();
  let sheet;
  try {
    sheet = readXlsx(data);
  } catch {
    throw bad();
  }
  if (kind === 'stock' || kind === 'goodsMoves' || kind === 'load') return { rows: null as ReportRows[K], officeName: null };

  const [head, ...body] = sheet.rows;
  const index = locate(COLUMNS[kind as Parsed], head);
  if (!index) throw bad();

  const get = (r: SheetRow, field: string): Cell | undefined => r.cells.get(index[field]!);
  const text = (r: SheetRow, field: string) => get(r, field)?.value.trim() ?? '';
  const num = (r: SheetRow, field: string): number | null => {
    const c = get(r, field);
    if (!c || c.value.trim() === '') return null;
    const n = Number(c.value.replace(/\s/g, '').replace(',', '.'));
    if (c.kind === 'error' || !Number.isFinite(n)) throw bad();
    return n;
  };
  const money = (r: SheetRow, field: string) => Math.round((num(r, field) ?? 0) * 100);
  const time = (r: SheetRow, field: string): string | null => {
    const c = get(r, field);
    if (!c || c.value.trim() === '') return null;
    const t = localToUtc(c.kind === 'number' ? Number(c.value) : c.value, timezone);
    if (t === null) throw bad();
    return t;
  };
  const phone = (r: SheetRow) => {
    const c = get(r, 'phone');
    if (!c || c.value.trim() === '') return null;
    // номер числом: «77012345612» или «7.7012345612E10»
    return c.kind === 'number' ? String(Math.round(Number(c.value))) : c.value.trim();
  };

  const officeName = 'office' in index ? (body.map((r) => text(r, 'office')).find(Boolean) ?? null) : null;
  // строки без основного времени (итоги, пустые) пропускаются
  const timed = (field: string) => body.filter((r) => time(r, field) !== null);
  let rows: unknown;
  switch (kind as Parsed) {
    case 'sessions':
      rows = timed('openedAt').map((r) => ({
        openedAt: time(r, 'openedAt')!,
        closedAt: time(r, 'closedAt'),
        openedBy: text(r, 'openedBy'),
        closedBy: text(r, 'closedBy') || null,
        endBalance: money(r, 'endBalance'),
        cash: money(r, 'cash'),
        cashless: money(r, 'cashless'),
      }));
      break;
    case 'cashMoves':
      rows = timed('at').map((r) => {
        const amount = money(r, 'amount');
        const out = amount < 0 || /^вынес/i.test(text(r, 'type'));
        return { at: time(r, 'at')!, cashier: text(r, 'cashier'), kind: out ? 'out' : 'in', amount: Math.abs(amount), comment: text(r, 'comment') };
      });
      break;
    case 'transactions':
      rows = timed('at').map((r) => ({
        at: time(r, 'at')!,
        code: text(r, 'code'),
        kind: REFUND.test(text(r, 'type')) ? 'refund' : 'sell',
        amount: Math.abs(money(r, 'amount')),
        payment: text(r, 'payment'),
      }));
      break;
    case 'soldItems':
      rows = timed('at').map((r) => ({
        at: time(r, 'at')!,
        item: text(r, 'item'),
        qty: num(r, 'qty'),
        amount: Math.abs(money(r, 'amount')),
        payment: text(r, 'payment'),
        refund: REFUND.test(text(r, 'status')),
        comment: text(r, 'comment'),
      }));
      break;
    case 'checks':
      rows = timed('at').map((r) => ({
        at: time(r, 'at')!,
        code: text(r, 'code'),
        amount: money(r, 'amount'),
        used: YES.test(text(r, 'used')),
        workstation: num(r, 'workstation'),
        guestLogin: text(r, 'guestLogin'),
        phone: phone(r),
        cashier: text(r, 'cashier'),
      }));
      break;
    case 'refills':
      rows = timed('at').map((r) => ({
        at: time(r, 'at')!,
        guestLogin: text(r, 'guestLogin'),
        accountType: text(r, 'accountType'),
        amount: money(r, 'amount'),
        workstation: num(r, 'workstation'),
        phone: phone(r),
      }));
      break;
  }
  return { rows: rows as ReportRows[K], officeName };
}
