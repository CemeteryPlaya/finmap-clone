import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { companies } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';

export interface CompanyRow {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface CompaniesService {
  list(): CompanyRow[];
  require(id: number, opts?: { writable?: boolean }): CompanyRow;
  create(input: { name: string; baseCurrency: string }, userId: number): CompanyRow;
  update(id: number, input: { name?: string; baseCurrency?: string }, userId: number): CompanyRow;
  archive(id: number, userId: number): CompanyRow;
  unarchive(id: number, userId: number): CompanyRow;
}

export function createCompaniesService(d: {
  db: Db;
  audit: AuditService;
  categories: CategoriesService;
  accounts: AccountsService;
  now?: () => Date;
}): CompaniesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  const svc: CompaniesService = {
    list() {
      return db.select().from(companies).orderBy(asc(companies.id)).all();
    },

    require(id, opts = {}) {
      const row = db.select().from(companies).where(eq(companies.id, id)).get();
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Компания не найдена');
      if (opts.writable && row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Компания в архиве — изменения недоступны');
      return row;
    },

    create(input, userId) {
      return db.transaction((tx) => {
        const row = tx
          .insert(companies)
          .values({ name: input.name, baseCurrency: input.baseCurrency, createdAt: now().toISOString() })
          .returning()
          .get();
        d.categories.seedSystem(tx, row.id);
        audit.record({ companyId: row.id, userId, entity: 'company', entityId: row.id, action: 'create', diff: { ...input } });
        return row;
      });
    },

    update(id, input, userId) {
      const before = svc.require(id, { writable: true });
      if (input.name === undefined && input.baseCurrency === undefined) return before; // пустой PATCH — ничего не меняем
      const row = db
        .update(companies)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}) })
        .where(eq(companies.id, id))
        .returning()
        .get();
      audit.record({
        companyId: id,
        userId,
        entity: 'company',
        entityId: id,
        action: 'update',
        diff: { before: { name: before.name, baseCurrency: before.baseCurrency }, after: { ...input } },
      });
      return row;
    },

    archive(id, userId) {
      const row = svc.require(id);
      if (row.archivedAt) return row;
      if (d.accounts.countActive(id) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив все счета компании');
      }
      const out = db.update(companies).set({ archivedAt: now().toISOString() }).where(eq(companies.id, id)).returning().get();
      audit.record({ companyId: id, userId, entity: 'company', entityId: id, action: 'archive' });
      return out;
    },

    unarchive(id, userId) {
      const row = svc.require(id);
      if (!row.archivedAt) return row;
      const out = db.update(companies).set({ archivedAt: null }).where(eq(companies.id, id)).returning().get();
      audit.record({ companyId: id, userId, entity: 'company', entityId: id, action: 'unarchive' });
      return out;
    },
  };
  return svc;
}
