import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { formatQty, UNIT_LABELS } from '../../../shared/stock-qty';
import { ItemEditor } from '../../components/stock/ItemEditor';
import { PriceDialog } from '../../components/stock/PriceDialog';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, inputClass, noticeClass } from '../../components/ui';
import { useMeta } from '../../lib/query';
import { useStockGroups, useStockItems, type StockItem } from '../../lib/stock';
import { filterItems, itemSections } from '../../lib/stock-view';
import { useEditedItem, type EditingId } from '../../lib/use-edited';
import type { StockOutletContext } from '../StockPage';

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-middle';

/** «Товары» (§4.3 спецификации «Склад»): каталог компании по группам, цена продажи с историей, минимальный остаток. */
export function ItemsTab() {
  const { company } = useOutletContext<StockOutletContext>();
  const items = useStockItems(company.id);
  const groups = useStockGroups(company.id);
  const meta = useMeta();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditingId>(null);
  const [pricing, setPricing] = useState<StockItem | null>(null);
  const readOnly = company.archivedAt !== null;
  const edited = useEditedItem(items.data, editing);

  if (!items.data || !groups.data) return <Pending queries={[items, groups]} />;
  const sections = itemSections(filterItems(items.data, groups.data, query), groups.data);
  const money = (minor: number) => formatMoney(minor, company.baseCurrency, MONEY_SCREEN);

  return (
    <div>
      <StaleNotice queries={[items, groups]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Поиск товара" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} max-w-xs`} />
        {!readOnly && (
          <button type="button" aria-haspopup="dialog" onClick={() => setEditing('new')} className={btnPrimary}>
            + Товар
          </button>
        )}
      </div>
      {items.data.length === 0 ? (
        <p className="text-muted">Товаров пока нет. Добавьте первый — например, «Кола 0,5».</p>
      ) : sections.length === 0 ? (
        <p className="text-muted">Ничего не найдено.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Товары" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Название
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Ед.
                </th>
                <th scope="col" className={`${thClass} max-md:hidden`}>
                  Штрихкод
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Цена продажи
                </th>
                <th scope="col" className={`${thClass} text-right max-md:hidden`}>
                  Мин. остаток
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.key} aria-label={s.title}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="bg-field/60 px-3 py-1.5 text-left text-xs font-semibold text-muted">
                    {s.title}
                  </th>
                </tr>
                {s.items.map((i) => (
                  <tr key={i.id} className={`border-b border-field hover:bg-field/40 ${i.archivedAt ? 'opacity-60' : ''}`}>
                    <td className={tdClass}>
                      <button type="button" aria-haspopup="dialog" onClick={() => setEditing(i.id)} className="rounded text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                        {i.name}
                      </button>
                      {i.archivedAt && <span className="ml-2 text-xs text-muted">в архиве</span>}
                    </td>
                    <td className={`${tdClass} max-md:hidden`}>{UNIT_LABELS[i.unit]}</td>
                    <td className={`${tdClass} max-md:hidden`}>{i.barcode ?? ''}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{i.salePrice > 0 ? money(i.salePrice) : '—'}</td>
                    <td className={`${tdClass} text-right tabular-nums max-md:hidden`}>{i.minQty === null ? '' : `${formatQty(i.minQty)} ${UNIT_LABELS[i.unit]}`}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый товар' : 'Товар'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <ItemEditor
            key={editing}
            companyId={company.id}
            baseCurrency={company.baseCurrency}
            item={edited.item}
            gone={edited.gone}
            groups={groups.data}
            readOnly={readOnly}
            onChangePrice={(item) => {
              setEditing(null);
              setPricing(item);
            }}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={pricing !== null} title={pricing ? `Цена продажи: ${pricing.name}` : 'Цена продажи'} onClose={() => setPricing(null)} className="max-w-md">
        {pricing && meta.data && (
          <PriceDialog
            key={pricing.id}
            companyId={company.id}
            baseCurrency={company.baseCurrency}
            timeZone={meta.data.timezone}
            item={items.data.find((i) => i.id === pricing.id) ?? pricing}
            onDone={() => setPricing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
