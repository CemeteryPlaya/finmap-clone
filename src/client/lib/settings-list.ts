import { matchesQuery } from '../../shared/search';

/** Строка списка зоны настроек (§7.1 этапа 1.5). */
export interface SettingsRow {
  id: number;
  name: string;
  /** Серый текст в строке: тип и комментарий контрагента, клуб и баланс счёта. */
  secondary?: string;
  /** Доступное имя ✎ вместо «Изменить {name}» (одноимённые пользователи: «Изменить {имя} ({логин})»). */
  editLabel?: string;
  /** Пометка вместо «в архиве» («отключён»). */
  note?: string;
  /** Что ещё ищет «Поиск», кроме названия (комментарий контрагента). */
  searchText?: string;
  /** В архиве: в конце своего уровня, приглушена, не перетаскивается. */
  archived: boolean;
  /** Родитель подкатегории (§7.2): строка — с отступом сразу под ним. Нет — верхний уровень. */
  parentId?: number | null;
  /** Клуб счёта: строка двигается только среди строк того же клуба (общие счета — свой клуб). Нет — один общий круг. */
  group?: string;
}

const parentOf = (r: SettingsRow): number | null => r.parentId ?? null;

const matches = (r: SettingsRow, query: string) => matchesQuery(r.searchText ? `${r.name} ${r.searchText}` : r.name, query);

const activeFirst = <T extends SettingsRow>(rows: readonly T[]): T[] => [...rows.filter((r) => !r.archived), ...rows.filter((r) => r.archived)];

/**
 * Строки в порядке показа: верхний уровень, под каждой строкой — её дочерние; архивные — в конце своего уровня.
 * С запросом — найденные (без учёта регистра и «ё») и родители найденных подкатегорий (§7.2).
 */
export function visibleRows<T extends SettingsRow>(rows: readonly T[], query: string): T[] {
  const present = new Set(rows.map((r) => r.id));
  const isTop = (r: T) => {
    const p = parentOf(r);
    return p === null || !present.has(p);
  };
  const q = query.trim();
  const out: T[] = [];
  for (const top of activeFirst(rows.filter(isTop))) {
    const children = activeFirst(rows.filter((r) => !isTop(r) && parentOf(r) === top.id)).filter((c) => q === '' || matches(c, q));
    if (q !== '' && !matches(top, q) && children.length === 0) continue;
    out.push(top, ...children);
  }
  return out;
}

/** Кого можно переставлять вместе со строкой id: соседи её уровня и её group без архивных, в порядке показа. Архивная — []. */
export function moveGroup(shown: readonly SettingsRow[], id: number): number[] {
  const present = new Set(shown.map((r) => r.id));
  const level = (r: SettingsRow) => {
    const p = parentOf(r);
    return p !== null && present.has(p) ? p : null;
  };
  const target = shown.find((r) => r.id === id);
  if (!target || target.archived) return [];
  const lv = level(target);
  return shown.filter((r) => !r.archived && level(r) === lv && r.group === target.group).map((r) => r.id);
}

/** Alt+↑ / Alt+↓: новый порядок группы; на краю и не из группы — null. */
export function shiftInGroup(group: readonly number[], id: number, delta: -1 | 1): number[] | null {
  const i = group.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return null;
  const next = [...group];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Куда встанет перетаскиваемая строка: midpoints — середины остальных строк группы сверху вниз. */
export function dropIndexAt(midpoints: readonly number[], y: number): number {
  return midpoints.filter((m) => m < y).length;
}

/** Строку id отпустили на место index среди остальных строк группы: новый порядок; то же место — null. */
export function dropInGroup(group: readonly number[], id: number, index: number): number[] | null {
  if (!group.includes(id)) return null;
  const others = group.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const next = [...others.slice(0, at), id, ...others.slice(at)];
  return next.every((x, i) => x === group[i]) ? null : next;
}

/** Объявление после перестановки: «Касса» — место 2 из 3. */
export function movedText(name: string, group: readonly number[], id: number): string {
  return `«${name}» — место ${group.indexOf(id) + 1} из ${group.length}`;
}
