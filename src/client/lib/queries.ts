import { useQuery } from '@tanstack/react-query';
import { api, type ApiError } from './api';

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
