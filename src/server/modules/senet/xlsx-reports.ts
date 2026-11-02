import { readXlsx, type Cell, type SheetRow } from '../imports/xlsx-read';
import { SenetError, type ReportKind, type ReportRows } from './source';
import { localToUtc } from './time';

/**
 * Разбор отчётов админ-панели Senet (§3.3–3.4): колонки ищутся по заголовку первой строки, а не по позиции; нет
 * нужной колонки или ячейка не того вида — bad_format. Даты — числа Excel (или строки) в часах клуба.
 */
const COLUMNS = {
  sessions: {
    office: 'Офис',
    openedAt: 'Время начала сеанса',
    openedBy: 'Пользователь открывший сессию',
    closedAt: 'Время конца сеанса',
    closedBy: 'Пользователь закрывший сессию',
    endBalance: 'Сумма',
    cash: 'Наличный расчет',
    cashless: 'Безналичный расчет',
  },
  cashMoves: { office: 'Офис', at: 'Дата операции', cashier: 'Логин кассира', type: 'Тип операции', amount: 'Сумма операции', comment: 'Comment' },
  transactions: { office: 'Офис', at: 'Дата транзакции', code: 'Код транзакции', type: 'Тип операции', amount: 'Сумма операции', payment: 'Способ оплаты' },
  soldItems: { at: 'Дата операции', item: 'Код чека', qty: 'Продано', amount: 'Сумма', payment: 'Тип операции', status: 'Статус чека', comment: 'Comment' },
  checks: {
    office: 'Офис',
    cashier: 'Логин кассира',
    code: 'Код чека',
    used: 'Использован',
    amount: 'Сумма',
    workstation: 'Номер рабочей станции',
    guestLogin: 'Логин пользователя',
    phone: 'Номер телефона',
    at: 'Дата покупки',
  },
  refills: {
    office: 'Офис',
    at: 'Дата пополнения',
    guestLogin: 'Логин пользователя',
    accountType: 'Тип аккаунта',
    phone: 'Номер телефона',
    amount: 'Сумма',
    workstation: 'Номер рабочей станции',
  },
} as const;

type Parsed = Exclude<ReportKind, 'stock' | 'goodsMoves' | 'load'>;
const headerKey = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

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

  const spec = COLUMNS[kind as Parsed] as Record<string, string>;
  const [head, ...body] = sheet.rows;
  const at = new Map<string, number>();
  for (const [i, c] of head?.cells ?? []) at.set(headerKey(c.value), i);
  const index: Record<string, number> = {};
  for (const [field, header] of Object.entries(spec)) {
    const i = at.get(headerKey(header));
    if (i === undefined) throw bad();
    index[field] = i;
  }

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

  const officeName = 'office' in spec ? (body.map((r) => text(r, 'office')).find(Boolean) ?? null) : null;
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
        kind: /возврат/i.test(text(r, 'type')) ? 'refund' : 'sell',
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
        refund: /возврат/i.test(text(r, 'status')),
        comment: text(r, 'comment'),
      }));
      break;
    case 'checks':
      rows = timed('at').map((r) => ({
        at: time(r, 'at')!,
        code: text(r, 'code'),
        amount: money(r, 'amount'),
        used: /^да$/i.test(text(r, 'used')),
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
