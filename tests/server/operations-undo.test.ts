import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCascadeSize } from '../../src/server/modules/operations/undo';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { stockWorld } from '../helpers/stock';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Entry {
  id: number;
  entity: string;
  entityId: number | null;
  action: string;
  diff: Record<string, unknown> | null;
  undoneBy: number | null;
  undoable: boolean;
}

const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string };
};
const auditUrl = () => `/api/v1/companies/${w.cid}/audit`;
/** Лента действий с операциями, новые сверху. */
const feed = async () => (await w.h.req('GET', `${auditUrl()}?entity=operation`)).json().entries as Entry[];
const entry = async (id: number) => (await feed()).find((e) => e.id === id)!;
/** id записей истории операции по действию, по порядку записи. */
const ids = async (opId: number, action: string) =>
  (await feed())
    .filter((e) => e.entityId === opId && e.action === action)
    .map((e) => e.id)
    .reverse();
const previewRes = (id: number) => w.h.req('GET', `${auditUrl()}/${id}/undo`);
const preview = async (id: number) => {
  const res = await previewRes(id);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entries as { id: number; action: string; type: string | null; at: string; userName: string | null }[];
};
const undoRes = (id: number, list: number[]) => w.h.req('POST', `${auditUrl()}/${id}/undo`, { ids: list });
/** Отмена с подтверждённым предпросмотром — как в окне подтверждения. */
const undo = async (id: number) => {
  const list = (await preview(id)).map((e) => e.id);
  const res = await undoRes(id, list);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { undone: number[]; undoId: number; operation: { id: number; deleted: boolean } };
};
const getOp = async (id: number) => (await w.h.req('GET', `${w.ops}/${id}`)).json().operation;
const create = async (extra: object = {}) =>
  (
    await w.post(w.ops, {
      type: 'expense',
      paidAt: '2026-10-05T06:00:00Z',
      accountId: w.kzt,
      amount: 1_000_000,
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 1_000_000 }],
      ...extra,
    })
  ).operation as { id: number; version: number };
