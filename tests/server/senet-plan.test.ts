import { describe, expect, it } from 'vitest';
import { lateOpTime, planShift, type MoveInput } from '../../src/server/modules/senet/posting/plan';
import { buildRuleSet, type MatchMode, type RuleRow, type RuleType } from '../../src/server/modules/senet/posting/rules';
import { shiftWindows } from '../../src/server/modules/senet/posting/windows';

const CAT = { salary: 1, lunch: 2, bar: 4, water: 6, consumables: 7, income: 9 } as const;
const CP = { op1: 11, op2: 12, drinks: 17 } as const;
const ACC = { cashAccountId: 101, kaspiAccountId: 102, incomeCategoryId: CAT.income };

let id = 0;
const row = (type: RuleType, pattern: string, match: MatchMode, o: Partial<RuleRow> = {}): RuleRow => ({
  id: ++id,
  officeId: null,
  type,
  pattern,
  match,
  priority: id,
  categoryId: null,
  counterpartyId: null,
  commentTemplate: null,
  flags: {},
  archived: false,
  ...o,
});
const rules = buildRuleSet(
  [
    row('kaspi', 'kaspi', 'phrase'),
    row('salary_word', '', 'word', { categoryId: CAT.salary }),
    row('salary_word', 'zp', 'word'),
    row('extra_pay_word', 'dop', 'word'),
    row('employee_alias', 'op1', 'word', { counterpartyId: CP.op1 }),
    row('employee_alias', 'op2', 'word', { counterpartyId: CP.op2 }),
    row('lunch', '', 'word', { categoryId: CAT.lunch }),
    row('lunch', 'obed', 'first'),
    row('keyword', 'voda', 'phrase', { categoryId: CAT.water, commentTemplate: 'вода' }),
    row('keyword', 'мусор', 'contains', { categoryId: CAT.consumables, commentTemplate: '{orig}' }),
    row('bar_item', '', 'contains', { categoryId: CAT.bar }),
    row('bar_supplier', '', 'contains', { counterpartyId: CP.drinks }),
  ],
  1,
  { categories: new Set(Object.values(CAT)), counterparties: new Set(Object.values(CP)) },
);

const T = (hms: string) => `2026-10-01T${hms}.000Z`;
const shift = { openedAt: T('00:00:00'), closedAt: '2026-10-01T05:00:00.250Z', endBalance: 1_000_000 };
const out = (hms: string, amount: number, comment: string): MoveInput => ({ at: T(hms), kind: 'out', amount, comment });
const inn = (hms: string, amount: number): MoveInput => ({ at: T(hms), kind: 'in', amount, comment: '' });
const plan = (moves: MoveInput[], o: { prevEndBalance?: number | null; revenueTx?: number | null } = {}) =>
  planShift({ shift, moves, prevEndBalance: o.prevEndBalance ?? null, revenueTx: o.revenueTx ?? null, rules, accounts: ACC });

/** План смены (спецификация 2026-11-02-senet-autopost, §4.1–4.4; план, задача 9). */
describe('shiftWindows', () => {
  it('выемка после начала следующей смены, но до закрытия своей — в своей смене; первая смена — с запасом 10 с', () => {
    const shifts = [
      { openedAt: T('00:00:00'), closedAt: T('05:00:00') },
      { openedAt: T('04:58:00'), closedAt: T('12:00:00') },
    ];
    const moves = [{ at: T('04:59:00') }, { at: T('05:00:30') }, { at: '2026-09-30T23:59:55.000Z' }, { at: '2026-09-30T23:59:40.000Z' }];
    expect(shiftWindows(shifts, moves).map((w) => w.moves.map((m) => m.at))).toEqual([
      [T('04:59:00'), '2026-09-30T23:59:55.000Z'],
      [T('05:00:30')],
    ]);
  });
});

