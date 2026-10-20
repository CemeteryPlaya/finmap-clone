import { eq } from 'drizzle-orm';
import type { ImportCounts, ImportCreatedCounts, ImportRecord } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { accounts, imports } from '../../db/schema';
import type { AccountsService } from '../accounts/service';
import { changedFields } from '../audit/mutate';
import type { AuditEntry } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CounterpartiesService } from '../counterparties/service';
import type { ImportedOperation, OperationsWriter } from '../operations/writer';
import type { ProjectsService } from '../projects/service';
import type { TagsService } from '../tags/service';
import type { Ref } from './match';
import type { ImportPlan } from './preview';

/** Сервисы записи импорта: низкоуровневое создание внутри транзакции и вставка операций (§6.4 спецификации импорта). */
export interface ImportWriterDeps {
  accounts: AccountsService;
  categories: CategoriesService;
  counterparties: CounterpartiesService;
  projects: ProjectsService;
  tags: TagsService;
  writer: OperationsWriter;
}

export interface ImportWriteInput {
  companyId: number;
  userId: number;
  /** Момент записи: imports.created_at, created_at и updated_at операций. */
  at: string;
  file: { name: string; size: number; sha256: string };
  counts: ImportCounts;
  plan: ImportPlan;
}

/** Id созданного импортом (imports.created, §6.1): по ним отмена (план И-3) удаляет неиспользуемое. */
export interface ImportCreatedIds {
  accounts: number[];
  categories: number[];
  counterparties: number[];
  projects: number[];
  tags: number[];
  /**
   * Стартовые балансы новых счетов «Текущего остатка», рассчитанные импортом: id счёта → значение. По ним отмена
   * обнуляет стартовый баланс оставленного счёта, только если его не меняли (решение 16 плана И-3). У импортов, записанных
   * раньше, поля нет.
   */
  computedStarts: Record<string, number>;
}

/**
 * Запись плана импорта внутри транзакции вызывающего (§6.4 п. 3): строка imports, новые счета, изменения существующих
 * счетов, справочники (категории верхнего уровня, подкатегории, контрагенты, проекты, теги — родители раньше детей),
 * операции, история (§6.5). Любое исключение откатывает всё. Ссылка плана на новый элемент без созданного элемента —
 * внутренняя ошибка (план строится вместе со справочниками, этого не бывает).
 */
