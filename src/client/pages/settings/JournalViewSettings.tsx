import { useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import { savePreference, usePreferences } from '../../lib/queries';

/**
 * «Настройки журнала» (§7.5 этапа 1.5), первая версия плана 1.5-1b: видимые колонки журнала и вопрос
 * о несохранённом в форме операции. «Применить» сохраняет всё вместе. «Дата сделки» и «Показывать полностью»
 * добавит план 1.5-2; список колонок в журнале по-прежнему применяется сразу.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm prefs={prefs.data} />;
}

function JournalViewForm({ prefs }: { prefs: Record<string, unknown> }) {
  const [columns, setColumns] = useState<JournalColumnId[]>(() => visibleColumns(prefs[JOURNAL_COLUMNS_PREF]));
  const [ask, setAsk] = useState(() => !skipCloseConfirm(prefs));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      await savePreference(JOURNAL_COLUMNS_PREF, columns);
      await savePreference(SKIP_CLOSE_CONFIRM_PREF, !ask);
      setStatus('Настройки сохранены');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">Настройки журнала</h1>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Колонки</legend>
        <div className="grid gap-2">
          {JOURNAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.fixed || columns.includes(c.id)}
                disabled={c.fixed}
                onChange={() => {
                  setStatus(null);
                  setColumns((v) => toggleColumn(v, c.id));
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Форма операции</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ask}
            onChange={(e) => {
              setStatus(null);
              setAsk(e.target.checked);
            }}
          />
          Спрашивать перед закрытием формы с несохранёнными данными
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <p role="status" className={status ? 'mb-4 text-sm text-income' : 'sr-only'}>
        {status}
      </p>
      <button type="button" disabled={pending} onClick={() => void apply()} className={btnPrimary}>
        Применить
      </button>
    </section>
  );
}
