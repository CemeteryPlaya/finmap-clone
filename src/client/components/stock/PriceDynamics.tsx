import { useState } from 'react';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { useStockPrices } from '../../lib/stock';
import { marginText, priceChart } from '../../lib/stock-analytics';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import { noticeClass } from '../ui';

const W = 600;
const H = 220;
const thClass = 'px-2 py-1.5 text-left text-xs font-semibold text-muted';
const tdClass = 'px-2 py-1.5';

/**
 * «Динамика цен» товара (§8 спецификации «Склад»): график — точки закупки и ступенчатая линия цены продажи, под ним — маржа
 * по датам закупок и смен цены, история цены продажи; сверху — подсказка «Закупка выросла на N% …», если цена не менялась.
 */
export function PriceDynamics(props: {
  companyId: number;
  itemId: number;
  itemName: string;
  warehouse: number | null;
  range: { from: string; to: string };
  currency: string;
  timeZone: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const prices = useStockPrices(props.companyId, props.itemId, props.warehouse, props.range);
  const money = (minor: number) => formatMoney(minor, props.currency, MONEY_SCREEN);
  const day = (iso: string) => formatDateRu(todayInTimezone(props.timeZone, new Date(iso)));

  return (
    <Modal open={open} title={`Динамика цен: ${props.itemName}`} onClose={props.onClose} className="max-w-3xl">
      {!prices.data ? (
        <Pending queries={[prices]} />
      ) : (
        (() => {
          const p = prices.data;
          const chart = priceChart(p, props.range, props.currency, props.timeZone, W, H);
          const empty = p.purchases.length === 0 && p.salePrices.length === 0;
          return (
            <div className="grid gap-4">
              {p.hint && (
                <p role="status" className={`${noticeClass} mb-0`}>
                  {p.hint}
                </p>
              )}
              {empty ? (
                <p className="text-muted">За период нет закупок и цены продажи.</p>
              ) : (
                <figure className="grid gap-2">
                  <svg
                    viewBox={`-56 -8 ${W + 64} ${H + 16}`}
                    role="img"
                    aria-label={`Цены «${props.itemName}»: закупки — точки, цена продажи — линия`}
                    className="h-auto w-full overflow-visible text-ink"
                  >
                    {chart.ticks.map((t, i) => (
                      <g key={i}>
                        <line x1={0} x2={W} y1={t.y} y2={t.y} className="stroke-field" strokeWidth={1} />
                        <text x={-8} y={t.y + 4} textAnchor="end" className="fill-muted text-[11px]">
                          {t.label}
                        </text>
                      </g>
                    ))}
                    {/* без истории цены линии продажи нет: ноль внизу графика вводил бы в заблуждение */}
                    {p.salePrices.length > 0 && <path d={chart.salePath} fill="none" className="stroke-income" strokeWidth={2.5} />}
                    {chart.purchasePoints.map((pt) => (
                      <circle key={`${pt.x}:${pt.y}:${pt.label}`} cx={pt.x} cy={pt.y} r={5} className="fill-expense-strong">
                        <title>{pt.label}</title>
                      </circle>
                    ))}
                  </svg>
                  <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
                    <span>
                      <span aria-hidden="true" className="mr-1 inline-block size-2.5 rounded-full bg-expense-strong" />
                      Цена закупки
                    </span>
                    <span>
                      <span aria-hidden="true" className="mr-1 inline-block h-0.5 w-4 bg-income align-middle" />
                      Цена продажи
                    </span>
                  </figcaption>
                </figure>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <table aria-label="Закупки и маржа" className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-field">
                      <th scope="col" className={thClass}>
                        Дата
                      </th>
                      <th scope="col" className={`${thClass} text-right`}>
                        Закупка
                      </th>
                      <th scope="col" className={`${thClass} text-right`}>
                        Маржа
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.margins.length === 0 ? (
                      <tr>
                        <td colSpan={3} className={`${tdClass} text-muted`}>
                          За период закупок и смен цены не было
                        </td>
                      </tr>
                    ) : (
                      p.margins.map((m) => {
                        const buy = p.purchases.find((x) => x.at === m.at);
                        return (
                          <tr key={m.at} className="border-b border-field">
                            <td className={tdClass}>{day(m.at)}</td>
                            <td className={`${tdClass} text-right tabular-nums`}>{buy ? `${money(buy.unitCost)} · ${buy.docNumber}` : 'смена цены'}</td>
                            <td className={`${tdClass} text-right tabular-nums`}>{marginText(m.marginBp)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                <table aria-label="История цены продажи" className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-field">
                      <th scope="col" className={thClass}>
                        С даты
                      </th>
                      <th scope="col" className={`${thClass} text-right`}>
                        Цена продажи
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.salePrices.length === 0 ? (
                      <tr>
                        <td colSpan={2} className={`${tdClass} text-muted`}>
                          Цена продажи не задана
                        </td>
                      </tr>
                    ) : (
                      [...p.salePrices].reverse().map((s) => (
                        <tr key={s.validFrom} className="border-b border-field">
                          <td className={tdClass}>{formatDateRu(s.validFrom)}</td>
                          <td className={`${tdClass} text-right tabular-nums`}>{money(s.price)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()
      )}
    </Modal>
  );
}
