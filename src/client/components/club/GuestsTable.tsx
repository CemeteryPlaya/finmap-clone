import { useState } from 'react';
import { localParts } from '../../../shared/club-analytics/hours';
import { sortGuests, type GuestRowView, type GuestSortKey } from '../../lib/club-guests';
import { clubMoney } from '../../lib/club-revenue';

const cell = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';
const dmy = (iso: string, tz: string) => localParts(iso, tz).day.split('-').reverse().join('.');
const hours = (sec: number) => (sec / 3600).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** Колонки «Постоянных гостей» (§7.4); `hint` — подсказка заголовка. */
const COLUMNS: { key: GuestSortKey; label: string; text: boolean; hint?: string }[] = [
  { key: 'logins', label: 'Логины', text: true },
  { key: 'masks', label: 'Телефоны', text: true },
  { key: 'visits', label: 'Визитов', text: false },
  { key: 'visitSec', label: 'Часов', text: false },
  { key: 'spent', label: 'Потратил', text: false, hint: 'на часы: абонементы и аренда ПК; покупки бара за кассой гостю не привязаны' },
  { key: 'refilled', label: 'Пополнил', text: false },
  { key: 'firstVisit', label: 'Первый визит', text: false },
  { key: 'lastVisit', label: 'Последний визит', text: false },
];

/**
 * «Постоянные гости» (спецификация «Аналитика клуба», §7.4): топ-50 периода по потраченному; сортировка — кнопкой в
 * заголовке колонки; логины строки — кнопка, открывающая карточку гостя.
 */
export function GuestsTable(props: { title: string; rows: readonly GuestRowView[]; busy: boolean; timeZone: string; open: string | null; onOpen: (ref: string) => void }) {
  const [sort, setSort] = useState<{ key: GuestSortKey; dir: 'asc' | 'desc' }>({ key: 'spent', dir: 'desc' });
  const rows = sortGuests(props.rows, sort.key, sort.dir);
  const toggle = (key: GuestSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: COLUMNS.find((c) => c.key === key)!.text ? 'asc' : 'desc' }));
  if (props.rows.length === 0) return <p className="text-sm text-muted">За период гостей нет</p>;
  return (
    <div role="region" aria-label={`${props.title}: постоянные гости`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
      <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{`${props.title}: постоянные гости`}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {COLUMNS.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`px-3 text-xs font-semibold text-muted ${c.text ? 'text-left' : 'text-right'} ${i === 0 ? 'sticky left-0 z-10 min-w-44 bg-card' : ''}`}
              >
                <button type="button" title={c.hint} onClick={() => toggle(c.key)} className="rounded-md px-1 hover:bg-field focus-visible:outline-2 focus-visible:outline-focus">
                  {c.label}
                  {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.ref} className={`border-b border-field ${props.open === g.ref ? 'bg-income-soft' : ''}`}>
              <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                <button type="button" aria-expanded={props.open === g.ref} onClick={() => props.onOpen(g.ref)} className="text-left underline focus-visible:outline-2 focus-visible:outline-focus">
                  {g.logins.join(', ') || g.masks.join(', ')}
                </button>
              </th>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{g.masks.join(', ') || '—'}</td>
              <td className={cell}>{g.visits}</td>
              <td className={cell}>{hours(g.visitSec)}</td>
              <td className={cell}>{clubMoney(g.spent)}</td>
              <td className={cell}>{clubMoney(g.refilled)}</td>
              <td className={cell}>{dmy(g.firstVisit, props.timeZone)}</td>
              <td className={cell}>{dmy(g.lastVisit, props.timeZone)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
