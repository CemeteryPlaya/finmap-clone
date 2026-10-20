import { and, eq, inArray, isNotNull, isNull, min, or, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportCreatedCounts, ImportCreatedEntity, ImportKeptAccountField, ImportUndoResult } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { first } from '../../db/raw';
import { accounts, attachments, categories, counterparties, imports, operationLines, operations, operationTags, projects, stockDocs, stockWarehouses, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields } from '../audit/mutate';
import type { AuditEntry } from '../audit/service';
import type { ImportCreatedIds } from './commit';
import { chunks, EDITED_SQL } from './history';
import type { PlannedAccountChange } from './preview';

export interface UndoInput {
  companyId: number;
  importId: number;
  userId: number;
  /** Момент отмены: imports.undone_at. */
  at: string;
  /** «Удалить и изменённые». */
  includeEdited: boolean;
  /** Сколько изменённых операций видел человек в подтверждении. */
  edited: number;
  timezone: string;
}

/** Множественное число вида — ключ ImportCreatedCounts. */
const PLURAL: Record<ImportCreatedEntity, keyof ImportCreatedCounts> = {
  account: 'accounts',
  category: 'categories',
  counterparty: 'counterparties',
  project: 'projects',
  tag: 'tags',
};
const zero = (): ImportCreatedCounts => ({ accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 });
/** Не больше названий оставленного в итоге. */
const KEPT_NAMES_MAX = 20;

/** Есть ли хоть одна строка: «используется». */
const exists = (row: unknown) => row !== undefined;

/**
 * Отмена импорта внутри транзакции вызывающего (§7.3 спецификации импорта): проверки, жёсткое удаление операций импорта
 * (изменённые — только с includeEdited), удаление неиспользуемых созданных справочников и счетов, возврат стартового
 * баланса и даты открытия существующих счетов, отметка imports и история (§6.5). Ошибка — исключение: вызывающий
 * откатывает всё.
 */
