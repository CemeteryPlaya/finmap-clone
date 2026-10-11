import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { PencilIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useFixedRates, useManualRates, type FixedRate, type ManualRate } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';
import { useEntityActions } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Курс для показа — с десятичной запятой, как его вводят. */
const showRate = (rate: string) => rate.replace('.', ',');

/** Курсы меняют «Всего на счетах» и блокировку валют: обновляем балансы всех компаний и список компаний со сводкой. */
const refreshTotals = () =>
  Promise.all([
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'accounts' && q.queryKey[2] === 'balances' }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);

const MANUAL_PAGE = 100;
const rowClass = 'flex min-h-14 items-center gap-2 border-b border-field py-2 pr-1 hover:bg-field/60';
const pencilClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';

/**
 * «Фиксированные курсы валют» (§7.4 этапа 1.5): список фиксированных курсов компании и «Добавить свой курс» →
 * окно; ниже наш блок «Ручные курсы на дату» с «Добавить курс на дату» → окно. Правка и «Удалить» — по ✎ в окне.
 */
export function RatesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">Фиксированные курсы валют</h1>
      <FixedRatesSection key={company.id} companyId={company.id} baseCurrency={company.baseCurrency} readOnly={company.archivedAt !== null} />
      <ManualRatesSection />
    </section>
  );
}

