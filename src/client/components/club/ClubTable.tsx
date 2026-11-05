import { Link } from 'react-router';
import { delta } from '../../../shared/club-analytics/delta';
import type { ReportColumn } from '../../../shared/report-engine';
import { clubMoney, countCell, missingText, revenueCellRow, shiftHref, type RevenueRowView, type RevenueView } from '../../lib/club-revenue';
import { HelpButton } from '../HelpButton';

/** Подсказка строки «Справочно: разница» (§5.1). */
export const DIFF_HELP = 'Деньги в кассу и выручка расходятся на остаток балансов гостей: пополнили, но ещё не потратили, или потратили пополненное раньше.';

const cellClass = 'px-3 py-2 text-right align-top whitespace-nowrap tabular-nums';

/** Значение ячейки: деньги или число смен; нет данных — серым. */
function Value(props: { value: number | null; count?: boolean }) {
  if (props.value === null) return <span className="text-xs text-muted">нет данных</span>;
  const text = props.count ? String(props.value) : clubMoney(props.value);
  return <span className={props.value < 0 ? 'text-expense-strong' : ''}>{text}</span>;
}

/** Δ под итогом (§2.2): зелёным рост, красным падение; прошлого нет — «—». */
function DeltaMark(props: { row: RevenueRowView; approx: boolean }) {
  const d = delta(props.row.total, props.row.prevTotal, 'sum', props.approx);
  if (!d) return <span className="block text-xs text-muted">—</span>;
  const tone = d.tone === 'up' ? 'text-income-strong' : d.tone === 'down' ? 'text-expense-strong' : 'text-muted';
  return (
    <span className={`block text-xs ${tone}`} title={props.approx ? 'данные не за все дни' : undefined}>
      {d.text}
    </span>
  );
}

/** Подпись строки: смена — ссылка в «Сверку», «разница» — с подсказкой. */
function RowLabel(props: { row: RevenueRowView; companyId: number }) {
  const { row } = props;
  const id = row.id.startsWith('shift:') ? Number(row.id.slice(6)) : null;
  if (id !== null && row.day) {
    return (
      <Link to={shiftHref(props.companyId, id, row.day)} className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        {row.label}
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {row.label}
      {row.id === 'diff' && <HelpButton about={row.label} text={DIFF_HELP} />}
    </span>
  );
}

/**
 * Таблица «Выручки клуба» (§5.1–§5.2): первая колонка закреплена; у разрезов по колонкам шага — «Итого» справа и Δ под
 * ним, в заголовке колонки с днями без данных — «данные не за все дни (N из M)». Справочные строки — курсивом. Ячейки
 * частей выручки и справочных строк (кроме разницы) — кнопки: под таблицей открываются строки Senet.
 */
export function ClubTable(props: {
  title: string;
  data: RevenueView;
  companyId: number;
  compare: boolean;
  approx: boolean;
  busy: boolean;
  active: { row: string; col: string } | null;
  onCell: (row: RevenueRowView, col: ReportColumn | null) => void;
}) {
  const { data } = props;
  const byStep = data.meta.by === 'parts' || data.meta.by === 'payment';
  const cell = (row: RevenueRowView, value: number | null, col: ReportColumn | null, index: number) => {
    const shown = <Value value={value} count={countCell(data.meta.by, index)} />;
    if (!byStep || !revenueCellRow(row.id) || value === null) return shown;
    const key = col?.key ?? 'total';
    const active = props.active?.row === row.id && props.active.col === key;
    return (
      <button
        type="button"
        aria-pressed={active}
        disabled={props.busy}
        onClick={() => props.onCell(row, col)}
        className={`-mx-1.5 rounded-md px-1.5 py-0.5 text-right hover:bg-income-soft/60 focus-visible:outline-2 focus-visible:outline-focus ${active ? 'bg-income-soft ring-1 ring-income' : ''}`}
      >
        {shown}
      </button>
    );
  };

  return (
    <div role="region" aria-label={`${props.title}: таблица`} tabIndex={0} className="scroll-pl-56 overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus max-md:scroll-pl-36">
      <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{props.title}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-card px-3 text-left text-xs font-semibold text-muted max-md:w-36 max-md:min-w-36">
              Строка
            </th>
            {data.columns.map((c, i) => {
              const cov = byStep ? data.coverage.columns[i] : undefined;
              const note = cov ? missingText(cov.withData, cov.total) : null;
              return (
                <th key={c.key} scope="col" className="px-3 text-right text-xs font-semibold whitespace-nowrap text-muted">
                  {c.label}
                  {note && <span className="block font-normal text-expense-strong">{note}</span>}
                </th>
              );
            })}
            {byStep && (
              <th scope="col" className="px-3 text-right text-xs font-semibold text-muted">
                Итого
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const info = row.kind === 'info';
            const strong = row.id === 'revenue';
            return (
              <tr key={row.id} data-row={row.id} className={`border-b border-field ${strong ? 'bg-field/60' : ''}`}>
                <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left align-top ${strong ? 'bg-field font-bold' : 'bg-card font-normal'} ${info ? 'text-muted italic' : ''}`}>
                  <RowLabel row={row} companyId={props.companyId} />
                </th>
                {row.values.map((v, i) => (
                  <td key={data.columns[i]!.key} className={`${cellClass} ${info ? 'italic' : ''} ${strong ? 'font-bold' : ''}`}>
                    {cell(row, v, data.columns[i]!, i)}
                  </td>
                ))}
                {byStep && (
                  <td className={`${cellClass} font-semibold ${info ? 'italic' : ''}`}>
                    {cell(row, row.total, null, -1)}
                    {props.compare && data.meta.by === 'parts' && <DeltaMark row={row} approx={props.approx} />}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
