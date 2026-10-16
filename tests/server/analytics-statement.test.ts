import { afterEach, describe, expect, it } from 'vitest';
import { statementLeg } from '../../src/shared/report-statement';
import { createAnalyticsService } from '../../src/server/modules/analytics/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createJournal } from '../../src/server/modules/operations/journal';
import type { RatesService } from '../../src/server/modules/rates/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { sheetRows } from '../helpers/xlsx-rows';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Item {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  paidAt: string;
  accountId: number;
  toAccountId: number | null;
  amount: number;
  toAmount: number | null;
  balanceAfter: number | null;
  toBalanceAfter: number | null;
}
interface Summary {
  start: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  end: number;
}
interface Statement {
  account: { id: number; name: string; currency: string; archived: boolean };
  summary: Summary;
  items: Item[];
  nextCursor: string | null;
  meta: { from: string; to: string };
}

const PERIOD = 'from=2026-10-01&to=2026-10-03';
const base = () => `/api/v1/companies/${w.cid}/analytics`;
const get = async <T>(url: string): Promise<T> => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
};
const statement = (qs: string) => get<Statement>(`${base()}/statement?${qs}`);
const fieldError = async (url: string) => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(400);
  return (res.json() as { error: { fields: Record<string, string> } }).error.fields;
};

/**
 * Синтетика: «Касса» (KZT, стартовый остаток 10 000 ₸) и «Валютный» (USD), оба открыты 01.01.2026. До периода — доход
 * 5 000 ₸ (20.09). В периоде 01–03.10: доход 1 000 ₸ «Бар» (проект «Клуб 1», «ИП Клиент», комментарий «Смена»); разбитый
 * расход 300 ₸ «Аренда» — 200 ₸ «Клуб 1» и 100 ₸ «Клуб 2»; перевод 475,12 ₸ → $1,00; перевод $0,50 → 237,56 ₸; расход
 * $0,20; удалённый доход 70 ₸. После периода (05.10) — доход 99,99 ₸.
 */