export async function writeImport(
  tx: Executor,
  deps: ImportWriterDeps,
  input: ImportWriteInput,
  record: (entry: AuditEntry) => number | Promise<number>,
): Promise<ImportRecord> {
  const { companyId, userId, at, plan, file, counts } = input;
  const [inserted] = await tx
    .insert(imports)
    .values({
      companyId,
      userId,
      fileName: file.name,
      fileSize: file.size,
      fileSha256: file.sha256,
      status: 'done',
      counts: JSON.stringify(counts),
      created: '{}',
      accountChanges: '[]',
      createdAt: at,
    })
    .returning({ id: imports.id });
  const importId = inserted!.id;
  const created: ImportCreatedIds = { accounts: [], categories: [], counterparties: [], projects: [], tags: [], computedStarts: {} };
  const audit = async (entity: string, entityId: number, action: 'create' | 'update', diff: Record<string, unknown>) => {
    await record({ companyId, userId, entity, entityId, action, diff: { ...diff, importId } });
  };

  // новые счета: стартовый баланс и дата открытия — из плана (§5.4)
  const accountIds = new Map<string, number>();
  for (const a of plan.accounts) {
    const row = await deps.accounts.create(tx, { companyId, name: a.name, currency: a.currency, startingBalance: a.startingBalance, openedAt: a.openedAt });
    accountIds.set(a.key, row.id);
    created.accounts.push(row.id);
    if (a.computedStart) created.computedStarts[String(row.id)] = row.startingBalance;
    await audit('account', row.id, 'create', { name: row.name, currency: row.currency, startingBalance: row.startingBalance, openedAt: row.openedAt, projectId: row.projectId });
  }
  // существующие счета: перенос даты открытия и новый стартовый баланс; прежние значения — в account_changes
  for (const c of plan.accountChanges) {
    await tx.update(accounts).set(c.after).where(eq(accounts.id, c.accountId));
    const changes = changedFields(c.before, c.after);
    if (changes) await audit('account', c.accountId, 'update', changes);
  }

  const resolve = (r: Ref, made: Map<string, number>, what: string): number => {
    if ('id' in r) return r.id;
    const id = made.get(r.key);
    if (id === undefined) throw new Error(`Импорт: ${what} «${r.key}» не создан`);
    return id;
  };
  // справочники в порядке плана: категории верхнего уровня, затем подкатегории (родитель уже создан)
  const categoryIds = new Map<string, number>();
  for (const c of plan.categories) {
    const parentId = c.parent ? resolve(c.parent, categoryIds, 'категория') : null;
    const row = await deps.categories.createIn(tx, { companyId, kind: c.kind, parentId, name: c.name });
    categoryIds.set(c.key, row.id);
    created.categories.push(row.id);
    await audit('category', row.id, 'create', { kind: row.kind, name: row.name, parentId: row.parentId });
  }
  const counterpartyIds = new Map<string, number>();
  for (const c of plan.counterparties) {
    const row = await deps.counterparties.createIn(tx, { companyId, type: c.type, name: c.name });
    counterpartyIds.set(c.key, row.id);
    created.counterparties.push(row.id);
    await audit('counterparty', row.id, 'create', { type: row.type, name: row.name, comment: row.comment });
  }
  const projectIds = new Map<string, number>();
  for (const p of plan.projects) {
    const row = await deps.projects.createIn(tx, { companyId, name: p.name });
    projectIds.set(p.key, row.id);
    created.projects.push(row.id);
    await audit('project', row.id, 'create', { name: row.name, templateKey: row.templateKey, templateParams: row.templateParams, applied: { categories: 0, accounts: 0 } });
  }
  const tagIds = new Map<string, number>();
  for (const t of plan.tags) {
    const row = await deps.tags.createIn(tx, { companyId, name: t.name });
    tagIds.set(t.key, row.id);
    created.tags.push(row.id);
    await audit('tag', row.id, 'create', { name: row.name });
  }

  // операции — по (paidAt, номер строки): id растут по времени (§6.4 п. 3.5)
  const rows: ImportedOperation[] = plan.rows.map((r) => ({
    type: r.type,
    paidAt: r.paidAt,
    accrualDate: r.accrualDate,
    accountId: resolve(r.account, accountIds, 'счёт'),
    amount: r.amount,
    toAccountId: r.toAccount ? resolve(r.toAccount, accountIds, 'счёт') : null,
    toAmount: r.toAmount,
    rate: r.rate,
    baseAmount: r.baseAmount,
    counterpartyId: r.counterparty ? resolve(r.counterparty, counterpartyIds, 'контрагент') : null,
    comment: r.comment,
    categoryId: r.category ? resolve(r.category, categoryIds, 'категория') : null,
    projectId: r.project ? resolve(r.project, projectIds, 'проект') : null,
    tagIds: r.tags.map((t) => resolve(t, tagIds, 'тег')),
  }));
  await deps.writer.insertImported(tx, { companyId, importId, userId, at, rows });

  // одна запись истории на импорт; у операций своих записей нет (§6.5)
  const createdCounts: ImportCreatedCounts = {
    accounts: created.accounts.length,
    categories: created.categories.length,
    counterparties: created.counterparties.length,
    projects: created.projects.length,
    tags: created.tags.length,
  };
  await record({ companyId, userId, entity: 'import', entityId: importId, action: 'create', diff: { fileName: file.name, counts, created: createdCounts } });
  await tx
    .update(imports)
    .set({ created: JSON.stringify(created), accountChanges: JSON.stringify(plan.accountChanges) })
    .where(eq(imports.id, importId));
  return { id: importId, fileName: file.name, fileSize: file.size, status: 'done', createdAt: at, counts, created: createdCounts };
}