function FixedRatesSection({ companyId, baseCurrency, readOnly }: { companyId: number; baseCurrency: string; readOnly: boolean }) {
  const rates = useFixedRates(companyId);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const editingRate = typeof editing === 'number' ? (rates.data?.find((x) => x.id === editing) ?? null) : null;
  return (
    <section aria-labelledby="fixed-rates-title" className="mb-10">
      <h2 id="fixed-rates-title" className="mb-1 text-xl font-bold">
        Фиксированные курсы компании
      </h2>
      <p className="mb-4 text-sm text-muted">Курс валюты к {baseCurrency} на период. Пока он действует, курс на дату для этой компании не используется.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {!readOnly && (
        <button type="button" onClick={() => setEditing('new')} className={`${btnPrimary} mb-4`}>
          Добавить свой курс
        </button>
      )}
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          {rates.data.length === 0 ? (
            <p className="text-muted">Фиксированных курсов нет.</p>
          ) : (
            <ul aria-label="Фиксированные курсы">
              {rates.data.map((r) => (
                <li key={r.id} className={rowClass}>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rate)} {baseCurrency}
                    </span>
                    <span className="text-sm text-muted">
                      {r.validTo ? `с ${formatDateRu(r.validFrom)} по ${formatDateRu(r.validTo)}` : `с ${formatDateRu(r.validFrom)}, бессрочно`}
                    </span>
                  </span>
                  {!readOnly && (
                    <button type="button" aria-label={`Изменить курс ${r.currency}`} title="Изменить" onClick={() => setEditing(r.id)} className={pencilClass}>
                      <PencilIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый фиксированный курс' : 'Фиксированный курс'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing === 'new' && <FixedRateEditor key="new" companyId={companyId} baseCurrency={baseCurrency} rate={null} onDone={() => setEditing(null)} />}
        {typeof editing === 'number' &&
          (editingRate ? (
            <FixedRateEditor key={editing} companyId={companyId} baseCurrency={baseCurrency} rate={editingRate} onDone={() => setEditing(null)} />
          ) : (
            <p className="text-muted">Курс не найден — возможно, его удалили.</p>
          ))}
      </Modal>
    </section>
  );
}

function FixedRateEditor(props: { companyId: number; baseCurrency: string; rate: FixedRate | null; onDone: () => void }) {
  const { rate, onDone } = props;
  const base = `/companies/${props.companyId}/fixed-rates`;
  const choices = CURRENCIES.filter((c) => c.code !== props.baseCurrency);
  const [currency, setCurrency] = useState(rate?.currency ?? (props.baseCurrency === 'USD' ? 'EUR' : 'USD'));
  const [value, setValue] = useState(rate ? showRate(rate.rate) : '');
  const [validFrom, setValidFrom] = useState(rate?.validFrom ?? '');
  const [validTo, setValidTo] = useState(rate?.validTo ?? '');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['fixed-rates', props.companyId] }), refreshTotals()]);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      rate
        ? api(`${base}/${rate.id}`, { method: 'PATCH', body: { rate: value, validFrom, validTo: validTo || null } })
        : api(base, { method: 'POST', body: { currency, rate: value, validFrom, validTo: validTo || null } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(rate ? `${base}/${rate.id}` : base, refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="grid gap-4">
        {rate ? (
          <p className="text-sm text-muted">Валюта: {rate.currency}</p>
        ) : (
          <Field label="Валюта" error={fields.currency}>
            {(c) => (
              <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {choices.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label={rate ? `Курс 1 ${rate.currency}` : `Курс к ${props.baseCurrency}`} error={fields.rate}>
          {(c) => <input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Действует с" error={fields.validFrom}>
          {(c) => <input {...c} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Действует по" hint="Пусто — бессрочно" error={fields.validTo}>
          {(c) => <input {...c} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} />}
        </Field>
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {rate && <EntityActions what={`фиксированный курс ${rate.currency}`} onDelete={actions.remove} pending={actions.pending} error={actions.error} />}
    </>
  );
}

function ManualRatesSection() {
  const rates = useManualRates();
  const [chosenFilter, setFilter] = useState('');
  const [shown, setShown] = useState(MANUAL_PAGE);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const editingRate = typeof editing === 'number' ? (rates.data?.find((x) => x.id === editing) ?? null) : null;
  // удалили последний курс отфильтрованной валюты — фильтр сбрасывается сам
  const filter = rates.data?.some((r) => r.currency === chosenFilter) ? chosenFilter : '';
  // новые даты сверху; при равной дате — по коду валюты
  const list = [...(rates.data ?? [])]
    .filter((r) => !filter || r.currency === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));

  return (
    <section aria-labelledby="manual-rates-title">
      <h2 id="manual-rates-title" className="mb-1 text-xl font-bold">
        Ручные курсы на дату
      </h2>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 text-sm text-muted">
        Курс к тенге на дату — общий для всех компаний. Если на дату курса нет, берётся ближайший предыдущий, не старше 7 дней. Курсы, загруженные автоматически (например, демо-набором), здесь не показываются; на такую дату ручной курс добавить нельзя.
      </p>
      <button type="button" onClick={() => setEditing('new')} className={`${btnPrimary} mb-4`}>
        Добавить курс на дату
      </button>
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          <Field label="Показать валюту" className="mb-3 w-56">
            {(c) => (
              <select
                {...c}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setShown(MANUAL_PAGE);
                }}
                className={inputClass}
              >
                <option value="">Все валюты</option>
                {[...new Set(rates.data.map((r) => r.currency))].sort().map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {list.length === 0 ? (
            <p className="text-muted">Курсов нет.</p>
          ) : (
            <ul aria-label="Ручные курсы">
              {list.slice(0, shown).map((r) => (
                <li key={r.id} className={rowClass}>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="text-muted">{formatDateRu(r.date)}</span>
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rateToKzt)} KZT
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Изменить курс ${r.currency} на ${formatDateRu(r.date)}`}
                    title="Изменить"
                    onClick={() => setEditing(r.id)}
                    className={pencilClass}
                  >
                    <PencilIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" onClick={() => setShown(shown + MANUAL_PAGE)} className={`${btnSecondary} mt-3`}>
              Показать ещё ({list.length - shown})
            </button>
          )}
        </>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый курс на дату' : 'Курс на дату'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing === 'new' && <ManualRateEditor key="new" rate={null} onDone={() => setEditing(null)} />}
        {typeof editing === 'number' &&
          (editingRate ? <ManualRateEditor key={editing} rate={editingRate} onDone={() => setEditing(null)} /> : <p className="text-muted">Курс не найден — возможно, его удалили.</p>)}
      </Modal>
    </section>
  );
}

function ManualRateEditor({ rate, onDone }: { rate: ManualRate | null; onDone: () => void }) {
  const choices = CURRENCIES.filter((c) => c.code !== 'KZT');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [value, setValue] = useState(rate ? showRate(rate.rateToKzt) : '');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rates-manual'] }), refreshTotals()]);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      rate ? api(`/rates/manual/${rate.id}`, { method: 'PATCH', body: { rate: value } }) : api('/rates/manual', { method: 'POST', body: { date, currency, rate: value } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(rate ? `/rates/manual/${rate.id}` : '/rates/manual', refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="grid gap-4">
        {rate ? (
          <p className="text-sm text-muted">
            {formatDateRu(rate.date)}, {rate.currency}
          </p>
        ) : (
          <>
            <Field label="Дата" error={fields.date}>
              {(c) => <input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Валюта" error={fields.currency}>
              {(c) => (
                <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                  {choices.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.code} — {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Курс к тенге" error={fields.rate}>
          {(c) => <input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />}
        </Field>
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {rate && <EntityActions what={`курс ${rate.currency} на ${formatDateRu(rate.date)}`} onDelete={actions.remove} pending={actions.pending} error={actions.error} />}
    </>
  );
}
