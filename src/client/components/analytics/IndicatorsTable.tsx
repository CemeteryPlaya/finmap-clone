import { useState, type KeyboardEvent } from 'react';
import type { ReportColumn } from '../../../shared/report-engine';
import { indicatorDef, indicatorPercentText, type IndicatorKey, type IndicatorRow } from '../../../shared/report-indicators';
import type { IndicatorsData } from '../../lib/indicators';
import { columnHint, moneyText, nextCell, type CellMove } from '../../lib/report-table';

const MOVES: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] satisfies CellMove[];

/** Цветная точка показателя (§8.1), как у Finmap: зелёная, голубая, фиолетовая, оранжевая. */
export const INDICATOR_DOT: Record<IndicatorKey, string> = { gross: 'bg-chart-3', marginal: 'bg-chart-1', ebitda: 'bg-chart-7', margin: 'bg-chart-4' };

/** Ключ ячейки: показатель и колонка (ключ колонки или `total`). */
export const indicatorCellKey = (row: string, col: string) => `${row}|${col}`;

/** Текст значения: деньги — как в отчётах, «Процент маржи» — «14%» или «—». */
export function indicatorValueText(row: IndicatorRow, v: number | null, currency: string): string {
  return indicatorDef(row.id).percent ? indicatorPercentText(v) : moneyText(v, currency);
}

/**
 * Таблица «Финансовых показателей» (§8.1): «Показатель», колонки шага и «Итого». Название показателя — кнопка окна
 * «Редактировать показатель» (в архивной компании — просто текст); значение — кнопка списка операций за колонку (§2.5).
 * Кнопки значений — одна точка Tab (стрелки, Home, End). Отрицательные — красным.
 */
export function IndicatorsTable(props: {
  data: IndicatorsData;
  busy: boolean;
  active: { row: string; col: string } | null;
  editable: boolean;
  onEdit: (row: IndicatorRow) => void;
  onCell: (row: IndicatorRow, column: ReportColumn | null) => void;
}) {
  const { columns, rows, meta } = props.data;
  const cols = [...columns.map((c) => c.key), 'total'];
  const [focused, setFocused] = useState<string | null>(null);
  const grid = rows.map(() => cols.map(() => true));
  const activeKey = props.active ? indicatorCellKey(props.active.row, props.active.col) : null;
  const keys = new Set(rows.flatMap((r) => cols.map((c) => indicatorCellKey(r.id, c))));
  const stop = [focused, activeKey].find((k) => k !== null && keys.has(k)) ?? indicatorCellKey(rows[0]?.id ?? '', cols[0]!);

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !MOVES.includes(e.key)) return;
    const key = e.target instanceof HTMLElement ? e.target.dataset.cell : undefined;
    if (key === undefined) return;
    const [rowId, col] = key.split('|');
    const from = { row: rows.findIndex((r) => r.id === rowId), col: cols.indexOf(col!) };
    if (from.row < 0 || from.col < 0) return;
    e.preventDefault();
    const to = nextCell(grid, from, e.key as CellMove);
    if (!to) return;
    e.currentTarget.querySelector<HTMLElement>(`[data-cell="${CSS.escape(indicatorCellKey(rows[to.row]!.id, cols[to.col]!))}"]`)?.focus();
  };

  const cell = (row: IndicatorRow, column: ReportColumn | null, v: number | null) => {
    const col = column?.key ?? 'total';
    const key = indicatorCellKey(row.id, col);
    const text = indicatorValueText(row, v, meta.currency);
    return (
      <button
        type="button"
        data-cell={key}
        tabIndex={key === stop ? 0 : -1}
        aria-label={`${row.label}, ${column ? columnHint(column) : 'Итого'}: ${text}`}
        aria-current={key === activeKey ? 'true' : undefined}
        aria-disabled={props.busy || undefined}
        onFocus={() => setFocused(key)}
        onClick={() => {
          setFocused(key);
          if (!props.busy) props.onCell(row, column);
        }}
        className={`-mx-1.5 rounded-md px-1.5 py-0.5 text-right hover:bg-income-soft/60 focus-visible:outline-2 focus-visible:outline-focus ${key === activeKey ? 'bg-income-soft ring-1 ring-income' : ''} ${v !== null && v < 0 ? 'text-expense-strong' : ''}`}
      >
        {text}
      </button>
    );
  };

  return (
    // блок прокручивается сам: страница на телефоне не уезжает вбок
    <div role="region" aria-label="Финансовые показатели: таблица" className="scroll-pl-56 overflow-x-auto rounded-xl max-md:scroll-pl-36">
      <table aria-busy={props.busy} onKeyDown={onKeyDown} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Финансовые показатели</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-card px-3 text-left text-xs font-semibold text-muted max-md:w-40 max-md:min-w-40">
              Показатель
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={columnHint(c)} className="px-3 text-right text-xs font-semibold whitespace-nowrap text-muted">
                {c.label}
              </th>
            ))}
            <th scope="col" className="bg-income-soft/50 px-3 text-right text-xs font-semibold whitespace-nowrap text-ink">
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-row={row.id} className="border-b border-field bg-card">
              <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left align-middle font-semibold">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${INDICATOR_DOT[row.id]}`} />
                  {props.editable ? (
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      title="Выбрать категории показателя"
                      onClick={() => props.onEdit(row)}
                      className="rounded-md text-left underline decoration-dotted underline-offset-4 hover:text-income-strong focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
                </span>
              </th>
              {columns.map((c, i) => (
                <td key={c.key} className="px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums">
                  {cell(row, c, row.values[i] ?? null)}
                </td>
              ))}
              <td className="bg-income-soft/50 px-3 py-2 text-right align-middle font-semibold whitespace-nowrap tabular-nums">{cell(row, null, row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
