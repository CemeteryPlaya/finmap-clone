import { parseBarPurchase, type BarLine } from './bar';
import { classify, type Group, type Hint } from './classify';
import type { RuleSet } from './rules';
import { shiftTotals, type MoveInput } from './windows';

export type { MoveInput } from './windows';

export interface ShiftInput {
  openedAt: string;
  closedAt: string;
  endBalance: number;
}

export interface OfficeAccounts {
  cashAccountId: number;
  kaspiAccountId: number;
  incomeCategoryId: number;
}

export interface PlannedOp {
  ref: { kind: 'move'; moveIndex: number } | { kind: 'income'; income: 'kaspi' | 'cash' };
  paidAt: string;
  accountId: number;
  amount: number;
  categoryId: number;
  counterpartyId: number | null;
  comment: string | null;
  ruleId: number | null;
}

export type PlanReviewReason = 'unrecognized' | 'name_only' | 'salary_no_name' | 'rule_broken' | 'no_kaspi' | 'negative_cash';

export interface PlannedReview {
  moveIndex: number | null;
  reason: PlanReviewReason;
  hint: Hint | null;
}

export interface ShiftPlan {
  revenue: number;
  kaspi: number;
  cash: number;
  ops: PlannedOp[];
  reviews: PlannedReview[];
  warnings: ('deposit_mismatch' | 'revenue_tx_mismatch')[];
  barPurchases: { moveIndex: number; lines: BarLine[]; mismatch: boolean }[];
}

const MINUTE = 60_000;
const RANK: Record<Group, number> = { salary: 0, lunch: 1, bar: 2, other: 3 };

/** X — закрытие смены с точностью до секунды (§4.4). */
const secondOf = (iso: string) => Math.floor(Date.parse(iso) / 1000) * 1000;
const at = (ms: number) => new Date(ms).toISOString();

/**
 * Смена → план операций (§4.1–4.4), как в эталоне: выемки по правилам, доплата — первому получателю ЗП смены,
 * раскладка по минутам от X (ЗП, обед, бар — группами, прочие — по одной), доходы Каспи и Касса последними.
 * Нераспознанное — пункты очереди, без места в раскладке.
 */
export function planShift(o: { shift: ShiftInput; moves: readonly MoveInput[]; prevEndBalance: number | null; revenueTx: number | null; rules: RuleSet; accounts: OfficeAccounts }): ShiftPlan {
  const { accounts } = o;
  const X = secondOf(o.shift.closedAt);
  const totals = shiftTotals(o.shift.endBalance, o.moves);
  const reviews: PlannedReview[] = [];
  const barPurchases: ShiftPlan['barPurchases'] = [];
  let kaspi = 0;

  // выемки по времени; при равном времени — по сумме и тексту, как sorted() эталона
  const outs = o.moves
    .map((m, moveIndex) => ({ m, moveIndex }))
    .filter(({ m }) => m.kind === 'out')
    .sort((a, b) => (a.m.at < b.m.at ? -1 : a.m.at > b.m.at ? 1 : a.m.amount - b.m.amount || (a.m.comment < b.m.comment ? -1 : a.m.comment > b.m.comment ? 1 : 0)));

  type Pending = { moveIndex: number; group: Group; categoryId: number; counterpartyId: number | null | 'extra'; comment: string | null; ruleId: number | null; amount: number };
  const expenses: Pending[] = [];
  for (const { m, moveIndex } of outs) {
    const c = classify(m.comment, o.rules);
    if (c.kind === 'kaspi') kaspi += m.amount;
    else if (c.kind === 'review') reviews.push({ moveIndex, reason: c.reason, hint: c.hint });
    else if (c.kind === 'extra_pay') expenses.push({ moveIndex, group: 'salary', categoryId: c.categoryId, counterpartyId: 'extra', comment: null, ruleId: c.ruleId, amount: m.amount });
    else {
      expenses.push({ moveIndex, group: c.group, categoryId: c.categoryId, counterpartyId: c.counterpartyId, comment: c.comment, ruleId: c.ruleId, amount: m.amount });
      if (c.group === 'bar') {
        const lines = parseBarPurchase(m.comment);
        if (lines.length) barPurchases.push({ moveIndex, lines, mismatch: lines.reduce((s, l) => s + l.amount, 0) !== m.amount });
      }
    }
  }

  // «dop zp» — первому сотруднику, получившему ЗП в этой смене
  const firstPaid = expenses.find((e) => e.group === 'salary' && typeof e.counterpartyId === 'number')?.counterpartyId as number | undefined;
  const placed = expenses.filter((e) => {
    if (e.counterpartyId !== 'extra') return true;
    if (firstPaid !== undefined) {
      e.counterpartyId = firstPaid;
      return true;
    }
    reviews.push({ moveIndex: e.moveIndex, reason: 'salary_no_name', hint: { categoryId: e.categoryId } });
    return false;
  });

  // раскладка: группы ЗП, обед, бар — по минуте на группу; каждая прочая — своя минута
  const sorted = placed.map((e, i) => ({ e, i })).sort((a, b) => RANK[a.e.group] - RANK[b.e.group] || a.i - b.i);
  const ops: PlannedOp[] = [];
  let minute = 0;
  let last: number | null = null;
  for (const { e } of sorted) {
    const r = RANK[e.group];
    if (last !== null && (r !== last || r >= RANK.other)) minute++;
    last = r;
    ops.push({
      ref: { kind: 'move', moveIndex: e.moveIndex },
      paidAt: at(X + minute * MINUTE),
      accountId: accounts.cashAccountId,
      amount: e.amount,
      categoryId: e.categoryId,
      counterpartyId: e.counterpartyId as number | null,
      comment: e.comment,
      ruleId: e.ruleId,
    });
  }

  const revenue = totals.revenue;
  const cash = revenue - kaspi;
  const incomeAt = at(X + (minute + 1) * MINUTE);
  const income = (kind: 'kaspi' | 'cash', accountId: number, amount: number): PlannedOp => ({
    ref: { kind: 'income', income: kind },
    paidAt: incomeAt,
    accountId,
    amount,
    categoryId: accounts.incomeCategoryId,
    counterpartyId: null,
    comment: null,
    ruleId: null,
  });
  if (cash < 0) reviews.push({ moveIndex: null, reason: 'negative_cash', hint: null });
  else {
    if (kaspi > 0) ops.push(income('kaspi', accounts.kaspiAccountId, kaspi));
    if (cash > 0) ops.push(income('cash', accounts.cashAccountId, cash));
  }
  if (kaspi === 0) reviews.push({ moveIndex: null, reason: 'no_kaspi', hint: null });

  const warnings: ShiftPlan['warnings'] = [];
  if (o.prevEndBalance !== null && totals.cashIn !== o.prevEndBalance) warnings.push('deposit_mismatch');
  if (o.revenueTx !== null && o.revenueTx !== revenue) warnings.push('revenue_tx_mismatch');
  return { revenue, kaspi, cash, ops, reviews, warnings, barPurchases };
}

/**
 * Время операции по ответу из очереди (§4.4): после прочих выемок смены, но не позже доходов — доходы стоят на минуту
 * позже последней выемки, поэтому это минута последней выемки; без выемок — X.
 */
export function lateOpTime(closedAt: string, moveOpTimes: readonly string[]): string {
  const X = secondOf(closedAt);
  const lastMove = moveOpTimes.reduce((m, t) => Math.max(m, Date.parse(t)), X);
  return at(lastMove);
}
