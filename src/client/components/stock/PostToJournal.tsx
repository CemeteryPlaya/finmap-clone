import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { api, ApiError } from '../../lib/api';
import { invalidateOperations } from '../../lib/journal-mutations';
import { createFromForm } from '../../lib/operation-create';
import { categoryOptions } from '../../lib/operation-options';
import { useAccounts, useCategories, type Company } from '../../lib/queries';
import { invalidateStock, type StockDoc } from '../../lib/stock';
import { Field } from '../Field';
import { Pending } from '../QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';

/** Категория дохода по умолчанию для выручки магазина (§6.3 спецификации «Склад»). */
export const SALES_CATEGORY = 'Продажа товаров';

/**
 * «Провести в журнал» у продажи (§6.3): доход на выбранный счёт — сумма документа, проект склада, комментарий
 * «Продажа {номер}». Счёт и категорию склад запоминает: в следующий раз подставятся прошлые. Счета — только в валюте компании.
 */
export function PostToJournal(props: { company: Company; doc: StockDoc; onDone: (posted: boolean) => void }) {
  const { company, doc } = props;
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  if (!accounts.data || !categories.data) return <Pending queries={[accounts, categories]} />;
  return <PostForm company={company} doc={doc} accounts={accounts.data} categories={categories.data} onDone={props.onDone} />;
}

function PostForm(props: {
  company: Company;
  doc: StockDoc;
  accounts: NonNullable<ReturnType<typeof useAccounts>['data']>;
  categories: NonNullable<ReturnType<typeof useCategories>['data']>;
  onDone: (posted: boolean) => void;
}) {
  const { company, doc } = props;
  const usable = props.accounts.filter((a) => !a.archivedAt && a.currency === company.baseCurrency);
  const options = categoryOptions(props.categories, 'income', [doc.lastPost?.categoryId ?? null]);
  const byName = options.find((o) => o.label === SALES_CATEGORY);
  const [accountId, setAccountId] = useState<number | null>(() => {
    const last = doc.lastPost?.accountId;
    return usable.find((a) => a.id === last)?.id ?? usable[0]?.id ?? null;
  });
  const [categoryId, setCategoryId] = useState<number | null>(() => doc.lastPost?.categoryId ?? byName?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const post = useMutation<unknown, ApiError, { accountId: number; categoryId: number }>({
    mutationFn: (body) => api(`/companies/${company.id}/stock/docs/${doc.id}/journal`, { method: 'POST', body }),
    onSuccess: async () => {
      await Promise.all([invalidateStock(company.id), invalidateOperations(company.id)]);
      props.onDone(true);
    },
    onError: (e) => setError(e.fields?.accountId ?? e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (accountId === null) {
      setError('Выберите счёт');
      return;
    }
    if (categoryId === null) {
      setError('Выберите категорию дохода');
      return;
    }
    setError(null);
    post.mutate({ accountId, categoryId });
  };
  const createCategory = async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await createFromForm(company.id, 'category', SALES_CATEGORY, { kind: 'income', counterpartyType: 'client' });
      setCategoryId(id);
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');
    } finally {
      setCreating(false);
    }
  };

  if (usable.length === 0) {
    return (
      <p className="text-muted">
        Нет счёта в валюте компании ({company.baseCurrency}).{' '}
        <Link to={`/c/${company.id}/settings/accounts`} className="font-semibold underline">
          Добавьте счёт
        </Link>
        .
      </p>
    );
  }
  return (
    <form noValidate onSubmit={submit} aria-label="Провести в журнал" className="grid gap-4">
      <p className="text-sm text-muted">
        В журнал попадёт доход на сумму <strong className="text-ink tabular-nums">{formatMoney(doc.total, company.baseCurrency, MONEY_SCREEN)}</strong> с комментарием «Продажа {doc.number}» и проектом склада.
      </p>
      <Field label="На счёт">
        {(c) => (
          <select {...c} value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))} className={inputClass}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Категория дохода">
        {(c) => (
          <select {...c} value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value === '' ? null : Number(e.target.value))} className={inputClass}>
            <option value="">Выберите категорию</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {!byName && (
        <button type="button" disabled={creating} onClick={() => void createCategory()} className={`${btnSmall} justify-self-start`}>
          Создать категорию «{SALES_CATEGORY}»
        </button>
      )}
      {error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={post.isPending} className={btnPrimary}>
          Провести
        </button>
        <button type="button" onClick={() => props.onDone(false)} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
