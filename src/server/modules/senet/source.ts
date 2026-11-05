/**
 * Источник данных Senet (спецификация 2026-11-02-senet-autopost, §3.1): остальной модуль знает только этот интерфейс.
 * Сейчас — отчёты админ-панели (AdminTokenSource), когда ENESTECH выдаст Application Key — AppKeySource.
 * Строки — время ISO UTC, деньги в тиынах.
 */
export type ReportKind = 'sessions' | 'cashMoves' | 'transactions' | 'soldItems' | 'checks' | 'refills' | 'stock' | 'goodsMoves' | 'load' | 'tickets';

/** Значение параметра `type` отчёта админ-панели (§3.4). */
export const REPORT_TYPES: Record<ReportKind, string> = {
  sessions: 'cashdesk_session',
  cashMoves: 'income_outcome',
  transactions: 'cashdesk_transactions',
  soldItems: 'sold_check_items',
  checks: 'checks',
  refills: 'refill',
  stock: 'shop_quantity',
  goodsMoves: 'movements_of_goods',
  load: 'office_load_by_zones',
  // «Использование абонементов»: покупка пакета с баланса (спецификация «Аналитика клуба», §16 R6)
  tickets: 'tickets',
};

export interface OfficeRef {
  officeId: number;
  cashDeskId: number;
}

export interface SessionRow {
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
  /** «Сумма» — остаток в кассе на закрытии. */
  endBalance: number;
  cash: number;
  cashless: number;
}

export interface CashMoveRow {
  at: string;
  cashier: string;
  kind: 'in' | 'out';
  /** Всегда > 0. */
  amount: number;
  comment: string;
}

export interface TransactionRow {
  at: string;
  code: string;
  kind: 'sell' | 'refund';
  amount: number;
  payment: string;
}

export interface SoldItemRow {
  at: string;
  item: string;
  /** Штук; у чеков времени — null. */
  qty: number | null;
  amount: number;
  payment: string;
  refund: boolean;
  comment: string;
}

export interface CheckRow {
  at: string;
  code: string;
  amount: number;
  used: boolean;
  workstation: number | null;
  guestLogin: string;
  phone: string | null;
  cashier: string;
}

export interface RefillRow {
  at: string;
  guestLogin: string;
  accountType: string;
  amount: number;
  workstation: number | null;
  phone: string | null;
}

/** shop_quantity — товары бара за окно. Количество × 1000, деньги — тиыны. */
export interface StockRow {
  item: string;
  soldQty: number;
  restockQty: number;
  writeOffQty: number;
  restockPrice: number | null;
  restockSum: number;
  sellingPrice: number | null;
  soldSum: number;
  actualQty: number | null;
}

/** movements_of_goods — движение товаров за окно по документам источника. */
export interface GoodsMoveRow {
  sourceOrder: string;
  cashier: string;
  category: string;
  item: string;
  restockQty: number;
  writeOffQty: number;
  restockPrice: number | null;
  restockSum: number;
  totalQty: number | null;
  soldQty: number;
  sellingPrice: number | null;
  soldSum: number;
  soldCost: number | null;
  profit: number | null;
  comment: string;
}

/** office_load_by_zones — сеанс гостя на ПК зоны. */
export interface LoadRow {
  startAt: string;
  endAt: string | null;
  zone: string;
  workstation: number | null;
  guestLogin: string;
  phone: string | null;
  age: number | null;
  tariff: string;
  debited: number;
  refilled: number;
  durationSec: number | null;
}

/** tickets — покупка абонемента (пакета часов) с баланса гостя; minutes — «Времени проведено». */
export interface TicketRow {
  at: string;
  guestLogin: string;
  phone: string | null;
  ticket: string;
  price: number;
  minutes: number | null;
}

export interface ReportRows {
  sessions: SessionRow[];
  cashMoves: CashMoveRow[];
  transactions: TransactionRow[];
  soldItems: SoldItemRow[];
  checks: CheckRow[];
  refills: RefillRow[];
  stock: StockRow[];
  goodsMoves: GoodsMoveRow[];
  load: LoadRow[];
  tickets: TicketRow[];
}

export interface RawFile {
  data: Buffer;
  contentType: string;
  sha256: string;
}

export interface SenetSource {
  /** Проверка доступа: смены кассы за последние сутки. */
  check(office: OfficeRef, now: Date): Promise<{ officeName: string | null; shifts: number; lastClosedAt: string | null }>;
  /** Отчёт за окно [from, to) в UTC: разобранные строки и сырой файл. */
  report<K extends ReportKind>(kind: K, office: OfficeRef, from: Date, to: Date): Promise<{ rows: ReportRows[K]; raw: RawFile }>;
}

export type SenetErrorCode = 'auth_rejected' | 'auth_needs_code' | 'unreachable' | 'server_error' | 'bad_format' | 'too_large';

/** Тексты §11: тело ответов 401/403 не сохраняется и не показывается — только код. */
function messageOf(code: SenetErrorCode, o: { status?: number; report?: ReportKind; host?: string }): string {
  switch (code) {
    case 'auth_rejected':
      return 'Senet не принял данные входа. Обновите их в настройках подключения';
    case 'auth_needs_code':
      return 'Senet просит подтвердить вход — подключитесь токеном';
    case 'unreachable':
      return `Сервер Senet не отвечает${o.host ? ` (${o.host})` : ''}. Попробуем снова через час`;
    case 'server_error':
      return `Senet вернул ошибку ${o.status ?? ''}. Попробуем снова через час`.replace('  ', ' ');
    case 'bad_format':
      return `Отчёт «${o.report ? REPORT_TYPES[o.report] : 'Senet'}» пришёл в незнакомом формате — сохранён для разбора`;
    case 'too_large':
      return 'Ответ Senet больше 20 МБ — уменьшите период';
  }
}

export class SenetError extends Error {
  readonly code: SenetErrorCode;
  readonly status?: number;
  report?: ReportKind;
  /** Сырой ответ, который не удалось разобрать: забор сохраняет его для разбора. */
  raw?: RawFile;
  constructor(code: SenetErrorCode, o: { status?: number; report?: ReportKind; host?: string; raw?: RawFile } = {}) {
    super(messageOf(code, o));
    this.code = code;
    this.status = o.status;
    this.report = o.report;
    this.raw = o.raw;
  }
}
