import { bucketOf, type DictCategory, type LineType, type ReportLine } from './report-engine';
import { pnlExcludedCategories, type StockCost } from './report-pnl';
import { marginPercent } from './report-projects';
import { effectiveSystemKey } from './system-categories';

/**
 * «Финансовые показатели» (§8 спецификации «Аналитика»): чистые функции. Показатели считаются из строк «Прибыли» (дата
 * сделки, без переводов и исключённых системных категорий) и строк склада; какие категории входят в часть показателя,
 * задаёт настройка части (или умолчание, пока настройки нет).
 */

export type IndicatorPart = 'revenue' | 'cogs' | 'variable' | 'operating';
export const INDICATOR_PARTS: readonly IndicatorPart[] = ['revenue', 'cogs', 'variable', 'operating'];

export const PART_LABEL: Record<IndicatorPart, string> = {
  revenue: 'Выручка',
  cogs: 'Себестоимость проданных товаров (COGS)',
  variable: 'Переменные расходы',
  operating: 'Операционные расходы',
};

/** Вид категорий части: «Выручка» — доходы, остальные — расходы. */
export const PART_KIND: Record<IndicatorPart, LineType> = { revenue: 'income', cogs: 'expense', variable: 'expense', operating: 'expense' };

/** «Все категории» — отдельный выбор, а не список (§8.2): новая категория попадает в часть сама. */
export const ALL_LABEL: Record<IndicatorPart, string> = {
  revenue: 'Все категории дохода',
  cogs: 'Все категории расхода',
  variable: 'Все категории расхода',
  operating: 'Все категории расхода, кроме налогов и НДС',
};

/** Флажок склада у частей расходов (§8.2): строки склада «Прибыли» — себестоимость продаж и списания (FIFO). */
export const STOCK_PART_LABEL = 'Себестоимость склада (FIFO)';

/** Настройка части показателя (§8.2): «Все категории» — флаг; categoryIds — выбранные категории (с подкатегориями). */
export interface PartConfig {
  allCategories: boolean;
  categoryIds: number[];
  includeStock: boolean;
}

export type IndicatorKey = 'gross' | 'marginal' | 'ebitda' | 'margin';

export interface IndicatorDef {
  key: IndicatorKey;
  label: string;
  /** Формула на карточке под таблицей. */
  formula: string;
  /** Части, которые настраивает окно «Редактировать показатель». */
  parts: readonly IndicatorPart[];
  /** Значение — процент (целое), а не деньги. */
  percent: boolean;
}

export const INDICATORS: readonly IndicatorDef[] = [
  { key: 'gross', label: 'Валовая прибыль', formula: 'Выручка \u2212 Себестоимость проданных товаров (COGS)', parts: ['revenue', 'cogs'], percent: false },
  { key: 'marginal', label: 'Маржинальный доход', formula: 'Выручка \u2212 Переменные расходы', parts: ['revenue', 'variable'], percent: false },
  { key: 'ebitda', label: 'EBITDA', formula: 'Выручка \u2212 Операционные расходы', parts: ['revenue', 'operating'], percent: false },
  { key: 'margin', label: 'Процент маржи', formula: '(Прибыль ÷ Выручка) × 100', parts: ['revenue'], percent: true },
];

export const INDICATOR_KEYS: readonly IndicatorKey[] = INDICATORS.map((i) => i.key);

export const isIndicatorKey = (v: string): v is IndicatorKey => (INDICATOR_KEYS as readonly string[]).includes(v);
export const isIndicatorPart = (v: string): v is IndicatorPart => (INDICATOR_PARTS as readonly string[]).includes(v);
export const indicatorDef = (key: IndicatorKey): IndicatorDef => INDICATORS.find((i) => i.key === key)!;

/** Расход части «Себестоимость» показателя: какая часть вычитается из «Выручки». «Процент маржи» — без неё. */
export const INDICATOR_EXPENSE: Record<IndicatorKey, IndicatorPart | null> = { gross: 'cogs', marginal: 'variable', ebitda: 'operating', margin: null };

/** Категории компании с ссылкой шаблона (`computer-club:bar-purchase`) — по порядку справочника. */
export function templateCategoryIds(categories: readonly { id: number; templateRef: string | null }[], refs: readonly string[]): number[] {
  return categories.filter((c) => c.templateRef !== null && refs.includes(c.templateRef)).map((c) => c.id);
}

/**
 * Умолчание части (§8.2), пока настройка не сохранена: «Выручка» — все доходные категории; «Себестоимость» — склад и
 * категории шаблона; «Переменные расходы» — склад и категории шаблона; «Операционные расходы» — все расходные (без
 * налогов и НДС) и склад. template — категории компании из `indicatorDefaults` шаблонов (у «Общего» их нет).
 */
export function defaultPart(part: IndicatorPart, template: { cogs: readonly number[]; variable: readonly number[] }): PartConfig {
  switch (part) {
    case 'revenue':
      return { allCategories: true, categoryIds: [], includeStock: false };
    case 'cogs':
      return { allCategories: false, categoryIds: [...template.cogs], includeStock: true };
    case 'variable':
      return { allCategories: false, categoryIds: [...template.variable], includeStock: true };
    case 'operating':
      return { allCategories: true, categoryIds: [], includeStock: true };
  }
}

/**
 * Категории части (§8.2) среди строк «Прибыли»: исключённые системные (§5.1) не входят никогда; «Все категории» — все
 * категории вида и строки без категории, у «Операционных расходов» — без налогов и НДС (EBITDA — до налогов); список —
 * выбранные категории с подкатегориями, без строк без категории.
 */
