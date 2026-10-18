import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { StockItemCreate, StockItemUpdate } from '../../../shared/schemas/stock';
import { foldCase } from '../../../shared/search';
import { priceAt, type PricePoint } from '../../../shared/stock-price';
import { formatQty, isWholeUnit, qtyError, type StockUnit } from '../../../shared/stock-qty';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { stockComboParts, stockDocLines, stockItemGroups, stockItemPrices, stockItems } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type StockGroupRow = typeof stockItemGroups.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;

/** Составляющая комплекта: количество на один комплект в тысячных долях её единицы. */
export interface ComboPart {
  itemId: number;
  qty: number;
}

/** Товар с историей цены продажи (по возрастанию даты начала) и — у комплекта — составом. */
export interface StockItemDto extends StockItemRow {
  prices: PricePoint[];
  /** Состав комплекта в порядке ввода; у товара — пусто. */
  parts: ComboPart[];
  /** По товару есть неудалённые документы: у комплекта состав уже не меняется. */
  hasDocs: boolean;
}

export interface StockCatalogService {
  groups(companyId: number): StockGroupRow[];
  addGroup(companyId: number, name: string, userId: number): StockGroupRow;
  renameGroup(companyId: number, id: number, name: string, userId: number): StockGroupRow;
  archiveGroup(companyId: number, id: number, userId: number): StockGroupRow;
  unarchiveGroup(companyId: number, id: number, userId: number): StockGroupRow;
  items(companyId: number): StockItemDto[];
  item(companyId: number, id: number): StockItemDto;
  addItem(companyId: number, input: StockItemCreate, userId: number): StockItemDto;
  updateItem(companyId: number, id: number, patch: StockItemUpdate, userId: number): StockItemDto;
  /** Новая цена продажи с даты `validFrom` (не позже сегодня): пишет историю и пересчитывает текущую цену. */
  setPrice(companyId: number, id: number, input: { price: number; validFrom: string }, userId: number): StockItemDto;
  archiveItem(companyId: number, id: number, userId: number): StockItemDto;
  unarchiveItem(companyId: number, id: number, userId: number): StockItemDto;
  /** Удаление — только товара без документов; иначе архив. */
  removeItem(companyId: number, id: number, userId: number): void;
}

/** Ключ уникальности названия: без учёта регистра, «ё» и невидимых символов. */
export function stockNameKey(name: string): string {
  return foldCase(cleanName(name));
}

