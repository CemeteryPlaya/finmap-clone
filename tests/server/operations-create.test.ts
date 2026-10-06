import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const create = (body: object) => w.h.req('POST', w.ops, body);
const opCount = () => (w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;

describe('operations: создание', () => {
  it('доход в базовой валюте: строка по умолчанию, курс 1, версия 1, теги без повторов, история', async () => {
    w = await opsWorld();
    const res = await create({
      type: 'income',
      paidAt: '2026-10-05T10:00:00+05:00',
      accountId: w.kzt,
      amount: 150000,
      counterpartyId: w.counterparty,
      tagIds: [w.tag, w.tag],
      comment: '  смена  ',
    });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op).toMatchObject({
      type: 'income',
      status: 'actual',
      paidAt: '2026-10-05T05:00:00.000Z',
      amount: 150000,
      rate: '1',
      baseAmount: 150000,
      version: 1,
      deletedAt: null,
      comment: 'смена',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      lines: [{ position: 0, categoryId: null, projectId: null, amount: 150000, baseAmount: 150000 }],
    });
    expect(w.h.auditCount('operation', 'create')).toBe(1);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation).toEqual(op);
  });

  it('расход в USD при базовой KZT: курс на дату, baseAmount, распределение по строкам наибольшим остатком', async () => {
    w = await opsWorld();
    const res = await create({
      type: 'expense',
      paidAt: '2026-10-03T10:00:00Z',
      accountId: w.usd,
      amount: 100,
      lines: [
        { categoryId: w.expense, projectId: w.project, amount: 33 },
        { categoryId: w.expense, projectId: w.project2, amount: 33 },
        { categoryId: w.expense, amount: 34 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    expect(op.lines.map((l: { baseAmount: number }) => l.baseAmount)).toEqual([15679, 15679, 16154]);
  });

  it('нет курса на дату — 422 RATE_UNAVAILABLE, операция не создаётся (Review Focus 1)', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const before = opCount();
    const err = fail(await create({ type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.usd, amount: 100 }), 422, 'RATE_UNAVAILABLE');
    expect(err.message).toBe('Нет курса USD на 09.10.2026');
    expect(opCount()).toBe(before);
  });

  it('инвариант 1: сумма строк не равна сумме операции', async () => {
    w = await opsWorld();
    fail(
      await create({
        type: 'expense',
        paidAt: '2026-10-05T10:00:00Z',
        accountId: w.kzt,
        amount: 100,
        lines: [
          { categoryId: w.expense, amount: 60 },
          { categoryId: w.expense, amount: 30 },
        ],
      }),
      422,
      'INVARIANT_1',
    );
  });

  it('инвариант 3: статья другого вида; статья у перевода', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    fail(await create({ type: 'income', paidAt, accountId: w.kzt, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] }), 422, 'INVARIANT_3');
    fail(
      await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100, lines: [{ categoryId: w.expense, projectId: w.project, amount: 47512 }] }),
      422,
      'INVARIANT_3',
    );
  });

  it('инвариант 4: перевод на тот же счёт; при одной валюте суммы равны; при разных нужна сумма зачисления', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    const kaspi = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.kzt, amount: 100 }), 422, 'INVARIANT_4');
    fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: kaspi, amount: 100, toAmount: 90 }), 422, 'INVARIANT_4');
    const same = await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: kaspi, amount: 100 });
    expect(same.json().operation).toMatchObject({ toAmount: 100, lines: [] });
    const noTo = fail(await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 100 }), 400, 'VALIDATION');
    expect(noTo.fields?.toAmount).toBe('Укажите сумму зачисления');
  });

  it('инвариант 5: счёт, статья, проект, контрагент и тег другой компании — 422 с полем', async () => {
    w = await opsWorld();
    const other = await w.h.company('Чужая');
    const ob = `/api/v1/companies/${other}`;
    const acc = (await w.post(`${ob}/accounts`, { name: 'Чужой', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const cat = (await w.post(`${ob}/categories`, { kind: 'expense', name: 'Чужая' })).category.id;
    const prj = (await w.post(`${ob}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id;
    const cp = (await w.post(`${ob}/counterparties`, { type: 'client', name: 'Чужой' })).counterparty.id;
    const tg = (await w.post(`${ob}/tags`, { name: 'Чужой' })).tag.id;
    const base = { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    expect(fail(await create({ ...base, accountId: acc }), 422, 'INVARIANT_5').fields).toHaveProperty('accountId');
    expect(fail(await create({ ...base, lines: [{ categoryId: cat, amount: 100 }] }), 422, 'INVARIANT_5').fields).toHaveProperty('lines');
    expect(fail(await create({ ...base, lines: [{ projectId: prj, amount: 100 }] }), 422, 'INVARIANT_5').fields).toHaveProperty('lines');
    expect(fail(await create({ ...base, counterpartyId: cp }), 422, 'INVARIANT_5').fields).toHaveProperty('counterpartyId');
    expect(fail(await create({ ...base, tagIds: [tg] }), 422, 'INVARIANT_5').fields).toHaveProperty('tagIds');
  });

  it('инвариант 6: граница суток по Алматы и дата раньше открытия счёта', async () => {
    w = await opsWorld(); // сейчас 2026-10-06 17:00 по Алматы
    const base = { type: 'income', accountId: w.kzt, amount: 100 };
    expect((await create({ ...base, paidAt: '2026-10-06T18:59:00Z' })).statusCode).toBe(201); // 23:59 сегодня
    fail(await create({ ...base, paidAt: '2026-10-06T19:30:00Z' }), 422, 'INVARIANT_6'); // 00:30 завтра
    const early = fail(await create({ ...base, paidAt: '2026-09-30T10:00:00Z' }), 422, 'INVARIANT_6');
    expect(early.message).toBe('Счёт «Касса» открыт 01.10.2026 — операция не может быть раньше');
  });

  it('инвариант 7: новый выбор архивного счёта, статьи, проекта, контрагента, тега', async () => {
    w = await opsWorld();
    const b = `/api/v1/companies/${w.cid}`;
    const safe = (await w.post(`${b}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const store = (await w.post(`${b}/projects`, { name: 'Склад', templateKey: 'general' })).project.id;
    await w.post(`${b}/accounts/${safe}/archive`, {});
    await w.post(`${b}/categories/${w.expense}/archive`, {});
    await w.post(`${b}/projects/${store}/archive`, {});
    await w.post(`${b}/counterparties/${w.counterparty}/archive`, {});
    await w.post(`${b}/tags/${w.tag}/archive`, {});
    const base = { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    for (const body of [
      { ...base, accountId: safe },
      { ...base, lines: [{ categoryId: w.expense, amount: 100 }] },
      { ...base, lines: [{ projectId: store, amount: 100 }] },
      { ...base, counterpartyId: w.counterparty },
      { ...base, tagIds: [w.tag] },
    ]) {
      fail(await create(body), 422, 'ARCHIVED_REFERENCE');
    }
  });

  it('перевод KZT → USD: сумма зачисления, одна строка с проектом, без контрагента', async () => {
    w = await opsWorld();
    const paidAt = '2026-10-05T10:00:00Z';
    const res = await create({ type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100, lines: [{ projectId: w.project, amount: 47512 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().operation).toMatchObject({ toAccountId: w.usd, toAmount: 100, rate: '1', baseAmount: 47512, lines: [{ categoryId: null, projectId: w.project, amount: 47512, baseAmount: 47512 }] });
    const tr = { type: 'transfer', paidAt, accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 };
    expect(fail(await create({ ...tr, lines: [{ projectId: w.project, amount: 40000 }, { projectId: w.project2, amount: 7512 }] }), 400, 'VALIDATION').fields?.lines).toBe(
      'У перевода — не больше одной строки, с проектом',
    );
    expect(fail(await create({ ...tr, lines: [{ amount: 47512 }] }), 400, 'VALIDATION').fields?.lines).toBe('В строке перевода укажите проект');
    expect(fail(await create({ ...tr, counterpartyId: w.counterparty }), 400, 'VALIDATION').fields?.counterpartyId).toBe('У перевода нет контрагента');
    expect(fail(await create({ type: 'income', paidAt, accountId: w.kzt, amount: 100, toAccountId: w.usd }), 400, 'VALIDATION').fields?.toAccountId).toBe(
      'Счёт зачисления — только у перевода',
    );
  });

  it('проверка тела: дата без часового пояса и несуществующая дата, нулевая и дробная сумма, неизвестный тип — 400; чужая компания — 404', async () => {
    w = await opsWorld();
    const base = { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 };
    for (const body of [
      { ...base, paidAt: '2026-10-05T10:00:00' },
      { ...base, paidAt: '2026-09-31T10:00:00Z' },
      { ...base, amount: 0 },
      { ...base, amount: 1.5 },
      { ...base, type: 'gift' },
    ]) {
      expect((await create(body)).statusCode).toBe(400);
    }
    const op = (await create(base)).json().operation;
    const other = await w.h.company('Другая');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/operations/${op.id}`)).statusCode).toBe(404);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/operations`, base)).statusCode).toBe(422); // счёт чужой — инвариант 5
  });
});
