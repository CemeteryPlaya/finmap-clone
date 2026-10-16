import { shareBp, type ReportDicts, type ReportFilter, type ReportLine } from './report-engine';
import { pnlExcludedCategories, STOCK_ROW_LABEL, stockKept, type StockCostKind, type StockInput } from './report-pnl';

/**
 * «Проекты» (§7 спецификации «Аналитика»): доходы, расходы, прибыль и рентабельность каждого проекта за период — по
 * правилам «Прибыли» (§5): дата сделки, без переводов и исключённых системных категорий, склад по себестоимости.
 * Чистые функции: строки операций (с датой сделки, оплаты закупок уже вычтены) и склад приходят от сервера.
 */

export type ProjectStatus = 'active' | 'archived' | 'all';
export type ProjectsMode = 'projects' | 'categories';
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'archived', 'all'];
export const PROJECTS_MODES: readonly ProjectsMode[] = ['projects', 'categories'];
export const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Активные проекты', archived: 'Архивные проекты', all: 'Все проекты' };
export const MODE_LABEL: Record<ProjectsMode, string> = { projects: 'Только проекты', categories: 'Проекты с категориями' };

/**
 * Строка «Проектов»: project — проект, none — «Без проекта», others — проекты, скрытые статусом, вместе; category и
 * stock — категория и склад внутри проекта («Проекты с категориями»); total — «Всего».
 */
export type ProjectRowKind = 'project' | 'none' | 'others' | 'category' | 'stock' | 'total';

export interface ProjectRow {
  id: string;
  kind: ProjectRowKind;
  label: string;
  income: number;
  expense: number;
  /** Архивный проект или категория. */
  archived?: true;
  /** «Проекты с категориями»: категории доходов, расходов, «Без категории» и строки склада. */
  children?: ProjectRow[];
}

export interface ProjectsResult {
  /** Проекты выбранного статуса, проекты другого статуса вместе (если есть суммы) и «Без проекта» — в сумме дают total. */
  rows: ProjectRow[];
  total: ProjectRow;
  /** Ни строк операций, ни себестоимости склада в периоде. */
  empty: boolean;
  /** Продаж «Нет партии» (с учётом фильтра) — предупреждение, как у «Прибыли». */
  noBatch: number;
}

/** Проекты другого статуса с суммами в периоде — одной строкой: так строки всегда дают «Всего», равное итогу «Прибыли». */
export const OTHERS_LABEL: Record<'active' | 'archived', string> = { active: 'Активные проекты (вместе)', archived: 'Архивные проекты (вместе)' };

interface Sums {
  income: number;
  expense: number;
}

interface Acc extends Sums {
  categories: Map<string, Sums>;
  stock: Map<StockCostKind, number>;
}

/**
 * Строки «Проектов» (§7). Статус выбирает проекты-строки: «Активные проекты» — неархивные, «Архивные» — архивные, «Все» —
 * все. Проекты другого статуса с суммами собираются в строку «… (вместе)». «Без проекта» есть всегда. При непустом
 * периоде проекты выбранного статуса показываются и нулями; пустой период — только «Без проекта» и «Всего» (§3.3).
 * Склад (§5.3) — расходом проекта склада; в «Проектах с категориями» — строками «Себестоимость…» и «Списания…».
 * Категории — верхнего уровня (подкатегории входят в родителя): сначала доходов, затем расходов, по порядку справочника.
 */
