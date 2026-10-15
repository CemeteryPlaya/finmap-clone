import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { useUnpaid } from '../../lib/stock';
import {
  distributedText,
  unpaidDocText,
  withAmount,
  withDoc,
  withoutDoc,
  type PaymentDraft,
} from '../../lib/stock-payments';
import { inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * «Оплата закупки» в расходе (§6.1 спецификации «Склад»): неоплаченные поступления выбранного поставщика — номер, дата,
 * сумма, долг. Можно отметить один или несколько и указать сумму к каждому; по умолчанию — долг, но не больше остатка суммы
 * расхода. Поля нет, пока нет поставщика с долгами (и нечего снимать). `operationId` — расход, который правят: его
 * собственные оплаты остаются в списке, даже если документ оплачен полностью.
 */
export function StockPaymentsField(props: {
  companyId: number;
  supplierId: number;
  operationId: number | null;
  currency: string;
  timeZone: string;
  payments: PaymentDraft[];
  /** Сумма расхода, минимальные единицы; null — ещё не введена. */
  amount: number | null;
  /** Первая отмеченная оплата при пустой сумме расхода подставляет её сама. */
  onAmount: (text: string) => void;
  onChange: (payments: PaymentDraft[]) => void;
  error?: string;
}) {
  const unpaid = useUnpaid(props.companyId, props.supplierId, props.operationId);
  const mu = getCurrency(props.currency).minorUnits;
  const docs = unpaid.data?.docs ?? [];
  // отмеченные документы, которых больше нет в списке (удалены), не показываются
  const shown = new Set(docs.map((d) => d.docId));
  if (docs.length === 0) return null;

  return (
    <fieldset className="grid gap-3 rounded-xl border border-field p-3">
      <legend className="px-1 text-sm font-semibold">Оплата закупки</legend>
      {docs.map((d) => {
        const row = props.payments.find((p) => p.docId === d.docId);
        const label = unpaidDocText(d, formatDateRu(todayInTimezone(props.timeZone, new Date(d.at))), props.currency);
        return (
          <div key={d.docId} className="grid gap-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={row !== undefined}
                onChange={(e) => {
                  if (!e.target.checked) {
                    props.onChange(withoutDoc(props.payments, d.docId));
                    return;
                  }
                  const next = withDoc(props.payments, d, props.amount, mu);
                  props.onChange(next);
                  const added = next.find((p) => p.docId === d.docId);
                  if (props.amount === null && added && added.amount !== '') props.onAmount(added.amount);
                }}
                className="mt-0.5 size-[18px] shrink-0 accent-income"
              />
              <span>{label}</span>
            </label>
            {row && (
              <NumberInput
                aria-label={`Оплата по ${d.number}`}
                value={row.amount}
                onChange={(t) => props.onChange(withAmount(props.payments, d.docId, t))}
                className={`${inputClass} ml-7 w-auto max-w-[calc(100%-1.75rem)]`}
              />
            )}
          </div>
        );
      })}
      <p className="text-sm text-muted">
        {distributedText(props.payments.filter((p) => shown.has(p.docId)), props.amount, props.currency)}
      </p>
      {props.error && (
        <p role="alert" className="text-sm text-expense-strong">
          {props.error}
        </p>
      )}
    </fieldset>
  );
}
