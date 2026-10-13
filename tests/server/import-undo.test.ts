import { afterEach, describe, expect, it } from 'vitest';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService, type AuditService } from '../../src/server/modules/audit/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createImportsService } from '../../src/server/modules/imports/service';
import { createOperationsWriter } from '../../src/server/modules/operations/writer';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createTagsService } from '../../src/server/modules/tags/service';
import type { AccountMapping, ImportPreview, ImportUndoResponse } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeMany, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { importRows } from '../helpers/imports';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = '2026-10-06T12:00:00.000Z';
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, any>[];
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id as number;
const undoUrl = (id: number, cid = w.cid) => `/api/v1/companies/${cid}/imports/${id}/undo`;
const undo = (id: number, body: object = { includeEdited: false, edited: 0 }, cid = w.cid) => w.h.req('POST', undoUrl(id, cid), body);

/** Строки таблиц, которые меняют импорт и отмена (без истории и imports), и состояние счетов. */
const dataState = () =>
  one(
    `SELECT (SELECT COUNT(*) FROM operations) ops, (SELECT COUNT(*) FROM operation_lines) lines, (SELECT COUNT(*) FROM operation_tags) optags,
            (SELECT COUNT(*) FROM attachments) files, (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM categories) categories,
            (SELECT COUNT(*) FROM counterparties) cps, (SELECT COUNT(*) FROM projects) projects, (SELECT COUNT(*) FROM tags) tags,
            (SELECT group_concat(id || ':' || starting_balance || '/' || opened_at) FROM accounts) accountState`,
  );
/** Вместе с историей и imports: «ничего не изменилось». */
const fullState = () => ({ ...dataState(), audit: one('SELECT COUNT(*) n FROM audit_log').n, imports: one("SELECT group_concat(id || ':' || status) s FROM imports").s });

/** Остатки счетов компании через API (GET …/balances): то, что видит человек. */
const balances = async () => {
  const res = await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().accounts as { accountId: number; currency: string; balance: number }[];
};
/** Доход на «Кассу» с существующей категорией «Бар» — операция не из импорта. */
const cashIncome = (paidAt: string, amount: number) =>
  w.post(w.ops, {
    type: 'income',
    paidAt,
    accrualDate: null,
    accountId: w.kzt,
    amount,
    toAccountId: null,
    toAmount: null,
    counterpartyId: null,
    comment: null,
    lines: [{ categoryId: w.income, projectId: null, amount }],
    tagIds: [],
  });

/**
 * Доход на существующую «Кассу» раньше её даты открытия (перенос openedAt), зарплата с новой подкатегорией и новым
 * контрагентом, перевод на новый счёт «Банк-2» с новым проектом, расход с «Банка-2» с новыми категорией, подкатегорией,
 * контрагентом и тегом «Ночь» (тег «Смена» уже есть).
 */
const FILE = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы', counterparty: 'Сотрудник А' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2', project: 'Клуб 9' }),
  fr({
    paidAt: at('2026-10-05', '00:30:00'),
    amount: 8200.5,
    from: 'Банк-2',
    category: 'Связь',
    subcategory: 'Интернет',
    counterparty: 'Поставщик Б',
    tags: 'Смена, Ночь',
  }),
];
const MAPPINGS: AccountMapping[] = [
  { key: 'касса', kind: 'existing', accountId: 0, targetBalance: 2_000_000 },
  { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1_000_000 } },
];
const mappings = (): AccountMapping[] => MAPPINGS.map((m) => (m.kind === 'existing' ? { ...m, accountId: w.kzt } : m));
const opId = (importId: number, type: string, amount: number) => one('SELECT id FROM operations WHERE import_id = ? AND type = ? AND amount = ?', importId, type, amount).id as number;

