import { normalize } from './normalize';

/**
 * Правила разноски (§4.3): код знает только типы, слова и ссылки на категории и контрагентов — данные компании.
 * Строка с пустым шаблоном — настройка типа: категория зарплаты, обеда, дивидендов, бара; владельцы А и Б; поставщик
 * по умолчанию.
 */
export type MatchMode = 'word' | 'first' | 'phrase' | 'prefix' | 'contains';
export type RuleType =
  | 'exact'
  | 'kaspi'
  | 'trainee'
  | 'salary_word'
  | 'extra_pay_word'
  | 'employee_alias'
  | 'master'
  | 'owner_word'
  | 'owner_a_alias'
  | 'lunch'
  | 'keyword'
  | 'bar_item'
  | 'bar_supplier';

export interface RuleRow {
  id: number;
  officeId: number | null;
  type: RuleType;
  pattern: string;
  match: MatchMode;
  priority: number;
  categoryId: number | null;
  counterpartyId: number | null;
  commentTemplate: string | null;
  flags: { mistaken?: boolean; defect?: boolean };
  archived: boolean;
}

export interface Matcher {
  pattern: string;
  match: MatchMode;
  rule: RuleRow;
}

/** Ссылка правила: id, если категория (контрагент) действует; undefined — ссылка на архивную или удалённую. */
export type Ref = number | null | undefined;

export interface RuleSet {
  exact: Map<string, RuleRow>;
  kaspi: Matcher[];
  trainee: Matcher[];
  salaryWords: Matcher[];
  extraPay: Matcher[];
  employees: Map<string, RuleRow>;
  masters: Map<string, RuleRow>;
  ownerWords: Set<string>;
  ownerA: Set<string>;
  lunch: Matcher[];
  keywords: Matcher[];
  barItems: Matcher[];
  barSuppliers: Matcher[];
  /** Настройки типов (строки с пустым шаблоном). */
  salary: RuleRow | null;
  dividends: RuleRow | null;
  ownerARow: RuleRow | null;
  lunchRow: RuleRow | null;
  barRow: RuleRow | null;
  barDefault: RuleRow | null;
  active: { categories: ReadonlySet<number>; counterparties: ReadonlySet<number> };
}

/** Совпадение нормализованного комментария n с шаблоном (П1 плана: пять видов). */
export function matches(n: string, pattern: string, mode: MatchMode): boolean {
  if (!pattern) return false;
  switch (mode) {
    case 'phrase':
      return n === pattern;
    case 'first':
      return n === pattern || n.startsWith(`${pattern} `);
    case 'word':
      return ` ${n} `.includes(` ${pattern} `);
    case 'prefix':
      return n.startsWith(pattern);
    case 'contains':
      return n.includes(pattern);
  }
}

export const anyMatch = (n: string, list: readonly Matcher[]) => list.find((m) => matches(n, m.pattern, m.match));

/** Набор правил клуба: архивные не действуют, правило другого клуба — тоже; порядок — по приоритету. */
export function buildRuleSet(rows: readonly RuleRow[], officeId: number, active: RuleSet['active']): RuleSet {
  const live = rows.filter((r) => !r.archived && (r.officeId === null || r.officeId === officeId)).sort((a, b) => a.priority - b.priority || a.id - b.id);
  const of = (type: RuleType) => live.filter((r) => r.type === type);
  const words = (type: RuleType) => of(type).filter((r) => r.pattern !== '').map((r): Matcher => ({ pattern: normalize(r.pattern), match: r.match, rule: r }));
  const setting = (type: RuleType) => of(type).find((r) => r.pattern === '') ?? null;
  const byWord = (type: RuleType) => new Map(of(type).filter((r) => r.pattern !== '').map((r) => [normalize(r.pattern), r] as const));
  return {
    exact: new Map(of('exact').map((r) => [normalize(r.pattern), r] as const)),
    kaspi: words('kaspi'),
    trainee: words('trainee'),
    salaryWords: words('salary_word'),
    extraPay: words('extra_pay_word'),
    employees: byWord('employee_alias'),
    masters: byWord('master'),
    ownerWords: new Set(of('owner_word').filter((r) => r.pattern).map((r) => normalize(r.pattern))),
    ownerA: new Set(of('owner_a_alias').filter((r) => r.pattern).map((r) => normalize(r.pattern))),
    lunch: words('lunch'),
    keywords: words('keyword'),
    barItems: words('bar_item'),
    barSuppliers: words('bar_supplier'),
    salary: setting('salary_word'),
    dividends: setting('owner_word'),
    ownerARow: setting('owner_a_alias'),
    lunchRow: setting('lunch'),
    barRow: setting('bar_item'),
    barDefault: setting('bar_supplier'),
    active,
  };
}
