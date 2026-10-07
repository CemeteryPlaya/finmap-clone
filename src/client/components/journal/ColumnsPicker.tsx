import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, type JournalColumnId } from '../../lib/journal-columns';
import { queryClient } from '../../lib/query';
import { Popover } from '../Popover';

/**
 * «Колонки»: флажки видимых колонок журнала. Выбор виден сразу и сохраняется в настройках пользователя
 * (`journal.columns`). Учитывается только ответ на последний выбор (быстрые щелчки подряд не путаются):
 * после успеха выбор берётся из кэша настроек, после сбоя настройки перечитываются с сервера
 * и показывается ошибка.
 */
export function ColumnsPicker({ visible }: { visible: readonly JournalColumnId[] }) {
  const [error, setError] = useState<string | null>(null);
  // флажок отражает выбор сразу: кэш TanStack Query оповещает подписчиков не синхронно
  const [override, setOverride] = useState<JournalColumnId[] | null>(null);
  const seq = useRef(0);
  const current = override ?? visible;

  const toggle = (id: JournalColumnId) => {
    const next = toggleColumn(current, id);
    const mine = ++seq.current;
    setOverride(next);
    setError(null);
    queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [JOURNAL_COLUMNS_PREF]: next }));
    api(`/preferences/${encodeURIComponent(JOURNAL_COLUMNS_PREF)}`, { method: 'PUT', body: { value: next } })
      .then(() => {
        if (mine !== seq.current) return;
        queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [JOURNAL_COLUMNS_PREF]: next }));
        setOverride(null);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOverride(null);
        setError('Не удалось сохранить выбор колонок');
        void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      });
  };

  return (
    <Popover label="Колонки">
      {() => (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Видимые колонки</legend>
          {JOURNAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={c.fixed || current.includes(c.id)} disabled={c.fixed} onChange={() => toggle(c.id)} />
              {c.label}
              {c.fixed && <span className="text-xs text-muted">(всегда)</span>}
            </label>
          ))}
          {error && (
            <p role="alert" className="mt-2 text-xs text-expense">
              {error}
            </p>
          )}
        </fieldset>
      )}
    </Popover>
  );
}
