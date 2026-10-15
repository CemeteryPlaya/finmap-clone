import { and, asc, eq } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { projects, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type StockWarehouseRow = typeof stockWarehouses.$inferSelect;

export interface StockWarehousesService {
  list(companyId: number): StockWarehouseRow[];
  /** Склад проекта: у проекта не больше одного. */
  create(companyId: number, input: { projectId: number; name: string }, userId: number): StockWarehouseRow;
  rename(companyId: number, id: number, name: string, userId: number): StockWarehouseRow;
  archive(companyId: number, id: number, userId: number): StockWarehouseRow;
  unarchive(companyId: number, id: number, userId: number): StockWarehouseRow;
  /** Склад компании; 404, если его нет. */
  require(companyId: number, id: number): StockWarehouseRow;
}

export function createStockWarehousesService(d: { db: Db; audit: AuditService; now?: () => Date }): StockWarehousesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireRow(companyId: number, id: number): StockWarehouseRow {
    const row = db.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, id), eq(stockWarehouses.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Склад не найден');
    return row;
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): StockWarehouseRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(stockWarehouses).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockWarehouses.id, id)).returning().get();
      record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: archive ? 'archive' : 'unarchive', diff: { name: row.name } });
      return out;
    });
  }

  const svc: StockWarehousesService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db.select().from(stockWarehouses).where(eq(stockWarehouses.companyId, companyId)).orderBy(asc(stockWarehouses.id)).all();
    },

    require(companyId, id) {
      return requireRow(companyId, id);
    },

    create(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(input.name);
      const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).get();
      if (!project) throw new AppError(422, 'INVARIANT_5', 'Проект не найден в этой компании', { projectId: 'Проект не найден в этой компании' });
      if (project.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Проект «${project.name}» в архиве — выберите другой`);
      return mutate(
        db,
        audit,
        (tx, record) => {
          const clash = tx.select().from(stockWarehouses).where(eq(stockWarehouses.projectId, input.projectId)).get();
          if (clash) throw new AppError(422, 'VALIDATION', 'У проекта уже есть склад', { projectId: 'У проекта уже есть склад' });
          const row = tx
            .insert(stockWarehouses)
            .values({ companyId, projectId: input.projectId, name, createdAt: now().toISOString() })
            .returning()
            .get();
          record({ companyId, userId, entity: 'stock_warehouse', entityId: row.id, action: 'create', diff: { name, projectId: input.projectId } });
          return row;
        },
        { behavior: 'immediate' },
      );
    },

    rename(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(stockWarehouses).set({ name: changes.after.name! }).where(eq(stockWarehouses.id, id)).returning().get();
        record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),
  };
  return svc;
}
