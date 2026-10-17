import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createJournal } from '../../src/server/modules/operations/journal';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Row {
  id: string;
  kind: string;
  label: string;
  values: (number | null)[];
  total: number | null;
  children?: Row[];
  note?: string;
}
interface Report {
  columns: { key: string; from: string; to: string; label: string }[];
  rows: Row[];
  meta: { currency: string; empty: boolean; balancesHidden: boolean; step: string; by: string };
}
interface CellPage {
  items: { id: number; type: string; part: number | null; balanceAfter: number | null; lines: unknown[] }[];
  nextCursor: string | null;
}

const OCTOBER = 'from=2026-10-01&to=2026-10-31&step=week';
const base = () => `/api/v1/companies/${w.cid}/analytics`;
const report = async (qs: string, cid = w.cid): Promise<Report> => {
  const res = await w.h.req('GET', `/api/v1/companies/${cid}/analytics/cashflow?${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Report;
};
const cell = async (qs: string): Promise<CellPage> => {
  const res = await w.h.req('GET', `${base()}/operations?report=cashflow&${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as CellPage;
};
const fail = (res: LightMyRequestResponse, status: number) => {
  expect(res.statusCode, res.body).toBe(status);
  return res.json().error as { code: string; fields?: Record<string, string> };
};
const find = (rows: Row[], id: string): Row => {
  for (const r of rows) {
    if (r.id === id) return r;
    const inner = r.children && r.children.find((c) => c.id === id);
    if (inner) return inner;
  }
  throw new Error(`нет строки ${id}`);
};

/**
 * Октябрь 2026 по неделям (1–4, 5–11, 12–18, 19–25, 26–31): доход 1 000 ₸ «Бар» (Клуб 1, контрагент) 2 октября, доход 10 $
 * 3 октября (4 751,20 ₸), перевод 475,12 ₸ → 1 $ в 23:30 4 октября по Алматы, расход 300 ₸ в 00:30 5 октября — разбит:
 * 200 ₸ «Аренда» (Клуб 1) и 100 ₸ «Закуп бара» (Клуб 2).
 */
async function october() {
  w = await opsWorld();
  const supply = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const income = (
    await w.post(w.ops, {
      type: 'income',
      paidAt: '2026-10-02T05:00:00Z',
      accountId: w.kzt,
      amount: 100_000,
      counterpartyId: w.counterparty,
      lines: [{ categoryId: w.income, projectId: w.project, amount: 100_000 }],
    })
  ).operation.id as number;
  const usdIncome = (await w.post(w.ops, { type: 'income', paidAt: '2026-10-03T05:00:00Z', accountId: w.usd, amount: 1000 })).operation.id as number;
  await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-04T18:30:00Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100 });
  const expense = (
    await w.post(w.ops, {
      type: 'expense',
      paidAt: '2026-10-04T19:30:00Z',
      accountId: w.kzt,
      amount: 30_000,
      tagIds: [w.tag],
      lines: [
        { categoryId: w.expense, projectId: w.project, amount: 20_000 },
        { categoryId: supply, projectId: w.project2, amount: 10_000 },
      ],
    })
  ).operation.id as number;
  return { supply, income, usdIncome, expense };
}

