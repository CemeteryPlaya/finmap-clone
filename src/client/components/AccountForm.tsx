import { useState, type FormEvent } from 'react';
import { CURRENCIES, getCurrency } from '../../shared/currencies';
import { formatAmount, parseAmount } from '../../shared/money';
import type { Account, Project } from '../lib/queries';
import { AMOUNT_MAX_LENGTH, sanitizeAmountInput } from '../lib/amount-input';
import { Field } from './Field';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

export interface AccountFormValues {
  name: string;
  currency: string;
  projectId: number | null;
  /** null — дата открытия по умолчанию (сегодня на сервере, в APP_TIMEZONE). */
  openedAt: string | null;
  startingBalance: number;
}

/**
 * Форма счёта в окне (§7.4 этапа 1.5): поля в порядке Finmap — «Валюта», «Название счёта», «Стартовый баланс»,
 * затем наши «Проект» и «Дата открытия»; одна колонка. Начальный фокус ставит окно — на первое поле.
 */
export function AccountForm(props: {
  mode: 'create' | 'edit';
  initial?: Account;
  defaultCurrency: string;
  projects: Project[];
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: AccountFormValues) => void;
  onCancel: () => void;
  /** По счёту есть операции: валюту менять нельзя (§4.4). */
  currencyLocked?: boolean;
}) {
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [currency, setCurrency] = useState(init?.currency ?? props.defaultCurrency);
  const [projectId, setProjectId] = useState(init?.projectId != null ? String(init.projectId) : '');
  const [openedAt, setOpenedAt] = useState(init?.openedAt ?? '');
  const [balance, setBalance] = useState(init ? formatAmount(init.startingBalance, getCurrency(init.currency).minorUnits) : '0');
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const fields = { ...props.serverFields, ...clientFields };
  // архивные проекты не предлагаются (инвариант 7), кроме текущего проекта счёта
  const choices = props.projects.filter((p) => !p.archivedAt || p.id === init?.projectId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const minor = getCurrency(currency).minorUnits;
    const amount = parseAmount(balance, minor);
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Введите название';
    if (amount === null) {
      errors.startingBalance = minor > 0 ? `Введите сумму, например 1 500,${'5'.padEnd(minor, '0')}` : 'Введите сумму без дробной части, например 1 500';
    }
    if (props.mode === 'edit' && !openedAt) errors.openedAt = 'Укажите дату открытия';
    setClientFields(errors);
    if (amount === null || Object.keys(errors).length > 0) return;
    props.onSubmit({ name, currency, projectId: projectId ? Number(projectId) : null, openedAt: openedAt || null, startingBalance: amount });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field label="Валюта" error={fields.currency} hint={props.currencyLocked ? 'По счёту есть операции — валюту изменить нельзя' : undefined}>
        {(c) => (
          <select {...c} value={currency} disabled={props.currencyLocked} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Название счёта" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaspi Gold" className={inputClass} />}
      </Field>
      <Field label="Стартовый баланс" hint="Остаток на дату открытия счёта" error={fields.startingBalance}>
        {(c) => <input
            {...c}
            inputMode="decimal"
            maxLength={AMOUNT_MAX_LENGTH}
            value={balance}
            onChange={(e) => setBalance(sanitizeAmountInput(e.target.value, { negative: true }))}
            className={inputClass}
          />}
      </Field>
      <Field label="Проект" error={fields.projectId}>
        {(c) => (
          <select {...c} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
            <option value="">Без проекта (общий счёт)</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archivedAt ? ' (в архиве)' : ''}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label="Дата открытия"
        error={fields.openedAt}
        hint={props.mode === 'create' ? 'Пусто — сегодня. Чтобы вносить прошлые операции, поставьте дату раньше.' : undefined}
      >
        {(c) => <input {...c} type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className={inputClass} />}
      </Field>
      {props.serverError && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {props.serverError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать счёт' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
