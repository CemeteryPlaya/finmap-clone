import type { CounterpartyType } from './system-categories';

export const COUNTERPARTY_TYPES = [
  'client',
  'supplier',
  'employee',
  'owner',
  'investor',
  'creditor',
  'borrower',
  'tax',
] as const satisfies readonly CounterpartyType[];

/** Подписи вкладок (множественное число). */
export const COUNTERPARTY_TYPE_LABELS: Record<CounterpartyType, string> = {
  client: 'Клиенты',
  supplier: 'Поставщики',
  employee: 'Сотрудники',
  owner: 'Собственники',
  investor: 'Инвесторы',
  creditor: 'Кредиторы',
  borrower: 'Заёмщики',
  tax: 'Налоговые',
};

/** Подписи в списке выбора типа (единственное число). */
export const COUNTERPARTY_TYPE_SINGULAR: Record<CounterpartyType, string> = {
  client: 'Клиент',
  supplier: 'Поставщик',
  employee: 'Сотрудник',
  owner: 'Собственник',
  investor: 'Инвестор',
  creditor: 'Кредитор',
  borrower: 'Заёмщик',
  tax: 'Налоговый орган',
};
