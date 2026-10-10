import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createBulkService } from '../../src/server/modules/operations/bulk';
import { createOperationsService, type OperationsService } from '../../src/server/modules/operations/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const split = (cat: number | null) => [
  { categoryId: cat, projectId: w.project, amount: 400 },
  { categoryId: cat, projectId: w.project2, amount: 600 },
];
const bulk = (body: Record<string, unknown>) => w.h.req('POST', `${w.ops}/bulk`, body);
const ok = async (body: Record<string, unknown>) => {
  const res = await bulk(body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { changed: number[]; skipped: { id: number; reason: string }[] };
};
const getOp = async (id: number) => (await w.h.req('GET', `${w.ops}/${id}`)).json().operation;
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('массовые действия: POST /companies/:cid/operations/bulk (§7)', () => {
  it('«Категория»: меняет единственную строку; пропускает переводы, разбитые, другой вид, удалённые и чужие — с причинами', async () => {
    w = await opsWorld();
    const single = await op({ lines: [{ projectId: w.project, amount: 1000 }] });
    const income = await op({ type: 'income' });
    const splitOp = await op({ lines: split(null) });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const gone = await op({});
    await w.h.req('DELETE', `${w.ops}/${gone}`);
    const before = w.h.auditCount('operation', 'update');

    const r = await ok({ action: 'setCategory', categoryId: w.expense, ids: [single, income, splitOp, tr, gone, 999999, single] });
    expect(r.changed).toEqual([single]);
    expect(r.skipped).toEqual([
      { id: income, reason: 'Категория расходов не подходит для дохода' },
      { id: splitOp, reason: 'Разбитая операция — измените её в форме' },
      { id: tr, reason: 'У перевода нет категории' },
      { id: gone, reason: 'Операция удалена' },
      { id: 999999, reason: 'Операция не найдена' },
    ]);
    expect(await getOp(single)).toMatchObject({ version: 2, lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    expect((await getOp(income)).version).toBe(1);
    expect(w.h.auditCount('operation', 'update')).toBe(before + 1);

    // повтор — значение уже такое: операция в changed, версия и история не меняются
    expect(await ok({ action: 'setCategory', categoryId: w.expense, ids: [single] })).toEqual({ changed: [single], skipped: [] });
    expect((await getOp(single)).version).toBe(2);
    expect(w.h.auditCount('operation', 'update')).toBe(before + 1);
  });

  it('«Проект»: меняет единственную строку, переводу без строк создаёт строку, разбитые пропускает', async () => {
    w = await opsWorld();
    const single = await op({ lines: [{ categoryId: w.expense, amount: 1000 }] });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const splitOp = await op({ lines: split(w.expense) });
    const r = await ok({ action: 'setProject', projectId: w.project2, ids: [single, tr, splitOp] });
    expect(r).toEqual({ changed: [single, tr], skipped: [{ id: splitOp, reason: 'Разбитая операция — измените её в форме' }] });
    expect((await getOp(single)).lines).toMatchObject([{ categoryId: w.expense, projectId: w.project2, amount: 1000 }]);
    expect(await getOp(tr)).toMatchObject({ version: 2, lines: [{ categoryId: null, projectId: w.project2, amount: 47512, baseAmount: 47512 }] });
  });

  it('«Контрагент»: доходы и расходы, в том числе разбитые; переводы пропускаются', async () => {
    w = await opsWorld();
    const exp = await op({});
    const inc = await op({ type: 'income' });
    const splitOp = await op({ lines: split(w.expense) });
    const tr = await op({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const r = await ok({ action: 'setCounterparty', counterpartyId: w.counterparty, ids: [exp, inc, splitOp, tr] });
    expect(r).toEqual({ changed: [exp, inc, splitOp], skipped: [{ id: tr, reason: 'У перевода нет контрагента' }] });
    for (const id of [exp, inc, splitOp]) expect((await getOp(id)).counterpartyId).toBe(w.counterparty);
  });

  it('«Удалить» пропускает операции на архивном счёте и уже удалённые; «Отменить» возвращает только удалённые этим действием', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const locked = await op({ type: 'income', accountId: safe, amount: 100 });
    await op({ accountId: safe, amount: 100, paidAt: '2026-10-02T11:00:00Z' }); // баланс сейфа снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    const a = await op({});
    const b = await op({});
    await w.h.req('DELETE', `${w.ops}/${b}`);

    const del = await ok({ action: 'delete', ids: [a, b, locked] });
    expect(del).toEqual({
      changed: [a],
      skipped: [
        { id: b, reason: 'Операция уже удалена' },
        { id: locked, reason: 'Операция затрагивает счёт «Сейф» в архиве — удалить её нельзя' },
      ],
    });
    expect((await getOp(a)).deletedAt).not.toBeNull();
    expect((await getOp(b)).version).toBe(2); // удалена раньше — версия не выросла второй раз
    expect(w.h.auditCount('operation', 'delete')).toBe(2);

    // «Отменить» шлёт changed из ответа; неудалённая операция в списке пропускается
    const back = await ok({ action: 'restore', ids: [...del.changed, locked] });
    expect(back).toEqual({ changed: [a], skipped: [{ id: locked, reason: 'Операция не удалена' }] });
    expect(await getOp(a)).toMatchObject({ deletedAt: null, version: 3 });
    expect((await getOp(b)).deletedAt).not.toBeNull();
  });

  it('«Отменить» после массового удаления не возвращает операцию, которую раньше удалил другой пользователь', async () => {
    w = await opsWorld();
    const x = await op({});
    const y = await op({});
    await seedUser(w.h.t, 'buh', 'buh-password-1');
    const cookie = await loginAs(w.h.t, 'buh', 'buh-password-1');
    expect((await w.h.t.app.inject({ method: 'DELETE', url: `${w.ops}/${x}`, headers: { ...ORIGIN_HEADERS, cookie } })).statusCode).toBe(200);

    const del = await ok({ action: 'delete', ids: [x, y] });
    expect(del).toEqual({ changed: [y], skipped: [{ id: x, reason: 'Операция уже удалена' }] });
    expect(await ok({ action: 'restore', ids: del.changed })).toEqual({ changed: [y], skipped: [] });
    expect((await getOp(x)).deletedAt).not.toBeNull();
    expect((await getOp(y)).deletedAt).toBeNull();
  });

  it('операция другой компании в списке — пропуск «Операция не найдена», у себя она не меняется', async () => {
    w = await opsWorld();
    const mine = await op({});
    const other = await w.h.company('Другая');
    const acc = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужая касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const foreignOp = (await w.post(`/api/v1/companies/${other}/operations`, { type: 'expense', paidAt: '2026-10-02T10:00:00Z', accountId: acc, amount: 100 }))
      .operation.id as number;
    for (const body of [{ action: 'setCounterparty', counterpartyId: w.counterparty }, { action: 'delete' }, { action: 'restore' }]) {
      expect(await ok({ ...body, ids: [mine, foreignOp] })).toEqual({ changed: [mine], skipped: [{ id: foreignOp, reason: 'Операция не найдена' }] });
    }
    const theirs = (await w.h.req('GET', `/api/v1/companies/${other}/operations/${foreignOp}`)).json().operation;
    expect(theirs).toMatchObject({ counterpartyId: null, deletedAt: null, version: 1 });
  });

  it('«Отменить» пропускает операцию на архивном счёте и нарушившую инвариант 6 после сдвига даты открытия', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const x = await op({ type: 'income', accountId: safe, amount: 50 });
    const y = await op({ accountId: safe, amount: 50, paidAt: '2026-10-02T11:00:00Z' });
    const kaspi = (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const early = await op({ type: 'income', accountId: kaspi, amount: 10 });
    const fine = await op({});
    expect((await ok({ action: 'delete', ids: [x, y, early, fine] })).changed).toEqual([x, y, early, fine]);
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect((await w.h.req('PATCH', `${accountsUrl()}/${kaspi}`, { openedAt: '2026-10-04' })).statusCode).toBe(200);

    const r = await ok({ action: 'restore', ids: [x, early, fine] });
    expect(r.changed).toEqual([fine]);
    expect(r.skipped).toEqual([
      { id: x, reason: 'Счёт «Сейф» в архиве — сначала верните его из архива' },
      { id: early, reason: 'Счёт «Kaspi» открыт 04.10.2026 — операция не может быть раньше' },
    ]);
  });

  it('выбранный элемент в архиве или из другой компании, архивная компания, пустой список — отказ всего запроса, ничего не меняется', async () => {
    w = await opsWorld();
    const a = await op({});
    const cats = `/api/v1/companies/${w.cid}/categories`;
    const old = (await w.post(cats, { kind: 'expense', name: 'Старая' })).category.id;
    await w.post(`${cats}/${old}/archive`, {});
    expect(fail(await bulk({ action: 'setCategory', categoryId: old, ids: [a] }), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Категория «Старая» в архиве — выберите другую',
    );
    const other = await w.h.company('Другая');
    const foreign = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id;
    fail(await bulk({ action: 'setProject', projectId: foreign, ids: [a] }), 422, 'INVARIANT_5');
    expect((await getOp(a)).version).toBe(1);

    await w.post(`/api/v1/companies/${other}/archive`, {});
    fail(await w.h.req('POST', `/api/v1/companies/${other}/operations/bulk`, { action: 'delete', ids: [a] }), 422, 'ARCHIVED_REFERENCE');
    fail(await bulk({ action: 'delete', ids: [] }), 400, 'VALIDATION');
    fail(await bulk({ action: 'rename', ids: [a] }), 400, 'VALIDATION');
    fail(await bulk({ action: 'delete', ids: Array.from({ length: 501 }, (_, i) => i + 1) }), 400, 'VALIDATION');
  });

  it('непредвиденный сбой посередине откатывает весь запрос — и уже применённые операции, и историю (Review Focus 4)', async () => {
    w = await opsWorld();
    const a = await op({});
    const b = await op({});
    const db = w.h.t.db;
    const audit = createAuditService(db);
    const real = createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => new Date('2026-10-06T12:00:00.000Z') });
    let calls = 0;
    const flaky: OperationsService = {
      ...real,
      update: (...args) => {
        if (++calls === 2) throw new Error('диск отвалился');
        return real.update(...args);
      },
    };
    const before = w.h.auditCount('operation', 'update');
    expect(() => createBulkService({ db, operations: flaky }).run(w.cid, { action: 'setCounterparty', counterpartyId: w.counterparty, ids: [a, b] }, 1)).toThrow(
      'диск отвалился',
    );
    expect(await getOp(a)).toMatchObject({ counterpartyId: null, version: 1 });
    expect(w.h.auditCount('operation', 'update')).toBe(before);
  });
});
