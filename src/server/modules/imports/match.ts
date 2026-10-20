import { asc, eq } from 'drizzle-orm';
import { COUNTERPARTY_TYPES } from '../../../shared/counterparties';
import { nameKey, repairName, systemKeyOf } from '../../../shared/finmap-format';
import { systemCategory, type CategoryKind, type CounterpartyType, type SystemKey } from '../../../shared/system-categories';
import type { Executor } from '../../db/client';
import { categories, counterparties, projects, tags } from '../../db/schema';
import { MESSAGES as M, type RowIssue } from './errors';
import type { ImportRow } from './parse-row';

/**
 * Сопоставление справочников (§4.5–§4.8 спецификации импорта): чистая функция над загруженными справочниками
 * компании. Совпадение — по nameKey; новый элемент получает название repairName первого появления в файле.
 */

/** Ссылка на элемент: существующий id или новый по ключу (создаётся при записи, план И-2). */
export type Ref = { id: number } | { key: string };

export interface CategoryEntry {
  id: number;
  kind: CategoryKind;
  parentId: number | null;
  name: string;
  systemKey: string | null;
  archivedAt: string | null;
}
export interface CounterpartyEntry {
  id: number;
  type: CounterpartyType;
  name: string;
  archivedAt: string | null;
}
export interface NamedEntry {
  id: number;
  name: string;
  archivedAt: string | null;
}

/** Справочники компании в порядке orderIndex, id (первый по порядку выигрывает при нескольких совпадениях). */
export interface Dictionaries {
  categories: CategoryEntry[];
  counterparties: CounterpartyEntry[];
  projects: NamedEntry[];
  tags: NamedEntry[];
}

export async function loadDictionaries(ex: Executor, companyId: number): Promise<Dictionaries> {
  return {
    categories: await ex
      .select({ id: categories.id, kind: categories.kind, parentId: categories.parentId, name: categories.name, systemKey: categories.systemKey, archivedAt: categories.archivedAt })
      .from(categories)
      .where(eq(categories.companyId, companyId))
      .orderBy(asc(categories.orderIndex), asc(categories.id)),
    counterparties: await ex
      .select({ id: counterparties.id, type: counterparties.type, name: counterparties.name, archivedAt: counterparties.archivedAt })
      .from(counterparties)
      .where(eq(counterparties.companyId, companyId))
      .orderBy(asc(counterparties.orderIndex), asc(counterparties.id)),
    projects: await ex
      .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.companyId, companyId))
      .orderBy(asc(projects.orderIndex), asc(projects.id)),
    tags: await ex
      .select({ id: tags.id, name: tags.name, archivedAt: tags.archivedAt })
      .from(tags)
      .where(eq(tags.companyId, companyId))
      .orderBy(asc(tags.orderIndex), asc(tags.id)),
  };
}

/** Новая категория: верхнего уровня (parent null) или подкатегория существующей ({ id }) либо новой ({ key }) категории. */
export interface PlannedCategory {
  key: string;
  kind: CategoryKind;
  name: string;
  parent: Ref | null;
  /** Название родителя — для списка «Будет создано». */
  parentName: string | null;
  rows: number;
}
export interface PlannedCounterparty {
  key: string;
  name: string;
  type: CounterpartyType;
  rows: number;
}
export interface PlannedNamed {
  key: string;
  name: string;
  rows: number;
}

/** Справочники строки после сопоставления. categorySystemKey — эффективный systemKey (у дочерней — родителя). */
export interface MatchedRow {
  category: Ref | null;
  categorySystemKey: SystemKey | null;
  counterparty: Ref | null;
  project: Ref | null;
  tags: Ref[];
}

export interface MatchResult {
  /** По номеру строки файла; строк с R17 нет. */
  rows: Map<number, MatchedRow>;
  /** R17 — один текст на название, со строками. */
  issues: RowIssue[];
  /** Новые категории: сначала верхнего уровня, затем подкатегории — по первому появлению. */
  categories: PlannedCategory[];
  counterparties: PlannedCounterparty[];
  projects: PlannedNamed[];
  tags: PlannedNamed[];
}

/** Тип контрагента, нужный строке (§4.6): по системной категории, иначе доход — клиент, расход — поставщик. */
export function neededCounterpartyType(kind: CategoryKind, systemKey: SystemKey | null): CounterpartyType {
  if (systemKey) return systemCategory(systemKey).counterpartyType;
  return kind === 'income' ? 'client' : 'supplier';
}

