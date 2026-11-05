import { heatColor, heatLabel, HEAT_NONE, WEEKDAYS } from '../../lib/club-revenue';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Карта «день недели × час» (спецификация «Аналитика клуба», §5.3, §6.3): строки Пн–Вс, колонки 0–23; в ячейке — среднее
 * часа, цветом от пустой к насыщенной; час без данных — штриховка. Значение — своим форматом (деньги «Выручки», проценты
 * «Загрузки»). Подпись ячейки для программ чтения — «Пн, 20:00–21:00: 6 000 ₸»; она же — подсказка при наведении. С
 * `onCell` ячейки с данными — кнопки: под картой открываются строки Senet часа.
 */
export function HoursHeatmap(props: {
  title: string;
  map: readonly (readonly (number | null)[])[];
  busy: boolean;
  format: (v: number) => string;
  /** Что в ячейке — подпись под картой и в caption таблицы. */
  caption: string;
  onCell?: (weekday: number, hour: number) => void;
  active?: { weekday: number; hour: number } | null;
}) {
  const max = Math.max(0, ...props.map.flat().map((v) => v ?? 0));
  const cell = (d: number, h: number) => {
    const v = props.map[d]?.[h] ?? null;
    const label = heatLabel(d, h, v, props.format);
    const color = `h-8 rounded ${heatColor(v, max)}`;
    if (!props.onCell || v === null) {
      return (
        <td key={h} title={label} className={color}>
          <span className="sr-only">{label}</span>
        </td>
      );
    }
    const on = props.active?.weekday === d && props.active.hour === h;
    return (
      <td key={h} className="p-0">
        <button
          type="button"
          title={label}
          aria-pressed={on}
          disabled={props.busy}
          onClick={() => props.onCell!(d, h)}
          className={`block w-full ${color} focus-visible:outline-2 focus-visible:outline-focus ${on ? 'ring-2 ring-ink' : 'hover:ring-1 hover:ring-ink/40'}`}
        >
          <span className="sr-only">{label}</span>
        </button>
      </td>
    );
  };
  return (
    <figure className={props.busy ? 'opacity-60' : ''}>
      <div role="region" aria-label={`${props.title}: по часам`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
        <table aria-busy={props.busy} className="w-full min-w-[44rem] table-fixed border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">{`${props.title}: ${props.caption.toLowerCase()}`}</caption>
          <thead>
            <tr>
              <td className="w-8" />
              {HOURS.map((h) => (
                <th key={h} scope="col" className="font-normal text-muted">
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
                {HOURS.map((h) => cell(d, h))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{`${props.caption}; максимум — ${props.format(max)}`}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block size-3 rounded ${HEAT_NONE} ring-1 ring-field`} />
          нет данных
        </span>
      </figcaption>
    </figure>
  );
}
