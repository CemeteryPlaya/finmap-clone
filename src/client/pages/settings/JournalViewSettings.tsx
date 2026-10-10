import { useEffect, useRef, useState } from 'react';
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
  // что реально сохранено: от него считается «есть изменения» и после частичного сбоя он отражает правду
  const [saved, setSaved] = useState({ columns, ask });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'status' | 'button' | null>(null);

  const columnsChanged = columns.join() !== saved.columns.join();
  const askChanged = ask !== saved.ask;
  const dirty = columnsChanged || askChanged;

  // кнопка и поля отключены на время сохранения: фокус возвращается сюда, когда оно закончилось
  useEffect(() => {
    if (pending || !refocus.current) return;
    (refocus.current === 'status' ? statusRef.current : buttonRef.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [pending]);

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    const fail = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');
    const done = { ...saved };
    let ok = false;
    try {
      // только изменённое: неизменённая настройка не затирает более новое значение из другой вкладки
      if (columnsChanged) {
        try {
          await savePreference(JOURNAL_COLUMNS_PREF, columns);
          done.columns = columns;
        } catch (e) {
          setError(`Колонки не сохранены: ${fail(e)}`);
          return;
        }
      }
      if (askChanged) {
        try {
          await savePreference(SKIP_CLOSE_CONFIRM_PREF, !ask);
          done.ask = ask;
        } catch (e) {
          setError(`${columnsChanged ? 'Колонки сохранены, но вопрос' : 'Вопрос'} о несохранённом — нет: ${fail(e)}`);
          return;
        }
      }
      ok = true;
      setStatus('Настройки сохранены');
    } finally {
      setSaved(done);
      refocus.current = ok ? 'status' : 'button';
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
                  setError(null);
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
              setError(null);
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
      <p ref={statusRef} tabIndex={-1} role="status" className={status ? 'mb-4 text-sm text-income outline-none' : 'sr-only'}>
        {status}
      </p>
      <button ref={buttonRef} type="button" disabled={pending || !dirty} onClick={() => void apply()} className={btnPrimary}>
        Применить
      </button>
    </section>
  );
}
