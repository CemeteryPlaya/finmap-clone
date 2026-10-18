import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReportColumn } from '../../shared/report-engine';
import { ALL_LABEL, PART_KIND, PART_LABEL, partText, type IndicatorPart, type IndicatorRow, type PartConfig } from '../../shared/report-indicators';
import { PNL_EXCLUDED_KEYS } from '../../shared/report-pnl';
import type { SystemKey } from '../../shared/system-categories';
import { invalidateAnalytics } from './analytics';
import { api, type ApiError } from './api';
import type { MultiOption } from './journal-filter-dialog';
import type { AuditEntry, CategoryTree } from './queries';
import { queryClient } from './query';
import { DEFAULT_REPORT_STATE, reportRange, type ReportUrlState } from './report-url';

/** Часть показателя в ответе (§8.2): действующая настройка и признак умолчания. */
export interface PartView extends PartConfig {
  isDefault: boolean;
}

export type Parts = Record<IndicatorPart, PartView>;

/** Ответ «Финансовых показателей» (§8.1). */
export interface IndicatorsData {
  columns: ReportColumn[];
  rows: IndicatorRow[];
  parts: Parts;
  meta: { from: string; to: string; step: 'month' | 'quarter'; currency: string; empty: boolean; stock: boolean; noBatch: number };
}

/** Шаг «Финансовых показателей» (§8.1): месяцы (по умолчанию) или кварталы. */
export const INDICATOR_STEP_CHOICES = [
  { value: 'month', label: 'По месяцам' },
  { value: 'quarter', label: 'По кварталам' },
] as const;

/**
 * «Финансовые показатели» (§8.1): действуют период и шаг (месяцы или кварталы); вида, разреза, процентов, склада и
 * фильтра нет — значения из адреса отбрасываются.
 */
export function indicatorsState(s: ReportUrlState): ReportUrlState {
  return {
    ...DEFAULT_REPORT_STATE,
    period: s.period,
    ...(s.from && s.to ? { from: s.from, to: s.to } : {}),
    step: s.step === 'quarter' ? 'quarter' : 'month',
  };
}

/** Параметры API: период датами и шаг. */
export function indicatorsApiParams(state: ReportUrlState, today: string): URLSearchParams {
  const range = reportRange(state, today);
  return new URLSearchParams({ from: range.from, to: range.to, step: state.step === 'quarter' ? 'quarter' : 'month' });
}

/** Ссылка «Excel» (§2.6): те же период и шаг, что у таблицы. */
export function indicatorsExcelHref(companyId: number, state: ReportUrlState, today: string): string {
  return `/api/v1/companies/${companyId}/analytics/indicators.xlsx?${indicatorsApiParams(state, today).toString()}`;
}

/** «Финансовые показатели» по строке запроса или null, пока она не готова; прежняя таблица — до ответа. */
export function useIndicators(companyId: number, params: string | null) {
  return useQuery<IndicatorsData, ApiError>({
    queryKey: ['analytics', companyId, 'indicators', params],
    enabled: params !== null,
    queryFn: () => api<IndicatorsData>(`/companies/${companyId}/analytics/indicators?${params}`),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === companyId ? prev : undefined),
  });
}

/** Изменение частей (§8.2): сохранить или вернуть умолчание; после — показатели и история перечитываются. */
export interface PartChange {
  part: IndicatorPart;
  /** null — «Вернуть по умолчанию». */
  config: PartConfig | null;
}

export function useSaveParts(companyId: number) {
  return useMutation<void, ApiError, PartChange[]>({
    mutationFn: async (changes) => {
      for (const c of changes) {
        const path = `/companies/${companyId}/analytics/indicators/parts/${c.part}`;
        await (c.config ? api(path, { method: 'PUT', body: c.config }) : api(path, { method: 'DELETE' }));
      }
    },
    onSettled: () => Promise.all([invalidateAnalytics(companyId), queryClient.invalidateQueries({ queryKey: ['audit', companyId] })]),
  });
}

