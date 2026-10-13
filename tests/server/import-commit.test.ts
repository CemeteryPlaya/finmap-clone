import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createImportCache, type ImportCache } from '../../src/server/modules/imports/cache';
import { createImportsService } from '../../src/server/modules/imports/service';
import { createOperationsService } from '../../src/server/modules/operations/service';
import { createOperationsWriter, type OperationsWriter } from '../../src/server/modules/operations/writer';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createTagsService } from '../../src/server/modules/tags/service';
import type { AccountMapping, ImportCommitResult, ImportPreview, ImportPreviewAccount } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeMany, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z');
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, any>;
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, any>[];
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id as number;
/** Сколько строк в таблицах, которые меняет импорт: «база не изменилась» — те же числа. */
const tableCounts = () =>
  one(
    `SELECT (SELECT COUNT(*) FROM operations) ops, (SELECT COUNT(*) FROM operation_lines) lines, (SELECT COUNT(*) FROM operation_tags) optags,
            (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM categories) categories, (SELECT COUNT(*) FROM counterparties) cps,
            (SELECT COUNT(*) FROM projects) projects, (SELECT COUNT(*) FROM tags) tags, (SELECT COUNT(*) FROM imports) imports,
            (SELECT COUNT(*) FROM audit_log) audit, (SELECT group_concat(starting_balance || '/' || opened_at) FROM accounts) accountState`,
  );

const importsUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports`;

function upload(rows: FinmapLikeValue[][], cid = w.cid, cookie = w.h.cookie) {
  return w.h.t.app.inject({
    method: 'POST',
    url: `${importsUrl(cid)}/upload`,
    headers: { ...ORIGIN_HEADERS, cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
}
async function uploaded(rows: FinmapLikeValue[][], cid = w.cid): Promise<ImportPreview> {
  const res = await upload(rows, cid);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportPreview;
}
async function previewWith(p: ImportPreview, accounts: AccountMapping[], cid = w.cid): Promise<ImportPreview> {
  const res = await w.h.req('POST', `${importsUrl(cid)}/preview`, { token: p.token, accounts });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportPreview;
}
const commit = (p: ImportPreview, accounts: AccountMapping[] = [], cid = w.cid) => w.h.req('POST', importsUrl(cid), { token: p.token, accounts, revision: p.revision });

/** Доход по существующей категории, зарплата с подкатегорией и периодом, перевод на новый счёт с новым проектом, расход с новыми категорией, контрагентом и тегом. */
const FILE = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({
    paidAt: at('2026-10-03', '22:07:30'),
    periodFrom: '01.09.2026 00:00:00',
    periodTo: '30.09.2026 23:59:59',
    amount: 8500,
    from: 'Касса',
    category: 'Зарплата',
    subcategory: 'Администраторы',
    counterparty: 'Сотрудник А',
  }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2', project: 'Клуб 9' }),
  fr({
    paidAt: at('2026-10-05', '00:30:00'),
    amount: 8200.5,
    from: 'Банк-2',
    category: 'Связь',
    subcategory: 'Интернет',
    counterparty: 'Поставщик Б',
    tags: 'Смена, Ночь',
    comment: 'Интернет за октябрь',
  }),
];

function operationsService() {
  const db = w.h.t.db;
  const audit = createAuditService(db);
  return createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => NOW });
}

/** Остаток после записи, который обещает карточка счёта проверки (§5.4): «Остаток после импорта», «Текущий остаток», «Стартовый баланс» или остаток + движение. */
function promisedBalance(a: ImportPreviewAccount): number {
  const m = a.mapping!;
  if (m.kind === 'existing') return m.targetBalance ?? a.existing!.balance + a.movement;
  if (!m.balance) return a.movement;
  return m.balance.mode === 'current' ? m.balance.amount : m.balance.amount + a.movement;
}
/** Остатки по проводкам после записи — ровно те, что обещали карточки. */
function expectPromisedBalances(cards: ImportPreviewAccount[]) {
  const ledger = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
  for (const c of cards) {
    const m = c.mapping!;
    const id = m.kind === 'existing' ? m.accountId : (one('SELECT id FROM accounts WHERE company_id = ? AND name = ?', w.cid, m.name).id as number);
    expect(ledger.get(id), c.fileName).toBe(promisedBalance(c));
  }
}

/** Второй пользователь: свой кэш проверки (тот же пользователь при новой загрузке вытеснил бы свой прежний файл). */
async function secondUser() {
  await seedUser(w.h.t, 'second', 'second-password-1');
  const cookie = await loginAs(w.h.t, 'second', 'second-password-1');
  const post = (url: string, payload: object) => w.h.t.app.inject({ method: 'POST', url, headers: { ...ORIGIN_HEADERS, cookie }, payload });
  return { cookie, post };
}

/** Сервис импорта напрямую — с подменённым кэшем (сбой или гонка в нужный момент). */
function importsServiceWith(cache: ImportCache) {
  const db = w.h.t.db;
  const audit = createAuditService(db);
  const categories = createCategoriesService({ db, audit });
  const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty', now: () => NOW });
  const companies = createCompaniesService({ db, audit, categories, accounts });
  return createImportsService({
    db,
    audit,
    rates: createRatesService({ db, audit }),
    timezone: 'Asia/Almaty',
    now: () => NOW,
    cache,
    accounts,
    categories,
    counterparties: createCounterpartiesService({ db, audit }),
    projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
    tags: createTagsService({ db, audit }),
    writer: createOperationsWriter(w.h.t.sqlite),
  });
}

describe('POST …/imports: запись одной транзакцией (§6.4, §6.5 спецификации импорта)', () => {
  it('счётчики, справочники с видом, типом и родителем, остатки по обоим режимам, import_id, check(), история; повтор токена — 410', async () => {
    w = await opsWorld();
    const mappings: AccountMapping[] = [
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 2_000_000 },
      { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1_000_000 } },
    ];
    const p = await previewWith(await uploaded(FILE), mappings);
    expect(p.canImport).toBe(true);
    expect(p.revision).toMatch(/^[0-9a-f]{16}$/);

    const res = await commit(p, mappings);
    expect(res.statusCode, res.body).toBe(201);
    const r = res.json() as ImportCommitResult;
    const counts = { rows: 4, income: 1, expense: 2, transfer: 1, added: 4, duplicates: 0, skippedFuture: 0 };
    expect(r).toEqual({
      import: {
        id: expect.any(Number),
        fileName: 'выгрузка.xlsx',
        fileSize: finmapLikeXlsx(FILE).length,
        status: 'done',
        createdAt: NOW.toISOString(),
        counts,
        created: { accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 },
      },
      counts,
    });
    const importId = r.import.id;

    // операции: по времени, все с import_id; зарплата — с датой начисления из периода
    const ops = all('SELECT id, type, paid_at, accrual_date, amount, import_id, version FROM operations WHERE company_id = ? ORDER BY id', w.cid);
    expect(ops.map((o) => [o.type, o.paid_at, o.accrual_date, o.amount, o.import_id, o.version])).toEqual([
      ['income', '2026-09-20T05:00:00.000Z', null, 1_059_600, importId, 1],
      ['expense', '2026-10-03T17:07:30.000Z', '2026-09-01', 850_000, importId, 1],
      ['transfer', '2026-10-04T04:15:00.000Z', null, 5_000_000, importId, 1],
      ['expense', '2026-10-04T19:30:00.000Z', null, 820_050, importId, 1],
    ]);
    // каждая импортированная операция проходит check() сервиса операций (§6.4 п. 4)
    const operations = operationsService();
    for (const o of ops) expect(operations.update(w.cid, o.id, { version: 1 }, adminId()).version).toBe(1);

    // справочники: вид, родитель (системная «Зарплата» и новая «Связь»), тип контрагента по категории
    expect(all('SELECT c.name, c.kind, p.name parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id IN (SELECT value FROM json_each((SELECT created FROM imports WHERE id = ?), \'$.categories\')) ORDER BY c.id', importId)).toEqual([
      { name: 'Связь', kind: 'expense', parent: null },
      { name: 'Администраторы', kind: 'expense', parent: 'Зарплата' },
      { name: 'Интернет', kind: 'expense', parent: 'Связь' },
    ]);
    expect(all('SELECT name, type FROM counterparties WHERE company_id = ? ORDER BY id', w.cid)).toEqual([
      { name: 'ИП Клиент', type: 'client' },
      { name: 'Сотрудник А', type: 'employee' },
      { name: 'Поставщик Б', type: 'supplier' },
    ]);
    expect(one("SELECT template_key, template_params FROM projects WHERE name = 'Клуб 9'")).toEqual({ template_key: 'general', template_params: '{}' });
    expect(all('SELECT t.name FROM operation_tags ot JOIN tags t ON t.id = ot.tag_id ORDER BY t.id').map((t) => t.name)).toEqual(['Смена', 'Ночь']);

    // остатки: «Остаток после импорта» существующего счёта и «Текущий остаток» нового — ровно как указаны
    const balances = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
    const bank = one("SELECT id, starting_balance, opened_at FROM accounts WHERE name = 'Банк-2'");
    expect(balances.get(w.kzt)).toBe(2_000_000);
    expect(balances.get(bank.id)).toBe(1_000_000);
    expect(bank).toMatchObject({ starting_balance: 1_000_000 - (5_000_000 - 820_050), opened_at: '2026-10-04' });
    // и ровно как обещали карточки счетов проверки, которую видел человек
    expectPromisedBalances(p.accounts);
    // дата открытия «Кассы» перенесена на первую операцию файла (инвариант 6)
    expect(one('SELECT opened_at, starting_balance FROM accounts WHERE id = ?', w.kzt)).toEqual({
      opened_at: '2026-09-20',
      starting_balance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000),
    });

    // запись imports: счётчики, id созданного, изменения существующих счетов
    const row = one('SELECT status, counts, created, account_changes, user_id FROM imports WHERE id = ?', importId);
    expect(row.status).toBe('done');
    expect(row.user_id).toBe(adminId());
    expect(JSON.parse(row.counts)).toEqual(counts);
    expect(JSON.parse(row.created)).toEqual({
      accounts: [bank.id],
      categories: ['Связь', 'Администраторы', 'Интернет'].map((n) => one('SELECT id FROM categories WHERE company_id = ? AND name = ?', w.cid, n).id),
      counterparties: ['Сотрудник А', 'Поставщик Б'].map((n) => one('SELECT id FROM counterparties WHERE company_id = ? AND name = ?', w.cid, n).id),
      projects: [one("SELECT id FROM projects WHERE name = 'Клуб 9'").id],
      tags: [one("SELECT id FROM tags WHERE name = 'Ночь'").id],
      // «Текущий остаток» 10 000: стартовый баланс, рассчитанный импортом (по нему отмена решает, обнулять ли, — решение 16 плана И-3)
      computedStarts: { [String(bank.id)]: 1_000_000 - (5_000_000 - 820_050) },
    });
    expect(JSON.parse(row.account_changes)).toEqual([
      { accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000), openedAt: '2026-09-20' } },
    ]);

    // история: одна запись импорта, записи создания справочников и изменения счёта с importId, у операций — ничего
    const audit = all('SELECT entity, action, entity_id eid, diff FROM audit_log WHERE company_id = ? AND audit_log.id > (SELECT MAX(id) FROM audit_log WHERE entity = \'rate\') ORDER BY audit_log.id', w.cid)
      .filter((a) => a.diff?.includes('importId') || a.entity === 'import')
      .map((a) => ({ entity: a.entity as string, action: a.action as string, eid: a.eid as number, diff: JSON.parse(a.diff) }));
    expect(audit.map((a) => `${a.entity} ${a.action}`)).toEqual([
      'account create',
      'account update',
      'category create',
      'category create',
      'category create',
      'counterparty create',
      'counterparty create',
      'project create',
      'tag create',
      'import create',
    ]);
    expect(audit.at(-1)).toEqual({
      entity: 'import',
      action: 'create',
      eid: importId,
      diff: { fileName: 'выгрузка.xlsx', counts, created: { accounts: 1, categories: 3, counterparties: 2, projects: 1, tags: 1 } },
    });
    expect(audit[1]!.diff).toEqual({
      before: { startingBalance: 0, openedAt: '2026-10-01' },
      after: { startingBalance: 2_000_000 - (1_059_600 - 850_000 - 5_000_000), openedAt: '2026-09-20' },
      importId,
    });
    expect(audit.slice(0, -1).every((a) => a.diff.importId === importId)).toBe(true);
    expect(w.h.auditCount('operation')).toBe(0);

    // токен удалён: повторное «Импортировать» — 410
    const again = await commit(p, mappings);
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('IMPORT_EXPIRED');
  });

  it('ошибки строк блокируют запись: 422 IMPORT_INVALID со свежим предпросмотром, база не изменилась', async () => {
    w = await opsWorld();
    const p = await uploaded([...FILE, fr({ paidAt: 'вчера', amount: 1, to: 'Касса' })]);
    expect(p.canImport).toBe(false);
    const before = tableCounts();
    const res = await commit(p);
    expect(res.statusCode).toBe(422);
    const e = res.json().error;
    expect(e).toMatchObject({
      code: 'IMPORT_INVALID',
      message: 'Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке',
    });
    expect(e.details.preview.errors.byCode.map((g: { code: string }) => g.code)).toEqual(['R02']);
    expect(tableCounts()).toEqual(before);
  });

  it('между проверкой и записью: счёт ушёл в архив — 422 (A5); появилась категория — 409 IMPORT_CHANGED, повтор с новой версией использует её', async () => {
    w = await opsWorld();
    const rows = [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, from: 'Валютный', category: 'Обед' })];
    const mapping: AccountMapping[] = [{ key: 'валютный', kind: 'existing', accountId: w.usd }];
    const p = await previewWith(await uploaded(rows), mapping);
    expect(p.canImport).toBe(true);
    expect(p.create.categories.total).toBe(1);

    await w.post(`${w.ops.replace('/operations', '')}/accounts/${w.usd}/archive`, {});
    const before = tableCounts();
    const invalid = await commit(p, mapping);
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.details.preview.accounts[0].errors).toEqual([{ code: 'A5', message: 'Счёт «Валютный» в архиве — выберите другой' }]);
    await w.post(`${w.ops.replace('/operations', '')}/accounts/${w.usd}/unarchive`, {});

    // другой пользователь добавил категорию «Обед»: итог другой — 409 со свежим предпросмотром, ничего не записано
    const lunch = (await w.post(`${w.ops.replace('/operations', '')}/categories`, { kind: 'expense', name: 'Обед' })).category.id as number;
    const changed = await commit(p, mapping);
    expect(changed.statusCode).toBe(409);
    const e = changed.json().error;
    expect(e).toMatchObject({ code: 'IMPORT_CHANGED', message: 'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз' });
    const fresh = e.details.preview as ImportPreview;
    expect(fresh.create.categories.total).toBe(0);
    expect(fresh.revision).not.toBe(p.revision);
    // из архива и новая категория — две записи истории; импорт ничего не записал
    expect(tableCounts()).toEqual({ ...before, categories: before.categories + 1, audit: before.audit + 2 });

    const ok = await commit(fresh, mapping);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as ImportCommitResult).import.created.categories).toBe(0);
    expect(one('SELECT category_id FROM operation_lines').category_id).toBe(lunch);
  });

  it('архивная компания — 422; токен другой компании или пользователя — 410; без версии — 400', async () => {
    w = await opsWorld();
    const p = await uploaded(FILE);
    const other = await w.h.company('Другая');
    expect((await commit(p, [], other)).statusCode).toBe(410);
    await seedUser(w.h.t, 'second', 'second-password-1');
    const cookie2 = await loginAs(w.h.t, 'second', 'second-password-1');
    const asSecond = await w.h.t.app.inject({ method: 'POST', url: importsUrl(), headers: { ...ORIGIN_HEADERS, cookie: cookie2 }, payload: { token: p.token, accounts: [], revision: p.revision } });
    expect(asSecond.statusCode).toBe(410);
    const noRevision = await w.h.req('POST', importsUrl(), { token: p.token, accounts: [] });
    expect(noRevision.statusCode).toBe(400);
    expect(noRevision.json().error.code).toBe('VALIDATION');

    const q = await uploaded(FILE, other);
    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    const archived = await commit(q, [], other);
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('повторный импорт того же файла: все строки — дубликаты, W8, импортировать нечего (422)', async () => {
    w = await opsWorld();
    expect((await commit(await uploaded(FILE))).statusCode).toBe(201);
    const again = await uploaded(FILE);
    expect(again.counts).toMatchObject({ add: 0, duplicates: 4 });
    expect(again.warnings.map((g) => g.code)).toContain('W8');
    expect(again.canImport).toBe(false);
    const nothing = await commit(again);
    expect(nothing.statusCode).toBe(422);
    // ошибок нет, просто всё уже есть в компании — отдельный текст
    expect(nothing.json().error).toMatchObject({ code: 'IMPORT_INVALID', message: 'Нечего импортировать: все операции из файла уже есть в компании' });
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(4);
  });

  it('валюты: счёт USD без F — курс на дату, с F — F и производный курс; перевод KZT → USD — сумма зачисления по курсу', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 20, baseAmount: 9600, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-02', '12:00:00'), amount: 4751.2, from: 'Касса', to: 'Валютный' }),
    ];
    const res = await commit(await uploaded(rows));
    expect(res.statusCode, res.body).toBe(201);
    expect(all('SELECT type, amount, base_amount, rate, to_amount FROM operations ORDER BY id')).toEqual([
      { type: 'expense', amount: 1000, base_amount: 475_120, rate: '475.12', to_amount: null },
      { type: 'expense', amount: 2000, base_amount: 960_000, rate: '480', to_amount: null },
      { type: 'transfer', amount: 475_120, base_amount: 475_120, rate: '1', to_amount: 1000 },
    ]);
  });
});

describe('атомарность записи (§6.4 п. 5)', () => {
  it('сбой после половины операций — ни операций, ни справочников, ни счетов, ни imports, ни истории', async () => {
    w = await opsWorld();
    const db = w.h.t.db;
    const audit = createAuditService(db);
    const rates = createRatesService({ db, audit });
    const categories = createCategoriesService({ db, audit });
    const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty', now: () => NOW });
    const companies = createCompaniesService({ db, audit, categories, accounts });
    const real = createOperationsWriter(w.h.t.sqlite);
    let written = 0;
    const failing: OperationsWriter = {
      insertImported(tx, batch) {
        written = real.insertImported(tx, { ...batch, rows: batch.rows.slice(0, Math.ceil(batch.rows.length / 2)) }).length;
        throw new Error('сбой записи');
      },
    };
    const imports = createImportsService({
      db,
      audit,
      rates,
      timezone: 'Asia/Almaty',
      now: () => NOW,
      accounts,
      categories,
      counterparties: createCounterpartiesService({ db, audit }),
      projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
      tags: createTagsService({ db, audit }),
      writer: failing,
    });
    const p = imports.upload(w.cid, adminId(), { name: 'выгрузка.xlsx', data: finmapLikeXlsx(FILE) });
    const mappings: AccountMapping[] = [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1 } }];
    const q = imports.preview(w.cid, adminId(), { token: p.token, accounts: mappings });
    const before = tableCounts();
    expect(() => imports.commit(w.cid, adminId(), { token: q.token, accounts: mappings, revision: q.revision })).toThrow('сбой записи');
    expect(written).toBe(2);
    expect(tableCounts()).toEqual(before);
  });
});

describe('писатель получает только корректные строки: родитель в архиве, перевод в одной валюте, комментарий с пробелами', () => {
  it('родитель новой подкатегории ушёл в архив между проверкой и записью — 422 с R17, база не изменилась', async () => {
    w = await opsWorld();
    const rows = [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 100, from: 'Касса', category: 'Аренда', subcategory: 'Электричество' })];
    const p = await uploaded(rows);
    expect(p.canImport).toBe(true);
    expect(p.create.categories.items).toEqual([{ name: 'Электричество', kind: 'expense', parent: 'Аренда', rows: 1 }]);

    await w.post(`${w.ops.replace('/operations', '')}/categories/${w.expense}/archive`, {});
    const before = tableCounts();
    const res = await commit(p);
    expect(res.statusCode).toBe(422);
    const e = res.json().error;
    expect(e.code).toBe('IMPORT_INVALID');
    expect(e.details.preview.errors.byCode.map((g: { code: string }) => g.code)).toEqual(['R17']);
    expect(tableCounts()).toEqual(before);

    // родитель в архиве уже при загрузке — та же R17, «Будет создано» пусто
    const again = await uploaded(rows);
    expect(again.canImport).toBe(false);
    expect(again.create.categories.total).toBe(0);
  });

  it('перевод между счетами одной валюты: сумма зачисления равна сумме списания; каждая операция проходит check()', async () => {
    w = await opsWorld();
    const kassa2 = (await w.post(`${w.ops.replace('/operations', '')}/accounts`, { name: 'Касса-2', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    const rows = [
      // существующий → новый (Банк-2 по умолчанию — новый счёт в базовой валюте)
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 1234.56, from: 'Касса', to: 'Банк-2' }),
      // существующий → существующий
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 700, from: 'Касса', to: 'Касса-2' }),
      // USD → USD: тот же счёт быть не может, поэтому новый «Валютный-2» в USD
      fr({ paidAt: at('2026-10-02', '12:00:00'), amount: 5.5, from: 'Валютный', to: 'Валютный-2' }),
    ];
    const mappings: AccountMapping[] = [{ key: 'валютный-2', kind: 'new', name: 'Валютный-2', currency: 'USD', balance: null }];
    const p = await previewWith(await uploaded(rows), mappings);
    expect(p.canImport).toBe(true);
    const res = await commit(p, mappings);
    expect(res.statusCode, res.body).toBe(201);
    const ops = all('SELECT id, type, account_id, to_account_id, amount, to_amount, base_amount, rate FROM operations ORDER BY id');
    expect(ops.map((o) => [o.type, o.amount, o.to_amount, o.base_amount, o.rate])).toEqual([
      ['transfer', 123_456, 123_456, 123_456, '1'],
      ['transfer', 70_000, 70_000, 70_000, '1'],
      ['transfer', 550, 550, 261_316, '475.12'],
    ]);
    expect(ops[1]!.to_account_id).toBe(kassa2);
    const operations = operationsService();
    for (const o of ops) expect(operations.update(w.cid, o.id, { version: 1 }, adminId()).version).toBe(1);
  });

  it('комментарий с пробелами по краям записывается без них; из одних пробелов — пустой', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, from: 'Касса', category: 'Аренда', comment: '  Свет  за октябрь \t' }),
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 20, from: 'Касса', category: 'Аренда', comment: '   ' }),
    ];
    const res = await commit(await uploaded(rows));
    expect(res.statusCode, res.body).toBe(201);
    const ops = all('SELECT id, comment FROM operations ORDER BY id');
    expect(ops.map((o) => o.comment)).toEqual(['Свет  за октябрь', null]);
    const operations = operationsService();
    for (const o of ops) expect(operations.update(w.cid, o.id, { version: 1 }, adminId()).version).toBe(1);
  });
});

describe('гонки между проверкой и записью', () => {
  it('два пользователя загрузили один файл: у второго явный «новый счёт», который уже создал первый, — 422 A1; после обновления — «Нечего импортировать» (R3)', async () => {
    w = await opsWorld();
    const mappings: AccountMapping[] = [
      { key: 'касса', kind: 'existing', accountId: w.kzt },
      { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'current', amount: 1_000_000 } },
    ];
    const first = await previewWith(await uploaded(FILE), mappings);
    const second = await secondUser();
    const up2 = await upload(FILE, w.cid, second.cookie);
    expect(up2.statusCode, up2.body).toBe(200);
    const p2res = await second.post(`${importsUrl()}/preview`, { token: (up2.json() as ImportPreview).token, accounts: mappings });
    const p2 = p2res.json() as ImportPreview;
    expect(p2.canImport).toBe(true);

    expect((await commit(first, mappings)).statusCode).toBe(201);
    const bankId = one("SELECT id FROM accounts WHERE name = 'Банк-2'").id as number;

    // второй нажимает «Импортировать» с прежним выбором «Создать новый счёт»: не тихая замена на существующий, а ошибка карточки
    const before = tableCounts();
    const stale = await second.post(importsUrl(), { token: p2.token, accounts: mappings, revision: p2.revision });
    expect(stale.statusCode).toBe(422);
    const e = stale.json().error;
    expect(e).toMatchObject({
      code: 'IMPORT_INVALID',
      message: 'Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке',
    });
    const card = (e.details.preview as ImportPreview).accounts.find((a) => a.key === 'банк-2')!;
    expect(card.mapping).toMatchObject({ kind: 'new', name: 'Банк-2' });
    expect(card.errors).toEqual([{ code: 'A1', message: 'Счёт «Банк-2» уже есть в компании — проверка обновлена, выберите его' }]);
    expect(tableCounts()).toEqual(before);

    // свежая проверка с выбором по умолчанию: «Банк-2» — существующий, все строки — дубликаты
    const fresh = (await second.post(`${importsUrl()}/preview`, { token: p2.token, accounts: [] })).json() as ImportPreview;
    expect(fresh.accounts.find((a) => a.key === 'банк-2')!.mapping).toEqual({ key: 'банк-2', kind: 'existing', accountId: bankId });
    expect(fresh.counts).toMatchObject({ add: 0, duplicates: 4 });
    expect(fresh.canImport).toBe(false);
    const nothing = await second.post(importsUrl(), { token: p2.token, accounts: [], revision: fresh.revision });
    expect(nothing.statusCode).toBe(422);
    expect(nothing.json().error).toMatchObject({ code: 'IMPORT_INVALID', message: 'Нечего импортировать: все операции из файла уже есть в компании' });
    expect(tableCounts()).toEqual(before);
  });

  it('компания ушла в архив после проверки перед транзакцией (другое соединение) — проверка под блокировкой записи: 422, ничего не записано', async () => {
    w = await opsWorld();
    const other = new Database(path.join(w.h.t.dir, 'app.db'));
    try {
      const real = createImportCache({ now: () => NOW.getTime() });
      let archiveOnGet = false;
      // кэш читается после внешней проверки компании и до транзакции записи — ровно там вклинивается чужая запись
      const cache: ImportCache = {
        ...real,
        get(token, companyId, userId) {
          const entry = real.get(token, companyId, userId);
          if (archiveOnGet) other.prepare('UPDATE companies SET archived_at = ? WHERE id = ?').run(NOW.toISOString(), companyId);
          return entry;
        },
      };
      const imports = importsServiceWith(cache);
      const p = imports.upload(w.cid, adminId(), { name: 'выгрузка.xlsx', data: finmapLikeXlsx(FILE) });
      expect(p.canImport).toBe(true);
      const before = tableCounts();
      archiveOnGet = true;
      let err: unknown;
      try {
        imports.commit(w.cid, adminId(), { token: p.token, accounts: [], revision: p.revision });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ARCHIVED_REFERENCE');
      expect(tableCounts()).toEqual(before);
    } finally {
      other.close();
    }
  });

  it('остатки по проводкам после записи — как обещали карточки: существующий без «Остатка после импорта», «Стартовый баланс», пустой остаток', async () => {
    w = await opsWorld();
    w.h.t.sqlite.prepare('UPDATE accounts SET starting_balance = 123400 WHERE id = ?').run(w.kzt);
    const rows = [...FILE, fr({ paidAt: at('2026-10-01', '12:00:00'), amount: 77, to: 'Сейф', category: 'Бар' })];
    const mappings: AccountMapping[] = [
      { key: 'касса', kind: 'existing', accountId: w.kzt },
      { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'start', amount: 300_000 } },
      { key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: null },
    ];
    const p = await previewWith(await uploaded(rows), mappings);
    expect(p.canImport).toBe(true);
    expect(p.accounts.find((a) => a.key === 'касса')!.existing!.balance).toBe(123_400);
    const res = await commit(p, mappings);
    expect(res.statusCode, res.body).toBe(201);
    expectPromisedBalances(p.accounts);
    // и цифры по отдельности: 1 234,00 + 10 596 - 8 500 - 50 000; 3 000 + 50 000 - 8 200,50; 77
    const ledger = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
    expect(ledger.get(w.kzt)).toBe(123_400 + 1_059_600 - 850_000 - 5_000_000);
    expect(ledger.get(one("SELECT id FROM accounts WHERE name = 'Банк-2'").id)).toBe(300_000 + 5_000_000 - 820_050);
    expect(ledger.get(one("SELECT id FROM accounts WHERE name = 'Сейф'").id)).toBe(7_700);
    // «Стартовый баланс» и пустой остаток — введены человеком, не рассчитаны: в computedStarts их нет
    const importId = (res.json() as ImportCommitResult).import.id;
    expect(JSON.parse(one('SELECT created FROM imports WHERE id = ?', importId).created).computedStarts).toEqual({});
  });
});

describe('большой файл (§11.2 «Производительность»)', () => {
  it('16 000 строк: запись укладывается в 20 с, все операции с import_id', { timeout: 120_000 }, async () => {
    w = await opsWorld();
    const rows = finmapLikeMany(16_000);
    const p = await uploaded(rows);
    expect(p.canImport).toBe(true);
    const t0 = performance.now();
    const res = await commit(p);
    const ms = performance.now() - t0;
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    expect((res.json() as ImportCommitResult).counts.added).toBe(16_000);
    expect(one('SELECT COUNT(*) n FROM operations WHERE import_id IS NOT NULL').n).toBe(16_000);
    // бюджет §10 — 5 с на эталонной машине (bench:import); здесь — с запасом для медленного CI
    expect(ms).toBeLessThan(20_000);
  });
});
