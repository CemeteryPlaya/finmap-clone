import { and, asc, eq, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import { getTemplate } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import { ulower, type Db } from '../../db/client';
import { projects } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import type { CompaniesService } from '../companies/service';

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
  list(companyId: number): ProjectRow[];
  create(
    companyId: number,
    input: { name: string; templateKey: string; templateParams: Record<string, unknown> },
    userId: number,
  ): { project: ProjectRow; applied: { categories: number; accounts: number } };
  update(companyId: number, id: number, input: { name?: string; templateParams?: Record<string, unknown> }, userId: number): ProjectRow;
  archive(companyId: number, id: number, userId: number): ProjectRow;
  unarchive(companyId: number, id: number, userId: number): ProjectRow;
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

export function createProjectsService(d: {
  db: Db;
  audit: AuditService;
  companies: CompaniesService;
  categories: CategoriesService;
  accounts: AccountsService;
  timezone: string;
  now?: () => Date;
}): ProjectsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireProject(companyId: number, id: number): ProjectRow {
    const row = db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Проект не найден');
    return toRow(row);
  }

  function assertNameFree(companyId: number, name: string, exceptId?: number): void {
    const key = ulower(name.trim());
    const clash = db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), sql`ulower(trim(${projects.name})) = ${key}`))
      .all()
      .some((r) => r.id !== exceptId);
    if (clash) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Проект с таким названием уже есть' });
  }

  const svc: ProjectsService = {
    list(companyId) {
      d.companies.require(companyId);
      return db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(asc(projects.orderIndex), asc(projects.id)).all().map(toRow);
    },

    create(companyId, input, userId) {
      const company = d.companies.require(companyId, { writable: true });
      const template = getTemplate(input.templateKey);
      if (!template) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { templateKey: 'Неизвестный тип бизнеса' });
      const params = validateParams(template, input.templateParams);
      assertNameFree(companyId, input.name);

      return db.transaction((tx) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${projects.orderIndex}), -1)` })
          .from(projects)
          .where(eq(projects.companyId, companyId))
          .get();
        const row = tx
          .insert(projects)
          .values({
            companyId,
            name: input.name,
            templateKey: template.key,
            templateParams: JSON.stringify(params),
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning()
          .get();
        const createdCategories = d.categories.mergeTemplate(tx, companyId, template);
        const openedAt = todayInTimezone(d.timezone, now());
        for (const acc of template.defaultAccounts) {
          d.accounts.create(tx, {
            companyId,
            projectId: row.id,
            name: acc.name.replaceAll('{project}', () => input.name),
            currency: acc.currency ?? company.baseCurrency,
            openedAt,
          });
        }
        const applied = { categories: createdCategories, accounts: template.defaultAccounts.length };
        audit.record({
          companyId,
          userId,
          entity: 'project',
          entityId: row.id,
          action: 'create',
          diff: { name: input.name, templateKey: template.key, templateParams: params, applied },
        });
        return { project: toRow(row), applied };
      });
    },

    update(companyId, id, input, userId) {
      d.companies.require(companyId, { writable: true });
      const before = requireProject(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — изменения недоступны');
      const template = getTemplate(before.templateKey);
      if (!template) throw new Error(`Шаблон ${before.templateKey} не найден`);
      const set: Partial<typeof projects.$inferInsert> = {};
      if (input.name !== undefined) {
        assertNameFree(companyId, input.name, id);
        set.name = input.name;
      }
      if (input.templateParams !== undefined) {
        set.templateParams = JSON.stringify(validateParams(template, { ...before.templateParams, ...input.templateParams }));
      }
      if (Object.keys(set).length === 0) return before;
      const row = toRow(db.update(projects).set(set).where(eq(projects.id, id)).returning().get());
      audit.record({
        companyId,
        userId,
        entity: 'project',
        entityId: id,
        action: 'update',
        diff: { before: { name: before.name, templateParams: before.templateParams }, after: { name: row.name, templateParams: row.templateParams } },
      });
      return row;
    },

    archive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(companyId, id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив счета проекта');
      }
      const out = toRow(db.update(projects).set({ archivedAt: now().toISOString() }).where(eq(projects.id, id)).returning().get());
      audit.record({ companyId, userId, entity: 'project', entityId: id, action: 'archive' });
      return out;
    },

    unarchive(companyId, id, userId) {
      d.companies.require(companyId, { writable: true });
      const row = requireProject(companyId, id);
      if (!row.archivedAt) return row;
      const out = toRow(db.update(projects).set({ archivedAt: null }).where(eq(projects.id, id)).returning().get());
      audit.record({ companyId, userId, entity: 'project', entityId: id, action: 'unarchive' });
      return out;
    },
  };
  return svc;
}
