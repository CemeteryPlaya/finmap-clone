import { useEffect, useRef, useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap, prefsSaveError, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import { savePreference, usePreferences } from '../../lib/queries';

/**
 * «Настройки журнала» (§7.5 этапа 1.5): видимые колонки (в том числе «Дата сделки»), «Показывать полностью
 * (до 2 строк)» и вопрос о несохранённом в форме операции. «Применить» сохраняет всё вместе; список в «Ещё»
 * журнала применяется сразу. Окончательный вид страницы — план 1.5-4.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm prefs={prefs.data} />;
}

interface Saved {
  columns: JournalColumnId[];
  wrap: boolean;
  ask: boolean;
}

function JournalViewForm({ prefs }: { prefs: Record<string, unknown> }) {
  const [columns, setColumns] = useState<JournalColumnId[]>(() => visibleColumns(prefs[JOURNAL_COLUMNS_PREF]));
  const [wrap, setWrap] = useState(() => journalWrap(prefs));
  const [ask, setAsk] = useState(() => !skipCloseConfirm(prefs));
  // что реально сохранено: от него считается «есть изменения» и после частичного сбоя он отражает правду
  const [saved, setSaved] = useState<Saved>({ columns, wrap, ask });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'status' | 'button' | null>(null);

  // только изменённое и по очереди: неизменённая настройка не затирает более новое значение из другой вкладки
  const changes = [
    { changed: columns.join() !== saved.columns.join(), name: 'колонки', save: () => savePreference(JOURNAL_COLUMNS_PREF, columns), mark: (s: Saved): Saved => ({ ...s, columns }) },
    { changed: wrap !== saved.wrap, name: '«Показывать полностью»', save: () => savePreference(JOURNAL_WRAP_PREF, wrap), mark: (s: Saved): Saved => ({ ...s, wrap }) },
    { changed: ask !== saved.ask, name: 'вопрос о несохранённом', save: () => savePreference(SKIP_CLOSE_CONFIRM_PREF, !ask), mark: (s: Saved): Saved => ({ ...s, ask }) },
  ].filter((c) => c.changed);
  const dirty = changes.length > 0;

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
    let done = saved;
    const savedNames: string[] = [];
    let ok = true;
    try {
      for (const c of changes) {
        try {
          await c.save();
          done = c.mark(done);
          savedNames.push(c.name);
        } catch (e) {
          ok = false;
          setError(prefsSaveError(savedNames, c.name, e instanceof ApiError ? e.message : 'Ошибка сервера'));
          return;
        }
      }
      setStatus('Настройки сохранены');
    } finally {
      setSaved(done);
      refocus.current = ok ? 'status' : 'button';
      setPending(false);
    }
  };

  const edited = () => {
    setStatus(null);
    setError(null);
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
                  edited();
                  setColumns((v) => toggleColumn(v, c.id));
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Строки</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-describedby="journal-wrap-help"
            checked={wrap}
            onChange={(e) => {
              edited();
              setWrap(e.target.checked);
            }}
          />
          Показывать полностью (до 2 строк)
        </label>
        <p id="journal-wrap-help" className="mt-1 text-xs text-muted">Без флажка длинные названия и комментарии обрезаются в одну строку, полный текст — в подсказке.</p>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Форма операции</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ask}
            onChange={(e) => {
              edited();
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
