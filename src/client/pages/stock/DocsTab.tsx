import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { STOCK_DOC_TYPE_LABELS, STOCK_DOC_TYPES, WRITEOFF_REASON_LABELS, type StockDocType } from '../../../shared/schemas/stock';
import { DocForm, type DocFormRequest } from '../../components/stock/DocForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { useCounterparties } from '../../lib/queries';
import { useMeta } from '../../lib/query';
import { useStockDocs } from '../../lib/stock';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle';
const PAGE = 100;

const CREATE: { type: StockDocType; label: string }[] = [
  { type: 'receipt', label: '+ Поступление' },
  { type: 'sale', label: '+ Продажа' },
  { type: 'writeoff', label: '+ Списание' },
];

/**
 * «Документы» (§4.2 спецификации «Склад»): список по складу и типу — номер, тип, дата, склад, контрагент, сумма;
 * кнопки «+ Поступление», «+ Продажа», «+ Списание» открывают форму; щелчок по номеру — правка.
 */
export function DocsTab() {
  const { company, warehouse, warehouses } = useOutletContext<StockOutletContext>();
  const meta = useMeta();
  const counterparties = useCounterparties(company.id);
  const [type, setType] = useState<StockDocType | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<{ key: number; request: DocFormRequest } | null>(null);
  const docs = useStockDocs(company.id, { type, warehouse, limit });
  const readOnly = company.archivedAt !== null;

  if (!docs.data || !meta.data) return <Pending queries={[docs]} />;
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  const counterpartyName = new Map((counterparties.data ?? []).map((c) => [c.id, c.name]));
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);
  const canCreate = !readOnly && warehouses.some((w) => !w.archivedAt);
  const open = (request: DocFormRequest) => setForm((f) => ({ key: (f?.key ?? 0) + 1, request }));

  return (
    <div>
      <StaleNotice queries={[docs]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {canCreate &&
          CREATE.map((c) => (
            <button key={c.type} type="button" aria-haspopup="dialog" onClick={() => open({ kind: 'create', type: c.type, warehouse })} className={c.type === 'receipt' ? btnPrimary : btnSecondary}>
              {c.label}
            </button>
          ))}
        <select
          aria-label="Тип документов"
          value={type ?? ''}
          onChange={(e) => {
            setType(e.target.value === '' ? null : (e.target.value as StockDocType));
            setLimit(PAGE);
          }}
          className={`${inputClass} ml-auto w-auto py-2`}
        >
          <option value="">Все документы</option>
          {STOCK_DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {STOCK_DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {docs.data.docs.length === 0 ? (
        <p className="text-muted">Документов пока нет. Начните с «Поступления».</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Документы" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Номер
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Тип
                </th>
                <th scope="col" className={thClass}>
                  Дата
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Склад
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Контрагент
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.data.docs.map((d) => (
                <tr key={d.id} className="border-b border-field hover:bg-field/40">
                  <td className={tdClass}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={`Открыть ${STOCK_DOC_TYPE_LABELS[d.type as StockDocType].toLowerCase()} ${d.number}`}
                      onClick={() => open({ kind: 'edit', id: d.id })}
                      className="rounded font-medium tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {d.number}
                    </button>
                  </td>
                  <td className={`${tdClass} max-md:hidden`}>{STOCK_DOC_TYPE_LABELS[d.type as StockDocType]}</td>
                  <td className={`${tdClass} tabular-nums`}>{formatDateTime(d.at, meta.data.timezone)}</td>
                  <td className={`${tdClass} max-md:hidden`}>{warehouseName.get(d.warehouseId) ?? '…'}</td>
                  <td className={`${tdClass} max-md:hidden`}>
                    {d.type === 'writeoff' ? (d.reason ? WRITEOFF_REASON_LABELS[d.reason] : '') : d.counterpartyId === null ? '—' : (counterpartyName.get(d.counterpartyId) ?? '…')}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{d.type === 'writeoff' ? '—' : money(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {docs.data.hasMore && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={`${btnSecondary} mt-4`}>
          Показать ещё
        </button>
      )}
      {form && <DocForm key={form.key} company={company} request={form.request} onClose={() => setForm(null)} />}
    </div>
  );
}
