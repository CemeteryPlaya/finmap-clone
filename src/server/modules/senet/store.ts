import { and, asc, eq, gt, gte, inArray, lt, lte, sql, type AnyColumn } from 'drizzle-orm';
import { mergeSpans, type Span } from '../../../shared/club-analytics/coverage';
import type { Executor } from '../../db/client';
import { first } from '../../db/raw';
import { senetCashMoves, senetChecks, senetDataSpans, senetGoodsMoves, senetLoad, senetRefills, senetShifts, senetSoldItems, senetStock, senetTickets, senetTransactions } from '../../db/schema';
import { normalize } from './posting/normalize';
import { shiftTotals, shiftWindows } from './posting/windows';
import type { CashMoveRow, CheckRow, GoodsMoveRow, LoadRow, RefillRow, ReportKind, SessionRow, SoldItemRow, StockRow, TicketRow, TransactionRow } from './source';

/** Разобранные отчёты одного отрезка забора клуба. */
export interface OfficeBatch {
  officeId: number;
  sessions: SessionRow[];
  moves: CashMoveRow[];
  /** Окно запроса выемок: выемка из этого окна, которой нет в ответе, — «исчезла из Senet». */
  movesFrom: string;
  movesTo: string;
  /** null — отчёт транзакций не пришёл: строки и контроль выручки не трогаются. */
  transactions: TransactionRow[] | null;
  txFrom: string;
  txTo: string;
}

const CHUNK = 500;

