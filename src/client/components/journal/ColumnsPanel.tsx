import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap } from '../../lib/preferences';
import { queryClient } from '../../lib/query';
import { usePreferences } from '../../lib/queries';

/**
 * Настройка пользователя, которая применяется сразу (§5.1 этапа 1.5): выбор виден в тот же миг — и в журнале,
 * через кэш настроек, — а сохраняется в фоне. Учитывается только ответ на последний выбор (быстрые щелчки подряд
 * не путаются): после успеха значение берётся из кэша, после сбоя настройки перечитываются с сервера
 * и показывается ошибка.
 */
export function useInstantPref<T>(key: string, saved: T, failText: string) {
  // флажок отражает выбор сразу: кэш TanStack Query оповещает подписчиков не синхронно
  const [override, setOverride] = useState<{ value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const set = (value: T) => {
    const mine = ++seq.current;
    setOverride({ value });
    setError(null);
    const toCache = () => queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [key]: value }));
    toCache();
    api(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } })
      .then(() => {
        if (mine !== seq.current) return;
        toCache();
        setOverride(null);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOverride(null);
        setError(failText);
        void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      });
  };
  return { value: override ? override.value : saved, set, error };
}

/**
 * Колонки журнала и «Показывать полностью» в панели «Ещё» (§5.1, §5.3 этапа 1.5): флажки применяются сразу.
 * Дата и сумма видны всегда.
 */
export function ColumnsPanel() {
  const prefs = usePreferences();
  const columns = useInstantPref<JournalColumnId[]>(JOURNAL_COLUMNS_PREF, visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]), 'Не удалось сохранить выбор колонок');
  const wrap = useInstantPref<boolean>(JOURNAL_WRAP_PREF, journalWrap(prefs.data), 'Не удалось сохранить «Показывать полностью»');
  const error = columns.error ?? wrap.error;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Колонки</legend>
      <div className="grid grid-cols-2 gap-x-4">
        {JOURNAL_COLUMNS.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={c.fixed || columns.value.includes(c.id)}
              disabled={c.fixed}
              onChange={() => columns.set(toggleColumn(columns.value, c.id))}
              className="size-4 accent-income"
            />
            {c.label}
          </label>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 border-t border-field pt-2 text-sm">
        <input type="checkbox" checked={wrap.value} onChange={(e) => wrap.set(e.target.checked)} className="size-4 accent-income" />
        Показывать полностью
        <span className="text-xs text-muted">(до 2 строк)</span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-expense">
          {error}
        </p>
      )}
    </fieldset>
  );
}
