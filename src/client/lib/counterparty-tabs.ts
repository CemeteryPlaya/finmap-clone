import { COUNTERPARTY_TYPE_LABELS } from '../../shared/counterparties';
import type { CounterpartyType } from '../../shared/system-categories';

/** Пункт подменю «Контрагентов» (§7.3 этапа 1.5): типы системных категорий и «Мои контрагенты» (клиенты и поставщики). */
export type CounterpartyTab = 'investor' | 'creditor' | 'borrower' | 'employee' | 'owner' | 'tax' | 'my';

export interface CounterpartyTabInfo {
  tab: CounterpartyTab;
  label: string;
  /** Главная кнопка над списком. */
  add: string;
  /** Заголовок окна создания. */
  createTitle: string;
  /** Заголовок окна правки. */
  editTitle: string;
}

/** Порядок Finmap (03-№15). */
export const COUNTERPARTY_TABS: readonly CounterpartyTabInfo[] = [
  { tab: 'investor', label: COUNTERPARTY_TYPE_LABELS.investor, add: 'Добавить инвестора', createTitle: 'Новый инвестор', editTitle: 'Инвестор' },
  { tab: 'creditor', label: COUNTERPARTY_TYPE_LABELS.creditor, add: 'Добавить кредитора', createTitle: 'Новый кредитор', editTitle: 'Кредитор' },
  { tab: 'borrower', label: COUNTERPARTY_TYPE_LABELS.borrower, add: 'Добавить заёмщика', createTitle: 'Новый заёмщик', editTitle: 'Заёмщик' },
  { tab: 'employee', label: COUNTERPARTY_TYPE_LABELS.employee, add: 'Добавить сотрудника', createTitle: 'Новый сотрудник', editTitle: 'Сотрудник' },
  { tab: 'owner', label: COUNTERPARTY_TYPE_LABELS.owner, add: 'Добавить владельца', createTitle: 'Новый владелец', editTitle: 'Владелец' },
  { tab: 'tax', label: COUNTERPARTY_TYPE_LABELS.tax, add: 'Добавить тип налога', createTitle: 'Новый тип налога', editTitle: 'Тип налога' },
  { tab: 'my', label: 'Мои контрагенты', add: 'Добавить контрагента', createTitle: 'Новый контрагент', editTitle: 'Контрагент' },
];

/** Вкладка по умолчанию — у клубов самый частый тип. */
export const DEFAULT_COUNTERPARTY_TAB: CounterpartyTab = 'my';

/** `?type=` адреса: известный пункт — он, иначе «Мои контрагенты» (§4.2). */
export function counterpartyTab(param: string | null): CounterpartyTab {
  return COUNTERPARTY_TABS.find((t) => t.tab === param)?.tab ?? DEFAULT_COUNTERPARTY_TAB;
}

export function counterpartyTabInfo(tab: CounterpartyTab): CounterpartyTabInfo {
  return COUNTERPARTY_TABS.find((t) => t.tab === tab) ?? COUNTERPARTY_TABS[COUNTERPARTY_TABS.length - 1]!;
}

/** Вкладка контрагента: клиенты и поставщики — «Мои контрагенты». */
export function tabOfType(type: CounterpartyType): CounterpartyTab {
  return type === 'client' || type === 'supplier' ? 'my' : type;
}