export async function undoImport(tx: Executor, input: UndoInput, record: (entry: AuditEntry) => number | Promise<number>): Promise<ImportUndoResult> {
  const { companyId, importId, userId } = input;
  const row = await first(tx.select().from(imports).where(and(eq(imports.id, importId), eq(imports.companyId, companyId))));
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Импорт не найден');
  if (row.status !== 'done') throw new AppError(409, 'IMPORT_UNDONE', 'Импорт уже отменён');

  // операции импорта: изменённые после импорта остаются без «Удалить и изменённые»
  const ops = (
    await tx
      .select({
        id: operations.id,
        type: operations.type,
        amount: operations.amount,
        accountId: operations.accountId,
        toAccountId: operations.toAccountId,
        paidAt: operations.paidAt,
        edited: sql<number>`${EDITED_SQL}`,
      })
      .from(operations)
      .where(and(eq(operations.importId, importId), eq(operations.companyId, companyId)))
  ).map((o) => ({ ...o, edited: Number(o.edited) }));
  const editedCount = ops.filter((o) => o.edited === 1).length;
  // пока человек читал подтверждение, изменили ещё операции: с флажком они удалились бы без его ведома
  if (input.includeEdited && editedCount > input.edited) {
    throw new AppError(
      409,
      'IMPORT_CHANGED',
      'После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз',
      undefined,
      { pending: { operations: ops.length, edited: editedCount } },
    );
  }
  const doomed = input.includeEdited ? ops : ops.filter((o) => o.edited !== 1);

  // инвариант 7: операции архивного счёта не удаляются
  const touched = [...new Set(doomed.flatMap((o) => (o.toAccountId === null ? [o.accountId] : [o.accountId, o.toAccountId])))];
  for (const part of chunks(touched)) {
    const archived = await first(
      tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(and(inArray(accounts.id, part), isNotNull(accounts.archivedAt))),
    );
    if (archived) throw new AppError(422, 'ARCHIVED_REFERENCE', `Счёт «${archived.name}» в архиве — верните его из архива, чтобы отменить импорт`);
  }

  // жёсткое удаление: сначала записи вложений (файлы на диске остаются), строки и теги — каскадом
  for (const part of chunks(doomed.map((o) => o.id))) {
    await tx.delete(attachments).where(inArray(attachments.operationId, part));
    await tx.delete(operations).where(inArray(operations.id, part));
  }
  // у изменённых есть своя история в панели: запись удаления, чтобы панель не предлагала их открыть (§6.5)
  for (const o of doomed) {
    if (o.edited !== 1) continue;
    await record({ companyId, userId, entity: 'operation', entityId: o.id, action: 'delete', diff: { type: o.type, amount: o.amount, accountId: o.accountId, paidAt: o.paidAt, importId } });
  }

  const deleted = { operations: doomed.length, ...zero() };
  /** Поля счетов, оставленные как есть, и обнулённые стартовые балансы оставленных созданных счетов. */
  const keptAccounts: ImportKeptAccountField[] = [];
  const keptCreated = zero();
  const keptNames: ImportUndoResult['kept']['names'] = [];
  const keep = (entity: ImportCreatedEntity, name: string) => {
    keptCreated[PLURAL[entity]]++;
    if (keptNames.length < KEPT_NAMES_MAX) keptNames.push({ entity, name });
  };
  const remove = async (entity: ImportCreatedEntity, id: number, diff: Record<string, unknown>) => {
    deleted[PLURAL[entity]]++;
    await record({ companyId, userId, entity, entityId: id, action: 'delete', diff: { ...diff, importId } });
  };
  /** Есть ли хоть одна строка: запрос с LIMIT 1. */
  const any = async (q: PromiseLike<unknown[]>) => exists(await first(q));

  // созданное импортом — если ещё есть и больше не используется (ссылки считают и мягко удалённые операции, инвариант 9)
  const created = JSON.parse(row.created) as Partial<ImportCreatedIds>;
  const load = async <T>(ids: number[] | undefined, fn: (part: number[]) => PromiseLike<T[]>): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunks(ids ?? [])) out.push(...(await fn(part)));
    return out;
  };

  // 1–2: подкатегории, затем категории верхнего уровня (у оставшейся категории не должно быть детей)
  const cats = await load(created.categories, (part) => tx.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, part))));
  for (const c of [...cats.filter((x) => x.parentId !== null), ...cats.filter((x) => x.parentId === null)]) {
    const used =
      (await any(tx.select({ id: operationLines.id }).from(operationLines).where(eq(operationLines.categoryId, c.id)).limit(1))) ||
      (await any(tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, c.id)).limit(1)));
    if (used) keep('category', c.name);
    else {
      await tx.delete(categories).where(eq(categories.id, c.id));
      await remove('category', c.id, { kind: c.kind, name: c.name, parentId: c.parentId });
    }
  }
  // 3: контрагенты
  const cps = await load(created.counterparties, (part) =>
    tx.select().from(counterparties).where(and(eq(counterparties.companyId, companyId), inArray(counterparties.id, part))),
  );
  for (const c of cps) {
    // документы склада (поставщик, покупатель) ссылаются на контрагента так же, как операции
    const used =
      (await any(tx.select({ id: operations.id }).from(operations).where(eq(operations.counterpartyId, c.id)).limit(1))) ||
      (await any(tx.select({ id: stockDocs.id }).from(stockDocs).where(eq(stockDocs.counterpartyId, c.id)).limit(1)));
    if (used) keep('counterparty', c.name);
    else {
      await tx.delete(counterparties).where(eq(counterparties.id, c.id));
      await remove('counterparty', c.id, { type: c.type, name: c.name });
    }
  }
  // 4: теги
  const tgs = await load(created.tags, (part) => tx.select().from(tags).where(and(eq(tags.companyId, companyId), inArray(tags.id, part))));
  for (const t of tgs) {
    if (await any(tx.select({ id: operationTags.operationId }).from(operationTags).where(eq(operationTags.tagId, t.id)).limit(1))) keep('tag', t.name);
    else {
      await tx.delete(tags).where(eq(tags.id, t.id));
      await remove('tag', t.id, { name: t.name });
    }
  }
  // 5: счета без операций
  const accs = await load(created.accounts, (part) => tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, part))));
  for (const a of accs) {
    const used = await any(
      tx
        .select({ id: operations.id })
        .from(operations)
        .where(or(eq(operations.accountId, a.id), eq(operations.toAccountId, a.id)))
        .limit(1),
    );
    if (used) {
      keep('account', a.name);
      // стартовый баланс «Текущего остатка» импорт рассчитал по операциям файла: без них он не имеет смысла — обнуляется,
      // если его не меняли после импорта; изменённый остаётся (changed), введённый человеком («Стартовый баланс») — как
      // есть; импорт без computedStarts (записан раньше) — остаётся, итог просит проверить (решение 16 плана И-3). Счёт в
      // архиве не меняется (у него нулевой баланс, операции на нём не удалялись)
      const kept = (reason: ImportKeptAccountField['reason']) => keptAccounts.push({ accountId: a.id, name: a.name, field: 'startingBalance', reason });
      const computed = created.computedStarts?.[String(a.id)];
      if (a.archivedAt) {
        // как есть
      } else if (created.computedStarts === undefined) {
        if (a.startingBalance !== 0) kept('unverified');
      } else if (computed === undefined) {
        // «Стартовый баланс» или пусто — введено человеком, остаётся
      } else if (a.startingBalance !== computed) kept('changed');
      else {
        const zeroed = changedFields({ startingBalance: a.startingBalance }, { startingBalance: 0 });
        if (zeroed) {
          await tx.update(accounts).set({ startingBalance: 0 }).where(eq(accounts.id, a.id));
          await record({ companyId, userId, entity: 'account', entityId: a.id, action: 'update', diff: { ...zeroed, importId } });
          kept('created');
        }
      }
    } else {
      await tx.delete(accounts).where(eq(accounts.id, a.id));
      await remove('account', a.id, { name: a.name, currency: a.currency });
    }
  }
  // 6: проекты — без операций и без счетов
  const prjs = await load(created.projects, (part) => tx.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, part))));
  for (const p of prjs) {
    const used =
      (await any(tx.select({ id: operationLines.id }).from(operationLines).where(eq(operationLines.projectId, p.id)).limit(1))) ||
      (await any(tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.projectId, p.id)).limit(1))) ||
      (await any(tx.select({ id: stockWarehouses.id }).from(stockWarehouses).where(eq(stockWarehouses.projectId, p.id)).limit(1)));
    if (used) keep('project', p.name);
    else {
      await tx.delete(projects).where(eq(projects.id, p.id));
      await remove('project', p.id, { name: p.name, templateKey: p.templateKey });
    }
  }

  // существующие счета: поле возвращается к значению до импорта, если с импорта его не меняли; дата открытия — ещё и
  // если не осталось операций раньше прежней даты (инвариант 6); счёт в архиве не меняется (решение 3 плана И-3)
  for (const change of JSON.parse(row.accountChanges) as PlannedAccountChange[]) {
    const acc = await first(tx.select().from(accounts).where(and(eq(accounts.id, change.accountId), eq(accounts.companyId, companyId))));
    if (!acc) continue;
    const patch: { startingBalance?: number; openedAt?: string } = {};
    for (const field of ['startingBalance', 'openedAt'] as const) {
      if (change.before[field] === change.after[field]) continue;
      let reason: ImportKeptAccountField['reason'] | null = null;
      if (acc.archivedAt) reason = 'archived';
      else if (acc[field] !== change.after[field]) reason = 'changed';
      else if (field === 'openedAt') {
        const earliest = (
          await first(
            tx
              .select({ first: min(operations.paidAt) })
              .from(operations)
              .where(and(or(eq(operations.accountId, acc.id), eq(operations.toAccountId, acc.id)), isNull(operations.deletedAt))),
          )
        )?.first;
        if (earliest && todayInTimezone(input.timezone, new Date(earliest)) < change.before.openedAt) reason = 'operations';
      }
      if (reason) keptAccounts.push({ accountId: acc.id, name: acc.name, field, reason });
      else if (field === 'startingBalance') patch.startingBalance = change.before.startingBalance;
      else patch.openedAt = change.before.openedAt;
    }
    const changes = changedFields({ startingBalance: acc.startingBalance, openedAt: acc.openedAt }, patch);
    if (!changes) continue;
    await tx.update(accounts).set(patch).where(eq(accounts.id, acc.id));
    await record({ companyId, userId, entity: 'account', entityId: acc.id, action: 'update', diff: { ...changes, importId } });
  }

  const result: ImportUndoResult = {
    deleted,
    kept: { operations: ops.length - doomed.length, created: keptCreated, names: keptNames, accounts: keptAccounts },
  };
  await tx.update(imports).set({ status: 'undone', undoneAt: input.at, undoneBy: userId, undoResult: JSON.stringify(result) }).where(eq(imports.id, importId));
  await record({ companyId, userId, entity: 'import', entityId: importId, action: 'delete', diff: { fileName: row.fileName, ...result } });
  return result;
}
