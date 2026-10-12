import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string };
};
const create = async (body: object) => {
  const res = await w.h.req('POST', w.ops, body);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().operation as { id: number; version: number; [k: string]: any };
};
const patch = (id: number, body: object) => w.h.req('PATCH', `${w.ops}/${id}`, body);
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('operations: правка, удаление, восстановление', () => {
  it('версия: устаревшая правка — 409; правка без изменений не меняет версию и не пишет историю', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    const v2 = await patch(op.id, { version: 1, comment: 'а' });
    expect(v2.json().operation).toMatchObject({ comment: 'а', version: 2 });
    expect(fail(await patch(op.id, { version: 1, comment: 'б' }), 409, 'VERSION_CONFLICT').message).toBe('Операция изменена другим пользователем');
    expect((await patch(op.id, { version: 2, comment: ' а ' })).json().operation.version).toBe(2);
    expect(w.h.auditCount('operation', 'update')).toBe(1);
  });

  it('пересчёт: правка комментария после смены курса не меняет rate и baseAmount, правка суммы — пересчитывает (Review Focus 2)', async () => {
    w = await opsWorld();
    const op = await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] });
    expect(op).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    const rateId = (await w.h.req('GET', '/api/v1/rates/manual')).json().rates[0].id;
    await w.h.req('PATCH', `/api/v1/rates/manual/${rateId}`, { rate: '480' });
    const c = (await patch(op.id, { version: 1, comment: 'аренда' })).json().operation;
    expect(c).toMatchObject({ rate: '475.12', baseAmount: 47512, version: 2 });
    const a = (await patch(op.id, { version: 2, amount: 200 })).json().operation;
    expect(a).toMatchObject({ rate: '480', baseAmount: 96000, amount: 200, lines: [{ categoryId: w.expense, amount: 200, baseAmount: 96000 }] });
  });

  it('строки: новое разбиение перераспределяет baseAmount; новая сумма при нескольких строках без строк — INVARIANT_1', async () => {
    w = await opsWorld();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 100,
      lines: [
        { projectId: w.project, amount: 50 },
        { projectId: w.project2, amount: 50 },
      ],
    });
    fail(await patch(op.id, { version: 1, amount: 120 }), 422, 'INVARIANT_1');
    const res = (
      await patch(op.id, {
        version: 1,
        lines: [
          { projectId: w.project, amount: 70 },
          { projectId: w.project2, amount: 30 },
        ],
      })
    ).json().operation;
    expect(res.lines.map((l: { baseAmount: number }) => l.baseAmount)).toEqual([70, 30]);
  });

  it('операция на архивном счёте: сумма, дата и счета заблокированы, удалить нельзя, комментарий и дата сделки меняются (Review Focus 3)', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const inc = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 }); // баланс снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    for (const body of [{ amount: 50 }, { paidAt: '2026-10-04T10:00:00Z' }, { accountId: w.kzt }]) {
      fail(await patch(inc.id, { version: 1, ...body }), 422, 'ARCHIVED_REFERENCE');
    }
    const ok = (await patch(inc.id, { version: 1, comment: 'сверка', accrualDate: '2026-09-01' })).json().operation;
    expect(ok).toMatchObject({ comment: 'сверка', accrualDate: '2026-09-01', amount: 100 });
    expect(fail(await w.h.req('DELETE', `${w.ops}/${inc.id}`), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Операция затрагивает счёт «Сейф» в архиве — удалить её нельзя',
    );
  });

  it('удаление мягкое, версия растёт, история; правка удалённой — 409; восстановление возвращает', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    const del = (await w.h.req('DELETE', `${w.ops}/${op.id}`)).json().operation;
    expect(del.deletedAt).not.toBeNull();
    expect(del.version).toBe(2);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.deletedAt).not.toBeNull();
    expect(fail(await patch(op.id, { version: 2, comment: 'x' }), 409, 'VERSION_CONFLICT').message).toBe('Операция удалена — обновите страницу');
    const back = (await w.h.req('POST', `${w.ops}/${op.id}/restore`)).json().operation;
    expect(back).toMatchObject({ deletedAt: null, version: 3 });
    expect(w.h.auditCount('operation', 'delete')).toBe(1);
    expect(w.h.auditCount('operation', 'restore')).toBe(1);
  });

  it('восстановление: архивная категория не мешает, архивный счёт мешает, openedAt позже даты операции — INVARIANT_6 (Review Focus 4)', async () => {
    w = await opsWorld();
    // архивная категория — восстановление проходит (инвариант 11)
    const withCat = await create({ type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100, lines: [{ categoryId: w.expense, amount: 100 }] });
    await w.h.req('DELETE', `${w.ops}/${withCat.id}`);
    await w.post(`/api/v1/companies/${w.cid}/categories/${w.expense}/archive`, {});
    expect((await w.h.req('POST', `${w.ops}/${withCat.id}/restore`)).json().operation.deletedAt).toBeNull();

    // архивный счёт — нельзя
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const x = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 50 });
    const y = await create({ type: 'expense', paidAt: '2026-10-02T11:00:00Z', accountId: safe, amount: 50 });
    await w.h.req('DELETE', `${w.ops}/${x.id}`);
    await w.h.req('DELETE', `${w.ops}/${y.id}`);
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect(fail(await w.h.req('POST', `${w.ops}/${x.id}/restore`), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Счёт «Сейф» в архиве — сначала верните его из архива',
    );

    // дата открытия сдвинута позже даты удалённой операции
    const kaspi = (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const early = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: kaspi, amount: 10 });
    await w.h.req('DELETE', `${w.ops}/${early.id}`);
    expect((await w.h.req('PATCH', `${accountsUrl()}/${kaspi}`, { openedAt: '2026-10-04' })).statusCode).toBe(200);
    fail(await w.h.req('POST', `${w.ops}/${early.id}/restore`), 422, 'INVARIANT_6');
  });

  it('перевод: те же сумма и счета в PATCH не сбрасывают сумму зачисления — и на архивном счёте, и между валютами', async () => {
    w = await opsWorld();
    // KZT → USD: сумма зачисления задана явно, PATCH с той же суммой и комментарием
    const fx = await create({ type: 'transfer', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    const fxRes = await patch(fx.id, { version: 1, amount: 47512, accountId: w.kzt, toAccountId: w.usd, comment: 'обмен' });
    expect(fxRes.statusCode).toBe(200);
    expect(fxRes.json().operation).toMatchObject({ toAmount: 100, comment: 'обмен', baseAmount: 47512 });

    // перевод со счёта, ушедшего в архив: те же значения в PATCH — не правка суммы и счетов
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    const tr = await create({ type: 'transfer', paidAt: '2026-10-03T10:00:00Z', accountId: safe, toAccountId: w.kzt, amount: 100 });
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    const same = await patch(tr.id, { version: 1, amount: 100, accountId: safe, toAccountId: w.kzt, comment: 'сверка' });
    expect(same.statusCode).toBe(200);
    expect(same.json().operation).toMatchObject({ toAmount: 100, comment: 'сверка' });
    fail(await patch(tr.id, { version: 2, amount: 90 }), 422, 'ARCHIVED_REFERENCE');

    // перевод между валютами с архивного счёта: новая сумма без суммы зачисления — всё равно ARCHIVED_REFERENCE, а не ошибка поля
    const usdSafe = (await w.post(accountsUrl(), { name: 'Сейф USD', currency: 'USD', openedAt: '2026-10-01' })).account.id;
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: usdSafe, amount: 100 });
    const fxOut = await create({ type: 'transfer', paidAt: '2026-10-03T10:00:00Z', accountId: usdSafe, toAccountId: w.kzt, amount: 100, toAmount: 47512 });
    await w.post(`${accountsUrl()}/${usdSafe}/archive`, {});
    fail(await patch(fxOut.id, { version: 1, amount: 50 }), 422, 'ARCHIVED_REFERENCE');
  });

  it('новый выбор архивного при правке запрещён, уже выбранный архивный остаётся', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100, counterpartyId: w.counterparty });
    await w.post(`/api/v1/companies/${w.cid}/counterparties/${w.counterparty}/archive`, {});
    expect((await patch(op.id, { version: 1, comment: 'с архивным контрагентом' })).statusCode).toBe(200);
    await w.post(`/api/v1/companies/${w.cid}/tags/${w.tag}/archive`, {});
    fail(await patch(op.id, { version: 2, tagIds: [w.tag] }), 422, 'ARCHIVED_REFERENCE');
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
/** Отказ с текстами у полей: статус, код и поля ответа. */
const refused = (res: LightMyRequestResponse, status: number, code: string, fields: Record<string, string>) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error).toMatchObject({ code, fields });
};

