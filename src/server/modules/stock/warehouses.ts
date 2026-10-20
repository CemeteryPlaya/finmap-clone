import { and, asc, eq } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { projects, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutateAsync } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type StockWarehouseRow = typeof stockWarehouses.$inferSelect;

export interface StockWarehousesService {
  list(companyId: number): Promise<StockWarehouseRow[]>;
  /** Склад проекта: у проекта не больше одного. */
  create(companyId: number, input: { projectId: number; name: string }, userId: number): Promise<StockWarehouseRow>;
  rename(companyId: number, id: number, name: string, userId: number): Promise<StockWarehouseRow>;
  archive(companyId: number, id: number, userId: number): Promise<StockWarehouseRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<StockWarehouseRow>;
  /** Склад компании; 404, если его нет. */
  require(companyId: number, id: number): Promise<StockWarehouseRow>;
}

export function createStockWarehousesService(d: { db: Db; audit: AuditService; now?: () => Date }): StockWarehousesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  async function requireRow(companyId: number, id: number): Promise<StockWarehouseRow> {
    const row = await first(db.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, id), eq(stockWarehouses.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Склад не найден');
    return row;
  }

  async function setArchived(companyId: number, id: number, userId: number, archive: boolean): Promise<StockWarehouseRow> {
    await requireCompany(db, companyId, { writable: true });
    const row = await requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutateAsync(db, audit, async (tx, record) => {
      const [out] = await tx.update(stockWarehouses).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockWarehouses.id, id)).returning();
      await record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: archive ? 'archive' : 'unarchive', diff: { name: row.name } });
      return out!;
    });
  }

  const svc: StockWarehousesService = {
    async list(companyId) {
      await requireCompany(db, companyId);
      return db.select().from(stockWarehouses).where(eq(stockWarehouses.companyId, companyId)).orderBy(asc(stockWarehouses.id));
    },

    require(companyId, id) {
      return requireRow(companyId, id);
    },

    async create(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const name = cleanName(input.name);
      const project = await first(db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))));
      if (!project) throw new AppError(422, 'INVARIANT_5', 'Проект не найден в этой компании', { projectId: 'Проект не найден в этой компании' });
      if (project.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Проект «${project.name}» в архиве — выберите другой`);
      return mutateAsync(
        db,
        audit,
        async (tx, record) => {
          const clash = await first(tx.select().from(stockWarehouses).where(eq(stockWarehouses.projectId, input.projectId)));
          if (clash) throw new AppError(422, 'VALIDATION', 'У проекта уже есть склад', { projectId: 'У проекта уже есть склад' });
          const [row] = await tx.insert(stockWarehouses).values({ companyId, projectId: input.projectId, name, createdAt: now().toISOString() }).returning();
          await record({ companyId, userId, entity: 'stock_warehouse', entityId: row!.id, action: 'create', diff: { name, projectId: input.projectId } });
          return row!;
        },
        { behavior: 'immediate' },
      );
    },

    async rename(companyId, id, rawName, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireRow(companyId, id);
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      return mutateAsync(db, audit, async (tx, record) => {
        const [row] = await tx.update(stockWarehouses).set({ name: changes.after.name! }).where(eq(stockWarehouses.id, id)).returning();
        await record({ companyId, userId, entity: 'stock_warehouse', entityId: id, action: 'update', diff: changes });
        return row!;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),
  };
  return svc;
}
