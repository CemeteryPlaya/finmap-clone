import { useState } from 'react';
import { daysLeftText, qtyText, sortBar, type BarRowView, type BarSortKey, type BarView } from '../../lib/club-bar';
import { shareText } from '../../lib/club-guests';
import { clubMoney } from '../../lib/club-revenue';
import { LOW_DAYS } from '../../../shared/club-analytics/bar';

const cell = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';

/** Колонки таблицы «Бара» (§8.1); `items` — только у товаров. */
const COLUMNS: { key: BarSortKey; label: string; text: boolean; items?: true }[] = [
  { key: 'category', label: 'Категория', text: true, items: true },
  { key: 'soldQty', label: 'Продано, шт', text: false },
  { key: 'revenue', label: 'Выручка', text: false },
  { key: 'cost', label: 'Себестоимость', text: false },
  { key: 'profit', label: 'Прибыль', text: false },
  { key: 'margin', label: 'Маржа', text: false },
  { key: 'writeOffQty', label: 'Списано, шт', text: false },
  { key: 'stockQty', label: 'Остаток', text: false, items: true },
  { key: 'daysLeft', label: 'Хватит на, дн', text: false, items: true },
  { key: 'abc', label: 'ABC', text: true },
];

const money = (v: number | null) => (v === null ? '—' : clubMoney(v));
const share = (v: number | null) => (v === null ? '—' : shareText(v));

/** Ячейки строки после первой колонки. */
function Cells(props: { r: BarRowView; items: boolean }) {
  const { r } = props;
  const low = r.daysLeft !== null && r.daysLeft < LOW_DAYS;
  return (
    <>
      {props.items && <td className="px-3 py-2 whitespace-nowrap text-muted">{r.category}</td>}
      <td className={cell}>{qtyText(r.soldQty)}</td>
      <td className={cell}>{clubMoney(r.revenue)}</td>
      <td className={`${cell} ${r.cost === null ? 'text-muted' : ''}`}>{r.cost === null ? 'нет цены прихода' : clubMoney(r.cost)}</td>
      <td className={cell}>{money(r.profit)}</td>
      <td className={cell}>{share(r.margin)}</td>
      <td className={cell}>{qtyText(r.writeOffQty)}</td>
      {props.items && <td className={cell}>{r.stockQty === null ? '—' : qtyText(r.stockQty)}</td>}
      {props.items && <td className={`${cell} ${low ? 'font-semibold text-expense-strong' : ''}`}>{daysLeftText(r.daysLeft)}</td>}
      <td className="px-3 py-2 text-center font-semibold">{r.abc}</td>
    </>
  );
}

/**
 * Таблица товаров или категорий «Бара» (спецификация «Аналитика клуба», §8.1, R38–R39): сортировка — кнопкой в заголовке;
 * товар — кнопка, открывающая его продажи под таблицей; строка «Итого».
 */
export function BarTable(props: { title: string; data: Pick<BarView, 'rows' | 'total'>; by: 'items' | 'categories'; busy: boolean; open: string | null; onOpen: (item: string) => void }) {
  const [sort, setSort] = useState<{ key: BarSortKey; dir: 'asc' | 'desc' }>({ key: 'revenue', dir: 'desc' });
  const items = props.by === 'items';
  const columns = COLUMNS.filter((c) => items || !c.items);
  const rows = sortBar(props.data.rows, sort.key, sort.dir);
  const toggle = (key: BarSortKey, text: boolean) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: text ? 'asc' : 'desc' }));
  const t = props.data.total;
  const head = [{ key: 'key' as const, label: items ? 'Товар' : 'Категория', text: true }, ...columns];
  if (props.data.rows.length === 0) return <p className="text-sm text-muted">За период продаж бара нет</p>;
  return (
    <div role="region" aria-label={`${props.title}: ${items ? 'товары' : 'категории'}`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
      <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{`${props.title}: ${items ? 'товары' : 'категории'}`}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {head.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`px-3 text-xs font-semibold text-muted ${c.text ? 'text-left' : 'text-right'} ${i === 0 ? 'sticky left-0 z-10 min-w-44 bg-card' : ''}`}
              >
                <button type="button" onClick={() => toggle(c.key, c.text)} className="rounded-md px-1 hover:bg-field focus-visible:outline-2 focus-visible:outline-focus">
                  {c.label}
                  {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-field ${props.open === r.key ? 'bg-income-soft' : ''}`}>
              <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                {items ? (
                  <button type="button" aria-expanded={props.open === r.key} onClick={() => props.onOpen(r.key)} className="text-left underline focus-visible:outline-2 focus-visible:outline-focus">
                    {r.key}
                  </button>
                ) : (
                  r.key
                )}
              </th>
              <Cells r={r} items={items} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left">
              Итого
            </th>
            {items && <td />}
            <td className={cell}>{qtyText(t.soldQty)}</td>
            <td className={cell}>{clubMoney(t.revenue)}</td>
            <td className={cell}>{money(t.cost)}</td>
            <td className={cell}>{money(t.profit)}</td>
            <td className={cell}>{share(t.margin)}</td>
            <td className={cell}>{qtyText(t.writeOffQty)}</td>
            {items && <td />}
            {items && <td />}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
