import { evaluateAmount } from '../../shared/calc';
import { allocate } from '../../shared/money';
import { formatBp, parsePercentToBp } from '../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../shared/schemas/split-presets';
import { pluralRu } from './journal-format';
import type { CategoryTree } from './queries';

/**
 * «Разделить» (§7): строки «статья, проект, сумма или %». Суммы строк — текст поля (выражение калькулятора),
 * доли — проценты с двумя знаками; проценты переводятся в суммы методом наибольшего остатка (§4.1, `allocate`).
 */
export type SplitMode = 'amount' | 'percent';

export interface SplitLineDraft {
  /** Ключ строки для React: строки добавляются и удаляются. */
  key: number;
  categoryId: number | null;
  projectId: number | null;
  /** Сумма (в режиме «суммами») или доля в процентах (в режиме «в процентах»). */
  value: string;
}

export interface SplitDraft {
  mode: SplitMode;
  lines: SplitLineDraft[];
}

/** Не больше строк у операции (`operationCreateSchema`). */
export const SPLIT_MAX_LINES = 50;

let lastKey = 0;
export function newLine(patch: Partial<Omit<SplitLineDraft, 'key'>> = {}): SplitLineDraft {
  lastKey += 1;
  return { key: lastKey, categoryId: null, projectId: null, value: '', ...patch };
}

/** Начать разбиение: первая строка — текущие статья, проект и вся сумма, вторая — пустая. */
export function startSplit(categoryId: number | null, projectId: number | null, amountText: string): SplitDraft {
  return { mode: 'amount', lines: [newLine({ categoryId, projectId, value: amountText }), newLine()] };
}

export interface SplitResult {
  /** Суммы строк в минимальных единицах; null — значение строки не разобрать. */
  amounts: (number | null)[];
  /** Ошибки строк (по порядку); null — строка в порядке или пустая. */
  errors: (string | null)[];
  /**
   * Нераспределённый остаток: в режиме «суммами» — минимальные единицы (отрицательный — распределено больше),
   * «в процентах» — сотые доли процента. null — общая сумма ещё не введена (в режиме «суммами»).
   */
  left: number | null;
  /** Все строки заполнены верно и остаток равен 0 — разбиение можно сохранить. */
  ok: boolean;
}

/** Строки разбиения при общей сумме total (null — сумма не введена или с ошибкой). */
export function splitResult(split: SplitDraft, total: number | null, minorUnits: number): SplitResult {
  if (split.mode === 'amount') {
    const parsed = split.lines.map((l) => (l.value.trim() === '' ? null : evaluateAmount(l.value, minorUnits)));
    const errors = parsed.map((r) => (r === null ? 'Введите сумму' : !r.ok ? r.error : r.minor <= 0 ? 'Сумма больше нуля' : null));
    const amounts = parsed.map((r, i) => (r?.ok && errors[i] === null ? r.minor : null));
    const sum = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
    const left = total === null ? null : total - sum;
    return { amounts, errors, left, ok: left === 0 && errors.every((e) => e === null) };
  }
  const bps = split.lines.map((l) => parsePercentToBp(l.value));
  const errors: (string | null)[] = bps.map((bp) => (bp === null ? 'Введите долю, например 25 или 12,5' : bp <= 0 ? 'Доля больше 0' : null));
  const left = SPLIT_TOTAL_BP - bps.reduce<number>((s, bp) => s + (bp ?? 0), 0);
  let amounts: (number | null)[] = split.lines.map(() => null);
  if (left === 0 && !errors.some((e) => e !== null) && total !== null && total > 0) {
    amounts = allocate(total, bps as number[]);
    amounts.forEach((a, i) => {
      if (a === 0) errors[i] = 'Слишком маленькая доля для этой суммы';
    });
  }
  return { amounts, errors, left, ok: left === 0 && total !== null && errors.every((e) => e === null) };
}

/** Строки тела запроса из разбиения, которое можно сохранить (`splitResult(...).ok`). */
export function splitLines(split: SplitDraft, result: SplitResult): { categoryId: number | null; projectId: number | null; amount: number }[] {
  return split.lines.map((l, i) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: result.amounts[i]! }));
}

