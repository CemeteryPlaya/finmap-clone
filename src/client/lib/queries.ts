import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import type { CounterpartyType } from '../../shared/system-categories';
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

/** Ключ — продолжение ключа счетов: обновление ['accounts', cid] обновляет и балансы. */
export function useBalances(companyId: number) {
  return useQuery<Balances, ApiError>({
    queryKey: ['accounts', companyId, 'balances'],
    queryFn: () => api<Balances>(`/companies/${companyId}/balances`),
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