/** Ключ «Все категории» в мультивыборе части. */
export const ALL_KEY = 'all';

/** Исключённые из «Прибыли» системные категории (§5.1) в части не предлагаются: они не входят никогда. */
const excluded = (key: string | null) => key !== null && PNL_EXCLUDED_KEYS.includes(key as SystemKey);

/**
 * Пункты выбора категорий части (§8.2): первым — «Все категории дохода/расхода» (отдельный выбор), затем категории вида
 * части деревом; архивные — только выбранные; подкатегория выбирается и сама, родитель включает подкатегории.
 */
export function partOptions(part: IndicatorPart, tree: CategoryTree, selected: readonly number[]): MultiOption[] {
  const nodes = tree[PART_KIND[part]].filter((n) => !excluded(n.effectiveSystemKey));
  const section = PART_KIND[part] === 'income' ? 'Категории дохода' : 'Категории расхода';
  return [
    { key: ALL_KEY, label: ALL_LABEL[part] },
    ...nodes.flatMap((n) => [
      ...(!n.archivedAt || selected.includes(n.id) ? [{ key: String(n.id), label: n.archivedAt ? `${n.name} (архив)` : n.name, section }] : []),
      ...n.children
        .filter((c) => (!c.archivedAt && !n.archivedAt) || selected.includes(c.id))
        .map((c) => ({ key: String(c.id), label: c.archivedAt || n.archivedAt ? `${c.name} (архив)` : c.name, section, nested: true })),
    ]),
  ];
}

/** Выбранные ключи части: «Все категории» или id. */
export const partSelected = (cfg: PartConfig): string[] => (cfg.allCategories ? [ALL_KEY] : cfg.categoryIds.map(String));

/** Щелчок по пункту: «Все категории» снимает список, категория снимает «Все категории». */
export function togglePart(cfg: PartConfig, key: string): PartConfig {
  if (key === ALL_KEY) return { ...cfg, allCategories: !cfg.allCategories, categoryIds: [] };
  const id = Number(key);
  const ids = cfg.categoryIds.includes(id) ? cfg.categoryIds.filter((x) => x !== id) : [...cfg.categoryIds, id];
  return { ...cfg, allCategories: false, categoryIds: ids };
}

/** Черновик отличается от сохранённой настройки: части без изменений не отправляются. */
export function partChanged(saved: PartView, draft: PartConfig): boolean {
  return (
    saved.allCategories !== draft.allCategories ||
    saved.includeStock !== draft.includeStock ||
    JSON.stringify([...saved.categoryIds].sort((a, b) => a - b)) !== JSON.stringify([...draft.categoryIds].sort((a, b) => a - b))
  );
}

/** Строка вкладки «История» (§8.2): «Действие», «Дата», «Показатель», «Категории», «Сотрудник». */
export interface HistoryRow {
  id: number;
  action: string;
  at: string;
  part: string;
  categories: string;
  user: string;
}

const isPart = (v: unknown): v is IndicatorPart => typeof v === 'string' && v in PART_LABEL;

/** Записи истории настроек показателей → строки вкладки; «Категории» — настройка после изменения. */
export function historyRows(entries: readonly AuditEntry[]): HistoryRow[] {
  return entries.flatMap((e) => {
    const d = e.diff as { part?: unknown; after?: { allCategories?: boolean; categories?: string[]; includeStock?: boolean } } | null;
    if (!d || !isPart(d.part) || !d.after) return [];
    const after = d.after;
    return [
      {
        id: e.id,
        action: e.action === 'reset' ? 'Возврат по умолчанию' : 'Изменение',
        at: e.at,
        part: PART_LABEL[d.part],
        categories: partText(d.part, { allCategories: after.allCategories === true, includeStock: after.includeStock === true }, after.categories ?? []),
        user: e.userName ?? '—',
      },
    ];
  });
}
