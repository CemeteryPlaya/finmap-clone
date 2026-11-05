import type { DayCoverage } from '../../shared/club-analytics/coverage';
import type { TileDef } from '../../shared/analytics-catalog';
import { marginText } from './stock-analytics';
import type { ClubCoverage, ClubReportBase } from './club-analytics';
import { clubMoney } from './club-revenue';

/** Плитка «Обзора» (§4): значение периода, прошлого периода и ряд по дням; `href` — хвост адреса после `/analytics/`. */
export interface OverviewTile {
  key: string;
  label: string;
  unit: TileDef['unit'];
  /** Как считать Δ (§2.2): сумма, среднее или доля. */
  kind: 'sum' | 'avg' | 'share';
  value: number | null;
  prev: number | null;
  approx: boolean;
  spark: (number | null)[];
  available: boolean;
  note: string | null;
  href: string;
}

/** Ответ `GET …/club-analytics/overview` (§4, §11). */
export interface OverviewView extends ClubReportBase {
  tiles: OverviewTile[];
  days: { day: string; revenue: number | null; coverage: DayCoverage }[];
  best: { day: string; revenue: number }[];
  worst: { day: string; revenue: number }[];
  coverage: ClubCoverage & { partial: number };
  prevCoverage: { days: number; withData: number } | null;
  freshness: string | null;
  meta: { from: string; to: string; empty: boolean };
}

/** Значение плитки: деньги — в целых тенге, доля — «42,5 %»; нет значения — пометка недоступной плитки или «нет данных». */
export function tileValueText(t: OverviewTile): string {
  if (t.value === null) return t.available ? 'нет данных' : (t.note ?? 'нет данных');
  if (t.unit === 'money') return clubMoney(t.value);
  if (t.unit === 'percent') return marginText(Math.round(t.value * 10_000));
  return String(t.value);
}

/**
 * Ссылка плитки (§4): отчёт клуба — с периодом, клубом и сравнением «Обзора» (`clubQuery`); «Прибыль» (плитки по
 * журналу) — только с периодом (`pnlQuery`): клубов у неё нет.
 */
export function overviewHref(companyId: number, href: string, clubQuery: string, pnlQuery: string): string {
  const q = href === 'pnl' ? pnlQuery : clubQuery;
  return `/c/${companyId}/analytics/${href}${q ? `?${q}` : ''}`;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** День в «Лучших и худших днях»: «пт, 6 ноя». */
export function bestWorstText(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]}`;
}

const r2 = (v: number) => Number(v.toFixed(2));

/** Мини-график плитки (§4): путь SVG в рамке 100×24, без осей; день без данных — разрыв; меньше двух дней — пусто. */
export function sparkPath(values: readonly (number | null)[]): string {
  const known = values.filter((v): v is number => v !== null);
  if (values.length < 2 || known.length === 0) return '';
  const min = Math.min(...known);
  const max = Math.max(...known);
  const y = (v: number) => (max === min ? 12 : r2(24 - ((v - min) / (max - min)) * 24));
  let path = '';
  let gap = true;
  values.forEach((v, i) => {
    if (v === null) {
      gap = true;
      return;
    }
    path += `${gap ? 'M' : 'L'}${r2((i * 100) / (values.length - 1))},${y(v)}`;
    gap = false;
  });
  return path;
}