describe('planShift', () => {
  it('выручка, Каспи и Касса: остаток − внесения + выемки', () => {
    const p = plan([inn('00:00:05', 300_000), out('04:50:00', 200_000, 'kaspi'), out('04:51:00', 150_000, 'zp op1')]);
    expect([p.revenue, p.kaspi, p.cash]).toEqual([1_050_000, 200_000, 850_000]);
    expect(p.ops.filter((o) => o.ref.kind === 'income').map((o) => [o.ref, o.accountId, o.amount, o.categoryId])).toEqual([
      [{ kind: 'income', income: 'kaspi' }, ACC.kaspiAccountId, 200_000, CAT.income],
      [{ kind: 'income', income: 'cash' }, ACC.cashAccountId, 850_000, CAT.income],
    ]);
    expect(p.reviews).toEqual([]);
  });

  it('предупреждения: внесение ≠ остаток прошлой смены; выручка ≠ транзакции', () => {
    const p = plan([inn('00:00:05', 300_000), out('04:50:00', 200_000, 'kaspi')], { prevEndBalance: 290_000, revenueTx: 1 });
    expect(p.warnings).toEqual(['deposit_mismatch', 'revenue_tx_mismatch']);
    expect(plan([inn('00:00:05', 300_000), out('04:50:00', 200_000, 'kaspi')], { prevEndBalance: 300_000, revenueTx: 900_000 }).warnings).toEqual([]);
  });

  it('время: X без мс; ЗП в X, обед +1, бар +1, каждая прочая +1, доходы последними', () => {
    const p = plan([
      out('04:40:00', 1000, 'мусор пакеты'),
      out('04:41:00', 1000, 'voda'),
      out('04:42:00', 1000, 'gorilla45x500'),
      out('04:43:00', 1000, 'obed'),
      out('04:44:00', 1000, 'zp op2'),
      out('04:45:00', 1000, 'zp op1'),
      out('04:46:00', 1000, 'kaspi'),
    ]);
    const time = (o: { paidAt: string }) => o.paidAt.slice(11, 19);
    expect(p.ops.map((o) => [o.ref.kind === 'move' ? o.categoryId : o.ref.income, time(o)])).toEqual([
      [CAT.salary, '05:00:00'],
      [CAT.salary, '05:00:00'],
      [CAT.lunch, '05:01:00'],
      [CAT.bar, '05:02:00'],
      [CAT.consumables, '05:03:00'],
      [CAT.water, '05:04:00'],
      ['kaspi', '05:05:00'],
      ['cash', '05:05:00'],
    ]);
    expect(p.ops[4]!.comment).toBe('мусор пакеты');
  });

  it('без ЗП обед — в X; без расходов доходы — в X + 1 мин', () => {
    expect(plan([out('04:43:00', 1000, 'obed'), out('04:46:00', 1000, 'kaspi')]).ops[0]!.paidAt).toBe('2026-10-01T05:00:00.000Z');
    expect(plan([out('04:46:00', 1000, 'kaspi')]).ops.map((o) => o.paidAt)).toEqual(['2026-10-01T05:01:00.000Z', '2026-10-01T05:01:00.000Z']);
  });

  it('доплата — первому получателю ЗП смены; без него — в очередь', () => {
    const p = plan([out('04:40:00', 1000, 'zp op2'), out('04:41:00', 1000, 'zp op1'), out('04:42:00', 500, 'dop zp'), out('04:46:00', 1000, 'kaspi')]);
    expect(p.ops.filter((o) => o.categoryId === CAT.salary).map((o) => o.counterpartyId)).toEqual([CP.op2, CP.op1, CP.op2]);
    const alone = plan([out('04:42:00', 500, 'dop zp'), out('04:46:00', 1000, 'kaspi')]);
    expect(alone.reviews).toEqual([{ moveIndex: 0, reason: 'salary_no_name', hint: { categoryId: CAT.salary } }]);
  });

  it('нет выноса kaspi — Касса на всю выручку и пункт no_kaspi; Касса < 0 — доходов нет, пункт negative_cash', () => {
    const noKaspi = plan([out('04:40:00', 1000, 'zp op1')]);
    expect(noKaspi.ops.filter((o) => o.ref.kind === 'income').map((o) => [o.ref, o.amount])).toEqual([[{ kind: 'income', income: 'cash' }, 1_001_000]]);
    expect(noKaspi.reviews).toEqual([{ moveIndex: null, reason: 'no_kaspi', hint: null }]);
    const negative = planShift({ shift: { ...shift, endBalance: 0 }, moves: [inn('00:00:05', 500_000), out('04:46:00', 100_000, 'kaspi')], prevEndBalance: null, revenueTx: null, rules, accounts: ACC });
    expect(negative.cash).toBe(-500_000);
    expect(negative.ops.filter((o) => o.ref.kind === 'income')).toEqual([]);
    expect(negative.reviews).toEqual([{ moveIndex: null, reason: 'negative_cash', hint: null }]);
  });

  it('нераспознанная выемка — в очередь, места в раскладке не занимает', () => {
    const p = plan([out('04:40:00', 1000, 'что-то'), out('04:41:00', 1000, 'voda'), out('04:46:00', 1000, 'kaspi')]);
    expect(p.reviews).toEqual([{ moveIndex: 0, reason: 'unrecognized', hint: null }]);
    expect(p.ops.map((o) => o.paidAt.slice(11, 19))).toEqual(['05:00:00', '05:01:00', '05:01:00']);
  });

  it('закупка бара: строки и несовпадение суммы', () => {
    const p = plan([out('04:40:00', 2_250_000, 'gorilla45x500'), out('04:41:00', 999, 'gorilla2x500'), out('04:46:00', 1000, 'kaspi')]);
    expect(p.barPurchases).toEqual([
      { moveIndex: 0, lines: [{ itemText: 'gorilla', qty: 45_000, price: 50_000, amount: 2_250_000 }], mismatch: false },
      { moveIndex: 1, lines: [{ itemText: 'gorilla', qty: 2_000, price: 50_000, amount: 100_000 }], mismatch: true },
    ]);
  });
});

describe('lateOpTime', () => {
  it('после последней выемки смены, но не позже доходов: та же минута; без выемок — X', () => {
    expect(lateOpTime('2026-10-01T05:00:00.250Z', ['2026-10-01T05:00:00.000Z', '2026-10-01T05:03:00.000Z'])).toBe('2026-10-01T05:03:00.000Z');
    expect(lateOpTime('2026-10-01T05:00:00.250Z', [])).toBe('2026-10-01T05:00:00.000Z');
  });
});
