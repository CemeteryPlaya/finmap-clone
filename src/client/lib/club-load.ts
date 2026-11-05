import type { HourCell, ZoneStats } from '../../shared/club-analytics/load';
import type { ReportColumn, ReportStep } from '../../shared/report-engine';
import type { ClubCoverage, ClubReportBase } from './club-analytics';
import { WEEKDAYS } from './club-revenue';
import { marginText } from './stock-analytics';

/** Строка таблицы зон (§6.3); последняя — «Все зоны» (`id: 'all'`). */
export interface ZoneRowView extends ZoneStats {
  id: string;
  label: string;
  seats: number;
  load: number | null;
}

/** Места в расчёте (§6.1): итог, по зонам, подсказка или null. */
export interface SeatsView {
  total: number;
  zones: { label: string; seats: number }[];
  note: string | null;
}

/** Ответ `GET …/club-analytics/load` (§6, §11). */
export interface LoadView extends ClubReportBase {
  columns: ReportColumn[];
  series: { id: string; label: string; values: (number | null)[] }[];
  total: number | null;
  prevTotal: number | null;
  heatmap: (number | null)[][];
  idle: HourCell[];
  zones: ZoneRowView[];
  seats: SeatsView;
  coverage: ClubCoverage & { partial: number };
  prevCoverage: { days: number; withData: number } | null;
  freshness: string | null;
  meta: { from: string; to: string; step: ReportStep; by: string; empty: boolean; noZones: boolean };
}

/** Загрузка: «42,5 %»; нет данных — «нет данных». */
export function loadText(v: number | null): string {
  return v === null ? 'нет данных' : marginText(Math.round(v * 10_000));
}

/** «В расчёте: 40 ПК (Общий зал 30, VIP 10)» (§6.1). */
export function seatsLine(seats: SeatsView): string {
  const zones = seats.zones.map((z) => `${z.label} ${z.seats}`).join(', ');
  return `В расчёте: ${seats.total} ПК${zones ? ` (${zones})` : ''}`;
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Час недели: «Пт 20:00–21:00 — 94 %» (§4 «Часы пик», §6.3 «Часы простоя»). */
export function hourLabel(cell: HourCell): string {
  return `${WEEKDAYS[cell.weekday]} ${hh(cell.hour)}–${hh(cell.hour + 1)} — ${loadText(cell.value)}`;
}

/** Длительность сеанса: «1 ч 25 мин», «30 мин», «2 ч»; нет — «—». */
export function durationText(sec: number | null): string {
  if (sec === null) return '—';
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ч` : '', m || !h ? `${m} мин` : ''].filter(Boolean).join(' ');
}
