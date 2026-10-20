import { asc, count, eq } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { companies, fixedRates, operations } from '../../db/schema';
import { AppError } from '../../errors';
import type { AccountsService } from '../accounts/service';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import type { CategoriesService } from '../categories/service';
import { requireCompany } from './guard';

export interface CompanyRow {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface CompaniesService {
  list(): Promise<CompanyRow[]>;
  require(id: number, opts?: { writable?: boolean }): Promise<CompanyRow>;
  create(input: { name: string; baseCurrency: string }, userId: number): Promise<CompanyRow>;
  update(id: number, input: { name?: string; baseCurrency?: string }, userId: number): Promise<CompanyRow>;
  /** Базовую валюту менять нельзя: есть операции (включая удалённые) или фиксированные курсы (§4.2). */
  currencyLocked(id: number): Promise<boolean>;
  archive(id: number, userId: number): Promise<CompanyRow>;
  unarchive(id: number, userId: number): Promise<CompanyRow>;
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
      return db.select().from(companies).orderBy(asc(companies.id));
    },

    async require(id, opts = {}) {
      return requireCompany(db, id, opts);
    },

    create(input, userId) {
      return mutate(db, audit, async (tx, record) => {
        const [row] = await tx
          .insert(companies)
          .values({ name: cleanName(input.name), baseCurrency: input.baseCurrency, createdAt: now().toISOString() })
          .returning();
        if (!row) throw new Error('companies: вставка не вернула строку');
        await d.categories.seedSystem(tx, row.id);
        await record({ companyId: row.id, userId, entity: 'company', entityId: row.id, action: 'create', diff: { name: row.name, baseCurrency: row.baseCurrency } });
        return row;
      });
    },

    async update(id, input, userId) {
      const before = await svc.require(id, { writable: true });
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ name: before.name, baseCurrency: before.baseCurrency }, patch);
      if (!changes) return before; // пустой или ничего не меняющий PATCH
      if (changes.after.baseCurrency !== undefined && (await svc.currencyLocked(id))) {
        throw new AppError(422, 'CURRENCY_LOCKED', 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
      }
      return mutate(db, audit, async (tx, record) => {
        const [row] = await tx.update(companies).set(changes.after).where(eq(companies.id, id)).returning();
        await record({ companyId: id, userId, entity: 'company', entityId: id, action: 'update', diff: changes });
        return row!;
      });
    },

    async currencyLocked(id) {
      const ops = Number((await first(db.select({ n: count() }).from(operations).where(eq(operations.companyId, id))))?.n ?? 0);
      const fixed = Number((await first(db.select({ n: count() }).from(fixedRates).where(eq(fixedRates.companyId, id))))?.n ?? 0);
      return ops + fixed > 0;
    },

    async archive(id, userId) {
      const row = await svc.require(id);
      if (row.archivedAt) return row;
      if ((await d.accounts.countActive(id)) > 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив все счета компании');
      }
      return mutate(db, audit, async (tx, record) => {
        const [out] = await tx.update(companies).set({ archivedAt: now().toISOString() }).where(eq(companies.id, id)).returning();
        await record({ companyId: id, userId, entity: 'company', entityId: id, action: 'archive' });
        return out!;
      });
    },

    async unarchive(id, userId) {
      const row = await svc.require(id);
      if (!row.archivedAt) return row;
      return mutate(db, audit, async (tx, record) => {
        const [out] = await tx.update(companies).set({ archivedAt: null }).where(eq(companies.id, id)).returning();
        await record({ companyId: id, userId, entity: 'company', entityId: id, action: 'unarchive' });
        return out!;
      });
    },
  };
  return svc;
}
