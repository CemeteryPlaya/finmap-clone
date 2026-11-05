import { clubMoney, heatColor, heatLabel, HEAT_NONE, WEEKDAYS } from '../../lib/club-revenue';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Вид «По часам» (спецификация «Аналитика клуба», §5.3): строки Пн–Вс, колонки 0–23; в ячейке — средняя выручка часа по
 * дням с данными, цветом от пустой к насыщенной. Час без данных — штриховка. Подпись ячейки для программ чтения —
 * «Пн, 20:00–21:00: 6 000 ₸»; она же — подсказка при наведении.
 */
export function HoursHeatmap(props: { title: string; map: readonly (readonly (number | null)[])[]; busy: boolean }) {
  const max = Math.max(0, ...props.map.flat().map((v) => v ?? 0));
  return (
    <figure className={props.busy ? 'opacity-60' : ''}>
      <div role="region" aria-label={`${props.title}: по часам`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
        <table aria-busy={props.busy} className="w-full min-w-max border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">{`${props.title}: средняя выручка по часам и дням недели`}</caption>
          <thead>
            <tr>
              <td />
              {HOURS.map((h) => (
                <th key={h} scope="col" className="w-9 font-normal text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((day, d) => (
              <tr key={day}>
                <th scope="row" className="pr-2 text-left font-semibold text-muted">
                  {day}
                </th>
                {HOURS.map((h) => {
                  const v = props.map[d]?.[h] ?? null;
                  const label = heatLabel(d, h, v);
                  return (
                    <td key={h} title={label} className={`h-8 rounded ${heatColor(v, max)}`}>
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Средняя выручка часа по дням с данными; максимум — {clubMoney(max)}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block size-3 rounded ${HEAT_NONE} ring-1 ring-field`} />
          нет данных
        </span>
      </figcaption>
    </figure>
  );
}