/** Ключ выемки (П6): `{at}|{amount}|{нормализованный комментарий}|{n}`, n — номер повтора одинаковых строк смены. */
function withRefs<M extends CashMoveRow>(moves: readonly M[]): (M & { senetRef: string })[] {
  const seen = new Map<string, number>();
  return moves.map((m) => {
    const base = `${m.at}|${m.amount}|${normalize(m.comment)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...m, senetRef: `${base}|${n}` };
  });
}

/**
 * Запись отрезка клуба (§9.1, П5) внутри транзакции вызывающего: смены — по ключу (клуб, начало), выемки — по окнам смен
 * и ключу П6, транзакции — заменой строк окна; затем пересчёт сумм затронутых смен.
 */
export async function writeOfficeBatch(tx: Executor, b: OfficeBatch, at: string): Promise<{ shifts: number; moves: number }> {
  for (const s of b.sessions) {
    const values = {
      closedAt: s.closedAt,
      openedBy: s.openedBy,
      closedBy: s.closedBy,
      endBalance: s.endBalance,
      cashless: s.cashless,
      updatedAt: at,
    };
    await tx
      .insert(senetShifts)
      .values({ officeId: b.officeId, openedAt: s.openedAt, ...values })
      .onConflictDoUpdate({ target: [senetShifts.officeId, senetShifts.openedAt], set: values });
  }

  if (b.transactions) {
    await tx.delete(senetTransactions).where(and(eq(senetTransactions.officeId, b.officeId), gte(senetTransactions.at, b.txFrom), lt(senetTransactions.at, b.txTo)));
    for (let i = 0; i < b.transactions.length; i += CHUNK) {
      await tx.insert(senetTransactions).values(b.transactions.slice(i, i + CHUNK).map((t) => ({ officeId: b.officeId, ...t })));
    }
  }

  const shifts = await tx.select().from(senetShifts).where(eq(senetShifts.officeId, b.officeId)).orderBy(asc(senetShifts.openedAt));
  const touched = new Set<number>(shifts.filter((s) => b.sessions.some((r) => r.openedAt === s.openedAt)).map((s) => s.id));
  const fetched = new Set<string>();
  let moves = 0;
  for (const { shift, moves: own } of shiftWindows(shifts, b.moves)) {
    if (own.length === 0) continue;
    touched.add(shift.id);
    for (const m of withRefs(own)) {
      fetched.add(`${shift.id}|${m.senetRef}`);
      await tx
        .insert(senetCashMoves)
        .values({ shiftId: shift.id, senetRef: m.senetRef, kind: m.kind, amount: m.amount, at: m.at, cashier: m.cashier, comment: m.comment })
        .onConflictDoUpdate({ target: [senetCashMoves.shiftId, senetCashMoves.senetRef], set: { cashier: m.cashier, comment: m.comment, missingInSenet: false } });
      moves++;
    }
  }

  // выемка окна запроса, которой больше нет в ответе Senet, отмечается; операция по ней (если есть) остаётся
  const shiftIds = shifts.map((s) => s.id);
  if (shiftIds.length) {
    const inWindow = await tx
      .select({ id: senetCashMoves.id, shiftId: senetCashMoves.shiftId, senetRef: senetCashMoves.senetRef, missing: senetCashMoves.missingInSenet })
      .from(senetCashMoves)
      .where(and(inArray(senetCashMoves.shiftId, shiftIds), gte(senetCashMoves.at, b.movesFrom), lt(senetCashMoves.at, b.movesTo)));
    const gone = inWindow.filter((m) => !m.missing && !fetched.has(`${m.shiftId}|${m.senetRef}`));
    if (gone.length) {
      await tx
        .update(senetCashMoves)
        .set({ missingInSenet: true })
        .where(inArray(senetCashMoves.id, gone.map((m) => m.id)));
      for (const m of gone) touched.add(m.shiftId);
    }
  }

  for (const shift of shifts.filter((s) => touched.has(s.id))) {
    const own = await tx
      .select({ kind: senetCashMoves.kind, amount: senetCashMoves.amount })
      .from(senetCashMoves)
      .where(and(eq(senetCashMoves.shiftId, shift.id), eq(senetCashMoves.missingInSenet, false)));
    const totals = shiftTotals(shift.endBalance, own);
    let revenueTx = shift.revenueTx;
    if (b.transactions && shift.closedAt) {
      const sum = await first(
        tx
          .select({
            v: sql<number>`COALESCE(SUM(CASE WHEN ${senetTransactions.kind} = 'refund' THEN -${senetTransactions.amount} ELSE ${senetTransactions.amount} END), 0)`,
            n: sql<number>`COUNT(*)`,
          })
          .from(senetTransactions)
          .where(and(eq(senetTransactions.officeId, b.officeId), gte(senetTransactions.at, shift.openedAt), sql`${senetTransactions.at} <= ${shift.closedAt}`)),
      );
      // нет ни одной транзакции в окне смены — контроль неизвестен, а не «ноль выручки»
      revenueTx = Number(sum?.n ?? 0) > 0 ? Number(sum!.v) : null;
    }
    await tx
      .update(senetShifts)
      .set({ ...totals, revenueTx, updatedAt: at })
      .where(eq(senetShifts.id, shift.id));
  }
  return { shifts: b.sessions.length, moves };
}

/** Сутки клуба для записи аналитики: окно, телефон — хеш и маска. */
interface Day {
  officeId: number;
  from: string;
  to: string;
  phone: (p: string | null) => { hash: string | null; mask: string | null };
}

/** Строки пачками по CHUNK. */
async function insertChunks<R>(rows: R[], write: (part: R[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

const inDay = <T extends { officeId: AnyColumn; at: AnyColumn }>(t: T, d: Day) => and(eq(t.officeId, d.officeId), gte(t.at, d.from), lt(t.at, d.to));
/** Отчёты за окно без дат строк — по началу окна. */
const inWindow = <T extends { officeId: AnyColumn; fromAt: AnyColumn }>(t: T, d: Day) => and(eq(t.officeId, d.officeId), eq(t.fromAt, d.from));
/** Строка с телефоном гостя — хеш и маска вместо номера (§9.3). */
const withPhone = <R extends { phone: string | null }>(d: Day, { phone, ...r }: R) => {
  const p = d.phone(phone);
  return { officeId: d.officeId, ...r, phoneHash: p.hash, phoneMask: p.mask };
};

/** Продажа — к своей смене. */
async function writeSold(tx: Executor, d: Day, rows: SoldItemRow[]): Promise<void> {
  const shifts = await tx
    .select({ id: senetShifts.id, openedAt: senetShifts.openedAt, closedAt: senetShifts.closedAt })
    .from(senetShifts)
    .where(eq(senetShifts.officeId, d.officeId))
    .orderBy(asc(senetShifts.openedAt));
  const shiftOf = (at: string) => shifts.find((s) => s.openedAt <= at && (s.closedAt === null || at <= s.closedAt))?.id ?? null;
  await tx.delete(senetSoldItems).where(inDay(senetSoldItems, d));
  await insertChunks(rows, (part) =>
    tx.insert(senetSoldItems).values(part.map((r) => ({ officeId: d.officeId, shiftId: shiftOf(r.at), at: r.at, item: r.item, qty: r.qty === null ? null : Math.round(r.qty * 1000), amount: r.amount, payment: r.payment, refund: r.refund, comment: r.comment }))),
  );
}

async function writeChecks(tx: Executor, d: Day, rows: CheckRow[]): Promise<void> {
  await tx.delete(senetChecks).where(inDay(senetChecks, d));
  await insertChunks(rows, (part) => tx.insert(senetChecks).values(part.map((r) => withPhone(d, r))));
}

async function writeRefills(tx: Executor, d: Day, rows: RefillRow[]): Promise<void> {
  await tx.delete(senetRefills).where(inDay(senetRefills, d));
  await insertChunks(rows, (part) => tx.insert(senetRefills).values(part.map((r) => withPhone(d, r))));
}

async function writeStock(tx: Executor, d: Day, rows: StockRow[]): Promise<void> {
  await tx.delete(senetStock).where(inWindow(senetStock, d));
  await insertChunks(rows, (part) => tx.insert(senetStock).values(part.map((r) => ({ officeId: d.officeId, fromAt: d.from, toAt: d.to, ...r }))));
}

async function writeGoodsMoves(tx: Executor, d: Day, rows: GoodsMoveRow[]): Promise<void> {
  await tx.delete(senetGoodsMoves).where(inWindow(senetGoodsMoves, d));
  await insertChunks(rows, (part) => tx.insert(senetGoodsMoves).values(part.map((r) => ({ officeId: d.officeId, fromAt: d.from, toAt: d.to, ...r }))));
}

/** Абонемент — к суткам покупки (спецификация «Аналитика клуба», R6). */
async function writeTickets(tx: Executor, d: Day, rows: TicketRow[]): Promise<void> {
  await tx.delete(senetTickets).where(inDay(senetTickets, d));
  await insertChunks(rows, (part) => tx.insert(senetTickets).values(part.map((r) => withPhone(d, r))));
}

/** Сеанс — в сутки своего начала: Senet отдаёт и сеансы, пересекающие окно. */
async function writeLoad(tx: Executor, d: Day, rows: LoadRow[]): Promise<void> {
  const own = rows.filter((r) => r.startAt >= d.from && r.startAt < d.to);
  await tx.delete(senetLoad).where(and(eq(senetLoad.officeId, d.officeId), gte(senetLoad.startAt, d.from), lt(senetLoad.startAt, d.to)));
  await insertChunks(own, (part) => tx.insert(senetLoad).values(part.map((r) => withPhone(d, r))));
}

/** Строки аналитики одних суток клуба (§9.3, П5): замена строк окна — удаление и вставка в транзакции вызывающего. */
export async function writeAnalyticsDay(
  tx: Executor,
  o: Day & {
    sold: SoldItemRow[] | null;
    checks: CheckRow[] | null;
    refills: RefillRow[] | null;
    stock?: StockRow[] | null;
    goodsMoves?: GoodsMoveRow[] | null;
    load?: LoadRow[] | null;
    tickets?: TicketRow[] | null;
  },
): Promise<void> {
  // отчёт, который не пришёл (null), не трогается
  const steps: [unknown[] | null | undefined, (rows: never[]) => Promise<void>][] = [
    [o.sold, (r) => writeSold(tx, o, r)],
    [o.checks, (r) => writeChecks(tx, o, r)],
    [o.refills, (r) => writeRefills(tx, o, r)],
    [o.stock, (r) => writeStock(tx, o, r)],
    [o.goodsMoves, (r) => writeGoodsMoves(tx, o, r)],
    [o.tickets, (r) => writeTickets(tx, o, r)],
    [o.load, (r) => writeLoad(tx, o, r)],
  ];
  for (const [rows, write] of steps) if (rows) await write(rows as never[]);
}

/**
 * Отрезок `[from, to)`, за который отчёт клуба принят и записан (спецификация «Аналитика клуба», §3.2, R1): в транзакции
 * вызывающего. Пересекающиеся и смежные отрезки того же отчёта сливаются в один — повторный забор строк не плодит.
 */
export async function markSpan(tx: Executor, officeId: number, report: ReportKind, from: string, to: string): Promise<void> {
  const near = and(eq(senetDataSpans.officeId, officeId), eq(senetDataSpans.report, report), lte(senetDataSpans.fromAt, to), gte(senetDataSpans.toAt, from));
  const old = await tx.select({ id: senetDataSpans.id, fromAt: senetDataSpans.fromAt, toAt: senetDataSpans.toAt }).from(senetDataSpans).where(near);
  const [merged] = mergeSpans([{ from, to }, ...old.map((s) => ({ from: s.fromAt, to: s.toAt }))]);
  if (old.length) await tx.delete(senetDataSpans).where(inArray(senetDataSpans.id, old.map((s) => s.id)));
  await tx.insert(senetDataSpans).values({ officeId, report, fromAt: merged!.from, toAt: merged!.to });
}

/** Отрезки отчётов клубов, пересекающие `[from, to)`: по каждому клубу и отчёту, слитые. */
export async function loadSpans(ex: Executor, officeIds: readonly number[], reports: readonly ReportKind[], from: string, to: string): Promise<Map<number, Map<ReportKind, Span[]>>> {
  const out = new Map<number, Map<ReportKind, Span[]>>(officeIds.map((id) => [id, new Map(reports.map((r) => [r, [] as Span[]]))]));
  if (!officeIds.length || !reports.length) return out;
  const rows = await ex
    .select({ officeId: senetDataSpans.officeId, report: senetDataSpans.report, fromAt: senetDataSpans.fromAt, toAt: senetDataSpans.toAt })
    .from(senetDataSpans)
    .where(and(inArray(senetDataSpans.officeId, [...officeIds]), inArray(senetDataSpans.report, [...reports]), lt(senetDataSpans.fromAt, to), gt(senetDataSpans.toAt, from)));
  for (const r of rows) out.get(r.officeId)?.get(r.report as ReportKind)?.push({ from: r.fromAt, to: r.toAt });
  for (const byReport of out.values()) for (const [r, spans] of byReport) byReport.set(r, mergeSpans(spans));
  return out;
}
