import { and, eq } from 'drizzle-orm';
import type { BulkResult, BulkSkip, OperationBulkInput } from '../../../shared/schemas/operations';
import type { Db } from '../../db/client';
import { categories, counterparties, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { OperationsService } from './service';

export interface BulkService {
  /**
   * Массовое действие (§7 «Массовые действия»): версию не проверяет, у изменённых операций увеличивает её и пишет
   * историю. Неподходящие операции пропускаются с причиной. Выбранная статья, проект или контрагент другой компании
   * или в архиве — отказ всего запроса (инварианты 5 и 7), как и архивная компания.
   */
  run(companyId: number, input: OperationBulkInput, userId: number): BulkResult;
}

const DELETED = 'Операция удалена';
const SPLIT = 'Разбитая операция — измените её в форме';

/** Выбранный элемент справочника: та же компания (инвариант 5) и не в архиве (инвариант 7). */
function chosen<T extends { name: string; archivedAt: string | null }>(row: T | undefined, notFound: string, archived: (name: string) => string): T {
  if (!row) throw new AppError(422, 'INVARIANT_5', notFound);
  if (row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', archived(row.name));
  return row;
}

export function createBulkService(d: { db: Db; operations: OperationsService }): BulkService {
  const { db, operations: ops } = d;

  /** Действие над одной операцией: null — применено, строка — причина пропуска. */
  function action(companyId: number, input: OperationBulkInput, userId: number): (id: number) => string | null {
    switch (input.action) {
      case 'setCategory': {
        const cat = chosen(
          db.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.companyId, companyId))).get(),
          'Статья не найдена в этой компании',
          (name) => `Статья «${name}» в архиве — выберите другую`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.type === 'transfer') return 'У перевода нет статьи';
          if (op.lines.length !== 1) return SPLIT;
          // инвариант 3: вид статьи — по типу операции
          if (op.type !== cat.kind) return cat.kind === 'income' ? 'Статья доходов не подходит для расхода' : 'Статья расходов не подходит для дохода';
          const line = op.lines[0]!;
          ops.update(companyId, id, { version: op.version, lines: [{ categoryId: cat.id, projectId: line.projectId, amount: line.amount }] }, userId);
          return null;
        };
      }
      case 'setProject': {
        const project = chosen(
          db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).get(),
          'Проект не найден в этой компании',
          (name) => `Проект «${name}» в архиве — выберите другой`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.lines.length > 1) return SPLIT;
          // перевод без строк получает строку с проектом на всю сумму (§4.5)
          const line = op.lines[0];
          const lines = [{ categoryId: line?.categoryId ?? null, projectId: project.id, amount: line?.amount ?? op.amount }];
          ops.update(companyId, id, { version: op.version, lines }, userId);
          return null;
        };
      }
      case 'setCounterparty': {
        const cp = chosen(
          db.select().from(counterparties).where(and(eq(counterparties.id, input.counterpartyId), eq(counterparties.companyId, companyId))).get(),
          'Контрагент не найден в этой компании',
          (name) => `Контрагент «${name}» в архиве — выберите другого`,
        );
        return (id) => {
          const op = ops.get(companyId, id);
          if (op.deletedAt) return DELETED;
          if (op.type === 'transfer') return 'У перевода нет контрагента';
          ops.update(companyId, id, { version: op.version, counterpartyId: cp.id }, userId);
          return null;
        };
      }
      case 'delete':
        // уже удалённая — пропуск, а не «изменено»: иначе «Отменить» по changed вернул бы операцию,
        // удалённую раньше (возможно, другим пользователем). На архивном счёте remove отвечает
        // ARCHIVED_REFERENCE (инвариант 7) — это причина пропуска
        return (id) => {
          if (ops.get(companyId, id).deletedAt) return 'Операция уже удалена';
          ops.remove(companyId, id, userId);
          return null;
        };
      case 'restore':
        // восстановление перепроверяет инварианты 3–7 (инвариант 11); отказ — причина пропуска
        return (id) => {
          if (!ops.get(companyId, id).deletedAt) return 'Операция не удалена';
          ops.restore(companyId, id, userId);
          return null;
        };
    }
  }

  return {
    run(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const apply = action(companyId, input, userId);
      const changed: number[] = [];
      const skipped: BulkSkip[] = [];
      // Одна транзакция на запрос. Запись каждой операции (mutate) внутри неё — точка сохранения better-sqlite3:
      // отказ по одной операции (AppError) откатывает только её, любой другой сбой — весь запрос.
      db.transaction(() => {
        for (const id of new Set(input.ids)) {
          try {
            const reason = apply(id);
            if (reason) skipped.push({ id, reason });
            else changed.push(id);
          } catch (e) {
            // отказ по самой операции (не найдена, версия, инвариант) — пропуск; прочие AppError откатывают весь запрос
            if (!(e instanceof AppError) || ![404, 409, 422].includes(e.status)) throw e;
            skipped.push({ id, reason: e.message });
          }
        }
      });
      return { changed, skipped };
    },
  };
}
