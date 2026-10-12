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
    const made = w.h.t.db.transaction((tx) => {
      const top = s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: '  Связь  ' });
      const child = s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: top.id, name: 'Интернет' });
      const cp = s.counterparties.createIn(tx, { companyId: w.cid, type: 'employee', name: 'Сотрудник А' });
      const project = s.projects.createIn(tx, { companyId: w.cid, name: 'Клуб 3' });
      const tag = s.tags.createIn(tx, { companyId: w.cid, name: 'Ночь' });
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
    expect(() =>
      w.h.t.db.transaction((tx) => {
        s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: null, name: 'Новая' });
        s.categories.createIn(tx, { companyId: w.cid, kind: 'expense', parentId: w.income, name: 'Чужой вид' });
      }),
    ).toThrow(`Категория ${w.income} не может быть родителем`);
    expect(one('SELECT COUNT(*) n FROM categories').n).toBe(before);
    // проект с занятым названием (без учёта регистра) — 400, как у обычного создания
    expect(() => w.h.t.db.transaction((tx) => s.projects.createIn(tx, { companyId: w.cid, name: 'клуб 1' }))).toThrow('Проверьте заполнение полей');
  });

  it('add() по-прежнему пишет историю создания (переписан на createIn)', async () => {
    w = await opsWorld();
    const s = services();
    const cp = s.counterparties.add(w.cid, { type: 'supplier', name: 'Поставщик', comment: 'к' }, adminId());
    const tag = s.tags.add(w.cid, 'Утро', adminId());
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
    const writer = createOperationsWriter(w.h.t.sqlite);
    const importId = importRow();
    const rows: ImportedOperation[] = [
      { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 150_000, baseAmount: 150_000, categoryId: w.income, counterpartyId: w.counterparty, projectId: w.project, tagIds: [w.tag, w.tag], comment: 'выручка', accrualDate: '2026-10-01' },
      { ...base, type: 'expense', paidAt: '2026-10-03T04:00:00.000Z', accountId: w.kzt, amount: 50_000, baseAmount: 50_000, categoryId: w.expense },
      { ...base, type: 'transfer', paidAt: '2026-10-04T04:00:00.000Z', accountId: w.kzt, amount: 47_512, toAccountId: w.usd, toAmount: 100, baseAmount: 47_512, projectId: w.project2 },
      { ...base, type: 'transfer', paidAt: '2026-10-05T04:00:00.000Z', accountId: w.usd, amount: 10, toAccountId: w.kzt, toAmount: 4_751, rate: '475.12', baseAmount: 4_751 },
    ];
    const at = '2026-10-06T12:00:00.000Z';
    const ids = w.h.t.db.transaction((tx) => writer.insertImported(tx, { companyId: w.cid, importId, userId: adminId(), at, rows }));
    expect(ids).toHaveLength(4);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const ops = all('SELECT id, type, status, paid_at, version, import_id, created_by, created_at, updated_at, deleted_at FROM operations WHERE import_id = ? ORDER BY id', importId);
    expect(ops.map((o) => [o.type, o.status, o.paid_at, o.version, o.created_by, o.created_at, o.updated_at, o.deleted_at])).toEqual([
      ['income', 'actual', '2026-10-02T04:00:00.000Z', 1, adminId(), at, at, null],
      ['expense', 'actual', '2026-10-03T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-04T04:00:00.000Z', 1, adminId(), at, at, null],
      ['transfer', 'actual', '2026-10-05T04:00:00.000Z', 1, adminId(), at, at, null],
    ]);
    const income = s.operations.get(w.cid, ids[0]!);
    expect(income).toMatchObject({ accrualDate: '2026-10-01', counterpartyId: w.counterparty, comment: 'выручка', tagIds: [w.tag], baseAmount: 150_000, rate: '1' });
    expect(income.lines).toEqual([{ id: expect.any(Number), position: 0, categoryId: w.income, projectId: w.project, amount: 150_000, baseAmount: 150_000 }]);
    expect(s.operations.get(w.cid, ids[1]!).lines).toMatchObject([{ categoryId: w.expense, projectId: null, amount: 50_000 }]);
    expect(s.operations.get(w.cid, ids[2]!).lines).toMatchObject([{ categoryId: null, projectId: w.project2, amount: 47_512, baseAmount: 47_512 }]);
    expect(s.operations.get(w.cid, ids[3]!).lines).toEqual([]);

    // инварианты: правка без изменений проходит check() и ничего не меняет
    for (const id of ids) expect(s.operations.update(w.cid, id, { version: 1 }, adminId()).version).toBe(1);
    // балансы считаются по записанным операциям, как по обычным
    const balances = new Map(createLedgerBalances(w.h.t.db).companyBalances(w.cid).map((b) => [b.accountId, b.balance]));
    expect(balances.get(w.kzt)).toBe(150_000 - 50_000 - 47_512 + 4_751);
    expect(balances.get(w.usd)).toBe(100 - 10);
    // история операций не пишется: одна запись на импорт — у вызывающего (§6.5)
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'operation'").n).toBe(0);
  });

  it('вне транзакции — ошибка, ничего не записано', async () => {
    w = await opsWorld();
    const writer = createOperationsWriter(w.h.t.sqlite);
    const importId = importRow();
    const row: ImportedOperation = { ...base, type: 'income', paidAt: '2026-10-02T04:00:00Z', accountId: w.kzt, amount: 100, baseAmount: 100 };
    expect(() => writer.insertImported(w.h.t.db, { companyId: w.cid, importId, userId: adminId(), at: NOW.toISOString(), rows: [row] })).toThrow('только внутри транзакции');
    expect(one('SELECT COUNT(*) n FROM operations').n).toBe(0);
  });
});