export function partCategories(part: IndicatorPart, cfg: PartConfig, categories: readonly DictCategory[]): { ids: Set<number>; uncategorized: boolean } {
  const kind = PART_KIND[part];
  const excluded = pnlExcludedCategories(categories);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const taxes = (c: DictCategory) => {
    const parent = c.parentId === null ? undefined : byId.get(c.parentId);
    const key = effectiveSystemKey(c.systemKey ?? null, parent?.systemKey ?? null);
    return key === 'tax' || key === 'vat';
  };
  const own = categories.filter((c) => c.kind === kind && !excluded.has(c.id));
  if (cfg.allCategories) return { ids: new Set(own.filter((c) => part !== 'operating' || !taxes(c)).map((c) => c.id)), uncategorized: true };
  const chosen = new Set(cfg.categoryIds);
  return { ids: new Set(own.filter((c) => chosen.has(c.id) || (c.parentId !== null && chosen.has(c.parentId))).map((c) => c.id)), uncategorized: false };
}

/** Строка «Прибыли» для показателей: cut — часть, оплатившая закупку склада (§5.3); вычитается, если у части включён склад. */
export interface IndicatorLine extends ReportLine {
  cut: number;
}

/** Строка таблицы показателей: деньги по колонкам и «Итого»; у «Процента маржи» — целые проценты, null — «—» (Выручка = 0). */
export interface IndicatorRow {
  id: IndicatorKey;
  label: string;
  values: (number | null)[];
  total: number | null;
}

export interface IndicatorsResult {
  rows: IndicatorRow[];
  /** Ни строк «Прибыли», ни себестоимости склада в периоде. */
  empty: boolean;
}

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

/**
 * Показатели по колонкам (§8.1): Валовая прибыль = Выручка - Себестоимость, Маржинальный доход = Выручка - Переменные,
 * EBITDA = Выручка - Операционные, Процент маржи = Прибыль ÷ Выручка × 100 (целое, «—» при нулевой Выручке). Прибыль —
 * итог «Прибыли» со складом, когда у компании есть склад (stock не null), иначе без склада. stock — строки склада периода
 * (себестоимость продаж и списания) или null, если у компании нет склада: тогда флажок склада части ничего не меняет.
 */
export function indicatorRows(input: {
  starts: readonly string[];
  lines: readonly IndicatorLine[];
  categories: readonly DictCategory[];
  parts: Record<IndicatorPart, PartConfig>;
  stock: readonly StockCost[] | null;
}): IndicatorsResult {
  const n = Math.max(0, input.starts.length - 1);
  const excluded = pnlExcludedCategories(input.categories);
  const lines = input.lines.filter((l) => bucketOf(input.starts, l.at) >= 0 && (l.categoryId === null || !excluded.has(l.categoryId)));
  const costs = (input.stock ?? []).filter((c) => bucketOf(input.starts, c.at) >= 0);
  const zero = () => new Array<number>(n).fill(0);

  const part = (p: IndicatorPart): number[] => {
    const cfg = input.parts[p];
    const set = partCategories(p, cfg, input.categories);
    const stock = cfg.includeStock && PART_KIND[p] === 'expense' && input.stock !== null;
    const v = zero();
    for (const l of lines) {
      if (l.type !== PART_KIND[p]) continue;
      if (l.categoryId === null ? !set.uncategorized : !set.ids.has(l.categoryId)) continue;
      v[bucketOf(input.starts, l.at)]! += l.amount - (stock ? l.cut : 0);
    }
    if (stock) for (const c of costs) v[bucketOf(input.starts, c.at)]! += c.amount;
    return v;
  };

  // «Прибыль» (§5.2): доходы - расходы - склад; со складом — без оплат закупок
  const profit = zero();
  const withStock = input.stock !== null;
  for (const l of lines) profit[bucketOf(input.starts, l.at)]! += l.type === 'income' ? l.amount : -(l.amount - (withStock ? l.cut : 0));
  for (const c of costs) profit[bucketOf(input.starts, c.at)]! -= c.amount;

  const revenue = part('revenue');
  const rows: IndicatorRow[] = INDICATORS.map((def) => {
    const expensePart = INDICATOR_EXPENSE[def.key];
    if (expensePart === null) {
      return { id: def.key, label: def.label, values: revenue.map((r, i) => marginPercent(profit[i]!, r)), total: marginPercent(sum(profit), sum(revenue)) };
    }
    const expense = part(expensePart);
    const values = revenue.map((r, i) => r - expense[i]!);
    return { id: def.key, label: def.label, values, total: sum(values) };
  });
  return { rows, empty: lines.length === 0 && costs.length === 0 };
}

/**
 * Текст настройки части (история, Excel, окно): «Все категории дохода», названия выбранных категорий или «Категорий нет»;
 * у частей расходов со складом — «, себестоимость склада (FIFO)».
 */
export function partText(part: IndicatorPart, cfg: { allCategories: boolean; includeStock: boolean }, names: readonly string[]): string {
  const categories = cfg.allCategories ? ALL_LABEL[part] : names.length > 0 ? names.join(', ') : 'Категорий нет';
  return PART_KIND[part] === 'expense' && cfg.includeStock ? `${categories}, себестоимость склада (FIFO)` : categories;
}

/** Значение ячейки на экране: деньги — moneyText вызывающего, процент — «14%» или «—». */
export function indicatorPercentText(value: number | null): string {
  return value === null ? '—' : `${value < 0 ? '\u2212' : ''}${Math.abs(value)}%`;
}