describe('«Деньги»: GET /companies/:cid/analytics/cashflow', () => {
  it('недели октября: колонки, остатки, неоперационные изменения, поступления и списания; итог поступлений = доходы журнала', async () => {
    await october();
    const r = await report(OCTOBER);
    expect(r.columns.map((c) => c.label)).toEqual(['1–4 окт', '5–11 окт', '12–18 окт', '19–25 окт', '26–31 окт']);
    expect(r.meta).toMatchObject({ currency: 'KZT', empty: false, balancesHidden: false, step: 'week', by: 'category' });
    expect(r.rows.map((x) => x.id)).toEqual(['balance:start', 'balance:end', 'nonop', 'net', 'income', 'expense']);
    // перевод в 23:30 4 октября — первая неделя, расход в 00:30 5 октября — вторая
    expect(find(r.rows, 'balance:start').values).toEqual([0, 575_120, 545_120, 545_120, 545_120]);
    expect(find(r.rows, 'balance:end').values).toEqual([575_120, 545_120, 545_120, 545_120, 545_120]);
    expect(find(r.rows, 'balance:end').total).toBe(545_120);
    expect(find(r.rows, 'nonop').values).toEqual([0, 0, 0, 0, 0]);
    expect(find(r.rows, 'nonop:transfers').values).toEqual([0, 0, 0, 0, 0]);
    expect(find(r.rows, 'net').values).toEqual([575_120, -30_000, 0, 0, 0]);
    const income = find(r.rows, 'income');
    expect(income.total).toBe(575_120);
    // неархивные категории без сумм (в том числе системные) — нулями
    expect(income.children!.map((c) => [c.label, c.total])).toEqual([
      ['Инвестиции', 0],
      ['Возврат займа', 0],
      ['Получение кредита', 0],
      ['Бар', 100_000],
      ['Без категории', 475_120],
    ]);
    const expense = find(r.rows, 'expense').children!;
    expect(expense.filter((c) => c.total !== 0).map((c) => [c.label, c.values[1]])).toEqual([
      ['Аренда', 20_000],
      ['Закуп бара', 10_000],
    ]);
    expect(expense.find((c) => c.label === 'Зарплата')!.total).toBe(0);

    // сверка с журналом: доходы за период по той же дате платежа
    const journal = (await w.h.req('GET', `${w.ops}?types=income&from=2026-10-01&to=2026-10-31`)).json() as { items: { baseAmount: number }[] };
    expect(journal.items.reduce((s, i) => s + i.baseAmount, 0)).toBe(income.total);
  });

  it('разрезы по проектам и контрагентам: «Без проекта», «Без контрагента», разбитая операция по частям', async () => {
    await october();
    const byProject = await report(`${OCTOBER}&by=project`);
    expect(find(byProject.rows, 'income').children!.map((c) => [c.label, c.total])).toEqual([
      ['Клуб 1', 100_000],
      ['Клуб 2', 0],
      ['Без проекта', 475_120],
    ]);
    expect(find(byProject.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([
      ['Клуб 1', 20_000],
      ['Клуб 2', 10_000],
    ]);
    const byCounterparty = await report(`${OCTOBER}&by=counterparty`);
    expect(find(byCounterparty.rows, 'income').children!.map((c) => [c.label, c.total])).toEqual([
      ['ИП Клиент', 100_000],
      ['Без контрагента', 475_120],
    ]);
  });

  it('фильтры: категория скрывает остатки; счёт — остатки только по нему, перевод — в «Переводах»; удалённые не считаются', async () => {
    const o = await october();
    const byCategory = await report(`${OCTOBER}&categories=${w.expense}`);
    expect(byCategory.meta.balancesHidden).toBe(true);
    expect(byCategory.rows.map((x) => x.id)).toEqual(['balance:hidden', 'net', 'income', 'expense']);
    expect(find(byCategory.rows, 'expense').children!.map((c) => [c.label, c.total])).toEqual([['Аренда', 20_000]]);
    expect(find(byCategory.rows, 'income').total).toBe(0);
    expect((await report(`${OCTOBER}&tags=${w.tag}`)).rows[0]!.id).toBe('balance:hidden');
    expect(find((await report(`${OCTOBER}&withoutProject=true`)).rows, 'income').total).toBe(475_120);

    const usd = await report(`${OCTOBER}&accounts=${w.usd}`);
    expect(usd.meta.balancesHidden).toBe(false);
    // 11 $ × 475,12 = 5 226,32 ₸: доход 4 751,20 ₸ и перевод 475,12 ₸
    expect(find(usd.rows, 'balance:end').values[0]).toBe(522_632);
    expect(find(usd.rows, 'net').values[0]).toBe(475_120);
    expect(find(usd.rows, 'nonop:transfers').values[0]).toBe(47_512);
    expect(find(usd.rows, 'nonop:fx').values[0]).toBe(0);

    await w.h.req('DELETE', `${w.ops}/${o.expense}`);
    expect(find((await report(OCTOBER)).rows, 'expense').total).toBe(0);
  });

  it('400: нет даты, конец раньше начала, больше 5 лет, больше 92 колонок, неизвестный счёт; 404 — нет компании', async () => {
    await october();
    const url = (qs: string) => `${base()}/cashflow?${qs}`;
    expect(fail(await w.h.req('GET', url('to=2026-10-31')), 400).fields).toMatchObject({ from: expect.any(String) });
    expect(fail(await w.h.req('GET', url('from=2026-10-31&to=2026-10-01')), 400).fields).toEqual({ to: 'Конец периода раньше начала' });
    expect(fail(await w.h.req('GET', url('from=2020-01-01&to=2025-01-01&step=quarter')), 400).fields).toEqual({ to: 'Период больше 5 лет' });
    expect(fail(await w.h.req('GET', url('from=2026-01-01&to=2026-12-31&step=day')), 400).fields).toEqual({ step: 'Слишком много колонок — выберите больший шаг' });
    expect((await w.h.req('GET', url('from=2026-07-01&to=2026-09-30&step=day'))).statusCode).toBe(200);
    expect(fail(await w.h.req('GET', url('from=2026-01-01&to=2026-12-31&step=year')), 400).fields).toMatchObject({ step: expect.any(String) });

    const other = await w.h.company('ТОО Другая');
    const foreign = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    expect(fail(await w.h.req('GET', url(`${OCTOBER}&accounts=${foreign}`)), 400).fields).toEqual({ accounts: 'Неизвестный счёт' });
    expect(fail(await w.h.req('GET', `/api/v1/companies/999999/analytics/cashflow?${OCTOBER}`), 404).code).toBe('NOT_FOUND');
  });

  it('изоляция компаний и архивная компания: отчёт только по своей компании, архив читается', async () => {
    await october();
    const other = await w.h.company('ТОО Другая');
    const account = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 5000 })).account.id as number;
    await w.post(`/api/v1/companies/${other}/operations`, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: account, amount: 777 });
    const own = await report(OCTOBER);
    expect(find(own.rows, 'income').total).toBe(575_120);
    const theirs = await report(OCTOBER, other);
    expect(find(theirs.rows, 'income').total).toBe(777);
    expect(find(theirs.rows, 'balance:end').values[0]).toBe(5777);
    expect(find(theirs.rows, 'nonop:starting').values[0]).toBe(5000);

    // счёт обнулён и в архиве, компания в архиве: отчёт читается; поток архивного счёта — «Исключённые из отчёта счета»
    await w.post(`/api/v1/companies/${other}/operations`, { type: 'expense', paidAt: '2026-10-03T05:00:00Z', accountId: account, amount: 5777 });
    await w.post(`/api/v1/companies/${other}/accounts/${account}/archive`, {});
    await w.post(`/api/v1/companies/${other}/archive`, {});
    const archived = await report(OCTOBER, other);
    expect(find(archived.rows, 'income').total).toBe(777);
    expect(find(archived.rows, 'net').values[0]).toBe(-5000);
    expect(find(archived.rows, 'balance:end').values[0]).toBe(0);
    expect(find(archived.rows, 'nonop:excluded').values[0]).toBe(5000);
  });

  it('пустой период: только итоговые строки с нулями, empty', async () => {
    w = await opsWorld();
    const r = await report('from=2026-01-01&to=2026-03-31');
    expect(r.meta.empty).toBe(true);
    expect(find(r.rows, 'income')).toMatchObject({ values: [0, 0, 0], total: 0 });
    expect(find(r.rows, 'income').children).toBeUndefined();
    expect(find(r.rows, 'balance:start').values).toEqual([0, 0, 0]);
  });
});

