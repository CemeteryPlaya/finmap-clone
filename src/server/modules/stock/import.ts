import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { CURRENCIES } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { COUNTERPARTY_NAME_MAX } from '../../../shared/schemas/counterparties';
import {
  STOCK_BARCODE_MAX,
  STOCK_DOC_LINES_MAX,
  STOCK_DOC_PREFIX,
  STOCK_GROUP_NAME_MAX,
  STOCK_IMPORT_MAX_ROWS,
  STOCK_ITEM_NAME_MAX,
  STOCK_LINE_AMOUNT_MAX,
  type StockImportIssue,
  type StockImportKind,
  type StockImportResult,
} from '../../../shared/schemas/stock';
import { foldCase } from '../../../shared/search';
import { isWholeUnit, QTY_MAX, WHOLE_UNIT_ERROR, type StockUnit } from '../../../shared/stock-qty';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { companies, counterparties, stockDocLines, stockDocs, stockItemGroups, stockItemPrices, stockItems, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { CsvHeaders } from '../imports/csv';
import { decimalToMinor, parseAmountCell, parseWallTime, wallToIso } from '../imports/parse-row';
import { readImportFile } from '../imports/read-file';
import type { Cell, SheetRow } from '../imports/xlsx-read';
import { stockNameKey } from './catalog';
import { buildGroup, clearGroup, groupsOf, type Pair } from './recalc';

/** Ошибок и названий «Будет создано» в ответе — не больше 100. */
const LIST_MAX = 100;

export interface StockImportService {
  run(companyId: number, userId: number, kind: StockImportKind, file: { name: string; data: Buffer }, opts: { warehouseId?: number; commit: boolean }): StockImportResult;
}

// ——— заголовки

type ItemField = 'name' | 'group' | 'unit' | 'barcode' | 'price';
type ReceiptField = 'date' | 'supplier' | 'item' | 'qty' | 'amount' | 'price';

/** Заголовки столбцов импорта; их же пишет шаблон (import-template.ts, план 2026-10-20, задача 6). */
export const ITEM_COLUMNS: Record<ItemField, string> = { name: 'Название', group: 'Группа', unit: 'Единица', barcode: 'Штрихкод', price: 'Цена продажи' };
export const RECEIPT_COLUMNS: Record<ReceiptField, string> = { date: 'Дата', supplier: 'Поставщик', item: 'Товар', qty: 'Количество', amount: 'Сумма', price: 'Цена' };

const headerKey = (s: string) => foldCase(cleanName(s));

/** Заголовки вида импорта: столбец → поле; обязательные столбцы — признак строки заголовков. */
function headerSpec<F extends string>(columns: Record<F, string>, required: readonly F[]) {
  const byKey = new Map<string, F>(Object.entries(columns).map(([field, title]) => [headerKey(title as string), field as F]));
  const fieldsOf = (values: string[]) => new Set(values.map((v) => byKey.get(headerKey(v))).filter((f): f is F => f !== undefined));
  const csv: CsvHeaders = { count: (values) => fieldsOf(values).size, isHeader: (values) => required.every((f) => fieldsOf(values).has(f)) };
  return { byKey, csv, columns };
}

const ITEMS = headerSpec(ITEM_COLUMNS, ['name']);
const RECEIPTS = headerSpec(RECEIPT_COLUMNS, ['date', 'item']);

const UNITS: Record<string, StockUnit> = {
  шт: 'pcs',
  штука: 'pcs',
  штук: 'pcs',
  pcs: 'pcs',
  л: 'l',
  литр: 'l',
  l: 'l',
  кг: 'kg',
  kg: 'kg',
  уп: 'pack',
  упаковка: 'pack',
  pack: 'pack',
};

/** Ошибка строки: первая найденная, остальные столбцы строки не проверяются. */
class RowError extends Error {
  constructor(readonly field: string) {
    super('row');
  }
}

interface Parsed<F extends string> {
  row: number;
  get(field: F): Cell | undefined;
  text(field: F): string;
}

/** Строка заголовков — первая из строк 1–10 с обязательными столбцами; данные — строки ниже, пустые пропускаются. */
function sheetRows<F extends string>(rows: SheetRow[], spec: ReturnType<typeof headerSpec<F>>): Parsed<F>[] {
  const head = rows.find((r) => r.row <= 10 && spec.csv.isHeader([...r.cells.values()].map((c) => c.value)));
  if (!head) {
    const titles = Object.values(spec.columns) as string[];
    throw new AppError(422, 'IMPORT_HEADER', `Не найдена строка заголовков: нужны столбцы ${titles.map((t) => `«${t}»`).join(', ')}`);
  }
  const columns = new Map<F, number>();
  for (const [col, cell] of head.cells) {
    const field = spec.byKey.get(headerKey(cell.value));
    if (field !== undefined && !columns.has(field)) columns.set(field, col);
  }
  const out: Parsed<F>[] = [];
  for (const r of rows) {
    if (r.row <= head.row) continue;
    const get = (field: F) => {
      const col = columns.get(field);
      const cell = col === undefined ? undefined : r.cells.get(col);
      return cell && cell.value.trim() !== '' ? cell : undefined;
    };
    if (![...columns.keys()].some((f) => get(f) !== undefined)) continue;
    out.push({ row: r.row, get, text: (field) => get(field)?.value.trim() ?? '' });
  }
  if (out.length > STOCK_IMPORT_MAX_ROWS) throw new AppError(422, 'IMPORT_TOO_MANY_ROWS', 'В файле больше 5 000 строк');
  return out;
}

const pushName = (list: string[], name: string) => {
  if (list.length < LIST_MAX) list.push(name);
};

export function createStockImportService(d: { db: Db; audit: AuditService; timezone: string; now?: () => Date }): StockImportService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const today = () => todayInTimezone(d.timezone, now());

  function minorUnitsOf(companyId: number): number {
    const c = db.select({ currency: companies.baseCurrency }).from(companies).where(eq(companies.id, companyId)).get();
    return CURRENCIES.find((x) => x.code === c?.currency)?.minorUnits ?? 2;
  }

  /** Деньги ячейки → минимальные единицы; null — пусто. */
  function money(cell: Cell | undefined, minor: number, negativeMessage: string): number | null {
    if (!cell) return null;
    const n = parseAmountCell(cell);
    if (n === 'too-large') throw new Error('Слишком большая сумма');
    if (n === null) throw new Error('Не число');
    if (n.negative) throw new Error(negativeMessage);
    const m = decimalToMinor(n.value, minor);
    if (!m || m.minor > STOCK_LINE_AMOUNT_MAX) throw new Error('Сумма слишком большая');
    return m.minor;
  }

  /**
   * Сумма строки по цене: точная запись цены × количество, округление половины вверх до минимальных единиц — один раз,
   * без промежуточного округления цены.
   */
  function priceAmount(cell: Cell | undefined, qty: number, minor: number): number | null {
    if (!cell) return null;
    const n = parseAmountCell(cell);
    if (n === 'too-large') throw new Error('Слишком большая цена');
    if (n === null) throw new Error('Не число');
    if (n.negative) throw new Error('Цена не меньше нуля');
    const [int = '0', frac = ''] = n.value.split('.');
    const num = BigInt(int + frac) * BigInt(qty) * 10n ** BigInt(minor);
    const den = 10n ** BigInt(frac.length) * 1000n;
    const v = (2n * num + den) / (2n * den);
    if (v > BigInt(STOCK_LINE_AMOUNT_MAX)) throw new Error('Сумма слишком большая');
    return Number(v);
  }

  /** Количество ячейки → тысячные доли: больше нуля, до трёх знаков после запятой. */
  function quantity(cell: Cell | undefined): number {
    if (!cell) throw new Error('Укажите количество');
    const n = parseAmountCell(cell);
    if (n === 'too-large') throw new Error('Слишком большое количество');
    if (n === null) throw new Error('Введите количество, например 1,5');
    if (n.negative || n.value === '0') throw new Error('Количество больше нуля');
    if ((n.value.split('.')[1] ?? '').length > 3) throw new Error('Не больше трёх знаков после запятой');
    const q = decimalToMinor(n.value, 3);
    if (!q || q.minor > QTY_MAX) throw new Error('Слишком большое количество');
    return q.minor;
  }

  /** Проверка одного столбца: ошибка текстом исключения становится ошибкой строки с подписью столбца. */
  function field<T>(title: string, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof RowError || e instanceof AppError) throw e;
      throw Object.assign(new RowError(title), { message: (e as Error).message });
    }
  }

  function emptyResult(rows: number): StockImportResult {
    return {
      rows,
      errors: [],
      errorsTotal: 0,
      create: { items: 0, groups: 0, suppliers: 0 },
      names: { items: [], groups: [], suppliers: [] },
      skip: { items: 0 },
      docs: 0,
      lines: 0,
      total: 0,
      committed: false,
    };
  }

  const addError = (r: StockImportResult, issue: StockImportIssue) => {
    r.errorsTotal++;
    if (r.errors.length < LIST_MAX) r.errors.push(issue);
  };

  function catalog(companyId: number, data: Parsed<ItemField>[], minor: number) {
    const result = emptyResult(data.length);
    const items = new Map(db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).all().map((i) => [i.nameKey, i]));
    const groups = new Map(db.select().from(stockItemGroups).where(eq(stockItemGroups.companyId, companyId)).all().map((g) => [g.nameKey, g]));
    const seen = new Map<string, number>();
    const newGroups = new Map<string, string>();
    const plan: { name: string; groupKey: string | null; unit: StockUnit; barcode: string | null; price: number }[] = [];
    for (const r of data) {
      try {
        const name = field(ITEM_COLUMNS.name, () => {
          const v = cleanName(r.text('name'));
          if (v === '') throw new Error('Укажите название');
          if (v.length > STOCK_ITEM_NAME_MAX) throw new Error(`Не длиннее ${STOCK_ITEM_NAME_MAX} символов`);
          return v;
        });
        const key = stockNameKey(name);
        const first = seen.get(key);
        if (first !== undefined) throw Object.assign(new RowError(ITEM_COLUMNS.name), { message: `Товар «${name}» уже есть в файле (строка ${first})` });
        seen.set(key, r.row);
        const groupName = field(ITEM_COLUMNS.group, () => {
          const v = cleanName(r.text('group'));
          if (v.length > STOCK_GROUP_NAME_MAX) throw new Error(`Не длиннее ${STOCK_GROUP_NAME_MAX} символов`);
          const g = v === '' ? undefined : groups.get(stockNameKey(v));
          if (g?.archivedAt) throw new Error(`Группа «${g.name}» в архиве`);
          return v === '' ? null : v;
        });
        const unit = field(ITEM_COLUMNS.unit, () => {
          const raw = r.text('unit');
          if (raw === '') return 'pcs' as StockUnit;
          const u = UNITS[headerKey(raw).replace(/\.$/, '')];
          if (!u) throw new Error(`Неизвестная единица «${raw}»: шт, л, кг или уп`);
          return u;
        });
        const barcode = field(ITEM_COLUMNS.barcode, () => {
          const v = r.text('barcode');
          if (v.length > STOCK_BARCODE_MAX) throw new Error(`Не длиннее ${STOCK_BARCODE_MAX} символов`);
          return v === '' ? null : v;
        });
        const price = field(ITEM_COLUMNS.price, () => money(r.get('price'), minor, 'Цена не меньше нуля')) ?? 0;
        if (items.has(key)) {
          result.skip.items++;
          continue;
        }
        const groupKey = groupName === null ? null : stockNameKey(groupName);
        if (groupKey !== null && !groups.has(groupKey) && !newGroups.has(groupKey)) {
          newGroups.set(groupKey, groupName!);
          pushName(result.names.groups, groupName!);
        }
        plan.push({ name, groupKey, unit, barcode, price });
        pushName(result.names.items, name);
      } catch (e) {
        if (!(e instanceof RowError)) throw e;
        addError(result, { row: r.row, field: e.field, message: e.message });
      }
    }
    result.create = { items: plan.length, groups: newGroups.size, suppliers: 0 };
    return {
      result,
      write(tx: Executor, userId: number) {
        const t = now().toISOString();
        const groupIds = new Map([...groups].map(([k, g]) => [k, g.id]));
        let order = tx.get<{ m: number }>(sql`SELECT COALESCE(MAX(order_index), -1) AS m FROM stock_item_groups WHERE company_id = ${companyId}`)!.m;
        for (const [key, name] of newGroups) {
          const row = tx.insert(stockItemGroups).values({ companyId, name, nameKey: key, orderIndex: ++order, createdAt: t }).returning({ id: stockItemGroups.id }).get();
          groupIds.set(key, row.id);
        }
        for (const p of plan) {
          const row = tx
            .insert(stockItems)
            .values({
              companyId,
              name: p.name,
              nameKey: stockNameKey(p.name),
              groupId: p.groupKey === null ? null : groupIds.get(p.groupKey)!,
              unit: p.unit,
              barcode: p.barcode,
              salePrice: p.price,
              createdAt: t,
            })
            .returning({ id: stockItems.id })
            .get();
          if (p.price > 0) tx.insert(stockItemPrices).values({ itemId: row.id, price: p.price, validFrom: today(), createdBy: userId, createdAt: t }).run();
        }
      },
    };
  }

  function receipts(companyId: number, warehouseId: number, data: Parsed<ReceiptField>[], date1904: boolean, minor: number, hash: string) {
    const result = emptyResult(data.length);
    const items = new Map(db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).all().map((i) => [i.nameKey, i]));
    // поставщик — по названию среди контрагентов любого типа: первый неархивный, иначе архивный (R10)
    const suppliers = new Map<string, { id: number; name: string; archived: boolean }>();
    for (const c of db.select().from(counterparties).where(eq(counterparties.companyId, companyId)).orderBy(counterparties.id).all()) {
      const key = stockNameKey(c.name);
      const known = suppliers.get(key);
      if (!known || (known.archived && !c.archivedAt)) suppliers.set(key, { id: c.id, name: c.name, archived: c.archivedAt !== null });
    }
    const newItems = new Map<string, string>();
    const newSuppliers = new Map<string, string>();
    const day = today();
    type Line = { row: number; itemKey: string; qty: number; amount: number };
    const docs: { at: string; supplierKey: string | null; firstRow: number; lines: Line[] }[] = [];
    const open = new Map<string, (typeof docs)[number]>();

    const loaded = db.get<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM stock_docs WHERE company_id = ${companyId} AND source = 'import' AND deleted_at IS NULL AND source_ref LIKE ${`${hash}:%`}`)!.n;
    if (loaded > 0) addError(result, { row: 0, field: 'Файл', message: 'Этот файл уже загружен' });

    for (const r of data) {
      try {
        const at = field(RECEIPT_COLUMNS.date, () => {
          const cell = r.get('date');
          if (!cell) throw new Error('Укажите дату');
          const w = parseWallTime(cell, date1904);
          if (!w) throw new Error('Неверная дата');
          // без времени — середина дня по часам компании (решение 9). Число Excel не отличает «без времени» от 00:00,
          // поэтому и явная полночь становится полднем: в один день это не меняет ни период, ни порядок поступлений
          const iso = wallToIso(w.seconds === 0 ? { ...w, seconds: 12 * 3600 } : w, d.timezone);
          if (w.date > day) throw new Error('Дата в будущем');
          return iso;
        });
        const supplierName = cleanName(r.text('supplier'));
        const supplierKey = supplierName === '' ? null : stockNameKey(supplierName);
        field(RECEIPT_COLUMNS.supplier, () => {
          if (supplierName.length > COUNTERPARTY_NAME_MAX) throw new Error(`Не длиннее ${COUNTERPARTY_NAME_MAX} символов`);
          const known = supplierKey === null ? undefined : suppliers.get(supplierKey);
          if (known?.archived) throw new Error(`Поставщик «${known.name}» в архиве`);
        });
        const itemName = field(RECEIPT_COLUMNS.item, () => {
          const v = cleanName(r.text('item'));
          if (v === '') throw new Error('Укажите товар');
          if (v.length > STOCK_ITEM_NAME_MAX) throw new Error(`Не длиннее ${STOCK_ITEM_NAME_MAX} символов`);
          const known = items.get(stockNameKey(v));
          if (known?.isCombo) throw new Error('Комплект нельзя оприходовать — оприходуйте его составляющие');
          if (known?.archivedAt) throw new Error(`Товар «${known.name}» в архиве`);
          return v;
        });
        const itemKey = stockNameKey(itemName);
        const unit = items.get(itemKey)?.unit ?? 'pcs';
        const qty = field(RECEIPT_COLUMNS.qty, () => {
          const q = quantity(r.get('qty'));
          if (isWholeUnit(unit) && q % 1000 !== 0) throw new Error(WHOLE_UNIT_ERROR);
          return q;
        });
        const amount = field(RECEIPT_COLUMNS.amount, () => {
          const sum = money(r.get('amount'), minor, 'Сумма не меньше нуля');
          if (sum !== null) return sum;
          const byPrice = field(RECEIPT_COLUMNS.price, () => priceAmount(r.get('price'), qty, minor));
          if (byPrice === null) throw new Error('Укажите сумму или цену');
          return byPrice;
        });

        if (!items.has(itemKey) && !newItems.has(itemKey)) {
          newItems.set(itemKey, itemName);
          pushName(result.names.items, itemName);
        }
        if (supplierKey !== null && !suppliers.has(supplierKey) && !newSuppliers.has(supplierKey)) {
          newSuppliers.set(supplierKey, supplierName);
          pushName(result.names.suppliers, supplierName);
        }
        // один документ на момент и поставщика; больше 200 строк — следующий документ
        const key = `${at}|${supplierKey ?? ''}`;
        let doc = open.get(key);
        if (!doc || doc.lines.length >= STOCK_DOC_LINES_MAX) {
          doc = { at, supplierKey, firstRow: r.row, lines: [] };
          docs.push(doc);
          open.set(key, doc);
        }
        doc.lines.push({ row: r.row, itemKey, qty, amount });
        result.lines++;
        result.total += amount;
      } catch (e) {
        if (!(e instanceof RowError)) throw e;
        addError(result, { row: r.row, field: e.field, message: e.message });
      }
    }
    result.docs = docs.length;
    result.create = { items: newItems.size, groups: 0, suppliers: newSuppliers.size };
    return {
      result,
      write(tx: Executor, userId: number) {
        const t = now().toISOString();
        const itemIds = new Map([...items].map(([k, i]) => [k, i.id]));
        for (const [key, name] of newItems) {
          const row = tx.insert(stockItems).values({ companyId, name, nameKey: key, unit: 'pcs', createdAt: t }).returning({ id: stockItems.id }).get();
          itemIds.set(key, row.id);
        }
        const supplierIds = new Map([...suppliers].map(([k, s]) => [k, s.id]));
        let order = tx.get<{ m: number }>(sql`SELECT COALESCE(MAX(order_index), -1) AS m FROM counterparties WHERE company_id = ${companyId}`)!.m;
        for (const [key, name] of newSuppliers) {
          const row = tx.insert(counterparties).values({ companyId, type: 'supplier', name, orderIndex: ++order, createdAt: t }).returning({ id: counterparties.id }).get();
          supplierIds.set(key, row.id);
        }
        // удалённые документы прежней загрузки этого файла не мешают уникальности источника (R10)
        tx.run(sql`
          UPDATE stock_docs SET source_ref = source_ref || ':deleted:' || id
           WHERE company_id = ${companyId} AND source = 'import' AND deleted_at IS NOT NULL AND source_ref LIKE ${`${hash}:%`}
             AND source_ref NOT LIKE '%:deleted:%'`);
        let number = tx.get<{ m: number }>(sql`
          SELECT COALESCE(MAX(CAST(SUBSTR(number, 3) AS INTEGER)), 0) AS m FROM stock_docs WHERE company_id = ${companyId} AND type = 'receipt'`)!.m;
        const pairs: Pair[] = [];
        for (const doc of docs) {
          const row = tx
            .insert(stockDocs)
            .values({
              companyId,
              type: 'receipt',
              number: `${STOCK_DOC_PREFIX.receipt}-${String(++number).padStart(4, '0')}`,
              at: doc.at,
              warehouseId,
              counterpartyId: doc.supplierKey === null ? null : supplierIds.get(doc.supplierKey)!,
              status: 'posted',
              source: 'import',
              sourceRef: `${hash}:${doc.firstRow}`,
              createdBy: userId,
              createdAt: t,
              updatedAt: t,
              version: 1,
            })
            .returning({ id: stockDocs.id })
            .get();
          doc.lines.forEach((l, i) => {
            const itemId = itemIds.get(l.itemKey)!;
            tx.insert(stockDocLines).values({ docId: row.id, position: i, itemId, qty: l.qty, amount: l.amount }).run();
            pairs.push({ warehouseId, itemId });
          });
        }
        // один пересчёт всех затронутых групп: поступления только добавляют партии
        for (const g of groupsOf(tx, companyId, pairs)) {
          clearGroup(tx, g);
          buildGroup(tx, companyId, g);
        }
      },
    };
  }

  return {
    run(companyId, userId, kind, file, opts) {
      requireCompany(db, companyId, opts.commit ? { writable: true } : undefined);
      let warehouseId = 0;
      if (kind === 'receipts') {
        if (opts.warehouseId === undefined) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { warehouse: 'Выберите склад' });
        const wh = db.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, opts.warehouseId), eq(stockWarehouses.companyId, companyId))).get();
        if (!wh) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { warehouse: 'Склад не найден в этой компании' });
        if (wh.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', `Склад «${wh.name}» в архиве — выберите другой`);
        warehouseId = wh.id;
      }
      const minor = minorUnitsOf(companyId);
      const sheet = readImportFile(file.data, file.name, kind === 'items' ? ITEMS.csv : RECEIPTS.csv);
      const plan =
        kind === 'items'
          ? catalog(companyId, sheetRows(sheet.rows, ITEMS), minor)
          : receipts(
              companyId,
              warehouseId,
              sheetRows(sheet.rows, RECEIPTS),
              sheet.date1904,
              minor,
              crypto.createHash('sha256').update(file.data).digest('hex').slice(0, 16),
            );
      if (!opts.commit) return plan.result;
      if (plan.result.errorsTotal > 0) {
        throw new AppError(422, 'IMPORT_INVALID', 'В файле есть ошибки — исправьте их и загрузите снова', undefined, { ...plan.result });
      }
      mutate(
        db,
        audit,
        (tx, record) => {
          plan.write(tx, userId);
          const r = plan.result;
          record({
            companyId,
            userId,
            entity: 'stock_import',
            entityId: null,
            action: 'create',
            diff: { kind, fileName: file.name, rows: r.rows, items: r.create.items, groups: r.create.groups, suppliers: r.create.suppliers, docs: r.docs, lines: r.lines },
          });
        },
        { behavior: 'immediate' },
      );
      return { ...plan.result, committed: true };
    },
  };
}
