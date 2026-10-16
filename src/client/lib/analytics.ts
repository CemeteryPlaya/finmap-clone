export type CardIcon = 'wallet' | 'history' | 'plan' | 'in' | 'out' | 'scale';

/** Карточка раздела «Аналитика» (§2.1): ссылка на отчёт или неактивная (пунктир и подпись). */
export interface AnalyticsCard {
  key: string;
  title: string;
  description: string;
  /** Подсказка «?». */
  help: string;
  icon: CardIcon;
  /** Адрес отчёта; null — карточка неактивна. */
  href: ((companyId: number) => string) | null;
  /** Подпись неактивной карточки. */
  inactive?: string;
}

const PLANNED = 'Появится с плановыми операциями';

/**
 * Карточки по порядку §2.1. Отчёты следующих планов («Прибыль», «Выписка по счету», «Проекты», «Финансовые показатели»)
 * появляются вместе с ними: мёртвых карточек нет. «План/Факт», «Дебиторка», «Кредиторка», «Баланс» — неактивные (этап 3).
 */
export const ANALYTICS_CARDS: readonly AnalyticsCard[] = [
  {
    key: 'cashflow',
    title: 'Деньги / Cash flow',
    description: 'Отчёт о движении денежных средств',
    help: 'Поступления, списания и остатки по дате платежа: сколько денег пришло и ушло за каждый день, неделю, месяц или квартал.',
    icon: 'wallet',
    href: (cid) => `/c/${cid}/analytics/cashflow`,
  },
  {
    key: 'history',
    title: 'История действий',
    description: 'Все действия в системе',
    help: 'Кто и когда добавил, изменил или удалил операции, счета, категории и другие записи.',
    icon: 'history',
    href: (cid) => `/c/${cid}/settings/audit`,
  },
  { key: 'plan', title: 'План/Факт', description: 'Сравнение плановых и фактических результатов', help: 'Плановые суммы по категориям и их выполнение.', icon: 'plan', href: null, inactive: PLANNED },
  { key: 'receivables', title: 'Дебиторка', description: 'Кто и сколько должен вам', help: 'Долги клиентов по плановым поступлениям.', icon: 'in', href: null, inactive: PLANNED },
  { key: 'payables', title: 'Кредиторка', description: 'Кому и сколько должны вы', help: 'Ваши долги по плановым списаниям.', icon: 'out', href: null, inactive: PLANNED },
  { key: 'balance', title: 'Баланс', description: 'Активы и обязательства', help: 'Сколько бизнес стоит на самом деле: активы минус долги.', icon: 'scale', href: null, inactive: PLANNED },
];