describe('операции ячейки: GET /companies/:cid/analytics/operations', () => {
  it('разбитая операция — только строки ячейки с суммой части; вся группа — без части; новые сверху, страницы курсором', async () => {
    const o = await october();
    const rent = await cell(`${OCTOBER}&row=expense:category:${w.expense}&col=2026-10-05`);
    expect(rent.items.map((i) => [i.id, i.part])).toEqual([[o.expense, 20_000]]);
    expect(rent.items[0]!.balanceAfter).toBe(22_488);
    expect(rent.items[0]!.lines).toHaveLength(2);
    expect((await cell(`${OCTOBER}&row=expense&col=2026-10-05`)).items.map((i) => [i.id, i.part])).toEqual([[o.expense, null]]);
    expect((await cell(`${OCTOBER}&row=expense:project:${w.project2}&col=total`)).items.map((i) => i.part)).toEqual([10_000]);
    // в первой неделе расхода нет: он в 00:30 5 октября
    expect((await cell(`${OCTOBER}&row=expense&col=2026-10-01`)).items).toEqual([]);

    const first = await cell(`${OCTOBER}&row=net&col=total&limit=2`);
    expect(first.items.map((i) => i.id)).toEqual([o.expense, o.usdIncome]);
    expect(first.nextCursor).not.toBeNull();
    const second = await cell(`${OCTOBER}&row=net&col=total&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items.map((i) => i.id)).toEqual([o.income]);
    expect(second.nextCursor).toBeNull();
    expect((await cell(`${OCTOBER}&row=income:counterparty:none&col=total`)).items.map((i) => i.id)).toEqual([o.usdIncome]);
  });

  it('подкатегории: строка родителя включает их, «Без подкатегории» — только свои строки; фильтр отчёта действует', async () => {
    const o = await october();
    const cola = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'income', name: 'Кола', parentId: w.income })).category.id as number;
    const child = (await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 5000, lines: [{ categoryId: cola, amount: 5000 }] }))
      .operation.id as number;
    const r = await report(OCTOBER);
    const bar = find(r.rows, `income:category:${w.income}`);
    expect(bar.total).toBe(105_000);
    expect(bar.children!.map((c) => [c.id, c.total])).toEqual([
      [`income:category:${w.income}:own`, 100_000],
      [`income:category:${cola}`, 5000],
    ]);
    expect((await cell(`${OCTOBER}&row=income:category:${w.income}&col=total`)).items.map((i) => i.id)).toEqual([child, o.income]);
    expect((await cell(`${OCTOBER}&row=income:category:${w.income}:own&col=total`)).items.map((i) => i.id)).toEqual([o.income]);
    expect((await cell(`${OCTOBER}&row=income&col=total&accounts=${w.usd}`)).items.map((i) => i.id)).toEqual([o.usdIncome]);
  });

  it('400: строка остатков, неизвестная колонка, другой отчёт', async () => {
    await october();
    const url = (qs: string) => `${base()}/operations?${OCTOBER}&${qs}`;
    expect(fail(await w.h.req('GET', url('report=cashflow&row=balance:start&col=total')), 400).fields).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    expect(fail(await w.h.req('GET', url('report=cashflow&row=income&col=2026-10-02')), 400).fields).toEqual({ col: 'Неизвестная колонка' });
    expect(fail(await w.h.req('GET', url('report=statement&row=income&col=total')), 400).fields).toEqual({ report: 'Неизвестный отчёт' });
    // «Чистый денежный поток» — только у «Денег», «Прибыль» — только у «Прибыли»
    expect(fail(await w.h.req('GET', url('report=cashflow&row=profit&col=total')), 400).fields).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    expect(fail(await w.h.req('GET', url('report=pnl&row=net&col=total')), 400).fields).toEqual({ row: 'Строка отчёта не раскрывается в операции' });
    expect(fail(await w.h.req('GET', `${base()}/cashflow?${OCTOBER}&stock=2`), 400).fields).toEqual({ stock: 'Склад — 0 или 1' });
  });
});

describe('остатки на начало периода и «Всего на счетах» (R2)', () => {
  it('операции и перевод в USD до периода: остаток на начало = учётный, курсовая разница по счёту в тенге = 0, остаток на конец = «Всего на счетах»', async () => {
    w = await opsWorld(); // сегодня 2026-10-06, курс USD 475,12 от 2026-10-01
    await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { startingBalance: 100_000 });
    // до периода: доход 200 ₸ и 50 $, перевод 475,12 ₸ → 1 $ (1 октября — 2 октября)
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-01T05:00:00Z', accountId: w.kzt, amount: 20_000 });
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: w.usd, amount: 5000 });
    await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-02T06:00:00Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100 });
    // внутри периода: доход 50 ₸ 4 октября
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-04T05:00:00Z', accountId: w.kzt, amount: 5000 });

    const accounts = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json() as { accounts: { accountId: number; balance: number }[]; total: { amount: number } };
    const ledger = (id: number) => accounts.accounts.find((a) => a.accountId === id)!.balance;
    expect(ledger(w.kzt)).toBe(77_488);
    expect(ledger(w.usd)).toBe(5100);

    const r = await report('from=2026-10-03&to=2026-10-06&step=month');
    // на начало 3 октября: KZT 100 000 + 20 000 \u2212 47 512 = 72 488; USD 51 $ × 475,12 = 24 231,12 ₸ (2 423 112)
    expect(find(r.rows, 'balance:start').values[0]).toBe(72_488 + 2_423_112);
    // период заканчивается сегодня: остаток на конец = «Всего на счетах» (неархивные счета по курсу на сегодня)
    expect(find(r.rows, 'balance:end').total).toBe(accounts.total.amount);
    expect(find(r.rows, 'balance:end').values[0]).toBe(77_488 + 2_423_112);

    const onlyKzt = await report(`from=2026-10-03&to=2026-10-06&step=month&accounts=${w.kzt}`);
    expect(find(onlyKzt.rows, 'nonop:fx').values[0]).toBe(0);
    expect(find(onlyKzt.rows, 'balance:start').values[0]).toBe(72_488);
    expect(find(onlyKzt.rows, 'balance:end').values[0]).toBe(77_488);
  });
});

describe('курсовая разница сквозь API (R9)', () => {
  it('второй курс USD внутри периода: переоценка остатка в долларах попадает в «Курсовую разницу» нужной колонки, остаток на конец = «Всего на счетах»', async () => {
    w = await opsWorld(); // сегодня 2026-10-06, курс USD 475,12 от 2026-10-01
    await w.post('/api/v1/rates/manual', { date: '2026-10-04', currency: 'USD', rate: '500' });
    // до периода: 50 $ на долларовом счёте
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: w.usd, amount: 5000 });

    // по дням 3–6 октября: курс границ — день перед границей; 475,12 до 3 октября, 500 с 4 октября
    const r = await report('from=2026-10-03&to=2026-10-06&step=day');
    const fx = find(r.rows, 'nonop:fx');
    // граница 5 октября (конец колонки 4 октября) — по курсу 4 октября: 50 $ × (500 \u2212 475,12) = 1 244 ₸
    expect(fx.values).toEqual([0, 124_400, 0, 0]);
    expect(fx.total).toBe(124_400);
    expect(find(r.rows, 'balance:start').values).toEqual([2_375_600, 2_375_600, 2_500_000, 2_500_000]);
    expect(find(r.rows, 'balance:end').values).toEqual([2_375_600, 2_500_000, 2_500_000, 2_500_000]);
    expect(find(r.rows, 'nonop').total).toBe(124_400);

    const balances = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json() as { total: { amount: number } };
    expect(find(r.rows, 'balance:end').total).toBe(balances.total.amount);

    // счёт в тенге переоценки не имеет
    const onlyKzt = await report(`from=2026-10-03&to=2026-10-06&step=day&accounts=${w.kzt}`);
    expect(find(onlyKzt.rows, 'nonop:fx').total).toBe(0);
  });
});

describe('JournalService.load (R3)', () => {
  it('чужой и несуществующий id пропускаются, порядок ids сохраняется', async () => {
    const o = await october();
    const other = await w.h.company('ТОО Другая');
    const account = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/operations`, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: account, amount: 777 })).operation.id as number;
    const db = w.h.t.db;
    const journal = createJournal({ db, balances: createLedgerBalances(db), timezone: 'Asia/Almaty' });
    expect(journal.load(w.cid, [o.income, foreign, 999_999, o.expense]).map((i) => i.id)).toEqual([o.income, o.expense]);
    expect(journal.load(w.cid, [foreign])).toEqual([]);
    expect(journal.load(w.cid, [])).toEqual([]);
  });
});

