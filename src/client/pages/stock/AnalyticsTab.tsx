import { Fragment, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import type { StockItemStat } from '../../../shared/schemas/stock';
import { formatQty, UNIT_LABELS } from '../../../shared/stock-qty';
import { ExcelLink } from '../../components/analytics/ReportParts';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { PriceDynamics } from '../../components/stock/PriceDynamics';
import { useMeta } from '../../lib/query';
import { customRangeError, parseReportSearch, reportRange, reportSearch, REPORT_PERIODS, type ReportUrlState } from '../../lib/report-url';
import { useStockAnalytics, useStockGroups, useStockItems, useStockLists } from '../../lib/stock';
import { analyticsExcelHref, marginText, statSections, totalsLine } from '../../lib/stock-analytics';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle';
const STALE_DAYS = 30;

/**
 * «Аналитика» склада (§8 спецификации «Склад»): период — как у отчётов, склад — один или «Все склады» (`?warehouse=all`).
 * Таблица по товарам с группами и итогами, плашка итогов со строкой «Закуплено за период…», списки «Мало», «Без движения»,
 * «Нет партии», «Excel». Название товара открывает «Динамику цен».
 */
export function AnalyticsTab() {
  const { company, warehouse, allWarehouses } = useOutletContext<StockOutletContext>();
  const meta = useMeta();
  const [search, setSearch] = useSearchParams();
  const items = useStockItems(company.id);
  const groups = useStockGroups(company.id);
  const tz = meta.data?.timezone ?? 'Asia/Almaty';
  const today = todayInTimezone(tz);
  const state = parseReportSearch(search);
  const range = reportRange(state, today);
  const scope = allWarehouses ? null : warehouse;
  const stats = useStockAnalytics(company.id, scope, range);
  const lists = useStockLists(company.id, scope);
  const [priceItem, setPriceItem] = useState<number | null>(null);

  const changePeriod = (next: ReportUrlState) => {
    const params = reportSearch(next);
    const wh = search.get('warehouse');
    if (wh !== null) params.set('warehouse', wh);
    setSearch(params, { replace: true });
  };

  if (!stats.data || !items.data || !groups.data || !meta.data) return <Pending queries={[stats, items, groups, meta]} />;
  const money = (minor: number | null) => (minor === null ? '—' : formatMoney(minor, company.baseCurrency, MONEY_SCREEN));
  const itemById = new Map(items.data.map((i) => [i.id, i]));
  const qty = (v: number, itemId: number) => `${formatQty(v)} ${UNIT_LABELS[itemById.get(itemId)?.unit ?? 'pcs']}`;
  const sections = statSections(stats.data.rows, items.data, groups.data);
  const t = stats.data.totals;
  const name = (id: number) => itemById.get(id)?.name ?? '…';

  const cells = (r: Pick<StockItemStat, 'revenue' | 'cost' | 'profit' | 'marginBp' | 'lossCost'>, bold: boolean) => (
    <>
      <td className={`${tdClass} text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>{money(r.revenue)}</td>
      <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{money(r.cost)}</td>
      <td className={`${tdClass} text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>{money(r.profit)}</td>
      <td className={`${tdClass} text-right tabular-nums`}>{marginText(r.marginBp)}</td>
      <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{r.lossCost === 0 ? '—' : money(r.lossCost)}</td>
    </>
  );

  return (
    <div>
      <StaleNotice queries={[stats]} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodMenu state={state} today={today} periods={REPORT_PERIODS} heading="По дате документа" validate={customRangeError} onChange={changePeriod} />
        <span className="text-sm text-muted">
          {formatDateRu(range.from)} – {formatDateRu(range.to)}
        </span>
        <span className="ml-auto">
          <ExcelLink size="size-10" href={analyticsExcelHref(company.id, scope, range)} />
        </span>
      </div>

      <section aria-label="Итоги" className="mb-6 grid gap-3">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Выручка', t.revenue],
            ['Себестоимость', t.cost],
            ['Прибыль', t.profit],
            ['Списано и недостача', t.losses],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-xl bg-field px-4 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(v as number)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm">{totalsLine(t, company.baseCurrency)}</p>
      </section>

      {sections.length === 0 ? (
        <p className="text-muted">За период по складу не было движения.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Аналитика по товарам" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Товар
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Продано
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Выручка
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Себестоимость
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Прибыль
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Маржа
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Списано и недостача
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Ср. цена продажи
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Ср. цена закупки
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.key} aria-label={s.label}>
                <tr>
                  <th scope="rowgroup" colSpan={9} className="bg-field/60 px-3 py-1.5 text-left text-xs font-semibold text-muted">
                    {s.label}
                  </th>
                </tr>
                {s.rows.map((r) => (
                  <Fragment key={r.itemId}>
                    <tr className="border-b border-field hover:bg-field/40">
                      <th scope="row" className={`${tdClass} text-left font-medium`}>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-label={`Динамика цен: ${name(r.itemId)}`}
                          onClick={() => setPriceItem(r.itemId)}
                          className="rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          {name(r.itemId)}
                        </button>
                        {r.isCombo && <span className="ml-2 text-xs text-muted">комплект</span>}
                        {r.noBatchQty > 0 && <span className="ml-2 text-xs text-expense-strong">без партии: {formatQty(r.noBatchQty)}</span>}
                      </th>
                      <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{r.soldQty === 0 ? '—' : qty(r.soldQty, r.itemId)}</td>
                      {cells(r, false)}
                      <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{money(r.avgSalePrice)}</td>
                      <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{money(r.avgPurchasePrice)}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="border-b-2 border-field">
                  <th scope="row" className={`${tdClass} text-left text-muted`}>
                    Итого: {s.label}
                  </th>
                  <td className={`${tdClass} max-md:hidden`} />
                  {cells(s.total, true)}
                  <td className={`${tdClass} max-md:hidden`} />
                  <td className={`${tdClass} max-md:hidden`} />
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {lists.data ? (
          <>
            <section aria-labelledby="stock-low">
              <h2 id="stock-low" className="mb-2 font-semibold">
                Мало
              </h2>
              {lists.data.low.length === 0 ? (
                <p className="text-sm text-muted">Всё выше минимального остатка.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {lists.data.low.map((x) => (
                    <li key={x.itemId}>
                      {name(x.itemId)} — {qty(x.qty, x.itemId)} (минимум {qty(x.minQty, x.itemId)})
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="stock-stale">
              <h2 id="stock-stale" className="mb-2 font-semibold">
                Без движения {STALE_DAYS} дней
              </h2>
              {lists.data.stale.length === 0 ? (
                <p className="text-sm text-muted">Все товары с остатком продавались.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {lists.data.stale.map((x) => (
                    <li key={x.itemId}>
                      {name(x.itemId)} — {qty(x.qty, x.itemId)}
                      {x.lastMoveAt && <span className="text-muted"> · с {formatDateRu(todayInTimezone(tz, new Date(x.lastMoveAt)))}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="stock-nobatch">
              <h2 id="stock-nobatch" className="mb-2 font-semibold">
                Нет партии
              </h2>
              {lists.data.noBatch.length === 0 ? (
                <p className="text-sm text-muted">Продаж без партии нет.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {lists.data.noBatch.map((x) => (
                    <li key={x.itemId}>
                      {name(x.itemId)} — {qty(x.qty, x.itemId)}
                      <span className="text-muted"> · с {formatDateRu(todayInTimezone(tz, new Date(x.since)))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <Pending queries={[lists]} />
        )}
      </div>

      {priceItem !== null && (
        <PriceDynamics
          key={priceItem}
          companyId={company.id}
          itemId={priceItem}
          itemName={name(priceItem)}
          warehouse={scope}
          range={range}
          currency={company.baseCurrency}
          timeZone={tz}
          onClose={() => setPriceItem(null)}
        />
      )}
    </div>
  );
}