export function projectsRows(input: {
  lines: readonly ReportLine[];
  dicts: ReportDicts;
  filter: ReportFilter;
  status: ProjectStatus;
  mode: ProjectsMode;
  stock: StockInput | null;
}): ProjectsResult {
  const excluded = pnlExcludedCategories(input.dicts.categories);
  const lines = input.lines.filter((l) => l.categoryId === null || !excluded.has(l.categoryId));
  const costs = (input.stock?.costs ?? []).filter((c) => stockKept(input.filter, c.projectId));
  const empty = lines.length === 0 && costs.length === 0;
  const projectById = new Map(input.dicts.projects.map((p) => [p.id, p]));
  const categoryById = new Map(input.dicts.categories.map((c) => [c.id, c]));
  const shown = (archived: boolean) => input.status === 'all' || (input.status === 'archived') === archived;
  const othersKey = input.status === 'active' ? 'archived' : 'active';
  // ключ строки: id проекта, «none» или проекты другого статуса вместе; проект не из справочника — своей строкой
  const keyOf = (projectId: number | null): string => {
    if (projectId === null) return 'none';
    const p = projectById.get(projectId);
    return !p || shown(p.archived) ? String(projectId) : othersKey;
  };
  const topOf = (categoryId: number | null): string => (categoryId === null ? 'none' : String(categoryById.get(categoryId)?.parentId ?? categoryId));
  const accs = new Map<string, Acc>();
  const accOf = (key: string): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { income: 0, expense: 0, categories: new Map(), stock: new Map() };
      accs.set(key, a);
    }
    return a;
  };
  for (const l of lines) {
    const a = accOf(keyOf(l.projectId));
    a[l.type] += l.amount;
    const key = topOf(l.categoryId);
    const c = a.categories.get(key) ?? { income: 0, expense: 0 };
    c[l.type] += l.amount;
    a.categories.set(key, c);
  }
  for (const c of costs) {
    const a = accOf(keyOf(c.projectId));
    a.expense += c.amount;
    a.stock.set(c.kind, (a.stock.get(c.kind) ?? 0) + c.amount);
  }

  const children = (prefix: string, a: Acc): ProjectRow[] => {
    const out: ProjectRow[] = [];
    const covered = new Set<string>(['none']);
    for (const kind of ['income', 'expense'] as const) {
      for (const c of input.dicts.categories) {
        if (c.kind !== kind || c.parentId !== null) continue;
        covered.add(String(c.id));
        const sums = a.categories.get(String(c.id));
        if (sums) out.push({ id: `${prefix}:category:${c.id}`, kind: 'category', label: c.name, ...sums, ...(c.archived ? { archived: true as const } : {}) });
      }
    }
    // категории не из справочника не теряются: строки дают итог проекта
    for (const [key, sums] of a.categories) if (!covered.has(key)) out.push({ id: `${prefix}:category:${key}`, kind: 'category', label: '…', ...sums });
    const none = a.categories.get('none');
    if (none) out.push({ id: `${prefix}:category:none`, kind: 'category', label: 'Без категории', ...none });
    for (const kind of ['cogs', 'writeoff'] as const) {
      const amount = a.stock.get(kind);
      if (amount !== undefined) out.push({ id: `${prefix}:stock:${kind}`, kind: 'stock', label: STOCK_ROW_LABEL.category[kind], income: 0, expense: amount });
    }
    return out;
  };
  const row = (key: string, kind: ProjectRowKind, label: string, archived: boolean): ProjectRow => {
    const a = accs.get(key);
    const id = `project:${key}`;
    return {
      id,
      kind,
      label,
      income: a?.income ?? 0,
      expense: a?.expense ?? 0,
      ...(archived ? { archived: true as const } : {}),
      ...(input.mode === 'categories' && a ? { children: children(id, a) } : {}),
    };
  };

  const rows: ProjectRow[] = [];
  for (const p of input.dicts.projects) {
    if (shown(p.archived) && (!empty || accs.has(String(p.id)))) rows.push(row(String(p.id), 'project', p.name, p.archived));
  }
  for (const key of accs.keys()) if (/^\d+$/.test(key) && !projectById.has(Number(key))) rows.push(row(key, 'project', '…', false));
  if (input.status !== 'all' && accs.has(othersKey)) rows.push(row(othersKey, 'others', OTHERS_LABEL[othersKey], false));
  rows.push(row('none', 'none', 'Без проекта', false));
  const total: ProjectRow = {
    id: 'total',
    kind: 'total',
    label: 'Всего',
    income: rows.reduce((s, r) => s + r.income, 0),
    expense: rows.reduce((s, r) => s + r.expense, 0),
  };
  const noBatch = input.stock ? input.stock.noBatch.filter((s) => stockKept(input.filter, s.projectId)).length : 0;
  return { rows, total, empty, noBatch };
}

