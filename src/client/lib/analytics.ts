import { useQuery } from '@tanstack/react-query';
import type { ReportBy, ReportColumn, ReportRow, ReportStep } from '../../shared/report-engine';
import { api, type ApiError } from './api';
import { queryClient } from './query';

export type { ReportColumn, ReportRow };

/** Ответ отчёта (§3.2 спецификации «Аналитика»). */
export interface ReportData {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: { from: string; to: string; step: ReportStep; by: ReportBy; currency: string; empty: boolean; balancesHidden: boolean };
}

/**
 * «Деньги» по строке запроса (reportApiParams) или null, пока она не готова. Ключ ['analytics', cid, …]: сброс
 * ['analytics', cid] (invalidateAnalytics) обновляет все отчёты компании. При смене настроек прежняя таблица остаётся
 * на экране до ответа; отчёт другой компании не показывается.
 */
export function useCashflow(companyId: number, params: string | null) {
  return useQuery<ReportData, ApiError>({
    queryKey: ['analytics', companyId, 'cashflow', params],
    enabled: params !== null,
    queryFn: () => api<ReportData>(`/companies/${companyId}/analytics/cashflow?${params}`),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Любая операция, документ склада, импорт или правка счёта меняют отчёты (§10): кэш отчётов компании сбрасывается. */
export function invalidateAnalytics(companyId: number): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['analytics', companyId] });
}

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