describe('«Изменить в перевод»: PATCH с type: transfer (§10.1 этапа 1.5)', () => {
  const addKaspi = async () => (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
  const balances = async () => {
    const list = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json().accounts as { accountId: number; balance: number }[];
    return Object.fromEntries(list.map((a) => [a.accountId, a.balance]));
  };

  it('расход → перевод в одной валюте: счёт зачисления и сумма зачисления; проект строки, теги, комментарий, id и вложения остаются; балансы обоих счетов (Review Focus 5)', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 5000,
      counterpartyId: w.counterparty,
      comment: 'в Kaspi',
      tagIds: [w.tag],
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 5000 }],
    });
    const upload = await w.h.t.app.inject({
      method: 'POST',
      url: `${w.ops}/${op.id}/attachments`,
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('чек.png') },
      payload: PNG,
    });
    expect(upload.statusCode).toBe(201);
    expect(await balances()).toMatchObject({ [w.kzt]: -5000, [kaspi]: 0 });

    const res = await patch(op.id, { version: 1, type: 'transfer', toAccountId: kaspi, counterpartyId: null, lines: [{ categoryId: null, projectId: w.project, amount: 5000 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().operation).toMatchObject({
      id: op.id,
      type: 'transfer',
      version: 2,
      accountId: w.kzt,
      amount: 5000,
      toAccountId: kaspi,
      toAmount: 5000,
      counterpartyId: null,
      comment: 'в Kaspi',
      tagIds: [w.tag],
      rate: '1',
      baseAmount: 5000,
      lines: [{ categoryId: null, projectId: w.project, amount: 5000, baseAmount: 5000 }],
    });
    expect((await w.h.req('GET', `${w.ops}/${op.id}/attachments`)).json().attachments).toHaveLength(1);
    expect(await balances()).toMatchObject({ [w.kzt]: -5000, [kaspi]: 5000 });
  });

  it('доход → перевод: прежний счёт — счёт зачисления; в одной валюте и между валютами; курс и база — по стороне списания', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const same = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: kaspi, amount: 7000, lines: [{ categoryId: w.income, amount: 7000 }] });
    const r1 = await patch(same.id, { version: 1, type: 'transfer', accountId: w.kzt, toAccountId: kaspi, lines: [] });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json().operation).toMatchObject({ type: 'transfer', accountId: w.kzt, toAccountId: kaspi, amount: 7000, toAmount: 7000, lines: [] });

    const fx = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.usd, amount: 100, lines: [{ categoryId: w.income, amount: 100 }] });
    expect(fx).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    const r2 = await patch(fx.id, { version: 1, type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, lines: [] });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json().operation).toMatchObject({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, rate: '1', baseAmount: 47512, lines: [] });
    expect(await balances()).toMatchObject({ [w.kzt]: -54512, [kaspi]: 7000, [w.usd]: 100 });
  });

  it('отказы: без счёта зачисления, с контрагентом, с категорией, с датой сделки, между валютами без суммы зачисления, тип не «Перевод» — операция не меняется', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accrualDate: '2026-09-01',
      accountId: w.kzt,
      amount: 5000,
      counterpartyId: w.counterparty,
      lines: [{ categoryId: w.expense, amount: 5000 }],
    });
    const full: Record<string, unknown> = { version: 1, type: 'transfer', toAccountId: kaspi, counterpartyId: null, accrualDate: null, lines: [] };
    const without = (key: string) => Object.fromEntries(Object.entries(full).filter(([k]) => k !== key));
    refused(await patch(op.id, without('toAccountId')), 400, 'VALIDATION', { toAccountId: 'Выберите счёт зачисления' });
    refused(await patch(op.id, without('counterpartyId')), 400, 'VALIDATION', { counterpartyId: 'У перевода нет контрагента' });
    refused(await patch(op.id, without('lines')), 422, 'INVARIANT_3', { lines: 'У перевода нет категории' });
    refused(await patch(op.id, without('accrualDate')), 400, 'VALIDATION', { accrualDate: 'У перевода нет даты сделки' });
    refused(await patch(op.id, { ...full, type: 'income' }), 400, 'VALIDATION', { type: 'Тип можно сменить только на «Перевод»' });
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation).toMatchObject({ type: 'expense', version: 1, counterpartyId: w.counterparty, accrualDate: '2026-09-01' });
    expect(w.h.auditCount('operation', 'update')).toBe(0);

    const fx = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.usd, amount: 100 });
    refused(await patch(fx.id, { version: 1, type: 'transfer', accountId: w.kzt, toAccountId: w.usd, lines: [] }), 400, 'VALIDATION', { toAmount: 'Укажите сумму зачисления' });
  });

  it('перевод обратно в расход не превращается: type: expense — 400 у поля type, перевод не меняется', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const tr = await create({ type: 'transfer', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, toAccountId: kaspi, amount: 5000 });
    refused(await patch(tr.id, { version: 1, type: 'expense' }), 400, 'VALIDATION', { type: 'Тип можно сменить только на «Перевод»' });
    expect((await w.h.req('GET', `${w.ops}/${tr.id}`)).json().operation).toMatchObject({ type: 'transfer', version: 1, toAccountId: kaspi, toAmount: 5000 });
    expect(w.h.auditCount('operation', 'update')).toBe(0);
  });

  it('операция на архивном счёте: тип менять нельзя — ARCHIVED_REFERENCE со своим текстом (Review Focus 3)', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    const exp = await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 }); // баланс снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect(fail(await patch(exp.id, { version: 1, type: 'transfer', toAccountId: w.kzt, lines: [] }), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Операция затрагивает счёт «Сейф» в архиве — тип менять нельзя',
    );
  });

  it('версия: устаревшая — 409; уже перевод: type: transfer ничего не меняет; история — before.type / after.type (Review Focus 4)', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({ type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 5000, counterpartyId: w.counterparty });
    expect((await patch(op.id, { version: 1, comment: 'раньше' })).statusCode).toBe(200);
    const body = { type: 'transfer', toAccountId: kaspi, counterpartyId: null, lines: [] };
    expect(fail(await patch(op.id, { version: 1, ...body }), 409, 'VERSION_CONFLICT').message).toBe('Операция изменена другим пользователем');
    expect((await patch(op.id, { version: 2, ...body })).statusCode).toBe(200);
    const same = await patch(op.id, { version: 3, type: 'transfer' });
    expect(same.json().operation).toMatchObject({ type: 'transfer', version: 3 });
    expect(w.h.auditCount('operation', 'update')).toBe(2);

    const [last] = (await w.h.req('GET', `/api/v1/companies/${w.cid}/audit?entity=operation&limit=20`)).json().entries as { action: string; diff: Record<string, unknown> }[];
    expect(last!.action).toBe('update');
    expect(last!.diff).toMatchObject({
      type: 'transfer',
      before: { type: 'expense', toAccountId: null, toAmount: null, counterpartyId: w.counterparty },
      after: { type: 'transfer', toAccountId: kaspi, toAmount: 5000, counterpartyId: null, lines: [] },
      recalculated: { rate: ['1', '1'], baseAmount: [5000, 5000] },
    });
  });
});
