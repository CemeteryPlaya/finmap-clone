/**
 * Окно смены (§4.1): выемки и внесения смены — в `(конец предыдущей смены, конец этой смены]`. Выемки делают до закрытия,
 * иногда раньше начала следующей смены, поэтому окно привязано к концу. У самой первой известной смены окно начинается
 * за 10 секунд до её начала; у незакрытой смены конца нет.
 */
export interface ShiftSpan {
  openedAt: string;
  closedAt: string | null;
}

export interface MoveInput {
  at: string;
  kind: 'in' | 'out';
  amount: number;
  comment: string;
}

const FIRST_LEAD_MS = 10_000;

/** Выемки по сменам: смены — по возрастанию начала; выемка вне всех окон не попадает никуда. */
export function shiftWindows<S extends ShiftSpan, M extends { at: string }>(shifts: readonly S[], moves: readonly M[], prevClosedAt: string | null = null): { shift: S; moves: M[] }[] {
  const out = shifts.map((shift) => ({ shift, moves: [] as M[] }));
  const bounds = shifts.map((s, i) => {
    const prev = i === 0 ? prevClosedAt : (shifts[i - 1]!.closedAt ?? shifts[i - 1]!.openedAt);
    const lo = prev ?? new Date(Date.parse(s.openedAt) - FIRST_LEAD_MS).toISOString();
    return { lo, hi: s.closedAt };
  });
  for (const m of moves) {
    const i = bounds.findIndex((b) => m.at > b.lo && (b.hi === null || m.at <= b.hi));
    if (i >= 0) out[i]!.moves.push(m);
  }
  return out;
}

/** Внесения, выемки и выручка смены: выручка = остаток на закрытии − внесения окна + выемки окна. */
export function shiftTotals(endBalance: number, moves: readonly Pick<MoveInput, 'kind' | 'amount'>[]): { cashIn: number; cashOut: number; revenue: number } {
  let cashIn = 0;
  let cashOut = 0;
  for (const m of moves) {
    if (m.kind === 'in') cashIn += m.amount;
    else cashOut += m.amount;
  }
  return { cashIn, cashOut, revenue: endBalance - cashIn + cashOut };
}
