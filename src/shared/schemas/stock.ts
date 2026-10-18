import { z } from 'zod';
import { isValidDate } from '../dates';
import { QTY_MAX, STOCK_UNITS } from '../stock-qty';
import { nameField } from '../text';
import { paidAt } from './operations';

export const STOCK_ITEM_NAME_MAX = 100;
export const STOCK_GROUP_NAME_MAX = 50;
export const STOCK_WAREHOUSE_NAME_MAX = 100;
export const STOCK_BARCODE_MAX = 40;
export const STOCK_DOC_LINES_MAX = 200;
export const STOCK_COMMENT_MAX = 2000;

/** Типы документов склада: «Склад-1» — поступление, продажа, списание; «Склад-2» — перемещение и инвентаризация. */
export const STOCK_DOC_TYPES = ['receipt', 'sale', 'writeoff', 'transfer', 'count'] as const;
export type StockDocType = (typeof STOCK_DOC_TYPES)[number];
export const STOCK_DOC_TYPE_LABELS: Record<StockDocType, string> = {
  receipt: 'Поступление',
  sale: 'Продажа',
  writeoff: 'Списание',
  transfer: 'Перемещение',
  count: 'Инвентаризация',
};
/** Буква номера документа: «П-0001», «Р-0001», «С-0001», «М-0001», «И-0001». */
export const STOCK_DOC_PREFIX: Record<StockDocType, string> = { receipt: 'П', sale: 'Р', writeoff: 'С', transfer: 'М', count: 'И' };

export const WRITEOFF_REASONS = ['defect', 'spoiled', 'own_use', 'other'] as const;
export type WriteoffReason = (typeof WRITEOFF_REASONS)[number];
export const WRITEOFF_REASON_LABELS: Record<WriteoffReason, string> = {
  defect: 'Брак',
  spoiled: 'Испорчено',
  own_use: 'Для своих нужд',
  other: 'Другое',
};

const id = z.number().int().positive();
const money = z.number().int('Сумма — целое число минимальных единиц').min(0, 'Сумма не меньше нуля').max(Number.MAX_SAFE_INTEGER, 'Слишком большая сумма');
/** Сумма строки документа склада: не больше 10^13 минимальных единиц, чтобы суммы по документам оставались точными. */
export const STOCK_LINE_AMOUNT_MAX = 10_000_000_000_000;
const lineMoney = money.max(STOCK_LINE_AMOUNT_MAX, 'Сумма слишком большая');
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .nullable()
    .transform((v) => v || null);

export const stockGroupSchema = z.object({ name: nameField(STOCK_GROUP_NAME_MAX) });

/** Наибольшее число составляющих комплекта. */
export const STOCK_COMBO_PARTS_MAX = 20;
/** Состав комплекта: составляющая и её количество на один комплект (тысячные доли её единицы). */
const comboParts = z
  .array(
    z.object({
      itemId: id,
      qty: z.number().int('Количество — целое число тысячных долей').min(1, 'Количество больше нуля').max(QTY_MAX, 'Слишком большое количество'),
    }),
  )
  .max(STOCK_COMBO_PARTS_MAX, `Не больше ${STOCK_COMBO_PARTS_MAX} составляющих`);

export const stockItemCreateSchema = z.object({
  name: nameField(STOCK_ITEM_NAME_MAX),
  groupId: id.nullable().default(null),
  unit: z.enum(STOCK_UNITS, { message: 'Выберите единицу' }),
  barcode: nullableText(STOCK_BARCODE_MAX).default(null),
  /** Цена продажи за единицу; больше нуля — пишет первую строку истории с сегодняшней даты. */
  salePrice: money.default(0),
  minQty: z.number().int().min(1, 'Больше нуля').max(QTY_MAX, 'Слишком большое количество').nullable().default(null),
  /** Комплект (решение 5 плана Склад-2): задаётся только при создании, своего остатка нет. */
  isCombo: z.boolean().default(false),
  parts: comboParts.default([]),
});

export const stockItemUpdateSchema = z.object({
  name: nameField(STOCK_ITEM_NAME_MAX).optional(),
  groupId: id.nullable().optional(),
  unit: z.enum(STOCK_UNITS, { message: 'Выберите единицу' }).optional(),
  barcode: nullableText(STOCK_BARCODE_MAX).optional(),
  minQty: z.number().int().min(1, 'Больше нуля').max(QTY_MAX, 'Слишком большое количество').nullable().optional(),
  /** Новый состав комплекта; меняется, пока по комплекту нет документов. */
  parts: comboParts.optional(),
});

export const stockPriceSchema = z.object({
  price: money,
  validFrom: z.string().refine(isValidDate, 'Неверная дата'),
});

