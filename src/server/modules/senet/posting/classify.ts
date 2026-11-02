import { looksLikeBarPurchase } from './bar';
import { normalize } from './normalize';
import { anyMatch, type RuleRow, type RuleSet } from './rules';

/** Группа для раскладки по минутам (§4.4): по категории, как в эталоне. */
export type Group = 'salary' | 'lunch' | 'bar' | 'other';
export type ReviewReason = 'unrecognized' | 'name_only' | 'salary_no_name' | 'rule_broken';
export interface Hint {
  categoryId?: number;
  counterpartyId?: number;
}

export type Classified =
  | { kind: 'kaspi' }
  | { kind: 'expense'; group: Group; categoryId: number; counterpartyId: number | null; comment: string | null; ruleId: number | null }
  /** Доплата («dop zp»): получатель — первый сотрудник с ЗП в этой же смене (план смены). */
  | { kind: 'extra_pay'; group: 'salary'; categoryId: number; ruleId: number | null }
  | { kind: 'review'; reason: ReviewReason; hint: Hint | null };

const TRAINEE_COMMENT = 'стажер';
const review = (reason: ReviewReason, hint: Hint | null = null): Classified => ({ kind: 'review', reason, hint });
const template = (t: string | null, orig: string) => (t ? t.replace('{orig}', orig) || null : null);

/**
 * Выемка → расход по правилам (§4.3). Порядок типов — как в эталоне: точное, каспи, стажёр, зарплата, мастер,
 * дивиденды, «только имя», обед, ключевые слова, бар, иначе — очередь. Правило со ссылкой на архивную категорию или
 * контрагента не проводит, а отправляет в очередь (rule_broken); новых контрагентов разноска не создаёт никогда.
 */
export function classify(comment: string, rules: RuleSet): Classified {
  const n = normalize(comment);
  const words = n ? n.split(' ') : [];
  const orig = comment.trim();
  const live = (id: number | null | undefined, set: ReadonlySet<number>) => id !== null && id !== undefined && set.has(id);
  const groupOf = (categoryId: number): Group =>
    categoryId === rules.salary?.categoryId ? 'salary' : categoryId === rules.lunchRow?.categoryId ? 'lunch' : categoryId === rules.barRow?.categoryId ? 'bar' : 'other';
  const expense = (categoryId: number | null | undefined, counterpartyId: number | null | undefined, text: string | null, rule: RuleRow | null): Classified => {
    if (!live(categoryId, rules.active.categories)) return review('rule_broken');
    if (counterpartyId !== null && counterpartyId !== undefined && !rules.active.counterparties.has(counterpartyId)) return review('rule_broken');
    return { kind: 'expense', group: groupOf(categoryId!), categoryId: categoryId!, counterpartyId: counterpartyId ?? null, comment: text, ruleId: rule?.id ?? null };
  };
  const salaryCategory = rules.salary?.categoryId;

  const exact = n ? rules.exact.get(n) : undefined;
  if (exact) return expense(exact.categoryId, exact.counterpartyId, template(exact.commentTemplate, orig), exact);

  if (anyMatch(n, rules.kaspi)) return { kind: 'kaspi' };

  const isSalary = anyMatch(n, rules.salaryWords) !== undefined;
  const employee = words.map((w) => rules.employees.get(w)).find((r) => r !== undefined);
  const trainee = anyMatch(n, rules.trainee);
  if (trainee && (isSalary || words.length <= 3)) return expense(salaryCategory, null, TRAINEE_COMMENT, trainee.rule);

  if (isSalary) {
    if (employee) return expense(salaryCategory, employee.counterpartyId, null, employee);
    const extra = anyMatch(n, rules.extraPay);
    if (extra) return live(salaryCategory, rules.active.categories) ? { kind: 'extra_pay', group: 'salary', categoryId: salaryCategory!, ruleId: extra.rule.id } : review('rule_broken');
    return review('salary_no_name', live(salaryCategory, rules.active.categories) ? { categoryId: salaryCategory! } : null);
  }

  const master = words.map((w) => rules.masters.get(w)).find((r) => r !== undefined);
  if (master) return expense(master.categoryId, master.counterpartyId, null, master);

  const family = (w: string) => rules.ownerWords.has(w) || rules.ownerA.has(w);
  if (words.some(family)) {
    const onlyA = words.every(family) && words.filter(family).every((w) => rules.ownerA.has(w));
    const owner = onlyA ? rules.ownerARow?.counterpartyId : rules.dividends?.counterpartyId;
    // владелец не задан — не придумываем контрагента: в очередь
    if (owner === null || owner === undefined) return review('rule_broken');
    return expense(rules.dividends?.categoryId, owner, null, rules.dividends);
  }

  if (employee && words.length === 1) {
    const hint: Hint = {};
    if (live(salaryCategory, rules.active.categories)) hint.categoryId = salaryCategory!;
    if (live(employee.counterpartyId, rules.active.counterparties)) hint.counterpartyId = employee.counterpartyId!;
    return review('name_only', hint);
  }

  const lunch = anyMatch(n, rules.lunch);
  if (lunch) return expense(rules.lunchRow?.categoryId, null, null, lunch.rule);

  const keyword = anyMatch(n, rules.keywords);
  if (keyword) return expense(keyword.rule.categoryId, keyword.rule.counterpartyId, template(keyword.rule.commentTemplate, orig), keyword.rule);

  const item = anyMatch(n, rules.barItems);
  if (item || looksLikeBarPurchase(n)) {
    const supplier = anyMatch(n, rules.barSuppliers)?.rule.counterpartyId ?? rules.barDefault?.counterpartyId;
    const defect = rules.barItems.some((m) => m.rule.flags.defect && anyMatch(n, [m]));
    return expense(rules.barRow?.categoryId, supplier, defect ? orig : null, rules.barRow);
  }

  return review('unrecognized');
}