const patch = async (id: number, body: object) => {
  const res = await w.h.req('PATCH', `${w.ops}/${id}`, { version: (await getOp(id)).version, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().operation;
};
const del = async (id: number) => expect((await w.h.req('DELETE', `${w.ops}/${id}`)).statusCode).toBe(200);
const restore = async (id: number) => expect((await w.h.req('POST', `${w.ops}/${id}/restore`)).statusCode).toBe(200);
const undoMarks = () => (w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM audit_undo').get() as { n: number }).n;

describe('отмена действий с операциями (план 2026-10-20, задача 2)', () => {
  it('отмена правки: поля «было», одна запись «Отмена», без новых правок', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { amount: 1_500_000, comment: 'Клуб 2' });
    const [u] = await ids(op.id, 'update');
    expect(await preview(u!)).toEqual([{ id: u, action: 'update', type: 'expense', at: expect.any(String), userName: 'Тест' }]);
    const r = await undo(u!);
    expect(r.undone).toEqual([u]);
    expect(r.operation).toEqual({ id: op.id, deleted: false });
    const after = await getOp(op.id);
    expect(after).toMatchObject({ amount: 1_000_000, comment: null, version: 3, deletedAt: null });
    expect(after.lines[0]).toMatchObject({ amount: 1_000_000, baseAmount: 1_000_000 });
    expect(w.h.auditCount('operation', 'update')).toBe(1);
    expect(w.h.auditCount('operation', 'undo')).toBe(1);
    const undone = await entry(u!);
    expect(undone.undoneBy).toBe(r.undoId);
    expect(undone.undoable).toBe(false);
    const mark = await entry(r.undoId);
    expect(mark).toMatchObject({ action: 'undo', entityId: op.id, undoable: false, undoneBy: null });
    expect(mark.diff).toEqual({ type: 'expense', undone: [{ id: u, action: 'update', type: 'expense' }], deleted: false });
    // отменённое не отменяется второй раз
    expect(fail(await previewRes(u!), 409, 'UNDO_DONE').message).toBe('Действие уже отменено');
    fail(await undoRes(u!, [u!]), 409, 'UNDO_DONE');
  });

  it('каскад: отмена первой правки отменяет и вторую, от последней к первой', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { amount: 2_000_000 });
    await patch(op.id, { comment: 'Клуб 2' });
    const [u1, u2] = await ids(op.id, 'update');
    expect((await preview(u1!)).map((e) => e.id)).toEqual([u2, u1]);
    const r = await undo(u1!);
    expect(r.undone).toEqual([u2, u1]);
    expect(await getOp(op.id)).toMatchObject({ amount: 1_000_000, comment: null });
    expect((await entry(u1!)).undoneBy).toBe(r.undoId);
    expect((await entry(u2!)).undoneBy).toBe(r.undoId);
    expect(undoMarks()).toBe(2);
  });

  it('отмена удаления восстанавливает, отмена восстановления — снова удаляет', async () => {
    w = await opsWorld();
    const op = await create();
    await del(op.id);
    const [d] = await ids(op.id, 'delete');
    expect((await undo(d!)).operation.deleted).toBe(false);
    expect((await getOp(op.id)).deletedAt).toBeNull();
    await del(op.id);
    await restore(op.id);
    const [r] = await ids(op.id, 'restore');
    expect((await undo(r!)).operation.deleted).toBe(true);
    expect((await getOp(op.id)).deletedAt).not.toBeNull();
    // обычных записей удаления и восстановления отмена не пишет
    expect(w.h.auditCount('operation', 'delete')).toBe(2);
    expect(w.h.auditCount('operation', 'restore')).toBe(1);
  });

  it('отмена добавления удаляет операцию; у её действий «Отмены» больше нет', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { comment: 'Клуб 2' });
    const [c] = await ids(op.id, 'create');
    const [u] = await ids(op.id, 'update');
    expect((await preview(c!)).map((e) => e.id)).toEqual([u, c]);
    const r = await undo(c!);
    expect(r.operation.deleted).toBe(true);
    expect((await getOp(op.id)).deletedAt).not.toBeNull();
    expect((await entry(c!)).undoable).toBe(false);
    expect((await entry(u!)).undoable).toBe(false);
    expect((await entry(r.undoId)).diff).toMatchObject({ deleted: true, undone: [{ id: u, action: 'update' }, { id: c, action: 'create' }] });
    fail(await previewRes(c!), 409, 'UNDO_DONE');
  });

  it('пока операция удалена, отменяемо только удаление; после его отмены — снова и прежние', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { amount: 2_000_000 });
    await del(op.id);
    const [c] = await ids(op.id, 'create');
    const [u] = await ids(op.id, 'update');
    const [d] = await ids(op.id, 'delete');
    expect((await entry(c!)).undoable).toBe(false);
    expect((await entry(u!)).undoable).toBe(false);
    expect((await entry(d!)).undoable).toBe(true);
    expect(fail(await previewRes(u!), 422, 'UNDO_UNSUPPORTED').message).toBe('Операция удалена — сначала отмените её удаление');
    fail(await undoRes(u!, [d!, u!]), 422, 'UNDO_UNSUPPORTED');
    await undo(d!);
    expect((await entry(c!)).undoable).toBe(true);
    expect((await entry(u!)).undoable).toBe(true);
    expect((await preview(u!)).map((e) => e.id)).toEqual([u]);
    await undo(u!);
    expect(await getOp(op.id)).toMatchObject({ amount: 1_000_000, deletedAt: null });

    // удаление, восстановление, отмена восстановления: операция снова удалена — отменяемо только удаление
    const op2 = await create();
    await del(op2.id);
    await restore(op2.id);
    const [r2] = await ids(op2.id, 'restore');
    await undo(r2!);
    const [c2] = await ids(op2.id, 'create');
    const [d2] = await ids(op2.id, 'delete');
    expect((await entry(c2!)).undoable).toBe(false);
    expect((await entry(d2!)).undoable).toBe(true);
  });

  it('каскад через удаление и восстановление: правка, удаление, восстановление, правка — отмена первой правки', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { amount: 2_000_000 });
    await del(op.id);
    await restore(op.id);
    await patch(op.id, { comment: 'Клуб 2' });
    const [u1, u2] = await ids(op.id, 'update');
    const [d] = await ids(op.id, 'delete');
    const [r] = await ids(op.id, 'restore');
    expect((await preview(u1!)).map((e) => [e.id, e.action])).toEqual([
      [u2, 'update'],
      [r, 'restore'],
      [d, 'delete'],
      [u1, 'update'],
    ]);
    await undo(u1!);
    expect(await getOp(op.id)).toMatchObject({ amount: 1_000_000, comment: null, deletedAt: null });
    expect(undoMarks()).toBe(4);
  });

  it('«Изменить в перевод» отменяется: расход с датой сделки, контрагентом и категорией (Review Focus 3)', async () => {
    w = await opsWorld();
    const op = await create({ accrualDate: '2026-10-03', counterpartyId: w.counterparty });
    const before = await getOp(op.id);
    await patch(op.id, {
      type: 'transfer',
      toAccountId: w.usd,
      toAmount: 2_000,
      counterpartyId: null,
      accrualDate: null,
      lines: [{ categoryId: null, projectId: w.project, amount: 1_000_000 }],
    });
    expect((await getOp(op.id)).type).toBe('transfer');
    const [u] = await ids(op.id, 'update');
    const r = await undo(u!);
    const after = await getOp(op.id);
    expect(after).toMatchObject({
      type: 'expense',
      accrualDate: '2026-10-03',
      counterpartyId: w.counterparty,
      toAccountId: null,
      toAmount: null,
      rate: before.rate,
      baseAmount: before.baseAmount,
    });
    expect(after.lines).toMatchObject([{ categoryId: w.expense, projectId: w.project, amount: 1_000_000 }]);
    expect((await entry(r.undoId)).diff).toEqual({ type: 'expense', undone: [{ id: u, action: 'update', type: 'transfer' }], deleted: false });
  });

  it('категория «было» в архиве: 422 с причиной, ничего не изменено, запись отменяема (Review Focus 1)', async () => {
    w = await opsWorld();
    const light = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Свет' })).category.id as number;
    const op = await create();
    await patch(op.id, { lines: [{ categoryId: light, projectId: w.project, amount: 1_000_000 }] });
    expect((await w.h.req('POST', `/api/v1/companies/${w.cid}/categories/${w.expense}/archive`)).statusCode).toBe(200);
    const [u] = await ids(op.id, 'update');
    const version = (await getOp(op.id)).version;
    expect(fail(await undoRes(u!, [u!]), 422, 'ARCHIVED_REFERENCE').message).toBe('Категория «Аренда» в архиве — выберите другую');
    expect(await getOp(op.id)).toMatchObject({ version, lines: [{ categoryId: light }] });
    expect(w.h.auditCount('operation', 'undo')).toBe(0);
    expect((await entry(u!)).undoable).toBe(true);
  });

  it('каскад откатывается целиком: ошибка второго шага не оставляет первый применённым (Review Focus 2)', async () => {
    w = await opsWorld();
    const light = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Свет' })).category.id as number;
    const op = await create();
    await patch(op.id, { lines: [{ categoryId: light, projectId: w.project, amount: 1_000_000 }] });
    await patch(op.id, { amount: 1_200_000 });
    expect((await w.h.req('POST', `/api/v1/companies/${w.cid}/categories/${w.expense}/archive`)).statusCode).toBe(200);
    const [u1, u2] = await ids(op.id, 'update');
    fail(await undoRes(u1!, [u2!, u1!]), 422, 'ARCHIVED_REFERENCE');
    expect(await getOp(op.id)).toMatchObject({ amount: 1_200_000, lines: [{ categoryId: light, amount: 1_200_000 }] });
    expect(undoMarks()).toBe(0);
    expect((await entry(u2!)).undoable).toBe(true);
  });

  it('конфликт: каскад изменился после предпросмотра — 409, ничего не изменено', async () => {
    w = await opsWorld();
    const op = await create();
    await patch(op.id, { amount: 2_000_000 });
    const [u1] = await ids(op.id, 'update');
    expect((await preview(u1!)).map((e) => e.id)).toEqual([u1]);
    await patch(op.id, { comment: 'Клуб 2' });
    expect(fail(await undoRes(u1!, [u1!]), 409, 'VERSION_CONFLICT').message).toBe('Действия с операцией изменились — обновите историю');
    expect(await getOp(op.id)).toMatchObject({ amount: 2_000_000, comment: 'Клуб 2' });
    expect(undoMarks()).toBe(0);
  });

  it('что отменить нельзя: не операция, чужая компания, жёстко удалённая операция, архивная компания', async () => {
    w = await opsWorld();
    const all = (await w.h.req('GET', auditUrl())).json().entries as Entry[];
    const category = all.find((e) => e.entity === 'category')!;
    expect(category.undoable).toBe(false);
    expect(category.undoneBy).toBeNull();
    expect(fail(await previewRes(category.id), 422, 'UNDO_UNSUPPORTED').message).toBe('Это действие отменить нельзя');
    expect(fail(await w.h.req('GET', `${auditUrl()}/999999/undo`), 404, 'NOT_FOUND').message).toBe('Запись истории не найдена');

    const op = await create();
    const [c] = await ids(op.id, 'create');
    expect((await entry(c!)).undoable).toBe(true);
    const other = await w.h.company('ТОО Другая');
    fail(await w.h.req('GET', `/api/v1/companies/${other}/audit/${c}/undo`), 404, 'NOT_FOUND');

    // операция удалена жёстко (так удаляет отмена импорта): отменять нечего
    const gone = await create();
    const [cg] = await ids(gone.id, 'create');
    w.h.t.sqlite.prepare('DELETE FROM operations WHERE id = ?').run(gone.id);
    expect((await entry(cg!)).undoable).toBe(false);
    expect(fail(await previewRes(cg!), 404, 'NOT_FOUND').message).toBe('Операция больше не существует');

    // компания в архиве (архив компании требует архива её счетов — здесь проверяется только отказ отмены)
    w.h.t.sqlite.prepare('UPDATE companies SET archived_at = ? WHERE id = ?').run('2026-10-06T00:00:00.000Z', w.cid);
    expect(fail(await undoRes(c!, [c!]), 422, 'ARCHIVED_REFERENCE').message).toBe('Компания в архиве — изменения недоступны');
    expect(undoMarks()).toBe(0);
  });

  it('пустой или слишком длинный список ids — 400; каскад длиннее предела — 422 UNDO_TOO_LONG', async () => {
    w = await opsWorld();
    const op = await create();
    const [c] = await ids(op.id, 'create');
    fail(await undoRes(c!, []), 400, 'VALIDATION');
    fail(await undoRes(c!, Array.from({ length: 1001 }, (_, i) => i + 1)), 400, 'VALIDATION');
    expect(() => assertCascadeSize(1000)).not.toThrow();
    expect(() => assertCascadeSize(1001)).toThrow('Слишком много действий для одной отмены — отмените сначала более поздние');
  });

  it('оплаты закупок возвращаются к «было» правки', async () => {
    const s = await stockWorld();
    w = s;
    const receipt = await s.receipt('2026-10-05T06:00:00Z', [[s.cola, 10_000, 1_000_000]]);
    const op = await create({ amount: 600_000, counterpartyId: s.supplier, lines: [{ categoryId: w.expense, amount: 600_000 }], stockPayments: [{ docId: receipt.id, amount: 600_000 }] });
    await patch(op.id, { stockPayments: [{ docId: receipt.id, amount: 400_000 }] });
    expect((await getOp(op.id)).stockPayments[0].amount).toBe(400_000);
    const [u] = await ids(op.id, 'update');
    await undo(u!);
    expect((await getOp(op.id)).stockPayments[0]).toMatchObject({ docId: receipt.id, amount: 600_000 });
  });
});