/** Тип нового контрагента: самый частый; при равенстве системный важнее client/supplier, дальше — порядок COUNTERPARTY_TYPES. */
export function pickCounterpartyType(votes: Map<CounterpartyType, number>): CounterpartyType {
  const rank = (t: CounterpartyType) => (t === 'client' || t === 'supplier' ? 100 : 0) + COUNTERPARTY_TYPES.indexOf(t);
  return [...votes].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]![0];
}

const refKey = (r: Ref) => ('id' in r ? `id:${r.id}` : `new:${r.key}`);

/** Элементы по ключу названия, в исходном порядке (orderIndex, id). */
function byNameKey<T extends { name: string }>(list: T[], prefix: (x: T) => string = () => ''): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = prefix(x) + nameKey(x.name);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function matchDictionaries(d: Dictionaries, rows: ImportRow[]): MatchResult {
  const issues: RowIssue[] = [];
  const out = new Map<number, MatchedRow>();

  // категории: верхний уровень по (вид, ключ), дети по родителю, системные по (вид, systemKey)
  const catById = new Map(d.categories.map((c) => [c.id, c]));
  const topActive = new Map<string, CategoryEntry>();
  const systemTop = new Map<string, CategoryEntry>();
  const childActiveByKey = new Map<string, CategoryEntry[]>();
  /** Ключи архивных категорий: любого уровня и только верхнего. */
  const archivedAny = new Set<string>();
  const archivedTop = new Set<string>();
  for (const c of d.categories) {
    const k = `${c.kind}|${nameKey(c.name)}`;
    if (c.archivedAt) archivedAny.add(k);
    if (c.parentId === null) {
      if (c.archivedAt) archivedTop.add(k);
      if (c.systemKey) systemTop.set(`${c.kind}|${c.systemKey}`, c);
      if (!c.archivedAt && !topActive.has(k)) topActive.set(k, c);
    } else if (!c.archivedAt) childActiveByKey.set(k, [...(childActiveByKey.get(k) ?? []), c]);
  }
  /** Дети по (родитель, ключ). */
  const childrenByKey = byNameKey(
    d.categories.filter((c) => c.parentId !== null),
    (c) => `${c.parentId}|`,
  );
  const cpsByKey = byNameKey(d.counterparties);
  const projectsByKey = byNameKey(d.projects);
  const tagsByKey = byNameKey(d.tags);
  const effectiveSystem = (c: CategoryEntry): SystemKey | null =>
    (c.systemKey ?? (c.parentId !== null ? catById.get(c.parentId)?.systemKey : null) ?? null) as SystemKey | null;

  const newCats = new Map<string, PlannedCategory>();
  const newCps = new Map<string, PlannedCounterparty & { votes: Map<CounterpartyType, number> }>();
  const newProjects = new Map<string, PlannedNamed>();
  const newTags = new Map<string, PlannedNamed>();

  /** Категория верхнего уровня: системная по названию и виду, иначе активная по ключу; 'archived' — есть только архивная. */
  function findTop(kind: CategoryKind, name: string): CategoryEntry | 'archived' | null {
    const sys = systemKeyOf(name, kind);
    const s = sys ? systemTop.get(`${kind}|${sys}`) : undefined;
    if (s) return s.archivedAt ? 'archived' : s;
    const k = `${kind}|${nameKey(name)}`;
    return topActive.get(k) ?? null;
  }

  /** Дополнения строки: применяются к спискам «Будет создано» только если строка не получила R17. */
  let pending: (() => void)[] = [];

  function newTopCategory(kind: CategoryKind, name: string): { key: string } {
    const key = `${kind}|${nameKey(name)}`;
    pending.push(() => {
      const c = newCats.get(key) ?? { key, kind, name: repairName(name), parent: null, parentName: null, rows: 0 };
      c.rows++;
      newCats.set(key, c);
    });
    return { key };
  }

  /** parentName — название родителя; у нового родителя его знает только список (первое написание), поэтому функция. */
  function newChildCategory(kind: CategoryKind, parent: Ref, parentName: () => string, name: string): Ref {
    const key = `${kind}|${refKey(parent)}|${nameKey(name)}`;
    pending.push(() => {
      const c = newCats.get(key) ?? { key, kind, name: repairName(name), parent, parentName: parentName(), rows: 0 };
      c.rows++;
      newCats.set(key, c);
    });
    return { key };
  }

  for (const r of rows) {
    const n = r.row;
    pending = [];
    let failed = false;
    const archived = (what: string, name: string) => {
      issues.push({ code: 'R17', message: M.R17(what, name), row: n });
      failed = true;
    };
    const kind: CategoryKind = r.type === 'income' ? 'income' : 'expense';

    // категория (§4.5): у перевода категорий нет
    let category: Ref | null = null;
    let categorySystemKey: SystemKey | null = null;
    if (r.type !== 'transfer' && r.category) {
      const top = findTop(kind, r.category);
      const k = `${kind}|${nameKey(r.category)}`;
      if (!r.subcategory) {
        const kids = childActiveByKey.get(k) ?? [];
        if (top && top !== 'archived') {
          category = { id: top.id };
          categorySystemKey = effectiveSystem(top);
        } else if (kids.length === 1) {
          category = { id: kids[0]!.id };
          categorySystemKey = effectiveSystem(kids[0]!);
        } else if (top === 'archived' || archivedTop.has(k) || (kids.length === 0 && archivedAny.has(k))) archived('Категория', r.category);
        else category = newTopCategory(kind, r.category);
      } else {
        // родитель — только верхнего уровня, иначе было бы три уровня
        if (top === 'archived' || (!top && archivedTop.has(k))) archived('Категория', r.category);
        else if (top) {
          // существующий родитель: ребёнок — среди его детей
          const kids = childrenByKey.get(`${top.id}|${nameKey(r.subcategory)}`) ?? [];
          const active = kids.find((c) => !c.archivedAt);
          if (active) category = { id: active.id };
          else if (kids.length) archived('Категория', r.subcategory);
          else category = newChildCategory(kind, { id: top.id }, () => top.name, r.subcategory);
          categorySystemKey = effectiveSystem(top);
        } else {
          const parent = newTopCategory(kind, r.category);
          category = newChildCategory(kind, parent, () => newCats.get(parent.key)!.name, r.subcategory);
        }
      }
    }

    // контрагент (§4.6): тип — по категории; сначала с нужным типом, затем любого типа
    let counterparty: Ref | null = null;
    if (r.counterparty) {
      const need = neededCounterpartyType(kind, categorySystemKey);
      const k = nameKey(r.counterparty);
      const same = cpsByKey.get(k) ?? [];
      const active = same.filter((c) => !c.archivedAt);
      const hit = active.find((c) => c.type === need) ?? active[0];
      if (hit) counterparty = { id: hit.id };
      else if (same.length) archived('Контрагент', r.counterparty);
      else {
        const name = r.counterparty;
        pending.push(() => {
          const c = newCps.get(k) ?? { key: k, name: repairName(name), type: need, rows: 0, votes: new Map() };
          c.rows++;
          c.votes.set(need, (c.votes.get(need) ?? 0) + 1);
          newCps.set(k, c);
        });
        counterparty = { key: k };
      }
    }

    // проект (§4.7) и теги (§4.8): названия уникальны в компании, архивный — R17
    const named = (existing: Map<string, NamedEntry[]>, fresh: Map<string, PlannedNamed>, what: string, name: string): Ref | null => {
      const k = nameKey(name);
      const same = existing.get(k) ?? [];
      const active = same.find((x) => !x.archivedAt);
      if (active) return { id: active.id };
      if (same.length) {
        archived(what, name);
        return null;
      }
      pending.push(() => {
        const x = fresh.get(k) ?? { key: k, name: repairName(name), rows: 0 };
        x.rows++;
        fresh.set(k, x);
      });
      return { key: k };
    };
    const project = r.project ? named(projectsByKey, newProjects, 'Проект', r.project) : null;
    // parse-row уже убирает повторы тегов в строке; здесь то же по ключу — чтобы счётчик строк не зависел от вызывающего
    const seenTags = new Set<string>();
    const tagRefs = r.tags
      .filter((t) => !seenTags.has(nameKey(t)) && seenTags.add(nameKey(t)))
      .map((t) => named(tagsByKey, newTags, 'Тег', t))
      .filter((x): x is Ref => x !== null);

    if (!failed) {
      for (const apply of pending) apply();
      out.set(n, { category, categorySystemKey, counterparty, project, tags: tagRefs });
    }
  }

  const cats = [...newCats.values()];
  return {
    rows: out,
    issues,
    categories: [...cats.filter((c) => c.parent === null), ...cats.filter((c) => c.parent !== null)],
    counterparties: [...newCps.values()].map(({ votes, ...c }) => ({ ...c, type: pickCounterpartyType(votes) })),
    projects: [...newProjects.values()],
    tags: [...newTags.values()],
  };
}
