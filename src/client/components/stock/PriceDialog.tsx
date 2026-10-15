import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { api, type ApiError } from '../../lib/api';
import { parseAmountText } from '../../lib/amount-input';
import { invalidateStock, type StockItem } from '../../lib/stock';
import { priceHistoryRows } from '../../lib/stock-view';
import { DateField } from '../DateField';
import { Field } from '../Field';
import { alertClass, btnPrimary, btnSecondary, inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * «Изменить цену» (§4.3 спецификации «Склад»): новая цена продажи и дата, с которой она действует (не позже сегодня).
 * Каждая цена остаётся в истории; цена документа «Продажа» по умолчанию берётся на дату документа.
 */
export function PriceDialog(props: { companyId: number; baseCurrency: string; timeZone: string; item: StockItem; onDone: () => void }) {
  const currency = getCurrency(props.baseCurrency);
  const today = todayInTimezone(props.timeZone);
  const [price, setPrice] = useState('');
  const [validFrom, setValidFrom] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation<unknown, ApiError, { price: number; validFrom: string }>({
    mutationFn: (body) => api(`/companies/${props.companyId}/stock/items/${props.item.id}/price`, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidateStock(props.companyId);
      props.onDone();
    },
    onError: (e) => setErrors(e.fields ?? {}),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseAmountText(price, currency.minorUnits);
    if (!r.ok) {
      setErrors({ price: r.error });
      return;
    }
    setErrors({});
    save.mutate({ price: r.minor, validFrom });
  };
  const history = priceHistoryRows(props.item.prices);
  return (
    <div>
      <form noValidate onSubmit={submit} aria-label="Новая цена" className="grid gap-4">
        <p className="text-sm text-muted">
          Сейчас: <span className="font-semibold text-ink tabular-nums">{formatMoney(props.item.salePrice, props.baseCurrency, MONEY_SCREEN)}</span>
        </p>
        <Field label={`Новая цена, ${currency.symbol}`} error={errors.price}>
          {(c) => <NumberInput {...c} value={price} onChange={(t) => (setPrice(t), setErrors({}))} className={inputClass} />}
        </Field>
        <DateField label="Действует с" value={validFrom} today={today} max={today} onChange={setValidFrom} error={errors.validFrom} />
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить цену
          </button>
          <button type="button" onClick={props.onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {history.length > 0 && (
        <section className="mt-6 border-t border-field pt-4">
          <h3 className="mb-2 text-sm font-semibold">История цены</h3>
          <table aria-label="История цены" className="w-full text-sm">
            <tbody>
              {history.map((p) => (
                <tr key={p.validFrom} className="border-b border-field">
                  <td className="py-1.5">с {formatDateRu(p.validFrom)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(p.price, props.baseCurrency, MONEY_SCREEN)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
