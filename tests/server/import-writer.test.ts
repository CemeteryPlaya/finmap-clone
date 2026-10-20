import { withTx } from '../../src/server/db/tx';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCounterpartiesService } from '../../src/server/modules/counterparties/service';
import { createOperationsService } from '../../src/server/modules/operations/service';
import { createOperationsWriter, type ImportedOperation } from '../../src/server/modules/operations/writer';
import { createRatesService } from '../../src/server/modules/rates/service';
import { createTagsService } from '../../src/server/modules/tags/service';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z');
const all = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, number>;
const adminId = () => one("SELECT id FROM users WHERE login = 'admin'").id!;

/** Строка imports для внешнего ключа operations.import_id. */
function importRow(): number {
  return Number(
    w.h.t.sqlite
      .prepare(
        "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (?, ?, 'ф.xlsx', 1, 'x', 'done', '{}', '{}', '[]', ?)",
      )
      .run(w.cid, adminId(), NOW.toISOString()).lastInsertRowid,
  );
}

function services() {
  const db = w.h.t.db;
  const audit = createAuditService(db);
  const categories = createCategoriesService({ db, audit });
  const accounts = createAccountsService({ db, audit, timezone: 'Asia/Almaty' });
  const companies = createCompaniesService({ db, audit, categories, accounts });
  return {
    audit,
    categories,
    counterparties: createCounterpartiesService({ db, audit }),
    tags: createTagsService({ db, audit }),
    projects: createProjectsService({ db, audit, companies, categories, accounts, timezone: 'Asia/Almaty' }),
    operations: createOperationsService({ db, audit, rates: createRatesService({ db, audit }), timezone: 'Asia/Almaty', now: () => NOW }),
  };
}

describe('низкоуровневое создание справочников внутри транзакции (§6.4 п. 3.4 спецификации импорта)', () => {
  it('createIn: после имеющихся, без истории; подкатегория — у родителя верхнего уровня; проект — по шаблону «Общий»', async () => {
    w = await opsWorld();
    const s = services();
    const auditBefore = one('SELECT COUNT(*) n FROM audit_log').n;
    const made = await withTx(w.h.t.db, async (tx) => {
      const top = await s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: '  Связь  ' });
      const child = await s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: top.id, name: 'Интернет' });
      const cp = await s.counterparties.createIn(tx, { companyId: w.cid, type: 'employee', name: 'Сотрудник А' });
      const project = await s.projects.createIn(tx, { companyId: w.cid, name: 'Клуб 3' });
      const tag = await s.tags.createIn(tx, { companyId: w.cid, name: 'Ночь' });
      return { top, child, cp, project, tag };
    });
    expect(made.top).toMatchObject({ kind: 'expense', parentId: null, name: 'Связь', systemKey: null });
    expect(made.child).toMatchObject({ parentId: made.top.id, name: 'Интернет', orderIndex: 0 });
    // после имеющихся на своём уровне: верхний уровень расходов уже есть (системные и «Аренда»)
    expect(made.top.orderIndex).toBe(one("SELECT MAX(order_index) m FROM categories WHERE company_id = ? AND kind = 'expense' AND parent_id IS NULL", w.cid).m);
    expect(made.cp).toMatchObject({ type: 'employee', name: 'Сотрудник А', comment: null, orderIndex: 1 });
    expect(made.project).toMatchObject({ name: 'Клуб 3', templateKey: 'general', templateParams: {}, orderIndex: 2 });
    expect(made.tag).toMatchObject({ name: 'Ночь', nameKey: 'ночь', orderIndex: 1 });
    // проект «Общий» не создаёт ни счетов, ни категорий; история — у вызывающего
    expect(one('SELECT COUNT(*) n FROM accounts WHERE project_id = ?', made.project.id).n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM audit_log').n).toBe(auditBefore);
  });

  it('createIn: родитель другого вида или второго уровня — ошибка, транзакция откатывается', async () => {
    w = await opsWorld();
    const s = services();
    const before = one('SELECT COUNT(*) n FROM categories').n;
    await expect(
      withTx(w.h.t.db, async (tx) => {
        await s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: 'Новая' });
        await s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: w.income, name: 'Чужой вид' });
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION', fields: { parentId: 'Родительская категория из другого дерева' } }));
    expect(one('SELECT COUNT(*) n FROM categories').n).toBe(before);
    // родитель в архиве — как у add()
    const archived = await s.categories.add(w.cid, { kind: 'expense', name: 'Архивная', parentId: null }, adminId());
    await s.categories.archive(w.cid, archived.id, adminId());
    await expect(withTx(w.h.t.db, (tx) => s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: archived.id, name: 'Дочерняя' }))).rejects.toThrow(
      'Родительская категория в архиве',
    );
    // проект с занятым названием (без учёта регистра) — 400, как у обычного создания
    await expect(withTx(w.h.t.db, (tx) => s.projects.createIn(tx, { companyId: w.cid, name: 'клуб 1' }))).rejects.toThrow('Проверьте заполнение полей');
  });

  it('add() по-прежнему пишет историю создания (переписан на createIn)', async () => {
    w = await opsWorld();
    const s = services();
    const cp = await s.counterparties.add(w.cid, { type: 'supplier', name: 'Поставщик', comment: 'к' }, adminId());
    const tag = await s.tags.add(w.cid, 'Утро', adminId());
    expect(all("SELECT entity, entity_id AS eid, diff FROM audit_log WHERE action = 'create' AND entity IN ('counterparty', 'tag') ORDER BY audit_log.id DESC LIMIT 2")).toEqual([
      { entity: 'tag', eid: tag.id, diff: JSON.stringify({ name: 'Утро' }) },
      { entity: 'counterparty', eid: cp.id, diff: JSON.stringify({ type: 'supplier', name: 'Поставщик', comment: 'к' }) },
    ]);
  });
});

