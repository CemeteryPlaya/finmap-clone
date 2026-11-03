import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { ReportBy, ReportColumn, ReportRow, ReportStep } from '../../shared/report-engine';
import type { ProjectRow, ProjectsMode, ProjectStatus } from '../../shared/report-projects';
import type { StatementSummary } from '../../shared/report-statement';
import type { ReportKind } from '../../shared/schemas/analytics';
import type { DashboardDef, SavedDashboards } from '../../shared/analytics-catalog';
import type { AnalyticsSettingsView } from './analytics-settings';
import { api, type ApiError } from './api';
import type { JournalItem } from './queries';
import { queryClient } from './query';

export type { ReportColumn, ReportKind, ReportRow };

/** Ответ отчёта (§3.2 спецификации «Аналитика»). */
export interface ReportData {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: {
    from: string;
    to: string;
    step: ReportStep;
    by: ReportBy;
    currency: string;
    empty: boolean;
    balancesHidden: boolean;
    /** «Прибыль»: склад по себестоимости учтён (§5.3). */
    stock?: boolean;
    /** «Прибыль»: продаж «Нет партии» в периоде. */
    noBatch?: number;
  };
}

/** Операция в списке под отчётом (§2.5): строка журнала и сумма строк ячейки (в валюте счёта), если вошла только часть операции. */
export interface CellItem extends JournalItem {
  part: number | null;
}

export interface CellPageData {
  items: CellItem[];
  nextCursor: string | null;
}

/**
 * Отчёт («Деньги», «Прибыль») по строке запроса (reportApiParams) или null, пока она не готова. Ключ ['analytics', cid, …]:
 * сброс ['analytics', cid] (invalidateAnalytics) обновляет все отчёты компании. При смене настроек прежняя таблица
 * остаётся на экране до ответа; отчёт другой компании не показывается.
 */
