import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import { cleanName } from '../../../shared/text';
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db, type Executor } from '../../db/client';
import { first } from '../../db/raw';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CompaniesService } from '../companies/service';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export interface ProjectRow {
  id: number;
  companyId: number;
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectsService {
  list(companyId: number): Promise<ProjectRow[]>;
  create(
    companyId: number,
    input: { name: string; templateKey: string; templateParams: Record<string, unknown> },
    userId: number,
  ): Promise<{ project: ProjectRow; applied: { categories: number; accounts: number } }>;
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §4.7 и §6.4 спецификации импорта): проект по шаблону
   * «Общий» — без параметров, категорий и счетов; без истории — её пишет вызывающий. Порядок — после имеющихся.
   */
  createIn(ex: Executor, input: { companyId: number; name: string }): Promise<ProjectRow>;
  update(
    companyId: number,
    id: number,
    input: { name?: string; templateParams?: Record<string, unknown>; renameAccounts?: boolean },
    userId: number,
  ): Promise<{ project: ProjectRow; renamedAccounts: number }>;
  archive(companyId: number, id: number, userId: number): Promise<ProjectRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<ProjectRow>;
  reorder(companyId: number, ids: number[], userId: number): Promise<ProjectRow[]>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

function toRow(r: typeof projects.$inferSelect): ProjectRow {
  return { ...r, templateParams: JSON.parse(r.templateParams) as Record<string, unknown> };
}

function validateParams(template: BusinessTemplate, raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = template.params.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = `templateParams.${issue.path.join('.') || '_'}`;
    fields[key] ??= issue.message;
  }
  throw new AppError(400, 'VALIDATION', 'Проверьте параметры проекта', fields);
}

/** Шаблон проектов, созданных импортом (§4.7 спецификации импорта): без параметров, категорий и счетов. */
const GENERAL_TEMPLATE = 'general';

