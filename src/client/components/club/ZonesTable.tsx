import { durationText, loadText, type ZoneRowView } from '../../lib/club-load';
import { clubMoney } from '../../lib/club-revenue';

const cell = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';
const num = (v: number | null, digits: number) => (v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: digits }));

const COLUMNS = ['Мест', 'Загрузка', 'Сеансов', 'Сеансов на место в день', 'Средняя длительность', 'Часов всего', 'Списано за часы', 'Списано на место в час'];

/** Таблица зон «Загрузки» (спецификация «Аналитика клуба», §6.3): строка «Все зоны» — последней, жирно. */
export function ZonesTable(props: { title: string; zones: readonly ZoneRowView[]; busy: boolean }) {
  return (
    <div role="region" aria-label={`${props.title}: зоны`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
      <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{`${props.title}: зоны`}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            <th scope="col" className="sticky left-0 z-10 min-w-44 bg-card px-3 text-left text-xs font-semibold text-muted">
              Зона
            </th>
            {COLUMNS.map((c) => (
              <th key={c} scope="col" className="px-3 text-right text-xs font-semibold text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.zones.map((z) => {
            const all = z.id === 'all';
            return (
              <tr key={z.id} className={`border-b border-field ${all ? 'bg-field/60 font-bold' : ''}`}>
                <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left ${all ? 'bg-field' : 'bg-card font-normal'}`}>
                  {z.label}
                </th>
                <td className={cell}>{z.seats}</td>
                <td className={cell}>{loadText(z.load)}</td>
                <td className={cell}>{z.sessions}</td>
                <td className={cell}>{num(z.sessionsPerSeatDay, 1)}</td>
                <td className={cell}>{durationText(z.avgSessionSec)}</td>
                <td className={cell}>{num(z.hours, 1)}</td>
                <td className={cell}>{clubMoney(z.debited)}</td>
                <td className={cell}>{z.debitedPerSeatHour === null ? '—' : clubMoney(z.debitedPerSeatHour)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
