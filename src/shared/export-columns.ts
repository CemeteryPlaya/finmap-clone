import { columnTitle, type FinmapField } from './finmap-format';

/**
 * Колонки «Собрать Excel» (§8.3 спецификации импорта): колонки формата Finmap и «наши» (тип, валюта, остатки).
 * Общий каталог сервера и окна. «Статус (план/факт)», «Подконтрагент» и «Подпроект» в каталоге нет: у нас эти колонки
 * всегда пустые, мёртвых чипов нет.
 */
export type ExportGroupId = 'operation' | 'accounts' | 'categories' | 'counterparties' | 'projects' | 'tagsComment' | 'balances';

/** Колонки Finmap берут идентификатор и название у колонок шаблона (§2.1): название без звёздочки. */
type FinmapExportField = Exclude<FinmapField, 'subcounterparty' | 'subproject'>;

const finmap = (field: FinmapExportField, group: ExportGroupId) => ({ id: field, label: columnTitle(field), group, ours: false }) as const;
const ours = (id: 'type' | 'currency' | 'balanceAfter' | 'toAmount' | 'toCurrency' | 'toBalanceAfter', label: string, group: ExportGroupId) =>
  ({ id, label, group, ours: true }) as const;

/** Колонки в порядке показа чипов; порядок внутри группы — как в Finmap. */
export const EXPORT_COLUMNS = [
  finmap('paidAt', 'operation'),
  finmap('accrualDate', 'operation'),
  finmap('periodFrom', 'operation'),
  finmap('periodTo', 'operation'),
  finmap('amount', 'operation'),
  finmap('baseAmount', 'operation'),
  ours('type', 'Тип', 'operation'),
  finmap('fromAccount', 'accounts'),
  finmap('toAccount', 'accounts'),
  finmap('category', 'categories'),
  finmap('subcategory', 'categories'),
  finmap('counterparty', 'counterparties'),
  finmap('project', 'projects'),
  finmap('tags', 'tagsComment'),
  finmap('comment', 'tagsComment'),
  ours('currency', 'Валюта счёта', 'balances'),
  ours('balanceAfter', 'Остаток после операции', 'balances'),
  ours('toAmount', 'Сумма зачисления', 'balances'),
  ours('toCurrency', 'Валюта зачисления', 'balances'),
  ours('toBalanceAfter', 'Остаток зачисления', 'balances'),
] as const;

export type ExportColumnId = (typeof EXPORT_COLUMNS)[number]['id'];

/** Идентификаторы для схемы запроса: непустой кортеж. */
export const EXPORT_COLUMN_IDS = EXPORT_COLUMNS.map((c) => c.id) as [ExportColumnId, ...ExportColumnId[]];

/** Сколько колонок можно выбрать: все. */
export const EXPORT_COLUMNS_MAX = EXPORT_COLUMNS.length;

export const EXPORT_GROUPS: readonly { id: ExportGroupId; label: string }[] = [
  { id: 'operation', label: 'Операция' },
  { id: 'accounts', label: 'Счета' },
  { id: 'categories', label: 'Категории' },
  { id: 'counterparties', label: 'Контрагенты' },
  { id: 'projects', label: 'Проекты' },
  { id: 'tagsComment', label: 'Теги и комментарий' },
  { id: 'balances', label: 'Остатки и валюты' },
];

/** По умолчанию — все колонки Finmap в порядке шаблона, без «Тип» и без группы «Остатки и валюты». */
export const EXPORT_COLUMNS_DEFAULT: readonly ExportColumnId[] = EXPORT_COLUMNS.filter((c) => !c.ours).map((c) => c.id);

const BY_ID = new Map<string, (typeof EXPORT_COLUMNS)[number]>(EXPORT_COLUMNS.map((c) => [c.id, c]));

export function isExportColumnId(value: unknown): value is ExportColumnId {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Название колонки в файле и в окне («Сумма в валюте счета»). */
export function exportColumnLabel(id: ExportColumnId): string {
  return BY_ID.get(id)!.label;
}
