import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalExportHref, SEARCH_MAX, type JournalUrlState } from '../../lib/journal-filter';
import { RefreshIcon, SearchIcon, UploadIcon } from '../icons';
import { inputClass } from '../ui';
import { MoreMenu } from './MoreMenu';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');
const searchInput = compactInput.replace('px-4', 'pl-10 pr-4');
/** Квадратная кнопка тулбара; на телефоне цель касания 44 px. */
const squareButton =
  'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-wait aria-disabled:opacity-60 max-md:size-11';

/**
 * Поиск (§5.1, §8.5 этапа 1.5): лупа внутри поля, справа кнопка-лупа «Найти» (применяет сразу); живой поиск через
 * паузу и по Enter остаётся. Подписи над полем нет — доступное имя «Поиск».
 */
function SearchBox({ value, onSearch, placeholder }: { value: string; onSearch: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  // последнее значение, которое ушло в адресную строку: отличает внешнюю смену (сброс) от своей
  const sent = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (q === sent.current) return;
    const t = setTimeout(() => {
      sent.current = q;
      onSearchRef.current(q);
    }, SEARCH_DEBOUNCE_MS);
    timerRef.current = t;
    return () => clearTimeout(t);
  }, [text]);

  return (
    <form
      role="search"
      className="flex min-w-48 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        // «Найти» применяет сразу: отложенный живой поиск не нужен
        clearTimeout(timerRef.current);
        sent.current = q;
        onSearchRef.current(q);
      }}
    >
      <div className="relative min-w-0 flex-1">
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          aria-label="Поиск"
          value={text}
          maxLength={SEARCH_MAX}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          className={`${searchInput} max-md:h-11`}
        />
      </div>
      <button type="submit" aria-label="Найти" title="Найти" className={squareButton}>
        <SearchIcon />
      </button>
    </form>
  );
}

/** ⟳ «Обновить» в строке над карточками (§2.5, §8.5 этапа 1.5): итог — в живой области под строкой, сбой виден. */
function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [state, setState] = useState({ pending: false, failed: false, text: '' });
  const running = useRef(false);
  const run = async () => {
    // aria-disabled не гасит нажатие, а disabled уронил бы фокус клавиатуры на body
    if (running.current) return;
    running.current = true;
    setState({ pending: true, failed: false, text: '' });
    try {
      await onRefresh();
      setState({ pending: false, failed: false, text: 'Журнал обновлён' });
    } catch {
      setState({ pending: false, failed: true, text: 'Не удалось обновить журнал' });
    } finally {
      running.current = false;
    }
  };
  return (
    <>
      <button type="button" aria-label="Обновить" title="Обновить" aria-disabled={state.pending || undefined} onClick={() => void run()} className={squareButton}>
        <RefreshIcon spinning={state.pending} />
      </button>
      <p role="status" className={state.failed ? 'order-last basis-full text-xs text-expense-strong' : 'sr-only'}>
        {state.text}
      </p>
    </>
  );
}

/**
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, «Ещё ▾» (сумма, ⟳, колонки, выгрузка) и ⤒ «Импортировать» (спецификация импорта, §5.1).
 * На телефоне (`mobile`, §8.5) — «Поиск», ⟳ и воронка «Фильтр · N | ▾»: период, сумма, сортировка и выгрузка — в окне
 * «Фильтры», оно открывается воронкой сразу.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  /** «Фильтр · N | ▾». */
  filter: ReactNode;
  /** ⟳: журнал, балансы и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
  /** Сбой сохранения колонок или «Показывать полностью» после закрытия «Ещё». */
  onPrefError?: (text: string) => void;
  mobile?: boolean;
  /** ⤒ «Импортировать» — последняя кнопка тулбара (§5.1 спецификации импорта); нет — кнопки нет (архивная компания). */
  onImport?: () => void;
}) {
  const { state, onChange } = props;
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [resetKey, setResetKey] = useState(0);

  const reset = () => {
    setResetKey((k) => k + 1);
    onChange(clearFilter(state));
  };
  const setQuery = (q: string) => {
    const next = { ...state };
    if (q) next.q = q;
    else delete next.q;
    onChange(next);
  };

  if (props.mobile) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} placeholder="Поиск" />
        <RefreshButton onRefresh={props.onRefresh} />
        {props.filter}
      </div>
    );
  }

  const currency = getCurrency(props.baseCurrency);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <PeriodMenu state={state} today={props.today} onChange={onChange} />
      <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} placeholder="Поиск по счетам, контрагентам, комментариям" />
      {props.filter}
      {isFiltered(state) && (
        <button type="button" aria-label="Сбросить фильтр" title="Сбросить фильтр" onClick={reset} className={squareButton}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
      <MoreMenu
        companyId={props.companyId}
        state={state}
        onChange={onChange}
        currencySymbol={currency.symbol}
        minorUnits={currency.minorUnits}
        today={props.today}
        exportHref={journalExportHref(props.companyId, state, props.today)}
        onRefresh={props.onRefresh}
        onPrefError={props.onPrefError}
      />
      {props.onImport && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={props.onImport}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-field px-3 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <UploadIcon />
          Импортировать
        </button>
      )}
    </div>
  );
}
