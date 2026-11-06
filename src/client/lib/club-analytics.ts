import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type ApiError } from './api';
import { useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { clubSearch, parseClubSearch, type ClubUrlState, type ClubView } from './club-url';
import { pluralRu } from './journal-format';
import { useMeta } from './query';

/** Покрытие периода данными Senet из ответа отчёта клуба (§3.2–§3.3). */
export interface ClubCoverage {
  days: number;
  withData: number;
  missingDays: string[];
}

/** Подпись свежести под заголовком (§2.2): «Данные Senet на 03.11 22:05»; без забора — нет подписи. */
export function freshnessLabel(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const v = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `Данные Senet на ${v('day')}.${v('month')} ${v('hour')}:${v('minute')}`;
}

/**
 * Полоса над отчётом (§3.3): дни периода без данных Senet. Будущие дни периода («За текущий год») данных не имеют и не
 * считаются; ни одного дня с данными — пустое состояние.
 */
export function coverageNote(c: ClubCoverage, today: string): { kind: 'partial' | 'empty'; text: string } | null {
  if (c.withData === 0) return { kind: 'empty', text: 'За период нет данных Senet.' };
  const n = c.missingDays.filter((d) => d <= today).length;
  if (n === 0) return null;
  return { kind: 'partial', text: `За ${n} ${pluralRu(n, 'день', 'дня', 'дней')} периода нет данных Senet — суммы неполные.` };
}

/** Вид из адреса, которого нет у отчёта («по часам» у «Обзора»), — первый из видов отчёта. */
export function viewOf(view: ClubView, views: readonly ClubView[]): ClubView {
  return views.includes(view) ? view : views[0]!;
}

/** Что есть в ответе любого отчёта клуба (§11): покрытие периода. */
export interface ClubReportBase {
  coverage: ClubCoverage;
}

export type ClubReportKind = 'overview' | 'revenue' | 'load' | 'guests';

/** Отчёт клуба; params — параметры API (clubApiParams), null — запрос ещё нельзя строить. Прежний ответ виден до нового. */
export function useClubReport<T extends ClubReportBase>(companyId: number, report: ClubReportKind, params: string | null) {
  return useQuery<T, ApiError>({
    queryKey: ['analytics', companyId, 'club', report, params],
    enabled: params !== null,
    queryFn: () => api<T>(`/companies/${companyId}/club-analytics/${report}?${params}`),
    placeholderData: (prev, prevQuery) => (sameCompany(companyId, prevQuery) ? prev : undefined),
  });
}

/** Прежний ответ виден до нового только в той же компании: чужие цифры под новой компанией не показываются. */
export function sameCompany(companyId: number, prevQuery: { queryKey: readonly unknown[] } | undefined): boolean {
  return prevQuery?.queryKey[1] === companyId;
}

/** Настройки из адреса с видом, который есть у отчёта. */
export function clubStateOf(params: URLSearchParams, byChoices: readonly string[], views: readonly ClubView[]): ClubUrlState {
  const s = parseClubSearch(params, byChoices, views[0]);
  return { ...s, view: viewOf(s.view, views) };
}

/** Пояс приложения из /meta; пока ответа нет — null. */
export function zoneOf(meta: { timezone: string } | undefined): string | null {
  return meta?.timezone ?? null;
}

/** Сегодня в поясе приложения; пока пояс не известен (/meta не пришёл) — null. */
export function todayIn(timeZone: string | null): string | null {
  return timeZone ? todayInTimezone(timeZone) : null;
}

/** Настройки отчёта клуба из адреса, сегодняшняя дата и пояс приложения; update — в адрес без записи в истории. */
export function useClubSettings(byChoices: readonly string[], views: readonly ClubView[]) {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => clubStateOf(params, byChoices, views), [params, byChoices, views]);
  const timeZone = zoneOf(meta.data);
  const today = todayIn(timeZone);
  const update = (next: ClubUrlState) => setParams(clubSearch(next, byChoices, views[0]), { replace: true });
  return { state, today, timeZone, update };
}
