import { Fragment, useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { unitPrice } from '../../../shared/stock-qty';
import { Pending, StaleNotice } from '../../components/QueryState';
import { inputClass } from '../../components/ui';
import { useMeta } from '../../lib/query';
import { useCounterparties } from '../../lib/queries';
import { useStockBalance, useStockGroups, useStockItems } from '../../lib/stock';
import { balanceSections, markupText, qtyWithUnit } from '../../lib/stock-view';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle tabular-nums';
const flagClass = 'ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium';

/**
 * «Остатки» (§4.1 спецификации «Склад»): товар, остаток, себестоимость остатка, средняя цена закупки, цена продажи,
 * наценка; «Мало» ниже минимального остатка, «Нет партии: N с даты» — продано без партии (остаток меньше нуля) с подсказкой,
 * как это закрыть; раскрытая строка показывает партии с датой, количеством, ценой закупки и поставщиком. Итог — стоимость
 * склада. Склад выбран всегда (по умолчанию первый), поэтому запрос остатков ограничен одним складом.
 */
export function BalanceTab() {
  const { company, warehouse } = useOutletContext<StockOutletContext>();
  const balance = useStockBalance(company.id, warehouse);
  const items = useStockItems(company.id);
  const groups = useStockGroups(company.id);
  const counterparties = useCounterparties(company.id);
  const meta = useMeta();
  const [query, setQuery] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  if (!balance.data || !items.data || !groups.data || !meta.data) return <Pending queries={[balance, items, groups]} />;
  const tz = meta.data.timezone;
  const unitOf = new Map(items.data.map((i) => [i.id, i.unit]));
  const supplier = new Map((counterparties.data ?? []).map((c) => [c.id, c.name]));
  const sections = balanceSections(balance.data.items, items.data, groups.data, { showEmpty, query });
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <StaleNotice queries={[balance, items, groups]} />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <input type="search" aria-label="Поиск товара" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} max-w-xs`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} className="size-[18px] accent-income" />
          Показывать товары без остатка
        </label>
        <p className="ml-auto text-sm text-muted">
          Стоимость склада: <strong className="text-lg text-ink tabular-nums">{formatMoney(balance.data.total, company.baseCurrency, MONEY_SCREEN_BEFORE)}</strong>
        </p>
      </div>
      {sections.length === 0 ? (
        <p className="text-muted">{items.data.length === 0 ? 'Товаров пока нет — добавьте их во вкладке «Товары».' : 'Остатков нет. Оформите «Поступление» во вкладке «Документы».'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Остатки" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Товар
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Остаток
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Себестоимость
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Закупка, средняя
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Цена продажи
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Наценка
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.key} aria-label={s.title}>
                <tr>
                  <th scope="rowgroup" colSpan={6} className="bg-field/60 px-3 py-1.5 text-left text-xs font-semibold text-muted">
                    {s.title}
                  </th>
                </tr>
                {s.rows.map(({ item, balance: b }) => {
                  const expanded = open.has(item.id);
                  const canOpen = b.batches.length > 0;
                  return (
                    <Fragment key={item.id}>
                      <tr className={`border-b border-field ${item.archivedAt ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-2 align-middle">
                          {canOpen ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`Партии: ${item.name}`}
                              onClick={() => toggle(item.id)}
                              className="rounded text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                            >
                              <span aria-hidden="true" className="mr-1 inline-block w-3 text-muted">
                                {expanded ? '▾' : '▸'}
                              </span>
                              {item.name}
                            </button>
                          ) : (
                            <span className="font-medium">{item.name}</span>
                          )}
                          {b.low && <span className={`${flagClass} bg-field text-ink`}>Мало</span>}
                          {b.deficit > 0 && (
                            <span className={`${flagClass} bg-expense-soft text-expense-strong`}>
                              Нет партии: {qtyWithUnit(b.deficit, item.unit)}
                              {b.deficitAt ? ` с ${formatDateRu(todayInTimezone(tz, new Date(b.deficitAt)))}` : ''}
                            </span>
                          )}
                          {b.deficit > 0 && <p className="mt-1 text-xs text-muted">Поставьте поступление датой не позже продажи или заведите начальные остатки</p>}
                        </td>
                        <td className={`${tdClass} text-right ${b.qty < 0 ? 'text-expense-strong' : ''}`}>{qtyWithUnit(b.qty, item.unit)}</td>
                        <td className={`${tdClass} text-right`}>{money(b.cost)}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{b.avgCost === null ? '—' : money(b.avgCost)}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{b.salePrice > 0 ? money(b.salePrice) : '—'}</td>
                        <td className={`${tdClass} text-right max-md:hidden`}>{markupText(b.markupBp)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-field bg-field/30">
                          <td colSpan={6} className="px-3 py-2">
                            <table aria-label={`Партии: ${item.name}`} className="w-full text-sm">
                              <thead>
                                <tr>
                                  <th scope="col" className={thClass}>
                                    Дата
                                  </th>
                                  <th scope="col" className={thClass}>
                                    Документ
                                  </th>
                                  <th scope="col" className={`${thClass} max-md:hidden`}>
                                    Поставщик
                                  </th>
                                  <th scope="col" className={`${thClass} text-right`}>
                                    Осталось
                                  </th>
                                  <th scope="col" className={`${thClass} text-right`}>
                                    Цена закупки
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {b.batches.map((batch) => (
                                  <tr key={batch.lineId}>
                                    <td className={tdClass}>{formatDateRu(todayInTimezone(tz, new Date(batch.at)))}</td>
                                    <td className={tdClass}>{batch.docNumber}</td>
                                    <td className={`${tdClass} max-md:hidden`}>{batch.counterpartyId === null ? '—' : (supplier.get(batch.counterpartyId) ?? '…')}</td>
                                    <td className={`${tdClass} text-right`}>
                                      {qtyWithUnit(batch.qtyLeft, unitOf.get(item.id) ?? item.unit)}
                                      {batch.qtyLeft !== batch.qtyIn && <span className="text-muted"> из {qtyWithUnit(batch.qtyIn, item.unit)}</span>}
                                    </td>
                                    <td className={`${tdClass} text-right`}>{money(unitPrice(batch.costIn, batch.qtyIn))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