describe('ошибки параметров: 400 вместо 500', () => {
  it('неверные даты периода дают 400 с полем на обоих маршрутах, без лишних ошибок периода', async () => {
    w = await opsWorld();
    const cases: [string, Record<string, string>][] = [
      ['from=&to=2026-10-01', { from: expect.any(String) as unknown as string }],
      ['from=x&to=y', { from: expect.any(String) as unknown as string, to: expect.any(String) as unknown as string }],
      ['from=abc&to=2026-10-01', { from: expect.any(String) as unknown as string }],
    ];
    for (const [qs, fields] of cases) {
      expect(fail(await w.h.req('GET', `${base()}/cashflow?${qs}`), 400).fields).toEqual(fields);
      expect(fail(await w.h.req('GET', `${base()}/operations?report=cashflow&row=income&col=total&${qs}`), 400).fields).toEqual(fields);
    }
  });

  it('операции ячейки: чужой счёт, испорченный курсор, границы limit — 400; нет компании — 404', async () => {
    await october();
    const other = await w.h.company('ТОО Другая');
    const foreign = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    const url = (qs: string) => `${base()}/operations?report=cashflow&${OCTOBER}&row=income&col=total&${qs}`;
    expect(fail(await w.h.req('GET', url(`accounts=${foreign}`)), 400).fields).toEqual({ accounts: 'Неизвестный счёт' });
    expect(fail(await w.h.req('GET', url('cursor=%21%21')), 400).fields).toMatchObject({ cursor: expect.any(String) });
    expect(fail(await w.h.req('GET', url('limit=0')), 400).fields).toEqual({ limit: 'От 1 до 200' });
    expect(fail(await w.h.req('GET', url('limit=201')), 400).fields).toEqual({ limit: 'От 1 до 200' });
    const missing = await w.h.req('GET', `/api/v1/companies/999999/analytics/operations?report=cashflow&${OCTOBER}&row=income&col=total`);
    expect(fail(missing, 404).code).toBe('NOT_FOUND');
  });
});
