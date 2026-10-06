export type CategoryKind = 'income' | 'expense';

export type SystemKey =
  | 'investment'
  | 'loan_repaid'
  | 'credit_received'
  | 'salary'
  | 'tax'
  | 'vat'
  | 'dividends'
  | 'credit_repayment'
  | 'loan_issued';

export type CounterpartyType = 'client' | 'supplier' | 'employee' | 'owner' | 'investor' | 'creditor' | 'borrower' | 'tax';

export interface SystemCategoryDef {
  key: SystemKey;
  kind: CategoryKind;
  name: string;
  counterpartyType: CounterpartyType;
}

export const SYSTEM_CATEGORIES: readonly SystemCategoryDef[] = [
  { key: 'investment', kind: 'income', name: 'Инвестиции', counterpartyType: 'investor' },
  { key: 'loan_repaid', kind: 'income', name: 'Возврат займа', counterpartyType: 'borrower' },
  { key: 'credit_received', kind: 'income', name: 'Получение кредита', counterpartyType: 'creditor' },
  { key: 'salary', kind: 'expense', name: 'Зарплата', counterpartyType: 'employee' },
  { key: 'tax', kind: 'expense', name: 'Налоги', counterpartyType: 'tax' },
  { key: 'vat', kind: 'expense', name: 'НДС', counterpartyType: 'tax' },
  { key: 'dividends', kind: 'expense', name: 'Дивиденды', counterpartyType: 'owner' },
  { key: 'credit_repayment', kind: 'expense', name: 'Погашение кредита', counterpartyType: 'creditor' },
  { key: 'loan_issued', kind: 'expense', name: 'Выдача займа', counterpartyType: 'borrower' },
];

const byKey = new Map(SYSTEM_CATEGORIES.map((c) => [c.key, c]));

export function systemCategory(key: SystemKey): SystemCategoryDef {
  const c = byKey.get(key);
  if (!c) throw new Error(`Неизвестная системная статья: ${key}`);
  return c;
}

export function effectiveSystemKey(own: SystemKey | null, parent: SystemKey | null): SystemKey | null {
  return own ?? parent;
}