export function useReport(companyId: number, report: ReportKind, params: string | null) {
  return useQuery<ReportData, ApiError>({
    queryKey: ['analytics', companyId, report, params],
    enabled: params !== null,
    queryFn: () => api<ReportData>(`/companies/${companyId}/analytics/${report}?${params}`),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Операции ячейки отчёта (§2.5): страницы по 50 курсором, как журнал. params — параметры отчёта, report, row и col. */
export function useCellOperations(companyId: number, params: string) {
  return useInfiniteQuery<CellPageData, ApiError, InfiniteData<CellPageData, string | null>, readonly unknown[], string | null>({
    queryKey: ['analytics', companyId, 'operations', params],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params);
      if (pageParam !== null) p.set('cursor', pageParam);
      return api<CellPageData>(`/companies/${companyId}/analytics/operations?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Ответ «Проектов» (§7): строки проектов, «Всего» и сведения о расчёте; суммы — в базовой валюте. */
export interface ProjectsData {
  rows: ProjectRow[];
  total: ProjectRow;
  meta: { from: string; to: string; status: ProjectStatus; mode: ProjectsMode; currency: string; empty: boolean; stock: boolean; noBatch: number };
}

/** «Проекты» по строке запроса (projectsApiParams) или null, пока она не готова; прежняя таблица — до ответа. */
export function useProjectsReport(companyId: number, params: string | null) {
  return useQuery<ProjectsData, ApiError>({
    queryKey: ['analytics', companyId, 'projects', params],
    enabled: params !== null,
    queryFn: () => api<ProjectsData>(`/companies/${companyId}/analytics/projects?${params}`),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Страница операций выписки (§6): строки журнала с остатками после операции, новые сверху. */
export interface StatementPageData {
  items: JournalItem[];
  nextCursor: string | null;
}

/** Первая страница выписки — со счётом и сводкой в его валюте. */
export interface StatementData extends StatementPageData {
  account: { id: number; name: string; currency: string; archived: boolean; openedAt: string };
  summary: StatementSummary;
  meta: { from: string; to: string };
}

/**
 * «Выписка по счету» (§6, §9) по строке запроса (statementApiParams) или null, пока она не готова: первая страница —
 * `statement` со сводкой, следующие — `statement/operations` по курсору. Ключ ['analytics', cid, 'statement', …]: его
 * сбрасывает invalidateAnalytics. При смене счёта или периода прежняя выписка остаётся на экране до ответа.
 */
export function useStatement(companyId: number, params: string | null) {
  return useInfiniteQuery<StatementPageData, ApiError, InfiniteData<StatementPageData, string | null>, readonly unknown[], string | null>({
    queryKey: ['analytics', companyId, 'statement', params],
    enabled: params !== null,
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      if (pageParam === null) return api<StatementData>(`/companies/${companyId}/analytics/statement?${params}`);
      const p = new URLSearchParams(params ?? '');
      p.set('cursor', pageParam);
      return api<StatementPageData>(`/companies/${companyId}/analytics/statement/operations?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Любая операция, документ склада, импорт или правка счёта меняют отчёты (§10): кэш отчётов компании сбрасывается. */
export function invalidateAnalytics(companyId: number): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['analytics', companyId] });
}

export type CardIcon = 'wallet' | 'profit' | 'statement' | 'projects' | 'indicators' | 'history' | 'plan' | 'in' | 'out' | 'scale' | 'gauge' | 'coins';

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

/**
 * Карточки по порядку §2.1. «План/Факт», «Дебиторка», «Кредиторка» и «Баланс» убраны до плановых операций (решение
 * владельца 2026-10-20: неработающих карточек не показывать); неактивная карточка (href: null, inactive) остаётся
 * возможной.
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
    key: 'pnl',
    title: 'Прибыль / P&L',
    description: 'Отчёт о прибыли и убытках',
    help: 'Доходы, расходы и прибыль по дате сделки, без переводов, инвестиций, дивидендов, займов и кредитов; товары склада — по себестоимости.',
    icon: 'profit',
    href: (cid) => `/c/${cid}/analytics/pnl`,
  },
  {
    key: 'statement',
    title: 'Выписка по счету',
    description: 'Все поступления, списания и переводы одного счёта',
    help: 'Все деньги, которые приходили и уходили по одному счёту: поступления, списания и переводы за период, с остатком после каждой операции. Удобно сверить с выпиской банка.',
    icon: 'statement',
    href: (cid) => `/c/${cid}/analytics/statement`,
  },
  {
    key: 'projects',
    title: 'Проекты',
    description: 'Прибыль и рентабельность по каждому клубу',
    help: 'Доходы, расходы, прибыль и рентабельность каждого проекта (клуба) за период — по тем же правилам, что «Прибыль»: по дате сделки, без переводов, инвестиций, дивидендов, займов и кредитов.',
    icon: 'projects',
    href: (cid) => `/c/${cid}/analytics/projects`,
  },
  {
    key: 'indicators',
    title: 'Финансовые показатели',
    description: 'Валовая прибыль, маржинальный доход, EBITDA, процент маржи',
    help: 'Насколько эффективно работает бизнес: валовая прибыль, маржинальный доход, EBITDA и процент маржи по месяцам или кварталам. Категории каждого показателя можно выбрать, нажав его название.',
    icon: 'indicators',
    href: (cid) => `/c/${cid}/analytics/indicators`,
  },
  {
    key: 'history',
    title: 'История действий',
    description: 'Все действия в системе',
    help: 'Кто и когда добавил, изменил или удалил операции, счета, категории и другие записи.',
    icon: 'history',
    href: (cid) => `/c/${cid}/settings/audit`,
  },
];

/** Ответ `GET …/club-analytics/scope` (спецификация «Аналитика клуба», §2.1): проекты-клубы и есть ли данные Senet. */
export interface ClubScopeView {
  projects: { id: number; name: string; archived: boolean; pcCount: number | null }[];
  hasOffices: boolean;
  connected: boolean;
  freshness: string | null;
}

export function useClubScope(companyId: number, enabled = true) {
  return useQuery<ClubScopeView, ApiError>({
    queryKey: ['analytics', companyId, 'club-scope'],
    enabled,
    queryFn: () => api<ClubScopeView>(`/companies/${companyId}/club-analytics/scope`),
  });
}

/** Группа карточек главной «Аналитики»; у финансовой заголовка нет. */
export interface CardGroup {
  key: string;
  title: string | null;
  cards: AnalyticsCard[];
}

/** Рисунки карточек клуба; карточка без своего — «показатели». */
const CLUB_ICONS: Record<string, CardIcon> = { overview: 'gauge', revenue: 'coins' };

/** Почему карточки клуба серые (§13): нет подключения Senet или клуб Senet не привязан к проекту. */
function clubInactive(scope: ClubScopeView | null): string | null {
  if (!scope?.connected) return 'Подключите Senet в «Интеграциях»';
  return scope.hasOffices ? null : 'Привяжите клуб Senet к проекту в «Интеграциях»';
}

/** Карточка дашборда шаблона: серая с подсказкой, пока данных Senet нет. */
function dashboardCard(d: DashboardDef, inactive: string | null): AnalyticsCard {
  const path = d.path;
  return { key: d.key, title: d.title, description: d.description, help: d.help, icon: CLUB_ICONS[d.key] ?? 'indicators', href: inactive ? null : (cid) => `/c/${cid}/analytics/${path}`, inactive: inactive ?? undefined };
}

/** Видимые карточки группы по порядку настроек: финансовые — из ANALYTICS_CARDS, шаблона — из каталога. */
function groupCards(settings: AnalyticsSettingsView, group: SavedDashboards['groups'][number], scope: ClubScopeView | null): AnalyticsCard[] {
  const shown = group.cards.filter((c) => c.visible).map((c) => c.key);
  if (group.key === 'finance') return shown.flatMap((k) => ANALYTICS_CARDS.filter((c) => c.key === k));
  const defs = settings.catalog[group.key]?.dashboards ?? [];
  const inactive = clubInactive(scope);
  return shown.flatMap((k) => defs.filter((d) => d.key === k).map((d) => dashboardCard(d, inactive)));
}

/** Группы главной «Аналитики» по настройкам компании (§2.1, §10.1): видимые группы и карточки в их порядке. */
export function analyticsGroups(settings: AnalyticsSettingsView, scope: ClubScopeView | null): CardGroup[] {
  return settings.dashboards.groups
    .filter((g) => g.visible)
    .map((g) => ({ key: g.key, title: g.key === 'finance' ? null : (settings.groups.find((x) => x.key === g.key)?.title ?? g.key), cards: groupCards(settings, g, scope) }));
}
