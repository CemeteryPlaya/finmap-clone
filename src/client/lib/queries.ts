import { useQuery } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import type { CounterpartyType } from '../../shared/system-categories';

export interface Company {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: string;
  archivedAt: string | null;
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
}

export function useAccounts(companyId: number) {
  return useQuery<Account[], ApiError>({
    queryKey: ['accounts', companyId],
    queryFn: async () => (await api<{ accounts: Account[] }>(`/companies/${companyId}/accounts`)).accounts,
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
