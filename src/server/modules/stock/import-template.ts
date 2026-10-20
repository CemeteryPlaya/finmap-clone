import { and, asc, eq, isNull } from 'drizzle-orm';
import { addDays, todayInTimezone } from '../../../shared/dates';
import { STOCK_IMPORT_MAX_ROWS, type StockImportKind } from '../../../shared/schemas/stock';
import { STOCK_UNITS, UNIT_LABELS } from '../../../shared/stock-qty';
import type { Db, Executor } from '../../db/client';
import { counterparties, stockItemGroups, stockItems } from '../../db/schema';
import { buildXlsx, type XlsxCell, type XlsxListValidation, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { excelDate } from '../operations/journal-export';
import { stockNameKey } from './catalog';
import { ITEM_COLUMNS, RECEIPT_COLUMNS } from './import';

/**
 * Шаблоны импорта склада (спецификация 2026-10-19, часть 4; план 2026-10-20, решение 12): лист данных с заголовками и
 * двумя строками примера, «Как заполнять» и скрытый лист «Списки» — выпадающие списки ячеек ссылаются на его столбцы
 * (встроенный список Excel ограничен 255 символами). Списки — по текущим данным компании.
 */

export const STOCK_TEMPLATE_FILE: Record<StockImportKind, string> = { items: 'Шаблон товаров.xlsx', receipts: 'Шаблон поступлений.xlsx' };

const DATA_SHEET: Record<StockImportKind, string> = { items: 'Товары', receipts: 'Поступления' };
const LISTS = 'Списки';

/** Правила листа «Как заполнять» — по поведению импорта (§9.1 спецификации «Склад», решение 9 плана Склад-2/3). */
export const STOCK_TEMPLATE_RULES: Record<StockImportKind, readonly string[]> = {
  items: [
    'Заполняйте первый лист «Товары». Строки 2–3 — примеры: замените или удалите их.',
    'Обязательный столбец — «Название». Товар с названием, которое уже есть в каталоге, пропускается.',
    'Группа и Единица выбираются из списка в ячейке; новую группу можно вписать — она будет создана.',
    'Единица — шт, л, кг или уп; пусто — шт.',
    'Цена продажи — число, копейки через точку или запятую: 350 или 350,50.',
    'Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.',
  ],
  receipts: [
    'Заполняйте первый лист «Поступления». Строки 2–3 — примеры: замените или удалите их.',
    'Обязательные столбцы — «Дата», «Товар», «Количество» и «Сумма» или «Цена».',
    'Дата — дд.мм.гггг или дд.мм.гггг чч:мм; без времени — 12:00. Дата в будущем — ошибка.',
    'Товар и Поставщик выбираются из списка в ячейке; новое название можно вписать — товар (в штуках) или поставщик будет создан.',
    'Количество в шт и уп — целое, в л и кг — до трёх знаков после запятой.',
    'Сумма — за всю строку, Цена — за единицу; если заполнены обе, берётся Сумма.',
    'Строки с одной датой и одним поставщиком становятся одним поступлением на склад, выбранный в окне импорта.',
    'Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.',
  ],
};

const text = (value: string): XlsxCell => ({ kind: 'text', value });
const num = (value: string, decimals: number): XlsxCell => ({ kind: 'number', value, decimals });
/** Буква столбца листа «Списки» по номеру (их не больше двух). */
const LETTERS = ['A', 'B'] as const;

/**
 * Лист «Списки» и выпадающие списки листа данных: столбец «Списки» на каждый список; список пустой — у столбца данных
 * выпадающего списка нет (решение 12). target — номер столбца листа данных.
 */
function listsOf(lists: { header: string; values: string[]; target: number }[]): { sheet: XlsxSheet; validations: XlsxListValidation[] } {
  const height = Math.max(0, ...lists.map((l) => l.values.length));
  const rows: XlsxCell[][] = Array.from({ length: height }, (_, r) => lists.map((l) => (r < l.values.length ? text(l.values[r]!) : null)));
  const validations = lists.flatMap((l, i) =>
    l.values.length === 0
      ? []
      : [{ column: l.target, fromRow: 2, toRow: STOCK_IMPORT_MAX_ROWS + 1, source: `'${LISTS}'!$${LETTERS[i]}$2:$${LETTERS[i]}$${l.values.length + 1}` }],
  );
  return { sheet: { name: LISTS, columns: lists.map((l) => ({ header: l.header, width: 28 })), rows, hidden: true }, validations };
}

/** Листы шаблона: данные, «Как заполнять», скрытые «Списки». today — сегодня по APP_TIMEZONE (примеры поступлений — вчера). */
export function stockTemplateSheets(ex: Executor, companyId: number, kind: StockImportKind, today: string): XlsxSheet[] {
  const rules: XlsxSheet = { name: 'Как заполнять', columns: [{ header: 'Правила', width: 110 }], rows: STOCK_TEMPLATE_RULES[kind].map((r) => [text(r)]) };
  if (kind === 'items') {
    const groups = ex
      .select({ name: stockItemGroups.name })
      .from(stockItemGroups)
      .where(and(eq(stockItemGroups.companyId, companyId), isNull(stockItemGroups.archivedAt)))
      .orderBy(asc(stockItemGroups.nameKey))
      .all()
      .map((g) => g.name);
    const units = STOCK_UNITS.map((u) => UNIT_LABELS[u]);
    const { sheet, validations } = listsOf([
      { header: ITEM_COLUMNS.group, values: groups, target: 1 },
      { header: ITEM_COLUMNS.unit, values: units, target: 2 },
    ]);
    const data: XlsxSheet = {
      name: DATA_SHEET.items,
      columns: [
        { header: ITEM_COLUMNS.name, width: 28 },
        { header: ITEM_COLUMNS.group, width: 20 },
        { header: ITEM_COLUMNS.unit, width: 10 },
        { header: ITEM_COLUMNS.barcode, width: 16 },
        { header: ITEM_COLUMNS.price, width: 14 },
      ],
      rows: [
        [text('Кола 0,5'), text('Напитки'), text('шт'), null, num('350', 2)],
        [text('Чипсы'), text('Снеки'), text('шт'), null, num('400', 2)],
      ],
      validations,
    };
    return [data, rules, sheet];
  }
  const items = ex
    .select({ name: stockItems.name })
    .from(stockItems)
    .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.archivedAt), eq(stockItems.isCombo, false)))
    .orderBy(asc(stockItems.nameKey))
    .all()
    .map((i) => i.name);
  // у контрагентов имя не уникально и ключа имени нет: порядок и повторы — по stockNameKey, как сопоставляет импорт
  const byKey = new Map<string, string>();
  for (const c of ex
    .select({ name: counterparties.name })
    .from(counterparties)
    .where(and(eq(counterparties.companyId, companyId), eq(counterparties.type, 'supplier'), isNull(counterparties.archivedAt)))
    .orderBy(asc(counterparties.id))
    .all()) {
    const key = stockNameKey(c.name);
    if (!byKey.has(key)) byKey.set(key, c.name);
  }
  const suppliers = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, name]) => name);
  const { sheet, validations } = listsOf([
    { header: RECEIPT_COLUMNS.item, values: items, target: 2 },
    { header: RECEIPT_COLUMNS.supplier, values: suppliers, target: 1 },
  ]);
  const day: XlsxCell = { kind: 'date', value: excelDate(addDays(today, -1)) };
  const data: XlsxSheet = {
    name: DATA_SHEET.receipts,
    columns: [
      { header: RECEIPT_COLUMNS.date, width: 12 },
      { header: RECEIPT_COLUMNS.supplier, width: 24 },
      { header: RECEIPT_COLUMNS.item, width: 28 },
      { header: RECEIPT_COLUMNS.qty, width: 12 },
      { header: RECEIPT_COLUMNS.amount, width: 14 },
      { header: RECEIPT_COLUMNS.price, width: 12 },
    ],
    rows: [
      [day, text('Поставщик А'), text('Кола 0,5'), num('24', 0), num('7200', 2), null],
      [day, text('Поставщик А'), text('Чипсы'), num('10', 0), null, num('250', 2)],
    ],
    validations,
  };
  return [data, rules, sheet];
}

export interface StockTemplateService {
  /** Файл шаблона по текущим данным компании; нет компании — 404. */
  template(companyId: number, kind: StockImportKind): { fileName: string; data: Buffer };
}

export function createStockTemplateService(d: { db: Db; timezone: string; now?: () => Date }): StockTemplateService {
  const now = d.now ?? (() => new Date());
  return {
    template(companyId, kind) {
      requireCompany(d.db, companyId);
      const sheets = stockTemplateSheets(d.db, companyId, kind, todayInTimezone(d.timezone, now()));
      return { fileName: STOCK_TEMPLATE_FILE[kind], data: buildXlsx(sheets, { strings: 'shared' }) };
    },
  };
}