export function createStockCatalogService(d: { db: Db; audit: AuditService; timezone: string; now?: () => Date }): StockCatalogService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const today = () => todayInTimezone(d.timezone, now());

  function requireGroup(companyId: number, id: number): StockGroupRow {
    const row = db.select().from(stockItemGroups).where(and(eq(stockItemGroups.id, id), eq(stockItemGroups.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Группа не найдена');
    return row;
  }

  function requireItem(companyId: number, id: number): StockItemRow {
    const row = db.select().from(stockItems).where(and(eq(stockItems.id, id), eq(stockItems.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
    return row;
  }

  function pricesOf(itemId: number): PricePoint[] {
    return db
      .select({ price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
      .from(stockItemPrices)
      .where(eq(stockItemPrices.itemId, itemId))
      .orderBy(asc(stockItemPrices.validFrom))
      .all();
  }

  /** Состав комплектов в порядке ввода (rowid). */
  function partsOf(ex: Executor, comboIds: readonly number[]): Map<number, ComboPart[]> {
    const out = new Map<number, ComboPart[]>();
    if (comboIds.length === 0) return out;
    const rows = ex.all<{ comboId: number; itemId: number; qty: number }>(sql`
      SELECT combo_id AS comboId, item_id AS itemId, qty FROM stock_combo_parts
       WHERE combo_id IN (${sql.join(
         comboIds.map((id) => sql`${id}`),
         sql`, `,
       )}) ORDER BY rowid`);
    for (const r of rows) {
      const list = out.get(r.comboId);
      if (list) list.push({ itemId: r.itemId, qty: r.qty });
      else out.set(r.comboId, [{ itemId: r.itemId, qty: r.qty }]);
    }
    return out;
  }

  /** Товары с неудалёнными документами. */
  function itemsWithDocs(ex: Executor, ids: readonly number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = ex.all<{ itemId: number }>(sql`
      SELECT DISTINCT l.item_id AS itemId FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
       WHERE d.deleted_at IS NULL AND l.item_id IN (${sql.join(
         ids.map((id) => sql`${id}`),
         sql`, `,
       )})`);
    return new Set(rows.map((r) => r.itemId));
  }

  function dto(row: StockItemRow): StockItemDto {
    return { ...row, prices: pricesOf(row.id), parts: partsOf(db, [row.id]).get(row.id) ?? [], hasDocs: itemsWithDocs(db, [row.id]).has(row.id) };
  }

  /**
   * Состав комплекта (решение 5): 1–20 составляющих этой компании без повторов, не комплекты и не сам комплект,
   * количество — по правилу единицы составляющей; архивную составляющую можно только оставить.
   */
  function assertParts(companyId: number, parts: readonly ComboPart[], selfId: number | null, current: readonly ComboPart[]): void {
    if (parts.length === 0) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { parts: 'Добавьте хотя бы одну составляющую' });
    const rows = new Map(
      db
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, [...new Set(parts.map((p) => p.itemId))])))
        .all()
        .map((r) => [r.id, r]),
    );
    const seen = new Set<number>();
    const kept = new Set(current.map((p) => p.itemId));
    parts.forEach((p, i) => {
      const item = rows.get(p.itemId);
      const field = `parts.${i}.itemId`;
      if (!item) throw new AppError(422, 'INVARIANT_5', 'Товар не найден в этой компании', { [field]: 'Товар не найден в этой компании' });
      if (item.isCombo || item.id === selfId) {
        throw new AppError(422, 'VALIDATION', 'Комплект не может входить в другой комплект', { [field]: 'Комплект не может входить в другой комплект' });
      }
      if (seen.has(item.id)) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [field]: 'Товар уже есть в составе' });
      seen.add(item.id);
      if (item.archivedAt && !kept.has(item.id)) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — выберите другой`);
      const problem = qtyError(p.qty, item.unit);
      if (problem) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [`parts.${i}.qty`]: problem });
    });
  }

  /** Состав для истории: «Кола 0,5 × 2» — названия, а не id. */
  function partsText(ex: Executor, parts: readonly ComboPart[]): string[] {
    if (parts.length === 0) return [];
    const names = new Map(
      ex
        .select({ id: stockItems.id, name: stockItems.name })
        .from(stockItems)
        .where(inArray(stockItems.id, parts.map((p) => p.itemId)))
        .all()
        .map((r) => [r.id, r.name]),
    );
    return parts.map((p) => `${names.get(p.itemId) ?? '?'} × ${formatQty(p.qty)}`);
  }

  function writeParts(tx: Executor, comboId: number, parts: readonly ComboPart[]): void {
    tx.delete(stockComboParts).where(eq(stockComboParts.comboId, comboId)).run();
    for (const p of parts) tx.insert(stockComboParts).values({ comboId, itemId: p.itemId, qty: p.qty }).run();
  }

  /** Комплект, в состав которого входит товар: единица и удаление составляющей изменили бы смысл истории (R3). */
  function comboUsing(itemId: number): { name: string } | undefined {
    return db.get<{ name: string }>(sql`
      SELECT c.name AS name FROM stock_combo_parts p JOIN stock_items c ON c.id = p.combo_id WHERE p.item_id = ${itemId} ORDER BY c.name_key LIMIT 1`);
  }

  /** Название свободно в компании, включая архивные; архивный дубль — предложение вернуть его из архива. */
  function assertGroupNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db
      .select()
      .from(stockItemGroups)
      .where(and(eq(stockItemGroups.companyId, companyId), eq(stockItemGroups.nameKey, stockNameKey(name))))
      .get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Группа «${clash.name}» есть в архиве — верните её из архива`, { name: 'Такая группа есть в архиве' });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такая группа уже есть' });
  }

  /** Порог «Мало» — количество в тех же долях, что и строки документов: у «шт» и «уп» дробей нет. */
  function assertMinQty(minQty: number | null, unit: StockUnit): void {
    if (minQty === null) return;
    const problem = qtyError(minQty, unit);
    if (problem) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { minQty: problem });
  }

  function assertItemNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), eq(stockItems.nameKey, stockNameKey(name))))
      .get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Товар «${clash.name}» есть в архиве — верните его из архива`, { name: 'Такой товар есть в архиве' });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такой товар уже есть' });
  }

  /** Группа товара: из этой компании; архивную можно только оставить, а не выбрать заново. */
  function assertGroupChoice(companyId: number, groupId: number | null, current: number | null): void {
    if (groupId === null) return;
    const group = db.select().from(stockItemGroups).where(and(eq(stockItemGroups.id, groupId), eq(stockItemGroups.companyId, companyId))).get();
    if (!group) throw new AppError(422, 'INVARIANT_5', 'Группа не найдена в этой компании', { groupId: 'Группа не найдена в этой компании' });
    if (group.archivedAt && group.id !== current) throw new AppError(422, 'ARCHIVED_REFERENCE', `Группа «${group.name}» в архиве — выберите другую`);
  }

  function setGroupArchived(companyId: number, id: number, userId: number, archive: boolean): StockGroupRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireGroup(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(stockItemGroups).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockItemGroups.id, id)).returning().get();
      record({ companyId, userId, entity: 'stock_group', entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  function setItemArchived(companyId: number, id: number, userId: number, archive: boolean): StockItemDto {
    requireCompany(db, companyId, { writable: true });
    const row = requireItem(companyId, id);
    if ((row.archivedAt !== null) === archive) return dto(row);
    mutate(db, audit, (tx, record) => {
      tx.update(stockItems).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(stockItems.id, id)).run();
      record({ companyId, userId, entity: 'stock_item', entityId: id, action: archive ? 'archive' : 'unarchive', diff: { name: row.name } });
    });
    return dto(requireItem(companyId, id));
  }

  const svc: StockCatalogService = {
    groups(companyId) {
      requireCompany(db, companyId);
      return db.select().from(stockItemGroups).where(eq(stockItemGroups.companyId, companyId)).orderBy(asc(stockItemGroups.orderIndex), asc(stockItemGroups.id)).all();
    },

    addGroup(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(rawName);
      assertGroupNameFree(companyId, name);
      return mutate(
        db,
        audit,
        (tx, record) => {
          const next = tx
            .select({ m: sql<number>`coalesce(max(${stockItemGroups.orderIndex}), -1)` })
            .from(stockItemGroups)
            .where(eq(stockItemGroups.companyId, companyId))
            .get();
          const row = tx
            .insert(stockItemGroups)
            .values({ companyId, name, nameKey: stockNameKey(name), orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
            .returning()
            .get();
          record({ companyId, userId, entity: 'stock_group', entityId: row.id, action: 'create', diff: { name } });
          return row;
        },
        { behavior: 'immediate' },
      );
    },

    renameGroup(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireGroup(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Группа в архиве — сначала верните её из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      const name = changes.after.name!;
      assertGroupNameFree(companyId, name, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(stockItemGroups).set({ name, nameKey: stockNameKey(name) }).where(eq(stockItemGroups.id, id)).returning().get();
        record({ companyId, userId, entity: 'stock_group', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archiveGroup: (companyId, id, userId) => setGroupArchived(companyId, id, userId, true),
    unarchiveGroup: (companyId, id, userId) => setGroupArchived(companyId, id, userId, false),

    items(companyId) {
      requireCompany(db, companyId);
      const rows = db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).orderBy(asc(stockItems.nameKey), asc(stockItems.id)).all();
      const prices = db
        .select({ itemId: stockItemPrices.itemId, price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
        .from(stockItemPrices)
        .innerJoin(stockItems, eq(stockItems.id, stockItemPrices.itemId))
        .where(eq(stockItems.companyId, companyId))
        .orderBy(asc(stockItemPrices.validFrom))
        .all();
      const byItem = new Map<number, PricePoint[]>();
      for (const p of prices) {
        const list = byItem.get(p.itemId);
        if (list) list.push({ price: p.price, validFrom: p.validFrom });
        else byItem.set(p.itemId, [{ price: p.price, validFrom: p.validFrom }]);
      }
      const parts = partsOf(
        db,
        rows.filter((r) => r.isCombo).map((r) => r.id),
      );
      const used = itemsWithDocs(
        db,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, prices: byItem.get(r.id) ?? [], parts: parts.get(r.id) ?? [], hasDocs: used.has(r.id) }));
    },

    item(companyId, id) {
      requireCompany(db, companyId);
      return dto(requireItem(companyId, id));
    },

    addItem(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(input.name);
      assertItemNameFree(companyId, name);
      assertGroupChoice(companyId, input.groupId, null);
      assertMinQty(input.minQty, input.unit);
      if (input.isCombo) {
        if (!isWholeUnit(input.unit)) {
          throw new AppError(422, 'VALIDATION', 'Комплект считается в штуках или упаковках', { unit: 'Комплект считается в штуках или упаковках' });
        }
        assertParts(companyId, input.parts, null, []);
      } else if (input.parts.length > 0) {
        throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { parts: 'Состав — только у комплекта' });
      }
      const id = mutate(
        db,
        audit,
        (tx, record) => {
          const t = now().toISOString();
          const row = tx
            .insert(stockItems)
            .values({
              companyId,
              name,
              nameKey: stockNameKey(name),
              groupId: input.groupId,
              unit: input.unit,
              barcode: input.barcode,
              salePrice: input.salePrice,
              minQty: input.minQty,
              isCombo: input.isCombo,
              createdAt: t,
            })
            .returning({ id: stockItems.id })
            .get();
          if (input.isCombo) writeParts(tx, row.id, input.parts);
          if (input.salePrice > 0) {
            tx.insert(stockItemPrices).values({ itemId: row.id, price: input.salePrice, validFrom: today(), createdBy: userId, createdAt: t }).run();
          }
          record({
            companyId,
            userId,
            entity: 'stock_item',
            entityId: row.id,
            action: 'create',
            diff: {
              name,
              unit: input.unit,
              groupId: input.groupId,
              barcode: input.barcode,
              salePrice: input.salePrice,
              minQty: input.minQty,
              ...(input.isCombo ? { isCombo: true, parts: partsText(tx, input.parts) } : {}),
            },
          });
          return row.id;
        },
        { behavior: 'immediate' },
      );
      return dto(requireItem(companyId, id));
    },

    updateItem(companyId, id, patch, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireItem(companyId, id);
      const wanted: Partial<Pick<StockItemRow, 'name' | 'groupId' | 'unit' | 'barcode' | 'minQty'>> = {};
      if (patch.name !== undefined) wanted.name = cleanName(patch.name);
      if (patch.groupId !== undefined) wanted.groupId = patch.groupId;
      if (patch.unit !== undefined) wanted.unit = patch.unit;
      if (patch.barcode !== undefined) wanted.barcode = patch.barcode;
      if (patch.minQty !== undefined) wanted.minQty = patch.minQty;
      const changes = changedFields(
        { name: before.name, groupId: before.groupId, unit: before.unit, barcode: before.barcode, minQty: before.minQty },
        wanted,
      );
      // состав комплекта (решение 5): меняется, пока по комплекту нет документов
      const currentParts = partsOf(db, [id]).get(id) ?? [];
      let nextParts: ComboPart[] | null = null;
      if (patch.parts !== undefined) {
        if (!before.isCombo) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { parts: 'Состав — только у комплекта' });
        const same = patch.parts.length === currentParts.length && patch.parts.every((p, i) => p.itemId === currentParts[i]!.itemId && p.qty === currentParts[i]!.qty);
        if (!same) {
          if (itemsWithDocs(db, [id]).has(id)) {
            throw new AppError(422, 'INVARIANT_9', 'По комплекту есть документы — состав изменить нельзя', { parts: 'По комплекту есть документы' });
          }
          assertParts(companyId, patch.parts, id, currentParts);
          nextParts = patch.parts;
        }
      }
      if (!changes && !nextParts) return dto(before);
      const after = changes?.after ?? {};
      if (after.name !== undefined) assertItemNameFree(companyId, after.name, id);
      if (after.minQty !== undefined || after.unit !== undefined) {
        assertMinQty(after.minQty !== undefined ? after.minQty : before.minQty, after.unit ?? before.unit);
      }
      if (after.groupId !== undefined) assertGroupChoice(companyId, after.groupId, before.groupId);
      if (after.unit !== undefined) {
        if (before.isCombo && !isWholeUnit(after.unit)) {
          throw new AppError(422, 'VALIDATION', 'Комплект считается в штуках или упаковках', { unit: 'Комплект считается в штуках или упаковках' });
        }
        const used = db.select({ n: count() }).from(stockDocLines).where(eq(stockDocLines.itemId, id)).get()?.n ?? 0;
        // у составляющей единицу держит и состав комплекта, и взятое через комплект (R3)
        const viaCombo = comboUsing(id) !== undefined || db.get(sql`SELECT 1 AS x FROM stock_allocations WHERE component_item_id = ${id} LIMIT 1`) !== undefined;
        if (used > 0 || viaCombo) {
          throw new AppError(422, 'INVARIANT_9', 'По товару есть документы — единицу изменить нельзя', { unit: 'По товару есть документы' });
        }
      }
      mutate(db, audit, (tx, record) => {
        if (changes) {
          tx.update(stockItems)
            .set({ ...changes.after, ...(changes.after.name !== undefined ? { nameKey: stockNameKey(changes.after.name) } : {}) })
            .where(eq(stockItems.id, id))
            .run();
        }
        if (nextParts) writeParts(tx, id, nextParts);
        const diff = {
          before: { ...(changes?.before ?? {}), ...(nextParts ? { parts: partsText(tx, currentParts) } : {}) },
          after: { ...(changes?.after ?? {}), ...(nextParts ? { parts: partsText(tx, nextParts) } : {}) },
        };
        record({ companyId, userId, entity: 'stock_item', entityId: id, action: 'update', diff });
      });
      return dto(requireItem(companyId, id));
    },

    setPrice(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const item = requireItem(companyId, id);
      if (item.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — сначала верните его из архива`);
      const day = today();
      if (input.validFrom > day) {
        throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { validFrom: 'Дата начала не может быть в будущем' });
      }
      const history = pricesOf(id);
      if (history.some((p) => p.validFrom === input.validFrom && p.price === input.price)) return dto(item);
      mutate(
        db,
        audit,
        (tx, record) => {
          tx.insert(stockItemPrices)
            .values({ itemId: id, price: input.price, validFrom: input.validFrom, createdBy: userId, createdAt: now().toISOString() })
            .onConflictDoUpdate({ target: [stockItemPrices.itemId, stockItemPrices.validFrom], set: { price: input.price, createdBy: userId, createdAt: now().toISOString() } })
            .run();
          const next = priceAt(pricesOf(id), day);
          tx.update(stockItems).set({ salePrice: next }).where(eq(stockItems.id, id)).run();
          record({
            companyId,
            userId,
            entity: 'stock_item',
            entityId: id,
            action: 'update',
            diff: { before: { salePrice: item.salePrice }, after: { salePrice: next }, price: input.price, validFrom: input.validFrom },
          });
        },
        { behavior: 'immediate' },
      );
      return dto(requireItem(companyId, id));
    },

    archiveItem: (companyId, id, userId) => setItemArchived(companyId, id, userId, true),
    unarchiveItem: (companyId, id, userId) => setItemArchived(companyId, id, userId, false),

    removeItem(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireItem(companyId, id);
      const used = db.select({ n: count() }).from(stockDocLines).where(eq(stockDocLines.itemId, id)).get()?.n ?? 0;
      if (used > 0) throw new AppError(422, 'INVARIANT_9', 'По товару есть документы — его можно только перевести в архив');
      const combo = comboUsing(id);
      if (combo) throw new AppError(422, 'INVARIANT_9', `Товар входит в комплект «${combo.name}» — уберите его из состава`);
      mutate(db, audit, (tx, record) => {
        // удаление комплекта без документов удаляет и его состав (R3)
        tx.delete(stockComboParts).where(eq(stockComboParts.comboId, id)).run();
        tx.delete(stockItemPrices).where(eq(stockItemPrices.itemId, id)).run();
        tx.delete(stockItems).where(eq(stockItems.id, id)).run();
        record({ companyId, userId, entity: 'stock_item', entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