export function createProjectsService(d: {
  db: Db;
  audit: AuditService;
  companies: CompaniesService;
  categories: CategoriesService;
  accounts: AccountsService;
  references?: ReferencesService;
  timezone: string;
  now?: () => Date;
}): ProjectsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  async function requireProject(companyId: number, id: number): Promise<ProjectRow> {
    const row = await first(db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Проект не найден');
    return toRow(row);
  }

  /** Новый проект в конце списка компании (общий для create и createIn). */
  async function insertProject(ex: Executor, v: { companyId: number; name: string; templateKey: string; templateParams: string }) {
    const next = await first(
      ex
        .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
        .from(projects)
        .where(eq(projects.companyId, v.companyId)),
    );
    const [row] = await ex
      .insert(projects)
      .values({ ...v, orderIndex: Number(next?.m ?? -1) + 1, createdAt: now().toISOString() })
      .returning();
    return row!;
  }

  async function assertNameFree(companyId: number, name: string, exceptId?: number): Promise<void> {
    const key = ulower(name.trim());
    const clash = (
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.companyId, companyId), sql`ulower(trim(${projects.name})) = ${key}`))
    ).some((r) => r.id !== exceptId);
    if (clash) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Проект с таким названием уже есть' });
  }

  const svc: ProjectsService = {
    async list(companyId) {
      await d.companies.require(companyId);
      return (await db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(asc(projects.orderIndex), asc(projects.id))).map(toRow);
    },

    async create(companyId, input, userId) {
      const company = await d.companies.require(companyId, { writable: true });
      const template = getTemplate(input.templateKey);
      if (!template) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { templateKey: 'Неизвестный тип бизнеса' });
      const params = validateParams(template, input.templateParams);
      const name = cleanName(input.name);
      await assertNameFree(companyId, name);

      return mutate(db, audit, async (tx, record) => {
        const row = await insertProject(tx, { companyId, name, templateKey: template.key, templateParams: JSON.stringify(params) });
        const createdCategories = await d.categories.mergeTemplate(tx, companyId, template);
        const openedAt = todayInTimezone(d.timezone, now());
        for (const acc of template.defaultAccounts) {
          await d.accounts.create(tx, {
            companyId,
            projectId: row.id,
            name: acc.name.replaceAll('{project}', () => name),
            currency: acc.currency ?? company.baseCurrency,
            openedAt,
          });
        }
        const applied = { categories: createdCategories, accounts: template.defaultAccounts.length };
        await record({
          companyId,
          userId,
          entity: 'project',
          entityId: row.id,
          action: 'create',
          diff: { name, templateKey: template.key, templateParams: params, applied },
        });
        return { project: toRow(row), applied };
      });
    },

    async createIn(ex, input) {
      const name = cleanName(input.name);
      await assertNameFree(input.companyId, name);
      return toRow(await insertProject(ex, { companyId: input.companyId, name, templateKey: GENERAL_TEMPLATE, templateParams: '{}' }));
    },

    async update(companyId, id, input, userId) {
      await d.companies.require(companyId, { writable: true });
      const before = await requireProject(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — изменения недоступны');
      const template = getTemplate(before.templateKey);
      if (!template) throw new Error(`Шаблон ${before.templateKey} не найден`);
      const patch: { name?: string; templateParams?: Record<string, unknown> } = {};
      if (input.name !== undefined) patch.name = cleanName(input.name);
      if (input.templateParams !== undefined) {
        patch.templateParams = validateParams(template, { ...before.templateParams, ...input.templateParams });
      }
      const changes = changedFields({ name: before.name, templateParams: before.templateParams }, patch);
      if (!changes) return { project: before, renamedAccounts: 0 };
      const newName = changes.after.name;
      if (newName !== undefined) await assertNameFree(companyId, newName, id);
      return mutate(db, audit, async (tx, record) => {
        const set: Partial<typeof projects.$inferInsert> = {};
        if (newName !== undefined) set.name = newName;
        if (changes.after.templateParams !== undefined) set.templateParams = JSON.stringify(changes.after.templateParams);
        const [updated] = await tx.update(projects).set(set).where(eq(projects.id, id)).returning();
        const project = toRow(updated!);
        let renamedAccounts = 0;
        if (input.renameAccounts && newName !== undefined) {
          // только счета с исходным названием шаблона; изменённые вручную и архивные не трогаем
          for (const acc of template.defaultAccounts) {
            const from = acc.name.replaceAll('{project}', () => before.name);
            const to = acc.name.replaceAll('{project}', () => newName);
            const renamed = await tx
              .update(accounts)
              .set({ name: to })
              .where(and(eq(accounts.companyId, companyId), eq(accounts.projectId, id), eq(accounts.name, from), isNull(accounts.archivedAt)))
              .returning({ id: accounts.id });
            renamedAccounts += renamed.length;
          }
        }
        await record({
          companyId,
          userId,
          entity: 'project',
          entityId: id,
          action: 'update',
          diff: { ...changes, ...(renamedAccounts ? { renamedAccounts } : {}) },
        });
        return { project, renamedAccounts };
      });
    },

    async archive(companyId, id, userId) {
      await d.companies.require(companyId, { writable: true });
      const row = await requireProject(companyId, id);
      if (row.archivedAt) return row;
      if ((await d.accounts.countActive(companyId, id)) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив счета проекта');
      }
      return mutate(db, audit, async (tx, record) => {
        const [out] = await tx.update(projects).set({ archivedAt: now().toISOString() }).where(eq(projects.id, id)).returning();
        await record({ companyId, userId, entity: 'project', entityId: id, action: 'archive' });
        return toRow(out!);
      });
    },

    async unarchive(companyId, id, userId) {
      await d.companies.require(companyId, { writable: true });
      const row = await requireProject(companyId, id);
      if (!row.archivedAt) return row;
      return mutate(db, audit, async (tx, record) => {
        const [out] = await tx.update(projects).set({ archivedAt: null }).where(eq(projects.id, id)).returning();
        await record({ companyId, userId, entity: 'project', entityId: id, action: 'unarchive' });
        return toRow(out!);
      });
    },

    async reorder(companyId, ids, userId) {
      await d.companies.require(companyId, { writable: true });
      const current = (await svc.list(companyId)).map((p) => p.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        await mutate(db, audit, async (tx, record) => {
          for (const [i, projectId] of ids.entries()) await tx.update(projects).set({ orderIndex: i }).where(eq(projects.id, projectId));
          await record({ companyId, userId, entity: 'project', action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    async remove(companyId, id, userId) {
      await d.companies.require(companyId, { writable: true });
      const row = await requireProject(companyId, id);
      if ((await d.accounts.countByProject(companyId, id)) > 0) {
        throw new AppError(422, 'IN_USE', 'У проекта есть счета — удалите их или переведите проект в архив');
      }
      if ((await references.countOperations('project', id)) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На проект ссылаются операции — его можно только перевести в архив');
      }
      await mutate(db, audit, async (tx, record) => {
        await tx.delete(projects).where(eq(projects.id, id));
        await record({ companyId, userId, entity: 'project', entityId: id, action: 'delete', diff: { name: row.name, templateKey: row.templateKey } });
      });
    },
  };
  return svc;
}
