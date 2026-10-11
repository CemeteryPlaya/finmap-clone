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

/** Подписи вкладок и групп списка (множественное число, как в Finmap — §6.4 этапа 1.5). */
export const COUNTERPARTY_TYPE_LABELS: Record<CounterpartyType, string> = {
  client: 'Клиенты',
  supplier: 'Поставщики',
  employee: 'Сотрудники',
  owner: 'Владельцы',
  investor: 'Инвесторы',
  creditor: 'Кредиторы',
  borrower: 'Заёмщики',
  tax: 'Типы налогов',
};

/** Подписи в списке выбора типа и поля контрагента (единственное число). */
export const COUNTERPARTY_TYPE_SINGULAR: Record<CounterpartyType, string> = {
  client: 'Клиент',
  supplier: 'Поставщик',
  employee: 'Сотрудник',
  owner: 'Владелец',
  investor: 'Инвестор',
  creditor: 'Кредитор',
  borrower: 'Заёмщик',
  tax: 'Тип налога',
};
