import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import type { ImportListPage } from '../../shared/schemas/imports';
import type { CounterpartyType } from '../../shared/system-categories';
import type { SavedJournalFilter } from './journal-filter';
import { queryClient } from './query';

export interface Company {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
  /** Базовую валюту менять нельзя: есть операции или фиксированные курсы (§4.2). */
  currencyLocked: boolean;
}

export interface Project {
  id: number;
  companyId: number;
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface TemplateInfo {
  key: string;
  name: string;
  integrations: string[];
  paramsUi: { key: string; label: string; type: 'int' | 'text'; hint?: string }[];
  /** Шаблоны названий счетов по умолчанию, `{project}` — название проекта. */
  defaultAccounts: string[];
}

export function useCompanies() {
  return useQuery<Company[], ApiError>({
    queryKey: ['companies'],
    queryFn: async () => (await api<{ companies: Company[] }>('/companies')).companies,
  });
}

export function useProjects(companyId: number) {
  return useQuery<Project[], ApiError>({
    queryKey: ['projects', companyId],
    queryFn: async () => (await api<{ projects: Project[] }>(`/companies/${companyId}/projects`)).projects,
  });
}

export function useTemplates() {
  return useQuery<TemplateInfo[], ApiError>({
    queryKey: ['templates'],
    queryFn: async () => (await api<{ templates: TemplateInfo[] }>('/templates')).templates,
    staleTime: Infinity,
  });
}

export interface Account {
  id: number;
  companyId: number;
  projectId: number | null;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
  /** По счёту есть операции (включая удалённые) — валюту менять нельзя (§4.4). */
  hasOperations: boolean;
}

export function useAccounts(companyId: number) {
  return useQuery<Account[], ApiError>({
    queryKey: ['accounts', companyId],
    queryFn: async () => (await api<{ accounts: Account[] }>(`/companies/${companyId}/accounts`)).accounts,
  });
}

export interface CompanyTotal {
  currency: string;
  amount: number;
  /** Валюты счетов без курса на сегодня: в итог не вошли. */
  unavailable: string[];
}

export interface Balances {
  accounts: { accountId: number; currency: string; balance: number }[];
  total: CompanyTotal;
}

/**
 * Недорогие запросы обновляются при возврате на вкладку браузера (§2.5 этапа 1.5), не чаще раза в 30 с.
 * Журнал сам не перезапрашивается (общая настройка refetchOnWindowFocus: false): бесконечная прокрутка
 * перезапросила бы все загруженные страницы — его обновляет кнопка ⟳.
 */
const REFRESH_ON_FOCUS = { refetchOnWindowFocus: true, staleTime: 30_000 } as const;

/** Ключ — продолжение ключа счетов: обновление ['accounts', cid] обновляет и балансы. */
export function useBalances(companyId: number) {
  return useQuery<Balances, ApiError>({
    queryKey: ['accounts', companyId, 'balances'],
    queryFn: () => api<Balances>(`/companies/${companyId}/balances`),
    ...REFRESH_ON_FOCUS,
  });
}

export interface CompanySummary {
  id: number;
  name: string;
  total: CompanyTotal;
}

/** Итоги компаний для переключателя; запрашиваются при открытии меню. */
export function useCompaniesSummary(enabled: boolean) {
  return useQuery<CompanySummary[], ApiError>({
    queryKey: ['companies', 'summary'],
    queryFn: async () => (await api<{ companies: CompanySummary[] }>('/companies/summary')).companies,
    enabled,
    ...REFRESH_ON_FOCUS,
  });
}

export interface ManualRate {
  id: number;
  date: string;
  currency: string;
  /** Курс за 1 единицу валюты в тенге, десятичная строка с точкой. */
  rateToKzt: string;
  /** Экран получает только ручные курсы. */
  source: 'manual';
  createdBy: number | null;
  fetchedAt: string;
}

export function useManualRates() {
  return useQuery<ManualRate[], ApiError>({
    queryKey: ['rates-manual'],
    queryFn: async () => (await api<{ rates: ManualRate[] }>('/rates/manual')).rates,
  });
}

export interface FixedRate {
  id: number;
  companyId: number;
  currency: string;
  /** Курс к базовой валюте компании, десятичная строка с точкой. */
  rate: string;
  validFrom: string;
  validTo: string | null;
}

export function useFixedRates(companyId: number) {
  return useQuery<FixedRate[], ApiError>({
    queryKey: ['fixed-rates', companyId],
    queryFn: async () => (await api<{ fixedRates: FixedRate[] }>(`/companies/${companyId}/fixed-rates`)).fixedRates,
  });
}

export interface CategoryNode {
  id: number;
  companyId: number;
  kind: 'income' | 'expense';
  parentId: number | null;
  name: string;
  systemKey: string | null;
  effectiveSystemKey: string | null;
  templateRef: string | null;
  orderIndex: number;
  archivedAt: string | null;
  children: CategoryNode[];
}

export interface CategoryTree {
  income: CategoryNode[];
  expense: CategoryNode[];
}

export function useCategories(companyId: number) {
  return useQuery<CategoryTree, ApiError>({
    queryKey: ['categories', companyId],
    queryFn: () => api<CategoryTree>(`/companies/${companyId}/categories`),
  });
}

export interface Counterparty {
  id: number;
  companyId: number;
  type: CounterpartyType;
  name: string;
  comment: string | null;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useCounterparties(companyId: number) {
  return useQuery<Counterparty[], ApiError>({
    queryKey: ['counterparties', companyId],
    queryFn: async () => (await api<{ counterparties: Counterparty[] }>(`/companies/${companyId}/counterparties`)).counterparties,
  });
}

export interface Tag {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useTags(companyId: number) {
  return useQuery<Tag[], ApiError>({
    queryKey: ['tags', companyId],
    queryFn: async () => (await api<{ tags: Tag[] }>(`/companies/${companyId}/tags`)).tags,
  });
}

export interface SplitLine {
  categoryId: number | null;
  projectId: number | null;
  /** Сотые доли процента, 10000 = 100%. */
  bp: number;
}

export interface SplitPreset {
  id: number;
  companyId: number;
  name: string;
  lines: SplitLine[];
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export function useSplitPresets(companyId: number) {
  return useQuery<SplitPreset[], ApiError>({
    queryKey: ['split-presets', companyId],
    queryFn: async () => (await api<{ splitPresets: SplitPreset[] }>(`/companies/${companyId}/split-presets`)).splitPresets,
  });
}

export interface AppUser {
  id: number;
  login: string;
  name: string;
  createdAt: string;
  disabledAt: string | null;
}

export function useUsers() {
  return useQuery<AppUser[], ApiError>({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: AppUser[] }>('/users')).users,
  });
}

export interface AuditEntry {
  id: number;
  companyId: number | null;
  userId: number | null;
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: string;
  diff: Record<string, unknown> | null;
  at: string;
}

interface AuditPage {
  entries: AuditEntry[];
  nextBeforeId: number | null;
}

/** Лента истории: companyId — события компании, null — системные (пользователи, входы). */
export function useAuditFeed(companyId: number | null, filters: { userId?: number; entity?: string }) {
  const base = companyId === null ? '/audit/system' : `/companies/${companyId}/audit`;
  return useInfiniteQuery<AuditPage, ApiError, InfiniteData<AuditPage, number | null>, readonly unknown[], number | null>({
    queryKey: ['audit', companyId, filters],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (pageParam !== null) p.set('beforeId', String(pageParam));
      if (filters.userId !== undefined) p.set('userId', String(filters.userId));
      if (filters.entity !== undefined) p.set('entity', filters.entity);
      const qs = p.toString();
      return api<AuditPage>(qs ? `${base}?${qs}` : base);
    },
    getNextPageParam: (last) => last.nextBeforeId,
    // при смене фильтра старая лента остаётся, но лента другой области (компания/система) не показывается
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Последние 20 действий с операциями компании — панель «История действий» (§3.4 этапа 1.5); при каждом открытии свежие. */
export function useOperationHistory(companyId: number) {
  return useQuery<AuditEntry[], ApiError>({
    queryKey: ['audit', companyId, 'operations-recent'],
    queryFn: async () => (await api<AuditPage>(`/companies/${companyId}/audit?entity=operation&limit=20`)).entries,
    refetchOnMount: 'always',
  });
}

/** Список «Импорты» панели «История действий» (§7.2 спецификации импорта): по 20, «Показать ещё»; при каждом открытии свежий. */
export function useImports(companyId: number) {
  return useInfiniteQuery<ImportListPage, ApiError, InfiniteData<ImportListPage, number | null>, readonly unknown[], number | null>({
    queryKey: ['imports', companyId],
    initialPageParam: null,
    queryFn: ({ pageParam }) => api<ImportListPage>(`/companies/${companyId}/imports?limit=20${pageParam === null ? '' : `&beforeId=${pageParam}`}`),
    getNextPageParam: (last) => last.nextBeforeId,
    refetchOnMount: 'always',
  });
}

export interface BackupStatus {
  last: { file: string; createdAt: string; size: number } | null;
  copyDir: string | null;
  lastCopyError: string | null;
}

export function useBackupStatus() {
  return useQuery<BackupStatus, ApiError>({ queryKey: ['backup-status'], queryFn: () => api<BackupStatus>('/backup/status') });
}

export function usePreferences() {
  return useQuery<Record<string, unknown>, ApiError>({
    queryKey: ['preferences'],
    queryFn: async () => (await api<{ preferences: Record<string, unknown> }>('/preferences')).preferences,
    staleTime: Infinity,
    // без повторов: при сбое CompanyGate сразу показывает запасной вариант, а не ждёт три попытки с паузами
    retry: false,
  });
}

export async function savePreference(key: string, value: unknown): Promise<void> {
  await api(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
  queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [key]: value }));
}

export interface OperationLine {
  id: number;
  position: number;
  categoryId: number | null;
  projectId: number | null;
  amount: number;
  baseAmount: number;
}

/** Элемент журнала (`GET /companies/:cid/operations`, план 5a): операция со строками, тегами, вложениями и остатками. */
export interface JournalItem {
  id: number;
  companyId: number;
  type: 'income' | 'expense' | 'transfer';
  status: 'actual' | 'planned';
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  rate: string;
  baseAmount: number;
  counterpartyId: number | null;
  comment: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  lines: OperationLine[];
  tagIds: number[];
  attachmentCount: number;
  /** Остаток счёта операции после неё (у перевода — счёта списания), по всей истории счёта. */
  balanceAfter: number | null;
  /** У перевода — остаток счёта зачисления после операции. */
  toBalanceAfter: number | null;
}

export interface JournalPageData {
  items: JournalItem[];
  nextCursor: string | null;
}

export const JOURNAL_PAGE_SIZE = 50;

/**
 * Журнал с бесконечной прокруткой. params — строка запроса фильтра (journalApiParams) или null, пока она
 * не готова (нет часового пояса). Ключ ['journal', cid, params]: сброс ['journal', cid] обновляет все фильтры.
 */
export function useJournal(companyId: number, params: string | null) {
  return useInfiniteQuery<JournalPageData, ApiError, InfiniteData<JournalPageData, string | null>, readonly unknown[], string | null>({
    queryKey: ['journal', companyId, params],
    enabled: params !== null,
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params ?? '');
      p.set('limit', String(JOURNAL_PAGE_SIZE));
      if (pageParam !== null) p.set('cursor', pageParam);
      return api<JournalPageData>(`/companies/${companyId}/operations?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    // при смене фильтра старые строки остаются на экране до ответа; журнал другой компании не показывается
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

export interface SavedFilter {
  id: number;
  companyId: number;
  name: string;
  /** Фильтр без недоступных ссылок (сервер их убирает). */
  filter: SavedJournalFilter;
  /** Сколько ссылок убрано: элемент удалён, в архиве или из другой компании (инвариант 10). */
  unavailable: number;
  /** Сохранённый JSON не разобрался: условий нет, применять нечего (план 5a). */
  invalid?: true;
  createdAt: string;
  updatedAt: string;
}

/** Личные сохранённые фильтры журнала в компании. */
export function useSavedFilters(companyId: number) {
  return useQuery<SavedFilter[], ApiError>({
    queryKey: ['saved-filters', companyId],
    queryFn: async () => (await api<{ savedFilters: SavedFilter[] }>(`/companies/${companyId}/saved-filters`)).savedFilters,
  });
}
