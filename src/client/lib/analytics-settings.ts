import { useQuery } from '@tanstack/react-query';
import { TILES_MAX, type DashboardDef, type SavedDashboards, type SavedTiles, type TileDef } from '../../shared/analytics-catalog';
import { api, type ApiError } from './api';
import { queryClient } from './query';

/** Ответ `GET …/analytics-settings` (спецификация «Аналитика клуба», §10): сохранённое, сведённое с каталогом. */
export interface AnalyticsSettingsView {
  dashboards: SavedDashboards;
  groups: { key: string; title: string }[];
  tiles: Record<string, SavedTiles>;
  catalog: Record<string, { dashboards: DashboardDef[]; tiles: TileDef[] }>;
}

export type AnalyticsSettingKey = 'dashboards' | `tiles.${string}`;

const settingsKey = (companyId: number) => ['analytics-settings', companyId] as const;

export function useAnalyticsSettings(companyId: number) {
  return useQuery<AnalyticsSettingsView, ApiError>({
    queryKey: settingsKey(companyId),
    queryFn: () => api<AnalyticsSettingsView>(`/companies/${companyId}/analytics-settings`),
  });
}

/** Сохранить ключ; ответ сервера — новое состояние. Отчёты компании пересчитываются (плитки «Обзора»). */
export async function saveAnalyticsSetting(companyId: number, key: AnalyticsSettingKey, value: SavedDashboards | SavedTiles): Promise<AnalyticsSettingsView> {
  const view = await api<AnalyticsSettingsView>(`/companies/${companyId}/analytics-settings/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
  queryClient.setQueryData(settingsKey(companyId), view);
  void queryClient.invalidateQueries({ queryKey: ['analytics', companyId] });
  return view;
}

/** «Вернуть как было» (§10.1): умолчания каталога. */
export async function resetAnalyticsSetting(companyId: number, key: AnalyticsSettingKey): Promise<AnalyticsSettingsView> {
  const view = await api<AnalyticsSettingsView>(`/companies/${companyId}/analytics-settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
  queryClient.setQueryData(settingsKey(companyId), view);
  void queryClient.invalidateQueries({ queryKey: ['analytics', companyId] });
  return view;
}

/** Элемент списка на соседнее место; у края — тот же список (кнопка недоступна). */
function moved<T extends { key: string }>(list: readonly T[], key: string, dir: -1 | 1): T[] | null {
  const i = list.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

const withGroup = (d: SavedDashboards, group: string, fn: (g: SavedDashboards['groups'][number]) => SavedDashboards['groups'][number]): SavedDashboards => ({
  groups: d.groups.map((g) => (g.key === group ? fn(g) : g)),
});

export function moveCard(d: SavedDashboards, group: string, card: string, dir: -1 | 1): SavedDashboards {
  const cards = moved(d.groups.find((g) => g.key === group)?.cards ?? [], card, dir);
  return cards ? withGroup(d, group, (g) => ({ ...g, cards })) : d;
}

export function toggleCard(d: SavedDashboards, group: string, card: string): SavedDashboards {
  return withGroup(d, group, (g) => ({ ...g, cards: g.cards.map((c) => (c.key === card ? { ...c, visible: !c.visible } : c)) }));
}

export function toggleGroup(d: SavedDashboards, group: string): SavedDashboards {
  return withGroup(d, group, (g) => ({ ...g, visible: !g.visible }));
}

export function visibleTileCount(t: SavedTiles): number {
  return t.items.filter((i) => i.visible).length;
}

export function moveTile(t: SavedTiles, key: string, dir: -1 | 1): SavedTiles {
  const items = moved(t.items, key, dir);
  return items ? { items } : t;
}

/** Включить или выключить плитку; больше 12 видимых — нельзя (§10.2), тот же объект. */
export function toggleTile(t: SavedTiles, key: string): SavedTiles {
  const item = t.items.find((i) => i.key === key);
  if (!item || (!item.visible && visibleTileCount(t) >= TILES_MAX)) return t;
  return { items: t.items.map((i) => (i.key === key ? { ...i, visible: !i.visible } : i)) };
}