/** «Сохранить и создать похожий»: суммы строк очищаются, доли в процентах остаются. */
export function similarSplit(split: SplitDraft): SplitDraft {
  return split.mode === 'percent' ? split : { ...split, lines: split.lines.map((l) => ({ ...l, value: '' })) };
}

export interface PresetLine {
  categoryId: number | null;
  projectId: number | null;
  bp: number;
}

/** Доступность элементов для шаблона: статья — вид и архив (дочерняя архивного родителя тоже в архиве), проект — архив. */
export interface PresetContext {
  categories: ReadonlyMap<number, { kind: 'income' | 'expense'; archived: boolean }>;
  projects: ReadonlyMap<number, { archived: boolean }>;
  kind: 'income' | 'expense';
}

export function presetContext(tree: CategoryTree, projects: readonly { id: number; archivedAt: string | null }[], kind: 'income' | 'expense'): PresetContext {
  const categories = new Map<number, { kind: 'income' | 'expense'; archived: boolean }>();
  for (const n of [...tree.income, ...tree.expense]) {
    categories.set(n.id, { kind: n.kind, archived: n.archivedAt !== null });
    for (const c of n.children) categories.set(c.id, { kind: c.kind, archived: c.archivedAt !== null || n.archivedAt !== null });
  }
  return { categories, projects: new Map(projects.map((p) => [p.id, { archived: p.archivedAt !== null }])), kind };
}

/**
 * Применение шаблона разделения (инвариант 10): удалённые, архивные статьи и проекты, а также статьи другого вида
 * отбрасываются (`dropped` — сколько); строка без статьи и проекта не применяется, её доля остаётся
 * нераспределённой. Не осталось строк — шаблон не применяется (`split: null`).
 */
export function applyPreset(lines: readonly PresetLine[], ctx: PresetContext): { split: SplitDraft | null; dropped: number } {
  let dropped = 0;
  const kept: SplitLineDraft[] = [];
  for (const l of lines) {
    const cat = l.categoryId === null ? undefined : ctx.categories.get(l.categoryId);
    const categoryOk = l.categoryId !== null && !!cat && !cat.archived && cat.kind === ctx.kind;
    const proj = l.projectId === null ? undefined : ctx.projects.get(l.projectId);
    const projectOk = l.projectId !== null && !!proj && !proj.archived;
    if (l.categoryId !== null && !categoryOk) dropped++;
    if (l.projectId !== null && !projectOk) dropped++;
    if (!categoryOk && !projectOk) continue;
    kept.push(newLine({ categoryId: categoryOk ? l.categoryId : null, projectId: projectOk ? l.projectId : null, value: formatBp(l.bp) }));
  }
  return { split: kept.length > 0 ? { mode: 'percent', lines: kept } : null, dropped };
}

/** «1 элемент недоступен», «2 элемента недоступны», «5 элементов недоступно». */
export function droppedText(n: number): string {
  return `${n} ${pluralRu(n, 'элемент недоступен', 'элемента недоступны', 'элементов недоступно')}`;
}

/**
 * «Сохранить как шаблон»: доли строк в сотых долях процента. Разбиение в суммах переводится в доли методом
 * наибольшего остатка; сумма долей — ровно 100 %.
 */
export function presetFromSplit(split: SplitDraft, result: SplitResult): { ok: true; lines: PresetLine[] } | { ok: false; error: string } {
  if (split.lines.some((l) => l.categoryId === null && l.projectId === null)) return { ok: false, error: 'В каждой строке укажите статью или проект' };
  let bps: number[];
  if (split.mode === 'percent') {
    if (result.left !== 0 || result.errors.some((e) => e !== null && e !== 'Слишком маленькая доля для этой суммы')) {
      return { ok: false, error: 'Распределите 100 %' };
    }
    bps = split.lines.map((l) => parsePercentToBp(l.value)!);
  } else {
    if (result.amounts.some((a) => a === null)) return { ok: false, error: 'Заполните суммы строк' };
    bps = allocate(SPLIT_TOTAL_BP, result.amounts as number[]);
    if (bps.some((bp) => bp === 0)) return { ok: false, error: 'Строка меньше 0,01 % — для шаблона слишком мала' };
  }
  return { ok: true, lines: split.lines.map((l, i) => ({ categoryId: l.categoryId, projectId: l.projectId, bp: bps[i]! })) };
}
