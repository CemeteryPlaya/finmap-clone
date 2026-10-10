import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useFixedRates, useManualRates } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SHARED_NOTE } from '../../lib/settings-sections';

/** Курс для показа — с десятичной запятой, как его вводят. */
const showRate = (rate: string) => rate.replace('.', ',');

/** Курсы меняют «Всего на счетах» и блокировку валют: обновляем балансы всех компаний и список компаний со сводкой. */
const refreshTotals = () =>
  Promise.all([
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'accounts' && q.queryKey[2] === 'balances' }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);

/** Ошибка без привязки к полю — общим сообщением; ошибки полей показывают сами поля. */
const generalError = (...errors: (ApiError | null)[]) => errors.find((e) => e && !e.fields) ?? null;

const MANUAL_PAGE = 100;

function FixedRatesSection({ companyId, baseCurrency, readOnly }: { companyId: number; baseCurrency: string; readOnly: boolean }) {
  const rates = useFixedRates(companyId);
  const base = `/companies/${companyId}/fixed-rates`;
  const choices = CURRENCIES.filter((c) => c.code !== baseCurrency);
  const [currency, setCurrency] = useState(baseCurrency === 'USD' ? 'EUR' : 'USD');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ rate: '', validFrom: '', validTo: '' });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['fixed-rates', companyId] }), refreshTotals()]);

  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api(base, { method: 'POST', body: { currency, rate, validFrom, validTo: validTo || null } }),
    onSuccess: async () => {
      await refresh();
      setRate('');
      setValidFrom('');
      setValidTo('');
    },
  });
  const update = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}`, { method: 'PATCH', body: { rate: edit.rate, validFrom: edit.validFrom, validTo: edit.validTo || null } }),
    onSuccess: async () => {
      await refresh();
      setEditingId(null);
    },
  });
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeletingId(null);
      await refresh();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    remove.reset();
  };
  const error = generalError(create.error, update.error, remove.error);

  return (
    <section aria-labelledby="fixed-rates-title" className="mb-10">
      <h2 id="fixed-rates-title" className="mb-1 text-xl font-bold">
        Фиксированные курсы компании
      </h2>
      <p className="mb-4 text-sm text-muted">Курс валюты к {baseCurrency} на период. Пока он действует, курс на дату для этой компании не используется.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          {rates.data.length === 0 && <p className="mb-4 text-muted">Фиксированных курсов нет.</p>}
          <ul className="mb-4 space-y-2">
            {rates.data.map((r) => (
              <li key={r.id} className="rounded-2xl border border-field px-4 py-3">
                {editingId === r.id ? (
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(r.id);
                    }}
                    className="flex flex-wrap items-start gap-2"
                  >
                    <Field label={`Курс 1 ${r.currency}`} error={update.error?.fields?.rate} className="w-40">
                      {(c) => <input {...c} autoFocus inputMode="decimal" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} className={inputClass} />}
                    </Field>
                    <Field label="Действует с" error={update.error?.fields?.validFrom} className="w-44">
                      {(c) => <input {...c} type="date" value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} className={inputClass} />}
                    </Field>
                    <Field label="Действует по" hint="Пусто — бессрочно" error={update.error?.fields?.validTo} className="w-44">
                      {(c) => <input {...c} type="date" value={edit.validTo} onChange={(e) => setEdit({ ...edit, validTo: e.target.value })} className={inputClass} />}
                    </Field>
                    <div className="flex gap-2 md:mt-6">
                      <button type="submit" disabled={update.isPending} className={btnPrimary}>
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          update.reset();
                        }}
                        className={btnSecondary}
                      >
                        Отмена
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold">
                        1 {r.currency} = {showRate(r.rate)} {baseCurrency}
                      </span>{' '}
                      <span className="text-muted">
                        {r.validTo ? `с ${formatDateRu(r.validFrom)} по ${formatDateRu(r.validTo)}` : `с ${formatDateRu(r.validFrom)}, бессрочно`}
                      </span>
                    </span>
                    {!readOnly &&
                      (deletingId === r.id ? (
                        <ConfirmDelete
                          what={`фиксированный курс ${r.currency}`}
                          pending={remove.isPending}
                          onConfirm={() => remove.mutate(r.id)}
                          onCancel={() => setDeletingId(null)}
                        />
                      ) : (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setEdit({ rate: showRate(r.rate), validFrom: r.validFrom, validTo: r.validTo ?? '' });
                              setEditingId(r.id);
                            }}
                            className={btnSmall}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setDeletingId(r.id);
                            }}
                            className={btnSmall}
                          >
                            Удалить
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && (
        <form
          aria-label="Новый фиксированный курс"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            resetMessages();
            create.mutate();
          }}
          className="flex flex-wrap items-start gap-2"
        >
          <Field label="Валюта" error={create.error?.fields?.currency} className="w-56">
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
          <Field label={`Курс к ${baseCurrency}`} error={create.error?.fields?.rate} className="w-40">
            {(c) => <input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Действует с" error={create.error?.fields?.validFrom} className="w-44">
            {(c) => <input {...c} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Действует по" hint="Пусто — бессрочно" error={create.error?.fields?.validTo} className="w-44">
            {(c) => <input {...c} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} />}
          </Field>
          <button type="submit" disabled={create.isPending} className={`${btnPrimary} md:mt-6`}>
            Добавить курс
          </button>
        </form>
      )}
    </section>
  );
}

function ManualRatesSection() {
  const rates = useManualRates();
  const choices = CURRENCIES.filter((c) => c.code !== 'KZT');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const [chosenFilter, setFilter] = useState('');
  const [shown, setShown] = useState(MANUAL_PAGE);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRate, setEditRate] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // удалили последний курс отфильтрованной валюты — фильтр сбрасывается сам
  const filter = rates.data?.some((r) => r.currency === chosenFilter) ? chosenFilter : '';
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rates-manual'] }), refreshTotals()]);

  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api('/rates/manual', { method: 'POST', body: { date, currency, rate } }),
    onSuccess: async () => {
      await refresh();
      setRate('');
    },
  });
  const update = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`/rates/manual/${id}`, { method: 'PATCH', body: { rate: editRate } }),
    onSuccess: async () => {
      await refresh();
      setEditingId(null);
    },
  });
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`/rates/manual/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeletingId(null);
      await refresh();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    remove.reset();
  };
  const error = generalError(create.error, update.error, remove.error);
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
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      <form
        aria-label="Новый курс на дату"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          resetMessages();
          create.mutate();
        }}
        className="mb-4 flex flex-wrap items-start gap-2"
      >
        <Field label="Дата" error={create.error?.fields?.date} className="w-44">
          {(c) => <input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Валюта" error={create.error?.fields?.currency} className="w-56">
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
        <Field label="Курс к тенге" error={create.error?.fields?.rate} className="w-40">
          {(c) => <input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />}
        </Field>
        <button type="submit" disabled={create.isPending} className={`${btnPrimary} md:mt-6`}>
          Добавить курс
        </button>
      </form>
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
          {list.length === 0 && <p className="text-muted">Курсов нет.</p>}
          <ul className="space-y-2">
            {list.slice(0, shown).map((r) => (
              <li key={r.id} className="rounded-2xl border border-field px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="text-muted">{formatDateRu(r.date)}</span>{' '}
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rateToKzt)} KZT
                    </span>
                  </span>
                  {editingId === r.id ? (
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        update.mutate(r.id);
                      }}
                      className="flex flex-wrap items-start gap-2"
                    >
                      <Field label="Курс к тенге" error={update.error?.fields?.rate} className="w-40">
                        {(c) => <input {...c} autoFocus inputMode="decimal" value={editRate} onChange={(e) => setEditRate(e.target.value)} className={inputClass} />}
                      </Field>
                      <div className="flex gap-2 md:mt-6">
                        <button type="submit" disabled={update.isPending} className={btnPrimary}>
                          Сохранить
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            update.reset();
                          }}
                          className={btnSecondary}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : deletingId === r.id ? (
                    <ConfirmDelete
                      what={`курс ${r.currency} на ${formatDateRu(r.date)}`}
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(r.id)}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setEditRate(showRate(r.rateToKzt));
                          setEditingId(r.id);
                        }}
                        className={btnSmall}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(r.id);
                        }}
                        className={btnSmall}
                      >
                        Удалить
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" onClick={() => setShown(shown + MANUAL_PAGE)} className={`${btnSecondary} mt-3`}>
              Показать ещё ({list.length - shown})
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function RatesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">Фиксированные курсы валют</h1>
      <FixedRatesSection
        key={company.id}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        readOnly={company.archivedAt !== null}
      />
      <ManualRatesSection />
    </section>
  );
}
