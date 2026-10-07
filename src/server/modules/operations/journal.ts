import { and, asc, count, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { addDays, startOfDayUtc } from '../../../shared/dates';
import type { JournalFilter, JournalOrder, JournalQuery, JournalSort } from '../../../shared/schemas/journal';
import { foldCase } from '../../../shared/search';
import type { Db } from '../../db/client';
import { attachments, operationLines, operations, operationTags } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { OperationDto, OperationLineDto } from './service';

export interface JournalItem extends OperationDto {
  /** Сколько у операции неудалённых вложений. */
  attachmentCount: number;
}

export interface JournalPage {
  items: JournalItem[];
  /** Курсор следующей страницы; null — дальше ничего нет. */
  nextCursor: string | null;
}

export interface JournalService {
  /** Страница журнала (§6): фильтр, сортировка, курсор. Удалённые операции не показываются. */
  list(companyId: number, query: JournalQuery): JournalPage;
}

/** Шаблон LIKE (§6.1): запрос в нижнем регистре и с «е» вместо «ё»; `\`, `%` и `_` экранированы. */
export function likePattern(q: string): string {
  return `%${foldCase(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const idList = (ids: number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);

/** Условия через ИЛИ в скобках; null — ни одного. */
function anyOf(parts: (SQL | false | undefined)[]): SQL | null {
  const xs = parts.filter((p): p is SQL => !!p);
  return xs.length ? sql`(${sql.join(xs, sql` OR `)})` : null;
}

/**
 * Условие фильтра журнала (§6) над `operations o`, без удалённых операций.
 * Внутри одного измерения «без …» объединяется с выбранными элементами через ИЛИ («Аренда» или без статьи),
 * разные измерения — через И.
 */
export function journalWhere(companyId: number, f: JournalFilter, timezone: string): SQL {
  const conds: SQL[] = [sql`o.company_id = ${companyId}`, sql`o.deleted_at IS NULL`];
  // период — по календарной дате paidAt в APP_TIMEZONE: [начало from; начало to + 1)
  if (f.from) conds.push(sql`o.paid_at >= ${startOfDayUtc(f.from, timezone)}`);
  if (f.to) conds.push(sql`o.paid_at < ${startOfDayUtc(addDays(f.to, 1), timezone)}`);
  // сумма — в базовой валюте компании
  if (f.amountMin !== undefined) conds.push(sql`o.base_amount >= ${f.amountMin}`);
  if (f.amountMax !== undefined) conds.push(sql`o.base_amount <= ${f.amountMax}`);
  if (f.types) conds.push(sql`o.type IN (${sql.join(f.types.map((t) => sql`${t}`), sql`, `)})`);
  if (f.accountIds) conds.push(sql`(o.account_id IN (${idList(f.accountIds)}) OR o.to_account_id IN (${idList(f.accountIds)}))`);
  if (f.tagIds) conds.push(sql`EXISTS (SELECT 1 FROM operation_tags ft WHERE ft.operation_id = o.id AND ft.tag_id IN (${idList(f.tagIds)}))`);

  const counterparty = anyOf([
    f.counterpartyIds && sql`o.counterparty_id IN (${idList(f.counterpartyIds)})`,
    // доход или расход без контрагента
    f.withoutCounterparty && sql`(o.type <> 'transfer' AND o.counterparty_id IS NULL)`,
  ]);
  if (counterparty) conds.push(counterparty);

  const category = anyOf([
    // хотя бы одна строка; родительская статья включает дочерние (вложенность не больше двух уровней, §4.4)
    f.categoryIds &&
      sql`EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.category_id IN (SELECT c.id FROM categories c WHERE c.company_id = ${companyId} AND (c.id IN (${idList(f.categoryIds)}) OR c.parent_id IN (${idList(f.categoryIds)}))))`,
    // доход или расход, у которого хотя бы у одной строки нет статьи; переводы не учитываются
    f.withoutCategory && sql`(o.type <> 'transfer' AND EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.category_id IS NULL))`,
  ]);
  if (category) conds.push(category);

  const project = anyOf([
    f.projectIds && sql`EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.project_id IN (${idList(f.projectIds)}))`,
    // хотя бы у одной строки нет проекта, либо перевод без строк
    f.withoutProject &&
      sql`(EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND fl.project_id IS NULL) OR (o.type = 'transfer' AND NOT EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id)))`,
  ]);
  if (project) conds.push(project);

  if (f.q) {
    // §6.1: ulower(поле) LIKE '%запрос%' ESCAPE '\'. Подзапросы по справочникам не зависят от строки операции —
    // SQLite вычисляет их один раз
    const p = likePattern(f.q);
    const like = (column: string) => sql`ulower(${sql.raw(column)}) LIKE ${p} ESCAPE '\\'`;
    const named = (table: string) => sql`SELECT id FROM ${sql.raw(table)} WHERE company_id = ${companyId} AND ${like('name')}`;
    conds.push(
      sql`(${like('o.comment')} OR o.counterparty_id IN (${named('counterparties')}) OR o.account_id IN (${named('accounts')}) OR o.to_account_id IN (${named('accounts')}) OR EXISTS (SELECT 1 FROM operation_lines fl WHERE fl.operation_id = o.id AND (fl.category_id IN (${named('categories')}) OR fl.project_id IN (${named('projects')}))))`,
    );
  }
  return sql.join(conds, sql` AND `);
}

/** Порядок журнала: по дате — (paidAt, id), по сумме — (baseAmount, id). */
export function journalOrder(sort: JournalSort, order: JournalOrder): SQL {
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return sql.raw(sort === 'date' ? `o.paid_at ${dir}, o.id ${dir}` : `o.base_amount ${dir}, o.id ${dir}`);
}

interface CursorKey {
  s: JournalSort;
  o: JournalOrder;
  /** paidAt или baseAmount последней строки страницы. */
  v: string | number;
  id: number;
}

const encodeCursor = (k: CursorKey) => Buffer.from(JSON.stringify(k)).toString('base64url');

function decodeCursor(raw: string, sort: JournalSort, order: JournalOrder): CursorKey {
  let k: Partial<CursorKey> | null = null;
  try {
    k = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorKey> | null;
  } catch {
    k = null;
  }
  const valueOk = sort === 'date' ? typeof k?.v === 'string' : Number.isSafeInteger(k?.v);
  if (!k || k.s !== sort || k.o !== order || !Number.isSafeInteger(k.id) || !valueOk) {
    // курсор другой сортировки или испорченный — клиент начинает список заново
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { cursor: 'Список изменился — загрузите его заново' });
  }
  return k as CursorKey;
}

export function createJournal(d: { db: Db; timezone: string }): JournalService {
  const { db, timezone } = d;

  /** Операции страницы в заданном порядке: со строками, тегами и числом вложений. */
  function loadItems(ids: number[]): JournalItem[] {
    if (ids.length === 0) return [];
    const rows = new Map(db.select().from(operations).where(inArray(operations.id, ids)).all().map((r) => [r.id, r]));
    const lines = new Map<number, OperationLineDto[]>();
    for (const l of db
      .select()
      .from(operationLines)
      .where(inArray(operationLines.operationId, ids))
      .orderBy(asc(operationLines.operationId), asc(operationLines.position))
      .all()) {
      const xs = lines.get(l.operationId) ?? [];
      xs.push({ id: l.id, position: l.position, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: l.baseAmount });
      lines.set(l.operationId, xs);
    }
    const tags = new Map<number, number[]>();
    for (const t of db.select().from(operationTags).where(inArray(operationTags.operationId, ids)).orderBy(asc(operationTags.tagId)).all()) {
      tags.set(t.operationId, [...(tags.get(t.operationId) ?? []), t.tagId]);
    }
    const files = new Map(
      db
        .select({ operationId: attachments.operationId, n: count() })
        .from(attachments)
        .where(and(inArray(attachments.operationId, ids), isNull(attachments.deletedAt)))
        .groupBy(attachments.operationId)
        .all()
        .map((r) => [r.operationId, r.n]),
    );
    return ids.map((id) => ({ ...rows.get(id)!, lines: lines.get(id) ?? [], tagIds: tags.get(id) ?? [], attachmentCount: files.get(id) ?? 0 }));
  }

  return {
    list(companyId, q) {
      requireCompany(db, companyId);
      const conds = [journalWhere(companyId, q, timezone)];
      if (q.cursor) {
        // ключ сортировки и id последней строки предыдущей страницы: (key, id) строго дальше
        const c = decodeCursor(q.cursor, q.sort, q.order);
        const key = sql.raw(q.sort === 'date' ? 'o.paid_at' : 'o.base_amount');
        conds.push(sql`(${key}, o.id) ${sql.raw(q.order === 'asc' ? '>' : '<')} (${c.v}, ${c.id})`);
      }
      const found = db.all<{ id: number; paidAt: string; baseAmount: number }>(
        sql`SELECT o.id AS id, o.paid_at AS paidAt, o.base_amount AS baseAmount FROM operations o WHERE ${sql.join(conds, sql` AND `)} ORDER BY ${journalOrder(q.sort, q.order)} LIMIT ${q.limit + 1}`,
      );
      const more = found.length > q.limit;
      const rows = more ? found.slice(0, q.limit) : found;
      const last = rows.at(-1);
      return {
        items: loadItems(rows.map((r) => r.id)),
        nextCursor: more && last ? encodeCursor({ s: q.sort, o: q.order, v: q.sort === 'date' ? last.paidAt : last.baseAmount, id: last.id }) : null,
      };
    },
  };
}