export const stockWarehouseCreateSchema = z.object({
  projectId: id,
  name: nameField(STOCK_WAREHOUSE_NAME_MAX),
});

export const stockWarehouseUpdateSchema = z.object({ name: nameField(STOCK_WAREHOUSE_NAME_MAX) });

const docLine = z.object({
  itemId: id,
  qty: z.number().int('Количество — целое число тысячных долей').min(1, 'Количество больше нуля').max(QTY_MAX, 'Слишком большое количество'),
  /** У поступления — сумма закупки по строке, у продажи — сумма продажи; у списания не передаётся. */
  amount: lineMoney.nullable().default(null),
});
const docLines = z.array(docLine).min(1, 'Добавьте хотя бы одну строку').max(STOCK_DOC_LINES_MAX, `Не больше ${STOCK_DOC_LINES_MAX} строк`);
const docComment = nullableText(STOCK_COMMENT_MAX);

export const stockDocCreateSchema = z.object({
  type: z.enum(STOCK_DOC_TYPES, { message: 'Неверный тип документа' }),
  at: paidAt,
  warehouseId: id,
  /** Склад-получатель — только у перемещения. */
  toWarehouseId: id.nullable().default(null),
  counterpartyId: id.nullable().default(null),
  reason: z.enum(WRITEOFF_REASONS, { message: 'Неверная причина списания' }).nullable().default(null),
  comment: docComment.optional(),
  lines: docLines,
  /** Только посчитать последствия (§5.4): ничего не записывается. */
  dryRun: z.boolean().default(false),
});

export const stockDocUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  at: paidAt.optional(),
  warehouseId: id.optional(),
  toWarehouseId: id.nullable().optional(),
  counterpartyId: id.nullable().optional(),
  reason: z.enum(WRITEOFF_REASONS, { message: 'Неверная причина списания' }).nullable().optional(),
  comment: docComment.optional(),
  lines: docLines.optional(),
  dryRun: z.boolean().default(false),
});

/** Строк в инвентаризации больше, чем в других документах: считается весь бар (R11). */
export const STOCK_COUNT_LINES_MAX = 1000;
/** Строка инвентаризации: товар и факт (тысячные доли; null — ещё не посчитан, 0 — пусто). */
const countLines = z
  .array(
    z.object({
      itemId: id,
      countedQty: z.number().int('Количество — целое число тысячных долей').min(0, 'Количество не меньше нуля').max(QTY_MAX, 'Слишком большое количество').nullable(),
    }),
  )
  .max(STOCK_COUNT_LINES_MAX, `Не больше ${STOCK_COUNT_LINES_MAX} строк`);

/** Новая инвентаризация (§7): черновик; `fill` — добавить все товары склада с ненулевым остатком на дату. */
export const stockCountCreateSchema = z.object({
  type: z.literal('count'),
  at: paidAt,
  warehouseId: id,
  comment: docComment.optional(),
  lines: countLines.default([]),
  fill: z.boolean().default(false),
});

/** Правка черновика инвентаризации: склад не меняется. */
export const stockCountUpdateSchema = z.object({
  version: z.number().int().min(1),
  at: paidAt.optional(),
  warehouseId: id.optional(),
  comment: docComment.optional(),
  lines: countLines.optional(),
});

/** «Провести» инвентаризацию: версия, которую видел клиент. */
export const stockCountPostSchema = z.object({ version: z.number().int().min(1) });

export const stockDocListSchema = z.object({
  type: z.enum(STOCK_DOC_TYPES).optional(),
  warehouse: z.coerce.number().int().positive().optional(),
  from: z.string().refine(isValidDate, 'Неверная дата').optional(),
  to: z.string().refine(isValidDate, 'Неверная дата').optional(),
  limit: z.coerce.number().int().min(1, 'От 1 до 500').max(500, 'От 1 до 500').default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** «Провести в журнал»: на какой счёт и в какой категории дохода. */
export const stockJournalSchema = z.object({ accountId: id, categoryId: id });

export const stockBalanceSchema = z.object({
  warehouse: z.coerce.number().int().positive().optional(),
  /** Остаток на конец календарного дня; без даты — сейчас. */
  at: z.string().refine(isValidDate, 'Неверная дата').optional(),
});

export type StockItemCreate = z.output<typeof stockItemCreateSchema>;
export type StockItemUpdate = z.output<typeof stockItemUpdateSchema>;
export type StockDocCreate = z.output<typeof stockDocCreateSchema>;
export type StockDocUpdate = z.output<typeof stockDocUpdateSchema>;
export type StockDocList = z.output<typeof stockDocListSchema>;
export type StockCountCreate = z.output<typeof stockCountCreateSchema>;
export type StockCountUpdate = z.output<typeof stockCountUpdateSchema>;
