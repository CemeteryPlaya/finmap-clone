import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

const KEY = crypto.randomBytes(32).toString('base64');
let w: OpsWorld;
let base: string;
let officeId: number;
let salary: number;
let water: number;

beforeEach(async () => {
  w = await opsWorld('2026-10-06T12:00:00.000Z', { SECRET_KEY: KEY, SENET_API_BASE: 'http://127.0.0.1:9' });
  base = `/api/v1/companies/${w.cid}/senet`;
  const conn = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'token', token: 'tok-1' })).connection.id;
  officeId = (await w.post(`${base}/connections/${conn}/offices`, { senetOfficeId: 1 })).office.id;
  salary = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Зарплата Senet' })).category.id;
  water = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Вода' })).category.id;
});
afterEach(async () => {
  await w.h.t.cleanup();
});

const rule = async (body: object) => {
  const res = await w.h.req('POST', `${base}/rules`, body);
  return res;
};

/** Правила разноски: API и «Проверить на истории» (план 2026-11-02-senet-autopost, задача 10). */
describe('правила разноски', () => {
  it('список — слова по умолчанию; новое правило — с нормализованным шаблоном и в истории', async () => {
    expect((await w.h.req('GET', `${base}/rules`)).json().rules).toHaveLength(16);
    const res = await rule({ type: 'keyword', pattern: ' Вода!! ', match: 'phrase', categoryId: water, commentTemplate: 'вода' });
    expect(res.statusCode).toBe(201);
    expect(res.json().rule).toMatchObject({ type: 'keyword', pattern: 'вода', match: 'phrase', categoryId: water, officeId: null, archived: false });
    expect(await w.h.auditCount('senet_rule', 'create')).toBe(1);
  });

  it('проверки: дубль, алиас из двух слов, пустое точное, вторая настройка типа, чужая категория', async () => {
    await rule({ type: 'keyword', pattern: 'вода', match: 'phrase', categoryId: water });
    const dup = await rule({ type: 'keyword', pattern: 'ВОДА', match: 'contains', categoryId: water });
    expect([dup.statusCode, dup.json().error.message]).toEqual([422, 'Такое правило уже есть']);
    const alias = await rule({ type: 'employee_alias', pattern: 'два слова', match: 'word', counterpartyId: w.counterparty });
    expect([alias.statusCode, alias.json().error.fields?.pattern]).toEqual([400, 'Алиас — одно слово']);
    const exact = await rule({ type: 'exact', pattern: '  ', match: 'phrase', categoryId: water });
    expect([exact.statusCode, exact.json().error.fields?.pattern]).toEqual([400, 'Введите слово или фразу']);
    expect((await rule({ type: 'salary_word', pattern: '', match: 'word', categoryId: salary })).statusCode).toBe(201);
    expect((await rule({ type: 'salary_word', pattern: '', match: 'word', categoryId: water })).json().error.message).toBe('Такое правило уже есть');
    expect((await rule({ type: 'keyword', pattern: 'x', match: 'word', categoryId: 999_999 })).json().error.fields?.categoryId).toBe('Категория не найдена');
    // правило клуба — отдельно от общего
    expect((await rule({ type: 'keyword', pattern: 'вода', match: 'phrase', categoryId: water, officeId })).statusCode).toBe(201);
  });

  it('порядок ключевых слов, правка и архив', async () => {
    const ids: number[] = [];
    for (const p of ['а', 'б', 'в']) ids.push((await rule({ type: 'keyword', pattern: p, match: 'word', categoryId: water })).json().rule.id);
    const reordered = await w.h.req('PUT', `${base}/rules/order`, { type: 'keyword', ids: [...ids].reverse() });
    expect(reordered.statusCode).toBe(200);
    const list = (await w.h.req('GET', `${base}/rules`)).json().rules as { id: number; type: string }[];
    expect(list.filter((r) => r.type === 'keyword').map((r) => r.id)).toEqual([...ids].reverse());
    const patched = await w.h.req('PATCH', `${base}/rules/${ids[0]}`, { type: 'keyword', pattern: 'а', match: 'contains', categoryId: salary });
    expect(patched.json().rule).toMatchObject({ match: 'contains', categoryId: salary });
    expect((await w.h.req('DELETE', `${base}/rules/${ids[0]}`)).statusCode).toBe(204);
    expect(((await w.h.req('GET', `${base}/rules`)).json().rules as { id: number; archived: boolean }[]).find((r) => r.id === ids[0])!.archived).toBe(true);
  });

  it('«Проверить на истории»: распознано N из M, нераспознанные, отличия от журнала; ничего не пишет', async () => {
    await rule({ type: 'salary_word', pattern: '', match: 'word', categoryId: salary });
    await rule({ type: 'employee_alias', pattern: 'op1', match: 'word', counterpartyId: w.counterparty });
    await rule({ type: 'keyword', pattern: 'voda', match: 'phrase', categoryId: water });
    const q = (text: string, ...p: unknown[]) => w.h.t.q(text, ...p);
    await q("INSERT INTO senet_shifts (office_id, opened_at, closed_at, end_balance, updated_at) VALUES (?, '2026-10-01T05:00:00.000Z', '2026-10-01T17:00:00.000Z', 100000, 'x')", officeId);
    const [shift] = await q('SELECT id FROM senet_shifts');
    const op = (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-01T17:03:00Z', accountId: w.kzt, amount: 50_000, lines: [{ categoryId: w.expense, amount: 50_000 }] })).operation.id;
    const move = (ref: string, at: string, amount: number, comment: string, operationId: number | null = null) =>
      q("INSERT INTO senet_cash_moves (shift_id, senet_ref, kind, amount, at, comment, operation_id) VALUES (?, ?, 'out', ?, ?, ?, ?)", shift!.id, ref, amount, at, comment, operationId);
    await move('a', '2026-10-01T16:50:00.000Z', 200_000, 'kaspi');
    await move('b', '2026-10-01T16:51:00.000Z', 150_000, 'zp op1');
    await move('c', '2026-10-01T16:52:00.000Z', 50_000, 'voda', op);
    await move('d', '2026-10-01T16:53:00.000Z', 10_000, 'что-то');
    const before = await q('SELECT (SELECT COUNT(*) FROM operations) o, (SELECT COUNT(*) FROM senet_review_items) r');

    const res = await w.h.req('POST', `${base}/rules/check-history`, { officeId, from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect([r.total, r.recognized]).toEqual([4, 3]);
    expect(r.unrecognized).toEqual([expect.objectContaining({ comment: 'что-то', amount: 10_000, reason: 'unrecognized' })]);
    expect(r.differs).toEqual([{ moveId: expect.any(Number), operationId: op, comment: 'voda', was: { categoryId: w.expense, counterpartyId: null }, would: { categoryId: water, counterpartyId: null } }]);
    expect(await q('SELECT (SELECT COUNT(*) FROM operations) o, (SELECT COUNT(*) FROM senet_review_items) r')).toEqual(before);
  });
});
