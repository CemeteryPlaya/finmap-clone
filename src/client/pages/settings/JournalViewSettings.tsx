import { useEffect, useId, useRef, useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, toggleColumn } from '../../lib/journal-columns';
import { JOURNAL_VIEW_NAMES, journalViewChanges, journalViewPref, savedJournalView, shownJournalView, type JournalView, type JournalViewKey } from '../../lib/journal-view';
import { prefsSaveError } from '../../lib/preferences';
import { queryClient } from '../../lib/query';
import { savePreference, usePreferences } from '../../lib/queries';

const rowClass = 'flex items-center justify-between gap-4 border-b border-field py-3 text-sm';

/**
 * «Настройки журнала» (§7.5 этапа 1.5), окончательный вид как в Finmap (`36`): флажки колонок, «Показывать полностью
 * (до 2 строк)», «Спрашивать перед закрытием формы…» — строками «подпись — флажок», «Применить» сохраняет всё вместе.
 * Список в «Ещё» журнала применяется сразу.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm saved={savedJournalView(prefs.data)} />;
}

function JournalViewForm({ saved }: { saved: JournalView }) {
  // только правки: настройка без правки следует за сохранённым (другая вкладка, перезапрос после сбоя)
  const [edits, setEdits] = useState<Partial<JournalView>>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'status' | 'button' | null>(null);
  const wrapHelpId = useId();
  const view = shownJournalView(saved, edits);
  const changes = journalViewChanges(saved, edits);

  // кнопка и поля отключены на время сохранения: фокус возвращается сюда, когда оно закончилось
  useEffect(() => {
    if (pending || !refocus.current) return;
    (refocus.current === 'status' ? statusRef.current : buttonRef.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [pending]);

  const edit = (patch: Partial<JournalView>) => {
    setStatus(null);
    setError(null);
    setEdits((e) => ({ ...e, ...patch }));
  };

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    const done: JournalViewKey[] = [];
    let ok = true;
    try {
      // по очереди и только изменённое: неизменённая настройка не затирает более новое значение из другой вкладки
      for (const key of changes) {
        const { pref, value } = journalViewPref(view, key);
        try {
          await savePreference(pref, value);
          done.push(key);
        } catch (e) {
          ok = false;
          setError(
            prefsSaveError(
              done.map((k) => JOURNAL_VIEW_NAMES[k]),
              JOURNAL_VIEW_NAMES[key],
              e instanceof ApiError ? e.message : 'Ошибка сервера',
            ),
          );
          break;
        }
      }
      if (ok) setStatus('Настройки сохранены');
      // после сбоя — правда с сервера: «Применить» считается от неё и не залипает (итоги 1.5-2a №5)
      else await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    } finally {
      // сохранённое — уже не правка: savePreference положил значение в кэш настроек
      setEdits((e) => {
        const next = { ...e };
        for (const key of done) delete next[key];
        return next;
      });
      refocus.current = ok ? 'status' : 'button';
      setPending(false);
    }
  };

  return (
    <section className="max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Настройки журнала</h1>
      <fieldset disabled={pending}>
        <legend className="sr-only">Колонки</legend>
        {JOURNAL_COLUMNS.map((c) => (
          <label key={c.id} className={rowClass}>
            <span>{c.label}</span>
            <input
              type="checkbox"
              checked={c.fixed || view.columns.includes(c.id)}
              disabled={c.fixed}
              onChange={() => edit({ columns: toggleColumn(view.columns, c.id) })}
            />
          </label>
        ))}
      </fieldset>
      <fieldset disabled={pending} className="mt-4">
        <legend className="sr-only">Строки</legend>
        <div className="border-b border-field py-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Показывать полностью (до 2 строк)</span>
            <input type="checkbox" aria-describedby={wrapHelpId} checked={view.wrap} onChange={(e) => edit({ wrap: e.target.checked })} />
          </label>
          <p id={wrapHelpId} className="mt-1 pr-8 text-xs text-muted">
            Счёт, контрагент, категория и проект — до 2 строк. На экран поместится меньше операций.
          </p>
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mt-4">
        <legend className="sr-only">Форма операции</legend>
        <label className={rowClass}>
          <span>Спрашивать перед закрытием формы с несохранёнными данными</span>
          <input type="checkbox" checked={view.ask} onChange={(e) => edit({ ask: e.target.checked })} />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={`${alertClass} mt-4`}>
          {error}
        </p>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className={status ? 'mt-4 text-sm text-income-strong outline-none' : 'sr-only'}>
        {status}
      </p>
      <button ref={buttonRef} type="button" disabled={pending || changes.length === 0} onClick={() => void apply()} className={`${btnPrimary} mt-6 w-full`}>
        Применить
      </button>
    </section>
  );
}