/** Строки таблицы и Excel сверху вниз: проект, под ним его категории («Проекты с категориями»), в конце «Всего». */
export function projectLines(rows: readonly ProjectRow[], total: ProjectRow): { row: ProjectRow; parent: ProjectRow | null }[] {
  return [...rows.flatMap((row) => [{ row, parent: null }, ...(row.children ?? []).map((child) => ({ row: child, parent: row }))]), { row: total, parent: null }];
}

/** «Доход / Расход, %» (§7): Д ÷ Р × 100 в сотых долях процента (11628 — 116,28); Р = 0 — null («—»). */
export function incomeExpenseBp(income: number, expense: number): number | null {
  return shareBp(income, expense);
}

/** «Рентабельность, %» (§7): П ÷ Д × 100, целое; Д = 0 — null («—»). Модуль округляется отдельно, знак — потом. */
export function marginPercent(profit: number, income: number): number | null {
  if (income === 0) return null;
  const abs = Math.round((Math.abs(profit) * 100) / Math.abs(income));
  return abs !== 0 && (profit < 0) !== (income < 0) ? -abs : abs;
}

const minus = (negative: boolean) => (negative ? '\u2212' : '');

/** «116,28», «\u221228,57»; нет значения — «—». */
export function ratioText(bp: number | null): string {
  if (bp === null) return '—';
  const abs = Math.abs(bp);
  return `${minus(bp < 0)}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** «14», «\u2212200»; нет значения — «—». */
export function marginText(value: number | null): string {
  return value === null ? '—' : `${minus(value < 0)}${Math.abs(value)}`;
}

/** Колонка ячейки «Проектов» (§7): доходы, расходы или все операции строки (прибыль и проценты). */
export type ProjectsCol = 'income' | 'expense' | 'total';
export const PROJECTS_COLS: readonly ProjectsCol[] = ['income', 'expense', 'total'];

/** Что входит в строку «Проектов»: проект (null — без проекта; active/archived — проекты статуса; any — все) и категория. */
export interface ProjectsDrill {
  project: number | null | 'active' | 'archived' | 'any';
  /** Категория верхнего уровня с подкатегориями; null — без категории; нет поля — все. */
  category?: number | null;
}

/** id строки «Проектов» → что в неё входит; строки склада не раскрываются (null). */
export function parseProjectsRow(id: string): ProjectsDrill | null {
  if (id === 'total') return { project: 'any' };
  const m = /^project:(none|active|archived|[1-9]\d{0,14})(?::category:(none|[1-9]\d{0,14}))?$/.exec(id);
  if (!m) return null;
  const project = m[1] === 'none' ? null : m[1] === 'active' || m[1] === 'archived' ? m[1] : Number(m[1]);
  return m[2] === undefined ? { project } : { project, category: m[2] === 'none' ? null : Number(m[2]) };
}

const COL_WORD: Record<ProjectsCol, string> = { total: 'Операции', income: 'Доходы', expense: 'Расходы' };

/** Название строки: архивная — с пометкой «(архив)». */
export const projectRowLabel = (row: ProjectRow) => (row.archived ? `${row.label} (архив)` : row.label);

/** Заголовок списка под таблицей (§2.5): «Доходы: Клуб 1», «Операции: Без проекта», «Расходы: Клуб 1 → Аренда». */
export function projectsCellTitle(row: ProjectRow, parent: ProjectRow | null, col: ProjectsCol): string {
  return `${COL_WORD[col]}: ${parent ? `${projectRowLabel(parent)} → ${projectRowLabel(row)}` : projectRowLabel(row)}`;
}