async function world() {
  w = await opsWorld();
  const accounts = `/api/v1/companies/${w.cid}/accounts`;
  await w.h.req('PATCH', `${accounts}/${w.kzt}`, { openedAt: '2026-01-01', startingBalance: 1_000_000 });
  await w.h.req('PATCH', `${accounts}/${w.usd}`, { openedAt: '2026-01-01' });
  const op = async (body: Record<string, unknown>) => (await w.post(w.ops, body)).operation.id as number;
  const income = (paidAt: string, amount: number, extra: Record<string, unknown> = {}) =>
    op({ type: 'income', paidAt, accountId: w.kzt, amount, lines: [{ categoryId: w.income, amount }], ...extra });
  await income('2026-09-20T05:00:00Z', 500_000);
  await income('2026-10-02T05:00:00Z', 100_000, {
    counterpartyId: w.counterparty,
    comment: 'Смена',
    lines: [{ categoryId: w.income, projectId: w.project, amount: 100_000 }],
  });
  await op({
    type: 'expense',
    paidAt: '2026-10-02T06:00:00Z',
    accountId: w.kzt,
    amount: 30_000,
    lines: [
      { categoryId: w.expense, projectId: w.project, amount: 20_000 },
      { categoryId: w.expense, projectId: w.project2, amount: 10_000 },
    ],
  });
  await op({ type: 'transfer', paidAt: '2026-10-03T05:00:00Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100 });
  await op({ type: 'transfer', paidAt: '2026-10-03T06:00:00Z', accountId: w.usd, amount: 50, toAccountId: w.kzt, toAmount: 23_756 });
  await op({ type: 'expense', paidAt: '2026-10-03T07:00:00Z', accountId: w.usd, amount: 20, lines: [{ categoryId: w.expense, amount: 20 }] });
  const deleted = await income('2026-10-03T08:00:00Z', 7_000);
  expect((await w.h.req('DELETE', `${w.ops}/${deleted}`)).statusCode).toBe(200);
  await income('2026-10-05T05:00:00Z', 9_999);
}

/** Сверка с журналом: каждая строка — остаток после операции журнала, предыдущий остаток = остаток - движение; цепочка от начала до конца. */
function reconcile(s: Statement) {
  const legs = s.items.map((i) => statementLeg(i, s.account.id));
  expect(legs[0]?.balance ?? s.summary.start).toBe(s.summary.end);
  legs.forEach((leg, i) => expect(leg.balance! - leg.delta).toBe(legs[i + 1]?.balance ?? s.summary.start));
  const sum = (pick: (leg: (typeof legs)[number], item: Item) => number) => legs.reduce((acc, leg, i) => acc + pick(leg, s.items[i]!), 0);
  expect(sum((l, i) => (i.type === 'income' ? l.delta : 0))).toBe(s.summary.income);
  expect(sum((l, i) => (i.type === 'expense' ? -l.delta : 0))).toBe(s.summary.expense);
  expect(sum((l, i) => (i.type === 'transfer' && l.delta > 0 ? l.delta : 0))).toBe(s.summary.transfersIn);
  expect(sum((l, i) => (i.type === 'transfer' && l.delta < 0 ? -l.delta : 0))).toBe(s.summary.transfersOut);
}

describe('«Выписка по счету»: GET …/analytics/statement (§6, §9)', () => {
  it('сводка в валюте счёта сходится: конец = начало + поступления - списания + переводы на счёт - со счёта; остатки — как в журнале', async () => {
    await world();
    const kzt = await statement(`account=${w.kzt}&${PERIOD}`);
    expect(kzt.account).toEqual({ id: w.kzt, name: 'Касса', currency: 'KZT', archived: false, openedAt: '2026-01-01' });
    expect(kzt.meta).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    // начало — стартовый остаток и доход до периода; удалённый доход и доход после периода не входят
    expect(kzt.summary).toEqual({ start: 1_500_000, income: 100_000, expense: 30_000, transfersIn: 23_756, transfersOut: 47_512, end: 1_546_244 });
    // новые сверху; оба перевода — в выписке счёта, удалённой операции нет
    expect(kzt.items.map((i) => [i.type, statementLeg(i, w.kzt).delta, statementLeg(i, w.kzt).balance])).toEqual([
      ['transfer', 23_756, 1_546_244],
      ['transfer', -47_512, 1_522_488],
      ['expense', -30_000, 1_570_000],
      ['income', 100_000, 1_600_000],
    ]);
    expect(kzt.nextCursor).toBeNull();
    reconcile(kzt);
    // остаток после операции — тот же, что в журнале
    const journal = (await get<{ items: Item[] }>(`${w.ops}?accountIds=${w.kzt}&from=2026-10-01&to=2026-10-03`)).items;
    expect(kzt.items.map((i) => [i.id, i.balanceAfter, i.toBalanceAfter])).toEqual(journal.map((i) => [i.id, i.balanceAfter, i.toBalanceAfter]));

    // валютный счёт: перевод на счёт — сумма зачисления ($1,00), со счёта — сумма списания ($0,50)
    const usd = await statement(`account=${w.usd}&${PERIOD}`);
    expect(usd.summary).toEqual({ start: 0, income: 0, expense: 20, transfersIn: 100, transfersOut: 50, end: 30 });
    expect(usd.items.map((i) => [i.type, statementLeg(i, w.usd).delta, statementLeg(i, w.usd).balance, statementLeg(i, w.usd).other])).toEqual([
      ['expense', -20, 30, null],
      ['transfer', -50, 50, w.kzt],
      ['transfer', 100, 100, w.kzt],
    ]);
    reconcile(usd);
  });

  it('страницы: первая со сводкой, дальше statement/operations по курсору журнала — без пропусков и повторов', async () => {
    await world();
    const all = await statement(`account=${w.kzt}&${PERIOD}`);
    const first = await statement(`account=${w.kzt}&${PERIOD}&limit=3`);
    expect(first.summary).toEqual(all.summary);
    expect(first.items.map((i) => i.id)).toEqual(all.items.slice(0, 3).map((i) => i.id));
    expect(first.nextCursor).not.toBeNull();
    const next = await get<{ items: Item[]; nextCursor: string | null }>(
      `${base()}/statement/operations?account=${w.kzt}&${PERIOD}&limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(next.items.map((i) => i.id)).toEqual(all.items.slice(3).map((i) => i.id));
    expect(next.nextCursor).toBeNull();
    expect(next).not.toHaveProperty('summary');
  });

  it('период без операций: начало = конец, обороты — нули, список пуст', async () => {
    await world();
    const august = await statement(`account=${w.kzt}&from=2026-08-01&to=2026-08-31`);
    expect(august.summary).toEqual({ start: 1_000_000, income: 0, expense: 0, transfersIn: 0, transfersOut: 0, end: 1_000_000 });
    expect(august.items).toEqual([]);
    expect(august.nextCursor).toBeNull();
    const gap = await statement(`account=${w.kzt}&from=2026-10-04&to=2026-10-04`);
    expect(gap.summary.start).toBe(1_546_244);
    expect(gap.summary.end).toBe(1_546_244);
  });

  it('архивный счёт: выписка строится, если выбран явно; счёт другой компании, без счёта, неверный период и курсор — 400', async () => {
    await world();
    // в архив — только с нулевым балансом: остаток $0,30 уходит расходом после периода
    await w.post(w.ops, { type: 'expense', paidAt: '2026-10-05T06:00:00Z', accountId: w.usd, amount: 30, lines: [{ categoryId: w.expense, amount: 30 }] });
    expect((await w.h.req('POST', `/api/v1/companies/${w.cid}/accounts/${w.usd}/archive`)).statusCode).toBe(200);
    const archived = await statement(`account=${w.usd}&${PERIOD}`);
    expect(archived.account).toMatchObject({ id: w.usd, archived: true });
    expect(archived.summary.end).toBe(30);

    const other = await w.h.company('Чужая');
    const foreign = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужой', currency: 'KZT', openedAt: '2026-01-01', startingBalance: 0 })).account.id as number;
    expect(await fieldError(`${base()}/statement?account=${foreign}&${PERIOD}`)).toEqual({ account: 'Неизвестный счёт' });
    expect(await fieldError(`${base()}/statement/operations?account=${foreign}&${PERIOD}`)).toEqual({ account: 'Неизвестный счёт' });
    expect(await fieldError(`${base()}/statement.xlsx?account=${foreign}&${PERIOD}`)).toEqual({ account: 'Неизвестный счёт' });
    expect(await fieldError(`${base()}/statement?${PERIOD}`)).toEqual({ account: 'Укажите счёт' });
    expect(await fieldError(`${base()}/statement?account=abc&${PERIOD}`)).toEqual({ account: 'Неизвестный счёт' });
    expect(await fieldError(`${base()}/statement?account=${w.kzt}&from=2026-10-03&to=2026-10-01`)).toEqual({ to: 'Конец периода раньше начала' });
    expect(await fieldError(`${base()}/statement?account=${w.kzt}&from=2020-01-01&to=2026-10-01`)).toEqual({ to: 'Период больше 5 лет' });
    expect(await fieldError(`${base()}/statement/operations?account=${w.kzt}&${PERIOD}&cursor=xyz`)).toEqual({ cursor: 'Список изменился — загрузите его заново' });
  });

  it('Excel: сводка числами в валюте счёта, колонки экрана, операции новые сверху с остатком после операции', async () => {
    await world();
    const res = await w.h.req('GET', `${base()}/statement.xlsx?account=${w.kzt}&${PERIOD}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Выписка по счету - 06-10-2026 17-00.xlsx');
    const all = sheetRows(res.rawPayload);
    const head = all.findIndex((r) => r[0] === 'Дата и время');
    expect(all.slice(0, head).map((r) => r.slice(0, 2))).toEqual([
      ['Отчёт: Выписка по счету', ''],
      ['Счёт: Касса, KZT', ''],
      ['Период: 01.10.2026 – 03.10.2026', ''],
      ['Остаток на начало', '15000.00'],
      ['Поступлений', '1000.00'],
      ['Списаний', '300.00'],
      ['Переводов на счёт', '237.56'],
      ['Переводов со счёта', '475.12'],
      ['Остаток на конец', '15462.44'],
    ]);
    expect(all[head]).toEqual(['Дата и время', 'Сумма', 'Остаток после операции', 'Контрагент', 'Категория', 'Проект', 'Комментарий']);
    const rows = all.slice(head + 1);
    expect(rows.every((r) => Number(r[0]) > 46_000)).toBe(true);
    expect(rows.map((r) => r.slice(1))).toEqual([
      ['237.56', '15462.44', '', 'Перевод: Валютный', '', ''],
      ['-475.12', '15224.88', '', 'Перевод: Валютный', '', ''],
      ['-300.00', '15700.00', '', 'Аренда', 'Клуб 1; Клуб 2', ''],
      ['1000.00', '16000.00', 'ИП Клиент', 'Бар', 'Клуб 1', 'Смена'],
    ]);
    // пустой период — сводка и только строка заголовков
    const empty = sheetRows((await w.h.req('GET', `${base()}/statement.xlsx?account=${w.kzt}&from=2026-08-01&to=2026-08-31`)).rawPayload);
    expect(empty.at(-1)![0]).toBe('Дата и время');
  });

  it('предел выгрузки (R1): больше exportLimit операций — 422 EXPORT_LIMIT до сборки файла; в пределе и на экране выписка строится', async () => {
    await world();
    const db = w.h.t.db;
    const journal = createJournal({ db, balances: createLedgerBalances(db), timezone: 'Asia/Almaty' });
    // курсы выписке не нужны
    const analytics = (exportLimit: number) => createAnalyticsService({ db, rates: {} as RatesService, journal, timezone: 'Asia/Almaty', exportLimit });
    const q = { account: w.kzt, from: '2026-10-01', to: '2026-10-03' };
    // в периоде 4 операции по счёту «Касса»
    expect(() => analytics(3).statementXlsx(w.cid, q)).toThrowError(expect.objectContaining({ status: 422, code: 'EXPORT_LIMIT' }));
    expect(() => analytics(3).statementXlsx(w.cid, q)).toThrow('Больше 3 операций — сузьте период или фильтр');
    expect(sheetRows(analytics(4).statementXlsx(w.cid, q).data).at(-1)).toBeDefined();
    // экран предел не затрагивает
    expect(analytics(3).statement(w.cid, { ...q, limit: 50 }).items).toHaveLength(4);
  });

  it('счёт открыт внутри периода (R2): начало = стартовый остаток, конец = «Деньги» по счёту; в Excel — строка про открытие', async () => {
    await world();
    const fresh = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Новая касса', currency: 'KZT', openedAt: '2026-10-02', startingBalance: 200_000 })).account.id as number;
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: fresh, amount: 50_000, lines: [{ categoryId: w.income, amount: 50_000 }] });
    await w.post(w.ops, { type: 'expense', paidAt: '2026-10-03T05:00:00Z', accountId: fresh, amount: 30_000, lines: [{ categoryId: w.expense, amount: 30_000 }] });
    const s = await statement(`account=${fresh}&${PERIOD}`);
    expect(s.account).toMatchObject({ id: fresh, openedAt: '2026-10-02' });
    expect(s.summary).toEqual({ start: 200_000, income: 50_000, expense: 30_000, transfersIn: 0, transfersOut: 0, end: 220_000 });
    reconcile(s);
    type Cashflow = { rows: { id: string; total: number | null }[] };
    const cashflow = await get<Cashflow>(`${base()}/cashflow?${PERIOD}&step=month&accounts=${fresh}`);
    expect(cashflow.rows.find((r) => r.id === 'balance:end')?.total).toBe(s.summary.end);
    const rows = sheetRows((await w.h.req('GET', `${base()}/statement.xlsx?account=${fresh}&${PERIOD}`)).rawPayload);
    expect(rows.map((r) => r[0])).toContain('Счёт открыт 02.10.2026 — стартовый остаток учтён в остатке на начало');
  });
});
