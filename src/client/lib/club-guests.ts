import type { CohortRow } from '../../shared/club-analytics/guests';
import type { ReportColumn, ReportStep } from '../../shared/report-engine';
import type { ClubCoverage, ClubReportBase } from './club-analytics';
import type { OverviewTile } from './club-overview';
import { pluralRu } from './journal-format';
import { marginText } from './stock-analytics';

/** Строка «Постоянных гостей» (§7.4). */
export interface GuestRowView {
  ref: string;
  logins: string[];
  masks: string[];
  visits: number;
  visitSec: number;
  spent: number;
  refilled: number;
  firstVisit: string;
  lastVisit: string;
}

/** Ответ `GET …/club-analytics/guests` (§7, §11). */
export interface GuestsView extends ClubReportBase {
  tiles: OverviewTile[];
  columns: ReportColumn[];
  series: { id: string; label: string; values: (number | null)[] }[];
  top: GuestRowView[];
  ages: { label: string; count: number; share: number }[];
  cohorts: CohortRow[];
  unassigned: { noGuest: number; shared: number };
  firstDaysNote: string | null;
  coverage: ClubCoverage & { partial: number };
  prevCoverage: { days: number; withData: number } | null;
  freshness: string | null;
  meta: { from: string; to: string; step: ReportStep; empty: boolean };
}

export type GuestSortKey = Exclude<keyof GuestRowView, 'ref'>;

const sortValue = (r: GuestRowView, key: GuestSortKey): string | number => {
  const v = r[key];
  return Array.isArray(v) ? (v[0] ?? '') : v;
};

/** Сортировка таблицы по колонке (§7.4): логины и маски — по первому, `localeCompare('ru')`; равные — в исходном порядке. */
export function sortGuests(rows: readonly GuestRowView[], key: GuestSortKey, dir: 'asc' | 'desc'): GuestRowView[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [x, y] = [sortValue(a, key), sortValue(b, key)];
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru'));
  });
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Месяц когорты: «окт 2026». */
export function cohortMonthText(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** Доля: «33,3 %». */
export function shareText(v: number): string {
  return marginText(Math.round(v * 10_000));
}

const sessions = (n: number) => `${n} ${pluralRu(n, 'сеанс', 'сеанса', 'сеансов')}`;

/** «Без гостя: N сеансов · Общие логины: M сеансов» (§7.1, R19); нулевые части не показываются, обе нулевые — null. */
export function unassignedText(u: { noGuest: number; shared: number }): string | null {
  const parts = [u.noGuest ? `Без гостя: ${sessions(u.noGuest)}` : '', u.shared ? `Общие логины: ${sessions(u.shared)}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
