import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { pluralRu } from '../../lib/journal-format';
import { queryClient } from '../../lib/query';
import type { SavedFilter } from '../../lib/queries';
import { Caret, Popover } from '../Popover';
import { btnDanger, btnSecondary, btnSmall, inputClass } from '../ui';

/** «N условий недоступно»: ссылки фильтра на удалённые, архивные или чужие элементы (инвариант 10). */
export function unavailableText(n: number): string {
  return `${n} ${pluralRu(n, 'условие недоступно', 'условия недоступны', 'условий недоступно')}`;
}

const errorText = (e: unknown) => (e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');

function SavedFilterItem(props: { filter: SavedFilter; companyId: number; onApply: () => void; onRemoved: () => void }) {
  const { filter } = props;
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(filter.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const url = `/companies/${props.companyId}/saved-filters/${filter.id}`;
  // поле названия и подтверждение исчезают — фокус возвращается на кнопку фильтра, а не теряется
  const applyRef = useRef<HTMLButtonElement>(null);
  const [focusApply, setFocusApply] = useState(false);
  useEffect(() => {
    if (mode !== 'view' || !focusApply) return;
    applyRef.current?.focus();
    setFocusApply(false);
  }, [mode, focusApply]);
  const back = () => {
    setMode('view');
    setFocusApply(true);
  };

  const run = async (request: () => Promise<unknown>, done: () => void) => {
    setPending(true);
    setError(null);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: ['saved-filters', props.companyId] });
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  if (mode === 'rename') {
    return (
      <li className="py-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(url, { method: 'PATCH', body: { name } }), back);
          }}
          className="flex flex-col gap-2"
        >
          <input
            aria-label={`Новое название фильтра «${filter.name}»`}
            aria-invalid={error ? true : undefined}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className={`${inputClass} py-1.5 text-sm`}
          />
          {error && <p className="text-xs text-expense-strong">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnSmall}>
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => {
                setName(filter.name);
                setError(null);
                back();
              }}
              className={btnSmall}
            >
              Отмена
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === 'delete') {
    return (
      <li role="group" aria-label={`Удаление фильтра «${filter.name}»`} className="flex flex-col gap-2 py-1 text-sm">
        <span>Удалить фильтр «{filter.name}»?</span>
        {error && <p className="text-xs text-expense-strong">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => void run(() => api(url, { method: 'DELETE' }), props.onRemoved)} className={`${btnDanger} px-3 py-1.5 text-sm`}>
            Да, удалить
          </button>
          <button type="button" autoFocus onClick={back} className={`${btnSecondary} px-3 py-1.5 text-sm`}>
            Отмена
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-0.5">
      <button
        ref={applyRef}
        type="button"
        aria-label={`Применить фильтр «${filter.name}»${filter.invalid ? ', повреждён' : filter.unavailable > 0 ? `, ${unavailableText(filter.unavailable)}` : ''}`}
        disabled={filter.invalid}
        title={filter.invalid ? 'Фильтр повреждён: переименуйте или удалите его — условия не применяются' : undefined}
        onClick={props.onApply}
        className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-field disabled:text-muted disabled:hover:bg-transparent"
      >
        {filter.name}
        {filter.invalid && <span className="ml-1 text-xs text-expense-strong">(повреждён)</span>}
        {filter.unavailable > 0 && <span className="ml-1 text-xs text-expense-strong">({unavailableText(filter.unavailable)})</span>}
      </button>
      <button
        type="button"
        aria-label={`Переименовать фильтр «${filter.name}»`}
        title="Переименовать"
        onClick={() => setMode('rename')}
        className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-field"
      >
        <span aria-hidden="true">✎</span>
      </button>
      <button
        type="button"
        aria-label={`Удалить фильтр «${filter.name}»`}
        title="Удалить"
        onClick={() => setMode('delete')}
        className="rounded-lg px-2 py-1 text-sm text-expense-strong hover:bg-field"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
}

/**
 * «Быстрые фильтры» (§5.1 этапа 1.5) — стрелка составной кнопки «Фильтр | ▾»: применить, переименовать, удалить
 * сохранённый фильтр. Сохраняют фильтр в окне фильтра; пустое меню ведёт туда кнопкой «Создать новый фильтр»
 * (меню закрывается, фокус — на стрелке, после окна он вернётся сюда же).
 */
export function SavedFiltersMenu(props: {
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
  /** Не передан (архивная компания: сохранять нечего) — пустое меню без «Создать новый фильтр» и подсказки. */
  onCreate?: () => void;
  buttonClassName?: string;
}) {
  return (
    <Popover label={<Caret />} ariaLabel="Быстрые фильтры" align="right" buttonClassName={props.buttonClassName} panelClassName="w-80">
      {(close) => (
        <div>
          <p className="mb-2 text-sm font-semibold">Быстрые фильтры</p>
          {props.filters === undefined ? (
            <p className="text-sm text-muted">Загрузка…</p>
          ) : props.filters.length === 0 ? (
            props.onCreate ? (
              <div className="text-sm">
                <p className="mb-2 text-muted">Сохранённых фильтров пока нет. Задайте условия в окне фильтра и нажмите «Сохранить фильтр».</p>
                <button
                  type="button"
                  onClick={() => {
                    close(true);
                    props.onCreate?.();
                  }}
                  className="font-semibold text-ink underline"
                >
                  Создать новый фильтр
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">Сохранённых фильтров нет.</p>
            )
          ) : (
            <ul>
              {props.filters.map((f) => (
                <SavedFilterItem
                  key={f.id}
                  filter={f}
                  companyId={props.companyId}
                  onApply={() => {
                    props.onApply(f);
                    close(true);
                  }}
                  // удалённый пункт исчезает — фокус на кнопку меню
                  onRemoved={() => close(true)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