describe('POST …/imports/:id/undo — отмена (§7.3 спецификации импорта)', () => {
  it('чистая отмена: база как до импорта — счета (openedAt и startingBalance), справочники, системные категории; imports — undone; история', async () => {
    w = await opsWorld(NOW);
    // операция «Кассы» до импорта: после отмены остатки счетов — те же, что до импорта
    await cashIncome('2026-10-02T06:00:00.000Z', 123_400);
    const balancesBefore = await balances();
    const before = dataState();
    const systemBefore = all('SELECT id FROM categories WHERE company_id = ? AND system_key IS NOT NULL ORDER BY id', w.cid);
    const r = await importRows(w, FILE, { accounts: mappings() });
    expect(one('SELECT opened_at FROM accounts WHERE id = ?', w.kzt).opened_at).toBe('2026-09-20');
    const auditBefore = one('SELECT MAX(id) m FROM audit_log').m as number;

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ImportUndoResponse;
    expect(body.result).toEqual({
      deleted: { operations: 4, accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 },
      kept: { operations: 0, created: { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 }, names: [], accounts: [] },
    });
    expect(body.import).toMatchObject({ id: r.import.id, status: 'undone', undoneAt: NOW, undoneByName: 'Тест', pending: null });

    // база как до импорта: «Касса» — прежние стартовый баланс и дата открытия; системные категории на месте
    expect(dataState()).toEqual(before);
    expect(await balances()).toEqual(balancesBefore);
    expect(all('SELECT id FROM categories WHERE company_id = ? AND system_key IS NOT NULL ORDER BY id', w.cid)).toEqual(systemBefore);
    const row = one('SELECT status, undone_at, undone_by, undo_result FROM imports WHERE id = ?', r.import.id);
    expect(row).toMatchObject({ status: 'undone', undone_at: NOW, undone_by: adminId() });
    expect(JSON.parse(row.undo_result)).toEqual(body.result);

    // история: удаление созданного с importId, возврат «Кассы», запись отмены; операций без своей истории — нет
    const audit = all('SELECT entity, action, entity_id eid, diff FROM audit_log WHERE id > ? ORDER BY id', auditBefore).map((a) => ({
      entity: a.entity as string,
      action: a.action as string,
      eid: a.eid as number,
      diff: JSON.parse(a.diff),
    }));
    expect(audit.map((a) => `${a.entity} ${a.action}`)).toEqual([
      'category delete',
      'category delete',
      'category delete',
      'counterparty delete',
      'counterparty delete',
      'tag delete',
      'account delete',
      'project delete',
      'account update',
      'import delete',
    ]);
    expect(audit.slice(0, -1).every((a) => a.diff.importId === r.import.id)).toBe(true);
    expect(audit[0]!.diff).toEqual({ kind: 'expense', name: 'Администраторы', parentId: expect.any(Number), importId: r.import.id });
    expect(audit[8]!.diff).toEqual({
      before: { startingBalance: expect.any(Number), openedAt: '2026-09-20' },
      after: { startingBalance: 0, openedAt: '2026-10-01' },
      importId: r.import.id,
    });
    expect(audit[9]).toEqual({ entity: 'import', action: 'delete', eid: r.import.id, diff: { fileName: 'выгрузка.xlsx', ...body.result } });

    // тот же файл после отмены — не дубликаты и без W8 «уже импортирован»
    const again = await w.h.t.app.inject({
      method: 'POST',
      url: `/api/v1/companies/${w.cid}/imports/upload`,
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
      payload: finmapLikeXlsx(FILE),
    });
    const p = again.json() as ImportPreview;
    expect(p.counts).toMatchObject({ add: 4, duplicates: 0 });
    expect(p.warnings.map((g) => g.code)).not.toContain('W8');
  });

  it('операция, добавленная на «Кассу» после импорта, остаётся: остаток «Кассы» — прежний плюс она, остальные — как до импорта', async () => {
    w = await opsWorld(NOW);
    await cashIncome('2026-10-02T06:00:00.000Z', 123_400);
    const balancesBefore = await balances();
    const r = await importRows(w, FILE, { accounts: mappings() });
    const added = await cashIncome('2026-10-05T06:00:00.000Z', 50_000);

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 4, accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 });
    expect(result.kept).toEqual({ operations: 0, created: { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 }, names: [], accounts: [] });
    expect(await balances()).toEqual(balancesBefore.map((b) => (b.accountId === w.kzt ? { ...b, balance: b.balance + 50_000 } : b)));
    // операция после импорта на месте, «Касса» — прежние стартовый баланс и дата открытия
    expect(all('SELECT id FROM operations WHERE company_id = ? AND import_id IS NULL ORDER BY id', w.cid).map((o) => o.id)).toContain(added.operation.id);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual({ starting_balance: 0, opened_at: '2026-10-01' });
  });

  it('изменённая после импорта операция без флажка остаётся вместе со своими справочниками; мягко удалённая удаляется всегда', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const internet = opId(r.import.id, 'expense', 820_050);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'проверено' })).statusCode).toBe(200);
    const salary = opId(r.import.id, 'expense', 850_000);
    expect((await w.h.req('DELETE', `${w.ops}/${salary}`)).statusCode).toBe(200);
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;

    const res = await undo(r.import.id, { includeEdited: false, edited: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 3, accounts: 0, categories: 1, counterparties: 1, projects: 1, tags: 0 });
    expect(result.kept).toEqual({
      operations: 1,
      created: { accounts: 1, categories: 2, counterparties: 1, projects: 0, tags: 1 },
      names: [
        { entity: 'category', name: 'Интернет' },
        { entity: 'category', name: 'Связь' },
        { entity: 'counterparty', name: 'Поставщик Б' },
        { entity: 'tag', name: 'Ночь' },
        { entity: 'account', name: 'Банк-2' },
      ],
      accounts: [{ accountId: bank, name: 'Банк-2', field: 'startingBalance', reason: 'created' }],
    });
    // осталась только изменённая; «Касса» без операций импорта — прежние стартовый баланс и дата открытия
    expect(all('SELECT id, comment, import_id FROM operations WHERE company_id = ?', w.cid)).toEqual([{ id: internet, comment: 'проверено', import_id: r.import.id }]);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual({ starting_balance: 0, opened_at: '2026-10-01' });
    // мягко удалённая зарплата удалена жёстко, «Администраторы» и «Сотрудник А» свободны и удалены
    expect(one("SELECT COUNT(*) n FROM categories WHERE name = 'Администраторы'").n).toBe(0);
    expect(one("SELECT COUNT(*) n FROM counterparties WHERE name = 'Сотрудник А'").n).toBe(0);
    // записи удаления операций в истории нет: изменённая осталась, а у удалённой уже есть своя запись удаления
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'operation' AND action = 'delete'").n).toBe(1);
    expect((await undo(r.import.id)).statusCode).toBe(409);
  });

  it('«Удалить и изменённые»: удаляются и они — сначала записи вложений; у изменённых — запись удаления в истории', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const internet = opId(r.import.id, 'expense', 820_050);
    const income = opId(r.import.id, 'income', 1_059_600);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'проверено' })).statusCode).toBe(200);
    w.h.t.sqlite
      .prepare("INSERT INTO attachments (company_id, operation_id, original_name, stored_name, mime, size, created_at) VALUES (?, ?, 'чек.png', 'x.png', 'image/png', 1, ?)")
      .run(w.cid, income, NOW);

    const res = await undo(r.import.id, { includeEdited: true, edited: 2 });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 4, accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 });
    expect(result.kept.operations).toBe(0);
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM attachments').n).toBe(0);
    const deletes = all("SELECT entity_id, diff FROM audit_log WHERE entity = 'operation' AND action = 'delete' ORDER BY entity_id");
    expect(deletes.map((d) => [d.entity_id, JSON.parse(d.diff)])).toEqual([
      [income, { type: 'income', amount: 1_059_600, accountId: w.kzt, paidAt: '2026-09-20T05:00:00.000Z', importId: r.import.id }],
      [internet, { type: 'expense', amount: 820_050, accountId: expect.any(Number), paidAt: '2026-10-04T19:30:00.000Z', importId: r.import.id }],
    ]);
  });

  it('использованное после импорта остаётся: контрагент в новой операции; «Касса» — стартовый баланс изменён, операция раньше прежней даты открытия', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const employee = one("SELECT id FROM counterparties WHERE name = 'Сотрудник А'").id as number;
    await w.post(w.ops, {
      type: 'expense',
      paidAt: '2026-09-25T06:00:00.000Z',
      accrualDate: null,
      accountId: w.kzt,
      amount: 100,
      toAccountId: null,
      toAmount: null,
      counterpartyId: employee,
      comment: null,
      lines: [{ categoryId: w.expense, projectId: null, amount: 100 }],
      tagIds: [],
    });
    const patch = await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { startingBalance: 777 });
    expect(patch.statusCode, patch.body).toBe(200);
    const auditBefore = one('SELECT MAX(id) m FROM audit_log').m as number;

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.kept.names).toEqual([{ entity: 'counterparty', name: 'Сотрудник А' }]);
    expect(result.kept.accounts).toEqual([
      { accountId: w.kzt, name: 'Касса', field: 'startingBalance', reason: 'changed' },
      { accountId: w.kzt, name: 'Касса', field: 'openedAt', reason: 'operations' },
    ]);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual({ starting_balance: 777, opened_at: '2026-09-20' });
    // ни одной записи «account update» от отмены: оба поля оставлены
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'account' AND action = 'update' AND id > ?", auditBefore).n).toBe(0);
  });

  it('архивный счёт удаляемой операции — 422, ничего не изменилось; из архива — отмена проходит', async () => {
    w = await opsWorld(NOW);
    // остаток «Банка-2» после импорта — 0: такой счёт можно перевести в архив
    const zeroBank: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 0 } }];
    const r = await importRows(w, FILE, { accounts: zeroBank });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    await w.post(`/api/v1/companies/${w.cid}/accounts/${bank}/archive`, {});
    const before = fullState();
    const res = await undo(r.import.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'ARCHIVED_REFERENCE', message: 'Счёт «Банк-2» в архиве — верните его из архива, чтобы отменить импорт' });
    expect(fullState()).toEqual(before);
    await w.post(`/api/v1/companies/${w.cid}/accounts/${bank}/unarchive`, {});
    expect((await undo(r.import.id)).statusCode).toBe(200);
  });

  it('повтор — 409 IMPORT_UNDONE; чужая компания — 404; архивная компания — 422; изменённых стало больше, чем видел человек, — 409 IMPORT_CHANGED; неверное тело — 400', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const other = await w.h.company('Другая');
    expect((await undo(r.import.id, undefined, other)).statusCode).toBe(404);
    // и в обратную сторону: импорт другой компании по адресу нашей — 404, он не отменён
    const theirs = await importRows(w, [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 7, to: 'Касса' })], { cid: other });
    expect((await undo(theirs.import.id)).statusCode).toBe(404);
    expect(one('SELECT status FROM imports WHERE id = ?', theirs.import.id).status).toBe('done');
    // без входа — 401
    const anon = await w.h.t.app.inject({ method: 'POST', url: undoUrl(r.import.id), headers: ORIGIN_HEADERS, payload: { includeEdited: false, edited: 0 } });
    expect(anon.statusCode).toBe(401);
    expect((await undo(r.import.id, { includeEdited: true })).statusCode).toBe(400);

    // с флажком: человек видел 0 изменённых, а за это время одну операцию изменили — ничего не удалено
    const internet = opId(r.import.id, 'expense', 820_050);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'правка' })).statusCode).toBe(200);
    const before = fullState();
    const changed = await undo(r.import.id, { includeEdited: true, edited: 0 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toMatchObject({
      code: 'IMPORT_CHANGED',
      message: 'После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз',
      details: { pending: { operations: 4, edited: 1 } },
    });
    expect(fullState()).toEqual(before);
    // без флажка изменённая просто остаётся — согласие не нужно
    expect((await undo(r.import.id, { includeEdited: false, edited: 0 })).statusCode).toBe(200);
    const again = await undo(r.import.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'IMPORT_UNDONE', message: 'Импорт уже отменён' });

    // архивная компания (без операций и счетов) — 422 до всего остального
    const empty = await w.h.company('Пустая');
    const r2 = await importRows(w, [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 1, to: 'Сейф' })], { cid: empty, accounts: [{ key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'current', amount: 0 } }] });
    const safe = one('SELECT id FROM accounts WHERE company_id = ?', empty).id as number;
    await w.post(`/api/v1/companies/${empty}/accounts/${safe}/archive`, {});
    expect((await w.h.req('POST', `/api/v1/companies/${empty}/archive`, {})).statusCode).toBe(200);
    const archived = await undo(r2.import.id, undefined, empty);
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.message).toBe('Компания в архиве — изменения недоступны');
  });

  it('созданный импортом счёт с оставшейся операцией остаётся: стартовый баланс, рассчитанный импортом, обнулён, остаток — сумма оставшихся операций (решение 16 плана И-3)', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    const bankBefore = one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', bank);
    // «Текущий остаток» 10 000 при движении файла +41 799,50: стартовый баланс импорта — минус 31 799,50; он же — в computedStarts
    expect(bankBefore.starting_balance).toBe(1_000_000 - (5_000_000 - 820_050));
    expect(JSON.parse(one('SELECT created FROM imports WHERE id = ?', r.import.id).created).computedStarts).toEqual({ [String(bank)]: bankBefore.starting_balance });
    // операция «Банка-2», добавленная после импорта: из-за неё счёт остаётся
    await w.post(w.ops, {
      type: 'income',
      paidAt: '2026-10-05T06:00:00.000Z',
      accrualDate: null,
      accountId: bank,
      amount: 30_000,
      toAccountId: null,
      toAmount: null,
      counterpartyId: null,
      comment: null,
      lines: [{ categoryId: w.income, projectId: null, amount: 30_000 }],
      tagIds: [],
    });
    const auditBefore = one('SELECT MAX(id) m FROM audit_log').m as number;

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.deleted).toEqual({ operations: 4, accounts: 0, categories: 3, counterparties: 2, projects: 1, tags: 1 });
    expect(result.kept).toEqual({
      operations: 0,
      created: { accounts: 1, categories: 0, counterparties: 0, projects: 0, tags: 0 },
      names: [{ entity: 'account', name: 'Банк-2' }],
      accounts: [{ accountId: bank, name: 'Банк-2', field: 'startingBalance', reason: 'created' }],
    });
    // дата открытия — как есть: операций раньше неё нет
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', bank)).toEqual({ starting_balance: 0, opened_at: bankBefore.opened_at });
    expect((await balances()).find((b) => b.accountId === bank)!.balance).toBe(30_000);
    const zeroed = all("SELECT diff FROM audit_log WHERE entity = 'account' AND action = 'update' AND entity_id = ? AND id > ?", bank, auditBefore);
    expect(zeroed.map((a) => JSON.parse(a.diff))).toEqual([
      { before: { startingBalance: bankBefore.starting_balance }, after: { startingBalance: 0 }, importId: r.import.id },
    ]);
  });

  it('оставленный созданный счёт в режиме «Стартовый баланс»: введённый стартовый баланс остаётся, в итоге полей счёта нет', async () => {
    w = await opsWorld(NOW);
    const entered: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'start', amount: 500_000 } }];
    const r = await importRows(w, FILE, { accounts: entered });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    await w.post(w.ops, {
      type: 'income',
      paidAt: '2026-10-05T06:00:00.000Z',
      accrualDate: null,
      accountId: bank,
      amount: 30_000,
      toAccountId: null,
      toAmount: null,
      counterpartyId: null,
      comment: null,
      lines: [{ categoryId: w.income, projectId: null, amount: 30_000 }],
      tagIds: [],
    });
    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.kept.names).toEqual([{ entity: 'account', name: 'Банк-2' }]);
    expect(result.kept.accounts).toEqual([]);
    expect(one('SELECT starting_balance FROM accounts WHERE id = ?', bank).starting_balance).toBe(500_000);
    expect((await balances()).find((b) => b.accountId === bank)!.balance).toBe(500_000 + 30_000);
  });

  it('стартовый баланс созданного счёта изменён после импорта: остаётся, причина «изменён после импорта»', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    const patch = await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${bank}`, { startingBalance: 12_300 });
    expect(patch.statusCode, patch.body).toBe(200);
    await w.post(w.ops, {
      type: 'income',
      paidAt: '2026-10-05T06:00:00.000Z',
      accrualDate: null,
      accountId: bank,
      amount: 30_000,
      toAccountId: null,
      toAmount: null,
      counterpartyId: null,
      comment: null,
      lines: [{ categoryId: w.income, projectId: null, amount: 30_000 }],
      tagIds: [],
    });
    const auditBefore = one('SELECT MAX(id) m FROM audit_log').m as number;

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ImportUndoResponse).result.kept.accounts).toEqual([{ accountId: bank, name: 'Банк-2', field: 'startingBalance', reason: 'changed' }]);
    expect(one('SELECT starting_balance FROM accounts WHERE id = ?', bank).starting_balance).toBe(12_300);
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'account' AND action = 'update' AND entity_id = ? AND id > ?", bank, auditBefore).n).toBe(0);
  });

  it('импорт, записанный без computedStarts (до решения 16): стартовый баланс оставленного счёта не меняется, итог просит проверить', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    const start = one('SELECT starting_balance FROM accounts WHERE id = ?', bank).starting_balance as number;
    // как у импорта, записанного раньше: в imports.created нет computedStarts
    w.h.t.sqlite.prepare("UPDATE imports SET created = json_remove(created, '$.computedStarts') WHERE id = ?").run(r.import.id);
    expect(JSON.parse(one('SELECT created FROM imports WHERE id = ?', r.import.id).created)).not.toHaveProperty('computedStarts');
    await w.post(w.ops, {
      type: 'income',
      paidAt: '2026-10-05T06:00:00.000Z',
      accrualDate: null,
      accountId: bank,
      amount: 30_000,
      toAccountId: null,
      toAmount: null,
      counterpartyId: null,
      comment: null,
      lines: [{ categoryId: w.income, projectId: null, amount: 30_000 }],
      tagIds: [],
    });

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ImportUndoResponse).result.kept.accounts).toEqual([{ accountId: bank, name: 'Банк-2', field: 'startingBalance', reason: 'unverified' }]);
    expect(one('SELECT starting_balance FROM accounts WHERE id = ?', bank).starting_balance).toBe(start);
  });

  it('существующий счёт в архиве: поля, изменённые импортом, остаются как есть — причина «счёт в архиве»', async () => {
    w = await opsWorld(NOW);
    // доход на «Кассу» раньше её даты открытия, остаток «Кассы» после импорта — 0: счёт можно перевести в архив
    const r = await importRows(w, [fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 100, to: 'Касса', category: 'Бар' })], {
      accounts: [{ key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 0 }],
    });
    const before = one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt);
    expect(before).toEqual({ starting_balance: -10_000, opened_at: '2026-09-20' });
    // операция изменена — без флажка остаётся: с архивного счёта удалять нечего
    const income = opId(r.import.id, 'income', 10_000);
    expect((await w.h.req('PATCH', `${w.ops}/${income}`, { version: 1, comment: 'сверено' })).statusCode).toBe(200);
    await w.post(`/api/v1/companies/${w.cid}/accounts/${w.kzt}/archive`, {});

    const res = await undo(r.import.id, { includeEdited: false, edited: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ImportUndoResponse).result.kept.accounts).toEqual([
      { accountId: w.kzt, name: 'Касса', field: 'startingBalance', reason: 'archived' },
      { accountId: w.kzt, name: 'Касса', field: 'openedAt', reason: 'archived' },
    ]);
    expect(one('SELECT starting_balance, opened_at FROM accounts WHERE id = ?', w.kzt)).toEqual(before);
  });

  it('созданная импортом категория с подкатегорией, добавленной после импорта, и проект, к которому привязали счёт, остаются', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const svyaz = one("SELECT id FROM categories WHERE company_id = ? AND name = 'Связь'", w.cid).id as number;
    await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Мобильная', parentId: svyaz });
    const club = one("SELECT id FROM projects WHERE company_id = ? AND name = 'Клуб 9'", w.cid).id as number;
    const patch = await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { projectId: club });
    expect(patch.statusCode, patch.body).toBe(200);

    const res = await undo(r.import.id);
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    // «Интернет» (подкатегория «Связи» из импорта) свободна и удалена; «Связь» держит «Мобильная», «Клуб 9» — «Касса»
    expect(result.deleted).toEqual({ operations: 4, accounts: 1, categories: 2, counterparties: 2, projects: 0, tags: 1 });
    expect(result.kept.names).toEqual([
      { entity: 'category', name: 'Связь' },
      { entity: 'project', name: 'Клуб 9' },
    ]);
    expect(all("SELECT name FROM categories WHERE company_id = ? AND name IN ('Связь', 'Интернет', 'Мобильная') ORDER BY name", w.cid)).toEqual([
      { name: 'Мобильная' },
      { name: 'Связь' },
    ]);
    expect(one('SELECT project_id FROM accounts WHERE id = ?', w.kzt).project_id).toBe(club);
  });

  it('порядок ответов: изменённых больше, чем видел человек, — 409 IMPORT_CHANGED раньше 422 об архивном счёте', async () => {
    w = await opsWorld(NOW);
    const zeroBank: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 0 } }];
    const r = await importRows(w, FILE, { accounts: zeroBank });
    const bank = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;
    await w.post(`/api/v1/companies/${w.cid}/accounts/${bank}/archive`, {});
    const income = opId(r.import.id, 'income', 1_059_600);
    expect((await w.h.req('PATCH', `${w.ops}/${income}`, { version: 1, comment: 'правка' })).statusCode).toBe(200);
    const before = fullState();

    const changed = await undo(r.import.id, { includeEdited: true, edited: 0 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toMatchObject({ code: 'IMPORT_CHANGED', details: { pending: { operations: 4, edited: 1 } } });
    expect(fullState()).toEqual(before);
    // изменённую человек увидел — теперь 422 об архивном счёте
    const archived = await undo(r.import.id, { includeEdited: true, edited: 1 });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
    expect(fullState()).toEqual(before);
  });

  it('«Удалить и изменённые» на 1 200 операциях: записи вложений удаляются в каждой части по 500 id', { timeout: 60_000 }, async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, finmapLikeMany(1_200));
    const ids = all('SELECT id FROM operations WHERE import_id = ? ORDER BY id', r.import.id).map((o) => o.id as number);
    expect(ids).toHaveLength(1_200);
    // по вложению в первой, второй и третьей части
    const withFiles = [ids[0]!, ids[700]!, ids[1_199]!];
    const attach = w.h.t.sqlite.prepare(
      "INSERT INTO attachments (company_id, operation_id, original_name, stored_name, mime, size, created_at) VALUES (?, ?, 'чек.png', ?, 'image/png', 1, ?)",
    );
    for (const id of withFiles) attach.run(w.cid, id, `x${id}.png`, NOW);

    const res = await undo(r.import.id, { includeEdited: true, edited: 3 });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect((res.json() as ImportUndoResponse).result.deleted.operations).toBe(1_200);
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM attachments').n).toBe(0);
    expect(all("SELECT entity_id FROM audit_log WHERE entity = 'operation' AND action = 'delete' ORDER BY entity_id").map((a) => a.entity_id)).toEqual(withFiles);
  });

  it('сбой после начала удаления (на записи истории об отмене) — откатывается всё: данные, история и imports как до отмены', async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, FILE, { accounts: mappings() });
    const internet = opId(r.import.id, 'expense', 820_050);
    expect((await w.h.req('PATCH', `${w.ops}/${internet}`, { version: 1, comment: 'проверено' })).statusCode).toBe(200);
    const db = w.h.t.db;
    const real = createAuditService(db);
    const written: string[] = [];
    // запись «import delete» — последняя запись отмены: к ней удалены операции, справочники, счёт и возвращена «Касса»
    const audit: AuditService = {
      list: (q) => real.list(q),
      record(entry, ex) {
        if (entry.entity === 'import') throw new Error('сбой истории');
        real.record(entry, ex);
        written.push(`${entry.entity} ${entry.action}`);
      },
    };
    const categories = createCategoriesService({ db, audit });
    const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty', now: () => new Date(NOW) });
    const companies = createCompaniesService({ db, audit, categories, accounts });
    const imports = createImportsService({
      db,
      audit,
      rates: createRatesService({ db, audit }),
      timezone: 'Asia/Almaty',
      now: () => new Date(NOW),
      accounts,
      categories,
      counterparties: createCounterpartiesService({ db, audit }),
      projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
      tags: createTagsService({ db, audit }),
      writer: createOperationsWriter(w.h.t.sqlite),
    });
    const before = fullState();

    expect(() => imports.undo(w.cid, adminId(), r.import.id, { includeEdited: true, edited: 1 })).toThrow('сбой истории');
    expect(written).toEqual([
      'operation delete',
      'category delete',
      'category delete',
      'category delete',
      'counterparty delete',
      'counterparty delete',
      'tag delete',
      'account delete',
      'project delete',
      'account update',
    ]);
    expect(fullState()).toEqual(before);
    expect(one('SELECT status, undone_at, undo_result FROM imports WHERE id = ?', r.import.id)).toEqual({ status: 'done', undone_at: null, undo_result: null });
    // после сбоя отмена проходит как обычно
    expect((await undo(r.import.id, { includeEdited: true, edited: 1 })).statusCode).toBe(200);
  });

  it('16 000 строк: отмена укладывается в 20 с, операций импорта не осталось', { timeout: 120_000 }, async () => {
    w = await opsWorld(NOW);
    const r = await importRows(w, finmapLikeMany(16_000));
    const t0 = performance.now();
    const res = await undo(r.import.id);
    const ms = performance.now() - t0;
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect((res.json() as ImportUndoResponse).result.deleted.operations).toBe(16_000);
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    // бюджет §10 — 3 с на эталонной машине (bench:import); здесь — с запасом для медленного CI
    expect(ms).toBeLessThan(20_000);
  });
});