describe('OperationsWriter.insertImported (§6.4 п. 3.5)', () => {
  const base = { accrualDate: null, toAccountId: null, toAmount: null, rate: '1', counterpartyId: null, comment: null, categoryId: null, projectId: null, tagIds: [] };

  it('доход, расход, перевод с проектом и без: строки, теги, import_id, version 1; каждая проходит check() сервиса операций', async () => {
    w = await opsWorld();
    const s = services();
    const writer = createOperationsWriter();
    const importId = importRow();
    const rows: ImportedOperation[] = [
      { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 150_000, baseAmount: 150_000, categoryId: w.income, counterpartyId: w.counterparty, projectId: w.project, tagIds: [w.tag, w.tag], comment: 'выручка', accrualDate: '2026-10-01' },
      { ...base, type: 'expense', paidAt: '2026-10-03T04:00:00.000Z', accountId: w.kzt, amount: 50_000, baseAmount: 50_000, categoryId: w.expense },
      { ...base, type: 'transfer', paidAt: '2026-10-04T04:00:00.000Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100, baseAmount: 47_512, projectId: w.project2 },
      { ...base, type: 'transfer', paidAt: '2026-10-05T04:00:00.000Z', accountId: w.usd, amount: 10, toAccountId: w.kzt, toAmount: 4_751, rate: '475.12', baseAmount: 4_751 },
    ];
    const at = '2026-10-06T12:00:00.000Z';
    const ids = await withTx(w.h.t.db, (tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at, rows }));
    expect(ids).toHaveLength(4);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const ops = all('SELECT id, type, status, paid_at, version, import_id, created_by, created_at, updated_at, deleted_at FROM operations WHERE import_id = ? ORDER BY id', importId);
    expect(ops.map((o) => [o.type, o.status, o.paid_at, o.version, o.created_by, o.created_at, o.updated_at, o.deleted_at])).toEqual([
      ['income', 'actual', '2026-10-02T04:00:00.000Z', 1, adminId(), at, at, null],
      ['expense', 'actual', '2026-10-03T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-04T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-05T04:00:00.000Z', 1, adminId(), at, at, null],
    ]);
    const income = await s.operations.get(w.cid, ids[0]!);
    expect(income).toMatchObject({ accrualDate: '2026-10-01', counterpartyId: w.counterparty, comment: 'выручка', tagIds: [w.tag], baseAmount: 150_000, rate: '1' });
    expect(income.lines).toEqual([{ id: expect.any(Number), position: 0, categoryId: w.income, projectId: w.project, amount: 150_000, baseAmount: 150_000 }]);
    expect((await s.operations.get(w.cid, ids[1]!)).lines).toMatchObject([{ categoryId: w.expense, projectId: null, amount: 50_000 }]);
    expect((await s.operations.get(w.cid, ids[2]!)).lines).toMatchObject([{ categoryId: null, projectId: w.project2, amount: 47_512, baseAmount: 47_512 }]);
    expect((await s.operations.get(w.cid, ids[3]!)).lines).toEqual([]);

    // инварианты: правка без изменений проходит check() и ничего не меняет
    for (const id of ids) expect((await s.operations.update(w.cid, id, { version: 1 }, adminId())).version).toBe(1);
    // балансы считаются по записанным операциям, как по обычным
    const balances = new Map((await createLedgerBalances(w.h.t.db).companyBalances(w.cid)).map((b) => [b.accountId, b.balance]));
    expect(balances.get(w.kzt)).toBe(150_000 - 50_000 - 47_512 + 4_751);
    expect(balances.get(w.usd)).toBe(100 - 10);
    // история операций не пишется: одна запись на импорт — у вызывающего (§6.5)
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'operation'").n).toBe(0);
  });

  it('эквивалентно OperationsService.create: те же строки operations, operation_lines и operation_tags', async () => {
    w = await opsWorld();
    const s = services();
    const writer = createOperationsWriter();
    const kzt2 = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Касса 2', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    const day = (n: number) => `2026-10-0${n}T04:00:00.000Z`;
    // пары «вход create / вход insertImported» одного смысла; rate и baseAmount импорта — как их считает предпросмотр
    const cases: [Parameters<typeof s.operations.create>[1], ImportedOperation][] = [
      [
        { type: 'income', paidAt: day(1), accrualDate: '2026-10-01', accountId: w.kzt, amount: 150_000, toAccountId: null, toAmount: null, counterpartyId: w.counterparty, comment: 'выручка', lines: [{ categoryId: w.income, projectId: w.project, amount: 150_000 }], tagIds: [] },
        { ...base, type: 'income', paidAt: day(1), accrualDate: '2026-10-01', accountId: w.kzt, amount: 150_000, baseAmount: 150_000, counterpartyId: w.counterparty, comment: 'выручка', categoryId: w.income, projectId: w.project },
      ],
      [
        { type: 'expense', paidAt: day(2), accrualDate: null, accountId: w.kzt, amount: 50_000, toAccountId: null, toAmount: null, counterpartyId: null, comment: 'аренда', lines: [{ categoryId: w.expense, projectId: null, amount: 50_000 }], tagIds: [w.tag] },
        { ...base, type: 'expense', paidAt: day(2), accountId: w.kzt, amount: 50_000, baseAmount: 50_000, comment: 'аренда', categoryId: w.expense, tagIds: [w.tag, w.tag] },
      ],
      [
        { type: 'expense', paidAt: day(3), accrualDate: null, accountId: w.usd, amount: 10, toAccountId: null, toAmount: null, counterpartyId: null, comment: null, lines: [{ categoryId: w.expense, projectId: w.project2, amount: 10 }], tagIds: [] },
        { ...base, type: 'expense', paidAt: day(3), accountId: w.usd, amount: 10, rate: '475.12', baseAmount: 4_751, categoryId: w.expense, projectId: w.project2 },
      ],
      [
        { type: 'expense', paidAt: day(3), accrualDate: null, accountId: w.kzt, amount: 700, toAccountId: null, toAmount: null, counterpartyId: null, comment: null, lines: [], tagIds: [] },
        { ...base, type: 'expense', paidAt: day(3), accountId: w.kzt, amount: 700, baseAmount: 700 },
      ],
      [
        { type: 'transfer', paidAt: day(4), accrualDate: null, accountId: w.kzt, amount: 9_000, toAccountId: kzt2, toAmount: null, counterpartyId: null, comment: null, lines: [], tagIds: [] },
        { ...base, type: 'transfer', paidAt: day(4), accountId: w.kzt, amount: 9_000, toAccountId: kzt2, toAmount: 9_000, baseAmount: 9_000 },
      ],
      [
        { type: 'transfer', paidAt: day(4), accrualDate: null, accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100, counterpartyId: null, comment: 'обмен', lines: [{ categoryId: null, projectId: w.project, amount: 47_512 }], tagIds: [w.tag] },
        { ...base, type: 'transfer', paidAt: day(4), accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100, baseAmount: 47_512, comment: 'обмен', projectId: w.project, tagIds: [w.tag] },
      ],
      [
        { type: 'transfer', paidAt: day(5), accrualDate: null, accountId: w.usd, amount: 10, toAccountId: w.kzt, toAmount: 4_751, counterpartyId: null, comment: null, lines: [], tagIds: [] },
        { ...base, type: 'transfer', paidAt: day(5), accountId: w.usd, amount: 10, toAccountId: w.kzt, toAmount: 4_751, rate: '475.12', baseAmount: 4_751 },
      ],
    ];
    const viaService: number[] = [];
    for (const [input] of cases) viaService.push((await s.operations.create(w.cid, input, adminId())).id);
    const importId = importRow();
    const viaWriter = await withTx(w.h.t.db, (tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: cases.map(([, row]) => row) }));
    // без id, import_id и меток времени (у create их ставит now(), у импорта — batch.at; в тесте оба равны NOW, но не часть эквивалентности)
    const snapshot = (id: number) => {
      const { id: _id, import_id, created_at, updated_at, ...op } = one('SELECT * FROM operations WHERE id = ?', id) as Record<string, unknown>;
      void import_id, created_at, updated_at;
      return {
        op,
        lines: all('SELECT position, category_id, project_id, amount, base_amount FROM operation_lines WHERE operation_id = ? ORDER BY position', id),
        tags: all('SELECT tag_id FROM operation_tags WHERE operation_id = ? ORDER BY tag_id', id),
      };
    };
    viaService.forEach((svcId, i) => expect(snapshot(viaWriter[i]!), `случай ${i + 1}`).toEqual(snapshot(svcId)));
    expect(one('SELECT COUNT(*) n FROM operations WHERE import_id = ?', importId).n).toBe(cases.length);
  });

  it('защитные проверки: перевод без суммы зачисления или с категорией, неположительная и не целая сумма', async () => {
    w = await opsWorld();
    const writer = createOperationsWriter();
    const importId = importRow();
    const transfer: ImportedOperation = { ...base, type: 'transfer', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, toAccountId: w.usd, toAmount: 1, baseAmount: 100 };
    const income: ImportedOperation = { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, baseAmount: 100 };
    const insert = (row: ImportedOperation) => withTx(w.h.t.db, (tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: [row] }));
    await expect(insert({ ...transfer, toAmount: null })).rejects.toThrow('у перевода нужны счёт и сумма зачисления');
    await expect(insert({ ...transfer, categoryId: w.expense })).rejects.toThrow('у перевода нет категории');
    await expect(insert({ ...income, amount: 0 })).rejects.toThrow('сумма — положительное целое');
    await expect(insert({ ...income, amount: -5 })).rejects.toThrow('сумма — положительное целое');
    await expect(insert({ ...income, amount: 1.5 })).rejects.toThrow('сумма — положительное целое');
    await expect(insert({ ...income, amount: Number.MAX_SAFE_INTEGER + 2 })).rejects.toThrow('сумма — положительное целое');
    await expect(insert({ ...income, toAmount: 5 })).rejects.toThrow('только у перевода');
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
  });

  it('защитные проверки: перевод без счёта зачисления, на тот же счёт; сумма в валюте компании — неотрицательное безопасное целое', async () => {
    w = await opsWorld();
    const writer = createOperationsWriter();
    const importId = importRow();
    const transfer: ImportedOperation = { ...base, type: 'transfer', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, toAccountId: w.usd, toAmount: 1, baseAmount: 100 };
    const income: ImportedOperation = { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, baseAmount: 100 };
    const insert = (row: ImportedOperation) => withTx(w.h.t.db, (tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: [row] }));
    await expect(insert({ ...transfer, toAccountId: null })).rejects.toThrow('у перевода нужны счёт и сумма зачисления');
    await expect(insert({ ...transfer, toAccountId: w.kzt, toAmount: 100 })).rejects.toThrow('перевод на тот же счёт');
    await expect(insert({ ...income, baseAmount: -1 })).rejects.toThrow('сумма в валюте компании — неотрицательное целое');
    await expect(insert({ ...income, baseAmount: 1.5 })).rejects.toThrow('сумма в валюте компании — неотрицательное целое');
    await expect(insert({ ...income, baseAmount: Number.MAX_SAFE_INTEGER + 2 })).rejects.toThrow('сумма в валюте компании — неотрицательное целое');
    await expect(insert({ ...income, baseAmount: Number.NaN })).rejects.toThrow('сумма в валюте компании — неотрицательное целое');
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
    // ноль допустим: сумма в валюте компании от очень малой суммы по курсу округляется до нуля
    await insert({ ...income, baseAmount: 0 });
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(1);
  });

  it('вне транзакции — ошибка, ничего не записано', async () => {
    w = await opsWorld();
    const writer = createOperationsWriter();
    const importId = importRow();
    const row: ImportedOperation = { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, baseAmount: 100 };
    await expect(writer.insertImported(w.h.t.db, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: [row] })).rejects.toThrow('только внутри транзакции');
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
  });
});
