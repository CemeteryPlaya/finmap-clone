import { and, asc, eq, isNull } from 'drizzle-orm';
import { journalFilterSchema, type JournalFilter } from '../../../shared/schemas/journal';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { accounts, categories, counterparties, projects, savedFilters, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';

export interface SavedFilterRow {
  id: number;
  companyId: number;
  name: string;
  /** Фильтр без недоступных ссылок — его можно сразу применять к журналу. */
  filter: JournalFilter;
  /** Сколько ссылок отброшено: элемент удалён, в архиве или из другой компании (инвариант 10). */
  unavailable: number;
  /** true — сохранённый JSON повреждён или не проходит схему журнала: фильтр пуст, применять нечего. Поле есть только у таких строк. */
  invalid?: true;
  createdAt: string;
  updatedAt: string;
}

/** Личные сохранённые фильтры журнала (§4.4, §6): чужие не видны (404). Как и настройки пользователя, историю не пишут. */
export interface SavedFiltersService {
  list(userId: number, companyId: number): SavedFilterRow[];
  add(userId: number, companyId: number, input: { name: string; filter: JournalFilter }): SavedFilterRow;
  update(userId: number, companyId: number, id: number, input: { name?: string; filter?: JournalFilter }): SavedFilterRow;
  remove(userId: number, companyId: number, id: number): void;
}

/** Поля фильтра со ссылками на справочники. */
const REF_FIELDS = ['accountIds', 'categoryIds', 'projectIds', 'counterpartyIds', 'tagIds'] as const;
type RefField = (typeof REF_FIELDS)[number];
type Available = Record<RefField, Set<number>>;

export function createSavedFiltersService(d: { db: Db; now?: () => Date }): SavedFiltersService {
  const { db } = d;
  const now = d.now ?? (() => new Date());

  /** Доступные для фильтра элементы справочников компании — не в архиве. */
  function available(companyId: number): Available {
    const set = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));
    return {
      accountIds: set(db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), isNull(accounts.archivedAt))).all()),
      categoryIds: set(db.select({ id: categories.id }).from(categories).where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt))).all()),
      projectIds: set(db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt))).all()),
      counterpartyIds: set(
        db.select({ id: counterparties.id }).from(counterparties).where(and(eq(counterparties.companyId, companyId), isNull(counterparties.archivedAt))).all(),
      ),
      tagIds: set(db.select({ id: tags.id }).from(tags).where(and(eq(tags.companyId, companyId), isNull(tags.archivedAt))).all()),
    };
  }

  /** Хранимый JSON → фильтр без недоступных ссылок и их число. JSON читается той же схемой (устаревшие поля отбрасываются). */
  function toRow(r: typeof savedFilters.$inferSelect, avail: Available): SavedFilterRow {
    let parsed: ReturnType<typeof journalFilterSchema.safeParse> | null = null;
    try {
      parsed = journalFilterSchema.safeParse(JSON.parse(r.filter));
    } catch {
      // повреждённая строка не должна ронять весь список
    }
    const filter: JournalFilter = parsed?.success ? { ...parsed.data } : {};
    let unavailable = 0;
    for (const field of REF_FIELDS) {
      const ids = filter[field];
      if (!ids) continue;
      const kept = ids.filter((x) => avail[field].has(x));
      unavailable += ids.length - kept.length;
      if (kept.length) filter[field] = kept;
      else delete filter[field];
    }
    return {
      id: r.id,
      companyId: r.companyId,
      name: r.name,
      filter,
      unavailable,
      ...(parsed?.success ? {} : { invalid: true as const }),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  function requireOwn(userId: number, companyId: number, id: number): typeof savedFilters.$inferSelect {
    const row = db
      .select()
      .from(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, userId), eq(savedFilters.companyId, companyId)))
      .get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Фильтр не найден');
    return row;
  }

  return {
    list(userId, companyId) {
      requireCompany(db, companyId);
      const avail = available(companyId);
      return db
        .select()
        .from(savedFilters)
        .where(and(eq(savedFilters.userId, userId), eq(savedFilters.companyId, companyId)))
        .orderBy(asc(savedFilters.id))
        .all()
        .map((r) => toRow(r, avail));
    },

    add(userId, companyId, input) {
      requireCompany(db, companyId, { writable: true });
      const t = now().toISOString();
      const row = db
        .insert(savedFilters)
        .values({ userId, companyId, name: cleanName(input.name), filter: JSON.stringify(input.filter), createdAt: t, updatedAt: t })
        .returning()
        .get();
      return toRow(row, available(companyId));
    },

    update(userId, companyId, id, input) {
      requireCompany(db, companyId, { writable: true });
      requireOwn(userId, companyId, id);
      const row = db
        .update(savedFilters)
        .set({
          ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
          ...(input.filter !== undefined ? { filter: JSON.stringify(input.filter) } : {}),
          updatedAt: now().toISOString(),
        })
        .where(eq(savedFilters.id, id))
        .returning()
        .get();
      return toRow(row, available(companyId));
    },

    remove(userId, companyId, id) {
      requireCompany(db, companyId, { writable: true });
      requireOwn(userId, companyId, id);
      db.delete(savedFilters).where(eq(savedFilters.id, id)).run();
    },
  };
}
