import { useState } from 'react';
import { formatDateRu } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';

export interface MissingRate {
  message: string;
  currency: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/**
 * Ошибка RATE_UNAVAILABLE в форме операции (§4.3 п. 6, §7): текст ошибки, «Указать курс на {D}» — небольшая форма,
 * которая создаёт ручной курс к тенге только на эту дату, — и «Повторить» (сохранить операцию ещё раз).
 */
export function RateFix(props: { missing: MissingRate; companyId: number; pending: boolean; onRetry: () => void }) {
  const { currency, date } = props.missing;
  const day = formatDateRu(date);
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/rates/manual', { method: 'POST', body: { date, currency, rate } });
      setSaved(true);
      setOpen(false);
      // ручной курс меняет итоги «Всего на счетах» и экран «Курсы»
      void queryClient.invalidateQueries({ queryKey: ['rates-manual'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', props.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.rate ?? e.fields?.date ?? e.message) : 'Ошибка сервера');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="alert" className="grid gap-2 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
      <span>{props.missing.message}</span>
      {saved && (
        <span className="text-ink">
          Курс {currency} на {day} сохранён — нажмите «Повторить».
        </span>
      )}
      {open ? (
        <div role="group" aria-label={`Курс на ${day}`} className="flex flex-wrap items-end gap-2 text-ink">
          <Field label={`Курс ${currency} к тенге на ${day}`} error={error ?? undefined} className="min-w-48 flex-1">
            {(c) => (
              <input
                {...c}
                autoFocus
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => {
                  // Enter здесь сохраняет курс, а не операцию
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="button" disabled={saving} onClick={() => void save()} className={btnSmall}>
            Сохранить курс
          </button>
          <button type="button" onClick={() => setOpen(false)} className={btnSmall}>
            Не указывать
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!saved && (
            <button type="button" onClick={() => setOpen(true)} className={btnSmall}>
              Указать курс на {day}
            </button>
          )}
          <button type="button" disabled={props.pending} onClick={props.onRetry} className={btnSmall}>
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}
