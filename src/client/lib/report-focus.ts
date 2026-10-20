import type { ReportRow } from '../../shared/report-engine';
import type { ReportChartData } from './charts';
import { categoryLookup } from './journal-format';
import type { CategoryTree } from './queries';
import type { ReportUrlState } from './report-url';

/**
 * Выбор одной категории в «Деньгах», «Прибыли» и «Проектах» (спецификация 2026-10-19, часть 3; план 2026-10-20,
 * решения 9–11): чистые функции — какая категория у строки отчёта, переключение выбора, подпись плашки и график
 * «детальнее».
 */

/**
 * Категория строки отчёта: `income:category:12`, `expense:category:7`, `project:5:category:7`. Служебные строки
 * («Без категории», «Без подкатегории» — `:own`, склад, группы, остатки, «Прочие») — null.
 */
export function rowCategoryId(rowId: string): number | null {
  const m = /(?:^|:)category:([1-9]\d{0,14})$/.exec(rowId);
  return m ? Number(m[1]) : null;
}

/** Выбор категории в компоненте отчёта: выбранная, можно ли выбрать строку (по id строки), нажатие. */
export interface CategoryFocusProps {
  selected: number | null;
  canSelect: (rowId: string) => boolean;
  onSelect: (categoryId: number) => void;
}

/** Нажатие на категорию: выбирает её, повторное — снимает, другая — переключает. */
export function toggleFocus(state: ReportUrlState, categoryId: number): ReportUrlState {
  return { ...state, focusCategoryId: state.focusCategoryId === categoryId ? null : categoryId };
}

/** Подпись плашки: «Зарплата» или «Зарплата → Администраторы»; неизвестная категория — null. */
export function focusLabel(tree: CategoryTree, categoryId: number): string | null {
  return categoryLookup(tree).get(categoryId)?.name ?? null;
}

/** Строка выбранной категории среди строк разреза (верхнего уровня и подкатегорий). */
function findRow(rows: readonly ReportRow[], id: number): ReportRow | undefined {
  for (const r of rows) {
    if (rowCategoryId(r.id) === id) return r;
    const child = r.children?.find((c) => rowCategoryId(c.id) === id);
    if (child) return child;
  }
  return undefined;
}

/**
 * График «детальнее» (решение 11, R9): кольцо и стек группы выбранной категории строятся по её подкатегориям, без
 * подкатегорий — по одной её строке. Не нашлась (другая группа, разрез не по категориям) — тот же объект.
 */
export function focusChart(chart: ReportChartData, focus: number | null): ReportChartData {
  if (focus === null) return chart;
  for (const key of ['incomeRows', 'expenseRows'] as const) {
    const row = findRow(chart[key], focus);
    if (row) return { ...chart, [key]: row.children?.length ? row.children : [row] };
  }
  return chart;
}
