import type { ReportData } from '../../lib/analytics';
import { columnHint, moneyText, percentText, ROW_HELP, rowLabel, tableLines, type LineTone, type TableLine } from '../../lib/report-table';
import { HelpButton } from '../HelpButton';
import { ChevronIcon } from '../icons';

/** Фон строки и закреплённой первой колонки: у закреплённой ячейки фон непрозрачный, иначе под ней видны прокрученные. */
const ROW_BG: Record<LineTone, string> = { balance: 'bg-field', total: 'bg-field', group: 'bg-card', plain: 'bg-card', muted: 'bg-card' };
const LABEL_TEXT: Record<LineTone, string> = { balance: 'font-semibold', total: 'font-semibold', group: 'font-bold', plain: 'font-normal', muted: 'text-sm font-normal text-muted' };

function Amount(props: { value: number | null; currency: string; percent: string | null }) {
  if (props.value === null) return null;
  return (
    <>
      <span className={`block ${props.value < 0 ? 'text-expense-strong' : ''}`}>{moneyText(props.value, props.currency)}</span>
      {props.percent && <span className="block text-xs text-muted">{props.percent}</span>}
    </>
  );
}

/**
 * Таблица отчёта (§2.2, §4.1 спецификации «Аналитика»): «Название», колонки шага, «Итого». Первая колонка закреплена,
 * остальные прокручиваются по горизонтали внутри блока; отрицательные суммы — красным; суммы — в базовой валюте.
 * Строки с детьми раскрываются кнопкой с aria-expanded; у неоперационных строк — «?» с пояснением.
 */
export function ReportTable(props: {
  caption: string;
  data: ReportData;
  percent: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (rowId: string) => void;
  busy: boolean;
}) {
  const { columns, meta } = props.data;
  const lines = tableLines(props.data.rows, props.expanded);
  const cellClass = 'px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums';
  const renderLabel = (line: TableLine) => {
    const label = rowLabel(line.row);
    const help = ROW_HELP[line.row.id];
    return (
      <span className="flex items-center gap-1.5" style={{ paddingLeft: `${line.depth * 1.25}rem` }}>
        {line.expandable ? (
          <button
            type="button"
            aria-expanded={line.expanded}
            onClick={() => props.onToggle(line.row.id)}
            className="inline-flex items-center gap-1 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {label}
            <ChevronIcon up={line.expanded} />
          </button>
        ) : (
          <span>{label}</span>
        )}
        {help && <HelpButton about={line.row.label} text={help} />}
      </span>
    );
  };
  return (
    // блок прокручивается сам: страница на телефоне не уезжает вбок; Tab на блоке — прокрутка стрелками
    <div role="region" aria-label={`${props.caption}: таблица`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
      <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-card px-3 text-left text-xs font-semibold text-muted max-md:min-w-40">
              Название
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={columnHint(c)} className="px-3 text-right text-xs font-semibold whitespace-nowrap text-muted">
                {c.label}
              </th>
            ))}
            <th scope="col" className="px-3 text-right text-xs font-semibold text-muted">
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const { row } = line;
            if (row.id === 'balance:hidden') {
              return (
                <tr key={row.id} className="border-b border-field bg-field">
                  <td colSpan={columns.length + 2} className="sticky left-0 px-3 py-3 text-sm text-muted">
                    {row.label}
                  </td>
                </tr>
              );
            }
            const bg = ROW_BG[line.tone];
            return (
              <tr key={row.id} data-row={row.id} className={`border-b border-field ${bg}`}>
                <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left align-middle ${bg} ${LABEL_TEXT[line.tone]}`}>
                  {renderLabel(line)}
                  {row.note && <span className="mt-0.5 block text-xs font-normal text-expense-strong">{row.note}</span>}
                </th>
                {row.values.map((v, i) => (
                  <td key={columns[i]!.key} className={`${cellClass} ${line.tone === 'group' ? 'font-bold' : ''}`}>
                    <Amount value={v} currency={meta.currency} percent={props.percent ? percentText(line, i) : null} />
                  </td>
                ))}
                <td className={`${cellClass} font-semibold`}>
                  <Amount value={row.total} currency={meta.currency} percent={props.percent ? percentText(line, null) : null} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
